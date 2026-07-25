"""Model assembly: auto-placement, user overrides, provider isolation."""

from __future__ import annotations

import pytest

from custom_components.floorplan_hub.hub import FloorplanHub
from custom_components.floorplan_hub.storage import LayoutStore

from conftest import FakeArea, FakeFloor


@pytest.fixture
def hub(hass):
    from homeassistant.helpers import area_registry as ar, floor_registry as fr

    floors = fr.async_get(hass)
    floors.floors = [FakeFloor("eg", "Erdgeschoss", level=0),
                     FakeFloor("og", "Obergeschoss", level=1)]
    areas = ar.async_get(hass)
    areas.areas = [
        FakeArea("wohnzimmer", "Wohnzimmer", floor_id="eg"),
        FakeArea("kueche", "Küche", floor_id="eg"),
        FakeArea("schlafzimmer", "Schlafzimmer", floor_id="og"),
    ]
    return FloorplanHub(hass, LayoutStore(hass))


def _register(hass, provider_id="demo", **overrides):
    registration = {
        "provider_id": provider_id,
        "name": provider_id.title(),
        "capabilities": {"nodes": True, "edges": True},
        "layers": [{"id": f"{provider_id}_layer", "name": "Layer",
                    "z_index": 10}],
        "data": lambda: {"nodes": [{"id": "a", "area_id": "wohnzimmer"}],
                         "edges": []},
    }
    registration.update(overrides)
    hass.data.setdefault("floorplan_hub_providers", {})[provider_id] = registration
    return registration


@pytest.mark.asyncio
async def test_model_has_floors_areas_and_provider_data(hass, hub):
    _register(hass)
    model = await hub.async_model()

    assert [floor["id"] for floor in model["floors"]] == ["eg", "og"]
    assert {area["id"] for area in model["areas"]} == {
        "wohnzimmer", "kueche", "schlafzimmer"
    }
    assert [node["id"] for node in model["nodes"]] == ["demo:a"]
    assert model["providers"][0]["capabilities"]["edges"] is True


@pytest.mark.asyncio
async def test_node_lands_in_the_centre_of_its_area(hass, hub):
    _register(hass)
    model = await hub.async_model()

    area = next(a for a in model["areas"] if a["id"] == "wohnzimmer")
    node = model["nodes"][0]
    assert node["position"]["x"] == pytest.approx(area["position"]["x"])
    assert node["position"]["y"] == pytest.approx(area["position"]["y"])
    assert node["floor_id"] == "eg", "floor is inherited from the area"


@pytest.mark.asyncio
async def test_nodes_in_one_area_are_spread_apart(hass, hub):
    _register(
        hass,
        data=lambda: {
            "nodes": [{"id": f"n{i}", "area_id": "kueche"} for i in range(3)],
            "edges": [],
        },
    )
    model = await hub.async_model()
    positions = {(n["position"]["x"], n["position"]["y"]) for n in model["nodes"]}
    assert len(positions) == 3


@pytest.mark.asyncio
async def test_user_position_beats_auto_placement(hass, hub):
    _register(hass)
    hub.store.update("nodes", "demo:a", {"position": {"x": 0.9, "y": 0.1}})

    model = await hub.async_model()
    node = model["nodes"][0]
    assert (node["position"]["x"], node["position"]["y"]) == (0.9, 0.1)
    assert node["metadata"]["auto_position"] is False


@pytest.mark.asyncio
async def test_clearing_an_override_restores_auto_placement(hass, hub):
    _register(hass)
    hub.store.update("nodes", "demo:a", {"position": {"x": 0.9, "y": 0.1}})
    hub.store.update("nodes", "demo:a", {"position": None})

    node = (await hub.async_model())["nodes"][0]
    assert node["position"]["x"] != 0.9


