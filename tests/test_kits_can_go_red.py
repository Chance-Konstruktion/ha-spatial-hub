"""Die Wache gegen den Fehler, der heute dreimal in denselben Dateien sass.

Beide Kits pruefen fremden Code. Wer fremden Code prueft, hat ein
Problem, das andere Tests nicht haben: Sein eigenes Versagen sieht aus
wie ein Erfolg. Eine Regel, die aussteigt, meldet nichts. Eine Schleife
ueber eine leere Liste meldet nichts. Ein Laeufer, der eine Klasse nicht
einsammelt, meldet nichts. Am Ende steht dreimal derselbe gruene Haken,
und dreimal wurde nichts geprueft.

An einem Tag gefunden, alle drei in genau dieser Form:

* Die Fallback-Regel des Renderer-Kits begann mit
  ``if "theme" not in code: return``. Wer das Thema falsch benutzte,
  fiel auf -- wer es ganz ignorierte, kam durch. Also genau die
  schlimmere Form.
* Die erste Regel desselben Kits verlangte ein Websocket-Kommando und
  war damit in dem einen Repository, in das es geliefert wurde, gar
  nicht erfuellbar. Deshalb hat es dort nie jemand ausgefuehrt.
* Das Provider-Kit stellte einem Provider, dessen ``data()``
  ``{"nodes": [], "edges": []}`` zurueckgibt, ein makelloses Zeugnis
  aus. Alle sechzehn Regeln sind Schleifen ueber diese beiden Listen.

Diese Datei prueft deshalb zwei Dinge:

1. **Von aussen:** Kann jedes Kit ueberhaupt rot werden -- gegen das
   Nichts, das seine Regeln alle erfuellt?
2. **Von innen:** Steigt eine Regel aus, bevor sie etwas behauptet hat?
   Das ist erlaubt, aber nur mit Namen und Begruendung in ``ERLAUBT``.
   Ein Ausstieg, den niemand aufgeschrieben hat, ist der Fehler von
   oben.
"""

from __future__ import annotations

import ast
import importlib.util
from pathlib import Path

import pytest

WURZEL = Path(__file__).resolve().parents[1]


def _laden(name: str):
    spec = importlib.util.spec_from_file_location(name, WURZEL / "sdk" / f"{name}.py")
    modul = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(modul)
    return modul


provider_kit = _laden("spatial_hub_conformance")
renderer_kit = _laden("spatial_hub_renderer_conformance")

KITS = {
    "spatial_hub_conformance": WURZEL / "sdk" / "spatial_hub_conformance.py",
    "spatial_hub_renderer_conformance":
        WURZEL / "sdk" / "spatial_hub_renderer_conformance.py",
}

# Regeln, die aussteigen duerfen -- mit dem Grund, warum das kein
# Durchwinken ist. Jeder Eintrag nennt den Schalter, der den Ausstieg
# ausloest: Er steht in der Testklasse, ist dokumentiert, und wer ihn
# umlegt, sagt damit etwas ueber sein eigenes Projekt aus.
#
# Was hier NICHT stehen darf: "die Regel passt hier gerade nicht".
# Genau so ist die Fallback-Regel entstanden.
ERLAUBT = {
    "test_it_reports_something_at_all":
        "expects_data = False -- der Lauf ist absichtlich gegen einen "
        "leeren Aufbau, und das steht dann in der Testklasse",
    "test_actions_are_declared_and_runnable":
        "kein einziger Node bietet Aktionen an; dann gibt es nichts zu "
        "pruefen, und das ist am Payload ablesbar, nicht an einer Meinung",
    "test_it_places_by_the_floor_it_was_given":
        "der Renderer zeichnet gar keine Etagen -- ein Bereich pro "
        "Bildschirm, oder reiner Text fuer einen Screenreader. Dann gibt "
        "es beim Zuordnen nichts falsch zu machen, und `floor_id` von ihm "
        "zu verlangen waere Unsinn",
    "test_a_read_only_renderer_needs_almost_nothing":
        "read_only = False -- der Renderer bearbeitet, und das Kit hoert "
        "auf zu behaupten, er koenne keine Anordnung anfassen",
    "test_it_never_writes_the_users_arrangement":
        "read_only = False, dieselbe erklaerte Ausnahme",
}


def _regeln(pfad: Path):
    baum = ast.parse(pfad.read_text(encoding="utf-8"))
    for knoten in ast.walk(baum):
        if isinstance(knoten, (ast.FunctionDef, ast.AsyncFunctionDef)):
            if knoten.name.startswith("test_"):
                yield knoten


