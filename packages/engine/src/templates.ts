/**
 * Module 1 — process templates and the intake builder.
 *
 * Templates are editable starting points (volumes, funnel rates, LLM steps,
 * complexity mix, productivity baseline). createProjectFromIntake() turns the
 * intake wizard answers + a template into a complete, computable project:
 * workflow, agents, implementation plan, cost lines, ACU/pricing defaults and
 * value model. Every generated number is an assumption to be reviewed.
 */
import type {
  Activity,
  Agent,
  ClientInfo,
  ComplexityClass,
  CostLine,
  ImplementationPlan,
  LlmStep,
  Project,
  Role,
  SolutionType,
  Workflow,
  Catalog,
} from './types';
import { RUN_POOLS } from './types';
import { PROVIDER_TIER_MAP } from './catalog';
import { convert } from './fx';

export type Archetype = 'document' | 'conversational' | 'analytical' | 'generative';
export type Tier = 'frontier' | 'balanced' | 'fast';

export interface StepSpec {
  name: string;
  agent: string;
  tier: Tier;
  calls: number;
  input: number;
  output: number;
  reasoning?: number;
  prefix?: number;
  cacheHit?: number;
  tool?: boolean;
  batch?: number;
}

export interface TemplateAgent {
  key: string;
  name: string;
  role: string;
}

export interface ProcessTemplate {
  id: string;
  businessFunction: string;
  process: string;
  name: string;
  description: string;
  archetype: Archetype;
  abuName: string;
  abuDefinition: string;
  acceptanceCriteria: string[];
  monthlyVolume: number;
  successRatePct: number;
  acceptanceRatePct: number;
  retryRatePct: number;
  humanInterventionRatePct: number;
  workflowSteps: number;
  toolCallsPerExecution: number;
  manualMinutesBefore: number;
  spotCheckMinutes: number;
  reviewMinutes: number;
  hourlyCostInr: number;
  ragRequired: boolean;
  documentProcessing: boolean;
  pagesPerTxn: number;
  ragQueriesPerTxn: number;
  integrations: string[];
  tokenScale: number;
  agents: TemplateAgent[];
  steps: StepSpec[];
  complexity: Omit<ComplexityClass, 'priceOverride'>[];
  kpis: { name: string; unit: string; before: number; after: number; higherIsBetter: boolean }[];
  builtIn: boolean;
}

const ARCHETYPES: Record<Archetype, { agents: TemplateAgent[]; steps: StepSpec[] }> = {
  document: {
    agents: [
      { key: 'intake', name: 'Intake & classification agent', role: 'Receives documents, classifies type and routes' },
      { key: 'extract', name: 'Extraction agent', role: 'Extracts structured fields with confidence scores' },
      { key: 'validate', name: 'Validation & matching agent', role: 'Validates against master data and business rules' },
      { key: 'action', name: 'System update agent', role: 'Posts to the system of record and notifies' },
      { key: 'exception', name: 'Exception reasoning agent', role: 'Investigates mismatches and prepares exception packages' },
    ],
    steps: [
      { name: 'Classify document', agent: 'intake', tier: 'fast', calls: 1, input: 1500, output: 150, prefix: 800, cacheHit: 60 },
      { name: 'Extract fields', agent: 'extract', tier: 'balanced', calls: 1, input: 6000, output: 800, prefix: 2000, cacheHit: 70 },
      { name: 'Validate & match', agent: 'validate', tier: 'balanced', calls: 2, input: 3000, output: 400, prefix: 1500, cacheHit: 60, tool: true },
      { name: 'Exception reasoning', agent: 'exception', tier: 'frontier', calls: 0.15, input: 8000, output: 1200, reasoning: 2000 },
      { name: 'Update system & summarise', agent: 'action', tier: 'fast', calls: 1, input: 1000, output: 200, tool: true },
    ],
  },
  conversational: {
    agents: [
      { key: 'router', name: 'Intent & routing agent', role: 'Classifies intent, language and urgency' },
      { key: 'resolver', name: 'Resolution agent (RAG)', role: 'Answers from the knowledge base with citations' },
      { key: 'action', name: 'Action agent', role: 'Executes transactions through enterprise tools' },
      { key: 'qa', name: 'Quality & sentiment agent', role: 'Scores quality, sentiment and escalation need' },
    ],
    steps: [
      { name: 'Intent classification', agent: 'router', tier: 'fast', calls: 1, input: 1200, output: 80, prefix: 900, cacheHit: 70 },
      { name: 'Retrieve & answer', agent: 'resolver', tier: 'balanced', calls: 2.5, input: 5000, output: 450, prefix: 2500, cacheHit: 65 },
      { name: 'Tool actions', agent: 'action', tier: 'balanced', calls: 1.2, input: 2500, output: 250, prefix: 1200, cacheHit: 60, tool: true },
      { name: 'Quality & sentiment check', agent: 'qa', tier: 'fast', calls: 1, input: 2000, output: 120, prefix: 600, cacheHit: 70, batch: 50 },
    ],
  },
  analytical: {
    agents: [
      { key: 'data', name: 'Data gathering agent', role: 'Pulls and normalises data from source systems' },
      { key: 'analyst', name: 'Analysis agent', role: 'Matches, analyses and explains variances' },
      { key: 'reviewer', name: 'Controls review agent', role: 'Applies controls and flags risks' },
      { key: 'reporter', name: 'Reporting agent', role: 'Writes the summary and evidence pack' },
    ],
    steps: [
      { name: 'Gather & normalise data', agent: 'data', tier: 'fast', calls: 3, input: 3000, output: 400, prefix: 1000, cacheHit: 60, tool: true },
      { name: 'Analyse & match', agent: 'analyst', tier: 'balanced', calls: 2, input: 8000, output: 900, prefix: 2500, cacheHit: 60 },
      { name: 'Controls review', agent: 'reviewer', tier: 'frontier', calls: 0.3, input: 10000, output: 1500, reasoning: 3000 },
      { name: 'Write summary', agent: 'reporter', tier: 'balanced', calls: 1, input: 4000, output: 800, batch: 30 },
    ],
  },
  generative: {
    agents: [
      { key: 'planner', name: 'Planning agent', role: 'Analyses requirements and plans the response' },
      { key: 'retriever', name: 'Knowledge retrieval agent', role: 'Retrieves approved content and evidence' },
      { key: 'writer', name: 'Drafting agent', role: 'Drafts sections in the house style' },
      { key: 'reviewer', name: 'Compliance review agent', role: 'Checks compliance, accuracy and completeness' },
    ],
    steps: [
      { name: 'Requirement analysis', agent: 'planner', tier: 'balanced', calls: 1, input: 30000, output: 4000, prefix: 3000, cacheHit: 50 },
      { name: 'Section planning', agent: 'planner', tier: 'balanced', calls: 1, input: 8000, output: 2000 },
      { name: 'Retrieve evidence', agent: 'retriever', tier: 'fast', calls: 10, input: 3000, output: 300, prefix: 1000, cacheHit: 70, tool: true },
      { name: 'Draft sections', agent: 'writer', tier: 'balanced', calls: 40, input: 12000, output: 1500, prefix: 6000, cacheHit: 75 },
      { name: 'Compliance review', agent: 'reviewer', tier: 'frontier', calls: 5, input: 20000, output: 2000, reasoning: 4000, prefix: 4000, cacheHit: 50 },
      { name: 'Assemble document', agent: 'writer', tier: 'fast', calls: 3, input: 10000, output: 3000, tool: true },
    ],
  },
};

