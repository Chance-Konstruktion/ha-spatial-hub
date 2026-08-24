"""The community layer: a directory, templates, and docs that still resolve.

None of this is code the hub runs. It is the part of the project a stranger
meets first, and it rots differently from code -- silently, and without a
stack trace. These are the tests that notice.
"""

from __future__ import annotations

import ast
import re
from pathlib import Path

import pytest
import yaml

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "custom_components" / "spatial_hub"
DIRECTORY = ROOT / "docs" / "PROVIDERS.md"
TEMPLATES = ROOT / ".github" / "ISSUE_TEMPLATE"

def _ours(path: Path) -> bool:
    """Ist das eine Datei *dieses* Projekts -- und nicht Beiwerk?

    Geprueft wird der Pfad **ab der Projektwurzel**. Hier stand einmal
    ``path.parts``, also der absolute Pfad, und damit hing das Ergebnis
    daran, wo jemand das Repository ausgecheckt hat: Liegt es unter einem
    Ordner, dessen Name mit einem Punkt anfaengt, warf die Regel **jede**
    Datei weg -- alle fuenfzehn. Der Test darunter bekam eine leere Liste,
    meldete sich als Auslassung ("got empty parameter set") und prueft
    seither nichts. In der CI lief er, weil ``/builds/...`` keinen
    Punkt-Teil hat.

    Ein Test, dessen Ergebnis vom Ablageort abhaengt, ist schlimmer als
    keiner: Er ist gruen, wo niemand hinsieht.
    """
    return not any(
        part.startswith(".") or part == "node_modules"
        for part in path.relative_to(ROOT).parts
    )


MARKDOWN = sorted(path for path in ROOT.rglob("*.md") if _ours(path))


def _code_only(path: Path) -> str:
    """The file with its prose removed, but every string literal kept.

    Naming an integration in a comment is how the *reason* for a rule gets
    written down -- `theme.py` explains at length why there is no
    "Powerline blue" -- and deleting that explanation to satisfy a test
    would be the wrong trade. Naming one in a string literal is the actual
    bug this test is looking for, so literals stay.
    """
    text = path.read_text()
    if path.suffix != ".py":
        return re.sub(r"/\*.*?\*/|//[^\n]*", "", text, flags=re.S)

    lines = text.splitlines()
    for node in ast.walk(ast.parse(text)):
        if not isinstance(
            node, ast.Module | ast.ClassDef | ast.FunctionDef | ast.AsyncFunctionDef
        ):
            continue
        first = node.body[0] if node.body else None
        if isinstance(first, ast.Expr) and isinstance(first.value, ast.Constant):
            if isinstance(first.value.value, str):
                for index in range(first.lineno - 1, first.end_lineno):
                    lines[index] = ""
    return re.sub(r"#[^\n]*", "", "\n".join(lines))


def _listed_domains() -> list[str]:
    """The domains from the directory table, one per row."""
    rows = re.findall(r"^\|(?!\s*-)(.+)\|$", DIRECTORY.read_text(), re.MULTILINE)
    domains = []
    for row in rows:
        cells = [cell.strip() for cell in row.split("|")]
        if len(cells) >= 2 and cells[1].startswith("`"):
            domains.append(cells[1].strip("`"))
    return domains


# ── The directory ─────────────────────────────────────────


def test_the_directory_actually_lists_somebody():
    assert _listed_domains(), (
        "no domain parsed out of PROVIDERS.md -- either the table is empty "
        "or its shape changed and this file's parser went blind with it"
    )


def test_the_directory_stays_documentation():
    """The list must never become something the code consults.

    This is where a project like this usually cracks: first the list is
    there to look things up in, then it has one special case in it, then
    nothing works without it. A name in the directory and a name in the
    source are the same mistake seen from two sides.
    """
    source = "\n".join(
        _code_only(path).lower()
        for path in SOURCE.rglob("*")
        if path.suffix in {".py", ".js", ".json"}
    )
    for domain in _listed_domains():
        assert domain.lower() not in source, (
            f"{domain!r} is in the provider directory and in the hub's own "
            "source -- the moment those two meet, every integration that is "
            "not on the list is a second-class citizen"
        )


# ── Docs that still point somewhere ───────────────────────


