/**
 * Module 9 — scenario simulator: what-if overrides, presets, cost waterfall,
 * sensitivity (tornado) and break-even volume.
 *
 * By default contracted prices stay locked while costs move, which is what a
 * provider actually experiences; set repriceAtTargetMargin to re-derive prices.
 */
import { D, Decimal, ONE, ZERO, safeDiv, sum } from './decimal';
import type { Catalog, ModelRoute, Project, ScenarioOverrides } from './types';
import { buildSnapshot } from './model';
import { computeValueMonth } from './value';
import { revenueForMonth, type PriceBook } from './pricing';
import { computeProject, withFxFallback, type ProjectResult } from './compute';

export const SCENARIO_PRESETS: Record<'baseline' | 'optimized' | 'stress', { name: string; description: string; overrides: ScenarioOverrides }> = {
  baseline: { name: 'Baseline', description: 'Assumptions as estimated.', overrides: {} },
  optimized: {
    name: 'Optimized',
    description: 'Prompt compression, higher cache hit rate, fewer retries, better first-pass success and leaner AgentOps.',
    overrides: {
      inputTokenMultiplier: 0.85,
      outputTokenMultiplier: 0.9,
      cacheHitDeltaPp: 15,
      retryMultiplier: 0.5,
      successRateDeltaPp: 2,
      humanInterventionDeltaPp: -3,
      agentOpsMultiplier: 0.9,
    },
  },
  stress: {
    name: 'Stress',
    description: 'Volume surge, heavier prompts, double retries, lower success and more human intervention on a harder mix.',
    overrides: {
      volumeMultiplier: 1.4,
      inputTokenMultiplier: 1.3,
      outputTokenMultiplier: 1.25,
      retryMultiplier: 2,
      successRateDeltaPp: -5,
      humanInterventionDeltaPp: 8,
      complexityShiftPp: 10,
      infraMultiplier: 1.2,
      agentOpsMultiplier: 1.15,
    },
  },
};

const clampPct = (v: number) => Math.min(100, Math.max(0, v));

function mergeRoutes(routes: ModelRoute[]): ModelRoute[] {
  const m = new Map<string, number>();
  for (const r of routes) m.set(r.modelId, (m.get(r.modelId) ?? 0) + r.sharePct);
  return [...m.entries()].filter(([, s]) => s > 1e-9).map(([modelId, sharePct]) => ({ modelId, sharePct }));
}

/** Pure: returns a modified deep copy of the project. */
export function applyScenario(project: Project, o: ScenarioOverrides): Project {
  const p: Project = structuredClone(project);
  const vol = o.volumeMultiplier ?? 1;
  const inM = o.inputTokenMultiplier ?? 1;
  const outM = o.outputTokenMultiplier ?? 1;
  for (const wf of p.workflows) {
    wf.monthlyVolume *= vol;
    if (o.growthPct !== null && o.growthPct !== undefined) wf.annualGrowthPct = o.growthPct;
    if (o.retryRatePct !== null && o.retryRatePct !== undefined) wf.retryRatePct = Math.max(0, o.retryRatePct);
    if (o.retryMultiplier !== undefined) wf.retryRatePct = Math.max(0, wf.retryRatePct * o.retryMultiplier);
    if (o.successRateDeltaPp) wf.successRatePct = clampPct(wf.successRatePct + o.successRateDeltaPp);
    if (o.humanInterventionDeltaPp) wf.humanInterventionRatePct = clampPct(wf.humanInterventionRatePct + o.humanInterventionDeltaPp);
    if (o.complexityShiftPp && wf.complexity.length > 1) {
      const sorted = [...wf.complexity].sort((a, b) => a.abuWeight - b.abuWeight);
      const simple = sorted[0];
      const complex = sorted[sorted.length - 1];
      const shift = o.complexityShiftPp > 0 ? Math.min(o.complexityShiftPp, simple.sharePct) : -Math.min(-o.complexityShiftPp, complex.sharePct);
      simple.sharePct -= shift;
      complex.sharePct += shift;
    }
    for (const st of wf.llmSteps) {
      st.inputTokens *= inM;
      st.cacheablePrefixTokens *= inM;
      st.outputTokens *= outM;
      st.reasoningTokens *= outM;
      if (st.cacheablePrefixTokens > 0) {
        if (o.cacheHitRatePct !== null && o.cacheHitRatePct !== undefined) st.cacheHitRatePct = clampPct(o.cacheHitRatePct);
        if (o.cacheHitDeltaPp) st.cacheHitRatePct = clampPct(st.cacheHitRatePct + o.cacheHitDeltaPp);
      }
      if (o.modelSwap) st.routing = mergeRoutes(st.routing.map((r) => (r.modelId === o.modelSwap!.fromModelId ? { ...r, modelId: o.modelSwap!.toModelId } : r)));
      if (o.routingShift && o.routingShift.sharePct > 0) {
        const s = Math.min(100, o.routingShift.sharePct) / 100;
        const total = st.routing.reduce((a, r) => a + r.sharePct, 0) || 100;
        st.routing = mergeRoutes([...st.routing.map((r) => ({ ...r, sharePct: (r.sharePct / total) * 100 * (1 - s) })), { modelId: o.routingShift.toModelId, sharePct: 100 * s }]);
      }
    }
  }
  for (const l of p.costLines) {
    const k = l.category === 'INFRASTRUCTURE' ? o.infraMultiplier ?? 1 : l.category === 'AGENTOPS' ? o.agentOpsMultiplier ?? 1 : 1;
    if (k !== 1) {
      if (l.basis === 'allocated_shared') l.allocationPct = (l.allocationPct ?? 0) * k;
      else l.quantity *= k;
    }
  }
  if (o.repriceAtTargetMargin && o.targetMarginPct !== null && o.targetMarginPct !== undefined) {
    for (const s of p.pricing.streams) if (s.type !== 'fixed_fee' && s.type !== 'pass_through' && s.type !== 'gainshare') s.targetMarginPct = o.targetMarginPct;
  }
  return p;
}

