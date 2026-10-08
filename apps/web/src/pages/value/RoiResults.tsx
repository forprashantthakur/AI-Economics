import { useMemo } from 'react';
import { sum, varianceAnalysis, ZERO, type ProjectResult } from '@aies/engine';
import { ChartFrame, Lines, StackedBars, type SeriesDef } from '../../components/charts';
import { Panel, cx } from '../../components/ui';
import { compact, money, months as fmtMonths, n, pct, periodLabel, unitPrice } from '../../lib/format';
import { useStore } from '../../state/store';
import { CATEGORY_COLOR, CATEGORY_LABEL, CATEGORY_ORDER } from './shared';

/** Benefits by category per contract year (stacked) and the client's cumulative cash position. */
export function RoiCharts({ r }: { r: ProjectResult }) {
  const cur = r.currency;
  const f = (v: number) => compact(v, cur);
  // Year roll-up of the engine's monthly per-category benefit (aggregation only).
  const cats = CATEGORY_ORDER.filter((c) => r.months.some((m) => !m.benefitByCategory[c].isZero()));
  const series: SeriesDef[] = cats.map((c) => ({ key: c, label: CATEGORY_LABEL[c], color: CATEGORY_COLOR[c] }));
  const years = r.years.map((y, i) => {
    const rows = r.months.filter((m) => (m.month === 0 ? i === 0 : m.yearIndex === i));
    return { label: y.label, ...Object.fromEntries(cats.map((c) => [c, n(sum(rows.map((m) => m.benefitByCategory[c])))])) } as Record<string, string | number>;
  });
  const cashSeries: SeriesDef[] = [{ key: 'cum', label: 'Cumulative client cash position', color: '--accent-series' }];
  const cash = r.months.map((m) => ({ period: m.month === 0 ? 'Start' : m.period, cum: n(m.clientCumulative) }));
  const view = r.project.value.includeUnvalidated ? 'forecast view, including proposed benefits' : 'validated and realised benefits only';

  return (
    <div className="grid gap-5 xl:grid-cols-2">
      <ChartFrame
        title="Counted benefits by category"
        description={`By contract year, ${view}. Productivity value is not included.`}
        legend={series}
        table={{ columns: ['Year', ...series.map((s) => s.label)], rows: years.map((y) => [String(y.label), ...cats.map((c) => money(Number(y[c] ?? 0), cur, 0))]) }}
      >
        {cats.length ? (
          <StackedBars data={years} series={series} xKey="label" format={f} height={260} />
        ) : (
          <p className="text-sm text-ink-3 px-2 py-16 text-center">No benefits are counted in this view. Validate benefits, or switch on the forecast view.</p>
        )}
      </ChartFrame>
      <ChartFrame
        title="Client cash position"
        description="Cumulative counted benefits minus everything the client pays: provider fees and internal costs. Payback is where the line crosses zero."
        table={{ columns: ['Month', 'Cumulative position'], rows: cash.map((d) => [d.period === 'Start' ? 'Start' : periodLabel(d.period), money(d.cum, cur, 0)]) }}
      >
        <Lines data={cash} series={cashSeries} xKey="period" format={f} labelFormat={(l) => (l === 'Start' ? l : periodLabel(l))} area="cum" reference={{ y: 0, label: 'Break-even' }} height={260} />
      </ChartFrame>
    </div>
  );
}

