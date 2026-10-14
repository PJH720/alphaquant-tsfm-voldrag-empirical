"""The site works with the GPU backend offline (post-results tooling; run with the backend stopped).

    uv run --with playwright python scripts/verify_offline.py --url http://127.0.0.1:4173/

1. Fresh mobile context, no ?api: every section renders with text, the live section shows the
   "정적 모드" badge, there are no console errors, and no request leaves the site's own origin
   or a Vercel host (*.vercel.app; vercel.live serves the preview-only toolbar): fonts are self-hosted,
   nothing goes to trycloudflare.com.
2. Fresh context with ?api=https://invalid.example.invalid: the badge reports the backend as not
   responding within 10 s and no card in the live section is blank.
Exits 1 on any failure.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path
from urllib.parse import urlparse

sys.path.insert(0, str(Path(__file__).resolve().parent))
from playwright.sync_api import Error as PlaywrightError
from playwright.sync_api import sync_playwright
from site_walk import VIEWPORT, authorize, hydrate_all, launch


def vercel_host(host: str) -> bool:
    """Vercel's own hosts (deployment, preview toolbar). Anything else is a foreign request."""
    return host.endswith((".vercel.app", ".vercel.com", ".vercel.live")) or host in ("vercel.live", "vercel.com")


SECTIONS = ("hero", "compare", "costs", "lambda", "crisis", "curves", "drag", "vs", "significance", "live", "provenance")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--url", required=True)
    args = ap.parse_args()
    own = urlparse(args.url).netloc
    fails: list[str] = []
    with sync_playwright() as p:
        browser = launch(p)

        ctx = browser.new_context(viewport=VIEWPORT, is_mobile=True, has_touch=True)
        page = ctx.new_page()
        errors, foreign = [], []
        page.on("console", lambda m: m.type == "error" and errors.append(m.text))
        page.on("pageerror", lambda e: errors.append(str(e)))
        authorize(page)
        page.on("request", lambda r: (urlparse(r.url).netloc not in (own, "") and not vercel_host(urlparse(r.url).netloc)
                                      and not r.url.startswith("data:")) and foreign.append(r.url))
        page.goto(args.url, wait_until="load")
        hydrate_all(page)
        page.locator("#live").scroll_into_view_if_needed()
        page.wait_for_timeout(1500)
        for sid in SECTIONS:
            page.evaluate(f"document.getElementById('{sid}')?.scrollIntoView()")
            page.wait_for_timeout(250)
            n = page.evaluate(f"(document.getElementById('{sid}')?.innerText || '').trim().length")
            if n < 40:
                fails.append(f"section #{sid} is empty or missing ({n} chars)")
        badge = page.locator("#live .live-badge")
        badge_text = badge.inner_text() if badge.count() else ""
        if "정적 모드" not in badge_text:
            fails.append(f"live badge is not '정적 모드': {badge_text!r}")
        if errors:
            fails.append(f"{len(errors)} console error(s): {errors[:3]}")
        if foreign:
            fails.append(f"{len(foreign)} request(s) outside the site: {sorted(set(foreign))[:5]}")
        print(f"[offline] sections ok: {len(SECTIONS)} · badge: {badge_text!r} · console errors: {len(errors)} · foreign requests: {len(foreign)}")
        ctx.close()

        ctx = browser.new_context(viewport=VIEWPORT, is_mobile=True, has_touch=True)
        page = ctx.new_page()
        authorize(page)
        sep = "&" if "?" in args.url else "?"
        page.goto(f"{args.url}{sep}api=https://invalid.example.invalid#live", wait_until="load")
        page.locator("#live").scroll_into_view_if_needed()
        try:
            page.wait_for_function("() => (document.querySelector('#live .live-badge.static')?.innerText || '').includes('응답 없음')", timeout=10000)
            text = page.locator("#live .live-badge").inner_text()
        except PlaywrightError as exc:
            text = f"timeout: {exc}"
            fails.append("badge did not fall back to static within 10 s for an unreachable ?api")
        blank = page.evaluate("[...document.querySelectorAll('#live .card')].filter(c => !c.innerText.trim() || c.querySelector('.big')?.innerText.trim() === '').length")
        cards = page.evaluate("document.querySelectorAll('#live .card').length")
        if blank or not cards:
            fails.append(f"live section: {blank} blank card(s) of {cards}")
        print(f"[invalid ?api] badge: {text!r} · cards: {cards} · blank: {blank}")
        browser.close()
    for f in fails:
        print("FAIL", f)
    print("PASS" if not fails else f"FAIL ({len(fails)})")
    return 1 if fails else 0


if __name__ == "__main__":
    sys.exit(main())
