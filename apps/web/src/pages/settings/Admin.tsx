import { useMemo, useRef, useState } from 'react';
import { Check, Download, RotateCcw, Search, Upload } from 'lucide-react';
import { PERMISSIONS, ROLES, ROLE_LABELS, can, type Permission, type RoleName } from '@aies/engine';
import { Button, Callout, Empty, Field, Modal, Panel, Select, TextInput, cx } from '../../components/ui';
import { dateTime } from '../../lib/format';
import { initialState, useCan, useStore, type AppState } from '../../state/store';
import { FieldError, csvCell, downloadFile, readFileText } from '../projects/common';

const PERMISSION_LABEL: Record<Permission, string> = {
  'project.create': 'Create and import projects',
  'project.edit': 'Edit project scope, workflows and agents',
  'project.delete': 'Delete projects',
  'implementation.edit': 'Edit the implementation plan',
  'tokenomics.edit': 'Edit LLM steps and tokenomics',
  'pricing.edit': 'Edit commercial pricing',
  'ratecard.approve': 'Approve rate card versions',
  'value.edit': 'Edit the value model',
  'benefit.validate': 'Validate benefits (Finance sign-off)',
  'catalog.edit': 'Edit rate cards, FX, ACU weights and templates',
  'actuals.edit': 'Record post-deployment actuals',
  'scenario.save': 'Save scenarios',
  'report.export': 'Export reports and data',
  'audit.view': 'View the audit log',
  'user.manage': 'Manage users and roles',
};

// ───────────────────────────── Users & roles ─────────────────────────────

