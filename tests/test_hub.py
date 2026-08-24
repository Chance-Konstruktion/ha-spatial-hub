"""Model assembly: auto-placement, user overrides, provider isolation."""

from __future__ import annotations

import pytest

from custom_components.spatial_hub.const import UNASSIGNED_FLOOR_ID
from custom_components.spatial_hub.hub import SpatialHub
from custom_components.spatial_hub.storage import LayoutStore

from conftest import FakeArea, FakeFloor


@pytest.fixture
def hub(hass):
    from homeassistant.helpers import area_registry as ar, floor_registry as fr

    floors = fr.async_get(hass)
    floors.floors = [FakeFloor("eg", "Erdgeschoss", level=0),
                     FakeFloor("og", "Obergeschoss", level=1)]
    areas = ar.async_get(hass)
    areas.areas = [
        FakeArea("wohnzimmer", "Wohnzimmer", floor_id="eg"),
        FakeArea("kueche", "Küche", floor_id="eg"),
        FakeArea("schlafzimmer", "Schlafzimmer", floor_id="og"),
    ]
    return SpatialHub(hass, LayoutStore(hass))


def _register(hass, provider_id="demo", **overrides):
    registration = {
        "provider_id": provider_id,
        "name": provider_id.title(),
        "capabilities": {"nodes": True, "edges": True},
        "layers": [{"id": f"{provider_id}_layer", "name": "Layer",
                    "z_index": 10}],
        "data": lambda: {"nodes": [{"id": "a", "area_id": "wohnzimmer"}],
                         "edges": []},
    }
    registration.update(overrides)
    hass.data.setdefault("spatial_hub_providers", {})[provider_id] = registration
    return registration


@pytest.mark.asyncio
async def test_model_has_floors_areas_and_provider_data(hass, hub):
    _register(hass)
    model = await hub.async_model()

    assert [floor["id"] for floor in model["floors"]] == ["eg", "og"]
    assert {area["id"] for area in model["areas"]} == {
        "wohnzimmer", "kueche", "schlafzimmer"
    }
    assert [node["id"] for node in model["nodes"]] == ["demo:a"]
    assert model["providers"][0]["capabilities"]["edges"] is True


@pytest.mark.asyncio
async def test_node_lands_in_the_centre_of_its_area(hass, hub):
    _register(hass)
    model = await hub.async_model()

    area = next(a for a in model["areas"] if a["id"] == "wohnzimmer")
    node = model["nodes"][0]
    assert node["position"]["x"] == pytest.approx(area["position"]["x"])
    assert node["position"]["y"] == pytest.approx(area["position"]["y"])
    assert node["floor_id"] == "eg", "floor is inherited from the area"


@pytest.mark.asyncio
async def test_nodes_in_one_area_are_spread_apart(hass, hub):
    _register(
        hass,
        data=lambda: {
            "nodes": [{"id": f"n{i}", "area_id": "kueche"} for i in range(3)],
            "edges": [],
        },
    )
    model = await hub.async_model()
    positions = {(n["position"]["x"], n["position"]["y"]) for n in model["nodes"]}
    assert len(positions) == 3


@pytest.mark.asyncio
async def test_user_position_beats_auto_placement(hass, hub):
    _register(hass)
    hub.store.update("nodes", "demo:a", {"position": {"x": 0.9, "y": 0.1}})

    model = await hub.async_model()
    node = model["nodes"][0]
    assert (node["position"]["x"], node["position"]["y"]) == (0.9, 0.1)
    assert node["metadata"]["auto_position"] is False


@pytest.mark.asyncio
async def test_clearing_an_override_restores_auto_placement(hass, hub):
    _register(hass)
    hub.store.update("nodes", "demo:a", {"position": {"x": 0.9, "y": 0.1}})
    hub.store.update("nodes", "demo:a", {"position": None})

    node = (await hub.async_model())["nodes"][0]
    assert node["position"]["x"] != 0.9


@pytest.mark.asyncio
async def test_hidden_things_are_reported_so_they_can_come_back(hass, hub):
    """Hiding must not be a one-way door -- an editor needs the list."""
    _register(hass, data=lambda: {"nodes": [{"id": "a"}, {"id": "b"}]})
    hub.store.update("nodes", "demo:b", {"hidden": True})
    hub.store.update("areas", "kueche", {"hidden": True})

    model = await hub.async_model()

    assert [n["id"] for n in model["nodes"]] == ["demo:a"]
    assert model["hidden"]["nodes"] == [{"id": "demo:b", "label": "b"}]
    assert model["hidden"]["areas"] == [{"id": "kueche", "name": "Küche"}]
    assert "kueche" not in {area["id"] for area in model["areas"]}


@pytest.mark.asyncio
async def test_nothing_hidden_means_empty_lists_not_missing_keys(hass, hub):
    _register(hass)
    model = await hub.async_model()
    assert model["hidden"] == {"nodes": [], "areas": []}


@pytest.mark.asyncio
async def test_the_user_can_reorder_the_floors(hass, hub):
    _register(hass)
    hub.store.update("floors", "og", {"order": -1})

    model = await hub.async_model()
    assert [floor["id"] for floor in model["floors"]] == ["og", "eg"], (
        "an explicit order beats the registry's level"
    )


@pytest.mark.asyncio
async def test_hidden_node_and_its_edges_disappear(hass, hub):
    _register(
        hass,
        data=lambda: {
            "nodes": [{"id": "a"}, {"id": "b"}],
            "edges": [{"id": "e", "source": "a", "target": "b"}],
        },
    )
    hub.store.update("nodes", "demo:b", {"hidden": True})

    model = await hub.async_model()
    assert [n["id"] for n in model["nodes"]] == ["demo:a"]
    assert model["edges"] == [], "an edge into nothing must not be rendered"


