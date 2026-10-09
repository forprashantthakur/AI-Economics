import { useEffect, useState } from 'react';
import { Cloud, LogOut, RefreshCw } from 'lucide-react';
import { ROLE_LABELS } from '@aies/engine';
import { Button, Callout, Field, KeyValues, Panel, TextInput } from '../../components/ui';
import { ApiError, fetchAudit, login, pullWorkspace, type ServerAuditRow } from '../../lib/api';
import { useStore } from '../../state/store';
import { dateTime } from '../../lib/format';

/** Connect the browser workspace to the API server (PostgreSQL storage, server-side RBAC and audit). */
export function ServerPanel() {
  const { state, dispatch } = useStore();
  const [url, setUrl] = useState(state.server?.url ?? '');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const connect = async () => {
    setBusy(true);
    setError(null);
    try {
      const session = await login(url.trim(), email.trim(), password);
      const ws = await pullWorkspace(session);
      dispatch({ type: 'connect', session, projects: ws.projects, versions: ws.versions, catalog: ws.catalog });
      setPassword('');
    } catch (e) {
      setError(e instanceof ApiError ? e.message : (e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const reload = async () => {
    if (!state.server) return;
    setBusy(true);
    setError(null);
    try {
      const ws = await pullWorkspace(state.server);
      dispatch({ type: 'connect', session: state.server, projects: ws.projects, versions: ws.versions, catalog: ws.catalog });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (state.server) {
    const s = state.server;
    return (
      <Panel
        title="Connected to the studio server"
        description="Projects and rate cards are stored in PostgreSQL. Every edit is saved as a new project version, the server enforces your role, and the audit log is the server's."
        actions={
          <>
            <Button size="sm" icon={<RefreshCw size={14} />} onClick={reload} disabled={busy}>
              Reload from server
            </Button>
            <Button size="sm" icon={<LogOut size={14} />} onClick={() => dispatch({ type: 'disconnect' })}>
              Disconnect
            </Button>
          </>
        }
      >
        <KeyValues
          rows={[
            ['Server', s.url || window.location.origin],
            ['Signed in as', `${s.user.name} (${s.user.email})`],
            ['Role', ROLE_LABELS[s.user.role]],
            ['Projects on server', String(Object.keys(state.serverVersions ?? {}).length)],
            ['Session expires', s.expiresAt ? dateTime(s.expiresAt) : 'When the token expires'],
          ]}
        />
        {error && (
          <div className="mt-3">
            <Callout tone="bad">{error}</Callout>
          </div>
        )}
      </Panel>
    );
  }

  return (
    <Panel
      title="Connect to the studio server"
      description="Sign in to the API server to store projects in PostgreSQL with version history, server-enforced roles and a shared audit log. The server's projects and rate cards replace this browser's workspace; export it first if you want to keep it."
    >
      <form
        className="grid gap-3 sm:grid-cols-3 items-end"
        onSubmit={(e) => {
          e.preventDefault();
          void connect();
        }}
      >
        <Field label="Server address" hint="Leave empty when the app is served by the studio itself (Docker or the dev proxy)." htmlFor="srv-url">
          <TextInput id="srv-url" value={url} onChange={setUrl} placeholder="https://studio.example.com" />
        </Field>
        <Field label="Email" htmlFor="srv-email">
          <input id="srv-email" className="field" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>
        <Field label="Password" htmlFor="srv-pass">
          <input id="srv-pass" className="field" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
        <div className="sm:col-span-3 flex flex-wrap items-center gap-3">
          <Button type="submit" variant="primary" icon={<Cloud size={15} />} disabled={busy || !email || !password}>
            {busy ? 'Connecting…' : 'Connect and load workspace'}
          </Button>
          <span className="text-[12.5px] text-ink-3">A fresh server seeds demo users such as admin@demo.local; the password is set by SEED_PASSWORD.</span>
        </div>
      </form>
      {error && (
        <div className="mt-3">
          <Callout tone="bad">{error}</Callout>
        </div>
      )}
    </Panel>
  );
}

/** The server's audit log (shown instead of the browser log while connected). */
export function ServerAuditTable() {
  const { state } = useStore();
  const [rows, setRows] = useState<ServerAuditRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [projectId, setProjectId] = useState('');
  useEffect(() => {
    if (!state.server) return;
    let live = true;
    fetchAudit(state.server, projectId || undefined)
      .then((r) => live && setRows(r))
      .catch((e) => live && setError((e as Error).message));
    return () => {
      live = false;
    };
  }, [state.server, projectId]);
  return (
    <Panel
      title="Server audit log"
      description="Append-only log kept by the API: every change, refused request and sign-in, with user, role, outcome and IP."
      padded={false}
      actions={
        <select className="field !w-auto text-[13px]" aria-label="Filter by project" value={projectId} onChange={(e) => setProjectId(e.target.value)}>
          <option value="">All projects</option>
          {state.projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      }
    >
      {error ? (
        <div className="px-4 pb-4">
          <Callout tone="bad">{error}</Callout>
        </div>
      ) : !rows ? (
        <p className="px-4 pb-4 text-sm text-ink-3">Loading…</p>
      ) : (
        <div className="scroll-x">
          <table className="dtable min-w-[860px]">
            <thead>
              <tr>
                <th>Time</th>
                <th>User</th>
                <th>Role</th>
                <th>Action</th>
                <th>Outcome</th>
                <th>Project</th>
                <th>Detail</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={String(r.id)}>
                  <td className="whitespace-nowrap text-[13px]">{dateTime(r.at)}</td>
                  <td className="text-[13px]">{r.userEmail ?? r.user_email ?? 'Anonymous'}</td>
                  <td className="text-[13px]">{r.role ?? ''}</td>
                  <td className="text-[13px] font-semibold">{r.action}</td>
                  <td className="text-[13px]">{r.outcome ?? ''}</td>
                  <td className="text-[13px]">{state.projects.find((p) => p.id === (r.projectId ?? r.project_id))?.name ?? r.projectId ?? ''}</td>
                  <td className="text-[12px] text-ink-3 max-w-[320px] truncate" title={JSON.stringify(r.detail)}>
                    {r.detail ? JSON.stringify(r.detail) : ''}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}
