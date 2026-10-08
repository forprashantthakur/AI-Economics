/**
 * Module 7 — the seven commercial constructs, each expressed as a complete
 * package that recovers the same full cost base (implementation + run) so
 * provider margin and client ROI are directly comparable.
 */
import type { Project, RevenueStream, CostPool } from './types';
import { RUN_POOLS } from './types';
import { buildPriceBook, type Issue, type MarginalCosts, type PriceBook } from './pricing';
import { runProjection, type Economics, type ProjectionContext, type Steady, type YearSummary } from './projection';

export type ConstructId = 'fixed' | 'acu' | 'abu' | 'subscription' | 'agentops' | 'gainshare' | 'hybrid';

export const CONSTRUCTS: { id: ConstructId; name: string; short: string; description: string }[] = [
  { id: 'fixed', name: 'Fixed implementation fee', short: 'Fixed fee', description: 'Fixed-price implementation plus a fixed monthly managed-service fee covering run costs.' },
  { id: 'acu', name: 'ACU consumption pricing', short: 'ACU', description: 'Implementation fee plus run costs recovered through a price per AI Consumption Unit.' },
  { id: 'abu', name: 'ABU transaction pricing', short: 'ABU', description: 'Implementation fee plus run costs recovered through a price per accepted, weighted business unit.' },
  { id: 'subscription', name: 'Subscription / committed capacity', short: 'Subscription', description: 'One monthly subscription (implementation amortised) sized for committed capacity, with overage per ABU.' },
  { id: 'agentops', name: 'Managed AgentOps', short: 'AgentOps', description: 'Implementation fee, managed AgentOps fee, and AI consumption passed through at cost plus a handling markup.' },
  { id: 'gainshare', name: 'Outcome-based gainshare', short: 'Gainshare', description: 'Implementation at cost; run costs recovered from a share of client benefits (provider takes outcome risk).' },
  { id: 'hybrid', name: 'Hybrid commercial model', short: 'Hybrid', description: 'The commercial model configured for this project in Commercial Pricing.' },
];

const ALL_RUN: CostPool[] = [...RUN_POOLS];

function runMargin(project: Project): number {
  const s = project.pricing.streams.find((x) => x.enabled && ['abu', 'acu', 'subscription', 'fixed_monthly'].includes(x.type));
  return s?.targetMarginPct ?? 30;
}

const stream = (id: string, type: RevenueStream['type'], label: string, recovers: CostPool[], targetMarginPct: number, extra: Partial<RevenueStream> = {}): RevenueStream => ({
  id,
  type,
  label,
  enabled: true,
  recovers,
  targetMarginPct,
  discountPct: 0,
  ...extra,
});

export function packageProject(project: Project, id: ConstructId, baselineWeightedAbus: number): Project {
  if (id === 'hybrid') return project;
  const m = runMargin(project);
  const impl = stream('pkg-impl', 'fixed_fee', 'Implementation fee', ['IMPLEMENTATION'], project.implementation.targetMarginPct);
  const clean: Project['pricing'] = {
    ...project.pricing,
    acuRateCard: { ...project.pricing.acuRateCard, tiers: [], minMonthlyCommitment: 0, priceOverride: null },
    abuRateCard: { ...project.pricing.abuRateCard, tiers: [], minMonthlyAbus: 0, priceOverrides: {}, classPricing: 'weighted' },
    subscription: { includedUnit: 'none', includedQty: 0, includedDiscountPct: 0, overagePremiumPct: 0 },
  };
  let streams: RevenueStream[];
  let pricing = clean;
  switch (id) {
    case 'fixed':
      streams = [impl, stream('pkg-run', 'fixed_monthly', 'Fixed monthly run fee', ALL_RUN, m)];
      break;
    case 'acu':
      streams = [impl, stream('pkg-acu', 'acu', 'ACU consumption', ALL_RUN, m)];
      break;
    case 'abu':
      streams = [impl, stream('pkg-abu', 'abu', 'ABU transactions', ALL_RUN, m)];
      break;
    case 'subscription':
      streams = [stream('pkg-sub', 'subscription', 'Subscription', [...ALL_RUN, 'IMPLEMENTATION'], m)];
      pricing = { ...clean, subscription: { includedUnit: 'abu', includedQty: Math.round(baselineWeightedAbus), includedDiscountPct: 0, overagePremiumPct: 10 } };
      break;
    case 'agentops':
      streams = [
        impl,
        stream('pkg-ops', 'agentops', 'Managed AgentOps fee', ['AGENTOPS', 'HUMAN_REVIEW'], Math.max(20, m - 5)),
        stream('pkg-pass', 'pass_through', 'AI consumption pass-through', ALL_RUN.filter((p) => p !== 'AGENTOPS' && p !== 'HUMAN_REVIEW'), 0),
      ];
      break;
    case 'gainshare':
      streams = [
        stream('pkg-impl', 'fixed_fee', 'Implementation fee (at cost)', ['IMPLEMENTATION'], 0, { useImplementationPlanPrice: false }),
        stream('pkg-gain', 'gainshare', 'Gainshare', ALL_RUN, 0),
      ];
      break;
  }
  return { ...project, pricing: { ...pricing, streams } };
}

export interface PackageResult {
  id: ConstructId;
  name: string;
  short: string;
  description: string;
  streams: RevenueStream[];
  priceBook: PriceBook;
  economics: Economics;
  years: YearSummary[];
  steady: Steady;
  issues: Issue[];
}

export function computePackages(ctx: ProjectionContext, marginal: MarginalCosts, hybrid?: { priceBook: PriceBook; projection: ReturnType<typeof runProjection> }): PackageResult[] {
  return CONSTRUCTS.map((c) => {
    if (c.id === 'hybrid' && hybrid) {
      return { ...c, streams: ctx.project.pricing.streams, priceBook: hybrid.priceBook, economics: hybrid.projection.economics, years: hybrid.projection.years, steady: hybrid.projection.steady, issues: hybrid.priceBook.issues };
    }
    const p = packageProject(ctx.project, c.id, ctx.baseline.totals.weightedAbus.toNumber());
    const book = buildPriceBook({ project: p, baseline: ctx.baseline, impl: ctx.impl, marginal });
    const proj = runProjection({ ...ctx, project: p }, book);
    return { ...c, streams: p.pricing.streams, priceBook: book, economics: proj.economics, years: proj.years, steady: proj.steady, issues: book.issues };
  });
}
