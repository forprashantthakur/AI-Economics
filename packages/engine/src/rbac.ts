/**
 * Role-based access control shared by the API and the web app.
 */
export const ROLES = ['admin', 'consultant', 'architect', 'engineering', 'finance', 'executive'] as const;
export type RoleName = (typeof ROLES)[number];

export const ROLE_LABELS: Record<RoleName, string> = {
  admin: 'Administrator',
  consultant: 'Consultant',
  architect: 'Solution Architect',
  engineering: 'AI Engineering',
  finance: 'Finance',
  executive: 'Business Leader (read-only)',
};

export const PERMISSIONS = [
  'project.create',
  'project.edit',
  'project.delete',
  'implementation.edit',
  'tokenomics.edit',
  'pricing.edit',
  'ratecard.approve',
  'value.edit',
  'benefit.validate',
  'catalog.edit',
  'actuals.edit',
  'scenario.save',
  'report.export',
  'audit.view',
  'user.manage',
] as const;
export type Permission = (typeof PERMISSIONS)[number];

const MATRIX: Record<RoleName, Permission[]> = {
  admin: [...PERMISSIONS],
  consultant: ['project.create', 'project.edit', 'implementation.edit', 'pricing.edit', 'value.edit', 'scenario.save', 'report.export'],
  architect: ['project.create', 'project.edit', 'implementation.edit', 'tokenomics.edit', 'scenario.save', 'report.export'],
  engineering: ['tokenomics.edit', 'actuals.edit', 'scenario.save', 'report.export'],
  finance: ['pricing.edit', 'ratecard.approve', 'value.edit', 'benefit.validate', 'catalog.edit', 'actuals.edit', 'scenario.save', 'report.export', 'audit.view'],
  executive: ['report.export'],
};

export function can(role: RoleName | string | undefined, permission: Permission): boolean {
  if (!role || !(role in MATRIX)) return false;
  return MATRIX[role as RoleName].includes(permission);
}

export function permissionsFor(role: RoleName): Permission[] {
  return [...MATRIX[role]];
}
