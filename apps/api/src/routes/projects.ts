/**
 * Projects: CRUD with optimistic concurrency and immutable versions,
 * version history, compute (summary DTO) and validation.
 */
import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { validateProject, type Catalog, type Issue, type Project } from '@aies/engine';
import type { AppContext } from '../context';
import { requireAll, requireUser } from '../auth';
import { inTx, stageAudit } from '../audit';
import { badRequest, conflict, notFound, unprocessable } from '../errors';
import { CreateProjectSchema, ProjectSchema, UpdateProjectBody } from '../schemas';
import { intParam, nowIso, parse } from '../util';
import { loadCatalog } from '../repo/catalog';
import { assertBaseVersion, getProjectRow, insertProject, listProjects, projectExists, projectMeta, saveProjectVersion } from '../repo/projects';
import { ANY_PROJECT_WRITE, requiredCreatePermissions, requiredEditPermissions } from '../project-permissions';
import { computeSummary } from '../dto';
import { engineCall } from '../engine-service';

type IdParams = { id: string };

export function issueCounts(issues: Issue[]) {
  return {
    errors: issues.filter((i) => i.severity === 'error').length,
    warnings: issues.filter((i) => i.severity === 'warning').length,
    info: issues.filter((i) => i.severity === 'info').length,
  };
}

export function validateWith(project: Project, catalog: Catalog): Issue[] {
  return engineCall('validate the project', () => validateProject(project, catalog));
}

function strictFlag(query: unknown): boolean {
  const v = (query as Record<string, unknown> | undefined)?.strict;
  return v === 'true' || v === '1';
}

function rejectIfErrors(issues: Issue[], strict: boolean): void {
  if (strict && issues.some((i) => i.severity === 'error')) {
    throw unprocessable('VALIDATION_ISSUES', 'The project has validation errors (strict mode). Fix them or save without ?strict=true.', { issues });
  }
}

/** Load a specific stored version (or the current one) for read-only use. */
export async function loadProjectVersion(ctx: AppContext, id: string, version?: number): Promise<{ project: Project; version: number }> {
  const row = await getProjectRow(ctx.db, id);
  if (version === undefined || version === row.current_version) return { project: row.data, version: row.current_version };
  const { rows } = await ctx.db.query<{ data: Project }>('SELECT data FROM project_versions WHERE project_id = $1 AND version = $2', [id, version]);
  if (!rows.length) throw notFound(`Version ${version} of project "${id}"`);
  return { project: rows[0].data, version };
}