const MIX_STANDARD: ProcessTemplate['complexity'] = [
  { id: 'simple', name: 'Simple', sharePct: 60, abuWeight: 1, consumptionMultiplier: 0.8, humanEffortMultiplier: 0.7 },
  { id: 'medium', name: 'Medium', sharePct: 30, abuWeight: 1.5, consumptionMultiplier: 1.2, humanEffortMultiplier: 1.2 },
  { id: 'complex', name: 'Complex', sharePct: 10, abuWeight: 3, consumptionMultiplier: 2, humanEffortMultiplier: 2 },
];

type TemplateSeed = Partial<ProcessTemplate> & Pick<ProcessTemplate, 'id' | 'businessFunction' | 'process' | 'archetype' | 'abuName' | 'abuDefinition' | 'monthlyVolume' | 'manualMinutesBefore' | 'hourlyCostInr'>;

function t(seed: TemplateSeed): ProcessTemplate {
  const a = ARCHETYPES[seed.archetype];
  const defaultsByArchetype: Record<Archetype, Partial<ProcessTemplate>> = {
    document: { successRatePct: 94, acceptanceRatePct: 97, retryRatePct: 8, humanInterventionRatePct: 12, workflowSteps: 12, toolCallsPerExecution: 6, documentProcessing: true, ragRequired: false, pagesPerTxn: 2, ragQueriesPerTxn: 0, reviewMinutes: 6, spotCheckMinutes: 0.5 },
    conversational: { successRatePct: 88, acceptanceRatePct: 95, retryRatePct: 5, humanInterventionRatePct: 15, workflowSteps: 8, toolCallsPerExecution: 3, documentProcessing: false, ragRequired: true, pagesPerTxn: 0, ragQueriesPerTxn: 3, reviewMinutes: 5, spotCheckMinutes: 0.3 },
    analytical: { successRatePct: 92, acceptanceRatePct: 96, retryRatePct: 6, humanInterventionRatePct: 18, workflowSteps: 15, toolCallsPerExecution: 8, documentProcessing: false, ragRequired: false, pagesPerTxn: 0, ragQueriesPerTxn: 1, reviewMinutes: 10, spotCheckMinutes: 2 },
    generative: { successRatePct: 90, acceptanceRatePct: 92, retryRatePct: 10, humanInterventionRatePct: 100, workflowSteps: 25, toolCallsPerExecution: 15, documentProcessing: true, ragRequired: true, pagesPerTxn: 30, ragQueriesPerTxn: 60, reviewMinutes: 180, spotCheckMinutes: 30 },
  };
  return {
    name: seed.process,
    description: '',
    acceptanceCriteria: [],
    integrations: ['ERP', 'Identity provider'],
    tokenScale: 1,
    agents: a.agents,
    steps: a.steps,
    complexity: MIX_STANDARD,
    kpis: [],
    builtIn: true,
    ...defaultsByArchetype[seed.archetype],
    ...seed,
  } as ProcessTemplate;
}

