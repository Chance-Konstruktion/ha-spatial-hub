"""Zero-config placement: floors and areas straight from Home Assistant.

The user already told Home Assistant that the bedroom is upstairs. Asking
them to say it again in a floor plan editor is the thing this project
exists to avoid. So: floors and areas come from the registries, every node
lands in the middle of its area, and the user only ever corrects what the
automatic placement got wrong.

All coordinates are normalised 0..1 per floor.
"""

from __future__ import annotations

import math
from typing import Any

from homeassistant.core import HomeAssistant
from homeassistant.helpers import (
    area_registry as ar,
    device_registry as dr,
    entity_registry as er,
    floor_registry as fr,
)

from .const import STATE_UNKNOWN
from .models import Node, Position

# Nodes sharing a spot are spread over a grid so they do not stack into one
# unclickable blob before the user arranges them. A circle was the first
# attempt and it only worked for the handful of nodes a single provider
# puts in a single room: with the built-in layers switched on, nineteen
# area-less entities landed on one 0.035 circle in the middle of the plan
# and could not be told apart, let alone clicked.
#
# The area a node has no claim on is the whole floor, inset so nothing
# sits on the edge; inside a real room it is that room's own box.
_PLAN_INSET = 0.08
_ROOM_FILL = 0.7


def async_floors(hass: HomeAssistant) -> list[dict[str, Any]]:
    """Floors from the floor registry, ordered as the user sorted them."""
    try:
        registry = fr.async_get(hass)
    except (AttributeError, KeyError):  # HA < 2024.4 has no floor registry
        return []
    floors = sorted(
        registry.async_list_floors(),
        key=lambda floor: (floor.level if floor.level is not None else 0, floor.name),
    )
    return [
        {
            "id": floor.floor_id,
            "name": floor.name,
            "level": floor.level,
            "icon": floor.icon or "",
        }
        for floor in floors
    ]


def async_areas(hass: HomeAssistant) -> list[dict[str, Any]]:
    """Areas from the area registry, each with an auto-assigned box."""
    registry = ar.async_get(hass)
    areas = sorted(registry.async_list_areas(), key=lambda area: area.name)

    # Group per floor first: the grid must be per floor, or a house with
    # three floors ends up with one enormous mosaic.
    by_floor: dict[str | None, list[Any]] = {}
    for area in areas:
        by_floor.setdefault(getattr(area, "floor_id", None), []).append(area)

    result: list[dict[str, Any]] = []
    for floor_id, floor_areas in by_floor.items():
        for index, area in enumerate(floor_areas):
            position, size = _grid_cell(index, len(floor_areas))
            result.append(
                {
                    "id": area.id,
                    "name": area.name,
                    "floor_id": floor_id,
                    "icon": getattr(area, "icon", "") or "",
                    "position": position.as_dict(),
                    "size": size,
                    "auto": True,
                }
            )
    return result


def async_entity_defaults(hass: HomeAssistant, entity_id: str) -> dict[str, Any]:
    """Everything Home Assistant already knows about an entity.

    A provider that names an entity has said enough: label, area, icon and
    state are all on record already. Making it repeat them would be exactly
    the kind of busywork this project exists to delete.

    Only keys that could be resolved are returned, so the caller can fill
    blanks without ever overwriting what the provider stated itself.
    """
    defaults: dict[str, Any] = {"entity_id": entity_id}

    entry = None
    try:
        entry = er.async_get(hass).async_get(entity_id)
    except (AttributeError, KeyError):  # pragma: no cover - registry absent
        entry = None

    area_id = getattr(entry, "area_id", None) if entry else None
    if entry is not None and not area_id and entry.device_id:
        # The entity inherits its device's area unless it overrides it.
        try:
            device = dr.async_get(hass).async_get(entry.device_id)
            area_id = getattr(device, "area_id", None) if device else None
        except (AttributeError, KeyError):  # pragma: no cover
            area_id = None
    if area_id:
        defaults["area_id"] = area_id

    if entry is not None:
        label = entry.name or entry.original_name
        if label:
            defaults["label"] = label
        icon = entry.icon or getattr(entry, "original_icon", None)
        if icon:
            defaults["icon"] = icon

    state = hass.states.get(entity_id) if hasattr(hass, "states") else None
    if state is not None:
        defaults.setdefault(
            "label", state.attributes.get("friendly_name") or entity_id
        )
        if state.attributes.get("icon"):
            defaults["icon"] = state.attributes["icon"]
        defaults["state"] = _entity_state(state.state)
        defaults["metadata"] = dict(state.attributes)

    defaults.setdefault("label", entity_id)
    return defaults


