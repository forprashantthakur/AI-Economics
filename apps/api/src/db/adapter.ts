/**
 * Database adapter: one small interface, two implementations.
 *
 *  - `pg` Pool when DATABASE_URL is set (production, docker-compose).
 *  - PGlite (Postgres compiled to WASM) otherwise: in-memory for tests, or a
 *    data directory (PGLITE_DATA_DIR) for local development.
 *
 * Both return rows with the same JS types so the same SQL and mapping code
 * works everywhere:
 *   numeric     → string (exact; never parsed into a float here)
 *   int2/4/8    → number
 *   date        → 'YYYY-MM-DD' string
 *   timestamptz → Date
 *   json/jsonb  → parsed value
 * JSON parameters must be passed as strings (use `json()`), because node-pg
 * serialises JS arrays as Postgres arrays rather than JSON.
 */
import pg from 'pg';

export interface QueryResult<T> {
  rows: T[];
  rowCount: number;
}

export interface Queryable {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<QueryResult<T>>;
}

/** Handle passed to a transaction callback. */
export interface Tx extends Queryable {
  exec(sql: string): Promise<void>;
}

export interface Db extends Queryable {
  readonly kind: 'pg' | 'pglite';
  /** Execute one or more statements without parameters (migrations). */
  exec(sql: string): Promise<void>;
  /** Run `fn` in a transaction; commits on resolve, rolls back on throw. */
  tx<T>(fn: (q: Tx) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

export interface DbOptions {
  databaseUrl?: string | null;
  /** Postgres schema to use (search_path) with `pg`. Created if missing. */
  schema?: string | null;
  /** PGlite data directory; null/undefined = in-memory. */
  pgliteDataDir?: string | null;
  poolMax?: number;
}

const OID = { INT8: 20, DATE: 1082 } as const;

/** Serialise a value for a `$n::jsonb` parameter. */
export function json(value: unknown): string {
  return JSON.stringify(value ?? null);
}

export const SCHEMA_NAME_RE = /^[a-z_][a-z0-9_]{0,62}$/;

export async function createDb(opts: DbOptions = {}): Promise<Db> {
  if (opts.databaseUrl) return createPgDb(opts.databaseUrl, opts.schema ?? null, opts.poolMax ?? 10);
  return createPgliteDb(opts.pgliteDataDir ?? null);
}

// ───────────────────────────── node-postgres ─────────────────────────────

const pgTypes = {
  getTypeParser(oid: number, format?: string): (value: string) => unknown {
    if (oid === OID.DATE) return (v: string) => v;
    if (oid === OID.INT8) return (v: string) => Number(v);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (pg.types.getTypeParser as any)(oid, format);
  },
};

async function createPgDb(connectionString: string, schema: string | null, max: number): Promise<Db> {
  if (schema && !SCHEMA_NAME_RE.test(schema)) throw new Error(`Invalid DATABASE_SCHEMA "${schema}"`);
  if (schema) {
    // Create the schema before the pool pins search_path to it.
    const c = new pg.Client({ connectionString });
    await c.connect();
    try {
      await c.query(`CREATE SCHEMA IF NOT EXISTS ${schema}`);
    } finally {
      await c.end();
    }
  }
  const pool = new pg.Pool({
    connectionString,
    max,
    types: pgTypes,
    application_name: 'aies-api',
    ...(schema ? { options: `-c search_path=${schema},public` } : {}),
  });
  pool.on('error', (err) => {
    // Idle client errors (e.g. server restart) must not crash the process.
    console.error('[db] idle client error:', err.message);
  });
  // Fail fast on bad credentials / unreachable server.
  await pool.query('SELECT 1');

  const run = async <T>(client: pg.Pool | pg.PoolClient, sql: string, params?: unknown[]): Promise<QueryResult<T>> => {
    const r = await client.query(sql, params as unknown[] | undefined);
    return { rows: r.rows as T[], rowCount: r.rowCount ?? r.rows.length };
  };

  return {
    kind: 'pg',
    query: (sql, params) => run(pool, sql, params),
    async exec(sql) {
      await pool.query(sql);
    },
    async tx(fn) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const result = await fn({
          query: (sql, params) => run(client, sql, params),
          exec: async (sql) => {
            await client.query(sql);
          },
        });
        await client.query('COMMIT');
        return result;
      } catch (err) {
        try {
          await client.query('ROLLBACK');
        } catch {
          /* connection already broken */
        }
        throw err;
      } finally {
        client.release();
      }
    },
    close: () => pool.end(),
  };
}

// ───────────────────────────── PGlite ─────────────────────────────

async function createPgliteDb(dataDir: string | null): Promise<Db> {
  // Imported lazily so production (pg) never loads the WASM bundle.
  const { PGlite } = await import('@electric-sql/pglite');
  const parsers = { [OID.DATE]: (v: string) => v, [OID.INT8]: (v: string) => Number(v) };
  const db = dataDir ? await PGlite.create({ dataDir, parsers }) : await PGlite.create({ parsers });

  type PgliteLike = { query<T>(sql: string, params?: unknown[]): Promise<{ rows: T[]; affectedRows?: number }> };
  const run = async <T>(q: PgliteLike, sql: string, params?: unknown[]): Promise<QueryResult<T>> => {
    const r = await q.query<T>(sql, params ?? []);
    return { rows: r.rows, rowCount: Math.max(r.affectedRows ?? 0, r.rows.length) };
  };

  return {
    kind: 'pglite',
    query: (sql, params) => run(db, sql, params),
    async exec(sql) {
      await db.exec(sql);
    },
    // PGlite serialises queries on one connection; code inside `fn` must use
    // the handle it is given (never the outer db) or it would deadlock.
    tx: (fn) =>
      db.transaction((t) =>
        fn({
          query: (sql, params) => run(t, sql, params),
          exec: async (sql) => {
            await t.exec(sql);
          },
        }),
      ),
    close: () => db.close(),
  };
}
