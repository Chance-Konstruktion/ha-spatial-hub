"""Constants and the public integration contract of Spatial Hub.

Everything in this module that starts with ``DATA_`` or ``SIGNAL_`` is part
of the contract providers rely on. A provider must never import this
package -- the hub may not be installed at all -- so the few strings below
are duplicated verbatim in every provider's adapter module. Treat them as
frozen: changing one breaks every provider in the wild.
"""

from enum import StrEnum
from typing import Final

DOMAIN: Final = "spatial_hub"

# ── Provider contract (frozen strings, duplicated by providers) ────────
#
# The registry lives in hass.data under a fixed key. Whoever loads first --
# hub or provider -- creates the dict, so registration order does not
# matter and providers work fine when the hub is absent.
DATA_PROVIDERS: Final = "spatial_hub_providers"

# A provider announced itself (payload: provider_id).
SIGNAL_PROVIDER_REGISTERED: Final = "spatial_hub_provider_registered"
# A provider went away, e.g. its config entry was unloaded (payload: provider_id).
SIGNAL_PROVIDER_REMOVED: Final = "spatial_hub_provider_removed"
# A provider's spatial data changed and subscribers should refresh
# (payload: provider_id).
SIGNAL_DATA_UPDATED: Final = "spatial_hub_data_updated"

# The provider contract version this hub speaks. A registration declaring a
# higher major version is refused rather than misread.
API_VERSION: Final = 1

# The newest revision of the copied provider shim this hub ships. A
# provider that stamped an older one gets a note in diagnostics -- never a
# warning in the log, and never a refusal. An old copy still works; the
# point is that its author finds out a better one exists.
CURRENT_SDK_VERSION: Final = 7

# Floors arrived in Home Assistant long after areas, so most houses have
# areas that belong to no floor at all. They still have to be somewhere:
# drawn on every floor they would collide with that floor's own rooms, and
# dropped they would vanish from a plan that promises to show the house.
# So they get a storey of their own, last in the list.
UNASSIGNED_FLOOR_ID: Final = "_unassigned"
UNASSIGNED_FLOOR_NAME: Final = "Ohne Etage"

# ── What an area *is* ─────────────────────────────────────────────────
#
# A garden is not a storey. Treating it as one puts a floor between the
# cellar and the ground floor that no house has, and forces the user to
# choose which of "Vorgarten" and "Terrasse" gets to be the outside. So an
# area declares a kind instead, and the outdoor ones surround the ground
# floor rather than stacking above it.
#
# An enum, not three loose strings. The wire format is still the plain
# word -- JSON has no enums and the specification names the three by value
# -- but nothing inside this package compares against a literal, and
# everything that comes in from outside goes through `AreaKind.parse`.
# Somebody will write "outside" one day; this is where they find out,
# instead of wondering why their garden is a living room.
class AreaKind(StrEnum):
    """What an area is. See docs/SPECIFICATION.md § Area Type."""

    INDOOR = "indoor"
    OUTDOOR = "outdoor"
    # Cloud, Internet, VPN: real enough to show, nowhere in the building.
    VIRTUAL = "virtual"

    @classmethod
    def parse(cls, value: object, default: "AreaKind | None" = None) -> "AreaKind | None":
        """The kind this value means, or ``default`` if it means nothing.

        Near misses are repaired rather than silently treated as a room:
        somebody writing "outside", "garden" or "außen" clearly meant
        outdoors, and a floor plan is not the place to be pedantic about
        it. Anything genuinely unrecognised returns the default, and the
        caller is expected to say so out loud.
        """
        if isinstance(value, cls):
            return value
        word = str(value or "").strip().lower()
        for source, target in (("ä", "a"), ("ö", "o"), ("ü", "u"), ("ß", "ss")):
            word = word.replace(source, target)
        if not word:
            return default
        try:
            return cls(word)
        except ValueError:
            return AREA_KIND_ALIASES.get(word, default)


