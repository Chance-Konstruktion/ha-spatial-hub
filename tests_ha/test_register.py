"""Was Home Assistant ueber das Haus weiss -- aus den echten Registern.

Dies ist die Stelle, an der eine Attrappe am teuersten luegt. ``discovery``
liest vier Register und greift dabei auf Felder zu, die es nur gibt, weil
Home Assistant sie hat: ``floor.level``, ``area.floor_id``,
``entry.original_name``, ``entry.original_device_class``. Eine
selbstgebaute Attrappe hat genau die Felder, die der Code liest -- sie
kann nie zeigen, dass eines davon umbenannt wurde oder verschwunden ist.
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

from custom_components.spatial_hub import discovery
from custom_components.spatial_hub.const import AreaKind


async def test_etagen_kommen_aus_dem_echten_etagenregister(
    hass: HomeAssistant, haus: dict
) -> None:
    """Kennung, Name, Symbol und Stockwerk -- vier echte Felder."""
    etagen = {etage["name"]: etage for etage in discovery.async_floors(hass)}

    assert etagen["Erdgeschoss"]["level"] == 0
    assert etagen["Erdgeschoss"]["icon"] == "mdi:home"
    assert etagen["Erdgeschoss"]["id"] == haus["erdgeschoss"].floor_id


async def test_stockwerk_wird_aus_dem_namen_geraten_wenn_das_feld_leer_ist(
    hass: HomeAssistant, haus: dict
) -> None:
    """Home Assistant laesst ``level`` offen, und die meisten lassen es offen.

    Ohne das Raten landet der Dachboden neben dem Keller auf Ebene 0, und
    das gestapelte Haus ist Unsinn. Der Test steht hier statt in tests/,
    weil erst das echte Register beweist, dass ein nicht gesetztes Feld
    wirklich als ``None`` ankommt und nicht als 0.
    """
    assert haus["obergeschoss"].level is None

    etagen = {etage["name"]: etage for etage in discovery.async_floors(hass)}
    assert etagen["1. OG"]["level"] == 1


async def test_bereiche_kommen_aus_dem_echten_bereichsregister(
    hass: HomeAssistant, haus: dict
) -> None:
    """Bereiche samt ihrer Etage, und die Vermutung, was sie sind."""
    bereiche = {b["name"]: b for b in discovery.async_areas(hass)}

    assert bereiche["Küche"]["floor_id"] == haus["erdgeschoss"].floor_id
    assert bereiche["Küche"]["kind"] == AreaKind.INDOOR.value
    # Ein Garten ist keine Etage. Ohne diese Vermutung landet er als
    # eigenes Stockwerk zwischen Keller und Erdgeschoss.
    assert bereiche["Garten"]["kind"] == AreaKind.OUTDOOR.value
    assert bereiche["Garten"]["floor_id"] is None


async def test_entitaet_erbt_den_bereich_von_ihrem_geraet(
    hass: HomeAssistant, haus: dict
) -> None:
    """Der Normalfall im echten Betrieb, und er haengt an zwei Registern.

    Kaum eine Entitaet hat einen eigenen ``area_id``: der Nutzer ordnet das
    *Geraet* einem Raum zu, und die Entitaeten erben. Wer das nicht
    nachbaut, zeichnet ein Haus, in dem fast alles bereichslos in der Mitte
    des Grundrisses liegt -- und genau so sah es aus, bevor es diesen
    Zweig gab.
    """
    eintrag = er.async_get(hass).async_get(haus["lampe"])
    assert eintrag.area_id is None, "die Entitaet selbst hat keinen Bereich"

    vorgaben = discovery.async_entity_defaults(hass, haus["lampe"])
    assert vorgaben["area_id"] == haus["kueche"].id
    assert vorgaben["device_id"] == haus["geraet"].id


async def test_eigener_bereich_der_entitaet_schlaegt_den_des_geraets(
    hass: HomeAssistant, haus: dict
) -> None:
    """Eine Entitaet darf woanders haengen als ihr Geraet.

    Der Temperaturfuehler eines Heizungssteuergeraets im Keller misst im
    Wohnzimmer. Home Assistant kennt diesen Fall, also muss der Hub ihn
    auch kennen.
    """
    er.async_get(hass).async_update_entity(
        haus["lampe"], area_id=haus["schlafzimmer"].id
    )
    await hass.async_block_till_done()

    vorgaben = discovery.async_entity_defaults(hass, haus["lampe"])
    assert vorgaben["area_id"] == haus["schlafzimmer"].id


async def test_name_und_symbol_kommen_aus_dem_register(
    hass: HomeAssistant, haus: dict
) -> None:
    """``original_name`` reicht -- der Anbieter muss nichts wiederholen.

    Ein blosser Entitaetsname ist die kuerzeste moegliche Knotendefinition.
    Damit das gilt, muss der Hub Beschriftung, Symbol und Zustand selbst
    finden.
    """
    vorgaben = discovery.async_entity_defaults(hass, haus["lampe"])
    assert vorgaben["label"] == "Deckenlampe"
    assert vorgaben["state"] == "on"
    # Kein Symbol im Register, keines im Zustand -- also das der Domain.
    assert vorgaben["icon"] == "mdi:lightbulb"


async def test_symbol_folgt_der_geraeteklasse_vor_der_domain(
    hass: HomeAssistant, haus: dict
) -> None:
    """Ein Leistungssensor ist ein Blitz, kein Auge.

    ``original_device_class`` ist ein Registerfeld, das eine Attrappe
    typischerweise nicht hat -- und ohne das jeder Sensor gleich aussieht.
    """
    vorgaben = discovery.async_entity_defaults(hass, haus["verbrauch"])
    assert vorgaben["icon"] == "mdi:flash"


async def test_geraeteliste_zeigt_alle_entitaeten_des_geraets(
    hass: HomeAssistant, haus: dict
) -> None:
    """Der Aufklapper soll das ganze Geraet zeigen, nicht eine Entitaet."""
    liste = discovery.async_device_entities(hass, haus["geraet"].id)
    ids = {eintrag["entity_id"] for eintrag in liste}

    assert ids == {haus["lampe"], haus["verbrauch"]}
    lampe = next(e for e in liste if e["entity_id"] == haus["lampe"])
    assert lampe["name"] == "Deckenlampe"
    assert lampe["state"] == "on"


async def test_abgeschaltete_entitaeten_stehen_nicht_in_der_geraeteliste(
    hass: HomeAssistant, haus: dict
) -> None:
    """Eine abgeschaltete Entitaet hat keinen Zustand und keinen Nutzen.

    Sie wuerde als leere Zeile im Aufklapper stehen. Ob der Ausschluss
    wirkt, entscheidet Home Assistants eigenes ``async_entries_for_device``
    -- der Hub gibt nur ``include_disabled_entities=False`` weiter.
    """
    register = er.async_get(hass)
    register.async_update_entity(
        haus["verbrauch"], disabled_by=er.RegistryEntryDisabler.USER
    )
    await hass.async_block_till_done()

    liste = discovery.async_device_entities(hass, haus["geraet"].id)
    assert {e["entity_id"] for e in liste} == {haus["lampe"]}


async def test_unbekannte_entitaet_ergibt_trotzdem_brauchbare_vorgaben(
    hass: HomeAssistant, haus: dict
) -> None:
    """Ein Anbieter darf eine Entitaet nennen, die es nicht gibt.

    Sie darf den Modellaufbau nicht sprengen. Beschriftung und Symbol
    faellt auf das zurueck, was sich aus der Kennung ableiten laesst.
    """
    vorgaben = discovery.async_entity_defaults(hass, "cover.gibt_es_nicht")
    assert vorgaben["label"] == "cover.gibt_es_nicht"
    assert vorgaben["icon"] == "mdi:window-shutter"
    assert "area_id" not in vorgaben
