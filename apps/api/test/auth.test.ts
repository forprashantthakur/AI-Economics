import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SignJWT } from 'jose';
import { loadConfig } from '../src/config';
import { createTestApp, PASSWORD, type TestApp } from './helpers';

let t: TestApp;
beforeAll(async () => {
  t = await createTestApp();
});
afterAll(async () => {
  await t?.close();
});

describe('authentication', () => {
  it('serves /api/health without a token', async () => {
    const r = await t.app.inject({ method: 'GET', url: '/api/health' });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ status: 'ok', db: process.env.TEST_DATABASE_URL ? 'pg' : 'pglite' });
  });

  it('logs in a seeded demo user and returns a token, user and permissions', async () => {
    const r = await t.app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'Finance@Demo.Local', password: PASSWORD } });
    expect(r.statusCode).toBe(200);
    const body = r.json();
    expect(body.token).toMatch(/^[\w-]+\.[\w-]+\.[\w-]+$/);
    expect(body.tokenType).toBe('Bearer');
    expect(body.user).toMatchObject({ email: 'finance@demo.local', role: 'finance' });
    expect(body.user.permissions).toContain('benefit.validate');
    expect(body.user).not.toHaveProperty('password_hash');

    const me = await t.app.inject({ method: 'GET', url: '/api/me', headers: { authorization: `Bearer ${body.token}` } });
    expect(me.statusCode).toBe(200);
    expect(me.json()).toMatchObject({ email: 'finance@demo.local', role: 'finance' });
  });

  it('rejects a wrong password and an unknown email with the same 401 and audits both', async () => {
    const bad = await t.app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'admin@demo.local', password: 'nope-nope' } });
    expect(bad.statusCode).toBe(401);
    expect(bad.json()).toEqual({ error: { code: 'INVALID_CREDENTIALS', message: 'Email or password is incorrect.' } });
    const unknown = await t.app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'ghost@demo.local', password: 'whatever1' } });
    expect(unknown.statusCode).toBe(401);
    expect(unknown.json().error.message).toBe(bad.json().error.message);

    const { rows } = await t.app.db.query<{ user_email: string; outcome: string; detail: { reason: string } }>(
      "SELECT user_email, outcome, detail FROM audit_log WHERE action = 'auth.login' AND outcome = 'failure' ORDER BY id",
    );
    expect(rows.map((r) => [r.user_email, r.detail.reason])).toEqual([
      ['admin@demo.local', 'bad_password'],
      ['ghost@demo.local', 'unknown_email'],
    ]);
  });

  it('rejects malformed login bodies with a VALIDATION_ERROR', async () => {
    const r = await t.app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'admin@demo.local' } });
    expect(r.statusCode).toBe(400);
    expect(r.json().error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 401 without a token, with a garbage token and with a token signed by another secret', async () => {
    const none = await t.app.inject({ method: 'GET', url: '/api/projects' });
    expect(none.statusCode).toBe(401);
    expect(none.json().error.code).toBe('UNAUTHENTICATED');

    const garbage = await t.app.inject({ method: 'GET', url: '/api/projects', headers: { authorization: 'Bearer a.b.c' } });
    expect(garbage.statusCode).toBe(401);
    expect(garbage.json().error.code).toBe('INVALID_TOKEN');

    const forged = await new SignJWT({ role: 'admin' })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject('00000000-0000-0000-0000-000000000000')
      .setIssuer('aies-api')
      .setAudience('aies')
      .setExpirationTime('1h')
      .sign(new TextEncoder().encode('some-other-secret-some-other-secret'));
    const f = await t.app.inject({ method: 'GET', url: '/api/me', headers: { authorization: `Bearer ${forged}` } });
    expect(f.statusCode).toBe(401);

    // Denied attempts are audited even on read routes.
    const { rows } = await t.app.db.query<{ n: number }>("SELECT count(*)::int AS n FROM audit_log WHERE outcome = 'denied' AND status_code = 401");
    expect(rows[0].n).toBeGreaterThanOrEqual(3);
  });

  it('revokes access immediately when an admin deactivates a user', async () => {
    const users = await t.as('admin', { method: 'GET', url: '/api/users' });
    const architect = users.json().users.find((u: { email: string }) => u.email === 'architect@demo.local');
    const before = await t.as('architect', { method: 'GET', url: '/api/me' });
    expect(before.statusCode).toBe(200);

    const off = await t.as('admin', { method: 'PUT', url: `/api/users/${architect.id}`, payload: { active: false } });
    expect(off.statusCode).toBe(200);
    expect(off.json().active).toBe(false);
    const after = await t.as('architect', { method: 'GET', url: '/api/me' });
    expect(after.statusCode).toBe(401);
    const login = await t.app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'architect@demo.local', password: PASSWORD } });
    expect(login.statusCode).toBe(401);

    await t.as('admin', { method: 'PUT', url: `/api/users/${architect.id}`, payload: { active: true } });
    expect((await t.as('architect', { method: 'GET', url: '/api/me' })).statusCode).toBe(200);
  });

  it('refuses to start in production without a strong JWT_SECRET', () => {
    expect(() => loadConfig({ NODE_ENV: 'production' })).toThrow(/JWT_SECRET/);
    expect(() => loadConfig({ NODE_ENV: 'production', JWT_SECRET: 'short' })).toThrow(/32 characters/);
    expect(loadConfig({ NODE_ENV: 'production', JWT_SECRET: 'x'.repeat(40) }).jwtSecret).toHaveLength(40);
    expect(loadConfig({}).warnings.some((w) => w.includes('JWT_SECRET'))).toBe(true);
  });
});

