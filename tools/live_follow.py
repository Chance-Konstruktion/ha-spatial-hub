"""Change the house while the panel is open, and watch it follow.

Phase 4's promise is not "it renders once". It is that a plan which is
right on Monday is still right on Friday: rename an area, add a floor,
move a device, and the plan pulls along without anyone reloading. A plan
nobody trusts is worse than no plan, and "just reload" is not an answer.

That promise lives in a debounced listener on the registries, which no
unit test can show reaching a browser. So this creates a floor and an
area over the websocket API while the panel sits open, and watches.

    python3 tools/live_follow.py --password secret

It cleans up after itself: everything it creates, it deletes again. If it
crashes half way, the leftovers are named "Floorplan-Hub Test …" so you
can find them.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import time

import aiohttp
from playwright.async_api import async_playwright

# Named so that a leftover is obviously ours and obviously disposable.
FLOOR = "Floorplan-Hub Testetage"
AREA = "Floorplan-Hub Testbereich"
RENAMED = "Floorplan-Hub Testbereich (umbenannt)"

_PANEL = """
const deep = (root, out = []) => {
  for (const el of root.querySelectorAll('*')) {
    if (el.tagName.toLowerCase() === 'floorplan-hub-panel') out.push(el);
    if (el.shadowRoot) deep(el.shadowRoot, out);
  }
  return out;
};
const R = deep(document)[0].shadowRoot;
"""


class Registry:
    """The websocket connection a *user* would be making changes through."""

    def __init__(self, session, socket) -> None:
        self.socket = socket
        self.counter = 0

    async def call(self, **message):
        self.counter += 1
        await self.socket.send_json({"id": self.counter, **message})
        while True:
            reply = await self.socket.receive_json()
            if reply.get("id") != self.counter:
                continue
            if not reply.get("success"):
                return None
            return reply.get("result")


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


async def _seen(page, what: str, needle: str, patience: int) -> bool:
    """Wait for the panel to show something, without ever reloading it.

    Reloading would prove nothing -- a reload is exactly the answer this
    promise exists to avoid.
    """
    for _ in range(patience):
        await page.wait_for_timeout(1500)
        found = await page.evaluate("() => { %s return %s; }" % (_PANEL, what))
        if needle in found:
            return True
    return False


async def run(args) -> int:
    async with aiohttp.ClientSession() as session:
        token = await _tokens(session, args.url, args.user, args.password)

        async with session.ws_connect(f"{args.url}/api/websocket") as socket:
            await socket.receive_json()
            await socket.send_json({"type": "auth",
                                    "access_token": token["access_token"]})
            if (await socket.receive_json()).get("type") != "auth_ok":
                raise SystemExit("auth failed")
            registry = Registry(session, socket)

            async with async_playwright() as pw:
                browser = await pw.chromium.launch(
                    executable_path=args.chromium or None, args=["--no-sandbox"])
                page = await browser.new_page(
                    viewport={"width": 1440, "height": 900})
                await page.add_init_script(
                    "localStorage.setItem('hassTokens', %s)"
                    % json.dumps(json.dumps(token)))
                await page.goto(f"{args.url}/floorplan",
                                wait_until="domcontentloaded")
                await page.wait_for_timeout(args.settle)

                failures = await _walk(page, registry, args.patience)
                await page.screenshot(path=args.out)
                await browser.close()

            await _clean_up(registry)

    print(f"\nscreenshot: {args.out}")
    print("der Plan folgt" if not failures
          else f"{len(failures)} Zusage(n) nicht gehalten")
    return 1 if failures else 0


async def _walk(page, registry, patience: int) -> list[str]:
    failures: list[str] = []

    def check(promise: str, ok: bool) -> None:
        print(f"{'ok  ' if ok else 'FAIL'}  {promise}")
        if not ok:
            failures.append(promise)

    tabs = "[...R.querySelectorAll('.tab')].map((t) => t.textContent.trim())"
    areas = ("[...R.querySelectorAll('.tab')].map((t) => t.textContent.trim())"
             ".concat([...R.querySelectorAll('.area')]"
             ".map((a) => a.textContent.trim()))")

    await registry.call(type="config/floor_registry/create", name=FLOOR, level=7)
    check("Eine neue Etage erscheint ohne Reload",
          await _seen(page, tabs, FLOOR, patience))

    created = await registry.call(type="config/area_registry/create", name=AREA)
    if created is None:
        raise SystemExit(f"could not create {AREA!r} -- a leftover from a "
                         "crashed run? Delete it and try again.")

    # Onto the new floor, so it lands on a tab of its own where nothing
    # else can be mistaken for it.
    floors = await registry.call(type="config/floor_registry/list")
    floor_id = next(f["floor_id"] for f in floors if f["name"] == FLOOR)
    await registry.call(type="config/area_registry/update",
                        area_id=created["area_id"], floor_id=floor_id)

    await page.evaluate("() => { %s [...R.querySelectorAll('.tab')]"
                        ".find((t) => t.textContent.includes(%s)).click(); }"
                        % (_PANEL, json.dumps(FLOOR)))
    check("Ein neuer Bereich erscheint ohne Reload",
          await _seen(page, areas, AREA, patience))

    await registry.call(type="config/area_registry/update",
                        area_id=created["area_id"], name=RENAMED)
    check("Ein umbenannter Bereich heißt sofort anders",
          await _seen(page, areas, RENAMED, patience))

    return failures


async def _clean_up(registry: Registry) -> None:
    """Leave the house as it was found."""
    for area in await registry.call(type="config/area_registry/list") or []:
        if area["name"] in (AREA, RENAMED):
            await registry.call(type="config/area_registry/delete",
                                area_id=area["area_id"])
    for floor in await registry.call(type="config/floor_registry/list") or []:
        if floor["name"] == FLOOR:
            await registry.call(type="config/floor_registry/delete",
                                floor_id=floor["floor_id"])
    print("aufgeräumt")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--url", default="http://127.0.0.1:8123")
    parser.add_argument("--user", default="test")
    parser.add_argument("--password", required=True)
    parser.add_argument("--chromium", default="")
    parser.add_argument("--settle", type=int, default=9000)
    parser.add_argument("--patience", type=int, default=8,
                        help="how many 1.5s rounds to wait; the hub debounces")
    parser.add_argument("--out", default="floorplan-follow.png")
    return asyncio.run(run(parser.parse_args()))


if __name__ == "__main__":
    raise SystemExit(main())
