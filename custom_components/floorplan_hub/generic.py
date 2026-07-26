"""The generic adapter: any integration, without an adapter of its own.

Most integrations will never write a Floorplan-Hub provider. That is not a
failing on their part -- it is the normal state of affairs, and a platform
that only works for the integrations that opted in is a platform that does
not work.

So the user describes a layer instead: *"all the lights"*, *"everything
labelled security"*, *"these four entities"*. Anything Home Assistant knows
about lands on the floor plan, and the integration behind it is never
named, never asked and never even identified.

The important part is how this registers. It uses **the public provider
contract** -- the same dict in ``hass.data`` any third party writes, the
same signals, the same validation, the same fault isolation. It gets no
shortcut into the hub, because a shortcut here would be the first crack in
the thing that makes the hub worth having. A test holds it to that.

A rule, not a list: "all the lights" stays right when a lamp is added next
month. That is the same reason floors and areas come from the registries
rather than a drawing tool.
"""

from __future__ import annotations

import logging
from typing import Any, Callable

from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers import (
    device_registry as dr,
    entity_registry as er,
)
from homeassistant.helpers.dispatcher import async_dispatcher_send

from .const import (
    API_VERSION,
    DATA_PROVIDERS,
    SIGNAL_PROVIDER_REGISTERED,
    SIGNAL_PROVIDER_REMOVED,
)

_LOGGER = logging.getLogger(__name__)

# A layer with three thousand entities is not a floor plan, it is a wall of
# dots nobody can click. Cap it and say so, rather than melting the browser.
MAX_ENTITIES = 250

# Parent devices pulled in by `via_device`. Prefixed so they can never
# collide with an entity id, which is what an ordinary node here is.
VIA_PREFIX = "via:"

PROVIDER_PREFIX = "custom_"


def matching_entities(
    hass: HomeAssistant, config: dict[str, Any]
) -> tuple[list[str], list[str]]:
    """Entity ids a layer's rule selects, plus anything worth warning about.

    Every criterion that is set must match; an empty one means "no opinion".
    Explicitly named entities are added whether or not they match, and
    excluded ones are removed whether or not they do -- the hand-written
    list is the user's override of their own rule.
    """
    warnings: list[str] = []
    domains = {str(d) for d in config.get("domains") or []}
    areas = {str(a) for a in config.get("areas") or []}
    labels = {str(label) for label in config.get("labels") or []}
    device_classes = {str(c) for c in config.get("device_classes") or []}
    explicit = [str(e) for e in config.get("entities") or []]
    excluded = {str(e) for e in config.get("exclude") or []}

    selected: list[str] = []
    if domains or areas or labels or device_classes:
        for entry in _entity_entries(hass):
            entity_id = entry.entity_id
            if getattr(entry, "disabled_by", None) or getattr(entry, "hidden_by", None):
                continue
            if domains and entity_id.split(".")[0] not in domains:
                continue
            if areas and _area_of(hass, entry) not in areas:
                continue
            if labels and not (set(getattr(entry, "labels", None) or ()) & labels):
                continue
            if device_classes and _device_class(hass, entry) not in device_classes:
                continue
            selected.append(entity_id)

    for entity_id in explicit:
        if entity_id not in selected:
            selected.append(entity_id)

    selected = [entity_id for entity_id in selected if entity_id not in excluded]
    selected.sort()

    if len(selected) > MAX_ENTITIES:
        warnings.append(
            f"{len(selected)} entities matched; showing the first {MAX_ENTITIES}. "
            "Narrow the layer down by area, label or device class."
        )
        selected = selected[:MAX_ENTITIES]

    if not selected:
        warnings.append("nothing matched this layer's rule")

    return selected, warnings


def _entity_entries(hass: HomeAssistant) -> list[Any]:
    try:
        registry = er.async_get(hass)
    except (AttributeError, KeyError):  # pragma: no cover - registry absent
        return []
    entities = getattr(registry, "entities", {})
    return list(entities.values())