def _entity_state(state: str) -> str:
    """Map an entity state into the hub's vocabulary where it fits.

    Only the "we have no idea" cases are translated. Everything else passes
    through verbatim -- "on", "heating" and "docked" all mean something to
    the layer that produced them, and flattening them would throw away the
    only information the renderer has to style with.
    """
    if state in ("unavailable", "unknown", None, ""):
        return STATE_UNKNOWN
    return state


def _grid_cell(index: int, total: int) -> tuple[Position, dict[str, float]]:
    """Lay areas out on the squarest grid that fits them all."""
    columns = max(1, math.ceil(math.sqrt(total)))
    rows = max(1, math.ceil(total / columns))
    column, row = index % columns, index // columns
    width, height = 1.0 / columns, 1.0 / rows
    centre = Position(x=(column + 0.5) * width, y=(row + 0.5) * height)
    # Leave a gutter so adjacent areas read as separate rooms.
    return centre, {"width": width * 0.9, "height": height * 0.9}


def async_place_nodes(
    hass: HomeAssistant,
    nodes: list[Node],
    areas: list[dict[str, Any]],
) -> None:
    """Give every position-less node a sensible spot, in place.

    Priority: the provider's own position wins, then the centre of the
    node's area, then the middle of the floor plan. User overrides are
    applied later by the hub and beat all three.
    """
    area_centres = {area["id"]: area["position"] for area in areas}
    area_sizes = {area["id"]: area.get("size") or {} for area in areas}
    area_floors = {area["id"]: area["floor_id"] for area in areas}

    per_area: dict[str | None, list[Node]] = {}
    for node in nodes:
        if node.area_id and not node.floor_id:
            node.floor_id = area_floors.get(node.area_id)
        if node.position is None:
            per_area.setdefault(node.area_id, []).append(node)

    for area_id, area_nodes in per_area.items():
        centre = area_centres.get(area_id) if area_id else None
        count = len(area_nodes)
        if centre:
            size = area_sizes.get(area_id) or {}
            width = float(size.get("width") or 0.3) * _ROOM_FILL
            height = float(size.get("height") or 0.3) * _ROOM_FILL
            base_x, base_y = centre["x"], centre["y"]
        else:
            # No area means no spatial claim at all, so the honest place is
            # "somewhere on this floor" -- spread out and clickable, not a
            # pile in the middle.
            width = height = 1.0 - 2 * _PLAN_INSET
            base_x = base_y = 0.5

        for index, (fx, fy) in enumerate(_grid_offsets(count)):
            node = area_nodes[index]
            node.position = Position(
                x=_clamp(base_x + fx * width),
                y=_clamp(base_y + fy * height),
            )
            if count > 1 or not centre:
                node.metadata = {**node.metadata, "auto_position": True}


def _grid_offsets(count: int) -> list[tuple[float, float]]:
    """Offsets in [-0.5, 0.5], one per node, laid out on a centred grid.

    One node sits in the middle. Everything else gets a cell, which is the
    only arrangement that stays legible whether there are three nodes or
    ninety -- and it is what the user is about to drag apart anyway.
    """
    if count <= 1:
        return [(0.0, 0.0)]
    columns = math.ceil(math.sqrt(count))
    rows = math.ceil(count / columns)
    offsets: list[tuple[float, float]] = []
    for index in range(count):
        column, row = index % columns, index // columns
        offsets.append((
            (column + 0.5) / columns - 0.5,
            (row + 0.5) / rows - 0.5,
        ))
    return offsets


def _clamp(value: float) -> float:
    return min(1.0, max(0.0, value))
