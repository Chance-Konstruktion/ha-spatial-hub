"""The websocket surface every renderer talks to."""

from __future__ import annotations

import pytest
import voluptuous as vol

from custom_components.spatial_hub import websocket as ws
from custom_components.spatial_hub.const import DATA_HUB, MAX_BACKGROUND_BYTES
from custom_components.spatial_hub.hub import SpatialHub
from custom_components.spatial_hub.storage import LayoutStore


@pytest.fixture
def hub(hass):
    instance = SpatialHub(hass, LayoutStore(hass))
    hass.data[DATA_HUB] = instance
    hass.data["spatial_hub_providers"] = {
        "demo": {
            "provider_id": "demo",
            "name": "Demo",
            "capabilities": {"nodes": True},
            "layers": [{"id": "demo_layer", "name": "Layer"}],
            "data": lambda: {"nodes": [{"id": "a"}], "edges": []},
            "action": lambda kind, item, action, data: {"success": True,
                                                        "action": action},
            "history": lambda kind, item, hours: [{"value": 1}],
        }
    }
    return instance


async def test_model_command(hass, hub, connection):
    await ws.websocket_model(hass, connection, {"id": 1, "type": "x"})
    model = connection.results[1]
    assert [node["id"] for node in model["nodes"]] == ["demo:a"]
    assert model["api_version"] == 1


def test_commands_error_out_when_the_hub_is_gone(hass, connection):
    ws.websocket_providers(hass, connection, {"id": 1})
    assert connection.errors[0][1] == "not_found"


def test_providers_command_reports_capabilities(hass, hub, connection):
    ws.websocket_providers(hass, connection, {"id": 1})
    provider = connection.results[1]["providers"][0]
    assert provider["id"] == "demo"
    assert provider["capabilities"]["nodes"] is True


def test_layout_set_persists_and_notifies(hass, hub, connection):
    seen = []
    hub.async_add_listener(seen.append)

    ws.websocket_layout_set(
        hass,
        connection,
        {"id": 1, "section": "nodes", "key": "demo:a",
         "values": {"position": {"x": 0.5, "y": 0.5}}},
    )

    assert connection.results[1] == {"success": True}
    assert hub.store.get("nodes", "demo:a")["position"] == {"x": 0.5, "y": 0.5}
    assert seen == ["layout"]


def test_layout_set_rejects_an_oversized_background(hass, hub, connection):
    ws.websocket_layout_set(
        hass,
        connection,
        {"id": 1, "section": "floors", "key": "eg",
         "values": {"background": "x" * (MAX_BACKGROUND_BYTES + 1)}},
    )
    assert connection.errors[0][1] == "invalid_format"
    assert hub.store.get("floors", "eg") == {}


def test_layout_set_ignores_keys_the_section_does_not_own(hass, hub, connection):
    ws.websocket_layout_set(
        hass,
        connection,
        {"id": 1, "section": "layers", "key": "demo_layer",
         "values": {"visible": False, "position": {"x": 1, "y": 1}}},
    )
    assert hub.store.get("layers", "demo_layer") == {"visible": False}


def test_layout_reset_drops_every_override(hass, hub, connection):
    hub.store.update("nodes", "demo:a", {"position": {"x": 0.1, "y": 0.2},
                                         "scale": 2})
    ws.websocket_layout_reset(
        hass, connection, {"id": 1, "section": "nodes", "key": "demo:a"}
    )
    assert hub.store.get("nodes", "demo:a") == {}


async def test_action_command(hass, hub, connection):
    await ws.websocket_action(
        hass,
        connection,
        {"id": 1, "kind": "node", "item_id": "demo:a", "action": "reboot",
         "data": {}},
    )
    assert connection.results[1]["action"] == "reboot"


async def test_action_on_an_unknown_item_reports_not_found(hass, hub, connection):
    await ws.websocket_action(
        hass,
        connection,
        {"id": 1, "kind": "node", "item_id": "ghost:a", "action": "x", "data": {}},
    )
    assert connection.errors[0][1] == "not_found"


async def test_history_command(hass, hub, connection):
    await ws.websocket_history(
        hass, connection, {"id": 1, "kind": "edge", "item_id": "demo:e", "hours": 6}
    )
    assert connection.results[1]["series"] == [{"value": 1}]


def test_subscribe_pushes_a_reason_not_the_model(hass, hub, connection):
    ws.websocket_subscribe(hass, connection, {"id": 7})
    hub.async_notify("layout")

    assert connection.messages == [{"id": 7, "event": {"reason": "layout"}}]
    # Unsubscribing is what HA does when the connection closes.
    connection.subscriptions[7]()
    hub.async_notify("layout")
    assert len(connection.messages) == 1


async def test_diagnostics_tells_a_developer_what_went_wrong(hass, hub, connection):
    hass.data["spatial_hub_providers"]["broken"] = {
        "provider_id": "broken",
        "name": "Broken",
        "capabilties": {"nodes": True},  # deliberate typo
        "data": lambda: {"nodes": [{"no_id": True}]},
    }

    await ws.websocket_diagnostics(hass, connection, {"id": 1})
    providers = connection.results[1]["providers"]

    assert providers["demo"]["ok"] is True
    assert providers["broken"]["nodes"] == 0
    assert any("dropped node" in w for w in providers["broken"]["warnings"])
    assert any(
        "capabilties" in w for w in providers["broken"]["registration_warnings"]
    ), "a typo must be reported, not silently ignored"


