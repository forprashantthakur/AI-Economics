/**
 * Response shapes. The full ProjectResult is ~1 MB of JSON per project, so
 * the compute endpoint returns a summary that covers every dashboard figure.
 * Decimals serialise as strings via Decimal.toJSON (no precision loss).
 */
import { safeDiv, type Catalog, type ProjectResult, type RateCardVersion } from '@aies/engine';

export function computeSummary(r: ProjectResult, catalog: Catalog) {
  const b = r.baseline;
  const impl = r.implementation;
  const acuStream = r.priceBook.streams.find((s) => s.type === 'acu');
  const abuStream = r.priceBook.streams.find((s) => s.type === 'abu');

  return {
    projectId: r.project.id,
    projectName: r.project.name,
    currency: r.currency,
    catalogVersion: catalog.version,
    computedAt: new Date().toISOString(),

    implementation: {
      laborHours: impl.laborHours,
      laborCost: impl.laborCost,
      directExpenses: impl.directExpenses,
      billableExpenses: impl.billableExpenses,
      contingency: impl.contingency,
      totalCost: impl.totalCost,
      tmValue: impl.tmValue,
      cpmPrice: impl.cpmPrice,
      price: impl.price,
      grossProfit: impl.grossProfit,
      marginPct: impl.marginPct,
      durationWeeks: impl.durationWeeks,
      activityCount: impl.activities.length,
      criticalPath: impl.activities.filter((a) => a.critical).map((a) => a.id),
      costByPhase: impl.costByPhase,
      costByRole: impl.costByRole,
      hoursByRole: impl.hoursByRole,
      scheduleErrors: impl.scheduleErrors,
    },

    baseline: {
      rampFactor: b.rampFactor,
      yearIndex: b.yearIndex,
      totals: b.totals,
      totalRunCost: b.totalRunCost,
      pools: b.pools,
      runCostByWorkflow: b.runCostByWorkflow,
      runCostByAgent: b.runCostByAgent,
      runCostByFunction: b.runCostByFunction,
      failureCostByWorkflow: b.failureCostByWorkflow,
      failureCostByPool: b.failureCostByPool,
      humanReviewByWorkflow: b.humanReviewByWorkflow,
      llm: b.llm,
      workflows: r.project.workflows.map((wf) => {
        const v = b.volumes[wf.id];
        return {
          workflowId: wf.id,
          name: wf.name,
          abuName: wf.abuName,
          attempted: v.attempted,
          retries: v.retries,
          executions: v.executions,
          completed: v.completed,
          failed: v.failed,
          accepted: v.accepted,
          rejected: v.rejected,
          humanAssisted: v.humanAssisted,
          autonomous: v.autonomous,
          weightedAbus: v.weightedAbus,
          llmCalls: v.llmCalls,
          toolCalls: v.toolCalls,
          runCost: b.runCostByWorkflow[wf.id],
          llmCost: b.llm.byWorkflow[wf.id],
          pools: b.poolsByWorkflow[wf.id],
          acus: b.acu.byWorkflow[wf.id],
          costPerAcceptedTxn: safeDiv(b.runCostByWorkflow[wf.id], v.accepted),
          costPerAbu: safeDiv(b.runCostByWorkflow[wf.id], v.weightedAbus),
          byClass: v.byClass,
        };
      }),
      costLines: b.costLines.map((c) => ({ lineId: c.lineId, name: c.name, category: c.category, basis: c.basis, units: c.units, unitCost: c.unitCost, monthlyCost: c.monthlyCost })),
      warnings: b.warnings,
    },

    acu: {
      method: b.acu.method,
      total: b.acu.total,
      methodA: b.acu.methodA,
      methodB: b.acu.methodB,
      byWorkflow: b.acu.byWorkflow,
      byAgent: b.acu.byAgent,
      eligibleCost: b.acu.eligibleCost,
      perAttempted: b.acu.perAttempted,
      perAcceptedAbu: b.acu.perAcceptedAbu,
      costPerAcu: safeDiv(b.totalRunCost, b.acu.total),
      eligibleCostPerAcu: safeDiv(b.acu.eligibleCost, b.acu.total),
      marginalCost: r.marginal.perAcu,
      price: acuStream?.unitPrice ?? null,
    },

    abu: {
      accepted: b.totals.accepted,
      weightedAbus: b.totals.weightedAbus,
      costPerAbu: safeDiv(b.totalRunCost, b.totals.weightedAbus),
      costPerAcceptedTxn: safeDiv(b.totalRunCost, b.totals.accepted),
      marginalCost: r.marginal.perAbu,
      blendedPrice: abuStream?.abu?.blendedPrice ?? null,
      byWorkflow: abuStream?.abu?.byWorkflow ?? null,
    },

    priceBook: {
      streams: r.priceBook.streams,
      recovery: r.priceBook.recovery,
      issues: r.priceBook.issues,
      priceMultiplier: r.priceBook.priceMultiplier,
      termMonths: r.priceBook.termMonths,
      passThroughMarkupPct: r.priceBook.passThroughMarkupPct,
      escalationPct: r.priceBook.escalationPct,
    },

    steady: {
      revenue: r.steady.revenue,
      recurringRevenue: r.steady.recurringRevenue,
      runCost: r.steady.runCost,
      grossProfit: r.steady.grossProfit,
      marginPct: r.steady.marginPct,
      revenueLines: r.steady.revenueLines,
      revenueByStream: r.steady.revenueByStream,
      costByStream: r.steady.costByStream,
      value: {
        validated: r.steady.value.validated,
        forecast: r.steady.value.forecast,
        productivityValue: r.steady.value.productivityValue,
        hoursSaved: r.steady.value.hoursSaved,
        fteReleased: r.steady.value.fteReleased,
        validatedByCategory: r.steady.value.validatedByCategory,
        forecastByCategory: r.steady.value.forecastByCategory,
        lines: r.steady.value.lines,
      },
    },

    years: r.years,

    /** Compact monthly series for charts (month 0 = implementation). */
    months: r.months.map((m) => ({
      month: m.month,
      period: m.period,
      yearIndex: m.yearIndex,
      rampFactor: m.rampFactor,
      attempted: m.attempted,
      accepted: m.accepted,
      weightedAbus: m.weightedAbus,
      acus: m.acus,
      llmCost: m.llmCost,
      runCost: m.runCost,
      implementationCost: m.implementationCost,
      totalCost: m.totalCost,
      revenue: m.revenue,
      recurringRevenue: m.recurringRevenue,
      grossProfit: m.grossProfit,
      validatedBenefit: m.validatedBenefit,
      forecastBenefit: m.forecastBenefit,
      countedBenefit: m.countedBenefit,
      clientInvestment: m.clientInvestment,
      clientNet: m.clientNet,
      clientCumulative: m.clientCumulative,
    })),

    economics: r.economics,

    packages: r.packages.map((p) => ({
      id: p.id,
      name: p.name,
      short: p.short,
      description: p.description,
      economics: p.economics,
      steady: { revenue: p.steady.revenue, runCost: p.steady.runCost, grossProfit: p.steady.grossProfit, marginPct: p.steady.marginPct },
      issueCount: p.issues.length,
    })),

    issues: r.issues,
    reconciliation: r.reconciliation,
    reconciliationPassed: r.reconciliation.every((c) => c.pass),
  };
}

