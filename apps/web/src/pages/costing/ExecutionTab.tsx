import { useMemo, useState, type ReactNode } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { ACU_RESOURCE_KEYS, ACU_RESOURCES, COST_CATEGORIES, POOL_LABELS, safeDiv, sum, uid, type CloudPriceItem, type CostBasis, type CostCategory, type CostLine, type WorkflowAllocation } from '@aies/engine';
import { Badge, Button, Callout, IssueList, Modal, Panel, ReadOnlyNote, Select, StatStrip, TextInput, Toggle, cx } from '../../components/ui';
import { compact, money, n, pct, unitPrice } from '../../lib/format';
import { href } from '../../lib/router';
import { currencyOptions, fmtUnits, IconButton, issuesWith, TextLink, TIGHT, type EditorProps, Num } from './common';

export const BASIS_LABEL: Record<CostBasis, string> = {
  fixed_monthly: 'Fixed monthly',
  per_execution: 'Per execution',
  per_attempted: 'Per attempted transaction',
  per_accepted: 'Per accepted transaction',
  per_llm_call: 'Per LLM call',
  allocated_shared: 'Allocated shared platform',
};

const QTY_HINT: Record<CostBasis, string> = {
  fixed_monthly: 'units / month',
  per_execution: 'units / exec',
  per_attempted: 'units / attempted',
  per_accepted: 'units / accepted',
  per_llm_call: 'units / call',
  allocated_shared: '',
};

export const ALLOCATION_LABEL: Record<WorkflowAllocation, string> = {
  by_attempted: 'By attempted transactions',
  by_executions: 'By executions',
  by_llm_cost: 'By LLM cost',
  equal: 'Equal split',
};

const ISSUE_CODES = ['DUPLICATE_COMPONENT', 'LLM_IN_COST_LINE', 'GPU_DOUBLE_COUNT', 'REVIEW_DOUBLE_COUNT', 'DERIVED_RESOURCE', 'ALLOCATION_PCT', 'NEGATIVE_COST', 'UNKNOWN_WORKFLOW', 'MODEL'];

const isFixed = (b: CostBasis) => b === 'fixed_monthly' || b === 'allocated_shared';