export interface ScenarioMetrics {
  monthlyRunCost: Decimal;
  costPerAcu: Decimal;
  costPerAbu: Decimal;
  llmCostPerAcceptedTxn: Decimal;
  monthlyRevenue: Decimal;
  arr: Decimal;
  year1Revenue: Decimal;
  providerMarginPct: Decimal;
  termMarginPct: Decimal;
  tcv: Decimal;
  customerRoiPct: Decimal;
  paybackMonths: number | null;
  npv: Decimal;
  breakEven: BreakEven | null;
}

export interface BreakEven {
  multiplier: number;
  monthlyVolume: number;
  /** 'below' = profitable at any volume (fixed fees cover cost); 'above' = not reached within search range. */
  status: 'found' | 'below' | 'above';
}

export function steadyGrossProfit(project: Project, inputCatalog: Catalog, book: PriceBook, k: number, baselineAttempted: Decimal): Decimal {
  const catalog = withFxFallback(project, inputCatalog);
  const p = k === 1 ? project : applyScenario(project, { volumeMultiplier: k });
  const snap = buildSnapshot(p, catalog, { rampFactor: 1, yearIndex: 0 });
  const val = computeValueMonth(p, catalog, snap, 'steady', baselineAttempted);
  const lines = revenueForMonth(book, {
    month: 1,
    yearIndex: 0,
    snapshot: snap,
    validatedBenefit: val.validated,
    forecastBenefit: val.forecast,
    abuRateCard: p.pricing.abuRateCard,
    acuRateCard: p.pricing.acuRateCard,
  });
  return sum(lines.map((l) => l.amount)).minus(snap.totalRunCost);
}

/**
 * Lowest monthly volume (steady state, locked prices) above which run-rate gross profit stays
 * non-negative. Scans a multiplier grid (minimum commitments can make small volumes profitable
 * while mid volumes lose money), then bisects the last loss-to-profit crossing.
 */
export function breakEven(project: Project, catalog: Catalog, book: PriceBook): BreakEven | null {
  const baseVolume = project.workflows.reduce((a, w) => a + w.monthlyVolume, 0);
  if (baseVolume <= 0) return null;
  const baseAttempted = D(baseVolume);
  const gp = (k: number) => steadyGrossProfit(project, catalog, book, k, baseAttempted);
  const grid = [0.0001, 0.02, 0.05, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1, 1.25, 1.5, 2, 3, 4, 6, 8, 16, 32, 64, 128];
  const values = grid.map((k) => gp(k));
  let lastLoss = -1;
  values.forEach((v, i) => {
    if (v.lt(0)) lastLoss = i;
  });
  if (lastLoss === -1) return { multiplier: 0, monthlyVolume: 0, status: 'below' };
  if (lastLoss === grid.length - 1) return { multiplier: grid[lastLoss], monthlyVolume: baseVolume * grid[lastLoss], status: 'above' };
  let lo = grid[lastLoss];
  let hi = grid[lastLoss + 1];
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (gp(mid).gte(0)) hi = mid;
    else lo = mid;
  }
  return { multiplier: hi, monthlyVolume: baseVolume * hi, status: 'found' };
}

