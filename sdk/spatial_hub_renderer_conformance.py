"""Spatial Hub renderer conformance kit -- copy this file into your test suite.

Answers one question: *is my renderer independent of the hub, or does it
quietly depend on it?*

Providers have had a kit like this from the start. Renderers had a claim
-- "the built-in panel is one renderer among possible others" -- and one
worked example to back it up. A claim with a single example is hard to
argue with and impossible to check. This file is the check.

The rules are not style preferences. Each one is a way a renderer stops
being independent without anybody noticing:

* speaking an undocumented command works until the hub renames it,
* naming a theme preset works until a sixth preset ships,
* naming an integration works until the user runs a different one,
* reading the hub's own files works only for renderers that live in this
  repository -- which is the opposite of the point.

Requires **pytest and nothing else**. No Home Assistant install, no hub
install, no browser. It reads your renderer's source, because that is all
an outsider has.

Usage -- one class in your test suite::

    from pathlib import Path
    from .spatial_hub_renderer_conformance import SpatialHubRendererConformance

    class TestMyRenderer(SpatialHubRendererConformance):
        def renderer_files(self):
            return [Path(__file__).parent.parent / "index.html"]

That is it. You get nine named tests, each of which says what is wrong
and why it will bite you later.

**If your CI runs `unittest` rather than pytest, inherit from
`unittest.TestCase` as well** -- `unittest discover` collects nothing
else, and a class it does not collect fails silently::

    class TestMyRenderer(SpatialHubRendererConformance, unittest.TestCase):
        ...

This is not a footnote. The first repository to wire up this kit did it
without the mixin: the rules were in the file, the runner never touched
them, the log said "Ran 35 tests ... OK", and the renderer's actual bug
went on sitting there. A rule nobody runs is indistinguishable from a
rule that passes.

Outside pytest -- in a script, a CI step, a scratch file::

    from spatial_hub_renderer_conformance import check

    for problem in check([Path("index.html")]):
        print(problem)
"""

from __future__ import annotations

import re
from pathlib import Path

API_VERSION = 1

# Which revision of the kit you copied. Kept in step with the provider kit
# so a mismatch between the two files in your repository is visible.
SDK_VERSION = 7

# Every command a renderer may send, from docs/PROVIDER_API.md.
#
# This is a copy, and copies drift. `tests/test_renderer_kit.py` in the hub
# holds it against both the documentation table and the commands actually
# registered in websocket.py, so a divergence turns that suite red instead
# of quietly rejecting a renderer that did nothing wrong. It already has:
# `area/assign` was documented and registered, but missing from the list
# this constant grew out of.
DOCUMENTED = {
    "model",
    "providers",
    "subscribe",
    "layout/set",
    "layout/reset",
    "area/assign",
    "history",
    "action",
    "diagnostics",
    "entities/facets",
}

# The two commands that draw the whole house. A renderer that only reads
# needs nothing else -- that is the point of resolving the model in the hub.
READING = {"model", "subscribe"}

# Commands that change what the user arranged, or write outside the hub.
WRITING = {"layout/set", "layout/reset", "area/assign", "action"}

# Theme presets the hub ships. A renderer receives `model["theme"]` fully
# resolved and must not contain one of these names: a preset added next
# year has to reach every renderer without anybody editing it.
#
# "auto" is deliberately absent -- it is a plain English word, far too
# common to search for in source code without false alarms.
PRESETS = {"classic", "blueprint", "neon", "paper"}

# Integration names a renderer must not know. The hub speaks to providers,
# and a renderer speaks to the hub; anything else is a shortcut that breaks
# for the next user, who runs something different.
INTEGRATIONS = {
    "powerline", "espeasy", "zwave", "zigbee", "thread", "matter", "esphome",
    "bluetooth", "unifi", "shelly", "fritz", "tasmota", "hue",
}

# Reaching into the hub's own files. Any renderer that does this proves
# nothing: it is the built-in one wearing a hat.
HUB_FILES = ("spatial_hub_frontend", "custom_components", "spatial-hub-panel")


def strip_prose(source: str) -> str:
    """The source with its comments removed, string literals kept.

    A good renderer explains at length which commands it must never send
    and which preset it must never know -- naming both, of course. Deleting
    that reasoning to satisfy a search would be the wrong trade: the
    mistake being looked for lives in code, so only code is read.
    """
    source = re.sub(r"<!--.*?-->", "", source, flags=re.S)
    source = re.sub(r"/\*.*?\*/", "", source, flags=re.S)
    return re.sub(r"^\s*//[^\n]*", "", source, flags=re.M)


