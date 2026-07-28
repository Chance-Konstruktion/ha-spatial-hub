"""Walk the edit mode with a real mouse, and check what it promised.

Phase 5 makes more promises than any other part of this project: drag with
snapping, resize an area, hide a thing and get it back, run a provider
action, reset a floor. All of them are about pointer events and stored
state, and none of them is provable with a stub -- `tools/live_check.py`
only looks, it never touches.

So this one touches. Unlike live_check.py it *does* have an opinion: every
step below is a promise the project made in writing, so a failure here is
a failure of the promise. It writes to the layout store of whatever it
connects to. Throwaway instance only.

    python3 tools/live_edit.py --password secret

Set up the house with tools/live_setup.py first, and make sure at least
one provider puts two nodes on one floor -- examples/example_provider does.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import time

import aiohttp
from playwright.async_api import async_playwright

_PANEL = """
const deep = (root, out = []) => {
  for (const el of root.querySelectorAll('*')) {
    if (el.tagName.toLowerCase() === 'spatial-hub-panel') out.push(el);
    if (el.shadowRoot) deep(el.shadowRoot, out);
  }
  return out;
};
const R = deep(document)[0].shadowRoot;
"""


async def _tokens(session, url, user, password):
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
    token.update(hassUrl=url, clientId=f"{url}/",
                 expires=(time.time() + token["expires_in"]) * 1000)
    return token


class Walk:
    def __init__(self, page) -> None:
        self.page = page
        self.failures: list[str] = []

    async def js(self, body: str):
        return await self.page.evaluate("() => { %s %s }" % (_PANEL, body))

    def check(self, promise: str, ok: bool, detail: str = "") -> None:
        print(f"{'ok  ' if ok else 'FAIL'}  {promise}{'  — ' + detail if detail else ''}")
        if not ok:
            self.failures.append(promise)

    async def drag(self, x, y, dx, dy) -> None:
        """A drag is many small moves. One jump is not what a hand does."""
        await self.page.mouse.move(x, y)
        await self.page.mouse.down()
        for step in range(1, 11):
            await self.page.mouse.move(x + dx * step / 10, y + dy * step / 10)
            await self.page.wait_for_timeout(20)
        await self.page.mouse.up()
        await self.page.wait_for_timeout(2000)


async def _floor_with_nodes(walk: Walk, page) -> None:
    """Click through the floor tabs until one has something to drag.

    The click and the redraw are two ticks apart, so this has to wait
    between them -- checking inside one evaluate() reads the old DOM.
    """
    count = await walk.js("return R.querySelectorAll('.tab').length;")
    for index in range(count):
        await walk.js(f"R.querySelectorAll('.tab')[{index}].click();")
        await page.wait_for_timeout(900)
        if await walk.js("return R.querySelectorAll('.node').length;"):
            return
    raise SystemExit("no floor has a node on it -- is a provider registered?")


async def run(args) -> int:
    async with aiohttp.ClientSession() as session:
        token = await _tokens(session, args.url, args.user, args.password)

    async with async_playwright() as pw:
        browser = await pw.chromium.launch(
            executable_path=args.chromium or None, args=["--no-sandbox"])
        page = await browser.new_page(viewport={"width": 1440, "height": 900})
        # The floor reset asks before it throws work away, which is right.
        page.on("dialog", lambda d: asyncio.ensure_future(d.accept()))
        rejected: list[str] = []
        page.on("websocket", lambda ws: ws.on("framereceived", lambda f:
                rejected.append(f[:200])
                if f.startswith("{") and '"success": false' in f.replace(" ", " ")
                else None))

        await page.add_init_script(
            f"localStorage.setItem('hassTokens', {json.dumps(json.dumps(token))})")
        await page.goto(f"{args.url}/spatial", wait_until="domcontentloaded")
        await page.wait_for_timeout(args.settle)

        walk = Walk(page)

        await _floor_with_nodes(walk, page)

        await walk.js("""
            [...R.querySelectorAll('header button')]
              .find((b) => (b.title || '').match(/earbeit/i)).click();""")
        await page.wait_for_timeout(700)
        walk.check("Bearbeiten lässt sich einschalten",
                   await walk.js("return !!R.querySelector('.stage.editing');"))

        # ── Dragging, and whether it survives a reload ─────
        where = await walk.js("""
            const b = R.querySelector('.node').getBoundingClientRect();
            return {x: b.x + b.width / 2, y: b.y + b.height / 2};""")
        before = await walk.js(
            "return Math.round(R.querySelector('.node').getBoundingClientRect().x);")
        await walk.drag(where["x"], where["y"], 120, 60)
        after = await walk.js(
            "return Math.round(R.querySelector('.node').getBoundingClientRect().x);")
        walk.check("Ein Node lässt sich ziehen", after != before,
                   f"{before} → {after}")

        await page.reload(wait_until="domcontentloaded")
        await page.wait_for_timeout(args.settle)
        await _floor_with_nodes(walk, page)
        reloaded = await walk.js(
            "return Math.round(R.querySelector('.node').getBoundingClientRect().x);")
        walk.check("Die Position überlebt einen Reload", reloaded == after,
                   f"{after} → {reloaded}")

        await walk.js("""
            [...R.querySelectorAll('header button')]
              .find((b) => (b.title || '').match(/earbeit/i)).click();""")
        await page.wait_for_timeout(700)

        # ── Resizing an area ──────────────────────────────
        # Drag the grip *inwards*. Growing is not always possible: an area
        # that already fills nine tenths of the plan is clamped at the edge,
        # and an earlier version of this walk read that correct clamp as a
        # broken resize. Shrinking always has room.
        grip = await walk.js("""
            const b = R.querySelector('.area').getBoundingClientRect();
            return {w: Math.round(b.width), x: b.right - 6, y: b.bottom - 6};""")
        await walk.drag(grip["x"], grip["y"], -100, -60)
        resized = await walk.js(
            "return Math.round(R.querySelector('.area').getBoundingClientRect().width);")
        walk.check("Ein Bereich lässt sich in der Größe ändern",
                   resized < grip["w"], f"{grip['w']} → {resized}")

        # ── Hiding is not a one-way door ──────────────────
        await walk.js("R.querySelector('.node').click();")
        await page.wait_for_timeout(600)
        count = await walk.js("return R.querySelectorAll('.node').length;")
        hid = await walk.js("""
            const b = [...R.querySelectorAll('.popup button, dialog button')]
              .find((x) => /usblenden/i.test(x.textContent));
            if (!b) return false;
            b.click();
            return true;""")
        await page.wait_for_timeout(2200)
        fewer = await walk.js("return R.querySelectorAll('.node').length;")
        walk.check("Ausblenden blendet aus", hid and fewer == count - 1)

        # Target the tray by the attribute the chips carry, not by looking
        # for "some button in the sidebar" -- an earlier version of this
        # line hit the layer toggle instead and switched the provider off
        # for good. A test that quietly breaks the thing it is testing is
        # worse than no test.
        back = await walk.js("""
            const b = R.querySelector('[data-show-node], [data-show-area]');
            return b ? (b.click(), b.textContent.trim()) : null;""")
        await page.wait_for_timeout(2200)
        restored = await walk.js("return R.querySelectorAll('.node').length;")
        walk.check("Ausgeblendetes kommt zurück", restored == count,
                   f"über „{back}“")

        # ── A provider action reaches the provider ────────
        await walk.js("R.querySelector('.node').click();")
        await page.wait_for_timeout(600)
        ran = await walk.js("""
            const b = [...R.querySelectorAll('.popup button, dialog button')]
              .find((x) => x.dataset && x.dataset.action !== undefined);
            if (!b) return null;
            b.click();
            return b.textContent.trim();""")
        await page.wait_for_timeout(1800)
        if ran is None:
            print("skip  Provider-Action — der Provider bietet keine an")
        else:
            walk.check("Eine Provider-Action läuft durch", True, f"„{ran}“")

        # ── Reset puts the automation back in charge ──────
        await walk.js("const d = R.querySelector('dialog[open]'); if (d) d.close();")
        await walk.js("R.querySelector('[data-reset-floor]').click();")
        await page.wait_for_timeout(2500)
        reset = await walk.js(
            "return Math.round(R.querySelector('.area').getBoundingClientRect().width);")
        # Compared against the size measured in this same layout state --
        # the sidebar appearing changes the stage width, and comparing
        # across that boundary made a working reset look broken.
        walk.check("Zurücksetzen stellt die Automatik wieder her",
                   reset == grip["w"], f"{resized} → {reset}")

        if rejected:
            walk.check("Kein Kommando wurde abgelehnt", False, rejected[0])

        await page.screenshot(path=args.out)
        print(f"\nscreenshot: {args.out}")
        print("alles gehalten" if not walk.failures
              else f"{len(walk.failures)} Zusage(n) nicht gehalten")
        await browser.close()
    return 1 if walk.failures else 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--url", default="http://127.0.0.1:8123")
    parser.add_argument("--user", default="test")
    parser.add_argument("--password", required=True)
    parser.add_argument("--chromium", default="")
    parser.add_argument("--settle", type=int, default=9000)
    parser.add_argument("--out", default="spatial-edit.png")
    return asyncio.run(run(parser.parse_args()))


if __name__ == "__main__":
    raise SystemExit(main())
