import { useState } from 'react';
import { Copy, Plus, Trash2, X } from 'lucide-react';
import { PROCESS_TEMPLATES, type Archetype, type ProcessTemplate } from '@aies/engine';
import { Badge, Button, Callout, Checkbox, Field, Modal, Panel, ReadOnlyNote, Select, TextArea, TextInput, cx } from '../../components/ui';
import { count, money } from '../../lib/format';
import { useCan, useStore } from '../../state/store';
import { DEFAULT_FUNCTIONS, DEFAULT_INDUSTRIES, FieldError, IconButton, NumberInput, withCurrent } from '../projects/common';

const ARCHETYPES: { value: Archetype; label: string }[] = [
  { value: 'document', label: 'Document processing' },
  { value: 'conversational', label: 'Conversational' },
  { value: 'analytical', label: 'Analytical' },
  { value: 'generative', label: 'Generative' },
];

export function TemplatesTab() {
  const { state, dispatch } = useStore();
  const canEdit = useCan('catalog.edit');
  const custom = state.customTemplates;
  const [selected, setSelected] = useState<string | null>(custom[0]?.id ?? null);
  const [dupFrom, setDupFrom] = useState(PROCESS_TEMPLATES[0].id);
  const [confirm, setConfirm] = useState<ProcessTemplate | null>(null);
  const all = [...PROCESS_TEMPLATES, ...custom];
  const sel = custom.find((t) => t.id === selected);
  const functions = [...new Set([...DEFAULT_FUNCTIONS, ...state.customFunctions])];

  const save = (templates: ProcessTemplate[], action: string) => dispatch({ type: 'setTemplates', templates, action });
  const editSel = (label: string, mutate: (t: ProcessTemplate) => void) => {
    if (!sel) return;
    save(
      custom.map((t) => {
        if (t.id !== sel.id) return t;
        const c = structuredClone(t);
        mutate(c);
        return c;
      }),
      `Edited custom template: ${sel.name} (${label})`,
    );
  };
  const duplicate = (id: string) => {
    const src = all.find((t) => t.id === id);
    if (!src) return;
    let newId = `custom-${src.id.replace(/^custom-/, '')}`;
    let k = 2;
    while (all.some((t) => t.id === newId)) newId = `custom-${src.id.replace(/^custom-/, '')}-${k++}`;
    const copy: ProcessTemplate = { ...structuredClone(src), id: newId, name: `${src.name} (custom)`, builtIn: false };
    save([...custom, copy], `Created custom template from ${src.name}`);
    setSelected(copy.id);
  };
  const usedBy = (t: ProcessTemplate) => state.projects.filter((p) => p.workflows.some((w) => w.process === t.process && w.abuName === t.abuName)).length;

  return (
    <div className="space-y-5">
      <div className="grid gap-5 xl:grid-cols-[minmax(320px,0.9fr)_1.5fr]">
        <Panel title="Process templates" description="Built-in templates are read-only. Duplicate one to create a custom template for your clients' processes." padded={false}>
          <div className="px-4 pb-3">
            <ReadOnlyNote show={!canEdit} what="manage templates" />
            <div className="flex gap-2">
              <select className="field" aria-label="Template to duplicate" value={dupFrom} onChange={(e) => setDupFrom(e.target.value)} disabled={!canEdit}>
                {all.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name} ({t.businessFunction})
                  </option>
                ))}
              </select>
              <Button icon={<Copy size={15} />} onClick={() => duplicate(dupFrom)} disabled={!canEdit}>
                Duplicate
              </Button>
            </div>
          </div>
          <div className="border-t border-line-soft max-h-[620px] overflow-y-auto">
            {custom.length > 0 && <h4 className="px-4 pt-3 pb-1 text-[13px] font-semibold text-ink-2">Custom ({custom.length})</h4>}
            <ul>
              {custom.map((t) => (
                <li key={t.id}>
                  <button type="button" onClick={() => setSelected(t.id)} aria-current={t.id === selected} className={cx('w-full text-left px-4 py-2.5 hover:bg-sunken', t.id === selected && 'bg-brand-tint hover:bg-brand-tint')}>
                    <span className="block font-semibold text-ink">{t.name}</span>
                    <span className="block text-[12.5px] text-ink-3">
                      {t.businessFunction}, 1 ABU = 1 {t.abuName}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
            <h4 className="px-4 pt-3 pb-1 text-[13px] font-semibold text-ink-2">Built-in ({PROCESS_TEMPLATES.length})</h4>
            <ul className="pb-2">
              {PROCESS_TEMPLATES.map((t) => (
                <li key={t.id} className="px-4 py-2 flex items-start justify-between gap-3">
                  <span className="min-w-0">
                    <span className="block text-[14px] text-ink">{t.name}</span>
                    <span className="block text-[12.5px] text-ink-3">
                      {t.businessFunction}, 1 ABU = 1 {t.abuName}, {count(t.monthlyVolume, 'INR')} / month
                    </span>
                  </span>
                  <IconButton label={`Duplicate ${t.name}`} disabled={!canEdit} onClick={() => duplicate(t.id)}>
                    <Copy size={15} />
                  </IconButton>
                </li>
              ))}
            </ul>
          </div>
        </Panel>

        {sel ? (
          <Panel
            title={sel.name}
            description={`Custom template, id ${sel.id}. Used by the intake wizard and by Add workflow; editing it does not change existing projects.`}
            actions={
              <Button className="!text-bad" size="sm" variant="danger" icon={<Trash2 size={14} />} disabled={!canEdit} onClick={() => setConfirm(sel)}>
                Delete
              </Button>
            }
          >
            <TemplateEditor t={sel} canEdit={canEdit} functions={functions} edit={editSel} />
          </Panel>
        ) : (
          <Panel title="No custom template selected">
            <p className="text-sm text-ink-2">Duplicate a built-in template to adapt its ABU definition, volumes, funnel rates and baseline for a client process. Custom templates appear in the intake wizard under their business function.</p>
          </Panel>
        )}
      </div>

      <ListsPanel canEdit={canEdit} />

      <Modal
        open={!!confirm}
        onClose={() => setConfirm(null)}
        title="Delete custom template"
        footer={
          <>
            <Button onClick={() => setConfirm(null)}>Cancel</Button>
            <Button className="!text-bad"
              variant="danger"
              icon={<Trash2 size={15} />}
              onClick={() => {
                if (confirm) {
                  save(
                    custom.filter((t) => t.id !== confirm.id),
                    `Deleted custom template ${confirm.name}`,
                  );
                  setSelected(custom.find((t) => t.id !== confirm.id)?.id ?? null);
                }
                setConfirm(null);
              }}
            >
              Delete template
            </Button>
          </>
        }
      >
        {confirm && (
          <p className="text-sm text-ink-2">
            Delete <span className="font-semibold text-ink">{confirm.name}</span>? Projects already created from it keep their workflows{usedBy(confirm) ? ` (${usedBy(confirm)} projects use the same process and ABU)` : ''}; it is only removed from the
            template lists.
          </p>
        )}
      </Modal>
    </div>
  );
}

function TemplateEditor({ t, canEdit, functions, edit }: { t: ProcessTemplate; canEdit: boolean; functions: string[]; edit: (label: string, m: (t: ProcessTemplate) => void) => void }) {
  const d = !canEdit;
  const [criterion, setCriterion] = useState('');
  return (
    <div className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Template name">
          <TextInput ariaLabel="Template name" value={t.name} disabled={d} onChange={(v) => v.trim() && edit('name', (x) => void (x.name = v.trim()))} />
        </Field>
        <Field label="Business function">
          <Select ariaLabel="Business function" value={t.businessFunction} disabled={d} options={withCurrent(functions, t.businessFunction)} onChange={(v) => edit('business function', (x) => void (x.businessFunction = v))} />
        </Field>
        <Field label="Process">
          <TextInput ariaLabel="Process" value={t.process} disabled={d} onChange={(v) => v.trim() && edit('process', (x) => void (x.process = v.trim()))} />
        </Field>
        <Field label="Archetype" hint="Sets the agent pattern and LLM step profile.">
          <Select ariaLabel="Archetype" value={t.archetype} disabled={d} options={ARCHETYPES} onChange={(v) => edit('archetype', (x) => void (x.archetype = v))} />
          {t.archetype && <p className="text-[12px] text-ink-3 mt-1">Agents and steps stay those copied from the source template; change them on the project after creation.</p>}
        </Field>
        <Field label="Description" className="sm:col-span-2">
          <TextArea ariaLabel="Description" rows={2} value={t.description} disabled={d} onChange={(v) => edit('description', (x) => void (x.description = v))} />
        </Field>
      </div>

      <section>
        <h4 className="text-[14px] font-semibold text-ink mb-2">AI Business Unit</h4>
        <div className="grid gap-4 sm:grid-cols-[1fr_2fr]">
          <Field label="ABU name" hint="Singular, e.g. invoice">
            <TextInput ariaLabel="ABU name" value={t.abuName} disabled={d} onChange={(v) => v.trim() && edit('ABU name', (x) => void (x.abuName = v.trim()))} />
          </Field>
          <Field label="ABU definition" hint="What counts as one accepted unit the client pays for">
            <TextArea ariaLabel="ABU definition" rows={2} value={t.abuDefinition} disabled={d} onChange={(v) => edit('ABU definition', (x) => void (x.abuDefinition = v))} />
          </Field>
        </div>
        <Field label="Acceptance criteria" className="mt-3">
          <ul className="space-y-1.5">
            {t.acceptanceCriteria.map((c, i) => (
              <li key={i} className="flex items-center gap-2">
                <span className="flex-1 text-[14px] text-ink-2 bg-sunken border border-line rounded-md px-2.5 py-1.5">{c}</span>
                <IconButton label={`Remove criterion ${i + 1}`} tone="bad" disabled={d} onClick={() => edit('acceptance criteria', (x) => void x.acceptanceCriteria.splice(i, 1))}>
                  <X size={15} />
                </IconButton>
              </li>
            ))}
          </ul>
          {!d && (
            <div className="flex gap-2 mt-2">
              <input
                className="field"
                aria-label="New acceptance criterion"
                placeholder="Add a criterion, e.g. Posted without manual correction"
                value={criterion}
                onChange={(e) => setCriterion(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && criterion.trim()) {
                    edit('acceptance criteria', (x) => void x.acceptanceCriteria.push(criterion.trim()));
                    setCriterion('');
                  }
                }}
              />
              <Button
                icon={<Plus size={15} />}
                onClick={() => {
                  if (!criterion.trim()) return;
                  edit('acceptance criteria', (x) => void x.acceptanceCriteria.push(criterion.trim()));
                  setCriterion('');
                }}
              >
                Add
              </Button>
            </div>
          )}
        </Field>
      </section>

      <section>
        <h4 className="text-[14px] font-semibold text-ink mb-2">Volume and funnel defaults</h4>
        <div className="grid gap-4 grid-cols-2 lg:grid-cols-3">
          <Field label="Default monthly volume">
            <NumberInput ariaLabel="Default monthly volume" value={t.monthlyVolume} min={0} step={1000} disabled={d} onChange={(v) => edit('volume', (x) => void (x.monthlyVolume = Math.round(v)))} />
          </Field>
          <Field label="Success rate">
            <NumberInput ariaLabel="Success rate" value={t.successRatePct} min={0} max={100} suffix="%" disabled={d} onChange={(v) => edit('success rate', (x) => void (x.successRatePct = v))} />
          </Field>
          <Field label="Acceptance rate">
            <NumberInput ariaLabel="Acceptance rate" value={t.acceptanceRatePct} min={0} max={100} suffix="%" disabled={d} onChange={(v) => edit('acceptance rate', (x) => void (x.acceptanceRatePct = v))} />
          </Field>
          <Field label="Retry rate">
            <NumberInput ariaLabel="Retry rate" value={t.retryRatePct} min={0} max={100} suffix="%" disabled={d} onChange={(v) => edit('retry rate', (x) => void (x.retryRatePct = v))} />
          </Field>
          <Field label="Human intervention">
            <NumberInput ariaLabel="Human intervention rate" value={t.humanInterventionRatePct} min={0} max={100} suffix="%" disabled={d} onChange={(v) => edit('human intervention', (x) => void (x.humanInterventionRatePct = v))} />
          </Field>
          <Field label="Workflow steps">
            <NumberInput ariaLabel="Workflow steps" value={t.workflowSteps} min={1} disabled={d} onChange={(v) => edit('workflow steps', (x) => void (x.workflowSteps = Math.round(v)))} />
          </Field>
        </div>
      </section>

      <section>
        <h4 className="text-[14px] font-semibold text-ink mb-2">Productivity baseline and features</h4>
        <div className="grid gap-4 grid-cols-2 lg:grid-cols-3">
          <Field label="Manual minutes before" hint="Per transaction, without AI">
            <NumberInput ariaLabel="Manual minutes before" value={t.manualMinutesBefore} min={0} disabled={d} onChange={(v) => edit('manual minutes', (x) => void (x.manualMinutesBefore = v))} />
          </Field>
          <Field label="Review minutes" hint="Per human-assisted transaction">
            <NumberInput ariaLabel="Review minutes" value={t.reviewMinutes} min={0} disabled={d} onChange={(v) => edit('review minutes', (x) => void (x.reviewMinutes = v))} />
          </Field>
          <Field label="Loaded hourly cost (INR)" hint={`Converted to the project currency, now ${money(t.hourlyCostInr, 'INR')}`}>
            <NumberInput ariaLabel="Hourly cost in INR" value={t.hourlyCostInr} min={0} prefix="₹" disabled={d} onChange={(v) => edit('hourly cost', (x) => void (x.hourlyCostInr = v))} />
          </Field>
          <Field label="Pages per transaction">
            <NumberInput ariaLabel="Pages per transaction" value={t.pagesPerTxn} min={0} step={0.5} disabled={d || !t.documentProcessing} onChange={(v) => edit('pages per transaction', (x) => void (x.pagesPerTxn = v))} />
          </Field>
          <Field label="RAG queries per transaction">
            <NumberInput ariaLabel="RAG queries per transaction" value={t.ragQueriesPerTxn} min={0} disabled={d || !t.ragRequired} onChange={(v) => edit('RAG queries', (x) => void (x.ragQueriesPerTxn = v))} />
          </Field>
          <div className="flex flex-col gap-2 pt-6">
            <Checkbox checked={t.ragRequired} disabled={d} onChange={(v) => edit('RAG flag', (x) => void (x.ragRequired = v))} label="RAG required" />
            <Checkbox checked={t.documentProcessing} disabled={d} onChange={(v) => edit('document flag', (x) => void (x.documentProcessing = v))} label="Document processing" />
          </div>
        </div>
      </section>
    </div>
  );
}

