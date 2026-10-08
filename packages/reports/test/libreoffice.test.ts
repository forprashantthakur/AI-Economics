/**
 * Recalculates the generated workbook in headless LibreOffice (cached results
 * are first overwritten with a sentinel so nothing can pass by reading them)
 * and checks every key formula against the engine within 0.01%.
 * Skipped when LibreOffice is not installed.
 */
import { describe, expect, it } from 'vitest';
import { buildXlsx } from '../src';
import { buildModelBook } from '../src/xlsx';
import { compareChecks, poisonCachedResults, recalcWithLibreOffice, sofficePath } from './libreoffice';
import { samples } from './helpers';

const HAS_SOFFICE = sofficePath() !== null;
const { catalog, samples: S } = samples();

describe.skipIf(!HAS_SOFFICE)('LibreOffice recalculation', () => {
  for (const s of S)
    it(`reproduces the engine for ${s.result.project.name}`, async () => {
      const clean = await buildXlsx(s.result, catalog);
      const { bytes, formulas } = await poisonCachedResults(clean);
      expect(formulas).toBeGreaterThan(3000);
      const { values } = await recalcWithLibreOffice(bytes);
      // No formula left with the sentinel or an error value.
      let stale = 0;
      let errors = 0;
      for (const v of values.values()) {
        if (v === -987654321) stale++;
        if (v && typeof v === 'object' && 'error' in (v as object)) errors++;
      }
      expect(stale).toBe(0);
      expect(errors).toBe(0);
      const checks = buildModelBook(s.result, catalog).book.checks;
      const out = compareChecks(checks, values, 1e-4);
      const failing = out.filter((o) => !o.pass);
      expect(failing.map((f) => `${f.sheet}!${f.address} ${f.label}: libre ${String(f.libre)} vs engine ${f.engine}`)).toEqual([]);
      const maxRel = Math.max(...out.map((o) => o.relDelta));
      expect(maxRel).toBeLessThan(1e-4);
      // Everything on the Checks sheet reads Pass after LibreOffice recalculation.
      const results = [...values.entries()].filter(([k]) => /^Checks!I\d+$/.test(k) && k !== 'Checks!I4').map(([, v]) => v);
      expect(results.length).toBe(checks.length);
      expect(results.every((v) => v === 'Pass')).toBe(true);
    }, 180_000);
});
