/**
 * Project rate-card versions: snapshot the currently derived prices as a
 * draft, then approve (Finance). Approving supersedes the previously approved
 * version. The compact engine `RateCardVersion` is mirrored into
 * project.pricing.rateCardVersions (new project version); the full stream
 * detail lives in rate_card_versions.data.
 */
import type { FastifyInstance } from 'fastify';
import type { Project, RateCardVersion } from '@aies/engine';
import type { AppContext } from '../context';
import { requireUser } from '../auth';
import { inTx, stageAudit } from '../audit';
import { conflict, notFound } from '../errors';
import { json } from '../db/adapter';
import { RateCardApproveBody, RateCardCreateBody } from '../schemas';
import { deepEqual, intParam, nowIso, parse } from '../util';
import { SERVER_FIELDS } from '../repo/projects';
import { loadCatalog } from '../repo/catalog';
import { getProjectRow, saveProjectVersion } from '../repo/projects';
import { rateCardSnapshot } from '../dto';

type IdParams = { id: string };

interface RateCardRow {
  version: number;
  status: 'draft' | 'approved' | 'superseded';
  data: Record<string, unknown>;
  note: string | null;
  project_version: number;
  created_at: Date;
  approved_at: Date | null;
  created_by_email: string | null;
  approved_by_email: string | null;
}

const rcDto = (r: RateCardRow) => ({
  version: r.version,
  status: r.status,
  note: r.note,
  projectVersion: r.project_version,
  createdBy: r.created_by_email,
  createdAt: r.created_at,
  approvedBy: r.approved_by_email,
  approvedAt: r.approved_at,
  rateCard: r.data,
});

const SELECT_RC = `SELECT r.version, r.status, r.data, r.note, r.project_version, r.created_at, r.approved_at, cu.email AS created_by_email, au.email AS approved_by_email
                     FROM rate_card_versions r LEFT JOIN users cu ON cu.id = r.created_by LEFT JOIN users au ON au.id = r.approved_by`;

/** Compact engine RateCardVersion from the stored snapshot. */
function compact(data: Record<string, unknown>, status: RateCardVersion['status']): RateCardVersion {
  const d = data as unknown as RateCardVersion;
  return { id: d.id, version: d.version, createdAt: d.createdAt, author: d.author, status, note: d.note, acuPrice: d.acuPrice, abuPrices: d.abuPrices, subscriptionFee: d.subscriptionFee, agentOpsFee: d.agentOpsFee };
}

/** Project content relevant to pricing: everything except server fields and the rate-card list. */
function withoutRateCards(p: Project): Record<string, unknown> {
  const c: Record<string, unknown> = { ...p, pricing: { ...p.pricing, rateCardVersions: [] } };
  for (const k of SERVER_FIELDS) delete c[k];
  return c;
}