function ListsPanel({ canEdit }: { canEdit: boolean }) {
  const { state, dispatch } = useStore();
  const [ind, setInd] = useState('');
  const [fn, setFn] = useState('');
  const [err, setErr] = useState<{ ind?: string; fn?: string }>({});
  const setLists = (industries: string[], functions: string[], action: string, detail: string) => {
    dispatch({ type: 'setLists', industries, functions });
    dispatch({ type: 'audit', action, detail, projectId: null });
  };
  const addInd = () => {
    const v = ind.trim();
    if (!v) return setErr({ ind: 'Type an industry name.' });
    if ([...DEFAULT_INDUSTRIES, ...state.customIndustries].some((x) => x.toLowerCase() === v.toLowerCase())) return setErr({ ind: `"${v}" is already listed.` });
    setLists([...state.customIndustries, v], state.customFunctions, 'Added industry', v);
    setInd('');
    setErr({});
  };
  const addFn = () => {
    const v = fn.trim();
    if (!v) return setErr({ fn: 'Type a business function name.' });
    if ([...DEFAULT_FUNCTIONS, ...state.customFunctions].some((x) => x.toLowerCase() === v.toLowerCase())) return setErr({ fn: `"${v}" is already listed.` });
    setLists(state.customIndustries, [...state.customFunctions, v], 'Added business function', v);
    setFn('');
    setErr({});
  };
  const chips = (items: string[], onRemove: (v: string) => void, builtIn: string[]) => (
    <div className="flex flex-wrap gap-1.5">
      {builtIn.map((v) => (
        <Badge key={v}>{v}</Badge>
      ))}
      {items.map((v) => (
        <span key={v} className="inline-flex items-center gap-1 rounded-full bg-brand-tint text-brand pl-2 pr-1 py-[1px] text-[12px] font-semibold">
          {v}
          {canEdit && (
            <button type="button" aria-label={`Remove ${v}`} className="hover:!text-bad" onClick={() => onRemove(v)}>
              <X size={12} />
            </button>
          )}
        </span>
      ))}
    </div>
  );
  return (
    <Panel title="Industries and business functions" description="Built-in values are grey; custom values (green) appear in the intake wizard and project forms.">
      <div className="grid gap-6 lg:grid-cols-2">
        <div>
          <h4 className="text-[13.5px] font-semibold text-ink mb-2">Industries</h4>
          {chips(state.customIndustries, (v) => setLists(state.customIndustries.filter((x) => x !== v), state.customFunctions, 'Removed industry', v), DEFAULT_INDUSTRIES)}
          <div className="flex gap-2 mt-3">
            <input className="field" aria-label="New industry" placeholder="New industry" value={ind} disabled={!canEdit} onChange={(e) => setInd(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addInd()} />
            <Button icon={<Plus size={15} />} onClick={addInd} disabled={!canEdit}>
              Add industry
            </Button>
          </div>
          <FieldError>{err.ind}</FieldError>
        </div>
        <div>
          <h4 className="text-[13.5px] font-semibold text-ink mb-2">Business functions</h4>
          {chips(state.customFunctions, (v) => setLists(state.customIndustries, state.customFunctions.filter((x) => x !== v), 'Removed business function', v), DEFAULT_FUNCTIONS)}
          <div className="flex gap-2 mt-3">
            <input className="field" aria-label="New business function" placeholder="New business function" value={fn} disabled={!canEdit} onChange={(e) => setFn(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addFn()} />
            <Button icon={<Plus size={15} />} onClick={addFn} disabled={!canEdit}>
              Add function
            </Button>
          </div>
          <FieldError>{err.fn}</FieldError>
        </div>
      </div>
      <p className="text-[12.5px] text-ink-3 mt-4">Removing a value only removes it from the pick lists; projects that use it keep it.</p>
      <Callout>Templates with a business function outside Finance, Procurement, HR, IT and Customer Operations are listed under Additional in the intake wizard.</Callout>
    </Panel>
  );
}
