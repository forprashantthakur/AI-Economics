/**
 * Keeps a connected workspace in step with the API server. Every local edit to a project
 * is saved as a new server version (PUT with the base version, so concurrent edits are
 * detected); new projects are created, deleted ones soft-deleted; catalogue rate changes
 * are written as new versioned rows. Refusals (403) and conflicts (409) reload the
 * server's copy so the browser never drifts from the database.
 */
import { useEffect, useRef, useState } from 'react';
import { CloudOff, CloudUpload, Cloud, AlertTriangle } from 'lucide-react';
import type { Catalog, Project } from '@aies/engine';
import { ApiError, api, createProject, deleteProject, fetchProject, saveProject } from '../lib/api';
import { useStore } from '../state/store';
import { cx } from './ui';

type Status = { kind: 'idle' | 'saving' | 'saved' | 'error'; message?: string };

export function ServerSync() {
  const { state, dispatch } = useStore();
  const synced = useRef(new Map<string, Project>());
  const syncedCatalog = useRef<Catalog | null>(null);
  const running = useRef(false);
  const again = useRef(false);
  const latest = useRef(state);
  latest.current = state;
  const [status, setStatus] = useState<Status>({ kind: 'idle' });

  // When a session starts, everything loaded from the server is in sync by definition.
  useEffect(() => {
    synced.current.clear();
    syncedCatalog.current = null;
    if (!state.server) return;
    for (const p of state.projects) if (state.serverVersions?.[p.id] !== undefined) synced.current.set(p.id, p);
    syncedCatalog.current = state.catalog;
    setStatus({ kind: 'saved', message: 'Connected' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.server?.token]);

  useEffect(() => {
    if (!state.server) return;
    const t = setTimeout(() => void flush(), 900);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.projects, state.catalog, state.server?.token]);

  async function flush() {
    if (running.current) {
      again.current = true;
      return;
    }
    running.current = true;
    try {
      do {
        again.current = false;
        await syncOnce();
      } while (again.current);
    } finally {
      running.current = false;
    }
  }

  async function reloadFromServer(id: string, note: string) {
    const s = latest.current.server!;
    const fresh = await fetchProject(s, id);
    synced.current.set(id, fresh.project);
    dispatch({ type: 'serverProject', project: fresh.project, version: fresh.meta.version, note });
  }

  async function syncOnce() {
    const st = latest.current;
    const s = st.server;
    if (!s) return;
    const versions = st.serverVersions ?? {};
    const lastAction = (id: string) => st.audit.find((a) => a.projectId === id)?.action ?? 'Edited in the studio';
    let changed = 0;
    try {
      for (const p of st.projects) {
        if (versions[p.id] === undefined) {
          setStatus({ kind: 'saving', message: `Creating ${p.name}` });
          const r = await createProject(s, p);
          synced.current.set(p.id, p);
          dispatch({ type: 'serverVersion', id: p.id, version: r.meta.version });
          changed++;
        } else if (synced.current.get(p.id) !== p) {
          setStatus({ kind: 'saving', message: `Saving ${p.name}` });
          try {
            const r = await saveProject(s, p, versions[p.id], lastAction(p.id));
            synced.current.set(p.id, p);
            dispatch({ type: 'serverVersion', id: p.id, version: r.meta.version });
            changed++;
          } catch (e) {
            if (e instanceof ApiError && (e.status === 409 || e.status === 403 || e.status === 422)) {
              const why =
                e.status === 409 ? 'Someone else saved this project first; loaded their version' : e.status === 403 ? `Change refused by the server: ${e.message}` : `Change rejected: ${e.message}`;
              await reloadFromServer(p.id, e.status === 409 ? 'Reloaded after a concurrent edit' : 'Reverted a refused change');
              setStatus({ kind: 'error', message: why });
              return;
            }
            throw e;
          }
        }
      }
      for (const id of [...synced.current.keys()]) {
        if (!st.projects.some((p) => p.id === id)) {
          setStatus({ kind: 'saving', message: 'Deleting project' });
          await deleteProject(s, id);
          synced.current.delete(id);
          changed++;
        }
      }
      changed += await syncCatalog(st.catalog);
      if (changed) setStatus({ kind: 'saved', message: `Saved to server ${new Date().toLocaleTimeString('en-IN', { timeStyle: 'short' })}` });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (e instanceof ApiError && e.status === 401) {
        setStatus({ kind: 'error', message: 'Your server session expired. Sign in again under Settings → Data.' });
        dispatch({ type: 'disconnect' });
        return;
      }
      setStatus({ kind: 'error', message: msg });
    }
  }

  async function syncCatalog(cat: Catalog): Promise<number> {
    const s = latest.current.server!;
    const prev = syncedCatalog.current;
    if (!prev || prev === cat) return 0;
    let n = 0;
    const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
    for (const m of cat.modelRates) {
      const old = prev.modelRates.find((x) => x.id === m.id);
      if (!old || !same(old, m)) {
        setStatus({ kind: 'saving', message: `Saving rate for ${m.model}` });
        await api(s, `/catalog/model-rates/${encodeURIComponent(m.id)}`, { method: 'PUT', body: m });
        n++;
      }
    }
    for (const c of cat.cloudPrices) {
      const old = prev.cloudPrices.find((x) => x.id === c.id);
      if (!old || !same(old, c)) {
        await api(s, `/catalog/cloud-prices/${encodeURIComponent(c.id)}`, { method: 'PUT', body: c });
        n++;
      }
    }
    if (!same(prev.fx, cat.fx)) {
      await api(s, '/catalog/fx', { method: 'PUT', body: cat.fx });
      n++;
    }
    for (const w of cat.acuWeightSets) {
      const old = prev.acuWeightSets.find((x) => x.id === w.id && x.version === w.version);
      if (!old) {
        await api(s, '/catalog/acu-weight-sets', { method: 'POST', body: { ...w, status: 'draft' } });
        n++;
      }
      if (w.status === 'approved' && old?.status !== 'approved') {
        await api(s, `/catalog/acu-weight-sets/${encodeURIComponent(w.id)}/${encodeURIComponent(w.version)}/approve`, { method: 'POST', body: {} });
        n++;
      }
    }
    syncedCatalog.current = cat;
    return n;
  }

  if (!state.server) return null;
  const Icon = status.kind === 'error' ? AlertTriangle : status.kind === 'saving' ? CloudUpload : state.server ? Cloud : CloudOff;
  return (
    <div
      role="status"
      aria-live="polite"
      className={cx(
        'no-print fixed bottom-3 right-3 z-30 max-w-[360px] inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[12.5px] font-semibold shadow-sm',
        status.kind === 'error' ? 'bg-bad-tint text-bad border-transparent' : 'bg-paper text-ink-2 border-line',
      )}
    >
      <Icon size={14} aria-hidden />
      <span className="truncate">{status.message ?? `Connected as ${state.server.user.email}`}</span>
    </div>
  );
}
