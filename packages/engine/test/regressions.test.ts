import { describe, expect, it } from 'vitest';
import { breakEven, computeProject, num, runScenario, defaultCatalog, sampleProjects, validateProject } from '../src';
import { simpleProject, testCatalog } from './fixtures';

const cat = testCatalog();

describe('Robustness against invalid inputs', () => {
  it('a margin floor of 100% or more is capped and reported, not a crash', () => {
    const p = simpleProject();
    p.pricing.abuRateCard.marginFloorPct = 100;
    p.pricing.streams[1].targetMarginPct = 120;
    const r = computeProject(p, cat, { packages: false });
    expect(r.issues.filter((i) => i.code === 'MARGIN_RANGE').length).toBeGreaterThanOrEqual(2);
    expect(r.steady.revenue.isFinite()).toBe(true);
  });

  it('a currency without an FX rate is reported and treated 1:1, not a crash', () => {
    const p = simpleProject();
    p.value.clientCosts = [{ id: 'c', name: 'Licence', type: 'monthly', amount: 10, currency: 'CHF' }];
    const r = computeProject(p, cat, { packages: false });
    expect(r.issues.some((i) => i.code === 'FX_MISSING' && i.message.includes('CHF'))).toBe(true);
    expect(num(r.months[1].clientInternalCost)).toBeCloseTo(10, 9);
  });

  it('a contract term below one month is reported', () => {
    const p = simpleProject();
    p.pricing.termMonths = 0;
    expect(validateProject(p, cat).some((i) => i.code === 'TERM')).toBe(true);
  });
});

describe('Scenario and value fixes', () => {
  it('volume-scaled benefits move with scenario volume', () => {
    const c = defaultCatalog();
    const base = computeProject(sampleProjects(c)[0], c, { packages: false });
    const low = runScenario(base, c, { volumeMultiplier: 0.8 }, false);
    expect(num(low.result.steady.value.forecast)).toBeLessThan(num(base.steady.value.forecast));
  });

  it('client-borne review does not double count rejected transactions', () => {
    const p = simpleProject();
    Object.assign(p.workflows[0], { acceptanceRatePct: 90, humanInterventionRatePct: 0 });
    p.workflows[0].humanReview = { minutesPerAssistedTxn: 6, minutesPerRejectedTxn: 30, hourlyCost: 30, currency: 'USD', borneBy: 'client' };
    p.value.productivity = [{ workflowId: 'wf1', manualMinutesBefore: 60, spotCheckMinutesAutonomous: 0, loadedHourlyCost: 1, currency: 'USD', productiveHoursPerFteMonth: 100 }];
    const r = computeProject(p, cat, { packages: false });
    // 900 accepted save 60 min; 100 rejected revert to manual (no extra 30-minute rework on top)
    expect(r.steady.value.hoursSaved.toString()).toBe('900');
  });

  it('break-even finds the loss-to-profit crossing even when a minimum commitment makes tiny volumes profitable', () => {
    const p = simpleProject();
    p.costLines = [{ id: 'h', category: 'INFRASTRUCTURE', name: 'Hosting', componentKey: 'hosting', basis: 'fixed_monthly', unitCost: 30, currency: 'USD', unitLabel: 'month', quantity: 1, workflowId: null, workflowAllocation: 'by_attempted', scalesWithComplexity: false }];
    p.pricing.streams = [{ id: 'abu', type: 'abu', label: 'ABU', enabled: true, recovers: ['LLM', 'INFRASTRUCTURE'], targetMarginPct: 50, discountPct: 0 }];
    const r = computeProject(p, cat, { packages: false });
    // Contract a minimum of 200 ABUs/month and halve the price: tiny volumes are covered by the minimum, mid volumes lose money.
    p.pricing.abuRateCard.minMonthlyAbus = 600;
    const r2 = computeProject(p, cat, { packages: false, priceBook: { ...r.priceBook, priceMultiplier: r.priceBook.priceMultiplier.times(0.5) } });
    const be = breakEven(p, cat, r2.priceBook)!;
    expect(be.status).toBe('found');
    expect(be.monthlyVolume).toBeGreaterThan(600);
  });
});

describe('Missing FX rates in analysis tools', () => {
  it('waterfall, optimisation finder and break-even do not crash on a currency without a rate', async () => {
    const { costWaterfall, findOptimizations } = await import('../src');
    const p = simpleProject();
    p.costLines = [{ id: 'h', category: 'INFRASTRUCTURE', name: 'Hosting', componentKey: 'hosting', basis: 'fixed_monthly', unitCost: 30, currency: 'CHF', unitLabel: 'month', quantity: 1, workflowId: null, workflowAllocation: 'by_attempted', scalesWithComplexity: false }];
    const r = computeProject(p, cat, { packages: false });
    expect(() => costWaterfall(p, cat, { volumeMultiplier: 1.2 })).not.toThrow();
    expect(() => findOptimizations(p, cat)).not.toThrow();
    expect(() => breakEven(p, cat, r.priceBook)).not.toThrow();
  });
});
