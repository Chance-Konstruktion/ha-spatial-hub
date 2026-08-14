"""Gemeinsame Vorrichtungen fuer die Tests gegen ein echtes Home Assistant.

Der Unterschied zu ``tests/`` ist der ganze Zweck dieses Ordners: dort
ersetzt die conftest.py das Paket ``homeassistant`` in ``sys.modules``
durch Attrappen, hier laeuft eine echte Instanz. Was eine Attrappe nicht
beweisen kann, gehoert hierher -- allen voran alles, was ein Register,
den Ereignisbus oder den Speicher anfasst.
"""

from __future__ import annotations

import pytest
from homeassistant.core import HomeAssistant
from homeassistant.helpers import (
    area_registry as ar,
    device_registry as dr,
    entity_registry as er,
    floor_registry as fr,
)

from pytest_homeassistant_custom_component.common import MockConfigEntry

from custom_components.spatial_hub.const import DOMAIN


@pytest.fixture(autouse=True)
def eigene_integrationen(enable_custom_integrations):
    """Ohne das findet Home Assistant custom_components/ gar nicht erst."""
    yield


@pytest.fixture
async def eintrag(hass: HomeAssistant) -> MockConfigEntry:
    """Ein eingerichteter Hub -- der Normalzustand fuer die meisten Tests."""
    eintrag = MockConfigEntry(domain=DOMAIN, title="Spatial Hub", data={})
    eintrag.add_to_hass(hass)
    assert await hass.config_entries.async_setup(eintrag.entry_id)
    await hass.async_block_till_done()
    return eintrag


@pytest.fixture
async def haus(hass: HomeAssistant, eintrag: MockConfigEntry) -> dict:
    """Ein kleines, echtes Haus in den echten Registern.

    Erdgeschoss mit Kueche, Obergeschoss mit Schlafzimmer, ein Garten ohne
    Etage -- und ein Geraet mit zwei Entitaeten, damit die Vererbung
    Geraet -> Entitaet geprueft werden kann. Alles ueber die oeffentlichen
    Register-Methoden angelegt, nicht per Hand in die Datenstrukturen
    geschrieben: nur so laeuft derselbe Code wie im Betrieb.
    """
    etagen = fr.async_get(hass)
    bereiche = ar.async_get(hass)
    geraete = dr.async_get(hass)
    entitaeten = er.async_get(hass)

    erdgeschoss = etagen.async_create("Erdgeschoss", level=0, icon="mdi:home")
    # Bewusst ohne Stockwerksnummer: der Hub soll sie aus dem Namen raten,
    # und genau das prueft ein Test weiter unten nach.
    obergeschoss = etagen.async_create("1. OG")

    kueche = bereiche.async_create("Küche", floor_id=erdgeschoss.floor_id)
    schlafzimmer = bereiche.async_create(
        "Schlafzimmer", floor_id=obergeschoss.floor_id
    )
    garten = bereiche.async_create("Garten")

    # Das Geraet haengt an einem eigenen Eintrag, nicht am Hub: ein Geraet
    # des Hubs waere ein Sonderfall, den es im Betrieb nicht gibt.
    fremd = MockConfigEntry(domain="demo", title="Demo", data={})
    fremd.add_to_hass(hass)

    geraet = geraete.async_get_or_create(
        config_entry_id=fremd.entry_id,
        identifiers={("demo", "lampe-1")},
        name="Deckenlampe",
        manufacturer="Chance",
        model="CL-1",
    )
    geraete.async_update_device(geraet.id, area_id=kueche.id)

    # Diese Entitaet sagt selbst nichts ueber ihren Bereich -- sie soll ihn
    # vom Geraet erben.
    lampe = entitaeten.async_get_or_create(
        "light", "demo", "lampe-1",
        device_id=geraet.id,
        original_name="Deckenlampe",
        suggested_object_id="deckenlampe",
    )
    # Zweite Entitaet am selben Geraet, damit die Geraeteliste im Aufklapper
    # mehr als einen Eintrag hat.
    verbrauch = entitaeten.async_get_or_create(
        "sensor", "demo", "lampe-1-leistung",
        device_id=geraet.id,
        original_name="Deckenlampe Leistung",
        original_device_class="power",
        suggested_object_id="deckenlampe_leistung",
    )

    hass.states.async_set(lampe.entity_id, "on", {"friendly_name": "Deckenlampe"})
    hass.states.async_set(verbrauch.entity_id, "7.5", {"device_class": "power"})
    await hass.async_block_till_done()

    return {
        "eintrag": eintrag,
        "fremd": fremd,
        "erdgeschoss": erdgeschoss,
        "obergeschoss": obergeschoss,
        "kueche": kueche,
        "schlafzimmer": schlafzimmer,
        "garten": garten,
        "geraet": geraet,
        "lampe": lampe.entity_id,
        "verbrauch": verbrauch.entity_id,
    }
