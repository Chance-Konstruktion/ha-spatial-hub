"""Websocket API -- the only door between the hub and any renderer.

Deliberately renderer-agnostic: it hands out the spatial model and takes
back the user's arrangement. An SVG card, a Three.js view and a print
export all use exactly these commands.
"""

from __future__ import annotations

import voluptuous as vol

from homeassistant.components import websocket_api
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers import (
    area_registry as ar,
    device_registry as dr,
    entity_registry as er,
)

from .const import (
    API_VERSION,
    AREA_KINDS,
    CURRENT_SDK_VERSION,
    DATA_HUB,
    DOMAIN,
    MAX_BACKGROUND_BYTES,
)
from .generic import async_facets, physical_siblings
from .hub import SpatialHub

_COLOUR = vol.All(str, vol.Length(max=64))

# A theme colours the shared vocabulary -- node states and edge qualities --
# never an integration. See theme.py for why that distinction matters.
_THEME_SCHEMA = {
    vol.Optional("preset"): vol.All(str, vol.Length(max=32)),
    vol.Optional("accent"): _COLOUR,
    vol.Optional("surface"): _COLOUR,
    vol.Optional("ink"): _COLOUR,
    vol.Optional("state_colors"): {str: _COLOUR},
    vol.Optional("quality_colors"): {str: _COLOUR},
    vol.Optional("node_shape"): vol.In(["circle", "rounded", "square"]),
    vol.Optional("node_size"): vol.All(vol.Coerce(float), vol.Range(min=0.4, max=3)),
    vol.Optional("house_weight"): vol.All(
        vol.Coerce(float), vol.Range(min=0.2, max=1.6)
    ),
    vol.Optional("labels"): vol.In(["always", "hover", "never"]),
    vol.Optional("edge_style"): vol.In(["straight", "curved"]),
    vol.Optional("room_style"): vol.In(["outline", "filled", "none"]),
}

_NAMES = [vol.All(str, vol.Length(max=128))]

# A custom layer is a *rule*, not a list: "all the lights" stays right when
# a lamp is added next month.
_CUSTOM_LAYER_SCHEMA = vol.Schema(
    {
        vol.Required("id"): vol.All(str, vol.Length(min=1, max=64)),
        vol.Required("name"): vol.All(str, vol.Length(max=128)),
        vol.Optional("icon"): vol.All(str, vol.Length(max=64)),
        vol.Optional("domains"): _NAMES,
        vol.Optional("areas"): _NAMES,
        vol.Optional("labels"): _NAMES,
        vol.Optional("device_classes"): _NAMES,
        vol.Optional("entities"): _NAMES,
        vol.Optional("exclude"): _NAMES,
        vol.Optional("topology"): bool,
        vol.Optional("z_index"): vol.Coerce(int),
    }
)

_SIZE_SCHEMA = {
    vol.Required("width"): vol.All(vol.Coerce(float), vol.Range(min=0.01, max=2)),
    vol.Required("height"): vol.All(vol.Coerce(float), vol.Range(min=0.01, max=2)),
}

# A storey's outer walls. Bounded like a position rather than like a size,
# because it is a box *somewhere* on the plan rather than an extent: the
# apron reaches outside 0..1 and a building that touched it would be wrong,
# but a stated line is the user's business and only needs sane limits.
_OUTLINE_SCHEMA = {
    vol.Required("x"): vol.All(vol.Coerce(float), vol.Range(min=-1, max=2)),
    vol.Required("y"): vol.All(vol.Coerce(float), vol.Range(min=-1, max=2)),
    vol.Required("width"): vol.All(vol.Coerce(float), vol.Range(min=0.01, max=3)),
    vol.Required("height"): vol.All(vol.Coerce(float), vol.Range(min=0.01, max=3)),
}

