import { useEffect, useState } from 'react';
import { sensitivity, type Catalog, type ProjectResult } from '@aies/engine';
import { ChartFrame, Tornado, type TornadoRow } from '../../components/charts';
import { SectionTitle, Segmented, cx } from '../../components/ui';
import { pct, unitPrice } from '../../lib/format';

type Sens = ReturnType<typeof sensitivity>;
type Metric = 'margin' | 'costPerAbu' | 'roi';

/** One sensitivity run per (project, catalogue) result — results are memoised across renders and visits. */
const cache = new WeakMap<ProjectResult, Sens>();

function useSensitivity(r: ProjectResult, catalog: Catalog): { data: Sens | null; busy: boolean } {
  const [data, setData] = useState<Sens | null>(() => cache.get(r) ?? null);
  const [busy, setBusy] = useState(() => !cache.has(r));
  useEffect(() => {
    const hit = cache.get(r);
    if (hit) {
      setData(hit);
      setBusy(false);
      return;
    }
    setBusy(true);
    // Let the page paint first; the 22 model runs take a second or two.
    const t = setTimeout(() => {
      const s = sensitivity(r, catalog);
      cache.set(r, s);
      setData(s);
      setBusy(false);
    }, 50);
    return () => clearTimeout(t);
  }, [r, catalog]);
  return { data, busy };
}

const signed = (s: string, v: number) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${s}`;

export function SensitivityPanel({ r, catalog }: { r: ProjectResult; catalog: Catalog }) {
  const cur = r.currency;
  const [metric, setMetric] = useState<Metric>('margin');
  const { data, busy } = useSensitivity(r, catalog);

  const pick = (row: Sens['rows'][number]): [number, number] =>
    metric === 'margin' ? [row.lowMargin, row.highMargin] : metric === 'costPerAbu' ? [row.lowCostPerAbu, row.highCostPerAbu] : [row.lowRoi, row.highRoi];
  const base = data ? (metric === 'margin' ? data.base.margin : metric === 'costPerAbu' ? data.base.costPerAbu : data.base.roi) : 0;
  const rows: TornadoRow[] = data
    ? data.rows
        .map((x) => {
          const [low, high] = pick(x);
          return { driver: x.driver, low, high, lowLabel: x.lowLabel, highLabel: x.highLabel };
        })
        .sort((a, b) => Math.abs(b.high - b.low) - Math.abs(a.high - a.low))
    : [];
  const fmtDelta = (v: number) => (metric === 'costPerAbu' ? signed(unitPrice(Math.abs(v), cur), v) : signed(`${Math.abs(v).toFixed(1)}pp`, v));
  const fmtValue = (v: number) => (metric === 'costPerAbu' ? unitPrice(v, cur) : pct(v));
  const metricLabel = metric === 'margin' ? 'provider run-rate margin' : metric === 'costPerAbu' ? 'cost per weighted ABU' : 'client ROI';

  return (
    <>
      <SectionTitle
        className="flex-wrap"
        actions={
          <Segmented<Metric>
            size="sm"
            ariaLabel="Sensitivity metric"
            value={metric}
            onChange={setMetric}
            options={[
              { id: 'margin', label: 'Provider margin' },
              { id: 'costPerAbu', label: 'Cost per ABU' },
              { id: 'roi', label: 'Client ROI' },
            ]}
          />
        }
      >
        Sensitivity of the baseline
      </SectionTitle>
      <ChartFrame
        title={`Change in ${metricLabel} by driver`}
        description={
          data
            ? `Baseline ${fmtValue(base)}. Each driver is shocked on its own with contracted prices locked; bars to the right raise the figure, longest bars matter most.`
            : 'Each driver is shocked on its own with contracted prices locked.'
        }
        table={
          data
            ? {
                columns: ['Driver', 'Low shock', `Low ${metricLabel}`, 'High shock', `High ${metricLabel}`],
                rows: rows.map((x) => [x.driver, x.lowLabel, fmtValue(x.low), x.highLabel, fmtValue(x.high)]),
              }
            : undefined
        }
      >
        <div className="relative" aria-busy={busy}>
          {busy && (
            <div className="absolute inset-x-0 top-2 z-10 flex justify-center pointer-events-none">
              <span className="rounded-full bg-paper border border-line px-3 py-1 text-[13px] font-semibold text-ink-2 shadow-sm" role="status">
                Calculating…
              </span>
            </div>
          )}
          <div className={cx(busy && 'opacity-40')}>{data ? <Tornado rows={rows} base={base} format={fmtDelta} /> : <div className="h-[370px]" />}</div>
        </div>
      </ChartFrame>
    </>
  );
}
