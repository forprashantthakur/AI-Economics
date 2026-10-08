import { safeDiv } from '@aies/engine';
import { ABS, colName } from './book';
import { fxf } from './assumptions';
import { layout, type WB } from './ctx';

/**
 * Value & ROI: productivity (non-cash), benefit register, monthly benefits with
 * status filter, capacity-conversion cap and overlap groups (largest line per
 * group per month), client investment, ROI by year, NPV and payback.
 */
export function buildValue(w: WB): void {
  const sh = w.s.value;
  const p = w.r.project;
  const r_ = w.r;
  const book = w.book;
  const wfs = p.workflows;
  const v = p.value;
  w.title(sh, 'Value & ROI', 'Productivity (released hours) is non-cash and shown separately. Only benefit lines count financially: by status, risk-adjusted by confidence, ramped from their start month, capped and de-duplicated. ROI = (counted benefits − investment) ÷ investment.');
  sh.width(1, 36);
  sh.freeze = { row: 3, col: 1 };
  let r = 4;

  // ── Productivity
  w.section(sh, r++, 'Productivity baseline (per attempted transaction, contract-year-1 rates)', 12);
  const LP = layout([
    { key: 'wf', header: 'Workflow' },
    { key: 'manual', header: 'Manual minutes before', width: 11 },
    { key: 'spot', header: 'Spot-check minutes (autonomous)', width: 12 },
    { key: 'rate', header: 'Loaded hourly cost', width: 11 },
    { key: 'cur', header: 'Currency', width: 8 },
    { key: 'fteh', header: 'Productive hours per FTE-month', width: 11 },
    { key: 'hb', header: 'Hours before per attempted', width: 11 },
    { key: 'ha', header: 'Hours after per attempted', width: 11 },
    { key: 'hs', header: 'Hours saved per attempted', width: 11 },
    { key: 'pv', header: 'Value per attempted', width: 11 },
    { key: 'hsm', header: 'Hours saved (steady month)', width: 12, check: true },
    { key: 'pvm', header: 'Value (steady month)', width: 13, check: true },
    { key: 'fte', header: 'FTE released (steady)', width: 10 },
  ]);
  LP.write(sh, w, r++);
  const pc = (k: string) => colName(LP.col[k]);
  const prodRows: { r: number; i: number }[] = [];
  for (const pi of v.productivity) {
    const i = wfs.findIndex((x) => x.id === pi.workflowId);
    if (i < 0) continue;
    const x = (k: string) => `${pc(k)}${r}`;
    const att = w.at(`abu.${i}.att`, sh);
    const per = (key: string) => `IF(${att}=0,0,${w.at(key, sh)}/${att})`;
    const sp = x('spot');
    w.calc(sh, r, LP.col.wf, w.at(`wf.${i}.name`, sh), 'text');
    w.input(sh, r, LP.col.manual, pi.manualMinutesBefore, 'dec2');
    w.input(sh, r, LP.col.spot, pi.spotCheckMinutesAutonomous, 'dec2');
    w.input(sh, r, LP.col.rate, pi.loadedHourlyCost, 'money2');
    w.input(sh, r, LP.col.cur, pi.currency, 'text');
    w.input(sh, r, LP.col.fteh, pi.productiveHoursPerFteMonth, 'dec2');
    w.calc(sh, r, LP.col.hb, `${x('manual')}/60`, 'factor');
    const assisted = `IF(${w.at(`wf.${i}.borne`, sh)}="client",${per(`hr.${i}.ch`)},${per(`abu.${i}.ha`)}*${sp}/60)`;
    w.calc(sh, r, LP.col.ha, `${per(`abu.${i}.aut`)}*${sp}/60+${assisted}+(${per(`abu.${i}.fail`)}+${per(`abu.${i}.rej`)})*${x('manual')}/60`, 'factor');
    w.calc(sh, r, LP.col.hs, `${x('hb')}-${x('ha')}`, 'factor');
    w.calc(sh, r, LP.col.pv, `${x('hs')}*${x('rate')}*${fxf(x('cur'))}`, 'unit');
    w.calc(sh, r, LP.col.hsm, `${x('hs')}*${att}`, 'count2');
    w.calc(sh, r, LP.col.pvm, `${x('pv')}*${att}`, 'money');
    w.calc(sh, r, LP.col.fte, `IF(${x('fteh')}=0,0,${x('hsm')}/${x('fteh')})`, 'dec2');
    const sv = r_.steady.value.productivity.find((q) => q.workflowId === pi.workflowId);
    w.check(sh, r, LP.col.hsm, sv?.hoursSaved ?? 0, 'Value & ROI', `${wfs[i].name} — hours saved (steady)`, 'count2');
    w.check(sh, r, LP.col.pvm, sv?.productivityValue ?? 0, 'Value & ROI', `${wfs[i].name} — productivity value (steady)`, 'money');
    prodRows.push({ r, i });
    r++;
  }
  const pvAt = (attOf: (i: number) => string, infl: string) => (prodRows.length ? `(${prodRows.map(({ r: pr_, i }) => `${attOf(i)}*${pc('pv')}${pr_}`).join('+')})*${infl}` : '0');
  const hsAt = (attOf: (i: number) => string) => (prodRows.length ? prodRows.map(({ r: pr_, i }) => `${attOf(i)}*${pc('hs')}${pr_}`).join('+') : '0');
  r++;

  // ── Benefit register
  w.section(sh, r++, 'Benefit register', 13);
  w.header(sh, r++, 1, ['Benefit', 'Category', 'Annual amount', 'Currency', 'Start month', 'Ramp months', 'Confidence %', 'Status', 'Overlap group', 'Scales with volume', 'Counts (validated view)', 'Counts (forecast view)', 'Monthly at 100% ramp']);
  const bl0 = r;
  for (const b of v.benefits) {
    w.input(sh, r, 1, b.name, 'text', b.notes ? { note: b.notes } : {});
    w.input(sh, r, 2, b.category, 'text', { list: ['hard_savings', 'cost_avoidance', 'revenue', 'working_capital', 'capacity_conversion'] });
    w.input(sh, r, 3, b.annualAmount, 'money');
    w.input(sh, r, 4, b.currency, 'text');
    w.input(sh, r, 5, b.startMonth, 'int');
    w.input(sh, r, 6, b.rampMonths, 'int');
    w.input(sh, r, 7, b.confidencePct, 'pct');
    w.input(sh, r, 8, b.status, 'text', { list: ['proposed', 'finance_validated', 'realized', 'rejected'] });
    w.input(sh, r, 9, b.overlapGroup ?? '', 'text');
    w.input(sh, r, 10, b.scalesWithVolume ? 'Yes' : 'No', 'text', { list: ['Yes', 'No'] });
    w.calc(sh, r, 11, `IF(OR(H${r}="finance_validated",H${r}="realized"),1,0)`, 'int');
    w.calc(sh, r, 12, `IF(OR(H${r}="finance_validated",H${r}="realized",H${r}="proposed"),1,0)`, 'int');
    w.calc(sh, r, 13, `C${r}*${fxf(`D${r}`)}/12*G${r}/100`, 'money');
    r++;
  }
  const nB = v.benefits.length;
  r++;

  // ── Monthly benefits
  w.section(sh, r++, 'Monthly benefits and client cash flows (steady row = fully ramped year-1 month)', 20);
  w.note(sh, r++, 1, 'Validated view counts finance-validated and realised lines; forecast view adds proposed lines. Step 1 = gross × status; step 2 = capacity-conversion lines capped at the month’s productivity value; step 3 = only the largest line in each overlap group counts.');
  // block columns
  const base = ['m', 'yi', 'infl', 'att', 'vi', 'pv', 'hs'] as const;
  let col = 1;
  const C: Record<string, number> = {};
  for (const k of base) C[k] = col++;
  const block = () => {
    const start = col;
    col += Math.max(1, nB);
    return start;
  };
  const G = block();
  const V1 = block();
  const V2 = block();
  const V3 = block();
  const F1 = block();
  const F2 = block();
  const F3 = block();
  for (const k of ['capV', 'capF', 'val', 'valE', 'valD', 'fc', 'fcE', 'fcD', 'cnt', 'cc', 'rev', 'inv', 'net', 'cum', 'df', 'pvf']) C[k] = col++;
  const hdrCat = r;
  const hdrGrp = r + 1;
  const hdrAV = r + 2;
  const hdrAF = r + 3;
  const hdrTitle = r + 4;
  // metadata rows above the blocks
  w.label(sh, hdrCat, 1, 'Category', 'muted');
  w.label(sh, hdrGrp, 1, 'Overlap group', 'muted');
  w.label(sh, hdrAV, 1, 'Counts in validated view', 'muted');
  w.label(sh, hdrAF, 1, 'Counts in forecast view', 'muted');
  const blocks: [number, string][] = [
    [G, 'Gross'],
    [V1, 'Validated 1'],
    [V2, 'Validated 2 (cap)'],
    [V3, 'Validated 3 (overlap)'],
    [F1, 'Forecast 1'],
    [F2, 'Forecast 2 (cap)'],
    [F3, 'Forecast 3 (overlap)'],
  ];
  for (const [start, title] of blocks)
    for (let j = 0; j < nB; j++) {
      const br = bl0 + j;
      w.calc(sh, hdrCat, start + j, `""&B${br}`, 'text');
      w.calc(sh, hdrGrp, start + j, `""&I${br}`, 'text');
      w.calc(sh, hdrAV, start + j, `K${br}`, 'int');
      w.calc(sh, hdrAF, start + j, `L${br}`, 'int');
      sh.set(hdrTitle, start + j, { v: `${title} — ${v.benefits[j].name}`, kind: 'header' });
      sh.width(start + j, 13);
    }
  const heads: Record<string, string> = {
    m: 'Month',
    yi: 'Year index',
    infl: 'Inflation factor',
    att: 'Attempted',
    vi: 'Volume index',
    pv: 'Productivity value',
    hs: 'Hours saved',
    capV: 'Capacity lines (validated)',
    capF: 'Capacity lines (forecast)',
    val: 'Validated benefit',
    valE: 'Engine',
    valD: 'Δ',
    fc: 'Forecast benefit',
    fcE: 'Engine',
    fcD: 'Δ',
    cnt: 'Counted benefit',
    cc: 'Client internal cost',
    rev: 'Provider fees',
    inv: 'Client investment',
    net: 'Client net',
    cum: 'Cumulative',
    df: 'Discount factor',
    pvf: 'Present value',
  };
  for (const [k, t] of Object.entries(heads)) {
    sh.set(hdrTitle, C[k], { v: t, kind: 'header' });
    if (!sh.widths[C[k]] && C[k] > 1) sh.width(C[k], 13);
  }
  r = hdrTitle + 1;
  const cl = (k: string) => colName(C[k]);
  const bc = (start: number, j: number) => colName(start + j);
  const grpRange = (start: number) => `${ABS(hdrGrp, start)}:${ABS(hdrGrp, start + nB - 1)}`;
  const catRange = (start: number) => `${ABS(hdrCat, start)}:${ABS(hdrCat, start + nB - 1)}`;
  const baselineAtt = 'SUM(' + (wfs.length ? wfs.map((_, i) => w.at(`wf.${i}.vol`, sh)).join(',') : '0') + ')';

  const rows: { label: 'steady' | number; idx: number }[] = [{ label: 'steady', idx: -1 }, ...r_.months.map((m, idx) => ({ label: m.month, idx }))];
  const firstMonthRow = r + 1;
  for (const row of rows) {
    const steady = row.label === 'steady';
    const x = (k: string) => `${cl(k)}${r}`;
    if (steady) {
      w.label(sh, r, C.m, 'Steady', 'calc');
      w.calc(sh, r, C.yi, '0', 'int');
      w.calc(sh, r, C.infl, '1', 'factor');
      w.calc(sh, r, C.att, baselineAtt, 'count2');
      w.calc(sh, r, C.vi, '1', 'factor');
      w.calc(sh, r, C.pv, pvAt((i) => w.at(`abu.${i}.att`, sh), '1'), 'money');
      w.calc(sh, r, C.hs, hsAt((i) => w.at(`abu.${i}.att`, sh)), 'count2');
    } else {
      const idx = row.idx;
      w.calc(sh, r, C.m, w.at(`proj.${idx}.m`, sh), 'int');
      w.calc(sh, r, C.yi, w.at(`proj.${idx}.yi`, sh), 'int');
      w.calc(sh, r, C.infl, w.at(`proj.${idx}.infl`, sh), 'factor');
      w.calc(sh, r, C.att, w.at(`proj.${idx}.att`, sh), 'count2');
      w.calc(sh, r, C.vi, `IF(${baselineAtt}=0,0,${x('att')}/${baselineAtt})`, 'factor');
      w.calc(sh, r, C.pv, pvAt((i) => w.at(`proj.${idx}.att${i}`, sh), x('infl')), 'money');
      w.calc(sh, r, C.hs, hsAt((i) => w.at(`proj.${idx}.att${i}`, sh)), 'count2');
    }
    for (let j = 0; j < nB; j++) {
      const br = bl0 + j;
      const ramp = steady ? '1' : `IF(${x('m')}<$E$${br},0,IF($F$${br}<=0,1,MIN(1,(${x('m')}-$E$${br}+1)/$F$${br})))`;
      const g = `$M$${br}*${ramp}*IF($J$${br}="Yes",${x('vi')},1)*IF($B$${br}="revenue",1,${x('infl')})`;
      w.calc(sh, r, G + j, steady ? g : `IF(${x('m')}<=0,0,${g})`, 'money2');
      for (const [s1, s2, s3, allowRow, capK] of [
        [V1, V2, V3, hdrAV, 'capV'],
        [F1, F2, F3, hdrAF, 'capF'],
      ] as const) {
        w.calc(sh, r, s1 + j, `${bc(G, j)}${r}*${colName(s1 + j)}$${allowRow}`, 'money2');
        const cap = `MAX(0,${x('pv')})`;
        w.calc(sh, r, s2 + j, `${bc(s1, j)}${r}*IF(AND(${colName(s1 + j)}$${hdrCat}="capacity_conversion",${x(capK)}>${cap}),IF(${x(capK)}=0,0,${cap}/${x(capK)}),1)`, 'money2');
        const me = `${bc(s2, j)}${r}`;
        const grp = `${colName(s2 + j)}$${hdrGrp}`;
        const rowRange = `${colName(s2)}${r}:${colName(s2 + nB - 1)}${r}`;
        const groupMax = `SUMPRODUCT(MAX((${grpRange(s2)}=${grp})*${rowRange}))`;
        const earlier = j === 0 ? '0' : `SUMPRODUCT((${ABS(hdrGrp, s2)}:${ABS(hdrGrp, s2 + j - 1)}=${grp})*(${colName(s2)}${r}:${colName(s2 + j - 1)}${r}=${me}))`;
        w.calc(sh, r, s3 + j, `IF(${grp}="",${me},IF(AND(${me}=${groupMax},${earlier}=0),${me},0))`, 'money2');
      }
    }
    if (!nB) {
      for (const s of [G, V1, V2, V3, F1, F2, F3]) w.calc(sh, r, s, '0', 'money2');
    }
    const rowSum = (start: number) => (nB ? `SUM(${colName(start)}${r}:${colName(start + nB - 1)}${r})` : '0');
    w.calc(sh, r, C.capV, nB ? `SUMPRODUCT((${catRange(V1)}="capacity_conversion")*${colName(V1)}${r}:${colName(V1 + nB - 1)}${r})` : '0', 'money2');
    w.calc(sh, r, C.capF, nB ? `SUMPRODUCT((${catRange(F1)}="capacity_conversion")*${colName(F1)}${r}:${colName(F1 + nB - 1)}${r})` : '0', 'money2');
    w.calc(sh, r, C.val, rowSum(V3), 'money2');
    w.calc(sh, r, C.fc, rowSum(F3), 'money2');
    w.calc(sh, r, C.cnt, `IF(IncludeUnvalidated="Yes",${x('fc')},${x('val')})`, 'money2');
    const engVal = steady ? r_.steady.value.validated : r_.months[row.idx].validatedBenefit;
    const engFc = steady ? r_.steady.value.forecast : r_.months[row.idx].forecastBenefit;
    w.check(sh, r, C.val, engVal, 'Value & ROI', `${steady ? 'Steady' : `M${row.label}`} validated benefit`, 'money2');
    w.check(sh, r, C.fc, engFc, 'Value & ROI', `${steady ? 'Steady' : `M${row.label}`} forecast benefit`, 'money2');
    if (steady) {
      w.put('val.steady.validated', sh, r, C.val);
      w.put('val.steady.forecast', sh, r, C.fc);
      w.label(sh, r, C.cc, 'n/a', 'muted');
    } else {
      w.put(`val.m.${row.idx}.validated`, sh, r, C.val);
      w.put(`val.m.${row.idx}.forecast`, sh, r, C.fc);
      const mCell = x('m');
      const inflCell = x('infl');
      w.calc(sh, r, C.cc, () => `IF(${mCell}=0,ClientOneTime,ClientMonthly*${inflCell})`, 'money2');
      w.calc(sh, r, C.rev, w.at(`proj.${row.idx}.rev`, sh), 'money2');
      w.calc(sh, r, C.inv, `${x('rev')}+${x('cc')}`, 'money2');
      w.calc(sh, r, C.net, `${x('cnt')}-${x('inv')}`, 'money2');
      w.calc(sh, r, C.cum, row.idx === 0 ? x('net') : `${cl('cum')}${r - 1}+${x('net')}`, 'money2');
      w.calc(sh, r, C.df, `1/(1+DiscountRatePct/100)^(${x('m')}/12)`, 'factor');
      w.calc(sh, r, C.pvf, `${x('net')}*${x('df')}`, 'money2');
    }
    r++;
  }
  const lastRow = r - 1;
  for (const [name, k] of [
    ['ValMonth', 'm'],
    ['ValYear', 'yi'],
    ['ValCounted', 'cnt'],
    ['ValValidated', 'val'],
    ['ValForecast', 'fc'],
    ['ValProductivity', 'pv'],
    ['ValHours', 'hs'],
    ['ValInvest', 'inv'],
    ['ValNet', 'net'],
    ['ValCum', 'cum'],
    ['ValPV', 'pvf'],
  ] as const)
    book.define(name, sh, firstMonthRow, C[k], lastRow, C[k]);
  r++;

  // ── Client costs
  w.section(sh, r++, 'Client internal costs', 5);
  w.header(sh, r++, 1, ['Cost', 'Type', 'Amount', 'Currency', `Amount (${w.cur})`]);
  const cc0 = r;
  for (const cc of v.clientCosts) {
    w.input(sh, r, 1, cc.name, 'text');
    w.input(sh, r, 2, cc.type, 'text', { list: ['one_time', 'monthly'] });
    w.input(sh, r, 3, cc.amount, 'money');
    w.input(sh, r, 4, cc.currency, 'text');
    w.calc(sh, r, 5, `C${r}*${fxf(`D${r}`)}`, 'money');
    r++;
  }
  const cc1 = Math.max(cc0, r - 1);
  w.label(sh, r, 1, 'One-time (month 0)');
  w.calc(sh, r, 5, `SUMIF(B${cc0}:B${cc1},"one_time",E${cc0}:E${cc1})`, 'money');
  book.define('ClientOneTime', sh, r, 5);
  r++;
  w.label(sh, r, 1, 'Monthly (from go-live, inflated)');
  w.calc(sh, r, 5, `SUMIF(B${cc0}:B${cc1},"monthly",E${cc0}:E${cc1})`, 'money');
  book.define('ClientMonthly', sh, r, 5);
  r += 2;

  // ── ROI by year
  w.section(sh, r++, 'Client ROI by year (year 1 includes month 0)', 14);
  const LY = layout([
    { key: 'y', header: 'Year' },
    { key: 'yi', header: 'Year index', width: 8 },
    { key: 'inv', header: 'Investment', width: 14 },
    { key: 'cnt', header: 'Counted benefits', width: 14, check: true },
    { key: 'net', header: 'Net benefit', width: 14 },
    { key: 'roi', header: 'ROI %', width: 9, check: true },
    { key: 'pv', header: 'Productivity (non-cash)', width: 14 },
    { key: 'hs', header: 'Hours released', width: 12 },
  ]);
  LY.write(sh, w, r++);
  const yc = (k: string) => colName(LY.col[k]);
  for (const y of r_.years) {
    const x = (k: string) => `${yc(k)}${r}`;
    w.input(sh, r, LY.col.y, y.label, 'text');
    w.input(sh, r, LY.col.yi, y.year - 1, 'int');
    w.calc(sh, r, LY.col.inv, `SUMIF(ValYear,${x('yi')},ValInvest)`, 'money');
    w.calc(sh, r, LY.col.cnt, `SUMIF(ValYear,${x('yi')},ValCounted)`, 'money');
    w.calc(sh, r, LY.col.net, `${x('cnt')}-${x('inv')}`, 'money');
    w.calc(sh, r, LY.col.roi, `IF(${x('inv')}=0,0,${x('net')}/${x('inv')}*100)`, 'pct');
    w.calc(sh, r, LY.col.pv, `SUMIF(ValYear,${x('yi')},ValProductivity)`, 'money');
    w.calc(sh, r, LY.col.hs, `SUMIF(ValYear,${x('yi')},ValHours)`, 'count');
    w.check(sh, r, LY.col.cnt, y.countedBenefit, 'Value & ROI', `${y.label} counted benefits`, 'money');
    w.check(sh, r, LY.col.roi, y.roiPct, 'Value & ROI', `${y.label} ROI`, 'pct');
    r++;
  }
  r++;

  // ── Term results
  w.section(sh, r++, 'Client economics over the term', 4);
  w.header(sh, r++, 1, ['Measure', 'Value', 'Engine', 'Δ']);
  const c = r_.economics.client;
  const line = (name: string, label: string, f: string, ev: number | { toNumber(): number }, fmt: 'money' | 'pct' | 'unit' | 'dec2' | 'count') => {
    w.label(sh, r, 1, label);
    w.calc(sh, r, 2, f, fmt);
    book.define(name, sh, r, 2);
    w.check(sh, r, 2, ev, 'Value & ROI', label, fmt);
    r++;
  };
  line('ClientInvestment', 'Total client investment', 'SUM(ValInvest)', c.totalInvestment, 'money');
  line('CountedBenefits', 'Counted benefits', 'SUM(ValCounted)', c.countedBenefits, 'money');
  line('ValidatedBenefits', 'Validated benefits', 'SUM(ValValidated)', c.validatedBenefits, 'money');
  line('ForecastBenefits', 'Forecast benefits (incl. proposed)', 'SUM(ValForecast)', c.forecastBenefits, 'money');
  line('NetBenefit', 'Net benefit', 'CountedBenefits-ClientInvestment', c.netBenefit, 'money');
  line('ClientRoi', 'ROI over the term %', 'IF(ClientInvestment=0,0,NetBenefit/ClientInvestment*100)', c.roiPct, 'pct');
  line('ClientNpv', 'NPV at the client discount rate', 'SUM(ValPV)', c.npv, 'money');
  line('CostPerOutcome', 'Client cost per accepted transaction', 'IF(SUM(PrjAcc)=0,0,ClientInvestment/SUM(PrjAcc))', c.costPerOutcome, 'unit');
  line('ProductivityTerm', 'Productivity value over the term (non-cash)', 'SUM(ValProductivity)', c.productivityValue, 'money');
  line('HoursTerm', 'Hours released over the term', 'SUM(ValHours)', c.hoursSaved, 'count');
  // Payback
  const T = r_.months.length - 1;
  w.label(sh, r, 1, 'Last month with negative cumulative position (−1 = never)');
  w.calc(sh, r, 2, 'SUMPRODUCT(MAX((ValCum<0)*(ValMonth+1)))-1', 'int');
  const ln = `B${r}`;
  r++;
  w.label(sh, r, 1, 'Payback (months; blank = not within term)');
  w.calc(sh, r, 2, `IF(${ln}<0,0,IF(${ln}>=${T},"",${ln}+MIN(IF(INDEX(ValNet,${ln}+2)=0,0,-INDEX(ValCum,${ln}+1)/INDEX(ValNet,${ln}+2)),1)))`, 'dec2');
  const pb = c.paybackMonths;
  if (pb === null) {
    w.engine(sh, r, 3, 'Not within term', 'text');
    w.book.check(sh, r, 2, 'Value & ROI', 'Payback months', '');
  } else w.check(sh, r, 2, pb, 'Value & ROI', 'Payback months', 'dec2');
  r += 2;
  w.note(sh, r, 1, `Steady-state productivity: ${safeDiv(c.steadyHoursSaved, 1).toFixed(0)} hours a month (${c.steadyFteReleased.toFixed(1)} FTE) — non-cash, excluded from ROI unless a validated benefit line converts it.`);
}

