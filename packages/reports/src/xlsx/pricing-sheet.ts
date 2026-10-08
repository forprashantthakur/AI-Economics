import { POOL_LABELS, RUN_POOLS, type CostPool, type RevenueStream, type VolumeTier } from '@aies/engine';
import { ABS, colName, quoteSheet, type SheetModel } from './book';
import type { Fmt, WB } from './ctx';

export interface TierRef {
  /** Ascending band lower bounds (cell refs), excluding the implicit 0 band. */
  from: string[];
  /** Discount % per band, index 0 = band starting at 0. */
  disc: string[];
  mode: string;
}

/** Excel expression for the engine's tieredCharge(units, price, tiers, mode, floor). */
export function tierExpr(U: string, P: string, F: string, t: TierRef | null): string {
  if (!t || (t.from.length === 0 && t.disc.length <= 1 && t.disc[0] === '0')) return `IF(${U}<=0,0,${U}*${P})`;
  const band = (d: string) => `MAX(${P}*(1-${d}/100),${F})`;
  // graduated
  const parts: string[] = [];
  const bounds = ['0', ...t.from];
  for (let i = 0; i < bounds.length; i++) {
    const lo = bounds[i];
    const hi = bounds[i + 1];
    const inBand = hi ? `MAX(0,MIN(${U},${hi})-${lo})` : `MAX(0,${U}-${lo})`;
    parts.push(`${inBand}*${band(t.disc[i])}`);
  }
  // all units: discount of the highest band whose lower bound is below the units
  let d = t.disc[0];
  for (let i = 0; i < t.from.length; i++) d = `IF(${U}>${t.from[i]},${t.disc[i + 1]},${d})`;
  return `IF(${U}<=0,0,IF(${t.mode}="all_units",${U}*${band(d)},${parts.join('+')}))`;
}

const POOLS: CostPool[] = ['IMPLEMENTATION', ...RUN_POOLS];

export interface StreamRefs {
  stream: RevenueStream;
  col: number;
  key: string;
}

/** Writes a tier table and returns its references. */
function tierTable(w: WB, sh: SheetModel, r: number, title: string, tiers: VolumeTier[], mode: string, modeName: string): { ref: TierRef | null; next: number } {
  const ts = [...tiers].filter((t) => t.fromUnits >= 0).sort((a, b) => a.fromUnits - b.fromUnits);
  w.label(sh, r, 1, `${title} — tier mode`);
  w.input(sh, r, 2, mode, 'text', { list: ['graduated', 'all_units'] });
  w.book.define(modeName, sh, r, 2);
  r++;
  if (!ts.length) {
    w.note(sh, r, 1, 'No volume tiers — every unit is billed at the unit price.');
    return { ref: null, next: r + 1 };
  }
  w.header(sh, r++, 1, ['Band', 'From units (above)', 'Discount %']);
  const from: string[] = [];
  const disc: string[] = [];
  // Sheet-qualified: tier references are used from the Projection sheet too.
  const q = (rr: number, cc: number) => `${quoteSheet(sh.name)}!${ABS(rr, cc)}`;
  const zero = ts.find((t) => t.fromUnits === 0);
  w.label(sh, r, 1, 'Base band (from 0)');
  w.input(sh, r, 2, 0, 'count');
  w.input(sh, r, 3, zero ? zero.discountPct : 0, 'pct');
  disc.push(q(r, 3));
  r++;
  for (const t of ts.filter((x) => x.fromUnits !== 0)) {
    w.label(sh, r, 1, `Band ${from.length + 2}`);
    w.input(sh, r, 2, t.fromUnits, 'count');
    w.input(sh, r, 3, t.discountPct, 'pct');
    from.push(q(r, 2));
    disc.push(q(r, 3));
    r++;
  }
  w.note(sh, r++, 1, 'Keep bands in ascending order. Graduated: each band priced at its own discount; all units: every unit at the highest band reached. Never below the margin floor.');
  return { ref: { from, disc, mode: modeName }, next: r + 1 };
}

/**
 * Pricing sheet: cost-pool ownership by stream (no double recovery), unit
 * prices and fees for every stream, tiers, subscription allowance, and the
 * steady-state revenue lines (ARR basis).
 */
