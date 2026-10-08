/**
 * A compact Excel formula evaluator for the subset of the language the model
 * workbook uses (arithmetic, comparison, &, ranges, defined names, IF, IFERROR,
 * AND, OR, NOT, MIN, MAX, SUM, SUMPRODUCT, SUMIF, SUMIFS, COUNTIF, COUNTIFS,
 * INDEX, MATCH, ABS, INT, ROUND).
 *
 * It exists so every formula cell can carry a correct cached result (the file
 * displays correctly before recalculation in any viewer, in Node and in the
 * browser) and so tests can prove the formulas reproduce the engine without
 * needing a spreadsheet application. LibreOffice recalculation is verified
 * separately.
 */

export class XlError {
  constructor(public readonly code: string) {}
  toString(): string {
    return this.code;
  }
}

export type Scalar = number | string | boolean | null | XlError;

export class Arr {
  constructor(
    public readonly rows: number,
    public readonly cols: number,
    public readonly data: Scalar[],
  ) {}
  get(r: number, c: number): Scalar {
    return this.data[r * this.cols + c];
  }
  static of(rows: number, cols: number, fn: (r: number, c: number) => Scalar): Arr {
    const d: Scalar[] = [];
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) d.push(fn(r, c));
    return new Arr(rows, cols, d);
  }
}

export type Value = Scalar | Arr;

class Thrown extends Error {
  constructor(public readonly err: XlError) {
    super(err.code);
  }
}

const err = (code: string): never => {
  throw new Thrown(new XlError(code));
};

// ───────────────────────────── AST ─────────────────────────────

export interface RefNode {
  k: 'ref';
  sheet: string | null;
  r1: number;
  c1: number;
  r2: number;
  c2: number;
}
type Node =
  | { k: 'num'; v: number }
  | { k: 'str'; v: string }
  | { k: 'bool'; v: boolean }
  | RefNode
  | { k: 'name'; v: string }
  | { k: 'fn'; name: string; args: Node[] }
  | { k: 'un'; op: string; e: Node }
  | { k: 'bin'; op: string; l: Node; r: Node };

type Tok = { t: 'num' | 'str' | 'id' | 'ref' | 'op' | 'sheet' | '(' | ')' | ',' | ':' | 'eof'; v: string };

const CELL_RE = /^\$?([A-Z]{1,3})\$?(\d+)$/;

export function colToNum(col: string): number {
  let n = 0;
  for (const ch of col) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n;
}

function tokenize(src: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (ch === ' ' || ch === '\n' || ch === '\t') {
      i++;
      continue;
    }
    if (/[0-9.]/.test(ch)) {
      const m = /^(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?/.exec(src.slice(i))!;
      out.push({ t: 'num', v: m[0] });
      i += m[0].length;
      continue;
    }
    if (ch === '"') {
      let j = i + 1;
      let s = '';
      while (j < src.length) {
        if (src[j] === '"') {
          if (src[j + 1] === '"') {
            s += '"';
            j += 2;
            continue;
          }
          break;
        }
        s += src[j++];
      }
      out.push({ t: 'str', v: s });
      i = j + 1;
      continue;
    }
    if (ch === "'") {
      let j = i + 1;
      let s = '';
      while (j < src.length) {
        if (src[j] === "'") {
          if (src[j + 1] === "'") {
            s += "'";
            j += 2;
            continue;
          }
          break;
        }
        s += src[j++];
      }
      if (src[j + 1] !== '!') throw new Error(`Bad sheet reference in ${src}`);
      out.push({ t: 'sheet', v: s });
      i = j + 2;
      continue;
    }
    if (/[A-Za-z_$]/.test(ch)) {
      const m = /^[A-Za-z_$][A-Za-z0-9_.$]*/.exec(src.slice(i))!;
      const w = m[0];
      i += w.length;
      if (src[i] === '!') {
        out.push({ t: 'sheet', v: w });
        i++;
      } else if (CELL_RE.test(w.toUpperCase()) && src[i] !== '(') out.push({ t: 'ref', v: w.toUpperCase() });
      else out.push({ t: 'id', v: w });
      continue;
    }
    const two = src.slice(i, i + 2);
    if (two === '<=' || two === '>=' || two === '<>') {
      out.push({ t: 'op', v: two });
      i += 2;
      continue;
    }
    if ('+-*/^&=<>'.includes(ch)) {
      out.push({ t: 'op', v: ch });
      i++;
      continue;
    }
    if (ch === '(' || ch === ')' || ch === ',' || ch === ':') {
      out.push({ t: ch, v: ch });
      i++;
      continue;
    }
    throw new Error(`Unexpected character "${ch}" in formula ${src}`);
  }
  out.push({ t: 'eof', v: '' });
  return out;
}

