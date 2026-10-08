import { describe, expect, it } from 'vitest';
import { D, buildSnapshot, computeProject, num, weightedAcuBreakdown } from '../src';
import { simpleProject, testCatalog } from './fixtures';

const cat = testCatalog();

describe('ACU normalisation', () => {
  it('Method A: ACUs = eligible consumption cost / reference value', () => {
    const p = simpleProject();
    const s = buildSnapshot(p, cat, { rampFactor: 1, yearIndex: 0 });
    // LLM $3 eligible; 1 ACU = $0.01 → 300 ACUs
    expect(s.acu.methodA.toString()).toBe('300');
    expect(s.acu.total.toString()).toBe('300');
    expect(s.acu.perAttempted.toString()).toBe('0.3');
  });

  it('Method A converts the reference value into the project currency', () => {
    const p = simpleProject({ currency: 'INR' });
    p.acu.referenceValue = 1;
    p.acu.referenceCurrency = 'INR';
    const s = buildSnapshot(p, cat, { rampFactor: 1, yearIndex: 0 });
    // LLM $3 = ₹240 → 240 ACUs at ₹1 each
    expect(s.acu.methodA.toString()).toBe('240');
  });

  it('Method A measures at base-year prices, so inflation does not inflate ACU counts', () => {
    const p = simpleProject();
    p.pricing.llmPriceChangePct = 25;
    const y0 = buildSnapshot(p, cat, { rampFactor: 1, yearIndex: 0 });
    const y1 = buildSnapshot(p, cat, { rampFactor: 1, yearIndex: 1 });
    expect(y1.llm.total.toString()).toBe('3.75');
    expect(y1.acu.methodA.toString()).toBe(y0.acu.methodA.toString());
  });

  it('Method B: ACUs = Σ resource usage × versioned weights', () => {
    const p = simpleProject();
    p.acu.method = 'weighted_resource';
    const s = buildSnapshot(p, cat, { rampFactor: 1, yearIndex: 0 });
    // input 1M tokens × 100 + output 0.1M × 500 + executions 1K × 2 = 100 + 50 + 2
    expect(s.acu.methodB.toString()).toBe('152');
    expect(s.acu.total.toString()).toBe('152');
    const bd = weightedAcuBreakdown(s.resources, cat.acuWeightSets[0]);
    expect(bd.find((b) => b.key === 'output_tokens_m')!.acus.toString()).toBe('50');
  });

  it('does not equate one token with one ACU', () => {
    const p = simpleProject();
    const s = buildSnapshot(p, cat, { rampFactor: 1, yearIndex: 0 });
    expect(s.acu.total.eq(s.llm.tokens.input.plus(s.llm.tokens.output))).toBe(false);
  });

  it('ignores cost-line mappings to derived resources (no double count) and warns', () => {
    const p = simpleProject();
    p.acu.method = 'weighted_resource';
    p.costLines = [
      { id: 'c1', category: 'ORCHESTRATION', name: 'Runs', componentKey: 'wf', basis: 'per_execution', unitCost: 0, currency: 'USD', unitLabel: 'run', quantity: 1, workflowId: null, workflowAllocation: 'by_attempted', scalesWithComplexity: false, acuResourceKey: 'workflow_executions_k' },
      { id: 'c2', category: 'DOCUMENT', name: 'OCR', componentKey: 'ocr', basis: 'per_attempted', unitCost: 0.01, currency: 'USD', unitLabel: 'page', quantity: 2, workflowId: null, workflowAllocation: 'by_attempted', scalesWithComplexity: false, acuResourceKey: 'ocr_pages_k' },
    ];
    const s = buildSnapshot(p, cat, { rampFactor: 1, yearIndex: 0 });
    // executions still 1K → 2 ACUs (not 4); OCR 2,000 pages = 2K × 50 = 100 ACUs
    expect(s.acu.methodB.toString()).toBe('252');
    expect(s.warnings.some((w) => w.includes('derived ACU resource'))).toBe(true);
  });

  it('ACU price = recovered cost per ACU / (1 − target margin)', () => {
    const p = simpleProject();
    p.pricing.streams = [{ id: 'acu', type: 'acu', label: 'ACU', enabled: true, recovers: ['LLM'], targetMarginPct: 40, discountPct: 0 }];
    const r = computeProject(p, cat, { packages: false });
    const s = r.priceBook.streams[0];
    expect(s.unitCost!.toString()).toBe('0.01');
    expect(num(s.unitPrice)).toBeCloseTo(0.01 / 0.6, 12);
    expect(num(r.steady.marginPct)).toBeCloseTo(40, 9);
  });
});

