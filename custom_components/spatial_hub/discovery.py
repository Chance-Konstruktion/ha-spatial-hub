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
import re
from typing import Any, Final

from homeassistant.core import HomeAssistant
from homeassistant.helpers import (
    area_registry as ar,
    device_registry as dr,
    entity_registry as er,
    floor_registry as fr,
)

from .const import (
    OUTDOOR_MARGIN,
    STATE_UNKNOWN,
    AreaKind,
)
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

# Names that mean "this is outside". A guess, and a cheap one to be wrong
# about: the user flips the kind in the editor and the choice is stored.
# Guessing beats asking, because a house full of gardens on their own
# storey is what the alternative looks like on first run.
_OUTDOOR_WORDS = frozenset(
    {
        "garten", "vorgarten", "hintergarten", "garden", "frontyard",
        "backyard", "yard", "terrasse", "terrace", "patio", "balkon",
        "balcony", "garage", "carport", "einfahrt", "driveway", "hof",
        "innenhof", "courtyard", "pool", "schwimmbad", "gartenhaus",
        "schuppen", "shed", "gewachshaus", "greenhouse", "aussen",
        "draussen", "outdoor", "outside", "veranda", "loggia", "dachterrasse",
        "grundstuck", "wintergarten",
    }
)

# Icons Home Assistant itself uses for these domains, so a node without an
# icon of its own still looks like the thing it is. A dot is the one answer
# that tells the user nothing.
_DOMAIN_ICONS = {
    "light": "mdi:lightbulb",
    "switch": "mdi:toggle-switch-outline",
    "sensor": "mdi:eye-outline",
    "binary_sensor": "mdi:radiobox-blank",
    "climate": "mdi:thermostat",
    "cover": "mdi:window-shutter",
    "lock": "mdi:lock",
    "media_player": "mdi:speaker",
    "camera": "mdi:video",
    "fan": "mdi:fan",
    "vacuum": "mdi:robot-vacuum",
    "person": "mdi:account",
    "device_tracker": "mdi:account-arrow-right",
    "water_heater": "mdi:water-boiler",
    "humidifier": "mdi:air-humidifier",
    "valve": "mdi:pipe-valve",
    "siren": "mdi:bullhorn",
    "button": "mdi:gesture-tap-button",
    "number": "mdi:ray-vertex",
    "select": "mdi:format-list-bulleted",
    "update": "mdi:package-up",
    "weather": "mdi:weather-partly-cloudy",
    "scene": "mdi:palette",
    "script": "mdi:script-text",
    "automation": "mdi:robot",
    "zone": "mdi:map-marker-radius",
}

# Device classes worth being more specific than the domain about.
_DEVICE_CLASS_ICONS = {
    "temperature": "mdi:thermometer",
    "humidity": "mdi:water-percent",
    "pressure": "mdi:gauge",
    "power": "mdi:flash",
    "energy": "mdi:lightning-bolt",
    "current": "mdi:current-ac",
    "voltage": "mdi:sine-wave",
    "battery": "mdi:battery",
    "illuminance": "mdi:brightness-5",
    "motion": "mdi:motion-sensor",
    "occupancy": "mdi:home-account",
    "door": "mdi:door",
    "window": "mdi:window-closed-variant",
    "garage": "mdi:garage",
    "garage_door": "mdi:garage",
    "smoke": "mdi:smoke-detector",
    "gas": "mdi:gas-cylinder",
    "moisture": "mdi:water-alert",
    "connectivity": "mdi:lan-connect",
    "signal_strength": "mdi:wifi",
    "carbon_dioxide": "mdi:molecule-co2",
    "shutter": "mdi:window-shutter",
    "awning": "mdi:awning-outline",
    "curtain": "mdi:curtains",
    "speaker": "mdi:speaker",
    "tv": "mdi:television",
    "receiver": "mdi:audio-video",
    "router": "mdi:router-network",
}


def area_kind(name: str, icon: str = "") -> AreaKind:
    """Guess whether an area is indoors, from what the user called it."""
    haystack = _fold(name) + " " + _fold(icon)
    for word in _OUTDOOR_WORDS:
        if word in haystack:
            return AreaKind.OUTDOOR
    return AreaKind.INDOOR


def _fold(value: str) -> str:
    """Lower-case, umlaut-flattened, punctuation-free -- for matching only."""
    folded = str(value or "").lower()
    for source, target in (("ä", "a"), ("ö", "o"), ("ü", "u"), ("ß", "ss")):
        folded = folded.replace(source, target)
    return "".join(char if char.isalnum() else " " for char in folded)


