/**
 * Three realistic but clearly ILLUSTRATIVE sample projects. Client names are
 * fictitious; every rate, volume and benefit is a demonstration assumption.
 *
 *  1. Accounts Payable Agent   — 50,000 invoices/month, LLM + OCR + ERP, ABU pricing (live, 6 months of actuals)
 *  2. Customer Service Agent   — 100,000 interactions/month, multiple models & tools, subscription + ABU (live, 3 months)
 *  3. RFP Response Agent       — 1,000 RFP workflows/month, RAG + document generation, subscription + ACU (pre-sales)
 */
import type { ActualRecord, Catalog, Project } from '../types';
import { RUN_POOLS } from '../types';
import { createProjectFromIntake, stepsFromSpecs } from '../templates';
import { computeProject } from '../compute';
import { defaultCatalog } from '../catalog';

const CREATED = '2026-03-02T09:00:00.000Z';

function accountsPayable(catalog: Catalog): Project {
  const p = createProjectFromIntake(
    {
      id: 'sample-ap',
      projectName: 'Accounts Payable Agent',
      client: { clientName: 'Aravalli Manufacturing Ltd (illustrative)', industry: 'Manufacturing', geography: 'India', businessFunction: 'Finance', businessProcess: 'Accounts Payable', engagementType: 'Agent-as-a-Service (managed)' },
      currency: 'INR',
      templateId: 'fin-ap',
      provider: 'anthropic',
      cloudPlatform: 'AWS (ap-south-1)',
      solutionType: 'multi_agent',
      goLiveDate: '2026-04',
      monthlyVolume: 50000,
      annualGrowthPct: 12,
      integrations: ['SAP S/4HANA', 'Supplier portal', 'Email intake', 'Bank payment file'],
      dataSources: ['Vendor master', 'PO & GRN tables', 'AP policy manual'],
      peakConcurrency: 60,
      owner: 'Priya Menon',
    },
    catalog,
  );
  p.status = 'live';
  p.illustrative = true;
  p.createdAt = CREATED;
  p.updatedAt = '2026-10-01T09:00:00.000Z';
  const wf = p.workflows[0];
  wf.retryRatePct = 8;
  wf.humanReview = { minutesPerAssistedTxn: 6, minutesPerRejectedTxn: 8, hourlyCost: 500, currency: 'INR', borneBy: 'provider' };
  p.pricing.abuRateCard.tiers = [
    { fromUnits: 60000, discountPct: 3 },
    { fromUnits: 80000, discountPct: 6 },
  ];
  p.pricing.abuRateCard.minMonthlyAbus = 40000;
  p.pricing.streams = [
    { id: 's-impl', type: 'fixed_fee', label: 'Implementation fee', enabled: true, recovers: ['IMPLEMENTATION'], targetMarginPct: 32, discountPct: 0 },
    { id: 's-abu', type: 'abu', label: 'Per-invoice ABU pricing', enabled: true, recovers: [...RUN_POOLS], targetMarginPct: 35, discountPct: 0 },
  ];
  p.value.benefits = [
    { id: 'ap-b1', name: 'Reduced BPO / contractor processing fees', category: 'hard_savings', annualAmount: 42_000_000, currency: 'INR', startMonth: 2, rampMonths: 4, confidencePct: 90, status: 'finance_validated', validatedBy: 'R. Iyer (CFO office)', validatedOn: '2026-03-20', overlapGroup: 'ap-labour', scalesWithVolume: false, notes: 'Contracted reduction of 70 BPO seats at ₹50k per seat-month.' },
    { id: 'ap-b2', name: 'Capacity redeployment of AP clerks', category: 'capacity_conversion', annualAmount: 15_000_000, currency: 'INR', startMonth: 4, rampMonths: 6, confidencePct: 70, status: 'proposed', overlapGroup: 'ap-labour', scalesWithVolume: true, notes: 'Overlaps the BPO reduction — only the larger of the two is counted.' },
    { id: 'ap-b3', name: 'Early-payment discounts captured', category: 'hard_savings', annualAmount: 15_000_000, currency: 'INR', startMonth: 3, rampMonths: 6, confidencePct: 75, status: 'finance_validated', validatedBy: 'R. Iyer (CFO office)', validatedOn: '2026-03-20', scalesWithVolume: true },
    { id: 'ap-b4', name: 'Duplicate & erroneous payment avoidance', category: 'cost_avoidance', annualAmount: 4_500_000, currency: 'INR', startMonth: 1, rampMonths: 3, confidencePct: 85, status: 'realized', validatedBy: 'Internal audit', validatedOn: '2026-07-15', scalesWithVolume: true },
    { id: 'ap-b5', name: 'Avoided hiring for volume growth', category: 'cost_avoidance', annualAmount: 6_000_000, currency: 'INR', startMonth: 13, rampMonths: 6, confidencePct: 80, status: 'finance_validated', validatedBy: 'R. Iyer (CFO office)', validatedOn: '2026-03-20', scalesWithVolume: false },
    { id: 'ap-b6', name: 'Working-capital financing benefit (faster processing)', category: 'working_capital', annualAmount: 1_800_000, currency: 'INR', startMonth: 4, rampMonths: 6, confidencePct: 60, status: 'proposed', scalesWithVolume: false, notes: 'Annual financing benefit of released working capital at WACC — not the balance released.' },
  ];
  p.value.clientCosts = [
    { id: 'ap-cc1', name: 'Client SME time & change management', type: 'one_time', amount: 1_500_000, currency: 'INR' },
    { id: 'ap-cc2', name: 'ERP API licence uplift', type: 'monthly', amount: 150_000, currency: 'INR' },
  ];
  p.value.productivity[0].loadedHourlyCost = 450;
  return p;
}

