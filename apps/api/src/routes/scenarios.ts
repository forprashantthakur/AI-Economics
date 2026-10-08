/**
 * Scenario simulator: ad-hoc runs (metrics + cost waterfall) and versioned,
 * named scenarios with the metrics computed at save time. Saved scenarios
 * live in the `scenarios` table (they do not bump the project version).
 */
import type { FastifyInstance } from 'fastify';
import { SCENARIO_PRESETS, costWaterfall, metricsOf, runScenario, type Catalog, type Project, type ProjectResult, type ScenarioOverrides, type ScenarioRecord } from '@aies/engine';
import type { AppContext } from '../context';
import { requireUser } from '../auth';
import { inTx, stageAudit } from '../audit';
import { badRequest, conflict, notFound } from '../errors';
import { json } from '../db/adapter';
import { ScenarioRunBody, ScenarioSaveBody } from '../schemas';
import { parse } from '../util';
import { loadCatalog } from '../repo/catalog';
import { getProjectRow, saveProjectVersion } from '../repo/projects';
import { engineCall } from '../engine-service';

type IdParams = { id: string };

function resolveOverrides(body: { overrides?: ScenarioOverrides; preset?: keyof typeof SCENARIO_PRESETS }): { overrides: ScenarioOverrides; preset: string | null } {
  const base = body.preset ? SCENARIO_PRESETS[body.preset].overrides : {};
  return { overrides: { ...base, ...(body.overrides ?? {}) }, preset: body.preset ?? null };
}

function checkModels(project: Project, catalog: Catalog, o: ScenarioOverrides): void {
  const ids = new Set(catalog.modelRates.map((m) => m.id));
  const refs = [o.routingShift?.toModelId, o.modelSwap?.toModelId].filter((x): x is string => !!x);
  for (const id of refs) if (!ids.has(id)) throw badRequest(`Model "${id}" is not in the model rate card.`);
  if (o.modelSwap && !project.workflows.some((w) => w.llmSteps.some((s) => s.routing.some((r) => r.modelId === o.modelSwap!.fromModelId)))) {
    throw badRequest(`Model "${o.modelSwap.fromModelId}" is not used by this project, so it cannot be swapped.`);
  }
}

export function runScenarioDto(base: ProjectResult, catalog: Catalog, overrides: ScenarioOverrides, withBreakEven: boolean) {
  return engineCall('run the scenario', () => {
    const run = runScenario(base, catalog, overrides, withBreakEven);
    return {
      baseline: metricsOf(base, catalog, withBreakEven),
      metrics: run.metrics,
      costWaterfall: costWaterfall(base.project, catalog, overrides),
      reconciliationPassed: run.result.reconciliation.every((c) => c.pass),
      issues: run.result.issues.filter((i) => i.severity !== 'info'),
    };
  });
}

interface ScenarioRow {
  id: string;
  name: string;
  version: number;
  overrides: ScenarioOverrides;
  metrics: unknown;
  project_version: number;
  comment: string | null;
  created_at: Date;
  email: string | null;
}

const scenarioDto = (r: ScenarioRow) => ({
  id: r.id,
  name: r.name,
  version: r.version,
  overrides: r.overrides,
  metrics: r.metrics,
  projectVersion: r.project_version,
  comment: r.comment,
  author: r.email,
  createdAt: r.created_at,
});

