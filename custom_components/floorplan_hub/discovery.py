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
from homeassistant.helpers import area_registry as ar, floor_registry as fr

from .models import Node, Position

# Nodes sharing an area are spread on a small circle around its centre so
# they don't stack into one unclickable blob before the user arranges them.
_SPREAD_RADIUS = 0.035


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
    area_floors = {area["id"]: area["floor_id"] for area in areas}

    per_area: dict[str | None, list[Node]] = {}
    for node in nodes:
        if node.area_id and not node.floor_id:
            node.floor_id = area_floors.get(node.area_id)
        if node.position is None:
            per_area.setdefault(node.area_id, []).append(node)

    for area_id, area_nodes in per_area.items():
        centre = area_centres.get(area_id) if area_id else None
        base_x = centre["x"] if centre else 0.5
        base_y = centre["y"] if centre else 0.5
        count = len(area_nodes)
        for index, node in enumerate(area_nodes):
            if count == 1:
                node.position = Position(x=base_x, y=base_y)
                continue
            angle = 2 * math.pi * index / count
            node.position = Position(
                x=_clamp(base_x + _SPREAD_RADIUS * math.cos(angle)),
                y=_clamp(base_y + _SPREAD_RADIUS * math.sin(angle)),
            )
            node.metadata = {**node.metadata, "auto_position": True}


def _clamp(value: float) -> float:
    return min(1.0, max(0.0, value))