export function ExecutionTab({ project, result, update, canEdit }: EditorProps) {
  const cur = result.currency;
  const ro = !canEdit;
  const b = result.baseline;
  const catalog = result.context.catalog;
  const [adding, setAdding] = useState<CostCategory | null>(null);
  const lineRes = useMemo(() => new Map(b.costLines.map((c) => [c.lineId, c])), [b]);
  const total = sum(b.costLines.map((c) => c.monthlyCost));
  const fixed = sum(b.costLines.filter((c) => !c.variable).map((c) => c.monthlyCost));
  const usage = total.minus(fixed);
  const waste = sum(b.costLines.map((c) => c.failureCost));
  const issues = issuesWith(result, ISSUE_CODES).filter((i) => i.code !== 'MODEL' || (i.message.startsWith('Cost line') && !i.message.includes('derived ACU resource')));
  const withLines = COST_CATEGORIES.filter((c) => project.costLines.some((l) => l.category === c));
  const empty = COST_CATEGORIES.filter((c) => !withLines.includes(c));

  const addLine = (category: CostCategory, item?: CloudPriceItem) => {
    const fixedUnit = item ? /month|run|GB$/i.test(item.unitLabel) : true;
    const scale = item?.unitLabel.startsWith('1M') ? 1 / 1_000_000 : item?.unitLabel.startsWith('1K') ? 1 / 1000 : 1;
    const line: CostLine = {
      id: uid('cl'),
      category: item?.category ?? category,
      name: item?.service ?? 'New cost line',
      componentKey: item?.componentKey ?? '',
      basis: fixedUnit ? 'fixed_monthly' : 'per_execution',
      unitCost: item?.unitCost ?? 0,
      currency: item?.currency ?? project.currency,
      unitLabel: item?.unitLabel ?? 'unit',
      quantity: fixedUnit ? 1 : scale,
      workflowId: null,
      workflowAllocation: 'by_attempted',
      scalesWithComplexity: false,
      acuResourceKey: null,
      priceRef: item?.id ?? null,
    };
    update(item ? `Added cost line from price table` : 'Added cost line', (d) => void d.costLines.push(line), line.name);
    setAdding(null);
  };

  return (
    <div className="space-y-5">
      <StatStrip
        items={[
          { label: 'Execution cost per month', value: compact(total, cur), sub: `${pct(safeDiv(total, b.totalRunCost).times(100), 0)} of run cost, excluding LLM and human review` },
          { label: 'Fixed capacity', value: compact(fixed, cur), sub: 'Fixed monthly and shared allocations' },
          { label: 'Usage based', value: compact(usage, cur), sub: 'Scales with executions, transactions or calls' },
          { label: 'Per accepted transaction', value: unitPrice(safeDiv(total, b.totals.accepted), cur), sub: `${fmtUnits(b.totals.accepted)} accepted / month` },
          { label: 'Spent on failed or retried work', value: compact(waste, cur), sub: 'Usage cost not ending in an accepted outcome', tone: n(waste) > 0 ? 'warn' : 'neutral' },
        ]}
      />

      <div className="grid gap-5 xl:grid-cols-[1.4fr_1fr]">
        <Panel title="How lines are costed and allocated">
          <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-2 text-[13.5px] leading-snug">
            <Def term="Fixed monthly">Quantity × unit cost each month, regardless of volume.</Def>
            <Def term="Per execution, attempted, accepted or LLM call">Quantity per driver event × events per month × unit cost. Retries count as executions, not new transactions.</Def>
            <Def term="Allocated shared platform">A shared platform’s monthly total × the share allocated to this project.</Def>
            <Def term="Workflow allocation">Fixed and shared lines that apply to all workflows are split by attempted transactions, executions, LLM cost or equally.</Def>
          </dl>
          <p className="text-[12.5px] text-ink-3 mt-3">
            LLM tokens are costed in the tokenomics model and human review from workflow review minutes. Do not add them here. Unit prices come from the cloud price table in{' '}
            <TextLink href={href('settings')}>Settings</TextLink> unless a line uses a custom cost.
          </p>
        </Panel>
        <Panel title="Double-count checks" description="Components costed twice, LLM spend entered as a cost line, GPU or review costs counted twice.">
          <IssueList issues={issues} empty="No double counting detected." />
        </Panel>
      </div>

      <ReadOnlyNote show={ro} what="edit execution cost lines" />

      {withLines.map((cat) => (
        <CategoryPanel
          key={cat}
          category={cat}
          lines={project.costLines.filter((l) => l.category === cat)}
          lineRes={lineRes}
          poolCost={b.pools[cat]}
          onAdd={() => setAdding(cat)}
          {...{ project, result, update, canEdit }}
        />
      ))}

      {empty.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 text-[13.5px] text-ink-3">
          <span>No lines yet in</span>
          {empty.map((c) => (
            <Button key={c} size="sm" icon={<Plus size={13} />} disabled={ro} onClick={() => setAdding(c)}>
              {POOL_LABELS[c]}
            </Button>
          ))}
        </div>
      )}

      <AddLineModal category={adding} prices={catalog.cloudPrices} currency={cur} onClose={() => setAdding(null)} onAdd={addLine} />
    </div>
  );
}

function Def({ term, children }: { term: string; children: string }) {
  return (
    <div>
      <dt className="font-semibold text-ink">{term}</dt>
      <dd className="text-ink-2">{children}</dd>
    </div>
  );
}