def _area_of(hass: HomeAssistant, entry: Any) -> str | None:
    area_id = getattr(entry, "area_id", None)
    if area_id or not getattr(entry, "device_id", None):
        return area_id
    try:
        device = dr.async_get(hass).async_get(entry.device_id)
    except (AttributeError, KeyError):  # pragma: no cover
        return None
    return getattr(device, "area_id", None) if device else None


def _device_class(hass: HomeAssistant, entry: Any) -> str | None:
    device_class = getattr(entry, "device_class", None) or getattr(
        entry, "original_device_class", None
    )
    if device_class:
        return device_class
    state = hass.states.get(entry.entity_id) if hasattr(hass, "states") else None
    return state.attributes.get("device_class") if state else None


def _device_of(hass: HomeAssistant, entity_id: str) -> Any:
    try:
        entry = er.async_get(hass).async_get(entity_id)
    except (AttributeError, KeyError):  # pragma: no cover - registry absent
        return None
    if entry is None or not getattr(entry, "device_id", None):
        return None
    try:
        return dr.async_get(hass).async_get(entry.device_id)
    except (AttributeError, KeyError):  # pragma: no cover
        return None


def _via_node(device: Any) -> dict[str, Any]:
    """A parent device as a node, claiming only what is actually known.

    No state: the controller a device is reached through often has no
    entity at all, and inventing "online" for it would be a guess the
    plan then draws in green.
    """
    return {
        "id": f"{VIA_PREFIX}{device.id}",
        "label": getattr(device, "name_by_user", None) or getattr(device, "name", "")
        or "Gerät",
        "area_id": getattr(device, "area_id", None),
        "icon": "mdi:hub-outline",
        "metadata": {
            "hersteller": getattr(device, "manufacturer", "") or "",
            "modell": getattr(device, "model", "") or "",
        },
    }


def topology(hass: HomeAssistant, entity_ids: list[str]) -> dict[str, list]:
    """Edges from Home Assistant's own `via_device` graph.

    This is the one piece of real topology the core registries already
    hold, and it belongs to nobody: an integration that knows a device is
    reached through a controller writes `via_device` when it creates it.
    Reading that names no integration and needs no cooperation from any --
    which is the only reason the hub is allowed to read it at all.

    What it deliberately does not do is reach into any integration's own
    websocket API for the good stuff -- routes, neighbour tables, link
    quality. Those exist for exactly one integration each, and the first
    one the hub asked for by name would be the last day this was a
    platform.
    """
    try:
        devices = dr.async_get(hass)
    except (AttributeError, KeyError):  # pragma: no cover - registry absent
        return {"nodes": [], "edges": []}

    extra: dict[str, dict[str, Any]] = {}
    edges: list[dict[str, Any]] = []
    seen: set[tuple[str, str]] = set()

    for entity_id in entity_ids:
        device = _device_of(hass, entity_id)
        via_id = getattr(device, "via_device_id", None) if device else None
        if not via_id:
            continue
        parent = devices.async_get(via_id)
        if parent is None:
            continue
        target = f"{VIA_PREFIX}{parent.id}"
        if (entity_id, target) in seen:
            continue
        seen.add((entity_id, target))
        extra.setdefault(target, _via_node(parent))
        edges.append({
            "id": f"via-{entity_id}",
            "source": entity_id,
            "target": target,
            # Home Assistant states the relation, not its condition. Saying
            # "good" here would be a measurement nobody took.
            "quality": "unknown",
        })

    return {"nodes": list(extra.values()), "edges": edges}


