/**
 * Section-level permissions for project writes.
 *
 * The engine's RBAC matrix is section-based (implementation.edit,
 * tokenomics.edit, pricing.edit, value.edit, …) — e.g. AI Engineering may edit
 * tokenomics and actuals but not pricing. A full-document PUT therefore
 * requires the permission of every section it changes, and governance fields
 * need their own permission even when written through a PUT:
 *   value.benefits[].status / validatedBy / validatedOn → benefit.validate
 *   pricing.rateCardVersions approvals                   → ratecard.approve
 */
import type { BenefitLine, Permission, Project, RateCardVersion } from '@aies/engine';
import { deepEqual } from './util';
import { SERVER_FIELDS } from './repo/projects';

export const SECTION_PERMISSIONS: Record<string, Permission> = {
  name: 'project.edit',
  status: 'project.edit',
  currency: 'project.edit',
  goLiveDate: 'project.edit',
  owner: 'project.edit',
  illustrative: 'project.edit',
  client: 'project.edit',
  solution: 'project.edit',
  implementation: 'implementation.edit',
  agents: 'tokenomics.edit',
  workflows: 'tokenomics.edit',
  costLines: 'tokenomics.edit',
  acu: 'tokenomics.edit',
  pricing: 'pricing.edit',
  value: 'value.edit',
  actuals: 'actuals.edit',
  scenarios: 'scenario.save',
};

/** Every permission that allows some project write (route-level gate for PUT). */
export const ANY_PROJECT_WRITE: Permission[] = [...new Set<Permission>([...Object.values(SECTION_PERMISSIONS), 'benefit.validate', 'ratecard.approve'])];

const GOVERNANCE_BENEFIT_FIELDS = ['status', 'validatedBy', 'validatedOn'] as const;

function stripBenefitGovernance(b: BenefitLine): Record<string, unknown> {
  const c: Record<string, unknown> = { ...b };
  for (const k of GOVERNANCE_BENEFIT_FIELDS) delete c[k];
  return c;
}

function benefitGovernance(b: BenefitLine | undefined): Record<string, unknown> {
  return b ? { status: b.status, validatedBy: b.validatedBy, validatedOn: b.validatedOn } : {};
}

function approvedRateCards(list: RateCardVersion[] | undefined): Record<string, RateCardVersion> {
  return Object.fromEntries((list ?? []).filter((r) => r.status !== 'draft').map((r) => [r.id, r]));
}

/** Permissions needed to turn `before` into `after`. Empty when nothing changed. */
export function requiredEditPermissions(before: Project, after: Project): { permissions: Permission[]; changed: string[] } {
  const need = new Set<Permission>();
  const b = before as unknown as Record<string, unknown>;
  const a = after as unknown as Record<string, unknown>;
  const changed = [...new Set([...Object.keys(b), ...Object.keys(a)])].filter((k) => !SERVER_FIELDS.includes(k) && !deepEqual(b[k], a[k])).sort();

  for (const key of changed) {
    if (key === 'value') {
      const bv = { ...before.value, benefits: (before.value?.benefits ?? []).map(stripBenefitGovernance) };
      const av = { ...after.value, benefits: (after.value?.benefits ?? []).map(stripBenefitGovernance) };
      if (!deepEqual(bv, av)) need.add('value.edit');
      const prev = new Map((before.value?.benefits ?? []).map((x) => [x.id, x]));
      for (const nb of after.value?.benefits ?? []) {
        const ob = prev.get(nb.id);
        // A new benefit may only start as "proposed" without validation rights.
        if (!ob ? nb.status !== 'proposed' || nb.validatedBy || nb.validatedOn : !deepEqual(benefitGovernance(ob), benefitGovernance(nb))) need.add('benefit.validate');
      }
    } else if (key === 'pricing') {
      const { rateCardVersions: brc, ...bp } = before.pricing ?? ({} as Project['pricing']);
      const { rateCardVersions: arc, ...ap } = after.pricing ?? ({} as Project['pricing']);
      if (!deepEqual(bp, ap)) need.add('pricing.edit');
      if (!deepEqual(brc, arc)) {
        need.add('pricing.edit');
        if (!deepEqual(approvedRateCards(brc), approvedRateCards(arc))) need.add('ratecard.approve');
      }
    } else {
      need.add(SECTION_PERMISSIONS[key] ?? 'project.edit');
    }
  }
  return { permissions: [...need].sort(), changed };
}

/** Permissions needed to create `p`. */
export function requiredCreatePermissions(p: Project): Permission[] {
  const need = new Set<Permission>(['project.create']);
  if ((p.value?.benefits ?? []).some((x) => x.status !== 'proposed' || x.validatedBy || x.validatedOn)) need.add('benefit.validate');
  if ((p.pricing?.rateCardVersions ?? []).some((r) => r.status !== 'draft')) need.add('ratecard.approve');
  if ((p.actuals ?? []).length) need.add('actuals.edit');
  return [...need].sort();
}
