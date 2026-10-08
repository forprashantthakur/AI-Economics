import { describe, expect, it } from 'vitest';
import { D, computeProject, npv, num, paybackMonths, validateProject } from '../src';
import type { BenefitLine } from '../src';
import { simpleProject, testCatalog } from './fixtures';

const cat = testCatalog();

const benefit = (b: Partial<BenefitLine>): BenefitLine => ({
  id: 'b',
  name: 'Benefit',
  category: 'hard_savings',
  annualAmount: 12000,
  currency: 'USD',
  startMonth: 1,
  rampMonths: 0,
  confidencePct: 100,
  status: 'finance_validated',
  overlapGroup: null,
  scalesWithVolume: false,
  ...b,
});

describe('NPV, payback and ROI', () => {
  it('NPV discounts monthly flows at the annual rate', () => {
    const flows = [D(-1000), ...Array(12).fill(D(100))];
    const expected = -1000 + Array.from({ length: 12 }, (_, i) => 100 / Math.pow(1.1, (i + 1) / 12)).reduce((a, b) => a + b, 0);
    expect(num(npv(flows, 10))).toBeCloseTo(expected, 9);
  });

  it('payback interpolates within the crossing month', () => {
    expect(paybackMonths([D(-100), D(30), D(30), D(30), D(30)])).toBeCloseTo(3 + 1 / 3, 12);
    expect(paybackMonths([D(-100), D(10)])).toBeNull();
    expect(paybackMonths([D(5), D(1)])).toBe(0);
  });

  it('ROI = (validated benefits − total AI investment) / total AI investment × 100', () => {
    const p = simpleProject();
    p.value.benefits = [benefit({ annualAmount: 120000 })];
    const r = computeProject(p, cat, { packages: false });
    const c = r.economics.client;
    expect(num(c.countedBenefits)).toBeCloseTo(120000, 9);
    expect(num(c.roiPct)).toBeCloseTo(((120000 - num(c.totalInvestment)) / num(c.totalInvestment)) * 100, 9);
    expect(c.totalInvestment.toString()).toBe(r.economics.provider.tcv.toString());
  });
});

describe('Productivity value ≠ realised cash savings', () => {
  it('released hours are reported as productivity but not counted as financial benefit', () => {
    const p = simpleProject();
    p.value.productivity = [{ workflowId: 'wf1', manualMinutesBefore: 12, spotCheckMinutesAutonomous: 0, loadedHourlyCost: 50, currency: 'USD', productiveHoursPerFteMonth: 100 }];
    const r = computeProject(p, cat, { packages: false });
    // 1000 × 12 min = 200 h saved × $50 = $10,000 per month of productivity
    expect(r.steady.value.hoursSaved.toString()).toBe('200');
    expect(r.steady.value.productivityValue.toString()).toBe('10000');
    expect(r.steady.value.fteReleased.toString()).toBe('2');
    expect(r.economics.client.countedBenefits.toString()).toBe('0');
  });

  it('failed and rejected transactions fall back to manual effort', () => {
    const p = simpleProject();
    Object.assign(p.workflows[0], { successRatePct: 90, acceptanceRatePct: 90 });
    p.value.productivity = [{ workflowId: 'wf1', manualMinutesBefore: 60, spotCheckMinutesAutonomous: 0, loadedHourlyCost: 1, currency: 'USD', productiveHoursPerFteMonth: 100 }];
    const r = computeProject(p, cat, { packages: false });
    // accepted 810 save 60 min each; 190 failed/rejected revert to manual
    expect(r.steady.value.hoursSaved.toString()).toBe('810');
  });

  it('client-borne review time reduces hours saved; provider-borne review does not', () => {
    const mk = (borneBy: 'client' | 'provider') => {
      const p = simpleProject();
      Object.assign(p.workflows[0], { humanInterventionRatePct: 50 });
      p.workflows[0].humanReview = { minutesPerAssistedTxn: 6, minutesPerRejectedTxn: 0, hourlyCost: 30, currency: 'USD', borneBy };
      p.value.productivity = [{ workflowId: 'wf1', manualMinutesBefore: 12, spotCheckMinutesAutonomous: 0, loadedHourlyCost: 50, currency: 'USD', productiveHoursPerFteMonth: 100 }];
      return computeProject(p, cat, { packages: false });
    };
    const client = mk('client');
    const provider = mk('provider');
    expect(client.steady.value.hoursSaved.toString()).toBe('150'); // 200 − 500 × 6 min
    expect(client.baseline.pools.HUMAN_REVIEW.toString()).toBe('0');
    expect(provider.steady.value.hoursSaved.toString()).toBe('200');
    expect(provider.baseline.pools.HUMAN_REVIEW.toString()).toBe('1500'); // 50 h × $30
  });
});

describe('Benefit validation and double-count prevention', () => {
  it('only finance-validated or realised benefits count unless the forecast view is on', () => {
    const p = simpleProject();
    p.value.benefits = [benefit({ id: 'a', annualAmount: 12000 }), benefit({ id: 'b', annualAmount: 24000, status: 'proposed' }), benefit({ id: 'c', annualAmount: 99999, status: 'rejected' })];
    const r = computeProject(p, cat, { packages: false });
    expect(num(r.steady.value.validated)).toBeCloseTo(1000, 9);
    expect(num(r.steady.value.forecast)).toBeCloseTo(3000, 9);
    p.value.includeUnvalidated = true;
    const f = computeProject(p, cat, { packages: false });
    expect(num(f.economics.client.countedBenefits)).toBeCloseTo(36000, 9);
  });

  it('overlapping benefits are not additive — only the largest in a group counts', () => {
    const p = simpleProject();
    p.value.benefits = [benefit({ id: 'a', annualAmount: 12000, overlapGroup: 'labour' }), benefit({ id: 'b', annualAmount: 18000, overlapGroup: 'labour' })];
    const r = computeProject(p, cat, { packages: false });
    expect(num(r.steady.value.validated)).toBeCloseTo(1500, 9);
    expect(r.steady.value.lines.find((l) => l.lineId === 'a')!.excludedReason).toMatch(/Overlaps/);
  });

  it('capacity conversion is capped at the productivity value it converts', () => {
    const p = simpleProject();
    p.value.productivity = [{ workflowId: 'wf1', manualMinutesBefore: 6, spotCheckMinutesAutonomous: 0, loadedHourlyCost: 10, currency: 'USD', productiveHoursPerFteMonth: 100 }];
    p.value.benefits = [benefit({ category: 'capacity_conversion', annualAmount: 120000 })];
    const r = computeProject(p, cat, { packages: false });
    // productivity = 100 h × $10 = $1,000/month; conversion claims $10,000/month → capped
    expect(num(r.steady.value.validated)).toBeCloseTo(1000, 9);
  });

  it('confidence and ramp scale benefits', () => {
    const p = simpleProject();
    p.value.benefits = [benefit({ annualAmount: 12000, confidencePct: 50, startMonth: 2, rampMonths: 4 })];
    const r = computeProject(p, cat, { packages: false });
    expect(r.months[1].validatedBenefit.toString()).toBe('0');
    expect(num(r.months[2].validatedBenefit)).toBeCloseTo(1000 * 0.5 * 0.25, 9);
    expect(num(r.months[6].validatedBenefit)).toBeCloseTo(500, 9);
  });

  it('flags unvalidated capacity conversion', () => {
    const p = simpleProject();
    p.value.benefits = [benefit({ category: 'capacity_conversion', status: 'proposed' })];
    expect(validateProject(p, cat).some((i) => i.code === 'CAPACITY_UNVALIDATED')).toBe(true);
  });
});
