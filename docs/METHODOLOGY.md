# Calculation methodology

This is the reference for how the Enterprise AI Economics & Commercialization Studio calculates cost, consumption, price, revenue and client value. It describes what the deterministic engine in `packages/engine/src` does today. It does not describe planned features. Each formula names the source file and function that implements it.

Worked examples use the illustrative **Accounts Payable Agent** sample (`samples/index.ts › accountsPayable()`), computed with the default sample catalogue (`catalog/index.ts › defaultCatalog()`). Amounts are in INR unless stated otherwise. They are rounded here for readability only; the engine keeps full precision. Every number in this document came from running the engine (see [Appendix A](#appendix-a-reproducing-the-numbers)).

> **Illustrative data.** The sample projects, client names and every rate in the default catalogue (model token prices, FX rates, cloud prices, AgentOps salaries) are fictitious. They are not vendor quotes or market prices. Replace them with contracted or published rates before quoting to a client.

Related documents: [SAMPLE_PROJECTS.md](SAMPLE_PROJECTS.md) (the three sample projects) and [GLOSSARY.md](GLOSSARY.md) (definitions).

## Contents

1. [Principles](#1-principles)
2. [Units and conventions](#2-units-and-conventions)
3. [Calculation sequence](#3-calculation-sequence)
4. [Transaction funnel](#4-transaction-funnel)
5. [LLM tokenomics](#5-llm-tokenomics)
6. [Non-LLM execution costs and human review](#6-non-llm-execution-costs-and-human-review)
7. [Cost pools, allocation and failure cost](#7-cost-pools-allocation-and-failure-cost)
8. [AI Consumption Units (ACU)](#8-ai-consumption-units-acu)
9. [Implementation estimate](#9-implementation-estimate)
10. [Pricing engine](#10-pricing-engine)
11. [The seven commercial constructs](#11-the-seven-commercial-constructs)
12. [Contract-term projection](#12-contract-term-projection)
13. [Value realisation and client ROI](#13-value-realisation-and-client-roi)
14. [Scenario simulator](#14-scenario-simulator)
15. [Optimisation finder](#15-optimisation-finder)
16. [Actuals variance analysis](#16-actuals-variance-analysis)
17. [Validation and double-count detection](#17-validation-and-double-count-detection)
18. [Reconciliation checks](#18-reconciliation-checks)
19. [Role-based access control](#19-role-based-access-control)
20. [Known limitations and modelling assumptions](#20-known-limitations-and-modelling-assumptions)
- [Appendix A: reproducing the numbers](#appendix-a-reproducing-the-numbers)

---

## 1. Principles

### 1.1 Decimal-safe arithmetic

Source: `decimal.ts`.

- All monetary and unit-price arithmetic uses [decimal.js](https://github.com/MikeMcl/decimal.js) (base-10, arbitrary precision). It is configured once with `precision: 34` significant digits and `ROUND_HALF_UP` rounding (`decimal.ts:12`).
- Project inputs are plain JSON numbers so projects serialise cleanly. `D()` lifts each input into a `Decimal` at the point of use. `null`, `undefined`, `NaN` and infinite numbers become 0.
- `safeDiv(a, b)` returns 0 when `b` is 0, so no result can be `Infinity` or `NaN`.
- `money()` rounds to 2 decimal places and is used only for presentation and invoices, never part-way through a calculation. `num()` converts to a JavaScript number for charts.
- A `Decimal` serialises to a string through `toJSON()`, so API responses keep full precision.

Shared helpers used throughout this document:

```
pct(v)                  = v / 100
priceForMargin(c, m)    = c / (1 − m/100)                    (throws if m ≥ 100)
priceAtMargin(c, m)     = priceForMargin(c, min(m, 99))      (MAX_MARGIN_PCT = 99)
marginPct(rev, cost)    = (rev − cost) / rev × 100           (0 when rev = 0)
compound(r, n)          = (1 + r/100)^n
```

Every engine price calculation (implementation, ACU, ABU, fees, subscription allowances, margin floors) uses `priceAtMargin()`. A target margin or margin floor of 100% or more is therefore applied as 99% instead of failing the calculation, and validation reports it as a `MARGIN_RANGE` error ([section 17](#17-validation-and-double-count-detection)).

**Where JavaScript numbers still appear.** These values pass through binary floating point before being lifted into `Decimal`. None of them is a money amount, but they do feed money calculations:

- the ramp factor from `rampFactorFor()` (for example, month 2 of a 3-month ramp from 50% is `0.6666666666666666`, so month-2 attempted volume is `33333.33333333333`)
- the scenario multipliers that `applyScenario()` applies to the project's inputs (volume, tokens, retry rate, complexity shares, routing shares)
- the break-even multiplier search, the payback result (a `number`), and the values returned by the cost waterfall and the sensitivity analysis
- the input range checks in `validateProject()`

### 1.2 Compute once, then allocate

Source: `model.ts › buildSnapshot()`.

Each cost is calculated exactly once:

- one LLM line per workflow step and model route
- one result per configured non-LLM cost line
- one human-review amount per workflow

Breakdowns by workflow, agent, business function, cost pool and model are then produced by *allocating* those results, never by recalculating them. Every breakdown therefore sums to the same total. The reconciliation checks in [section 18](#18-reconciliation-checks) prove this for each project.

### 1.3 One result object

Source: `compute.ts › computeProject()`.

`computeProject(project, catalog)` runs every module in a fixed order (see [section 3](#3-calculation-sequence)) and returns one `ProjectResult`. It holds:

- the implementation estimate
- the steady-state run snapshot
- the price book
- the monthly projection and yearly roll-ups
- provider and client economics
- the seven commercial packages
- the issues list and the reconciliation checks

By design, dashboards, reports and exports read from this object instead of recalculating. A few dashboard views also call other deterministic engine functions on the same project: `varianceAnalysis()`, `findOptimizations()`, and `buildSnapshot()` on a copy of the project with scenario changes applied.

### 1.4 No LLM in the calculations

The engine package makes no network calls and no model calls. Every result is a pure function of the project and the catalogue. AI features elsewhere in the product cannot change a calculated figure. The only non-deterministic code in the package creates identifiers and a default go-live date in `templates.ts › uid()` and `createProjectFromIntake()`. Neither is used in any calculation.

### 1.5 Sample rates are illustrative

Every default catalogue entry sets `sample: true`, and its `source` reads "ILLUSTRATIVE SAMPLE RATE — not a vendor quote". Model names are tier labels such as "Claude Sonnet-class" rather than specific versions. When any routed model is a sample rate, `validateProject()` raises the `SAMPLE_RATES` information issue.

---

## 2. Units and conventions

| Convention | Rule | Source |
|---|---|---|
| Percentages | Entered 0–100 (for example `successRatePct: 94`), converted with `pct()`. | `types.ts` header, `decimal.ts › pct()` |
| Token prices | Per 1,000,000 tokens (input, output, reasoning, cache read, cache write). | `types.ts › ModelRate` |
| ACU resource units | Each resource has a scale: tokens per 1M, calls per 1K, pages per 1K, GPU-hours, GB-months, events per 1K. | `acu.ts › ACU_RESOURCES` |
| Currency | Every money input carries its own currency and is converted to the project's reporting currency with a single-base FX table. | `fx.ts › convert()` |
| Months | Month 0 is the implementation month. Months 1…T are run months, where T = `termMonths` and month 1 is the go-live month. | `projection.ts › buildContext()` |
| Contract year | `yearIndex = floor((month − 1) / 12)`, so months 1–12 are year index 0, 13–24 are 1, 25–36 are 2. Month 0 is counted in year 1. | `model.ts › yearIndexFor()` |
| Gross margin | `margin% = (revenue − cost) / revenue × 100`. A price at target margin m is `cost / (1 − m)`. | `decimal.ts` |

### 2.1 Currency conversion

Source: `fx.ts › convert()`.

The FX table has one base currency, and each rate is "units of currency per 1 unit of base". A conversion always goes through the base:

```
convert(amount, from, to) = amount / rate[from] × rate[to]
```

The base currency is treated as rate 1 even if it is missing from the table. Called directly, `convert()` throws `FxError` for a missing or non-positive rate. Because cross rates are derived through the base, A → B → A round-trips exactly up to decimal precision; the tests check this. One FX table applies to the whole contract term, so the projection has no FX movement.

**Missing rates.** `validate.ts › currenciesUsed()` collects every currency the project refers to:

- the project and ACU reference currencies
- the routed models and linked price items
- cost lines, roles and direct expenses
- human review, productivity, benefits and client costs
- actuals

Before calculating, `compute.ts › withFxFallback()` gives any of these that has no FX rate a rate of 1, so it is treated 1:1 with the base currency and the calculation completes. `validateProject()` reports each one as an `FX_MISSING` error, so the figures should not be used until the rate is added. The fallback applies inside `computeProject()` and therefore also inside `runScenario()` and `sensitivity()`. It does not apply to `costWaterfall()`, `findOptimizations()` or `breakEven()`, which still throw `FxError` ([section 20](#20-known-limitations-and-modelling-assumptions)).

The sample table (`catalog/index.ts › SAMPLE_FX`, as of 2026-09-30, illustrative) uses USD as the base: INR 88, EUR 0.86, GBP 0.75, AUD 1.52, SGD 1.30, AED 3.6725, JPY 148.

### 2.2 Three separate time indices

| Index | Applies to | Formula | Source |
|---|---|---|---|
| Cost inflation (`costInflationPct`) | Non-LLM cost-line unit costs, shared platform totals, the human-review hourly rate, client monthly costs, the productivity hourly rate, and benefit lines other than revenue | `compound(costInflationPct, yearIndex)` | `model.ts`, `value.ts` |
| LLM price change (`llmPriceChangePct`) | Every model rate, including the per-call charge and self-hosted derived rates | `compound(llmPriceChangePct, yearIndex)` | `model.ts`, `llm.ts › effectiveRates()` |
| Price escalation (`priceEscalationPct`) | Contracted unit prices, fees, allowances and commitments from contract year 2 onwards (see [10.12](#1012-escalation-and-the-price-multiplier)) | `compound(priceEscalationPct, yearIndex)` | `pricing.ts › revenueForMonth()` |

All three step once a year; none compounds monthly. The sample projects use 4% cost inflation, 0% LLM price change and 4% price escalation.

---

## 3. Calculation sequence

`compute.ts › computeProject()`:

0. **FX fallback.** `withFxFallback()` adds a temporary 1:1 rate for any currency the project uses that has no rate ([2.1](#21-currency-conversion)). Validation still runs against the original catalogue.
1. **Implementation estimate.** `computeImplementation()` produces labour, expenses, contingency, total cost, price and schedule ([section 9](#9-implementation-estimate)).
2. **Projection context.** `buildContext()`:
   - builds the **baseline snapshot**: one month at ramp 1 in contract year 1 (`rampFactor = 1`, `yearIndex = 0`)
   - sets the volume base for volume-scaled benefits: `opts.benefitVolumeBase` if supplied (scenarios pass the original project's volume), otherwise the baseline's attempted volume
   - computes the steady-state value month
   - builds one snapshot for every month 0…T. Snapshots are cached by `(rampFactor, yearIndex)`, so identical months share one calculation.
3. **Marginal costs.** `marginalCosts()` builds a second snapshot at `rampFactor = 1.01` and divides the change in run cost by the change in ACUs and in weighted ABUs.
4. **Price book.** `buildPriceBook()` derives unit prices and fees from the baseline snapshot. If a contracted price book is supplied in `opts.priceBook`, it is used instead and nothing is repriced.
5. **Projection.** `runProjection()` bills each month at the locked prices against that month's volumes and costs, then rolls up years and economics.
6. **Commercial packages.** `computePackages()` reprices the same cost base under seven commercial constructs ([section 11](#11-the-seven-commercial-constructs)).
7. **Issues.** These are combined into one list, de-duplicated on code and message:
   - `validateProject()` issues
   - price-book issues
   - snapshot warnings (code `MODEL`)
   - schedule errors (code `SCHEDULE`)
8. **Reconciliation.** `reconcile()` adds the integrity checks.

---

## 4. Transaction funnel

Source: `model.ts › workflowVolumes()`. The funnel is calculated per workflow for each snapshot.

### 4.1 Volume factor

```
volumeFactor = rampFactor × compound(annualGrowthPct, yearIndex)
attempted    = monthlyVolume × volumeFactor
```

`monthlyVolume` counts **unique business transactions attempted per month**. Retries are not new transactions.

### 4.2 Funnel formulas

| Quantity | Formula |
|---|---|
| Completed | `attempted × successRate` |
| Failed | `attempted − completed` |
| Accepted | `completed × acceptanceRate` |
| Rejected | `completed − accepted` |
| Human-assisted | `accepted × humanInterventionRate` |
| Autonomous | `accepted − humanAssisted` |
| Retries | `attempted × retryRate` |
| Executions | `attempted + retries` |
| Execution equivalents | `completed + failed × failedConsumption + retries × retryConsumption` |
| LLM calls | `Σ steps(callsPerExecution × routeShare) × executionEquivalents` (summed from the LLM lines) |
| Tool calls | `executions × toolCallsPerExecution` |

The identity `accepted + rejected + failed = attempted` always holds, and is reconciliation check `funnel`.

**Execution equivalents** convert the transactions into units of "one full execution's worth of consumption":

- A completed execution counts as 1.
- A failed execution counts as `failedConsumptionPct`.
- Each retry counts as `retryConsumptionPct`.

LLM consumption and `per_llm_call` cost lines are driven by execution equivalents. `per_execution` cost lines are driven by raw executions (see [6.2](#62-cost-bases)).

### 4.3 Complexity classes and weighted ABUs

Each workflow may define complexity classes. Each class has:

- a mix share
- an **ABU weight**
- a **consumption multiplier**, applied to LLM tokens and to complexity-scaled cost lines
- a **human-effort multiplier**, applied to review minutes
- an optional price override

The engine normalises the shares to sum to 1. If they sum to 0, each class gets an equal share.

```
share_c          = sharePct_c / Σ sharePct
consumptionMix   = Σ share_c × consumptionMultiplier_c
humanEffortMix   = Σ share_c × humanEffortMultiplier_c

accepted_c       = accepted × share_c
humanAssisted_c  = humanAssisted × share_c
autonomous_c     = accepted_c − humanAssisted_c
weightedABUs_c   = accepted_c × abuWeight_c
weightedABUs     = Σ weightedABUs_c
```

A workflow with no classes behaves as one "Standard" class with weight 1.

### 4.4 Why retries never create ABUs

ABUs are earned only by **accepted** transactions. Accepted is derived from `attempted` (the unique business transactions) through the success and acceptance rates. Retries add executions and consumption: execution equivalents, LLM calls, `per_execution` costs and tool calls. They never add attempted, completed or accepted transactions. A transaction that succeeds on its second try is one accepted ABU that cost more to produce. That extra cost is real and appears in cost per ABU, but the client is never billed twice for one business outcome.

Failed and rejected transactions also earn no ABUs. How their cost is recovered is set by `failedCostAllocation` (see [10.6](#106-abu-price)).

### 4.5 Worked example: Accounts Payable Agent, steady month

Inputs:

- 50,000 invoices a month
- success 94%, acceptance 97%, retry 8%, human intervention 12%
- retry consumption 60%, failed consumption 50%
- complexity mix: Simple 60% (weight 1, consumption ×0.8, effort ×0.7), Medium 30% (1.5, ×1.2, ×1.2), Complex 10% (3, ×2.0, ×2.0)

| Quantity | Value |
|---|---|
| Attempted | 50,000 |
| Completed (94%) | 47,000 |
| Failed | 3,000 |
| Accepted (97% of completed) | 45,590 |
| Rejected | 1,410 |
| Human-assisted (12% of accepted) | 5,470.8 |
| Autonomous | 40,119.2 |
| Retries (8%) | 4,000 |
| Executions | 54,000 |
| Execution equivalents | 47,000 + 3,000 × 0.5 + 4,000 × 0.6 = **50,900** |
| Consumption mix | 0.6 × 0.8 + 0.3 × 1.2 + 0.1 × 2.0 = **1.04** |
| Human-effort mix | 0.6 × 0.7 + 0.3 × 1.2 + 0.1 × 2.0 = **0.98** |
| Weighted ABUs | 45,590 × (0.6 × 1 + 0.3 × 1.5 + 0.1 × 3) = 45,590 × 1.35 = **61,546.5** |
| LLM calls | 5.15 calls per execution equivalent × 50,900 = 262,135 |
| Tool calls | 54,000 × 6 = 324,000 |

By class: Simple 27,354 accepted (27,354 weighted ABUs); Medium 13,677 accepted (20,515.5); Complex 4,559 accepted (13,677).

---

## 5. LLM tokenomics

Sources: `llm.ts`; the LLM section of `model.ts › buildSnapshot()`.

### 5.1 Effective rates

`effectiveRates(rate, currency, fx, priceFactor)` converts each catalogue rate into the project currency and multiplies it by `priceFactor = compound(llmPriceChangePct, yearIndex)`. This applies to input, output, reasoning, cache-read and cache-write rates and to the per-call charge.

- The reasoning rate defaults to the output rate when it is not set.
- `batchDiscountPct` is a percentage and is not converted.

Example: the sample Sonnet-class rate in INR (USD × 88) is input 264, output 1,320, reasoning 1,320, cache read 26.4 and cache write 330 per 1M tokens, with a 50% batch discount and `read_write` cache semantics.

### 5.2 Cost per call

Source: `llm.ts › callCost()`.

```
inputCost      = uncachedInputTokens / 1M × inputRate
cacheReadCost  = cacheReadTokens     / 1M × cacheReadRate
cacheWriteCost = cacheWriteTokens    / 1M × cacheWriteRate
outputCost     = outputTokens        / 1M × outputRate
reasoningCost  = reasoningTokens     / 1M × reasoningRate
tokenCost      = inputCost + cacheReadCost + cacheWriteCost + outputCost + reasoningCost
batchSaving    = tokenCost × batchEligible% × batchDiscount%
costPerCall    = tokenCost − batchSaving + otherPerCall
```

The batch discount applies only to the batch-eligible share of token charges. It never applies to the flat `otherPerCall` charge, such as grounding or search fees.

### 5.3 Cache billing semantics

Source: `llm.ts › splitInputTokens()`. Each model rate declares one of three provider billing behaviours:

```
cacheable = min(cacheablePrefixTokens, inputTokens)
read      = cacheable × cacheHitRate
```

| Semantics | Cache read tokens | Cache write tokens | Uncached tokens | Meaning |
|---|---|---|---|---|
| `none` | 0 | 0 | input | No prompt caching. Every input token is billed at the input rate. Self-hosted models always use this. |
| `discounted_read` | `read` | 0 | `input − read` | Cache hits are billed at a discounted read rate, with no separate write charge (automatic caching). |
| `read_write` | `read` | `cacheable − read` | `input − cacheable` | Cache hits are billed at the read rate. Misses on the cacheable prefix are billed at the write rate. The rest of the input is billed at the input rate. |

**No-double-count identity.** For every semantics:

```
uncached + cacheRead + cacheWrite = inputTokens
```

Every input token is billed exactly once, at exactly one rate. The tests check this for every semantics and hit rate. It is also reconciliation check `tokens`, summed over all LLM lines. If the cacheable prefix is longer than the input, it is capped at the input and validation raises `PREFIX_GT_INPUT`.

### 5.4 Reasoning tokens

Reasoning ("thinking") tokens per call are billed at the reasoning rate (the output rate by default). They are counted separately from output tokens in the token totals and in ACU Method B, and they are scaled by the complexity consumption multiplier.

### 5.5 Routing shares

Each step routes its traffic across one or more models. The shares are normalised:

```
share_r  = sharePct_r / Σ sharePct
calls_r  = executionEquivalents × callsPerExecution × share_r
```

Shares that do not sum to 100 raise `ROUTING_NOT_100` and are still normalised. A step with no routing, or a model missing from the rate card, produces a `MODEL` warning and no cost for that route.

### 5.6 Complexity consumption multiplier

Tokens per call are scaled by the workflow's mix-weighted `consumptionMix` (section 4.3):

```
inputTokensPerCall     = step.inputTokens     × consumptionMix
outputTokensPerCall    = step.outputTokens    × consumptionMix
reasoningTokensPerCall = step.reasoningTokens × consumptionMix
cacheablePrefixTokens  = step.cacheablePrefixTokens        (not scaled)
```

This is one average applied to every call. Classes are not costed one by one; see [section 20](#20-known-limitations-and-modelling-assumptions).

### 5.7 Line totals

Each LLM line (one step on one model) produces:

```
cost         = costPerCall × calls
inputTokens  = inputTokensPerCall × calls        (and likewise for every token type)
```

LLM cost is then summed by workflow, model and agent. Each step belongs to one agent, so the LLM cost by agent is exact. The summary metrics are:

```
LLM cost per attempted = LLM total / attempted
LLM cost per accepted  = LLM total / accepted
```

### 5.8 Context utilisation

Source: `llm.ts › contextUtilizationPct()`.

```
utilisation% = (inputTokensPerCall + outputTokensPerCall + reasoningTokensPerCall) / contextWindow × 100
```

The snapshot reports this for each LLM line using the mix-average tokens. Validation (`CONTEXT_WINDOW`, warning above 90%) checks the most complex transactions instead. It multiplies the step's tokens by the workflow's highest class consumption multiplier (at least 1):

```
peakUtilisation% = (inputTokens + outputTokens + reasoningTokens) × max(1, max_c consumptionMultiplier_c) / contextWindow × 100
```

### 5.9 Self-hosted model rates

Source: `llm.ts › selfHostedPerM()`. When `pricingBasis = 'self_hosted'`, token rates are derived from GPU economics:

```
costPerHour    = gpuHourlyCost × gpusPerReplica
tokensPerHour  = outputTokensPerSecond × 3600 × utilisation
outputPerM     = costPerHour / tokensPerHour × 1,000,000
inputPerM      = outputPerM × inputCostRatio
reasoningPerM  = outputPerM
```

Self-hosted models get no caching (semantics forced to `none`) and no batch discount. The per-call charge and the LLM price-change factor still apply.

Sample `selfhosted-70b`: 2 GPUs × USD 4/hour = USD 8/hour. The replica sustains 1,500 output tokens/s at 60% utilisation, which is 3.24M tokens/hour. That gives **USD 2.469136 per 1M output tokens** and USD 0.493827 per 1M input tokens (ratio 0.2), or INR 217.28 and 43.46. Because the GPU cost is already inside the token rate, validation raises `GPU_DOUBLE_COUNT` if a GPU cost line also exists.

### 5.10 LLM price change over the years

`llmPriceChangePct` compounds once a year on every model rate. Example: with a −20%/year change on the AP sample, year-2 LLM cost at 56,000 invoices is INR 309,367.69, against INR 386,709.62 at base-year prices. ACU Method A counts do not move with this price change ([8.2](#82-method-a-cost-normalised-at-base-year-reference-prices)).

### 5.11 Worked example: "Extract fields" (AP, Sonnet-class, read_write)

Step inputs: 1 call per execution, 6,000 input tokens, 800 output tokens, 2,000-token cacheable prefix, 70% hit rate.

| Item | Calculation | Value |
|---|---|---|
| Input tokens per call | 6,000 × 1.04 | 6,240 |
| Output tokens per call | 800 × 1.04 | 832 |
| Cacheable | min(2,000, 6,240) | 2,000 |
| Cache read | 2,000 × 70% | 1,400 |
| Cache write | 2,000 − 1,400 | 600 |
| Uncached | 6,240 − 2,000 | 4,240 |
| Cost per call | 4,240 × 264/1M + 1,400 × 26.4/1M + 600 × 330/1M + 832 × 1,320/1M | **INR 2.452560** |
| Calls per month | 50,900 execution equivalents × 1 | 50,900 |
| Monthly cost | 2.452560 × 50,900 | **INR 124,835.30** |

All five AP steps, steady month:

| Step | Model | Calls | Cost per call | Monthly cost |
|---|---|---:|---:|---:|
| Classify document | Haiku-class | 50,900 | 0.139955 | 7,123.72 |
| Extract fields | Sonnet-class | 50,900 | 2.452560 | 124,835.30 |
| Validate & match (tool) | Sonnet-class | 101,800 | 1.198560 | 122,013.41 |
| Exception reasoning (with reasoning tokens) | Opus-class | 7,635 | 10.982400 | 83,850.62 |
| Update system & summarise (tool) | Haiku-class | 50,900 | 0.146432 | 7,453.39 |
| **Total** | | **262,135** | | **345,276.44** |

Totals for the month:

- Input tokens: 831,095,200, made up of 535,875,200 uncached, 187,312,000 cache read and 107,908,000 cache write.
- Output tokens: 112,753,680. Reasoning tokens: 15,880,800.
- LLM cost per attempted invoice: INR 6.9055. Per accepted invoice: INR 7.5735.

---

## 6. Non-LLM execution costs and human review

Source: the cost-line and human-review sections of `model.ts › buildSnapshot()`.

### 6.1 Categories and unit cost

Every non-LLM cost line has a category, and each category maps one-to-one to a cost pool: `ORCHESTRATION`, `RAG`, `DOCUMENT`, `INFRASTRUCTURE`, `AGENTOPS` or `OTHER`.

```
unitCost = convert(item.unitCost or line.unitCost, its currency → project currency) × compound(costInflationPct, yearIndex)
```

- **Linked price items.** If a line has a `priceRef` that matches an item in the catalogue's cloud price table, the item's unit cost, currency and (when the line sets none) ACU resource mapping are used. Catalogue updates therefore flow into every linked line.
- An unknown `priceRef` produces a `MODEL` warning, and the line's own unit cost is used.

### 6.2 Cost bases

| Basis | Monthly units | Driver | Fixed or variable |
|---|---|---|---|
| `fixed_monthly` | `quantity` | none | fixed |
| `allocated_shared` | `allocationPct` share of `sharedTotalMonthly` (converted and inflated) | none | fixed |
| `per_execution` | `executions × quantity × cm` | executions (attempted + retries) | variable |
| `per_attempted` | `attempted × quantity × cm` | attempted transactions | variable |
| `per_accepted` | `accepted × quantity × cm` | accepted transactions | variable |
| `per_llm_call` | `llmCalls × quantity × cm` | LLM calls (from execution equivalents) | variable |

```
monthlyCost = units × unitCost
```

The complexity factor `cm` equals the workflow's `consumptionMix` when `scalesWithComplexity` is true, and 1 otherwise. For `allocated_shared`:

```
monthlyCost = sharedTotalMonthly × allocationPct
```

### 6.3 Workflow assignment and allocation

- **Variable lines** are calculated for each target workflow. If `workflowId` is set, that workflow is the only target; otherwise every workflow is. Each workflow's cost is exact.
- **Fixed and shared lines** assigned to one workflow go wholly to it. Unassigned lines are split across workflows using the line's `workflowAllocation` method. If every weight is 0, the split is equal.

| `workflowAllocation` | Weight for each workflow |
|---|---|
| `by_attempted` | attempted transactions |
| `by_executions` | executions |
| `by_llm_cost` | the workflow's LLM cost |
| `equal` | 1 |

Reconciliation check `cost-lines` confirms that the allocated amounts sum to each line's total.

### 6.4 Worked examples (AP, one line per basis)

Prices are sample USD rates converted at INR 88.

| Line | Basis | Units | Unit cost | Monthly cost |
|---|---|---:|---:|---:|
| Workflow orchestration (state transitions) | per_execution, 0.012 K-transitions per execution | 54,000 × 0.012 = 648 | 2.20 | 1,425.60 |
| OCR & structured field extraction | per_attempted, 2.5 pages, scales with complexity | 50,000 × 2.5 × 1.04 = 130,000 pages | 0.88 | 114,400.00 |
| LLM observability & tracing | per_llm_call, 0.001 K-events per call | 262,135 × 0.001 = 262.135 | 4.40 | 1,153.39 |
| Application hosting | fixed_monthly | 3 node-months | 24,640.00 | 73,920.00 |
| AgentOps L2, incident & prompt fixes | fixed_monthly | 1 FTE-month | 190,000.00 | 190,000.00 |

### 6.5 Human review and exceptions

Source: `model.ts › buildSnapshot()`, the human-review section. Each workflow defines minutes per human-assisted transaction, minutes per rejected transaction (rework), an hourly cost and who bears the effort (`borneBy`).

```
assistedHours = humanAssisted × minutesPerAssistedTxn × humanEffortMix / 60
reworkHours   = rejected × minutesPerRejectedTxn / 60
rate          = convert(hourlyCost) × compound(costInflationPct, yearIndex)
```

| `borneBy` | Provider cost (`HUMAN_REVIEW` pool) | Client time in the value model |
|---|---|---|
| `provider` (part of the managed service) | `(assistedHours + reworkHours) × rate` | Only the client's spot-check minutes on human-assisted transactions |
| `client` (client staff do the review) | 0 | `assistedHours` (review minutes on human-assisted completions), added to the client's after-AI hours |

For client-borne review, the snapshot field `clientReviewHoursByWorkflow` reports `assistedHours + reworkHours`. The value model uses only `assistedHours`, because a rejected transaction is already counted once as a full manual redo ([13.1](#131-productivity-hours-fte-and-value)).

**How this avoids double counting with client productivity.** Review effort is costed once, either as a provider cost or as client time, never both. If the provider bears it, the cost is in the provider's run cost and the client's hours saved are not reduced by it. If the client bears it, there is no provider cost, and the hours reduce the client's productivity gain. Validation raises `REVIEW_DOUBLE_COUNT` when provider-borne review exists and a cost line with component key `human_review` or `exception_handling` also exists.

AP example (provider-borne, 6 minutes per assisted transaction, 8 minutes per rejected one, INR 500/hour):

- assisted hours = 5,470.8 × 6 × 0.98 / 60 = 536.14
- rework hours = 1,410 × 8 / 60 = 188.00
- total = 724.14 hours × INR 500 = **INR 362,069.20**

---

## 7. Cost pools, allocation and failure cost

Source: the pool and allocation sections of `model.ts › buildSnapshot()`.

### 7.1 Pools

| Pool | Content | Recurs monthly |
|---|---|---|
| `IMPLEMENTATION` | One-time implementation cost ([section 9](#9-implementation-estimate)) | no (month 0 only) |
| `LLM` | All LLM lines | yes |
| `ORCHESTRATION`, `RAG`, `DOCUMENT`, `INFRASTRUCTURE`, `AGENTOPS`, `OTHER` | Non-LLM cost lines by category | yes |
| `HUMAN_REVIEW` | Provider-borne review and rework | yes |

```
totalRunCost = Σ run pools
```

`poolsAtBasePrices` holds each run pool divided by its price index: the LLM pool by the LLM price factor, every other pool by cost inflation. Method A ACUs are measured on these ([8.2](#82-method-a-cost-normalised-at-base-year-reference-prices)).

### 7.2 Allocation to workflows, agents and business functions

- **Workflow.** LLM, variable cost lines and human review are already per workflow. Fixed and shared lines are allocated as in [6.3](#63-workflow-assignment-and-allocation).
- **Agent (fully loaded).** Within each workflow, an agent's share is its share of that workflow's LLM cost. That share is applied to the workflow's *entire* run cost, including non-LLM costs:
  ```
  agentShare_a,w   = LLM cost of agent a in workflow w / LLM cost of workflow w
  runCostByAgent_a = Σ_w runCost_w × agentShare_a,w
  ```
  If a workflow has no LLM cost, its agents share equally. Agents with no LLM steps receive no cost.
- **Business function.** Each workflow's run cost is attributed to its `businessFunction`.

Reconciliation checks `workflows`, `agents` and `functions` confirm that each breakdown sums to total run cost.

### 7.3 Failure cost (non-accepted work)

Failure cost is the part of each pool spent on work that did not become an accepted transaction:

- failed executions
- the partial consumption of retries
- the full consumption of completed-but-rejected transactions
- rework

| Cost | Waste fraction |
|---|---|
| LLM, `per_llm_call` lines | `1 − accepted / executionEquivalents` |
| `per_execution` lines | `1 − accepted / executions` |
| `per_attempted` lines | `1 − accepted / attempted` |
| `per_accepted`, `fixed_monthly`, `allocated_shared` lines | 0 |
| Human review | the rework cost only (rejected × rework minutes × rate) |

```
failureCost(pool, workflow) = Σ cost × wasteFraction
```

Failure cost is reported by workflow and pool. It is used by the ABU `provider_absorbs` option ([10.6](#106-abu-price)).

### 7.4 AP pools in a steady month

| Pool | Monthly cost | Share of run cost | Failure cost |
|---|---:|---:|---:|
| LLM | 345,276.44 | 22.81% | 36,020.00 |
| Orchestration | 1,564.36 | 0.10% | 243.63 |
| RAG | 0.00 | 0.00% | 0.00 |
| Document processing | 130,900.00 | 8.65% | 11,545.38 |
| Infrastructure | 179,001.39 | 11.82% | 120.32 |
| AgentOps | 495,000.00 | 32.70% | 0.00 |
| Human review | 362,069.20 | 23.92% | 94,000.00 |
| Other | 0.00 | 0.00% | 0.00 |
| **Total run cost** | **1,513,811.40** | 100% | **141,929.34** |

Run cost per weighted ABU is **INR 24.5962**, and per accepted invoice INR 33.2049.

The LLM waste fraction is 1 − 45,590 / 50,900 = 10.43%, which gives 345,276.44 × 0.1043 = 36,020.00. Human-review failure cost is rework only: 188 hours × INR 500 = 94,000.

Fully loaded run cost by agent:

| Agent | Run cost |
|---|---:|
| Extraction | 547,321.17 |
| Validation & matching | 534,949.00 |
| Exception reasoning | 367,630.15 |
| System update | 32,678.24 |
| Intake & classification | 31,232.85 |

---

## 8. AI Consumption Units (ACU)

Sources: `acu.ts`; the ACU section of `model.ts › buildSnapshot()`.

### 8.1 Definition

An ACU is a **commercial abstraction** defined by this product. It is not an industry standard, and one ACU is not one token. ACUs convert AI consumption into one billable quantity. The engine always calculates **both** methods below side by side (`acu.methodA`, `acu.methodB`). The project's `acu.method` setting chooses which one becomes `acu.total`, and only that total is used for pricing and billing.

### 8.2 Method A: cost-normalised at base-year reference prices

Sources: `acu.ts › costNormalizedAcus()`, `eligibleCostOf()`.

```
eligibleCostAtBasePrices = Σ_{p ∈ eligiblePools, p ≠ IMPLEMENTATION} poolsAtBasePrices[p]
ACUs (Method A)          = eligibleCostAtBasePrices / convert(referenceValue, referenceCurrency → project currency)
```

- The default definition is 1 ACU = INR 1 of eligible AI consumption cost. The default eligible pools are `LLM`, `ORCHESTRATION`, `RAG` and `DOCUMENT`.
- Implementation is always excluded, because it is one-time. Including it raises the `ACU_IMPL` information issue.
- **Why base-year prices.** Each pool is divided by its own price index (the LLM price factor, or cost inflation) before conversion. ACU counts therefore track **consumption**, not supplier price movements. If LLM list prices fall 20% in year 2, the client does not suddenly receive 20% fewer ACUs for the same work, and the contracted price per ACU does not have to be renegotiated to compensate. Price movements show up in the provider's margin, not in the unit count. With a −20% LLM price change, the AP year-2 Method A count is 535,069.70 ACUs, identical to the count with no price change. The base is the catalogue currently in force: editing catalogue rates directly re-bases the ACU count.
- ACUs per workflow apply the same calculation to each workflow's pools.

AP: eligible cost = 345,276.44 + 1,564.36 + 0 + 130,900.00 = INR 477,740.80, so **477,740.80 ACUs** at INR 1 each. That is 9.5548 ACUs per attempted invoice and 7.7623 per weighted ABU.

### 8.3 Method B: weighted resources with versioned weight sets

Sources: `acu.ts › weightedAcus()`, `weightedAcuBreakdown()`, `ACU_RESOURCES`.

```
ACUs (Method B) = Σ_resources (rawUsage / scale) × weight
```

Weights come from a versioned **weight set** in the catalogue. Each set has an id, version, effective date, author, status (`draft`, `approved` or `retired`) and a rationale. Validation raises:

- `ACU_WEIGHTS_MISSING` (error) if the selected set does not exist
- `ACU_WEIGHTS_STATUS` (warning) if the set is not approved

Changing weights means publishing a new version, so historic measurements remain explainable.

| Resource | Unit | Scale | Derived from the workflow model? | Usage source |
|---|---|---:|---|---|
| `input_tokens_m` | 1M tokens | 1,000,000 | yes | uncached + cache-write input tokens |
| `cached_tokens_m` | 1M tokens | 1,000,000 | yes | cache-read tokens |
| `output_tokens_m` | 1M tokens | 1,000,000 | yes | output tokens |
| `reasoning_tokens_m` | 1M tokens | 1,000,000 | yes | reasoning tokens |
| `llm_calls_k` | 1K calls | 1,000 | yes | LLM calls |
| `workflow_executions_k` | 1K executions | 1,000 | yes | executions |
| `tool_calls_k` | 1K calls | 1,000 | yes | executions × tool calls per execution |
| `embedding_tokens_m` | 1M tokens | 1,000,000 | no | mapped cost lines |
| `vector_queries_k` | 1K queries | 1,000 | no | mapped cost lines |
| `ocr_pages_k` | 1K pages | 1,000 | no | mapped cost lines |
| `gpu_hours` | GPU-hour | 1 | no | mapped cost lines |
| `storage_gb_month` | GB-month | 1 | no | mapped cost lines |
| `monitoring_events_k` | 1K events | 1,000 | no | mapped cost lines |

**Non-derived resources** come from cost lines that map to an ACU resource, either directly or through their linked price item:

```
usage = line units × acuUnitsPerUnit
```

`acuUnitsPerUnit` defaults to 1. Fixed lines contribute their units in proportion to their workflow allocation.

**Why cost lines cannot map to derived resources.** Tokens, LLM calls, executions and tool calls are already calculated from the workflow and tokenomics model. If a cost line also mapped to one of them, the same consumption would be counted twice. The engine ignores such mappings and raises a `MODEL` warning and the `DERIVED_RESOURCE` validation issue.

The sample weight set "Standard ACU weights v1.0" (approved) is model-agnostic and calibrated to about INR 1 per ACU at balanced-tier sample rates. Per scaled unit, its weights are:

| Resource | Weight |
|---|---:|
| Input tokens (1M) | 250 |
| Cached tokens (1M) | 25 |
| Output tokens (1M) | 1,250 |
| Reasoning tokens (1M) | 1,250 |
| LLM calls (1K) | 5 |
| Embedding tokens (1M) | 10 |
| Vector queries (1K) | 40 |
| Tool calls (1K) | 8 |
| Workflow executions (1K) | 10 |
| GPU-hours | 300 |
| OCR pages (1K) | 130 |
| Storage (GB-month) | 2 |
| Monitoring events (1K) | 1 |

Version 0.9 is retired.

Because the weights do not depend on which model serves a request, re-routing traffic to a cheaper model does not change the ACU count, and the provider keeps the efficiency gain. Caching does change the count, because cached tokens weigh 25 against 250 for input tokens.

AP under Method B (calculated alongside Method A; AP is configured for Method A):

| Resource | Units | Weight | ACUs |
|---|---:|---:|---:|
| Input tokens (1M) | 643.7832 | 250 | 160,945.80 |
| Cached tokens (1M) | 187.3120 | 25 | 4,682.80 |
| Output tokens (1M) | 112.7537 | 1,250 | 140,942.10 |
| Reasoning tokens (1M) | 15.8808 | 1,250 | 19,851.00 |
| LLM calls (1K) | 262.1350 | 5 | 1,310.68 |
| Workflow executions (1K) | 54.0000 | 10 | 540.00 |
| Tool calls (1K) | 324.0000 | 8 | 2,592.00 |
| OCR pages (1K) | 130.0000 | 130 | 16,900.00 |
| Storage (GB-month) | 200.0000 | 2 | 400.00 |
| Monitoring events (1K) | 262.1350 | 1 | 262.14 |
| **Total** | | | **348,426.51** |

### 8.4 Separating ACU measurement from ACU price

Measurement and price are kept apart on purpose:

- `acu.ts` defines how many ACUs were consumed.
- `pricing.ts` decides what one ACU costs the client: recovered cost per ACU / (1 − margin), with overrides, floors, tiers and commitments ([10.5](#105-acu-price)).

The unit definition can therefore stay stable across contracts while prices are negotiated per client.

---

## 9. Implementation estimate

Source: `implementation.ts › computeImplementation()`, `schedule()`.

```
hours       = effort                      (effortUnit = hours)
            = effort × hoursPerDay        (effortUnit = days; hoursPerDay defaults to 8)
labourCost  = Σ hours × convert(role.costRate)
contingency = (labourCost + directExpenses) × contingencyPct
totalCost   = labourCost + directExpenses + contingency
cpmPrice    = totalCost / (1 − targetMargin)                      (cost plus margin)
tmValue     = Σ hours × convert(role.billRate) + billable expenses  (time and materials)
price       = (cpmPrice or tmValue, by pricingMethod) × (1 − discountPct)
```

- **Schedule.** Activities are scheduled at their earliest start from their dependencies. The duration is the longest end week, and the critical path comes from a backward pass. Circular or unknown dependencies produce `SCHEDULE` errors. The duration in weeks is reported only; it does not move the projection's month 0.
- **Breakdowns.** Cost is broken down by phase and role, and hours by role. Reconciliation checks `implementation` and `impl-phase` confirm that labour + expenses + contingency equals total cost, and that cost by phase equals labour cost.

AP:

- 4,681 hours; labour INR 12,815,000; direct expenses 700,000; contingency (10%) 1,351,500
- **total cost INR 14,866,500**
- cost-plus price at 32% margin = 14,866,500 / 0.68 = **INR 21,862,500**
- schedule: 31 weeks
- the time-and-materials value would be INR 26,330,000, a 43.54% margin

---

## 10. Pricing engine

Source: `pricing.ts`.

### 10.1 Revenue streams

A commercial model is a list of **revenue streams**. Each stream has a type, a target margin, a discount, and the cost pools it is responsible for recovering (`recovers`).

| Type | Bills | Price basis |
|---|---|---|
| `fixed_fee` | One-time fee in month 0 | Implementation cost |
| `fixed_monthly` | Fixed monthly fee | Owned run pools (+ amortised implementation) |
| `agentops` | Managed AgentOps monthly fee | Owned run pools (+ amortised implementation) |
| `acu` | Price per ACU | Owned cost per ACU |
| `abu` | Price per weighted accepted ABU, by workflow and class | Owned cost per weighted ABU |
| `subscription` | Platform fee + included ACU or ABU allowance + overage | Owned pools; allowance at the unit price |
| `pass_through` | Actual run cost of owned pools + handling markup | Monthly actual cost |
| `gainshare` | Share of client benefit above a threshold | Benefits |

### 10.2 Cost-recovery matrix and double-billing rules

`recoveryMatrix()` lists, for each pool, the enabled streams that claim it. `buildPriceBook()` then applies these rules:

| Rule | Severity | Code |
|---|---|---|
| A pool is recovered by more than one stream, so the client would be billed twice | error | `DOUBLE_RECOVERY` |
| A pool with cost above 0 at the pricing basis is recovered by no stream, so it reduces provider margin | warning | `UNRECOVERED_POOL` |
| A `fixed_fee` stream claims run pools | error | `FIXED_FEE_RUN_POOLS` |
| A `pass_through` stream claims implementation, which is not passed through | warning | `PASS_THROUGH_IMPL` |

When a pool is claimed twice, the **first** stream that declares it owns its cost (`poolOwner()`), so prices are still calculated. The error must be resolved before quoting.

`costByStream()` attributes each month's cost to its owner stream, or to `unrecovered`. Month 0 holds implementation cost; run months hold the run pools. Reconciliation checks `cost-streams` and `steady-streams` use this attribution.

### 10.3 Pricing basis and price locking

All unit prices and fees are calculated once, from the **baseline snapshot**: one fully ramped month in contract year 1 at base volume (`rampFactor = 1`, `yearIndex = 0`). This is the **pricing basis**. The resulting **price book** is then **locked**. Every projection month bills those locked prices, escalated by contract year, against that month's actual volumes and costs. The provider's margin therefore varies with:

- the ramp (fixed costs over lower volumes)
- growth
- cost inflation compared with escalation
- tiers and commitments

The price book is re-derived only when the project is recalculated, or when a scenario explicitly asks for repricing ([section 14](#14-scenario-simulator)). The project model also stores `rateCardVersions` records, but no engine calculation reads them; locking happens through the `PriceBook`.

**Amortised implementation.** When a recurring stream claims `IMPLEMENTATION`, its monthly recovered cost includes `implementation totalCost / termMonths`. This is cost, not price; the stream's margin is applied on top (`implAmortized()`).

### 10.4 Fixed implementation fee

- **Default** (`useImplementationPlanPrice` not `false`): the fee is the implementation plan's quoted price, `impl.price`. The plan's pricing method, margin and discount are the single source of truth, so the stream's own `targetMarginPct` and `discountPct` inputs are not used. The price book reports the plan's **achieved** margin (`impl.marginPct`) as the stream's `targetMarginPct`, so the stream shows the margin actually priced: 32% in all three samples.
- **Otherwise:** `fee = implementation totalCost / (1 − stream margin) × (1 − stream discount)`.

The fee is billed in month 0 only.

### 10.5 ACU price

```
recovered  = Σ owned run pools at the pricing basis (+ amortised implementation if claimed)
unitCost   = recovered / ACUs at the pricing basis
listPrice  = unitCost / (1 − targetMargin)
price      = acuRateCard.priceOverride            if set (negotiated price; discount not applied)
           = listPrice × (1 − discountPct)        otherwise
floorPrice = unitCost / (1 − marginFloorPct)
price      = max(price, floorPrice)               (raises ACU_FLOOR when the floor is applied)
```

`ZERO_ACU` warns when cost must be recovered but no ACUs are measured.

Monthly billing (when the ACU stream is not billing subscription overage):

```
usage  = tieredCharge(ACUs_m, price × esc, tiers, tierMode, floorPrice × esc)
commit = minMonthlyCommitment × esc            (a money amount)
true-up line = commit − usage                  if commit > usage
```

### 10.6 ABU price

ABU prices are derived separately for each workflow `w`:

- `ownedRun_w` is the workflow's cost in the run pools the ABU stream owns.
- `implShare_w` is the workflow's share of any claimed amortised implementation, in proportion to `ownedRun_w`.

```
failure_w         = Σ owned pools' failure cost_w  if failedCostAllocation = provider_absorbs, else 0
recovered_w       = ownedRun_w + implShare_w − failure_w
billableUnits_w   = Σ_classes (autonomous_c + humanAssisted_c × humanAssistedPriceFactor) × abuWeight_c
costPerAbu_w      = recovered_w / weightedABUs_w
listPrice_w       = recovered_w / (1 − targetMargin) / billableUnits_w
price_w           = priceOverrides[w]                if set
                  = listPrice_w × (1 − discountPct)  otherwise
floorPrice_w      = costPerAbu_w / (1 − marginFloorPct) × weightedABUs_w / billableUnits_w
price_w           = max(price_w, floorPrice_w)       (raises ABU_FLOOR when applied)
```

**Prices by class.** `price_w` is the price of one weighted ABU, that is, of a weight-1 transaction.

- `classPricing = 'weighted'`: class price = `price_w × abuWeight_c`.
- `classPricing = 'override'`: a class with `priceOverride` set uses that price per transaction; other classes stay weighted.
- The human-assisted price for each class = class price × `humanAssistedPriceFactor`.

**Human-assisted price factor.** A factor below 1 charges less for human-assisted completions. Because `billableUnits` uses the same factor, the base price rises so that revenue at the pricing basis still equals `recovered / (1 − margin)`. In the AP sample, a factor of 0.8 changes billable units to 60,069.38 and the base price to INR 38.770842, with Simple-class assisted transactions at 31.0167. Steady revenue is unchanged at INR 2,327,185.01.

**Failed-cost allocation.**

- `spread` (the default) leaves failure cost in `recovered`, so accepted ABUs carry the cost of failures.
- `provider_absorbs` removes it from the price, so the provider absorbs it in margin.

Reconciliation check `abu-recovery` confirms that Σ (recovered_w + failure_w) equals the stream's recovered cost.

**Blended price and blended floor.**

```
blendedPrice = revenue at the pricing basis / total weighted ABUs
blendedFloor = Σ_w (floorPrice_w × billableUnits_w) / total weighted ABUs
```

The blended price prices minimum-commitment shortfalls and subscription allowances. The blended floor is the lowest blended rate that ABU tier discounts may reach.

`ZERO_ABU` warns when the ABU stream has cost to recover but no weighted ABUs are measured at the pricing basis. In that case the per-ABU price and the blended price are 0, so minimum commitments also bill nothing.

**Monthly billing** (when the ABU stream is not billing subscription overage):

```
raw    = Σ_w Σ_c (autonomous_c × classPrice + humanAssisted_c × assistedPrice) × esc
billed = tieredCharge(totalWeightedABUs, raw / totalWeightedABUs, tiers, tierMode, blendedFloor × esc)   if tiers exist
       = raw                                                                                          otherwise
shortfall line = (minMonthlyAbus − totalWeightedABUs) × blendedPrice × esc                            if positive
```

ABU tiers are applied to the blended rate across all workflows, and no tier band can price below the escalated blended floor. The ABU minimum commitment is a **quantity** of weighted ABUs; the ACU commitment is a money amount.

### 10.7 Worked example: AP ABU price

The AP model has one ABU stream recovering all run pools at a 35% target margin and a 15% floor, with failure cost spread. Graduated tiers give 3% off above 60,000 ABUs and 6% above 80,000, with a 40,000-ABU monthly minimum.

| Item | Value |
|---|---:|
| Recovered run cost | 1,513,811.40 |
| Weighted ABUs = billable units (factor 1) | 61,546.50 |
| Cost per ABU | 24.596222 |
| List price = 1,513,811.40 / 0.65 / 61,546.50 | **37.840342** |
| Floor = 24.596222 / 0.85 (also the blended floor, one workflow) | 28.936732 (not applied) |
| Class prices: Simple / Medium / Complex | 37.8403 / 56.7605 / 113.5210 |
| Revenue at the pricing basis before tiers | 2,328,940.61 (= 1,513,811.40 / 0.65) |
| Billed after graduated tiers: 60,000 × 37.840342 + 1,546.5 × 37.840342 × 0.97 | **2,327,185.01** |
| Steady gross margin | **34.95%** (the 3% tier on 1,546.5 ABUs costs 1,755.60) |

Variants of the same project:

- `provider_absorbs`: 141,929.34 of failure cost is excluded, so the price is INR 34.292572 and the steady margin 28.22%.
- `all_units` tiers: steady revenue is INR 2,259,072.39 and the margin 32.99% ([10.8](#108-volume-tiers-and-margin-floors)).
- **Minimum commitment in month 1** (ramp 50%): 30,773.25 weighted ABUs are billed 1,164,470.31, plus a shortfall line of (40,000 − 30,773.25) × 37.840342 = **INR 349,143.38**.

### 10.8 Volume tiers and margin floors

Source: `pricing.ts › tieredCharge()`. A tier "starts above `fromUnits` units per month". Tiers with a negative start are ignored.

```
bandPrice(d) = max(price × (1 − d), floor)
```

- **Graduated.** Units within each band are priced at that band's discount. A tier at `fromUnits = 0` sets the first band's discount.
- **All units.** Every unit is priced at the discount of the highest tier the volume **exceeds**.

All-units tiers create a revenue cliff at each threshold. On the AP rate card, 60,000 ABUs bill INR 2,270,420.52 under either mode. One more ABU bills 2,270,457.23 under graduated tiers but **2,202,344.61** under all-units tiers.

**Margin floors** stop a negotiated override, a discount or a tier from pricing below a minimum margin on unit cost. The floor is applied in three places:

- when the price book is built, to ACU and ABU prices
- inside ACU tier billing, at the ACU floor price
- inside ABU tier billing, at the blended floor ([10.6](#106-abu-price))

### 10.9 Subscription

```
platformFee = owned recovered cost / (1 − margin) × (1 − discountPct)
```

The included allowance (`includedUnit` = `acu` or `abu`, `includedQty`) is priced in one of two ways.

**With a matching enabled unit stream** (an ACU stream for ACUs, an ABU stream for ABUs):

```
allowanceUnitPrice = unit stream price (ACU price, or ABU blended price)
includedValue      = includedQty × allowanceUnitPrice × (1 − includedDiscountPct)
overageRate        = allowanceUnitPrice × (1 + overagePremiumPct)
```

- The allowance is billed every month under the unit stream's id as a commitment, even when usage is below it.
- Overage is billed by the unit stream at one flat rate: `max(0, units − includedQty) × overageRate × esc`.
- By design, that stream's normal usage billing, volume tiers, minimum commitment, floor and per-class prices are **not** used in this mode. Volume tiers configured on its rate card have no effect while it bills subscription overage.

**Without a matching unit stream** (raises the `SUB_NO_UNIT_STREAM` information issue):

```
allowanceUnitPrice = marginal cost per unit / (1 − subscription margin)
includedValue      = 0
overageRate        = allowanceUnitPrice × (1 + overagePremiumPct)
```

- The allowance is bundled in the platform fee.
- Overage is billed on the subscription stream itself.

Marginal cost per unit comes from `compute.ts › marginalCosts()`: the run-cost change between the baseline snapshot and one at 101% volume, divided by the change in ACUs or weighted ABUs. Fixed costs therefore drop out. For AP, marginal cost is INR 13.663870 per ABU and INR 1.760292 per ACU.

The subscription stream's `monthlyFee = platformFee + includedValue`.

### 10.10 Fixed monthly and AgentOps fees

```
fee = owned recovered cost (+ amortised implementation if claimed) / (1 − margin) × (1 − discountPct)
```

The fee is billed monthly and escalated. In the managed AgentOps construct this stream typically owns `AGENTOPS` and `HUMAN_REVIEW`.

### 10.11 Pass-through and gainshare

- **Pass-through:**
  ```
  amount_m = Σ owned run pools in month m × (1 + passThroughMarkupPct) × priceMultiplier
  ```
  It is not escalated, because month-m cost already includes inflation and the LLM price change.
- **Gainshare:**
  ```
  amount_m = min(max(0, benefit_m − thresholdAnnual / 12) × sharePct, capAnnual / 12) × priceMultiplier
  ```
  - `benefit_m` is the month's validated benefit when `basis = 'validated'`, or the forecast benefit when `basis = 'all'`. The forecast still excludes rejected lines.
  - The threshold and cap are applied **monthly**, as one twelfth of the annual figures.
  - It is not escalated. Nothing is billed in month 0.

### 10.12 Escalation and the price multiplier

```
esc = compound(priceEscalationPct, yearIndex) × priceMultiplier
```

| Line | Escalated by `esc` |
|---|---|
| Fixed fee (month 0) | no (× `priceMultiplier` only) |
| Fixed monthly and AgentOps fees | yes |
| Subscription platform fee, included allowance, overage | yes |
| ACU usage price, ACU floor, ACU minimum commitment | yes |
| ABU usage (raw class revenue), ABU shortfall | yes |
| Pass-through | no (× `priceMultiplier` only) |
| Gainshare | no (× `priceMultiplier` only) |

`priceMultiplier` is 1 in a normal calculation. The scenario simulator sets it to model a price change at locked prices ([section 14](#14-scenario-simulator)). The tests check that month 13 revenue equals month 12 revenue × 1.05 at 5% escalation.

---

## 11. The seven commercial constructs

Source: `commercial.ts › packageProject()`, `computePackages()`.

The engine reprices the same project, with the same baseline cost, implementation and value model, under seven constructs, so provider margin and client ROI can be compared like for like. Each package:

1. replaces the project's streams
2. clears ACU/ABU tiers, minimum commitments, price overrides and class overrides
3. resets the subscription allowance to none
4. builds its own price book and projection

The run margin `m` is the target margin of the project's first enabled `abu`, `acu`, `subscription` or `fixed_monthly` stream, or 30% if there is none. The tests confirm that every package's total cost equals the configured project's total cost and that no package double-recovers a pool.

| Construct | Streams |
|---|---|
| Fixed implementation fee | Implementation fee (plan price) + fixed monthly run fee on all run pools at `m` |
| ACU consumption | Implementation fee + ACU stream on all run pools at `m` |
| ABU transaction | Implementation fee + ABU stream on all run pools at `m` |
| Subscription / committed capacity | One subscription on all run pools + amortised implementation at `m`; allowance = baseline weighted ABUs (rounded); no ABU stream, so overage is at marginal cost + margin + 10% |
| Managed AgentOps | Implementation fee; AgentOps fee on `AGENTOPS` + `HUMAN_REVIEW` at max(20%, `m` − 5); pass-through of all other run pools at the project's markup |
| Outcome-based gainshare | Implementation fee at cost (0% margin, not the plan price); gainshare on all run pools using the project's gainshare settings |
| Hybrid | The project's own configured streams and rate cards, unchanged |

AP comparison (`m` = 35%, 36-month term):

| Construct | TCV | Steady monthly revenue | Steady margin | Term margin | Client ROI | Payback (months) | Client NPV |
|---|---:|---:|---:|---:|---:|---:|---:|
| Fixed fee | 109,102,752.12 | 2,328,940.61 | 35.00% | 32.03% | 44.22% | 17.39 | 38,981,915.33 |
| ACU | 117,951,581.72 | 2,328,940.61 | 35.00% | 37.13% | 34.01% | 17.06 | 32,230,110.14 |
| ABU | 117,951,581.72 | 2,328,940.61 | 35.00% | 37.13% | 34.01% | 17.06 | 32,230,110.14 |
| Subscription | 117,869,066.77 | 2,964,261.12 | 48.93% | 37.08% | 34.10% | 10.93 | 34,749,058.55 |
| Managed AgentOps | 96,118,927.13 | 1,946,800.99 | 22.24% | 22.85% | 62.36% | 14.92 | 50,367,160.57 |
| Gainshare | 65,150,111.26 | 1,441,875.00 | −4.99% | −13.83% | 131.93% | 8.59 | 78,589,164.94 |
| Hybrid (configured) | 117,904,895.33 | 2,327,185.01 | 34.95% | 37.10% | 34.06% | 17.18 | 32,206,878.33 |

How to read the table:

- **ACU and ABU** are identical here. AP has one workflow and no tiers, and both Method A ACUs and weighted ABUs scale linearly with volume, so both bill the same revenue.
- **The fixed fee** does not grow with volume, only with escalation, so its term margin falls each year (35.37%, 31.31%, 27.22%).
- **The subscription** recovers implementation over the term instead of in month 0. Its year-1 margin is therefore 9.50%, and its steady margin of 48.93% includes the amortised implementation.
- **Gainshare** pays the provider 30% of validated benefits (INR 1,441,875 at steady state), which does not cover run cost in this sample.

---

## 12. Contract-term projection

Source: `projection.ts › buildContext()`, `runProjection()`.

### 12.1 Months, ramp, growth and inflation

- **Month 0** (period = the month before go-live) carries the implementation cost and the fixed fee, plus one-time client costs. It has no run cost, volume or benefits.
- **Months 1…T** use a snapshot with:
  ```
  rampFactor = rampStart + (1 − rampStart) × (month − 1) / rampMonths    for month ≤ rampMonths
             = 1                                                         afterwards
  yearIndex  = floor((month − 1) / 12)
  ```
  The sample ramp starts at 50% over 3 months, giving factors of 0.5, 0.6667, 0.8333, then 1. Growth, cost inflation and the LLM price change each step once a year through `yearIndex`.

### 12.2 Monthly formulas

```
revenue_m          = Σ revenue lines (locked price book, section 10)
recurringRevenue_m = Σ lines marked recurring (all except the fixed fee)
totalCost_m        = run cost_m (+ implementation cost in month 0)
grossProfit_m      = revenue_m − totalCost_m
clientInvestment_m = revenue_m + clientInternalCost_m
clientNet_m        = countedBenefit_m − clientInvestment_m
clientCumulative_m = Σ_{k ≤ m} clientNet_k
```

### 12.3 Yearly roll-ups

Year y sums the months whose `yearIndex` is y − 1, and year 1 also includes month 0. The number of years is `ceil(T / 12)`. Each year reports:

- revenue (recurring and one-time), cost, run cost, LLM cost, gross profit and margin
- volumes, ACUs, benefits and productivity
- client investment and client net
- **yearly ROI** = (counted benefit − client investment) / client investment × 100

### 12.4 Steady state

The **steady state** is the baseline snapshot billed at month 1, contract year 1 prices, valued with every benefit line fully ramped. It is a fully ramped first-year month at base volume. It supplies MRR, ARR, steady margin and cost-to-serve.

### 12.5 Definitions

| Metric | Definition |
|---|---|
| TCV (total contract value) | Σ revenue over months 0…T, including the one-time fee |
| ACV (annual contract value) | TCV / (termMonths / 12); includes one-time revenue |
| One-time revenue | TCV − Σ recurring revenue |
| MRR | Steady-state recurring revenue |
| ARR | MRR × 12 |
| Total provider cost | Σ total cost over months 0…T |
| Gross profit and margin (term) | TCV − total cost; `marginPct(TCV, total cost)` |
| Steady run cost (cost-to-serve, monthly) | Baseline total run cost |
| Cost-to-serve per ABU | Baseline run cost / baseline weighted ABUs |
| Steady margin | `marginPct(steady revenue, steady run cost)` |
| Revenue per agent / per workflow | ACV / number of agents; ACV / number of workflows |

### 12.6 Worked example: AP projection (36 months, go-live 2026-04)

| Month | Period | Ramp | Attempted | Weighted ABUs | Run cost | Revenue | Validated benefit | Client net | Cumulative |
|---:|---|---:|---:|---:|---:|---:|---:|---:|---:|
| 0 | 2026-03 | 0 | 0 | 0 | 0 (+14,866,500.00 implementation) | 21,862,500.00 | 0 | −23,362,500.00 | −23,362,500.00 |
| 1 | 2026-04 | 0.5000 | 25,000 | 30,773.25 | 1,093,329.70 | 1,513,613.68 | 53,125.00 | −1,610,488.68 | −24,972,988.68 |
| 2 | 2026-05 | 0.6667 | 33,333.33 | 41,031.00 | 1,233,490.26 | 1,552,627.07 | 929,166.67 | −773,460.41 | −25,746,449.09 |
| 3 | 2026-06 | 0.8333 | 41,666.67 | 51,288.75 | 1,373,650.83 | 1,940,783.84 | 1,970,833.33 | −119,950.51 | −25,866,399.60 |
| 4 | 2026-07 | 1.0000 | 50,000 | 61,546.50 | 1,513,811.40 | 2,327,185.01 | 2,993,750.00 | 516,564.99 | −25,349,834.60 |
| 12 | 2027-03 | 1.0000 | 50,000 | 61,546.50 | 1,513,811.40 | 2,327,185.01 | 4,406,250.00 | 1,929,064.99 | −10,854,814.67 |
| 13 | 2027-04 | 1.0000 | 56,000 | 68,932.08 | 1,663,847.70 | 2,702,204.64 | 4,808,613.33 | 1,950,408.69 | −8,904,405.98 |
| 36 | 2029-03 | 1.0000 | 62,720 | 77,203.93 | 1,833,394.92 | 3,138,687.50 | 5,544,108.54 | 2,243,181.05 | 42,588,262.20 |

Month 1 revenue is ABU usage of 1,164,470.31 plus the 349,143.38 minimum-commitment true-up. Month 13 applies 12% volume growth, 4% cost inflation and 4% price escalation.

| Year | Revenue | One-time | Provider cost | Gross margin | Counted benefit | Client investment | Client net | ROI |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| 1 | 47,814,189.67 | 21,862,500.00 | 32,191,273.37 | 32.67% | 40,259,375.00 | 51,114,189.67 | −10,854,814.67 | −21.24% |
| 2 | 32,426,455.71 | 0 | 19,966,172.40 | 38.43% | 60,823,360.00 | 34,298,455.71 | 26,524,904.29 | 77.34% |
| 3 | 37,664,249.94 | 0 | 22,000,739.07 | 41.59% | 66,529,302.53 | 39,611,129.94 | 26,918,172.58 | 67.96% |

AP provider economics:

| Metric | Value |
|---|---:|
| TCV | 117,904,895.33 |
| ACV | 39,301,631.78 |
| MRR | 2,327,185.01 |
| ARR | 27,926,220.09 |
| Total cost | 74,158,184.83 |
| Gross profit | 43,746,710.49 |
| Term margin | 37.10% |
| Steady margin | 34.95% |
| Revenue per agent (5 agents) | 7,860,326.36 |
| Cost-to-serve per ABU | 24.60 |

---

## 13. Value realisation and client ROI

Source: `value.ts`; client economics in `projection.ts › runProjection()`.

**Principle: productivity is not realised cash.** Hours released by the AI are reported as productivity, which is non-cash. Only explicit **benefit lines** count as financial benefits in ROI, and by default only those that Finance has validated or that have been realised.

### 13.1 Productivity: hours, FTE and value

Source: `productivityFor()`. The calculation is per workflow with a productivity baseline:

```
hoursBefore   = attempted × manualMinutesBefore / 60
assistedHours = humanAssisted × minutesPerAssistedTxn × humanEffortMix / 60    if review is client-borne
              = humanAssisted × spotCheckMinutes / 60                         if provider-borne
fallbackHours = (failed + rejected) × manualMinutesBefore / 60                (non-accepted work is redone manually)
hoursAfter    = autonomous × spotCheckMinutes / 60 + assistedHours + fallbackHours
hoursSaved    = hoursBefore − hoursAfter
fteReleased   = hoursSaved / productiveHoursPerFteMonth
productivity  = hoursSaved × convert(loadedHourlyCost) × compound(costInflationPct, yearIndex)
```

Each rejected transaction is counted once, as a full manual redo in `fallbackHours`. Its review rework minutes are not added on top. Client-borne review hours are never also a provider cost. Workflows without a productivity baseline raise `NO_PRODUCTIVITY`.

Client-borne example (Customer Service, "Customer query resolution", steady month):

| Component | Calculation | Hours |
|---|---|---:|
| Before | 85,000 × 9 / 60 | 12,750.00 |
| Autonomous spot checks | 62,532.8 × 0.3 / 60 | 312.66 |
| Client review of assisted completions | 8,527.2 × 4 × 0.89 / 60 | 505.95 |
| Manual redo of failed and rejected | (10,200 + 3,740) × 9 / 60 | 2,091.00 |
| After | | 2,909.61 |
| **Saved** | | **9,840.39** (77.18%) |

AP (provider-borne review, 15 minutes manual, 0.5 minutes spot check, INR 450/hour, 140 productive hours per FTE-month):

- hours before = 50,000 × 15/60 = 12,500
- hours after = 40,119.2 × 0.5/60 + 5,470.8 × 0.5/60 + (3,000 + 1,410) × 15/60 = 1,482.42
- **11,017.58 hours saved**, 88.14% improvement
- **78.70 FTE**, **INR 4,957,912.50 per month of productivity value**

None of this is counted as an ROI benefit.

### 13.2 Benefit lines

Source: `computeValueMonth()`. Each line has:

- a category: `hard_savings`, `cost_avoidance`, `revenue`, `working_capital` or `capacity_conversion`
- an annual amount and currency, a start month, ramp months and a confidence %
- a status: `proposed`, `finance_validated`, `realized` or `rejected`
- an optional overlap group, and whether it scales with volume

```
gross_m = convert(annualAmount) / 12
        × ramp_m
        × confidence%
        × volumeIndex_m       (only if scalesWithVolume)
        × costInflation_m     (every category except revenue)

ramp_m      = 0                                       before startMonth
            = (m − startMonth + 1) / rampMonths       during the ramp (capped at 1)
            = 1                                       afterwards, or when rampMonths = 0
volumeIndex = attempted_m / volume base                (this includes the go-live ramp and growth)
```

The volume base is the project's own steady-state attempted volume. A scenario instead passes the **original** project's volume (`ComputeOptions.benefitVolumeBase`), so volume-scaled benefits rise and fall with scenario volume ([14.2](#142-locked-or-repriced)).

Benefits are 0 in month 0. The steady-state value month uses ramp = 1 for every line.

**Working capital.** The engine does not model days payable or days sales outstanding. A `working_capital` line is entered as the **annual financing benefit** of the cash released (released balance × cost of capital), not the balance itself. It is then treated like any non-revenue line.

### 13.3 Validated and forecast views

The engine keeps two views every month:

| View | Statuses counted |
|---|---|
| Validated (default) | `finance_validated`, `realized` |
| Forecast | `finance_validated`, `realized`, `proposed` |

Rejected lines never count. The project's `includeUnvalidated` setting chooses which view feeds ROI (`countedBenefit()`). The other view is still reported.

### 13.4 Double-count controls (applied to each view, each month, in this order)

1. **Capacity-conversion cap.** Capacity-conversion lines turn released hours into cash, so together they cannot exceed the month's total productivity value across all workflows. If they do, each one is scaled down in proportion. The validation issue `CAPACITY_UNVALIDATED` flags proposed capacity-conversion lines.
2. **Overlap groups.** Lines in the same overlap group are alternatives. Only the line with the largest counted amount in that month counts; the others are set to 0 with a reason.

AP steady state (validated view):

| Line | Category | Status | Gross | Counted | Note |
|---|---|---|---:|---:|---|
| Reduced BPO / contractor fees | hard savings | validated | 3,150,000.00 | 3,150,000.00 | Group `ap-labour` |
| Capacity redeployment of AP clerks | capacity conversion | proposed | 875,000.00 | 0 | Not validated; also loses the overlap in the forecast view |
| Early-payment discounts | hard savings | validated | 937,500.00 | 937,500.00 | |
| Duplicate-payment avoidance | cost avoidance | realised | 318,750.00 | 318,750.00 | |
| Avoided hiring for growth | cost avoidance | validated | 400,000.00 | 400,000.00 | Starts in month 13; full in the steady view |
| Working-capital financing benefit | working capital | proposed | 90,000.00 | 0 | Forecast view only |
| **Total** | | | | **4,806,250.00** | Forecast view: 4,896,250.00 |

Month 3 example ("Early-payment discounts": starts month 3, ramp 6, 75% confidence, scales with volume):

- 15,000,000 / 12 × 1/6 × 0.75 × (41,666.67 / 50,000) = **INR 130,208.33**
- The benefit's own ramp and the go-live volume ramp both apply.

### 13.5 Client investment and ROI

```
clientInternalCost_m = one-time client costs                          (month 0)
                     = Σ monthly client costs × costInflation_m       (months ≥ 1)
totalInvestment      = Σ_m (provider revenue_m + clientInternalCost_m)
                     = TCV + Σ client internal costs
ROI %                = (counted benefits − totalInvestment) / totalInvestment × 100
```

With the default validated view, this is **(validated benefits − total AI investment) / total AI investment × 100**. Reconciliation check `client-investment` confirms the identity. Yearly ROI uses the same formula within each year.

### 13.6 NPV, payback and cost per successful outcome

```
NPV = Σ_{m=0..T} clientNet_m / (1 + discountRate)^(m / 12)
```

This is monthly discounting at an annual rate. Month 0 is "today" and is not discounted (`npv()`).

**Payback** (`paybackMonths()`) finds the **last** month in which cumulative net cash is negative. The crossing is the following month, interpolated linearly:

```
payback = lastNegativeMonth + min(1, −cumulative_lastNeg / clientNet_{lastNeg+1})
```

The result is 0 if the cumulative position is never negative, and `null` if it is still negative at the end of the term. Using the last negative month means a temporary crossing followed by a fall back below zero does not count, so payback must be sustained.

```
Cost per successful outcome = totalInvestment / Σ accepted transactions over the term
```

### 13.7 Worked example: AP client economics

| Metric | Value |
|---|---:|
| Provider revenue (TCV) | 117,904,895.33 |
| Client internal costs: 1,500,000 one-time + 150,000/month inflated 4% a year | 7,118,880.00 |
| **Total AI investment** | **125,023,775.33** |
| Validated benefits over the term (counted) | 167,612,037.53 |
| Forecast benefits | 170,488,365.53 |
| Net benefit | 42,588,262.20 |
| **ROI** = 42,588,262.20 / 125,023,775.33 | **34.06%** |
| Year-1 ROI | −21.24% |
| NPV at 10% | 32,206,878.33 |
| **Payback** | **17.18 months** |
| Accepted invoices over the term | 1,800,476.75 |
| Cost per successful outcome | 69.44 |
| Productivity value over the term (not in ROI) | 204,557,066.51 |

Payback detail: cumulative net cash is −409,437.88 after month 17, and month 18 adds 2,297,075.36. Payback = 17 + 409,437.88 / 2,297,075.36 = 17.18. The position turns positive about 18% of the way through month 18's net flow.

---

## 14. Scenario simulator

Source: `scenario.ts`.

### 14.1 Overrides

`applyScenario()` returns a modified deep copy of the project; the input is never changed.

| Override | Effect |
|---|---|
| `volumeMultiplier` | × each workflow's monthly volume |
| `growthPct` | Replaces every workflow's annual growth |
| `retryRatePct`, then `retryMultiplier` | Sets, then multiplies, every retry rate (minimum 0) |
| `successRateDeltaPp`, `humanInterventionDeltaPp` | Adds percentage points, clamped to 0–100 |
| `complexityShiftPp` | Moves points of mix from the lowest-ABU-weight class to the highest (or back if negative), limited to the share available |
| `inputTokenMultiplier` | × input tokens and cacheable prefix |
| `outputTokenMultiplier` | × output and reasoning tokens |
| `cacheHitRatePct`, `cacheHitDeltaPp` | Sets or shifts the hit rate on steps that have a cacheable prefix (clamped) |
| `modelSwap` | Replaces one model with another in every routing, merging duplicate routes |
| `routingShift` | Moves the given share of every step's traffic to one model |
| `infraMultiplier`, `agentOpsMultiplier` | × the quantity of `INFRASTRUCTURE` or `AGENTOPS` cost lines (× allocation % for shared lines) |
| `targetMarginPct` | Applied to every stream except fixed fee, pass-through and gainshare, **only** with `repriceAtTargetMargin` |
| `priceMultiplier` | Sets `priceMultiplier` on the price book |
| `repriceAtTargetMargin` | false (default): keep the contracted prices; true: re-derive prices |

### 14.2 Locked or repriced

Source: `runScenario()`.

- **Locked (default).** This is what a provider experiences under a signed contract. The base project's price book is reused, with the scenario's `priceMultiplier`, and only costs and volumes move.
- **Repriced.** The scenario project is recalculated from scratch, deriving new prices at the target margin. Any price multiplier is applied afterwards.

In both modes, `runScenario()` passes the base project's steady attempted volume as `benefitVolumeBase`. A volume multiplier of 0.8 therefore scales volume-linked benefit lines to 80%, while fixed-amount lines are unchanged.

Scenario metrics (`metricsOf()`) include: monthly run cost, cost per ACU and per ABU, LLM cost per accepted transaction, steady revenue, ARR, year-1 revenue, steady and term margin, TCV, client ROI, payback, NPV and break-even.

### 14.3 Presets

| Preset | Overrides |
|---|---|
| Baseline | none |
| Optimized | input tokens ×0.85, output ×0.9, cache hit +15 pp, retries ×0.5, success +2 pp, human intervention −3 pp, AgentOps ×0.9 |
| Stress | volume ×1.4, input ×1.3, output ×1.25, retries ×2, success −5 pp, human intervention +8 pp, complexity shift +10 pp, infrastructure ×1.2, AgentOps ×1.15 |

AP results:

| Preset | Monthly run cost | Cost per ABU | Steady margin | Term margin | TCV | Client ROI | Payback |
|---|---:|---:|---:|---:|---:|---:|---:|
| Baseline | 1,513,811.40 | 24.5962 | 34.95% | 37.10% | 117,904,895.33 | 34.06% | 17.18 |
| Optimized | 1,346,131.23 | 21.4161 | 43.33% | 43.66% | 119,866,207.57 | 31.99% | 17.53 |
| Stress (locked) | 2,494,245.48 | 26.6286 | 28.55% | 31.27% | 165,205,467.34 | 8.49% | 25.33 |

Under stress, the 40% volume increase also raises the volume-scaled benefits, so client ROI stays positive (8.49%, NPV INR 8,156,524.16) even though fees rise by 40%. Repricing the stress scenario raises the ABU price from 37.840342 to 40.967019, restores a 34.00% steady margin and lowers client ROI to 1.51%.

### 14.4 Cost waterfall

Source: `costWaterfall()`. This sequentially attributes the change in steady-state monthly run cost. Override groups are applied **cumulatively in a fixed order**, and each step's delta is the cost after that group minus the cost before it:

1. Volume
2. Token consumption
3. Model routing
4. Caching
5. Retries & success
6. Human intervention
7. Complexity mix
8. Infrastructure
9. AgentOps effort

Groups the scenario does not set are skipped. The bars always bridge exactly from baseline to scenario. Interaction effects fall into whichever group comes later in the order.

AP stress waterfall:

| Step | Change in monthly run cost |
|---|---:|
| Baseline | 1,513,811.40 |
| Volume | +336,385.36 |
| Token consumption | +132,820.50 |
| Retries & success | −12,841.71 |
| Human intervention | +236,889.52 |
| Complexity mix | +177,030.57 |
| Infrastructure | +35,899.85 |
| AgentOps effort | +74,250.00 |
| **Scenario** | **2,494,245.48** |

"Retries & success" is negative even though doubled retries raise LLM cost by 13,922.17 and orchestration and infrastructure by 198.71. The 5 pp drop in success cuts accepted transactions from 63,826 to 60,431. That means fewer human-assisted transactions and fewer completed-then-rejected ones, so provider-borne review falls by 26,962.60.

### 14.5 Sensitivity (tornado)

Source: `sensitivity()`. Eleven drivers are each shocked low and high at locked prices. The drivers are:

- transaction volume ±20%
- tokens per call ±20%
- LLM unit rates ±20% (applied by scaling the catalogue)
- retry rate ×0.5 / ×1.5
- success rate ±3 pp
- human intervention ±5 pp
- cache hit rate ±15 pp
- complexity mix ±10 pp
- infrastructure ±20%
- AgentOps effort ±20%
- customer price ±10%

Each shock reports the steady provider margin, cost per ABU and client ROI over the term. Rows are sorted by the range of the margin.

AP:

| Driver | Low / high | Steady margin | Cost per ABU | Client ROI |
|---|---|---|---|---|
| Customer price | +10% / −10% | 40.86% / 27.72% | 24.596 / 24.596 | 22.51% / 48.02% |
| Transaction volume | −20% / +20% | 27.78% / 39.47% | 27.329 / 22.774 | 48.05% / 23.77% |
| Complexity mix | simpler / harder | 28.36% / 39.65% | 27.109 / 22.732 | 50.37% / 20.97% |
| Human intervention | −5 pp / +5 pp | 39.75% / 30.15% | 22.781 / 26.411 | 34.06% / 34.06% |
| AgentOps effort | −20% / +20% | 39.21% / 30.70% | 22.988 / 26.205 | 34.06% / 34.06% |
| Tokens per call | −20% / +20% | 37.92% / 31.98% | 23.474 / 25.718 | 34.06% / 34.06% |
| LLM unit rates | −20% / +20% | 37.92% / 31.98% | 23.474 / 25.718 | 34.06% / 34.06% |
| Infrastructure | −20% / +20% | 36.49% / 33.41% | 24.015 / 25.178 | 34.06% / 34.06% |
| Agent success rate | +3 pp / −3 pp | 36.21% / 33.60% | 24.098 / 25.127 | 30.98% / 37.29% |
| Cache hit rate | +15 pp / −15 pp | 35.47% / 34.43% | 24.400 / 24.793 | 34.06% / 34.06% |
| Retry rate | ×0.5 / ×1.5 | 35.30% / 34.60% | 24.463 / 24.730 | 34.06% / 34.06% |

Client ROI moves with volume because all usage fees scale with volume, but only the volume-scaled benefit lines do. It moves with complexity and success rate because fees change while benefit lines do not depend on either ([section 20](#20-known-limitations-and-modelling-assumptions)).

### 14.6 Break-even volume

Source: `breakEven()`. This finds the volume multiplier `k` at which steady-state gross profit is zero, at the locked prices:

```
grossProfit(k) = steady revenue(k) − steady run cost(k)
```

The search finds the lowest volume **above which gross profit stays non-negative**. A minimum commitment can make small volumes profitable while mid volumes lose money, so the search looks for the last loss, not the first profit:

1. Evaluate gross profit on a fixed grid of multipliers: 0.0001, 0.02, 0.05, 0.1, 0.2 … 0.9 (steps of 0.1), 1, 1.25, 1.5, 2, 3, 4, 6, 8, 16, 32, 64, 128.
2. If no grid point loses money, the status is `below`: the project is profitable at every volume tested, for example because fixed fees or commitments cover cost.
3. If the last loss-making point is 128×, the status is `above`.
4. Otherwise, 40 bisection steps between the last loss-making grid point and the next point find `k`. The status is `found` and `monthlyVolume = base volume × k`.

The search covers only the grid points, so a loss between two profitable grid points is not detected. It returns `null` when the base volume is 0.

All three samples return `below`. AP's 40,000-ABU minimum commitment covers its fixed costs at every grid volume. Without the commitment, AP breaks even at **k = 0.4522, or 22,609 invoices a month**.

---

## 15. Optimisation finder

Source: `optimize.ts › findOptimizations()`. Each candidate change is applied to a copy of the project, and the steady-state run cost is recalculated with the same deterministic model. The saving is measured, not estimated. Candidates saving less than 0.1% of run cost are dropped, and results are sorted by monthly saving.

| Id | Candidate | Change applied |
|---|---|---|
| `cache` | Raise the prompt-cache hit rate | Steps with a cacheable prefix and a hit rate below 80% are set to 80% |
| `route` | Route traffic to a cheaper model | The most expensive step (by monthly cost) sends 30% of its traffic to the cheapest per-token model from the same provider as its main model, compared on input + output list rate |
| `batch` | Use batch APIs | Non-tool steps on models with a batch discount and less than 50% batch eligibility are set to 50% |
| `retry` | Halve the retry rate | `retryMultiplier: 0.5`, considered only when a workflow's retry rate is above 2% |
| `prompt` | Compress prompts and context | `inputTokenMultiplier: 0.85` |
| `infra` | Right-size infrastructure | `infraMultiplier: 0.85`, considered only when infrastructure is more than 15% of run cost |

AP:

| Opportunity | Monthly saving | Share of run cost |
|---|---:|---:|
| Use batch APIs for non-interactive steps (3 steps) | 53,952.41 | 3.56% |
| Route 30% of "Extract fields" to Claude Haiku-class | 27,463.77 | 1.81% |
| Compress prompts and retrieved context by 15% | 25,658.02 | 1.69% |
| Raise prompt-cache hit rate to 80% | 13,021.93 | 0.86% |
| Halve the retry rate | 8,225.24 | 0.54% |

AP infrastructure is 11.8% of run cost, so the right-sizing candidate is not considered.

---

## 16. Actuals variance analysis

Source: `actuals.ts › varianceAnalysis()`.

Each actual record (period, run month index, workflow, attempted, accepted, tokens, LLM cost, non-LLM cost, realised benefit, currency) is compared with the estimate for the same run month and workflow. Records for months outside 1…T are skipped.

| Estimated field | Source |
|---|---|
| Attempted, accepted | The month's funnel for the workflow |
| Tokens | Input + output + reasoning from the month's LLM lines |
| LLM cost | The workflow's LLM cost in that month |
| Non-LLM cost | The workflow's run cost − its LLM cost |
| Forecast benefit | The month's **validated** benefit × the workflow's share of run cost |

```
costVariance        = actual total cost − estimated total cost
costVariance %      = costVariance / estimated total × 100
cost per accepted   = total cost / accepted          (estimated and actual)
```

Actual amounts are converted to the project currency. Rows are aggregated by period and in total.

The AP sample has six months of synthetic actuals. `samples/index.ts › addActuals()` derives them deterministically from the estimate with fixed adjustment factors, so they are not real data.

| Period | Estimated cost | Actual cost | Variance | Estimated / actual cost per accepted | Forecast / realised benefit |
|---|---:|---:|---:|---|---|
| 2026-04 | 1,093,329.70 | 1,179,346.00 | +7.87% | 47.96 / 56.74 | 53,125.00 / 37,188.00 |
| 2026-05 | 1,233,490.26 | 1,311,343.00 | +6.31% | 40.58 / 45.39 | 929,166.67 / 743,333.00 |
| 2026-06 | 1,373,650.83 | 1,443,213.00 | +5.06% | 36.16 / 37.99 | 1,970,833.33 / 1,734,333.00 |
| 2026-07 | 1,513,811.40 | 1,569,584.00 | +3.68% | 33.20 / 34.43 | 2,993,750.00 / 2,814,125.00 |
| 2026-08 | 1,513,811.40 | 1,561,766.00 | +3.17% | 33.20 / 33.26 | 3,937,500.00 / 3,858,750.00 |
| 2026-09 | 1,513,811.40 | 1,553,636.00 | +2.63% | 33.20 / 32.13 | 4,093,750.00 / 4,175,625.00 |
| **Total** | **8,241,904.98** | **8,618,888.00** | **+4.57%** | | 13,978,125.00 / 13,363,354.00 |

---

## 17. Validation and double-count detection

Validation never throws; it returns a list of issues (`validate.ts › validateProject()`). `computeProject()` adds price-book issues, snapshot warnings and schedule errors.

| Code | Severity | Rule | Source |
|---|---|---|---|
| `FX_MISSING` | error | No FX rate for a currency the project uses (`currenciesUsed()`: reporting and ACU reference currencies, routed models, linked price items, cost lines, roles, direct expenses, review, productivity, benefits, client costs, actuals). `computeProject()` treats the currency as 1:1 with the base until the rate is added. | `validate.ts`, `compute.ts › withFxFallback()` |
| `NO_WORKFLOWS` | warning | The project has no workflows, so no transactions, ACUs or ABUs | `validate.ts` |
| `NEGATIVE_VOLUME` | error | A workflow's monthly volume is below 0 | `validate.ts` |
| `RATE_RANGE` | error | Success, acceptance or human-intervention rate outside 0–100, or a negative retry rate | `validate.ts` |
| `MIX_NOT_100` | warning | Complexity shares do not sum to 100 (±0.5); they are normalised | `validate.ts` |
| `ABU_WEIGHT` | error | Negative ABU weight | `validate.ts` |
| `ABU_DEFINITION` | warning | No definition of what counts as one accepted unit | `validate.ts` |
| `UNKNOWN_AGENT` | warning | A step references an agent that does not exist | `validate.ts` |
| `ROUTING_NOT_100` | warning | Routing shares do not sum to 100 (±0.5); they are normalised | `validate.ts` |
| `PREFIX_GT_INPUT` | info | Cacheable prefix is longer than the input; it is capped at the input | `validate.ts` |
| `UNKNOWN_MODEL` | error | A step routes to a model that is not in the rate card | `validate.ts` |
| `CONTEXT_WINDOW` | warning | Step tokens × the workflow's highest class consumption multiplier use more than 90% of the model's context window | `validate.ts` |
| `SAMPLE_RATES` | info | A routed model uses an illustrative sample rate | `validate.ts` |
| `UNKNOWN_WORKFLOW` | error | A cost line is assigned to a workflow that does not exist | `validate.ts` |
| `NEGATIVE_COST` | error | A cost line has a negative unit cost or quantity | `validate.ts` |
| `LLM_IN_COST_LINE` | warning | A non-RAG cost line's name looks like LLM token spend (contains token, GPT, Claude or Gemini, or "LLM API/usage/spend/consumption/cost"), but LLM cost already comes from tokenomics | `validate.ts` |
| `DERIVED_RESOURCE` | warning | A cost line maps to a derived ACU resource; the mapping is ignored | `validate.ts` |
| `ALLOCATION_PCT` | warning | A shared cost's allocation is not between 0 (exclusive) and 100% | `validate.ts` |
| `DUPLICATE_COMPONENT` | warning (across categories) or info (same category) | The same `componentKey` is costed on more than one line | `validate.ts` |
| `GPU_DOUBLE_COUNT` | warning | A self-hosted model already prices GPU time into its token rate, and a GPU cost line also exists | `validate.ts` |
| `REVIEW_DOUBLE_COUNT` | warning | Provider-borne review minutes exist, and so does a `human_review` or `exception_handling` cost line | `validate.ts` |
| `ACU_WEIGHTS_MISSING` | error | Method B weight set not found | `validate.ts` |
| `ACU_WEIGHTS_STATUS` | warning | Method B weight set is not approved | `validate.ts` |
| `ACU_REFERENCE` | error | Method A reference value is 0 or less | `validate.ts` |
| `ACU_IMPL` | info | Implementation is listed as an ACU-eligible pool and is excluded | `validate.ts` |
| `UNKNOWN_ROLE` | warning | An activity has no valid role or rate | `validate.ts` |
| `MARGIN_RANGE` | error | The implementation target margin, an enabled stream's target margin, or the ACU or ABU rate-card margin floor is 100% or more. The engine applies 99% instead. | `validate.ts` |
| `TERM` | error | Contract term is below 1 month; the projection treats it as 1 | `validate.ts` |
| `FIXED_FEE_RUN_POOLS` | error | A one-time fee claims run pools | `validate.ts`, `pricing.ts` |
| `SUB_NO_UNIT_STREAM` | info | The subscription includes units but no matching unit stream exists, so overage is at marginal cost + margin | `validate.ts` |
| `MULTI_SUB` | error | More than one enabled subscription stream | `validate.ts` |
| `MULTI_UNIT_STREAM` | error | More than one enabled ACU or ABU stream | `validate.ts` |
| `CAPACITY_UNVALIDATED` | info | A proposed capacity-conversion line is excluded from validated ROI | `validate.ts` |
| `NO_PRODUCTIVITY` | info | A workflow has no productivity baseline | `validate.ts` |
| `DOUBLE_RECOVERY` | error | A pool is recovered by two or more streams | `pricing.ts` |
| `UNRECOVERED_POOL` | warning | A pool with cost is recovered by no stream | `pricing.ts` |
| `ACU_FLOOR` | warning | The ACU price was raised to the margin floor | `pricing.ts` |
| `ZERO_ACU` | warning | No ACUs at the pricing basis, so an ACU price cannot recover cost | `pricing.ts` |
| `ABU_FLOOR` | warning | A workflow's ABU price was raised to the margin floor | `pricing.ts` |
| `ZERO_ABU` | warning | No weighted ABUs at the pricing basis, so a per-ABU price cannot recover cost and ABU minimum commitments bill nothing | `pricing.ts` |
| `PASS_THROUGH_IMPL` | warning | A pass-through stream claims implementation | `pricing.ts` |
| `MODEL` | warning | A snapshot warning: a step with no routing, a model not in the rate card, an unknown price item, an unknown workflow on a cost line, a derived ACU resource mapping, or a missing Method B weight set | `compute.ts` (from `model.ts`) |
| `SCHEDULE` | error | A circular or unknown activity dependency | `compute.ts` (from `implementation.ts`) |

All three sample projects produce only two issues, both information: `SAMPLE_RATES` and `CAPACITY_UNVALIDATED`.

---

## 18. Reconciliation checks

Source: `compute.ts › reconcile()`. A check passes when |expected − actual| ≤ max(0.000001, |expected| × 10⁻¹²). Cost breakdown checks run on the baseline (steady-state) snapshot; revenue and cost checks run on the full term.

| Id | Check |
|---|---|
| `pools` | Run cost by pool = total run cost |
| `workflows` | Run cost by workflow = total run cost |
| `agents` | Fully loaded cost by agent = total run cost |
| `functions` | Cost by business function = total run cost |
| `llm-model` | LLM cost by model = LLM total |
| `llm-agent` | LLM cost by agent = LLM total |
| `llm-workflow` | LLM cost by workflow = LLM total |
| `tokens` | Uncached + cache-read + cache-write tokens = input tokens (no double count) |
| `cost-lines` | Cost lines allocated to workflows = cost-line totals |
| `funnel` | Accepted + rejected + failed = attempted |
| `abu-classes` | Σ class weighted ABUs = weighted ABUs |
| `acu-workflow` | ACUs by workflow = total ACUs |
| `implementation` | Labour + expenses + contingency = implementation cost |
| `impl-phase` | Implementation cost by phase = labour cost |
| `tcv-months` | Σ monthly revenue = TCV |
| `tcv-years` | Σ yearly revenue = TCV |
| `cost-years` | Σ yearly cost = total provider cost |
| `rev-streams` | Revenue by stream = total revenue |
| `cost-streams` | Cost attributed to streams + unrecovered = total cost |
| `steady-streams` | Steady-state revenue by stream = steady revenue |
| `abu-recovery` | ABU recovered cost by workflow + absorbed failure cost = ABU stream recovered cost (only when an ABU stream exists) |
| `client-investment` | Client investment = provider revenue + client internal costs |

AP and Customer Service pass 22 of 22 checks. RFP passes 21 of 21, because it has no ABU stream. The test suite also requires every process template to build a project that reconciles.

---

## 19. Role-based access control

Source: `rbac.ts`. The engine defines the permission matrix and `can(role, permission)`. An unknown role has no permissions. Enforcement is the calling application's responsibility.

| Permission | Administrator | Consultant | Solution Architect | AI Engineering | Finance | Business Leader (read-only) |
|---|:-:|:-:|:-:|:-:|:-:|:-:|
| `project.create` | ✓ | ✓ | ✓ | | | |
| `project.edit` | ✓ | ✓ | ✓ | | | |
| `project.delete` | ✓ | | | | | |
| `implementation.edit` | ✓ | ✓ | ✓ | | | |
| `tokenomics.edit` | ✓ | | ✓ | ✓ | | |
| `pricing.edit` | ✓ | ✓ | | | ✓ | |
| `ratecard.approve` | ✓ | | | | ✓ | |
| `value.edit` | ✓ | ✓ | | | ✓ | |
| `benefit.validate` | ✓ | | | | ✓ | |
| `catalog.edit` | ✓ | | | | ✓ | |
| `actuals.edit` | ✓ | | | ✓ | ✓ | |
| `scenario.save` | ✓ | ✓ | ✓ | ✓ | ✓ | |
| `report.export` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `audit.view` | ✓ | | | | ✓ | |
| `user.manage` | ✓ | | | | | |

Only Finance (and the Administrator) can validate benefits. Only validated or realised benefits count in the default ROI view.

---

## 20. Known limitations and modelling assumptions

These follow from how the code works today. They should be considered when interpreting results.

**Consumption and cost model**

1. **Mix-weighted token scaling.** Tokens per call are multiplied by one mix-weighted average consumption multiplier; individual classes are not costed. All classes share the same calls per execution, cacheable prefix (which is not scaled), cache hit rate and funnel rates (success, acceptance, retry, human intervention). Class volumes are the accepted volume × share.
2. **Reported context utilisation is an average.** The utilisation reported on each LLM line uses mix-average tokens. Only the `CONTEXT_WINDOW` validation checks the most complex class ([5.8](#58-context-utilisation)).
3. **Execution drivers differ by basis.** LLM consumption and `per_llm_call` lines use execution equivalents, which include partial retries and failures. `per_execution` lines and Method B tool calls and executions count every retry and failure in full.
4. **Failure-cost fractions are approximations.** The LLM waste fraction `1 − accepted / executionEquivalents` assumes each accepted transaction consumed exactly one full execution.
5. **Marginal cost** comes from a 1% volume increase at steady state. It is a linear approximation that excludes fixed costs.
6. **Non-LLM cost is allocated to agents by LLM-cost share.** An agent's fully loaded cost includes a share of hosting, OCR, AgentOps and review in proportion to its LLM spend in each workflow. Agents with no LLM steps receive no cost.
7. **Single FX table.** One set of rates applies for the whole term, so there is no FX movement in the projection.
8. **The missing-FX fallback covers only some entry points.** `computeProject()`, and therefore `runScenario()` and `sensitivity()`, treat a currency with no rate as 1:1 with the base and report `FX_MISSING`. `costWaterfall()`, `findOptimizations()` and `breakEven()` call the cost model with the catalogue as given and still throw `FxError` for that currency.
9. **Annual steps.** Growth, cost inflation, LLM price change and escalation change once a year (months 13 and 25), not monthly. The go-live ramp is linear and the same for every workflow.

**Pricing**

10. **Implementation cash in month 0.** The whole implementation cost and fee fall in month 0, with no milestone billing. The schedule's duration in weeks does not move go-live or the projection. Under time and materials the whole T&M value is also billed in month 0.
11. **All-units tier cliffs.** Under `all_units`, crossing a threshold reprices every unit, so revenue can fall as volume rises. On the AP rate card, 60,000 ABUs bill INR 2,270,420.52 and 60,001 ABUs bill INR 2,202,344.61. The margin floor limits how far a band can fall but does not remove the cliff.
12. **Prices are set at one pricing basis.** The steady contract-year-1 month is used, and prices do not account for tier discounts. AP's steady margin is therefore 34.95% against a 35% target.
13. **Subscription overage is billed at one flat rate.** This is by design. When a subscription bills overage through an ACU or ABU stream, the overage rate is the ACU price or blended ABU price × (1 + premium). That stream's volume tiers, minimum commitment, ACU floor and per-workflow and per-class ABU prices are not used, so tiers configured on it have no effect.
14. **Out-of-range margins are capped, not rejected.** A target margin or margin floor of 100% or more is applied as 99%, which prices at 100× cost. The result is flagged with a `MARGIN_RANGE` error but is still calculated, so it must not be quoted. A contract term below 1 month is treated as 1 and flagged `TERM`.
15. **Gainshare threshold and cap are monthly** (one twelfth of the annual figures), and gainshare is not escalated.
16. **Break-even is searched on a grid.** Gross profit is checked at 24 fixed volume multipliers between 0.0001× and 128× before bisection. A loss-making band that falls entirely between two profitable grid points is not detected.

**Value and ROI**

17. **Benefits follow attempted volume, not outcomes.** Benefit lines are fixed amounts, optionally scaled by attempted volume, so they do not respond to success, acceptance or human-intervention rates. Under ABU pricing, a lower success rate lowers fees without lowering benefits. In the AP sensitivity, success −3 pp raises client ROI to 37.29% and +3 pp lowers it to 30.98%.
18. **Double ramp for volume-scaled benefits.** A benefit that scales with volume gets both its own ramp and the go-live volume ramp, through the volume index.
19. **The steady value month counts every benefit line at full ramp**, including lines that start later. AP's "Avoided hiring for volume growth" starts in month 13 but is in the steady validated figure of INR 4,806,250.
20. **Overlap winners can change from month to month**, because the largest counted line in each group is chosen every month. The capacity-conversion cap compares against productivity value across all workflows.
21. **Rejected transactions are redone manually by the client.** In the value model, every rejected or failed transaction adds its full manual minutes to the client's after-AI hours, whoever bears review. With provider-borne review, the provider's rework minutes on rejected transactions are also a provider cost, so the provider's rework and the client's manual redo are both counted, as costs to different parties.
22. **Working capital is entered, not modelled**, as an annual financing benefit (section 13.2).
23. **Payback counting.** Payback counts months from month 0 (the implementation month as time zero), and the crossing month is interpolated linearly.

**Other**

24. **Variance analysis** allocates each month's *validated* benefit to workflows by run-cost share and returns it in the field `forecastBenefit`. Estimated tokens include reasoning tokens; actual tokens are input + output as recorded.
25. **Reconciliation** proves the breakdowns of the steady-state snapshot and the term totals. It does not re-check every month's breakdowns.
26. **Stored but not calculated.** Outcome KPIs (before and after) and rate-card version records are stored for reporting and governance. No calculation uses them.
27. **Template sizing is heuristic.** Implementation effort, hosting nodes, AgentOps FTEs and the placeholder capacity-conversion benefit from `templates.ts` are starting assumptions, and every line is editable.

---

## Appendix A: reproducing the numbers

From the repository root:

```bash
npx tsx -e "import { computeProject, defaultCatalog, sampleProjects } from './packages/engine/src/index.ts'; \
const c = defaultCatalog(); const r = computeProject(sampleProjects(c)[0], c); \
console.log(r.baseline.totalRunCost.toFixed(2), r.economics.provider.tcv.toFixed(2), r.economics.client.roiPct.toFixed(2), r.reconciliation.filter(x => x.pass).length);"
```

Expected output: `1513811.40 117904895.33 34.06 22`.

The engine tests (`npm run test -w @aies/engine`) cover tokenomics, ACU/ABU, pricing, value and ROI, scenarios, integrity and regressions for invalid inputs. All 92 tests passed when this document was last updated. The reports package has 43 tests (`npm run test -w @aies/reports`), including a LibreOffice recalculation of the Excel model that is skipped when LibreOffice is not installed, and the API has 27 (`npm run test -w @aies/api`). `npm test` at the repository root runs all three.
