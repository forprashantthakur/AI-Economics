import { D, RUN_POOLS, safeDiv, sum, type CostPool } from '@aies/engine';
import type { ReportSection } from '../types';
import { decimal, humanize, pct } from '../format';
import { poolLabel } from '../util';
import { bandPrice } from './acu';
import { chart, kpi, poolList, section, steadyStreamRevenue, streamOf, table, type Ctx } from './common';

export function abuPricing(x: Ctx): ReportSection[] {
  const { r } = x;
  const p = r.project;
  const b = r.baseline;
  const s = streamOf(x, 'abu');
  const rc = p.pricing.abuRateCard;
  const out: ReportSection[] = [];

  out.push(
    section('ABU definitions and acceptance criteria', {
      paragraphs: [
        'An AI Business Unit (ABU) is one accepted business outcome. Only accepted transactions earn ABUs; retries are additional executions, never additional ABUs, and failed or rejected work earns nothing. Complexity classes weight each accepted transaction.',
        ...p.workflows.map((w) => `${w.name} — one ${w.abuName}: ${w.abuDefinition} Acceptance criteria: ${w.acceptanceCriteria.length ? w.acceptanceCriteria.join('; ') : 'to be agreed'}.`),
      ],
      kpis: [
        kpi('Weighted ABUs per month', x.k(b.totals.weightedAbus), 'Steady state'),
        kpi('Accepted transactions', x.k(b.totals.accepted)),
        kpi('Cost per weighted ABU', x.u(r.economics.provider.costToServePerAbu), 'All run pools'),
        ...(s?.abu ? [kpi('Blended price per ABU', x.u(s.abu.blendedPrice))] : []),
      ],
    }),
  );

  // Funnel
  const fRows: [string, (id: string) => string][] = [
    ['Attempted transactions', (id) => x.k(b.volumes[id].attempted)],
    ['Completed', (id) => x.k(b.volumes[id].completed)],
    ['Accepted', (id) => x.k(b.volumes[id].accepted)],
    ['Rejected', (id) => x.k(b.volumes[id].rejected)],
    ['Failed', (id) => x.k(b.volumes[id].failed)],
    ['Retries (extra executions)', (id) => x.k(b.volumes[id].retries)],
    ['Total executions', (id) => x.k(b.volumes[id].executions)],
    ['Execution equivalents (consumption)', (id) => x.k(b.volumes[id].executionEquivalents)],
    ['Human-assisted', (id) => x.k(b.volumes[id].humanAssisted)],
    ['Autonomous', (id) => x.k(b.volumes[id].autonomous)],
    ['Weighted ABUs', (id) => x.k(b.volumes[id].weightedAbus)],
  ];
  const ids = p.workflows.map((w) => w.id);
  out.push(
    section('Transaction funnel (steady-state month)', {
      paragraphs: [
        `Accepted + rejected + failed reconciles to attempted. Failed executions consume a share of a full execution (configured per workflow) and retries consume a share of a full execution; both drive cost but never ABUs.`,
      ],
      table: table(
        ['Stage', ...p.workflows.map((w) => w.name), ...(ids.length > 1 ? ['Total'] : [])],
        fRows.map(([label, f]) => {
          const vals = ids.map((id) => f(id));
          if (ids.length > 1) {
            const key = label;
            const tot = sum(
              ids.map((id) => {
                const v = b.volumes[id];
                switch (key) {
                  case 'Attempted transactions':
                    return v.attempted;
                  case 'Completed':
                    return v.completed;
                  case 'Accepted':
                    return v.accepted;
                  case 'Rejected':
                    return v.rejected;
                  case 'Failed':
                    return v.failed;
                  case 'Retries (extra executions)':
                    return v.retries;
                  case 'Total executions':
                    return v.executions;
                  case 'Execution equivalents (consumption)':
                    return v.executionEquivalents;
                  case 'Human-assisted':
                    return v.humanAssisted;
                  case 'Autonomous':
                    return v.autonomous;
                  default:
                    return v.weightedAbus;
                }
              }),
            );
            vals.push(x.k(tot));
          }
          return [label, ...vals];
        }),
      ),
      chart: chart(
        'stacked-bar',
        'Outcome of attempted transactions',
        p.workflows.map((w) => w.name),
        [
          { name: 'Autonomous', values: ids.map((id) => b.volumes[id].autonomous) },
          { name: 'Human-assisted', values: ids.map((id) => b.volumes[id].humanAssisted) },
          { name: 'Rejected', values: ids.map((id) => b.volumes[id].rejected) },
          { name: 'Failed', values: ids.map((id) => b.volumes[id].failed) },
        ],
        'number',
      ),
    }),
  );

  // Complexity classes
  const classRows: string[][] = [];
  for (const w of p.workflows) {
    const v = b.volumes[w.id];
    const shareTotal = w.complexity.reduce((a, c) => a + c.sharePct, 0) || 1;
    for (const c of v.byClass) {
      const cfg = w.complexity.find((k) => k.id === c.classId);
      classRows.push([
        w.name,
        c.name,
        cfg ? pct((cfg.sharePct / shareTotal) * 100) : '100.0%',
        decimal(c.abuWeight, 2),
        cfg ? decimal(cfg.consumptionMultiplier, 2) : '1.00',
        cfg ? decimal(cfg.humanEffortMultiplier, 2) : '1.00',
        x.k(c.accepted),
        x.k(c.weightedAbus),
      ]);
    }
  }
  out.push(
    section('Complexity classes and ABU weights', {
      table: table(['Workflow', 'Class', 'Mix', 'ABU weight', 'Consumption ×', 'Human effort ×', 'Accepted', 'Weighted ABUs'], classRows, {
        align: ['left', 'left', 'right', 'right', 'right', 'right', 'right', 'right'],
        footer: ['Total', '', '', '', '', '', x.k(b.totals.accepted), x.k(b.totals.weightedAbus)],
      }),
    }),
  );

  // Cost per ABU build-up by pool
  const pools = RUN_POOLS.filter((pl) => !b.pools[pl].isZero());
  const recovered = new Set<CostPool>(s ? s.recovers : []);
  out.push(
    section('Cost per ABU build-up by cost pool', {
      paragraphs: [
        s
          ? `The "${s.label}" stream recovers ${poolList(s.recovers)}; other pools are recovered by other streams and are shown for completeness.`
          : 'This commercial model has no ABU stream; the build-up shows the full cost to serve per weighted ABU.',
      ],
      table: table(
        ['Cost pool', 'Monthly cost', 'Per weighted ABU', 'Recovered by ABU price', 'Of which failed / rejected work'],
        pools.map((pl) => [poolLabel(pl), x.m(b.pools[pl]), x.u(safeDiv(b.pools[pl], b.totals.weightedAbus)), recovered.has(pl) ? 'Yes' : 'No', x.m(b.failureCostByPool[pl])]),
        {
          align: ['left', 'right', 'right', 'left', 'right'],
          footer: ['Total', x.m(b.totalRunCost), x.u(safeDiv(b.totalRunCost, b.totals.weightedAbus)), '', x.m(sum(pools.map((pl) => b.failureCostByPool[pl])))],
        },
      ),
      chart: chart('bar', 'Cost per weighted ABU by pool', pools.map(poolLabel), [{ name: 'Per ABU', values: pools.map((pl) => safeDiv(b.pools[pl], b.totals.weightedAbus)) }], 'currency'),
    }),
  );

  // Failed-cost allocation
  const failTotal = sum(Object.values(b.failureCostByWorkflow));
  out.push(
    section('Failed and rejected work', {
      paragraphs: [
        `Work that does not produce an accepted outcome — failed executions, partial retries and rework of rejected outputs — costs ${x.m(failTotal)} a month (${pct(safeDiv(failTotal, b.totalRunCost).times(100))} of run cost).`,
        rc.failedCostAllocation === 'spread'
          ? 'Allocation policy: spread — this cost is included in the cost per accepted ABU, so the client pays for it through the ABU price.'
          : 'Allocation policy: provider absorbs — this cost is excluded from the ABU price build-up and reduces provider margin, giving the provider an incentive to raise first-pass success.',
      ],
      table: table(
        ['Workflow', 'Run cost', 'Failed / rejected work cost', 'Share'],
        p.workflows.map((w) => [w.name, x.m(b.runCostByWorkflow[w.id] ?? 0), x.m(b.failureCostByWorkflow[w.id] ?? 0), pct(safeDiv(b.failureCostByWorkflow[w.id] ?? 0, b.runCostByWorkflow[w.id] ?? 0).times(100))]),
      ),
    }),
  );

  // Prices
  if (s?.abu) {
    const rows: string[][] = [];
    for (const w of p.workflows) {
      const wp = s.abu.byWorkflow[w.id];
      if (!wp) continue;
      rows.push([w.name, x.m(wp.recoveredCost), x.k(wp.weightedAbus), x.u(wp.costPerAbu), x.u(wp.listPrice), x.u(wp.price), wp.overridden ? 'Override' : wp.floorApplied ? 'Floor' : 'Derived']);
    }
    out.push(
      section('Price per weighted ABU', {
        paragraphs: [
          `Price = recovered cost per weighted ABU ÷ (1 − ${pct(s.targetMarginPct)} target margin). Human-assisted completions are priced at ${decimal(rc.humanAssistedPriceFactor, 2)}× the autonomous price. Steady-state ABU revenue is ${x.m(steadyStreamRevenue(x, s.streamId))} a month.`,
        ],
        table: table(['Workflow', 'Recovered cost', 'Weighted ABUs', 'Cost per ABU', 'List price', 'Price', 'Basis'], rows, {
          align: ['left', 'right', 'right', 'right', 'right', 'right', 'left'],
          footer: ['Blended', x.m(s.recoveredCost), x.k(b.totals.weightedAbus), x.u(s.unitCost ?? 0), '', x.u(s.abu.blendedPrice), ''],
        }),
      }),
    );
    const cRows: string[][] = [];
    for (const w of p.workflows) {
      const wp = s.abu.byWorkflow[w.id];
      if (!wp) continue;
      for (const cp of wp.classPrices) cRows.push([w.name, cp.name, decimal(cp.weight, 2), x.u(cp.price), x.u(cp.assistedPrice)]);
    }
    out.push(
      section('Prices by complexity class', {
        paragraphs: [`Class pricing: ${rc.classPricing === 'weighted' ? 'weighted — each class pays the ABU price × its weight' : 'customer-specific class overrides where set'}.`],
        table: table(['Workflow', 'Class', 'ABU weight', 'Price per transaction', 'Human-assisted price'], cRows, { align: ['left', 'left', 'right', 'right', 'right'] }),
      }),
    );
  }

  // Tiers, minimums
  const sub = streamOf(x, 'subscription')?.subscription;
  const tierRows = rc.tiers.length
    ? [...rc.tiers]
        .sort((a, c) => a.fromUnits - c.fromUnits)
        .map((t) => [`Above ${x.k(t.fromUnits)} weighted ABUs`, pct(t.discountPct), s?.abu ? x.u(bandPrice(s.abu.blendedPrice, t.discountPct, D(0))) : 'n/a'])
    : [['No volume tiers', '—', s?.abu ? x.u(s.abu.blendedPrice) : 'n/a']];
  out.push(
    section('Volume tiers and minimums', {
      paragraphs: [
        `Tier mode: ${rc.tierMode === 'graduated' ? 'graduated (each band at its own discount on the blended price)' : 'all units (every ABU at the highest band reached)'}.`,
        `Minimum monthly volume: ${rc.minMonthlyAbus ? `${x.k(rc.minMonthlyAbus)} weighted ABUs; any shortfall is billed at the blended price${s?.abu ? ` (${x.u(s.abu.blendedPrice)})` : ''}.` : 'none.'}`,
        sub && sub.includedUnit === 'abu'
          ? `The subscription includes ${x.k(sub.includedQty)} weighted ABUs a month valued at ${x.m(sub.includedValue)}; overage is billed at ${x.u(sub.overageRate)} per ABU (${pct(p.pricing.subscription.overagePremiumPct)} premium).`
          : 'No ABU allowance is bundled into a subscription.',
        `Margin floor: ${pct(rc.marginFloorPct)}. ${humanize(rc.failedCostAllocation)} failed-cost policy.`,
      ],
      table: table(['Band', 'Discount', 'Blended price per ABU (year 1)'], tierRows),
    }),
  );
  return out;
}
