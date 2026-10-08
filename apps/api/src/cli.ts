/**
 * Operational CLI.
 *   node dist/cli.js migrate                 apply db/migrations/*.sql
 *   node dist/cli.js seed                    migrate + idempotent seed (catalogue, samples, demo users)
 *   node dist/cli.js create-user <email> <role> [name]   password read from NEW_USER_PASSWORD
 * In development: npm run seed -w @aies/api (uses tsx).
 */
import { ROLES } from '@aies/engine';
import { applyCliDefaults, loadConfig } from './config';
import { createDb } from './db/adapter';
import { migrate } from './db/migrate';
import { seed } from './seed';
import { hashPassword, isRole } from './auth';
import { writeAudit } from './audit';

const log = (msg: string, level: 'info' | 'warn' = 'info') => (level === 'warn' ? console.warn(`[aies] WARNING: ${msg}`) : console.log(`[aies] ${msg}`));

async function run(cmd: string | undefined, rest: string[]): Promise<void> {
  if (!cmd || !['migrate', 'seed', 'create-user'].includes(cmd)) {
    console.error('usage: cli <migrate|seed|create-user <email> <role> [name]>');
    process.exit(2);
  }
  const cfg = applyCliDefaults(loadConfig());
  for (const w of cfg.warnings) if (!(cfg.pgliteDataDir && w.startsWith('Neither DATABASE_URL'))) log(w, 'warn');
  const args = rest.filter((a) => !a.startsWith('--'));
  const db = await createDb({ databaseUrl: cfg.databaseUrl, schema: cfg.databaseSchema, pgliteDataDir: cfg.pgliteDataDir });
  log(`database: ${db.kind}${db.kind === 'pglite' ? ` (${cfg.pgliteDataDir ?? 'in-memory — nothing will persist; set DATABASE_URL or PGLITE_DATA_DIR'})` : ''}`);
  try {
    const r = await migrate(db, { dir: cfg.migrationsDir, log });
    log(`migrations: ${r.applied.length} applied, ${r.skipped.length} already up to date`);
    if (cmd === 'seed') await seed(db, { password: cfg.seedPassword, bcryptRounds: cfg.bcryptRounds, log });
    if (cmd === 'create-user') {
      const [email, role, ...name] = args;
      const password = process.env.NEW_USER_PASSWORD;
      if (!email || !isRole(role) || !password || password.length < 10) {
        throw new Error(`usage: NEW_USER_PASSWORD=<10+ chars> cli create-user <email> <${ROLES.join('|')}> [name]`);
      }
      const hash = await hashPassword(password, cfg.bcryptRounds);
      await db.tx(async (q) => {
        const { rows } = await q.query<{ id: string }>(
          'INSERT INTO users (email, name, role, password_hash) VALUES ($1, $2, $3, $4) ON CONFLICT (email) DO UPDATE SET role = EXCLUDED.role, password_hash = EXCLUDED.password_hash, active = true RETURNING id',
          [email.toLowerCase(), name.join(' ') || email, role, hash],
        );
        await writeAudit(q, null, { action: 'user.create', actor: { id: null, email: 'cli', role: null }, entityType: 'user', entityId: rows[0].id, detail: { email: email.toLowerCase(), role, via: 'cli' } });
      });
      log(`user ${email.toLowerCase()} (${role}) is ready`);
    }
  } finally {
    await db.close();
  }
}

run(process.argv[2], process.argv.slice(3)).catch((err) => {
  console.error(`[aies] ${(err as Error).message}`);
  process.exit(1);
});
