# Glossary

Short definitions of terms used in the Enterprise AI Economics & Commercialization Studio. Where a term has a formula, it matches the engine in `packages/engine/src`. For full detail, see [METHODOLOGY.md](METHODOLOGY.md).

## Units and metering

**ACU (AI Consumption Unit).** A commercial unit of AI consumption defined by this product. It is not an industry standard, and one ACU is not one token. It is measured by Method A or Method B; the project chooses which one is billed. Measurement (`acu.ts`) is separate from price (`pricing.ts`).

**ACU Method A (cost-normalised).** ACUs = eligible AI consumption cost at base-year prices ÷ the reference value (for example, 1 ACU = INR 1). Eligible pools are chosen per project; the default is LLM, orchestration, RAG and document processing. Measuring at base-year prices means supplier price changes do not change the ACU count.

**ACU Method B (weighted resources).** ACUs = Σ resource usage ÷ unit scale × weight, using a versioned, approvable **weight set**. Resources are tokens, calls, executions, tool calls, embeddings, vector queries, OCR pages, GPU-hours, storage and monitoring events.

**Derived resource.** An ACU resource that the engine calculates from the workflow and tokenomics model: input, cached, output and reasoning tokens, LLM calls, workflow executions and tool calls. Cost lines may not map to derived resources, which prevents double counting.

**ABU (AI Business Unit).** One accepted business outcome of a workflow, as defined by the workflow's ABU definition and acceptance criteria (for example, "one invoice posted to the ERP"). Only accepted transactions earn ABUs. Failures, rejections and retries do not.

**Weighted ABU.** An accepted transaction multiplied by its complexity class's ABU weight. For example, a complex invoice with weight 3 is 3 weighted ABUs. ABU prices are quoted per weighted ABU.

**Billable units.** Weighted ABUs adjusted for the human-assisted price factor: Σ (autonomous + human-assisted × factor) × weight. They are used to set the ABU price so that revenue still meets the target margin.

**Complexity class.** A segment of a workflow's transactions. Each has a mix share, an ABU weight, a consumption multiplier (applied to tokens and complexity-scaled cost lines), a human-effort multiplier (applied to review minutes) and an optional price override.

## Transaction funnel

**Attempted transaction.** A unique business transaction started in a month. Retries are not new attempted transactions.

**Completed / failed.** Completed = attempted × success rate. Failed = attempted − completed.

**Accepted / rejected.** Accepted = completed × acceptance rate. Rejected = completed − accepted. Accepted + rejected + failed = attempted.

**Human-assisted / autonomous.** Human-assisted = accepted × human-intervention rate. Autonomous = accepted − human-assisted.

**Retry.** An additional execution of the same transaction. Retries = attempted × retry rate. They add consumption and cost but never ABUs.

**Execution.** One run of a workflow. Executions = attempted + retries.

**Execution equivalent.** One full execution's worth of consumption. Execution equivalents = completed + failed × failed-consumption % + retries × retry-consumption %. They drive LLM calls and `per_llm_call` costs.

## Cost

**Cost pool.** A group of costs. Implementation (one-time) plus eight recurring run pools: LLM, orchestration, RAG, document processing, infrastructure, AgentOps, human review and other. Each non-LLM cost category maps to one pool.

**Run cost.** The sum of the eight run pools for a month.

**Cost line.** A configured non-LLM cost. It has a category, a basis (`fixed_monthly`, `per_execution`, `per_attempted`, `per_accepted`, `per_llm_call` or `allocated_shared`), a unit cost or a link to a catalogue price item, and a workflow allocation method.

**Fully loaded cost by agent.** A workflow's entire run cost shared among its agents in proportion to each agent's LLM cost in that workflow.

**Failure cost.** The part of each pool spent on work that did not become an accepted transaction: failed executions, partial retries, rejected transactions and rework.

**Cost-to-serve.** Steady-state monthly run cost. Cost-to-serve per ABU = run cost ÷ weighted ABUs.

