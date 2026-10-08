import { D, sum } from '@aies/engine';
import { colName } from './book';
import { layout, type WB } from './ctx';

/**
 * One row per workflow × LLM step × model route (steady-state month, contract
 * year 1). Calls = execution equivalents × calls per execution × normalised
 * route share; tokens per call scale with the workflow's consumption mix; the
 * cacheable prefix is split into cache reads / writes by provider semantics.
 */
export function buildTokenomics(w: WB): void {
  const sh = w.s.tok;
  const p = w.r.project;
  const b = w.r.baseline;
  const book = w.book;
  w.title(sh, 'LLM Tokenomics', 'Cost per call = (uncached × input + cache reads × read + cache writes × write + output × output + reasoning × reasoning rate) ÷ 1M − batch discount on the batch-eligible share + other per-call charges. Monthly cost = calls × cost per call.');
  sh.freeze = { row: 4, col: 4 };

  const L = layout([
    { key: 'wf', header: 'Workflow id', width: 16 },
    { key: 'step', header: 'Step', width: 30 },
    { key: 'agent', header: 'Agent', width: 24 },
    { key: 'model', header: 'Model id', width: 22 },
    { key: 'cpe', header: 'Calls per execution', width: 10 },
    { key: 'share', header: 'Route share %', width: 9 },
    { key: 'rtot', header: 'Step route total %', width: 9 },
    { key: 'eq', header: 'Execution equivalents', width: 13 },
    { key: 'mix', header: 'Consumption mix', width: 10 },
    { key: 'calls', header: 'Calls per month', width: 13, check: true },
    { key: 'inRaw', header: 'Input tokens (base)', width: 10 },
    { key: 'outRaw', header: 'Output tokens (base)', width: 10 },
    { key: 'reasRaw', header: 'Reasoning tokens (base)', width: 10 },
    { key: 'prefix', header: 'Cacheable prefix', width: 10 },
    { key: 'hit', header: 'Cache hit %', width: 8 },
    { key: 'batch', header: 'Batch-eligible %', width: 8 },
    { key: 'in', header: 'Input per call', width: 10 },
    { key: 'out', header: 'Output per call', width: 10 },
    { key: 'reas', header: 'Reasoning per call', width: 10 },
    { key: 'sem', header: 'Cache semantics', width: 14 },
    { key: 'cread', header: 'Cache-read per call', width: 10 },
    { key: 'cwrite', header: 'Cache-write per call', width: 10 },
    { key: 'unc', header: 'Uncached per call', width: 10 },
    { key: 'rIn', header: 'Input rate', width: 10 },
    { key: 'rOut', header: 'Output rate', width: 10 },
    { key: 'rReas', header: 'Reasoning rate', width: 10 },
    { key: 'rCR', header: 'Cache-read rate', width: 10 },
    { key: 'rCW', header: 'Cache-write rate', width: 10 },
    { key: 'tok', header: 'Token cost per call', width: 11 },
    { key: 'bsave', header: 'Batch saving per call', width: 11 },
    { key: 'other', header: 'Other per call', width: 9 },
    { key: 'cpc', header: 'Cost per call', width: 11, check: true },
    { key: 'cost', header: 'Monthly cost', width: 14, check: true },
    { key: 'mIn', header: 'Input tokens / month', width: 14 },
    { key: 'mCR', header: 'Cache reads / month', width: 14, check: true },
    { key: 'mCW', header: 'Cache writes / month', width: 14 },
    { key: 'mUnc', header: 'Uncached / month', width: 14 },
    { key: 'mOut', header: 'Output / month', width: 14 },
    { key: 'mReas', header: 'Reasoning / month', width: 14 },
  ]);
  const c = (k: string) => colName(L.col[k]);
  w.section(sh, 3, 'Model routes (steady-state month)', 12);
  L.write(sh, w, 4);
  let r = 5;
  const r0 = r;
  const wfIndex = new Map(p.workflows.map((wf, i) => [wf.id, i]));
  const agentName = new Map(p.agents.map((a) => [a.id, a.name]));
  let li = 0;
  for (const wf of p.workflows) {
    const i = wfIndex.get(wf.id)!;
    for (const step of wf.llmSteps) {
      const routeTotal = step.routing.reduce((a, x) => a + x.sharePct, 0);
      for (const route of step.routing) {
        if (!w.cat.modelRates.some((m) => m.id === route.modelId)) continue;
        const line = b.llmLines[li++];
        const x = (k: string) => `${c(k)}${r}`;
        w.calc(sh, r, L.col.wf, w.at(`wf.${i}.id`, sh), 'text');
        w.input(sh, r, L.col.step, step.name, 'text');
        w.input(sh, r, L.col.agent, agentName.get(step.agentId) ?? 'Unassigned', 'text');
        w.input(sh, r, L.col.model, route.modelId, 'text');
        w.input(sh, r, L.col.cpe, step.callsPerExecution, 'dec4');
        w.input(sh, r, L.col.share, route.sharePct, 'pct');
        w.input(sh, r, L.col.rtot, routeTotal, 'pct', { note: 'Σ route shares of this step — shares are normalised to 100%.' });
        w.calc(sh, r, L.col.eq, w.at(`abu.${i}.eq`, sh), 'count2');
        w.calc(sh, r, L.col.mix, w.at(`abu.${i}.mix`, sh), 'factor');
        w.calc(sh, r, L.col.calls, `IF(${x('rtot')}=0,0,${x('eq')}*${x('cpe')}*${x('share')}/${x('rtot')})`, 'count2');
        w.input(sh, r, L.col.inRaw, step.inputTokens, 'count');
        w.input(sh, r, L.col.outRaw, step.outputTokens, 'count');
        w.input(sh, r, L.col.reasRaw, step.reasoningTokens, 'count');
        w.input(sh, r, L.col.prefix, step.cacheablePrefixTokens, 'count');
        w.input(sh, r, L.col.hit, step.cacheHitRatePct, 'pct');
        w.input(sh, r, L.col.batch, step.batchEligiblePct, 'pct');
        w.calc(sh, r, L.col.in, `${x('inRaw')}*${x('mix')}`, 'count2');
        w.calc(sh, r, L.col.out, `${x('outRaw')}*${x('mix')}`, 'count2');
        w.calc(sh, r, L.col.reas, `${x('reasRaw')}*${x('mix')}`, 'count2');
        const idx = `MATCH(${x('model')},ModelIds,0)`;
        w.calc(sh, r, L.col.sem, `INDEX(ModelSem,${idx})`, 'text');
        w.calc(sh, r, L.col.cread, `IF(${x('sem')}="none",0,MIN(${x('prefix')},${x('in')})*${x('hit')}/100)`, 'count2');
        w.calc(sh, r, L.col.cwrite, `IF(${x('sem')}="read_write",MIN(${x('prefix')},${x('in')})-${x('cread')},0)`, 'count2');
        w.calc(sh, r, L.col.unc, `${x('in')}-${x('cread')}-${x('cwrite')}`, 'count2');
        w.calc(sh, r, L.col.rIn, `INDEX(ModelIn,${idx})`, 'dec4');
        w.calc(sh, r, L.col.rOut, `INDEX(ModelOut,${idx})`, 'dec4');
        w.calc(sh, r, L.col.rReas, `INDEX(ModelReas,${idx})`, 'dec4');
        w.calc(sh, r, L.col.rCR, `INDEX(ModelCR,${idx})`, 'dec4');
        w.calc(sh, r, L.col.rCW, `INDEX(ModelCW,${idx})`, 'dec4');
        w.calc(sh, r, L.col.tok, `(${x('unc')}*${x('rIn')}+${x('cread')}*${x('rCR')}+${x('cwrite')}*${x('rCW')}+${x('out')}*${x('rOut')}+${x('reas')}*${x('rReas')})/1000000`, 'unit');
        w.calc(sh, r, L.col.bsave, `${x('tok')}*${x('batch')}/100*INDEX(ModelBatch,${idx})/100`, 'unit');
        w.calc(sh, r, L.col.other, `INDEX(ModelOther,${idx})`, 'unit');
        w.calc(sh, r, L.col.cpc, `${x('tok')}-${x('bsave')}+${x('other')}`, 'unit');
        w.calc(sh, r, L.col.cost, `${x('calls')}*${x('cpc')}`, 'money2');
        w.calc(sh, r, L.col.mIn, `${x('in')}*${x('calls')}`, 'count');
        w.calc(sh, r, L.col.mCR, `${x('cread')}*${x('calls')}`, 'count');
        w.calc(sh, r, L.col.mCW, `${x('cwrite')}*${x('calls')}`, 'count');
        w.calc(sh, r, L.col.mUnc, `${x('unc')}*${x('calls')}`, 'count');
        w.calc(sh, r, L.col.mOut, `${x('out')}*${x('calls')}`, 'count');
        w.calc(sh, r, L.col.mReas, `${x('reas')}*${x('calls')}`, 'count');
        const lbl = `${wf.name} / ${step.name} / ${route.modelId}`;
        w.check(sh, r, L.col.calls, line.calls, 'LLM tokenomics', `${lbl} — calls`, 'count2');
        w.check(sh, r, L.col.cpc, line.costPerCall, 'LLM tokenomics', `${lbl} — cost per call`, 'unit');
        w.check(sh, r, L.col.cost, line.cost, 'LLM tokenomics', `${lbl} — monthly cost`, 'money2');
        w.check(sh, r, L.col.mCR, line.cacheReadTokens, 'LLM tokenomics', `${lbl} — cache-read tokens`, 'count');
        r++;
      }
    }
  }
  const r1 = Math.max(r0, r - 1);
  if (r === r0) {
    w.note(sh, r, 1, '(no LLM steps)');
    r++;
  }
  for (const [name, k] of [
    ['TokWf', 'wf'],
    ['TokAgent', 'agent'],
    ['TokModel', 'model'],
    ['TokCalls', 'calls'],
    ['TokCost', 'cost'],
    ['TokIn', 'mIn'],
    ['TokCacheRead', 'mCR'],
    ['TokCacheWrite', 'mCW'],
    ['TokUncached', 'mUnc'],
    ['TokOutput', 'mOut'],
    ['TokReasoning', 'mReas'],
  ] as const)
    book.define(name, sh, r0, L.col[k], r1, L.col[k]);

  const tk = b.llm.tokens;
  w.label(sh, r, 1, 'Total', 'total');
  const tot = (k: string, ev: number | ReturnType<typeof D>, label: string, fmt: 'count2' | 'money2' | 'count') => {
    w.total(sh, r, L.col[k], `SUM(${c(k)}${r0}:${c(k)}${r1})`, fmt);
    // Only columns declared with check: true have Engine / Δ columns beside them.
    if (k === 'calls' || k === 'cost' || k === 'mCR') w.check(sh, r, L.col[k], ev, 'LLM tokenomics', label, fmt);
    else w.checkOnly(sh, r, L.col[k], ev, 'LLM tokenomics', label);
  };
  tot('calls', tk.calls, 'Total LLM calls', 'count2');
  tot('cost', b.llm.total, 'Total LLM cost', 'money2');
  tot('mIn', tk.input, 'Total input tokens', 'count');
  tot('mCR', tk.cacheRead, 'Total cache-read tokens', 'count');
  tot('mCW', tk.cacheWrite, 'Total cache-write tokens', 'count');
  tot('mUnc', sum(b.llmLines.map((l) => l.uncachedInputTokens)), 'Total uncached input tokens', 'count');
  tot('mOut', tk.output, 'Total output tokens', 'count');
  tot('mReas', tk.reasoning, 'Total reasoning tokens', 'count');
  book.define('LlmTotal', sh, r, L.col.cost);
  r += 2;
  w.note(sh, r++, 1, 'Every input token is billed exactly once: uncached + cache reads + cache writes = input tokens. Rates are converted to the project currency on the Assumptions sheet.');

  // LLM cost by model
  r++;
  w.section(sh, r++, 'LLM cost by model', 5);
  w.header(sh, r++, 1, ['Model id', 'Calls', 'Monthly cost', 'Engine', 'Δ']);
  for (const [id, cost] of Object.entries(b.llm.byModel)) {
    w.input(sh, r, 1, id, 'text');
    w.calc(sh, r, 2, `SUMIF(TokModel,A${r},TokCalls)`, 'count2');
    w.calc(sh, r, 3, `SUMIF(TokModel,A${r},TokCost)`, 'money2');
    w.check(sh, r, 3, cost, 'LLM tokenomics', `LLM cost — ${id}`, 'money2');
    r++;
  }
}
