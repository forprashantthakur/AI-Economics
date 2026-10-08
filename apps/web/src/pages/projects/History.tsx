import { useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import { ROLE_LABELS, type Project, type ScenarioOverrides } from '@aies/engine';
import { Empty, Panel } from '../../components/ui';
import { dateTime } from '../../lib/format';
import { href } from '../../lib/router';
import { useStore } from '../../state/store';

const OVERRIDE_LABEL: Partial<Record<keyof ScenarioOverrides, string>> = {
  volumeMultiplier: 'Volume',
  inputTokenMultiplier: 'Input tokens',
  outputTokenMultiplier: 'Output tokens',
  retryRatePct: 'Retry rate',
  retryMultiplier: 'Retries',
  successRateDeltaPp: 'Success rate',
  humanInterventionDeltaPp: 'Human intervention',
  cacheHitRatePct: 'Cache hit rate',
  cacheHitDeltaPp: 'Cache hit rate',
  routingShift: 'Routing shift',
  modelSwap: 'Model swap',
  infraMultiplier: 'Infrastructure',
  agentOpsMultiplier: 'AgentOps',
  complexityShiftPp: 'Complexity shift',
  targetMarginPct: 'Target margin',
  priceMultiplier: 'Price',
  growthPct: 'Growth',
  repriceAtTargetMargin: 'Reprice at target margin',
};

function describe(o: ScenarioOverrides): string {
  const parts = (Object.keys(o) as (keyof ScenarioOverrides)[])
    .filter((k) => o[k] !== undefined && o[k] !== null)
    .map((k) => {
      const v = o[k];
      const label = OVERRIDE_LABEL[k] ?? k;
      if (typeof v === 'number') {
        if (k.endsWith('Multiplier')) return `${label} ×${v}`;
        if (k.endsWith('Pp')) return `${label} ${v >= 0 ? '+' : '−'}${Math.abs(v)} pp`;
        if (k.endsWith('Pct')) return `${label} ${v}%`;
        return `${label} ${v}`;
      }
      if (typeof v === 'boolean') return v ? label : '';
      if (v && typeof v === 'object' && 'toModelId' in v && 'sharePct' in v) return `${label} ${v.sharePct}% to ${v.toModelId}`;
      if (v && typeof v === 'object' && 'fromModelId' in v) return `${label} ${v.fromModelId} to ${v.toModelId}`;
      return label;
    })
    .filter(Boolean);
  return parts.length ? parts.join(', ') : 'Baseline (no overrides)';
}

export function HistoryTab({ project: p }: { project: Project }) {
  const { state } = useStore();
  const [q, setQ] = useState('');
  const entries = useMemo(() => {
    const s = q.trim().toLowerCase();
    return state.audit.filter((a) => a.projectId === p.id && (!s || `${a.action} ${a.detail} ${a.user}`.toLowerCase().includes(s)));
  }, [state.audit, p.id, q]);
  const scenarios = [...p.scenarios].sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  return (
    <div className="space-y-5">
      <Panel
        title="Saved scenarios"
        description="Versioned what-if runs saved from the Scenario Simulator."
        padded={false}
        actions={
          <a href={href('scenarios')} className="text-[13.5px] font-semibold text-brand hover:underline underline-offset-2">
            Open simulator
          </a>
        }
      >
        {scenarios.length === 0 ? (
          <Empty title="No saved scenarios" body="Run a what-if in the Scenario Simulator and save it to keep a versioned record here." />
        ) : (
          <div className="scroll-x">
            <table className="dtable min-w-[760px]">
              <thead>
                <tr>
                  <th>Scenario</th>
                  <th className="r">Version</th>
                  <th>Saved</th>
                  <th>Author</th>
                  <th>Overrides</th>
                </tr>
              </thead>
              <tbody>
                {scenarios.map((s) => (
                  <tr key={s.id}>
                    <td className="font-semibold">{s.name}</td>
                    <td className="r">v{s.version}</td>
                    <td className="text-[13px] num whitespace-nowrap">{dateTime(s.createdAt)}</td>
                    <td className="text-[13px] text-ink-2">{s.author}</td>
                    <td className="text-[13px] text-ink-2">{describe(s.overrides)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <Panel
        title="Change history"
        description="Every change to this project, newest first. Catalogue changes that affect all projects are in Settings, Audit log."
        padded={false}
        actions={
          <div className="relative w-[220px] max-w-[48vw]">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-3 pointer-events-none" aria-hidden />
            <input className="field !pl-8 text-[13px]" placeholder="Search changes" aria-label="Search change history" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
        }
      >
        {entries.length === 0 ? (
          <Empty title={q ? 'No changes match' : 'No changes recorded yet'} body={q ? 'Try another search term.' : 'Edits made in this session and imported history appear here.'} />
        ) : (
          <div className="scroll-x max-h-[560px] overflow-y-auto">
            <table className="dtable min-w-[760px]">
              <thead>
                <tr>
                  <th>When</th>
                  <th>User</th>
                  <th>Change</th>
                  <th>Detail</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((a) => (
                  <tr key={a.id}>
                    <td className="text-[13px] num whitespace-nowrap">{dateTime(a.at)}</td>
                    <td className="text-[13px]">
                      <div className="font-semibold text-ink">{a.user}</div>
                      <div className="text-ink-3">{ROLE_LABELS[a.role] ?? a.role}</div>
                    </td>
                    <td className="text-[13.5px] font-semibold">{a.action}</td>
                    <td className="text-[13px] text-ink-2">{a.detail}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {entries.length > 0 && <p className="px-4 py-2 text-[12.5px] text-ink-3 border-t border-line-soft">{entries.length} entries. The audit log keeps the latest 500 changes across all projects.</p>}
      </Panel>
    </div>
  );
}