**Marginal cost per unit.** The change in run cost from a 1% volume increase at steady state, divided by the change in ACUs or weighted ABUs. Fixed costs are excluded. It prices subscription overage when there is no unit stream.

**Cache semantics.** How a model bills cached input:

- `none`: no caching.
- `discounted_read`: cache hits are billed at a read rate, with no write charge.
- `read_write`: hits are billed at a read rate and misses on the cacheable prefix at a write rate.

In every case, uncached + cache read + cache write = input tokens.

**Reasoning tokens.** "Thinking" tokens billed at the reasoning rate (the output rate by default) and counted separately from output tokens.

**Self-hosted rate.** A per-1M-token rate derived from GPU economics: GPU-hour cost × GPUs per replica ÷ (output tokens per second × 3,600 × utilisation) × 1,000,000. Input tokens are priced at a set ratio of that output rate.

**Sample rate.** A catalogue rate marked `sample: true`. It is illustrative only, not a vendor quote, and must be replaced before quoting.

## Pricing and commercial terms

**Revenue stream.** One component of a commercial model: fixed fee, fixed monthly, ACU, ABU, subscription, AgentOps, pass-through or gainshare. Each declares the cost pools it recovers.

**Recovery matrix.** The mapping from each cost pool to the stream or streams that recover it. A pool claimed by two streams is a double-billing error (`DOUBLE_RECOVERY`). A pool with cost and no stream is a margin-leakage warning (`UNRECOVERED_POOL`).

**Pricing basis.** The single month from which prices are derived: the baseline snapshot, fully ramped, in contract year 1, at base volume.

**Price book.** The set of derived prices and fees for a project. Once derived, it is **locked**: later months bill these prices, escalated by contract year, against actual volumes. Scenarios keep it locked unless repricing is requested.

**Steady state.** A fully ramped month in contract year 1 at base volume, billed at year-1 prices, with every benefit line fully ramped. It supplies MRR, ARR, steady margin and cost-to-serve.

**Target margin.** Gross margin a price is set to achieve: price = cost ÷ (1 − margin).

**Margin floor.** The minimum margin on unit cost. ACU and ABU prices (including negotiated overrides) are raised to it when the price book is built. It is also applied inside ACU tier billing, but not inside ABU tier billing.

**Volume tier.** A discount that applies above a monthly unit threshold.

- **Graduated:** each band is priced at its own discount.
- **All-units:** every unit is priced at the discount of the highest tier reached, which creates a revenue cliff at each threshold.

**Minimum commitment.** For ACUs, a minimum monthly charge in money; any shortfall is billed as a true-up. For ABUs, a minimum monthly quantity of weighted ABUs; any shortfall is billed at the blended ABU price.

**Human-assisted price factor.** A multiplier applied to the price of human-assisted completions (1 = same price as autonomous). The base price adjusts so revenue still meets the target margin.

**Failed-cost allocation.** How failure cost is treated in the ABU price:

- `spread`: accepted ABUs carry it.
- `provider_absorbs`: it is excluded from the price and reduces provider margin.

**Subscription.** A monthly platform fee plus an optional included allowance of ACUs or ABUs, with overage above the allowance at the unit price plus a premium. Without a matching unit stream, overage is priced at marginal cost plus margin.

**AgentOps.** The ongoing operation of AI agents in production: monitoring and triage (L1), incident and prompt fixes (L2), model and agent engineering (L3), quality evaluation, release management, governance and FinOps reporting. It is costed in the AgentOps pool and can be billed as a managed AgentOps fee.

**Pass-through.** Billing the actual monthly cost of the pools a stream owns, plus a handling markup.

**Gainshare.** An outcome-based fee: a share of the client's monthly validated (or forecast) benefit above one twelfth of an annual threshold, capped at one twelfth of an annual cap.

**Escalation.** The annual price increase applied from contract year 2 to fees, unit prices, allowances and commitments.

