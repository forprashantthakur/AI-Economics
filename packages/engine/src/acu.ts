/**
 * ACU — AI Consumption Unit.
 *
 * The ACU is a commercial abstraction (not an industry standard). Two
 * measurement methods are supported and are always computed side by side:
 *
 *  Method A — cost-normalised:  ACUs = eligible AI consumption cost (at base-year
 *             reference rates) / reference value per ACU   (e.g. 1 ACU = ₹1)
 *  Method B — weighted resource: ACUs = Σ resource usage × versioned weight
 *
 * The measurement definition is deliberately separate from the selling price
 * (see pricing.ts): price per ACU = fully allocated recovered cost per ACU / (1 − margin).
 */
import { D, Decimal, ZERO, safeDiv, sum } from './decimal';
import type { AcuConfig, AcuResourceKey, AcuWeightSet, Catalog, CostPool, FxTable } from './types';
import { convert } from './fx';

export interface AcuResourceDef {
  label: string;
  unit: string;
  /** Raw units per weighted unit (tokens per 1M, calls per 1K …). */
  scale: number;
  /** Derived from the workflow/LLM model; cost lines must not also map to it. */
  derived: boolean;
}

export const ACU_RESOURCES: Record<AcuResourceKey, AcuResourceDef> = {
  input_tokens_m: { label: 'Input tokens (uncached + cache writes)', unit: '1M tokens', scale: 1_000_000, derived: true },
  cached_tokens_m: { label: 'Cached input tokens (reads)', unit: '1M tokens', scale: 1_000_000, derived: true },
  output_tokens_m: { label: 'Output tokens', unit: '1M tokens', scale: 1_000_000, derived: true },
  reasoning_tokens_m: { label: 'Reasoning tokens', unit: '1M tokens', scale: 1_000_000, derived: true },
  llm_calls_k: { label: 'LLM calls', unit: '1K calls', scale: 1_000, derived: true },
  workflow_executions_k: { label: 'Workflow executions', unit: '1K executions', scale: 1_000, derived: true },
  tool_calls_k: { label: 'Agent tool executions', unit: '1K calls', scale: 1_000, derived: true },
  embedding_tokens_m: { label: 'Embedding tokens', unit: '1M tokens', scale: 1_000_000, derived: false },
  vector_queries_k: { label: 'Vector search queries', unit: '1K queries', scale: 1_000, derived: false },
  ocr_pages_k: { label: 'OCR / extraction pages', unit: '1K pages', scale: 1_000, derived: false },
  gpu_hours: { label: 'GPU hours', unit: 'GPU-hour', scale: 1, derived: false },
  storage_gb_month: { label: 'Storage', unit: 'GB-month', scale: 1, derived: false },
  monitoring_events_k: { label: 'Monitoring / trace events', unit: '1K events', scale: 1_000, derived: false },
};

export const ACU_RESOURCE_KEYS = Object.keys(ACU_RESOURCES) as AcuResourceKey[];

export type ResourceUsage = Record<AcuResourceKey, Decimal>;

export function emptyUsage(): ResourceUsage {
  return Object.fromEntries(ACU_RESOURCE_KEYS.map((k) => [k, ZERO])) as ResourceUsage;
}

export function findWeightSet(catalog: Catalog, id: string): AcuWeightSet | undefined {
  return catalog.acuWeightSets.find((w) => w.id === id);
}

/** Method B: Σ (raw usage / scale) × weight. */
export function weightedAcus(usage: ResourceUsage, weightSet: AcuWeightSet | undefined): Decimal {
  if (!weightSet) return ZERO;
  return sum(
    ACU_RESOURCE_KEYS.map((k) => {
      const w = weightSet.weights[k];
      if (!w) return ZERO;
      return usage[k].div(ACU_RESOURCES[k].scale).times(D(w));
    }),
  );
}

/** Method B: per-resource breakdown for transparency. */
export function weightedAcuBreakdown(usage: ResourceUsage, weightSet: AcuWeightSet | undefined) {
  return ACU_RESOURCE_KEYS.map((k) => {
    const def = ACU_RESOURCES[k];
    const weight = D(weightSet?.weights[k] ?? 0);
    const units = usage[k].div(def.scale);
    return { key: k, label: def.label, unit: def.unit, units, weight, acus: units.times(weight) };
  });
}

/** Method A: eligible cost / reference value (reference value converted to project currency). */
export function costNormalizedAcus(eligibleCost: Decimal, cfg: AcuConfig, currency: string, fx: FxTable): Decimal {
  const ref = convert(cfg.referenceValue, cfg.referenceCurrency, currency, fx);
  return safeDiv(eligibleCost, ref);
}

export function eligibleCostOf(pools: Partial<Record<CostPool, Decimal>>, cfg: AcuConfig): Decimal {
  return sum(cfg.eligiblePools.filter((p) => p !== 'IMPLEMENTATION').map((p) => pools[p] ?? ZERO));
}
