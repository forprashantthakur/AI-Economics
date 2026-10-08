/**
 * In-memory workbook model. Sheets are built as cell specs (value or formula +
 * presentation), every formula is evaluated with the bundled evaluator to give
 * a correct cached result, and the model is then emitted through exceljs.
 */
import type ExcelJS from 'exceljs';
import { Arr, XlError, evaluateFormula, parseName, type EvalHost, type RefNode, type Scalar } from './formula';
import { PALETTE } from '../types';
import { symbol } from '../format';

export type Kind = 'title' | 'subtitle' | 'section' | 'header' | 'label' | 'input' | 'calc' | 'engine' | 'delta' | 'total' | 'note' | 'text' | 'muted';
export type Fmt = 'money' | 'money2' | 'unit' | 'count' | 'count2' | 'dec2' | 'dec4' | 'pct' | 'factor' | 'int' | 'delta' | 'text' | 'general';

export interface Spec {
  v?: Scalar;
  /** Formula text, or a thunk resolved after every sheet is laid out (for forward references). */
  f?: string | (() => string);
  kind?: Kind;
  fmt?: Fmt;
  note?: string;
  wrap?: boolean;
  align?: 'left' | 'right' | 'center';
  list?: string[];
}

export interface Check {
  sheet: string;
  address: string;
  row: number;
  col: number;
  area: string;
  label: string;
  engine: number | string;
}

