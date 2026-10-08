/**
 * Catalogue: assembled current Catalog, versioned model rates and cloud
 * prices (close current row + insert new version), FX table and ACU weight
 * set versions with approval.
 */
import type { FastifyInstance } from 'fastify';
import type { AcuWeightSet } from '@aies/engine';
import type { AppContext } from '../context';
import { requireUser } from '../auth';
import { inTx, stageAudit } from '../audit';
import { badRequest, notFound } from '../errors';
import { AcuWeightSetSchema, CloudPriceItemSchema, FxTableSchema, ModelRateSchema } from '../schemas';
import { intParam, parse } from '../util';
import { approveWeightSet, createWeightSetVersion, fxHistory, listWeightSets, loadCatalog, putFx, putRate, rateHistory, type RateTable } from '../repo/catalog';

type KeyParams = { key: string };

const KEY_RE = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/;

function checkKey(key: string): string {
  if (!KEY_RE.test(key)) throw badRequest('The rate key may contain letters, digits, "_", ".", ":" and "-" (max 128 characters).');
  return key;
}

export function catalogRoutes(app: FastifyInstance, ctx: AppContext): void {
  const { db } = ctx;

  app.get('/catalog', async () => loadCatalog(db));

  const versionedRate = (path: string, table: RateTable, schema: typeof ModelRateSchema | typeof CloudPriceItemSchema, entity: string, label: string) => {
    app.put<{ Params: KeyParams }>(`/catalog/${path}/:key`, { config: { permission: 'catalog.edit', action: `catalog.${entity}.update`, entity } }, async (req) => {
      const user = requireUser(req);
      const key = checkKey(req.params.key);
      const data = parse(schema, req.body, label) as Record<string, unknown>;
      if (data.id !== key) throw badRequest(`Body id ("${String(data.id)}") must match the URL key ("${key}").`);
      const result = await inTx(db, req, async (q) => {
        const r = await putRate(q, table, key, data, user.id);
        await stageAudit(q, req, {
          action: `catalog.${entity}.update`,
          entityType: entity,
          entityId: key,
          detail: r.unchanged ? { version: r.version, unchanged: true } : { fromVersion: r.previousVersion, toVersion: r.version, changed: r.changed, created: r.previousVersion === null },
        });
        return r;
      });
      ctx.compute.clear();
      return { key, version: result.version, previousVersion: result.previousVersion, changed: result.changed, unchanged: result.unchanged, data: result.data };
    });

    app.get<{ Params: KeyParams }>(`/catalog/${path}/:key/history`, async (req) => {
      const key = checkKey(req.params.key);
      const history = await rateHistory(db, table, key);
      if (!history.length) throw notFound(`${label} "${key}"`);
      return { key, history };
    });
  };

  versionedRate('model-rates', 'model_rates', ModelRateSchema, 'model_rate', 'model rate');
  versionedRate('cloud-prices', 'cloud_price_items', CloudPriceItemSchema, 'cloud_price', 'cloud price item');

  // ───────────── FX ─────────────

  app.put('/catalog/fx', { config: { permission: 'catalog.edit', action: 'catalog.fx.update', entity: 'fx' } }, async (req) => {
    const user = requireUser(req);
    const body = parse(FxTableSchema, req.body, 'FX table');
    const diff = await inTx(db, req, async (q) => {
      const d = await putFx(q, body, user.id);
      const unchanged = !d.added.length && !d.updated.length && !d.removed.length;
      await stageAudit(q, req, { action: 'catalog.fx.update', entityType: 'fx', entityId: body.base, detail: { base: body.base, asOf: body.asOf, added: d.added, updated: d.updated, removed: d.removed, unchanged } });
      return d;
    });
    ctx.compute.clear();
    return { ...diff, fx: (await loadCatalog(db)).fx };
  });

  app.get('/catalog/fx/history', async (req) => {
    const q = req.query as Record<string, string | undefined>;
    const currency = q.currency && /^[A-Z]{3}$/.test(q.currency) ? q.currency : null;
    const limit = q.limit ? intParam(q.limit, 'limit', { max: 2000 }) : 500;
    return { history: await fxHistory(db, currency, limit) };
  });

  // ───────────── ACU weight sets ─────────────

  app.get('/catalog/acu-weight-sets', async () => ({ weightSets: await listWeightSets(db) }));

  app.post('/catalog/acu-weight-sets', { config: { permission: 'catalog.edit', action: 'catalog.acu_weight_set.create', entity: 'acu_weight_set' } }, async (req, reply) => {
    const user = requireUser(req);
    const body = parse(AcuWeightSetSchema, req.body, 'ACU weight set') as AcuWeightSet;
    const ws: AcuWeightSet = { ...body, author: body.author || user.name, status: 'draft' };
    const data = await inTx(db, req, async (q) => {
      const d = await createWeightSetVersion(q, ws, user.id, 'draft');
      await stageAudit(q, req, { action: 'catalog.acu_weight_set.create', entityType: 'acu_weight_set', entityId: `${ws.id}@${ws.version}`, detail: { id: ws.id, version: ws.version, status: 'draft' } });
      return d;
    });
    reply.code(201);
    return { weightSet: data };
  });

  app.post<{ Params: { id: string; version: string } }>(
    '/catalog/acu-weight-sets/:id/:version/approve',
    { config: { permission: 'catalog.edit', action: 'catalog.acu_weight_set.approve', entity: 'acu_weight_set' } },
    async (req) => {
      const user = requireUser(req);
      const { id, version } = req.params;
      const result = await inTx(db, req, async (q) => {
        const r = await approveWeightSet(q, id, version, user.id);
        await stageAudit(q, req, { action: 'catalog.acu_weight_set.approve', entityType: 'acu_weight_set', entityId: `${id}@${version}`, detail: { id, version, retired: r.retired } });
        return r;
      });
      ctx.compute.clear();
      return { id, version, status: 'approved', retired: result.retired, approvedBy: user.email };
    },
  );
}
