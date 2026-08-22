"""Ein Demohaus, durch den echten Hub gedreht, als Modell auf stdout.

Für die Bilder in der README. Kein von Hand geschriebenes JSON: Dieses
Skript startet den wirklichen :class:`SpatialHub` mit den wirklichen
Registry-Stubs aus ``tests/``, sodass das Auflösen der Etagen, das Raten
der Bereichsart, die automatische Anordnung und das Setzen der Nodes
dieselben sind, die auch im Haus laufen. Ein Bild, das aus einem
handgeschriebenen Modell entsteht, zeigt, was jemand malen wollte; dieses
zeigt, was der Hub tut.

    python3 tools/demo_house.py > /tmp/demo.json
    node tools/shots.mjs /tmp/demo.json docs/images

Das Haus ist bewusst klein und aufgeräumt: fünf bis sechs Bereiche je
Etage, ein gutes Dutzend Geräte. Ein echtes Haus mit dreißig Bereichen
belastet den Renderer mehr, aber ein Bild, auf dem sich die Beschriftungen
überlagern, wirbt für nichts.

Die Icons kommen als eigener Zeichensatz des Providers mit, nicht als
``mdi:``-Name. Auf dem Bild steht dann wirklich, was der Renderer zeichnet,
und nicht das, was das Icon-Element von Home Assistant daraus gemacht
hätte -- das gibt es hier nämlich nicht.
"""

from __future__ import annotations

import asyncio
import json
import sys
from pathlib import Path

HUB = Path(__file__).resolve().parent.parent
sys.path[:0] = [str(HUB), str(HUB / "tests")]

import conftest  # noqa: F401,E402  - installs the Home Assistant stubs
from conftest import FakeArea, FakeFloor  # noqa: E402
from homeassistant.core import HomeAssistant  # noqa: E402
from homeassistant.helpers import area_registry as ar  # noqa: E402
from homeassistant.helpers import floor_registry as fr  # noqa: E402

from custom_components.spatial_hub.const import (  # noqa: E402
    API_VERSION,
    CURRENT_SDK_VERSION,
    DATA_PROVIDERS,
)
from custom_components.spatial_hub.hub import SpatialHub  # noqa: E402
from custom_components.spatial_hub.storage import LayoutStore  # noqa: E402

FLOORS = [
    FakeFloor("ug", "Untergeschoss", level=-1),
    FakeFloor("eg", "Erdgeschoss", level=0),
    FakeFloor("og", "Obergeschoss", level=1),
    # Keine Etage, sondern der Weg, auf dem ein Benutzer heute sagt "das
    # ist nicht im Haus": eine erfundene Etage namens "Netz". Der Hub
    # erkennt sie am Namen, loest sie auf und legt, was darauf lag, ins
    # Erdreich um das Untergeschoss. Genau dort kommt der Anschluss an.
    FakeFloor("netz", "Netz", level=9),
]

AREAS = [
    FakeArea("wohnzimmer", "Wohnzimmer", "eg"),
    FakeArea("kueche", "Küche", "eg"),
    FakeArea("esszimmer", "Esszimmer", "eg"),
    FakeArea("diele", "Diele", "eg"),
    FakeArea("wc", "Gäste-WC", "eg"),
    FakeArea("terrasse", "Terrasse", "eg"),
    FakeArea("schlafzimmer", "Schlafzimmer", "og"),
    FakeArea("kinderzimmer", "Kinderzimmer", "og"),
    FakeArea("bad", "Bad", "og"),
    FakeArea("arbeitszimmer", "Arbeitszimmer", "og"),
    FakeArea("balkon", "Balkon", "og"),
    FakeArea("keller", "Keller", "ug"),
    FakeArea("heizraum", "Heizraum", "ug"),
    FakeArea("waschkueche", "Waschküche", "ug"),
    FakeArea("anschluss", "Hausanschluss", "netz"),
    FakeArea("vpn", "VPN", "netz"),
]

# Ein Zeichensatz, wie ihn ein Provider mitliefert: fertiges SVG, das der
# Renderer unveraendert einsetzt. Absichtlich schlicht -- es geht um das
# Haus, nicht um die Symbole.
ICONS = {
    "demo:adapter": {
        "svg": (
            '<svg viewBox="0 0 24 24">'
            '<rect x="5" y="4" width="14" height="16" rx="3" fill="none"'
            ' stroke="currentColor" stroke-width="1.8"/>'
            '<circle cx="9" cy="8.5" r="1.1" fill="currentColor"/>'
            '<circle cx="15" cy="8.5" r="1.1" fill="currentColor"/>'
            '<rect x="8" y="12" width="8" height="5" rx="1.4"'
            ' fill="currentColor" opacity="0.25"/></svg>'
        )
    },
    "demo:sensor": {
        "svg": (
            '<svg viewBox="0 0 24 24">'
            '<circle cx="12" cy="12" r="7.4" fill="none"'
            ' stroke="currentColor" stroke-width="1.8"/>'
            '<path d="M12 7.6V12l3 2.2" fill="none" stroke="currentColor"'
            ' stroke-width="1.8" stroke-linecap="round"/></svg>'
        )
    },
    "demo:light": {
        "svg": (
            '<svg viewBox="0 0 24 24">'
            '<path d="M12 3.4a5.6 5.6 0 0 0-3.2 10.2v2.2h6.4v-2.2A5.6 5.6 0'
            ' 0 0 12 3.4z" fill="none" stroke="currentColor"'
            ' stroke-width="1.8" stroke-linejoin="round"/>'
            '<path d="M10 18.6h4" stroke="currentColor" stroke-width="1.8"'
            ' stroke-linecap="round"/></svg>'
        )
    },
}

