import { useState } from 'react';
import { packageProject, type ConstructId, type PackageResult, type ProjectResult } from '@aies/engine';
import { ChartFrame, SimpleBars } from '../../components/charts';
import { Badge, Button, Callout, IssueList, Modal, Panel, cx } from '../../components/ui';
import { compact, money, months as fmtMonths, n, pct } from '../../lib/format';
import { STREAM_TYPE_LABEL, type Updater } from './shared';

/** The seven commercial constructs priced on the same cost base, with "Use this model". */
export function PackageComparison({ r, update, canEdit }: { r: ProjectResult; update: Updater; canEdit: boolean }) {
  const cur = r.currency;
  const [pending, setPending] = useState<PackageResult | null>(null);
  const pk = r.packages;
  const tcv = pk.map((p) => ({ name: p.short, value: n(p.economics.provider.tcv) }));
  const margin = pk.map((p) => ({ name: p.short, value: n(p.economics.provider.marginPct) }));

  const apply = (p: PackageResult) => {
    const packaged = packageProject(r.project, p.id as ConstructId, r.baseline.totals.weightedAbus.toNumber());
    update(`Applied the ${p.name.toLowerCase()} model`, (d) => {
      d.pricing.streams = structuredClone(packaged.pricing.streams);
      if (p.id === 'subscription') d.pricing.subscription = { ...packaged.pricing.subscription };
    });
    setPending(null);
  };

  return (
    <div className="space-y-5">
      <Panel
        title="Commercial model comparison"
        description="The same implementation and run cost priced seven ways, so provider margin and client ROI compare like for like. Hybrid is the model configured above."
        padded={false}
      >
        <div className="scroll-x">
          <table className="dtable min-w-[960px]">
            <thead>
              <tr>
                <th>Construct</th>
                <th className="r">Contract value</th>
                <th className="r">Recurring / month</th>
                <th className="r">Gross profit</th>
                <th className="r">Provider margin</th>
                <th className="r">Run-rate margin</th>
                <th className="r">Client ROI</th>
                <th className="r">Client payback</th>
                <th aria-label="Action" />
              </tr>
            </thead>
            <tbody>
              {pk.map((p) => {
                const hybrid = p.id === 'hybrid';
                const errors = p.issues.filter((i) => i.severity === 'error').length;
                return (
                  <tr key={p.id} className={hybrid ? '[&>td]:bg-brand-tint' : ''}>
                    <td className="max-w-[340px]">
                      <div className="font-semibold flex items-center gap-2">
                        {p.name}
                        {hybrid && <Badge tone="brand">Current</Badge>}
                        {errors > 0 && (
                          <Badge tone="bad">
                            {errors} error{errors > 1 ? 's' : ''}
                          </Badge>
                        )}
                      </div>
                      <div className="text-[12.5px] text-ink-3">{p.description}</div>
                    </td>
                    <td className="r">{compact(p.economics.provider.tcv, cur)}</td>
                    <td className="r">{compact(p.economics.provider.mrr, cur)}</td>
                    <td className={cx('r', p.economics.provider.grossProfit.lt(0) && 'text-bad')}>{compact(p.economics.provider.grossProfit, cur)}</td>
                    <td className={cx('r font-semibold', p.economics.provider.marginPct.lt(0) && 'text-bad')}>{pct(p.economics.provider.marginPct)}</td>
                    <td className={cx('r', p.economics.provider.steadyMarginPct.lt(0) && 'text-bad')}>{pct(p.economics.provider.steadyMarginPct)}</td>
                    <td className={cx('r', p.economics.client.roiPct.lt(0) && 'text-bad')}>{pct(p.economics.client.roiPct, 0)}</td>
                    <td className="r whitespace-nowrap">{fmtMonths(p.economics.client.paybackMonths)}</td>
                    <td className="r">
                      {!hybrid && (
                        <Button size="sm" disabled={!canEdit} onClick={() => setPending(p)}>
                          Use this model
                        </Button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Panel>

      <div className="grid gap-5 xl:grid-cols-2">
        <ChartFrame
          title="Total contract value by model"
          description="Everything the client pays over the term."
          table={{ columns: ['Construct', 'Contract value'], rows: pk.map((p) => [p.name, money(p.economics.provider.tcv, cur, 0)]) }}
        >
          <SimpleBars data={tcv} xKey="name" yKey="value" format={(v) => compact(v, cur)} height={240} labels={false} />
        </ChartFrame>
        <ChartFrame
          title="Provider gross margin by model"
          description="Full-term margin after implementation and run cost."
          table={{ columns: ['Construct', 'Provider margin'], rows: pk.map((p) => [p.name, pct(p.economics.provider.marginPct)]) }}
        >
          <SimpleBars data={margin} xKey="name" yKey="value" format={(v) => pct(v, 0)} height={240} />
        </ChartFrame>
      </div>

      <Modal
        open={!!pending}
        onClose={() => setPending(null)}
        title={pending ? `Use the ${pending.name.toLowerCase()} model?` : ''}
        footer={
          <>
            <Button onClick={() => setPending(null)}>Cancel</Button>
            <Button variant="primary" onClick={() => pending && apply(pending)}>
              Replace revenue streams
            </Button>
          </>
        }
      >
        {pending && (
          <div className="space-y-3 text-sm text-ink-2">
            <p>This replaces the project's current revenue streams{pending.id === 'subscription' ? ' and subscription allowance' : ''} with:</p>
            <ul className="space-y-1.5">
              {pending.streams.map((s) => (
                <li key={s.id} className="flex flex-wrap items-baseline justify-between gap-x-3 border-b border-line-soft pb-1.5">
                  <span className="font-semibold text-ink">{s.label}</span>
                  <span className="text-[12.5px] text-ink-3">
                    {STREAM_TYPE_LABEL[s.type]}
                    {s.type !== 'pass_through' && s.type !== 'gainshare' ? `, ${pct(s.targetMarginPct, 0)} target margin` : ''}
                  </span>
                </li>
              ))}
            </ul>
            <p>
              The comparison shows {compact(pending.economics.provider.tcv, cur)} contract value at {pct(pending.economics.provider.marginPct)} provider margin. It prices each model without volume
              tiers, minimum commitments or negotiated price overrides; those rate-card settings stay on the project, so the applied figures can differ slightly.
            </p>
            {pending.issues.length > 0 && <IssueList issues={pending.issues} />}
            <Callout>The change is recorded in the audit log. Apply another model, or edit the streams, to change it back.</Callout>
          </div>
        )}
      </Modal>
    </div>
  );
}
