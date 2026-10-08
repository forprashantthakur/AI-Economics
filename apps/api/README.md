# @aies/api — Enterprise AI Economics Studio API

Fastify 5 + PostgreSQL 16 backend for the studio. All calculations are done by `@aies/engine`
(bundled into the server); the API stores projects, versions, catalogue rate tables, actuals,
scenarios, rate cards and an append-only audit log, and enforces authentication and RBAC.

- JSON everywhere. Engine `Decimal`s serialise as **strings** (exact); `numeric` columns are returned as strings too.
- Errors: `{"error": {"code": "SOME_CODE", "message": "What is wrong and how to fix it", "details"?: …}}`.
- Database: `pg` pool when `DATABASE_URL` is set; otherwise embedded **PGlite** (real Postgres in WASM) —
  in-memory, or on disk with `PGLITE_DATA_DIR`. Same SQL, same migrations. Schema: [`db/schema.md`](../../db/schema.md).

## Running

```bash
# Development (PGlite persisted in apps/api/.pgdata, auto-migrated and seeded on first start; port 8080)
npm run dev -w @aies/api
npm run dev -w @aies/web           # Vite proxies /api → http://localhost:8080

# Seed / migrate explicitly (idempotent). Uses DATABASE_URL if set, else apps/api/.pgdata
npm run seed -w @aies/api
npm run migrate -w @aies/api
NEW_USER_PASSWORD='…' npm run create-user -w @aies/api -- jane@corp.com finance "Jane Doe"

# Production build (esbuild bundles src/server.ts and src/cli.ts into dist/, engine included)
npm run build -w @aies/api
NODE_ENV=production DATABASE_URL=postgres://… JWT_SECRET=… node apps/api/dist/server.js
node apps/api/dist/cli.js seed      # or migrate / create-user

# Tests (vitest + in-memory PGlite + app.inject)
npm test -w @aies/api
TEST_DATABASE_URL=postgres://user:pw@localhost:5432/db npm test -w @aies/api   # same suite on a real Postgres (throw-away schema per file)
npx tsc -p apps/api/tsconfig.json

# Docker (from the repo root): postgres:16 + api + nginx web on http://localhost:8081
POSTGRES_PASSWORD=… JWT_SECRET=$(openssl rand -base64 48) docker compose up -d --build
```

On start the server runs pending migrations (advisory-locked) and, if the database is empty, seeds it:
the engine's default (illustrative) catalogue, the three sample projects (version 1 + their actuals) and
one demo user per role — `admin@demo.local`, `consultant@…`, `architect@…`, `engineering@…`, `finance@…`,
`executive@…` — with password `SEED_PASSWORD` (default `ChangeMe!2026`, logged as a warning).
Disable with `SEED_ON_START=false` and create real users with `create-user` or `POST /api/users`.

## Environment

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` / `HOST` | `8080` / `0.0.0.0` | Listen address |
| `NODE_ENV` | `development` | `production` makes `JWT_SECRET` mandatory (≥ 32 chars) |
| `DATABASE_URL` | — | `postgres://…`; credentials may come from `PGPASSWORD` etc. Unset → PGlite |
| `DATABASE_SCHEMA` | — | Optional schema (created if missing; sets `search_path`) |
| `PGLITE_DATA_DIR` | — | PGlite directory when `DATABASE_URL` is unset (unset = in-memory; `npm run dev/seed` use `.pgdata`) |
| `MIGRATIONS_DIR` | auto (`db/migrations` found by walking up) | Override migrations location |
| `JWT_SECRET` | dev default + warning | HS256 signing key. **Required in production** |
| `JWT_TTL` | `8h` | Token lifetime (jose duration) |
| `SEED_ON_START` | `true` | Seed when the database is empty |
| `SEED_PASSWORD` | `ChangeMe!2026` (warning) | Password for the demo users |
| `BCRYPT_ROUNDS` | `12` | Password hashing cost (4–15) |
| `CORS_ORIGIN` | — (no CORS) | Comma-separated allowed origins, or `*` |
| `TRUST_PROXY` | `false` | `true`, hop count, or IP/CIDR list — needed behind nginx for client IPs in the audit log |
| `LOG_LEVEL` | `info` | pino level; the `Authorization` header is redacted |
| `BODY_LIMIT_BYTES` | 5 MB | Max request body |

## Authentication

