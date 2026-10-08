import { selfHostedPerM, type ModelRate } from '@aies/engine';
import type { Fmt, WB } from './ctx';
import { colName } from './book';

/** Conversion factor from the currency in `curRef` to the project currency. */
export const fxf = (curRef: string): string => `(FxProject/INDEX(FxRates,MATCH(${curRef},FxCodes,0)))`;

export const WF_FIELDS = [
  ['id', 'Workflow id', 'text'],
  ['name', 'Workflow', 'text'],
  ['abu', 'Business unit (ABU)', 'text'],
  ['vol', 'Monthly attempted transactions', 'count'],
  ['growth', 'Annual volume growth %', 'pct'],
  ['success', 'Success rate %', 'pct'],
  ['accept', 'Acceptance rate %', 'pct'],
  ['retry', 'Retry rate %', 'pct'],
  ['retryCons', 'Retry consumption %', 'pct'],
  ['failCons', 'Failed-execution consumption %', 'pct'],
  ['human', 'Human intervention rate %', 'pct'],
  ['tools', 'Tool calls per execution', 'dec2'],
  ['minA', 'Review minutes per assisted transaction', 'dec2'],
  ['minR', 'Rework minutes per rejected transaction', 'dec2'],
  ['hrCost', 'Review hourly cost', 'money2'],
  ['hrCur', 'Review cost currency', 'text'],
  ['borne', 'Review borne by (provider / client)', 'text'],
] as const;

export type WfField = (typeof WF_FIELDS)[number][0];

export function usedModels(w: WB): ModelRate[] {
  const ids = new Set<string>();
  for (const wf of w.r.project.workflows) for (const st of wf.llmSteps) for (const ro of st.routing) ids.add(ro.modelId);
  return w.cat.modelRates.filter((m) => ids.has(m.id));
}

