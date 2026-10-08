import { useDeferredValue, useMemo, useState } from 'react';
import { SCENARIO_PRESETS, costWaterfall, metricsOf, runScenario, type ScenarioOverrides, type ScenarioRecord, type ScenarioRun } from '@aies/engine';
import { ChartFrame, Waterfall } from '../components/charts';
import { Callout, Empty, IssueList, PageHeader, Segmented, StatStrip, cx } from '../components/ui';
import { useCan, useCurrentProject, useProjectUpdater, useResult, useStore } from '../state/store';
import { compact, money, pct, unitPrice } from '../lib/format';
import { Controls } from './scenarios/Controls';
import { Comparison, SCENARIO_LABEL } from './scenarios/Comparison';
import { SensitivityPanel } from './scenarios/Sensitivity';
import { SavedScenarios } from './scenarios/SavedScenarios';
import { clean, describe, type ScenarioKey } from './scenarios/drivers';

/**
 * Workaround: unlayered rules in styles.css (`.field` padding, `button { color: inherit }`) beat Tailwind's layered
 * utilities, so NumberInput affixes overlap the value and primary buttons lose their light text. Scoped to this page.
 */
const LAYER_FIX = '[&_input.pr-9]:pr-9! [&_input.pl-6]:pl-6! [&_button.text-brand-ink]:text-brand-ink!';

const PRESET_KEYS = ['baseline', 'optimized', 'stress'] as const;