@pytest.mark.asyncio
async def test_hidden_node_and_its_edges_disappear(hass, hub):
    _register(
        hass,
        data=lambda: {
            "nodes": [{"id": "a"}, {"id": "b"}],
            "edges": [{"id": "e", "source": "a", "target": "b"}],
        },
    )
    hub.store.update("nodes", "demo:b", {"hidden": True})

    model = await hub.async_model()
    assert [n["id"] for n in model["nodes"]] == ["demo:a"]
    assert model["edges"] == [], "an edge into nothing must not be rendered"


@pytest.mark.asyncio
async def test_layers_are_sorted_by_z_index_and_respect_overrides(hass, hub):
    _register(hass, "demo")
    _register(hass, "other", layers=[{"id": "other_layer", "z_index": 5}])
    hub.store.update("layers", "demo_layer", {"visible": False})

    model = await hub.async_model()
    assert [layer["id"] for layer in model["layers"]] == [
        "other_layer", "demo_layer"
    ]
    assert model["layers"][1]["visible"] is False


@pytest.mark.asyncio
async def test_one_broken_provider_does_not_take_the_others_down(hass, hub):
    def explode():
        raise RuntimeError("boom")

    _register(hass, "demo")
    _register(hass, "broken", data=explode)

    model = await hub.async_model()
    assert [node["id"] for node in model["nodes"]] == ["demo:a"]
    assert len(model["providers"]) == 2, "the broken provider still exists"


@pytest.mark.asyncio
async def test_actions_are_forwarded_to_the_owning_provider(hass, hub):
    calls = []

    def action(kind, item_id, action_id, data):
        calls.append((kind, item_id, action_id, data))
        return {"success": True}

    _register(hass, "demo", action=action)
    result = await hub.async_action("node", "demo:a", "reboot", {"force": True})

    assert result == {"success": True}
    assert calls == [("node", "a", "reboot", {"force": True})], (
        "the provider sees its own id, not the namespaced one"
    )


@pytest.mark.asyncio
async def test_action_for_unknown_provider_raises(hass, hub):
    with pytest.raises(LookupError):
        await hub.async_action("node", "nobody:a", "reboot", {})


@pytest.mark.asyncio
async def test_history_is_passed_through_un_namespaced(hass, hub):
    _register(hass, "demo", history=lambda kind, item_id, hours: [
        {"id": item_id, "kind": kind, "hours": hours}
    ])
    series = await hub.async_history("edge", "demo:a__b", 6)
    assert series == [{"id": "a__b", "kind": "edge", "hours": 6}]


@pytest.mark.asyncio
async def test_provider_without_history_returns_empty(hass, hub):
    _register(hass, "demo")
    assert await hub.async_history("node", "demo:a", 24) == []


def test_listeners_are_notified_and_survive_a_bad_subscriber(hass, hub):
    seen = []
    hub.async_add_listener(lambda reason: (_ for _ in ()).throw(ValueError()))
    remove = hub.async_add_listener(seen.append)

    hub.async_notify("layout")
    assert seen == ["layout"]

    remove()
    hub.async_notify("layout")
    assert seen == ["layout"]


def test_provider_signals_reach_listeners(hass, hub):
    from homeassistant.helpers.dispatcher import async_dispatcher_send

    seen = []
    hub.async_start()
    hub.async_add_listener(seen.append)

    async_dispatcher_send(hass, "floorplan_hub_data_updated", "demo")
    assert seen == ["floorplan_hub_data_updated:demo"]

    hub.async_stop()
    async_dispatcher_send(hass, "floorplan_hub_data_updated", "demo")
    assert len(seen) == 1


@pytest.mark.asyncio
async def test_auto_areas_off_hides_unplaced_areas(hass, hub):
    _register(hass)
    hub.auto_areas = False
    hub.store.update("areas", "kueche", {"position": {"x": 0.2, "y": 0.2}})

    model = await hub.async_model()
    assert [area["id"] for area in model["areas"]] == ["kueche"]
