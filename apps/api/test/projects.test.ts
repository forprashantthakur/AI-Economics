import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { computeProject, defaultCatalog, sampleProjects } from '@aies/engine';
import { createTestApp, type TestApp } from './helpers';

let t: TestApp;
beforeAll(async () => {
  t = await createTestApp();
});
afterAll(async () => {
  await t?.close();
});

const newProject = (id: string) => {
  const p = structuredClone(sampleProjects(defaultCatalog())[2]);
  // A brand-new project: benefits start as proposed (validation is a separate, Finance-only step).
  const benefits = p.value.benefits.map(({ validatedBy: _b, validatedOn: _o, ...b }) => ({ ...b, status: 'proposed' as const }));
  return { ...p, id, name: 'API test project', actuals: [], scenarios: [], value: { ...p.value, benefits } };
};

describe('projects CRUD and versioning', () => {
  it('lists the seeded samples without the heavy project JSON', async () => {
    const r = await t.as('executive', { method: 'GET', url: '/api/projects' });
    expect(r.statusCode).toBe(200);
    const list = r.json().projects;
    expect(list.map((p: { id: string }) => p.id).sort()).toEqual(['sample-ap', 'sample-cs', 'sample-rfp']);
    expect(list[0]).not.toHaveProperty('data');
    expect(list[0]).not.toHaveProperty('project');
    expect(list.find((p: { id: string }) => p.id === 'sample-cs')).toMatchObject({ version: 1, currency: 'INR', workflowCount: 2, clientName: 'Indus Retail Bank (illustrative)' });
  });

  it('creates, reads, updates (new version), lists versions, detects conflicts and soft-deletes', async () => {
    const create = await t.as('consultant', { method: 'POST', url: '/api/projects', payload: newProject('crud-1') });
    expect(create.statusCode).toBe(201);
    expect(create.headers.location).toBe('/api/projects/crud-1');
    expect(create.json().meta.version).toBe(1);
    expect(Array.isArray(create.json().issues)).toBe(true);

    const dup = await t.as('consultant', { method: 'POST', url: '/api/projects', payload: newProject('crud-1') });
    expect(dup.statusCode).toBe(409);
    expect(dup.json().error.code).toBe('PROJECT_EXISTS');

    const got = await t.as('architect', { method: 'GET', url: '/api/projects/crud-1' });
    expect(got.statusCode).toBe(200);
    const v1 = got.json();
    expect(v1.project.name).toBe('API test project');

    const edited = { ...v1.project, name: 'API test project (renamed)' };
    const put = await t.as('consultant', { method: 'PUT', url: '/api/projects/crud-1', payload: { project: edited, baseVersion: 1, comment: 'Rename' } });
    expect(put.statusCode).toBe(200);
    expect(put.json().meta.version).toBe(2);
    expect(put.json().changed).toEqual(['name']);

    // Stale baseVersion → 409 with both versions in the details.
    const stale = await t.as('architect', { method: 'PUT', url: '/api/projects/crud-1', payload: { project: { ...v1.project, status: 'in_delivery' }, baseVersion: 1 } });
    expect(stale.statusCode).toBe(409);
    expect(stale.json().error).toMatchObject({ code: 'VERSION_CONFLICT', details: { baseVersion: 1, currentVersion: 2 } });

    // A no-op save does not create a version.
    const noop = await t.as('consultant', { method: 'PUT', url: '/api/projects/crud-1', payload: { project: put.json().project, baseVersion: 2 } });
    expect(noop.statusCode).toBe(200);
    expect(noop.json()).toMatchObject({ unchanged: true, meta: { version: 2 } });

    const versions = await t.as('executive', { method: 'GET', url: '/api/projects/crud-1/versions' });
    expect(versions.json().versions.map((v: { version: number; comment: string | null }) => [v.version, v.comment])).toEqual([
      [2, 'Rename'],
      [1, 'Created'],
    ]);
    const old = await t.as('executive', { method: 'GET', url: '/api/projects/crud-1/versions/1' });
    expect(old.json()).toMatchObject({ version: 1, current: false, project: { name: 'API test project' } });
    expect((await t.as('executive', { method: 'GET', url: '/api/projects/crud-1/versions/9' })).statusCode).toBe(404);

    // id in body must match the URL
    const mismatch = await t.as('consultant', { method: 'PUT', url: '/api/projects/crud-1', payload: { project: { ...edited, id: 'other' }, baseVersion: 2 } });
    expect(mismatch.statusCode).toBe(400);

    // Only admin holds project.delete
    expect((await t.as('consultant', { method: 'DELETE', url: '/api/projects/crud-1' })).statusCode).toBe(403);
    const del = await t.as('admin', { method: 'DELETE', url: '/api/projects/crud-1' });
    expect(del.statusCode).toBe(200);
    expect((await t.as('admin', { method: 'GET', url: '/api/projects/crud-1' })).statusCode).toBe(404);
    const list = (await t.as('admin', { method: 'GET', url: '/api/projects' })).json().projects;
    expect(list.some((p: { id: string }) => p.id === 'crud-1')).toBe(false);
    const { rows } = await t.app.db.query<{ deleted_at: Date | null }>('SELECT deleted_at FROM projects WHERE id = $1', ['crud-1']);
    expect(rows[0].deleted_at).toBeInstanceOf(Date);
  });

  it('validates request bodies with zod and returns engine issues on save', async () => {
    const broken = { ...newProject('bad-1'), currency: 'rupees', workflows: 'none' };
    const r = await t.as('consultant', { method: 'POST', url: '/api/projects', payload: broken });
    expect(r.statusCode).toBe(400);
    expect(r.json().error.code).toBe('VALIDATION_ERROR');
    const paths = r.json().error.details.issues.map((i: { path: string }) => i.path);
    expect(paths).toEqual(expect.arrayContaining(['currency', 'workflows']));

    // Structurally valid but semantically wrong: the engine reports it, the save succeeds…
    const p = newProject('issues-1');
    p.workflows[0].llmSteps[0].routing = [{ modelId: 'no-such-model', sharePct: 100 }];
    const saved = await t.as('consultant', { method: 'POST', url: '/api/projects', payload: p });
    expect(saved.statusCode).toBe(201);
    expect(saved.json().issues.some((i: { code: string }) => i.code === 'UNKNOWN_MODEL')).toBe(true);
    // …unless strict mode is requested.
    const strict = await t.as('consultant', { method: 'POST', url: '/api/projects?strict=true', payload: { ...p, id: 'issues-2' } });
    expect(strict.statusCode).toBe(422);
    expect(strict.json().error.code).toBe('VALIDATION_ISSUES');

    const v = await t.as('executive', { method: 'POST', url: '/api/projects/issues-1/validate' });
    expect(v.statusCode).toBe(200);
    expect(v.json().valid).toBe(false);
    expect(v.json().counts.errors).toBeGreaterThan(0);
  });

  it('returns 400 for invalid JSON and 404 for unknown routes and projects', async () => {
    const bad = await t.as('consultant', { method: 'POST', url: '/api/projects', headers: { 'content-type': 'application/json' }, payload: '{"id":' });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().error.code).toBe('INVALID_JSON');
    expect((await t.as('admin', { method: 'GET', url: '/api/nope' })).json().error.code).toBe('NOT_FOUND');
    expect((await t.as('admin', { method: 'GET', url: '/api/projects/does-not-exist' })).statusCode).toBe(404);
  });
});

