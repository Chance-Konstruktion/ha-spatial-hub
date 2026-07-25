"""The SDK: what a maintainer actually receives, and whether it works.

The example integration in ``examples/`` is not documentation that might
have rotted -- it is set up here, driven through the real hub, and held to
the same conformance contract a stranger's integration would be.
"""

from __future__ import annotations

import importlib.util
import subprocess
import sys
from pathlib import Path

import pytest

from custom_components.floorplan_hub.const import CURRENT_SDK_VERSION
from custom_components.floorplan_hub.hub import FloorplanHub
from custom_components.floorplan_hub.registry import Provider
from custom_components.floorplan_hub.storage import LayoutStore

ROOT = Path(__file__).resolve().parents[1]
SDK = ROOT / "sdk"
EXAMPLE = ROOT / "examples" / "example_provider"
SHIM = "floorplan_hub_provider.py"
KIT = "floorplan_hub_conformance.py"


class FakeEntry:
    domain = "example_provider"
    entry_id = "example"

    def __init__(self) -> None:
        self.unloads: list = []

    def async_on_unload(self, callback):
        self.unloads.append(callback)


@pytest.fixture
def example():
    """The example integration, imported as the package it really is."""
    sys.path.insert(0, str(EXAMPLE.parent))
    for name in list(sys.modules):
        if name.startswith("example_provider"):
            del sys.modules[name]
    module = importlib.import_module("example_provider")
    yield module
    sys.path.remove(str(EXAMPLE.parent))


# ── The example is real ───────────────────────────────────


@pytest.mark.asyncio
async def test_the_example_puts_itself_on_the_floor_plan(hass, example):
    from homeassistant.helpers import area_registry as ar

    from conftest import FakeArea

    ar.async_get(hass).areas = [
        FakeArea("wohnzimmer", "Wohnzimmer", floor_id="eg"),
        FakeArea("kueche", "Küche", floor_id="eg"),
        FakeArea("dachboden", "Dachboden", floor_id="og"),
    ]

    assert await example.async_setup_entry(hass, FakeEntry()) is True

    model = await FloorplanHub(hass, LayoutStore(hass)).async_model()

    assert [node["id"] for node in model["nodes"]] == [
        "example_provider:hub",
        "example_provider:kitchen",
        "example_provider:attic",
    ]
    assert [edge["quality"] for edge in model["edges"]] == ["good", "poor"]
    assert model["nodes"][1]["metadata"]["signal_rate"] == 640, (
        "extra keywords become metadata, and metadata becomes the popup"
    )
    assert all(node["position"] for node in model["nodes"]), (
        "the example states no positions; the hub places them"
    )


@pytest.mark.asyncio
async def test_the_example_satisfies_the_public_contract(hass, example):
    await example.async_setup_entry(hass, FakeEntry())
    registration = hass.data["floorplan_hub_providers"]["example_provider"]

    provider = Provider.from_registration(registration)

    assert provider.warnings == [], (
        f"the example we hand to maintainers warns: {provider.warnings}"
    )
    assert provider.capabilities.actions is True, (
        "an action callable was passed, so the capability is inferred"
    )
    assert provider.capabilities.history is False, "and none was, so it is not"


@pytest.mark.asyncio
async def test_the_example_passes_the_conformance_kit(hass, example):
    """The kit a stranger would run, run against our own worked example."""
    spec = importlib.util.spec_from_file_location("_kit", SDK / KIT)
    kit = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(kit)

    await example.async_setup_entry(hass, FakeEntry())
    registration = hass.data["floorplan_hub_providers"]["example_provider"]

    assert kit.check(registration) == []


def test_the_examples_vendored_copy_is_the_current_one():
    """Vendoring drifts. This is the test that notices."""
    assert (EXAMPLE / SHIM).read_text() == (SDK / SHIM).read_text(), (
        "the example ships a stale copy of the shim -- rerun "
        "`python3 sdk/install.py --into examples/example_provider`"
    )


# ── The installer ─────────────────────────────────────────


def test_the_installer_vendors_both_files(tmp_path):
    target = tmp_path / "custom_components" / "mine"
    target.mkdir(parents=True)
    (target / "manifest.json").write_text('{"domain": "mine"}')
    tests = tmp_path / "tests"

    result = subprocess.run(
        [sys.executable, str(SDK / "install.py"),
         "--into", str(target), "--tests", str(tests)],
        capture_output=True, text=True,
    )

    assert result.returncode == 0, result.stderr
    assert (target / SHIM).is_file()
    assert (tests / KIT).is_file()
    assert "mine" in result.stdout, "the printed snippet is filled in for you"
    assert "from .floorplan_hub_provider import floorplan_provider" in result.stdout


