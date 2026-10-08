import type { Permission, RoleName } from '@aies/engine';
import type { Config } from './config';
import type { Db } from './db/adapter';

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  role: RoleName;
}

export interface AuditState {
  /** An audit row for this request has been committed — the generic hook must not write another. */
  written: boolean;
  /** A row was written inside the current (uncommitted) transaction. */
  staged: boolean;
  /** Error captured by the error handler, recorded on failure rows. */
  error?: { code: string; message: string };
}

declare module 'fastify' {
  interface FastifyInstance {
    db: Db;
    cfg: Config;
  }
  interface FastifyRequest {
    user: AuthUser | null;
    auditState: AuditState;
  }
  interface FastifyContextConfig {
    /** No authentication required. */
    public?: boolean;
    /** Required permission (engine `can(role, permission)`). Omitted = any authenticated role. */
    permission?: Permission;
    /** At least one of these permissions (finer checks happen in the handler). */
    anyPermission?: Permission[];
    /** Audit action name, e.g. "project.update". */
    action?: string;
    /** Audit entity type, e.g. "project". */
    entity?: string;
    /** POST that does not change state (compute, validate, scenario run): not audited on success. */
    readOnly?: boolean;
  }
}
