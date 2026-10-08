/**
 * Intake wizard form model: defaults, template defaults, per-step validation
 * and the builder that turns answers into a project with the engine's
 * createProjectFromIntake (plus the workload values IntakeInput does not take).
 */
import { buildCostLines, createProjectFromIntake, type Catalog, type IntakeInput, type ProcessTemplate, type Project, type SolutionType } from '@aies/engine';
import { isPeriod } from '../projects/common';

export interface WizardForm {
  // 1 — Client
  clientName: string;
  industry: string;
  geography: string;
  currency: string;
  businessFunction: string;
  engagementType: string;
  projectName: string;
  // 2 — Process template
  templateId: string;
  // 3 — AI solution
  solutionType: SolutionType;
  plannedAgents: number;
  plannedWorkflows: number;
  integrations: string[];
  provider: string;
  cloudPlatform: string;
  ragRequired: boolean;
  documentProcessing: boolean;
  humanInTheLoop: boolean;
  dataSources: string[];
  securityRequirements: string;
  availabilitySla: string;
  supportSla: string;
  // 4 — Workload
  monthlyVolume: number;
  workingDays: number;
  /** null = estimated by the engine from volume. */
  peakConcurrency: number | null;
  workflowSteps: number;
  toolCallsPerExecution: number;
  tokenMultiplier: number;
  retryRatePct: number;
  successRatePct: number;
  humanInterventionRatePct: number;
  annualGrowthPct: number;
  goLiveDate: string;
}

export type FormKey = keyof WizardForm;
export type Errors = Partial<Record<FormKey, string>>;

const addMonthsToNow = (m: number) => {
  const d = new Date();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + m);
  return d.toISOString().slice(0, 7);
};

export function defaultForm(currencies: string[]): WizardForm {
  return {
    clientName: '',
    industry: '',
    geography: 'India',
    currency: currencies.includes('INR') ? 'INR' : currencies[0] ?? 'USD',
    businessFunction: '',
    engagementType: 'Agent-as-a-Service (managed)',
    projectName: '',
    templateId: '',
    solutionType: 'multi_agent',
    plannedAgents: 4,
    plannedWorkflows: 1,
    integrations: [],
    provider: 'anthropic',
    cloudPlatform: 'AWS (ap-south-1)',
    ragRequired: false,
    documentProcessing: false,
    humanInTheLoop: true,
    dataSources: [],
    securityRequirements: 'SSO, data residency in India, PII masking before LLM calls, full audit trail',
    availabilitySla: '99.5% (business hours)',
    supportSla: 'P1 response 30 min, 24×7',
    monthlyVolume: 10000,
    workingDays: 22,
    peakConcurrency: null,
    workflowSteps: 10,
    toolCallsPerExecution: 5,
    tokenMultiplier: 1,
    retryRatePct: 5,
    successRatePct: 92,
    humanInterventionRatePct: 15,
    annualGrowthPct: 10,
    goLiveDate: addMonthsToNow(5),
  };
}

/** Values a template supplies; applied to every field the user has not edited yet. */
export function templateDefaults(t: ProcessTemplate): Partial<WizardForm> {
  return {
    monthlyVolume: t.monthlyVolume,
    integrations: [...t.integrations],
    ragRequired: t.ragRequired,
    documentProcessing: t.documentProcessing,
    humanInTheLoop: t.humanInterventionRatePct > 0,
    successRatePct: t.successRatePct,
    retryRatePct: t.retryRatePct,
    humanInterventionRatePct: t.humanInterventionRatePct,
    workflowSteps: t.workflowSteps,
    toolCallsPerExecution: t.toolCallsPerExecution,
    plannedAgents: t.agents.length,
  };
}

export const STEPS = [
  { id: 'client', label: 'Client' },
  { id: 'template', label: 'Process template' },
  { id: 'solution', label: 'AI solution' },
  { id: 'workload', label: 'Workload' },
  { id: 'review', label: 'Review & create' },
] as const;

const range = (e: Errors, k: FormKey, v: number, lo: number, hi: number, what: string) => {
  if (!Number.isFinite(v) || v < lo || v > hi) e[k] = `${what} must be between ${lo} and ${hi}.`;
};

