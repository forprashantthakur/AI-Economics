/**
 * Module 8 — AI value realization.
 *
 * Productivity value ≠ realized cash savings. Released hours are reported as
 * productivity (non-cash). Only explicit benefit lines count as financial
 * benefits, and by default only those Finance has validated (or realized).
 *
 * Double counting is prevented by:
 *  - overlap groups: lines in the same group are alternatives — only the largest counts each month;
 *  - capacity-conversion lines are capped at the productivity value they convert;
 *  - review effort is either a provider cost (managed service) or client time, never both.
 */
import { D, Decimal, ONE, ZERO, compound, pct, safeDiv, sum, min, addTo } from './decimal';
import type { BenefitCategory, BenefitLine, Catalog, Project } from './types';
import type { RunSnapshot } from './model';
import { convert } from './fx';

export interface ProductivityResult {
  workflowId: string;
  hoursBefore: Decimal;
  hoursAfter: Decimal;
  hoursSaved: Decimal;
  fteReleased: Decimal;
  productivityValue: Decimal;
  improvementPct: Decimal;
}

export interface BenefitLineMonth {
  lineId: string;
  name: string;
  category: BenefitCategory;
  status: BenefitLine['status'];
  gross: Decimal;
  /** Amount counted after overlap and capacity-conversion caps (forecast view). */
  countedForecast: Decimal;
  /** Amount counted in the validated view. */
  countedValidated: Decimal;
  excludedReason: string | null;
}

export interface ValueMonth {
  productivity: ProductivityResult[];
  hoursSaved: Decimal;
  fteReleased: Decimal;
  productivityValue: Decimal;
  lines: BenefitLineMonth[];
  validated: Decimal;
  forecast: Decimal;
  validatedByCategory: Record<BenefitCategory, Decimal>;
  forecastByCategory: Record<BenefitCategory, Decimal>;
}

const COUNTED_VALIDATED = new Set(['finance_validated', 'realized']);
const COUNTED_FORECAST = new Set(['finance_validated', 'realized', 'proposed']);

export function emptyCategories(): Record<BenefitCategory, Decimal> {
  return { hard_savings: ZERO, cost_avoidance: ZERO, revenue: ZERO, working_capital: ZERO, capacity_conversion: ZERO };
}

export function productivityFor(project: Project, catalog: Catalog, snap: RunSnapshot): ProductivityResult[] {
  const inflation = compound(project.pricing.costInflationPct, snap.yearIndex);
  return project.value.productivity
    .filter((p) => snap.volumes[p.workflowId])
    .map((p) => {
      const v = snap.volumes[p.workflowId];
      const wf = project.workflows.find((w) => w.id === p.workflowId)!;
      const manual = D(p.manualMinutesBefore);
      const spot = D(p.spotCheckMinutesAutonomous);
      const hoursBefore = v.attempted.times(manual).div(60);
      const clientReview = snap.clientReviewHoursByWorkflow[p.workflowId] ?? ZERO;
      const assistedHours = wf.humanReview.borneBy === 'client' ? clientReview : v.humanAssisted.times(spot).div(60);
      const fallbackHours = v.failed.plus(v.rejected).times(manual).div(60);
      const hoursAfter = v.autonomous.times(spot).div(60).plus(assistedHours).plus(fallbackHours);
      const hoursSaved = hoursBefore.minus(hoursAfter);
      const rate = convert(p.loadedHourlyCost, p.currency, project.currency, catalog.fx).times(inflation);
      return {
        workflowId: p.workflowId,
        hoursBefore,
        hoursAfter,
        hoursSaved,
        fteReleased: safeDiv(hoursSaved, p.productiveHoursPerFteMonth),
        productivityValue: hoursSaved.times(rate),
        improvementPct: safeDiv(hoursSaved, hoursBefore).times(100),
      };
    });
}

/** Ramp of an individual benefit line (0 before start, linear to 1 over rampMonths). */
export function benefitRamp(line: BenefitLine, month: number | 'steady'): Decimal {
  if (month === 'steady') return ONE;
  if (month < line.startMonth) return ZERO;
  if (!line.rampMonths || line.rampMonths <= 0) return ONE;
  const k = month - line.startMonth + 1;
  return k >= line.rampMonths ? ONE : D(k).div(line.rampMonths);
}