async def test_diagnostics_reports_a_raising_provider(hass, hub, connection):
    def explode():
        raise RuntimeError("boom")

    hass.data["spatial_hub_providers"]["broken"] = {
        "provider_id": "broken", "name": "Broken", "data": explode,
    }

    await ws.websocket_diagnostics(hass, connection, {"id": 1})
    status = connection.results[1]["providers"]["broken"]

    assert status["ok"] is False
    assert "RuntimeError: boom" in status["error"]


def test_a_room_that_is_not_a_rectangle_survives_the_wire(hass, hub, connection):
    """The bug that made corner editing look broken.

    The editor drew the shape, sent it, and this schema did not know the
    key -- so the whole write was rejected and the hub answered with the
    old rectangle. Every corner snapped back a moment after being dragged,
    which reads as "corner editing does not work" and was really "corner
    editing was never allowed to be saved".
    """
    niche = [
        {"x": 0, "y": 0}, {"x": 1, "y": 0}, {"x": 1, "y": 0.6},
        {"x": 0.4, "y": 0.6}, {"x": 0.4, "y": 1}, {"x": 0, "y": 1},
    ]
    ws.websocket_layout_set(
        hass,
        connection,
        {"id": 1, "section": "areas", "key": "wohnzimmer",
         "values": {"shape": niche}},
    )

    assert connection.results[1] == {"success": True}
    assert hub.store.get("areas", "wohnzimmer")["shape"] == niche


def test_a_plot_survives_the_wire_and_may_be_bigger_than_the_house(
    hass, hub, connection
):
    """A boundary that had to fit inside the walls would not be one."""
    garden = [
        {"x": -1.4, "y": -0.9}, {"x": 2.3, "y": -0.9},
        {"x": 2.3, "y": 2.1}, {"x": -1.4, "y": 2.1},
    ]
    ws.websocket_layout_set(
        hass,
        connection,
        {"id": 1, "section": "floors", "key": "eg", "values": {"plot": garden}},
    )

    assert connection.results[1] == {"success": True}
    assert hub.store.get("floors", "eg")["plot"] == garden


def _layout_values(values):
    """Run one set of values through the command schema itself.

    Home Assistant applies the schema in the decorator, which these tests
    call past -- so the limits have to be asked directly, or a test would
    happily assert that nonsense is accepted.
    """
    schema = vol.Schema(ws.websocket_layout_set._ws_schema,  # noqa: SLF001
                        extra=vol.ALLOW_EXTRA)
    return schema({"type": f"{ws.DOMAIN}/layout/set",
                   "section": "areas", "key": "x", "values": values})


def test_a_shape_is_refused_before_it_becomes_a_line():
    """Two points enclose nothing. Storing them would draw a room with no
    inside and no way back except the reset button."""
    with pytest.raises(vol.Invalid):
        _layout_values({"shape": [{"x": 0, "y": 0}, {"x": 1, "y": 1}]})


def test_a_corner_cannot_be_dragged_out_of_its_own_room():
    """`shape` is box-local: 0 is one wall, 1 the opposite one. A corner
    outside that would be a room bigger than itself."""
    with pytest.raises(vol.Invalid):
        _layout_values(
            {"shape": [{"x": 0, "y": 0}, {"x": 4, "y": 0}, {"x": 1, "y": 1}]}
        )


def test_a_plot_is_allowed_the_room_a_garden_needs():
    """The same check the other way round: a boundary well outside the
    walls is not a mistake, it is the whole point."""
    _layout_values({"plot": [{"x": -2, "y": -2}, {"x": 3, "y": -2},
                             {"x": 3, "y": 3}]})


def test_the_house_may_be_measured_in_metres(hass, hub, connection):
    """One number for the people who know their house to the centimetre --
    and nothing at all for everybody else."""
    ws.websocket_layout_set(
        hass,
        connection,
        {"id": 1, "section": "floors", "key": "eg", "values": {"metres": 11.5}},
    )

    assert hub.store.get("floors", "eg")["metres"] == 11.5


def test_a_house_cannot_be_zero_metres_wide():
    with pytest.raises(vol.Invalid):
        _layout_values({"metres": 0})


def test_a_broken_wall_join_survives_the_schema():
    """The same bug as the one that made corner editing look broken: the
    panel writes a key, the command schema drops it, and the hub answers
    with the wall still joined."""
    kept = _layout_values({"unjoined": ["bad", "flur"]})["values"]
    assert kept["unjoined"] == ["bad", "flur"]

    assert _layout_values({"unjoined": []})["values"]["unjoined"] == []
    assert _layout_values({"unjoined": None})["values"]["unjoined"] is None

    with pytest.raises(vol.Invalid):
        _layout_values({"unjoined": ["x"] * 65})
