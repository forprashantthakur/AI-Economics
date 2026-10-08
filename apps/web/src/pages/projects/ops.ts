/**
 * Pure project operations used by the Projects list and Project detail pages:
 * duplicate, JSON import validation, and adding / duplicating / removing
 * workflows. All numbers that matter come from the engine builders
 * (createProjectFromIntake, buildCostLines, stepsFromSpecs); these helpers only
 * move objects around and keep references consistent.
 */
import {
  PROVIDER_TIER_MAP,
  buildCostLines,
  computeProject,
  createProjectFromIntake,
  uid,
  type Catalog,
  type CostLine,
  type ProcessTemplate,
  type Project,
  type Workflow,
} from '@aies/engine';

const now = () => new Date().toISOString();

/** Deep copy with a fresh project id; name "… (copy)", back to pre-sales, no actuals. */
export function duplicateProject(p: Project): Project {
  const copy = structuredClone(p);
  copy.id = uid('p');
  copy.name = `${p.name} (copy)`;
  copy.status = 'pre_sales';
  copy.actuals = [];
  copy.createdAt = now();
  copy.updatedAt = now();
  return copy;
}

// ───────────────────────────── Import ─────────────────────────────

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/**
 * Checks the basic shape of an imported project and that the engine can compute it.
 * Returns a list of problems (empty = OK) and a normalised project.
 */
export function validateImportedProject(raw: unknown, catalog: Catalog): { errors: string[]; project?: Project } {
  const errors: string[] = [];
  if (!isObj(raw)) return { errors: ['The file does not contain a project object. Export a project from the Projects page and import that file.'] };
  if (typeof raw.id !== 'string' || !raw.id.trim()) errors.push('Missing "id" (text).');
  if (typeof raw.name !== 'string' || !raw.name.trim()) errors.push('Missing "name" (text).');
  if (!Array.isArray(raw.workflows)) errors.push('Missing "workflows" (a list of workflows).');
  else
    raw.workflows.forEach((w, i) => {
      if (!isObj(w) || typeof w.id !== 'string') errors.push(`Workflow ${i + 1} has no "id".`);
      else if (!Array.isArray(w.llmSteps) || !Array.isArray(w.complexity) || !isObj(w.humanReview)) errors.push(`Workflow "${String(w.name ?? w.id)}" is missing llmSteps, complexity or humanReview.`);
    });
  if (!isObj(raw.pricing) || !Array.isArray((raw.pricing as Record<string, unknown>).streams)) errors.push('Missing "pricing" with a "streams" list.');
  if (!isObj(raw.value) || !Array.isArray((raw.value as Record<string, unknown>).benefits)) errors.push('Missing "value" with a "benefits" list.');
  for (const k of ['client', 'solution', 'implementation', 'acu'] as const) if (!isObj(raw[k])) errors.push(`Missing "${k}" section.`);
  if (errors.length) return { errors };

  const p = structuredClone(raw) as unknown as Project;
  p.agents ??= [];
  p.costLines ??= [];
  p.actuals ??= [];
  p.scenarios ??= [];
  p.status = (['pre_sales', 'in_delivery', 'live'] as const).includes(p.status) ? p.status : 'pre_sales';
  p.currency ||= 'INR';
  p.goLiveDate ||= new Date().toISOString().slice(0, 7);
  p.createdAt ||= now();
  p.updatedAt = now();
  p.owner ??= '';
  try {
    const r = computeProject(p, catalog, { packages: false });
    const fatal = r.issues.filter((i) => i.code === 'FX_MISSING');
    if (fatal.length) return { errors: fatal.map((i) => `${i.message} Add the currency under Settings, FX rates, then import again.`) };
  } catch (e) {
    return { errors: [`The project could not be computed: ${(e as Error).message}. Check the file is a complete project export.`] };
  }
  return { errors: [], project: p };
}

// ───────────────────────────── Workflows ─────────────────────────────

/** Map a stored provider label (e.g. "Anthropic (direct)") back to its PROVIDER_TIER_MAP key. */
export function providerKeyFor(labels: string[]): string {
  for (const l of labels) {
    const hit = Object.entries(PROVIDER_TIER_MAP).find(([k, v]) => v.label === l || k === l);
    if (hit) return hit[0];
  }
  return 'anthropic';
}

export interface AddWorkflowInput {
  templateId: string;
  name: string;
  monthlyVolume: number;
  provider: string;
  reuseAgents: boolean;
}

/**
 * Build a temporary project from the template with the engine's intake builder,
 * then transplant its workflow, agents, productivity baseline, KPIs and any
 * workflow-specific cost components this project does not cost yet — all with fresh ids.
 */
