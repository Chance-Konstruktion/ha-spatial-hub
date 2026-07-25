"""Persistence for everything the *user* decided.

Providers own their data; the hub owns the arrangement. A provider never
learns that the user dragged its node two metres to the left -- that lives
here and is re-applied to every refresh.

Stored shape::

    {
        "nodes":  {"<node_id>": {"position": {...}, "icon": ..., "scale": ...}},
        "layers": {"<layer_id>": {"visible": bool, "z_index": int, ...}},
        "floors": {"<floor_id>": {"background": "data:...", "aspect": 1.4}},
        "areas":  {"<area_id>": {"position": {...}}},
        "settings": {"view": {"theme": {...}}},
    }
"""

from __future__ import annotations

from typing import Any

from homeassistant.core import HomeAssistant
from homeassistant.helpers.storage import Store

from .const import STORAGE_KEY, STORAGE_VERSION

# Keys the user may set per section. Anything else is rejected so a buggy
# card cannot grow .storage without bound.
_NODE_KEYS = {"position", "icon", "color", "scale", "rotation", "label_offset",
              "hidden"}
_LAYER_KEYS = {"visible", "z_index", "opacity"}
_FLOOR_KEYS = {"background", "aspect", "name", "order"}
_AREA_KEYS = {"position", "size", "color", "hidden"}
# View-wide settings rather than one item's arrangement. One key, "view".
_SETTINGS_KEYS = {"theme"}

_SECTIONS = {
    "nodes": _NODE_KEYS,
    "layers": _LAYER_KEYS,
    "floors": _FLOOR_KEYS,
    "areas": _AREA_KEYS,
    "settings": _SETTINGS_KEYS,
}


class LayoutStore:
    """In-memory layout with debounced write-through to .storage."""

    def __init__(self, hass: HomeAssistant) -> None:
        self._store: Store = Store(hass, STORAGE_VERSION, STORAGE_KEY)
        self._data: dict[str, dict[str, dict[str, Any]]] = {
            section: {} for section in _SECTIONS
        }

    async def async_load(self) -> None:
        stored = await self._store.async_load() or {}
        for section in _SECTIONS:
            value = stored.get(section)
            if isinstance(value, dict):
                self._data[section] = value

    @property
    def data(self) -> dict[str, dict[str, dict[str, Any]]]:
        return self._data

    def section(self, name: str) -> dict[str, dict[str, Any]]:
        return self._data.get(name, {})

    def get(self, section: str, key: str) -> dict[str, Any]:
        return self._data.get(section, {}).get(key, {})

    def update(self, section: str, key: str, values: dict[str, Any]) -> None:
        """Merge user-set values into one entry, dropping unknown keys.

        A value of ``None`` clears the override so the provider's own value
        (or the auto-placement) takes over again -- that is how "reset" is
        expressed without a second command.
        """
        allowed = _SECTIONS.get(section)
        if allowed is None:
            raise ValueError(f"unknown layout section: {section}")

        entry = dict(self._data[section].get(key, {}))
        for name, value in values.items():
            if name not in allowed:
                continue
            if value is None:
                entry.pop(name, None)
            else:
                entry[name] = value

        if entry:
            self._data[section][key] = entry
        else:
            self._data[section].pop(key, None)
        self._schedule_save()

    def remove(self, section: str, key: str) -> None:
        if self._data.get(section, {}).pop(key, None) is not None:
            self._schedule_save()

    def _schedule_save(self) -> None:
        self._store.async_delay_save(lambda: self._data, 2)
