"""Render the panel in a real Home Assistant and report what came out.

The unit tests check the renderer's logic against stubs. They cannot see
a box drawn on top of another box, and that is exactly the bug that got
past 160 green tests into a merged branch: areas without a floor were
drawn on every floor, over rooms whose grid had been measured without
them.

So this drives the actual panel in a real browser against a real Home
Assistant and prints, per floor tab, what is on screen. It is a
*reporter*, not a test -- it has no opinion about what is correct. You
look at the numbers and the screenshots.

    python3 tools/live_check.py --password secret

Needs `playwright` and a Home Assistant reachable at --url, with the house
from tools/live_setup.py in it. See tools/README.md. It reads only, but
the setup script it belongs to writes to the registries -- so point both
at a throwaway instance, never at a house you care about.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import time

import aiohttp
from playwright.async_api import async_playwright

# The panel lives inside two shadow roots (ha-panel, then our own), so a
# plain document.querySelector finds nothing. This walks through them.
_FIND_PANEL = """
const deep = (root, out = []) => {
  for (const el of root.querySelectorAll('*')) {
    if (el.tagName.toLowerCase() === 'floorplan-hub-panel') out.push(el);
    if (el.shadowRoot) deep(el.shadowRoot, out);
  }
  return out;
};
"""

_CLICK_TAB = _FIND_PANEL + """
const root = deep(document)[0].shadowRoot;
if (index >= 0) root.querySelectorAll('.tab')[index].click();
"""

_REPORT = _FIND_PANEL + """
const root = deep(document)[0].shadowRoot;
// The house view has no .stage: it is one svg with every storey in it.
const stage = root.querySelector('.stage') || root.querySelector('.stack');
const box = stage.getBoundingClientRect();
const overlaps = [];
const areas = [...root.querySelectorAll('.area, .stack .room-label')];
for (let i = 0; i < areas.length; i++) {
  for (let j = i + 1; j < areas.length; j++) {
    const a = areas[i].getBoundingClientRect();
    const b = areas[j].getBoundingClientRect();
    if (a.left < b.right && b.left < a.right &&
        a.top < b.bottom && b.top < a.bottom) {
      overlaps.push([areas[i].textContent.trim(), areas[j].textContent.trim()]);
    }
  }
}
return {
  tab: [...root.querySelectorAll('.tab')]
        .find((t) => t.className.includes('on'))?.textContent.trim(),
  areas: areas.map((a) => a.textContent.trim()),
  nodes: [...root.querySelectorAll('.node, .stack-node')]
          .map((n) => n.textContent.trim()),
  // The whole reason the stacked view exists.
  edges_across_storeys: root.querySelectorAll('.stack-edge.across').length,
  // Rooms drawn on top of each other. The bug that started all this.
  overlapping_areas: overlaps,
  stage: {w: Math.round(box.width), h: Math.round(box.height)},
  unused_height_below: Math.round(innerHeight - box.bottom),
};
"""


async def _tokens(session: aiohttp.ClientSession, url: str, user: str, password: str):
    """Log in the way the frontend does, and hand back what it stores."""
    flow = await (await session.post(f"{url}/auth/login_flow", json={
        "client_id": f"{url}/", "handler": ["homeassistant", None],
        "redirect_uri": f"{url}/"})).json()
    step = await (await session.post(f"{url}/auth/login_flow/{flow['flow_id']}",
                                     json={"client_id": f"{url}/",
                                           "username": user,
                                           "password": password})).json()
    if "result" not in step:
        raise SystemExit(f"login failed: {step}")
    token = await (await session.post(f"{url}/auth/token", data={
        "client_id": f"{url}/", "grant_type": "authorization_code",
        "code": step["result"]})).json()
    token["hassUrl"] = url
    token["clientId"] = f"{url}/"
    token["expires"] = (time.time() + token["expires_in"]) * 1000
    return token


async def run(args) -> int:
    async with aiohttp.ClientSession() as session:
        token = await _tokens(session, args.url, args.user, args.password)

    async with async_playwright() as pw:
        browser = await pw.chromium.launch(
            executable_path=args.chromium or None, args=["--no-sandbox"])
        page = await browser.new_page(viewport={"width": 1440, "height": 900})
        problems: list[str] = []
        page.on("pageerror", lambda e: problems.append(f"pageerror: {e}"))
        page.on("console", lambda m: problems.append(f"console.error: {m.text}")
                if m.type == "error" else None)

        # The frontend reads its session out of localStorage, so putting it
        # there before the first byte loads is the whole of "logging in".
        await page.add_init_script(
            f"localStorage.setItem('hassTokens', {json.dumps(json.dumps(token))})")
        await page.goto(f"{args.url}/floorplan", wait_until="domcontentloaded")
        await page.wait_for_timeout(args.settle)

        count = await page.evaluate("() => { %s }" % (
            _FIND_PANEL
            + "return deep(document)[0].shadowRoot.querySelectorAll('.tab').length;"))
        bad = 0
        for index in range(count):
            await page.evaluate("index => { %s }" % _CLICK_TAB, index)
            await page.wait_for_timeout(1200)
            report = await page.evaluate("() => { %s }" % _REPORT)
            print(json.dumps(report, ensure_ascii=False))
            if report["overlapping_areas"]:
                bad += 1
            await page.screenshot(path=f"{args.out}-{index}.png")
        print(f"screenshots: {args.out}-0.png .. {args.out}-{count - 1}.png")

        for problem in dict.fromkeys(problems):
            print("PROBLEM:", problem[:300])
        await browser.close()
    return 1 if bad or problems else 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--url", default="http://127.0.0.1:8123")
    parser.add_argument("--user", default="test")
    parser.add_argument("--password", required=True)
    parser.add_argument("--chromium", default="",
                        help="path to a chromium binary, if not the bundled one")
    parser.add_argument("--settle", type=int, default=9000,
                        help="ms to wait for the frontend to finish booting")
    parser.add_argument("--out", default="floorplan")
    return asyncio.run(run(parser.parse_args()))


if __name__ == "__main__":
    raise SystemExit(main())