export function metricsOf(r: ProjectResult, catalog: Catalog, withBreakEven = true): ScenarioMetrics {
  const b = r.baseline;
  return {
    monthlyRunCost: b.totalRunCost,
    costPerAcu: safeDiv(b.totalRunCost, b.acu.total),
    costPerAbu: safeDiv(b.totalRunCost, b.totals.weightedAbus),
    llmCostPerAcceptedTxn: b.llm.perAccepted,
    monthlyRevenue: r.steady.revenue,
    arr: r.economics.provider.arr,
    year1Revenue: r.years[0]?.revenue ?? ZERO,
    providerMarginPct: r.steady.marginPct,
    termMarginPct: r.economics.provider.marginPct,
    tcv: r.economics.provider.tcv,
    customerRoiPct: r.economics.client.roiPct,
    paybackMonths: r.economics.client.paybackMonths,
    npv: r.economics.client.npv,
    breakEven: withBreakEven ? breakEven(r.project, catalog, r.priceBook) : null,
  };
}

export interface ScenarioRun {
  project: Project;
  result: ProjectResult;
  metrics: ScenarioMetrics;
}

export function runScenario(base: ProjectResult, catalog: Catalog, o: ScenarioOverrides, withBreakEven = true): ScenarioRun {
  const project = applyScenario(base.project, o);
  const mult = D(o.priceMultiplier ?? 1);
  // Volume-scaled benefits were estimated at the base project's volume, so they move with scenario volume.
  const benefitVolumeBase = base.baseline.totals.attempted;
  let result: ProjectResult;
  if (o.repriceAtTargetMargin) {
    result = computeProject(project, catalog, { packages: false, benefitVolumeBase });
    if (!mult.eq(1)) result = computeProject(project, catalog, { packages: false, benefitVolumeBase, priceBook: { ...result.priceBook, priceMultiplier: mult } });
  } else {
    result = computeProject(project, catalog, { packages: false, benefitVolumeBase, priceBook: { ...base.priceBook, priceMultiplier: mult } });
  }
  return { project, result, metrics: metricsOf(result, catalog, withBreakEven) };
}

export interface WaterfallStep {
  label: string;
  value: number;
  kind: 'start' | 'delta' | 'end';
}

/** Sequential attribution of the change in steady-state monthly run cost to each driver group. */
export function costWaterfall(project: Project, inputCatalog: Catalog, o: ScenarioOverrides): WaterfallStep[] {
  const catalog = withFxFallback(project, inputCatalog);
  const groups: { label: string; keys: (keyof ScenarioOverrides)[] }[] = [
    { label: 'Volume', keys: ['volumeMultiplier'] },
    { label: 'Token consumption', keys: ['inputTokenMultiplier', 'outputTokenMultiplier'] },
    { label: 'Model routing', keys: ['modelSwap', 'routingShift'] },
    { label: 'Caching', keys: ['cacheHitRatePct', 'cacheHitDeltaPp'] },
    { label: 'Retries & success', keys: ['retryRatePct', 'retryMultiplier', 'successRateDeltaPp'] },
    { label: 'Human intervention', keys: ['humanInterventionDeltaPp'] },
    { label: 'Complexity mix', keys: ['complexityShiftPp'] },
    { label: 'Infrastructure', keys: ['infraMultiplier'] },
    { label: 'AgentOps effort', keys: ['agentOpsMultiplier'] },
  ];
  const cost = (ov: ScenarioOverrides) => buildSnapshot(applyScenario(project, ov), catalog, { rampFactor: 1, yearIndex: 0 }).totalRunCost.toNumber();
  const start = cost({});
  const steps: WaterfallStep[] = [{ label: 'Baseline', value: start, kind: 'start' }];
  const acc: ScenarioOverrides = {};
  let prev = start;
  for (const g of groups) {
    if (!g.keys.some((k) => o[k] !== undefined && o[k] !== null)) continue;
    for (const k of g.keys) (acc as Record<string, unknown>)[k] = o[k];
    const c = cost(acc);
    steps.push({ label: g.label, value: c - prev, kind: 'delta' });
    prev = c;
  }
  steps.push({ label: 'Scenario', value: prev, kind: 'end' });
  return steps;
}

export interface SensitivityRow {
  driver: string;
  lowLabel: string;
  highLabel: string;
  lowMargin: number;
  highMargin: number;
  lowCostPerAbu: number;
  highCostPerAbu: number;
  lowRoi: number;
  highRoi: number;
  range: number;
}

