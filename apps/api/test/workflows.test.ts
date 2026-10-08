import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from './helpers';

let t: TestApp;
beforeAll(async () => {
  t = await createTestApp();
});
afterAll(async () => {
  await t?.close();
});

describe('scenarios', () => {
  it('runs an ad-hoc scenario with metrics and a reconciling cost waterfall', async () => {
    const r = await t.as('executive', { method: 'POST', url: '/api/projects/sample-ap/scenarios/run', payload: { preset: 'stress', overrides: { infraMultiplier: 1.5 } } });
    expect(r.statusCode).toBe(200);
    const body = r.json();
    expect(body.overrides.infraMultiplier).toBe(1.5); // explicit override wins over the preset
    expect(Number(body.metrics.monthlyRunCost)).toBeGreaterThan(Number(body.baseline.monthlyRunCost));
    const wf = body.costWaterfall as { label: string; value: number; kind: string }[];
    expect(wf[0].kind).toBe('start');
    expect(wf[wf.length - 1].kind).toBe('end');
    const sum = wf.filter((s) => s.kind !== 'end').reduce((a, s) => a + s.value, 0);
    expect(sum).toBeCloseTo(wf[wf.length - 1].value, 4);
    expect(body.reconciliationPassed).toBe(true);

    const bad = await t.as('executive', { method: 'POST', url: '/api/projects/sample-ap/scenarios/run', payload: { overrides: { modelSwap: { fromModelId: 'anthropic-sonnet-class', toModelId: 'nope' } } } });
    expect(bad.statusCode).toBe(400);
    const unknownKey = await t.as('executive', { method: 'POST', url: '/api/projects/sample-ap/scenarios/run', payload: { overrides: { volumeMultipler: 2 } } });
    expect(unknownKey.statusCode).toBe(400);
  });

  it('saves a new version per scenario name with computed metrics, and executive cannot save', async () => {
    const save = (overrides: Record<string, unknown>) => t.as('engineering', { method: 'POST', url: '/api/projects/sample-cs/scenarios', payload: { name: 'Cheaper routing', overrides } });
    const s1 = await save({ cacheHitDeltaPp: 10 });
    expect(s1.statusCode).toBe(201);
    expect(s1.json()).toMatchObject({ name: 'Cheaper routing', version: 1, computedOnVersion: 1, projectVersion: 2 });
    expect(typeof s1.json().metrics.monthlyRunCost).toBe('string');
    const s2 = await save({ cacheHitDeltaPp: 20 });
    expect(s2.json().version).toBe(2);
    expect(Number(s2.json().metrics.monthlyRunCost)).toBeLessThan(Number(s1.json().metrics.monthlyRunCost));
    const other = await t.as('finance', { method: 'POST', url: '/api/projects/sample-cs/scenarios', payload: { name: 'Optimised', preset: 'optimized' } });
    expect(other.json().version).toBe(1);

    const latest = await t.as('executive', { method: 'GET', url: '/api/projects/sample-cs/scenarios' });
    expect(latest.json().scenarios.map((s: { name: string; version: number }) => `${s.name}@${s.version}`).sort()).toEqual(['Cheaper routing@2', 'Optimised@1']);
    expect(latest.json().presets.map((p: { id: string }) => p.id)).toEqual(['baseline', 'optimized', 'stress']);
    const all = await t.as('executive', { method: 'GET', url: '/api/projects/sample-cs/scenarios?name=Cheaper%20routing' });
    expect(all.json().scenarios.map((s: { version: number }) => s.version)).toEqual([2, 1]);

    const exec = await t.as('executive', { method: 'POST', url: '/api/projects/sample-cs/scenarios', payload: { name: 'Nope', overrides: {} } });
    expect(exec.statusCode).toBe(403);

    // Mirrored into project.scenarios (what the web app reads), each save a new project version.
    const p = (await t.as('executive', { method: 'GET', url: '/api/projects/sample-cs' })).json();
    expect(p.meta.version).toBe(4);
    expect(p.project.scenarios.map((s: { name: string; version: number }) => `${s.name}@${s.version}`)).toEqual(['Cheaper routing@1', 'Cheaper routing@2', 'Optimised@1']);
    expect(p.project.scenarios[0].id).toBe(s1.json().id);
  });
});

