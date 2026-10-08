/**
 * Chart components (Recharts) following the data-viz spec: thin marks (≤24px bars,
 * 2px lines), 4px rounded data ends, recessive hairline grid, one y-axis, a legend
 * for ≥2 series, hover tooltips where the value leads, and a table view for every chart.
 * Colours come from CSS tokens, so light/dark themes swap in one place.
 */
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Bar, BarChart, CartesianGrid, Cell, LabelList, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis, Area, ComposedChart } from 'recharts';
import { Table2, BarChart3 } from 'lucide-react';
import type { CostPool } from '@aies/engine';
import { cx } from './ui';

export const POOL_COLOR: Record<CostPool, string> = {
  LLM: '--s1',
  AGENTOPS: '--s2',
  INFRASTRUCTURE: '--s3',
  HUMAN_REVIEW: '--s4',
  DOCUMENT: '--s5',
  RAG: '--s6',
  ORCHESTRATION: '--s7',
  OTHER: '--s8',
  IMPLEMENTATION: '--ink-3',
};

export const SERIES = ['--s1', '--s2', '--s3', '--s4', '--s5', '--s6', '--s7', '--s8'];

/** Resolve CSS variables to concrete colours (SVG attributes need real values); re-resolves on theme change. */
export function useColors(): (v: string) => string {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const mq = window.matchMedia?.('(prefers-color-scheme: dark)');
    const on = () => setTick((t) => t + 1);
    mq?.addEventListener?.('change', on);
    const mo = new MutationObserver(on);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => {
      mq?.removeEventListener?.('change', on);
      mo.disconnect();
    };
  }, []);
  return useMemo(() => {
    const cs = getComputedStyle(document.documentElement);
    const cache = new Map<string, string>();
    return (v: string) => {
      if (!v.startsWith('--')) return v;
      if (!cache.has(v)) cache.set(v, cs.getPropertyValue(v).trim() || '#888');
      return cache.get(v)!;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick]);
}

export interface SeriesDef {
  key: string;
  label: string;
  color: string; // CSS variable name, e.g. '--s1'
}

type Fmt = (v: number) => string;

// ───────────────────────────── Frame with legend + table view ─────────────────────────────

