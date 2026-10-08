import type { Catalog, CostPool, Decimal, ProjectResult, StreamPrice } from '@aies/engine';
import { RUN_POOLS } from '@aies/engine';
import type { ReportChart, ReportKpi, ReportSection, ReportTable } from '../types';
import { compact, count, humanize, money, n, pct, unitPrice } from '../format';
import { names, poolLabel, type Names } from '../util';

export interface Ctx {
  r: ProjectResult;
  catalog: Catalog;
  cur: string;
  nm: Names;
  /** Full money (detail tables). */
  m: (v: Decimal | number) => string;
  /** Compact money (KPIs, summaries). */
  c: (v: Decimal | number) => string;
  /** Unit price precision. */
  u: (v: Decimal | number) => string;
  /** Counts with currency-appropriate grouping. */
  k: (v: Decimal | number, dp?: number) => string;
}

export function ctx(r: ProjectResult, catalog: Catalog): Ctx {
  const cur = r.currency;
  return {
    r,
    catalog,
    cur,
    nm: names(r, catalog),
    m: (v) => money(v, cur),
    c: (v) => compact(v, cur),
    u: (v) => unitPrice(v, cur),
    k: (v, dp = 0) => count(v, cur, dp),
  };
}

export const kpi = (label: string, value: string, note?: string): ReportKpi => (note ? { label, value, note } : { label, value });

export function table(columns: string[], rows: string[][], opts: { align?: ('left' | 'right')[]; footer?: string[] } = {}): ReportTable {
  const align = opts.align ?? columns.map((_, i) => (i === 0 ? 'left' : 'right'));
  const t: ReportTable = { columns, rows, align };
  if (opts.footer) t.footer = opts.footer;
  return t;
}

export function chart(kind: ReportChart['kind'], title: string, categories: string[], series: { name: string; values: (number | Decimal)[] }[], valueFormat: ReportChart['valueFormat']): ReportChart {
  return { kind, title, categories, series: series.map((s) => ({ name: s.name, values: s.values.map((v) => n(v)) })), valueFormat };
}

export function section(heading: string, parts: Omit<ReportSection, 'heading'>): ReportSection {
  const s: ReportSection = { heading };
  if (parts.paragraphs?.length) s.paragraphs = parts.paragraphs;
  if (parts.kpis?.length) s.kpis = parts.kpis;
  if (parts.table) s.table = parts.table;
  if (parts.chart) s.chart = parts.chart;
  return s;
}

/** Run pools with a non-zero steady-state cost, in canonical order. */
export function activePools(x: Ctx): CostPool[] {
  return RUN_POOLS.filter((p) => !x.r.baseline.pools[p].isZero());
}

export function streamOf(x: Ctx, type: StreamPrice['type']): StreamPrice | undefined {
  return x.r.priceBook.streams.find((s) => s.type === type);
}

export function steadyStreamRevenue(x: Ctx, streamId: string): Decimal | number {
  return x.r.steady.revenueByStream[streamId] ?? 0;
}

export function poolList(pools: CostPool[]): string {
  return pools.map((p) => poolLabel(p)).join(', ');
}

/** Human description of a stream's price basis. */
export function priceBasis(x: Ctx, s: StreamPrice): string {
  switch (s.type) {
    case 'fixed_fee':
      return `${x.c(s.oneTimeFee ?? 0)} one-time`;
    case 'fixed_monthly':
    case 'agentops':
      return `${x.c(s.monthlyFee ?? 0)} per month`;
    case 'acu':
      return `${x.u(s.unitPrice ?? 0)} per ACU`;
    case 'abu':
      return `${x.u(s.abu?.blendedPrice ?? 0)} per weighted ABU (blended)`;
    case 'subscription': {
      const sub = s.subscription;
      if (!sub) return `${x.c(s.monthlyFee ?? 0)} per month`;
      const inc = sub.includedUnit === 'none' ? '' : ` including ${x.k(sub.includedQty)} ${sub.includedUnit.toUpperCase()}s`;
      return `${x.c(sub.totalFee)} per month${inc}`;
    }
    case 'pass_through':
      return `Actual cost plus ${pct(x.r.priceBook.passThroughMarkupPct, 0)} handling`;
    case 'gainshare':
      return `${pct(s.gainshare?.sharePct ?? 0, 0)} of ${s.gainshare?.basis === 'all' ? 'forecast' : 'validated'} benefits above threshold`;
  }
}

export function streamTypeLabel(t: StreamPrice['type']): string {
  const map: Record<StreamPrice['type'], string> = {
    fixed_fee: 'One-time fee',
    fixed_monthly: 'Fixed monthly fee',
    acu: 'ACU consumption',
    abu: 'ABU transactions',
    subscription: 'Subscription',
    agentops: 'Managed AgentOps',
    pass_through: 'Pass-through',
    gainshare: 'Gainshare',
  };
  return map[t] ?? humanize(t);
}

export function periodRange(x: Ctx): string {
  const months = x.r.months;
  const first = months.find((m) => m.month === 1)?.period ?? x.r.project.goLiveDate;
  const last = months[months.length - 1]?.period ?? first;
  return `${first} to ${last}`;
}

export function shareOf(part: Decimal | number, total: Decimal | number): string {
  const t = n(total);
  return t === 0 ? '0.0%' : pct((n(part) / t) * 100);
}