@pytest.mark.asyncio
async def test_layers_are_sorted_by_z_index_and_respect_overrides(hass, hub):
    _register(hass, "demo")
    _register(hass, "other", layers=[{"id": "other_layer", "z_index": 5}])
    hub.store.update("layers", "demo_layer", {"visible": False})

    model = await hub.async_model()
    assert [layer["id"] for layer in model["layers"]] == [
        "other_layer", "demo_layer"
    ]
    assert model["layers"][1]["visible"] is False


@pytest.mark.asyncio
async def test_one_broken_provider_does_not_take_the_others_down(hass, hub):
    def explode():
        raise RuntimeError("boom")

    _register(hass, "demo")
    _register(hass, "broken", data=explode)

    model = await hub.async_model()
    assert [node["id"] for node in model["nodes"]] == ["demo:a"]
    assert len(model["providers"]) == 2, "the broken provider still exists"


@pytest.mark.asyncio
async def test_actions_are_forwarded_to_the_owning_provider(hass, hub):
    calls = []

    def action(kind, item_id, action_id, data):
        calls.append((kind, item_id, action_id, data))
        return {"success": True}

    _register(hass, "demo", action=action)
    result = await hub.async_action("node", "demo:a", "reboot", {"force": True})

    assert result == {"success": True}
    assert calls == [("node", "a", "reboot", {"force": True})], (
        "the provider sees its own id, not the namespaced one"
    )


@pytest.mark.asyncio
async def test_action_for_unknown_provider_raises(hass, hub):
    with pytest.raises(LookupError):
        await hub.async_action("node", "nobody:a", "reboot", {})


@pytest.mark.asyncio
async def test_history_is_passed_through_un_namespaced(hass, hub):
    _register(hass, "demo", history=lambda kind, item_id, hours: [
        {"id": item_id, "kind": kind, "hours": hours}
    ])
    series = await hub.async_history("edge", "demo:a__b", 6)
    assert series == [{"id": "a__b", "kind": "edge", "hours": 6}]


@pytest.mark.asyncio
async def test_provider_without_history_returns_empty(hass, hub):
    _register(hass, "demo")
    assert await hub.async_history("node", "demo:a", 24) == []


def test_listeners_are_notified_and_survive_a_bad_subscriber(hass, hub):
    seen = []
    hub.async_add_listener(lambda reason: (_ for _ in ()).throw(ValueError()))
    remove = hub.async_add_listener(seen.append)

    hub.async_notify("layout")
    assert seen == ["layout"]

    remove()
    hub.async_notify("layout")
    assert seen == ["layout"]


def test_provider_signals_reach_listeners(hass, hub):
    from homeassistant.helpers.dispatcher import async_dispatcher_send

    seen = []
    hub.async_start()
    hub.async_add_listener(seen.append)

    async_dispatcher_send(hass, "spatial_hub_data_updated", "demo")
    assert seen == ["spatial_hub_data_updated:demo"]

    hub.async_stop()
    async_dispatcher_send(hass, "spatial_hub_data_updated", "demo")
    assert len(seen) == 1


@pytest.mark.asyncio
async def test_auto_areas_off_marks_unplaced_areas_instead_of_hiding_them(hass, hub):
    """A user who has placed nothing must not face an empty house."""
    _register(hass)
    hub.auto_areas = False
    hub.store.update("areas", "kueche", {"position": {"x": 0.2, "y": 0.2}})

    areas = {area["id"]: area for area in (await hub.async_model())["areas"]}

    assert set(areas) == {"wohnzimmer", "kueche", "schlafzimmer"}
    assert areas["kueche"]["position"] == {"x": 0.2, "y": 0.2}
    assert not areas["kueche"].get("unplaced")
    assert areas["wohnzimmer"]["unplaced"] is True
    assert areas["wohnzimmer"]["position"] is None, "no grid guess when off"


@pytest.mark.asyncio
async def test_nodes_still_get_placed_when_areas_are_unplaced(hass, hub):
    """Node placement must not fall over on an area without a position."""
    _register(hass)
    hub.auto_areas = False

    node = (await hub.async_model())["nodes"][0]
    assert node["position"] is not None


# ── Areas that belong to no floor ─────────────────────────


def _house(hass, floors, areas):
    from homeassistant.helpers import area_registry as ar, floor_registry as fr

    fr.async_get(hass).floors = floors
    ar.async_get(hass).areas = areas


@pytest.mark.asyncio
async def test_an_area_without_a_floor_gets_a_storey_of_its_own(hass):
    """Found by running the panel, not by reading the code.

    Floors arrived in Home Assistant years after areas, so most houses
    have some of each. Drawn on every floor, an unassigned area lands on
    top of that floor's real rooms -- whose grid was measured without it.
    """
    _house(
        hass,
        [FakeFloor("eg", "Erdgeschoss", level=0)],
        [FakeArea("bad", "Bad", floor_id="eg"), FakeArea("kueche", "Küche")],
    )

    model = await SpatialHub(hass, LayoutStore(hass)).async_model()

    assert [floor["id"] for floor in model["floors"]] == ["eg", UNASSIGNED_FLOOR_ID], (
        "the storey for the homeless areas is missing, or is not sorted last"
    )
    by_id = {area["id"]: area for area in model["areas"]}
    assert by_id["kueche"]["floor_id"] == UNASSIGNED_FLOOR_ID
    assert by_id["bad"]["floor_id"] == "eg"
    assert by_id["kueche"]["size"] == by_id["bad"]["size"], (
        "each is the only room on its own storey, so each gets the full box; "
        "sharing a tab, one of them would have been drawn over the other"
    )


@pytest.mark.asyncio
async def test_a_house_without_any_floors_gets_no_unassigned_tab(hass):
    """Then *everything* is unassigned, which tells the user nothing."""
    _house(hass, [], [FakeArea("kueche", "Küche"), FakeArea("bad", "Bad")])

    model = await SpatialHub(hass, LayoutStore(hass)).async_model()

    assert [floor["id"] for floor in model["floors"]] == ["default"]
    assert all(not area["floor_id"] for area in model["areas"]), (
        "areas were pushed onto an unassigned storey that does not exist"
    )


