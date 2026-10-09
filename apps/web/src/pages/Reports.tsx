import { useMemo, useState } from 'react';
import { FileSpreadsheet, FileText, Presentation } from 'lucide-react';
import { saveFile } from '../lib/download';
import { REPORTS, reportModel, reportFileName, type ReportId, type ReportSection } from '@aies/reports';
import { Button, Callout, PageHeader, Panel, ReadOnlyNote, cx } from '../components/ui';
import { ChartFrame, Lines, StackedBars, SERIES, type SeriesDef } from '../components/charts';
import { useCan, useCurrentProject, useResult, useStore } from '../state/store';
import { compact, num, pct } from '../lib/format';

type Format = 'xlsx' | 'pdf' | 'pptx';

const MIME: Record<Format, string> = {
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pdf: 'application/pdf',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
};

export function Reports() {
  const project = useCurrentProject();
  const result = useResult(project);
  const { state, dispatch } = useStore();
  const canExport = useCan('report.export');
  const [selected, setSelected] = useState<ReportId>('executive-dashboard');
  const [busy, setBusy] = useState<Format | null>(null);
  const [error, setError] = useState<string | null>(null);

  const model = useMemo(() => (result ? reportModel(result, state.catalog, selected, { generatedBy: state.user.name }) : null), [result, state.catalog, selected, state.user.name]);

  if (!project || !result || !model) return <PageHeader title="Reports" description="Select a project first." />;

  const exportAs = async (format: Format) => {
    setBusy(format);
    setError(null);
    try {
      const r = await import('@aies/reports');
      const opts = { generatedBy: state.user.name };
      const bytes = format === 'xlsx' ? await r.buildXlsx(result, state.catalog, { focus: selected, ...opts }) : format === 'pdf' ? await r.buildPdf(result, state.catalog, selected, opts) : await r.buildPptx(result, state.catalog, selected, opts);
      const name = reportFileName(result, format === 'xlsx' ? 'model' : selected, format);
      const outcome = await saveFile(bytes, name, MIME[format]);
      if (outcome === 'failed') throw new Error('the file could not be saved in this view');
      if (outcome === 'declined') return;
      dispatch({ type: 'audit', action: `Exported ${format.toUpperCase()}`, detail: format === 'xlsx' ? 'Formula-driven financial model' : model.title, projectId: project.id });
    } catch (e) {
      setError(`The ${format.toUpperCase()} export failed: ${(e as Error).message}`);
    } finally {
      setBusy(null);
    }
  };

  const recon = result.reconciliation;
  const reconOk = recon.every((c) => c.pass);

  return (
    <div>
      <PageHeader
        title="Reports"
        description="Client-ready reports for the selected project. The preview, PDF and PowerPoint draw the same content, and the Excel model rebuilds the numbers with live formulas."
        actions={
          <>
            <Button icon={<FileSpreadsheet size={15} />} onClick={() => exportAs('xlsx')} disabled={!canExport || !!busy}>
              {busy === 'xlsx' ? 'Building…' : 'Excel model'}
            </Button>
            <Button icon={<FileText size={15} />} onClick={() => exportAs('pdf')} disabled={!canExport || !!busy}>
              {busy === 'pdf' ? 'Building…' : 'PDF'}
            </Button>
            <Button variant="primary" icon={<Presentation size={15} />} onClick={() => exportAs('pptx')} disabled={!canExport || !!busy}>
              {busy === 'pptx' ? 'Building…' : 'PowerPoint'}
            </Button>
          </>
        }
      />
      <ReadOnlyNote show={!canExport} what="export reports" />
      {error && (
        <div className="mb-4">
          <Callout tone="bad">{error}</Callout>
        </div>
      )}

      <div className="grid gap-5 lg:grid-cols-[300px_1fr] items-start">
        <nav aria-label="Reports" className="bg-paper border border-line rounded-[10px] p-1.5 lg:sticky lg:top-[76px]">
          {REPORTS.map((r) => (
            <button
              key={r.id}
              type="button"
              onClick={() => setSelected(r.id)}
              aria-current={selected === r.id ? 'true' : undefined}
              className={cx('w-full text-left rounded-md px-3 py-2.5 transition-colors', selected === r.id ? 'bg-brand-tint' : 'hover:bg-sunken')}
            >
              <div className={cx('text-[14px] font-semibold', selected === r.id ? 'text-brand' : 'text-ink')}>{r.title}</div>
              <div className="text-[12.5px] text-ink-3 leading-snug mt-0.5 line-clamp-2">{r.description}</div>
            </button>
          ))}
          <div className="border-t border-line-soft mt-1.5 pt-2.5 px-3 pb-2 text-[12.5px] text-ink-3 leading-snug">
            The Excel model covers all reports in one workbook: about 6,000 formulas with an engine column and a check beside each key result.
          </div>
        </nav>

        <article className="bg-paper border border-line rounded-[10px] px-5 sm:px-8 py-7 min-w-0" aria-label={model.title}>
          <header className="border-b border-line pb-5 mb-6">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <h2 className="font-serif text-[26px] leading-tight font-semibold text-ink">{model.title}</h2>
                <p className="text-ink-2 mt-1">{model.subtitle}</p>
              </div>
            </div>
            <dl className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-3 text-[13px]">
              <div>
                <dt className="text-ink-3">Client</dt>
                <dd className="text-ink font-semibold">{model.clientName}</dd>
              </div>
              <div>
                <dt className="text-ink-3">Project</dt>
                <dd className="text-ink font-semibold">{model.projectName}</dd>
              </div>
              <div>
                <dt className="text-ink-3">Prepared</dt>
                <dd className="text-ink">{new Date(model.generatedAt).toLocaleDateString('en-IN', { dateStyle: 'medium' })}</dd>
              </div>
              <div>
                <dt className="text-ink-3">Reconciliation</dt>
                <dd className={reconOk ? 'text-good font-semibold' : 'text-bad font-semibold'}>{reconOk ? `${recon.length} of ${recon.length} checks pass` : `${recon.filter((c) => !c.pass).length} checks fail`}</dd>
              </div>
            </dl>
          </header>

          <div className="space-y-8">
            {model.sections.map((s, i) => (
              <ReportSectionView key={i} section={s} currency={model.currency} />
            ))}
          </div>

          <footer className="mt-10 pt-4 border-t border-line text-[12.5px] text-ink-3 leading-relaxed">{model.disclaimer}</footer>
        </article>
      </div>
    </div>
  );
}