export function UsersTab() {
  const { state, dispatch } = useStore();
  const [name, setName] = useState(state.user.name);
  const [email, setEmail] = useState(state.user.email);
  const [err, setErr] = useState<{ name?: string; email?: string }>({});
  const [saved, setSaved] = useState(false);
  const save = () => {
    const e: typeof err = {};
    if (!name.trim()) e.name = 'Enter a name; it is recorded on every audit entry.';
    if (email.trim() && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim())) e.email = 'Enter a valid email address, or leave it empty.';
    setErr(e);
    if (Object.keys(e).length) return;
    dispatch({ type: 'setUser', name: name.trim(), email: email.trim() });
    dispatch({ type: 'audit', action: 'Updated user profile', detail: `${state.user.name} to ${name.trim()}`, projectId: null });
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };
  return (
    <div className="space-y-5">
      <div className="grid gap-5 xl:grid-cols-[1fr_1.4fr]">
        <Panel title="Current user" description="This workspace runs locally for one user at a time. The name and role are stamped on every audit entry.">
          <div className="grid gap-4">
            <Field label="Name" htmlFor="u-name">
              <TextInput id="u-name" value={name} onChange={setName} />
              <FieldError>{err.name}</FieldError>
            </Field>
            <Field label="Email" htmlFor="u-email">
              <TextInput id="u-email" value={email} onChange={setEmail} />
              <FieldError>{err.email}</FieldError>
            </Field>
            <Field label="Role" htmlFor="u-role" hint="Controls what you can edit. Also available in the top bar.">
              <Select<RoleName> id="u-role" value={state.user.role} onChange={(r) => dispatch({ type: 'setRole', role: r })} options={ROLES.map((r) => ({ value: r, label: ROLE_LABELS[r] }))} />
            </Field>
            <div className="flex items-center gap-3">
              <Button className="!text-brand-ink" variant="primary" onClick={save} disabled={name === state.user.name && email === state.user.email}>
                Save profile
              </Button>
              {saved && <span className="text-[13px] text-good font-semibold">Saved</span>}
            </div>
          </div>
        </Panel>
        <Panel title="How roles work">
          <ul className="space-y-2 text-[14px] text-ink-2">
            <li>
              <span className="font-semibold text-ink">Consultants and solution architects</span> build estimates: projects, implementation plans and (architects) tokenomics.
            </li>
            <li>
              <span className="font-semibold text-ink">Finance</span> owns the catalogue (rates, FX, ACU weights), approves rate cards, validates benefits and can see the audit log.
            </li>
            <li>
              <span className="font-semibold text-ink">AI Engineering</span> tunes tokenomics and records post-deployment actuals.
            </li>
            <li>
              <span className="font-semibold text-ink">Business leaders</span> view and export only.
            </li>
          </ul>
          <p className="text-[12.5px] text-ink-3 mt-3">The same permission matrix is enforced by the API server when this workspace is connected to it (Settings → Data).</p>
        </Panel>
      </div>

      <Panel title="Permission matrix" description={`What each role can do. Your current role is ${ROLE_LABELS[state.user.role]}.`} padded={false}>
        <div className="scroll-x">
          <table className="dtable min-w-[920px]">
            <thead>
              <tr>
                <th>Permission</th>
                {ROLES.map((r) => (
                  <th key={r} className={cx('text-center', r === state.user.role && '!text-brand')}>
                    {ROLE_LABELS[r]}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {PERMISSIONS.map((p) => (
                <tr key={p}>
                  <td>
                    <div className="text-[14px] text-ink">{PERMISSION_LABEL[p]}</div>
                    <code className="text-[12px] text-ink-3">{p}</code>
                  </td>
                  {ROLES.map((r) => (
                    <td key={r} className={cx('text-center', r === state.user.role && 'bg-brand-tint')}>
                      {can(r, p) ? <Check size={16} className="inline text-good" aria-label="Allowed" /> : <span className="text-ink-3" aria-label="Not allowed">—</span>}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </div>
  );
}

// ───────────────────────────── Audit log ─────────────────────────────

export function AuditTab() {
  const { state } = useStore();
  const allowed = useCan('audit.view');
  const [project, setProject] = useState('all');
  const [q, setQ] = useState('');
  const names = useMemo(() => new Map(state.projects.map((p) => [p.id, p.name])), [state.projects]);
  const rows = useMemo(() => {
    const s = q.trim().toLowerCase();
    return state.audit.filter(
      (a) =>
        (project === 'all' || (project === 'none' ? a.projectId === null : a.projectId === project)) &&
        (!s || `${a.user} ${a.action} ${a.detail} ${names.get(a.projectId ?? '') ?? ''}`.toLowerCase().includes(s)),
    );
  }, [state.audit, project, q, names]);

  if (!allowed) {
    const who = ROLES.filter((r) => can(r, 'audit.view')).map((r) => ROLE_LABELS[r]);
    return (
      <Panel title="Audit log">
        <Empty title="Your role cannot view the audit log" body={`The audit log is visible to ${who.join(' and ')}. Switch role in the top bar if you hold one of these roles. Your own changes to a project are listed in that project's History tab.`} />
      </Panel>
    );
  }
  const exportCsv = () => {
    const lines = [['time', 'user', 'role', 'project', 'action', 'detail'].join(','), ...rows.map((a) => [a.at, a.user, a.role, a.projectId ? names.get(a.projectId) ?? a.projectId : '', a.action, a.detail].map(csvCell).join(','))];
    downloadFile('audit-log.csv', lines.join('\n'), 'text/csv');
  };
  return (
    <Panel
      title="Audit log"
      description="Every change to projects, the catalogue, templates and roles, newest first. The latest 500 entries are kept."
      padded={false}
      actions={
        <Button size="sm" icon={<Download size={14} />} onClick={exportCsv} disabled={!rows.length}>
          Export CSV
        </Button>
      }
    >
      <div className="px-4 pb-3 flex flex-wrap gap-3">
        <div className="w-full sm:w-[260px]">
          <Select
            ariaLabel="Filter by project"
            value={project}
            onChange={setProject}
            options={[{ value: 'all', label: 'All projects and settings' }, { value: 'none', label: 'Settings and catalogue only' }, ...state.projects.map((p) => ({ value: p.id, label: p.name }))]}
          />
        </div>
        <div className="relative w-full sm:w-[280px]">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-3 pointer-events-none" aria-hidden />
          <input className="field !pl-8" placeholder="Search user, action or detail" aria-label="Search audit log" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <span className="self-center text-[13px] text-ink-3 num">
          {rows.length} of {state.audit.length} entries
        </span>
      </div>
      {rows.length === 0 ? (
        <Empty title="No entries match" body="Change the project filter or search term." />
      ) : (
        <div className="scroll-x max-h-[640px] overflow-y-auto">
          <table className="dtable min-w-[980px]">
            <thead>
              <tr>
                <th>Time</th>
                <th>User</th>
                <th>Role</th>
                <th>Project</th>
                <th>Action</th>
                <th>Detail</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((a) => (
                <tr key={a.id}>
                  <td className="text-[13px] num whitespace-nowrap">{dateTime(a.at)}</td>
                  <td className="text-[13.5px] font-semibold whitespace-nowrap">{a.user}</td>
                  <td className="text-[13px] text-ink-2 whitespace-nowrap">{ROLE_LABELS[a.role] ?? a.role}</td>
                  <td className="text-[13px] text-ink-2">{a.projectId ? names.get(a.projectId) ?? <span className="text-ink-3">Deleted ({a.projectId})</span> : <span className="text-ink-3">Settings</span>}</td>
                  <td className="text-[13.5px]">{a.action}</td>
                  <td className="text-[13px] text-ink-2 max-w-[420px]">{a.detail}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}

// ───────────────────────────── Data ─────────────────────────────

function validateState(raw: unknown): string[] {
  const e: string[] = [];
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return ['The file does not contain an app state object.'];
  const s = raw as Record<string, unknown>;
  if (s.version !== 1) e.push(`Unsupported version ${JSON.stringify(s.version)}; this studio reads version 1 exports.`);
  if (!Array.isArray(s.projects)) e.push('"projects" must be a list.');
  else if (!s.projects.length) e.push('"projects" is empty; the studio needs at least one project.');
  else (s.projects as Record<string, unknown>[]).forEach((p, i) => (!p || typeof p.id !== 'string' || !Array.isArray(p.workflows)) && e.push(`Project ${i + 1} is missing an id or workflows.`));
  const c = s.catalog as Record<string, unknown> | undefined;
  if (!c || typeof c !== 'object') e.push('"catalog" is missing.');
  else {
    for (const k of ['modelRates', 'acuWeightSets', 'cloudPrices'] as const) if (!Array.isArray(c[k])) e.push(`"catalog.${k}" must be a list.`);
    if (!c.fx || typeof c.fx !== 'object' || typeof (c.fx as Record<string, unknown>).rates !== 'object') e.push('"catalog.fx" with rates is missing.');
  }
  for (const k of ['customTemplates', 'customIndustries', 'customFunctions', 'audit'] as const) if (s[k] !== undefined && !Array.isArray(s[k])) e.push(`"${k}" must be a list.`);
  return e;
}

export function DataTab() {
  const { state, dispatch } = useStore();
  const canExport = useCan('report.export');
  const isAdmin = useCan('user.manage');
  const fileRef = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState<{ name: string; state: AppState } | null>(null);
  const [errors, setErrors] = useState<{ file: string; list: string[] } | null>(null);
  const [reset, setReset] = useState(false);
  const [done, setDone] = useState('');

  const exportAll = () => {
    downloadFile(`ai-economics-studio-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(state, null, 2));
    dispatch({ type: 'audit', action: 'Exported app state', detail: `${state.projects.length} projects`, projectId: null });
  };
  const onFile = async (f?: File) => {
    if (!f) return;
    if (fileRef.current) fileRef.current.value = '';
    setDone('');
    let raw: unknown;
    try {
      raw = JSON.parse(await readFileText(f));
    } catch {
      setErrors({ file: f.name, list: ['The file is not valid JSON. Choose a file exported with Export state.'] });
      return;
    }
    const list = validateState(raw);
    if (list.length) return setErrors({ file: f.name, list });
    setErrors(null);
    const s = raw as AppState;
    const base = initialState();
    setPending({
      name: f.name,
      state: {
        ...base,
        ...s,
        customTemplates: s.customTemplates ?? [],
        customIndustries: s.customIndustries ?? [],
        customFunctions: s.customFunctions ?? [],
        audit: s.audit ?? [],
        user: s.user ?? state.user,
        theme: s.theme ?? state.theme,
        currentProjectId: s.projects.some((p) => p.id === s.currentProjectId) ? s.currentProjectId : s.projects[0].id,
      },
    });
  };

  return (
    <div className="space-y-5">
      <div className="grid gap-5 xl:grid-cols-3">
        <Panel title="Export state" description="Download everything (projects, catalogue, templates, lists, user and audit log) as one JSON file.">
          <p className="text-[13.5px] text-ink-2 mb-3">
            {state.projects.length} projects, {state.catalog.modelRates.length} model rates, {state.customTemplates.length} custom templates, {state.audit.length} audit entries.
          </p>
          <Button className="!text-brand-ink" variant="primary" icon={<Download size={15} />} onClick={exportAll} disabled={!canExport}>
            Export state
          </Button>
        </Panel>
        <Panel title="Import state" description="Replace the whole workspace with a previously exported file. Export first if you want to keep the current data.">
          <input ref={fileRef} type="file" accept="application/json,.json" className="sr-only" tabIndex={-1} aria-label="State JSON file" onChange={(e) => onFile(e.target.files?.[0])} />
          <Button icon={<Upload size={15} />} onClick={() => fileRef.current?.click()} disabled={!isAdmin} title={isAdmin ? undefined : 'Only administrators can replace the workspace'}>
            Import state JSON
          </Button>
          {!isAdmin && <p className="text-[12.5px] text-ink-3 mt-2">Only administrators can replace the workspace.</p>}
          {done && <p className="text-[13px] text-good font-semibold mt-2">{done}</p>}
        </Panel>
        <Panel title="Reset to sample data" description="Restore the three illustrative projects and the sample rate cards. All current data is replaced.">
          <Button className="!text-bad" variant="danger" icon={<RotateCcw size={15} />} onClick={() => setReset(true)} disabled={!isAdmin}>
            Reset to sample data
          </Button>
          {!isAdmin && <p className="text-[12.5px] text-ink-3 mt-2">Only administrators can reset the workspace.</p>}
        </Panel>
      </div>

      {errors && (
        <Callout tone="bad" title={`"${errors.file}" cannot be imported`}>
          <ul className="list-disc pl-5 space-y-0.5">
            {errors.list.map((e, i) => (
              <li key={i}>{e}</li>
            ))}
          </ul>
        </Callout>
      )}

      <Callout>
        Data is stored in this browser only. Clearing site data, a private window or another device starts from the sample data. Export regularly, or connect to the studio server above for shared PostgreSQL storage. Individual projects can be
        exported and imported from the Projects page.
      </Callout>

      <Modal
        open={!!pending}
        onClose={() => setPending(null)}
        title="Replace workspace"
        footer={
          <>
            <Button onClick={() => setPending(null)}>Cancel</Button>
            <Button className="!text-bad"
              variant="danger"
              onClick={() => {
                if (!pending) return;
                dispatch({ type: 'replace', state: pending.state });
                dispatch({ type: 'audit', action: 'Imported app state', detail: `${pending.name}: ${pending.state.projects.length} projects`, projectId: null });
                setDone(`Imported ${pending.state.projects.length} projects from ${pending.name}.`);
                setPending(null);
              }}
            >
              Replace workspace
            </Button>
          </>
        }
      >
        {pending && (
          <div className="space-y-3 text-sm text-ink-2">
            <p>
              Replace the current workspace ({state.projects.length} projects) with <span className="font-semibold text-ink">{pending.name}</span>?
            </p>
            <ul className="list-disc pl-5">
              <li>{pending.state.projects.length} projects: {pending.state.projects.map((p) => p.name).slice(0, 5).join(', ')}
                {pending.state.projects.length > 5 ? ', …' : ''}</li>
              <li>{pending.state.catalog.modelRates.length} model rates, {pending.state.catalog.cloudPrices.length} cloud prices</li>
              <li>{pending.state.audit.length} audit entries</li>
            </ul>
            <Callout tone="warn">Current data that has not been exported is lost.</Callout>
          </div>
        )}
      </Modal>

      <Modal
        open={reset}
        onClose={() => setReset(false)}
        title="Reset to sample data"
        footer={
          <>
            <Button onClick={() => setReset(false)}>Cancel</Button>
            <Button className="!text-bad"
              variant="danger"
              icon={<RotateCcw size={15} />}
              onClick={() => {
                const s = initialState();
                s.user = { ...s.user, name: state.user.name, email: state.user.email, role: state.user.role };
                s.theme = state.theme;
                dispatch({ type: 'replace', state: s });
                dispatch({ type: 'audit', action: 'Reset to sample data', detail: `Replaced ${state.projects.length} projects`, projectId: null });
                setReset(false);
                setDone('Sample data restored.');
              }}
            >
              Reset workspace
            </Button>
          </>
        }
      >
        <div className="space-y-3 text-sm text-ink-2">
          <p>
            Replace all {state.projects.length} projects, the catalogue, custom templates and the audit log with the illustrative sample data? Your name, role and theme are kept.
          </p>
          <Callout tone="warn">This cannot be undone. Export state first if you may need the current data.</Callout>
          <Button size="sm" icon={<Download size={14} />} onClick={exportAll} disabled={!canExport}>
            Export state first
          </Button>
        </div>
      </Modal>
    </div>
  );
}
