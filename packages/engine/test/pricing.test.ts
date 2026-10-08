import { describe, expect, it } from 'vitest';
import { D, computeProject, convert, marginPct, num, priceForMargin, tieredCharge, FxError } from '../src';
import type { RevenueStream } from '../src';
import { simpleProject, testCatalog } from './fixtures';

const cat = testCatalog();

describe('Gross margin', () => {
  it('price = cost / (1 − margin) and margin = (revenue − cost) / revenue', () => {
    expect(priceForMargin(65, 35).toString()).toBe('100');
    expect(marginPct(100, 65).toString()).toBe('35');
    expect(marginPct(0, 10).toString()).toBe('0');
    expect(() => priceForMargin(10, 100)).toThrow();
  });

  it('fixed implementation price recovers cost at the target margin', () => {
    const r = computeProject(simpleProject(), cat, { packages: false });
    expect(r.implementation.totalCost.toString()).toBe('10000');
    expect(r.implementation.price.toString()).toBe('12500');
    expect(r.implementation.tmValue.toString()).toBe('20000');
    expect(r.months[0].revenue.toString()).toBe('12500');
  });
});

describe('Currency conversion', () => {
  it('converts via the base currency and round-trips', () => {
    expect(convert(100, 'USD', 'INR', cat.fx).toString()).toBe('8000');
    expect(convert(8000, 'INR', 'EUR', cat.fx).toString()).toBe('80');
    expect(convert(convert(123.45, 'EUR', 'INR', cat.fx), 'INR', 'EUR', cat.fx).toString()).toBe('123.45');
  });

  it('throws on missing rates', () => {
    expect(() => convert(1, 'USD', 'XYZ', cat.fx)).toThrow(FxError);
  });

  it('a project in INR equals the same project in USD × FX', () => {
    const usd = computeProject(simpleProject(), cat, { packages: false });
    const p = simpleProject({ currency: 'INR' });
    const inr = computeProject(p, cat, { packages: false });
    expect(inr.baseline.totalRunCost.toString()).toBe(usd.baseline.totalRunCost.times(80).toString());
    expect(inr.economics.provider.tcv.toString()).toBe(usd.economics.provider.tcv.times(80).toString());
  });
});

describe('Volume tiers & commitments', () => {
  const tiers = [
    { fromUnits: 100, discountPct: 10 },
    { fromUnits: 200, discountPct: 20 },
  ];

  it('graduated tiers price each band at its own discount', () => {
    // 100 × 1 + 100 × 0.9 + 50 × 0.8 = 230
    expect(tieredCharge(D(250), D(1), tiers, 'graduated').toString()).toBe('230');
  });

  it('all-units tiers price every unit at the highest band reached', () => {
    expect(tieredCharge(D(250), D(1), tiers, 'all_units').toString()).toBe('200');
    expect(tieredCharge(D(100), D(1), tiers, 'all_units').toString()).toBe('100');
  });

  it('tier prices never fall below the margin floor', () => {
    expect(tieredCharge(D(250), D(1), tiers, 'all_units', D('0.85')).toString()).toBe('212.5');
  });

  it('ABU volume discount reduces revenue on the units above the threshold', () => {
    const p = simpleProject();
    p.pricing.abuRateCard.tiers = [{ fromUnits: 500, discountPct: 10 }];
    const r = computeProject(p, cat, { packages: false });
    const price = r.priceBook.streams.find((s) => s.type === 'abu')!.unitPrice!;
    // 500 × p + 500 × 0.9p = 950p
    expect(num(r.steady.revenue)).toBeCloseTo(num(price) * 950, 12);
  });

  it('ABU minimum commitment bills the shortfall', () => {
    const p = simpleProject();
    p.pricing.abuRateCard.minMonthlyAbus = 1500;
    const r = computeProject(p, cat, { packages: false });
    const line = r.steady.revenueLines.find((l) => l.key === 'commit');
    expect(line).toBeDefined();
    expect(num(line!.amount)).toBeCloseTo(500 * 0.006, 12);
  });

  it('ACU minimum monthly commitment trues up low usage', () => {
    const p = simpleProject();
    p.pricing.streams = [{ id: 'acu', type: 'acu', label: 'ACU', enabled: true, recovers: ['LLM'], targetMarginPct: 40, discountPct: 0 }];
    p.pricing.acuRateCard.minMonthlyCommitment = 20;
    const r = computeProject(p, cat, { packages: false });
    expect(num(r.steady.revenue)).toBeCloseTo(20, 12);
  });

  it('a negotiated ACU price below the margin floor is raised to the floor and flagged', () => {
    const p = simpleProject();
    p.pricing.streams = [{ id: 'acu', type: 'acu', label: 'ACU', enabled: true, recovers: ['LLM'], targetMarginPct: 40, discountPct: 0 }];
    p.pricing.acuRateCard.priceOverride = 0.001;
    p.pricing.acuRateCard.marginFloorPct = 20;
    const r = computeProject(p, cat, { packages: false });
    expect(r.priceBook.streams[0].floorApplied).toBe(true);
    expect(num(r.priceBook.streams[0].unitPrice)).toBeCloseTo(0.0125, 12);
    expect(r.issues.some((i) => i.code === 'ACU_FLOOR')).toBe(true);
  });
});