function customerService(catalog: Catalog): Project {
  const p = createProjectFromIntake(
    {
      id: 'sample-cs',
      projectName: 'Customer Service Agent',
      client: { clientName: 'Indus Retail Bank (illustrative)', industry: 'Banking & Financial Services', geography: 'India', businessFunction: 'Customer Operations', businessProcess: 'Customer Service', engagementType: 'Agent-as-a-Service (managed)' },
      currency: 'INR',
      templateId: 'cx-service',
      provider: 'anthropic',
      cloudPlatform: 'Azure (Central India)',
      solutionType: 'multi_agent',
      goLiveDate: '2026-07',
      monthlyVolume: 85000,
      annualGrowthPct: 15,
      plannedWorkflows: 2,
      integrations: ['CRM', 'Core banking (read)', 'Card management', 'Refunds & disputes', 'WhatsApp / chat channel'],
      dataSources: ['Product & policy knowledge base', 'FAQ library', 'Customer 360'],
      peakConcurrency: 220,
      owner: 'Arjun Rao',
    },
    catalog,
  );
  p.status = 'live';
  p.illustrative = true;
  p.createdAt = CREATED;
  p.updatedAt = '2026-10-01T09:00:00.000Z';
  const q = p.workflows[0];
  q.name = 'Customer query resolution';
  q.complexity = [
    { id: 'simple', name: 'Simple', sharePct: 70, abuWeight: 1, consumptionMultiplier: 0.8, humanEffortMultiplier: 0.7, priceOverride: null },
    { id: 'medium', name: 'Medium', sharePct: 25, abuWeight: 1.5, consumptionMultiplier: 1.3, humanEffortMultiplier: 1.2, priceOverride: null },
    { id: 'complex', name: 'Complex', sharePct: 5, abuWeight: 2.5, consumptionMultiplier: 2, humanEffortMultiplier: 2, priceOverride: null },
  ];
  // Multiple models from multiple providers within one workflow.
  q.llmSteps[0].routing = [{ modelId: 'google-flash-class', sharePct: 100 }];
  q.llmSteps[1].routing = [
    { modelId: 'anthropic-haiku-class', sharePct: 70 },
    { modelId: 'anthropic-sonnet-class', sharePct: 30 },
  ];
  q.llmSteps[3].routing = [{ modelId: 'openai-mini', sharePct: 100 }];
  q.humanReview = { minutesPerAssistedTxn: 4, minutesPerRejectedTxn: 6, hourlyCost: 420, currency: 'INR', borneBy: 'client' };
  q.humanInterventionRatePct = 12;

  const agentIds = Object.fromEntries(p.agents.map((a, i) => [['router', 'resolver', 'action', 'qa'][i], a.id]));
  const c: typeof q = {
    ...structuredClone(q),
    id: 'sample-cs-wf2',
    name: 'Complaint & refund resolution',
    abuName: 'resolved complaint',
    abuDefinition: 'One complaint or refund request resolved within policy, with the customer notified and the case closed without regulatory escalation.',
    acceptanceCriteria: ['Resolution within policy limits', 'Customer notified', 'No escalation to the banking ombudsman within 30 days'],
    monthlyVolume: 15000,
    annualGrowthPct: 10,
    successRatePct: 84,
    acceptanceRatePct: 94,
    retryRatePct: 7,
    humanInterventionRatePct: 30,
    toolCallsPerExecution: 6,
    workflowSteps: 14,
    complexity: [
      { id: 'standard', name: 'Standard', sharePct: 50, abuWeight: 1, consumptionMultiplier: 0.9, humanEffortMultiplier: 0.8, priceOverride: null },
      { id: 'involved', name: 'Involved', sharePct: 35, abuWeight: 2, consumptionMultiplier: 1.3, humanEffortMultiplier: 1.3, priceOverride: null },
      { id: 'escalated', name: 'Escalated', sharePct: 15, abuWeight: 4, consumptionMultiplier: 2.2, humanEffortMultiplier: 2.5, priceOverride: null },
    ],
    llmSteps: stepsFromSpecs(
      [
        { name: 'Intent & eligibility classification', agent: 'router', tier: 'fast', calls: 1, input: 1500, output: 120, prefix: 900, cacheHit: 70 },
        { name: 'Policy reasoning & resolution', agent: 'resolver', tier: 'frontier', calls: 1.5, input: 9000, output: 900, reasoning: 1500, prefix: 3000, cacheHit: 60 },
        { name: 'Refund / dispute tool actions', agent: 'action', tier: 'balanced', calls: 2, input: 3000, output: 300, prefix: 1200, cacheHit: 60, tool: true },
        { name: 'Customer communication draft', agent: 'resolver', tier: 'balanced', calls: 1, input: 3000, output: 400, prefix: 1000, cacheHit: 50 },
        { name: 'Quality & conduct-risk check', agent: 'qa', tier: 'fast', calls: 1, input: 2500, output: 150, prefix: 600, cacheHit: 70 },
      ],
      agentIds,
      'anthropic',
      1,
      'sample-cs-wf2',
    ),
    humanReview: { minutesPerAssistedTxn: 9, minutesPerRejectedTxn: 10, hourlyCost: 450, currency: 'INR', borneBy: 'client' },
  };
  c.llmSteps[4].routing = [{ modelId: 'openai-mini', sharePct: 100 }];
  p.workflows.push(c);
  p.value.productivity.push({ workflowId: c.id, manualMinutesBefore: 22, spotCheckMinutesAutonomous: 0.5, loadedHourlyCost: 450, currency: 'INR', productiveHoursPerFteMonth: 140 });
  p.value.productivity[0].loadedHourlyCost = 420;

  p.pricing.streams = [
    { id: 's-impl', type: 'fixed_fee', label: 'Implementation fee', enabled: true, recovers: ['IMPLEMENTATION'], targetMarginPct: 30, discountPct: 0 },
    { id: 's-sub', type: 'subscription', label: 'Platform subscription', enabled: true, recovers: ['INFRASTRUCTURE', 'AGENTOPS', 'RAG', 'OTHER'], targetMarginPct: 30, discountPct: 0 },
    { id: 's-abu', type: 'abu', label: 'Per-resolution ABU pricing', enabled: true, recovers: ['LLM', 'ORCHESTRATION', 'DOCUMENT', 'HUMAN_REVIEW'], targetMarginPct: 40, discountPct: 0 },
  ];
  p.pricing.subscription = { includedUnit: 'abu', includedQty: 80000, includedDiscountPct: 5, overagePremiumPct: 10 };
  p.value.benefits = [
    { id: 'cs-b1', name: 'Reduced outsourced contact-centre seats (80 seats)', category: 'hard_savings', annualAmount: 48_000_000, currency: 'INR', startMonth: 3, rampMonths: 6, confidencePct: 90, status: 'finance_validated', validatedBy: 'S. Kapoor (Finance BP)', validatedOn: '2026-05-28', overlapGroup: 'cs-labour', scalesWithVolume: false },
    { id: 'cs-b2', name: 'Agent capacity converted to sales outreach', category: 'capacity_conversion', annualAmount: 20_000_000, currency: 'INR', startMonth: 6, rampMonths: 6, confidencePct: 60, status: 'proposed', overlapGroup: 'cs-labour', scalesWithVolume: true },
    { id: 'cs-b3', name: 'Avoided seasonal hiring', category: 'cost_avoidance', annualAmount: 7_200_000, currency: 'INR', startMonth: 4, rampMonths: 3, confidencePct: 85, status: 'finance_validated', validatedBy: 'S. Kapoor (Finance BP)', validatedOn: '2026-05-28', scalesWithVolume: false },
    { id: 'cs-b4', name: 'Retention uplift from faster resolution (contribution margin)', category: 'revenue', annualAmount: 12_000_000, currency: 'INR', startMonth: 6, rampMonths: 9, confidencePct: 50, status: 'proposed', scalesWithVolume: false, notes: 'Contribution margin, not revenue. Requires a churn attribution study before validation.' },
  ];
  p.value.clientCosts = [
    { id: 'cs-cc1', name: 'Client SME time, compliance review & change management', type: 'one_time', amount: 2_500_000, currency: 'INR' },
    { id: 'cs-cc2', name: 'Channel platform licences', type: 'monthly', amount: 200_000, currency: 'INR' },
  ];
  p.value.kpis = [
    { id: 'cs-k1', name: 'Average handling time', unit: 'min', before: 9, after: 2.5, higherIsBetter: false },
    { id: 'cs-k2', name: 'CSAT', unit: '/5', before: 3.9, after: 4.3, higherIsBetter: true },
    { id: 'cs-k3', name: 'First-contact resolution', unit: '%', before: 64, after: 81, higherIsBetter: true },
  ];
  // Rebuild implementation for 2 workflows (template sizing already used plannedWorkflows = 2).
  return p;
}

