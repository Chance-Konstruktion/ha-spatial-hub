"""The second renderer: the claim that the first one has no privileges.

One HTML file, opened from a desktop, sharing no code with the hub. If it
can draw the house, then the built-in panel is one renderer among possible
others rather than the renderer -- which is the only thing that makes
"bring your own view" true instead of merely stated.

The general rules moved into ``sdk/spatial_hub_renderer_conformance.py``
and are inherited below. That is deliberate: as long as they lived here,
they applied to exactly one file, and a rule that only ever sees one
subject is a rule nobody can rely on. Now they ship, and this renderer is
simply the first thing they are pointed at -- through the same subclass an
outside author writes, so the path they take is the path we test.

What stays here is what only applies to *this* file, or needs the hub's own
sources to judge.
"""

from __future__ import annotations

import importlib.util
from pathlib import Path

_SDK = Path(__file__).resolve().parents[1] / "sdk"
_spec = importlib.util.spec_from_file_location(
    "spatial_hub_renderer_conformance",
    _SDK / "spatial_hub_renderer_conformance.py")
_kit = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_kit)
SpatialHubRendererConformance = _kit.SpatialHubRendererConformance

ROOT = Path(__file__).resolve().parents[1]
SECOND = ROOT / "examples" / "second_renderer" / "index.html"
WWW = ROOT / "custom_components" / "spatial_hub" / "www"


class TestSecondRenderer(SpatialHubRendererConformance):
    """The eight kit rules, applied to the renderer we ship."""

    read_only = True

    def renderer_files(self) -> list[Path]:
        return [SECOND]

    # ── Beyond the kit ────────────────────────────────────

    def test_it_draws_the_unassigned_storey_like_any_other(self) -> None:
        """The floor bug again: filter by the floor the hub gave, not by
        truthiness.

        Too specific for the kit -- it names an expression this file
        happens to contain. But it is the mistake that once put unassigned
        rooms on top of real ones in the built-in panel, and it is worth a
        test where it can be worded precisely.
        """
        source = SECOND.read_text(encoding="utf-8")
        assert "a.floor_id === floor.id" in source, (
            "areas are not filtered strictly by floor -- the same mistake "
            "that put unassigned rooms on top of real ones in the panel"
        )

    def test_the_two_renderers_were_written_separately(self) -> None:
        """Copied code would make this a mirror, not a second opinion.

        Cannot live in the kit: it needs the hub's own sources, which
        nobody outside this repository has.

        Read is the **whole** built-in renderer, not just its entry file.
        When the panel was split across several files, a comparison against
        `spatial-hub-panel.js` alone would have kept passing -- while the
        very markup that would come closest to a copy had moved out of it.
        """
        panel_lines = {
            line.strip()
            for pfad in sorted(WWW.glob("*.js"))
            for line in pfad.read_text(encoding="utf-8").splitlines()
            if len(line.strip()) > 60
        }
        second_lines = {
            line.strip()
            for line in SECOND.read_text(encoding="utf-8").splitlines()
            if len(line.strip()) > 60
        }
        shared = panel_lines & second_lines
        assert not shared, f"identical lines in both renderers: {sorted(shared)[:3]}"
