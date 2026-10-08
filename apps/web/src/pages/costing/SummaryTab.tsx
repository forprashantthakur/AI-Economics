import { POOL_LABELS, RUN_POOLS, safeDiv, sum, type Project, type ProjectResult } from '@aies/engine';
import { BarList, ChartFrame, CompositionBar, StackedBars, POOL_COLOR, type SeriesDef } from '../../components/charts';
import { IssueList, KeyValues, Panel, StatStrip } from '../../components/ui';
import { compact, money, n, pct, periodLabel, unitPrice } from '../../lib/format';
import { workflowName } from '../../lib/slice';
import { issuesWith } from './common';

const SUMMARY_ISSUES = [
  'UNRECOVERED_POOL',
  'DOUBLE_RECOVERY',
  'DUPLICATE_COMPONENT',
  'LLM_IN_COST_LINE',
  'GPU_DOUBLE_COUNT',
  'REVIEW_DOUBLE_COUNT',
  'SCHEDULE',
  'UNKNOWN_MODEL',
  'CONTEXT_WINDOW',
  'FX_MISSING',
  'NO_WORKFLOWS',
  'SAMPLE_RATES',
];

export function SummaryTab({ result }: { project: Project; result: ProjectResult }) {
  const cur = result.currency;
  const f = (v: number) => compact(v, cur);
  const b = result.baseline;
  const impl = result.implementation;
  const runMonths = result.months.filter((m) => m.month > 0);
  const termCost = result.economics.provider.totalCost;
  const threeYearRun = sum(result.years.slice(0, 3).map((y) => y.runCost));
  const horizon = Math.min(36, runMonths.length);
  const poolSeries: SeriesDef[] = RUN_POOLS.filter((p) => runMonths.some((m) => !m.costByPool[p].isZero())).map((p) => ({ key: p, label: POOL_LABELS[p], color: POOL_COLOR[p] }));
  const projected = runMonths.map((m) => ({ period: m.period, ...Object.fromEntries(poolSeries.map((s) => [s.key, n(m.costByPool[s.key as keyof typeof m.costByPool])])) }));
  const issues = issuesWith(result, SUMMARY_ISSUES);
  const costPerAbu = result.economics.provider.costToServePerAbu;
  const failure = sum(Object.values(b.failureCostByWorkflow));

  return (
    <div className="space-y-5">
      <StatStrip
        items={[
          { label: 'Run cost per month', value: compact(b.totalRunCost, cur), sub: 'Steady state, contract year 1' },
          { label: 'Cost to serve per weighted ABU', value: unitPrice(costPerAbu, cur), sub: `${unitPrice(safeDiv(b.totalRunCost, b.totals.accepted), cur)} per accepted transaction` },
          { label: 'Implementation cost', value: compact(impl.totalCost, cur), sub: `One-time, priced at ${compact(impl.price, cur)}` },
          { label: `Run cost over ${horizon} months`, value: compact(threeYearRun, cur), sub: horizon < 36 ? `Contract term is ${runMonths.length} months` : 'Includes ramp-up, growth and inflation' },
          {
            label: 'Failure and rework cost',
            value: compact(failure, cur),
            sub: `${pct(safeDiv(failure, b.totalRunCost).times(100), 0)} of monthly run cost`,
            tone: n(safeDiv(failure, b.totalRunCost)) > 0.15 ? 'warn' : 'neutral',
          },
        ]}
      />

      <Panel title="Run cost by pool" description="Steady-state month. Each pool is computed once and allocated, so every breakdown below reconciles to this total.">
        <CompositionBar parts={RUN_POOLS.map((p) => ({ key: p, label: POOL_LABELS[p], value: n(b.pools[p]), color: POOL_COLOR[p] }))} format={f} />
      </Panel>

      <div className="grid gap-5 xl:grid-cols-2">
        <Panel title="Run cost by workflow" description="Fully loaded: LLM, execution lines, human review and allocated shared cost.">
          <BarList
            items={Object.entries(b.runCostByWorkflow)
              .sort((a, c) => c[1].cmp(a[1]))
              .map(([id, v]) => ({ label: workflowName(result, id), value: n(v), sub: `${unitPrice(safeDiv(v, b.volumes[id]?.weightedAbus ?? 0), cur)} per weighted ABU` }))}
            format={f}
          />
        </Panel>
        <Panel title="Run cost by business function">
          <BarList
            items={Object.entries(b.runCostByFunction)
              .sort((a, c) => c[1].cmp(a[1]))
              .map(([k, v]) => ({ label: k, value: n(v) }))}
            format={f}
          />
        </Panel>
      </div>

      <ChartFrame
        title="Projected monthly run cost by pool"
        description={`Over the ${runMonths.length}-month term, including ramp-up, volume growth, cost inflation and LLM price trend.`}
        legend={poolSeries}
        table={{
          columns: ['Month', ...poolSeries.map((s) => s.label), 'Total'],
          rows: runMonths.map((m) => [periodLabel(m.period), ...poolSeries.map((s) => money(m.costByPool[s.key as keyof typeof m.costByPool], cur, 0)), money(m.runCost, cur, 0)]),
        }}
      >
        <StackedBars data={projected} series={poolSeries} xKey="period" format={f} labelFormat={periodLabel} height={280} />
      </ChartFrame>

      <div className="grid gap-5 xl:grid-cols-[1fr_1.2fr]">
        <Panel title="Implementation versus run cost" description="Provider cost, before any pricing.">
          <BarList
            items={[{ label: 'Implementation (one-time)', value: n(impl.totalCost), color: POOL_COLOR.IMPLEMENTATION }, ...result.years.map((y) => ({ label: `${y.label} run cost`, value: n(y.runCost) }))]}
            format={f}
          />
          <KeyValues
            className="mt-4"
            rows={[
              ['Total provider cost over the term', money(termCost, cur, 0)],
              ['Implementation share of total', pct(safeDiv(impl.totalCost, termCost).times(100))],
              ['Implementation amortised per month', money(safeDiv(impl.totalCost, Math.max(1, runMonths.length)), cur, 0)],
            ]}
          />
        </Panel>
        <Panel title="Cost to serve by workflow" description="Steady-state cost per accepted outcome, including the cost of failures and rework." padded={false}>
          <div className="scroll-x">
            <table className="dtable min-w-[560px]">
              <thead>
                <tr>
                  <th>Workflow</th>
                  <th className="r">Run cost / month</th>
                  <th className="r">Weighted ABUs</th>
                  <th className="r">Per weighted ABU</th>
                  <th className="r">Failure share</th>
                </tr>
              </thead>
              <tbody>
                {result.project.workflows.map((w) => {
                  const cost = b.runCostByWorkflow[w.id];
                  const v = b.volumes[w.id];
                  return (
                    <tr key={w.id}>
                      <td className="font-semibold">{w.name}</td>
                      <td className="r">{money(cost ?? 0, cur, 0)}</td>
                      <td className="r">{n(v?.weightedAbus).toLocaleString('en-IN', { maximumFractionDigits: 0 })}</td>
                      <td className="r font-semibold">{unitPrice(safeDiv(cost ?? 0, v?.weightedAbus ?? 0), cur)}</td>
                      <td className="r">{pct(safeDiv(b.failureCostByWorkflow[w.id] ?? 0, cost ?? 0).times(100), 0)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Panel>
      </div>

      <Panel title="Cost model checks" description="Double counting, unrecovered pools, schedule and rate problems that affect these totals.">
        <IssueList issues={issues} empty="No cost model issues." />
      </Panel>
    </div>
  );
}
