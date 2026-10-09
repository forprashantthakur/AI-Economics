import { useState } from 'react';
import { CheckCircle2, Plus, Trash2 } from 'lucide-react';
import { D, safeDiv, tieredCharge, uid, type Project, type ProjectResult, type RateCardVersion, type StreamPrice, type VolumeTier, type Decimal } from '@aies/engine';
import { Badge, Button, Field, Panel, ReadOnlyNote, Segmented, TextInput, cx } from '../../components/ui';
import { dateTime, money, n, unitPrice } from '../../lib/format';
import { useCan, useStore } from '../../state/store';
import { IconButton, OptionalNumberInput, type Updater, Num } from '../costing/common';

/** Editable volume-tier table shared by the ACU and ABU rate cards. */
export function TierEditor({
  tiers,
  unit,
  disabled,
  onChange,
  bandPrice,
  cur,
}: {
  tiers: VolumeTier[];
  unit: string;
  disabled: boolean;
  onChange: (what: string, tiers: VolumeTier[]) => void;
  /** Price per unit inside a band (from the engine), or undefined when no base price exists. */
  bandPrice?: (t: VolumeTier) => Decimal | undefined;
  cur: string;
}) {
  const sortedIdx = tiers.map((t, i) => ({ t, i })).sort((a, b) => a.t.fromUnits - b.t.fromUnits);
  return (
    <div>
      <div className="scroll-x">
        <table className="dtable min-w-[420px]">
          <thead>
            <tr>
              <th>Tier starts above</th>
              <th className="r">Discount</th>
              {bandPrice && <th className="r">Price in tier</th>}
              <th aria-label="Actions" />
            </tr>
          </thead>
          <tbody>
            {tiers.length === 0 && (
              <tr>
                <td colSpan={bandPrice ? 4 : 3} className="text-[13.5px] text-ink-3">
                  No volume tiers. Every {unit} is billed at the base price.
                </td>
              </tr>
            )}
            {sortedIdx.map(({ t, i }) => {
              const bp = bandPrice?.(t);
              return (
                <tr key={i}>
                  <td>
                    <div className="flex items-center gap-1.5">
                      <Num
                        width={140}
                        value={t.fromUnits}
                        min={0}
                        step={1000}
                        disabled={disabled}
                        ariaLabel={`Tier ${i + 1} threshold`}
                        onChange={(v) =>
                          onChange(
                            'Changed volume tier threshold',
                            tiers.map((x, k) => (k === i ? { ...x, fromUnits: v } : x)),
                          )
                        }
                      />
                      <span className="text-[12.5px] text-ink-3 whitespace-nowrap">{unit}s / month</span>
                    </div>
                  </td>
                  <td className="r">
                    <Num
                      width={90}
                      value={t.discountPct}
                      min={0}
                      max={100}
                      suffix="%"
                      disabled={disabled}
                      ariaLabel={`Tier ${i + 1} discount`}
                      onChange={(v) =>
                        onChange(
                          'Changed volume tier discount',
                          tiers.map((x, k) => (k === i ? { ...x, discountPct: v } : x)),
                        )
                      }
                    />
                  </td>
                  {bandPrice && <td className="r">{bp ? unitPrice(bp, cur) : '—'}</td>}
                  <td className="r">
                    <IconButton
                      label="Remove tier"
                      tone="bad"
                      disabled={disabled}
                      onClick={() =>
                        onChange(
                          'Removed volume tier',
                          tiers.filter((_, k) => k !== i),
                        )
                      }
                    >
                      <Trash2 size={15} />
                    </IconButton>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <Button
        size="sm"
        variant="ghost"
        className="mt-1"
        icon={<Plus size={13} />}
        disabled={disabled}
        onClick={() => {
          const last = sortedIdx[sortedIdx.length - 1]?.t;
          onChange('Added volume tier', [...tiers, { fromUnits: last ? Math.round(last.fromUnits * 1.5) || 10000 : 10000, discountPct: last ? last.discountPct + 3 : 3 }]);
        }}
      >
        Add tier
      </Button>
    </div>
  );
}

/** Price per unit inside a band, read from the engine's tier maths (all-units charge just above the threshold). */
export function bandPriceFrom(price: Decimal | undefined, tiers: VolumeTier[], floor: Decimal | undefined) {
  return (t: VolumeTier) => {
    if (!price || price.isZero()) return undefined;
    const units = D(t.fromUnits + 1);
    return safeDiv(tieredCharge(units, price, tiers, 'all_units', floor), units);
  };
}

export function AcuRateCardPanel({ project, result, update, stream, steadyRevenue }: { project: Project; result: ProjectResult; update: Updater; stream: StreamPrice; steadyRevenue?: Decimal }) {
  const canEdit = useCan('pricing.edit');
  const ro = !canEdit;
  const cur = result.currency;
  const rc = project.pricing.acuRateCard;
  const acus = result.baseline.acu.total;
  const usage = result.steady.revenueLines.filter((l) => l.streamId === stream.streamId && l.key === 'usage');
  const usageAmt = usage.reduce<Decimal>((a, l) => a.plus(l.amount), D(0));
  const viaSubscription = result.steady.revenueLines.some((l) => l.streamId === stream.streamId && l.key === 'overage');
  const set = (what: string, fn: (r: Project['pricing']['acuRateCard']) => void) => update(what, (d) => fn(d.pricing.acuRateCard));

  return (
    <Panel title="ACU rate card" description="Volume tiers, commitments and floors applied when ACUs are billed. The derived price is locked at contract start and escalated yearly.">
      <ReadOnlyNote show={ro} what="edit the rate card" />
      <div className="grid gap-x-8 gap-y-4 xl:grid-cols-[1fr_1.1fr]">
        <div className="grid gap-4 sm:grid-cols-2 content-start">
          <Field label="Negotiated price per ACU" hint={`Leave empty to bill the derived ${unitPrice(stream.listUnitPrice, cur)}.`}>
            <OptionalNumberInput
              value={rc.priceOverride}
              placeholder={n(stream.listUnitPrice).toFixed(4)}
              disabled={ro}
              ariaLabel="Negotiated price per ACU"
              onChange={(v) => set(v === null ? 'Removed negotiated ACU price' : 'Set negotiated ACU price', (r) => (r.priceOverride = v))}
            />
          </Field>
          <Field label="Margin floor" hint={`Price never falls below ${unitPrice(stream.floorPrice, cur)}.`}>
            <Num value={rc.marginFloorPct} min={0} max={95} suffix="%" disabled={ro} ariaLabel="ACU margin floor" onChange={(v) => set('Changed ACU margin floor', (r) => (r.marginFloorPct = v))} />
          </Field>
          <Field label="Minimum monthly commitment" hint="Shortfall is billed as a true-up.">
            <Num
              value={rc.minMonthlyCommitment}
              min={0}
              step={10000}
              prefix={cur === 'INR' ? '₹' : undefined}
              disabled={ro}
              ariaLabel="Minimum monthly ACU commitment"
              onChange={(v) => set('Changed ACU minimum commitment', (r) => (r.minMonthlyCommitment = v))}
            />
          </Field>
          <Field label="Tier mode" hint={rc.tierMode === 'graduated' ? 'Each band is priced at its own discount.' : 'All units take the discount of the highest band reached.'}>
            <div className={cx(ro && 'pointer-events-none opacity-60')} inert={ro || undefined}>
              <Segmented
                ariaLabel="ACU tier mode"
                value={rc.tierMode}
                onChange={(v) => set('Changed ACU tier mode', (r) => (r.tierMode = v))}
                options={[
                  { id: 'graduated', label: 'Graduated' },
                  { id: 'all_units', label: 'All units' },
                ]}
              />
            </div>
          </Field>
        </div>
        <div>
          <div className="text-[13px] font-semibold text-ink-2 mb-1">Volume tiers</div>
          <TierEditor tiers={rc.tiers} unit="ACU" disabled={ro} cur={cur} bandPrice={bandPriceFrom(stream.unitPrice, rc.tiers, stream.floorPrice)} onChange={(what, tiers) => set(what, (r) => (r.tiers = tiers))} />
        </div>
      </div>
      <div className="mt-4 border-t border-line-soft pt-3 text-[13.5px] text-ink-2 space-y-1">
        {viaSubscription ? (
          <p>ACUs are billed as subscription overage, so tiers and the commitment do not apply while the subscription includes ACUs.</p>
        ) : (
          <p>
            At steady state the client is billed <span className="num font-semibold text-ink">{money(steadyRevenue ?? 0, cur, 0)}</span> a month for{' '}
            <span className="num">{n(acus).toLocaleString('en-IN', { maximumFractionDigits: 0 })}</span> ACUs, an effective <span className="num font-semibold text-ink">{unitPrice(safeDiv(usageAmt, acus), cur)}</span>{' '}
            per ACU before any commitment true-up.
          </p>
        )}
      </div>
    </Panel>
  );
}

function nextVersion(versions: RateCardVersion[]): string {
  const nums = versions.map((v) => Number(v.version.replace(/^v/i, ''))).filter((x) => Number.isFinite(x));
  return `v${(nums.length ? Math.max(...nums) : 0) + 1}`;
}

export function snapshotRateCard(project: Project, result: ProjectResult, author: string, note: string): RateCardVersion {
  const streams = result.priceBook.streams;
  const acu = streams.find((s) => s.type === 'acu');
  const abu = streams.find((s) => s.type === 'abu')?.abu;
  const sub = streams.find((s) => s.type === 'subscription')?.subscription;
  const agentOps = streams.find((s) => s.type === 'agentops');
  return {
    id: uid('rcv'),
    version: nextVersion(project.pricing.rateCardVersions),
    createdAt: new Date().toISOString(),
    author,
    status: 'draft',
    note,
    acuPrice: acu?.unitPrice ? acu.unitPrice.toString() : null,
    abuPrices: abu ? Object.fromEntries(Object.values(abu.byWorkflow).map((w) => [w.workflowId, w.price.toString()])) : {},
    subscriptionFee: sub ? sub.totalFee.toString() : null,
    agentOpsFee: agentOps?.monthlyFee ? agentOps.monthlyFee.toString() : null,
  };
}

const STATUS_TONE: Record<RateCardVersion['status'], 'warn' | 'good' | 'neutral'> = { draft: 'warn', approved: 'good', superseded: 'neutral' };
const STATUS_LABEL: Record<RateCardVersion['status'], string> = { draft: 'Draft', approved: 'Approved', superseded: 'Superseded' };

export function RateCardVersions({ project, result, update }: { project: Project; result: ProjectResult; update: Updater }) {
  const { state } = useStore();
  const canSave = useCan('pricing.edit');
  const canApprove = useCan('ratecard.approve');
  const [note, setNote] = useState('');
  const cur = result.currency;
  const versions = [...project.pricing.rateCardVersions].reverse();
  const current = snapshotRateCard(project, result, state.user.name, note);
  const wfName = (id: string) => project.workflows.find((w) => w.id === id)?.name ?? 'Removed workflow';
  const priceOrDash = (v: string | null, suffix = '') => (v === null ? '—' : `${unitPrice(D(v), cur)}${suffix}`);
  const feeOrDash = (v: string | null) => (v === null ? '—' : `${money(D(v), cur, 0)}/mo`);

  const save = () => {
    update('Saved rate card version', (d) => void d.pricing.rateCardVersions.push(snapshotRateCard(d, result, state.user.name, note.trim())), `${current.version}${note.trim() ? `: ${note.trim()}` : ''}`);
    setNote('');
  };
  const approve = (id: string, version: string) =>
    update(
      'Approved rate card version',
      (d) => {
        for (const v of d.pricing.rateCardVersions) {
          if (v.id === id) v.status = 'approved';
          else if (v.status === 'approved') v.status = 'superseded';
        }
      },
      version,
    );

  return (
    <Panel title="Rate card versions" description="Save the current derived prices as a version to send for approval. Approving a draft supersedes the previously approved version." padded={false}>
      <div className="px-4 pb-3">
        <ReadOnlyNote show={!canSave} what="save rate card versions" />
        <div className="rounded-lg bg-sunken border border-line px-3 py-2.5 text-[13px]">
          <div className="font-semibold text-ink mb-1">Current prices ({current.version} if saved)</div>
          <div className="grid gap-x-4 gap-y-0.5 sm:grid-cols-2 text-ink-2">
            <span>
              ACU: <span className="num text-ink">{priceOrDash(current.acuPrice)}</span>
            </span>
            {Object.entries(current.abuPrices).map(([wf, p]) => (
              <span key={wf} className="truncate">
                {wfName(wf)}: <span className="num text-ink">{priceOrDash(p, ' / ABU')}</span>
              </span>
            ))}
            <span>
              Subscription: <span className="num text-ink">{feeOrDash(current.subscriptionFee)}</span>
            </span>
            <span>
              AgentOps: <span className="num text-ink">{feeOrDash(current.agentOpsFee)}</span>
            </span>
          </div>
        </div>
        <div className="flex flex-wrap items-end gap-2 mt-3">
          <Field label="Note" className="flex-1 min-w-[200px]">
            <TextInput value={note} onChange={setNote} placeholder="What changed, e.g. 6% volume tier added" disabled={!canSave} ariaLabel="Rate card version note" />
          </Field>
          <Button variant="primary" className="!text-brand-ink" disabled={!canSave} onClick={save}>
            Save rate card version
          </Button>
        </div>
      </div>
      <div className="scroll-x">
        <table className="dtable min-w-[700px]">
          <thead>
            <tr>
              <th>Version</th>
              <th className="r">ACU price</th>
              <th className="r">ABU prices</th>
              <th className="r">Subscription</th>
              <th className="r">AgentOps</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {versions.length === 0 && (
              <tr>
                <td colSpan={6} className="text-[13.5px] text-ink-3">
                  No versions saved yet. Save the current prices to start an approval trail.
                </td>
              </tr>
            )}
            {versions.map((v) => (
              <tr key={v.id} className="align-top">
                <td>
                  <div className="font-semibold">{v.version}</div>
                  <div className="text-[12px] text-ink-3">
                    {v.author}, {dateTime(v.createdAt)}
                  </div>
                  {v.note && <div className="text-[12.5px] text-ink-2 max-w-[240px]">{v.note}</div>}
                </td>
                <td className="r">{priceOrDash(v.acuPrice)}</td>
                <td className="r text-[13px]">
                  {Object.keys(v.abuPrices).length === 0
                    ? '—'
                    : Object.entries(v.abuPrices).map(([wf, p]) => (
                        <div key={wf} className="whitespace-nowrap">
                          <span className="text-ink-3">{project.workflows.length > 1 ? `${wfName(wf)} ` : ''}</span>
                          {unitPrice(D(p), cur)}
                        </div>
                      ))}
                </td>
                <td className="r">{feeOrDash(v.subscriptionFee)}</td>
                <td className="r">{feeOrDash(v.agentOpsFee)}</td>
                <td>
                  <div className="flex flex-col items-start gap-1">
                    <Badge tone={STATUS_TONE[v.status]}>{STATUS_LABEL[v.status]}</Badge>
                    {v.status === 'draft' && canApprove && (
                      <Button size="sm" icon={<CheckCircle2 size={13} />} onClick={() => approve(v.id, v.version)}>
                        Approve
                      </Button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!canApprove && versions.some((v) => v.status === 'draft') && <p className="px-4 pt-2 pb-3 text-[12.5px] text-ink-3">Drafts are approved by a role with rate card approval, such as Finance.</p>}
    </Panel>
  );
}