export function addWorkflowFromTemplate(draft: Project, input: AddWorkflowInput, catalog: Catalog, templates: ProcessTemplate[]): { workflowId: string; addedAgents: number; addedLines: number } {
  const tpl = templates.find((t) => t.id === input.templateId) ?? templates[0];
  const tmp = createProjectFromIntake(
    {
      projectName: 'tmp',
      client: { ...draft.client, businessFunction: tpl.businessFunction, businessProcess: tpl.process },
      currency: draft.currency,
      templateId: tpl.id,
      provider: input.provider,
      cloudPlatform: draft.solution.cloudPlatform,
      solutionType: draft.solution.solutionType,
      goLiveDate: draft.goLiveDate,
      monthlyVolume: input.monthlyVolume,
      peakConcurrency: draft.solution.peakConcurrency,
    },
    catalog,
    templates,
  );
  const src = tmp.workflows[0];
  const wfId = uid('wf');

  // Agents: reuse same-named agents when asked, otherwise add fresh ones.
  const agentMap: Record<string, string> = {};
  let addedAgents = 0;
  for (const a of tmp.agents) {
    const existing = input.reuseAgents ? draft.agents.find((x) => x.name.trim().toLowerCase() === a.name.trim().toLowerCase()) : undefined;
    if (existing) agentMap[a.id] = existing.id;
    else {
      const id = uid('ag');
      draft.agents.push({ id, name: a.name, role: a.role });
      agentMap[a.id] = id;
      addedAgents++;
    }
  }

  const wf: Workflow = {
    ...structuredClone(src),
    id: wfId,
    name: input.name.trim() || src.name,
    llmSteps: src.llmSteps.map((s, i) => ({ ...structuredClone(s), id: `${wfId}-s${i + 1}`, agentId: agentMap[s.agentId] ?? '' })),
  };
  draft.workflows.push(wf);

  for (const pr of tmp.value.productivity) draft.value.productivity.push({ ...pr, workflowId: wfId });
  for (const k of tmp.value.kpis) if (!draft.value.kpis.some((x) => x.name === k.name)) draft.value.kpis.push({ ...k, id: uid('k') });

  // Workflow-specific cost components (e.g. OCR for a document workflow) that the project does not cost yet.
  const have = new Set(draft.costLines.map((l) => l.componentKey.trim().toLowerCase()));
  const lines = buildCostLines(
    {
      workflowId: wfId,
      workflowSteps: wf.workflowSteps,
      toolCallsPerExecution: wf.toolCallsPerExecution,
      ragRequired: tpl.ragRequired,
      ragQueriesPerTxn: tpl.ragQueriesPerTxn,
      documentProcessing: tpl.documentProcessing,
      pagesPerTxn: tpl.pagesPerTxn,
      monthlyVolume: wf.monthlyVolume,
      agents: tmp.agents.length,
      peakConcurrency: draft.solution.peakConcurrency,
    },
    catalog,
    uid('c'),
  ).filter((l) => !have.has(l.componentKey.trim().toLowerCase()));
  draft.costLines.push(...lines);

  draft.solution.plannedWorkflows = Math.max(draft.solution.plannedWorkflows, draft.workflows.length);
  draft.solution.plannedAgents = Math.max(draft.solution.plannedAgents, draft.agents.length);
  return { workflowId: wfId, addedAgents, addedLines: lines.length };
}

/** Copy a workflow with fresh ids, plus its productivity baseline, workflow-specific cost lines and price override. */
export function duplicateWorkflow(draft: Project, workflowId: string): string | null {
  const src = draft.workflows.find((w) => w.id === workflowId);
  if (!src) return null;
  const id = uid('wf');
  const copy: Workflow = { ...structuredClone(src), id, name: `${src.name} (copy)`, llmSteps: src.llmSteps.map((s, i) => ({ ...structuredClone(s), id: `${id}-s${i + 1}` })) };
  draft.workflows.splice(draft.workflows.indexOf(src) + 1, 0, copy);
  const prod = draft.value.productivity.find((p) => p.workflowId === workflowId);
  if (prod) draft.value.productivity.push({ ...prod, workflowId: id });
  const lines: CostLine[] = draft.costLines.filter((l) => l.workflowId === workflowId).map((l) => ({ ...structuredClone(l), id: uid('c'), workflowId: id }));
  draft.costLines.push(...lines);
  const ov = draft.pricing.abuRateCard.priceOverrides?.[workflowId];
  if (ov !== undefined) draft.pricing.abuRateCard.priceOverrides[id] = ov;
  return id;
}

export function workflowDependents(p: Project, workflowId: string) {
  return {
    costLines: p.costLines.filter((l) => l.workflowId === workflowId).length,
    actuals: p.actuals.filter((a) => a.workflowId === workflowId).length,
  };
}

/** Remove a workflow and everything keyed to it (productivity, its own cost lines, price override, its actuals). */
export function removeWorkflow(draft: Project, workflowId: string) {
  draft.workflows = draft.workflows.filter((w) => w.id !== workflowId);
  draft.value.productivity = draft.value.productivity.filter((p) => p.workflowId !== workflowId);
  draft.costLines = draft.costLines.filter((l) => l.workflowId !== workflowId);
  draft.actuals = draft.actuals.filter((a) => a.workflowId !== workflowId);
  if (draft.pricing.abuRateCard.priceOverrides) delete draft.pricing.abuRateCard.priceOverrides[workflowId];
}

/** Steps whose agent no longer exists in the project. */
export function orphanSteps(p: Project) {
  const ids = new Set(p.agents.map((a) => a.id));
  return p.workflows.flatMap((w) => w.llmSteps.filter((s) => s.agentId && !ids.has(s.agentId)).map((s) => ({ workflow: w, step: s })));
}