def fallback_icon(entity_id: str, device_class: str = "") -> str:
    """An icon for an entity that never got one, from what it is."""
    if device_class and device_class in _DEVICE_CLASS_ICONS:
        return _DEVICE_CLASS_ICONS[device_class]
    domain = str(entity_id or "").split(".", 1)[0]
    return _DOMAIN_ICONS.get(domain, "mdi:shape-outline")


# Storeys, by the words people actually name them with. Home Assistant
# lets a floor exist without a level, and most do -- the field is optional
# and easy to miss. Everything without one used to become level 0, which
# put the attic on the ground next to the cellar and made the house in the
# sandwich view nonsense. Guessing from the name is not a substitute for
# the field; it is what to do until somebody fills it in.
_FLOOR_LEVELS: Final[tuple[tuple[frozenset[str], int], ...]] = (
    (frozenset({"tiefgarage", "untergeschoss", "ug", "souterrain"}), -2),
    (frozenset({"keller", "cellar", "basement", "kg"}), -1),
    (frozenset({"erdgeschoss", "eg", "parterre", "ground", "groundfloor",
                "eartefloor"}), 0),
    (frozenset({"hochparterre", "mezzanine", "zwischengeschoss"}), 1),
    (frozenset({"dach", "dachboden", "dachgeschoss", "spitzboden", "attic",
                "loft", "speicher", "attika", "dg"}), 90),
)

# "1. OG", "2 OG", "3rd floor", "Etage 4" -- the number is the level.
_FLOOR_NUMBER = re.compile(
    r"(\d+)\s*(?:\.|st|nd|rd|th)?\s*(?:og|obergeschoss|stock|etage|floor)"
    r"|(?:og|obergeschoss|stock|etage|floor)\s*(\d+)"
)


# Floor names that mean "this is not a storey at all". Home Assistant has
# no such concept, so a user who wants a garden or a network diagram puts
# it where floors go -- and it lands between the cellar and the ground
# floor as if you could walk down into the front garden.
_VIRTUAL_FLOOR_WORDS = frozenset(
    {
        "cloud", "wolke", "internet", "vpn", "netz", "netzwerk", "network",
        "server", "online", "virtuell", "virtual", "extern", "external",
        "web", "lan", "wan",
    }
)


def floor_kind(name: str, stated: str | None = None) -> AreaKind | None:
    """Is this "floor" a storey, the outdoors, or something virtual?

    A stated kind always wins -- the editor is where the user corrects a
    guess, and a correction that gets re-guessed every refresh is not a
    correction. Otherwise the name decides, and a name that says nothing
    stays ``None``: an ordinary storey needs no opinion.

    This is deliberately a *floor* question and not the per-area one. A
    floor called "Draußen" holding areas called "Autos" and "Gartenhütte"
    is entirely normal, and asking each area on its own gets one of them
    right and leaves the storey half-dissolved -- a garden that is still a
    floor, with two rooms left on it.
    """
    if stated is not None:
        return AreaKind.parse(stated)
    words = set(_fold(name).split())
    if words & _VIRTUAL_FLOOR_WORDS:
        return AreaKind.VIRTUAL
    if any(word in _OUTDOOR_WORDS for word in words):
        return AreaKind.OUTDOOR
    return None


def floor_level(name: str, stated: int | None = None) -> int | None:
    """The storey a floor sits on, from its level or failing that its name.

    A stated level always wins, including a stated zero: the user filled
    the field in and that is the end of the discussion. Only the floors
    Home Assistant has no level for are guessed at, and a floor whose name
    says nothing stays ``None`` so the caller can keep treating it as
    ground rather than inventing a storey for it.
    """
    if stated is not None:
        return stated
    folded = _fold(name)
    words = set(folded.split())
    for names, level in _FLOOR_LEVELS:
        if words & names:
            return level
    match = _FLOOR_NUMBER.search(folded)
    if match:
        return int(match.group(1) or match.group(2))
    return None


def async_floors(hass: HomeAssistant) -> list[dict[str, Any]]:
    """Floors from the floor registry, ordered as the user sorted them."""
    try:
        registry = fr.async_get(hass)
    except (AttributeError, KeyError):  # HA < 2024.4 has no floor registry
        return []
    floors = [
        {
            "id": floor.floor_id,
            "name": floor.name,
            "level": floor_level(floor.name, floor.level),
            "icon": floor.icon or "",
        }
        for floor in registry.async_list_floors()
    ]
    floors.sort(key=lambda floor: (floor["level"] or 0, floor["name"]))
    return floors


