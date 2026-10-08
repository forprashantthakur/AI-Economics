/**
 * PDF renderer (jsPDF + jspdf-autotable): A4 portrait, cover block, section
 * headings, KPI grid, tables with right-aligned numbers, bar / stacked / line
 * charts drawn with jsPDF primitives, page numbers and a disclaimer footer.
 */
import { jsPDF } from 'jspdf';
import { autoTable } from 'jspdf-autotable';
import type { Catalog, ProjectResult } from '@aies/engine';
import type { ReportChart, ReportId, ReportModel, ReportSection } from './types';
import { PALETTE, PRODUCT_NAME } from './types';
import { reportModel } from './model';
import { axisLabel, chartScale, dateLabel } from './format';
import { axisFor, maxAbs } from './chart-geom';
import { FONT_BOLD, FONT_REGULAR } from './font-data';
import { toU8 } from './util';

const FONT = 'AIESSans';
const PAGE_W = 210;
const PAGE_H = 297;
const M = 16; // side margin (mm)
const TOP = 18;
const BOTTOM = 25;
const CW = PAGE_W - 2 * M;

type RGB = [number, number, number];
const rgb = (hex: string): RGB => [parseInt(hex.slice(0, 2), 16), parseInt(hex.slice(2, 4), 16), parseInt(hex.slice(4, 6), 16)];
const INK = rgb(PALETTE.ink);
const INK2 = rgb(PALETTE.ink2);
const INK3 = rgb(PALETTE.ink3);
const LINE = rgb(PALETTE.line);
const BRAND = rgb(PALETTE.brand);
const TINT = rgb(PALETTE.brandTint);
const SUNKEN = rgb(PALETTE.sunken);
const SERIES = PALETTE.series.map(rgb);

class Writer {
  y = TOP;
  constructor(
    readonly doc: jsPDF,
    readonly model: ReportModel,
  ) {}

  font(size: number, bold = false, color: RGB = INK): void {
    this.doc.setFont(FONT, bold ? 'bold' : 'normal');
    this.doc.setFontSize(size);
    this.doc.setTextColor(...color);
  }

  /** Ensure `h` mm fit on the page; otherwise start a new page. */
  need(h: number): void {
    if (this.y + h > PAGE_H - BOTTOM) this.newPage();
  }

  newPage(): void {
    this.doc.addPage();
    this.y = TOP;
  }

  lineH(size: number): number {
    return size * 0.3528 * 1.3;
  }

  text(t: string, size = 9.5, opts: { bold?: boolean; color?: RGB; gap?: number; width?: number; x?: number } = {}): void {
    this.font(size, opts.bold, opts.color ?? INK);
    const lines = this.doc.splitTextToSize(t, opts.width ?? CW) as string[];
    const lh = this.lineH(size);
    for (const l of lines) {
      this.need(lh);
      this.doc.text(l, opts.x ?? M, this.y + lh * 0.75);
      this.y += lh;
    }
    this.y += opts.gap ?? 1.5;
  }
}

function cover(w: Writer): void {
  const { doc, model } = w;
  doc.setFillColor(...BRAND);
  doc.rect(0, 0, PAGE_W, 4, 'F');
  w.y = 14;
  w.font(9, true, BRAND);
  doc.text(PRODUCT_NAME, M, w.y);
  w.y += 9;
  w.font(21, true, INK);
  const title = doc.splitTextToSize(model.title, CW) as string[];
  for (const l of title) {
    doc.text(l, M, w.y);
    w.y += 8.5;
  }
  w.y += 1;
  w.font(12, false, INK2);
  doc.text(doc.splitTextToSize(`${model.projectName} — ${model.clientName}`, CW) as string[], M, w.y);
  w.y += 6.5;
  w.font(9, false, INK3);
  const meta = `${model.subtitle} Currency ${model.currency}. Generated ${dateLabel(model.generatedAt)}${model.generatedBy ? ` by ${model.generatedBy}` : ''}.`;
  const metaLines = doc.splitTextToSize(meta, CW) as string[];
  doc.text(metaLines, M, w.y);
  w.y += metaLines.length * w.lineH(9) + 3;
  doc.setDrawColor(...LINE);
  doc.setLineWidth(0.3);
  doc.line(M, w.y, PAGE_W - M, w.y);
  w.y += 6;
}

function heading(w: Writer, s: string): void {
  w.need(18);
  w.y += 2;
  w.font(13, true, INK);
  w.doc.text(s, M, w.y + 4.5);
  w.y += 7;
  w.doc.setDrawColor(...BRAND);
  w.doc.setLineWidth(0.6);
  w.doc.line(M, w.y, M + 14, w.y);
  w.y += 4;
}

