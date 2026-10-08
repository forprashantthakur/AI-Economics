/**
 * Test helper (Node only): recalculate a workbook with headless LibreOffice and
 * compare every registered check cell with its engine value.
 *
 * LibreOffice is forced to recalculate on load (OOXMLRecalcMode = 0, "always")
 * through a private user profile, so cached results written by exceljs are
 * discarded and every formula is evaluated by LibreOffice itself.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import ExcelJS from 'exceljs';

export function sofficePath(): string | null {
  for (const bin of ['soffice', 'libreoffice']) {
    const r = spawnSync('which', [bin], { encoding: 'utf8' });
    if (r.status === 0 && r.stdout.trim()) return r.stdout.trim();
  }
  return null;
}

const RECALC_XCU = `<?xml version="1.0" encoding="UTF-8"?>
<oor:items xmlns:oor="http://openoffice.org/2001/registry" xmlns:xs="http://www.w3.org/2001/XMLSchema" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
<item oor:path="/org.openoffice.Office.Calc/Formula/Load"><prop oor:name="OOXMLRecalcMode" oor:op="fuse"><value>0</value></prop></item>
<item oor:path="/org.openoffice.Office.Calc/Formula/Load"><prop oor:name="ODFRecalcMode" oor:op="fuse"><value>0</value></prop></item>
</oor:items>
`;

function ensureProfile(dir: string, soffice: string, sample: string): void {
  const reg = join(dir, 'user', 'registrymodifications.xcu');
  if (existsSync(reg) && readFileSync(reg, 'utf8').includes('OOXMLRecalcMode')) return;
  // First start initialises the profile (and rewrites the registry); then inject the recalc setting.
  if (!existsSync(reg)) {
    const out = join(dir, 'init-out');
    mkdirSync(out, { recursive: true });
    execFileSync(soffice, [`-env:UserInstallation=file://${dir}`, '--headless', '--convert-to', 'csv', '--outdir', out, sample], { stdio: 'ignore', timeout: 120_000 });
  }
  if (!existsSync(reg)) {
    mkdirSync(join(dir, 'user'), { recursive: true });
    writeFileSync(reg, RECALC_XCU);
    return;
  }
  const xml = readFileSync(reg, 'utf8');
  const items = RECALC_XCU.split('\n').filter((l) => l.startsWith('<item')).join('\n');
  writeFileSync(reg, xml.replace('</oor:items>', `${items}\n</oor:items>`));
}

export interface RecalcResult {
  /** Cell values after LibreOffice recalculation, keyed by "Sheet!A1". */
  values: Map<string, unknown>;
  outFile: string;
}

/** Recalculate `xlsx` in LibreOffice and read back all cell values. */
export async function recalcWithLibreOffice(xlsx: Uint8Array, workDir?: string): Promise<RecalcResult> {
  const soffice = sofficePath();
  if (!soffice) throw new Error('LibreOffice (soffice) is not installed');
  const base = workDir ?? mkdtempSync(join(process.env.AIES_LO_TMP ?? tmpdir(), 'aies-lo-'));
  try {
    return await recalcIn(base, soffice, xlsx);
  } finally {
    if (!workDir) rmSync(base, { recursive: true, force: true });
  }
}

async function recalcIn(base: string, soffice: string, xlsx: Uint8Array): Promise<RecalcResult> {
  const inDir = join(base, 'in');
  const outDir = join(base, 'out');
  const profile = join(base, 'profile');
  mkdirSync(inDir, { recursive: true });
  mkdirSync(outDir, { recursive: true });
  const input = join(inDir, 'model.xlsx');
  writeFileSync(input, xlsx);
  ensureProfile(profile, soffice, input);
  rmSync(join(outDir, 'model.xlsx'), { force: true });
  execFileSync(soffice, [`-env:UserInstallation=file://${profile}`, '--headless', '--calc', '--convert-to', 'xlsx:Calc Office Open XML', '--outdir', outDir, input], { stdio: 'ignore', timeout: 180_000 });
  const outFile = join(outDir, 'model.xlsx');
  if (!existsSync(outFile)) throw new Error('LibreOffice did not produce an output file');
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(readFileSync(outFile) as unknown as ArrayBuffer);
  const values = new Map<string, unknown>();
  wb.eachSheet((ws) =>
    ws.eachRow((row) =>
      row.eachCell((cell) => {
        const v = cell.value as unknown;
        const res = v && typeof v === 'object' && 'formula' in (v as object) ? (v as { result?: unknown }).result : v;
        values.set(`${ws.name}!${cell.address}`, res);
      }),
    ),
  );
  return { values, outFile };
}

export interface CheckOutcome {
  sheet: string;
  address: string;
  label: string;
  engine: number | string;
  libre: unknown;
  relDelta: number;
  pass: boolean;
}

/** Compare recalculated values with engine values at a relative tolerance (default 0.01%). */
export function compareChecks(
  checks: { sheet: string; address: string; label: string; engine: number | string }[],
  values: Map<string, unknown>,
  tolerance = 1e-4,
): CheckOutcome[] {
  return checks.map((c) => {
    const libre = values.get(`${c.sheet}!${c.address}`);
    if (typeof c.engine === 'string') {
      const pass = libre === undefined || libre === null || libre === '';
      return { ...c, libre, relDelta: pass ? 0 : Infinity, pass };
    }
    const v = typeof libre === 'number' ? libre : libre === undefined || libre === null ? 0 : NaN;
    const d = Math.abs(v - c.engine);
    const scale = Math.abs(c.engine);
    const rel = scale > 0 ? d / scale : d;
    const pass = Number.isFinite(d) && d <= Math.max(1e-6, scale * tolerance);
    return { ...c, libre, relDelta: Number.isFinite(rel) ? rel : Infinity, pass };
  });
}

/**
 * Replace every cached formula result with a sentinel so a recalculation test
 * cannot pass by reading back cached values.
 */
export async function poisonCachedResults(xlsx: Uint8Array, sentinel = -987654321): Promise<{ bytes: Uint8Array; formulas: number }> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(xlsx as unknown as ArrayBuffer);
  let formulas = 0;
  wb.eachSheet((ws) =>
    ws.eachRow((row) =>
      row.eachCell((cell) => {
        const v = cell.value as unknown;
        if (v && typeof v === 'object' && 'formula' in (v as object)) {
          cell.value = { formula: (v as { formula: string }).formula, result: sentinel } as ExcelJS.CellFormulaValue;
          formulas++;
        }
      }),
    ),
  );
  const buf = await wb.xlsx.writeBuffer();
  return { bytes: new Uint8Array(buf as ArrayBuffer), formulas };
}
