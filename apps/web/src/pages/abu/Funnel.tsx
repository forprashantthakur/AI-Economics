import type { WorkflowVolumes } from '@aies/engine';
import { ChartFrame } from '../../components/charts';
import { count, n, pct } from '../../lib/format';
import { Swatch } from '../costing/common';

interface Seg {
  value: number;
  color: string;
  label: string;
}

/** Transaction funnel as HTML bars: each row is scaled to attempted transactions. */
export function Funnel({ v, abuName, cur }: { v: WorkflowVolumes; abuName: string; cur: string }) {
  const att = n(v.attempted);
  const scale = Math.max(att, 1e-9);
  const c = (x: number) => count(x, cur);
  const share = (x: number) => pct(att ? (x / att) * 100 : 0, 0);
  const rows: { label: string; segs: Seg[]; text: string; sub?: string }[] = [
    { label: 'Attempted', segs: [{ value: att, color: '--accent-series', label: 'Attempted' }], text: c(att), sub: 'Unique business transactions' },
    {
      label: 'Completed',
      segs: [
        { value: n(v.completed), color: '--accent-series', label: 'Completed' },
        { value: n(v.failed), color: '--s8', label: 'Failed' },
      ],
      text: c(n(v.completed)),
      sub: `${c(n(v.failed))} failed (${share(n(v.failed))})`,
    },
    {
      label: 'Accepted',
      segs: [
        { value: n(v.accepted), color: '--accent-series', label: 'Accepted' },
        { value: n(v.rejected), color: '--s8', label: 'Rejected' },
      ],
      text: c(n(v.accepted)),
      sub: `${c(n(v.rejected))} rejected after completion`,
    },
    {
      label: 'How accepted',
      segs: [
        { value: n(v.autonomous), color: '--accent-series', label: 'Autonomous' },
        { value: n(v.humanAssisted), color: '--s4', label: 'Human-assisted' },
      ],
      text: c(n(v.autonomous)),
      sub: `autonomous, ${c(n(v.humanAssisted))} human-assisted`,
    },
    { label: 'Retries', segs: [{ value: n(v.retries), color: '--s2', label: 'Retry executions' }], text: `+${c(n(v.retries))}`, sub: 'Extra executions, never extra ABUs' },
  ];
  return (
    <ChartFrame
      title="Transaction funnel"
      description={`Steady-state month. Only accepted ${abuName}s earn ABUs; failed, rejected and retried work still consumes resources.`}
      table={{
        columns: ['Stage', 'Transactions', 'Share of attempted'],
        rows: [
          ['Attempted', c(att), '100%'],
          ['Completed', c(n(v.completed)), share(n(v.completed))],
          ['Failed', c(n(v.failed)), share(n(v.failed))],
          ['Accepted', c(n(v.accepted)), share(n(v.accepted))],
          ['Rejected', c(n(v.rejected)), share(n(v.rejected))],
          ['Autonomous', c(n(v.autonomous)), share(n(v.autonomous))],
          ['Human-assisted', c(n(v.humanAssisted)), share(n(v.humanAssisted))],
          ['Retry executions', c(n(v.retries)), share(n(v.retries))],
          ['Weighted accepted ABUs', c(n(v.weightedAbus)), '—'],
        ],
      }}
    >
      <div className="px-2">
        <div className="flex flex-wrap gap-x-4 gap-y-1 pb-3">
          <Swatch color="--accent-series" label="Flows to an ABU" />
          <Swatch color="--s8" label="Failed or rejected" />
          <Swatch color="--s4" label="Human-assisted" />
          <Swatch color="--s2" label="Retries" />
        </div>
        <ul className="space-y-3">
          {rows.map((r) => (
            <li key={r.label} className="grid grid-cols-[92px_1fr] sm:grid-cols-[110px_1fr] gap-x-3 items-center">
              <div className="text-[13px] text-ink-2">{r.label}</div>
              <div className="min-w-0">
                <div className="flex h-[14px] rounded-[4px] overflow-hidden bg-line-soft gap-[2px]" role="img" aria-label={r.segs.map((s) => `${s.label} ${c(s.value)}`).join(', ')}>
                  {r.segs
                    .filter((s) => s.value > 0)
                    .map((s) => (
                      <div key={s.label} title={`${s.label}: ${c(s.value)}`} style={{ width: `${Math.min(100, (s.value / scale) * 100)}%`, background: `var(${s.color})` }} />
                    ))}
                </div>
                <div className="text-[12.5px] mt-0.5 leading-snug">
                  <span className="num font-semibold text-ink">{r.text}</span> <span className="text-ink-3">{r.sub}</span>
                </div>
              </div>
            </li>
          ))}
        </ul>
        <div className="flex flex-wrap justify-between gap-2 border-t border-line-soft mt-3 pt-2 text-[13px]">
          <span className="text-ink-2">Weighted accepted ABUs (accepted × class weight)</span>
          <span className="num font-semibold text-ink">{c(n(v.weightedAbus))}</span>
        </div>
      </div>
    </ChartFrame>
  );
}
