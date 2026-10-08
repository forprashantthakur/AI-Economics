/**
 * Project persistence. The engine `Project` JSON lives in projects.data; every
 * write creates an immutable project_versions row and bumps current_version
 * (optimistic concurrency). The actuals table mirrors project.actuals so it
 * can be queried, and is rewritten whenever the JSON's actuals change.
 */
import type { ActualRecord, Project } from '@aies/engine';
import type { Queryable } from '../db/adapter';
import { json } from '../db/adapter';
import { conflict, notFound } from '../errors';
import { changedKeys, nowIso, toNumber } from '../util';

/** Fields the server owns; ignored when diffing client saves. */
export const SERVER_FIELDS = ['id', 'createdAt', 'updatedAt'];

export interface ProjectRow {
  id: string;
  client_id: string | null;
  name: string;
  status: string;
  currency: string;
  owner_id: string | null;
  current_version: number;
  data: Project;
  created_by: string | null;
  updated_by: string | null;
  created_at: Date;
  updated_at: Date;
  deleted_at: Date | null;
}

const COLS = 'id, client_id, name, status, currency, owner_id, current_version, data, created_by, updated_by, created_at, updated_at, deleted_at';

export async function getProjectRow(q: Queryable, id: string, opts: { includeDeleted?: boolean; forUpdate?: boolean } = {}): Promise<ProjectRow> {
  const { rows } = await q.query<ProjectRow>(`SELECT ${COLS} FROM projects WHERE id = $1${opts.forUpdate ? ' FOR UPDATE' : ''}`, [id]);
  const row = rows[0];
  if (!row || (row.deleted_at && !opts.includeDeleted)) throw notFound(`Project "${id}"`);
  return row;
}

export async function projectExists(q: Queryable, id: string): Promise<{ exists: boolean; deleted: boolean }> {
  const { rows } = await q.query<{ deleted_at: Date | null }>('SELECT deleted_at FROM projects WHERE id = $1', [id]);
  return { exists: rows.length > 0, deleted: !!rows[0]?.deleted_at };
}

export function assertBaseVersion(row: ProjectRow, baseVersion: number | undefined): void {
  if (baseVersion !== undefined && baseVersion !== row.current_version) {
    throw conflict(
      'VERSION_CONFLICT',
      `Project "${row.id}" was changed by someone else: you edited version ${baseVersion}, the current version is ${row.current_version}. Reload, re-apply your change and save again.`,
      { baseVersion, currentVersion: row.current_version },
    );
  }
}

/** Find or create the client by (case-insensitive) name; returns its id or null when unnamed. */
export async function upsertClient(q: Queryable, p: Project): Promise<string | null> {
  const name = p.client?.clientName?.trim();
  if (!name) return null;
  const { rows } = await q.query<{ id: string }>(
    `INSERT INTO clients (name, industry, geography) VALUES ($1, $2, $3)
     ON CONFLICT (lower(name)) DO UPDATE SET industry = COALESCE(EXCLUDED.industry, clients.industry), geography = COALESCE(EXCLUDED.geography, clients.geography)
     RETURNING id`,
    [name.slice(0, 300), p.client.industry || null, p.client.geography || null],
  );
  return rows[0].id;
}

/** Rewrite the actuals table for a project from its JSON. */
export async function syncActualsTable(q: Queryable, projectId: string, actuals: ActualRecord[], userId: string | null): Promise<void> {
  await q.query('DELETE FROM actuals WHERE project_id = $1', [projectId]);
  if (!actuals.length) return;
  // De-duplicate on the primary key (last record wins), then bulk insert via jsonb_to_recordset.
  const byKey = new Map<string, ActualRecord>();
  for (const a of actuals) byKey.set(`${a.period}|${a.workflowId}`, a);
  const rows = [...byKey.values()].map((a) => ({
    period: a.period,
    workflow_id: a.workflowId,
    month_index: Math.max(0, Math.trunc(a.monthIndex)),
    attempted: String(a.attempted),
    accepted: String(a.accepted),
    input_tokens: Math.round(a.inputTokens),
    output_tokens: Math.round(a.outputTokens),
    llm_cost: String(a.llmCost),
    non_llm_cost: String(a.nonLlmCost),
    realized_benefit: String(a.realizedBenefit ?? 0),
    currency: a.currency,
  }));
  await q.query(
    `INSERT INTO actuals (project_id, period, workflow_id, month_index, attempted, accepted, input_tokens, output_tokens, llm_cost, non_llm_cost, realized_benefit, currency, updated_by)
     SELECT $1, r.period, r.workflow_id, r.month_index, r.attempted::numeric, r.accepted::numeric, r.input_tokens, r.output_tokens,
            r.llm_cost::numeric, r.non_llm_cost::numeric, r.realized_benefit::numeric, r.currency, $3
       FROM jsonb_to_recordset($2::jsonb) AS r(period text, workflow_id text, month_index int, attempted text, accepted text, input_tokens bigint,
                                              output_tokens bigint, llm_cost text, non_llm_cost text, realized_benefit text, currency text)`,
    [projectId, json(rows), userId],
  );
}

export interface ActualDbRow {
  period: string;
  workflow_id: string;
  month_index: number;
  attempted: string;
  accepted: string;
  input_tokens: number;
  output_tokens: number;
  llm_cost: string;
  non_llm_cost: string;
  realized_benefit: string;
  currency: string;
  updated_at: Date;
}

export async function listActuals(q: Queryable, projectId: string): Promise<ActualDbRow[]> {
  const { rows } = await q.query<ActualDbRow>(
    `SELECT period, workflow_id, month_index, attempted, accepted, input_tokens, output_tokens, llm_cost, non_llm_cost, realized_benefit, currency, updated_at
       FROM actuals WHERE project_id = $1 ORDER BY period, workflow_id`,
    [projectId],
  );
  return rows;
}