def paints(code: str) -> bool:
    """Does this renderer set colours of its own?

    Only asked to spare the renderers that draw nothing: plain text for a
    screen reader has no palette, and failing it for that would be
    telling people to add colours they do not want.

    Deliberately blunt -- hex literals in either notation, and the CSS
    properties that carry a colour. A false positive costs someone one
    line of explanation; a false negative is a grey house nobody
    explains.
    """
    return bool(
        re.search(r"0x[0-9a-fA-F]{6}\b", code)
        or re.search(r"#[0-9a-fA-F]{3,8}\b", code)
        or re.search(r"\b(?:rgb|rgba|hsl|hsla)\s*\(", code)
        or re.search(r"\b(?:background|backgroundColor|color|fill|stroke)\s*[:=]",
                     code)
    )


def _reads_a_recording(code: str) -> bool:
    """A model written out by `examples/record_model.py`, read from disk."""
    return bool(re.search(r"\bmodell?\.json\b", code, re.I))


def commands(source: str) -> set[str]:
    """Every `spatial_hub/...` command mentioned in the given source."""
    return set(re.findall(r"spatial_hub/([a-z/]+)", source))


def check(files, read_only: bool = True, offline: bool = False) -> list[str]:
    """Every problem found, as plain sentences. Empty list means conformant.

    Use this outside pytest. Inside pytest, subclass
    :class:`SpatialHubRendererConformance` instead -- the failures are
    easier to read when each rule is its own test.
    """
    problems: list[str] = []
    suite = SpatialHubRendererConformance()
    suite._files = [Path(f) for f in files]
    suite.read_only = read_only
    suite.offline = offline
    for name in sorted(dir(suite)):
        if not name.startswith("test_"):
            continue
        try:
            getattr(suite, name)()
        except Exception as err:  # noqa: BLE001 - a crash is a problem too
            problems.append(f"{name[5:].replace('_', ' ')}: {err}")
    return problems


