"""Einrichten, Umschalten, Entladen -- in einem echten Home Assistant.

Die Attrappen-Suite prueft, dass ``async_setup_entry`` durchlaeuft. Sie
kann nicht pruefen, ob Home Assistant den Eintrag danach fuer geladen
haelt, ob das Panel wirklich in der Seitenleiste steht oder ob das
Entladen etwas liegen laesst -- dafuer braucht es die echte
Eintragsverwaltung, und die steht hier.
"""

from __future__ import annotations

import pytest
from homeassistant.config_entries import ConfigEntryState
from homeassistant.core import HomeAssistant

from pytest_homeassistant_custom_component.common import MockConfigEntry

from hilfen import anbieter_anmelden

from custom_components.spatial_hub.const import (
    CONF_PANEL,
    DATA_GENERIC,
    DATA_HUB,
    DATA_STORE,
    DATA_WATCHER,
    DOMAIN,
    PANEL_URL_PATH,
)


async def test_hub_laedt_in_einem_echten_home_assistant(
    hass: HomeAssistant, eintrag: MockConfigEntry
) -> None:
    """Der Eintrag steht auf geladen und alle vier Bausteine liegen bereit."""
    assert eintrag.state is ConfigEntryState.LOADED
    for schluessel in (DATA_HUB, DATA_STORE, DATA_WATCHER, DATA_GENERIC):
        assert schluessel in hass.data, f"{schluessel} fehlt nach dem Einrichten"


async def test_panel_steht_in_der_seitenleiste(
    hass: HomeAssistant, eintrag: MockConfigEntry
) -> None:
    """Nicht "register wurde aufgerufen", sondern: es ist wirklich da.

    ``frontend_panels`` ist Home Assistants eigene Liste. Eine Attrappe von
    ``async_register_built_in_panel`` kann nur bestaetigen, dass der Hub sie
    gerufen hat -- nicht, dass die Argumente stimmen und der Aufruf nicht
    innerlich gescheitert ist. Der Hub faengt naemlich jeden Fehler beim
    Registrieren ab, damit ein kaputtes Panel nicht die Datenschicht
    mitreisst. Genau deshalb kann er hier still nichts eingetragen haben.
    """
    panels = hass.data.get("frontend_panels", {})
    assert PANEL_URL_PATH in panels, f"nur {sorted(panels)} in der Seitenleiste"


async def test_entladen_raeumt_alles_weg(
    hass: HomeAssistant, eintrag: MockConfigEntry
) -> None:
    """Nach dem Entladen bleibt nichts vom Hub in hass.data stehen."""
    assert await hass.config_entries.async_unload(eintrag.entry_id)
    await hass.async_block_till_done()

    assert eintrag.state is ConfigEntryState.NOT_LOADED
    for schluessel in (DATA_HUB, DATA_STORE, DATA_WATCHER, DATA_GENERIC):
        assert schluessel not in hass.data, f"{schluessel} blieb liegen"
    assert PANEL_URL_PATH not in hass.data.get("frontend_panels", {})


async def test_anbieter_ueberleben_einen_hub_neustart(
    hass: HomeAssistant, eintrag: MockConfigEntry
) -> None:
    """Anmeldungen Fremder gehoeren nicht dem Hub.

    Ein Anbieter meldet sich einmal beim Laden seiner eigenen Integration
    an. Wuerde der Hub die Anmeldungen beim Entladen mitnehmen, waere jeder
    Hub-Neustart ein stiller Totalausfall aller Anbieter -- sie kaemen erst
    wieder, wenn der Nutzer auch *ihre* Integration neu laedt, und nichts
    wuerde erklaeren, warum die Karte leer ist.
    """
    anbieter_anmelden(hass, "fremd", lambda: [])

    assert await hass.config_entries.async_unload(eintrag.entry_id)
    await hass.async_block_till_done()

    assert "fremd" in hass.data.get("spatial_hub_providers", {})

    # Und der Hub findet sie beim naechsten Laden wieder vor.
    assert await hass.config_entries.async_setup(eintrag.entry_id)
    await hass.async_block_till_done()
    assert "fremd" in hass.data[DATA_HUB].providers


async def test_zweiter_eintrag_wird_abgelehnt(hass: HomeAssistant) -> None:
    """``single_config_entry`` im Manifest ist eine Behauptung -- hier belegt.

    Zwei Hubs in einer Instanz waeren zwei Panels auf demselben Pfad und
    zwei Wachhunde auf denselben Ereignissen.
    """
    erster = MockConfigEntry(domain=DOMAIN, title="Spatial Hub", data={})
    erster.add_to_hass(hass)
    assert await hass.config_entries.async_setup(erster.entry_id)
    await hass.async_block_till_done()

    ergebnis = await hass.config_entries.flow.async_init(
        DOMAIN, context={"source": "user"}
    )
    assert ergebnis["type"] == "abort"
    assert ergebnis["reason"] in ("single_instance_allowed", "already_configured")


async def test_panel_laesst_sich_ueber_die_optionen_abschalten(
    hass: HomeAssistant, eintrag: MockConfigEntry
) -> None:
    """Wer einen eigenen Renderer mitbringt, braucht das Panel nicht.

    Der Weg dahin ist ein Optionswechsel, und der laeuft ueber Home
    Assistants Aktualisierungshorcher -- ein Mechanismus, den eine
    Attrappe erst gar nicht hat.
    """
    hass.config_entries.async_update_entry(eintrag, options={CONF_PANEL: False})
    await hass.async_block_till_done()
    assert PANEL_URL_PATH not in hass.data.get("frontend_panels", {})

    hass.config_entries.async_update_entry(eintrag, options={CONF_PANEL: True})
    await hass.async_block_till_done()
    assert PANEL_URL_PATH in hass.data.get("frontend_panels", {})
