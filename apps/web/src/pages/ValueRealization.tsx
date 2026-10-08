import { Empty, IssueList, PageHeader, ReadOnlyNote, SectionTitle, StatStrip } from '../components/ui';
import { useCan, useCurrentProject, useProjectUpdater, useResult } from '../state/store';
import { compact, months as fmtMonths, num, pct, unitPrice } from '../lib/format';
import { Productivity } from './value/Productivity';
import { BenefitRegister } from './value/BenefitRegister';
import { ClientCosts, KpiEditor } from './value/ClientInputs';
import { RealisedVsForecast, RoiByYear, RoiCharts } from './value/RoiResults';

/**
 * Workaround: unlayered rules in styles.css (`.field` padding, `button { color: inherit }`) beat Tailwind's layered
 * utilities, so NumberInput affixes overlap the value and primary buttons lose their light text. Scoped to this page.
 */
const LAYER_FIX = '[&_input.pr-9]:pr-9! [&_input.pl-6]:pl-6! [&_button.text-brand-ink]:text-brand-ink!';

const VALUE_CODES = new Set(['CAPACITY_UNVALIDATED', 'NO_PRODUCTIVITY', 'FX_MISSING']);

/** Module 8 — value realization: productivity (non-cash), the benefit register with Finance validation, and client ROI. */
export function ValueRealization() {
  const project = useCurrentProject();
  const r = useResult(project);
  const update = useProjectUpdater(project?.id);
  const canEdit = useCan('value.edit');
  const canValidate = useCan('benefit.validate');

  if (!project || !r) return <Empty title="No project selected" body="Create or select a project to model its value." />;

  const cur = r.currency;
  const c = r.economics.client;
  const v = r.steady.value;
  const issues = r.issues.filter((i) => VALUE_CODES.has(i.code));

  return (
    <div className={LAYER_FIX}>
      <PageHeader title="Value realization" description="What the client gains: released capacity, the financial benefits Finance has signed off, and the return on everything the client pays." />
      <ReadOnlyNote show={!canEdit} what="edit value inputs" />

      {/* The one hero statement on this page. */}
      <section className="bg-paper border border-line rounded-[10px] px-5 py-4 mb-5 grid gap-4 lg:grid-cols-[1.1fr_1fr] lg:items-center" aria-label="Value principle">
        <div>
          <p className="font-serif text-[24px] leading-tight font-semibold text-ink">Productivity value is not realised cash savings.</p>
          <p className="text-[14px] text-ink-2 mt-2 leading-relaxed">
            Released hours are reported as capacity. They are never converted to cash automatically: a saving counts only when it appears in the benefit register and Finance has validated it, for
            example as reduced contractor spend, avoided hiring or redeployment with a named owner.
          </p>
        </div>
        <dl className="grid grid-cols-2 gap-3 text-[13.5px]">
          <div className="rounded-lg bg-sunken px-3 py-2.5">
            <dt className="text-ink-3">Productivity value per month</dt>
            <dd className="num text-[20px] font-semibold text-ink mt-0.5">{compact(v.productivityValue, cur)}</dd>
            <dd className="text-[12.5px] text-ink-3">{num(v.fteReleased, 1)} FTE of capacity, non-cash</dd>
          </div>
          <div className="rounded-lg bg-good-tint px-3 py-2.5">
            <dt className="text-ink-2">Benefits counted in ROI per month</dt>
            <dd className="num text-[20px] font-semibold text-good mt-0.5">{compact(r.project.value.includeUnvalidated ? v.forecast : v.validated, cur)}</dd>
            <dd className="text-[12.5px] text-ink-2">{r.project.value.includeUnvalidated ? 'Forecast view, includes proposed' : 'Finance-validated and realised'}</dd>
          </div>
        </dl>
      </section>

      <StatStrip
        items={[
          { label: 'Client ROI (full term)', value: pct(c.roiPct, 0), tone: c.roiPct.lt(0) ? 'bad' : 'good', sub: `Year 1 ${pct(c.year1RoiPct, 0)}` },
          { label: 'Payback', value: fmtMonths(c.paybackMonths), sub: 'From contract start' },
          { label: 'Net present value', value: compact(c.npv, cur), tone: c.npv.lt(0) ? 'bad' : 'good', sub: `At ${r.project.value.discountRatePct}% discount rate` },
          { label: 'Net financial benefit', value: compact(c.netBenefit, cur), tone: c.netBenefit.lt(0) ? 'bad' : 'neutral', sub: `On ${compact(c.totalInvestment, cur)} client investment` },
          { label: 'Validated vs forecast', value: compact(c.validatedBenefits, cur), sub: `of ${compact(c.forecastBenefits, cur)} forecast over the term` },
          { label: 'Cost per successful outcome', value: unitPrice(c.costPerOutcome, cur), sub: 'Client investment per accepted transaction' },
        ]}
      />

      {issues.length > 0 && (
        <div className="mt-4">
          <IssueList issues={issues} />
        </div>
      )}

      <SectionTitle>Productivity</SectionTitle>
      <Productivity r={r} update={update} canEdit={canEdit} />

      <SectionTitle>Financial benefits</SectionTitle>
      <div className="space-y-5">
        <BenefitRegister r={r} update={update} canEdit={canEdit} canValidate={canValidate} />
        <ClientCosts r={r} update={update} canEdit={canEdit} />
      </div>

      <SectionTitle>Return on investment</SectionTitle>
      <div className="space-y-5">
        <RoiByYear r={r} />
        <RoiCharts r={r} />
        <RealisedVsForecast r={r} />
        <KpiEditor r={r} update={update} canEdit={canEdit} />
      </div>
    </div>
  );
}
