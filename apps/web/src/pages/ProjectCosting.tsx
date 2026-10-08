import { Empty, PageHeader, Tabs } from '../components/ui';
import { href, navigate } from '../lib/router';
import { useCan, useCurrentProject, useProjectUpdater, useResult } from '../state/store';
import { ImplementationTab } from './costing/ImplementationTab';
import { LlmTab } from './costing/LlmTab';
import { ExecutionTab } from './costing/ExecutionTab';
import { SummaryTab } from './costing/SummaryTab';

type Tab = 'implementation' | 'llm' | 'execution' | 'summary';
const TABS: { id: Tab; label: string }[] = [
  { id: 'implementation', label: 'Implementation' },
  { id: 'llm', label: 'LLM tokenomics' },
  { id: 'execution', label: 'Execution costs' },
  { id: 'summary', label: 'Summary' },
];

const DESCRIPTION: Record<Tab, string> = {
  implementation: 'One-time delivery effort, schedule and the price quoted to the client. Internal delivery cost and client billing price are shown separately.',
  llm: 'Model calls, tokens and routing per workflow step. Every token is billed once at the provider’s cache semantics, then allocated to models, agents and workflows.',
  execution: 'Non-LLM run costs: orchestration, retrieval, documents, cloud infrastructure and AgentOps. Each line is costed once and allocated to workflows.',
  summary: 'Monthly run cost by pool, workflow and business function, projected over the contract term next to the one-time implementation cost.',
};

export function ProjectCosting({ tab }: { tab?: string }) {
  const project = useCurrentProject();
  const result = useResult(project);
  const update = useProjectUpdater(project?.id);
  const canImpl = useCan('implementation.edit');
  const canTok = useCan('tokenomics.edit');
  const active: Tab = (TABS.some((t) => t.id === tab) ? tab : 'implementation') as Tab;

  if (!project || !result)
    return (
      <div>
        <PageHeader title="Project costing" />
        <Empty
          title="No project selected"
          body="Create a project to estimate implementation and run costs."
          action={
            <a className="font-semibold text-brand hover:underline" href={href('new-project')}>
              Create a project
            </a>
          }
        />
      </div>
    );

  return (
    <div>
      <PageHeader title="Project costing" description={DESCRIPTION[active]} meta={`${project.name} for ${project.client.clientName}. Amounts in ${project.currency}.`} />
      <Tabs<Tab> className="mb-5" value={active} onChange={(t) => navigate('costing', t)} tabs={TABS} />
      {active === 'implementation' && <ImplementationTab project={project} result={result} update={update} canEdit={canImpl} />}
      {active === 'llm' && <LlmTab project={project} result={result} update={update} canEdit={canTok} />}
      {active === 'execution' && <ExecutionTab project={project} result={result} update={update} canEdit={canTok} />}
      {active === 'summary' && <SummaryTab project={project} result={result} />}
    </div>
  );
}