export function RoiByYear({ r }: { r: ProjectResult }) {
  const cur = r.currency;
  const c = r.economics.client;
  return (
    <Panel title="Return on investment by year" description="Investment is everything the client pays the provider plus its internal costs. Year 1 includes implementation." padded={false}>
      <div className="scroll-x">
        <table className="dtable min-w-[880px]">
          <thead>
            <tr>
              <th>Year</th>
              <th className="r">Validated benefits</th>
              <th className="r">Forecast benefits</th>
              <th className="r">Counted in ROI</th>
              <th className="r">Productivity value (non-cash)</th>
              <th className="r">Client investment</th>
              <th className="r">Net benefit</th>
              <th className="r">ROI</th>
            </tr>
          </thead>
          <tbody>
            {r.years.map((y) => (
              <tr key={y.year}>
                <td className="font-semibold">{y.label}</td>
                <td className="r">{compact(y.validatedBenefit, cur)}</td>
                <td className="r">{compact(y.forecastBenefit, cur)}</td>
                <td className="r font-semibold">{compact(y.countedBenefit, cur)}</td>
                <td className="r text-ink-3">{compact(y.productivityValue, cur)}</td>
                <td className="r">{compact(y.clientInvestment, cur)}</td>
                <td className={cx('r', y.clientNet.lt(0) && 'text-bad')}>{compact(y.clientNet, cur)}</td>
                <td className={cx('r font-semibold', y.roiPct.lt(0) ? 'text-bad' : 'text-good')}>{pct(y.roiPct, 0)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td>Full term</td>
              <td className="r">{compact(c.validatedBenefits, cur)}</td>
              <td className="r">{compact(c.forecastBenefits, cur)}</td>
              <td className="r">{compact(c.countedBenefits, cur)}</td>
              <td className="r">{compact(c.productivityValue, cur)}</td>
              <td className="r">{compact(c.totalInvestment, cur)}</td>
              <td className={cx('r', c.netBenefit.lt(0) && 'text-bad')}>{compact(c.netBenefit, cur)}</td>
              <td className={cx('r', c.roiPct.lt(0) ? 'text-bad' : 'text-good')}>{pct(c.roiPct, 0)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
      <div className="grid gap-x-6 px-4 py-3 border-t border-line-soft text-[13.5px] sm:grid-cols-3">
        <div className="flex justify-between gap-3 py-1">
          <span className="text-ink-2">Payback</span>
          <span className="num font-semibold">{fmtMonths(c.paybackMonths)}</span>
        </div>
        <div className="flex justify-between gap-3 py-1">
          <span className="text-ink-2">NPV at {r.project.value.discountRatePct}%</span>
          <span className={cx('num font-semibold', c.npv.lt(0) && 'text-bad')}>{compact(c.npv, cur)}</span>
        </div>
        <div className="flex justify-between gap-3 py-1">
          <span className="text-ink-2">Cost per successful outcome</span>
          <span className="num font-semibold">{unitPrice(c.costPerOutcome, cur)}</span>
        </div>
      </div>
    </Panel>
  );
}

export function RealisedVsForecast({ r }: { r: ProjectResult }) {
  const { state } = useStore();
  const cur = r.currency;
  const variance = useMemo(() => varianceAnalysis(r, state.catalog), [r, state.catalog]);
  const t = variance.totals;
  const rate = (f: typeof ZERO, a: typeof ZERO) => (f.isZero() ? null : n(a.div(f).times(100)));
  return (
    <Panel title="Realised vs forecast benefits" description="Benefits recorded with monthly actuals against the validated forecast for the same months." padded={false}>
      {variance.byPeriod.length === 0 ? (
        <p className="px-4 pb-4 text-sm text-ink-3">
          No actuals recorded yet.{' '}
          {r.project.status === 'pre_sales' ? 'This is a pre-sales estimate; record actuals on the project page after go-live.' : 'Record monthly actuals on the project page to track realisation.'}
        </p>
      ) : (
        <div className="scroll-x">
          <table className="dtable min-w-[520px]">
            <thead>
              <tr>
                <th>Month</th>
                <th className="r">Forecast (validated)</th>
                <th className="r">Realised</th>
                <th className="r">Gap</th>
                <th className="r">Realisation</th>
              </tr>
            </thead>
            <tbody>
              {variance.byPeriod.map((p) => {
                const rr = rate(p.forecastBenefit, p.realizedBenefit);
                return (
                  <tr key={p.period}>
                    <td>{periodLabel(p.period)}</td>
                    <td className="r">{compact(p.forecastBenefit, cur)}</td>
                    <td className="r">{compact(p.realizedBenefit, cur)}</td>
                    <td className={cx('r', p.realizedBenefit.lt(p.forecastBenefit) && 'text-warn')}>{compact(p.realizedBenefit.minus(p.forecastBenefit), cur)}</td>
                    <td className={cx('r font-semibold', rr !== null && (rr < 90 ? 'text-warn' : 'text-good'))}>{rr === null ? '—' : pct(rr, 0)}</td>
                  </tr>
                );
              })}
            </tbody>
            {t && (
              <tfoot>
                <tr>
                  <td>To date</td>
                  <td className="r">{compact(t.forecastBenefit, cur)}</td>
                  <td className="r">{compact(t.realizedBenefit, cur)}</td>
                  <td className="r">{compact(t.realizedBenefit.minus(t.forecastBenefit), cur)}</td>
                  <td className="r">{rate(t.forecastBenefit, t.realizedBenefit) === null ? '—' : pct(rate(t.forecastBenefit, t.realizedBenefit), 0)}</td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      )}
    </Panel>
  );
}
