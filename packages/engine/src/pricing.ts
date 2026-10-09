/**
 * Modules 5–7 — ACU & ABU rate cards and the commercial pricing engine.
 *
 * A commercial model is a set of revenue streams. Each stream declares which
 * cost pools it recovers. The engine enforces that every pool is recovered by
 * at most one stream (no double billing) and flags pools recovered by none
 * (margin leakage). Unit prices are derived from the recovered cost at the
 * pricing-basis month (steady state, contract year 1) and then *locked*;
 * later months bill locked prices × escalation against actual volumes.
 *
 *   ACU price  = recovered cost per ACU / (1 − target margin)
 *   ABU price  = recovered cost per weighted accepted ABU / (1 − target margin)
 *   Fee        = recovered monthly cost / (1 − target margin)
 */
import { D, Decimal, ONE, ZERO, compound, pct, priceAtMargin, safeDiv, sum, max, min } from './decimal';
import type { CostPool, Project, RevenueStream, VolumeTier } from './types';
import { RUN_POOLS, POOL_LABELS } from './types';
import type { RunSnapshot } from './model';
import type { ImplementationResult } from './implementation';

export type Severity = 'error' | 'warning' | 'info';
export interface Issue {
  severity: Severity;
  code: string;
  message: string;
}

export interface AbuWorkflowPrice {
  workflowId: string;
  recoveredCost: Decimal;
  failureCostExcluded: Decimal;
  weightedAbus: Decimal;
  billableUnits: Decimal;
  costPerAbu: Decimal;
  listPrice: Decimal;
  price: Decimal;
  floorPrice: Decimal;
  floorApplied: boolean;
  overridden: boolean;
  classPrices: { classId: string; name: string; weight: Decimal; price: Decimal; assistedPrice: Decimal }[];
}

export interface StreamPrice {
  streamId: string;
  type: RevenueStream['type'];
  label: string;
  recovers: CostPool[];
  targetMarginPct: number;
  /** Monthly recovered cost at the pricing basis (one-time cost for fixed_fee). */
  recoveredCost: Decimal;
  oneTimeFee?: Decimal;
  monthlyFee?: Decimal;
  unitCost?: Decimal;
  listUnitPrice?: Decimal;
  unitPrice?: Decimal;
  floorPrice?: Decimal;
  floorApplied?: boolean;
  overridden?: boolean;
  abu?: { byWorkflow: Record<string, AbuWorkflowPrice>; blendedPrice: Decimal; blendedFloor: Decimal };
  subscription?: {
    platformFee: Decimal;
    includedUnit: 'acu' | 'abu' | 'none';
    includedQty: Decimal;
    allowanceUnitPrice: Decimal;
    includedValue: Decimal;
    overageRate: Decimal;
    /** Unit stream that bills overage, or null when the subscription bills it itself. */
    overageStreamId: string | null;
    totalFee: Decimal;
  };
  gainshare?: { sharePct: number; thresholdAnnual: Decimal; capAnnual: Decimal | null; basis: 'validated' | 'all' };
}

export interface PriceBook {
  streams: StreamPrice[];
  /** For each pool, the stream ids that recover it. */
  recovery: Record<CostPool, string[]>;
  issues: Issue[];
  priceMultiplier: Decimal;
  termMonths: number;
  passThroughMarkupPct: number;
  escalationPct: number;
}

export interface MarginalCosts {
  perAcu: Decimal;
  perAbu: Decimal;
}

export interface RevenueLine {
  streamId: string;
  key: string;
  label: string;
  amount: Decimal;
  recurring: boolean;
}

// ───────────────────────────── tier maths ─────────────────────────────

function sortedTiers(tiers: VolumeTier[]): VolumeTier[] {
  return [...tiers].filter((t) => t.fromUnits >= 0).sort((a, b) => a.fromUnits - b.fromUnits);
}

/**
 * Charge for `units` at base `price` with volume tiers.
 * graduated: units within each band are priced at that band's discount.
 * all_units: every unit is priced at the discount of the highest band reached.
 * Tier prices never fall below `floor`.
 */