def _eigene_knoten(regel: ast.AST):
    """Alles in der Regel selbst -- ohne verschachtelte Funktionen.

    Wichtig, sonst zaehlt das ``return`` einer Attrappe, die im Test
    definiert wird, als Ausstieg aus der Pruefung. Beim ersten Durchlauf
    ueber alle Repositories gab die grobe Fassung zwanzig Treffer, davon
    zwanzig falsche. Eine Wache, die grundlos meckert, wird abgeschaltet
    -- und dann bewacht sie gar nichts mehr.
    """
    def tief(k):
        if isinstance(k, (ast.FunctionDef, ast.AsyncFunctionDef,
                          ast.Lambda, ast.ClassDef)):
            return
        yield k
        for kind in ast.iter_child_nodes(k):
            yield from tief(kind)

    for kind in ast.iter_child_nodes(regel):
        yield from tief(kind)


def _steigt_stumm_aus(regel: ast.AST) -> bool:
    """Endet die Regel irgendwo, ohne vorher etwas behauptet zu haben?

    Ein ``return``, vor dem in dieser Regel noch kein ``assert`` steht,
    ist ein Weg durch die Pruefung, auf dem nichts geprueft wird. Ob er im
    Einzelfall harmlos ist, entscheidet ``ERLAUBT`` -- mit Begruendung,
    nicht die Heuristik.
    """
    knoten = list(_eigene_knoten(regel))
    zeilen_mit_assert = [k.lineno for k in knoten if isinstance(k, ast.Assert)]
    return any(
        isinstance(k, ast.Return)
        and not any(zeile < k.lineno for zeile in zeilen_mit_assert)
        for k in knoten
    )


def test_die_wache_zaehlt_attrappen_nicht_als_ausstieg():
    """Sonst meldet sie zwanzig Treffer, davon zwanzig falsche."""
    regel = ast.parse(
        "def test_etwas():\n"
        "    def attrappe():\n"
        "        return 3\n"
        "    assert attrappe() == 3\n"
    ).body[0]
    assert not _steigt_stumm_aus(regel)


def test_die_wache_findet_den_echten_ausstieg():
    """Die Form, die heute dreimal durchgerutscht ist."""
    regel = ast.parse(
        "def test_etwas():\n"
        "    if 'theme' not in code:\n"
        "        return\n"
        "    assert 'fallback' in code\n"
    ).body[0]
    assert _steigt_stumm_aus(regel)


@pytest.mark.parametrize("name", sorted(KITS))
def test_keine_regel_steigt_unbegruendet_aus(name):
    regeln = list(_regeln(KITS[name]))
    assert len(regeln) >= 8, (
        f"nur {len(regeln)} Regeln in {name} gefunden -- die Datei wurde "
        "umgebaut, und diese Pruefung sieht am falschen Ort nach")

    stumm = sorted(
        r.name for r in regeln
        if _steigt_stumm_aus(r) and r.name not in ERLAUBT
    )
    assert not stumm, (
        f"{stumm} koennen enden, ohne etwas geprueft zu haben. Genau so "
        "sah die Fallback-Regel aus, die einen Renderer mit fuenfzehn fest "
        "verdrahteten Farben durchgewunken hat. Entweder die Regel prueft "
        "auch auf diesem Weg etwas -- oder der Ausstieg kommt mit "
        "Begruendung nach ERLAUBT")


def test_die_erlaubnisliste_nennt_nur_regeln_die_es_gibt():
    """Sonst waechst sie zu und deckt irgendwann etwas Echtes."""
    vorhanden = {r.name for pfad in KITS.values() for r in _regeln(pfad)}
    verwaist = sorted(set(ERLAUBT) - vorhanden)
    assert not verwaist, (
        f"{verwaist} stehen in ERLAUBT, gibt es aber nicht mehr -- eine "
        "Ausnahmeliste, die niemand aufraeumt, deckt irgendwann eine Regel, "
        "die gerade kaputtgegangen ist")


# ── Von aussen: kann das Kit gegen das Nichts rot werden? ─────────────

