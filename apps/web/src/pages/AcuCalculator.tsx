import { useMemo } from 'react';
import { ACU_RESOURCES, POOL_LABELS, RUN_POOLS, costNormalizedAcus, findWeightSet, marginPct, safeDiv, sum, weightedAcuBreakdown, type AcuMethod, type CostPool } from '@aies/engine';
import { BarList, POOL_COLOR } from '../components/charts';
import { Badge, Callout, Checkbox, Empty, Field, IssueList, PageHeader, Panel, ReadOnlyNote, Segmented, Select, StatStrip, cx } from '../components/ui';
import { compact, compactCount, money, n, pct, unitPrice } from '../lib/format';
import { href } from '../lib/router';
import { agentName, workflowName } from '../lib/slice';
import { useCan, useCurrentProject, useProjectUpdater, useResult, useStore } from '../state/store';
import { currencyOptions, fmtUnits, issuesWith, Swatch, TextLink, Num } from './costing/common';
import { AcuRateCardPanel, RateCardVersions } from './acu/RateCard';

const ACU_ISSUES = ['ACU_FLOOR', 'ZERO_ACU', 'ACU_WEIGHTS_STATUS', 'ACU_WEIGHTS_MISSING', 'ACU_REFERENCE', 'ACU_IMPL', 'DERIVED_RESOURCE', 'SUB_NO_UNIT_STREAM', 'MULTI_UNIT_STREAM'];

const METHOD_LABEL: Record<AcuMethod, string> = {
  cost_normalized: 'Method A: cost-normalised',
  weighted_resource: 'Method B: weighted resource',
};
const METHOD_PHRASE: Record<AcuMethod, string> = {
  cost_normalized: 'Method A (cost-normalised)',
  weighted_resource: 'Method B (weighted resource)',
};

