"""Anker: der Schritt vom Netzplan zum Grundriss.

Eine Kante sagt "die beiden reden miteinander". Ein Anker sagt "der eine
ist beim anderen", und aus mehreren Ankern mit Gewicht wird ein Ort.

Das ist der Unterschied, auf den es ankommt, wenn der Hub mehr sein soll
als eine huebsche Netzwerkgrafik: ein Anbieter, der eine Funkstaerke
misst, weiss ueber den Ort eines Geraets mehr als die Eintragung, die der
Nutzer vor einem Jahr gemacht hat -- und anders als die Eintragung merkt
die Messung, wenn das Geraet umgezogen ist.

Geprueft wird gegen ein echtes Home Assistant mit echten Registern, weil
die ganze Rechnung auf den Bereichspositionen aufsetzt, die der Hub aus
dem Bereichsregister ableitet.
"""

from __future__ import annotations

import pytest
from homeassistant.core import HomeAssistant

from custom_components.spatial_hub.const import DOMAIN

from hilfen import anbieter_anmelden


async def _modell(hass: HomeAssistant, client) -> dict:
    await client.send_json({"id": 1, "type": f"{DOMAIN}/model"})
    antwort = await client.receive_json()
    assert antwort["success"], antwort
    return antwort["result"]


async def test_anker_setzen_den_knoten_zwischen_seine_bezugspunkte(
    hass: HomeAssistant, haus: dict, hass_ws_client
) -> None:
    """Zwei gleich starke Anker: der Punkt liegt in der Mitte.

    Der einfachste nachrechenbare Fall. Zwei Proxys in zwei Raeumen hoeren
    denselben Anhaenger gleich laut -- dann ist er zwischen ihnen, und
    genau das muss herauskommen.
    """
    anbieter_anmelden(hass, "funk", lambda: {
        "nodes": [
            {"id": "proxy-kueche", "label": "Proxy Küche",
             "area_id": haus["kueche"].id},
            {"id": "proxy-schlaf", "label": "Proxy Schlafzimmer",
             "area_id": haus["schlafzimmer"].id},
            {"id": "anhaenger", "label": "Schlüsselbund",
             "anchors": [{"id": "proxy-kueche", "weight": 1.0},
                         {"id": "proxy-schlaf", "weight": 1.0}]},
        ]
    })
    client = await hass_ws_client(hass)
    knoten = {k["id"]: k for k in (await _modell(hass, client))["nodes"]}

    kueche = knoten["funk:proxy-kueche"]["position"]
    schlaf = knoten["funk:proxy-schlaf"]["position"]
    anhaenger = knoten["funk:anhaenger"]

    assert anhaenger["position"]["x"] == pytest.approx(
        (kueche["x"] + schlaf["x"]) / 2)
    assert anhaenger["position"]["y"] == pytest.approx(
        (kueche["y"] + schlaf["y"]) / 2)
    assert anhaenger["metadata"]["anchored_by"] == 2


async def test_staerkerer_anker_zieht_den_punkt_zu_sich(
    hass: HomeAssistant, haus: dict, hass_ws_client
) -> None:
    """Das Gewicht muss wirken, sonst ist es Zierrat.

    Der Proxy, der lauter hoert, ist naeher dran. Ein Punkt, der trotzdem
    in der Mitte bleibt, hat die Messung weggeworfen.
    """
    anbieter_anmelden(hass, "funk", lambda: {
        "nodes": [
            {"id": "nah", "area_id": haus["kueche"].id},
            {"id": "fern", "area_id": haus["schlafzimmer"].id},
            {"id": "geraet",
             "anchors": [{"id": "nah", "weight": 9.0},
                         {"id": "fern", "weight": 1.0}]},
        ]
    })
    client = await hass_ws_client(hass)
    knoten = {k["id"]: k for k in (await _modell(hass, client))["nodes"]}

    nah = knoten["funk:nah"]["position"]
    fern = knoten["funk:fern"]["position"]
    geraet = knoten["funk:geraet"]["position"]

    def abstand(a, b):
        return ((a["x"] - b["x"]) ** 2 + (a["y"] - b["y"]) ** 2) ** 0.5

    assert abstand(geraet, nah) < abstand(geraet, fern)


async def test_bereichsloser_knoten_erbt_den_raum_des_staerksten_ankers(
    hass: HomeAssistant, haus: dict, hass_ws_client
) -> None:
    """Der eigentliche Gewinn.

    Niemand traegt fuer einen Schluesselbund einen Raum ein. Die Messung
    sagt trotzdem, wo er liegt -- und damit steht er im richtigen Raum und
    auf der richtigen Etage, ohne dass jemand etwas getan haette.

    Gemittelt wird der Raum bewusst nicht: zwischen Kueche und
    Schlafzimmer liegt kein halber Raum. Der lauteste gewinnt.
    """
    anbieter_anmelden(hass, "funk", lambda: {
        "nodes": [
            {"id": "kueche", "area_id": haus["kueche"].id},
            {"id": "schlaf", "area_id": haus["schlafzimmer"].id},
            {"id": "anhaenger",
             "anchors": [{"id": "kueche", "weight": 8.0},
                         {"id": "schlaf", "weight": 1.0}]},
        ]
    })
    client = await hass_ws_client(hass)
    knoten = {k["id"]: k for k in (await _modell(hass, client))["nodes"]}
    anhaenger = knoten["funk:anhaenger"]

    assert anhaenger["area_id"] == haus["kueche"].id
    assert anhaenger["floor_id"] == haus["erdgeschoss"].floor_id
    # Angeschrieben, damit ein Renderer "gemessen" von "eingetragen"
    # unterscheiden kann.
    assert anhaenger["metadata"]["area_from_anchor"] == "funk:kueche"


