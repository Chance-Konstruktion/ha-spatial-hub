"""The generic adapter: any integration, without an adapter of its own.

Most integrations will never write a Spatial Hub provider. That is not a
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

# What a fresh installation shows before anybody has configured anything
# or installed a single provider. Chosen to be useful in an ordinary house
# and, above all, *bounded*: "all sensors" in a real home is four hundred
# dots and no floor plan, so the sensor layer is narrowed to the classes
# that actually mean something spatially.
#
# These are rules, not a list of integrations. A house with Z-Wave lights
# and a house with ESPHome lights get the same four layers, and neither is
# named anywhere. `topology` is on for the light layer because that is
# where bridges and controllers actually appear -- which is the structure
# a new user has never been shown before.
DEFAULT_LAYERS: list[dict[str, Any]] = [
    {
        "id": "licht",
        "name": "Licht",
        "icon": "mdi:lightbulb-outline",
        "domains": ["light"],
        "topology": True,
        "z_index": 12,
    },
    {
        "id": "klima",
        "name": "Klima",
        "icon": "mdi:thermostat",
        "domains": ["climate", "fan", "humidifier", "water_heater"],
        "z_index": 11,
    },
    {
        "id": "zugang",
        "name": "Türen & Bewegung",
        "icon": "mdi:door-open",
        "domains": ["binary_sensor", "lock", "cover"],
        "device_classes": ["motion", "occupancy", "presence", "door", "window",
                           "garage_door", "opening"],
        "z_index": 10,
    },
    {
        "id": "medien",
        "name": "Medien",
        "icon": "mdi:speaker",
        "domains": ["media_player"],
        "z_index": 9,
    },
]


def effective_layers(store: Any) -> tuple[list[dict[str, Any]], bool]:
    """The layers in force, and whether they are still the defaults.

    Never configured and configured-to-nothing are different answers. A
    user who deleted every layer meant it, and resurrecting the defaults
    on the next restart would be the hub arguing with them.
    """
    stored = store.get("settings", "view").get("custom_layers")
    if stored is None:
        return [dict(layer) for layer in DEFAULT_LAYERS], True
    return [layer for layer in stored if isinstance(layer, dict)], False


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


def hardware_key(device: Any) -> Any:
    """What makes two device entries the same physical box.

    From Home Assistant 2026.8 a device belongs to exactly one config
    entry, and entries that used to be merged across integrations are
    split -- one per integration. The wall socket that was one device is
    now two, and drawing both would put the same physical controller on
    the plan twice under two names.

    ``connections`` is what merged them in the first place (a MAC is a MAC,
    whoever reports it), so it is what un-merges them here. A device with
    no connections keeps its own identity: identifiers are per-integration
    and would only ever match itself.
    """
    connections = getattr(device, "connections", None) or ()
    try:
        pairs = sorted((str(kind), str(value)) for kind, value in connections)
    except (TypeError, ValueError):  # pragma: no cover - unexpected shape
        pairs = []
    return tuple(pairs) if pairs else ("device_id", device.id)


def physical_siblings(hass: HomeAssistant, device: Any) -> list[Any]:
    """The other device entries that are the same physical hardware.

    Empty in the ordinary case, and empty on every Home Assistant before
    2026.8 -- nothing here assumes the split has happened.
    """
    if device is None:
        return []
    key = hardware_key(device)
    if key[0] == "device_id":
        return []
    try:
        registry = dr.async_get(hass)
    except (AttributeError, KeyError):  # pragma: no cover - registry absent
        return []
    return [
        other
        for other in getattr(registry, "devices", {}).values()
        if other.id != device.id and hardware_key(other) == key
    ]


def _first(group: list[Any], *attributes: str) -> str | None:
    """The first thing anybody knows, asked in a fixed order.

    With a split device the name may sit on one entry and the model on
    another. Sorting by id first is what keeps the answer the same on
    every reload, rather than depending on which integration set up first.
    """
    for device in group:
        for attribute in attributes:
            value = getattr(device, attribute, None)
            if value:
                return value
    return None


def _via_node(group: list[Any]) -> dict[str, Any]:
    """A parent device as a node, claiming only what is actually known.

    ``group`` is every device entry for one physical box -- usually one,
    from 2026.8 sometimes several. They are drawn as the single thing they
    are, and the id stays a device id so a stored position survives.

    No state: the controller a device is reached through often has no
    entity at all, and inventing "online" for it would be a guess the
    plan then draws in green.
    """
    node = {
        "id": f"{VIA_PREFIX}{group[0].id}",
        "label": _first(group, "name_by_user", "name") or "Gerät",
        "area_id": _first(group, "area_id"),
        "icon": "mdi:hub-outline",
        "metadata": {
            "hersteller": _first(group, "manufacturer") or "",
            "modell": _first(group, "model") or "",
        },
    }
    if len(group) > 1:
        # Named, not hidden: the same hardware really does have several
        # device entries now, and a renderer offering "open in Home
        # Assistant" needs to know there is more than one page to open.
        node["metadata"]["geraete"] = [device.id for device in group]
    return node


def _via_group(hass: HomeAssistant, device: Any) -> list[Any]:
    """One physical box as its device entries, in a stable order."""
    return sorted([device, *physical_siblings(hass, device)], key=lambda d: d.id)


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
        group = _via_group(hass, parent)
        target = f"{VIA_PREFIX}{group[0].id}"
        if (entity_id, target) in seen:
            continue
        seen.add((entity_id, target))
        extra.setdefault(target, _via_node(group))
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
            _LOGGER.debug("Spatial Hub custom layer %s: %s", layer_id, warning)
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
        return effective_layers(self.store)[0]

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
