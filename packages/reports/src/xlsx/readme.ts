import { quoteSheet } from './book';
import type { Fmt, WB } from './ctx';
import { PRODUCT_NAME } from '../types';
import { disclaimerText } from '../util';
import { dateLabel } from '../format';

/** Checks sheet: every key formula cell vs its static engine value (tolerance 0.01%). */
export function buildChecks(w: WB): void {
  const sh = w.s.checks;
  w.title(sh, 'Checks', 'Each row reads a formula cell elsewhere in the workbook and compares it with the engine value captured when the file was generated. Tolerance: 0.01% (or 0.000001 absolute).');
  sh.freeze = { row: 4, col: 0 };
  const widths = [16, 18, 10, 58, 18, 18, 14, 11, 8];
  widths.forEach((wd, i) => sh.width(i + 1, wd));
  w.header(sh, 4, 1, ['Area', 'Sheet', 'Cell', 'Check', 'Workbook formula', 'Engine value', 'Δ', 'Relative Δ', 'Result']);
  let r = 5;
  const r0 = r;
  for (const c of w.book.checks) {
    const ref = `${quoteSheet(c.sheet)}!${c.address}`;
    w.label(sh, r, 1, c.area, 'calc');
    w.label(sh, r, 2, c.sheet, 'calc');
    w.label(sh, r, 3, c.address, 'calc');
    w.label(sh, r, 4, c.label, 'calc');
    if (typeof c.engine === 'string') {
      w.calc(sh, r, 5, `IF(${ref}="","",${ref})`, 'dec2');
      w.engine(sh, r, 6, c.engine === '' ? 'Not within term' : c.engine, 'text');
      w.calc(sh, r, 7, '0', 'delta');
      w.calc(sh, r, 8, '0', 'pct');
      w.calc(sh, r, 9, `IF(E${r}="","Pass","FAIL")`, 'text');
    } else {
      w.calc(sh, r, 5, ref, 'dec2');
      w.engine(sh, r, 6, c.engine, 'dec2');
      w.calc(sh, r, 7, `E${r}-F${r}`, 'delta');
      w.calc(sh, r, 8, `IF(F${r}=0,ABS(G${r}),ABS(G${r}/F${r}))*100`, 'pct');
      w.calc(sh, r, 9, `IF(ABS(G${r})<=MAX(0.000001,ABS(F${r})*0.0001),"Pass","FAIL")`, 'text');
    }
    r++;
  }
  const r1 = Math.max(r0, r - 1);
  w.book.define('CheckResults', sh, r0, 9, r1, 9);
  w.book.define('CheckRelDelta', sh, r0, 8, r1, 8);
}

const SHEET_GUIDE: [string, string][] = [
  ['Assumptions', 'Contract, FX, workflow funnel, complexity mix and model rate inputs (shaded blue).'],
  ['Implementation', 'Effort, rates, contingency and implementation price (cost plus margin or T&M).'],
  ['LLM Tokenomics', 'One row per workflow × step × model route: calls, tokens, cache split, cost per call and monthly cost.'],
  ['ABU', 'Transaction funnel, complexity weights, weighted ABUs, cost per ABU and the ABU price build-up.'],
  ['Execution Costs', 'Every non-LLM cost line, human review, cost pools by workflow and projection drivers.'],
  ['ACU', 'Method A (cost-normalised) and Method B (weighted resources) ACU measurement.'],
  ['Pricing', 'Cost-recovery matrix, stream prices, tiers, subscription allowance and steady-state revenue.'],
  ['Projection', 'Month 0 to end of term: volumes, ACUs, ABUs, cost and revenue by stream; yearly summary.'],
  ['Value & ROI', 'Productivity (non-cash), benefit register with status, caps and overlaps, investment, ROI, NPV, payback.'],
  ['Checks', 'Every key formula compared with the engine value (should all read Pass).'],
];

export function buildReadme(w: WB, generatedBy?: string, now: Date = new Date()): void {
  const sh = w.s.readme;
  const p = w.r.project;
  sh.width(1, 34);
  sh.width(2, 90);
  w.title(sh, `${p.name} — financial model`, `${PRODUCT_NAME}. ${p.client.clientName}. Currency ${w.cur}. Generated ${dateLabel(now.toISOString())}${generatedBy ? ` by ${generatedBy}` : ''}.`);
  let r = 4;
  w.section(sh, r++, 'Purpose', 2);
  w.note(sh, r++, 1, 'A live, formula-driven copy of the engine calculations for this project: implementation cost and price, LLM tokenomics, the ABU funnel and price, ACU measurement, commercial pricing, a monthly projection and the client value case.');
  r++;
  w.section(sh, r++, 'How to use', 2);
  for (const t of [
    'Change shaded blue input cells (mostly on Assumptions, Implementation, Execution Costs, Pricing and Value & ROI). Every other number is a formula and recalculates.',
    'Grey italic "Engine" columns hold the values the engine produced when this file was generated; the Δ column next to each shows formula minus engine. After you change inputs the Δ values will move — that is expected.',
    'Cells labelled "engine value" (for example self-hosted model token rates and marginal cost per unit) are calculated by the engine and are not reproduced as formulas.',
    'The Checks sheet lists every key formula against its engine value; all rows read Pass for the file as generated.',
  ]) {
    w.note(sh, r++, 1, t);
  }
  r++;
  w.section(sh, r++, 'Sheets', 2);
  for (const [name, desc] of SHEET_GUIDE) {
    w.label(sh, r, 1, name);
    w.label(sh, r, 2, desc, 'text');
    r++;
  }
  r++;
  w.section(sh, r++, 'Headline results (live formulas)', 2);
  const kv = (label: string, f: string | (() => string), fmt: Fmt) => {
    w.label(sh, r, 1, label);
    w.calc(sh, r, 2, f, fmt, { align: 'left' });
    r++;
  };
  kv('Implementation price', 'ImplPrice', 'money');
  kv('Steady-state monthly run cost', 'RunCost', 'money');
  kv('Total contract value', 'TCV', 'money');
  kv('Provider gross margin %', 'ProviderMargin', 'pct');
  kv('ARR', 'ARR', 'money');
  kv('Client ROI over the term %', 'ClientRoi', 'pct');
  kv('Client NPV', 'ClientNpv', 'money');
  kv('Formula checks passing', () => `COUNTIF(CheckResults,"Pass")&" of "&COUNTA(CheckResults)`, 'text');
  kv('Largest relative Δ (%)', () => 'MAX(CheckRelDelta)', 'dec4');
  r++;
  w.section(sh, r++, 'Engine reconciliation (as generated)', 2);
  const recon = w.r.reconciliation;
  w.label(sh, r, 1, 'Status');
  w.label(sh, r, 2, `${recon.filter((c) => c.pass).length} of ${recon.length} engine reconciliation checks pass.`, 'text');
  r++;
  for (const c of recon) {
    w.label(sh, r, 1, c.pass ? 'Pass' : 'FAIL', 'muted');
    w.label(sh, r, 2, c.name, 'text');
    r++;
  }
  r++;
  w.section(sh, r++, 'Disclaimer', 2);
  sh.set(r, 1, { v: disclaimerText(w.r, w.cat), kind: 'note', wrap: true });
  sh.merges.push(`A${r}:B${r}`);
}