export function ChartFrame({
  title,
  description,
  legend,
  children,
  table,
  actions,
  className,
  legendShape = 'rect',
}: {
  title?: ReactNode;
  description?: ReactNode;
  legend?: SeriesDef[];
  children: ReactNode;
  table?: { columns: string[]; rows: (string | number)[][] };
  actions?: ReactNode;
  className?: string;
  legendShape?: 'rect' | 'line';
}) {
  const [showTable, setShowTable] = useState(false);
  const color = useColors();
  return (
    <figure className={cx('bg-paper border border-line rounded-[10px] min-w-0 m-0', className)}>
      <div className="flex items-start justify-between gap-3 px-4 pt-3.5">
        <div className="min-w-0">
          {title && <figcaption className="text-[15px] font-semibold text-ink leading-snug">{title}</figcaption>}
          {description && <p className="text-[13px] text-ink-3 mt-0.5 leading-snug">{description}</p>}
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {actions}
          {table && (
            <button
              type="button"
              onClick={() => setShowTable((s) => !s)}
              className="inline-flex items-center gap-1 text-[12.5px] font-semibold text-ink-3 hover:text-ink px-1.5 py-1 rounded"
              aria-pressed={showTable}
              title={showTable ? 'Show chart' : 'Show data table'}
            >
              {showTable ? <BarChart3 size={14} /> : <Table2 size={14} />}
              {showTable ? 'Chart' : 'Table'}
            </button>
          )}
        </div>
      </div>
      {legend && legend.length > 1 && !showTable && (
        <ul className="flex flex-wrap gap-x-4 gap-y-1 px-4 pt-2 text-[12.5px] text-ink-2">
          {legend.map((s) => (
            <li key={s.key} className="inline-flex items-center gap-1.5">
              <span
                aria-hidden
                className={legendShape === 'line' ? 'inline-block w-3.5 h-[2px] rounded' : 'inline-block w-2.5 h-2.5 rounded-[3px]'}
                style={{ background: color(s.color) }}
              />
              {s.label}
            </li>
          ))}
        </ul>
      )}
      <div className="px-2 pb-3 pt-2">
        {showTable && table ? (
          <div className="scroll-x px-2 max-h-[340px] overflow-y-auto">
            <table className="dtable">
              <thead>
                <tr>
                  {table.columns.map((c, i) => (
                    <th key={i} className={i ? 'r' : ''}>
                      {c}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {table.rows.map((r, i) => (
                  <tr key={i}>
                    {r.map((c, j) => (
                      <td key={j} className={j ? 'r' : ''}>
                        {c}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          children
        )}
      </div>
    </figure>
  );
}

// ───────────────────────────── Tooltip ─────────────────────────────

interface TipPayload {
  name?: string;
  value?: number;
  color?: string;
  dataKey?: string | number;
  payload?: Record<string, unknown>;
}

export function ChartTooltip({ active, payload, label, format, series, labelFormat }: { active?: boolean; payload?: TipPayload[]; label?: string | number; format: Fmt; series?: SeriesDef[]; labelFormat?: (l: string) => string }) {
  const color = useColors();
  if (!active || !payload?.length) return null;
  const rows = payload.filter((p) => p.value !== undefined && p.dataKey !== '__base');
  const total = rows.reduce((a, p) => a + (Number(p.value) || 0), 0);
  return (
    <div className="bg-paper border border-line rounded-lg shadow-lg px-3 py-2 text-[12.5px] min-w-[160px]">
      <div className="text-ink-3 mb-1">{labelFormat ? labelFormat(String(label)) : label}</div>
      {rows
        .slice()
        .reverse()
        .map((p, i) => {
          const s = series?.find((x) => x.key === p.dataKey);
          return (
            <div key={i} className="flex items-center justify-between gap-3 py-[1px]">
              <span className="inline-flex items-center gap-1.5 text-ink-2">
                <span className="inline-block w-3 h-[2px] rounded" style={{ background: s ? color(s.color) : p.color }} />
                {s?.label ?? p.name}
              </span>
              <span className="num font-semibold text-ink">{format(Number(p.value))}</span>
            </div>
          );
        })}
      {rows.length > 2 && (
        <div className="flex justify-between gap-3 border-t border-line-soft mt-1 pt-1">
          <span className="text-ink-3">Total</span>
          <span className="num font-semibold text-ink">{format(total)}</span>
        </div>
      )}
    </div>
  );
}

// ───────────────────────────── Stacked / grouped bars ─────────────────────────────

export function StackedBars({
  data,
  series,
  xKey,
  format,
  height = 260,
  stacked = true,
  labelFormat,
}: {
  data: Record<string, unknown>[];
  series: SeriesDef[];
  xKey: string;
  format: Fmt;
  height?: number;
  stacked?: boolean;
  labelFormat?: (l: string) => string;
}) {
  const color = useColors();
  const surface = color('--paper');
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 4 }} barCategoryGap="28%">
        <CartesianGrid vertical={false} />
        <XAxis dataKey={xKey} tickLine={false} axisLine={{ stroke: color('--line') }} tickFormatter={labelFormat} interval="preserveStartEnd" minTickGap={12} />
        <YAxis tickLine={false} axisLine={false} tickFormatter={(v) => format(v)} width={64} />
        <Tooltip cursor={{ fill: color('--line-soft') }} content={<ChartTooltip format={format} series={series} labelFormat={labelFormat} />} />
        {series.map((s, i) => (
          <Bar
            key={s.key}
            dataKey={s.key}
            name={s.label}
            stackId={stacked ? 'a' : undefined}
            fill={color(s.color)}
            stroke={stacked ? surface : undefined}
            strokeWidth={stacked ? 1 : 0}
            maxBarSize={stacked ? 28 : 18}
            radius={!stacked || i === series.length - 1 ? [4, 4, 0, 0] : 0}
            isAnimationActive={false}
          />
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}

// ───────────────────────────── Lines ─────────────────────────────

export function Lines({
  data,
  series,
  xKey,
  format,
  height = 260,
  labelFormat,
  area,
  reference,
}: {
  data: Record<string, unknown>[];
  series: SeriesDef[];
  xKey: string;
  format: Fmt;
  height?: number;
  labelFormat?: (l: string) => string;
  area?: string;
  reference?: { y: number; label: string };
}) {
  const color = useColors();
  return (
    <ResponsiveContainer width="100%" height={height}>
      <ComposedChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: 4 }}>
        <CartesianGrid vertical={false} />
        <XAxis dataKey={xKey} tickLine={false} axisLine={{ stroke: color('--line') }} tickFormatter={labelFormat} interval="preserveStartEnd" minTickGap={16} />
        <YAxis tickLine={false} axisLine={false} tickFormatter={(v) => format(v)} width={64} />
        <Tooltip cursor={{ stroke: color('--ink-3'), strokeWidth: 1 }} content={<ChartTooltip format={format} series={series} labelFormat={labelFormat} />} />
        {reference && <ReferenceLine y={reference.y} stroke={color('--ink-3')} strokeDasharray="0" label={{ value: reference.label, position: 'insideTopLeft', fill: color('--ink-3'), fontSize: 12 }} />}
        {series.map((s) =>
          area === s.key ? (
            <Area key={s.key} type="monotone" dataKey={s.key} name={s.label} stroke={color(s.color)} strokeWidth={2} fill={color(s.color)} fillOpacity={0.1} dot={false} activeDot={{ r: 4, stroke: color('--paper'), strokeWidth: 2 }} isAnimationActive={false} />
          ) : (
            <Line key={s.key} type="monotone" dataKey={s.key} name={s.label} stroke={color(s.color)} strokeWidth={2} dot={false} activeDot={{ r: 4, stroke: color('--paper'), strokeWidth: 2 }} isAnimationActive={false} />
          ),
        )}
      </ComposedChart>
    </ResponsiveContainer>
  );
}

// ───────────────────────────── Waterfall ─────────────────────────────

export interface WaterfallStep {
  label: string;
  value: number;
  kind: 'start' | 'delta' | 'end';
}

/** Totals in neutral ink; increases red, decreases blue (diverging pair), each with a signed label. */
export function Waterfall({ steps, format, height = 280, increaseIsBad = true }: { steps: WaterfallStep[]; format: Fmt; height?: number; increaseIsBad?: boolean }) {
  const color = useColors();
  let running = 0;
  const data = steps.map((s) => {
    if (s.kind === 'start' || s.kind === 'end') {
      running = s.value;
      return { label: s.label, __base: 0, value: s.value, raw: s.value, kind: s.kind };
    }
    const base = s.value >= 0 ? running : running + s.value;
    running += s.value;
    return { label: s.label, __base: base, value: Math.abs(s.value), raw: s.value, kind: s.kind };
  });
  const fill = (d: (typeof data)[number]) => (d.kind !== 'delta' ? color('--ink-3') : (d.raw >= 0) === increaseIsBad ? color('--s8') : color('--s1'));
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 22, right: 8, bottom: 0, left: 4 }} barCategoryGap="22%">
        <CartesianGrid vertical={false} />
        <XAxis dataKey="label" tickLine={false} axisLine={{ stroke: color('--line') }} interval={0} tick={{ fontSize: 11.5 }} height={44} tickFormatter={(l: string) => (l.length > 14 ? l.slice(0, 13) + '…' : l)} />
        <YAxis tickLine={false} axisLine={false} tickFormatter={(v) => format(v)} width={64} />
        <Tooltip
          cursor={{ fill: color('--line-soft') }}
          content={({ active, payload }) => {
            if (!active || !payload?.length) return null;
            const d = payload[0].payload as (typeof data)[number];
            return (
              <div className="bg-paper border border-line rounded-lg shadow-lg px-3 py-2 text-[12.5px]">
                <div className="text-ink-3">{d.label}</div>
                <div className="num font-semibold text-ink">{d.kind === 'delta' ? `${d.raw >= 0 ? '+' : '−'}${format(Math.abs(d.raw))}` : format(d.raw)}</div>
              </div>
            );
          }}
        />
        <Bar dataKey="__base" stackId="w" fill="transparent" isAnimationActive={false} />
        <Bar dataKey="value" stackId="w" maxBarSize={40} radius={[4, 4, 4, 4]} isAnimationActive={false}>
          {data.map((d, i) => (
            <Cell key={i} fill={fill(d)} />
          ))}
          <LabelList
            dataKey="raw"
            position="top"
            content={(props) => {
              const { x, y, width, value } = props as { x: number; y: number; width: number; value: number };
              const i = (props as { index: number }).index;
              const d = data[i];
              const text = d.kind === 'delta' ? `${value >= 0 ? '+' : '−'}${format(Math.abs(value))}` : format(value);
              return (
                <text x={x + width / 2} y={y - 6} textAnchor="middle" fontSize={11.5} fill={color('--ink-2')} className="num">
                  {text}
                </text>
              );
            }}
          />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

// ───────────────────────────── Tornado ─────────────────────────────

export interface TornadoRow {
  driver: string;
  low: number;
  high: number;
  lowLabel: string;
  highLabel: string;
}

export function Tornado({ rows, base, format, height }: { rows: TornadoRow[]; base: number; format: Fmt; height?: number }) {
  const color = useColors();
  const data = rows.map((r) => ({ driver: r.driver, lowDelta: r.low - base, highDelta: r.high - base, low: r.low, high: r.high, lowLabel: r.lowLabel, highLabel: r.highLabel }));
  const h = height ?? Math.max(200, rows.length * 30 + 40);
  return (
    <ResponsiveContainer width="100%" height={h}>
      <BarChart data={data} layout="vertical" margin={{ top: 4, right: 24, bottom: 4, left: 8 }} barCategoryGap="30%" stackOffset="sign">
        <CartesianGrid horizontal={false} />
        <XAxis type="number" tickLine={false} axisLine={false} tickFormatter={(v) => format(v)} />
        <YAxis type="category" dataKey="driver" tickLine={false} axisLine={false} width={136} tick={{ fontSize: 12.5 }} />
        <ReferenceLine x={0} stroke={color('--ink-3')} />
        <Tooltip
          cursor={{ fill: color('--line-soft') }}
          content={({ active, payload }) => {
            if (!active || !payload?.length) return null;
            const d = payload[0].payload as (typeof data)[number];
            return (
              <div className="bg-paper border border-line rounded-lg shadow-lg px-3 py-2 text-[12.5px] min-w-[180px]">
                <div className="font-semibold text-ink mb-1">{d.driver}</div>
                <div className="flex justify-between gap-3"><span className="text-ink-2">{d.lowLabel}</span><span className="num font-semibold">{format(d.lowDelta)}</span></div>
                <div className="flex justify-between gap-3"><span className="text-ink-2">{d.highLabel}</span><span className="num font-semibold">{format(d.highDelta)}</span></div>
              </div>
            );
          }}
        />
        <Bar dataKey="lowDelta" stackId="t" maxBarSize={18} isAnimationActive={false}>
          {data.map((d, i) => (
            <Cell key={i} fill={d.lowDelta >= 0 ? color('--s1') : color('--s8')} />
          ))}
        </Bar>
        <Bar dataKey="highDelta" stackId="t" maxBarSize={18} isAnimationActive={false}>
          {data.map((d, i) => (
            <Cell key={i} fill={d.highDelta >= 0 ? color('--s1') : color('--s8')} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

// ───────────────────────────── HTML bar list (breakdowns) ─────────────────────────────

/** Ranked horizontal bars in HTML — crisp labels, accessible, no axis needed. */
export function BarList({ items, format, color = '--accent-series', total, max: maxOverride }: { items: { label: ReactNode; value: number; color?: string; sub?: ReactNode }[]; format: Fmt; color?: string; total?: number; max?: number }) {
  const c = useColors();
  const max = maxOverride ?? Math.max(...items.map((i) => Math.abs(i.value)), 1e-9);
  const sumAll = total ?? items.reduce((a, i) => a + i.value, 0);
  return (
    <ul className="space-y-2.5">
      {items.map((it, k) => (
        <li key={k} className="min-w-0">
          <div className="flex items-baseline justify-between gap-3 text-[13.5px]">
            <span className="text-ink-2 truncate">{it.label}</span>
            <span className="num font-semibold text-ink shrink-0">
              {format(it.value)}
              {sumAll > 0 && <span className="text-ink-3 font-normal ml-1.5 text-[12px]">{((it.value / sumAll) * 100).toFixed(0)}%</span>}
            </span>
          </div>
          <div className="h-[6px] mt-1 rounded-full bg-line-soft overflow-hidden" aria-hidden>
            <div className="h-full rounded-full" style={{ width: `${Math.max(0, (Math.abs(it.value) / max) * 100)}%`, background: c(it.color ?? color) }} />
          </div>
          {it.sub && <div className="text-[12px] text-ink-3 mt-0.5">{it.sub}</div>}
        </li>
      ))}
    </ul>
  );
}

/** Proportional stacked strip (composition of one total) with legend below. */
export function CompositionBar({ parts, format }: { parts: { key: string; label: string; value: number; color: string }[]; format: Fmt }) {
  const c = useColors();
  const total = parts.reduce((a, p) => a + Math.max(0, p.value), 0) || 1;
  const visible = parts.filter((p) => p.value > 0);
  return (
    <div>
      <div className="flex h-3 rounded-full overflow-hidden gap-[2px] bg-paper" role="img" aria-label="Composition">
        {visible.map((p) => (
          <div key={p.key} title={`${p.label}: ${format(p.value)}`} style={{ width: `${(p.value / total) * 100}%`, background: c(p.color) }} />
        ))}
      </div>
      <ul className="grid grid-cols-[repeat(auto-fill,minmax(230px,1fr))] gap-x-4 gap-y-1.5 mt-3 text-[13px]">
        {visible.map((p) => (
          <li key={p.key} className="flex items-center justify-between gap-2 min-w-0">
            <span className="inline-flex items-center gap-1.5 text-ink-2 truncate">
              <span className="w-2.5 h-2.5 rounded-[3px] shrink-0" style={{ background: c(p.color) }} />
              {p.label}
            </span>
            <span className="num text-ink font-medium">
              {format(p.value)} <span className="text-ink-3 text-[12px]">{((p.value / total) * 100).toFixed(0)}%</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Single-series bars, brand accent, value on the cap (used for funnels, by-year figures). */
export function SimpleBars({ data, xKey, yKey, format, height = 220, colorVar = '--accent-series', labels = true }: { data: Record<string, unknown>[]; xKey: string; yKey: string; format: Fmt; height?: number; colorVar?: string; labels?: boolean }) {
  const color = useColors();
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 20, right: 8, bottom: 0, left: 4 }} barCategoryGap="30%">
        <CartesianGrid vertical={false} />
        <XAxis dataKey={xKey} tickLine={false} axisLine={{ stroke: color('--line') }} interval={0} tick={{ fontSize: 12 }} />
        <YAxis tickLine={false} axisLine={false} tickFormatter={(v) => format(v)} width={64} />
        <Tooltip cursor={{ fill: color('--line-soft') }} content={<ChartTooltip format={format} series={[{ key: yKey, label: yKey, color: colorVar }]} />} />
        <Bar dataKey={yKey} fill={color(colorVar)} maxBarSize={36} radius={[4, 4, 0, 0]} isAnimationActive={false}>
          {labels && <LabelList dataKey={yKey} position="top" formatter={(v: unknown) => format(Number(v))} style={{ fontSize: 11.5, fill: color('--ink-2') }} />}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
