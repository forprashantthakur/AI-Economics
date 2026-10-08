import { useMemo } from 'react';
import { buildPriceBook, defaultPricing, POOL_LABELS, priceForMargin, RUN_POOLS, safeDiv, sum, ZERO, type RevenueStream } from '@aies/engine';
import { BarList, POOL_COLOR } from '../components/charts';
import { Badge, Callout, Empty, IssueList, KeyValues, PageHeader, Panel, StatStrip } from '../components/ui';
import { compact, count, n, pct, unitPrice } from '../lib/format';
import { href } from '../lib/router';
import { useCan, useCurrentProject, useProjectUpdater, useResult, useStore } from '../state/store';
import { issuesWith, TextLink, useWorkflowId, WorkflowPicker } from './costing/common';
import { Funnel } from './abu/Funnel';
import { ComplexityPanel, DefinitionPanel, FunnelInputs, HumanReviewPanel, useWorkflowSetter } from './abu/WorkflowInputs';
import { AbuPricingControls, ClassPriceTable, RecoveryCheck } from './abu/Pricing';

const ABU_ISSUES = ['ABU_FLOOR', 'MIX_NOT_100', 'ABU_WEIGHT', 'ABU_DEFINITION', 'RATE_RANGE', 'NEGATIVE_VOLUME', 'REVIEW_DOUBLE_COUNT', 'MULTI_UNIT_STREAM', 'NO_WORKFLOWS'];

