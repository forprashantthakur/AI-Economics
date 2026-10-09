/**
 * Engine entry point: computeProject() runs every module in order and returns
 * one ProjectResult that all dashboards, reports and exports read from — so
 * figures reconcile everywhere by construction. reconcile() proves it.
 */
import { D, Decimal, ZERO, safeDiv, sum } from './decimal';
import type { Catalog, Project } from './types';
import { RUN_POOLS } from './types';
import { computeImplementation, type ImplementationResult } from './implementation';
import { buildSnapshot, type RunSnapshot } from './model';
import { buildPriceBook, type Issue, type MarginalCosts, type PriceBook } from './pricing';
import { buildContext, runProjection, type ProjectionContext, type ProjectionResult } from './projection';
import { computePackages, type PackageResult } from './commercial';
import { currenciesUsed, validateProject } from './validate';

export interface ReconCheck {
  id: string;
  name: string;
  expected: Decimal;
  actual: Decimal;
  pass: boolean;
}

export interface ProjectResult extends ProjectionResult {
  project: Project;
  currency: string;
  implementation: ImplementationResult;
  baseline: RunSnapshot;
  marginal: MarginalCosts;
  priceBook: PriceBook;
  packages: PackageResult[];
  issues: Issue[];
  reconciliation: ReconCheck[];
  context: ProjectionContext;
}

export interface ComputeOptions {
  /** Compute the seven commercial construct packages (default true). */
  packages?: boolean;
  /** Use an existing (contracted) price book instead of deriving prices. */
  priceBook?: PriceBook;
  /**
   * Monthly attempted volume that volume-scaled benefits were estimated at. Defaults to this project's
   * own steady-state volume; scenarios pass the original project's volume so benefits move with volume.
   */
  benefitVolumeBase?: Decimal;
}

export function marginalCosts(project: Project, catalog: Catalog, baseline: RunSnapshot): MarginalCosts {
  const bumped = buildSnapshot(project, catalog, { rampFactor: 1.01, yearIndex: 0 });
  const dCost = bumped.totalRunCost.minus(baseline.totalRunCost);
  return {
    perAcu: safeDiv(dCost, bumped.acu.total.minus(baseline.acu.total)),
    perAbu: safeDiv(dCost, bumped.totals.weightedAbus.minus(baseline.totals.weightedAbus)),
  };
}

/**
 * Returns the catalogue unchanged when every currency the project uses has an FX rate; otherwise a copy
 * whose FX table treats each missing currency as 1:1 with the base, so the computation never fails
 * (validateProject reports FX_MISSING as an error so the user fixes the rate).
 */
export function withFxFallback(project: Project, catalog: Catalog): Catalog {
  const missing = [...currenciesUsed(project, catalog)].filter((c) => !catalog.fx.rates[c] && c !== catalog.fx.base);
  if (!missing.length) return catalog;
  return { ...catalog, fx: { ...catalog.fx, rates: { ...catalog.fx.rates, ...Object.fromEntries(missing.map((c) => [c, 1])) } } };
}

