/**
 * Domain model for the Enterprise AI Economics & Commercialization Studio.
 *
 * All input types are plain JSON (numbers, strings) so projects can be stored
 * in PostgreSQL jsonb, versioned, exported and imported without loss. The
 * calculation engine lifts every number into Decimal before doing arithmetic.
 *
 * Conventions
 *  - Percentages are expressed 0–100 (e.g. successRatePct: 94).
 *  - Token prices are per 1,000,000 tokens.
 *  - Every money input carries its own currency; the engine converts to the
 *    project's reporting currency using the configured FX table.
 */

// ───────────────────────────── Cost pools ─────────────────────────────

export const COST_POOLS = [
  'IMPLEMENTATION',
  'LLM',
  'ORCHESTRATION',
  'RAG',
  'DOCUMENT',
  'INFRASTRUCTURE',
  'AGENTOPS',
  'HUMAN_REVIEW',
  'OTHER',
] as const;
export type CostPool = (typeof COST_POOLS)[number];

/** Pools that recur monthly once the solution is live. */
export const RUN_POOLS: CostPool[] = COST_POOLS.filter((p) => p !== 'IMPLEMENTATION');

/** Categories that a non-LLM cost line can belong to (each maps 1:1 to a pool). */
export const COST_CATEGORIES = ['ORCHESTRATION', 'RAG', 'DOCUMENT', 'INFRASTRUCTURE', 'AGENTOPS', 'OTHER'] as const;
export type CostCategory = (typeof COST_CATEGORIES)[number];

export const POOL_LABELS: Record<CostPool, string> = {
  IMPLEMENTATION: 'Implementation (one-time)',
  LLM: 'LLM consumption',
  ORCHESTRATION: 'Agent orchestration',
  RAG: 'RAG & knowledge',
  DOCUMENT: 'Document processing',
  INFRASTRUCTURE: 'Cloud infrastructure',
  AGENTOPS: 'AgentOps',
  HUMAN_REVIEW: 'Human review & exceptions',
  OTHER: 'Other attributable',
};

// ───────────────────────────── Catalogue ─────────────────────────────

export interface FxTable {
  /** Rates are units of currency per 1 unit of `base`. */
  base: string;
  asOf: string;
  source: string;
  rates: Record<string, number>;
}

export type CacheSemantics =
  /** No prompt caching: every input token billed at the input rate. */
  | 'none'
  /** Cache hits billed at a discounted read rate; no separate write charge (automatic caching). */
  | 'discounted_read'
  /** Cache hits billed at a read rate AND cache misses on the cacheable prefix billed at a write rate. */
  | 'read_write';

export type ModelTier = 'frontier' | 'balanced' | 'fast' | 'open';

export interface SelfHostedEconomics {
  gpuHourlyCost: number;
  gpusPerReplica: number;
  /** Sustained output tokens/sec per replica at the stated utilisation. */
  outputTokensPerSecond: number;
  utilizationPct: number;
  /** Prefill (input) cost relative to decode (output) cost, e.g. 0.25. */
  inputCostRatio: number;
}

export interface ModelRate {
  id: string;
  provider: string;
  model: string;
  version: string;
  hostingPlatform: string;
  region: string;
  currency: string;
  effectiveDate: string;
  tier: ModelTier;
  pricingBasis: 'per_token' | 'self_hosted';
  inputPerM: number;
  outputPerM: number;
  /** Reasoning/thinking tokens; defaults to the output rate when omitted. */
  reasoningPerM?: number;
  cacheSemantics: CacheSemantics;
  cacheReadPerM: number;
  cacheWritePerM: number;
  /** Discount applied to batch-eligible calls (e.g. 50). */
  batchDiscountPct: number;
  /** Flat per-call charges (e.g. grounding/search fees). */
  otherPerCall: number;
  contextWindow: number;
  selfHosted?: SelfHostedEconomics;
  source: string;
  assumptions: string;
  /** True for illustrative sample rates that must be verified before use. */
  sample: boolean;
}

export type AcuResourceKey =
  | 'input_tokens_m'
  | 'output_tokens_m'
  | 'cached_tokens_m'
  | 'reasoning_tokens_m'
  | 'llm_calls_k'
  | 'embedding_tokens_m'
  | 'vector_queries_k'
  | 'tool_calls_k'
  | 'workflow_executions_k'
  | 'gpu_hours'
  | 'ocr_pages_k'
  | 'storage_gb_month'
  | 'monitoring_events_k';

