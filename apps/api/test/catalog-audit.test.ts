import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { defaultCatalog } from '@aies/engine';
import { createTestApp, type TestApp } from './helpers';
import { migrate } from '../src/db/migrate';

let t: TestApp;
beforeAll(async () => {
  t = await createTestApp();
});
afterAll(async () => {
  await t?.close();
});

describe('catalogue', () => {
  it('assembles the seeded catalogue in the engine Catalog shape', async () => {
    const r = await t.as('executive', { method: 'GET', url: '/api/catalog' });
    expect(r.statusCode).toBe(200);
    const c = r.json();
    const d = defaultCatalog();
    expect(c.version).toMatch(/^db-[0-9a-f]{16}$/);
    expect(c.modelRates.map((m: { id: string }) => m.id)).toEqual(d.modelRates.map((m) => m.id));
    expect(c.cloudPrices).toHaveLength(d.cloudPrices.length);
    expect(c.fx.rates).toEqual(d.fx.rates);
    expect(c.fx.base).toBe('USD');
    expect(c.acuWeightSets.map((w: { id: string; status: string }) => `${w.id}:${w.status}`)).toEqual(['acu-std-v1:approved', 'acu-std-v0.9:retired']);
  });

  it('versions model-rate updates (history shows 2 rows) and the new rate changes compute', async () => {
    const before = (await t.as('finance', { method: 'POST', url: '/api/projects/sample-ap/compute' })).json();
    const cat = (await t.as('finance', { method: 'GET', url: '/api/catalog' })).json();
    const sonnet = cat.modelRates.find((m: { id: string }) => m.id === 'anthropic-sonnet-class');

    expect((await t.as('consultant', { method: 'PUT', url: '/api/catalog/model-rates/anthropic-sonnet-class', payload: { ...sonnet, inputPerM: 6 } })).statusCode).toBe(403);

    const put = await t.as('finance', { method: 'PUT', url: '/api/catalog/model-rates/anthropic-sonnet-class', payload: { ...sonnet, inputPerM: 6, source: 'Contract 2026-10' } });
    expect(put.statusCode).toBe(200);
    expect(put.json()).toMatchObject({ version: 2, previousVersion: 1, changed: ['inputPerM', 'source'] });

    const hist = (await t.as('executive', { method: 'GET', url: '/api/catalog/model-rates/anthropic-sonnet-class/history' })).json().history;
    expect(hist).toHaveLength(2);
    expect(hist[0]).toMatchObject({ version: 2, current: true, effectiveTo: null, data: { inputPerM: 6 } });
    expect(hist[1]).toMatchObject({ version: 1, current: false, data: { inputPerM: 3 } });
    expect(hist[1].effectiveTo).not.toBeNull();

    // Same data again: no new version.
    const same = await t.as('finance', { method: 'PUT', url: '/api/catalog/model-rates/anthropic-sonnet-class', payload: { ...sonnet, inputPerM: 6, source: 'Contract 2026-10' } });
    expect(same.json()).toMatchObject({ unchanged: true, version: 2 });

    const cat2 = (await t.as('finance', { method: 'GET', url: '/api/catalog' })).json();
    expect(cat2.version).not.toBe(cat.version);
    expect(cat2.modelRates.find((m: { id: string }) => m.id === 'anthropic-sonnet-class').inputPerM).toBe(6);
    expect(cat2.modelRates.map((m: { id: string }) => m.id)).toEqual(cat.modelRates.map((m: { id: string }) => m.id)); // order stable

    const after = (await t.as('finance', { method: 'POST', url: '/api/projects/sample-ap/compute' })).json();
    expect(Number(after.baseline.llm.total)).toBeGreaterThan(Number(before.baseline.llm.total));

    const mismatch = await t.as('finance', { method: 'PUT', url: '/api/catalog/model-rates/other-key', payload: sonnet });
    expect(mismatch.statusCode).toBe(400);
    expect((await t.as('finance', { method: 'PUT', url: '/api/catalog/model-rates/anthropic-sonnet-class', payload: { ...sonnet, inputPerM: -1 } })).statusCode).toBe(400);
  });

  it('versions cloud prices and FX, and approves ACU weight-set versions', async () => {
    const cat = (await t.as('finance', { method: 'GET', url: '/api/catalog' })).json();
    const node = cat.cloudPrices.find((c: { id: string }) => c.id === 'node-8x32-month');
    const cp = await t.as('finance', { method: 'PUT', url: '/api/catalog/cloud-prices/node-8x32-month', payload: { ...node, unitCost: 300 } });
    expect(cp.json()).toMatchObject({ version: 2, changed: ['unitCost'] });
    expect((await t.as('finance', { method: 'GET', url: '/api/catalog/cloud-prices/node-8x32-month/history' })).json().history).toHaveLength(2);

    const fx = await t.as('finance', { method: 'PUT', url: '/api/catalog/fx', payload: { ...cat.fx, asOf: cat.fx.asOf, rates: { ...cat.fx.rates, INR: '88.5', CHF: 0.8 } } });
    expect(fx.statusCode).toBe(200);
    expect(fx.json()).toMatchObject({ added: ['CHF'], updated: ['INR'], removed: [] });
    expect(fx.json().fx.rates.INR).toBe(88.5);
    const inrHist = (await t.as('executive', { method: 'GET', url: '/api/catalog/fx/history?currency=INR' })).json().history;
    expect(inrHist.map((h: { rate: string; current: boolean }) => [h.rate, h.current])).toEqual([
      ['88.5000000000', true],
      ['88.0000000000', false],
    ]);
    expect((await t.as('finance', { method: 'PUT', url: '/api/catalog/fx', payload: { ...cat.fx, rates: { USD: 2 } } })).statusCode).toBe(400);

    const ws = { ...cat.acuWeightSets[0], version: '1.1', rationale: 'Recalibrated cached-token weight', weights: { ...cat.acuWeightSets[0].weights, cached_tokens_m: 30 } };
    const created = await t.as('finance', { method: 'POST', url: '/api/catalog/acu-weight-sets', payload: ws });
    expect(created.statusCode).toBe(201);
    expect(created.json().weightSet.status).toBe('draft');
    expect((await t.as('finance', { method: 'POST', url: '/api/catalog/acu-weight-sets', payload: ws })).statusCode).toBe(409);

    const approve = await t.as('finance', { method: 'POST', url: '/api/catalog/acu-weight-sets/acu-std-v1/1.1/approve' });
    expect(approve.statusCode).toBe(200);
    expect(approve.json().retired).toEqual(['1.0']);
    const sets = (await t.as('executive', { method: 'GET', url: '/api/catalog/acu-weight-sets' })).json().weightSets;
    expect(sets.filter((s: { id: string }) => s.id === 'acu-std-v1').map((s: { version: string; status: string }) => `${s.version}:${s.status}`)).toEqual(['1.1:approved', '1.0:retired']);
    const eff = (await t.as('executive', { method: 'GET', url: '/api/catalog' })).json().acuWeightSets.find((w: { id: string }) => w.id === 'acu-std-v1');
    expect(eff).toMatchObject({ version: '1.1', status: 'approved', weights: { cached_tokens_m: 30 } });
  });
});

