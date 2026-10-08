/**
 * Request-body schemas (zod v4).
 *
 * The Project schema mirrors @aies/engine `Project` structurally (types,
 * required keys, enums) so the engine never sees a shape it would crash on.
 * Domain rules (rates within 0–100, routing sums, unknown models, FX…) are
 * left to the engine's validateProject(), whose issues are returned on save.
 * Objects are "loose": unknown keys are preserved for forward compatibility.
 * Array and range caps bound the work one request can cause.
 */
import { z } from 'zod';
import { ACU_RESOURCE_KEYS, COST_CATEGORIES, COST_POOLS, ROLES } from '@aies/engine';

// ───────────────────────────── primitives ─────────────────────────────

const num = z.number(); // zod 4 rejects NaN and ±Infinity
const nonNeg = z.number().min(0);
const str = z.string().max(20_000);
const shortStr = z.string().max(500);
export const idStr = z.string().min(1).max(128);
export const currency = z.string().regex(/^[A-Z]{3}$/, 'must be a 3-letter ISO currency code (e.g. INR)');
export const period = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'must be YYYY-MM');
const isoDate = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/, 'must be a date (YYYY-MM-DD)');
/** Exact decimal input: a JSON number or a numeric string such as "1234.5600". */
export const decimalInput = z.union([num, z.string().regex(/^-?\d{1,20}(\.\d{1,12})?$/, 'must be a decimal number')]);

const pool = z.enum(COST_POOLS);
const category = z.enum(COST_CATEGORIES);
const acuKey = z.enum(ACU_RESOURCE_KEYS as [string, ...string[]]);

// ───────────────────────────── catalogue ─────────────────────────────

export const ModelRateSchema = z.looseObject({
  id: idStr,
  provider: shortStr,
  model: shortStr,
  version: shortStr,
  hostingPlatform: shortStr,
  region: shortStr,
  currency,
  effectiveDate: shortStr,
  tier: z.enum(['frontier', 'balanced', 'fast', 'open']),
  pricingBasis: z.enum(['per_token', 'self_hosted']),
  inputPerM: nonNeg,
  outputPerM: nonNeg,
  reasoningPerM: nonNeg.optional(),
  cacheSemantics: z.enum(['none', 'discounted_read', 'read_write']),
  cacheReadPerM: nonNeg,
  cacheWritePerM: nonNeg,
  batchDiscountPct: z.number().min(0).max(100),
  otherPerCall: nonNeg,
  contextWindow: z.number().int().positive(),
  selfHosted: z
    .looseObject({
      gpuHourlyCost: nonNeg,
      gpusPerReplica: z.number().positive(),
      outputTokensPerSecond: z.number().positive(),
      utilizationPct: z.number().gt(0).max(100),
      inputCostRatio: nonNeg,
    })
    .optional(),
  source: str,
  assumptions: str,
  sample: z.boolean(),
});

export const CloudPriceItemSchema = z.looseObject({
  id: idStr,
  cloud: shortStr,
  service: shortStr,
  category,
  componentKey: shortStr,
  unitLabel: shortStr,
  unitCost: nonNeg,
  currency,
  region: shortStr,
  effectiveDate: shortStr,
  source: str,
  sample: z.boolean(),
  acuResourceKey: acuKey.optional(),
  acuUnitsPerUnit: nonNeg.optional(),
});

export const FxTableSchema = z.strictObject({
  base: currency,
  asOf: isoDate,
  source: z.string().min(1).max(2000),
  rates: z
    .record(currency, z.union([z.number().positive().max(1e13), z.string().regex(/^\d{1,13}(\.\d{1,10})?$/)]))
    .refine((r) => Object.keys(r).length > 0 && Object.keys(r).length <= 300, 'must contain between 1 and 300 currencies'),
});