def test_the_installer_reads_the_domain_from_the_manifest(tmp_path):
    target = tmp_path / "weird_folder_name"
    target.mkdir()
    (target / "manifest.json").write_text('{"domain": "real_domain"}')

    result = subprocess.run(
        [sys.executable, str(SDK / "install.py"), "--into", str(target)],
        capture_output=True, text=True,
    )

    assert 'hass.registrations["real_domain"]' in result.stdout


def test_running_it_again_reports_the_upgrade(tmp_path):
    target = tmp_path / "mine"
    target.mkdir()
    (target / SHIM).write_text("SDK_VERSION = 0\n")

    result = subprocess.run(
        [sys.executable, str(SDK / "install.py"), "--into", str(target)],
        capture_output=True, text=True,
    )

    assert "updated" in result.stdout
    assert f"v0 → v{CURRENT_SDK_VERSION}" in result.stdout


def test_a_wrong_path_says_what_to_do(tmp_path):
    result = subprocess.run(
        [sys.executable, str(SDK / "install.py"),
         "--into", str(tmp_path / "nope")],
        capture_output=True, text=True,
    )

    assert result.returncode == 1
    assert "custom_components" in result.stderr


def test_the_installer_needs_nothing_but_python():
    """A maintainer runs this before deciding to trust us."""
    source = (SDK / "install.py").read_text()
    for line in source.splitlines():
        if line.startswith(("import ", "from ")) and " import " not in line[:5]:
            module = line.split()[1].split(".")[0]
            assert module in {
                "argparse", "re", "shutil", "sys", "pathlib", "__future__",
            }, f"install.py imports {module}; it must run on a bare Python"


# ── Staleness, without calling home ───────────────────────


def test_the_shim_stamps_the_revision_it_came_from():
    spec = importlib.util.spec_from_file_location("_shim", SDK / SHIM)
    shim = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(shim)

    assert shim.SDK_VERSION == CURRENT_SDK_VERSION, (
        "the shipped shim and the hub's idea of current must agree"
    )


def test_the_kit_and_the_shim_are_the_same_revision():
    """Two files that drifted apart in someone's repository is a real bug."""
    spec = importlib.util.spec_from_file_location("_kit2", SDK / KIT)
    kit = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(kit)
    spec2 = importlib.util.spec_from_file_location("_shim2", SDK / SHIM)
    shim = importlib.util.module_from_spec(spec2)
    spec2.loader.exec_module(shim)

    assert kit.SDK_VERSION == shim.SDK_VERSION


@pytest.mark.asyncio
async def test_an_old_copy_is_noted_but_never_punished(hass):
    """It keeps working. The author just finds out a newer one exists."""
    # In this test the hub has moved on to revision 2, so a copy stamped 1
    # is behind and a copy stamped 2 is current.
    hass.data["floorplan_hub_providers"] = {
        "old": {"provider_id": "old", "name": "Old", "sdk_version": 1,
                "data": lambda: ["light.a"]},
        "new": {"provider_id": "new", "name": "New", "sdk_version": 2,
                "data": lambda: ["light.b"]},
        "handwritten": {"provider_id": "handwritten", "name": "By hand",
                        "data": lambda: ["light.c"]},
    }
    hub = FloorplanHub(hass, LayoutStore(hass))

    import custom_components.floorplan_hub.hub as hub_module

    original = hub_module.CURRENT_SDK_VERSION
    hub_module.CURRENT_SDK_VERSION = 2
    try:
        model = await hub.async_model()
    finally:
        hub_module.CURRENT_SDK_VERSION = original

    assert len(model["nodes"]) == 3, "every one of them still works"
    assert hub.status["old"]["sdk_outdated"] is True
    assert hub.status["new"]["sdk_outdated"] is False
    assert hub.status["handwritten"]["sdk_outdated"] is False, (
        "a hand-written registration is a fine way to do it and gets no note"
    )


def test_sdk_version_is_not_mistaken_for_a_typo():
    """The key the shim adds must be one the hub knows about."""
    provider = Provider.from_registration(
        {"provider_id": "p", "name": "P", "sdk_version": 1,
         "data": lambda: []}
    )
    assert provider.warnings == []


def test_nonsense_in_the_stamp_is_ignored_rather_than_fatal():
    provider = Provider.from_registration(
        {"provider_id": "p", "name": "P", "sdk_version": "banana",
         "data": lambda: []}
    )
    assert provider.sdk_version == 0
