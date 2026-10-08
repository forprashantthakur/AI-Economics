/**
 * Decimal-safe arithmetic helpers.
 *
 * Every monetary and unit-price calculation in the engine runs on decimal.js
 * (base-10 arbitrary precision), never on binary floating point. Inputs arrive
 * as plain JSON numbers (so projects serialise cleanly), are lifted into
 * Decimal at the boundary, and results are returned as Decimal. Decimal's
 * toJSON() emits a string, so API responses never lose precision.
 */
import Decimal from 'decimal.js';

Decimal.set({ precision: 34, rounding: Decimal.ROUND_HALF_UP });

export { Decimal };
export type Dec = Decimal;
export type DecLike = Decimal | number | string;

export const ZERO = new Decimal(0);
export const ONE = new Decimal(1);
export const HUNDRED = new Decimal(100);
export const MILLION = new Decimal(1_000_000);

/** Lift a value into Decimal. null/undefined/NaN become 0. */
export function D(v: DecLike | null | undefined): Decimal {
  if (v === null || v === undefined) return ZERO;
  if (v instanceof Decimal) return v;
  if (typeof v === 'number' && !Number.isFinite(v)) return ZERO;
  return new Decimal(v);
}

/** Percentage (e.g. 35) → fraction (0.35). */
export function pct(v: DecLike | null | undefined): Decimal {
  return D(v).div(100);
}

export function sum(values: Iterable<DecLike>): Decimal {
  let acc = ZERO;
  for (const v of values) acc = acc.plus(D(v));
  return acc;
}

/** Division that returns 0 (not Infinity/NaN) when the denominator is 0. */
export function safeDiv(a: DecLike, b: DecLike): Decimal {
  const den = D(b);
  if (den.isZero()) return ZERO;
  return D(a).div(den);
}

export function max(a: DecLike, b: DecLike): Decimal {
  return Decimal.max(D(a), D(b));
}

export function min(a: DecLike, b: DecLike): Decimal {
  return Decimal.min(D(a), D(b));
}

export function clamp(v: DecLike, lo: DecLike, hi: DecLike): Decimal {
  return min(max(v, lo), hi);
}

/** Price that yields `marginPct` gross margin on `cost`: cost / (1 - margin). */
export function priceForMargin(cost: DecLike, marginPct: DecLike): Decimal {
  const m = pct(marginPct);
  if (m.gte(1)) throw new Error('Target gross margin must be below 100%');
  return D(cost).div(ONE.minus(m));
}

/** Gross margin % from revenue and cost. 0 when revenue is 0. */
export function marginPct(revenue: DecLike, cost: DecLike): Decimal {
  const r = D(revenue);
  if (r.isZero()) return ZERO;
  return r.minus(D(cost)).div(r).times(100);
}

/** (1 + rate%)^n — annual compounding helper. */
export function compound(ratePct: DecLike, n: number): Decimal {
  return ONE.plus(pct(ratePct)).pow(n);
}

/** Round to currency (2 dp) — used only for presentation / invoices, never mid-calculation. */
export function money(v: DecLike, dp = 2): Decimal {
  return D(v).toDecimalPlaces(dp, Decimal.ROUND_HALF_UP);
}

/** Convert to JS number for charts/presentation only. */
export function num(v: DecLike | null | undefined): number {
  return D(v).toNumber();
}

/** Add `v` into map[key]. */
export function addTo<K extends string>(map: Record<K, Decimal>, key: K, v: DecLike): void {
  map[key] = (map[key] ?? ZERO).plus(D(v));
}
