# Database schema

PostgreSQL 16 (production) — the same SQL runs on PGlite (embedded Postgres/WASM) for local development and tests.
Source of truth: [`migrations/001_init.sql`](migrations/001_init.sql).

## Conventions

| Topic | Rule |
| --- | --- |
| Money, rates, quantities | `numeric` (FX: `numeric(24,10)`); never `float`. The API returns them as exact strings. |
| Time | `timestamptz` (UTC); business periods are `text` `YYYY-MM`; FX `as_of` is `date`. |
| Engine objects | Stored verbatim as `jsonb` (`Project`, `ModelRate`, `CloudPriceItem`, `AcuWeightSet`, `ProcessTemplate`). Columns beside them are denormalised copies for filtering, indexing and constraints. |
| Versioned rate tables | `effective_from` / `effective_to`; the **current** row has `effective_to IS NULL` (enforced by a partial unique index). An update closes the current row and inserts `version + 1`; rows are never deleted. |
| Immutability | `project_versions` rejects `UPDATE`; `audit_log` rejects `UPDATE` and `DELETE` (trigger `aies_reject_modification`). |
| Deletes | Projects are soft-deleted (`deleted_at`). Child rows use `ON DELETE CASCADE` only for a hard purge by a DBA. |
| Users in FKs | `ON DELETE SET NULL` everywhere so history survives user removal; `audit_log` keeps `user_email`/`role` copies and has no FK. |

## Migrations

`schema_migrations(version text pk, name, checksum sha256, applied_at)` — created by the runner (`apps/api/src/db/migrate.ts`).
Files `db/migrations/NNN_snake_case.sql` are applied in lexical order, each in its own transaction under a Postgres advisory lock
(safe when several API replicas start together). A file whose checksum changed after it was applied aborts the run: add a new migration instead of editing an old one.

## Tables

### `users`
| Column | Type | Notes |
| --- | --- | --- |
| id | uuid pk | `gen_random_uuid()` |
| email | text unique | lower-case, must contain `@` |
| name | text | |
| role | text | one of engine `ROLES`: admin, consultant, architect, engineering, finance, executive |
| password_hash | text | bcrypt |
| active | boolean | inactive users cannot log in; existing tokens stop working immediately |
| created_at, updated_at, last_login_at | timestamptz | `updated_at` maintained by trigger |

### `clients`
Client organisations, upserted from `project.data.client.clientName` (case-insensitive unique on `lower(name)`); `industry`, `geography`.

### `projects`
| Column | Type | Notes |
| --- | --- | --- |
| id | text pk | `^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$`; must equal `data->>'id'` (check constraint) |
| client_id | uuid → clients | |
| name, status, currency | text | copies of `data.name/status/currency`; status ∈ pre_sales, in_delivery, live; currency `^[A-Z]{3}$` |
| owner_id | uuid → users | creator |
| current_version | int | optimistic-concurrency token; equals the latest `project_versions.version` |
| data | jsonb | the engine `Project` object (single source of truth for calculations) |
| created_by, updated_by | uuid → users | |
| created_at, updated_at, deleted_at | timestamptz | soft delete |

Indexes: `(updated_at desc) where deleted_at is null`, `client_id`, `owner_id`, `(status) where deleted_at is null`.

### `project_versions` (immutable)
`pk(project_id, version)`; `data jsonb` (full `Project` snapshot), `author_id`, `comment`, `changed text[]` (top-level sections that differ from the previous version), `created_at`.
Every write — create, PUT, actuals upsert, benefit validation, rate-card draft/approval, scenario save — inserts one row in the same transaction as the `projects` update and the audit row.

### `scenarios` (versioned per name)
`id uuid pk`, `project_id → projects`, `name`, `version` (unique per `(project_id, name)`), `overrides jsonb` (engine `ScenarioOverrides`), `metrics jsonb` (engine `ScenarioMetrics` computed at save time, Decimals as strings), `project_version` (project version the metrics were computed on), `comment`, `author_id`, `created_at`.
Saved scenarios are also mirrored into `projects.data.scenarios` (engine `ScenarioRecord`), which the web app reads.

