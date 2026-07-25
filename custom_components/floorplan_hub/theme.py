"""Themes -- and the careful question of what a theme may colour.

Not integrations. If the hub ever grew a "Powerline blue", every provider
would need one, and the ones nobody wrote a palette for would look broken
through no fault of their own.

What a theme colours is the **shared vocabulary**: the node states and the
edge qualities that every provider already speaks. `online` gets a colour,
`good` gets a colour -- and an integration written next year is themed
correctly the moment it registers, without anyone touching this file.

Resolution happens here rather than in the renderer, so a second renderer
(3D, print, whatever comes) gets exactly the same colours from
``model["theme"]`` without reimplementing a single preset.
"""

from __future__ import annotations

from typing import Any

from .const import (
    QUALITY_FAIR,
    QUALITY_GOOD,
    QUALITY_POOR,
    QUALITY_UNKNOWN,
    STATE_OFFLINE,
    STATE_ONLINE,
    STATE_UNKNOWN,
)

# An empty colour means "whatever Home Assistant's own theme says". That is
# the default, and it is why installing the hub does not fight the theme
# the user already chose.
_INHERIT = ""

_AUTO: dict[str, Any] = {
    "accent": _INHERIT,
    "surface": _INHERIT,
    "ink": _INHERIT,
    "state_colors": {
        STATE_ONLINE: _INHERIT,
        STATE_OFFLINE: _INHERIT,
        STATE_UNKNOWN: _INHERIT,
    },
    "quality_colors": {
        QUALITY_GOOD: _INHERIT,
        QUALITY_FAIR: _INHERIT,
        QUALITY_POOR: _INHERIT,
        QUALITY_UNKNOWN: _INHERIT,
    },
    "node_shape": "circle",
    "node_size": 1.0,
    "labels": "always",
    "edge_style": "straight",
    "room_style": "outline",
}


def _preset(**overrides: Any) -> dict[str, Any]:
    """A preset is the automatic one with a few opinions layered on."""
    merged = {**_AUTO, **overrides}
    merged["state_colors"] = {**_AUTO["state_colors"],
                              **overrides.get("state_colors", {})}
    merged["quality_colors"] = {**_AUTO["quality_colors"],
                                **overrides.get("quality_colors", {})}
    return merged


PRESETS: dict[str, dict[str, Any]] = {
    # Follows whatever theme the user already runs. The default, and the
    # only one that changes appearance when they switch Home Assistant's.
    "auto": _AUTO,
    # The hub's own colours, stated outright instead of inherited.
    "classic": _preset(
        accent="#03a9f4",
        state_colors={STATE_ONLINE: "#43a047", STATE_OFFLINE: "#e53935",
                      STATE_UNKNOWN: "#9e9e9e"},
        quality_colors={QUALITY_GOOD: "#43a047", QUALITY_FAIR: "#fb8c00",
                        QUALITY_POOR: "#e53935", QUALITY_UNKNOWN: "#9e9e9e"},
    ),
    # Architectural drawing: the rooms carry the plan, the nodes stay quiet.
    "blueprint": _preset(
        accent="#1e88e5",
        state_colors={STATE_ONLINE: "#1e88e5", STATE_OFFLINE: "#546e7a",
                      STATE_UNKNOWN: "#90a4ae"},
        quality_colors={QUALITY_GOOD: "#1e88e5", QUALITY_FAIR: "#5c9ce0",
                        QUALITY_POOR: "#b0bec5", QUALITY_UNKNOWN: "#cfd8dc"},
        node_shape="square",
        node_size=0.85,
        room_style="filled",
        edge_style="straight",
    ),
    # Dark-first and loud, for a wall-mounted screen across the room.
    "neon": _preset(
        accent="#00e5ff",
        state_colors={STATE_ONLINE: "#00e676", STATE_OFFLINE: "#ff1744",
                      STATE_UNKNOWN: "#7c4dff"},
        quality_colors={QUALITY_GOOD: "#00e676", QUALITY_FAIR: "#ffea00",
                        QUALITY_POOR: "#ff1744", QUALITY_UNKNOWN: "#7c4dff"},
        node_shape="rounded",
        node_size=1.15,
        edge_style="curved",
        room_style="none",
    ),
    # Muted and printable; nothing glows, nothing competes.
    "paper": _preset(
        accent="#6d4c41",
        state_colors={STATE_ONLINE: "#7cb342", STATE_OFFLINE: "#c62828",
                      STATE_UNKNOWN: "#bcaaa4"},
        quality_colors={QUALITY_GOOD: "#7cb342", QUALITY_FAIR: "#c0a062",
                        QUALITY_POOR: "#c62828", QUALITY_UNKNOWN: "#d7ccc8"},
        node_shape="rounded",
        labels="hover",
        room_style="outline",
    ),
}

DEFAULT_PRESET = "auto"

_SHAPES = {"circle", "rounded", "square"}
_LABELS = {"always", "hover", "never"}
_EDGES = {"straight", "curved"}
_ROOMS = {"outline", "filled", "none"}


def resolve(stored: Any) -> dict[str, Any]:
    """The theme every renderer receives: a preset plus the user's edits.

    Forgiving on purpose. A stored theme from a newer version, or one a
    user hand-edited in .storage, must not break the floor plan -- unknown
    values fall back rather than raise.
    """
    settings = stored if isinstance(stored, dict) else {}
    theme = settings.get("theme")
    if not isinstance(theme, dict):
        theme = {}

    preset_name = theme.get("preset")
    if preset_name not in PRESETS:
        preset_name = DEFAULT_PRESET
    resolved = {**PRESETS[preset_name], "preset": preset_name}

    for key, allowed in (
        ("node_shape", _SHAPES),
        ("labels", _LABELS),
        ("edge_style", _EDGES),
        ("room_style", _ROOMS),
    ):
        if theme.get(key) in allowed:
            resolved[key] = theme[key]

    for key in ("accent", "surface", "ink"):
        value = theme.get(key)
        if isinstance(value, str):
            resolved[key] = value

    size = theme.get("node_size")
    if isinstance(size, (int, float)):
        resolved["node_size"] = min(3.0, max(0.4, float(size)))

    # Per-word overrides sit on top of the preset, so a user can recolour
    # just "offline" without giving up everything else the preset decided.
    for key, vocabulary in (
        ("state_colors", _AUTO["state_colors"]),
        ("quality_colors", _AUTO["quality_colors"]),
    ):
        overrides = theme.get(key)
        if not isinstance(overrides, dict):
            continue
        resolved[key] = {
            **resolved[key],
            **{
                word: value
                for word, value in overrides.items()
                if word in vocabulary and isinstance(value, str)
            },
        }

    return resolved
