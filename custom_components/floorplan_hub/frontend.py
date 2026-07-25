"""Serving the built-in renderer.

The hub does not need a renderer -- the websocket API is the contract, and
a 3D view or a print export would use exactly the same commands. This one
ships in the box so that a fresh install shows the house instead of an
empty sidebar.

Deliberately a plain ES module: no build step, no npm, no bundle to keep in
sync with a repository. HACS copies the file, Home Assistant serves it.
"""

from __future__ import annotations

import logging
from pathlib import Path

from homeassistant.core import HomeAssistant, callback

from .const import DOMAIN, PANEL_ICON, PANEL_TITLE, PANEL_URL_PATH

_LOGGER = logging.getLogger(__name__)

URL_BASE = f"/{DOMAIN}_frontend"
PANEL_MODULE = "floorplan-hub-panel.js"
# Bumped whenever the panel changes -- browsers cache modules aggressively
# and a stale renderer against a fresh model is a bad first impression.
PANEL_VERSION = "0.2.0"


async def async_register_panel(hass: HomeAssistant) -> None:
    """Serve the renderer and put it in the sidebar."""
    await _async_register_static_path(hass)

    from homeassistant.components import frontend

    frontend.async_register_built_in_panel(
        hass,
        component_name="custom",
        sidebar_title=PANEL_TITLE,
        sidebar_icon=PANEL_ICON,
        frontend_url_path=PANEL_URL_PATH,
        config={
            "_panel_custom": {
                "name": "floorplan-hub-panel",
                "module_url": f"{URL_BASE}/{PANEL_MODULE}?v={PANEL_VERSION}",
                "embed_iframe": False,
                "trust_external": False,
            }
        },
        # Viewing the house is not an admin act. Actions are checked
        # separately, in the websocket layer where it matters.
        require_admin=False,
    )


@callback
def async_remove_panel(hass: HomeAssistant) -> None:
    """Take the panel out of the sidebar again."""
    from homeassistant.components import frontend

    try:
        frontend.async_remove_panel(hass, PANEL_URL_PATH)
    except Exception:  # noqa: BLE001 - already gone is not a failure
        _LOGGER.debug("Floorplan-Hub panel was not registered", exc_info=True)


async def _async_register_static_path(hass: HomeAssistant) -> None:
    """Publish the www folder, tolerating both HTTP component generations."""
    path = str(Path(__file__).parent / "www")
    from homeassistant.components.http import StaticPathConfig

    # Cached hard, busted by the ?v= above: the panel is one file and it
    # should not be re-fetched on every dashboard visit.
    await hass.http.async_register_static_paths(
        [StaticPathConfig(URL_BASE, path, True)]
    )
