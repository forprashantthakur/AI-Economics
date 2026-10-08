import { CheckCircle2, Plus, Trash2, XCircle, BadgeCheck } from 'lucide-react';
import { uid, type BenefitCategory, type BenefitLine, type BenefitStatus, type ProjectResult } from '@aies/engine';
import { Badge, Button, Checkbox, Field, NumberInput, Panel, Select, TextInput, cx } from '../../components/ui';
import { compact, money } from '../../lib/format';
import { useStore } from '../../state/store';
import { CATEGORY_LABEL, CATEGORY_ORDER, STATUS_META, currencyOptions, today, type Updater } from './shared';

/** Fields whose change invalidates a Finance sign-off. */
const FINANCIAL_KEYS: (keyof BenefitLine)[] = ['category', 'annualAmount', 'currency', 'startMonth', 'rampMonths', 'confidencePct', 'overlapGroup', 'scalesWithVolume'];

export function BenefitRegister({ r, update, canEdit, canValidate }: { r: ProjectResult; update: Updater; canEdit: boolean; canValidate: boolean }) {
  const { state } = useStore();
  const cur = r.currency;
  const benefits = r.project.value.benefits;
  const forecastView = r.project.value.includeUnvalidated;

  const edit = <K extends keyof BenefitLine>(id: string, k: K, v: BenefitLine[K], label: string) =>
    update(`Changed benefit ${label}`, (d) => {
      const b = d.value.benefits.find((x) => x.id === id);
      if (!b) return;
      b[k] = v;
      // A validated figure that someone without sign-off rights changes goes back to Finance.
      if (!canValidate && FINANCIAL_KEYS.includes(k) && (b.status === 'finance_validated' || b.status === 'realized')) {
        b.status = 'proposed';
        b.validatedBy = undefined;
        b.validatedOn = undefined;
      }
    });

  const setStatus = (b: BenefitLine, status: BenefitStatus) =>
    update(
      status === 'finance_validated' ? 'Validated benefit' : status === 'realized' ? 'Marked benefit realised' : status === 'rejected' ? 'Rejected benefit' : 'Reopened benefit',
      (d) => {
        const x = d.value.benefits.find((y) => y.id === b.id);
        if (!x) return;
        x.status = status;
        if (status === 'proposed') {
          x.validatedBy = undefined;
          x.validatedOn = undefined;
        } else {
          x.validatedBy = state.user.name;
          x.validatedOn = today();
        }
      },
      b.name,
    );

  const add = () =>
    update('Added benefit', (d) => {
      d.value.benefits.push({
        id: uid('b'),
        name: 'New benefit',
        category: 'hard_savings',
        annualAmount: 0,
        currency: d.currency,
        startMonth: 1,
        rampMonths: 3,
        confidencePct: 80,
        status: 'proposed',
        overlapGroup: null,
        scalesWithVolume: false,
        notes: '',
      });
    });

  const groups = [...new Set(benefits.map((b) => b.overlapGroup).filter(Boolean))] as string[];

  return (
    <Panel
      title="Benefit register"
      description={
        <>
          Financial benefits the client expects. Only finance-validated or realised benefits count toward ROI{forecastView ? ' (the forecast view currently also counts proposed ones)' : ''}. Benefits
          sharing an overlap group are alternatives, so only the largest counts; capacity conversion is capped at released productivity value.
          {!canValidate && canEdit && ' Changing the figures of a validated benefit returns it to Finance for re-validation.'}
        </>
      }
      actions={
        <Button size="sm" icon={<Plus size={14} />} disabled={!canEdit} onClick={add}>
          Add benefit
        </Button>
      }
      padded={false}
    >
      {benefits.length === 0 ? (
        <p className="px-4 pb-4 text-sm text-ink-3">No benefits recorded. Add the savings, avoided costs or revenue contribution the client has agreed to track.</p>
      ) : (
        <ul className="divide-y divide-line-soft border-t border-line-soft">
          {benefits.map((b) => {
            const line = r.steady.value.lines.find((l) => l.lineId === b.id);
            const counted = forecastView ? line?.countedForecast : line?.countedValidated;
            const meta = STATUS_META[b.status];
            const fid = (k: string) => `b-${b.id}-${k}`;
            return (
              <li key={b.id} className="px-4 py-4" data-benefit={b.id}>
                <div className="flex flex-wrap items-start gap-x-3 gap-y-2">
                  <div className="flex-1 min-w-[220px]">
                    <TextInput value={b.name} ariaLabel="Benefit name" disabled={!canEdit} className="font-semibold" onChange={(v) => edit(b.id, 'name', v || 'Unnamed benefit', 'name')} />
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone={meta.tone}>{meta.label}</Badge>
                    {canValidate && (
                      <>
                        <Button size="sm" icon={<CheckCircle2 size={14} />} disabled={b.status === 'finance_validated'} onClick={() => setStatus(b, 'finance_validated')}>
                          Validate
                        </Button>
                        <Button size="sm" icon={<BadgeCheck size={14} />} disabled={b.status === 'realized'} onClick={() => setStatus(b, 'realized')}>
                          Mark realised
                        </Button>
                        <Button size="sm" variant="danger" icon={<XCircle size={14} />} disabled={b.status === 'rejected'} onClick={() => setStatus(b, 'rejected')}>
                          Reject
                        </Button>
                        {b.status !== 'proposed' && (
                          <Button size="sm" variant="ghost" onClick={() => setStatus(b, 'proposed')}>
                            Reopen
                          </Button>
                        )}
                      </>
                    )}
                    <Button
                      variant="ghost"
                      size="sm"
                      aria-label={`Remove ${b.name}`}
                      title="Remove benefit"
                      disabled={!canEdit}
                      onClick={() => update('Removed benefit', (d) => (d.value.benefits = d.value.benefits.filter((x) => x.id !== b.id)), b.name)}
                    >
                      <Trash2 size={15} />
                    </Button>
                  </div>
                </div>
                {b.validatedBy && b.status !== 'proposed' && (
                  <p className="text-[12.5px] text-ink-3 mt-1">
                    {meta.label} by {b.validatedBy}
                    {b.validatedOn ? ` on ${b.validatedOn}` : ''}
                  </p>
                )}

                <div className="grid gap-3 mt-3 grid-cols-2 sm:grid-cols-[repeat(auto-fill,minmax(150px,1fr))]">
                  <Field label="Category" htmlFor={fid('cat')} className="col-span-2 sm:col-span-1">
                    <Select<BenefitCategory>
                      id={fid('cat')}
                      value={b.category}
                      disabled={!canEdit}
                      options={CATEGORY_ORDER.map((c) => ({ value: c, label: CATEGORY_LABEL[c] }))}
                      onChange={(v) => edit(b.id, 'category', v, 'category')}
                    />
                  </Field>
                  <Field label="Annual amount" htmlFor={fid('amt')} className="col-span-2 sm:col-span-1">
                    <div className="flex gap-1.5">
                      <NumberInput id={fid('amt')} value={b.annualAmount} min={0} step={100000} disabled={!canEdit} onChange={(v) => edit(b.id, 'annualAmount', v, 'annual amount')} />
                      <Select
                        value={b.currency}
                        className="!w-[76px] shrink-0"
                        ariaLabel="Currency"
                        options={currencyOptions(state.catalog, b.currency)}
                        disabled={!canEdit}
                        onChange={(v) => edit(b.id, 'currency', v, 'currency')}
                      />
                    </div>
                  </Field>
                  <Field label="Start month" hint="1 = go-live month" htmlFor={fid('start')}>
                    <NumberInput id={fid('start')} value={b.startMonth} min={1} max={120} disabled={!canEdit} onChange={(v) => edit(b.id, 'startMonth', Math.round(v), 'start month')} />
                  </Field>
                  <Field label="Ramp months" htmlFor={fid('ramp')}>
                    <NumberInput id={fid('ramp')} value={b.rampMonths} min={0} max={60} disabled={!canEdit} onChange={(v) => edit(b.id, 'rampMonths', Math.round(v), 'ramp months')} />
                  </Field>
                  <Field label="Confidence" htmlFor={fid('conf')}>
                    <NumberInput id={fid('conf')} value={b.confidencePct} suffix="%" min={0} max={100} step={5} disabled={!canEdit} onChange={(v) => edit(b.id, 'confidencePct', v, 'confidence')} />
                  </Field>
                  <Field label="Overlap group" hint="Same group = not additive" htmlFor={fid('grp')}>
                    <TextInput id={fid('grp')} value={b.overlapGroup ?? ''} placeholder="None" disabled={!canEdit} onChange={(v) => edit(b.id, 'overlapGroup', v.trim() || null, 'overlap group')} />
                  </Field>
                  <Field label="Volume" className="self-center">
                    <Checkbox checked={b.scalesWithVolume} disabled={!canEdit} label="Scales with volume" onChange={(v) => edit(b.id, 'scalesWithVolume', v, 'volume scaling')} />
                  </Field>
                </div>
                <div className="mt-3">
                  <TextInput value={b.notes ?? ''} ariaLabel="Notes" placeholder="Notes: evidence, mechanism, who signs off" disabled={!canEdit} onChange={(v) => edit(b.id, 'notes', v, 'notes')} />
                </div>

                <div className="mt-3 flex flex-wrap items-baseline gap-x-6 gap-y-1 text-[13px] rounded-md bg-sunken px-3 py-2">
                  <span className="text-ink-2">
                    Gross at steady state <span className="num font-semibold text-ink">{money(line?.gross ?? 0, cur, 0)}</span>/mo
                  </span>
                  <span className="text-ink-2">
                    Counted in ROI <span className={cx('num font-semibold', counted && counted.gt(0) ? 'text-good' : 'text-ink-3')}>{money(counted ?? 0, cur, 0)}</span>/mo
                  </span>
                  <span className="text-ink-2">
                    Annual {compact(b.annualAmount, b.currency)} at {b.confidencePct}% confidence
                  </span>
                  {line?.excludedReason &&
                    (forecastView && b.status === 'proposed' && line.excludedReason === 'Not finance-validated' ? (
                      <span className="text-warn font-semibold">Forecast view only: not finance-validated</span>
                    ) : (
                      <span className="text-warn font-semibold">Excluded: {line.excludedReason}</span>
                    ))}
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {groups.length > 0 && <p className="px-4 py-2.5 text-[12.5px] text-ink-3 border-t border-line-soft">Overlap groups in use: {groups.join(', ')}.</p>}
    </Panel>
  );
}