describe('Weighted ABU calculation', () => {
  const mixProject = () => {
    const p = simpleProject();
    p.workflows[0].complexity = [
      { id: 's', name: 'Simple', sharePct: 60, abuWeight: 1, consumptionMultiplier: 1, humanEffortMultiplier: 1, priceOverride: null },
      { id: 'm', name: 'Medium', sharePct: 30, abuWeight: 1.5, consumptionMultiplier: 1, humanEffortMultiplier: 1, priceOverride: null },
      { id: 'c', name: 'Complex', sharePct: 10, abuWeight: 3, consumptionMultiplier: 1, humanEffortMultiplier: 1, priceOverride: null },
    ];
    return p;
  };

  it('billable ABUs = Σ accepted × complexity weight', () => {
    const s = buildSnapshot(mixProject(), cat, { rampFactor: 1, yearIndex: 0 });
    // 1000 × (0.6×1 + 0.3×1.5 + 0.1×3) = 1350
    expect(s.totals.weightedAbus.toString()).toBe('1350');
  });

  it('only accepted transactions earn ABUs; rejected, failed and retries do not', () => {
    const p = mixProject();
    Object.assign(p.workflows[0], { successRatePct: 90, acceptanceRatePct: 95, retryRatePct: 20 });
    const s = buildSnapshot(p, cat, { rampFactor: 1, yearIndex: 0 });
    const v = s.volumes.wf1;
    expect(v.accepted.toString()).toBe('855');
    expect(v.rejected.toString()).toBe('45');
    expect(v.failed.toString()).toBe('100');
    expect(v.weightedAbus.toString()).toBe(D(855).times('1.35').toString());
  });

  it('cost per ABU = attributable cost / weighted accepted ABUs and price hits target margin', () => {
    const r = computeProject(mixProject(), cat, { packages: false });
    const w = r.priceBook.streams.find((s) => s.type === 'abu')!.abu!.byWorkflow.wf1;
    expect(w.costPerAbu.toString()).toBe(D(3).div(1350).toString());
    expect(num(w.price)).toBeCloseTo(3 / 1350 / 0.5, 15);
    const complex = w.classPrices.find((c) => c.classId === 'c')!;
    expect(num(complex.price)).toBeCloseTo(num(w.price) * 3, 15);
    expect(num(r.steady.marginPct)).toBeCloseTo(50, 9);
  });

  it('failed-transaction cost: spread raises price; provider_absorbs lowers price and margin', () => {
    const p = mixProject();
    Object.assign(p.workflows[0], { successRatePct: 80, failedConsumptionPct: 100 });
    const spread = computeProject(p, cat, { packages: false });
    const p2 = structuredClone(p);
    p2.pricing.abuRateCard.failedCostAllocation = 'provider_absorbs';
    const absorb = computeProject(p2, cat, { packages: false });
    const ws = spread.priceBook.streams.find((s) => s.type === 'abu')!.abu!.byWorkflow.wf1;
    const wa = absorb.priceBook.streams.find((s) => s.type === 'abu')!.abu!.byWorkflow.wf1;
    // 20% of executions failed at full consumption → 20% of LLM cost is failure cost
    expect(spread.baseline.failureCostByWorkflow.wf1.toString()).toBe('0.6');
    expect(wa.failureCostExcluded.toString()).toBe('0.6');
    expect(wa.price.lt(ws.price)).toBe(true);
    expect(num(spread.steady.marginPct)).toBeCloseTo(50, 9);
    expect(num(absorb.steady.marginPct)).toBeLessThan(50);
  });

  it('human-assisted price factor still recovers cost at target margin', () => {
    const p = mixProject();
    p.workflows[0].humanInterventionRatePct = 40;
    p.pricing.abuRateCard.humanAssistedPriceFactor = 0.5;
    const r = computeProject(p, cat, { packages: false });
    expect(num(r.steady.marginPct)).toBeCloseTo(50, 9);
  });

  it('class price overrides are applied per transaction class', () => {
    const p = mixProject();
    p.pricing.abuRateCard.classPricing = 'override';
    p.workflows[0].complexity[2].priceOverride = 0.05;
    const r = computeProject(p, cat, { packages: false });
    const w = r.priceBook.streams.find((s) => s.type === 'abu')!.abu!.byWorkflow.wf1;
    expect(w.classPrices.find((c) => c.classId === 'c')!.price.toString()).toBe('0.05');
  });
});
