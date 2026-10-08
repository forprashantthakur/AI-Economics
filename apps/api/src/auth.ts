/**
 * Authentication (bcrypt passwords + HS256 JWT bearer tokens via jose) and
 * route-level RBAC using the engine's permission matrix.
 *
 * The token carries the user id; on every request the user is re-loaded from
 * the database so deactivation and role changes take effect immediately.
 */
import bcrypt from 'bcryptjs';
import { SignJWT, decodeJwt, jwtVerify } from 'jose';
import type { FastifyRequest } from 'fastify';
import { ROLES, can, type Permission, type RoleName } from '@aies/engine';
import type { Queryable } from './db/adapter';
import { ApiError, forbidden, unauthorized } from './errors';
import type { AuthUser } from './types';

const ISSUER = 'aies-api';
const AUDIENCE = 'aies';

export async function hashPassword(password: string, rounds: number): Promise<string> {
  return bcrypt.hash(password, rounds);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

export function isRole(v: unknown): v is RoleName {
  return typeof v === 'string' && (ROLES as readonly string[]).includes(v);
}

export class TokenService {
  private readonly key: Uint8Array;

  constructor(
    secret: string,
    private readonly ttl: string,
  ) {
    this.key = new TextEncoder().encode(secret);
  }

  async sign(user: AuthUser): Promise<{ token: string; expiresAt: string }> {
    const token = await new SignJWT({ email: user.email, role: user.role })
      .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
      .setSubject(user.id)
      .setIssuer(ISSUER)
      .setAudience(AUDIENCE)
      .setIssuedAt()
      .setJti(crypto.randomUUID())
      .setExpirationTime(this.ttl)
      .sign(this.key);
    const exp = decodeJwt(token).exp ?? 0;
    return { token, expiresAt: new Date(exp * 1000).toISOString() };
  }

  /** Returns the user id (sub) of a valid token, or throws 401. */
  async verify(token: string): Promise<string> {
    try {
      const { payload } = await jwtVerify(token, this.key, { issuer: ISSUER, audience: AUDIENCE, algorithms: ['HS256'] });
      if (typeof payload.sub !== 'string' || !payload.sub) throw new Error('missing sub');
      return payload.sub;
    } catch (err) {
      const expired = (err as { code?: string }).code === 'ERR_JWT_EXPIRED';
      throw new ApiError(401, expired ? 'TOKEN_EXPIRED' : 'INVALID_TOKEN', expired ? 'The session has expired — sign in again.' : 'The bearer token is invalid.');
    }
  }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function loadActiveUser(q: Queryable, id: string): Promise<AuthUser | null> {
  if (!UUID_RE.test(id)) return null;
  const { rows } = await q.query<{ id: string; email: string; name: string; role: string; active: boolean }>('SELECT id, email, name, role, active FROM users WHERE id = $1', [id]);
  const u = rows[0];
  if (!u || !u.active || !isRole(u.role)) return null;
  return { id: u.id, email: u.email, name: u.name, role: u.role };
}

/** onRequest hook: authenticate (unless the route is public) and enforce the route's permission. */
export function authHook(q: Queryable, tokens: TokenService) {
  return async function (req: FastifyRequest): Promise<void> {
    req.user = null;
    req.auditState = { written: false, staged: false };
    const cfg = req.routeOptions?.config ?? {};
    if (cfg.public || req.is404 || req.method === 'OPTIONS') return;

    const header = req.headers.authorization;
    const m = typeof header === 'string' ? /^Bearer\s+([A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+)\s*$/i.exec(header) : null;
    if (!m) throw unauthorized();
    const userId = await tokens.verify(m[1]);
    const user = await loadActiveUser(q, userId);
    if (!user) throw new ApiError(401, 'INVALID_TOKEN', 'The account for this token no longer exists or is deactivated.');
    req.user = user;

    if (cfg.permission) requirePermission(req, cfg.permission);
    if (cfg.anyPermission && !cfg.anyPermission.some((p) => can(user.role, p))) {
      throw forbidden(`Your role (${user.role}) needs one of: ${cfg.anyPermission.join(', ')}.`, { required: cfg.anyPermission });
    }
  };
}

export function requireUser(req: FastifyRequest): AuthUser {
  if (!req.user) throw unauthorized();
  return req.user;
}

export function requirePermission(req: FastifyRequest, permission: Permission): AuthUser {
  const user = requireUser(req);
  if (!can(user.role, permission)) throw forbidden(`Your role (${user.role}) does not have the "${permission}" permission.`, { required: [permission] });
  return user;
}

export function requireAll(req: FastifyRequest, permissions: Permission[], context: string): AuthUser {
  const user = requireUser(req);
  const missing = [...new Set(permissions)].filter((p) => !can(user.role, p));
  if (missing.length) throw forbidden(`Your role (${user.role}) cannot ${context}: missing ${missing.join(', ')}.`, { required: missing });
  return user;
}