def test_das_provider_kit_durchschaut_einen_provider_der_nichts_liefert():
    """Sechzehn Regeln, alle Schleifen ueber `nodes` und `edges`.

    Ohne die eine Regel, die auf Inhalt besteht, sind die anderen fuenfzehn
    umsonst: Eine Schleife ueber nichts ist immer im Recht.
    """
    leer = {
        "provider_id": "leer",
        "api_version": 1,
        "name": "Provider ohne Daten",
        "capabilities": {"nodes": True, "edges": True},
        "data": lambda: {"nodes": [], "edges": []},
    }
    assert provider_kit.check(leer), (
        "ein Provider, der nichts liefert, hat das Kit fehlerfrei bestanden")


def test_das_provider_kit_laesst_einen_erklaerten_leerlauf_durch():
    """Wer sagt, dass sein Aufbau leer ist, wird nicht dafuer bestraft."""
    leer = {
        "provider_id": "leer",
        "api_version": 1,
        "name": "Provider ohne Daten",
        "capabilities": {"nodes": True, "edges": True},
        "data": lambda: {"nodes": [], "edges": []},
    }
    assert provider_kit.check(leer, expects_data=False) == []


def test_das_provider_kit_laesst_einen_echten_provider_durch():
    """Die andere Haelfte: Ein Kit, das alles ablehnt, ist genauso nutzlos."""
    echt = {
        "provider_id": "echt",
        "api_version": 1,
        "name": "Provider mit einem Geraet",
        "capabilities": {"nodes": True},
        "data": lambda: {"nodes": [{"id": "a", "label": "A"}], "edges": []},
    }
    assert provider_kit.check(echt) == []


def test_das_renderer_kit_durchschaut_eine_leere_datei(tmp_path):
    datei = tmp_path / "index.html"
    datei.write_text("<html><body></body></html>", encoding="utf-8")
    assert renderer_kit.check([datei]), (
        "eine leere Seite hat das Renderer-Kit fehlerfrei bestanden")
    assert renderer_kit.check([datei], offline=True), (
        "und auch als Offline-Renderer -- dann excusiert der Schalter das "
        "Nichtstun, statt eine andere Quelle zu erlauben")


def test_beide_kits_tragen_dieselbe_fassungsnummer():
    """Zwei Dateien, die zusammen kopiert werden, muessen zusammen altern."""
    assert provider_kit.SDK_VERSION == renderer_kit.SDK_VERSION


# ── Der Provider-Kit-Regeln schlimmste Faelle im Einzelnen ────────────


def _anbieter(nodes, capabilities=None, **extra):
    registration = {
        "provider_id": "pruefling",
        "api_version": 1,
        "name": "Pruefling",
        "capabilities": capabilities or {"nodes": True},
        "data": lambda: {"nodes": nodes, "edges": []},
    }
    registration.update(extra)
    return registration

def test_anker_die_keine_liste_sind_fallen_auf():
    probleme = provider_kit.check(_anbieter(
        [{"id": "a", "anchors": "b"}]))
    assert any("anchors must be a list" in p for p in probleme)


def test_ein_anker_der_kein_dict_ist_faellt_auf():
    probleme = provider_kit.check(_anbieter([{"id": "a", "anchors": ["b"]}]))
    assert any("anchor must be a dict" in p for p in probleme)


def test_ein_anker_ohne_ziel_faellt_auf():
    probleme = provider_kit.check(_anbieter(
        [{"id": "a", "anchors": [{"weight": 1}]}]))
    assert any("anchor without an id" in p for p in probleme)


def test_ein_anker_ins_leere_faellt_auf():
    """Anchors at a node this payload never delivered resolve to nothing:
    the hub draws the device in the middle of the plan. Wrong place is
    worse than drawn nowhere -- so the kit hears about it here."""
    probleme = provider_kit.check(_anbieter(
        [{"id": "a", "anchors": [{"id": "phantom", "weight": 1}]}]))
    assert any("not one of your own nodes" in p for p in probleme)


def test_ein_anker_auf_sich_selbst_faellt_auf():
    probleme = provider_kit.check(_anbieter(
        [{"id": "a", "anchors": [{"id": "a", "weight": 1}]}]))
    assert any("anchors at itself" in p for p in probleme)


def test_ein_ankergewicht_das_keine_zahl_ist_faellt_auf():
    probleme = provider_kit.check(_anbieter([
        {"id": "a"},
        {"id": "b", "anchors": [{"id": "a", "weight": "schwer"}]},
    ]))
    assert any("must be a number" in p for p in probleme)


