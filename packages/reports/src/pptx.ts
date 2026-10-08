/**
 * PowerPoint renderer (pptxgenjs): 16:9, title slide, one or more slides per
 * section with KPI tiles, native editable charts and tables split across
 * slides when long; one consistent master with footer, disclaimer and slide numbers.
 */
import PptxGenJS from 'pptxgenjs';
import type { Catalog, ProjectResult } from '@aies/engine';
import type { ReportChart, ReportId, ReportKpi, ReportModel, ReportSection, ReportTable } from './types';
import { PALETTE, PRODUCT_NAME } from './types';
import { reportModel } from './model';
import { chartScale, dateLabel, symbol } from './format';
import { maxAbs } from './chart-geom';
import { toU8 } from './util';

const W = 13.333;
const H = 7.5;
const MX = 0.5;
const CW = W - 2 * MX;
const BODY_TOP = 1.2;
const BODY_BOTTOM = 6.75;
const FONT = 'Calibri';
const MASTER = 'AIES';

type Slide = PptxGenJS.Slide;

function addMaster(pptx: PptxGenJS, model: ReportModel): void {
  pptx.defineSlideMaster({
    title: MASTER,
    background: { color: PALETTE.paper },
    margin: [0.4, 0.5, 0.6, 0.5],
    objects: [
      { rect: { x: 0, y: 0, w: W, h: 0.08, fill: { color: PALETTE.brand }, line: { color: PALETTE.brand, width: 0 } } },
      { line: { x: MX, y: 6.95, w: CW, h: 0, line: { color: PALETTE.line, width: 0.75 } } },
      {
        text: {
          text: `${PRODUCT_NAME} · ${model.projectName} · ${model.clientName}`,
          options: { x: MX, y: 6.98, w: 7.5, h: 0.22, fontFace: FONT, fontSize: 8, color: PALETTE.ink3 },
        },
      },
      {
        text: {
          text: model.disclaimer,
          options: { x: MX, y: 7.17, w: CW - 0.8, h: 0.3, fontFace: FONT, fontSize: 5.5, color: PALETTE.ink3, valign: 'top', fit: 'shrink' },
        },
      },
    ],
    slideNumber: { x: W - MX - 0.6, y: 6.98, w: 0.6, h: 0.22, fontFace: FONT, fontSize: 8, color: PALETTE.ink2, align: 'right' },
  });
}

function titleSlide(pptx: PptxGenJS, model: ReportModel): void {
  const s = pptx.addSlide({ masterName: MASTER });
  s.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: 0.28, h: H, fill: { color: PALETTE.brand }, line: { color: PALETTE.brand, width: 0 } });
  s.addText(PRODUCT_NAME, { x: 0.9, y: 1.2, w: 10, h: 0.4, fontFace: FONT, fontSize: 14, bold: true, color: PALETTE.brand });
  s.addText(model.title, { x: 0.9, y: 1.75, w: 11.5, h: 1.2, fontFace: FONT, fontSize: 36, bold: true, color: PALETTE.ink, valign: 'top', fit: 'shrink' });
  s.addText(`${model.projectName} — ${model.clientName}`, { x: 0.9, y: 3.1, w: 11.5, h: 0.5, fontFace: FONT, fontSize: 18, color: PALETTE.ink2 });
  s.addText(model.subtitle, { x: 0.9, y: 3.65, w: 11.5, h: 0.4, fontFace: FONT, fontSize: 12, color: PALETTE.ink3 });
  s.addText(`Currency ${model.currency}. Generated ${dateLabel(model.generatedAt)}${model.generatedBy ? ` by ${model.generatedBy}` : ''}.`, {
    x: 0.9,
    y: 4.1,
    w: 11.5,
    h: 0.35,
    fontFace: FONT,
    fontSize: 11,
    color: PALETTE.ink3,
  });
  s.addShape(pptx.ShapeType.line, { x: 0.9, y: 4.75, w: 2.2, h: 0, line: { color: PALETTE.brand, width: 2.5 } });
}

function header(pptx: PptxGenJS, title: string, cont = false): Slide {
  const s = pptx.addSlide({ masterName: MASTER });
  s.addText(cont ? `${title} (continued)` : title, { x: MX, y: 0.28, w: CW, h: 0.55, fontFace: FONT, fontSize: 22, bold: true, color: PALETTE.ink, valign: 'middle', fit: 'shrink' });
  s.addShape(pptx.ShapeType.line, { x: MX, y: 0.9, w: 0.9, h: 0, line: { color: PALETTE.brand, width: 2.25 } });
  return s;
}

