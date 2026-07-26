"""Websocket API -- the only door between the hub and any renderer.

Deliberately renderer-agnostic: it hands out the spatial model and takes
back the user's arrangement. An SVG card, a Three.js view and a print
export all use exactly these commands.
"""

from __future__ import annotations

import voluptuous as vol

from homeassistant.components import websocket_api
from homeassistant.core import HomeAssistant, callback

from .const import (
    API_VERSION,
    CURRENT_SDK_VERSION,
    DATA_HUB,
    DOMAIN,
    MAX_BACKGROUND_BYTES,
)
from .generic import async_facets
from .hub import FloorplanHub

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
    ):
        websocket_api.async_register_command(hass, command)


def _hub(hass: HomeAssistant) -> FloorplanHub | None:
    return hass.data.get(DATA_HUB)


@websocket_api.websocket_command({vol.Required("type"): f"{DOMAIN}/model"})
@websocket_api.async_response
async def websocket_model(hass: HomeAssistant, connection, msg: dict) -> None:
    """The complete spatial model: floors, areas, layers, nodes, edges."""
    hub = _hub(hass)
    if hub is None:
        connection.send_error(msg["id"], "not_found", "Floorplan-Hub not set up")
        return
    connection.send_result(msg["id"], await hub.async_model())


@websocket_api.websocket_command({vol.Required("type"): f"{DOMAIN}/providers"})
@callback
def websocket_providers(hass: HomeAssistant, connection, msg: dict) -> None:
    """Registered providers and what each says it can do."""
    hub = _hub(hass)
    if hub is None:
        connection.send_error(msg["id"], "not_found", "Floorplan-Hub not set up")
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
        connection.send_error(msg["id"], "not_found", "Floorplan-Hub not set up")
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
        connection.send_error(msg["id"], "not_found", "Floorplan-Hub not set up")
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
        connection.send_error(msg["id"], "not_found", "Floorplan-Hub not set up")
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
        connection.send_error(msg["id"], "not_found", "Floorplan-Hub not set up")
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
        connection.send_error(msg["id"], "not_found", "Floorplan-Hub not set up")
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
        connection.send_error(msg["id"], "not_found", "Floorplan-Hub not set up")
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