export function colName(c: number): string {
  let s = '';
  let n = c;
  while (n > 0) {
    const m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

export const A1 = (r: number, c: number): string => `${colName(c)}${r}`;
export const ABS = (r: number, c: number): string => `$${colName(c)}$${r}`;

export function quoteSheet(name: string): string {
  return /^[A-Za-z0-9_]+$/.test(name) ? name : `'${name.replace(/'/g, "''")}'`;
}

export class SheetModel {
  readonly cells = new Map<string, Spec>();
  widths: Record<number, number> = {};
  freeze: { row: number; col: number } | null = null;
  merges: string[] = [];
  maxRow = 0;
  maxCol = 0;
  tab = PALETTE.brand;

  constructor(
    readonly name: string,
    readonly book: Book,
  ) {}

  set(r: number, c: number, spec: Spec | Scalar): void {
    const s: Spec = spec !== null && typeof spec === 'object' && !(spec instanceof XlError) && !(spec instanceof Arr) ? { ...(spec as Spec) } : { v: spec as Scalar };
    if (typeof s.f === 'string' && s.f.startsWith('=')) s.f = s.f.slice(1);
    this.cells.set(`${r},${c}`, s);
    this.maxRow = Math.max(this.maxRow, r);
    this.maxCol = Math.max(this.maxCol, c);
  }

  get(r: number, c: number): Spec | undefined {
    return this.cells.get(`${r},${c}`);
  }

  /** Absolute reference to a cell on this sheet, qualified when used from another sheet. */
  ref(r: number, c: number, from?: SheetModel): string {
    return from === this ? ABS(r, c) : `${quoteSheet(this.name)}!${ABS(r, c)}`;
  }

  range(r1: number, c1: number, r2: number, c2: number, from?: SheetModel): string {
    const body = `${ABS(r1, c1)}:${ABS(r2, c2)}`;
    return from === this ? body : `${quoteSheet(this.name)}!${body}`;
  }

  width(c: number, w: number): void {
    this.widths[c] = w;
  }
}

export class Book {
  readonly sheets: SheetModel[] = [];
  readonly names = new Map<string, { sheet: SheetModel; r1: number; c1: number; r2: number; c2: number }>();
  readonly checks: Check[] = [];
  /** [sheet, deltaRow, deltaCol] for inline Δ cells (engine value sits immediately to the left). */
  readonly deltas: [SheetModel, number, number][] = [];
  private results = new Map<string, Scalar>();
  private evaluating = new Set<string>();

  constructor(readonly currency: string) {}

  sheet(name: string): SheetModel {
    const s = new SheetModel(name, this);
    this.sheets.push(s);
    return s;
  }

  byName(name: string): SheetModel | undefined {
    return this.sheets.find((s) => s.name === name);
  }

  define(name: string, sheet: SheetModel, r1: number, c1: number, r2 = r1, c2 = c1): string {
    this.names.set(name, { sheet, r1, c1, r2, c2 });
    return name;
  }

  check(sheet: SheetModel, r: number, c: number, area: string, label: string, engine: number | string): void {
    this.checks.push({ sheet: sheet.name, address: A1(r, c), row: r, col: c, area, label, engine });
  }

  // ───────────── evaluation ─────────────

  private host: EvalHost = {
    cell: (sheet, r, c) => this.value(sheet, r, c),
    name: (n) => {
      const d = this.names.get(n);
      if (!d) return undefined;
      const node: RefNode = { k: 'ref', sheet: d.sheet.name, r1: d.r1, c1: d.c1, r2: d.r2, c2: d.c2 };
      return node;
    },
  };

  value(sheetName: string, r: number, c: number): Scalar {
    const key = `${sheetName}!${r},${c}`;
    if (this.results.has(key)) return this.results.get(key)!;
    const sh = this.byName(sheetName);
    if (!sh) return new XlError('#REF!');
    const spec = sh.get(r, c);
    if (!spec) return null;
    if (spec.f === undefined) return spec.v ?? null;
    if (typeof spec.f !== 'string') throw new Error(`Unresolved formula at ${sheetName}!${A1(r, c)}`);
    if (this.evaluating.has(key)) throw new Error(`Circular reference at ${sheetName}!${A1(r, c)}`);
    this.evaluating.add(key);
    let v: Scalar;
    try {
      v = evaluateFormula(spec.f, sheetName, this.host);
    } catch (e) {
      throw new Error(`Formula error at ${sheetName}!${A1(r, c)} (=${spec.f}): ${(e as Error).message}`);
    }
    this.evaluating.delete(key);
    this.results.set(key, v);
    return v;
  }

  /** Resolve deferred formulas (thunks) once every sheet has been laid out. */
  resolve(): void {
    for (const sh of this.sheets)
      for (const s of sh.cells.values())
        if (typeof s.f === 'function') {
          const f = s.f();
          s.f = f.startsWith('=') ? f.slice(1) : f;
        }
  }

  evaluateAll(): void {
    this.resolve();
    for (const sh of this.sheets) for (const [k, s] of sh.cells) if (s.f !== undefined) {
      const [r, c] = k.split(',').map(Number);
      this.value(sh.name, r, c);
    }
  }

  numberAt(sheetName: string, r: number, c: number): number {
    const v = this.value(sheetName, r, c);
    return typeof v === 'number' ? v : NaN;
  }

  // ───────────── emission ─────────────

  emit(wb: ExcelJS.Workbook): void {
    this.evaluateAll();
    const styles = new StyleCache(this.currency);
    for (const sh of this.sheets) {
      const ws = wb.addWorksheet(sh.name, {
        properties: { tabColor: { argb: `FF${sh.tab}` } },
        views: [sh.freeze ? { state: 'frozen', xSplit: sh.freeze.col, ySplit: sh.freeze.row, showGridLines: false } : { showGridLines: false }],
        pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0, paperSize: 9 },
      });
      for (const [c, w] of Object.entries(sh.widths)) ws.getColumn(Number(c)).width = w;
      for (const [k, s] of sh.cells) {
        const [r, c] = k.split(',').map(Number);
        const cell = ws.getCell(r, c);
        if (typeof s.f === 'string') {
          const res = this.results.get(`${sh.name}!${r},${c}`);
          cell.value = { formula: s.f, result: toResult(res) } as ExcelJS.CellFormulaValue;
        } else if (s.v !== undefined && s.v !== null) {
          cell.value = s.v instanceof XlError ? ({ error: s.v.code } as ExcelJS.CellErrorValue) : (s.v as string | number | boolean);
        }
        cell.style = styles.get(s);
        if (s.note) cell.note = s.note;
        if (s.list) cell.dataValidation = { type: 'list', allowBlank: true, formulae: [`"${s.list.join(',')}"`] };
      }
      for (const m of sh.merges) ws.mergeCells(m);
    }
    // Highlight inline Δ cells that exceed the 0.01% tolerance (engine value is the cell to the left).
    const bySheet = new Map<SheetModel, [number, number][]>();
    for (const [sh, r, c] of this.deltas) bySheet.set(sh, [...(bySheet.get(sh) ?? []), [r, c]]);
    for (const [sh, cells] of bySheet) {
      const ws = wb.getWorksheet(sh.name)!;
      const byCol = new Map<number, number[]>();
      for (const [r, c] of cells) byCol.set(c, [...(byCol.get(c) ?? []), r]);
      for (const [c, rows] of byCol) {
        rows.sort((a, b) => a - b);
        let start = rows[0];
        let prev = rows[0];
        const flush = (s: number, e: number) => {
          ws.addConditionalFormatting({
            ref: `${A1(s, c)}:${A1(e, c)}`,
            rules: [
              {
                type: 'expression',
                priority: 1,
                formulae: [`AND(ISNUMBER(${A1(s, c)}),ABS(${A1(s, c)})>MAX(0.000001,ABS(${A1(s, c - 1)})*0.0001))`],
                style: { fill: { type: 'pattern', pattern: 'solid', bgColor: { argb: 'FFFDE2E1' } }, font: { color: { argb: `FF${PALETTE.bad}` }, bold: true } },
              },
            ],
          });
        };
        for (const r of rows.slice(1)) {
          if (r !== prev + 1) {
            flush(start, prev);
            start = r;
          }
          prev = r;
        }
        flush(start, prev);
      }
    }
    for (const [name, d] of this.names) {
      const loc = d.r1 === d.r2 && d.c1 === d.c2 ? `${quoteSheet(d.sheet.name)}!${ABS(d.r1, d.c1)}` : `${quoteSheet(d.sheet.name)}!${ABS(d.r1, d.c1)}:${ABS(d.r2, d.c2)}`;
      wb.definedNames.add(loc, name);
    }
  }
}

function toResult(v: Scalar | undefined): ExcelJS.CellFormulaValue['result'] {
  if (v === undefined || v === null) return '';
  if (v instanceof XlError) return { error: v.code } as ExcelJS.CellErrorValue;
  return v as number | string | boolean;
}

// ───────────── styles ─────────────

const FONT = 'Calibri';

class StyleCache {
  private cache = new Map<string, Partial<ExcelJS.Style>>();
  constructor(private readonly cur: string) {}

  numFmt(f: Fmt | undefined): string | undefined {
    const s = symbol(this.cur).replace(/"/g, '');
    const q = `"${s}"`;
    switch (f) {
      case 'money':
        return `${q}#,##0;-${q}#,##0`;
      case 'money2':
        return `${q}#,##0.00;-${q}#,##0.00`;
      case 'unit':
        return `${q}#,##0.0000;-${q}#,##0.0000`;
      case 'count':
        return '#,##0';
      case 'count2':
        return '#,##0.00';
      case 'dec2':
        return '#,##0.00';
      case 'dec4':
        return '#,##0.0000';
      case 'pct':
        return '0.00"%"';
      case 'factor':
        return '0.000000';
      case 'int':
        return '0';
      case 'delta':
        return '#,##0.000000;-#,##0.000000;0';
      case 'text':
        return '@';
      default:
        return undefined;
    }
  }

  get(s: Spec): Partial<ExcelJS.Style> {
    const key = `${s.kind ?? ''}|${s.fmt ?? ''}|${s.wrap ? 1 : 0}|${s.align ?? ''}`;
    const hit = this.cache.get(key);
    if (hit) return hit;
    const ink = `FF${PALETTE.ink}`;
    const line = { style: 'thin' as const, color: { argb: `FF${PALETTE.line}` } };
    const st: Partial<ExcelJS.Style> = { font: { name: FONT, size: 10, color: { argb: ink } } };
    const nf = this.numFmt(s.fmt);
    if (nf) st.numFmt = nf;
    const fill = (hex: string): ExcelJS.Fill => ({ type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${hex}` } });
    switch (s.kind) {
      case 'title':
        st.font = { name: FONT, size: 16, bold: true, color: { argb: `FF${PALETTE.brand}` } };
        break;
      case 'subtitle':
        st.font = { name: FONT, size: 10, color: { argb: `FF${PALETTE.ink2}` } };
        break;
      case 'section':
        st.font = { name: FONT, size: 12, bold: true, color: { argb: ink } };
        st.border = { bottom: { style: 'medium', color: { argb: `FF${PALETTE.brand}` } } };
        break;
      case 'header':
        st.font = { name: FONT, size: 10, bold: true, color: { argb: 'FFFFFFFF' } };
        st.fill = fill(PALETTE.brand);
        st.alignment = { vertical: 'middle', wrapText: true, horizontal: s.align ?? 'center' };
        st.border = { bottom: line, right: { style: 'thin', color: { argb: 'FF2E8A6B' } } };
        break;
      case 'label':
        st.border = { bottom: line };
        break;
      case 'input':
        st.font = { name: FONT, size: 10, color: { argb: 'FF1F4E9E' } };
        st.fill = fill(PALETTE.brandTint);
        st.border = { bottom: line, top: line, left: line, right: line };
        break;
      case 'calc':
        st.border = { bottom: line };
        break;
      case 'engine':
        st.font = { name: FONT, size: 10, italic: true, color: { argb: `FF${PALETTE.ink3}` } };
        st.fill = fill(PALETTE.sunken);
        st.border = { bottom: line };
        break;
      case 'delta':
        st.font = { name: FONT, size: 9, color: { argb: `FF${PALETTE.ink3}` } };
        st.border = { bottom: line };
        break;
      case 'total':
        st.font = { name: FONT, size: 10, bold: true, color: { argb: ink } };
        st.border = { top: { style: 'thin', color: { argb: ink } }, bottom: { style: 'double', color: { argb: ink } } };
        break;
      case 'note':
        st.font = { name: FONT, size: 9, italic: true, color: { argb: `FF${PALETTE.ink2}` } };
        break;
      case 'muted':
        st.font = { name: FONT, size: 9, color: { argb: `FF${PALETTE.ink3}` } };
        break;
      default:
        break;
    }
    if (s.wrap || s.align) st.alignment = { ...(st.alignment ?? {}), ...(s.wrap ? { wrapText: true, vertical: 'top' as const } : {}), ...(s.align && s.kind !== 'header' ? { horizontal: s.align } : {}) };
    this.cache.set(key, st);
    return st;
  }
}

export { parseName };