function paragraphs(s: Slide, paras: string[], x: number, y: number, w: number, h: number): void {
  s.addText(
    paras.map((p, i) => ({ text: p, options: { breakLine: i < paras.length - 1, paraSpaceAfter: 6 } })),
    { x, y, w, h, fontFace: FONT, fontSize: 12, color: PALETTE.ink, valign: 'top', fit: 'shrink', margin: 0 },
  );
}

function kpiTiles(pptx: PptxGenJS, s: Slide, kpis: ReportKpi[], x: number, y: number, w: number, maxRows = 2): number {
  const cols = Math.min(kpis.length, kpis.length > 8 ? 4 : kpis.length >= 6 ? 3 : kpis.length === 4 ? 4 : Math.max(1, kpis.length));
  const rows = Math.min(maxRows, Math.ceil(kpis.length / cols));
  const gap = 0.15;
  const tw = (w - gap * (cols - 1)) / cols;
  const th = 0.95;
  kpis.slice(0, rows * cols).forEach((k, i) => {
    const cx = x + (i % cols) * (tw + gap);
    const cy = y + Math.floor(i / cols) * (th + gap);
    s.addShape(pptx.ShapeType.rect, { x: cx, y: cy, w: tw, h: th, fill: { color: PALETTE.sunken }, line: { color: PALETTE.line, width: 0.75 } });
    s.addShape(pptx.ShapeType.rect, { x: cx, y: cy, w: 0.06, h: th, fill: { color: PALETTE.brand }, line: { color: PALETTE.brand, width: 0 } });
    s.addText(k.label, { x: cx + 0.15, y: cy + 0.07, w: tw - 0.25, h: 0.25, fontFace: FONT, fontSize: 10, color: PALETTE.ink2, fit: 'shrink', margin: 0 });
    s.addText(k.value, { x: cx + 0.15, y: cy + 0.32, w: tw - 0.25, h: 0.38, fontFace: FONT, fontSize: 20, bold: true, color: PALETTE.ink, fit: 'shrink', margin: 0 });
    if (k.note) s.addText(k.note, { x: cx + 0.15, y: cy + 0.7, w: tw - 0.25, h: 0.2, fontFace: FONT, fontSize: 8, color: PALETTE.ink3, fit: 'shrink', margin: 0 });
  });
  return rows * (th + gap);
}

function chartFormat(c: ReportChart, cur: string): { code: string; div: number; suffix: string } {
  const sc = chartScale(maxAbs(c), c.valueFormat, cur);
  if (c.valueFormat === 'percent') return { code: '0.0"%"', div: 1, suffix: '' };
  const sym = c.valueFormat === 'currency' ? `"${symbol(cur).trim()}"` : '';
  const suf = sc.suffix ? `" ${sc.suffix}"` : '';
  const dp = sc.div > 1 ? '0.0' : '#,##0';
  return { code: `${sym}${dp}${suf}`, div: sc.div, suffix: sc.suffix };
}

function addChart(pptx: PptxGenJS, s: Slide, c: ReportChart, cur: string, x: number, y: number, w: number, h: number): void {
  const fmt = chartFormat(c, cur);
  const data = c.series.map((se) => ({ name: se.name, labels: c.categories, values: se.values.map((v) => (Number.isFinite(v) ? v / fmt.div : 0)) }));
  const type = c.kind === 'line' ? pptx.ChartType.line : pptx.ChartType.bar;
  const opts: PptxGenJS.IChartOpts = {
    x,
    y,
    w,
    h,
    barDir: 'col',
    barGrouping: c.kind === 'stacked-bar' ? 'stacked' : 'clustered',
    barGapWidthPct: 60,
    chartColors: PALETTE.series.slice(0, Math.max(1, c.series.length)),
    showLegend: c.series.length > 1,
    legendPos: 'b',
    legendFontFace: FONT,
    legendFontSize: 10,
    legendColor: PALETTE.ink2,
    showTitle: true,
    title: c.title + (fmt.suffix && c.valueFormat !== 'percent' ? ` (${c.valueFormat === 'currency' ? symbol(cur).trim() + ' ' : ''}${fmt.suffix})` : ''),
    titleFontFace: FONT,
    titleFontSize: 12,
    titleColor: PALETTE.ink,
    catAxisLabelFontFace: FONT,
    catAxisLabelFontSize: c.categories.length > 12 ? 8 : 10,
    catAxisLabelColor: PALETTE.ink2,
    catAxisLineShow: true,
    catAxisLineColor: PALETTE.ink3,
    valAxisLabelFontFace: FONT,
    valAxisLabelFontSize: 9,
    valAxisLabelColor: PALETTE.ink3,
    valAxisLabelFormatCode: fmt.code,
    valAxisLineShow: false,
    valGridLine: { color: PALETTE.line, style: 'solid', size: 0.5 },
    catGridLine: { style: 'none' },
    lineSize: 2,
    lineDataSymbol: c.categories.length > 18 ? 'none' : 'circle',
    lineDataSymbolSize: 5,
    dataLabelFormatCode: fmt.code,
    showValue: c.kind !== 'line' && c.categories.length * c.series.length <= 8,
    dataLabelFontFace: FONT,
    dataLabelFontSize: 9,
    dataLabelColor: PALETTE.ink2,
    dataLabelPosition: c.kind === 'stacked-bar' ? 'ctr' : 'outEnd',
  };
  s.addChart(type, data, opts);
}

