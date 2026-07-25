# Provider SDK

You maintain a Home Assistant integration and somebody asked you to
support Floorplan-Hub. This page is the whole answer.

## The short version

```bash
python3 sdk/install.py --into path/to/custom_components/<your_domain> \
                       --tests path/to/tests
```

Two files copied, and it prints the code to add. Then, in
`async_setup_entry`:

```python
from .floorplan_hub_provider import floorplan_provider

floorplan_provider(
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
and the hub reports it in `floorplan_hub/diagnostics`, flagging a copy that
is behind. Nothing calls home; the hub simply knows what it ships.

If your copy is old, it keeps working. You are told, not punished.

## Checking that it is right

`floorplan_hub_conformance.py` goes in your test folder:

```python
from .floorplan_hub_conformance import FakeHass, FloorplanHubConformance

class TestFloorplanHub(FloorplanHubConformance):
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

## A complete worked example

[`examples/example_provider/`](../examples/example_provider/) is a whole
integration, not a snippet — around forty meaningful lines. Our own test
suite sets it up, drives it through the real hub, and holds it to the same
conformance contract as a stranger's code, so it cannot quietly rot.

## The rest

[Provider API reference](../docs/PROVIDER_API.md) — nodes, edges, states,
actions, history, custom icons, capabilities, diagnostics.

## If you would rather not

That is a completely reasonable answer, and it costs your users nothing:
they can build the layer themselves in the hub's own editor by describing
what belongs on it ("all the lights in this integration's area"). The
adapter is better — it knows what your data means, and it can draw the
connections between things — but nobody is stuck without it.
