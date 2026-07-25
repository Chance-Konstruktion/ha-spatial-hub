"""Themes colour the vocabulary, not the integrations."""

from __future__ import annotations

import pytest

from custom_components.floorplan_hub import theme
from custom_components.floorplan_hub.hub import FloorplanHub
from custom_components.floorplan_hub.storage import LayoutStore


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

    assert set(resolved["state_colors"]) == {"online", "offline", "unknown"}
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
    hub = FloorplanHub(hass, LayoutStore(hass))
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
