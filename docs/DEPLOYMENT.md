# Deployment and operations

This guide covers running the Enterprise AI Economics & Commercialization Studio locally, building it, deploying it with Docker Compose or on your own infrastructure, and upgrading it.

The studio has two runtime parts:

| Part | What it is | Source |
|---|---|---|
| Web app | A React single-page app. It runs the calculation engine in the browser and works on its own (data in browser `localStorage`) or connected to the API. | `apps/web` |
| API server | A Fastify server with PostgreSQL. It stores projects with version history, the rate catalogue, actuals, scenarios, rate cards and an append-only audit log, and enforces sign-in and role-based access. | `apps/api`, `db/migrations` |

Both use the same deterministic engine (`packages/engine`), so a figure is identical whether it is calculated in the browser or on the server. The full API reference, including every endpoint and environment variable, is in [apps/api/README.md](../apps/api/README.md). The database schema is in [db/schema.md](../db/schema.md).

## Prerequisites

| Requirement | Notes |
|---|---|
| Node.js | **22.12 or later recommended** (the Docker images use Node 22). The root `package.json` declares Node ≥ 20, and the web build tool (Vite 8) needs 20.19 or later, but the test runner (Vitest 5) needs 22.12 or later. |
| npm | Comes with Node. The repository is an npm workspace with a committed `package-lock.json`. |
| PostgreSQL 16 | For production. Not needed for local development, where the API uses embedded PGlite (PostgreSQL compiled to WebAssembly) running the same SQL and migrations. |
| Docker with Compose v2 | Optional. Runs PostgreSQL 16, the API and the web app together. |
| LibreOffice | Optional. Used only by one reports test that recalculates the generated Excel model; the test is skipped when `soffice` is not on the `PATH`. |

## Local development

From the repository root:

```bash
npm install
```

### Web app only (standalone)

```bash
npm run dev            # same as: npm run dev -w @aies/web
```

Open http://localhost:5173. The app loads the three illustrative sample projects and the sample catalogue, and keeps every change in the browser's `localStorage`. **Settings → Data** can export the whole workspace as one JSON file and import it again.

### Web app with the API server

Run each command in its own terminal:

```bash
npm run dev:api        # same as: npm run dev -w @aies/api   → http://localhost:8080
npm run dev            # same as: npm run dev -w @aies/web   → http://localhost:5173
```

- The API runs `tsx watch src/server.ts --pglite-dir=.pgdata`. Its data is kept in PGlite under `apps/api/.pgdata` (git-ignored). On first start it applies the migrations and seeds an empty database with:
  - the sample catalogue
  - the three sample projects
  - one demo user per role: `admin@demo.local`, `consultant@demo.local`, `architect@demo.local`, `engineering@demo.local`, `finance@demo.local` and `executive@demo.local`
- The demo password is `SEED_PASSWORD`, or `ChangeMe!2026` if that is not set; the server logs a warning when the default is used.
- The Vite dev server proxies `/api` to `http://localhost:8080` (`apps/web/vite.config.ts`).
- To connect, open **Settings → Data → Connect to the studio server**, leave **Server address** empty, and sign in with a demo user.

To develop against a real PostgreSQL instead of PGlite, set `DATABASE_URL` before starting the API, for example `DATABASE_URL=postgres://aies@localhost:5432/aies PGPASSWORD=… npm run dev:api`.

Other API scripts (each uses `DATABASE_URL` if set, otherwise `apps/api/.pgdata`):

```bash
npm run migrate -w @aies/api
npm run seed -w @aies/api
NEW_USER_PASSWORD='at-least-10-chars' npm run create-user -w @aies/api -- jane@example.com finance "Jane Doe"
```

Roles are `admin`, `consultant`, `architect`, `engineering`, `finance` and `executive`.

## Running tests

```bash
npm test               # engine, then reports, then API
npm run typecheck      # tsc in every workspace that defines it
```

| Suite | Command | Tests | Notes |
|---|---|---:|---|
| Engine | `npm run test -w @aies/engine` | 91 | Calculations, reconciliation, sample projects, regressions |
| Reports | `npm run test -w @aies/reports` | 43 | Report content and file formats. Includes a LibreOffice recalculation of the Excel model (with its live formulas) against the engine, skipped without LibreOffice. |
| API | `npm run test -w @aies/api` | 27 | Runs against in-memory PGlite. Set `TEST_DATABASE_URL=postgres://…` to run the same suite on a real PostgreSQL, using a throw-away schema per file. |