def async_areas(hass: HomeAssistant) -> list[dict[str, Any]]:
    """Areas from the area registry, with a guess at what each one is.

    Positions come later, from :func:`async_arrange_areas`: whether an area
    is a room or a garden decides where it goes, and the user is allowed to
    overrule that guess, so the arranging cannot happen until the hub has
    merged the stored overrides in.
    """
    registry = ar.async_get(hass)
    areas = sorted(registry.async_list_areas(), key=lambda area: area.name)
    return [
        {
            "id": area.id,
            "name": area.name,
            "floor_id": getattr(area, "floor_id", None),
            "icon": getattr(area, "icon", "") or "",
            "kind": area_kind(area.name, getattr(area, "icon", "") or "").value,
            "auto": True,
        }
        for area in areas
    ]


def async_arrange_areas(
    areas: list[dict[str, Any]],
    ground_floor_id: str | None = None,
) -> None:
    """Give every area without a position an automatic one, in place.

    Rooms get the squarest grid that fits the storey. Virtual areas get the
    soil: the same ring a garden gets, one storey further down, because
    the internet comes out of the ground beside the house and not out of
    the sky above it.

    Outdoor areas depend on which storey they are on, and that is the whole
    reason `ground_floor_id` is here. On the ground floor, outdoor space is
    the garden: an apron *around* the house, because that is where a garden
    is. One storey up it is a balcony, and a balcony hangs on one wall --
    it does not wrap around the flat. Laid out as an apron it came out as a
    band of terrace running past both flanks of the house and out the far
    side, which is not a balcony but a moat.

    Without a ground floor named, everything outdoor is treated as garden,
    which is what this function did before it could tell the difference.
    """
    by_plane: dict[tuple[str | None, str], list[dict[str, Any]]] = {}
    for area in areas:
        kind = AreaKind.parse(area.get("kind"), AreaKind.INDOOR)
        by_plane.setdefault((area.get("floor_id"), kind.value), []).append(area)

    for (floor_id, kind), plane_areas in by_plane.items():
        outdoors = by_plane.get((floor_id, AreaKind.OUTDOOR.value), [])
        virtuals = by_plane.get((floor_id, AreaKind.VIRTUAL.value), [])
        upstairs = ground_floor_id is not None and floor_id != ground_floor_id

        # Garten und Erdreich teilen sich einen Ring. Ein Ring hat seine
        # Plaetze nur einmal -- rechnet jede Art fuer sich aus, wie viele
        # es sind, bekommen beide denselben Platz und stehen uebereinander.
        # Deshalb steht die Gesamtzahl hier und nicht in der Schleife.
        ring_total = len(outdoors) + len(virtuals)

        if kind == AreaKind.VIRTUAL.value:
            # Hinter dem, was schon draussen liegt: das Erdreich nimmt die
            # Plaetze, die der Garten uebrig laesst.
            placer, first, total = _apron_cell, len(outdoors), ring_total
        elif kind == AreaKind.OUTDOOR.value:
            # Ein Balkon haengt an einer Wand, ein Garten liegt ringsum --
            # ausser auf der Etage mit dem Erdreich. Das ist die unterste,
            # und dort haengt nichts an der Wand.
            if upstairs and not virtuals:
                placer, first, total = _balcony_cell, 0, len(plane_areas)
            else:
                placer, first, total = _apron_cell, 0, ring_total
        else:
            placer, first, total = _grid_cell, 0, len(plane_areas)

        for index, area in enumerate(plane_areas):
            position, size = placer(index + first, total)
            area.setdefault("position", position.as_dict())
            area.setdefault("size", size)


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
    device_id = getattr(entry, "device_id", None) if entry else None
    if entry is not None and not area_id and device_id:
        # The entity inherits its device's area unless it overrides it.
        try:
            device = dr.async_get(hass).async_get(device_id)
            area_id = getattr(device, "area_id", None) if device else None
        except (AttributeError, KeyError):  # pragma: no cover
            area_id = None
    if area_id:
        defaults["area_id"] = area_id
    # The device behind the entity, so a renderer can offer "open the
    # device in Home Assistant" without guessing a URL from a name.
    if device_id:
        defaults["device_id"] = device_id

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
    # Last resort, and the reason devices stopped being anonymous dots: an
    # entity nobody gave an icon still *is* a light, a door or a router.
    defaults.setdefault(
        "icon",
        fallback_icon(
            entity_id,
            str(
                (state.attributes.get("device_class") if state is not None else "")
                or getattr(entry, "device_class", None)
                or getattr(entry, "original_device_class", None)
                or ""
            ),
        ),
    )
    return defaults


