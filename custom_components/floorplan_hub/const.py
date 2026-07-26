"""Constants and the public integration contract of Floorplan-Hub.

Everything in this module that starts with ``DATA_`` or ``SIGNAL_`` is part
of the contract providers rely on. A provider must never import this
package -- the hub may not be installed at all -- so the few strings below
are duplicated verbatim in every provider's adapter module. Treat them as
frozen: changing one breaks every provider in the wild.
"""

from typing import Final

DOMAIN: Final = "floorplan_hub"

# ── Provider contract (frozen strings, duplicated by providers) ────────
#
# The registry lives in hass.data under a fixed key. Whoever loads first --
# hub or provider -- creates the dict, so registration order does not
# matter and providers work fine when the hub is absent.
DATA_PROVIDERS: Final = "floorplan_hub_providers"

# A provider announced itself (payload: provider_id).
SIGNAL_PROVIDER_REGISTERED: Final = "floorplan_hub_provider_registered"
# A provider went away, e.g. its config entry was unloaded (payload: provider_id).
SIGNAL_PROVIDER_REMOVED: Final = "floorplan_hub_provider_removed"
# A provider's spatial data changed and subscribers should refresh
# (payload: provider_id).
SIGNAL_DATA_UPDATED: Final = "floorplan_hub_data_updated"

# The provider contract version this hub speaks. A registration declaring a
# higher major version is refused rather than misread.
API_VERSION: Final = 1

# The newest revision of the copied provider shim this hub ships. A
# provider that stamped an older one gets a note in diagnostics -- never a
# warning in the log, and never a refusal. An old copy still works; the
# point is that its author finds out a better one exists.
CURRENT_SDK_VERSION: Final = 2

# Floors arrived in Home Assistant long after areas, so most houses have
# areas that belong to no floor at all. They still have to be somewhere:
# drawn on every floor they would collide with that floor's own rooms, and
# dropped they would vanish from a plan that promises to show the house.
# So they get a storey of their own, last in the list.
UNASSIGNED_FLOOR_ID: Final = "_unassigned"
UNASSIGNED_FLOOR_NAME: Final = "Ohne Etage"

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
PANEL_URL_PATH: Final = "floorplan"
PANEL_TITLE: Final = "Floorplan"
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

# Edge quality tiers -- same vocabulary across every provider so a renderer
# can colour edges without knowing who produced them.
QUALITY_GOOD: Final = "good"
QUALITY_FAIR: Final = "fair"
QUALITY_POOR: Final = "poor"
QUALITY_UNKNOWN: Final = "unknown"

# Guard for the floor-plan background so a stray upload can't bloat .storage.
MAX_BACKGROUND_BYTES: Final = 4 * 1024 * 1024