export function buildPricing(w: WB): void {
  const sh = w.s.pricing;
  const p = w.r.project;
  const pr = p.pricing;
  const book = w.book;
  const pb = w.r.priceBook;
  const streams = pr.streams.filter((s) => s.enabled);
  const { tiers, sub: subInfo } = state(w);
  w.title(sh, 'Pricing', 'Each cost pool is recovered by its first owning stream only. Unit price = recovered cost per unit ÷ (1 − target margin); fees = recovered monthly cost ÷ (1 − margin) × (1 − discount). Steady-state revenue is the first fully ramped month of year 1.');
  sh.width(1, 44);
  for (let c = 2; c <= 3 + 2 * streams.length; c++) sh.width(c, 16);
  sh.freeze = { row: 3, col: 1 };

  let r = 4;
  // ── Ownership matrix
  w.section(sh, r++, 'Cost recovery matrix (1 = stream recovers the pool)', 3 + 2 * streams.length);
  w.header(sh, r, 1, ['Cost pool', ...streams.map((s) => `Recovers — ${s.label}`), ...streams.map((s) => `Owner — ${s.label}`), 'Streams recovering', 'Monthly cost']);
  r++;
  const recCol = (k: number) => 2 + k;
  const ownCol = (k: number) => 2 + streams.length + k;
  const cntCol = 2 + 2 * streams.length;
  const costCol = cntCol + 1;
  const m0 = r;
  POOLS.forEach((pool, pi) => {
    const rr = m0 + pi;
    w.label(sh, rr, 1, POOL_LABELS[pool]);
    streams.forEach((s, k) => {
      w.input(sh, rr, recCol(k), s.recovers.includes(pool) ? 1 : 0, 'int');
      const left = k === 0 ? '0' : `SUM(${ABS(rr, recCol(0))}:${ABS(rr, recCol(k - 1))})`.replace(/\$/g, '');
      w.calc(sh, rr, ownCol(k), `IF(AND(${colName(recCol(k))}${rr}=1,${left}=0),1,0)`, 'int');
    });
    w.calc(sh, rr, cntCol, streams.length ? `SUM(${colName(recCol(0))}${rr}:${colName(recCol(streams.length - 1))}${rr})` : '0', 'int');
    if (pool === 'IMPLEMENTATION') w.calc(sh, rr, costCol, 'ImplCost', 'money');
    else w.calc(sh, rr, costCol, w.cell(w.pos('pool.total').sheet, w.pos('pool.total').r + pi - 1, w.pos('pool.total').c, sh), 'money');
  });
  const m1 = m0 + POOLS.length - 1;
  streams.forEach((s, k) => {
    w.put(`own.${s.id}.IMPLEMENTATION`, sh, m0, ownCol(k));
    w.put(`own.${s.id}.run`, sh, m0 + 1, ownCol(k), m1, ownCol(k));
    if (s.type === 'abu' || s.type === 'acu') {
      w.put(`own.${s.type}.IMPLEMENTATION`, sh, m0, ownCol(k));
      w.put(`own.${s.type}.run`, sh, m0 + 1, ownCol(k), m1, ownCol(k));
    }
  });
  r = m1 + 1;
  w.label(sh, r, 1, 'Pools recovered more than once (must be 0)', 'total');
  w.total(sh, r, cntCol, `COUNTIF(${colName(cntCol)}${m0}:${colName(cntCol)}${m1},">1")`, 'int');
  w.check(sh, r, cntCol, pb.issues.filter((i) => i.code === 'DOUBLE_RECOVERY').length, 'Pricing', 'Pools recovered more than once', 'int');
  r++;
  w.label(sh, r, 1, 'Pools with cost but no recovering stream', 'total');
  w.total(sh, r, cntCol, `SUMPRODUCT((${colName(cntCol)}${m0}:${colName(cntCol)}${m1}=0)*(${colName(costCol)}${m0}:${colName(costCol)}${m1}>0))`, 'int');
  w.check(sh, r, cntCol, pb.issues.filter((i) => i.code === 'UNRECOVERED_POOL').length, 'Pricing', 'Unrecovered pools', 'int');
  r += 2;

  // ── Stream prices
  const ownRun = (s: RevenueStream) => w.at(`own.${s.id}.run`, sh);
  const ownImpl = (s: RevenueStream) => w.at(`own.${s.id}.IMPLEMENTATION`, sh);
  const recurring = (s: RevenueStream) => `SUMPRODUCT(${ownRun(s)},PoolTotals)+IF(${ownImpl(s)}=1,ImplCost/MAX(1,TermMonths),0)`;
  const acuS = streams.find((s) => s.type === 'acu');
  const abuS = streams.find((s) => s.type === 'abu');

  const line = (label: string, f: string | (() => string), fmt: Fmt, key: string, engine?: number | { toNumber(): number }, area = 'Pricing') => {
    w.label(sh, r, 1, label);
    w.calc(sh, r, 2, f, fmt);
    w.put(key, sh, r, 2);
    if (engine !== undefined) w.check(sh, r, 2, engine, area, `${label}`, fmt);
    r++;
  };
  const inputLine = (label: string, v: string | number | null, fmt: Fmt, key: string, list?: string[]) => {
    w.label(sh, r, 1, label);
    w.input(sh, r, 2, v, fmt, list ? { list } : {});
    w.put(key, sh, r, 2);
    r++;
  };

  // Unit streams first (subscription allowance references their prices).
  const ordered = [...streams.filter((s) => s.type === 'acu' || s.type === 'abu' || s.type === 'fixed_fee'), ...streams.filter((s) => !['acu', 'abu', 'fixed_fee'].includes(s.type))];
  for (const s of ordered) {
    const sp = pb.streams.find((x) => x.streamId === s.id)!;
    w.section(sh, r++, `${s.label} (${s.type})`, 4);
    w.header(sh, r++, 1, ['Line', 'Value', 'Engine', 'Δ']);
    const k = `st.${s.id}`;
    inputLine('Target margin %', s.targetMarginPct, 'pct', `${k}.margin`);
    inputLine('Discount %', s.discountPct, 'pct', `${k}.disc`);
    const M = w.at(`${k}.margin`, sh);
    const Dd = w.at(`${k}.disc`, sh);
    if (s.type === 'fixed_fee') {
      inputLine('Use implementation plan price (Yes / No)', s.useImplementationPlanPrice === false ? 'No' : 'Yes', 'text', `${k}.usePlan`, ['Yes', 'No']);
      line('Recovered implementation cost', `IF(${ownImpl(s)}=1,ImplCost,0)`, 'money', `${k}.rec`, sp.recoveredCost);
      const rec = w.at(`${k}.rec`, sh);
      line('One-time fee', `IF(AND(${w.at(`${k}.usePlan`, sh)}<>"No",${ownImpl(s)}=1),ImplPrice,IF(${rec}=0,0,${rec}/(1-${M}/100)*(1-${Dd}/100)))`, 'money', `${k}.fee`, sp.oneTimeFee ?? 0);
    } else if (s.type === 'acu') {
      const rc = pr.acuRateCard;
      inputLine('Margin floor %', rc.marginFloorPct, 'pct', `${k}.floorPct`);
      inputLine('Negotiated price override (blank = derived)', rc.priceOverride ?? null, 'unit', `${k}.override`);
      inputLine('Minimum monthly commitment', rc.minMonthlyCommitment, 'money', `${k}.commit`);
      line('Recovered monthly cost', recurring(s), 'money', `${k}.rec`, sp.recoveredCost);
      line('ACUs per month (pricing basis)', 'AcuTotal', 'count2', `${k}.units`);
      const rec = w.at(`${k}.rec`, sh);
      const U = w.at(`${k}.units`, sh);
      line('Cost per ACU', `IF(${U}=0,0,${rec}/${U})`, 'unit', `${k}.cost`, sp.unitCost ?? 0);
      const C = w.at(`${k}.cost`, sh);
      line('List price per ACU', `IF(${U}=0,0,${C}/(1-${M}/100))`, 'unit', `${k}.list`, sp.listUnitPrice ?? 0);
      line('Floor price per ACU', `IF(${C}=0,0,${C}/(1-${w.at(`${k}.floorPct`, sh)}/100))`, 'unit', `${k}.floor`, sp.floorPrice ?? 0);
      const ov = w.at(`${k}.override`, sh);
      line('Price per ACU', `MAX(IF(ISNUMBER(${ov}),${ov},${w.at(`${k}.list`, sh)}*(1-${Dd}/100)),${w.at(`${k}.floor`, sh)})`, 'unit', `${k}.price`, sp.unitPrice ?? 0);
      book.define('AcuPrice', sh, w.pos(`${k}.price`).r, 2);
      book.define('AcuFloor', sh, w.pos(`${k}.floor`).r, 2);
      book.define('AcuCommit', sh, w.pos(`${k}.commit`).r, 2);
      const t = tierTable(w, sh, r, 'ACU volume tiers', rc.tiers, rc.tierMode, 'AcuTierMode');
      tiers.acu = t.ref;
      r = t.next;
    } else if (s.type === 'abu') {
      const rc = pr.abuRateCard;
      line('Recovered monthly cost (incl. absorbed failed work)', 'SUMPRODUCT(' + ownRun(s) + ',PoolTotals)+AbuImplPart', 'money', `${k}.rec`, sp.recoveredCost);
      line('Blended price per weighted ABU', 'AbuBlended', 'unit', `${k}.price`, sp.abu?.blendedPrice ?? 0);
      inputLine('Minimum weighted ABUs per month', rc.minMonthlyAbus, 'count', `${k}.min`);
      book.define('AbuMin', sh, w.pos(`${k}.min`).r, 2);
      w.note(sh, r++, 1, 'Per-workflow and per-class prices are derived on the ABU sheet.');
      const t = tierTable(w, sh, r, 'ABU volume tiers (applied to the blended price)', rc.tiers, rc.tierMode, 'AbuTierMode');
      tiers.abu = t.ref;
      r = t.next;
    } else if (s.type === 'fixed_monthly' || s.type === 'agentops') {
      line('Recovered monthly cost', recurring(s), 'money', `${k}.rec`, sp.recoveredCost);
      const rec = w.at(`${k}.rec`, sh);
      line('Monthly fee', `IF(${rec}=0,0,${rec}/(1-${M}/100)*(1-${Dd}/100))`, 'money', `${k}.fee`, sp.monthlyFee ?? 0);
    } else if (s.type === 'pass_through') {
      line('Recovered monthly cost (billed at actual)', recurring(s), 'money', `${k}.rec`, sp.recoveredCost);
      w.note(sh, r++, 1, 'Billed monthly at actual cost of the owned pools × (1 + pass-through markup).');
      p.workflows.forEach((_, i) => {
        line(`Owned variable cost per attempted (all pools) — workflow ${i + 1}`, `IF(${w.at(`abu.${i}.att`, sh)}=0,0,SUMPRODUCT(${ownRun(s)},${w.at(`pool.var.${i}`, sh)})/${w.at(`abu.${i}.att`, sh)})`, 'unit', `${k}.var.${i}`);
      });
      line('Owned fixed monthly cost', `SUMPRODUCT(${ownRun(s)},${w.at('pool.fixed', sh)})`, 'money', `${k}.fixed`);
      line('Owns LLM pool (1/0)', `INDEX(${ownRun(s)},1)`, 'int', `${k}.llm`);
    } else if (s.type === 'gainshare') {
      const g = pr.gainshare;
      line('Recovered monthly cost (at risk)', recurring(s), 'money', `${k}.rec`, sp.recoveredCost);
      inputLine('Share of benefits %', g.sharePct, 'pct', `${k}.share`);
      inputLine('Annual threshold before sharing', g.thresholdAnnual, 'money', `${k}.threshold`);
      inputLine('Annual cap (blank = none)', g.capAnnual ?? null, 'money', `${k}.cap`);
      inputLine('Benefit basis (validated / all)', g.basis, 'text', `${k}.basis`, ['validated', 'all']);
    } else if (s.type === 'subscription') {
      const sub = pr.subscription;
      const ss = sp.subscription!;
      line('Recovered monthly cost', recurring(s), 'money', `${k}.rec`, sp.recoveredCost);
      const rec = w.at(`${k}.rec`, sh);
      line('Platform fee', `IF(${rec}=0,0,${rec}/(1-${M}/100)*(1-${Dd}/100))`, 'money', `${k}.platform`, ss.platformFee);
      inputLine('Included unit (acu / abu / none)', sub.includedUnit, 'text', `${k}.unit`, ['acu', 'abu', 'none']);
      inputLine('Included quantity per month', sub.includedQty, 'count', `${k}.qtyIn`);
      inputLine('Allowance discount %', sub.includedDiscountPct, 'pct', `${k}.incDisc`);
      inputLine('Overage premium %', sub.overagePremiumPct, 'pct', `${k}.prem`);
      const unit = w.at(`${k}.unit`, sh);
      line('Included quantity (0 when none)', `IF(${unit}="none",0,${w.at(`${k}.qtyIn`, sh)})`, 'count', `${k}.qty`);
      const unitStream = sub.includedUnit === 'acu' ? acuS : sub.includedUnit === 'abu' ? abuS : undefined;
      if (sub.includedUnit !== 'none' && !unitStream) {
        const mc = sub.includedUnit === 'acu' ? w.r.marginal.perAcu : w.r.marginal.perAbu;
        w.label(sh, r, 1, `Marginal cost per ${sub.includedUnit.toUpperCase()} (engine value)`);
        w.engine(sh, r, 2, mc, 'unit', 'engine value: marginal cost from a 1% volume bump of the full cost model');
        w.put(`${k}.marginal`, sh, r, 2);
        r++;
      }
      const allowance =
        sub.includedUnit === 'none' ? '0' : unitStream ? (unitStream.type === 'acu' ? 'AcuPrice' : 'AbuBlended') : `IF(${w.at(`${k}.marginal`, sh)}=0,0,${w.at(`${k}.marginal`, sh)}/(1-${M}/100))`;
      line('Allowance unit price', allowance, 'unit', `${k}.allow`, ss.allowanceUnitPrice);
      const al = w.at(`${k}.allow`, sh);
      line('Included allowance value', unitStream ? `${w.at(`${k}.qty`, sh)}*${al}*(1-${w.at(`${k}.incDisc`, sh)}/100)` : '0', 'money', `${k}.included`, ss.includedValue);
      line('Overage rate per unit', `${al}*(1+${w.at(`${k}.prem`, sh)}/100)`, 'unit', `${k}.over`, ss.overageRate);
      line('Total subscription fee', `${w.at(`${k}.platform`, sh)}+${w.at(`${k}.included`, sh)}`, 'money', `${k}.total`, ss.totalFee);
      subInfo.stream = s;
      subInfo.overStream = unitStream ?? null;
    }
    r++;
  }

  // ── Steady-state revenue
  w.section(sh, r++, 'Steady-state monthly revenue (year 1, fully ramped — ARR basis)', 4);
  w.header(sh, r++, 1, ['Stream', 'Revenue', 'Engine', 'Δ']);
  const steadyRows: number[] = [];
  for (const s of streams) {
    if (s.type === 'fixed_fee') continue;
    w.label(sh, r, 1, s.label);
    w.calc(sh, r, 2, () => streamRevenue(w, sh, s, steadyCtx(w, sh)), 'money');
    w.check(sh, r, 2, w.r.steady.revenueByStream[s.id] ?? 0, 'Pricing', `Steady revenue — ${s.label}`, 'money');
    steadyRows.push(r);
    r++;
  }
  w.label(sh, r, 1, 'Monthly recurring revenue (MRR)', 'total');
  w.total(sh, r, 2, steadyRows.length ? steadyRows.map((x) => `B${x}`).join('+') : '0', 'money');
  w.check(sh, r, 2, w.r.steady.recurringRevenue, 'Pricing', 'Steady monthly recurring revenue', 'money');
  book.define('SteadyMRR', sh, r, 2);
  r++;
  w.label(sh, r, 1, 'Annual recurring revenue (ARR)', 'total');
  w.total(sh, r, 2, 'SteadyMRR*12', 'money');
  w.check(sh, r, 2, w.r.economics.provider.arr, 'Pricing', 'ARR', 'money');
  r++;
  w.label(sh, r, 1, 'Steady-state run cost');
  w.calc(sh, r, 2, 'RunCost', 'money');
  r++;
  w.label(sh, r, 1, 'Steady-state run margin %');
  w.calc(sh, r, 2, 'IF(SteadyMRR=0,0,(SteadyMRR-RunCost)/SteadyMRR*100)', 'pct');
  w.check(sh, r, 2, w.r.economics.provider.steadyMarginPct, 'Pricing', 'Steady-state run margin', 'pct');
}