const ROW_H = 0.3;

function tableRows(t: ReportTable): PptxGenJS.TableRow[] {
  const align = t.align ?? t.columns.map((_, i) => (i === 0 ? 'left' : 'right'));
  const head: PptxGenJS.TableRow = t.columns.map((c, i) => ({ text: c, options: { bold: true, color: 'FFFFFF', fill: { color: PALETTE.brand }, align: align[i] } }));
  return [head];
}

function cellRows(rows: string[][], align: ('left' | 'right')[], opts: { bold?: boolean; fill?: string } = {}): PptxGenJS.TableRow[] {
  return rows.map((r, ri) =>
    r.map((v, i) => ({
      text: v,
      options: { align: align[i], bold: opts.bold, fill: { color: opts.fill ?? (ri % 2 ? 'FAFBFA' : PALETTE.paper) } },
    })),
  );
}

function colWidths(t: ReportTable, w: number): number[] {
  const len = t.columns.map((c, i) => Math.max(c.length * 0.8, ...t.rows.map((r) => (r[i] ?? '').length), ...(t.footer ? [(t.footer[i] ?? '').length] : [])));
  const capped = len.map((l, i) => Math.min(i === 0 ? 48 : 34, Math.max(5, l)));
  const tot = capped.reduce((a, b) => a + b, 0);
  return capped.map((l) => (l / tot) * w);
}

/** Add a table, splitting rows across continuation slides; returns the bottom y on the last slide. */
function addTable(pptx: PptxGenJS, first: Slide, title: string, t: ReportTable, y0: number): void {
  const align = t.align ?? t.columns.map((_, i) => (i === 0 ? 'left' : 'right'));
  const n = t.columns.length;
  const fontSize = n >= 10 ? 8 : n >= 8 ? 9 : 10;
  const longest = Math.max(0, ...t.rows.map((r) => Math.max(...r.map((v) => v.length))));
  const rowH = longest > 90 ? ROW_H * 2.4 : longest > 55 ? ROW_H * 1.6 : ROW_H;
  const widths = colWidths(t, CW);
  let slide = first;
  let y = y0;
  let i = 0;
  let cont = false;
  do {
    const avail = BODY_BOTTOM - y - ROW_H - (t.footer ? ROW_H : 0);
    const fit = Math.max(1, Math.floor(avail / rowH));
    const chunk = t.rows.slice(i, i + fit);
    i += chunk.length;
    const last = i >= t.rows.length;
    const rows: PptxGenJS.TableRow[] = [...tableRows(t), ...cellRows(chunk, align)];
    if (last && t.footer) rows.push(...cellRows([t.footer], align, { bold: true, fill: PALETTE.brandTint }));
    slide.addTable(rows, {
      x: MX,
      y,
      w: CW,
      colW: widths,
      fontFace: FONT,
      fontSize,
      color: PALETTE.ink,
      border: { type: 'solid', pt: 0.5, color: PALETTE.line },
      valign: 'middle',
      margin: [0.03, 0.06, 0.03, 0.06],
      rowH: rows.map((_, ri) => (ri === 0 ? ROW_H : rowH)),
    });
    if (!last) {
      cont = true;
      slide = header(pptx, title, cont);
      y = BODY_TOP;
    }
  } while (i < t.rows.length);
}