# (id, Beschriftung, Bereich, Icon, Zustand)
NODES = [
    ("cco", "Adapter Keller", "keller", "demo:adapter", "online"),
    ("pl-wohn", "Adapter Wohnzimmer", "wohnzimmer", "demo:adapter", "online"),
    ("pl-buero", "Adapter Arbeitszimmer", "arbeitszimmer", "demo:adapter", "online"),
    ("pl-kind", "Adapter Kinderzimmer", "kinderzimmer", "demo:adapter", "offline"),
    ("t-wohn", "Thermostat", "wohnzimmer", "demo:sensor", "online"),
    ("t-bad", "Thermostat", "bad", "demo:sensor", "online"),
    ("t-schlaf", "Thermostat", "schlafzimmer", "demo:sensor", "online"),
    ("t-heiz", "Heizung", "heizraum", "demo:sensor", "online"),
    ("l-esszimmer", "Esstischlampe", "esszimmer", "demo:light", "online"),
    ("l-kueche", "Küchenlicht", "kueche", "demo:light", "online"),
    ("l-terrasse", "Terrassenlicht", "terrasse", "demo:light", "offline"),
    ("l-diele", "Dielenlicht", "diele", "demo:light", "online"),
    ("w-wasch", "Waschmaschine", "waschkueche", "demo:sensor", "online"),
]

# Die Kanten gehen sternfoermig vom Adapter im Keller aus -- der Fall, fuer
# den die Hausansicht ueberhaupt da ist: eine Verbindung, die zwei
# Stockwerke verbindet, ist in keiner Einzelansicht zu sehen.
EDGES = [
    ("cco", "pl-wohn", "good"),
    ("cco", "pl-buero", "fair"),
    ("cco", "pl-kind", "poor"),
]


def register(hass) -> None:
    hass.data.setdefault(DATA_PROVIDERS, {})["demo"] = {
        "provider_id": "demo",
        "name": "Demo",
        "icon": "mdi:home-lightning-bolt-outline",
        "api_version": API_VERSION,
        "sdk_version": CURRENT_SDK_VERSION,
        "capabilities": {"nodes": True, "edges": True},
        "layers": [{"id": "demo_layer", "name": "Demo", "z_index": 10}],
        "icon_set": ICONS,
        "data": lambda: {
            "nodes": [
                {
                    "id": node_id,
                    "label": label,
                    "area_id": area,
                    "icon": icon,
                    "state": state,
                }
                for node_id, label, area, icon, state in NODES
            ],
            "edges": [
                {
                    "id": f"{source}__{target}",
                    "source": source,
                    "target": target,
                    "quality": quality,
                    "dashed": True,
                }
                for source, target, quality in EDGES
            ],
        },
    }


# Tueren und Fenster, wie ein Benutzer sie setzt. Kante 0 ist hinten, 1
# rechts, 2 vorne, 3 links; `at` ist die Mitte auf der Kante und `width`
# ihr Anteil daran. Bewusst nur ein paar Raeume -- ein Haus, in dem jede
# Wand eine Oeffnung hat, zeigt nicht, wie eine Oeffnung aussieht,
# sondern wie ein Sieb aussieht.
OPENINGS = {
    "wohnzimmer": [
        {"side": 2, "at": 0.35, "width": 0.34, "kind": "window"},
        {"side": 1, "at": 0.5, "width": 0.2, "kind": "door"},
    ],
    "kueche": [
        {"side": 2, "at": 0.5, "width": 0.3, "kind": "window"},
        {"side": 0, "at": 0.6, "width": 0.2, "kind": "door"},
    ],
    "diele": [
        {"side": 3, "at": 0.5, "width": 0.24, "kind": "door"},
        {"side": 0, "at": 0.5, "width": 0.2, "kind": "door"},
    ],
    "schlafzimmer": [
        {"side": 2, "at": 0.5, "width": 0.36, "kind": "window"},
        {"side": 3, "at": 0.4, "width": 0.2, "kind": "door"},
    ],
    "bad": [
        {"side": 0, "at": 0.5, "width": 0.22, "kind": "window"},
        {"side": 2, "at": 0.5, "width": 0.2, "kind": "door"},
    ],
}


async def main() -> None:
    hass = HomeAssistant()
    fr.async_get(hass).floors = FLOORS
    ar.async_get(hass).areas = AREAS
    register(hass)

    hub = SpatialHub(hass, LayoutStore(hass))
    for area_id, doors in OPENINGS.items():
        hub.store.update("areas", area_id, {"doors": doors})
    model = await hub.async_model()
    json.dump(model, sys.stdout, indent=1, default=str)


asyncio.run(main())
