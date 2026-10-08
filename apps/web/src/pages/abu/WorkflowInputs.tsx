import { Plus, Trash2 } from 'lucide-react';
import { uid, type Catalog, type ComplexityClass, type Workflow, type WorkflowVolumes } from '@aies/engine';
import { Badge, Button, Field, Panel, ReadOnlyNote, Segmented, Select, TextArea, TextInput, cx } from '../../components/ui';
import { count, n, pct } from '../../lib/format';
import { currencyOptions, IconButton, OptionalNumberInput, type Updater, Num } from '../costing/common';

type SetWf = (what: string, fn: (w: Workflow) => void) => void;

export function useWorkflowSetter(update: Updater, wfId: string): SetWf {
  return (what, fn) =>
    update(what, (d) => {
      const w = d.workflows.find((x) => x.id === wfId);
      if (w) fn(w);
    });
}

export function DefinitionPanel({ wf, setWf, ro }: { wf: Workflow; setWf: SetWf; ro: boolean }) {
  return (
    <Panel title="Business unit definition" description="What one accepted ABU means for this workflow. Agree it with the client: it is what they pay for.">
      <ReadOnlyNote show={ro} what="edit the ABU definition" />
      <div className="grid gap-3 sm:grid-cols-[200px_1fr]">
        <Field label="ABU name (singular)">
          <TextInput value={wf.abuName} disabled={ro} ariaLabel="ABU name" onChange={(v) => setWf('Renamed ABU', (w) => (w.abuName = v.trim() || w.abuName))} />
        </Field>
        <Field label="Definition">
          <TextArea value={wf.abuDefinition} rows={2} disabled={ro} ariaLabel="ABU definition" onChange={(v) => setWf('Changed ABU definition', (w) => (w.abuDefinition = v))} />
        </Field>
      </div>
      <div className="mt-4">
        <div className="text-[13px] font-semibold text-ink-2 mb-1.5">Acceptance criteria</div>
        {wf.acceptanceCriteria.length === 0 && <p className="text-[13.5px] text-ink-3 mb-2">No criteria yet. Add the checks a transaction must pass to count as accepted.</p>}
        <ol className="space-y-1.5">
          {wf.acceptanceCriteria.map((c, i) => (
            <li key={`${i}-${c}`} className="flex items-center gap-2">
              <span className="num text-[12.5px] text-ink-3 w-5 text-right shrink-0">{i + 1}.</span>
              <TextInput value={c} disabled={ro} ariaLabel={`Acceptance criterion ${i + 1}`} onChange={(v) => setWf('Changed acceptance criterion', (w) => (w.acceptanceCriteria[i] = v))} />
              <IconButton label="Remove criterion" tone="bad" disabled={ro} onClick={() => setWf('Removed acceptance criterion', (w) => void w.acceptanceCriteria.splice(i, 1))}>
                <Trash2 size={15} />
              </IconButton>
            </li>
          ))}
        </ol>
        <Button size="sm" variant="ghost" className="mt-1.5" icon={<Plus size={13} />} disabled={ro} onClick={() => setWf('Added acceptance criterion', (w) => void w.acceptanceCriteria.push('New criterion'))}>
          Add criterion
        </Button>
      </div>
    </Panel>
  );
}

const FUNNEL_FIELDS: { key: keyof Workflow; label: string; hint: string; suffix?: string; max?: number; step?: number }[] = [
  { key: 'monthlyVolume', label: 'Monthly volume', hint: 'Unique transactions attempted at steady state.', step: 1000 },
  { key: 'annualGrowthPct', label: 'Annual growth', hint: 'Volume growth per contract year.', suffix: '%' },
  { key: 'successRatePct', label: 'Success rate', hint: 'Attempted transactions the agent completes.', suffix: '%', max: 100 },
  { key: 'acceptanceRatePct', label: 'Acceptance rate', hint: 'Completed transactions that meet the criteria.', suffix: '%', max: 100 },
  { key: 'retryRatePct', label: 'Retry rate', hint: 'Extra executions per attempted transaction.', suffix: '%' },
  { key: 'retryConsumptionPct', label: 'Retry consumption', hint: 'Cost of a retry relative to a full run.', suffix: '%', max: 200 },
  { key: 'failedConsumptionPct', label: 'Failed consumption', hint: 'Cost of a failed run relative to a full run.', suffix: '%', max: 200 },
  { key: 'humanInterventionRatePct', label: 'Human intervention', hint: 'Accepted transactions a person had to assist.', suffix: '%', max: 100 },
];

