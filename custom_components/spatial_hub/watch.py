"""Keeping the floor plan in step with the house.

Zero-config is not only about the first render. A plan that was right on
Monday and wrong on Friday -- because a room was renamed, a device moved
to another area, a floor added -- is a plan nobody trusts, and the fix
must never be "press reload".

So the hub watches the two things that decide what the plan looks like:

* **the registries** -- floors, areas, devices and entities. These are the
  user editing their house, and the plan follows without being asked.
* **the states of entities that are actually on the plan.** A node backed
  by an entity goes live immediately, no matter how slowly the provider
  that named it happens to poll.

Nothing is tracked until a renderer has asked for the model at least once:
if nobody is looking, there is nothing to keep up to date.
"""

from __future__ import annotations

import logging
from typing import Any, Callable

from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers.event import (
    async_call_later,
    async_track_state_change_event,
)

_LOGGER = logging.getLogger(__name__)

# One user action -- renaming an area, moving a device -- fires several
# registry events, and a busy sensor fires constantly. Collapse the burst
# into a single refresh rather than rebuilding the model per event.
DEBOUNCE_SECONDS = 1.0

# Stable Home Assistant event names. Read from the helper modules where
# they are exported, with the literal as the fallback so an older or newer
# core does not silence the watcher.
_REGISTRY_EVENTS = (
    "area_registry_updated",
    "floor_registry_updated",
    "device_registry_updated",
    "entity_registry_updated",
)


class ModelWatcher:
    """Turns Home Assistant's own churn into one debounced refresh."""

    def __init__(self, hass: HomeAssistant, hub: Any) -> None:
        self.hass = hass
        self.hub = hub
        self._unsubscribes: list[Callable[[], None]] = []
        self._untrack: Callable[[], None] | None = None
        self._tracked: set[str] = set()
        self._reasons: set[str] = set()
        self._timer: Callable[[], None] | None = None

    # ── Lifecycle ─────────────────────────────────────────

    @callback
    def async_start(self) -> None:
        for event in _REGISTRY_EVENTS:
            self._unsubscribes.append(
                self.hass.bus.async_listen(event, self._async_registry_changed)
            )
        # Every model build may bring different entities onto the plan.
        self._unsubscribes.append(self.hub.async_add_listener(self._async_notified))

    @callback
    def async_stop(self) -> None:
        for unsubscribe in self._unsubscribes:
            unsubscribe()
        self._unsubscribes.clear()
        self._async_track([])
        if self._timer is not None:
            self._timer()
            self._timer = None
        self._reasons.clear()

    # ── Sources of change ─────────────────────────────────

    @callback
    def _async_registry_changed(self, _event: Any) -> None:
        """The user edited their house."""
        self._async_schedule("registry")

    @callback
    def _async_state_changed(self, _event: Any) -> None:
        """An entity on the plan changed."""
        self._async_schedule("state")

    @callback
    def _async_notified(self, reason: str) -> None:
        """Something rebuilt the model; the entity set may have moved."""
        self._async_sync_entities()

    # ── Tracking exactly what is on the plan ──────────────

    @callback
    def _async_sync_entities(self) -> None:
        wanted = set(getattr(self.hub, "entity_ids", ()) or ())
        if wanted == self._tracked:
            return
        self._async_track(wanted)

    @callback
    def _async_track(self, entity_ids) -> None:
        if self._untrack is not None:
            self._untrack()
            self._untrack = None
        self._tracked = set(entity_ids)
        if not self._tracked:
            return
        self._untrack = async_track_state_change_event(
            self.hass, sorted(self._tracked), self._async_state_changed
        )

    # ── Debounce ──────────────────────────────────────────

    @callback
    def _async_schedule(self, reason: str) -> None:
        self._reasons.add(reason)
        if self._timer is not None:
            return
        self._timer = async_call_later(self.hass, DEBOUNCE_SECONDS, self._async_fire)

    @callback
    def _async_fire(self, _now: Any = None) -> None:
        self._timer = None
        reasons = ",".join(sorted(self._reasons)) or "manual"
        self._reasons.clear()
        _LOGGER.debug("Spatial Hub refreshing after %s change(s)", reasons)
        self.hub.async_notify(reasons)
