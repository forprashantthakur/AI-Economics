import { describe, expect, it } from 'vitest';
import {
  computeProject,
  defaultCatalog,
  sampleProjects,
  num,
  validateProject,
  computeImplementation,
  schedule,
  varianceAnalysis,
  can,
  createProjectFromIntake,
  PROCESS_TEMPLATES,
  findOptimizations,
} from '../src';
import type { Decimal } from '../src';
import { simpleProject, testCatalog } from './fixtures';

const finite = (d: Decimal) => d.isFinite() && !d.isNaN();

/** Walk a result and assert every Decimal is finite. */
function assertAllFinite(obj: unknown, path = 'result', seen = new WeakSet<object>()): void {
  if (obj === null || typeof obj !== 'object') return;
  if (seen.has(obj as object)) return;
  seen.add(obj as object);
  if ((obj as { constructor?: { name?: string } }).constructor?.name === 'Decimal') {
    if (!finite(obj as Decimal)) throw new Error(`${path} is not finite`);
    return;
  }
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    if (k === 'project' || k === 'context') continue;
    assertAllFinite(v, `${path}.${k}`, seen);
  }
}

describe('Zero-volume and empty edge cases', () => {
  it('zero monthly volume computes without NaN/Infinity and reconciles', () => {
    const p = simpleProject();
    p.workflows[0].monthlyVolume = 0;
    p.costLines = [{ id: 'h', category: 'INFRASTRUCTURE', name: 'Hosting', componentKey: 'hosting', basis: 'fixed_monthly', unitCost: 50, currency: 'USD', unitLabel: 'month', quantity: 1, workflowId: null, workflowAllocation: 'by_attempted', scalesWithComplexity: false }];
    const r = computeProject(p, testCatalog());
    assertAllFinite(r);
    expect(r.baseline.totals.weightedAbus.toString()).toBe('0');
    expect(r.baseline.totalRunCost.toString()).toBe('50');
    expect(r.reconciliation.every((c) => c.pass)).toBe(true);
    // Fixed cost cannot be recovered by a per-ABU price at zero volume.
    expect(r.steady.revenue.toString()).toBe('0');
  });

  it('a project with no workflows still computes', () => {
    const p = simpleProject({ workflows: [] });
    const r = computeProject(p, testCatalog());
    assertAllFinite(r);
    expect(r.issues.some((i) => i.code === 'NO_WORKFLOWS')).toBe(true);
    expect(r.reconciliation.filter((c) => !c.pass)).toEqual([]);
  });

  it('zero-length implementation plan and zero benefits give a null payback, not an error', () => {
    const p = simpleProject();
    p.implementation.activities = [];
    const r = computeProject(p, testCatalog(), { packages: false });
    expect(r.implementation.totalCost.toString()).toBe('0');
    expect(r.economics.client.paybackMonths).toBeNull();
  });
});

describe('Reconciliation across the model, dashboards and reports', () => {
  const cat = defaultCatalog();
  const samples = sampleProjects(cat);

  it('ships exactly three illustrative sample projects', () => {
    expect(samples.map((s) => s.name)).toEqual(['Accounts Payable Agent', 'Customer Service Agent', 'RFP Response Agent']);
    expect(samples.every((s) => s.illustrative)).toBe(true);
    expect(samples[0].workflows[0].monthlyVolume).toBe(50000);
    expect(samples[1].workflows.reduce((a, w) => a + w.monthlyVolume, 0)).toBe(100000);
    expect(samples[2].workflows[0].monthlyVolume).toBe(1000);
  });

  for (const p of samples) {
    it(`${p.name}: every reconciliation check passes`, () => {
      const r = computeProject(p, cat);
      const failed = r.reconciliation.filter((c) => !c.pass).map((c) => `${c.id}: ${c.expected} vs ${c.actual}`);
      expect(failed).toEqual([]);
      expect(r.reconciliation.length).toBeGreaterThan(15);
      assertAllFinite(r);
    });

    it(`${p.name}: has no validation errors`, () => {
      const errors = validateProject(p, cat).filter((i) => i.severity === 'error');
      expect(errors).toEqual([]);
    });

    it(`${p.name}: every commercial package reconciles revenue and cost`, () => {
      const r = computeProject(p, cat);
      expect(r.packages).toHaveLength(7);
      for (const pk of r.packages) {
        const yrRev = pk.years.reduce((a, y) => a + num(y.revenue), 0);
        expect(yrRev).toBeCloseTo(num(pk.economics.provider.tcv), 4);
        expect(num(pk.economics.provider.totalCost)).toBeCloseTo(num(r.economics.provider.totalCost), 4);
        expect(pk.issues.filter((i) => i.code === 'DOUBLE_RECOVERY')).toEqual([]);
      }
    });
  }

  it('the AP sample uses ABU pricing, CS uses subscription + ABU and RFP uses subscription + ACU', () => {
    const types = samples.map((s) => s.pricing.streams.filter((x) => x.enabled).map((x) => x.type).sort().join('+'));
    expect(types).toEqual(['abu+fixed_fee', 'abu+fixed_fee+subscription', 'acu+fixed_fee+subscription']);
  });

  it('variance analysis aggregates actuals by period and reconciles to rows', () => {
    const r = computeProject(samples[0], cat, { packages: false });
    const v = varianceAnalysis(r, cat);
    expect(v.byPeriod).toHaveLength(6);
    const sumRows = v.rows.reduce((a, x) => a + num(x.actTotalCost), 0);
    expect(num(v.totals!.actTotalCost)).toBeCloseTo(sumRows, 6);
  });

  it('finds deterministic optimisation opportunities with positive savings', () => {
    const o = findOptimizations(samples[0], cat);
    expect(o.length).toBeGreaterThan(2);
    expect(o.every((x) => x.monthlySaving.gt(0))).toBe(true);
    expect(num(o[0].monthlySaving)).toBeGreaterThanOrEqual(num(o[o.length - 1].monthlySaving));
  });
});