export const PROCESS_TEMPLATES: ProcessTemplate[] = [
  // Finance
  t({
    id: 'fin-ap', businessFunction: 'Finance', process: 'Accounts Payable', archetype: 'document', abuName: 'invoice',
    abuDefinition: 'One supplier invoice extracted, validated (2/3-way match) and posted to the ERP, or routed with a complete exception package.',
    acceptanceCriteria: ['All mandatory header and line fields captured', 'PO / GRN match within tolerance or exception raised', 'Posted to ERP without manual correction', 'Duplicate check passed'],
    monthlyVolume: 50000, manualMinutesBefore: 15, hourlyCostInr: 450, pagesPerTxn: 2.5, integrations: ['SAP S/4HANA', 'Supplier portal', 'Email intake'],
    kpis: [{ name: 'Invoice cycle time', unit: 'days', before: 9, after: 2, higherIsBetter: false }, { name: 'First-pass match rate', unit: '%', before: 62, after: 88, higherIsBetter: true }],
  }),
  t({ id: 'fin-ar', businessFunction: 'Finance', process: 'Accounts Receivable', archetype: 'document', abuName: 'remittance', abuDefinition: 'One customer remittance matched and cash applied to open items.', acceptanceCriteria: ['Cash applied to correct open items', 'Unapplied cash below tolerance'], monthlyVolume: 30000, manualMinutesBefore: 8, hourlyCostInr: 450, pagesPerTxn: 1.5 }),
  t({ id: 'fin-recon', businessFunction: 'Finance', process: 'Financial Reconciliation', archetype: 'analytical', abuName: 'reconciled account', abuDefinition: 'One balance-sheet account reconciled with variances explained and evidence attached.', acceptanceCriteria: ['Unexplained variance below threshold', 'Evidence attached', 'Reviewer sign-off'], monthlyVolume: 8000, manualMinutesBefore: 45, hourlyCostInr: 650 }),
  t({ id: 'fin-reporting', businessFunction: 'Finance', process: 'Financial Reporting', archetype: 'analytical', abuName: 'report section', abuDefinition: 'One management-report section drafted with variance commentary and approved by Finance.', monthlyVolume: 600, manualMinutesBefore: 180, hourlyCostInr: 900, tokenScale: 1.5 }),
  t({ id: 'fin-r2r', businessFunction: 'Finance', process: 'Record-to-Report', archetype: 'analytical', abuName: 'journal entry', abuDefinition: 'One journal entry prepared, validated against policy and posted.', monthlyVolume: 20000, manualMinutesBefore: 12, hourlyCostInr: 550, tokenScale: 0.6 }),
  // Procurement
  t({ id: 'proc-s2p', businessFunction: 'Procurement', process: 'Source-to-Pay', archetype: 'document', abuName: 'requisition', abuDefinition: 'One purchase requisition validated, sourced against contract and converted to a PO.', monthlyVolume: 12000, manualMinutesBefore: 25, hourlyCostInr: 550 }),
  t({ id: 'proc-supplier', businessFunction: 'Procurement', process: 'Supplier Onboarding', archetype: 'document', abuName: 'supplier', abuDefinition: 'One supplier onboarded with KYC, tax and bank checks completed.', monthlyVolume: 1500, manualMinutesBefore: 90, hourlyCostInr: 600, pagesPerTxn: 8, tokenScale: 1.6 }),
  t({ id: 'proc-contract', businessFunction: 'Procurement', process: 'Contract Analysis', archetype: 'generative', abuName: 'contract', abuDefinition: 'One contract analysed with key clauses, risks and deviations from playbook reported.', monthlyVolume: 2000, manualMinutesBefore: 120, hourlyCostInr: 1500, pagesPerTxn: 25, tokenScale: 0.35, humanInterventionRatePct: 40, reviewMinutes: 25, spotCheckMinutes: 5 }),
  t({ id: 'proc-po', businessFunction: 'Procurement', process: 'Purchase Order Processing', archetype: 'document', abuName: 'purchase order', abuDefinition: 'One purchase order created, approved per policy and transmitted to the supplier.', monthlyVolume: 25000, manualMinutesBefore: 10, hourlyCostInr: 450, pagesPerTxn: 1 }),
  // HR
  t({ id: 'hr-recruit', businessFunction: 'HR', process: 'Recruitment', archetype: 'generative', abuName: 'screened candidate', abuDefinition: 'One candidate screened against the role profile with a scored, explainable shortlist recommendation.', monthlyVolume: 15000, manualMinutesBefore: 20, hourlyCostInr: 700, pagesPerTxn: 3, tokenScale: 0.12, humanInterventionRatePct: 20, reviewMinutes: 4, spotCheckMinutes: 0.5, ragQueriesPerTxn: 4 }),
  t({ id: 'hr-onboard', businessFunction: 'HR', process: 'Employee Onboarding', archetype: 'analytical', abuName: 'onboarded employee', abuDefinition: 'One new joiner fully onboarded: accounts, assets, documents and induction scheduled.', monthlyVolume: 800, manualMinutesBefore: 240, hourlyCostInr: 600 }),
  t({ id: 'hr-desk', businessFunction: 'HR', process: 'HR Service Desk', archetype: 'conversational', abuName: 'resolved HR query', abuDefinition: 'One employee HR query resolved without reopening within 7 days.', monthlyVolume: 20000, manualMinutesBefore: 12, hourlyCostInr: 500 }),
  t({ id: 'hr-h2r', businessFunction: 'HR', process: 'Hire-to-Retire', archetype: 'conversational', abuName: 'lifecycle request', abuDefinition: 'One employee lifecycle request (transfer, change, exit) completed end to end.', monthlyVolume: 10000, manualMinutesBefore: 30, hourlyCostInr: 550 }),
  // IT
  t({ id: 'it-desk', businessFunction: 'IT', process: 'IT Service Desk', archetype: 'conversational', abuName: 'resolved ticket', abuDefinition: 'One IT ticket resolved at L0/L1 without reopening within 5 days.', monthlyVolume: 40000, manualMinutesBefore: 18, hourlyCostInr: 500, integrations: ['ServiceNow', 'Identity provider', 'Endpoint management'] }),
  t({ id: 'it-incident', businessFunction: 'IT', process: 'Incident Management', archetype: 'analytical', abuName: 'triaged incident', abuDefinition: 'One incident triaged, correlated and resolved or escalated with a root-cause hypothesis.', monthlyVolume: 6000, manualMinutesBefore: 60, hourlyCostInr: 900 }),
  t({ id: 'it-appsupport', businessFunction: 'IT', process: 'Application Support', archetype: 'analytical', abuName: 'support request', abuDefinition: 'One application support request diagnosed and resolved.', monthlyVolume: 8000, manualMinutesBefore: 45, hourlyCostInr: 850 }),
  // Customer operations
  t({
    id: 'cx-service', businessFunction: 'Customer Operations', process: 'Customer Service', archetype: 'conversational', abuName: 'resolved case',
    abuDefinition: 'One customer interaction resolved (no reopen or repeat contact within 7 days).',
    acceptanceCriteria: ['Customer confirmed or no repeat contact within 7 days', 'Policy-compliant response', 'CRM updated'],
    monthlyVolume: 100000, manualMinutesBefore: 9, hourlyCostInr: 380, integrations: ['CRM', 'Order management', 'Payments / refunds'],
    kpis: [{ name: 'Average handling time', unit: 'min', before: 9, after: 2.5, higherIsBetter: false }, { name: 'CSAT', unit: '/5', before: 3.9, after: 4.3, higherIsBetter: true }],
  }),
  t({ id: 'cx-claims', businessFunction: 'Customer Operations', process: 'Claims Processing', archetype: 'document', abuName: 'adjudicated claim', abuDefinition: 'One claim validated, adjudicated per policy and settled or referred.', monthlyVolume: 10000, manualMinutesBefore: 40, hourlyCostInr: 600, pagesPerTxn: 6, tokenScale: 1.5, humanInterventionRatePct: 25 }),
  t({ id: 'cx-onboard', businessFunction: 'Customer Operations', process: 'Customer Onboarding', archetype: 'document', abuName: 'onboarded customer', abuDefinition: 'One customer onboarded with KYC/AML checks completed and account opened.', monthlyVolume: 5000, manualMinutesBefore: 50, hourlyCostInr: 550, pagesPerTxn: 5 }),
  // Additional
  t({
    id: 'add-rfp', businessFunction: 'Sales', process: 'RFP Response', name: 'RFP Response Agent', archetype: 'generative', abuName: 'RFP response',
    abuDefinition: 'One complete RFP / questionnaire response drafted from approved content and accepted by the bid manager.',
    acceptanceCriteria: ['All mandatory questions answered', 'Compliance matrix complete', 'Bid-manager acceptance'],
    monthlyVolume: 200, manualMinutesBefore: 960, hourlyCostInr: 1800, integrations: ['Content library', 'SharePoint', 'CRM'],
  }),
  t({ id: 'add-docintel', businessFunction: 'Cross-functional', process: 'Document Intelligence', name: 'Document Intelligence Agent', archetype: 'document', abuName: 'analysed document', abuDefinition: 'One document classified, extracted and summarised to the agreed schema.', monthlyVolume: 20000, manualMinutesBefore: 20, hourlyCostInr: 500, pagesPerTxn: 4 }),
  t({ id: 'add-swe', businessFunction: 'IT', process: 'Software Engineering', name: 'Software Engineering Agent', archetype: 'generative', abuName: 'merged change', abuDefinition: 'One code change implemented, tested and merged after human review.', monthlyVolume: 3000, manualMinutesBefore: 240, hourlyCostInr: 1600, documentProcessing: false, pagesPerTxn: 0, tokenScale: 0.6, reviewMinutes: 20, spotCheckMinutes: 10, integrations: ['Git hosting', 'CI/CD', 'Issue tracker'] }),
  t({ id: 'add-custom', businessFunction: 'Custom', process: 'Custom AI Workflow', name: 'Custom AI Workflow', archetype: 'analytical', abuName: 'completed workflow', abuDefinition: 'One workflow instance completed and accepted per the agreed criteria.', monthlyVolume: 1000, manualMinutesBefore: 30, hourlyCostInr: 600 }),
];