export const AcuWeightSetSchema = z.looseObject({
  id: idStr,
  name: shortStr,
  version: z.string().min(1).max(32).regex(/^[A-Za-z0-9._-]+$/, 'may contain letters, digits, ".", "_" and "-"'),
  effectiveDate: shortStr,
  author: shortStr.optional(),
  status: z.enum(['draft', 'approved', 'retired']).optional(),
  rationale: str,
  weights: z.partialRecord(acuKey, nonNeg),
});

// ───────────────────────────── project ─────────────────────────────

const ClientInfoSchema = z.looseObject({
  clientName: shortStr,
  industry: shortStr,
  geography: shortStr,
  businessFunction: shortStr,
  businessProcess: shortStr,
  engagementType: shortStr,
});

const SolutionInfoSchema = z.looseObject({
  solutionType: z.enum(['assistant', 'copilot', 'single_agent', 'multi_agent', 'autonomous_workflow']),
  cloudPlatform: shortStr,
  llmProviders: z.array(shortStr).max(50),
  integrations: z.array(shortStr).max(200),
  dataSources: z.array(shortStr).max(200),
  ragRequired: z.boolean(),
  documentProcessing: z.boolean(),
  humanInTheLoop: z.boolean(),
  securityRequirements: str,
  availabilitySla: shortStr,
  supportSla: shortStr,
  peakConcurrency: nonNeg,
  workingDaysPerMonth: nonNeg,
  plannedAgents: nonNeg,
  plannedWorkflows: nonNeg,
});

const AgentSchema = z.looseObject({ id: idStr, name: shortStr, role: str });

const LlmStepSchema = z.looseObject({
  id: idStr,
  name: shortStr,
  agentId: z.string().max(128),
  callsPerExecution: num,
  inputTokens: num,
  outputTokens: num,
  reasoningTokens: num,
  cacheablePrefixTokens: num,
  cacheHitRatePct: num,
  batchEligiblePct: num,
  toolCall: z.boolean(),
  routing: z.array(z.looseObject({ modelId: idStr, sharePct: num })).max(20),
});

const ComplexityClassSchema = z.looseObject({
  id: idStr,
  name: shortStr,
  sharePct: num,
  abuWeight: num,
  consumptionMultiplier: num,
  humanEffortMultiplier: num,
  priceOverride: num.nullable().optional(),
});

const HumanReviewSchema = z.looseObject({
  minutesPerAssistedTxn: num,
  minutesPerRejectedTxn: num,
  hourlyCost: num,
  currency,
  borneBy: z.enum(['provider', 'client']),
});

const WorkflowSchema = z.looseObject({
  id: idStr,
  name: shortStr,
  businessFunction: shortStr,
  process: shortStr,
  abuName: shortStr,
  abuDefinition: str,
  acceptanceCriteria: z.array(str).max(100),
  monthlyVolume: num,
  annualGrowthPct: num,
  workflowSteps: num,
  toolCallsPerExecution: num,
  successRatePct: num,
  acceptanceRatePct: num,
  retryRatePct: num,
  retryConsumptionPct: num,
  failedConsumptionPct: num,
  humanInterventionRatePct: num,
  complexity: z.array(ComplexityClassSchema).max(20),
  llmSteps: z.array(LlmStepSchema).max(100),
  humanReview: HumanReviewSchema,
});

const CostLineSchema = z.looseObject({
  id: idStr,
  category,
  name: shortStr,
  componentKey: z.string().max(128),
  basis: z.enum(['fixed_monthly', 'per_execution', 'per_attempted', 'per_accepted', 'per_llm_call', 'allocated_shared']),
  unitCost: num,
  currency,
  unitLabel: shortStr,
  quantity: num,
  workflowId: idStr.nullable(),
  sharedTotalMonthly: num.optional(),
  allocationPct: num.optional(),
  workflowAllocation: z.enum(['by_attempted', 'by_executions', 'by_llm_cost', 'equal']),
  scalesWithComplexity: z.boolean(),
  acuResourceKey: acuKey.nullable().optional(),
  acuUnitsPerUnit: num.optional(),
  priceRef: z.string().max(128).nullable().optional(),
  notes: str.optional(),
});

