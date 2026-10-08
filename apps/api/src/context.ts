import type { Config } from './config';
import type { Db } from './db/adapter';
import type { TokenService } from './auth';
import type { ComputeService } from './engine-service';

/** Simple per-process limiter for failed logins (use a gateway limiter across replicas). */
export class LoginLimiter {
  private readonly failures = new Map<string, number[]>();

  constructor(
    private readonly maxFailures = 10,
    private readonly windowMs = 15 * 60 * 1000,
  ) {}

  private recent(key: string, now: number): number[] {
    const list = (this.failures.get(key) ?? []).filter((t) => now - t < this.windowMs);
    if (list.length) this.failures.set(key, list);
    else this.failures.delete(key);
    return list;
  }

  /** Seconds until another attempt is allowed, or 0. */
  retryAfter(key: string, now = Date.now()): number {
    const list = this.recent(key, now);
    if (list.length < this.maxFailures) return 0;
    return Math.max(1, Math.ceil((list[0] + this.windowMs - now) / 1000));
  }

  fail(key: string, now = Date.now()): void {
    const list = this.recent(key, now);
    list.push(now);
    this.failures.set(key, list);
    if (this.failures.size > 10_000) this.failures.delete(this.failures.keys().next().value as string);
  }

  reset(key: string): void {
    this.failures.delete(key);
  }
}

export interface AppContext {
  db: Db;
  cfg: Config;
  tokens: TokenService;
  compute: ComputeService;
  loginLimiter: LoginLimiter;
}
