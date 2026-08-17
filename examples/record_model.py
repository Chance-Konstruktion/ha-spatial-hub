"""Record one `spatial_hub/model` answer as a file.

A renderer author without a Home Assistant install has nothing to draw.
Handing them a hand-written JSON file would be worse than nothing: they
would build against a fiction, and every mistake in my imagination would
become a mistake in their renderer.

So the recording is produced by the hub's own model assembly, through the
same test stubs the suite uses. What comes out is what the websocket
sends -- not a description of it.

    python examples/record_model.py > modell.json

Regenerate it whenever the model changes; that is the point of shipping
the recorder rather than only the recording.
"""

from __future__ import annotations

import asyncio
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "tests"))

import conftest  # noqa: E402  - installs the Home Assistant stubs on import
from conftest import FakeArea, FakeFloor  # noqa: E402

from homeassistant.core import HomeAssistant  # noqa: E402
from homeassistant.helpers import (  # noqa: E402
    area_registry as ar,
    floor_registry as fr,
)

from custom_components.spatial_hub.hub import SpatialHub  # noqa: E402
from custom_components.spatial_hub.storage import LayoutStore  # noqa: E402

# A house worth drawing: three storeys, rooms of different sizes, and
# devices that are not spread evenly. A renderer that only ever sees a
# tidy example gets the tidy case right and nothing else.
FLOORS = [
    ("keller", "Keller", -1),
    ("eg", "Erdgeschoss", 0),
    ("og", "Obergeschoss", 1),
]

AREAS = [
    ("heizungsraum", "Heizungsraum", "keller"),
    ("werkstatt", "Werkstatt", "keller"),
    ("wohnzimmer", "Wohnzimmer", "eg"),
    ("kueche", "Küche", "eg"),
    ("flur", "Flur", "eg"),
    ("gaeste_wc", "Gäste-WC", "eg"),
    ("schlafzimmer", "Schlafzimmer", "og"),
    ("kinderzimmer", "Kinderzimmer", "og"),
    ("bad", "Bad", "og"),
    ("buero", "Büro", "og"),
    # No floor at all. The hub puts these on a storey of their own, and a
    # renderer that filters by truthiness instead of by the floor it was
    # given draws them on top of a real one. That has happened here.
    ("abstellkammer", "Abstellkammer", None),
    # Also without a floor -- but recognised as outdoor space and placed on
    # the ground floor on purpose. Two areas, both floorless, two different
    # right answers: a renderer must take the floor it is given and not
    # work it out again.
    ("garage", "Garage", None),
]

NODES = [
    ("gw", "Router", "flur", "on", "good"),
    ("rep_og", "Repeater OG", "flur", "on", "fair"),
    ("rep_keller", "Repeater Keller", "heizungsraum", "on", "poor"),
    ("tv", "Fernseher", "wohnzimmer", "on", "good"),
    ("nas", "NAS", "buero", "on", "good"),
    ("drucker", "Drucker", "buero", "off", "fair"),
    ("waschmaschine", "Waschmaschine", "werkstatt", "off", "poor"),
    ("kessel", "Heizkessel", "heizungsraum", "on", "fair"),
    ("licht_kueche", "Licht Küche", "kueche", "on", ""),
    ("licht_bad", "Licht Bad", "bad", "off", ""),
    ("sensor_kind", "Fenstersensor", "kinderzimmer", "unavailable", ""),
    ("lade", "Wallbox", "garage", "on", "fair"),
    ("kamera", "Kamera", None, "on", ""),  # no area either
]

EDGES = [
    ("gw", "rep_og", "fair"),
    ("gw", "rep_keller", "poor"),
    ("rep_og", "nas", "good"),
    ("rep_og", "drucker", "fair"),
    ("rep_keller", "waschmaschine", "poor"),
    ("rep_keller", "kessel", "fair"),
    ("gw", "tv", "good"),
    ("gw", "lade", "fair"),
]


def _payload():
    nodes = []
    for node_id, label, area, state, quality in NODES:
        node = {"id": node_id, "label": label, "state": state}
        if area:
            node["area_id"] = area
        if quality:
            node["metadata"] = {"link": quality}
        nodes.append(node)
    edges = [
        {"id": f"{a}-{b}", "source": a, "target": b, "quality": q,
         "label": q, "directed": False}
        for a, b, q in EDGES
    ]
    return {"nodes": nodes, "edges": edges}


async def _model() -> dict:
    hass = HomeAssistant()
    hass.states = conftest.FakeStates()
    hass.http = conftest.FakeHttp()
    hass.bus = conftest.FakeBus()

    fr.async_get(hass).floors = [
        FakeFloor(fid, name, level=level) for fid, name, level in FLOORS
    ]
    ar.async_get(hass).areas = [
        FakeArea(aid, name, floor_id=floor) for aid, name, floor in AREAS
    ]

    hass.data.setdefault("spatial_hub_providers", {})["hausnetz"] = {
        "provider_id": "hausnetz",
        "name": "Hausnetz",
        "icon": "mdi:lan",
        "capabilities": {"nodes": True, "edges": True},
        "layers": [{"id": "hausnetz_layer", "name": "Netzwerk", "z_index": 10}],
        "data": _payload,
    }

    return await SpatialHub(hass, LayoutStore(hass)).async_model()


if __name__ == "__main__":
    print(json.dumps(asyncio.run(_model()), indent=2, ensure_ascii=False))