export function validateStep(step: number, f: WizardForm, templates: ProcessTemplate[], currencies: string[]): Errors {
  const e: Errors = {};
  if (step === 0) {
    if (!f.clientName.trim()) e.clientName = 'Enter the client or account name.';
    if (!f.industry.trim()) e.industry = 'Choose an industry, or add one with "Add industry".';
    if (!currencies.includes(f.currency)) e.currency = 'Choose a currency that has an FX rate (add rates under Settings, FX rates).';
    if (!f.engagementType.trim()) e.engagementType = 'Choose an engagement type.';
    if (f.projectName.length > 120) e.projectName = 'Keep the project name under 120 characters.';
  }
  if (step === 1) {
    if (!f.templateId || !templates.some((t) => t.id === f.templateId)) e.templateId = 'Choose the process template closest to the client process. Use "Custom AI workflow" if none fits.';
  }
  if (step === 2) {
    range(e, 'plannedAgents', f.plannedAgents, 1, 50, 'Number of agents');
    range(e, 'plannedWorkflows', f.plannedWorkflows, 1, 50, 'Number of workflows');
    if (!f.provider) e.provider = 'Choose an LLM provider.';
    if (!f.cloudPlatform.trim()) e.cloudPlatform = 'Enter the cloud platform the solution runs on.';
    if (f.integrations.length > 30) e.integrations = 'List at most 30 integrations; group minor ones.';
  }
  if (step === 3) {
    if (!(f.monthlyVolume > 0)) e.monthlyVolume = 'Monthly transaction volume must be greater than zero.';
    range(e, 'workingDays', f.workingDays, 1, 31, 'Working days per month');
    if (f.peakConcurrency !== null) range(e, 'peakConcurrency', f.peakConcurrency, 1, 100000, 'Peak concurrency');
    range(e, 'workflowSteps', f.workflowSteps, 1, 500, 'Workflow steps');
    range(e, 'toolCallsPerExecution', f.toolCallsPerExecution, 0, 500, 'Tool calls per transaction');
    range(e, 'tokenMultiplier', f.tokenMultiplier, 0.05, 20, 'Token multiplier');
    range(e, 'retryRatePct', f.retryRatePct, 0, 100, 'Retry rate');
    if (!(f.successRatePct > 0) || f.successRatePct > 100) e.successRatePct = 'Task success rate must be above 0 and at most 100%.';
    range(e, 'humanInterventionRatePct', f.humanInterventionRatePct, 0, 100, 'Human intervention rate');
    range(e, 'annualGrowthPct', f.annualGrowthPct, -50, 300, 'Annual growth');
    if (!isPeriod(f.goLiveDate)) e.goLiveDate = 'Choose the go-live month.';
  }
  return e;
}

export function toIntake(f: WizardForm, tpl: ProcessTemplate, owner: string, id?: string): IntakeInput {
  return {
    id,
    projectName: f.projectName.trim(),
    client: {
      clientName: f.clientName.trim(),
      industry: f.industry,
      geography: f.geography.trim(),
      businessFunction: f.businessFunction || tpl.businessFunction,
      businessProcess: tpl.process,
      engagementType: f.engagementType,
    },
    currency: f.currency,
    templateId: tpl.id,
    provider: f.provider,
    cloudPlatform: f.cloudPlatform.trim(),
    solutionType: f.solutionType,
    goLiveDate: f.goLiveDate,
    monthlyVolume: f.monthlyVolume,
    annualGrowthPct: f.annualGrowthPct,
    plannedAgents: f.plannedAgents,
    plannedWorkflows: f.plannedWorkflows,
    integrations: f.integrations,
    dataSources: f.dataSources,
    ragRequired: f.ragRequired,
    documentProcessing: f.documentProcessing,
    humanInTheLoop: f.humanInTheLoop,
    successRatePct: f.successRatePct,
    retryRatePct: f.retryRatePct,
    humanInterventionRatePct: f.humanInterventionRatePct,
    tokenMultiplier: f.tokenMultiplier,
    peakConcurrency: f.peakConcurrency ?? undefined,
    securityRequirements: f.securityRequirements.trim(),
    availabilitySla: f.availabilitySla,
    supportSla: f.supportSla,
    owner,
  };
}

/**
 * Build the project with the engine, then apply the wizard values IntakeInput
 * does not cover (workflow steps, tool calls, working days) and re-size the
 * execution cost lines for them with the same engine builder and ids.
 */
export function buildProject(f: WizardForm, catalog: Catalog, templates: ProcessTemplate[], owner: string, id?: string): Project {
  const tpl = templates.find((t) => t.id === f.templateId) ?? templates[templates.length - 1];
  const p = createProjectFromIntake(toIntake(f, tpl, owner, id), catalog, templates);
  const wf = p.workflows[0];
  wf.workflowSteps = f.workflowSteps;
  wf.toolCallsPerExecution = f.toolCallsPerExecution;
  p.solution.workingDaysPerMonth = f.workingDays;
  p.costLines = buildCostLines(
    {
      workflowId: null,
      workflowSteps: f.workflowSteps,
      toolCallsPerExecution: f.toolCallsPerExecution,
      ragRequired: p.solution.ragRequired,
      ragQueriesPerTxn: tpl.ragQueriesPerTxn,
      documentProcessing: p.solution.documentProcessing,
      pagesPerTxn: tpl.pagesPerTxn,
      monthlyVolume: wf.monthlyVolume,
      agents: p.agents.length,
      peakConcurrency: p.solution.peakConcurrency,
    },
    catalog,
    `${p.id}-c`,
  );
  return p;
}