export function computeProject(project: Project, inputCatalog: Catalog, opts: ComputeOptions = {}): ProjectResult {
  const catalog = withFxFallback(project, inputCatalog);
  const implementation = computeImplementation(project.implementation, project.currency, catalog.fx);
  const context = buildContext(project, catalog, implementation, opts.benefitVolumeBase);
  const baseline = context.baseline;
  const marginal = marginalCosts(project, catalog, baseline);
  const priceBook = opts.priceBook ?? buildPriceBook({ project, baseline, impl: implementation, marginal });
  const projection = runProjection(context, priceBook);
  const packages = opts.packages === false ? [] : computePackages(context, marginal, { priceBook, projection });

  const issues: Issue[] = [
    ...validateProject(project, inputCatalog),
    ...priceBook.issues,
    ...baseline.warnings.map((m) => ({ severity: 'warning' as const, code: 'MODEL', message: m })),
    ...implementation.scheduleErrors.map((m) => ({ severity: 'error' as const, code: 'SCHEDULE', message: m })),
  ];
  const seen = new Set<string>();
  const uniqueIssues = issues.filter((i) => {
    const k = `${i.code}|${i.message}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });

  const result: ProjectResult = {
    project,
    currency: project.currency,
    implementation,
    baseline,
    marginal,
    priceBook,
    packages,
    issues: uniqueIssues,
    reconciliation: [],
    context,
    ...projection,
  };
  result.reconciliation = reconcile(result);
  return result;
}

function check(id: string, name: string, expected: Decimal, actual: Decimal): ReconCheck {
  const tol = Decimal.max(D('0.000001'), expected.abs().times(D('1e-12')));
  return { id, name, expected, actual, pass: expected.minus(actual).abs().lte(tol) };
}

export function reconcile(r: ProjectResult): ReconCheck[] {
  const b = r.baseline;
  const checks: ReconCheck[] = [];
  const total = b.totalRunCost;
  checks.push(check('pools', 'Run cost by pool = total run cost', total, sum(RUN_POOLS.map((p) => b.pools[p]))));
  checks.push(check('workflows', 'Run cost by workflow = total run cost', total, sum(Object.values(b.runCostByWorkflow))));
  checks.push(check('agents', 'Fully loaded cost by agent = total run cost', total, sum(Object.values(b.runCostByAgent))));
  checks.push(check('functions', 'Cost by business function = total run cost', total, sum(Object.values(b.runCostByFunction))));
  checks.push(check('llm-model', 'LLM cost by model = LLM total', b.llm.total, sum(Object.values(b.llm.byModel))));
  checks.push(check('llm-agent', 'LLM cost by agent = LLM total', b.llm.total, sum(Object.values(b.llm.byAgent))));
  checks.push(check('llm-workflow', 'LLM cost by workflow = LLM total', b.llm.total, sum(Object.values(b.llm.byWorkflow))));
  checks.push(
    check(
      'tokens',
      'Uncached + cache read + cache write tokens = input tokens (no double count)',
      b.llm.tokens.input,
      sum(b.llmLines.map((l) => l.uncachedInputTokens.plus(l.cacheReadTokens).plus(l.cacheWriteTokens))),
    ),
  );
  checks.push(check('cost-lines', 'Cost lines allocated to workflows = cost line totals', sum(b.costLines.map((c) => c.monthlyCost)), sum(b.costLines.map((c) => sum(Object.values(c.byWorkflow))))));
  checks.push(
    check(
      'funnel',
      'Accepted + rejected + failed = attempted transactions',
      b.totals.attempted,
      b.totals.accepted.plus(b.totals.rejected).plus(b.totals.failed),
    ),
  );
  checks.push(check('abu-classes', 'Σ class weighted ABUs = weighted ABUs', b.totals.weightedAbus, sum(Object.values(b.volumes).flatMap((v) => v.byClass.map((c) => c.weightedAbus)))));
  checks.push(check('acu-workflow', 'ACUs by workflow = total ACUs', b.acu.total, sum(Object.values(b.acu.byWorkflow).length ? Object.values(b.acu.byWorkflow) : [b.acu.total])));
  const impl = r.implementation;
  checks.push(check('implementation', 'Labour + expenses + contingency = implementation cost', impl.totalCost, impl.laborCost.plus(impl.directExpenses).plus(impl.contingency)));
  checks.push(check('impl-phase', 'Implementation cost by phase = labour cost', impl.laborCost, sum(Object.values(impl.costByPhase))));
  const tcv = r.economics.provider.tcv;
  checks.push(check('tcv-months', 'Σ monthly revenue = total contract value', tcv, sum(r.months.map((m) => m.revenue))));
  checks.push(check('tcv-years', 'Σ yearly revenue = total contract value', tcv, sum(r.years.map((y) => y.revenue))));
  checks.push(check('cost-years', 'Σ yearly cost = total provider cost', r.economics.provider.totalCost, sum(r.years.map((y) => y.cost))));
  checks.push(check('rev-streams', 'Revenue by stream = total revenue', tcv, sum(r.months.flatMap((m) => Object.values(m.revenueByStream)))));
  checks.push(check('cost-streams', 'Cost attributed to streams (+ unrecovered) = total cost', r.economics.provider.totalCost, sum(r.months.flatMap((m) => Object.values(m.costByStream)))));
  checks.push(check('steady-streams', 'Steady-state revenue by stream = steady revenue', r.steady.revenue, sum(Object.values(r.steady.revenueByStream))));
  const abu = r.priceBook.streams.find((s) => s.type === 'abu')?.abu;
  if (abu) {
    const s = r.priceBook.streams.find((x) => x.type === 'abu')!;
    checks.push(
      check(
        'abu-recovery',
        'ABU recovered cost by workflow (+ absorbed failures) = ABU stream recovered cost',
        s.recoveredCost,
        sum(Object.values(abu.byWorkflow).map((w) => w.recoveredCost.plus(w.failureCostExcluded))),
      ),
    );
  }
  checks.push(
    check(
      'client-investment',
      'Client investment = provider revenue + client internal costs',
      r.economics.client.totalInvestment,
      tcv.plus(sum(r.months.map((m) => m.clientInternalCost))),
    ),
  );
  return checks;
}

export { ZERO };
