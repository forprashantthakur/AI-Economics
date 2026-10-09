import type { GainshareConfig, PricingConfig, ProjectResult, SubscriptionConfig } from '@aies/engine';
import { Field, KeyValues, NumberInput, Panel, Segmented, Select, Toggle } from '../../components/ui';
import { money, unitPrice } from '../../lib/format';
import type { Updater } from './shared';

type NumKey = 'termMonths' | 'priceEscalationPct' | 'costInflationPct' | 'llmPriceChangePct' | 'rampMonths' | 'rampStartPct' | 'passThroughMarkupPct';

const TERMS: { key: NumKey; label: string; suffix?: string; min?: number; max?: number; step?: number; hint: string }[] = [
  { key: 'termMonths', label: 'Contract term', suffix: 'mo', min: 1, max: 120, hint: 'Run months after go-live.' },
  { key: 'priceEscalationPct', label: 'Annual price escalation', suffix: '%', min: -20, max: 50, step: 0.5, hint: 'Applied to locked prices each contract year.' },
  { key: 'costInflationPct', label: 'Cost inflation', suffix: '%', min: -20, max: 50, step: 0.5, hint: 'Non-LLM cost growth per year.' },
  { key: 'llmPriceChangePct', label: 'Annual LLM price change', suffix: '%', min: -80, max: 100, step: 1, hint: 'Negative when model prices fall.' },
  { key: 'rampMonths', label: 'Ramp months', suffix: 'mo', min: 0, max: 36, hint: 'Months to reach full volume.' },
  { key: 'rampStartPct', label: 'Ramp start', suffix: '%', min: 0, max: 100, step: 5, hint: 'Share of volume in month 1.' },
  { key: 'passThroughMarkupPct', label: 'Pass-through markup', suffix: '%', min: 0, max: 100, step: 1, hint: 'Handling margin on pass-through cost.' },
];

export function ContractTerms({ r, update, canEdit }: { r: ProjectResult; update: Updater; canEdit: boolean }) {
  const pr = r.project.pricing;
  const set = (key: NumKey, label: string, v: number) =>
    update(`Changed ${label.toLowerCase()}`, (d) => {
      (d.pricing as PricingConfig)[key] = key === 'termMonths' || key === 'rampMonths' ? Math.round(v) : v;
    });
  return (
    <Panel title="Contract terms" description="Term, escalation and ramp assumptions used to project every month of the contract.">
      <div className="grid gap-4 grid-cols-[repeat(auto-fill,minmax(170px,1fr))]">
        {TERMS.map((t) => (
          <Field key={t.key} label={t.label} hint={t.hint} htmlFor={`term-${t.key}`}>
            <NumberInput id={`term-${t.key}`} value={pr[t.key]} suffix={t.suffix} min={t.min} max={t.max} step={t.step} disabled={!canEdit} onChange={(v) => set(t.key, t.label, v)} />
          </Field>
        ))}
      </div>
    </Panel>
  );
}

