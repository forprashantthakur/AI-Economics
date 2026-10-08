import { describe, expect, it } from 'vitest';
import { num } from '@aies/engine';
import { REPORTS, reportFileName, reportModel, type ReportId, type ReportModel } from '../src';
import { compact, count, grouped, money, pct, unitPrice } from '../src/format';
import { samples } from './helpers';

const { catalog, samples: S } = samples();
const NOW = new Date('2026-10-08T10:00:00Z');

const kpi = (m: ReportModel, label: string): string | undefined => m.sections.flatMap((s) => s.kpis ?? []).find((k) => k.label === label)?.value;
const allText = (m: ReportModel): string =>
  m.sections
    .flatMap((s) => [s.heading, ...(s.paragraphs ?? []), ...(s.kpis ?? []).flatMap((k) => [k.label, k.value, k.note ?? '']), ...(s.table ? [...s.table.columns, ...s.table.rows.flat(), ...(s.table.footer ?? [])] : [])])
    .join('\n');

describe('formatting', () => {
  it('uses Indian grouping and lakh / crore compact forms for INR', () => {
    expect(money(1858811.4, 'INR')).toBe('₹18,58,811');
    expect(money(-123456789, 'INR')).toBe('−₹12,34,56,789');
    expect(compact(1513811.4, 'INR')).toBe('₹15.1 L');
    expect(compact(21862500, 'INR')).toBe('₹2.19 Cr');
    expect(compact(345276, 'INR')).toBe('₹3.45 L');
    expect(count(106591, 'INR')).toBe('1,06,591');
    expect(unitPrice(37.840342, 'INR')).toBe('₹37.84');
    expect(unitPrice(0.0362, 'INR')).toBe('₹0.0362');
    expect(unitPrice(0.0062, 'INR')).toBe('₹0.006200');
  });
  it('uses western grouping and K / M / B for other currencies', () => {
    expect(money(1234567.891, 'USD')).toBe('$1,234,568');
    expect(compact(2_190_000, 'USD')).toBe('$2.19M');
    expect(grouped(1234567.5, 1)).toBe('1,234,567.5');
    expect(pct(-38.44)).toBe('−38.4%');
  });
});

