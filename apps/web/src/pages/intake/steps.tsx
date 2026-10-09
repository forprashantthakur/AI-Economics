import { useMemo, useState } from 'react';
import { Check, Plus } from 'lucide-react';
import { PROVIDER_TIER_MAP, safeDiv, type Catalog, type ProcessTemplate, type Project, type ProjectResult } from '@aies/engine';
import { Badge, Button, Callout, Field, IssueList, KeyValues, Select, StatStrip, TextArea, TextInput, Toggle, cx } from '../../components/ui';
import { compact, count, num, pct, periodLabel, unitPrice } from '../../lib/format';
import { AVAILABILITY_SLAS, CLOUD_PLATFORMS, DEFAULT_FUNCTIONS, DEFAULT_INDUSTRIES, ENGAGEMENT_TYPES, FieldError, GEOGRAPHIES, MonthInput, NumberInput, SOLUTION_LABEL, SOLUTION_TYPES, SUPPORT_SLAS, SuggestInput, TEMPLATE_GROUPS, TagInput, templateGroup, withCurrent } from '../projects/common';
import { STEPS, callProfile, type Errors, type WizardForm } from './form';

export interface StepProps {
  form: WizardForm;
  set: <K extends keyof WizardForm>(k: K, v: WizardForm[K]) => void;
  errors: Errors;
}

// ───────────────────────────── Step indicator ─────────────────────────────

