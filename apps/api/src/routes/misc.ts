/**
 * Health, authentication, current user, user administration, process
 * templates and the audit log.
 */
import type { FastifyInstance } from 'fastify';
import { PROCESS_TEMPLATES, ROLE_LABELS, permissionsFor } from '@aies/engine';
import type { AppContext } from '../context';
import { hashPassword, loadActiveUser, requireUser, verifyPassword } from '../auth';
import { inTx, stageAudit, writeAudit } from '../audit';
import { ApiError, conflict, notFound } from '../errors';
import { json } from '../db/adapter';
import { ChangePasswordBody, CreateUserBody, LoginBody, ProcessTemplateSchema, UpdateUserBody } from '../schemas';
import { intParam, parse } from '../util';

// A real bcrypt hash of a random string, compared against for unknown users so
// response timing does not reveal which e-mail addresses exist.
let dummyHash: Promise<string> | null = null;

function userDto(u: { id: string; email: string; name: string; role: string; active?: boolean; created_at?: Date; last_login_at?: Date | null }) {
  const role = u.role as keyof typeof ROLE_LABELS;
  return {
    id: u.id,
    email: u.email,
    name: u.name,
    role,
    roleLabel: ROLE_LABELS[role] ?? role,
    permissions: ROLE_LABELS[role] ? permissionsFor(role) : [],
    ...(u.active === undefined ? {} : { active: u.active }),
    ...(u.created_at ? { createdAt: u.created_at } : {}),
    ...(u.last_login_at !== undefined ? { lastLoginAt: u.last_login_at } : {}),
  };
}

