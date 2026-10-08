import { colName } from './book';
import { layout, type ColDef, type WB } from './ctx';
import { streamRevenue, type RevCtx } from './pricing-sheet';

/**
 * Projection: month 0 (implementation) and run months 1..T. Within a contract
 * year every variable cost is linear in each workflow's attempted volume and
 * fixed cost changes only with annual inflation, so
 *   month cost = Σ_w attempted_w × (LLM per attempted_w × LLM price factor + other variable per attempted_w × inflation)
 *              + fixed × inflation
 * reproduces the engine exactly. Revenue mirrors the engine's billing rules per stream.
 */
export function buildProjection(w: WB): void {
  const sh = w.s.proj;
  const p = w.r.project;
  const r_ = w.r;
  const wfs = p.workflows;
  const streams = p.pricing.streams.filter((s) => s.enabled);
  const book = w.book;
  w.title(sh, 'Projection', 'Month 0 is implementation; run months follow go-live. Ramp and growth drive attempted volume; costs inflate and prices escalate by contract year. Engine and Δ columns check each month against the engine.');
  sh.freeze = { row: 4, col: 2 };

  const defs: ColDef[] = [
    { key: 'm', header: 'Month', width: 7 },
    { key: 'period', header: 'Period', width: 9 },
    { key: 'yi', header: 'Contract year index', width: 8 },
    { key: 'ramp', header: 'Ramp factor', width: 9 },
    { key: 'esc', header: 'Price escalation factor', width: 10 },
    { key: 'infl', header: 'Cost inflation factor', width: 10 },
    { key: 'llmf', header: 'LLM price factor', width: 10 },
    ...wfs.map((wf, i) => ({ key: `att${i}`, header: `Attempted — ${wf.name}`, width: 13 })),
    { key: 'att', header: 'Attempted', width: 13 },
    { key: 'acc', header: 'Accepted', width: 13 },
    { key: 'wabu', header: 'Weighted ABUs', width: 13, check: true },
    { key: 'acu', header: 'ACUs', width: 13, check: true },
    { key: 'llm', header: 'LLM cost', width: 13 },
    { key: 'run', header: 'Run cost', width: 14 },
    { key: 'impl', header: 'Implementation cost', width: 14 },
    { key: 'cost', header: 'Total cost', width: 14, check: true },
    ...streams.map((s) => ({ key: `rev.${s.id}`, header: `Revenue — ${s.label}`, width: 14 })),
    { key: 'rev', header: 'Revenue', width: 14, check: true },
    { key: 'rec', header: 'Recurring revenue', width: 14 },
    { key: 'gp', header: 'Gross profit', width: 14 },
  ];
  const L = layout(defs);
  w.section(sh, 3, 'Monthly projection', 12);
  L.write(sh, w, 4);
  const c = (k: string) => colName(L.col[k]);
  const r0 = 5;
  const T = r_.months.length - 1;

  r_.months.forEach((mr, idx) => {
    const r = r0 + idx;
    const x = (k: string) => `${c(k)}${r}`;
    w.input(sh, r, L.col.m, mr.month, 'int');
    w.label(sh, r, L.col.period, mr.month === 0 ? 'Build' : mr.period, 'calc');
    w.calc(sh, r, L.col.yi, `IF(${x('m')}=0,0,INT((${x('m')}-1)/12))`, 'int');
    w.calc(sh, r, L.col.ramp, `IF(${x('m')}<=0,0,IF(OR(RampMonths<=0,${x('m')}>RampMonths),1,RampStartPct/100+(1-RampStartPct/100)*(${x('m')}-1)/RampMonths))`, 'factor');
    w.calc(sh, r, L.col.esc, `(1+PriceEscalationPct/100)^${x('yi')}`, 'factor');
    w.calc(sh, r, L.col.infl, `(1+CostInflationPct/100)^${x('yi')}`, 'factor');
    w.calc(sh, r, L.col.llmf, `(1+LlmPriceChangePct/100)^${x('yi')}`, 'factor');
    wfs.forEach((_, i) => w.calc(sh, r, L.col[`att${i}`], `IF(${x('m')}=0,0,${w.at(`wf.${i}.vol`, sh)}*${x('ramp')}*(1+${w.at(`wf.${i}.growth`, sh)}/100)^${x('yi')})`, 'count2'));
    const S = (f: (i: number) => string) => (wfs.length ? wfs.map((_, i) => f(i)).join('+') : '0');
    const att = (i: number) => x(`att${i}`);
    w.calc(sh, r, L.col.att, S(att), 'count2');
    w.calc(sh, r, L.col.acc, S((i) => `${att(i)}*${w.at(`drv.${i}.acc`, sh)}`), 'count2');
    w.calc(sh, r, L.col.wabu, S((i) => `${att(i)}*${w.at(`drv.${i}.wabu`, sh)}`), 'count2');
    w.calc(sh, r, L.col.acu, `IF(${x('m')}=0,0,${S((i) => `${att(i)}*${w.at(`acu.${i}.perAtt`, sh)}`)}+AcuFixed)`, 'count2');
    w.calc(sh, r, L.col.llm, S((i) => `${att(i)}*${w.at(`drv.${i}.llm`, sh)}*${x('llmf')}`), 'money');
    w.calc(sh, r, L.col.run, `IF(${x('m')}=0,0,${x('llm')}+(${S((i) => `${att(i)}*${w.at(`drv.${i}.non`, sh)}`)})*${x('infl')}+FixedCost*${x('infl')})`, 'money');
    w.calc(sh, r, L.col.impl, `IF(${x('m')}=0,ImplCost,0)`, 'money');
    w.calc(sh, r, L.col.cost, `${x('run')}+${x('impl')}`, 'money');

    const ctx: RevCtx = {
      esc: x('esc'),
      acus: x('acu'),
      wabus: x('wabu'),
      abuRaw: r_.priceBook.streams.some((s) => s.type === 'abu') ? S((i) => `${att(i)}*${w.at(`abup.${i}.rpa`, sh)}`) : '0',
      passCost: (s) => {
        const k = `st.${s.id}`;
        const own = w.at(`${k}.llm`, sh);
        const varPart = S((i) => `${att(i)}*((${w.at(`${k}.var.${i}`, sh)}-${own}*${w.at(`drv.${i}.llm`, sh)})*${x('infl')}+${own}*${w.at(`drv.${i}.llm`, sh)}*${x('llmf')})`);
        return `(${varPart}+${w.at(`${k}.fixed`, sh)}*${x('infl')})`;
      },
      validated: () => w.at(`val.m.${idx}.validated`, sh),
      forecast: () => w.at(`val.m.${idx}.forecast`, sh),
    };
    for (const s of streams) {
      const key = `rev.${s.id}`;
      if (s.type === 'fixed_fee') w.calc(sh, r, L.col[key], `IF(${x('m')}=0,${w.at(`st.${s.id}.fee`, sh)},0)`, 'money');
      else w.calc(sh, r, L.col[key], () => `IF(${x('m')}=0,0,${streamRevenue(w, sh, s, ctx)})`, 'money');
    }
    const revCols = streams.map((s) => x(`rev.${s.id}`));
    const fixedCols = streams.filter((s) => s.type === 'fixed_fee').map((s) => x(`rev.${s.id}`));
    w.calc(sh, r, L.col.rev, revCols.length ? revCols.join('+') : '0', 'money');
    w.calc(sh, r, L.col.rec, fixedCols.length ? `${x('rev')}-(${fixedCols.join('+')})` : x('rev'), 'money');
    w.calc(sh, r, L.col.gp, `${x('rev')}-${x('cost')}`, 'money');
    w.check(sh, r, L.col.wabu, mr.weightedAbus, 'Projection', `M${mr.month} weighted ABUs`, 'count2');
    w.check(sh, r, L.col.acu, mr.acus, 'Projection', `M${mr.month} ACUs`, 'count2');
    w.check(sh, r, L.col.cost, mr.totalCost, 'Projection', `M${mr.month} total cost`, 'money');
    w.check(sh, r, L.col.rev, mr.revenue, 'Projection', `M${mr.month} revenue`, 'money');
    w.put(`proj.${idx}.rev`, sh, r, L.col.rev);
    w.put(`proj.${idx}.att`, sh, r, L.col.att);
    w.put(`proj.${idx}.yi`, sh, r, L.col.yi);
    w.put(`proj.${idx}.infl`, sh, r, L.col.infl);
    w.put(`proj.${idx}.m`, sh, r, L.col.m);
    wfs.forEach((_, i) => w.put(`proj.${idx}.att${i}`, sh, r, L.col[`att${i}`]));
  });
  const r1 = r0 + T;
  for (const [name, k] of [
    ['PrjMonth', 'm'],
    ['PrjYear', 'yi'],
    ['PrjAtt', 'att'],
    ['PrjAcc', 'acc'],
    ['PrjAbu', 'wabu'],
    ['PrjAcu', 'acu'],
    ['PrjLlm', 'llm'],
    ['PrjRun', 'run'],
    ['PrjCost', 'cost'],
    ['PrjRev', 'rev'],
    ['PrjRec', 'rec'],
  ] as const)
    book.define(name, sh, r0, L.col[k], r1, L.col[k]);

  // ── Term totals
  let r = r1 + 1;
  w.label(sh, r, 1, 'Term', 'total');
  for (const k of ['att', 'acc', 'wabu', 'acu', 'llm', 'run', 'impl', 'cost', 'rev', 'rec', 'gp', ...streams.map((s) => `rev.${s.id}`)]) w.total(sh, r, L.col[k], `SUM(${c(k)}${r0}:${c(k)}${r1})`, ['att', 'acc', 'wabu', 'acu'].includes(k) ? 'count2' : 'money');
  w.check(sh, r, L.col.rev, r_.economics.provider.tcv, 'Projection', 'Total contract value (Σ monthly revenue)', 'money');
  w.check(sh, r, L.col.cost, r_.economics.provider.totalCost, 'Projection', 'Total provider cost', 'money');
  r += 3;

  // ── Yearly summary
  w.section(sh, r++, 'Yearly summary (year 1 includes month 0)', 18);
  const LY = layout([
    { key: 'y', header: 'Year', width: 9 },
    { key: 'yi', header: 'Year index', width: 8 },
    { key: 'rev', header: 'Revenue', width: 14, check: true },
    { key: 'rec', header: 'Recurring', width: 14 },
    { key: 'one', header: 'One-time', width: 14 },
    { key: 'cost', header: 'Cost', width: 14, check: true },
    { key: 'llm', header: 'LLM cost', width: 13 },
    { key: 'gp', header: 'Gross profit', width: 14 },
    { key: 'mg', header: 'Margin %', width: 9, check: true },
    { key: 'att', header: 'Attempted', width: 12 },
    { key: 'abu', header: 'Weighted ABUs', width: 12 },
    { key: 'acu', header: 'ACUs', width: 13 },
  ]);
  LY.write(sh, w, r++);
  const yc = (k: string) => colName(LY.col[k]);
  r_.years.forEach((y) => {
    const x = (k: string) => `${yc(k)}${r}`;
    w.input(sh, r, LY.col.y, y.label, 'text');
    w.input(sh, r, LY.col.yi, y.year - 1, 'int');
    const sf = (name: string) => `SUMIF(PrjYear,${x('yi')},${name})`;
    w.calc(sh, r, LY.col.rev, sf('PrjRev'), 'money');
    w.calc(sh, r, LY.col.rec, sf('PrjRec'), 'money');
    w.calc(sh, r, LY.col.one, `${x('rev')}-${x('rec')}`, 'money');
    w.calc(sh, r, LY.col.cost, sf('PrjCost'), 'money');
    w.calc(sh, r, LY.col.llm, sf('PrjLlm'), 'money');
    w.calc(sh, r, LY.col.gp, `${x('rev')}-${x('cost')}`, 'money');
    w.calc(sh, r, LY.col.mg, `IF(${x('rev')}=0,0,${x('gp')}/${x('rev')}*100)`, 'pct');
    w.calc(sh, r, LY.col.att, sf('PrjAtt'), 'count2');
    w.calc(sh, r, LY.col.abu, sf('PrjAbu'), 'count2');
    w.calc(sh, r, LY.col.acu, sf('PrjAcu'), 'count2');
    w.check(sh, r, LY.col.rev, y.revenue, 'Projection', `${y.label} revenue`, 'money');
    w.check(sh, r, LY.col.cost, y.cost, 'Projection', `${y.label} cost`, 'money');
    w.check(sh, r, LY.col.mg, y.marginPct, 'Projection', `${y.label} margin`, 'pct');
    r++;
  });
  r++;

  // ── Provider economics
  w.section(sh, r++, 'Provider economics', 4);
  // Labels overflow across the narrow month columns; values sit in column F.
  w.header(sh, r, 1, ['Measure', '', '', '', '']);
  w.header(sh, r++, 6, ['Value', 'Engine', 'Δ']);
  const e = r_.economics.provider;
  const line = (name: string, label: string, f: string, ev: number | { toNumber(): number }, fmt: 'money' | 'pct' | 'unit') => {
    w.label(sh, r, 1, label, 'text');
    w.calc(sh, r, 6, f, fmt);
    book.define(name, sh, r, 6);
    w.check(sh, r, 6, ev, 'Projection', label, fmt);
    r++;
  };
  line('TCV', 'Total contract value', 'SUM(PrjRev)', e.tcv, 'money');
  line('ACV', 'Annual contract value', 'TCV/(MAX(1,TermMonths)/12)', e.acv, 'money');
  line('RecurringTotal', 'Recurring revenue', 'SUM(PrjRec)', e.recurringRevenue, 'money');
  line('ProviderCost', 'Total provider cost', 'SUM(PrjCost)', e.totalCost, 'money');
  line('ProviderGP', 'Gross profit', 'TCV-ProviderCost', e.grossProfit, 'money');
  line('ProviderMargin', 'Gross margin %', 'IF(TCV=0,0,ProviderGP/TCV*100)', e.marginPct, 'pct');
  line('ARR', 'ARR (steady MRR × 12)', 'SteadyMRR*12', e.arr, 'money');
  line('CostToServeAbu', 'Cost to serve per weighted ABU', 'IF(WeightedAbus=0,0,RunCost/WeightedAbus)', e.costToServePerAbu, 'unit');
}
