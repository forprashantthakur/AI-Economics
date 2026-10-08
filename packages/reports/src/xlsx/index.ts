import ExcelJS from 'exceljs';
import type { Catalog, ProjectResult } from '@aies/engine';
import type { ReportId } from '../types';
import { PRODUCT_NAME } from '../types';
import { toU8 } from '../util';
import { WB } from './ctx';
import { buildAssumptions } from './assumptions';
import { buildImplementation } from './implementation';
import { buildTokenomics } from './tokenomics';
import { buildAbu } from './abu-sheet';
import { buildExec } from './exec';
import { buildAcu } from './acu-sheet';
import { buildPricing } from './pricing-sheet';
import { buildProjection } from './projection-sheet';
import { buildValue } from './value-sheet';
import { buildChecks, buildReadme } from './readme';

/** Sheet that best matches each report (used for `focus`). */
const FOCUS: Record<ReportId, string> = {
  'cost-estimate': 'Implementation',
  'acu-rate-card': 'ACU',
  'abu-pricing': 'ABU',
  'commercial-proposal': 'Pricing',
  'finops-assessment': 'LLM Tokenomics',
  'value-business-case': 'Value & ROI',
  'three-year-projection': 'Projection',
  'executive-dashboard': 'README',
};

/** Build the formula model (no exceljs) — exposed for tests and the LibreOffice check. */
export function buildModelBook(result: ProjectResult, catalog: Catalog, opts: { generatedBy?: string; now?: Date } = {}): WB {
  const w = new WB(result, catalog);
  // Layout order matters only for registered positions used eagerly; deferred
  // formulas (thunks) resolve forward references after every sheet exists.
  buildAssumptions(w);
  buildImplementation(w);
  buildAbu(w);
  buildTokenomics(w);
  buildExec(w);
  buildAcu(w);
  buildPricing(w);
  buildProjection(w);
  buildValue(w);
  buildReadme(w, opts.generatedBy, opts.now);
  buildChecks(w);
  w.book.evaluateAll();
  return w;
}

export async function buildXlsx(result: ProjectResult, catalog: Catalog, opts: { focus?: ReportId; generatedBy?: string } = {}): Promise<Uint8Array> {
  const w = buildModelBook(result, catalog, opts);
  const wb = new ExcelJS.Workbook();
  wb.creator = opts.generatedBy ?? PRODUCT_NAME;
  wb.lastModifiedBy = opts.generatedBy ?? PRODUCT_NAME;
  wb.company = PRODUCT_NAME;
  wb.title = `${result.project.name} — financial model`;
  wb.subject = 'AI project economics model';
  wb.created = new Date();
  wb.modified = new Date();
  wb.calcProperties.fullCalcOnLoad = true;
  w.book.emit(wb);
  const focusName = opts.focus ? FOCUS[opts.focus] : 'README';
  const idx = Math.max(0, w.book.sheets.findIndex((s) => s.name === focusName));
  wb.views = [{ x: 0, y: 0, width: 24000, height: 15000, firstSheet: 0, activeTab: idx, visibility: 'visible' }];
  wb.worksheets.forEach((ws, i) => {
    const v = ws.views[0] ?? {};
    ws.views = [{ ...v, tabSelected: i === idx } as unknown as ExcelJS.WorksheetView];
  });
  const buf = await wb.xlsx.writeBuffer();
  return toU8(buf as ArrayBuffer);
}
