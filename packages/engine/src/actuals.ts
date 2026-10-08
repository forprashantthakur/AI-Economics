/**
 * Post-deployment monitoring — estimated vs actual consumption, cost and benefits.
 */
import { D, Decimal, ZERO, safeDiv, sum } from './decimal';
import type { Catalog } from './types';
import type { ProjectResult } from './compute';
import { convert } from './fx';

export interface VarianceRow {
  period: string;
  monthIndex: number;
  workflowId: string | null;
  estAttempted: Decimal;
  actAttempted: Decimal;
  estAccepted: Decimal;
  actAccepted: Decimal;
  estTokens: Decimal;
  actTokens: Decimal;
  estLlmCost: Decimal;
  actLlmCost: Decimal;
  estNonLlmCost: Decimal;
  actNonLlmCost: Decimal;
  estTotalCost: Decimal;
  actTotalCost: Decimal;
  costVariance: Decimal;
  costVariancePct: Decimal;
  estCostPerAccepted: Decimal;
  actCostPerAccepted: Decimal;
  forecastBenefit: Decimal;
  realizedBenefit: Decimal;
}

export interface VarianceSummary {
  rows: VarianceRow[];
  byPeriod: VarianceRow[];
  totals: VarianceRow | null;
}

function pctOf(a: Decimal, b: Decimal) {
  return safeDiv(a, b).times(100);
}

export function varianceAnalysis(r: ProjectResult, catalog: Catalog): VarianceSummary {
  const rows: VarianceRow[] = [];
  const cur = r.currency;
  for (const a of r.project.actuals) {
    const month = r.months.find((m) => m.month === a.monthIndex);
    const base = r.context.bases.find((b) => b.month === a.monthIndex);
    const s = base?.snapshot;
    if (!month || !s) continue;
    const v = s.volumes[a.workflowId];
    const lines = s.llmLines.filter((l) => l.workflowId === a.workflowId);
    const estTokens = sum(lines.map((l) => l.inputTokens.plus(l.outputTokens).plus(l.reasoningTokens)));
    const estLlm = s.llm.byWorkflow[a.workflowId] ?? ZERO;
    const estTotal = s.runCostByWorkflow[a.workflowId] ?? ZERO;
    const actLlm = convert(a.llmCost, a.currency, cur, catalog.fx);
    const actNon = convert(a.nonLlmCost, a.currency, cur, catalog.fx);
    const actTotal = actLlm.plus(actNon);
    const share = safeDiv(estTotal, s.totalRunCost);
    const forecastBenefit = month.validatedBenefit.times(share);
    rows.push({
      period: a.period,
      monthIndex: a.monthIndex,
      workflowId: a.workflowId,
      estAttempted: v?.attempted ?? ZERO,
      actAttempted: D(a.attempted),
      estAccepted: v?.accepted ?? ZERO,
      actAccepted: D(a.accepted),
      estTokens,
      actTokens: D(a.inputTokens).plus(D(a.outputTokens)),
      estLlmCost: estLlm,
      actLlmCost: actLlm,
      estNonLlmCost: estTotal.minus(estLlm),
      actNonLlmCost: actNon,
      estTotalCost: estTotal,
      actTotalCost: actTotal,
      costVariance: actTotal.minus(estTotal),
      costVariancePct: pctOf(actTotal.minus(estTotal), estTotal),
      estCostPerAccepted: safeDiv(estTotal, v?.accepted ?? ZERO),
      actCostPerAccepted: safeDiv(actTotal, D(a.accepted)),
      forecastBenefit,
      realizedBenefit: convert(a.realizedBenefit, a.currency, cur, catalog.fx),
    });
  }
  const agg = (rs: VarianceRow[], period: string, monthIndex: number): VarianceRow => {
    const f = (k: keyof VarianceRow) => sum(rs.map((x) => x[k] as Decimal));
    const estTotal = f('estTotalCost');
    const actTotal = f('actTotalCost');
    return {
      period,
      monthIndex,
      workflowId: null,
      estAttempted: f('estAttempted'),
      actAttempted: f('actAttempted'),
      estAccepted: f('estAccepted'),
      actAccepted: f('actAccepted'),
      estTokens: f('estTokens'),
      actTokens: f('actTokens'),
      estLlmCost: f('estLlmCost'),
      actLlmCost: f('actLlmCost'),
      estNonLlmCost: f('estNonLlmCost'),
      actNonLlmCost: f('actNonLlmCost'),
      estTotalCost: estTotal,
      actTotalCost: actTotal,
      costVariance: actTotal.minus(estTotal),
      costVariancePct: pctOf(actTotal.minus(estTotal), estTotal),
      estCostPerAccepted: safeDiv(estTotal, f('estAccepted')),
      actCostPerAccepted: safeDiv(actTotal, f('actAccepted')),
      forecastBenefit: f('forecastBenefit'),
      realizedBenefit: f('realizedBenefit'),
    };
  };
  const periods = [...new Set(rows.map((x) => x.period))].sort();
  const byPeriod = periods.map((p) => {
    const rs = rows.filter((x) => x.period === p);
    return agg(rs, p, rs[0].monthIndex);
  });
  return { rows, byPeriod, totals: rows.length ? agg(rows, 'Total', 0) : null };
}