function estimateParaHeight(paras: string[], widthIn: number): number {
  const charsPerLine = Math.max(20, widthIn * 13.5);
  const lines = paras.reduce((a, p) => a + Math.ceil(p.length / charsPerLine), 0);
  return Math.min(3.2, lines * 0.22 + paras.length * 0.08);
}

function sectionSlides(pptx: PptxGenJS, model: ReportModel, sec: ReportSection): void {
  const s = header(pptx, sec.heading);
  let y = BODY_TOP;
  const paras = sec.paragraphs ?? [];
  const hasTable = !!sec.table && sec.table.rows.length > 0;
  const hasChart = !!sec.chart;
  if (paras.length) {
    const ph = estimateParaHeight(paras, hasChart && !hasTable && !sec.kpis?.length ? CW * 0.42 : CW);
    if (hasChart && !hasTable && !sec.kpis?.length) {
      // Text beside the chart.
      paragraphs(s, paras, MX, y, CW * 0.42, BODY_BOTTOM - y);
      addChart(pptx, s, sec.chart!, model.currency, MX + CW * 0.45, y, CW * 0.55, BODY_BOTTOM - y);
      return;
    }
    paragraphs(s, paras, MX, y, CW, ph);
    y += ph + 0.1;
  }
  if (sec.kpis?.length) {
    const rowsAllowed = hasTable || hasChart ? 2 : 3;
    y += kpiTiles(pptx, s, sec.kpis, MX, y, CW, rowsAllowed) + 0.05;
  }
  let target: Slide = s;
  if (hasChart) {
    const room = BODY_BOTTOM - y;
    if (room >= 2.6 && !hasTable) {
      addChart(pptx, target, sec.chart!, model.currency, MX, y, CW, room);
      y = BODY_BOTTOM;
    } else if (room >= 2.6 && hasTable && sec.table!.rows.length <= 8 && sec.table!.columns.length <= 5) {
      // Chart and short table side by side.
      addChart(pptx, target, sec.chart!, model.currency, MX, y, CW * 0.48, room);
      const t = sec.table!;
      const align = t.align ?? t.columns.map((_, i) => (i === 0 ? 'left' : 'right'));
      const rows = [...tableRows(t), ...cellRows(t.rows, align), ...(t.footer ? cellRows([t.footer], align, { bold: true, fill: PALETTE.brandTint }) : [])];
      target.addTable(rows, {
        x: MX + CW * 0.5,
        y,
        w: CW * 0.5,
        colW: colWidths(t, CW * 0.5),
        fontFace: FONT,
        fontSize: t.columns.length > 5 ? 8 : 9,
        color: PALETTE.ink,
        border: { type: 'solid', pt: 0.5, color: PALETTE.line },
        valign: 'middle',
        margin: [0.03, 0.06, 0.03, 0.06],
        autoPage: false,
      });
      return;
    } else {
      if (room >= 2.6) addChart(pptx, target, sec.chart!, model.currency, MX, y, CW, room);
      else {
        target = header(pptx, sec.heading, true);
        addChart(pptx, target, sec.chart!, model.currency, MX, BODY_TOP, CW, BODY_BOTTOM - BODY_TOP);
      }
      if (hasTable) {
        target = header(pptx, sec.heading, true);
        addTable(pptx, target, sec.heading, sec.table!, BODY_TOP);
      }
      return;
    }
  }
  if (hasTable) {
    if (BODY_BOTTOM - y < 1.2) {
      target = header(pptx, sec.heading, true);
      y = BODY_TOP;
    }
    addTable(pptx, target, sec.heading, sec.table!, y);
  }
}

export async function renderPptx(model: ReportModel): Promise<Uint8Array> {
  const pptx = new PptxGenJS();
  pptx.layout = 'LAYOUT_WIDE';
  pptx.author = model.generatedBy ?? PRODUCT_NAME;
  pptx.company = PRODUCT_NAME;
  pptx.title = `${model.title} — ${model.projectName}`;
  pptx.subject = model.subtitle;
  pptx.theme = { headFontFace: FONT, bodyFontFace: FONT };
  addMaster(pptx, model);
  titleSlide(pptx, model);
  for (const sec of model.sections) sectionSlides(pptx, model, sec);
  const out = (await pptx.write({ outputType: 'uint8array', compression: true })) as Uint8Array;
  return toU8(out);
}

export async function buildPptx(result: ProjectResult, catalog: Catalog, report: ReportId, opts: { generatedBy?: string } = {}): Promise<Uint8Array> {
  return renderPptx(reportModel(result, catalog, report, opts));
}
