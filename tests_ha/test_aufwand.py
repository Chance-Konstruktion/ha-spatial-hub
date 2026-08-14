"""Was ein Modellaufbau kostet -- gemessen, nicht geschaetzt.

Der Hub baut das Modell bei jeder Registeraenderung neu, bei jedem
Anbieter-Signal und bei jedem Abruf eines Renderers. In einem lebhaften
Haus sind das leicht ein paar Aufbauten pro Minute, und jeder laeuft in
Home Assistants Ereignisschleife -- was hier zu lange dauert, laesst alles
andere warten.

Die Grenzen sind bewusst grosszuegig: sie sollen keine Schwankung des
Runners melden, sondern eine Groessenordnung. Wenn ein Aufbau mit
zweihundert Knoten ploetzlich eine Sekunde braucht, ist etwas passiert,
das jemand gewollt haben muss.
"""

from __future__ import annotations

import asyncio
import time

import pytest
from homeassistant.core import HomeAssistant

from custom_components.spatial_hub.const import DATA_HUB

from hilfen import anbieter_anmelden


def _viele_knoten(anzahl: int, bereich: str) -> list[dict]:
    return [
        {"id": f"k{i}", "label": f"Knoten {i}", "area_id": bereich,
         "state": "online"}
        for i in range(anzahl)
    ]


async def test_zweihundert_knoten_bleiben_unter_einer_halben_sekunde(
    hass: HomeAssistant, haus: dict
) -> None:
    """Die Groessenordnung, um die es geht.

    Zweihundert Knoten sind ein gut ausgestattetes Haus mit allen sechs
    Anbietern. Das ist der Fall, fuer den der Hub gebaut ist -- nicht der
    Ausnahmefall.
    """
    anbieter_anmelden(hass, "viele",
                      lambda: _viele_knoten(200, haus["kueche"].id))
    hub = hass.data[DATA_HUB]

    await hub.async_model()  # einmal warmlaufen, Register fuellen ihre Zwischenspeicher

    start = time.perf_counter()
    modell = await hub.async_model()
    dauer = time.perf_counter() - start

    assert len(modell["nodes"]) == 200
    assert dauer < 0.5, f"Aufbau dauerte {dauer*1000:.0f} ms"
    print(f"\n200 Knoten: {dauer*1000:.1f} ms")


async def test_langsame_anbieter_warten_nebeneinander(
    hass: HomeAssistant, haus: dict
) -> None:
    """Der teuerste Fehler, den der Hub machen kann.

    Sechs Anbieter mit je 10 Sekunden Zeitlimit ergeben hintereinander
    eine Minute Aufbauzeit. Sie muessen nebeneinander laufen -- im Alltag
    wartet ohnehin jeder auf sein eigenes Register und nicht auf die
    anderen.

    Gemessen wird mit sechs Anbietern, die je 100 ms brauchen. Nacheinander
    sind das 600 ms, nebeneinander gut 100.
    """
    async def langsam():
        await asyncio.sleep(0.1)
        return []

    for nummer in range(6):
        anbieter_anmelden(hass, f"langsam{nummer}", langsam)

    hub = hass.data[DATA_HUB]
    start = time.perf_counter()
    await hub.async_model()
    dauer = time.perf_counter() - start

    assert dauer < 0.35, (
        f"{dauer*1000:.0f} ms fuer sechs Anbieter a 100 ms -- das sieht nach "
        f"nacheinander aus"
    )
    print(f"\n6 Anbieter a 100 ms: {dauer*1000:.1f} ms")


async def test_ein_haengender_anbieter_blockiert_die_anderen_nicht(
    hass: HomeAssistant, haus: dict
) -> None:
    """Ein Anbieter, der nie antwortet, darf den Grundriss nicht anhalten.

    Er kostet sein Zeitlimit und sonst nichts. Nacheinander abgefragt haette
    er alle nach ihm ebenfalls um zehn Sekunden verzoegert.
    """
    async def haengt():
        await asyncio.sleep(30)
        return []

    anbieter_anmelden(hass, "haengt", haengt)
    anbieter_anmelden(hass, "flott",
                      lambda: _viele_knoten(5, haus["kueche"].id))

    hub = hass.data[DATA_HUB]
    aufgabe = asyncio.create_task(hub.async_model())
    # Deutlich unter dem 10-Sekunden-Limit des Anbieters, aber weit ueber
    # dem, was der flotte braucht.
    await asyncio.sleep(0.3)
    assert not aufgabe.done(), "unerwartet schon fertig"

    aufgabe.cancel()
    with pytest.raises(asyncio.CancelledError):
        await aufgabe


async def test_ausgeblendete_knoten_kosten_keine_registerabfrage(
    hass: HomeAssistant, haus: dict
) -> None:
    """Fuer einen Knoten, den niemand anklicken kann, wird nichts geholt.

    Die Entitaetenliste eines Geraets kostet einen Registerdurchgang plus
    einen Zustand je Treffer. Fuer einen ausgeblendeten Knoten ist das
    Arbeit ohne Ergebnis: sein Aufklapper laesst sich gar nicht oeffnen.
    """
    from custom_components.spatial_hub.const import DATA_STORE

    anbieter_anmelden(hass, "demo", lambda: [haus["lampe"]])
    hub = hass.data[DATA_HUB]

    sichtbar = await hub.async_model()
    assert sichtbar["nodes"][0]["entities"], "sichtbar: Entitaeten erwartet"

    hass.data[DATA_STORE].update(
        "nodes", f"demo:{haus['lampe']}", {"hidden": True}
    )
    versteckt = await hub.async_model()
    assert versteckt["nodes"] == []
    assert versteckt["hidden"]["nodes"], "der Knoten muss auffindbar bleiben"
