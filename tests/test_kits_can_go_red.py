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
