import type { ProjectResult } from '@aies/engine';
import { CheckCircle2, XCircle } from 'lucide-react';
import { IssueList, Panel } from '../../components/ui';
import { money } from '../../lib/format';

export function IntegrityView({ r }: { r: ProjectResult }) {
  const passed = r.reconciliation.filter((c) => c.pass).length;
  return (
    <div className="grid gap-5 xl:grid-cols-[1.3fr_1fr]">
      <Panel
        title={`Reconciliation checks — ${passed} of ${r.reconciliation.length} pass`}
        description="The engine computes each cost once and allocates it. These checks prove every breakdown, dashboard and report total agrees with the source figure."
        padded={false}
      >
        <div className="scroll-x">
          <table className="dtable min-w-[620px]">
            <thead>
              <tr>
                <th>Check</th>
                <th className="r">Expected</th>
                <th className="r">Computed</th>
                <th className="r">Result</th>
              </tr>
            </thead>
            <tbody>
              {r.reconciliation.map((c) => (
                <tr key={c.id}>
                  <td className="text-[13.5px]">{c.name}</td>
                  <td className="r text-[13px]">{c.id === 'tokens' || c.id === 'funnel' || c.id === 'abu-classes' || c.id === 'acu-workflow' ? c.expected.toDecimalPlaces(0).toNumber().toLocaleString('en-IN') : money(c.expected, r.currency, 2)}</td>
                  <td className="r text-[13px]">{c.id === 'tokens' || c.id === 'funnel' || c.id === 'abu-classes' || c.id === 'acu-workflow' ? c.actual.toDecimalPlaces(0).toNumber().toLocaleString('en-IN') : money(c.actual, r.currency, 2)}</td>
                  <td className="r">{c.pass ? <CheckCircle2 size={16} className="inline text-good" aria-label="Pass" /> : <XCircle size={16} className="inline text-bad" aria-label="Fail" />}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
      <Panel title="Validation and double-count checks" description="Input problems, double billing across revenue streams and possible double counting across cost categories.">
        <IssueList issues={r.issues} empty="No validation issues." />
      </Panel>
    </div>
  );
}
