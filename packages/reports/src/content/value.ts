import { D, convert, sum, type BenefitCategory } from '@aies/engine';
import type { ReportSection } from '../types';
import { decimal, humanize, months, pct } from '../format';
import { chart, kpi, section, table, type Ctx } from './common';

const CATEGORY: Record<BenefitCategory, string> = {
  hard_savings: 'Hard savings',
  cost_avoidance: 'Cost avoidance',
  revenue: 'Revenue / contribution',
  working_capital: 'Working capital',
  capacity_conversion: 'Capacity conversion',
};

export function benefitTermTotals(x: Ctx) {
  const { r } = x;
  const useForecast = r.project.value.includeUnvalidated;
  return r.project.value.benefits.map((bl) => {
    const lines = r.context.bases.map((bs) => bs.value?.lines.find((l) => l.lineId === bl.id)).filter((l): l is NonNullable<typeof l> => !!l);
    return {
      line: bl,
      gross: sum(lines.map((l) => l.gross)),
      counted: sum(lines.map((l) => (useForecast ? l.countedForecast : l.countedValidated))),
      reason: r.steady.value.lines.find((l) => l.lineId === bl.id)?.excludedReason ?? lines.find((l) => l.excludedReason)?.excludedReason ?? null,
    };
  });
}

export function valueBusinessCase(x: Ctx): ReportSection[] {
  const { r } = x;
  const p = r.project;
  const c = r.economics.client;
  const sv = r.steady.value;
  const out: ReportSection[] = [];
  const view = p.value.includeUnvalidated ? 'forecast (including proposed benefits)' : 'finance-validated and realised benefits only';

  out.push(
    section('Summary', {
      paragraphs: [
        `Over the ${p.pricing.termMonths}-month term the client invests ${x.c(c.totalInvestment)} (provider fees plus internal costs) and the business case counts ${x.c(c.countedBenefits)} of ${view}, a net benefit of ${x.c(c.netBenefit)} and an ROI of ${pct(c.roiPct)}. Payback: ${months(c.paybackMonths)}. NPV at ${pct(p.value.discountRatePct)}: ${x.c(c.npv)}.`,
        `Separately, the solution releases ${x.k(c.steadyHoursSaved)} hours a month at steady state (${decimal(c.steadyFteReleased, 1)} FTE), worth ${x.c(c.steadyProductivityValue)} a month at loaded cost. This productivity value is non-cash and is NOT counted in ROI unless a finance-validated benefit line converts it.`,
      ],
      kpis: [
        kpi('Client ROI, term', pct(c.roiPct)),
        kpi('Payback', months(c.paybackMonths)),
        kpi('NPV', x.c(c.npv), `at ${pct(p.value.discountRatePct)}`),
        kpi('Counted benefits, term', x.c(c.countedBenefits)),
        kpi('Client investment, term', x.c(c.totalInvestment)),
        kpi('Cost per accepted outcome', x.u(c.costPerOutcome)),
      ],
    }),
  );

  // Productivity
  out.push(
    section('Productivity (non-cash)', {
      paragraphs: [
        'Hours before = attempted × manual minutes. Hours after = autonomous spot checks + human-assisted review + manual handling of failed and rejected work. Released hours are capacity, not cash, until a benefit line converts them and Finance validates it.',
      ],
      kpis: [
        kpi('Hours released per month', x.k(sv.hoursSaved), 'Steady state'),
        kpi('FTE released', decimal(sv.fteReleased, 1)),
        kpi('Productivity value per month', x.c(sv.productivityValue), 'Non-cash'),
        kpi('Productivity value, term', x.c(c.productivityValue), 'Non-cash'),
      ],
      table: table(
        ['Workflow', 'Hours before', 'Hours after', 'Hours released', 'Improvement', 'FTE released', 'Value (non-cash)'],
        sv.productivity.map((pr) => [x.nm.workflow(pr.workflowId), x.k(pr.hoursBefore), x.k(pr.hoursAfter), x.k(pr.hoursSaved), pct(pr.improvementPct), decimal(pr.fteReleased, 1), x.m(pr.productivityValue)]),
        { footer: ['Total', x.k(sum(sv.productivity.map((q) => q.hoursBefore))), x.k(sum(sv.productivity.map((q) => q.hoursAfter))), x.k(sv.hoursSaved), '', decimal(sv.fteReleased, 1), x.m(sv.productivityValue)] },
      ),
    }),
  );

  // Benefit register
  const totals = benefitTermTotals(x);
  out.push(
    section('Benefit register', {
      paragraphs: [
        `Only explicit benefit lines count as financial benefits. This business case counts ${view}. Amounts are risk-adjusted by confidence and ramp from each line's start month.`,
      ],
      table: table(
        ['Benefit', 'Category', 'Status', 'Annual amount', 'Confidence', 'Starts', 'Steady monthly', 'Counted, term', 'Note'],
        totals.map(({ line, counted, reason }) => {
          const sl = sv.lines.find((l) => l.lineId === line.id);
          return [
            line.name,
            CATEGORY[line.category],
            `${humanize(line.status)}${line.validatedBy ? ` (${line.validatedBy})` : ''}`,
            x.m(convert(line.annualAmount, line.currency, x.cur, x.catalog.fx)),
            pct(line.confidencePct, 0),
            `Month ${line.startMonth}`,
            x.m(sl?.gross ?? 0),
            x.m(counted),
            reason ?? (line.overlapGroup ? `Overlap group ${line.overlapGroup}` : ''),
          ];
        }),
        { align: ['left', 'left', 'left', 'right', 'right', 'left', 'right', 'right', 'left'], footer: ['Total counted', '', '', '', '', '', '', x.m(c.countedBenefits), ''] },
      ),
    }),
  );

  // Overlap & caps
  const groups = [...new Set(p.value.benefits.map((bl) => bl.overlapGroup).filter((g): g is string => !!g))];
  out.push(
    section('Double-counting controls', {
      paragraphs: [
        groups.length
          ? `Overlap groups (${groups.join(', ')}): benefits in the same group are alternatives for the same underlying saving, so only the largest counts in each month.`
          : 'No overlap groups are defined.',
        'Capacity-conversion benefits are capped at the productivity value they convert.',
        `Human review is either a provider cost inside the managed service or client staff time, never both. Forecast benefits for the term (including proposed lines) total ${x.c(c.forecastBenefits)}; validated benefits total ${x.c(c.validatedBenefits)}.`,
      ],
    }),
  );

  // Investment & ROI by year
  const clientInternal = sum(r.months.map((m) => m.clientInternalCost));
  out.push(
    section('Client investment and ROI by year', {
      paragraphs: [`Client investment = provider fees (${x.c(r.economics.provider.tcv)}) + client internal costs (${x.c(clientInternal)}). ROI = (counted benefits − investment) ÷ investment.`],
      table: table(
        ['Year', 'Provider fees', 'Client internal cost', 'Investment', 'Counted benefits', 'Net benefit', 'ROI'],
        r.years.map((y) => {
          const rows = r.months.filter((m) => (m.month === 0 ? y.year === 1 : m.yearIndex === y.year - 1));
          return [y.label, x.m(y.revenue), x.m(sum(rows.map((m) => m.clientInternalCost))), x.m(y.clientInvestment), x.m(y.countedBenefit), x.m(y.clientNet), pct(y.roiPct)];
        }),
        { footer: ['Term', x.m(r.economics.provider.tcv), x.m(clientInternal), x.m(c.totalInvestment), x.m(c.countedBenefits), x.m(c.netBenefit), pct(c.roiPct)] },
      ),
      chart: chart(
        'line',
        'Cumulative client net position',
        r.months.map((m) => (m.month === 0 ? 'M0' : `M${m.month}`)),
        [{ name: 'Cumulative net', values: r.months.map((m) => m.clientCumulative) }],
        'currency',
      ),
    }),
  );

  // KPIs
  const kpis = p.value.kpis;
  out.push(
    section('Outcome KPIs', {
      paragraphs: kpis.length ? [] : ['No outcome KPIs are defined for this project.'],
      table: kpis.length
        ? table(
            ['KPI', 'Before', 'After', 'Change', 'Direction'],
            kpis.map((k) => {
              const ch = k.before === 0 ? D(0) : D(k.after).minus(k.before).div(k.before).times(100);
              const better = k.higherIsBetter ? k.after >= k.before : k.after <= k.before;
              return [k.name, `${decimal(k.before, k.before % 1 ? 1 : 0)} ${k.unit}`, `${decimal(k.after, k.after % 1 ? 1 : 0)} ${k.unit}`, pct(ch), better ? 'Improves' : 'Worsens'];
            }),
            { align: ['left', 'right', 'right', 'right', 'left'] },
          )
        : undefined,
    }),
  );
  return out;
}
