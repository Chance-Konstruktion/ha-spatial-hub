"""Die erzeugte Webseite -- vor allem ihre Verweise.

Aus `docs/PROVIDERS.md` muss auf der Seite `PROVIDERS.html` werden. Das
ist die einzige wirkliche Arbeit beim Bauen, und es ist die Stelle, an
der so etwas still bricht: Die Seite entsteht, sieht richtig aus, und
jeder dritte Verweis fuehrt ins Leere. Niemand merkt es, weil niemand
alle Seiten durchklickt.

Jede Pruefung hier hat eine Nichtleer-Wache. Beim ersten Anlauf sah mein
Pruefskript in einen Ordner, den es gar nicht gab, fand null Dateien und
meldete stolz null tote Verweise. Eine Schleife ueber nichts ist immer im
Recht -- und ausgerechnet in diesem Repo waere das eine peinliche Art,
gruen zu sein.
"""

from __future__ import annotations

import importlib.util
import re
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]

_spec = importlib.util.spec_from_file_location("seite", ROOT / "tools" / "seite.py")
seite = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(seite)

markdown = pytest.importorskip(
    "markdown", reason="python-markdown fehlt; die CI installiert es")


@pytest.fixture(scope="module")
def gebaut(tmp_path_factory):
    ordner = tmp_path_factory.mktemp("seite")
    seite.bauen(ordner)
    return ordner


def _seiten(ordner: Path) -> dict[str, str]:
    dateien = {p.name: p.read_text(encoding="utf-8") for p in ordner.glob("*.html")}
    assert dateien, "kein einziges HTML erzeugt -- alles Weitere waere eine Schleife ueber nichts"
    return dateien


def test_jede_gelistete_seite_entsteht(gebaut):
    dateien = _seiten(gebaut)
    assert len(dateien) == len(seite.SEITEN)
    for _quelle, ziel, _name in seite.SEITEN:
        assert ziel in dateien, f"{ziel} fehlt"


def test_es_gibt_eine_startseite(gebaut):
    assert "index.html" in _seiten(gebaut), (
        "ohne index.html zeigt die Adresse der Seite auf eine Dateiliste")


def test_kein_interner_verweis_geht_ins_leere(gebaut):
    dateien = _seiten(gebaut)
    geprueft = 0
    tot = []
    for name, text in dateien.items():
        for ziel in re.findall(r'href="([^"]+)"', text):
            if ziel.startswith(("http://", "https://", "#", "mailto:")):
                continue
            geprueft += 1
            if ziel.split("#")[0] not in dateien:
                tot.append(f"{name} -> {ziel}")
    assert geprueft > 10, (
        f"nur {geprueft} interne Verweise geprueft -- das koennen nicht alle "
        "sein, also greift die Pruefung nicht")
    assert not tot, "tote Verweise: " + ", ".join(tot[:8])


def test_kein_verweis_zeigt_noch_auf_eine_md_datei(gebaut):
    """Der Fehler, den das Umschreiben verhindern soll.

    Ein uebrig gebliebenes `.md` ist auf der Webseite immer tot: Die
    Markdown-Dateien werden nicht mit veroeffentlicht.
    """
    uebrig = [
        f"{name} -> {ziel}"
        for name, text in _seiten(gebaut).items()
        for ziel in re.findall(r'href="([^"]+)"', text)
        if ziel.split("#")[0].endswith(".md") and not ziel.startswith("http")
    ]
    assert not uebrig, "nicht umgeschrieben: " + ", ".join(uebrig[:8])


def test_was_nicht_auf_die_seite_kommt_zeigt_ins_repository(gebaut):
    """`examples/second_renderer/` gibt es hier nicht -- also nach GitLab.

    Ein Verweis, der ins Leere zeigt, ist auf einer Doku-Seite besonders
    aergerlich: Die Seite existiert ja, sie fuehrt nur nirgendwohin.
    """
    text = _seiten(gebaut)["index.html"]
    hinaus = [z for z in re.findall(r'href="([^"]+)"', text)
              if z.startswith(seite.REPO)]
    assert hinaus, (
        "kein einziger Verweis zeigt ins Repository -- entweder wurde nichts "
        "umgeschrieben, oder die Startseite hat keine Verweise mehr auf "
        "Dateien ausserhalb der Seite")


def test_die_navigation_steht_auf_jeder_seite(gebaut):
    for name, text in _seiten(gebaut).items():
        assert 'href="index.html"' in text, f"{name} hat keinen Weg zurueck"
        assert text.count("<nav>") == 1, f"{name}: Navigation fehlt oder doppelt"


def test_tabellen_werden_wirklich_zu_tabellen(gebaut):
    """Die Doku besteht zu einem guten Teil aus Tabellen.

    Ohne die `tables`-Erweiterung von markdown werden daraus Absaetze
    voller Striche -- lesbar genug, dass es niemandem sofort auffaellt,
    und unbrauchbar genug, dass die Seite ihren Zweck verfehlt.
    """
    assert "<table>" in _seiten(gebaut)["PROVIDERS.html"], (
        "das Provider-Verzeichnis ist eine Tabelle und kommt nicht als "
        "solche heraus")


def test_die_seitenliste_nennt_keine_datei_die_es_nicht_gibt(gebaut):
    for quelle, _ziel, _name in seite.SEITEN:
        assert (ROOT / quelle).is_file(), f"{quelle} steht in der Liste, fehlt aber"


def test_jede_dokudatei_im_repo_kommt_auch_vor():
    """Sonst waechst die Doku und die Seite bleibt stehen.

    Laeuft ohne Bauen: Es ist eine Frage an das Repo, nicht an die Ausgabe.
    """
    gelistet = {q for q, _z, _n in seite.SEITEN}
    vorhanden = {
        str(p.relative_to(ROOT)).replace("\\", "/")
        for p in (ROOT / "docs").glob("*.md")
    }
    fehlt = sorted(vorhanden - gelistet)
    assert not fehlt, (
        f"{fehlt} liegen in docs/, stehen aber nicht in SEITEN -- die Seite "
        "waechst sonst nicht mit der Dokumentation mit")
