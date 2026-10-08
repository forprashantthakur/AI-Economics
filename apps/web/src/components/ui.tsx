/**
 * Shared UI primitives. Every page builds from these so the app reads as one system.
 * Conventions: sentence case, numbers right-aligned with `.num`, one primary action per view.
 */
import { useEffect, useId, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { AlertTriangle, CheckCircle2, Info, XCircle, X } from 'lucide-react';
import type { Issue } from '@aies/engine';

export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(' ');
}

// ───────────────────────────── Buttons ─────────────────────────────

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export function Button({
  variant = 'secondary',
  size = 'md',
  icon,
  className,
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; size?: 'sm' | 'md'; icon?: ReactNode }) {
  const base = 'inline-flex items-center justify-center gap-1.5 rounded-md font-semibold whitespace-nowrap transition-colors disabled:opacity-45 disabled:cursor-not-allowed';
  const sizes = size === 'sm' ? 'text-[13px] px-2.5 py-1' : 'text-sm px-3.5 py-[7px]';
  const variants: Record<ButtonVariant, string> = {
    primary: 'bg-brand text-brand-ink hover:bg-brand-strong',
    secondary: 'bg-paper text-ink border border-line hover:border-ink-3',
    ghost: 'text-ink-2 hover:text-ink hover:bg-sunken',
    danger: 'bg-paper text-bad border border-line hover:border-bad',
  };
  return (
    <button type="button" className={cx(base, sizes, variants[variant], className)} {...rest}>
      {icon}
      {children}
    </button>
  );
}

// ───────────────────────────── Containers ─────────────────────────────

export function Panel({
  title,
  description,
  actions,
  children,
  className,
  bodyClassName,
  padded = true,
  id,
}: {
  title?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
  className?: string;
  bodyClassName?: string;
  padded?: boolean;
  id?: string;
}) {
  return (
    <section id={id} className={cx('bg-paper border border-line rounded-[10px] min-w-0', className)}>
      {(title || actions) && (
        <div className="flex items-start justify-between gap-3 px-4 pt-3.5 pb-2">
          <div className="min-w-0">
            {title && <h3 className="text-[15px] font-semibold text-ink leading-snug">{title}</h3>}
            {description && <p className="text-[13px] text-ink-3 mt-0.5 leading-snug">{description}</p>}
          </div>
          {actions && <div className="flex items-center gap-2 shrink-0">{actions}</div>}
        </div>
      )}
      <div className={cx(padded ? 'px-4 pb-4' : '', !title && !actions && padded ? 'pt-4' : '', bodyClassName)}>{children}</div>
    </section>
  );
}