@pytest.mark.asyncio
async def test_a_node_follows_its_area_onto_the_unassigned_storey(hass):
    """Otherwise the node draws on a floor its room is not on."""
    _house(
        hass,
        [FakeFloor("eg", "Erdgeschoss", level=0)],
        [FakeArea("bad", "Bad", floor_id="eg"), FakeArea("kueche", "Küche")],
    )
    hass.data["spatial_hub_providers"] = {
        "p": {
            "provider_id": "p",
            "name": "P",
            "data": lambda: {
                "nodes": [{"id": "toaster", "label": "Toaster", "area_id": "kueche"}]
            },
        }
    }

    model = await SpatialHub(hass, LayoutStore(hass)).async_model()

    assert model["nodes"][0]["floor_id"] == UNASSIGNED_FLOOR_ID


@pytest.mark.asyncio
async def test_the_unassigned_storey_says_that_it_is_one(hass):
    """A renderer must be able to explain the tab rather than invent a room."""
    _house(
        hass,
        [FakeFloor("eg", "Erdgeschoss", level=0)],
        [FakeArea("kueche", "Küche")],
    )

    model = await SpatialHub(hass, LayoutStore(hass)).async_model()

    assert model["floors"][-1]["unassigned"] is True
    assert all(
        not floor.get("unassigned") for floor in model["floors"][:-1]
    ), "a real storey was marked as the unassigned one"


# ── Placement that stays clickable ────────────────────────


@pytest.mark.asyncio
async def test_many_area_less_nodes_do_not_land_on_one_another(hass):
    """The blob. Found by switching the built-in layers on and looking.

    Nineteen entities with no area all took the centre of the plan on a
    0.035 circle: one dot, nineteen labels, nothing clickable.
    """
    _house(hass, [], [])
    hass.data["spatial_hub_providers"] = {
        "p": {"provider_id": "p", "name": "P",
              "data": lambda: [f"light.lamp_{i}" for i in range(19)]}
    }

    model = await SpatialHub(hass, LayoutStore(hass)).async_model()
    spots = [(n["position"]["x"], n["position"]["y"]) for n in model["nodes"]]

    assert len(set(spots)) == 19, "two nodes share a spot"
    closest = min(
        abs(a[0] - b[0]) + abs(a[1] - b[1])
        for i, a in enumerate(spots) for b in spots[i + 1:]
    )
    assert closest > 0.05, f"nodes {closest:.3f} apart are one dot on screen"


@pytest.mark.asyncio
async def test_a_lone_node_still_sits_in_the_middle_of_its_room(hass):
    """The grid must not push the simple case off-centre."""
    _house(hass, [FakeFloor("eg", "EG")], [FakeArea("bad", "Bad", floor_id="eg")])
    hass.data["spatial_hub_providers"] = {
        "p": {"provider_id": "p", "name": "P",
              "data": lambda: [{"id": "one", "label": "One", "area_id": "bad"}]}
    }

    model = await SpatialHub(hass, LayoutStore(hass)).async_model()

    assert model["nodes"][0]["position"]["x"] == 0.5
    assert model["nodes"][0]["position"]["y"] == 0.5


@pytest.mark.asyncio
async def test_nodes_in_a_room_stay_inside_it(hass):
    """A spread that leaks into the neighbouring room is worse than none."""
    _house(hass, [FakeFloor("eg", "EG")],
           [FakeArea("a", "A", floor_id="eg"), FakeArea("b", "B", floor_id="eg")])
    hass.data["spatial_hub_providers"] = {
        "p": {"provider_id": "p", "name": "P",
              "data": lambda: [
                  {"id": f"n{i}", "label": f"N{i}", "area_id": "a"}
                  for i in range(9)
              ]}
    }

    model = await SpatialHub(hass, LayoutStore(hass)).async_model()
    area = next(a for a in model["areas"] if a["id"] == "a")
    half_w = area["size"]["width"] / 2
    half_h = area["size"]["height"] / 2

    for node in model["nodes"]:
        assert abs(node["position"]["x"] - area["position"]["x"]) <= half_w
        assert abs(node["position"]["y"] - area["position"]["y"]) <= half_h


# ── The garden is not a storey ─────────────────────────────────────────


@pytest.mark.asyncio
async def test_an_outdoor_area_with_no_storey_joins_the_ground_floor(hass, hub):
    """A garden surrounds the ground floor rather than becoming a storey."""
    from homeassistant.helpers import area_registry as ar

    ar.async_get(hass).areas.append(FakeArea("garten", "Garten", floor_id=None))
    model = await hub.async_model()

    garden = next(area for area in model["areas"] if area["id"] == "garten")
    assert garden["kind"] == "outdoor"
    assert garden["floor_id"] == "eg", "the ground floor, not a storey of its own"
    assert garden["outdoor"] is True

    ground = next(floor for floor in model["floors"] if floor["id"] == "eg")
    assert ground["has_outdoor"] is True
    assert ground["outdoor_margin"] > 0
    assert ground["ground"] is True


@pytest.mark.asyncio
async def test_a_balcony_stays_on_the_storey_it_is_on(hass, hub):
    """A balcony on the first floor is on the first floor.

    Every outdoor area used to be dragged down to the ground floor, which
    is right for a garden and says the opposite of the truth for a
    balcony -- and a house with one balcony per storey ended up with all
    of them stacked in the front garden.
    """
    from homeassistant.helpers import area_registry as ar

    ar.async_get(hass).areas.append(FakeArea("balkon", "Balkon", floor_id="og"))
    model = await hub.async_model()

    balcony = next(area for area in model["areas"] if area["id"] == "balkon")
    assert balcony["kind"] == "outdoor"
    assert balcony["floor_id"] == "og", "dragged down into the garden"
    assert balcony["outdoor"] is True

    # The apron belongs to whichever storey carries something outdoors.
    upstairs = next(floor for floor in model["floors"] if floor["id"] == "og")
    assert upstairs["has_outdoor"] is True
    assert upstairs["outdoor_margin"] > 0
    # But the ground itself stays the ground floor -- the stacked house
    # view uses this to decide which storey gets the grass, and it is not
    # "whichever storey happens to have a balcony".
    assert not upstairs.get("ground"), "the first floor is not the ground"

    # And it is drawn outside the walls, like any other outdoor area.
    x, y = balcony["position"]["x"], balcony["position"]["y"]
    assert not (0 <= x <= 1 and 0 <= y <= 1), "a balcony is not a room"


