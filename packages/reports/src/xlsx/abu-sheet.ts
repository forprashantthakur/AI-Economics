import { safeDiv, sum } from '@aies/engine';
import { colName } from './book';
import { layout, type Fmt, type WB } from './ctx';

/**
 * ABU sheet: transaction funnel, complexity mix and weighted ABUs per workflow
 * (steady-state month), cost per ABU and — when an ABU stream exists — the ABU
 * price build-up per workflow and complexity class.
 */
export function buildAbu(w: WB): void {
  const sh = w.s.abu;
  const p = w.r.project;
  const b = w.r.baseline;
  const wfs = p.workflows;
  w.title(sh, 'ABU — AI Business Units', 'Completed = attempted × success; accepted = completed × acceptance; execution equivalents = completed + failed × failed consumption + retries × retry consumption; weighted ABUs = accepted × Σ(share × weight) ÷ Σ share.');
  sh.width(1, 26);
  sh.width(2, 30);
  sh.freeze = { row: 3, col: 2 };
  const A = (i: number, k: string) => w.at(`wf.${i}.${k}`, sh);

  // ── Table A: funnel
  let r = 4;
  w.section(sh, r++, 'Transaction funnel (steady-state month, contract year 1)', 17);
  const LA = layout([
    { key: 'id', header: 'Workflow id' },
    { key: 'name', header: 'Workflow' },
    { key: 'att', header: 'Attempted', width: 13, check: true },
    { key: 'comp', header: 'Completed', width: 13, check: true },
    { key: 'fail', header: 'Failed', width: 12, check: true },
    { key: 'acc', header: 'Accepted', width: 13, check: true },
    { key: 'rej', header: 'Rejected', width: 12, check: true },
  ]);
  LA.write(sh, w, r++);
  const a = (k: string) => colName(LA.col[k]);
  const ra0 = r;
  wfs.forEach((wf, i) => {
    const v = b.volumes[wf.id];
    w.calc(sh, r, LA.col.id, A(i, 'id'), 'text');
    w.calc(sh, r, LA.col.name, A(i, 'name'), 'text');
    w.calc(sh, r, LA.col.att, A(i, 'vol'), 'count2');
    w.calc(sh, r, LA.col.comp, `${a('att')}${r}*${A(i, 'success')}/100`, 'count2');
    w.calc(sh, r, LA.col.fail, `${a('att')}${r}-${a('comp')}${r}`, 'count2');
    w.calc(sh, r, LA.col.acc, `${a('comp')}${r}*${A(i, 'accept')}/100`, 'count2');
    w.calc(sh, r, LA.col.rej, `${a('comp')}${r}-${a('acc')}${r}`, 'count2');
    for (const [k, ev] of [['att', v.attempted], ['comp', v.completed], ['fail', v.failed], ['acc', v.accepted], ['rej', v.rejected]] as const) {
      w.check(sh, r, LA.col[k], ev, 'ABU funnel', `${wf.name} — ${k === 'att' ? 'attempted' : k === 'comp' ? 'completed' : k === 'fail' ? 'failed' : k === 'acc' ? 'accepted' : 'rejected'}`, 'count2');
      w.put(`abu.${i}.${k}`, sh, r, LA.col[k]);
    }
    r++;
  });
  const ra1 = r - 1;
  w.label(sh, r, 1, 'Total', 'total');
  for (const [k, ev] of [['att', b.totals.attempted], ['acc', b.totals.accepted], ['rej', b.totals.rejected], ['fail', b.totals.failed]] as const) {
    w.total(sh, r, LA.col[k], `SUM(${a(k)}${ra0}:${a(k)}${ra1})`, 'count2');
    w.check(sh, r, LA.col[k], ev, 'ABU funnel', `Total ${k === 'att' ? 'attempted' : k === 'acc' ? 'accepted' : k === 'rej' ? 'rejected' : 'failed'}`, 'count2');
    w.put(`abu.tot.${k}`, sh, r, LA.col[k]);
  }
  w.total(sh, r, LA.col.comp, `SUM(${a('comp')}${ra0}:${a('comp')}${ra1})`, 'count2');
  r++;
  w.note(sh, r++, 1, 'Accepted + rejected + failed = attempted. Retries are additional executions, never additional transactions or ABUs.');
  r++;

  // ── Table B: executions
  w.section(sh, r++, 'Executions, consumption and human assistance', 23);
  const LB = layout([
    { key: 'id', header: 'Workflow id' },
    { key: 'name', header: 'Workflow' },
    { key: 'ret', header: 'Retries', width: 12, check: true },
    { key: 'exe', header: 'Executions', width: 13, check: true },
    { key: 'eq', header: 'Execution equivalents', width: 14, check: true },
    { key: 'ha', header: 'Human-assisted', width: 13, check: true },
    { key: 'aut', header: 'Autonomous', width: 13, check: true },
    { key: 'calls', header: 'LLM calls', width: 13, check: true },
    { key: 'tools', header: 'Tool calls', width: 13, check: true },
  ]);
  LB.write(sh, w, r++);
  const bb = (k: string) => colName(LB.col[k]);
  const rb0 = r;
  wfs.forEach((wf, i) => {
    const v = b.volumes[wf.id];
    const att = w.at(`abu.${i}.att`, sh);
    const comp = w.at(`abu.${i}.comp`, sh);
    const fail = w.at(`abu.${i}.fail`, sh);
    const acc = w.at(`abu.${i}.acc`, sh);
    w.calc(sh, r, LB.col.id, A(i, 'id'), 'text');
    w.calc(sh, r, LB.col.name, A(i, 'name'), 'text');
    w.calc(sh, r, LB.col.ret, `${att}*${A(i, 'retry')}/100`, 'count2');
    w.calc(sh, r, LB.col.exe, `${att}+${bb('ret')}${r}`, 'count2');
    w.calc(sh, r, LB.col.eq, `${comp}+${fail}*${A(i, 'failCons')}/100+${bb('ret')}${r}*${A(i, 'retryCons')}/100`, 'count2');
    w.calc(sh, r, LB.col.ha, `${acc}*${A(i, 'human')}/100`, 'count2');
    w.calc(sh, r, LB.col.aut, `${acc}-${bb('ha')}${r}`, 'count2');
    w.calc(sh, r, LB.col.calls, `SUMIF(TokWf,${bb('id')}${r},TokCalls)`, 'count2');
    w.calc(sh, r, LB.col.tools, `${bb('exe')}${r}*${A(i, 'tools')}`, 'count2');
    const labels: Record<string, string> = { ret: 'retries', exe: 'executions', eq: 'execution equivalents', ha: 'human-assisted', aut: 'autonomous', calls: 'LLM calls', tools: 'tool calls' };
    for (const [k, ev] of [['ret', v.retries], ['exe', v.executions], ['eq', v.executionEquivalents], ['ha', v.humanAssisted], ['aut', v.autonomous], ['calls', v.llmCalls], ['tools', v.toolCalls]] as const) {
      w.check(sh, r, LB.col[k], ev, 'ABU funnel', `${wf.name} — ${labels[k]}`, 'count2');
      w.put(`abu.${i}.${k}`, sh, r, LB.col[k]);
    }
    r++;
  });
  const rb1 = r - 1;
  w.label(sh, r, 1, 'Total', 'total');
  for (const [k, ev] of [['exe', b.totals.executions], ['ha', b.totals.humanAssisted], ['aut', b.totals.autonomous]] as const) {
    w.total(sh, r, LB.col[k], `SUM(${bb(k)}${rb0}:${bb(k)}${rb1})`, 'count2');
    w.check(sh, r, LB.col[k], ev, 'ABU funnel', `Total ${k === 'exe' ? 'executions' : k === 'ha' ? 'human-assisted' : 'autonomous'}`, 'count2');
  }
  for (const k of ['ret', 'eq', 'calls', 'tools']) w.total(sh, r, LB.col[k], `SUM(${bb(k)}${rb0}:${bb(k)}${rb1})`, 'count2');
  w.put('abu.tot.exe', sh, r, LB.col.exe);
  r += 2;

  // ── Table C: complexity mix & weighted ABUs
  w.section(sh, r++, 'Complexity mix and weighted ABUs', 14);
  const LC = layout([
    { key: 'id', header: 'Workflow id' },
    { key: 'name', header: 'Workflow' },
    { key: 'n', header: 'Classes', width: 9 },
    { key: 'st', header: 'Σ share %', width: 10 },
    { key: 'mix', header: 'Consumption mix', width: 12, check: true },
    { key: 'hmix', header: 'Human-effort mix', width: 12, check: true },
    { key: 'wf', header: 'ABUs per accepted', width: 12 },
    { key: 'wabu', header: 'Weighted ABUs', width: 13, check: true },
  ]);
  LC.write(sh, w, r++);
  const cc = (k: string) => colName(LC.col[k]);
  const cxWf = w.at('cx.wf', sh);
  const cxShare = w.at('cx.share', sh);
  const rc0 = r;
  wfs.forEach((wf, i) => {
    const v = b.volumes[wf.id];
    const id = `${cc('id')}${r}`;
    const n = `${cc('n')}${r}`;
    const st = `${cc('st')}${r}`;
    const mixOf = (key: string) => `IF(${n}=0,1,IF(${st}=0,SUMIF(${cxWf},${id},${w.at(key, sh)})/${n},SUMPRODUCT((${cxWf}=${id})*${cxShare}*${w.at(key, sh)})/${st}))`;
    w.calc(sh, r, LC.col.id, A(i, 'id'), 'text');
    w.calc(sh, r, LC.col.name, A(i, 'name'), 'text');
    w.calc(sh, r, LC.col.n, `COUNTIF(${cxWf},${id})`, 'int');
    w.calc(sh, r, LC.col.st, `SUMIF(${cxWf},${id},${cxShare})`, 'pct');
    w.calc(sh, r, LC.col.mix, mixOf('cx.cons'), 'factor');
    w.calc(sh, r, LC.col.hmix, mixOf('cx.human'), 'factor');
    w.calc(sh, r, LC.col.wf, mixOf('cx.weight'), 'factor');
    w.calc(sh, r, LC.col.wabu, `${w.at(`abu.${i}.acc`, sh)}*${cc('wf')}${r}`, 'count2');
    w.check(sh, r, LC.col.mix, v.consumptionMix, 'ABU funnel', `${wf.name} — consumption mix`, 'factor');
    w.check(sh, r, LC.col.hmix, v.humanEffortMix, 'ABU funnel', `${wf.name} — human-effort mix`, 'factor');
    w.check(sh, r, LC.col.wabu, v.weightedAbus, 'ABU funnel', `${wf.name} — weighted ABUs`, 'count2');
    for (const k of ['n', 'st', 'mix', 'hmix', 'wf', 'wabu']) w.put(`abu.${i}.${k}`, sh, r, LC.col[k]);
    r++;
  });
  const rc1 = r - 1;
  w.label(sh, r, 1, 'Total', 'total');
  w.total(sh, r, LC.col.wabu, `SUM(${cc('wabu')}${rc0}:${cc('wabu')}${rc1})`, 'count2');
  w.check(sh, r, LC.col.wabu, b.totals.weightedAbus, 'ABU funnel', 'Total weighted ABUs', 'count2');
  w.put('abu.tot.wabu', sh, r, LC.col.wabu);
  w.book.define('WeightedAbus', sh, r, LC.col.wabu);
  r += 2;

  // ── Class detail
  w.section(sh, r++, 'Accepted transactions and ABUs by complexity class', 12);
  const LK = layout([
    { key: 'wfid', header: 'Workflow id' },
    { key: 'cls', header: 'Class' },
    { key: 'share', header: 'Normalised share', width: 11 },
    { key: 'acc', header: 'Accepted', width: 12 },
    { key: 'ha', header: 'Human-assisted', width: 12 },
    { key: 'aut', header: 'Autonomous', width: 12 },
    { key: 'weight', header: 'ABU weight', width: 10 },
    { key: 'wabu', header: 'Weighted ABUs', width: 13, check: true },
  ]);
  LK.write(sh, w, r++);
  const kc = (k: string) => colName(LK.col[k]);
  const cxPos = w.pos('cx.wf');
  let cxRow = cxPos.r;
  wfs.forEach((wf, i) => {
    const v = b.volumes[wf.id];
    const st = w.at(`abu.${i}.st`, sh);
    const n = w.at(`abu.${i}.n`, sh);
    v.byClass.forEach((c) => {
      if (!wf.complexity.length) {
        w.calc(sh, r, LK.col.wfid, A(i, 'id'), 'text');
        w.label(sh, r, LK.col.cls, 'Standard (no classes)', 'calc');
        w.calc(sh, r, LK.col.share, '1', 'factor');
        w.calc(sh, r, LK.col.weight, '1', 'dec2');
      } else {
        const ar = (col: number) => w.cell(cxPos.sheet, cxRow, col, sh);
        w.calc(sh, r, LK.col.wfid, ar(1), 'text');
        w.calc(sh, r, LK.col.cls, ar(3), 'text');
        w.calc(sh, r, LK.col.share, `IF(${st}=0,1/${n},${ar(4)}/${st})`, 'factor');
        w.calc(sh, r, LK.col.weight, ar(5), 'dec2');
        cxRow++;
      }
      w.calc(sh, r, LK.col.acc, `${w.at(`abu.${i}.acc`, sh)}*${kc('share')}${r}`, 'count2');
      w.calc(sh, r, LK.col.ha, `${w.at(`abu.${i}.ha`, sh)}*${kc('share')}${r}`, 'count2');
      w.calc(sh, r, LK.col.aut, `${kc('acc')}${r}-${kc('ha')}${r}`, 'count2');
      w.calc(sh, r, LK.col.wabu, `${kc('acc')}${r}*${kc('weight')}${r}`, 'count2');
      w.check(sh, r, LK.col.wabu, c.weightedAbus, 'ABU funnel', `${wf.name} / ${c.name} — weighted ABUs`, 'count2');
      r++;
    });
  });
  r++;

  // ── Table D: cost per ABU (references Execution Costs)
  w.section(sh, r++, 'Run cost per accepted transaction and per weighted ABU (all run pools)', 16);
  const LD = layout([
    { key: 'id', header: 'Workflow id' },
    { key: 'name', header: 'Workflow' },
    { key: 'llm', header: 'LLM cost', width: 14 },
    { key: 'run', header: 'Run cost', width: 14, check: true },
    { key: 'pacc', header: 'Cost per accepted', width: 12 },
    { key: 'pabu', header: 'Cost per weighted ABU', width: 12, check: true },
    { key: 'fail', header: 'Failed / rejected work cost', width: 14, check: true },
  ]);
  LD.write(sh, w, r++);
  const dc = (k: string) => colName(LD.col[k]);
  const rd0 = r;
  wfs.forEach((wf, i) => {
    w.calc(sh, r, LD.col.id, A(i, 'id'), 'text');
    w.calc(sh, r, LD.col.name, A(i, 'name'), 'text');
    w.calc(sh, r, LD.col.llm, `SUMIF(TokWf,${dc('id')}${r},TokCost)`, 'money');
    w.calc(sh, r, LD.col.run, () => w.at(`exec.run.${i}`, sh), 'money');
    w.calc(sh, r, LD.col.pacc, `IF(${w.at(`abu.${i}.acc`, sh)}=0,0,${dc('run')}${r}/${w.at(`abu.${i}.acc`, sh)})`, 'unit');
    w.calc(sh, r, LD.col.pabu, `IF(${w.at(`abu.${i}.wabu`, sh)}=0,0,${dc('run')}${r}/${w.at(`abu.${i}.wabu`, sh)})`, 'unit');
    w.calc(sh, r, LD.col.fail, () => w.at(`exec.fail.${i}`, sh), 'money');
    w.check(sh, r, LD.col.run, b.runCostByWorkflow[wf.id] ?? 0, 'ABU funnel', `${wf.name} — run cost`, 'money');
    w.check(sh, r, LD.col.pabu, safeDiv(b.runCostByWorkflow[wf.id] ?? 0, b.volumes[wf.id].weightedAbus), 'ABU funnel', `${wf.name} — cost per weighted ABU`, 'unit');
    w.check(sh, r, LD.col.fail, b.failureCostByWorkflow[wf.id] ?? 0, 'ABU funnel', `${wf.name} — failed / rejected work cost`, 'money');
    r++;
  });
  const rd1 = r - 1;
  w.label(sh, r, 1, 'Total', 'total');
  w.total(sh, r, LD.col.llm, `SUM(${dc('llm')}${rd0}:${dc('llm')}${rd1})`, 'money');
  w.total(sh, r, LD.col.run, `SUM(${dc('run')}${rd0}:${dc('run')}${rd1})`, 'money');
  w.check(sh, r, LD.col.run, b.totalRunCost, 'ABU funnel', 'Total run cost', 'money');
  w.total(sh, r, LD.col.pacc, `IF(${w.at('abu.tot.acc', sh)}=0,0,${dc('run')}${r}/${w.at('abu.tot.acc', sh)})`, 'unit');
  w.total(sh, r, LD.col.pabu, `IF(WeightedAbus=0,0,${dc('run')}${r}/WeightedAbus)`, 'unit');
  w.check(sh, r, LD.col.pabu, w.r.economics.provider.costToServePerAbu, 'ABU funnel', 'Cost to serve per weighted ABU', 'unit');
  w.total(sh, r, LD.col.fail, `SUM(${dc('fail')}${rd0}:${dc('fail')}${rd1})`, 'money');
  w.check(sh, r, LD.col.fail, sum(Object.values(b.failureCostByWorkflow)), 'ABU funnel', 'Total failed / rejected work cost', 'money');
  r += 2;

  buildAbuPricing(w, r);
}

