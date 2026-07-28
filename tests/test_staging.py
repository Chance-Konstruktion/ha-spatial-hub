"""The two integrations parked in `staging/`, and the wall around them.

They name Z-Wave and ESPHome on every second line, which is exactly why
they are not part of the hub and never will be. They live here only until
they move to repositories of their own, and these tests exist to make
sure the wait cannot quietly turn into residence.

The adapters themselves are checked the way a stranger's would be: their
registration has to satisfy the same public contract, with no exceptions
and no shortcut.
"""

from __future__ import annotations

import importlib.util
import sys
import types
from pathlib import Path

import pytest

from custom_components.spatial_hub.registry import Provider

ROOT = Path(__file__).resolve().parents[1]
STAGING = ROOT / "staging"
HUB = ROOT / "custom_components" / "spatial_hub"

ADAPTERS = {
    "zwave": STAGING / "ha-spatial-zwave" / "custom_components" / "spatial_zwave",
    "esphome": STAGING / "ha-spatial-esphome" / "custom_components" / "spatial_esphome",
}


def _load(folder: Path):
    """Import an adapter's spatial.py without its package __init__."""
    package = types.ModuleType(f"_staged_{folder.name}")
    package.__path__ = [str(folder)]
    sys.modules[package.__name__] = package
    spec = importlib.util.spec_from_file_location(
        f"{package.__name__}.spatial", folder / "spatial.py"
    )
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


class FakeEntry:
    entry_id = "staged"

    def __init__(self, domain: str) -> None:
        self.domain = domain
        self.unloads: list = []

    def async_on_unload(self, callback) -> None:
        self.unloads.append(callback)


# ── The wall ──────────────────────────────────────────────


def test_the_hub_never_imports_anything_staged():
    """The reason staging exists. One import and the wall is gone."""
    for path in HUB.rglob("*.py"):
        source = path.read_text()
        assert "staging" not in source and "spatial_zwave" not in source, (
            f"{path.name} reaches into staging -- then the hub knows an "
            "integration by name and this project is a dashboard"
        )


def test_nothing_staged_lives_under_custom_components():
    """A folder that ships is a folder that stays."""
    assert not (HUB.parent / "spatial_zwave").exists()
    assert not (HUB.parent / "spatial_esphome").exists()


def test_staging_says_it_is_temporary():
    readme = (STAGING / "README.md").read_text().lower()
    assert "umziehen" in readme or "eigene repo" in readme


@pytest.mark.parametrize("name", sorted(ADAPTERS))
def test_each_adapter_vendors_the_current_shim(name):
    """They are strangers to the hub, so they carry a copy like strangers do."""
    shipped = (ADAPTERS[name] / "spatial_hub_provider.py").read_text()
    assert shipped == (ROOT / "sdk" / "spatial_hub_provider.py").read_text()


# ── Z-Wave ────────────────────────────────────────────────


@pytest.fixture
def zwave():
    return _load(ADAPTERS["zwave"])


class FakeStatistics:
    def __init__(self, rssi=None) -> None:
        self.rssi = rssi
        self.commands_tx = 12
        self.commands_dropped_tx = 0


class FakeZwaveNode:
    def __init__(self, node_id, name, status="alive", rssi=-60) -> None:
        self.node_id, self.name, self.status = node_id, name, status
        self.statistics = FakeStatistics(rssi)
        self.firmware_version = "1.2"
        self.device_config = types.SimpleNamespace(manufacturer="Acme", label="Dimmer")


def _driver(nodes, own_id=1):
    controller = types.SimpleNamespace(
        own_node_id=own_id, nodes={n.node_id: n for n in nodes}
    )
    return types.SimpleNamespace(controller=controller)


def _install_driver(hass, driver):
    hass.data["zwave_js"] = {"entry": types.SimpleNamespace(client=
        types.SimpleNamespace(driver=driver))}


def test_the_mesh_hangs_off_the_controller(hass, zwave):
    _install_driver(hass, _driver([FakeZwaveNode(2, "Flur"), FakeZwaveNode(3, "Bad")]))
    zwave.async_setup_spatial(hass, FakeEntry("spatial_zwave"))

    payload = hass.data["spatial_hub_providers"]["spatial_zwave"]["data"]()

    assert [n["id"] for n in payload["nodes"]] == ["controller", "node-2", "node-3"]
    assert all(e["source"] == "controller" for e in payload["edges"])


def test_a_sleeping_battery_device_is_not_broken(hass, zwave):
    """Half a house painted red every night is worse than no colour."""
    _install_driver(hass, _driver([FakeZwaveNode(2, "Fenster", status="asleep")]))
    zwave.async_setup_spatial(hass, FakeEntry("spatial_zwave"))

    payload = hass.data["spatial_hub_providers"]["spatial_zwave"]["data"]()
    sleeper = payload["nodes"][1]

    assert sleeper["state"] == "asleep"
    assert sleeper["state"] != "offline"


def test_a_dead_node_is_offline(hass, zwave):
    _install_driver(hass, _driver([FakeZwaveNode(2, "Weg", status="dead")]))
    zwave.async_setup_spatial(hass, FakeEntry("spatial_zwave"))

    payload = hass.data["spatial_hub_providers"]["spatial_zwave"]["data"]()
    assert payload["nodes"][1]["state"] == "offline"