export function projectRoutes(app: FastifyInstance, ctx: AppContext): void {
  const { db } = ctx;

  app.get('/projects', async (req) => {
    const q = req.query as Record<string, string | undefined>;
    const user = requireUser(req);
    const includeDeleted = q.includeDeleted === 'true' && user.role === 'admin';
    const status = q.status && ['pre_sales', 'in_delivery', 'live'].includes(q.status) ? q.status : null;
    return { projects: await listProjects(db, { includeDeleted, status }) };
  });

  app.post('/projects', { config: { permission: 'project.create', action: 'project.create', entity: 'project' } }, async (req, reply) => {
    const user = requireUser(req);
    const body = parse(CreateProjectSchema, req.body, 'project');
    const now = nowIso();
    const project = { ...body, id: body.id ?? `p-${randomUUID().slice(0, 8)}`, createdAt: now, updatedAt: now } as unknown as Project;
    requireAll(req, requiredCreatePermissions(project), 'create this project');
    const catalog = await loadCatalog(db);
    const issues = validateWith(project, catalog);
    rejectIfErrors(issues, strictFlag(req.query));

    const row = await inTx(db, req, async (q) => {
      const existing = await projectExists(q, project.id);
      if (existing.exists) {
        throw conflict('PROJECT_EXISTS', `A project with id "${project.id}" already exists${existing.deleted ? ' (deleted — restore it or choose another id)' : ''}.`);
      }
      const r = await insertProject(q, project, user.id, 'Created');
      await stageAudit(q, req, {
        action: 'project.create',
        entityType: 'project',
        entityId: project.id,
        projectId: project.id,
        detail: { version: 1, name: project.name, currency: project.currency, workflows: project.workflows.length },
      });
      return r;
    });
    reply.code(201).header('location', `/api/projects/${encodeURIComponent(project.id)}`);
    return { project: row.data, meta: projectMeta(row), issues };
  });

  app.get<{ Params: IdParams }>('/projects/:id', async (req) => {
    const row = await getProjectRow(db, req.params.id);
    return { project: row.data, meta: projectMeta(row) };
  });

  app.put<{ Params: IdParams }>(
    '/projects/:id',
    { config: { anyPermission: ANY_PROJECT_WRITE, action: 'project.update', entity: 'project' } },
    async (req) => {
      const user = requireUser(req);
      const body = parse(UpdateProjectBody, req.body);
      const next = body.project as unknown as Project;
      if (next.id !== req.params.id) throw badRequest(`project.id ("${next.id}") must match the URL ("${req.params.id}"). Project ids cannot be changed.`);
      const catalog = await loadCatalog(db);
      const issues = validateWith(next, catalog);
      rejectIfErrors(issues, strictFlag(req.query));

      const result = await inTx(db, req, async (q) => {
        const row = await getProjectRow(q, req.params.id, { forUpdate: true });
        assertBaseVersion(row, body.baseVersion);
        const { permissions, changed } = requiredEditPermissions(row.data, next);
        requireAll(req, permissions, `change ${changed.join(', ') || 'this project'}`);
        if (!changed.length) {
          await stageAudit(q, req, { action: 'project.update', entityType: 'project', entityId: row.id, projectId: row.id, detail: { version: row.current_version, unchanged: true } });
          return { row, changed, unchanged: true };
        }
        const saved = await saveProjectVersion(q, row, next, user.id, body.comment ?? null);
        await stageAudit(q, req, {
          action: 'project.update',
          entityType: 'project',
          entityId: row.id,
          projectId: row.id,
          detail: { fromVersion: saved.previousVersion, toVersion: saved.version, changed: saved.changed, ...(body.comment ? { comment: body.comment.slice(0, 500) } : {}) },
        });
        return { row: saved.row, changed: saved.changed, unchanged: false };
      });
      return { project: result.row.data, meta: projectMeta(result.row), changed: result.changed, unchanged: result.unchanged, issues };
    },
  );

  app.delete<{ Params: IdParams }>('/projects/:id', { config: { permission: 'project.delete', action: 'project.delete', entity: 'project' } }, async (req) => {
    const user = requireUser(req);
    return inTx(db, req, async (q) => {
      const row = await getProjectRow(q, req.params.id, { forUpdate: true });
      const { rows } = await q.query<{ deleted_at: Date }>('UPDATE projects SET deleted_at = now(), updated_by = $2 WHERE id = $1 RETURNING deleted_at', [row.id, user.id]);
      await stageAudit(q, req, { action: 'project.delete', entityType: 'project', entityId: row.id, projectId: row.id, detail: { version: row.current_version, name: row.name, soft: true } });
      return { id: row.id, deletedAt: rows[0].deleted_at, version: row.current_version };
    });
  });

  app.post<{ Params: IdParams }>('/projects/:id/restore', { config: { permission: 'project.delete', action: 'project.restore', entity: 'project' } }, async (req) => {
    const user = requireUser(req);
    return inTx(db, req, async (q) => {
      const row = await getProjectRow(q, req.params.id, { forUpdate: true, includeDeleted: true });
      if (!row.deleted_at) throw conflict('NOT_DELETED', `Project "${row.id}" is not deleted.`);
      await q.query('UPDATE projects SET deleted_at = NULL, updated_by = $2 WHERE id = $1', [row.id, user.id]);
      await stageAudit(q, req, { action: 'project.restore', entityType: 'project', entityId: row.id, projectId: row.id, detail: { version: row.current_version } });
      return { id: row.id, restored: true, version: row.current_version };
    });
  });

  // ───────────── versions ─────────────

  app.get<{ Params: IdParams }>('/projects/:id/versions', async (req) => {
    const row = await getProjectRow(db, req.params.id);
    const q = req.query as Record<string, string | undefined>;
    const limit = q.limit ? intParam(q.limit, 'limit', { max: 500 }) : 100;
    const before = q.before ? intParam(q.before, 'before') : null;
    const { rows } = await db.query<{ version: number; comment: string | null; changed: string[]; created_at: Date; author_id: string | null; email: string | null; name: string | null }>(
      `SELECT v.version, v.comment, v.changed, v.created_at, v.author_id, u.email, u.name
         FROM project_versions v LEFT JOIN users u ON u.id = v.author_id
        WHERE v.project_id = $1 AND ($2::int IS NULL OR v.version < $2)
        ORDER BY v.version DESC LIMIT $3`,
      [row.id, before, limit],
    );
    return {
      projectId: row.id,
      currentVersion: row.current_version,
      versions: rows.map((v) => ({
        version: v.version,
        comment: v.comment,
        changed: v.changed,
        author: v.author_id ? { id: v.author_id, email: v.email, name: v.name } : null,
        createdAt: v.created_at,
        current: v.version === row.current_version,
      })),
    };
  });

  app.get<{ Params: IdParams & { version: string } }>('/projects/:id/versions/:version', async (req) => {
    const row = await getProjectRow(db, req.params.id);
    const version = intParam(req.params.version, 'version');
    const { rows } = await db.query<{ version: number; data: Project; comment: string | null; changed: string[]; created_at: Date; email: string | null }>(
      `SELECT v.version, v.data, v.comment, v.changed, v.created_at, u.email
         FROM project_versions v LEFT JOIN users u ON u.id = v.author_id
        WHERE v.project_id = $1 AND v.version = $2`,
      [row.id, version],
    );
    const v = rows[0];
    if (!v) throw notFound(`Version ${version} of project "${row.id}"`);
    return { projectId: row.id, version: v.version, current: v.version === row.current_version, comment: v.comment, changed: v.changed, author: v.email, createdAt: v.created_at, project: v.data };
  });

  // ───────────── compute & validate ─────────────

  app.post<{ Params: IdParams }>('/projects/:id/compute', { config: { readOnly: true } }, async (req) => {
    const qv = (req.query as Record<string, string | undefined>).version;
    const { project, version } = await loadProjectVersion(ctx, req.params.id, qv ? intParam(qv, 'version') : undefined);
    const catalog = await loadCatalog(db);
    const result = ctx.compute.compute(project, catalog, `${project.id}@${version}`);
    return { version, ...computeSummary(result, catalog) };
  });

  app.post('/compute', { config: { readOnly: true } }, async (req) => {
    const project = parse(ProjectSchema, req.body, 'project') as unknown as Project;
    const catalog = await loadCatalog(db);
    const result = ctx.compute.compute(project, catalog);
    return computeSummary(result, catalog);
  });

  app.post<{ Params: IdParams }>('/projects/:id/validate', { config: { readOnly: true } }, async (req) => {
    const row = await getProjectRow(db, req.params.id);
    const body = (req.body ?? {}) as { project?: unknown };
    let project = row.data;
    let source: 'stored' | 'request' = 'stored';
    if (body && typeof body === 'object' && 'project' in body && body.project !== undefined) {
      project = parse(ProjectSchema, body.project, 'project') as unknown as Project;
      source = 'request';
    }
    const catalog = await loadCatalog(db);
    const issues = validateWith(project, catalog);
    return { projectId: row.id, version: row.current_version, source, valid: !issues.some((i) => i.severity === 'error'), counts: issueCounts(issues), issues };
  });
}