describe('templates', () => {
  it('lists built-in templates and saves custom ones', async () => {
    const list = (await t.as('executive', { method: 'GET', url: '/api/templates' })).json();
    expect(list.builtIn.length).toBeGreaterThan(10);
    expect(list.custom).toEqual([]);
    const tpl = { ...list.builtIn[0], id: 'custom-ap-lite', name: 'AP lite', builtIn: false };
    const r = await t.as('consultant', { method: 'POST', url: '/api/templates', payload: tpl });
    expect(r.statusCode).toBe(201);
    const r2 = await t.as('consultant', { method: 'POST', url: '/api/templates', payload: { ...tpl, name: 'AP lite v2' } });
    expect(r2.statusCode).toBe(200);
    expect(r2.json().created).toBe(false);
    expect((await t.as('consultant', { method: 'POST', url: '/api/templates', payload: list.builtIn[0] })).statusCode).toBe(409);
    expect((await t.as('executive', { method: 'POST', url: '/api/templates', payload: tpl })).statusCode).toBe(403);
    const after = (await t.as('executive', { method: 'GET', url: '/api/templates' })).json();
    expect(after.custom.map((c: { id: string; name: string }) => `${c.id}:${c.name}`)).toEqual(['custom-ap-lite:AP lite v2']);
  });
});

