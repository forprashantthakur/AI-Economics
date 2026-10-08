import { ACU_RESOURCES, ACU_RESOURCE_KEYS, RUN_POOLS, POOL_LABELS, findWeightSet, safeDiv } from '@aies/engine';
import { colName } from './book';
import { fxf } from './assumptions';
import { layout, type Fmt, type WB } from './ctx';

const TOKEN_FORMULA: Partial<Record<string, string>> = {
  input_tokens_m: 'SUM(TokUncached)+SUM(TokCacheWrite)',
  cached_tokens_m: 'SUM(TokCacheRead)',
  output_tokens_m: 'SUM(TokOutput)',
  reasoning_tokens_m: 'SUM(TokReasoning)',
  llm_calls_k: 'SUM(TokCalls)',
};

/**
 * ACU sheet. Method A: eligible AI cost ÷ reference value. Method B:
 * Σ resource units ÷ scale × weight. Also splits ACUs into a per-attempted
 * variable part per workflow and a fixed part for the Projection.
 */
export function buildAcu(w: WB): void {
  const sh = w.s.acu;
  const p = w.r.project;
  const b = w.r.baseline;
  const book = w.book;
  const ws = findWeightSet(w.cat, p.acu.weightSetId);
  const wfs = p.workflows;
  w.title(sh, 'ACU — AI Consumption Units', 'Method A: ACUs = eligible AI consumption cost at base-year prices ÷ reference value. Method B: ACUs = Σ (resource units ÷ unit scale) × weight. Measurement is separate from price.');
  sh.width(1, 40);
  for (let c = 2; c <= 14; c++) sh.width(c, 14);
  sh.freeze = { row: 3, col: 1 };

  let r = 4;
  w.section(sh, r++, 'Measurement settings', 4);
  const scalar = (name: string, label: string, v: string | number, fmt: Fmt, list?: string[]) => {
    w.label(sh, r, 1, label);
    w.input(sh, r, 2, v, fmt, list ? { list } : {});
    book.define(name, sh, r, 2);
    r++;
  };
  scalar('AcuMethod', 'Selected method', p.acu.method, 'text', ['cost_normalized', 'weighted_resource']);
  scalar('AcuRefValue', 'Method A reference value (1 ACU =)', p.acu.referenceValue, 'dec4');
  scalar('AcuRefCurrency', 'Reference value currency', p.acu.referenceCurrency, 'text');
  w.label(sh, r, 1, `Reference value in ${w.cur}`);
  w.calc(sh, r, 2, `AcuRefValue*${fxf('AcuRefCurrency')}`, 'dec4');
  book.define('AcuRef', sh, r, 2);
  r++;
  w.label(sh, r, 1, 'Method B weight set');
  w.engine(sh, r, 2, ws ? `${ws.name} v${ws.version} (${ws.status})` : `${p.acu.weightSetId} (not found)`, 'text');
  r += 2;

  // ── Method A
  w.section(sh, r++, 'Method A — eligible cost pools', 6);
  w.header(sh, r++, 1, ['Cost pool', 'Eligible (1/0)', 'Monthly cost', 'Eligible cost']);
  const e0 = r;
  const elig = new Set(p.acu.eligiblePools);
  for (const pool of RUN_POOLS) {
    w.label(sh, r, 1, POOL_LABELS[pool]);
    w.input(sh, r, 2, elig.has(pool) ? 1 : 0, 'int');
    r++;
  }
  const e1 = r - 1;
  const poolRows = w.pos('pool.total');
  RUN_POOLS.forEach((_, k) => {
    const rr = e0 + k;
    w.calc(sh, rr, 3, w.cell(poolRows.sheet, poolRows.r + k, poolRows.c, sh), 'money2');
    w.calc(sh, rr, 4, `B${rr}*C${rr}`, 'money2');
  });
  book.define('AcuEligible', sh, e0, 2, e1, 2);
  w.label(sh, r, 1, 'Eligible AI consumption cost', 'total');
  w.total(sh, r, 4, `SUM(D${e0}:D${e1})`, 'money2');
  w.check(sh, r, 4, b.acu.eligibleCost, 'ACU', 'Eligible AI consumption cost', 'money2');
  r++;
  w.label(sh, r, 1, 'Method A ACUs (contract year 1 = base-year prices)', 'total');
  w.total(sh, r, 4, `IF(AcuRef=0,0,D${r - 1}/AcuRef)`, 'count2');
  w.check(sh, r, 4, b.acu.methodA, 'ACU', 'Method A ACUs', 'count2');
  book.define('AcuMethodA', sh, r, 4);
  r += 2;

  // ── Method B
  w.section(sh, r++, `Method B — weighted resources${ws ? ` (${ws.name} v${ws.version})` : ''}`, 9);
  const LB = layout([
    { key: 'key', header: 'Resource key', width: 22 },
    { key: 'label', header: 'Resource', width: 34 },
    { key: 'unit', header: 'Unit', width: 12 },
    { key: 'scale', header: 'Raw units per unit', width: 12 },
    { key: 'derived', header: 'Derived from workflow model', width: 11 },
    { key: 'weight', header: 'Weight (ACU per unit)', width: 11 },
    { key: 'raw', header: 'Raw units per month', width: 16 },
    { key: 'units', header: 'Units', width: 13, check: true },
    { key: 'acus', header: 'ACUs', width: 13 },
    { key: 'perraw', header: 'ACUs per raw unit', width: 12 },
  ], 1);
  // Shift Method B table to start at column 1 but keep column A wide for keys.
  LB.write(sh, w, r++);
  const bc = (k: string) => colName(LB.col[k]);
  const b0 = r;
  for (const key of ACU_RESOURCE_KEYS) {
    const def = ACU_RESOURCES[key];
    const x = (k: string) => `${bc(k)}${r}`;
    w.input(sh, r, LB.col.key, key, 'text');
    w.input(sh, r, LB.col.label, def.label, 'text');
    w.input(sh, r, LB.col.unit, def.unit, 'text');
    w.input(sh, r, LB.col.scale, def.scale, 'count');
    w.input(sh, r, LB.col.derived, def.derived ? 'Yes' : 'No', 'text');
    w.input(sh, r, LB.col.weight, ws?.weights[key] ?? 0, 'dec4');
    let raw: string;
    if (TOKEN_FORMULA[key]) raw = TOKEN_FORMULA[key]!;
    else if (key === 'workflow_executions_k') raw = wfs.length ? wfs.map((_, i) => w.at(`abu.${i}.exe`, sh)).join('+') : '0';
    else if (key === 'tool_calls_k') raw = wfs.length ? wfs.map((_, i) => w.at(`abu.${i}.tools`, sh)).join('+') : '0';
    else raw = `SUMPRODUCT((ExecAcuKey=${x('key')})*ExecUnits*ExecAcuPer)`;
    w.calc(sh, r, LB.col.raw, raw, 'count2');
    w.calc(sh, r, LB.col.units, `${x('raw')}/${x('scale')}`, 'dec4');
    w.calc(sh, r, LB.col.acus, `${x('units')}*${x('weight')}`, 'count2');
    w.calc(sh, r, LB.col.perraw, `IF(${x('derived')}="Yes",0,${x('weight')}/${x('scale')})`, 'factor');
    w.check(sh, r, LB.col.units, b.resources[key].div(def.scale), 'ACU', `Method B units — ${def.label}`, 'dec4');
    r++;
  }
  const b1 = r - 1;
  book.define('AcuKeys', sh, b0, LB.col.key, b1, LB.col.key);
  book.define('AcuPerRaw', sh, b0, LB.col.perraw, b1, LB.col.perraw);
  book.define('AcuWeightPerUnit', sh, b0, LB.col.weight, b1, LB.col.weight);
  book.define('AcuScale', sh, b0, LB.col.scale, b1, LB.col.scale);
  w.label(sh, r, 1, 'Method B ACUs', 'total');
  w.total(sh, r, LB.col.acus, `SUM(${bc('acus')}${b0}:${bc('acus')}${b1})`, 'count2');
  w.checkOnly(sh, r, LB.col.acus, b.acu.methodB, 'ACU', 'Method B ACUs');
  book.define('AcuMethodB', sh, r, LB.col.acus);
  r += 2;

  w.label(sh, r, 1, 'ACUs per month (selected method)', 'total');
  w.total(sh, r, 2, 'IF(AcuMethod="cost_normalized",AcuMethodA,AcuMethodB)', 'count2');
  w.check(sh, r, 2, b.acu.total, 'ACU', 'ACUs per month (selected method)', 'count2');
  book.define('AcuTotal', sh, r, 2);
  r += 2;

  // ── By workflow, with variable / fixed split for the projection
  const wIdx = (key: string) => `INDEX(AcuWeightPerUnit,MATCH("${key}",AcuKeys,0))/INDEX(AcuScale,MATCH("${key}",AcuKeys,0))`;
  w.section(sh, r++, 'ACUs by workflow (selected method) and projection drivers', 14);
  const L = layout([
    { key: 'id', header: 'Workflow id' },
    { key: 'aVar', header: 'Method A variable', width: 13 },
    { key: 'aTot', header: 'Method A incl. allocated fixed', width: 13 },
    { key: 'bVar', header: 'Method B variable', width: 13 },
    { key: 'bTot', header: 'Method B incl. allocated fixed', width: 13 },
    { key: 'tot', header: 'ACUs (selected)', width: 13, check: true },
    { key: 'perAtt', header: 'Variable ACUs per attempted', width: 13 },
    { key: 'perAbu', header: 'ACUs per weighted ABU', width: 12 },
  ]);
  L.write(sh, w, r++);
  const c = (k: string) => colName(L.col[k]);
  const w0 = r;
  wfs.forEach((wf, i) => {
    const x = (k: string) => `${c(k)}${r}`;
    const id = w.at(`wf.${i}.id`, sh);
    const tokB = [
      `(SUMIF(TokWf,${id},TokUncached)+SUMIF(TokWf,${id},TokCacheWrite))*${wIdx('input_tokens_m')}`,
      `SUMIF(TokWf,${id},TokCacheRead)*${wIdx('cached_tokens_m')}`,
      `SUMIF(TokWf,${id},TokOutput)*${wIdx('output_tokens_m')}`,
      `SUMIF(TokWf,${id},TokReasoning)*${wIdx('reasoning_tokens_m')}`,
      `SUMIF(TokWf,${id},TokCalls)*${wIdx('llm_calls_k')}`,
      `${w.at(`abu.${i}.exe`, sh)}*${wIdx('workflow_executions_k')}`,
      `${w.at(`abu.${i}.tools`, sh)}*${wIdx('tool_calls_k')}`,
    ].join('+');
    w.calc(sh, r, L.col.id, id, 'text');
    w.calc(sh, r, L.col.aVar, `IF(AcuRef=0,0,SUMPRODUCT(AcuEligible,${w.at(`pool.var.${i}`, sh)})/AcuRef)`, 'count2');
    w.calc(sh, r, L.col.aTot, `IF(AcuRef=0,0,SUMPRODUCT(AcuEligible,${w.at(`pool.wf.${i}`, sh)})/AcuRef)`, 'count2');
    w.calc(sh, r, L.col.bVar, `${tokB}+SUMPRODUCT(ExecIsVar,${w.at(`ex.u.${i}`, sh)},ExecAcuB)`, 'count2');
    w.calc(sh, r, L.col.bTot, `${tokB}+SUMPRODUCT(${w.at(`ex.u.${i}`, sh)},ExecAcuB)`, 'count2');
    w.calc(sh, r, L.col.tot, `IF(AcuMethod="cost_normalized",${x('aTot')},${x('bTot')})`, 'count2');
    w.calc(sh, r, L.col.perAtt, `IF(${w.at(`abu.${i}.att`, sh)}=0,0,IF(AcuMethod="cost_normalized",${x('aVar')},${x('bVar')})/${w.at(`abu.${i}.att`, sh)})`, 'factor');
    w.calc(sh, r, L.col.perAbu, `IF(${w.at(`abu.${i}.wabu`, sh)}=0,0,${x('tot')}/${w.at(`abu.${i}.wabu`, sh)})`, 'dec4');
    w.check(sh, r, L.col.tot, b.acu.byWorkflow[wf.id] ?? 0, 'ACU', `${wf.name} — ACUs`, 'count2');
    w.put(`acu.${i}.perAtt`, sh, r, L.col.perAtt);
    r++;
  });
  const w1 = r - 1;
  w.label(sh, r, 1, 'Fixed ACUs (not volume-driven)', 'total');
  w.total(
    sh,
    r,
    L.col.tot,
    `IF(AcuMethod="cost_normalized",IF(AcuRef=0,0,SUMPRODUCT(AcuEligible,${w.at('pool.fixed', sh)})/AcuRef),SUMPRODUCT(1-ExecIsVar,ExecUnits,ExecAcuB))`,
    'count2',
  );
  book.define('AcuFixed', sh, r, L.col.tot);
  r++;
  w.label(sh, r, 1, 'Total ACUs', 'total');
  w.total(sh, r, L.col.tot, wfs.length ? `SUM(${c('tot')}${w0}:${c('tot')}${w1})` : '0', 'count2');
  r++;
  w.label(sh, r, 1, 'ACUs per attempted transaction');
  w.calc(sh, r, 2, `IF(${w.at('abu.tot.att', sh)}=0,0,AcuTotal/${w.at('abu.tot.att', sh)})`, 'dec4');
  w.check(sh, r, 2, b.acu.perAttempted, 'ACU', 'ACUs per attempted transaction', 'dec4');
  r++;
  w.label(sh, r, 1, 'ACUs per weighted ABU');
  w.calc(sh, r, 2, 'IF(WeightedAbus=0,0,AcuTotal/WeightedAbus)', 'dec4');
  w.check(sh, r, 2, b.acu.perAcceptedAbu, 'ACU', 'ACUs per weighted ABU', 'dec4');
  r++;
  w.label(sh, r, 1, 'Run cost per ACU');
  w.calc(sh, r, 2, 'IF(AcuTotal=0,0,RunCost/AcuTotal)', 'unit');
  w.check(sh, r, 2, safeDiv(b.totalRunCost, b.acu.total), 'ACU', 'Run cost per ACU', 'unit');
  r += 2;
  w.note(sh, r, 1, 'Method B ignores cost lines mapped to derived resources (tokens, calls, executions) to avoid double counting.');
}
