"""The generic adapter: any integration, without an adapter of its own.

The test that matters most is the last one. Everything else here is
matching logic; that one is the architecture.
"""

from __future__ import annotations

import pytest

from custom_components.spatial_hub import generic
from custom_components.spatial_hub.hub import SpatialHub
from custom_components.spatial_hub.registry import Provider
from custom_components.spatial_hub.storage import LayoutStore

from conftest import FakeArea, FakeDevice, FakeEntity


@pytest.fixture
def house(hass):
    """A small house with entities from several imaginary integrations."""
    from homeassistant.helpers import (
        area_registry as ar,
        device_registry as dr,
        entity_registry as er,
    )

    ar.async_get(hass).areas = [
        FakeArea("wohnzimmer", "Wohnzimmer", floor_id="eg"),
        FakeArea("kueche", "Küche", floor_id="eg"),
    ]
    dr.async_get(hass).devices["dev1"] = FakeDevice("dev1", area_id="kueche")

    entities = er.async_get(hass).entities
    entities["light.wohnzimmer"] = FakeEntity(
        "light.wohnzimmer", name="Stehlampe", area_id="wohnzimmer"
    )
    entities["light.kueche"] = FakeEntity("light.kueche", device_id="dev1")
    entities["sensor.temperatur"] = FakeEntity(
        "sensor.temperatur", area_id="wohnzimmer"
    )
    entities["switch.alt"] = FakeEntity("switch.alt", area_id="kueche")
    entities["switch.alt"].disabled_by = "user"
    return hass


def _match(hass, **config):
    entities, _warnings = generic.matching_entities(hass, config)
    return entities


# ── Matching ──────────────────────────────────────────────


def test_a_domain_is_enough_to_describe_a_layer(house):
    assert _match(house, domains=["light"]) == ["light.kueche", "light.wohnzimmer"]


def test_an_entity_inherits_its_devices_area(house):
    assert _match(house, domains=["light"], areas=["kueche"]) == ["light.kueche"]


def test_criteria_narrow_rather_than_widen(house):
    assert _match(house, domains=["light", "sensor"], areas=["wohnzimmer"]) == [
        "light.wohnzimmer",
        "sensor.temperatur",
    ]


def test_disabled_entities_stay_off_the_plan(house):
    assert "switch.alt" not in _match(house, domains=["switch"])


def test_a_named_entity_joins_whether_or_not_the_rule_matches(house):
    assert _match(house, domains=["light"], entities=["sensor.temperatur"]) == [
        "light.kueche",
        "light.wohnzimmer",
        "sensor.temperatur",
    ]


def test_an_excluded_entity_leaves_whether_or_not_the_rule_matches(house):
    assert _match(house, domains=["light"], exclude=["light.kueche"]) == [
        "light.wohnzimmer"
    ]


def test_a_layer_with_no_rule_at_all_selects_nothing(house):
    """Better an empty layer than every entity in the house by accident."""
    assert _match(house) == []


def test_labels_select_across_domains_and_areas(house):
    from homeassistant.helpers import entity_registry as er

    entities = er.async_get(house).entities
    entities["light.wohnzimmer"].labels = {"security"}
    entities["sensor.temperatur"].labels = {"security", "climate"}

    assert _match(house, labels=["security"]) == [
        "light.wohnzimmer",
        "sensor.temperatur",
    ]


def test_an_enormous_layer_is_capped_and_says_so(house):
    from homeassistant.helpers import entity_registry as er

    entities = er.async_get(house).entities
    for index in range(generic.MAX_ENTITIES + 50):
        entities[f"light.l{index:04d}"] = FakeEntity(f"light.l{index:04d}")

    selected, warnings = generic.matching_entities(house, {"domains": ["light"]})

    assert len(selected) == generic.MAX_ENTITIES
    assert any("Narrow the layer down" in warning for warning in warnings)


def test_a_rule_that_matches_nothing_says_so(house):
    _selected, warnings = generic.matching_entities(house, {"domains": ["vacuum"]})
    assert warnings == ["nothing matched this layer's rule"]


# ── Registration and reconciliation ───────────────────────