const ImplementationSchema = z.looseObject({
  roles: z.array(z.looseObject({ id: idStr, name: shortStr, costRate: num, billRate: num, currency })).max(200),
  activities: z
    .array(
      z.looseObject({
        id: idStr,
        phase: shortStr,
        name: shortStr,
        roleId: z.string().max(128),
        effort: num,
        effortUnit: z.enum(['hours', 'days']),
        durationWeeks: num,
        dependsOn: z.array(z.string().max(128)).max(200),
      }),
    )
    .max(2000),
  directExpenses: z.array(z.looseObject({ id: idStr, name: shortStr, amount: num, currency, billable: z.boolean() })).max(500),
  contingencyPct: num,
  hoursPerDay: num,
  targetMarginPct: num,
  pricingMethod: z.enum(['cost_plus_margin', 'time_and_materials']),
  discountPct: num,
});

const AcuConfigSchema = z.looseObject({
  method: z.enum(['cost_normalized', 'weighted_resource']),
  referenceValue: num,
  referenceCurrency: currency,
  eligiblePools: z.array(pool).max(COST_POOLS.length * 2),
  weightSetId: z.string().max(128),
});

const TierSchema = z.looseObject({ fromUnits: num, discountPct: num });

const PricingSchema = z.looseObject({
  termMonths: z.number().int().min(1).max(240),
  priceEscalationPct: num,
  costInflationPct: num,
  llmPriceChangePct: num,
  rampMonths: z.number().min(0).max(240),
  rampStartPct: num,
  passThroughMarkupPct: num,
  streams: z
    .array(
      z.looseObject({
        id: idStr,
        type: z.enum(['fixed_fee', 'fixed_monthly', 'acu', 'abu', 'subscription', 'agentops', 'pass_through', 'gainshare']),
        label: shortStr,
        enabled: z.boolean(),
        recovers: z.array(pool).max(COST_POOLS.length * 2),
        targetMarginPct: num,
        discountPct: num,
        useImplementationPlanPrice: z.boolean().optional(),
      }),
    )
    .max(50),
  acuRateCard: z.looseObject({
    tierMode: z.enum(['graduated', 'all_units']),
    tiers: z.array(TierSchema).max(50),
    minMonthlyCommitment: num,
    marginFloorPct: z.number().lt(100, 'must be below 100%'),
    priceOverride: num.nullable(),
  }),
  abuRateCard: z.looseObject({
    tierMode: z.enum(['graduated', 'all_units']),
    tiers: z.array(TierSchema).max(50),
    minMonthlyAbus: num,
    marginFloorPct: z.number().lt(100, 'must be below 100%'),
    classPricing: z.enum(['weighted', 'override']),
    failedCostAllocation: z.enum(['spread', 'provider_absorbs']),
    humanAssistedPriceFactor: num,
    priceOverrides: z.record(z.string(), num.nullable()),
  }),
  subscription: z.looseObject({
    includedUnit: z.enum(['acu', 'abu', 'none']),
    includedQty: num,
    includedDiscountPct: num,
    overagePremiumPct: num,
  }),
  gainshare: z.looseObject({
    sharePct: num,
    thresholdAnnual: num,
    capAnnual: num.nullable(),
    basis: z.enum(['validated', 'all']),
  }),
  rateCardVersions: z.array(z.looseObject({ id: z.string(), version: z.string(), status: z.enum(['draft', 'approved', 'superseded']) })).max(1000),
});

export const BENEFIT_STATUSES = ['proposed', 'finance_validated', 'realized', 'rejected'] as const;

