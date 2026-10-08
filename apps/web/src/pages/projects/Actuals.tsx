import { useMemo, useState } from 'react';
import { ClipboardPaste, Download, Plus, Trash2 } from 'lucide-react';
import { addMonths, safeDiv, sum, varianceAnalysis, type ActualRecord, type Project, type ProjectResult } from '@aies/engine';
import { ChartFrame, Lines, type SeriesDef } from '../../components/charts';
import { Button, Callout, Empty, Modal, Panel, ReadOnlyNote, Segmented, Select, StatStrip, cx } from '../../components/ui';
import { compact, money, n, periodLabel, signedPct, tokens, unitPrice } from '../../lib/format';
import { href } from '../../lib/router';
import { useCan, useProjectUpdater, useStore } from '../../state/store';
import { IconButton, MonthInput, NumberInput, csvCell, downloadFile, isPeriod, monthIndexFor, slugify } from './common';

const CSV_HEADER = ['period', 'workflow_id', 'attempted', 'accepted', 'input_tokens', 'output_tokens', 'llm_cost', 'non_llm_cost', 'realized_benefit'] as const;

interface ParseResult {
  rows: ActualRecord[];
  errors: { line: number; message: string }[];
}

function parseCsv(text: string, p: Project, currency: string): ParseResult {
  const rows: ActualRecord[] = [];
  const errors: ParseResult['errors'] = [];
  const lines = text.split(/\r?\n/);
  const wfIds = new Set(p.workflows.map((w) => w.id));
  const wfByName = new Map(p.workflows.map((w) => [w.name.trim().toLowerCase(), w.id]));
  let headerSeen = false;
  let order: number[] = CSV_HEADER.map((_, i) => i);
  lines.forEach((raw, i) => {
    const line = raw.trim();
    if (!line || line.startsWith('#')) return;
    const cells = line.split(/[,\t;]/).map((c) => c.trim().replace(/^"|"$/g, ''));
    if (!headerSeen && cells[0]?.toLowerCase() === 'period') {
      headerSeen = true;
      const lower = cells.map((c) => c.toLowerCase());
      const missing = CSV_HEADER.filter((h) => !lower.includes(h));
      if (missing.length) errors.push({ line: i + 1, message: `Header is missing ${missing.join(', ')}. Use the template header.` });
      else order = CSV_HEADER.map((h) => lower.indexOf(h));
      return;
    }
    const get = (k: (typeof CSV_HEADER)[number]) => cells[order[CSV_HEADER.indexOf(k)]] ?? '';
    const problems: string[] = [];
    const period = get('period');
    if (!isPeriod(period)) problems.push(`period "${period}" must be YYYY-MM`);
    const wfRaw = get('workflow_id');
    const workflowId = wfIds.has(wfRaw) ? wfRaw : wfByName.get(wfRaw.toLowerCase()) ?? '';
    if (!workflowId) problems.push(`workflow "${wfRaw}" is not in this project (use an id from the list below)`);
    const numbers: Record<string, number> = {};
    for (const k of CSV_HEADER.slice(2)) {
      const s = get(k).replace(/[_\s]/g, '');
      const v = Number(s);
      if (s === '' || !Number.isFinite(v)) problems.push(`${k} "${get(k)}" is not a number`);
      else if (v < 0) problems.push(`${k} cannot be negative`);
      numbers[k] = v;
    }
    if (!problems.length && numbers.accepted > numbers.attempted) problems.push('accepted exceeds attempted');
    if (problems.length) {
      errors.push({ line: i + 1, message: problems.join('; ') + '.' });
      return;
    }
    const monthIndex = monthIndexFor(p.goLiveDate, period);
    if (monthIndex < 1) {
      errors.push({ line: i + 1, message: `${period} is before go-live (${p.goLiveDate}); actuals start in the go-live month.` });
      return;
    }
    rows.push({
      period,
      monthIndex,
      workflowId,
      attempted: numbers.attempted,
      accepted: numbers.accepted,
      inputTokens: numbers.input_tokens,
      outputTokens: numbers.output_tokens,
      llmCost: numbers.llm_cost,
      nonLlmCost: numbers.non_llm_cost,
      realizedBenefit: numbers.realized_benefit,
      currency,
    });
  });
  return { rows, errors };
}

