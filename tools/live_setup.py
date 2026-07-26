"""Build a throwaway house in a running Home Assistant, to render against.

Two floors, five areas, and -- deliberately -- three areas assigned to no
floor at all, because that is the ordinary state of a real installation
and it is what the automated tests never had. Idempotent: run it twice
and it reports what already existed rather than failing.

    python3 tools/live_setup.py --token <long-lived-access-token>

It only creates floors and areas. The provider that puts nodes on them is
`examples/example_provider/`; copy it into the test config's
`custom_components/` and add `example_provider:` to `configuration.yaml`.

NEVER point this at a Home Assistant you care about. It writes to the
area and floor registries of whatever it can reach.
"""

from __future__ import annotations

import argparse
import asyncio

import aiohttp

FLOORS = [("Erdgeschoss", 0), ("Obergeschoss", 1)]

# Bad and Dachboden get a floor; the other three deliberately do not.
AREAS = [
    ("Bad", "Erdgeschoss"),
    ("Dachboden", "Obergeschoss"),
    ("Wohnzimmer", None),
    ("Küche", None),
    ("Schlafzimmer", None),
]


async def run(url: str, token: str) -> None:
    async with aiohttp.ClientSession() as session:
        async with session.ws_connect(f"{url}/api/websocket") as ws:
            await ws.receive_json()
            await ws.send_json({"type": "auth", "access_token": token})
            hello = await ws.receive_json()
            if hello.get("type") != "auth_ok":
                raise SystemExit(f"auth failed: {hello}")

            counter = 0

            async def call(**message):
                nonlocal counter
                counter += 1
                await ws.send_json({"id": counter, **message})
                while True:
                    reply = await ws.receive_json()
                    if reply.get("id") != counter:
                        continue
                    if not reply.get("success"):
                        # "already in use" is the normal second run.
                        print("  skip:", reply["error"]["message"])
                        return None
                    return reply.get("result")

            print("floors")
            for name, level in FLOORS:
                await call(type="config/floor_registry/create",
                           name=name, level=level)
            floors = {f["name"]: f["floor_id"]
                      for f in await call(type="config/floor_registry/list")}

            print("areas")
            for name, floor in AREAS:
                extra = {"floor_id": floors[floor]} if floor else {}
                await call(type="config/area_registry/create", name=name, **extra)

            areas = await call(type="config/area_registry/list")
            for area in sorted(areas, key=lambda a: a["name"]):
                print(f"  {area['name']:<14} floor={area.get('floor_id')}")

            homeless = sum(1 for a in areas if not a.get("floor_id"))
            print(f"\n{homeless} area(s) belong to no floor -- that is the point.")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--url", default="http://127.0.0.1:8123")
    parser.add_argument("--token", required=True,
                        help="long-lived access token from your test user's profile")
    args = parser.parse_args()
    asyncio.run(run(args.url, args.token))


if __name__ == "__main__":
    main()
