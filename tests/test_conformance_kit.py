"""The conformance kit developers copy into their own test suite.

Two things must hold: a correct provider passes it, and the mistakes that
actually break floor plans in the field are caught. The second half is the
point -- a kit that only ever says "ok" teaches nobody anything.
"""

from __future__ import annotations

import importlib.util
from pathlib import Path

import pytest

_SDK = Path(__file__).resolve().parents[1] / "sdk"


def _load(name: str):
    spec = importlib.util.spec_from_file_location(name, _SDK / f"{name}.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


kit = _load("spatial_hub_conformance")
shim = _load("spatial_hub_provider")


def _registration(**overrides):
    """A well-behaved provider, built the way a developer would build it."""
    hass = kit.FakeHass()
    provider = shim.SpatialHubProvider(
        hass,
        provider_id="demo",
        name="Demo",
        data=lambda: {
            "nodes": [
                shim.node("a", label="A", tx_rate=560),
                shim.node("b", label="B"),
            ],
            "edges": [shim.edge("a", "b", value=560, quality="good")],
        },
        action=lambda kind, item, act, data: {"success": True},
    )
    provider.async_register()
    registration = hass.registrations["demo"]
    registration.update(overrides)
    return registration


def test_a_correct_provider_passes_cleanly():
    assert kit.check(_registration()) == []


def test_the_shim_output_is_conformant_by_construction():
    """Whatever the documented shim produces must satisfy the kit."""

    class TestSuite(kit.SpatialHubConformance):
        def build_registration(self):
            return _registration()

    suite = TestSuite()
    for name in dir(suite):
        if name.startswith("test_"):
            getattr(suite, name)()


@pytest.mark.parametrize(
    ("overrides", "expected"),
    [
        pytest.param(
            {"data": lambda: {"nodes": [{"id": "a"}, {"id": "a"}]}},
            "duplicate node ids",
            id="duplicate ids",
        ),
        pytest.param(
            {"data": lambda: {"nodes": [], "edges": [
                {"id": "e", "source": "a", "target": "ghost"}]}},
            "unknown node",
            id="edge into nowhere",
        ),
        pytest.param(
            {"data": lambda: {"nodes": [
                {"id": "a", "position": {"x": 250, "y": 300}}]}},
            "outside 0..1",
            id="pixel positions",
        ),
        pytest.param(
            {"data": lambda: {"nodes": [], "edges": [
                {"id": "e", "source": "a", "target": "b", "quality": "yellow"}]}},
            "shared vocabulary",
            id="private quality vocabulary",
        ),
        pytest.param(
            {"data": lambda: {"nodes": [{"id": "a", "colour": "#fff"}]}},
            "unknown keys",
            id="misspelled node key",
        ),
        pytest.param(
            {"capabilties": {"nodes": True}},
            "unknown registration keys",
            id="misspelled registration key",
        ),
        pytest.param(
            {"capabilities": {"history": True}},
            "no history callable",
            id="capability without callable",
        ),
        pytest.param(
            {"data": lambda: (_ for _ in ()).throw(RuntimeError("boom"))},
            "RuntimeError: boom",
            id="raising provider",
        ),
        pytest.param(
            {"data": lambda: "not a payload"},
            "expects a dict",
            id="wrong payload type",
        ),
    ],
)
def test_the_kit_catches_the_classic_mistakes(overrides, expected):
    problems = " | ".join(kit.check(_registration(**overrides)))
    assert expected in problems, f"not caught. Reported: {problems}"


def test_unstable_ids_are_caught():
    """The one that silently destroys a user's arrangement on every poll."""
    counter = iter(range(100))

    problems = kit.check(
        _registration(data=lambda: {"nodes": [{"id": f"node_{next(counter)}"}]})
    )
    assert any("changed between two calls" in problem for problem in problems)


def test_unserialisable_metadata_is_caught():
    """It would take down the model for every provider, not just this one."""
    from datetime import datetime

    problems = kit.check(
        _registration(
            data=lambda: {"nodes": [
                {"id": "a", "metadata": {"seen": datetime.now()}}
            ]}
        )
    )
    assert any("not JSON-serialisable" in problem for problem in problems)


def test_provider_id_must_be_stable_and_readable():
    problems = kit.check(_registration(provider_id="My Integration!"))
    assert any("snake_case" in problem for problem in problems)
