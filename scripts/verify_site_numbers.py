"""Hop 2 of the site check: every rendered number equals web/public/data (post-results tooling).

    uv run --with playwright python scripts/verify_site_numbers.py --url http://127.0.0.1:4173/

Walks every page state (scripts/site_walk.py). In each state it collects:
- every [data-src] / [data-expr] element (<Num>, <Txt>): the text is parsed back to a number and checked
  against the JSON value (or the expression recomputed here) at the element's data-d decimals;
- every text line inside <main> outside those elements, <svg> and <output data-input> (formula arithmetic
  on user input): any digit not explained by scripts/number_allowlist.txt is reported.
Exits 1 on any mismatch or unexplained number; writes a JSON report.
"""

from __future__ import annotations

import argparse
import json
import math
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
from site_walk import walk

STEMS = ("performance", "crisis_2020", "drag", "provenance", "submission_simulation",
         "exploratory_turnover_regularization", "assets_drag", "method")

# ---------------------------------------------------------------- expressions (same grammar as web/src/lib/expr.ts)
FN = {
    "sub": lambda a, b: a - b, "add": lambda a, b: a + b, "mul": lambda a, b: a * b, "ratio": lambda a, b: a / b,
    "neg": lambda a: -a, "abs": abs, "max": max, "min": min, "absmax": lambda *a: max(abs(x) for x in a),
    "halfsq": lambda s: s * s / 200, "sharpe": lambda mu, rf, sigma: (mu - 100 * rf) / sigma,
    "pctchg": lambda a, b: 100 * (b / a - 1),
}


def resolve(data: dict, path: str):
    cur = data
    for key in path.split("."):
        if isinstance(cur, list):
            cur = cur[int(key)]
        else:
            cur = cur[key]
    return cur


def eval_expr(data: dict, src: str) -> float:
    s = re.sub(r"\s+", "", src)
    i = 0

    def parse():
        nonlocal i
        m = re.match(r"[A-Za-z_][A-Za-z0-9_]*", s[i:])
        if m and i + m.end() < len(s) and s[i + m.end()] == "(" and m.group(0) in FN:
            i += m.end() + 1
            args = []
            while s[i] != ")":
                args.append(parse())
                if s[i] == ",":
                    i += 1
            i += 1
            return FN[m.group(0)](*args)
        tok = re.match(r"[^,()]+", s[i:]).group(0)
        i += len(tok)
        return float(tok) if re.match(r"-?\d", tok) else float(resolve(data, tok))

    v = parse()
    if i != len(s):
        raise ValueError(f"bad expr {src}")
    return v


def parse_shown(text: str) -> tuple[float | None, int]:
    t = text.strip().replace("−", "-").replace("±", "").replace("+", "").replace(",", "")
    t = re.sub(r"%p?$", "", t)
    if t in ("—", ""):
        return None, 0
    dec = len(t.split(".")[1]) if "." in t else 0
    return float(t), dec


# ---------------------------------------------------------------- page collection
COLLECT_JS = r"""() => {
  const nums = [...document.querySelectorAll('main [data-src], main [data-expr]')].map(e => ({
    src: e.dataset.src || null, expr: e.dataset.expr || null, d: e.dataset.d === undefined ? null : Number(e.dataset.d),
    kind: e.dataset.kind || 'num', text: e.textContent }));
  const main = document.querySelector('main').cloneNode(true);
  main.querySelectorAll('[data-src], [data-expr], svg, output[data-input], script, style, template, [hidden]')
      .forEach(e => e.replaceWith(document.createTextNode(' ⟦v⟧ ')));
  const BLOCK = 'p,li,td,th,div,h1,h2,h3,h4,dt,dd,button,summary,figcaption,label,pre,section,article,figure,tr,ol,ul,table,nav,span.chip';
  main.querySelectorAll(BLOCK).forEach(e => e.appendChild(document.createTextNode('\n')));
  const lines = main.textContent.split('\n').map(s => s.replace(/\s+/g, ' ').trim()).filter(s => /\d/.test(s));
  return { nums, lines };
}"""


