import { useState, type ReactNode } from 'react';
import {
  LayoutDashboard,
  FolderKanban,
  Calculator,
  Gauge,
  Boxes,
  Receipt,
  TrendingUp,
  FlaskConical,
  FileText,
  Settings as SettingsIcon,
  Menu,
  X,
  Sun,
  Moon,
  Monitor,
  CheckCircle2,
  AlertTriangle,
} from 'lucide-react';
import { ROLES, ROLE_LABELS, type RoleName } from '@aies/engine';
import { href, type Route } from '../lib/router';
import { useCurrentProject, useResult, useStore } from '../state/store';
import { cx } from './ui';
import { ServerSync } from './ServerSync';

const NAV: { route: Route; label: string; icon: typeof LayoutDashboard; group: 'top' | 'project' | 'bottom' }[] = [
  { route: 'dashboard', label: 'Dashboard', icon: LayoutDashboard, group: 'top' },
  { route: 'projects', label: 'Projects', icon: FolderKanban, group: 'top' },
  { route: 'costing', label: 'Project Costing', icon: Calculator, group: 'project' },
  { route: 'acu', label: 'ACU Calculator', icon: Gauge, group: 'project' },
  { route: 'abu', label: 'ABU Calculator', icon: Boxes, group: 'project' },
  { route: 'commercial', label: 'Commercial Pricing', icon: Receipt, group: 'project' },
  { route: 'value', label: 'Value Realization', icon: TrendingUp, group: 'project' },
  { route: 'scenarios', label: 'Scenario Simulator', icon: FlaskConical, group: 'project' },
  { route: 'reports', label: 'Reports', icon: FileText, group: 'bottom' },
  { route: 'settings', label: 'Settings', icon: SettingsIcon, group: 'bottom' },
];

export const PROJECT_ROUTES: Route[] = ['costing', 'acu', 'abu', 'commercial', 'value', 'scenarios', 'reports'];

