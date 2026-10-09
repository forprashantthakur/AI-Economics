import { useMemo } from 'react';
import { Plus, Trash2, X } from 'lucide-react';
import { uid, type Activity } from '@aies/engine';
import { BarList, ChartFrame } from '../../components/charts';
import { Badge, Button, Checkbox, Field, IssueList, KeyValues, Panel, ReadOnlyNote, Segmented, Select, StatStrip, TextInput, cx } from '../../components/ui';
import { compact, count, money, n, pct } from '../../lib/format';
import { currencyOptions, IconButton, issuesWith, Swatch, TIGHT, type EditorProps, Num } from './common';
import { useStore } from '../../state/store';

const weeksLabel = (s: number, e: number) => (e <= s ? `Week ${s + 1}` : `Weeks ${s + 1}–${e}`);

export function ImplementationTab({ project, result, update, canEdit }: EditorProps) {
  const { state } = useStore();
  const plan = project.implementation;
  const impl = result.implementation;
  const cur = result.currency;
  const f = (v: number) => compact(v, cur);
  const ro = !canEdit;
  const curOpts = currencyOptions(state.catalog);
  const actRes = useMemo(() => new Map(impl.activities.map((a) => [a.id, a])), [impl]);
  const roleUse = useMemo(() => {
    const m = new Map<string, number>();
    for (const a of plan.activities) m.set(a.roleId, (m.get(a.roleId) ?? 0) + 1);
    return m;
  }, [plan.activities]);
  const issues = issuesWith(result, ['SCHEDULE', 'UNKNOWN_ROLE', 'MARGIN_RANGE']).filter((i) => i.code !== 'MARGIN_RANGE' || i.message.startsWith('Implementation'));
  const isTm = plan.pricingMethod === 'time_and_materials';
  const listPrice = isTm ? impl.tmValue : impl.cpmPrice;

  const setAct = (id: string, what: string, fn: (a: Activity) => void) =>
    update(what, (d) => {
      const a = d.implementation.activities.find((x) => x.id === id);
      if (a) fn(a);
    });

  return (
    <div className="space-y-5">
      <StatStrip
        items={[
          { label: 'Labour hours', value: count(impl.laborHours, cur), sub: `${plan.activities.length} activities` },
          { label: 'Labour cost', value: compact(impl.laborCost, cur), sub: 'Effort × internal cost rate' },
          { label: 'Direct expenses', value: compact(impl.directExpenses, cur), sub: `${compact(impl.billableExpenses, cur)} billable` },
          { label: 'Contingency', value: compact(impl.contingency, cur), sub: `${pct(plan.contingencyPct, 0)} of labour and expenses` },
          { label: 'Total delivery cost', value: compact(impl.totalCost, cur), sub: 'Internal, not billed as such' },
          { label: 'Client price', value: compact(impl.price, cur), sub: isTm ? 'Time and materials' : 'Cost plus margin', tone: 'good' },
          { label: 'Margin', value: pct(impl.marginPct), sub: `${compact(impl.grossProfit, cur)} gross profit`, tone: n(impl.marginPct) < 0 ? 'bad' : n(impl.marginPct) < 15 ? 'warn' : 'neutral' },
          { label: 'Time and materials value', value: compact(impl.tmValue, cur), sub: 'Hours × bill rate + billable expenses' },
          { label: 'Duration', value: `${impl.durationWeeks} weeks`, sub: 'Critical path' },
        ]}
      />

      <div className="grid gap-5 xl:grid-cols-[1.2fr_1fr]">
        <Panel title="Internal delivery cost" description="What delivering the work costs the provider. Never shown to the client.">
          <KeyValues
            rows={[
              ['Labour cost', money(impl.laborCost, cur)],
              ['Direct expenses', money(impl.directExpenses, cur)],
              [`Contingency (${pct(plan.contingencyPct, 0)})`, money(impl.contingency, cur)],
              [<span className="font-semibold text-ink">Total delivery cost</span>, <span className="font-semibold">{money(impl.totalCost, cur)}</span>],
            ]}
          />
        </Panel>
        <Panel
          title="Client billing price"
          description={isTm ? 'Billed at role bill rates plus billable expenses, less discount.' : `Delivery cost grossed up to a ${pct(plan.targetMarginPct, 0)} margin, less discount.`}
        >
          <KeyValues
            rows={[
              [isTm ? 'Time and materials value' : `Cost plus ${pct(plan.targetMarginPct, 0)} margin`, money(listPrice, cur)],
              [`Discount (${pct(plan.discountPct, 0)})`, plan.discountPct ? `−${money(listPrice.minus(impl.price), cur)}` : money(0, cur, 0)],
              [<span className="font-semibold text-ink">Client price</span>, <span className="font-semibold">{money(impl.price, cur)}</span>],
              ['Gross margin on delivery cost', <span className={cx(n(impl.marginPct) < 0 && 'text-bad')}>{pct(impl.marginPct)}</span>],
            ]}
          />
        </Panel>
      </div>

      <Panel title="Pricing settings" description="Contingency covers estimation risk. The pricing method decides which figure becomes the implementation fee in commercial pricing.">
        <ReadOnlyNote show={ro} what="edit the implementation plan" />
        <div className="grid gap-4 grid-cols-2 lg:grid-cols-6">
          <Field label="Contingency">
            <Num
              value={plan.contingencyPct}
              suffix="%"
              min={0}
              max={100}
              disabled={ro}
              ariaLabel="Contingency"
              onChange={(v) => update('Changed implementation contingency', (d) => void (d.implementation.contingencyPct = v))}
            />
          </Field>
          <Field label="Target margin">
            <Num
              value={plan.targetMarginPct}
              suffix="%"
              min={0}
              max={95}
              disabled={ro}
              ariaLabel="Target margin"
              onChange={(v) => update('Changed implementation target margin', (d) => void (d.implementation.targetMarginPct = v))}
            />
          </Field>
          <Field label="Discount">
            <Num value={plan.discountPct} suffix="%" min={0} max={100} disabled={ro} ariaLabel="Discount" onChange={(v) => update('Changed implementation discount', (d) => void (d.implementation.discountPct = v))} />
          </Field>
          <Field label="Hours per day" hint="Converts effort entered in days.">
            <Num value={plan.hoursPerDay} min={1} max={24} disabled={ro} ariaLabel="Hours per day" onChange={(v) => update('Changed hours per day', (d) => void (d.implementation.hoursPerDay = v))} />
          </Field>
          <Field label="Pricing method" className="col-span-2">
            <div className={cx(ro && 'pointer-events-none opacity-60')} inert={ro || undefined}>
              <Segmented
                ariaLabel="Pricing method"
                value={plan.pricingMethod}
                onChange={(v) => update('Changed implementation pricing method', (d) => void (d.implementation.pricingMethod = v))}
                options={[
                  { id: 'cost_plus_margin', label: 'Cost plus margin' },
                  { id: 'time_and_materials', label: 'Time and materials' },
                ]}
              />
            </div>
          </Field>
        </div>
      </Panel>

      <Panel
        title="Roles and rates"
        description="Internal cost rate drives delivery cost; bill rate drives the time-and-materials value. Rates are per hour."
        padded={false}
        actions={
          <Button
            size="sm"
            icon={<Plus size={14} />}
            disabled={ro}
            onClick={() => update('Added role', (d) => void d.implementation.roles.push({ id: uid('role'), name: 'New role', costRate: 2000, billRate: 4000, currency: project.currency }))}
          >
            Add role
          </Button>
        }
      >
        <div className="px-4">
          <ReadOnlyNote show={ro} what="edit roles and rates" />
        </div>
        <div className="scroll-x">
          <table className="dtable min-w-[720px]">
            <thead>
              <tr>
                <th>Role</th>
                <th className="r">Cost rate / h</th>
                <th className="r">Bill rate / h</th>
                <th>Currency</th>
                <th className="r">Hours</th>
                <th className="r">Labour cost</th>
                <th aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {plan.roles.map((r) => {
                const used = roleUse.get(r.id) ?? 0;
                return (
                  <tr key={r.id}>
                    <td className="min-w-[220px]">
                      <TextInput value={r.name} disabled={ro} ariaLabel="Role name" onChange={(v) => update('Renamed role', (d) => void (d.implementation.roles.find((x) => x.id === r.id)!.name = v))} />
                    </td>
                    <td className="r">
                      <Num
                        width={110}
                        value={r.costRate}
                        min={0}
                        disabled={ro}
                        ariaLabel={`${r.name} cost rate`}
                        onChange={(v) => update('Changed role cost rate', (d) => void (d.implementation.roles.find((x) => x.id === r.id)!.costRate = v))}
                      />
                    </td>
                    <td className="r">
                      <Num
                        width={110}
                        value={r.billRate}
                        min={0}
                        disabled={ro}
                        ariaLabel={`${r.name} bill rate`}
                        onChange={(v) => update('Changed role bill rate', (d) => void (d.implementation.roles.find((x) => x.id === r.id)!.billRate = v))}
                      />
                    </td>
                    <td>
                      <Select
                        className="!w-[88px]"
                        value={r.currency}
                        options={curOpts}
                        disabled={ro}
                        ariaLabel={`${r.name} currency`}
                        onChange={(v) => update('Changed role currency', (d) => void (d.implementation.roles.find((x) => x.id === r.id)!.currency = v))}
                      />
                    </td>
                    <td className="r">{count(impl.hoursByRole[r.name] ?? 0, cur)}</td>
                    <td className="r">{money(impl.costByRole[r.name] ?? 0, cur)}</td>
                    <td className="r">
                      <IconButton
                        label={used ? `Used by ${used} ${used === 1 ? 'activity' : 'activities'} — reassign them before removing` : `Remove ${r.name}`}
                        tone="bad"
                        disabled={ro || used > 0}
                        onClick={() => update('Removed role', (d) => void (d.implementation.roles = d.implementation.roles.filter((x) => x.id !== r.id)), r.name)}
                      >
                        <Trash2 size={15} />
                      </IconButton>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Panel>

      <Panel
        title="Activities"
        description="Effort, duration and dependencies. Start and end weeks come from an earliest-start schedule; activities on the critical path set the overall duration."
        padded={false}
        actions={
          <Button
            size="sm"
            icon={<Plus size={14} />}
            disabled={ro || plan.roles.length === 0}
            onClick={() =>
              update(
                'Added activity',
                (d) =>
                  void d.implementation.activities.push({
                    id: uid('act'),
                    phase: d.implementation.activities[d.implementation.activities.length - 1]?.phase ?? 'Delivery',
                    name: 'New activity',
                    roleId: d.implementation.roles[0]?.id ?? '',
                    effort: 40,
                    effortUnit: 'hours',
                    durationWeeks: 1,
                    dependsOn: [],
                  }),
              )
            }
          >
            Add activity
          </Button>
        }
      >
        <div className="px-4">
          <ReadOnlyNote show={ro} what="edit activities" />
        </div>
        <div className="scroll-x">
          <table className={cx('dtable min-w-[1120px]', TIGHT)}>
            <thead>
              <tr>
                <th>Phase and activity</th>
                <th>Role</th>
                <th className="r">Effort</th>
                <th className="r">Duration</th>
                <th>Depends on</th>
                <th className="r">Hours and internal cost</th>
                <th className="r">Bill value</th>
                <th>Schedule</th>
                <th aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {plan.activities.map((a) => {
                const res = actRes.get(a.id);
                const others = plan.activities.filter((x) => x.id !== a.id && !a.dependsOn.includes(x.id));
                return (
                  <tr key={a.id} className="align-top">
                    <td className="min-w-[220px] space-y-1">
                      <TextInput value={a.phase} disabled={ro} ariaLabel="Phase" className="!text-[12.5px] !text-ink-3" onChange={(v) => setAct(a.id, 'Changed activity phase', (x) => (x.phase = v))} />
                      <TextInput value={a.name} disabled={ro} ariaLabel="Activity name" onChange={(v) => setAct(a.id, 'Renamed activity', (x) => (x.name = v))} />
                    </td>
                    <td className="min-w-[170px]">
                      <Select
                        value={plan.roles.some((r) => r.id === a.roleId) ? a.roleId : ''}
                        disabled={ro}
                        ariaLabel={`${a.name} role`}
                        options={[...(plan.roles.some((r) => r.id === a.roleId) ? [] : [{ value: '', label: 'Choose a role' }]), ...plan.roles.map((r) => ({ value: r.id, label: r.name }))]}
                        onChange={(v) => v && setAct(a.id, 'Changed activity role', (x) => (x.roleId = v))}
                      />
                    </td>
                    <td className="r">
                      <div className="flex items-center gap-1.5 justify-end">
                        <Num width={76} value={a.effort} min={0} disabled={ro} ariaLabel={`${a.name} effort`} onChange={(v) => setAct(a.id, 'Changed activity effort', (x) => (x.effort = v))} />
                        <Select
                          className="!w-[72px]"
                          value={a.effortUnit}
                          disabled={ro}
                          ariaLabel="Effort unit"
                          options={[
                            { value: 'hours', label: 'hours' },
                            { value: 'days', label: 'days' },
                          ]}
                          onChange={(v) => setAct(a.id, 'Changed effort unit', (x) => (x.effortUnit = v))}
                        />
                      </div>
                    </td>
                    <td className="r">
                      <Num
                        width={80}
                        value={a.durationWeeks}
                        min={0}
                        suffix="wk"
                        disabled={ro}
                        ariaLabel={`${a.name} duration in weeks`}
                        onChange={(v) => setAct(a.id, 'Changed activity duration', (x) => (x.durationWeeks = v))}
                      />
                    </td>
                    <td className="min-w-[200px] max-w-[240px]">
                      <div className="flex flex-wrap gap-1 mb-1">
                        {a.dependsOn.map((dep) => {
                          const name = plan.activities.find((x) => x.id === dep)?.name ?? 'Missing activity';
                          return (
                            <span key={dep} className="inline-flex items-center gap-0.5 rounded-full bg-sunken border border-line pl-2 pr-0.5 text-[12px] text-ink-2 max-w-full">
                              <span className="truncate">{name}</span>
                              <button
                                type="button"
                                disabled={ro}
                                aria-label={`Remove dependency on ${name}`}
                                className="p-0.5 text-ink-3 hover:text-bad disabled:opacity-40"
                                onClick={() => setAct(a.id, 'Removed activity dependency', (x) => (x.dependsOn = x.dependsOn.filter((y) => y !== dep)))}
                              >
                                <X size={12} />
                              </button>
                            </span>
                          );
                        })}
                      </div>
                      {others.length > 0 && (
                        <select
                          className="field !text-[12.5px] !py-[3px]"
                          aria-label={`Add a dependency to ${a.name}`}
                          disabled={ro}
                          value=""
                          onChange={(e) => e.target.value && setAct(a.id, 'Added activity dependency', (x) => void x.dependsOn.push(e.target.value))}
                        >
                          <option value="">Add dependency…</option>
                          {others.map((o) => (
                            <option key={o.id} value={o.id}>
                              {o.name}
                            </option>
                          ))}
                        </select>
                      )}
                    </td>
                    <td className="r pt-2.5">
                      <div>{money(res?.cost ?? 0, cur)}</div>
                      <div className="text-[12.5px] text-ink-3">{count(res?.hours ?? 0, cur)} hours</div>
                    </td>
                    <td className="r pt-2.5 text-ink-2">{money(res?.billValue ?? 0, cur)}</td>
                    <td className="pt-2.5 whitespace-nowrap">
                      <div className="text-[13px]">{res ? weeksLabel(res.startWeek, res.endWeek) : '—'}</div>
                      {res?.critical && <Badge tone="brand">Critical path</Badge>}
                    </td>
                    <td className="r">
                      <IconButton
                        label={`Remove ${a.name}`}
                        tone="bad"
                        disabled={ro}
                        onClick={() =>
                          update(
                            'Removed activity',
                            (d) => {
                              d.implementation.activities = d.implementation.activities.filter((x) => x.id !== a.id);
                              for (const x of d.implementation.activities) x.dependsOn = x.dependsOn.filter((y) => y !== a.id);
                            },
                            a.name,
                          )
                        }
                      >
                        <Trash2 size={15} />
                      </IconButton>
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={5}>Total labour</td>
                <td className="r">
                  <div>{money(impl.laborCost, cur)}</div>
                  <div className="text-[12.5px] text-ink-3 font-normal">{count(impl.laborHours, cur)} hours</div>
                </td>
                <td className="r">{money(impl.tmValue.minus(impl.billableExpenses), cur)}</td>
                <td colSpan={2}>{impl.durationWeeks} weeks</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </Panel>

      <div className="grid gap-5 xl:grid-cols-[1.6fr_1fr]">
        <Gantt project={project} result={result} />
        <Panel title="Labour cost by phase" description="Internal cost, before expenses and contingency.">
          <BarList
            items={Object.entries(impl.costByPhase)
              .sort((a, b) => b[1].cmp(a[1]))
              .map(([phase, v]) => ({ label: phase, value: n(v) }))}
            format={f}
          />
        </Panel>
      </div>

      <div className="grid gap-5 xl:grid-cols-[1.4fr_1fr]">
        <Panel
          title="Direct expenses"
          description="Non-labour costs of delivery. Billable expenses are re-billed at cost under time and materials."
          padded={false}
          actions={
            <Button
              size="sm"
              icon={<Plus size={14} />}
              disabled={ro}
              onClick={() => update('Added direct expense', (d) => void d.implementation.directExpenses.push({ id: uid('exp'), name: 'New expense', amount: 0, currency: project.currency, billable: true }))}
            >
              Add expense
            </Button>
          }
        >
          <div className="scroll-x">
            <table className="dtable min-w-[600px]">
              <thead>
                <tr>
                  <th>Expense</th>
                  <th className="r">Amount</th>
                  <th>Currency</th>
                  <th>Billable</th>
                  <th aria-label="Actions" />
                </tr>
              </thead>
              <tbody>
                {plan.directExpenses.length === 0 && (
                  <tr>
                    <td colSpan={5} className="text-ink-3 text-[13.5px]">
                      No direct expenses. Add environments, licences or travel needed during delivery.
                    </td>
                  </tr>
                )}
                {plan.directExpenses.map((x) => {
                  const edit = (what: string, fn: (e: (typeof plan.directExpenses)[number]) => void) =>
                    update(what, (d) => {
                      const e = d.implementation.directExpenses.find((y) => y.id === x.id);
                      if (e) fn(e);
                    });
                  return (
                    <tr key={x.id}>
                      <td className="min-w-[240px]">
                        <TextInput value={x.name} disabled={ro} ariaLabel="Expense name" onChange={(v) => edit('Renamed direct expense', (e) => (e.name = v))} />
                      </td>
                      <td className="r">
                        <Num width={130} value={x.amount} min={0} disabled={ro} ariaLabel={`${x.name} amount`} onChange={(v) => edit('Changed direct expense amount', (e) => (e.amount = v))} />
                      </td>
                      <td>
                        <Select
                          className="!w-[88px]"
                          value={x.currency}
                          options={curOpts}
                          disabled={ro}
                          ariaLabel={`${x.name} currency`}
                          onChange={(v) => edit('Changed direct expense currency', (e) => (e.currency = v))}
                        />
                      </td>
                      <td>
                        <Checkbox checked={x.billable} disabled={ro} label="Billable" onChange={(v) => edit('Changed expense billability', (e) => (e.billable = v))} />
                      </td>
                      <td className="r">
                        <IconButton
                          label={`Remove ${x.name}`}
                          tone="bad"
                          disabled={ro}
                          onClick={() => update('Removed direct expense', (d) => void (d.implementation.directExpenses = d.implementation.directExpenses.filter((y) => y.id !== x.id)), x.name)}
                        >
                          <Trash2 size={15} />
                        </IconButton>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Panel>
        <Panel title="Schedule and rate checks" description="Circular or missing dependencies and activities without a valid role.">
          <IssueList issues={issues} empty="The schedule resolves and every activity has a rate." />
        </Panel>
      </div>
    </div>
  );
}

function Gantt({ project, result }: Pick<EditorProps, 'project' | 'result'>) {
  const impl = result.implementation;
  const total = Math.max(1, impl.durationWeeks);
  const rows = [...impl.activities].sort((a, b) => a.startWeek - b.startWeek || a.endWeek - b.endWeek);
  const step = [1, 2, 4, 5, 10, 13, 26, 52].find((s) => total / s <= 8) ?? Math.ceil(total / 8);
  const ticks: number[] = [];
  for (let w = 0; w <= total; w += step) ticks.push(w);
  const roleOf = (id: string) => project.implementation.roles.find((r) => r.id === id)?.name ?? 'Unassigned';
  return (
    <ChartFrame
      title="Delivery timeline"
      description={`${impl.durationWeeks} weeks from kick-off. Highlighted bars are on the critical path: any slip there delays go-live.`}
      table={{
        columns: ['Activity', 'Start week', 'End week', 'Critical path'],
        rows: rows.map((a) => [a.name, a.startWeek + 1, a.endWeek, a.critical ? 'Yes' : 'No']),
      }}
    >
      <div className="flex flex-wrap gap-x-4 gap-y-1 px-2 pb-2">
        <Swatch color="--brand" label="Critical path" />
        <Swatch color="--accent-series-soft" label="Has slack" />
      </div>
      <div className="scroll-x px-2">
        <div className="min-w-[640px]">
          <div className="grid grid-cols-[minmax(170px,240px)_1fr] gap-x-3 text-[11.5px] text-ink-3 border-b border-line pb-1">
            <div>Activity</div>
            <div className="relative h-4">
              {ticks.map((w) => (
                <span key={w} className="absolute num -translate-x-1/2" style={{ left: `${(w / total) * 100}%` }}>
                  {w === 0 ? 'Start' : `W${w}`}
                </span>
              ))}
            </div>
          </div>
          <ul>
            {rows.map((a) => {
              const left = (a.startWeek / total) * 100;
              const width = Math.max(0.6, ((a.endWeek - a.startWeek) / total) * 100);
              return (
                <li key={a.id} className="grid grid-cols-[minmax(170px,240px)_1fr] gap-x-3 items-center py-1 border-b border-line-soft last:border-b-0">
                  <div className="min-w-0">
                    <div className="text-[13px] text-ink truncate" title={a.name}>
                      {a.name}
                    </div>
                    <div className="text-[11.5px] text-ink-3 truncate">{roleOf(a.roleId)}</div>
                  </div>
                  <div className="relative h-5">
                    {ticks.map((w) => (
                      <span key={w} aria-hidden className="absolute top-0 bottom-0 w-px bg-line-soft" style={{ left: `${(w / total) * 100}%` }} />
                    ))}
                    <div
                      className={cx('absolute top-1 h-3 rounded', a.critical ? 'bg-brand' : '')}
                      style={{ left: `${left}%`, width: `${width}%`, background: a.critical ? undefined : 'var(--accent-series-soft)' }}
                      title={`${a.name}: ${weeksLabel(a.startWeek, a.endWeek)}${a.critical ? ' (critical path)' : ''}`}
                    />
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      </div>
    </ChartFrame>
  );
}
