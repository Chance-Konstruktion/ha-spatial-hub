"""Floorplan-Hub -- the spatial bus for Home Assistant.

The hub is not a card. It is a service that collects spatial data from any
integration willing to describe itself, merges it with Home Assistant's own
floors and areas plus whatever the user rearranged, and serves one model
over websocket for any renderer to draw.

It knows nothing about Powerline, UniFi or Shelly -- only about providers,
layers, nodes, edges, actions and capabilities. That is the whole point:
a new integration joins the floor plan without a single change here.
"""

from __future__ import annotations

import logging

from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant

from .const import (
    CONF_AUTO_AREAS,
    CONF_PANEL,
    DATA_HUB,
    DATA_STORE,
    DEFAULT_AUTO_AREAS,
    DEFAULT_PANEL,
    DOMAIN,
)
from .frontend import async_register_panel, async_remove_panel
from .hub import FloorplanHub
from .registry import async_get_registrations
from .storage import LayoutStore
from .websocket import async_register as async_register_websocket

_LOGGER = logging.getLogger(__name__)

_DATA_WS_REGISTERED = f"{DOMAIN}_ws_registered"
_DATA_PANEL = f"{DOMAIN}_panel_registered"


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Set up the hub."""
    # Touch the shared registry first: providers that loaded before the hub
    # have already written into it, and ones loading later find it ready.
    registrations = async_get_registrations(hass)

    store = LayoutStore(hass)
    await store.async_load()
    hass.data[DATA_STORE] = store

    hub = FloorplanHub(hass, store)
    hub.auto_areas = bool(entry.options.get(CONF_AUTO_AREAS, DEFAULT_AUTO_AREAS))
    hub.async_start()
    hass.data[DATA_HUB] = hub

    if not hass.data.get(_DATA_WS_REGISTERED):
        hass.data[_DATA_WS_REGISTERED] = True
        async_register_websocket(hass)

    hass.data[_DATA_PANEL] = False
    if entry.options.get(CONF_PANEL, DEFAULT_PANEL):
        # A renderer that fails to register must not take the data layer
        # with it -- the websocket API is the actual product here.
        try:
            await async_register_panel(hass)
            hass.data[_DATA_PANEL] = True
        except Exception:  # noqa: BLE001 - a missing sidebar is survivable
            _LOGGER.exception("Floorplan-Hub could not register its panel")

    entry.async_on_unload(entry.add_update_listener(_async_options_updated))

    _LOGGER.info(
        "Floorplan-Hub ready with %d provider(s): %s",
        len(registrations),
        ", ".join(sorted(registrations)) or "none yet",
    )
    return True


async def _async_options_updated(hass: HomeAssistant, entry: ConfigEntry) -> None:
    hub: FloorplanHub | None = hass.data.get(DATA_HUB)
    if hub is None:
        return
    hub.auto_areas = bool(entry.options.get(CONF_AUTO_AREAS, DEFAULT_AUTO_AREAS))

    wanted = bool(entry.options.get(CONF_PANEL, DEFAULT_PANEL))
    if wanted != bool(hass.data.get(_DATA_PANEL)):
        if wanted:
            await async_register_panel(hass)
        else:
            async_remove_panel(hass)
        hass.data[_DATA_PANEL] = wanted

    hub.async_notify("options")


async def async_unload_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Unload the hub, leaving provider registrations untouched.

    Providers keep their entry in hass.data: they are not ours to remove,
    and they must survive a hub reload without re-registering.
    """
    hub: FloorplanHub | None = hass.data.pop(DATA_HUB, None)
    if hub is not None:
        hub.async_stop()
    hass.data.pop(DATA_STORE, None)
    if hass.data.pop(_DATA_PANEL, False):
        async_remove_panel(hass)
    return True