/** Module 9 — what-if simulation on the selected project at locked (or re-derived) prices. */
export function ScenarioSimulator() {
  const project = useCurrentProject();
  const r = useResult(project);
  const { state } = useStore();
  const catalog = state.catalog;
  const update = useProjectUpdater(project?.id);
  const canSave = useCan('scenario.save');

  const [selected, setSelected] = useState<ScenarioKey>('baseline');
  const [custom, setCustom] = useState<ScenarioOverrides>({});
  const [loadedName, setLoadedName] = useState<string | null>(null);

  // Preset runs: three engine runs with break-even, once per project/catalogue result.
  const presets = useMemo(() => {
    if (!r) return null;
    const out = {} as Record<(typeof PRESET_KEYS)[number], ScenarioRun | null>;
    out.baseline = null;
    out.optimized = runScenario(r, catalog, SCENARIO_PRESETS.optimized.overrides, true);
    out.stress = runScenario(r, catalog, SCENARIO_PRESETS.stress.overrides, true);
    return out;
  }, [r, catalog]);
  const baseMetrics = useMemo(() => (r ? metricsOf(r, catalog, true) : null), [r, catalog]);

  // Custom run follows the controls; deferred so sliders stay responsive while the model reruns.
  const customKey = JSON.stringify(clean(custom));
  const deferredKey = useDeferredValue(customKey);
  const customRun = useMemo(() => (r ? runScenario(r, catalog, JSON.parse(deferredKey) as ScenarioOverrides, true) : null), [r, catalog, deferredKey]);
  const busyCustom = deferredKey !== customKey;

  const overridesOf = (k: ScenarioKey): ScenarioOverrides => (k === 'custom' ? custom : SCENARIO_PRESETS[k].overrides);
  const selectedOverrides = overridesOf(selected);
  const waterfallKey = selected === 'custom' ? deferredKey : JSON.stringify(SCENARIO_PRESETS[selected].overrides);
  const waterfall = useMemo(() => (project ? costWaterfall(project, catalog, JSON.parse(waterfallKey) as ScenarioOverrides) : []), [project, catalog, waterfallKey]);

  if (!project || !r || !presets || !baseMetrics || !customRun) return <Empty title="No project selected" body="Create or select a project to simulate scenarios." />;

  const cur = r.currency;
  const metrics = { baseline: baseMetrics, optimized: presets.optimized!.metrics, stress: presets.stress!.metrics, custom: customRun.metrics };
  const selRun = selected === 'baseline' ? null : selected === 'custom' ? customRun : presets[selected];
  const m = metrics[selected];
  const newIssues = selRun ? selRun.result.issues.filter((i) => i.severity !== 'info' && !r.issues.some((b) => b.message === i.message)) : [];

  const runStream = project.pricing.streams.find((s) => s.enabled && !['fixed_fee', 'pass_through', 'gainshare'].includes(s.type));
  const baseMargin = runStream?.targetMarginPct ?? 30;
  const baseGrowth = project.workflows[0]?.annualGrowthPct ?? 0;

  const change = (patch: Partial<ScenarioOverrides>) => {
    setCustom({ ...(selected === 'custom' ? custom : SCENARIO_PRESETS[selected].overrides), ...patch });
    if (selected !== 'custom') setLoadedName(null);
    setSelected('custom');
  };
  const load = (s: ScenarioRecord) => {
    setCustom(structuredClone(s.overrides));
    setLoadedName(s.name);
    setSelected('custom');
  };

  const sel = selected === 'custom' ? (loadedName ? `${loadedName} (custom)` : 'Custom scenario') : SCENARIO_PRESETS[selected].name;
  const hasDeltas = waterfall.some((s) => s.kind === 'delta');

  return (
    <div className={LAYER_FIX}>
      <PageHeader
        title="Scenario simulator"
        description="Stress the cost model and see what happens to unit costs, provider margin and client ROI. Contracted prices stay locked unless you choose to re-price, which is what the provider experiences after signature."
      />

      <div className="flex flex-wrap items-center gap-3 mb-4">
        <Segmented<ScenarioKey>
          ariaLabel="Scenario"
          value={selected}
          onChange={setSelected}
          options={(['baseline', 'optimized', 'stress', 'custom'] as ScenarioKey[]).map((k) => ({ id: k, label: SCENARIO_LABEL[k] }))}
        />
        <p className="text-[13.5px] text-ink-2 min-w-[240px] flex-1">{selected === 'custom' ? describe(custom, r) : SCENARIO_PRESETS[selected].description}</p>
      </div>

      <StatStrip
        className={cx(selected === 'custom' && busyCustom && 'opacity-60')}
        items={[
          {
            label: `Monthly run cost (${sel.toLowerCase()})`,
            value: compact(m.monthlyRunCost, cur),
            sub: selected === 'baseline' ? 'Steady-state month' : `Baseline ${compact(baseMetrics.monthlyRunCost, cur)}`,
            tone: selected !== 'baseline' && m.monthlyRunCost.gt(baseMetrics.monthlyRunCost) ? 'warn' : 'neutral',
          },
          {
            label: 'Cost per weighted ABU',
            value: unitPrice(m.costPerAbu, cur),
            sub: selected === 'baseline' ? `${unitPrice(m.costPerAcu, cur)} per ACU` : `Baseline ${unitPrice(baseMetrics.costPerAbu, cur)}`,
          },
          {
            label: 'Provider run-rate margin',
            value: pct(m.providerMarginPct),
            tone: m.providerMarginPct.lt(0) ? 'bad' : m.providerMarginPct.lt(15) ? 'warn' : 'good',
            sub: selected === 'baseline' ? `Full term ${pct(m.termMarginPct)}` : `Baseline ${pct(baseMetrics.providerMarginPct)}`,
          },
          {
            label: 'Customer ROI (full term)',
            value: pct(m.customerRoiPct, 0),
            tone: m.customerRoiPct.lt(0) ? 'bad' : 'neutral',
            sub: selected === 'baseline' ? `NPV ${compact(m.npv, cur)}` : `Baseline ${pct(baseMetrics.customerRoiPct, 0)}`,
          },
        ]}
      />

      <div className="grid gap-5 mt-5 xl:grid-cols-[340px_minmax(0,1fr)] items-start">
        <div className="xl:sticky xl:top-[76px] xl:max-h-[calc(100vh-92px)] xl:overflow-y-auto rounded-[10px]">
          <Controls
            r={r}
            value={selectedOverrides}
            onChange={change}
            onReset={() => {
              setCustom({});
              setLoadedName(null);
              setSelected('custom');
            }}
            baseGrowth={baseGrowth}
            baseMargin={baseMargin}
          />
        </div>
        <div className="space-y-5 min-w-0">
          <Comparison metrics={metrics} selected={selected} onSelect={setSelected} cur={cur} busyCustom={busyCustom} />
          {newIssues.length > 0 && (
            <Callout tone="warn" title={`Checks raised by the ${sel.toLowerCase()} scenario`}>
              <IssueList issues={newIssues} />
            </Callout>
          )}
          <ChartFrame
            title={`Change in monthly run cost: ${sel.toLowerCase()}`}
            description="Each step adds one group of drivers in turn, so the steps sum to the scenario total. Increases in red, savings in blue. Price, margin and growth changes do not move the steady-month cost."
            table={{
              columns: ['Step', 'Monthly run cost'],
              rows: waterfall.map((s) => [s.label, s.kind === 'delta' ? `${s.value >= 0 ? '+' : '−'}${money(Math.abs(s.value), cur, 0)}` : money(s.value, cur, 0)]),
            }}
            className={cx(selected === 'custom' && busyCustom && 'opacity-60')}
          >
            {hasDeltas ? (
              <Waterfall steps={waterfall} format={(v) => compact(v, cur)} height={300} />
            ) : (
              <p className="text-sm text-ink-3 px-2 py-14 text-center">
                {selected === 'baseline' ? 'Baseline has no changes. Pick Optimized or Stress, or move a driver, to see what drives the cost change.' : 'This scenario changes no cost drivers.'}
              </p>
            )}
          </ChartFrame>
        </div>
      </div>

      <SensitivityPanel r={r} catalog={catalog} />

      <SavedScenarios
        r={r}
        update={update}
        canSave={canSave}
        current={selectedOverrides}
        defaultName={selected === 'custom' ? (loadedName ?? 'Custom scenario') : SCENARIO_PRESETS[selected].name}
        onLoad={load}
      />
    </div>
  );
}
