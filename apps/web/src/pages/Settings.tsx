import { PageHeader, Tabs } from '../components/ui';
import { navigate } from '../lib/router';
import { useCan } from '../state/store';
import { AcuWeightsTab } from './settings/AcuWeights';
import { AuditTab, DataTab, UsersTab } from './settings/Admin';
import { CloudPricesTab, FxTab } from './settings/CloudFx';
import { ModelRatesTab } from './settings/ModelRates';
import { TemplatesTab } from './settings/Templates';

type Tab = 'models' | 'cloud' | 'fx' | 'acu' | 'templates' | 'users' | 'audit' | 'data';

const TABS: { id: Tab; label: string }[] = [
  { id: 'models', label: 'Model rate card' },
  { id: 'cloud', label: 'Cloud & service prices' },
  { id: 'fx', label: 'FX rates' },
  { id: 'acu', label: 'ACU weights' },
  { id: 'templates', label: 'Process templates' },
  { id: 'users', label: 'Users & roles' },
  { id: 'audit', label: 'Audit log' },
  { id: 'data', label: 'Data' },
];

export function Settings({ tab }: { tab?: string }) {
  const active: Tab = TABS.some((t) => t.id === tab) ? (tab as Tab) : 'models';
  const canEdit = useCan('catalog.edit');
  return (
    <div>
      <PageHeader
        title="Settings"
        description="The catalogue every estimate is computed from (model rates, cloud prices, FX and ACU weights), process templates, roles, the audit log and workspace data. Catalogue changes recompute every project and are audited."
        meta={canEdit ? undefined : 'Read-only catalogue for your role'}
      />
      <Tabs<Tab> className="mb-5" value={active} onChange={(t) => navigate('settings', t)} tabs={TABS} />
      {active === 'models' && <ModelRatesTab />}
      {active === 'cloud' && <CloudPricesTab />}
      {active === 'fx' && <FxTab />}
      {active === 'acu' && <AcuWeightsTab />}
      {active === 'templates' && <TemplatesTab />}
      {active === 'users' && <UsersTab />}
      {active === 'audit' && <AuditTab />}
      {active === 'data' && <DataTab />}
    </div>
  );
}