describe('compute', () => {
  it('returns all-pass reconciliation for the three samples and a TCV identical to the engine', async () => {
    const catalog = defaultCatalog();
    const engine = Object.fromEntries(sampleProjects(catalog).map((p) => [p.id, computeProject(p, catalog)]));
    for (const id of ['sample-ap', 'sample-cs', 'sample-rfp']) {
      const r = await t.as('executive', { method: 'POST', url: `/api/projects/${id}/compute` });
      expect(r.statusCode, id).toBe(200);
      const s = r.json();
      expect(s.reconciliationPassed, id).toBe(true);
      expect(s.reconciliation.length).toBeGreaterThan(15);
      expect(s.reconciliation.every((c: { pass: boolean }) => c.pass)).toBe(true);
      // Decimals arrive as exact strings.
      expect(typeof s.economics.provider.tcv).toBe('string');
      expect(s.economics.provider.tcv).toBe(engine[id].economics.provider.tcv.toString());
      expect(s.baseline.totalRunCost).toBe(engine[id].baseline.totalRunCost.toString());
      expect(s.packages).toHaveLength(7);
      expect(s.packages[0]).toHaveProperty('economics.provider.tcv');
      expect(s.packages[0]).not.toHaveProperty('priceBook');
      expect(s.priceBook.streams.length).toBeGreaterThan(0);
      expect(s.years.length).toBe(3);
      expect(s).not.toHaveProperty('context');
      expect(r.body.length).toBeLessThan(250_000); // summary, not the ~1 MB ProjectResult
    }
  });

  it('computes an ad-hoc project posted in the body without persisting it', async () => {
    const p = newProject('adhoc-1');
    const r = await t.as('executive', { method: 'POST', url: '/api/compute', payload: p });
    expect(r.statusCode).toBe(200);
    expect(r.json().reconciliationPassed).toBe(true);
    expect(r.json().projectId).toBe('adhoc-1');
    expect((await t.as('admin', { method: 'GET', url: '/api/projects/adhoc-1' })).statusCode).toBe(404);
    const { rows } = await t.app.db.query<{ n: number }>("SELECT count(*)::int AS n FROM audit_log WHERE detail ->> 'path' = '/api/compute'");
    expect(rows[0].n).toBe(0); // read-only POSTs are not audited
  });
});
