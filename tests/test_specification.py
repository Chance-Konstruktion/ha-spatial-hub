"""The specification is normative, so it is tested like code.

A document that describes an older version of the implementation is worse
than no document: it is a promise the code does not keep. These tests hold
the two together at the only places where they can silently drift apart --
the vocabularies, the version numbers, and the field names a provider is
told to send.

They deliberately check *presence*, not prose. Nobody should have to
rewrite a test to improve a sentence.
"""

from __future__ import annotations

import re
from pathlib import Path

import pytest

from custom_components.spatial_hub.const import (
    API_VERSION,
    AREA_KIND_ALIASES,
    CURRENT_SDK_VERSION,
    OUTDOOR_MARGIN,
    AreaKind,
)

from conftest import renderer_source

SPEC = Path(__file__).resolve().parents[1] / "docs" / "SPECIFICATION.md"
PANEL_JS = (
    Path(__file__).resolve().parents[1]
    / "custom_components" / "spatial_hub" / "www" / "spatial-hub-panel.js"
)
SHIM = Path(__file__).resolve().parents[1] / "sdk" / "spatial_hub_provider.py"


@pytest.fixture(scope="module")
def spec() -> str:
    return SPEC.read_text()


def test_the_specification_exists_and_says_what_it_is(spec):
    assert spec.startswith("# Spatial Provider Specification")
    assert re.search(r"\*\*Version \d+\.\d+\*\*", spec), "a version, on the first page"


def test_every_chapter_the_specification_promises_is_there(spec):
    """The table of contents is the contract with the reader."""
    for chapter in ("Node", "Edge", "Layer", "Position", "Popup", "Action",
                    "Theme", "Icon", "Camera", "Area Type"):
        assert f"## § {chapter}" in spec, f"missing chapter: {chapter}"


def test_the_area_kinds_are_the_ones_the_code_has(spec):
    # The kinds themselves, not the sandwich flags further down.
    section = spec.split("## § Area Type", 1)[1].split("### Sandwich", 1)[0]
    for kind in AreaKind:
        assert f"`{kind.value}`" in section, (
            f"{kind.value} exists in code but not in the specification"
        )
    # And nothing the code does not have is promised as a fourth kind.
    promised = set(re.findall(r"^\| `(\w+)` \| ", section, re.M))
    assert promised <= {kind.value for kind in AreaKind}


def test_the_specification_insists_the_kinds_are_an_enum(spec):
    """The one thing this chapter exists to prevent."""
    section = spec.split("## § Area Type", 1)[1]
    assert "AreaKind" in section
    assert "outside" in section, "the mistake is named, so it is recognisable"


def test_a_near_miss_is_repaired_and_nonsense_is_not(caplog):
    assert AreaKind.parse("outside") is AreaKind.OUTDOOR
    assert AreaKind.parse("Außen") is AreaKind.OUTDOOR
    assert AreaKind.parse("GARDEN") is AreaKind.OUTDOOR
    assert AreaKind.parse("cloud") is AreaKind.VIRTUAL
    assert AreaKind.parse("indoor") is AreaKind.INDOOR
    # Genuinely unrecognised stays unrecognised: the caller decides what to
    # do about it, and is expected to say so out loud.
    assert AreaKind.parse("banana") is None
    assert AreaKind.parse("banana", AreaKind.INDOOR) is AreaKind.INDOOR
    assert AreaKind.parse(None) is None


def test_no_alias_shadows_a_real_kind():
    assert not {kind.value for kind in AreaKind} & set(AREA_KIND_ALIASES)


def test_an_unknown_stored_kind_is_reported_not_swallowed(hass, caplog):
    """A typo must cost a log line, never the floor plan."""
    from homeassistant.helpers import area_registry as ar, floor_registry as fr

    from conftest import FakeArea, FakeFloor
    from custom_components.spatial_hub.hub import SpatialHub
    from custom_components.spatial_hub.storage import LayoutStore

    fr.async_get(hass).floors = [FakeFloor("eg", "Erdgeschoss", level=0)]
    ar.async_get(hass).areas = [FakeArea("buero", "Büro", floor_id="eg")]
    hub = SpatialHub(hass, LayoutStore(hass))
    hub.store.update("areas", "buero", {"kind": "somewhere_else"})

    import asyncio

    model = asyncio.run(hub.async_model())
    area = next(entry for entry in model["areas"] if entry["id"] == "buero")

    assert area["kind"] == AreaKind.INDOOR.value, "still drawn, as a room"
    assert "somewhere_else" in caplog.text
    assert "indoor" in caplog.text, "and the valid values are in the message"


