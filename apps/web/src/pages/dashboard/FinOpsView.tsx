import { useMemo } from 'react';
import { findOptimizations, safeDiv, sum, varianceAnalysis, type ProjectResult, POOL_LABELS, RUN_POOLS } from '@aies/engine';
import { BarList, ChartFrame, Lines, StackedBars, POOL_COLOR, type SeriesDef } from '../../components/charts';
import { Badge, Callout, Panel, StatStrip, cx } from '../../components/ui';
import { compact, money, n, pct, periodLabel, signedPct, tokens, unitPrice } from '../../lib/format';
import { agentName, modelName, type Period, type Slice } from '../../lib/slice';
import { useStore } from '../../state/store';

export function FinOpsView({ r, slice }: { r: ProjectResult; slice: Slice; period: Period }) {
  const { state } = useStore();
  const cur = r.currency;
  const f = (v: number) => compact(v, cur);
  const variance = useMemo(() => varianceAnalysis(r, state.catalog), [r, state.catalog]);
  const opts = useMemo(() => findOptimizations(r.project, state.catalog), [r.project, state.catalog]);
  const totalSaving = sum(opts.map((o) => o.monthlySaving));
  const hasActuals = variance.byPeriod.length > 0;
  const t = variance.totals;

  const trendSeries: SeriesDef[] = [
    { key: 'est', label: 'Estimated run cost', color: '--s1' },
    { key: 'act', label: 'Actual run cost', color: '--s2' },
  ];
  const trend = variance.byPeriod.map((p) => ({ period: p.period, est: n(p.estTotalCost), act: n(p.actTotalCost) }));

  const poolSeries: SeriesDef[] = RUN_POOLS.filter((p) => r.months.some((m) => !m.costByPool[p].isZero())).map((p) => ({ key: p, label: POOL_LABELS[p], color: POOL_COLOR[p] }));
  const projected = r.months.filter((m) => m.month > 0).map((m) => ({ period: m.period, ...Object.fromEntries(poolSeries.map((s) => [s.key, n(m.costByPool[s.key as keyof typeof m.costByPool])])) }));

  return (
    <div className="space-y-5">
      <StatStrip
        items={[
          {
            label: 'Budget variance to date',
            value: t ? signedPct(t.costVariancePct) : 'No actuals',
            tone: t ? (n(t.costVariancePct) > 5 ? 'bad' : n(t.costVariancePct) > 0 ? 'warn' : 'good') : 'neutral',
            sub: t ? `${n(t.costVariance) >= 0 ? '+' : '−'}${compact(t.costVariance.abs(), cur)} over ${variance.byPeriod.length} months` : 'Pre-deployment estimate only',
          },
          { label: 'Cost per ACU (fully loaded)', value: unitPrice(safeDiv(slice.runCost, slice.acus), cur), sub: `${tokens(slice.acus.div(slice.months || 1))} ACUs / month` },
          { label: 'Cost per weighted ABU', value: unitPrice(safeDiv(slice.runCost, slice.weightedAbus), cur), sub: `${tokens(slice.weightedAbus.div(slice.months || 1))} ABUs / month` },
          { label: 'LLM cost per month', value: compact(slice.llmCost.div(slice.months || 1), cur), sub: `${pct(safeDiv(slice.llmCost, slice.runCost).times(100), 0)} of run cost` },
          { label: 'Identified optimisation', value: compact(totalSaving, cur), sub: `${pct(safeDiv(totalSaving, r.baseline.totalRunCost).times(100), 0)} of monthly run cost (not additive)`, tone: 'good' },
        ]}
      />

      {hasActuals ? (
        <ChartFrame
          title="Estimated vs actual run cost"
          description="Monthly actuals recorded after go-live against the estimate for the same month (ramp and growth included)."
          legend={trendSeries}
          legendShape="line"
          table={{ columns: ['Month', 'Estimated', 'Actual', 'Variance'], rows: variance.byPeriod.map((p) => [periodLabel(p.period), money(p.estTotalCost, cur, 0), money(p.actTotalCost, cur, 0), signedPct(p.costVariancePct)]) }}
        >
          <Lines data={trend} series={trendSeries} xKey="period" format={f} labelFormat={periodLabel} height={260} />
        </ChartFrame>
      ) : (
        <ChartFrame
          title="Projected run cost by pool"
          description="No actuals yet — this is the estimate across the contract term. Record actuals on the project page after go-live to track variance."
          legend={poolSeries}
          table={{ columns: ['Month', ...poolSeries.map((s) => s.label)], rows: projected.map((d) => [periodLabel(d.period), ...poolSeries.map((s) => money(Number((d as Record<string, unknown>)[s.key] ?? 0), cur, 0))]) }}
        >
          <StackedBars data={projected} series={poolSeries} xKey="period" format={f} labelFormat={periodLabel} height={260} />
        </ChartFrame>
      )}

      <div className="grid gap-5 xl:grid-cols-2">
        <Panel title="Cost by model" description={slice.label}>
          <BarList
            items={Object.entries(slice.llmByModel)
              .sort((a, b) => b[1].cmp(a[1]))
              .map(([id, v]) => ({ label: modelName(r, id), value: n(v) }))}
            format={f}
            color="--s1"
          />
        </Panel>
        <Panel title="LLM cost by agent" description={slice.label}>
          <BarList
            items={Object.entries(slice.llmByAgent)
              .sort((a, b) => b[1].cmp(a[1]))
              .map(([id, v]) => ({ label: agentName(r, id), value: n(v) }))}
            format={f}
            color="--s1"
          />
        </Panel>
      </div>

      {hasActuals && (
        <Panel title="Budget variance by month" description="Actual versus estimate. Unit costs use accepted transactions as the denominator." padded={false}>
          <div className="scroll-x">
            <table className="dtable min-w-[900px]">
              <thead>
                <tr>
                  <th>Month</th>
                  <th className="r">Transactions est. / act.</th>
                  <th className="r">Tokens est. / act.</th>
                  <th className="r">LLM est. / act.</th>
                  <th className="r">Total est. / act.</th>
                  <th className="r">Variance</th>
                  <th className="r">Cost per accepted est. / act.</th>
                </tr>
              </thead>
              <tbody>
                {variance.byPeriod.map((p) => (
                  <tr key={p.period}>
                    <td className="font-semibold">{periodLabel(p.period)}</td>
                    <td className="r">
                      {tokens(p.estAttempted)} / {tokens(p.actAttempted)}
                    </td>
                    <td className="r">
                      {tokens(p.estTokens)} / {tokens(p.actTokens)}
                    </td>
                    <td className="r">
                      {compact(p.estLlmCost, cur)} / {compact(p.actLlmCost, cur)}
                    </td>
                    <td className="r">
                      {compact(p.estTotalCost, cur)} / {compact(p.actTotalCost, cur)}
                    </td>
                    <td className={cx('r font-semibold', n(p.costVariancePct) > 5 ? 'text-bad' : n(p.costVariancePct) > 0 ? 'text-warn' : 'text-good')}>{signedPct(p.costVariancePct)}</td>
                    <td className="r">
                      {unitPrice(p.estCostPerAccepted, cur)} / {unitPrice(p.actCostPerAccepted, cur)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      )}

      <Panel title="Optimisation opportunities" description="Each saving is computed by re-running the cost model with the change applied. Savings overlap, so they are not additive.">
        {opts.length === 0 ? (
          <Callout>No material optimisation found at current assumptions.</Callout>
        ) : (
          <ul className="divide-y divide-line-soft">
            {opts.map((o) => (
              <li key={o.id} className="py-3 first:pt-0 last:pb-0 grid gap-1 sm:grid-cols-[1fr_auto] sm:gap-6">
                <div className="min-w-0">
                  <div className="font-semibold text-ink">{o.title}</div>
                  <p className="text-[13.5px] text-ink-2 mt-0.5">{o.detail}</p>
                  <p className="text-[12.5px] text-ink-3 mt-0.5">Trade-off: {o.tradeOff}</p>
                </div>
                <div className="sm:text-right">
                  <div className="num font-semibold text-good">−{compact(o.monthlySaving, cur)}/mo</div>
                  <Badge tone="neutral">{pct(o.savingPct)} of run cost</Badge>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}
