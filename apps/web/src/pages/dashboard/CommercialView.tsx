import { sum, type ProjectResult, POOL_LABELS } from '@aies/engine';
import { ChartFrame, StackedBars, SERIES, type SeriesDef } from '../../components/charts';
import { Badge, Panel, StatStrip, cx } from '../../components/ui';
import { compact, money, n, pct, periodLabel, unitPrice, months as fmtMonths } from '../../lib/format';
import { PERIOD_LABEL, monthsFor, type Period, type Slice } from '../../lib/slice';
import { href } from '../../lib/router';

export function CommercialView({ r, period }: { r: ProjectResult; slice: Slice; period: Period }) {
  const cur = r.currency;
  const f = (v: number) => compact(v, cur);
  const rows = monthsFor(r, period);
  const revenue = period === 'steady' ? r.steady.revenue : sum(rows.map((m) => m.revenue));
  const cost = period === 'steady' ? r.steady.runCost : sum(rows.map((m) => m.totalCost));
  const margin = revenue.isZero() ? 0 : n(revenue.minus(cost).div(revenue).times(100));
  const streams = r.priceBook.streams;
  const label = (id: string) => streams.find((s) => s.streamId === id)?.label ?? (id === 'unrecovered' ? 'Unrecovered cost' : id);

  // Revenue forecast by stream (monthly over the term).
  const streamIds = [...new Set(r.months.filter((m) => m.month > 0).flatMap((m) => Object.entries(m.revenueByStream).filter(([, v]) => !v.isZero()).map(([k]) => k)))];
  const series: SeriesDef[] = streamIds.map((id, i) => ({ key: id, label: label(id), color: SERIES[i % SERIES.length] }));
  const data = r.months
    .filter((m) => m.month > 0)
    .map((m) => ({ period: m.period, ...Object.fromEntries(streamIds.map((id) => [id, n(m.revenueByStream[id])])) }));

  const abu = streams.find((s) => s.type === 'abu')?.abu;
  const acu = streams.find((s) => s.type === 'acu');
  const sub = streams.find((s) => s.type === 'subscription')?.subscription;

  return (
    <div className="space-y-5">
      <StatStrip
        items={[
          { label: 'Implementation price', value: compact(r.implementation.price, cur), sub: `${pct(r.implementation.marginPct)} margin on ${compact(r.implementation.totalCost, cur)} cost` },
          { label: 'Total contract value', value: compact(r.economics.provider.tcv, cur), sub: `${r.project.pricing.termMonths}-month term` },
          { label: 'Annual contract value', value: compact(r.economics.provider.acv, cur), sub: `ARR ${compact(r.economics.provider.arr, cur)} at steady state` },
          { label: `Revenue (${PERIOD_LABEL[period].toLowerCase()})`, value: compact(revenue, cur), sub: `Cost ${compact(cost, cur)}` },
          { label: 'Provider gross margin', value: pct(margin), tone: margin < 15 ? 'bad' : margin < 25 ? 'warn' : 'good', sub: `Full term ${pct(r.economics.provider.marginPct)}` },
        ]}
      />

      <div className="grid gap-5 xl:grid-cols-[1.25fr_1fr]">
        <ChartFrame
          title="Revenue forecast by stream"
          description={`Monthly recurring billing at contracted (locked) prices, including ramp-up, growth and escalation. The ${compact(r.implementation.price, cur)} implementation fee is billed at contract start.`}
          legend={series}
          table={{ columns: ['Month', ...series.map((s) => s.label), 'Total'], rows: data.map((d) => [periodLabel(d.period), ...streamIds.map((id) => money(Number((d as Record<string, unknown>)[id] ?? 0), cur, 0)), money(streamIds.reduce((a, id) => a + (Number((d as Record<string, unknown>)[id] ?? 0) || 0), 0), cur, 0)]) }}
        >
          <StackedBars data={data} series={series} xKey="period" format={f} labelFormat={periodLabel} height={280} />
        </ChartFrame>

        <Panel title="Rate card" description="Unit prices derived from recovered cost at target margin, then locked for the contract." actions={<a className="text-[13px] font-semibold text-brand hover:underline" href={href('commercial')}>Edit pricing</a>}>
          <div className="space-y-4">
            {abu &&
              Object.values(abu.byWorkflow).map((w) => {
                const wf = r.project.workflows.find((x) => x.id === w.workflowId)!;
                return (
                  <div key={w.workflowId}>
                    <div className="flex items-baseline justify-between gap-2">
                      <div className="text-sm font-semibold text-ink">{wf.name}</div>
                      <div className="text-[12.5px] text-ink-3">per accepted {wf.abuName}</div>
                    </div>
                    <table className="dtable mt-1">
                      <tbody>
                        {w.classPrices.map((c) => (
                          <tr key={c.classId}>
                            <td className="text-ink-2">
                              {c.name} <span className="text-ink-3">({n(c.weight)} ABU)</span>
                            </td>
                            <td className="r font-semibold">{unitPrice(c.price, cur)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    <div className="text-[12.5px] text-ink-3 mt-1">
                      Cost {unitPrice(w.costPerAbu, cur)} per ABU {w.floorApplied && <Badge tone="warn">floor applied</Badge>} {w.overridden && <Badge tone="brand">negotiated</Badge>}
                    </div>
                  </div>
                );
              })}
            {acu && (
              <div className="flex items-baseline justify-between gap-2 border-t border-line-soft pt-3">
                <div>
                  <div className="text-sm font-semibold text-ink">ACU consumption</div>
                  <div className="text-[12.5px] text-ink-3">Cost {unitPrice(acu.unitCost, cur)} per ACU</div>
                </div>
                <div className="num text-lg font-semibold">{unitPrice(acu.unitPrice, cur)}</div>
              </div>
            )}
            {sub && (
              <div className="border-t border-line-soft pt-3 text-sm">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="font-semibold text-ink">Subscription fee</span>
                  <span className="num font-semibold">{money(sub.totalFee, cur, 0)}/mo</span>
                </div>
                <div className="text-[12.5px] text-ink-3">
                  Platform {money(sub.platformFee, cur, 0)} + {n(sub.includedQty).toLocaleString('en-IN')} included {sub.includedUnit.toUpperCase()}s; overage {unitPrice(sub.overageRate, cur)}
                </div>
              </div>
            )}
            {streams
              .filter((s) => s.type === 'agentops' || s.type === 'fixed_monthly')
              .map((s) => (
                <div key={s.streamId} className="flex items-baseline justify-between gap-2 border-t border-line-soft pt-3 text-sm">
                  <span className="font-semibold text-ink">{s.label}</span>
                  <span className="num font-semibold">{money(s.monthlyFee, cur, 0)}/mo</span>
                </div>
              ))}
          </div>
        </Panel>
      </div>

      <Panel title="Margin by revenue stream" description="Steady-state month. Each cost pool is recovered by exactly one stream; anything unassigned shows as unrecovered cost." padded={false}>
        <div className="scroll-x">
          <table className="dtable min-w-[720px]">
            <thead>
              <tr>
                <th>Stream</th>
                <th>Recovers</th>
                <th className="r">Target margin</th>
                <th className="r">Revenue</th>
                <th className="r">Attributed cost</th>
                <th className="r">Gross margin</th>
              </tr>
            </thead>
            <tbody>
              {[...streams.map((s) => s.streamId), 'unrecovered'].map((id) => {
                const s = streams.find((x) => x.streamId === id);
                const rev = r.steady.revenueByStream[id];
                const c = r.steady.costByStream[id];
                if (!s && (!c || c.isZero())) return null;
                if (s?.type === 'fixed_fee') return null;
                const m = rev && !rev.isZero() ? n(rev.minus(c ?? 0).div(rev).times(100)) : null;
                return (
                  <tr key={id}>
                    <td className="font-semibold">{label(id)}</td>
                    <td className="text-[13px] text-ink-2">{s ? s.recovers.filter((p) => p !== 'IMPLEMENTATION' || s.type !== 'fixed_fee').map((p) => POOL_LABELS[p]).join(', ') : '—'}</td>
                    <td className="r">{s && s.type !== 'pass_through' && s.type !== 'gainshare' ? pct(s.targetMarginPct, 0) : '—'}</td>
                    <td className="r">{money(rev ?? 0, cur, 0)}</td>
                    <td className="r">{money(c ?? 0, cur, 0)}</td>
                    <td className={cx('r font-semibold', m !== null && m < 0 && 'text-bad')}>{m === null ? '—' : pct(m)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Panel>

      <Panel
        title="Commercial model comparison"
        description="The same cost base priced seven ways. Provider economics and client ROI over the full term."
        padded={false}
        actions={<a className="text-[13px] font-semibold text-brand hover:underline" href={href('commercial')}>Open commercial pricing</a>}
      >
        <div className="scroll-x">
          <table className="dtable min-w-[820px]">
            <thead>
              <tr>
                <th>Construct</th>
                <th className="r">Contract value</th>
                <th className="r">Recurring / month</th>
                <th className="r">Provider margin</th>
                <th className="r">Gross profit</th>
                <th className="r">Client ROI</th>
                <th className="r">Client payback</th>
              </tr>
            </thead>
            <tbody>
              {r.packages.map((p) => (
                <tr key={p.id} className={p.id === 'hybrid' ? '[&>td]:bg-brand-tint' : ''}>
                  <td>
                    <div className="font-semibold">{p.name}</div>
                    <div className="text-[12.5px] text-ink-3 max-w-[340px]">{p.description}</div>
                  </td>
                  <td className="r">{compact(p.economics.provider.tcv, cur)}</td>
                  <td className="r">{compact(p.economics.provider.mrr, cur)}</td>
                  <td className={cx('r font-semibold', n(p.economics.provider.marginPct) < 0 && 'text-bad')}>{pct(p.economics.provider.marginPct)}</td>
                  <td className="r">{compact(p.economics.provider.grossProfit, cur)}</td>
                  <td className={cx('r', n(p.economics.client.roiPct) < 0 && 'text-bad')}>{pct(p.economics.client.roiPct, 0)}</td>
                  <td className="r">{fmtMonths(p.economics.client.paybackMonths)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </div>
  );
}