describe('role-based access control', () => {
  it('lets every authenticated role read but keeps executive read-only', async () => {
    for (const role of ['admin', 'consultant', 'architect', 'engineering', 'finance', 'executive'] as const) {
      const r = await t.as(role, { method: 'GET', url: '/api/projects/sample-ap' });
      expect(r.statusCode, role).toBe(200);
    }
    const p = (await t.as('executive', { method: 'GET', url: '/api/projects/sample-ap' })).json();
    const put = await t.as('executive', { method: 'PUT', url: '/api/projects/sample-ap', payload: { project: { ...p.project, name: 'Hacked' }, baseVersion: p.meta.version } });
    expect(put.statusCode).toBe(403);
    expect(put.json().error.code).toBe('FORBIDDEN');
    const create = await t.as('executive', { method: 'POST', url: '/api/projects', payload: { ...p.project, id: 'exec-copy' } });
    expect(create.statusCode).toBe(403);
    expect((await t.as('consultant', { method: 'GET', url: '/api/projects/sample-ap' })).json().project.name).toBe('Accounts Payable Agent');
  });

  it('forbids a consultant from validating a benefit and a non-finance role from approving a rate card', async () => {
    const v = await t.as('consultant', { method: 'POST', url: '/api/projects/sample-ap/benefits/ap-b6/validate', payload: { status: 'finance_validated' } });
    expect(v.statusCode).toBe(403);
    expect(v.json().error.message).toContain('benefit.validate');

    const draft = await t.as('consultant', { method: 'POST', url: '/api/projects/sample-rfp/rate-cards', payload: { note: 'Initial' } });
    expect(draft.statusCode).toBe(201);
    for (const role of ['consultant', 'architect', 'engineering', 'executive'] as const) {
      const a = await t.as(role, { method: 'POST', url: `/api/projects/sample-rfp/rate-cards/${draft.json().version}/approve` });
      expect(a.statusCode, role).toBe(403);
    }
    const ok = await t.as('finance', { method: 'POST', url: `/api/projects/sample-rfp/rate-cards/${draft.json().version}/approve` });
    expect(ok.statusCode).toBe(200);
  });

  it('enforces section permissions on a full-document PUT (no privilege escalation through the project JSON)', async () => {
    const get = async () => (await t.as('admin', { method: 'GET', url: '/api/projects/sample-cs' })).json();
    let cur = await get();

    // Engineering may edit tokenomics…
    const wf = structuredClone(cur.project);
    wf.workflows[0].monthlyVolume = 90000;
    const ok = await t.as('engineering', { method: 'PUT', url: '/api/projects/sample-cs', payload: { project: wf, baseVersion: cur.meta.version } });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().changed).toEqual(['workflows']);

    // …but not pricing.
    cur = await get();
    const pricing = structuredClone(cur.project);
    pricing.pricing.streams[1].targetMarginPct = 60;
    const denied = await t.as('engineering', { method: 'PUT', url: '/api/projects/sample-cs', payload: { project: pricing, baseVersion: cur.meta.version } });
    expect(denied.statusCode).toBe(403);
    expect(denied.json().error.details.required).toEqual(['pricing.edit']);

    // A consultant (value.edit) cannot self-validate a benefit by editing its status in the JSON.
    const value = structuredClone(cur.project);
    value.value.benefits.find((b: { id: string }) => b.id === 'cs-b4').status = 'finance_validated';
    const sneaky = await t.as('consultant', { method: 'PUT', url: '/api/projects/sample-cs', payload: { project: value, baseVersion: cur.meta.version } });
    expect(sneaky.statusCode).toBe(403);
    expect(sneaky.json().error.details.required).toEqual(['benefit.validate']);

    // The denied attempts were audited with the route's action name.
    const { rows } = await t.app.db.query<{ n: number }>("SELECT count(*)::int AS n FROM audit_log WHERE action = 'project.update' AND outcome = 'denied' AND project_id = 'sample-cs'");
    expect(rows[0].n).toBe(2);
  });
});
