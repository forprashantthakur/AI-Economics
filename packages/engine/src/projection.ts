/**
 * Contract-term projection: month 0 (implementation) + run months 1..T,
 * yearly roll-ups, provider economics and client ROI / NPV / payback.
 */
import { D, Decimal, ZERO, marginPct, safeDiv, sum } from './decimal';
import type { BenefitCategory, Catalog, CostPool, Project } from './types';
import { RUN_POOLS } from './types';
import { buildSnapshot, rampFactorFor, yearIndexFor, type RunSnapshot } from './model';
import { computeValueMonth, countedBenefit, clientCostForMonth, emptyCategories, npv, paybackMonths, type ValueMonth } from './value';
import { costByStream, revenueForMonth, type PriceBook, type RevenueLine } from './pricing';
import type { ImplementationResult } from './implementation';

export interface MonthBase {
  month: number;
  yearIndex: number;
  rampFactor: number;
  period: string;
  snapshot: RunSnapshot | null;
  value: ValueMonth | null;
  clientCost: Decimal;
}

export interface MonthRow {
  month: number;
  period: string;
  yearIndex: number;
  rampFactor: number;
  attempted: Decimal;
  accepted: Decimal;
  weightedAbus: Decimal;
  acus: Decimal;
  llmCost: Decimal;
  runCost: Decimal;
  implementationCost: Decimal;
  totalCost: Decimal;
  costByPool: Record<CostPool, Decimal>;
  revenueLines: RevenueLine[];
  revenue: Decimal;
  recurringRevenue: Decimal;
  grossProfit: Decimal;
  costByStream: Record<string, Decimal>;
  revenueByStream: Record<string, Decimal>;
  validatedBenefit: Decimal;
  forecastBenefit: Decimal;
  countedBenefit: Decimal;
  benefitByCategory: Record<BenefitCategory, Decimal>;
  productivityValue: Decimal;
  hoursSaved: Decimal;
  fteReleased: Decimal;
  clientInternalCost: Decimal;
  clientInvestment: Decimal;
  clientNet: Decimal;
  clientCumulative: Decimal;
}

export interface YearSummary {
  year: number;
  label: string;
  revenue: Decimal;
  recurringRevenue: Decimal;
  oneTimeRevenue: Decimal;
  cost: Decimal;
  runCost: Decimal;
  llmCost: Decimal;
  grossProfit: Decimal;
  marginPct: Decimal;
  attempted: Decimal;
  accepted: Decimal;
  weightedAbus: Decimal;
  acus: Decimal;
  countedBenefit: Decimal;
  validatedBenefit: Decimal;
  forecastBenefit: Decimal;
  productivityValue: Decimal;
  hoursSaved: Decimal;
  clientInvestment: Decimal;
  clientNet: Decimal;
  roiPct: Decimal;
}

export interface Economics {
  provider: {
    tcv: Decimal;
    acv: Decimal;
    oneTimeRevenue: Decimal;
    recurringRevenue: Decimal;
    mrr: Decimal;
    arr: Decimal;
    totalCost: Decimal;
    grossProfit: Decimal;
    marginPct: Decimal;
    steadyRunCost: Decimal;
    steadyMarginPct: Decimal;
    revenuePerAgent: Decimal;
    revenuePerWorkflow: Decimal;
    costToServeMonthly: Decimal;
    costToServePerAbu: Decimal;
  };
  client: {
    totalInvestment: Decimal;
    countedBenefits: Decimal;
    validatedBenefits: Decimal;
    forecastBenefits: Decimal;
    netBenefit: Decimal;
    roiPct: Decimal;
    year1RoiPct: Decimal;
    paybackMonths: number | null;
    npv: Decimal;
    costPerOutcome: Decimal;
    productivityValue: Decimal;
    hoursSaved: Decimal;
    steadyFteReleased: Decimal;
    steadyHoursSaved: Decimal;
    steadyProductivityValue: Decimal;
  };
}

export interface Steady {
  snapshot: RunSnapshot;
  value: ValueMonth;
  revenueLines: RevenueLine[];
  revenue: Decimal;
  recurringRevenue: Decimal;
  runCost: Decimal;
  grossProfit: Decimal;
  marginPct: Decimal;
  costByStream: Record<string, Decimal>;
  revenueByStream: Record<string, Decimal>;
}

export interface ProjectionResult {
  months: MonthRow[];
  years: YearSummary[];
  economics: Economics;
  steady: Steady;
}

export interface ProjectionContext {
  project: Project;
  catalog: Catalog;
  impl: ImplementationResult;
  baseline: RunSnapshot;
  steadyValue: ValueMonth;
  bases: MonthBase[];
}

export function addMonths(yyyymm: string, n: number): string {
  const [y, m] = (yyyymm || '2026-01').split('-').map(Number);
  const idx = y * 12 + (m - 1) + n;
  return `${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, '0')}`;
}

