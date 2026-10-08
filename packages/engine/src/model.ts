/**
 * Run-cost model (Modules 3, 4, 6 core).
 *
 * buildSnapshot() computes one month of steady operation for a given ramp
 * factor and contract year: transaction funnel, LLM consumption, non-LLM
 * execution costs, human review, cost pools, ACU resources and ACU counts.
 *
 * Every cost is produced exactly once (one LLM line per step × model route,
 * one cost-line result per configured line) and then *allocated* — never
 * re-computed — to workflows, agents and functions, so every breakdown
 * reconciles to the same total.
 */
import { D, Decimal, ONE, ZERO, compound, pct, safeDiv, sum, addTo } from './decimal';
import type {
  Catalog,
  CostCategory,
  CostLine,
  CostPool,
  ModelRate,
  Project,
  Workflow,
} from './types';
import { RUN_POOLS } from './types';
import { convert } from './fx';
import { callCost, contextUtilizationPct, effectiveRates, type EffectiveRates } from './llm';
import {
  ACU_RESOURCES,
  costNormalizedAcus,
  eligibleCostOf,
  emptyUsage,
  findWeightSet,
  weightedAcus,
  type ResourceUsage,
} from './acu';

export interface ClassVolume {
  classId: string;
  name: string;
  abuWeight: Decimal;
  accepted: Decimal;
  autonomous: Decimal;
  humanAssisted: Decimal;
  weightedAbus: Decimal;
}

export interface WorkflowVolumes {
  workflowId: string;
  attempted: Decimal;
  retries: Decimal;
  executions: Decimal;
  /** Full-execution equivalents of consumption (completed + partial failures + partial retries). */
  executionEquivalents: Decimal;
  completed: Decimal;
  failed: Decimal;
  accepted: Decimal;
  rejected: Decimal;
  humanAssisted: Decimal;
  autonomous: Decimal;
  weightedAbus: Decimal;
  consumptionMix: Decimal;
  humanEffortMix: Decimal;
  llmCalls: Decimal;
  toolCalls: Decimal;
  byClass: ClassVolume[];
}

export interface LlmLineResult {
  workflowId: string;
  stepId: string;
  stepName: string;
  agentId: string;
  modelId: string;
  toolCall: boolean;
  calls: Decimal;
  inputTokens: Decimal;
  uncachedInputTokens: Decimal;
  cacheReadTokens: Decimal;
  cacheWriteTokens: Decimal;
  outputTokens: Decimal;
  reasoningTokens: Decimal;
  costPerCall: Decimal;
  batchSaving: Decimal;
  cost: Decimal;
  contextUtilizationPct: Decimal;
}

export interface CostLineResult {
  lineId: string;
  name: string;
  category: CostCategory;
  componentKey: string;
  basis: CostLine['basis'];
  variable: boolean;
  unitCost: Decimal;
  units: Decimal;
  monthlyCost: Decimal;
  byWorkflow: Record<string, Decimal>;
  failureCost: Decimal;
}

export interface RunSnapshot {
  rampFactor: number;
  yearIndex: number;
  volumes: Record<string, WorkflowVolumes>;
  totals: {
    attempted: Decimal;
    executions: Decimal;
    accepted: Decimal;
    weightedAbus: Decimal;
    failed: Decimal;
    rejected: Decimal;
    humanAssisted: Decimal;
    autonomous: Decimal;
  };
  llmLines: LlmLineResult[];
  costLines: CostLineResult[];
  humanReviewByWorkflow: Record<string, Decimal>;
  humanReviewHoursByWorkflow: Record<string, Decimal>;
  /** Hours of client staff time spent on review when review is client-borne (non-cash, used by value model). */
  clientReviewHoursByWorkflow: Record<string, Decimal>;
  pools: Record<CostPool, Decimal>;
  /** Pools at base-year (reference) prices — used for cost-normalised ACU measurement. */
  poolsAtBasePrices: Record<CostPool, Decimal>;
  poolsByWorkflow: Record<string, Record<CostPool, Decimal>>;
  failureCostByWorkflow: Record<string, Decimal>;
  failureCostByPool: Record<CostPool, Decimal>;
  /** Cost of non-accepted work (failures, partial retries, rejected rework) by workflow and pool. */
  failureCostByWorkflowPool: Record<string, Record<CostPool, Decimal>>;
  totalRunCost: Decimal;
  runCostByWorkflow: Record<string, Decimal>;
  llm: {
    total: Decimal;
    byModel: Record<string, Decimal>;
    byAgent: Record<string, Decimal>;
    byWorkflow: Record<string, Decimal>;
    tokens: { input: Decimal; cacheRead: Decimal; cacheWrite: Decimal; output: Decimal; reasoning: Decimal; calls: Decimal };
    perAttempted: Decimal;
    perAccepted: Decimal;
  };
  runCostByAgent: Record<string, Decimal>;
  runCostByFunction: Record<string, Decimal>;
  resources: ResourceUsage;
  resourcesByWorkflow: Record<string, ResourceUsage>;
  acu: {
    method: Project['acu']['method'];
    methodA: Decimal;
    methodB: Decimal;
    total: Decimal;
    byWorkflow: Record<string, Decimal>;
    byAgent: Record<string, Decimal>;
    eligibleCost: Decimal;
    perAttempted: Decimal;
    perAcceptedAbu: Decimal;
  };
  warnings: string[];
}

