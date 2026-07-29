"""The hub knows no integration by name.

There used to be a `staging/` folder holding adapters until they moved to
repositories of their own. They all moved -- ESPHome last -- and the
folder is gone. What remains is the rule the folder existed to protect:
the moment the hub knows two integrations by name, it is a catalogue
instead of a platform.
"""

from __future__ import annotations

from pathlib import Path

import pytest

HUB = Path(__file__).resolve().parents[1] / "custom_components" / "spatial_hub"

# Adapters that live in their own repositories now. Naming one here is a
# test, not a dependency: the hub must not mention them at all.
#
# Only the integration *packages* -- `registry.py` uses "powerline" in its
# docstring to show what a registration looks like, which is the contract
# being documented, not an integration being known.
MOVED_OUT = ("spatial_zwave", "spatial_esphome")


@pytest.mark.parametrize("name", MOVED_OUT)
def test_the_hub_names_no_integration(name):
    """One import, one special case, and the wall is gone."""
    for path in HUB.rglob("*.py"):
        source = path.read_text()
        assert name not in source, (
            f"{path.name} names {name} -- then the hub knows an integration "
            "by name and this project is a dashboard"
        )


@pytest.mark.parametrize("name", MOVED_OUT)
def test_nothing_that_moved_out_still_ships(name):
    """A folder that ships is a folder that stays."""
    assert not (HUB.parent / name).exists()


def test_the_waiting_room_is_gone():
    """It was temporary, and it said so. Now it is over."""
    assert not (HUB.parents[1] / "staging").exists()
