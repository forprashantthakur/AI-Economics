import { useState } from 'react';
import { Trash2 } from 'lucide-react';
import { uid, type ProjectResult, type ScenarioOverrides, type ScenarioRecord } from '@aies/engine';
import { Button, Field, Modal, Panel, ReadOnlyNote, TextInput } from '../../components/ui';
import { dateTime } from '../../lib/format';
import { useStore, type useProjectUpdater } from '../../state/store';
import { clean, describe } from './drivers';

type Updater = ReturnType<typeof useProjectUpdater>;

export function SavedScenarios({
  r,
  update,
  canSave,
  current,
  defaultName,
  onLoad,
}: {
  r: ProjectResult;
  update: Updater;
  canSave: boolean;
  current: ScenarioOverrides;
  defaultName: string;
  onLoad: (s: ScenarioRecord) => void;
}) {
  const { state } = useStore();
  const [name, setName] = useState('');
  const [toDelete, setToDelete] = useState<ScenarioRecord | null>(null);
  const saved = [...r.project.scenarios].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const finalName = (name.trim() || defaultName).slice(0, 80);
  const nextVersion = 1 + Math.max(0, ...r.project.scenarios.filter((s) => s.name.toLowerCase() === finalName.toLowerCase()).map((s) => s.version));

  const save = () => {
    const record: ScenarioRecord = { id: uid('sc'), name: finalName, version: nextVersion, createdAt: new Date().toISOString(), author: state.user.name, overrides: clean(current) };
    update(`Saved scenario "${record.name}" v${record.version}`, (d) => {
      d.scenarios = [...(d.scenarios ?? []), record];
    });
    setName('');
  };

  return (
    <Panel className="mt-7" title="Saved scenarios" description="Saved with the project and visible to everyone who opens it. Saving under an existing name adds a new version.">
      <ReadOnlyNote show={!canSave} what="save or delete scenarios" />
      <div className="flex flex-wrap items-end gap-2">
        <Field label="Scenario name" htmlFor="sc-name" className="flex-1 min-w-[200px]">
          <TextInput id="sc-name" value={name} placeholder={defaultName} disabled={!canSave} onChange={setName} />
        </Field>
        <Button variant="primary" disabled={!canSave} onClick={save}>
          Save as version {nextVersion}
        </Button>
      </div>
      <p className="text-[12.5px] text-ink-3 mt-1.5">{describe(current, r)}</p>

      {saved.length === 0 ? (
        <p className="text-sm text-ink-3 mt-4">No saved scenarios yet. Adjust the drivers or pick a preset, then save it to compare later.</p>
      ) : (
        <div className="scroll-x mt-4 -mx-4">
          <table className="dtable min-w-[640px]">
            <thead>
              <tr>
                <th className="!pl-4">Scenario</th>
                <th>Changes</th>
                <th>Saved</th>
                <th aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {saved.map((s) => (
                <tr key={s.id}>
                  <td className="!pl-4 font-semibold whitespace-nowrap">
                    {s.name} <span className="text-ink-3 font-normal">v{s.version}</span>
                  </td>
                  <td className="text-[12.5px] text-ink-2 max-w-[360px]">{describe(s.overrides, r)}</td>
                  <td className="text-[12.5px] text-ink-3 whitespace-nowrap">
                    {dateTime(s.createdAt)}
                    <div>{s.author}</div>
                  </td>
                  <td className="r whitespace-nowrap !pr-4">
                    <Button size="sm" onClick={() => onLoad(s)}>
                      Load
                    </Button>
                    <Button size="sm" variant="ghost" className="ml-1" aria-label={`Delete ${s.name} v${s.version}`} title="Delete scenario" disabled={!canSave} onClick={() => setToDelete(s)}>
                      <Trash2 size={15} />
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Modal
        open={!!toDelete}
        onClose={() => setToDelete(null)}
        title="Delete saved scenario?"
        footer={
          <>
            <Button onClick={() => setToDelete(null)}>Cancel</Button>
            <Button
              variant="danger"
              onClick={() => {
                const s = toDelete;
                if (s) update(`Deleted scenario "${s.name}" v${s.version}`, (d) => void (d.scenarios = d.scenarios.filter((x) => x.id !== s.id)));
                setToDelete(null);
              }}
            >
              Delete scenario
            </Button>
          </>
        }
      >
        {toDelete && (
          <p className="text-sm text-ink-2">
            "{toDelete.name}" version {toDelete.version} will be removed from the project for everyone. Other versions are kept.
          </p>
        )}
      </Modal>
    </Panel>
  );
}