export function buildContext(project: Project, catalog: Catalog, impl: ImplementationResult, benefitVolumeBase?: Decimal): ProjectionContext {
  const cache = new Map<string, RunSnapshot>();
  const snap = (rampFactor: number, yearIndex: number) => {
    const key = `${rampFactor}|${yearIndex}`;
    if (!cache.has(key)) cache.set(key, buildSnapshot(project, catalog, { rampFactor, yearIndex }));
    return cache.get(key)!;
  };
  const baseline = snap(1, 0);
  const baseAttempted = benefitVolumeBase ?? baseline.totals.attempted;
  const steadyValue = computeValueMonth(project, catalog, baseline, 'steady', baseAttempted);
  const T = Math.max(1, project.pricing.termMonths);
  const bases: MonthBase[] = [];
  for (let m = 0; m <= T; m++) {
    if (m === 0) {
      bases.push({ month: 0, yearIndex: 0, rampFactor: 0, period: addMonths(project.goLiveDate, -1), snapshot: null, value: null, clientCost: clientCostForMonth(project, catalog, 0) });
      continue;
    }
    const rampFactor = rampFactorFor(m, project.pricing.rampMonths, project.pricing.rampStartPct);
    const yearIndex = yearIndexFor(m);
    const s = snap(rampFactor, yearIndex);
    bases.push({
      month: m,
      yearIndex,
      rampFactor,
      period: addMonths(project.goLiveDate, m - 1),
      snapshot: s,
      value: computeValueMonth(project, catalog, s, m, baseAttempted),
      clientCost: clientCostForMonth(project, catalog, m),
    });
  }
  return { project, catalog, impl, baseline, steadyValue, bases };
}

const zeroPools = (): Record<CostPool, Decimal> => ({ IMPLEMENTATION: ZERO, LLM: ZERO, ORCHESTRATION: ZERO, RAG: ZERO, DOCUMENT: ZERO, INFRASTRUCTURE: ZERO, AGENTOPS: ZERO, HUMAN_REVIEW: ZERO, OTHER: ZERO });

function byStream(lines: RevenueLine[]): Record<string, Decimal> {
  const out: Record<string, Decimal> = {};
  for (const l of lines) out[l.streamId] = (out[l.streamId] ?? ZERO).plus(l.amount);
  return out;
}

