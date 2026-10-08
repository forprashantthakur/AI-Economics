import { sum } from '@aies/engine';
import type { ReportSection } from '../types';
import { pct, periodLabel } from '../format';
import { chart, kpi, section, table, type Ctx } from './common';

export function threeYearProjection(x: Ctx): ReportSection[] {
  const { r } = x;
  const e = r.economics;
  const out: ReportSection[] = [];
  const nYears = r.years.length;

  out.push(
    section('Projection summary', {
      paragraphs: [
        `Month 0 is the implementation period; run months start at go-live (${periodLabel(r.project.goLiveDate)}). Year 1 includes month 0. Volumes ramp over ${r.project.pricing.rampMonths} months and then grow at each workflow's annual rate; contracted prices escalate ${pct(r.project.pricing.priceEscalationPct)} a year while costs inflate ${pct(r.project.pricing.costInflationPct)} a year.`,
      ],
      kpis: [
        kpi('Total contract value', x.c(e.provider.tcv)),
        kpi('Total provider cost', x.c(e.provider.totalCost)),
        kpi('Gross profit', x.c(e.provider.grossProfit)),
        kpi('Gross margin', pct(e.provider.marginPct)),
        kpi('Client ROI', pct(e.client.roiPct)),
        kpi('Client NPV', x.c(e.client.npv)),
      ],
    }),
  );

  out.push(
    section(`Provider economics by year (${nYears} years)`, {
      table: table(
        ['Year', 'Revenue', 'One-time', 'Recurring', 'Total cost', 'of which LLM', 'Gross profit', 'Margin'],
        r.years.map((y) => [y.label, x.m(y.revenue), x.m(y.oneTimeRevenue), x.m(y.recurringRevenue), x.m(y.cost), x.m(y.llmCost), x.m(y.grossProfit), pct(y.marginPct)]),
        { footer: ['Term', x.m(e.provider.tcv), x.m(e.provider.oneTimeRevenue), x.m(e.provider.recurringRevenue), x.m(e.provider.totalCost), x.m(sum(r.years.map((y) => y.llmCost))), x.m(e.provider.grossProfit), pct(e.provider.marginPct)] },
      ),
      chart: chart(
        'bar',
        'Revenue, cost and gross profit by year',
        r.years.map((y) => y.label),
        [
          { name: 'Revenue', values: r.years.map((y) => y.revenue) },
          { name: 'Cost', values: r.years.map((y) => y.cost) },
          { name: 'Gross profit', values: r.years.map((y) => y.grossProfit) },
        ],
        'currency',
      ),
    }),
  );

  out.push(
    section('Volumes and units by year', {
      table: table(
        ['Year', 'Attempted', 'Accepted', 'Weighted ABUs', 'ACUs', 'Revenue per ABU', 'Cost per ABU'],
        r.years.map((y) => [
          y.label,
          x.k(y.attempted),
          x.k(y.accepted),
          x.k(y.weightedAbus),
          x.k(y.acus),
          x.u(y.weightedAbus.isZero() ? 0 : y.recurringRevenue.div(y.weightedAbus)),
          x.u(y.weightedAbus.isZero() ? 0 : y.runCost.div(y.weightedAbus)),
        ]),
        {
          footer: [
            'Term',
            x.k(sum(r.years.map((y) => y.attempted))),
            x.k(sum(r.years.map((y) => y.accepted))),
            x.k(sum(r.years.map((y) => y.weightedAbus))),
            x.k(sum(r.years.map((y) => y.acus))),
            '',
            '',
          ],
        },
      ),
    }),
  );

  out.push(
    section('Client investment, benefit and ROI by year', {
      table: table(
        ['Year', 'Investment', 'Counted benefits', 'Net benefit', 'ROI', 'Productivity (non-cash)', 'Hours released'],
        r.years.map((y) => [y.label, x.m(y.clientInvestment), x.m(y.countedBenefit), x.m(y.clientNet), pct(y.roiPct), x.m(y.productivityValue), x.k(y.hoursSaved)]),
        { footer: ['Term', x.m(e.client.totalInvestment), x.m(e.client.countedBenefits), x.m(e.client.netBenefit), pct(e.client.roiPct), x.m(e.client.productivityValue), x.k(e.client.hoursSaved)] },
      ),
    }),
  );

  out.push(
    section('Monthly revenue and cost', {
      chart: chart(
        'line',
        'Monthly revenue and total cost (run months)',
        r.months.filter((m) => m.month > 0).map((m) => periodLabel(m.period)),
        [
          { name: 'Revenue', values: r.months.filter((m) => m.month > 0).map((m) => m.revenue) },
          { name: 'Cost', values: r.months.filter((m) => m.month > 0).map((m) => m.totalCost) },
        ],
        'currency',
      ),
    }),
  );

  out.push(
    section('Monthly projection', {
      table: table(
        ['Month', 'Period', 'Ramp', 'Attempted', 'Weighted ABUs', 'ACUs', 'Revenue', 'Cost', 'Gross profit', 'Client net', 'Cumulative'],
        r.months.map((m) => [
          String(m.month),
          m.month === 0 ? 'Build' : periodLabel(m.period),
          m.month === 0 ? '—' : pct(m.rampFactor * 100, 0),
          x.k(m.attempted),
          x.k(m.weightedAbus),
          x.k(m.acus),
          x.m(m.revenue),
          x.m(m.totalCost),
          x.m(m.grossProfit),
          x.m(m.clientNet),
          x.m(m.clientCumulative),
        ]),
        { footer: ['Total', '', '', x.k(sum(r.months.map((m) => m.attempted))), x.k(sum(r.months.map((m) => m.weightedAbus))), x.k(sum(r.months.map((m) => m.acus))), x.m(e.provider.tcv), x.m(e.provider.totalCost), x.m(e.provider.grossProfit), x.m(e.client.netBenefit), ''] },
      ),
    }),
  );
  return out;
}