@pytest.mark.asyncio
async def test_a_balcony_hangs_on_a_wall_instead_of_wrapping_the_flat(hass, hub):
    """Upstairs is not the garden, and the layout has to say so.

    Both got the same ring around the storey, which is right for a garden
    and absurd one floor up: the balcony came out wider than the house and
    stuck out past both flanks. It was drawn correctly -- as an apron --
    and an apron was the wrong thing to be.
    """
    from homeassistant.helpers import area_registry as ar

    ar.async_get(hass).areas.append(FakeArea("balkon", "Balkon", floor_id="og"))
    ar.async_get(hass).areas.append(FakeArea("garten", "Garten", floor_id="eg"))
    model = await hub.async_model()

    balcony = next(area for area in model["areas"] if area["id"] == "balkon")
    garden = next(area for area in model["areas"] if area["id"] == "garten")

    assert balcony["size"]["width"] <= 1, "wider than the house it hangs on"
    left = balcony["position"]["x"] - balcony["size"]["width"] / 2
    right = balcony["position"]["x"] + balcony["size"]["width"] / 2
    assert 0 <= left and right <= 1, "a balcony does not reach past the flanks"
    # But it still hangs outside: attached to the wall, not a room.
    assert not 0 <= balcony["position"]["y"] <= 1

    # Der Garten bleibt ein Ring -- er ist ja um das Haus herum.
    assert garden["size"]["width"] > 1, "the garden stopped wrapping the house"


def _boxes(model, floor_id):
    """Die Raeume einer Etage als Rechtecke, aus Mitte und Groesse."""
    return [
        (
            area["name"],
            area["position"]["x"] - area["size"]["width"] / 2,
            area["position"]["x"] + area["size"]["width"] / 2,
            area["position"]["y"] - area["size"]["height"] / 2,
            area["position"]["y"] + area["size"]["height"] / 2,
        )
        for area in model["areas"]
        if area.get("floor_id") == floor_id and not area.get("outdoor")
        and area.get("kind") == "indoor"
    ]


@pytest.mark.asyncio
async def test_the_rooms_fill_the_storey_wall_to_wall(hass, hub):
    """Kein Streifen vorn, keine Fuge zwischen den Spalten.

    Der Rand war ein Zwanzigstel je Zelle und stand ueber die ganze
    Hausbreite vorn frei -- zusammen mit der vorderen Aussenwand las sich
    das als Sockel, auf dem die Etage steht.
    """
    from homeassistant.helpers import area_registry as ar

    for name in ("Diele", "Esszimmer", "Gäste-WC"):
        ar.async_get(hass).areas.append(
            FakeArea(name.lower().replace("ä", "ae").replace("-", "_"),
                     name, floor_id="eg")
        )
    model = await hub.async_model()

    boxes = _boxes(model, "eg")
    assert len(boxes) == 5
    assert min(box[1] for box in boxes) == pytest.approx(0.0), "links bleibt Luft"
    assert max(box[2] for box in boxes) == pytest.approx(1.0), "rechts bleibt Luft"
    assert min(box[3] for box in boxes) == pytest.approx(0.0), "vorn bleibt ein Streifen"
    assert max(box[4] for box in boxes) == pytest.approx(1.0), "hinten bleibt ein Streifen"


@pytest.mark.asyncio
async def test_the_last_row_leaves_no_hole_in_the_floor_plan(hass, hub):
    """Fuenf Raeume ergeben drei Spalten und zwei Reihen -- die sechste
    Zelle blieb leer. Ein Grundriss hat dort kein Loch: die Raeume der
    letzten Reihe teilen die Breite unter sich auf."""
    from homeassistant.helpers import area_registry as ar

    for name in ("Diele", "Esszimmer", "Gäste-WC"):
        ar.async_get(hass).areas.append(
            FakeArea(name.lower().replace("ä", "ae").replace("-", "_"),
                     name, floor_id="eg")
        )
    model = await hub.async_model()

    boxes = _boxes(model, "eg")
    covered = sum((box[2] - box[1]) * (box[4] - box[3]) for box in boxes)
    assert covered == pytest.approx(1.0), f"nur {covered:.0%} der Etage ist Raum"

    # Und die Flaeche stimmt nicht, weil zwei Raeume uebereinander liegen.
    for index, one in enumerate(boxes):
        for other in boxes[index + 1:]:
            overlap = (
                min(one[2], other[2]) - max(one[1], other[1]) > 1e-9
                and min(one[4], other[4]) - max(one[3], other[3]) > 1e-9
            )
            assert not overlap, f"{one[0]} liegt auf {other[0]}"


@pytest.mark.asyncio
async def test_an_outdoor_area_is_arranged_outside_the_house(hass, hub):
    from homeassistant.helpers import area_registry as ar

    ar.async_get(hass).areas.append(FakeArea("terrasse", "Terrasse", floor_id="eg"))
    model = await hub.async_model()

    terrace = next(area for area in model["areas"] if area["id"] == "terrasse")
    x, y = terrace["position"]["x"], terrace["position"]["y"]
    assert not (0 <= x <= 1 and 0 <= y <= 1), "the apron is outside 0..1"