def registration(hass: HomeAssistant, config: dict[str, Any]) -> dict[str, Any]:
    """One custom layer, expressed as an ordinary provider registration.

    A bare entity id is a complete node -- label, area, icon and state all
    come from Home Assistant. That shorthand exists for third-party
    providers; using it here is the point, not a convenience.
    """
    layer_id = str(config.get("id") or "layer")
    name = str(config.get("name") or "Eigene Ebene")

    wants_topology = bool(config.get("topology"))

    def data() -> dict[str, Any]:
        entities, warnings = matching_entities(hass, config)
        for warning in warnings:
            _LOGGER.debug("Floorplan-Hub custom layer %s: %s", layer_id, warning)
        if not wants_topology:
            return {"nodes": entities}
        extra = topology(hass, entities)
        return {
            "nodes": [*entities, *extra["nodes"]],
            "edges": extra["edges"],
        }

    return {
        "provider_id": f"{PROVIDER_PREFIX}{layer_id}",
        "api_version": API_VERSION,
        "name": name,
        "icon": str(config.get("icon") or "mdi:shape-outline"),
        "capabilities": {
            "nodes": True,
            "edges": bool(config.get("topology")),
            "popup": True,
        },
        "layers": [
            {
                "id": f"{PROVIDER_PREFIX}{layer_id}",
                "name": name,
                "icon": str(config.get("icon") or ""),
                "z_index": int(config.get("z_index") or 10),
            }
        ],
        "data": data,
    }


class GenericProviders:
    """Keeps one registration per configured layer, and not one more."""

    def __init__(self, hass: HomeAssistant, store: Any) -> None:
        self.hass = hass
        self.store = store
        self._registered: dict[str, dict[str, Any]] = {}

    @property
    def configs(self) -> list[dict[str, Any]]:
        stored = self.store.get("settings", "view").get("custom_layers")
        return [layer for layer in stored or [] if isinstance(layer, dict)]

    @callback
    def async_sync(self) -> None:
        """Reconcile registrations with the stored configuration.

        Idempotent, because it runs on every layout change: unchanged
        layers are left exactly as they are, so a rename does not make
        every other layer blink out and back.
        """
        registrations = self.hass.data.setdefault(DATA_PROVIDERS, {})
        wanted = {
            str(config.get("id")): config
            for config in self.configs
            if config.get("id")
        }

        for layer_id in list(self._registered):
            if layer_id in wanted and wanted[layer_id] == self._registered[layer_id]:
                continue
            provider_id = f"{PROVIDER_PREFIX}{layer_id}"
            registrations.pop(provider_id, None)
            del self._registered[layer_id]
            async_dispatcher_send(self.hass, SIGNAL_PROVIDER_REMOVED, provider_id)

        for layer_id, config in wanted.items():
            if layer_id in self._registered:
                continue
            provider_id = f"{PROVIDER_PREFIX}{layer_id}"
            registrations[provider_id] = registration(self.hass, config)
            self._registered[layer_id] = dict(config)
            async_dispatcher_send(self.hass, SIGNAL_PROVIDER_REGISTERED, provider_id)

    @callback
    def async_stop(self) -> None:
        registrations = self.hass.data.get(DATA_PROVIDERS, {})
        for layer_id in list(self._registered):
            registrations.pop(f"{PROVIDER_PREFIX}{layer_id}", None)
        self._registered.clear()


@callback
def async_facets(hass: HomeAssistant) -> dict[str, Any]:
    """What is actually available to build a rule from.

    Without this the editor would have to guess at domains and labels, and
    guessing is how you end up hard-coding a list of integrations.
    """
    domains: dict[str, int] = {}
    labels: dict[str, int] = {}
    device_classes: dict[str, int] = {}

    for entry in _entity_entries(hass):
        if getattr(entry, "disabled_by", None) or getattr(entry, "hidden_by", None):
            continue
        domain = entry.entity_id.split(".")[0]
        domains[domain] = domains.get(domain, 0) + 1
        for label in getattr(entry, "labels", None) or ():
            labels[label] = labels.get(label, 0) + 1
        device_class = _device_class(hass, entry)
        if device_class:
            device_classes[device_class] = device_classes.get(device_class, 0) + 1

    def counted(source: dict[str, int]) -> list[dict[str, Any]]:
        return [
            {"value": value, "count": count}
            for value, count in sorted(source.items(), key=lambda i: (-i[1], i[0]))
        ]

    return {
        "domains": counted(domains),
        "labels": counted(labels),
        "device_classes": counted(device_classes),
        "max_entities": MAX_ENTITIES,
    }