def load_allowlist(path: Path) -> list[re.Pattern]:
    pats = []
    for ln in path.read_text(encoding="utf-8").splitlines():
        if not ln.strip() or ln.lstrip().startswith("#"):
            continue
        pat = ln.split("  # source:")[0].rstrip()
        pats.append(re.compile(pat))
    return pats


def unexplained(line: str, allow: list[re.Pattern]) -> str | None:
    rest = line
    for p in allow:
        rest = p.sub(" ", rest)
    return rest if re.search(r"\d", rest) else None


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--url", required=True)
    ap.add_argument("--data", default=str(ROOT / "web" / "public" / "data"))
    ap.add_argument("--allowlist", default=str(ROOT / "scripts" / "number_allowlist.txt"))
    ap.add_argument("--out", default="/tmp/voldrag-verify/site_numbers.json")
    args = ap.parse_args()
    data = {s: json.loads((Path(args.data) / f"{s}.json").read_text(encoding="utf-8")) for s in STEMS}
    allow = load_allowlist(Path(args.allowlist))

    seen_nums: dict[tuple, set] = {}
    lines: dict[str, set] = {}

    def collect(page, state):
        r = page.evaluate(COLLECT_JS)
        for n in r["nums"]:
            key = (n["src"], n["expr"], n["d"], n["kind"], n["text"])
            seen_nums.setdefault(key, set()).add(state)
        for ln in r["lines"]:
            lines.setdefault(ln, set()).add(state)

    states = walk(args.url, collect)

    mismatches, checked = [], 0
    for (src, expr, d, kind, text), st in seen_nums.items():
        checked += 1
        where = {"src": src, "expr": expr, "d": d, "kind": kind, "text": text, "states": sorted(st)[:3]}
        try:
            if kind == "text":
                if resolve(data, src) != text:
                    mismatches.append({**where, "why": "text differs"})
                continue
            v = eval_expr(data, expr) if expr else resolve(data, src)
            if kind == "plain":
                if str(v) != text:
                    mismatches.append({**where, "why": f"expected {v}"})
                continue
            shown, dec = parse_shown(text)
            if v is None or shown is None:
                if not (v is None and shown is None):
                    mismatches.append({**where, "why": f"null mismatch (json {v})"})
                continue
            if d is None or dec != d:
                mismatches.append({**where, "why": f"shows {dec} decimals, data-d={d}"})
            elif not math.isfinite(v) or abs(shown - round(v, d)) > 0.5 * 10 ** -d + 1e-9:
                mismatches.append({**where, "why": f"json {v} → {round(v, d)}"})
        except (KeyError, IndexError, ValueError, TypeError, ZeroDivisionError, AttributeError) as exc:
            mismatches.append({**where, "why": f"error: {exc}"})

    bad_lines = [{"line": ln, "rest": unexplained(ln, allow), "states": sorted(st)[:3]}
                 for ln, st in lines.items() if unexplained(ln, allow)]

    report = {"url": args.url, "states": len(states), "numbers_checked": checked,
              "mismatches": mismatches, "unexplained_numbers": bad_lines}
    Path(args.out).parent.mkdir(parents=True, exist_ok=True)
    Path(args.out).write_text(json.dumps(report, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"states visited: {len(states)} · distinct number renders checked: {checked}")
    print(f"mismatches: {len(mismatches)} · unexplained number lines: {len(bad_lines)}")
    for m in mismatches[:40]:
        print("  MISMATCH", m)
    for b in bad_lines[:60]:
        print("  UNEXPLAINED", b["line"][:160], "| states:", ",".join(b["states"]))
    print(f"report: {args.out}")
    return 1 if mismatches or bad_lines else 0


if __name__ == "__main__":
    sys.exit(main())