# A room's own outline inside its box, and the plot the house stands on.
# Both are lists of corners rather than rectangles, and both were missing
# here: the editor drew them, sent them, and this schema rejected the
# whole write -- so every corner snapped back the moment the hub answered.
# The two live in different frames, which is why the limits differ.
#
# `shape` is box-local: 0 is one wall, 1 is the opposite one, and a corner
# outside that would be a room bigger than itself.
_SHAPE_POINT = {
    vol.Required("x"): vol.All(vol.Coerce(float), vol.Range(min=0, max=1)),
    vol.Required("y"): vol.All(vol.Coerce(float), vol.Range(min=0, max=1)),
}
# `plot` is in floor coordinates and deliberately roomy: everybody's
# garden is a different size, and a boundary that stopped at the walls
# would not be a boundary.
_PLOT_POINT = {
    vol.Required("x"): vol.All(vol.Coerce(float), vol.Range(min=-4, max=5)),
    vol.Required("y"): vol.All(vol.Coerce(float), vol.Range(min=-4, max=5)),
}
# Three corners is a triangle, the smallest thing that encloses anything.
_SHAPE_SCHEMA = vol.All([_SHAPE_POINT], vol.Length(min=3, max=64))
_PLOT_SCHEMA = vol.All([_PLOT_POINT], vol.Length(min=3, max=64))

# Area ids, so the list stays a list of neighbours rather than a place to
# park arbitrary data. Bounded: a room has walls, not a hundred of them.
_UNJOINED_SCHEMA = vol.All([str], vol.Length(max=64))

# An opening in one of a room's walls. Box-local, like `shape`: `side` is
# which edge (the same order the outline runs in), `at` is the middle of
# the opening along that edge and `width` how much of the edge it takes.
# All of it in fractions, so a door survives moving and resizing the room.
#
# `width` stops short of 1: a wall that is entirely doorway is not a wall
# with a door in it, it is a missing wall, and the editor already has a
# way to say that.
_DOOR_SCHEMA = {
    vol.Required("side"): vol.All(vol.Coerce(int), vol.Range(min=0, max=63)),
    vol.Required("at"): vol.All(vol.Coerce(float), vol.Range(min=0, max=1)),
    vol.Required("width"): vol.All(
        vol.Coerce(float), vol.Range(min=0.01, max=0.95)
    ),
}
# A room has walls, not a hundred of them -- and each wall a door or two.
_DOORS_SCHEMA = vol.All([_DOOR_SCHEMA], vol.Length(max=64))

_POSITION_SCHEMA = {
    vol.Required("x"): vol.All(vol.Coerce(float), vol.Range(min=-1, max=2)),
    vol.Required("y"): vol.All(vol.Coerce(float), vol.Range(min=-1, max=2)),
    vol.Optional("z"): vol.Coerce(float),
}


@callback
def async_register(hass: HomeAssistant) -> None:
    """Register every hub command (safe to call once per start-up)."""
    for command in (
        websocket_model,
        websocket_providers,
        websocket_layout_set,
        websocket_layout_reset,
        websocket_history,
        websocket_action,
        websocket_subscribe,
        websocket_diagnostics,
        websocket_facets,
        websocket_area_assign,
    ):
        websocket_api.async_register_command(hass, command)


def _hub(hass: HomeAssistant) -> SpatialHub | None:
    return hass.data.get(DATA_HUB)


@websocket_api.websocket_command({vol.Required("type"): f"{DOMAIN}/model"})
@websocket_api.async_response
async def websocket_model(hass: HomeAssistant, connection, msg: dict) -> None:
    """The complete spatial model: floors, areas, layers, nodes, edges."""
    hub = _hub(hass)
    if hub is None:
        connection.send_error(msg["id"], "not_found", "Spatial Hub not set up")
        return
    connection.send_result(msg["id"], await hub.async_model())


@websocket_api.websocket_command({vol.Required("type"): f"{DOMAIN}/providers"})
@callback
def websocket_providers(hass: HomeAssistant, connection, msg: dict) -> None:
    """Registered providers and what each says it can do."""
    hub = _hub(hass)
    if hub is None:
        connection.send_error(msg["id"], "not_found", "Spatial Hub not set up")
        return
    connection.send_result(
        msg["id"],
        {"providers": [p.as_dict() for p in hub.providers.values()]},
    )


