/**
 * Post-deployment monitoring: actuals (bulk upsert, mirrored into the
 * project JSON with a new version), estimate-vs-actual variance, and Finance
 * validation of benefit lines.
 */
import type { FastifyInstance } from 'fastify';
import { varianceAnalysis, type Project } from '@aies/engine';
import type { AppContext } from '../context';
import { requireUser } from '../auth';
import { inTx, stageAudit } from '../audit';
import { badRequest, notFound } from '../errors';
import { BenefitValidateBody, PutActualsBody } from '../schemas';
import { json } from '../db/adapter';
import { deepEqual, monthDiff, parse, todayIso } from '../util';
import { loadCatalog } from '../repo/catalog';
import { actualFromRow, assertBaseVersion, getProjectRow, listActuals, saveProjectVersion } from '../repo/projects';
import { engineCall } from '../engine-service';

type IdParams = { id: string };

export function actualsRoutes(app: FastifyInstance, ctx: AppContext): void {
  const { db } = ctx;

  app.get<{ Params: IdParams }>('/projects/:id/actuals', async (req) => {
    const row = await getProjectRow(db, req.params.id);
    const rows = await listActuals(db, row.id);
    return {
      projectId: row.id,
      version: row.current_version,
      currency: row.currency,
      actuals: rows.map((r) => ({
        period: r.period,
        monthIndex: r.month_index,
        workflowId: r.workflow_id,
        attempted: r.attempted,
        accepted: r.accepted,
        inputTokens: r.input_tokens,
        outputTokens: r.output_tokens,
        llmCost: r.llm_cost,
        nonLlmCost: r.non_llm_cost,
        realizedBenefit: r.realized_benefit,
        currency: r.currency,
        updatedAt: r.updated_at,
      })),
    };
  });

  app.put<{ Params: IdParams }>('/projects/:id/actuals', { config: { permission: 'actuals.edit', action: 'actuals.upsert', entity: 'actuals' } }, async (req) => {
    const user = requireUser(req);
    const body = parse(PutActualsBody, req.body);
    const catalog = await loadCatalog(db);

    return inTx(db, req, async (q) => {
      const row = await getProjectRow(q, req.params.id, { forUpdate: true });
      assertBaseVersion(row, body.baseVersion);
      const project = row.data;
      const wfIds = new Set(project.workflows.map((w) => w.id));
      const seen = new Set<string>();
      const problems: string[] = [];
      const records = body.actuals.map((a, i) => {
        const key = `${a.period}|${a.workflowId}`;
        if (seen.has(key)) problems.push(`actuals[${i}]: duplicate entry for ${a.period} / ${a.workflowId}`);
        seen.add(key);
        if (!wfIds.has(a.workflowId)) problems.push(`actuals[${i}]: workflow "${a.workflowId}" does not exist in this project`);
        const derived = monthDiff(project.goLiveDate, a.period) + 1;
        if (a.monthIndex !== undefined && a.monthIndex !== derived) problems.push(`actuals[${i}]: monthIndex ${a.monthIndex} does not match period ${a.period} (go-live ${project.goLiveDate} → month ${derived})`);
        if (derived < 1) problems.push(`actuals[${i}]: period ${a.period} is before go-live (${project.goLiveDate})`);
        if (derived > project.pricing.termMonths) problems.push(`actuals[${i}]: period ${a.period} is after the ${project.pricing.termMonths}-month contract term`);
        const currency = a.currency ?? project.currency;
        if (currency !== catalog.fx.base && catalog.fx.rates[currency] === undefined) problems.push(`actuals[${i}]: no FX rate configured for ${currency}`);
        if (Number(a.accepted) > Number(a.attempted)) problems.push(`actuals[${i}]: accepted (${a.accepted}) cannot exceed attempted (${a.attempted})`);
        return {
          period: a.period,
          workflow_id: a.workflowId,
          month_index: derived,
          attempted: String(a.attempted),
          accepted: String(a.accepted),
          input_tokens: a.inputTokens,
          output_tokens: a.outputTokens,
          llm_cost: String(a.llmCost),
          non_llm_cost: String(a.nonLlmCost),
          realized_benefit: String(a.realizedBenefit),
          currency,
        };
      });
      if (problems.length) throw badRequest(`Invalid actuals — ${problems.slice(0, 3).join('; ')}${problems.length > 3 ? ` (and ${problems.length - 3} more)` : ''}`, { problems });

      if (body.mode === 'replace') await q.query('DELETE FROM actuals WHERE project_id = $1', [row.id]);
      let upserted = 0;
      if (records.length) {
        const r = await q.query(
          `INSERT INTO actuals AS a (project_id, period, workflow_id, month_index, attempted, accepted, input_tokens, output_tokens, llm_cost, non_llm_cost, realized_benefit, currency, updated_by)
           SELECT $1, r.period, r.workflow_id, r.month_index, r.attempted::numeric, r.accepted::numeric, r.input_tokens, r.output_tokens,
                  r.llm_cost::numeric, r.non_llm_cost::numeric, r.realized_benefit::numeric, r.currency, $3
             FROM jsonb_to_recordset($2::jsonb) AS r(period text, workflow_id text, month_index int, attempted text, accepted text, input_tokens bigint,
                                                    output_tokens bigint, llm_cost text, non_llm_cost text, realized_benefit text, currency text)
           ON CONFLICT (project_id, period, workflow_id) DO UPDATE SET
             month_index = EXCLUDED.month_index, attempted = EXCLUDED.attempted, accepted = EXCLUDED.accepted,
             input_tokens = EXCLUDED.input_tokens, output_tokens = EXCLUDED.output_tokens, llm_cost = EXCLUDED.llm_cost,
             non_llm_cost = EXCLUDED.non_llm_cost, realized_benefit = EXCLUDED.realized_benefit, currency = EXCLUDED.currency,
             updated_by = EXCLUDED.updated_by`,
          [row.id, json(records), user.id],
        );
        upserted = r.rowCount;
      }
      const all = (await listActuals(q, row.id)).map(actualFromRow);
      const periods = [...new Set(records.map((r) => r.period))].sort();
      const unchanged = deepEqual(project.actuals ?? [], all);
      let version = row.current_version;
      if (!unchanged) {
        const next: Project = { ...project, actuals: all };
        const saved = await saveProjectVersion(q, row, next, user.id, body.comment ?? `Actuals ${body.mode === 'replace' ? 'replaced' : 'updated'} (${records.length} rows)`, { syncActuals: false });
        version = saved.version;
      }
      await stageAudit(q, req, {
        action: 'actuals.upsert',
        entityType: 'actuals',
        entityId: row.id,
        projectId: row.id,
        detail: { mode: body.mode, rows: records.length, periods, fromVersion: row.current_version, toVersion: version, unchanged },
      });
      return { projectId: row.id, version, previousVersion: row.current_version, unchanged, mode: body.mode, upserted, total: all.length, periods, actuals: all };
    });
  });

  app.get<{ Params: IdParams }>('/projects/:id/variance', async (req) => {
    const row = await getProjectRow(db, req.params.id);
    const catalog = await loadCatalog(db);
    const result = ctx.compute.compute(row.data, catalog, `${row.id}@${row.current_version}`);
    const variance = engineCall('analyse variance', () => varianceAnalysis(result, catalog));
    return { projectId: row.id, version: row.current_version, currency: result.currency, ...variance };
  });

  // ───────────── benefit validation ─────────────

  app.post<{ Params: IdParams & { benefitId: string } }>(
    '/projects/:id/benefits/:benefitId/validate',
    { config: { permission: 'benefit.validate', action: 'benefit.validate', entity: 'benefit' } },
    async (req) => {
      const user = requireUser(req);
      const body = parse(BenefitValidateBody, req.body);
      const saved = await inTx(db, req, async (q) => {
        const row = await getProjectRow(q, req.params.id, { forUpdate: true });
        assertBaseVersion(row, body.baseVersion);
        const idx = row.data.value.benefits.findIndex((b) => b.id === req.params.benefitId);
        if (idx < 0) throw notFound(`Benefit "${req.params.benefitId}" in project "${row.id}"`);
        const before = row.data.value.benefits[idx];
        const benefit = { ...before, status: body.status, validatedBy: `${user.name} (${user.email})`, validatedOn: todayIso() };
        const benefits = row.data.value.benefits.map((b, i) => (i === idx ? benefit : b));
        const next: Project = { ...row.data, value: { ...row.data.value, benefits } };
        const label = body.status === 'rejected' ? 'rejected' : body.status === 'realized' ? 'marked realized' : 'finance-validated';
        const s = await saveProjectVersion(q, row, next, user.id, body.comment ?? `Benefit "${before.name}" ${label}`);
        await q.query(
          `INSERT INTO benefit_validations (project_id, benefit_id, status, previous_status, validated_by, comment, project_version)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [row.id, benefit.id, body.status, before.status, user.id, body.comment ?? null, s.version],
        );
        await stageAudit(q, req, {
          action: 'benefit.validate',
          entityType: 'benefit',
          entityId: benefit.id,
          projectId: row.id,
          detail: { from: before.status, to: body.status, fromVersion: s.previousVersion, toVersion: s.version, ...(body.comment ? { comment: body.comment.slice(0, 500) } : {}) },
        });
        return { benefit, previousStatus: before.status, version: s.version, project: s.row.data };
      });
      // Report the effect on client ROI at the new version (cached for the next compute call).
      const catalog = await loadCatalog(db);
      const result = ctx.compute.compute(saved.project, catalog, `${saved.project.id}@${saved.version}`);
      const c = result.economics.client;
      return {
        projectId: saved.project.id,
        version: saved.version,
        previousStatus: saved.previousStatus,
        benefit: saved.benefit,
        economics: { roiPct: c.roiPct, validatedBenefits: c.validatedBenefits, countedBenefits: c.countedBenefits, netBenefit: c.netBenefit, paybackMonths: c.paybackMonths, npv: c.npv },
      };
    },
  );

  app.get<{ Params: IdParams }>('/projects/:id/benefit-validations', async (req) => {
    const row = await getProjectRow(db, req.params.id);
    const benefitId = (req.query as Record<string, string | undefined>).benefitId ?? null;
    const { rows } = await db.query<{ id: number; benefit_id: string; status: string; previous_status: string | null; comment: string | null; project_version: number; created_at: Date; email: string | null }>(
      `SELECT b.id, b.benefit_id, b.status, b.previous_status, b.comment, b.project_version, b.created_at, u.email
         FROM benefit_validations b LEFT JOIN users u ON u.id = b.validated_by
        WHERE b.project_id = $1 AND ($2::text IS NULL OR b.benefit_id = $2)
        ORDER BY b.id DESC LIMIT 500`,
      [row.id, benefitId],
    );
    return {
      projectId: row.id,
      validations: rows.map((r) => ({ id: r.id, benefitId: r.benefit_id, status: r.status, previousStatus: r.previous_status, comment: r.comment, projectVersion: r.project_version, validatedBy: r.email, createdAt: r.created_at })),
    };
  });
}
