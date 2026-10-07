"""Scan the built site for forbidden claims (post-results tooling).

    uv run --with playwright python scripts/scan_forbidden.py /tmp/voldrag-verify/forbidden_claims.txt \
        --url http://127.0.0.1:4173/ [--out-dir web/out]

The patterns file lives OUTSIDE the repository and is never committed. Each line is
"<scope><TAB><python regex>", applied with re.IGNORECASE:
  prose  rendered innerText of p, li, h1–h4, figcaption, summary, .lead, .callout, .chip, .banner,
         button, label, collected in every page state (scripts/site_walk.py);
  any    the same prose, plus the raw files web/out/**/*.{html,js,txt}.
Prints every hit with ±80 characters of context and exits 1 on any hit.
"""

from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
from site_walk import walk

PROSE = "p, li, h1, h2, h3, h4, figcaption, summary, .lead, .callout, .chip, .banner, button, label"


def load(path: Path) -> list[tuple[str, re.Pattern, str]]:
    out = []
    for ln in path.read_text(encoding="utf-8").splitlines():
        if not ln.strip() or ln.startswith("#"):
            continue
        scope, pat = ln.split("\t", 1)
        out.append((scope.strip(), re.compile(pat, re.IGNORECASE), pat))
    return out


def ctx(text: str, m: re.Match) -> str:
    return text[max(0, m.start() - 80): m.end() + 80].replace("\n", " ")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("patterns")
    ap.add_argument("--url", required=True)
    ap.add_argument("--out-dir", default=str(ROOT / "web" / "out"))
    args = ap.parse_args()
    pats = load(Path(args.patterns))

    prose: set[str] = set()

    def collect(page, _state):
        for t in page.evaluate(f"() => [...document.querySelectorAll('{PROSE}')].map(e => e.innerText)"):
            if t and t.strip():
                prose.add(t)

    states = walk(args.url, collect)
    hits = []
    for scope, rx, pat in pats:
        for t in prose:
            for m in rx.finditer(t):
                hits.append(("prose", pat, ctx(t, m)))
        if scope == "any":
            for f in Path(args.out_dir).rglob("*"):
                if f.suffix in (".html", ".js", ".txt") and f.is_file():
                    text = f.read_text(encoding="utf-8", errors="replace")
                    for m in rx.finditer(text):
                        hits.append((str(f.relative_to(args.out_dir)), pat, ctx(text, m)))
    print(f"states: {len(states)} · prose blocks: {len(prose)} · patterns: {len(pats)}")
    for where, pat, c in hits:
        print(f"HIT [{where}] /{pat}/\n    …{c}…")
    print("FORBIDDEN HIT" if hits else "clean: no forbidden claim in rendered prose or raw build files")
    return 1 if hits else 0


if __name__ == "__main__":
    sys.exit(main())