def test_the_renderer_speaks_the_same_vocabulary():
    """Both sides of the wire compare against constants, not literals."""
    source = renderer_source()
    assert "const AREA_KIND = Object.freeze(" in source
    for kind in AreaKind:
        assert f'"{kind.value}"' in source


def test_the_shim_carries_the_vocabulary_to_providers():
    """A provider should never have to retype these three words."""
    source = SHIM.read_text()
    assert "class AreaKind(StrEnum)" in source
    for kind in AreaKind:
        assert f'{kind.name} = "{kind.value}"' in source


def test_the_version_numbers_in_the_specification_are_the_real_ones(spec):
    header = spec.split("\n\n", 2)[1]
    assert f"Provider API v{API_VERSION}" in header
    assert f"SDK v{CURRENT_SDK_VERSION}" in header


def test_the_apron_the_specification_documents_is_the_one_in_the_code(spec):
    section = spec.split("## § Position", 1)[1]
    assert f"{OUTDOOR_MARGIN:.2f}".replace(".", ",") in section, (
        "the outdoor margin is a number a renderer implements against"
    )


def test_the_node_fields_the_specification_lists_all_exist():
    """A provider following the document must not hit an unknown field."""
    from custom_components.spatial_hub.models import Node

    documented = set(
        re.findall(r"^\| `(\w+)` \|", SPEC.read_text().split("## § Node", 1)[1]
                   .split("## § Edge", 1)[0], re.M)
    )
    fields = set(Node.from_dict({"id": "x"}).as_dict())
    assert documented <= fields, f"documented but absent: {documented - fields}"


def test_every_stored_area_field_is_documented(spec):
    """A field the editor writes and the document never mentions is a field
    nobody else can implement.

    `doors` was exactly that for a while: stored, served, validated on the
    wire and drawn -- and absent from the one document a second renderer
    would read. The vocabulary tests above could not catch it, because they
    check the words a *provider* sends, and this is the user's own layout.
    """
    from custom_components.spatial_hub.storage import _AREA_KEYS

    # `color` and `hidden` are not geometry and are covered elsewhere in the
    # document by prose rather than a field name.
    geometry = _AREA_KEYS - {"color", "hidden"}
    missing = {key for key in geometry if f"`{key}`" not in spec}
    assert not missing, f"stored but undocumented: {sorted(missing)}"


# ── Rückverfolgung: wer prüft welche Zusage ───────────────

ROOT = SPEC.parent.parent
PRUEFUNGEN = ROOT / "docs" / "PRUEFUNGEN.md"

# Die normativen Wörter im Sinne von RFC 2119, wie die Spezifikation sie
# benutzt. Reihenfolge zählt: "MUSS NICHT" vor "MUSS".
NORMATIV = (
    r"(?:MUSS NICHT|MUSS|MÜSSEN|SOLL NICHT|SOLLTE NICHT|SOLLTE|SOLLEN|SOLL"
    r"|DARF NICHT|DÜRFEN|DARF)"
)


def _bloecke(text: str) -> list[str]:
    """Die Spezifikation in Absätze und Listenpunkte zerlegt."""
    aus: list[str] = []
    akt: list[str] = []
    for zeile in text.splitlines():
        if zeile.strip().startswith(("- ", "* ", "#")) or not zeile.strip():
            if akt:
                aus.append(" ".join(akt))
                akt = []
        if zeile.strip():
            akt.append(zeile.strip())
    if akt:
        aus.append(" ".join(akt))
    return aus


def _kennung(block: str) -> str:
    """Stabile Kennung einer Regel: Hash über ihren Text ohne Auszeichnung.

    Wird eine Regel umformuliert, ändert sich die Kennung und ihr Eintrag
    fällt auf. Das ist gewollt -- eine geänderte Zusage will neu geprüft
    werden, und niemand merkt das von selbst.
    """
    import hashlib

    kern = re.sub(r"\s+", " ", re.sub(r"[`*_]", "", block)).strip()
    return hashlib.sha256(kern.encode()).hexdigest()[:8]


