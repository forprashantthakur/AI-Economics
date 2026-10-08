/**
 * Minimal migration runner: applies db/migrations/*.sql in lexical order,
 * each in its own transaction, and records it in schema_migrations with a
 * SHA-256 checksum. An advisory lock serialises concurrent runners (several
 * API replicas starting at once). Already-applied files whose content has
 * changed are rejected — write a new migration instead of editing an old one.
 */
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Db } from './adapter';

const LOCK_KEY = 784_120_331; // arbitrary, stable advisory-lock id for migrations
const FILE_RE = /^(\d{3,})_[a-z0-9_]+\.sql$/;

export interface Migration {
  version: string;
  name: string;
  sql: string;
  checksum: string;
}

export interface MigrationReport {
  applied: string[];
  skipped: string[];
}

/** Locate db/migrations: MIGRATIONS_DIR, else walk up from this module (works for src/ and the dist/ bundle). */
export function resolveMigrationsDir(explicit?: string | null): string {
  if (explicit) {
    if (!existsSync(explicit)) throw new Error(`MIGRATIONS_DIR "${explicit}" does not exist`);
    return path.resolve(explicit);
  }
  let dir = path.dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 8; i++) {
    const candidate = path.join(dir, 'db', 'migrations');
    if (existsSync(candidate) && statSync(candidate).isDirectory()) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error('Could not locate db/migrations — set MIGRATIONS_DIR');
}

export function loadMigrations(dir: string): Migration[] {
  const files = readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort();
  return files.map((file) => {
    const m = FILE_RE.exec(file);
    if (!m) throw new Error(`Migration file "${file}" must be named NNN_snake_case.sql`);
    const sql = readFileSync(path.join(dir, file), 'utf8');
    return { version: m[1], name: file, sql, checksum: createHash('sha256').update(sql).digest('hex') };
  });
}

export async function migrate(db: Db, opts: { dir?: string | null; log?: (msg: string) => void } = {}): Promise<MigrationReport> {
  const log = opts.log ?? (() => {});
  const migrations = loadMigrations(resolveMigrationsDir(opts.dir));
  const seen = new Set<string>();
  for (const m of migrations) {
    if (seen.has(m.version)) throw new Error(`Duplicate migration version ${m.version}`);
    seen.add(m.version);
  }
  const report: MigrationReport = { applied: [], skipped: [] };
  for (const m of migrations) {
    await db.tx(async (q) => {
      await q.query('SELECT pg_advisory_xact_lock($1)', [LOCK_KEY]);
      await q.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
        version    text        PRIMARY KEY,
        name       text        NOT NULL,
        checksum   text        NOT NULL,
        applied_at timestamptz NOT NULL DEFAULT now()
      )`);
      const { rows } = await q.query<{ checksum: string }>('SELECT checksum FROM schema_migrations WHERE version = $1', [m.version]);
      if (rows.length) {
        if (rows[0].checksum !== m.checksum) {
          throw new Error(`Migration ${m.name} was modified after it was applied (checksum mismatch). Add a new migration instead.`);
        }
        report.skipped.push(m.name);
        return;
      }
      await q.exec(m.sql);
      await q.query('INSERT INTO schema_migrations (version, name, checksum) VALUES ($1, $2, $3)', [m.version, m.name, m.checksum]);
      report.applied.push(m.name);
      log(`applied migration ${m.name}`);
    });
  }
  return report;
}
