/**
 * Fastify application factory. `buildApp()` connects the database, runs
 * migrations, seeds an empty database (unless disabled) and registers every
 * route under /api. Tests call it with an in-memory PGlite and use
 * `app.inject()`; server.ts calls it and listens.
 */
import Fastify, { type FastifyError, type FastifyInstance, type FastifyLoggerOptions } from 'fastify';
import cors from '@fastify/cors';
import { DEV_JWT_SECRET, loadConfig, type Config } from './config';
import { createDb, type Db } from './db/adapter';
import { migrate } from './db/migrate';
import { TokenService, authHook } from './auth';
import { auditFallback } from './audit';
import { ApiError, errorBody } from './errors';
import { ComputeService } from './engine-service';
import { LoginLimiter, type AppContext } from './context';
import { isDatabaseEmpty, seed } from './seed';
import { miscRoutes } from './routes/misc';
import { projectRoutes } from './routes/projects';
import { scenarioRoutes } from './routes/scenarios';
import { actualsRoutes } from './routes/actuals';
import { rateCardRoutes } from './routes/rate-cards';
import { catalogRoutes } from './routes/catalog';
import type { AuditState } from './types';

export interface BuildAppOptions {
  /** Full config, or overrides applied on top of loadConfig(env). */
  config?: Partial<Config>;
  env?: NodeJS.ProcessEnv;
  /** Use an existing database (not closed by the app). Default: create from config. */
  db?: Db;
  /** Run migrations on start (default true). */
  migrate?: boolean;
  /** 'if-empty' (default when SEED_ON_START is on), true = always (idempotent), false = never. */
  seed?: boolean | 'if-empty';
  /** false silences logs (tests); default: pino at LOG_LEVEL. */
  logger?: boolean | FastifyLoggerOptions;
  /** Max cached compute results (default 6; 0 disables). */
  computeCacheSize?: number;
}

/** Postgres SQLSTATE → API error. */
function pgError(err: { code?: string; message?: string; constraint?: string; detail?: string }): ApiError | null {
  switch (err.code) {
    case '23505':
      return new ApiError(409, 'CONFLICT', 'A record with the same key already exists.', { constraint: err.constraint });
    case '23503':
      return new ApiError(409, 'REFERENCE_CONFLICT', 'The change references a record that does not exist (or is still referenced).', { constraint: err.constraint });
    case '23514':
    case '23502':
      return new ApiError(400, 'CONSTRAINT_VIOLATION', 'A value is out of the allowed range or missing.', { constraint: err.constraint });
    case '22P02':
    case '22003':
    case '22007':
    case '22008':
      return new ApiError(400, 'INVALID_VALUE', 'A value has an invalid format or is out of range.');
    case '40001':
    case '40P01':
      return new ApiError(409, 'RETRY', 'The change conflicted with a concurrent update — retry the request.');
    case '42501':
      return new ApiError(403, 'FORBIDDEN', err.message ?? 'Operation not permitted.');
    default:
      return null;
  }
}

function safeJsonParse(text: string): unknown {
  // Reject prototype-pollution keys outright (same policy as Fastify's default parser).
  return JSON.parse(text, (key, value) => {
    if (key === '__proto__' || (key === 'constructor' && value && typeof value === 'object' && 'prototype' in value)) {
      throw new ApiError(400, 'BAD_REQUEST', 'Request body contains a forbidden key.');
    }
    return value;
  });
}

