"""The built-in renderer: how it is served, and what it may know.

The interesting tests here are not the plumbing ones. They are the two at
the bottom, which hold the renderer to the same rule as the hub: it draws
what the model says and never learns whose data it is.
"""

from __future__ import annotations

import re
import shutil
import subprocess
from pathlib import Path

import pytest

from custom_components.spatial_hub import (
    async_setup_entry,
    async_unload_entry,
)
from custom_components.spatial_hub.const import (
    CONF_PANEL,
    PANEL_ICON,
    PANEL_TITLE,
    PANEL_URL_PATH,
)
from custom_components.spatial_hub.frontend import (
    PANEL_MODULE,
    URL_BASE,
    panel_version,
    async_register_panel,
    async_remove_panel,
)

from conftest import WWW, FakeConfigEntry, renderer_source

PANEL_JS = (
    Path(__file__).resolve().parents[1]
    / "custom_components"
    / "spatial_hub"
    / "www"
    / PANEL_MODULE
)


@pytest.mark.asyncio
async def test_the_panel_lands_in_the_sidebar(hass):
    await async_register_panel(hass)

    panel = hass.data["_panels"][PANEL_URL_PATH]
    custom = panel["config"]["_panel_custom"]
    assert panel["component_name"] == "custom"
    assert panel["sidebar_title"] == PANEL_TITLE
    assert panel["sidebar_icon"] == PANEL_ICON
    assert custom["module_url"] == f"{URL_BASE}/{PANEL_MODULE}?v={panel_version()}"
    assert custom["embed_iframe"] is False
    assert panel["require_admin"] is False, "looking at the house is not an admin act"


@pytest.mark.asyncio
async def test_the_module_url_actually_resolves_to_a_file(hass):
    await async_register_panel(hass)

    served = hass.http.static_paths[0]
    assert served.url_path == URL_BASE
    assert (Path(served.path) / PANEL_MODULE).is_file(), (
        "the panel points at a module that has to exist on disk"
    )


def test_the_cache_key_follows_the_file_it_caches(tmp_path, monkeypatch):
    """A hand-maintained version number was wrong for most of the project.

    It sat at 0.5.0 through a dozen rewrites of the renderer, so every
    browser that had loaded the panel once kept serving that first copy --
    users saw bugs that were fixed months earlier and reloading did not
    help, because the URL never changed. Deriving it from the file is the
    only version of this that cannot be forgotten.
    """
    from custom_components.spatial_hub import frontend

    before = frontend.panel_version()
    assert before == frontend.panel_version(), "same file, same key"

    original = PANEL_JS.read_bytes()
    try:
        PANEL_JS.write_bytes(original + b"\n/* a change */\n")
        assert frontend.panel_version() != before, (
            "a changed renderer must be a changed URL"
        )
    finally:
        PANEL_JS.write_bytes(original)

    assert frontend.panel_version() == before, "and reverting brings it back"


def test_the_cache_key_covers_the_files_the_panel_imports():
    """A changed stylesheet has to change the URL too.

    Only the entry module gets the `?v=`; its siblings are fetched under
    plain URLs from a static path served with a year of cache headers. If
    the key ignored them, an upgrade would hand the browser a new renderer
    and a year-old stylesheet -- not stale, which is at least
    recognisable, but *mismatched*, which looks like a rendering bug and
    sends the user hunting in the wrong place entirely.
    """
    from custom_components.spatial_hub import frontend

    siblings = [path for path in sorted(WWW.glob("*.js")) if path.name != PANEL_MODULE]
    assert siblings, "the renderer is one file again -- this test can go"

    for path in siblings:
        before = frontend.panel_version()
        original = path.read_bytes()
        try:
            path.write_bytes(original + b"\n/* a change */\n")
            assert frontend.panel_version() != before, (
                f"{path.name} changed and the URL did not -- browsers will "
                "keep the old copy for a year"
            )
        finally:
            path.write_bytes(original)


def test_a_missing_panel_never_breaks_the_cache_key(monkeypatch, tmp_path):
    """No renderer is a problem; a traceback during setup is a worse one."""
    from custom_components.spatial_hub import frontend

    monkeypatch.setattr(frontend, "WWW_DIR", tmp_path / "gone")
    assert frontend.panel_version() == "unknown"


@pytest.mark.asyncio
async def test_the_panel_element_name_matches_what_is_registered(hass):
    await async_register_panel(hass)

    name = hass.data["_panels"][PANEL_URL_PATH]["config"]["_panel_custom"]["name"]
    assert f'customElements.define("{name}"' in PANEL_JS.read_text(), (
        "Home Assistant loads the module and then instantiates this tag; a "
        "mismatch is a blank page with no error"
    )


@pytest.mark.asyncio
async def test_setup_registers_the_panel_and_unload_takes_it_away(hass):
    entry = FakeConfigEntry()

    assert await async_setup_entry(hass, entry) is True
    assert PANEL_URL_PATH in hass.data["_panels"]

    assert await async_unload_entry(hass, entry) is True
    assert PANEL_URL_PATH not in hass.data["_panels"], (
        "a reload must not trip over its own leftover panel"
    )


