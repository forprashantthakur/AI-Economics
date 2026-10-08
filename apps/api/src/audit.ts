/**
 * Audit logging.
 *
 * Successful mutations write their audit row inside the same transaction as
 * the change (`stageAudit` + `inTx`), so the log can never disagree with the
 * data. Everything else that must be audited — failed or denied mutations,
 * 401/403 on any route, mutations that did not stage a row — is written by
 * the generic onSend hook (`auditFallback`).
 */
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Db, Queryable, Tx } from './db/adapter';
import { json } from './db/adapter';

export type AuditOutcome = 'success' | 'denied' | 'failure' | 'error';

export interface AuditEntry {
  action: string;
  outcome?: AuditOutcome;
  statusCode?: number;
  entityType?: string | null;
  entityId?: string | null;
  projectId?: string | null;
  detail?: Record<string, unknown>;
  /** Override the acting principal (e.g. failed login for an unknown email). */
  actor?: { id: string | null; email: string | null; role: string | null };
}

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const MAX_DETAIL_CHARS = 8_000;

function compactDetail(detail: Record<string, unknown> | undefined): string {
  const s = json(detail ?? {});
  if (s.length <= MAX_DETAIL_CHARS) return s;
  return json({ truncated: true, keys: Object.keys(detail ?? {}), size: s.length });
}

export async function writeAudit(q: Queryable, req: FastifyRequest | null, e: AuditEntry): Promise<void> {
  const actor = e.actor ?? (req?.user ? { id: req.user.id, email: req.user.email, role: req.user.role } : { id: null, email: null, role: null });
  await q.query(
    `INSERT INTO audit_log (user_id, user_email, role, action, outcome, status_code, entity_type, entity_id, project_id, detail, ip)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11)`,
    [
      actor.id,
      actor.email,
      actor.role,
      e.action,
      e.outcome ?? 'success',
      e.statusCode ?? null,
      e.entityType ?? null,
      e.entityId ?? null,
      e.projectId ?? null,
      compactDetail(e.detail),
      req?.ip ?? null,
    ],
  );
}

/** Write an audit row inside a transaction; committed together with the change by `inTx`. */
export async function stageAudit(q: Queryable, req: FastifyRequest, e: AuditEntry): Promise<void> {
  await writeAudit(q, req, e);
  req.auditState.staged = true;
}

/** Run `fn` in a transaction and mark the request's staged audit row as committed on success. */
export async function inTx<T>(db: Db, req: FastifyRequest, fn: (q: Tx) => Promise<T>): Promise<T> {
  req.auditState.staged = false;
  try {
    const result = await db.tx(fn);
    if (req.auditState.staged) req.auditState.written = true;
    return result;
  } catch (err) {
    req.auditState.staged = false;
    throw err;
  }
}

function projectIdOf(req: FastifyRequest): string | null {
  const url = req.routeOptions?.url ?? '';
  const params = (req.params ?? {}) as Record<string, string>;
  return url.startsWith('/api/projects/:id') && typeof params.id === 'string' ? params.id.slice(0, 200) : null;
}

function entityIdOf(req: FastifyRequest): string | null {
  const p = (req.params ?? {}) as Record<string, string>;
  const v = p.key ?? p.benefitId ?? p.id ?? null;
  return typeof v === 'string' ? v.slice(0, 200) : null;
}

/** onSend hook: audit denied attempts on any route and every mutation that did not commit its own row. */
export function auditFallback(db: Db) {
  return async function (req: FastifyRequest, reply: FastifyReply): Promise<void> {
    const st = req.auditState;
    if (!st || st.written) return;
    const status = reply.statusCode;
    const cfg = req.routeOptions?.config ?? {};
    const denied = status === 401 || status === 403;
    const mutating = MUTATING.has(req.method) && !cfg.readOnly && !req.is404;
    if (!denied && !mutating) return;
    st.written = true;
    const outcome: AuditOutcome = denied ? 'denied' : status >= 500 ? 'error' : status >= 400 ? 'failure' : 'success';
    try {
      await writeAudit(db, req, {
        action: cfg.action ?? `${req.method} ${req.routeOptions?.url ?? 'unknown'}`,
        outcome,
        statusCode: status,
        entityType: cfg.entity ?? null,
        entityId: entityIdOf(req),
        projectId: projectIdOf(req),
        detail: { method: req.method, path: req.url.slice(0, 500), ...(st.error ? { error: st.error } : {}) },
      });
    } catch (err) {
      req.log.error({ err }, 'failed to write audit row');
    }
  };
}
