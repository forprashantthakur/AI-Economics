/**
 * Default catalogue: model rate card, FX table, ACU weight sets and cloud /
 * service price table.
 *
 * EVERY RATE HERE IS AN ILLUSTRATIVE SAMPLE. None is a vendor quote or a
 * verified current market price. Model names are deliberately tier labels
 * ("Sonnet-class", "Flash-class") rather than specific versions. Replace each
 * entry with your published or contracted rate (Settings → Rate cards) and
 * record the source and effective date before quoting to a client.
 */
import type { AcuWeightSet, Catalog, CloudPriceItem, FxTable, ModelRate } from '../types';

export const SAMPLE_SOURCE = 'ILLUSTRATIVE SAMPLE RATE — not a vendor quote. Replace with the current published or contracted rate before use.';
const EFFECTIVE = '2026-07-01';

const m = (r: Partial<ModelRate> & Pick<ModelRate, 'id' | 'provider' | 'model' | 'tier' | 'inputPerM' | 'outputPerM'>): ModelRate => ({
  version: 'sample',
  hostingPlatform: r.provider,
  region: 'global',
  currency: 'USD',
  effectiveDate: EFFECTIVE,
  pricingBasis: 'per_token',
  cacheSemantics: 'none',
  cacheReadPerM: 0,
  cacheWritePerM: 0,
  batchDiscountPct: 0,
  otherPerCall: 0,
  contextWindow: 200_000,
  source: SAMPLE_SOURCE,
  assumptions: 'Standard (non-priority) tier, list price, no committed-use discount.',
  sample: true,
  ...r,
});

export const SAMPLE_MODEL_RATES: ModelRate[] = [
  m({ id: 'anthropic-opus-class', provider: 'Anthropic', model: 'Claude Opus-class', tier: 'frontier', hostingPlatform: 'Anthropic API', inputPerM: 5, outputPerM: 25, cacheSemantics: 'read_write', cacheReadPerM: 0.5, cacheWritePerM: 6.25, batchDiscountPct: 50 }),
  m({ id: 'anthropic-sonnet-class', provider: 'Anthropic', model: 'Claude Sonnet-class', tier: 'balanced', hostingPlatform: 'Anthropic API', inputPerM: 3, outputPerM: 15, cacheSemantics: 'read_write', cacheReadPerM: 0.3, cacheWritePerM: 3.75, batchDiscountPct: 50 }),
  m({ id: 'anthropic-haiku-class', provider: 'Anthropic', model: 'Claude Haiku-class', tier: 'fast', hostingPlatform: 'Anthropic API', inputPerM: 0.8, outputPerM: 4, cacheSemantics: 'read_write', cacheReadPerM: 0.08, cacheWritePerM: 1, batchDiscountPct: 50 }),
  m({ id: 'openai-frontier', provider: 'OpenAI', model: 'GPT frontier-class', tier: 'frontier', hostingPlatform: 'OpenAI API', inputPerM: 2.5, outputPerM: 10, cacheSemantics: 'discounted_read', cacheReadPerM: 1.25, batchDiscountPct: 50, contextWindow: 256_000 }),
  m({ id: 'openai-mini', provider: 'OpenAI', model: 'GPT mini-class', tier: 'fast', hostingPlatform: 'OpenAI API', inputPerM: 0.4, outputPerM: 1.6, cacheSemantics: 'discounted_read', cacheReadPerM: 0.1, batchDiscountPct: 50, contextWindow: 256_000 }),
  m({ id: 'google-pro-class', provider: 'Google', model: 'Gemini Pro-class', tier: 'frontier', hostingPlatform: 'Vertex AI', inputPerM: 1.25, outputPerM: 10, cacheSemantics: 'discounted_read', cacheReadPerM: 0.31, batchDiscountPct: 50, contextWindow: 1_000_000 }),
  m({ id: 'google-flash-class', provider: 'Google', model: 'Gemini Flash-class', tier: 'fast', hostingPlatform: 'Vertex AI', inputPerM: 0.3, outputPerM: 2.5, cacheSemantics: 'discounted_read', cacheReadPerM: 0.075, batchDiscountPct: 50, contextWindow: 1_000_000 }),
  m({ id: 'bedrock-sonnet-class', provider: 'AWS Bedrock', model: 'Claude Sonnet-class (Bedrock)', tier: 'balanced', hostingPlatform: 'AWS Bedrock', region: 'ap-south-1', inputPerM: 3, outputPerM: 15, cacheSemantics: 'read_write', cacheReadPerM: 0.3, cacheWritePerM: 3.75, batchDiscountPct: 50 }),
  m({ id: 'bedrock-haiku-class', provider: 'AWS Bedrock', model: 'Claude Haiku-class (Bedrock)', tier: 'fast', hostingPlatform: 'AWS Bedrock', region: 'ap-south-1', inputPerM: 0.8, outputPerM: 4, cacheSemantics: 'read_write', cacheReadPerM: 0.08, cacheWritePerM: 1, batchDiscountPct: 50 }),
  m({ id: 'azure-gpt-frontier', provider: 'Azure OpenAI', model: 'GPT frontier-class (Azure)', tier: 'frontier', hostingPlatform: 'Azure AI Foundry', region: 'centralindia', inputPerM: 2.75, outputPerM: 11, cacheSemantics: 'discounted_read', cacheReadPerM: 1.375, batchDiscountPct: 50, contextWindow: 256_000, assumptions: 'Regional deployment; illustrative regional premium over global list.' }),
  m({ id: 'azure-gpt-mini', provider: 'Azure OpenAI', model: 'GPT mini-class (Azure)', tier: 'fast', hostingPlatform: 'Azure AI Foundry', region: 'centralindia', inputPerM: 0.44, outputPerM: 1.76, cacheSemantics: 'discounted_read', cacheReadPerM: 0.11, batchDiscountPct: 50, contextWindow: 256_000 }),
  m({
    id: 'selfhosted-70b',
    provider: 'Open source (self-hosted)',
    model: 'Open-weights 70B-class',
    tier: 'open',
    hostingPlatform: 'Self-hosted GPU (Kubernetes)',
    region: 'ap-south-1',
    pricingBasis: 'self_hosted',
    inputPerM: 0,
    outputPerM: 0,
    contextWindow: 128_000,
    selfHosted: { gpuHourlyCost: 4, gpusPerReplica: 2, outputTokensPerSecond: 1500, utilizationPct: 60, inputCostRatio: 0.2 },
    assumptions: 'Token rate derived from GPU-hour cost ÷ sustained throughput at stated utilisation. Do not also cost the same GPUs as infrastructure.',
  }),
  m({
    id: 'selfhosted-8b',
    provider: 'Open source (self-hosted)',
    model: 'Open-weights 8B-class',
    tier: 'open',
    hostingPlatform: 'Self-hosted GPU (Kubernetes)',
    region: 'ap-south-1',
    pricingBasis: 'self_hosted',
    inputPerM: 0,
    outputPerM: 0,
    contextWindow: 128_000,
    selfHosted: { gpuHourlyCost: 1.2, gpusPerReplica: 1, outputTokensPerSecond: 2500, utilizationPct: 60, inputCostRatio: 0.2 },
    assumptions: 'Token rate derived from GPU-hour cost ÷ sustained throughput at stated utilisation.',
  }),
];

