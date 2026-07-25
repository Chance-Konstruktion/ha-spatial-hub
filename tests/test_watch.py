"""The plan follows the house.

A floor plan that was right on Monday and wrong on Friday is a plan nobody
trusts, and "press reload" is not an answer. These tests cover the two
ways reality moves underneath it: the user editing their house, and the
entities on the plan changing state.
"""

from __future__ import annotations

import pytest

from custom_components.floorplan_hub.hub import FloorplanHub
from custom_components.floorplan_hub.storage import LayoutStore
from custom_components.floorplan_hub.watch import DEBOUNCE_SECONDS, ModelWatcher

from conftest import FakeArea, FakeEntity


@pytest.fixture
def hub(hass):
    from homeassistant.helpers import area_registry as ar

    ar.async_get(hass).areas = [FakeArea("wohnzimmer", "Wohnzimmer", floor_id="eg")]
    return FloorplanHub(hass, LayoutStore(hass))


@pytest.fixture
def watcher(hass, hub):
    instance = ModelWatcher(hass, hub)
    instance.async_start()
    return instance


def _fire_timer(hass):
    """Run whatever the debounce scheduled, as Home Assistant would."""
    assert hass.timers, "nothing was scheduled"
    delay, action = hass.timers.pop(0)
    assert delay == DEBOUNCE_SECONDS
    action(None)


def _register(hass, entity_id="light.kitchen"):
    hass.data.setdefault("floorplan_hub_providers", {})["demo"] = {
        "provider_id": "demo",
        "name": "Demo",
        "data": lambda: [entity_id],
    }


# ── Registry changes ──────────────────────────────────────


@pytest.mark.parametrize(
    "event",
    [
        "area_registry_updated",
        "floor_registry_updated",
        "device_registry_updated",
        "entity_registry_updated",
    ],
)
def test_editing_the_house_refreshes_the_plan(hass, hub, watcher, event):
    seen = []
    hub.async_add_listener(seen.append)

    hass.bus.fire(event)
    assert seen == [], "not immediately -- one edit fires several events"

    _fire_timer(hass)
    assert seen == ["registry"]


def test_a_burst_of_edits_costs_one_refresh(hass, hub, watcher):
    seen = []
    hub.async_add_listener(seen.append)

    for _ in range(5):
        hass.bus.fire("area_registry_updated")
    assert len(hass.timers) == 1, "one timer, not five"

    _fire_timer(hass)
    assert seen == ["registry"]


def test_the_reason_says_what_moved(hass, hub, watcher):
    seen = []
    hub.async_add_listener(seen.append)

    hass.bus.fire("area_registry_updated")
    watcher._async_state_changed(None)
    _fire_timer(hass)

    assert seen == ["registry,state"], "a renderer can tell the two apart"


# ── Entity states ─────────────────────────────────────────


@pytest.mark.asyncio
async def test_only_entities_on_the_plan_are_tracked(hass, hub, watcher):
    from homeassistant.helpers import entity_registry as er

    er.async_get(hass).entities["light.kitchen"] = FakeEntity(
        "light.kitchen", name="Küche", area_id="wohnzimmer"
    )
    hass.states.set("light.kitchen", "on")
    _register(hass)

    assert hass.tracked == [], "nobody has asked for the model yet"

    await hub.async_model()
    hub.async_notify("model")

    assert [entity_ids for entity_ids, _ in hass.tracked] == [["light.kitchen"]]


@pytest.mark.asyncio
async def test_a_tracked_entity_going_dark_refreshes_the_plan(hass, hub, watcher):
    hass.states.set("light.kitchen", "on")
    _register(hass)
    await hub.async_model()
    hub.async_notify("model")

    seen = []
    hub.async_add_listener(seen.append)

    _entity_ids, action = hass.tracked[0]
    action(None)  # the entity changed
    _fire_timer(hass)

    assert seen == ["state"]


@pytest.mark.asyncio
async def test_the_tracker_follows_what_is_on_the_plan(hass, hub, watcher):
    _register(hass, "light.kitchen")
    await hub.async_model()
    hub.async_notify("model")
    assert [entity_ids for entity_ids, _ in hass.tracked] == [["light.kitchen"]]

    _register(hass, "light.hallway")
    await hub.async_model()
    hub.async_notify("model")

    assert [entity_ids for entity_ids, _ in hass.tracked] == [["light.hallway"]], (
        "the old subscription is dropped, not stacked on top"
    )


@pytest.mark.asyncio
async def test_an_unchanged_entity_set_is_not_resubscribed(hass, hub, watcher):
    _register(hass)
    await hub.async_model()
    hub.async_notify("model")
    hub.async_notify("model")
    hub.async_notify("model")

    assert len(hass.tracked) == 1, "re-subscribing on every refresh would churn"


@pytest.mark.asyncio
async def test_a_plan_with_no_entities_tracks_nothing(hass, hub, watcher):
    hass.data.setdefault("floorplan_hub_providers", {})["demo"] = {
        "provider_id": "demo",
        "name": "Demo",
        "data": lambda: {"nodes": [{"id": "a", "area_id": "wohnzimmer"}]},
    }
    await hub.async_model()
    hub.async_notify("model")

    assert hass.tracked == []


# ── Shutdown ──────────────────────────────────────────────


@pytest.mark.asyncio
async def test_stopping_leaves_nothing_behind(hass, hub, watcher):
    _register(hass)
    await hub.async_model()
    hub.async_notify("model")
    hass.bus.fire("area_registry_updated")

    watcher.async_stop()

    assert hass.tracked == []
    assert hass.timers == [], "a pending refresh must not fire after unload"
    assert all(not listeners for listeners in hass.bus.listeners.values())

    seen = []
    hub.async_add_listener(seen.append)
    hass.bus.fire("area_registry_updated")
    assert seen == []