interface PricingState {
  tiers: { acu: TierRef | null; abu: TierRef | null };
  sub: { stream: RevenueStream | null; overStream: RevenueStream | null };
}
const STATE = new WeakMap<WB, PricingState>();
function state(w: WB): PricingState {
  let st = STATE.get(w);
  if (!st) {
    st = { tiers: { acu: null, abu: null }, sub: { stream: null, overStream: null } };
    STATE.set(w, st);
  }
  return st;
}

/** Inputs a revenue formula needs for one month (or for the steady state). */
export interface RevCtx {
  esc: string;
  acus: string;
  wabus: string;
  /** ABU raw revenue before escalation (Σ workflows attempted × revenue per attempted). */
  abuRaw: string;
  /** Owned pool cost for a pass-through stream this month. */
  passCost: (s: RevenueStream) => string;
  /** Lazily resolved (the Value & ROI sheet is laid out after Pricing / Projection). */
  validated: () => string;
  forecast: () => string;
}

function steadyCtx(w: WB, sh: SheetModel): RevCtx {
  return {
    esc: '1',
    acus: 'AcuTotal',
    wabus: 'WeightedAbus',
    abuRaw: w.r.priceBook.streams.some((s) => s.type === 'abu') ? 'AbuRevBasis' : '0',
    passCost: (s) => `SUMPRODUCT(${w.at(`own.${s.id}.run`, sh)},PoolTotals)`,
    validated: () => w.at('val.steady.validated', sh),
    forecast: () => w.at('val.steady.forecast', sh),
  };
}