## Production builds

```bash
npm run build          # web, then API
```

| Output | Built by | Contents |
|---|---|---|
| `apps/web/dist/` | `npm run build -w @aies/web` (`vite build`) | Static files (`index.html` and hashed `assets/`). Serve them from any static web server with a fallback to `index.html`. |
| `apps/api/dist/server.js`, `apps/api/dist/cli.js` | `npm run build -w @aies/api` (esbuild) | The API server and the operations CLI. The engine is bundled in. Other packages are left external, so production dependencies must be installed next to them (`npm ci -w @aies/api --omit=dev`). |

Start the built API:

```bash
NODE_ENV=production DATABASE_URL=postgres://aies@db-host:5432/aies PGPASSWORD=… JWT_SECRET=… node apps/api/dist/server.js
```

The API applies pending migrations and seeds an empty database on every start (see [Upgrading](#upgrading) and [Security checklist](#security-checklist)). It finds `db/migrations` by walking up from `dist/`, or from `MIGRATIONS_DIR` if that is set.

## Docker Compose

`docker-compose.yml` runs three services on one host:

| Service | Image | Role |
|---|---|---|
| `db` | `postgres:16-alpine` | Database. Data is kept in the `pgdata` volume. Health-checked with `pg_isready`. |
| `api` | Built from `apps/api/Dockerfile` (Node 22 Alpine) | API on port 8080, not published to the host. Health check `GET /api/health`. Starts after `db` is healthy. |
| `web` | Built from `apps/web/Dockerfile` (nginx 1.27 Alpine) | Serves the web build and proxies `/api/` to `api:8080` (`apps/web/nginx.conf`). Published on `WEB_PORT` (default 8081). Starts after `api` is healthy. |

### Start

```bash
export POSTGRES_PASSWORD='a-strong-password'
export JWT_SECRET="$(openssl rand -base64 48)"
docker compose up -d --build
```

Open http://localhost:8081. You can also put the variables in a `.env` file next to `docker-compose.yml`; `.env` is git-ignored.

### Environment variables

| Variable | Required | Default | Used by | Purpose |
|---|---|---|---|---|
| `POSTGRES_PASSWORD` | yes | none | `db`, `api` (as `PGPASSWORD`) | Database password for user `aies` on database `aies`. Passed to the API as `PGPASSWORD`, so special characters need no URL-encoding. |
| `JWT_SECRET` | yes | none | `api` | Signing key for sign-in tokens (HS256). With `NODE_ENV=production`, which the Compose file sets, the API refuses to start unless it is at least 32 characters and not the development default. |
| `JWT_TTL` | no | `8h` | `api` | Token lifetime. |
| `SEED_PASSWORD` | no | `ChangeMe!2026` | `api` | Password for the demo users created when the database is empty. |
| `CORS_ORIGIN` | no | empty (CORS off) | `api` | Comma-separated origins allowed to call the API from another origin, or `*`. Leave empty when the web app is served through the bundled nginx, because the browser then calls the API on the same origin. |
| `TRUST_PROXY` | fixed | `"1"` | `api` | Set in the Compose file so the API trusts one proxy hop (nginx) and records real client IP addresses in the audit log. |
| `LOG_LEVEL` | no | `info` | `api` | Log level. The `Authorization` header is redacted. |
| `WEB_PORT` | no | `8081` | `web` | Host port for the web app. |
| `API_PORT` | no | `8080` | `api` | Used only if you uncomment the `ports` mapping on `api` to expose it directly. |

The Compose file sets `NODE_ENV=production`, `PORT=8080` and `DATABASE_URL=postgres://aies@db:5432/aies` for the API. Every other variable in [apps/api/README.md](../apps/api/README.md) keeps its default unless you add it to the `api` service's `environment`.

**Seeding.** The Compose file passes `SEED_ON_START` through (default `true`). On first start against an empty database, the API seeds the sample catalogue, the three illustrative sample projects and the six demo users. To prevent this, start with `SEED_ON_START=false`, then create real users with the CLI.

### Operations

```bash
docker compose logs -f api
docker compose exec -e NEW_USER_PASSWORD='at-least-10-chars' api node dist/cli.js create-user jane@example.com finance "Jane Doe"
docker compose exec api node dist/cli.js migrate
docker compose exec db pg_dump -U aies -d aies > aies-backup.sql
```

The CLI takes `migrate`, `seed` or `create-user <email> <role> [name]`.

## Vercel (web app)

The repository includes `vercel.json`, so Vercel builds the web app with no extra settings:

| Setting | Value (from `vercel.json`) |
|---|---|
| Install command | `npm ci --no-audit --no-fund` |
| Build command | `npm run build -w @aies/web` |
| Output directory | `apps/web/dist` |

1. Go to [vercel.com/new](https://vercel.com/new) and import the GitHub repository.
2. Keep the root directory as the repository root (the build needs the engine and reports workspaces).
3. Click **Deploy**. Every push to `main` then deploys automatically, and pull requests get preview URLs.

On Vercel the app runs in browser mode: projects are kept in each user's browser (export and import JSON to move them). The API is a long-running Fastify server with PostgreSQL, so host it separately (for example Render, Railway or a VM with Docker Compose), set its `CORS_ORIGIN` to the Vercel URL, and enter the API address under **Settings → Data → Connect to the studio server**.

## Manual deployment (VM or Kubernetes)

This is an outline; adapt it to your platform.

1. **Database.** Provision managed PostgreSQL 16. Create a database and a user for the studio. Point the API at it with `DATABASE_URL`, and supply the password with `PGPASSWORD` or in the URL. Set `DATABASE_SCHEMA` to use a dedicated schema, which is created if missing.
2. **Build.** Either build the two images from the repository root (`docker build -f apps/api/Dockerfile -t aies-api .` and `docker build -f apps/web/Dockerfile -t aies-web .`), or on a VM run `npm ci` and `npm run build`.
3. **Configure the API.**
   - Set `NODE_ENV=production`, `JWT_SECRET` (at least 32 random characters) and `SEED_ON_START=false`.
   - Set `TRUST_PROXY` to the number of proxy hops in front of the API, or to their IP or CIDR list.
   - Set `CORS_ORIGIN` only if the web app is served from a different origin.
   - Store the secrets in your platform's secret manager.
4. **Run migrations** before starting new API instances:
   ```bash
   node apps/api/dist/cli.js migrate        # from a repository checkout with production dependencies installed
   node dist/cli.js migrate                 # inside the API image (working directory /app)
   ```
   The API also migrates on start. Migrations take a PostgreSQL advisory lock, so several replicas starting together are safe.
5. **Create users.** `NEW_USER_PASSWORD='…' node apps/api/dist/cli.js create-user <email> <role> [name]`, or use `POST /api/users` as an administrator. Running `create-user` for an existing email updates its role and password and reactivates it.
6. **Run the API** with `node apps/api/dist/server.js` (or the image), behind a load balancer that terminates TLS. Use `GET /api/health` for readiness and liveness; it returns 503 when the database is unreachable. The API listens on `HOST:PORT` (default `0.0.0.0:8080`) and shuts down gracefully on `SIGTERM`.
7. **Serve the web app.** Serve `apps/web/dist/` as static files with an `index.html` fallback, and route `/api/` on the same host name to the API. `apps/web/nginx.conf` is written for Docker Compose: it uses Docker's internal DNS resolver (`127.0.0.11`) and the upstream `http://api:8080`. On Kubernetes, either change the `resolver` and upstream to your cluster DNS and API service, or route `/api/` to the API at the ingress and serve the static files separately.

## Connecting the web app to the API

In the web app, open **Settings → Data → Connect to the studio server** and sign in.

| How the web app is served | Server address |
|---|---|
| By the bundled nginx (Docker Compose), or any proxy that routes `/api/` on the same host name | Leave **empty** (same origin) |
| Vite dev server (`npm run dev`) with the API on port 8080 | Leave **empty** (the dev proxy forwards `/api`) |
| From a different origin than the API | The API's base URL, for example `https://studio-api.example.com`. Add the web app's origin to `CORS_ORIGIN`. |

While connected:

- The server's projects and catalogue replace the browser workspace. Export the browser workspace first (**Settings → Data → Export state**) if you want to keep it.
- Each edit is saved with `PUT /api/projects/:id` as a new project version, using optimistic concurrency. If another user saved first (HTTP 409), the app reloads their version. If the server refuses a change (HTTP 403 for your role, or 422 for invalid input), the app reloads the server's version, which reverts the change.
- Your role comes from the signed-in user. The role selector, which switches demo roles in standalone mode, shows that role instead.
- **Settings → Audit log** shows the server's audit log.
- Calculations still run in the browser with the same engine.

## Single-file demo build

The web app can be packaged as one self-contained HTML file (all scripts, styles and fonts inlined) for a standalone hosted demo. It runs in standalone mode.

```bash
npm run build:single -w @aies/web      # → apps/web/dist-single/index.html
node scripts/make-artifact.mjs         # → apps/web/dist-artifact/index.html
```

`make-artifact.mjs` turns the single-file build into page content for a host that supplies its own `<html>`, `<head>` and `<body>` skeleton. Run it from the repository root, or pass the input and output paths as its two arguments. Both output folders are git-ignored.

## Security checklist

- [ ] **JWT secret.** Use a random value of at least 32 characters (`openssl rand -base64 48`), keep it in a secret store, and rotate it if exposed. Rotating it signs every user out.
- [ ] **TLS.** The nginx container and the API listen on plain HTTP. Terminate TLS at a load balancer, ingress or reverse proxy in front of them, and do not expose port 8080 publicly.
- [ ] **Demo users.** On a shared or production database, set `SEED_ON_START=false` before the first start. If demo users were created, deactivate them or change their passwords (`PUT /api/users/:userId`). Never leave the default `ChangeMe!2026` in place.
- [ ] **Rate limits are per process.** Sign-in is limited to 10 failures per IP address and email in 15 minutes, held in memory in each API process. It resets on restart and is not shared between replicas. Add a rate limiter at the gateway when running more than one instance.
- [ ] **Proxy trust.** Set `TRUST_PROXY` to match your proxy chain so the audit log records real client IP addresses, and so clients cannot spoof `X-Forwarded-For`.
- [ ] **CORS.** Leave `CORS_ORIGIN` empty for same-origin deployments. Avoid `*` in production.
- [ ] **Backups.** Back up PostgreSQL regularly (for example with `pg_dump`, or managed snapshots) and test restores. The `audit_log` table is append-only and `project_versions` rows are immutable, so plan for their growth.
- [ ] **Sample rates.** Every rate in the default catalogue is an illustrative sample: model token prices, FX rates, cloud prices and AgentOps salaries. Before any client use, replace them with contracted or published rates under **Settings → Model rate card**, **Cloud & service prices** and **FX rates** (or through the `/api/catalog` endpoints), and record each source and effective date.
- [ ] **Sample projects.** The seeded sample projects and client names are fictitious. On a production database, set `SEED_ON_START=false` before the first start, or delete the sample projects (projects are soft-deleted).
- [ ] **Standalone mode.** Without a server, data lives only in that browser's `localStorage`. It is not shared, backed up or access-controlled, and the role selector is not a security control.

## Upgrading

1. Back up the database.
2. Pull the new version of the repository.
3. Rebuild and restart:
   - Docker Compose: `docker compose up -d --build`
   - Manual: `npm ci`, `npm run build`, `node apps/api/dist/cli.js migrate`, then restart the API instances and redeploy `apps/web/dist/`
4. Check `GET /api/health` and the API log for the list of migrations applied.

**Migrations** are versioned SQL files in `db/migrations`, named `NNN_snake_case.sql` (for example `001_init.sql`). They are applied in order, each in its own transaction, and recorded in the `schema_migrations` table with a SHA-256 checksum. If an already-applied file has changed, the run stops with a checksum error. Never edit an applied migration; add a new numbered file instead.

The engine has no stored state of its own. After an upgrade, each project is recalculated from its stored inputs, so changes to the calculation methodology (see [METHODOLOGY.md](METHODOLOGY.md)) can change computed figures for existing projects. Saved scenario metrics and rate-card price snapshots keep the values computed when they were saved.
