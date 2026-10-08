import { useMemo } from 'react';
import { applyScenario, buildSnapshot, safeDiv, type ProjectResult, POOL_LABELS, RUN_POOLS } from '@aies/engine';
import { BarList, CompositionBar, POOL_COLOR } from '../../components/charts';
import { Badge, Panel, StatStrip, cx } from '../../components/ui';
import { compact, money, n, pct, tokens, unitPrice } from '../../lib/format';
import { PERIOD_LABEL, agentName, modelName, type Period, type Slice } from '../../lib/slice';
import { useStore } from '../../state/store';

export function ArchitectView({ r, slice, period }: { r: ProjectResult; slice: Slice; period: Period }) {
  const cur = r.currency;
  const { state } = useStore();
  const f = (v: number) => compact(v, cur);
  const perMonth = slice.months || 1;
  const tokensPerTxn = safeDiv(slice.inputTokens.plus(slice.outputTokens).plus(slice.reasoningTokens), slice.accepted);

  // Compare alternative LLMs: route every step to one model and re-run the cost model.
  const comparison = useMemo(() => {
    const base = r.baseline.llm.total;
    return state.catalog.modelRates
      .map((m) => {
        const p = applyScenario(r.project, { routingShift: { toModelId: m.id, sharePct: 100 } });
        const s = buildSnapshot(p, state.catalog, { rampFactor: 1, yearIndex: 0 });
        return { model: m, llm: s.llm.total, perAbu: safeDiv(s.totalRunCost, s.totals.weightedAbus), delta: s.llm.total.minus(base) };
      })
      .sort((a, b) => a.llm.cmp(b.llm));
  }, [r, state.catalog]);
  const current = new Set(r.baseline.llmLines.map((l) => l.modelId));

  const infra = r.baseline.costLines.filter((c) => c.category === 'INFRASTRUCTURE' || c.category === 'ORCHESTRATION' || c.category === 'RAG' || c.category === 'DOCUMENT');
  const steps = r.project.workflows.flatMap((w) => w.llmSteps.map((st) => ({ w, st })));

  return (
    <div className="space-y-5">
      <StatStrip
        items={[
          { label: `Run cost (${PERIOD_LABEL[period].toLowerCase()})`, value: compact(slice.runCost, cur), sub: slice.label },
          { label: 'LLM share of run cost', value: pct(safeDiv(slice.llmCost, slice.runCost).times(100)), sub: `${compact(slice.llmCost.div(perMonth), cur)} LLM per month` },
          { label: 'Tokens per accepted transaction', value: tokens(tokensPerTxn), sub: `${tokens(slice.llmCalls.div(perMonth))} model calls / month` },
          { label: 'LLM cost per accepted', value: unitPrice(safeDiv(slice.llmCost, slice.accepted), cur), sub: `Fully loaded ${unitPrice(safeDiv(slice.runCost, slice.accepted), cur)}` },
          { label: 'Cache-read share of input', value: pct(safeDiv(slice.cacheReadTokens, slice.inputTokens).times(100)), sub: 'Billed at the discounted read rate' },
        ]}
      />

      <div className="grid gap-5 xl:grid-cols-2">
        <Panel title="Architecture cost breakdown" description={`${slice.label}. Each pool is computed once and allocated, never double counted.`}>
          <CompositionBar parts={RUN_POOLS.map((p) => ({ key: p, label: POOL_LABELS[p], value: n(slice.pools[p]), color: POOL_COLOR[p] }))} format={f} />
        </Panel>
        <Panel title="Agent execution cost" description="Fully loaded run cost allocated by each agent's share of LLM consumption in its workflow.">
          <BarList
            items={Object.entries(slice.runByAgent)
              .sort((a, b) => b[1].cmp(a[1]))
              .map(([id, v]) => ({ label: agentName(r, id), value: n(v), sub: `LLM ${compact(slice.llmByAgent[id] ?? 0, cur)}` }))}
            format={f}
          />
        </Panel>
      </div>

      <Panel title="Model comparison" description="Monthly cost if every step were routed to one model (steady state). Quality, latency and context limits still need validation — this compares cost only." padded={false}>
        <div className="scroll-x">
          <table className="dtable min-w-[760px]">
            <thead>
              <tr>
                <th>Model</th>
                <th>Hosting</th>
                <th className="r">Input / output per 1M</th>
                <th className="r">LLM cost / month</th>
                <th className="r">vs current</th>
                <th className="r">Fully loaded per ABU</th>
              </tr>
            </thead>
            <tbody>
              {comparison.map(({ model: m, llm, perAbu, delta }) => (
                <tr key={m.id}>
                  <td>
                    <span className="font-semibold">{m.model}</span> {current.has(m.id) && <Badge tone="brand">in use</Badge>} {m.sample && <span className="text-[12px] text-ink-3">sample rate</span>}
                  </td>
                  <td className="text-ink-2 text-[13px]">{m.hostingPlatform}</td>
                  <td className="r text-[13px]">{m.pricingBasis === 'self_hosted' ? 'GPU-derived' : `${money(m.inputPerM, m.currency, 2)} / ${money(m.outputPerM, m.currency, 2)}`}</td>
                  <td className="r font-semibold">{compact(llm, cur)}</td>
                  <td className={cx('r', delta.gt(0) ? 'text-bad' : 'text-good')}>
                    {delta.gt(0) ? '+' : delta.lt(0) ? '−' : ''}
                    {compact(delta.abs(), cur)}
                  </td>
                  <td className="r">{unitPrice(perAbu, cur)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>

      <Panel title="Token estimates by step" description="Per-call tokens are before the complexity-mix multiplier; monthly figures are steady state including retries and partial failures." padded={false}>
        <div className="scroll-x">
          <table className="dtable min-w-[900px]">
            <thead>
              <tr>
                <th>Workflow / step</th>
                <th>Agent</th>
                <th>Models</th>
                <th className="r">Calls / exec</th>
                <th className="r">In / out / reasoning</th>
                <th className="r">Cache hit</th>
                <th className="r">Tokens / month</th>
                <th className="r">Cost / month</th>
              </tr>
            </thead>
            <tbody>
              {steps.map(({ w, st }) => {
                const lines = r.baseline.llmLines.filter((l) => l.workflowId === w.id && l.stepId === st.id);
                const tok = lines.reduce((a, l) => a + n(l.inputTokens) + n(l.outputTokens) + n(l.reasoningTokens), 0);
                const cost = lines.reduce((a, l) => a + n(l.cost), 0);
                const util = Math.max(0, ...lines.map((l) => n(l.contextUtilizationPct)));
                return (
                  <tr key={w.id + st.id}>
                    <td>
                      <div className="font-semibold">{st.name}</div>
                      <div className="text-[12.5px] text-ink-3">{w.name}</div>
                    </td>
                    <td className="text-[13px] text-ink-2">{agentName(r, st.agentId)}</td>
                    <td className="text-[13px] text-ink-2">{st.routing.map((x) => `${modelName(r, x.modelId)}${st.routing.length > 1 ? ` ${x.sharePct}%` : ''}`).join(', ')}</td>
                    <td className="r">{st.callsPerExecution}</td>
                    <td className="r text-[13px]">
                      {tokens(st.inputTokens)} / {tokens(st.outputTokens)} / {tokens(st.reasoningTokens)}
                      {util > 70 && <div className="text-warn text-[12px]">{pct(util, 0)} of context</div>}
                    </td>
                    <td className="r">{st.cacheablePrefixTokens > 0 ? pct(st.cacheHitRatePct, 0) : '—'}</td>
                    <td className="r">{tokens(tok)}</td>
                    <td className="r font-semibold">{compact(cost, cur)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Panel>

      <Panel title="Infrastructure and execution services" description="Fixed lines are capacity; usage lines scale with executions, transactions or LLM calls." padded={false}>
        <div className="scroll-x">
          <table className="dtable min-w-[760px]">
            <thead>
              <tr>
                <th>Component</th>
                <th>Category</th>
                <th>Basis</th>
                <th className="r">Units / month</th>
                <th className="r">Unit cost</th>
                <th className="r">Cost / month</th>
              </tr>
            </thead>
            <tbody>
              {infra.map((c) => (
                <tr key={c.lineId}>
                  <td className="font-semibold">{c.name}</td>
                  <td className="text-[13px] text-ink-2">{POOL_LABELS[c.category]}</td>
                  <td>
                    <Badge tone={c.variable ? 'brand' : 'neutral'}>{c.variable ? 'Usage' : 'Fixed'}</Badge>
                  </td>
                  <td className="r">{n(c.units) >= 1000 ? tokens(c.units) : n(c.units).toFixed(n(c.units) < 10 ? 2 : 0)}</td>
                  <td className="r text-[13px]">{unitPrice(c.unitCost, cur)}</td>
                  <td className="r font-semibold">{money(c.monthlyCost, cur, 0)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </div>
  );
}