export function SubscriptionPanel({ r, update, canEdit }: { r: ProjectResult; update: Updater; canEdit: boolean }) {
  const cur = r.currency;
  const sub = r.project.pricing.subscription;
  const sp = r.priceBook.streams.find((s) => s.type === 'subscription')?.subscription;
  const set = <K extends keyof SubscriptionConfig>(k: K, v: SubscriptionConfig[K], label: string) => update(`Changed subscription ${label}`, (d) => void (d.pricing.subscription[k] = v));
  const unitLabel = sub.includedUnit === 'none' ? '' : sub.includedUnit.toUpperCase();
  return (
    <Panel title="Subscription and committed capacity" description="A platform fee plus an optional allowance of included units; usage above the allowance is billed as overage.">
      <div className="grid gap-4 grid-cols-[repeat(auto-fill,minmax(170px,1fr))]">
        <Field label="Included unit">
          <div className={canEdit ? '' : 'opacity-50 pointer-events-none'} aria-disabled={!canEdit} inert={!canEdit || undefined}>
            <Segmented<SubscriptionConfig['includedUnit']>
              ariaLabel="Included unit"
              value={sub.includedUnit}
              onChange={(v) => canEdit && set('includedUnit', v, 'included unit')}
              options={[
                { id: 'none', label: 'None' },
                { id: 'acu', label: 'ACU' },
                { id: 'abu', label: 'ABU' },
              ]}
            />
          </div>
        </Field>
        <Field label="Included quantity" hint={unitLabel ? `${unitLabel}s per month` : 'No allowance'} htmlFor="sub-qty">
          <NumberInput id="sub-qty" value={sub.includedQty} min={0} step={1000} disabled={!canEdit || sub.includedUnit === 'none'} onChange={(v) => set('includedQty', v, 'included quantity')} />
        </Field>
        <Field label="Included discount" hint="Discount on the allowance" htmlFor="sub-disc">
          <NumberInput
            id="sub-disc"
            value={sub.includedDiscountPct}
            suffix="%"
            min={0}
            max={100}
            disabled={!canEdit || sub.includedUnit === 'none'}
            onChange={(v) => set('includedDiscountPct', v, 'included discount')}
          />
        </Field>
        <Field label="Overage premium" hint="Above the allowance unit price" htmlFor="sub-over">
          <NumberInput
            id="sub-over"
            value={sub.overagePremiumPct}
            suffix="%"
            min={0}
            max={300}
            disabled={!canEdit || sub.includedUnit === 'none'}
            onChange={(v) => set('overagePremiumPct', v, 'overage premium')}
          />
        </Field>
      </div>
      {sp && (
        <KeyValues
          className="mt-4 max-w-xl"
          rows={[
            ['Platform fee', `${money(sp.platformFee, cur, 0)} / month`],
            ['Included allowance value', `${money(sp.includedValue, cur, 0)} / month`],
            ['Total subscription fee', `${money(sp.totalFee, cur, 0)} / month`],
            ...(sp.includedUnit !== 'none' ? ([[`Overage rate per ${sp.includedUnit.toUpperCase()}`, unitPrice(sp.overageRate, cur)]] as [string, string][]) : []),
          ]}
        />
      )}
    </Panel>
  );
}

export function GainsharePanel({ r, update, canEdit }: { r: ProjectResult; update: Updater; canEdit: boolean }) {
  const cur = r.currency;
  const g = r.project.pricing.gainshare;
  const set = <K extends keyof GainshareConfig>(k: K, v: GainshareConfig[K], label: string) => update(`Changed gainshare ${label}`, (d) => void (d.pricing.gainshare[k] = v));
  const capped = g.capAnnual !== null && g.capAnnual !== undefined;
  return (
    <Panel title="Gainshare" description="The provider earns a share of client benefits above an annual threshold. Validated basis is the safer contract: only Finance-validated benefits are shared.">
      <div className="grid gap-4 grid-cols-[repeat(auto-fill,minmax(170px,1fr))]">
        <Field label="Provider share" htmlFor="gs-share">
          <NumberInput id="gs-share" value={g.sharePct} suffix="%" min={0} max={100} disabled={!canEdit} onChange={(v) => set('sharePct', v, 'share')} />
        </Field>
        <Field label="Annual threshold" hint={`Benefit before sharing starts (${cur})`} htmlFor="gs-thr">
          <NumberInput id="gs-thr" value={g.thresholdAnnual} min={0} step={100000} disabled={!canEdit} onChange={(v) => set('thresholdAnnual', v, 'threshold')} />
        </Field>
        <Field label="Annual cap" hint={capped ? `Maximum gainshare per year (${cur})` : 'Uncapped'}>
          <div className="flex items-center gap-2">
            <Toggle
              checked={capped}
              disabled={!canEdit}
              onChange={(v) => set('capAnnual', v ? Math.max(g.thresholdAnnual, 1_000_000) : null, 'cap')}
              label={<span className="sr-only">Cap gainshare</span>}
            />
            <NumberInput value={g.capAnnual ?? 0} min={0} step={100000} ariaLabel="Annual cap" disabled={!canEdit || !capped} onChange={(v) => set('capAnnual', v, 'cap')} />
          </div>
        </Field>
        <Field label="Benefit basis">
          <Select<GainshareConfig['basis']>
            ariaLabel="Benefit basis"
            value={g.basis}
            disabled={!canEdit}
            onChange={(v) => set('basis', v, 'basis')}
            options={[
              { value: 'validated', label: 'Validated benefits only' },
              { value: 'all', label: 'All forecast benefits' },
            ]}
          />
        </Field>
      </div>
    </Panel>
  );
}
