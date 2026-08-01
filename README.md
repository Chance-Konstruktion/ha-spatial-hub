# Spatial Hub

[![Release](https://img.shields.io/github/v/release/Chance-Konstruktion/ha-spatial-hub?include_prereleases&label=release&color=orange)](https://github.com/Chance-Konstruktion/ha-spatial-hub/releases)
[![Status](https://img.shields.io/badge/status-early--preview-orange)](https://github.com/Chance-Konstruktion/ha-spatial-hub)
[![HACS Custom](https://img.shields.io/badge/HACS-Custom-41BDF5.svg)](https://github.com/hacs/integration)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

> *"A floor plan that doesn't draw what you configured. It draws what your
> house actually is."*

Spatial Hub is **not a map**. It is a system service inside Home Assistant
that collects spatial data from any integration, merges it with Home
Assistant's own floors and areas, and serves **one** model from it — which
any renderer can draw.

The hub knows nothing about Powerline, UniFi or Shelly. It knows only
providers, layers, nodes, edges, actions and capabilities. That is exactly
why a new integration can become part of the floor plan without a single
line changing in here.

## Why there is a renderer in here at all

Home Assistant already has beautiful floor plans. What none of them has is
anywhere to get the *data*. Every one of them is drawn by hand — entity by
entity, coordinate by coordinate — and every one of them has to be edited
again when a room is renamed, a device moves, or a light is added.

That hand work is not a shortcoming of those projects. It is a missing
layer underneath them, and this is an attempt at that layer: one service
that answers *what is in this house, and where*, assembled from registries
Home Assistant already keeps correct, and served to any renderer that asks.

So the renderer that ships here is not the product. It exists for two
reasons. A data service nobody can see is a data service nobody installs —
and it is the proof that the API is complete, because it is built on
nothing but the public websocket commands, with no private access of any
kind. Anything it can draw, a foreign renderer can draw too. It is made as
good as we can make it, and it is meant to be replaced.

**If you maintain a floor plan card, this is aimed at you.** The hub takes
over the part your users currently do by hand and redo whenever the house
changes — and it hands you rooms, storeys, devices, positions, states and
connections in one subscription. Your drawing stays yours. Two websocket
calls are the whole integration; [one file in
`examples/second_renderer/`](examples/second_renderer/) does it in 198
lines, sharing not one line of code with us.

That is where this becomes worth anything: not in the renderer below, but
on the day the good floor plans stop asking their users to place every
lamp twice.

A house of three storeys, fourteen areas and thirteen devices needs
**nothing set up**. Floors and areas come from Home Assistant, the devices
from a provider, the arrangement from the automatic placement. Anyone who
wants it differently drags it there; anyone who doesn't has nothing to do.

> **Pictures are coming.** The drawing is being rebuilt as a proper
> architectural view — walls with real thickness, doors as gaps, rooms as
> space rather than cards. Screenshots go back in when they show something
> worth looking at. The generator is already here
> ([`tools/demo_house.py`](tools/demo_house.py) drives a demo house through
> the real hub, [`tools/shots.mjs`](tools/shots.mjs) lets the real renderer
> draw it), so the pictures will show what the code does and go stale with
> it instead of beside it.

## Status

**The roadmap is through — phases 1–15:** data model, provider registry,
event system, storage, config flow, the complete websocket API, a renderer
in the sidebar, a floor plan that follows the house by itself, an edit mode
for everything the automatic placement guessed wrong, themes — plus layers
of their own for every integration that will never write an adapter, an SDK
for those who want to, a specification at 1.0, and outer walls that line up
across every storey.

<details>
<summary><b>Connected integrations</b> — each its own repository, none of them required</summary>

<br>

The hub draws your house from Home Assistant's own areas and floors, and
for integrations without an adapter of their own it brings generic layers
along. Anyone who wants more installs exactly the ones they need — **not
all of them**.

| Integration | What it puts on the floor plan |
|---|---|
| **[ha-powerline](https://github.com/Chance-Konstruktion/ha-powerline)** | Powerline adapters with their real topology, link rates and icons of their own |
| **[ha-espeasy-p2p](https://github.com/Chance-Konstruktion/ha-espeasy-p2p)** | ESPEasy P2P mesh: which unit reported last before it drops out |
| **[ha-spatial-zwave](https://github.com/Chance-Konstruktion/ha-spatial-zwave)** | Z-Wave mesh: controller, every node in its room, edges by signal strength |
| **[ha-spatial-esphome](https://github.com/Chance-Konstruktion/ha-spatial-esphome)** | ESPHome boards as *one* point per board instead of one per entity |

Individual ESPHome entities are on the plan without an adapter too — that
is what the generic layer is for, see
[docs/PROVIDERS.md](docs/PROVIDERS.md).

`ha-espeasy-p2p` gets by without a `DataUpdateCoordinator`, which brought
two holes in the SDK to light — exactly what these adapters are for.

</details>

Three documents, three questions:

- **[docs/Vision.md](docs/Vision.md)** — *where all of this is going.*
  Install, open, everything is already there. No more dashboard building.
- **[ROADMAP.md](ROADMAP.md)** — *how far along it is.* What stands, what
  comes next, and what is deliberately still missing.
- **[Spatial Provider Specification 1.0](docs/SPECIFICATION.md)** — *what
  to hold to.* Node, edge, layer, position, popup, action, theme, icon,
  camera, area type — normative and covered by tests.

## The renderer

After setup, **Spatial Hub** is in the sidebar. No dashboard to create, no
card to configure, no YAML:

- **House**: every floor stacked, first and by default — the only view in
  which a connection between two storeys can be seen at all
- **Floors** as tabs, straight from the floor registry — for arranging
  things and for details
- **Areas** as rooms, arranged automatically
- **Garden and outdoor areas** lay themselves as a ring around the ground
  floor instead of inventing a storey of their own — front garden, terrace,
  garage, driveway, carport and pool all fit on it
- **Layers** switchable one by one, grouped by provider, below the floor
  plan rather than beside it — the selection is remembered
- **Zoom and pan** the same everywhere: mouse wheel, two fingers, dragging,
  "show everything"
- **Search** across every device — it hides nothing, it recedes everything
  else
- **Nodes** with the icon from Home Assistant, their provider's icon set,
  or inline SVG of their own — never a nameless dot
- **Edges** coloured by quality, dashed for estimates, animated for flow
- **Popup** centred over the floor plan, with all metadata, history,
  actions (admins only) and every door back into Home Assistant: more-info,
  device, entities, settings and the provider's own view
- **Diagnostics** right in the panel: what each provider delivered, and what
  was rejected about it
- **Themes**: five presets, free colours, shapes, label mode, straight or
  curved connections — the default is `auto`, which follows the theme the
  user already has in Home Assistant
- **Editing** (admins only): drag nodes and areas, resize rooms at every
  wall and every corner, scale and rotate nodes, hide them and bring them
  back, set each area's kind and whether it appears in the stacked house
  view, a floor plan image per storey, sort and dim layers, undo/redo — all
  with grid snapping, and `Shift` holds the grid off

The renderer is plain ES modules — an entry point, its stylesheet and the
floor plan geometry: no build, no npm, no bundle. What lies in the
repository is what the browser runs. It knows **not one single
integration by name** — colours come from `state` and `quality`, shapes
from `icon`, all delivered by the provider. A test holds that in place.

Anyone who brings a renderer of their own switches ours off in the options
— and the hub goes on delivering its data and nothing else, with no feature
held back for the one it shipped with.

## The architecture in one picture

```
Integration A ─┐
Integration B ─┼─► hass.data["spatial_hub_providers"] ─► Hub ─► Websocket ─► Renderer
Integration C ─┘                                            ▲
                          HA floors + areas ────────────────┤
                          User arrangement (storage) ───────┘
```

The coupling is a dict in `hass.data` plus three dispatcher signals. No
import in either direction, no load order, no dependency. An integration
with a provider adapter goes on working unchanged when the hub is not
installed at all.

## Who does what

| | responsible for |
|---|---|
| **Provider** | *what* there is: nodes, edges, state, metadata |
| **Home Assistant** | *where* it roughly is: floor and area registry |
| **Hub** | *how* it is arranged: automatic placement + user corrections |
| **Renderer** | *what it looks like* |
| **Theme** | *in which colours* — for states and quality, never per integration |

The bundled renderer uses nothing but the documented websocket API — the
same one a 3D view or a print export would use. It has no special access.

A provider never finds out that the user moved its node. That belongs to
the hub, and is applied afresh on every refresh.

## Zero config

Areas are already in Home Assistant. Entering them a second time in a floor
plan editor is exactly what this project wants to avoid:

1. Storeys come from the floor registry (sorted by level)
2. Areas are laid out on a grid automatically, per storey
3. Every node lands in the middle of its area, several are fanned out
4. The user corrects only what sits wrong — once, and it persists

And it stays right. Rename an area, add a floor or move a device into
another room, and the floor plan follows; the entities on it are live, no
matter how slowly the provider that named them polls. Only what is
currently visible is watched — if nobody is looking, there is nothing to
update.

## Without an adapter: layers of your own

Most integrations will never write a Spatial Hub provider. That is not a
failing but the normal case — and a platform that only works for the
initiated does not work.

**Four layers ship with it**: light, climate, doors & motion, media.
Straight after installation, without anybody writing a rule and before any
provider exists. They are rules, not a list of integrations — a house with
Z-Wave lamps and one with ESPHome lamps get the same four. Anyone who
doesn't want them deletes them; anyone who deletes them all has deleted
them, and does not get them back on the next restart.

Beyond that, the user describes a layer themselves: *"all lights"*,
*"everything labelled security"*, *"these four entities"*. In edit mode,
sidebar, **+ Layer**.

A **rule, not a list**: "all lights" is still true when a lamp is added
next month — for the same reason storeys and areas come from the registries
and not from a drawing program.

And Home Assistant knows, for many devices, **what they are reached
through** — every device behind a bridge, a controller or a hub carries its
ID. These connections can be switched on per layer. That is real topology,
without the hub naming a single integration: who writes `via_device` is of
no interest to it, and how *good* the connection is, it does not claim —
nobody measures that.

What it deliberately does **not** do for this: reach into some
integration's own websocket API to fetch routes, neighbour tables or signal
strengths. Those exist exactly once, for exactly one integration — and the
first one the hub asks by name would be the last day it is a platform.

And the decisive part: these layers register through the **same public
provider contract** as any stranger. No side entrance into the hub, the
same validation, the same error isolation. A test holds that in place — a
shortcut here would be the first crack in what makes the hub worth anything
at all.

## Connecting an integration

For maintainers: **[sdk/README.md](sdk/README.md)** — one page, the whole
answer. Reference: **[docs/PROVIDER_API.md](docs/PROVIDER_API.md)**.

```bash
python3 sdk/install.py --into custom_components/<domain> --tests tests
```

Copies two files and prints the code that is still missing. The complete
connection is one call:

```python
from .spatial_hub_provider import spatial_provider   # the copied file

spatial_provider(
    hass,
    entry,
    name="My Integration",
    icon="mdi:flash",
    data=lambda: ["light.kitchen", "sensor.hallway_temperature"],
    coordinator=coordinator,
)
```

Nothing more is needed. The call registers, deregisters again when the
config entry unloads, and notifies the hub after every coordinator refresh
— nobody writes register/unregister/notify by hand.

**An entity id is a complete node.** Name, area, icon and state have long
been in Home Assistant; the hub fetches them there. Anyone with more to say
takes the builders `node()` / `edge()` / `action()` — everything extra
lands in the metadata automatically, and with that in the popup.

**And a conformance kit** for developers to copy into their own test suite
([sdk/spatial_hub_conformance.py](sdk/spatial_hub_conformance.py)): one
class, pytest as the only dependency, no Home Assistant and no installed
hub required. It catches the mistakes that take floor plans apart in the
field — above all node ids that change between two polls and thereby throw
away the user's entire arrangement in silence, and metadata that cannot be
sent as JSON and takes the model down for *all* providers with it.

**Two runnable examples** live in [examples/](examples/) — not snippets,
but integrations that run against the real hub in our own test suite and
have to satisfy the same conformance contract as foreign code. So they
cannot rot in silence.

[`minimal_provider/`](examples/minimal_provider/__init__.py) is the
shortest honest version — **five lines**, a list of entity ids:

```python
spatial_provider(
    hass, entry,
    name="Minimal Provider",
    data=lambda: ["light.kitchen", "switch.coffee_machine"],
)
```

[`example_provider/`](examples/example_provider/__init__.py) is the whole
integration, for when that is no longer enough: edges, popup, action, and
through a coordinator the plan follows along live.

And if you are the user of an integration that is still missing:
**[docs/ASK_FOR_SUPPORT.en.md](docs/ASK_FOR_SUPPORT.en.md)** is the text
you file over there — including the request to do it once, and kindly. The
same text is available in German as
[ASK_FOR_SUPPORT.de.md](docs/ASK_FOR_SUPPORT.de.md).

Who is already connected is listed in
**[docs/PROVIDERS.md](docs/PROVIDERS.md)**. That list is pure documentation
— no module reads it, and a test holds it that no domain from it appears in
the hub's source.

Provider code counts as untrusted to the hub: throw an exception, run into
a timeout or deliver nonsense, and you lose your own layer for exactly one
refresh — and nothing else happens. So that this does not become a guessing
game, `spatial_hub/diagnostics` says per provider what was discarded and
why, including suspected typos in the registration.

## Websocket API

| Command | Purpose |
|---|---|
| `spatial_hub/model` | the complete spatial model |
| `spatial_hub/providers` | who is registered, and what they can do |
| `spatial_hub/subscribe` | push notice on changes |
| `spatial_hub/layout/set` | store the user arrangement |
| `spatial_hub/layout/reset` | discard an object's overrides |
| `spatial_hub/history` | time series for a node or edge |
| `spatial_hub/action` | run a provider action (admin) |
| `spatial_hub/diagnostics` | what each provider delivered, errors included |
| `spatial_hub/entities/facets` | which kinds, labels and device classes exist in the house |
| `spatial_hub/area/assign` | put a device or entity into another area — **writes into Home Assistant**, admin only |

Under `theme` sits the resolved theme — preset plus user corrections, fully
worked out. A second renderer gets the same colours with it, without
rebuilding a single preset.

The model also carries, under `hidden`, what the user has hidden — hiding
is not a one-way street, an editor needs the list to bring things back. A
simple renderer goes on drawing only `nodes`.

## Installation

HACS → custom repository → add this repo as an *integration*, install,
restart Home Assistant, then under *Devices & services* → *Add integration*
→ **Spatial Hub**. There is nothing to configure.

## Tests

```bash
python3 -m pytest
```

Runs in CI on every pull request (pytest, HACS, hassfest) and locally
without a Home Assistant installation — `tests/conftest.py` stubs the parts
that are needed, as in ha-powerline. The renderer's logic is checked along
with it by `tests/test_panel_logic.mjs` (`node --test`); pytest calls it
too, and skips it when node is not installed.

## Licence

MIT