@pytest.mark.parametrize(
    "rssi,expected",
    [(-55, "good"), (-78, "fair"), (-92, "poor"), (None, "unknown"),
     ("nonsense", "unknown")],
)
def test_signal_strength_becomes_the_shared_vocabulary(zwave, rssi, expected):
    assert zwave._quality(rssi) == expected


def test_the_layer_survives_home_assistant_changing_its_internals(hass, zwave):
    """The point of the fallback. A missing RSSI is not a missing layer."""
    hass.data["zwave_js"] = {"entry": types.SimpleNamespace(client=None)}
    from conftest import FakeDevice

    from homeassistant.helpers import device_registry as dr

    device = FakeDevice("d1", area_id="flur", name="Dimmer Flur")
    device.identifiers = {("zwave_js", "zwave_js-2")}
    dr.async_get(hass).devices = {"d1": device}

    zwave.async_setup_spatial(hass, FakeEntry("spatial_zwave"))
    payload = hass.data["spatial_hub_providers"]["spatial_zwave"]["data"]()

    assert [n["id"] for n in payload["nodes"]] == ["controller", "device-d1"]
    assert payload["nodes"][0]["metadata"]["quelle"] == "registry", (
        "the layer must say which of the two sources it is on"
    )
    assert payload["nodes"][1]["area_id"] == "flur"


def test_an_exploding_driver_does_not_take_the_layer_with_it(hass, zwave):
    class Exploding:
        @property
        def nodes(self):
            raise RuntimeError("boom")

    _install_driver(hass, types.SimpleNamespace(
        controller=types.SimpleNamespace(own_node_id=1, nodes=Exploding().nodes
                                         if False else {})))
    hass.data["zwave_js"] = {"e": types.SimpleNamespace(
        client=types.SimpleNamespace(driver=types.SimpleNamespace(
            controller=Exploding())))}

    zwave.async_setup_spatial(hass, FakeEntry("spatial_zwave"))
    payload = hass.data["spatial_hub_providers"]["spatial_zwave"]["data"]()

    assert payload == {"nodes": [], "edges": []}, (
        "no Z-Wave devices in the registry either, so an empty picture -- "
        "but an empty picture, not an exception"
    )


def test_zwave_satisfies_the_public_contract(hass, zwave):
    _install_driver(hass, _driver([FakeZwaveNode(2, "Flur")]))
    zwave.async_setup_spatial(hass, FakeEntry("spatial_zwave"))

    provider = Provider.from_registration(
        hass.data["spatial_hub_providers"]["spatial_zwave"]
    )
    assert provider.warnings == []


# ── ESPHome ───────────────────────────────────────────────


@pytest.fixture
def esphome():
    return _load(ADAPTERS["esphome"])


def _esphome_house(hass, states):
    from conftest import FakeDevice, FakeEntity

    from homeassistant.helpers import device_registry as dr, entity_registry as er

    device = FakeDevice("b1", area_id="buero", name="Bürosensor")
    device.identifiers = {("esphome", "aabbcc")}
    device.model, device.sw_version = "ESP32", "2024.6.0"
    dr.async_get(hass).devices = {"b1": device}

    entities = er.async_get(hass)
    for entity_id, state in states.items():
        entry = FakeEntity(entity_id)
        entry.device_id = "b1"
        entities.entities[entity_id] = entry
        hass.states.set(entity_id, state)
    return device


def test_one_dot_per_board_not_per_entity(hass, esphome):
    """Eight dots for one box is eight times the clutter and no more news."""
    _esphome_house(hass, {f"sensor.s{i}": "21.5" for i in range(8)})
    esphome.async_setup_spatial(hass, FakeEntry("spatial_esphome"))

    payload = hass.data["spatial_hub_providers"]["spatial_esphome"]["data"]()

    assert len(payload["nodes"]) == 1
    assert payload["nodes"][0]["metadata"]["entitaeten"] == 8


def test_a_board_is_up_if_anything_on_it_answers(hass, esphome):
    """Requiring all of them would paint working boards red."""
    _esphome_house(hass, {"sensor.a": "unknown", "sensor.b": "21.5"})
    esphome.async_setup_spatial(hass, FakeEntry("spatial_esphome"))

    payload = hass.data["spatial_hub_providers"]["spatial_esphome"]["data"]()
    assert payload["nodes"][0]["state"] == "online"


def test_a_board_nobody_can_reach_is_offline(hass, esphome):
    _esphome_house(hass, {"sensor.a": "unavailable", "sensor.b": "unavailable"})
    esphome.async_setup_spatial(hass, FakeEntry("spatial_esphome"))

    payload = hass.data["spatial_hub_providers"]["spatial_esphome"]["data"]()
    assert payload["nodes"][0]["state"] == "offline"


def test_esphome_invents_no_edges(hass, esphome):
    """Nothing here measures the path to a board. A line would be a guess."""
    _esphome_house(hass, {"sensor.a": "21.5"})
    esphome.async_setup_spatial(hass, FakeEntry("spatial_esphome"))

    payload = hass.data["spatial_hub_providers"]["spatial_esphome"]["data"]()
    assert "edges" not in payload or payload["edges"] == []


def test_esphome_satisfies_the_public_contract(hass, esphome):
    _esphome_house(hass, {"sensor.a": "21.5"})
    esphome.async_setup_spatial(hass, FakeEntry("spatial_esphome"))

    provider = Provider.from_registration(
        hass.data["spatial_hub_providers"]["spatial_esphome"]
    )
    assert provider.warnings == []