function Mark() {
  return (
    <svg width="28" height="28" viewBox="0 0 32 32" aria-hidden>
      <rect width="32" height="32" rx="7" fill="var(--rail-2)" />
      <path d="M8 22l6-12 4 8 2-4 4 8" stroke="var(--rail-accent)" strokeWidth="2.6" fill="none" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function NavLink({ route, label, icon: Icon, active, onClick }: { route: Route; label: string; icon: typeof LayoutDashboard; active: boolean; onClick?: () => void }) {
  return (
    <a
      href={href(route)}
      onClick={onClick}
      aria-current={active ? 'page' : undefined}
      className={cx(
        'relative flex items-center gap-2.5 rounded-md px-2.5 py-[7px] text-[14px] transition-colors',
        active ? 'bg-rail-2 text-rail-ink-strong font-semibold' : 'text-rail-ink hover:text-rail-ink-strong hover:bg-rail-2/60',
      )}
    >
      {active && <span className="absolute left-0 top-1.5 bottom-1.5 w-[3px] rounded-r bg-rail-accent" aria-hidden />}
      <Icon size={17} strokeWidth={active ? 2.2 : 1.8} aria-hidden />
      {label}
    </a>
  );
}

export function Sidebar({ route, open, onClose }: { route: Route; open: boolean; onClose: () => void }) {
  const { state } = useStore();
  const active = (r: Route) => r === route || (route === 'project' && r === 'projects') || (route === 'new-project' && r === 'projects');
  const group = (g: 'top' | 'project' | 'bottom') => NAV.filter((n) => n.group === g).map((n) => <NavLink key={n.route} {...n} active={active(n.route)} onClick={onClose} />);
  return (
    <>
      {open && <div className="fixed inset-0 bg-black/40 z-30 lg:hidden" onClick={onClose} aria-hidden />}
      <aside
        className={cx(
          'fixed lg:sticky top-0 z-40 h-screen w-[244px] shrink-0 bg-rail flex flex-col transition-transform lg:translate-x-0',
          open ? 'translate-x-0' : '-translate-x-full',
        )}
        aria-label="Main navigation"
      >
        <div className="flex items-center gap-2.5 px-4 h-[60px]">
          <Mark />
          <div className="leading-tight">
            <div className="text-[14.5px] font-semibold text-rail-ink-strong">AI Economics Studio</div>
            <div className="text-[11.5px] text-rail-ink">Costing, metering and value</div>
          </div>
          <button type="button" className="ml-auto lg:hidden text-rail-ink" onClick={onClose} aria-label="Close navigation">
            <X size={18} />
          </button>
        </div>
        <nav className="flex-1 overflow-y-auto px-2.5 pb-4">
          <div className="space-y-0.5">{group('top')}</div>
          <div className="mt-5 mb-1.5 px-2.5 text-[12px] text-rail-ink/80">Selected project</div>
          <div className="space-y-0.5">{group('project')}</div>
          <div className="mt-5 space-y-0.5 border-t border-rail-2 pt-4">{group('bottom')}</div>
        </nav>
        <div className="px-4 py-3 border-t border-rail-2 text-[12.5px]">
          <div className="text-rail-ink-strong font-semibold truncate">{state.user.name}</div>
          <div className="text-rail-ink truncate">{ROLE_LABELS[state.user.role]}</div>
        </div>
      </aside>
    </>
  );
}

function ThemeButton() {
  const { state, dispatch } = useStore();
  const next = state.theme === 'system' ? 'light' : state.theme === 'light' ? 'dark' : 'system';
  const Icon = state.theme === 'system' ? Monitor : state.theme === 'light' ? Sun : Moon;
  return (
    <button
      type="button"
      onClick={() => dispatch({ type: 'setTheme', theme: next })}
      className="inline-flex items-center justify-center w-8 h-8 rounded-md text-ink-2 hover:bg-sunken hover:text-ink"
      title={`Theme: ${state.theme} (click for ${next})`}
      aria-label={`Theme: ${state.theme}. Switch to ${next}`}
    >
      <Icon size={17} />
    </button>
  );
}

function ReconBadge() {
  const project = useCurrentProject();
  const result = useResult(project);
  if (!result) return null;
  const fails = result.reconciliation.filter((c) => !c.pass).length;
  const errors = result.issues.filter((i) => i.severity === 'error').length;
  const ok = fails === 0 && errors === 0;
  return (
    <a
      href={href('dashboard') + '?view=integrity'}
      className={cx('hidden md:inline-flex items-center gap-1.5 text-[12.5px] font-semibold rounded-full px-2.5 py-1', ok ? 'text-good bg-good-tint' : 'text-bad bg-bad-tint')}
      title="Every figure is computed once by the engine and reconciled across modules, dashboards and reports."
    >
      {ok ? <CheckCircle2 size={14} /> : <AlertTriangle size={14} />}
      {ok ? `Reconciled (${result.reconciliation.length} checks)` : `${fails + errors} integrity issue${fails + errors === 1 ? '' : 's'}`}
    </a>
  );
}

export function TopBar({ route, onMenu }: { route: Route; onMenu: () => void }) {
  const { state, dispatch } = useStore();
  const project = useCurrentProject();
  const scoped = PROJECT_ROUTES.includes(route);
  return (
    <header className="topbar sticky top-0 z-20 h-[60px] bg-paper/95 backdrop-blur border-b border-line flex items-center gap-3 px-4 lg:px-6">
      <button type="button" className="lg:hidden text-ink-2" onClick={onMenu} aria-label="Open navigation">
        <Menu size={20} />
      </button>
      {scoped && project ? (
        <div className="flex items-center gap-2 min-w-0">
          <label htmlFor="project-switch" className="text-[13px] text-ink-3 hidden sm:block">
            Project
          </label>
          <select
            id="project-switch"
            className="field !w-auto max-w-[min(52vw,360px)] font-semibold"
            value={project.id}
            onChange={(e) => dispatch({ type: 'setCurrent', id: e.target.value })}
          >
            {state.projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} — {p.client.clientName}
              </option>
            ))}
          </select>
        </div>
      ) : (
        <div className="text-[13.5px] text-ink-3 truncate">Enterprise AI Economics &amp; Commercialization Studio</div>
      )}
      <div className="ml-auto flex items-center gap-2">
        {scoped && <ReconBadge />}
        <label htmlFor="role-switch" className="sr-only">
          Role
        </label>
        <select
          id="role-switch"
          className="field !w-auto text-[13px] hidden sm:block"
          value={state.user.role}
          disabled={!!state.server}
          onChange={(e) => dispatch({ type: 'setRole', role: e.target.value as RoleName })}
          title={state.server ? `Role of ${state.server.user.email}, set on the server` : 'Demo role (controls what you can edit)'}
        >
          {ROLES.map((r) => (
            <option key={r} value={r}>
              {ROLE_LABELS[r]}
            </option>
          ))}
        </select>
        <ThemeButton />
      </div>
    </header>
  );
}

export function Shell({ route, children }: { route: Route; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="flex min-h-screen">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:z-50 focus:bg-paper focus:p-2">
        Skip to content
      </a>
      <Sidebar route={route} open={open} onClose={() => setOpen(false)} />
      <div className="flex-1 min-w-0 flex flex-col">
        <TopBar route={route} onMenu={() => setOpen(true)} />
        <ServerSync />
        <main id="main" className="flex-1 min-w-0 px-4 lg:px-7 py-6 max-w-[1480px] w-full mx-auto">
          {children}
        </main>
      </div>
    </div>
  );
}