export interface AcuWeightSet {
  id: string;
  name: string;
  version: string;
  effectiveDate: string;
  author: string;
  status: 'draft' | 'approved' | 'retired';
  rationale: string;
  /** ACUs per resource unit (unit scale defined in ACU_RESOURCES). */
  weights: Partial<Record<AcuResourceKey, number>>;
}

export interface CloudPriceItem {
  id: string;
  cloud: string;
  service: string;
  category: CostCategory;
  componentKey: string;
  unitLabel: string;
  unitCost: number;
  currency: string;
  region: string;
  effectiveDate: string;
  source: string;
  sample: boolean;
  acuResourceKey?: AcuResourceKey;
  /** Multiplier from a billed unit to the ACU resource's raw unit (e.g. 1 page = 1 page). */
  acuUnitsPerUnit?: number;
}

export interface Catalog {
  version: string;
  modelRates: ModelRate[];
  fx: FxTable;
  acuWeightSets: AcuWeightSet[];
  cloudPrices: CloudPriceItem[];
}

// ───────────────────────────── Project ─────────────────────────────

export type SolutionType = 'assistant' | 'copilot' | 'single_agent' | 'multi_agent' | 'autonomous_workflow';
export type ProjectStatus = 'pre_sales' | 'in_delivery' | 'live';

export interface ClientInfo {
  clientName: string;
  industry: string;
  geography: string;
  businessFunction: string;
  businessProcess: string;
  engagementType: string;
}

export interface SolutionInfo {
  solutionType: SolutionType;
  cloudPlatform: string;
  llmProviders: string[];
  integrations: string[];
  dataSources: string[];
  ragRequired: boolean;
  documentProcessing: boolean;
  humanInTheLoop: boolean;
  securityRequirements: string;
  availabilitySla: string;
  supportSla: string;
  peakConcurrency: number;
  workingDaysPerMonth: number;
  /** Planned scope used for implementation sizing. */
  plannedAgents: number;
  plannedWorkflows: number;
}

export interface Agent {
  id: string;
  name: string;
  role: string;
}

export interface ModelRoute {
  modelId: string;
  sharePct: number;
}

export interface LlmStep {
  id: string;
  name: string;
  agentId: string;
  /** Model invocations of this step per workflow execution (may be fractional, e.g. 0.15). */
  callsPerExecution: number;
  inputTokens: number;
  outputTokens: number;
  /** Reasoning/thinking tokens per call (billed at reasoning rate). */
  reasoningTokens: number;
  /** Portion of input tokens that is a stable, cacheable prefix. */
  cacheablePrefixTokens: number;
  cacheHitRatePct: number;
  batchEligiblePct: number;
  /** Tool-related model call (e.g. a function-calling round trip). */
  toolCall: boolean;
  routing: ModelRoute[];
}

export interface ComplexityClass {
  id: string;
  name: string;
  sharePct: number;
  /** ABUs earned by one accepted transaction of this class. */
  abuWeight: number;
  /** Multiplier on LLM tokens and complexity-scaled cost lines. */
  consumptionMultiplier: number;
  /** Multiplier on human review minutes. */
  humanEffortMultiplier: number;
  /** Optional customer-specific price per transaction of this class. */
  priceOverride?: number | null;
}

export interface HumanReviewConfig {
  minutesPerAssistedTxn: number;
  minutesPerRejectedTxn: number;
  hourlyCost: number;
  currency: string;
  /** provider = part of the managed service (provider cost); client = client staff do it. */
  borneBy: 'provider' | 'client';
}

export interface Workflow {
  id: string;
  name: string;
  businessFunction: string;
  process: string;
  /** Singular business unit name, e.g. "invoice". */
  abuName: string;
  abuDefinition: string;
  acceptanceCriteria: string[];
  /** Unique business transactions attempted per month (retries are NOT new transactions). */
  monthlyVolume: number;
  annualGrowthPct: number;
  workflowSteps: number;
  toolCallsPerExecution: number;
  successRatePct: number;
  acceptanceRatePct: number;
  /** Average additional executions per attempted transaction (0.08 = 8% retried once). */
  retryRatePct: number;
  /** Consumption of a retry relative to a full execution. */
  retryConsumptionPct: number;
  /** Consumption of a failed execution relative to a full execution. */
  failedConsumptionPct: number;
  humanInterventionRatePct: number;
  complexity: ComplexityClass[];
  llmSteps: LlmStep[];
  humanReview: HumanReviewConfig;
}

export type CostBasis =
  | 'fixed_monthly'
  | 'per_execution'
  | 'per_attempted'
  | 'per_accepted'
  | 'per_llm_call'
  | 'allocated_shared';

