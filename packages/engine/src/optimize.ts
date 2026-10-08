/**
 * AI FinOps optimisation finder. Each candidate is evaluated by re-running the
 * deterministic cost model on a modified copy of the project — no heuristics
 * on the savings number itself.
 */
import { Decimal, ZERO } from './decimal';
import type { Catalog, ModelRate, Project } from './types';
import { buildSnapshot } from './model';
import { applyScenario } from './scenario';

export interface Optimization {
  id: string;
  title: string;
  detail: string;
  category: 'caching' | 'routing' | 'batch' | 'reliability' | 'prompt' | 'infrastructure';
  monthlySaving: Decimal;
  savingPct: Decimal;
  tradeOff: string;
}

const steadyCost = (p: Project, c: Catalog) => buildSnapshot(p, c, { rampFactor: 1, yearIndex: 0 }).totalRunCost;

export function findOptimizations(project: Project, catalog: Catalog): Optimization[] {
  const base = steadyCost(project, catalog);
  if (base.isZero()) return [];
  const out: Optimization[] = [];
  const consider = (o: Omit<Optimization, 'monthlySaving' | 'savingPct'>, modified: Project) => {
    const saving = base.minus(steadyCost(modified, catalog));
    if (saving.gt(base.times('0.001'))) out.push({ ...o, monthlySaving: saving, savingPct: saving.div(base).times(100) });
  };
  const models = new Map(catalog.modelRates.map((m) => [m.id, m]));

  // 1. Caching: lift steps with a cacheable prefix to at least 80% hit rate.
  {
    const p = structuredClone(project);
    let touched = 0;
    for (const wf of p.workflows)
      for (const st of wf.llmSteps)
        if (st.cacheablePrefixTokens > 0 && st.cacheHitRatePct < 80) {
          st.cacheHitRatePct = 80;
          touched++;
        }
    if (touched) consider({ id: 'cache', category: 'caching', title: 'Raise prompt-cache hit rate to 80%', detail: `${touched} step(s) have a stable prefix with a hit rate below 80%. Stabilise system prompts and tool schemas, and order context so the prefix is reused.`, tradeOff: 'Requires prompt restructuring; cache TTLs may need keep-alive traffic.' }, p);
  }

  // 2. Routing: move 30% of the most expensive step to the cheapest model of the same provider.
  {
    const snap = buildSnapshot(project, catalog, { rampFactor: 1, yearIndex: 0 });
    const byStep = new Map<string, { cost: Decimal; wf: string; step: string }>();
    for (const l of snap.llmLines) {
      const k = `${l.workflowId}|${l.stepId}`;
      byStep.set(k, { cost: (byStep.get(k)?.cost ?? ZERO).plus(l.cost), wf: l.workflowId, step: l.stepId });
    }
    const top = [...byStep.values()].sort((a, b) => b.cost.cmp(a.cost))[0];
    if (top) {
      const p = structuredClone(project);
      const wf = p.workflows.find((w) => w.id === top.wf)!;
      const st = wf.llmSteps.find((s) => s.id === top.step)!;
      const primary = models.get([...st.routing].sort((a, b) => b.sharePct - a.sharePct)[0]?.modelId ?? '');
      const cheaper = catalog.modelRates
        .filter((m) => primary && m.provider === primary.provider && m.id !== primary.id && m.pricingBasis === 'per_token')
        .sort((a: ModelRate, b: ModelRate) => a.inputPerM + a.outputPerM - (b.inputPerM + b.outputPerM))[0];
      if (primary && cheaper && cheaper.inputPerM + cheaper.outputPerM < primary.inputPerM + primary.outputPerM) {
        const total = st.routing.reduce((a, r) => a + r.sharePct, 0) || 100;
        st.routing = [...st.routing.map((r) => ({ ...r, sharePct: (r.sharePct / total) * 70 })), { modelId: cheaper.id, sharePct: 30 }];
        consider({ id: 'route', category: 'routing', title: `Route 30% of "${st.name}" to ${cheaper.model}`, detail: `"${st.name}" is the most expensive step in "${wf.name}". Route simpler requests to a cheaper model of the same provider using a complexity classifier.`, tradeOff: 'Validate quality on the routed share with the evaluation suite before switching.' }, p);
      }
    }
  }

  // 3. Batch: let non-interactive steps use batch pricing for half of their traffic.
  {
    const p = structuredClone(project);
    let touched = 0;
    for (const wf of p.workflows)
      for (const st of wf.llmSteps) {
        const batchable = st.routing.some((r) => (models.get(r.modelId)?.batchDiscountPct ?? 0) > 0);
        if (batchable && st.batchEligiblePct < 50 && !st.toolCall) {
          st.batchEligiblePct = 50;
          touched++;
        }
      }
    if (touched) consider({ id: 'batch', category: 'batch', title: 'Use batch APIs for non-interactive steps', detail: `${touched} non-tool step(s) could run asynchronously at batch rates for at least half of their traffic (e.g. overnight reconciliation, document enrichment).`, tradeOff: 'Batch results can take hours — only for work without a real-time SLA.' }, p);
  }

  // 4. Reliability: halve retries.
  if (project.workflows.some((w) => w.retryRatePct > 2)) {
    consider({ id: 'retry', category: 'reliability', title: 'Halve the retry rate', detail: 'Add schema-validated outputs, tool-call guards and better error handling so fewer executions need to be re-run.', tradeOff: 'Engineering effort in the agent framework; monitor first-pass success.' }, applyScenario(project, { retryMultiplier: 0.5 }));
  }

  // 5. Prompt optimisation: compress input context 15%.
  consider({ id: 'prompt', category: 'prompt', title: 'Compress prompts and retrieved context by 15%', detail: 'Trim instructions, deduplicate retrieved chunks and summarise long histories to cut input tokens.', tradeOff: 'Re-run evaluations to confirm accuracy is unchanged.' }, applyScenario(project, { inputTokenMultiplier: 0.85 }));

  // 6. Infrastructure right-sizing when fixed infrastructure is a large share.
  {
    const snap = buildSnapshot(project, catalog, { rampFactor: 1, yearIndex: 0 });
    const infra = snap.pools.INFRASTRUCTURE;
    if (infra.gt(base.times('0.15'))) consider({ id: 'infra', category: 'infrastructure', title: 'Right-size infrastructure by 15%', detail: `Infrastructure is ${infra.div(base).times(100).toFixed(0)}% of run cost. Autoscale, use reserved capacity and consolidate non-production environments.`, tradeOff: 'Validate peak-concurrency headroom against the availability SLA.' }, applyScenario(project, { infraMultiplier: 0.85 }));
  }

  return out.sort((a, b) => b.monthlySaving.cmp(a.monthlySaving));
}
