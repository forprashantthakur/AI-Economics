import { ZERO, marginPct, sum, type Decimal, type ProjectResult } from '@aies/engine';
import { KeyValues, Panel, cx } from '../../components/ui';
import { compact, compactCount, money, n, pct, unitPrice } from '../../lib/format';
import { priceText } from './shared';

/** Per-stream revenue, attributed provider cost, gross profit and margin — steady month and full term. */
export function StreamResults({ r }: { r: ProjectResult }) {
  const cur = r.currency;
  const pr = r.project.pricing;
  const enabled = pr.streams.filter((s) => s.enabled);
  const term = (key: 'revenueByStream' | 'costByStream', id: string): Decimal => sum(r.months.map((m) => m[key][id] ?? ZERO));
  const ids = [...enabled.map((s) => s.id), 'unrecovered'];
  const rows = ids
    .map((id) => {
      const s = enabled.find((x) => x.id === id);
      const sp = r.priceBook.streams.find((x) => x.streamId === id);
      const sRev = r.steady.revenueByStream[id] ?? ZERO;
      const sCost = r.steady.costByStream[id] ?? ZERO;
      const tRev = term('revenueByStream', id);
      const tCost = term('costByStream', id);
      return { id, s, sp, sRev, sCost, tRev, tCost };
    })
    .filter((x) => x.s || !x.tCost.isZero());
  const Money = ({ v, bad }: { v: Decimal; bad?: boolean }) => <td className={cx('r', bad && v.lt(0) && 'text-bad font-semibold')}>{money(v, cur, 0)}</td>;
  const Margin = ({ rev, cost }: { rev: Decimal; cost: Decimal }) => {
    if (rev.isZero()) return <td className="r text-ink-3">—</td>;
    const m = marginPct(rev, cost);
    return <td className={cx('r font-semibold', m.lt(0) && 'text-bad')}>{pct(m)}</td>;
  };

  return (
    <Panel
      title="Results by revenue stream"
      description="Client revenue against the provider cost of the pools each stream recovers. The steady month is a fully ramped month in contract year 1; the full term includes ramp, growth, escalation and the implementation month."
      padded={false}
    >
      <div className="scroll-x">
        <table className="dtable min-w-[1080px]">
          <thead>
            <tr>
              <th rowSpan={2} className="align-bottom">
                Stream
              </th>
              <th rowSpan={2} className="r align-bottom">
                Price
              </th>
              <th colSpan={4} className="!text-center border-l border-line-soft">
                Steady month
              </th>
              <th colSpan={4} className="!text-center border-l border-line-soft">
                Full term ({pr.termMonths} months)
              </th>
            </tr>
            <tr>
              <th className="r border-l border-line-soft">Client revenue</th>
              <th className="r">Provider cost</th>
              <th className="r">Gross profit</th>
              <th className="r">Margin</th>
              <th className="r border-l border-line-soft">Client revenue</th>
              <th className="r">Provider cost</th>
              <th className="r">Gross profit</th>
              <th className="r">Margin</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ id, s, sp, sRev, sCost, tRev, tCost }) => (
              <tr key={id}>
                <td className="font-semibold">{s ? s.label : <span className="text-bad">Unrecovered cost</span>}</td>
                <td className="r whitespace-nowrap text-[13px] text-ink-2">{s ? priceText(s, sp, cur, pr.passThroughMarkupPct, pr.gainshare.sharePct) : '—'}</td>
                {s?.type === 'fixed_fee' ? (
                  <td colSpan={4} className="r text-[13px] text-ink-3 border-l border-line-soft">
                    One-time, billed at contract start
                  </td>
                ) : (
                  <>
                    <td className="r border-l border-line-soft">{money(sRev, cur, 0)}</td>
                    <td className="r">{money(sCost, cur, 0)}</td>
                    <Money v={sRev.minus(sCost)} bad />
                    <Margin rev={sRev} cost={sCost} />
                  </>
                )}
                <td className="r border-l border-line-soft">{money(tRev, cur, 0)}</td>
                <td className="r">{money(tCost, cur, 0)}</td>
                <Money v={tRev.minus(tCost)} bad />
                <Margin rev={tRev} cost={tCost} />
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td>Total</td>
              <td />
              <td className="r border-l border-line-soft">{money(r.steady.revenue, cur, 0)}</td>
              <td className="r">{money(r.steady.runCost, cur, 0)}</td>
              <td className={cx('r', r.steady.grossProfit.lt(0) && 'text-bad')}>{money(r.steady.grossProfit, cur, 0)}</td>
              <td className={cx('r', r.steady.marginPct.lt(0) && 'text-bad')}>{pct(r.steady.marginPct)}</td>
              <td className="r border-l border-line-soft">{money(r.economics.provider.tcv, cur, 0)}</td>
              <td className="r">{money(r.economics.provider.totalCost, cur, 0)}</td>
              <td className={cx('r', r.economics.provider.grossProfit.lt(0) && 'text-bad')}>{money(r.economics.provider.grossProfit, cur, 0)}</td>
              <td className={cx('r', r.economics.provider.marginPct.lt(0) && 'text-bad')}>{pct(r.economics.provider.marginPct)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </Panel>
  );
}