export const DEFAULT_ROLES: Role[] = [
  { id: 'r-em', name: 'Engagement Manager', costRate: 4500, billRate: 9000, currency: 'INR' },
  { id: 'r-pm', name: 'Project Manager', costRate: 3000, billRate: 6000, currency: 'INR' },
  { id: 'r-ba', name: 'Business Analyst', costRate: 2200, billRate: 4400, currency: 'INR' },
  { id: 'r-sa', name: 'Solution Architect', costRate: 3800, billRate: 7600, currency: 'INR' },
  { id: 'r-ai', name: 'AI Engineer', costRate: 2800, billRate: 5600, currency: 'INR' },
  { id: 'r-pe', name: 'Prompt & Context Engineer', costRate: 2600, billRate: 5200, currency: 'INR' },
  { id: 'r-de', name: 'Data Engineer', costRate: 2500, billRate: 5000, currency: 'INR' },
  { id: 'r-ie', name: 'Integration Engineer', costRate: 2400, billRate: 4800, currency: 'INR' },
  { id: 'r-sec', name: 'Security & Governance Specialist', costRate: 3200, billRate: 6400, currency: 'INR' },
  { id: 'r-qa', name: 'AI Test & Evaluation Engineer', costRate: 2000, billRate: 4000, currency: 'INR' },
  { id: 'r-devops', name: 'DevOps Engineer', costRate: 2400, billRate: 4800, currency: 'INR' },
  { id: 'r-cm', name: 'Change Management Consultant', costRate: 2200, billRate: 4400, currency: 'INR' },
];

