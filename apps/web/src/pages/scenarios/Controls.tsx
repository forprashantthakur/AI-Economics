import type { ProjectResult, ScenarioOverrides } from '@aies/engine';
import { Field, NumberInput, Panel, Select, Toggle } from '../../components/ui';
import { modelName } from '../../lib/slice';
import { DRIVER_GROUPS, RangeField, neutral } from './drivers';

/**
 * Scenario controls. They show the selected scenario's overrides; any change
 * forks it into the Custom scenario (handled by `onChange`).
 */
export function Controls({
  r,
  value,
  onChange,
  onReset,
  baseGrowth,
  baseMargin,
}: {
  r: ProjectResult;
  value: ScenarioOverrides;
  onChange: (patch: Partial<ScenarioOverrides>) => void;
  onReset: () => void;
  baseGrowth: number;
  baseMargin: number;
}) {
  const models = r.context.catalog.modelRates;
  const used = [...new Set(r.project.workflows.flatMap((w) => w.llmSteps.flatMap((s) => s.routing.map((x) => x.modelId))))];
  const modelOptions = models.map((m) => ({ value: m.id, label: `${m.model}${m.sample ? ' (sample rate)' : ''}` }));
  const shift = value.routingShift ?? null;
  const swap = value.modelSwap ?? null;
  const growthOn = value.growthPct !== null && value.growthPct !== undefined;
  const reprice = !!value.repriceAtTargetMargin;

  return (
    <Panel
      title="Drivers"
      description="Multipliers apply to every workflow; pp moves rates by percentage points."
      actions={
        <button type="button" className="text-[13px] font-semibold text-ink-3 hover:text-ink" onClick={onReset}>
          Reset all
        </button>
      }
    >
      <div className="space-y-5">
        {DRIVER_GROUPS.map((g) => (
          <fieldset key={g.title} className="space-y-3.5 min-w-0">
            <legend className="text-[12.5px] font-semibold text-ink-3 mb-2">{g.title}</legend>
            {g.drivers.map((d) => (
              <RangeField key={d.key} def={d} value={(value[d.key] as number | undefined) ?? neutral(d)} onChange={(v) => onChange({ [d.key]: v })} />
            ))}
            {g.title === 'Consumption' && (
              <>
                <div className="grid gap-2 grid-cols-[minmax(0,1fr)_96px] items-end">
                  <Field label="Shift traffic to model" htmlFor="sc-route">
                    <Select
                      id="sc-route"
                      value={shift?.toModelId ?? ''}
                      options={[{ value: '', label: 'No routing shift' }, ...modelOptions]}
                      onChange={(v) => onChange({ routingShift: v ? { toModelId: v, sharePct: shift?.sharePct || 30 } : null })}
                    />
                  </Field>
                  <NumberInput
                    value={shift?.sharePct ?? 0}
                    min={0}
                    max={100}
                    step={5}
                    suffix="%"
                    ariaLabel="Share of traffic shifted"
                    disabled={!shift?.toModelId}
                    onChange={(v) => shift && onChange({ routingShift: { ...shift, sharePct: v } })}
                  />
                </div>
                <div className="grid gap-2 sm:grid-cols-2">
                  <Field label="Swap model" htmlFor="sc-swap-from">
                    <Select
                      id="sc-swap-from"
                      value={swap?.fromModelId ?? ''}
                      options={[{ value: '', label: 'No swap' }, ...used.map((id) => ({ value: id, label: modelName(r, id) }))]}
                      onChange={(v) =>
                        onChange({ modelSwap: v ? { fromModelId: v, toModelId: swap?.toModelId && swap.toModelId !== v ? swap.toModelId : (models.find((m) => m.id !== v)?.id ?? v) } : null })
                      }
                    />
                  </Field>
                  <Field label="Replace with" htmlFor="sc-swap-to">
                    <Select
                      id="sc-swap-to"
                      value={swap?.toModelId ?? ''}
                      disabled={!swap?.fromModelId}
                      options={swap?.fromModelId ? modelOptions.filter((m) => m.value !== swap.fromModelId) : [{ value: '', label: 'Pick a model to swap first' }]}
                      onChange={(v) => swap && onChange({ modelSwap: { ...swap, toModelId: v } })}
                    />
                  </Field>
                </div>
              </>
            )}
            {g.title === 'Demand' && (
              <div className="flex flex-wrap items-center gap-3">
                <Toggle checked={growthOn} label="Override annual growth" onChange={(on) => onChange({ growthPct: on ? baseGrowth : null })} />
                {growthOn && <NumberInput value={value.growthPct ?? 0} min={-50} max={200} step={1} suffix="%" width={110} ariaLabel="Annual growth" onChange={(v) => onChange({ growthPct: v })} />}
              </div>
            )}
            {g.title === 'Commercial' && (
              <div className="space-y-2">
                <Toggle
                  checked={reprice}
                  label="Re-price at target margin"
                  onChange={(on) => onChange({ repriceAtTargetMargin: on, targetMarginPct: on ? (value.targetMarginPct ?? baseMargin) : value.targetMarginPct })}
                />
                <div className="grid grid-cols-[minmax(0,1fr)_110px] gap-2 items-center">
                  <span className="text-[13px] text-ink-2">Target margin for run streams</span>
                  <NumberInput
                    value={value.targetMarginPct ?? baseMargin}
                    min={0}
                    max={95}
                    step={1}
                    suffix="%"
                    ariaLabel="Target margin"
                    disabled={!reprice}
                    onChange={(v) => onChange({ targetMarginPct: v })}
                  />
                </div>
                <p className="text-[12px] text-ink-3">
                  {reprice
                    ? 'Prices are re-derived from the scenario cost at the target margin.'
                    : 'Off: contracted prices stay locked while costs move, which is what the provider actually experiences.'}
                </p>
              </div>
            )}
          </fieldset>
        ))}
      </div>
    </Panel>
  );
}
