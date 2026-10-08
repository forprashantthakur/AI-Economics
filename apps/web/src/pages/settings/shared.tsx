/**
 * Settings helpers: where catalogue entries are used across projects, and the
 * small row-expander used by the rate-card tables.
 */
import { useMemo, type ReactNode } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { SAMPLE_SOURCE, type Project } from '@aies/engine';
import { Badge, Checkbox } from '../../components/ui';
import { useStore } from '../../state/store';

export interface ModelUse {
  project: Project;
  steps: { workflow: string; step: string }[];
}

/** For each model id: projects and steps that route to it. */
export function useModelUsage(): Map<string, ModelUse[]> {
  const { state } = useStore();
  return useMemo(() => {
    const m = new Map<string, ModelUse[]>();
    for (const p of state.projects) {
      const byModel = new Map<string, ModelUse['steps']>();
      for (const w of p.workflows)
        for (const s of w.llmSteps)
          for (const r of s.routing) {
            if (!byModel.has(r.modelId)) byModel.set(r.modelId, []);
            byModel.get(r.modelId)!.push({ workflow: w.name, step: s.name });
          }
      for (const [id, steps] of byModel) m.set(id, [...(m.get(id) ?? []), { project: p, steps }]);
    }
    return m;
  }, [state.projects]);
}

/** For each cloud price id: projects and cost lines that reference it. */
export function usePriceUsage(): Map<string, { project: Project; lines: string[] }[]> {
  const { state } = useStore();
  return useMemo(() => {
    const m = new Map<string, { project: Project; lines: string[] }[]>();
    for (const p of state.projects) {
      const by = new Map<string, string[]>();
      for (const l of p.costLines) if (l.priceRef) by.set(l.priceRef, [...(by.get(l.priceRef) ?? []), l.name]);
      for (const [id, lines] of by) m.set(id, [...(m.get(id) ?? []), { project: p, lines }]);
    }
    return m;
  }, [state.projects]);
}

export function usageLabel(units: number, projects: number, unit: string): string {
  if (!projects) return 'Not used';
  return `${units} ${unit}${units === 1 ? '' : 's'} in ${projects} ${projects === 1 ? 'project' : 'projects'}`;
}

export function ExpandButton({ open, onClick, label }: { open: boolean; onClick: () => void; label: string }) {
  return (
    <button type="button" onClick={onClick} aria-expanded={open} aria-label={`${open ? 'Collapse' : 'Expand'} ${label}`} className="inline-flex items-center justify-center w-7 h-7 rounded-md !text-ink-3 hover:!text-ink hover:bg-sunken">
      {open ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
    </button>
  );
}

/** Sample flag shown on every rate row: ticked = illustrative sample, unticked = verified. */
export function SampleFlag({ sample, onChange, disabled, label }: { sample: boolean; onChange: (v: boolean) => void; disabled?: boolean; label: string }) {
  return (
    <span className="relative inline-flex items-center whitespace-nowrap" title={sample ? 'Illustrative sample rate. Untick once replaced with a verified published or contracted rate.' : 'Marked as verified. Tick to flag it as a sample again.'}>
      <Checkbox checked={sample} disabled={disabled} onChange={onChange} label={<span className="sr-only">{`Sample rate: ${label}`}</span>} />
      <span className="ml-1.5 align-middle">{sample ? <Badge tone="warn">Sample</Badge> : <Badge tone="good">Verified</Badge>}</span>
    </span>
  );
}

export const needsSource = (sample: boolean, source: string) => !sample && (!source.trim() || source === SAMPLE_SOURCE);

export function DetailGrid({ children }: { children: ReactNode }) {
  return <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">{children}</div>;
}

export function DetailSection({ title, children, note }: { title: string; children: ReactNode; note?: ReactNode }) {
  return (
    <section className="min-w-0">
      <h4 className="text-[13.5px] font-semibold text-ink mb-2">{title}</h4>
      {children}
      {note && <p className="text-[12.5px] text-ink-3 mt-2">{note}</p>}
    </section>
  );
}