describe('Subscription allowances', () => {
  const subProject = (included: number) => {
    const p = simpleProject();
    p.costLines = [{ id: 'infra', category: 'INFRASTRUCTURE', name: 'Hosting', componentKey: 'hosting', basis: 'fixed_monthly', unitCost: 10, currency: 'USD', unitLabel: 'month', quantity: 1, workflowId: null, workflowAllocation: 'by_attempted', scalesWithComplexity: false }];
    p.pricing.streams = [
      { id: 'sub', type: 'subscription', label: 'Subscription', enabled: true, recovers: ['INFRASTRUCTURE'], targetMarginPct: 50, discountPct: 0 },
      { id: 'abu', type: 'abu', label: 'ABU', enabled: true, recovers: ['LLM'], targetMarginPct: 50, discountPct: 0 },
    ];
    p.pricing.subscription = { includedUnit: 'abu', includedQty: included, includedDiscountPct: 0, overagePremiumPct: 20 };
    return p;
  };

  it('usage below the allowance bills no overage; the allowance is in the subscription fee', () => {
    const r = computeProject(subProject(1200), cat, { packages: false });
    const sub = r.priceBook.streams.find((s) => s.type === 'subscription')!.subscription!;
    expect(sub.platformFee.toString()).toBe('20');
    expect(num(sub.includedValue)).toBeCloseTo(1200 * 0.006, 12);
    expect(r.steady.revenueLines.find((l) => l.key === 'overage')!.amount.toString()).toBe('0');
    expect(num(r.steady.revenue)).toBeCloseTo(20 + 7.2, 12);
  });

  it('usage above the allowance bills only the excess at the overage rate', () => {
    const r = computeProject(subProject(800), cat, { packages: false });
    const over = r.steady.revenueLines.find((l) => l.key === 'overage')!;
    // 200 excess × 0.006 × 1.2
    expect(num(over.amount)).toBeCloseTo(200 * 0.006 * 1.2, 12);
    expect(over.streamId).toBe('abu');
  });

  it('with no unit stream, overage is priced at marginal cost plus margin', () => {
    const p = subProject(500);
    p.pricing.streams = [{ id: 'sub', type: 'subscription', label: 'Subscription', enabled: true, recovers: ['INFRASTRUCTURE', 'LLM'], targetMarginPct: 50, discountPct: 0 }];
    const r = computeProject(p, cat, { packages: false });
    const sub = r.priceBook.streams[0].subscription!;
    // marginal cost per ABU = $0.003 → price 0.006 → overage 0.0072
    expect(num(sub.overageRate)).toBeCloseTo(0.0072, 12);
    expect(sub.overageStreamId).toBeNull();
  });
});

describe('Double-billing prevention', () => {
  const opsLine = { id: 'ops', category: 'AGENTOPS' as const, name: 'L2 support', componentKey: 'support', basis: 'fixed_monthly' as const, unitCost: 100, currency: 'USD', unitLabel: 'FTE', quantity: 1, workflowId: null, workflowAllocation: 'by_attempted' as const, scalesWithComplexity: false };

  it('flags a cost pool recovered by two streams as an error', () => {
    const p = simpleProject();
    p.costLines = [opsLine];
    p.pricing.streams.push({ id: 'ops', type: 'agentops', label: 'Managed AgentOps', enabled: true, recovers: ['AGENTOPS'], targetMarginPct: 25, discountPct: 0 });
    const r = computeProject(p, cat, { packages: false });
    expect(r.issues.some((i) => i.code === 'DOUBLE_RECOVERY' && i.severity === 'error')).toBe(true);
  });

  it('when AgentOps is billed separately, it is excluded from the ABU price', () => {
    const p = simpleProject();
    p.costLines = [opsLine];
    const abu = p.pricing.streams.find((s) => s.id === 'abu')!;
    abu.recovers = abu.recovers.filter((x) => x !== 'AGENTOPS');
    p.pricing.streams.push({ id: 'ops', type: 'agentops', label: 'Managed AgentOps', enabled: true, recovers: ['AGENTOPS'], targetMarginPct: 25, discountPct: 0 } satisfies RevenueStream);
    const r = computeProject(p, cat, { packages: false });
    expect(r.issues.some((i) => i.code === 'DOUBLE_RECOVERY')).toBe(false);
    const abuPrice = r.priceBook.streams.find((s) => s.type === 'abu')!.unitPrice!;
    expect(num(abuPrice)).toBeCloseTo(0.006, 12); // LLM only
    const fee = r.priceBook.streams.find((s) => s.type === 'agentops')!.monthlyFee!;
    expect(num(fee)).toBeCloseTo(100 / 0.75, 9);
  });

  it('warns about cost pools recovered by no stream', () => {
    const p = simpleProject();
    p.costLines = [opsLine];
    p.pricing.streams.find((s) => s.id === 'abu')!.recovers = ['LLM'];
    const r = computeProject(p, cat, { packages: false });
    expect(r.issues.some((i) => i.code === 'UNRECOVERED_POOL')).toBe(true);
    expect(r.steady.costByStream.unrecovered.toString()).toBe('100');
  });

  it('a one-time fee cannot recover run costs', () => {
    const p = simpleProject();
    p.pricing.streams[0].recovers = ['IMPLEMENTATION', 'LLM'];
    const r = computeProject(p, cat, { packages: false });
    expect(r.issues.some((i) => i.code === 'FIXED_FEE_RUN_POOLS')).toBe(true);
  });

  it('price escalation applies from contract year 2', () => {
    const p = simpleProject();
    p.pricing.termMonths = 24;
    p.pricing.priceEscalationPct = 5;
    const r = computeProject(p, cat, { packages: false });
    expect(num(r.months[13].revenue)).toBeCloseTo(num(r.months[12].revenue) * 1.05, 12);
  });
});