export function StepIndicator({ step, onJump }: { step: number; onJump: (i: number) => void }) {
  return (
    <nav aria-label="Intake steps" className="mb-5">
      <p className="text-[13px] text-ink-3 mb-2 sm:hidden">
        Step {step + 1} of {STEPS.length}: <span className="font-semibold text-ink">{STEPS[step].label}</span>
      </p>
      <ol className="flex items-center gap-1.5 sm:gap-2">
        {STEPS.map((s, i) => {
          const done = i < step;
          const active = i === step;
          return (
            <li key={s.id} className={cx('flex items-center gap-1.5 sm:gap-2 min-w-0', i < STEPS.length - 1 && 'flex-1')}>
              <button
                type="button"
                onClick={() => onJump(i)}
                aria-current={active ? 'step' : undefined}
                className={cx('flex items-center gap-2 rounded-md py-1 pr-1.5 text-left min-w-0', !active && 'hover:text-ink')}
              >
                <span
                  className={cx(
                    'w-7 h-7 shrink-0 rounded-full grid place-items-center text-[13px] font-semibold num border',
                    active ? 'bg-brand text-brand-ink border-brand' : done ? 'bg-brand-tint text-brand border-transparent' : 'bg-paper text-ink-3 border-line',
                  )}
                >
                  {done ? <Check size={14} strokeWidth={2.6} aria-label="Done" /> : i + 1}
                </span>
                <span className={cx('hidden sm:inline text-[13.5px] font-semibold whitespace-nowrap truncate', active ? 'text-ink' : done ? 'text-ink-2' : 'text-ink-3')}>{s.label}</span>
              </button>
              {i < STEPS.length - 1 && <span aria-hidden className={cx('h-px flex-1 min-w-3', done ? 'bg-brand' : 'bg-line')} />}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

// ───────────────────────────── 1 — Client ─────────────────────────────

export function ClientStep({ form, set, errors, currencies, customIndustries, customFunctions, onAddIndustry }: StepProps & { currencies: string[]; customIndustries: string[]; customFunctions: string[]; onAddIndustry: (name: string) => void }) {
  const [adding, setAdding] = useState(false);
  const [newIndustry, setNewIndustry] = useState('');
  const [addError, setAddError] = useState('');
  const industries = [...new Set([...DEFAULT_INDUSTRIES, ...customIndustries])];
  const functions = [...new Set([...DEFAULT_FUNCTIONS, ...customFunctions])];
  const add = () => {
    const v = newIndustry.trim();
    if (!v) return setAddError('Type the industry name first.');
    if (industries.some((i) => i.toLowerCase() === v.toLowerCase())) return setAddError(`"${v}" is already in the list.`);
    onAddIndustry(v);
    set('industry', v);
    setNewIndustry('');
    setAddError('');
    setAdding(false);
  };
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Field label="Client or account name" htmlFor="w-client">
        <TextInput id="w-client" value={form.clientName} onChange={(v) => set('clientName', v)} placeholder="e.g. Aravalli Manufacturing Ltd" />
        <FieldError>{errors.clientName}</FieldError>
      </Field>
      <Field label="Industry" htmlFor="w-industry">
        <Select
          id="w-industry"
          value={form.industry}
          onChange={(v) => (v === '__add__' ? setAdding(true) : set('industry', v))}
          options={[{ value: '', label: 'Choose an industry' }, ...withCurrent(industries, form.industry), { value: '__add__', label: 'Add industry' }]}
        />
        {adding && (
          <div className="mt-2 flex gap-2">
            <input className="field" aria-label="New industry name" autoFocus value={newIndustry} placeholder="New industry" onChange={(e) => setNewIndustry(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && add()} />
            <Button size="sm" icon={<Plus size={14} />} onClick={add}>
              Add
            </Button>
            <Button size="sm" variant="ghost" onClick={() => (setAdding(false), setAddError(''))}>
              Cancel
            </Button>
          </div>
        )}
        <FieldError>{addError || errors.industry}</FieldError>
      </Field>
      <Field label="Geography" htmlFor="w-geo" hint="Where the users and data are; drives residency and hosting assumptions.">
        <SuggestInput id="w-geo" value={form.geography} onChange={(v) => set('geography', v)} suggestions={GEOGRAPHIES} />
      </Field>
      <Field label="Reporting currency" htmlFor="w-cur" hint="All costs, prices and benefits are converted to this currency with the FX table.">
        <Select id="w-cur" value={form.currency} onChange={(v) => set('currency', v)} options={currencies.map((c) => ({ value: c, label: c }))} />
        <FieldError>{errors.currency}</FieldError>
      </Field>
      <Field label="Business function" htmlFor="w-fn" hint="Narrows the template list in the next step. Leave it to the template if unsure.">
        <Select id="w-fn" value={form.businessFunction} onChange={(v) => set('businessFunction', v)} options={[{ value: '', label: 'Take from the template' }, ...withCurrent(functions, form.businessFunction)]} />
      </Field>
      <Field label="Engagement type" htmlFor="w-eng">
        <Select id="w-eng" value={form.engagementType} onChange={(v) => set('engagementType', v)} options={withCurrent(ENGAGEMENT_TYPES, form.engagementType)} />
        <FieldError>{errors.engagementType}</FieldError>
      </Field>
      <Field label="Project name" htmlFor="w-name" hint="Optional. Defaults to the template name and client." className="sm:col-span-2">
        <TextInput id="w-name" value={form.projectName} onChange={(v) => set('projectName', v)} placeholder="e.g. Accounts Payable Agent" />
        <FieldError>{errors.projectName}</FieldError>
      </Field>
    </div>
  );
}

// ───────────────────────────── 2 — Template ─────────────────────────────

export function TemplateStep({ form, set, errors, templates, onPick }: StepProps & { templates: ProcessTemplate[]; onPick: (t: ProcessTemplate) => void }) {
  const preferred = form.businessFunction ? templateGroup(form.businessFunction) : '';
  const groups = useMemo(() => {
    const order = [...TEMPLATE_GROUPS, 'Additional'];
    const sorted = preferred ? [preferred, ...order.filter((g) => g !== preferred)] : order;
    return sorted.map((g) => ({ group: g, items: templates.filter((t) => templateGroup(t.businessFunction) === g) })).filter((g) => g.items.length);
  }, [templates, preferred]);
  void set;
  return (
    <div className="space-y-6" role="radiogroup" aria-label="Process template">
      <FieldError>{errors.templateId}</FieldError>
      {groups.map(({ group, items }) => (
        <section key={group}>
          <h3 className="text-[14px] font-semibold text-ink mb-2">
            {group}
            {group === preferred && <span className="ml-2 text-[12.5px] font-normal text-ink-3">Matches the business function you chose</span>}
          </h3>
          <div className="grid gap-3 md:grid-cols-2">
            {items.map((t) => {
              const sel = form.templateId === t.id;
              return (
                <label
                  key={t.id}
                  className={cx(
                    'relative flex gap-3 rounded-lg border p-3 cursor-pointer transition-colors min-w-0',
                    sel ? 'border-brand bg-brand-tint' : 'border-line bg-paper hover:border-ink-3',
                  )}
                >
                  <input type="radio" name="template" className="mt-1 h-4 w-4 accent-[var(--brand)] shrink-0" checked={sel} onChange={() => onPick(t)} />
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <span className="font-semibold text-ink">{t.name}</span>
                      {!t.builtIn && <Badge tone="brand">Custom</Badge>}
                      {t.businessFunction !== group && group === 'Additional' && <span className="text-[12px] text-ink-3">{t.businessFunction}</span>}
                    </div>
                    <p className="text-[13px] text-ink-2 mt-1 leading-snug">
                      <span className="font-semibold text-ink">1 ABU = 1 {t.abuName}.</span> {t.abuDefinition}
                    </p>
                    <p className="text-[12.5px] text-ink-3 mt-1">
                      Default volume {count(t.monthlyVolume, 'INR')} per month, {t.agents.length} agents, {t.archetype} pattern
                      {t.documentProcessing ? ', document processing' : ''}
                      {t.ragRequired ? ', RAG' : ''}
                    </p>
                  </div>
                </label>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}

// ───────────────────────────── 3 — AI solution ─────────────────────────────

export function SolutionStep({ form, set, errors, catalog }: StepProps & { catalog: Catalog }) {
  const map = PROVIDER_TIER_MAP[form.provider];
  const model = (id?: string) => catalog.modelRates.find((m) => m.id === id);
  const tiers = map ? (['frontier', 'balanced', 'fast'] as const).map((t) => ({ tier: t, m: model(map[t]), id: map[t] })) : [];
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Field label="Solution type" htmlFor="w-type">
        <Select id="w-type" value={form.solutionType} onChange={(v) => set('solutionType', v)} options={SOLUTION_TYPES} />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Number of agents" htmlFor="w-agents" hint="Sizes the build effort.">
          <NumberInput id="w-agents" value={form.plannedAgents} min={1} max={50} onChange={(v) => set('plannedAgents', Math.round(v))} />
          <FieldError>{errors.plannedAgents}</FieldError>
        </Field>
        <Field label="Number of workflows" htmlFor="w-wfs" hint="One is built now; add more later.">
          <NumberInput id="w-wfs" value={form.plannedWorkflows} min={1} max={50} onChange={(v) => set('plannedWorkflows', Math.round(v))} />
          <FieldError>{errors.plannedWorkflows}</FieldError>
        </Field>
      </div>
      <Field label="Enterprise integrations" htmlFor="w-int" hint="Each integration adds integration engineering effort." className="sm:col-span-2">
        <TagInput id="w-int" value={form.integrations} onChange={(v) => set('integrations', v)} placeholder="e.g. SAP S/4HANA, then Enter" />
        <FieldError>{errors.integrations}</FieldError>
      </Field>
      <Field label="LLM provider" htmlFor="w-prov">
        <Select id="w-prov" value={form.provider} onChange={(v) => set('provider', v)} options={Object.entries(PROVIDER_TIER_MAP).map(([k, v]) => ({ value: k, label: v.label }))} />
        <FieldError>{errors.provider}</FieldError>
        {tiers.length > 0 && (
          <ul className="mt-2 text-[12.5px] text-ink-3 space-y-0.5">
            {tiers.map(({ tier, m, id }) => (
              <li key={tier}>
                <span className="text-ink-2 capitalize">{tier}</span> steps use {m ? m.model : <span className="text-bad">{id} (missing from rate card)</span>}
                {m?.sample && ' (sample rate)'}
              </li>
            ))}
          </ul>
        )}
      </Field>
      <Field label="Cloud platform" htmlFor="w-cloud">
        <SuggestInput id="w-cloud" value={form.cloudPlatform} onChange={(v) => set('cloudPlatform', v)} suggestions={CLOUD_PLATFORMS} />
        <FieldError>{errors.cloudPlatform}</FieldError>
      </Field>
      <div className="sm:col-span-2 flex flex-wrap gap-x-6 gap-y-3 py-1">
        <Toggle checked={form.ragRequired} onChange={(v) => set('ragRequired', v)} label="RAG over a knowledge base" />
        <Toggle checked={form.documentProcessing} onChange={(v) => set('documentProcessing', v)} label="Document processing (OCR / extraction)" />
        <Toggle checked={form.humanInTheLoop} onChange={(v) => set('humanInTheLoop', v)} label="Human in the loop" />
      </div>
      <Field label="Data sources" htmlFor="w-data" className="sm:col-span-2">
        <TagInput id="w-data" value={form.dataSources} onChange={(v) => set('dataSources', v)} placeholder="e.g. Vendor master, then Enter" />
      </Field>
      <Field label="Security and governance requirements" className="sm:col-span-2">
        <TextArea ariaLabel="Security and governance requirements" rows={2} value={form.securityRequirements} onChange={(v) => set('securityRequirements', v)} />
      </Field>
      <Field label="Availability SLA" htmlFor="w-avail">
        <SuggestInput id="w-avail" value={form.availabilitySla} onChange={(v) => set('availabilitySla', v)} suggestions={AVAILABILITY_SLAS} />
      </Field>
      <Field label="Support SLA" htmlFor="w-support">
        <SuggestInput id="w-support" value={form.supportSla} onChange={(v) => set('supportSla', v)} suggestions={SUPPORT_SLAS} />
      </Field>
    </div>
  );
}

// ───────────────────────────── 4 — Workload ─────────────────────────────

export function WorkloadStep({ form, set, errors, template, preview }: StepProps & { template?: ProcessTemplate; preview?: Project }) {
  const wf = preview?.workflows[0];
  const prof = wf ? callProfile(wf.llmSteps) : { calls: 0, avgInput: 0, avgOutput: 0 };
  const estPeak = preview?.solution.peakConcurrency;
  const auto = form.peakConcurrency === null;
  const unit = template?.abuName ?? 'transaction';
  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Field label="Monthly transaction volume" htmlFor="w-vol" hint={`Unique ${unit}s attempted per month at steady state. Retries are not new transactions.`}>
          <NumberInput id="w-vol" value={form.monthlyVolume} min={0} step={1000} onChange={(v) => set('monthlyVolume', Math.round(v))} />
          <FieldError>{errors.monthlyVolume}</FieldError>
        </Field>
        <Field label="Working days per month" htmlFor="w-days">
          <NumberInput id="w-days" value={form.workingDays} min={1} max={31} onChange={(v) => set('workingDays', Math.round(v))} />
          <FieldError>{errors.workingDays}</FieldError>
        </Field>
        <Field label="Daily transactions" hint="Derived: monthly volume ÷ working days.">
          <div className="field num text-right bg-sunken text-ink-2" aria-live="polite">
            {form.workingDays > 0 ? count(form.monthlyVolume / form.workingDays, 'INR') : '—'}
          </div>
        </Field>
        <Field label="Peak concurrency" htmlFor="w-peak" hint={auto ? `Estimated from volume: ${estPeak ?? '—'} concurrent executions.` : 'Concurrent executions at peak; sizes hosting nodes.'}>
          <div className="flex items-center gap-3">
            <NumberInput id="w-peak" className="flex-1" value={form.peakConcurrency ?? estPeak ?? 5} min={1} disabled={auto} onChange={(v) => set('peakConcurrency', Math.round(v))} />
            <Toggle checked={auto} onChange={(v) => set('peakConcurrency', v ? null : estPeak ?? 5)} label="Estimate" />
          </div>
          <FieldError>{errors.peakConcurrency}</FieldError>
        </Field>
        <Field label="Go-live month" htmlFor="w-golive" hint="Run month 1. Implementation is billed the month before.">
          <MonthInput id="w-golive" value={form.goLiveDate} onChange={(v) => set('goLiveDate', v)} />
          <FieldError>{errors.goLiveDate}</FieldError>
        </Field>
        <Field label="Annual volume growth" htmlFor="w-growth">
          <NumberInput id="w-growth" value={form.annualGrowthPct} suffix="%" min={-50} max={300} onChange={(v) => set('annualGrowthPct', v)} />
          <FieldError>{errors.annualGrowthPct}</FieldError>
        </Field>
      </div>

      <div>
        <h3 className="text-[14px] font-semibold text-ink mb-1">Execution profile</h3>
        <p className="text-[13px] text-ink-3 mb-3">Defaults come from the {template?.name ?? 'selected'} template. Change them only if discovery says otherwise; every value stays editable on the project.</p>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="Average workflow steps" htmlFor="w-steps" hint={template ? `Template: ${template.workflowSteps}. Drives orchestration state transitions.` : undefined}>
            <NumberInput id="w-steps" value={form.workflowSteps} min={1} max={500} onChange={(v) => set('workflowSteps', Math.round(v))} />
            <FieldError>{errors.workflowSteps}</FieldError>
          </Field>
          <Field label="Model calls per transaction" htmlFor="w-calls" hint={`Across the template's ${wf?.llmSteps.length ?? 0} LLM steps; each step keeps its share. Fine-tune steps in Project Costing.`}>
            <NumberInput id="w-calls" value={Math.round((form.modelCallsPerTxn ?? prof.calls) * 100) / 100} min={0.1} max={500} step={0.5} onChange={(v) => set('modelCallsPerTxn', v)} />
          </Field>
          <Field label="Input tokens per model call" htmlFor="w-in" hint="Average across calls, including retrieved context. Cacheable prefixes scale with it.">
            <NumberInput id="w-in" value={Math.round(form.avgInputTokens ?? prof.avgInput)} min={1} max={2000000} step={100} onChange={(v) => set('avgInputTokens', Math.round(v))} />
          </Field>
          <Field label="Output tokens per model call" htmlFor="w-out" hint="Average across calls. Reasoning tokens scale with it.">
            <NumberInput id="w-out" value={Math.round(form.avgOutputTokens ?? prof.avgOutput)} min={1} max={200000} step={50} onChange={(v) => set('avgOutputTokens', Math.round(v))} />
          </Field>
          <Field label="Tool calls per transaction" htmlFor="w-tools" hint={template ? `Template: ${template.toolCallsPerExecution}.` : undefined}>
            <NumberInput id="w-tools" value={form.toolCallsPerExecution} min={0} max={500} onChange={(v) => set('toolCallsPerExecution', v)} />
            <FieldError>{errors.toolCallsPerExecution}</FieldError>
          </Field>
          <Field label="Token multiplier" htmlFor="w-tok" hint="Scales the template's tokens per call (1.3 = longer documents). Set the averages above instead for exact figures.">
            <NumberInput id="w-tok" value={form.tokenMultiplier} min={0.05} max={20} step={0.1} suffix="×" onChange={(v) => set('tokenMultiplier', v)} />
            <FieldError>{errors.tokenMultiplier}</FieldError>
          </Field>
          <Field label="Expected retry rate" htmlFor="w-retry" hint="Extra executions per attempted transaction. Retries cost but never earn ABUs.">
            <NumberInput id="w-retry" value={form.retryRatePct} min={0} max={100} suffix="%" onChange={(v) => set('retryRatePct', v)} />
            <FieldError>{errors.retryRatePct}</FieldError>
          </Field>
          <Field label="Task success rate" htmlFor="w-success" hint="Share of attempted transactions the agents complete.">
            <NumberInput id="w-success" value={form.successRatePct} min={0} max={100} suffix="%" onChange={(v) => set('successRatePct', v)} />
            <FieldError>{errors.successRatePct}</FieldError>
          </Field>
          <Field label="Human intervention rate" htmlFor="w-hitl" hint={form.humanInTheLoop ? 'Share of accepted transactions a person reviews or completes.' : 'Human in the loop is off, so this is 0%.'}>
            <NumberInput id="w-hitl" value={form.humanInTheLoop ? form.humanInterventionRatePct : 0} min={0} max={100} suffix="%" disabled={!form.humanInTheLoop} onChange={(v) => set('humanInterventionRatePct', v)} />
            <FieldError>{errors.humanInterventionRatePct}</FieldError>
          </Field>
        </div>
      </div>
    </div>
  );
}

// ───────────────────────────── 5 — Review ─────────────────────────────

export function ReviewStep({ form, template, result, provider, onEdit }: { form: WizardForm; template?: ProcessTemplate; result?: ProjectResult; provider: string; onEdit: (step: number) => void }) {
  if (!result || !template) return <Callout tone="bad">The estimate could not be built. Go back and check the template and workload.</Callout>;
  const p = result.project;
  const cur = p.currency;
  const wf = p.workflows[0];
  const abu = result.priceBook.streams.find((s) => s.type === 'abu');
  const abuPrice = abu?.abu?.byWorkflow[wf.id]?.price ?? abu?.unitPrice;
  const impl = result.implementation;
  const b = result.baseline;
  const errors = result.issues.filter((i) => i.severity === 'error');
  const section = (title: string, step: number, rows: [string, string][]) => (
    <div className="min-w-0">
      <div className="flex items-center justify-between mb-1">
        <h3 className="text-[14px] font-semibold text-ink">{title}</h3>
        <button type="button" className="!text-[13px] !font-semibold !text-brand hover:underline underline-offset-2" onClick={() => onEdit(step)}>
          Edit
        </button>
      </div>
      <KeyValues rows={rows} />
    </div>
  );
  return (
    <div className="space-y-5">
      <StatStrip
        items={[
          { label: 'Implementation price', value: compact(impl.price, cur), sub: `${impl.durationWeeks} weeks, ${num(impl.laborHours)} hours` },
          { label: 'Monthly run cost', value: compact(b.totalRunCost, cur), sub: `Steady state, ${count(b.totals.attempted, cur)} ${template.abuName}s attempted` },
          { label: 'Cost per weighted ABU', value: unitPrice(result.economics.provider.costToServePerAbu, cur), sub: `${count(b.totals.weightedAbus, cur)} weighted ABUs / month` },
          { label: 'Derived ABU price', value: abuPrice ? unitPrice(abuPrice, cur) : '—', sub: abu ? `Per ${template.abuName} at ${pct(abu.targetMarginPct, 0)} target margin` : 'No ABU stream' },
          { label: 'LLM share of run cost', value: pct(safeDiv(b.llm.total, b.totalRunCost).times(100), 0), sub: `${compact(b.llm.total, cur)} LLM per month` },
        ]}
      />
      {errors.length > 0 && (
        <Callout tone="bad" title="Fix these before relying on the estimate">
          {errors.length} blocking {errors.length === 1 ? 'issue' : 'issues'} below. The project can still be created and corrected afterwards.
        </Callout>
      )}
      <div className="grid gap-5 lg:grid-cols-2">
        <div className="space-y-5">
          {section('Client', 0, [
            ['Client', p.client.clientName],
            ['Industry', p.client.industry],
            ['Geography', p.client.geography || '—'],
            ['Currency', cur],
            ['Engagement', p.client.engagementType],
            ['Project name', p.name],
          ])}
          {section('Process template', 1, [
            ['Template', template.name],
            ['Business function', p.client.businessFunction],
            ['ABU', `1 ${template.abuName}`],
            ['Agents generated', String(p.agents.length)],
          ])}
        </div>
        <div className="space-y-5">
          {section('AI solution', 2, [
            ['Solution type', SOLUTION_LABEL[form.solutionType]],
            ['LLM provider', provider],
            ['Cloud platform', form.cloudPlatform],
            ['Integrations', form.integrations.length ? String(form.integrations.length) : 'None'],
            ['RAG / documents / human in loop', [form.ragRequired ? 'RAG' : '', form.documentProcessing ? 'Documents' : '', form.humanInTheLoop ? 'Human review' : ''].filter(Boolean).join(', ') || 'None'],
          ])}
          {section('Workload', 3, [
            ['Monthly volume', count(form.monthlyVolume, cur)],
            ['Go-live', periodLabel(form.goLiveDate)],
            ['Success / retry / intervention', `${pct(wf.successRatePct, 0)} / ${pct(wf.retryRatePct, 0)} / ${pct(wf.humanInterventionRatePct, 0)}`],
            ['Steps / tool calls', `${wf.workflowSteps} / ${wf.toolCallsPerExecution}`],
            ['Peak concurrency', String(p.solution.peakConcurrency)],
          ])}
        </div>
      </div>
      <div>
        <h3 className="text-[14px] font-semibold text-ink mb-2">Validation</h3>
        <IssueList issues={result.issues} empty="No issues found in the generated project." />
      </div>
      <p className="text-[12.5px] text-ink-3">
        Every generated number (effort, token profile, cost lines, benefits) is a template assumption computed with sample rates. Review it in Project Costing, Commercial Pricing and Value Realization before quoting.
      </p>
    </div>
  );
}
