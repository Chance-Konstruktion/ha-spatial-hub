"""The layout store: what the user decided, and the guard rails on it."""

from __future__ import annotations

import pytest

from custom_components.spatial_hub.storage import LayoutStore


def test_data_and_section_show_what_is_stored(hass):
    store = LayoutStore(hass)
    store.update("nodes", "a", {"scale": 2})

    assert store.section("nodes") == {"a": {"scale": 2}}
    assert store.section("nodes")["a"] is store.data["nodes"]["a"]
    assert store.section("gibt-es-nicht") == {}


def test_an_unknown_section_is_refused(hass):
    """Silently accepting a made-up section would grow .storage without
    bound and never be read by anything -- the refusal is the guard rail."""
    store = LayoutStore(hass)
    with pytest.raises(ValueError, match="unknown layout section"):
        store.update("sonstiges", "a", {"x": 1})


def test_removing_an_absent_key_writes_nothing(hass):
    """A remove that changes nothing must not schedule a pointless write;
    the debounced save is for changes, not for misses."""
    store = LayoutStore(hass)
    store.update("nodes", "a", {"scale": 2})
    geschrieben = store._store.saved  # noqa: SLF001 - the stub records it

    store.remove("nodes", "nie-da-gewesen")

    assert store._store.saved == geschrieben  # noqa: SLF001
    assert store.get("nodes", "a") == {"scale": 2}


def test_loading_picks_only_the_known_sections(hass):
    """A future version may store more; loading must keep the sections it
    knows and step over anything else without losing the user's data."""
    import asyncio

    store = LayoutStore(hass)
    store._store.preload = {  # noqa: SLF001 - the stub preloads
        "nodes": {"a": {"scale": 2}},
        "zukuenftig": {"b": {"irgendwas": True}},
        "areas": "kaputt",
    }
    store.data["areas"]["zimmer"] = {"hidden": True}

    asyncio.run(store.async_load())

    assert store.get("nodes", "a") == {"scale": 2}
    assert "zukuenftig" not in store.data
    assert store.get("areas", "zimmer") == {"hidden": True}, (
        "a section that does not load as a dict is left as it was"
    )
