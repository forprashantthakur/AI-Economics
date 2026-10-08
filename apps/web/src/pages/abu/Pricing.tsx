import { CheckCircle2, XCircle } from 'lucide-react';
import { POOL_LABELS, sum, ZERO, type AbuWorkflowPrice, type Project, type ProjectResult, type ReconCheck, type StreamPrice, type Workflow } from '@aies/engine';
import { Badge, Field, Panel, ReadOnlyNote, Segmented, cx } from '../../components/ui';
import { compact, money, n, unitPrice } from '../../lib/format';
import { OptionalNumberInput, type Updater, Num } from '../costing/common';
import { TierEditor, bandPriceFrom } from '../acu/RateCard';

export function AbuPricingControls({
  project,
  result,
  update,
  canEdit,
  wf,
  wp,
  stream,
  indicative,
}: {
  project: Project;
  result: ProjectResult;
  update: Updater;
  canEdit: boolean;
  wf: Workflow;
  wp: AbuWorkflowPrice | undefined;
  stream: StreamPrice | undefined;
  indicative: boolean;
}) {
  const ro = !canEdit;
  const cur = result.currency;
  const rc = project.pricing.abuRateCard;
  const set = (what: string, fn: (r: Project['pricing']['abuRateCard']) => void) => update(what, (d) => fn(d.pricing.abuRateCard));
  const owned = (stream?.recovers ?? []).filter((p) => p !== 'IMPLEMENTATION');
  const failureInOwned = sum(owned.map((p) => result.baseline.failureCostByWorkflowPool[wf.id]?.[p] ?? ZERO));
  const blended = stream?.abu?.blendedPrice;
  const override = rc.priceOverrides?.[wf.id];

  return (
    <Panel
      title="ABU rate card"
      description={
        indicative
          ? 'These settings apply once an ABU stream is added; the indicative price above already reflects them.'
          : 'How the ABU price is derived and billed. Prices are locked at contract start and escalated yearly.'
      }
    >
      <ReadOnlyNote show={ro} what="edit the ABU rate card" />
      <div className="space-y-4">
        <Field label="Cost of failed, retried and rejected work">
          <div className={cx(ro && 'pointer-events-none opacity-60')}>
            <Segmented
              ariaLabel="Failed cost allocation"
              value={rc.failedCostAllocation}
              onChange={(v) => set('Changed failed-cost allocation', (r) => (r.failedCostAllocation = v))}
              options={[
                { id: 'spread', label: 'Spread over ABUs' },
                { id: 'provider_absorbs', label: 'Provider absorbs' },
              ]}
            />
          </div>
          <p className="text-[13px] text-ink-2 mt-1.5 leading-snug">
            {rc.failedCostAllocation === 'spread' ? (
              <>
                The client pays for failure through the unit price: <span className="num font-semibold text-ink">{compact(failureInOwned, cur)}</span> a month of failed and rework cost is included in the cost per ABU,
                about <span className="num">{unitPrice(wp && !wp.weightedAbus.isZero() ? failureInOwned.div(wp.weightedAbus) : 0, cur)}</span> per ABU.
              </>
            ) : (
              <>
                The provider carries <span className="num font-semibold text-ink">{compact(wp?.failureCostExcluded ?? 0, cur)}</span> a month of failure cost. The ABU price covers productive work only, so improving the
                success rate raises provider margin rather than lowering the client’s price.
              </>
            )}
          </p>
        </Field>

        <div className="grid gap-4 grid-cols-2">
          <Field label="Human-assisted price factor" hint="1 = same price as autonomous; 0.8 = assisted completions billed at 80%.">
            <Num
              value={rc.humanAssistedPriceFactor}
              min={0}
              max={2}
              step={0.05}
              disabled={ro}
              ariaLabel="Human-assisted price factor"
              onChange={(v) => set('Changed human-assisted price factor', (r) => (r.humanAssistedPriceFactor = v))}
            />
          </Field>
          <Field label="Class pricing" hint={rc.classPricing === 'weighted' ? 'Class price = ABU price × class weight.' : 'Class price overrides from the complexity table, where set.'}>
            <div className={cx(ro && 'pointer-events-none opacity-60')}>
              <Segmented
                ariaLabel="Class pricing"
                value={rc.classPricing}
                onChange={(v) => set('Changed class pricing method', (r) => (r.classPricing = v))}
                options={[
                  { id: 'weighted', label: 'Weighted' },
                  { id: 'override', label: 'Override' },
                ]}
              />
            </div>
          </Field>
          <Field label={`Negotiated price, ${wf.name}`} hint={wp ? `Per weighted ABU. Empty bills the derived ${unitPrice(wp.listPrice, cur)}.` : 'Per weighted ABU.'}>
            <OptionalNumberInput
              value={override}
              placeholder={wp ? n(wp.listPrice).toFixed(2) : 'None'}
              disabled={ro}
              ariaLabel="Negotiated price per weighted ABU"
              onChange={(v) =>
                set(v === null ? 'Removed negotiated ABU price' : 'Set negotiated ABU price', (r) => {
                  r.priceOverrides = { ...(r.priceOverrides ?? {}), [wf.id]: v };
                })
              }
            />
          </Field>
          <Field label="Margin floor" hint={wp ? `Price never falls below ${unitPrice(wp.floorPrice, cur)}.` : undefined}>
            <Num value={rc.marginFloorPct} min={0} max={95} suffix="%" disabled={ro} ariaLabel="ABU margin floor" onChange={(v) => set('Changed ABU margin floor', (r) => (r.marginFloorPct = v))} />
          </Field>
          <Field label="Minimum weighted ABUs per month" hint="Shortfall is billed at the blended price. Applies across all workflows.">
            <Num value={rc.minMonthlyAbus} min={0} step={1000} disabled={ro} ariaLabel="Minimum weighted ABUs per month" onChange={(v) => set('Changed minimum monthly ABUs', (r) => (r.minMonthlyAbus = v))} />
          </Field>
          <Field label="Tier mode" hint={rc.tierMode === 'graduated' ? 'Each band is priced at its own discount.' : 'All ABUs take the discount of the highest band reached.'}>
            <div className={cx(ro && 'pointer-events-none opacity-60')}>
              <Segmented
                ariaLabel="ABU tier mode"
                value={rc.tierMode}
                onChange={(v) => set('Changed ABU tier mode', (r) => (r.tierMode = v))}
                options={[
                  { id: 'graduated', label: 'Graduated' },
                  { id: 'all_units', label: 'All units' },
                ]}
              />
            </div>
          </Field>
        </div>

        <div>
          <div className="text-[13px] font-semibold text-ink-2 mb-1">Volume tiers on total weighted ABUs</div>
          <TierEditor tiers={rc.tiers} unit="ABU" disabled={ro} cur={cur} bandPrice={bandPriceFrom(blended, rc.tiers, undefined)} onChange={(what, tiers) => set(what, (r) => (r.tiers = tiers))} />
          {blended && <p className="text-[12.5px] text-ink-3 mt-1">Discounts apply to the blended price across workflows, {unitPrice(blended, cur)} per weighted ABU at steady state.</p>}
        </div>
      </div>
    </Panel>
  );
}

