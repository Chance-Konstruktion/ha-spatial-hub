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
        "panel_url": "/powerline",         # optional own view to link to
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


def _safe_url(value: Any) -> str:
    """A provider's own view, or nothing.

    Only a path inside this Home Assistant is accepted. A registration is
    third-party data, and a renderer turns this into a link the user
    clicks -- an off-site or `javascript:` URL is not something the hub
    should be handing them.
    """
    url = str(value or "").strip()
    if not url.startswith("/") or url.startswith("//") or len(url) > 256:
        return ""
    return url


class ProviderError(Exception):
    """A provider registration is unusable."""


# Keys a registration may contain. Anything else is almost certainly a typo
# and is reported rather than silently ignored -- a developer who writes
# "capabilties" should find out from the hub, not from an empty layer.
_KNOWN_REGISTRATION_KEYS = frozenset(
    {
        "provider_id",
        "api_version",
        "sdk_version",
        "name",
        "icon",
        "version",
        "capabilities",
        "layers",
        "icon_set",
        "panel_url",
        "data",
        "history",
        "action",
    }
)


@dataclass(slots=True)
class FetchResult:
    """One refresh of one provider, plus what went wrong doing it."""

    nodes: list[Node] = field(default_factory=list)
    edges: list[Edge] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)
    error: str | None = None

    def as_status(self) -> dict[str, Any]:
        return {
            "nodes": len(self.nodes),
            "edges": len(self.edges),
            # Enough to spot a pattern, not enough to flood the UI.
            "warnings": self.warnings[:20],
            "warning_count": len(self.warnings),
            "error": self.error,
            "ok": self.error is None and not self.warnings,
        }


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
    # Where the provider's own view lives, if it has one. The hub links to
    # it from a node's popup and never asks what is on the other side --
    # that is the integration's own identity, and none of the hub's business.
    panel_url: str = ""
    data_fn: Callable[[], Any] | None = None
    history_fn: Callable[..., Any] | None = None
    action_fn: Callable[..., Any] | None = None
    warnings: list[str] = field(default_factory=list)
    # 0 means the registration was written by hand rather than with the
    # copied shim. That is a perfectly good way to do it, and gets no note.
    sdk_version: int = 0

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

        try:
            sdk_version = int(raw.get("sdk_version") or 0)
        except (TypeError, ValueError):
            sdk_version = 0

        warnings = [
            f"unknown registration key '{key}' (typo?)"
            for key in sorted(set(raw) - _KNOWN_REGISTRATION_KEYS)
        ]
        for key in ("history", "action"):
            if raw.get(key) is not None and not callable(raw.get(key)):
                warnings.append(f"'{key}' is not callable and was ignored")

        layers: list[Layer] = []
        for raw_layer in raw.get("layers") or []:
            try:
                layers.append(Layer.from_dict(raw_layer, provider_id))
            except (SpatialError, AttributeError, TypeError) as err:
                _LOGGER.warning("%s: skipping bad layer (%s)", provider_id, err)
                warnings.append(f"skipped bad layer: {err}")
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
            panel_url=_safe_url(raw.get("panel_url")),
            data_fn=data_fn,
            history_fn=raw.get("history") if callable(raw.get("history")) else None,
            action_fn=raw.get("action") if callable(raw.get("action")) else None,
            warnings=warnings,
            sdk_version=sdk_version,
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
            "panel_url": self.panel_url,
        }

    async def async_fetch(self) -> FetchResult:
        """Pull this provider's current nodes and edges.

        Anything the provider gets wrong -- raising, timing out, returning
        junk -- costs it its own layer for this refresh and nothing more.
        What went wrong is recorded rather than swallowed, so the developer
        can see it in ``floorplan_hub/diagnostics`` instead of guessing why
        their layer is empty.
        """
        result = FetchResult()
        try:
            async with asyncio.timeout(DATA_TIMEOUT):
                payload = self.data_fn()
                if asyncio.iscoroutine(payload):
                    payload = await payload
        except TimeoutError:
            _LOGGER.warning("Provider %s timed out delivering data", self.id)
            result.error = f"timed out after {DATA_TIMEOUT}s"
            return result
        except Exception as err:  # noqa: BLE001 - third-party code, never trust it
            _LOGGER.exception("Provider %s raised while delivering data", self.id)
            result.error = f"{type(err).__name__}: {err}"
            return result

        # A provider with nothing but nodes may return the bare list.
        if isinstance(payload, list):
            payload = {"nodes": payload}
        if not isinstance(payload, dict):
            _LOGGER.warning("Provider %s returned %s, expected dict or list",
                            self.id, type(payload).__name__)
            result.error = (
                f"data returned {type(payload).__name__}, expected dict or list"
            )
            return result

        result.nodes = self._normalise(payload.get("nodes"), Node, "node", result)
        result.edges = self._normalise(payload.get("edges"), Edge, "edge", result)
        return result

    def _normalise(
        self, raw_items: Any, model: type, kind: str, result: FetchResult
    ) -> list[Any]:
        """Turn raw payload entries into model objects, dropping the broken ones."""
        if raw_items is None:
            return []
        if not isinstance(raw_items, list):
            result.warnings.append(
                f"{kind}s must be a list, got {type(raw_items).__name__}"
            )
            return []
        items = []
        for raw in raw_items:
            # A bare entity id is a complete node: Home Assistant already
            # knows its name, area, icon and state.
            if isinstance(raw, str) and kind == "node":
                raw = {"id": raw, "entity_id": raw}
            if not isinstance(raw, dict):
                result.warnings.append(
                    f"{kind} entry of type {type(raw).__name__} ignored"
                )
                continue
            try:
                item = model.from_dict(raw)
            except (SpatialError, TypeError, ValueError) as err:
                _LOGGER.debug("%s: dropping bad %s (%s)", self.id, kind, err)
                result.warnings.append(f"dropped {kind}: {err}")
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
