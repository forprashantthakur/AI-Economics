/**
 * Shared builder context for the model workbook: a registry of named cell
 * positions (so sheets can reference each other in any build order) and small
 * writing helpers for inputs, formulas and Engine / Δ check columns.
 */
import type { Catalog, Decimal, ProjectResult } from '@aies/engine';
import { ABS, Book, quoteSheet, type Fmt, type Kind, type SheetModel, type Spec } from './book';
export type { Fmt };
import type { Scalar } from './formula';

export interface Pos {
  sheet: SheetModel;
  r: number;
  c: number;
  r2?: number;
  c2?: number;
}

export interface Sheets {
  readme: SheetModel;
  assumptions: SheetModel;
  impl: SheetModel;
  tok: SheetModel;
  abu: SheetModel;
  exec: SheetModel;
  acu: SheetModel;
  pricing: SheetModel;
  proj: SheetModel;
  value: SheetModel;
  checks: SheetModel;
}

export type Num = Decimal | number | { toNumber(): number };
export const num = (v: Num | null | undefined): number => (v === null || v === undefined ? 0 : typeof v === 'number' ? v : v.toNumber());

export class WB {
  readonly book: Book;
  readonly s: Sheets;
  readonly cur: string;
  private reg = new Map<string, Pos>();

  constructor(
    readonly r: ProjectResult,
    readonly cat: Catalog,
  ) {
    this.cur = r.currency;
    this.book = new Book(r.currency);
    const b = this.book;
    this.s = {
      readme: b.sheet('README'),
      assumptions: b.sheet('Assumptions'),
      impl: b.sheet('Implementation'),
      tok: b.sheet('LLM Tokenomics'),
      abu: b.sheet('ABU'),
      exec: b.sheet('Execution Costs'),
      acu: b.sheet('ACU'),
      pricing: b.sheet('Pricing'),
      proj: b.sheet('Projection'),
      value: b.sheet('Value & ROI'),
      checks: b.sheet('Checks'),
    };
  }

  // ───────── registry ─────────

  put(key: string, sheet: SheetModel, r: number, c: number, r2?: number, c2?: number): void {
    this.reg.set(key, { sheet, r, c, r2, c2 });
  }

  has(key: string): boolean {
    return this.reg.has(key);
  }

  pos(key: string): Pos {
    const p = this.reg.get(key);
    if (!p) throw new Error(`Workbook reference "${key}" is not registered`);
    return p;
  }

  /** Absolute reference to a registered cell or range, sheet-qualified when used from another sheet. */
  at(key: string, from: SheetModel): string {
    const p = this.pos(key);
    const body = p.r2 !== undefined && p.c2 !== undefined ? `${ABS(p.r, p.c)}:${ABS(p.r2, p.c2)}` : ABS(p.r, p.c);
    return p.sheet === from ? body : `${quoteSheet(p.sheet.name)}!${body}`;
  }

  /** Reference to a cell on a sheet, qualified when used from another sheet. */
  cell(sheet: SheetModel, r: number, c: number, from: SheetModel): string {
    return sheet === from ? ABS(r, c) : `${quoteSheet(sheet.name)}!${ABS(r, c)}`;
  }

  range(sheet: SheetModel, r1: number, c1: number, r2: number, c2: number, from: SheetModel): string {
    const body = `${ABS(r1, c1)}:${ABS(r2, c2)}`;
    return sheet === from ? body : `${quoteSheet(sheet.name)}!${body}`;
  }

  // ───────── writing helpers ─────────

  title(sh: SheetModel, title: string, subtitle: string): void {
    sh.set(1, 1, { v: title, kind: 'title' });
    sh.set(2, 1, { v: subtitle, kind: 'subtitle' });
  }

  section(sh: SheetModel, r: number, text: string, span = 6): void {
    for (let c = 1; c <= span; c++) sh.set(r, c, c === 1 ? { v: text, kind: 'section' } : { v: null, kind: 'section' });
  }

  header(sh: SheetModel, r: number, c0: number, labels: string[]): void {
    labels.forEach((l, i) => sh.set(r, c0 + i, { v: l, kind: 'header', align: i === 0 && c0 === 1 ? 'left' : 'center' }));
  }

