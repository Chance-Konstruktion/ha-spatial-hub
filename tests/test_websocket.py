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


# ── Moving a thing into a room, for real ──────────────────────────────


class _Connection:
    """Just enough of a websocket connection to see what came back."""

    def __init__(self) -> None:
        self.result = None
        self.error = None

    def send_result(self, _id, result=None):
        self.result = result

    def send_error(self, _id, code, message):
        self.error = (code, message)


def _house(hass):
    """A board in the cellar with two entities, one pulled out of it."""
    from homeassistant.helpers import (
        area_registry as ar,
        device_registry as dr,
        entity_registry as er,
    )
    from tests.conftest import FakeArea, FakeDevice, FakeEntity

    areas = ar.async_get(hass)
    areas.areas.extend([FakeArea("keller", "Keller"), FakeArea("kueche", "Küche")])
    dr.async_get(hass).devices["board"] = FakeDevice("board", area_id="keller")
    entities = er.async_get(hass)
    entities.entities["sensor.temperatur"] = FakeEntity(
        "sensor.temperatur", device_id="board"
    )
    # Deliberately somewhere else than its board -- a CSI sensor watching
    # a room the board is not in.
    entities.entities["sensor.praesenz"] = FakeEntity(
        "sensor.praesenz", device_id="board", area_id="kueche"
    )
    return entities, dr.async_get(hass)


def test_dragging_a_board_moves_the_board(hass):
    """A dot that sits where its device sits moves the device: every
    entity on the board comes along, which is what "the ESP is in the
    kitchen now" means."""
    entities, devices = _house(hass)
    connection = _Connection()

    ws.websocket_area_assign(
        hass, connection,
        {"id": 1, "type": "x", "entity_id": "sensor.temperatur",
         "area_id": "kueche"},
    )

    assert connection.error is None
    assert devices.devices["board"].area_id == "kueche"
    assert connection.result == {
        "scope": "device", "target": "board",
        "before": "keller", "after": "kueche",
    }
    # And the entity that was deliberately placed elsewhere is untouched.
    assert entities.entities["sensor.praesenz"].area_id == "kueche"


def test_dragging_an_entity_that_was_pulled_out_moves_only_it(hass):
    """Whichever registry put the dot there is the one that moves it. The
    override decided this dot's room, so the override moves -- dragging
    the board's other entities along would undo a deliberate split."""
    entities, devices = _house(hass)
    connection = _Connection()

    ws.websocket_area_assign(
        hass, connection,
        {"id": 1, "type": "x", "entity_id": "sensor.praesenz",
         "area_id": "keller"},
    )

    assert connection.result["scope"] == "entity"
    assert entities.entities["sensor.praesenz"].area_id == "keller"
    assert devices.devices["board"].area_id == "keller", "the board did not move"


def test_the_answer_is_enough_to_undo_the_move(hass):
    """This writes outside the hub. Sending back what it was is the
    difference between a change and a change you can take back."""
    _, devices = _house(hass)
    connection = _Connection()

    ws.websocket_area_assign(
        hass, connection,
        {"id": 1, "type": "x", "entity_id": "sensor.temperatur",
         "area_id": "kueche"},
    )
    undo = connection.result

    ws.websocket_area_assign(
        hass, _Connection(),
        {"id": 2, "type": "x", "entity_id": "sensor.temperatur",
         "area_id": undo["before"], "scope": undo["scope"]},
    )
    assert devices.devices["board"].area_id == "keller"


def test_an_unknown_room_is_refused(hass):
    """A typo must not quietly clear a device's area."""
    _, devices = _house(hass)
    connection = _Connection()

    ws.websocket_area_assign(
        hass, connection,
        {"id": 1, "type": "x", "entity_id": "sensor.temperatur",
         "area_id": "dachboden"},
    )

    assert connection.error[0] == "not_found"
    assert devices.devices["board"].area_id == "keller"


def test_an_entity_with_no_device_keeps_its_own_area(hass):
    """A template sensor has nowhere else to put it."""
    from homeassistant.helpers import entity_registry as er
    from tests.conftest import FakeEntity

    entities, _ = _house(hass)
    entities.entities["sensor.frei"] = FakeEntity("sensor.frei")
    connection = _Connection()

    ws.websocket_area_assign(
        hass, connection,
        {"id": 1, "type": "x", "entity_id": "sensor.frei", "area_id": "kueche"},
    )

    assert connection.result["scope"] == "entity"
    assert er.async_get(hass).entities["sensor.frei"].area_id == "kueche"