@websocket_api.websocket_command(
    {
        vol.Required("type"): f"{DOMAIN}/layout/set",
        vol.Required("section"): vol.In(
            ["nodes", "layers", "floors", "areas", "settings"]
        ),
        vol.Required("key"): str,
        vol.Required("values"): {
            vol.Optional("theme"): vol.Any(None, _THEME_SCHEMA),
            vol.Optional("custom_layers"): vol.Any(
                None, vol.All([_CUSTOM_LAYER_SCHEMA], vol.Length(max=25))
            ),
            vol.Optional("position"): vol.Any(None, _POSITION_SCHEMA),
            vol.Optional("size"): vol.Any(None, _SIZE_SCHEMA),
            vol.Optional("label_offset"): vol.Any(None, dict),
            vol.Optional("icon"): vol.Any(None, str),
            vol.Optional("color"): vol.Any(None, str),
            vol.Optional("scale"): vol.Any(
                None, vol.All(vol.Coerce(float), vol.Range(min=0.2, max=5))
            ),
            vol.Optional("rotation"): vol.Any(
                None, vol.All(vol.Coerce(float), vol.Range(min=-360, max=360))
            ),
            vol.Optional("hidden"): vol.Any(None, bool),
            vol.Optional("visible"): vol.Any(None, bool),
            vol.Optional("z_index"): vol.Any(None, vol.Coerce(int)),
            vol.Optional("opacity"): vol.Any(
                None, vol.All(vol.Coerce(float), vol.Range(min=0, max=1))
            ),
            vol.Optional("background"): vol.Any(None, str),
            vol.Optional("aspect"): vol.Any(
                None, vol.All(vol.Coerce(float), vol.Range(min=0.1, max=10))
            ),
            vol.Optional("name"): vol.Any(None, str),
            vol.Optional("order"): vol.Any(None, vol.Coerce(int)),
            vol.Optional("outline"): vol.Any(None, _OUTLINE_SCHEMA),
            vol.Optional("shape"): vol.Any(None, _SHAPE_SCHEMA),
            # Openings in this room's walls.
            vol.Optional("doors"): vol.Any(None, _DOORS_SCHEMA),
            # Rooms this one is *not* sharing a wall with, however much
            # the geometry says otherwise. A party wall between two flats
            # really is two walls.
            vol.Optional("unjoined"): vol.Any(None, _UNJOINED_SCHEMA),
            vol.Optional("plot"): vol.Any(None, _PLOT_SCHEMA),
            # How wide the house is in metres -- the expert's one number.
            vol.Optional("metres"): vol.Any(
                None, vol.All(vol.Coerce(float), vol.Range(min=1, max=200))
            ),
            # What an area is, and where it may be drawn.
            vol.Optional("kind"): vol.Any(None, vol.In(list(AREA_KINDS))),
            vol.Optional("in_sandwich"): vol.Any(None, bool),
            vol.Optional("single_only"): vol.Any(None, bool),
        },
    }
)
@callback
def websocket_layout_set(hass: HomeAssistant, connection, msg: dict) -> None:
    """Persist one piece of the user's arrangement.

    ``null`` for a value clears that override and returns the item to its
    automatic placement -- that is how the editor's "reset" works.
    """
    hub = _hub(hass)
    if hub is None:
        connection.send_error(msg["id"], "not_found", "Spatial Hub not set up")
        return

    background = msg["values"].get("background")
    if isinstance(background, str) and len(background.encode()) > MAX_BACKGROUND_BYTES:
        connection.send_error(msg["id"], "invalid_format", "Background image too large")
        return

    hub.store.update(msg["section"], msg["key"], msg["values"])
    hub.async_notify("layout")
    connection.send_result(msg["id"], {"success": True})