const BIN_PREC: Record<string, number> = { '=': 1, '<>': 1, '<': 1, '>': 1, '<=': 1, '>=': 1, '&': 2, '+': 3, '-': 3, '*': 4, '/': 4, '^': 5 };

function parseRefParts(v: string): { r: number; c: number } {
  const m = CELL_RE.exec(v)!;
  return { r: Number(m[2]), c: colToNum(m[1]) };
}

export function parse(src: string): Node {
  const toks = tokenize(src);
  let p = 0;
  const peek = () => toks[p];
  const next = () => toks[p++];
  const expect = (t: Tok['t']) => {
    const k = next();
    if (k.t !== t) throw new Error(`Expected ${t} but got ${k.t} "${k.v}" in ${src}`);
    return k;
  };

  const primary = (): Node => {
    const t = next();
    switch (t.t) {
      case 'num':
        return { k: 'num', v: Number(t.v) };
      case 'str':
        return { k: 'str', v: t.v };
      case '(': {
        const e = expr(0);
        expect(')');
        return e;
      }
      case 'op':
        if (t.v === '-' || t.v === '+') return { k: 'un', op: t.v, e: unaryOperand() };
        break;
      case 'sheet': {
        const a = expect('ref');
        return rangeTail(t.v, a.v);
      }
      case 'ref':
        return rangeTail(null, t.v);
      case 'id': {
        const up = t.v.toUpperCase();
        if (peek().t === '(') {
          next();
          const args: Node[] = [];
          if (peek().t !== ')') {
            for (;;) {
              args.push(expr(0));
              if (peek().t === ',') {
                next();
                continue;
              }
              break;
            }
          }
          expect(')');
          return { k: 'fn', name: up, args };
        }
        if (up === 'TRUE') return { k: 'bool', v: true };
        if (up === 'FALSE') return { k: 'bool', v: false };
        return { k: 'name', v: t.v };
      }
    }
    throw new Error(`Unexpected token "${t.v}" in ${src}`);
  };

  // Excel binds unary minus tighter than ^.
  const unaryOperand = (): Node => primary();

  const rangeTail = (sheet: string | null, a: string): RefNode => {
    const s = parseRefParts(a);
    if (peek().t === ':') {
      next();
      let b = next();
      if (b.t === 'sheet') b = expect('ref');
      if (b.t !== 'ref') throw new Error(`Bad range in ${src}`);
      const e = parseRefParts(b.v);
      return { k: 'ref', sheet, r1: Math.min(s.r, e.r), c1: Math.min(s.c, e.c), r2: Math.max(s.r, e.r), c2: Math.max(s.c, e.c) };
    }
    return { k: 'ref', sheet, r1: s.r, c1: s.c, r2: s.r, c2: s.c };
  };

  const expr = (minPrec: number): Node => {
    let left = primary();
    for (;;) {
      const t = peek();
      if (t.t !== 'op') break;
      const prec = BIN_PREC[t.v];
      if (prec === undefined || prec < minPrec) break;
      next();
      const right = expr(t.v === '^' ? prec + 1 : prec + 1);
      left = { k: 'bin', op: t.v, l: left, r: right };
    }
    return left;
  };

  const e = expr(0);
  if (peek().t !== 'eof') throw new Error(`Trailing tokens in ${src}`);
  return e;
}

// ───────────────────────────── evaluation ─────────────────────────────

export interface EvalHost {
  /** Value of a single cell (evaluating its formula if needed). */
  cell(sheet: string, r: number, c: number): Scalar;
  /** Resolve a defined name to a reference. */
  name(n: string): RefNode | undefined;
}

function isArr(v: Value): v is Arr {
  return v instanceof Arr;
}

function scalarOf(v: Value): Scalar {
  if (isArr(v)) {
    if (v.rows === 1 && v.cols === 1) return v.data[0];
    return err('#VALUE!');
  }
  return v;
}

export function toNum(v: Scalar): number {
  if (v instanceof XlError) throw new Thrown(v);
  if (v === null) return 0;
  if (typeof v === 'number') return v;
  if (typeof v === 'boolean') return v ? 1 : 0;
  const s = v.trim();
  if (s === '') return 0;
  const n = Number(s);
  if (Number.isNaN(n)) return err('#VALUE!');
  return n;
}

function toStr(v: Scalar): string {
  if (v instanceof XlError) throw new Thrown(v);
  if (v === null) return '';
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
  if (typeof v === 'number') return String(Number.isInteger(v) ? v : Number(v.toPrecision(15)));
  return v;
}

