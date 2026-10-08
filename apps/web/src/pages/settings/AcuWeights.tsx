import { useState } from 'react';
import { CheckCircle2, Copy, Lock, Trash2, Archive } from 'lucide-react';
import { ACU_RESOURCES, ACU_RESOURCE_KEYS, uid, type AcuWeightSet } from '@aies/engine';
import { Badge, Button, Callout, Field, Modal, Panel, ReadOnlyNote, TextArea, TextInput, cx } from '../../components/ui';
import { useCan, useCatalogUpdater, useStore } from '../../state/store';
import { NumberInput, today } from '../projects/common';

const STATUS_TONE = { draft: 'warn', approved: 'good', retired: 'neutral' } as const;

function nextVersion(sets: AcuWeightSet[], name: string, from: string): string {
  const versions = sets.filter((s) => s.name === name).map((s) => s.version);
  const [major, minor] = from.split('.').map((x) => Number(x) || 0);
  let v = `${major}.${minor + 1}`;
  let k = minor + 1;
  while (versions.includes(v)) v = `${major}.${++k}`;
  return v;
}

export function AcuWeightsTab() {
  const { state } = useStore();
  const canEdit = useCan('catalog.edit');
  const update = useCatalogUpdater();
  const sets = state.catalog.acuWeightSets;
  const [selected, setSelected] = useState<string | undefined>(sets.find((s) => s.status === 'draft')?.id ?? sets[0]?.id);
  const [confirm, setConfirm] = useState<{ kind: 'approve' | 'retire' | 'delete'; set: AcuWeightSet } | null>(null);
  const set = sets.find((s) => s.id === selected) ?? sets[0];
  const usedBy = (id: string) => state.projects.filter((p) => p.acu.weightSetId === id);
  const usedByMethodB = (id: string) => state.projects.filter((p) => p.acu.weightSetId === id && p.acu.method === 'weighted_resource');

  const newVersion = (src: AcuWeightSet) => {
    const v = nextVersion(sets, src.name, src.version);
    const draft: AcuWeightSet = { ...structuredClone(src), id: uid('acu'), version: v, status: 'draft', author: state.user.name, effectiveDate: '', rationale: `Draft v${v} based on v${src.version}. ${src.rationale}` };
    update('Created ACU weight set version', (c) => void c.acuWeightSets.unshift(draft), `${src.name} v${v} (draft from v${src.version})`);
    setSelected(draft.id);
  };
  const editDraft = (label: string, mutate: (s: AcuWeightSet) => void) => {
    if (!set || set.status !== 'draft') return;
    update(`Edited ACU weight set: ${label}`, (c) => {
      const t = c.acuWeightSets.find((x) => x.id === set.id);
      if (t && t.status === 'draft') mutate(t);
    }, `${set.name} v${set.version}`);
  };

  const ordered = [...sets].sort((a, b) => a.name.localeCompare(b.name) || b.version.localeCompare(a.version, undefined, { numeric: true }));
  const readOnly = !canEdit || set?.status !== 'draft';

  return (
    <div className="space-y-5">
      <Callout>
        ACU weights define how much each resource counts towards an AI Consumption Unit under the weighted-resource method. Sets are versioned: copy a set to a new draft, edit it, then approve it. Approved and retired sets are locked so
        every past ACU figure stays reproducible.
      </Callout>
      <div className="grid gap-5 xl:grid-cols-[minmax(320px,0.8fr)_1.6fr]">
        <Panel title="Weight sets" padded={false}>
          <ReadOnlyNote show={!canEdit} what="change ACU weights" />
          <ul className="divide-y divide-line-soft border-t border-line-soft">
            {ordered.map((s) => {
              const sel = s.id === set?.id;
              const n = usedBy(s.id).length;
              return (
                <li key={s.id}>
                  <button type="button" onClick={() => setSelected(s.id)} aria-current={sel} className={cx('w-full text-left px-4 py-3 hover:bg-sunken flex items-start justify-between gap-3', sel && 'bg-brand-tint hover:bg-brand-tint')}>
                    <span className="min-w-0">
                      <span className="block font-semibold text-ink">
                        {s.name} <span className="num">v{s.version}</span>
                      </span>
                      <span className="block text-[12.5px] text-ink-3">
                        {s.effectiveDate ? `Effective ${s.effectiveDate}` : 'Not yet effective'}, {s.author}
                        {n ? `, ${n} ${n === 1 ? 'project' : 'projects'}` : ''}
                      </span>
                    </span>
                    <Badge tone={STATUS_TONE[s.status]}>{s.status === 'draft' ? 'Draft' : s.status === 'approved' ? 'Approved' : 'Retired'}</Badge>
                  </button>
                </li>
              );
            })}
          </ul>
        </Panel>

        {set && (
          <Panel
            title={`${set.name} v${set.version}`}
            description={set.status === 'draft' ? 'Draft: editable until approved.' : set.status === 'approved' ? 'Approved: locked. Create a new version to change weights.' : 'Retired: locked and kept for audit.'}
          >
            <div className="flex flex-wrap gap-2 mb-4">
              {set.status === 'draft' && (
                <>
                  <Button className="!text-brand-ink" size="sm" variant="primary" icon={<CheckCircle2 size={14} />} disabled={!canEdit} onClick={() => setConfirm({ kind: 'approve', set })}>
                    Approve
                  </Button>
                  <Button className="!text-bad" size="sm" variant="danger" icon={<Trash2 size={14} />} disabled={!canEdit || usedBy(set.id).length > 0} onClick={() => setConfirm({ kind: 'delete', set })} title={usedBy(set.id).length ? 'A project uses this draft' : undefined}>
                    Discard draft
                  </Button>
                </>
              )}
              <Button size="sm" icon={<Copy size={14} />} disabled={!canEdit} onClick={() => newVersion(set)}>
                New version
              </Button>
              {set.status === 'approved' && (
                <Button size="sm" icon={<Archive size={14} />} disabled={!canEdit} onClick={() => setConfirm({ kind: 'retire', set })}>
                  Retire
                </Button>
              )}
            </div>
            {set.status !== 'draft' && (
              <p className="flex items-center gap-1.5 text-[13px] text-ink-3 mb-3">
                <Lock size={13} aria-hidden /> Read-only. Use New version to propose changes.
              </p>
            )}
            <div className="grid gap-4 sm:grid-cols-3 mb-4">
              <Field label="Name">
                <TextInput ariaLabel="Weight set name" value={set.name} disabled={readOnly} onChange={(v) => v.trim() && editDraft('name', (s) => void (s.name = v.trim()))} />
              </Field>
              <Field label="Version">
                <TextInput ariaLabel="Version" value={set.version} disabled={readOnly} onChange={(v) => v.trim() && editDraft('version', (s) => void (s.version = v.trim()))} />
              </Field>
              <Field label="Author">
                <TextInput ariaLabel="Author" value={set.author} disabled={readOnly} onChange={(v) => editDraft('author', (s) => void (s.author = v))} />
              </Field>
            </div>
            <div className="scroll-x -mx-4">
              <table className="dtable min-w-[560px]">
                <thead>
                  <tr>
                    <th className="pl-4">Resource</th>
                    <th>Unit</th>
                    <th className="r pr-4">ACUs per unit</th>
                  </tr>
                </thead>
                <tbody>
                  {ACU_RESOURCE_KEYS.map((k) => {
                    const def = ACU_RESOURCES[k];
                    return (
                      <tr key={k}>
                        <td className="pl-4">
                          <div className="font-semibold text-[13.5px]">{def.label}</div>
                          <div className="text-[12px] text-ink-3">{def.derived ? 'Measured from the workflow model' : 'Measured from mapped cost lines'}</div>
                        </td>
                        <td className="text-[13px] text-ink-2 whitespace-nowrap">{def.unit}</td>
                        <td className="r pr-4" style={{ width: 170 }}>
                          <NumberInput ariaLabel={`Weight for ${def.label}`} value={set.weights[k] ?? 0} min={0} step={1} disabled={readOnly} onChange={(v) => editDraft(def.label, (s) => void (s.weights[k] = v))} />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <Field label="Rationale" className="mt-4">
              <TextArea ariaLabel="Rationale" rows={3} value={set.rationale} disabled={readOnly} onChange={(v) => editDraft('rationale', (s) => void (s.rationale = v))} />
            </Field>
            {usedByMethodB(set.id).length > 0 && (
              <p className="text-[12.5px] text-ink-3 mt-3">
                Used for weighted-resource ACUs by {usedByMethodB(set.id).map((p) => p.name).join(', ')}.
              </p>
            )}
          </Panel>
        )}
      </div>

      <Modal
        open={!!confirm}
        onClose={() => setConfirm(null)}
        title={confirm?.kind === 'approve' ? 'Approve weight set' : confirm?.kind === 'retire' ? 'Retire weight set' : 'Discard draft'}
        footer={
          <>
            <Button onClick={() => setConfirm(null)}>Cancel</Button>
            <Button className={confirm?.kind === 'delete' ? '!text-bad' : '!text-brand-ink'}
              variant={confirm?.kind === 'delete' ? 'danger' : 'primary'}
              onClick={() => {
                if (!confirm) return;
                const s = confirm.set;
                if (confirm.kind === 'approve')
                  update('Approved ACU weight set', (c) => {
                    const t = c.acuWeightSets.find((x) => x.id === s.id);
                    if (t) {
                      t.status = 'approved';
                      t.effectiveDate = today();
                    }
                  }, `${s.name} v${s.version}, effective ${today()}`);
                if (confirm.kind === 'retire') update('Retired ACU weight set', (c) => void (c.acuWeightSets.find((x) => x.id === s.id)!.status = 'retired'), `${s.name} v${s.version}`);
                if (confirm.kind === 'delete') {
                  update('Discarded ACU weight set draft', (c) => void (c.acuWeightSets = c.acuWeightSets.filter((x) => x.id !== s.id)), `${s.name} v${s.version}`);
                  setSelected(sets.find((x) => x.id !== s.id)?.id);
                }
                setConfirm(null);
              }}
            >
              {confirm?.kind === 'approve' ? 'Approve and lock' : confirm?.kind === 'retire' ? 'Retire set' : 'Discard draft'}
            </Button>
          </>
        }
      >
        {confirm && (
          <div className="space-y-3 text-sm text-ink-2">
            {confirm.kind === 'approve' && (
              <p>
                Approve {confirm.set.name} v{confirm.set.version}? It becomes effective today ({today()}) and its weights are locked. Projects choose it in the ACU Calculator.
              </p>
            )}
            {confirm.kind === 'retire' && (
              <>
                <p>
                  Retire {confirm.set.name} v{confirm.set.version}? It stays in the catalogue for audit but should no longer be used for new measurement.
                </p>
                {usedByMethodB(confirm.set.id).length > 0 && (
                  <Callout tone="warn">
                    {usedByMethodB(confirm.set.id)
                      .map((p) => p.name)
                      .join(', ')}{' '}
                    measure ACUs with this set and will show a warning until they switch to an approved set.
                  </Callout>
                )}
              </>
            )}
            {confirm.kind === 'delete' && <p>Discard the draft {confirm.set.name} v{confirm.set.version}? Drafts were never effective, so no past figure depends on it.</p>}
          </div>
        )}
      </Modal>
    </div>
  );
}
