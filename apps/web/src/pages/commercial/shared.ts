import { COST_POOLS, type CostPool, type RevenueStream, type StreamPrice, type StreamType } from '@aies/engine';
import type { useProjectUpdater } from '../../state/store';
import { money, pct, unitPrice } from '../../lib/format';

export type Updater = ReturnType<typeof useProjectUpdater>;

export const STREAM_TYPE_LABEL: Record<StreamType, string> = {
  fixed_fee: 'Fixed implementation fee',
  fixed_monthly: 'Fixed monthly fee',
  acu: 'ACU consumption',
  abu: 'ABU transactions',
  subscription: 'Subscription / committed capacity',
  agentops: 'Managed AgentOps',
  pass_through: 'Pass-through',
  gainshare: 'Gainshare',
};

export const DEFAULT_STREAM_LABEL: Record<StreamType, string> = {
  fixed_fee: 'Implementation fee',
  fixed_monthly: 'Fixed monthly fee',
  acu: 'ACU consumption',
  abu: 'ABU transaction pricing',
  subscription: 'Platform subscription',
  agentops: 'Managed AgentOps fee',
  pass_through: 'Pass-through at cost',
  gainshare: 'Gainshare',
};

export const STREAM_TYPE_OPTIONS = (Object.keys(STREAM_TYPE_LABEL) as StreamType[]).map((t) => ({ value: t, label: STREAM_TYPE_LABEL[t] }));

/** Pass-through and gainshare are not priced at a target margin. */
export const usesMargin = (t: StreamType) => t !== 'pass_through' && t !== 'gainshare';

export const poolOrder = (pools: CostPool[]): CostPool[] => COST_POOLS.filter((p) => pools.includes(p));

/** What the client is charged for a stream, as priced by the engine. */
export function priceText(s: RevenueStream, sp: StreamPrice | undefined, cur: string, passMarkupPct: number, sharePct: number): string {
  if (!s.enabled) return 'Off';
  if (!sp) return '—';
  switch (s.type) {
    case 'fixed_fee':
      return `${money(sp.oneTimeFee ?? 0, cur, 0)} one-time`;
    case 'fixed_monthly':
    case 'agentops':
      return `${money(sp.monthlyFee ?? 0, cur, 0)} / month`;
    case 'subscription':
      return `${money(sp.subscription?.totalFee ?? 0, cur, 0)} / month`;
    case 'acu':
      return `${unitPrice(sp.unitPrice ?? 0, cur)} per ACU`;
    case 'abu':
      return `${unitPrice(sp.unitPrice ?? 0, cur)} per ABU`;
    case 'pass_through':
      return `Cost + ${pct(passMarkupPct, 0)}`;
    case 'gainshare':
      return `${pct(sharePct, 0)} of benefit`;
  }
}