function kpiGrid(w: Writer, kpis: NonNullable<ReportSection['kpis']>): void {
  const cols = kpis.length >= 6 ? 3 : kpis.length === 4 ? 2 : Math.min(3, kpis.length);
  const gap = 3;
  const cellW = (CW - gap * (cols - 1)) / cols;
  const cellH = 17;
  for (let i = 0; i < kpis.length; i += cols) {
    w.need(cellH + gap);
    const row = kpis.slice(i, i + cols);
    row.forEach((k, j) => {
      const x = M + j * (cellW + gap);
      w.doc.setFillColor(...SUNKEN);
      w.doc.setDrawColor(...LINE);
      w.doc.setLineWidth(0.2);
      w.doc.rect(x, w.y, cellW, cellH, 'FD');
      w.doc.setFillColor(...BRAND);
      w.doc.rect(x, w.y, 0.9, cellH, 'F');
      w.font(7.5, false, INK2);
      w.doc.text(w.doc.splitTextToSize(k.label, cellW - 6)[0] as string, x + 3.5, w.y + 4.6);
      w.font(13, true, INK);
      w.doc.text(w.doc.splitTextToSize(k.value, cellW - 6)[0] as string, x + 3.5, w.y + 10.6);
      if (k.note) {
        w.font(6.8, false, INK3);
        w.doc.text(w.doc.splitTextToSize(k.note, cellW - 6)[0] as string, x + 3.5, w.y + 14.6);
      }
    });
    w.y += cellH + gap;
  }
  w.y += 1;
}