export function rateCardRoutes(app: FastifyInstance, ctx: AppContext): void {
  const { db } = ctx;

  app.get<{ Params: IdParams }>('/projects/:id/rate-cards', async (req) => {
    const row = await getProjectRow(db, req.params.id);
    const { rows } = await db.query<RateCardRow>(`${SELECT_RC} WHERE r.project_id = $1 ORDER BY r.version DESC`, [row.id]);
    return { projectId: row.id, currentApproved: rows.find((r) => r.status === 'approved')?.version ?? null, rateCards: rows.map(rcDto) };
  });

  app.post<{ Params: IdParams }>('/projects/:id/rate-cards', { config: { permission: 'pricing.edit', action: 'ratecard.create', entity: 'rate_card' } }, async (req, reply) => {
    const user = requireUser(req);
    const body = parse(RateCardCreateBody, req.body ?? {});
    const row = await getProjectRow(db, req.params.id);
    const catalog = await loadCatalog(db);
    const result = ctx.compute.compute(row.data, catalog, `${row.id}@${row.current_version}`);

    const created = await inTx(db, req, async (q) => {
      const locked = await getProjectRow(q, row.id, { forUpdate: true });
      if (locked.current_version !== row.current_version) {
        throw conflict('VERSION_CONFLICT', 'The project changed while the rate card was being priced — try again.');
      }
      const { rows: vr } = await q.query<{ v: number | null }>('SELECT max(version) AS v FROM rate_card_versions WHERE project_id = $1', [row.id]);
      const version = (vr[0]?.v ?? 0) + 1;
      const snapshot = rateCardSnapshot(result, { id: `${row.id}-rc${version}`, version, author: user.name, note: body.note ?? '', createdAt: nowIso() });
      await q.query(
        `INSERT INTO rate_card_versions (project_id, version, status, data, note, project_version, created_by) VALUES ($1, $2, 'draft', $3::jsonb, $4, $5, $6)`,
        [row.id, version, json(snapshot), body.note ?? null, row.current_version, user.id],
      );
      const next: Project = { ...locked.data, pricing: { ...locked.data.pricing, rateCardVersions: [...(locked.data.pricing.rateCardVersions ?? []), compact(snapshot, 'draft')] } };
      const s = await saveProjectVersion(q, locked, next, user.id, `Rate card v${version} drafted`);
      await stageAudit(q, req, {
        action: 'ratecard.create',
        entityType: 'rate_card',
        entityId: String(version),
        projectId: row.id,
        detail: { rateCardVersion: version, status: 'draft', pricedFromVersion: row.current_version, fromVersion: s.previousVersion, toVersion: s.version, acuPrice: snapshot.acuPrice, abuPrices: snapshot.abuPrices },
      });
      return { version, snapshot, projectVersion: s.version };
    });
    reply.code(201);
    return { projectId: row.id, version: created.version, status: 'draft', projectVersion: created.projectVersion, pricedFromVersion: row.current_version, rateCard: created.snapshot };
  });

  app.post<{ Params: IdParams & { version: string } }>(
    '/projects/:id/rate-cards/:version/approve',
    { config: { permission: 'ratecard.approve', action: 'ratecard.approve', entity: 'rate_card' } },
    async (req) => {
      const user = requireUser(req);
      const body = parse(RateCardApproveBody, req.body ?? {});
      const version = intParam(req.params.version, 'version');
      return inTx(db, req, async (q) => {
        const locked = await getProjectRow(q, req.params.id, { forUpdate: true });
        const { rows } = await q.query<{ status: string; data: Record<string, unknown>; project_version: number }>(
          'SELECT status, data, project_version FROM rate_card_versions WHERE project_id = $1 AND version = $2 FOR UPDATE',
          [locked.id, version],
        );
        const rc = rows[0];
        if (!rc) throw notFound(`Rate card version ${version} of project "${locked.id}"`);
        if (rc.status !== 'draft') throw conflict('INVALID_STATE', `Rate card version ${version} is ${rc.status}; only drafts can be approved.`);
        const { rows: sup } = await q.query<{ version: number }>(
          `UPDATE rate_card_versions SET status = 'superseded', data = jsonb_set(data, '{status}', '"superseded"')
            WHERE project_id = $1 AND status = 'approved' RETURNING version`,
          [locked.id],
        );
        const { rows: upd } = await q.query<RateCardRow>(
          `UPDATE rate_card_versions SET status = 'approved', approved_by = $3, approved_at = now(),
                  data = jsonb_set(data, '{status}', '"approved"'), note = COALESCE($4, note)
            WHERE project_id = $1 AND version = $2
            RETURNING version, status, data, note, project_version, created_at, approved_at, NULL::text AS created_by_email, NULL::text AS approved_by_email`,
          [locked.id, version, user.id, body.note ?? null],
        );
        const superseded = sup.map((s) => s.version);
        const { rows: pricedFrom } = await q.query<{ data: Project }>('SELECT data FROM project_versions WHERE project_id = $1 AND version = $2', [locked.id, rc.project_version]);
        const stale = !pricedFrom.length || !deepEqual(withoutRateCards(pricedFrom[0].data), withoutRateCards(locked.data));
        const rcId = String((rc.data as { id?: string }).id ?? '');
        const supIds = new Set(superseded.map((v) => `${locked.id}-rc${v}`));
        const list = (locked.data.pricing.rateCardVersions ?? []).map((r) =>
          r.id === rcId ? { ...r, status: 'approved' as const } : supIds.has(r.id) || r.status === 'approved' ? { ...r, status: 'superseded' as const } : r,
        );
        if (!list.some((r) => r.id === rcId)) list.push(compact(upd[0].data, 'approved'));
        const next: Project = { ...locked.data, pricing: { ...locked.data.pricing, rateCardVersions: list } };
        const s = await saveProjectVersion(q, locked, next, user.id, `Rate card v${version} approved`);
        await stageAudit(q, req, {
          action: 'ratecard.approve',
          entityType: 'rate_card',
          entityId: String(version),
          projectId: locked.id,
          detail: { rateCardVersion: version, superseded, pricedFromVersion: rc.project_version, fromVersion: s.previousVersion, toVersion: s.version },
        });
        return {
          projectId: locked.id,
          version,
          status: 'approved',
          superseded,
          approvedBy: user.email,
          approvedAt: upd[0].approved_at,
          projectVersion: s.version,
          // Prices were derived from this project version; stale = the project has changed since (other than rate-card bookkeeping).
          pricedFromVersion: rc.project_version,
          stale,
        };
      });
    },
  );
}
