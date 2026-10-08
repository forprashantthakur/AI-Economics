import { COST_POOLS, POOL_LABELS, type CostPool, type ProjectResult } from '@aies/engine';
import { useColors, POOL_COLOR } from '../../components/charts';
import { Badge, Callout, IssueList, Panel, cx } from '../../components/ui';
import { money } from '../../lib/format';
import type { Updater } from './shared';

/**
 * Cost recovery matrix: rows are cost pools, columns are revenue streams. Each
 * ticked cell means that stream's price is built to recover that pool. The
 * engine raises DOUBLE_RECOVERY (billed twice) and UNRECOVERED_POOL (margin leak).
 */
export function RecoveryMatrix({ r, update, canEdit }: { r: ProjectResult; update: Updater; canEdit: boolean }) {
  const color = useColors();
  const cur = r.currency;
  const streams = r.project.pricing.streams;
  const recovery = r.priceBook.recovery;
  const issues = r.priceBook.issues.filter((i) => i.code === 'DOUBLE_RECOVERY' || i.code === 'UNRECOVERED_POOL');
  const opsSeparate = streams.some((s) => s.enabled && s.type === 'agentops');
  const abuStream = streams.find((s) => s.enabled && s.type === 'abu');
  const abuBundlesOps = !!abuStream && abuStream.recovers.includes('AGENTOPS');

  const toggle = (streamId: string, pool: CostPool, on: boolean) =>
    update(`${on ? 'Assigned' : 'Unassigned'} ${POOL_LABELS[pool]} ${on ? 'to' : 'from'} a stream`, (d) => {
      const s = d.pricing.streams.find((x) => x.id === streamId);
      if (!s) return;
      s.recovers = on ? [...new Set([...s.recovers, pool])] : s.recovers.filter((p) => p !== pool);
    });

  const poolCost = (p: CostPool) => (p === 'IMPLEMENTATION' ? r.implementation.totalCost : r.baseline.pools[p]);

  return (
    <Panel
      title="Cost recovery matrix"
      description="Tick the stream that recovers each cost pool. Every pool should be recovered by exactly one enabled stream: two ticks bill the client twice, none leaks margin."
      padded={false}
    >
      <div className="scroll-x">
        <table className="dtable min-w-[760px]">
          <thead>
            <tr>
              <th>Cost pool</th>
              <th className="r">Steady monthly cost</th>
              <th className="r">One-time cost</th>
              {streams.map((s) => (
                <th key={s.id} className={cx('text-center !whitespace-normal min-w-[104px] max-w-[140px] leading-tight', !s.enabled && 'text-ink-3')}>
                  {s.label}
                  {!s.enabled && <span className="block font-normal text-[12px]">(off)</span>}
                </th>
              ))}
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {COST_POOLS.map((p) => {
              const owners = recovery[p] ?? [];
              const cost = poolCost(p);
              const double = owners.length > 1;
              const none = owners.length === 0 && cost.gt(0);
              return (
                <tr key={p} className={cx(double && '[&>td]:bg-bad-tint', none && '[&>td]:bg-warn-tint')}>
                  <td className="font-semibold whitespace-nowrap">
                    <span className="inline-block w-2.5 h-2.5 rounded-[3px] mr-2 align-[-1px]" style={{ background: color(POOL_COLOR[p]) }} aria-hidden />
                    {POOL_LABELS[p]}
                  </td>
                  <td className="r">{p === 'IMPLEMENTATION' ? <span className="text-ink-3">—</span> : money(r.baseline.pools[p], cur, 0)}</td>
                  <td className="r">{p === 'IMPLEMENTATION' ? money(r.implementation.totalCost, cur, 0) : <span className="text-ink-3">—</span>}</td>
                  {streams.map((s) => {
                    const checked = s.recovers.includes(p);
                    const blocked = s.type === 'fixed_fee' && p !== 'IMPLEMENTATION';
                    return (
                      <td key={s.id} className="text-center">
                        <input
                          type="checkbox"
                          className="h-4 w-4 accent-[var(--brand)] align-middle disabled:opacity-40"
                          checked={checked}
                          disabled={!canEdit || (blocked && !checked)}
                          aria-label={`${s.label} recovers ${POOL_LABELS[p]}`}
                          data-pool={p}
                          data-stream={s.id}
                          onChange={(e) => toggle(s.id, p, e.target.checked)}
                        />
                      </td>
                    );
                  })}
                  <td className="whitespace-nowrap">
                    {double ? (
                      <Badge tone="bad">Billed twice</Badge>
                    ) : none ? (
                      <Badge tone="warn">Unrecovered</Badge>
                    ) : owners.length ? (
                      <Badge tone="good">Recovered</Badge>
                    ) : (
                      <span className="text-[12.5px] text-ink-3">No cost</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="px-4 py-3 space-y-3 border-t border-line-soft">
        {issues.length > 0 && <IssueList issues={issues} />}
        <Callout tone={opsSeparate && abuBundlesOps ? 'warn' : 'neutral'} title="AgentOps billed separately">
          If AgentOps is billed as its own managed-service fee, untick AgentOps from the ABU (and ACU) stream so the per-transaction price excludes it — otherwise the client pays for the same support
          twice. Leave it in the ABU price only when AgentOps is explicitly bundled into the transaction price and no separate AgentOps fee is billed.
          {opsSeparate && abuBundlesOps && <span className="block mt-1 font-semibold text-ink">This model has an AgentOps fee and an ABU price that both recover AgentOps.</span>}
        </Callout>
      </div>
    </Panel>
  );
}
