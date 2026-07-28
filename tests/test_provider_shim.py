"""The shim developers copy, end-to-end against the real hub.

This is the DX contract: whatever the shim produces, the hub must accept
without the developer having read a single line of hub source.
"""

from __future__ import annotations

import importlib.util
from pathlib import Path

import pytest

from custom_components.spatial_hub.hub import SpatialHub
from custom_components.spatial_hub.storage import LayoutStore

from conftest import FakeArea, FakeEntity

_SHIM = Path(__file__).resolve().parents[1] / "sdk" / "spatial_hub_provider.py"
_spec = importlib.util.spec_from_file_location("spatial_hub_provider", _SHIM)
shim = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(shim)


class FakeEntry:
    """A ConfigEntry stand-in that records its unload hooks."""

    domain = "demo"

    def __init__(self):
        self.unload_hooks = []

    def async_on_unload(self, func):
        self.unload_hooks.append(func)

    def unload(self):
        for hook in self.unload_hooks:
            hook()


class FakeCoordinator:
    def __init__(self):
        self.listeners = []

    def async_add_listener(self, listener):
        self.listeners.append(listener)
        return lambda: self.listeners.remove(listener)

    def refreshed(self):
        for listener in list(self.listeners):
            listener()


@pytest.fixture
def hub(hass):
    from homeassistant.helpers import area_registry as ar

    ar.async_get(hass).areas = [FakeArea("kitchen", "Küche")]
    return SpatialHub(hass, LayoutStore(hass))


def test_one_call_is_the_whole_integration(hass):
    entry = FakeEntry()
    shim.spatial_provider(
        hass, entry, name="Demo", data=lambda: ["light.kitchen"]
    )

    registration = hass.data[shim.DATA_PROVIDERS]["demo"]
    assert registration["provider_id"] == "demo", "defaults to the entry's domain"
    assert registration["api_version"] == 1

    entry.unload()
    assert hass.data[shim.DATA_PROVIDERS] == {}, "unload withdraws automatically"


def test_coordinator_updates_notify_the_hub(hass, hub):
    entry, coordinator = FakeEntry(), FakeCoordinator()
    seen = []
    hub.async_start()
    hub.async_add_listener(seen.append)

    shim.spatial_provider(
        hass, entry, name="Demo", data=lambda: [], coordinator=coordinator
    )
    seen.clear()  # the registration signal itself
    coordinator.refreshed()

    assert seen == ["spatial_hub_data_updated:demo"]

    entry.unload()
    coordinator.refreshed()
    assert len(seen) == 2, "only the removal signal, the listener is gone"


def test_capabilities_are_inferred_from_what_was_passed(hass):
    entry = FakeEntry()
    shim.spatial_provider(
        hass, entry, name="Demo", data=lambda: [],
        history=lambda kind, item, hours: [],
    )

    capabilities = hass.data[shim.DATA_PROVIDERS]["demo"]["capabilities"]
    assert capabilities["history"] is True, "passing history switches it on"
    assert capabilities["actions"] is False, "no action callable, no action UI"


async def test_entity_ids_alone_produce_a_complete_node(hass, hub):
    """The headline promise: name an entity, get a node with everything."""
    from homeassistant.helpers import entity_registry as er

    er.async_get(hass).entities["light.kitchen"] = FakeEntity(
        "light.kitchen", original_name="Küchenlicht", area_id="kitchen",
        icon="mdi:ceiling-light",
    )
    hass.states.set("light.kitchen", "on", friendly_name="Küchenlicht")

    shim.spatial_provider(
        hass, FakeEntry(), name="Demo", data=lambda: ["light.kitchen"]
    )
    node = (await hub.async_model())["nodes"][0]

    assert node["label"] == "Küchenlicht"
    assert node["area_id"] == "kitchen"
    assert node["icon"] == "mdi:ceiling-light"
    assert node["state"] == "on"
    assert node["position"] is not None, "placed in the centre of its area"


async def test_what_the_provider_states_beats_the_registry(hass, hub):
    from homeassistant.helpers import entity_registry as er

    er.async_get(hass).entities["light.kitchen"] = FakeEntity(
        "light.kitchen", original_name="Küchenlicht", area_id="kitchen"
    )
    hass.states.set("light.kitchen", "on")

    shim.spatial_provider(
        hass,
        FakeEntry(),
        name="Demo",
        data=lambda: [
            shim.node("lamp", entity_id="light.kitchen", label="Esstisch",
                      state="dimmed", brightness=42)
        ],
    )
    node = (await hub.async_model())["nodes"][0]

    assert node["label"] == "Esstisch"
    assert node["state"] == "dimmed"
    assert node["metadata"]["brightness"] == 42
    assert node["area_id"] == "kitchen", "but the blanks still get filled"


async def test_builders_produce_what_the_hub_expects(hass, hub):
    shim.spatial_provider(
        hass,
        FakeEntry(),
        name="Demo",
        data=lambda: {
            "nodes": [
                shim.node("a", label="A", actions=[shim.action("reboot")]),
                shim.node("b", label="B"),
            ],
            "edges": [shim.edge("a", "b", value=560, quality="good", rate=560)],
        },
    )
    model = await hub.async_model()

    assert [node["id"] for node in model["nodes"]] == ["demo:a", "demo:b"]
    assert model["nodes"][0]["actions"][0]["id"] == "reboot"

    edge = model["edges"][0]
    assert (edge["source"], edge["target"]) == ("demo:a", "demo:b")
    assert edge["quality"] == "good"
    assert edge["metadata"]["rate"] == 560


def test_the_shim_works_with_no_hub_installed(hass):
    """Nothing here may depend on the hub being set up."""
    entry = FakeEntry()
    provider = shim.spatial_provider(
        hass, entry, name="Demo", data=lambda: ["light.kitchen"]
    )
    provider.async_notify()
    entry.unload()


def test_switching_a_provider_off_stops_the_chatter(hass, hub):
    """Unregistering mid-run must drop the coordinator listener too."""
    coordinator = FakeCoordinator()
    provider = shim.spatial_provider(
        hass, FakeEntry(), name="Demo", data=lambda: [], coordinator=coordinator
    )
    provider.async_unregister()

    assert coordinator.listeners == []
