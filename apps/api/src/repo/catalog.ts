/**
 * Catalogue persistence.
 *
 * Rate tables are versioned (effective_from / effective_to; current row has
 * effective_to IS NULL). `loadCatalog()` assembles the *current* rows into the
 * engine `Catalog` shape; its `version` is a content hash, so any change to a
 * rate, FX row or weight-set approval produces a new catalogue version.
 */
import { createHash } from 'node:crypto';
import type { AcuWeightSet, Catalog, CloudPriceItem, FxTable, ModelRate } from '@aies/engine';
import type { Queryable } from '../db/adapter';
import { json } from '../db/adapter';
import { badRequest, conflict, notFound } from '../errors';
import { changedKeys, deepEqual, toNumber } from '../util';

export type RateTable = 'model_rates' | 'cloud_price_items';

const RATE_TABLES: Record<RateTable, true> = { model_rates: true, cloud_price_items: true };

function assertTable(t: RateTable): RateTable {
  if (!RATE_TABLES[t]) throw new Error(`unknown rate table ${t}`);
  return t;
}

/** Current rows of a versioned rate table, in first-created order. */
async function currentRates<T>(q: Queryable, table: RateTable): Promise<T[]> {
  const t = assertTable(table);
  const { rows } = await q.query<{ data: T }>(
    `SELECT r.data
       FROM ${t} r
       JOIN (SELECT rate_key, min(id) AS first_id FROM ${t} GROUP BY rate_key) f ON f.rate_key = r.rate_key
      WHERE r.effective_to IS NULL
      ORDER BY f.first_id`,
  );
  return rows.map((r) => r.data);
}

interface FxRow {
  base: string;
  currency: string;
  rate: string;
  as_of: string;
  source: string;
  effective_from: Date;
}

export async function loadFx(q: Queryable): Promise<FxTable> {
  const { rows } = await q.query<FxRow>('SELECT base, currency, rate, as_of, source, effective_from FROM fx_rates WHERE effective_to IS NULL ORDER BY id');
  if (!rows.length) return { base: 'USD', asOf: '1970-01-01', source: 'No FX rates configured', rates: { USD: 1 } };
  const latest = rows.reduce((a, b) => (b.as_of > a.as_of ? b : a));
  const rates: Record<string, number> = {};
  for (const r of rows) rates[r.currency] = toNumber(r.rate);
  return { base: rows[0].base, asOf: latest.as_of, source: latest.source, rates };
}

interface WeightSetRow {
  id: string;
  version: string;
  status: AcuWeightSet['status'];
  data: AcuWeightSet;
  created_at: Date;
  approved_at: Date | null;
  created_by_email: string | null;
  approved_by_email: string | null;
}

const weightSetFromRow = (r: WeightSetRow): AcuWeightSet => ({ ...r.data, id: r.id, version: r.version, status: r.status });

/** All versions of every weight set (newest first within a set). */
export async function listWeightSets(q: Queryable) {
  const { rows } = await q.query<WeightSetRow>(
    `SELECT w.id, w.version, w.status, w.data, w.created_at, w.approved_at, cu.email AS created_by_email, au.email AS approved_by_email
       FROM acu_weight_sets w
       LEFT JOIN users cu ON cu.id = w.created_by
       LEFT JOIN users au ON au.id = w.approved_by
      ORDER BY w.id, w.created_at DESC, w.version DESC`,
  );
  return rows.map((r) => ({
    ...weightSetFromRow(r),
    createdAt: r.created_at,
    createdBy: r.created_by_email,
    approvedAt: r.approved_at,
    approvedBy: r.approved_by_email,
  }));
}

/**
 * One weight set per id for the engine catalogue: the approved version if
 * any, otherwise the most recently created one (the engine warns when a
 * project uses a set that is not approved).
 */
export async function effectiveWeightSets(q: Queryable): Promise<AcuWeightSet[]> {
  const { rows } = await q.query<WeightSetRow>(
    `SELECT DISTINCT ON (id) id, version, status, data, created_at, approved_at, NULL AS created_by_email, NULL AS approved_by_email
       FROM acu_weight_sets
      ORDER BY id, (status = 'approved') DESC, created_at DESC, version DESC`,
  );
  // Keep a stable, human-friendly order: approved first, then by id.
  return rows.sort((a, b) => Number(b.status === 'approved') - Number(a.status === 'approved') || a.id.localeCompare(b.id)).map(weightSetFromRow);
}