export type WorkflowAllocation = 'by_attempted' | 'by_executions' | 'by_llm_cost' | 'equal';

export interface CostLine {
  id: string;
  category: CostCategory;
  name: string;
  /** Identifies the underlying component (e.g. "monitoring") — used to detect double counting. */
  componentKey: string;
  basis: CostBasis;
  unitCost: number;
  currency: string;
  unitLabel: string;
  /** fixed_monthly: units per month. Usage bases: units per driver event. */
  quantity: number;
  /** Restrict to one workflow; null = applies to / is shared across all workflows. */
  workflowId: string | null;
  /** allocated_shared: total monthly cost of the shared platform. */
  sharedTotalMonthly?: number;
  /** allocated_shared: share of the shared platform allocated to this project. */
  allocationPct?: number;
  /** How fixed/shared cost is split across workflows when workflowId is null. */
  workflowAllocation: WorkflowAllocation;
  scalesWithComplexity: boolean;
  acuResourceKey?: AcuResourceKey | null;
  /** Raw ACU resource units per billed unit (defaults to 1). */
  acuUnitsPerUnit?: number;
  priceRef?: string | null;
  notes?: string;
}

export interface Role {
  id: string;
  name: string;
  costRate: number;
  billRate: number;
  currency: string;
}

export interface Activity {
  id: string;
  phase: string;
  name: string;
  roleId: string;
  effort: number;
  effortUnit: 'hours' | 'days';
  durationWeeks: number;
  dependsOn: string[];
}

export interface DirectExpense {
  id: string;
  name: string;
  amount: number;
  currency: string;
  /** Re-billed to the client at cost under T&M pricing. */
  billable: boolean;
}

export interface ImplementationPlan {
  roles: Role[];
  activities: Activity[];
  directExpenses: DirectExpense[];
  contingencyPct: number;
  hoursPerDay: number;
  targetMarginPct: number;
  pricingMethod: 'cost_plus_margin' | 'time_and_materials';
  discountPct: number;
}

export type AcuMethod = 'cost_normalized' | 'weighted_resource';

export interface AcuConfig {
  method: AcuMethod;
  /** Method A: 1 ACU = referenceValue of eligible AI consumption cost. */
  referenceValue: number;
  referenceCurrency: string;
  /** Method A: which cost pools count as eligible AI consumption. */
  eligiblePools: CostPool[];
  /** Method B: weight set from the catalogue. */
  weightSetId: string;
}

export type StreamType =
  | 'fixed_fee'
  | 'fixed_monthly'
  | 'acu'
  | 'abu'
  | 'subscription'
  | 'agentops'
  | 'pass_through'
  | 'gainshare';

export interface RevenueStream {
  id: string;
  type: StreamType;
  label: string;
  enabled: boolean;
  /** Cost pools this stream is responsible for recovering. Each pool may be recovered by one stream only. */
  recovers: CostPool[];
  targetMarginPct: number;
  discountPct: number;
  /** fixed_fee only: price from the implementation plan (default) or from this stream's margin/discount. */
  useImplementationPlanPrice?: boolean;
}

export interface VolumeTier {
  /** Tier starts above this many units per month. */
  fromUnits: number;
  discountPct: number;
}

export interface AcuRateCard {
  tierMode: 'graduated' | 'all_units';
  tiers: VolumeTier[];
  minMonthlyCommitment: number;
  marginFloorPct: number;
  /** Customer-specific negotiated price per ACU (overrides derived price). */
  priceOverride: number | null;
}

export interface AbuRateCard {
  tierMode: 'graduated' | 'all_units';
  tiers: VolumeTier[];
  /** Minimum weighted ABUs billed per month (shortfall billed at the blended price). */
  minMonthlyAbus: number;
  marginFloorPct: number;
  classPricing: 'weighted' | 'override';
  failedCostAllocation: 'spread' | 'provider_absorbs';
  /** Price factor for human-assisted completions (1 = same price as autonomous). */
  humanAssistedPriceFactor: number;
  /** Customer-specific price per weighted ABU by workflow. */
  priceOverrides: Record<string, number | null>;
}

export interface SubscriptionConfig {
  includedUnit: 'acu' | 'abu' | 'none';
  includedQty: number;
  includedDiscountPct: number;
  overagePremiumPct: number;
}

export interface GainshareConfig {
  sharePct: number;
  /** Annual benefit threshold before gainshare applies. */
  thresholdAnnual: number;
  capAnnual: number | null;
  basis: 'validated' | 'all';
}