export function tieredCharge(units: Decimal, price: Decimal, tiers: VolumeTier[], mode: 'graduated' | 'all_units', floor: Decimal = ZERO): Decimal {
  if (units.lte(0)) return ZERO;
  const ts = sortedTiers(tiers);
  const bandPrice = (discountPct: number) => max(price.times(ONE.minus(pct(discountPct))), floor);
  if (!ts.length) return units.times(price);
  if (mode === 'all_units') {
    let d = 0;
    for (const t of ts) if (units.gt(t.fromUnits)) d = t.discountPct;
    return units.times(bandPrice(d));
  }
  const bands: { from: Decimal; d: number }[] = [{ from: ZERO, d: 0 }];
  for (const t of ts) {
    if (t.fromUnits === 0) bands[0].d = t.discountPct;
    else bands.push({ from: D(t.fromUnits), d: t.discountPct });
  }
  let charge = ZERO;
  for (let i = 0; i < bands.length; i++) {
    const lo = bands[i].from;
    const hi = i + 1 < bands.length ? bands[i + 1].from : null;
    if (units.lte(lo)) break;
    const inBand = (hi ? min(units, hi) : units).minus(lo);
    charge = charge.plus(inBand.times(bandPrice(bands[i].d)));
  }
  return charge;
}

// ───────────────────────────── recovery matrix ─────────────────────────────

export function recoveryMatrix(streams: RevenueStream[]): Record<CostPool, string[]> {
  const m = Object.fromEntries(['IMPLEMENTATION', ...RUN_POOLS].map((p) => [p, [] as string[]])) as Record<CostPool, string[]>;
  for (const s of streams.filter((x) => x.enabled)) for (const p of new Set(s.recovers)) m[p].push(s.id);
  return m;
}

/** Owner stream for a pool's cost (first declared). */
export function poolOwner(recovery: Record<CostPool, string[]>, pool: CostPool): string | null {
  return recovery[pool][0] ?? null;
}

function implAmortized(impl: ImplementationResult, termMonths: number): Decimal {
  return safeDiv(impl.totalCost, Math.max(1, termMonths));
}

// ───────────────────────────── price book ─────────────────────────────

export interface PriceBookInput {
  project: Project;
  baseline: RunSnapshot;
  impl: ImplementationResult;
  marginal: MarginalCosts;
  streams?: RevenueStream[];
}

