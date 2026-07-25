"""Provider registration: validation, namespacing and fault tolerance."""

from __future__ import annotations

import pytest

from custom_components.floorplan_hub.registry import (
    Provider,
    ProviderError,
    async_load_providers,
)


def _registration(**overrides):
    base = {
        "provider_id": "demo",
        "api_version": 1,
        "name": "Demo",
        "icon": "mdi:flash",
        "capabilities": {"nodes": True, "edges": True},
        "layers": [{"id": "demo_layer", "name": "Demo Layer"}],
        "data": lambda: {"nodes": [{"id": "a"}], "edges": []},
    }
    base.update(overrides)
    return base


def test_registration_requires_id_and_data():
    with pytest.raises(ProviderError):
        Provider.from_registration(_registration(provider_id=""))
    with pytest.raises(ProviderError):
        Provider.from_registration(_registration(data="not callable"))


def test_future_api_version_is_refused():
    """A v2 provider must not be half-understood by a v1 hub."""
    with pytest.raises(ProviderError):
        Provider.from_registration(_registration(api_version=99))


def test_provider_without_layers_gets_a_default_one():
    provider = Provider.from_registration(_registration(layers=[]))
    assert provider.default_layer_id == "demo"
    assert provider.layers[0].name == "Demo"


@pytest.mark.asyncio
async def test_ids_are_namespaced_per_provider():
    """Two providers may both call a node "router" without colliding."""
    provider = Provider.from_registration(
        _registration(
            data=lambda: {
                "nodes": [{"id": "router"}, {"id": "peer"}],
                "edges": [{"id": "link", "source": "router", "target": "peer"}],
            }
        )
    )
    nodes, edges = await provider.async_fetch()
    assert [node.id for node in nodes] == ["demo:router", "demo:peer"]
    assert (edges[0].source, edges[0].target) == ("demo:router", "demo:peer")
    assert nodes[0].metadata["provider_id"] == "demo"
    assert nodes[0].metadata["layer_id"] == "demo_layer"


@pytest.mark.asyncio
async def test_raising_provider_costs_only_its_own_layer():
    def explode():
        raise RuntimeError("boom")

    provider = Provider.from_registration(_registration(data=explode))
    assert await provider.async_fetch() == ([], [])


@pytest.mark.asyncio
async def test_broken_items_are_dropped_not_the_payload():
    provider = Provider.from_registration(
        _registration(
            data=lambda: {
                "nodes": [{"id": "good"}, {"no_id": True}, "garbage"],
                "edges": [{"source": "good"}],  # no target
            }
        )
    )
    nodes, edges = await provider.async_fetch()
    assert [node.id for node in nodes] == ["demo:good"]
    assert edges == []


@pytest.mark.asyncio
async def test_async_data_callable_is_awaited():
    async def data():
        return {"nodes": [{"id": "a"}]}

    provider = Provider.from_registration(_registration(data=data))
    nodes, _ = await provider.async_fetch()
    assert nodes[0].id == "demo:a"


def test_load_providers_skips_the_invalid_ones(hass):
    hass.data["floorplan_hub_providers"] = {
        "demo": _registration(),
        "broken": {"provider_id": "broken"},  # no data callable
    }
    providers = async_load_providers(hass)
    assert set(providers) == {"demo"}