@pytest.mark.asyncio
async def test_several_outdoor_areas_all_fit_around_one_floor(hass, hub):
    from homeassistant.helpers import area_registry as ar

    for name in ("Vorgarten", "Hintergarten", "Einfahrt", "Carport", "Pool"):
        ar.async_get(hass).areas.append(
            FakeArea(name.lower(), name, floor_id="eg")
        )
    model = await hub.async_model()

    outdoor = [area for area in model["areas"] if area.get("outdoor")]
    assert len(outdoor) == 5
    assert all(area["floor_id"] == "eg" for area in outdoor)
    # No two of them landed in the same spot -- five gardens, one ring.
    spots = {(area["position"]["x"], area["position"]["y"]) for area in outdoor}
    assert len(spots) == 5
    assert [floor["id"] for floor in model["floors"]] == ["eg", "og"]


@pytest.mark.asyncio
async def test_a_storey_that_held_only_the_garden_goes_with_it(hass, hub):
    from homeassistant.helpers import area_registry as ar, floor_registry as fr

    fr.async_get(hass).floors.append(FakeFloor("aussen", "Außen", level=-2))
    ar.async_get(hass).areas.append(FakeArea("garten", "Garten", floor_id="aussen"))
    model = await hub.async_model()

    assert [floor["id"] for floor in model["floors"]] == ["eg", "og"]


@pytest.mark.asyncio
async def test_the_user_overrules_the_guess(hass, hub):
    """"Gartenzimmer" is a room. The guess is cheap to be wrong about."""
    from homeassistant.helpers import area_registry as ar

    ar.async_get(hass).areas.append(
        FakeArea("gartenzimmer", "Gartenzimmer", floor_id="og")
    )
    hub.store.update("areas", "gartenzimmer", {"kind": "indoor"})
    model = await hub.async_model()

    room = next(area for area in model["areas"] if area["id"] == "gartenzimmer")
    assert room["kind"] == "indoor"
    assert room["floor_id"] == "og", "it stayed where the user put it"
    assert 0 <= room["position"]["x"] <= 1


@pytest.mark.asyncio
async def test_a_virtual_area_lands_in_the_soil_around_the_lowest_storey(hass, hub):
    """Kein Stockwerk ueber dem Dach mehr, sondern das Erdreich daneben."""
    from homeassistant.helpers import area_registry as ar

    ar.async_get(hass).areas.append(FakeArea("cloud", "Cloud", floor_id="eg"))
    hub.store.update("areas", "cloud", {"kind": "virtual"})
    model = await hub.async_model()

    cloud = next(area for area in model["areas"] if area["id"] == "cloud")
    assert cloud["virtual"] is True
    assert cloud["floor_id"] == "eg", "die unterste echte Etage"
    assert not any(floor.get("virtual") for floor in model["floors"]), (
        "keine erfundene Etage mehr -- genau die kostete die Bildhoehe"
    )
    # Im Ring, nicht im Haus: das ist der Unterschied zwischen "neben dem
    # Haus im Boden" und "ein Raum im Erdgeschoss".
    assert not 0 <= cloud["position"]["y"] <= 1

    ground = next(floor for floor in model["floors"] if floor["id"] == "eg")
    assert ground["has_soil"] is True
    assert ground["has_outdoor"] is True, "ohne Umland kein Erdreich"


@pytest.mark.asyncio
async def test_the_soil_goes_around_the_cellar_when_there_is_one(hass, hub):
    """Ein Keller liegt im Boden. Dann liegt das Erdreich um ihn."""
    from homeassistant.helpers import area_registry as ar
    from homeassistant.helpers import floor_registry as fr

    fr.async_get(hass).floors.append(FakeFloor("keller", "Keller", level=-1))
    ar.async_get(hass).areas.append(
        FakeArea("technik", "Technik", floor_id="keller")
    )
    ar.async_get(hass).areas.append(FakeArea("cloud", "Cloud", floor_id="eg"))
    hub.store.update("areas", "cloud", {"kind": "virtual"})
    model = await hub.async_model()

    cloud = next(area for area in model["areas"] if area["id"] == "cloud")
    assert cloud["floor_id"] == "keller"
    assert next(
        floor for floor in model["floors"] if floor["id"] == "keller"
    )["has_soil"] is True
    # Und das Erdgeschoss bleibt, was es ist -- der Garten liegt weiter dort.
    assert not next(
        floor for floor in model["floors"] if floor["id"] == "eg"
    ).get("has_soil")


@pytest.mark.asyncio
async def test_garden_and_soil_do_not_take_the_same_slot(hass, hub):
    """Ein Ring hat seine Plaetze einmal. Zwei Rechnungen darueber
    setzten Garten und Erdreich uebereinander."""
    from homeassistant.helpers import area_registry as ar

    ar.async_get(hass).areas.append(FakeArea("garten", "Garten", floor_id="eg"))
    ar.async_get(hass).areas.append(FakeArea("cloud", "Cloud", floor_id="eg"))
    hub.store.update("areas", "cloud", {"kind": "virtual"})
    model = await hub.async_model()

    spots = {
        area["id"]: (area["position"]["x"], area["position"]["y"])
        for area in model["areas"]
        if area["id"] in ("garten", "cloud")
    }
    assert spots["garten"] != spots["cloud"]


# ── Sandwich settings ─────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_an_area_can_be_kept_out_of_the_sandwich(hass, hub):
    hub.store.update("areas", "kueche", {"in_sandwich": False})
    model = await hub.async_model()

    kitchen = next(area for area in model["areas"] if area["id"] == "kueche")
    assert kitchen["in_sandwich"] is False
    assert kitchen["position"], "still drawn on its own floor"


@pytest.mark.asyncio
async def test_only_in_the_single_view_means_out_of_the_sandwich(hass, hub):
    hub.store.update("areas", "kueche", {"single_only": True})
    model = await hub.async_model()

    kitchen = next(area for area in model["areas"] if area["id"] == "kueche")
    assert kitchen["single_only"] is True
    assert kitchen["in_sandwich"] is False, "saying one implies the other"


