// Resolves <Num> sources against the exported JSON. The same grammar and functions are
// re-implemented in scripts/verify_site_numbers.py, which checks every rendered number.
//
//   path  := stem("." key)+          e.g. performance.performance.primary.10.proposed.sharpe
//   expr  := fn "(" arg ("," arg)* ")"   arg := expr | path | number
//
// Functions (all inputs in the JSON's own units; *_pct fields are percent):
//   sub(a,b) = a − b          add(a,b) = a + b        mul(a,b) = a·b        ratio(a,b) = a / b
//   neg(a) = −a               abs(a) = |a|            max(…), min(…)        absmax(…) = max |·|
//   halfsq(σ%) = σ²/200       (½σ² in percent, σ in percent)
//   sharpe(μ%, r_f, σ%) = (μ − 100·r_f) / σ   (r_f as a fraction, as in method.json RF)
//   pctchg(a,b) = 100·(b / a − 1)
import { DATA } from "./data";

export function resolve(path: string): unknown {
  let cur: unknown = DATA;
  for (const key of path.split(".")) {
    if (cur === null || typeof cur !== "object") throw new Error(`<Num> path not found: ${path}`);
    cur = (cur as Record<string, unknown>)[key];
    if (cur === undefined) throw new Error(`<Num> path not found: ${path}`);
  }
  return cur;
}

const FN: Record<string, (...a: number[]) => number> = {
  sub: (a, b) => a - b,
  add: (a, b) => a + b,
  mul: (a, b) => a * b,
  ratio: (a, b) => a / b,
  neg: (a) => -a,
  abs: (a) => Math.abs(a),
  max: (...a) => Math.max(...a),
  min: (...a) => Math.min(...a),
  absmax: (...a) => Math.max(...a.map(Math.abs)),
  halfsq: (s) => (s * s) / 200,
  sharpe: (mu, rf, sigma) => (mu - 100 * rf) / sigma,
  pctchg: (a, b) => 100 * (b / a - 1),
};

export function evalExpr(src: string): number {
  let i = 0;
  const s = src.replace(/\s+/g, "");
  const parse = (): number => {
    const m = /^[A-Za-z_][A-Za-z0-9_]*/.exec(s.slice(i));
    if (m && s[i + m[0].length] === "(" && FN[m[0]]) {
      i += m[0].length + 1;
      const args: number[] = [];
      while (s[i] !== ")") {
        args.push(parse());
        if (s[i] === ",") i++;
        else if (s[i] !== ")") throw new Error(`bad expr: ${src}`);
      }
      i++;
      return FN[m[0]](...args);
    }
    const tok = /^[^,()]+/.exec(s.slice(i));
    if (!tok) throw new Error(`bad expr: ${src}`);
    i += tok[0].length;
    if (/^-?\d/.test(tok[0])) return Number(tok[0]);
    const v = resolve(tok[0]);
    if (typeof v !== "number") throw new Error(`<Num> non-numeric: ${tok[0]}`);
    return v;
  };
  const v = parse();
  if (i !== s.length) throw new Error(`bad expr: ${src}`);
  return v;
}
