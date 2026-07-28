"""Themes colour the vocabulary, not the integrations."""

from __future__ import annotations

import pytest

from custom_components.spatial_hub import theme
from custom_components.spatial_hub.hub import SpatialHub
from custom_components.spatial_hub.storage import LayoutStore


def test_nothing_stored_means_home_assistants_own_theme():
    resolved = theme.resolve(None)

    assert resolved["preset"] == "auto"
    assert resolved["state_colors"]["online"] == "", (
        "empty means inherit -- installing the hub must not fight the "
        "theme the user already chose"
    )


@pytest.mark.parametrize("name", sorted(theme.PRESETS))
def test_every_preset_covers_the_whole_shared_vocabulary(name):
    """A preset that forgets `poor` leaves a provider looking broken."""
    resolved = theme.resolve({"theme": {"preset": name}})

    assert set(resolved["state_colors"]) == {
        "online", "offline", "unknown",
        # `on`/`off` are as universal in Home Assistant as online/offline
        # and mean something different: a lamp that is off is not broken.
        # Without them every light drew in the grey meant for "no idea".
        "on", "off",
    }
    assert set(resolved["quality_colors"]) == {"good", "fair", "poor", "unknown"}
    assert resolved["node_shape"] in {"circle", "rounded", "square"}
    assert resolved["labels"] in {"always", "hover", "never"}
    assert resolved["edge_style"] in {"straight", "curved"}
    assert resolved["room_style"] in {"outline", "filled", "none"}


def test_a_preset_is_a_starting_point_not_a_cage():
    resolved = theme.resolve(
        {"theme": {"preset": "classic", "state_colors": {"offline": "#000000"}}}
    )

    assert resolved["state_colors"]["offline"] == "#000000"
    assert resolved["state_colors"]["online"] == "#43a047", (
        "recolouring one word keeps the rest of the preset"
    )


def test_an_unknown_preset_falls_back_instead_of_breaking_the_plan():
    resolved = theme.resolve({"theme": {"preset": "from-a-future-version"}})
    assert resolved["preset"] == "auto"


@pytest.mark.parametrize(
    "stored",
    [
        {"theme": "not a dict"},
        {"theme": {"node_shape": "hexagon"}},
        {"theme": {"labels": 7}},
        {"theme": {"state_colors": "green"}},
        {"theme": {"state_colors": {"online": 0xFF0000}}},
        "not a dict either",
        None,
    ],
)
def test_nonsense_never_reaches_a_renderer(stored):
    resolved = theme.resolve(stored)
    assert resolved["node_shape"] in {"circle", "rounded", "square"}
    assert all(isinstance(c, str) for c in resolved["state_colors"].values())


def test_node_size_is_clamped_to_something_clickable():
    assert theme.resolve({"theme": {"node_size": 900}})["node_size"] == 3.0
    assert theme.resolve({"theme": {"node_size": 0}})["node_size"] == 0.4


def test_only_words_from_the_vocabulary_are_accepted():
    """An integration name in a colour key is exactly what must not work."""
    resolved = theme.resolve(
        {"theme": {"state_colors": {"online": "#111111", "powerline": "#222222"}}}
    )

    assert resolved["state_colors"]["online"] == "#111111"
    assert "powerline" not in resolved["state_colors"], (
        "themes colour states and qualities; an integration is not one"
    )


@pytest.mark.asyncio
async def test_the_model_carries_the_resolved_theme(hass):
    hub = SpatialHub(hass, LayoutStore(hass))
    hub.store.update("settings", "view", {"theme": {"preset": "neon"}})

    model = await hub.async_model()

    assert model["theme"]["preset"] == "neon"
    assert model["theme"]["state_colors"]["online"] == "#00e676", (
        "resolved by the hub, so every renderer agrees without reimplementing"
    )


def test_the_store_keeps_settings_apart_from_arrangement(hass):
    store = LayoutStore(hass)
    store.update("settings", "view", {"theme": {"preset": "paper"}})
    store.update("settings", "view", {"position": {"x": 1, "y": 1}})

    assert store.get("settings", "view") == {"theme": {"preset": "paper"}}, (
        "a key that means nothing for this section is dropped, not stored"
    )


# ── Colours for a renderer with nothing to inherit from ───


def test_every_theme_carries_real_colours_as_well():
    """Found by opening the second renderer from a desktop: all grey.

    `auto` resolves to "" for every colour, meaning "inherit the host's".
    Inside Home Assistant that is exactly right. Outside it there is no
    host theme, and a renderer that has to invent colours is a renderer
    reimplementing the presets -- the thing resolving in the hub was
    supposed to prevent.
    """
    resolved = theme.resolve({"theme": {"preset": "auto"}})

    assert resolved["state_colors"]["online"] == "", "auto must still inherit"
    for word in ("online", "offline", "unknown"):
        assert resolved["fallback"]["state_colors"][word].startswith("#")
    for word in ("good", "fair", "poor", "unknown"):
        assert resolved["fallback"]["quality_colors"][word].startswith("#")


def test_the_fallback_is_there_even_when_the_preset_states_its_own():
    """A renderer must not have to ask which case it is in."""
    for preset in ("auto", "classic", "neon", "paper", "blueprint"):
        resolved = theme.resolve({"theme": {"preset": preset}})
        assert resolved["fallback"]["state_colors"]["offline"], (
            f"{preset} carries no fallback, so a renderer has to branch"
        )


def test_a_user_colour_still_wins_over_the_fallback():
    """The fallback is a floor, never a ceiling."""
    resolved = theme.resolve(
        {"theme": {"preset": "auto", "state_colors": {"online": "#123456"}}}
    )

    assert resolved["state_colors"]["online"] == "#123456"
    assert resolved["fallback"]["state_colors"]["online"] != "#123456", (
        "the fallback was overwritten -- it is what to use when there is no "
        "colour, so it must not become a copy of the colour"
    )


def test_a_lamp_that_is_off_is_not_the_same_as_no_idea():
    """Found on a fresh install: the light layer drew entirely in grey.

    `unknown` grey says "the hub could not find out". An `off` lamp is a
    fact, and telling somebody the wrong one of those is worse than saying
    nothing.
    """
    for preset in ("classic", "blueprint", "neon", "paper"):
        colors = theme.resolve({"theme": {"preset": preset}})["state_colors"]
        assert colors["off"] and colors["off"] != colors["unknown"], (
            f"{preset}: an off lamp is drawn in the colour for 'no idea'"
        )
        assert colors["on"] and colors["on"] != colors["off"]


def test_the_fallback_covers_the_new_words_too():
    """Or a renderer outside Home Assistant is back to grey lamps."""
    fallback = theme.resolve({})["fallback"]["state_colors"]

    assert fallback["on"].startswith("#")
    assert fallback["off"].startswith("#")
