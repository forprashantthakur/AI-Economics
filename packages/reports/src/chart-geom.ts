/** Renderer-neutral chart helpers: nice axis ticks and value ranges. */
import type { ReportChart } from './types';

export function niceStep(range: number, target = 5): number {
  if (range <= 0 || !Number.isFinite(range)) return 1;
  const raw = range / target;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const f = raw / mag;
  const nf = f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10;
  return nf * mag;
}

/** Axis domain and ticks covering all values (stacked charts use per-category sums). */
export function axisFor(chart: ReportChart): { min: number; max: number; ticks: number[] } {
  let lo = 0;
  let hi = 0;
  if (chart.kind === 'stacked-bar') {
    chart.categories.forEach((_, i) => {
      let pos = 0;
      let neg = 0;
      for (const s of chart.series) {
        const v = s.values[i] ?? 0;
        if (v >= 0) pos += v;
        else neg += v;
      }
      hi = Math.max(hi, pos);
      lo = Math.min(lo, neg);
    });
  } else {
    for (const s of chart.series)
      for (const v of s.values) {
        if (!Number.isFinite(v)) continue;
        hi = Math.max(hi, v);
        lo = Math.min(lo, v);
      }
  }
  if (hi === lo) hi = lo + 1;
  const step = niceStep(hi - lo);
  const min = Math.floor(lo / step) * step;
  const max = Math.ceil(hi / step) * step;
  const ticks: number[] = [];
  for (let t = min; t <= max + step / 2; t += step) ticks.push(Math.abs(t) < step / 1e6 ? 0 : t);
  return { min, max, ticks };
}

export function maxAbs(chart: ReportChart): number {
  let m = 0;
  for (const s of chart.series) for (const v of s.values) if (Number.isFinite(v)) m = Math.max(m, Math.abs(v));
  return m;
}
