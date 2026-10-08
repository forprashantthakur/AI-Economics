import { useState } from 'react';
import { Boxes, Calculator, FileText, FlaskConical, Gauge, Receipt, RefreshCw, TrendingUp } from 'lucide-react';
import { addMonths, buildImplementationPlan, safeDiv, type ClientInfo, type Project, type ProjectResult, type SolutionInfo } from '@aies/engine';
import { Badge, Button, Callout, Field, IssueList, KeyValues, Modal, Panel, ReadOnlyNote, Segmented, Select, StatStrip, TextArea, TextInput, Toggle } from '../../components/ui';
import { compact, count, months, pct, periodLabel, unitPrice } from '../../lib/format';
import { href, type Route } from '../../lib/router';
import { useCan, useProjectUpdater, useStore } from '../../state/store';
import { AVAILABILITY_SLAS, CLOUD_PLATFORMS, DEFAULT_FUNCTIONS, DEFAULT_INDUSTRIES, ENGAGEMENT_TYPES, GEOGRAPHIES, MonthInput, NumberInput, SOLUTION_TYPES, SUPPORT_SLAS, SuggestInput, TagInput, monthIndexFor, withCurrent } from './common';

const LINKS: { route: Route; params?: string[]; label: string; body: string; icon: typeof Calculator }[] = [
  { route: 'costing', label: 'Project Costing', body: 'Implementation plan, LLM tokenomics and execution cost lines', icon: Calculator },
  { route: 'acu', label: 'ACU Calculator', body: 'Consumption units by method, workflow and agent', icon: Gauge },
  { route: 'abu', label: 'ABU Calculator', body: 'Business units, funnel, complexity mix and cost per ABU', icon: Boxes },
  { route: 'commercial', label: 'Commercial Pricing', body: 'Revenue streams, rate cards and contract economics', icon: Receipt },
  { route: 'value', label: 'Value Realization', body: 'Benefits, productivity, client ROI and payback', icon: TrendingUp },
  { route: 'scenarios', label: 'Scenario Simulator', body: 'What-if, sensitivity and break-even', icon: FlaskConical },
  { route: 'reports', label: 'Reports', body: 'Client proposal, business case and exports', icon: FileText },
];