1. `POST /api/auth/login {email, password}` → `{token, tokenType: "Bearer", expiresAt, user: {id, email, name, role, roleLabel, permissions}}`.
2. Send `Authorization: Bearer <token>` on every other request (all routes except `/api/health` and `/api/auth/login`).
3. Tokens are HS256 JWTs (`sub` = user id, `iss` = `aies-api`, `aud` = `aies`). The user is re-loaded on every request,
   so deactivation or a role change applies immediately. Expired/invalid tokens → `401 TOKEN_EXPIRED` / `INVALID_TOKEN`.
4. Failed logins return the same `401 INVALID_CREDENTIALS` for unknown e-mail and wrong password (constant-time path), are audited,
   and after 10 failures per IP+email in 15 minutes return `429 TOO_MANY_ATTEMPTS` (per process — add a gateway limiter when scaling out).

## Authorisation (RBAC)

Permissions come from the engine (`can(role, permission)` in `packages/engine/src/rbac.ts`). Every authenticated role may read.
`executive` is read-only. Failures return `403 FORBIDDEN` with `details.required` and are audited (`outcome = denied`).

`PUT /api/projects/:id` is checked **per changed section**, so a full-document save cannot bypass a narrower permission:

| Changed in the project JSON | Permission |
| --- | --- |
| name, status, currency, goLiveDate, owner, illustrative, client, solution | `project.edit` |
| implementation | `implementation.edit` |
| agents, workflows, costLines, acu | `tokenomics.edit` |
| pricing (incl. drafting `rateCardVersions`) | `pricing.edit` (+ `ratecard.approve` to change approved/superseded entries) |
| value (benefit `status` / `validatedBy` / `validatedOn` excluded) | `value.edit` |
| benefit `status` / `validatedBy` / `validatedOn` | `benefit.validate` |
| actuals | `actuals.edit` |
| scenarios | `scenario.save` |

Creating a project needs `project.create` (plus `benefit.validate` / `ratecard.approve` / `actuals.edit` if the body already contains validated benefits, approved rate cards or actuals).

## Endpoints

All paths are under `/api`. "read" = any authenticated role.

| Method & path | Permission | Notes |
| --- | --- | --- |
| `GET /health` | public | `{status, db: "pg"\|"pglite", dbLatencyMs}`; 503 if the database is down |
| `POST /auth/login` | public | see above |
| `GET /me` | read | current user and permissions |
| `POST /me/password` | read | `{currentPassword, newPassword}` |
| `GET /users` · `POST /users` · `PUT /users/:userId` | `user.manage` | list / create `{email,name,role,password}` / update `{name?,role?,active?,password?}` |
| `GET /projects` | read | list without project JSON (`?status=`, admin `?includeDeleted=true`) |
| `POST /projects` | `project.create` | body = engine `Project` (`id` optional). 201 + `{project, meta, issues}`; `?strict=true` → 422 on engine errors |
| `GET /projects/:id` | read | `{project, meta: {version, …}}` |
| `PUT /projects/:id` | section permissions | `{project, baseVersion, comment?}` → new version; 409 `VERSION_CONFLICT` if `baseVersion ≠ current`; no-op saves keep the version |
| `DELETE /projects/:id` | `project.delete` | soft delete · `POST /projects/:id/restore` undoes it |
| `GET /projects/:id/versions` | read | newest first (`?limit=`, `?before=`), with author, comment and changed sections |
| `GET /projects/:id/versions/:version` | read | full snapshot |
| `POST /projects/:id/compute` | read | summary DTO of `computeProject` (`?version=` for an older version) — see below |
| `POST /compute` | read | same for an ad-hoc `Project` in the body (not stored) |
| `POST /projects/:id/validate` | read | engine `validateProject` issues for the stored project, or for `{project}` in the body |
| `GET /projects/:id/scenarios` | read | latest version per name (`?all=true`, `?name=` for history) + presets |
| `GET /projects/:id/scenarios/:scenarioId` | read | one saved scenario |
| `POST /projects/:id/scenarios/run` | read | `{overrides?, preset?: baseline\|optimized\|stress, breakEven?}` → baseline & scenario `metrics`, `costWaterfall`, issues |
| `POST /projects/:id/scenarios` | `scenario.save` | `{name, overrides?, preset?, comment?}` → next version for that name with computed metrics; mirrored into `project.scenarios` (new project version) |
| `GET /projects/:id/actuals` | read | table rows (numeric as strings) |
| `PUT /projects/:id/actuals` | `actuals.edit` | `{actuals: [...], mode?: merge\|replace, baseVersion?, comment?}`; `monthIndex` derived from `goLiveDate`; writes the table **and** `project.actuals` + new version |
| `GET /projects/:id/variance` | read | engine `varianceAnalysis` (rows, byPeriod, totals) |
| `POST /projects/:id/benefits/:benefitId/validate` | `benefit.validate` | `{status: finance_validated\|realized\|rejected, comment?, baseVersion?}` → sets `validatedBy/On`, history row, new version; returns new client ROI |
| `GET /projects/:id/benefit-validations` | read | decision history (`?benefitId=`) |
| `GET /projects/:id/rate-cards` | read | versions with status, approver and price snapshot |
| `POST /projects/:id/rate-cards` | `pricing.edit` | snapshot current derived prices as a **draft** (`{note?}`) |
| `POST /projects/:id/rate-cards/:version/approve` | `ratecard.approve` | draft → approved; previous approved → superseded; `stale: true` if the project changed since pricing |
| `GET /catalog` | read | current catalogue in the engine `Catalog` shape; `version` is a content hash |
| `PUT /catalog/model-rates/:key` | `catalog.edit` | body = engine `ModelRate` (`id` = key); closes current row, inserts version+1 (identical body = no-op) |
| `GET /catalog/model-rates/:key/history` | read | all versions, newest first |
| `PUT /catalog/cloud-prices/:key` · `GET …/:key/history` | `catalog.edit` · read | same for `CloudPriceItem` |
| `PUT /catalog/fx` | `catalog.edit` | full `FxTable` `{base, asOf, source, rates}` (rates may be decimal strings); returns added/updated/removed |
| `GET /catalog/fx/history` | read | `?currency=` |
| `GET /catalog/acu-weight-sets` | read | every version with status |
| `POST /catalog/acu-weight-sets` | `catalog.edit` | new **draft** version of an `AcuWeightSet` (409 if `id`+`version` exists) |
| `POST /catalog/acu-weight-sets/:id/:version/approve` | `catalog.edit` | draft → approved; previously approved version → retired |
| `GET /templates` | read | `{builtIn, custom}` |
| `POST /templates` | `project.create` or `catalog.edit` | create/replace a custom `ProcessTemplate` (built-in ids rejected) |
| `GET /audit` | `audit.view` | `?projectId=&action=&userEmail=&outcome=&limit=(≤1000)&before=<id>` newest first |

