-- ─────────────────────────────────────────────────────────────────────────────
-- Enterprise AI Economics & Commercialization Studio — initial schema
-- Target: PostgreSQL 16 (also runs unchanged on PGlite for dev/tests).
--
-- Conventions
--  * Money, rates and quantities are `numeric` (never float).
--  * Timestamps are `timestamptz`.
--  * Engine objects (Project, ModelRate, …) are stored verbatim as `jsonb`;
--    columns next to them are denormalised copies for filtering/indexing.
--  * Rate tables are versioned: the current row has effective_to IS NULL;
--    an update closes it (effective_to = now()) and inserts a new row.
--  * audit_log is append-only (enforced by trigger); project_versions rows
--    are immutable.
-- The migration runner wraps this file in a transaction.
-- ─────────────────────────────────────────────────────────────────────────────

-- Shared trigger functions ----------------------------------------------------

CREATE FUNCTION aies_reject_modification() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% is append-only: % is not allowed', TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'insufficient_privilege';
END;
$$;

CREATE FUNCTION aies_touch_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

-- Users -----------------------------------------------------------------------

CREATE TABLE users (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  email         text        NOT NULL UNIQUE CHECK (email = lower(email) AND position('@' IN email) > 1),
  name          text        NOT NULL,
  role          text        NOT NULL CHECK (role IN ('admin', 'consultant', 'architect', 'engineering', 'finance', 'executive')),
  password_hash text        NOT NULL,
  active        boolean     NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  last_login_at timestamptz
);
CREATE TRIGGER users_touch BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION aies_touch_updated_at();

-- Clients ---------------------------------------------------------------------

