import { D, Decimal, type DecLike } from './decimal';
import type { FxTable } from './types';

export class FxError extends Error {}

/**
 * Convert an amount between currencies using a single-base FX table
 * (rates = units of currency per 1 unit of base). Cross rates are derived
 * through the base so A→B→A round-trips exactly (up to decimal precision).
 */
export function convert(amount: DecLike, from: string, to: string, fx: FxTable): Decimal {
  const a = D(amount);
  if (from === to) return a;
  const rFrom = fx.rates[from] ?? (from === fx.base ? 1 : undefined);
  const rTo = fx.rates[to] ?? (to === fx.base ? 1 : undefined);
  if (rFrom === undefined) throw new FxError(`No FX rate configured for ${from}`);
  if (rTo === undefined) throw new FxError(`No FX rate configured for ${to}`);
  if (rFrom <= 0 || rTo <= 0) throw new FxError(`FX rate must be positive (${from}/${to})`);
  return a.div(D(rFrom)).times(D(rTo));
}

/** Returns a converter bound to a target currency. */
export function converterTo(target: string, fx: FxTable) {
  return (amount: DecLike, from: string) => convert(amount, from, target, fx);
}

export function fxRate(from: string, to: string, fx: FxTable): Decimal {
  return convert(1, from, to, fx);
}