let counter = 0;
export function uid(prefix = 'id'): string {
  counter++;
  const rnd = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID().slice(0, 8) : Math.random().toString(36).slice(2, 10);
  return `${prefix}-${rnd}${counter.toString(36)}`;
}

export interface SizingInput {
  agents: number;
  workflows: number;
  integrations: number;
  ragRequired: boolean;
  documentProcessing: boolean;
  humanInTheLoop: boolean;
}

/** Heuristic implementation plan sized from solution complexity. Every line is editable. */
export function buildImplementationPlan(s: SizingInput, idPrefix = 'a'): ImplementationPlan {
  const A = Math.max(1, s.agents);
  const W = Math.max(1, s.workflows);
  const I = Math.max(0, s.integrations);
  const acts: (Omit<Activity, 'effortUnit' | 'durationWeeks'> & { fte: number })[] = [
    { id: `${idPrefix}-disc`, phase: 'Discovery & business analysis', name: 'Process discovery, baseline & ABU definition', roleId: 'r-ba', effort: 160 + 40 * W, dependsOn: [], fte: 2 },
    { id: `${idPrefix}-arch`, phase: 'Solution architecture', name: 'Agent architecture, model selection & NFRs', roleId: 'r-sa', effort: 120 + 30 * A, dependsOn: [`${idPrefix}-disc`], fte: 1 },
    { id: `${idPrefix}-agent`, phase: 'AI agent engineering', name: 'Agent development & tool integration', roleId: 'r-ai', effort: 240 * A, dependsOn: [`${idPrefix}-arch`], fte: 3 },
    { id: `${idPrefix}-prompt`, phase: 'Prompt & context engineering', name: 'Prompts, context design & caching strategy', roleId: 'r-pe', effort: 80 * A, dependsOn: [`${idPrefix}-arch`], fte: 1 },
    ...(s.ragRequired ? [{ id: `${idPrefix}-rag`, phase: 'RAG development', name: 'Ingestion, chunking, embeddings & retrieval tuning', roleId: 'r-ai', effort: 320, dependsOn: [`${idPrefix}-arch`], fte: 2 }] : []),
    ...(I > 0 ? [{ id: `${idPrefix}-int`, phase: 'Enterprise integrations', name: `Integrations (${I} systems)`, roleId: 'r-ie', effort: 160 * I, dependsOn: [`${idPrefix}-arch`], fte: 2 }] : []),
    { id: `${idPrefix}-data`, phase: 'Data engineering', name: 'Data pipelines, master data & audit store', roleId: 'r-de', effort: 160 + (s.ragRequired ? 160 : 0) + (s.documentProcessing ? 80 : 0), dependsOn: [`${idPrefix}-disc`], fte: 1 },
    { id: `${idPrefix}-sec`, phase: 'Security & governance', name: 'Threat model, guardrails, responsible-AI controls', roleId: 'r-sec', effort: 120 + (s.humanInTheLoop ? 40 : 0), dependsOn: [`${idPrefix}-arch`], fte: 1 },
    { id: `${idPrefix}-eval`, phase: 'Agent testing & evaluations', name: 'Evaluation suite, UAT & performance testing', roleId: 'r-qa', effort: 200 + 60 * A, dependsOn: [`${idPrefix}-agent`], fte: 2 },
    { id: `${idPrefix}-devops`, phase: 'DevOps / CI-CD', name: 'Environments, pipelines & observability', roleId: 'r-devops', effort: 160, dependsOn: [`${idPrefix}-arch`], fte: 1 },
    { id: `${idPrefix}-deploy`, phase: 'Deployment', name: 'Production cut-over & hypercare', roleId: 'r-devops', effort: 80 + 20 * W, dependsOn: [`${idPrefix}-eval`, `${idPrefix}-devops`], fte: 1 },
    { id: `${idPrefix}-change`, phase: 'Training & change management', name: 'Training, comms & operating-model change', roleId: 'r-cm', effort: 120 + 40 * W, dependsOn: [`${idPrefix}-eval`], fte: 1 },
  ];
  // Integrations & RAG must finish before evaluation.
  const ev = acts.find((a) => a.id === `${idPrefix}-eval`)!;
  for (const id of [`${idPrefix}-rag`, `${idPrefix}-int`, `${idPrefix}-prompt`]) if (acts.some((a) => a.id === id)) ev.dependsOn.push(id);
  const activities: Activity[] = acts.map(({ fte, ...a }) => ({ ...a, effortUnit: 'hours', durationWeeks: Math.max(1, Math.ceil(a.effort / (40 * fte))) }));
  const totalHours = activities.reduce((x, a) => x + a.effort, 0);
  // Critical-path length for PM duration.
  const end: Record<string, number> = {};
  const visit = (a: Activity): number => {
    if (end[a.id] !== undefined) return end[a.id];
    const s0 = Math.max(0, ...a.dependsOn.map((d) => visit(activities.find((x) => x.id === d)!)));
    end[a.id] = s0 + a.durationWeeks;
    return end[a.id];
  };
  activities.forEach(visit);
  const weeks = Math.max(...Object.values(end));
  activities.push({ id: `${idPrefix}-pm`, phase: 'Project management', name: 'Project & delivery management', roleId: 'r-pm', effort: Math.round(totalHours * 0.1), effortUnit: 'hours', durationWeeks: weeks, dependsOn: [] });
  activities.push({ id: `${idPrefix}-em`, phase: 'Project management', name: 'Engagement leadership & QA', roleId: 'r-em', effort: Math.round(weeks * 8), effortUnit: 'hours', durationWeeks: weeks, dependsOn: [] });
  return {
    roles: structuredClone(DEFAULT_ROLES),
    activities,
    directExpenses: [
      { id: `${idPrefix}-x1`, name: 'Non-production environments & LLM usage during build', amount: 450000, currency: 'INR', billable: true },
      { id: `${idPrefix}-x2`, name: 'Travel & workshops', amount: 250000, currency: 'INR', billable: true },
    ],
    contingencyPct: 10,
    hoursPerDay: 8,
    targetMarginPct: 32,
    pricingMethod: 'cost_plus_margin',
    discountPct: 0,
  };
}

