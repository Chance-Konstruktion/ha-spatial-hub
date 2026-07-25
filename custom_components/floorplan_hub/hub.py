"""The hub itself: assemble one spatial model out of many providers.

Everything the renderers consume comes from :meth:`FloorplanHub.async_model`.
The hub never renders, never styles and never special-cases a provider --
it collects, places, applies the user's arrangement and hands the result
over. A second renderer (3D, AR, print) needs no hub change at all.
"""

from __future__ import annotations

import logging
from typing import Any, Callable

from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers.dispatcher import async_dispatcher_connect

from . import discovery
from .const import (
    API_VERSION,
    SIGNAL_DATA_UPDATED,
    SIGNAL_PROVIDER_REGISTERED,
    SIGNAL_PROVIDER_REMOVED,
    STATE_UNKNOWN,
)
from .models import Edge, Node, Position
from .registry import Provider, async_load_providers
from .storage import LayoutStore

_LOGGER = logging.getLogger(__name__)


class FloorplanHub:
    """Aggregates providers, layout and registries into one model."""

    def __init__(self, hass: HomeAssistant, store: LayoutStore) -> None:
        self.hass = hass
        self.store = store
        # When off, areas are not auto-arranged into a grid: only the ones
        # the user placed by hand appear.
        self.auto_areas = True
        # What each provider delivered last time, for the diagnostics
        # command -- a developer should never have to guess why their layer
        # came out empty.
        self._status: dict[str, dict[str, Any]] = {}
        # Entities currently on the plan. The watcher tracks exactly these,
        # so a node goes live regardless of how slowly its provider polls.
        self.entity_ids: set[str] = set()
        self._listeners: list[Callable[[str], None]] = []
        self._unsubscribes: list[Callable[[], None]] = []

    # ── Lifecycle ─────────────────────────────────────────

    @callback
    def async_start(self) -> None:
        """Listen for providers coming, going and changing."""
        for signal in (
            SIGNAL_PROVIDER_REGISTERED,
            SIGNAL_PROVIDER_REMOVED,
            SIGNAL_DATA_UPDATED,
        ):
            self._unsubscribes.append(
                async_dispatcher_connect(
                    self.hass, signal, self._make_handler(signal)
                )
            )
        _LOGGER.debug(
            "Floorplan-Hub listening (provider API v%s), %d provider(s) present",
            API_VERSION,
            len(self.providers),
        )

    @callback
    def async_stop(self) -> None:
        for unsubscribe in self._unsubscribes:
            unsubscribe()
        self._unsubscribes.clear()
        self._listeners.clear()

    def _make_handler(self, signal: str) -> Callable[..., None]:
        @callback
        def handler(provider_id: str | None = None, *_: Any) -> None:
            self._notify(signal, provider_id or "")

        return handler

    # ── Change notification ───────────────────────────────

    @callback
    def async_add_listener(
        self, listener: Callable[[str], None]
    ) -> Callable[[], None]:
        """Subscribe to "something changed"; returns the unsubscribe."""
        self._listeners.append(listener)

        @callback
        def remove() -> None:
            if listener in self._listeners:
                self._listeners.remove(listener)

        return remove

    @callback
    def async_notify(self, reason: str = "manual") -> None:
        self._notify(reason, "")

    def _notify(self, reason: str, provider_id: str) -> None:
        for listener in list(self._listeners):
            try:
                listener(reason if not provider_id else f"{reason}:{provider_id}")
            except Exception:  # noqa: BLE001 - one bad subscriber, not all
                _LOGGER.exception("Floorplan-Hub listener raised")

    # ── Providers ─────────────────────────────────────────

    @property
    def providers(self) -> dict[str, Provider]:
        """Currently registered, validated providers."""
        return async_load_providers(self.hass)

    def provider(self, provider_id: str) -> Provider | None:
        return self.providers.get(provider_id)

    def provider_for_item(self, item_id: str) -> Provider | None:
        """Resolve the owner of a namespaced ``provider:local`` id."""
        provider_id = item_id.split(":", 1)[0]
        return self.providers.get(provider_id)

    # ── The model ─────────────────────────────────────────

    async def async_model(self) -> dict[str, Any]:
        """Build the complete spatial model.

        Order matters: providers deliver, auto-placement fills the gaps,
        the user's stored arrangement wins over both.
        """
        providers = self.providers
        floors = discovery.async_floors(self.hass)
        areas = discovery.async_areas(self.hass)

        nodes: list[Node] = []
        edges: list[Edge] = []
        layers: list[dict[str, Any]] = []
        icon_sets: dict[str, Any] = {}

        for provider in providers.values():
            result = await provider.async_fetch()
            self._enrich_from_entities(result.nodes)
            nodes.extend(result.nodes)
            edges.extend(result.edges)
            layers.extend(layer.as_dict() for layer in provider.layers)
            if provider.icon_set:
                icon_sets[provider.id] = provider.icon_set
            self._status[provider.id] = {
                **result.as_status(),
                "registration_warnings": provider.warnings,
            }

        discovery.async_place_nodes(self.hass, nodes, areas)

        node_dicts = [self._apply_node_layout(node) for node in nodes]
        node_dicts = [node for node in node_dicts if not node.pop("_hidden", False)]
        known_ids = {node["id"] for node in node_dicts}
        self.entity_ids = {
            node["entity_id"] for node in node_dicts if node.get("entity_id")
        }

        return {
            "api_version": API_VERSION,
            "floors": self._apply_floor_layout(floors),
            "areas": self._apply_area_layout(areas),
            "layers": self._apply_layer_layout(layers),
            "nodes": node_dicts,
            # An edge to a dropped node would render as a line into nowhere.
            "edges": [
                edge.as_dict()
                for edge in edges
                if edge.source in known_ids and edge.target in known_ids
            ],
            "providers": [provider.as_dict() for provider in providers.values()],
            "icon_sets": icon_sets,
        }

    def _enrich_from_entities(self, nodes: list[Node]) -> None:
        """Fill blanks on entity-backed nodes from Home Assistant itself.

        Naming an entity is the shortest possible node definition, so it has
        to be enough: label, area, icon and state all come from the
        registries. Whatever the provider stated itself is left alone --
        it knows its own hardware better than the registry does.
        """
        for node in nodes:
            if not node.entity_id:
                continue
            defaults = discovery.async_entity_defaults(self.hass, node.entity_id)
            # Ids are namespaced by now; the label defaulted to the local one.
            if node.label in ("", node.id, node.id.split(":", 1)[-1]):
                node.label = defaults.get("label", node.label)
            if not node.area_id:
                node.area_id = defaults.get("area_id")
            if not node.icon:
                node.icon = defaults.get("icon", "")
            if node.state == STATE_UNKNOWN and "state" in defaults:
                node.state = defaults["state"]
            # Entity attributes go underneath the provider's own metadata:
            # a provider that measured something means it.
            node.metadata = {**defaults.get("metadata", {}), **node.metadata}

    def _apply_node_layout(self, node: Node) -> dict[str, Any]:
        override = self.store.get("nodes", node.id)
        data = node.as_dict()
        if not override:
            return data
        position = Position.from_dict(override.get("position"))
        if position is not None:
            data["position"] = position.as_dict()
            data["metadata"] = {**data["metadata"], "auto_position": False}
        for key in ("icon", "color"):
            if override.get(key):
                data[key] = override[key]
        for key in ("scale", "rotation", "label_offset"):
            if key in override:
                data[key] = override[key]
        data["_hidden"] = bool(override.get("hidden"))
        return data

    def _apply_layer_layout(
        self, layers: list[dict[str, Any]]
    ) -> list[dict[str, Any]]:
        merged = []
        for layer in layers:
            override = self.store.get("layers", layer["id"])
            merged.append({**layer, **{
                key: value for key, value in override.items()
                if key in ("visible", "z_index", "opacity")
            }})
        return sorted(merged, key=lambda layer: layer["z_index"])

    def _apply_floor_layout(
        self, floors: list[dict[str, Any]]
    ) -> list[dict[str, Any]]:
        merged = [
            {**floor, **self.store.get("floors", floor["id"])} for floor in floors
        ]
        # A house with no floors defined still needs somewhere to draw on.
        if not merged:
            merged = [{"id": "default", "name": "Home", "level": 0, "icon": "",
                       **self.store.get("floors", "default")}]
        return merged

    def _apply_area_layout(
        self, areas: list[dict[str, Any]]
    ) -> list[dict[str, Any]]:
        merged = []
        for area in areas:
            override = self.store.get("areas", area["id"])
            if override.get("hidden"):
                continue
            area = {**area, **{k: v for k, v in override.items() if k != "hidden"}}
            if "position" in override:
                area["auto"] = False
            elif not self.auto_areas:
                # Hand-arrangement mode: no grid guess, but the area is
                # still reported -- a user who has placed nothing must not
                # be shown an empty house with no way back. Renderers put
                # these in an "unplaced" tray to drag from.
                area["position"] = None
                area["unplaced"] = True
            merged.append(area)
        return merged

    # ── Pass-through to providers ─────────────────────────

    @property
    def status(self) -> dict[str, dict[str, Any]]:
        """Per-provider diagnostics from the last model build."""
        return self._status

    async def async_history(
        self, kind: str, item_id: str, hours: float
    ) -> list[dict[str, Any]]:
        """Ask the owning provider for an item's history."""
        provider = self.provider_for_item(item_id)
        if provider is None or provider.history_fn is None:
            return []
        local_id = item_id.split(":", 1)[1] if ":" in item_id else item_id
        try:
            result = provider.history_fn(kind, local_id, hours)
            if hasattr(result, "__await__"):
                result = await result
        except Exception:  # noqa: BLE001 - third-party code
            _LOGGER.exception("Provider %s raised delivering history", provider.id)
            return []
        return result if isinstance(result, list) else []

    async def async_action(
        self, kind: str, item_id: str, action_id: str, data: dict[str, Any]
    ) -> dict[str, Any]:
        """Forward an action to the provider that owns the item.

        The hub has no idea what the action does, and that is the point --
        "toggle" means something different to a lamp and to a heat pump.
        """
        provider = self.provider_for_item(item_id)
        if provider is None:
            raise LookupError(f"no provider owns {item_id}")
        if provider.action_fn is None:
            raise LookupError(f"provider {provider.id} accepts no actions")
        local_id = item_id.split(":", 1)[1] if ":" in item_id else item_id
        result = provider.action_fn(kind, local_id, action_id, data)
        if hasattr(result, "__await__"):
            result = await result
        return result if isinstance(result, dict) else {"success": True}
