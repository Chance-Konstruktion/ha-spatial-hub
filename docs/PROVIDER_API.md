# Provider API (v1)

Everything an integration needs to appear on the floor plan. Reading time:
about five minutes. Implementation time: about ten.

The hub never imports your integration and you never import the hub. The
whole coupling is one dict in `hass.data` and three dispatcher signals.
That means:

- your integration works exactly the same when the hub is not installed
- load order does not matter — whoever is first creates the dict
- the hub can be updated, reloaded or removed without touching you

## 1. Copy the shim

Copy [`floorplan_hub_provider.py`](./floorplan_hub_provider.py) into your
integration folder. Do not import it from the hub package.

## 2. Register

```python
from .floorplan_hub_provider import FloorplanHubProvider

provider = FloorplanHubProvider(
    hass,
    provider_id="my_integration",   # unique, stable, snake_case
    name="My Integration",
    icon="mdi:flash",
    version="1.0.0",
    capabilities={"nodes": True, "edges": True, "history": True},
    layers=[{"id": "my_layer", "name": "My Layer", "icon": "mdi:flash",
             "z_index": 20}],
    data=build_spatial_payload,
)
provider.async_register()
entry.async_on_unload(provider.async_unregister)
```

Call `provider.async_notify()` whenever your data changed (e.g. at the end
of a coordinator refresh). The hub pushes a hint to connected cards, which
then re-fetch. You never push data yourself.

## 3. Deliver data

`data` is a callable (sync or async) returning:

```python
{
    "nodes": [
        {
            "id": "f5e0dc",                 # unique within your provider
            "label": "Router EG",
            "area_id": "wohnzimmer",        # HA area id — that is all the
                                            # placement info the hub needs
            "state": "online",              # online | offline | unknown | your own
            "icon": "mdi:lan",              # or a key from your icon_set
            "color": "#00ff00",
            "entity_id": "sensor.router_eg",  # optional, enables more-info
            "layer_id": "my_layer",         # optional, defaults to your first layer
            "actions": [{"id": "reboot", "label": "Reboot", "confirm": True}],
            "metadata": {"tx_rate": 560},   # free-form, shown in the popup
        }
    ],
    "edges": [
        {
            "id": "f5e0dc__f5dba7",
            "source": "f5e0dc",             # your own node ids, not namespaced
            "target": "f5dba7",
            "value": 560,
            "quality": "good",              # good | fair | poor | unknown
            "width": 3,
            "animated": True,
            "metadata": {},
        }
    ],
}
```

Optional keys on a node: `floor_id`, `position` (`{"x": 0.25, "y": 0.6}` in
normalised 0..1 floor coordinates). **Leave `position` out** unless you
genuinely know where the device is — the hub places it in the centre of its
area, and the user drags it from there. Positions the user sets are stored
in the hub and never sent back to you.

Ids are namespaced by the hub (`my_integration:f5e0dc`), so two providers
can both have a node called `router` without colliding. Use your own plain
ids everywhere in your payload.

### Robustness

The hub treats provider code as untrusted: a `data` call that raises, times
out (10 s) or returns nonsense costs your layer for that one refresh and
nothing else. A single malformed node is dropped, not the whole payload. So
prefer returning partial data over raising.

## 4. Capabilities

Describe yourself; the hub switches features on accordingly and never
special-cases your integration by name.

| Capability | Meaning |
|---|---|
| `nodes` | you deliver nodes (nearly everyone) |
| `edges` | you deliver connections between nodes |
| `history` | your `history` callable serves time series |
| `animation` | your edges/nodes are meant to be animated |
| `popup` | your metadata is worth a detail popup |
| `actions` | your `action` callable can be invoked |
| `custom_icons` | you ship an `icon_set` |

## 5. Optional: history

```python
def history(kind: str, item_id: str, hours: float) -> list[dict]:
    """kind is "node" or "edge"; item_id is YOUR id, already un-namespaced."""
    return [{"t": "2026-07-25T20:00:00+02:00", "value": 560}, ...]
```

## 6. Optional: actions

```python
async def action(kind: str, item_id: str, action_id: str, data: dict) -> dict:
    if action_id == "reboot":
        await my_reboot(item_id)
    return {"success": True}
```

The hub forwards without interpreting — "toggle" means whatever you decide.
Actions require an admin user.

## 7. Optional: custom icons

```python
icon_set={
    "powerline_online": {"svg": "<svg …>", "default_color": "#00ff00"},
    "powerline_offline": {"svg": "<svg …>", "animation": "pulse"},
}
```

Reference a key by name in a node's `icon`. Renderers fall back to MDI when
they don't support inline SVG.

## Websocket API (for renderers)

| Command | Purpose |
|---|---|
| `floorplan_hub/model` | the complete spatial model |
| `floorplan_hub/providers` | who is registered, and their capabilities |
| `floorplan_hub/subscribe` | push hint when anything changed |
| `floorplan_hub/layout/set` | persist one piece of the user's arrangement |
| `floorplan_hub/layout/reset` | drop overrides for one item |
| `floorplan_hub/history` | time series for one node/edge |
| `floorplan_hub/action` | run a provider action (admin) |

`history` and `action` address an item with `item_id` (the namespaced
`provider:local` id) — not `id`, which the websocket protocol reserves for
the message itself.

In `layout/set`, a `null` value clears an override and restores the
automatic placement — that is how "reset to auto" is expressed.