@pytest.mark.asyncio
async def test_bringing_your_own_renderer_switches_ours_off(hass):
    entry = FakeConfigEntry({CONF_PANEL: False})

    await async_setup_entry(hass, entry)

    assert "_panels" not in hass.data or PANEL_URL_PATH not in hass.data["_panels"]
    assert hass.data["spatial_hub_hub"] is not None, (
        "no panel does not mean no hub -- the websocket API is the product"
    )
    await async_unload_entry(hass, entry)


@pytest.mark.asyncio
async def test_the_option_switches_the_panel_at_runtime(hass):
    entry = FakeConfigEntry({CONF_PANEL: True})
    await async_setup_entry(hass, entry)

    entry.options = {CONF_PANEL: False}
    await entry.update_listener(hass, entry)
    assert PANEL_URL_PATH not in hass.data["_panels"]

    entry.options = {CONF_PANEL: True}
    await entry.update_listener(hass, entry)
    assert PANEL_URL_PATH in hass.data["_panels"]


@pytest.mark.asyncio
async def test_a_broken_panel_does_not_break_the_hub(hass, monkeypatch):
    def explode(*_args, **_kwargs):
        raise RuntimeError("no frontend here")

    monkeypatch.setattr(hass.http, "async_register_static_paths", explode)

    assert await async_setup_entry(hass, FakeConfigEntry()) is True
    assert hass.data["spatial_hub_hub"] is not None


def test_removing_a_panel_that_was_never_there_is_not_an_error(hass):
    async_remove_panel(hass)  # must not raise


# ── The rule the renderer lives under ─────────────────────


def test_the_renderer_knows_no_integration_by_name():
    """The whole point of the hub, enforced one layer further out.

    A renderer that special-cases Powerline is a renderer that has to be
    changed for every new provider. Colours come from `state` and
    `quality`, shapes from `icon` -- all of it provider-supplied.
    """
    source = renderer_source().lower()
    for integration in ("powerline", "unifi", "shelly", "zigbee", "fritz", "tasmota"):
        assert integration not in source, (
            f"the renderer mentions {integration!r} -- the moment it does, "
            "every other integration is a second-class citizen"
        )


def test_the_renderer_only_uses_documented_commands():
    source = renderer_source()
    used = set(re.findall(r"\$\{DOMAIN\}/([a-z/]+)", source))
    documented = {
        "model",
        "providers",
        "subscribe",
        "layout/set",
        "layout/reset",
        "history",
        "action",
        "diagnostics",
        "entities/facets",
        # The one command that writes outside the hub. Documented in the
        # command table of the README, the specification and the provider
        # API -- if it were not, this test would be the thing that noticed.
        "area/assign",
    }
    assert used <= documented, f"undocumented commands used: {sorted(used - documented)}"


def test_the_renderers_own_logic_holds_up():
    """Run the JavaScript test suite from here, so `pytest` is enough.

    Which nodes belong to the floor you are looking at, and which layer
    switches off which provider, is logic like any other -- it does not
    become untestable by being written in JavaScript.
    """
    node = shutil.which("node")
    if node is None:
        pytest.skip("node not installed")
    suite = Path(__file__).with_suffix(".mjs").with_name("test_panel_logic.mjs")
    result = subprocess.run(
        [node, "--test", str(suite)], capture_output=True, text=True
    )
    assert result.returncode == 0, result.stdout + result.stderr


def test_the_renderer_pulls_nothing_off_the_internet():
    """No CDN, no font host, no build artefact fetched at runtime."""
    source = renderer_source()
    assert "http://" not in source
    # Hier stand einmal eine Ausnahme fuer `github.com`. Nachgemessen kam
    # im Renderer keine einzige solche Adresse vor -- die Ausnahme war
    # tot und hat die Regel nur aufgeweicht. Jetzt gilt sie ohne Loch:
    # keine Adresse nach draussen, von keinem Anbieter.
    assert "https://" not in source, (
        "a local-first dashboard must render with the network unplugged"
    )


@pytest.mark.asyncio
async def test_the_cache_key_is_never_read_in_the_event_loop(hass):
    """Setup runs in the loop, and hashing the renderer reads files. Home
    Assistant warns about exactly this, and rightly: on a slow SD card the
    whole instance waits for our cache key."""
    from custom_components.spatial_hub import frontend

    handed_over = []
    original = hass.async_add_executor_job

    async def watched(target, *args):
        handed_over.append(target)
        return await original(target, *args)

    hass.async_add_executor_job = watched
    hass.data.pop("_panels", None)

    await frontend.async_register_panel(hass)

    assert frontend.panel_version in handed_over, (
        "the file read must go to an executor, not the loop"
    )
    custom = hass.data["_panels"][PANEL_URL_PATH]["config"]["_panel_custom"]
    assert custom["module_url"].endswith(f"?v={frontend.panel_version()}"), (
        "and it is still the same key the panel gets"
    )
