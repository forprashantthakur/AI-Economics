/**
 * Module 2 — AI implementation cost estimator.
 *
 * Implementation Cost = Σ(effort × resource cost rate) + direct expenses + contingency
 * Fixed price (cost-plus) = Implementation Cost / (1 − target margin) × (1 − discount)
 * T&M value              = Σ(effort × bill rate) + billable expenses
 */
import { D, Decimal, ZERO, pct, priceForMargin, marginPct, sum, addTo } from './decimal';
import type { FxTable, ImplementationPlan } from './types';
import { convert } from './fx';

export interface ActivityResult {
  id: string;
  phase: string;
  name: string;
  roleId: string;
  roleName: string;
  hours: Decimal;
  cost: Decimal;
  billValue: Decimal;
  startWeek: number;
  endWeek: number;
  critical: boolean;
}

export interface ImplementationResult {
  activities: ActivityResult[];
  laborHours: Decimal;
  laborCost: Decimal;
  directExpenses: Decimal;
  billableExpenses: Decimal;
  contingency: Decimal;
  totalCost: Decimal;
  tmValue: Decimal;
  cpmPrice: Decimal;
  /** The price quoted to the client under the selected pricing method, after discount. */
  price: Decimal;
  grossProfit: Decimal;
  marginPct: Decimal;
  durationWeeks: number;
  costByPhase: Record<string, Decimal>;
  costByRole: Record<string, Decimal>;
  hoursByRole: Record<string, Decimal>;
  scheduleErrors: string[];
}

/** Earliest-start schedule from activity dependencies (critical path method). */
export function schedule(plan: ImplementationPlan): {
  start: Record<string, number>;
  end: Record<string, number>;
  critical: Set<string>;
  duration: number;
  errors: string[];
} {
  const byId = new Map(plan.activities.map((a) => [a.id, a]));
  const start: Record<string, number> = {};
  const end: Record<string, number> = {};
  const errors: string[] = [];
  const state: Record<string, 0 | 1 | 2> = {};

  const visit = (id: string, trail: string[]): number => {
    const a = byId.get(id);
    if (!a) return 0;
    if (state[id] === 2) return end[id];
    if (state[id] === 1) {
      errors.push(`Circular dependency: ${[...trail, id].join(' → ')}`);
      return 0;
    }
    state[id] = 1;
    let es = 0;
    for (const dep of a.dependsOn) {
      if (!byId.has(dep)) {
        errors.push(`Activity "${a.name}" depends on unknown activity "${dep}"`);
        continue;
      }
      es = Math.max(es, visit(dep, [...trail, id]));
    }
    start[id] = es;
    end[id] = es + Math.max(0, a.durationWeeks);
    state[id] = 2;
    return end[id];
  };
  for (const a of plan.activities) visit(a.id, []);
  const duration = Math.max(0, ...Object.values(end));

  // Backward pass for the critical path.
  const lateFinish: Record<string, number> = {};
  const successors = new Map<string, string[]>();
  for (const a of plan.activities) for (const d of a.dependsOn) successors.set(d, [...(successors.get(d) ?? []), a.id]);
  const lfVisiting = new Set<string>();
  const lf = (id: string): number => {
    if (lateFinish[id] !== undefined) return lateFinish[id];
    if (lfVisiting.has(id)) return duration; // cycle already reported
    lfVisiting.add(id);
    const succ = successors.get(id) ?? [];
    const v = succ.length ? Math.min(...succ.map((s) => lf(s) - Math.max(0, byId.get(s)!.durationWeeks))) : duration;
    lfVisiting.delete(id);
    lateFinish[id] = v;
    return v;
  };
  for (const a of plan.activities) lf(a.id);
  const critical = new Set(plan.activities.filter((a) => Math.abs((lateFinish[a.id] ?? 0) - (end[a.id] ?? 0)) < 1e-9).map((a) => a.id));
  return { start, end, critical, duration, errors: [...new Set(errors)] };
}

export function computeImplementation(plan: ImplementationPlan, currency: string, fx: FxTable): ImplementationResult {
  const roles = new Map(plan.roles.map((r) => [r.id, r]));
  const sched = schedule(plan);
  const costByPhase: Record<string, Decimal> = {};
  const costByRole: Record<string, Decimal> = {};
  const hoursByRole: Record<string, Decimal> = {};

  const activities: ActivityResult[] = plan.activities.map((a) => {
    const role = roles.get(a.roleId);
    const hours = a.effortUnit === 'days' ? D(a.effort).times(D(plan.hoursPerDay || 8)) : D(a.effort);
    const costRate = role ? convert(role.costRate, role.currency, currency, fx) : ZERO;
    const billRate = role ? convert(role.billRate, role.currency, currency, fx) : ZERO;
    const cost = hours.times(costRate);
    const billValue = hours.times(billRate);
    addTo(costByPhase, a.phase, cost);
    const roleName = role?.name ?? 'Unassigned';
    addTo(costByRole, roleName, cost);
    addTo(hoursByRole, roleName, hours);
    return {
      id: a.id,
      phase: a.phase,
      name: a.name,
      roleId: a.roleId,
      roleName,
      hours,
      cost,
      billValue,
      startWeek: sched.start[a.id] ?? 0,
      endWeek: sched.end[a.id] ?? 0,
      critical: sched.critical.has(a.id),
    };
  });

  const laborHours = sum(activities.map((a) => a.hours));
  const laborCost = sum(activities.map((a) => a.cost));
  const directExpenses = sum(plan.directExpenses.map((e) => convert(e.amount, e.currency, currency, fx)));
  const billableExpenses = sum(plan.directExpenses.filter((e) => e.billable).map((e) => convert(e.amount, e.currency, currency, fx)));
  const contingency = laborCost.plus(directExpenses).times(pct(plan.contingencyPct));
  const totalCost = laborCost.plus(directExpenses).plus(contingency);
  const tmValue = sum(activities.map((a) => a.billValue)).plus(billableExpenses);
  const cpmPrice = totalCost.isZero() ? ZERO : priceForMargin(totalCost, plan.targetMarginPct);
  const listPrice = plan.pricingMethod === 'time_and_materials' ? tmValue : cpmPrice;
  const price = listPrice.times(D(1).minus(pct(plan.discountPct)));

  return {
    activities,
    laborHours,
    laborCost,
    directExpenses,
    billableExpenses,
    contingency,
    totalCost,
    tmValue,
    cpmPrice,
    price,
    grossProfit: price.minus(totalCost),
    marginPct: marginPct(price, totalCost),
    durationWeeks: sched.duration,
    costByPhase,
    costByRole,
    hoursByRole,
    scheduleErrors: sched.errors,
  };
}