def async_device_entities(
    hass: HomeAssistant, device_id: str, limit: int = 30
) -> list[dict[str, str]]:
    """The entities of one device, for a renderer's "show entities" list."""
    try:
        registry = er.async_get(hass)
        entries = er.async_entries_for_device(
            registry, device_id, include_disabled_entities=False
        )
    except (AttributeError, KeyError, TypeError):  # pragma: no cover
        return []
    listed = []
    for entry in entries[:limit]:
        state = hass.states.get(entry.entity_id) if hasattr(hass, "states") else None
        listed.append(
            {
                "entity_id": entry.entity_id,
                "name": (
                    entry.name
                    or entry.original_name
                    or (state.attributes.get("friendly_name") if state else "")
                    or entry.entity_id
                ),
                "state": state.state if state is not None else "",
            }
        )
    return listed


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


def _apron_cell(index: int, total: int) -> tuple[Position, dict[str, float]]:
    """Lay an outdoor area out in the ring around the ground floor.

    Four sides, filled in the order somebody would name them: front, back,
    then the two flanks. Everything sits outside 0..1, which is exactly
    what makes it read as *around* the house instead of inside it.
    """
    margin = OUTDOOR_MARGIN
    span = 1.0 + 2 * margin
    sides = ["top", "bottom", "left", "right"]
    counts = [total // 4 + (1 if position < total % 4 else 0) for position in range(4)]

    seen = 0
    for side, count in zip(sides, counts):
        if not count:
            continue
        if index < seen + count:
            slot = index - seen
            if side in ("top", "bottom"):
                width = span / count
                centre = Position(
                    x=-margin + (slot + 0.5) * width,
                    y=-margin / 2 if side == "top" else 1 + margin / 2,
                )
                return centre, {"width": width * 0.9, "height": margin * 0.8}
            height = 1.0 / count
            centre = Position(
                x=-margin / 2 if side == "left" else 1 + margin / 2,
                y=(slot + 0.5) * height,
            )
            return centre, {"width": margin * 0.8, "height": height * 0.9}
        seen += count

    return Position(x=0.5, y=1 + margin / 2), {"width": 0.3, "height": margin * 0.8}


def _balcony_cell(index: int, total: int) -> tuple[Position, dict[str, float]]:
    """Hang an outdoor area on one wall of an upper storey.

    Not the ring that a garden gets: a balcony is attached to the flat, so
    it stays inside the house's own width and sticks out on one side only.
    The near wall first, because a balcony that ends up behind the storey
    is drawn but not seen; a second one goes on the far wall rather than
    beside the first.
    """
    margin = OUTDOOR_MARGIN
    near = math.ceil(total / 2) or 1
    on_the_near_wall = index < near
    slot = index if on_the_near_wall else index - near
    count = near if on_the_near_wall else max(1, total - near)
    width = 1.0 / count
    return (
        Position(
            x=(slot + 0.5) * width,
            y=1 + margin / 2 if on_the_near_wall else -margin / 2,
        ),
        {"width": width * 0.8, "height": margin * 0.8},
    )


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
    area_centres = {area["id"]: area["position"] for area in areas if area.get("position")}
    area_sizes = {area["id"]: area.get("size") or {} for area in areas}
    area_floors = {area["id"]: area["floor_id"] for area in areas}

    # Ein Knoten ohne eigenen Bereich, der Anker hat, erbt den Bereich
    # seines staerksten Ankers. Das muss vor der Platzierung geschehen,
    # denn Bereich heisst Etage, und die Etage entscheidet, auf welchem
    # Blatt der Punkt ueberhaupt landet.
    _inherit_from_anchors(nodes)

    per_area: dict[str | None, list[Node]] = {}
    anchored: list[Node] = []
    for node in nodes:
        if node.area_id and not node.floor_id:
            node.floor_id = area_floors.get(node.area_id)
        if node.position is not None:
            continue
        if node.anchors:
            # Erst platzieren, wenn die Anker liegen -- sie sind der
            # Bezugspunkt.
            anchored.append(node)
        else:
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

        # A node in the garden may sit outside the house rectangle -- that
        # is the whole point of the apron, so it must not be clamped back in.
        #
        # Das Erdreich liegt in demselben Ring, also gilt es dort genauso.
        # Ohne diese Zeile landet der Router im Haus statt an dem Anschluss,
        # zu dem er gehoert -- und zwar stumm, weil Klemmen kein Fehler ist.
        outdoor = any(
            area["id"] == area_id
            and AreaKind.parse(area.get("kind"))
            in (AreaKind.OUTDOOR, AreaKind.VIRTUAL)
            for area in areas
        )
        low = -OUTDOOR_MARGIN if outdoor else 0.0
        high = 1.0 + OUTDOOR_MARGIN if outdoor else 1.0

        for index, (fx, fy) in enumerate(_grid_offsets(count)):
            node = area_nodes[index]
            node.position = Position(
                x=_clamp(base_x + fx * width, low, high),
                y=_clamp(base_y + fy * height, low, high),
            )
            if count > 1 or not centre:
                node.metadata = {**node.metadata, "auto_position": True}

    _place_anchored(anchored, nodes)


def _inherit_from_anchors(nodes: list[Node]) -> None:
    """Bereichslose Knoten in den Raum ihres staerksten Ankers setzen.

    Ein BLE-Anhaenger hat keinen Bereich -- niemand traegt fuer einen
    Schluesselbund einen Raum ein. Was es hat, ist eine Messung: der
    Proxy in der Kueche hoert ihn mit -55 dBm, der im Keller mit -88.
    Damit *ist* er in der Kueche, und das weiss der Anbieter besser als
    jede Eintragung.

    Nur der staerkste zaehlt, nicht ein Mittel: ein Raum ist keine Groesse,
    ueber die sich mitteln laesst. Zwischen Kueche und Keller liegt kein
    halber Raum.
    """
    nach_id = {node.id: node for node in nodes}
    for node in nodes:
        if node.area_id or not node.anchors:
            continue
        bester = max(node.anchors, key=lambda a: a["weight"])
        ziel = nach_id.get(bester["id"])
        if ziel is None or not ziel.area_id:
            continue
        node.area_id = ziel.area_id
        node.floor_id = node.floor_id or ziel.floor_id
        # Angeschrieben, damit ein Renderer den Unterschied zeigen kann:
        # dieser Raum ist gemessen, kein Eintrag des Nutzers.
        node.metadata = {**node.metadata, "area_from_anchor": ziel.id}


def _place_anchored(anchored: list[Node], nodes: list[Node]) -> None:
    """Knoten ins gewichtete Mittel ihrer Anker legen.

    Das ist der Schritt vom Netzplan zum Grundriss. Eine Kante sagt "die
    beiden reden miteinander"; ein Anker sagt "der eine ist beim anderen",
    und aus mehreren Ankern mit Gewicht wird ein Ort.

    Bewusst kein Mehrwege-Aufloesen: ein Anker, dessen Ziel selbst nur
    ueber Anker liegt, wird uebersprungen. Zwei Knoten, die sich
    gegenseitig ankern, haetten sonst keine Loesung -- und eine Kette
    ueber fuenf Ecken traegt am Ende keine Messung mehr, sondern nur noch
    aufaddierte Ungenauigkeit.
    """
    if not anchored:
        return
    fest = {
        node.id: node.position
        for node in nodes
        if node.position is not None and not node.anchors
    }
    for node in anchored:
        summe_x = summe_y = gewichte = 0.0
        genutzt = 0
        for anker in node.anchors:
            ort = fest.get(anker["id"])
            if ort is None:
                continue
            gewicht = anker["weight"]
            summe_x += ort.x * gewicht
            summe_y += ort.y * gewicht
            gewichte += gewicht
            genutzt += 1
        if not gewichte:
            # Kein Anker liegt irgendwo -- der Knoten faellt zurueck auf
            # die Mitte, wie jeder andere ortlose auch. Nichts zu zeichnen
            # waere schlechter: das Geraet gibt es ja.
            node.position = Position(x=0.5, y=0.5)
            node.metadata = {**node.metadata, "auto_position": True}
            continue
        node.position = Position(
            x=_clamp(summe_x / gewichte, -OUTDOOR_MARGIN, 1.0 + OUTDOOR_MARGIN),
            y=_clamp(summe_y / gewichte, -OUTDOOR_MARGIN, 1.0 + OUTDOOR_MARGIN),
        )
        node.metadata = {
            **node.metadata,
            "auto_position": True,
            # Wie viele Messungen hinter dem Punkt stehen. Einer ist eine
            # Richtung, drei sind ein Ort -- und der Nutzer soll den
            # Unterschied sehen koennen, bevor er sich darauf verlaesst.
            "anchored_by": genutzt,
        }


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


def _clamp(value: float, low: float = 0.0, high: float = 1.0) -> float:
    return min(high, max(low, value))