function ReportSectionView({ section: s, currency }: { section: ReportSection; currency: string }) {
  return (
    <section>
      <h3 className="text-[18px] font-semibold text-ink mb-2">{s.heading}</h3>
      {s.paragraphs?.map((p, i) => (
        <p key={i} className="text-[14.5px] text-ink-2 leading-relaxed mb-2 max-w-[78ch]">
          {p}
        </p>
      ))}
      {s.kpis && s.kpis.length > 0 && (
        <div className="grid gap-px bg-line border border-line rounded-lg overflow-hidden my-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))' }}>
          {s.kpis.map((k, i) => (
            <div key={i} className="bg-paper px-3.5 py-2.5 min-w-0">
              <div className="text-[12.5px] text-ink-3">{k.label}</div>
              <div className="num text-[18px] font-semibold text-ink truncate">{k.value}</div>
              {k.note && <div className="text-[12px] text-ink-3 leading-snug">{k.note}</div>}
            </div>
          ))}
        </div>
      )}
      {s.chart && <ReportChartView chart={s.chart} currency={currency} />}
      {s.table && (
        <div className="scroll-x my-3 border border-line rounded-lg">
          <table className="dtable" style={{ minWidth: Math.min(1100, s.table.columns.length * 120) }}>
            <thead>
              <tr>
                {s.table.columns.map((c, i) => (
                  <th key={i} className={s.table!.align?.[i] === 'right' ? 'r' : ''}>
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {s.table.rows.map((r, i) => (
                <tr key={i}>
                  {r.map((c, j) => (
                    <td key={j} className={s.table!.align?.[j] === 'right' ? 'r' : ''}>
                      {c}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
            {s.table.footer && (
              <tfoot>
                <tr>
                  {s.table.footer.map((c, j) => (
                    <td key={j} className={s.table!.align?.[j] === 'right' ? 'r' : ''}>
                      {c}
                    </td>
                  ))}
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      )}
    </section>
  );
}

function ReportChartView({ chart, currency }: { chart: NonNullable<ReportSection['chart']>; currency: string }) {
  const fmt = (v: number) => (chart.valueFormat === 'currency' ? compact(v, currency) : chart.valueFormat === 'percent' ? pct(v, 0) : num(v));
  const series: SeriesDef[] = chart.series.map((s, i) => ({ key: `s${i}`, label: s.name, color: SERIES[i % SERIES.length] }));
  const data = chart.categories.map((c, i) => ({ c, ...Object.fromEntries(chart.series.map((s, j) => [`s${j}`, s.values[i] ?? 0])) }));
  return (
    <ChartFrame
      className="my-3"
      title={chart.title}
      legend={series}
      legendShape={chart.kind === 'line' ? 'line' : 'rect'}
      table={{ columns: ['', ...chart.series.map((s) => s.name)], rows: chart.categories.map((c, i) => [c, ...chart.series.map((s) => fmt(s.values[i] ?? 0))]) }}
    >
      {chart.kind === 'line' ? (
        <Lines data={data} series={series} xKey="c" format={fmt} height={240} />
      ) : (
        <StackedBars data={data} series={series} xKey="c" format={fmt} stacked={chart.kind === 'stacked-bar'} height={240} />
      )}
    </ChartFrame>
  );
}
