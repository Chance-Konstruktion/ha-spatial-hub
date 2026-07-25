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

from custom_components.floorplan_hub import (
    async_setup_entry,
    async_unload_entry,
)
from custom_components.floorplan_hub.const import (
    CONF_PANEL,
    PANEL_ICON,
    PANEL_TITLE,
    PANEL_URL_PATH,
)
from custom_components.floorplan_hub.frontend import (
    PANEL_MODULE,
    PANEL_VERSION,
    URL_BASE,
    async_register_panel,
    async_remove_panel,
)

from conftest import FakeConfigEntry

PANEL_JS = (
    Path(__file__).resolve().parents[1]
    / "custom_components"
    / "floorplan_hub"
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
    assert custom["module_url"] == f"{URL_BASE}/{PANEL_MODULE}?v={PANEL_VERSION}"
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
    assert hass.data["floorplan_hub_hub"] is not None, (
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
    assert hass.data["floorplan_hub_hub"] is not None


def test_removing_a_panel_that_was_never_there_is_not_an_error(hass):
    async_remove_panel(hass)  # must not raise


# ── The rule the renderer lives under ─────────────────────


def test_the_renderer_knows_no_integration_by_name():
    """The whole point of the hub, enforced one layer further out.

    A renderer that special-cases Powerline is a renderer that has to be
    changed for every new provider. Colours come from `state` and
    `quality`, shapes from `icon` -- all of it provider-supplied.
    """
    source = PANEL_JS.read_text().lower()
    for integration in ("powerline", "unifi", "shelly", "zigbee", "fritz", "tasmota"):
        assert integration not in source, (
            f"the renderer mentions {integration!r} -- the moment it does, "
            "every other integration is a second-class citizen"
        )


def test_the_renderer_only_uses_documented_commands():
    source = PANEL_JS.read_text()
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
    source = PANEL_JS.read_text()
    assert "http://" not in source
    assert not re.search(r"https://(?!github\.com)", source), (
        "a local-first dashboard must render with the network unplugged"
    )
