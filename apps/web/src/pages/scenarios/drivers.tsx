import { useEffect, useId, useRef, useState } from 'react';
import type { ProjectResult, ScenarioOverrides } from '@aies/engine';
import { NumberInput, cx } from '../../components/ui';
import { modelName } from '../../lib/slice';

export type ScenarioKey = 'baseline' | 'optimized' | 'stress' | 'custom';

/** Numeric overrides driven by a slider, with their neutral (no-change) value. */
export type NumericKey =
  | 'volumeMultiplier'
  | 'inputTokenMultiplier'
  | 'outputTokenMultiplier'
  | 'retryMultiplier'
  | 'successRateDeltaPp'
  | 'humanInterventionDeltaPp'
  | 'cacheHitDeltaPp'
  | 'infraMultiplier'
  | 'agentOpsMultiplier'
  | 'complexityShiftPp'
  | 'priceMultiplier';

export interface DriverDef {
  key: NumericKey;
  label: string;
  kind: 'mult' | 'pp';
  min: number;
  max: number;
  step: number;
  hint?: string;
}

const mult = (key: NumericKey, label: string, min = 0.25, max = 3, hint?: string): DriverDef => ({ key, label, kind: 'mult', min, max, step: 0.05, hint });
const pp = (key: NumericKey, label: string, range: number, hint?: string): DriverDef => ({ key, label, kind: 'pp', min: -range, max: range, step: 0.5, hint });

export const DRIVER_GROUPS: { title: string; drivers: DriverDef[] }[] = [
  { title: 'Demand', drivers: [mult('volumeMultiplier', 'Transaction volume', 0.25, 3, 'Attempted transactions per month')] },
  {
    title: 'Consumption',
    drivers: [
      mult('inputTokenMultiplier', 'Input tokens'),
      mult('outputTokenMultiplier', 'Output tokens', 0.25, 3, 'Includes reasoning tokens'),
      pp('cacheHitDeltaPp', 'Cache hit rate', 50, 'On steps with a cacheable prefix'),
    ],
  },
  {
    title: 'Quality',
    drivers: [
      mult('retryMultiplier', 'Retry rate', 0, 5),
      pp('successRateDeltaPp', 'Agent success rate', 30),
      pp('humanInterventionDeltaPp', 'Human intervention', 30),
      pp('complexityShiftPp', 'Complexity mix shift', 40, 'Points moved from the simplest to the most complex class'),
    ],
  },
  { title: 'Operations', drivers: [mult('infraMultiplier', 'Infrastructure utilisation'), mult('agentOpsMultiplier', 'AgentOps effort')] },
  { title: 'Commercial', drivers: [mult('priceMultiplier', 'Customer price', 0.5, 2, 'Applied to every contracted price')] },
];

export const neutral = (d: DriverDef) => (d.kind === 'mult' ? 1 : 0);

export const fmtDriver = (d: DriverDef, v: number) => (d.kind === 'mult' ? `×${v.toFixed(2)}` : `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toFixed(1)}pp`);

/** Drops neutral overrides so the engine and the waterfall only see real changes. */
export function clean(o: ScenarioOverrides): ScenarioOverrides {
  const out: ScenarioOverrides = {};
  for (const g of DRIVER_GROUPS)
    for (const d of g.drivers) {
      const v = o[d.key];
      if (typeof v === 'number' && Number.isFinite(v) && v !== neutral(d)) out[d.key] = v;
    }
  if (o.routingShift && o.routingShift.toModelId && o.routingShift.sharePct > 0) out.routingShift = { ...o.routingShift };
  if (o.modelSwap && o.modelSwap.fromModelId && o.modelSwap.toModelId && o.modelSwap.fromModelId !== o.modelSwap.toModelId) out.modelSwap = { ...o.modelSwap };
  if (o.growthPct !== null && o.growthPct !== undefined) out.growthPct = o.growthPct;
  if (o.repriceAtTargetMargin) {
    out.repriceAtTargetMargin = true;
    if (o.targetMarginPct !== null && o.targetMarginPct !== undefined) out.targetMarginPct = o.targetMarginPct;
  }
  // Legacy absolute overrides from older saved scenarios are passed through untouched.
  if (o.retryRatePct !== null && o.retryRatePct !== undefined) out.retryRatePct = o.retryRatePct;
  if (o.cacheHitRatePct !== null && o.cacheHitRatePct !== undefined) out.cacheHitRatePct = o.cacheHitRatePct;
  return out;
}

