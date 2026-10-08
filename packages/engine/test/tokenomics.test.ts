import { describe, expect, it } from 'vitest';
import { D, callCost, effectiveRates, selfHostedPerM, splitInputTokens, contextUtilizationPct, buildSnapshot, num } from '../src';
import { TEST_MODEL, simpleProject, testCatalog } from './fixtures';

const fx = testCatalog().fx;

describe('LLM token cost calculation', () => {
  const rates = effectiveRates(TEST_MODEL, 'USD', fx);

  it('prices input and output per million tokens', () => {
    const c = callCost({ inputTokens: 1000, outputTokens: 100, reasoningTokens: 0, cacheablePrefixTokens: 0, cacheHitRatePct: 0, batchEligiblePct: 0 }, rates);
    // 1000/1M × $2 + 100/1M × $10 = 0.002 + 0.001
    expect(c.total.toString()).toBe('0.003');
  });

  it('bills reasoning tokens at the reasoning (default output) rate', () => {
    const c = callCost({ inputTokens: 0, outputTokens: 0, reasoningTokens: 2000, cacheablePrefixTokens: 0, cacheHitRatePct: 0, batchEligiblePct: 0 }, rates);
    expect(c.reasoningCost.toString()).toBe('0.02');
  });

  it('read_write caching: hits at read rate, misses on the prefix at write rate, rest at input rate', () => {
    const t = { inputTokens: 10000, outputTokens: 0, reasoningTokens: 0, cacheablePrefixTokens: 4000, cacheHitRatePct: 75, batchEligiblePct: 0 };
    const c = callCost(t, rates);
    expect(c.cacheReadTokens.toString()).toBe('3000');
    expect(c.cacheWriteTokens.toString()).toBe('1000');
    expect(c.uncachedInputTokens.toString()).toBe('6000');
    // 6000×2 + 3000×0.2 + 1000×2.5 = 12000 + 600 + 2500 = 15100 per M → 0.0151
    expect(c.total.toString()).toBe('0.0151');
  });

  it('discounted_read caching has no write charge', () => {
    const r = effectiveRates({ ...TEST_MODEL, cacheSemantics: 'discounted_read' }, 'USD', fx);
    const c = callCost({ inputTokens: 10000, outputTokens: 0, reasoningTokens: 0, cacheablePrefixTokens: 4000, cacheHitRatePct: 75, batchEligiblePct: 0 }, r);
    expect(c.cacheWriteTokens.toString()).toBe('0');
    expect(c.uncachedInputTokens.toString()).toBe('7000');
    expect(c.total.toString()).toBe('0.0146'); // 7000×2 + 3000×0.2 = 14600
  });

  it('never double counts cached tokens: uncached + read + write = input for every semantics', () => {
    for (const sem of ['none', 'discounted_read', 'read_write'] as const) {
      for (const hit of [0, 33, 100]) {
        const t = { inputTokens: 7777, outputTokens: 1, reasoningTokens: 0, cacheablePrefixTokens: 9000, cacheHitRatePct: hit, batchEligiblePct: 0 };
        const s = splitInputTokens(t, sem);
        expect(s.uncached.plus(s.read).plus(s.write).toString()).toBe('7777');
      }
    }
  });

  it('applies batch discount only to the batch-eligible share of token charges', () => {
    const c = callCost({ inputTokens: 1000, outputTokens: 100, reasoningTokens: 0, cacheablePrefixTokens: 0, cacheHitRatePct: 0, batchEligiblePct: 40 }, rates);
    // 0.003 × 40% × 50% = 0.0006
    expect(c.batchSaving.toString()).toBe('0.0006');
    expect(c.total.toString()).toBe('0.0024');
  });

  it('derives self-hosted token rates from GPU economics', () => {
    const r = selfHostedPerM({ ...TEST_MODEL, pricingBasis: 'self_hosted', selfHosted: { gpuHourlyCost: 3.6, gpusPerReplica: 1, outputTokensPerSecond: 1000, utilizationPct: 50, inputCostRatio: 0.25 } });
    // $3.6/h ÷ (1000 × 3600 × 0.5 = 1.8M tok/h) × 1M = $2.00
    expect(r.outputPerM.toString()).toBe('2');
    expect(r.inputPerM.toString()).toBe('0.5');
  });

  it('converts USD rates into the project currency', () => {
    const inr = effectiveRates(TEST_MODEL, 'INR', fx);
    expect(inr.inputPerM.toString()).toBe('160');
  });

  it('reports context window utilisation', () => {
    expect(contextUtilizationPct({ inputTokens: 40000, outputTokens: 5000, reasoningTokens: 5000, cacheablePrefixTokens: 0, cacheHitRatePct: 0, batchEligiblePct: 0 }, 100000).toString()).toBe('50');
  });

  it('monthly LLM cost = executions × calls × cost per call, split across model routing', () => {
    const p = simpleProject();
    p.workflows[0].llmSteps[0].routing = [
      { modelId: 'm-test', sharePct: 75 },
      { modelId: 'm-cheap', sharePct: 25 },
    ];
    const s = buildSnapshot(p, testCatalog(), { rampFactor: 1, yearIndex: 0 });
    // m-test: 750 × 0.003 = 2.25; m-cheap: 250 × (1000×0.5 + 100×2)/1M = 250 × 0.0007 = 0.175
    expect(s.llm.byModel['m-test'].toString()).toBe('2.25');
    expect(s.llm.byModel['m-cheap'].toString()).toBe('0.175');
    expect(s.llm.total.toString()).toBe('2.425');
    expect(num(s.llm.perAccepted)).toBeCloseTo(0.002425, 12);
  });

  it('retries and failed executions consume tokens without creating extra business units', () => {
    const p = simpleProject();
    Object.assign(p.workflows[0], { retryRatePct: 10, retryConsumptionPct: 50, successRatePct: 90, failedConsumptionPct: 40 });
    const s = buildSnapshot(p, testCatalog(), { rampFactor: 1, yearIndex: 0 });
    const v = s.volumes.wf1;
    // completed 900 + failed 100×0.4 + retries 100×0.5 = 990 execution equivalents
    expect(v.executionEquivalents.toString()).toBe('990');
    expect(v.executions.toString()).toBe('1100');
    expect(v.accepted.toString()).toBe('900');
    expect(s.llm.total.toString()).toBe(D(990).times('0.003').toString());
  });
});
