import { Plus } from 'lucide-react';
import { sum, type ProductivityInput, type ProjectResult } from '@aies/engine';
import { Button, NumberInput, Panel, Select } from '../../components/ui';
import { compact, count, money, num, pct } from '../../lib/format';
import { useStore } from '../../state/store';
import { currencyOptions, type Updater } from './shared';

/** Productivity inputs per workflow and the engine's released-capacity results (non-cash). */
export function Productivity({ r, update, canEdit }: { r: ProjectResult; update: Updater; canEdit: boolean }) {
  const { state } = useStore();
  const cur = r.currency;
  const prod = r.project.value.productivity;
  const results = r.steady.value.productivity;

  const edit = <K extends keyof ProductivityInput>(workflowId: string, k: K, v: ProductivityInput[K], label: string) =>
    update(`Changed ${label}`, (d) => {
      const p = d.value.productivity.find((x) => x.workflowId === workflowId);
      if (p) p[k] = v;
    });

  const addFor = (workflowId: string) =>
    update('Added productivity inputs', (d) => {
      d.value.productivity.push({ workflowId, manualMinutesBefore: 10, spotCheckMinutesAutonomous: 1, loadedHourlyCost: 450, currency: d.currency, productiveHoursPerFteMonth: 140 });
    });

  const totalBefore = sum(results.map((x) => x.hoursBefore));
  const totalAfter = sum(results.map((x) => x.hoursAfter));
  return (
    <Panel
      title="Productivity by workflow"
      description="Minutes of manual effort per transaction before AI, and the residual spot-check time on autonomous completions. Human-assisted and fallback work is taken from the cost model, so it is never counted twice."
      padded={false}
    >
      <div className="scroll-x">
        <table className="dtable min-w-[1180px]">
          <thead>
            <tr>
              <th>Workflow</th>
              <th className="r">Manual min / txn before AI</th>
              <th className="r">Spot-check min / autonomous</th>
              <th className="r">Loaded hourly cost</th>
              <th className="r">Productive h / FTE-month</th>
              <th className="r border-l border-line-soft">Hours before</th>
              <th className="r">Hours after</th>
              <th className="r">Hours saved</th>
              <th className="r">Capacity released</th>
              <th className="r">Productivity value</th>
              <th className="r">Improvement</th>
            </tr>
          </thead>
          <tbody>
            {r.project.workflows.map((wf) => {
              const p = prod.find((x) => x.workflowId === wf.id);
              const res = results.find((x) => x.workflowId === wf.id);
              if (!p)
                return (
                  <tr key={wf.id}>
                    <td className="font-semibold">{wf.name}</td>
                    <td colSpan={10}>
                      <Button size="sm" icon={<Plus size={14} />} disabled={!canEdit} onClick={() => addFor(wf.id)}>
                        Add productivity inputs
                      </Button>
                    </td>
                  </tr>
                );
              return (
                <tr key={wf.id}>
                  <td className="font-semibold min-w-[170px]">
                    {wf.name}
                    <div className="text-[12px] font-normal text-ink-3">per {wf.abuName}</div>
                  </td>
                  <td className="r">
                    <NumberInput
                      value={p.manualMinutesBefore}
                      min={0}
                      step={1}
                      width={92}
                      className="ml-auto"
                      suffix="min"
                      ariaLabel={`Manual minutes before AI, ${wf.name}`}
                      disabled={!canEdit}
                      onChange={(v) => edit(wf.id, 'manualMinutesBefore', v, 'manual minutes before AI')}
                    />
                  </td>
                  <td className="r">
                    <NumberInput
                      value={p.spotCheckMinutesAutonomous}
                      min={0}
                      step={0.5}
                      width={92}
                      className="ml-auto"
                      suffix="min"
                      ariaLabel={`Spot-check minutes, ${wf.name}`}
                      disabled={!canEdit}
                      onChange={(v) => edit(wf.id, 'spotCheckMinutesAutonomous', v, 'spot-check minutes')}
                    />
                  </td>
                  <td className="r">
                    <div className="flex items-center gap-1.5 justify-end">
                      <NumberInput
                        value={p.loadedHourlyCost}
                        min={0}
                        step={10}
                        width={88}
                        ariaLabel={`Loaded hourly cost, ${wf.name}`}
                        disabled={!canEdit}
                        onChange={(v) => edit(wf.id, 'loadedHourlyCost', v, 'loaded hourly cost')}
                      />
                      <Select
                        value={p.currency}
                        className="!w-[76px]"
                        ariaLabel="Currency"
                        options={currencyOptions(state.catalog, p.currency)}
                        disabled={!canEdit}
                        onChange={(v) => edit(wf.id, 'currency', v, 'hourly cost currency')}
                      />
                    </div>
                  </td>
                  <td className="r">
                    <NumberInput
                      value={p.productiveHoursPerFteMonth}
                      min={1}
                      step={5}
                      width={80}
                      className="ml-auto"
                      ariaLabel={`Productive hours per FTE-month, ${wf.name}`}
                      disabled={!canEdit}
                      onChange={(v) => edit(wf.id, 'productiveHoursPerFteMonth', v, 'productive hours per FTE-month')}
                    />
                  </td>
                  <td className="r border-l border-line-soft">{res ? count(res.hoursBefore, cur) : '—'}</td>
                  <td className="r">{res ? count(res.hoursAfter, cur) : '—'}</td>
                  <td className="r font-semibold">{res ? count(res.hoursSaved, cur) : '—'}</td>
                  <td className="r">{res ? `${num(res.fteReleased, 1)} FTE` : '—'}</td>
                  <td className="r">{res ? money(res.productivityValue, cur, 0) : '—'}</td>
                  <td className="r font-semibold">{res ? pct(res.improvementPct) : '—'}</td>
                </tr>
              );
            })}
          </tbody>
          {results.length > 1 && (
            <tfoot>
              <tr>
                <td colSpan={5}>All workflows, steady-state month</td>
                <td className="r border-l border-line-soft">{count(totalBefore, cur)}</td>
                <td className="r">{count(totalAfter, cur)}</td>
                <td className="r">{count(r.steady.value.hoursSaved, cur)}</td>
                <td className="r">{num(r.steady.value.fteReleased, 1)} FTE</td>
                <td className="r">{compact(r.steady.value.productivityValue, cur)}</td>
                <td className="r" />
              </tr>
            </tfoot>
          )}
        </table>
      </div>
      <p className="px-4 py-2.5 text-[12.5px] text-ink-3 border-t border-line-soft">
        Hours per steady-state month. Productivity value is released capacity at loaded cost; it is reported, never added to ROI.
      </p>
    </Panel>
  );
}