@websocket_api.websocket_command(
    {
        vol.Required("type"): f"{DOMAIN}/layout/reset",
        vol.Required("section"): vol.In(
            ["nodes", "layers", "floors", "areas", "settings"]
        ),
        vol.Required("key"): str,
    }
)
@callback
def websocket_layout_reset(hass: HomeAssistant, connection, msg: dict) -> None:
    """Drop every override for one item."""
    hub = _hub(hass)
    if hub is None:
        connection.send_error(msg["id"], "not_found", "Spatial Hub not set up")
        return
    hub.store.remove(msg["section"], msg["key"])
    hub.async_notify("layout")
    connection.send_result(msg["id"], {"success": True})


@websocket_api.websocket_command(
    {
        vol.Required("type"): f"{DOMAIN}/history",
        vol.Required("kind"): vol.In(["node", "edge"]),
        vol.Required("item_id"): str,
        vol.Optional("hours", default=24): vol.All(
            vol.Coerce(float), vol.Range(min=0.1, max=744)
        ),
    }
)
@websocket_api.async_response
async def websocket_history(hass: HomeAssistant, connection, msg: dict) -> None:
    """History for one node or edge, straight from its provider."""
    hub = _hub(hass)
    if hub is None:
        connection.send_error(msg["id"], "not_found", "Spatial Hub not set up")
        return
    series = await hub.async_history(msg["kind"], msg["item_id"], msg["hours"])
    connection.send_result(
        msg["id"],
        {"item_id": msg["item_id"], "kind": msg["kind"], "hours": msg["hours"],
         "series": series},
    )


@websocket_api.websocket_command(
    {
        vol.Required("type"): f"{DOMAIN}/action",
        vol.Required("kind"): vol.In(["node", "edge"]),
        vol.Required("item_id"): str,
        vol.Required("action"): str,
        vol.Optional("data", default={}): dict,
    }
)
@websocket_api.require_admin
@websocket_api.async_response
async def websocket_action(hass: HomeAssistant, connection, msg: dict) -> None:
    """Run a provider action. Admin-only -- these switch real hardware."""
    hub = _hub(hass)
    if hub is None:
        connection.send_error(msg["id"], "not_found", "Spatial Hub not set up")
        return
    try:
        result = await hub.async_action(
            msg["kind"], msg["item_id"], msg["action"], msg["data"]
        )
    except LookupError as err:
        connection.send_error(msg["id"], "not_found", str(err))
        return
    except Exception as err:  # noqa: BLE001 - provider code, report don't crash
        connection.send_error(msg["id"], "action_failed", str(err))
        return
    connection.send_result(msg["id"], result)


@websocket_api.websocket_command({vol.Required("type"): f"{DOMAIN}/subscribe"})
@callback
def websocket_subscribe(hass: HomeAssistant, connection, msg: dict) -> None:
    """Push a hint whenever the model changed.

    Only a reason is pushed, not the model: a card that is not looking at
    the affected layer can ignore it, and one that cares re-fetches. Keeps
    big payloads off idle connections.
    """
    hub = _hub(hass)
    if hub is None:
        connection.send_error(msg["id"], "not_found", "Spatial Hub not set up")
        return

    @callback
    def forward(reason: str) -> None:
        connection.send_message(
            websocket_api.event_message(msg["id"], {"reason": reason})
        )

    connection.subscriptions[msg["id"]] = hub.async_add_listener(forward)
    connection.send_result(msg["id"])


@websocket_api.websocket_command({vol.Required("type"): f"{DOMAIN}/diagnostics"})
@websocket_api.async_response
async def websocket_diagnostics(hass: HomeAssistant, connection, msg: dict) -> None:
    """What each provider actually delivered, and what was wrong with it.

    Aimed squarely at integration developers: an empty layer should never
    be a mystery. Reports dropped items, timeouts, exceptions and suspected
    typos in the registration, per provider.
    """
    hub = _hub(hass)
    if hub is None:
        connection.send_error(msg["id"], "not_found", "Spatial Hub not set up")
        return

    # Build the model first so the status reflects right now, not whenever
    # a card last asked.
    await hub.async_model()
    connection.send_result(
        msg["id"],
        {
            "api_version": API_VERSION,
            "sdk_version": CURRENT_SDK_VERSION,
            "providers": {
                provider_id: status
                for provider_id, status in hub.status.items()
            },
        },
    )


