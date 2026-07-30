"""The shortest a Spatial Hub provider gets: a list of entity ids.

Five lines of your own, and your integration is on the floor plan. Not a
sketch -- this file runs, and the test suite drives it through the real
hub, same as its bigger sibling next door.

Read this one first. Read
`../example_provider/ <../example_provider/__init__.py>`_ when a list of
entity ids is no longer enough: it has connections between things, a
detail popup, an action, and live updates through a coordinator.

Why an entity id is a whole node
--------------------------------

Home Assistant already knows what ``light.kitchen`` is called, which area
it is in, which icon it has and whether it is on. Repeating any of that
here would mean two sources for one fact, and the second one goes stale.
So the hub reads them from the registry and you say nothing but the id.

Positions are absent for the same reason, and stay absent: the hub puts
each node in the middle of its area, the user drags it wherever it belongs,
and that arrangement is then the hub's to store. You never save, load or
migrate a coordinate.

What this file deliberately does *not* do
-----------------------------------------

There is no ``coordinator=`` here, so the plan does not follow along on its
own: it shows what was true when the panel was opened. That is honest for
five entities in an example and wrong for a real integration. If you have a
``DataUpdateCoordinator``, pass it -- one keyword, and the plan is live::

    spatial_provider(hass, entry, name="…", data=…, coordinator=coordinator)

If your integration is push-shaped instead -- MQTT, UDP, a socket -- name
the dispatcher signals you already fire and the hub listens to those::

    spatial_provider(hass, entry, name="…", data=…, signals=[SIGNAL_UPDATED])
"""

from __future__ import annotations

from .spatial_hub_provider import spatial_provider


async def async_setup_entry(hass, entry) -> bool:
    """Set up the integration -- and put it on the floor plan."""
    spatial_provider(
        hass,
        entry,
        name="Minimal Provider",
        icon="mdi:lightbulb-on-outline",
        data=lambda: [
            "light.kitchen",
            "light.living_room",
            "light.hallway",
            "switch.coffee_machine",
            "sensor.hallway_temperature",
        ],
    )
    return True