export interface SnapshotParams {
  rampFactor: number;
  yearIndex: number;
}

export const SHARED_KEY = '_shared';

function emptyPools(): Record<CostPool, Decimal> {
  return { IMPLEMENTATION: ZERO, LLM: ZERO, ORCHESTRATION: ZERO, RAG: ZERO, DOCUMENT: ZERO, INFRASTRUCTURE: ZERO, AGENTOPS: ZERO, HUMAN_REVIEW: ZERO, OTHER: ZERO };
}

function normalizedShares(wf: Workflow): Decimal[] {
  const total = sum(wf.complexity.map((c) => D(c.sharePct)));
  if (wf.complexity.length === 0) return [];
  if (total.isZero()) return wf.complexity.map(() => ONE.div(wf.complexity.length));
  return wf.complexity.map((c) => D(c.sharePct).div(total));
}

/** Transaction funnel for one workflow. Retries are additional executions, never additional ABUs. */
export function workflowVolumes(wf: Workflow, volumeFactor: Decimal): WorkflowVolumes {
  const attempted = D(wf.monthlyVolume).times(volumeFactor);
  const s = pct(wf.successRatePct);
  const completed = attempted.times(s);
  const failed = attempted.minus(completed);
  const accepted = completed.times(pct(wf.acceptanceRatePct));
  const rejected = completed.minus(accepted);
  const humanAssisted = accepted.times(pct(wf.humanInterventionRatePct));
  const autonomous = accepted.minus(humanAssisted);
  const retries = attempted.times(pct(wf.retryRatePct));
  const executions = attempted.plus(retries);
  const executionEquivalents = completed
    .plus(failed.times(pct(wf.failedConsumptionPct)))
    .plus(retries.times(pct(wf.retryConsumptionPct)));

  const shares = normalizedShares(wf);
  const consumptionMix = wf.complexity.length ? sum(wf.complexity.map((c, i) => shares[i].times(D(c.consumptionMultiplier)))) : ONE;
  const humanEffortMix = wf.complexity.length ? sum(wf.complexity.map((c, i) => shares[i].times(D(c.humanEffortMultiplier)))) : ONE;
  const byClass: ClassVolume[] = wf.complexity.length
    ? wf.complexity.map((c, i) => {
        const acc = accepted.times(shares[i]);
        const ha = humanAssisted.times(shares[i]);
        return {
          classId: c.id,
          name: c.name,
          abuWeight: D(c.abuWeight),
          accepted: acc,
          humanAssisted: ha,
          autonomous: acc.minus(ha),
          weightedAbus: acc.times(D(c.abuWeight)),
        };
      })
    : [{ classId: 'standard', name: 'Standard', abuWeight: ONE, accepted, humanAssisted, autonomous, weightedAbus: accepted }];
  const weightedAbus = sum(byClass.map((c) => c.weightedAbus));
  const llmCalls = sum(wf.llmSteps.map((st) => D(st.callsPerExecution))).times(executionEquivalents);
  const toolCalls = executions.times(D(wf.toolCallsPerExecution));
  return {
    workflowId: wf.id,
    attempted,
    retries,
    executions,
    executionEquivalents,
    completed,
    failed,
    accepted,
    rejected,
    humanAssisted,
    autonomous,
    weightedAbus,
    consumptionMix,
    humanEffortMix,
    llmCalls,
    toolCalls,
    byClass,
  };
}

