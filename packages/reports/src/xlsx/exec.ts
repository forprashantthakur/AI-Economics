import { POOL_LABELS, RUN_POOLS, sum } from '@aies/engine';
import { colName } from './book';
import { fxf } from './assumptions';
import { layout, type WB } from './ctx';

const VAR_BASES = ['per_execution', 'per_attempted', 'per_accepted', 'per_llm_call'] as const;
const ALLOC = ['by_attempted', 'by_executions', 'by_llm_cost', 'equal'] as const;

/**
 * Execution Costs: every non-LLM cost line (units and cost per workflow from
 * ABU-sheet drivers), human review, cost pools by workflow (variable / fixed),
 * failed-work cost, and the per-attempted drivers used by the Projection.
 */
export function buildExec(w: WB): void {
  const sh = w.s.exec;
  const p = w.r.project;
  const b = w.r.baseline;
  const book = w.book;
  const wfs = p.workflows;
  const N = wfs.length;
  w.title(sh, 'Execution Costs', 'Variable lines: units = driver × quantity × (consumption mix if complexity-scaled); cost = units × unit cost. Fixed lines: monthly cost allocated to workflows by the selected key. All at steady state, contract year 1 prices.');
  sh.width(1, 40);
  sh.freeze = { row: 3, col: 1 };
  const att = (i: number) => w.at(`abu.${i}.att`, sh);
  const acc = (i: number) => w.at(`abu.${i}.acc`, sh);

  let r = 4;
  // ── Allocation keys & waste fractions
  w.section(sh, r++, 'Allocation keys for shared fixed cost (share of each workflow)', 2 + N);
  w.header(sh, r++, 1, ['Allocation method', ...wfs.map((wf) => wf.name)]);
  const al0 = r;
  for (const m of ALLOC) {
    w.input(sh, r, 1, m, 'text');
    wfs.forEach((_, i) => {
      const weight = (j: number) =>
        m === 'by_attempted' ? att(j) : m === 'by_executions' ? w.at(`abu.${j}.exe`, sh) : m === 'by_llm_cost' ? `SUMIF(TokWf,${w.at(`wf.${j}.id`, sh)},TokCost)` : '1';
      const tot = wfs.map((_, j) => weight(j)).join('+');
      w.calc(sh, r, 2 + i, `IF((${tot})=0,1/${N},(${weight(i)})/(${tot}))`, 'factor');
    });
    r++;
  }
  book.define('AllocMethods', sh, al0, 1, r - 1, 1);
  wfs.forEach((_, i) => w.put(`alloc.${i}`, sh, al0, 2 + i, r - 1, 2 + i));
  r++;
  w.section(sh, r++, 'Share of variable cost that does not produce an accepted outcome', 2 + N);
  w.header(sh, r++, 1, ['Cost basis', ...wfs.map((wf) => wf.name)]);
  const ws0 = r;
  for (const m of VAR_BASES) {
    w.input(sh, r, 1, m, 'text');
    wfs.forEach((_, i) => {
      const drv = m === 'per_execution' ? w.at(`abu.${i}.exe`, sh) : m === 'per_attempted' ? att(i) : m === 'per_accepted' ? acc(i) : w.at(`abu.${i}.eq`, sh);
      w.calc(sh, r, 2 + i, m === 'per_accepted' ? '0' : `IF(${drv}=0,0,1-${acc(i)}/${drv})`, 'factor');
    });
    r++;
  }
  book.define('WasteBasis', sh, ws0, 1, r - 1, 1);
  wfs.forEach((_, i) => w.put(`waste.${i}`, sh, ws0, 2 + i, r - 1, 2 + i));
  r++;

  // ── Cost lines
  w.section(sh, r++, 'Cost lines', 20 + 3 * N);
  const defs = [
    { key: 'name', header: 'Cost line' },
    { key: 'cat', header: 'Cost pool', width: 15 },
    { key: 'basis', header: 'Basis', width: 15 },
    { key: 'wf', header: 'Workflow id (blank = all)', width: 16 },
    { key: 'alloc', header: 'Allocation', width: 13 },
    { key: 'scales', header: 'Scales with complexity', width: 10 },
    { key: 'unit', header: 'Unit', width: 14 },
    { key: 'uc', header: 'Unit cost', width: 11 },
    { key: 'cur', header: 'Currency', width: 8 },
    { key: 'qty', header: 'Quantity', width: 11 },
    { key: 'shared', header: 'Shared total', width: 11 },
    { key: 'scur', header: 'Shared currency', width: 8 },
    { key: 'apct', header: 'Allocation %', width: 9 },
    { key: 'ucp', header: `Unit cost (${w.cur})`, width: 12 },
    { key: 'isvar', header: 'Variable', width: 8 },
    { key: 'fixed', header: 'Fixed monthly cost', width: 13 },
    { key: 'lunits', header: 'Fixed units', width: 10 },
    ...wfs.flatMap((wf, i) => [
      { key: `u${i}`, header: `Units — ${wf.name}`, width: 13 },
      { key: `c${i}`, header: `Cost — ${wf.name}`, width: 13 },
      { key: `f${i}`, header: `Failed work — ${wf.name}`, width: 12 },
    ]),
    { key: 'tunits', header: 'Units (total)', width: 13 },
    { key: 'cost', header: 'Monthly cost', width: 14, check: true },
    { key: 'fail', header: 'Failed / rejected work cost', width: 13, check: true },
    { key: 'acukey', header: 'ACU resource key', width: 18 },
    { key: 'acuper', header: 'ACU units per unit', width: 10 },
    { key: 'acub', header: 'Method B ACUs per unit', width: 11 },
  ];
  const L = layout(defs);
  L.write(sh, w, r++);
  const c = (k: string) => colName(L.col[k]);
  const items = new Map(w.cat.cloudPrices.map((x) => [x.id, x]));
  const l0 = r;
  p.costLines.forEach((line, li) => {
    const res = b.costLines[li];
    const item = line.priceRef ? items.get(line.priceRef) : undefined;
    const x = (k: string) => `${c(k)}${r}`;
    w.input(sh, r, L.col.name, line.name, 'text', item ? { note: `Unit cost from price table item "${item.id}" (${item.service}).` } : {});
    w.input(sh, r, L.col.cat, line.category, 'text');
    w.input(sh, r, L.col.basis, line.basis, 'text', { list: ['fixed_monthly', 'allocated_shared', ...VAR_BASES] });
    w.input(sh, r, L.col.wf, line.workflowId ?? '', 'text');
    w.input(sh, r, L.col.alloc, line.workflowAllocation, 'text', { list: [...ALLOC] });
    w.input(sh, r, L.col.scales, line.scalesWithComplexity ? 'Yes' : 'No', 'text', { list: ['Yes', 'No'] });
    w.input(sh, r, L.col.unit, item?.unitLabel ?? line.unitLabel, 'text');
    w.input(sh, r, L.col.uc, item ? item.unitCost : line.unitCost, 'dec4');
    w.input(sh, r, L.col.cur, item ? item.currency : line.currency, 'text');
    w.input(sh, r, L.col.qty, line.quantity, 'dec4');
    w.input(sh, r, L.col.shared, line.sharedTotalMonthly ?? 0, 'money2');
    w.input(sh, r, L.col.scur, line.currency, 'text');
    w.input(sh, r, L.col.apct, line.allocationPct ?? 0, 'pct');
    w.calc(sh, r, L.col.ucp, `${x('uc')}*${fxf(x('cur'))}`, 'dec4');
    w.calc(sh, r, L.col.isvar, `IF(OR(${x('basis')}="fixed_monthly",${x('basis')}="allocated_shared"),0,1)`, 'int');
    w.calc(sh, r, L.col.fixed, `IF(${x('basis')}="fixed_monthly",${x('qty')}*${x('ucp')},IF(${x('basis')}="allocated_shared",${x('shared')}*${fxf(x('scur'))}*${x('apct')}/100,0))`, 'money2');
    w.calc(sh, r, L.col.lunits, `IF(${x('basis')}="fixed_monthly",${x('qty')},IF(${x('basis')}="allocated_shared",${x('apct')}/100,0))`, 'dec4');
    const known = N ? `COUNTIF(WfIds,${x('wf')})>0` : 'FALSE';
    wfs.forEach((_, i) => {
      const id = w.at(`wf.${i}.id`, sh);
      const applies = `IF(${x('wf')}="",1,IF(${x('wf')}=${id},1,0))`;
      const drv = `IF(${x('basis')}="per_execution",${w.at(`abu.${i}.exe`, sh)},IF(${x('basis')}="per_attempted",${att(i)},IF(${x('basis')}="per_accepted",${acc(i)},${w.at(`abu.${i}.calls`, sh)})))`;
      const share = `IF(AND(${x('wf')}<>"",${known}),IF(${x('wf')}=${id},1,0),INDEX(${w.at(`alloc.${i}`, sh)},MATCH(${x('alloc')},AllocMethods,0)))`;
      w.calc(sh, r, L.col[`u${i}`], `IF(${x('isvar')}=1,${applies}*${drv}*${x('qty')}*IF(${x('scales')}="Yes",${w.at(`abu.${i}.mix`, sh)},1),IF(${x('fixed')}=0,0,${x('lunits')}*${share}))`, 'count2');
      w.calc(sh, r, L.col[`c${i}`], `IF(${x('isvar')}=1,${x(`u${i}`)}*${x('ucp')},${x('fixed')}*${share})`, 'money2');
      w.calc(sh, r, L.col[`f${i}`], `IF(${x('isvar')}=1,${x(`c${i}`)}*INDEX(${w.at(`waste.${i}`, sh)},MATCH(${x('basis')},WasteBasis,0)),0)`, 'money2');
    });
    const sumOf = (pre: string) => (N ? wfs.map((_, i) => x(`${pre}${i}`)).join('+') : '0');
    w.calc(sh, r, L.col.tunits, sumOf('u'), 'count2');
    w.calc(sh, r, L.col.cost, `IF(${x('isvar')}=1,${sumOf('c')},${x('fixed')})`, 'money2');
    w.calc(sh, r, L.col.fail, sumOf('f'), 'money2');
    w.check(sh, r, L.col.cost, res.monthlyCost, 'Execution costs', `${line.name} — monthly cost`, 'money2');
    w.check(sh, r, L.col.fail, res.failureCost, 'Execution costs', `${line.name} — failed work cost`, 'money2');
    w.input(sh, r, L.col.acukey, line.acuResourceKey ?? item?.acuResourceKey ?? '', 'text');
    w.input(sh, r, L.col.acuper, line.acuUnitsPerUnit ?? item?.acuUnitsPerUnit ?? 1, 'dec4');
    w.calc(sh, r, L.col.acub, `IF(${x('acukey')}="",0,IFERROR(INDEX(AcuPerRaw,MATCH(${x('acukey')},AcuKeys,0)),0))*${x('acuper')}`, 'factor');
    r++;
  });
  if (r === l0) {
    w.note(sh, r, 1, '(no cost lines)');
    r++;
  }
  const l1 = r - 1;
  for (const [name, k] of [
    ['ExecCat', 'cat'],
    ['ExecIsVar', 'isvar'],
    ['ExecCost', 'cost'],
    ['ExecFail', 'fail'],
    ['ExecUnits', 'tunits'],
    ['ExecAcuKey', 'acukey'],
    ['ExecAcuPer', 'acuper'],
    ['ExecAcuB', 'acub'],
  ] as const)
    book.define(name, sh, l0, L.col[k], l1, L.col[k]);
  wfs.forEach((_, i) => {
    w.put(`ex.u.${i}`, sh, l0, L.col[`u${i}`], l1, L.col[`u${i}`]);
    w.put(`ex.c.${i}`, sh, l0, L.col[`c${i}`], l1, L.col[`c${i}`]);
    w.put(`ex.f.${i}`, sh, l0, L.col[`f${i}`], l1, L.col[`f${i}`]);
  });
  w.label(sh, r, 1, 'Total', 'total');
  w.total(sh, r, L.col.cost, `SUM(${c('cost')}${l0}:${c('cost')}${l1})`, 'money2');
  w.check(sh, r, L.col.cost, sum(b.costLines.map((x) => x.monthlyCost)), 'Execution costs', 'Total cost lines', 'money2');
  w.total(sh, r, L.col.fail, `SUM(${c('fail')}${l0}:${c('fail')}${l1})`, 'money2');
  r += 2;

  // ── Human review
  w.section(sh, r++, 'Human review and exceptions', 16);
  const LH = layout([
    { key: 'name', header: 'Workflow' },
    { key: 'borne', header: 'Borne by', width: 10 },
    { key: 'rate', header: `Hourly cost (${w.cur})`, width: 12 },
    { key: 'ah', header: 'Assisted hours', width: 12 },
    { key: 'rh', header: 'Rework hours', width: 12 },
    { key: 'cost', header: 'Provider cost', width: 13, check: true },
    { key: 'rw', header: 'Rework cost (failed work)', width: 13 },
    { key: 'ch', header: 'Client review hours', width: 12, check: true },
  ]);
  LH.write(sh, w, r++);
  const hc = (k: string) => colName(LH.col[k]);
  wfs.forEach((wf, i) => {
    const x = (k: string) => `${hc(k)}${r}`;
    const A = (k: string) => w.at(`wf.${i}.${k}`, sh);
    w.calc(sh, r, LH.col.name, A('name'), 'text');
    w.calc(sh, r, LH.col.borne, A('borne'), 'text');
    w.calc(sh, r, LH.col.rate, `${A('hrCost')}*${fxf(A('hrCur'))}`, 'money2');
    w.calc(sh, r, LH.col.ah, `${w.at(`abu.${i}.ha`, sh)}*${A('minA')}*${w.at(`abu.${i}.hmix`, sh)}/60`, 'count2');
    w.calc(sh, r, LH.col.rh, `${w.at(`abu.${i}.rej`, sh)}*${A('minR')}/60`, 'count2');
    w.calc(sh, r, LH.col.cost, `IF(${x('borne')}="provider",(${x('ah')}+${x('rh')})*${x('rate')},0)`, 'money2');
    w.calc(sh, r, LH.col.rw, `IF(${x('borne')}="provider",${x('rh')}*${x('rate')},0)`, 'money2');
    w.calc(sh, r, LH.col.ch, `IF(${x('borne')}="provider",0,${x('ah')})`, 'count2');
    w.check(sh, r, LH.col.cost, b.humanReviewByWorkflow[wf.id] ?? 0, 'Execution costs', `${wf.name} — human review cost`, 'money2');
    w.check(sh, r, LH.col.ch, b.clientReviewHoursByWorkflow[wf.id] ?? 0, 'Execution costs', `${wf.name} — client review hours`, 'count2');
    w.put(`hr.${i}.cost`, sh, r, LH.col.cost);
    w.put(`hr.${i}.rw`, sh, r, LH.col.rw);
    w.put(`hr.${i}.ch`, sh, r, LH.col.ch);
    w.put(`hr.${i}.ah`, sh, r, LH.col.ah);
    r++;
  });
  r++;

  buildPools(w, r);
}

