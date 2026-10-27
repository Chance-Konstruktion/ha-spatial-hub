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
async def test_nonfinite_numbers_are_sanitized_before_the_model_is_rendered():
    provider = Provider.from_registration(
        _registration(
            data=lambda: {
                "nodes": [
                    {"id": "bad_xy", "position": {"x": float("nan"), "y": 0.5}},
                    {"id": "bad_z", "position": {
                        "x": 0.2, "y": 0.3, "z": float("inf")
                    }},
                ],
                "edges": [{
                    "source": "bad_xy", "target": "bad_z",
                    "value": float("inf"), "width": float("nan"),
                }],
            }
        )
    )

    result = await provider.async_fetch()
    nodes = {node.id: node for node in result.nodes}
    edge = result.edges[0]

    assert nodes["demo:bad_xy"].position is None
    assert nodes["demo:bad_z"].position.z == 0.0
    assert edge.value is None
    assert edge.width == 2.0


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


# ── Kaputte Anmeldungen: gemeldet statt geglaubt ──────────────────────


def test_a_registration_that_is_not_a_dict_is_refused():
    with pytest.raises(ProviderError):
        Provider.from_registration("gib mir alles")
    with pytest.raises(ProviderError):
        Provider.from_registration(None)


def test_a_panel_url_that_leaves_the_house_is_dropped():
    """A renderer turns panel_url into a link the user clicks. Third-party
    data decides where that goes -- so only a path inside this instance
    survives."""
    assert Provider.from_registration(
        _registration(panel_url="/powerline")
    ).panel_url == "/powerline"
    for url in ("javascript:alert(1)", "https://example.com/x", "//host/y",
                "/x" * 200):
        assert Provider.from_registration(
            _registration(panel_url=url)
        ).panel_url == "", url


def test_uncallable_history_and_action_are_reported_and_ignored():
    """A string where a callable belongs is a typo. Ignoring it keeps the
    layer alive; keeping it would hand the hub a bomb for later."""
    provider = Provider.from_registration(
        _registration(history="bald", action=42)
    )
    assert provider.history_fn is None
    assert provider.action_fn is None
    assert any("'history' is not callable" in w for w in provider.warnings)
    assert any("'action' is not callable" in w for w in provider.warnings)


def test_a_bad_layer_is_skipped_and_reported():
    provider = Provider.from_registration(
        _registration(layers=[{"no_id": True}, {"id": "guter_layer"}])
    )
    assert [layer.id for layer in provider.layers] == ["guter_layer"]
    assert any("skipped bad layer" in w for w in provider.warnings), (
        "the developer must hear why a layer they wrote does not exist"
    )


@pytest.mark.asyncio
async def test_a_payload_that_is_neither_dict_nor_list_is_reported():
    provider = Provider.from_registration(_registration(data=lambda: 42))
    result = await provider.async_fetch()
    assert result.error == "data returned int, expected dict or list"
    assert result.as_status()["ok"] is False


@pytest.mark.asyncio
async def test_nodes_that_are_not_a_list_are_reported():
    provider = Provider.from_registration(
        _registration(data=lambda: {"nodes": "light.kitchen"})
    )
    result = await provider.async_fetch()
    assert result.nodes == []
    assert any("nodes must be a list, got str" in w for w in result.warnings)


@pytest.mark.asyncio
async def test_a_timing_out_provider_costs_only_its_own_refresh(
    monkeypatch,
):
    """A hung integration must not hang the floor plan. Ten seconds are
    too long to wait out in a test, so the limit is turned down here --
    the mechanism under test is the same one."""
    import asyncio

    from custom_components.spatial_hub import registry

    monkeypatch.setattr(registry, "DATA_TIMEOUT", 0.05)

    async def dauert_ewig():
        await asyncio.sleep(5)

    provider = Provider.from_registration(_registration(data=dauert_ewig))
    result = await provider.async_fetch()

    assert result.error is not None and "timed out" in result.error
    assert (result.nodes, result.edges) == ([], [])


# ── Dieselben Stellen, repariert: eine kaputte Anmeldung kostet nur
# sich selbst ──────────────────────────────────────────────────────────
# Ersetzt die frueheren Zeig-Tests test_bug_eine_kaputte_api_version_
# reisst_die_ganze_ladung_mit und test_bug_ein_icon_set_das_keines_ist_
# reisst_auch_mit, die das kaputte Verhalten festhielten (BERICHT.md,
# Fehler 1).


def test_a_broken_api_version_costs_only_its_own_registration(
    hass, caplog
):
    """int() over a third party's api_version must not escape the
    except ProviderError: a registration that writes "drei" where a
    number belongs is skipped and warned about, like any unusable
    registration -- and the healthy ones stay loaded.
    """
    hass.data["spatial_hub_providers"] = {
        "gut": _registration(),
        "kaputt": _registration(provider_id="kaputt", api_version="drei"),
    }
    providers = async_load_providers(hass)
    assert set(providers) == {"demo"}, (
        "one broken registration must not take the healthy ones down"
    )
    assert "Ignoring provider kaputt" in caplog.text, (
        "the developer must find out why their provider is missing"
    )


def test_an_icon_set_that_is_not_one_costs_only_its_own_registration(
    hass, caplog
):
    """Same hole, same rule: dict() over a non-iterable icon_set raises
    TypeError, which used to escape except ProviderError and kill the
    whole load (BERICHT.md, Fehler 1). Now: skip, warn, keep the rest.
    """
    hass.data["spatial_hub_providers"] = {
        "gut": _registration(),
        "kaputt": _registration(provider_id="kaputt", icon_set=42),
    }
    providers = async_load_providers(hass)
    assert set(providers) == {"demo"}, (
        "one broken registration must not take the healthy ones down"
    )
    assert "Ignoring provider kaputt" in caplog.text, (
        "the developer must find out why their provider is missing"
    )
