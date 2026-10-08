/**
 * Renderer-agnostic report content. The web preview, the PDF and the PowerPoint
 * renderers all draw the same ReportModel, so the three always agree.
 */

export type ReportId =
  | 'cost-estimate'
  | 'acu-rate-card'
  | 'abu-pricing'
  | 'commercial-proposal'
  | 'finops-assessment'
  | 'value-business-case'
  | 'three-year-projection'
  | 'executive-dashboard';

export const REPORTS: { id: ReportId; title: string; description: string }[] = [
  {
    id: 'cost-estimate',
    title: 'AI Project Cost Estimate',
    description: 'Scope and assumptions, implementation effort by phase and role, schedule, contingency, fixed price versus time and materials, and steady-state run cost by cost pool.',
  },
  {
    id: 'acu-rate-card',
    title: 'ACU Consumption & Rate Card',
    description: 'How an AI Consumption Unit is measured, the cost components it covers, ACUs per workflow, agent, transaction and ABU, cost and price per ACU, tiers, commitments and allowances.',
  },
  {
    id: 'abu-pricing',
    title: 'ABU Business Transaction Pricing',
    description: 'ABU definitions and acceptance criteria, the transaction funnel, complexity classes and weights, the cost-per-ABU build-up, failed-work allocation, class prices, tiers and minimums.',
  },
  {
    id: 'commercial-proposal',
    title: 'Commercial Proposal Summary',
    description: 'The recommended commercial model, what each revenue stream recovers, implementation and recurring fees, contract value, margin, the seven-construct comparison and billing integrity.',
  },
  {
    id: 'finops-assessment',
    title: 'AI FinOps Assessment',
    description: 'Consumption by model, agent and workflow, tokens and caching, unit costs, estimate-versus-actual variance and quantified optimisation opportunities.',
  },
  {
    id: 'value-business-case',
    title: 'AI Value Realization Business Case',
    description: 'Productivity (non-cash) kept separate from validated financial benefits, the benefit register, client investment, ROI by year, payback, NPV, cost per outcome and outcome KPIs.',
  },
  {
    id: 'three-year-projection',
    title: 'Three-Year Financial Projection',
    description: 'Yearly and monthly revenue, cost, gross profit and margin, volumes, ACUs and ABUs, and the client investment, benefit and ROI over the contract term.',
  },
  {
    id: 'executive-dashboard',
    title: 'Executive Management Dashboard Report',
    description: 'Headline provider and client economics, key charts, top risks and the reconciliation status on one or two pages.',
  },
];

export interface ReportKpi {
  label: string;
  value: string;
  note?: string;
}

export interface ReportTable {
  columns: string[];
  rows: string[][];
  align?: ('left' | 'right')[];
  footer?: string[];
}

export interface ReportChart {
  kind: 'bar' | 'stacked-bar' | 'line';
  title: string;
  categories: string[];
  series: { name: string; values: number[] }[];
  valueFormat: 'currency' | 'number' | 'percent';
}

export interface ReportSection {
  heading: string;
  paragraphs?: string[];
  kpis?: ReportKpi[];
  table?: ReportTable;
  chart?: ReportChart;
}

export interface ReportModel {
  id: ReportId;
  title: string;
  subtitle: string;
  projectName: string;
  clientName: string;
  currency: string;
  generatedAt: string;
  generatedBy?: string;
  disclaimer: string;
  sections: ReportSection[];
}

export const PRODUCT_NAME = 'AI Economics Studio';

/** Brand palette shared by every renderer. */
export const PALETTE = {
  paper: 'FFFFFF',
  ink: '1E2422',
  ink2: '4A5551',
  ink3: '7A8580',
  line: 'D9DFDC',
  brand: '0B6E4F',
  brandTint: 'E6F2EC',
  sunken: 'F4F6F5',
  bad: 'B42318',
  series: ['2a78d6', 'eb6834', '1baf7a', 'eda100', 'e87ba4', '008300', '4a3aa7', 'e34948'],
};
