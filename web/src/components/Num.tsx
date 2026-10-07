// Every result number on the site renders through <Num>, which reads it from the exported JSON
// (src = "<file stem>.<path>") or computes it from JSON values (expr, see lib/expr.ts) and tags
// the span so scripts/verify_site_numbers.py can check the rendered text against the data.
import { evalExpr, resolve } from "@/lib/expr";
import { fmt, signed } from "@/lib/format";

export type NumKind = "num" | "pct" | "signed" | "spct" | "pp" | "spp" | "int" | "plain";

export function formatNum(v: number, kind: NumKind, d: number): string {
  switch (kind) {
    case "pct": return `${fmt(v, d)}%`;
    case "signed": return signed(v, d);
    case "spct": return `${signed(v, d)}%`;
    case "pp": return `${fmt(v, d)}%p`;
    case "spp": return `${signed(v, d)}%p`;
    case "int": return fmt(v, 0);
    case "plain": return String(v);
    default: return fmt(v, d);
  }
}

export function numValue(src?: string, expr?: string): number | null {
  if (expr) return evalExpr(expr);
  const v = resolve(src!);
  if (v === null) return null;
  if (typeof v !== "number") throw new Error(`<Num> non-numeric: ${src}`);
  return v;
}

export default function Num({ src, expr, d = 2, kind = "num", strong = false }: {
  src?: string; expr?: string; d?: number; kind?: NumKind; strong?: boolean;
}) {
  const digits = kind === "int" || kind === "plain" ? 0 : d;
  const v = numValue(src, expr);
  const text = v === null ? "—" : formatNum(v, kind, digits);
  const props = { className: "num", "data-src": src, "data-expr": expr, "data-d": digits, "data-kind": kind };
  return strong ? <b {...props}>{text}</b> : <span {...props}>{text}</span>;
}

/** Verbatim text from the JSON (e.g. CHANGELOG amendments, submission caveats); checked as an exact string. */
export function Txt({ src }: { src: string }) {
  const v = resolve(src);
  if (typeof v !== "string") throw new Error(`<Txt> non-string: ${src}`);
  return <span data-src={src} data-kind="text">{v}</span>;
}