async def test_eigener_bereich_schlaegt_den_anker(
    hass: HomeAssistant, haus: dict, hass_ws_client
) -> None:
    """Was der Anbieter selbst weiss, wird nicht ueberstimmt.

    Ein Geraet, dem jemand einen Raum gegeben hat, behaelt ihn. Der Anker
    fuellt eine Luecke, er korrigiert keine Angabe -- sonst wandert ein
    fest verbautes Geraet jede Nacht durchs Haus, weil der Funk schwankt.
    """
    anbieter_anmelden(hass, "funk", lambda: {
        "nodes": [
            {"id": "kueche", "area_id": haus["kueche"].id},
            {"id": "fest", "area_id": haus["garten"].id,
             "anchors": [{"id": "kueche", "weight": 99.0}]},
        ]
    })
    client = await hass_ws_client(hass)
    knoten = {k["id"]: k for k in (await _modell(hass, client))["nodes"]}

    assert knoten["funk:fest"]["area_id"] == haus["garten"].id
    assert "area_from_anchor" not in knoten["funk:fest"]["metadata"]


async def test_anker_auf_einen_unbekannten_knoten_wird_uebergangen(
    hass: HomeAssistant, haus: dict, hass_ws_client
) -> None:
    """Ein Anker ins Leere darf nichts kaputtmachen.

    Anbieter liefern Momentaufnahmen: ein Proxy, der zwischen zwei
    Aufbauten verschwindet, hinterlaesst Anker auf einen Knoten, den es
    nicht mehr gibt. Das Geraet muss trotzdem gezeichnet werden -- es
    existiert ja.
    """
    anbieter_anmelden(hass, "funk", lambda: {
        "nodes": [
            {"id": "da", "area_id": haus["kueche"].id},
            {"id": "halb", "anchors": [{"id": "da", "weight": 1.0},
                                       {"id": "weg", "weight": 5.0}]},
            {"id": "ganz", "anchors": [{"id": "weg", "weight": 5.0}]},
        ]
    })
    client = await hass_ws_client(hass)
    knoten = {k["id"]: k for k in (await _modell(hass, client))["nodes"]}

    # Der halb aufloesbare haengt am verbliebenen Anker, nicht in der Mitte.
    assert knoten["funk:halb"]["metadata"]["anchored_by"] == 1
    assert knoten["funk:halb"]["position"] == knoten["funk:da"]["position"]
    # Der gar nicht aufloesbare wird gezeichnet, statt zu verschwinden.
    assert knoten["funk:ganz"]["position"] is not None


async def test_unsinnige_gewichte_werden_verworfen(
    hass: HomeAssistant, haus: dict, hass_ws_client
) -> None:
    """Null, negativ, unendlich, keine Zahl -- alles kommt vor.

    Ein negatives Gewicht wuerde den Punkt aus dem Grundriss hinaus
    schieben, ein unendliches jede andere Messung ausloeschen. Beides ist
    fast immer eine Division, die schiefging.
    """
    anbieter_anmelden(hass, "funk", lambda: {
        "nodes": [
            {"id": "gut", "area_id": haus["kueche"].id},
            {"id": "boese", "area_id": haus["schlafzimmer"].id},
            {"id": "geraet", "anchors": [
                {"id": "gut", "weight": 2.0},
                {"id": "boese", "weight": -5.0},
                {"id": "boese", "weight": 0},
                {"id": "boese", "weight": float("inf")},
                {"id": "boese", "weight": "laut"},
                {"weight": 3.0},
            ]},
        ]
    })
    client = await hass_ws_client(hass)
    knoten = {k["id"]: k for k in (await _modell(hass, client))["nodes"]}
    geraet = knoten["funk:geraet"]

    assert [a["id"] for a in geraet["anchors"]] == ["funk:gut"]
    assert geraet["position"] == knoten["funk:gut"]["position"]


async def test_anker_zeigen_nie_ueber_anbietergrenzen(
    hass: HomeAssistant, haus: dict, hass_ws_client
) -> None:
    """Die Kennung bekommt das Praefix des eigenen Anbieters.

    Sonst koennte ein Anbieter einen fremden Knoten verschieben, indem er
    dessen Kennung raet -- und die Anbieter haben untereinander keine
    Zusicherung, dass ein Knoten beim naechsten Aufbau noch da ist.
    """
    anbieter_anmelden(hass, "eins", lambda: [
        {"id": "punkt", "area_id": haus["kueche"].id},
    ])
    anbieter_anmelden(hass, "zwei", lambda: [
        {"id": "punkt", "area_id": haus["schlafzimmer"].id},
        {"id": "haenger", "anchors": [{"id": "punkt", "weight": 1.0}]},
    ])
    client = await hass_ws_client(hass)
    knoten = {k["id"]: k for k in (await _modell(hass, client))["nodes"]}

    assert knoten["zwei:haenger"]["anchors"][0]["id"] == "zwei:punkt"
    # Also im Schlafzimmer, nicht in der Kueche des anderen Anbieters.
    assert knoten["zwei:haenger"]["area_id"] == haus["schlafzimmer"].id
