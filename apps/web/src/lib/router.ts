import { useEffect, useState } from 'react';

/** Hash-based routing so the app works as a static file, an artifact or behind any server. */
export type Route =
  | 'dashboard'
  | 'projects'
  | 'new-project'
  | 'project'
  | 'costing'
  | 'acu'
  | 'abu'
  | 'commercial'
  | 'value'
  | 'scenarios'
  | 'reports'
  | 'settings';

export interface Location {
  route: Route;
  /** Extra path segments after the route, e.g. #/project/sample-ap/actuals → ['sample-ap', 'actuals']. */
  params: string[];
  query: URLSearchParams;
}

const ROUTES: Route[] = ['dashboard', 'projects', 'new-project', 'project', 'costing', 'acu', 'abu', 'commercial', 'value', 'scenarios', 'reports', 'settings'];

export function parse(hash: string): Location {
  const [path, qs] = hash.replace(/^#\/?/, '').split('?');
  const parts = path.split('/').filter(Boolean);
  const route = (ROUTES.includes(parts[0] as Route) ? parts[0] : 'dashboard') as Route;
  return { route, params: parts.slice(1).map(decodeURIComponent), query: new URLSearchParams(qs ?? '') };
}

export function href(route: Route, ...params: string[]): string {
  return `#/${[route, ...params.map(encodeURIComponent)].join('/')}`;
}

export function navigate(route: Route, ...params: string[]): void {
  window.location.hash = href(route, ...params);
}

export function useLocation(): Location {
  const [loc, setLoc] = useState(() => parse(window.location.hash));
  useEffect(() => {
    const on = () => {
      setLoc(parse(window.location.hash));
      document.getElementById('main')?.scrollTo?.({ top: 0 });
      window.scrollTo?.({ top: 0 });
    };
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return loc;
}