export function OverviewTab({ project: p, result: r }: { project: Project; result: ProjectResult }) {
  const { state } = useStore();
  const update = useProjectUpdater(p.id);
  const canEdit = useCan('project.edit');
  const canImpl = useCan('implementation.edit');
  const [rebuild, setRebuild] = useState(false);
  const cur = p.currency;
  const e = r.economics;
  const currencies = [...new Set([state.catalog.fx.base, ...Object.keys(state.catalog.fx.rates)])];
  const industries = [...new Set([...DEFAULT_INDUSTRIES, ...state.customIndustries])];
  const functions = [...new Set([...DEFAULT_FUNCTIONS, ...state.customFunctions])];

  const setClient = <K extends keyof ClientInfo>(k: K, v: ClientInfo[K], label: string) => update(`Changed ${label}`, (d) => void (d.client[k] = v), `${p.name}: ${String(v)}`);
  const setSolution = <K extends keyof SolutionInfo>(k: K, v: SolutionInfo[K], label: string) =>
    update(`Changed ${label}`, (d) => void (d.solution[k] = v), `${p.name}: ${Array.isArray(v) ? v.join(', ') : String(v)}`);

  const term = p.pricing.termMonths;
  const streams = p.pricing.streams.filter((s) => s.enabled);
  const errors = r.issues.filter((i) => i.severity !== 'info');

  return (
    <div className="space-y-5">
      <StatStrip
        items={[
          { label: 'Implementation price', value: compact(r.implementation.price, cur), sub: `${r.implementation.durationWeeks} weeks, cost ${compact(r.implementation.totalCost, cur)}` },
          { label: 'Run cost per month', value: compact(r.baseline.totalRunCost, cur), sub: `Steady state, LLM ${pct(safeDiv(r.baseline.llm.total, r.baseline.totalRunCost).times(100), 0)}` },
          { label: 'Cost per weighted ABU', value: unitPrice(e.provider.costToServePerAbu, cur), sub: `${count(r.baseline.totals.weightedAbus, cur)} ABUs / month` },
          { label: 'Contract value', value: compact(e.provider.tcv, cur), sub: `${term}-month term, ${pct(e.provider.marginPct)} margin` },
          { label: 'Client ROI', value: pct(e.client.roiPct, 0), tone: e.client.roiPct.lt(0) ? 'bad' : 'neutral', sub: `Payback ${months(e.client.paybackMonths).toLowerCase()}` },
        ]}
      />

      <div className="grid gap-5 xl:grid-cols-[1.2fr_1fr]">
        <Panel title="Project" description="Lifecycle status drives which dashboards show estimates and which show monitored actuals.">
          <ReadOnlyNote show={!canEdit} what="edit project details" />
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Project name" htmlFor="o-name" className="sm:col-span-2">
              <TextInput id="o-name" value={p.name} disabled={!canEdit} onChange={(v) => v.trim() && update('Renamed project', (d) => void (d.name = v.trim()), `${p.name} to ${v.trim()}`)} />
            </Field>
            <Field label="Status" className="sm:col-span-2">
              <div className="max-w-full overflow-x-auto">
                <Segmented<Project['status']>
                  ariaLabel="Project status"
                  value={p.status}
                  onChange={(v) => canEdit && update('Changed project status', (d) => void (d.status = v), `${p.name}: ${v.replace('_', ' ')}`)}
                  options={[
                    { id: 'pre_sales', label: 'Pre-sales' },
                    { id: 'in_delivery', label: 'In delivery' },
                    { id: 'live', label: 'Live' },
                  ]}
                />
              </div>
              {p.status === 'live' && p.actuals.length === 0 && <p className="text-[12.5px] text-warn mt-1.5">Live without actuals. Record monthly actuals in the Actuals tab to track variance.</p>}
            </Field>
            <Field label="Go-live month" htmlFor="o-golive" hint="Run month 1. Actuals are re-indexed to the new go-live month.">
              <MonthInput
                id="o-golive"
                value={p.goLiveDate}
                disabled={!canEdit}
                onChange={(v) =>
                  update(
                    'Changed go-live month',
                    (d) => {
                      d.goLiveDate = v;
                      for (const a of d.actuals) a.monthIndex = monthIndexFor(v, a.period);
                    },
                    `${p.name}: ${v}`,
                  )
                }
              />
            </Field>
            <Field label="Owner" htmlFor="o-owner">
              <TextInput id="o-owner" value={p.owner} disabled={!canEdit} onChange={(v) => update('Changed owner', (d) => void (d.owner = v), `${p.name}: ${v}`)} />
            </Field>
            <Field label="Reporting currency" htmlFor="o-cur" hint="Every input keeps its own currency; outputs convert with the FX table.">
              <Select id="o-cur" value={p.currency} disabled={!canEdit} options={withCurrent(currencies, p.currency)} onChange={(v) => update('Changed reporting currency', (d) => void (d.currency = v), `${p.name}: ${v}`)} />
            </Field>
            <Field label="Data">
              <div className="pt-1">{p.illustrative ? <Badge tone="warn">Illustrative sample</Badge> : <Badge>Client estimate</Badge>}</div>
            </Field>
          </div>
        </Panel>

        <Panel title="Contract term" description="Set in Commercial Pricing; summarised here.">
          <KeyValues
            rows={[
              ['Term', `${term} months`],
              ['Run period', `${periodLabel(p.goLiveDate)} to ${periodLabel(addMonths(p.goLiveDate, term - 1))}`],
              ['Implementation billed', periodLabel(addMonths(p.goLiveDate, -1))],
              ['Ramp-up', p.pricing.rampMonths ? `${p.pricing.rampMonths} months from ${pct(p.pricing.rampStartPct, 0)} of volume` : 'None'],
              ['Price escalation', `${pct(p.pricing.priceEscalationPct)} a year`],
              ['Revenue streams', streams.length ? streams.map((s) => s.label).join(', ') : 'None enabled'],
              ['Annual contract value', compact(e.provider.acv, cur)],
            ]}
          />
          <a href={href('commercial')} className="inline-block mt-3 text-[13.5px] font-semibold text-brand hover:underline underline-offset-2">
            Edit commercial model
          </a>
        </Panel>
      </div>

      <div className="grid gap-5 xl:grid-cols-2">
        <Panel title="Client" description="Who the engagement is for and the process in scope.">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Client or account name" htmlFor="c-name" className="sm:col-span-2">
              <TextInput id="c-name" value={p.client.clientName} disabled={!canEdit} onChange={(v) => v.trim() && setClient('clientName', v.trim(), 'client name')} />
            </Field>
            <Field label="Industry" htmlFor="c-ind">
              <Select id="c-ind" value={p.client.industry} disabled={!canEdit} options={withCurrent(industries, p.client.industry)} onChange={(v) => setClient('industry', v, 'industry')} />
            </Field>
            <Field label="Geography" htmlFor="c-geo">
              <SuggestInput id="c-geo" value={p.client.geography} disabled={!canEdit} suggestions={GEOGRAPHIES} onChange={(v) => setClient('geography', v, 'geography')} />
            </Field>
            <Field label="Business function" htmlFor="c-fn">
              <Select id="c-fn" value={p.client.businessFunction} disabled={!canEdit} options={withCurrent(functions, p.client.businessFunction)} onChange={(v) => setClient('businessFunction', v, 'business function')} />
            </Field>
            <Field label="Business process" htmlFor="c-proc">
              <TextInput id="c-proc" value={p.client.businessProcess} disabled={!canEdit} onChange={(v) => setClient('businessProcess', v, 'business process')} />
            </Field>
            <Field label="Engagement type" htmlFor="c-eng" className="sm:col-span-2">
              <SuggestInput id="c-eng" value={p.client.engagementType} disabled={!canEdit} suggestions={ENGAGEMENT_TYPES} onChange={(v) => setClient('engagementType', v, 'engagement type')} />
            </Field>
          </div>
        </Panel>

        <Panel
          title="AI solution"
          description="Scope and non-functional requirements."
          actions={
            <Button size="sm" icon={<RefreshCw size={14} />} disabled={!canImpl} onClick={() => setRebuild(true)} title={canImpl ? 'Re-size the implementation plan from this scope' : 'Your role cannot edit the implementation plan'}>
              Re-size plan
            </Button>
          }
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Solution type" htmlFor="s-type">
              <Select id="s-type" value={p.solution.solutionType} disabled={!canEdit} options={SOLUTION_TYPES} onChange={(v) => setSolution('solutionType', v, 'solution type')} />
            </Field>
            <Field label="Cloud platform" htmlFor="s-cloud">
              <SuggestInput id="s-cloud" value={p.solution.cloudPlatform} disabled={!canEdit} suggestions={CLOUD_PLATFORMS} onChange={(v) => setSolution('cloudPlatform', v, 'cloud platform')} />
            </Field>
            <Field label="Planned agents" htmlFor="s-agents" hint={`${p.agents.length} defined`}>
              <NumberInput id="s-agents" value={p.solution.plannedAgents} min={1} disabled={!canEdit} onChange={(v) => setSolution('plannedAgents', Math.round(v), 'planned agents')} />
            </Field>
            <Field label="Planned workflows" htmlFor="s-wfs" hint={`${p.workflows.length} defined`}>
              <NumberInput id="s-wfs" value={p.solution.plannedWorkflows} min={1} disabled={!canEdit} onChange={(v) => setSolution('plannedWorkflows', Math.round(v), 'planned workflows')} />
            </Field>
            <Field label="Peak concurrency" htmlFor="s-peak">
              <NumberInput id="s-peak" value={p.solution.peakConcurrency} min={1} disabled={!canEdit} onChange={(v) => setSolution('peakConcurrency', Math.round(v), 'peak concurrency')} />
            </Field>
            <Field label="Working days per month" htmlFor="s-days">
              <NumberInput id="s-days" value={p.solution.workingDaysPerMonth} min={1} max={31} disabled={!canEdit} onChange={(v) => setSolution('workingDaysPerMonth', Math.round(v), 'working days per month')} />
            </Field>
            <Field label="LLM providers" className="sm:col-span-2">
              <TagInput ariaLabel="LLM providers" value={p.solution.llmProviders} disabled={!canEdit} onChange={(v) => setSolution('llmProviders', v, 'LLM providers')} />
            </Field>
            <Field label="Integrations" className="sm:col-span-2">
              <TagInput ariaLabel="Integrations" value={p.solution.integrations} disabled={!canEdit} onChange={(v) => setSolution('integrations', v, 'integrations')} />
            </Field>
            <Field label="Data sources" className="sm:col-span-2">
              <TagInput ariaLabel="Data sources" value={p.solution.dataSources} disabled={!canEdit} onChange={(v) => setSolution('dataSources', v, 'data sources')} />
            </Field>
            <div className="sm:col-span-2 flex flex-wrap gap-x-6 gap-y-3">
              <Toggle checked={p.solution.ragRequired} disabled={!canEdit} onChange={(v) => setSolution('ragRequired', v, 'RAG required')} label="RAG" />
              <Toggle checked={p.solution.documentProcessing} disabled={!canEdit} onChange={(v) => setSolution('documentProcessing', v, 'document processing')} label="Document processing" />
              <Toggle checked={p.solution.humanInTheLoop} disabled={!canEdit} onChange={(v) => setSolution('humanInTheLoop', v, 'human in the loop')} label="Human in the loop" />
            </div>
            <Field label="Security and governance" className="sm:col-span-2">
              <TextArea ariaLabel="Security and governance requirements" rows={2} value={p.solution.securityRequirements} disabled={!canEdit} onChange={(v) => setSolution('securityRequirements', v, 'security requirements')} />
            </Field>
            <Field label="Availability SLA" htmlFor="s-avail">
              <SuggestInput id="s-avail" value={p.solution.availabilitySla} disabled={!canEdit} suggestions={AVAILABILITY_SLAS} onChange={(v) => setSolution('availabilitySla', v, 'availability SLA')} />
            </Field>
            <Field label="Support SLA" htmlFor="s-support">
              <SuggestInput id="s-support" value={p.solution.supportSla} disabled={!canEdit} suggestions={SUPPORT_SLAS} onChange={(v) => setSolution('supportSla', v, 'support SLA')} />
            </Field>
          </div>
          <p className="text-[12.5px] text-ink-3 mt-3">Scope fields describe the solution; they do not change costs by themselves. Use Re-size plan to rebuild the implementation plan from them, and edit cost lines in Project Costing.</p>
        </Panel>
      </div>

      <section aria-label="Modules">
        <h2 className="text-[17px] font-semibold text-ink mb-3">Work on this project</h2>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {LINKS.map((l) => (
            <a key={l.route} href={href(l.route, ...(l.params ?? []))} className="group flex gap-3 rounded-[10px] border border-line bg-paper p-3.5 hover:border-ink-3 transition-colors min-w-0">
              <l.icon size={18} className="text-brand shrink-0 mt-0.5" aria-hidden />
              <span className="min-w-0">
                <span className="block font-semibold text-ink group-hover:text-brand">{l.label}</span>
                <span className="block text-[13px] text-ink-3 leading-snug mt-0.5">{l.body}</span>
              </span>
            </a>
          ))}
        </div>
      </section>

      <Panel title="Model checks" description="Errors and warnings from the engine for this project. Notes are listed on the module pages.">
        <IssueList issues={errors} empty="No errors or warnings." limit={8} />
      </Panel>

      <Modal
        open={rebuild}
        onClose={() => setRebuild(false)}
        title="Re-size implementation plan"
        footer={
          <>
            <Button onClick={() => setRebuild(false)}>Cancel</Button>
            <Button className="!text-brand-ink"
              variant="primary"
              icon={<RefreshCw size={15} />}
              onClick={() => {
                update(
                  'Re-sized implementation plan from scope',
                  (d) => {
                    const old = d.implementation;
                    const plan = buildImplementationPlan(
                      {
                        agents: d.solution.plannedAgents,
                        workflows: d.solution.plannedWorkflows,
                        integrations: d.solution.integrations.length,
                        ragRequired: d.solution.ragRequired,
                        documentProcessing: d.solution.documentProcessing,
                        humanInTheLoop: d.solution.humanInTheLoop,
                      },
                      `${d.id}-a${Date.now().toString(36)}`,
                    );
                    // Keep commercial settings and rate overrides the team already agreed.
                    plan.roles = old.roles.length ? old.roles : plan.roles;
                    plan.targetMarginPct = old.targetMarginPct;
                    plan.pricingMethod = old.pricingMethod;
                    plan.discountPct = old.discountPct;
                    plan.contingencyPct = old.contingencyPct;
                    plan.hoursPerDay = old.hoursPerDay;
                    plan.directExpenses = old.directExpenses;
                    d.implementation = plan;
                  },
                  `${p.name}: ${p.solution.plannedAgents} agents, ${p.solution.plannedWorkflows} workflows, ${p.solution.integrations.length} integrations`,
                );
                setRebuild(false);
              }}
            >
              Rebuild activities
            </Button>
          </>
        }
      >
        <div className="space-y-3 text-sm text-ink-2">
          <p>
            Replace the {p.implementation.activities.length} implementation activities with a plan sized for {p.solution.plannedAgents} agents, {p.solution.plannedWorkflows} workflows and {p.solution.integrations.length} integrations
            {p.solution.ragRequired ? ', with RAG' : ''}
            {p.solution.documentProcessing ? ', with document processing' : ''}.
          </p>
          <Callout tone="warn">Manual edits to activities, effort and dependencies are lost. Roles and rates, margin, pricing method, discount, contingency and direct expenses are kept.</Callout>
          <p>Current implementation price: {compact(r.implementation.price, cur)}. The new price appears in Project Costing straight after.</p>
        </div>
      </Modal>
    </div>
  );
}
