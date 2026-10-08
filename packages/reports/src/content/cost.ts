import { D, convert, safeDiv, sum, type Decimal } from '@aies/engine';
import type { ReportSection } from '../types';
import { humanize, pct, periodLabel, yesNo } from '../format';
import { poolLabel } from '../util';
import { activePools, chart, kpi, section, shareOf, table, type Ctx } from './common';

const SOLUTION: Record<string, string> = {
  assistant: 'AI assistant',
  copilot: 'copilot',
  single_agent: 'single-agent solution',
  multi_agent: 'multi-agent solution',
  autonomous_workflow: 'autonomous workflow',
};

export function scopeSection(x: Ctx): ReportSection {
  const { r } = x;
  const p = r.project;
  const pr = p.pricing;
  const s = p.solution;
  const b = r.baseline;
  return section('Scope and assumptions', {
    paragraphs: [
      `${p.name} for ${p.client.clientName}: a ${SOLUTION[s.solutionType] ?? humanize(s.solutionType)} for ${p.client.businessFunction} (${p.client.businessProcess}) in ${p.client.industry}, hosted on ${s.cloudPlatform} using ${s.llmProviders.join(', ') || 'the configured model providers'}.`,
      `Go-live ${periodLabel(p.goLiveDate)} with a ${pr.termMonths}-month contract term. Volumes ramp from ${pct(pr.rampStartPct, 0)} over ${pr.rampMonths} months; prices escalate ${pct(pr.priceEscalationPct)} a year, costs inflate ${pct(pr.costInflationPct)} a year and LLM prices change ${pct(pr.llmPriceChangePct)} a year.`,
      `${p.workflows.length} workflow(s), ${p.agents.length} agents and ${s.integrations.length} enterprise integrations are in scope (${s.integrations.join(', ') || 'none listed'}). RAG ${s.ragRequired ? 'is' : 'is not'} required, document processing ${s.documentProcessing ? 'is' : 'is not'} required and a human is ${s.humanInTheLoop ? '' : 'not '}in the loop. Availability ${s.availabilitySla}; support ${s.supportSla}.`,
      `Steady state is the first fully ramped month of contract year 1. All amounts are in ${x.cur}.`,
    ],
    kpis: [
      kpi('Implementation cost', x.c(r.implementation.totalCost)),
      kpi('Implementation price', x.c(r.implementation.price), `${humanize(p.implementation.pricingMethod)}`),
      kpi('Delivery duration', `${r.implementation.durationWeeks} weeks`),
      kpi('Monthly run cost', x.c(b.totalRunCost), 'Steady state'),
      kpi('Cost per accepted ABU', x.u(r.economics.provider.costToServePerAbu)),
      kpi('Labour effort', `${x.k(r.implementation.laborHours)} hours`),
    ],
    table: table(
      ['Workflow', 'Business unit', 'Monthly volume', 'Annual growth', 'Success', 'Acceptance', 'Retry', 'Human-assisted'],
      p.workflows.map((w) => [w.name, w.abuName, x.k(w.monthlyVolume), pct(w.annualGrowthPct), pct(w.successRatePct), pct(w.acceptanceRatePct), pct(w.retryRatePct), pct(w.humanInterventionRatePct)]),
      { align: ['left', 'left', 'right', 'right', 'right', 'right', 'right', 'right'] },
    ),
  });
}

function phaseOrder(x: Ctx): string[] {
  const seen: string[] = [];
  for (const a of x.r.implementation.activities) if (!seen.includes(a.phase)) seen.push(a.phase);
  return seen;
}