function CategoryPanel({
  category,
  lines,
  lineRes,
  poolCost,
  onAdd,
  project,
  result,
  update,
  canEdit,
}: EditorProps & { category: CostCategory; lines: CostLine[]; lineRes: Map<string, (typeof result.baseline.costLines)[number]>; poolCost: (typeof result.baseline.pools)[CostCategory]; onAdd: () => void }) {
  const cur = result.currency;
  const ro = !canEdit;
  const catalog = result.context.catalog;
  const curOpts = currencyOptions(catalog);
  const prices = new Map(catalog.cloudPrices.map((p) => [p.id, p]));
  const set = (id: string, what: string, fn: (l: CostLine) => void) =>
    update(what, (d) => {
      const l = d.costLines.find((x) => x.id === id);
      if (l) fn(l);
    });
  const keyCount = new Map<string, number>();
  for (const x of project.costLines) {
    const k = x.componentKey.trim().toLowerCase();
    if (k) keyCount.set(k, (keyCount.get(k) ?? 0) + 1);
  }
  const wfOptions = [{ value: '', label: 'All workflows (shared)' }, ...project.workflows.map((w) => ({ value: w.id, label: w.name }))];
  const catOptions = COST_CATEGORIES.map((c) => ({ value: c, label: POOL_LABELS[c] }));

  return (
    <Panel
      title={POOL_LABELS[category]}
      description={`${compact(poolCost, cur)} per month across ${lines.length} ${lines.length === 1 ? 'line' : 'lines'}.`}
      padded={false}
      actions={
        <Button size="sm" icon={<Plus size={14} />} disabled={ro} onClick={onAdd}>
          Add line
        </Button>
      }
    >
      <div className="scroll-x">
        <table className={cx('dtable min-w-[1080px]', TIGHT)}>
          <thead>
            <tr>
              <th>Line and component</th>
              <th>Basis</th>
              <th>Price source</th>
              <th className="r">Unit cost</th>
              <th className="r">Quantity</th>
              <th className="r">Units / month</th>
              <th className="r">Cost / month</th>
              <th aria-label="Actions" />
            </tr>
          </thead>
          {lines.map((l, idx) => {
            const res = lineRes.get(l.id);
            const item = l.priceRef ? prices.get(l.priceRef) : undefined;
            const shared = l.basis === 'allocated_shared';
            const fixed = isFixed(l.basis);
            const effectiveKey = l.acuResourceKey ?? item?.acuResourceKey ?? null;
            const derived = effectiveKey ? ACU_RESOURCES[effectiveKey]?.derived : false;
            return (
              <tbody key={l.id} className={cx(idx > 0 && 'border-t-2 border-line')}>
                <tr className="align-top">
                  <td className="min-w-[210px] space-y-1">
                    <TextInput value={l.name} disabled={ro} ariaLabel="Line name" onChange={(v) => set(l.id, 'Renamed cost line', (x) => (x.name = v))} />
                    <TextInput
                      value={l.componentKey}
                      placeholder="component key"
                      disabled={ro}
                      ariaLabel={`${l.name} component key`}
                      className="!text-[12.5px] font-mono"
                      onChange={(v) => set(l.id, 'Changed component key', (x) => (x.componentKey = v.trim()))}
                    />
                  </td>
                  <td className="min-w-[170px]">
                    <Select<CostBasis>
                      value={l.basis}
                      disabled={ro}
                      ariaLabel={`${l.name} basis`}
                      options={(Object.keys(BASIS_LABEL) as CostBasis[]).map((k) => ({ value: k, label: BASIS_LABEL[k] }))}
                      onChange={(v) =>
                        set(l.id, 'Changed cost basis', (x) => {
                          x.basis = v;
                          if (v === 'allocated_shared') {
                            x.sharedTotalMonthly ??= 0;
                            x.allocationPct ??= 100;
                          }
                        })
                      }
                    />
                  </td>
                  <td className="min-w-[200px]">
                    {shared ? (
                      <span className="text-[13px] text-ink-3">Shared platform total below</span>
                    ) : (
                      <>
                        <select
                          className="field !text-[13px]"
                          aria-label={`${l.name} price source`}
                          disabled={ro}
                          value={item ? item.id : ''}
                          onChange={(e) => {
                            const p = prices.get(e.target.value);
                            set(l.id, p ? 'Linked cost line to price table' : 'Switched cost line to custom unit cost', (x) => {
                              if (p) {
                                x.priceRef = p.id;
                                x.unitLabel = p.unitLabel;
                                x.unitCost = p.unitCost;
                                x.currency = p.currency;
                                if (!x.componentKey) x.componentKey = p.componentKey;
                              } else {
                                if (item) {
                                  x.unitCost = item.unitCost;
                                  x.currency = item.currency;
                                }
                                x.priceRef = null;
                              }
                            });
                          }}
                        >
                          <option value="">Custom unit cost</option>
                          {COST_CATEGORIES.map((c) => {
                            const items = catalog.cloudPrices.filter((p) => p.category === c);
                            if (!items.length) return null;
                            return (
                              <optgroup key={c} label={POOL_LABELS[c]}>
                                {items.map((p) => (
                                  <option key={p.id} value={p.id}>
                                    {p.service} ({p.cloud})
                                  </option>
                                ))}
                              </optgroup>
                            );
                          })}
                        </select>
                        {l.priceRef && !item && <div className="text-[12px] text-bad mt-1">Linked price item no longer exists. Choose another or use a custom cost.</div>}
                      </>
                    )}
                  </td>
                  <td className="r min-w-[140px]">
                    {shared ? (
                      <span className="text-ink-3">—</span>
                    ) : item ? (
                      <div>
                        <div className="num whitespace-nowrap">{unitPrice(item.unitCost, item.currency)}</div>
                        <div className="text-[12px] text-ink-3 whitespace-nowrap">
                          per {item.unitLabel}
                          {item.sample && ', sample rate'}
                        </div>
                      </div>
                    ) : (
                      <div className="flex items-center justify-end gap-1">
                        <Num width={96} value={l.unitCost} min={0} disabled={ro} ariaLabel={`${l.name} unit cost`} onChange={(v) => set(l.id, 'Changed unit cost', (x) => (x.unitCost = v))} />
                        <Select
                          className="!w-[78px]"
                          value={l.currency}
                          options={curOpts}
                          disabled={ro}
                          ariaLabel={`${l.name} currency`}
                          onChange={(v) => set(l.id, 'Changed cost line currency', (x) => (x.currency = v))}
                        />
                      </div>
                    )}
                    {!shared && item && item.currency !== cur && res && (
                      <div className="text-[12px] text-ink-3 whitespace-nowrap">
                        {unitPrice(res.unitCost, cur)} in {cur}
                      </div>
                    )}
                  </td>
                  <td className="r min-w-[170px]">
                    {shared ? (
                      <span className="text-ink-3">—</span>
                    ) : (
                      <div className="space-y-1">
                        <div className="flex justify-end">
                          <Num width={104} value={l.quantity} min={0} disabled={ro} ariaLabel={`${l.name} quantity`} onChange={(v) => set(l.id, 'Changed cost line quantity', (x) => (x.quantity = v))} />
                        </div>
                        <div className="flex items-center justify-end gap-1 text-[12px] text-ink-3">
                          {item ? (
                            <span className="whitespace-nowrap">{item.unitLabel}</span>
                          ) : (
                            <TextInput
                              value={l.unitLabel}
                              disabled={ro}
                              ariaLabel={`${l.name} unit label`}
                              className="!w-[96px] !text-[12px] !py-[2px]"
                              onChange={(v) => set(l.id, 'Changed unit label', (x) => (x.unitLabel = v))}
                            />
                          )}
                          <span className="whitespace-nowrap">{QTY_HINT[l.basis].replace('units ', '')}</span>
                        </div>
                      </div>
                    )}
                  </td>
                  <td className="r pt-2.5">
                    {res ? (shared ? pct(n(res.units) * 100, 0) : fmtUnits(res.units)) : '—'}
                    {!shared && <div className="text-[12px] text-ink-3">{item?.unitLabel ?? l.unitLabel}</div>}
                  </td>
                  <td className="r pt-2.5 font-semibold">{money(res?.monthlyCost ?? 0, cur, 0)}</td>
                  <td className="r">
                    <IconButton label={`Delete ${l.name}`} tone="bad" disabled={ro} onClick={() => update('Deleted cost line', (d) => void (d.costLines = d.costLines.filter((x) => x.id !== l.id)), l.name)}>
                      <Trash2 size={15} />
                    </IconButton>
                  </td>
                </tr>
                <tr className="[&>td]:!bg-sunken">
                  <td colSpan={8} className="!pt-1.5 !pb-2.5">
                    <div className="flex flex-wrap items-end gap-x-4 gap-y-2 text-[12.5px]">
                      {shared && (
                        <>
                          <Mini label="Shared platform total / month">
                            <div className="flex items-center gap-1">
                              <Num
                                width={120}
                                value={l.sharedTotalMonthly ?? 0}
                                min={0}
                                disabled={ro}
                                ariaLabel={`${l.name} shared total per month`}
                                onChange={(v) => set(l.id, 'Changed shared platform total', (x) => (x.sharedTotalMonthly = v))}
                              />
                              <Select
                                className="!w-[78px]"
                                value={l.currency}
                                options={curOpts}
                                disabled={ro}
                                ariaLabel={`${l.name} currency`}
                                onChange={(v) => set(l.id, 'Changed cost line currency', (x) => (x.currency = v))}
                              />
                            </div>
                          </Mini>
                          <Mini label="Allocated to this project">
                            <Num
                              width={90}
                              value={l.allocationPct ?? 0}
                              min={0}
                              max={100}
                              suffix="%"
                              disabled={ro}
                              ariaLabel={`${l.name} allocation share`}
                              onChange={(v) => set(l.id, 'Changed shared allocation', (x) => (x.allocationPct = v))}
                            />
                          </Mini>
                        </>
                      )}
                      <Mini label="Workflow scope">
                        <Select
                          className="!w-[220px] !text-[13px]"
                          value={l.workflowId ?? ''}
                          options={wfOptions}
                          disabled={ro}
                          ariaLabel={`${l.name} workflow scope`}
                          onChange={(v) => set(l.id, 'Changed cost line workflow scope', (x) => (x.workflowId = v || null))}
                        />
                      </Mini>
                      {fixed && !l.workflowId && (
                        <Mini label="Split across workflows">
                          <Select<WorkflowAllocation>
                            className="!w-[200px] !text-[13px]"
                            value={l.workflowAllocation}
                            options={(Object.keys(ALLOCATION_LABEL) as WorkflowAllocation[]).map((k) => ({ value: k, label: ALLOCATION_LABEL[k] }))}
                            disabled={ro}
                            ariaLabel={`${l.name} allocation method`}
                            onChange={(v) => set(l.id, 'Changed workflow allocation', (x) => (x.workflowAllocation = v))}
                          />
                        </Mini>
                      )}
                      {!fixed && (
                        <div className="pb-1.5">
                          <Toggle checked={l.scalesWithComplexity} disabled={ro} label="Scales with complexity mix" onChange={(v) => set(l.id, 'Changed complexity scaling', (x) => (x.scalesWithComplexity = v))} />
                        </div>
                      )}
                      <Mini label="ACU resource">
                        <select
                          className="field !w-[240px] !text-[13px]"
                          aria-label={`${l.name} ACU resource`}
                          disabled={ro}
                          value={l.acuResourceKey ?? ''}
                          onChange={(e) => set(l.id, 'Changed ACU resource mapping', (x) => (x.acuResourceKey = (e.target.value || null) as CostLine['acuResourceKey']))}
                        >
                          <option value="">{item?.acuResourceKey ? `As price item: ${ACU_RESOURCES[item.acuResourceKey].label}` : 'Not metered as an ACU resource'}</option>
                          {ACU_RESOURCE_KEYS.map((k) => (
                            <option key={k} value={k}>
                              {ACU_RESOURCES[k].label}
                              {ACU_RESOURCES[k].derived ? ' (derived, ignored)' : ''}
                            </option>
                          ))}
                        </select>
                      </Mini>
                      {effectiveKey && !derived && (
                        <Mini label={`Raw ${ACU_RESOURCES[effectiveKey].unit.replace(/^1[KM] /, '')} per billed unit`}>
                          <Num
                            width={110}
                            value={l.acuUnitsPerUnit ?? item?.acuUnitsPerUnit ?? 1}
                            min={0}
                            disabled={ro}
                            ariaLabel={`${l.name} ACU units per billed unit`}
                            onChange={(v) => set(l.id, 'Changed ACU units per billed unit', (x) => (x.acuUnitsPerUnit = v))}
                          />
                        </Mini>
                      )}
                      {derived && <Badge tone="warn">Derived from the workflow model, mapping ignored</Badge>}
                      {(keyCount.get(l.componentKey.trim().toLowerCase()) ?? 0) > 1 && <Badge tone="warn">Component “{l.componentKey}” is costed on more than one line</Badge>}
                      <Mini label="Category">
                        <Select<CostCategory>
                          className="!w-[190px] !text-[13px]"
                          value={l.category}
                          options={catOptions}
                          disabled={ro}
                          ariaLabel={`${l.name} category`}
                          onChange={(v) => set(l.id, 'Moved cost line to another category', (x) => (x.category = v))}
                        />
                      </Mini>
                    </div>
                  </td>
                </tr>
              </tbody>
            );
          })}
        </table>
      </div>
    </Panel>
  );
}

