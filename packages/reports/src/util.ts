import type { Catalog, CostPool, ProjectResult } from '@aies/engine';
import { POOL_LABELS } from '@aies/engine';
import type { ReportId } from './types';
import { PRODUCT_NAME, REPORTS } from './types';

export function reportTitle(id: ReportId): string {
  return REPORTS.find((r) => r.id === id)?.title ?? id;
}

export function slug(s: string): string {
  return (s || 'project')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\(illustrative\)/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'project';
}

/** Deterministic download name, e.g. `accounts-payable-agent_ai-project-cost-estimate.pdf`. */
export function reportFileName(result: ProjectResult, report: ReportId | 'model', ext: 'xlsx' | 'pdf' | 'pptx'): string {
  const project = slug(result.project.name);
  const what = report === 'model' ? 'financial-model' : slug(reportTitle(report));
  return `${project}_${what}.${ext}`;
}

/** Normalise library output (Buffer / ArrayBuffer / view) to a plain Uint8Array without copying. */
export function toU8(data: ArrayBuffer | ArrayBufferView | Uint8Array): Uint8Array {
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  const v = data as ArrayBufferView;
  return new Uint8Array(v.buffer as ArrayBuffer, v.byteOffset, v.byteLength);
}

export const usesSampleRates = (catalog: Catalog): boolean => catalog.modelRates.some((m) => m.sample);

export function disclaimerText(result: ProjectResult, catalog: Catalog): string {
  const parts: string[] = [
    `Prepared with ${PRODUCT_NAME}. Figures are model estimates derived from the stated assumptions; they are not a quotation, invoice or audited forecast.`,
  ];
  if (usesSampleRates(catalog)) {
    parts.push(
      'Model and cloud rates in the catalogue are illustrative samples, not vendor quotes — verify every rate against current published or contracted prices before using these figures commercially.',
    );
  }
  if (result.project.illustrative) parts.push('Client names, volumes and benefits in this project are illustrative.');
  parts.push('Productivity (released hours) is non-cash and is reported separately from finance-validated benefits.');
  return parts.join(' ');
}

export function poolLabel(p: CostPool): string {
  return POOL_LABELS[p] ?? p;
}

export interface Names {
  workflow: (id: string) => string;
  agent: (id: string) => string;
  model: (id: string) => string;
  stream: (id: string) => string;
}

export function names(result: ProjectResult, catalog: Catalog): Names {
  const p = result.project;
  const wf = new Map(p.workflows.map((w) => [w.id, w.name]));
  const ag = new Map(p.agents.map((a) => [a.id, a.name]));
  const md = new Map(catalog.modelRates.map((m) => [m.id, m.model]));
  const st = new Map(p.pricing.streams.map((s) => [s.id, s.label]));
  for (const pk of result.packages) for (const s of pk.streams) if (!st.has(s.id)) st.set(s.id, s.label);
  return {
    workflow: (id) => wf.get(id) ?? (id === '_shared' ? 'Shared' : id),
    agent: (id) => ag.get(id) ?? (id === 'unassigned' || !id ? 'Unassigned' : id),
    model: (id) => md.get(id) ?? id,
    stream: (id) => st.get(id) ?? (id === 'unrecovered' ? 'Unrecovered' : id),
  };
}