**Implementation fee.** The one-time price for building the solution, billed in month 0.

- Cost plus margin: cost ÷ (1 − margin) × (1 − discount).
- Time and materials (T&M): hours × bill rate + billable expenses.

**Commercial construct.** One of seven standard packages that reprice the same cost base for comparison: fixed fee, ACU, ABU, subscription, managed AgentOps, gainshare and hybrid (the project's own configuration).

## Contract metrics

**TCV (total contract value).** Total provider revenue over the contract: month 0 plus every run month.

**ACV (annual contract value).** TCV ÷ (term in months ÷ 12). It includes one-time revenue.

**MRR (monthly recurring revenue).** Steady-state recurring revenue.

**ARR (annual recurring revenue).** MRR × 12.

**Gross margin.** (Revenue − cost) ÷ revenue × 100.

**Ramp.** The go-live volume build-up: volume starts at a set percentage and rises linearly to 100% over the ramp months.

**Break-even volume.** The monthly volume at which steady-state gross profit is zero at locked prices. It is reported as "below" when the project is profitable at any volume.

## Value and ROI

**Productivity value.** Client hours saved × loaded hourly cost. It is non-cash and is reported but **not** counted as a financial benefit. Hours saved = hours before AI − hours after AI. Hours after include spot checks, client-borne review, and manual rework of failed and rejected transactions.

**FTE released.** Hours saved ÷ productive hours per FTE per month.

**Benefit line.** A financial benefit with:

- a category: hard savings, cost avoidance, revenue, working capital or capacity conversion
- an annual amount, start month, ramp, confidence and status

**Validated benefit.** A benefit line with status `finance_validated` or `realized`. Only these count in ROI by default.

**Forecast benefit.** Validated benefits plus `proposed` lines. Rejected lines never count.

**Confidence.** A percentage that each benefit line is multiplied by.

**Overlap group.** A label for benefit lines that are alternatives, such as two different claims on the same labour saving. Only the largest counted line in a group counts each month.

**Capacity conversion.** A benefit that turns released hours into cash (for example, redeployment or avoided backfill). The total of these lines is capped at the month's productivity value.

**Working-capital benefit.** Entered as the annual financing benefit of the cash released (balance × cost of capital), not the balance itself.

**Client internal cost.** The client's own costs of adopting the solution: one-time costs in month 0 and monthly costs, inflated each year.

**Total AI investment.** Provider revenue (TCV) plus client internal costs.

**ROI.** (Counted benefits − total AI investment) ÷ total AI investment × 100. With the default view, counted benefits are validated benefits. Yearly ROI uses the same formula within each contract year.

**NPV (net present value).** Σ monthly client net cash flow ÷ (1 + annual discount rate)^(month ÷ 12). Month 0 is not discounted.

**Payback.** The month in which the client's cumulative net cash flow turns non-negative and stays there, interpolated linearly within that month. It is 0 if never negative, and none if not reached within the term.

**Cost per successful outcome.** Total AI investment ÷ accepted transactions over the term.

## Governance

**Reconciliation check.** An automatic test that two ways of calculating the same total agree. For example, run cost by pool = by workflow = by agent = total. Every result carries its checks.

**Validation issue.** An error, warning or information message about the project's inputs or pricing, such as a missing FX rate, double recovery or a duplicate component.

**Scenario.** A what-if copy of the project with overrides (volume, tokens, routing, caching, retries, success, human intervention, complexity, infrastructure, AgentOps, margin, price). It is evaluated at locked prices unless repricing is requested.

**Cost waterfall.** A step-by-step attribution of the change in monthly run cost from baseline to a scenario, applying driver groups in a fixed order.

**Sensitivity (tornado).** Provider margin, cost per ABU and client ROI under low and high shocks to eleven drivers, sorted by the range of the margin.

**Variance analysis.** Estimated against actual volumes, tokens, cost, cost per accepted transaction and benefits for each run month and workflow.
