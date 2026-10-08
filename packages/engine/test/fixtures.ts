import type { Catalog, ModelRate, Project } from '../src';
import { defaultPricing } from '../src';

/** A model with round numbers so expected values can be computed by hand. */
export const TEST_MODEL: ModelRate = {
  id: 'm-test',
  provider: 'TestAI',
  model: 'Test-1',
  version: '1',
  hostingPlatform: 'Test',
  region: 'test',
  currency: 'USD',
  effectiveDate: '2026-01-01',
  tier: 'balanced',
  pricingBasis: 'per_token',
  inputPerM: 2,
  outputPerM: 10,
  cacheSemantics: 'read_write',
  cacheReadPerM: 0.2,
  cacheWritePerM: 2.5,
  batchDiscountPct: 50,
  otherPerCall: 0,
  contextWindow: 100_000,
  source: 'test',
  assumptions: 'test',
  sample: false,
};

export function testCatalog(): Catalog {
  return {
    version: 'test',
    modelRates: [
      TEST_MODEL,
      { ...TEST_MODEL, id: 'm-cheap', model: 'Cheap-1', inputPerM: 0.5, outputPerM: 2, cacheSemantics: 'discounted_read', cacheReadPerM: 0.05, cacheWritePerM: 0 },
    ],
    fx: { base: 'USD', asOf: '2026-01-01', source: 'test', rates: { USD: 1, INR: 80, EUR: 0.8 } },
    acuWeightSets: [
      {
        id: 'w1',
        name: 'Test weights',
        version: '1',
        effectiveDate: '2026-01-01',
        author: 'test',
        status: 'approved',
        rationale: 'test',
        weights: { input_tokens_m: 100, cached_tokens_m: 10, output_tokens_m: 500, workflow_executions_k: 2, ocr_pages_k: 50 },
      },
    ],
    cloudPrices: [],
  };
}

/**
 * One workflow, one LLM step, no caching, no retries, 100% success/acceptance,
 * 1,000 transactions/month, USD — every figure is hand-checkable.
 */
export function simpleProject(over: Partial<Project> = {}): Project {
  const pricing = defaultPricing();
  pricing.rampMonths = 0;
  pricing.priceEscalationPct = 0;
  pricing.costInflationPct = 0;
  pricing.termMonths = 12;
  pricing.streams = [
    { id: 'impl', type: 'fixed_fee', label: 'Implementation', enabled: true, recovers: ['IMPLEMENTATION'], targetMarginPct: 20, discountPct: 0 },
    { id: 'abu', type: 'abu', label: 'ABU', enabled: true, recovers: ['LLM', 'ORCHESTRATION', 'RAG', 'DOCUMENT', 'INFRASTRUCTURE', 'AGENTOPS', 'HUMAN_REVIEW', 'OTHER'], targetMarginPct: 50, discountPct: 0 },
  ];
  return {
    id: 'p-test',
    name: 'Test project',
    status: 'pre_sales',
    currency: 'USD',
    goLiveDate: '2026-01',
    createdAt: '2026-01-01',
    updatedAt: '2026-01-01',
    owner: 'test',
    illustrative: true,
    client: { clientName: 'Test', industry: 'Test', geography: 'Test', businessFunction: 'Finance', businessProcess: 'AP', engagementType: 'test' },
    solution: {
      solutionType: 'single_agent',
      cloudPlatform: 'Test',
      llmProviders: ['TestAI'],
      integrations: [],
      dataSources: [],
      ragRequired: false,
      documentProcessing: false,
      humanInTheLoop: false,
      securityRequirements: '',
      availabilitySla: '',
      supportSla: '',
      peakConcurrency: 1,
      workingDaysPerMonth: 20,
      plannedAgents: 1,
      plannedWorkflows: 1,
    },
    agents: [{ id: 'ag1', name: 'Agent 1', role: 'test' }],
    workflows: [
      {
        id: 'wf1',
        name: 'Invoices',
        businessFunction: 'Finance',
        process: 'AP',
        abuName: 'invoice',
        abuDefinition: 'One invoice posted',
        acceptanceCriteria: [],
        monthlyVolume: 1000,
        annualGrowthPct: 0,
        workflowSteps: 1,
        toolCallsPerExecution: 0,
        successRatePct: 100,
        acceptanceRatePct: 100,
        retryRatePct: 0,
        retryConsumptionPct: 100,
        failedConsumptionPct: 100,
        humanInterventionRatePct: 0,
        complexity: [],
        llmSteps: [
          {
            id: 'st1',
            name: 'Extract',
            agentId: 'ag1',
            callsPerExecution: 1,
            inputTokens: 1000,
            outputTokens: 100,
            reasoningTokens: 0,
            cacheablePrefixTokens: 0,
            cacheHitRatePct: 0,
            batchEligiblePct: 0,
            toolCall: false,
            routing: [{ modelId: 'm-test', sharePct: 100 }],
          },
        ],
        humanReview: { minutesPerAssistedTxn: 0, minutesPerRejectedTxn: 0, hourlyCost: 0, currency: 'USD', borneBy: 'provider' },
      },
    ],
    implementation: {
      roles: [{ id: 'r1', name: 'Engineer', costRate: 100, billRate: 200, currency: 'USD' }],
      activities: [{ id: 'a1', phase: 'Build', name: 'Build', roleId: 'r1', effort: 100, effortUnit: 'hours', durationWeeks: 4, dependsOn: [] }],
      directExpenses: [],
      contingencyPct: 0,
      hoursPerDay: 8,
      targetMarginPct: 20,
      pricingMethod: 'cost_plus_margin',
      discountPct: 0,
    },
    costLines: [],
    acu: { method: 'cost_normalized', referenceValue: 0.01, referenceCurrency: 'USD', eligiblePools: ['LLM', 'ORCHESTRATION', 'RAG', 'DOCUMENT'], weightSetId: 'w1' },
    pricing,
    value: { productivity: [], benefits: [], clientCosts: [], discountRatePct: 10, includeUnvalidated: false, kpis: [] },
    actuals: [],
    scenarios: [],
    ...over,
  };
}
