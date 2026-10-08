import { D, findWeightSet, safeDiv, tieredCharge, weightedAcuBreakdown, type Decimal } from '@aies/engine';
import type { ReportSection } from '../types';
import { decimal, humanize, pct } from '../format';
import { poolLabel } from '../util';
import { chart, kpi, poolList, section, steadyStreamRevenue, streamOf, table, type Ctx } from './common';

export function acuRateCard(x: Ctx): ReportSection[] {
  const { r, catalog } = x;
  const p = r.project;
  const b = r.baseline;
  const acu = p.acu;
  const ws = findWeightSet(catalog, acu.weightSetId);
  const s = streamOf(x, 'acu');
  const rc = p.pricing.acuRateCard;
  const out: ReportSection[] = [];
  const method = acu.method === 'cost_normalized' ? 'A — cost-normalised' : 'B — weighted resource';

  out.push(
    section('ACU definition', {
      paragraphs: [
        'The AI Consumption Unit (ACU) is a commercial measurement unit for AI work, not an industry standard. Measurement is kept separate from price: the ACU count measures consumption, and the price per ACU recovers cost plus margin.',
        acu.method === 'cost_normalized'
          ? `Method A (selected): 1 ACU = ${x.u(acu.referenceValue)} ${acu.referenceCurrency !== x.cur ? `(${acu.referenceCurrency})` : ''} of eligible AI consumption cost at base-year reference prices, so ACU counts track consumption rather than supplier price movements. Eligible pools: ${poolList(acu.eligiblePools.filter((pl) => pl !== 'IMPLEMENTATION'))}.`
          : `Method B (selected): ACUs = Σ resource usage × weight, using weight set "${ws?.name ?? acu.weightSetId}" version ${ws?.version ?? 'n/a'} (${ws?.status ?? 'missing'}, effective ${ws?.effectiveDate ?? 'n/a'}). Weights are model-agnostic, so ACU counts stay stable when traffic is re-routed between models.`,
        `Both methods are computed side by side for transparency: Method A gives ${x.k(b.acu.methodA)} ACUs and Method B gives ${x.k(b.acu.methodB)} ACUs a month at steady state.`,
      ],
      kpis: [
        kpi('Measurement method', method),
        kpi('ACUs per month', x.k(b.acu.total), 'Steady state'),
        kpi('Eligible AI cost per month', x.c(b.acu.eligibleCost)),
        kpi('ACUs per attempted transaction', decimal(b.acu.perAttempted, 2)),
        kpi('ACUs per accepted ABU', decimal(b.acu.perAcceptedAbu, 2)),
      ],
    }),
  );

  // Eligible components
  const elig = new Set(acu.eligiblePools);
  out.push(
    section('Eligible cost components', {
      paragraphs: ['Method A counts only eligible AI consumption pools. Fixed platform, AgentOps and human review costs are recovered by other streams unless listed as eligible.'],
      table: table(
        ['Cost pool', 'Steady monthly cost', 'At base-year prices', 'Eligible for ACU'],
        (['LLM', 'ORCHESTRATION', 'RAG', 'DOCUMENT', 'INFRASTRUCTURE', 'AGENTOPS', 'HUMAN_REVIEW', 'OTHER'] as const).map((pl) => [
          poolLabel(pl),
          x.m(b.pools[pl]),
          x.m(b.poolsAtBasePrices[pl]),
          elig.has(pl) ? 'Yes' : 'No',
        ]),
        { align: ['left', 'right', 'right', 'left'], footer: ['Eligible total (nominal)', x.m(b.acu.eligibleCost), '', ''] },
      ),
    }),
  );

  // Method B breakdown
  const breakdown = weightedAcuBreakdown(b.resources, ws).filter((row) => !row.units.isZero() || !row.weight.isZero());
  out.push(
    section('Resource consumption and Method B weights', {
      paragraphs: [ws ? `Weight set ${ws.name} v${ws.version} — ${ws.rationale}` : 'No weight set is configured; Method B is zero.'],
      table: table(
        ['Resource', 'Unit', 'Monthly units', 'Weight (ACU per unit)', 'ACUs'],
        breakdown.map((row) => [row.label, row.unit, decimal(row.units, 2), decimal(row.weight, 2), x.k(row.acus)]),
        { align: ['left', 'left', 'right', 'right', 'right'], footer: ['Method B total', '', '', '', x.k(b.acu.methodB)] },
      ),
    }),
  );

  // ACUs per workflow / agent
  const wfRows = p.workflows.map((w) => {
    const v = b.volumes[w.id];
    const a = b.acu.byWorkflow[w.id] ?? D(0);
    return [w.name, x.k(a), decimal(safeDiv(a, v.attempted), 2), decimal(safeDiv(a, v.accepted), 2), decimal(safeDiv(a, v.weightedAbus), 2)];
  });
  out.push(
    section('ACUs by workflow and agent', {
      table: table(['Workflow', 'ACUs per month', 'Per attempted', 'Per accepted', 'Per weighted ABU'], wfRows, {
        footer: ['Total', x.k(b.acu.total), decimal(b.acu.perAttempted, 2), decimal(safeDiv(b.acu.total, b.totals.accepted), 2), decimal(b.acu.perAcceptedAbu, 2)],
      }),
      chart: chart(
        'bar',
        'ACUs per month by agent',
        Object.keys(b.acu.byAgent).map((a) => x.nm.agent(a)),
        [{ name: 'ACUs', values: Object.values(b.acu.byAgent) }],
        'number',
      ),
    }),
  );

  // Cost & price per ACU
  if (s) {
    const unitCost = s.unitCost ?? D(0);
    const price = s.unitPrice ?? D(0);
    const margin = price.isZero() ? D(0) : price.minus(unitCost).div(price).times(100);
    out.push(
      section('Cost, price and margin per ACU', {
        paragraphs: [
          `The "${s.label}" stream recovers ${poolList(s.recovers)}. Recovered cost of ${x.m(s.recoveredCost)} a month over ${x.k(b.acu.total)} ACUs gives a cost of ${x.u(unitCost)} per ACU; at a ${pct(s.targetMarginPct)} target margin the list price is ${x.u(s.listUnitPrice ?? 0)}.`,
          s.overridden ? `A negotiated price override of ${x.u(price)} applies.` : s.floorApplied ? `The price was raised to the ${pct(rc.marginFloorPct)} margin floor.` : `No override or floor adjustment applies; the price per ACU is ${x.u(price)}.`,
        ],
        kpis: [
          kpi('Cost per ACU', x.u(unitCost)),
          kpi('Price per ACU', x.u(price)),
          kpi('Unit margin', pct(margin)),
          kpi('Margin floor price', x.u(s.floorPrice ?? 0), `${pct(rc.marginFloorPct)} floor`),
          kpi('Steady ACU revenue', x.c(steadyStreamRevenue(x, s.streamId)), 'Per month'),
        ],
      }),
    );
  } else {
    out.push(
      section('Cost and price per ACU', {
        paragraphs: [
          `This commercial model has no ACU stream, so ACUs are measured for transparency and FinOps only. At steady state the full run cost is ${x.u(safeDiv(b.totalRunCost, b.acu.total))} per ACU and the marginal cost is ${x.u(r.marginal.perAcu)} per ACU.`,
        ],
        kpis: [kpi('Run cost per ACU', x.u(safeDiv(b.totalRunCost, b.acu.total))), kpi('Marginal cost per ACU', x.u(r.marginal.perAcu))],
      }),
    );
  }

  // Tiers & commitments
  const sub = streamOf(x, 'subscription')?.subscription;
  const tierRows = rc.tiers.length
    ? [...rc.tiers]
        .sort((a, c) => a.fromUnits - c.fromUnits)
        .map((t) => [`Above ${x.k(t.fromUnits)} ACUs`, pct(t.discountPct), s ? x.u(bandPrice(s.unitPrice ?? D(0), t.discountPct, s.floorPrice ?? D(0))) : 'n/a'])
    : [['No volume tiers', '—', s ? x.u(s.unitPrice ?? 0) : 'n/a']];
  out.push(
    section('Volume tiers, commitments and allowances', {
      paragraphs: [
        `Tier mode: ${rc.tierMode === 'graduated' ? 'graduated — each band is priced at its own discount' : 'all units — every unit is priced at the highest band reached'}. Tier prices never fall below the margin floor.`,
        `Minimum monthly commitment: ${rc.minMonthlyCommitment ? x.m(rc.minMonthlyCommitment) : 'none'}; any shortfall is billed as a true-up.`,
        sub && sub.includedUnit === 'acu'
          ? `The subscription includes ${x.k(sub.includedQty)} ACUs a month valued at ${x.m(sub.includedValue)} (${pct(p.pricing.subscription.includedDiscountPct)} allowance discount). Overage is billed at ${x.u(sub.overageRate)} per ACU (${pct(p.pricing.subscription.overagePremiumPct)} premium).`
          : 'No ACU allowance is bundled into a subscription.',
      ],
      table: table(['Band', 'Discount', 'Price per ACU (year 1)'], tierRows),
    }),
  );

  // Rate card versions
  const versions = p.pricing.rateCardVersions;
  out.push(
    section('Rate-card versions', {
      paragraphs: versions.length ? [] : ['No rate-card version has been saved yet; the prices above are the current derived values. Save a version to lock them for contracting.'],
      table: versions.length
        ? table(
            ['Version', 'Status', 'Created', 'Author', 'ACU price', 'Note'],
            versions.map((v) => [v.version, humanize(v.status), v.createdAt.slice(0, 10), v.author, v.acuPrice ? x.u(Number(v.acuPrice)) : '—', v.note]),
            { align: ['left', 'left', 'left', 'left', 'right', 'left'] },
          )
        : undefined,
    }),
  );
  return out;
}

/** Year-1 price of one unit in a tier band — evaluated with the engine's tier function. */
export function bandPrice(price: Decimal, discountPct: number, floor: Decimal): Decimal {
  return tieredCharge(D(1), price, [{ fromUnits: 0, discountPct }], 'all_units', floor);
}