export function miscRoutes(app: FastifyInstance, ctx: AppContext): void {
  const { db, tokens, cfg, loginLimiter } = ctx;

  app.get('/health', { config: { public: true } }, async (_req, reply) => {
    const started = Date.now();
    try {
      await db.query('SELECT 1');
      return { status: 'ok', db: db.kind, dbLatencyMs: Date.now() - started, time: new Date().toISOString() };
    } catch {
      reply.code(503);
      return { status: 'degraded', db: db.kind, error: { code: 'DB_UNAVAILABLE', message: 'Database is not reachable.' } };
    }
  });

  // ───────────── auth ─────────────

  app.post('/auth/login', { config: { public: true, action: 'auth.login', entity: 'user' } }, async (req, reply) => {
    const body = parse(LoginBody, req.body);
    const email = body.email.toLowerCase();
    const limiterKey = `${req.ip}|${email}`;
    const wait = loginLimiter.retryAfter(limiterKey);
    const fail = async (reason: string, user?: { id: string; role: string }) => {
      loginLimiter.fail(limiterKey);
      await writeAudit(db, req, { action: 'auth.login', outcome: 'failure', statusCode: 401, entityType: 'user', entityId: user?.id ?? null, actor: { id: user?.id ?? null, email, role: user?.role ?? null }, detail: { reason } });
      req.auditState.written = true;
      throw new ApiError(401, 'INVALID_CREDENTIALS', 'Email or password is incorrect.');
    };
    if (wait > 0) {
      await writeAudit(db, req, { action: 'auth.login', outcome: 'denied', statusCode: 429, entityType: 'user', actor: { id: null, email, role: null }, detail: { reason: 'rate_limited' } });
      req.auditState.written = true;
      reply.header('retry-after', String(wait));
      throw new ApiError(429, 'TOO_MANY_ATTEMPTS', `Too many failed sign-in attempts. Try again in ${wait} seconds.`);
    }

    const { rows } = await db.query<{ id: string; email: string; name: string; role: string; active: boolean; password_hash: string }>(
      'SELECT id, email, name, role, active, password_hash FROM users WHERE email = $1',
      [email],
    );
    const u = rows[0];
    if (!u) {
      dummyHash ??= hashPassword(crypto.randomUUID(), cfg.bcryptRounds);
      await verifyPassword(body.password, await dummyHash);
      return fail('unknown_email');
    }
    if (!(await verifyPassword(body.password, u.password_hash))) return fail('bad_password', u);
    if (!u.active) return fail('inactive', u);
    const user = await loadActiveUser(db, u.id);
    if (!user) return fail('invalid_role', u);

    loginLimiter.reset(limiterKey);
    const { token, expiresAt } = await tokens.sign(user);
    await inTx(db, req, async (q) => {
      await q.query('UPDATE users SET last_login_at = now() WHERE id = $1', [user.id]);
      await stageAudit(q, req, { action: 'auth.login', entityType: 'user', entityId: user.id, actor: { id: user.id, email: user.email, role: user.role }, detail: {} });
    });
    return { token, tokenType: 'Bearer', expiresAt, user: userDto(user) };
  });

  app.get('/me', async (req) => userDto(requireUser(req)));

  app.post('/me/password', { config: { action: 'user.password.change', entity: 'user' } }, async (req) => {
    const user = requireUser(req);
    const body = parse(ChangePasswordBody, req.body);
    const { rows } = await db.query<{ password_hash: string }>('SELECT password_hash FROM users WHERE id = $1', [user.id]);
    if (!rows[0] || !(await verifyPassword(body.currentPassword, rows[0].password_hash))) {
      throw new ApiError(400, 'INVALID_CREDENTIALS', 'The current password is incorrect.');
    }
    const hash = await hashPassword(body.newPassword, cfg.bcryptRounds);
    await inTx(db, req, async (q) => {
      await q.query('UPDATE users SET password_hash = $2 WHERE id = $1', [user.id, hash]);
      await stageAudit(q, req, { action: 'user.password.change', entityType: 'user', entityId: user.id, detail: {} });
    });
    return { changed: true };
  });

  // ───────────── users (admin) ─────────────

  app.get('/users', { config: { permission: 'user.manage' } }, async () => {
    const { rows } = await db.query<{ id: string; email: string; name: string; role: string; active: boolean; created_at: Date; last_login_at: Date | null }>(
      'SELECT id, email, name, role, active, created_at, last_login_at FROM users ORDER BY email',
    );
    return { users: rows.map(userDto) };
  });

  app.post('/users', { config: { permission: 'user.manage', action: 'user.create', entity: 'user' } }, async (req, reply) => {
    const body = parse(CreateUserBody, req.body);
    const hash = await hashPassword(body.password, cfg.bcryptRounds);
    const created = await inTx(db, req, async (q) => {
      const { rows } = await q.query<{ id: string; email: string; name: string; role: string; active: boolean; created_at: Date }>(
        `INSERT INTO users (email, name, role, password_hash) VALUES ($1, $2, $3, $4) ON CONFLICT (email) DO NOTHING
         RETURNING id, email, name, role, active, created_at`,
        [body.email.toLowerCase(), body.name, body.role, hash],
      );
      if (!rows.length) throw conflict('USER_EXISTS', `A user with email ${body.email.toLowerCase()} already exists.`);
      await stageAudit(q, req, { action: 'user.create', entityType: 'user', entityId: rows[0].id, detail: { email: rows[0].email, role: rows[0].role } });
      return rows[0];
    });
    reply.code(201);
    return userDto(created);
  });

  app.put<{ Params: { userId: string } }>('/users/:userId', { config: { permission: 'user.manage', action: 'user.update', entity: 'user' } }, async (req) => {
    const actor = requireUser(req);
    const body = parse(UpdateUserBody, req.body);
    if (!/^[0-9a-f-]{36}$/i.test(req.params.userId)) throw notFound(`User "${req.params.userId}"`);
    if (req.params.userId === actor.id && (body.active === false || (body.role && body.role !== 'admin'))) {
      throw conflict('SELF_LOCKOUT', 'You cannot deactivate yourself or remove your own admin role.');
    }
    const hash = body.password ? await hashPassword(body.password, cfg.bcryptRounds) : null;
    return inTx(db, req, async (q) => {
      const { rows } = await q.query<{ id: string; email: string; name: string; role: string; active: boolean; created_at: Date }>(
        `UPDATE users SET name = COALESCE($2, name), role = COALESCE($3, role), active = COALESCE($4, active), password_hash = COALESCE($5, password_hash)
          WHERE id = $1 RETURNING id, email, name, role, active, created_at`,
        [req.params.userId, body.name ?? null, body.role ?? null, body.active ?? null, hash],
      );
      if (!rows.length) throw notFound(`User "${req.params.userId}"`);
      const changed = Object.keys(body).filter((k) => k !== 'password');
      await stageAudit(q, req, { action: 'user.update', entityType: 'user', entityId: rows[0].id, detail: { email: rows[0].email, changed, passwordReset: !!body.password, ...(body.role ? { role: body.role } : {}), ...(body.active !== undefined ? { active: body.active } : {}) } });
      return userDto(rows[0]);
    });
  });

  // ───────────── templates ─────────────

  app.get('/templates', async () => {
    const { rows } = await db.query<{ id: string; data: Record<string, unknown>; created_at: Date; updated_at: Date; email: string | null }>(
      'SELECT t.id, t.data, t.created_at, t.updated_at, u.email FROM process_templates t LEFT JOIN users u ON u.id = t.created_by ORDER BY t.business_function, t.name',
    );
    return {
      builtIn: PROCESS_TEMPLATES,
      custom: rows.map((r) => ({ ...r.data, builtIn: false, createdBy: r.email, createdAt: r.created_at, updatedAt: r.updated_at })),
    };
  });

  app.post('/templates', { config: { anyPermission: ['project.create', 'catalog.edit'], action: 'template.save', entity: 'template' } }, async (req, reply) => {
    const user = requireUser(req);
    const body = parse(ProcessTemplateSchema, req.body, 'process template');
    if (PROCESS_TEMPLATES.some((t) => t.id === body.id)) throw conflict('BUILT_IN_TEMPLATE', `"${body.id}" is a built-in template id — choose another id.`);
    const data = { ...body, builtIn: false };
    const result = await inTx(db, req, async (q) => {
      const { rows } = await q.query<{ inserted: boolean }>(
        `INSERT INTO process_templates (id, name, business_function, process, data, created_by, updated_by)
         VALUES ($1, $2, $3, $4, $5::jsonb, $6, $6)
         ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, business_function = EXCLUDED.business_function, process = EXCLUDED.process,
                                        data = EXCLUDED.data, updated_by = EXCLUDED.updated_by
         RETURNING (xmax = 0) AS inserted`,
        [body.id, body.name, body.businessFunction, body.process, json(data), user.id],
      );
      const inserted = !!rows[0]?.inserted;
      await stageAudit(q, req, { action: 'template.save', entityType: 'template', entityId: body.id, detail: { created: inserted, name: body.name } });
      return inserted;
    });
    reply.code(result ? 201 : 200);
    return { template: data, created: result };
  });

  // ───────────── audit ─────────────

  app.get('/audit', { config: { permission: 'audit.view' } }, async (req) => {
    const q = req.query as Record<string, string | undefined>;
    const limit = q.limit ? intParam(q.limit, 'limit', { max: 1000 }) : 100;
    const before = q.before ? intParam(q.before, 'before') : null;
    const { rows } = await db.query<{
      id: number;
      at: Date;
      user_id: string | null;
      user_email: string | null;
      role: string | null;
      action: string;
      outcome: string;
      status_code: number | null;
      entity_type: string | null;
      entity_id: string | null;
      project_id: string | null;
      detail: unknown;
      ip: string | null;
    }>(
      `SELECT id, at, user_id, user_email, role, action, outcome, status_code, entity_type, entity_id, project_id, detail, ip
         FROM audit_log
        WHERE ($1::text IS NULL OR project_id = $1)
          AND ($2::text IS NULL OR action = $2)
          AND ($3::text IS NULL OR user_email = $3)
          AND ($4::text IS NULL OR outcome = $4)
          AND ($5::bigint IS NULL OR id < $5)
        ORDER BY id DESC
        LIMIT $6`,
      [q.projectId ?? null, q.action ?? null, q.userEmail?.toLowerCase() ?? null, q.outcome ?? null, before, limit],
    );
    const entries = rows.map((r) => ({
      id: r.id,
      at: r.at,
      userId: r.user_id,
      userEmail: r.user_email,
      role: r.role,
      action: r.action,
      outcome: r.outcome,
      statusCode: r.status_code,
      entityType: r.entity_type,
      entityId: r.entity_id,
      projectId: r.project_id,
      detail: r.detail,
      ip: r.ip,
    }));
    return { entries, nextBefore: entries.length === limit ? entries[entries.length - 1].id : null };
  });
}