@websocket_api.websocket_command({vol.Required("type"): f"{DOMAIN}/entities/facets"})
@callback
def websocket_facets(hass: HomeAssistant, connection, msg: dict) -> None:
    """Domains, labels and device classes that actually exist here.

    For building a custom layer's rule against what the house really has,
    rather than against a guessed list of integration names.
    """
    connection.send_result(msg["id"], async_facets(hass))


@websocket_api.websocket_command(
    {
        vol.Required("type"): f"{DOMAIN}/area/assign",
        vol.Required("entity_id"): str,
        vol.Required("area_id"): vol.Any(None, str),
        # Which registry to write to. Left out, the hub decides -- see
        # below, and the reason it decides is the whole point.
        vol.Optional("scope"): vol.In(["device", "entity"]),
    }
)
@websocket_api.require_admin
@callback
def websocket_area_assign(hass: HomeAssistant, connection, msg: dict) -> None:
    """Move a thing into a room -- in Home Assistant, not just in the plan.

    This is the one command that writes outside the hub. Everything else
    here arranges a picture; this changes the configuration that every
    dashboard, every automation and every voice assistant reads. Hence
    admin-only, and hence the answer it sends back: enough to put things
    exactly as they were.

    **Device or entity** is not asked, it is worked out. A dot sits where
    it sits because *something* decided its area, and that something is
    either an override on the entity or the area of its device. Whichever
    one put the dot there is the one that moves it -- so dragging a board
    moves the board, and dragging an entity that was deliberately pulled
    out of its device's room (a WiFi-CSI sensor tracking the guest WC
    while its lamp stands in the front garden) moves only that entity and
    leaves the arrangement intact.
    """
    entities = er.async_get(hass)
    entry = entities.async_get(msg["entity_id"])
    if entry is None:
        connection.send_error(
            msg["id"], "not_found", f"No such entity: {msg['entity_id']}"
        )
        return

    area_id = msg["area_id"]
    if area_id is not None and ar.async_get(hass).async_get_area(area_id) is None:
        connection.send_error(msg["id"], "not_found", f"No such area: {area_id}")
        return

    siblings: list[dict] = []
    scope = msg.get("scope")
    if scope is None:
        scope = "entity" if entry.area_id is not None else "device"
    if scope == "device" and not entry.device_id:
        # An entity with no device has nowhere else to keep its area.
        scope = "entity"

    if scope == "device":
        devices = dr.async_get(hass)
        device = devices.async_get(entry.device_id)
        if device is None:
            connection.send_error(
                msg["id"], "not_found", f"No such device: {entry.device_id}"
            )
            return
        before = device.area_id
        devices.async_update_device(device.id, area_id=area_id)
        target = device.id
        # From 2026.8 a device belongs to one config entry, so the same
        # physical box can have a second entry from another integration --
        # with its own area, which this move did not touch. Writing it too
        # would move entities the user never dragged; saying nothing would
        # make the move look half-done. So it is reported.
        siblings = [
            {
                "device_id": other.id,
                "name": getattr(other, "name_by_user", None)
                or getattr(other, "name", "")
                or "",
                "area_id": other.area_id,
            }
            for other in physical_siblings(hass, device)
            if other.area_id != area_id
        ]
    else:
        before = entry.area_id
        entities.async_update_entity(entry.entity_id, area_id=area_id)
        target = entry.entity_id

    # Everything the caller needs to undo it, and nothing it has to guess.
    result = {"scope": scope, "target": target, "before": before, "after": area_id}
    if siblings:
        # Only when there is something to say -- an ordinary move keeps the
        # short answer it always had.
        result["siblings"] = siblings
    connection.send_result(msg["id"], result)