export async function buildApp(opts: BuildAppOptions = {}): Promise<FastifyInstance> {
  const base = loadConfig(opts.env ?? process.env);
  const cfg: Config = { ...base, ...opts.config, warnings: [...(opts.config?.warnings ?? base.warnings)] };
  if (cfg.jwtSecret !== DEV_JWT_SECRET) cfg.warnings = cfg.warnings.filter((w) => !w.startsWith('JWT_SECRET'));
  if (cfg.databaseUrl || cfg.pgliteDataDir) cfg.warnings = cfg.warnings.filter((w) => !w.startsWith('Neither DATABASE_URL'));

  const tp = cfg.trustProxy;
  const app = Fastify({
    logger: opts.logger ?? { level: cfg.logLevel, redact: ['req.headers.authorization'] },
    // A number means "trust the first N hops".
    trustProxy: typeof tp === 'number' ? (_addr: string, hop: number) => hop < tp : tp,
    bodyLimit: cfg.bodyLimit,
    routerOptions: { ignoreTrailingSlash: true },
  });
  for (const w of cfg.warnings) app.log.warn(w);

  const ownsDb = !opts.db;
  const db =
    opts.db ??
    (await createDb({
      databaseUrl: cfg.databaseUrl,
      schema: cfg.databaseSchema,
      pgliteDataDir: cfg.pgliteDataDir,
    }));
  if (ownsDb) app.log.info(`database: ${db.kind}${db.kind === 'pglite' ? (cfg.pgliteDataDir ? ` (${cfg.pgliteDataDir})` : ' (in-memory)') : ''}`);

  try {
    if (opts.migrate !== false) {
      const r = await migrate(db, { dir: cfg.migrationsDir, log: (m) => app.log.info(m) });
      if (r.applied.length) app.log.info(`migrations applied: ${r.applied.join(', ')}`);
    }
    const seedMode = opts.seed ?? (cfg.seedOnStart ? 'if-empty' : false);
    if (seedMode === true || (seedMode === 'if-empty' && (await isDatabaseEmpty(db)))) {
      await seed(db, {
        password: cfg.seedPassword,
        bcryptRounds: cfg.bcryptRounds,
        log: (m, level) => (level === 'warn' ? app.log.warn(m) : app.log.info(m)),
      });
    }
  } catch (err) {
    if (ownsDb) await db.close().catch(() => {});
    throw err;
  }

  const ctx: AppContext = {
    db,
    cfg,
    tokens: new TokenService(cfg.jwtSecret, cfg.jwtTtl),
    compute: new ComputeService(opts.computeCacheSize ?? 6),
    loginLimiter: new LoginLimiter(),
  };

  app.decorate('db', db);
  app.decorate('cfg', cfg);
  app.decorateRequest('user', null);
  app.decorateRequest('auditState', null as unknown as AuditState);
  if (ownsDb) app.addHook('onClose', async () => db.close());

  if (cfg.corsOrigin) {
    const origins = cfg.corsOrigin.split(',').map((s) => s.trim()).filter(Boolean);
    await app.register(cors, {
      origin: origins.includes('*') ? '*' : origins,
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Authorization', 'Content-Type'],
      exposedHeaders: ['Location', 'Retry-After'],
      maxAge: 600,
    });
  }

  // JSON bodies: an empty body on a POST is treated as "no body" (clients often send the header anyway).
  app.removeContentTypeParser(['application/json']);
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (_req, body, done) => {
    const text = typeof body === 'string' ? body : body.toString('utf8');
    if (text.trim() === '') return done(null, undefined);
    try {
      done(null, safeJsonParse(text));
    } catch (err) {
      if (err instanceof ApiError) return done(err as unknown as FastifyError, undefined);
      done(new ApiError(400, 'INVALID_JSON', 'The request body is not valid JSON.') as unknown as FastifyError, undefined);
    }
  });

  app.setErrorHandler((err: FastifyError | ApiError | Error, req, reply) => {
    let api: ApiError;
    if (err instanceof ApiError) api = err;
    else {
      const e = err as FastifyError & { code?: string; constraint?: string };
      const mapped = typeof e.code === 'string' && /^[0-9A-Z]{5}$/.test(e.code) ? pgError(e) : null;
      if (mapped) api = mapped;
      else if (e.statusCode === 413) api = new ApiError(413, 'PAYLOAD_TOO_LARGE', 'The request body is too large.');
      else if (e.statusCode === 415) api = new ApiError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Send JSON with "Content-Type: application/json".');
      else if (e.statusCode && e.statusCode >= 400 && e.statusCode < 500) api = new ApiError(e.statusCode, 'BAD_REQUEST', e.message);
      else api = new ApiError(500, 'INTERNAL', 'An unexpected error occurred. It has been logged.');
    }
    if (api.statusCode >= 500) req.log.error({ err }, 'request failed');
    else req.log.info({ code: api.code, status: api.statusCode }, api.message);
    if (req.auditState) req.auditState.error = { code: api.code, message: api.message.slice(0, 300) };
    reply.code(api.statusCode).send(errorBody(api.code, api.message, api.details));
  });

  app.setNotFoundHandler((req, reply) => {
    reply.code(404).send(errorBody('NOT_FOUND', `No route for ${req.method} ${req.url.split('?')[0]}.`));
  });

  app.addHook('onRequest', authHook(db, ctx.tokens));
  app.addHook('onSend', async (req, reply) => {
    reply.header('cache-control', 'no-store');
    reply.header('x-content-type-options', 'nosniff');
  });
  app.addHook('onSend', auditFallback(db));

  await app.register(
    async (api) => {
      miscRoutes(api, ctx);
      projectRoutes(api, ctx);
      scenarioRoutes(api, ctx);
      actualsRoutes(api, ctx);
      rateCardRoutes(api, ctx);
      catalogRoutes(api, ctx);
    },
    { prefix: '/api' },
  );

  return app;
}
