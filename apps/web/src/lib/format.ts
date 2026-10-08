import type { Decimal } from '@aies/engine';

type Val = Decimal | number | string | null | undefined;

export const n = (v: Val): number => {
  if (v === null || v === undefined) return 0;
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  if (typeof v === 'string') return Number(v) || 0;
  return v.toNumber();
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

const sym = (cur: string) => CURRENCY_SYMBOL[cur] ?? `${cur} `;
const locale = (cur: string) => (cur === 'INR' ? 'en-IN' : 'en-US');

/** Full currency amount, e.g. ₹18,58,811 or $1,234.56. */
export function money(v: Val, cur: string, dp?: number): string {
  const x = n(v);
  const d = dp ?? (Math.abs(x) >= 1000 ? 0 : Math.abs(x) >= 1 ? 2 : 4);
  const s = Math.abs(x).toLocaleString(locale(cur), { minimumFractionDigits: d, maximumFractionDigits: d });
  return `${x < 0 ? '−' : ''}${sym(cur)}${s}`;
}

/** Unit price with enough precision to be meaningful (₹37.84, ₹0.0062). */
export function unitPrice(v: Val, cur: string): string {
  const x = n(v);
  const a = Math.abs(x);
  const d = a === 0 ? 2 : a >= 100 ? 2 : a >= 1 ? 2 : a >= 0.01 ? 4 : 6;
  return money(x, cur, d);
}

/** Compact currency: ₹15.1 L, ₹2.19 Cr for INR; $1.2M elsewhere. */
export function compact(v: Val, cur: string): string {
  const x = n(v);
  const a = Math.abs(x);
  const sign = x < 0 ? '−' : '';
  if (cur === 'INR') {
    if (a >= 1e7) return `${sign}₹${trim(a / 1e7, a >= 1e9 ? 0 : 2)} Cr`;
    if (a >= 1e5) return `${sign}₹${trim(a / 1e5, a >= 1e6 ? 1 : 2)} L`;
    if (a >= 1000) return `${sign}₹${trim(a / 1000, 1)}K`;
    return `${sign}₹${trim(a, a >= 100 ? 0 : 2)}`;
  }
  const s = sym(cur);
  if (a >= 1e9) return `${sign}${s}${trim(a / 1e9, 2)}B`;
  if (a >= 1e6) return `${sign}${s}${trim(a / 1e6, 2)}M`;
  if (a >= 1e3) return `${sign}${s}${trim(a / 1e3, 1)}K`;
  return `${sign}${s}${trim(a, a >= 100 ? 0 : 2)}`;
}

function trim(x: number, dp: number): string {
  return x.toFixed(dp).replace(/\.0+$/, '').replace(/(\.\d*?)0+$/, '$1');
}

export function num(v: Val, dp = 0): string {
  return n(v).toLocaleString('en-US', { minimumFractionDigits: dp, maximumFractionDigits: dp });
}

/** Indian-style grouping for counts when the project is in INR. */
export function count(v: Val, cur = 'USD', dp = 0): string {
  return n(v).toLocaleString(locale(cur), { minimumFractionDigits: dp, maximumFractionDigits: dp });
}

export function compactCount(v: Val): string {
  const a = Math.abs(n(v));
  const sign = n(v) < 0 ? '−' : '';
  if (a >= 1e9) return `${sign}${trim(a / 1e9, 2)}B`;
  if (a >= 1e6) return `${sign}${trim(a / 1e6, 2)}M`;
  if (a >= 1e4) return `${sign}${trim(a / 1e3, 1)}K`;
  return `${sign}${trim(a, a >= 100 ? 0 : 1)}`;
}

export function pct(v: Val, dp = 1): string {
  const x = n(v);
  return `${x < 0 ? '−' : ''}${Math.abs(x).toFixed(dp)}%`;
}

export function signedPct(v: Val, dp = 1): string {
  const x = n(v);
  return `${x > 0 ? '+' : x < 0 ? '−' : ''}${Math.abs(x).toFixed(dp)}%`;
}

export function tokens(v: Val): string {
  const a = n(v);
  if (a >= 1e9) return `${trim(a / 1e9, 2)}B`;
  if (a >= 1e6) return `${trim(a / 1e6, 1)}M`;
  if (a >= 1e3) return `${trim(a / 1e3, 1)}K`;
  return trim(a, 0);
}

export function months(v: number | null | undefined): string {
  if (v === null || v === undefined) return 'Not within term';
  if (v === 0) return 'Immediate';
  return `${v.toFixed(1)} months`;
}

export function periodLabel(yyyymm: string): string {
  const [y, m] = yyyymm.split('-').map(Number);
  if (!y || !m) return yyyymm;
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleString('en-US', { month: 'short', year: '2-digit', timeZone: 'UTC' });
}

export function dateTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
  } catch {
    return iso;
  }
}