export function OverallKeyValues({ r }: { r: ProjectResult }) {
  const cur = r.currency;
  const p = r.economics.provider;
  return (
    <Panel title="Provider economics" description="Recurring revenue at steady state; contract values over the full term.">
      <KeyValues
        rows={[
          ['Monthly recurring revenue (MRR)', money(p.mrr, cur, 0)],
          ['Annual recurring revenue (ARR)', money(p.arr, cur, 0)],
          ['Annual contract value (ACV)', money(p.acv, cur, 0)],
          ['Total contract value (TCV)', money(p.tcv, cur, 0)],
          ['One-time revenue', money(p.oneTimeRevenue, cur, 0)],
          [`Revenue per agent per year (${r.project.agents.length} agents)`, money(p.revenuePerAgent, cur, 0)],
          [`Revenue per workflow per year (${r.project.workflows.length} workflows)`, money(p.revenuePerWorkflow, cur, 0)],
          ['Cost to serve per month', money(p.costToServeMonthly, cur, 0)],
          ['Cost to serve per weighted ABU', unitPrice(p.costToServePerAbu, cur)],
          ['Run-rate gross margin', pct(p.steadyMarginPct)],
          ['Full-term gross margin', pct(p.marginPct)],
        ]}
      />
    </Panel>
  );
}

export function YearTable({ r }: { r: ProjectResult }) {
  const cur = r.currency;
  return (
    <Panel title="Year by year" description="Year 1 includes the implementation month." padded={false}>
      <div className="scroll-x">
        <table className="dtable min-w-[640px]">
          <thead>
            <tr>
              <th>Year</th>
              <th className="r">Revenue</th>
              <th className="r">Recurring</th>
              <th className="r">Provider cost</th>
              <th className="r">Gross profit</th>
              <th className="r">Margin</th>
              <th className="r">Weighted ABUs</th>
            </tr>
          </thead>
          <tbody>
            {r.years.map((y) => (
              <tr key={y.year}>
                <td className="font-semibold">{y.label}</td>
                <td className="r">{compact(y.revenue, cur)}</td>
                <td className="r">{compact(y.recurringRevenue, cur)}</td>
                <td className="r">{compact(y.cost, cur)}</td>
                <td className={cx('r', y.grossProfit.lt(0) && 'text-bad')}>{compact(y.grossProfit, cur)}</td>
                <td className={cx('r font-semibold', n(y.marginPct) < 0 && 'text-bad')}>{pct(y.marginPct)}</td>
                <td className="r">{compactCount(y.weightedAbus)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td>Full term</td>
              <td className="r">{compact(r.economics.provider.tcv, cur)}</td>
              <td className="r">{compact(r.economics.provider.recurringRevenue, cur)}</td>
              <td className="r">{compact(r.economics.provider.totalCost, cur)}</td>
              <td className="r">{compact(r.economics.provider.grossProfit, cur)}</td>
              <td className="r">{pct(r.economics.provider.marginPct)}</td>
              <td className="r">{compactCount(sum(r.years.map((y) => y.weightedAbus)))}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </Panel>
  );
}