function toBool(v: Scalar): boolean {
  if (v instanceof XlError) throw new Thrown(v);
  if (typeof v === 'boolean') return v;
  if (v === null) return false;
  if (typeof v === 'number') return v !== 0;
  const u = v.toUpperCase();
  if (u === 'TRUE') return true;
  if (u === 'FALSE') return false;
  return err('#VALUE!');
}

function typeRank(v: Scalar): number {
  if (typeof v === 'number' || v === null) return 0;
  if (typeof v === 'string') return 1;
  return 2;
}

function compare(a: Scalar, b: Scalar): number {
  if (a instanceof XlError) throw new Thrown(a);
  if (b instanceof XlError) throw new Thrown(b);
  // Blank compares as 0 against numbers and "" against text.
  if (a === null && typeof b === 'string') a = '';
  if (b === null && typeof a === 'string') b = '';
  if (a === null) a = typeof b === 'boolean' ? false : 0;
  if (b === null) b = typeof a === 'boolean' ? false : 0;
  const ra = typeRank(a);
  const rb = typeRank(b);
  if (ra !== rb) return ra - rb;
  if (typeof a === 'number' && typeof b === 'number') return a === b ? 0 : a < b ? -1 : 1;
  if (typeof a === 'string' && typeof b === 'string') {
    const x = a.toLowerCase();
    const y = b.toLowerCase();
    return x === y ? 0 : x < y ? -1 : 1;
  }
  const x = a ? 1 : 0;
  const y = b ? 1 : 0;
  return x - y;
}

function binScalar(op: string, a: Scalar, b: Scalar): Scalar {
  try {
    switch (op) {
      case '+':
        return toNum(a) + toNum(b);
      case '-':
        return toNum(a) - toNum(b);
      case '*':
        return toNum(a) * toNum(b);
      case '/': {
        const d = toNum(b);
        const nmr = toNum(a);
        if (d === 0) return new XlError('#DIV/0!');
        return nmr / d;
      }
      case '^':
        return Math.pow(toNum(a), toNum(b));
      case '&':
        return toStr(a) + toStr(b);
      case '=':
        return compare(a, b) === 0;
      case '<>':
        return compare(a, b) !== 0;
      case '<':
        return compare(a, b) < 0;
      case '>':
        return compare(a, b) > 0;
      case '<=':
        return compare(a, b) <= 0;
      case '>=':
        return compare(a, b) >= 0;
    }
  } catch (e) {
    if (e instanceof Thrown) return e.err;
    throw e;
  }
  throw new Error(`Unknown operator ${op}`);
}

function broadcast(a: Value, b: Value, fn: (x: Scalar, y: Scalar) => Scalar): Value {
  if (!isArr(a) && !isArr(b)) return fn(a, b);
  const A = isArr(a) ? a : null;
  const B = isArr(b) ? b : null;
  const rows = Math.max(A?.rows ?? 1, B?.rows ?? 1);
  const cols = Math.max(A?.cols ?? 1, B?.cols ?? 1);
  const at = (v: Value, r: number, c: number): Scalar => {
    if (!isArr(v)) return v;
    const rr = v.rows === 1 ? 0 : r;
    const cc = v.cols === 1 ? 0 : c;
    if (rr >= v.rows || cc >= v.cols) return new XlError('#N/A');
    return v.get(rr, cc);
  };
  return Arr.of(rows, cols, (r, c) => fn(at(a, r, c), at(b, r, c)));
}

function flatten(v: Value): Scalar[] {
  return isArr(v) ? v.data : [v];
}

interface Criterion {
  test: (v: Scalar) => boolean;
}

function criterion(crit: Scalar): Criterion {
  if (typeof crit === 'string') {
    const m = /^(<=|>=|<>|=|<|>)(.*)$/s.exec(crit);
    if (m) {
      const op = m[1];
      const raw = m[2];
      const num = raw.trim() !== '' && !Number.isNaN(Number(raw)) ? Number(raw) : null;
      return {
        test: (v) => {
          if (v instanceof XlError) return false;
          if (num !== null) {
            if (typeof v !== 'number') return op === '<>';
            switch (op) {
              case '<':
                return v < num;
              case '>':
                return v > num;
              case '<=':
                return v <= num;
              case '>=':
                return v >= num;
              case '=':
                return v === num;
              case '<>':
                return v !== num;
            }
          }
          const s = v === null ? '' : String(v).toLowerCase();
          const t = raw.toLowerCase();
          if (op === '=') return s === t;
          if (op === '<>') return s !== t;
          return false;
        },
      };
    }
    const asNum = crit.trim() !== '' && !Number.isNaN(Number(crit)) ? Number(crit) : null;
    const low = crit.toLowerCase();
    return {
      test: (v) => {
        if (v instanceof XlError) return false;
        if (asNum !== null && typeof v === 'number') return v === asNum;
        return typeof v === 'string' && v.toLowerCase() === low;
      },
    };
  }
  if (typeof crit === 'number') return { test: (v) => typeof v === 'number' && v === crit };
  if (typeof crit === 'boolean') return { test: (v) => v === crit };
  if (crit === null) return { test: (v) => v === null || v === '' };
  throw new Thrown(crit);
}

