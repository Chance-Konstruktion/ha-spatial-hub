"""The provider registry -- the hub's only knowledge of the outside world.

A provider registration is a plain dict, written into
``hass.data["floorplan_hub_providers"]`` by the provider itself. That is
the whole coupling: no imports in either direction, no load-order
requirement, and a provider that registers while the hub is not installed
simply leaves a dict nobody reads.

Registration shape (see ``docs/PROVIDER_API.md`` for the full contract)::

    {
        "provider_id": "powerline",       # unique, stable, snake_case
        "api_version": 1,
        "name": "Powerline Network",
        "icon": "mdi:lan",
        "version": "1.0.0",
        "capabilities": {"nodes": True, "edges": True, ...},
        "layers": [{"id": "network_powerline", "name": ..., "icon": ...}],
        "data": callable,                 # -> {"nodes": [...], "edges": [...]}
        "history": callable,              # optional, (kind, id, hours) -> series
        "action": callable,               # optional, (kind, id, action, data)
        "icon_set": {...},                # optional custom SVG icons
    }

``data``/``history``/``action`` may be sync or async; the hub awaits
whatever it gets back.
"""

from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass, field
from typing import Any, Callable

from homeassistant.core import HomeAssistant

from .const import API_VERSION, DATA_PROVIDERS
from .models import Capabilities, Edge, Layer, Node, SpatialError

_LOGGER = logging.getLogger(__name__)

# A provider that hangs must not hang the whole floor plan.
DATA_TIMEOUT = 10.0


class ProviderError(Exception):
    """A provider registration is unusable."""


@dataclass(slots=True)
class Provider:
    """A normalised, validated provider registration."""

    id: str
    name: str
    icon: str = ""
    version: str = ""
    capabilities: Capabilities = field(default_factory=Capabilities)
    layers: list[Layer] = field(default_factory=list)
    icon_set: dict[str, Any] = field(default_factory=dict)
    data_fn: Callable[[], Any] | None = None
    history_fn: Callable[..., Any] | None = None
    action_fn: Callable[..., Any] | None = None

    @classmethod
    def from_registration(cls, raw: dict[str, Any]) -> Provider:
        """Validate a raw registration dict, or raise ProviderError."""
        if not isinstance(raw, dict):
            raise ProviderError("registration is not a dict")

        provider_id = str(raw.get("provider_id") or "").strip()
        if not provider_id:
            raise ProviderError("registration without provider_id")

        api_version = int(raw.get("api_version") or 1)
        if api_version > API_VERSION:
            raise ProviderError(
                f"{provider_id} speaks provider API v{api_version}, "
                f"this hub understands up to v{API_VERSION}"
            )

        data_fn = raw.get("data")
        if not callable(data_fn):
            raise ProviderError(f"{provider_id} has no callable 'data'")

        layers: list[Layer] = []
        for raw_layer in raw.get("layers") or []:
            try:
                layers.append(Layer.from_dict(raw_layer, provider_id))
            except (SpatialError, AttributeError, TypeError) as err:
                _LOGGER.warning("%s: skipping bad layer (%s)", provider_id, err)
        if not layers:
            # Every provider gets at least one layer, so its data has a home
            # even if it never bothered to describe one.
            layers = [
                Layer(
                    id=provider_id,
                    name=str(raw.get("name") or provider_id),
                    icon=str(raw.get("icon") or ""),
                    provider_id=provider_id,
                )
            ]

        return cls(
            id=provider_id,
            name=str(raw.get("name") or provider_id),
            icon=str(raw.get("icon") or ""),
            version=str(raw.get("version") or ""),
            capabilities=Capabilities.from_dict(raw.get("capabilities")),
            layers=layers,
            icon_set=dict(raw.get("icon_set") or {}),
            data_fn=data_fn,
            history_fn=raw.get("history") if callable(raw.get("history")) else None,
            action_fn=raw.get("action") if callable(raw.get("action")) else None,
        )

    @property
    def default_layer_id(self) -> str:
        return self.layers[0].id

    def as_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "name": self.name,
            "icon": self.icon,
            "version": self.version,
            "capabilities": self.capabilities.as_dict(),
            "layers": [layer.as_dict() for layer in self.layers],
            "icon_set": self.icon_set,
        }

    async def async_fetch(self) -> tuple[list[Node], list[Edge]]:
        """Pull this provider's current nodes and edges.

        Anything the provider gets wrong -- raising, timing out, returning
        junk -- costs it its own layer for this refresh and nothing more.
        """
        try:
            async with asyncio.timeout(DATA_TIMEOUT):
                payload = self.data_fn()
                if asyncio.iscoroutine(payload):
                    payload = await payload
        except TimeoutError:
            _LOGGER.warning("Provider %s timed out delivering data", self.id)
            return [], []
        except Exception:  # noqa: BLE001 - third-party code, never trust it
            _LOGGER.exception("Provider %s raised while delivering data", self.id)
            return [], []

        if not isinstance(payload, dict):
            _LOGGER.warning("Provider %s returned %s, expected dict",
                            self.id, type(payload).__name__)
            return [], []

        nodes = self._normalise(payload.get("nodes"), Node, "node")
        edges = self._normalise(payload.get("edges"), Edge, "edge")
        return nodes, edges

    def _normalise(self, raw_items: Any, model: type, kind: str) -> list[Any]:
        """Turn raw dicts into model objects, dropping the broken ones."""
        if not isinstance(raw_items, list):
            return []
        items = []
        for raw in raw_items:
            if not isinstance(raw, dict):
                continue
            try:
                item = model.from_dict(raw)
            except (SpatialError, TypeError, ValueError) as err:
                _LOGGER.debug("%s: dropping bad %s (%s)", self.id, kind, err)
                continue
            # Namespace ids so two providers can both call a node "router",
            # and remember which layer the item belongs to.
            item.id = f"{self.id}:{item.id}"
            if kind == "edge":
                item.source = f"{self.id}:{item.source}"
                item.target = f"{self.id}:{item.target}"
            layer_id = str(raw.get("layer_id") or "") or self.default_layer_id
            item.metadata = {**item.metadata, "layer_id": layer_id,
                             "provider_id": self.id}
            items.append(item)
        return items


def async_get_registrations(hass: HomeAssistant) -> dict[str, dict[str, Any]]:
    """The shared registration dict, created if this side got here first."""
    return hass.data.setdefault(DATA_PROVIDERS, {})


def async_load_providers(hass: HomeAssistant) -> dict[str, Provider]:
    """Validate every registration currently present.

    Called on every model build rather than cached, so a provider that
    re-registers with new layers is picked up without a hub restart.
    """
    providers: dict[str, Provider] = {}
    for provider_id, raw in async_get_registrations(hass).items():
        try:
            provider = Provider.from_registration(raw)
        except ProviderError as err:
            _LOGGER.warning("Ignoring provider %s: %s", provider_id, err)
            continue
        providers[provider.id] = provider
    return providers
