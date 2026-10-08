import { D, findOptimizations, safeDiv, sum, varianceAnalysis, type Decimal } from '@aies/engine';
import type { ReportSection } from '../types';
import { decimal, pct, periodLabel, signedPct, tokens } from '../format';
import { poolLabel } from '../util';
import { activePools, chart, kpi, section, shareOf, table, type Ctx } from './common';

export function finopsAssessment(x: Ctx): ReportSection[] {
  const { r, catalog } = x;
  const p = r.project;
  const b = r.baseline;
  const out: ReportSection[] = [];
  const tk = b.llm.tokens;
  const inputBilled = tk.input;
  const cacheRead = tk.cacheRead;
  const cacheShare = safeDiv(cacheRead, inputBilled).times(100);
  const batchSaving = sum(b.llmLines.map((l) => l.batchSaving));

  out.push(
    section('Consumption overview', {
      paragraphs: [
        `At steady state the solution makes ${x.k(tk.calls)} model calls a month, processing ${tokens(tk.input)} input tokens (${pct(cacheShare)} served from prompt cache) and generating ${tokens(tk.output)} output and ${tokens(tk.reasoning)} reasoning tokens. LLM consumption is ${shareOf(b.llm.total, b.totalRunCost)} of run cost.`,
      ],
      kpis: [
        kpi('Monthly run cost', x.c(b.totalRunCost)),
        kpi('LLM cost', x.c(b.llm.total), shareOf(b.llm.total, b.totalRunCost) + ' of run cost'),
        kpi('Model calls per month', x.k(tk.calls)),
        kpi('Cache-read share of input', pct(cacheShare)),
        kpi('LLM cost per attempted', x.u(b.llm.perAttempted)),
        kpi('LLM cost per accepted', x.u(b.llm.perAccepted)),
      ],
    }),
  );

  // By model
  const models = Object.entries(b.llm.byModel).sort((a, c) => c[1].cmp(a[1]));
  const callsByModel = (id: string) => sum(b.llmLines.filter((l) => l.modelId === id).map((l) => l.calls));
  const tokByModel = (id: string, f: (l: (typeof b.llmLines)[number]) => Decimal) => sum(b.llmLines.filter((l) => l.modelId === id).map(f));
  out.push(
    section('LLM consumption by model', {
      table: table(
        ['Model', 'Calls', 'Input tokens', 'Cache reads', 'Output + reasoning', 'Monthly cost', 'Share'],
        models.map(([id, cost]) => [
          x.nm.model(id),
          x.k(callsByModel(id)),
          tokens(tokByModel(id, (l) => l.inputTokens)),
          tokens(tokByModel(id, (l) => l.cacheReadTokens)),
          tokens(tokByModel(id, (l) => l.outputTokens.plus(l.reasoningTokens))),
          x.m(cost),
          shareOf(cost, b.llm.total),
        ]),
        { footer: ['Total', x.k(tk.calls), tokens(tk.input), tokens(tk.cacheRead), tokens(tk.output.plus(tk.reasoning)), x.m(b.llm.total), '100.0%'] },
      ),
      chart: chart('bar', 'Monthly LLM cost by model', models.map(([id]) => x.nm.model(id)), [{ name: 'LLM cost', values: models.map(([, c]) => c) }], 'currency'),
    }),
  );

  // By agent (fully loaded)
  const agents = Object.keys(b.runCostByAgent);
  out.push(
    section('Cost by agent', {
      paragraphs: ['Fully loaded cost allocates each workflow’s total run cost to its agents in proportion to their LLM cost; LLM cost is the direct token spend.'],
      table: table(
        ['Agent', 'LLM cost', 'Fully loaded run cost', 'ACUs', 'Share of run cost'],
        agents.map((a) => [x.nm.agent(a), x.m(b.llm.byAgent[a] ?? 0), x.m(b.runCostByAgent[a]), x.k(b.acu.byAgent[a] ?? 0), shareOf(b.runCostByAgent[a], b.totalRunCost)]),
        { footer: ['Total', x.m(b.llm.total), x.m(b.totalRunCost), x.k(b.acu.total), '100.0%'] },
      ),
    }),
  );

  // By workflow
  out.push(
    section('Cost by workflow', {
      table: table(
        ['Workflow', 'LLM cost', 'Other run cost', 'Total run cost', 'Per attempted', 'Per accepted', 'Failed / rejected work'],
        p.workflows.map((w) => {
          const v = b.volumes[w.id];
          const tot = b.runCostByWorkflow[w.id] ?? D(0);
          const llm = b.llm.byWorkflow[w.id] ?? D(0);
          return [w.name, x.m(llm), x.m(tot.minus(llm)), x.m(tot), x.u(safeDiv(tot, v.attempted)), x.u(safeDiv(tot, v.accepted)), x.m(b.failureCostByWorkflow[w.id] ?? 0)];
        }),
        { footer: ['Total', x.m(b.llm.total), x.m(b.totalRunCost.minus(b.llm.total)), x.m(b.totalRunCost), x.u(safeDiv(b.totalRunCost, b.totals.attempted)), x.u(safeDiv(b.totalRunCost, b.totals.accepted)), x.m(sum(Object.values(b.failureCostByWorkflow)))] },
      ),
      chart: chart(
        'stacked-bar',
        'Run cost by workflow and pool',
        p.workflows.map((w) => w.name),
        activePools(x).map((pl) => ({ name: poolLabel(pl), values: p.workflows.map((w) => b.poolsByWorkflow[w.id]?.[pl] ?? 0) })),
        'currency',
      ),
    }),
  );

  // Tokens and caching by step
  out.push(
    section('Tokens and caching by step', {
      paragraphs: [
        `Every input token is billed exactly once: uncached + cache-read + cache-write tokens equal input tokens. Batch pricing saves ${x.m(batchSaving)} a month on batch-eligible traffic.`,
      ],
      table: table(
        ['Workflow / step', 'Model', 'Calls', 'Input per call', 'Cache hit', 'Cache reads', 'Cache writes', 'Cost per call', 'Monthly cost'],
        b.llmLines.map((l) => {
          const wf = p.workflows.find((w) => w.id === l.workflowId);
          const st = wf?.llmSteps.find((s) => s.id === l.stepId);
          return [
            `${wf?.name ?? ''} — ${l.stepName}`,
            x.nm.model(l.modelId),
            x.k(l.calls),
            x.k(safeDiv(l.inputTokens, l.calls)),
            st ? pct(st.cacheHitRatePct, 0) : '',
            tokens(l.cacheReadTokens),
            tokens(l.cacheWriteTokens),
            x.u(l.costPerCall),
            x.m(l.cost),
          ];
        }),
        { align: ['left', 'left', 'right', 'right', 'right', 'right', 'right', 'right', 'right'], footer: ['Total', '', x.k(tk.calls), '', '', tokens(tk.cacheRead), tokens(tk.cacheWrite), '', x.m(b.llm.total)] },
      ),
    }),
  );

  // Unit costs
  out.push(
    section('Unit costs', {
      table: table(
        ['Measure', 'Value'],
        [
          ['Run cost per attempted transaction', x.u(safeDiv(b.totalRunCost, b.totals.attempted))],
          ['Run cost per accepted transaction', x.u(safeDiv(b.totalRunCost, b.totals.accepted))],
          ['Run cost per weighted ABU', x.u(safeDiv(b.totalRunCost, b.totals.weightedAbus))],
          ['Run cost per ACU', x.u(safeDiv(b.totalRunCost, b.acu.total))],
          ['Marginal cost per ACU', x.u(r.marginal.perAcu)],
          ['Marginal cost per weighted ABU', x.u(r.marginal.perAbu)],
          ['LLM cost per model call', x.u(safeDiv(b.llm.total, tk.calls))],
          ['LLM cost per 1M input tokens (blended)', x.u(safeDiv(b.llm.total, tk.input).times(1_000_000))],
          ['Execution-equivalents per accepted', decimal(safeDiv(sum(Object.values(b.volumes).map((v) => v.executionEquivalents)), b.totals.accepted), 3)],
        ],
      ),
    }),
  );

  // Variance
  const va = varianceAnalysis(r, catalog);
  if (va.totals) {
    const t = va.totals;
    out.push(
      section('Estimate versus actual', {
        paragraphs: [
          `${va.byPeriod.length} month(s) of actuals are recorded. Actual run cost is ${x.m(t.actTotalCost)} against an estimate of ${x.m(t.estTotalCost)} for the same months — a variance of ${x.m(t.costVariance)} (${signedPct(t.costVariancePct)}). Actual cost per accepted transaction is ${x.u(t.actCostPerAccepted)} against ${x.u(t.estCostPerAccepted)} estimated.`,
        ],
        kpis: [
          kpi('Cost variance', signedPct(t.costVariancePct), x.m(t.costVariance)),
          kpi('Actual cost per accepted', x.u(t.actCostPerAccepted)),
          kpi('Volume variance', signedPct(safeDiv(t.actAttempted.minus(t.estAttempted), t.estAttempted).times(100))),
          kpi('Realised vs forecast benefit', signedPct(safeDiv(t.realizedBenefit.minus(t.forecastBenefit), t.forecastBenefit).times(100))),
        ],
        table: table(
          ['Period', 'Est. attempted', 'Act. attempted', 'Est. LLM', 'Act. LLM', 'Est. total', 'Act. total', 'Variance', 'Act. per accepted'],
          va.byPeriod.map((row) => [periodLabel(row.period), x.k(row.estAttempted), x.k(row.actAttempted), x.m(row.estLlmCost), x.m(row.actLlmCost), x.m(row.estTotalCost), x.m(row.actTotalCost), signedPct(row.costVariancePct), x.u(row.actCostPerAccepted)]),
          { footer: ['Total', x.k(t.estAttempted), x.k(t.actAttempted), x.m(t.estLlmCost), x.m(t.actLlmCost), x.m(t.estTotalCost), x.m(t.actTotalCost), signedPct(t.costVariancePct), x.u(t.actCostPerAccepted)] },
        ),
        chart: chart(
          'line',
          'Estimated versus actual run cost',
          va.byPeriod.map((row) => periodLabel(row.period)),
          [
            { name: 'Estimate', values: va.byPeriod.map((row) => row.estTotalCost) },
            { name: 'Actual', values: va.byPeriod.map((row) => row.actTotalCost) },
          ],
          'currency',
        ),
      }),
    );
  } else {
    out.push(section('Estimate versus actual', { paragraphs: ['No actuals have been recorded yet. Variance analysis starts once monthly consumption, cost and benefit actuals are loaded after go-live.'] }));
  }

  // Optimisations
  const opts = findOptimizations(p, catalog);
  const totalSaving = sum(opts.map((o) => o.monthlySaving));
  out.push(
    section('Optimisation opportunities', {
      paragraphs: [
        opts.length
          ? `Each opportunity is evaluated by re-running the cost model on a modified copy of the project. Savings are not additive — opportunities interact — but the largest ("${opts[0].title}") saves ${x.m(opts[0].monthlySaving)} a month.`
          : 'No optimisation above 0.1% of run cost was found.',
      ],
      table: opts.length
        ? table(
            ['Opportunity', 'Monthly saving', 'Of run cost', 'Annualised', 'Trade-off'],
            opts.map((o) => [`${o.title}. ${o.detail}`, x.m(o.monthlySaving), pct(o.savingPct), x.m(o.monthlySaving.times(12)), o.tradeOff]),
            { align: ['left', 'right', 'right', 'right', 'left'], footer: ['Sum if independent (upper bound)', x.m(totalSaving), pct(safeDiv(totalSaving, b.totalRunCost).times(100)), x.m(totalSaving.times(12)), ''] },
          )
        : undefined,
    }),
  );
  return out;
}