type Thunk = () => Value;

const FUNCS: Record<string, (args: Thunk[], ctx: { sheet: string }) => Value> = {
  IF: (a) => {
    const c = toBool(scalarOf(a[0]()));
    if (c) return a[1] ? a[1]() : true;
    return a[2] ? a[2]() : false;
  },
  IFERROR: (a) => {
    try {
      const v = a[0]();
      const s = isArr(v) ? v : v;
      if (s instanceof XlError) return a[1]();
      return s;
    } catch (e) {
      if (e instanceof Thrown) return a[1]();
      throw e;
    }
  },
  AND: (a) => a.every((t) => flatten(t()).every((x) => toBool(x))),
  OR: (a) => a.some((t) => flatten(t()).some((x) => toBool(x))),
  NOT: (a) => !toBool(scalarOf(a[0]())),
  ABS: (a) => Math.abs(toNum(scalarOf(a[0]()))),
  ROWS: (a) => asArr(a[0]()).rows,
  COUNTA: (a) => {
    let n = 0;
    for (const t of a) for (const x of flatten(t())) if (x !== null && x !== '') n++;
    return n;
  },
  ISNUMBER: (a) => {
    try {
      return typeof scalarOf(a[0]()) === 'number';
    } catch (e) {
      if (e instanceof Thrown) return false;
      throw e;
    }
  },
  INT: (a) => Math.floor(toNum(scalarOf(a[0]()))),
  ROUND: (a) => {
    const x = toNum(scalarOf(a[0]()));
    const d = toNum(scalarOf(a[1]()));
    const f = Math.pow(10, d);
    return Math.round(x * f) / f;
  },
  SUM: (a) => {
    let s = 0;
    for (const t of a) {
      const v = t();
      if (isArr(v)) {
        for (const x of v.data) {
          if (x instanceof XlError) throw new Thrown(x);
          if (typeof x === 'number') s += x;
        }
      } else s += toNum(v);
    }
    return s;
  },
  MIN: (a) => agg(a, Math.min),
  MAX: (a) => agg(a, Math.max),
  SUMPRODUCT: (a) => {
    const arrs = a.map((t) => {
      const v = t();
      return isArr(v) ? v : new Arr(1, 1, [v]);
    });
    const n = arrs[0].data.length;
    for (const x of arrs) if (x.data.length !== n || x.rows !== arrs[0].rows) return err('#VALUE!');
    let s = 0;
    for (let i = 0; i < n; i++) {
      let p = 1;
      for (const x of arrs) {
        const e = x.data[i];
        if (e instanceof XlError) throw new Thrown(e);
        p *= typeof e === 'number' ? e : 0;
      }
      s += p;
    }
    return s;
  },
  SUMIF: (a) => {
    const range = asArr(a[0]());
    const c = criterion(scalarOf(a[1]()));
    const sumR = a[2] ? asArr(a[2]()) : range;
    let s = 0;
    range.data.forEach((v, i) => {
      if (c.test(v)) {
        const x = sumR.data[i];
        if (typeof x === 'number') s += x;
      }
    });
    return s;
  },
  SUMIFS: (a) => {
    const sumR = asArr(a[0]());
    const pairs: { r: Arr; c: Criterion }[] = [];
    for (let i = 1; i < a.length; i += 2) pairs.push({ r: asArr(a[i]()), c: criterion(scalarOf(a[i + 1]())) });
    let s = 0;
    sumR.data.forEach((x, i) => {
      if (pairs.every((p) => p.c.test(p.r.data[i])) && typeof x === 'number') s += x;
    });
    return s;
  },
  COUNTIF: (a) => {
    const range = asArr(a[0]());
    const c = criterion(scalarOf(a[1]()));
    return range.data.filter((v) => c.test(v)).length;
  },
  COUNTIFS: (a) => {
    const pairs: { r: Arr; c: Criterion }[] = [];
    for (let i = 0; i < a.length; i += 2) pairs.push({ r: asArr(a[i]()), c: criterion(scalarOf(a[i + 1]())) });
    let n = 0;
    for (let i = 0; i < pairs[0].r.data.length; i++) if (pairs.every((p) => p.c.test(p.r.data[i]))) n++;
    return n;
  },
  INDEX: (a) => {
    const arr = asArr(a[0]());
    const r = a[1] ? toNum(scalarOf(a[1]())) : 0;
    const c = a[2] ? toNum(scalarOf(a[2]())) : 0;
    if (arr.rows === 1 && a.length === 2) {
      if (r < 1 || r > arr.cols) return err('#REF!');
      return arr.get(0, r - 1);
    }
    if (arr.cols === 1 && a.length === 2) {
      if (r < 1 || r > arr.rows) return err('#REF!');
      return arr.get(r - 1, 0);
    }
    if (r === 0) return Arr.of(arr.rows, 1, (rr) => arr.get(rr, c - 1));
    if (c === 0) return Arr.of(1, arr.cols, (_r, cc) => arr.get(r - 1, cc));
    if (r < 1 || r > arr.rows || c < 1 || c > arr.cols) return err('#REF!');
    return arr.get(r - 1, c - 1);
  },
  MATCH: (a) => {
    const v = scalarOf(a[0]());
    const arr = asArr(a[1]());
    const type = a[2] ? toNum(scalarOf(a[2]())) : 1;
    if (type === 0) {
      for (let i = 0; i < arr.data.length; i++) if (arr.data[i] !== null && compare(arr.data[i], v) === 0) return i + 1;
      return err('#N/A');
    }
    let found = -1;
    for (let i = 0; i < arr.data.length; i++) {
      const x = arr.data[i];
      if (x === null) continue;
      if (type > 0 ? compare(x, v) <= 0 : compare(x, v) >= 0) found = i;
      else break;
    }
    if (found < 0) return err('#N/A');
    return found + 1;
  },
};