export const SAMPLE_FX: FxTable = {
  base: 'USD',
  asOf: '2026-09-30',
  source: 'ILLUSTRATIVE SAMPLE — replace with your treasury or contract rate.',
  rates: { USD: 1, INR: 88, EUR: 0.86, GBP: 0.75, AUD: 1.52, SGD: 1.3, AED: 3.6725, JPY: 148 },
};

export const SAMPLE_ACU_WEIGHT_SETS: AcuWeightSet[] = [
  {
    id: 'acu-std-v1',
    name: 'Standard ACU weights',
    version: '1.0',
    effectiveDate: '2026-07-01',
    author: 'AI FinOps CoE',
    status: 'approved',
    rationale:
      'Model-agnostic weights calibrated to a balanced-tier reference cost (≈₹1 per ACU at sample rates). Because weights do not depend on which model serves a request, ACU counts stay stable when the provider re-routes traffic; the provider keeps the efficiency gain.',
    weights: {
      input_tokens_m: 250,
      cached_tokens_m: 25,
      output_tokens_m: 1250,
      reasoning_tokens_m: 1250,
      llm_calls_k: 5,
      embedding_tokens_m: 10,
      vector_queries_k: 40,
      tool_calls_k: 8,
      workflow_executions_k: 10,
      gpu_hours: 300,
      ocr_pages_k: 130,
      storage_gb_month: 2,
      monitoring_events_k: 1,
    },
  },
  {
    id: 'acu-std-v0.9',
    name: 'Standard ACU weights',
    version: '0.9',
    effectiveDate: '2026-01-01',
    author: 'AI FinOps CoE',
    status: 'retired',
    rationale: 'Initial calibration; superseded by v1.0 after cached-token weighting was introduced.',
    weights: { input_tokens_m: 250, cached_tokens_m: 250, output_tokens_m: 1250, reasoning_tokens_m: 1250, llm_calls_k: 0, vector_queries_k: 40, tool_calls_k: 0, workflow_executions_k: 0, ocr_pages_k: 130 },
  },
];