export function ClassPriceTable({ wf, wp, cur, indicative }: { wf: Workflow; wp: AbuWorkflowPrice; cur: string; indicative: boolean }) {
  const anyOverride = wp.classPrices.some((c, i) => {
    const k = wf.complexity[i];
    return k && k.priceOverride !== null && k.priceOverride !== undefined;
  });
  return (
    <Panel
      title={`Price per accepted ${wf.abuName}`}
      description={`${indicative ? 'Indicative prices. ' : ''}One accepted transaction of a class earns its ABU weight. Human-assisted completions are billed at the assisted price.`}
      padded={false}
    >
      <div className="scroll-x">
        <table className="dtable min-w-[460px]">
          <thead>
            <tr>
              <th>Class</th>
              <th className="r">ABU weight</th>
              <th className="r">Autonomous</th>
              <th className="r">Human-assisted</th>
            </tr>
          </thead>
          <tbody>
            {wp.classPrices.map((c) => (
              <tr key={c.classId}>
                <td className="font-semibold">{c.name}</td>
                <td className="r">{n(c.weight).toLocaleString('en-US', { maximumFractionDigits: 2 })}</td>
                <td className="r font-semibold">{unitPrice(c.price, cur)}</td>
                <td className="r">{unitPrice(c.assistedPrice, cur)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="px-4 pt-2 pb-3 flex flex-wrap gap-1.5">
        {wp.overridden && <Badge tone="brand">Negotiated price</Badge>}
        {wp.floorApplied && <Badge tone="warn">Raised to margin floor</Badge>}
        {anyOverride && <Badge>Class overrides set</Badge>}
      </div>
    </Panel>
  );
}

export function RecoveryCheck({ check, stream, cur, project }: { check: ReconCheck | undefined; stream: StreamPrice; cur: string; project: Project }) {
  if (!check) return null;
  const rows = Object.values(stream.abu?.byWorkflow ?? {});
  return (
    <Panel
      title="ABU cost recovery check"
      description="Cost allocated to each workflow’s ABU price, plus any failure cost the provider absorbs, must add back to the cost the ABU stream recovers. If it does not, some cost is priced twice or not at all."
      padded={false}
    >
      <div className="scroll-x">
        <table className="dtable min-w-[560px]">
          <thead>
            <tr>
              <th>Workflow</th>
              <th className="r">In ABU price</th>
              <th className="r">Absorbed failures</th>
              <th className="r">Total</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((w) => (
              <tr key={w.workflowId}>
                <td>{project.workflows.find((x) => x.id === w.workflowId)?.name ?? w.workflowId}</td>
                <td className="r">{money(w.recoveredCost, cur, 0)}</td>
                <td className="r">{money(w.failureCostExcluded, cur, 0)}</td>
                <td className="r">{money(w.recoveredCost.plus(w.failureCostExcluded), cur, 0)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td>
                <span className="inline-flex items-center gap-1.5">
                  {check.pass ? <CheckCircle2 size={16} className="text-good" aria-label="Pass" /> : <XCircle size={16} className="text-bad" aria-label="Fail" />}
                  {check.pass ? 'Reconciles to the stream' : 'Does not reconcile'}
                </span>
              </td>
              <td className="r" colSpan={2}>
                Stream recovers {money(check.expected, cur, 0)}
              </td>
              <td className={cx('r', !check.pass && 'text-bad')}>{money(check.actual, cur, 0)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
      <p className="px-4 pt-2 pb-3 text-[12.5px] text-ink-3">The stream recovers: {stream.recovers.map((p) => POOL_LABELS[p]).join(', ')}.</p>
    </Panel>
  );
}