export function costEstimate(x: Ctx): ReportSection[] {
  const { r } = x;
  const p = r.project;
  const plan = p.implementation;
  const impl = r.implementation;
  const b = r.baseline;
  const out: ReportSection[] = [scopeSection(x)];

  // Implementation by phase
  const phases = phaseOrder(x);
  const billTotal = sum(impl.activities.map((a) => a.billValue));
  out.push(
    section('Implementation by phase', {
      paragraphs: [`${x.k(impl.laborHours)} hours of delivery effort across ${phases.length} phases. Cost uses internal cost rates; bill value uses the rate card.`],
      table: table(
        ['Phase', 'Hours', 'Cost', 'Bill value', 'Share of labour cost'],
        phases.map((ph) => {
          const acts = impl.activities.filter((a) => a.phase === ph);
          const cost = impl.costByPhase[ph] ?? D(0);
          return [ph, x.k(sum(acts.map((a) => a.hours))), x.m(cost), x.m(sum(acts.map((a) => a.billValue))), shareOf(cost, impl.laborCost)];
        }),
        { footer: ['Total labour', x.k(impl.laborHours), x.m(impl.laborCost), x.m(billTotal), '100.0%'] },
      ),
      chart: chart('bar', 'Implementation cost by phase', phases, [{ name: 'Cost', values: phases.map((ph) => impl.costByPhase[ph] ?? 0) }], 'currency'),
    }),
  );

  // By role
  const roleNames = Object.keys(impl.hoursByRole);
  const roleByName = new Map(plan.roles.map((ro) => [ro.name, ro]));
  out.push(
    section('Implementation by role', {
      table: table(
        ['Role', 'Hours', 'Cost rate', 'Bill rate', 'Cost', 'Bill value'],
        roleNames.map((name) => {
          const ro = roleByName.get(name);
          const cr = ro ? convert(ro.costRate, ro.currency, x.cur, x.catalog.fx) : D(0);
          const br = ro ? convert(ro.billRate, ro.currency, x.cur, x.catalog.fx) : D(0);
          const bill = sum(impl.activities.filter((a) => a.roleName === name).map((a) => a.billValue));
          return [name, x.k(impl.hoursByRole[name]), x.m(cr), x.m(br), x.m(impl.costByRole[name] ?? 0), x.m(bill)];
        }),
        { footer: ['Total', x.k(impl.laborHours), '', '', x.m(impl.laborCost), x.m(billTotal)] },
      ),
    }),
  );

  // Schedule
  const critical = impl.activities.filter((a) => a.critical);
  out.push(
    section('Activities and schedule', {
      paragraphs: [
        `The plan runs ${impl.durationWeeks} weeks from mobilisation to hypercare (earliest-start schedule from activity dependencies). Critical path: ${critical.map((a) => a.name).join(', ') || 'none identified'}.`,
        ...(impl.scheduleErrors.length ? [`Schedule issues: ${impl.scheduleErrors.join('; ')}.`] : []),
      ],
      table: table(
        ['Activity', 'Phase', 'Role', 'Hours', 'Weeks', 'Critical'],
        impl.activities.map((a) => [a.name, a.phase, a.roleName, x.k(a.hours), `${a.startWeek}–${a.endWeek}`, a.critical ? 'Yes' : '']),
        { align: ['left', 'left', 'left', 'right', 'right', 'left'] },
      ),
    }),
  );

  // Direct expenses
  out.push(
    section('Direct expenses and contingency', {
      paragraphs: [`Contingency of ${pct(plan.contingencyPct)} is applied to labour and direct expenses. Billable expenses are re-charged at cost under time and materials.`],
      table: table(
        ['Expense', 'Amount', 'Billable'],
        plan.directExpenses.map((e) => [e.name, x.m(convert(e.amount, e.currency, x.cur, x.catalog.fx)), yesNo(e.billable)]),
        { align: ['left', 'right', 'left'], footer: ['Total direct expenses', x.m(impl.directExpenses), x.m(impl.billableExpenses) + ' billable'] },
      ),
    }),
  );

  // Price build-up
  const discount = plan.discountPct;
  const tmVsFixed = safeDiv(impl.cpmPrice.minus(impl.tmValue), impl.tmValue).times(100);
  out.push(
    section('Implementation price: fixed price versus time and materials', {
      paragraphs: [
        `At the plan's ${pct(plan.targetMarginPct)} target margin the fixed (cost-plus) price is ${x.c(impl.cpmPrice)}; billing the same effort at rate-card bill rates plus billable expenses gives ${x.c(impl.tmValue)}. The fixed price is ${pct(tmVsFixed.abs())} ${tmVsFixed.gte(0) ? 'above' : 'below'} time and materials.`,
        `Selected method: ${humanize(plan.pricingMethod)}${discount ? `, with a ${pct(discount)} discount` : ''}. Quoted implementation price ${x.m(impl.price)} at a ${pct(impl.marginPct)} gross margin.`,
      ],
      table: table(
        ['Price build-up', 'Amount'],
        [
          ['Labour cost', x.m(impl.laborCost)],
          ['Direct expenses', x.m(impl.directExpenses)],
          [`Contingency (${pct(plan.contingencyPct)})`, x.m(impl.contingency)],
          ['Implementation cost', x.m(impl.totalCost)],
          [`Fixed price at ${pct(plan.targetMarginPct)} margin`, x.m(impl.cpmPrice)],
          ['Time and materials value', x.m(impl.tmValue)],
          [`Discount (${pct(discount)})`, discount ? 'Applied' : 'None'],
          ['Quoted price', x.m(impl.price)],
          ['Gross profit', x.m(impl.grossProfit)],
          ['Gross margin', pct(impl.marginPct)],
        ],
      ),
    }),
  );

  // Run cost by pool
  const pools = activePools(x);
  const yearPool = (y: number, pool: (typeof pools)[number]) => sum(r.months.filter((m) => m.month > 0 && m.yearIndex === y).map((m) => m.costByPool[pool]));
  const termPool = (pool: (typeof pools)[number]) => sum(r.months.filter((m) => m.month > 0).map((m) => m.costByPool[pool]));
  out.push(
    section('Monthly run cost by cost pool', {
      paragraphs: [`Steady-state run cost is ${x.m(b.totalRunCost)} a month. Year 1 includes the volume ramp; later years include growth and inflation.`],
      kpis: [
        kpi('Monthly run cost', x.c(b.totalRunCost)),
        kpi('LLM share', shareOf(b.pools.LLM, b.totalRunCost)),
        kpi('Run cost, year 1', x.c(r.years[0]?.runCost ?? 0)),
        kpi('Run cost, full term', x.c(sum(r.years.map((y) => y.runCost)))),
      ],
      table: table(
        ['Cost pool', 'Steady monthly', 'Share', 'Year 1', 'Full term'],
        pools.map((pl) => [poolLabel(pl), x.m(b.pools[pl]), shareOf(b.pools[pl], b.totalRunCost), x.m(yearPool(0, pl)), x.m(termPool(pl))]),
        { footer: ['Total run cost', x.m(b.totalRunCost), '100.0%', x.m(r.years[0]?.runCost ?? 0), x.m(sum(r.years.map((y) => y.runCost)))] },
      ),
      chart: chart('bar', 'Steady-state monthly run cost by pool', pools.map(poolLabel), [{ name: 'Monthly cost', values: pools.map((pl) => b.pools[pl]) }], 'currency'),
    }),
  );

  // Unit economics
  out.push(unitEconomicsSection(x));
  return out;
}

