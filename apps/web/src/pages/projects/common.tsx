/**
 * Helpers shared by the project, intake and settings pages: option lists,
 * small inputs (tags, month, suggestions), download helpers and period maths.
 */
import { useEffect, useId, useState, type ReactNode } from 'react';
import { X } from 'lucide-react';
import type { Project, SolutionType } from '@aies/engine';
import { NumberInput as BaseNumberInput, cx } from '../../components/ui';

export const SOLUTION_TYPES: { value: SolutionType; label: string }[] = [
  { value: 'assistant', label: 'Assistant' },
  { value: 'copilot', label: 'Copilot' },
  { value: 'single_agent', label: 'Single agent' },
  { value: 'multi_agent', label: 'Multi-agent system' },
  { value: 'autonomous_workflow', label: 'Autonomous workflow' },
];

export const SOLUTION_LABEL = Object.fromEntries(SOLUTION_TYPES.map((s) => [s.value, s.label])) as Record<SolutionType, string>;

export const DEFAULT_INDUSTRIES = [
  'Banking & Financial Services',
  'Insurance',
  'Manufacturing',
  'Retail & Consumer Goods',
  'Healthcare & Life Sciences',
  'Pharmaceuticals',
  'Technology & IT Services',
  'Telecom & Media',
  'Energy & Utilities',
  'Logistics & Transportation',
  'Public Sector',
  'Professional Services',
  'Education',
];

export const DEFAULT_FUNCTIONS = ['Finance', 'Procurement', 'HR', 'IT', 'Customer Operations', 'Sales', 'Cross-functional', 'Custom'];

/** Template groups shown in the intake wizard; anything else falls under "Additional". */
export const TEMPLATE_GROUPS = ['Finance', 'Procurement', 'HR', 'IT', 'Customer Operations'];
export const templateGroup = (fn: string) => (TEMPLATE_GROUPS.includes(fn) ? fn : 'Additional');

export const ENGAGEMENT_TYPES = [
  'Agent-as-a-Service (managed)',
  'Agent-as-a-Service (subscription)',
  'Implementation + managed run',
  'Fixed-price implementation',
  'Time & materials',
  'Pilot / proof of value',
  'Outcome-based (gainshare)',
];

export const CLOUD_PLATFORMS = ['AWS (ap-south-1)', 'Azure (Central India)', 'Google Cloud (asia-south1)', 'Oracle Cloud (Mumbai)', 'On-premises / private cloud', 'Hybrid (cloud + on-premises)'];
export const GEOGRAPHIES = ['India', 'India & APAC', 'APAC', 'Middle East', 'Europe', 'United Kingdom', 'North America', 'Global'];
export const AVAILABILITY_SLAS = ['99.0% (business hours)', '99.5% (business hours)', '99.5% (24×7)', '99.9% (24×7)', '99.95% (24×7)'];
export const SUPPORT_SLAS = ['P1 response 30 min, 24×7', 'P1 response 1 hour, 24×7', 'P1 response 1 hour, business hours', 'P1 response 4 hours, business hours'];

/** Options list that always contains the current value (imported projects may use values outside the list). */
export function withCurrent(values: string[], current: string): { value: string; label: string }[] {
  const all = [...new Set([...(current && !values.includes(current) ? [current] : []), ...values])];
  return all.map((v) => ({ value: v, label: v }));
}

// ───────────────────────────── Periods ─────────────────────────────

export const PERIOD_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
export const isPeriod = (s: string) => PERIOD_RE.test(s);

/** Run month for a YYYY-MM period (1 = go-live month). */
export function monthIndexFor(goLive: string, period: string): number {
  const [gy, gm] = goLive.split('-').map(Number);
  const [py, pm] = period.split('-').map(Number);
  if (!gy || !gm || !py || !pm) return 0;
  return py * 12 + pm - (gy * 12 + gm) + 1;
}

export const thisMonth = () => new Date().toISOString().slice(0, 7);
export const today = () => new Date().toISOString().slice(0, 10);

export function shortDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

// ───────────────────────────── Files ─────────────────────────────

export function slugify(s: string): string {
  return (
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'export'
  );
}

export function downloadFile(filename: string, content: string, type = 'application/json') {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function exportProject(p: Project) {
  downloadFile(`${slugify(p.name)}.project.json`, JSON.stringify(p, null, 2));
}

export function readFileText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result ?? ''));
    r.onerror = () => reject(new Error('The file could not be read.'));
    r.readAsText(file);
  });
}

