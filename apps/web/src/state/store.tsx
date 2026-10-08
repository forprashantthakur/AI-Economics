/**
 * Application state: projects, catalogue (rate cards), custom templates,
 * current user/role and the audit log. Persisted to browser storage when
 * available (wrapped in try/catch — the app works without it). When an API
 * URL is configured, lib/api.ts syncs the same objects to the server.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useReducer, type ReactNode } from 'react';
import {
  can,
  computeProject,
  defaultCatalog,
  PROCESS_TEMPLATES,
  sampleProjects,
  type Catalog,
  type Permission,
  type ProcessTemplate,
  type Project,
  type ProjectResult,
  type RoleName,
} from '@aies/engine';

export interface AuditEntry {
  id: string;
  at: string;
  user: string;
  role: RoleName;
  projectId: string | null;
  action: string;
  detail: string;
}

export interface AppState {
  version: 1;
  projects: Project[];
  catalog: Catalog;
  customTemplates: ProcessTemplate[];
  customIndustries: string[];
  customFunctions: string[];
  currentProjectId: string;
  user: { name: string; email: string; role: RoleName };
  audit: AuditEntry[];
  theme: 'system' | 'light' | 'dark';
}

const STORAGE_KEY = 'aies.state.v1';

export function initialState(): AppState {
  const catalog = defaultCatalog();
  const projects = sampleProjects(catalog);
  return {
    version: 1,
    projects,
    catalog,
    customTemplates: [],
    customIndustries: [],
    customFunctions: [],
    currentProjectId: projects[0].id,
    user: { name: 'Demo User', email: 'demo@example.com', role: 'admin' },
    audit: [
      {
        id: 'seed',
        at: new Date().toISOString(),
        user: 'System',
        role: 'admin',
        projectId: null,
        action: 'Loaded sample data',
        detail: 'Three illustrative projects and the sample rate cards were loaded.',
      },
    ],
    theme: 'system',
  };
}

function load(): AppState {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const s = JSON.parse(raw) as AppState;
      if (s && s.version === 1 && Array.isArray(s.projects) && s.catalog) return s;
    }
  } catch {
    /* storage unavailable or corrupt — start fresh */
  }
  return initialState();
}

type Action =
  | { type: 'replace'; state: AppState }
  | { type: 'updateProject'; id: string; project: Project; action: string; detail: string }
  | { type: 'addProject'; project: Project; action: string }
  | { type: 'deleteProject'; id: string }
  | { type: 'setCurrent'; id: string }
  | { type: 'updateCatalog'; catalog: Catalog; action: string; detail: string }
  | { type: 'setRole'; role: RoleName }
  | { type: 'setUser'; name: string; email: string }
  | { type: 'setTheme'; theme: AppState['theme'] }
  | { type: 'setTemplates'; templates: ProcessTemplate[]; action: string }
  | { type: 'setLists'; industries: string[]; functions: string[] }
  | { type: 'audit'; action: string; detail: string; projectId: string | null };

let seq = 0;
const entry = (s: AppState, action: string, detail: string, projectId: string | null): AuditEntry => ({
  id: `${Date.now().toString(36)}-${(seq++).toString(36)}`,
  at: new Date().toISOString(),
  user: s.user.name,
  role: s.user.role,
  projectId,
  action,
  detail,
});

function reducer(s: AppState, a: Action): AppState {
  const log = (action: string, detail: string, projectId: string | null) => [entry(s, action, detail, projectId), ...s.audit].slice(0, 500);
  switch (a.type) {
    case 'replace':
      return a.state;
    case 'updateProject':
      return { ...s, projects: s.projects.map((p) => (p.id === a.id ? a.project : p)), audit: log(a.action, a.detail, a.id) };
    case 'addProject':
      return { ...s, projects: [...s.projects, a.project], currentProjectId: a.project.id, audit: log(a.action, a.project.name, a.project.id) };
    case 'deleteProject': {
      const projects = s.projects.filter((p) => p.id !== a.id);
      const gone = s.projects.find((p) => p.id === a.id);
      return { ...s, projects, currentProjectId: s.currentProjectId === a.id ? projects[0]?.id ?? '' : s.currentProjectId, audit: log('Deleted project', gone?.name ?? a.id, a.id) };
    }
    case 'setCurrent':
      return { ...s, currentProjectId: a.id };
    case 'updateCatalog':
      return { ...s, catalog: a.catalog, audit: log(a.action, a.detail, null) };
    case 'setRole':
      return { ...s, user: { ...s.user, role: a.role }, audit: log('Switched role', a.role, null) };
    case 'setUser':
      return { ...s, user: { ...s.user, name: a.name, email: a.email } };
    case 'setTheme':
      return { ...s, theme: a.theme };
    case 'setTemplates':
      return { ...s, customTemplates: a.templates, audit: log(a.action, `${a.templates.length} custom templates`, null) };
    case 'setLists':
      return { ...s, customIndustries: a.industries, customFunctions: a.functions };
    case 'audit':
      return { ...s, audit: log(a.action, a.detail, a.projectId) };
  }
}