export function buildPriceBook({ project, baseline, impl, marginal, streams: streamOverride }: PriceBookInput): PriceBook {
  const cfg = project.pricing;
  const streams = (streamOverride ?? cfg.streams).filter((s) => s.enabled);
  const recovery = recoveryMatrix(streams);
  const issues: Issue[] = [];
  const term = Math.max(1, cfg.termMonths);

  for (const [pool, ids] of Object.entries(recovery) as [CostPool, string[]][]) {
    const cost = pool === 'IMPLEMENTATION' ? impl.totalCost : baseline.pools[pool];
    if (ids.length > 1) {
      const labels = ids.map((id) => streams.find((s) => s.id === id)?.label ?? id).join(' and ');
      issues.push({ severity: 'error', code: 'DOUBLE_RECOVERY', message: `${POOL_LABELS[pool]} is recovered by ${labels} — the client would be billed twice. Assign it to one stream.` });
    }
    if (ids.length === 0 && cost.gt(0)) {
      issues.push({ severity: 'warning', code: 'UNRECOVERED_POOL', message: `${POOL_LABELS[pool]} is not recovered by any revenue stream — it reduces provider margin.` });
    }
  }

  // Cost a stream is responsible for: pools it owns (first owner wins for double-recovered pools).
  const ownedPools = (s: RevenueStream) => s.recovers.filter((p) => poolOwner(recovery, p) === s.id);
  const recurringCost = (s: RevenueStream, pools: CostPool[]) =>
    sum(pools.filter((p) => p !== 'IMPLEMENTATION').map((p) => baseline.pools[p])).plus(pools.includes('IMPLEMENTATION') ? implAmortized(impl, term) : ZERO);

  const out: StreamPrice[] = [];
  const acuStream = streams.find((s) => s.type === 'acu');
  const abuStream = streams.find((s) => s.type === 'abu');

  // Unit streams first (subscription allowances reference their prices).
  for (const s of streams) {
    const pools = ownedPools(s);
    const base: StreamPrice = { streamId: s.id, type: s.type, label: s.label, recovers: s.recovers, targetMarginPct: s.targetMarginPct, recoveredCost: ZERO };
    if (s.type === 'fixed_fee') {
      const runPools = s.recovers.filter((p) => p !== 'IMPLEMENTATION');
      if (runPools.length) issues.push({ severity: 'error', code: 'FIXED_FEE_RUN_POOLS', message: `"${s.label}" is a one-time fee and can only recover implementation cost.` });
      const recovered = pools.includes('IMPLEMENTATION') ? impl.totalCost : ZERO;
      let fee: Decimal;
      const usesPlan = !(s.useImplementationPlanPrice === false || !pools.includes('IMPLEMENTATION'));
      if (!usesPlan) {
        fee = recovered.isZero() ? ZERO : priceAtMargin(recovered, s.targetMarginPct).times(ONE.minus(pct(s.discountPct)));
      } else {
        fee = impl.price; // single source of truth: the implementation plan's pricing method, margin and discount
      }
      // When the plan sets the price, report the plan's actual margin rather than the stream's (unused) target.
      out.push({ ...base, targetMarginPct: usesPlan ? impl.marginPct.toNumber() : s.targetMarginPct, recoveredCost: recovered, oneTimeFee: fee });
    } else if (s.type === 'acu') {
      const recovered = recurringCost(s, pools);
      const acus = baseline.acu.total;
      const unitCost = safeDiv(recovered, acus);
      const list = acus.isZero() ? ZERO : priceAtMargin(unitCost, s.targetMarginPct);
      const rc = cfg.acuRateCard;
      const overridden = rc.priceOverride !== null && rc.priceOverride !== undefined;
      let price = overridden ? D(rc.priceOverride!) : list.times(ONE.minus(pct(s.discountPct)));
      const floorPrice = unitCost.isZero() ? ZERO : priceAtMargin(unitCost, rc.marginFloorPct);
      let floorApplied = false;
      if (price.lt(floorPrice)) {
        floorApplied = true;
        issues.push({ severity: 'warning', code: 'ACU_FLOOR', message: `ACU price was raised to the ${rc.marginFloorPct}% margin floor.` });
        price = floorPrice;
      }
      if (acus.isZero() && recovered.gt(0)) issues.push({ severity: 'warning', code: 'ZERO_ACU', message: 'No ACUs are measured at the pricing basis, so an ACU price cannot recover cost.' });
      out.push({ ...base, recoveredCost: recovered, unitCost, listUnitPrice: list, unitPrice: price, floorPrice, floorApplied, overridden });
    } else if (s.type === 'abu') {
      const rc = cfg.abuRateCard;
      const recoveredRun = sum(pools.filter((p) => p !== 'IMPLEMENTATION').map((p) => baseline.pools[p]));
      const implPart = pools.includes('IMPLEMENTATION') ? implAmortized(impl, term) : ZERO;
      const totalRunOfPools = recoveredRun;
      const byWorkflow: Record<string, AbuWorkflowPrice> = {};
      let revenueAtBasis = ZERO;
      for (const wf of project.workflows) {
        const v = baseline.volumes[wf.id];
        const wfRun = sum(pools.filter((p) => p !== 'IMPLEMENTATION').map((p) => baseline.poolsByWorkflow[wf.id]?.[p] ?? ZERO));
        const wfImpl = totalRunOfPools.isZero() ? safeDiv(implPart, project.workflows.length) : implPart.times(safeDiv(wfRun, totalRunOfPools));
        const failure =
          rc.failedCostAllocation === 'provider_absorbs'
            ? sum(pools.filter((p) => p !== 'IMPLEMENTATION').map((p) => baseline.failureCostByWorkflowPool[wf.id]?.[p] ?? ZERO))
            : ZERO;
        const recovered = wfRun.plus(wfImpl).minus(failure);
        const factor = D(rc.humanAssistedPriceFactor ?? 1);
        const billableUnits = sum(v.byClass.map((c) => c.autonomous.plus(c.humanAssisted.times(factor)).times(c.abuWeight)));
        const costPerAbu = safeDiv(recovered, v.weightedAbus);
        const list = billableUnits.isZero() ? ZERO : priceAtMargin(recovered, s.targetMarginPct).div(billableUnits);
        const ov = rc.priceOverrides?.[wf.id];
        const overridden = ov !== null && ov !== undefined;
        let price = overridden ? D(ov) : list.times(ONE.minus(pct(s.discountPct)));
        const floorPrice = billableUnits.isZero() ? ZERO : priceAtMargin(costPerAbu, rc.marginFloorPct).times(safeDiv(v.weightedAbus, billableUnits));
        let floorApplied = false;
        if (price.lt(floorPrice)) {
          floorApplied = true;
          issues.push({ severity: 'warning', code: 'ABU_FLOOR', message: `ABU price for "${wf.name}" was raised to the ${rc.marginFloorPct}% margin floor.` });
          price = floorPrice;
        }
        const classPrices = (wf.complexity.length ? wf.complexity : [{ id: 'standard', name: 'Standard', abuWeight: 1, priceOverride: null }]).map((c) => {
          const weight = D(c.abuWeight);
          const p = rc.classPricing === 'override' && c.priceOverride !== null && c.priceOverride !== undefined ? D(c.priceOverride) : price.times(weight);
          return { classId: c.id, name: c.name, weight, price: p, assistedPrice: p.times(factor) };
        });
        byWorkflow[wf.id] = { workflowId: wf.id, recoveredCost: recovered, failureCostExcluded: failure, weightedAbus: v.weightedAbus, billableUnits, costPerAbu, listPrice: list, price, floorPrice, floorApplied, overridden, classPrices };
        revenueAtBasis = revenueAtBasis.plus(abuRawRevenue(byWorkflow[wf.id], v.byClass));
      }
      const blendedPrice = safeDiv(revenueAtBasis, baseline.totals.weightedAbus);
      const blendedFloor = safeDiv(sum(Object.values(byWorkflow).map((w) => w.floorPrice.times(w.billableUnits))), baseline.totals.weightedAbus);
      out.push({ ...base, recoveredCost: recoveredRun.plus(implPart), abu: { byWorkflow, blendedPrice, blendedFloor }, unitPrice: blendedPrice, unitCost: safeDiv(recoveredRun.plus(implPart), baseline.totals.weightedAbus) });
    }
  }

  for (const s of streams) {
    const pools = ownedPools(s);
    const base: StreamPrice = { streamId: s.id, type: s.type, label: s.label, recovers: s.recovers, targetMarginPct: s.targetMarginPct, recoveredCost: ZERO };
    const disc = ONE.minus(pct(s.discountPct));
    if (s.type === 'fixed_monthly' || s.type === 'agentops') {
      const recovered = recurringCost(s, pools);
      const fee = recovered.isZero() ? ZERO : priceAtMargin(recovered, s.targetMarginPct).times(disc);
      out.push({ ...base, recoveredCost: recovered, monthlyFee: fee });
    } else if (s.type === 'pass_through') {
      out.push({ ...base, recoveredCost: recurringCost(s, pools) });
      if (pools.includes('IMPLEMENTATION')) issues.push({ severity: 'warning', code: 'PASS_THROUGH_IMPL', message: 'Pass-through streams bill actual run cost; implementation is not passed through.' });
    } else if (s.type === 'gainshare') {
      const g = cfg.gainshare;
      out.push({
        ...base,
        recoveredCost: recurringCost(s, pools),
        gainshare: { sharePct: g.sharePct, thresholdAnnual: D(g.thresholdAnnual), capAnnual: g.capAnnual === null || g.capAnnual === undefined ? null : D(g.capAnnual), basis: g.basis },
      });
    } else if (s.type === 'subscription') {
      const recovered = recurringCost(s, pools);
      const platformFee = recovered.isZero() ? ZERO : priceAtMargin(recovered, s.targetMarginPct).times(disc);
      const sub = cfg.subscription;
      const includedQty = sub.includedUnit === 'none' ? ZERO : D(sub.includedQty);
      const unitStream = sub.includedUnit === 'acu' ? acuStream : sub.includedUnit === 'abu' ? abuStream : undefined;
      const unitPriced = unitStream ? out.find((o) => o.streamId === unitStream.id) : undefined;
      let allowanceUnitPrice = ZERO;
      let includedValue = ZERO;
      let overageRate = ZERO;
      if (sub.includedUnit !== 'none') {
        if (unitPriced) {
          allowanceUnitPrice = unitPriced.unitPrice ?? ZERO;
          includedValue = includedQty.times(allowanceUnitPrice).times(ONE.minus(pct(sub.includedDiscountPct)));
        } else {
          const mc = sub.includedUnit === 'acu' ? marginal.perAcu : marginal.perAbu;
          allowanceUnitPrice = mc.isZero() ? ZERO : priceAtMargin(mc, s.targetMarginPct);
        }
        overageRate = allowanceUnitPrice.times(ONE.plus(pct(sub.overagePremiumPct)));
      }
      out.push({
        ...base,
        recoveredCost: recovered,
        monthlyFee: platformFee.plus(includedValue),
        subscription: {
          platformFee,
          includedUnit: sub.includedUnit,
          includedQty,
          allowanceUnitPrice,
          includedValue,
          overageRate,
          overageStreamId: unitPriced ? unitPriced.streamId : null,
          totalFee: platformFee.plus(includedValue),
        },
      });
    }
  }

  // Keep the configured stream order.
  const order = new Map(streams.map((s, i) => [s.id, i]));
  out.sort((a, b) => (order.get(a.streamId) ?? 0) - (order.get(b.streamId) ?? 0));

  return {
    streams: out,
    recovery,
    issues,
    priceMultiplier: ONE,
    termMonths: term,
    passThroughMarkupPct: cfg.passThroughMarkupPct,
    escalationPct: cfg.priceEscalationPct,
  };
}