/** Tornado: steady-state provider margin (locked prices), cost per ABU and client ROI under ± shocks. */
export function sensitivity(base: ProjectResult, catalog: Catalog): { base: { margin: number; costPerAbu: number; roi: number }; rows: SensitivityRow[] } {
  const scaledCatalog = (k: number): Catalog => ({
    ...catalog,
    modelRates: catalog.modelRates.map((m) => ({
      ...m,
      inputPerM: m.inputPerM * k,
      outputPerM: m.outputPerM * k,
      reasoningPerM: m.reasoningPerM !== undefined ? m.reasoningPerM * k : undefined,
      cacheReadPerM: m.cacheReadPerM * k,
      cacheWritePerM: m.cacheWritePerM * k,
      selfHosted: m.selfHosted ? { ...m.selfHosted, gpuHourlyCost: m.selfHosted.gpuHourlyCost * k } : undefined,
    })),
  });
  const drivers: { driver: string; low: ScenarioOverrides; high: ScenarioOverrides; lowLabel: string; highLabel: string; catalogScale?: [number, number] }[] = [
    { driver: 'Transaction volume', low: { volumeMultiplier: 0.8 }, high: { volumeMultiplier: 1.2 }, lowLabel: '−20%', highLabel: '+20%' },
    { driver: 'Tokens per call', low: { inputTokenMultiplier: 0.8, outputTokenMultiplier: 0.8 }, high: { inputTokenMultiplier: 1.2, outputTokenMultiplier: 1.2 }, lowLabel: '−20%', highLabel: '+20%' },
    { driver: 'LLM unit rates', low: {}, high: {}, lowLabel: '−20%', highLabel: '+20%', catalogScale: [0.8, 1.2] },
    { driver: 'Retry rate', low: { retryMultiplier: 0.5 }, high: { retryMultiplier: 1.5 }, lowLabel: '×0.5', highLabel: '×1.5' },
    { driver: 'Agent success rate', low: { successRateDeltaPp: 3 }, high: { successRateDeltaPp: -3 }, lowLabel: '+3pp', highLabel: '−3pp' },
    { driver: 'Human intervention', low: { humanInterventionDeltaPp: -5 }, high: { humanInterventionDeltaPp: 5 }, lowLabel: '−5pp', highLabel: '+5pp' },
    { driver: 'Cache hit rate', low: { cacheHitDeltaPp: 15 }, high: { cacheHitDeltaPp: -15 }, lowLabel: '+15pp', highLabel: '−15pp' },
    { driver: 'Complexity mix', low: { complexityShiftPp: -10 }, high: { complexityShiftPp: 10 }, lowLabel: 'simpler', highLabel: 'harder' },
    { driver: 'Infrastructure', low: { infraMultiplier: 0.8 }, high: { infraMultiplier: 1.2 }, lowLabel: '−20%', highLabel: '+20%' },
    { driver: 'AgentOps effort', low: { agentOpsMultiplier: 0.8 }, high: { agentOpsMultiplier: 1.2 }, lowLabel: '−20%', highLabel: '+20%' },
    { driver: 'Customer price', low: { priceMultiplier: 1.1 }, high: { priceMultiplier: 0.9 }, lowLabel: '+10%', highLabel: '−10%' },
  ];
  const evalRun = (o: ScenarioOverrides, cat: Catalog) => {
    const r = runScenario(base, cat, o, false);
    return { margin: r.metrics.providerMarginPct.toNumber(), costPerAbu: r.metrics.costPerAbu.toNumber(), roi: r.metrics.customerRoiPct.toNumber() };
  };
  const b = { margin: base.steady.marginPct.toNumber(), costPerAbu: safeDiv(base.baseline.totalRunCost, base.baseline.totals.weightedAbus).toNumber(), roi: base.economics.client.roiPct.toNumber() };
  const rows = drivers.map((d) => {
    const lo = evalRun(d.low, d.catalogScale ? scaledCatalog(d.catalogScale[0]) : catalog);
    const hi = evalRun(d.high, d.catalogScale ? scaledCatalog(d.catalogScale[1]) : catalog);
    return {
      driver: d.driver,
      lowLabel: d.lowLabel,
      highLabel: d.highLabel,
      lowMargin: lo.margin,
      highMargin: hi.margin,
      lowCostPerAbu: lo.costPerAbu,
      highCostPerAbu: hi.costPerAbu,
      lowRoi: lo.roi,
      highRoi: hi.roi,
      range: Math.abs(hi.margin - lo.margin),
    };
  });
  rows.sort((x, y) => y.range - x.range);
  return { base: b, rows };
}

export { ONE };
