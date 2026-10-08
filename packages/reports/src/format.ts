/**
 * Presentation formatting only — no financial arithmetic. Deterministic and
 * locale-independent (Indian digit grouping is implemented here rather than
 * relying on the host's ICU data, so Node and every browser agree).
 */
import type { Decimal } from '@aies/engine';

export type Val = Decimal | number | string | null | undefined;

export const n = (v: Val): number => {
  if (v === null || v === undefined) return 0;
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  if (typeof v === 'string') return Number(v) || 0;
  const x = v.toNumber();
  return Number.isFinite(x) ? x : 0;
};

export const CURRENCY_SYMBOL: Record<string, string> = {
  INR: '₹',
  USD: '$',
  EUR: '€',
  GBP: '£',
  AUD: 'A$',
  SGD: 'S$',
  AED: 'AED ',
  JPY: '¥',
};

export const symbol = (cur: string): string => CURRENCY_SYMBOL[cur] ?? `${cur} `;
const MINUS = '−';

function group(intDigits: string, indian: boolean): string {
  if (indian && intDigits.length > 3) {
    const last3 = intDigits.slice(-3);
    let rest = intDigits.slice(0, -3);
    const parts: string[] = [];
    while (rest.length > 2) {
      parts.unshift(rest.slice(-2));
      rest = rest.slice(0, -2);
    }
    if (rest) parts.unshift(rest);
    return `${parts.join(',')},${last3}`;
  }
  return intDigits.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/** Fixed-decimal number with digit grouping (Indian grouping when `indian`). */
export function grouped(x: number, dp: number, indian = false): string {
  const fixed = Math.abs(x).toFixed(dp);
  const [i, f] = fixed.split('.');
  const body = f ? `${group(i, indian)}.${f}` : group(i, indian);
  const isZero = Number(fixed) === 0;
  return `${x < 0 && !isZero ? MINUS : ''}${body}`;
}

function trim(x: number, dp: number): string {
  return x.toFixed(dp).replace(/\.0+$/, '').replace(/(\.\d*?)0+$/, '$1');
}

/** Full currency amount: ₹18,58,811 or $1,234.56. */
export function money(v: Val, cur: string, dp?: number): string {
  const x = n(v);
  const d = dp ?? (Math.abs(x) >= 1000 ? 0 : Math.abs(x) >= 1 ? 2 : Math.abs(x) === 0 ? 0 : 4);
  const s = grouped(Math.abs(x), d, cur === 'INR');
  const isZero = Number(Math.abs(x).toFixed(d)) === 0;
  return `${x < 0 && !isZero ? MINUS : ''}${symbol(cur)}${s}`;
}

/** Unit price with enough precision to be meaningful (₹37.84, ₹0.0062). */
export function unitPrice(v: Val, cur: string): string {
  const a = Math.abs(n(v));
  const d = a === 0 ? 2 : a >= 1 ? 2 : a >= 0.01 ? 4 : 6;
  return money(v, cur, d);
}

/** Compact currency: ₹15.1 L, ₹2.19 Cr for INR; $1.2M elsewhere. */
export function compact(v: Val, cur: string): string {
  const x = n(v);
  const a = Math.abs(x);
  const sign = x < 0 && a >= 0.005 ? MINUS : '';
  const s = symbol(cur);
  if (cur === 'INR') {
    if (a >= 1e7) return `${sign}${s}${trim(a / 1e7, a >= 1e9 ? 0 : 2)} Cr`;
    if (a >= 1e5) return `${sign}${s}${trim(a / 1e5, a >= 1e6 ? 1 : 2)} L`;
    if (a >= 1000) return `${sign}${s}${trim(a / 1000, 1)}K`;
    return `${sign}${s}${trim(a, a >= 100 ? 0 : 2)}`;
  }
  if (a >= 1e9) return `${sign}${s}${trim(a / 1e9, 2)}B`;
  if (a >= 1e6) return `${sign}${s}${trim(a / 1e6, 2)}M`;
  if (a >= 1e3) return `${sign}${s}${trim(a / 1e3, 1)}K`;
  return `${sign}${s}${trim(a, a >= 100 ? 0 : 2)}`;
}

/** Counts with grouping (Indian grouping for INR projects). */
export function count(v: Val, cur = 'USD', dp = 0): string {
  return grouped(n(v), dp, cur === 'INR');
}

export function compactCount(v: Val): string {
  const x = n(v);
  const a = Math.abs(x);
  const sign = x < 0 ? MINUS : '';
  if (a >= 1e9) return `${sign}${trim(a / 1e9, 2)}B`;
  if (a >= 1e6) return `${sign}${trim(a / 1e6, 2)}M`;
  if (a >= 1e4) return `${sign}${trim(a / 1e3, 1)}K`;
  return `${sign}${trim(a, a >= 100 ? 0 : 1)}`;
}

/** Percentage from an engine percent value (0–100 scale). */
export function pct(v: Val, dp = 1): string {
  const x = n(v);
  const s = Math.abs(x).toFixed(dp);
  return `${x < 0 && Number(s) !== 0 ? MINUS : ''}${s}%`;
}

export function signedPct(v: Val, dp = 1): string {
  const x = n(v);
  const s = Math.abs(x).toFixed(dp);
  return `${x > 0 && Number(s) !== 0 ? '+' : x < 0 && Number(s) !== 0 ? MINUS : ''}${s}%`;
}

export function tokens(v: Val): string {
  const a = n(v);
  if (Math.abs(a) >= 1e9) return `${trim(a / 1e9, 2)}B`;
  if (Math.abs(a) >= 1e6) return `${trim(a / 1e6, 1)}M`;
  if (Math.abs(a) >= 1e3) return `${trim(a / 1e3, 1)}K`;
  return trim(a, 0);
}

export function decimal(v: Val, dp = 2): string {
  return grouped(n(v), dp, false);
}

export function months(v: number | null | undefined): string {
  if (v === null || v === undefined) return 'Not within term';
  if (v === 0) return 'Immediate';
  return `${v.toFixed(1)} months`;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function periodLabel(yyyymm: string): string {
  const [y, m] = (yyyymm || '').split('-').map(Number);
  if (!y || !m) return yyyymm;
  return `${MONTHS[m - 1]} ${String(y).slice(-2)}`;
}

export function dateLabel(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

export function yesNo(b: boolean): string {
  return b ? 'Yes' : 'No';
}

/** Sentence-case an enum-like identifier: "finance_validated" → "Finance validated". */
export function humanize(s: string): string {
  const t = (s || '').replace(/_/g, ' ').trim();
  return t ? t[0].toUpperCase() + t.slice(1) : t;
}

/** Scale for chart axes so large currency values read in lakh/crore (INR) or K/M/B. */
export function chartScale(maxAbs: number, valueFormat: 'currency' | 'number' | 'percent', cur: string): { div: number; suffix: string } {
  if (valueFormat === 'percent') return { div: 1, suffix: '%' };
  if (valueFormat === 'currency' && cur === 'INR') {
    if (maxAbs >= 1e7) return { div: 1e7, suffix: 'Cr' };
    if (maxAbs >= 1e5) return { div: 1e5, suffix: 'L' };
    if (maxAbs >= 1e3) return { div: 1e3, suffix: 'K' };
    return { div: 1, suffix: '' };
  }
  if (maxAbs >= 1e9) return { div: 1e9, suffix: 'B' };
  if (maxAbs >= 1e6) return { div: 1e6, suffix: 'M' };
  if (maxAbs >= 1e3) return { div: 1e3, suffix: 'K' };
  return { div: 1, suffix: '' };
}

/** Axis tick label for a chart value. */
export function axisLabel(v: number, scale: { div: number; suffix: string }, valueFormat: 'currency' | 'number' | 'percent', cur: string): string {
  const x = v / scale.div;
  const a = Math.abs(x);
  const body = a >= 100 ? trim(x, 0) : a >= 10 ? trim(x, 1) : trim(x, 2);
  if (valueFormat === 'percent') return `${body}%`;
  const pre = valueFormat === 'currency' ? symbol(cur) : '';
  const suf = scale.suffix ? (scale.suffix === 'L' || scale.suffix === 'Cr' ? ` ${scale.suffix}` : scale.suffix) : '';
  return `${x < 0 ? MINUS : ''}${pre}${body.replace('-', '')}${suf}`;
}

/** Value label for a chart data point (compact). */
export function chartValue(v: number, valueFormat: 'currency' | 'number' | 'percent', cur: string): string {
  if (valueFormat === 'currency') return compact(v, cur);
  if (valueFormat === 'percent') return pct(v);
  return compactCount(v);
}
