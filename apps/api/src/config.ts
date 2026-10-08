/**
 * Runtime configuration from environment variables (see README.md).
 */
export const DEV_JWT_SECRET = 'aies-dev-only-insecure-jwt-secret-change-me-please';
export const DEFAULT_SEED_PASSWORD = 'ChangeMe!2026';

export interface Config {
  nodeEnv: string;
  production: boolean;
  host: string;
  port: number;
  databaseUrl: string | null;
  databaseSchema: string | null;
  pgliteDataDir: string | null;
  migrationsDir: string | null;
  jwtSecret: string;
  jwtTtl: string;
  corsOrigin: string | null;
  seedOnStart: boolean;
  seedPassword: string;
  bcryptRounds: number;
  trustProxy: boolean | number | string;
  logLevel: string;
  bodyLimit: number;
  warnings: string[];
}

const nonEmpty = (v: string | undefined): string | null => (v && v.trim() ? v.trim() : null);

function bool(v: string | undefined, dflt: boolean): boolean {
  if (v === undefined || v.trim() === '') return dflt;
  return ['1', 'true', 'yes', 'on'].includes(v.trim().toLowerCase());
}

function int(v: string | undefined, dflt: number, name: string, min: number, max: number): number {
  if (v === undefined || v.trim() === '') return dflt;
  const n = Number(v);
  if (!Number.isInteger(n) || n < min || n > max) throw new Error(`${name} must be an integer between ${min} and ${max}`);
  return n;
}

function trustProxy(v: string | undefined): boolean | number | string {
  const s = nonEmpty(v);
  if (!s || s === 'false') return false;
  if (s === 'true') return true;
  if (/^\d+$/.test(s)) return Number(s);
  return s; // comma-separated IPs / CIDRs
}

/**
 * `--pglite-dir=<dir>` on the command line (used by the npm dev/seed scripts) sets the PGlite data
 * directory when neither DATABASE_URL nor PGLITE_DATA_DIR is set.
 */
export function applyCliDefaults(cfg: Config, argv: string[] = process.argv.slice(2)): Config {
  const arg = argv.find((a) => a.startsWith('--pglite-dir='));
  const dir = arg ? arg.slice('--pglite-dir='.length).trim() : '';
  if (dir && !cfg.databaseUrl && !cfg.pgliteDataDir) return { ...cfg, pgliteDataDir: dir };
  return cfg;
}

/** Throws on invalid or unsafe production configuration. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const nodeEnv = nonEmpty(env.NODE_ENV) ?? 'development';
  const production = nodeEnv === 'production';
  const warnings: string[] = [];

  let jwtSecret = nonEmpty(env.JWT_SECRET);
  if (!jwtSecret) {
    if (production) throw new Error('JWT_SECRET must be set when NODE_ENV=production (use at least 32 random characters).');
    warnings.push('JWT_SECRET is not set — using an insecure development secret. Never run like this in production.');
    jwtSecret = DEV_JWT_SECRET;
  } else if (production && (jwtSecret === DEV_JWT_SECRET || jwtSecret.length < 32)) {
    throw new Error('JWT_SECRET must be at least 32 characters and not the development default when NODE_ENV=production.');
  }

  const seedPasswordEnv = nonEmpty(env.SEED_PASSWORD);
  const seedPassword = seedPasswordEnv ?? DEFAULT_SEED_PASSWORD;

  const databaseUrl = nonEmpty(env.DATABASE_URL);
  if (!databaseUrl && production) warnings.push('DATABASE_URL is not set — using embedded PGlite. Use PostgreSQL 16 in production.');
  if (!databaseUrl && !nonEmpty(env.PGLITE_DATA_DIR) && !(env.npm_lifecycle_event === 'test' || env.VITEST)) {
    warnings.push('Neither DATABASE_URL nor PGLITE_DATA_DIR is set — using an in-memory PGlite database; data is lost on exit.');
  }

  return {
    nodeEnv,
    production,
    host: nonEmpty(env.HOST) ?? '0.0.0.0',
    port: int(env.PORT, 8080, 'PORT', 1, 65535),
    databaseUrl,
    databaseSchema: nonEmpty(env.DATABASE_SCHEMA),
    pgliteDataDir: nonEmpty(env.PGLITE_DATA_DIR),
    migrationsDir: nonEmpty(env.MIGRATIONS_DIR),
    jwtSecret,
    jwtTtl: nonEmpty(env.JWT_TTL) ?? '8h',
    corsOrigin: nonEmpty(env.CORS_ORIGIN),
    seedOnStart: bool(env.SEED_ON_START, true),
    seedPassword,
    bcryptRounds: int(env.BCRYPT_ROUNDS, 12, 'BCRYPT_ROUNDS', 4, 15),
    trustProxy: trustProxy(env.TRUST_PROXY),
    logLevel: nonEmpty(env.LOG_LEVEL) ?? 'info',
    bodyLimit: int(env.BODY_LIMIT_BYTES, 5 * 1024 * 1024, 'BODY_LIMIT_BYTES', 1024, 100 * 1024 * 1024),
    warnings,
  };
}
