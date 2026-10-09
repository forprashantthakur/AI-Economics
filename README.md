# Enterprise AI Economics & Commercialization Studio

**AI Project Costing | ACU & ABU Metering | Commercial Pricing | ROI & Value Realization**

A workbench for consulting teams that design, price and run enterprise AI agents. It estimates what an AI project costs to build and to run, meters consumption in AI Consumption Units (ACU) and business outcomes in AI Business Units (ABU), prices the work under different commercial models, and measures the return to the client. Each figure comes from one deterministic calculation engine, so every page, dashboard and report shows the same numbers.

> **Illustrative data. Replace it before any client use.**
> Every rate in the default catalogue is a sample, not a vendor quote or market price. This includes model token prices, FX rates, cloud and service prices, and AgentOps staff costs. The three sample projects and their client names are fictitious. Replace the rates with contracted or published rates, and record their sources and effective dates, before using any output with a client.
>
> **The ACU is a proposed commercial abstraction**, defined by this product. It is not an industry standard, and one ACU is not one token. See [docs/METHODOLOGY.md](docs/METHODOLOGY.md#8-ai-consumption-units-acu).

## What it does

### Modules

| # | Module | What it does |
|---|---|---|
| 1 | Project intake and process templates | Turns a client conversation and one of 23 process templates into a complete, computable project. |
| 2 | Implementation cost estimator | Builds effort by role and phase with a dependency schedule, expenses and contingency, priced at cost plus margin or time and materials. |
| 3 | LLM tokenomics | Costs every agent step per model route, with three cache-billing semantics, reasoning tokens, batch discounts and self-hosted GPU rates. |
| 4 | Execution cost model | Costs orchestration, RAG, document processing, infrastructure, AgentOps and human review, then allocates them to workflows, agents and business functions. |
| 5 | ACU calculator and rate card | Meters AI consumption by cost-normalised or weighted-resource ACUs and sets the price per ACU, tiers, floors and commitments. |
| 6 | ABU calculator and pricing | Models the transaction funnel and prices each accepted, complexity-weighted business outcome. |
| 7 | Commercial pricing | Combines revenue streams with a cost-recovery matrix that blocks double billing, and compares seven commercial models. |
| 8 | Value realisation and ROI | Separates non-cash productivity from finance-validated benefits, and calculates client ROI, NPV and payback. |
| 9 | Scenario simulator | Runs what-if changes at locked or repriced rates, with presets, a cost waterfall, sensitivity analysis and break-even volume. |
| 10 | Post-deployment monitoring | Compares actuals with the estimate month by month and measures cost optimisation opportunities. |

The seven commercial models are fixed fee, ACU consumption, ABU transaction, subscription, managed AgentOps, outcome-based gainshare and hybrid.

### Dashboards

| Dashboard | Audience and content |
|---|---|
| Commercial & sales | Revenue, margin, rate card, margin by revenue stream, and the seven commercial models compared |
| Solution architect | Cost by architecture layer and agent, model cost comparison, token estimates by step, infrastructure |
| AI FinOps | Cost by model and agent, budget variance against actuals, optimisation opportunities |
| Client value | Client cash position over the term, productivity against cash benefits, the benefit register, adoption, outcome KPIs, and realised against forecast benefits |

The dashboard also has a portfolio summary and a reconciliation view. A **Reports** page exports eight client-ready reports as PDF and PowerPoint, plus an Excel model that rebuilds the numbers with live formulas.

## Quick start

Requires Node.js 22.12 or later and npm.

```bash
npm install
npm run dev:api        # API on http://localhost:8080 with an embedded database, seeded with demo data
npm run dev            # web app on http://localhost:5173
```

The web app works on its own in the browser, with no API needed. To use the API, open **Settings → Data → Connect to the studio server**, leave the server address empty, and sign in as `admin@demo.local` with the password `ChangeMe!2026` (or the value of `SEED_PASSWORD`).

To run the full stack with PostgreSQL in Docker:

```bash
POSTGRES_PASSWORD='change-me' JWT_SECRET="$(openssl rand -base64 48)" docker compose up -d --build   # http://localhost:8081
```

See [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) for configuration, production deployment and security.

## Repository layout

| Path | Contents |
|---|---|
| `packages/engine` | The calculation engine (TypeScript, decimal.js): cost model, ACU/ABU metering, pricing, projection, value and ROI, scenarios, validation, reconciliation, RBAC, sample catalogue, templates and sample projects |
| `packages/reports` | The eight reports: Excel model with live formulas, PDF and PowerPoint |
| `apps/web` | React web app (Vite, Tailwind CSS) with every module page, the dashboards and the reports page |
| `apps/api` | Fastify API: authentication, RBAC, project versioning, catalogue history, actuals, scenarios, rate cards and audit log |
| `db` | PostgreSQL migrations (`db/migrations`) and schema documentation |
| `docs` | Methodology, sample projects, glossary and deployment guide |
| `scripts` | Build and tooling scripts, including the single-file demo packager |

## Architecture

- **One shared engine.** All calculations live in `packages/engine`, a deterministic TypeScript library with no network or AI-model calls. The web app runs it in the browser, the API runs it on the server, and the reports package reads its results, so a figure is the same everywhere.
- **Decimal arithmetic.** Money and unit prices use decimal.js at 34 significant digits, never binary floating point.
- **Compute once, then allocate.** Each cost is calculated once and then allocated to workflows, agents, business functions, cost pools and revenue streams, so every breakdown adds up to the same total.
- **Reconciliation checks.** Each result carries up to 22 reconciliation checks that prove this, for example that cost by pool, by workflow and by agent each equal total run cost, and that monthly and yearly revenue each equal total contract value.
- **Storage.** The web app keeps data in browser storage when used on its own. When connected to the API, projects are stored in PostgreSQL as versioned JSON documents with optimistic concurrency and an append-only audit log.

## Testing

```bash
npm test
```

| Suite | Tests |
|---|---:|
| Engine (`packages/engine`) | 92 |
| Reports (`packages/reports`), including a LibreOffice recalculation of the Excel model, skipped when LibreOffice is not installed | 43 |
| API (`apps/api`), on embedded PGlite or a real PostgreSQL | 27 |
| **Total** | **162** |

## Documentation

- [docs/METHODOLOGY.md](docs/METHODOLOGY.md): the calculation methodology, with formulas, worked examples and known limitations
- [docs/SAMPLE_PROJECTS.md](docs/SAMPLE_PROJECTS.md): the three illustrative sample projects and their computed results
- [docs/GLOSSARY.md](docs/GLOSSARY.md): definitions of ACU, ABU, cost pools, TCV, payback and other terms
- [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md): local development, Docker Compose, production deployment, security checklist and upgrades
- [apps/api/README.md](apps/api/README.md): API endpoints, authentication, permissions and environment variables
- [db/schema.md](db/schema.md): database tables and conventions