def test_ein_ankergewicht_unter_null_faellt_auf():
    """Fast immer eine Division, die schiefging -- im Mittel wuerde sie
    den Knoten an eine Stelle ziehen, an der niemand gemessen hat."""
    probleme = provider_kit.check(_anbieter([
        {"id": "a"},
        {"id": "b", "anchors": [{"id": "a", "weight": 0}]},
    ]))
    assert any("not positive" in p for p in probleme)

    probleme = provider_kit.check(_anbieter([
        {"id": "a"},
        {"id": "b", "anchors": [{"id": "a", "weight": -2}]},
    ]))
    assert any("not positive" in p for p in probleme)


def test_ein_ankergewicht_ohne_ende_faellt_auf():
    probleme = provider_kit.check(_anbieter([
        {"id": "a"},
        {"id": "b", "anchors": [{"id": "a", "weight": float("inf")}]},
    ]))
    assert any("not finite" in p for p in probleme)


def test_gut_geformte_anker_fallen_nicht_auf():
    probleme = provider_kit.check(_anbieter([
        {"id": "a", "anchors": [{"id": "b", "weight": 2}]},
        {"id": "b"},
    ]))
    assert not [p for p in probleme if "anchor" in p.lower()]


def test_aktionen_ohne_action_callable_fallen_auf():
    probleme = provider_kit.check(_anbieter(
        [{"id": "a", "actions": [{"id": "reboot"}]}]))
    assert any("registered no action callable" in p for p in probleme), probleme


def test_eine_aktion_ohne_id_faellt_auf():
    probleme = provider_kit.check(_anbieter(
        [{"id": "a", "actions": [{"label": "Neustart"}]}],
        capabilities={"nodes": True, "actions": True},
        action=lambda kind, item, act, data: {"success": True},
    ))
    assert any("has no id" in p for p in probleme), probleme


def test_ein_anbieter_mit_aktionen_faellt_nicht_auf():
    probleme = provider_kit.check(_anbieter(
        [{"id": "a", "actions": [{"id": "reboot"}]}],
        capabilities={"nodes": True, "actions": True},
        action=lambda kind, item, act, data: {"success": True},
    ))
    assert not [p for p in probleme if "action" in p.lower()], probleme


def test_ein_async_data_callable_wird_abgewartet():
    import asyncio

    async def daten():
        return {"nodes": [{"id": "a"}]}

    probleme = provider_kit.check(_anbieter(None, data=daten))
    assert probleme == [], probleme


def test_ein_kit_ohne_implementierung_sagt_was_zu_tun_ist():
    suite = provider_kit.SpatialHubConformance()
    with pytest.raises(NotImplementedError, match="build_registration"):
        suite.registration


def test_custom_icons_ohne_icon_set_fallen_auf():
    probleme = provider_kit.check(_anbieter(
        [{"id": "a"}], capabilities={"nodes": True, "custom_icons": True}))
    assert any("icon_set is empty" in p for p in probleme), probleme


# ── Die eigene Ausnahme des Renderer-Kits ist auch ein Weg ────────────


def _renderer_klasse(**attribute):
    suite = renderer_kit.SpatialHubRendererConformance()
    for name, wert in attribute.items():
        setattr(suite, name, wert)
    return suite


def test_ein_bearbeitender_renderer_darf_schreiben_wenn_er_es_sagt():
    """read_only = False ist eine erklaerte Ausnahme, kein Schlupfloch:
    die beiden Regeln steigen aus, statt einen Editor fälschlich anzuklagen."""
    suite = _renderer_klasse(read_only=False)
    suite.renderer_files = lambda: []
    assert suite.test_a_read_only_renderer_needs_almost_nothing() is None
    assert suite.test_it_never_writes_the_users_arrangement() is None


def test_ein_kit_ohne_implementierung_weist_den_weg():
    suite = _renderer_klasse()
    with pytest.raises(NotImplementedError, match="renderer_files"):
        suite.code


# ── Die Helfer des Shims ──────────────────────────────────────────────


def _shim():
    spec = importlib.util.spec_from_file_location(
        "shim_modul", WURZEL / "sdk" / "spatial_hub_provider.py")
    modul = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(modul)
    return modul


def test_anchor_baut_was_der_hub_versteht():
    anker = _shim().anchor("proxy-kueche", 0.8)
    assert anker == {"id": "proxy-kueche", "weight": 0.8}


def test_node_mit_ankern_trägt_sie_im_ergebnis():
    shim = _shim()
    knoten = shim.node("tag-1", anchors=[shim.anchor("proxy", 1.0)])
    assert knoten["anchors"] == [{"id": "proxy", "weight": 1.0}]
