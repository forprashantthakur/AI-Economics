import { useEffect } from 'react';
import { Download } from 'lucide-react';
import { Badge, Button, Empty, PageHeader, Tabs } from '../components/ui';
import { periodLabel } from '../lib/format';
import { href, navigate } from '../lib/router';
import { useResult, useStore } from '../state/store';
import { STATUS_LABEL } from './dashboard/Portfolio';
import { exportProject } from './projects/common';
import { ActualsTab } from './projects/Actuals';
import { HistoryTab } from './projects/History';
import { OverviewTab } from './projects/Overview';
import { WorkflowsTab } from './projects/Workflows';

type Tab = 'overview' | 'workflows' | 'actuals' | 'history';
const TABS: Tab[] = ['overview', 'workflows', 'actuals', 'history'];

export function ProjectDetail({ id, tab }: { id?: string; tab?: string }) {
  const { state, dispatch } = useStore();
  const project = state.projects.find((p) => p.id === id);
  const result = useResult(project);
  const active: Tab = TABS.includes(tab as Tab) ? (tab as Tab) : 'overview';

  // Opening a project makes it the current project for every module page.
  useEffect(() => {
    if (project && state.currentProjectId !== project.id) dispatch({ type: 'setCurrent', id: project.id });
  }, [project, state.currentProjectId, dispatch]);

  if (!project || !result)
    return (
      <div>
        <PageHeader title="Project not found" />
        <div className="bg-paper border border-line rounded-[10px]">
          <Empty
            title={id ? `No project with id "${id}"` : 'No project selected'}
            body="It may have been deleted or the link is out of date. Choose a project from the list."
            action={<Button onClick={() => navigate('projects')}>Go to projects</Button>}
          />
        </div>
      </div>
    );

  const status = STATUS_LABEL[project.status];
  return (
    <div>
      <PageHeader
        meta={
          <a href={href('projects')} className="hover:text-ink hover:underline underline-offset-2">
            Projects
          </a>
        }
        title={project.name}
        description={
          <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1">
            <span>{project.client.clientName}</span>
            <Badge tone={status.tone}>{status.label}</Badge>
            <span className="text-ink-3 text-[14px]">
              Go-live {periodLabel(project.goLiveDate)}, {project.workflows.length} {project.workflows.length === 1 ? 'workflow' : 'workflows'}, {project.agents.length} agents, {project.currency}
            </span>
          </span>
        }
        actions={
          <Button icon={<Download size={15} />} onClick={() => exportProject(project)}>
            Export JSON
          </Button>
        }
      />
      <Tabs<Tab>
        className="mb-5"
        value={active}
        onChange={(t) => navigate('project', project.id, t)}
        tabs={[
          { id: 'overview', label: 'Overview' },
          { id: 'workflows', label: `Workflows & agents` },
          { id: 'actuals', label: project.actuals.length ? `Actuals (${new Set(project.actuals.map((a) => a.period)).size} months)` : 'Actuals' },
          { id: 'history', label: 'History' },
        ]}
      />
      {active === 'overview' && <OverviewTab project={project} result={result} />}
      {active === 'workflows' && <WorkflowsTab project={project} result={result} />}
      {active === 'actuals' && <ActualsTab project={project} result={result} />}
      {active === 'history' && <HistoryTab project={project} />}
    </div>
  );
}
