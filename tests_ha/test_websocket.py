"""Der Vertrag nach aussen, ueber eine echte Websocket-Verbindung.

Die Websocket-API *ist* das Produkt -- das eingebaute Panel ist nur der
erste Renderer. Getestet wird deshalb ueber einen echten Client: mit
Anmeldung, mit Rechtepruefung, mit Home Assistants eigener Schema-Pruefung
davor. Ein direkter Aufruf der Handler-Funktion umgeht genau die drei
Schichten, in denen die Fehler sitzen.
"""

from __future__ import annotations

from datetime import timedelta

import pytest
from homeassistant.core import HomeAssistant
from homeassistant.helpers import (
    area_registry as ar,
    device_registry as dr,
    entity_registry as er,
)
from homeassistant.util import dt as dt_util

from pytest_homeassistant_custom_component.common import async_fire_time_changed

from custom_components.spatial_hub.const import DOMAIN, UNASSIGNED_FLOOR_ID

from hilfen import anbieter_anmelden


async def test_modell_beschreibt_ein_echtes_haus(
    hass: HomeAssistant, haus: dict, hass_ws_client
) -> None:
    """Der Durchstich: echtes Register, echter Anbieter, echte Verbindung.

    Ein Anbieter nennt nur eine Entitaetskennung. Alles andere -- die
    Beschriftung, der Raum, das Symbol, der Zustand, die Position -- muss
    der Hub aus Home Assistant selbst holen. Genau das ist das Versprechen
    des Projekts, und dies ist der einzige Test, der es ganz durchmisst.
    """
    anbieter_anmelden(hass, "demo", lambda: [haus["lampe"]])
    client = await hass_ws_client(hass)

    await client.send_json({"id": 1, "type": f"{DOMAIN}/model"})
    antwort = await client.receive_json()
    assert antwort["success"], antwort
    modell = antwort["result"]

    knoten = {k["id"]: k for k in modell["nodes"]}
    lampe = knoten[f"demo:{haus['lampe']}"]

    assert lampe["label"] == "Deckenlampe"
    assert lampe["state"] == "on"
    assert lampe["icon"] == "mdi:lightbulb"
    # Ueber das Geraet geerbt -- der Anbieter hat nie einen Raum genannt.
    assert lampe["area_id"] == haus["kueche"].id
    assert lampe["floor_id"] == haus["erdgeschoss"].floor_id
    # Und er liegt irgendwo, ohne dass jemand ihn gesetzt hat.
    assert 0.0 <= lampe["position"]["x"] <= 1.0
    assert 0.0 <= lampe["position"]["y"] <= 1.0
    # Das ganze Geraet, nicht nur die eine Entitaet -- damit der Aufklapper
    # den Nutzer nicht zum Suchen nach Home Assistant schickt.
    assert {e["entity_id"] for e in lampe["entities"]} == {
        haus["lampe"], haus["verbrauch"]
    }


async def test_garten_ist_keine_etage(
    hass: HomeAssistant, haus: dict, hass_ws_client
) -> None:
    """Ein Bereich ohne Etage, der nach draussen klingt, landet draussen.

    Der Garten hat im Register keine Etage. Ohne die Aufloesung bekommt er
    erst die Sammeletage "Ohne Zuordnung" und bleibt dort als eigenes
    Stockwerk stehen -- ein Haus, in das man in den Vorgarten
    hinuntersteigt. Er gehoert ums Erdgeschoss herum.
    """
    client = await hass_ws_client(hass)
    await client.send_json({"id": 1, "type": f"{DOMAIN}/model"})
    modell = (await client.receive_json())["result"]

    bereiche = {b["name"]: b for b in modell["areas"]}
    etagen = {e["id"]: e for e in modell["floors"]}

    assert bereiche["Garten"]["floor_id"] == haus["erdgeschoss"].floor_id
    assert UNASSIGNED_FLOOR_ID not in etagen, "die Sammeletage blieb stehen"
    assert etagen[haus["erdgeschoss"].floor_id]["has_outdoor"] is True
    # Und er liegt wirklich draussen: die Schuerze reicht ueber 0..1 hinaus.
    lage = bereiche["Garten"]["position"]
    assert lage["x"] < 0 or lage["x"] > 1 or lage["y"] < 0 or lage["y"] > 1