@pytest.mark.asyncio
async def test_areas_are_in_the_sandwich_unless_told_otherwise(hass, hub):
    model = await hub.async_model()
    assert all(area["in_sandwich"] for area in model["areas"])


# ── Icons and the way back into Home Assistant ────────────────────────


@pytest.mark.asyncio
async def test_a_node_without_an_icon_gets_one_that_says_what_it_is(hass, hub):
    hass.states.set("light.kitchen", "on", friendly_name="Kitchen")
    _register(hass, data=lambda: ["light.kitchen"])
    model = await hub.async_model()

    assert model["nodes"][0]["icon"] == "mdi:lightbulb"


@pytest.mark.asyncio
async def test_the_provider_keeps_the_icon_it_chose(hass, hub):
    hass.states.set("light.kitchen", "on", friendly_name="Kitchen")
    _register(
        hass,
        data=lambda: [{"id": "k", "entity_id": "light.kitchen",
                       "icon": "mdi:ceiling-light"}],
    )
    model = await hub.async_model()

    assert model["nodes"][0]["icon"] == "mdi:ceiling-light"


# ── Storeys nobody numbered ────────────────────────────────────────────


@pytest.mark.parametrize(
    ("name", "expected"),
    [
        ("Dach", 90),
        ("Dachboden", 90),
        ("Dachgeschoss", 90),
        ("Spitzboden", 90),
        ("Attic", 90),
        ("Keller", -1),
        ("Basement", -1),
        ("Tiefgarage", -2),
        ("Erdgeschoss", 0),
        ("EG", 0),
        ("Ground Floor", 0),
        ("1. OG", 1),
        ("2. OG", 2),
        ("3rd Floor", 3),
        ("Etage 4", 4),
        ("Wohnbereich", None),
    ],
)
def test_a_floor_nobody_numbered_is_read_from_its_name(name, expected):
    """Home Assistant's level field is optional, and most people skip it."""
    from custom_components.spatial_hub.discovery import floor_level

    assert floor_level(name) == expected


def test_a_stated_level_always_wins():
    """Including zero: the user filled the field in, and that settles it."""
    from custom_components.spatial_hub.discovery import floor_level

    assert floor_level("Dach", 0) == 0, "a stated ground floor called Dach"
    assert floor_level("Keller", 7) == 7
    assert floor_level("Wohnbereich", -3) == -3


@pytest.mark.asyncio
async def test_the_roof_does_not_end_up_on_the_ground(hass):
    """Found by looking at the sandwich: the attic was lying in the garden.

    Every floor without a level counted as level 0, so an attic sorted
    against the ground floor by name -- and "Dach" comes before
    "Erdgeschoss". The house came out with its roof underneath it.
    """
    _house(
        hass,
        [
            FakeFloor("dach", "Dach", level=None),
            FakeFloor("eg", "Erdgeschoss", level=None),
            FakeFloor("keller", "Keller", level=None),
        ],
        [
            FakeArea("boden", "Speicher", floor_id="dach"),
            FakeArea("wohnen", "Wohnzimmer", floor_id="eg"),
            FakeArea("heizung", "Heizung", floor_id="keller"),
        ],
    )

    model = await SpatialHub(hass, LayoutStore(hass)).async_model()

    assert [floor["id"] for floor in model["floors"]] == ["keller", "eg", "dach"], (
        "bottom-up: the cellar is under the house and the roof is on top"
    )


# ── The building line ──────────────────────────────────────────────────


def test_the_box_around_nothing_is_nothing():
    """A storey with no rooms has no building line to draw."""
    from custom_components.spatial_hub.hub import _bounding_box

    assert _bounding_box([]) is None


def test_the_box_reaches_the_far_edge_of_every_room():
    """Positions are centres, so each room reaches half its size outwards."""
    from custom_components.spatial_hub.hub import _bounding_box

    box = _bounding_box([
        {"position": {"x": 0.25, "y": 0.25}, "size": {"width": 0.1, "height": 0.1}},
        {"position": {"x": 0.75, "y": 0.5}, "size": {"width": 0.2, "height": 0.4}},
    ])

    assert box == pytest.approx(
        {"x": 0.2, "y": 0.2, "width": 0.65, "height": 0.5}, rel=1e-6
    )


def test_a_room_with_no_size_still_counts_as_a_point():
    from custom_components.spatial_hub.hub import _bounding_box

    box = _bounding_box([{"position": {"x": 0.5, "y": 0.5}}])

    assert box == {"x": 0.5, "y": 0.5, "width": 0.0, "height": 0.0}


@pytest.mark.asyncio
async def test_every_floor_reports_its_outer_walls(hass):
    _house(
        hass,
        [FakeFloor("eg", "Erdgeschoss", level=0),
         FakeFloor("og", "Obergeschoss", level=1)],
        [FakeArea("wohnen", "Wohnzimmer", floor_id="eg"),
         FakeArea("bad", "Bad", floor_id="og")],
    )

    model = await SpatialHub(hass, LayoutStore(hass)).async_model()
    outlines = {floor["id"]: floor["outline"] for floor in model["floors"]}

    assert outlines["eg"] and outlines["og"], (
        "without a building line there is nothing to line the storeys up against"
    )
    for outline in outlines.values():
        assert set(outline) == {"x", "y", "width", "height"}


@pytest.mark.asyncio
async def test_the_garden_does_not_decide_where_the_wall_runs(hass):
    """The terrace is not the building, and pretending it is hides the drift."""
    _house(
        hass,
        [FakeFloor("eg", "Erdgeschoss", level=0)],
        [FakeArea("wohnen", "Wohnzimmer", floor_id="eg"),
         FakeArea("terrasse", "Terrasse", floor_id="eg")],
    )

    model = await SpatialHub(hass, LayoutStore(hass)).async_model()
    floor = next(f for f in model["floors"] if f["id"] == "eg")
    garden = next(a for a in model["areas"] if a["id"] == "terrasse")

    assert garden["kind"] == "outdoor", "the fixture only works if this is outdoors"
    # The apron reaches outside 0..1; the building line must not follow it.
    assert floor["outline"]["x"] >= 0
    assert floor["outline"]["x"] + floor["outline"]["width"] <= 1