export async function loadCatalog(q: Queryable): Promise<Catalog> {
  const [modelRates, cloudPrices, fx, acuWeightSets] = [
    await currentRates<ModelRate>(q, 'model_rates'),
    await currentRates<CloudPriceItem>(q, 'cloud_price_items'),
    await loadFx(q),
    await effectiveWeightSets(q),
  ];
  const body = { modelRates, fx, acuWeightSets, cloudPrices };
  const version = `db-${createHash('sha256').update(JSON.stringify(body)).digest('hex').slice(0, 16)}`;
  return { version, ...body };
}

// ───────────────────────────── versioned writes ─────────────────────────────

export interface RateHistoryRow {
  version: number;
  data: unknown;
  effectiveFrom: Date;
  effectiveTo: Date | null;
  current: boolean;
  createdBy: string | null;
  createdAt: Date;
}

export async function rateHistory(q: Queryable, table: RateTable, key: string): Promise<RateHistoryRow[]> {
  const t = assertTable(table);
  const { rows } = await q.query<{ version: number; data: unknown; effective_from: Date; effective_to: Date | null; email: string | null; created_at: Date }>(
    `SELECT r.version, r.data, r.effective_from, r.effective_to, u.email, r.created_at
       FROM ${t} r LEFT JOIN users u ON u.id = r.created_by
      WHERE r.rate_key = $1
      ORDER BY r.version DESC`,
    [key],
  );
  return rows.map((r) => ({
    version: r.version,
    data: r.data,
    effectiveFrom: r.effective_from,
    effectiveTo: r.effective_to,
    current: r.effective_to === null,
    createdBy: r.email,
    createdAt: r.created_at,
  }));
}

export interface RateWriteResult {
  key: string;
  version: number;
  previousVersion: number | null;
  changed: string[];
  unchanged: boolean;
  data: Record<string, unknown>;
}

/**
 * Close the current row (effective_to = now()) and insert a new version.
 * Creates version 1 when the key is new. Identical data is a no-op.
 */
export async function putRate(q: Queryable, table: RateTable, key: string, data: Record<string, unknown>, userId: string | null): Promise<RateWriteResult> {
  const t = assertTable(table);
  const { rows } = await q.query<{ id: number; version: number; data: Record<string, unknown> }>(
    `SELECT id, version, data FROM ${t} WHERE rate_key = $1 AND effective_to IS NULL FOR UPDATE`,
    [key],
  );
  const current = rows[0];
  if (current && deepEqual(current.data, data)) {
    return { key, version: current.version, previousVersion: current.version, changed: [], unchanged: true, data: current.data };
  }
  let version = 1;
  if (current) {
    await q.query(`UPDATE ${t} SET effective_to = now() WHERE id = $1`, [current.id]);
    version = current.version + 1;
  } else {
    const { rows: maxRows } = await q.query<{ v: number | null }>(`SELECT max(version) AS v FROM ${t} WHERE rate_key = $1`, [key]);
    version = (maxRows[0]?.v ?? 0) + 1; // re-introducing a retired key continues its numbering
  }
  await q.query(`INSERT INTO ${t} (rate_key, version, data, effective_from, created_by) VALUES ($1, $2, $3::jsonb, now(), $4)`, [key, version, json(data), userId]);
  return {
    key,
    version,
    previousVersion: current?.version ?? null,
    changed: current ? changedKeys(current.data, data) : Object.keys(data).sort(),
    unchanged: false,
    data,
  };
}

/** Insert version 1 of a rate if the key has no current row (seeding). */
export async function insertRateIfMissing(q: Queryable, table: RateTable, key: string, data: unknown, userId: string | null): Promise<boolean> {
  const t = assertTable(table);
  const r = await q.query(
    `INSERT INTO ${t} (rate_key, version, data, created_by)
     SELECT $1, 1, $2::jsonb, $3
      WHERE NOT EXISTS (SELECT 1 FROM ${t} WHERE rate_key = $1)`,
    [key, json(data), userId],
  );
  return r.rowCount > 0;
}

// ───────────────────────────── FX ─────────────────────────────

export interface FxInput {
  base: string;
  asOf: string;
  source: string;
  rates: Record<string, number | string>;
}

const FX_SCALE = 10;
const normRate = (v: number | string): string => {
  const s = typeof v === 'number' ? v.toFixed(FX_SCALE) : v;
  // canonical form with 10 dp, matching numeric(24,10)
  const [i, f = ''] = s.split('.');
  return `${i}.${(f + '0'.repeat(FX_SCALE)).slice(0, FX_SCALE)}`;
};