export function FunnelInputs({ wf, setWf, ro }: { wf: Workflow; setWf: SetWf; ro: boolean }) {
  return (
    <Panel title="Funnel assumptions" description="Drive volumes, failure cost and human effort. Retries and failures consume resources but never create ABUs.">
      <ReadOnlyNote show={ro} what="edit funnel assumptions" />
      <div className="grid gap-x-4 gap-y-3 grid-cols-2 lg:grid-cols-4">
        {FUNNEL_FIELDS.map((f) => (
          <Field key={f.key} label={f.label} hint={f.hint}>
            <Num
              value={wf[f.key] as number}
              min={0}
              max={f.max}
              step={f.step}
              suffix={f.suffix}
              disabled={ro}
              ariaLabel={f.label}
              onChange={(v) => setWf(`Changed ${f.label.toLowerCase()}`, (w) => ((w[f.key] as number) = v))}
            />
          </Field>
        ))}
      </div>
    </Panel>
  );
}

export function ComplexityPanel({ wf, v, setWf, ro, cur, overrideActive }: { wf: Workflow; v: WorkflowVolumes; setWf: SetWf; ro: boolean; cur: string; overrideActive: boolean }) {
  const total = wf.complexity.reduce((a, c) => a + c.sharePct, 0);
  const off = wf.complexity.length > 0 && Math.abs(total - 100) > 0.5;
  const setClass = (id: string, what: string, fn: (c: ComplexityClass) => void) =>
    setWf(what, (w) => {
      const c = w.complexity.find((x) => x.id === id);
      if (c) fn(c);
    });
  return (
    <Panel
      title="Complexity classes"
      description="Harder transactions earn more ABUs and consume more. The consumption multiplier scales LLM tokens and complexity-scaled cost lines; the human-effort multiplier scales review minutes."
      padded={false}
      actions={
        <Button
          size="sm"
          icon={<Plus size={14} />}
          disabled={ro}
          onClick={() =>
            setWf('Added complexity class', (w) => void w.complexity.push({ id: uid('cx'), name: 'New class', sharePct: 0, abuWeight: 1, consumptionMultiplier: 1, humanEffortMultiplier: 1, priceOverride: null }))
          }
        >
          Add class
        </Button>
      }
    >
      <div className="px-4">
        <ReadOnlyNote show={ro} what="edit complexity classes" />
        {off && (
          <p className="text-[13px] text-warn mb-2">
            Shares sum to <span className="num font-semibold">{pct(total, 1)}</span>. The engine normalises them to 100%; adjust them so the mix reads as intended.
          </p>
        )}
        {wf.complexity.length === 0 && <p className="text-[13px] text-ink-3 mb-2">No classes: every accepted transaction counts as one ABU at standard consumption.</p>}
      </div>
      {wf.complexity.length > 0 && (
        <div className="scroll-x">
          <table className="dtable min-w-[900px]">
            <thead>
              <tr>
                <th>Class</th>
                <th className="r">Share</th>
                <th className="r">ABU weight</th>
                <th className="r">Consumption</th>
                <th className="r">Human effort</th>
                <th className="r">Price override</th>
                <th className="r">Accepted / month</th>
                <th className="r">Weighted ABUs</th>
                <th aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {wf.complexity.map((c) => {
                const cv = v.byClass.find((x) => x.classId === c.id);
                return (
                  <tr key={c.id}>
                    <td className="min-w-[160px]">
                      <TextInput value={c.name} disabled={ro} ariaLabel="Class name" onChange={(x) => setClass(c.id, 'Renamed complexity class', (k) => (k.name = x))} />
                    </td>
                    <td className="r">
                      <Num width={84} value={c.sharePct} min={0} max={100} suffix="%" disabled={ro} ariaLabel={`${c.name} share`} onChange={(x) => setClass(c.id, 'Changed complexity share', (k) => (k.sharePct = x))} />
                    </td>
                    <td className="r">
                      <Num width={80} value={c.abuWeight} min={0} step={0.5} disabled={ro} ariaLabel={`${c.name} ABU weight`} onChange={(x) => setClass(c.id, 'Changed ABU weight', (k) => (k.abuWeight = x))} />
                    </td>
                    <td className="r">
                      <Num
                        width={80}
                        value={c.consumptionMultiplier}
                        min={0}
                        step={0.1}
                        suffix="×"
                        disabled={ro}
                        ariaLabel={`${c.name} consumption multiplier`}
                        onChange={(x) => setClass(c.id, 'Changed consumption multiplier', (k) => (k.consumptionMultiplier = x))}
                      />
                    </td>
                    <td className="r">
                      <Num
                        width={80}
                        value={c.humanEffortMultiplier}
                        min={0}
                        step={0.1}
                        suffix="×"
                        disabled={ro}
                        ariaLabel={`${c.name} human-effort multiplier`}
                        onChange={(x) => setClass(c.id, 'Changed human-effort multiplier', (k) => (k.humanEffortMultiplier = x))}
                      />
                    </td>
                    <td className="r">
                      <div className={cx('flex justify-end', !overrideActive && 'opacity-70')}>
                        <OptionalNumberInput
                          width={110}
                          value={c.priceOverride}
                          placeholder="None"
                          disabled={ro}
                          ariaLabel={`${c.name} price override`}
                          onChange={(x) => setClass(c.id, x === null ? 'Removed class price override' : 'Set class price override', (k) => (k.priceOverride = x))}
                        />
                      </div>
                    </td>
                    <td className="r">{count(cv?.accepted ?? 0, cur)}</td>
                    <td className="r font-semibold">{count(cv?.weightedAbus ?? 0, cur)}</td>
                    <td className="r">
                      <IconButton label={`Remove ${c.name}`} tone="bad" disabled={ro} onClick={() => setWf('Removed complexity class', (w) => void (w.complexity = w.complexity.filter((k) => k.id !== c.id)))}>
                        <Trash2 size={15} />
                      </IconButton>
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr>
                <td>Mix</td>
                <td className={cx('r', off && 'text-warn')}>{pct(total, 0)}</td>
                <td className="r" colSpan={2}>
                  {n(v.consumptionMix).toFixed(2)}× consumption
                </td>
                <td className="r">{n(v.humanEffortMix).toFixed(2)}×</td>
                <td className="r text-[12.5px] font-normal text-ink-3">{overrideActive ? 'Overrides in use' : 'Used with override pricing'}</td>
                <td className="r">{count(v.accepted, cur)}</td>
                <td className="r">{count(v.weightedAbus, cur)}</td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </Panel>
  );
}

export function HumanReviewPanel({ wf, setWf, ro, catalog, hours, cost, cur }: { wf: Workflow; setWf: SetWf; ro: boolean; catalog: Catalog; hours: string; cost: string; cur: string }) {
  const hr = wf.humanReview;
  return (
    <Panel title="Human review and exceptions" description="Minutes people spend assisting accepted transactions and reworking rejected ones.">
      <ReadOnlyNote show={ro} what="edit human review" />
      <div className="grid gap-x-4 gap-y-3 grid-cols-2">
        <Field label="Minutes per assisted transaction" hint="Scaled by the human-effort mix.">
          <Num
            value={hr.minutesPerAssistedTxn}
            min={0}
            disabled={ro}
            ariaLabel="Minutes per assisted transaction"
            onChange={(v) => setWf('Changed review minutes per assisted transaction', (w) => (w.humanReview.minutesPerAssistedTxn = v))}
          />
        </Field>
        <Field label="Minutes per rejected transaction" hint="Rework of completed but rejected work.">
          <Num
            value={hr.minutesPerRejectedTxn}
            min={0}
            disabled={ro}
            ariaLabel="Minutes per rejected transaction"
            onChange={(v) => setWf('Changed review minutes per rejected transaction', (w) => (w.humanReview.minutesPerRejectedTxn = v))}
          />
        </Field>
        <Field label="Loaded hourly cost">
          <div className="flex gap-1.5">
            <Num value={hr.hourlyCost} min={0} disabled={ro} ariaLabel="Reviewer hourly cost" onChange={(v) => setWf('Changed reviewer hourly cost', (w) => (w.humanReview.hourlyCost = v))} />
            <Select
              className="!w-[86px] shrink-0"
              value={hr.currency}
              options={currencyOptions(catalog)}
              disabled={ro}
              ariaLabel="Reviewer cost currency"
              onChange={(v) => setWf('Changed reviewer cost currency', (w) => (w.humanReview.currency = v))}
            />
          </div>
        </Field>
        <Field label="Borne by" hint={hr.borneBy === 'provider' ? 'Provider cost, priced into the ABU.' : 'Client staff time, not a provider cost.'}>
          <div className={cx(ro && 'pointer-events-none opacity-60')}>
            <Segmented
              ariaLabel="Review borne by"
              value={hr.borneBy}
              onChange={(v) => setWf('Changed who bears human review', (w) => (w.humanReview.borneBy = v))}
              options={[
                { id: 'provider', label: 'Provider' },
                { id: 'client', label: 'Client' },
              ]}
            />
          </div>
        </Field>
      </div>
      <div className="mt-3 border-t border-line-soft pt-2 text-[13.5px] text-ink-2 flex flex-wrap justify-between gap-2">
        <span>
          {hr.borneBy === 'provider' ? 'Provider review effort' : 'Client review effort'}: <span className="num font-semibold text-ink">{hours} hours</span> a month
        </span>
        {hr.borneBy === 'provider' ? (
          <span>
            Cost <span className="num font-semibold text-ink">{cost}</span> / month in {cur}
          </span>
        ) : (
          <Badge>Not in provider cost</Badge>
        )}
      </div>
    </Panel>
  );
}