/** Revenue of one recurring stream in a run month (mirrors the engine's revenueForMonth). */
export function streamRevenue(w: WB, sh: SheetModel, s: RevenueStream, x: RevCtx): string {
  const k = `st.${s.id}`;
  const at = (key: string) => w.at(key, sh);
  const { tiers, sub: subInfo } = state(w);
  const sub = subInfo.stream;
  const subK = sub ? `st.${sub.id}` : '';
  switch (s.type) {
    case 'fixed_fee':
      return '0';
    case 'fixed_monthly':
    case 'agentops':
      return `${at(`${k}.fee`)}*${x.esc}`;
    case 'pass_through':
      return `${x.passCost(s)}*(1+PassThroughMarkupPct/100)`;
    case 'gainshare': {
      const ben = `IF(${at(`${k}.basis`)}="validated",${x.validated()},${x.forecast()})`;
      const amt = `MAX(0,${ben}-${at(`${k}.threshold`)}/12)*${at(`${k}.share`)}/100`;
      // The engine applies any non-null cap (a Decimal zero is still a cap).
      return `IF(ISNUMBER(${at(`${k}.cap`)}),MIN(${amt},${at(`${k}.cap`)}/12),${amt})`;
    }
    case 'subscription': {
      const platform = `${at(`${k}.platform`)}*${x.esc}`;
      if (subInfo.overStream || w.r.project.pricing.subscription.includedUnit === 'none') return platform;
      const units = `IF(${at(`${k}.unit`)}="acu",${x.acus},${x.wabus})`;
      return `${platform}+MAX(0,${units}-${at(`${k}.qty`)})*${at(`${k}.over`)}*${x.esc}`;
    }
    case 'acu': {
      if (sub && subInfo.overStream?.id === s.id) return `(${at(`${subK}.included`)}+MAX(0,${x.acus}-${at(`${subK}.qty`)})*${at(`${subK}.over`)})*${x.esc}`;
      const usage = tierExpr(x.acus, `AcuPrice*${x.esc}`, `AcuFloor*${x.esc}`, tiers.acu);
      return `MAX(${usage},AcuCommit*${x.esc})`;
    }
    case 'abu': {
      if (sub && subInfo.overStream?.id === s.id) return `(${at(`${subK}.included`)}+MAX(0,${x.wabus}-${at(`${subK}.qty`)})*${at(`${subK}.over`)})*${x.esc}`;
      const raw = `(${x.abuRaw})*${x.esc}`;
      const billed = tiers.abu ? `IF(${x.wabus}>0,${tierExpr(x.wabus, `(${raw})/${x.wabus}`, '0', tiers.abu)},${raw})` : raw;
      return `${billed}+IF(AbuMin>${x.wabus},(AbuMin-${x.wabus})*AbuBlended*${x.esc},0)`;
    }
  }
}

export { colName };
