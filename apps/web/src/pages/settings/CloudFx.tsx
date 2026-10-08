import { Fragment, useMemo, useState } from 'react';
import { Plus, Search, Trash2 } from 'lucide-react';
import { ACU_RESOURCES, ACU_RESOURCE_KEYS, COST_CATEGORIES, POOL_LABELS, convert, uid, type AcuResourceKey, type CloudPriceItem, type CostCategory } from '@aies/engine';
import { Button, Callout, Field, Modal, Panel, ReadOnlyNote, Select, TextArea, TextInput, cx } from '../../components/ui';
import { money, num, unitPrice } from '../../lib/format';
import { useCan, useCatalogUpdater, useStore } from '../../state/store';
import { DateInput, FieldError, IconButton, NumberInput, today } from '../projects/common';
import { DetailGrid, DetailSection, ExpandButton, SampleFlag, needsSource, usageLabel, usePriceUsage } from './shared';

// ───────────────────────────── Cloud & service prices ─────────────────────────────

export function CloudPricesTab() {
  const { state } = useStore();
  const canEdit = useCan('catalog.edit');
  const update = useCatalogUpdater();
  const usage = usePriceUsage();
  const [open, setOpen] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [cat, setCat] = useState<'all' | CostCategory>('all');
  const [confirm, setConfirm] = useState<CloudPriceItem | null>(null);
  const items = state.catalog.cloudPrices;
  const currencies = [...new Set([state.catalog.fx.base, ...Object.keys(state.catalog.fx.rates)])];
  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    return items.filter((i) => (cat === 'all' || i.category === cat) && (!s || `${i.cloud} ${i.service} ${i.componentKey} ${i.id}`.toLowerCase().includes(s)));
  }, [items, q, cat]);

  const edit = (id: string, label: string, mutate: (r: CloudPriceItem) => void) => {
    const it = items.find((x) => x.id === id);
    update(`Edited cloud price: ${label}`, (c) => {
      const t = c.cloudPrices.find((x) => x.id === id);
      if (t) mutate(t);
    }, it ? `${it.cloud} ${it.service}` : id);
  };
  const add = () => {
    const it: CloudPriceItem = { id: uid('price'), cloud: 'AWS', service: 'New service', category: 'INFRASTRUCTURE', componentKey: 'new_component', unitLabel: 'unit', unitCost: 0, currency: state.catalog.fx.base, region: '', effectiveDate: today(), source: '', sample: false };
    update('Added cloud price', (c) => void c.cloudPrices.push(it), it.service);
    setOpen(it.id);
  };

  return (
    <div className="space-y-5">
      <Callout tone="warn" title="Sample prices">
        Shipped cloud and service prices are illustrative. Replace them with your negotiated or published prices, record the source and untick Sample. Cost lines that link to a price item use its current unit cost and currency.
      </Callout>
      <Panel
        title="Cloud and service price table"
        description="Unit prices for orchestration, RAG, document, infrastructure and AgentOps services. The ACU mapping says which consumption resource a billed unit counts towards."
        padded={false}
        actions={
          <Button className="!text-brand-ink" size="sm" variant="primary" icon={<Plus size={14} />} onClick={add} disabled={!canEdit}>
            Add price
          </Button>
        }
      >
        <div className="px-4 pb-3 flex flex-wrap items-center gap-3">
          <ReadOnlyNote show={!canEdit} what="edit prices" />
          <div className="relative w-full sm:w-[260px]">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-3 pointer-events-none" aria-hidden />
            <input className="field !pl-8 text-[13.5px]" placeholder="Search service or component" aria-label="Search prices" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <div className="w-full sm:w-[220px]">
            <Select<'all' | CostCategory> ariaLabel="Filter by category" value={cat} onChange={setCat} options={[{ value: 'all', label: 'All categories' }, ...COST_CATEGORIES.map((c) => ({ value: c, label: POOL_LABELS[c] }))]} />
          </div>
        </div>
        <div className="scroll-x">
          <table className="dtable min-w-[1240px]">
            <thead>
              <tr>
                <th className="w-8 relative">
                  <span className="sr-only">Details</span>
                </th>
                <th>Service</th>
                <th>Category</th>
                <th>Component key</th>
                <th className="r">Unit cost</th>
                <th>Unit</th>
                <th>ACU resource</th>
                <th>Rate status</th>
                <th>Used by</th>
                <th className="r">Delete</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((it) => {
                const isOpen = open === it.id;
                const uses = usage.get(it.id);
                return (
                  <Fragment key={it.id}>
                    <tr className={cx(isOpen && '[&>td]:bg-sunken')}>
                      <td>
                        <ExpandButton open={isOpen} onClick={() => setOpen(isOpen ? null : it.id)} label={it.service} />
                      </td>
                      <td style={{ minWidth: 260 }}>
                        <TextInput ariaLabel="Service" value={it.service} disabled={!canEdit} onChange={(v) => v.trim() && edit(it.id, 'service', (x) => void (x.service = v.trim()))} />
                        <div className="text-[12.5px] text-ink-3 mt-0.5">
                          {it.cloud}
                          {it.region ? `, ${it.region}` : ''}
                        </div>
                      </td>
                      <td style={{ minWidth: 200 }}>
                        <Select ariaLabel="Category" value={it.category} disabled={!canEdit} options={COST_CATEGORIES.map((c) => ({ value: c, label: POOL_LABELS[c] }))} onChange={(v) => edit(it.id, 'category', (x) => void (x.category = v))} />
                      </td>
                      <td className="text-[13px]">
                        <code className="text-ink-2">{it.componentKey}</code>
                      </td>
                      <td className="r" style={{ minWidth: 120 }}>
                        <NumberInput ariaLabel={`Unit cost of ${it.service}`} value={it.unitCost} min={0} step={0.01} disabled={!canEdit} onChange={(v) => edit(it.id, 'unit cost', (x) => void (x.unitCost = v))} />
                        <div className="text-[12px] text-ink-3 mt-0.5">{it.currency}</div>
                      </td>
                      <td className="text-[13px] text-ink-2 whitespace-nowrap">{it.unitLabel}</td>
                      <td className="text-[13px] text-ink-2">{it.acuResourceKey ? ACU_RESOURCES[it.acuResourceKey]?.label : '—'}</td>
                      <td>
                        <SampleFlag sample={it.sample} disabled={!canEdit} label={it.service} onChange={(v) => edit(it.id, v ? 'flagged as sample' : 'marked verified', (x) => void (x.sample = v))} />
                      </td>
                      <td className="text-[13px] text-ink-2 whitespace-nowrap">{usageLabel(uses?.reduce((a, u) => a + u.lines.length, 0) ?? 0, uses?.length ?? 0, 'line')}</td>
                      <td className="r">
                        <IconButton label={`Delete ${it.service}`} tone="bad" disabled={!canEdit} onClick={() => setConfirm(it)}>
                          <Trash2 size={15} />
                        </IconButton>
                      </td>
                    </tr>
                    {isOpen && (
                      <tr>
                        <td colSpan={10} className="!bg-sunken !p-0">
                          <PriceEditor item={it} canEdit={canEdit} currencies={currencies} edit={(label, m) => edit(it.id, label, m)} />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
              {shown.length === 0 && (
                <tr>
                  <td colSpan={10} className="text-center text-ink-3 py-6">
                    No prices match the filters.
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
        title="Delete price item"
        footer={
          <>
            <Button onClick={() => setConfirm(null)}>Cancel</Button>
            <Button className="!text-bad"
              variant="danger"
              icon={<Trash2 size={15} />}
              onClick={() => {
                if (confirm) update('Deleted cloud price', (c) => void (c.cloudPrices = c.cloudPrices.filter((x) => x.id !== confirm.id)), `${confirm.cloud} ${confirm.service}`);
                setConfirm(null);
              }}
            >
              Delete price
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
                  Delete <span className="font-semibold text-ink">{confirm.service}</span> ({confirm.cloud})?
                </p>
                {uses?.length ? (
                  <Callout tone="warn" title="Cost lines link to this price">
                    <ul className="list-disc pl-5 space-y-0.5">
                      {uses.map((u) => (
                        <li key={u.project.id}>
                          <span className="font-semibold">{u.project.name}</span>: {u.lines.join(', ')}
                        </li>
                      ))}
                    </ul>
                    <p className="mt-1.5">Those lines fall back to their own stored unit cost and show a missing-price warning.</p>
                  </Callout>
                ) : (
                  <p>No cost line links to this price.</p>
                )}
              </div>
            );
          })()}
      </Modal>
    </div>
  );
}

function PriceEditor({ item: it, canEdit, currencies, edit }: { item: CloudPriceItem; canEdit: boolean; currencies: string[]; edit: (label: string, m: (r: CloudPriceItem) => void) => void }) {
  const d = !canEdit;
  const res = it.acuResourceKey ? ACU_RESOURCES[it.acuResourceKey] : undefined;
  return (
    <div className="px-5 py-4 space-y-5 border-y border-line">
      <DetailSection title="Price">
        <DetailGrid>
          <Field label="Cloud or vendor">
            <TextInput ariaLabel="Cloud" value={it.cloud} disabled={d} onChange={(v) => edit('cloud', (x) => void (x.cloud = v))} />
          </Field>
          <Field label="Component key" hint="Same key on two cost lines flags double counting">
            <TextInput ariaLabel="Component key" value={it.componentKey} disabled={d} onChange={(v) => v.trim() && edit('component key', (x) => void (x.componentKey = v.trim()))} />
          </Field>
          <Field label="Unit label">
            <TextInput ariaLabel="Unit label" value={it.unitLabel} disabled={d} onChange={(v) => edit('unit label', (x) => void (x.unitLabel = v))} />
          </Field>
          <Field label="Currency">
            <Select ariaLabel="Currency" value={it.currency} disabled={d} options={[...new Set([it.currency, ...currencies])].map((c) => ({ value: c, label: c }))} onChange={(v) => edit('currency', (x) => void (x.currency = v))} />
          </Field>
          <Field label="Region">
            <TextInput ariaLabel="Region" value={it.region} disabled={d} onChange={(v) => edit('region', (x) => void (x.region = v))} />
          </Field>
          <Field label="Effective date">
            <DateInput ariaLabel="Effective date" value={it.effectiveDate} disabled={d} onChange={(v) => edit('effective date', (x) => void (x.effectiveDate = v))} />
          </Field>
        </DetailGrid>
      </DetailSection>
      <DetailSection title="ACU resource mapping" note={res?.derived ? 'This resource is derived from the workflow model; cost lines mapped to it are ignored for ACUs to avoid double counting.' : res ? `${num(1)} ${it.unitLabel} counts as ${it.acuUnitsPerUnit ?? 1} raw units; ACUs use ${res.unit}.` : 'Not counted in weighted-resource ACUs.'}>
        <DetailGrid>
          <Field label="ACU resource">
            <Select<'' | AcuResourceKey>
              ariaLabel="ACU resource"
              value={it.acuResourceKey ?? ''}
              disabled={d}
              options={[{ value: '', label: 'None' }, ...ACU_RESOURCE_KEYS.map((k) => ({ value: k, label: `${ACU_RESOURCES[k].label}${ACU_RESOURCES[k].derived ? ' (derived)' : ''}` }))]}
              onChange={(v) =>
                edit('ACU mapping', (x) => {
                  x.acuResourceKey = v || undefined;
                  if (!v) delete x.acuUnitsPerUnit;
                  else x.acuUnitsPerUnit ??= 1;
                })
              }
            />
          </Field>
          <Field label="Raw units per billed unit" hint="e.g. 1,000 for a price per 1K pages">
            <NumberInput ariaLabel="Raw units per billed unit" value={it.acuUnitsPerUnit ?? 1} min={0} disabled={d || !it.acuResourceKey} onChange={(v) => edit('ACU units per unit', (x) => void (x.acuUnitsPerUnit = v))} />
          </Field>
        </DetailGrid>
      </DetailSection>
      <DetailSection title="Provenance">
        <Field label="Source or reference">
          <TextArea ariaLabel="Source" rows={2} value={it.source} disabled={d} onChange={(v) => edit('source', (x) => void (x.source = v))} />
          {needsSource(it.sample, it.source) && <p className="text-[12.5px] text-warn mt-1">Marked verified but the source is empty or still the sample note.</p>}
        </Field>
        <p className="text-[12.5px] text-ink-3 mt-2">
          Id <code className="text-ink-2">{it.id}</code>, current price {unitPrice(it.unitCost, it.currency)} per {it.unitLabel}.
        </p>
      </DetailSection>
    </div>
  );
}

// ───────────────────────────── FX ─────────────────────────────

export function FxTab() {
  const { state } = useStore();
  const canEdit = useCan('catalog.edit');
  const update = useCatalogUpdater();
  const fx = state.catalog.fx;
  const [code, setCode] = useState('');
  const [rate, setRate] = useState(1);
  const [err, setErr] = useState('');
  const [confirm, setConfirm] = useState<string | null>(null);
  const codes = [...new Set([fx.base, ...Object.keys(fx.rates)])];

  const usedBy = (c: string) => {
    const where: string[] = [];
    for (const p of state.projects) {
      if (p.currency === c) where.push(`${p.name} (reporting currency)`);
      else if (JSON.stringify(p).includes(`"currency":"${c}"`)) where.push(p.name);
    }
    if (state.catalog.modelRates.some((m) => m.currency === c)) where.push('model rate card');
    if (state.catalog.cloudPrices.some((m) => m.currency === c)) where.push('cloud price table');
    return where;
  };

  const add = () => {
    const c = code.trim().toUpperCase();
    if (!/^[A-Z]{3}$/.test(c)) return setErr('Use a three-letter ISO currency code, for example CHF.');
    if (codes.includes(c)) return setErr(`${c} already has a rate.`);
    if (!(rate > 0)) return setErr('The rate must be greater than zero.');
    update('Added FX rate', (cat) => void (cat.fx.rates[c] = rate), `${c} = ${rate} per ${fx.base}`);
    setCode('');
    setRate(1);
    setErr('');
  };

  return (
    <div className="space-y-5">
      <div className="grid gap-5 xl:grid-cols-[1fr_1.3fr]">
        <Panel title="FX table" description="One base currency; every rate is units of that currency per 1 unit of base. Cross rates go through the base so conversions round-trip.">
          <ReadOnlyNote show={!canEdit} what="edit FX rates" />
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Base currency" hint="Changing it does not rescale the rates.">
              <Select ariaLabel="Base currency" value={fx.base} disabled={!canEdit} options={codes.map((c) => ({ value: c, label: c }))} onChange={(v) => update('Changed FX base currency', (c) => {
                c.fx.base = v;
                c.fx.rates[v] = c.fx.rates[v] ?? 1;
              }, v)} />
              {fx.rates[fx.base] !== undefined && fx.rates[fx.base] !== 1 && <p className="text-[12.5px] text-warn mt-1">The base currency should have a rate of 1; it is {fx.rates[fx.base]}.</p>}
            </Field>
            <Field label="As of">
              <DateInput ariaLabel="FX as of" value={fx.asOf} disabled={!canEdit} onChange={(v) => update('Changed FX date', (c) => void (c.fx.asOf = v), v)} />
            </Field>
            <Field label="Source" className="sm:col-span-2">
              <TextArea ariaLabel="FX source" rows={2} value={fx.source} disabled={!canEdit} onChange={(v) => update('Changed FX source', (c) => void (c.fx.source = v), v)} />
            </Field>
          </div>
          <div className="mt-5 pt-4 border-t border-line-soft">
            <h4 className="text-[13.5px] font-semibold text-ink mb-2">Add currency</h4>
            <div className="flex flex-wrap items-start gap-2">
              <input className="field !w-[90px] uppercase" aria-label="Currency code" placeholder="CHF" maxLength={3} value={code} disabled={!canEdit} onChange={(e) => setCode(e.target.value)} />
              <div className="w-[150px]">
                <NumberInput ariaLabel="Rate per base unit" value={rate} min={0} step={0.01} disabled={!canEdit} onChange={setRate} suffix={`/ ${fx.base}`} />
              </div>
              <Button icon={<Plus size={15} />} onClick={add} disabled={!canEdit}>
                Add currency
              </Button>
            </div>
            <FieldError>{err}</FieldError>
          </div>
        </Panel>

        <Panel title="Rates" padded={false}>
          <div className="scroll-x">
            <table className="dtable min-w-[520px]">
              <thead>
                <tr>
                  <th>Currency</th>
                  <th className="r">Per 1 {fx.base}</th>
                  <th className="r">1 unit in INR</th>
                  <th className="r">Remove</th>
                </tr>
              </thead>
              <tbody>
                {codes.map((c) => {
                  let inr = '—';
                  try {
                    inr = codes.includes('INR') ? money(convert(1, c, 'INR', fx), 'INR', 4) : '—';
                  } catch {
                    inr = 'Rate missing';
                  }
                  return (
                    <tr key={c}>
                      <td className="font-semibold">
                        {c}
                        {c === fx.base && <span className="ml-2 text-[12.5px] font-normal text-ink-3">Base</span>}
                      </td>
                      <td className="r" style={{ width: 170 }}>
                        <NumberInput ariaLabel={`${c} per ${fx.base}`} value={fx.rates[c] ?? 1} min={0.000001} step={0.01} disabled={!canEdit || c === fx.base} onChange={(v) => update('Changed FX rate', (cat) => void (cat.fx.rates[c] = v), `${c} = ${v} per ${fx.base}`)} />
                      </td>
                      <td className="r text-[13.5px]">{inr}</td>
                      <td className="r">
                        <IconButton label={`Remove ${c}`} tone="bad" disabled={!canEdit || c === fx.base} onClick={() => setConfirm(c)}>
                          <Trash2 size={15} />
                        </IconButton>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="px-4 py-2.5 text-[12.5px] text-ink-3 border-t border-line-soft">Rates apply to every project at once. Lock a contract's FX assumption by recording it in the project's commercial notes.</p>
        </Panel>
      </div>

      <Modal
        open={!!confirm}
        onClose={() => setConfirm(null)}
        title="Remove currency"
        footer={
          <>
            <Button onClick={() => setConfirm(null)}>Cancel</Button>
            <Button className="!text-bad"
              variant="danger"
              icon={<Trash2 size={15} />}
              disabled={!!confirm && usedBy(confirm).length > 0}
              onClick={() => {
                if (confirm) update('Removed FX rate', (c) => void delete c.fx.rates[confirm], confirm);
                setConfirm(null);
              }}
            >
              Remove currency
            </Button>
          </>
        }
      >
        {confirm &&
          (() => {
            const where = usedBy(confirm);
            return where.length ? (
              <Callout tone="bad" title={`${confirm} is still in use`}>
                Amounts in {confirm} appear in: {where.join(', ')}. Change those amounts to another currency first; removing the rate would stop those projects computing.
              </Callout>
            ) : (
              <p className="text-sm text-ink-2">Remove the {confirm} rate? No project, rate card or price uses it.</p>
            );
          })()}
      </Modal>
    </div>
  );
}