export interface CostLineSizing {
  workflowId: string | null;
  workflowSteps: number;
  toolCallsPerExecution: number;
  ragRequired: boolean;
  ragQueriesPerTxn: number;
  documentProcessing: boolean;
  pagesPerTxn: number;
  monthlyVolume: number;
  agents: number;
  peakConcurrency: number;
}

/** Default non-LLM execution cost lines linked to the cloud price table. */
export function buildCostLines(s: CostLineSizing, catalog: Catalog, idPrefix = 'c'): CostLine[] {
  const price = (id: string) => catalog.cloudPrices.find((p) => p.id === id);
  const line = (id: string, priceRef: string, name: string, basis: CostLine['basis'], quantity: number, extra: Partial<CostLine> = {}): CostLine => {
    const p = price(priceRef);
    return {
      id: `${idPrefix}-${id}`,
      category: p?.category ?? 'OTHER',
      name,
      componentKey: p?.componentKey ?? id,
      basis,
      unitCost: p?.unitCost ?? 0,
      currency: p?.currency ?? 'USD',
      unitLabel: p?.unitLabel ?? 'unit',
      quantity,
      workflowId: s.workflowId,
      workflowAllocation: 'by_attempted',
      scalesWithComplexity: false,
      acuResourceKey: p?.acuResourceKey ?? null,
      acuUnitsPerUnit: p?.acuUnitsPerUnit,
      priceRef,
      ...extra,
    };
  };
  const nodes = Math.max(2, Math.ceil(s.peakConcurrency / 50) + 1);
  const lines: CostLine[] = [
    line('wf', 'workflow-1k', 'Workflow orchestration (state transitions)', 'per_execution', s.workflowSteps / 1000),
    line('fn', 'serverless-1m', 'Serverless tool executions', 'per_execution', s.toolCallsPerExecution / 1_000_000),
    line('gw', 'apigw-1m', 'API gateway — enterprise integration calls', 'per_execution', (s.toolCallsPerExecution + 2) / 1_000_000),
  ];
  if (s.ragRequired) {
    lines.push(line('vq', 'vector-query-1k', 'Vector search queries', 'per_execution', s.ragQueriesPerTxn / 1000));
    lines.push(line('vs', 'vector-storage-gb', 'Vector index storage', 'fixed_monthly', 60));
    lines.push(line('emb', 'embedding-1m', 'Knowledge ingestion — embeddings', 'fixed_monthly', 150));
    lines.push(line('rx', 'reindex-run', 'Knowledge re-indexing runs', 'fixed_monthly', 4));
  }
  if (s.documentProcessing && s.pagesPerTxn > 0) {
    lines.push(line('ocr', 'invoice-extract-page', 'OCR & structured field extraction', 'per_attempted', s.pagesPerTxn, { scalesWithComplexity: true }));
    lines.push(line('cls', 'doc-classify-1k', 'Document classification', 'per_attempted', s.pagesPerTxn / 1000));
  }
  lines.push(
    line('host', 'node-8x32-month', 'Application hosting (container nodes)', 'fixed_monthly', nodes),
    line('db', 'postgres-ha-month', 'Managed PostgreSQL (HA)', 'fixed_monthly', 1),
    line('obj', 'object-storage-gb', 'Object storage — documents & audit trail', 'fixed_monthly', Math.max(200, Math.round(s.monthlyVolume * Math.max(1, s.pagesPerTxn) * 0.0004))),
    line('net', 'network-egress-gb', 'Network egress', 'fixed_monthly', 150),
    line('obs', 'observability-1k', 'LLM observability & tracing', 'per_llm_call', 1 / 1000),
    line('log', 'log-ingest-gb', 'Log ingestion & retention', 'fixed_monthly', Math.max(100, Math.round(s.monthlyVolume / 400))),
    line('sec', 'security-gateway-month', 'WAF, secrets & AI security gateway', 'fixed_monthly', 1),
    line('l1', 'agentops-l1-fte', 'AgentOps L1 — monitoring & triage', 'fixed_monthly', Math.max(0.5, Math.round((s.monthlyVolume / 50000) * 2) / 2)),
    line('l2', 'agentops-l2-fte', 'AgentOps L2 — incident & prompt fixes', 'fixed_monthly', Math.max(0.5, Math.round((s.agents / 6) * 2) / 2)),
    line('l3', 'agentops-l3-fte', 'AgentOps L3 — model & agent engineering', 'fixed_monthly', 0.25),
    line('eval', 'agentops-eval-fte', 'Quality evaluation & prompt optimisation', 'fixed_monthly', 0.25),
    line('gov', 'agentops-release-fte', 'Release management, governance & FinOps reporting', 'fixed_monthly', 0.25),
  );
  return lines;
}

