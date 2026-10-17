"""Serving the built-in renderer.

The hub does not need a renderer -- the websocket API is the contract, and
a 3D view or a print export would use exactly the same commands. This one
ships in the box so that a fresh install shows the house instead of an
empty sidebar.

Deliberately a plain ES module: no build step, no npm, no bundle to keep in
sync with a repository. HACS copies the file, Home Assistant serves it.
"""

from __future__ import annotations

import gzip
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


async def async_panel_version(hass: HomeAssistant) -> str:
    """The same cache key, read off the event loop.

    Setup runs in the loop, and reading a handful of files from disk there
    stalls everything else Home Assistant is doing -- which is exactly what
    `homeassistant.util.loop` warns about. It is a small read, but "small"
    is not a property of a filesystem: a slow SD card or a network mount
    makes the same call take a second, and the whole instance waits.
    """
    return await hass.async_add_executor_job(panel_version)


def drop_stale_gzip(folder: Path = WWW_DIR) -> list[str]:
    """Gepackte Kopien loeschen, die nicht mehr zu ihrer Datei passen.

    HACS legt neben jede Datei in www eine .gz, und Home Assistant liefert
    die bevorzugt aus. Wird das Panel danach ohne HACS ersetzt (Hand-Kopie,
    git), bleibt die .gz alt -- und der Browser bekommt den alten Renderer,
    egal wie oft er neu laedt, denn der Cache-Schluessel ist ja neu. Auf
    .247 lagen so am 17.10. Packungen vom 30.09. vor jedem Update seither.
    Eine .gz, deren Inhalt nicht mehr die Datei ist, ist keine Abkuerzung
    mehr, sondern eine Luege.
    """
    weg: list[str] = []
    for packung in folder.glob("*.gz"):
        quelle = packung.with_suffix("")
        try:
            if quelle.is_file() and gzip.decompress(packung.read_bytes()) == quelle.read_bytes():
                continue
            packung.unlink()
            weg.append(packung.name)
        except (OSError, EOFError, gzip.BadGzipFile):
            _LOGGER.debug("Konnte %s nicht pruefen", packung, exc_info=True)
    if weg:
        _LOGGER.info("Veraltete gepackte Panel-Dateien entfernt: %s", ", ".join(weg))
    return weg


async def async_register_panel(hass: HomeAssistant) -> None:
    """Serve the renderer and put it in the sidebar."""
    await hass.async_add_executor_job(drop_stale_gzip)
    await _async_register_static_path(hass)

    version = await async_panel_version(hass)

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
                "module_url": f"{URL_BASE}/{PANEL_MODULE}?v={version}",
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

    # Nicht hart gecacht. Nur das Einstiegsmodul traegt das ?v=; die
    # Geschwister laedt der Browser unter festen Adressen, und mit einem
    # Jahr Cache bekam er nach einem Update ein neues Panel mit einer alten
    # panel-view.js ("_editBarHtml is not a function", die Seite blieb auf
    # "Grundriss wird geladen" stehen -- so auf .247 am 17.10. gesehen).
    # Ohne Cache-Kopfzeilen fragt er nach und bekommt meist ein 304.
    await hass.http.async_register_static_paths(
        [StaticPathConfig(URL_BASE, path, False)]
    )
