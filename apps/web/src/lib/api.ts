/**
 * Client for the studio API (apps/api). When the workspace is connected to a server,
 * projects and the catalogue are loaded from PostgreSQL, every edit is saved as a new
 * project version (optimistic concurrency), the role comes from the signed-in user and
 * the audit log is read from the server. Calculations still run locally with the same engine.
 */
import type { Catalog, Project, RoleName } from '@aies/engine';

export interface ServerSession {
  url: string; // '' = same origin (Vite dev proxy or nginx)
  token: string;
  expiresAt?: string;
  user: { id: string; email: string; name: string; role: RoleName };
}

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

function base(url: string): string {
  return url.replace(/\/+$/, '') + '/api';
}

export async function api<T>(session: Pick<ServerSession, 'url' | 'token'> | { url: string; token?: string }, path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(base(session.url) + path, {
      method: init.method ?? 'GET',
      headers: {
        ...(init.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...('token' in session && session.token ? { Authorization: `Bearer ${session.token}` } : {}),
      },
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    });
  } catch {
    throw new ApiError(0, 'NETWORK', `Cannot reach the server at ${session.url || window.location.origin}. Check the address and that the API is running.`);
  }
  const text = await res.text();
  const json = text ? (JSON.parse(text) as unknown) : null;
  if (!res.ok) {
    const err = (json as { error?: { code?: string; message?: string } } | null)?.error;
    throw new ApiError(res.status, err?.code ?? `HTTP_${res.status}`, err?.message ?? `The server answered ${res.status}.`);
  }
  return json as T;
}

export async function login(url: string, email: string, password: string): Promise<ServerSession> {
  const r = await api<{ token: string; expiresAt?: string; user: ServerSession['user'] }>({ url }, '/auth/login', { method: 'POST', body: { email, password } });
  return { url, token: r.token, expiresAt: r.expiresAt, user: { id: r.user.id, email: r.user.email, name: r.user.name, role: r.user.role } };
}

export interface ServerWorkspace {
  projects: Project[];
  versions: Record<string, number>;
  catalog: Catalog;
}

export async function pullWorkspace(s: ServerSession): Promise<ServerWorkspace> {
  const list = await api<{ projects: { id: string }[] } | { id: string }[]>(s, '/projects');
  const items = Array.isArray(list) ? list : list.projects;
  const full = await Promise.all(items.map((p) => api<{ project: Project; meta: { version: number } }>(s, `/projects/${encodeURIComponent(p.id)}`)));
  const catalog = await api<Catalog>(s, '/catalog');
  return {
    projects: full.map((f) => f.project),
    versions: Object.fromEntries(full.map((f) => [f.project.id, f.meta.version])),
    catalog,
  };
}

export async function fetchProject(s: ServerSession, id: string) {
  return api<{ project: Project; meta: { version: number } }>(s, `/projects/${encodeURIComponent(id)}`);
}

export async function saveProject(s: ServerSession, project: Project, baseVersion: number, comment: string) {
  return api<{ project: Project; meta: { version: number } }>(s, `/projects/${encodeURIComponent(project.id)}`, { method: 'PUT', body: { project, baseVersion, comment } });
}

export async function createProject(s: ServerSession, project: Project) {
  return api<{ project: Project; meta: { version: number } }>(s, '/projects', { method: 'POST', body: project });
}

export async function deleteProject(s: ServerSession, id: string) {
  return api<unknown>(s, `/projects/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

export interface ServerAuditRow {
  id: string | number;
  at: string;
  userEmail?: string | null;
  user_email?: string | null;
  role?: string | null;
  action: string;
  entityType?: string | null;
  projectId?: string | null;
  project_id?: string | null;
  outcome?: string | null;
  detail?: unknown;
}

export async function fetchAudit(s: ServerSession, projectId?: string): Promise<ServerAuditRow[]> {
  const q = new URLSearchParams({ limit: '500', ...(projectId ? { projectId } : {}) });
  const r = await api<{ entries?: ServerAuditRow[]; rows?: ServerAuditRow[] } | ServerAuditRow[]>(s, `/audit?${q}`);
  return Array.isArray(r) ? r : r.entries ?? r.rows ?? [];
}