export function AcuCalculator() {
  const { state } = useStore();
  const project = useCurrentProject();
  const result = useResult(project);
  const update = useProjectUpdater(project?.id);
  const canMeter = useCan('pricing.edit');
  const catalog = state.catalog;
  const weightSet = project ? findWeightSet(catalog, project.acu.weightSetId) : undefined;
  const breakdown = useMemo(() => (result ? weightedAcuBreakdown(result.baseline.resources, weightSet) : []), [result, weightSet]);

  if (!project || !result)
    return (
      <div>
        <PageHeader title="ACU calculator" />
        <Empty title="No project selected" body="Create a project to measure AI Consumption Units." action={<TextLink href={href('new-project')}>Create a project</TextLink>} />
      </div>
    );

  const cur = result.currency;
  const f = (v: number) => compact(v, cur);
  const fc = (v: number) => compactCount(v);
  const b = result.baseline;
  const acu = b.acu;
  const cfg = project.acu;
  const ro = !canMeter;
  const stream = result.priceBook.streams.find((s) => s.type === 'acu');
  const sub = result.priceBook.streams.find((s) => s.type === 'subscription')?.subscription;
  const subAcu = sub && sub.includedUnit === 'acu' ? sub : undefined;
  const fullyLoaded = safeDiv(b.totalRunCost, acu.total);
  const recoveredPerAcu = stream?.unitCost;
  const price = stream?.unitPrice ?? (subAcu ? subAcu.allowanceUnitPrice : undefined);
  const costBasis = recoveredPerAcu ?? fullyLoaded;
  const marginPerAcu = price ? price.minus(costBasis) : undefined;
  const marginPerAcuPct = price ? marginPct(price, costBasis) : undefined;
  const issues = issuesWith(result, ACU_ISSUES);
  const steadyRevenue = stream ? result.steady.revenueByStream[stream.streamId] : undefined;
  const otherStreams = result.priceBook.streams.filter((s) => s.streamId !== stream?.streamId && s.type !== 'fixed_fee');

  const methodBox = (m: AcuMethod, total: typeof acu.methodA, body: string) => {
    const selected = cfg.method === m;
    return (
      <div className={cx('rounded-lg border px-4 py-3 min-w-0', selected ? 'border-brand bg-brand-tint' : 'border-line bg-paper')}>
        <div className="flex items-center justify-between gap-2">
          <div className="text-[13.5px] font-semibold text-ink">{METHOD_LABEL[m]}</div>
          {selected ? <Badge tone="brand">Used for billing</Badge> : <Badge>Shadow measure</Badge>}
        </div>
        <div className="num text-[22px] font-semibold text-ink mt-1">{fc(n(total))} ACUs</div>
        <p className="text-[12.5px] text-ink-3 leading-snug mt-0.5">{body}</p>
      </div>
    );
  };

  return (
    <div>
      <PageHeader
        title="ACU calculator"
        meta={`${project.name}. Steady-state month, amounts in ${cur}.`}
        description="Meter AI consumption in AI Consumption Units, see what one ACU costs to deliver, and set the rate card the client is billed against."
      />

      <section aria-label="ACU price" className="mb-5">
        {stream ? (
          <p className="font-serif text-[22px] sm:text-[26px] leading-snug text-ink max-w-4xl tracking-[-0.005em]">
            <span className="num font-semibold">{unitPrice(stream.unitCost, cur)}</span> cost per ACU ÷ (1 − <span className="num font-semibold">{pct(stream.targetMarginPct, 0)}</span>) ={' '}
            <span className="num font-semibold">{unitPrice(stream.listUnitPrice, cur)}</span> price per ACU
          </p>
        ) : (
          <p className="font-serif text-[22px] sm:text-[26px] leading-snug text-ink max-w-4xl tracking-[-0.005em]">
            <span className="num font-semibold">{compact(b.totalRunCost, cur)}</span> run cost ÷ <span className="num font-semibold">{fc(n(acu.total))}</span> ACUs ={' '}
            <span className="num font-semibold">{unitPrice(fullyLoaded, cur)}</span> fully loaded cost per ACU
          </p>
        )}
        <p className="text-[13.5px] text-ink-3 mt-1.5 max-w-4xl">
          {stream ? (
            <>
              Cost per ACU is the monthly cost of the pools the ACU stream recovers ({compact(stream.recoveredCost, cur)}) divided by {fc(n(acu.total))} ACUs measured with {METHOD_PHRASE[cfg.method]}.
              {stream.overridden && <> A negotiated price of {unitPrice(stream.unitPrice, cur)} replaces the derived price.</>}
              {!stream.overridden && stream.floorApplied && (
                <>
                  {' '}
                  The price was raised to the {pct(project.pricing.acuRateCard.marginFloorPct, 0)} margin floor: {unitPrice(stream.unitPrice, cur)}.
                </>
              )}
              {!stream.overridden && !stream.floorApplied && stream.unitPrice && stream.listUnitPrice && !stream.unitPrice.eq(stream.listUnitPrice) && (
                <> After the stream discount the client pays {unitPrice(stream.unitPrice, cur)}.</>
              )}
            </>
          ) : (
            <>Every run cost pool divided by the ACUs measured with {METHOD_PHRASE[cfg.method]}. There is no ACU price because the commercial model does not bill ACUs.</>
          )}
        </p>
      </section>

      <div className="space-y-5">
        <Callout tone="neutral" title="ACU is a proposed commercial abstraction, not an industry standard">
          It bundles tokens, model calls, retrieval, document pages and tool executions into one meter so consumption can be priced and compared over time. One token is not one ACU: tokens are weighted (Method B) or
          costed (Method A) before they count. Agree the definition and its version with the client before billing on it.
        </Callout>

        {!stream && (
          <Callout tone="warn" title="ACUs are measured for FinOps but not billed">
            The commercial model has no ACU revenue stream, so ACUs track consumption and cost per unit only{subAcu ? ' (the subscription allowance is valued at marginal cost plus margin)' : ''}. Add an ACU stream in{' '}
            <TextLink href={href('commercial')}>Commercial Pricing</TextLink> to bill them.
          </Callout>
        )}

        <StatStrip
          items={[
            { label: 'Eligible AI consumption cost', value: compact(acu.eligibleCost, cur), sub: `${cfg.eligiblePools.filter((p) => p !== 'IMPLEMENTATION').length} pools per month` },
            { label: 'ACUs per month', value: fc(n(acu.total)), sub: METHOD_LABEL[cfg.method] },
            { label: 'ACUs per transaction', value: fmtUnits(acu.perAttempted), sub: 'Per attempted transaction' },
            { label: 'ACUs per accepted ABU', value: fmtUnits(acu.perAcceptedAbu), sub: 'Per weighted accepted ABU' },
            {
              label: 'Cost per ACU',
              value: unitPrice(costBasis, cur),
              sub: recoveredPerAcu ? `Recovered by the ACU stream. Fully loaded ${unitPrice(fullyLoaded, cur)}` : 'Fully loaded run cost per ACU',
            },
            {
              label: 'Price per ACU',
              value: price ? unitPrice(price, cur) : 'Not billed',
              sub: stream
                ? stream.overridden
                  ? 'Negotiated price'
                  : stream.floorApplied
                    ? 'Raised to margin floor'
                    : `At ${pct(stream.targetMarginPct, 0)} target margin`
                : subAcu
                  ? 'Subscription allowance value'
                  : 'No ACU stream',
            },
            {
              label: 'Gross margin per ACU',
              value: marginPerAcu ? unitPrice(marginPerAcu, cur) : '—',
              sub: marginPerAcuPct ? `${pct(marginPerAcuPct)} of price` : 'Needs an ACU price',
              tone: marginPerAcu ? (marginPerAcu.lt(0) ? 'bad' : 'good') : 'neutral',
            },
          ]}
        />

        <Panel title="Measurement method" description="Both methods are computed every time so you can see how the meter would move. The selected method drives ACU counts, the ACU price and billing.">
          <div className={cx('mb-3', ro && 'pointer-events-none opacity-60')} inert={ro || undefined}>
            <Segmented<AcuMethod>
              ariaLabel="ACU measurement method"
              value={cfg.method}
              onChange={(v) => update('Changed ACU measurement method', (d) => void (d.acu.method = v))}
              options={[
                { id: 'cost_normalized', label: 'Method A' },
                { id: 'weighted_resource', label: 'Method B' },
              ]}
            />
          </div>
          <ReadOnlyNote show={ro} what="change the ACU definition" />
          <div className="grid gap-3 md:grid-cols-2">
            {methodBox(
              'cost_normalized',
              acu.methodA,
              `1 ACU = ${money(cfg.referenceValue, cfg.referenceCurrency, 2)} of eligible AI consumption cost at base-year prices. Tracks cost closely. Because later years are measured at base-year prices, ACU counts change with consumption, not with supplier price changes.`,
            )}
            {methodBox(
              'weighted_resource',
              acu.methodB,
              `Σ resource usage × versioned weights${weightSet ? ` (${weightSet.name} v${weightSet.version})` : ''}. Model-agnostic: re-routing to a cheaper model keeps ACU counts stable, so the provider keeps the efficiency gain.`,
            )}
          </div>
        </Panel>

        <div className="grid gap-5 xl:grid-cols-[1fr_1.35fr]">
          <Panel title="Method A settings" description="Reference value per ACU and the cost pools that count as AI consumption.">
            <div className="grid grid-cols-2 gap-3 mb-4">
              <Field label="Reference value per ACU">
                <Num value={cfg.referenceValue} min={0} step={0.1} disabled={ro} ariaLabel="Reference value per ACU" onChange={(v) => update('Changed ACU reference value', (d) => void (d.acu.referenceValue = v))} />
              </Field>
              <Field label="Currency">
                <Select
                  value={cfg.referenceCurrency}
                  options={currencyOptions(catalog)}
                  disabled={ro}
                  ariaLabel="Reference currency"
                  onChange={(v) => update('Changed ACU reference currency', (d) => void (d.acu.referenceCurrency = v))}
                />
              </Field>
            </div>
            <div className="text-[13px] font-semibold text-ink-2 mb-1">Eligible cost pools</div>
            <table className="dtable">
              <thead>
                <tr>
                  <th>Pool</th>
                  <th className="r">Cost / month</th>
                  <th className="r">ACUs</th>
                </tr>
              </thead>
              <tbody>
                {RUN_POOLS.map((p) => {
                  const on = cfg.eligiblePools.includes(p);
                  return (
                    <tr key={p}>
                      <td>
                        <Checkbox
                          checked={on}
                          disabled={ro}
                          label={POOL_LABELS[p]}
                          onChange={(v) =>
                            update(
                              v ? 'Added pool to ACU eligibility' : 'Removed pool from ACU eligibility',
                              (d) => void (d.acu.eligiblePools = v ? [...d.acu.eligiblePools, p] : d.acu.eligiblePools.filter((x) => x !== p)),
                              POOL_LABELS[p],
                            )
                          }
                        />
                      </td>
                      <td className={cx('r', !on && 'text-ink-3')}>{money(b.pools[p], cur, 0)}</td>
                      <td className={cx('r', !on && 'text-ink-3')}>{on ? fmtUnits(costNormalizedAcus(b.poolsAtBasePrices[p], cfg, cur, catalog.fx)) : '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr>
                  <td>Method A total</td>
                  <td className="r">{money(acu.eligibleCost, cur, 0)}</td>
                  <td className="r">{fmtUnits(acu.methodA)}</td>
                </tr>
              </tfoot>
            </table>
            <p className="text-[12.5px] text-ink-3 mt-2">ACUs use base-year (contract year 1) prices so later price changes do not change the count. Implementation is one-time and never eligible.</p>
          </Panel>

          <Panel title="Method B settings" description="Versioned weights convert each metered resource into ACUs." padded={false}>
            <div className="px-4 pb-3 space-y-3">
              <Field label="Weight set">
                <Select
                  value={weightSet ? weightSet.id : ''}
                  disabled={ro}
                  ariaLabel="ACU weight set"
                  options={[...(weightSet ? [] : [{ value: '', label: 'Choose a weight set' }]), ...catalog.acuWeightSets.map((w) => ({ value: w.id, label: `${w.name} v${w.version} (${w.status})` }))]}
                  onChange={(v) => v && update('Changed ACU weight set', (d) => void (d.acu.weightSetId = v))}
                />
              </Field>
              {weightSet ? (
                <div className="rounded-lg bg-sunken border border-line px-3 py-2.5 text-[13px]">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold text-ink">
                      {weightSet.name} v{weightSet.version}
                    </span>
                    <Badge tone={weightSet.status === 'approved' ? 'good' : weightSet.status === 'draft' ? 'warn' : 'bad'}>{weightSet.status}</Badge>
                  </div>
                  <div className="text-ink-3 mt-0.5">
                    By {weightSet.author}, effective {weightSet.effectiveDate}
                  </div>
                  <p className="text-ink-2 mt-1 leading-snug">{weightSet.rationale}</p>
                  <p className="text-[12.5px] text-ink-3 mt-1">
                    Weight sets are maintained in <TextLink href={href('settings')}>Settings</TextLink>.
                  </p>
                </div>
              ) : (
                <Callout tone="bad">The selected weight set no longer exists, so Method B measures zero ACUs. Choose another weight set.</Callout>
              )}
            </div>
            <div className="scroll-x">
              <table className="dtable min-w-[560px]">
                <thead>
                  <tr>
                    <th>Resource</th>
                    <th className="r">Usage / month</th>
                    <th className="r">Weight</th>
                    <th className="r">ACUs</th>
                  </tr>
                </thead>
                <tbody>
                  {breakdown
                    .filter((x) => !x.units.isZero() || !x.weight.isZero())
                    .map((x) => (
                      <tr key={x.key}>
                        <td>
                          <div>{x.label}</div>
                          <div className="text-[12px] text-ink-3">{ACU_RESOURCES[x.key].derived ? 'From the workflow and LLM model' : 'From mapped cost lines'}</div>
                        </td>
                        <td className="r">
                          {fmtUnits(x.units)} <span className="text-ink-3 text-[12px]">× {x.unit}</span>
                        </td>
                        <td className="r">{n(x.weight).toLocaleString('en-US', { maximumFractionDigits: 4 })}</td>
                        <td className="r font-semibold">{fmtUnits(x.acus)}</td>
                      </tr>
                    ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td colSpan={3}>Method B total</td>
                    <td className="r">{fmtUnits(sum(breakdown.map((x) => x.acus)))}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
            <p className="px-4 pt-2 pb-3 text-[12.5px] text-ink-3">Usage × weight = ACUs. Weights are ACUs per unit shown; token resources are per million tokens, so one token is a small fraction of an ACU.</p>
          </Panel>
        </div>

        <div className="grid gap-5 lg:grid-cols-2">
          <Panel title="ACUs by workflow" description={METHOD_LABEL[cfg.method]}>
            <BarList
              items={Object.entries(acu.byWorkflow)
                .sort((a, c) => c[1].cmp(a[1]))
                .map(([id, v]) => ({ label: workflowName(result, id), value: n(v), sub: `${fmtUnits(safeDiv(v, b.volumes[id]?.attempted ?? 0))} per transaction` }))}
              format={fc}
            />
          </Panel>
          <Panel title="ACUs by agent" description="Allocated by each agent’s share of LLM consumption in its workflow.">
            <BarList
              items={Object.entries(acu.byAgent)
                .filter(([, v]) => !v.isZero())
                .sort((a, c) => c[1].cmp(a[1]))
                .map(([id, v]) => ({ label: agentName(result, id), value: n(v) }))}
              format={fc}
            />
          </Panel>
        </div>

        <Panel
          title="Cost included in the ACU price"
          description={stream ? `The “${stream.label}” stream recovers these pools. Their monthly cost ÷ ACUs gives the cost per ACU.` : 'No ACU stream exists, so no cost is recovered through ACUs.'}
          actions={<TextLink href={href('commercial')}>Edit streams</TextLink>}
        >
          {stream ? (
            <div className="grid gap-5 md:grid-cols-[1.2fr_1fr]">
              <div>
                <BarList
                  items={stream.recovers
                    .filter((p): p is CostPool => p !== 'IMPLEMENTATION')
                    .map((p) => ({ label: POOL_LABELS[p], value: n(b.pools[p]), color: POOL_COLOR[p] }))
                    .sort((a, c) => c.value - a.value)}
                  format={f}
                />
                {stream.recovers.includes('IMPLEMENTATION') && <p className="text-[12.5px] text-ink-3 mt-2">Also includes implementation cost amortised over the {project.pricing.termMonths}-month term.</p>}
                <div className="flex justify-between gap-3 border-t border-line pt-2 mt-3 text-sm">
                  <span className="text-ink-2">Recovered cost per month</span>
                  <span className="num font-semibold">{money(stream.recoveredCost, cur, 0)}</span>
                </div>
              </div>
              <div>
                <div className="text-[13px] font-semibold text-ink-2 mb-1.5">Not in the ACU price</div>
                <ul className="space-y-1.5 text-[13.5px]">
                  {RUN_POOLS.filter((p) => !stream.recovers.includes(p) && !b.pools[p].isZero()).map((p) => {
                    const owner = result.priceBook.recovery[p][0];
                    const label = otherStreams.find((s) => s.streamId === owner)?.label;
                    return (
                      <li key={p} className="flex items-baseline justify-between gap-3">
                        <Swatch color={POOL_COLOR[p]} label={POOL_LABELS[p]} />
                        <span className={cx('text-[12.5px] text-right', label ? 'text-ink-3' : 'text-warn font-semibold')}>{label ? `in ${label}` : 'Not recovered'}</span>
                      </li>
                    );
                  })}
                </ul>
              </div>
            </div>
          ) : (
            <p className="text-[13.5px] text-ink-2">Run cost is recovered by {otherStreams.map((s) => s.label).join(', ') || 'no stream'}. ACUs here measure consumption only.</p>
          )}
        </Panel>

        {stream && <AcuRateCardPanel project={project} result={result} update={update} stream={stream} steadyRevenue={steadyRevenue} />}
        <RateCardVersions project={project} result={result} update={update} />

        <Panel title="ACU checks" description="Weight-set status, reference value, derived resource mappings and price floors.">
          <IssueList issues={issues} empty="No ACU issues." />
        </Panel>
      </div>
    </div>
  );
}
