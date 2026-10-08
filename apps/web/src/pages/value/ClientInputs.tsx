import { Plus, Trash2 } from 'lucide-react';
import { uid, type ClientCost, type OutcomeKpi, type ProjectResult } from '@aies/engine';
import { Button, Checkbox, Field, NumberInput, Panel, Select, TextInput, Toggle, cx } from '../../components/ui';
import { useStore } from '../../state/store';
import { currencyOptions, type Updater } from './shared';

export function ClientCosts({ r, update, canEdit }: { r: ProjectResult; update: Updater; canEdit: boolean }) {
  const { state } = useStore();
  const v = r.project.value;
  const edit = <K extends keyof ClientCost>(id: string, k: K, val: ClientCost[K], label: string) =>
    update(`Changed client cost ${label}`, (d) => {
      const c = d.value.clientCosts.find((x) => x.id === id);
      if (c) c[k] = val;
    });
  return (
    <Panel
      title="Client investment settings"
      description="The client's own internal costs (beyond provider fees), the discount rate for NPV, and which benefits count."
      actions={
        <Button
          size="sm"
          icon={<Plus size={14} />}
          disabled={!canEdit}
          onClick={() => update('Added client cost', (d) => d.value.clientCosts.push({ id: uid('cc'), name: 'Client internal cost', type: 'monthly', amount: 0, currency: d.currency }))}
        >
          Add cost
        </Button>
      }
    >
      <div className="space-y-2">
        {v.clientCosts.length === 0 && <p className="text-sm text-ink-3">No client internal costs. Add SME time, change management or licence uplifts the client pays directly.</p>}
        {v.clientCosts.map((c) => (
          <div key={c.id} className="grid gap-2 grid-cols-[1fr_auto] sm:grid-cols-[minmax(0,1fr)_120px_150px_76px_auto] items-center border-b border-line-soft pb-2">
            <div className="col-span-2 sm:col-span-1">
              <TextInput value={c.name} ariaLabel="Cost name" disabled={!canEdit} onChange={(x) => edit(c.id, 'name', x || 'Client cost', 'name')} />
            </div>
            <Select<ClientCost['type']>
              value={c.type}
              ariaLabel="Cost type"
              disabled={!canEdit}
              onChange={(x) => edit(c.id, 'type', x, 'type')}
              options={[
                { value: 'one_time', label: 'One-time' },
                { value: 'monthly', label: 'Monthly' },
              ]}
            />
            <NumberInput value={c.amount} min={0} step={10000} ariaLabel={`Amount for ${c.name}`} disabled={!canEdit} onChange={(x) => edit(c.id, 'amount', x, 'amount')} />
            <Select value={c.currency} ariaLabel="Currency" options={currencyOptions(state.catalog, c.currency)} disabled={!canEdit} onChange={(x) => edit(c.id, 'currency', x, 'currency')} />
            <Button
              variant="ghost"
              size="sm"
              aria-label={`Remove ${c.name}`}
              title="Remove cost"
              disabled={!canEdit}
              onClick={() => update('Removed client cost', (d) => (d.value.clientCosts = d.value.clientCosts.filter((x) => x.id !== c.id)), c.name)}
            >
              <Trash2 size={15} />
            </Button>
          </div>
        ))}
      </div>
      <div className="grid gap-4 mt-4 sm:grid-cols-[180px_1fr] items-end">
        <Field label="Discount rate (NPV)" htmlFor="v-disc">
          <NumberInput
            id="v-disc"
            value={v.discountRatePct}
            suffix="%"
            min={0}
            max={50}
            step={0.5}
            disabled={!canEdit}
            onChange={(x) => update('Changed discount rate', (d) => void (d.value.discountRatePct = x))}
          />
        </Field>
        <div className="pb-1.5">
          <Toggle
            checked={v.includeUnvalidated}
            disabled={!canEdit}
            label="Include proposed benefits (forecast view)"
            onChange={(x) => update(x ? 'Switched to forecast view' : 'Switched to validated view', (d) => void (d.value.includeUnvalidated = x))}
          />
          <p className="text-[12px] text-ink-3 mt-1">
            {v.includeUnvalidated ? 'ROI includes proposed benefits that Finance has not validated. Use for pipeline discussions only.' : 'ROI counts finance-validated and realised benefits only.'}
          </p>
        </div>
      </div>
    </Panel>
  );
}

