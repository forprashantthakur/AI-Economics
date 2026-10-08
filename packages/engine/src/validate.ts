/**
 * Input validation and double-count detection. Returns issues; never throws.
 */
import type { Catalog, Project } from './types';
import type { Issue } from './pricing';
import { ACU_RESOURCES } from './acu';

const near = (a: number, b: number, tol = 0.5) => Math.abs(a - b) <= tol;

export function validateProject(project: Project, catalog: Catalog): Issue[] {
  const issues: Issue[] = [];
  const add = (severity: Issue['severity'], code: string, message: string) => issues.push({ severity, code, message });
  const models = new Map(catalog.modelRates.map((m) => [m.id, m]));
  const agentIds = new Set(project.agents.map((a) => a.id));
  const wfIds = new Set(project.workflows.map((w) => w.id));
  const fx = catalog.fx;
  const currencies = new Set<string>([project.currency, project.acu.referenceCurrency]);

  if (!fx.rates[project.currency] && project.currency !== fx.base) add('error', 'FX_MISSING', `No FX rate for reporting currency ${project.currency}.`);
  if (!project.workflows.length) add('warning', 'NO_WORKFLOWS', 'The project has no workflows, so no transactions, ACUs or ABUs can be measured.');

  let usesSample = false;
  let usesSelfHosted = false;
  for (const wf of project.workflows) {
    const label = `Workflow "${wf.name}"`;
    if (wf.monthlyVolume < 0) add('error', 'NEGATIVE_VOLUME', `${label}: monthly volume cannot be negative.`);
    for (const [k, v] of [
      ['success rate', wf.successRatePct],
      ['acceptance rate', wf.acceptanceRatePct],
      ['human intervention rate', wf.humanInterventionRatePct],
    ] as const)
      if (v < 0 || v > 100) add('error', 'RATE_RANGE', `${label}: ${k} must be between 0 and 100%.`);
    if (wf.retryRatePct < 0) add('error', 'RATE_RANGE', `${label}: retry rate cannot be negative.`);
    if (wf.complexity.length) {
      const s = wf.complexity.reduce((a, c) => a + c.sharePct, 0);
      if (!near(s, 100)) add('warning', 'MIX_NOT_100', `${label}: complexity mix sums to ${s}% — shares are normalised to 100%.`);
      if (wf.complexity.some((c) => c.abuWeight < 0)) add('error', 'ABU_WEIGHT', `${label}: ABU weights cannot be negative.`);
    }
    if (!wf.abuDefinition?.trim()) add('warning', 'ABU_DEFINITION', `${label}: define what counts as one accepted ${wf.abuName || 'business unit'}.`);
    currencies.add(wf.humanReview.currency);
    for (const st of wf.llmSteps) {
      if (st.agentId && !agentIds.has(st.agentId)) add('warning', 'UNKNOWN_AGENT', `${label}: step "${st.name}" references an unknown agent.`);
      const rs = st.routing.reduce((a, r) => a + r.sharePct, 0);
      if (st.routing.length && !near(rs, 100)) add('warning', 'ROUTING_NOT_100', `${label}: routing for "${st.name}" sums to ${rs}% — normalised to 100%.`);
      if (st.cacheablePrefixTokens > st.inputTokens) add('info', 'PREFIX_GT_INPUT', `${label}: cacheable prefix of "${st.name}" exceeds its input tokens — capped at input.`);
      for (const r of st.routing) {
        const m = models.get(r.modelId);
        if (!m) {
          add('error', 'UNKNOWN_MODEL', `${label}: step "${st.name}" routes to "${r.modelId}", which is not in the model rate card.`);
          continue;
        }
        if (m.sample) usesSample = true;
        if (m.pricingBasis === 'self_hosted') usesSelfHosted = true;
        currencies.add(m.currency);
        const util = ((st.inputTokens + st.outputTokens + st.reasoningTokens) / (m.contextWindow || Infinity)) * 100;
        if (util > 90) add('warning', 'CONTEXT_WINDOW', `${label}: "${st.name}" uses ${util.toFixed(0)}% of ${m.model}'s context window.`);
      }
    }
  }
  if (usesSample) add('info', 'SAMPLE_RATES', 'One or more models use illustrative sample rates. Verify against current vendor price lists before quoting.');

  // Double-count detection across cost categories.
  const byComponent = new Map<string, Set<string>>();
  for (const l of project.costLines) {
    currencies.add(l.currency);
    if (l.workflowId && !wfIds.has(l.workflowId)) add('error', 'UNKNOWN_WORKFLOW', `Cost line "${l.name}" is assigned to a workflow that does not exist.`);
    if (l.unitCost < 0 || l.quantity < 0) add('error', 'NEGATIVE_COST', `Cost line "${l.name}" has a negative unit cost or quantity.`);
    const key = (l.componentKey || '').trim().toLowerCase();
    if (key) byComponent.set(key, new Set([...(byComponent.get(key) ?? []), `${l.category}:${l.name}`]));
    if ((/\b(tokens?|gpt|claude|gemini)\b/i.test(l.name) || /\bllm (api|usage|spend|consumption|cost)\b/i.test(l.name)) && l.category !== 'RAG')
      add('warning', 'LLM_IN_COST_LINE', `Cost line "${l.name}" looks like LLM token spend — LLM cost is already computed from the tokenomics model.`);
    if (l.acuResourceKey && ACU_RESOURCES[l.acuResourceKey]?.derived)
      add('warning', 'DERIVED_RESOURCE', `Cost line "${l.name}" maps to "${l.acuResourceKey}", which is derived from the workflow model — mapping ignored to avoid double counting.`);
    if (l.basis === 'allocated_shared' && ((l.allocationPct ?? 0) <= 0 || (l.allocationPct ?? 0) > 100))
      add('warning', 'ALLOCATION_PCT', `Shared cost "${l.name}" should allocate between 0 and 100% to this project.`);
  }
  for (const [key, names] of byComponent) {
    if (names.size > 1) {
      const cats = new Set([...names].map((n) => n.split(':')[0]));
      add(
        cats.size > 1 ? 'warning' : 'info',
        'DUPLICATE_COMPONENT',
        `Component "${key}" is costed ${names.size} times (${[...names].map((n) => n.split(':')[1]).join(', ')})${cats.size > 1 ? ' across different categories' : ''} — check it is not double counted.`,
      );
    }
  }
  if (usesSelfHosted && project.costLines.some((l) => l.componentKey === 'gpu' || l.acuResourceKey === 'gpu_hours'))
    add('warning', 'GPU_DOUBLE_COUNT', 'A self-hosted model already prices GPU time into its token rate, and a GPU cost line also exists — GPU capacity may be counted twice.');
  const providerReview = project.workflows.some((w) => w.humanReview.borneBy === 'provider' && w.humanReview.minutesPerAssistedTxn > 0);
  if (providerReview && project.costLines.some((l) => ['human_review', 'exception_handling'].includes(l.componentKey)))
    add('warning', 'REVIEW_DOUBLE_COUNT', 'Human review is costed from workflow review minutes and also as a separate cost line.');

  // ACU
  if (project.acu.method === 'weighted_resource') {
    const ws = catalog.acuWeightSets.find((w) => w.id === project.acu.weightSetId);
    if (!ws) add('error', 'ACU_WEIGHTS_MISSING', 'The selected ACU weight set does not exist.');
    else if (ws.status !== 'approved') add('warning', 'ACU_WEIGHTS_STATUS', `ACU weight set "${ws.name} v${ws.version}" is ${ws.status}, not approved.`);
  }
  if (project.acu.method === 'cost_normalized' && project.acu.referenceValue <= 0) add('error', 'ACU_REFERENCE', 'ACU reference value must be greater than zero.');
  if (project.acu.eligiblePools.includes('IMPLEMENTATION')) add('info', 'ACU_IMPL', 'Implementation cost is one-time and is excluded from ACU measurement.');

  // Implementation
  const roleIds = new Set(project.implementation.roles.map((r) => r.id));
  for (const a of project.implementation.activities) if (!roleIds.has(a.roleId)) add('warning', 'UNKNOWN_ROLE', `Activity "${a.name}" has no valid role/rate.`);
  for (const r of project.implementation.roles) currencies.add(r.currency);
  if (project.implementation.targetMarginPct >= 100) add('error', 'MARGIN_RANGE', 'Implementation target margin must be below 100%.');

  // Pricing
  for (const s of project.pricing.streams.filter((x) => x.enabled)) {
    if (s.targetMarginPct >= 100) add('error', 'MARGIN_RANGE', `"${s.label}": target margin must be below 100%.`);
    if (s.type === 'fixed_fee' && s.recovers.some((p) => p !== 'IMPLEMENTATION')) add('error', 'FIXED_FEE_RUN_POOLS', `"${s.label}" is a one-time fee and can only recover implementation cost.`);
  }
  const sub = project.pricing.subscription;
  const hasSub = project.pricing.streams.some((s) => s.enabled && s.type === 'subscription');
  if (hasSub && sub.includedUnit !== 'none' && !project.pricing.streams.some((s) => s.enabled && s.type === sub.includedUnit))
    add('info', 'SUB_NO_UNIT_STREAM', `The subscription includes ${sub.includedUnit.toUpperCase()}s but no ${sub.includedUnit.toUpperCase()} stream exists — overage is priced at marginal cost plus margin.`);
  if (project.pricing.streams.filter((s) => s.enabled && s.type === 'subscription').length > 1) add('error', 'MULTI_SUB', 'Only one subscription stream is supported per commercial model.');
  for (const t of ['acu', 'abu'] as const)
    if (project.pricing.streams.filter((s) => s.enabled && s.type === t).length > 1) add('error', 'MULTI_UNIT_STREAM', `Only one ${t.toUpperCase()} stream is supported per commercial model.`);

  // Value
  for (const b of project.value.benefits) {
    currencies.add(b.currency);
    if (b.category === 'capacity_conversion' && b.status === 'proposed')
      add('info', 'CAPACITY_UNVALIDATED', `"${b.name}" converts released hours to cash and is not yet finance-validated — excluded from validated ROI.`);
  }
  for (const wf of project.workflows)
    if (!project.value.productivity.some((p) => p.workflowId === wf.id)) add('info', 'NO_PRODUCTIVITY', `No productivity baseline for workflow "${wf.name}".`);
  for (const c of project.value.clientCosts) currencies.add(c.currency);

  for (const c of currencies) if (c && !fx.rates[c] && c !== fx.base) add('error', 'FX_MISSING', `No FX rate configured for ${c}.`);
  return issues;
}