function table(w: Writer, t: NonNullable<ReportSection['table']>): void {
  const n = t.columns.length;
  const fontSize = n >= 10 ? 6.4 : n >= 8 ? 7 : n >= 6 ? 7.6 : 8.4;
  const align = t.align ?? t.columns.map((_, i) => (i === 0 ? 'left' : 'right'));
  const colStyles: Record<number, { halign: 'left' | 'right'; cellWidth?: 'auto' | 'wrap' | number }> = {};
  align.forEach((a, i) => (colStyles[i] = { halign: a }));
  w.need(16);
  autoTable(w.doc, {
    startY: w.y,
    margin: { left: M, right: M, top: TOP, bottom: BOTTOM },
    head: [t.columns],
    body: t.rows,
    foot: t.footer ? [t.footer] : undefined,
    showFoot: 'lastPage',
    theme: 'plain',
    styles: { font: FONT, fontSize, textColor: INK, cellPadding: { top: 1.3, bottom: 1.3, left: 1.6, right: 1.6 }, lineColor: LINE, lineWidth: { bottom: 0.15 }, overflow: 'linebreak', valign: 'top' },
    headStyles: { font: FONT, fontStyle: 'bold', fillColor: BRAND, textColor: [255, 255, 255], lineWidth: 0 },
    footStyles: { font: FONT, fontStyle: 'bold', fillColor: TINT, textColor: INK, lineWidth: { top: 0.3 }, lineColor: INK },
    alternateRowStyles: { fillColor: [250, 251, 250] },
    columnStyles: colStyles,
    didParseCell: (d) => {
      if (d.section === 'head' || d.section === 'foot') d.cell.styles.halign = align[d.column.index] ?? 'left';
    },
  });
  const last = (w.doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable;
  w.y = (last?.finalY ?? w.y) + 4;
}

function chart(w: Writer, c: ReportChart): void {
  const H = 62;
  w.need(H + 14);
  const { doc } = w;
  const cur = w.model.currency;
  w.font(9, true, INK);
  doc.text(c.title, M, w.y + 3.5);
  w.y += 6;
  // legend
  if (c.series.length > 1) {
    let lx = M;
    w.font(7.2, false, INK2);
    c.series.forEach((s, i) => {
      const color = SERIES[i % SERIES.length];
      doc.setFillColor(...color);
      doc.rect(lx, w.y + 0.6, 2.6, 2.6, 'F');
      doc.text(s.name, lx + 3.6, w.y + 2.9);
      lx += 3.6 + doc.getTextWidth(s.name) + 5;
    });
    w.y += 5;
  }
  const axis = axisFor(c);
  const scale = chartScale(maxAbs(c), c.valueFormat, cur);
  const labels = axis.ticks.map((t) => axisLabel(t, scale, c.valueFormat, cur));
  w.font(6.8, false, INK3);
  const labelW = Math.max(...labels.map((l) => doc.getTextWidth(l))) + 2.5;
  const x0 = M + labelW;
  const x1 = PAGE_W - M;
  const top = w.y + 2;
  const bottom = top + H - 14;
  const yOf = (v: number) => bottom - ((v - axis.min) / (axis.max - axis.min || 1)) * (bottom - top);
  // gridlines
  doc.setLineWidth(0.15);
  axis.ticks.forEach((t, i) => {
    const y = yOf(t);
    doc.setDrawColor(...(t === 0 ? INK3 : LINE));
    doc.line(x0, y, x1, y);
    doc.text(labels[i], x0 - 1.5, y + 1.1, { align: 'right' });
  });
  const n = c.categories.length;
  const band = (x1 - x0) / Math.max(1, n);
  const zero = yOf(Math.max(axis.min, Math.min(0, axis.max)));
  if (c.kind === 'line') {
    c.series.forEach((s, si) => {
      const color = SERIES[si % SERIES.length];
      doc.setDrawColor(...color);
      doc.setLineWidth(0.6);
      let prev: [number, number] | null = null;
      s.values.forEach((v, i) => {
        if (!Number.isFinite(v)) return;
        const pt: [number, number] = [x0 + band * (i + 0.5), yOf(v)];
        if (prev) doc.line(prev[0], prev[1], pt[0], pt[1]);
        prev = pt;
      });
      if (n <= 24) {
        doc.setFillColor(...color);
        s.values.forEach((v, i) => Number.isFinite(v) && doc.circle(x0 + band * (i + 0.5), yOf(v), 0.55, 'F'));
      }
    });
  } else if (c.kind === 'stacked-bar') {
    const bw = Math.min(16, band * 0.6);
    c.categories.forEach((_, i) => {
      let pos = 0;
      let neg = 0;
      c.series.forEach((s, si) => {
        const v = s.values[i] ?? 0;
        if (!v) return;
        const from = v >= 0 ? pos : neg;
        const to = from + v;
        if (v >= 0) pos = to;
        else neg = to;
        doc.setFillColor(...SERIES[si % SERIES.length]);
        const ya = yOf(from);
        const yb = yOf(to);
        doc.rect(x0 + band * i + (band - bw) / 2, Math.min(ya, yb), bw, Math.max(0.2, Math.abs(yb - ya)), 'F');
      });
    });
  } else {
    const k = c.series.length;
    const groupW = Math.min(band * 0.72, 10 * k + 2);
    const bw = groupW / k;
    c.series.forEach((s, si) => {
      doc.setFillColor(...SERIES[si % SERIES.length]);
      s.values.forEach((v, i) => {
        if (!Number.isFinite(v) || v === 0) return;
        const y = yOf(v);
        const x = x0 + band * i + (band - groupW) / 2 + si * bw;
        doc.rect(x + 0.2, Math.min(y, zero), Math.max(0.3, bw - 0.4), Math.max(0.2, Math.abs(zero - y)), 'F');
      });
    });
  }
  // category labels
  w.font(6.6, false, INK2);
  const every = Math.max(1, Math.ceil(n / Math.max(1, Math.floor((x1 - x0) / 13))));
  c.categories.forEach((cat, i) => {
    if (i % every !== 0) return;
    const lines = doc.splitTextToSize(cat, Math.max(band * every - 1, 10)) as string[];
    doc.text(lines.slice(0, 2), x0 + band * (i + 0.5), bottom + 3.2, { align: 'center' });
  });
  w.y = bottom + 11;
}

function sectionBlock(w: Writer, s: ReportSection): void {
  heading(w, s.heading);
  for (const p of s.paragraphs ?? []) w.text(p, 9.2, { color: INK, gap: 2 });
  if (s.kpis?.length) kpiGrid(w, s.kpis);
  if (s.chart) chart(w, s.chart);
  if (s.table) table(w, s.table);
  w.y += 2;
}

function decorate(w: Writer): void {
  const { doc, model } = w;
  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    doc.setDrawColor(...LINE);
    doc.setLineWidth(0.2);
    doc.line(M, PAGE_H - 20, PAGE_W - M, PAGE_H - 20);
    w.font(6, false, INK3);
    const disc = doc.splitTextToSize(model.disclaimer, CW - 16) as string[];
    doc.text(disc.slice(0, 5), M, PAGE_H - 17, { lineHeightFactor: 1.2 });
    w.font(7.5, true, INK2);
    doc.text(`${i} / ${pages}`, PAGE_W - M, PAGE_H - 17, { align: 'right' });
    if (i > 1) {
      w.font(7, false, INK3);
      doc.text(`${model.title} — ${model.projectName}`, M, 10);
      doc.setFillColor(...BRAND);
      doc.rect(0, 0, PAGE_W, 1.5, 'F');
    }
  }
}

export function renderPdf(model: ReportModel): Uint8Array {
  const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait', compress: true });
  doc.addFileToVFS('AIESSans-Regular.ttf', FONT_REGULAR);
  doc.addFileToVFS('AIESSans-Bold.ttf', FONT_BOLD);
  doc.addFont('AIESSans-Regular.ttf', FONT, 'normal');
  doc.addFont('AIESSans-Bold.ttf', FONT, 'bold');
  doc.setFont(FONT, 'normal');
  doc.setProperties({ title: `${model.title} — ${model.projectName}`, subject: model.subtitle, author: model.generatedBy ?? PRODUCT_NAME, creator: PRODUCT_NAME, keywords: 'AI economics, ACU, ABU' });
  const w = new Writer(doc, model);
  cover(w);
  for (const s of model.sections) sectionBlock(w, s);
  decorate(w);
  return toU8(doc.output('arraybuffer'));
}

export async function buildPdf(result: ProjectResult, catalog: Catalog, report: ReportId, opts: { generatedBy?: string } = {}): Promise<Uint8Array> {
  return renderPdf(reportModel(result, catalog, report, opts));
}
