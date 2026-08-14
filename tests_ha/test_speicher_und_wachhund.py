"""Der Speicher und der Wachhund -- beide haengen an Home Assistant selbst.

Der Speicher schreibt ueber ``homeassistant.helpers.storage.Store`` und
verlaesst sich auf dessen verzoegertes Sichern. Der Wachhund horcht auf
vier Ereignisnamen, die im Quelltext als blosse Zeichenketten stehen.
Beides kann eine Attrappe nur bestaetigen, nie widerlegen.
"""

from __future__ import annotations

from datetime import timedelta

import pytest
from homeassistant.core import HomeAssistant
from homeassistant.helpers import area_registry as ar, floor_registry as fr
from homeassistant.util import dt as dt_util

from pytest_homeassistant_custom_component.common import async_fire_time_changed

from custom_components.spatial_hub.const import DATA_HUB, DATA_STORE, STORAGE_KEY
from custom_components.spatial_hub.storage import LayoutStore
from custom_components.spatial_hub.watch import DEBOUNCE_SECONDS


async def _warten(hass: HomeAssistant, sekunden: float) -> None:
    """Die Uhr vorstellen und Home Assistant nachziehen lassen."""
    async_fire_time_changed(hass, dt_util.utcnow() + timedelta(seconds=sekunden))
    await hass.async_block_till_done()


# ── Speicher ──────────────────────────────────────────────────────────


async def test_arrangement_ueberlebt_einen_neustart(
    hass: HomeAssistant, eintrag, hass_storage
) -> None:
    """Was der Nutzer verschoben hat, muss den Neustart ueberstehen.

    Der ganze Sinn des Speichers: Anbieter besitzen ihre Daten, der Hub
    besitzt die Anordnung. Geht die Anordnung verloren, hat der Nutzer sein
    Haus umsonst gebaut. Hier laeuft der echte ``Store`` samt seinem
    verzoegerten Schreiben -- der Grund, warum die Uhr vorgestellt wird.
    """
    speicher: LayoutStore = hass.data[DATA_STORE]
    speicher.update("nodes", "demo:lampe", {"position": {"x": 0.25, "y": 0.75}})

    await _warten(hass, 5)
    assert STORAGE_KEY in hass_storage, "nichts geschrieben"

    # Ein zweiter Speicher auf demselben Bestand -- das ist der Neustart.
    frisch = LayoutStore(hass)
    await frisch.async_load()
    assert frisch.get("nodes", "demo:lampe")["position"] == {"x": 0.25, "y": 0.75}


async def test_zuruecksetzen_loescht_den_eintrag_auch_auf_der_platte(
    hass: HomeAssistant, eintrag, hass_storage
) -> None:
    """``None`` heisst zuruecksetzen -- und muss auch geschrieben werden.

    Ein Zuruecksetzen, das nur im Arbeitsspeicher wirkt, kommt nach dem
    naechsten Neustart wieder. Das waere die aergerlichste Sorte Fehler:
    der Nutzer korrigiert etwas, es sieht richtig aus, und morgen ist es
    wieder falsch.
    """
    speicher: LayoutStore = hass.data[DATA_STORE]
    speicher.update("areas", "kueche", {"color": "#ff0000"})
    await _warten(hass, 5)

    speicher.update("areas", "kueche", {"color": None})
    await _warten(hass, 5)

    frisch = LayoutStore(hass)
    await frisch.async_load()
    assert frisch.get("areas", "kueche") == {}


# ── Wachhund ──────────────────────────────────────────────────────────


async def test_wachhund_merkt_wenn_ein_bereich_entsteht(
    hass: HomeAssistant, eintrag
) -> None:
    """Die vier Ereignisnamen im Wachhund sind blosse Zeichenketten.

    ``area_registry_updated`` und die drei Geschwister stehen als Literale
    im Quelltext. Benennt Home Assistant eines davon um, horcht der Hub
    weiter auf ein Ereignis, das niemand mehr sendet: der Grundriss folgt
    dem Haus nicht mehr, es gibt keine Fehlermeldung, und der einzige
    Hinweis ist, dass ein umbenannter Raum alt bleibt, bis jemand neu
    laedt. Genau dieser Test faellt dann um.
    """
    hub = hass.data[DATA_HUB]
    gemeldet: list[str] = []
    abmelden = hub.async_add_listener(gemeldet.append)

    ar.async_get(hass).async_create("Werkstatt")
    await hass.async_block_till_done()

    # Vor dem Ablauf der Entprellung darf noch nichts passiert sein: ein
    # Modellaufbau pro Ereignis waere bei einer Umbenennung ein halbes
    # Dutzend Aufbauten hintereinander.
    assert gemeldet == []

    await _warten(hass, DEBOUNCE_SECONDS + 1)
    abmelden()

    assert gemeldet, "der Wachhund hat das Bereichsregister nicht gehoert"
    assert any("registry" in grund for grund in gemeldet)


async def test_wachhund_merkt_auch_eine_neue_etage(
    hass: HomeAssistant, eintrag
) -> None:
    """Dasselbe fuer das Etagenregister -- ein eigenes Ereignis."""
    hub = hass.data[DATA_HUB]
    gemeldet: list[str] = []
    abmelden = hub.async_add_listener(gemeldet.append)

    fr.async_get(hass).async_create("Dachgeschoss")
    await hass.async_block_till_done()
    await _warten(hass, DEBOUNCE_SECONDS + 1)
    abmelden()

    assert gemeldet, "der Wachhund hat das Etagenregister nicht gehoert"


async def test_mehrere_aenderungen_ergeben_einen_aufbau(
    hass: HomeAssistant, eintrag
) -> None:
    """Eine Nutzeraktion feuert mehrere Registerereignisse.

    Einen Raum umzubenennen loest im echten Home Assistant mehr als ein
    Ereignis aus. Ohne Entprellung baut der Hub das Modell mehrfach neu und
    schickt jedem Renderer denselben Grundriss mehrfach hinterher.
    """
    hub = hass.data[DATA_HUB]
    gemeldet: list[str] = []
    abmelden = hub.async_add_listener(gemeldet.append)

    register = ar.async_get(hass)
    bereich = register.async_create("Abstellkammer")
    register.async_update(bereich.id, name="Speisekammer")
    register.async_update(bereich.id, icon="mdi:food-apple")
    await hass.async_block_till_done()

    await _warten(hass, DEBOUNCE_SECONDS + 1)
    abmelden()

    assert len(gemeldet) == 1, f"{len(gemeldet)} Aufbauten statt einem: {gemeldet}"


async def test_wachhund_schweigt_nach_dem_entladen(
    hass: HomeAssistant, eintrag
) -> None:
    """Ein Wachhund, der das Entladen ueberlebt, horcht auf einen toten Hub."""
    hub = hass.data[DATA_HUB]
    gemeldet: list[str] = []
    hub.async_add_listener(gemeldet.append)

    assert await hass.config_entries.async_unload(eintrag.entry_id)
    await hass.async_block_till_done()

    ar.async_get(hass).async_create("Nach dem Entladen")
    await _warten(hass, DEBOUNCE_SECONDS + 1)

    assert gemeldet == []