function asArr(v: Value): Arr {
  return isArr(v) ? v : new Arr(1, 1, [v]);
}

function agg(a: Thunk[], f: (...x: number[]) => number): number {
  const xs: number[] = [];
  for (const t of a) {
    const v = t();
    if (isArr(v)) {
      for (const x of v.data) {
        if (x instanceof XlError) throw new Thrown(x);
        if (typeof x === 'number') xs.push(x);
      }
    } else xs.push(toNum(v));
  }
  return xs.length ? f(...xs) : 0;
}

export function evaluate(node: Node, sheet: string, host: EvalHost): Value {
  const ev = (n: Node): Value => {
    switch (n.k) {
      case 'num':
        return n.v;
      case 'str':
        return n.v;
      case 'bool':
        return n.v;
      case 'ref':
        return refValue(n);
      case 'name': {
        const r = host.name(n.v);
        if (!r) return err('#NAME?');
        return refValue(r);
      }
      case 'un': {
        const v = ev(n.e);
        if (n.op === '+') return v;
        return isArr(v) ? Arr.of(v.rows, v.cols, (r, c) => binScalar('-', 0, v.get(r, c))) : binScalar('-', 0, v);
      }
      case 'bin': {
        const l = ev(n.l);
        const r = ev(n.r);
        const out = broadcast(l, r, (x, y) => binScalar(n.op, x, y));
        if (!isArr(out) && out instanceof XlError) throw new Thrown(out);
        return out;
      }
      case 'fn': {
        const f = FUNCS[n.name];
        if (!f) return err('#NAME?');
        return f(
          n.args.map((a) => () => ev(a)),
          { sheet },
        );
      }
    }
  };
  const refValue = (r: RefNode): Value => {
    const sh = r.sheet ?? sheet;
    if (r.r1 === r.r2 && r.c1 === r.c2) {
      const v = host.cell(sh, r.r1, r.c1);
      if (v instanceof XlError) throw new Thrown(v);
      return v;
    }
    return Arr.of(r.r2 - r.r1 + 1, r.c2 - r.c1 + 1, (rr, cc) => host.cell(sh, r.r1 + rr, r.c1 + cc));
  };
  return ev(node);
}

/** Evaluate a formula to a scalar; errors are returned as XlError values. */
export function evaluateFormula(formula: string, sheet: string, host: EvalHost): Scalar {
  try {
    const v = scalarOf(evaluate(parse(formula), sheet, host));
    // A formula that resolves to an empty cell displays 0 in Excel.
    return v === null ? 0 : v;
  } catch (e) {
    if (e instanceof Thrown) return e.err;
    throw e;
  }
}

export function parseName(ref: string): RefNode {
  const node = parse(ref);
  if (node.k !== 'ref') throw new Error(`Defined name target must be a reference: ${ref}`);
  return node;
}
