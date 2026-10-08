import { sum } from '@aies/engine';
import type { ReportSection } from '../types';
import { decimal, months, pct } from '../format';
import { poolLabel } from '../util';
import { activePools, chart, kpi, section, table, type Ctx } from './common';
import { doubleBillingStatement } from './commercial';

export function executiveDashboard(x: Ctx): ReportSection[] {
  const { r } = x;
  const p = r.project;
  const e = r.economics;
  const b = r.baseline;
  const out: ReportSection[] = [];
  const pass = r.reconciliation.filter((c) => c.pass).length;
  const total = r.reconciliation.length;

  out.push(
    section('Headline economics', {
      paragraphs: [
        `${p.name} (${p.status.replace('_', '-')}) for ${p.client.clientName}. ${x.c(e.provider.tcv)} total contract value at ${pct(e.provider.marginPct)} gross margin; the client counts ${x.c(e.client.countedBenefits)} of validated benefits for a ${pct(e.client.roiPct)} ROI with payback in ${months(e.client.paybackMonths).toLowerCase()}.`,
      ],
      kpis: [
        kpi('Total contract value', x.c(e.provider.tcv)),
        kpi('ARR (steady state)', x.c(e.provider.arr)),
        kpi('Provider gross margin', pct(e.provider.marginPct)),
        kpi('Implementation price', x.c(r.implementation.price)),
        kpi('Monthly run cost', x.c(b.totalRunCost)),
        kpi('Cost per accepted ABU', x.u(e.provider.costToServePerAbu)),
        kpi('Client ROI', pct(e.client.roiPct)),
        kpi('Payback', months(e.client.paybackMonths)),
        kpi('Client NPV', x.c(e.client.npv)),
        kpi('Weighted ABUs per month', x.k(b.totals.weightedAbus)),
        kpi('ACUs per month', x.k(b.acu.total)),
        kpi('FTE capacity released', decimal(e.client.steadyFteReleased, 1), 'Non-cash'),
      ],
    }),
  );

  out.push(
    section('Revenue, cost and margin by year', {
      chart: chart(
        'bar',
        'Revenue and cost by year',
        r.years.map((y) => y.label),
        [
          { name: 'Revenue', values: r.years.map((y) => y.revenue) },
          { name: 'Cost', values: r.years.map((y) => y.cost) },
        ],
        'currency',
      ),
      table: table(
        ['Year', 'Revenue', 'Cost', 'Gross profit', 'Margin', 'Client ROI'],
        r.years.map((y) => [y.label, x.c(y.revenue), x.c(y.cost), x.c(y.grossProfit), pct(y.marginPct), pct(y.roiPct)]),
        { footer: ['Term', x.c(e.provider.tcv), x.c(e.provider.totalCost), x.c(e.provider.grossProfit), pct(e.provider.marginPct), pct(e.client.roiPct)] },
      ),
    }),
  );

  const pools = activePools(x);
  out.push(
    section('Where the run cost goes', {
      chart: chart('bar', 'Steady-state monthly run cost by pool', pools.map(poolLabel), [{ name: 'Monthly cost', values: pools.map((pl) => b.pools[pl]) }], 'currency'),
    }),
  );

  out.push(
    section('Client value', {
      chart: chart(
        'line',
        'Cumulative client net position',
        r.months.map((m) => `M${m.month}`),
        [{ name: 'Cumulative net', values: r.months.map((m) => m.clientCumulative) }],
        'currency',
      ),
      kpis: [
        kpi('Counted benefits, term', x.c(e.client.countedBenefits)),
        kpi('Client investment, term', x.c(e.client.totalInvestment)),
        kpi('Productivity value, term', x.c(e.client.productivityValue), 'Non-cash, not in ROI'),
      ],
    }),
  );

  // Risks
  const order = { error: 0, warning: 1, info: 2 } as const;
  const issues = [...r.issues].sort((a, c) => order[a.severity] - order[c.severity]).slice(0, 8);
  out.push(
    section('Top risks and issues', {
      paragraphs: issues.length ? [] : ['No validation issues were raised by the engine.'],
      table: issues.length
        ? table(
            ['Severity', 'Issue'],
            issues.map((i) => [i.severity === 'error' ? 'Error' : i.severity === 'warning' ? 'Warning' : 'Note', i.message]),
            { align: ['left', 'left'] },
          )
        : undefined,
    }),
  );

  out.push(
    section('Reconciliation status', {
      paragraphs: [
        `${pass} of ${total} reconciliation checks pass: every breakdown (by pool, workflow, agent, function, model, stream and year) sums to the same totals because each cost is computed once and then allocated. ${doubleBillingStatement(x)}`,
      ],
      table: table(
        ['Check', 'Status'],
        r.reconciliation.filter((c) => !c.pass).length
          ? r.reconciliation.map((c) => [c.name, c.pass ? 'Pass' : 'FAIL'])
          : [
              ['All reconciliation checks', `Pass (${pass}/${total})`],
              ['Σ monthly revenue = total contract value', 'Pass'],
              ['Run cost by pool, workflow and agent = total run cost', 'Pass'],
            ],
        { align: ['left', 'left'] },
      ),
      kpis: [kpi('Checks passing', `${pass} / ${total}`), kpi('Recurring revenue, term', x.c(sum(r.months.map((m) => m.recurringRevenue))))],
    }),
  );
  return out;
}
