import type { ReactNode } from 'react';
import type { BreakEven, Decimal, ScenarioMetrics } from '@aies/engine';
import { Panel, cx } from '../../components/ui';
import { compact, count, months as fmtMonths, pct, unitPrice } from '../../lib/format';
import type { ScenarioKey } from './drivers';

export const SCENARIO_LABEL: Record<ScenarioKey, string> = { baseline: 'Baseline', optimized: 'Optimized', stress: 'Stress', custom: 'Custom' };
const ORDER: ScenarioKey[] = ['baseline', 'optimized', 'stress', 'custom'];

type Better = 'higher' | 'lower' | null;
interface Row {
  label: string;
  hint?: string;
  get: (m: ScenarioMetrics) => Decimal | number | null;
  fmt: (m: ScenarioMetrics) => ReactNode;
  better: Better;
}

function breakEvenText(m: ScenarioMetrics, cur: string): string {
  const b: BreakEven | null = m.breakEven;
  if (!b) return '—';
  // The engine only tests the low end of volume; with minimum commitments it can report "below" while the run rate loses money.
  if (b.status === 'below' && m.providerMarginPct.lt(0)) return 'Loss at this volume';
  if (b.status === 'below') return 'Always profitable';
  if (b.status === 'above') return `Above ${count(b.monthlyVolume, cur)}`;
  return count(b.monthlyVolume, cur);
}

export function Comparison({
  metrics,
  selected,
  onSelect,
  cur,
  busyCustom,
}: {
  metrics: Record<ScenarioKey, ScenarioMetrics>;
  selected: ScenarioKey;
  onSelect: (k: ScenarioKey) => void;
  cur: string;
  busyCustom?: boolean;
}) {
  const rows: Row[] = [
    { label: 'Cost per ACU', get: (m) => m.costPerAcu, fmt: (m) => unitPrice(m.costPerAcu, cur), better: 'lower' },
    { label: 'Cost per weighted ABU', get: (m) => m.costPerAbu, fmt: (m) => unitPrice(m.costPerAbu, cur), better: 'lower' },
    { label: 'Monthly run cost', get: (m) => m.monthlyRunCost, fmt: (m) => compact(m.monthlyRunCost, cur), better: 'lower' },
    { label: 'Monthly revenue', get: (m) => m.monthlyRevenue, fmt: (m) => compact(m.monthlyRevenue, cur), better: 'higher' },
    { label: 'Annual recurring revenue', get: (m) => m.arr, fmt: (m) => compact(m.arr, cur), better: 'higher' },
    { label: 'Year 1 revenue', get: (m) => m.year1Revenue, fmt: (m) => compact(m.year1Revenue, cur), better: 'higher' },
    { label: 'Provider run-rate margin', get: (m) => m.providerMarginPct, fmt: (m) => pct(m.providerMarginPct), better: 'higher' },
    { label: 'Provider full-term margin', get: (m) => m.termMarginPct, fmt: (m) => pct(m.termMarginPct), better: 'higher' },
    { label: 'Customer ROI (full term)', get: (m) => m.customerRoiPct, fmt: (m) => pct(m.customerRoiPct, 0), better: 'higher' },
    { label: 'Customer payback', get: (m) => m.paybackMonths, fmt: (m) => fmtMonths(m.paybackMonths), better: null },
    {
      label: 'Break-even monthly volume',
      hint: 'Transactions per month at which run-rate gross profit is zero, at locked prices. "Always profitable" means fixed fees and minimum commitments cover cost however low volume falls.',
      get: () => null,
      fmt: (m) => breakEvenText(m, cur),
      better: null,
    },
  ];
  const tone = (row: Row, k: ScenarioKey): string => {
    if (k === 'baseline' || !row.better) return '';
    const a = row.get(metrics[k]);
    const b = row.get(metrics.baseline);
    if (a === null || b === null) return '';
    const av = typeof a === 'number' ? a : a.toNumber();
    const bv = typeof b === 'number' ? b : b.toNumber();
    if (Math.abs(av - bv) <= Math.abs(bv) * 1e-6) return '';
    return av > bv === (row.better === 'higher') ? 'text-good' : 'text-bad';
  };
  return (
    <Panel title="Scenario comparison" description="Steady-state month in contract year 1, and the full term. Green and red show better or worse than baseline." padded={false}>
      <div className="scroll-x">
        <table className="dtable min-w-[640px]">
          <thead>
            <tr>
              <th>Metric</th>
              {ORDER.map((k) => (
                <th key={k} className={cx('r', k === selected && '!bg-brand-tint')}>
                  <button type="button" className={cx('font-semibold hover:text-ink', k === selected ? 'text-ink' : 'text-ink-2')} aria-pressed={k === selected} onClick={() => onSelect(k)}>
                    {SCENARIO_LABEL[k]}
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.label}>
                <td className="text-ink-2 whitespace-nowrap" title={row.hint}>
                  {row.label}
                </td>
                {ORDER.map((k) => (
                  <td key={k} className={cx('r whitespace-nowrap', k === selected && 'bg-brand-tint font-semibold', tone(row, k), k === 'custom' && busyCustom && 'opacity-50')}>
                    {row.fmt(metrics[k])}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="px-4 py-2.5 text-[12.5px] text-ink-3 border-t border-line-soft">
        Break-even is the monthly transaction volume where run-rate gross profit reaches zero at locked prices. "Always profitable" means minimum commitments and fixed fees keep the run rate
        profitable however far volume falls.
      </p>
    </Panel>
  );
}
