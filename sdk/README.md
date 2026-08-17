# Provider SDK

You maintain a Home Assistant integration and somebody asked you to
support Spatial Hub. This page is the whole answer.

## The short version

```bash
python3 sdk/install.py --into path/to/custom_components/<your_domain> \
                       --tests path/to/tests
```

Two files copied, and it prints the code to add. Then, in
`async_setup_entry`:

```python
from .spatial_hub_provider import spatial_provider

spatial_provider(
    hass,
    entry,
    name="My Integration",
    icon="mdi:flash",
    data=lambda: ["light.kitchen", "sensor.hallway_temperature"],
    coordinator=coordinator,
)
```

That is the integration. It registers, withdraws when your config entry is
unloaded, and re-notifies the hub after every coordinator refresh.

## No coordinator? Name your signals

Plenty of integrations have no `DataUpdateCoordinator` -- a UDP listener,
an MQTT subscription, anything push-shaped fires its own dispatcher signals
instead. Name them and the hub listens along:

```python
spatial_provider(hass, entry, name="ESPEasy P2P", data=data,
                   signals=[SIGNAL_NODE_DISCOVERED, SIGNAL_NODE_AVAILABILITY])
```

They are disconnected on unload with everything else. And if you pass a
`coordinator` that has no `async_add_listener`, the shim now says so in the
log instead of quietly doing nothing -- which used to mean the plan drew
once and then never moved, with nothing anywhere explaining why.

## What this costs you

**No dependency.** Not in `requirements`, not in `manifest.json`, nowhere.
The two files are vendored into your repository and are yours.

**No behaviour change when the hub is absent.** The shim writes a dict into
`hass.data` and fires a dispatcher signal. Nothing listens if the hub is
not installed; nothing breaks if the user removes it later. Load order
does not matter, because either side creates the dict.

**No frontend work.** No card, no YAML, no config flow for card options, no
CSS. Your data appears on the user's floor plan, on the right floor, in the
right room.

**No layout to store.** Do not send positions. The hub places each node in
the middle of its area, the user drags it from there, and that arrangement
belongs to the hub from then on. You never learn about it and never save it.

## Why files instead of a package on PyPI

Because the promise above is *"this costs you nothing"*, and a dependency is
not nothing. It is a version to pin, a conflict to resolve, a supply-chain
question to answer at review time, and one more reason for a reviewer to
say no.

The one thing a package would have bought you — knowing your copy is old —
is handled without it. The shim stamps `SDK_VERSION` into its registration,
and the hub reports it in `spatial_hub/diagnostics`, flagging a copy that
is behind. Nothing calls home; the hub simply knows what it ships.

If your copy is old, it keeps working. You are told, not punished.

## Checking that it is right

`spatial_hub_conformance.py` goes in your test folder:

```python
from .spatial_hub_conformance import FakeHass, SpatialHubConformance

class TestSpatialHub(SpatialHubConformance):
    def build_registration(self):
        hass = FakeHass()
        async_setup_my_provider(hass, entry, coordinator)
        return hass.registrations["my_domain"]
```

**pytest and nothing else** — no Home Assistant, no hub, no async plugin.
It runs against the same registration dict the hub sees, and it catches the
things that actually break floor plans in the field. The big one: node ids
that change between two polls, which silently throws away every position
the user arranged.

## Two worked examples

[`examples/minimal_provider/`](../examples/minimal_provider/__init__.py) is
the shortest honest version — **five lines**, a list of entity ids. Home
Assistant already knows what `light.kitchen` is called, which area it is in
and whether it is on, so you say nothing but the id.

[`examples/example_provider/`](../examples/example_provider/__init__.py) is
a whole integration for when that is no longer enough: edges, a popup, an
action, and a coordinator that keeps the plan live.

Neither is a snippet. Our own test suite sets both up, drives them through
the real hub, and holds them to the same conformance contract as a
stranger's code — so they cannot quietly rot.

## Drawing instead of delivering?

Then you want the other side of this folder.
[`spatial_hub_renderer_conformance.py`](spatial_hub_renderer_conformance.py)
is the conformance kit for **renderers** — the same idea, one file, pytest
and nothing else, but it reads your source instead of a registration,
because source is all an outsider has.

There is no renderer shim to go with it, and that is deliberate: a shim
would have to pick a language and a framework, and a renderer in a terminal
has nothing to do with a JavaScript helper library. Two websocket commands
and a JSON model need no help. Independence, on the other hand, cannot be
asserted — only demonstrated.

Who already draws the model: [docs/RENDERERS.md](../docs/RENDERERS.md).

## The rest

[Provider API reference](../docs/PROVIDER_API.md) — nodes, edges, states,
actions, history, custom icons, capabilities, diagnostics.

## If you would rather not

That is a completely reasonable answer, and it costs your users nothing:
they can build the layer themselves in the hub's own editor by describing
what belongs on it ("all the lights in this integration's area"). The
adapter is better — it knows what your data means, and it can draw the
connections between things — but nobody is stuck without it.