interface Store {
  state: AppState;
  dispatch: (a: Action) => void;
}

const Ctx = createContext<Store | null>(null);

export function StoreProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, undefined, load);
  useEffect(() => {
    const t = setTimeout(() => {
      try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      } catch {
        /* storage full or blocked — state stays in memory */
      }
    }, 250);
    return () => clearTimeout(t);
  }, [state]);
  useEffect(() => {
    const root = document.documentElement;
    if (state.theme === 'system') root.removeAttribute('data-theme');
    else root.setAttribute('data-theme', state.theme);
  }, [state.theme]);
  const value = useMemo(() => ({ state, dispatch }), [state]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useStore(): Store {
  const s = useContext(Ctx);
  if (!s) throw new Error('StoreProvider missing');
  return s;
}

export function useCan(permission: Permission): boolean {
  const { state } = useStore();
  return can(state.user.role, permission);
}

export function useCurrentProject(): Project | undefined {
  const { state } = useStore();
  return state.projects.find((p) => p.id === state.currentProjectId) ?? state.projects[0];
}

export function useTemplates(): ProcessTemplate[] {
  const { state } = useStore();
  return useMemo(() => [...PROCESS_TEMPLATES, ...state.customTemplates], [state.customTemplates]);
}

/**
 * Returns an updater for a project: `update('Changed retry rate', draft => { draft.workflows[0].retryRatePct = 5 })`.
 * The draft is a deep copy; the change is recorded in the audit log.
 */
export function useProjectUpdater(projectId: string | undefined) {
  const { state, dispatch } = useStore();
  return useCallback(
    (action: string, mutate: (draft: Project) => void, detail = '') => {
      const p = state.projects.find((x) => x.id === projectId);
      if (!p) return;
      const draft = structuredClone(p);
      mutate(draft);
      draft.updatedAt = new Date().toISOString();
      dispatch({ type: 'updateProject', id: p.id, project: draft, action, detail: detail || p.name });
    },
    [state.projects, projectId, dispatch],
  );
}

export function useCatalogUpdater() {
  const { state, dispatch } = useStore();
  return useCallback(
    (action: string, mutate: (draft: Catalog) => void, detail = '') => {
      const draft = structuredClone(state.catalog);
      mutate(draft);
      dispatch({ type: 'updateCatalog', catalog: draft, action, detail });
    },
    [state.catalog, dispatch],
  );
}

// ───── Memoised computation: one ProjectResult per (project, catalog) pair ─────
const cache = new WeakMap<Project, WeakMap<Catalog, ProjectResult>>();

export function computeCached(project: Project, catalog: Catalog): ProjectResult {
  let byCat = cache.get(project);
  if (!byCat) {
    byCat = new WeakMap();
    cache.set(project, byCat);
  }
  let r = byCat.get(catalog);
  if (!r) {
    r = computeProject(project, catalog);
    byCat.set(catalog, r);
  }
  return r;
}

export function useResult(project: Project | undefined): ProjectResult | undefined {
  const { state } = useStore();
  return useMemo(() => (project ? computeCached(project, state.catalog) : undefined), [project, state.catalog]);
}

export function usePortfolio(): { project: Project; result: ProjectResult }[] {
  const { state } = useStore();
  return useMemo(() => state.projects.map((p) => ({ project: p, result: computeCached(p, state.catalog) })), [state.projects, state.catalog]);
}