export function rampFactorFor(month: number, rampMonths: number, rampStartPct: number): number {
  if (month <= 0) return 0;
  if (!rampMonths || rampMonths <= 0 || month > rampMonths) return 1;
  const start = rampStartPct / 100;
  return start + (1 - start) * ((month - 1) / rampMonths);
}

export function yearIndexFor(month: number): number {
  return Math.max(0, Math.floor((month - 1) / 12));
}

export function buildSnapshot(project: Project, catalog: Catalog, params: SnapshotParams): RunSnapshot {
  const { rampFactor, yearIndex } = params;
  const cur = project.currency;
  const fx = catalog.fx;
  const warnings: string[] = [];
  const costInflation = compound(project.pricing.costInflationPct, yearIndex);
  const llmFactor = compound(project.pricing.llmPriceChangePct, yearIndex);
  const workflows = project.workflows;
  const wfIds = workflows.map((w) => w.id);
  const allocKeys = wfIds.length ? wfIds : [SHARED_KEY];

  // ── Funnel
  const volumes: Record<string, WorkflowVolumes> = {};
  for (const wf of workflows) {
    const factor = D(rampFactor).times(compound(wf.annualGrowthPct, yearIndex));
    volumes[wf.id] = workflowVolumes(wf, factor);
  }
  const vols = Object.values(volumes);
  const totals = {
    attempted: sum(vols.map((v) => v.attempted)),
    executions: sum(vols.map((v) => v.executions)),
    accepted: sum(vols.map((v) => v.accepted)),
    weightedAbus: sum(vols.map((v) => v.weightedAbus)),
    failed: sum(vols.map((v) => v.failed)),
    rejected: sum(vols.map((v) => v.rejected)),
    humanAssisted: sum(vols.map((v) => v.humanAssisted)),
    autonomous: sum(vols.map((v) => v.autonomous)),
  };

  // ── LLM consumption
  const models = new Map<string, ModelRate>(catalog.modelRates.map((m) => [m.id, m]));
  const rateCache = new Map<string, EffectiveRates>();
  const ratesFor = (id: string): EffectiveRates | undefined => {
    if (rateCache.has(id)) return rateCache.get(id);
    const m = models.get(id);
    if (!m) return undefined;
    const r = effectiveRates(m, cur, fx, llmFactor);
    rateCache.set(id, r);
    return r;
  };
  const llmLines: LlmLineResult[] = [];
  const resourcesByWorkflow: Record<string, ResourceUsage> = {};
  for (const wf of workflows) {
    const v = volumes[wf.id];
    const res = emptyUsage();
    for (const step of wf.llmSteps) {
      const routeTotal = sum(step.routing.map((r) => D(r.sharePct)));
      if (step.routing.length === 0) warnings.push(`Step "${step.name}" in "${wf.name}" has no model routing`);
      for (const route of step.routing) {
        const rates = ratesFor(route.modelId);
        if (!rates) {
          warnings.push(`Model "${route.modelId}" used by step "${step.name}" is not in the rate card`);
          continue;
        }
        const share = routeTotal.isZero() ? ZERO : D(route.sharePct).div(routeTotal);
        const calls = v.executionEquivalents.times(D(step.callsPerExecution)).times(share);
        const tokens = {
          inputTokens: D(step.inputTokens).times(v.consumptionMix),
          outputTokens: D(step.outputTokens).times(v.consumptionMix),
          reasoningTokens: D(step.reasoningTokens).times(v.consumptionMix),
          cacheablePrefixTokens: D(step.cacheablePrefixTokens),
          cacheHitRatePct: step.cacheHitRatePct,
          batchEligiblePct: step.batchEligiblePct,
        };
        const cc = callCost(tokens, rates);
        const line: LlmLineResult = {
          workflowId: wf.id,
          stepId: step.id,
          stepName: step.name,
          agentId: step.agentId,
          modelId: route.modelId,
          toolCall: step.toolCall,
          calls,
          inputTokens: D(tokens.inputTokens).times(calls),
          uncachedInputTokens: cc.uncachedInputTokens.times(calls),
          cacheReadTokens: cc.cacheReadTokens.times(calls),
          cacheWriteTokens: cc.cacheWriteTokens.times(calls),
          outputTokens: cc.outputTokens.times(calls),
          reasoningTokens: cc.reasoningTokens.times(calls),
          costPerCall: cc.total,
          batchSaving: cc.batchSaving.times(calls),
          cost: cc.total.times(calls),
          contextUtilizationPct: contextUtilizationPct(tokens, rates.contextWindow),
        };
        llmLines.push(line);
        res.input_tokens_m = res.input_tokens_m.plus(line.uncachedInputTokens).plus(line.cacheWriteTokens);
        res.cached_tokens_m = res.cached_tokens_m.plus(line.cacheReadTokens);
        res.output_tokens_m = res.output_tokens_m.plus(line.outputTokens);
        res.reasoning_tokens_m = res.reasoning_tokens_m.plus(line.reasoningTokens);
        res.llm_calls_k = res.llm_calls_k.plus(calls);
      }
    }
    res.workflow_executions_k = v.executions;
    res.tool_calls_k = v.toolCalls;
    resourcesByWorkflow[wf.id] = res;
  }

  const llmByWorkflow: Record<string, Decimal> = Object.fromEntries(wfIds.map((id) => [id, ZERO]));
  const llmByModel: Record<string, Decimal> = {};
  const llmByAgent: Record<string, Decimal> = {};
  const llmCallsByWorkflow: Record<string, Decimal> = Object.fromEntries(wfIds.map((id) => [id, ZERO]));
  for (const l of llmLines) {
    addTo(llmByWorkflow, l.workflowId, l.cost);
    addTo(llmByModel, l.modelId, l.cost);
    addTo(llmByAgent, l.agentId || 'unassigned', l.cost);
    addTo(llmCallsByWorkflow, l.workflowId, l.calls);
  }
  for (const id of wfIds) volumes[id].llmCalls = llmCallsByWorkflow[id];
  const llmTotal = sum(llmLines.map((l) => l.cost));

  // ── Human review & exceptions
  const humanReviewByWorkflow: Record<string, Decimal> = {};
  const humanReviewHoursByWorkflow: Record<string, Decimal> = {};
  const clientReviewHoursByWorkflow: Record<string, Decimal> = {};
  const reworkCostByWorkflow: Record<string, Decimal> = {};
  for (const wf of workflows) {
    const v = volumes[wf.id];
    const hr = wf.humanReview;
    const assistedHours = v.humanAssisted.times(D(hr.minutesPerAssistedTxn)).times(v.humanEffortMix).div(60);
    const reworkHours = v.rejected.times(D(hr.minutesPerRejectedTxn)).div(60);
    const rate = convert(hr.hourlyCost, hr.currency, cur, fx).times(costInflation);
    if (hr.borneBy === 'provider') {
      humanReviewByWorkflow[wf.id] = assistedHours.plus(reworkHours).times(rate);
      humanReviewHoursByWorkflow[wf.id] = assistedHours.plus(reworkHours);
      clientReviewHoursByWorkflow[wf.id] = ZERO;
      reworkCostByWorkflow[wf.id] = reworkHours.times(rate);
    } else {
      humanReviewByWorkflow[wf.id] = ZERO;
      humanReviewHoursByWorkflow[wf.id] = ZERO;
      clientReviewHoursByWorkflow[wf.id] = assistedHours.plus(reworkHours);
      reworkCostByWorkflow[wf.id] = ZERO;
    }
  }

  // ── Non-LLM execution cost lines
  const priceItems = new Map(catalog.cloudPrices.map((p) => [p.id, p]));
  const allocWeights = (method: CostLine['workflowAllocation']): Record<string, Decimal> => {
    if (!wfIds.length) return { [SHARED_KEY]: ONE };
    const w: Record<string, Decimal> = {};
    for (const id of wfIds) {
      const v = volumes[id];
      w[id] =
        method === 'by_attempted' ? v.attempted : method === 'by_executions' ? v.executions : method === 'by_llm_cost' ? llmByWorkflow[id] : ONE;
    }
    const tot = sum(Object.values(w));
    if (tot.isZero()) return Object.fromEntries(wfIds.map((id) => [id, ONE.div(wfIds.length)]));
    return Object.fromEntries(wfIds.map((id) => [id, w[id].div(tot)]));
  };

  const costLines: CostLineResult[] = project.costLines.map((line) => {
    const item = line.priceRef ? priceItems.get(line.priceRef) : undefined;
    if (line.priceRef && !item) warnings.push(`Cost line "${line.name}" references unknown price item "${line.priceRef}"`);
    const unitCost = convert(item ? item.unitCost : line.unitCost, item ? item.currency : line.currency, cur, fx).times(costInflation);
    const byWorkflow: Record<string, Decimal> = Object.fromEntries(allocKeys.map((k) => [k, ZERO]));
    const unitsByWorkflow: Record<string, Decimal> = {};
    let units = ZERO;
    let monthlyCost = ZERO;
    let failureCost = ZERO;
    const targets = line.workflowId ? wfIds.filter((id) => id === line.workflowId) : wfIds;
    if (line.workflowId && !targets.length) warnings.push(`Cost line "${line.name}" is assigned to unknown workflow`);
    const variable = !['fixed_monthly', 'allocated_shared'].includes(line.basis);

    if (!variable) {
      if (line.basis === 'fixed_monthly') {
        units = D(line.quantity);
        monthlyCost = units.times(unitCost);
      } else {
        const sharedCur = convert(line.sharedTotalMonthly ?? 0, line.currency, cur, fx).times(costInflation);
        units = pct(line.allocationPct ?? 0);
        monthlyCost = sharedCur.times(units);
      }
      if (line.workflowId && targets.length) byWorkflow[line.workflowId] = monthlyCost;
      else {
        const w = allocWeights(line.workflowAllocation);
        for (const k of Object.keys(w)) byWorkflow[k] = monthlyCost.times(w[k]);
      }
      for (const k of Object.keys(byWorkflow)) unitsByWorkflow[k] = monthlyCost.isZero() ? ZERO : units.times(safeDiv(byWorkflow[k], monthlyCost));
    } else {
      for (const id of targets) {
        const v = volumes[id];
        const cm = line.scalesWithComplexity ? v.consumptionMix : ONE;
        let driver: Decimal;
        let wasteFraction: Decimal;
        switch (line.basis) {
          case 'per_execution':
            driver = v.executions;
            wasteFraction = ONE.minus(safeDiv(v.accepted, v.executions));
            break;
          case 'per_attempted':
            driver = v.attempted;
            wasteFraction = ONE.minus(safeDiv(v.accepted, v.attempted));
            break;
          case 'per_accepted':
            driver = v.accepted;
            wasteFraction = ZERO;
            break;
          case 'per_llm_call':
          default:
            driver = v.llmCalls;
            wasteFraction = ONE.minus(safeDiv(v.accepted, v.executionEquivalents));
        }
        if (driver.isZero()) wasteFraction = ZERO;
        const u = driver.times(D(line.quantity)).times(cm);
        const c = u.times(unitCost);
        unitsByWorkflow[id] = u;
        byWorkflow[id] = c;
        units = units.plus(u);
        monthlyCost = monthlyCost.plus(c);
        failureCost = failureCost.plus(c.times(wasteFraction));
      }
    }

    // ACU resources contributed by this line (derived keys are ignored to prevent double counting).
    const key = line.acuResourceKey ?? item?.acuResourceKey ?? null;
    if (key && !ACU_RESOURCES[key]?.derived) {
      const per = D(line.acuUnitsPerUnit ?? item?.acuUnitsPerUnit ?? 1);
      for (const id of wfIds) {
        const u = unitsByWorkflow[id] ?? ZERO;
        resourcesByWorkflow[id][key] = resourcesByWorkflow[id][key].plus(u.times(per));
      }
    } else if (key && ACU_RESOURCES[key]?.derived) {
      warnings.push(`Cost line "${line.name}" maps to derived ACU resource "${key}" — ignored to avoid double counting`);
    }

    return {
      lineId: line.id,
      name: line.name,
      category: line.category,
      componentKey: line.componentKey,
      basis: line.basis,
      variable,
      unitCost,
      units,
      monthlyCost,
      byWorkflow,
      failureCost,
    };
  });

  // ── Pools
  const pools = emptyPools();
  const poolsAtBasePrices = emptyPools();
  const poolsByWorkflow: Record<string, Record<CostPool, Decimal>> = Object.fromEntries(allocKeys.map((k) => [k, emptyPools()]));
  const failureCostByWorkflowPool: Record<string, Record<CostPool, Decimal>> = Object.fromEntries(allocKeys.map((k) => [k, emptyPools()]));

  pools.LLM = llmTotal;
  poolsAtBasePrices.LLM = safeDiv(llmTotal, llmFactor);
  for (const id of wfIds) {
    poolsByWorkflow[id].LLM = llmByWorkflow[id];
    const v = volumes[id];
    const llmWaste = v.executionEquivalents.isZero() ? ZERO : llmByWorkflow[id].times(ONE.minus(v.accepted.div(v.executionEquivalents)));
    failureCostByWorkflowPool[id].LLM = llmWaste;
  }
  for (const id of wfIds) {
    const hr = humanReviewByWorkflow[id] ?? ZERO;
    pools.HUMAN_REVIEW = pools.HUMAN_REVIEW.plus(hr);
    poolsByWorkflow[id].HUMAN_REVIEW = hr;
    const rw = reworkCostByWorkflow[id] ?? ZERO;
    failureCostByWorkflowPool[id].HUMAN_REVIEW = rw;
  }
  poolsAtBasePrices.HUMAN_REVIEW = safeDiv(pools.HUMAN_REVIEW, costInflation);
  for (const cl of costLines) {
    const p = cl.category as CostPool;
    pools[p] = pools[p].plus(cl.monthlyCost);
    poolsAtBasePrices[p] = poolsAtBasePrices[p].plus(safeDiv(cl.monthlyCost, costInflation));
    for (const k of Object.keys(cl.byWorkflow)) poolsByWorkflow[k][p] = poolsByWorkflow[k][p].plus(cl.byWorkflow[k]);
    if (cl.variable) {
      for (const k of Object.keys(cl.byWorkflow)) {
        const v = volumes[k];
        if (!v) continue;
        const waste =
          cl.basis === 'per_execution' ? ONE.minus(safeDiv(v.accepted, v.executions))
          : cl.basis === 'per_attempted' ? ONE.minus(safeDiv(v.accepted, v.attempted))
          : cl.basis === 'per_llm_call' ? ONE.minus(safeDiv(v.accepted, v.executionEquivalents))
          : ZERO;
        const share = cl.byWorkflow[k].isZero() ? ZERO : cl.byWorkflow[k].times(waste);
        failureCostByWorkflowPool[k][p] = failureCostByWorkflowPool[k][p].plus(share);
      }
    }
  }
  const failureCostByWorkflow: Record<string, Decimal> = Object.fromEntries(allocKeys.map((k) => [k, sum(RUN_POOLS.map((p) => failureCostByWorkflowPool[k][p]))]));
  const failureCostByPool = emptyPools();
  for (const k of allocKeys) for (const p of RUN_POOLS) failureCostByPool[p] = failureCostByPool[p].plus(failureCostByWorkflowPool[k][p]);
  const totalRunCost = sum(RUN_POOLS.map((p) => pools[p]));
  const runCostByWorkflow: Record<string, Decimal> = Object.fromEntries(allocKeys.map((k) => [k, sum(RUN_POOLS.map((p) => poolsByWorkflow[k][p]))]));

  // ── Agent & function allocation (fully loaded, by LLM cost share within each workflow)
  const agentShareByWorkflow: Record<string, Record<string, Decimal>> = {};
  for (const wf of workflows) {
    const shares: Record<string, Decimal> = {};
    const wfLlm = llmByWorkflow[wf.id];
    const agentsInWf = [...new Set(wf.llmSteps.map((s) => s.agentId || 'unassigned'))];
    if (wfLlm.isZero()) {
      for (const a of agentsInWf) shares[a] = ONE.div(agentsInWf.length || 1);
      if (!agentsInWf.length) shares.unassigned = ONE;
    } else {
      for (const l of llmLines.filter((x) => x.workflowId === wf.id)) addTo(shares, l.agentId || 'unassigned', l.cost.div(wfLlm));
    }
    agentShareByWorkflow[wf.id] = shares;
  }
  const runCostByAgent: Record<string, Decimal> = {};
  const runCostByFunction: Record<string, Decimal> = {};
  for (const wf of workflows) {
    for (const [a, s] of Object.entries(agentShareByWorkflow[wf.id])) addTo(runCostByAgent, a, runCostByWorkflow[wf.id].times(s));
    addTo(runCostByFunction, wf.businessFunction || 'Unspecified', runCostByWorkflow[wf.id]);
  }
  if (!wfIds.length) {
    runCostByAgent.unassigned = runCostByWorkflow[SHARED_KEY];
    runCostByFunction.Unspecified = runCostByWorkflow[SHARED_KEY];
  }

  // ── Resources & ACUs
  const resources = emptyUsage();
  for (const id of wfIds) for (const k of Object.keys(resources) as (keyof ResourceUsage)[]) resources[k] = resources[k].plus(resourcesByWorkflow[id][k]);
  const weightSet = findWeightSet(catalog, project.acu.weightSetId);
  if (project.acu.method === 'weighted_resource' && !weightSet) warnings.push(`ACU weight set "${project.acu.weightSetId}" not found`);

  // Method A at base-year reference prices so ACU counts track consumption, not supplier price movements.
  const eligibleBase = eligibleCostOf(poolsAtBasePrices, project.acu);
  const eligibleNominal = eligibleCostOf(pools, project.acu);
  const methodA = costNormalizedAcus(eligibleBase, project.acu, cur, fx);
  const methodB = weightedAcus(resources, weightSet);
  const selectedTotal = project.acu.method === 'cost_normalized' ? methodA : methodB;

  const acuByWorkflow: Record<string, Decimal> = {};
  for (const id of wfIds) {
    if (project.acu.method === 'cost_normalized') {
      const wfBase: Partial<Record<CostPool, Decimal>> = {};
      for (const p of RUN_POOLS) {
        const f = p === 'LLM' ? llmFactor : costInflation;
        wfBase[p] = safeDiv(poolsByWorkflow[id][p], f);
      }
      acuByWorkflow[id] = costNormalizedAcus(eligibleCostOf(wfBase, project.acu), project.acu, cur, fx);
    } else {
      acuByWorkflow[id] = weightedAcus(resourcesByWorkflow[id], weightSet);
    }
  }
  const acuByAgent: Record<string, Decimal> = {};
  for (const wf of workflows) for (const [a, s] of Object.entries(agentShareByWorkflow[wf.id])) addTo(acuByAgent, a, acuByWorkflow[wf.id].times(s));

  return {
    rampFactor,
    yearIndex,
    volumes,
    totals,
    llmLines,
    costLines,
    humanReviewByWorkflow,
    humanReviewHoursByWorkflow,
    clientReviewHoursByWorkflow,
    pools,
    poolsAtBasePrices,
    poolsByWorkflow,
    failureCostByWorkflow,
    failureCostByPool,
    failureCostByWorkflowPool,
    totalRunCost,
    runCostByWorkflow,
    llm: {
      total: llmTotal,
      byModel: llmByModel,
      byAgent: llmByAgent,
      byWorkflow: llmByWorkflow,
      tokens: {
        input: sum(llmLines.map((l) => l.inputTokens)),
        cacheRead: sum(llmLines.map((l) => l.cacheReadTokens)),
        cacheWrite: sum(llmLines.map((l) => l.cacheWriteTokens)),
        output: sum(llmLines.map((l) => l.outputTokens)),
        reasoning: sum(llmLines.map((l) => l.reasoningTokens)),
        calls: sum(llmLines.map((l) => l.calls)),
      },
      perAttempted: safeDiv(llmTotal, totals.attempted),
      perAccepted: safeDiv(llmTotal, totals.accepted),
    },
    runCostByAgent,
    runCostByFunction,
    resources,
    resourcesByWorkflow,
    acu: {
      method: project.acu.method,
      methodA,
      methodB,
      total: selectedTotal,
      byWorkflow: acuByWorkflow,
      byAgent: acuByAgent,
      eligibleCost: eligibleNominal,
      perAttempted: safeDiv(selectedTotal, totals.attempted),
      perAcceptedAbu: safeDiv(selectedTotal, totals.weightedAbus),
    },
    warnings: [...new Set(warnings)],
  };
}