/** Engine ActualRecord (JSON numbers) from a table row. */
export function actualFromRow(r: ActualDbRow): ActualRecord {
  return {
    period: r.period,
    monthIndex: r.month_index,
    workflowId: r.workflow_id,
    attempted: toNumber(r.attempted),
    accepted: toNumber(r.accepted),
    inputTokens: toNumber(r.input_tokens),
    outputTokens: toNumber(r.output_tokens),
    llmCost: toNumber(r.llm_cost),
    nonLlmCost: toNumber(r.non_llm_cost),
    realizedBenefit: toNumber(r.realized_benefit),
    currency: r.currency,
  };
}

/** Insert a new project with version 1 (caller runs inside a transaction). */
export async function insertProject(q: Queryable, p: Project, userId: string | null, comment: string): Promise<ProjectRow> {
  const clientId = await upsertClient(q, p);
  const { rows } = await q.query<ProjectRow>(
    `INSERT INTO projects (id, client_id, name, status, currency, owner_id, current_version, data, created_by, updated_by)
     VALUES ($1, $2, $3, $4, $5, $6, 1, $7::jsonb, $6, $6)
     RETURNING ${COLS}`,
    [p.id, clientId, p.name, p.status, p.currency, userId, json(p)],
  );
  await q.query('INSERT INTO project_versions (project_id, version, data, author_id, comment, changed) VALUES ($1, 1, $2::jsonb, $3, $4, $5)', [
    p.id,
    json(p),
    userId,
    comment,
    Object.keys(p).sort(),
  ]);
  await syncActualsTable(q, p.id, p.actuals ?? [], userId);
  return rows[0];
}

export interface SavedVersion {
  version: number;
  previousVersion: number;
  changed: string[];
  row: ProjectRow;
}

/**
 * Write `next` as a new version of a locked project row (caller holds
 * `getProjectRow(..., { forUpdate: true })` inside a transaction).
 */
export async function saveProjectVersion(
  q: Queryable,
  row: ProjectRow,
  nextIn: Project,
  userId: string | null,
  comment: string | null,
  opts: { syncActuals?: boolean } = {},
): Promise<SavedVersion> {
  const next: Project = { ...nextIn, id: row.id, createdAt: row.data.createdAt ?? row.created_at.toISOString(), updatedAt: nowIso() };
  const changed = changedKeys(row.data as unknown as Record<string, unknown>, next as unknown as Record<string, unknown>, SERVER_FIELDS);
  const version = row.current_version + 1;
  const clientId = changed.includes('client') ? await upsertClient(q, next) : row.client_id;
  const { rows } = await q.query<ProjectRow>(
    `UPDATE projects SET data = $2::jsonb, name = $3, status = $4, currency = $5, client_id = $6, current_version = $7, updated_by = $8, updated_at = now()
      WHERE id = $1 AND current_version = $9
      RETURNING ${COLS}`,
    [row.id, json(next), next.name, next.status, next.currency, clientId, version, userId, row.current_version],
  );
  if (!rows.length) throw conflict('VERSION_CONFLICT', `Project "${row.id}" was changed concurrently — reload and try again.`);
  await q.query('INSERT INTO project_versions (project_id, version, data, author_id, comment, changed) VALUES ($1, $2, $3::jsonb, $4, $5, $6)', [
    row.id,
    version,
    json(next),
    userId,
    comment,
    changed,
  ]);
  if (changed.includes('actuals') && opts.syncActuals !== false) await syncActualsTable(q, row.id, next.actuals ?? [], userId);
  return { version, previousVersion: row.current_version, changed, row: rows[0] };
}

export async function listProjects(q: Queryable, opts: { includeDeleted: boolean; status: string | null }) {
  const { rows } = await q.query<{
    id: string;
    name: string;
    status: string;
    currency: string;
    current_version: number;
    client_name: string | null;
    industry: string | null;
    owner: string | null;
    owner_email: string | null;
    go_live_date: string | null;
    illustrative: boolean | null;
    workflow_count: number;
    created_at: Date;
    updated_at: Date;
    deleted_at: Date | null;
  }>(
    `SELECT p.id, p.name, p.status, p.currency, p.current_version,
            p.data -> 'client' ->> 'clientName' AS client_name,
            p.data -> 'client' ->> 'industry' AS industry,
            p.data ->> 'owner' AS owner,
            u.email AS owner_email,
            p.data ->> 'goLiveDate' AS go_live_date,
            (p.data ->> 'illustrative')::boolean AS illustrative,
            COALESCE(jsonb_array_length(p.data -> 'workflows'), 0)::int AS workflow_count,
            p.created_at, p.updated_at, p.deleted_at
       FROM projects p LEFT JOIN users u ON u.id = p.owner_id
      WHERE ($1::boolean OR p.deleted_at IS NULL) AND ($2::text IS NULL OR p.status = $2)
      ORDER BY p.updated_at DESC, p.id`,
    [opts.includeDeleted, opts.status],
  );
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    status: r.status,
    currency: r.currency,
    version: r.current_version,
    clientName: r.client_name,
    industry: r.industry,
    owner: r.owner,
    ownerEmail: r.owner_email,
    goLiveDate: r.go_live_date,
    illustrative: !!r.illustrative,
    workflowCount: r.workflow_count,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    ...(r.deleted_at ? { deletedAt: r.deleted_at } : {}),
  }));
}

export function projectMeta(row: ProjectRow) {
  return {
    version: row.current_version,
    clientId: row.client_id,
    ownerId: row.owner_id,
    createdBy: row.created_by,
    updatedBy: row.updated_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ...(row.deleted_at ? { deletedAt: row.deleted_at } : {}),
  };
}