@pytest.mark.asyncio
async def test_a_custom_layer_becomes_nodes_on_the_plan(house):
    store = LayoutStore(house)
    store.update("settings", "view", {"custom_layers": [
        {"id": "lights", "name": "Lichter", "domains": ["light"]}
    ]})
    generic.GenericProviders(house, store).async_sync()

    model = await SpatialHub(house, store).async_model()

    assert [node["id"] for node in model["nodes"]] == [
        "custom_lights:light.kueche",
        "custom_lights:light.wohnzimmer",
    ]
    assert model["nodes"][1]["label"] == "Stehlampe", (
        "a bare entity id is a complete node -- the hub fills the rest in"
    )
    assert model["nodes"][1]["area_id"] == "wohnzimmer"
    assert [layer["id"] for layer in model["layers"]] == ["custom_lights"]


def test_each_layer_is_its_own_provider_so_it_toggles_on_its_own(house):
    store = LayoutStore(house)
    store.update("settings", "view", {"custom_layers": [
        {"id": "lights", "name": "Lichter", "domains": ["light"]},
        {"id": "sensors", "name": "Sensoren", "domains": ["sensor"]},
    ]})
    generic.GenericProviders(house, store).async_sync()

    assert set(house.data["spatial_hub_providers"]) == {
        "custom_lights",
        "custom_sensors",
    }


def test_syncing_twice_changes_nothing(house):
    store = LayoutStore(house)
    store.update("settings", "view", {"custom_layers": [
        {"id": "lights", "name": "Lichter", "domains": ["light"]}
    ]})
    providers = generic.GenericProviders(house, store)
    providers.async_sync()
    first = house.data["spatial_hub_providers"]["custom_lights"]

    providers.async_sync()

    assert house.data["spatial_hub_providers"]["custom_lights"] is first, (
        "an untouched layer must not blink out and back on every layout change"
    )


def test_deleting_a_layer_withdraws_its_registration(house):
    store = LayoutStore(house)
    store.update("settings", "view", {"custom_layers": [
        {"id": "lights", "name": "Lichter", "domains": ["light"]}
    ]})
    providers = generic.GenericProviders(house, store)
    providers.async_sync()

    store.update("settings", "view", {"custom_layers": []})
    providers.async_sync()

    assert house.data["spatial_hub_providers"] == {}


def test_editing_a_layer_re_registers_it(house):
    store = LayoutStore(house)
    store.update("settings", "view", {"custom_layers": [
        {"id": "l", "name": "Alt", "domains": ["light"]}
    ]})
    providers = generic.GenericProviders(house, store)
    providers.async_sync()

    store.update("settings", "view", {"custom_layers": [
        {"id": "l", "name": "Neu", "domains": ["sensor"]}
    ]})
    providers.async_sync()

    assert house.data["spatial_hub_providers"]["custom_l"]["name"] == "Neu"


def test_unloading_takes_the_custom_layers_with_it(house):
    store = LayoutStore(house)
    store.update("settings", "view", {"custom_layers": [
        {"id": "lights", "name": "Lichter", "domains": ["light"]}
    ]})
    providers = generic.GenericProviders(house, store)
    providers.async_sync()

    providers.async_stop()

    assert house.data["spatial_hub_providers"] == {}


def test_garbage_in_the_stored_config_is_stepped_over(house):
    store = LayoutStore(house)
    store.update("settings", "view", {"custom_layers": [
        "not a layer", {"no": "id"}, {"id": "ok", "name": "OK", "domains": ["light"]},
    ]})
    generic.GenericProviders(house, store).async_sync()

    assert set(house.data["spatial_hub_providers"]) == {"custom_ok"}


# ── Facets ────────────────────────────────────────────────


def test_facets_report_what_the_house_actually_has(house):
    facets = generic.async_facets(house)

    domains = {item["value"]: item["count"] for item in facets["domains"]}
    assert domains == {"light": 2, "sensor": 1}, "disabled entities do not count"
    assert facets["max_entities"] == generic.MAX_ENTITIES


# ── The one that is the architecture ──────────────────────


