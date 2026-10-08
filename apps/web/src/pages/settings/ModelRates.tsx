import { Fragment, useMemo, useState } from 'react';
import { Copy, Plus, Search, Trash2 } from 'lucide-react';
import { SAMPLE_SOURCE, selfHostedPerM, uid, type CacheSemantics, type ModelRate, type ModelTier } from '@aies/engine';
import { Badge, Button, Callout, Field, Modal, Panel, ReadOnlyNote, Select, TextArea, TextInput, cx } from '../../components/ui';
import { money, num } from '../../lib/format';
import { useCan, useCatalogUpdater, useStore } from '../../state/store';
import { DateInput, IconButton, NumberInput, today } from '../projects/common';
import { DetailGrid, DetailSection, ExpandButton, SampleFlag, needsSource, usageLabel, useModelUsage } from './shared';

const TIERS: { value: ModelTier; label: string }[] = [
  { value: 'frontier', label: 'Frontier' },
  { value: 'balanced', label: 'Balanced' },
  { value: 'fast', label: 'Fast' },
  { value: 'open', label: 'Open weights' },
];
const CACHE: { value: CacheSemantics; label: string }[] = [
  { value: 'none', label: 'No caching' },
  { value: 'discounted_read', label: 'Discounted read' },
  { value: 'read_write', label: 'Read + write' },
];
const CACHE_HELP: Record<CacheSemantics, string> = {
  none: 'Every input token is billed at the input rate.',
  discounted_read: 'Cache hits are billed at the read rate; there is no write charge.',
  read_write: 'Cache hits are billed at the read rate and cache misses on the cacheable prefix at the write rate.',
};

function blankRate(currency: string): ModelRate {
  return {
    id: uid('model'),
    provider: 'New provider',
    model: 'New model',
    version: '',
    hostingPlatform: '',
    region: 'global',
    currency,
    effectiveDate: today(),
    tier: 'balanced',
    pricingBasis: 'per_token',
    inputPerM: 0,
    outputPerM: 0,
    cacheSemantics: 'none',
    cacheReadPerM: 0,
    cacheWritePerM: 0,
    batchDiscountPct: 0,
    otherPerCall: 0,
    contextWindow: 128000,
    source: '',
    assumptions: '',
    sample: false,
  };
}