export function computeValueMonth(
  project: Project,
  catalog: Catalog,
  snap: RunSnapshot,
  month: number | 'steady',
  baselineAttempted: Decimal,
): ValueMonth {
  const productivity = productivityFor(project, catalog, snap);
  const productivityValue = sum(productivity.map((p) => p.productivityValue));
  const volumeIndex = safeDiv(snap.totals.attempted, baselineAttempted);
  const inflation = compound(project.pricing.costInflationPct, snap.yearIndex);

  const gross = project.value.benefits.map((b) => {
    if (month !== 'steady' && month <= 0) return ZERO;
    const monthly = convert(b.annualAmount, b.currency, project.currency, catalog.fx).div(12);
    const vol = b.scalesWithVolume ? volumeIndex : ONE;
    const infl = b.category === 'revenue' ? ONE : inflation;
    return monthly.times(benefitRamp(b, month)).times(pct(b.confidencePct)).times(vol).times(infl);
  });

  const view = (allowed: Set<string>) => {
    const counted = project.value.benefits.map((b, i) => (allowed.has(b.status) ? gross[i] : ZERO));
    const reasons: (string | null)[] = project.value.benefits.map((b) =>
      b.status === 'rejected' ? 'Rejected by Finance' : allowed.has(b.status) ? null : 'Not finance-validated',
    );
    // Capacity conversion cannot exceed the productivity value it converts.
    const capIdx = project.value.benefits.map((b, i) => (b.category === 'capacity_conversion' && counted[i].gt(0) ? i : -1)).filter((i) => i >= 0);
    const capTotal = sum(capIdx.map((i) => counted[i]));
    const cap = productivityValue.gt(0) ? productivityValue : ZERO;
    if (capTotal.gt(cap)) {
      const f = safeDiv(cap, capTotal);
      for (const i of capIdx) {
        counted[i] = counted[i].times(f);
        reasons[i] = 'Capped at released productivity value';
      }
    }
    // Overlap groups: keep only the largest line per group.
    const groups = new Map<string, number[]>();
    project.value.benefits.forEach((b, i) => {
      if (b.overlapGroup) groups.set(b.overlapGroup, [...(groups.get(b.overlapGroup) ?? []), i]);
    });
    for (const idx of groups.values()) {
      if (idx.length < 2) continue;
      let best = idx[0];
      for (const i of idx) if (counted[i].gt(counted[best])) best = i;
      for (const i of idx)
        if (i !== best && counted[i].gt(0)) {
          counted[i] = ZERO;
          reasons[i] = `Overlaps "${project.value.benefits[best].name}" (group ${project.value.benefits[i].overlapGroup})`;
        }
    }
    return { counted, reasons };
  };
  const fv = view(COUNTED_FORECAST);
  const vv = view(COUNTED_VALIDATED);
  const validatedByCategory = emptyCategories();
  const forecastByCategory = emptyCategories();
  const lines: BenefitLineMonth[] = project.value.benefits.map((b, i) => {
    addTo(validatedByCategory, b.category, vv.counted[i]);
    addTo(forecastByCategory, b.category, fv.counted[i]);
    return {
      lineId: b.id,
      name: b.name,
      category: b.category,
      status: b.status,
      gross: gross[i],
      countedForecast: fv.counted[i],
      countedValidated: vv.counted[i],
      excludedReason: vv.reasons[i] ?? fv.reasons[i],
    };
  });
  return {
    productivity,
    hoursSaved: sum(productivity.map((p) => p.hoursSaved)),
    fteReleased: sum(productivity.map((p) => p.fteReleased)),
    productivityValue,
    lines,
    validated: sum(vv.counted),
    forecast: sum(fv.counted),
    validatedByCategory,
    forecastByCategory,
  };
}

/** Benefit counted in ROI for a month under the project's view setting. */
export function countedBenefit(project: Project, vm: ValueMonth): Decimal {
  return project.value.includeUnvalidated ? vm.forecast : vm.validated;
}

export function clientCostForMonth(project: Project, catalog: Catalog, month: number): Decimal {
  const infl = compound(project.pricing.costInflationPct, Math.max(0, Math.floor((month - 1) / 12)));
  return sum(
    project.value.clientCosts.map((c) => {
      const amt = convert(c.amount, c.currency, project.currency, catalog.fx);
      if (c.type === 'one_time') return month === 0 ? amt : ZERO;
      return month >= 1 ? amt.times(infl) : ZERO;
    }),
  );
}

/** Net present value of monthly cash flows (index 0 = today) at an annual discount rate. */
export function npv(flows: Decimal[], annualRatePct: number): Decimal {
  const r = ONE.plus(pct(annualRatePct));
  return sum(flows.map((f, m) => f.div(r.pow(D(m).div(12)))));
}

/**
 * Months until cumulative net cash flow turns non-negative and stays there
 * (fractional, linear interpolation within the crossing month). Returns 0 if
 * the cumulative position is never negative, null if it is still negative at
 * the end of the horizon.
 */
export function paybackMonths(flows: Decimal[]): number | null {
  const cum: Decimal[] = [];
  let acc = ZERO;
  for (const f of flows) {
    acc = acc.plus(f);
    cum.push(acc);
  }
  let lastNeg = -1;
  for (let m = 0; m < cum.length; m++) if (cum[m].lt(0)) lastNeg = m;
  if (lastNeg === -1) return 0;
  if (lastNeg === cum.length - 1) return null;
  const m = lastNeg + 1;
  const frac = safeDiv(cum[lastNeg].neg(), flows[m]);
  return D(lastNeg).plus(min(frac, ONE)).toNumber();
}
