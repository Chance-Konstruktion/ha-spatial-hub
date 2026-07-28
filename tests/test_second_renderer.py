"""The second renderer: the claim that the first one has no privileges.

One HTML file, opened from a desktop, sharing no code with the hub. If it
can draw the house, then the built-in panel is one renderer among
possible others rather than the renderer -- which is the only thing that
makes "bring your own view" true instead of merely stated.
"""

from __future__ import annotations

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SECOND = ROOT / "examples" / "second_renderer" / "index.html"
PANEL = ROOT / "custom_components" / "spatial_hub" / "www" / "spatial-hub-panel.js"

# Everything a renderer is allowed to send, from docs/PROVIDER_API.md.
DOCUMENTED = {
    "model", "providers", "subscribe", "layout/set", "layout/reset",
    "history", "action", "diagnostics", "entities/facets",
}


def _code_only() -> str:
    """The file with its prose stripped, string literals kept.

    The comments explain at length which commands this renderer must never
    send and which theme preset it must never know about -- naming both, of
    course. Deleting the reasoning to satisfy a grep would be the wrong
    trade; the bug being looked for lives in code, so only code is read.
    """
    source = SECOND.read_text()
    source = re.sub(r"<!--.*?-->", "", source, flags=re.S)
    return re.sub(r"^\s*//[^\n]*", "", source, flags=re.M)


def _commands(source: str) -> set[str]:
    return set(re.findall(r"spatial_hub/([a-z/]+)", source))


def test_it_only_speaks_the_documented_api():
    used = _commands(_code_only())
    assert used, "no websocket command found at all -- is it drawing anything?"
    assert used <= DOCUMENTED, f"undocumented: {sorted(used - DOCUMENTED)}"


def test_a_read_only_renderer_needs_almost_nothing():
    """Two commands draw the whole house. That is the point of the model."""
    assert _commands(_code_only()) == {"model", "subscribe"}


def test_it_never_writes_the_users_arrangement():
    """It has no edit mode, so it must not touch the layout at all."""
    source = _code_only()
    assert "layout/set" not in source
    assert "layout/reset" not in source


def test_it_shares_no_code_with_the_hub():
    """A second renderer that imports ours proves nothing about anything."""
    source = SECOND.read_text()
    for smell in ("spatial_hub_frontend", "../custom_components",
                  "spatial-hub-panel"):
        assert smell not in source, (
            f"it reaches into the hub's own files ({smell}) -- then it is not "
            "an independent renderer, it is the first one wearing a hat"
        )


def test_it_reimplements_no_theme_preset():
    """Phase 6 said themes resolve in the hub. This is where that is paid off.

    The hub ships five presets. A second renderer must not contain one of
    them: it gets `model["theme"]` fully resolved, and a sixth preset added
    next year must reach it without anybody touching this file.
    """
    from custom_components.spatial_hub.theme import PRESETS

    source = _code_only().lower()
    for preset in PRESETS:
        if preset == "auto":  # a plain English word; too common to grep for
            continue
        assert preset not in source, (
            f"the preset {preset!r} is named in the second renderer -- then "
            "every new preset needs a change in every renderer there is"
        )


def test_it_knows_no_integration_by_name():
    """The same rule the built-in renderer lives under, one file further out."""
    source = SECOND.read_text().lower()
    for integration in ("powerline", "unifi", "shelly", "zigbee", "fritz"):
        assert integration not in source


def test_it_draws_the_unassigned_storey_like_any_other():
    """The floor bug again: filter by the floor the hub gave, not by truthiness."""
    source = SECOND.read_text()
    assert "a.floor_id === floor.id" in source, (
        "areas are not filtered strictly by floor -- the same mistake that put "
        "unassigned rooms on top of real ones in the built-in panel"
    )


def test_the_two_renderers_were_written_separately():
    """Copied code would make this a mirror, not a second opinion."""
    panel_lines = {
        line.strip() for line in PANEL.read_text().splitlines()
        if len(line.strip()) > 60
    }
    second_lines = {
        line.strip() for line in SECOND.read_text().splitlines()
        if len(line.strip()) > 60
    }
    shared = panel_lines & second_lines
    assert not shared, f"identical lines in both renderers: {sorted(shared)[:3]}"