Report exports are provided separately (`@aies/reports`).

### Compute summary

`POST /projects/:id/compute` returns everything dashboards need without the ~1 MB `ProjectResult`:
`implementation` (costs, price, margin, phases, roles, schedule), `baseline` (funnel totals, run cost, pools,
cost by workflow/agent/function, LLM cost by model/agent/workflow + tokens, per-workflow funnel and unit costs, cost lines),
`acu` (method A/B, totals by workflow/agent, cost per ACU, marginal cost, price), `abu` (weighted ABUs, cost per ABU,
blended price, per-workflow prices), `priceBook` (streams, recovery matrix, issues), `steady` (steady-state revenue, margin,
revenue/cost by stream, value), `years`, compact `months`, `economics` (provider + client), `packages`
(id, name, economics, steady margin for the 7 commercial constructs), `issues` and `reconciliation`
(+ `reconciliationPassed`). Results are cached per (project, version, catalogue version).

## Versioning

- **Projects**: `current_version` is the optimistic-concurrency token. Every change — PUT, actuals upsert, benefit validation,
  rate-card draft/approval, scenario save — writes an immutable `project_versions` row (full snapshot, author, comment,
  changed sections) in the same transaction as the update and its audit row. Concurrent writers get `409 VERSION_CONFLICT`.
- **Catalogue**: model rates, cloud prices and FX rows are never overwritten — the current row is closed (`effective_to = now()`)
  and a new version inserted, so `/history` shows every change. ACU weight sets and project rate cards follow a
  draft → approved → retired/superseded workflow with one approved version at a time.
- **Scenarios**: each save under the same name is the next version, with metrics computed against the stated project version.

## Audit log

Every mutating request (POST/PUT/DELETE, except read-only POSTs such as compute, validate and scenario run) writes one
`audit_log` row: user, role, action, entity, project, IP, outcome and a compact `detail` (version numbers, changed keys,
status transitions). Successful changes are written **inside the same transaction** as the data; failures (4xx/5xx),
denied requests (401/403 on any route, including reads) and login attempts (success, failure with reason, rate-limited)
are written by an `onSend` hook. The table is append-only (database trigger). Read it with `GET /api/audit` (`audit.view`).