export interface IntakeInput {
  /** Optional fixed project id (deterministic ids for seeded samples). */
  id?: string;
  projectName: string;
  client: ClientInfo;
  currency: string;
  templateId: string;
  provider: keyof typeof PROVIDER_TIER_MAP | string;
  cloudPlatform: string;
  solutionType: SolutionType;
  goLiveDate?: string;
  monthlyVolume?: number;
  annualGrowthPct?: number;
  plannedAgents?: number;
  plannedWorkflows?: number;
  integrations?: string[];
  dataSources?: string[];
  ragRequired?: boolean;
  documentProcessing?: boolean;
  humanInTheLoop?: boolean;
  successRatePct?: number;
  retryRatePct?: number;
  humanInterventionRatePct?: number;
  tokenMultiplier?: number;
  peakConcurrency?: number;
  securityRequirements?: string;
  availabilitySla?: string;
  supportSla?: string;
  owner?: string;
}

export function stepsFromSpecs(specs: StepSpec[], agentIds: Record<string, string>, provider: string, scale: number, idPrefix: string): LlmStep[] {
  const map = PROVIDER_TIER_MAP[provider] ?? PROVIDER_TIER_MAP.anthropic;
  return specs.map((s, i) => ({
    id: `${idPrefix}-s${i + 1}`,
    name: s.name,
    agentId: agentIds[s.agent] ?? '',
    callsPerExecution: s.calls,
    inputTokens: Math.round(s.input * scale),
    outputTokens: Math.round(s.output * scale),
    reasoningTokens: Math.round((s.reasoning ?? 0) * scale),
    cacheablePrefixTokens: s.prefix ?? 0,
    cacheHitRatePct: s.cacheHit ?? 0,
    batchEligiblePct: s.batch ?? 0,
    toolCall: !!s.tool,
    routing: [{ modelId: map[s.tier], sharePct: 100 }],
  }));
}

