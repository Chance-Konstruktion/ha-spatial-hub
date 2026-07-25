"""The websocket surface every renderer talks to."""

from __future__ import annotations

import pytest

from custom_components.floorplan_hub import websocket as ws
from custom_components.floorplan_hub.const import DATA_HUB, MAX_BACKGROUND_BYTES
from custom_components.floorplan_hub.hub import FloorplanHub
from custom_components.floorplan_hub.storage import LayoutStore


@pytest.fixture
def hub(hass):
    instance = FloorplanHub(hass, LayoutStore(hass))
    hass.data[DATA_HUB] = instance
    hass.data["floorplan_hub_providers"] = {
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
    hass.data["floorplan_hub_providers"]["broken"] = {
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

    hass.data["floorplan_hub_providers"]["broken"] = {
        "provider_id": "broken", "name": "Broken", "data": explode,
    }

    await ws.websocket_diagnostics(hass, connection, {"id": 1})
    status = connection.results[1]["providers"]["broken"]

    assert status["ok"] is False
    assert "RuntimeError: boom" in status["error"]
