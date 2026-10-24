"""Einrichtungs- und Optionen-Fluss, gegen den echten Flussmanager.

Eine Attrappe von ConfigFlow kann nur bestaetigen, dass der Hub seine
eigenen Methoden aufruft. Der echte Manager prueft, was dabei herauskommt:
Ein zweiter Start bricht ab, das Optionen-Formular uebernimmt Werte, und
die abgespeicherten Optionen aendern wirklich etwas -- Panel weg und
wieder da, auto_areas durchgereicht, Vorgaben aus dem Gespeicherten.
"""

from __future__ import annotations

import pytest
from homeassistant.core import HomeAssistant

from pytest_homeassistant_custom_component.common import MockConfigEntry

from hilfen import anbieter_anmelden

from custom_components.spatial_hub import _async_options_updated
from custom_components.spatial_hub.const import (
    CONF_AUTO_AREAS,
    CONF_PANEL,
    DATA_HUB,
    DOMAIN,
    PANEL_URL_PATH,
)


async def test_erster_nutzerstart_zeigt_formular_und_legt_an(
    hass: HomeAssistant,
) -> None:
    """Nichts eingerichtet: ein Klick, keine Fragen."""
    result = await hass.config_entries.flow.async_init(
        DOMAIN, context={"source": "user"}
    )
    if result["type"] == "form":
        result = await hass.config_entries.flow.async_configure(
            result["flow_id"], user_input={}
        )
        await hass.async_block_till_done()
    assert result["type"] == "create_entry"
    assert result["title"] == "Spatial Hub"
    assert result["data"] == {}


async def test_zweiter_nutzerstart_bricht_ab(
    hass: HomeAssistant, eintrag: MockConfigEntry
) -> None:
    """Der Hub gibt es hoechstens einmal pro Instanz."""
    result = await hass.config_entries.flow.async_init(
        DOMAIN, context={"source": "user"}
    )
    assert result["type"] == "abort"
    assert result["reason"] == "single_instance_allowed"


async def test_optionen_werden_uebernommen(hass: HomeAssistant, eintrag) -> None:
    """Das Formular nimmt beides entgegen und speichert es am Eintrag."""
    start = await hass.config_entries.options.async_init(eintrag.entry_id)
    assert start["type"] == "form"
    assert start["step_id"] == "init"

    ergebnis = await hass.config_entries.options.async_configure(
        start["flow_id"], user_input={"auto_areas": False, "panel": False}
    )
    await hass.async_block_till_done()

    assert ergebnis["type"] == "create_entry"
    assert eintrag.options == {"auto_areas": False, "panel": False}


async def test_optionen_wirken_sofort(hass: HomeAssistant, eintrag) -> None:
    """Nicht "gespeichert", sondern: Panel weg, Schalter durchgereicht.

    Der Update-Listener des Eintrags ist die einzige Bruecke zwischen dem
    Formular und dem laufenden Hub. Ohne sie muesste der Nutzer neu laden,
    und eine Option, die erst nach dem Neustart wirkt, ist keine.
    """
    start = await hass.config_entries.options.async_init(eintrag.entry_id)
    await hass.config_entries.options.async_configure(
        start["flow_id"], user_input={"auto_areas": False, "panel": False}
    )
    await hass.async_block_till_done()

    assert PANEL_URL_PATH not in hass.data.get("frontend_panels", {}), (
        "panel abgeschaltet, aber noch in der Seitenleiste"
    )
    assert hass.data[DATA_HUB].auto_areas is False


async def test_panel_kommt_wieder_zurueck(hass: HomeAssistant, eintrag) -> None:
    """Der gleiche Weg rueckwaerts: an, weg, an."""
    for an, erwartet in ((False, False), (True, True)):
        start = await hass.config_entries.options.async_init(eintrag.entry_id)
        await hass.config_entries.options.async_configure(
            start["flow_id"], user_input={"auto_areas": True, "panel": an}
        )
        await hass.async_block_till_done()
        panel_da = PANEL_URL_PATH in hass.data.get("frontend_panels", {})
        assert panel_da is erwartet


async def test_formular_zeigt_gespeicherte_werte_als_vorgabe(
    hass: HomeAssistant, eintrag
) -> None:
    """Wieder oeffnen zeigt, was zuletzt gespeichert war -- nicht die Werke."""
    hass.config_entries.async_update_entry(
        eintrag, options={CONF_AUTO_AREAS: False, CONF_PANEL: True}
    )
    await hass.async_block_till_done()

    start = await hass.config_entries.options.async_init(eintrag.entry_id)
    vorgaben = {}
    for schluessel in start["data_schema"].schema:
        wert = getattr(schluessel, "default", None)
        # Der Manager verpackt jede Vorgabe in eine Fabrik; roh waere das
        # ein Lambda und der Vergleich vergliche zwei Funktionsobjekte.
        if callable(wert):
            wert = wert()
        if wert is not None:
            vorgaben[str(schluessel)] = wert
    assert vorgaben == {
        CONF_AUTO_AREAS: False,
        CONF_PANEL: True,
    }


async def test_aktualisierung_ohne_hub_ist_kein_fehler(
    hass: HomeAssistant, eintrag
) -> None:
    """Der Hub ist entladen, der Update-Listener bleibt doch zu.

    Genau fuer diesen Fall fragt die Aktualisierung nach, ob es den Hub
    ueberhaupt noch gibt -- sie darf nicht an einem fehlenden Eintrag
    sterben, sonst waere ein Entladen waehrend einer Optionen-Aenderung
    ein Absturz.
    """
    assert await hass.config_entries.async_unload(eintrag.entry_id)
    await hass.async_block_till_done()
    assert DATA_HUB not in hass.data

    await _async_options_updated(hass, eintrag)  # darf nichts werfen


async def test_neuladen_baut_alles_wieder_auf(
    hass: HomeAssistant, eintrag
) -> None:
    """Entladen und wieder laden -- der zweite Hub ist ein ganzer Hub.

    Der normale Weg, wie Home Assistant eine Integration neu startet. Nach
    dem Wiederaufbau muss nichts von Hand nachgezogen werden: Panel da,
    Anmeldungen der Anbieter noch lesbar, Speicher der alte geblieben.
    """
    anbieter_anmelden(hass, "demo", lambda: {"nodes": [{"id": "a"}]})

    assert await hass.config_entries.async_unload(eintrag.entry_id)
    await hass.async_block_till_done()
    alt = hass.data.get(DATA_HUB)

    assert await hass.config_entries.async_reload(eintrag.entry_id)
    await hass.async_block_till_done()

    neu = hass.data.get(DATA_HUB)
    assert neu is not None and neu is not alt
    assert PANEL_URL_PATH in hass.data.get("frontend_panels", {})
    assert "demo" in hass.data["spatial_hub_providers"]
