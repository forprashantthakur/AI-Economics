/**
 * Dashboard slicing: aggregates engine snapshots for a reporting period and
 * optionally narrows to one workflow (business process) or one agent.
 * Only allocates engine results — never recomputes costs — so slices reconcile.
 */
import { D, ZERO, sum, type CostPool, type Decimal, type ProjectResult, type RunSnapshot, RUN_POOLS } from '@aies/engine';

export type Period = 'steady' | 'y1' | 'y2' | 'y3' | 'term';

export const PERIOD_LABEL: Record<Period, string> = {
  steady: 'Steady-state month',
  y1: 'Year 1',
  y2: 'Year 2',
  y3: 'Year 3',
  term: 'Full term',
};

export interface Slice {
  label: string;
  snapshots: RunSnapshot[];
  attempted: Decimal;
  accepted: Decimal;
  weightedAbus: Decimal;
  acus: Decimal;
  pools: Record<CostPool, Decimal>;
  runCost: Decimal;
  llmCost: Decimal;
  llmByModel: Record<string, Decimal>;
  llmByAgent: Record<string, Decimal>;
  runByAgent: Record<string, Decimal>;
  runByWorkflow: Record<string, Decimal>;
  inputTokens: Decimal;
  outputTokens: Decimal;
  cacheReadTokens: Decimal;
  reasoningTokens: Decimal;
  llmCalls: Decimal;
  months: number;
}

const zeroPools = (): Record<CostPool, Decimal> => ({ IMPLEMENTATION: ZERO, LLM: ZERO, ORCHESTRATION: ZERO, RAG: ZERO, DOCUMENT: ZERO, INFRASTRUCTURE: ZERO, AGENTOPS: ZERO, HUMAN_REVIEW: ZERO, OTHER: ZERO });

export function snapshotsFor(r: ProjectResult, period: Period): RunSnapshot[] {
  if (period === 'steady') return [r.baseline];
  const bases = r.context.bases.filter((b) => b.snapshot);
  const y = period === 'y1' ? 0 : period === 'y2' ? 1 : period === 'y3' ? 2 : -1;
  return bases.filter((b) => y < 0 || b.yearIndex === y).map((b) => b.snapshot!);
}

export function monthsFor(r: ProjectResult, period: Period) {
  if (period === 'steady') return [];
  const y = period === 'y1' ? 0 : period === 'y2' ? 1 : period === 'y3' ? 2 : -1;
  return r.months.filter((m) => y < 0 || (m.month === 0 ? y === 0 : m.yearIndex === y));
}

/** Share of each workflow's cost attributable to an agent (by that agent's LLM cost share in the workflow). */
function agentShare(s: RunSnapshot, workflowId: string, agentId: string): Decimal {
  const lines = s.llmLines.filter((l) => l.workflowId === workflowId);
  const total = sum(lines.map((l) => l.cost));
  const steps = new Set(lines.map((l) => l.agentId || 'unassigned'));
  if (total.isZero()) return steps.has(agentId) ? D(1).div(steps.size || 1) : ZERO;
  return sum(lines.filter((l) => (l.agentId || 'unassigned') === agentId).map((l) => l.cost)).div(total);
}

export function buildSlice(r: ProjectResult, period: Period, workflowId?: string, agentId?: string): Slice {
  const snaps = snapshotsFor(r, period);
  const pools = zeroPools();
  const llmByModel: Record<string, Decimal> = {};
  const llmByAgent: Record<string, Decimal> = {};
  const runByAgent: Record<string, Decimal> = {};
  const runByWorkflow: Record<string, Decimal> = {};
  let attempted = ZERO,
    accepted = ZERO,
    weightedAbus = ZERO,
    acus = ZERO,
    inputTokens = ZERO,
    outputTokens = ZERO,
    cacheReadTokens = ZERO,
    reasoningTokens = ZERO,
    llmCalls = ZERO;
  const wfIds = r.project.workflows.map((w) => w.id).filter((id) => !workflowId || id === workflowId);
  const add = (m: Record<string, Decimal>, k: string, v: Decimal) => (m[k] = (m[k] ?? ZERO).plus(v));

  for (const s of snaps) {
    for (const w of wfIds) {
      const v = s.volumes[w];
      if (!v) continue;
      const share = agentId ? agentShare(s, w, agentId) : D(1);
      attempted = attempted.plus(v.attempted.times(share));
      accepted = accepted.plus(v.accepted.times(share));
      weightedAbus = weightedAbus.plus(v.weightedAbus.times(share));
      acus = acus.plus((s.acu.byWorkflow[w] ?? ZERO).times(share));
      for (const p of RUN_POOLS) pools[p] = pools[p].plus((s.poolsByWorkflow[w]?.[p] ?? ZERO).times(share));
      add(runByWorkflow, w, (s.runCostByWorkflow[w] ?? ZERO).times(share));
      const lines = s.llmLines.filter((l) => l.workflowId === w && (!agentId || (l.agentId || 'unassigned') === agentId));
      for (const l of lines) {
        add(llmByModel, l.modelId, l.cost);
        add(llmByAgent, l.agentId || 'unassigned', l.cost);
        inputTokens = inputTokens.plus(l.inputTokens);
        outputTokens = outputTokens.plus(l.outputTokens);
        cacheReadTokens = cacheReadTokens.plus(l.cacheReadTokens);
        reasoningTokens = reasoningTokens.plus(l.reasoningTokens);
        llmCalls = llmCalls.plus(l.calls);
      }
      // Fully loaded agent cost within this workflow.
      const agentsInWf = new Set(s.llmLines.filter((l) => l.workflowId === w).map((l) => l.agentId || 'unassigned'));
      for (const a of agentsInWf) if (!agentId || a === agentId) add(runByAgent, a, (s.runCostByWorkflow[w] ?? ZERO).times(agentShare(s, w, a)));
    }
  }
  const runCost = sum(RUN_POOLS.map((p) => pools[p]));
  const wfName = workflowId ? r.project.workflows.find((w) => w.id === workflowId)?.name : undefined;
  const agName = agentId ? r.project.agents.find((a) => a.id === agentId)?.name : undefined;
  return {
    label: [wfName, agName].filter(Boolean).join(' / ') || 'All workflows and agents',
    snapshots: snaps,
    attempted,
    accepted,
    weightedAbus,
    acus,
    pools,
    runCost,
    llmCost: pools.LLM,
    llmByModel,
    llmByAgent,
    runByAgent,
    runByWorkflow,
    inputTokens,
    outputTokens,
    cacheReadTokens,
    reasoningTokens,
    llmCalls,
    months: snaps.length,
  };
}

export function modelName(r: ProjectResult | { context: { catalog: { modelRates: { id: string; model: string }[] } } }, id: string): string {
  return r.context.catalog.modelRates.find((m) => m.id === id)?.model ?? id;
}

export function agentName(r: ProjectResult, id: string): string {
  return r.project.agents.find((a) => a.id === id)?.name ?? (id === 'unassigned' ? 'Unassigned' : id);
}

export function workflowName(r: ProjectResult, id: string): string {
  return r.project.workflows.find((w) => w.id === id)?.name ?? id;
}
