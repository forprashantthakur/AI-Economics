/**
 * Thin wrapper around the engine: converts engine exceptions into 422
 * responses and keeps a small LRU of results keyed by (project id, project
 * version, catalogue version) so dashboards that hit compute, variance,
 * scenarios and rate cards in quick succession compute once.
 */
import { computeProject, type Catalog, type Project, type ProjectResult } from '@aies/engine';
import { ApiError } from './errors';

export function engineCall<T>(what: string, fn: () => T): T {
  try {
    return fn();
  } catch (err) {
    if (err instanceof ApiError) throw err;
    const message = err instanceof Error ? err.message : String(err);
    throw new ApiError(422, 'COMPUTE_FAILED', `The engine could not ${what}: ${message}`);
  }
}

export class ComputeService {
  private readonly cache = new Map<string, ProjectResult>();

  constructor(private readonly maxEntries = 6) {}

  /** Full computeProject (with packages). `cacheKey` = `${id}@${version}`; omit for ad-hoc projects. */
  compute(project: Project, catalog: Catalog, cacheKey?: string): ProjectResult {
    const key = cacheKey ? `${cacheKey}|${catalog.version}` : null;
    if (key) {
      const hit = this.cache.get(key);
      if (hit) {
        // refresh LRU position
        this.cache.delete(key);
        this.cache.set(key, hit);
        return hit;
      }
    }
    const result = engineCall('compute the project', () => computeProject(project, catalog));
    if (key && this.maxEntries > 0) {
      this.cache.set(key, result);
      while (this.cache.size > this.maxEntries) this.cache.delete(this.cache.keys().next().value as string);
    }
    return result;
  }

  clear(): void {
    this.cache.clear();
  }
}