describe('reportModel', () => {
  it('lists the eight reports with the agreed titles', () => {
    expect(REPORTS.map((r) => r.title)).toEqual([
      'AI Project Cost Estimate',
      'ACU Consumption & Rate Card',
      'ABU Business Transaction Pricing',
      'Commercial Proposal Summary',
      'AI FinOps Assessment',
      'AI Value Realization Business Case',
      'Three-Year Financial Projection',
      'Executive Management Dashboard Report',
    ]);
  });

  for (const s of S) {
    describe(s.result.project.name, () => {
      const r = s.result;
      const cur = r.currency;
      const models = Object.fromEntries(REPORTS.map((rep) => [rep.id, reportModel(r, catalog, rep.id, { now: NOW, generatedBy: 'Tester' })])) as Record<ReportId, ReportModel>;

      it('builds every report with sections, a disclaimer and metadata', () => {
        for (const rep of REPORTS) {
          const m = models[rep.id];
          expect(m.title).toBe(rep.title);
          expect(m.projectName).toBe(r.project.name);
          expect(m.clientName).toBe(r.project.client.clientName);
          expect(m.currency).toBe(cur);
          expect(m.generatedAt).toBe(NOW.toISOString());
          expect(m.generatedBy).toBe('Tester');
          expect(m.sections.length).toBeGreaterThan(1);
          expect(m.disclaimer).toMatch(/illustrative samples/);
          for (const sec of m.sections) {
            if (sec.table) for (const row of sec.table.rows) expect(row.length).toBe(sec.table.columns.length);
            if (sec.table?.footer) expect(sec.table.footer.length).toBe(sec.table.columns.length);
            if (sec.table?.align) expect(sec.table.align.length).toBe(sec.table.columns.length);
            if (sec.chart) for (const se of sec.chart.series) {
              expect(se.values.length).toBe(sec.chart.categories.length);
              for (const v of se.values) expect(Number.isFinite(v)).toBe(true);
            }
          }
          expect(allText(m)).not.toMatch(/NaN|Infinity|undefined|\[object/);
          expect(allText(m)).not.toMatch(/Deloitte/i);
        }
      });

      it('cost estimate shows engine implementation and run-cost figures', () => {
        const m = models['cost-estimate'];
        expect(kpi(m, 'Implementation cost')).toBe(compact(r.implementation.totalCost, cur));
        expect(kpi(m, 'Implementation price')).toBe(compact(r.implementation.price, cur));
        expect(kpi(m, 'Monthly run cost')).toBe(compact(r.baseline.totalRunCost, cur));
        expect(kpi(m, 'Cost per accepted ABU')).toBe(unitPrice(r.economics.provider.costToServePerAbu, cur));
        const build = m.sections.find((x) => x.heading.startsWith('Implementation price'))!.table!;
        expect(build.rows.find((row) => row[0] === 'Quoted price')![1]).toBe(money(r.implementation.price, cur));
        expect(build.rows.find((row) => row[0] === 'Implementation cost')![1]).toBe(money(r.implementation.totalCost, cur));
      });

      it('commercial proposal shows engine TCV, ARR and margin', () => {
        const m = models['commercial-proposal'];
        expect(kpi(m, 'Total contract value')).toBe(compact(r.economics.provider.tcv, cur));
        expect(kpi(m, 'ARR (steady state)')).toBe(compact(r.economics.provider.arr, cur));
        expect(kpi(m, 'Gross margin, term')).toBe(pct(r.economics.provider.marginPct));
        const econ = m.sections.find((x) => x.heading === 'Contract economics')!.table!;
        expect(econ.footer![1]).toBe(money(r.economics.provider.tcv, cur));
        expect(allText(m)).toMatch(/No double billing/);
        // All seven constructs are compared.
        expect(m.sections.find((x) => x.heading.startsWith('Comparison of the seven'))!.table!.rows).toHaveLength(7);
      });

      it('ABU and ACU reports show engine unit economics', () => {
        const abu = models['abu-pricing'];
        expect(kpi(abu, 'Weighted ABUs per month')).toBe(count(r.baseline.totals.weightedAbus, cur));
        expect(kpi(abu, 'Cost per weighted ABU')).toBe(unitPrice(r.economics.provider.costToServePerAbu, cur));
        const abuStream = r.priceBook.streams.find((x) => x.type === 'abu');
        if (abuStream?.abu) expect(kpi(abu, 'Blended price per ABU')).toBe(unitPrice(abuStream.abu.blendedPrice, cur));
        const funnel = abu.sections.find((x) => x.heading.startsWith('Transaction funnel'))!.table!;
        const attempted = funnel.rows.find((row) => row[0] === 'Attempted transactions')!;
        expect(attempted[attempted.length - 1]).toBe(count(r.baseline.totals.attempted, cur));

        const acu = models['acu-rate-card'];
        expect(kpi(acu, 'ACUs per month')).toBe(count(r.baseline.acu.total, cur));
        const acuStream = r.priceBook.streams.find((x) => x.type === 'acu');
        if (acuStream) expect(kpi(acu, 'Price per ACU')).toBe(unitPrice(acuStream.unitPrice ?? 0, cur));
      });

      it('value case keeps productivity separate and matches engine ROI', () => {
        const m = models['value-business-case'];
        const c = r.economics.client;
        expect(kpi(m, 'Client ROI, term')).toBe(pct(c.roiPct));
        expect(kpi(m, 'NPV')).toBe(compact(c.npv, cur));
        expect(kpi(m, 'Counted benefits, term')).toBe(compact(c.countedBenefits, cur));
        expect(m.sections.find((x) => x.heading === 'Productivity (non-cash)')).toBeTruthy();
        const reg = m.sections.find((x) => x.heading === 'Benefit register')!.table!;
        expect(reg.rows).toHaveLength(r.project.value.benefits.length);
        expect(reg.footer![7]).toBe(money(c.countedBenefits, cur));
      });

      it('projection and executive dashboard reconcile to engine totals', () => {
        const proj = models['three-year-projection'];
        const yearly = proj.sections.find((x) => x.heading.startsWith('Provider economics by year'))!.table!;
        expect(yearly.rows).toHaveLength(r.years.length);
        expect(yearly.footer![1]).toBe(money(r.economics.provider.tcv, cur));
        const monthly = proj.sections.find((x) => x.heading === 'Monthly projection')!.table!;
        expect(monthly.rows).toHaveLength(r.months.length);
        const exec = models['executive-dashboard'];
        expect(kpi(exec, 'Total contract value')).toBe(compact(r.economics.provider.tcv, cur));
        expect(kpi(exec, 'Checks passing')).toBe(`${r.reconciliation.length} / ${r.reconciliation.length}`);
        // Chart data are raw engine numbers, not re-computed.
        const chart = exec.sections.find((x) => x.chart?.title === 'Revenue and cost by year')!.chart!;
        expect(chart.series[0].values).toEqual(r.years.map((y) => num(y.revenue)));
      });

      it('FinOps assessment includes variance when actuals exist and optimisations', () => {
        const m = models['finops-assessment'];
        const variance = m.sections.find((x) => x.heading === 'Estimate versus actual')!;
        if (r.project.actuals.length) expect(variance.table?.rows.length).toBeGreaterThan(0);
        else expect(variance.paragraphs?.[0]).toMatch(/No actuals/);
        expect(m.sections.find((x) => x.heading === 'Optimisation opportunities')!.table!.rows.length).toBeGreaterThan(0);
      });
    });
  }

  it('produces stable, slugged file names', () => {
    const r = S[0].result;
    expect(reportFileName(r, 'cost-estimate', 'pdf')).toBe('accounts-payable-agent_ai-project-cost-estimate.pdf');
    expect(reportFileName(r, 'model', 'xlsx')).toBe('accounts-payable-agent_financial-model.xlsx');
    expect(reportFileName(S[2].result, 'acu-rate-card', 'pptx')).toBe('rfp-response-agent_acu-consumption-rate-card.pptx');
  });
});