export function AbuCalculator() {
  const { state } = useStore();
  const project = useCurrentProject();
  const result = useResult(project);
  const update = useProjectUpdater(project?.id);
  const canTok = useCan('tokenomics.edit');
  const canPrice = useCan('pricing.edit');
  const [wfId, setWfId] = useWorkflowId(project);
  const setWf = useWorkflowSetter(update, wfId);

  const stream = result?.priceBook.streams.find((s) => s.type === 'abu');
  // No ABU stream: derive an indicative price with the engine, as if one ABU stream recovered every run pool.
  const indicativeStream = useMemo(() => {
    if (!result || stream) return undefined;
    const tpl = defaultPricing().streams.find((s) => s.type === 'abu');
    const s: RevenueStream = { id: 'indicative-abu', type: 'abu', label: 'Indicative ABU price', enabled: true, recovers: [...RUN_POOLS], targetMarginPct: tpl?.targetMarginPct ?? 35, discountPct: 0 };
    return buildPriceBook({ project: result.project, baseline: result.baseline, impl: result.implementation, marginal: result.marginal, streams: [s] }).streams[0];
  }, [result, stream]);

  if (!project || !result)
    return (
      <div>
        <PageHeader title="ABU calculator" />
        <Empty title="No project selected" body="Create a project to define and price AI Business Units." action={<TextLink href={href('new-project')}>Create a project</TextLink>} />
      </div>
    );

  const wf = project.workflows.find((w) => w.id === wfId);
  if (!wf)
    return (
      <div>
        <PageHeader title="ABU calculator" />
        <Empty
          title="No workflows yet"
          body="An ABU is one accepted business outcome of a workflow. Add a workflow on the project page first."
          action={<TextLink href={href('project', project.id)}>Open the project</TextLink>}
        />
      </div>
    );

  const cur = result.currency;
  const f = (v: number) => compact(v, cur);
  const b = result.baseline;
  const v = b.volumes[wf.id];
  const priced = stream ?? indicativeStream;
  const wp = priced?.abu?.byWorkflow[wf.id];
  const indicative = !stream;
  const margin = priced?.targetMarginPct ?? 0;
  const wfRun = b.runCostByWorkflow[wf.id] ?? ZERO;
  const wfPools = b.poolsByWorkflow[wf.id];
  const wfFailurePools = b.failureCostByWorkflowPool[wf.id];
  const failure = b.failureCostByWorkflow[wf.id] ?? ZERO;
  const fullyLoaded = safeDiv(wfRun, v.weightedAbus);
  const heroPrice = wp && margin < 100 ? priceForMargin(wp.costPerAbu, margin) : undefined;
  const billableDiffers = wp ? !wp.billableUnits.eq(wp.weightedAbus) : false;
  const recovers = new Set(priced?.recovers ?? []);
  const check = result.reconciliation.find((c) => c.id === 'abu-recovery');
  const issues = issuesWith(result, ABU_ISSUES);
  const reviewHours = wf.humanReview.borneBy === 'provider' ? b.humanReviewHoursByWorkflow[wf.id] : b.clientReviewHoursByWorkflow[wf.id];
  const ro = !(canTok || canPrice);
  const steadyAbuRevenue = stream ? result.steady.revenueByStream[stream.streamId] : undefined;

  return (
    <div>
      <PageHeader
        title="ABU calculator"
        meta={`${project.name}. Steady-state month, amounts in ${cur}.`}
        description="Define the business outcome the client pays for, model the transaction funnel, and derive the price per accepted AI Business Unit from attributable cost."
      />

      <div className="mb-4">
        <WorkflowPicker project={project} value={wf.id} onChange={setWfId} />
      </div>

      {wp && (
        <section aria-label="ABU price derivation" className="mb-5">
          <p className="font-serif text-[20px] sm:text-[24px] leading-snug text-ink max-w-5xl tracking-[-0.005em]">
            <span className="num font-semibold">{compact(wp.recoveredCost, cur)}</span> attributable cost ÷ <span className="num font-semibold">{count(wp.weightedAbus, cur)}</span> weighted accepted ABUs ={' '}
            <span className="num font-semibold">{unitPrice(wp.costPerAbu, cur)}</span> cost per ABU; ÷ (1 − <span className="num font-semibold">{pct(margin, 0)}</span>) ={' '}
            <span className="num font-semibold">{unitPrice(heroPrice, cur)}</span> {indicative ? 'indicative ' : ''}price per {wf.abuName}
          </p>
          <p className="text-[13.5px] text-ink-3 mt-1.5 max-w-5xl">
            Cost per accepted ABU = attributable cost ÷ weighted accepted ABUs. ABU price = cost per ABU ÷ (1 − target margin).{' '}
            {billableDiffers && (
              <>
                Human-assisted completions bill at {n(project.pricing.abuRateCard.humanAssistedPriceFactor)}×, so the list price per billable ABU is {unitPrice(wp.listPrice, cur)}.{' '}
              </>
            )}
            {wp.overridden && <>A negotiated price of {unitPrice(wp.price, cur)} applies. </>}
            {!wp.overridden && wp.floorApplied && <>Raised to the margin floor: {unitPrice(wp.price, cur)}. </>}
            {!wp.overridden && !wp.floorApplied && !wp.price.eq(wp.listPrice) && <>After the stream discount: {unitPrice(wp.price, cur)}. </>}
          </p>
        </section>
      )}

      <div className="space-y-5">
        {indicative && (
          <Callout tone="warn" title="Indicative price only">
            The commercial model has no ABU revenue stream, so this price assumes one ABU stream recovering every run cost pool at a {pct(margin, 0)} margin. Nothing is billed per ABU. Add an ABU stream in{' '}
            <TextLink href={href('commercial')}>Commercial Pricing</TextLink> to use it.
          </Callout>
        )}

        <StatStrip
          items={[
            { label: 'Weighted accepted ABUs', value: count(v.weightedAbus, cur), sub: `${count(v.accepted, cur)} accepted ${wf.abuName}s / month` },
            { label: 'Fully loaded cost per ABU', value: unitPrice(fullyLoaded, cur), sub: `${compact(wfRun, cur)} run cost / month` },
            { label: 'Attributable cost per ABU', value: unitPrice(wp?.costPerAbu ?? 0, cur), sub: indicative ? 'All run pools (indicative)' : 'Pools the ABU stream recovers' },
            {
              label: indicative ? 'Indicative price per ABU' : 'Price per ABU',
              value: unitPrice(wp?.price ?? 0, cur),
              sub: wp?.overridden ? 'Negotiated' : wp?.floorApplied ? 'Raised to margin floor' : `At ${pct(margin, 0)} target margin`,
              tone: indicative ? 'neutral' : 'good',
            },
            {
              label: 'Failure and rework cost',
              value: compact(failure, cur),
              sub: `${pct(safeDiv(failure, wfRun).times(100), 0)} of this workflow’s run cost`,
              tone: n(safeDiv(failure, wfRun)) > 0.15 ? 'warn' : 'neutral',
            },
            ...(steadyAbuRevenue ? [{ label: 'ABU revenue per month', value: compact(steadyAbuRevenue, cur), sub: 'All workflows, steady state' }] : []),
          ]}
        />

        <div className="grid gap-5 xl:grid-cols-[1.1fr_1fr]">
          <DefinitionPanel wf={wf} setWf={setWf} ro={ro} />
          <Funnel v={v} abuName={wf.abuName} cur={cur} />
        </div>

        <FunnelInputs wf={wf} setWf={setWf} ro={ro} />

        <ComplexityPanel wf={wf} v={v} setWf={setWf} ro={ro} cur={cur} overrideActive={project.pricing.abuRateCard.classPricing === 'override'} />

        <div className="grid gap-5 xl:grid-cols-[1.1fr_1fr]">
          <Panel
            title="Cost build-up per weighted ABU"
            description="This workflow’s monthly cost by pool divided by weighted accepted ABUs. Failure and rework cost is the part spent on failed, retried or rejected work."
          >
            <BarList
              items={RUN_POOLS.filter((p) => !wfPools[p].isZero()).map((p) => {
                const fail = wfFailurePools[p];
                return {
                  label: (
                    <span className="inline-flex items-center gap-1.5">
                      {POOL_LABELS[p]} {!recovers.has(p) && <Badge>not in ABU price</Badge>}
                    </span>
                  ),
                  value: n(safeDiv(wfPools[p], v.weightedAbus)),
                  color: POOL_COLOR[p],
                  sub: fail.isZero() ? undefined : `includes ${unitPrice(safeDiv(fail, v.weightedAbus), cur)} failure and rework`,
                };
              })}
              format={(x) => unitPrice(x, cur)}
            />
            <KeyValues
              className="mt-4"
              rows={[
                ['Productive cost per ABU', unitPrice(safeDiv(wfRun.minus(failure), v.weightedAbus), cur)],
                ['Failure and rework per ABU', unitPrice(safeDiv(failure, v.weightedAbus), cur)],
                [<span className="font-semibold text-ink">Fully loaded cost per ABU</span>, <span className="font-semibold">{unitPrice(fullyLoaded, cur)}</span>],
                ...(wp && !wp.failureCostExcluded.isZero() ? ([['Failure cost absorbed by provider', f(n(wp.failureCostExcluded))]] as [string, string][]) : []),
              ]}
            />
          </Panel>
          <HumanReviewPanel wf={wf} setWf={setWf} ro={ro} catalog={state.catalog} hours={count(reviewHours ?? 0, cur)} cost={compact(b.humanReviewByWorkflow[wf.id] ?? 0, cur)} cur={cur} />
        </div>

        <div className="grid gap-5 xl:grid-cols-[1.25fr_1fr]">
          <AbuPricingControls project={project} result={result} update={update} canEdit={canPrice} wf={wf} wp={wp} stream={priced} indicative={indicative} />
          <div className="space-y-5 min-w-0">
            {wp && <ClassPriceTable wf={wf} wp={wp} cur={cur} indicative={indicative} />}
            <Panel title="ABU checks" description="Definition, complexity mix, funnel ranges and price floors.">
              <IssueList issues={issues} empty="No ABU issues." />
            </Panel>
          </div>
        </div>

        {stream && <RecoveryCheck check={check} stream={stream} cur={cur} project={project} />}

        {project.workflows.length > 1 && (
          <Panel title="All workflows" padded={false}>
            <div className="scroll-x">
              <table className="dtable min-w-[640px]">
                <thead>
                  <tr>
                    <th>Workflow</th>
                    <th className="r">Weighted ABUs</th>
                    <th className="r">Cost per ABU</th>
                    <th className="r">{indicative ? 'Indicative price' : 'Price'} per ABU</th>
                    <th className="r">Fully loaded cost</th>
                  </tr>
                </thead>
                <tbody>
                  {project.workflows.map((w) => {
                    const p = priced?.abu?.byWorkflow[w.id];
                    return (
                      <tr key={w.id}>
                        <td>
                          <button type="button" className="font-semibold text-brand hover:underline text-left" onClick={() => setWfId(w.id)}>
                            {w.name}
                          </button>
                        </td>
                        <td className="r">{count(b.volumes[w.id]?.weightedAbus ?? 0, cur)}</td>
                        <td className="r">{unitPrice(p?.costPerAbu ?? 0, cur)}</td>
                        <td className="r font-semibold">{unitPrice(p?.price ?? 0, cur)}</td>
                        <td className="r">{unitPrice(safeDiv(b.runCostByWorkflow[w.id] ?? 0, b.volumes[w.id]?.weightedAbus ?? 0), cur)}</td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr>
                    <td>All workflows</td>
                    <td className="r">{count(b.totals.weightedAbus, cur)}</td>
                    <td className="r">{unitPrice(priced?.unitCost ?? safeDiv(sum(Object.values(priced?.abu?.byWorkflow ?? {}).map((x) => x.recoveredCost)), b.totals.weightedAbus), cur)}</td>
                    <td className="r">{unitPrice(priced?.abu?.blendedPrice ?? 0, cur)} blended</td>
                    <td className="r">{unitPrice(result.economics.provider.costToServePerAbu, cur)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </Panel>
        )}
      </div>
    </div>
  );
}
