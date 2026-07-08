// Sandboxed evaluator for trigger `if:` guards (docs/04 §2) — a cheap, declarative
// pre-filter over the normalized event payload. No eval, no function calls, no
// side effects. Grammar: || && ! ( ) == != < <= > >= in contains matches,
// string/number/bool/null/[list] literals, dotted identifiers against the context.
import { get } from './util.js';

function tokenize(src) {
  const toks = [];
  let i = 0;
  const s = String(src);
  while (i < s.length) {
    const c = s[i];
    if (/\s/.test(c)) { i++; continue; }
    const two = s.slice(i, i + 2);
    if (['==', '!=', '<=', '>=', '&&', '||'].includes(two)) { toks.push({ t: two }); i += 2; continue; }
    if ('()<>![],'.includes(c)) { toks.push({ t: c }); i++; continue; }
    if (c === "'" || c === '"') {
      let j = i + 1, out = '';
      while (j < s.length && s[j] !== c) { out += s[j] === '\\' ? s[++j] : s[j]; j++; }
      if (j >= s.length) throw new Error(`unterminated string at ${i}`);
      toks.push({ t: 'str', v: out }); i = j + 1; continue;
    }
    const num = s.slice(i).match(/^-?\d+(\.\d+)?/);
    if (num && (toks.length === 0 || !['str', 'num', 'ident', ')'].includes(toks[toks.length - 1].t))) {
      toks.push({ t: 'num', v: parseFloat(num[0]) }); i += num[0].length; continue;
    }
    const word = s.slice(i).match(/^[A-Za-z_][A-Za-z0-9_.\-[\]]*/);
    if (word) {
      const w = word[0];
      if (w === 'true') toks.push({ t: 'bool', v: true });
      else if (w === 'false') toks.push({ t: 'bool', v: false });
      else if (w === 'null') toks.push({ t: 'null', v: null });
      else if (['in', 'contains', 'matches', 'and', 'or', 'not'].includes(w)) toks.push({ t: w });
      else toks.push({ t: 'ident', v: w });
      i += w.length; continue;
    }
    throw new Error(`unexpected "${c}" at ${i}`);
  }
  return toks;
}

export function compileExpr(src) {
  const toks = tokenize(src);
  let pos = 0;
  const peek = () => toks[pos];
  const eat = (t) => { if (toks[pos]?.t !== t) throw new Error(`expected ${t}, got ${toks[pos]?.t ?? 'end'}`); return toks[pos++]; };

  function parseOr() {
    let node = parseAnd();
    while (peek() && (peek().t === '||' || peek().t === 'or')) { pos++; const r = parseAnd(); const l = node; node = (ctx) => !!(l(ctx) || r(ctx)); }
    return node;
  }
  function parseAnd() {
    let node = parseUnary();
    while (peek() && (peek().t === '&&' || peek().t === 'and')) { pos++; const r = parseUnary(); const l = node; node = (ctx) => !!(l(ctx) && r(ctx)); }
    return node;
  }
  function parseUnary() {
    if (peek() && (peek().t === '!' || peek().t === 'not')) { pos++; const e = parseUnary(); return (ctx) => !e(ctx); }
    return parseCmp();
  }
  function parseCmp() {
    const l = parseTerm();
    const op = peek()?.t;
    if (!['==', '!=', '<', '<=', '>', '>=', 'in', 'contains', 'matches'].includes(op)) return l;
    pos++;
    const r = parseTerm();
    return (ctx) => {
      const a = l(ctx), b = r(ctx);
      switch (op) {
        case '==': return String(a) === String(b) || a === b;
        case '!=': return !(String(a) === String(b) || a === b);
        case '<': return Number(a) < Number(b);
        case '<=': return Number(a) <= Number(b);
        case '>': return Number(a) > Number(b);
        case '>=': return Number(a) >= Number(b);
        case 'in': return Array.isArray(b) ? b.map(String).includes(String(a)) : String(b ?? '').includes(String(a ?? ''));
        case 'contains': return Array.isArray(a) ? a.map(String).includes(String(b)) : String(a ?? '').includes(String(b ?? ''));
        case 'matches': try { return new RegExp(String(b)).test(String(a ?? '')); } catch { return false; }
        default: return false;
      }
    };
  }
  function parseTerm() {
    const tk = peek();
    if (!tk) throw new Error('unexpected end of expression');
    if (tk.t === '(') { pos++; const e = parseOr(); eat(')'); return e; }
    if (tk.t === '[') {
      pos++;
      const items = [];
      while (peek() && peek().t !== ']') {
        items.push(parseTerm());
        if (peek()?.t === ',') pos++;
      }
      eat(']');
      return (ctx) => items.map((f) => f(ctx));
    }
    if (['str', 'num', 'bool', 'null'].includes(tk.t)) { pos++; return () => tk.v; }
    if (tk.t === 'ident') { pos++; return (ctx) => get(ctx, tk.v); }
    throw new Error(`unexpected ${tk.t}`);
  }

  const fn = parseOr();
  if (pos !== toks.length) throw new Error(`trailing tokens after position ${pos}`);
  return fn;
}

// Evaluate an if: guard. Parse errors are load-time lint; runtime errors fail
// CLOSED (no match) so a broken guard can't silently admit every event.
export function evalIf(src, ctx) {
  try { return !!compileExpr(src)(ctx); } catch { return false; }
}