def test_the_move_needs_an_admin():
    """It changes the configuration every dashboard, every automation and
    every voice assistant reads. Arranging a picture does not."""
    assert getattr(ws.websocket_area_assign, "_ws_require_admin", False)
    assert not getattr(ws.websocket_layout_set, "_ws_require_admin", False)


def test_doors_survive_the_wire(hass, hub, connection):
    """A door is stored and served like any other piece of geometry."""
    doors = [
        {"side": 0, "at": 0.5, "width": 0.2},
        {"side": 2, "at": 0.25, "width": 0.3},
    ]
    ws.websocket_layout_set(
        hass,
        connection,
        {"id": 1, "section": "areas", "key": "wohnzimmer",
         "values": {"doors": doors}},
    )

    assert connection.results[1] == {"success": True}
    assert hub.store.get("areas", "wohnzimmer")["doors"] == doors


def test_a_door_wider_than_its_wall_is_refused():
    """A wall that is entirely doorway is a missing wall, and the editor
    already has a way to say that."""
    with pytest.raises(vol.Invalid):
        _layout_values({"doors": [{"side": 0, "at": 0.5, "width": 1}]})


def test_a_door_cannot_sit_outside_the_wall_it_is_in():
    """`at` is box-local, like `shape`: 0 is one corner, 1 the other."""
    with pytest.raises(vol.Invalid):
        _layout_values({"doors": [{"side": 0, "at": 1.4, "width": 0.2}]})


def test_a_door_needs_a_wall_to_be_in():
    """Every field is required -- a door with no side is not half a door,
    it is a write the renderer would have to guess at."""
    with pytest.raises(vol.Invalid):
        _layout_values({"doors": [{"at": 0.5, "width": 0.2}]})


def test_an_opening_may_say_whether_it_is_a_door_or_a_window(hass, hub, connection):
    """Tuer und Fenster sind dasselbe Ding an derselben Stelle, nur
    anders gebaut -- also ein Feld und nicht zwei Listen."""
    doors = [
        {"side": 0, "at": 0.5, "width": 0.2, "kind": "door"},
        {"side": 2, "at": 0.25, "width": 0.3, "kind": "window"},
    ]
    ws.websocket_layout_set(
        hass,
        connection,
        {"id": 1, "section": "areas", "key": "wohnzimmer",
         "values": {"doors": doors}},
    )

    assert connection.results[1] == {"success": True}
    assert hub.store.get("areas", "wohnzimmer")["doors"] == doors


def test_an_opening_without_a_kind_is_still_accepted():
    """Das Feld kam spaeter dazu. Eine Anordnung von vorher hat es nicht,
    und die soll weiter gelten statt beim Laden zu scheitern."""
    values = _layout_values({"doors": [{"side": 0, "at": 0.5, "width": 0.2}]})

    assert values["values"]["doors"] == [{"side": 0, "at": 0.5, "width": 0.2}]


def test_an_invented_kind_of_opening_is_refused():
    """Zwei Arten gibt es, und eine dritte waere fuer jeden Renderer eine
    Ueberraschung -- der zeichnet dann gar nichts, und zwar stumm."""
    with pytest.raises(vol.Invalid):
        _layout_values(
            {"doors": [{"side": 0, "at": 0.5, "width": 0.2, "kind": "luke"}]}
        )


def test_a_split_device_is_reported_not_silently_left_behind(hass):
    """From 2026.8 the same physical box can have a second device entry
    from another integration, with its own area. Moving one moves only
    that one -- writing the other would drag entities the user never
    dragged. So the answer names it, and the move stops looking half-done.
    """
    from homeassistant.helpers import device_registry as dr

    from tests.conftest import FakeDevice

    _house(hass)
    devices = dr.async_get(hass)
    mac = {("mac", "aa:bb:cc:dd:ee:ff")}
    devices.devices["board"].connections = mac
    devices.devices["board_net"] = FakeDevice(
        "board_net", area_id="keller", name="Board (Netzwerk)", connections=mac
    )
    connection = _Connection()

    ws.websocket_area_assign(
        hass, connection,
        {"id": 1, "type": "x", "entity_id": "sensor.temperatur",
         "area_id": "kueche"},
    )

    assert devices.devices["board"].area_id == "kueche"
    assert devices.devices["board_net"].area_id == "keller", (
        "the other integration's entry is reported, never written"
    )
    assert connection.result["siblings"] == [
        {"device_id": "board_net", "name": "Board (Netzwerk)", "area_id": "keller"}
    ]