  label(sh: SheetModel, r: number, c: number, text: string, kind: Kind = 'label'): void {
    sh.set(r, c, { v: text, kind });
  }

  note(sh: SheetModel, r: number, c: number, text: string): void {
    sh.set(r, c, { v: text, kind: 'note' });
  }

  input(sh: SheetModel, r: number, c: number, v: Scalar | Num, fmt: Fmt = 'general', extra: Partial<Spec> = {}): void {
    const val = v !== null && typeof v === 'object' && 'toNumber' in (v as object) ? (v as { toNumber(): number }).toNumber() : (v as Scalar);
    sh.set(r, c, { v: val, kind: 'input', fmt, ...extra });
  }

  calc(sh: SheetModel, r: number, c: number, f: string | (() => string), fmt: Fmt = 'general', extra: Partial<Spec> = {}): void {
    sh.set(r, c, { f, kind: 'calc', fmt, ...extra });
  }

  total(sh: SheetModel, r: number, c: number, f: string | (() => string), fmt: Fmt = 'general'): void {
    sh.set(r, c, { f, kind: 'total', fmt });
  }

  /** Static engine value (presentation only; labelled as engine value). */
  engine(sh: SheetModel, r: number, c: number, v: Num | string | null, fmt: Fmt = 'general', note?: string): void {
    const val = typeof v === 'string' || v === null ? v : num(v);
    sh.set(r, c, { v: val, kind: 'engine', fmt, ...(note ? { note } : {}) });
  }

  /**
   * Write the engine value at (r, c+1) and a Δ check formula at (r, c+2) for the
   * formula cell at (r, c), and register the pair on the Checks sheet.
   */
  check(sh: SheetModel, r: number, c: number, engineValue: Num, area: string, label: string, fmt: Fmt = 'general'): void {
    const ev = num(engineValue);
    sh.set(r, c + 1, { v: ev, kind: 'engine', fmt });
    sh.set(r, c + 2, { f: `${ABS(r, c)}-${ABS(r, c + 1)}`.replace(/\$/g, ''), kind: 'delta', fmt: 'delta' });
    this.book.deltas.push([sh, r, c + 2]);
    this.book.check(sh, r, c, area, label, ev);
  }

  /** Register a formula cell for the Checks sheet without inline Engine / Δ columns. */
  checkOnly(sh: SheetModel, r: number, c: number, engineValue: Num, area: string, label: string): void {
    this.book.check(sh, r, c, area, label, num(engineValue));
  }
}

export interface ColDef {
  key: string;
  header: string;
  width?: number;
  /** Followed by Engine and Δ columns. */
  check?: boolean;
}

export interface Layout {
  col: Record<string, number>;
  last: number;
  write: (sh: SheetModel, w: WB, row: number) => void;
}

/** Allocate column numbers for a table; check columns reserve Engine and Δ columns to their right. */
export function layout(defs: ColDef[], start = 1): Layout {
  const col: Record<string, number> = {};
  const heads: { c: number; text: string; width?: number }[] = [];
  let c = start;
  for (const d of defs) {
    col[d.key] = c;
    heads.push({ c, text: d.header, width: d.width });
    c++;
    if (d.check) {
      heads.push({ c, text: 'Engine', width: Math.max(10, (d.width ?? 12) - 1) });
      heads.push({ c: c + 1, text: 'Δ', width: 9 });
      c += 2;
    }
  }
  return {
    col,
    last: c - 1,
    write: (sh, w, row) => {
      for (const h of heads) {
        sh.set(row, h.c, { v: h.text, kind: 'header', align: h.c === start ? 'left' : 'center' });
        if (h.width && !sh.widths[h.c]) sh.width(h.c, h.width);
      }
    },
  };
}

export const RUN_POOL_KEYS = ['LLM', 'ORCHESTRATION', 'RAG', 'DOCUMENT', 'INFRASTRUCTURE', 'AGENTOPS', 'HUMAN_REVIEW', 'OTHER'] as const;
