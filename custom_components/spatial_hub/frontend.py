"""Serving the built-in renderer.

The hub does not need a renderer -- the websocket API is the contract, and
a 3D view or a print export would use exactly the same commands. This one
ships in the box so that a fresh install shows the house instead of an
empty sidebar.

Deliberately a plain ES module: no build step, no npm, no bundle to keep in
sync with a repository. HACS copies the file, Home Assistant serves it.
"""

from __future__ import annotations

import hashlib
import logging
from pathlib import Path

from homeassistant.core import HomeAssistant, callback

from .const import DOMAIN, PANEL_ICON, PANEL_TITLE, PANEL_URL_PATH

_LOGGER = logging.getLogger(__name__)

URL_BASE = f"/{DOMAIN}_frontend"
PANEL_MODULE = "spatial-hub-panel.js"
# Der Ordner, den der Browser als Renderer bekommt -- Einstiegsmodul
# plus die Geschwister, die es importiert.
WWW_DIR = Path(__file__).parent / "www"


def panel_version() -> str:
    """A cache key that changes exactly when the panel does.

    This used to be a hand-maintained string, and it was wrong for most of
    the project's life: the renderer was rewritten a dozen times while the
    number stayed at 0.5.0, so every browser that had ever loaded the panel
    kept serving its first copy from cache. Users saw bugs that had been
    fixed months earlier and no amount of reloading helped, because the URL
    never changed.

    Hashing the file removes the step a human has to remember. A changed
    renderer is a changed URL, always, and an unchanged one still gets to
    stay in the browser's cache where it belongs.

    Every file in `www`, not just the entry module. The renderer imports
    its stylesheet and its geometry from siblings, and only the entry
    module carries the `?v=` -- the siblings are fetched under plain URLs
    from a static path served with a year of cache headers. Hashing one
    file would put us straight back in the hole described above, with a
    twist that is worse to debug: the user gets a *new* panel and a
    year-old stylesheet, so the renderer is not stale, it is mismatched.
    """
    try:
        # Sorted, so the key depends on the content and not on whatever
        # order the filesystem hands the names back.
        source = b"".join(
            path.read_bytes() for path in sorted(WWW_DIR.glob("*.js"))
        )
    except OSError:  # pragma: no cover - the files ship with the component
        # Never break the panel over a cache key: an uncacheable URL is a
        # far smaller problem than no renderer at all.
        return "unknown"
    return hashlib.sha256(source).hexdigest()[:12] if source else "unknown"


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
                "name": "spatial-hub-panel",
                "module_url": f"{URL_BASE}/{PANEL_MODULE}?v={panel_version()}",
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
        _LOGGER.debug("Spatial Hub panel was not registered", exc_info=True)


async def _async_register_static_path(hass: HomeAssistant) -> None:
    """Publish the www folder, tolerating both HTTP component generations."""
    path = str(WWW_DIR)
    from homeassistant.components.http import StaticPathConfig

    # Cached hard, busted by the ?v= above -- which is why that key
    # hashes every file in here and not just the entry module.
    await hass.http.async_register_static_paths(
        [StaticPathConfig(URL_BASE, path, True)]
    )