export function KpiEditor({ r, update, canEdit }: { r: ProjectResult; update: Updater; canEdit: boolean }) {
  const kpis = r.project.value.kpis;
  const edit = <K extends keyof OutcomeKpi>(id: string, k: K, val: OutcomeKpi[K], label: string) =>
    update(`Changed KPI ${label}`, (d) => {
      const x = d.value.kpis.find((y) => y.id === id);
      if (x) x[k] = val;
    });
  return (
    <Panel
      title="Business outcome KPIs"
      description="Operational outcomes agreed with the client. Tracked alongside ROI, not monetised."
      padded={false}
      actions={
        <Button
          size="sm"
          icon={<Plus size={14} />}
          disabled={!canEdit}
          onClick={() => update('Added KPI', (d) => d.value.kpis.push({ id: uid('k'), name: 'New KPI', unit: '', before: 0, after: 0, higherIsBetter: true }))}
        >
          Add KPI
        </Button>
      }
    >
      <div className="scroll-x">
        <table className="dtable min-w-[760px]">
          <thead>
            <tr>
              <th>KPI</th>
              <th>Unit</th>
              <th className="r">Before</th>
              <th className="r">With AI</th>
              <th>Direction</th>
              <th className="r">Change</th>
              <th aria-label="Remove" />
            </tr>
          </thead>
          <tbody>
            {kpis.length === 0 && (
              <tr>
                <td colSpan={7} className="text-ink-3 text-center py-5">
                  No KPIs yet. Add handling time, accuracy, turnaround or satisfaction measures.
                </td>
              </tr>
            )}
            {kpis.map((k) => {
              // Display-only relative change of a non-financial KPI.
              const ch = k.before ? ((k.after - k.before) / Math.abs(k.before)) * 100 : 0;
              const good = k.higherIsBetter ? ch >= 0 : ch <= 0;
              return (
                <tr key={k.id}>
                  <td className="min-w-[200px]">
                    <TextInput value={k.name} ariaLabel="KPI name" disabled={!canEdit} onChange={(v) => edit(k.id, 'name', v || 'KPI', 'name')} />
                  </td>
                  <td className="w-[90px]">
                    <TextInput value={k.unit} ariaLabel="Unit" disabled={!canEdit} onChange={(v) => edit(k.id, 'unit', v, 'unit')} />
                  </td>
                  <td className="r">
                    <NumberInput value={k.before} width={96} className="ml-auto" ariaLabel={`${k.name} before`} disabled={!canEdit} onChange={(v) => edit(k.id, 'before', v, 'baseline')} />
                  </td>
                  <td className="r">
                    <NumberInput value={k.after} width={96} className="ml-auto" ariaLabel={`${k.name} with AI`} disabled={!canEdit} onChange={(v) => edit(k.id, 'after', v, 'target')} />
                  </td>
                  <td>
                    <Checkbox checked={k.higherIsBetter} disabled={!canEdit} label="Higher is better" onChange={(v) => edit(k.id, 'higherIsBetter', v, 'direction')} />
                  </td>
                  <td className={cx('r font-semibold', k.before ? (good ? 'text-good' : 'text-bad') : 'text-ink-3')}>{k.before ? `${ch >= 0 ? '+' : '−'}${Math.abs(ch).toFixed(0)}%` : '—'}</td>
                  <td className="r">
                    <Button
                      variant="ghost"
                      size="sm"
                      aria-label={`Remove ${k.name}`}
                      title="Remove KPI"
                      disabled={!canEdit}
                      onClick={() => update('Removed KPI', (d) => (d.value.kpis = d.value.kpis.filter((x) => x.id !== k.id)), k.name)}
                    >
                      <Trash2 size={15} />
                    </Button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}