function rfpResponse(catalog: Catalog): Project {
  const p = createProjectFromIntake(
    {
      id: 'sample-rfp',
      projectName: 'RFP Response Agent',
      client: { clientName: 'Nilgiri Technology Services (illustrative)', industry: 'Technology & IT Services', geography: 'India & APAC', businessFunction: 'Sales', businessProcess: 'RFP Response', engagementType: 'Agent-as-a-Service (subscription)' },
      currency: 'INR',
      templateId: 'add-rfp',
      provider: 'bedrock',
      cloudPlatform: 'AWS (ap-south-1)',
      solutionType: 'multi_agent',
      goLiveDate: '2027-01',
      monthlyVolume: 1000,
      annualGrowthPct: 10,
      integrations: ['Content library', 'SharePoint', 'CRM'],
      dataSources: ['Past proposals', 'Case studies', 'Security & compliance answers', 'Pricing guidelines'],
      peakConcurrency: 40,
      owner: 'Neha Kulkarni',
    },
    catalog,
  );
  p.illustrative = true;
  p.createdAt = CREATED;
  p.updatedAt = '2026-09-25T09:00:00.000Z';
  const wf = p.workflows[0];
  wf.complexity = [
    { id: 'questionnaire', name: 'Questionnaire', sharePct: 50, abuWeight: 1, consumptionMultiplier: 0.5, humanEffortMultiplier: 0.5, priceOverride: null },
    { id: 'standard', name: 'Standard RFP', sharePct: 35, abuWeight: 2, consumptionMultiplier: 1.2, humanEffortMultiplier: 1.2, priceOverride: null },
    { id: 'strategic', name: 'Strategic bid', sharePct: 15, abuWeight: 4, consumptionMultiplier: 2.4, humanEffortMultiplier: 2.5, priceOverride: null },
  ];
  wf.humanReview = { minutesPerAssistedTxn: 120, minutesPerRejectedTxn: 240, hourlyCost: 1800, currency: 'INR', borneBy: 'client' };
  p.value.productivity[0] = { workflowId: wf.id, manualMinutesBefore: 720, spotCheckMinutesAutonomous: 30, loadedHourlyCost: 1800, currency: 'INR', productiveHoursPerFteMonth: 140 };
  p.acu = { method: 'weighted_resource', referenceValue: 1, referenceCurrency: 'INR', eligiblePools: ['LLM', 'ORCHESTRATION', 'RAG', 'DOCUMENT'], weightSetId: 'acu-std-v1' };
  p.pricing.streams = [
    { id: 's-impl', type: 'fixed_fee', label: 'Implementation fee', enabled: true, recovers: ['IMPLEMENTATION'], targetMarginPct: 32, discountPct: 0 },
    { id: 's-sub', type: 'subscription', label: 'Platform subscription', enabled: true, recovers: ['INFRASTRUCTURE', 'AGENTOPS', 'HUMAN_REVIEW', 'OTHER'], targetMarginPct: 30, discountPct: 0 },
    { id: 's-acu', type: 'acu', label: 'ACU consumption', enabled: true, recovers: ['LLM', 'ORCHESTRATION', 'RAG', 'DOCUMENT'], targetMarginPct: 40, discountPct: 0 },
  ];
  p.pricing.subscription = { includedUnit: 'acu', includedQty: 200000, includedDiscountPct: 5, overagePremiumPct: 15 };
  p.pricing.acuRateCard.tiers = [
    { fromUnits: 300000, discountPct: 5 },
    { fromUnits: 600000, discountPct: 10 },
  ];
  p.value.benefits = [
    { id: 'rfp-b1', name: 'Reduced external bid-writing agency spend', category: 'hard_savings', annualAmount: 24_000_000, currency: 'INR', startMonth: 2, rampMonths: 4, confidencePct: 85, status: 'finance_validated', validatedBy: 'M. Shah (Sales Finance)', validatedOn: '2026-09-10', scalesWithVolume: false },
    { id: 'rfp-b2', name: 'Avoided bid-team expansion (8 FTE)', category: 'cost_avoidance', annualAmount: 24_000_000, currency: 'INR', startMonth: 7, rampMonths: 6, confidencePct: 80, status: 'finance_validated', validatedBy: 'M. Shah (Sales Finance)', validatedOn: '2026-09-10', overlapGroup: 'rfp-capacity', scalesWithVolume: false },
    { id: 'rfp-b3', name: 'Bid-team capacity redeployed to strategic pursuits', category: 'capacity_conversion', annualAmount: 30_000_000, currency: 'INR', startMonth: 4, rampMonths: 6, confidencePct: 60, status: 'proposed', overlapGroup: 'rfp-capacity', scalesWithVolume: true },
    { id: 'rfp-b4', name: 'Win-rate uplift (contribution margin)', category: 'revenue', annualAmount: 30_000_000, currency: 'INR', startMonth: 6, rampMonths: 12, confidencePct: 50, status: 'proposed', scalesWithVolume: false, notes: 'Not counted in validated ROI until a controlled win-rate comparison is agreed with Sales Finance.' },
  ];
  p.value.clientCosts = [{ id: 'rfp-cc1', name: 'Content curation & SME onboarding', type: 'one_time', amount: 1_200_000, currency: 'INR' }];
  p.value.kpis = [
    { id: 'rfp-k1', name: 'Response turnaround', unit: 'days', before: 12, after: 4, higherIsBetter: false },
    { id: 'rfp-k2', name: 'Bids submitted per month', unit: '#', before: 650, after: 1000, higherIsBetter: true },
  ];
  return p;
}

