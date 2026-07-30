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
    source = PANEL_JS.read_text()
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