export const csvCell = (v: unknown) => {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

// ───────────────────────────── Inputs ─────────────────────────────

/**
 * The shared NumberInput with prefix/suffix padding that actually applies: `.field`
 * is unlayered CSS, so it beats Tailwind's layered pl-/pr- utilities used inside ui.tsx.
 */
export function NumberInput(props: Parameters<typeof BaseNumberInput>[0]) {
  const s = props.suffix?.length ?? 0;
  return <BaseNumberInput {...props} className={cx(props.className, s > 0 && (s <= 1 ? '[&>input]:!pr-7' : s <= 3 ? '[&>input]:!pr-10' : '[&>input]:!pr-14'), props.prefix && '[&>input]:!pl-6')} />;
}

export function FieldError({ children }: { children?: ReactNode }) {
  if (!children) return null;
  return (
    <p className="text-[12.5px] text-bad mt-1 leading-snug" role="alert">
      {children}
    </p>
  );
}

/** Month picker (YYYY-MM). Commits on change. */
export function MonthInput({ value, onChange, disabled, id, ariaLabel, className }: { value: string; onChange: (v: string) => void; disabled?: boolean; id?: string; ariaLabel?: string; className?: string }) {
  return <input id={id} aria-label={ariaLabel} type="month" className={cx('field num', className)} value={value} disabled={disabled} onChange={(e) => e.target.value && onChange(e.target.value)} />;
}

/** Date picker (YYYY-MM-DD). Commits on change. */
export function DateInput({ value, onChange, disabled, id, ariaLabel }: { value: string; onChange: (v: string) => void; disabled?: boolean; id?: string; ariaLabel?: string }) {
  return <input id={id} aria-label={ariaLabel} type="date" className="field num" value={value} disabled={disabled} onChange={(e) => e.target.value && onChange(e.target.value)} />;
}

/** Free text with suggestions (datalist). Commits on blur or Enter, like TextInput. */
export function SuggestInput({ value, onChange, suggestions, placeholder, disabled, id, ariaLabel }: { value: string; onChange: (v: string) => void; suggestions: string[]; placeholder?: string; disabled?: boolean; id?: string; ariaLabel?: string }) {
  const listId = useId();
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const commit = () => draft !== value && onChange(draft);
  return (
    <>
      <input
        id={id}
        aria-label={ariaLabel}
        className="field"
        list={listId}
        value={draft}
        placeholder={placeholder}
        disabled={disabled}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => e.key === 'Enter' && commit()}
      />
      <datalist id={listId}>
        {suggestions.map((s) => (
          <option key={s} value={s} />
        ))}
      </datalist>
    </>
  );
}

/** Tag list editor: type and press Enter or comma to add, click × to remove. */
export function TagInput({ value, onChange, placeholder = 'Type and press Enter', disabled, id, ariaLabel }: { value: string[]; onChange: (v: string[]) => void; placeholder?: string; disabled?: boolean; id?: string; ariaLabel?: string }) {
  const [draft, setDraft] = useState('');
  const add = () => {
    const parts = draft
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      .filter((p, i, a) => a.indexOf(p) === i && !value.includes(p));
    setDraft('');
    if (parts.length) onChange([...value, ...parts]);
  };
  return (
    <div
      className={cx(
        'flex flex-wrap items-center gap-1.5 rounded-md border border-line bg-paper px-2 py-[5px] min-h-[34px] transition-colors',
        disabled ? 'bg-sunken' : 'hover:border-ink-3 focus-within:border-brand focus-within:shadow-[0_0_0_3px_var(--brand-tint)]',
      )}
    >
      {value.map((t) => (
        <span key={t} className="inline-flex items-center gap-1 rounded bg-sunken border border-line pl-1.5 pr-1 py-[1px] text-[13px] text-ink max-w-full">
          <span className="truncate">{t}</span>
          {!disabled && (
            <button type="button" aria-label={`Remove ${t}`} className="!text-ink-3 hover:!text-bad" onClick={() => onChange(value.filter((x) => x !== t))}>
              <X size={12} />
            </button>
          )}
        </span>
      ))}
      {!disabled && (
        <input
          id={id}
          aria-label={ariaLabel}
          className="flex-1 min-w-[120px] bg-transparent outline-none text-[14px] py-0.5"
          value={draft}
          placeholder={value.length ? '' : placeholder}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ',') {
              e.preventDefault();
              add();
            } else if (e.key === 'Backspace' && !draft && value.length) onChange(value.slice(0, -1));
          }}
          onBlur={add}
        />
      )}
      {disabled && !value.length && <span className="text-[13px] text-ink-3">None</span>}
    </div>
  );
}

/** Small icon button for dense table rows. Always labelled for screen readers and tooltips. */
export function IconButton({ label, onClick, children, disabled, tone = 'neutral' }: { label: string; onClick: () => void; children: ReactNode; disabled?: boolean; tone?: 'neutral' | 'bad' }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className={cx(
        'inline-flex items-center justify-center w-8 h-8 rounded-md !text-ink-3 transition-colors disabled:opacity-40 disabled:cursor-not-allowed',
        tone === 'bad' ? 'hover:!text-bad hover:bg-bad-tint' : 'hover:!text-ink hover:bg-sunken',
      )}
    >
      {children}
    </button>
  );
}
