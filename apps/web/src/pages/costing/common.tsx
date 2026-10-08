/**
 * Helpers shared by the Project Costing, ACU and ABU pages (kept local to these
 * pages so shared components stay untouched).
 */
import { useEffect, useRef, useState, type ComponentProps, type ReactNode } from 'react';
import type { Catalog, Issue, Project, ProjectResult } from '@aies/engine';
import { cx, NumberInput, Segmented } from '../../components/ui';
import { n, tokens } from '../../lib/format';
import type { useProjectUpdater } from '../../state/store';

export type Updater = ReturnType<typeof useProjectUpdater>;

export interface EditorProps {
  project: Project;
  result: ProjectResult;
  update: Updater;
  canEdit: boolean;
}

export function currencyOptions(catalog: Catalog): { value: string; label: string }[] {
  const codes = new Set([catalog.fx.base, ...Object.keys(catalog.fx.rates)]);
  return [...codes].map((c) => ({ value: c, label: c }));
}

export function issuesWith(result: ProjectResult, codes: string[]): Issue[] {
  return result.issues.filter((i) => codes.includes(i.code));
}

/** Compact display of a unit quantity (tokens-style above 1,000, decimals below 10). */
export function fmtUnits(v: Parameters<typeof n>[0]): string {
  const x = n(v);
  if (Math.abs(x) >= 1000) return tokens(x);
  if (x === 0) return '0';
  if (Math.abs(x) < 0.01) return x.toPrecision(2);
  return x.toFixed(Math.abs(x) < 10 ? 2 : 0);
}

/**
 * NumberInput with room reserved for its prefix/suffix. The shared input's pl/pr
 * utilities lose to the unlayered `.field` padding, so the affix would overlap the value.
 */
export function Num(props: ComponentProps<typeof NumberInput>) {
  return <NumberInput {...props} className={cx(props.className, props.suffix && (props.suffix.length > 1 ? '[&>input]:!pr-8' : '[&>input]:!pr-6'), props.prefix && '[&>input]:!pl-6')} />;
}

/** Tighter cell padding for wide editing tables. */
export const TIGHT = '[&_td]:!px-2 [&_th]:!px-2';

export function IconButton({ label, onClick, disabled, children, tone }: { label: string; onClick: () => void; disabled?: boolean; children: ReactNode; tone?: 'bad' }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className={cx(
        'inline-flex items-center justify-center w-7 h-7 rounded-md text-ink-3 hover:bg-sunken disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent',
        tone === 'bad' ? 'hover:text-bad' : 'hover:text-ink',
      )}
    >
      {children}
    </button>
  );
}

/** Number input where an empty value means "not set" (null). Commits on blur or Enter. */
export function OptionalNumberInput({
  value,
  onChange,
  placeholder,
  prefix,
  suffix,
  disabled,
  ariaLabel,
  width,
  min = 0,
}: {
  value: number | null | undefined;
  onChange: (v: number | null) => void;
  placeholder?: string;
  prefix?: string;
  suffix?: string;
  disabled?: boolean;
  ariaLabel?: string;
  width?: number | string;
  min?: number;
}) {
  const shown = value === null || value === undefined ? '' : String(Math.round(value * 1e6) / 1e6);
  const [draft, setDraft] = useState(shown);
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current) setDraft(shown);
  }, [shown]);
  const commit = (raw: string) => {
    const t = raw.replace(/,/g, '').trim();
    if (t === '') {
      if (value !== null && value !== undefined) onChange(null);
      return;
    }
    const v = Number(t);
    if (!Number.isFinite(v)) {
      setDraft(shown);
      return;
    }
    const x = Math.max(min, v);
    if (x !== value) onChange(x);
  };
  return (
    <div className="relative flex items-center" style={width ? { width } : undefined}>
      {prefix && <span className="absolute left-2.5 text-[13px] text-ink-3 pointer-events-none">{prefix}</span>}
      <input
        aria-label={ariaLabel}
        className={cx('field num text-right', prefix && '!pl-6', suffix && '!pr-8')}
        inputMode="decimal"
        value={draft}
        placeholder={placeholder}
        disabled={disabled}
        onFocus={() => (focused.current = true)}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={(e) => {
          focused.current = false;
          commit(e.target.value);
        }}
        onKeyDown={(e) => e.key === 'Enter' && commit((e.target as HTMLInputElement).value)}
      />
      {suffix && <span className="absolute right-2.5 text-[12.5px] text-ink-3 pointer-events-none">{suffix}</span>}
    </div>
  );
}

/** Small inline link styled like the reference pages' panel actions. */
export function TextLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a className="font-semibold text-brand hover:underline" href={href}>
      {children}
    </a>
  );
}

/** Workflow switcher: segmented control for a few workflows, a select for many. Hidden when there is one. */
export function WorkflowPicker({ project, value, onChange, label = 'Workflow' }: { project: Project; value: string; onChange: (id: string) => void; label?: string }) {
  if (project.workflows.length <= 1) return null;
  if (project.workflows.length > 4)
    return (
      <label className="flex items-center gap-2 text-[13px] text-ink-3">
        {label}
        <select className="field !w-auto max-w-[320px] font-semibold text-ink" value={value} onChange={(e) => onChange(e.target.value)}>
          {project.workflows.map((w) => (
            <option key={w.id} value={w.id}>
              {w.name}
            </option>
          ))}
        </select>
      </label>
    );
  return (
    <div className="scroll-x max-w-full">
      <Segmented ariaLabel={label} value={value} onChange={onChange} options={project.workflows.map((w) => ({ id: w.id, label: w.name }))} />
    </div>
  );
}

/** Keeps a selected workflow id valid when the project changes. */
export function useWorkflowId(project: Project | undefined): [string, (id: string) => void] {
  const [id, setId] = useState(project?.workflows[0]?.id ?? '');
  const valid = project?.workflows.some((w) => w.id === id) ? id : (project?.workflows[0]?.id ?? '');
  return [valid, setId];
}

/** A labelled colour swatch for HTML legends. */
export function Swatch({ color, label, line }: { color: string; label: ReactNode; line?: boolean }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-[12.5px] text-ink-2">
      <span aria-hidden className={line ? 'inline-block w-3.5 h-[2px] rounded' : 'inline-block w-2.5 h-2.5 rounded-[3px]'} style={{ background: `var(${color})` }} />
      {label}
    </span>
  );
}