describe('audit log', () => {
  it('records every mutation with user, role, entity and a compact detail, and is append-only', async () => {
    const p = (await t.as('architect', { method: 'GET', url: '/api/projects/sample-cs' })).json();
    const edited = structuredClone(p.project);
    edited.solution.peakConcurrency = 300;
    const put = await t.as('architect', { method: 'PUT', url: '/api/projects/sample-cs', payload: { project: edited, baseVersion: p.meta.version, comment: 'Peak load' } });
    expect(put.statusCode).toBe(200);
    await t.as('architect', { method: 'PUT', url: '/api/projects/sample-cs', payload: { project: edited, baseVersion: p.meta.version } }); // 409

    const r = await t.as('finance', { method: 'GET', url: '/api/audit?projectId=sample-cs&limit=10' });
    expect(r.statusCode).toBe(200);
    const [conflictRow, updateRow] = r.json().entries;
    expect(updateRow).toMatchObject({
      action: 'project.update',
      outcome: 'success',
      userEmail: 'architect@demo.local',
      role: 'architect',
      entityType: 'project',
      entityId: 'sample-cs',
      projectId: 'sample-cs',
      detail: { fromVersion: p.meta.version, toVersion: p.meta.version + 1, changed: ['solution'], comment: 'Peak load' },
    });
    expect(conflictRow).toMatchObject({ action: 'project.update', outcome: 'failure', statusCode: 409, detail: { error: { code: 'VERSION_CONFLICT' } } });

    // Every successful mutation in this file produced exactly one success row.
    const { rows } = await t.app.db.query<{ action: string; n: number }>("SELECT action, count(*)::int AS n FROM audit_log WHERE outcome = 'success' GROUP BY action ORDER BY action");
    const counts = Object.fromEntries(rows.map((x) => [x.action, x.n]));
    expect(counts).toMatchObject({
      'system.seed': 1,
      'auth.login': 6,
      'catalog.model_rate.update': 2, // the identical re-PUT is audited as { unchanged: true }
      'catalog.cloud_price.update': 1,
      'catalog.fx.update': 1,
      'catalog.acu_weight_set.create': 1,
      'catalog.acu_weight_set.approve': 1,
      'template.save': 2,
      'project.update': 1,
    });

    const rateRows = (await t.as('admin', { method: 'GET', url: '/api/audit?action=catalog.model_rate.update' })).json().entries;
    expect(rateRows.map((e: { outcome: string; statusCode: number | null }) => `${e.outcome}:${e.statusCode ?? ''}`)).toEqual(['failure:400', 'failure:400', 'success:', 'success:', 'denied:403']);
    expect(rateRows[2].detail).toEqual({ version: 2, unchanged: true });
    expect(rateRows[3].detail).toMatchObject({ fromVersion: 1, toVersion: 2, changed: ['inputPerM', 'source'] });

    // Only roles with audit.view can read it.
    expect((await t.as('consultant', { method: 'GET', url: '/api/audit' })).statusCode).toBe(403);
    const denied = (await t.as('admin', { method: 'GET', url: '/api/audit?outcome=denied&limit=1' })).json().entries[0];
    expect(denied).toMatchObject({ outcome: 'denied', statusCode: 403, userEmail: 'consultant@demo.local' });

    await expect(t.app.db.query('UPDATE audit_log SET action = $1', ['tampered'])).rejects.toThrow(/append-only/);
    await expect(t.app.db.query('DELETE FROM audit_log')).rejects.toThrow(/append-only/);
  });

  it('re-running migrations is a no-op', async () => {
    const r = await migrate(t.app.db);
    expect(r.applied).toEqual([]);
    expect(r.skipped).toEqual(['001_init.sql']);
  });
});