def _regeln() -> dict[str, str]:
    """Jede normative Stelle der Spezifikation, nach Kennung."""
    gefunden: dict[str, str] = {}
    for block in _bloecke(SPEC.read_text(encoding="utf-8")):
        if "RFC 2119" in block:
            continue                      # die Definition selbst
        ohne = re.sub(r"[`*_]", "", block)
        if not re.search(rf"(?<![\wÄÖÜäöüß]){NORMATIV}(?![\wÄÖÜäöüß])", ohne):
            continue
        gefunden[_kennung(block)] = ohne
    return gefunden


def _tabelle() -> dict[str, tuple[str, str]]:
    """Die Rückverfolgungstabelle, nach Kennung."""
    zeilen = {}
    for zeile in PRUEFUNGEN.read_text(encoding="utf-8").splitlines():
        treffer = re.match(r"\|\s*([0-9a-f]{8})\s*\|\s*(\w+)\s*\|\s*(.+?)\s*\|$",
                           zeile)
        if treffer:
            zeilen[treffer.group(1)] = (treffer.group(2), treffer.group(3))
    return zeilen


def test_every_promise_in_the_specification_has_an_entry():
    """Eine Zusage, die niemand prüft, ist Erzählung mit Großbuchstaben.

    Der Eintrag darf ``prosa`` oder ``offen`` sagen -- was er nicht darf,
    ist fehlen. Eine neue Regel ohne Zeile macht diesen Lauf rot, und das
    ist der einzige Zeitpunkt, an dem jemand darüber nachdenkt.
    """
    fehlend = sorted(set(_regeln()) - set(_tabelle()))
    assert not fehlend, "\n".join(
        [f"{len(fehlend)} normative Stelle(n) ohne Eintrag in docs/PRUEFUNGEN.md:"]
        + [f"  | {k} | offen | ??? |   <- {_regeln()[k][:90]}" for k in fehlend]
    )


def test_the_table_carries_no_rule_the_specification_lost():
    """Eine Zeile ohne Regel dahinter behauptet eine Prüfung ins Leere."""
    verwaist = sorted(set(_tabelle()) - set(_regeln()))
    assert not verwaist, (
        f"{len(verwaist)} Zeile(n) in docs/PRUEFUNGEN.md gehören zu keiner "
        f"Regel mehr (umformuliert oder gestrichen): {verwaist}"
    )


def test_every_named_check_actually_exists():
    """Man kann nicht behaupten, etwas sei geprüft.

    Der Sinn der Tabelle steht und fällt damit. Eine Zeile, die auf einen
    Test zeigt, den es nicht gibt, ist schlimmer als ``offen``: Sie sagt,
    hier sei alles in Ordnung.
    """
    quellen = "\n".join(
        pfad.read_text(encoding="utf-8")
        for pfad in [
            *sorted((ROOT / "tests").glob("*.py")),
            *sorted((ROOT / "tests").glob("*.mjs")),
            *sorted((ROOT / "sdk").glob("*.py")),
        ]
    )
    erfunden = [
        (kennung, name)
        for kennung, (wer, name) in _tabelle().items()
        if wer in {"panel", "hub", "kit"} and name.strip("`") not in quellen
    ]
    assert not erfunden, "\n".join(
        ["Diese Zeilen nennen eine Prüfung, die es nicht gibt:"]
        + [f"  {k}: {n}" for k, n in erfunden]
    )


# Wie viele Zusagen heute unbewacht sind. Diese Zahl darf **fallen**, nie
# steigen: Eine neue Regel ohne Prüfung ist eine Entscheidung und kein
# Versehen, und sie soll auffallen, während jemand hinsieht.
#
# Sie stand bei ihrer Einführung auf 6. Alle sechs waren gebaut und nur
# unbewacht -- das ist der Normalfall und der Grund, warum die Tabelle
# überhaupt etwas taugt: Sie hat nicht sechs Fehler gefunden, sondern
# sechs Stellen, an denen ein Fehler unbemerkt entstehen konnte.
OFFENE_ZUSAGEN = 0


def test_the_number_of_unchecked_promises_does_not_grow():
    offen = sorted(k for k, (wer, _) in _tabelle().items() if wer == "offen")
    assert len(offen) <= OFFENE_ZUSAGEN, (
        f"{len(offen)} ungeprüfte Zusagen, erlaubt sind {OFFENE_ZUSAGEN}: {offen}"
    )
    assert len(offen) == OFFENE_ZUSAGEN or True
