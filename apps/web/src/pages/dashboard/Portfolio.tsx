import { convert, sum, type Project, type ProjectResult } from '@aies/engine';
import { Badge, cx } from '../../components/ui';
import { compact, months, n, pct } from '../../lib/format';
import { useStore } from '../../state/store';

export const STATUS_LABEL: Record<Project['status'], { label: string; tone: 'neutral' | 'brand' | 'good' }> = {
  pre_sales: { label: 'Pre-sales estimate', tone: 'neutral' },
  in_delivery: { label: 'In delivery', tone: 'brand' },
  live: { label: 'Live — monitoring', tone: 'good' },
};

export function Portfolio({ items, selectedId, onSelect }: { items: { project: Project; result: ProjectResult }[]; selectedId?: string; onSelect: (id: string) => void }) {
  const { state } = useStore();
  const cur = items[0]?.project.currency ?? 'INR';
  const fx = state.catalog.fx;
  const c = (v: Parameters<typeof convert>[0], from: string) => convert(v, from, cur, fx);
  const tcv = sum(items.map((x) => c(x.result.economics.provider.tcv, x.project.currency)));
  const gp = sum(items.map((x) => c(x.result.economics.provider.grossProfit, x.project.currency)));
  const invest = sum(items.map((x) => c(x.result.economics.client.totalInvestment, x.project.currency)));
  const benefit = sum(items.map((x) => c(x.result.economics.client.countedBenefits, x.project.currency)));
  const margin = tcv.isZero() ? 0 : n(gp.div(tcv).times(100));
  const roi = invest.isZero() ? 0 : n(benefit.minus(invest).div(invest).times(100));
  const live = items.filter((x) => x.project.status === 'live').length;

  return (
    <section aria-label="Portfolio">
      <p className="font-serif text-[22px] sm:text-[26px] leading-snug text-ink max-w-4xl tracking-[-0.005em]">
        {items.length} {items.length === 1 ? 'engagement' : 'engagements'} worth <span className="num font-semibold">{compact(tcv, cur)}</span> in contract value at a{' '}
        <span className="num font-semibold">{pct(margin, 0)}</span> provider margin, returning <span className={cx('num font-semibold', roi < 0 && 'text-bad')}>{pct(roi, 0)}</span> validated ROI to clients over
        the term.
      </p>
      <p className="text-[13.5px] text-ink-3 mt-1.5">
        {live} live with actuals, {items.length - live} in pre-sales or delivery. Amounts in {cur}; ROI counts finance-validated benefits only.
      </p>

      <div className="mt-4 bg-paper border border-line rounded-[10px] scroll-x">
        <table className="dtable min-w-[880px]">
          <thead>
            <tr>
              <th>Project</th>
              <th>Status</th>
              <th className="r">Run cost / month</th>
              <th className="r">Revenue / month</th>
              <th className="r">Run-rate margin</th>
              <th className="r">Contract value</th>
              <th className="r">Client ROI</th>
              <th className="r">Payback</th>
            </tr>
          </thead>
          <tbody>
            {items.map(({ project: p, result: r }) => {
              const sel = p.id === selectedId;
              return (
                <tr key={p.id} className={cx('cursor-pointer', sel && '[&>td]:bg-brand-tint')} onClick={() => onSelect(p.id)} aria-selected={sel}>
                  <td>
                    <button type="button" className="text-left" onClick={() => onSelect(p.id)}>
                      <div className="font-semibold text-ink">{p.name}</div>
                      <div className="text-[12.5px] text-ink-3">{p.client.clientName}</div>
                    </button>
                  </td>
                  <td>
                    <Badge tone={STATUS_LABEL[p.status].tone}>{STATUS_LABEL[p.status].label}</Badge>
                  </td>
                  <td className="r">{compact(r.baseline.totalRunCost, p.currency)}</td>
                  <td className="r">{compact(r.steady.revenue, p.currency)}</td>
                  <td className="r">{pct(r.steady.marginPct)}</td>
                  <td className="r">{compact(r.economics.provider.tcv, p.currency)}</td>
                  <td className={cx('r', n(r.economics.client.roiPct) < 0 && 'text-bad')}>{pct(r.economics.client.roiPct, 0)}</td>
                  <td className="r">{months(r.economics.client.paybackMonths)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