def test_an_ordinary_move_keeps_the_short_answer(hass):
    """Nothing here assumes the split happened."""
    _house(hass)
    connection = _Connection()

    ws.websocket_area_assign(
        hass, connection,
        {"id": 1, "type": "x", "entity_id": "sensor.temperatur",
         "area_id": "kueche"},
    )

    assert "siblings" not in connection.result


# ── Wenn der Hub weg ist, sagt jeder Befehl das ───────────────────────


@pytest.mark.parametrize(
    ("command", "msg", "is_async"),
    [
        ("websocket_model", {"id": 1}, True),
        ("websocket_layout_set",
         {"id": 1, "section": "nodes", "key": "a", "values": {}}, False),
        ("websocket_layout_reset", {"id": 1, "section": "nodes", "key": "a"}, False),
        ("websocket_history",
         {"id": 1, "kind": "node", "item_id": "demo:a", "hours": 24}, True),
        ("websocket_action",
         {"id": 1, "kind": "node", "item_id": "demo:a", "action": "x", "data": {}},
         True),
        ("websocket_subscribe", {"id": 1}, False),
        ("websocket_diagnostics", {"id": 1}, True),
    ],
)
async def test_every_command_reports_not_found_when_the_hub_is_gone(
    hass, connection, command, msg, is_async
):
    """A renderer connecting before setup finishes gets an answer, not
    silence -- and every command answers with the same code, so a card
    does not need one retry rule per command."""
    handler = getattr(ws, command)
    if is_async:
        await handler(hass, connection, msg)
    else:
        handler(hass, connection, msg)
    assert connection.errors[0] == (1, "not_found", "Spatial Hub not set up")


async def test_a_raising_action_is_reported_not_a_crash(hass, hub, connection):
    """The action runs provider code. What it raises is that provider's
    answer to report -- the connection must survive it."""
    def explode(kind, item, action, data):
        raise RuntimeError("schaltkontakt klemmt")

    hass.data["spatial_hub_providers"]["demo"]["action"] = explode

    await ws.websocket_action(
        hass, connection,
        {"id": 1, "kind": "node", "item_id": "demo:a", "action": "reboot",
         "data": {}},
    )
    assert connection.errors[0][1] == "action_failed"
    assert "schaltkontakt klemmt" in connection.errors[0][2]
    assert connection.errors[0][0] == 1


async def test_an_action_that_returns_no_dict_still_says_success(hass, hub,
                                                                 connection):
    """A provider that answers "ok" means it. The hub wraps what it got
    rather than making the renderer guess what None meant."""
    hass.data["spatial_hub_providers"]["demo"]["action"] = (
        lambda kind, item, action, data: "ok"
    )

    await ws.websocket_action(
        hass, connection,
        {"id": 1, "kind": "node", "item_id": "demo:a", "action": "reboot",
         "data": {}},
    )
    assert connection.results[1] == {"success": True}


def test_facets_reports_what_the_house_has(hass, connection):
    """The rule editor builds against what actually exists here, so a
    layer nobody can configure is never offered."""
    from homeassistant.helpers import entity_registry as er
    from tests.conftest import FakeEntity

    entities = er.async_get(hass).entities
    entities["light.a"] = FakeEntity("light.a", name="A")
    entities["light.b"] = FakeEntity("light.b", name="B")
    entities["sensor.c"] = FakeEntity("sensor.c", name="C")
    entities["sensor.c"].labels = {"sicherheit"}

    ws.websocket_facets(hass, connection, {"id": 1})
    facets = connection.results[1]

    assert facets["domains"] == [
        {"value": "light", "count": 2},
        {"value": "sensor", "count": 1},
    ], "sorted by how often a domain occurs, then by name"
    assert facets["labels"] == [{"value": "sicherheit", "count": 1}]
    assert facets["max_entities"] > 0


def test_an_unknown_entity_cannot_be_moved(hass):
    """A typo in the entity id must not look like a successful move."""
    from homeassistant.helpers import entity_registry as er
    from tests.conftest import FakeEntity

    er.async_get(hass).entities["sensor.da"] = FakeEntity("sensor.da")
    connection = _Connection()

    ws.websocket_area_assign(
        hass, connection,
        {"id": 1, "type": "x", "entity_id": "sensor.wo", "area_id": "kueche"},
    )
    assert connection.error[0] == "not_found"
    assert "sensor.wo" in connection.error[1]


