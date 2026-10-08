import { describe, expect, it } from 'vitest';
import { SCENARIO_PRESETS, applyScenario, breakEven, computeProject, costWaterfall, defaultCatalog, num, runScenario, sampleProjects, sensitivity, steadyGrossProfit, D } from '../src';
import { simpleProject, testCatalog } from './fixtures';

describe('Scenario simulator', () => {
  const cat = defaultCatalog();
  const base = computeProject(sampleProjects(cat)[0], cat);

  it('the baseline preset reproduces the base result', () => {
    const r = runScenario(base, cat, SCENARIO_PRESETS.baseline.overrides);
    expect(r.result.baseline.totalRunCost.toString()).toBe(base.baseline.totalRunCost.toString());
    expect(r.result.economics.provider.tcv.toString()).toBe(base.economics.provider.tcv.toString());
  });

  it('optimized lowers and stress raises cost per ABU', () => {
    const o = runScenario(base, cat, SCENARIO_PRESETS.optimized.overrides, false);
    const s = runScenario(base, cat, SCENARIO_PRESETS.stress.overrides, false);
    const b = num(base.baseline.totalRunCost) / num(base.baseline.totals.weightedAbus);
    expect(num(o.metrics.costPerAbu)).toBeLessThan(b);
    expect(num(s.metrics.costPerAbu)).toBeGreaterThan(b);
  });

  it('keeps contracted prices locked unless repricing is requested', () => {
    const locked = runScenario(base, cat, { inputTokenMultiplier: 2 }, false);
    const lp = locked.result.priceBook.streams.find((s) => s.type === 'abu')!.abu!.byWorkflow;
    const bp = base.priceBook.streams.find((s) => s.type === 'abu')!.abu!.byWorkflow;
    expect(Object.values(lp)[0].price.toString()).toBe(Object.values(bp)[0].price.toString());
    expect(num(locked.metrics.providerMarginPct)).toBeLessThan(num(base.steady.marginPct));
    const repriced = runScenario(base, cat, { inputTokenMultiplier: 2, repriceAtTargetMargin: true }, false);
    expect(num(Object.values(repriced.result.priceBook.streams.find((s) => s.type === 'abu')!.abu!.byWorkflow)[0].price)).toBeGreaterThan(num(Object.values(bp)[0].price));
  });

  it('the cost waterfall bridges baseline to scenario exactly', () => {
    const steps = costWaterfall(base.project, cat, SCENARIO_PRESETS.stress.overrides);
    const start = steps[0].value;
    const end = steps[steps.length - 1].value;
    const deltas = steps.filter((s) => s.kind === 'delta').reduce((a, s) => a + s.value, 0);
    expect(start + deltas).toBeCloseTo(end, 6);
    const direct = runScenario(base, cat, SCENARIO_PRESETS.stress.overrides, false);
    expect(end).toBeCloseTo(num(direct.metrics.monthlyRunCost), 6);
  });

  it('sensitivity rows are sorted by margin range', () => {
    const s = sensitivity(base, cat);
    expect(s.rows.length).toBeGreaterThan(8);
    for (let i = 1; i < s.rows.length; i++) expect(s.rows[i - 1].range).toBeGreaterThanOrEqual(s.rows[i].range);
  });

  it('applyScenario does not mutate the input project', () => {
    const before = JSON.stringify(base.project);
    applyScenario(base.project, SCENARIO_PRESETS.stress.overrides);
    expect(JSON.stringify(base.project)).toBe(before);
  });
});

describe('Break-even volume', () => {
  it('finds the volume where run-rate gross profit is zero at locked prices', () => {
    const cat = testCatalog();
    const p = simpleProject();
    p.costLines = [{ id: 'h', category: 'INFRASTRUCTURE', name: 'Hosting', componentKey: 'hosting', basis: 'fixed_monthly', unitCost: 30, currency: 'USD', unitLabel: 'month', quantity: 1, workflowId: null, workflowAllocation: 'by_attempted', scalesWithComplexity: false }];
    p.pricing.streams = [{ id: 'abu', type: 'abu', label: 'ABU', enabled: true, recovers: ['LLM', 'INFRASTRUCTURE'], targetMarginPct: 50, discountPct: 0 }];
    const r = computeProject(p, cat, { packages: false });
    // price = (3 + 30) / 0.5 / 1000 = 0.066; unit variable cost 0.003 → BE = 30 / 0.063 ≈ 476.19 per month
    const be = breakEven(p, cat, r.priceBook)!;
    expect(be.status).toBe('found');
    expect(be.monthlyVolume).toBeCloseTo(30 / 0.063, 3);
    expect(Math.abs(num(steadyGrossProfit(p, cat, r.priceBook, be.multiplier, D(1000))))).toBeLessThan(1e-6);
  });
});