CREATE TABLE clients (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text        NOT NULL CHECK (length(trim(name)) > 0),
  industry   text,
  geography  text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX clients_name_key ON clients (lower(name));
CREATE TRIGGER clients_touch BEFORE UPDATE ON clients FOR EACH ROW EXECUTE FUNCTION aies_touch_updated_at();

-- Projects & versions ---------------------------------------------------------

CREATE TABLE projects (
  id              text        PRIMARY KEY CHECK (id ~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$'),
  client_id       uuid        REFERENCES clients (id) ON DELETE SET NULL,
  name            text        NOT NULL,
  status          text        NOT NULL CHECK (status IN ('pre_sales', 'in_delivery', 'live')),
  currency        text        NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  owner_id        uuid        REFERENCES users (id) ON DELETE SET NULL,
  current_version integer     NOT NULL DEFAULT 1 CHECK (current_version >= 1),
  -- The engine `Project` object (single source of truth for calculations).
  data            jsonb       NOT NULL CHECK (jsonb_typeof(data) = 'object'),
  created_by      uuid        REFERENCES users (id) ON DELETE SET NULL,
  updated_by      uuid        REFERENCES users (id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  deleted_at      timestamptz,
  CONSTRAINT projects_data_id_matches CHECK (data ->> 'id' = id)
);
CREATE INDEX projects_active_updated_idx ON projects (updated_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX projects_client_idx ON projects (client_id);
CREATE INDEX projects_owner_idx ON projects (owner_id);
CREATE INDEX projects_status_idx ON projects (status) WHERE deleted_at IS NULL;

CREATE TABLE project_versions (
  project_id text        NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  version    integer     NOT NULL CHECK (version >= 1),
  data       jsonb       NOT NULL CHECK (jsonb_typeof(data) = 'object'),
  author_id  uuid        REFERENCES users (id) ON DELETE SET NULL,
  comment    text,
  -- Top-level sections that changed relative to the previous version.
  changed    text[]      NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, version)
);
CREATE INDEX project_versions_author_idx ON project_versions (author_id);
CREATE TRIGGER project_versions_immutable BEFORE UPDATE ON project_versions
  FOR EACH ROW EXECUTE FUNCTION aies_reject_modification();

-- Scenarios (versioned per project + scenario name) ----------------------------

CREATE TABLE scenarios (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id      text        NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  name            text        NOT NULL CHECK (length(trim(name)) > 0),
  version         integer     NOT NULL CHECK (version >= 1),
  overrides       jsonb       NOT NULL CHECK (jsonb_typeof(overrides) = 'object'),
  -- ScenarioMetrics computed at save time (Decimals serialised as strings).
  metrics         jsonb,
  -- Project version the metrics were computed against.
  project_version integer     NOT NULL,
  comment         text,
  author_id       uuid        REFERENCES users (id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT scenarios_name_version_key UNIQUE (project_id, name, version)
);
CREATE INDEX scenarios_author_idx ON scenarios (author_id);

-- Actuals (post-deployment monitoring) ---------------------------------------

CREATE TABLE actuals (
  project_id       text        NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  period           text        NOT NULL CHECK (period ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  workflow_id      text        NOT NULL,
  month_index      integer     NOT NULL CHECK (month_index >= 0),
  attempted        numeric     NOT NULL DEFAULT 0 CHECK (attempted >= 0),
  accepted         numeric     NOT NULL DEFAULT 0 CHECK (accepted >= 0),
  input_tokens     bigint      NOT NULL DEFAULT 0 CHECK (input_tokens >= 0),
  output_tokens    bigint      NOT NULL DEFAULT 0 CHECK (output_tokens >= 0),
  llm_cost         numeric     NOT NULL DEFAULT 0,
  non_llm_cost     numeric     NOT NULL DEFAULT 0,
  realized_benefit numeric     NOT NULL DEFAULT 0,
  currency         text        NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  updated_by       uuid        REFERENCES users (id) ON DELETE SET NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, period, workflow_id)
);
CREATE TRIGGER actuals_touch BEFORE UPDATE ON actuals FOR EACH ROW EXECUTE FUNCTION aies_touch_updated_at();

-- Versioned catalogue: model rates -------------------------------------------

CREATE TABLE model_rates (
  id             bigserial   PRIMARY KEY,
  rate_key       text        NOT NULL,
  version        integer     NOT NULL CHECK (version >= 1),
  data           jsonb       NOT NULL CHECK (jsonb_typeof(data) = 'object' AND data ->> 'id' = rate_key),
  provider       text        GENERATED ALWAYS AS (data ->> 'provider') STORED,
  currency       text        GENERATED ALWAYS AS (data ->> 'currency') STORED,
  input_per_m    numeric     GENERATED ALWAYS AS ((data ->> 'inputPerM')::numeric) STORED,
  output_per_m   numeric     GENERATED ALWAYS AS ((data ->> 'outputPerM')::numeric) STORED,
  effective_from timestamptz NOT NULL DEFAULT now(),
  effective_to   timestamptz,
  created_by     uuid        REFERENCES users (id) ON DELETE SET NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT model_rates_key_version UNIQUE (rate_key, version),
  CONSTRAINT model_rates_period CHECK (effective_to IS NULL OR effective_to >= effective_from)
);
CREATE UNIQUE INDEX model_rates_current_key ON model_rates (rate_key) WHERE effective_to IS NULL;

-- Versioned catalogue: cloud / service price items ----------------------------

CREATE TABLE cloud_price_items (
  id             bigserial   PRIMARY KEY,
  rate_key       text        NOT NULL,
  version        integer     NOT NULL CHECK (version >= 1),
  data           jsonb       NOT NULL CHECK (jsonb_typeof(data) = 'object' AND data ->> 'id' = rate_key),
  category       text        GENERATED ALWAYS AS (data ->> 'category') STORED,
  currency       text        GENERATED ALWAYS AS (data ->> 'currency') STORED,
  unit_cost      numeric     GENERATED ALWAYS AS ((data ->> 'unitCost')::numeric) STORED,
  effective_from timestamptz NOT NULL DEFAULT now(),
  effective_to   timestamptz,
  created_by     uuid        REFERENCES users (id) ON DELETE SET NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT cloud_price_items_key_version UNIQUE (rate_key, version),
  CONSTRAINT cloud_price_items_period CHECK (effective_to IS NULL OR effective_to >= effective_from)
);
CREATE UNIQUE INDEX cloud_price_items_current_key ON cloud_price_items (rate_key) WHERE effective_to IS NULL;
CREATE INDEX cloud_price_items_category_idx ON cloud_price_items (category) WHERE effective_to IS NULL;

-- Versioned catalogue: FX (one row per currency; the current table is effective_to IS NULL)

CREATE TABLE fx_rates (
  id             bigserial      PRIMARY KEY,
  base           text           NOT NULL CHECK (base ~ '^[A-Z]{3}$'),
  currency       text           NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  -- Units of `currency` per 1 unit of `base`.
  rate           numeric(24,10) NOT NULL CHECK (rate > 0),
  as_of          date           NOT NULL,
  source         text           NOT NULL,
  effective_from timestamptz    NOT NULL DEFAULT now(),
  effective_to   timestamptz,
  created_by     uuid           REFERENCES users (id) ON DELETE SET NULL,
  created_at     timestamptz    NOT NULL DEFAULT now(),
  CONSTRAINT fx_rates_period CHECK (effective_to IS NULL OR effective_to >= effective_from)
);
CREATE UNIQUE INDEX fx_rates_current_currency ON fx_rates (currency) WHERE effective_to IS NULL;
CREATE INDEX fx_rates_history_idx ON fx_rates (currency, effective_from DESC);

-- ACU weight sets (draft → approved → retired) --------------------------------

CREATE TABLE acu_weight_sets (
  id          text        NOT NULL,
  version     text        NOT NULL CHECK (length(version) BETWEEN 1 AND 32),
  status      text        NOT NULL CHECK (status IN ('draft', 'approved', 'retired')),
  data        jsonb       NOT NULL CHECK (jsonb_typeof(data) = 'object'),
  created_by  uuid        REFERENCES users (id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  approved_by uuid        REFERENCES users (id) ON DELETE SET NULL,
  approved_at timestamptz,
  PRIMARY KEY (id, version)
);
-- At most one approved version per weight set.
CREATE UNIQUE INDEX acu_weight_sets_one_approved ON acu_weight_sets (id) WHERE status = 'approved';

-- Project rate-card versions (draft → approved → superseded) ------------------

CREATE TABLE rate_card_versions (
  project_id      text        NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  version         integer     NOT NULL CHECK (version >= 1),
  status          text        NOT NULL CHECK (status IN ('draft', 'approved', 'superseded')),
  -- { rateCard: RateCardVersion, currency, streams: StreamPrice[] }
  data            jsonb       NOT NULL CHECK (jsonb_typeof(data) = 'object'),
  note            text,
  project_version integer     NOT NULL,
  created_by      uuid        REFERENCES users (id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  approved_by     uuid        REFERENCES users (id) ON DELETE SET NULL,
  approved_at     timestamptz,
  PRIMARY KEY (project_id, version),
  CONSTRAINT rate_card_versions_approval CHECK (status = 'draft' OR approved_at IS NOT NULL)
);
CREATE UNIQUE INDEX rate_card_versions_one_approved ON rate_card_versions (project_id) WHERE status = 'approved';

-- Benefit validation decisions (history; the project JSON holds the current status)

CREATE TABLE benefit_validations (
  id              bigserial   PRIMARY KEY,
  project_id      text        NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  benefit_id      text        NOT NULL,
  status          text        NOT NULL CHECK (status IN ('proposed', 'finance_validated', 'realized', 'rejected')),
  previous_status text,
  validated_by    uuid        REFERENCES users (id) ON DELETE SET NULL,
  comment         text,
  project_version integer     NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX benefit_validations_lookup_idx ON benefit_validations (project_id, benefit_id, created_at DESC);

-- Custom process templates ------------------------------------------------------

CREATE TABLE process_templates (
  id                text        PRIMARY KEY CHECK (id ~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$'),
  name              text        NOT NULL,
  business_function text,
  process           text,
  data              jsonb       NOT NULL CHECK (jsonb_typeof(data) = 'object' AND data ->> 'id' = id),
  created_by        uuid        REFERENCES users (id) ON DELETE SET NULL,
  updated_by        uuid        REFERENCES users (id) ON DELETE SET NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER process_templates_touch BEFORE UPDATE ON process_templates FOR EACH ROW EXECUTE FUNCTION aies_touch_updated_at();

-- Audit log (append-only) ---------------------------------------------------------

CREATE TABLE audit_log (
  id          bigserial   PRIMARY KEY,
  at          timestamptz NOT NULL DEFAULT now(),
  -- No FK: audit rows must outlive users and record attempts by unknown principals.
  user_id     uuid,
  user_email  text,
  role        text,
  action      text        NOT NULL,
  outcome     text        NOT NULL DEFAULT 'success' CHECK (outcome IN ('success', 'denied', 'failure', 'error')),
  status_code integer,
  entity_type text,
  entity_id   text,
  project_id  text,
  detail      jsonb       NOT NULL DEFAULT '{}'::jsonb,
  ip          text
);
CREATE INDEX audit_log_at_idx ON audit_log (at DESC);
CREATE INDEX audit_log_project_idx ON audit_log (project_id, id DESC) WHERE project_id IS NOT NULL;
CREATE INDEX audit_log_user_idx ON audit_log (user_id, id DESC);
CREATE INDEX audit_log_action_idx ON audit_log (action, id DESC);
CREATE TRIGGER audit_log_append_only BEFORE UPDATE OR DELETE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION aies_reject_modification();
