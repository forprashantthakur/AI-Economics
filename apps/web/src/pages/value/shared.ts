import type { BenefitCategory, BenefitStatus, Catalog } from '@aies/engine';
import type { useProjectUpdater } from '../../state/store';

export type Updater = ReturnType<typeof useProjectUpdater>;

export const CATEGORY_LABEL: Record<BenefitCategory, string> = {
  hard_savings: 'Hard savings',
  cost_avoidance: 'Cost avoidance',
  revenue: 'Revenue contribution',
  working_capital: 'Working capital',
  capacity_conversion: 'Capacity conversion',
};

export const CATEGORY_ORDER: BenefitCategory[] = ['hard_savings', 'cost_avoidance', 'revenue', 'working_capital', 'capacity_conversion'];

export const CATEGORY_COLOR: Record<BenefitCategory, string> = {
  hard_savings: '--s3',
  cost_avoidance: '--s1',
  revenue: '--s7',
  working_capital: '--s4',
  capacity_conversion: '--s5',
};

export const STATUS_META: Record<BenefitStatus, { label: string; tone: 'neutral' | 'good' | 'warn' | 'bad' | 'brand' }> = {
  proposed: { label: 'Proposed', tone: 'warn' },
  finance_validated: { label: 'Finance validated', tone: 'good' },
  realized: { label: 'Realised', tone: 'brand' },
  rejected: { label: 'Rejected', tone: 'bad' },
};

export const today = () => new Date().toISOString().slice(0, 10);

export function currencyOptions(catalog: Catalog, ...extra: string[]): { value: string; label: string }[] {
  const set = new Set([catalog.fx.base, ...Object.keys(catalog.fx.rates), ...extra.filter(Boolean)]);
  return [...set].sort().map((c) => ({ value: c, label: c }));
}
