import { Empty, IssueList, PageHeader, Panel, ReadOnlyNote, SectionTitle, StatStrip } from '../components/ui';
import { useCan, useCurrentProject, useProjectUpdater, useResult } from '../state/store';
import { compact, pct, unitPrice } from '../lib/format';
import { StreamBuilder } from './commercial/StreamBuilder';
import { RecoveryMatrix } from './commercial/RecoveryMatrix';
import { ContractTerms, GainsharePanel, SubscriptionPanel } from './commercial/ContractTerms';
import { OverallKeyValues, StreamResults, YearTable } from './commercial/Results';
import { PackageComparison } from './commercial/PackageComparison';

/**
 * Workaround: unlayered rules in styles.css (`.field` padding, `button { color: inherit }`) beat Tailwind's layered
 * utilities, so NumberInput affixes overlap the value and primary buttons lose their light text. Scoped to this page.
 */
const LAYER_FIX = '[&_input.pr-9]:pr-9! [&_input.pl-6]:pl-6! [&_button.text-brand-ink]:text-brand-ink!';

const PRICING_INPUT_CODES = new Set(['MARGIN_RANGE', 'FIXED_FEE_RUN_POOLS', 'SUB_NO_UNIT_STREAM', 'MULTI_SUB', 'MULTI_UNIT_STREAM']);

/** Module 7 — commercial pricing: revenue streams, cost recovery, contract terms and the seven constructs. */
export function CommercialPricing() {
  const project = useCurrentProject();
  const r = useResult(project);
  const update = useProjectUpdater(project?.id);
  const canEdit = useCan('pricing.edit');

  if (!project || !r) return <Empty title="No project selected" body="Create or select a project to price it." />;

  const cur = r.currency;
  const p = r.economics.provider;
  const streams = project.pricing.streams.filter((s) => s.enabled);
  const hasSub = streams.some((s) => s.type === 'subscription');
  const hasGain = streams.some((s) => s.type === 'gainshare');
  // Price-book issues plus the input checks that concern the commercial model.
  const issues = [...r.priceBook.issues, ...r.issues.filter((i) => PRICING_INPUT_CODES.has(i.code) && !r.priceBook.issues.some((x) => x.message === i.message))];
  const steadyMargin = p.steadyMarginPct;

  return (
    <div className={LAYER_FIX}>
      <PageHeader
        title="Commercial pricing"
        description="Build the hybrid commercial model from revenue streams, assign each cost pool to exactly one stream, set contract terms, and compare the result with six standard constructs. Prices are derived by the engine and locked for the contract."
      />
      <ReadOnlyNote show={!canEdit} what="change pricing" />

      <StatStrip
        items={[
          { label: 'Monthly recurring revenue', value: compact(p.mrr, cur), sub: `ARR ${compact(p.arr, cur)}` },
          { label: 'Annual contract value', value: compact(p.acv, cur), sub: `Revenue per agent ${compact(p.revenuePerAgent, cur)}` },
          { label: 'Total contract value', value: compact(p.tcv, cur), sub: `${project.pricing.termMonths}-month term` },
          { label: 'Run-rate gross margin', value: pct(steadyMargin), tone: steadyMargin.lt(15) ? 'bad' : steadyMargin.lt(25) ? 'warn' : 'good', sub: `Full term ${pct(p.marginPct)}` },
          { label: 'Cost to serve', value: `${compact(p.costToServeMonthly, cur)}/mo`, sub: `${unitPrice(p.costToServePerAbu, cur)} per weighted ABU` },
        ]}
      />

      <Panel title="Pricing checks" className="mt-5" description="Raised by the engine when it builds the price book.">
        <IssueList issues={issues} empty="No pricing issues: every pool with cost is recovered exactly once and prices clear their floors." />
      </Panel>

      <SectionTitle>Commercial model</SectionTitle>
      <div className="space-y-5">
        <StreamBuilder r={r} update={update} canEdit={canEdit} />
        <RecoveryMatrix r={r} update={update} canEdit={canEdit} />
        <ContractTerms r={r} update={update} canEdit={canEdit} />
        {(hasSub || hasGain) && (
          <div className={hasSub && hasGain ? 'grid gap-5 xl:grid-cols-2' : ''}>
            {hasSub && <SubscriptionPanel r={r} update={update} canEdit={canEdit} />}
            {hasGain && <GainsharePanel r={r} update={update} canEdit={canEdit} />}
          </div>
        )}
      </div>

      <SectionTitle>Results</SectionTitle>
      <div className="space-y-5">
        <StreamResults r={r} />
        <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)]">
          <OverallKeyValues r={r} />
          <YearTable r={r} />
        </div>
      </div>

      <SectionTitle>Seven commercial constructs</SectionTitle>
      <PackageComparison r={r} update={update} canEdit={canEdit} />
    </div>
  );
}