@pytest.mark.asyncio
async def test_a_floor_with_only_a_garden_has_no_building_line(hass):
    _house(
        hass,
        [FakeFloor("eg", "Erdgeschoss", level=0)],
        [FakeArea("garten", "Garten", floor_id="eg")],
    )

    model = await SpatialHub(hass, LayoutStore(hass)).async_model()
    floor = next(f for f in model["floors"] if f["id"] == "eg")

    assert floor["outline"] is None, "no building, no building line"


@pytest.mark.asyncio
async def test_a_stated_building_line_beats_the_guess(hass):
    """A user whose terrace is under the roof gets to say so."""
    _house(
        hass,
        [FakeFloor("eg", "Erdgeschoss", level=0)],
        [FakeArea("wohnen", "Wohnzimmer", floor_id="eg")],
    )
    hub = SpatialHub(hass, LayoutStore(hass))
    stated = {"x": 0.1, "y": 0.2, "width": 0.7, "height": 0.6}
    hub.store.update("floors", "eg", {"outline": stated})

    model = await hub.async_model()
    floor = next(f for f in model["floors"] if f["id"] == "eg")

    assert floor["outline"] == stated


# ── A "floor" that is not a storey ────────────────────────────────────


@pytest.mark.asyncio
async def test_a_floor_called_outside_dissolves_completely(hass):
    """Home Assistant has floors and nothing else, so that is where the
    garden ends up. Asking each area on its own got "Vorgarten" right and
    "Autos" wrong, and left the garden standing as half a storey."""
    _house(
        hass,
        [FakeFloor("eg", "Erdgeschoss", level=0),
         FakeFloor("draussen", "Draußen")],
        [FakeArea("wohnen", "Wohnzimmer", floor_id="eg"),
         FakeArea("vorgarten", "Vorgarten", floor_id="draussen"),
         FakeArea("autos", "Autos", floor_id="draussen")],
    )

    model = await SpatialHub(hass, LayoutStore(hass)).async_model()
    kinds = {area["id"]: area["kind"] for area in model["areas"]}

    assert kinds["autos"] == "outdoor", "the floor decides, not the area's name"
    assert kinds["vorgarten"] == "outdoor"
    assert "draussen" not in {floor["id"] for floor in model["floors"]}, (
        "a storey that was only ever the garden must not survive it"
    )
    ground = next(f for f in model["floors"] if f["id"] == "eg")
    assert ground["has_outdoor"], "the garden is the ring around the house"


@pytest.mark.asyncio
async def test_a_floor_named_after_the_network_becomes_a_cloud(hass):
    _house(
        hass,
        [FakeFloor("eg", "Erdgeschoss", level=0),
         FakeFloor("net", "Server-Network")],
        [FakeArea("wohnen", "Wohnzimmer", floor_id="eg"),
         FakeArea("vps", "vps", floor_id="net"),
         FakeArea("lan", "LAN", floor_id="net")],
    )

    model = await SpatialHub(hass, LayoutStore(hass)).async_model()
    kinds = {area["id"]: area["kind"] for area in model["areas"]}

    assert kinds["vps"] == "virtual" and kinds["lan"] == "virtual"
    assert "net" not in {floor["id"] for floor in model["floors"]}
    # Each stays its own area -- one cloud per thing, not one box holding
    # every server the house has.
    assert len([a for a in model["areas"] if a["kind"] == "virtual"]) == 2


@pytest.mark.asyncio
async def test_an_ordinary_storey_is_left_alone(hass):
    _house(
        hass,
        [FakeFloor("eg", "Erdgeschoss", level=0)],
        [FakeArea("wohnen", "Wohnzimmer", floor_id="eg")],
    )

    model = await SpatialHub(hass, LayoutStore(hass)).async_model()

    assert next(a for a in model["areas"] if a["id"] == "wohnen")["kind"] == "indoor"
    assert "eg" in {floor["id"] for floor in model["floors"]}


@pytest.mark.asyncio
async def test_the_user_can_say_a_floor_is_an_ordinary_storey_after_all(hass):
    """A real cellar called "Netz" exists somewhere. The guess is a guess."""
    store = LayoutStore(hass)
    store.update("floors", "net", {"kind": "indoor"})
    _house(
        hass,
        [FakeFloor("eg", "Erdgeschoss", level=0), FakeFloor("net", "Netz")],
        [FakeArea("wohnen", "Wohnzimmer", floor_id="eg"),
         FakeArea("rack", "Rack", floor_id="net")],
    )

    model = await SpatialHub(hass, store).async_model()

    assert next(a for a in model["areas"] if a["id"] == "rack")["kind"] == "indoor"
    assert "net" in {floor["id"] for floor in model["floors"]}


@pytest.mark.asyncio
async def test_a_stored_area_kind_still_beats_its_floor(hass):
    """The narrower answer wins: one shed on the garden floor is a room."""
    store = LayoutStore(hass)
    store.update("areas", "huette", {"kind": "indoor"})
    _house(
        hass,
        [FakeFloor("eg", "Erdgeschoss", level=0),
         FakeFloor("draussen", "Draußen")],
        [FakeArea("wohnen", "Wohnzimmer", floor_id="eg"),
         FakeArea("huette", "Gartenhütte", floor_id="draussen")],
    )

    model = await SpatialHub(hass, store).async_model()

    assert next(a for a in model["areas"] if a["id"] == "huette")["kind"] == "indoor"