describe('actuals and variance', () => {
  it('upserts actuals, mirrors them into the project JSON with a new version and feeds variance', async () => {
    const before = (await t.as('engineering', { method: 'GET', url: '/api/projects/sample-ap/actuals' })).json();
    expect(before.actuals).toHaveLength(6); // seeded from the sample
    const project = (await t.as('engineering', { method: 'GET', url: '/api/projects/sample-ap' })).json();
    const wfId = project.project.workflows[0].id;
    const v0 = project.meta.version;

    const put = await t.as('engineering', {
      method: 'PUT',
      url: '/api/projects/sample-ap/actuals',
      payload: {
        baseVersion: v0,
        actuals: [
          // update an existing month (2026-04 is month 1 for a 2026-04 go-live)
          { period: '2026-04', workflowId: wfId, attempted: 24000, accepted: 22000, inputTokens: 400000000, outputTokens: 60000000, llmCost: '180000.55', nonLlmCost: 900000, realizedBenefit: 1500000 },
          // add a new month
          { period: '2026-10', workflowId: wfId, attempted: 52000, accepted: 48000, inputTokens: 900000000, outputTokens: 120000000, llmCost: 350000, nonLlmCost: '1200000.10', realizedBenefit: 4000000 },
        ],
      },
    });
    expect(put.statusCode).toBe(200);
    const body = put.json();
    expect(body).toMatchObject({ version: v0 + 1, upserted: 2, total: 7, periods: ['2026-04', '2026-10'] });

    const table = (await t.as('executive', { method: 'GET', url: '/api/projects/sample-ap/actuals' })).json().actuals;
    expect(table).toHaveLength(7);
    const apr = table.find((a: { period: string }) => a.period === '2026-04');
    expect(apr).toMatchObject({ attempted: '24000', llmCost: '180000.55', monthIndex: 1 }); // numeric → exact strings
    expect(table.find((a: { period: string }) => a.period === '2026-10').monthIndex).toBe(7);

    const p2 = (await t.as('executive', { method: 'GET', url: '/api/projects/sample-ap' })).json();
    expect(p2.meta.version).toBe(v0 + 1);
    expect(p2.project.actuals).toHaveLength(7);
    expect(p2.project.actuals.find((a: { period: string }) => a.period === '2026-04').llmCost).toBe(180000.55);

    const variance = await t.as('executive', { method: 'GET', url: '/api/projects/sample-ap/variance' });
    expect(variance.statusCode).toBe(200);
    const vr = variance.json();
    expect(vr.rows).toHaveLength(7);
    expect(vr.byPeriod.map((r: { period: string }) => r.period)).toContain('2026-10');
    expect(vr.rows.find((r: { period: string }) => r.period === '2026-04').actLlmCost).toBe('180000.55');
    expect(Number(vr.totals.actTotalCost)).toBeGreaterThan(0);

    // Unknown workflows, bad periods and accepted > attempted are rejected; executive cannot write.
    const bad = await t.as('engineering', {
      method: 'PUT',
      url: '/api/projects/sample-ap/actuals',
      payload: { actuals: [{ period: '2026-05', workflowId: 'nope', attempted: 1, accepted: 2, inputTokens: 0, outputTokens: 0, llmCost: 0, nonLlmCost: 0 }] },
    });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().error.details.problems).toHaveLength(2);
    const stale = await t.as('engineering', { method: 'PUT', url: '/api/projects/sample-ap/actuals', payload: { baseVersion: v0, actuals: [] } });
    expect(stale.statusCode).toBe(409);
    expect((await t.as('executive', { method: 'PUT', url: '/api/projects/sample-ap/actuals', payload: { actuals: [] } })).statusCode).toBe(403);
  });
});

