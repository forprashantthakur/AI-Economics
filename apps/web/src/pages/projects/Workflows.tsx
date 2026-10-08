import { useMemo, useState } from 'react';
import { Copy, Plus, Trash2 } from 'lucide-react';
import { PROVIDER_TIER_MAP, safeDiv, uid, type Project, type ProjectResult } from '@aies/engine';
import { Button, Callout, Empty, Field, Modal, Panel, ReadOnlyNote, Select, TextInput, Toggle } from '../../components/ui';
import { compact, count, unitPrice } from '../../lib/format';
import { href } from '../../lib/router';
import { useCan, useProjectUpdater, useStore, useTemplates } from '../../state/store';
import { FieldError, IconButton, NumberInput, templateGroup } from './common';
import { addWorkflowFromTemplate, duplicateWorkflow, orphanSteps, providerKeyFor, removeWorkflow, workflowDependents } from './ops';

export function WorkflowsTab({ project: p, result: r }: { project: Project; result: ProjectResult }) {
  const { state } = useStore();
  const update = useProjectUpdater(p.id);
  const canEdit = useCan('project.edit');
  const templates = useTemplates();
  const cur = p.currency;
  const [removeAgent, setRemoveAgent] = useState<string | null>(null);
  const [removeWf, setRemoveWf] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const orphans = useMemo(() => orphanSteps(p), [p]);

  const stepsByAgent = (agentId: string) => p.workflows.flatMap((w) => w.llmSteps.filter((s) => s.agentId === agentId).map((s) => ({ w, s })));
  const agentToRemove = p.agents.find((a) => a.id === removeAgent);
  const wfToRemove = p.workflows.find((w) => w.id === removeWf);
  const abuStream = r.priceBook.streams.find((s) => s.type === 'abu');

  return (
    <div className="space-y-5">
      {orphans.length > 0 && (
        <Callout tone="warn" title={`${orphans.length} LLM ${orphans.length === 1 ? 'step references' : 'steps reference'} a removed agent`}>
          Their cost is reported as unassigned in agent breakdowns. Reassign each step to an agent in Project Costing, LLM:{' '}
          {orphans
            .slice(0, 6)
            .map((o) => `"${o.step.name}" (${o.workflow.name})`)
            .join(', ')}
          {orphans.length > 6 ? ` and ${orphans.length - 6} more` : ''}.{' '}
          <a className="font-semibold text-brand hover:underline underline-offset-2" href={href('costing', 'llm')}>
            Open LLM steps
          </a>
        </Callout>
      )}

      <Panel
        title="Workflows"
        description="Each workflow is one business process with its own ABU, funnel, LLM steps and productivity baseline."
        padded={false}
        actions={
          <Button className="!text-brand-ink" size="sm" variant="primary" icon={<Plus size={14} />} disabled={!canEdit} onClick={() => setAdding(true)}>
            Add workflow
          </Button>
        }
      >
        <div className="px-4">
          <ReadOnlyNote show={!canEdit} what="change workflows or agents" />
        </div>
        {p.workflows.length === 0 ? (
          <Empty title="No workflows yet" body="Add a workflow from a process template to start measuring transactions, ACUs and ABUs." />
        ) : (
          <div className="scroll-x">
            <table className="dtable min-w-[1080px]">
              <thead>
                <tr>
                  <th>Workflow</th>
                  <th>Business function</th>
                  <th>Process</th>
                  <th>ABU</th>
                  <th className="r">Volume / month</th>
                  <th className="r">LLM steps</th>
                  <th className="r">Run cost / month</th>
                  <th className="r">Cost per ABU</th>
                  <th className="r">Actions</th>
                </tr>
              </thead>
              <tbody>
                {p.workflows.map((w) => {
                  const v = r.baseline.volumes[w.id];
                  const run = r.baseline.runCostByWorkflow[w.id];
                  return (
                    <tr key={w.id}>
                      <td className="min-w-[220px]">
                        <TextInput ariaLabel={`Name of workflow ${w.name}`} value={w.name} disabled={!canEdit} onChange={(val) => val.trim() && update('Renamed workflow', (d) => void (d.workflows.find((x) => x.id === w.id)!.name = val.trim()), `${w.name} to ${val.trim()}`)} />
                      </td>
                      <td className="text-[13px] text-ink-2">{w.businessFunction}</td>
                      <td className="text-[13px] text-ink-2">{w.process}</td>
                      <td className="text-[13px]">
                        <span className="font-semibold">{w.abuName}</span>
                      </td>
                      <td className="r" style={{ width: 150 }}>
                        <NumberInput
                          ariaLabel={`Monthly volume of ${w.name}`}
                          value={w.monthlyVolume}
                          min={0}
                          step={1000}
                          disabled={!canEdit}
                          onChange={(val) => update('Changed monthly volume', (d) => void (d.workflows.find((x) => x.id === w.id)!.monthlyVolume = Math.round(val)), `${w.name}: ${Math.round(val)}`)}
                        />
                      </td>
                      <td className="r">{w.llmSteps.length}</td>
                      <td className="r">{run ? compact(run, cur) : '—'}</td>
                      <td className="r">{v && run ? unitPrice(safeDiv(run, v.weightedAbus), cur) : '—'}</td>
                      <td className="r whitespace-nowrap">
                        <IconButton label={`Duplicate ${w.name}`} disabled={!canEdit} onClick={() => update('Duplicated workflow', (d) => void duplicateWorkflow(d, w.id), w.name)}>
                          <Copy size={15} />
                        </IconButton>
                        <IconButton label={`Remove ${w.name}`} tone="bad" disabled={!canEdit} onClick={() => setRemoveWf(w.id)}>
                          <Trash2 size={15} />
                        </IconButton>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <div className="px-4 py-3 border-t border-line-soft flex flex-wrap gap-x-5 gap-y-1 text-[13.5px]">
          <a className="font-semibold text-brand hover:underline underline-offset-2" href={href('abu')}>
            ABU definitions, funnel and complexity mix
          </a>
          <a className="font-semibold text-brand hover:underline underline-offset-2" href={href('costing', 'llm')}>
            LLM steps, tokens and model routing
          </a>
          <span className="text-ink-3">Cost per ABU is the fully loaded steady-state run cost per weighted ABU{abuStream ? `; prices are set by the ${abuStream.label} stream` : ''}.</span>
        </div>
      </Panel>

      <Panel
        title="Agents"
        description="Agents own LLM steps; cost by agent is allocated from their steps' consumption."
        padded={false}
        actions={
          <Button
            size="sm"
            icon={<Plus size={14} />}
            disabled={!canEdit}
            onClick={() => update('Added agent', (d) => void d.agents.push({ id: uid('ag'), name: `New agent ${d.agents.length + 1}`, role: '' }), p.name)}
          >
            Add agent
          </Button>
        }
      >
        {p.agents.length === 0 ? (
          <Empty title="No agents defined" body="Add an agent and assign LLM steps to it in Project Costing." />
        ) : (
          <div className="scroll-x">
            <table className="dtable min-w-[860px]">
              <thead>
                <tr>
                  <th>Agent</th>
                  <th>Role</th>
                  <th className="r">LLM steps</th>
                  <th className="r">LLM cost / month</th>
                  <th className="r">Fully loaded / month</th>
                  <th className="r">Remove</th>
                </tr>
              </thead>
              <tbody>
                {p.agents.map((a) => {
                  const steps = stepsByAgent(a.id);
                  return (
                    <tr key={a.id}>
                      <td className="min-w-[220px]">
                        <TextInput ariaLabel={`Name of agent ${a.name}`} value={a.name} disabled={!canEdit} onChange={(v) => v.trim() && update('Renamed agent', (d) => void (d.agents.find((x) => x.id === a.id)!.name = v.trim()), `${a.name} to ${v.trim()}`)} />
                      </td>
                      <td className="min-w-[280px]">
                        <TextInput ariaLabel={`Role of ${a.name}`} value={a.role} placeholder="What this agent does" disabled={!canEdit} onChange={(v) => update('Changed agent role', (d) => void (d.agents.find((x) => x.id === a.id)!.role = v), a.name)} />
                      </td>
                      <td className="r">{steps.length}</td>
                      <td className="r">{compact(r.baseline.llm.byAgent[a.id] ?? 0, cur)}</td>
                      <td className="r">{compact(r.baseline.runCostByAgent[a.id] ?? 0, cur)}</td>
                      <td className="r">
                        <IconButton label={`Remove ${a.name}`} tone="bad" disabled={!canEdit} onClick={() => setRemoveAgent(a.id)}>
                          <Trash2 size={15} />
                        </IconButton>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      {/* Remove agent */}
      <Modal
        open={!!agentToRemove}
        onClose={() => setRemoveAgent(null)}
        title="Remove agent"
        footer={
          <>
            <Button onClick={() => setRemoveAgent(null)}>Cancel</Button>
            <Button className="!text-bad"
              variant="danger"
              icon={<Trash2 size={15} />}
              onClick={() => {
                if (agentToRemove) update('Removed agent', (d) => void (d.agents = d.agents.filter((x) => x.id !== agentToRemove.id)), agentToRemove.name);
                setRemoveAgent(null);
              }}
            >
              Remove agent
            </Button>
          </>
        }
      >
        {agentToRemove && (
          <div className="space-y-3 text-sm text-ink-2">
            <p>
              Remove <span className="font-semibold text-ink">{agentToRemove.name}</span>?
            </p>
            {stepsByAgent(agentToRemove.id).length > 0 ? (
              <Callout tone="warn" title={`${stepsByAgent(agentToRemove.id).length} LLM steps use this agent`}>
                The steps keep running and costing, but their cost becomes unassigned until you reassign them:{' '}
                {stepsByAgent(agentToRemove.id)
                  .map(({ s, w }) => `"${s.name}" (${w.name})`)
                  .join(', ')}
                .
              </Callout>
            ) : (
              <p>No LLM steps use this agent, so costs do not change.</p>
            )}
          </div>
        )}
      </Modal>

      {/* Remove workflow */}
      <Modal
        open={!!wfToRemove}
        onClose={() => setRemoveWf(null)}
        title="Remove workflow"
        footer={
          <>
            <Button onClick={() => setRemoveWf(null)}>Cancel</Button>
            <Button className="!text-bad"
              variant="danger"
              icon={<Trash2 size={15} />}
              onClick={() => {
                if (wfToRemove) update('Removed workflow', (d) => removeWorkflow(d, wfToRemove.id), wfToRemove.name);
                setRemoveWf(null);
              }}
            >
              Remove workflow
            </Button>
          </>
        }
      >
        {wfToRemove &&
          (() => {
            const dep = workflowDependents(p, wfToRemove.id);
            return (
              <div className="space-y-3 text-sm text-ink-2">
                <p>
                  Remove <span className="font-semibold text-ink">{wfToRemove.name}</span> and its {wfToRemove.llmSteps.length} LLM steps? Run cost, ACUs, ABUs, prices and value recompute without it.
                </p>
                <ul className="list-disc pl-5 space-y-0.5">
                  <li>Its productivity baseline is removed.</li>
                  {dep.costLines > 0 && <li>{dep.costLines} cost lines assigned only to this workflow are removed. Shared lines stay.</li>}
                  {dep.actuals > 0 && <li>{dep.actuals} recorded actual rows for this workflow are removed.</li>}
                  <li>Agents stay; remove them separately if no longer needed.</li>
                </ul>
                {p.workflows.length === 1 && <Callout tone="warn">This is the only workflow. Without one the project measures no transactions, ACUs or ABUs.</Callout>}
              </div>
            );
          })()}
      </Modal>

      <AddWorkflowModal open={adding} onClose={() => setAdding(false)} project={p} templates={templates} catalogProviderDefault={providerKeyFor(p.solution.llmProviders)} onAdd={(input) => {
        update('Added workflow from template', (d) => void addWorkflowFromTemplate(d, input, state.catalog, templates), `${input.name} (${templates.find((t) => t.id === input.templateId)?.name ?? input.templateId})`);
        setAdding(false);
      }} />
    </div>
  );
}

function AddWorkflowModal({
  open,
  onClose,
  project,
  templates,
  catalogProviderDefault,
  onAdd,
}: {
  open: boolean;
  onClose: () => void;
  project: Project;
  templates: ReturnType<typeof useTemplates>;
  catalogProviderDefault: string;
  onAdd: (input: { templateId: string; name: string; monthlyVolume: number; provider: string; reuseAgents: boolean }) => void;
}) {
  const [templateId, setTemplateId] = useState('');
  const [name, setName] = useState('');
  const [volume, setVolume] = useState(0);
  const [provider, setProvider] = useState(catalogProviderDefault);
  const [reuse, setReuse] = useState(true);
  const [error, setError] = useState('');
  const tpl = templates.find((t) => t.id === templateId);
  const pick = (id: string) => {
    const t = templates.find((x) => x.id === id);
    setTemplateId(id);
    setError('');
    if (t) {
      setName(t.name);
      setVolume(t.monthlyVolume);
    }
  };
  const groups = [...new Set(templates.map((t) => templateGroup(t.businessFunction)))];
  const sameAgents = tpl ? tpl.agents.filter((a) => project.agents.some((x) => x.name.trim().toLowerCase() === a.name.trim().toLowerCase())).length : 0;
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Add workflow from a template"
      wide
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button className="!text-brand-ink"
            variant="primary"
            icon={<Plus size={15} />}
            onClick={() => {
              if (!tpl) return setError('Choose a process template.');
              if (!(volume > 0)) return setError('Monthly volume must be greater than zero.');
              onAdd({ templateId, name: name.trim() || tpl.name, monthlyVolume: volume, provider, reuseAgents: reuse });
              setTemplateId('');
            }}
          >
            Add workflow
          </Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Process template" htmlFor="aw-tpl" className="sm:col-span-2">
          <select id="aw-tpl" className="field" value={templateId} onChange={(e) => pick(e.target.value)}>
            <option value="">Choose a template</option>
            {groups.map((g) => (
              <optgroup key={g} label={g}>
                {templates
                  .filter((t) => templateGroup(t.businessFunction) === g)
                  .map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                      {t.builtIn ? '' : ' (custom)'}
                    </option>
                  ))}
              </optgroup>
            ))}
          </select>
          {tpl && (
            <p className="text-[13px] text-ink-2 mt-1.5">
              <span className="font-semibold text-ink">1 ABU = 1 {tpl.abuName}.</span> {tpl.abuDefinition}
            </p>
          )}
        </Field>
        <Field label="Workflow name" htmlFor="aw-name">
          <input id="aw-name" className="field" value={name} onChange={(e) => setName(e.target.value)} placeholder="Name shown in breakdowns" />
        </Field>
        <Field label="Monthly volume" htmlFor="aw-vol" hint={tpl ? `Template default ${count(tpl.monthlyVolume, project.currency)}` : undefined}>
          <NumberInput id="aw-vol" value={volume} min={0} step={1000} onChange={(v) => setVolume(Math.round(v))} />
        </Field>
        <Field label="Models from provider" htmlFor="aw-prov" hint="Steps route to this provider's frontier, balanced and fast models.">
          <Select id="aw-prov" value={provider} onChange={setProvider} options={Object.entries(PROVIDER_TIER_MAP).map(([k, v]) => ({ value: k, label: v.label }))} />
        </Field>
        <Field label="Agents">
          <div className="pt-1.5">
            <Toggle checked={reuse} onChange={setReuse} label="Reuse agents with the same name" />
          </div>
          {tpl && (
            <p className="text-[12.5px] text-ink-3 mt-1">
              {reuse && sameAgents ? `${sameAgents} of ${tpl.agents.length} template agents already exist and will be shared; ` : ''}
              {reuse ? tpl.agents.length - sameAgents : tpl.agents.length} new {(reuse ? tpl.agents.length - sameAgents : tpl.agents.length) === 1 ? 'agent' : 'agents'} will be added.
            </p>
          )}
        </Field>
        <div className="sm:col-span-2">
          <FieldError>{error}</FieldError>
          <p className="text-[12.5px] text-ink-3">
            The engine builds the workflow, its LLM steps, complexity mix, human-review settings and productivity baseline from the template. Execution cost components the project does not already cost (for example OCR for a document
            workflow) are added for this workflow only; shared hosting and AgentOps lines are not duplicated. Review volumes and cost lines afterwards.
          </p>
        </div>
      </div>
    </Modal>
  );
}