export function unitEconomicsSection(x: Ctx): ReportSection {
  const { r } = x;
  const b = r.baseline;
  const t = b.totals;
  return section('Unit economics', {
    kpis: [
      kpi('Cost per attempted transaction', x.u(safeDiv(b.totalRunCost, t.attempted))),
      kpi('Cost per accepted transaction', x.u(safeDiv(b.totalRunCost, t.accepted))),
      kpi('Cost per accepted ABU', x.u(r.economics.provider.costToServePerAbu), 'Weighted by complexity'),
      kpi('LLM cost per accepted transaction', x.u(b.llm.perAccepted)),
    ],
    table: table(
      ['Workflow', 'Run cost', 'Attempted', 'Accepted', 'Weighted ABUs', 'Cost per accepted', 'Cost per ABU'],
      r.project.workflows.map((w) => {
        const v = b.volumes[w.id];
        const cost: Decimal = b.runCostByWorkflow[w.id] ?? D(0);
        return [w.name, x.m(cost), x.k(v.attempted), x.k(v.accepted), x.k(v.weightedAbus), x.u(safeDiv(cost, v.accepted)), x.u(safeDiv(cost, v.weightedAbus))];
      }),
      { footer: ['Total', x.m(b.totalRunCost), x.k(t.attempted), x.k(t.accepted), x.k(t.weightedAbus), x.u(safeDiv(b.totalRunCost, t.accepted)), x.u(r.economics.provider.costToServePerAbu)] },
    ),
  });
}
