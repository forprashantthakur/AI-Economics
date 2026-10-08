import { computeProject, defaultCatalog, sampleProjects, type Catalog, type ProjectResult } from '@aies/engine';

export interface Sample {
  key: 'ap' | 'cs' | 'rfp';
  result: ProjectResult;
}

let cache: { catalog: Catalog; samples: Sample[] } | null = null;

export function samples(): { catalog: Catalog; samples: Sample[] } {
  if (cache) return cache;
  const catalog = defaultCatalog();
  const keys: Sample['key'][] = ['ap', 'cs', 'rfp'];
  cache = { catalog, samples: sampleProjects(catalog).map((p, i) => ({ key: keys[i], result: computeProject(p, catalog) })) };
  return cache;
}

/** File names in a zip archive, read from the central directory (no dependency on a zip library). */
export function zipEntries(bytes: Uint8Array): string[] {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65_557); i--) {
    if (dv.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('Not a zip archive (no end-of-central-directory record)');
  const count = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  const names: string[] = [];
  const dec = new TextDecoder();
  for (let k = 0; k < count; k++) {
    if (dv.getUint32(p, true) !== 0x02014b50) throw new Error('Corrupt central directory');
    const nameLen = dv.getUint16(p + 28, true);
    const extraLen = dv.getUint16(p + 30, true);
    const commentLen = dv.getUint16(p + 32, true);
    names.push(dec.decode(bytes.subarray(p + 46, p + 46 + nameLen)));
    p += 46 + nameLen + extraLen + commentLen;
  }
  return names;
}

export const latin1 = (bytes: Uint8Array, n = bytes.length): string => {
  let s = '';
  for (let i = 0; i < Math.min(n, bytes.length); i++) s += String.fromCharCode(bytes[i]);
  return s;
};
