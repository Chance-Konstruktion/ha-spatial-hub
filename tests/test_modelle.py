"""The data model's edges: what arrives when a provider sends nonsense.

The normalisation is deliberately forgiving -- a malformed node is
dropped, an unknown key lands in metadata. These tests hold that promise
at the boundaries: missing ids, half positions, garbage anchors.
"""

from __future__ import annotations

import pytest

from custom_components.spatial_hub.models import (
    Action,
    Edge,
    Layer,
    Node,
    Position,
    SpatialError,
)


def test_a_position_that_is_not_a_dict_is_no_position():
    assert Position.from_dict(None) is None
    assert Position.from_dict("0.5,0.5") is None
    assert Position.from_dict({"x": "nope", "y": 0.5}) is None
    assert Position.from_dict({"x": 0.5}) is None, "y missing: no position"


def test_a_position_keeps_its_height():
    assert Position.from_dict({"x": 0.5, "y": 0.5, "z": 2.5}).z == 2.5
    assert Position.from_dict({"x": 0.5, "y": 0.5}).z == 0.0


def test_an_action_without_an_id_is_no_action():
    assert Action.from_dict({"label": "Neustart"}) is None
    action = Action.from_dict({"id": "reboot"})
    assert action.label == "reboot", "the id steps in until a label exists"
    assert action.as_dict() == {
        "id": "reboot", "label": "reboot", "icon": "", "confirm": False,
    }


def test_anchors_that_are_not_a_list_are_no_anchors():
    assert Node.from_dict({"id": "a", "anchors": "hier"}).anchors == []
    assert Node.from_dict({"id": "a", "anchors": 7}).anchors == []


def test_anchor_garbage_is_dropped_piece_by_piece():
    node = Node.from_dict({
        "id": "a",
        "anchors": [
            "kein dict",
            {"weight": 2},                      # no id
            {"id": "b", "weight": "schwer"},    # weight not a number
            {"id": "b", "weight": 0},           # zero pulls nowhere
            {"id": "b", "weight": -1},          # negative pushes off-plan
            {"id": "b", "weight": float("nan")},
            {"id": "b", "weight": float("inf")},
            {"id": "b", "weight": 2},           # the one that survives
        ],
    })
    assert node.anchors == [{"id": "b", "weight": 2}]


def test_only_the_first_sixteen_anchors_count():
    node = Node.from_dict({
        "id": "a",
        "anchors": [{"id": f"knoten-{i}"} for i in range(40)],
    })
    assert len(node.anchors) == 16


def test_actions_that_are_not_dicts_are_dropped():
    node = Node.from_dict({
        "id": "a",
        "actions": ["toggle", {"id": "reboot", "confirm": True}, {"id": ""}],
    })
    assert [a.id for a in node.actions] == ["reboot"]
    assert node.actions[0].confirm is True


def test_a_layer_without_an_id_is_refused():
    with pytest.raises(SpatialError):
        Layer.from_dict({"name": "Licht"})


def test_layer_garbage_falls_back_to_the_defaults():
    layer = Layer.from_dict({
        "id": "licht", "z_index": "oben", "opacity": "durchsichtig",
        "visible": "ja",
    })
    assert layer.z_index == 10
    assert layer.opacity == 1.0
    assert layer.visible is True


def test_an_edge_without_endpoints_is_refused():
    with pytest.raises(SpatialError):
        Edge.from_dict({"id": "e", "source": "a"})
    with pytest.raises(SpatialError):
        Edge.from_dict({"id": "e", "target": "b"})


def test_an_edge_without_an_id_is_named_by_its_endpoints():
    edge = Edge.from_dict({"source": "a", "target": "b"})
    assert edge.id == "a__b"


def test_edge_garbage_falls_back_to_the_defaults():
    edge = Edge.from_dict({
        "source": "a", "target": "b", "width": "dick",
        "directed": "ja", "value": "viel",
    })
    assert edge.width == 2.0
    assert edge.directed is True, "any stated truthiness is a statement"
    assert edge.value is None


# ── Dokumentierter Fehler, nicht repariert ────────────────────────────


def test_bug_opacity_null_wird_zur_voreinstellung():
    """FALSCHES Verhalten, absichtlicherweise gruen -- siehe BERICHT.md.

    Die Spezifikation (docs/SPECIFICATION.md, § Layer) erlaubt opacity
    0..1. Layer.from_dict liest sie mit ``_float_or_none(...) or
    DEFAULT_LAYER_OPACITY`` -- und 0 ist falsy, also bekommt ein Anbieter,
    der eine Ebene mit opacity 0 meldet, die Voreinstellung 1.0. Dieselbe
    Zeile macht aus z_index 0 die 10, Edge.from_dict aus width 0 die 2.0.

    Erwartet gemaess Spezifikation: 0. Tatsaechlich: 1.0.
    """
    assert Layer.from_dict({"id": "licht", "opacity": 0}).opacity == 1.0, (
        "Fehler dokumentiert, nicht gebilligt: laut Spezifikation ist 0 "
        "ein gueltiger Wert fuer opacity"
    )
    assert Layer.from_dict({"id": "licht", "z_index": 0}).z_index == 10, (
        "Fehler dokumentiert, nicht gebilligt: 0 ist eine gueltige "
        "Zeichenreihenfolge"
    )
    assert Edge.from_dict(
        {"source": "a", "target": "b", "width": 0}
    ).width == 2.0, (
        "Fehler dokumentiert, nicht gebilligt: 0 ist eine gueltige Breite"
    )
