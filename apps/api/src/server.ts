/**
 * API entry point. `buildApp` is exported for tests (`app.inject`); running
 * this module directly (tsx in dev, node dist/server.js in production)
 * starts the HTTP server.
 */
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { buildApp } from './app';
import { applyCliDefaults, loadConfig } from './config';

export { buildApp, type BuildAppOptions } from './app';

async function main(): Promise<void> {
  let cfg;
  try {
    cfg = applyCliDefaults(loadConfig());
    if (cfg.pgliteDataDir && !cfg.databaseUrl) cfg.warnings = cfg.warnings.filter((w) => !w.startsWith('Neither DATABASE_URL'));
  } catch (err) {
    console.error(`[aies-api] configuration error: ${(err as Error).message}`);
    process.exit(1);
  }
  const app = await buildApp({ config: cfg });

  let closing = false;
  const shutdown = (signal: string) => {
    if (closing) return;
    closing = true;
    app.log.info(`${signal} received — shutting down`);
    const timer = setTimeout(() => process.exit(1), 10_000);
    timer.unref();
    app
      .close()
      .then(() => process.exit(0))
      .catch((err) => {
        app.log.error({ err }, 'error during shutdown');
        process.exit(1);
      });
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  await app.listen({ port: cfg.port, host: cfg.host });
}

function isMain(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return realpathSync(entry) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isMain()) {
  main().catch((err) => {
    console.error('[aies-api] failed to start:', err);
    process.exit(1);
  });
}