describe('benefit validation', () => {
  it('lets finance validate a benefit, updating the JSON, history, version and validated ROI', async () => {
    const before = (await t.as('finance', { method: 'POST', url: '/api/projects/sample-rfp/compute' })).json();
    const p0 = (await t.as('finance', { method: 'GET', url: '/api/projects/sample-rfp' })).json();
    expect(p0.project.value.benefits.find((b: { id: string }) => b.id === 'rfp-b4').status).toBe('proposed');

    const r = await t.as('finance', { method: 'POST', url: '/api/projects/sample-rfp/benefits/rfp-b4/validate', payload: { status: 'finance_validated', comment: 'Controlled win-rate study agreed' } });
    expect(r.statusCode).toBe(200);
    const body = r.json();
    expect(body).toMatchObject({ previousStatus: 'proposed', version: p0.meta.version + 1, benefit: { id: 'rfp-b4', status: 'finance_validated', validatedBy: expect.stringContaining('finance@demo.local') } });
    expect(body.benefit.validatedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    // Validated benefits (and therefore client ROI) go up.
    expect(Number(body.economics.validatedBenefits)).toBeGreaterThan(Number(before.economics.client.validatedBenefits));
    expect(Number(body.economics.roiPct)).toBeGreaterThan(Number(before.economics.client.roiPct));

    const after = (await t.as('finance', { method: 'POST', url: '/api/projects/sample-rfp/compute' })).json();
    expect(after.version).toBe(p0.meta.version + 1);
    expect(after.economics.client.roiPct).toBe(body.economics.roiPct);

    const hist = (await t.as('executive', { method: 'GET', url: '/api/projects/sample-rfp/benefit-validations' })).json();
    expect(hist.validations[0]).toMatchObject({ benefitId: 'rfp-b4', status: 'finance_validated', previousStatus: 'proposed', validatedBy: 'finance@demo.local' });

    const missing = await t.as('finance', { method: 'POST', url: '/api/projects/sample-rfp/benefits/nope/validate', payload: { status: 'rejected' } });
    expect(missing.statusCode).toBe(404);
    const badStatus = await t.as('finance', { method: 'POST', url: '/api/projects/sample-rfp/benefits/rfp-b3/validate', payload: { status: 'proposed' } });
    expect(badStatus.statusCode).toBe(400);
  });
});

describe('rate cards', () => {
  it('snapshots derived prices as drafts and supersedes the previous approval on approve', async () => {
    const d1 = await t.as('consultant', { method: 'POST', url: '/api/projects/sample-ap/rate-cards', payload: { note: 'Q3 proposal' } });
    expect(d1.statusCode).toBe(201);
    expect(d1.json()).toMatchObject({ version: 1, status: 'draft' });
    const abuPrices = d1.json().rateCard.abuPrices;
    expect(Object.keys(abuPrices)).toEqual(['sample-ap-wf1']);
    expect(Number(abuPrices['sample-ap-wf1'])).toBeGreaterThan(0);

    const a1 = await t.as('finance', { method: 'POST', url: '/api/projects/sample-ap/rate-cards/1/approve' });
    expect(a1.statusCode).toBe(200);
    expect(a1.json()).toMatchObject({ status: 'approved', superseded: [], stale: false });
    const again = await t.as('finance', { method: 'POST', url: '/api/projects/sample-ap/rate-cards/1/approve' });
    expect(again.statusCode).toBe(409);

    await t.as('consultant', { method: 'POST', url: '/api/projects/sample-ap/rate-cards', payload: { note: 'Revised' } });
    const a2 = await t.as('admin', { method: 'POST', url: '/api/projects/sample-ap/rate-cards/2/approve' });
    expect(a2.json().superseded).toEqual([1]);

    const list = (await t.as('executive', { method: 'GET', url: '/api/projects/sample-ap/rate-cards' })).json();
    expect(list.currentApproved).toBe(2);
    expect(list.rateCards.map((r: { version: number; status: string }) => `${r.version}:${r.status}`)).toEqual(['2:approved', '1:superseded']);
    expect(list.rateCards[0].approvedBy).toBe('admin@demo.local');

    const p = (await t.as('executive', { method: 'GET', url: '/api/projects/sample-ap' })).json().project;
    expect(p.pricing.rateCardVersions.map((r: { version: string; status: string }) => `${r.version}:${r.status}`)).toEqual(['1:superseded', '2:approved']);
  });
});
