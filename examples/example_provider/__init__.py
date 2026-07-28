"""A complete Spatial Hub provider, start to finish.

Not a snippet -- this is the whole thing. If you are a maintainer deciding
whether this is worth your afternoon, the answer is in the twenty lines of
``async_setup_entry`` below, and the rest of this file is a fake device
tree standing in for whatever your integration actually talks to.

Three things worth noticing:

* Nothing imports ``spatial_hub``. The shim next door writes a dict into
  ``hass.data`` and fires a signal. With the hub not installed, this
  integration behaves exactly as it would without any of this code.
* Positions are absent on purpose. The hub puts each node in the middle of
  its area and the user drags it from there; that arrangement then belongs
  to the hub and you never store, load or think about it again.
* The extra keyword arguments to ``node()`` become metadata, and metadata
  becomes the detail popup. You do not build a popup.
"""

from __future__ import annotations

from typing import Any

from .spatial_hub_provider import edge, spatial_provider, node

# Stand-in for whatever your integration actually polls.
_DEVICES = [
    {"id": "hub", "label": "Hub", "area": "wohnzimmer", "signal": None},
    {"id": "kitchen", "label": "Küche", "area": "kueche", "signal": 640},
    {"id": "attic", "label": "Dachboden", "area": "dachboden", "signal": 90},
]


async def async_setup_entry(hass, entry) -> bool:
    """Set up the integration -- and put it on the floor plan."""
    coordinator = await _async_build_coordinator(hass, entry)

    spatial_provider(
        hass,
        entry,
        name="Example Provider",
        icon="mdi:access-point-network",
        data=lambda: _spatial_data(coordinator),
        coordinator=coordinator,
        action=lambda kind, item_id, action_id, data: _run(coordinator, item_id),
    )

    return True


def _spatial_data(coordinator: Any) -> dict[str, list]:
    """What is where, and what is connected to what.

    Called by the hub on every refresh. Return partial data rather than
    raising: an exception costs you your own layer for one refresh, and
    nothing else -- but it does cost you that.
    """
    devices = coordinator.data or []
    return {
        "nodes": [
            node(
                device["id"],
                label=device["label"],
                area_id=device["area"],
                state="online" if device["signal"] is not None else "unknown",
                icon="mdi:access-point",
                # Anything extra lands in metadata, and metadata is the popup.
                signal_rate=device["signal"],
                firmware="1.4.2",
            )
            for device in devices
        ],
        "edges": [
            edge(
                "hub",
                device["id"],
                value=device["signal"],
                quality=_quality(device["signal"]),
                animated=True,
            )
            for device in devices
            if device["id"] != "hub" and device["signal"] is not None
        ],
    }


def _quality(signal: int | None) -> str:
    """The shared vocabulary, so any renderer can colour this correctly.

    Not your own words: a renderer has no idea what your integration does,
    and `good`/`fair`/`poor`/`unknown` is the whole of what it needs.
    """
    if signal is None:
        return "unknown"
    if signal >= 500:
        return "good"
    return "fair" if signal >= 100 else "poor"


def _run(coordinator: Any, item_id: str) -> dict[str, bool]:
    """Actions arrive with *your* id, un-namespaced. Do as you like."""
    return {"success": True}


async def _async_build_coordinator(hass, entry) -> Any:
    """Stands in for your DataUpdateCoordinator."""

    class _Coordinator:
        data = _DEVICES

        def async_add_listener(self, callback) -> Any:
            return lambda: None

    return _Coordinator()