export function createProjectFromIntake(input: IntakeInput, catalog: Catalog, templates: ProcessTemplate[] = PROCESS_TEMPLATES): Project {
  const tpl = templates.find((x) => x.id === input.templateId) ?? templates[templates.length - 1];
  const pid = input.id ?? uid('p');
  const now = new Date().toISOString();
  const agents: Agent[] = tpl.agents.map((a, i) => ({ id: `${pid}-ag${i + 1}`, name: a.name, role: a.role }));
  const agentIds = Object.fromEntries(tpl.agents.map((a, i) => [a.key, agents[i].id]));
  const rag = input.ragRequired ?? tpl.ragRequired;
  const doc = input.documentProcessing ?? tpl.documentProcessing;
  const hitl = input.humanInTheLoop ?? tpl.humanInterventionRatePct > 0;
  const volume = input.monthlyVolume ?? tpl.monthlyVolume;
  const wfId = `${pid}-wf1`;
  const cur = input.currency || 'INR';
  const inr = (v: number) => convert(v, 'INR', cur, catalog.fx).toDecimalPlaces(2).toNumber();
  const workflow: Workflow = {
    id: wfId,
    name: tpl.name,
    businessFunction: tpl.businessFunction,
    process: tpl.process,
    abuName: tpl.abuName,
    abuDefinition: tpl.abuDefinition,
    acceptanceCriteria: [...tpl.acceptanceCriteria],
    monthlyVolume: volume,
    annualGrowthPct: input.annualGrowthPct ?? 10,
    workflowSteps: tpl.workflowSteps,
    toolCallsPerExecution: tpl.toolCallsPerExecution,
    successRatePct: input.successRatePct ?? tpl.successRatePct,
    acceptanceRatePct: tpl.acceptanceRatePct,
    retryRatePct: input.retryRatePct ?? tpl.retryRatePct,
    retryConsumptionPct: 60,
    failedConsumptionPct: 50,
    humanInterventionRatePct: hitl ? input.humanInterventionRatePct ?? tpl.humanInterventionRatePct : 0,
    complexity: tpl.complexity.map((c) => ({ ...c, priceOverride: null })),
    llmSteps: stepsFromSpecs(tpl.steps, agentIds, input.provider, tpl.tokenScale * (input.tokenMultiplier ?? 1), wfId),
    humanReview: { minutesPerAssistedTxn: tpl.reviewMinutes, minutesPerRejectedTxn: Math.max(5, tpl.reviewMinutes), hourlyCost: inr(tpl.hourlyCostInr), currency: cur, borneBy: tpl.archetype === 'generative' ? 'client' : 'provider' },
  };
  const integrations = input.integrations ?? tpl.integrations;
  const peak = input.peakConcurrency ?? Math.max(5, Math.round(volume / 22 / 8 / 6));
  const plannedAgents = input.plannedAgents ?? agents.length;
  const plannedWorkflows = input.plannedWorkflows ?? 1;
  const productiveHours = 140;
  const steadyHoursSaved = (volume * (tpl.manualMinutesBefore * 0.85 - tpl.spotCheckMinutes)) / 60;
  const productivityValueAnnual = Math.max(0, steadyHoursSaved * tpl.hourlyCostInr * 12);

  const project: Project = {
    id: pid,
    name: input.projectName || `${tpl.name} — ${input.client.clientName}`,
    status: 'pre_sales',
    currency: cur,
    goLiveDate: input.goLiveDate ?? new Date(Date.now() + 1000 * 60 * 60 * 24 * 150).toISOString().slice(0, 7),
    createdAt: now,
    updatedAt: now,
    owner: input.owner ?? 'You',
    illustrative: false,
    client: { ...input.client, businessFunction: input.client.businessFunction || tpl.businessFunction, businessProcess: input.client.businessProcess || tpl.process },
    solution: {
      solutionType: input.solutionType,
      cloudPlatform: input.cloudPlatform,
      llmProviders: [PROVIDER_TIER_MAP[input.provider]?.label ?? String(input.provider)],
      integrations,
      dataSources: input.dataSources ?? [],
      ragRequired: rag,
      documentProcessing: doc,
      humanInTheLoop: hitl,
      securityRequirements: input.securityRequirements ?? 'SSO, data residency in India, PII masking before LLM calls, full audit trail',
      availabilitySla: input.availabilitySla ?? '99.5% (business hours)',
      supportSla: input.supportSla ?? 'P1 response 30 min, 24×7',
      peakConcurrency: peak,
      workingDaysPerMonth: 22,
      plannedAgents,
      plannedWorkflows,
    },
    agents,
    workflows: [workflow],
    implementation: buildImplementationPlan({ agents: plannedAgents, workflows: plannedWorkflows, integrations: integrations.length, ragRequired: rag, documentProcessing: doc, humanInTheLoop: hitl }, `${pid}-a`),
    costLines: buildCostLines(
      { workflowId: null, workflowSteps: tpl.workflowSteps, toolCallsPerExecution: tpl.toolCallsPerExecution, ragRequired: rag, ragQueriesPerTxn: tpl.ragQueriesPerTxn, documentProcessing: doc, pagesPerTxn: tpl.pagesPerTxn, monthlyVolume: volume, agents: agents.length, peakConcurrency: peak },
      catalog,
      `${pid}-c`,
    ),
    acu: { method: 'cost_normalized', referenceValue: 1, referenceCurrency: cur, eligiblePools: ['LLM', 'ORCHESTRATION', 'RAG', 'DOCUMENT'], weightSetId: 'acu-std-v1' },
    pricing: defaultPricing(),
    value: {
      productivity: [{ workflowId: wfId, manualMinutesBefore: tpl.manualMinutesBefore, spotCheckMinutesAutonomous: tpl.spotCheckMinutes, loadedHourlyCost: inr(tpl.hourlyCostInr), currency: cur, productiveHoursPerFteMonth: productiveHours }],
      benefits: [
        {
          id: `${pid}-b1`,
          name: 'Capacity redeployment / avoided backfill (to be validated)',
          category: 'capacity_conversion',
          annualAmount: inr(Math.round(productivityValueAnnual * 0.25)),
          currency: cur,
          startMonth: 4,
          rampMonths: 6,
          confidencePct: 70,
          status: 'proposed',
          overlapGroup: null,
          scalesWithVolume: true,
          notes: 'Placeholder: 25% of released capacity converted to cash. Not counted until Finance validates the mechanism (attrition, redeployment, avoided hiring).',
        },
      ],
      clientCosts: [{ id: `${pid}-cc1`, name: 'Client SME time & change management', type: 'one_time', amount: inr(1500000), currency: cur }],
      discountRatePct: 10,
      includeUnvalidated: false,
      kpis: tpl.kpis.map((k, i) => ({ id: `${pid}-k${i + 1}`, ...k })),
    },
    actuals: [],
    scenarios: [],
  };
  return project;
}

export function defaultPricing(): Project['pricing'] {
  return {
    termMonths: 36,
    priceEscalationPct: 4,
    costInflationPct: 4,
    llmPriceChangePct: 0,
    rampMonths: 3,
    rampStartPct: 50,
    passThroughMarkupPct: 10,
    streams: [
      { id: 's-impl', type: 'fixed_fee', label: 'Implementation fee', enabled: true, recovers: ['IMPLEMENTATION'], targetMarginPct: 32, discountPct: 0 },
      { id: 's-abu', type: 'abu', label: 'ABU transaction pricing', enabled: true, recovers: [...RUN_POOLS], targetMarginPct: 35, discountPct: 0 },
    ],
    acuRateCard: { tierMode: 'graduated', tiers: [], minMonthlyCommitment: 0, marginFloorPct: 15, priceOverride: null },
    abuRateCard: { tierMode: 'graduated', tiers: [], minMonthlyAbus: 0, marginFloorPct: 15, classPricing: 'weighted', failedCostAllocation: 'spread', humanAssistedPriceFactor: 1, priceOverrides: {} },
    subscription: { includedUnit: 'none', includedQty: 0, includedDiscountPct: 0, overagePremiumPct: 10 },
    gainshare: { sharePct: 30, thresholdAnnual: 0, capAnnual: null, basis: 'validated' },
    rateCardVersions: [],
  };
}