def test_the_generic_adapter_gets_no_shortcut_into_the_hub(house):
    """It registers exactly as a third party does, or it proves nothing.

    A privileged path here would be the first crack in the thing that
    makes the hub worth having -- and the built-in layers would quietly
    become better citizens than anybody else's integration.
    """
    config = {"id": "lights", "name": "Lichter", "domains": ["light"]}
    raw = generic.registration(house, config)

    # The same validation every third-party registration goes through,
    # with no keys the public contract does not know about.
    provider = Provider.from_registration(raw)

    assert provider.warnings == [], (
        f"the hub's own adapter would warn a third party: {provider.warnings}"
    )
    assert provider.id == "custom_lights"
    assert callable(provider.data_fn)
    assert set(raw) <= {
        "provider_id", "api_version", "name", "icon", "version",
        "capabilities", "layers", "icon_set", "data", "history", "action",
    }


@pytest.mark.asyncio
async def test_a_custom_layer_is_isolated_like_any_other_provider(house):
    """It is not trusted more than a stranger's code, either."""
    store = LayoutStore(house)
    store.update("settings", "view", {"custom_layers": [
        {"id": "lights", "name": "Lichter", "domains": ["light"]}
    ]})
    generic.GenericProviders(house, store).async_sync()

    def explode():
        raise RuntimeError("boom")

    house.data["spatial_hub_providers"]["custom_lights"]["data"] = explode

    model = await SpatialHub(house, store).async_model()

    assert model["nodes"] == []
    assert len(model["providers"]) == 1, "it fails alone, like anyone else"


# ── Home Assistant's own topology ─────────────────────────


def _house_with_a_controller(hass):
    """A controller and two devices reached through it.

    Deliberately not named after any integration: Z-Wave, ESPHome, Zigbee
    and Hue all write `via_device` the same way, which is exactly why the
    hub may read it.
    """
    from homeassistant.helpers import device_registry as dr, entity_registry as er

    from conftest import FakeDevice, FakeEntity

    devices = dr.async_get(hass)
    devices.devices = {
        "ctrl": FakeDevice("ctrl", area_id="flur", name="Controller",
                           manufacturer="Beispiel", model="X1"),
        "lamp": FakeDevice("lamp", area_id="wohnzimmer", via_device_id="ctrl"),
        "plug": FakeDevice("plug", area_id="kueche", via_device_id="ctrl"),
        "solo": FakeDevice("solo", area_id="bad"),
    }
    entities = er.async_get(hass)
    for entity_id, device_id in (
        ("light.lamp", "lamp"), ("switch.plug", "plug"), ("light.solo", "solo")
    ):
        entry = FakeEntity(entity_id)
        entry.device_id = device_id
        entities.entities[entity_id] = entry
    return ["light.lamp", "switch.plug", "light.solo"]


def test_the_via_device_graph_becomes_edges(hass):
    from custom_components.spatial_hub.generic import VIA_PREFIX, topology

    result = topology(hass, _house_with_a_controller(hass))

    assert [e["source"] for e in result["edges"]] == ["light.lamp", "switch.plug"]
    assert {e["target"] for e in result["edges"]} == {f"{VIA_PREFIX}ctrl"}
    assert [n["id"] for n in result["nodes"]] == [f"{VIA_PREFIX}ctrl"], (
        "the controller is pulled in once, not once per child"
    )


def test_a_device_with_no_parent_draws_no_edge(hass):
    from custom_components.spatial_hub.generic import topology

    result = topology(hass, _house_with_a_controller(hass))

    assert all(e["source"] != "light.solo" for e in result["edges"])


def test_the_controller_claims_no_state_it_cannot_know(hass):
    """It often has no entity at all. Green would be a guess drawn in colour."""
    from custom_components.spatial_hub.generic import topology

    controller = topology(hass, _house_with_a_controller(hass))["nodes"][0]

    assert "state" not in controller
    assert controller["area_id"] == "flur", "but where it sits is known"
    assert controller["label"] == "Controller"


def test_the_relation_is_stated_not_measured(hass):
    """Home Assistant says the link exists, never how good it is."""
    from custom_components.spatial_hub.generic import topology

    result = topology(hass, _house_with_a_controller(hass))

    assert {e["quality"] for e in result["edges"]} == {"unknown"}


def test_topology_is_off_unless_the_layer_asks(hass):
    from custom_components.spatial_hub.generic import registration

    _house_with_a_controller(hass)
    plain = registration(hass, {"id": "l", "name": "L", "domains": ["light"]})

    assert plain["data"]() == {"nodes": ["light.lamp", "light.solo"]}
    assert plain["capabilities"]["edges"] is False


