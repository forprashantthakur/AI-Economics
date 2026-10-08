import type { Catalog, ProjectResult } from '@aies/engine';
import type { ReportId, ReportModel, ReportSection } from './types';
import { REPORTS } from './types';
import { periodLabel } from './format';
import { disclaimerText, reportTitle } from './util';
import { ctx, type Ctx } from './content/common';
import { costEstimate } from './content/cost';
import { acuRateCard } from './content/acu';
import { abuPricing } from './content/abu';
import { commercialProposal } from './content/commercial';
import { finopsAssessment } from './content/finops';
import { valueBusinessCase } from './content/value';
import { threeYearProjection } from './content/projection';
import { executiveDashboard } from './content/executive';

const BUILDERS: Record<ReportId, (x: Ctx) => ReportSection[]> = {
  'cost-estimate': costEstimate,
  'acu-rate-card': acuRateCard,
  'abu-pricing': abuPricing,
  'commercial-proposal': commercialProposal,
  'finops-assessment': finopsAssessment,
  'value-business-case': valueBusinessCase,
  'three-year-projection': threeYearProjection,
  'executive-dashboard': executiveDashboard,
};

/**
 * Renderer-agnostic report content. Every number is read from the engine's
 * ProjectResult (formatting only), so the web preview, PDF and PowerPoint agree.
 */
export function reportModel(result: ProjectResult, catalog: Catalog, report: ReportId, opts: { generatedBy?: string; now?: Date } = {}): ReportModel {
  if (!REPORTS.some((r) => r.id === report)) throw new Error(`Unknown report "${report}"`);
  const x = ctx(result, catalog);
  const p = result.project;
  const now = opts.now ?? new Date();
  const model: ReportModel = {
    id: report,
    title: reportTitle(report),
    subtitle: `${p.client.businessFunction}, ${p.client.businessProcess}. Go-live ${periodLabel(p.goLiveDate)}, ${p.pricing.termMonths}-month term.`,
    projectName: p.name,
    clientName: p.client.clientName,
    currency: result.currency,
    generatedAt: now.toISOString(),
    disclaimer: disclaimerText(result, catalog),
    sections: BUILDERS[report](x),
  };
  if (opts.generatedBy) model.generatedBy = opts.generatedBy;
  return model;
}