export function buildAssumptions(w: WB): void {
  const sh = w.s.assumptions;
  const p = w.r.project;
  const pr = p.pricing;
  const b = w.book;
  w.title(sh, 'Assumptions', 'Shaded blue cells are inputs. Every other sheet calculates from these cells; change an input and the model recalculates.');
  sh.width(1, 42);
  for (let c = 2; c <= 20; c++) sh.width(c, 15);
  sh.freeze = { row: 3, col: 1 };

  let r = 4;
  w.section(sh, r++, 'Contract and economic assumptions', 4);
  w.header(sh, r++, 1, ['Assumption', 'Value', 'Unit / note']);
  const scalar = (name: string, label: string, v: string | number | boolean, fmt: Fmt, note = '') => {
    w.label(sh, r, 1, label);
    w.input(sh, r, 2, v as string | number, fmt);
    if (note) w.note(sh, r, 3, note);
    b.define(name, sh, r, 2);
    r++;
  };
  scalar('ProjCurrency', 'Reporting currency', w.cur, 'text');
  scalar('GoLive', 'Go-live month', p.goLiveDate, 'text', 'YYYY-MM; run month 1');
  scalar('TermMonths', 'Contract term', pr.termMonths, 'int', 'months');
  scalar('PriceEscalationPct', 'Annual price escalation', pr.priceEscalationPct, 'pct', 'applies to recurring prices from each contract year');
  scalar('CostInflationPct', 'Annual cost inflation', pr.costInflationPct, 'pct', 'non-LLM costs, human review, client costs');
  scalar('LlmPriceChangePct', 'Annual LLM price change', pr.llmPriceChangePct, 'pct', 'negative = price decline');
  scalar('RampMonths', 'Volume ramp period', pr.rampMonths, 'int', 'months');
  scalar('RampStartPct', 'Ramp starting volume', pr.rampStartPct, 'pct', 'of steady-state volume in month 1');
  scalar('PassThroughMarkupPct', 'Pass-through handling markup', pr.passThroughMarkupPct, 'pct');
  scalar('DiscountRatePct', 'Client discount rate (NPV)', p.value.discountRatePct, 'pct', 'annual');
  scalar('IncludeUnvalidated', 'Count proposed (unvalidated) benefits', p.value.includeUnvalidated ? 'Yes' : 'No', 'text', 'Yes / No');

  // FX
  r++;
  w.section(sh, r++, `FX table (units of currency per 1 ${w.cat.fx.base})`, 4);
  w.note(sh, r++, 1, `${w.cat.fx.source} As of ${w.cat.fx.asOf}.`);
  w.header(sh, r++, 1, ['Currency', 'Units per base', 'To project currency']);
  const rates: [string, number][] = Object.entries(w.cat.fx.rates);
  if (!rates.some(([k]) => k === w.cat.fx.base)) rates.unshift([w.cat.fx.base, 1]);
  const fx0 = r;
  for (const [code, rate] of rates) {
    w.input(sh, r, 1, code, 'text');
    w.input(sh, r, 2, rate, 'dec4');
    w.calc(sh, r, 3, `FxProject/B${r}`, 'dec4');
    r++;
  }
  b.define('FxCodes', sh, fx0, 1, r - 1, 1);
  b.define('FxRates', sh, fx0, 2, r - 1, 2);
  w.label(sh, r, 1, 'Project currency rate');
  w.calc(sh, r, 2, 'INDEX(FxRates,MATCH(ProjCurrency,FxCodes,0))', 'dec4');
  b.define('FxProject', sh, r, 2);
  r += 2;

  // Workflows (fields as rows, workflows as columns)
  w.section(sh, r++, 'Workflow funnel and review inputs (steady-state month, contract year 1)', 2 + p.workflows.length);
  w.header(sh, r++, 1, ['Input', ...p.workflows.map((_, i) => `Workflow ${i + 1}`)]);
  for (const [key, label, fmt] of WF_FIELDS) {
    w.label(sh, r, 1, label);
    p.workflows.forEach((wf, i) => {
      const hr = wf.humanReview;
      const v: Record<WfField, string | number> = {
        id: wf.id,
        name: wf.name,
        abu: wf.abuName,
        vol: wf.monthlyVolume,
        growth: wf.annualGrowthPct,
        success: wf.successRatePct,
        accept: wf.acceptanceRatePct,
        retry: wf.retryRatePct,
        retryCons: wf.retryConsumptionPct,
        failCons: wf.failedConsumptionPct,
        human: wf.humanInterventionRatePct,
        tools: wf.toolCallsPerExecution,
        minA: hr.minutesPerAssistedTxn,
        minR: hr.minutesPerRejectedTxn,
        hrCost: hr.hourlyCost,
        hrCur: hr.currency,
        borne: hr.borneBy,
      };
      w.input(sh, r, 2 + i, v[key], fmt, key === 'borne' ? { list: ['provider', 'client'] } : {});
      w.put(`wf.${i}.${key}`, sh, r, 2 + i);
    });
    if (key === 'id') b.define('WfIds', sh, r, 2, r, 1 + Math.max(1, p.workflows.length));
    r++;
  }
  r++;

  // Complexity classes
  w.section(sh, r++, 'Complexity mix and ABU weights', 8);
  w.header(sh, r++, 1, ['Workflow id', 'Class id', 'Class', 'Share %', 'ABU weight', 'Consumption ×', 'Human effort ×', 'Price override']);
  const cx0 = r;
  for (const wf of p.workflows) {
    for (const c of wf.complexity) {
      w.input(sh, r, 1, wf.id, 'text');
      w.input(sh, r, 2, c.id, 'text');
      w.input(sh, r, 3, c.name, 'text');
      w.input(sh, r, 4, c.sharePct, 'pct');
      w.input(sh, r, 5, c.abuWeight, 'dec2');
      w.input(sh, r, 6, c.consumptionMultiplier, 'dec2');
      w.input(sh, r, 7, c.humanEffortMultiplier, 'dec2');
      w.input(sh, r, 8, c.priceOverride ?? null, 'money2');
      r++;
    }
  }
  if (r === cx0) {
    w.note(sh, r, 1, '(no complexity classes — every accepted transaction earns 1 ABU)');
    r++;
  }
  const cx1 = r - 1;
  for (const [k, c] of [['cx.wf', 1], ['cx.id', 2], ['cx.name', 3], ['cx.share', 4], ['cx.weight', 5], ['cx.cons', 6], ['cx.human', 7], ['cx.override', 8]] as const) w.put(k, sh, cx0, c, cx1, c);
  w.note(sh, r++, 1, 'Shares are normalised to 100% within each workflow. Workflows without classes earn one ABU per accepted transaction.');
  r++;

  // Models
  const models = usedModels(w);
  w.section(sh, r++, 'Model rates used (per 1M tokens)', 19);
  w.header(sh, r++, 1, [
    'Model id',
    'Model',
    'Rate currency',
    'Pricing basis',
    'Cache semantics',
    'Input',
    'Output',
    'Reasoning',
    'Cache read',
    'Cache write',
    'Batch discount %',
    'Other per call',
    'Sample rate',
    `Input (${w.cur})`,
    `Output (${w.cur})`,
    `Reasoning (${w.cur})`,
    `Cache read (${w.cur})`,
    `Cache write (${w.cur})`,
    `Other per call (${w.cur})`,
  ]);
  const m0 = r;
  for (const m of models) {
    const self = m.pricingBasis === 'self_hosted';
    const sh2 = self ? selfHostedPerM(m) : null;
    w.input(sh, r, 1, m.id, 'text');
    w.input(sh, r, 2, m.model, 'text');
    w.input(sh, r, 3, m.currency, 'text');
    w.input(sh, r, 4, m.pricingBasis, 'text');
    w.input(sh, r, 5, self ? 'none' : m.cacheSemantics, 'text', { list: ['none', 'discounted_read', 'read_write'] });
    if (sh2) {
      w.engine(sh, r, 6, sh2.inputPerM, 'dec4', 'engine value: derived from GPU-hour cost ÷ sustained throughput');
      w.engine(sh, r, 7, sh2.outputPerM, 'dec4', 'engine value: derived from GPU-hour cost ÷ sustained throughput');
      w.engine(sh, r, 8, sh2.outputPerM, 'dec4', 'engine value: reasoning billed at the derived output rate');
    } else {
      w.input(sh, r, 6, m.inputPerM, 'dec4');
      w.input(sh, r, 7, m.outputPerM, 'dec4');
      w.input(sh, r, 8, m.reasoningPerM ?? m.outputPerM, 'dec4');
    }
    w.input(sh, r, 9, self ? 0 : m.cacheReadPerM, 'dec4');
    w.input(sh, r, 10, self ? 0 : m.cacheWritePerM, 'dec4');
    w.input(sh, r, 11, self ? 0 : m.batchDiscountPct, 'pct');
    w.input(sh, r, 12, m.otherPerCall, 'dec4');
    w.input(sh, r, 13, m.sample ? 'Yes' : 'No', 'text');
    const f = fxf(`$C${r}`);
    for (const [src, dst] of [[6, 14], [7, 15], [8, 16], [9, 17], [10, 18], [12, 19]] as const) w.calc(sh, r, dst, `${colName(src)}${r}*${f}`, 'dec4');
    r++;
  }
  if (r === m0) {
    w.note(sh, r, 1, '(no models routed)');
    r++;
  }
  const m1 = r - 1;
  b.define('ModelIds', sh, m0, 1, m1, 1);
  b.define('ModelSem', sh, m0, 5, m1, 5);
  b.define('ModelBatch', sh, m0, 11, m1, 11);
  b.define('ModelIn', sh, m0, 14, m1, 14);
  b.define('ModelOut', sh, m0, 15, m1, 15);
  b.define('ModelReas', sh, m0, 16, m1, 16);
  b.define('ModelCR', sh, m0, 17, m1, 17);
  b.define('ModelCW', sh, m0, 18, m1, 18);
  b.define('ModelOther', sh, m0, 19, m1, 19);
  if (models.some((m) => m.sample)) w.note(sh, r++, 1, 'Rates marked as samples are illustrative, not vendor quotes. Verify every rate before commercial use.');
}