export function runProjection(ctx: ProjectionContext, book: PriceBook): ProjectionResult {
  const { project, impl, baseline, steadyValue, bases } = ctx;
  const pr = project.pricing;
  let cumulative = ZERO;
  const months: MonthRow[] = bases.map((b) => {
    const s = b.snapshot;
    const v = b.value;
    const validated = v?.validated ?? ZERO;
    const forecast = v?.forecast ?? ZERO;
    const lines = revenueForMonth(book, {
      month: b.month,
      yearIndex: b.yearIndex,
      snapshot: s ?? baseline,
      validatedBenefit: validated,
      forecastBenefit: forecast,
      abuRateCard: pr.abuRateCard,
      acuRateCard: pr.acuRateCard,
    });
    const revenue = sum(lines.map((l) => l.amount));
    const recurringRevenue = sum(lines.filter((l) => l.recurring).map((l) => l.amount));
    const costByPool = s ? { ...s.pools } : zeroPools();
    const implementationCost = b.month === 0 ? impl.totalCost : ZERO;
    if (b.month === 0) costByPool.IMPLEMENTATION = impl.totalCost;
    const runCost = s ? s.totalRunCost : ZERO;
    const totalCost = runCost.plus(implementationCost);
    const counted = v ? countedBenefit(project, v) : ZERO;
    const clientInvestment = revenue.plus(b.clientCost);
    const clientNet = counted.minus(clientInvestment);
    cumulative = cumulative.plus(clientNet);
    return {
      month: b.month,
      period: b.period,
      yearIndex: b.yearIndex,
      rampFactor: b.rampFactor,
      attempted: s?.totals.attempted ?? ZERO,
      accepted: s?.totals.accepted ?? ZERO,
      weightedAbus: s?.totals.weightedAbus ?? ZERO,
      acus: s?.acu.total ?? ZERO,
      llmCost: s?.llm.total ?? ZERO,
      runCost,
      implementationCost,
      totalCost,
      costByPool,
      revenueLines: lines,
      revenue,
      recurringRevenue,
      grossProfit: revenue.minus(totalCost),
      costByStream: costByStream(book, s?.pools ?? zeroPools(), impl.totalCost, b.month),
      revenueByStream: byStream(lines),
      validatedBenefit: validated,
      forecastBenefit: forecast,
      countedBenefit: counted,
      benefitByCategory: v ? (project.value.includeUnvalidated ? v.forecastByCategory : v.validatedByCategory) : emptyCategories(),
      productivityValue: v?.productivityValue ?? ZERO,
      hoursSaved: v?.hoursSaved ?? ZERO,
      fteReleased: v?.fteReleased ?? ZERO,
      clientInternalCost: b.clientCost,
      clientInvestment,
      clientNet,
      clientCumulative: cumulative,
    };
  });

  // Year roll-ups (year 1 includes month 0 implementation).
  const nYears = Math.ceil((months.length - 1) / 12);
  const years: YearSummary[] = [];
  for (let y = 0; y < nYears; y++) {
    const rows = months.filter((r) => (r.month === 0 ? y === 0 : r.yearIndex === y));
    const revenue = sum(rows.map((r) => r.revenue));
    const cost = sum(rows.map((r) => r.totalCost));
    const inv = sum(rows.map((r) => r.clientInvestment));
    const counted = sum(rows.map((r) => r.countedBenefit));
    years.push({
      year: y + 1,
      label: `Year ${y + 1}`,
      revenue,
      recurringRevenue: sum(rows.map((r) => r.recurringRevenue)),
      oneTimeRevenue: revenue.minus(sum(rows.map((r) => r.recurringRevenue))),
      cost,
      runCost: sum(rows.map((r) => r.runCost)),
      llmCost: sum(rows.map((r) => r.llmCost)),
      grossProfit: revenue.minus(cost),
      marginPct: marginPct(revenue, cost),
      attempted: sum(rows.map((r) => r.attempted)),
      accepted: sum(rows.map((r) => r.accepted)),
      weightedAbus: sum(rows.map((r) => r.weightedAbus)),
      acus: sum(rows.map((r) => r.acus)),
      countedBenefit: counted,
      validatedBenefit: sum(rows.map((r) => r.validatedBenefit)),
      forecastBenefit: sum(rows.map((r) => r.forecastBenefit)),
      productivityValue: sum(rows.map((r) => r.productivityValue)),
      hoursSaved: sum(rows.map((r) => r.hoursSaved)),
      clientInvestment: inv,
      clientNet: counted.minus(inv),
      roiPct: safeDiv(counted.minus(inv), inv).times(100),
    });
  }

  // Steady-state month (contract year 1, fully ramped).
  const steadyLines = revenueForMonth(book, {
    month: 1,
    yearIndex: 0,
    snapshot: baseline,
    validatedBenefit: steadyValue.validated,
    forecastBenefit: steadyValue.forecast,
    abuRateCard: pr.abuRateCard,
    acuRateCard: pr.acuRateCard,
  });
  const steadyRevenue = sum(steadyLines.map((l) => l.amount));
  const steady: Steady = {
    snapshot: baseline,
    value: steadyValue,
    revenueLines: steadyLines,
    revenue: steadyRevenue,
    recurringRevenue: sum(steadyLines.filter((l) => l.recurring).map((l) => l.amount)),
    runCost: baseline.totalRunCost,
    grossProfit: steadyRevenue.minus(baseline.totalRunCost),
    marginPct: marginPct(steadyRevenue, baseline.totalRunCost),
    costByStream: costByStream(book, baseline.pools, impl.totalCost, 1),
    revenueByStream: byStream(steadyLines),
  };

  const tcv = sum(months.map((r) => r.revenue));
  const totalCost = sum(months.map((r) => r.totalCost));
  const recurring = sum(months.map((r) => r.recurringRevenue));
  const termYears = D(Math.max(1, pr.termMonths)).div(12);
  const acv = safeDiv(tcv, termYears);
  const totalInvestment = sum(months.map((r) => r.clientInvestment));
  const countedTotal = sum(months.map((r) => r.countedBenefit));
  const flows = months.map((r) => r.clientNet);
  const accepted = sum(months.map((r) => r.accepted));

  const economics: Economics = {
    provider: {
      tcv,
      acv,
      oneTimeRevenue: tcv.minus(recurring),
      recurringRevenue: recurring,
      mrr: steady.recurringRevenue,
      arr: steady.recurringRevenue.times(12),
      totalCost,
      grossProfit: tcv.minus(totalCost),
      marginPct: marginPct(tcv, totalCost),
      steadyRunCost: baseline.totalRunCost,
      steadyMarginPct: steady.marginPct,
      revenuePerAgent: safeDiv(acv, project.agents.length),
      revenuePerWorkflow: safeDiv(acv, project.workflows.length),
      costToServeMonthly: baseline.totalRunCost,
      costToServePerAbu: safeDiv(baseline.totalRunCost, baseline.totals.weightedAbus),
    },
    client: {
      totalInvestment,
      countedBenefits: countedTotal,
      validatedBenefits: sum(months.map((r) => r.validatedBenefit)),
      forecastBenefits: sum(months.map((r) => r.forecastBenefit)),
      netBenefit: countedTotal.minus(totalInvestment),
      roiPct: safeDiv(countedTotal.minus(totalInvestment), totalInvestment).times(100),
      year1RoiPct: years[0]?.roiPct ?? ZERO,
      paybackMonths: paybackMonths(flows),
      npv: npv(flows, project.value.discountRatePct),
      costPerOutcome: safeDiv(totalInvestment, accepted),
      productivityValue: sum(months.map((r) => r.productivityValue)),
      hoursSaved: sum(months.map((r) => r.hoursSaved)),
      steadyFteReleased: steadyValue.fteReleased,
      steadyHoursSaved: steadyValue.hoursSaved,
      steadyProductivityValue: steadyValue.productivityValue,
    },
  };
  return { months, years, economics, steady };
}

export { RUN_POOLS };
