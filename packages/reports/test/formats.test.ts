import { describe, expect, it } from 'vitest';
import ExcelJS from 'exceljs';
import { REPORTS, buildPdf, buildPptx, buildXlsx } from '../src';
import { buildModelBook } from '../src/xlsx';
import { XlError } from '../src/xlsx/formula';
import { latin1, samples, zipEntries } from './helpers';

const { catalog, samples: S } = samples();

async function openXlsx(bytes: Uint8Array): Promise<ExcelJS.Workbook> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(bytes as unknown as ArrayBuffer);
  return wb;
}

const formulaOf = (cell: ExcelJS.Cell): string | undefined => {
  const v = cell.value as unknown;
  return v && typeof v === 'object' && 'formula' in (v as object) ? (v as { formula: string }).formula : undefined;
};

describe('PDF', () => {
  for (const s of S)
    it(`renders all eight reports for ${s.result.project.name}`, async () => {
      for (const rep of REPORTS) {
        const bytes = await buildPdf(s.result, catalog, rep.id, { generatedBy: 'Tester' });
        expect(bytes).toBeInstanceOf(Uint8Array);
        expect(bytes.byteLength).toBeGreaterThan(10_000);
        const head = latin1(bytes, 8);
        expect(head.startsWith('%PDF-')).toBe(true);
        expect(latin1(bytes.subarray(bytes.length - 64))).toContain('%%EOF');
        // Embedded font so the rupee sign renders.
        expect(latin1(bytes)).toContain('AIESSans');
      }
    });
});

describe('PowerPoint', () => {
  for (const s of S)
    it(`renders all eight reports for ${s.result.project.name}`, async () => {
      for (const rep of REPORTS) {
        const bytes = await buildPptx(s.result, catalog, rep.id, { generatedBy: 'Tester' });
        expect(bytes).toBeInstanceOf(Uint8Array);
        expect(latin1(bytes, 2)).toBe('PK');
        const names = zipEntries(bytes);
        const slides = names.filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n));
        expect(slides.length).toBeGreaterThanOrEqual(3);
        expect(names).toContain('ppt/presentation.xml');
        expect(names.some((n) => n.startsWith('ppt/slideMasters/'))).toBe(true);
        // Native, editable charts (not images) for reports that have charts.
        expect(names.some((n) => /^ppt\/charts\/chart\d+\.xml$/.test(n))).toBe(true);
      }
    });
});

describe('Excel model', () => {
  for (const s of S)
    describe(s.result.project.name, () => {
      it('re-opens with exceljs, keeps formulas and the focus sheet', async () => {
        const bytes = await buildXlsx(s.result, catalog, { focus: 'abu-pricing', generatedBy: 'Tester' });
        expect(latin1(bytes, 2)).toBe('PK');
        const wb = await openXlsx(bytes);
        const names = wb.worksheets.map((w) => w.name);
        expect(names).toEqual(['README', 'Assumptions', 'Implementation', 'LLM Tokenomics', 'ABU', 'Execution Costs', 'ACU', 'Pricing', 'Projection', 'Value & ROI', 'Checks']);
        expect(wb.views[0].activeTab).toBe(names.indexOf('ABU'));

        let formulas = 0;
        wb.eachSheet((ws) => ws.eachRow((row) => row.eachCell((c) => (formulaOf(c) ? formulas++ : 0))));
        expect(formulas).toBeGreaterThan(3000);

        // Key calculations are formulas with defined-name inputs.
        const defined = wb.definedNames.model.map((d) => d.name);
        for (const n of ['TermMonths', 'ImplCost', 'ImplPrice', 'RunCost', 'WeightedAbus', 'AcuTotal', 'TCV', 'ClientRoi', 'ClientNpv']) expect(defined).toContain(n);
        const at = (name: string) => {
          const d = wb.definedNames.model.find((x) => x.name === name)!;
          const [sheet, ref] = d.ranges[0].split('!');
          return wb.getWorksheet(sheet.replace(/^'|'$/g, '').replace(/''/g, "'"))!.getCell(ref.replace(/\$/g, ''));
        };
        expect(formulaOf(at('ImplPrice'))).toMatch(/ImplCPM|ImplTM/);
        expect(formulaOf(at('TCV'))).toBe('SUM(PrjRev)');
        expect(formulaOf(at('ClientRoi'))).toMatch(/NetBenefit\/ClientInvestment/);
        expect(formulaOf(at('RunCost'))).toMatch(/^SUM\(/);
        // Cached results equal the engine.
        const res = (c: ExcelJS.Cell) => (c.value as { result?: number }).result;
        expect(res(at('TCV'))).toBeCloseTo(s.result.economics.provider.tcv.toNumber(), 2);
        expect(res(at('ImplPrice'))).toBeCloseTo(s.result.implementation.price.toNumber(), 2);
        expect(res(at('RunCost'))).toBeCloseTo(s.result.baseline.totalRunCost.toNumber(), 4);
      });

      it('every formula evaluates and every check matches the engine within 0.01%', () => {
        const w = buildModelBook(s.result, catalog);
        const b = w.book;
        let errors = 0;
        for (const sh of b.sheets)
          for (const [k, spec] of sh.cells)
            if (spec.f !== undefined) {
              const [r, c] = k.split(',').map(Number);
              if (b.value(sh.name, r, c) instanceof XlError) errors++;
            }
        expect(errors).toBe(0);
        expect(b.checks.length).toBeGreaterThan(300);
        for (const c of b.checks) {
          const v = b.value(c.sheet, c.row, c.col);
          if (typeof c.engine === 'string') {
            expect(v === '' || v === null).toBe(true);
            continue;
          }
          expect(typeof v).toBe('number');
          const d = Math.abs((v as number) - c.engine);
          if (!(d <= Math.max(1e-6, Math.abs(c.engine) * 1e-4))) throw new Error(`${c.sheet}!${c.address} ${c.label}: workbook ${v} vs engine ${c.engine}`);
        }
      });

      it('every focus value builds', async () => {
        for (const rep of REPORTS) {
          const bytes = await buildXlsx(s.result, catalog, { focus: rep.id });
          expect(bytes.byteLength).toBeGreaterThan(50_000);
        }
      }, 60_000);
    });
});