def test_the_link_check_actually_has_documents_to_check():
    """Die Wache fuer die Wache.

    ``MARKDOWN`` speist einen parametrisierten Test. Ist die Liste leer,
    laeuft der nicht -- er meldet sich als Auslassung, und ein gruener
    Lauf mit einer Auslassung darin sieht aus wie ein gruener Lauf. Genau
    das ist passiert: Ein Filter sah den absoluten Pfad an, das
    Repository lag unter einem Ordner mit Punkt im Namen, und alle
    fuenfzehn Dokumente fielen heraus.

    ``empty_parameter_set_mark = fail_at_collect`` in der ``pytest.ini``
    faengt den Fall inzwischen allgemein ab. Dieser Test hier sagt
    zusaetzlich, *was* mindestens dabei sein muss -- eine Liste, die
    stillschweigend auf drei Dateien zusammenschrumpft, waere ebenfalls
    kaputt und nicht leer.
    """
    namen = {path.relative_to(ROOT).as_posix() for path in MARKDOWN}
    for pflicht in ("README.md", "ROADMAP.md", "docs/SPECIFICATION.md",
                    "CONTRIBUTING.md"):
        assert pflicht in namen, (
            f"{pflicht} wird nicht auf tote Links geprueft -- gefunden: "
            f"{sorted(namen)}"
        )
    assert len(MARKDOWN) >= 10, f"nur {len(MARKDOWN)} Dokumente gefunden"


@pytest.mark.parametrize("document", MARKDOWN, ids=lambda p: str(p.relative_to(ROOT)))
def test_every_local_link_resolves(document):
    """A broken link in the onboarding path costs us the reader, silently."""
    for target in re.findall(r"\]\(([^)\s]+)\)", document.read_text()):
        if target.startswith(("http://", "https://", "#", "mailto:")):
            continue
        path = (document.parent / target.split("#")[0]).resolve()
        assert path.exists(), f"{document.name} links to {target}, which is not there"


def test_both_translations_tell_the_same_story():
    """The English page is the one that gets pasted into a stranger's repo.

    A German user reading the German page and an English maintainer reading
    what arrived must be looking at the same offer.
    """
    german = (ROOT / "docs" / "ASK_FOR_SUPPORT.de.md").read_text()
    english = (ROOT / "docs" / "ASK_FOR_SUPPORT.en.md").read_text()

    for shared in (
        "from .spatial_hub_provider import spatial_provider",
        "python3 sdk/install.py --into custom_components/",
    ):
        assert shared in german and shared in english, (
            f"{shared!r} is missing from one of the two request texts -- "
            "one of them has been edited and the other has not"
        )
    assert "ASK_FOR_SUPPORT.en.md" in german, (
        "the German page must send the reader to the English text, or they "
        "will file a German issue in an English repository"
    )


# ── Issue templates ───────────────────────────────────────


def _template_targets(template):
    """Die Dateien, auf die eine Vorlage verweist."""
    return re.findall(r"blob/main/(\S+?)(?=[)\s]|$)", template.read_text())


@pytest.mark.parametrize(
    "template", sorted(TEMPLATES.glob("*.yml")), ids=lambda p: p.name
)
def test_the_templates_are_valid_yaml(template):
    """GitHub renders a broken template as nothing at all, without telling us."""
    assert yaml.safe_load(template.read_text()) is not None


def test_the_first_thing_an_issue_offers_is_not_filing_an_issue():
    """Most people arriving here do not need us; they need the editor.

    Every request routed to the generic adapter or to the SDK is a request
    that never becomes a maintainer's problem -- ours or somebody else's.
    """
    config = yaml.safe_load((TEMPLATES / "config.yml").read_text())
    urls = " ".join(link["url"] for link in config["contact_links"])

    assert "ASK_FOR_SUPPORT" in urls
    assert "sdk/README.md" in urls


@pytest.mark.parametrize(
    "template", sorted(TEMPLATES.glob("*.yml")), ids=lambda p: p.name
)
def test_the_templates_link_to_files_that_exist(template):
    for target in _template_targets(template):
        assert (ROOT / target).exists(), f"{template.name} points at missing {target}"


def test_the_templates_still_point_at_something():
    """Eine Schleife ueber nichts behauptet nichts.

    Die Pruefung darueber laeuft je Vorlage, und **eine einzelne Vorlage
    darf** ohne Verweis auskommen -- eine Fehlermeldung braucht keinen
    Link auf den Quelltext. Nachgemessen ist ``bug.yml`` genau so eine.
    Deshalb steht die Mindestzahl hier, ueber alle Vorlagen zusammen: So
    faellt auf, wenn die Verweise insgesamt verschwinden, ohne dass jede
    einzelne Vorlage einen tragen muss.
    """
    ziele = [
        ziel
        for vorlage in sorted(TEMPLATES.glob("*.yml"))
        for ziel in _template_targets(vorlage)
    ]
    assert ziele, "keine einzige Vorlage verweist noch auf eine Datei"