### `actuals`
`pk(project_id, period, workflow_id)`; `period` `YYYY-MM`; `month_index` (run month, 1 = go-live month; derived by the API from the project's `goLiveDate`); `attempted`, `accepted` numeric; `input_tokens`, `output_tokens` bigint; `llm_cost`, `non_llm_cost`, `realized_benefit` numeric; `currency`; `updated_by`, timestamps.
Mirrors `projects.data.actuals` (rewritten whenever a project version changes them), so actuals can be queried in SQL; the engine reads the JSON copy.

### `model_rates`, `cloud_price_items` (versioned rate tables)
| Column | Type | Notes |
| --- | --- | --- |
| id | bigserial pk | |
| rate_key | text | engine `ModelRate.id` / `CloudPriceItem.id` (must equal `data->>'id'`) |
| version | int | unique per `rate_key`, 1, 2, … |
| data | jsonb | the engine object |
| generated columns | | `provider`, `currency`, `input_per_m`, `output_per_m` (model rates); `category`, `currency`, `unit_cost` (cloud prices) — `numeric`, stored |
| effective_from, effective_to | timestamptz | current row: `effective_to IS NULL` (partial unique index per key) |
| created_by, created_at | | |

### `fx_rates` (versioned per currency)
`base`, `currency`, `rate numeric(24,10) > 0` (units of `currency` per 1 `base`), `as_of date`, `source`, `effective_from`, `effective_to`, `created_by`. One current row per currency (partial unique index); `PUT /api/catalog/fx` closes changed/removed rows and inserts new ones.

### `acu_weight_sets`
`pk(id, version)`; `status` draft → approved → retired (at most one approved version per `id`, partial unique index); `data jsonb` (engine `AcuWeightSet`); `created_by/at`, `approved_by/at`. The assembled catalogue uses the approved version of each set (or the newest draft if none is approved).

### `rate_card_versions`
`pk(project_id, version)`; `status` draft → approved → superseded (one approved per project, partial unique index; `approved_at` required unless draft); `data jsonb` — engine `RateCardVersion` (`acuPrice`, `abuPrices`, `subscriptionFee`, `agentOpsFee`) plus the full stream price detail, currency, steady margin and TCV at snapshot time; `note`; `project_version` (version the prices were derived from); `created_by/at`, `approved_by/at`. The compact `RateCardVersion` is mirrored into `projects.data.pricing.rateCardVersions`.

### `benefit_validations`
Append-style history of Finance decisions: `project_id`, `benefit_id`, `status` (finance_validated / realized / rejected), `previous_status`, `validated_by`, `comment`, `project_version` (version created by the decision), `created_at`. The current status lives in `projects.data.value.benefits[].status/validatedBy/validatedOn`.

### `process_templates`
Custom intake templates: `id` text pk (= `data->>'id'`), `name`, `business_function`, `process`, `data jsonb` (engine `ProcessTemplate`), `created_by`, `updated_by`, timestamps. Built-in templates come from the engine and are not stored.

### `audit_log` (append-only)
| Column | Type | Notes |
| --- | --- | --- |
| id | bigserial pk | |
| at | timestamptz | |
| user_id, user_email, role | | acting principal (copies; no FK). Failed logins record the attempted email. |
| action | text | e.g. `project.update`, `benefit.validate`, `auth.login`, `catalog.model_rate.update` |
| outcome | text | success, denied (401/403/429), failure (4xx), error (5xx) |
| status_code | int | HTTP status for non-success rows |
| entity_type, entity_id, project_id | text | |
| detail | jsonb | compact: version numbers, changed top-level keys, status transitions, error code (≤ 8 KB) |
| ip | text | client IP (honours `TRUST_PROXY`) |

Indexes: `(at desc)`, `(project_id, id desc)`, `(user_id, id desc)`, `(action, id desc)`.

## Relationships

```
users ─┬─< projects >── clients
       │      ├─< project_versions
       │      ├─< scenarios
       │      ├─< actuals
       │      ├─< rate_card_versions
       │      └─< benefit_validations
       ├─< model_rates / cloud_price_items / fx_rates (created_by)
       ├─< acu_weight_sets (created_by, approved_by)
       └─< process_templates
audit_log (no FKs — survives everything)
```