function Mini({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="block text-[12px] font-semibold text-ink-3 mb-0.5">{label}</span>
      {children}
    </label>
  );
}

function AddLineModal({
  category,
  prices,
  currency,
  onClose,
  onAdd,
}: {
  category: CostCategory | null;
  prices: CloudPriceItem[];
  currency: string;
  onClose: () => void;
  onAdd: (c: CostCategory, item?: CloudPriceItem) => void;
}) {
  const [filter, setFilter] = useState<CostCategory | 'all' | null>(null);
  const cat = category ?? 'OTHER';
  const active = filter ?? category ?? 'all';
  const shown = prices.filter((p) => active === 'all' || p.category === active);
  const close = () => {
    setFilter(null);
    onClose();
  };
  return (
    <Modal
      open={category !== null}
      onClose={close}
      title={`Add a cost line to ${POOL_LABELS[cat].toLowerCase()}`}
      wide
      footer={
        <>
          <Button variant="ghost" onClick={close}>
            Cancel
          </Button>
          <Button
            variant="primary"
            className="!text-brand-ink"
            icon={<Plus size={14} />}
            onClick={() => {
              setFilter(null);
              onAdd(cat);
            }}
          >
            Add blank line
          </Button>
        </>
      }
    >
      <p className="text-[13.5px] text-ink-2 mb-3">
        Pick a priced component to link the line to the cloud price table, or add a blank line with a custom unit cost. New lines start at one unit per execution or per month; adjust the quantity afterwards.
      </p>
      <div className="mb-3 max-w-[260px]">
        <Select<CostCategory | 'all'>
          ariaLabel="Filter price table by category"
          value={active}
          onChange={setFilter}
          options={[{ value: 'all', label: 'All categories' }, ...COST_CATEGORIES.map((c) => ({ value: c, label: POOL_LABELS[c] }))]}
        />
      </div>
      {shown.length === 0 ? (
        <Callout>No priced components in this category. Add a blank line, or add prices in Settings.</Callout>
      ) : (
        <div className="scroll-x border border-line rounded-lg">
          <table className="dtable min-w-[560px]">
            <thead>
              <tr>
                <th>Component</th>
                <th>Category</th>
                <th className="r">Unit cost</th>
                <th aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {shown.map((p) => (
                <tr key={p.id}>
                  <td>
                    <div className="font-semibold">{p.service}</div>
                    <div className="text-[12.5px] text-ink-3">
                      {p.cloud}, {p.region}
                      {p.sample && ', sample rate'}
                    </div>
                  </td>
                  <td className="text-[13px] text-ink-2">{POOL_LABELS[p.category]}</td>
                  <td className="r whitespace-nowrap">
                    {unitPrice(p.unitCost, p.currency)} <span className="text-ink-3 text-[12.5px]">/ {p.unitLabel}</span>
                  </td>
                  <td className="r">
                    <Button
                      size="sm"
                      onClick={() => {
                        setFilter(null);
                        onAdd(p.category, p);
                      }}
                      aria-label={`Add ${p.service}`}
                    >
                      Add
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-[12px] text-ink-3 mt-2">Amounts are shown in each item’s own currency and converted to {currency} in the model.</p>
    </Modal>
  );
}