def test_a_move_whose_device_has_vanished_is_refused(hass):
    """The entity still names a device that no longer exists. Reporting
    it beats guessing whether the entity itself should move."""
    from homeassistant.helpers import entity_registry as er
    from tests.conftest import FakeEntity

    _house(hass)
    er.async_get(hass).entities["sensor.waise"] = FakeEntity(
        "sensor.waise", device_id="weg"
    )
    connection = _Connection()

    ws.websocket_area_assign(
        hass, connection,
        {"id": 1, "type": "x", "entity_id": "sensor.waise",
         "area_id": "kueche"},
    )
    assert connection.error[0] == "not_found"
    assert "weg" in connection.error[1]


def test_a_subscription_that_reconnects_receives_again(hass, hub, connection):
    """Unsubscribe and subscribe again -- the normal cycle when a card is
    rebuilt. The second subscription is a new listener on the hub, not the
    old one resurrected, and it works like the first."""
    ws.websocket_subscribe(hass, connection, {"id": 1})
    connection.subscriptions[1]()
    assert hub.async_notify("layout") is None
    assert connection.messages == []

    ws.websocket_subscribe(hass, connection, {"id": 2})
    hub.async_notify("layout")
    assert connection.messages == [{"id": 2, "event": {"reason": "layout"}}]


class _Push:
    """A connection that can hold subscriptions, like the fixture one."""

    def __init__(self) -> None:
        self.messages: list = []
        self.subscriptions: dict = {}

    def send_result(self, _id, result=None) -> None:
        pass

    def send_error(self, _id, code, message) -> None:
        pass

    def send_message(self, message) -> None:
        self.messages.append(message)


def test_two_cards_both_hear_the_same_change(hass, hub):
    """Two renderers on one floor plan: neither subscription disturbs the
    other, and closing one keeps the other alive."""
    connections = [_Push(), _Push()]

    for index, conn in enumerate(connections):
        ws.websocket_subscribe(hass, conn, {"id": index + 1})

    hub.async_notify("layout")
    assert [len(conn.messages) for conn in connections] == [1, 1]

    connections[0].subscriptions[1]()
    hub.async_notify("layout")
    assert len(connections[0].messages) == 1, "closed connection hears nothing"
    assert len(connections[1].messages) == 2, "open connection keeps hearing"


# ── Grenzen, die der Befehlsschema durchsetzt ─────────────────────────


def test_a_theme_sticks_to_its_limits(hass, hub, connection):
    """Everything inside the limits is stored verbatim."""
    ws.websocket_layout_set(
        hass, connection,
        {"id": 1, "section": "settings", "key": "view",
         "values": {"theme": {
             "preset": "neon", "node_size": 3, "house_weight": 1.6,
             "snap_reach": 0.4, "labels": "never", "node_shape": "square",
             "accent": "#00e5ff",
         }}},
    )
    assert connection.results[1] == {"success": True}
    theme = hub.store.get("settings", "view")["theme"]
    assert theme["node_size"] == 3
    assert theme["house_weight"] == 1.6
    assert theme["snap_reach"] == 0.4
    assert theme["labels"] == "never"


@pytest.mark.parametrize(
    "values",
    [
        {"node_size": 3.1}, {"node_size": 0.39},
        {"house_weight": 1.7}, {"house_weight": 0.1},
        {"snap_reach": 3.01}, {"snap_reach": 0.3},
        {"labels": "sometimes"}, {"node_shape": "hexagon"},
        {"edge_style": "wavy"}, {"room_style": "dotted"},
        {"preset": {"neon": True}},
        {"accent": "x" * 65},
    ],
)
def test_a_theme_beyond_its_limits_is_refused(values):
    """The dial's ends exist so a stored mistake cannot turn the plan
    unreadable -- and the refusal happens here, not in the renderer."""
    with pytest.raises(vol.Invalid):
        _layout_values({"theme": values})


def test_an_outline_is_a_box_somewhere_on_the_plan(hass, hub, connection):
    """A stated building line is the user's business; the limits only
    keep it in the same coordinate system as everything else."""
    outline = {"x": -0.9, "y": -0.9, "width": 2.9, "height": 2.9}
    ws.websocket_layout_set(
        hass, connection,
        {"id": 1, "section": "floors", "key": "eg", "values": {"outline": outline}},
    )
    assert hub.store.get("floors", "eg")["outline"] == outline


@pytest.mark.parametrize(
    "outline",
    [
        {"x": -1.1, "y": 0, "width": 1, "height": 1},
        {"x": 0, "y": 2.1, "width": 1, "height": 1},
        {"x": 0, "y": 0, "width": 0, "height": 1},
        {"x": 0, "y": 0, "width": 1, "height": 3.1},
    ],
)
def test_an_outline_beyond_the_plan_is_refused(outline):
    with pytest.raises(vol.Invalid):
        _layout_values({"outline": outline})
