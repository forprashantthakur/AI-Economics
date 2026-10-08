import { useMemo } from 'react';
import { sum, varianceAnalysis, type ProjectResult } from '@aies/engine';
import { ChartFrame, Lines, StackedBars, type SeriesDef } from '../../components/charts';
import { Badge, Panel, StatStrip, cx } from '../../components/ui';
import { compact, money, months, n, num, pct, periodLabel } from '../../lib/format';
import { monthsFor, PERIOD_LABEL, type Period } from '../../lib/slice';
import { useStore } from '../../state/store';

export const BENEFIT_STATUS: Record<string, { label: string; tone: 'neutral' | 'good' | 'warn' | 'bad' | 'brand' }> = {
  proposed: { label: 'Proposed', tone: 'warn' },
  finance_validated: { label: 'Finance validated', tone: 'good' },
  realized: { label: 'Realised', tone: 'brand' },
  rejected: { label: 'Rejected', tone: 'bad' },
};

export const BENEFIT_CATEGORY: Record<string, string> = {
  hard_savings: 'Hard savings',
  cost_avoidance: 'Cost avoidance',
  revenue: 'Revenue (contribution)',
  working_capital: 'Working capital',
  capacity_conversion: 'Capacity conversion',
};

export function ValueView({ r, period }: { r: ProjectResult; period: Period }) {
  const { state } = useStore();
  const cur = r.currency;
  const f = (v: number) => compact(v, cur);
  const c = r.economics.client;
  const rows = monthsFor(r, period);
  const periodBenefit = period === 'steady' ? r.steady.value.validated : sum(rows.map((m) => m.countedBenefit));
  const periodProductivity = period === 'steady' ? r.steady.value.productivityValue : sum(rows.map((m) => m.productivityValue));
  const variance = useMemo(() => varianceAnalysis(r, state.catalog), [r, state.catalog]);

  const cashSeries: SeriesDef[] = [{ key: 'cum', label: 'Cumulative net benefit to client', color: '--accent-series' }];
  const cash = r.months.map((m) => ({ period: m.month === 0 ? 'Start' : m.period, cum: n(m.clientCumulative) }));

  const yearSeries: SeriesDef[] = [
    { key: 'productivity', label: 'Productivity value (non-cash)', color: '--s1' },
    { key: 'validated', label: 'Validated financial benefit', color: '--s3' },
    { key: 'investment', label: 'Client AI investment', color: '--s2' },
  ];
  const years = r.years.map((y) => ({ label: y.label, productivity: n(y.productivityValue), validated: n(y.countedBenefit), investment: n(y.clientInvestment) }));

  return (
    <div className="space-y-5">
      <StatStrip
        items={[
          { label: `Validated benefits (${PERIOD_LABEL[period].toLowerCase()})`, value: compact(periodBenefit, cur), sub: r.project.value.includeUnvalidated ? 'Forecast view: includes proposed' : 'Finance-validated and realised only' },
          { label: 'Productivity value (non-cash)', value: compact(periodProductivity, cur), sub: `${num(c.steadyFteReleased, 1)} FTE of capacity released` },
          { label: 'Client ROI (full term)', value: pct(c.roiPct, 0), tone: n(c.roiPct) < 0 ? 'bad' : 'good', sub: `Year 1 ${pct(c.year1RoiPct, 0)}` },
          { label: 'Payback', value: months(c.paybackMonths), sub: 'From contract start' },
          { label: 'Net present value', value: compact(c.npv, cur), tone: n(c.npv) < 0 ? 'bad' : 'good', sub: `at ${r.project.value.discountRatePct}% discount rate` },
        ]}
      />

      <div className="grid gap-5 xl:grid-cols-2">
        <ChartFrame
          title="Client cash position over the term"
          description="Cumulative validated benefits minus everything the client pays (provider fees and internal costs). Payback is where the line crosses zero."
          table={{ columns: ['Month', 'Cumulative net'], rows: cash.map((d) => [d.period === 'Start' ? 'Start' : periodLabel(d.period), money(d.cum, cur, 0)]) }}
        >
          <Lines data={cash} series={cashSeries} xKey="period" format={f} labelFormat={(l) => (l === 'Start' ? l : periodLabel(l))} area="cum" reference={{ y: 0, label: 'Break-even' }} height={260} />
        </ChartFrame>
        <ChartFrame
          title="Productivity is not cash"
          description="Released capacity (non-cash) shown beside validated financial benefits and the client's investment, by contract year."
          legend={yearSeries}
          table={{ columns: ['Year', ...yearSeries.map((s) => s.label)], rows: years.map((y) => [y.label, money(y.productivity, cur, 0), money(y.validated, cur, 0), money(y.investment, cur, 0)]) }}
        >
          <StackedBars data={years} series={yearSeries} xKey="label" format={f} stacked={false} height={260} />
        </ChartFrame>
      </div>

      <Panel title="Benefit register" description="Only finance-validated or realised benefits count toward ROI. Overlapping benefits count once; capacity conversion is capped at released productivity value." padded={false}>
        <div className="scroll-x">
          <table className="dtable min-w-[900px]">
            <thead>
              <tr>
                <th>Benefit</th>
                <th>Category</th>
                <th>Status</th>
                <th className="r">Annual (gross)</th>
                <th className="r">Confidence</th>
                <th className="r">Counted / month at steady state</th>
                <th>Note</th>
              </tr>
            </thead>
            <tbody>
              {r.project.value.benefits.map((b) => {
                const line = r.steady.value.lines.find((l) => l.lineId === b.id);
                const counted = r.project.value.includeUnvalidated ? line?.countedForecast : line?.countedValidated;
                return (
                  <tr key={b.id}>
                    <td className="font-semibold max-w-[260px]">{b.name}</td>
                    <td className="text-[13px] text-ink-2">{BENEFIT_CATEGORY[b.category]}</td>
                    <td>
                      <Badge tone={BENEFIT_STATUS[b.status].tone}>{BENEFIT_STATUS[b.status].label}</Badge>
                    </td>
                    <td className="r">{compact(b.annualAmount, b.currency)}</td>
                    <td className="r">{pct(b.confidencePct, 0)}</td>
                    <td className={cx('r font-semibold', counted?.isZero() && 'text-ink-3')}>{compact(counted ?? 0, cur)}</td>
                    <td className="text-[12.5px] text-ink-3 max-w-[260px]">{line?.excludedReason ?? b.notes ?? ''}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Panel>

      <div className="grid gap-5 xl:grid-cols-2">
        <Panel title="Business outcomes" description="Operational KPIs agreed with the client — tracked, not monetised.">
          {r.project.value.kpis.length === 0 ? (
            <p className="text-sm text-ink-3">No KPIs defined. Add them in Value Realization.</p>
          ) : (
            <table className="dtable">
              <thead>
                <tr>
                  <th>KPI</th>
                  <th className="r">Before</th>
                  <th className="r">With AI</th>
                  <th className="r">Change</th>
                </tr>
              </thead>
              <tbody>
                {r.project.value.kpis.map((k) => {
                  const ch = k.before ? ((k.after - k.before) / Math.abs(k.before)) * 100 : 0;
                  const good = k.higherIsBetter ? ch >= 0 : ch <= 0;
                  return (
                    <tr key={k.id}>
                      <td>{k.name}</td>
                      <td className="r">
                        {k.before} {k.unit}
                      </td>
                      <td className="r">
                        {k.after} {k.unit}
                      </td>
                      <td className={cx('r font-semibold', good ? 'text-good' : 'text-bad')}>
                        {ch >= 0 ? '+' : '−'}
                        {Math.abs(ch).toFixed(0)}%
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </Panel>
        <Panel title="Realised vs forecast benefits" description="Benefits recorded with monthly actuals against the validated forecast for the same months.">
          {variance.byPeriod.length === 0 ? (
            <p className="text-sm text-ink-3">No actuals recorded yet. This project is a {r.project.status === 'pre_sales' ? 'pre-sales estimate' : 'delivery in progress'}.</p>
          ) : (
            <table className="dtable">
              <thead>
                <tr>
                  <th>Month</th>
                  <th className="r">Forecast</th>
                  <th className="r">Realised</th>
                  <th className="r">Realisation</th>
                </tr>
              </thead>
              <tbody>
                {variance.byPeriod.map((p) => {
                  const rate = p.forecastBenefit.isZero() ? 0 : n(p.realizedBenefit.div(p.forecastBenefit).times(100));
                  return (
                    <tr key={p.period}>
                      <td>{periodLabel(p.period)}</td>
                      <td className="r">{compact(p.forecastBenefit, cur)}</td>
                      <td className="r">{compact(p.realizedBenefit, cur)}</td>
                      <td className={cx('r font-semibold', rate < 90 ? 'text-warn' : 'text-good')}>{pct(rate, 0)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </Panel>
      </div>
    </div>
  );
}