const p = (r: Omit<CloudPriceItem, 'effectiveDate' | 'source' | 'sample' | 'region'> & Partial<CloudPriceItem>): CloudPriceItem => ({
  effectiveDate: EFFECTIVE,
  source: SAMPLE_SOURCE,
  sample: true,
  region: 'ap-south-1 / India',
  ...r,
});

export const SAMPLE_CLOUD_PRICES: CloudPriceItem[] = [
  p({ id: 'serverless-1m', cloud: 'AWS', service: 'Serverless function invocations', category: 'ORCHESTRATION', componentKey: 'serverless', unitLabel: '1M requests', unitCost: 0.2, currency: 'USD' }),
  p({ id: 'workflow-1k', cloud: 'AWS', service: 'Workflow engine state transitions', category: 'ORCHESTRATION', componentKey: 'workflow_engine', unitLabel: '1K transitions', unitCost: 0.025, currency: 'USD' }),
  p({ id: 'apigw-1m', cloud: 'AWS', service: 'API gateway requests', category: 'ORCHESTRATION', componentKey: 'api_gateway', unitLabel: '1M requests', unitCost: 3.5, currency: 'USD' }),
  p({ id: 'external-api-1k', cloud: 'Any', service: 'External paid API (search / enrichment)', category: 'ORCHESTRATION', componentKey: 'external_api', unitLabel: '1K calls', unitCost: 5, currency: 'USD' }),
  p({ id: 'invoice-extract-page', cloud: 'AWS', service: 'Invoice / expense extraction', category: 'DOCUMENT', componentKey: 'ocr', unitLabel: 'page', unitCost: 0.01, currency: 'USD', acuResourceKey: 'ocr_pages_k', acuUnitsPerUnit: 1 }),
  p({ id: 'docintel-invoice-1k', cloud: 'Azure', service: 'Document intelligence — prebuilt invoice', category: 'DOCUMENT', componentKey: 'ocr', unitLabel: '1K pages', unitCost: 10, currency: 'USD', acuResourceKey: 'ocr_pages_k', acuUnitsPerUnit: 1000 }),
  p({ id: 'ocr-read-1k', cloud: 'GCP', service: 'OCR — document text', category: 'DOCUMENT', componentKey: 'ocr', unitLabel: '1K pages', unitCost: 1.5, currency: 'USD', acuResourceKey: 'ocr_pages_k', acuUnitsPerUnit: 1000 }),
  p({ id: 'doc-classify-1k', cloud: 'Any', service: 'Document classification', category: 'DOCUMENT', componentKey: 'doc_classification', unitLabel: '1K pages', unitCost: 1.5, currency: 'USD' }),
  p({ id: 'vector-query-1k', cloud: 'Any', service: 'Managed vector DB queries', category: 'RAG', componentKey: 'vector_db', unitLabel: '1K queries', unitCost: 0.04, currency: 'USD', acuResourceKey: 'vector_queries_k', acuUnitsPerUnit: 1000 }),
  p({ id: 'vector-storage-gb', cloud: 'Any', service: 'Vector index storage', category: 'RAG', componentKey: 'vector_storage', unitLabel: 'GB-month', unitCost: 0.33, currency: 'USD', acuResourceKey: 'storage_gb_month', acuUnitsPerUnit: 1 }),
  p({ id: 'embedding-1m', cloud: 'Any', service: 'Embedding generation', category: 'RAG', componentKey: 'embeddings', unitLabel: '1M tokens', unitCost: 0.1, currency: 'USD', acuResourceKey: 'embedding_tokens_m', acuUnitsPerUnit: 1_000_000 }),
  p({ id: 'reindex-run', cloud: 'Any', service: 'Knowledge re-indexing run', category: 'RAG', componentKey: 'reindexing', unitLabel: 'run', unitCost: 40, currency: 'USD' }),
  p({ id: 'node-8x32-month', cloud: 'AWS', service: 'Container node 8 vCPU / 32 GB', category: 'INFRASTRUCTURE', componentKey: 'app_hosting', unitLabel: 'node-month', unitCost: 280, currency: 'USD' }),
  p({ id: 'postgres-ha-month', cloud: 'AWS', service: 'Managed PostgreSQL (HA)', category: 'INFRASTRUCTURE', componentKey: 'database', unitLabel: 'instance-month', unitCost: 650, currency: 'USD' }),
  p({ id: 'object-storage-gb', cloud: 'AWS', service: 'Object storage', category: 'INFRASTRUCTURE', componentKey: 'object_storage', unitLabel: 'GB-month', unitCost: 0.025, currency: 'USD', acuResourceKey: 'storage_gb_month', acuUnitsPerUnit: 1 }),
  p({ id: 'network-egress-gb', cloud: 'AWS', service: 'Network egress', category: 'INFRASTRUCTURE', componentKey: 'networking', unitLabel: 'GB', unitCost: 0.09, currency: 'USD' }),
  p({ id: 'gpu-a100-hour', cloud: 'AWS', service: 'GPU A100-class', category: 'INFRASTRUCTURE', componentKey: 'gpu', unitLabel: 'GPU-hour', unitCost: 4.1, currency: 'USD', acuResourceKey: 'gpu_hours', acuUnitsPerUnit: 1 }),
  p({ id: 'observability-1k', cloud: 'Any', service: 'LLM observability & tracing', category: 'INFRASTRUCTURE', componentKey: 'monitoring', unitLabel: '1K trace events', unitCost: 0.05, currency: 'USD', acuResourceKey: 'monitoring_events_k', acuUnitsPerUnit: 1000 }),
  p({ id: 'log-ingest-gb', cloud: 'Any', service: 'Log ingestion & retention', category: 'INFRASTRUCTURE', componentKey: 'logging', unitLabel: 'GB', unitCost: 0.5, currency: 'USD' }),
  p({ id: 'security-gateway-month', cloud: 'Any', service: 'WAF, secrets & AI security gateway', category: 'INFRASTRUCTURE', componentKey: 'security', unitLabel: 'month', unitCost: 450, currency: 'USD' }),
  p({ id: 'agentops-l1-fte', cloud: 'Delivery', service: 'AgentOps L1 support analyst', category: 'AGENTOPS', componentKey: 'support_l1', unitLabel: 'FTE-month', unitCost: 110_000, currency: 'INR' }),
  p({ id: 'agentops-l2-fte', cloud: 'Delivery', service: 'AgentOps L2 AI support engineer', category: 'AGENTOPS', componentKey: 'support_l2', unitLabel: 'FTE-month', unitCost: 190_000, currency: 'INR' }),
  p({ id: 'agentops-l3-fte', cloud: 'Delivery', service: 'AgentOps L3 AI engineer / SME', category: 'AGENTOPS', componentKey: 'support_l3', unitLabel: 'FTE-month', unitCost: 320_000, currency: 'INR' }),
  p({ id: 'agentops-eval-fte', cloud: 'Delivery', service: 'Quality evaluation & prompt optimisation', category: 'AGENTOPS', componentKey: 'quality_eval', unitLabel: 'FTE-month', unitCost: 240_000, currency: 'INR' }),
  p({ id: 'agentops-release-fte', cloud: 'Delivery', service: 'Release, governance & FinOps reporting', category: 'AGENTOPS', componentKey: 'governance', unitLabel: 'FTE-month', unitCost: 220_000, currency: 'INR' }),
];