/** Deterministic illustrative actuals derived from the estimate with realistic variances. */
function addActuals(p: Project, catalog: Catalog, months: number, f: { vol: number[]; tok: number[]; non: number[]; acc: number[]; ben: number[] }): Project {
  const r = computeProject(p, catalog, { packages: false });
  const actuals: ActualRecord[] = [];
  for (let m = 1; m <= months; m++) {
    const row = r.months[m];
    const base = r.context.bases[m];
    const s = base.snapshot!;
    for (const wf of p.workflows) {
      const v = s.volumes[wf.id];
      const lines = s.llmLines.filter((l) => l.workflowId === wf.id);
      const inTok = lines.reduce((a, l) => a + l.inputTokens.toNumber(), 0);
      const outTok = lines.reduce((a, l) => a + l.outputTokens.plus(l.reasoningTokens).toNumber(), 0);
      const llm = s.llm.byWorkflow[wf.id].toNumber();
      const total = s.runCostByWorkflow[wf.id].toNumber();
      const share = s.totalRunCost.isZero() ? 0 : total / s.totalRunCost.toNumber();
      const i = m - 1;
      actuals.push({
        period: row.period,
        monthIndex: m,
        workflowId: wf.id,
        attempted: Math.round(v.attempted.toNumber() * f.vol[i]),
        accepted: Math.round(v.accepted.toNumber() * f.vol[i] * f.acc[i]),
        inputTokens: Math.round(inTok * f.vol[i] * f.tok[i]),
        outputTokens: Math.round(outTok * f.vol[i] * f.tok[i]),
        llmCost: Math.round(llm * f.vol[i] * f.tok[i]),
        nonLlmCost: Math.round((total - llm) * f.non[i]),
        realizedBenefit: Math.round(row.validatedBenefit.toNumber() * share * f.ben[i]),
        currency: p.currency,
      });
    }
  }
  return { ...p, actuals };
}

export function sampleProjects(catalog: Catalog = defaultCatalog()): Project[] {
  const ap = addActuals(accountsPayable(catalog), catalog, 6, {
    vol: [0.94, 0.97, 1.01, 1.0, 1.03, 1.05],
    tok: [1.14, 1.11, 1.08, 1.06, 1.04, 1.03],
    non: [1.08, 1.06, 1.04, 1.03, 1.02, 1.01],
    acc: [0.97, 0.98, 0.99, 1.0, 1.0, 1.01],
    ben: [0.7, 0.8, 0.88, 0.94, 0.98, 1.02],
  });
  const cs = addActuals(customerService(catalog), catalog, 3, {
    vol: [1.06, 1.08, 1.1],
    tok: [1.18, 1.12, 1.09],
    non: [1.05, 1.04, 1.03],
    acc: [0.96, 0.98, 0.99],
    ben: [0.6, 0.75, 0.85],
  });
  return [ap, cs, rfpResponse(catalog)];
}