# Words that unambiguously mean one of the three. Deliberately short: an
# alias table is a courtesy, not a second vocabulary, and every entry here
# is one the specification does *not* promise.
AREA_KIND_ALIASES: Final[dict[str, AreaKind]] = {
    "inside": AreaKind.INDOOR,
    "innen": AreaKind.INDOOR,
    "room": AreaKind.INDOOR,
    "raum": AreaKind.INDOOR,
    "outside": AreaKind.OUTDOOR,
    "aussen": AreaKind.OUTDOOR,
    "exterior": AreaKind.OUTDOOR,
    "garden": AreaKind.OUTDOOR,
    "garten": AreaKind.OUTDOOR,
    "cloud": AreaKind.VIRTUAL,
    "internet": AreaKind.VIRTUAL,
    "remote": AreaKind.VIRTUAL,

}

# Kept as plain strings for the places that need a list of literals: the
# websocket schema and anything reading the stored layout.
AREA_KIND_INDOOR: Final = AreaKind.INDOOR.value
AREA_KIND_OUTDOOR: Final = AreaKind.OUTDOOR.value
AREA_KIND_VIRTUAL: Final = AreaKind.VIRTUAL.value
AREA_KINDS: Final = tuple(kind.value for kind in AreaKind)

# How far outside the house the outdoor ring reaches, in floor coordinates.
# The whole apron is therefore -OUTDOOR_MARGIN .. 1 + OUTDOOR_MARGIN, and a
# renderer that ignores all of this still draws the house right.
OUTDOOR_MARGIN: Final = 0.28

# Where the virtual areas live: not a storey either, but they need a plane
# to be drawn on, and above the roof is the one place nobody confuses with
# a room.
VIRTUAL_FLOOR_ID: Final = "_virtual"
VIRTUAL_FLOOR_NAME: Final = "Virtuell"

# ── Internal hass.data keys ───────────────────────────────────────────
DATA_HUB: Final = f"{DOMAIN}_hub"
DATA_STORE: Final = f"{DOMAIN}_store"
DATA_WATCHER: Final = f"{DOMAIN}_watcher"
DATA_GENERIC: Final = f"{DOMAIN}_generic"

STORAGE_KEY: Final = f"{DOMAIN}.layout"
STORAGE_VERSION: Final = 1

# ── Options ───────────────────────────────────────────────────────────
CONF_AUTO_AREAS: Final = "auto_areas"
DEFAULT_AUTO_AREAS: Final = True

CONF_PANEL: Final = "panel"
DEFAULT_PANEL: Final = True

# ── Built-in renderer ─────────────────────────────────────────────────
PANEL_URL_PATH: Final = "spatial"
PANEL_TITLE: Final = "Spatial Hub"
PANEL_ICON: Final = "mdi:floor-plan"

# Display ratio of the stage when a floor carries no `aspect` override.
# Houses are wider than they are deep.
DEFAULT_ASPECT: Final = 1.6

# ── Spatial model defaults ────────────────────────────────────────────
DEFAULT_Z_INDEX: Final = 10
DEFAULT_LAYER_OPACITY: Final = 1.0

# Node states the hub understands. Providers may send anything, but these
# are the ones renderers are expected to style by default.
STATE_ONLINE: Final = "online"
STATE_OFFLINE: Final = "offline"
STATE_UNKNOWN: Final = "unknown"

# `on` and `off` are as universal in Home Assistant as online/offline, and
# they mean something different: a lamp that is off is not broken. Without
# them in the vocabulary every light on the plan draws in the grey meant
# for "no idea", which is the wrong thing to tell somebody about a lamp.
STATE_ON: Final = "on"
STATE_OFF: Final = "off"

# Edge quality tiers -- same vocabulary across every provider so a renderer
# can colour edges without knowing who produced them.
QUALITY_GOOD: Final = "good"
QUALITY_FAIR: Final = "fair"
QUALITY_POOR: Final = "poor"
QUALITY_UNKNOWN: Final = "unknown"

# Guard for the floor-plan background so a stray upload can't bloat .storage.
MAX_BACKGROUND_BYTES: Final = 4 * 1024 * 1024