async def test_aktionen_sind_administratoren_vorbehalten(
    hass: HomeAssistant, eintrag, hass_ws_client, hass_read_only_access_token
) -> None:
    """``require_admin`` ist ein Dekorator -- hier zeigt sich, ob er wirkt.

    Aktionen schalten echte Hardware. Ein direkter Aufruf des Handlers
    laeuft an der Rechtepruefung vorbei, weil die in Home Assistants
    Websocket-Schicht sitzt und nicht in der Funktion.
    """
    client = await hass_ws_client(hass, hass_read_only_access_token)
    await client.send_json({
        "id": 1,
        "type": f"{DOMAIN}/action",
        "kind": "node",
        "item_id": "demo:lampe",
        "action": "toggle",
    })
    antwort = await client.receive_json()
    assert not antwort["success"]
    assert antwort["error"]["code"] == "unauthorized"


async def test_modell_darf_jeder_sehen(
    hass: HomeAssistant, eintrag, hass_ws_client, hass_read_only_access_token
) -> None:
    """Das Haus anzusehen ist keine Verwaltungshandlung.

    Die Gegenprobe zum Test darueber: waeren beide Befehle gleich
    geschuetzt, saehe ein Gastkonto ueberhaupt keinen Grundriss.
    """
    client = await hass_ws_client(hass, hass_read_only_access_token)
    await client.send_json({"id": 1, "type": f"{DOMAIN}/model"})
    antwort = await client.receive_json()
    assert antwort["success"], antwort


async def test_bereich_zuweisen_schreibt_ins_geraeteregister(
    hass: HomeAssistant, haus: dict, hass_ws_client
) -> None:
    """Der einzige Befehl, der ausserhalb des Hubs schreibt.

    Ein Punkt liegt in der Kueche, weil sein *Geraet* dort haengt. Wer ihn
    verschiebt, verschiebt das Geraet -- alles andere waere eine
    Verschiebung, die im naechsten Dashboard nicht ankommt.
    """
    client = await hass_ws_client(hass)
    await client.send_json({
        "id": 1,
        "type": f"{DOMAIN}/area/assign",
        "entity_id": haus["lampe"],
        "area_id": haus["schlafzimmer"].id,
    })
    antwort = await client.receive_json()
    assert antwort["success"], antwort

    assert antwort["result"]["scope"] == "device"
    assert antwort["result"]["target"] == haus["geraet"].id
    assert antwort["result"]["before"] == haus["kueche"].id
    assert antwort["result"]["after"] == haus["schlafzimmer"].id

    # Und zwar wirklich, im echten Register:
    assert dr.async_get(hass).async_get(haus["geraet"].id).area_id == (
        haus["schlafzimmer"].id
    )


async def test_eigene_zuordnung_der_entitaet_wird_nicht_ueberschrieben(
    hass: HomeAssistant, haus: dict, hass_ws_client
) -> None:
    """Wer eine Entitaet bewusst aus ihrem Geraet geloest hat, meint es so.

    Ein Fuehler, den der Nutzer eigens in einen anderen Raum gesetzt hat,
    darf beim Verschieben nicht sein ganzes Geraet mitnehmen -- sonst
    wandern Geschwister mit, die niemand angefasst hat.
    """
    register = er.async_get(hass)
    register.async_update_entity(haus["verbrauch"], area_id=haus["garten"].id)
    await hass.async_block_till_done()

    client = await hass_ws_client(hass)
    await client.send_json({
        "id": 1,
        "type": f"{DOMAIN}/area/assign",
        "entity_id": haus["verbrauch"],
        "area_id": haus["schlafzimmer"].id,
    })
    antwort = await client.receive_json()
    assert antwort["success"], antwort
    assert antwort["result"]["scope"] == "entity"

    assert register.async_get(haus["verbrauch"]).area_id == haus["schlafzimmer"].id
    # Das Geraet steht unveraendert in der Kueche.
    assert dr.async_get(hass).async_get(haus["geraet"].id).area_id == haus["kueche"].id