class SpatialHubRendererConformance:
    """Subclass this in your test suite and implement renderer_files()."""

    _files: list[Path] | None = None

    #: Set to False if your renderer edits. The kit then allows the writing
    #: commands -- and stops claiming your renderer cannot touch a layout.
    read_only = True

    # Set this where the renderer is built against a recorded model
    # instead of a live hub -- `examples/record_model.py` writes exactly
    # what the websocket would carry, so a renderer can be written and
    # reviewed without a Home Assistant anywhere near it.
    #
    # This flag exists because its absence made the kit unusable in the
    # one repository it was shipped to: the task there says *read the
    # recording*, the kit demanded a websocket command, and so the kit
    # was never run at all. A rule nobody can satisfy is not strict, it
    # is ignored.
    offline = False

    #: Override to widen the list for your own ecosystem.
    integrations = INTEGRATIONS

    # ── The one thing you implement ───────────────────────

    def renderer_files(self) -> list[Path]:
        """Return every source file your renderer consists of.

        One HTML file is the common case. A build step is fine too -- point
        this at the sources, not at the bundle: a minified bundle passes
        every text rule here without meaning any of them.
        """
        raise NotImplementedError(
            "implement renderer_files() -- return the paths your renderer "
            "is written in (sources, not a minified bundle)"
        )

    @property
    def files(self) -> list[Path]:
        if self._files is None:
            self._files = [Path(f) for f in self.renderer_files()]
        return self._files

    @property
    def source(self) -> str:
        missing = [f for f in self.files if not f.is_file()]
        assert not missing, f"renderer file(s) not found: {missing}"
        assert self.files, "renderer_files() returned nothing to check"
        return "\n".join(f.read_text(encoding="utf-8") for f in self.files)

    @property
    def code(self) -> str:
        return strip_prose(self.source)

    # ── What it says to the hub ───────────────────────────

    def test_it_talks_to_the_hub_at_all(self) -> None:
        """A renderer that sends nothing cannot be drawing anything.

        Every other rule here is satisfied by an empty file. This one is
        what keeps the kit from handing out a clean bill of health to
        nothing at all.
        """
        if self.offline:
            assert commands(self.code) or _reads_a_recording(self.code), (
                "nothing is read: no websocket command, and no recorded "
                "model either. With offline = True a renderer may read the "
                "recording instead of the hub -- but it has to read "
                "something"
            )
            return
        assert commands(self.code), (
            "no websocket command found in the source -- either this is not "
            "a renderer, or renderer_files() points at the wrong files"
        )

    def test_it_only_speaks_the_documented_api(self) -> None:
        used = commands(self.code)
        unknown = sorted(used - DOCUMENTED)
        assert not unknown, (
            f"undocumented command(s) {unknown}. Either it is a typo -- which "
            "fails silently, the hub simply never answers -- or you are "
            "relying on something that was never promised to stay"
        )

    def test_a_read_only_renderer_needs_almost_nothing(self) -> None:
        """Two commands draw the whole house. That is the point of the model.

        Not a limit: `model` and `subscribe` carry areas, floors, nodes,
        edges and the resolved theme. A read-only renderer asking for more
        is usually rebuilding something the hub already handed it.
        """
        if not self.read_only:
            return
        extra = sorted(commands(self.code) - READING)
        assert not extra, (
            f"a read-only renderer sends {extra} on top of model/subscribe. "
            "If it genuinely edits, set read_only = False and say so -- what "
            "must not happen is a renderer that writes while claiming not to"
        )

    def test_it_never_writes_the_users_arrangement(self) -> None:
        """Layouts are the one thing in the hub the user made by hand."""
        if not self.read_only:
            return
        writing = sorted(commands(self.code) & WRITING)
        assert not writing, (
            f"declared read-only but sends {writing} -- the user arranged "
            "that floor plan by hand, and it is the one thing here they "
            "cannot get back"
        )

    # ── What it must not know ─────────────────────────────

    def test_it_reaches_into_no_hub_file(self) -> None:
        """A second renderer that imports ours proves nothing about anything."""
        source = self.source
        for marker in HUB_FILES:
            assert marker not in source, (
                f"it reaches into the hub's own files ({marker!r}) -- then it "
                "is not an independent renderer, it is the built-in one "
                "wearing a hat, and it will break the next time we move a file"
            )

    def test_it_reimplements_no_theme_preset(self) -> None:
        """Themes resolve in the hub. This is where that is paid off."""
        code = self.code.lower()
        named = sorted(p for p in PRESETS if p in code)
        assert not named, (
            f"the preset(s) {named} are named in the renderer -- then every "
            "new preset needs a change in every renderer there is, which is "
            "exactly what resolving themes in the hub was meant to avoid"
        )

    def test_it_knows_no_integration_by_name(self) -> None:
        """The rule the built-in renderer lives under, one file further out."""
        code = self.code.lower()
        named = sorted(i for i in self.integrations if i in code)
        assert not named, (
            f"the integration(s) {named} are named in the renderer. The hub "
            "speaks to providers so that renderers do not have to -- a "
            "special case here breaks for the next user, who runs something "
            "else"
        )

    def test_it_places_by_the_floor_it_was_given(self) -> None:
        """Areas carry a `floor_id`. Take it; do not work it out again.

        Areas without a floor do not vanish -- the hub gives them a floor
        of their own, marked `unassigned: true`. It is a floor like any
        other, and it is in `model["floors"]`.

        A renderer that decides where an area belongs by any other means
        -- by whether `floor.unassigned` is falsy, by the order of the
        list, by guessing from the name -- draws those rooms on top of a
        real storey. Nothing errors. The plan just quietly shows a
        cellar room in the living room, and the person looking at it has
        no reason to doubt it.

        Both renderers shipped with the hub group by `floor_id`. Neither
        said why, and nothing made them: it was luck, twice. So the rule.
        """
        code = self.code
        if "floors" not in code:
            # Draws no storeys at all -- one area per screen, a text
            # renderer for a screen reader. Nothing to get wrong here,
            # and demanding floor_id from it would be nonsense.
            return
        assert "floor_id" in code, (
            "the renderer works through `floors` but never reads "
            "`floor_id`. Then areas land on a storey by some rule of "
            "your own, and the ones the hub put on its `unassigned` "
            "floor get drawn over a real one. Group by the id you were "
            "handed: `areas.filter(a => a.floor_id === floor.id)`"
        )

    def test_it_uses_the_theme_fallback(self) -> None:
        """The trap the first outside renderer fell into.

        The default preset is `auto`, and its colours are empty strings:
        *take whatever Home Assistant says.* Inside Home Assistant that is
        exactly right. Outside it there is nothing to inherit, and the whole
        house comes out grey -- while every test still passes, because
        empty strings are perfectly valid colours to a browser.

        `theme.fallback` carries real colours for the shared vocabulary.
        Empty still means inherit; whoever has nothing to inherit takes the
        fallback. A renderer that reads the theme and never mentions the
        fallback has this bug ahead of it.
        """
        code = self.code
        if "theme" not in code:
            # A renderer that never reads the theme is not exempt -- it is
            # the worse case. The first outside renderer to be measured by
            # this kit had fifteen hard-coded colours and no mention of
            # `theme`, and this rule waved it through: the one shape it
            # exists to catch was the one shape it let past.
            #
            # Painting without the model's colours is only fine if it
            # paints nothing at all -- a text renderer for a screen reader
            # has no use for a palette, and must not be failed for that.
            assert not paints(code), (
                "the renderer sets colours of its own but never reads "
                "`theme`. Then the house looks the same whatever the user "
                "chose, and the states carry whatever meaning you gave "
                "them rather than the shared one. Read the theme, and take "
                "`theme.fallback` where a colour comes out empty"
            )
            return
        assert "fallback" in code, (
            "the theme is read but `theme.fallback` never is. Outside Home "
            "Assistant the `auto` preset resolves to empty strings -- valid "
            "colours, invisible house. Use the fallback where a colour comes "
            "out empty"
        )
