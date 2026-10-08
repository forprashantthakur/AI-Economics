import type { FastifyInstance, InjectOptions, LightMyRequestResponse } from 'fastify';
import type { RoleName } from '@aies/engine';
import { buildApp } from '../src/app';

export const PASSWORD = 'Test-Password-2026!';
export const JWT_SECRET = 'test-secret-that-is-long-enough-for-hs256-0123456789';

export interface TestApp {
  app: FastifyInstance;
  tokens: Record<RoleName, string>;
  /** Inject as a role (or anonymously with role = null). */
  as(role: RoleName | null, opts: InjectOptions): Promise<LightMyRequestResponse>;
  close(): Promise<void>;
}

/**
 * A fresh app on an in-memory PGlite database, migrated and seeded, with a token per demo role.
 * Set TEST_DATABASE_URL to run the same suite against a real PostgreSQL server instead: each
 * test file then gets its own throw-away schema (dropped on close).
 */
export async function createTestApp(): Promise<TestApp> {
  const pgUrl = process.env.TEST_DATABASE_URL || null;
  const schema = pgUrl ? `aies_test_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}` : null;
  const app = await buildApp({
    logger: false,
    env: {},
    config: { jwtSecret: JWT_SECRET, seedPassword: PASSWORD, bcryptRounds: 4, databaseUrl: pgUrl, databaseSchema: schema, pgliteDataDir: null, seedOnStart: true, corsOrigin: null },
  });
  const roles: RoleName[] = ['admin', 'consultant', 'architect', 'engineering', 'finance', 'executive'];
  const tokens = {} as Record<RoleName, string>;
  for (const role of roles) {
    const r = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: `${role}@demo.local`, password: PASSWORD } });
    if (r.statusCode !== 200) throw new Error(`login failed for ${role}: ${r.body}`);
    tokens[role] = r.json().token;
  }
  return {
    app,
    tokens,
    as(role, opts) {
      const headers = { ...(opts.headers ?? {}), ...(role ? { authorization: `Bearer ${tokens[role]}` } : {}) };
      return app.inject({ ...opts, headers });
    },
    async close() {
      if (schema) await app.db.exec(`DROP SCHEMA ${schema} CASCADE`);
      await app.close();
    },
  };
}