const BenefitSchema = z.looseObject({
  id: idStr,
  name: shortStr,
  category: z.enum(['hard_savings', 'cost_avoidance', 'revenue', 'working_capital', 'capacity_conversion']),
  annualAmount: num,
  currency,
  startMonth: num,
  rampMonths: num,
  confidencePct: num,
  status: z.enum(BENEFIT_STATUSES),
  validatedBy: shortStr.optional(),
  validatedOn: shortStr.optional(),
  overlapGroup: z.string().max(128).nullable().optional(),
  scalesWithVolume: z.boolean(),
  notes: str.optional(),
});

const ValueSchema = z.looseObject({
  productivity: z
    .array(
      z.looseObject({
        workflowId: idStr,
        manualMinutesBefore: num,
        spotCheckMinutesAutonomous: num,
        loadedHourlyCost: num,
        currency,
        productiveHoursPerFteMonth: num,
      }),
    )
    .max(200),
  benefits: z.array(BenefitSchema).max(500),
  clientCosts: z.array(z.looseObject({ id: idStr, name: shortStr, type: z.enum(['one_time', 'monthly']), amount: num, currency })).max(500),
  discountRatePct: num,
  includeUnvalidated: z.boolean(),
  kpis: z
    .array(z.looseObject({ id: idStr, name: shortStr, unit: z.string().max(50), before: num, after: num, higherIsBetter: z.boolean() }))
    .max(200),
});

export const ActualRecordSchema = z.looseObject({
  period,
  monthIndex: z.number().int().min(0).max(1000),
  workflowId: idStr,
  attempted: nonNeg,
  accepted: nonNeg,
  inputTokens: nonNeg,
  outputTokens: nonNeg,
  llmCost: num,
  nonLlmCost: num,
  realizedBenefit: num,
  currency,
});

export const ProjectSchema = z.looseObject({
  id: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/, 'must be 1–128 characters: letters, digits, "_", ".", ":" or "-"'),
  name: z.string().trim().min(1).max(300),
  status: z.enum(['pre_sales', 'in_delivery', 'live']),
  currency,
  goLiveDate: period,
  createdAt: z.string().max(64).optional(),
  updatedAt: z.string().max(64).optional(),
  owner: shortStr,
  illustrative: z.boolean(),
  client: ClientInfoSchema,
  solution: SolutionInfoSchema,
  agents: z.array(AgentSchema).max(200),
  workflows: z.array(WorkflowSchema).max(100),
  implementation: ImplementationSchema,
  costLines: z.array(CostLineSchema).max(1000),
  acu: AcuConfigSchema,
  pricing: PricingSchema,
  value: ValueSchema,
  actuals: z.array(ActualRecordSchema).max(20_000),
  scenarios: z
    .array(z.looseObject({ id: z.string(), name: z.string(), version: num, overrides: z.record(z.string(), z.unknown()) }))
    .max(1000),
});

/** Create body: a bare Project (id optional — generated when absent) or { project, comment }. */
export const CreateProjectSchema = ProjectSchema.extend({ id: ProjectSchema.shape.id.optional() });

export const UpdateProjectBody = z.strictObject({
  project: ProjectSchema,
  baseVersion: z.number().int().min(1),
  comment: z.string().max(2000).optional(),
});

// ───────────────────────────── scenarios ─────────────────────────────

const mult = z.number().min(0).max(1000);
const pp = z.number().min(-100).max(100);

export const ScenarioOverridesSchema = z.strictObject({
  volumeMultiplier: mult.optional(),
  inputTokenMultiplier: mult.optional(),
  outputTokenMultiplier: mult.optional(),
  retryRatePct: z.number().min(0).max(1000).nullable().optional(),
  retryMultiplier: mult.optional(),
  successRateDeltaPp: pp.optional(),
  humanInterventionDeltaPp: pp.optional(),
  cacheHitRatePct: z.number().min(0).max(100).nullable().optional(),
  cacheHitDeltaPp: pp.optional(),
  routingShift: z.strictObject({ toModelId: idStr, sharePct: z.number().min(0).max(100) }).nullable().optional(),
  modelSwap: z.strictObject({ fromModelId: idStr, toModelId: idStr }).nullable().optional(),
  infraMultiplier: mult.optional(),
  agentOpsMultiplier: mult.optional(),
  complexityShiftPp: pp.optional(),
  targetMarginPct: z.number().min(-1000).lt(100).nullable().optional(),
  priceMultiplier: mult.optional(),
  growthPct: z.number().min(-100).max(1000).nullable().optional(),
  repriceAtTargetMargin: z.boolean().optional(),
});

