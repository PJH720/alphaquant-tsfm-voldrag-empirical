"""Shared browser walk for the site acceptance scripts (verify_site_numbers.py, scan_forbidden.py).

Opens the page in a fresh mobile context (390×844, no storage, no ?api), lets every lazily hydrated
section load, then visits every state: each [data-toggle] option once, and for every cost option the
[data-grid] slider through all its values. `walk(url, collect)` calls collect(page, state_name) after
each state and returns the list of state names.
"""

from __future__ import annotations

import os
from collections.abc import Callable

from playwright.sync_api import Error as PlaywrightError
from playwright.sync_api import Page, sync_playwright

VIEWPORT = {"width": 390, "height": 844}


def launch(p):
    exe = os.environ.get("CHROME_PATH")
    try:
        return p.chromium.launch(executable_path=exe, args=["--no-sandbox"]) if exe else p.chromium.launch()
    except PlaywrightError:
        return p.chromium.launch(executable_path="/usr/bin/google-chrome", args=["--no-sandbox"])


def hydrate_all(page: Page) -> None:
    """Scroll through the page so every lazy island and chart mounts, then return to the top."""
    height = page.evaluate("document.documentElement.scrollHeight")
    y = 0
    while y < height:
        page.evaluate(f"window.scrollTo(0, {y})")
        page.wait_for_timeout(120)
        y += 600
        height = page.evaluate("document.documentElement.scrollHeight")
    page.wait_for_load_state("networkidle")
    page.wait_for_timeout(400)
    # Open every <details> so toggles and tables inside them are reachable (their text is checked either way),
    # and render every section: content-visibility:auto skips off-screen sections, whose innerText is then empty.
    page.evaluate("document.querySelectorAll('main details').forEach(d => { d.open = true; })")
    page.add_style_tag(content="main > .slide { content-visibility: visible !important; }")
    page.wait_for_timeout(300)
    page.evaluate("window.scrollTo(0, 0)")


def _set_range(page: Page, handle, value: int) -> None:
    page.evaluate("""([el, v]) => {
        const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
        set.call(el, String(v));
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
    }""", [handle, value])


def _toggles(page: Page) -> list[tuple[str, str]]:
    return page.evaluate("""() => [...document.querySelectorAll('[data-toggle]')]
        .filter(b => b.offsetParent !== null || b.getClientRects().length)
        .map(b => [b.dataset.toggle, b.textContent.trim()])""")


def _click(page: Page, group: str, text: str) -> bool:
    loc = page.locator(f'[data-toggle="{group}"]', has_text=text)
    for i in range(loc.count()):
        b = loc.nth(i)
        if b.text_content().strip() != text:
            continue
        b.scroll_into_view_if_needed()
        page.wait_for_timeout(150)
        if not b.is_visible():
            continue
        before = b.get_attribute("aria-pressed") or b.get_attribute("aria-selected")
        b.click(timeout=5000)
        page.wait_for_timeout(200)
        after = b.get_attribute("aria-pressed") or b.get_attribute("aria-selected")
        if before == after and before != "true":  # not hydrated yet: wait and retry once
            page.wait_for_timeout(800)
            b.click(timeout=5000)
            page.wait_for_timeout(250)
        return True
    return False


def walk(url: str, collect: Callable[[Page, str], None], *, console: list | None = None) -> list[str]:
    states: list[str] = []
    with sync_playwright() as p:
        browser = launch(p)
        ctx = browser.new_context(viewport=VIEWPORT, is_mobile=True, has_touch=True, device_scale_factor=2)
        page = ctx.new_page()
        if console is not None:
            page.on("console", lambda m: console.append((m.type, m.text)))
            page.on("pageerror", lambda e: console.append(("pageerror", str(e))))
        page.goto(url, wait_until="load")
        hydrate_all(page)
        collect(page, "initial"); states.append("initial")

        seen: set[tuple[str, str]] = set()
        while True:
            todo = [t for t in _toggles(page) if tuple(t) not in seen]
            if not todo:
                break
            group, text = todo[0]
            seen.add((group, text))
            if _click(page, group, text):
                name = f"toggle:{group}={text}"
                collect(page, name); states.append(name)

        grid = page.locator("[data-grid]")
        if grid.count():
            costs = [t for g, t in _toggles(page) if g == "비용"] or [None]
            for cost in costs:
                if cost:
                    _click(page, "비용", cost)
                for i in range(grid.count()):
                    h = grid.nth(i)
                    h.scroll_into_view_if_needed()
                    lo, hi = int(h.get_attribute("min") or 0), int(h.get_attribute("max") or 0)
                    for v in range(lo, hi + 1):
                        _set_range(page, h.element_handle(), v)
                        page.wait_for_timeout(120)
                        name = f"grid:{h.get_attribute('data-grid')}={v}" + (f"@{cost}" if cost else "")
                        collect(page, name); states.append(name)
                    _set_range(page, h.element_handle(), lo)
        browser.close()
    return states
