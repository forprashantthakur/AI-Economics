import { useEffect, useMemo, useState } from 'react';
import { PageHeader, Select, Tabs } from '../components/ui';
import { useStore, usePortfolio } from '../state/store';
import { PERIOD_LABEL, buildSlice, type Period } from '../lib/slice';
import { Portfolio } from './dashboard/Portfolio';
import { ArchitectView } from './dashboard/ArchitectView';
import { CommercialView } from './dashboard/CommercialView';
import { FinOpsView } from './dashboard/FinOpsView';
import { ValueView } from './dashboard/ValueView';
import { IntegrityView } from './dashboard/IntegrityView';

type View = 'architect' | 'commercial' | 'finops' | 'value' | 'integrity';

export function Dashboard({ view: initialView }: { view?: string }) {
  const { state, dispatch } = useStore();
  const portfolio = usePortfolio();
  const [view, setView] = useState<View>((['architect', 'commercial', 'finops', 'value', 'integrity'].includes(initialView ?? '') ? initialView : 'commercial') as View);
  useEffect(() => {
    if (initialView && ['architect', 'commercial', 'finops', 'value', 'integrity'].includes(initialView)) setView(initialView as View);
  }, [initialView]);
  const [client, setClient] = useState('all');
  const [period, setPeriod] = useState<Period>('steady');
  const [workflowId, setWorkflowId] = useState('all');
  const [agentId, setAgentId] = useState('all');

  const clients = [...new Set(state.projects.map((p) => p.client.clientName))];
  const inClient = portfolio.filter((x) => client === 'all' || x.project.client.clientName === client);
  const selected = inClient.find((x) => x.project.id === state.currentProjectId) ?? inClient[0];
  const r = selected?.result;

  const slice = useMemo(() => (r ? buildSlice(r, period, workflowId === 'all' ? undefined : workflowId, agentId === 'all' ? undefined : agentId) : undefined), [r, period, workflowId, agentId]);

  const selectProject = (id: string) => {
    dispatch({ type: 'setCurrent', id });
    setWorkflowId('all');
    setAgentId('all');
  };

  return (
    <div>
      <PageHeader
        title="Dashboard"
        description="Portfolio economics at a glance, then role-specific views of the selected project. Every figure comes from the same engine run, so totals agree across views and reports."
      />

      {/* One filter row scopes everything below it. */}
      <div className="flex flex-wrap items-end gap-3 mb-5" role="group" aria-label="Dashboard filters">
        <FilterSelect label="Client" value={client} onChange={(v) => setClient(v)} options={[{ value: 'all', label: 'All clients' }, ...clients.map((c) => ({ value: c, label: c }))]} />
        <FilterSelect
          label="Project"
          value={selected?.project.id ?? ''}
          onChange={selectProject}
          options={inClient.map((x) => ({ value: x.project.id, label: x.project.name }))}
        />
        <FilterSelect
          label="Business process"
          value={workflowId}
          onChange={setWorkflowId}
          options={[{ value: 'all', label: 'All workflows' }, ...(selected?.project.workflows ?? []).map((w) => ({ value: w.id, label: w.name }))]}
        />
        <FilterSelect
          label="Agent"
          value={agentId}
          onChange={setAgentId}
          options={[{ value: 'all', label: 'All agents' }, ...(selected?.project.agents ?? []).map((a) => ({ value: a.id, label: a.name }))]}
        />
        <FilterSelect label="Reporting period" value={period} onChange={(v) => setPeriod(v as Period)} options={(Object.keys(PERIOD_LABEL) as Period[]).map((p) => ({ value: p, label: PERIOD_LABEL[p] }))} />
      </div>

      <Portfolio items={inClient} selectedId={selected?.project.id} onSelect={selectProject} />

      {r && slice && (
        <>
          <Tabs<View>
            className="mt-8 mb-5"
            value={view}
            onChange={setView}
            tabs={[
              { id: 'commercial', label: 'Commercial & sales' },
              { id: 'architect', label: 'Solution architect' },
              { id: 'finops', label: 'AI FinOps' },
              { id: 'value', label: 'Client value' },
              { id: 'integrity', label: 'Reconciliation' },
            ]}
          />
          {view === 'architect' && <ArchitectView r={r} slice={slice} period={period} />}
          {view === 'commercial' && <CommercialView r={r} slice={slice} period={period} />}
          {view === 'finops' && <FinOpsView r={r} slice={slice} period={period} />}
          {view === 'value' && <ValueView r={r} period={period} />}
          {view === 'integrity' && <IntegrityView r={r} />}
        </>
      )}
    </div>
  );
}

function FilterSelect({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: { value: string; label: string }[] }) {
  const id = `f-${label.replace(/\s+/g, '-').toLowerCase()}`;
  return (
    <div className="min-w-[150px] max-w-[240px] flex-1 sm:flex-none">
      <label htmlFor={id} className="block text-[12.5px] font-semibold text-ink-3 mb-1">
        {label}
      </label>
      <Select id={id} value={value} onChange={onChange} options={options} />
    </div>
  );
}
