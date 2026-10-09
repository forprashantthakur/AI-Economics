import { useMemo, useRef, useState } from 'react';
import { Copy, Download, FolderOpen, Pin, Plus, Search, Trash2, Upload } from 'lucide-react';
import { uid, type Project } from '@aies/engine';
import { Badge, Button, Callout, Empty, Modal, PageHeader, Panel, Segmented, cx } from '../components/ui';
import { compact, count, n, pct, periodLabel } from '../lib/format';
import { href, navigate } from '../lib/router';
import { useCan, usePortfolio, useStore } from '../state/store';
import { STATUS_LABEL } from './dashboard/Portfolio';
import { IconButton, exportProject, readFileText, shortDate } from './projects/common';
import { duplicateProject, validateImportedProject } from './projects/ops';

type StatusFilter = 'all' | Project['status'];

export function Projects() {
  const { state, dispatch } = useStore();
  const portfolio = usePortfolio();
  const canCreate = useCan('project.create');
  const canDelete = useCan('project.delete');
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<StatusFilter>('all');
  const [confirmDelete, setConfirmDelete] = useState<Project | null>(null);
  const [notice, setNotice] = useState<{ tone: 'brand' | 'bad'; title: string; lines: string[] } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return portfolio.filter(({ project: p }) => (status === 'all' || p.status === status) && (!q || [p.name, p.client.clientName, p.client.industry, p.owner].some((s) => s?.toLowerCase().includes(q))));
  }, [portfolio, query, status]);

  const live = state.projects.filter((p) => p.status === 'live').length;

  const duplicate = (p: Project) => {
    const copy = duplicateProject(p);
    dispatch({ type: 'addProject', project: copy, action: 'Duplicated project' });
    setNotice({ tone: 'brand', title: `Created "${copy.name}"`, lines: ['The copy is a pre-sales estimate without actuals and is now the selected project.'] });
  };

  const onImport = async (file: File | undefined) => {
    if (!file) return;
    if (fileRef.current) fileRef.current.value = '';
    let raw: unknown;
    try {
      raw = JSON.parse(await readFileText(file));
    } catch {
      setNotice({ tone: 'bad', title: `"${file.name}" is not valid JSON`, lines: ['Choose a file exported with Export JSON on this page.'] });
      return;
    }
    const { errors, project } = validateImportedProject(raw, state.catalog);
    if (!project) {
      setNotice({ tone: 'bad', title: `"${file.name}" could not be imported`, lines: errors });
      return;
    }
    const lines: string[] = [];
    if (state.projects.some((p) => p.id === project.id)) {
      const old = project.id;
      project.id = uid('p');
      lines.push(`A project with id "${old}" already exists, so the import was given the new id "${project.id}".`);
    }
    dispatch({ type: 'addProject', project, action: 'Imported project' });
    setNotice({ tone: 'brand', title: `Imported "${project.name}"`, lines: [...lines, 'It is now the selected project.'] });
  };

  return (
    <div>
      <PageHeader
        title="Projects"
        description="Every engagement in the studio, from pre-sales estimates to live deployments with monitored actuals. Open a project to edit its scope, workflows and actuals."
        actions={
          <>
            <input ref={fileRef} type="file" accept="application/json,.json" className="sr-only" aria-label="Import project JSON file" onChange={(e) => onImport(e.target.files?.[0])} tabIndex={-1} />
            <Button icon={<Upload size={15} />} onClick={() => fileRef.current?.click()} disabled={!canCreate} title={canCreate ? 'Import a project exported as JSON' : 'Your role cannot create projects'}>
              Import project JSON
            </Button>
            <Button className="!text-brand-ink" variant="primary" icon={<Plus size={15} />} onClick={() => navigate('new-project')} disabled={!canCreate} title={canCreate ? undefined : 'Your role cannot create projects'}>
              New project
            </Button>
          </>
        }
      />

      {notice && (
        <div className="mb-4">
          <Callout tone={notice.tone} title={notice.title}>
            {notice.lines.length > 1 ? (
              <ul className="list-disc pl-5 space-y-0.5">
                {notice.lines.map((l, i) => (
                  <li key={i}>{l}</li>
                ))}
              </ul>
            ) : (
              notice.lines[0]
            )}
            <div className="mt-1.5">
              <button type="button" className="!text-[13px] !font-semibold !text-ink-2 hover:!text-ink underline underline-offset-2" onClick={() => setNotice(null)}>
                Dismiss
              </button>
            </div>
          </Callout>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3 mb-4">
        <div className="relative w-full sm:w-[300px]">
          <Search size={15} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-3 pointer-events-none" aria-hidden />
          <input className="field !pl-8" placeholder="Search name, client, industry or owner" aria-label="Search projects" value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
        <div className="max-w-full overflow-x-auto">
          <Segmented<StatusFilter>
            ariaLabel="Filter by status"
            value={status}
            onChange={setStatus}
            options={[
              { id: 'all', label: `All (${state.projects.length})` },
              { id: 'pre_sales', label: 'Pre-sales' },
              { id: 'in_delivery', label: 'In delivery' },
              { id: 'live', label: `Live (${live})` },
            ]}
          />
        </div>
      </div>

      <Panel padded={false}>
        {state.projects.length === 0 ? (
          <Empty
            title="No projects yet"
            body="Start a pre-sales estimate with the intake wizard, or import a project exported from another workspace."
            action={
              <Button className="!text-brand-ink" variant="primary" icon={<Plus size={15} />} onClick={() => navigate('new-project')} disabled={!canCreate}>
                New project
              </Button>
            }
          />
        ) : rows.length === 0 ? (
          <Empty title="No projects match" body="Clear the search or choose another status." action={<Button onClick={() => (setQuery(''), setStatus('all'))}>Clear filters</Button>} />
        ) : (
          <div className="scroll-x">
            <table className="dtable min-w-[880px]">
              <thead>
                <tr>
                  <th>Project</th>
                  <th className="hidden 2xl:table-cell">Industry</th>
                  <th>Status</th>
                  <th className="hidden 2xl:table-cell">Currency</th>
                  <th className="r">Volume / month</th>
                  <th>Go-live</th>
                  <th className="hidden 2xl:table-cell">Updated</th>
                  <th className="r">Run cost / month</th>
                  <th className="r">Contract value</th>
                  <th className="r">Client ROI</th>
                  <th className="r">Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(({ project: p, result: r }) => {
                  const current = p.id === state.currentProjectId;
                  const roi = n(r.economics.client.roiPct);
                  return (
                    <tr key={p.id} className={cx(current && '[&>td]:bg-brand-tint')}>
                      <td className="min-w-[220px] max-w-[300px]">
                        <a href={href('project', p.id, 'overview')} className="font-semibold text-ink hover:text-brand hover:underline underline-offset-2">
                          {p.name}
                        </a>
                        <div className="text-[12.5px] text-ink-3 truncate">
                          {current && <span className="font-semibold text-brand">Current project, </span>}
                          {p.client.clientName}
                        </div>
                      </td>
                      <td className="text-[13px] text-ink-2 max-w-[150px] hidden 2xl:table-cell">{p.client.industry || '—'}</td>
                      <td>
                        <Badge tone={STATUS_LABEL[p.status].tone}>{STATUS_LABEL[p.status].label}</Badge>
                      </td>
                      <td className="text-[13px] text-ink-2 hidden 2xl:table-cell">{p.currency}</td>
                      <td className="r">{count(r.baseline.totals.attempted, p.currency)}</td>
                      <td className="text-[13px] num whitespace-nowrap">{periodLabel(p.goLiveDate)}</td>
                      <td className="text-[13px] text-ink-2 num whitespace-nowrap hidden 2xl:table-cell">{shortDate(p.updatedAt)}</td>
                      <td className="r">{compact(r.baseline.totalRunCost, p.currency)}</td>
                      <td className="r">{compact(r.economics.provider.tcv, p.currency)}</td>
                      <td className={cx('r', roi < 0 && 'text-bad')}>{pct(roi, 0)}</td>
                      <td className="r whitespace-nowrap">
                        <div className="inline-flex items-center gap-0.5">
                          <IconButton label={`Open ${p.name}`} onClick={() => navigate('project', p.id, 'overview')}>
                            <FolderOpen size={15} />
                          </IconButton>
                          <IconButton label={current ? 'This is the current project' : 'Set as current project'} disabled={current} onClick={() => dispatch({ type: 'setCurrent', id: p.id })}>
                            <Pin size={15} />
                          </IconButton>
                          <IconButton label="Duplicate project" disabled={!canCreate} onClick={() => duplicate(p)}>
                            <Copy size={15} />
                          </IconButton>
                          <IconButton label="Export project JSON" onClick={() => exportProject(p)}>
                            <Download size={15} />
                          </IconButton>
                          <IconButton
                            label={!canDelete ? 'Your role cannot delete projects' : state.projects.length <= 1 ? 'Keep at least one project' : 'Delete project'}
                            tone="bad"
                            disabled={!canDelete || state.projects.length <= 1}
                            onClick={() => setConfirmDelete(p)}
                          >
                            <Trash2 size={15} />
                          </IconButton>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
      <p className="text-[12.5px] text-ink-3 mt-2">Volumes and run cost are steady-state months after ramp-up; contract value and ROI cover the full term. Each project is shown in its own currency.</p>

      <Modal
        open={!!confirmDelete}
        onClose={() => setConfirmDelete(null)}
        title="Delete project"
        footer={
          <>
            <Button onClick={() => setConfirmDelete(null)}>Cancel</Button>
            <Button className="!text-bad"
              variant="danger"
              icon={<Trash2 size={15} />}
              onClick={() => {
                if (confirmDelete) dispatch({ type: 'deleteProject', id: confirmDelete.id });
                setConfirmDelete(null);
              }}
            >
              Delete project
            </Button>
          </>
        }
      >
        {confirmDelete && (
          <div className="space-y-3 text-sm text-ink-2">
            <p>
              Delete <span className="font-semibold text-ink">{confirmDelete.name}</span> for {confirmDelete.client.clientName}? Its workflows, pricing, value model
              {confirmDelete.actuals.length ? `, ${confirmDelete.actuals.length} actual records` : ''} and saved scenarios are removed. This cannot be undone.
            </p>
            <Callout>Export the project JSON first if you may need it again. The deletion is recorded in the audit log.</Callout>
            <Button size="sm" icon={<Download size={14} />} onClick={() => exportProject(confirmDelete)}>
              Export JSON first
            </Button>
          </div>
        )}
      </Modal>
    </div>
  );
}