/** Page header: serif title, one-line purpose, optional actions on the right. */
export function PageHeader({ title, description, actions, meta }: { title: string; description?: ReactNode; actions?: ReactNode; meta?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3 mb-5">
      <div className="min-w-0 max-w-3xl">
        {meta && <div className="text-[13px] text-ink-3 mb-1">{meta}</div>}
        <h1 className="font-serif text-[28px] leading-[1.15] font-semibold text-ink tracking-[-0.01em]">{title}</h1>
        {description && <p className="text-[15px] text-ink-2 mt-1.5 leading-relaxed">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function SectionTitle({ children, actions, className }: { children: ReactNode; actions?: ReactNode; className?: string }) {
  return (
    <div className={cx('flex items-center justify-between gap-3 mt-7 mb-3', className)}>
      <h2 className="text-[17px] font-semibold text-ink">{children}</h2>
      {actions}
    </div>
  );
}

// ───────────────────────────── Stats ─────────────────────────────

export interface StatItem {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  tone?: 'good' | 'bad' | 'warn' | 'neutral';
}

/** A single panel of figures divided by hairlines (not a row of separate cards). */
export function StatStrip({ items, className }: { items: StatItem[]; className?: string }) {
  return (
    <div className={cx('bg-paper border border-line rounded-[10px] grid divide-line', className)} style={{ gridTemplateColumns: `repeat(auto-fit, minmax(${items.length > 4 ? 150 : 170}px, 1fr))` }}>
      {items.map((s, i) => (
        <div key={i} className="px-4 py-3 border-line [&:not(:first-child)]:border-l max-sm:[&:not(:first-child)]:border-l-0 max-sm:border-b max-sm:last:border-b-0 min-w-0">
          <div className="text-[13px] text-ink-3 leading-tight">{s.label}</div>
          <div className={cx('num text-[22px] font-semibold leading-tight mt-1 truncate', s.tone === 'good' ? 'text-good' : s.tone === 'bad' ? 'text-bad' : s.tone === 'warn' ? 'text-warn' : 'text-ink')}>{s.value}</div>
          {s.sub && <div className="text-[12.5px] text-ink-3 mt-0.5 leading-snug">{s.sub}</div>}
        </div>
      ))}
    </div>
  );
}

export function KeyValues({ rows, className }: { rows: [ReactNode, ReactNode][]; className?: string }) {
  return (
    <dl className={cx('text-sm', className)}>
      {rows.map(([k, v], i) => (
        <div key={i} className="flex items-baseline justify-between gap-4 py-1.5 border-b border-line-soft last:border-b-0">
          <dt className="text-ink-2">{k}</dt>
          <dd className="num font-medium text-ink text-right">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

// ───────────────────────────── Badges & status ─────────────────────────────

export function Badge({ tone = 'neutral', children, className }: { tone?: 'neutral' | 'good' | 'warn' | 'bad' | 'brand'; children: ReactNode; className?: string }) {
  const tones = {
    neutral: 'bg-sunken text-ink-2 border-line',
    good: 'bg-good-tint text-good border-transparent',
    warn: 'bg-warn-tint text-warn border-transparent',
    bad: 'bg-bad-tint text-bad border-transparent',
    brand: 'bg-brand-tint text-brand border-transparent',
  };
  return <span className={cx('inline-flex items-center gap-1 rounded-full border px-2 py-[1px] text-[12px] font-semibold whitespace-nowrap', tones[tone], className)}>{children}</span>;
}

const ISSUE_META = {
  error: { icon: XCircle, cls: 'text-bad', label: 'Error' },
  warning: { icon: AlertTriangle, cls: 'text-warn', label: 'Warning' },
  info: { icon: Info, cls: 'text-ink-3', label: 'Note' },
} as const;

export function IssueList({ issues, empty = 'No issues found.', limit }: { issues: Issue[]; empty?: string; limit?: number }) {
  const order = { error: 0, warning: 1, info: 2 };
  const sorted = [...issues].sort((a, b) => order[a.severity] - order[b.severity]);
  const shown = limit ? sorted.slice(0, limit) : sorted;
  if (!issues.length)
    return (
      <p className="flex items-center gap-2 text-sm text-ink-2">
        <CheckCircle2 size={16} className="text-good" aria-hidden /> {empty}
      </p>
    );
  return (
    <ul className="space-y-2">
      {shown.map((i, k) => {
        const m = ISSUE_META[i.severity];
        const Icon = m.icon;
        return (
          <li key={k} className="flex gap-2 text-[13.5px] leading-snug">
            <Icon size={16} className={cx('shrink-0 mt-[1px]', m.cls)} aria-label={m.label} />
            <span className="text-ink-2">{i.message}</span>
          </li>
        );
      })}
      {limit && sorted.length > limit && <li className="text-[13px] text-ink-3">+ {sorted.length - limit} more</li>}
    </ul>
  );
}

export function Callout({ tone = 'neutral', children, title }: { tone?: 'neutral' | 'warn' | 'brand' | 'bad'; title?: ReactNode; children: ReactNode }) {
  const tones = { neutral: 'bg-sunken border-line', warn: 'bg-warn-tint border-transparent', brand: 'bg-brand-tint border-transparent', bad: 'bg-bad-tint border-transparent' };
  return (
    <div className={cx('rounded-lg border px-3.5 py-2.5 text-[13.5px] text-ink-2 leading-relaxed', tones[tone])}>
      {title && <div className="font-semibold text-ink mb-0.5">{title}</div>}
      {children}
    </div>
  );
}

export function Empty({ title, body, action }: { title: string; body?: ReactNode; action?: ReactNode }) {
  return (
    <div className="text-center py-10 px-4">
      <div className="font-semibold text-ink">{title}</div>
      {body && <p className="text-sm text-ink-3 mt-1 max-w-md mx-auto">{body}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

// ───────────────────────────── Tabs & segmented controls ─────────────────────────────

export function Tabs<T extends string>({ tabs, value, onChange, className }: { tabs: { id: T; label: ReactNode }[]; value: T; onChange: (v: T) => void; className?: string }) {
  return (
    <div role="tablist" className={cx('flex gap-1 border-b border-line overflow-x-auto', className)}>
      {tabs.map((t) => (
        <button
          key={t.id}
          role="tab"
          type="button"
          aria-selected={value === t.id}
          onClick={() => onChange(t.id)}
          className={cx(
            'px-3 py-2 text-sm font-semibold whitespace-nowrap border-b-2 -mb-px transition-colors',
            value === t.id ? 'border-brand text-ink' : 'border-transparent text-ink-3 hover:text-ink',
          )}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

export function Segmented<T extends string>({ options, value, onChange, size = 'md', ariaLabel }: { options: { id: T; label: ReactNode }[]; value: T; onChange: (v: T) => void; size?: 'sm' | 'md'; ariaLabel?: string }) {
  return (
    <div role="radiogroup" aria-label={ariaLabel} className="inline-flex rounded-md border border-line bg-sunken p-0.5">
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          role="radio"
          aria-checked={value === o.id}
          onClick={() => onChange(o.id)}
          className={cx(
            'rounded-[5px] font-semibold whitespace-nowrap transition-colors',
            size === 'sm' ? 'px-2 py-0.5 text-[12.5px]' : 'px-3 py-1 text-[13px]',
            value === o.id ? 'bg-paper text-ink shadow-[0_1px_2px_rgba(0,0,0,0.08)]' : 'text-ink-3 hover:text-ink',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

// ───────────────────────────── Form fields ─────────────────────────────

export function Field({ label, hint, children, className, htmlFor }: { label: ReactNode; hint?: ReactNode; children: ReactNode; className?: string; htmlFor?: string }) {
  return (
    <div className={cx('min-w-0', className)}>
      <label htmlFor={htmlFor} className="block text-[13px] font-semibold text-ink-2 mb-1">
        {label}
      </label>
      {children}
      {hint && <p className="text-[12px] text-ink-3 mt-1 leading-snug">{hint}</p>}
    </div>
  );
}

/**
 * Number input that keeps a local draft and commits on blur, Enter or after a
 * short pause — so the full financial model recomputes once per edit, not per keystroke.
 */
export function NumberInput({
  value,
  onChange,
  step,
  min,
  max,
  suffix,
  prefix,
  disabled,
  className,
  ariaLabel,
  id,
  width,
}: {
  value: number;
  onChange: (v: number) => void;
  step?: number;
  min?: number;
  max?: number;
  suffix?: string;
  prefix?: string;
  disabled?: boolean;
  className?: string;
  ariaLabel?: string;
  id?: string;
  width?: number | string;
}) {
  const [draft, setDraft] = useState(String(value ?? 0));
  const focused = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!focused.current) setDraft(fmtDraft(value));
  }, [value]);
  const commit = (raw: string) => {
    if (timer.current) clearTimeout(timer.current);
    const v = Number(raw.replace(/,/g, ''));
    if (raw.trim() === '' || !Number.isFinite(v)) return;
    let x = v;
    if (min !== undefined) x = Math.max(min, x);
    if (max !== undefined) x = Math.min(max, x);
    if (x !== value) onChange(x);
  };
  return (
    <div className={cx('relative flex items-center', className)} style={width ? { width } : undefined}>
      {prefix && <span className="absolute left-2.5 text-[13px] text-ink-3 pointer-events-none">{prefix}</span>}
      <input
        id={id}
        aria-label={ariaLabel}
        className={cx('field num text-right', prefix && 'pl-6', suffix && 'pr-9')}
        inputMode="decimal"
        value={draft}
        disabled={disabled}
        step={step}
        onFocus={() => (focused.current = true)}
        onChange={(e) => {
          setDraft(e.target.value);
          if (timer.current) clearTimeout(timer.current);
          const raw = e.target.value;
          timer.current = setTimeout(() => commit(raw), 700);
        }}
        onBlur={(e) => {
          focused.current = false;
          commit(e.target.value);
          setDraft(fmtDraft(Number(e.target.value.replace(/,/g, '')) || value));
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit((e.target as HTMLInputElement).value);
          if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
            e.preventDefault();
            const s = step ?? 1;
            const next = (Number(draft.replace(/,/g, '')) || 0) + (e.key === 'ArrowUp' ? s : -s);
            const rounded = Math.round(next * 1e6) / 1e6;
            setDraft(String(rounded));
            commit(String(rounded));
          }
        }}
      />
      {suffix && <span className="absolute right-2.5 text-[12.5px] text-ink-3 pointer-events-none">{suffix}</span>}
    </div>
  );
}

function fmtDraft(v: number): string {
  if (!Number.isFinite(v)) return '0';
  return String(Math.round(v * 1e6) / 1e6);
}

export function TextInput({ value, onChange, placeholder, disabled, className, ariaLabel, id }: { value: string; onChange: (v: string) => void; placeholder?: string; disabled?: boolean; className?: string; ariaLabel?: string; id?: string }) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  return (
    <input
      id={id}
      aria-label={ariaLabel}
      className={cx('field', className)}
      value={draft}
      placeholder={placeholder}
      disabled={disabled}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => draft !== value && onChange(draft)}
      onKeyDown={(e) => e.key === 'Enter' && draft !== value && onChange(draft)}
    />
  );
}

export function TextArea({ value, onChange, rows = 3, disabled, ariaLabel }: { value: string; onChange: (v: string) => void; rows?: number; disabled?: boolean; ariaLabel?: string }) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  return <textarea aria-label={ariaLabel} className="field" rows={rows} value={draft} disabled={disabled} onChange={(e) => setDraft(e.target.value)} onBlur={() => draft !== value && onChange(draft)} />;
}

export function Select<T extends string>({ value, onChange, options, disabled, className, ariaLabel, id }: { value: T; onChange: (v: T) => void; options: { value: T; label: string }[]; disabled?: boolean; className?: string; ariaLabel?: string; id?: string }) {
  return (
    <select id={id} aria-label={ariaLabel} className={cx('field', className)} value={value} disabled={disabled} onChange={(e) => onChange(e.target.value as T)}>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

export function Toggle({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label?: ReactNode; disabled?: boolean }) {
  const id = useId();
  return (
    <label htmlFor={id} className={cx('inline-flex items-center gap-2 text-sm select-none', disabled ? 'opacity-50' : 'cursor-pointer')}>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cx('relative inline-flex h-5 w-9 shrink-0 rounded-full transition-colors', checked ? 'bg-brand' : 'bg-line')}
      >
        <span className={cx('absolute top-0.5 h-4 w-4 rounded-full bg-paper shadow transition-transform', checked ? 'translate-x-[18px]' : 'translate-x-0.5')} />
      </button>
      {label && <span className="text-ink-2">{label}</span>}
    </label>
  );
}

export function Checkbox({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label?: ReactNode; disabled?: boolean }) {
  return (
    <label className={cx('inline-flex items-center gap-2 text-sm', disabled ? 'opacity-50' : 'cursor-pointer')}>
      <input type="checkbox" className="h-4 w-4 accent-[var(--brand)]" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      {label && <span className="text-ink-2">{label}</span>}
    </label>
  );
}

// ───────────────────────────── Overlays ─────────────────────────────

export function Modal({ open, onClose, title, children, footer, wide }: { open: boolean; onClose: () => void; title: string; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  useEffect(() => {
    if (!open) return;
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center p-4 pt-[8vh] bg-black/40" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-modal="true" aria-label={title} className={cx('bg-paper rounded-xl border border-line shadow-2xl w-full max-h-[84vh] flex flex-col', wide ? 'max-w-3xl' : 'max-w-lg')}>
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-line">
          <h2 className="font-semibold text-ink">{title}</h2>
          <button type="button" aria-label="Close" onClick={onClose} className="text-ink-3 hover:text-ink">
            <X size={18} />
          </button>
        </div>
        <div className="px-5 py-4 overflow-y-auto">{children}</div>
        {footer && <div className="px-5 py-3 border-t border-line flex justify-end gap-2">{footer}</div>}
      </div>
    </div>
  );
}

/** Read-only notice shown when the current role cannot edit a section. */
export function ReadOnlyNote({ show, what = 'edit this section' }: { show: boolean; what?: string }) {
  if (!show) return null;
  return <p className="text-[12.5px] text-ink-3 mb-3">Your role can view but not {what}. Switch role in the top bar to make changes.</p>;
}

/** Small "i" hover hint. */
export function Hint({ text }: { text: string }) {
  return (
    <span className="inline-flex align-middle ml-1 text-ink-3 cursor-help" title={text} aria-label={text}>
      <Info size={13} />
    </span>
  );
}
