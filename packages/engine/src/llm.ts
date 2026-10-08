/**
 * Module 3 — LLM tokenomics.
 *
 * LLM cost per call =
 *     uncached input tokens / 1M × input rate
 *   + cache-read tokens     / 1M × cache-read rate
 *   + cache-write tokens    / 1M × cache-write rate   (read_write semantics only)
 *   + output tokens         / 1M × output rate
 *   + reasoning tokens      / 1M × reasoning rate
 *   − batch discount on the batch-eligible share of token charges
 *   + other per-call charges
 *
 * Provider billing semantics are applied so that every input token is billed
 * exactly once:  uncached + cacheRead + cacheWrite === inputTokens.
 */
import { D, Decimal, MILLION, ONE, ZERO, pct, min, safeDiv } from './decimal';
import type { FxTable, ModelRate, CacheSemantics } from './types';
import { convert } from './fx';

export interface EffectiveRates {
  modelId: string;
  semantics: CacheSemantics;
  inputPerM: Decimal;
  outputPerM: Decimal;
  reasoningPerM: Decimal;
  cacheReadPerM: Decimal;
  cacheWritePerM: Decimal;
  batchDiscountPct: Decimal;
  otherPerCall: Decimal;
  contextWindow: number;
}

/** Derive per-million token rates for a self-hosted model from GPU economics. */
export function selfHostedPerM(rate: ModelRate): { inputPerM: Decimal; outputPerM: Decimal } {
  const s = rate.selfHosted;
  if (!s) return { inputPerM: D(rate.inputPerM), outputPerM: D(rate.outputPerM) };
  const costPerHour = D(s.gpuHourlyCost).times(D(s.gpusPerReplica));
  const tokensPerHour = D(s.outputTokensPerSecond).times(3600).times(pct(s.utilizationPct));
  const outputPerM = safeDiv(costPerHour, tokensPerHour).times(MILLION);
  return { outputPerM, inputPerM: outputPerM.times(D(s.inputCostRatio)) };
}

/** Rates converted to the project currency, with an optional price factor (e.g. annual LLM price trend). */
export function effectiveRates(rate: ModelRate, currency: string, fx: FxTable, priceFactor: Decimal = ONE): EffectiveRates {
  const c = (v: Decimal | number) => convert(v, rate.currency, currency, fx).times(priceFactor);
  if (rate.pricingBasis === 'self_hosted') {
    const { inputPerM, outputPerM } = selfHostedPerM(rate);
    return {
      modelId: rate.id,
      semantics: 'none',
      inputPerM: c(inputPerM),
      outputPerM: c(outputPerM),
      reasoningPerM: c(outputPerM),
      cacheReadPerM: ZERO,
      cacheWritePerM: ZERO,
      batchDiscountPct: ZERO,
      otherPerCall: c(D(rate.otherPerCall)),
      contextWindow: rate.contextWindow,
    };
  }
  return {
    modelId: rate.id,
    semantics: rate.cacheSemantics,
    inputPerM: c(D(rate.inputPerM)),
    outputPerM: c(D(rate.outputPerM)),
    reasoningPerM: c(D(rate.reasoningPerM ?? rate.outputPerM)),
    cacheReadPerM: c(D(rate.cacheReadPerM)),
    cacheWritePerM: c(D(rate.cacheWritePerM)),
    batchDiscountPct: D(rate.batchDiscountPct),
    otherPerCall: c(D(rate.otherPerCall)),
    contextWindow: rate.contextWindow,
  };
}

export interface CallTokens {
  inputTokens: number | Decimal;
  outputTokens: number | Decimal;
  reasoningTokens: number | Decimal;
  cacheablePrefixTokens: number | Decimal;
  cacheHitRatePct: number | Decimal;
  batchEligiblePct: number | Decimal;
}

export interface CallCost {
  uncachedInputTokens: Decimal;
  cacheReadTokens: Decimal;
  cacheWriteTokens: Decimal;
  outputTokens: Decimal;
  reasoningTokens: Decimal;
  inputCost: Decimal;
  cacheReadCost: Decimal;
  cacheWriteCost: Decimal;
  outputCost: Decimal;
  reasoningCost: Decimal;
  batchSaving: Decimal;
  otherCost: Decimal;
  total: Decimal;
}

/** Split input tokens into uncached / cache-read / cache-write according to provider semantics. */
export function splitInputTokens(t: CallTokens, semantics: CacheSemantics) {
  const input = D(t.inputTokens);
  if (semantics === 'none') return { uncached: input, read: ZERO, write: ZERO };
  const cacheable = min(D(t.cacheablePrefixTokens), input);
  const read = cacheable.times(pct(t.cacheHitRatePct));
  const write = semantics === 'read_write' ? cacheable.minus(read) : ZERO;
  return { uncached: input.minus(read).minus(write), read, write };
}

export function callCost(t: CallTokens, r: EffectiveRates): CallCost {
  const { uncached, read, write } = splitInputTokens(t, r.semantics);
  const out = D(t.outputTokens);
  const reasoning = D(t.reasoningTokens);
  const inputCost = uncached.div(MILLION).times(r.inputPerM);
  const cacheReadCost = read.div(MILLION).times(r.cacheReadPerM);
  const cacheWriteCost = write.div(MILLION).times(r.cacheWritePerM);
  const outputCost = out.div(MILLION).times(r.outputPerM);
  const reasoningCost = reasoning.div(MILLION).times(r.reasoningPerM);
  const tokenCost = inputCost.plus(cacheReadCost).plus(cacheWriteCost).plus(outputCost).plus(reasoningCost);
  const batchSaving = tokenCost.times(pct(t.batchEligiblePct)).times(pct(r.batchDiscountPct));
  const otherCost = r.otherPerCall;
  return {
    uncachedInputTokens: uncached,
    cacheReadTokens: read,
    cacheWriteTokens: write,
    outputTokens: out,
    reasoningTokens: reasoning,
    inputCost,
    cacheReadCost,
    cacheWriteCost,
    outputCost,
    reasoningCost,
    batchSaving,
    otherCost,
    total: tokenCost.minus(batchSaving).plus(otherCost),
  };
}

/** Share of the context window used by one call (input + output + reasoning). */
export function contextUtilizationPct(t: CallTokens, contextWindow: number): Decimal {
  if (!contextWindow) return ZERO;
  return D(t.inputTokens).plus(D(t.outputTokens)).plus(D(t.reasoningTokens)).div(contextWindow).times(100);
}
