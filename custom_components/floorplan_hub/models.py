"""The spatial data model -- the vocabulary every provider speaks.

The hub knows nothing about Powerline, UniFi or Shelly. It knows Layers,
Nodes, Edges, Actions and Popups. Providers hand over plain dicts (so they
never have to import this package) and the hub normalises them here.

Normalisation is deliberately forgiving: an unknown key lands in
``metadata`` rather than raising, and a malformed node is dropped instead
of taking the whole layer down with it. A provider having a bad day must
not blank the user's floor plan.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from .const import (
    DEFAULT_LAYER_OPACITY,
    DEFAULT_Z_INDEX,
    QUALITY_UNKNOWN,
    STATE_UNKNOWN,
)


class SpatialError(ValueError):
    """A provider payload could not be understood."""


def _str(value: Any, default: str = "") -> str:
    return str(value) if value not in (None, "") else default


def _float_or_none(value: Any) -> float | None:
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


@dataclass(slots=True)
class Position:
    """A point on the floor plan, in normalised 0..1 floor coordinates.

    Normalised rather than pixels so the same model renders at any canvas
    size, on any renderer (SVG, Canvas, 3D). ``z`` is free-form height for
    renderers that support it; 2D renderers ignore it.
    """

    x: float
    y: float
    z: float = 0.0

    @classmethod
    def from_dict(cls, data: Any) -> Position | None:
        if not isinstance(data, dict):
            return None
        x, y = _float_or_none(data.get("x")), _float_or_none(data.get("y"))
        if x is None or y is None:
            return None
        return cls(x=x, y=y, z=_float_or_none(data.get("z")) or 0.0)

    def as_dict(self) -> dict[str, float]:
        return {"x": self.x, "y": self.y, "z": self.z}


@dataclass(slots=True)
class Action:
    """Something the user can trigger on a node or edge.

    The hub does not execute the action itself -- it forwards it to the
    owning provider, which decides what "toggle" means for its hardware.
    """

    id: str
    label: str = ""
    icon: str = ""
    confirm: bool = False

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> Action | None:
        action_id = _str(data.get("id"))
        if not action_id:
            return None
        return cls(
            id=action_id,
            label=_str(data.get("label"), action_id),
            icon=_str(data.get("icon")),
            confirm=bool(data.get("confirm")),
        )

    def as_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "label": self.label,
            "icon": self.icon,
            "confirm": self.confirm,
        }


@dataclass(slots=True)
class Node:
    """A thing that sits somewhere: an adapter, a lamp, a bed, a sensor."""

    id: str
    label: str = ""
    area_id: str | None = None
    floor_id: str | None = None
    position: Position | None = None
    state: str = STATE_UNKNOWN
    icon: str = ""
    color: str = ""
    entity_id: str | None = None
    # The Home Assistant device behind this node, when there is one. The
    # hub fills it in from the entity; a provider that knows better may
    # state it itself. Renderers use it to open the device page.
    device_id: str | None = None
    actions: list[Action] = field(default_factory=list)
    metadata: dict[str, Any] = field(default_factory=dict)

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> Node:
        node_id = _str(data.get("id"))
        if not node_id:
            raise SpatialError("node without id")
        actions = [
            action
            for raw in data.get("actions") or []
            if isinstance(raw, dict) and (action := Action.from_dict(raw))
        ]
        return cls(
            id=node_id,
            label=_str(data.get("label"), node_id),
            area_id=_str(data.get("area_id")) or None,
            floor_id=_str(data.get("floor_id")) or None,
            position=Position.from_dict(data.get("position")),
            state=_str(data.get("state"), STATE_UNKNOWN),
            icon=_str(data.get("icon")),
            color=_str(data.get("color")),
            entity_id=_str(data.get("entity_id")) or None,
            device_id=_str(data.get("device_id")) or None,
            actions=actions,
            metadata=dict(data.get("metadata") or {}),
        )

    def as_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "label": self.label,
            "area_id": self.area_id,
            "floor_id": self.floor_id,
            "position": self.position.as_dict() if self.position else None,
            "state": self.state,
            "icon": self.icon,
            "color": self.color,
            "entity_id": self.entity_id,
            "device_id": self.device_id,
            "actions": [action.as_dict() for action in self.actions],
            "metadata": self.metadata,
        }


@dataclass(slots=True)
class Edge:
    """A relationship between two nodes: a link, a flow, a pipe, a trail."""

    id: str
    source: str
    target: str
    label: str = ""
    value: float | None = None
    quality: str = QUALITY_UNKNOWN
    color: str = ""
    width: float = 2.0
    directed: bool = False
    dashed: bool = False
    animated: bool = False
    actions: list[Action] = field(default_factory=list)
    metadata: dict[str, Any] = field(default_factory=dict)

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> Edge:
        source, target = _str(data.get("source")), _str(data.get("target"))
        if not source or not target:
            raise SpatialError("edge without source/target")
        edge_id = _str(data.get("id"), f"{source}__{target}")
        actions = [
            action
            for raw in data.get("actions") or []
            if isinstance(raw, dict) and (action := Action.from_dict(raw))
        ]
        return cls(
            id=edge_id,
            source=source,
            target=target,
            label=_str(data.get("label")),
            value=_float_or_none(data.get("value")),
            quality=_str(data.get("quality"), QUALITY_UNKNOWN),
            color=_str(data.get("color")),
            width=_float_or_none(data.get("width")) or 2.0,
            directed=bool(data.get("directed")),
            dashed=bool(data.get("dashed")),
            animated=bool(data.get("animated")),
            actions=actions,
            metadata=dict(data.get("metadata") or {}),
        )

    def as_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "source": self.source,
            "target": self.target,
            "label": self.label,
            "value": self.value,
            "quality": self.quality,
            "color": self.color,
            "width": self.width,
            "directed": self.directed,
            "dashed": self.dashed,
            "animated": self.animated,
            "actions": [action.as_dict() for action in self.actions],
            "metadata": self.metadata,
        }


@dataclass(slots=True)
class Layer:
    """One provider's slice of the floor plan, toggleable on its own."""

    id: str
    name: str = ""
    icon: str = ""
    z_index: int = DEFAULT_Z_INDEX
    opacity: float = DEFAULT_LAYER_OPACITY
    visible: bool = True
    provider_id: str = ""

    @classmethod
    def from_dict(cls, data: dict[str, Any], provider_id: str = "") -> Layer:
        layer_id = _str(data.get("id"))
        if not layer_id:
            raise SpatialError("layer without id")
        return cls(
            id=layer_id,
            name=_str(data.get("name"), layer_id),
            icon=_str(data.get("icon")),
            z_index=int(_float_or_none(data.get("z_index")) or DEFAULT_Z_INDEX),
            opacity=_float_or_none(data.get("opacity")) or DEFAULT_LAYER_OPACITY,
            visible=bool(data.get("visible", True)),
            provider_id=provider_id or _str(data.get("provider_id")),
        )

    def as_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "name": self.name,
            "icon": self.icon,
            "z_index": self.z_index,
            "opacity": self.opacity,
            "visible": self.visible,
            "provider_id": self.provider_id,
        }


@dataclass(slots=True)
class Capabilities:
    """What a provider can do, in its own words.

    The hub switches features on from this instead of asking "is this
    Powerline?". A provider that never grows history simply says so and no
    history UI appears for its layer.
    """

    nodes: bool = True
    edges: bool = False
    history: bool = False
    animation: bool = False
    popup: bool = False
    actions: bool = False
    custom_icons: bool = False

    @classmethod
    def from_dict(cls, data: Any) -> Capabilities:
        if not isinstance(data, dict):
            return cls()
        known = {
            "nodes",
            "edges",
            "history",
            "animation",
            "popup",
            "actions",
            "custom_icons",
        }
        return cls(**{key: bool(value) for key, value in data.items() if key in known})

    def as_dict(self) -> dict[str, bool]:
        return {
            "nodes": self.nodes,
            "edges": self.edges,
            "history": self.history,
            "animation": self.animation,
            "popup": self.popup,
            "actions": self.actions,
            "custom_icons": self.custom_icons,
        }
