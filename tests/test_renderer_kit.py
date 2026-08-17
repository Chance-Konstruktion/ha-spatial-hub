"""The renderer conformance kit, held against the hub it describes.

The kit ships to other people's repositories, so it cannot import the hub,
read the documentation or ask Home Assistant anything. Everything it knows
-- the commands, the presets, the integration names -- is a **copy**.

Copies drift. And a conformance kit that has drifted is the worst of both
worlds: it still runs, still passes, still hands out a clean bill of
health, while checking a hub that no longer exists. It had already
happened once. The list this kit grew out of was written as "everything a
renderer may send, from docs/PROVIDER_API.md" and was missing
`area/assign` -- documented, registered, and rejected by the check.

This file is where that drift becomes a red pipeline instead.
"""

from __future__ import annotations

import importlib.util
import re
from pathlib import Path

import pytest

_SDK = Path(__file__).resolve().parents[1] / "sdk"


def _load(name: str):
    """Load an SDK file by path, the way an outside repository copies it.

    Not `from sdk import ...`: these files are meant to be copied into
    someone else's test suite as single files, and importing them as a
    package here would let a package-only mistake pass unnoticed.
    """
    spec = importlib.util.spec_from_file_location(name, _SDK / f"{name}.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


kit = _load("spatial_hub_renderer_conformance")

ROOT = Path(__file__).resolve().parents[1]
WEBSOCKET = ROOT / "custom_components" / "spatial_hub" / "websocket.py"
API_DOC = ROOT / "docs" / "PROVIDER_API.md"
DIRECTORY = ROOT / "docs" / "RENDERERS.md"
PROVIDER_DIRECTORY = ROOT / "docs" / "PROVIDERS.md"
SECOND = ROOT / "examples" / "second_renderer" / "index.html"

# The one renderer the hub ships itself. Its files live in this repository
# and are loaded by name, so finding it in the source is not a violation --
# it is the definition. The exemption lives here rather than in the table
# so that nobody can grant it to themselves by editing a document.
BUILT_IN = {"panel"}


def _registered() -> set[str]:
    """The commands websocket.py actually registers."""
    source = WEBSOCKET.read_text(encoding="utf-8")
    return set(re.findall(r'DOMAIN\}/([a-z/]+)"', source))


def _documented() -> set[str]:
    """The commands the API document names, in backticks."""
    doc = API_DOC.read_text(encoding="utf-8")
    return set(re.findall(r"`spatial_hub/([a-z/]+)`", doc))


def _table_cells(document: Path, column: int) -> list[str]:
    """One column of a markdown table, header and separator skipped.

    Split into cells rather than matched with one regex: a domain like
    `espeasy_p2p` contains a digit, and a tidy-looking `[a-z_]+` drops it
    without a word. Which is how a directory check ends up covering seven
    of eight entries and still looking thorough.
    """
    rows = re.findall(r"^\|(?!\s*-)(.+)\|$", document.read_text(encoding="utf-8"),
                      re.MULTILINE)
    out = []
    for row in rows:
        cells = [c.strip() for c in row.split("|")]
        if len(cells) > column and cells[column].startswith("`"):
            out.append(cells[column].strip("`"))
    return out


# ── The kit against the hub ───────────────────────────────


def test_the_kit_knows_every_command_the_hub_registers():
    missing = sorted(_registered() - kit.DOCUMENTED)
    assert not missing, (
        f"the hub registers {missing}, the kit does not list them -- a "
        "renderer using one would be told it is undocumented, which it is not"
    )


def test_the_kit_invents_no_command_the_hub_does_not_have():
    extra = sorted(kit.DOCUMENTED - _registered())
    assert not extra, (
        f"the kit allows {extra}, the hub does not register them -- a "
        "renderer would be waved through for a command nobody answers"
    )


def test_the_documentation_and_the_code_agree():
    """If these two ever part ways, the kit cannot be right about both."""
    assert _documented() == _registered(), (
        f"only documented: {sorted(_documented() - _registered())}; "
        f"only registered: {sorted(_registered() - _documented())}"
    )


def test_the_kit_knows_every_preset_the_hub_ships():
    from custom_components.spatial_hub.theme import PRESETS

    shipped = set(PRESETS) - {"auto"}
    assert shipped == kit.PRESETS, (
        f"only shipped: {sorted(shipped - kit.PRESETS)}; only in the kit: "
        f"{sorted(kit.PRESETS - shipped)}. A preset the kit does not know can "
        "be hard-coded into a renderer without anybody objecting"
    )


def test_the_kit_forbids_every_integration_in_the_directory():
    """Whoever is listed as a provider must not be nameable in a renderer.

    The empty-list guard is not decoration. Written with the wrong column
    index, this test read no rows at all and passed on the spot -- a loop
    over nothing is always in the clear. In a file whose whole subject is
    checks that stopped checking, that was a fitting way to be caught.
    """
    domains = _table_cells(PROVIDER_DIRECTORY, 1)
    assert len(domains) >= 8, (
        f"only {len(domains)} provider domains read from the directory, "
        "which lists more -- the table is being parsed wrongly, and a loop "
        "over the wrong rows checks nothing while passing"
    )
    for domain in domains:
        assert any(name in domain for name in kit.INTEGRATIONS), (
            f"the provider {domain!r} is in the directory, but no entry of "
            "kit.INTEGRATIONS matches it -- a renderer could special-case it "
            "and the kit would say nothing"
        )


def test_both_kits_carry_the_same_version():
    provider_kit = _load("spatial_hub_conformance")

    assert kit.SDK_VERSION == provider_kit.SDK_VERSION, (
        "the two kits are copied together into other repositories; differing "
        "versions there are impossible to reason about"
    )


# ── The kit against itself ────────────────────────────────

# Each entry breaks exactly one rule. If the kit stays silent on one of
# them, that rule has stopped working -- and a silent rule is worse than a
# missing one, because it is counted as coverage.
KAPUTT = {
    "undocumented command": """
        <script>conn.sendMessagePromise({type: "spatial_hub/teleport"});</script>
    """,
    "writes the layout": """
        <script>
          conn.sendMessagePromise({type: "spatial_hub/model"});
          conn.sendMessagePromise({type: "spatial_hub/layout/set", x: 1});
        </script>
    """,
    "reaches into the hub": """
        <script type="module">
          import {draw} from "../custom_components/spatial_hub/www/x.js";
          conn.sendMessagePromise({type: "spatial_hub/model"});
        </script>
    """,
    "names a preset": """
        <script>
          conn.sendMessagePromise({type: "spatial_hub/model"});
          const ink = preset === "blueprint" ? "#0af" : "#333";
        </script>
    """,
    "names an integration": """
        <script>
          conn.sendMessagePromise({type: "spatial_hub/model"});
          if (node.id.startsWith("powerline")) { special(node); }
        </script>
    """,
    "ignores the theme fallback": """
        <script>
          conn.sendMessagePromise({type: "spatial_hub/model"});
          const ink = model.theme.ink;
        </script>
    """,
    "draws nothing at all": "<html><body>Hallo</body></html>",
}


@pytest.mark.parametrize("was", sorted(KAPUTT))
def test_the_kit_notices_a_broken_renderer(was, tmp_path):
    """The one assumption the whole kit rests on: that it can go red.

    A kit that passes everything is not a kit, it is a green tick with a
    long docstring. So every rule gets a renderer built to break it, and
    has to say so.
    """
    datei = tmp_path / "index.html"
    datei.write_text(KAPUTT[was], encoding="utf-8")

    probleme = kit.check([datei])

    assert probleme, (
        f"a renderer that {was} passed the kit unchallenged -- one of the "
        "rules is no longer checking anything"
    )


def test_the_kit_passes_a_renderer_that_is_actually_fine(tmp_path):
    """The other half, and the more embarrassing one to get wrong.

    A kit that rejects everything also never lets a mistake through -- and
    is just as useless. This is the smallest renderer that ought to pass.
    """
    datei = tmp_path / "index.html"
    datei.write_text("""
        <script>
          const model = await conn.sendMessagePromise({type: "spatial_hub/model"});
          conn.subscribeMessage(draw, {type: "spatial_hub/subscribe"});
          const ink = model.theme.ink || model.theme.fallback.ink;
        </script>
    """, encoding="utf-8")

    assert kit.check([datei]) == []


def test_the_kit_passes_the_renderer_we_actually_ship():
    """And on the real thing, which is the point of shipping an example."""
    assert kit.check([SECOND]) == []


# ── The directory ─────────────────────────────────────────


def test_the_renderer_directory_exists_and_has_entries():
    assert DIRECTORY.is_file(), "docs/RENDERERS.md is missing"
    assert _table_cells(DIRECTORY, 1), (
        "the renderer directory has no entries -- then the claim that the "
        "built-in panel is one of several has nothing behind it again"
    )


def test_the_hub_names_no_renderer_from_the_directory():
    """The same discipline the provider directory lives under.

    A list to look things up in becomes a list with one special case,
    then a list without which nothing works. The way to stop that is to
    make it impossible: nothing in the hub may know these names.
    """
    quelle = ROOT / "custom_components" / "spatial_hub"
    dateien = [p for p in quelle.rglob("*") if p.suffix in (".py", ".js")]
    kennungen = _table_cells(DIRECTORY, 1)
    assert kennungen, "no renderer ids read from the directory"
    assert BUILT_IN <= set(kennungen), (
        f"{sorted(BUILT_IN - set(kennungen))} is exempted here but is not in "
        "the directory at all -- an exemption for a row that does not exist "
        "quietly widens over time"
    )
    for renderer_id in sorted(set(kennungen) - BUILT_IN):
        for datei in dateien:
            assert renderer_id not in datei.read_text(encoding="utf-8"), (
                f"{datei.relative_to(ROOT)} names the renderer "
                f"{renderer_id!r}. The directory is documentation; the moment "
                "the code reads it, entering yourself stops being free"
            )


# ── The recording ─────────────────────────────────────────


def test_the_recorded_model_is_what_the_hub_produces_today():
    """A stale fixture is worse than none, and it goes stale in silence.

    `examples/modell.json` exists so somebody can build a renderer without
    a Home Assistant install. The moment the model gains a field and the
    recording does not, they build against a house that no longer exists --
    and nothing anywhere turns red to say so. So the recording is compared
    against a fresh run of its own recorder.

        python examples/record_model.py > examples/modell.json
    """
    import json
    import subprocess
    import sys

    aufnahme = ROOT / "examples" / "modell.json"
    assert aufnahme.is_file(), "examples/modell.json is missing"

    frisch = subprocess.run(
        [sys.executable, str(ROOT / "examples" / "record_model.py")],
        capture_output=True, text=True, encoding="utf-8", cwd=ROOT,
    )
    assert frisch.returncode == 0, (
        f"the recorder itself fails:\n{frisch.stderr[-2000:]}"
    )
    assert json.loads(frisch.stdout) == json.loads(
        aufnahme.read_text(encoding="utf-8")
    ), (
        "examples/modell.json no longer matches what the recorder produces. "
        "Regenerate it: python examples/record_model.py > examples/modell.json"
    )


def test_the_recording_shows_the_cases_a_renderer_gets_wrong():
    """A fixture of only tidy rooms teaches only the tidy case."""
    import json

    m = json.loads((ROOT / "examples" / "modell.json").read_text(encoding="utf-8"))

    assert any(f.get("unassigned") for f in m["floors"]), (
        "no unassigned storey in the recording -- then nobody meets the "
        "areas without a floor until a real house has some"
    )
    assert any(n.get("state") == "unavailable" for n in m["nodes"]), (
        "every node in the recording is reachable"
    )
    assert m["edges"] and len({e.get("quality") for e in m["edges"]}) > 1, (
        "all edges have the same quality -- then the quality colours are "
        "never actually exercised"
    )
    assert m["theme"]["fallback"].get("ink", "").startswith("#"), (
        "the recording carries no ink fallback, so the grey-house trap is "
        "not visible in it"
    )