export interface RateCardVersion {
  id: string;
  version: string;
  createdAt: string;
  author: string;
  status: 'draft' | 'approved' | 'superseded';
  note: string;
  acuPrice: string | null;
  abuPrices: Record<string, string>;
  subscriptionFee: string | null;
  agentOpsFee: string | null;
}

export interface PricingConfig {
  termMonths: number;
  priceEscalationPct: number;
  costInflationPct: number;
  llmPriceChangePct: number;
  rampMonths: number;
  rampStartPct: number;
  passThroughMarkupPct: number;
  streams: RevenueStream[];
  acuRateCard: AcuRateCard;
  abuRateCard: AbuRateCard;
  subscription: SubscriptionConfig;
  gainshare: GainshareConfig;
  rateCardVersions: RateCardVersion[];
}

export type BenefitCategory =
  | 'hard_savings'
  | 'cost_avoidance'
  | 'revenue'
  | 'working_capital'
  | 'capacity_conversion';

export type BenefitStatus = 'proposed' | 'finance_validated' | 'realized' | 'rejected';

export interface BenefitLine {
  id: string;
  name: string;
  category: BenefitCategory;
  annualAmount: number;
  currency: string;
  /** First run month the benefit starts accruing (1 = go-live month). */
  startMonth: number;
  rampMonths: number;
  confidencePct: number;
  status: BenefitStatus;
  validatedBy?: string;
  validatedOn?: string;
  /** Benefits sharing an overlap group are not additive — only the largest counts. */
  overlapGroup?: string | null;
  scalesWithVolume: boolean;
  notes?: string;
}

export interface ProductivityInput {
  workflowId: string;
  manualMinutesBefore: number;
  spotCheckMinutesAutonomous: number;
  loadedHourlyCost: number;
  currency: string;
  productiveHoursPerFteMonth: number;
}

export interface ClientCost {
  id: string;
  name: string;
  type: 'one_time' | 'monthly';
  amount: number;
  currency: string;
}

export interface OutcomeKpi {
  id: string;
  name: string;
  unit: string;
  before: number;
  after: number;
  higherIsBetter: boolean;
}

export interface ValueModel {
  productivity: ProductivityInput[];
  benefits: BenefitLine[];
  clientCosts: ClientCost[];
  discountRatePct: number;
  includeUnvalidated: boolean;
  kpis: OutcomeKpi[];
}

export interface ActualRecord {
  period: string; // YYYY-MM
  /** Run month this period corresponds to (1 = go-live month). */
  monthIndex: number;
  workflowId: string;
  attempted: number;
  accepted: number;
  inputTokens: number;
  outputTokens: number;
  llmCost: number;
  nonLlmCost: number;
  realizedBenefit: number;
  currency: string;
}

export interface ScenarioRecord {
  id: string;
  name: string;
  version: number;
  createdAt: string;
  author: string;
  overrides: ScenarioOverrides;
}

export interface Project {
  id: string;
  name: string;
  status: ProjectStatus;
  currency: string;
  goLiveDate: string; // YYYY-MM
  createdAt: string;
  updatedAt: string;
  owner: string;
  illustrative: boolean;
  client: ClientInfo;
  solution: SolutionInfo;
  agents: Agent[];
  workflows: Workflow[];
  implementation: ImplementationPlan;
  costLines: CostLine[];
  acu: AcuConfig;
  pricing: PricingConfig;
  value: ValueModel;
  actuals: ActualRecord[];
  scenarios: ScenarioRecord[];
}

// ───────────────────────────── Scenarios ─────────────────────────────

export interface ScenarioOverrides {
  volumeMultiplier?: number;
  inputTokenMultiplier?: number;
  outputTokenMultiplier?: number;
  retryRatePct?: number | null;
  /** Multiply every workflow's retry rate. */
  retryMultiplier?: number;
  successRateDeltaPp?: number;
  humanInterventionDeltaPp?: number;
  cacheHitRatePct?: number | null;
  /** Add percentage points to every step's cache hit rate. */
  cacheHitDeltaPp?: number;
  /** Re-route this share of every step's traffic to the given model. */
  routingShift?: { toModelId: string; sharePct: number } | null;
  /** Replace one model with another everywhere. */
  modelSwap?: { fromModelId: string; toModelId: string } | null;
  infraMultiplier?: number;
  agentOpsMultiplier?: number;
  /** Shift this many percentage points of mix from the simplest class to the most complex. */
  complexityShiftPp?: number;
  targetMarginPct?: number | null;
  priceMultiplier?: number;
  growthPct?: number | null;
  /** Re-derive prices at target margin (true) or keep the contracted prices locked (false). */
  repriceAtTargetMargin?: boolean;
}
