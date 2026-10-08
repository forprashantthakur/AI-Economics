/**
 * Seed data: the engine's default (illustrative) catalogue, the three sample
 * projects with version 1 and their actuals, and one demo user per role
 * (<role>@demo.local). Idempotent — existing rows are left untouched — and
 * runs in a single transaction.
 */
import { ROLES, ROLE_LABELS, defaultCatalog, sampleProjects, type Catalog } from '@aies/engine';
import type { Db } from './db/adapter';
import { hashPassword } from './auth';
import { writeAudit } from './audit';
import { insertRateIfMissing, createWeightSetVersion } from './repo/catalog';
import { insertProject, projectExists } from './repo/projects';
import { DEFAULT_SEED_PASSWORD } from './config';

export const DEMO_DOMAIN = 'demo.local';
const SEED_LOCK_KEY = 784_120_332;
export const demoEmail = (role: string) => `${role}@${DEMO_DOMAIN}`;

export interface SeedOptions {
  password: string;
  bcryptRounds: number;
  log?: (msg: string, level?: 'info' | 'warn') => void;
}

export interface SeedReport {
  users: number;
  modelRates: number;
  cloudPrices: number;
  fxRates: number;
  weightSets: number;
  projects: number;
}

export async function isDatabaseEmpty(db: Db): Promise<boolean> {
  const { rows } = await db.query<{ n: number }>('SELECT (SELECT count(*) FROM users) + (SELECT count(*) FROM projects) + (SELECT count(*) FROM model_rates) AS n');
  return Number(rows[0].n) === 0;
}

export async function seed(db: Db, opts: SeedOptions): Promise<SeedReport> {
  const log = opts.log ?? (() => {});
  if (opts.password === DEFAULT_SEED_PASSWORD) {
    log(`SEED_PASSWORD is not set — demo users get the default password "${DEFAULT_SEED_PASSWORD}". Change it (or set SEED_PASSWORD) before exposing this server.`, 'warn');
  }
  const catalog: Catalog = defaultCatalog();
  const projects = sampleProjects(catalog);
  // Hash outside the transaction (CPU-bound); one hash is shared by all demo users.
  const hash = await hashPassword(opts.password, opts.bcryptRounds);
  const report: SeedReport = { users: 0, modelRates: 0, cloudPrices: 0, fxRates: 0, weightSets: 0, projects: 0 };

  await db.tx(async (q) => {
    // Serialise concurrent seeders (several replicas starting on an empty database).
    await q.query('SELECT pg_advisory_xact_lock($1)', [SEED_LOCK_KEY]);
    // Users
    for (const role of ROLES) {
      const r = await q.query(
        `INSERT INTO users (email, name, role, password_hash) VALUES ($1, $2, $3, $4) ON CONFLICT (email) DO NOTHING`,
        [demoEmail(role), `Demo ${ROLE_LABELS[role]}`, role, hash],
      );
      report.users += r.rowCount;
    }
    const { rows: adminRows } = await q.query<{ id: string }>('SELECT id FROM users WHERE email = $1', [demoEmail('admin')]);
    const adminId = adminRows[0]?.id ?? null;

    // Catalogue
    for (const m of catalog.modelRates) if (await insertRateIfMissing(q, 'model_rates', m.id, m, adminId)) report.modelRates++;
    for (const c of catalog.cloudPrices) if (await insertRateIfMissing(q, 'cloud_price_items', c.id, c, adminId)) report.cloudPrices++;
    const { rows: fxRows } = await q.query<{ n: number }>('SELECT count(*)::int AS n FROM fx_rates');
    if (Number(fxRows[0].n) === 0) {
      for (const [cur, rate] of Object.entries(catalog.fx.rates)) {
        await q.query('INSERT INTO fx_rates (base, currency, rate, as_of, source, created_by) VALUES ($1, $2, $3::numeric, $4::date, $5, $6)', [
          catalog.fx.base,
          cur,
          String(rate),
          catalog.fx.asOf,
          catalog.fx.source,
          adminId,
        ]);
        report.fxRates++;
      }
    }
    for (const ws of catalog.acuWeightSets) {
      const { rows } = await q.query('SELECT 1 FROM acu_weight_sets WHERE id = $1 AND version = $2', [ws.id, ws.version]);
      if (rows.length) continue;
      // Respect the one-approved-version-per-id rule if an approved version already exists.
      const { rows: approved } = await q.query('SELECT 1 FROM acu_weight_sets WHERE id = $1 AND status = $2', [ws.id, 'approved']);
      await createWeightSetVersion(q, ws, adminId, ws.status === 'approved' && approved.length ? 'retired' : ws.status);
      report.weightSets++;
    }

    // Sample projects
    for (const p of projects) {
      if ((await projectExists(q, p.id)).exists) continue;
      await insertProject(q, p, adminId, 'Seeded illustrative sample project');
      report.projects++;
    }

    await writeAudit(q, null, {
      action: 'system.seed',
      actor: { id: null, email: 'system', role: null },
      entityType: 'system',
      detail: { ...report },
    });
  });

  log(
    `seeded ${report.users} users, ${report.modelRates} model rates, ${report.cloudPrices} cloud prices, ${report.fxRates} FX rates, ${report.weightSets} ACU weight sets, ${report.projects} projects`,
  );
  return report;
}
