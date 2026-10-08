import { Component, type ReactNode } from 'react';
import { Shell } from './components/layout';
import { useLocation } from './lib/router';
import { Dashboard } from './pages/Dashboard';
import { Projects } from './pages/Projects';
import { ProjectDetail } from './pages/ProjectDetail';
import { IntakeWizard } from './pages/IntakeWizard';
import { ProjectCosting } from './pages/ProjectCosting';
import { AcuCalculator } from './pages/AcuCalculator';
import { AbuCalculator } from './pages/AbuCalculator';
import { CommercialPricing } from './pages/CommercialPricing';
import { ValueRealization } from './pages/ValueRealization';
import { ScenarioSimulator } from './pages/ScenarioSimulator';
import { Reports } from './pages/Reports';
import { Settings } from './pages/Settings';

class Boundary extends Component<{ children: ReactNode; resetKey: string }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  componentDidUpdate(prev: { resetKey: string }) {
    if (prev.resetKey !== this.props.resetKey && this.state.error) this.setState({ error: null });
  }
  render() {
    if (this.state.error)
      return (
        <div className="bg-paper border border-line rounded-xl p-6 max-w-xl">
          <h2 className="font-semibold text-ink">This view could not be displayed</h2>
          <p className="text-sm text-ink-2 mt-1">{this.state.error.message}</p>
          <p className="text-sm text-ink-3 mt-2">Check the project inputs for missing values, or reset sample data in Settings.</p>
        </div>
      );
    return this.props.children;
  }
}

export function App() {
  const loc = useLocation();
  const page = (() => {
    switch (loc.route) {
      case 'projects':
        return <Projects />;
      case 'new-project':
        return <IntakeWizard />;
      case 'project':
        return <ProjectDetail id={loc.params[0]} tab={loc.params[1]} />;
      case 'costing':
        return <ProjectCosting tab={loc.params[0]} />;
      case 'acu':
        return <AcuCalculator />;
      case 'abu':
        return <AbuCalculator />;
      case 'commercial':
        return <CommercialPricing />;
      case 'value':
        return <ValueRealization />;
      case 'scenarios':
        return <ScenarioSimulator />;
      case 'reports':
        return <Reports />;
      case 'settings':
        return <Settings tab={loc.params[0]} />;
      default:
        return <Dashboard view={loc.query.get('view') ?? undefined} />;
    }
  })();
  return (
    <Shell route={loc.route}>
      <Boundary resetKey={loc.route + loc.params.join('/')}>{page}</Boundary>
    </Shell>
  );
}