/** ABU price build-up per workflow and class (only when the commercial model has an ABU stream). */
function buildAbuPricing(w: WB, r0: number): void {
  const sh = w.s.abu;
  const p = w.r.project;
  const s = w.r.priceBook.streams.find((x) => x.type === 'abu');
  const stream = p.pricing.streams.find((x) => x.enabled && x.type === 'abu');
  let r = r0;
  if (!s?.abu || !stream) {
    w.section(sh, r++, 'ABU price', 8);
    w.note(sh, r, 1, 'The commercial model has no ABU stream, so no ABU price is derived. The cost per weighted ABU above is the full cost to serve.');
    return;
  }
  const rc = p.pricing.abuRateCard;
  const b = w.book;
  w.section(sh, r++, `ABU price build-up — "${s.label}"`, 24);
  w.note(sh, r++, 1, 'Recovered cost = run cost of the pools this stream owns (+ amortised implementation if owned) − failed work when the provider absorbs it. Price = recovered cost ÷ (1 − target margin) ÷ billable units, never below the margin floor.');
  const scalar = (name: string, label: string, v: string | number, fmt: Fmt, list?: string[]) => {
    w.label(sh, r, 1, label);
    w.input(sh, r, 2, v, fmt, list ? { list } : {});
    b.define(name, sh, r, 2);
    r++;
  };
  scalar('AbuMarginPct', 'Target margin', stream.targetMarginPct, 'pct');
  scalar('AbuDiscountPct', 'Discount', stream.discountPct, 'pct');
  scalar('AbuFloorPct', 'Margin floor', rc.marginFloorPct, 'pct');
  scalar('AbuFailedPolicy', 'Failed-cost allocation', rc.failedCostAllocation, 'text', ['spread', 'provider_absorbs']);
  scalar('AbuAssistedFactor', 'Human-assisted price factor', rc.humanAssistedPriceFactor ?? 1, 'dec4');
  scalar('AbuClassPricing', 'Class pricing', rc.classPricing, 'text', ['weighted', 'override']);
  w.label(sh, r, 1, 'Implementation amortised into ABU price (per month)');
  w.calc(sh, r, 2, () => `IF(${w.at('own.abu.IMPLEMENTATION', sh)}=1,ImplCost/MAX(1,TermMonths),0)`, 'money');
  b.define('AbuImplPart', sh, r, 2);
  r++;
  w.label(sh, r, 1, 'Run cost of pools owned by the ABU stream');
  w.calc(sh, r, 2, () => `SUMPRODUCT(${w.at('own.abu.run', sh)},${w.at('pool.total', sh)})`, 'money');
  b.define('AbuOwnedRun', sh, r, 2);
  r += 2;

  const L = layout([
    { key: 'id', header: 'Workflow id' },
    { key: 'name', header: 'Workflow' },
    { key: 'own', header: 'Owned run cost', width: 13 },
    { key: 'impl', header: 'Implementation share', width: 12 },
    { key: 'failx', header: 'Failed work excluded', width: 12 },
    { key: 'rec', header: 'Recovered cost', width: 13, check: true },
    { key: 'bill', header: 'Billable units', width: 12, check: true },
    { key: 'cpa', header: 'Cost per ABU', width: 11, check: true },
    { key: 'list', header: 'List price', width: 11, check: true },
    { key: 'ov', header: 'Price override', width: 11 },
    { key: 'floor', header: 'Floor price', width: 11, check: true },
    { key: 'price', header: 'Price per weighted ABU', width: 12, check: true },
    { key: 'rev', header: 'Revenue at basis', width: 14 },
    { key: 'rpa', header: 'Revenue per attempted', width: 12 },
  ]);
  L.write(sh, w, r++);
  const c = (k: string) => colName(L.col[k]);
  const rows: number[] = [];
  p.workflows.forEach((wf, i) => {
    const e = s.abu!.byWorkflow[wf.id];
    rows.push(r);
    const x = (k: string) => `${c(k)}${r}`;
    w.calc(sh, r, L.col.id, w.at(`wf.${i}.id`, sh), 'text');
    w.calc(sh, r, L.col.name, w.at(`wf.${i}.name`, sh), 'text');
    w.calc(sh, r, L.col.own, () => `SUMPRODUCT(${w.at('own.abu.run', sh)},${w.at(`pool.wf.${i}`, sh)})`, 'money');
    w.calc(sh, r, L.col.impl, `IF(AbuOwnedRun=0,AbuImplPart/${p.workflows.length},AbuImplPart*${x('own')}/AbuOwnedRun)`, 'money');
    w.calc(sh, r, L.col.failx, () => `IF(AbuFailedPolicy="provider_absorbs",SUMPRODUCT(${w.at('own.abu.run', sh)},${w.at(`fail.wf.${i}`, sh)}),0)`, 'money');
    w.calc(sh, r, L.col.rec, `${x('own')}+${x('impl')}-${x('failx')}`, 'money');
    w.calc(sh, r, L.col.bill, `(${w.at(`abu.${i}.aut`, sh)}+${w.at(`abu.${i}.ha`, sh)}*AbuAssistedFactor)*${w.at(`abu.${i}.wf`, sh)}`, 'count2');
    w.calc(sh, r, L.col.cpa, `IF(${w.at(`abu.${i}.wabu`, sh)}=0,0,${x('rec')}/${w.at(`abu.${i}.wabu`, sh)})`, 'unit');
    w.calc(sh, r, L.col.list, `IF(${x('bill')}=0,0,${x('rec')}/(1-AbuMarginPct/100)/${x('bill')})`, 'unit');
    const ov = rc.priceOverrides?.[wf.id];
    w.input(sh, r, L.col.ov, ov === null || ov === undefined ? null : ov, 'unit');
    w.calc(sh, r, L.col.floor, `IF(${x('bill')}=0,0,${x('cpa')}/(1-AbuFloorPct/100)*${w.at(`abu.${i}.wabu`, sh)}/${x('bill')})`, 'unit');
    w.calc(sh, r, L.col.price, `MAX(IF(ISNUMBER(${x('ov')}),${x('ov')},${x('list')}*(1-AbuDiscountPct/100)),${x('floor')})`, 'unit');
    const idCell = x('id');
    w.calc(sh, r, L.col.rev, () => `(${w.at(`abu.${i}.aut`, sh)}*SUMPRODUCT((${w.at('cls.wf', sh)}=${idCell})*${w.at('cls.share', sh)}*${w.at('cls.price', sh)})+${w.at(`abu.${i}.ha`, sh)}*SUMPRODUCT((${w.at('cls.wf', sh)}=${idCell})*${w.at('cls.share', sh)}*${w.at('cls.aprice', sh)}))`, 'money');
    w.calc(sh, r, L.col.rpa, `IF(${w.at(`abu.${i}.att`, sh)}=0,0,${x('rev')}/${w.at(`abu.${i}.att`, sh)})`, 'unit');
    w.check(sh, r, L.col.rec, e.recoveredCost, 'ABU pricing', `${wf.name} — recovered cost`, 'money');
    w.check(sh, r, L.col.bill, e.billableUnits, 'ABU pricing', `${wf.name} — billable units`, 'count2');
    w.check(sh, r, L.col.cpa, e.costPerAbu, 'ABU pricing', `${wf.name} — cost per ABU`, 'unit');
    w.check(sh, r, L.col.list, e.listPrice, 'ABU pricing', `${wf.name} — list price`, 'unit');
    w.check(sh, r, L.col.floor, e.floorPrice, 'ABU pricing', `${wf.name} — floor price`, 'unit');
    w.check(sh, r, L.col.price, e.price, 'ABU pricing', `${wf.name} — price per weighted ABU`, 'unit');
    w.put(`abup.${i}.price`, sh, r, L.col.price);
    w.put(`abup.${i}.rpa`, sh, r, L.col.rpa);
    r++;
  });
  const r1 = rows[rows.length - 1] ?? r;
  const r0b = rows[0] ?? r;
  w.label(sh, r, 1, 'Blended', 'total');
  w.total(sh, r, L.col.rec, `SUM(${c('rec')}${r0b}:${c('rec')}${r1})+SUM(${c('failx')}${r0b}:${c('failx')}${r1})`, 'money');
  w.check(sh, r, L.col.rec, s.recoveredCost, 'ABU pricing', 'ABU stream recovered cost', 'money');
  w.total(sh, r, L.col.rev, `SUM(${c('rev')}${r0b}:${c('rev')}${r1})`, 'money');
  w.total(sh, r, L.col.price, `IF(WeightedAbus=0,0,${c('rev')}${r}/WeightedAbus)`, 'unit');
  w.check(sh, r, L.col.price, s.abu.blendedPrice, 'ABU pricing', 'Blended price per weighted ABU', 'unit');
  b.define('AbuBlended', sh, r, L.col.price);
  b.define('AbuRevBasis', sh, r, L.col.rev);
  r += 2;

  // Class prices
  w.section(sh, r++, 'Prices by complexity class', 10);
  const LP = layout([
    { key: 'wf', header: 'Workflow id' },
    { key: 'cls', header: 'Class' },
    { key: 'share', header: 'Normalised share', width: 11 },
    { key: 'weight', header: 'ABU weight', width: 10 },
    { key: 'ov', header: 'Class price override', width: 12 },
    { key: 'price', header: 'Price per transaction', width: 12, check: true },
    { key: 'aprice', header: 'Human-assisted price', width: 12 },
  ]);
  LP.write(sh, w, r++);
  const pc = (k: string) => colName(LP.col[k]);
  const cx = w.pos('cx.wf');
  let cxRow = cx.r;
  const p0 = r;
  p.workflows.forEach((wf, i) => {
    const e = s.abu!.byWorkflow[wf.id];
    const classes = wf.complexity.length ? wf.complexity : [null];
    classes.forEach((cls, j) => {
      const x = (k: string) => `${pc(k)}${r}`;
      if (cls) {
        const ar = (col: number) => w.cell(cx.sheet, cxRow, col, sh);
        w.calc(sh, r, LP.col.wf, ar(1), 'text');
        w.calc(sh, r, LP.col.cls, ar(3), 'text');
        w.calc(sh, r, LP.col.share, `IF(${w.at(`abu.${i}.st`, sh)}=0,1/${w.at(`abu.${i}.n`, sh)},${ar(4)}/${w.at(`abu.${i}.st`, sh)})`, 'factor');
        w.calc(sh, r, LP.col.weight, ar(5), 'dec2');
        w.calc(sh, r, LP.col.ov, `IF(ISNUMBER(${ar(8)}),${ar(8)},"")`, 'unit');
        cxRow++;
      } else {
        w.calc(sh, r, LP.col.wf, w.at(`wf.${i}.id`, sh), 'text');
        w.label(sh, r, LP.col.cls, 'Standard', 'calc');
        w.calc(sh, r, LP.col.share, '1', 'factor');
        w.calc(sh, r, LP.col.weight, '1', 'dec2');
        w.calc(sh, r, LP.col.ov, '""', 'unit');
      }
      w.calc(sh, r, LP.col.price, `IF(AND(AbuClassPricing="override",ISNUMBER(${x('ov')})),${x('ov')},${w.at(`abup.${i}.price`, sh)}*${x('weight')})`, 'unit');
      w.calc(sh, r, LP.col.aprice, `${x('price')}*AbuAssistedFactor`, 'unit');
      w.check(sh, r, LP.col.price, e.classPrices[j]?.price ?? 0, 'ABU pricing', `${wf.name} / ${e.classPrices[j]?.name ?? 'Standard'} — class price`, 'unit');
      r++;
    });
  });
  const p1 = r - 1;
  w.put('cls.wf', sh, p0, LP.col.wf, p1, LP.col.wf);
  w.put('cls.share', sh, p0, LP.col.share, p1, LP.col.share);
  w.put('cls.price', sh, p0, LP.col.price, p1, LP.col.price);
  w.put('cls.aprice', sh, p0, LP.col.aprice, p1, LP.col.aprice);
}