export function describe(o: ScenarioOverrides, r: ProjectResult): string {
  const c = clean(o);
  const parts: string[] = [];
  for (const g of DRIVER_GROUPS) for (const d of g.drivers) if (c[d.key] !== undefined) parts.push(`${d.label} ${fmtDriver(d, c[d.key] as number)}`);
  if (c.routingShift) parts.push(`${c.routingShift.sharePct}% routed to ${modelName(r, c.routingShift.toModelId)}`);
  if (c.modelSwap) parts.push(`${modelName(r, c.modelSwap.fromModelId)} swapped for ${modelName(r, c.modelSwap.toModelId)}`);
  if (c.growthPct !== undefined) parts.push(`Growth ${c.growthPct}% a year`);
  if (c.repriceAtTargetMargin) parts.push(`Re-priced at ${c.targetMarginPct ?? 'current'}${c.targetMarginPct !== undefined ? '%' : ''} margin`);
  if (c.retryRatePct !== undefined) parts.push(`Retry rate ${c.retryRatePct}%`);
  if (c.cacheHitRatePct !== undefined) parts.push(`Cache hit ${c.cacheHitRatePct}%`);
  return parts.length ? parts.join(', ') : 'No changes from baseline';
}

/** Slider + number input. The slider commits after a short pause so the model reruns once per gesture, not per pixel. */
export function RangeField({ def, value, onChange }: { def: DriverDef; value: number; onChange: (v: number) => void }) {
  const id = useId();
  const [v, setV] = useState(value);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => setV(value), [value]);
  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);
  const changed = value !== neutral(def);
  const commitSoon = (x: number) => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => onChange(x), 160);
  };
  return (
    <div className="min-w-0">
      <div className="flex items-baseline justify-between gap-2">
        <label htmlFor={id} className={cx('text-[13px] font-semibold', changed ? 'text-ink' : 'text-ink-2')}>
          {def.label}
          {changed && <span className="ml-1.5 inline-block w-1.5 h-1.5 rounded-full bg-brand align-middle" aria-label="changed" />}
        </label>
        {changed && (
          <button type="button" className="text-[12px] text-ink-3 hover:text-ink" onClick={() => onChange(neutral(def))}>
            Reset
          </button>
        )}
      </div>
      <div className="flex items-center gap-3 mt-1">
        <input
          id={id}
          type="range"
          min={def.min}
          max={def.max}
          step={def.step}
          value={Math.min(def.max, Math.max(def.min, v))}
          aria-valuetext={fmtDriver(def, v)}
          className="flex-1 min-w-0 h-1.5 accent-[var(--brand)] cursor-pointer"
          onChange={(e) => {
            const x = Number(e.target.value);
            setV(x);
            commitSoon(x);
          }}
        />
        <NumberInput
          value={v}
          min={def.kind === 'mult' ? 0 : -100}
          max={def.kind === 'mult' ? 20 : 100}
          step={def.step}
          prefix={def.kind === 'mult' ? '×' : undefined}
          suffix={def.kind === 'pp' ? 'pp' : undefined}
          width={96}
          ariaLabel={def.label}
          onChange={(x) => {
            setV(x);
            onChange(x);
          }}
        />
      </div>
      {def.hint && <p className="text-[12px] text-ink-3 mt-0.5">{def.hint}</p>}
    </div>
  );
}