export function ActualsTab({ project: p, result: r }: { project: Project; result: ProjectResult }) {
  const { state } = useStore();
  const update = useProjectUpdater(p.id);
  const canEdit = useCan('actuals.edit');
  const cur = p.currency;
  const [pasteOpen, setPasteOpen] = useState(false);
  const variance = useMemo(() => varianceAnalysis(r, state.catalog), [r, state.catalog]);
  const t = variance.totals;
  const currencies = [...new Set([state.catalog.fx.base, ...Object.keys(state.catalog.fx.rates)])];
  const term = p.pricing.termMonths;

  // Sort for display but edit by original index.
  const indexed = p.actuals.map((a, i) => ({ a, i })).sort((x, y) => x.a.period.localeCompare(y.a.period) || x.a.workflowId.localeCompare(y.a.workflowId));
  const outOfTerm = p.actuals.filter((a) => a.monthIndex < 1 || a.monthIndex > term).length;
  const unknownWf = p.actuals.filter((a) => !p.workflows.some((w) => w.id === a.workflowId)).length;

  const setRow = (i: number, label: string, mutate: (a: ActualRecord) => void) =>
    update(`Edited actuals: ${label}`, (d) => {
      const a = d.actuals[i];
      if (!a) return;
      mutate(a);
      a.monthIndex = monthIndexFor(d.goLiveDate, a.period);
    }, `${p.name}: ${p.actuals[i]?.period ?? ''}`);

  const addRow = () => {
    const last = [...p.actuals].sort((a, b) => a.period.localeCompare(b.period)).at(-1);
    const period = last ? addMonths(last.period, 1) : p.goLiveDate;
    const wf = p.workflows[0];
    if (!wf) return;
    const mi = monthIndexFor(p.goLiveDate, period);
    // Pre-fill with the estimate for that month so the user overwrites real figures.
    const s = r.context.bases.find((b) => b.month === mi)?.snapshot ?? r.baseline;
    const rows: ActualRecord[] = p.workflows.map((w) => {
      const v = s.volumes[w.id];
      const lines = s.llmLines.filter((l) => l.workflowId === w.id);
      const llm = s.llm.byWorkflow[w.id];
      const run = s.runCostByWorkflow[w.id];
      return {
        period,
        monthIndex: mi,
        workflowId: w.id,
        attempted: Math.round(n(v?.attempted)),
        accepted: Math.round(n(v?.accepted)),
        inputTokens: Math.round(n(sum(lines.map((l) => l.inputTokens)))),
        outputTokens: Math.round(n(sum(lines.map((l) => l.outputTokens.plus(l.reasoningTokens))))),
        llmCost: Math.round(n(llm)),
        nonLlmCost: llm && run ? Math.round(n(run.minus(llm))) : 0,
        realizedBenefit: 0,
        currency: cur,
      };
    });
    update('Added actuals month', (d) => void d.actuals.push(...rows), `${p.name}: ${period} (${rows.length} rows pre-filled from the estimate)`);
  };

  const exportCsv = () => {
    const lines = [CSV_HEADER.join(','), ...indexed.map(({ a }) => [a.period, a.workflowId, a.attempted, a.accepted, a.inputTokens, a.outputTokens, a.llmCost, a.nonLlmCost, a.realizedBenefit].map(csvCell).join(','))];
    downloadFile(`${slugify(p.name)}-actuals.csv`, lines.join('\n'), 'text/csv');
  };

  const series: SeriesDef[] = [
    { key: 'est', label: 'Estimated run cost', color: '--s1' },
    { key: 'act', label: 'Actual run cost', color: '--s2' },
  ];
  const trend = variance.byPeriod.map((x) => ({ period: x.period, est: n(x.estTotalCost), act: n(x.actTotalCost) }));
  const tone = (v: number) => (v > 5 ? 'text-bad' : v > 0 ? 'text-warn' : 'text-good');

  return (
    <div className="space-y-5">
      {p.status !== 'live' && p.actuals.length === 0 && (
        <Callout tone="brand" title="Post-deployment monitoring">
          This project is still {p.status === 'pre_sales' ? 'a pre-sales estimate' : 'in delivery'}. After go-live ({periodLabel(p.goLiveDate)}), record monthly actuals here to compare them with the estimate and to feed the AI FinOps dashboard.
        </Callout>
      )}

      <StatStrip
        items={[
          {
            label: 'Run cost variance to date',
            value: t ? signedPct(t.costVariancePct) : 'No actuals',
            tone: t ? (n(t.costVariancePct) > 5 ? 'bad' : n(t.costVariancePct) > 0 ? 'warn' : 'good') : 'neutral',
            sub: t ? `${compact(t.actTotalCost, cur)} actual vs ${compact(t.estTotalCost, cur)} estimated` : 'Add a month or paste CSV',
          },
          { label: 'Months recorded', value: String(variance.byPeriod.length), sub: variance.byPeriod.length ? `${periodLabel(variance.byPeriod[0].period)} to ${periodLabel(variance.byPeriod.at(-1)!.period)}` : `Go-live ${periodLabel(p.goLiveDate)}` },
          { label: 'Accepted transactions', value: t ? tokens(t.actAccepted) : '—', sub: t ? `Estimate ${tokens(t.estAccepted)}, ${signedPct(safeDiv(t.actAccepted.minus(t.estAccepted), t.estAccepted).times(100))}` : undefined },
          { label: 'Cost per accepted', value: t ? unitPrice(t.actCostPerAccepted, cur) : '—', sub: t ? `Estimate ${unitPrice(t.estCostPerAccepted, cur)}` : undefined },
          { label: 'Realised benefit', value: t ? compact(t.realizedBenefit, cur) : '—', sub: t ? `Validated forecast ${compact(t.forecastBenefit, cur)}` : undefined, tone: t && t.realizedBenefit.lt(t.forecastBenefit) ? 'warn' : 'neutral' },
        ]}
      />

      {variance.byPeriod.length > 0 && (
        <div className="grid gap-5 xl:grid-cols-[1.2fr_1fr]">
          <ChartFrame
            title="Estimated vs actual run cost"
            description="Estimate for the same run month, including ramp-up and growth."
            legend={series}
            legendShape="line"
            table={{ columns: ['Month', 'Estimated', 'Actual', 'Variance'], rows: variance.byPeriod.map((x) => [periodLabel(x.period), money(x.estTotalCost, cur, 0), money(x.actTotalCost, cur, 0), signedPct(x.costVariancePct)]) }}
          >
            <Lines data={trend} series={series} xKey="period" format={(v) => compact(v, cur)} labelFormat={periodLabel} height={240} />
          </ChartFrame>
          <Panel title="Variance by month" padded={false}>
            <div className="scroll-x">
              <table className="dtable min-w-[440px] text-[13.5px]">
                <thead>
                  <tr>
                    <th>Month</th>
                    <th className="r">Accepted, est. / act.</th>
                    <th className="r">Run cost, est. / act.</th>
                    <th className="r">Variance</th>
                  </tr>
                </thead>
                <tbody>
                  {variance.byPeriod.map((x) => (
                    <tr key={x.period}>
                      <td className="font-semibold whitespace-nowrap">{periodLabel(x.period)}</td>
                      <td className="r">
                        {tokens(x.estAccepted)} / {tokens(x.actAccepted)}
                      </td>
                      <td className="r">
                        {compact(x.estTotalCost, cur)} / {compact(x.actTotalCost, cur)}
                      </td>
                      <td className={cx('r font-semibold', tone(n(x.costVariancePct)))}>{signedPct(x.costVariancePct)}</td>
                    </tr>
                  ))}
                </tbody>
                {t && (
                  <tfoot>
                    <tr>
                      <td>Total</td>
                      <td className="r">
                        {tokens(t.estAccepted)} / {tokens(t.actAccepted)}
                      </td>
                      <td className="r">
                        {compact(t.estTotalCost, cur)} / {compact(t.actTotalCost, cur)}
                      </td>
                      <td className={cx('r', tone(n(t.costVariancePct)))}>{signedPct(t.costVariancePct)}</td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
            <p className="px-4 py-2.5 text-[12.5px] text-ink-3 border-t border-line-soft">
              Full monthly detail by workflow, tokens and unit cost is on the{' '}
              <a className="text-brand font-semibold hover:underline underline-offset-2" href={href('dashboard') + '?view=finops'}>
                AI FinOps dashboard
              </a>
              .
            </p>
          </Panel>
        </div>
      )}

      <Panel
        title="Actual records"
        description={`One row per month and workflow. Amounts in the row currency are converted to ${cur} for variance.`}
        padded={false}
      >
        <div className="px-4">
          <div className="flex flex-wrap gap-2 mb-3">
            <Button className="!text-brand-ink" size="sm" variant="primary" icon={<Plus size={14} />} onClick={addRow} disabled={!canEdit || !p.workflows.length}>
              Add month
            </Button>
            <Button size="sm" icon={<ClipboardPaste size={14} />} onClick={() => setPasteOpen(true)} disabled={!canEdit}>
              Paste CSV
            </Button>
            <Button size="sm" icon={<Download size={14} />} onClick={exportCsv} disabled={!p.actuals.length}>
              Export CSV
            </Button>
          </div>
          <ReadOnlyNote show={!canEdit} what="record actuals" />
          {(outOfTerm > 0 || unknownWf > 0) && (
            <div className="mb-3">
              <Callout tone="warn">
                {outOfTerm > 0 && `${outOfTerm} rows fall outside the ${term}-month run period and are excluded from variance. `}
                {unknownWf > 0 && `${unknownWf} rows reference a workflow that no longer exists.`}
              </Callout>
            </div>
          )}
        </div>
        {p.actuals.length === 0 ? (
          <Empty title="No actuals recorded" body="Add a month (pre-filled with the estimate so you overwrite real figures) or paste a CSV exported from your billing and observability tools." />
        ) : (
          <div className="scroll-x">
            <table className="dtable min-w-[1320px]">
              <thead>
                <tr>
                  <th>Period</th>
                  <th className="r">Run month</th>
                  <th>Workflow</th>
                  <th className="r">Attempted</th>
                  <th className="r">Accepted</th>
                  <th className="r">Input tokens</th>
                  <th className="r">Output tokens</th>
                  <th className="r">LLM cost</th>
                  <th className="r">Non-LLM cost</th>
                  <th className="r">Realised benefit</th>
                  <th>Currency</th>
                  <th className="r">Remove</th>
                </tr>
              </thead>
              <tbody>
                {indexed.map(({ a, i }) => {
                  const bad = a.monthIndex < 1 || a.monthIndex > term;
                  const num = (k: 'attempted' | 'accepted' | 'inputTokens' | 'outputTokens' | 'llmCost' | 'nonLlmCost' | 'realizedBenefit', label: string, w = 120) => (
                    <td className="r">
                      <NumberInput ariaLabel={`${label}, ${a.period}`} width={w} value={a[k]} min={0} disabled={!canEdit} onChange={(v) => setRow(i, label, (x) => void (x[k] = v))} />
                    </td>
                  );
                  return (
                    <tr key={`${a.period}-${a.workflowId}-${i}`}>
                      <td>
                        <MonthInput ariaLabel={`Period of row ${i + 1}`} className="!w-[150px]" value={a.period} disabled={!canEdit} onChange={(v) => setRow(i, 'period', (x) => void (x.period = v))} />
                      </td>
                      <td className={cx('r', bad && 'text-bad font-semibold')} title={bad ? 'Outside the contract run period' : undefined}>
                        {a.monthIndex}
                      </td>
                      <td style={{ minWidth: 200 }}>
                        <Select
                          ariaLabel={`Workflow of row ${i + 1}`}
                          value={a.workflowId}
                          disabled={!canEdit}
                          onChange={(v) => setRow(i, 'workflow', (x) => void (x.workflowId = v))}
                          options={[...(!p.workflows.some((w) => w.id === a.workflowId) ? [{ value: a.workflowId, label: `Unknown (${a.workflowId})` }] : []), ...p.workflows.map((w) => ({ value: w.id, label: w.name }))]}
                        />
                      </td>
                      {num('attempted', 'Attempted', 110)}
                      {num('accepted', 'Accepted', 110)}
                      {num('inputTokens', 'Input tokens', 140)}
                      {num('outputTokens', 'Output tokens', 130)}
                      {num('llmCost', 'LLM cost', 120)}
                      {num('nonLlmCost', 'Non-LLM cost', 120)}
                      {num('realizedBenefit', 'Realised benefit', 130)}
                      <td style={{ width: 96 }}>
                        <Select ariaLabel={`Currency of row ${i + 1}`} value={a.currency} disabled={!canEdit} onChange={(v) => setRow(i, 'currency', (x) => void (x.currency = v))} options={currencies.map((c) => ({ value: c, label: c }))} />
                      </td>
                      <td className="r">
                        <IconButton label={`Remove ${a.period} row`} tone="bad" disabled={!canEdit} onClick={() => update('Removed actual row', (d) => void d.actuals.splice(i, 1), `${p.name}: ${a.period}`)}>
                          <Trash2 size={15} />
                        </IconButton>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <PasteModal open={pasteOpen} onClose={() => setPasteOpen(false)} project={p} currencies={currencies} onImport={(rows, mode) => {
        update(
          mode === 'replace' ? 'Replaced actuals from CSV' : 'Imported actuals from CSV',
          (d) => {
            if (mode === 'replace') d.actuals = rows;
            else {
              const key = (a: ActualRecord) => `${a.period}|${a.workflowId}`;
              const incoming = new Set(rows.map(key));
              d.actuals = [...d.actuals.filter((a) => !incoming.has(key(a))), ...rows];
            }
          },
          `${p.name}: ${rows.length} rows`,
        );
        setPasteOpen(false);
      }} />
    </div>
  );
}

function PasteModal({ open, onClose, project: p, currencies, onImport }: { open: boolean; onClose: () => void; project: Project; currencies: string[]; onImport: (rows: ActualRecord[], mode: 'merge' | 'replace') => void }) {
  const [text, setText] = useState('');
  const [currency, setCurrency] = useState(p.currency);
  const [mode, setMode] = useState<'merge' | 'replace'>('merge');
  const parsed = useMemo(() => (text.trim() ? parseCsv(text, p, currency) : null), [text, p, currency]);
  const example = p.workflows[0];
  const template = [CSV_HEADER.join(','), example ? `${p.goLiveDate},${example.id},${example.monthlyVolume},${Math.round(example.monthlyVolume * 0.9)},250000000,30000000,850000,620000,1200000` : ''].join('\n');
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Paste actuals CSV"
      wide
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button className="!text-brand-ink" variant="primary" disabled={!parsed || parsed.rows.length === 0} onClick={() => parsed && onImport(parsed.rows, mode)}>
            {parsed && parsed.rows.length ? `Import ${parsed.rows.length} ${parsed.rows.length === 1 ? 'row' : 'rows'}` : 'Import rows'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div>
          <div className="flex items-center justify-between gap-2 mb-1">
            <span className="text-[13px] font-semibold text-ink-2">Template</span>
            <button type="button" className="!text-[13px] !font-semibold !text-brand hover:underline underline-offset-2" onClick={() => setText(template)}>
              Use template
            </button>
          </div>
          <pre className="text-[12px] bg-sunken border border-line rounded-md px-3 py-2 overflow-x-auto num">{template}</pre>
          <p className="text-[12.5px] text-ink-3 mt-1">
            One row per month and workflow. Period is YYYY-MM; workflow_id is an id (or exact name) from:{' '}
            {p.workflows.map((w) => (
              <span key={w.id} className="whitespace-nowrap">
                <code className="text-ink-2">{w.id}</code> ({w.name}){' '}
              </span>
            ))}
            Output tokens include reasoning tokens. Commas, tabs or semicolons separate columns.
          </p>
        </div>
        <textarea className="field num text-[13px]" rows={8} aria-label="CSV rows" placeholder="Paste rows here, with or without the header" value={text} onChange={(e) => setText(e.target.value)} />
        <div className="flex flex-wrap items-center gap-4">
          <label className="inline-flex items-center gap-2 text-sm text-ink-2">
            Amounts in
            <select className="field !w-auto" value={currency} onChange={(e) => setCurrency(e.target.value)}>
              {currencies.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </label>
          <Segmented<'merge' | 'replace'>
            ariaLabel="Import mode"
            value={mode}
            onChange={setMode}
            options={[
              { id: 'merge', label: 'Merge (replace same month and workflow)' },
              { id: 'replace', label: 'Replace all actuals' },
            ]}
          />
        </div>
        {parsed && (
          <div className="space-y-2">
            {parsed.rows.length > 0 && <p className="text-sm text-good font-semibold">{parsed.rows.length} rows ready to import.</p>}
            {parsed.errors.length > 0 && (
              <Callout tone="bad" title={`${parsed.errors.length} ${parsed.errors.length === 1 ? 'line' : 'lines'} cannot be imported`}>
                <ul className="space-y-0.5 max-h-40 overflow-y-auto">
                  {parsed.errors.map((e, k) => (
                    <li key={k}>
                      <span className="font-semibold num">Line {e.line}:</span> {e.message}
                    </li>
                  ))}
                </ul>
                {parsed.rows.length > 0 && <p className="mt-1">Valid rows can still be imported; fix the others and paste them again.</p>}
              </Callout>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}