async def test_zuweisen_an_einen_unbekannten_bereich_wird_abgelehnt(
    hass: HomeAssistant, haus: dict, hass_ws_client
) -> None:
    """Eine erfundene Bereichskennung darf nicht ins Register wandern.

    Ein Geraet mit einer Bereichskennung, zu der es keinen Bereich gibt,
    ist im Register nicht mehr auffindbar -- und der Nutzer sieht nur, dass
    sein Punkt verschwunden ist.
    """
    client = await hass_ws_client(hass)
    await client.send_json({
        "id": 1,
        "type": f"{DOMAIN}/area/assign",
        "entity_id": haus["lampe"],
        "area_id": "gibt-es-nicht",
    })
    antwort = await client.receive_json()
    assert not antwort["success"]
    assert antwort["error"]["code"] == "not_found"
    assert dr.async_get(hass).async_get(haus["geraet"].id).area_id == haus["kueche"].id


async def test_abonnenten_erfahren_von_aenderungen_am_haus(
    hass: HomeAssistant, eintrag, hass_ws_client
) -> None:
    """Der Weg vom Register bis zum Renderer, in einem Stueck.

    Register -> Wachhund -> Entprellung -> Hub -> Abonnement -> Client.
    Vier Glieder, von denen drei an Home Assistant haengen. Reisst eines,
    steht der Grundriss still und niemand erfaehrt es.
    """
    client = await hass_ws_client(hass)
    await client.send_json({"id": 1, "type": f"{DOMAIN}/subscribe"})
    assert (await client.receive_json())["success"]

    ar.async_get(hass).async_create("Wintergarten")
    await hass.async_block_till_done()
    async_fire_time_changed(hass, dt_util.utcnow() + timedelta(seconds=3))
    await hass.async_block_till_done()

    nachricht = await client.receive_json()
    assert nachricht["type"] == "event"
    assert "registry" in nachricht["event"]["reason"]


async def test_diagnose_nennt_den_schuldigen_anbieter(
    hass: HomeAssistant, eintrag, hass_ws_client
) -> None:
    """Eine leere Ebene darf nie ein Raetsel sein.

    Der Hub faengt alles ab, was ein Anbieter falsch macht -- sonst
    reisst ein fremder Fehler den ganzen Grundriss mit. Der Preis dafuer
    ist, dass Fehler still sind, und die Diagnose ist der Ausgleich.
    """
    def kaputt():
        raise ValueError("kein Netz")

    anbieter_anmelden(hass, "kaputt", kaputt)

    client = await hass_ws_client(hass)
    await client.send_json({"id": 1, "type": f"{DOMAIN}/diagnostics"})
    antwort = await client.receive_json()
    assert antwort["success"], antwort

    zustand = antwort["result"]["providers"]["kaputt"]
    assert zustand["ok"] is False
    assert "kein Netz" in zustand["error"]


async def test_ein_kaputter_anbieter_reisst_das_modell_nicht_mit(
    hass: HomeAssistant, haus: dict, hass_ws_client
) -> None:
    """Der gute Anbieter liefert weiter, wenn der schlechte danebensteht."""
    anbieter_anmelden(hass, "kaputt", lambda: 1 / 0)
    anbieter_anmelden(hass, "heil", lambda: [haus["lampe"]])

    client = await hass_ws_client(hass)
    await client.send_json({"id": 1, "type": f"{DOMAIN}/model"})
    antwort = await client.receive_json()
    assert antwort["success"], antwort

    ids = {k["id"] for k in antwort["result"]["nodes"]}
    assert f"heil:{haus['lampe']}" in ids