function abuRawRevenue(p: AbuWorkflowPrice, byClass: RunSnapshot['volumes'][string]['byClass']): Decimal {
  return sum(
    byClass.map((c) => {
      const cp = p.classPrices.find((x) => x.classId === c.classId) ?? p.classPrices[0];
      if (!cp) return ZERO;
      return c.autonomous.times(cp.price).plus(c.humanAssisted.times(cp.assistedPrice));
    }),
  );
}

// ───────────────────────────── revenue ─────────────────────────────

export interface RevenueContext {
  month: number;
  yearIndex: number;
  snapshot: RunSnapshot;
  /** Monthly benefits for gainshare. */
  validatedBenefit: Decimal;
  forecastBenefit: Decimal;
  abuRateCard: Project['pricing']['abuRateCard'];
  acuRateCard: Project['pricing']['acuRateCard'];
}

export function revenueForMonth(book: PriceBook, ctx: RevenueContext): RevenueLine[] {
  const lines: RevenueLine[] = [];
  const { month, snapshot } = ctx;
  const esc = compound(book.escalationPct, ctx.yearIndex).times(book.priceMultiplier);
  const sub = book.streams.find((s) => s.type === 'subscription')?.subscription;

  for (const s of book.streams) {
    if (month === 0) {
      if (s.type === 'fixed_fee' && s.oneTimeFee) lines.push({ streamId: s.streamId, key: 'fee', label: s.label, amount: s.oneTimeFee.times(book.priceMultiplier), recurring: false });
      continue;
    }
    switch (s.type) {
      case 'fixed_fee':
        break;
      case 'fixed_monthly':
      case 'agentops':
        lines.push({ streamId: s.streamId, key: 'fee', label: s.label, amount: (s.monthlyFee ?? ZERO).times(esc), recurring: true });
        break;
      case 'pass_through': {
        const cost = sum(s.recovers.filter((p) => p !== 'IMPLEMENTATION' && book.recovery[p][0] === s.streamId).map((p) => snapshot.pools[p]));
        lines.push({ streamId: s.streamId, key: 'pass', label: s.label, amount: cost.times(ONE.plus(pct(book.passThroughMarkupPct))).times(book.priceMultiplier), recurring: true });
        break;
      }
      case 'gainshare': {
        const g = s.gainshare!;
        const benefit = g.basis === 'validated' ? ctx.validatedBenefit : ctx.forecastBenefit;
        let amt = max(ZERO, benefit.minus(g.thresholdAnnual.div(12))).times(pct(g.sharePct));
        if (g.capAnnual) amt = min(amt, g.capAnnual.div(12));
        lines.push({ streamId: s.streamId, key: 'gainshare', label: s.label, amount: amt.times(book.priceMultiplier), recurring: true });
        break;
      }
      case 'subscription': {
        const sp = s.subscription!;
        lines.push({ streamId: s.streamId, key: 'platform', label: `${s.label} — platform`, amount: sp.platformFee.times(esc), recurring: true });
        if (sp.overageStreamId) {
          lines.push({ streamId: sp.overageStreamId, key: 'included', label: `${s.label} — included ${sp.includedUnit.toUpperCase()}s`, amount: sp.includedValue.times(esc), recurring: true });
        } else if (sp.includedUnit !== 'none') {
          const units = sp.includedUnit === 'acu' ? snapshot.acu.total : snapshot.totals.weightedAbus;
          const over = max(ZERO, units.minus(sp.includedQty));
          lines.push({ streamId: s.streamId, key: 'overage', label: `${s.label} — overage`, amount: over.times(sp.overageRate).times(esc), recurring: true });
        }
        break;
      }
      case 'acu': {
        const units = snapshot.acu.total;
        if (sub && sub.overageStreamId === s.streamId) {
          const over = max(ZERO, units.minus(sub.includedQty));
          lines.push({ streamId: s.streamId, key: 'overage', label: `${s.label} — overage`, amount: over.times(sub.overageRate).times(esc), recurring: true });
        } else {
          const rc = ctx.acuRateCard;
          const usage = tieredCharge(units, (s.unitPrice ?? ZERO).times(esc), rc.tiers, rc.tierMode, (s.floorPrice ?? ZERO).times(esc));
          const commit = D(rc.minMonthlyCommitment).times(esc);
          lines.push({ streamId: s.streamId, key: 'usage', label: s.label, amount: usage, recurring: true });
          if (commit.gt(usage)) lines.push({ streamId: s.streamId, key: 'commit', label: `${s.label} — commitment true-up`, amount: commit.minus(usage), recurring: true });
        }
        break;
      }
      case 'abu': {
        const a = s.abu!;
        const total = snapshot.totals.weightedAbus;
        if (sub && sub.overageStreamId === s.streamId) {
          const over = max(ZERO, total.minus(sub.includedQty));
          lines.push({ streamId: s.streamId, key: 'overage', label: `${s.label} — overage`, amount: over.times(sub.overageRate).times(esc), recurring: true });
        } else {
          const raw = sum(Object.values(a.byWorkflow).map((p) => abuRawRevenue(p, snapshot.volumes[p.workflowId]?.byClass ?? []))).times(esc);
          const rc = ctx.abuRateCard;
          let billed = raw;
          if (rc.tiers.length && total.gt(0)) {
            const blended = safeDiv(raw, total);
            billed = tieredCharge(total, blended, rc.tiers, rc.tierMode, a.blendedFloor.times(esc));
          }
          lines.push({ streamId: s.streamId, key: 'usage', label: s.label, amount: billed, recurring: true });
          const minAbus = D(rc.minMonthlyAbus);
          if (minAbus.gt(total)) lines.push({ streamId: s.streamId, key: 'commit', label: `${s.label} — minimum commitment shortfall`, amount: minAbus.minus(total).times(a.blendedPrice).times(esc), recurring: true });
        }
        break;
      }
    }
  }
  return lines;
}

/** Cost of a month attributed to each stream according to pool ownership. */
export function costByStream(book: PriceBook, pools: Record<CostPool, Decimal>, implCost: Decimal, month: number): Record<string, Decimal> {
  const out: Record<string, Decimal> = {};
  for (const s of book.streams) out[s.streamId] = ZERO;
  out.unrecovered = ZERO;
  const add = (pool: CostPool, amount: Decimal) => {
    const owner = book.recovery[pool]?.[0];
    const target = owner && out[owner] !== undefined ? owner : 'unrecovered';
    out[target] = out[target].plus(amount);
  };
  if (month === 0) add('IMPLEMENTATION', implCost);
  else for (const p of RUN_POOLS) add(p, pools[p]);
  return out;
}