export type ComputeSummary = ReturnType<typeof computeSummary>;

/** Snapshot of the derived prices of a computed project, in the engine RateCardVersion shape. */
export function rateCardSnapshot(r: ProjectResult, meta: { id: string; version: number; author: string; note: string; createdAt: string }): RateCardVersion & Record<string, unknown> {
  const acu = r.priceBook.streams.find((s) => s.type === 'acu');
  const abu = r.priceBook.streams.find((s) => s.type === 'abu');
  const sub = r.priceBook.streams.find((s) => s.type === 'subscription');
  const ops = r.priceBook.streams.find((s) => s.type === 'agentops');
  const abuPrices: Record<string, string> = {};
  for (const [wfId, p] of Object.entries(abu?.abu?.byWorkflow ?? {})) abuPrices[wfId] = p.price.toString();
  return {
    id: meta.id,
    version: String(meta.version),
    createdAt: meta.createdAt,
    author: meta.author,
    status: 'draft',
    note: meta.note,
    acuPrice: acu?.unitPrice ? acu.unitPrice.toString() : null,
    abuPrices,
    subscriptionFee: sub?.subscription ? sub.subscription.totalFee.toString() : null,
    agentOpsFee: ops?.monthlyFee ? ops.monthlyFee.toString() : null,
    currency: r.currency,
    blendedAbuPrice: abu?.abu ? abu.abu.blendedPrice.toString() : null,
    streams: r.priceBook.streams.map((s) => ({
      streamId: s.streamId,
      type: s.type,
      label: s.label,
      recovers: s.recovers,
      targetMarginPct: s.targetMarginPct,
      recoveredCost: s.recoveredCost.toString(),
      oneTimeFee: s.oneTimeFee?.toString() ?? null,
      monthlyFee: s.monthlyFee?.toString() ?? null,
      unitCost: s.unitCost?.toString() ?? null,
      unitPrice: s.unitPrice?.toString() ?? null,
      floorPrice: s.floorPrice?.toString() ?? null,
      floorApplied: s.floorApplied ?? false,
      overridden: s.overridden ?? false,
      abuClassPrices: s.abu
        ? Object.fromEntries(Object.entries(s.abu.byWorkflow).map(([wf, p]) => [wf, p.classPrices.map((c) => ({ classId: c.classId, name: c.name, price: c.price.toString(), assistedPrice: c.assistedPrice.toString() }))]))
        : undefined,
    })),
    steadyMarginPct: r.steady.marginPct.toString(),
    tcv: r.economics.provider.tcv.toString(),
  };
}