describe('Double-count detection in inputs', () => {
  it('flags the same component costed in two categories', () => {
    const p = simpleProject();
    const base = { basis: 'fixed_monthly' as const, unitCost: 1, currency: 'USD', unitLabel: 'm', quantity: 1, workflowId: null, workflowAllocation: 'by_attempted' as const, scalesWithComplexity: false };
    p.costLines = [
      { id: 'a', category: 'INFRASTRUCTURE', name: 'Monitoring platform', componentKey: 'monitoring', ...base },
      { id: 'b', category: 'AGENTOPS', name: 'Agent monitoring tool', componentKey: 'monitoring', ...base },
    ];
    expect(validateProject(p, testCatalog()).some((i) => i.code === 'DUPLICATE_COMPONENT' && i.severity === 'warning')).toBe(true);
  });

  it('flags GPU costed both in a self-hosted token rate and as infrastructure', () => {
    const cat = defaultCatalog();
    const p = simpleProject();
    p.workflows[0].llmSteps[0].routing = [{ modelId: 'selfhosted-70b', sharePct: 100 }];
    p.costLines = [{ id: 'g', category: 'INFRASTRUCTURE', name: 'GPU nodes', componentKey: 'gpu', basis: 'fixed_monthly', unitCost: 4, currency: 'USD', unitLabel: 'h', quantity: 720, workflowId: null, workflowAllocation: 'by_attempted', scalesWithComplexity: false }];
    expect(validateProject(p, cat).some((i) => i.code === 'GPU_DOUBLE_COUNT')).toBe(true);
  });

  it('flags LLM token spend entered as a non-LLM cost line', () => {
    const p = simpleProject();
    p.costLines = [{ id: 't', category: 'ORCHESTRATION', name: 'GPT token spend', componentKey: 'x', basis: 'fixed_monthly', unitCost: 1, currency: 'USD', unitLabel: 'm', quantity: 1, workflowId: null, workflowAllocation: 'by_attempted', scalesWithComplexity: false }];
    expect(validateProject(p, testCatalog()).some((i) => i.code === 'LLM_IN_COST_LINE')).toBe(true);
  });
});

describe('Implementation estimator', () => {
  it('cost = Σ effort × cost rate + expenses + contingency; price at target margin', () => {
    const p = simpleProject();
    p.implementation.activities.push({ id: 'a2', phase: 'Test', name: 'Test', roleId: 'r1', effort: 5, effortUnit: 'days', durationWeeks: 2, dependsOn: ['a1'] });
    p.implementation.directExpenses = [{ id: 'x', name: 'Travel', amount: 1000, currency: 'USD', billable: true }];
    p.implementation.contingencyPct = 10;
    const r = computeImplementation(p.implementation, 'USD', testCatalog().fx);
    // 140 h × 100 = 14,000 + 1,000 = 15,000 + 10% = 16,500
    expect(r.laborHours.toString()).toBe('140');
    expect(r.totalCost.toString()).toBe('16500');
    expect(r.price.toString()).toBe('20625');
    expect(r.durationWeeks).toBe(6);
    expect(r.activities.every((a) => a.critical)).toBe(true);
  });

  it('detects circular dependencies', () => {
    const p = simpleProject();
    p.implementation.activities = [
      { id: 'x', phase: 'A', name: 'X', roleId: 'r1', effort: 1, effortUnit: 'hours', durationWeeks: 1, dependsOn: ['y'] },
      { id: 'y', phase: 'A', name: 'Y', roleId: 'r1', effort: 1, effortUnit: 'hours', durationWeeks: 1, dependsOn: ['x'] },
    ];
    expect(schedule(p.implementation).errors.length).toBeGreaterThan(0);
  });

  it('every process template builds a computable, reconciling project', () => {
    const cat = defaultCatalog();
    expect(PROCESS_TEMPLATES.length).toBeGreaterThanOrEqual(23);
    for (const t of PROCESS_TEMPLATES) {
      const p = createProjectFromIntake(
        { projectName: t.name, client: { clientName: 'X', industry: 'X', geography: 'India', businessFunction: '', businessProcess: '', engagementType: 'X' }, currency: 'INR', templateId: t.id, provider: 'openai', cloudPlatform: 'AWS', solutionType: 'multi_agent' },
        cat,
      );
      const r = computeProject(p, cat, { packages: false });
      expect(r.reconciliation.filter((c) => !c.pass)).toEqual([]);
      expect(r.issues.filter((i) => i.severity === 'error')).toEqual([]);
      expect(r.baseline.totalRunCost.gt(0)).toBe(true);
    }
  });
});

describe('Role-based access', () => {
  it('enforces the permission matrix', () => {
    expect(can('finance', 'benefit.validate')).toBe(true);
    expect(can('consultant', 'benefit.validate')).toBe(false);
    expect(can('executive', 'project.edit')).toBe(false);
    expect(can('admin', 'user.manage')).toBe(true);
    expect(can('nobody', 'report.export')).toBe(false);
  });
});