/** Cost pools × workflows: variable, fixed, total and failed-work cost; plus projection drivers. */
function buildPools(w: WB, r0: number): void {
  const sh = w.s.exec;
  const p = w.r.project;
  const b = w.r.baseline;
  const book = w.book;
  const wfs = p.workflows;
  const N = wfs.length;
  let r = r0;
  w.section(sh, r++, 'Run cost by pool and workflow (steady-state month)', 6 + 4 * N);
  const L = layout([
    { key: 'pool', header: 'Cost pool' },
    ...wfs.map((wf, i) => ({ key: `v${i}`, header: `Variable — ${wf.name}`, width: 13 })),
    ...wfs.map((wf, i) => ({ key: `x${i}`, header: `Fixed — ${wf.name}`, width: 13 })),
    ...wfs.map((wf, i) => ({ key: `t${i}`, header: `Total — ${wf.name}`, width: 13 })),
    { key: 'vt', header: 'Variable total', width: 13 },
    { key: 'xt', header: 'Fixed total', width: 13 },
    { key: 'tot', header: 'Pool total', width: 14, check: true },
    ...wfs.map((wf, i) => ({ key: `f${i}`, header: `Failed work — ${wf.name}`, width: 13 })),
  ]);
  L.write(sh, w, r++);
  const c = (k: string) => colName(L.col[k]);
  const p0 = r;
  for (const pool of RUN_POOLS) {
    const x = (k: string) => `${c(k)}${r}`;
    w.label(sh, r, L.col.pool, POOL_LABELS[pool]);
    wfs.forEach((wf, i) => {
      const id = w.at(`wf.${i}.id`, sh);
      const cr = w.at(`ex.c.${i}`, sh);
      const fr = w.at(`ex.f.${i}`, sh);
      let v: string;
      let f: string;
      if (pool === 'LLM') {
        v = `SUMIF(TokWf,${id},TokCost)`;
        f = `IF(${w.at(`abu.${i}.eq`, sh)}=0,0,${x(`v${i}`)}*(1-${w.at(`abu.${i}.acc`, sh)}/${w.at(`abu.${i}.eq`, sh)}))`;
      } else if (pool === 'HUMAN_REVIEW') {
        v = w.at(`hr.${i}.cost`, sh);
        f = w.at(`hr.${i}.rw`, sh);
      } else {
        v = `SUMIFS(${cr},ExecCat,"${pool}",ExecIsVar,1)`;
        f = `SUMIF(ExecCat,"${pool}",${fr})`;
      }
      w.calc(sh, r, L.col[`v${i}`], v, 'money2');
      w.calc(sh, r, L.col[`x${i}`], pool === 'LLM' || pool === 'HUMAN_REVIEW' ? '0' : `SUMIFS(${cr},ExecCat,"${pool}",ExecIsVar,0)`, 'money2');
      w.calc(sh, r, L.col[`t${i}`], `${x(`v${i}`)}+${x(`x${i}`)}`, 'money2');
      w.calc(sh, r, L.col[`f${i}`], f, 'money2');
    });
    w.calc(sh, r, L.col.vt, N ? wfs.map((_, i) => x(`v${i}`)).join('+') : '0', 'money2');
    w.calc(sh, r, L.col.xt, pool === 'LLM' || pool === 'HUMAN_REVIEW' ? '0' : `SUMIFS(ExecCost,ExecCat,"${pool}",ExecIsVar,0)`, 'money2');
    w.calc(sh, r, L.col.tot, `${x('vt')}+${x('xt')}`, 'money2');
    w.check(sh, r, L.col.tot, b.pools[pool], 'Execution costs', `Pool — ${POOL_LABELS[pool]}`, 'money2');
    r++;
  }
  const p1 = r - 1;
  w.put('pool.total', sh, p0, L.col.tot, p1, L.col.tot);
  w.put('pool.var', sh, p0, L.col.vt, p1, L.col.vt);
  w.put('pool.fixed', sh, p0, L.col.xt, p1, L.col.xt);
  book.define('PoolTotals', sh, p0, L.col.tot, p1, L.col.tot);
  wfs.forEach((_, i) => {
    w.put(`pool.wf.${i}`, sh, p0, L.col[`t${i}`], p1, L.col[`t${i}`]);
    w.put(`pool.var.${i}`, sh, p0, L.col[`v${i}`], p1, L.col[`v${i}`]);
    w.put(`fail.wf.${i}`, sh, p0, L.col[`f${i}`], p1, L.col[`f${i}`]);
  });
  w.label(sh, r, 1, 'Total run cost', 'total');
  const sumCol = (k: string) => `SUM(${c(k)}${p0}:${c(k)}${p1})`;
  wfs.forEach((_, i) => {
    w.total(sh, r, L.col[`t${i}`], sumCol(`t${i}`), 'money2');
    w.total(sh, r, L.col[`f${i}`], sumCol(`f${i}`), 'money2');
    w.put(`exec.run.${i}`, sh, r, L.col[`t${i}`]);
    w.put(`exec.fail.${i}`, sh, r, L.col[`f${i}`]);
    w.total(sh, r, L.col[`v${i}`], sumCol(`v${i}`), 'money2');
    w.total(sh, r, L.col[`x${i}`], sumCol(`x${i}`), 'money2');
  });
  w.total(sh, r, L.col.vt, sumCol('vt'), 'money2');
  w.total(sh, r, L.col.xt, sumCol('xt'), 'money2');
  w.total(sh, r, L.col.tot, sumCol('tot'), 'money2');
  w.check(sh, r, L.col.tot, b.totalRunCost, 'Execution costs', 'Total run cost', 'money2');
  book.define('RunCost', sh, r, L.col.tot);
  book.define('FixedCost', sh, r, L.col.xt);
  r += 2;

  // ── Projection drivers
  w.section(sh, r++, 'Projection drivers (per attempted transaction, contract-year-1 prices)', 6);
  w.note(sh, r++, 1, 'Within a contract year every variable cost is linear in each workflow’s attempted volume, and fixed cost changes only with annual inflation, so: month cost = Σ attempted × (LLM per attempted × LLM price factor + other variable per attempted × inflation factor) + fixed × inflation factor.');
  w.header(sh, r++, 1, ['Workflow', 'Attempted (steady)', 'LLM cost per attempted', 'Other variable cost per attempted', 'Weighted ABUs per attempted', 'Accepted per attempted']);
  wfs.forEach((_, i) => {
    const a = w.at(`abu.${i}.att`, sh);
    const llmRow = w.pos(`pool.var.${i}`).r;
    w.calc(sh, r, 1, w.at(`wf.${i}.name`, sh), 'text');
    w.calc(sh, r, 2, a, 'count2');
    w.calc(sh, r, 3, `IF(B${r}=0,0,${c(`v${i}`)}${llmRow}/B${r})`, 'unit');
    w.calc(sh, r, 4, `IF(B${r}=0,0,(SUM(${w.at(`pool.var.${i}`, sh)})-${c(`v${i}`)}${llmRow})/B${r})`, 'unit');
    w.calc(sh, r, 5, `IF(B${r}=0,0,${w.at(`abu.${i}.wabu`, sh)}/B${r})`, 'factor');
    w.calc(sh, r, 6, `IF(B${r}=0,0,${w.at(`abu.${i}.acc`, sh)}/B${r})`, 'factor');
    w.put(`drv.${i}.llm`, sh, r, 3);
    w.put(`drv.${i}.non`, sh, r, 4);
    w.put(`drv.${i}.wabu`, sh, r, 5);
    w.put(`drv.${i}.acc`, sh, r, 6);
    r++;
  });
}