export function ModelRatesTab() {
  const { state } = useStore();
  const canEdit = useCan('catalog.edit');
  const update = useCatalogUpdater();
  const usage = useModelUsage();
  const [open, setOpen] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [confirm, setConfirm] = useState<ModelRate | null>(null);
  const rates = state.catalog.modelRates;
  const currencies = [...new Set([state.catalog.fx.base, ...Object.keys(state.catalog.fx.rates)])];
  const sampleCount = rates.filter((r) => r.sample).length;

  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    return rates.filter((r) => !s || `${r.provider} ${r.model} ${r.hostingPlatform} ${r.region} ${r.id}`.toLowerCase().includes(s));
  }, [rates, q]);

  const edit = (id: string, label: string, mutate: (r: ModelRate) => void) => {
    const r = rates.find((x) => x.id === id);
    update(`Edited model rate: ${label}`, (c) => {
      const t = c.modelRates.find((x) => x.id === id);
      if (t) mutate(t);
    }, r ? `${r.provider} ${r.model}` : id);
  };

  const add = () => {
    const r = blankRate(state.catalog.fx.base);
    update('Added model rate', (c) => void c.modelRates.push(r), r.model);
    setOpen(r.id);
  };
  const duplicate = (src: ModelRate) => {
    const r: ModelRate = { ...structuredClone(src), id: uid('model'), model: `${src.model} (copy)`, effectiveDate: today() };
    update('Duplicated model rate', (c) => void c.modelRates.splice(c.modelRates.findIndex((x) => x.id === src.id) + 1, 0, r), `${src.model} to ${r.model}`);
    setOpen(r.id);
  };

  return (
    <div className="space-y-5">
      <Callout tone="warn" title="Shipped rates are illustrative samples">
        Every rate shipped with the studio is a sample for demonstration, not a vendor quote or a verified market price. Before quoting a client, replace each rate you use with the current published or contracted rate, record the source and
        effective date, and untick Sample to mark it verified. {sampleCount} of {rates.length} rates are still flagged as samples.
      </Callout>

      <Panel
        title="Model rate card"
        description="Token prices per 1M tokens in the rate currency. Projects route LLM steps to these entries; changes recompute every project immediately."
        padded={false}
        actions={
          <Button className="!text-brand-ink" size="sm" variant="primary" icon={<Plus size={14} />} onClick={add} disabled={!canEdit}>
            Add model
          </Button>
        }
      >
        <div className="px-4 flex flex-wrap items-center gap-3 pb-3">
          <ReadOnlyNote show={!canEdit} what="edit the rate card" />
          <div className="relative w-full sm:w-[280px]">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-3 pointer-events-none" aria-hidden />
            <input className="field !pl-8 text-[13.5px]" placeholder="Search provider, model or platform" aria-label="Search models" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
        </div>
        <div className="scroll-x">
          <table className="dtable min-w-[1080px]">
            <thead>
              <tr>
                <th className="w-8 relative">
                  <span className="sr-only">Details</span>
                </th>
                <th>Model</th>
                <th>Hosting</th>
                <th>Tier</th>
                <th className="r">Input / 1M</th>
                <th className="r">Output / 1M</th>
                <th>Caching</th>
                <th>Effective</th>
                <th>Rate status</th>
                <th>Used by</th>
                <th className="r">Actions</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => {
                const isOpen = open === r.id;
                const uses = usage.get(r.id);
                const derived = r.pricingBasis === 'self_hosted' ? selfHostedPerM(r) : null;
                return (
                  <Fragment key={r.id}>
                    <tr className={cx(isOpen && '[&>td]:bg-sunken')}>
                      <td>
                        <ExpandButton open={isOpen} onClick={() => setOpen(isOpen ? null : r.id)} label={r.model} />
                      </td>
                      <td className="min-w-[200px]">
                        <button type="button" className="text-left" onClick={() => setOpen(isOpen ? null : r.id)}>
                          <div className="font-semibold text-ink">{r.model}</div>
                          <div className="text-[12.5px] text-ink-3">
                            {r.provider}
                            {r.version ? `, ${r.version}` : ''}, {num(r.contextWindow / 1000)}K context
                          </div>
                        </button>
                      </td>
                      <td className="text-[13px] text-ink-2">
                        {r.hostingPlatform || '—'}
                        <div className="text-ink-3">{r.region}</div>
                      </td>
                      <td className="text-[13px] text-ink-2 capitalize">{r.tier}</td>
                      <td className="r text-[13.5px]">{derived ? <span title="Derived from GPU economics">{money(derived.inputPerM, r.currency, 3)}</span> : money(r.inputPerM, r.currency, 2)}</td>
                      <td className="r text-[13.5px]">{derived ? <span title="Derived from GPU economics">{money(derived.outputPerM, r.currency, 3)}</span> : money(r.outputPerM, r.currency, 2)}</td>
                      <td className="text-[13px] text-ink-2">{r.pricingBasis === 'self_hosted' ? <Badge>Self-hosted</Badge> : CACHE.find((c) => c.value === r.cacheSemantics)?.label}</td>
                      <td className="text-[13px] num whitespace-nowrap">{r.effectiveDate}</td>
                      <td>
                        <SampleFlag sample={r.sample} disabled={!canEdit} label={r.model} onChange={(v) => edit(r.id, v ? 'flagged as sample' : 'marked verified', (x) => void (x.sample = v))} />
                      </td>
                      <td className="text-[13px] text-ink-2 whitespace-nowrap">{usageLabel(uses?.reduce((a, u) => a + u.steps.length, 0) ?? 0, uses?.length ?? 0, 'step')}</td>
                      <td className="r whitespace-nowrap">
                        <IconButton label={`Duplicate ${r.model}`} disabled={!canEdit} onClick={() => duplicate(r)}>
                          <Copy size={15} />
                        </IconButton>
                        <IconButton label={`Delete ${r.model}`} tone="bad" disabled={!canEdit} onClick={() => setConfirm(r)}>
                          <Trash2 size={15} />
                        </IconButton>
                      </td>
                    </tr>
                    {isOpen && (
                      <tr>
                        <td colSpan={11} className="!bg-sunken !p-0">
                          <RateEditor rate={r} canEdit={canEdit} currencies={currencies} edit={(label, m) => edit(r.id, label, m)} />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
              {shown.length === 0 && (
                <tr>
                  <td colSpan={11} className="text-center text-ink-3 py-6">
                    No models match "{q}".
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Panel>

      <Modal
        open={!!confirm}
        onClose={() => setConfirm(null)}
        title="Delete model rate"
        footer={
          <>
            <Button onClick={() => setConfirm(null)}>Cancel</Button>
            <Button className="!text-bad"
              variant="danger"
              icon={<Trash2 size={15} />}
              onClick={() => {
                if (confirm) update('Deleted model rate', (c) => void (c.modelRates = c.modelRates.filter((x) => x.id !== confirm.id)), `${confirm.provider} ${confirm.model}`);
                if (open === confirm?.id) setOpen(null);
                setConfirm(null);
              }}
            >
              Delete rate
            </Button>
          </>
        }
      >
        {confirm &&
          (() => {
            const uses = usage.get(confirm.id);
            return (
              <div className="space-y-3 text-sm text-ink-2">
                <p>
                  Delete <span className="font-semibold text-ink">{confirm.model}</span> ({confirm.provider}) from the rate card?
                </p>
                {uses?.length ? (
                  <Callout tone="bad" title="Projects route LLM steps to this model">
                    <ul className="list-disc pl-5 space-y-0.5">
                      {uses.map((u) => (
                        <li key={u.project.id}>
                          <span className="font-semibold">{u.project.name}</span>: {u.steps.length} {u.steps.length === 1 ? 'step' : 'steps'} ({u.steps.slice(0, 3).map((s) => s.step).join(', ')}
                          {u.steps.length > 3 ? ', …' : ''})
                        </li>
                      ))}
                    </ul>
                    <p className="mt-1.5">Those steps stop being costed and the projects show an unknown-model error until you re-route them in Project Costing. Consider replacing the rates instead.</p>
                  </Callout>
                ) : (
                  <p>No project routes to this model, so no estimate changes.</p>
                )}
              </div>
            );
          })()}
      </Modal>
    </div>
  );
}

function RateEditor({ rate: r, canEdit, currencies, edit }: { rate: ModelRate; canEdit: boolean; currencies: string[]; edit: (label: string, m: (r: ModelRate) => void) => void }) {
  const d = !canEdit;
  const selfHosted = r.pricingBasis === 'self_hosted';
  const sh = r.selfHosted ?? { gpuHourlyCost: 0, gpusPerReplica: 1, outputTokensPerSecond: 1000, utilizationPct: 60, inputCostRatio: 0.2 };
  const derived = selfHosted ? selfHostedPerM(r) : null;
  const shEdit = (k: keyof typeof sh, label: string) => (v: number) =>
    edit(label, (x) => {
      x.selfHosted = { ...sh, ...(x.selfHosted ?? {}), [k]: v };
    });
  const unverifiedSource = needsSource(r.sample, r.source);
  return (
    <div className="px-5 py-4 space-y-5 border-y border-line">
      <DetailSection title="Identity">
        <DetailGrid>
          <Field label="Provider">
            <TextInput ariaLabel="Provider" value={r.provider} disabled={d} onChange={(v) => edit('provider', (x) => void (x.provider = v))} />
          </Field>
          <Field label="Model">
            <TextInput ariaLabel="Model" value={r.model} disabled={d} onChange={(v) => v.trim() && edit('model name', (x) => void (x.model = v.trim()))} />
          </Field>
          <Field label="Version">
            <TextInput ariaLabel="Version" value={r.version} disabled={d} onChange={(v) => edit('version', (x) => void (x.version = v))} />
          </Field>
          <Field label="Tier">
            <Select ariaLabel="Tier" value={r.tier} disabled={d} options={TIERS} onChange={(v) => edit('tier', (x) => void (x.tier = v))} />
          </Field>
          <Field label="Hosting platform">
            <TextInput ariaLabel="Hosting platform" value={r.hostingPlatform} disabled={d} onChange={(v) => edit('hosting platform', (x) => void (x.hostingPlatform = v))} />
          </Field>
          <Field label="Region">
            <TextInput ariaLabel="Region" value={r.region} disabled={d} onChange={(v) => edit('region', (x) => void (x.region = v))} />
          </Field>
          <Field label="Currency">
            <Select ariaLabel="Currency" value={r.currency} disabled={d} options={[...new Set([r.currency, ...currencies])].map((c) => ({ value: c, label: c }))} onChange={(v) => edit('currency', (x) => void (x.currency = v))} />
          </Field>
          <Field label="Effective date">
            <DateInput ariaLabel="Effective date" value={r.effectiveDate} disabled={d} onChange={(v) => edit('effective date', (x) => void (x.effectiveDate = v))} />
          </Field>
          <Field label="Context window" hint="Tokens">
            <NumberInput ariaLabel="Context window" value={r.contextWindow} min={1} step={1000} disabled={d} onChange={(v) => edit('context window', (x) => void (x.contextWindow = Math.round(v)))} />
          </Field>
          <Field label="Pricing basis">
            <Select
              ariaLabel="Pricing basis"
              value={r.pricingBasis}
              disabled={d}
              options={[
                { value: 'per_token', label: 'Per token (API)' },
                { value: 'self_hosted', label: 'Self-hosted (GPU)' },
              ]}
              onChange={(v) =>
                edit('pricing basis', (x) => {
                  x.pricingBasis = v;
                  if (v === 'self_hosted' && !x.selfHosted) x.selfHosted = { ...sh };
                })
              }
            />
          </Field>
        </DetailGrid>
      </DetailSection>

      {selfHosted ? (
        <DetailSection
          title="Self-hosted GPU economics"
          note={
            derived && (
              <>
                Derived rate: {money(derived.inputPerM, r.currency, 4)} input and {money(derived.outputPerM, r.currency, 4)} output per 1M tokens (GPU cost per hour ÷ sustained tokens per hour at the stated utilisation). Caching and batch discounts do not apply. Do not also cost the same
                GPUs as an infrastructure line.
              </>
            )
          }
        >
          <DetailGrid>
            <Field label="GPU cost per hour">
              <NumberInput ariaLabel="GPU cost per hour" value={sh.gpuHourlyCost} min={0} step={0.1} prefix={r.currency === 'USD' ? '$' : undefined} disabled={d} onChange={shEdit('gpuHourlyCost', 'GPU hourly cost')} />
            </Field>
            <Field label="GPUs per replica">
              <NumberInput ariaLabel="GPUs per replica" value={sh.gpusPerReplica} min={1} disabled={d} onChange={shEdit('gpusPerReplica', 'GPUs per replica')} />
            </Field>
            <Field label="Output tokens per second" hint="Sustained, per replica">
              <NumberInput ariaLabel="Output tokens per second" value={sh.outputTokensPerSecond} min={1} step={100} disabled={d} onChange={shEdit('outputTokensPerSecond', 'throughput')} />
            </Field>
            <Field label="Utilisation">
              <NumberInput ariaLabel="Utilisation" value={sh.utilizationPct} min={1} max={100} suffix="%" disabled={d} onChange={shEdit('utilizationPct', 'utilisation')} />
            </Field>
            <Field label="Input cost ratio" hint="Prefill cost relative to decode">
              <NumberInput ariaLabel="Input cost ratio" value={sh.inputCostRatio} min={0} step={0.05} disabled={d} onChange={shEdit('inputCostRatio', 'input cost ratio')} />
            </Field>
            <Field label="Other per-call charges">
              <NumberInput ariaLabel="Other per-call charges" value={r.otherPerCall} min={0} step={0.001} disabled={d} onChange={(v) => edit('per-call charges', (x) => void (x.otherPerCall = v))} />
            </Field>
          </DetailGrid>
        </DetailSection>
      ) : (
        <DetailSection title="Token prices per 1M tokens" note={CACHE_HELP[r.cacheSemantics]}>
          <DetailGrid>
            <Field label="Input">
              <NumberInput ariaLabel="Input price per 1M" value={r.inputPerM} min={0} step={0.1} disabled={d} onChange={(v) => edit('input price', (x) => void (x.inputPerM = v))} />
            </Field>
            <Field label="Output">
              <NumberInput ariaLabel="Output price per 1M" value={r.outputPerM} min={0} step={0.1} disabled={d} onChange={(v) => edit('output price', (x) => void (x.outputPerM = v))} />
            </Field>
            <Field label="Reasoning" hint={r.reasoningPerM === undefined ? 'Uses the output rate' : undefined}>
              <NumberInput ariaLabel="Reasoning price per 1M" value={r.reasoningPerM ?? r.outputPerM} min={0} step={0.1} disabled={d} onChange={(v) => edit('reasoning price', (x) => void (x.reasoningPerM = v))} />
            </Field>
            <Field label="Cache semantics">
              <Select ariaLabel="Cache semantics" value={r.cacheSemantics} disabled={d} options={CACHE} onChange={(v) => edit('cache semantics', (x) => void (x.cacheSemantics = v))} />
            </Field>
            <Field label="Cache read">
              <NumberInput ariaLabel="Cache read price per 1M" value={r.cacheReadPerM} min={0} step={0.01} disabled={d || r.cacheSemantics === 'none'} onChange={(v) => edit('cache read price', (x) => void (x.cacheReadPerM = v))} />
            </Field>
            <Field label="Cache write">
              <NumberInput ariaLabel="Cache write price per 1M" value={r.cacheWritePerM} min={0} step={0.01} disabled={d || r.cacheSemantics !== 'read_write'} onChange={(v) => edit('cache write price', (x) => void (x.cacheWritePerM = v))} />
            </Field>
            <Field label="Batch discount">
              <NumberInput ariaLabel="Batch discount" value={r.batchDiscountPct} min={0} max={100} suffix="%" disabled={d} onChange={(v) => edit('batch discount', (x) => void (x.batchDiscountPct = v))} />
            </Field>
            <Field label="Other per-call charges" hint="e.g. grounding or search fees">
              <NumberInput ariaLabel="Other per-call charges" value={r.otherPerCall} min={0} step={0.001} disabled={d} onChange={(v) => edit('per-call charges', (x) => void (x.otherPerCall = v))} />
            </Field>
          </DetailGrid>
          {r.cacheSemantics !== 'none' && r.cacheReadPerM > r.inputPerM && <p className="text-[12.5px] text-warn mt-2">The cache read rate is above the input rate; check the entry.</p>}
        </DetailSection>
      )}

      <DetailSection title="Provenance">
        <div className="grid gap-4 lg:grid-cols-2">
          <Field label="Source or reference" hint="Price page URL, contract reference or quote number">
            <TextArea ariaLabel="Source or reference" rows={2} value={r.source} disabled={d} onChange={(v) => edit('source', (x) => void (x.source = v))} />
            {unverifiedSource && <p className="text-[12.5px] text-warn mt-1">Marked verified but the source is empty or still the sample note. Record where the rate comes from.</p>}
          </Field>
          <Field label="Assumptions">
            <TextArea ariaLabel="Assumptions" rows={2} value={r.assumptions} disabled={d} onChange={(v) => edit('assumptions', (x) => void (x.assumptions = v))} />
          </Field>
        </div>
        <p className="text-[12.5px] text-ink-3 mt-2">
          Id <code className="text-ink-2">{r.id}</code>. {r.sample ? 'Flagged as an illustrative sample rate.' : 'Marked as a verified rate.'}
          {r.source === SAMPLE_SOURCE && ' Source is the shipped sample note.'}
        </p>
      </DetailSection>
    </div>
  );
}