export const PRESET_IDS = ['baseline', 'optimized', 'stress'] as const;

export const ScenarioRunBody = z.strictObject({
  overrides: ScenarioOverridesSchema.optional(),
  preset: z.enum(PRESET_IDS).optional(),
  breakEven: z.boolean().optional(),
});

export const ScenarioSaveBody = z.strictObject({
  name: z.string().trim().min(1).max(200),
  overrides: ScenarioOverridesSchema.optional(),
  preset: z.enum(PRESET_IDS).optional(),
  comment: z.string().max(2000).optional(),
});

// ───────────────────────────── actuals / benefits / rate cards ─────────────────────────────

export const ActualInputSchema = z.strictObject({
  period,
  workflowId: idStr,
  monthIndex: z.number().int().min(0).max(1000).optional(),
  attempted: decimalInput,
  accepted: decimalInput,
  inputTokens: z.number().int().min(0),
  outputTokens: z.number().int().min(0),
  llmCost: decimalInput,
  nonLlmCost: decimalInput,
  realizedBenefit: decimalInput.default(0),
  currency: currency.optional(),
});

export const PutActualsBody = z.strictObject({
  actuals: z.array(ActualInputSchema).max(5000),
  mode: z.enum(['merge', 'replace']).default('merge'),
  baseVersion: z.number().int().min(1).optional(),
  comment: z.string().max(2000).optional(),
});

export const BenefitValidateBody = z.strictObject({
  status: z.enum(['finance_validated', 'realized', 'rejected']),
  comment: z.string().max(2000).optional(),
  baseVersion: z.number().int().min(1).optional(),
});

export const RateCardCreateBody = z.strictObject({
  note: z.string().max(2000).optional(),
});

export const RateCardApproveBody = z.strictObject({
  note: z.string().max(2000).optional(),
});

// ───────────────────────────── templates / auth / users ─────────────────────────────

export const ProcessTemplateSchema = z.looseObject({
  id: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/),
  businessFunction: shortStr,
  process: shortStr,
  name: shortStr,
  description: str.optional(),
  archetype: z.enum(['document', 'conversational', 'analytical', 'generative']),
  abuName: shortStr,
  abuDefinition: str,
  monthlyVolume: nonNeg,
  agents: z.array(z.looseObject({ key: z.string().max(64), name: shortStr, role: str })).max(50),
  steps: z.array(z.looseObject({ name: shortStr, agent: z.string().max(64), tier: z.enum(['frontier', 'balanced', 'fast']), calls: nonNeg, input: nonNeg, output: nonNeg })).max(100),
  complexity: z.array(z.looseObject({ id: idStr, name: shortStr, sharePct: num, abuWeight: num })).max(20),
});

export const LoginBody = z.strictObject({
  email: z.string().trim().min(3).max(320),
  password: z.string().min(1).max(1024),
});

export const ChangePasswordBody = z.strictObject({
  currentPassword: z.string().min(1).max(1024),
  newPassword: z.string().min(10, 'must be at least 10 characters').max(1024),
});

export const CreateUserBody = z.strictObject({
  email: z.email().max(320),
  name: z.string().trim().min(1).max(200),
  role: z.enum(ROLES),
  password: z.string().min(10, 'must be at least 10 characters').max(1024),
});

export const UpdateUserBody = z.strictObject({
  name: z.string().trim().min(1).max(200).optional(),
  role: z.enum(ROLES).optional(),
  active: z.boolean().optional(),
  password: z.string().min(10, 'must be at least 10 characters').max(1024).optional(),
});