@pytest.mark.asyncio
async def test_a_floors_kind_goes_over_the_wire_as_a_word(hass):
    """JSON has no enums; a websocket that cannot serialise the model is a
    blank panel with a traceback nobody sees."""
    import json

    _house(
        hass,
        [FakeFloor("eg", "Erdgeschoss", level=0), FakeFloor("net", "Cloud")],
        [FakeArea("wohnen", "Wohnzimmer", floor_id="eg"),
         FakeArea("vps", "vps", floor_id="net")],
    )

    model = await SpatialHub(hass, LayoutStore(hass)).async_model()

    json.dumps(model["floors"])  # must not raise
    for floor in model["floors"]:
        assert not isinstance(floor.get("kind"), object) or isinstance(
            floor.get("kind"), (str, type(None))
        )


# ── The sky, the plot and rooms that are not rectangles ────────────────


@pytest.mark.asyncio
async def test_a_cloud_is_spread_over_the_house_not_stacked_on_it(hass, hub):
    """A cloud packed into the footprint reads as a room on the top floor."""
    from homeassistant.helpers import area_registry as ar

    for name in ("Cloud", "VPN", "Server", "Internet"):
        area = FakeArea(name.lower(), name, floor_id="eg")
        ar.async_get(hass).areas.append(area)
        hub.store.update("areas", name.lower(), {"kind": "virtual"})
    model = await hub.async_model()

    clouds = [area for area in model["areas"] if area["kind"] == "virtual"]
    assert len(clouds) == 4
    left = min(a["position"]["x"] - a["size"]["width"] / 2 for a in clouds)
    right = max(a["position"]["x"] + a["size"]["width"] / 2 for a in clouds)
    assert left < 0 and right > 1, (
        "the sky reaches past the walls, the same way the garden does"
    )


@pytest.mark.asyncio
async def test_a_rooms_own_outline_is_carried_but_never_read(hass, hub):
    """The hub stores and serves a shape. What it means is the renderer's."""
    outline = [{"x": 0, "y": 0}, {"x": 1, "y": 0}, {"x": 1, "y": 0.5},
               {"x": 0.5, "y": 0.5}, {"x": 0.5, "y": 1}, {"x": 0, "y": 1}]
    hub.store.update("areas", "wohnzimmer", {"shape": outline})
    model = await hub.async_model()

    room = next(area for area in model["areas"] if area["id"] == "wohnzimmer")
    assert room["shape"] == outline


@pytest.mark.asyncio
async def test_a_room_says_nothing_about_its_outline_by_default(hass, hub):
    """No shape is not a four-corner rectangle; it is no shape at all."""
    model = await hub.async_model()
    room = next(area for area in model["areas"] if area["id"] == "wohnzimmer")

    assert "shape" not in room


@pytest.mark.asyncio
async def test_the_plot_is_the_users_and_nothing_derives_one(hass, hub):
    """Home Assistant knows rooms; nothing in it says where the land ends."""
    model = await hub.async_model()
    ground = next(floor for floor in model["floors"] if floor["id"] == "eg")
    assert "plot" not in ground

    boundary = [{"x": -0.3, "y": -0.3}, {"x": 1.3, "y": -0.3},
                {"x": 1.3, "y": 1.3}, {"x": -0.3, "y": 1.3}]
    hub.store.update("floors", "eg", {"plot": boundary})
    model = await hub.async_model()

    ground = next(floor for floor in model["floors"] if floor["id"] == "eg")
    assert ground["plot"] == boundary


@pytest.mark.asyncio
async def test_doors_are_carried_but_never_read(hass, hub):
    """The hub stores and serves doors. What they mean is the renderer's --
    the same role it already has for a room's own outline."""
    doors = [{"side": 1, "at": 0.4, "width": 0.25}]
    hub.store.update("areas", "wohnzimmer", {"doors": doors})
    model = await hub.async_model()

    room = next(area for area in model["areas"] if area["id"] == "wohnzimmer")
    assert room["doors"] == doors


@pytest.mark.asyncio
async def test_a_room_says_nothing_about_doors_by_default(hass, hub):
    """No doors is not "a room with no way in"; it is nothing said yet."""
    model = await hub.async_model()
    room = next(area for area in model["areas"] if area["id"] == "wohnzimmer")

    assert "doors" not in room


@pytest.mark.asyncio
async def test_a_custom_shape_has_no_area_behind_it_at_all(hass, hub):
    """A hallway drawn for its own sake, with no Home Assistant area."""
    model = await hub.async_model()
    assert model["shapes"] == []

    boundary = [{"x": 0.1, "y": 0.1}, {"x": 0.4, "y": 0.1}, {"x": 0.4, "y": 0.9}]
    hub.store.update("settings", "view", {
        "custom_shapes": [
            {"id": "flur-1", "floor_id": "eg", "name": "Flur",
             "color": "#8899aa", "points": boundary},
        ],
    })
    model = await hub.async_model()
    assert model["shapes"] == [
        {"id": "flur-1", "floor_id": "eg", "name": "Flur",
         "color": "#8899aa", "points": boundary},
    ]


@pytest.mark.asyncio
async def test_a_malformed_custom_shape_is_dropped_not_guessed_at(hass, hub):
    """Nothing in Home Assistant can validate these on the way in."""
    hub.store.update("settings", "view", {
        "custom_shapes": [
            "not even a dict",
            {"id": "", "floor_id": "eg", "points": [
                {"x": 0, "y": 0}, {"x": 1, "y": 0}, {"x": 1, "y": 1},
            ]},
            {"id": "too-few", "floor_id": "eg", "points": [
                {"x": 0, "y": 0}, {"x": 1, "y": 1},
            ]},
            {"id": "bad-point", "floor_id": "eg", "points": [
                {"x": "nope", "y": 0}, {"x": 1, "y": 0}, {"x": 1, "y": 1},
            ]},
            {"id": "ok", "floor_id": "eg", "points": [
                {"x": 0, "y": 0}, {"x": 1, "y": 0}, {"x": 1, "y": 1},
            ]},
        ],
    })
    model = await hub.async_model()
    assert [shape["id"] for shape in model["shapes"]] == ["ok"]