def test_a_layer_that_asks_for_topology_gets_both(hass):
    from custom_components.spatial_hub.generic import VIA_PREFIX, registration

    _house_with_a_controller(hass)
    layer = registration(
        hass, {"id": "l", "name": "L", "domains": ["light"], "topology": True}
    )
    payload = layer["data"]()

    assert [n if isinstance(n, str) else n["id"] for n in payload["nodes"]] == [
        "light.lamp", "light.solo", f"{VIA_PREFIX}ctrl"
    ]
    assert len(payload["edges"]) == 1
    assert layer["capabilities"]["edges"] is True


def test_topology_takes_no_shortcut_into_the_hub_either(hass):
    """Same public contract, same validation, no exceptions."""
    from custom_components.spatial_hub.generic import registration
    from custom_components.spatial_hub.registry import Provider

    _house_with_a_controller(hass)
    provider = Provider.from_registration(
        registration(hass, {"id": "l", "name": "L", "domains": ["light"],
                            "topology": True})
    )

    assert provider.warnings == []


def test_no_integration_is_named_anywhere_in_the_adapter():
    """The whole reason via_device is allowed and a Z-Wave API call is not."""
    from pathlib import Path

    source = Path(
        "custom_components/spatial_hub/generic.py"
    ).read_text().lower()
    code = "\n".join(
        line for line in source.splitlines()
        if not line.strip().startswith("#")
    )
    for integration in ("zwave", "z-wave", "esphome", "zigbee", "hue", "matter"):
        assert integration not in code, (
            f"{integration!r} is named in the generic adapter -- then it is "
            "not generic, it is a list of the integrations somebody thought of"
        )


# ── What a fresh installation shows ───────────────────────


def test_a_fresh_install_already_has_layers(hass):
    from custom_components.spatial_hub.generic import DEFAULT_LAYERS, effective_layers
    from custom_components.spatial_hub.storage import LayoutStore

    layers, are_default = effective_layers(LayoutStore(hass))

    assert [layer["id"] for layer in layers] == [d["id"] for d in DEFAULT_LAYERS]
    assert are_default is True, "an editor must be able to say whose these are"


def test_deleting_every_layer_is_respected(hass):
    """Configured-to-nothing is not the same answer as never configured.

    Bringing the defaults back on the next restart would be the hub
    arguing with a user who meant it.
    """
    from custom_components.spatial_hub.generic import effective_layers
    from custom_components.spatial_hub.storage import LayoutStore

    store = LayoutStore(hass)
    store.update("settings", "view", {"custom_layers": []})

    layers, are_default = effective_layers(store)

    assert layers == []
    assert are_default is False


def test_the_users_own_layers_replace_the_defaults_entirely(hass):
    from custom_components.spatial_hub.generic import effective_layers
    from custom_components.spatial_hub.storage import LayoutStore

    store = LayoutStore(hass)
    store.update(
        "settings", "view", {"custom_layers": [{"id": "mine", "name": "Mine"}]}
    )

    layers, are_default = effective_layers(store)

    assert [layer["id"] for layer in layers] == ["mine"]
    assert are_default is False


def test_the_defaults_name_no_integration():
    """They are rules. A Z-Wave house and an ESPHome house get the same four."""
    import json

    from custom_components.spatial_hub.generic import DEFAULT_LAYERS

    text = json.dumps(DEFAULT_LAYERS).lower()
    for integration in ("zwave", "esphome", "zigbee", "hue", "matter", "shelly"):
        assert integration not in text


def test_the_defaults_are_bounded(hass):
    """"All sensors" in a real house is four hundred dots and no floor plan."""
    from custom_components.spatial_hub.generic import DEFAULT_LAYERS

    sensors = next(layer for layer in DEFAULT_LAYERS if layer["id"] == "zugang")

    assert sensors.get("device_classes"), (
        "a layer over binary_sensor without a device_class filter is every "
        "battery and connectivity sensor in the house"
    )


def test_the_defaults_register_like_anybody_else(hass):
    from custom_components.spatial_hub.generic import DEFAULT_LAYERS, registration
    from custom_components.spatial_hub.registry import Provider

    for layer in DEFAULT_LAYERS:
        provider = Provider.from_registration(registration(hass, layer))
        assert provider.warnings == [], f"{layer['id']}: {provider.warnings}"