export function defaultCatalog(): Catalog {
  return structuredClone({
    version: 'sample-2026.07',
    modelRates: SAMPLE_MODEL_RATES,
    fx: SAMPLE_FX,
    acuWeightSets: SAMPLE_ACU_WEIGHT_SETS,
    cloudPrices: SAMPLE_CLOUD_PRICES,
  });
}

export const PROVIDER_TIER_MAP: Record<string, { label: string; frontier: string; balanced: string; fast: string }> = {
  anthropic: { label: 'Anthropic (direct)', frontier: 'anthropic-opus-class', balanced: 'anthropic-sonnet-class', fast: 'anthropic-haiku-class' },
  openai: { label: 'OpenAI (direct)', frontier: 'openai-frontier', balanced: 'openai-frontier', fast: 'openai-mini' },
  google: { label: 'Google (Vertex AI)', frontier: 'google-pro-class', balanced: 'google-pro-class', fast: 'google-flash-class' },
  bedrock: { label: 'AWS Bedrock', frontier: 'bedrock-sonnet-class', balanced: 'bedrock-sonnet-class', fast: 'bedrock-haiku-class' },
  azure: { label: 'Azure OpenAI', frontier: 'azure-gpt-frontier', balanced: 'azure-gpt-frontier', fast: 'azure-gpt-mini' },
  opensource: { label: 'Open source (self-hosted)', frontier: 'selfhosted-70b', balanced: 'selfhosted-70b', fast: 'selfhosted-8b' },
};
