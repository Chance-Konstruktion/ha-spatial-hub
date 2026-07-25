#!/usr/bin/env python3
"""Vendor the Floorplan-Hub provider files into an integration.

    python3 sdk/install.py --into ../my-integration/custom_components/mine

Copies two files, prints the code to add, and gets out of the way. It does
not touch your source, does not add a dependency, does not phone home and
does not need the hub installed.

Why a script rather than a package on PyPI: the whole promise to a
maintainer is *"this costs you nothing"*. A dependency is not nothing. It
is a version to pin, a conflict to resolve, a supply-chain question to
answer, and a reason for a reviewer to say no. Two vendored files with a
version stamp keep that promise, and the hub tells you in its diagnostics
when a newer copy exists -- which is the only thing a package would have
bought you.

Run it again to update; it overwrites the two files and nothing else.
"""

from __future__ import annotations

import argparse
import re
import shutil
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
SHIM = "floorplan_hub_provider.py"
KIT = "floorplan_hub_conformance.py"


def _sdk_version() -> int:
    match = re.search(r"^SDK_VERSION = (\d+)", (HERE / SHIM).read_text(), re.M)
    return int(match.group(1)) if match else 0


def _installed_version(path: Path) -> int | None:
    if not path.is_file():
        return None
    match = re.search(r"^SDK_VERSION = (\d+)", path.read_text(), re.M)
    return int(match.group(1)) if match else 0


def _domain_of(target: Path) -> str:
    """The integration's domain, from its manifest or its folder name."""
    manifest = target / "manifest.json"
    if manifest.is_file():
        match = re.search(r'"domain"\s*:\s*"([^"]+)"', manifest.read_text())
        if match:
            return match.group(1)
    return target.name


def install(target: Path, tests: Path | None) -> int:
    if not target.is_dir():
        print(f"error: {target} is not a directory", file=sys.stderr)
        print("       point --into at your custom_components/<domain> folder",
              file=sys.stderr)
        return 1

    version = _sdk_version()
    previous = _installed_version(target / SHIM)

    shutil.copyfile(HERE / SHIM, target / SHIM)
    print(
        f"{'updated' if previous is not None else 'copied '} "
        f"{target / SHIM}"
        + (f"  (v{previous} → v{version})" if previous not in (None, version) else "")
    )

    if tests is not None:
        tests.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(HERE / KIT, tests / KIT)
        print(f"copied  {tests / KIT}")

    domain = _domain_of(target)
    print(NEXT_STEPS.format(domain=domain, tests=tests or "your test folder"))
    return 0


NEXT_STEPS = """
── Add this to async_setup_entry, in __init__.py ──────────────────

    from .floorplan_hub_provider import floorplan_provider

    floorplan_provider(
        hass,
        entry,
        name="{domain}",
        icon="mdi:flash",
        data=lambda: ["light.kitchen"],   # your entity ids, or node() dicts
        coordinator=coordinator,          # optional, but makes it live
    )

That is the whole integration. It registers, withdraws when your entry is
unloaded, and re-notifies the hub after every coordinator refresh.

A bare entity id is a complete node -- Home Assistant already knows its
name, area, icon and state, and the hub fills those in. Reach for node()
and edge() only when you have more to say than an entity id.

── And this in {tests} ────────────────────────────

    from .floorplan_hub_conformance import FakeHass, FloorplanHubConformance

    class TestFloorplanHub(FloorplanHubConformance):
        def build_registration(self):
            hass = FakeHass()
            my_setup(hass, entry, coordinator)
            return hass.registrations["{domain}"]

Needs pytest and nothing else -- no Home Assistant, no hub, no async
plugin. It checks the things that really break floor plans in the field.

Nothing else changes. Without the hub installed your integration behaves
exactly as it did before: the shim writes a dict into hass.data and fires
a dispatcher signal, and both cost nothing when nobody is listening.
"""


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Vendor the Floorplan-Hub provider files.",
    )
    parser.add_argument(
        "--into", required=True, type=Path,
        help="your custom_components/<domain> folder",
    )
    parser.add_argument(
        "--tests", type=Path, default=None,
        help="your test folder, to receive the conformance kit as well",
    )
    args = parser.parse_args()
    return install(args.into.resolve(), args.tests.resolve() if args.tests else None)


if __name__ == "__main__":
    raise SystemExit(main())