export function scenarioRoutes(app: FastifyInstance, ctx: AppContext): void {
  const { db } = ctx;

  app.get<{ Params: IdParams }>('/projects/:id/scenarios', async (req) => {
    const row = await getProjectRow(db, req.params.id);
    const q = req.query as Record<string, string | undefined>;
    const all = q.all === 'true';
    const { rows } = await db.query<ScenarioRow>(
      `SELECT s.id, s.name, s.version, s.overrides, s.metrics, s.project_version, s.comment, s.created_at, u.email
         FROM scenarios s LEFT JOIN users u ON u.id = s.author_id
        WHERE s.project_id = $1 AND ($2::text IS NULL OR s.name = $2)
          AND ($3::boolean OR s.version = (SELECT max(version) FROM scenarios x WHERE x.project_id = s.project_id AND x.name = s.name))
        ORDER BY s.name, s.version DESC`,
      [row.id, q.name ?? null, all || !!q.name],
    );
    return {
      projectId: row.id,
      projectVersion: row.current_version,
      scenarios: rows.map(scenarioDto),
      presets: Object.entries(SCENARIO_PRESETS).map(([id, p]) => ({ id, ...p })),
    };
  });

  app.get<{ Params: IdParams & { scenarioId: string } }>('/projects/:id/scenarios/:scenarioId', async (req) => {
    const row = await getProjectRow(db, req.params.id);
    if (!/^[0-9a-f-]{36}$/i.test(req.params.scenarioId)) throw badRequest('scenarioId must be a UUID.');
    const { rows } = await db.query<ScenarioRow>(
      `SELECT s.id, s.name, s.version, s.overrides, s.metrics, s.project_version, s.comment, s.created_at, u.email
         FROM scenarios s LEFT JOIN users u ON u.id = s.author_id WHERE s.project_id = $1 AND s.id = $2`,
      [row.id, req.params.scenarioId],
    );
    if (!rows.length) throw notFound(`Scenario ${req.params.scenarioId} of project "${row.id}"`);
    return scenarioDto(rows[0]);
  });

  app.post<{ Params: IdParams }>('/projects/:id/scenarios/run', { config: { readOnly: true } }, async (req) => {
    const body = parse(ScenarioRunBody, req.body ?? {});
    const row = await getProjectRow(db, req.params.id);
    const catalog = await loadCatalog(db);
    const { overrides, preset } = resolveOverrides(body);
    checkModels(row.data, catalog, overrides);
    const base = ctx.compute.compute(row.data, catalog, `${row.id}@${row.current_version}`);
    return { projectId: row.id, projectVersion: row.current_version, currency: base.currency, preset, overrides, ...runScenarioDto(base, catalog, overrides, body.breakEven ?? true) };
  });

  app.post<{ Params: IdParams }>('/projects/:id/scenarios', { config: { permission: 'scenario.save', action: 'scenario.save', entity: 'scenario' } }, async (req, reply) => {
    const user = requireUser(req);
    const body = parse(ScenarioSaveBody, req.body);
    const row = await getProjectRow(db, req.params.id);
    const catalog = await loadCatalog(db);
    const { overrides, preset } = resolveOverrides(body);
    checkModels(row.data, catalog, overrides);
    const base = ctx.compute.compute(row.data, catalog, `${row.id}@${row.current_version}`);
    const metrics = engineCall('run the scenario', () => runScenario(base, catalog, overrides, true).metrics);

    const saved = await inTx(db, req, async (q) => {
      // Lock the project row so concurrent saves of the same name get distinct versions.
      const locked = await getProjectRow(q, req.params.id, { forUpdate: true });
      if (locked.current_version !== row.current_version) throw conflict('VERSION_CONFLICT', 'The project changed while the scenario was being computed — try again.');
      // Versions continue from both the table and scenarios saved in the project JSON (e.g. by the web app).
      const { rows: vr } = await q.query<{ v: number | null }>('SELECT max(version) AS v FROM scenarios WHERE project_id = $1 AND lower(name) = lower($2)', [locked.id, body.name]);
      const jsonMax = Math.max(0, ...(locked.data.scenarios ?? []).filter((s) => s.name.toLowerCase() === body.name.toLowerCase()).map((s) => Number(s.version) || 0));
      const version = Math.max(vr[0]?.v ?? 0, jsonMax) + 1;
      const { rows } = await q.query<{ id: string; created_at: Date }>(
        `INSERT INTO scenarios (project_id, name, version, overrides, metrics, project_version, comment, author_id)
         VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $6, $7, $8) RETURNING id, created_at`,
        [locked.id, body.name, version, json(overrides), json(metrics), row.current_version, body.comment ?? null, user.id],
      );
      // Mirror into project.scenarios (the engine/web representation) as a new project version.
      const record: ScenarioRecord = { id: rows[0].id, name: body.name, version, createdAt: rows[0].created_at.toISOString(), author: user.name, overrides };
      const next: Project = { ...locked.data, scenarios: [...(locked.data.scenarios ?? []), record] };
      const s = await saveProjectVersion(q, locked, next, user.id, `Saved scenario "${body.name}" v${version}`);
      await stageAudit(q, req, {
        action: 'scenario.save',
        entityType: 'scenario',
        entityId: rows[0].id,
        projectId: locked.id,
        detail: { name: body.name, version, preset, overrideKeys: Object.keys(overrides).sort(), computedOnVersion: row.current_version, fromVersion: s.previousVersion, toVersion: s.version },
      });
      return { id: rows[0].id, createdAt: rows[0].created_at, version, projectVersion: s.version };
    });
    reply.code(201);
    return {
      id: saved.id,
      projectId: row.id,
      name: body.name,
      version: saved.version,
      preset,
      overrides,
      metrics,
      projectVersion: saved.projectVersion,
      computedOnVersion: row.current_version,
      comment: body.comment ?? null,
      author: user.email,
      createdAt: saved.createdAt,
    };
  });
}