/** Replace the current FX table. Unchanged currencies keep their row; changed/removed ones are closed. */
export async function putFx(q: Queryable, input: FxInput, userId: string | null) {
  const rates: Record<string, string> = {};
  for (const [c, v] of Object.entries(input.rates)) {
    const n = typeof v === 'number' ? v : Number(v);
    if (!(n > 0)) throw badRequest(`FX rate for ${c} must be positive.`);
    rates[c] = normRate(v);
  }
  if (rates[input.base] === undefined) rates[input.base] = normRate(1);
  else if (Number(rates[input.base]) !== 1) throw badRequest(`The base currency ${input.base} must have rate 1.`);

  const { rows: current } = await q.query<{ id: number; base: string; currency: string; rate: string; as_of: string; source: string }>(
    'SELECT id, base, currency, rate, as_of, source FROM fx_rates WHERE effective_to IS NULL FOR UPDATE',
  );
  const byCur = new Map(current.map((r) => [r.currency, r]));
  const added: string[] = [];
  const updated: string[] = [];
  const removed: string[] = [];
  const unchanged: string[] = [];
  for (const [c, rate] of Object.entries(rates)) {
    const cur = byCur.get(c);
    if (cur && cur.base === input.base && normRate(cur.rate) === rate && cur.as_of === input.asOf && cur.source === input.source) {
      unchanged.push(c);
      continue;
    }
    if (cur) {
      await q.query('UPDATE fx_rates SET effective_to = now() WHERE id = $1', [cur.id]);
      updated.push(c);
    } else added.push(c);
    await q.query('INSERT INTO fx_rates (base, currency, rate, as_of, source, created_by) VALUES ($1, $2, $3::numeric, $4::date, $5, $6)', [input.base, c, rate, input.asOf, input.source, userId]);
  }
  for (const r of current) {
    if (rates[r.currency] === undefined) {
      await q.query('UPDATE fx_rates SET effective_to = now() WHERE id = $1', [r.id]);
      removed.push(r.currency);
    }
  }
  return { added: added.sort(), updated: updated.sort(), removed: removed.sort(), unchanged: unchanged.sort() };
}

export async function fxHistory(q: Queryable, currency: string | null, limit: number) {
  const { rows } = await q.query<{ base: string; currency: string; rate: string; as_of: string; source: string; effective_from: Date; effective_to: Date | null; email: string | null }>(
    `SELECT f.base, f.currency, f.rate, f.as_of, f.source, f.effective_from, f.effective_to, u.email
       FROM fx_rates f LEFT JOIN users u ON u.id = f.created_by
      WHERE ($1::text IS NULL OR f.currency = $1)
      ORDER BY f.currency, f.id DESC
      LIMIT $2`,
    [currency, limit],
  );
  return rows.map((r) => ({
    base: r.base,
    currency: r.currency,
    rate: r.rate,
    asOf: r.as_of,
    source: r.source,
    effectiveFrom: r.effective_from,
    effectiveTo: r.effective_to,
    current: r.effective_to === null,
    createdBy: r.email,
  }));
}

// ───────────────────────────── ACU weight sets ─────────────────────────────

export async function createWeightSetVersion(q: Queryable, ws: AcuWeightSet, userId: string | null, status: AcuWeightSet['status'] = 'draft') {
  const { rows } = await q.query<{ id: string }>('SELECT id FROM acu_weight_sets WHERE id = $1 AND version = $2', [ws.id, ws.version]);
  if (rows.length) throw conflict('VERSION_EXISTS', `ACU weight set "${ws.id}" version ${ws.version} already exists — use a new version number.`);
  const data = { ...ws, status };
  await q.query(
    `INSERT INTO acu_weight_sets (id, version, status, data, created_by, approved_by, approved_at)
     VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7)`,
    [ws.id, ws.version, status, json(data), userId, status === 'approved' ? userId : null, status === 'approved' ? new Date().toISOString() : null],
  );
  return data;
}

/** Approve a draft version; the previously approved version of the same set is retired. */
export async function approveWeightSet(q: Queryable, id: string, version: string, userId: string) {
  const { rows } = await q.query<{ status: string }>('SELECT status FROM acu_weight_sets WHERE id = $1 AND version = $2 FOR UPDATE', [id, version]);
  if (!rows.length) throw notFound(`ACU weight set "${id}" version ${version}`);
  if (rows[0].status !== 'draft') throw conflict('INVALID_STATE', `Only draft weight sets can be approved (this one is ${rows[0].status}).`);
  const { rows: retired } = await q.query<{ version: string }>(
    `UPDATE acu_weight_sets SET status = 'retired', data = jsonb_set(data, '{status}', '"retired"')
      WHERE id = $1 AND status = 'approved' RETURNING version`,
    [id],
  );
  await q.query(
    `UPDATE acu_weight_sets SET status = 'approved', data = jsonb_set(data, '{status}', '"approved"'), approved_by = $3, approved_at = now()
      WHERE id = $1 AND version = $2`,
    [id, version, userId],
  );
  return { retired: retired.map((r) => r.version) };
}
