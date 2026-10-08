import { CONSTRUCTS } from '@aies/engine';
import type { ReportSection } from '../types';
import { months, pct } from '../format';
import { poolLabel } from '../util';
import { chart, kpi, poolList, priceBasis, section, streamTypeLabel, table, type Ctx } from './common';

export function commercialProposal(x: Ctx): ReportSection[] {
  const { r } = x;
  const p = r.project;
  const pr = p.pricing;
  const e = r.economics.provider;
  const book = r.priceBook;
  const out: ReportSection[] = [];
  const hybrid = r.packages.find((k) => k.id === 'hybrid');
  const types = book.streams.map((s) => streamTypeLabel(s.type));

  out.push(
    section('Recommended commercial model', {
      paragraphs: [
        `We recommend a hybrid model of ${book.streams.length} revenue streams (${types.join(' + ')}) over a ${pr.termMonths}-month term. Each cost pool is recovered by exactly one stream, so the client is never billed twice for the same cost, and every recurring price is derived from the steady-state cost it recovers plus a target margin.`,
        `Prices escalate ${pct(pr.priceEscalationPct)} a year. Total contract value is ${x.c(e.tcv)} (${x.c(e.oneTimeRevenue)} one-time and ${x.c(e.recurringRevenue)} recurring) at a ${pct(e.marginPct)} gross margin over the term.`,
      ],
      kpis: [
        kpi('Total contract value', x.c(e.tcv)),
        kpi('Annual contract value', x.c(e.acv)),
        kpi('ARR (steady state)', x.c(e.arr)),
        kpi('Implementation fee', x.c(e.oneTimeRevenue)),
        kpi('Gross margin, term', pct(e.marginPct)),
        kpi('Steady-state run margin', pct(e.steadyMarginPct)),
      ],
    }),
  );

  out.push(
    section('Revenue streams and what each recovers', {
      table: table(
        ['Stream', 'Type', 'Recovers', 'Price basis', 'Target margin', 'Steady monthly revenue'],
        book.streams.map((s) => [
          s.label,
          streamTypeLabel(s.type),
          poolList(s.recovers),
          priceBasis(x, s),
          pct(s.targetMarginPct),
          s.type === 'fixed_fee' ? '—' : x.m(r.steady.revenueByStream[s.streamId] ?? 0),
        ]),
        { align: ['left', 'left', 'left', 'left', 'right', 'right'], footer: ['Total recurring (steady month)', '', '', '', '', x.m(r.steady.recurringRevenue)] },
      ),
    }),
  );

  // Fees
  const fee = book.streams.find((s) => s.type === 'fixed_fee');
  const lines = r.steady.revenueLines;
  out.push(
    section('Implementation and recurring fees', {
      paragraphs: [
        fee
          ? `Implementation fee: ${x.m(fee.oneTimeFee ?? 0)}, invoiced against delivery milestones, recovering ${x.m(r.implementation.totalCost)} of implementation cost.`
          : 'There is no separate implementation fee; implementation cost is amortised into recurring prices.',
        `Recurring charges in a steady-state month of year 1 total ${x.m(r.steady.recurringRevenue)} against a run cost of ${x.m(r.steady.runCost)} (${pct(r.steady.marginPct)} margin).`,
      ],
      table: table(
        ['Recurring charge (steady month, year 1)', 'Amount'],
        lines.filter((l) => l.recurring).map((l) => [l.label, x.m(l.amount)]),
        { footer: ['Total', x.m(r.steady.recurringRevenue)] },
      ),
    }),
  );

  // Contract economics by year
  out.push(
    section('Contract economics', {
      table: table(
        ['Year', 'Revenue', 'One-time', 'Recurring', 'Cost', 'Gross profit', 'Margin'],
        r.years.map((y) => [y.label, x.m(y.revenue), x.m(y.oneTimeRevenue), x.m(y.recurringRevenue), x.m(y.cost), x.m(y.grossProfit), pct(y.marginPct)]),
        { footer: ['Term', x.m(e.tcv), x.m(e.oneTimeRevenue), x.m(e.recurringRevenue), x.m(e.totalCost), x.m(e.grossProfit), pct(e.marginPct)] },
      ),
      chart: chart(
        'bar',
        'Revenue and cost by contract year',
        r.years.map((y) => y.label),
        [
          { name: 'Revenue', values: r.years.map((y) => y.revenue) },
          { name: 'Cost', values: r.years.map((y) => y.cost) },
        ],
        'currency',
      ),
    }),
  );

  // Seven constructs
  const pk = r.packages;
  if (pk.length) {
    out.push(
      section('Comparison of the seven commercial constructs', {
        paragraphs: [
          'Each construct recovers the same implementation and run cost base, so provider margin and client ROI are directly comparable. The hybrid row is the recommended configuration above.',
        ],
        table: table(
          ['Construct', 'TCV', 'ARR', 'Provider margin', 'Client ROI', 'Payback'],
          CONSTRUCTS.map((c) => pk.find((k) => k.id === c.id))
            .filter((k): k is NonNullable<typeof k> => !!k)
            .map((k) => [
              k.id === 'hybrid' ? `${k.name} (recommended)` : k.name,
              x.c(k.economics.provider.tcv),
              x.c(k.economics.provider.arr),
              pct(k.economics.provider.marginPct),
              pct(k.economics.client.roiPct),
              months(k.economics.client.paybackMonths),
            ]),
        ),
        chart: chart(
          'bar',
          'Provider margin by construct',
          pk.map((k) => k.short),
          [{ name: 'Gross margin', values: pk.map((k) => k.economics.provider.marginPct) }],
          'percent',
        ),
      }),
    );
  }

  // Escalation & commitments
  const acuRc = pr.acuRateCard;
  const abuRc = pr.abuRateCard;
  const commitments: string[] = [];
  if (book.streams.some((s) => s.type === 'acu')) commitments.push(`ACU minimum monthly commitment: ${acuRc.minMonthlyCommitment ? x.m(acuRc.minMonthlyCommitment) : 'none'}; ${acuRc.tiers.length} volume tier(s).`);
  if (book.streams.some((s) => s.type === 'abu')) commitments.push(`ABU minimum: ${abuRc.minMonthlyAbus ? `${x.k(abuRc.minMonthlyAbus)} weighted ABUs a month` : 'none'}; ${abuRc.tiers.length} volume tier(s); failed work ${abuRc.failedCostAllocation === 'spread' ? 'spread into the ABU price' : 'absorbed by the provider'}.`);
  const sub = book.streams.find((s) => s.type === 'subscription')?.subscription;
  if (sub) commitments.push(`Subscription: platform fee ${x.m(sub.platformFee)} a month${sub.includedUnit !== 'none' ? `, including ${x.k(sub.includedQty)} ${sub.includedUnit.toUpperCase()}s (overage ${x.u(sub.overageRate)} each)` : ''}.`);
  out.push(
    section('Escalation, commitments and billing integrity', {
      paragraphs: [
        `Annual price escalation of ${pct(pr.priceEscalationPct)} applies to recurring fees and unit prices from the start of each contract year; the implementation fee is not escalated.`,
        ...commitments,
        doubleBillingStatement(x),
      ],
      table: table(
        ['Cost pool', 'Recovered by', 'Steady monthly cost'],
        (['IMPLEMENTATION', 'LLM', 'ORCHESTRATION', 'RAG', 'DOCUMENT', 'INFRASTRUCTURE', 'AGENTOPS', 'HUMAN_REVIEW', 'OTHER'] as const)
          .filter((pl) => pl === 'IMPLEMENTATION' || !r.baseline.pools[pl].isZero() || book.recovery[pl].length)
          .map((pl) => [poolLabel(pl), book.recovery[pl].map((id) => x.nm.stream(id)).join(', ') || 'Not recovered', pl === 'IMPLEMENTATION' ? x.m(r.implementation.totalCost) + ' one-time' : x.m(r.baseline.pools[pl])]),
        { align: ['left', 'left', 'right'] },
      ),
    }),
  );
  if (hybrid?.issues.length) {
    out.push(section('Pricing issues to resolve', { paragraphs: hybrid.issues.map((i) => `${i.severity === 'error' ? 'Error' : i.severity === 'warning' ? 'Warning' : 'Note'}: ${i.message}`) }));
  }
  return out;
}

export function doubleBillingStatement(x: Ctx): string {
  const book = x.r.priceBook;
  const doubles = book.issues.filter((i) => i.code === 'DOUBLE_RECOVERY');
  const unrec = book.issues.filter((i) => i.code === 'UNRECOVERED_POOL');
  if (doubles.length) return `Billing integrity check FAILED: ${doubles.map((d) => d.message).join(' ')}`;
  const base = 'No double billing: every cost pool is recovered by at most one revenue stream, retries and failed executions never create billable ABUs, and ACU measurement excludes cost already recovered by fixed fees.';
  return unrec.length ? `${base} ${unrec.length} pool(s) are not recovered by any stream and reduce provider margin.` : `${base} Every cost pool with a cost is recovered.`;
}
