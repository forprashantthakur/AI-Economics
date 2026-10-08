import { useMemo } from 'react';
import { Copy, Plus, Trash2, X } from 'lucide-react';
import { addTo, fxRate, safeDiv, sum, uid, ZERO, type Decimal, type LlmStep } from '@aies/engine';
import { BarList } from '../../components/charts';
import { Badge, Button, Callout, IssueList, Panel, ReadOnlyNote, Select, StatStrip, TextInput, Toggle, cx } from '../../components/ui';
import { compact, money, n, pct, tokens, unitPrice } from '../../lib/format';
import { href } from '../../lib/router';
import { agentName, modelName, workflowName } from '../../lib/slice';
import { IconButton, issuesWith, TextLink, TIGHT, useWorkflowId, WorkflowPicker, type EditorProps, Num } from './common';

const LLM_ISSUES = ['CONTEXT_WINDOW', 'ROUTING_NOT_100', 'UNKNOWN_MODEL', 'PREFIX_GT_INPUT', 'UNKNOWN_AGENT', 'SAMPLE_RATES', 'MODEL'];

export function LlmTab({ project, result, update, canEdit }: EditorProps) {
  const cur = result.currency;
  const f = (v: number) => compact(v, cur);
  const ro = !canEdit;
  const b = result.baseline;
  const catalog = result.context.catalog;
  const [wfId, setWfId] = useWorkflowId(project);
  const wf = project.workflows.find((w) => w.id === wfId);
  const usd = fxRate('USD', cur, catalog.fx);

  const byFunction = useMemo(() => {
    const m: Record<string, Decimal> = {};
    for (const w of project.workflows) addTo(m, w.businessFunction || 'Unspecified', b.llm.byWorkflow[w.id] ?? ZERO);
    return m;
  }, [project.workflows, b]);

  const modelsInUse = useMemo(() => {
    const ids = new Set(project.workflows.flatMap((w) => w.llmSteps.flatMap((s) => s.routing.map((r) => r.modelId))));
    return catalog.modelRates.filter((m) => ids.has(m.id));
  }, [project.workflows, catalog.modelRates]);
  const sampleInUse = modelsInUse.some((m) => m.sample);
  const modelOptions = catalog.modelRates.map((m) => ({ value: m.id, label: `${m.model}${m.sample ? ' (sample rate)' : ''}` }));
  const agentOptions = [{ value: '', label: 'Unassigned' }, ...project.agents.map((a) => ({ value: a.id, label: a.name }))];

  const issues = issuesWith(result, LLM_ISSUES).filter((i) => i.code !== 'MODEL' || /^(Step|Model) /.test(i.message));
  const wfLines = b.llmLines.filter((l) => l.workflowId === wfId);
  const wfLlm = b.llm.byWorkflow[wfId] ?? ZERO;
  const wfVol = b.volumes[wfId];

  const setStep = (stepId: string, what: string, fn: (s: LlmStep) => void) =>
    update(what, (d) => {
      const s = d.workflows.find((w) => w.id === wfId)?.llmSteps.find((x) => x.id === stepId);
      if (s) fn(s);
    });

  const addStep = () =>
    update('Added LLM step', (d) => {
      const w = d.workflows.find((x) => x.id === wfId);
      if (!w) return;
      const model = w.llmSteps[w.llmSteps.length - 1]?.routing[0]?.modelId ?? catalog.modelRates[0]?.id ?? '';
      w.llmSteps.push({
        id: uid('step'),
        name: 'New step',
        agentId: d.agents[0]?.id ?? '',
        callsPerExecution: 1,
        inputTokens: 2000,
        outputTokens: 300,
        reasoningTokens: 0,
        cacheablePrefixTokens: 0,
        cacheHitRatePct: 0,
        batchEligiblePct: 0,
        toolCall: false,
        routing: [{ modelId: model, sharePct: 100 }],
      });
    });

  return (
    <div className="space-y-5">
      <StatStrip
        items={[
          { label: 'LLM cost per month', value: compact(b.llm.total, cur), sub: `${pct(safeDiv(b.llm.total, b.totalRunCost).times(100), 0)} of run cost, steady state` },
          { label: 'Year 1 LLM cost', value: compact(result.years[0]?.llmCost ?? 0, cur), sub: 'Including ramp-up and growth' },
          { label: 'Per attempted transaction', value: unitPrice(b.llm.perAttempted, cur), sub: `${tokens(b.totals.attempted)} attempted / month` },
          { label: 'Per accepted transaction', value: unitPrice(b.llm.perAccepted, cur), sub: 'Failures and retries carried by accepted work' },
          { label: 'LLM cost per ACU', value: unitPrice(safeDiv(b.llm.total, b.acu.total), cur), sub: `${tokens(b.acu.total)} ACUs / month` },
        ]}
      />

      <Callout tone={sampleInUse ? 'warn' : 'neutral'}>
        Model rates are converted from USD at <span className="num font-semibold text-ink">1 USD = {unitPrice(usd, cur)}</span> (FX table as of {catalog.fx.asOf}).{' '}
        {sampleInUse ? (
          <>
            Models marked <span className="font-semibold">sample rate</span> are illustrative, not vendor quotes. Replace them with published or contracted rates in <TextLink href={href('settings')}>Settings</TextLink>{' '}
            before quoting.
          </>
        ) : (
          <>
            Rates and FX are maintained in <TextLink href={href('settings')}>Settings</TextLink>.
          </>
        )}
      </Callout>

      {wf ? (
        <Panel
          title={`LLM steps — ${wf.name}`}
          description={
            <>
              Tokens are per call before the complexity-mix multiplier ({n(wfVol?.consumptionMix ?? 1).toFixed(2)}×). This workflow spends <span className="num font-semibold text-ink-2">{compact(wfLlm, cur)}</span> a
              month on LLM calls, <span className="num">{unitPrice(safeDiv(wfLlm, wfVol?.accepted ?? 0), cur)}</span> per accepted {wf.abuName}.
            </>
          }
          padded={false}
          actions={
            <Button size="sm" icon={<Plus size={14} />} disabled={ro} onClick={addStep}>
              Add step
            </Button>
          }
        >
          <div className="px-4 space-y-3">
            <WorkflowPicker project={project} value={wfId} onChange={setWfId} />
            <ReadOnlyNote show={ro} what="edit LLM steps" />
          </div>
          <div className="scroll-x mt-1">
            <table className={cx('dtable min-w-[1100px]', TIGHT)}>
              <thead>
                <tr>
                  <th>Step and agent</th>
                  <th className="r">Calls / exec</th>
                  <th className="r">Input / call</th>
                  <th className="r">Output / call</th>
                  <th className="r">Reasoning / call</th>
                  <th className="r">Cache prefix</th>
                  <th className="r">Cache hit</th>
                  <th className="r">Batch</th>
                  <th>Tool</th>
                  <th className="r">Cost / month</th>
                  <th aria-label="Actions" />
                </tr>
              </thead>
              {wf.llmSteps.length === 0 && (
                <tbody>
                  <tr>
                    <td colSpan={11} className="text-ink-3 text-[13.5px]">
                      No LLM steps yet. Add a step for each model call the workflow makes.
                    </td>
                  </tr>
                </tbody>
              )}
              {wf.llmSteps.map((st, idx) => {
                const lines = wfLines.filter((l) => l.stepId === st.id);
                const cost = sum(lines.map((l) => l.cost));
                const routeTotal = st.routing.reduce((a, r) => a + r.sharePct, 0);
                const routeOk = st.routing.length > 0 && Math.abs(routeTotal - 100) <= 0.5;
                const tokenField = (key: 'inputTokens' | 'outputTokens' | 'reasoningTokens' | 'cacheablePrefixTokens', label: string) => (
                  <Num width={84} value={st[key]} min={0} step={100} disabled={ro} ariaLabel={`${st.name} ${label}`} onChange={(v) => setStep(st.id, `Changed ${label}`, (s) => (s[key] = v))} />
                );
                return (
                  <tbody key={st.id} className={cx(idx > 0 && 'border-t-2 border-line')}>
                    <tr>
                      <td className="min-w-[210px] space-y-1">
                        <TextInput value={st.name} disabled={ro} ariaLabel="Step name" onChange={(v) => setStep(st.id, 'Renamed LLM step', (s) => (s.name = v))} />
                        <Select
                          value={project.agents.some((a) => a.id === st.agentId) ? st.agentId : ''}
                          options={agentOptions}
                          disabled={ro}
                          ariaLabel={`${st.name} agent`}
                          className="!text-[13px]"
                          onChange={(v) => setStep(st.id, 'Changed step agent', (s) => (s.agentId = v))}
                        />
                      </td>
                      <td className="r">
                        <Num
                          width={70}
                          value={st.callsPerExecution}
                          min={0}
                          step={0.1}
                          disabled={ro}
                          ariaLabel={`${st.name} calls per execution`}
                          onChange={(v) => setStep(st.id, 'Changed calls per execution', (s) => (s.callsPerExecution = v))}
                        />
                      </td>
                      <td className="r">{tokenField('inputTokens', 'input tokens')}</td>
                      <td className="r">{tokenField('outputTokens', 'output tokens')}</td>
                      <td className="r">{tokenField('reasoningTokens', 'reasoning tokens')}</td>
                      <td className="r">{tokenField('cacheablePrefixTokens', 'cacheable prefix tokens')}</td>
                      <td className="r">
                        <Num
                          width={72}
                          value={st.cacheHitRatePct}
                          min={0}
                          max={100}
                          suffix="%"
                          disabled={ro}
                          ariaLabel={`${st.name} cache hit rate`}
                          onChange={(v) => setStep(st.id, 'Changed cache hit rate', (s) => (s.cacheHitRatePct = v))}
                        />
                      </td>
                      <td className="r">
                        <Num
                          width={72}
                          value={st.batchEligiblePct}
                          min={0}
                          max={100}
                          suffix="%"
                          disabled={ro}
                          ariaLabel={`${st.name} batch-eligible share`}
                          onChange={(v) => setStep(st.id, 'Changed batch-eligible share', (s) => (s.batchEligiblePct = v))}
                        />
                      </td>
                      <td className="relative">
                        <Toggle checked={st.toolCall} disabled={ro} label={<span className="sr-only">Tool call</span>} onChange={(v) => setStep(st.id, 'Changed tool-call flag', (s) => (s.toolCall = v))} />
                      </td>
                      <td className="r font-semibold">{money(cost, cur, 0)}</td>
                      <td className="r whitespace-nowrap">
                        <IconButton
                          label={`Duplicate ${st.name}`}
                          disabled={ro}
                          onClick={() =>
                            update('Duplicated LLM step', (d) => {
                              const w = d.workflows.find((x) => x.id === wfId);
                              if (!w) return;
                              const i = w.llmSteps.findIndex((x) => x.id === st.id);
                              w.llmSteps.splice(i + 1, 0, { ...structuredClone(w.llmSteps[i]), id: uid('step'), name: `${w.llmSteps[i].name} (copy)` });
                            })
                          }
                        >
                          <Copy size={15} />
                        </IconButton>
                        <IconButton
                          label={`Remove ${st.name}`}
                          tone="bad"
                          disabled={ro}
                          onClick={() =>
                            update(
                              'Removed LLM step',
                              (d) => {
                                const w = d.workflows.find((x) => x.id === wfId);
                                if (w) w.llmSteps = w.llmSteps.filter((x) => x.id !== st.id);
                              },
                              st.name,
                            )
                          }
                        >
                          <Trash2 size={15} />
                        </IconButton>
                      </td>
                    </tr>
                    <tr className="[&>td]:!bg-sunken">
                      <td colSpan={11} className="!pt-1.5 !pb-2.5">
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                          <span className="text-[12.5px] font-semibold text-ink-3">Model routing</span>
                          {st.routing.map((r, ri) => (
                            <div key={ri} className="inline-flex items-center gap-1.5 bg-paper border border-line rounded-md pl-1 pr-0.5 py-0.5">
                              <Select
                                className="!w-[250px] !border-0 !py-[3px] !text-[13px]"
                                value={catalog.modelRates.some((m) => m.id === r.modelId) ? r.modelId : ''}
                                options={catalog.modelRates.some((m) => m.id === r.modelId) ? modelOptions : [{ value: '', label: `Unknown model (${r.modelId})` }, ...modelOptions]}
                                disabled={ro}
                                ariaLabel={`${st.name} route ${ri + 1} model`}
                                onChange={(v) => v && setStep(st.id, 'Changed model routing', (s) => (s.routing[ri].modelId = v))}
                              />
                              <Num
                                width={76}
                                value={r.sharePct}
                                min={0}
                                max={100}
                                suffix="%"
                                disabled={ro}
                                ariaLabel={`${st.name} route ${ri + 1} share`}
                                onChange={(v) => setStep(st.id, 'Changed routing share', (s) => (s.routing[ri].sharePct = v))}
                              />
                              <IconButton label="Remove route" tone="bad" disabled={ro || st.routing.length <= 1} onClick={() => setStep(st.id, 'Removed model route', (s) => void s.routing.splice(ri, 1))}>
                                <X size={14} />
                              </IconButton>
                            </div>
                          ))}
                          <Button
                            size="sm"
                            variant="ghost"
                            icon={<Plus size={13} />}
                            disabled={ro}
                            onClick={() =>
                              setStep(st.id, 'Added model route', (s) => {
                                const next = catalog.modelRates.find((m) => !s.routing.some((r) => r.modelId === m.id));
                                s.routing.push({ modelId: next?.id ?? catalog.modelRates[0]?.id ?? '', sharePct: 0 });
                              })
                            }
                          >
                            Add route
                          </Button>
                          {!routeOk && <Badge tone="warn">{st.routing.length ? `Shares sum to ${pct(routeTotal, 0)}, normalised to 100%` : 'No model routing'}</Badge>}
                        </div>
                      </td>
                    </tr>
                  </tbody>
                );
              })}
            </table>
          </div>
        </Panel>
      ) : (
        <Panel title="LLM steps">
          <Callout>The project has no workflows yet. Add a workflow on the project page to model its LLM calls.</Callout>
        </Panel>
      )}

      <div className="grid gap-5 lg:grid-cols-2">
        <Panel title="Cost by model" description="Steady-state month, all workflows.">
          <BarList items={sorted(b.llm.byModel).map(([id, v]) => ({ label: modelName(result, id), value: n(v) }))} format={f} color="--s1" />
        </Panel>
        <Panel title="Cost by agent" description="Each step’s LLM cost goes to the agent that runs it.">
          <BarList items={sorted(b.llm.byAgent).map(([id, v]) => ({ label: agentName(result, id), value: n(v) }))} format={f} color="--s1" />
        </Panel>
        <Panel title="Cost by workflow">
          <BarList
            items={sorted(b.llm.byWorkflow).map(([id, v]) => ({ label: workflowName(result, id), value: n(v), sub: `${unitPrice(safeDiv(v, b.volumes[id]?.accepted ?? 0), cur)} per accepted` }))}
            format={f}
            color="--s1"
          />
        </Panel>
        <Panel title="Cost by business function">
          <BarList items={sorted(byFunction).map(([k, v]) => ({ label: k, value: n(v) }))} format={f} color="--s1" />
        </Panel>
      </div>

      <Panel
        title="Token and cost detail by model route"
        description="One line per step and model. Monthly tokens include retries, partial failures and the complexity mix. Input tokens split into uncached, cache reads and cache writes so each is billed exactly once."
        padded={false}
      >
        <div className="scroll-x">
          <table className={cx('dtable min-w-[1080px]', TIGHT)}>
            <thead>
              <tr>
                <th>Step and model</th>
                <th className="r">Calls / month</th>
                <th className="r">Uncached input</th>
                <th className="r">Cache read</th>
                <th className="r">Cache write</th>
                <th className="r">Output</th>
                <th className="r">Reasoning</th>
                <th className="r">Cost / call</th>
                <th className="r">Cost / month</th>
                <th className="r">Context</th>
              </tr>
            </thead>
            <tbody>
              {b.llmLines.map((l, i) => {
                const util = n(l.contextUtilizationPct);
                const model = catalog.modelRates.find((m) => m.id === l.modelId);
                return (
                  <tr key={i}>
                    <td>
                      <div className="font-semibold">{l.stepName}</div>
                      <div className="text-[12.5px] text-ink-3 whitespace-nowrap">
                        {project.workflows.length > 1 && `${workflowName(result, l.workflowId)}, `}
                        {modelName(result, l.modelId)}
                        {model?.sample && <span> (sample rate)</span>}
                      </div>
                    </td>
                    <td className="r">{tokens(l.calls)}</td>
                    <td className="r">{tokens(l.uncachedInputTokens)}</td>
                    <td className="r">{tokens(l.cacheReadTokens)}</td>
                    <td className="r">{tokens(l.cacheWriteTokens)}</td>
                    <td className="r">{tokens(l.outputTokens)}</td>
                    <td className="r">{tokens(l.reasoningTokens)}</td>
                    <td className="r">{unitPrice(l.costPerCall, cur)}</td>
                    <td className="r font-semibold">{money(l.cost, cur, 0)}</td>
                    <td className={cx('r', util > 90 ? 'text-bad font-semibold' : util > 70 ? 'text-warn font-semibold' : 'text-ink-2')}>{pct(util, util < 1 ? 2 : 0)}</td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr>
                <td>Total</td>
                <td className="r">{tokens(b.llm.tokens.calls)}</td>
                <td className="r">{tokens(b.llm.tokens.input.minus(b.llm.tokens.cacheRead).minus(b.llm.tokens.cacheWrite))}</td>
                <td className="r">{tokens(b.llm.tokens.cacheRead)}</td>
                <td className="r">{tokens(b.llm.tokens.cacheWrite)}</td>
                <td className="r">{tokens(b.llm.tokens.output)}</td>
                <td className="r">{tokens(b.llm.tokens.reasoning)}</td>
                <td className="r">{unitPrice(safeDiv(b.llm.total, b.llm.tokens.calls), cur)}</td>
                <td className="r">{money(b.llm.total, cur, 0)}</td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
        <p className="px-4 pt-2 pb-3 text-[12.5px] text-ink-3">Context used is one call’s input, output and reasoning tokens as a share of the model’s context window. Above 70% is flagged; above 90% risks truncation.</p>
      </Panel>

      <div className="grid gap-5 xl:grid-cols-[1.3fr_1fr]">
        <Panel title="Model rates in use" description="Per 1M tokens in the rate card’s own currency. Converted to the project currency at the FX rate above." padded={false}>
          <div className="scroll-x">
            <table className="dtable min-w-[620px]">
              <thead>
                <tr>
                  <th>Model</th>
                  <th className="r">Input</th>
                  <th className="r">Output</th>
                  <th className="r">Cache read / write</th>
                  <th className="r">Batch discount</th>
                  <th className="r">Context</th>
                </tr>
              </thead>
              <tbody>
                {modelsInUse.map((m) => (
                  <tr key={m.id}>
                    <td>
                      <div className="font-semibold">{m.model}</div>
                      <div className="text-[12.5px] text-ink-3">
                        {m.hostingPlatform}
                        {m.sample && (
                          <>
                            {' '}
                            <Badge tone="warn">sample rate</Badge>
                          </>
                        )}
                      </div>
                    </td>
                    {m.pricingBasis === 'self_hosted' ? (
                      <td className="r text-ink-2 text-[13px]" colSpan={3}>
                        Derived from GPU-hour cost and throughput
                      </td>
                    ) : (
                      <>
                        <td className="r">{money(m.inputPerM, m.currency, 2)}</td>
                        <td className="r">{money(m.outputPerM, m.currency, 2)}</td>
                        <td className="r">
                          {m.cacheSemantics === 'none' ? 'No caching' : `${money(m.cacheReadPerM, m.currency, 2)} / ${m.cacheSemantics === 'read_write' ? money(m.cacheWritePerM, m.currency, 2) : 'none'}`}
                        </td>
                      </>
                    )}
                    <td className="r">{m.batchDiscountPct ? pct(m.batchDiscountPct, 0) : '—'}</td>
                    <td className="r">{tokens(m.contextWindow)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
        <Panel title="Routing, context and rate checks">
          <IssueList issues={issues} empty="Routing sums to 100% everywhere and no call is near its context limit." />
        </Panel>
      </div>
    </div>
  );
}

function sorted(m: Record<string, Decimal>): [string, Decimal][] {
  return Object.entries(m)
    .filter(([, v]) => !v.isZero())
    .sort((a, b) => b[1].cmp(a[1]));
}
