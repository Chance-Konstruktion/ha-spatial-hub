"""Provider registration: validation, namespacing and fault tolerance."""

from __future__ import annotations

import pytest

from custom_components.spatial_hub.registry import (
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
    result = await provider.async_fetch()
    assert [node.id for node in result.nodes] == ["demo:router", "demo:peer"]
    assert (result.edges[0].source, result.edges[0].target) == (
        "demo:router", "demo:peer"
    )
    assert result.nodes[0].metadata["provider_id"] == "demo"
    assert result.nodes[0].metadata["layer_id"] == "demo_layer"


@pytest.mark.asyncio
async def test_raising_provider_costs_only_its_own_layer():
    def explode():
        raise RuntimeError("boom")

    provider = Provider.from_registration(_registration(data=explode))
    result = await provider.async_fetch()

    assert (result.nodes, result.edges) == ([], [])
    assert "RuntimeError: boom" in result.error, (
        "the developer must be able to see why their layer went empty"
    )


@pytest.mark.asyncio
async def test_broken_items_are_dropped_not_the_payload():
    provider = Provider.from_registration(
        _registration(
            data=lambda: {
                "nodes": [{"id": "good"}, {"no_id": True}, 42],
                "edges": [{"source": "good"}],  # no target
            }
        )
    )
    result = await provider.async_fetch()

    assert [node.id for node in result.nodes] == ["demo:good"]
    assert result.edges == []
    assert len(result.warnings) == 3, "each dropped item is reported"


@pytest.mark.asyncio
async def test_a_bare_entity_id_is_a_complete_node():
    """The shortest possible node definition -- HA knows the rest."""
    provider = Provider.from_registration(
        _registration(data=lambda: {"nodes": ["light.kitchen"]})
    )
    result = await provider.async_fetch()

    assert result.nodes[0].id == "demo:light.kitchen"
    assert result.nodes[0].entity_id == "light.kitchen"
    assert result.warnings == []


@pytest.mark.asyncio
async def test_a_bare_list_of_nodes_is_a_valid_payload():
    provider = Provider.from_registration(
        _registration(data=lambda: ["light.kitchen", {"id": "b"}])
    )
    result = await provider.async_fetch()

    assert [node.id for node in result.nodes] == ["demo:light.kitchen", "demo:b"]


@pytest.mark.asyncio
async def test_typos_in_the_registration_are_reported():
    provider = Provider.from_registration(_registration(capabilties={"nodes": True}))

    assert any("capabilties" in warning for warning in provider.warnings)


@pytest.mark.asyncio
async def test_async_data_callable_is_awaited():
    async def data():
        return {"nodes": [{"id": "a"}]}

    provider = Provider.from_registration(_registration(data=data))
    result = await provider.async_fetch()
    assert result.nodes[0].id == "demo:a"


def test_load_providers_skips_the_invalid_ones(hass):
    hass.data["spatial_hub_providers"] = {
        "demo": _registration(),
        "broken": {"provider_id": "broken"},  # no data callable
    }
    providers = async_load_providers(hass)
    assert set(providers) == {"demo"}
