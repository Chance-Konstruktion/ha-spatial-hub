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
    CURRENT_SDK_VERSION,
    OUTDOOR_MARGIN,
    SIGNAL_DATA_UPDATED,
    SIGNAL_PROVIDER_REGISTERED,
    SIGNAL_PROVIDER_REMOVED,
    STATE_UNKNOWN,
    UNASSIGNED_FLOOR_ID,
    UNASSIGNED_FLOOR_NAME,
    VIRTUAL_FLOOR_ID,
    VIRTUAL_FLOOR_NAME,
    AreaKind,
)
from .generic import effective_layers
from .models import Edge, Node, Position
from .registry import Provider, async_load_providers
from .theme import resolve as resolve_theme
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
        # Before nodes are placed: a node inherits its area's floor, so the
        # areas have to know where they live first.
        floors.extend(self._floor_for_the_unassigned(floors, areas))
        # And before *that* is worth anything, the garden has to stop being
        # a storey: the user's own settings win over the guessed kind,
        # outdoor areas move onto the ground floor, virtual ones onto a
        # plane of their own, and only then is there something to arrange.
        self._merge_area_overrides(areas)
        floors = self._resolve_area_kinds(floors, areas)
        if self.auto_areas:
            discovery.async_arrange_areas(areas)

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
                "sdk_version": provider.sdk_version,
                # Never a log warning and never a refusal: an old copy of
                # the shim keeps working. This exists so its author finds
                # out a better one exists, at the moment they go looking.
                "sdk_outdated": bool(
                    provider.sdk_version
                    and provider.sdk_version < CURRENT_SDK_VERSION
                ),
            }

        discovery.async_place_nodes(self.hass, nodes, areas)

        laid_out = [self._apply_node_layout(node) for node in nodes]
        # What the device behind a node is made of. A popup that can only
        # show one entity of a ten-entity device sends the user off to
        # Home Assistant to find the other nine.
        for data in laid_out:
            if data.get("device_id"):
                data["entities"] = discovery.async_device_entities(
                    self.hass, data["device_id"]
                )
        node_dicts = [n for n in laid_out if not n["_hidden"]]
        # Hidden items are reported separately rather than simply dropped:
        # an editor needs somewhere to un-hide them from, and a plain
        # renderer still only ever draws `nodes`.
        hidden_nodes = [
            {"id": n["id"], "label": n["label"]} for n in laid_out if n["_hidden"]
        ]
        for node in laid_out:
            del node["_hidden"]
        known_ids = {node["id"] for node in node_dicts}
        self.entity_ids = {
            node["entity_id"] for node in node_dicts if node.get("entity_id")
        }

        visible_areas, hidden_areas = self._apply_area_layout(areas)

        return {
            "api_version": API_VERSION,
            "floors": self._apply_floor_layout(floors),
            "areas": visible_areas,
            "hidden": {"nodes": hidden_nodes, "areas": hidden_areas},
            "layers": self._apply_layer_layout(layers),
            "nodes": node_dicts,
            # An edge to a dropped node would render as a line into nowhere.
            "edges": [
                edge.as_dict()
                for edge in edges
                if edge.source in known_ids and edge.target in known_ids
            ],
            "providers": [provider.as_dict() for provider in providers.values()],
            # Resolved here, not in the renderer: a second renderer gets
            # the same colours without reimplementing a single preset.
            "theme": resolve_theme(self.store.get("settings", "view")),
            # The user's own layer rules, for whatever edits them. A plain
            # renderer ignores this and just draws the nodes they produced.
            "custom_layers": [
                layer
                for layer in effective_layers(self.store)[0]
                if isinstance(layer, dict)
            ],
            # So an editor can say "these are ours, not yours" and offer to
            # put them back after the user has taken them apart.
            "custom_layers_are_default": effective_layers(self.store)[1],
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
            if not node.device_id and defaults.get("device_id"):
                node.device_id = defaults["device_id"]
            if node.state == STATE_UNKNOWN and "state" in defaults:
                node.state = defaults["state"]
            # Entity attributes go underneath the provider's own metadata:
            # a provider that measured something means it.
            node.metadata = {**defaults.get("metadata", {}), **node.metadata}

    def _apply_node_layout(self, node: Node) -> dict[str, Any]:
        override = self.store.get("nodes", node.id)
        data = node.as_dict()
        data["_hidden"] = False
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

    def _floor_for_the_unassigned(
        self, floors: list[dict[str, Any]], areas: list[dict[str, Any]]
    ) -> list[dict[str, Any]]:
        """Give areas without a floor a storey of their own, in place.

        Only once real floors exist. A house that has none at all already
        gets a single default storey, and everything is unassigned there --
        putting them on an "unassigned" tab would be all of them, which
        tells the user nothing.
        """
        homeless = [area for area in areas if not area.get("floor_id")]
        if not floors or not homeless:
            return []
        for area in homeless:
            area["floor_id"] = UNASSIGNED_FLOOR_ID
        return [{
            "id": UNASSIGNED_FLOOR_ID,
            "name": UNASSIGNED_FLOOR_NAME,
            "level": None,
            "icon": "mdi:help-circle-outline",
            # Sorted last whatever its level, and marked so a renderer can
            # say what it is instead of pretending it is a real storey.
            "unassigned": True,
        }]

    def _resolve_area_kinds(
        self, floors: list[dict[str, Any]], areas: list[dict[str, Any]]
    ) -> list[dict[str, Any]]:
        """Put outdoor areas around the ground floor, virtual ones above it.

        A garden is not a storey. Given its own floor it lands between the
        cellar and the ground floor as if you could walk down into it, and
        a house with a front garden, a back garden and a terrace suddenly
        has three of them. So every outdoor area joins the ground floor and
        is arranged in the apron *around* it, which is where it actually is.

        Returns the floors that are left: a storey that existed only to
        hold the garden goes with it.
        """
        outdoor = [area for area in areas if area["kind"] is AreaKind.OUTDOOR]
        virtual = [area for area in areas if area["kind"] is AreaKind.VIRTUAL]
        if not outdoor and not virtual:
            return floors

        emptied = {
            area["floor_id"] for area in outdoor + virtual if area.get("floor_id")
        }

        ground = self._ground_floor(floors)
        if ground is not None:
            for area in outdoor:
                area["floor_id"] = ground["id"]
                area["outdoor"] = True
            ground["has_outdoor"] = True
            ground["outdoor_margin"] = OUTDOOR_MARGIN

        if virtual:
            for area in virtual:
                area["floor_id"] = VIRTUAL_FLOOR_ID
                area["virtual"] = True
            floors = [*floors, {
                "id": VIRTUAL_FLOOR_ID,
                "name": VIRTUAL_FLOOR_NAME,
                # Above the roof, where nobody mistakes it for a room.
                "level": 900,
                "icon": "mdi:cloud-outline",
                "virtual": True,
            }]

        # A storey whose every area has just moved outside was never a
        # storey -- it was the user's way of saying "outside" before the
        # hub had a word for it. Keeping it would leave an empty tab.
        still_used = {area.get("floor_id") for area in areas}
        return [
            floor
            for floor in floors
            if floor["id"] not in emptied or floor["id"] in still_used
        ]

    def _ground_floor(self, floors: list[dict[str, Any]]) -> dict[str, Any] | None:
        """The storey a garden belongs to: level 0, or the lowest above it."""
        candidates = [
            floor
            for floor in floors
            if not floor.get("unassigned") and not floor.get("virtual")
        ]
        if not candidates:
            return None
        at_ground = [floor for floor in candidates if (floor.get("level") or 0) >= 0]
        pool = at_ground or candidates
        return min(pool, key=lambda floor: abs(floor.get("level") or 0))

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
        # `order` is the user's own sorting; without one, the registry's
        # level decides, as it did before anybody edited anything.
        return sorted(
            merged,
            key=lambda floor: (
                bool(floor.get("unassigned")),
                floor.get("order") if floor.get("order") is not None
                else (floor.get("level") or 0),
            ),
        )

    def _merge_area_overrides(self, areas: list[dict[str, Any]]) -> None:
        """Fold the user's stored decisions into each area, in place.

        Everything downstream -- which storey an area belongs to, where it
        is arranged, whether the sandwich shows it -- depends on the answers
        the user gave, so they have to be in the dict before any of it runs.
        """
        for area in areas:
            override = self.store.get("areas", area["id"])
            # Whatever is stored, whatever a future editor writes, and
            # whatever the guess produced all arrive here as one of three
            # values or as a complaint -- never as an unexamined string.
            guessed = AreaKind.parse(area.get("kind"), AreaKind.INDOOR)
            if "kind" in override:
                stated = AreaKind.parse(override["kind"])
                if stated is None:
                    _LOGGER.warning(
                        "Area %s has an unknown kind %r stored; using %s. "
                        "Valid kinds are %s",
                        area["id"], override["kind"], guessed.value,
                        ", ".join(kind.value for kind in AreaKind),
                    )
                area["kind"] = stated or guessed
            else:
                area["kind"] = guessed
            for key in ("position", "size", "color", "name", "in_sandwich",
                        "single_only"):
                if key in override and override[key] is not None:
                    area[key] = override[key]
                    if key == "position":
                        area["auto"] = False
            area["hidden"] = bool(override.get("hidden"))
            # An area kept out of the sandwich is a *choice*, and "only in
            # the single view" is the same choice said the other way round.
            if area.get("single_only"):
                area["in_sandwich"] = False
            area.setdefault("in_sandwich", True)
            area.setdefault("single_only", False)

    def _apply_area_layout(
        self, areas: list[dict[str, Any]]
    ) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
        """Areas to draw, and the ones the user hid but may want back."""
        merged: list[dict[str, Any]] = []
        hidden: list[dict[str, Any]] = []
        for area in areas:
            if area.get("hidden"):
                hidden.append({"id": area["id"], "name": area["name"]})
                continue
            area = {key: value for key, value in area.items() if key != "hidden"}
            # The wire format is the plain word: JSON has no enums, and the
            # specification names the three by value.
            area["kind"] = AreaKind(area["kind"]).value
            if area.get("auto") is False:
                pass
            elif not self.auto_areas:
                # Hand-arrangement mode: no grid guess, but the area is
                # still reported -- a user who has placed nothing must not
                # be shown an empty house with no way back. Renderers put
                # these in an "unplaced" tray to drag from.
                area["position"] = None
                area["unplaced"] = True
            merged.append(area)
        return merged, hidden

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
