import type { z } from 'zod';
import { ApiError } from './errors';

/** Structural equality for JSON values; object key order is ignored (jsonb reorders keys). */
export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') {
    // undefined and a missing key are equivalent in JSON.
    return a === b;
  }
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) {
    const bb = b as unknown[];
    if (a.length !== bb.length) return false;
    for (let i = 0; i < a.length; i++) if (!deepEqual(a[i], bb[i])) return false;
    return true;
  }
  const ao = a as Record<string, unknown>;
  const bo = b as Record<string, unknown>;
  const keys = new Set([...Object.keys(ao), ...Object.keys(bo)]);
  for (const k of keys) {
    if (ao[k] === undefined && bo[k] === undefined) continue;
    if (!deepEqual(ao[k], bo[k])) return false;
  }
  return true;
}

/** Top-level keys whose values differ between two objects. */
export function changedKeys(before: Record<string, unknown>, after: Record<string, unknown>, ignore: string[] = []): string[] {
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  return [...keys].filter((k) => !ignore.includes(k) && !deepEqual(before[k], after[k])).sort();
}

/** Deep copy of a JSON value. */
export function clone<T>(v: T): T {
  return structuredClone(v);
}

export const nowIso = () => new Date().toISOString();
export const todayIso = () => new Date().toISOString().slice(0, 10);

/** Months between two YYYY-MM periods (b − a). */
export function monthDiff(a: string, b: string): number {
  const [ya, ma] = a.split('-').map(Number);
  const [yb, mb] = b.split('-').map(Number);
  return yb * 12 + mb - (ya * 12 + ma);
}

/** Validate `value` against a zod schema or throw a 400 VALIDATION_ERROR. */
export function parse<S extends z.ZodType>(schema: S, value: unknown, what = 'request body'): z.output<S> {
  const r = schema.safeParse(value);
  if (r.success) return r.data;
  const issues = r.error.issues.slice(0, 50).map((i) => ({ path: i.path.map(String).join('.') || '(root)', message: i.message, code: i.code }));
  const summary = issues
    .slice(0, 3)
    .map((i) => `${i.path}: ${i.message}`)
    .join('; ');
  throw new ApiError(400, 'VALIDATION_ERROR', `Invalid ${what} — ${summary}${issues.length > 3 ? ` (and ${r.error.issues.length - 3} more)` : ''}`, { issues });
}

/** Parse a positive integer path/query parameter or throw 400. */
export function intParam(value: unknown, name: string, { min = 1, max = Number.MAX_SAFE_INTEGER } = {}): number {
  const n = typeof value === 'number' ? value : typeof value === 'string' && /^-?\d+$/.test(value) ? Number(value) : NaN;
  if (!Number.isSafeInteger(n) || n < min || n > max) throw new ApiError(400, 'BAD_REQUEST', `"${name}" must be an integer between ${min} and ${max}.`);
  return n;
}

/** numeric column (string) → JS number for engine inputs. */
export function toNumber(v: unknown): number {
  if (v === null || v === undefined) return 0;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}
