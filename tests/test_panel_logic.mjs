/**
 * The renderer's decisions, without a browser.
 *
 * Everything here is about *what* gets drawn -- which nodes belong to the
 * floor you are looking at, which layer switches off which provider, where
 * an edge ends up. The pixels are CSS's problem; these are the parts that
 * can be wrong in a way nobody notices.
 *
 * Run: node --test tests/test_panel_logic.mjs
 */

import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, readdirSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** Alles, was der Renderer ist, als ein Text.
 *
 *  Ein gutes Dutzend Tests sucht eine Regel oder eine Formel im Quelltext,
 *  statt sie nachzurechnen -- bei CSS geht es nicht anders. Sie haben
 *  vorher die eine Panel-Datei gelesen, und genau das ist beim Zerlegen
 *  kaputtgegangen: Die Regeln waren noch da, nur eine Datei weiter.
 *
 *  Deshalb der ganze Ordner. Ein Test soll pruefen, *dass* der Renderer
 *  etwas tut, nicht, in welcher Datei es steht -- sonst kostet jedes
 *  Verschieben eine Runde roter Tests, die nichts gefunden haben.
 *
 *  Gelesen wird das Verzeichnis und keine eingetragene Liste. Genau die
 *  stand hier vorher, samt dieser Erklaerung darueber -- und ist beim
 *  naechsten Aufteilen prompt wieder zurueckgeblieben: `_stackIconHtml`
 *  zog nach panel-view.js um, die Liste kannte die Datei nicht, und ein
 *  Test suchte eine Regel in einem Text, in dem sie nicht mehr stand.
 *  Eine Erklaerung, die neben einer Liste steht, haelt die Liste nicht
 *  aktuell.
 */
const rendererSource = () => {
  const ordner = join(here, "..", "custom_components", "spatial_hub", "www");
  return readdirSync(ordner)
    .filter((datei) => datei.endsWith(".js"))
    .sort()
    .map((datei) => readFileSync(join(ordner, datei), "utf8"))
    .join("\n");
};

// The module defines a custom element at import time; give it the two
// browser globals it touches and nothing more.
globalThis.HTMLElement = class {
  attachShadow() {
    return { append() {}, childElementCount: 0 };
  }
  addEventListener() {}
};
globalThis.customElements = { define() {} };
globalThis.window = { addEventListener() {}, removeEventListener() {},
                      confirm: () => true, prompt: () => "Fläche" };

const here = dirname(fileURLToPath(import.meta.url));
const { SpatialHubPanel, HA_COLOURS, joinsOf, drawsTheWall } = await import(
  pathToFileURL(
    join(here, "..", "custom_components", "spatial_hub", "www",
         "spatial-hub-panel.js"),
  ).href
);

/** Die reinen Bausteine direkt, ohne Panel drumherum. Genau dafuer sind
 *  sie ausgelagert: eine Kurve zu pruefen soll kein Custom Element
 *  brauchen. */
const { sparklineHtml, doorsHtml, cornerHandlesHtml } = await import(
  pathToFileURL(
    join(here, "..", "custom_components", "spatial_hub", "www",
         "panel-markup.js"),
  ).href
);

/** Die Masse des Raumnamens -- damit die Tests nicht ihre eigene 16
 *  mitbringen und still auseinanderlaufen, wenn sie sich aendert. */
const { ROOM_LABEL } = await import(
  pathToFileURL(
    join(here, "..", "custom_components", "spatial_hub", "www",
         "panel-geometry.js"),
  ).href
);

const at = (x, y) => ({ x, y, z: 0 });

const node = (id, extra = {}) => ({
  id,
  label: id,
  area_id: null,
  floor_id: "eg",
  position: at(0.5, 0.5),
  state: "online",
  icon: "",
  color: "",
  entity_id: null,
  actions: [],
  metadata: {},
  ...extra,
});

const edge = (source, target, extra = {}) => ({
  id: `${source}__${target}`,
  source,
  target,
  label: "",
  value: null,
  quality: "good",
  color: "",
  width: 2,
  directed: false,
  dashed: false,
  animated: false,
  actions: [],
  metadata: {},
  ...extra,
});

const theme = (overrides = {}) => ({
  preset: "auto",
  accent: "",
  surface: "",
  ink: "",
  state_colors: { online: "", offline: "", unknown: "" },
  quality_colors: { good: "", fair: "", poor: "", unknown: "" },
  node_shape: "circle",
  node_size: 1,
  labels: "always",
  edge_style: "straight",
  room_style: "outline",
  ...overrides,
});

const model = (overrides = {}) => ({
  api_version: 1,
  hidden: { nodes: [], areas: [] },
  theme: theme(),
  custom_layers: [],
  floors: [
    { id: "eg", name: "Erdgeschoss", level: 0, icon: "" },
    { id: "og", name: "Obergeschoss", level: 1, icon: "" },
  ],
  areas: [
    { id: "wohnzimmer", name: "Wohnzimmer", floor_id: "eg",
      position: at(0.25, 0.5), size: { width: 0.4, height: 0.4 }, auto: true },
  ],
  layers: [
    { id: "a_layer", name: "A", z_index: 10, opacity: 1, visible: true,
      provider_id: "a" },
  ],
  nodes: [node("a:one"), node("a:two", { position: at(0.8, 0.2) })],
  edges: [edge("a:one", "a:two")],
  providers: [
    { id: "a", name: "A", icon: "", version: "1.0",
      capabilities: { nodes: true, edges: true, history: true, actions: true } },
  ],
  icon_sets: {},
  ...overrides,
});

/** A panel wired to a model, with no DOM behind it. */
// Most tests here are about one storey at a time. The panel now opens on
// the stacked view of the whole house, so a test that means "the detail
// view" has to say so -- pass floor:null for the stack.
function panel(data = model(), { admin = true, edit = false,
                                 what = "rooms", floor = "eg" } = {}) {
  const instance = new SpatialHubPanel();
  instance._floorId = floor === null ? "__all__" : floor;
  instance._model = data;
  instance._edit = edit;
  // Editing is two modes now. Rooms is the default, so a test that drags a
  // device says so -- the same way a user has to.
  instance._editWhat = what;
  instance._written = [];
  instance._hass = {
    user: { is_admin: admin },
    callWS: async () => ({}),
  };
  instance._setLayout = (section, key, values) => {
    instance._written.push([section, key, values]);
  };
  return instance;
}

/** A pointer event carrying only what the drag code reads. */
const pointer = (x, y, { shift = false, target = null } = {}) => ({
  clientX: x,
  clientY: y,
  shiftKey: shift,
  button: 0,
  preventDefault() {},
  composedPath: () => target || [],
});

/** A stand-in for one positioned element on the stage. */
function element(attributes = {}, offset = {}) {
  return {
    style: {},
    classList: { contains: (name) => name === attributes._class },
    offsetLeft: offset.left || 0,
    offsetTop: offset.top || 0,
    getAttribute: (name) =>
      name in attributes ? attributes[name] : null,
  };
}

const stage = () => {
  const el = element({ _class: "stage" });
  el.getBoundingClientRect = () => ({ left: 0, top: 0, width: 1000, height: 1000 });
  return el;
};

// ── What belongs on screen ─────────────────────────────────

test("only the selected floor is drawn", () => {
  const view = panel(
    model({ nodes: [node("a:down"), node("a:up", { floor_id: "og" })] }),
  );
  assert.deepEqual(view._visibleNodes.map((n) => n.id), ["a:down"]);

  view._floorId = "og";
  assert.deepEqual(view._visibleNodes.map((n) => n.id), ["a:up"]);
});

test("a node with no floor waits in the tray, not somewhere in the rooms", () => {
  // Dropped into the plan it was the worst of both: it looked assigned,
  // and it sat on top of a grid that was measured without it.
  const view = panel(model({ nodes: [node("a:homeless", { floor_id: null })] }));
  assert.deepEqual(view._visibleNodes, [], "never drawn among the rooms");
  assert.deepEqual(view._floorlessNodes.map((n) => n.id), ["a:homeless"]);

  view._floorId = "og";
  assert.deepEqual(
    view._floorlessNodes.map((n) => n.id),
    ["a:homeless"],
    "the tray is the same on every storey -- the fix is not per floor",
  );
  assert.match(view._trayHtml(), /a:homeless/);
});

test("the tray disappears once everything has a room", () => {
  const view = panel(model());
  assert.deepEqual(view._floorlessNodes, []);
  assert.equal(view._trayHtml(), "", "an empty strip is furniture, not information");
});

test("hiding a provider empties its share of the tray too", () => {
  const data = model({ nodes: [node("a:homeless", { floor_id: null })] });
  data.layers[0].visible = false;
  assert.deepEqual(panel(data)._floorlessNodes, []);
});

test("hiding a layer hides the provider that produced it", () => {
  const data = model();
  data.layers[0].visible = false;
  const view = panel(data);
  assert.deepEqual(view._visibleNodes, []);
  assert.deepEqual(view._visibleEdges, []);
});

test("a provider is not half-hidden when only one of its layers is off", () => {
  const data = model();
  data.layers.push({ id: "a_second", name: "A2", z_index: 20, opacity: 1,
                     visible: true, provider_id: "a" });
  data.layers[0].visible = false;
  const view = panel(data);
  assert.equal(view._visibleNodes.length, 2, "nodes carry no layer of their own");
});

test("an edge whose node is not on this floor is dropped, not drawn into nowhere", () => {
  const view = panel(
    model({
      nodes: [node("a:one"), node("a:two", { floor_id: "og" })],
      edges: [edge("a:one", "a:two")],
    }),
  );
  assert.deepEqual(view._visibleEdges, []);
});

test("a node without a position is never drawn", () => {
  const view = panel(model({ nodes: [node("a:nowhere", { position: null })] }));
  assert.deepEqual(view._visibleNodes, []);
});

test("areas of other floors stay on their floor", () => {
  const data = model();
  data.areas.push({ id: "bad", name: "Bad", floor_id: "og",
                    position: at(0.5, 0.5), size: { width: 0.3, height: 0.3 } });
  const view = panel(data);
  assert.deepEqual(view._visibleAreas.map((a) => a.id), ["wohnzimmer"]);
});

test("an area belonging to no floor is not smeared across every floor", () => {
  // Caught in a browser, not here: the hub gives such areas a storey of
  // their own, and its grid was measured for that storey alone. Drawn on
  // the real floors as well, it lands on top of their rooms.
  const data = model();
  data.floors.push({ id: "_unassigned", name: "Ohne Etage", level: null,
                     unassigned: true });
  data.areas.push({ id: "keller", name: "Keller", floor_id: "_unassigned",
                    position: at(0.5, 0.5), size: { width: 0.9, height: 0.9 } });
  const view = panel(data);
  assert.deepEqual(view._visibleAreas.map((a) => a.id), ["wohnzimmer"]);
});

test("the unassigned storey shows its own areas", () => {
  const data = model();
  data.floors.push({ id: "_unassigned", name: "Ohne Etage", level: null,
                     unassigned: true });
  data.areas.push({ id: "keller", name: "Keller", floor_id: "_unassigned",
                    position: at(0.5, 0.5), size: { width: 0.9, height: 0.9 } });
  const view = panel(data);
  view._floorId = "_unassigned";
  assert.deepEqual(view._visibleAreas.map((a) => a.id), ["keller"]);
});

// ── Geometry and styling ───────────────────────────────────

test("edges are laid out in the 0..1000 viewBox the svg declares", () => {
  const view = panel();
  const html = view._edgeHtml(view._visibleEdges[0]);
  assert.match(html, /x1="500"/);
  assert.match(html, /y1="500"/);
  assert.match(html, /x2="800"/);
  assert.match(html, /y2="200"/);
});

test("edge colour comes from the shared quality vocabulary", () => {
  const view = panel();
  const qualities = { good: HA_COLOURS.good, fair: HA_COLOURS.fair,
                      poor: HA_COLOURS.poor };
  for (const [quality, colour] of Object.entries(qualities)) {
    const html = view._edgeHtml({ ...view._visibleEdges[0], quality });
    assert.ok(html.includes(colour), `${quality} should render as ${colour}`);
  }
});

test("a provider's own colour beats the quality default", () => {
  const view = panel();
  const html = view._edgeHtml({ ...view._visibleEdges[0], color: "#abcdef" });
  assert.match(html, /stroke="#abcdef"/);
});

test("an unknown state gets the accent colour instead of being forced offline", () => {
  const view = panel();
  const html = view._nodeHtml(node("a:x", { state: "heating" }));
  assert.match(html, /--node-color:var\(--fp-accent/);
  assert.doesNotMatch(html, /error-color/);
});

test("a provider icon set is rendered inline", () => {
  const data = model({
    icon_sets: { a: { spinner: { svg: "<svg id='mine'></svg>",
                                 default_color: "#123456" } } },
    nodes: [node("a:one", { icon: "spinner" })],
  });
  const html = panel(data)._nodeHtml(data.nodes[0]);
  assert.match(html, /<svg id='mine'>/);
  assert.match(html, /--node-color:#123456/);
});

// ── Escaping ───────────────────────────────────────────────

test("provider text cannot inject markup", () => {
  const evil = "<img src=x onerror=alert(1)>";
  const view = panel();
  const html = view._nodeHtml(node("a:one", { label: evil }));
  assert.doesNotMatch(html, /<img/);
  assert.match(html, /&lt;img/);
});

test("metadata keys and values are escaped in the popup", () => {
  const data = model();
  data.nodes[0].metadata = { "<b>k</b>": "<script>x</script>" };
  const view = panel(data);
  view._selected = { kind: "node", id: "a:one" };
  const html = view._popupHtml();
  assert.doesNotMatch(html, /<script>/);
  assert.doesNotMatch(html, /<b>k<\/b>/);
});

// ── Popup contents ─────────────────────────────────────────

test("the popup offers actions only to admins", () => {
  const data = model();
  data.nodes[0].actions = [{ id: "reboot", label: "Neustart", icon: "",
                             confirm: true }];
  const view = panel(data);
  view._selected = { kind: "node", id: "a:one" };

  assert.match(view._popupHtml(), /data-action="reboot"/);

  view._hass = { user: { is_admin: false } };
  const html = view._popupHtml();
  assert.doesNotMatch(html, /data-action="reboot"/);
  assert.match(html, /Administratorrechte/);
});

test("history is offered only where the provider says it has any", () => {
  const data = model();
  const view = panel(data);
  view._selected = { kind: "node", id: "a:one" };
  assert.match(view._popupHtml(), /data-history/);

  data.providers[0].capabilities.history = false;
  assert.doesNotMatch(view._popupHtml(), /data-history/);
});

test("auto_position is housekeeping and stays out of the popup", () => {
  const data = model();
  data.nodes[0].metadata = { auto_position: true, tx_rate: 560 };
  const view = panel(data);
  view._selected = { kind: "node", id: "a:one" };
  const html = view._popupHtml();
  assert.doesNotMatch(html, /auto.position/i);
  assert.match(html, /Tx rate/);
});

test("a selected item that vanished mid-refresh closes quietly", () => {
  const view = panel();
  view._selected = { kind: "node", id: "a:gone" };
  assert.equal(view._popupHtml(), "");
});

test("a flat history draws no misleading curve", () => {
  assert.match(sparklineHtml([{ value: 5 }]), /Zu wenig Verlauf/);
  assert.match(sparklineHtml([{ value: 1 }, { value: 2 }]), /<polyline/);
});

test("a constant series does not divide by zero", () => {
  const html = sparklineHtml([{ value: 7 }, { value: 7 }, { value: 7 }]);
  assert.doesNotMatch(html, /NaN/);
});

// ── The empty house ────────────────────────────────────────

test("the house is drawn before any provider exists", () => {
  const view = panel(model({ providers: [], nodes: [], edges: [] }));
  const html = view._stageHtml();
  assert.match(html, /class="area/, "the areas alone are already your home");
  assert.match(html, /erscheint sie hier von selbst/, "and it says what comes next");
});

test("nothing at all says so instead of showing a blank rectangle", () => {
  const view = panel(model({ providers: [], nodes: [], edges: [], areas: [] }));
  assert.match(view._stageHtml(), /Noch nichts zu zeichnen/);
});

test("unplaced areas get a tray and a way back onto the plan", () => {
  const data = model();
  data.areas[0].position = null;
  data.areas[0].unplaced = true;
  const view = panel(data);
  const html = view._sidebarHtml();
  assert.match(html, /Nicht platziert/);
  assert.match(html, /data-place-area="wohnzimmer"/);
});


// ── Edit mode ──────────────────────────────────────────────

test("arranging is offered to everyone who is logged in, not just admins", () => {
  // Die Spezifikation sagt beim einzigen Befehl, der ausserhalb des Hubs
  // schreibt: "Admin-pflichtig. Anordnen ist es nicht, das hier schon."
  // Der Bleistift war trotzdem `is_admin` -- und `layout/set` im Backend
  // hat gar keine Verwalterpruefung. Front und Back waren verschiedener
  // Meinung, und die strengere Seite hat gewonnen, ohne dass es jemand
  // entschieden hat.
  assert.match(panel()._headerHtml(), /data-toggle-edit/);
  assert.match(panel(model(), { admin: false })._headerHtml(),
               /data-toggle-edit/, "ein Kind kommt gar nicht erst hinein");
});

test("nobody without a user gets the pencil", () => {
  // Angemeldet sein ist die Untergrenze -- sonst schriebe der Plan fuer
  // niemanden.
  const view = panel();
  view._hass = {};
  assert.doesNotMatch(view._headerHtml(), /data-toggle-edit/);
});

test("editing tools appear only in edit mode", () => {
  const view = panel();
  assert.doesNotMatch(view._headerHtml(), /data-floor-dialog/);
  view._edit = true;
  assert.match(view._headerHtml(), /data-floor-dialog/);
  assert.match(view._headerHtml(), /data-reset-floor/);
});

test("areas grow a grip and a hide button only while editing", () => {
  const view = panel();
  assert.doesNotMatch(view._areasHtml(), /data-resize-area/);
  view._edit = true;
  const html = view._areasHtml();
  assert.match(html, /data-resize-area="wohnzimmer"/);
  assert.match(html, /data-hide-area="wohnzimmer"/);
});

test("dragging a node writes its position once, on release", () => {
  const view = panel(model(), { edit: true, what: "icons" });
  const target = element({ "data-node": "a:one" });
  const board = stage();
  view._onPointerDown(pointer(0, 0, { target: [target, board] }));

  view._onPointerMove(pointer(300, 700));
  assert.deepEqual(view._written, [], "nothing is persisted mid-drag");
  assert.equal(target.style.left, "30%", "but it does follow the pointer");

  view._onPointerUp();
  assert.deepEqual(view._written, [
    ["nodes", "a:one", { position: { x: 0.3, y: 0.7 } }],
  ]);
});

test("dragging snaps to the grid, and Shift lets go of it", () => {
  const view = panel(model(), { edit: true, what: "icons" });
  const target = element({ "data-node": "a:one" });
  view._onPointerDown(pointer(0, 0, { target: [target, stage()] }));

  view._onPointerMove(pointer(313, 487));
  view._onPointerUp();
  assert.deepEqual(view._written[0][2].position, { x: 0.32, y: 0.48 });

  view._written = [];
  view._onPointerDown(pointer(0, 0, { target: [target, stage()] }));
  view._onPointerMove(pointer(313, 487, { shift: true }));
  view._onPointerUp();
  assert.deepEqual(view._written[0][2].position, { x: 0.313, y: 0.487 });
});

test("a drag never leaves the floor plan", () => {
  const view = panel(model(), { edit: true, what: "icons" });
  const target = element({ "data-node": "a:one" });
  view._onPointerDown(pointer(0, 0, { target: [target, stage()] }));
  view._onPointerMove(pointer(-500, 4000, { shift: true }));
  view._onPointerUp();
  assert.deepEqual(view._written[0][2].position, { x: 0, y: 1 });
});

test("dragging a wall moves that wall and leaves the opposite one alone", () => {
  const view = panel(model(), { edit: true });
  const area = element({ "data-area": "wohnzimmer" }, { left: 250, top: 500 });
  // The south-east corner: the north and west walls must not move.
  const grip = element({ "data-resize-area": "wohnzimmer",
                         "data-resize-edge": "se" });
  view._onPointerDown(pointer(0, 0, { target: [grip, area, stage()] }));

  view._onPointerMove(pointer(600, 800));
  view._onPointerUp();

  const [[section, key, values]] = view._written;
  const wall = (value) => Number(value.toFixed(4));
  assert.equal(section, "areas");
  assert.equal(key, "wohnzimmer");
  // Started as 0.4 x 0.4 centred on (0.25, 0.5): left 0.05, top 0.3.
  assert.equal(wall(values.position.x - values.size.width / 2), 0.05, "west wall stayed");
  assert.equal(wall(values.position.y - values.size.height / 2), 0.3, "north wall stayed");
  assert.equal(wall(values.position.x + values.size.width / 2), 0.6, "east wall followed");
  assert.equal(wall(values.position.y + values.size.height / 2), 0.8, "south wall followed");
});

test("a west handle widens the room to the left", () => {
  const view = panel(model(), { edit: true });
  const area = element({ "data-area": "wohnzimmer" }, { left: 250, top: 500 });
  const grip = element({ "data-resize-area": "wohnzimmer",
                         "data-resize-edge": "w" });
  view._onPointerDown(pointer(0, 0, { target: [grip, area, stage()] }));
  view._onPointerMove(pointer(0, 500));
  view._onPointerUp();

  const values = view._written[0][2];
  assert.equal(Number((values.position.x + values.size.width / 2).toFixed(4)), 0.45,
               "east wall stayed");
  assert.ok(values.size.width > 0.4, "and the room got wider");
});

test("an area cannot be resized into nothing", () => {
  const view = panel(model(), { edit: true });
  const area = element({ "data-area": "wohnzimmer" }, { left: 250, top: 500 });
  const grip = element({ "data-resize-area": "wohnzimmer" });
  view._onPointerDown(pointer(0, 0, { target: [grip, area, stage()] }));
  view._onPointerMove(pointer(0, 0));
  view._onPointerUp();
  const { width, height } = view._written[0][2].size;
  assert.ok(width > 0 && height > 0, "still grabbable afterwards");
});

test("nothing drags while not editing", () => {
  const view = panel();
  const target = element({ "data-node": "a:one" });
  view._onPointerDown(pointer(0, 0, { target: [target, stage()] }));
  assert.equal(view._drag, null);
});

test("the click that ends a drag does not open a popup", () => {
  const view = panel(model(), { edit: true });
  view._render = () => {};
  view._dragged = true;
  view._onClick(pointer(0, 0, {
    target: [element({ "data-node": "a:one" })],
  }));
  assert.equal(view._selected, null);
});

// ── Getting things back ────────────────────────────────────

test("hidden things are listed with a way back", () => {
  const view = panel(model({
    hidden: { nodes: [{ id: "a:gone", label: "Verschwunden" }],
              areas: [{ id: "keller", name: "Keller" }] },
  }));
  const html = view._sidebarHtml();
  assert.match(html, /data-show-node="a:gone"/);
  assert.match(html, /data-show-area="keller"/);
});

test("nothing hidden means no tray at all", () => {
  assert.equal(panel()._hiddenTrayHtml(), "");
});

test("un-hiding clears the override rather than writing a false", () => {
  const view = panel();
  view._render = () => {};
  view._onClick(pointer(0, 0, {
    target: [element({ "data-show-node": "a:gone" })],
  }));
  assert.deepEqual(view._written, [["nodes", "a:gone", { hidden: null }]], (
    "null restores the automatic behaviour; false would pin it"
  ));
});

// ── Sliders ────────────────────────────────────────────────

test("a slider persists on release, not on every tick", () => {
  const view = panel(model(), { edit: true });
  const slider = { value: "2", getAttribute: (n) =>
    n === "data-node-scale" ? "a:one" : null };

  view._onInput({ target: slider }, false);
  assert.deepEqual(view._written, [], "dragging a slider is not fifty writes");

  view._onInput({ target: slider }, true);
  assert.deepEqual(view._written, [["nodes", "a:one", { scale: 2 }]]);
});

test("the node edit panel shows what is stored", () => {
  const view = panel(model(), { edit: true });
  const html = view._editPanelHtml("node", "a:one",
                                   { ...view._model.nodes[0], scale: 1.5, rotation: 90 });
  assert.match(html, /value="1.5"/);
  assert.match(html, /value="90"/);
  assert.match(html, /data-hide-node="a:one"/);
});

test("an oversized background is refused before it is uploaded", () => {
  const view = panel(model(), { edit: true });
  view._render = () => {};
  view._readBackground({ size: 9 * 1024 * 1024 });
  assert.match(view._error, /zu groß/);
  assert.deepEqual(view._written, []);
});


// ── Themes ─────────────────────────────────────────────────

test("an empty theme colour means Home Assistant's own theme", () => {
  const view = panel();
  assert.match(view._stateColour("online"), /--success-color/);
  assert.match(view._qualityColour("poor"), /--error-color/);
  assert.equal(view._themeVars, "", "nothing is forced onto the page");
});

test("the hub's colours win over the built-in fallbacks", () => {
  const view = panel(model({
    theme: theme({ state_colors: { online: "#00ff00", offline: "", unknown: "" },
                   quality_colors: { good: "#abc123" } }),
  }));
  assert.equal(view._stateColour("online"), "#00ff00");
  assert.equal(view._qualityColour("good"), "#abc123");
  assert.match(view._stateColour("offline"), /--error-color/,
               "an empty one still inherits");
});

test("a provider's own colour still beats the theme", () => {
  const view = panel(model({
    theme: theme({ state_colors: { online: "#00ff00" } }),
  }));
  assert.match(view._nodeHtml(node("a:x", { color: "#123456" })),
               /--node-color:#123456/);
});

test("a themed word an integration invented is not honoured as a state", () => {
  const view = panel(model({ theme: theme({ state_colors: { online: "#00ff00" } }) }));
  assert.match(view._stateColour("heating"), /--fp-accent/,
               "unknown words fall back; they are not looked up per integration");
});

test("accent, surface and ink reach the page as variables", () => {
  const view = panel(model({
    theme: theme({ accent: "#ff0000", surface: "#111111", ink: "#eeeeee" }),
  }));
  assert.match(view._themeVars, /--fp-accent:#ff0000/);
  assert.match(view._themeVars, /--fp-surface:#111111/);
  assert.match(view._themeVars, /--fp-ink:#eeeeee/);
});

test("the theme's node size multiplies the user's own scale", () => {
  const view = panel(model({ theme: theme({ node_size: 2 }) }));
  assert.match(view._nodeHtml(node("a:x", { scale: 1.5 })), /--node-scale:3/);
});

test("shape, label and room choices reach the stage", () => {
  const view = panel(model({
    theme: theme({ node_shape: "square", labels: "hover", room_style: "filled" }),
  }));
  const html = view._stageHtml();
  assert.match(html, /shape-square/);
  assert.match(html, /labels-hover/);
  assert.match(html, /rooms-filled/);
});

test("curved edges are a path, straight ones stay a line", () => {
  const straight = panel();
  assert.match(straight._edgeHtml(straight._visibleEdges[0]), /^\s*<line/);

  const curved = panel(model({ theme: theme({ edge_style: "curved" }) }));
  const html = curved._edgeHtml(curved._visibleEdges[0]);
  assert.match(html, /<path/);
  assert.match(html, /d="M 500 500 Q [\d.-]+ [\d.-]+ 800 200"/);
  assert.match(html, /fill="none"/, "an unfilled curve, not a blob");
});

test("both edge styles keep what a renderer must not lose", () => {
  for (const style of ["straight", "curved"]) {
    const view = panel(model({ theme: theme({ edge_style: style }) }));
    const html = view._edgeHtml({
      ...view._visibleEdges[0], dashed: true, directed: true, label: "5 Mbit",
    });
    assert.match(html, /data-edge=/, `${style}: still clickable`);
    assert.match(html, /stroke-dasharray/, `${style}: still dashed`);
    assert.match(html, /marker-end/, `${style}: still directed`);
    assert.match(html, /5 Mbit/, `${style}: still labelled`);
  }
});

test("picking a preset sends the preset alone", () => {
  const view = panel(model(), { edit: true });
  view._render = () => {};
  view._onClick(pointer(0, 0, { target: [element({ "data-preset": "neon" })] }));
  assert.deepEqual(view._written, [
    ["settings", "view", { theme: { preset: "neon" } }],
  ], "anything else would overrule what the preset decided");
});

test("tweaking one control keeps everything else on screen", () => {
  const view = panel(model({ theme: theme({ preset: "neon", node_shape: "square" }) }),
                     { edit: true });
  view._setTheme({ labels: "never" });

  const written = view._written[0][2].theme;
  assert.equal(written.labels, "never");
  assert.equal(written.preset, "neon");
  assert.equal(written.node_shape, "square", "the rest is pinned, not lost");
});

test("the palette is offered only while editing", () => {
  const view = panel();
  assert.doesNotMatch(view._headerHtml(), /data-theme-dialog/);
  view._edit = true;
  assert.match(view._headerHtml(), /data-theme-dialog/);
});

test("the dialog offers a colour per word of the vocabulary", () => {
  const view = panel(model(), { edit: true });
  const html = view._themeDialogHtml();
  for (const word of ["online", "offline", "unknown"]) {
    assert.match(html, new RegExp(`data-state-color="${word}"`));
  }
  for (const word of ["good", "fair", "poor", "unknown"]) {
    assert.match(html, new RegExp(`data-quality-color="${word}"`));
  }
  assert.match(html, /data-reset-theme/, "and a way back to the default");
});


// ── Custom layers ──────────────────────────────────────────

test("custom layers are an editing concern, not a viewing one", () => {
  const view = panel(model({ custom_layers: [{ id: "l1", name: "Lichter" }] }));
  assert.equal(view._customLayersHtml(), "");
  view._edit = true;
  assert.match(view._customLayersHtml(), /data-edit-layer="l1"/);
  assert.match(view._customLayersHtml(), /data-new-layer/);
});

test("a new layer gets an id that cannot collide with an existing one", () => {
  const view = panel(model({ custom_layers: [{ id: "l1", name: "A" }] }),
                     { edit: true });
  view._render = () => {};
  view._facets = { domains: [], labels: [], device_classes: [] };
  view._openLayerDialog(null);

  assert.ok(view._layerDialog._isNew);
  assert.notEqual(view._layerDialog.id, "l1");
});

test("editing a layer starts from a copy, so cancelling really cancels", () => {
  const stored = { id: "l1", name: "Lichter", domains: ["light"] };
  const view = panel(model({ custom_layers: [stored] }), { edit: true });
  view._render = () => {};
  view._facets = { domains: [], labels: [], device_classes: [] };
  view._openLayerDialog("l1");

  view._layerDialog.name = "Etwas anderes";
  view._layerDialog = null;

  assert.equal(stored.name, "Lichter");
});

test("a facet chip toggles rather than only adding", () => {
  const view = panel(model(), { edit: true });
  view._render = () => {};
  view._layerDialog = { id: "l1", name: "A", domains: [] };

  const chip = element({ "data-facet": "domains", "data-value": "light" });
  view._onClick(pointer(0, 0, { target: [chip] }));
  assert.deepEqual(view._layerDialog.domains, ["light"]);

  view._onClick(pointer(0, 0, { target: [chip] }));
  assert.deepEqual(view._layerDialog.domains, []);
});

test("saving writes the whole list, with the empty criteria dropped", () => {
  const view = panel(model({ custom_layers: [{ id: "other", name: "Andere" }] }),
                     { edit: true });
  view._layerDialog = {
    id: "l1", name: "Lichter", domains: ["light"], areas: [], labels: [],
    _isNew: true,
  };
  view._saveLayer();

  const [[section, key, values]] = view._written;
  assert.equal(section, "settings");
  assert.equal(key, "view");
  assert.deepEqual(values.custom_layers, [
    { id: "other", name: "Andere" },
    { id: "l1", name: "Lichter", domains: ["light"] },
  ]);
  assert.equal(view._layerDialog, null, "the dialog closes on save");
});

test("an unnamed layer still gets a name rather than an empty row", () => {
  const view = panel(model(), { edit: true });
  view._layerDialog = { id: "l1", name: "", domains: ["light"], _isNew: true };
  view._saveLayer();
  assert.equal(view._written[0][2].custom_layers[0].name, "Eigene Ebene");
});

test("editing replaces the layer instead of duplicating it", () => {
  const view = panel(model({ custom_layers: [{ id: "l1", name: "Alt" }] }),
                     { edit: true });
  view._layerDialog = { id: "l1", name: "Neu", domains: ["light"] };
  view._saveLayer();

  const written = view._written[0][2].custom_layers;
  assert.equal(written.length, 1);
  assert.equal(written[0].name, "Neu");
});

test("deleting removes only that layer", () => {
  const view = panel(model({
    custom_layers: [{ id: "l1", name: "A" }, { id: "l2", name: "B" }],
  }), { edit: true });
  view._layerDialog = { id: "l1", name: "A" };
  view._deleteLayer();

  assert.deepEqual(view._written[0][2].custom_layers, [{ id: "l2", name: "B" }]);
});

test("entity lists are typed as text and stored as a list", () => {
  const view = panel(model(), { edit: true });
  view._layerDialog = { id: "l1", name: "A" };
  view._onInput({ target: {
    value: " sensor.a , light.b ,, ",
    getAttribute: (n) => (n === "data-layer-field" ? "entities" : null),
  } }, false);

  assert.deepEqual(view._layerDialog.entities, ["sensor.a", "light.b"]);
  assert.deepEqual(view._written, [], "typing is not a round trip per keystroke");
});

test("the dialog offers the facets the house actually has", () => {
  const view = panel(model(), { edit: true });
  view._facets = {
    domains: [{ value: "light", count: 12 }],
    labels: [{ value: "security", count: 3 }],
    device_classes: [],
  };
  view._layerDialog = { id: "l1", name: "A", domains: ["light"] };
  const html = view._layerDialogHtml();

  assert.match(html, /data-value="light"/);
  assert.match(html, /data-value="security"/);
  assert.match(html, /data-facet="areas"/, "and the areas from the model");
  assert.match(html, /chip on" data-facet="domains"\s+data-value="light"/,
               "what is already selected shows as selected");
});

test("the topology checkbox survives a round trip through the dialog", () => {
  // The rule is stored, not a list -- so an option that quietly fails to
  // save reads as "the feature does not work".
  const view = panel();
  view._layerDialog = { id: "l", name: "Lichter", _isNew: true };
  view._writeCustomLayers = (layers) => (view._written = layers);

  view._onInput({
    target: { dataset: { layerToggle: "topology" }, checked: true,
              getAttribute: (name) =>
                name === "data-layer-toggle" ? "topology" : null },
  }, true);
  view._saveLayer();

  assert.equal(view._written[0].topology, true);
});

test("an unticked box is left out rather than stored as false", () => {
  const view = panel();
  view._layerDialog = { id: "l", name: "Lichter", _isNew: true };
  view._writeCustomLayers = (layers) => (view._written = layers);

  view._saveLayer();

  assert.ok(!("topology" in view._written[0]));
});

test("a word Home Assistant has no opinion about uses the hub's fallback", () => {
  // `on` and `off` are as common as online/offline and mean something
  // else. Keeping a private table here is what made every light draw in
  // the same colour whether it was on or not.
  const data = model();
  data.theme.fallback = {
    state_colors: { on: "#fbc02d", off: "#78909c" },
    quality_colors: {},
  };
  const view = panel(data);

  assert.equal(view._stateColour("on"), "#fbc02d");
  assert.equal(view._stateColour("off"), "#78909c");
});

test("the user's own colour still beats the fallback", () => {
  const data = model();
  data.theme.state_colors = { ...data.theme.state_colors, on: "#123456" };
  data.theme.fallback = { state_colors: { on: "#fbc02d" }, quality_colors: {} };
  const view = panel(data);

  assert.equal(view._stateColour("on"), "#123456");
});

test("inside Home Assistant its own theme still wins over the fallback", () => {
  // Otherwise installing the hub would start arguing with the theme the
  // user already chose, which `auto` exists to avoid.
  const data = model();
  data.theme.fallback = { state_colors: { online: "#ff0000" }, quality_colors: {} };
  const view = panel(data);

  assert.equal(view._stateColour("online"), HA_COLOURS.online);
});

// ── The house as a whole ───────────────────────────────────

test("the panel opens on the whole house, not on one storey", () => {
  const view = panel(model(), { floor: null });
  assert.equal(view._stacked, true);
});

test("a house with one storey has nothing to stack", () => {
  const data = model();
  data.floors = [data.floors[0]];
  const view = panel(data, { floor: null });
  assert.equal(view._stacked, false, "a single floor is just the floor");
});

test("an edge between two storeys is drawn, not dropped", () => {
  // The reason the stacked view exists at all. In the per-floor view such
  // an edge has no second end to attach to and is correctly discarded --
  // which meant it was invisible everywhere.
  const data = model({
    nodes: [node("a:down"), node("a:up", { floor_id: "og" })],
    edges: [edge("a:down", "a:up", { quality: "good" })],
  });
  const flat = panel(data, { floor: "eg" });
  const stacked = panel(data, { floor: null });

  assert.equal(flat._visibleEdges.length, 0);
  assert.equal(stacked._visibleEdges.length, 1);
  assert.match(stacked._stackHtml(), /class="stack-edge across/);
});

test("storeys are drawn top down, the way a section is read", () => {
  const view = panel(model(), { floor: null });
  assert.deepEqual(view._stackFloors.map((f) => f.id), ["og", "eg"]);
});

test("the storeys share one vertical axis, because they are one house", () => {
  const view = panel(model(), { floor: null });
  const upper = view._project(0, 0.5, 0.5);
  const lower = view._project(1, 0.5, 0.5);

  assert.ok(upper.y < lower.y, "the storeys would sit on top of each other");
  // Hier stand einmal das Gegenteil: jede Etage ein Stueck weiter rechts,
  // damit deckungsgleiche Umrisse nicht ineinander verschwimmen. Das war
  // richtig, solange die Etagen flache Umrisse dicht beieinander waren --
  // inzwischen haben sie Hoehe, Waende mit Dicke und 340 Einheiten Luft
  // dazwischen. Angesehen las der Versatz nicht als auseinandergezogenes
  // Gebaeude, sondern als drei Grundrisse, die nicht ganz uebereinander
  // liegen.
  assert.equal(lower.x, upper.x, "die Etagen stehen versetzt statt gestapelt");
});

test("the drawing does not get wider the more storeys the house has", () => {
  // Der Versatz addierte sich: Bei acht Etagen belegte das Haus noch
  // 59 % der Bildbreite statt 77 %. Ein Stapel wurde also umso kleiner
  // gezeichnet, je mehr Stockwerke er hatte -- in einer Ansicht, deren
  // einziger Zweck der Stapel ist.
  const storeys = (count) =>
    Array.from({ length: count }, (unused, index) => ({
      id: `f${index}`, name: `Etage ${index}`, level: index, icon: "",
    }));
  const drei = panel(model({ floors: storeys(3) }), { floor: null });
  const acht = panel(model({ floors: storeys(8) }), { floor: null });
  assert.equal(acht._stackWidth, drei._stackWidth);
});

test("both flanks of a storey lean inwards, not both to the right", () => {
  // Dieser Test hat einmal nur die linke Wand geprueft -- und deshalb
  // einen kompletten Umbau der Projektion nicht bemerkt: von der
  // Parallelverschiebung (nach hinten rutscht alles gleich weit nach
  // rechts) zur Flucht (die Hinterkante ist schmaler). Auf der linken
  // Flanke tun beide dasselbe, naemlich nach rechts. Der Unterschied
  // steht rechts, und dort sah niemand hin.
  const view = panel(model(), { floor: null });
  const backLeft = view._project(0, 0, 0);
  const frontLeft = view._project(0, 0, 1);
  const backRight = view._project(0, 1, 0);
  const frontRight = view._project(0, 1, 1);

  assert.ok(backLeft.x > frontLeft.x, "die linke Wand weicht nach innen");
  assert.ok(backRight.x < frontRight.x, "die rechte Wand weicht nach innen");
});

test("the back edge of a storey is narrower than its front edge", () => {
  // Das ist die Perspektive in einem Satz. Bei einer Parallelverschiebung
  // waeren beide exakt gleich breit, und das Haus wirkt gekippt statt
  // gesehen: man blickt auf die eine Aussenwand von aussen und auf die
  // andere von innen, was kein Standpunkt ist, den jemand einnehmen kann.
  const view = panel(model(), { floor: null });
  const front = view._project(0, 1, 1).x - view._project(0, 0, 1).x;
  const back = view._project(0, 1, 0).x - view._project(0, 0, 0).x;

  assert.ok(back < front, "die Hinterkante ist nicht schmaler");
  assert.ok(back > front * 0.6, "so stark ist es kein Grundriss mehr");
});

test("the front edge keeps the full width, so nothing is drawn past it", () => {
  // Die Flucht zieht nach innen. Damit ist die Vorderkante die breiteste
  // Stelle der Zeichnung -- und `_stackWidth` darf keinen Zuschlag mehr
  // dafuer machen, wie sie ihn fuer die alte Verschiebung brauchte.
  const view = panel(model(), { floor: null });
  const widest = Math.max(
    ...view._stackFloors.flatMap((_floor, plane) =>
      [0, 1].flatMap((y) => [0, 1].map((x) => view._project(plane, x, y).x)),
    ),
  );
  assert.ok(widest <= view._stackWidth, "die Zeichnung laeuft aus dem Bild");
});

test("many storeys get more drawing, not less air between them", () => {
  // They used to be squeezed into a fixed 1000-unit box: six floors and
  // the spacing collapsed below a storey's own depth, so every floor was
  // drawn through the one under it. That was the porridge.
  const data = model();
  data.floors = ["a", "b", "c", "d", "e", "f"].map((id, level) => ({
    id, name: id.toUpperCase(), level, icon: "",
  }));
  const view = panel(data, { floor: null });

  const height = view._stackHeight;
  assert.ok(view._project(5, 1, 1).y <= height, "the bottom storey is off-canvas");
  assert.match(view._stackHtml(), new RegExp(
    `viewBox="0 0 ${Math.round(view._stackWidth)} ${Math.round(height)}"`));

  // A storey is 300 units deep. Two neighbours must not interleave.
  const step = view._project(1, 0, 0).y - view._project(0, 0, 0).y;
  assert.ok(step > 300, `storeys ${step} apart is less than one storey deep`);
});

test("a node on no storey at all lands in the tray, not silently missing", () => {
  const data = model({ nodes: [node("a:lost", { floor_id: null })] });
  const view = panel(data, { floor: null });

  // Not on a storey it does not belong to -- in the strip underneath,
  // which is the same answer the single-floor view gives.
  assert.doesNotMatch(view._stackHtml(), /a:lost/);
  assert.match(view._trayHtml(), /a:lost/);
});

test("the storey for roomless areas stays at the bottom of the stack", () => {
  // Reversing it into the attic would say the house has a floor above the
  // top one, which is the opposite of what "no floor" means.
  const data = model();
  data.floors = [
    { id: "eg", name: "EG", level: 0, icon: "" },
    { id: "og", name: "OG", level: 1, icon: "" },
    { id: "_unassigned", name: "Ohne Etage", level: null, unassigned: true },
  ];
  const view = panel(data, { floor: null });

  assert.deepEqual(view._stackFloors.map((f) => f.id), ["og", "eg", "_unassigned"]);
});

test("zwoelf Geraete auf einem Fleck koennen nicht alle beschriftet sein", () => {
  // Frueher entschied das eine Pauschale: mehr als fuenf auf einer
  // Ebene, und alle Namen verschwanden. Jetzt entscheidet, ob wirklich
  // kein Platz mehr ist -- und bei zwoelf Punkten an derselben Stelle
  // ist wirklich keiner mehr.
  const data = model({
    nodes: Array.from({ length: 12 }, (_, i) => node(`a:n${i}`)),
  });
  const view = panel(data, { floor: null });

  assert.match(view._stackHtml(), /stack-node[^"]*crowded/);
});

test("a storey with a handful of nodes keeps its labels", () => {
  const data = model({ nodes: [node("a:one"), node("a:two")] });
  const view = panel(data, { floor: null });

  assert.ok(!/crowded/.test(view._stackHtml()));
});

// ── Clustering: a room with too many devices to draw separately ─────

test("a room past the threshold collapses into one badge", () => {
  const data = model({
    nodes: Array.from({ length: 5 }, (_, i) =>
      node(`a:n${i}`, { area_id: "wohnzimmer" })),
  });
  const view = panel(data);
  const { singles, clusters } = view._nodeGroups;
  assert.deepEqual(singles, []);
  assert.equal(clusters.length, 1);
  assert.equal(clusters[0].length, 5);
  assert.match(view._nodesHtml(), /class="node cluster/);
  assert.match(view._nodesHtml(), /cluster-count">5</);
});

test("a handful of devices in one room stay as separate icons", () => {
  const data = model({
    nodes: [
      node("a:one", { area_id: "wohnzimmer" }),
      node("a:two", { area_id: "wohnzimmer" }),
      node("a:three", { area_id: "wohnzimmer" }),
    ],
  });
  const view = panel(data);
  const { singles, clusters } = view._nodeGroups;
  assert.equal(singles.length, 3);
  assert.equal(clusters.length, 0);
  assert.doesNotMatch(view._nodesHtml(), /node cluster/);
});

test("devices with no room never cluster, however many there are", () => {
  const data = model({
    nodes: Array.from({ length: 6 }, (_, i) => node(`a:n${i}`, { area_id: null })),
  });
  const view = panel(data);
  assert.equal(view._nodeGroups.clusters.length, 0);
  assert.equal(view._nodeGroups.singles.length, 6);
});

test("arranging icons pulls a cluster back apart", () => {
  const data = model({
    nodes: Array.from({ length: 5 }, (_, i) =>
      node(`a:n${i}`, { area_id: "wohnzimmer" })),
  });
  const view = panel(data, { what: "icons" });
  view._edit = true;
  assert.equal(view._nodeGroups.clusters.length, 0, "a hidden device is one you cannot drag");
  assert.equal(view._nodeGroups.singles.length, 5);
});

test("searching pulls a cluster back apart too", () => {
  const data = model({
    nodes: Array.from({ length: 5 }, (_, i) =>
      node(`a:n${i}`, { area_id: "wohnzimmer", label: `Lampe ${i}` })),
  });
  const view = panel(data);
  view._search = "lampe 3";
  assert.equal(view._nodeGroups.clusters.length, 0);
});

test("opening a cluster lists every device inside it, closing it selects one", () => {
  const data = model({
    nodes: Array.from({ length: 4 }, (_, i) =>
      node(`a:n${i}`, { area_id: "wohnzimmer", label: `Ding ${i}` })),
  });
  const view = panel(data);
  const areaId = view._nodeGroups.clusters[0][0].area_id;
  view._clusterOpen = areaId;
  const html = view._nodesHtml();
  for (let i = 0; i < 4; i += 1) {
    assert.match(html, new RegExp(`Ding ${i}`));
  }
  assert.match(html, /data-close-cluster="1"/);
});

// ── Icons: what a device looks like ────────────────────────

test("a device is drawn with the icon Home Assistant gave it", () => {
  const view = panel(model({ nodes: [node("a:lamp", { icon: "mdi:lightbulb" })] }));
  const html = view._nodeHtml(view._visibleNodes[0]);
  assert.match(html, /icon="mdi:lightbulb"/);
  assert.doesNotMatch(html, /circle-medium/, "never an anonymous dot");
});

test("a provider's own icon set wins over Home Assistant's icon", () => {
  const data = model({
    nodes: [node("a:one", { icon: "mdi:lightbulb" })],
    icon_sets: { a: { "mdi:lightbulb": { svg: "<svg id='own'></svg>" } } },
  });
  assert.match(panel(data)._nodeHtml(data.nodes[0]), /id='own'/);
});

test("a node with no icon anywhere falls back to its provider's", () => {
  const data = model({ nodes: [node("a:mystery")] });
  data.providers[0].icon = "mdi:lan";
  assert.match(panel(data)._nodeHtml(data.nodes[0]), /icon="mdi:lan"/);
});

test("the house view draws the same icons as a single floor", () => {
  const view = panel(model({ nodes: [node("a:lamp", { icon: "mdi:lightbulb" })] }),
                     { floor: null });
  assert.match(view._stackHtml(), /icon="mdi:lightbulb"/);
});

// ── The garden is not a storey ─────────────────────────────

const withGarden = () =>
  model({
    floors: [
      { id: "eg", name: "Erdgeschoss", level: 0, icon: "",
        has_outdoor: true, outdoor_margin: 0.28 },
      { id: "og", name: "Obergeschoss", level: 1, icon: "" },
    ],
    areas: [
      { id: "wohnzimmer", name: "Wohnzimmer", floor_id: "eg", kind: "indoor",
        position: at(0.5, 0.5), size: { width: 0.4, height: 0.4 } },
      { id: "garten", name: "Garten", floor_id: "eg", kind: "outdoor",
        outdoor: true, position: at(0.5, 1.14), size: { width: 0.9, height: 0.22 } },
    ],
    nodes: [],
    edges: [],
  });

test("a floor with a garden is drawn through a wider window", () => {
  const view = panel(withGarden());
  const frame = view._frame;
  assert.equal(frame.min, -0.28);
  assert.equal(Number(frame.span.toFixed(4)), 1.56);
});

test("the garden sits outside the house but on the same floor", () => {
  const html = panel(withGarden())._areasHtml();
  const garden = html.match(/<div class="area[\s\S]*?data-area="garten"[\s\S]*?">/)[0];
  // 1.14 in a -0.28..1.28 window is beyond the 0..1 house, which is the
  // whole point: it surrounds the ground floor rather than stacking on it.
  assert.match(garden, /top:9[0-9.]+%/);
  assert.match(garden, /class="area outdoor /);
});

test("a floor without a garden is drawn exactly as before", () => {
  const view = panel();
  // Vier Raender, alle null: das Haus fuellt das Fenster, in beiden
  // Achsen. Der Rahmen fuehrt die Achsen seit dem Grundstueck je
  // Himmelsrichtung getrennt.
  assert.deepEqual(view._frame, { min: 0, span: 1, minY: 0, spanY: 1 });
  assert.match(view._areasHtml(), /left:25%/);
});

test("300m of garden behind the house does not put 300m in front of it", () => {
  // Gemeldet als "ich kann das Grundstueck nicht einfach nach rechts
  // erweitern, obwohl ich hinterm Haus 300m Garten habe". Der Rand war
  // eine einzige Zahl fuer alle vier Seiten: was hinten gebraucht wurde,
  // kam vorne, links und rechts genauso dazu -- und das Haus schrumpfte
  // in der Mitte eines fast leeren Bildes.
  const view = panel(model({
    floors: [{ id: "eg", name: "Erdgeschoss", level: 0, icon: "",
               has_outdoor: true, outdoor_margin: 0.28 }],
    areas: [
      { id: "wohnzimmer", name: "Wohnzimmer", floor_id: "eg", kind: "indoor",
        position: at(0.5, 0.5), size: { width: 0.4, height: 0.4 } },
      // Ein tiefer Garten hinter dem Haus, sonst nichts.
      { id: "garten", name: "Garten", floor_id: "eg", kind: "outdoor",
        outdoor: true, position: at(0.5, 2.2), size: { width: 0.9, height: 2.2 } },
    ],
  }));
  const frame = view._frame;

  // Hinten ist Platz ...
  assert.ok(frame.minY + frame.spanY > 3, "der Garten passt nicht ins Bild");
  // ... vorne, links und rechts bleibt es bei der Schuerze.
  assert.equal(frame.min, -0.28, "links wuchs mit, ohne Grund");
  assert.equal(Number(frame.span.toFixed(4)), 1.56, "rechts wuchs mit");
  assert.equal(frame.minY, -0.28, "vorne wuchs mit");
});

test("a lopsided plot leaves the rooms square", () => {
  // Sobald der Rahmen nicht mehr quadratisch ist, muss die Buehne sein
  // Seitenverhaeltnis uebernehmen -- sonst rechnen die Raeume in Prozent
  // von etwas Falschem und ein quadratisches Zimmer wird zum Rechteck.
  const data = model({
    floors: [{ id: "eg", name: "Erdgeschoss", level: 0, icon: "", aspect: 1,
               has_outdoor: true, outdoor_margin: 0.28,
               plot: [{ x: -0.28, y: -0.28 }, { x: 1.28, y: -0.28 },
                      { x: 1.28, y: 3 }, { x: -0.28, y: 3 }] }],
  });
  const view = panel(data);
  const frame = view._frame;
  const stage = view._stageHtml();

  const ratio = frame.span / frame.spanY;
  assert.ok(ratio < 0.6, "der Rahmen ist gar nicht schief");
  assert.match(stage, new RegExp(`aspect-ratio:${ratio.toFixed(4)}`),
               "die Buehne folgt dem Rahmen nicht");
});

test("dragging in the garden keeps the coordinates outside the house", () => {
  const view = panel(withGarden(), { edit: true });
  const area = element({ "data-area": "garten" });
  view._onPointerDown(pointer(0, 0, { target: [area, stage()] }));
  // The very bottom of a 1000px stage, in a -0.28..1.28 window.
  view._onPointerMove(pointer(500, 1000, { shift: true }));
  view._onPointerUp();
  assert.equal(view._written[0][2].position.y, 1.28);
});

// ── The sandwich, and what may appear in it ────────────────

test("an area kept out of the sandwich still shows on its own floor", () => {
  const data = withGarden();
  data.areas[1].in_sandwich = false;
  const view = panel(data, { floor: null });
  assert.deepEqual(view._visibleAreas.map((area) => area.id), ["wohnzimmer"]);

  view._floorId = "eg";
  assert.deepEqual(view._visibleAreas.map((area) => area.id),
                   ["wohnzimmer", "garten"]);
});

test("a floor kept out of the sandwich takes its nodes with it", () => {
  const data = model({ nodes: [node("a:up", { floor_id: "og" })] });
  data.floors[1].in_sandwich = false;
  const view = panel(data, { floor: null });
  assert.deepEqual(view._stackFloors.map((floor) => floor.id), ["eg"]);
  assert.deepEqual(view._visibleNodes, []);
});

// ── The camera ─────────────────────────────────────────────

test("zooming keeps the point under the cursor where it was", () => {
  const view = panel();
  view._root = { querySelector: () => null };
  view._zoomBy(2, { x: 100, y: 100 });
  assert.equal(view._view.zoom, 2);
  assert.equal(view._view.x, -100, "the anchor did not slide away");
});

test("zoom stops at the ends instead of vanishing", () => {
  const view = panel();
  view._root = { querySelector: () => null };
  for (let step = 0; step < 40; step += 1) view._zoomBy(2);
  assert.ok(view._view.zoom <= 6);
  for (let step = 0; step < 80; step += 1) view._zoomBy(0.5);
  assert.ok(view._view.zoom >= 0.4);
});

test("fit-to-screen is always the way back", () => {
  const view = panel();
  view._root = { querySelector: () => null };
  view._view = { zoom: 4, x: -800, y: 300 };
  view._fitToScreen();
  assert.deepEqual(view._view, { zoom: 1, x: 0, y: 0 });
});

test("the camera exposes its zoom so nodes can keep their screen size", () => {
  let canvasStyle = "";
  const view = panel();
  view._root = {
    querySelector(selector) {
      if (selector !== ".canvas") return null;
      return {
        style: {
          set transform(value) {
            canvasStyle = value;
          },
          setProperty(name, value) {
            canvasStyle += `;${name}:${value}`;
          },
        },
      };
    },
  };
  view._zoomBy(2, { x: 100, y: 100 });
  assert.match(canvasStyle, /--camera-zoom:2/);
});

test("node markup counter-scales with the camera", () => {
  const source = rendererSource();
  assert.match(source, /var\(--node-scale,1\) \* min\(1, 1 \/ var\(--camera-zoom,1\)\)/);
});

test("counter-scaling never makes a marker bigger than it is", () => {
  // Zoomed out to see the whole house, symmetrical counter-scaling blew
  // every label up to full size over a plan drawn at half -- twenty
  // devices came out as one smear of overlapping words.
  const view = panel(model(), { floor: null });

  view._view.zoom = 4;
  assert.equal(view._counterScale, 0.25, "zoomed in it does its job");
  view._view.zoom = 0.5;
  assert.equal(view._counterScale, 1, "zoomed out it stops, it does not invert");
  view._view.zoom = 1;
  assert.equal(view._counterScale, 1);
});

test("the stacked view scales its markers about their own anchor", () => {
  const source = rendererSource();
  // translate first, then scale: the marker grows around the spot it
  // marks instead of drifting away from it the deeper the camera goes.
  assert.match(source, /translate\(\$\{x\},\$\{y\}\) scale\(\$\{counter\}\)/);
  assert.doesNotMatch(
    source,
    /scale:calc\(1 \/ var\(--camera-zoom, 1\)\)/,
    "the CSS scale property composes the other way round, and browsers " +
      "disagree about where a group's middle is -- that was the drift",
  );
});

test("a provider's own icon is never nested raw into the drawing", () => {
  const source = rendererSource();
  // A bare <svg> with no width is a nested viewport and defaults to the
  // whole drawing -- one device covered the entire house.
  assert.doesNotMatch(source, /<g class="stack-icon"[^>]*>\$\{custom\.svg\}/);
  assert.match(source, /class="stack-icon">\$\{inner\}<\/foreignObject>/);
});

test("the canvas is not frozen onto a bitmap layer", () => {
  const source = rendererSource();
  // will-change:transform rasterises the plan once and then only stretches
  // that bitmap, which is what made the icons blurry on the way in.
  assert.doesNotMatch(source, /\.canvas \{[^}]*will-change:transform/);
});

test("the floor tabs claim the free space themselves", () => {
  const source = rendererSource();
  // "1 1 auto" was this line for a while, and it is how the strip ended up
  // exactly zero pixels wide on a phone: it claims free space, but it also
  // gives up all of its own when there is none. A stated basis is the half
  // that was missing.
  assert.match(source, /\.tabs \{[^}]*flex:1 1 220px/);
});

// ── Search ─────────────────────────────────────────────────

test("searching dims what does not match instead of hiding it", () => {
  const view = panel();
  view._search = "one";
  assert.deepEqual([...view._matches], ["a:one"]);
  assert.match(view._nodeHtml(view._model.nodes[0]), /found/);
  assert.match(view._nodeHtml(view._model.nodes[1]), /dimmed/);
  assert.equal(view._visibleNodes.length, 2, "and everything is still drawn");
});

test("no search means no opinion", () => {
  assert.equal(panel()._matches, null);
});

// ── Undo ───────────────────────────────────────────────────

test("a drag can be taken back", async () => {
  const view = panel(model(), { edit: true, what: "icons" });
  const written = [];
  view._setLayout = SpatialHubPanel.prototype._setLayout;
  view._hass.callWS = async (message) => {
    written.push([message.section, message.key, message.values]);
    return {};
  };
  view._render = () => {};

  const target = element({ "data-node": "a:one" });
  view._onPointerDown(pointer(0, 0, { target: [target, stage()] }));
  view._onPointerMove(pointer(320, 480, { shift: true }));
  view._onPointerUp();
  await Promise.resolve();
  await view._undoStep();

  assert.deepEqual(written[0][2].position, { x: 0.32, y: 0.48 });
  assert.deepEqual(written[1][2].position, { x: 0.5, y: 0.5, z: 0 },
                   "back where it was");

  await view._redoStep();
  assert.deepEqual(written[2][2].position, { x: 0.32, y: 0.48 });
});

// ── The popup ──────────────────────────────────────────────

test("the popup opens in the middle, over the plan", () => {
  const view = panel();
  view._selected = { kind: "node", id: "a:one" };
  assert.match(view._popupHtml(), /class="popup centred"/);
});

test("the popup offers every door back into Home Assistant", () => {
  const data = model({
    nodes: [node("a:one", {
      entity_id: "light.kitchen",
      device_id: "dev1",
      entities: [{ entity_id: "light.kitchen", name: "Kitchen", state: "on" }],
    })],
    edges: [],
  });
  data.providers[0].panel_url = "/powerline";
  const view = panel(data);
  view._selected = { kind: "node", id: "a:one" };
  const html = view._popupHtml();
  assert.match(html, /data-more-info="light.kitchen"/, "more-info");
  assert.match(html, /\/config\/devices\/device\/dev1/, "the device page");
  assert.match(html, /data-toggle-entities/, "its entities");
  assert.match(html, /data-settings="light.kitchen"/, "settings");
  assert.match(html, /data-navigate="\/powerline"/, "the provider's own view");
});

test("a node with nothing behind it gets no dead links", () => {
  const view = panel();
  view._selected = { kind: "node", id: "a:one" };
  const html = view._popupHtml();
  assert.doesNotMatch(html, /data-navigate/);
  assert.doesNotMatch(html, /data-toggle-entities/);
});

test("the legend starts folded away", () => {
  const view = panel();

  assert.equal(view._legendOpen, false, "the house comes first, not its index");
  const closed = view._legendHtml();
  assert.match(closed, /data-legend/, "and there is a way to open it");
  assert.equal(
    /class="dock"/.test(closed), false,
    "nothing of the legend is rendered while it is closed",
  );

  view._legendOpen = true;
  assert.match(view._legendHtml(), /class="dock"/);
});

test("clicking the legend toggle opens and closes it", () => {
  const view = panel();
  let renders = 0;
  view._render = () => { renders += 1; };
  const toggle = {
    getAttribute: (name) => (name === "data-legend" ? "" : null),
  };
  const click = { composedPath: () => [toggle] };

  view._onClick(click);
  assert.equal(view._legendOpen, true);
  view._onClick(click);
  assert.equal(view._legendOpen, false);
  assert.equal(renders, 2, "each toggle redraws once");
});

/** A panel with a viewport of a known size and a canvas of another. */
function framed(view, { viewport = 1000, canvas = 1000 } = {}) {
  view._root = {
    querySelector(selector) {
      if (selector === ".canvas") {
        return {
          offsetWidth: canvas,
          offsetHeight: canvas,
          style: { setProperty() {} },
          getBoundingClientRect: () => ({ left: 0, top: 0 }),
        };
      }
      if (selector === ".viewport") {
        return {
          clientWidth: viewport,
          clientHeight: viewport,
          getBoundingClientRect: () => ({
            left: 0, top: 0, width: viewport, height: viewport,
          }),
        };
      }
      return null;
    },
  };
  return view;
}

test("the plan cannot be shoved out of the window", () => {
  const view = framed(panel());
  view._view = { zoom: 2, x: 0, y: 0 };

  // A drag far past the left edge: the plan's right edge may not come
  // inside the viewport, so x stops at viewport - scaled = -1000.
  view._view.x = -99999;
  view._view.y = -99999;
  view._applyCamera();
  assert.equal(view._view.x, -1000);
  assert.equal(view._view.y, -1000);

  // And the other way: the plan's top-left may not leave the corner.
  view._view.x = 99999;
  view._view.y = 99999;
  view._applyCamera();
  assert.equal(view._view.x, 0);
  assert.equal(view._view.y, 0);
});

test("a plan smaller than the window is centred in it", () => {
  // Drawn at 55 % in the top-left corner of a wide monitor it looks like
  // a rendering accident -- and there is nothing the user can do, because
  // there is no direction left to drag.
  const view = framed(panel(), { viewport: 1000, canvas: 1000 });
  view._view = { zoom: 0.5, x: -400, y: 900 };
  view._applyCamera();

  assert.equal(view._view.x, 250, "half the slack on either side");
  assert.equal(view._view.y, 250);
});

test("panning within the plan is left alone", () => {
  const view = framed(panel());
  view._view = { zoom: 2, x: -250, y: -600 };
  view._applyCamera();

  assert.deepEqual(view._view, { zoom: 2, x: -250, y: -600 });
});

test("zooming out from a corner pulls the plan back into view", () => {
  // Zoom in hard, drag to the far corner, then zoom out: without a clamp
  // the plan is left stranded off-screen with nothing on the stage.
  const view = framed(panel());
  view._view = { zoom: 4, x: -3000, y: -3000 };
  view._applyCamera();
  assert.equal(view._view.x, -3000, "still legal at 4x");

  view._zoomBy(0.25);
  assert.ok(view._view.x >= -0, "back against the edge once it fits");
  assert.ok(view._view.y >= -0);
});

test("no layout yet means nothing to clamp against", () => {
  const view = framed(panel(), { viewport: 0, canvas: 0 });
  view._view = { zoom: 1, x: -5000, y: 4000 };
  view._applyCamera();

  assert.deepEqual(view._view, { zoom: 1, x: -5000, y: 4000 },
    "guessing before first paint would be worse than waiting");
});

test("the floor tabs stay on one line however many storeys there are", () => {
  // A house with a dozen floors used to wrap the header into four rows,
  // so the tabs moved under the user between one render and the next.
  const source = rendererSource();
  const tabs = source.slice(source.indexOf(".tabs {"));
  assert.match(tabs.slice(0, 240), /flex-wrap:nowrap/, "one line, always");
  assert.match(tabs.slice(0, 240), /overflow-x:auto/, "and reachable sideways");
  assert.match(tabs, /\.tab \{[^}]*white-space:nowrap/s,
    "a floor name is not broken across lines either");
});

test("the selected floor is scrolled back into view", () => {
  const view = panel();
  let asked = null;
  view._root = {
    querySelector: (selector) =>
      selector === ".tab.on"
        ? { scrollIntoView: (options) => { asked = options; } }
        : null,
  };
  view._revealCurrentTab();

  assert.deepEqual(asked, { block: "nearest", inline: "nearest" },
    "nearest: bring it into the strip without yanking the page about");
});

test("no tab strip yet is not an error", () => {
  const view = panel();
  view._root = { querySelector: () => null };
  view._revealCurrentTab();
});

// ── Layer opacity ──────────────────────────────────────────

test("turning a layer down actually fades what it drew", () => {
  // The slider wrote its value into the layout and the value came back
  // in the model, and then nothing read it -- so it did nothing at all.
  const data = model();
  data.layers[0].opacity = 0.3;
  const view = panel(data);

  assert.equal(view._providerOpacity("a:one"), 0.3);
  assert.match(view._nodeHtml(view._visibleNodes[0]), /--layer-opacity:0\.3/);
  assert.match(view._edgeHtml(view._visibleEdges[0]), /--layer-opacity:0\.3/);
});

test("a layer nobody touched stays solid", () => {
  const view = panel();
  assert.equal(view._providerOpacity("a:one"), 1);
});

test("a provider is as solid as its clearest visible layer", () => {
  // Same shape as hiding: a provider disappears when *every* layer is
  // hidden, so it fades only when every layer is turned down.
  const data = model();
  data.layers[0].opacity = 0.2;
  data.layers.push({ id: "a_second", name: "A2", z_index: 20, opacity: 0.9,
                     visible: true, provider_id: "a" });
  const view = panel(data);

  assert.equal(view._providerOpacity("a:one"), 0.9);
});

test("a hidden layer does not drag its provider's opacity down", () => {
  const data = model();
  data.layers[0].opacity = 0.9;
  data.layers.push({ id: "a_second", name: "A2", z_index: 20, opacity: 0.1,
                     visible: false, provider_id: "a" });
  const view = panel(data);

  assert.equal(view._providerOpacity("a:one"), 0.9,
    "an invisible layer has no say in how solid the visible ones are");
});

test("an item whose provider has no layers is drawn normally", () => {
  const view = panel(model({ layers: [] }));
  assert.equal(view._providerOpacity("a:one"), 1);
  assert.equal(view._providerOpacity("nobody:x"), 1);
});

test("layer opacity and the search dimming multiply", () => {
  const source = rendererSource();
  // Inline opacity would beat a class outright, so a dimmed node in a
  // faded layer has to come out fainter than either on its own.
  assert.match(source, /\.node\.dimmed \{ opacity:calc\(var\(--layer-opacity,1\) \* \.25\)/);
  assert.match(source,
    /\.stack-node\.dimmed \{ opacity:calc\(var\(--layer-opacity,1\) \* \.25\)/);
});

test("the stacked view fades with the same rule", () => {
  const data = model();
  data.layers[0].opacity = 0.4;
  const view = panel(data, { floor: null });
  const html = view._stackHtml();

  assert.match(html, /--layer-opacity:0\.4/);
});

// ── Building alignment: the other storeys' outer walls ─────

const withOutlines = () =>
  model({
    floors: [
      { id: "eg", name: "Erdgeschoss", level: 0, icon: "",
        outline: { x: 0.1, y: 0.1, width: 0.8, height: 0.8 } },
      { id: "og", name: "Obergeschoss", level: 1, icon: "",
        outline: { x: 0.2, y: 0.2, width: 0.6, height: 0.6 } },
    ],
  });

test("the other storeys' walls appear while editing a floor", () => {
  const view = panel(withOutlines(), { edit: true, floor: "eg" });

  assert.deepEqual(view._ghostFloors().map((f) => f.id), ["og"],
    "the floor being edited is not its own ghost");
  const html = view._ghostsHtml();
  assert.match(html, /class="ghost"/);
  assert.match(html, /Obergeschoss/, "a line nobody can name is not a hint");
});

test("nothing haunts the plan outside edit mode", () => {
  const view = panel(withOutlines(), { edit: false, floor: "eg" });

  assert.deepEqual(view._ghostFloors(), [],
    "clutter over a plan nobody is changing");
});

test("the stacked view needs no ghosts -- it already stacks", () => {
  const view = panel(withOutlines(), { edit: true, floor: null });

  assert.deepEqual(view._ghostFloors(), []);
});

test("a floor with no building line casts no ghost", () => {
  const data = withOutlines();
  data.floors[1].outline = null;
  const view = panel(data, { edit: true, floor: "eg" });

  assert.deepEqual(view._ghostFloors(), [],
    "a storey with only a garden has no walls to line up against");
});

test("the cloud and the homeless storey are not part of the building", () => {
  const data = withOutlines();
  data.floors.push(
    { id: "_virtual", name: "Virtuell", virtual: true,
      outline: { x: 0, y: 0, width: 1, height: 1 } },
    { id: "_unassigned", name: "Ohne Etage", unassigned: true,
      outline: { x: 0, y: 0, width: 1, height: 1 } },
  );
  const view = panel(data, { edit: true, floor: "eg" });

  assert.deepEqual(view._ghostFloors().map((f) => f.id), ["og"]);
});

test("the ghosts can be switched off, and the button knows when to appear", () => {
  const view = panel(withOutlines(), { edit: true, floor: "eg" });
  assert.equal(view._ghosts, true, "on by default: the drift is the point");
  assert.equal(view._ghostFloorCount, 1);

  view._ghosts = false;
  assert.equal(view._ghostsHtml(), "");

  // A single-storey house has nothing to line up against, so no button.
  const alone = panel(
    model({ floors: [{ id: "eg", name: "Erdgeschoss", level: 0,
                       outline: { x: 0, y: 0, width: 1, height: 1 } }] }),
    { edit: true, floor: "eg" },
  );
  assert.equal(alone._ghostFloorCount, 0);
});

test("clicking the ghost toggle flips it", () => {
  const view = panel(withOutlines(), { edit: true, floor: "eg" });
  view._render = () => {};
  const toggle = {
    getAttribute: (name) => (name === "data-toggle-ghosts" ? "" : null),
  };

  view._onClick({ composedPath: () => [toggle] });
  assert.equal(view._ghosts, false);
  view._onClick({ composedPath: () => [toggle] });
  assert.equal(view._ghosts, true);
});

test("a ghost is placed through the same window as the rooms", () => {
  // With a garden the frame widens past 0..1; a building line drawn in
  // raw percentages would sit somewhere else than the rooms it describes.
  const data = withOutlines();
  data.areas[0].kind = "outdoor";
  const view = panel(data, { edit: true, floor: "eg" });
  const frame = view._frame;
  const html = view._ghostsHtml();

  const expected = ((0.2 - frame.min) / frame.span) * 100;
  assert.match(html, new RegExp(`left:${expected}%`));
});

// ── The building around the storeys ────────────────────────

test("nothing is drawn across the storeys any more", () => {
  // Translucent walls, a roof, corner posts: each of them spanned the
  // whole picture and lay over the plan. What holds the house together
  // now is the walls of the storeys themselves.
  const html = panel(model(), { floor: null })._stackHtml();

  assert.doesNotMatch(html, /shell-wall|shell-post|shell-roof/);
  assert.match(html, /shell-face/, "but every storey has its own outer wall");
  assert.match(html, /shell-cap/, "and that wall has two sides");
});

test("the outer wall is split around the rooms", () => {
  // All four faces in front and the back wall paints over the plan; all
  // four behind and the rooms sit on a slab shaped like a house instead
  // of standing inside one.
  const html = panel(model(), { floor: null })._stackHtml();
  const plane = html.slice(html.indexOf('<g class="plane">'));

  assert.ok(plane.indexOf("shell-face") < plane.indexOf("room-wall"),
            "the back wall is behind the rooms");
  assert.ok(plane.lastIndexOf("shell-face") > plane.indexOf("room-wall"),
            "the front wall is in front of them");
});

test("a storey stands on a slab instead of being a sheet of paper", () => {
  const view = panel(model(), { floor: null });
  const html = view._stackHtml();

  // One band per edge of the outline, and it hangs *below* the storey.
  const sides = [...html.matchAll(/class="storey-side" points="([^"]+)"/g)];
  assert.equal(sides.length, 8, "four edges on each of the two storeys");
  const [x0, y0, , , , y2] = sides[0][1]
    .split(/[ ,]/)
    .map(Number);
  assert.ok(y2 > y0, "the slab hangs down, it does not float up");
  assert.equal(typeof x0, "number");
});

test("a room has standing walls, a garden does not", () => {
  const data = model({
    areas: [
      { id: "wohnen", name: "Wohnen", floor_id: "eg", kind: "indoor",
        position: { x: 0.3, y: 0.4 }, size: { width: 0.3, height: 0.3 } },
      { id: "terrasse", name: "Terrasse", floor_id: "eg", kind: "outdoor",
        position: { x: 0.8, y: 0.4 }, size: { width: 0.2, height: 0.2 } },
    ],
  });
  const view = panel(data, { floor: null });

  const room = view._roomPolygon(0, data.areas[0]);
  const terrace = view._roomPolygon(0, data.areas[1]);

  assert.equal((room.match(/room-wall/g) || []).length, 4);
  assert.doesNotMatch(terrace, /room-wall/, "a terrace is not a room with a roof off");
});

test("rooms are drawn back to front, or the storey turns inside out", () => {
  // With height, whoever is drawn last is in front. Storage order is not
  // depth order, so the sandwich has to sort.
  const data = model({
    areas: [
      { id: "vorne", name: "Vorne", floor_id: "eg", kind: "indoor",
        position: { x: 0.5, y: 0.8 }, size: { width: 0.3, height: 0.2 } },
      { id: "hinten", name: "Hinten", floor_id: "eg", kind: "indoor",
        position: { x: 0.5, y: 0.2 }, size: { width: 0.3, height: 0.2 } },
    ],
  });
  const html = panel(data, { floor: null })._stackHtml();

  assert.ok(
    html.indexOf("Hinten") < html.indexOf("Vorne"),
    "the room at the back is painted first",
  );
});

test("a single storey is a house too", () => {
  // It used to get no body at all, because a shell around one sheet said
  // nothing that the sheet did not. Walls are not a shell -- a bungalow
  // has them.
  const data = model({
    floors: [{ id: "eg", name: "Erdgeschoss", level: 0, icon: "" }],
  });

  assert.match(panel(data, { floor: null })._stackHtml(), /shell-face/);
});

test("the wall is hung off the house, never off the garden", () => {
  // The apron reaches outside 0..1. A wall that followed it would put the
  // front door somewhere in the lawn.
  const view = panel(
    model({
      floors: [
        { id: "eg", name: "Erdgeschoss", level: 0, icon: "", has_outdoor: true },
        { id: "og", name: "Obergeschoss", level: 1, icon: "" },
      ],
    }),
    { floor: null },
  );
  const html = view._stackHtml();

  assert.equal((html.match(/class="shell-face"/g) || []).length, 8,
               "four faces on each of the two storeys");
  const house = view._project(0, 0, 0);
  assert.ok(html.includes(`points="${house.x},${house.y} `),
            "a face starts on the building line, not on the lawn");
});

test("only the ground floor gets grass, a balcony upstairs just gets a room", () => {
  // has_outdoor is true on both storeys -- eg for the garden, og for a
  // balcony -- but only eg is the actual ground. The balcony still has to
  // be editable and drawn as a room; it must not turn the whole first
  // floor into a second lawn.
  const data = model({
    floors: [
      { id: "eg", name: "Erdgeschoss", level: 0, icon: "",
        has_outdoor: true, outdoor_margin: 0.28, ground: true },
      { id: "og", name: "Obergeschoss", level: 1, icon: "",
        has_outdoor: true, outdoor_margin: 0.28 },
    ],
    areas: [
      { id: "garten", name: "Garten", floor_id: "eg", kind: "outdoor",
        position: at(1.15, 0.5), size: { width: 0.2, height: 0.6 } },
      { id: "balkon", name: "Balkon", floor_id: "og", kind: "outdoor",
        position: at(1.15, 0.5), size: { width: 0.2, height: 0.3 } },
    ],
  });
  const html = panel(data, { floor: null })._stackHtml();
  const planes = html.split('class="plane').slice(1);
  // Der Etagenname steht in Versalien im Rand, wie in einer
  // Schnittzeichnung -- danach wird hier gesucht.
  const eg = planes.find((plane) => plane.includes("ERDGESCHOSS"));
  const og = planes.find((plane) => plane.includes("OBERGESCHOSS"));

  assert.match(eg, /class="apron"/, "the ground floor gets the field");
  assert.doesNotMatch(og, /class="apron"/, "the storey above does not");
  assert.match(og, /Balkon/, "the balcony is still drawn as a room");
});

test("a balcony gets a railing to see over, not a wall to hide behind", () => {
  // Ein Zimmer muss mit im Modell stehen: ohne eines gaebe es ohnehin
  // keine einzige room-wall und die letzte Zusicherung waere geschenkt.
  const data = model({
    areas: [
      { id: "wohnzimmer", name: "Wohnzimmer", floor_id: "og",
        position: at(0.3, 0.5), size: { width: 0.4, height: 0.6 } },
      { id: "balkon", name: "Balkon", floor_id: "og", kind: "outdoor",
        position: at(0.85, 0.5), size: { width: 0.2, height: 0.6 } },
    ],
  });
  const html = panel(data, { floor: null })._stackHtml();

  assert.match(html, /class="room deck"/, "the deck floor is marked as one");
  assert.match(html, /class="deck-rail"/, "a low rail stands on it");
  assert.match(html, /class="room-wall"/, "the room next to it still has walls");
  // Vier Wandflaechen, und zwar die des Wohnzimmers: haette der Balkon
  // welche beigesteuert, stuenden hier acht.
  assert.equal((html.match(/class="room-wall"/g) || []).length, 4,
               "the balcony contributed no masonry of its own");
});

const walled = (area) =>
  ((panel(model({ areas: [area] }), { floor: null })._stackHtml()
    .match(/class="room-wall"/g)) || []).length;

const roomWith = (doors) => ({
  id: "r", name: "Raum", floor_id: "eg",
  position: at(0.5, 0.5), size: { width: 0.4, height: 0.4 }, doors,
});

test("a door is a gap in a wall, not a wall with a door drawn on it", () => {
  // Vier Wandflaechen ohne Tuer. Eine Tuer mitten in einer Wand laesst
  // links und rechts je ein Stueck stehen -- also fuenf.
  assert.equal(walled(roomWith(undefined)), 4, "no doors, four walls");
  assert.equal(walled(roomWith([{ side: 0, at: 0.5, width: 0.2 }])), 5,
               "a door in the middle leaves a wall either side");
});

test("a door at the very end of a wall leaves only one stretch", () => {
  // Am Anfang der Kante gibt es kein Stueck davor, das stehen bleiben
  // koennte -- sonst stuende dort eine Wand der Laenge null.
  assert.equal(walled(roomWith([{ side: 0, at: 0, width: 0.2 }])), 4,
               "flush with the corner, so nothing before it");
  assert.equal(walled(roomWith([{ side: 0, at: 1, width: 0.2 }])), 4,
               "and the same at the other corner");
});

test("two doors that touch are one opening, not two", () => {
  // Ueberlappende Oeffnungen duerfen kein Wandstueck negativer Laenge
  // zwischen sich erzeugen.
  assert.equal(
    walled(roomWith([
      { side: 0, at: 0.4, width: 0.2 },
      { side: 0, at: 0.5, width: 0.2 },
    ])),
    5,
    "one merged gap, so one wall either side",
  );
  // Und in verkehrter Reihenfolge dasselbe: gespeichert wird in der
  // Reihenfolge, in der jemand sie angelegt hat, und das ist keine.
  assert.equal(
    walled(roomWith([
      { id: "b", side: 0, at: 0.5, width: 0.2 },
      { id: "a", side: 0, at: 0.4, width: 0.2 },
    ])),
    5,
    "the order they were stored in must not matter",
  );
});

test("a door on a wall that does not exist is left out, not guessed", () => {
  for (const door of [
    { side: 9, at: 0.5, width: 0.2 },
    { side: -1, at: 0.5, width: 0.2 },
    { side: 1.5, at: 0.5, width: 0.2 },
    { side: 0, at: 0.5, width: 0 },
    { side: 0, at: "irgendwo", width: 0.2 },
  ]) {
    assert.equal(walled(roomWith([door])), 4,
                 `nonsense is dropped: ${JSON.stringify(door)}`);
  }
});

test("a doorway goes through the masonry, not just its outside face", () => {
  // Wand und Mauerkrone muessen dieselbe Luecke haben. Nur die Aussenseite
  // zu unterbrechen liesse eine Tuer entstehen, ueber der die Krone
  // durchlaeuft -- das waere ein Fenster, und zwar ein zugemauertes.
  const html = panel(model({ areas: [roomWith([{ side: 0, at: 0.5, width: 0.2 }])] }),
                     { floor: null })._stackHtml();
  assert.equal((html.match(/class="room-wall"/g) || []).length, 5, "wall split");
  assert.equal((html.match(/class="room-cap"/g) || []).length, 5, "crown split too");
});

test("the outer shell of the house is unaffected by a room's doors", () => {
  // wallsOf zeichnet auch die Aussenwaende. Die kennen keine Tueren und
  // duerfen von dieser Aenderung nichts merken.
  const html = panel(model({ areas: [roomWith([{ side: 0, at: 0.5, width: 0.2 }])] }),
                     { floor: null })._stackHtml();
  assert.equal((html.match(/class="shell-face"/g) || []).length, 8,
               "four faces on each of the two storeys, as before");
});

/** Der Raumdialog, offen, mit einem Raum darin. */
const withDialog = (doors) => {
  const area = { id: "r", name: "Raum", floor_id: "eg",
                 position: at(0.5, 0.5), size: { width: 0.4, height: 0.4 },
                 doors };
  const view = panel(model({ areas: [area] }));
  view._areaDialog = "r";
  return view;
};

/** Was `_setDoors` zuletzt schreiben wollte. */
const written = (view) => {
  const last = view._written[view._written.length - 1];
  return last && last[2].doors;
};

test("the dialog offers a door per wall, and only for rooms", () => {
  assert.match(withDialog()._areaDialogHtml(), /data-door-add="0"/);
  assert.match(withDialog()._areaDialogHtml(), /data-door-add="3"/);
  assert.doesNotMatch(withDialog()._areaDialogHtml(), /data-door-add="4"/,
                      "a rectangle has four walls, not five");

  // Ein Garten hat keine Waende, in die eine Luecke passen koennte.
  const garden = { id: "g", name: "Garten", floor_id: "eg", kind: "outdoor",
                   position: at(1.2, 0.5), size: { width: 0.2, height: 0.4 } };
  const view = panel(model({ areas: [garden] }));
  view._areaDialog = "g";
  assert.doesNotMatch(view._areaDialogHtml(), /data-door-add/,
                      "no doors in a garden");
});

test("adding a door puts it in the middle of the wall you picked", () => {
  const view = withDialog();
  view._onClick({ composedPath: () => [element({ "data-door-add": "2" })] });
  assert.deepEqual(written(view),
                   [{ side: 2, at: 0.5, width: 0.2, kind: "door" }]);
});

test("ein Fenster wird als Fenster angelegt, nicht als Tuer", () => {
  const view = withDialog();
  view._onClick({ composedPath: () => [
    element({ "data-door-add": "2", "data-add-kind": "window" }),
  ] });
  const [fenster] = written(view);
  assert.equal(fenster.kind, "window");
  // Breiter als eine Tuer: ein Fenster von Tuerbreite sieht aus wie eine
  // Tuer, der jemand eine Bruestung eingezogen hat.
  assert.ok(fenster.width > 0.2, `nur ${fenster.width} breit`);
});

test("a second door is added, not swapped for the first", () => {
  const view = withDialog([{ side: 0, at: 0.3, width: 0.2 }]);
  view._onClick({ composedPath: () => [element({ "data-door-add": "1" })] });
  assert.deepEqual(written(view), [
    { side: 0, at: 0.3, width: 0.2, kind: "door" },
    { side: 1, at: 0.5, width: 0.2, kind: "door" },
  ]);
});

test("removing a door takes out the one that was clicked", () => {
  const view = withDialog([
    { side: 0, at: 0.3, width: 0.2 },
    { side: 1, at: 0.4, width: 0.2 },
    { side: 2, at: 0.5, width: 0.2 },
  ]);
  view._onClick({ composedPath: () => [element({ "data-door-remove": "1" })] });
  assert.deepEqual(written(view), [
    { side: 0, at: 0.3, width: 0.2, kind: "door" },
    { side: 2, at: 0.5, width: 0.2, kind: "door" },
  ]);
});

test("eine Tuer wird zum Fenster, ohne ihre Stelle zu verlieren", () => {
  // Umschalten statt loeschen und neu setzen: die Stelle, die jemand
  // ausgesucht hat, ist die Arbeit daran.
  const view = withDialog([{ side: 1, at: 0.27, width: 0.22 }]);
  view._onClick({ composedPath: () => [
    element({ "data-opening-kind": "window", "data-door": "0" }),
  ] });
  assert.deepEqual(written(view),
                   [{ side: 1, at: 0.27, width: 0.22, kind: "window" }]);
});

test("ein Regler macht aus einem Fenster keine Tuer", () => {
  // Der stille Fall: die Art fehlte in `_setDoors`, also verlor jedes
  // Fenster sie, sobald jemand irgendetwas anderes am Raum aenderte.
  const view = withDialog([{ side: 0, at: 0.3, width: 0.3, kind: "window" }]);
  const input = element({ "data-door-field": "at", "data-door": "0" });
  input.value = "0.6";
  view._onInput({ composedPath: () => [input], target: input }, true);

  assert.equal(written(view)[0].kind, "window");
});

test("a slider writes when it is let go, not on every pixel", () => {
  const drag = (committed) => {
    const view = withDialog([{ side: 0, at: 0.3, width: 0.2 }]);
    const input = element({ "data-door-field": "at", "data-door": "0" });
    input.value = "0.75";
    view._onInput({ composedPath: () => [input], target: input }, committed);
    return view;
  };
  assert.equal(drag(false)._written.length, 0, "still dragging, nothing saved");
  assert.deepEqual(written(drag(true)),
                   [{ side: 0, at: 0.75, width: 0.2, kind: "door" }],
                   "let go, and the new position is stored");
});

// ── Oeffnungen, wo man sie setzt ──────────────────────────
//
// Der eigentliche Fehler an den Tueren: sie wurden nur in der
// Hausansicht gezeichnet. Angelegt werden sie in der Einzelansicht --
// man klickte also "+ hinten", schob zwei Regler, und auf dem Bild
// passierte nichts. Eine Oeffnung, die man beim Setzen nicht sieht,
// kann man auch nicht setzen.

/** Ein Raum mit Oeffnungen, in der Einzelansicht. */
const withOpenings = (doors, options = {}) =>
  panel(
    model({
      areas: [
        { id: "r", name: "Raum", floor_id: "eg", position: at(0.5, 0.5),
          size: { width: 0.4, height: 0.4 }, doors, auto: false },
      ],
    }),
    { edit: true, ...options },
  );

test("eine Oeffnung ist im Grundriss zu sehen, nicht nur im Haus", () => {
  const html = withOpenings([{ side: 0, at: 0.3, width: 0.2 }])._stageHtml();

  assert.match(html, /class="opening door /, "die Tuer steht im Grundriss");
  assert.match(html, /data-opening="r"/);
  assert.match(html, /data-opening-index="0"/);
});

test("Tuer und Fenster sind im Grundriss zu unterscheiden", () => {
  const html = withOpenings([
    { side: 0, at: 0.3, width: 0.2 },
    { side: 1, at: 0.6, width: 0.3, kind: "window" },
  ])._stageHtml();

  assert.match(html, /class="opening door /);
  assert.match(html, /class="opening window /);
});

test("eine Oeffnung liegt auf ihrer eigenen Kante", () => {
  // Kante 0 und 2 laufen waagerecht, 1 und 3 senkrecht. Eine Tuer an der
  // rechten Wand, die die halbe Breite des Kastens einnimmt, sitzt an der
  // falschen Wand -- und zwar so, dass es niemandem auffaellt, der nur
  // die Zahlen liest.
  const oben = withOpenings([{ side: 0, at: 0.5, width: 0.2 }])._stageHtml();
  const rechts = withOpenings([{ side: 1, at: 0.5, width: 0.2 }])._stageHtml();

  assert.match(oben, /top:-3px;left:40\.00%;width:20\.00%/);
  assert.match(rechts, /right:-3px;top:40\.00%;height:20\.00%/);
});

test("ein Garten hat keine Oeffnungen", () => {
  const view = panel(
    model({
      areas: [
        { id: "g", name: "Garten", floor_id: "eg", kind: "outdoor",
          position: at(1.2, 0.5), size: { width: 0.2, height: 0.4 },
          doors: [{ side: 0, at: 0.5, width: 0.2 }] },
      ],
    }),
    { edit: true },
  );
  assert.doesNotMatch(view._stageHtml(), /class="opening/);
});

test("ein Klick auf eine Wand setzt dort eine Tuer", () => {
  // Der uebliche Fall ist "hier soll eine Tuer hin". Ueber den Dialog
  // waren das Zahnrad, ans Ende scrollen, "+ hinten", schieben, schieben.
  const view = withOpenings();
  const box = { left: 0, top: 0, width: 1000, height: 1000 };
  const st = stage();
  st.getBoundingClientRect = () => box;
  // Der Raum liegt auf 0.3..0.7 in beiden Achsen, das Fenster auf 0..1:
  // ein Klick auf x=0.6, y=0.31 trifft die hintere Wand bei 3/4.
  view._onClick({
    altKey: false,
    clientX: 600, clientY: 310,
    composedPath: () => [element({ "data-area": "r" }), st],
  });

  const [tuer] = view._written[view._written.length - 1][2].doors;
  assert.equal(tuer.side, 0, "die hintere Wand");
  assert.ok(Math.abs(tuer.at - 0.75) < 0.06, `bei ${tuer.at}`);
});

test("ein Klick mitten in den Raum setzt keine Tuer", () => {
  // Sonst bekaeme jedes Verschieben, das kein Verschieben wurde, eine
  // Tuer geschenkt.
  const view = withOpenings();
  const st = stage();
  view._onClick({
    altKey: false,
    clientX: 500, clientY: 500,
    composedPath: () => [element({ "data-area": "r" }), st],
  });

  assert.equal(
    view._written.filter((entry) => entry[2] && entry[2].doors).length, 0);
});

test("ein Griff am Rand bekommt keine Tuer geschenkt", () => {
  // Die acht Griffe sitzen genau dort, wo auch die Waende sind. Wer
  // einen antippt statt ihn zu ziehen, meint den Griff.
  const view = withOpenings();
  const st = stage();
  // Ein Klick auf ein Geraet waehlt es aus, und Auswaehlen zeichnet neu.
  // Ohne DOM gibt es nichts zu zeichnen -- und geprueft wird hier, was
  // *nicht* geschrieben wird, nicht was gezeichnet wird.
  view._render = () => {};
  // Nur die, die wirklich bis hierher durchfallen. Das Zahnrad und das
  // Auge verbraucht `_clickAreaDialog` weiter oben in der Kette -- sie
  // hier zu pruefen hiesse, die Reihenfolge zu pruefen und nicht die
  // Absicherung.
  for (const attribute of ["data-resize-area", "data-corner-area",
                           "data-node"]) {
    view._onClick({
      altKey: false,
      clientX: 600, clientY: 310,
      composedPath: () => [
        element({ [attribute]: "r" }), element({ "data-area": "r" }), st,
      ],
    });
  }

  assert.equal(
    view._written.filter((entry) => entry[2] && entry[2].doors).length, 0);
});

test("Alt auf einer Oeffnung entfernt sie", () => {
  const view = withOpenings([
    { side: 0, at: 0.3, width: 0.2 },
    { side: 1, at: 0.6, width: 0.2 },
  ]);
  view._onClick({
    altKey: true,
    composedPath: () => [
      element({ "data-opening": "r", "data-opening-index": "0" }),
      stage(),
    ],
  });

  const doors = view._written[view._written.length - 1][2].doors;
  assert.equal(doors.length, 1);
  assert.equal(doors[0].side, 1);
});

test("eine Oeffnung laeuft auf ihrer Wand und verlaesst sie nicht", () => {
  const view = withOpenings([{ side: 0, at: 0.5, width: 0.2 }]);
  const grip = element({ "data-opening": "r", "data-opening-index": "0" });
  view._onPointerDown(pointer(500, 300, { target: [grip, stage()] }));
  // Weit ueber die rechte Ecke hinaus gezogen.
  view._onPointerMove(pointer(5000, 300));
  view._onPointerUp(pointer(5000, 300));

  const [tuer] = view._written[view._written.length - 1][2].doors;
  assert.equal(tuer.side, 0, "die Wand bleibt dieselbe");
  assert.ok(tuer.at <= 0.9 + 1e-9, `${tuer.at} ragt in die Nachbarwand`);
  assert.ok(tuer.at >= 0.1 - 1e-9, `${tuer.at} ragt in die Nachbarwand`);
});

// ── Wie eine Oeffnung im Haus aussieht ────────────────────

test("eine Tuer ist eine Luecke, ein Fenster nicht", () => {
  // Der Unterschied, um den es geht: die Wand hoert vor einer Tuer auf
  // und faengt dahinter wieder an. Unter einem Fenster laeuft sie durch
  // -- eine Wand, die unter dem Fenster aufhoert, ist eine Tuer.
  const runs = (doors) => geometry.wallRuns(doors, 0);

  assert.deepEqual(runs([]), [[0, 1]], "keine Oeffnung, eine ganze Wand");
  assert.equal(runs([{ side: 0, at: 0.5, width: 0.2 }]).length, 2,
               "die Tuer teilt die Wand");
  assert.deepEqual(runs([{ side: 0, at: 0.5, width: 0.2, kind: "window" }]),
                   [[0, 1]], "das Fenster teilt sie nicht");
});

test("eine Tuer bekommt ihren Schwenk, ein Fenster seine Bruestung", () => {
  const ecken = [
    { x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 },
  ];
  const marks = (kind) =>
    geometry.openingMarksOf(ecken, 26,
                            [{ side: 0, at: 0.5, width: 0.3, kind }]);

  assert.match(marks("door"), /class="door-swing"/);
  assert.doesNotMatch(marks("door"), /window/);
  assert.match(marks("window"), /class="window-pane"/);
  assert.match(marks("window"), /class="window-bar"/);
  assert.doesNotMatch(marks("window"), /door-swing/);
});

test("der Schwenk zeigt in den Raum, nicht aus ihm heraus", () => {
  // Nach aussen geschwenkt haengt das Tuerblatt im Nachbarraum, und bei
  // einer Aussenwand in der Luft.
  const ecken = [
    { x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 },
  ];
  // Hintere Wand: "innen" ist nach unten, also groesseres y.
  const pfad = geometry.openingMarksOf(ecken, 0,
                                       [{ side: 0, at: 0.5, width: 0.4 }]);
  const [, blattY] = pfad.match(/L[\d.]+,([\d.-]+)/);

  assert.ok(Number(blattY) > 0, `Blatt bei y=${blattY} liegt ausserhalb`);
});

test("eine Oeffnung ohne Breite bekommt kein Zeichen", () => {
  // Unter einem Pixel ist der Kreis ein Punkt und der Bogen ein Fehler
  // im SVG.
  const ecken = [
    { x: 0, y: 0 }, { x: 2, y: 0 }, { x: 2, y: 2 }, { x: 0, y: 2 },
  ];
  assert.equal(
    geometry.openingMarksOf(ecken, 26, [{ side: 0, at: 0.5, width: 0.05 }]),
    "");
});

test("a staircase is drawn as steps, by whatever the user called it", () => {
  const stair = (id, name, icon = "") => ({
    id, name, icon, floor_id: "eg",
    position: at(0.5, 0.5), size: { width: 0.1, height: 0.4 },
  });
  const treads = (area) =>
    ((panel(model({ areas: [area] }), { floor: null })._stackHtml()
      .match(/class="tread"/g)) || []).length;

  // Acht Striche fuer neun Stufen: die Kanten sind die Wandenden.
  assert.equal(treads(stair("t", "Treppe")), 8, "German, plainly");
  assert.equal(treads(stair("t", "Treppenhaus")), 8, "and as a compound");
  assert.equal(treads(stair("t", "Stairs")), 8, "English too");
  assert.equal(treads(stair("t", "Diele", "mdi:stairs")), 8,
               "or said with the icon rather than the name");
  assert.equal(treads(stair("t", "Wohnzimmer")), 0, "a living room is not one");
});

test("a garden called Treppe still gets no steps", () => {
  // Aussen und Virtuell haben keine Stufen -- eine Gartentreppe ist
  // Gelaende, kein Bauteil, und die Wolke schon gar nicht.
  const outside = {
    id: "gt", name: "Treppe", floor_id: "eg", kind: "outdoor",
    position: at(1.15, 0.5), size: { width: 0.1, height: 0.4 },
  };
  const html = panel(model({ areas: [outside] }), { floor: null })._stackHtml();
  assert.doesNotMatch(html, /class="tread"/, "no steps outdoors");
});

test("the lawn is not a balcony: no railing around the garden", () => {
  // Erdgeschoss-Aussenflaeche ist Grundstueck, kein Anbau. Ein Gelaender
  // um den Rasen sagt das Gegenteil von dem, was ein Garten ist.
  const data = model({
    floors: [
      { id: "eg", name: "Erdgeschoss", level: 0, icon: "", ground: true,
        has_outdoor: true, outdoor_margin: 0.28 },
    ],
    areas: [
      { id: "garten", name: "Garten", floor_id: "eg", kind: "outdoor",
        position: at(1.15, 0.5), size: { width: 0.2, height: 0.6 } },
    ],
  });
  const html = panel(data, { floor: null })._stackHtml();

  assert.doesNotMatch(html, /class="deck-rail"/, "no railing round the lawn");
  assert.doesNotMatch(html, /class="room deck"/, "and it is not a deck either");
  assert.match(html, /Garten/, "the garden is still drawn");
});

test("das Erdreich bekommt keine Waende", () => {
  // The internet has no masonry. Und eine Etage, auf der ausser dem
  // Anschluss nichts liegt, ist trotzdem eine Etage -- die Waende
  // gehoeren ihr, nicht dem, was im Ring darum liegt.
  const data = model({
    floors: [{ id: "eg", name: "Erdgeschoss", level: 0, icon: "",
               has_outdoor: true, has_soil: true }],
    areas: [
      { id: "lan", name: "LAN", floor_id: "eg", kind: "virtual",
        position: at(0.5, -0.14), size: { width: 0.3, height: 0.2 } },
    ],
  });
  const html = panel(data, { floor: null })._stackHtml();

  assert.equal((html.match(/class="shell-face"/g) || []).length, 4,
               "one real storey, one set of walls");
  assert.doesNotMatch(html, /class="room-wall"/, "und kein Mauerwerk im Boden");
});

// ── Beschriftungen, die sich nicht decken ─────────────────
//
// Zwei Namen an derselben Stelle sind schlechter als einer: man liest
// keinen von beiden. Vorher gab es dagegen nur eine Pauschale -- mehr
// als fuenf Geraete auf einer Ebene, und alle Namen verschwanden bis
// zum Darueberfahren. Gezaehlt wurde, nicht nachgesehen.

const label = (x, y, text, extra = {}) =>
  ({ x, y, text, size: 16, scale: 1, ...extra });

test("was sich nicht deckt, wird nicht angefasst", () => {
  const [a, b] = geometry.declutter([
    label(0, 0, "Bad"), label(500, 500, "Küche"),
  ]);

  assert.deepEqual(a, { shift: 0, hidden: false });
  assert.deepEqual(b, { shift: 0, hidden: false });
});

test("zwei Namen an derselben Stelle weichen einander aus", () => {
  const [a, b] = geometry.declutter([
    label(100, 100, "Wohnzimmer"), label(100, 100, "Wohnzimmer"),
  ]);

  assert.equal(a.shift, 0, "der erste bleibt");
  assert.notEqual(b.shift, 0, "der zweite geht aus dem Weg");
  assert.equal(b.hidden, false);
  // Und zwar wirklich aus dem Weg: die Kaesten duerfen sich danach
  // nicht mehr schneiden.
  const box = (l, shift) => geometry.labelBox(l, shift);
  const erste = box(label(100, 100, "Wohnzimmer"), a.shift);
  const zweite = box(label(100, 100, "Wohnzimmer"), b.shift);
  assert.ok(erste.y1 <= zweite.y0 || zweite.y1 <= erste.y0,
            "sie liegen immer noch uebereinander");
});

test("ein Raumname steht, wo er steht", () => {
  // Ihn zu verschieben hiesse, ihn ueber die Wand des Nachbarn zu
  // schieben -- und damit in einen Raum, der anders heisst.
  const [raum, geraet] = geometry.declutter([
    label(100, 100, "Wohnzimmer", { fixed: true }),
    label(100, 100, "Adapter"),
  ]);

  assert.equal(raum.shift, 0);
  assert.notEqual(geraet.shift, 0);
});

test("der feste Name gewinnt, auch wenn er hinten in der Liste steht", () => {
  // Sonst weicht ein Geraetename einem Raumnamen aus, der erst danach
  // dazukommt -- und landet dabei womoeglich auf einem dritten.
  const [geraet, raum] = geometry.declutter([
    label(100, 100, "Adapter"),
    label(100, 100, "Wohnzimmer", { fixed: true }),
  ]);

  assert.equal(raum.shift, 0);
  assert.notEqual(geraet.shift, 0);
});

test("ausgewichen wird nach unten und nach oben", () => {
  // Nur nach unten waere eine Reihe von fuenf Geraeten am Ende eine
  // Spalte, die aus dem Geschoss herauslaeuft.
  const platz = geometry.declutter(
    Array.from({ length: 5 }, () => label(100, 100, "Adapter")),
  );
  const nach = platz.map((p) => p.shift).filter((shift) => shift !== 0);

  assert.ok(nach.some((shift) => shift > 0), "einer nach unten");
  assert.ok(nach.some((shift) => shift < 0), "einer nach oben");
});

test("was keinen Platz findet, wird weggeblendet statt danebengesetzt", () => {
  // Ein Name drei Zeilen neben seinem Punkt beschriftet nichts mehr, er
  // behauptet nur noch etwas.
  const platz = geometry.declutter(
    Array.from({ length: 40 }, () => label(100, 100, "Adapter Wohnzimmer")),
  );

  assert.ok(platz.some((p) => p.hidden), "irgendwann ist Schluss");
  assert.equal(platz[0].hidden, false, "aber nicht beim ersten");
});

test("dasselbe Bild kommt zweimal gleich heraus", () => {
  // Die Reihenfolge im Modell ist keine Reihenfolge. Ohne eine eigene
  // waere jedes Neuzeichnen ein anderes Bild.
  const labels = [
    label(100, 100, "Adapter"), label(100, 104, "Sensor"),
    label(102, 100, "Licht"), label(100, 100, "Wohnzimmer", { fixed: true }),
  ];
  assert.deepEqual(geometry.declutter(labels), geometry.declutter(labels));
});

test("die Hausansicht setzt keine zwei Namen aufeinander", () => {
  // Der Fall aus dem echten Bild: "Adapter Arbeitszimmer" lag quer ueber
  // "Kinderzimmer", weil der Geraetename unter seinem Punkt haengt und
  // der Raumname davor im hinteren Drittel steht.
  const dicht = model({
    floors: [{ id: "eg", name: "Erdgeschoss", level: 0, icon: "" }],
    areas: [
      { id: "a", name: "Arbeitszimmer", floor_id: "eg",
        position: at(0.4, 0.4), size: { width: 0.7, height: 0.7 } },
    ],
    nodes: [
      // Drei Geraete fast aufeinander, und der Raumname darueber. Ohne
      // Entzerren liegen alle vier Namen im selben Fleck -- genau der
      // Fall, den das echte Bild gezeigt hat.
      node("p:1", { area_id: "a", floor_id: "eg", label: "Adapter Arbeitszimmer",
                    position: at(0.4, 0.4) }),
      node("p:2", { area_id: "a", floor_id: "eg", label: "Thermostat",
                    position: at(0.41, 0.4) }),
      node("p:3", { area_id: "a", floor_id: "eg", label: "Deckenlicht",
                    position: at(0.4, 0.41) }),
    ],
  });
  const html = panel(dicht, { floor: null })._stackHtml();

  // Die Namen samt Stelle aus dem gezeichneten SVG zurueckholen und
  // nachrechnen -- geprueft wird das Bild, nicht die Absicht.
  const boxes = [];
  const g = /<g[^>]*data-at-x="([\d.eE+-]+)"[^>]*data-at-y="([\d.eE+-]+)"[^>]*>([\s\S]*?)<\/g>/g;
  let m;
  while ((m = g.exec(html))) {
    const raum = m[3].match(/class="room-label">([^<]*)</);
    const dot = m[3].match(/class="stack-label" y="([\d.-]+)">([^<]*)</);
    if (raum) {
      boxes.push(geometry.labelBox(
        { x: +m[1], y: +m[2], text: raum[1], size: 16 }));
    } else if (dot) {
      boxes.push(geometry.labelBox(
        { x: +m[1], y: +m[2] + Number(dot[1]), text: dot[2], size: 18 }));
    }
  }

  assert.equal(boxes.length, 4, "ein Raum, drei Geraete");
  for (let i = 0; i < boxes.length; i += 1) {
    for (let j = i + 1; j < boxes.length; j += 1) {
      const a = boxes[i], b = boxes[j];
      assert.ok(
        !(a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1),
        `zwei Namen liegen aufeinander: ${JSON.stringify(a)} ${JSON.stringify(b)}`,
      );
    }
  }
});

test("kein sichtbarer Name liegt auf einem fremden Geraetesymbol", () => {
  // Das Entzerren kannte nur Text. Ein Punkt sagt aber, wo etwas *ist*
  // -- er belegt Platz im Bild und laesst sich nicht verschieben. Am
  // Demohaus lagen deshalb sechs Beschriftungen unter einem fremden
  // Symbol, "Dielenlicht" auf 31x22 Bildpunkten.
  //
  // Sechzehn Geraete in einem Raum: dicht genug, dass Ausweichen allein
  // nicht reicht. Was dann keinen Platz findet, wird weggeblendet -- das
  // ist die Regel von nebenan, und sie sagt die Wahrheit: Der Name war
  // vorher auch nicht zu lesen, er hat es nur nicht zugegeben.
  const dicht = model({
    floors: [{ id: "eg", name: "Erdgeschoss", level: 0, icon: "" }],
    areas: [{ id: "r", name: "Raum", floor_id: "eg",
              position: at(0.5, 0.5), size: { width: 1, height: 1 } }],
    nodes: Array.from({ length: 16 }, (unused, i) =>
      node(`p:${i}`, {
        area_id: "r", floor_id: "eg", label: `Geraet ${i}`,
        position: at(0.2 + 0.6 * ((i % 4) / 3),
                     0.2 + 0.6 * (Math.floor(i / 4) / 3)),
      })),
  });
  const html = panel(dicht, { floor: null })._stackHtml();

  // Punkt, Beschriftung und Sichtbarkeit aus dem gezeichneten SVG.
  const nodes = [...html.matchAll(
    /<g class="stack-node([^"]*)"[\s\S]*?data-at-x="([\d.eE+-]+)"\s+data-at-y="([\d.eE+-]+)"\s+transform="translate\([^)]*\) scale\(([\d.]+)\)">\s*<circle[\s\S]*?<text class="stack-label" y="([\d.-]+)">([^<]*)</g,
  )].map((m) => ({
    hidden: /crowded/.test(m[1]),
    x: +m[2], y: +m[3], scale: +m[4],
    label: geometry.labelBox({
      x: +m[2], y: +m[3] + Number(m[5]) * (+m[4]),
      text: m[6], size: 18, scale: +m[4],
    }),
  }));
  assert.equal(nodes.length, 16, "das SVG wurde nicht richtig gelesen");

  const auf = [];
  nodes.forEach((one, i) => {
    if (one.hidden) return;               // weggeblendet ist nicht sichtbar
    nodes.forEach((other, j) => {
      if (i === j) return;                // das eigene Symbol haengt daran
      const r = geometry.PIN.size * other.scale / 2;
      const box = one.label;
      if (box.x0 < other.x + r && other.x - r < box.x1 &&
          box.y0 < other.y + r && other.y - r < box.y1) {
        auf.push(`${i} auf dem Symbol von ${j}`);
      }
    });
  });
  assert.deepEqual(auf, [], `Namen auf fremden Symbolen: ${auf.join(", ")}`);
});

test("ein Kasten darf auch etwas sein, das kein Text ist", () => {
  // Ohne diesen Weg konnte das Entzerren nur Beschriftungen kennen, und
  // ein Geraetesymbol war fuer es nicht vorhanden.
  const box = geometry.labelBox(
    { x: 100, y: 100, width: 30, height: 30 });
  assert.deepEqual(box, { x0: 85, x1: 115, y0: 85, y1: 115 });
});

test("das Raster laesst sich ohne Tastatur abschalten", () => {
  // Die Vision sagt: einfach genug fuer ein Kind. Ein Kind sitzt am
  // Tablet, und ein Tablet hat keine Umschalttaste. `shiftKey` ist auf
  // einem Zeigerereignis aus einem Finger immer falsch -- das Raster war
  // dort also gar nicht abschaltbar, und der Hinweis nannte es trotzdem.
  const view = panel(model(), { floor: null });
  const finger = {};                       // kein shiftKey, wie bei Beruehrung

  assert.equal(view._noSnap(finger), false, "die Vorbedingung stimmt nicht");
  view._snapOff = true;
  assert.equal(view._noSnap(finger), true, "der Knopf schaltet das Raster nicht ab");
});

test("die Umschalttaste bleibt, sie ist nur nicht mehr der einzige Weg", () => {
  // Wer eine Tastatur hat, will sie nicht gegen einen Knopf tauschen.
  const view = panel(model(), { floor: null });
  assert.equal(view._noSnap({ shiftKey: true }), true);
  assert.equal(view._noSnap({ shiftKey: false }), false);
});

test("der Hinweis nennt keine Taste, die es auf diesem Geraet nicht gibt", () => {
  // Hier stand "Shift haelt gedrueckt das Raster aus" -- schiefes Deutsch,
  // und auf einem Tablet dazu eine Anleitung ins Leere.
  const view = panel(model(), { floor: null });
  view._edit = true;

  view._touch = false;
  const mitTaste = view._editHintHtml();
  assert.match(mitTaste, /Shift/, "am Rechner darf die Taste genannt werden");
  assert.match(mitTaste, /Raster/);

  view._touch = true;
  const mitFinger = view._editHintHtml();
  assert.doesNotMatch(mitFinger, /Shift/,
                      "der Hinweis nennt eine Taste, die es hier nicht gibt");
  assert.match(mitFinger, /Raster/, "und sagt gar nicht mehr, wie es geht");
});

test("fuenf ruhige Geraete verlieren ihre Namen nicht mehr", () => {
  // Die alte Pauschale: mehr als fuenf auf einer Ebene, und alle Namen
  // verschwanden -- auch die, die weit auseinanderlagen.
  const weit = model({
    floors: [{ id: "eg", name: "Erdgeschoss", level: 0, icon: "" }],
    areas: [],
    nodes: Array.from({ length: 8 }, (_unused, i) =>
      node(`p:${i}`, { floor_id: "eg", label: `G${i}`,
                       position: at(0.1 + i * 0.1, (i % 2) * 0.8 + 0.1) })),
  });
  const html = panel(weit, { floor: null })._stackHtml();

  assert.doesNotMatch(html, /class="stack-node [^"]*crowded/,
                      "auseinander stehende Namen bleiben stehen");
});

// -- Massketten -------------------------------------------
//
// Eine Bauzeichnung sagt nicht nur, wo etwas steht, sondern wie breit es
// ist -- als Kette unter dem Riss, nicht als Zahl im Kasten.

const withMetres = (extra = {}) =>
  model({
    floors: [{ id: "eg", name: "Erdgeschoss", level: 0, icon: "", metres: 12 }],
    areas: [
      { id: "a", name: "Küche", floor_id: "eg",
        position: at(0.25, 0.5), size: { width: 0.5, height: 0.6 }, auto: false },
      { id: "b", name: "Wohnzimmer", floor_id: "eg",
        position: at(0.75, 0.5), size: { width: 0.5, height: 0.6 }, auto: false },
    ],
    ...extra,
  });

const withMetresOn = (data = withMetres()) => {
  const view = panel(data, { floor: null, edit: true });
  view._meters = true;
  return view;
};

test("geteilt wird an jeder Wand, die vorne ankommt", () => {
  const stops = geometry.dimensionStops([
    { position: { x: 0.25, y: 0.5 }, size: { width: 0.5, height: 0.6 } },
    { position: { x: 0.75, y: 0.5 }, size: { width: 0.5, height: 0.6 } },
  ]);

  assert.deepEqual(stops, [0, 0.5, 1], "die Trennwand teilt die Kette");
});

test("zwei Waende, die eine sind, sind eine Teilung", () => {
  // Sonst bekaeme jede geteilte Wand zwei Hilfslinien im Abstand eines
  // Tausendstels und dazwischen ein Mass von null.
  const stops = geometry.dimensionStops([
    { position: { x: 0.25, y: 0.5 }, size: { width: 0.5, height: 0.6 } },
    { position: { x: 0.7501, y: 0.5 }, size: { width: 0.4998, height: 0.6 } },
  ]);

  assert.equal(stops.length, 3, `zu viele Teilungen: ${stops}`);
});

test("die Kette faengt am Haus an und hoert am Haus auf", () => {
  assert.deepEqual(geometry.dimensionStops([]), [0, 1]);
  // Ein Bereich ausserhalb hat keine Wand, die vorne ankommt.
  assert.deepEqual(
    geometry.dimensionStops([
      { position: { x: 1.4, y: 0.5 }, size: { width: 0.2, height: 0.2 } },
    ]),
    [0, 1],
  );
});

test("ein Mass steht mit dem Zentimeter da", () => {
  // "3,0 m" liest sich als gerundet, wo "3,00 m" als gemessen gilt --
  // und genau dieser Unterschied ist der Grund, eine Kette einzublenden.
  assert.equal(geometry.dimension(3), "3,00 m");
  assert.equal(geometry.dimension(5.404), "5,40 m");
});

test("ohne den Schalter keine Kette", () => {
  const aus = panel(withMetres(), { floor: null, edit: true })._stackHtml();
  assert.doesNotMatch(aus, /class="dims"/);
  assert.match(withMetresOn()._stackHtml(), /class="dims"/);
});

test("die Kette rechnet mit dem Massstab ihrer eigenen Etage", () => {
  // Ein Keller, den jemand schmaler eingetragen hat, ist schmaler. Eine
  // Kette, die das verschweigt, ist falsch und nicht nur ungenau.
  const html = withMetresOn()._stackHtml();

  assert.match(html, /6,00 m/, "zwei Raeume auf zwoelf Metern");
  assert.match(html, /12,00 m/, "und das Gesamtmass darunter");
});

test("ein einziger Abschnitt bekommt keine zweite Reihe", () => {
  // Dort stuende dieselbe Zahl zweimal untereinander.
  const einer = withMetres({
    areas: [
      { id: "a", name: "Halle", floor_id: "eg",
        position: at(0.5, 0.5), size: { width: 1, height: 0.6 }, auto: false },
    ],
  });
  const html = withMetresOn(einer)._stackHtml();
  const masse = [...html.matchAll(/class="dim-text">([^<]*)</g)].map((m) => m[1]);

  assert.deepEqual(masse, ["12,00 m"]);
});

test("ein Mass, das nicht unter seinen Strich passt, entfaellt", () => {
  // Die Begrenzungsstriche bleiben: dass dort geteilt ist, sagen die
  // auch, und die Reihe darunter sagt weiter die Summe. Der Normalfall,
  // solange Raeume noch nicht Wand an Wand liegen.
  const fugen = withMetres({
    areas: [
      { id: "a", name: "Küche", floor_id: "eg",
        position: at(0.24, 0.5), size: { width: 0.46, height: 0.6 }, auto: false },
      { id: "b", name: "Wohnzimmer", floor_id: "eg",
        position: at(0.76, 0.5), size: { width: 0.46, height: 0.6 }, auto: false },
    ],
  });
  const html = withMetresOn(fugen)._stackHtml();
  const masse = [...html.matchAll(/class="dim-text">([^<]*)</g)].map((m) => m[1]);

  assert.ok(!masse.some((text) => text.startsWith("0,")),
            `eine Fuge wurde beschriftet: ${masse}`);
  assert.ok(masse.includes("12,00 m"), "die Summe steht trotzdem da");
  // Die Fuge ist gezeichnet, nur nicht beschriftet: vier Teilungen in
  // der oberen Reihe heissen sechs Begrenzungsstriche und mehr.
  assert.ok((html.match(/class="dim-tick"/g) || []).length >= 8);
});

test("die Zeichnung waechst, damit die unterste Kette darauf passt", () => {
  // Sonst ist die Kette gezeichnet und trotzdem nicht zu sehen, und zwar
  // nur bei der untersten Etage.
  const ohne = geometry.stackHeight([{ id: "eg" }]);
  const mit = geometry.stackHeight([{ id: "eg" }], 100);

  assert.equal(mit - ohne, 100);

  const html = withMetresOn()._stackHtml();
  const hoehe = Number(html.match(/viewBox="0 0 \d+ (\d+)"/)[1]);
  let tiefste = 0;
  for (const m of html.matchAll(
    /class="dim-[a-z]+"[^>]*y1="([\d.-]+)"[^>]*y2="([\d.-]+)"/g)) {
    tiefste = Math.max(tiefste, Number(m[1]), Number(m[2]));
  }
  assert.ok(tiefste > 0, "es gibt ueberhaupt eine Kette");
  assert.ok(tiefste <= hoehe,
            `die Kette bei ${tiefste} liegt unter dem Blattrand ${hoehe}`);
});

test("die Massketten draengen keinen Namen unter einen anderen", () => {
  // Sie kommen dazwischen: die Kette haengt genau dort, wo auf der Etage
  // darunter die Geraetenamen stehen. Ohne sie im Entzerren steht
  // "Adapter Wohnzimmer" auf "3,60 m", und beide sind weg.
  const voll = withMetres({
    nodes: [
      node("p:1", { area_id: "a", floor_id: "eg", label: "Adapter Küche",
                    position: at(0.25, 0.78) }),
      node("p:2", { area_id: "b", floor_id: "eg", label: "Thermostat",
                    position: at(0.75, 0.78) }),
    ],
  });
  const html = withMetresOn(voll)._stackHtml();

  const boxes = [];
  const g = /<g([^>]*data-at-x="([\d.eE+-]+)"[^>]*data-at-y="([\d.eE+-]+)"[^>]*)>([\s\S]*?)<\/g>/g;
  let m;
  while ((m = g.exec(html))) {
    // Weggeblendete Namen stehen nicht im Bild, also stoeren sie auch
    // keinen -- geprueft wird, was zu sehen ist.
    if (/crowded/.test(m[1])) continue;
    const inner = m[4];
    const raum = inner.match(/class="room-label">([^<]*)</);
    const dot = inner.match(/class="stack-label" y="([\d.-]+)">([^<]*)</);
    const mass = inner.match(/class="dim-text">([^<]*)</);
    if (raum) {
      boxes.push(geometry.labelBox(
        { x: Number(m[2]), y: Number(m[3]), text: raum[1], size: 16 }));
    } else if (dot) {
      boxes.push(geometry.labelBox({
        x: Number(m[2]), y: Number(m[3]) + Number(dot[1]),
        text: dot[2], size: 18,
      }));
    } else if (mass) {
      boxes.push(geometry.labelBox(
        { x: Number(m[2]), y: Number(m[3]), text: mass[1], size: 13 }));
    }
  }

  assert.ok(boxes.length >= 5, `zu wenig zu pruefen: ${boxes.length}`);
  for (let i = 0; i < boxes.length; i += 1) {
    for (let j = i + 1; j < boxes.length; j += 1) {
      const a = boxes[i], b = boxes[j];
      assert.ok(!(a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1),
                "zwei Beschriftungen liegen aufeinander");
    }
  }
});

test("der Massband-Schalter ist auch in der Hausansicht da", () => {
  // Er stand im Block fuer die Einzelansicht und war damit genau dort
  // nicht erreichbar, wo die Ketten etwas wert sind.
  const stapel = panel(withMetres(), { floor: null, edit: true });
  assert.match(stapel._headerHtml(), /data-toggle-meters/);
});

test("the walls never swallow a click meant for a device", () => {
  // Masonry is decoration here. A node under a wall must still be the
  // thing the click lands on.
  const source = rendererSource();
  assert.match(source,
    /\.room-wall, \.room-cap, \.shell-face, \.shell-cap, \.storey-side \{[\s]*pointer-events:none/);
});

test("there is no roof, in the markup or in the stylesheet", () => {
  // "lass das dach weg! das sieht schrecklich aus!" -- and it was: four
  // long lines across the top storey, the one floor people look at most.
  const view = panel(model(), { floor: null });
  assert.doesNotMatch(view._stackHtml(), /roof/i);
  assert.doesNotMatch(view._headerHtml(), /roof/i);

  const source = rendererSource();
  assert.doesNotMatch(source, /shell-roof|data-toggle-roof/);
});


test("das Erdreich schluckt den Anfasser nicht, der es groesser macht", () => {
  // Die Schraffur ist Hintergrund, kein Element davor: ein Verlauf kann
  // gar nichts schlucken. Vorher lag hier ein SVG im Kasten, und das
  // musste ausdruecklich durchlaessig gestellt werden.
  const source = rendererSource();
  assert.match(source, /\.area\.virtual \{[^}]*repeating-linear-gradient/);
  assert.doesNotMatch(source, /\.area\.virtual \.cloud/);
});

// ── Rooms that are not rectangles ─────────────────────────

const shaped = (points) =>
  model({
    areas: [
      { id: "wohnzimmer", name: "Wohnzimmer", floor_id: "eg",
        position: at(0.5, 0.5), size: { width: 0.4, height: 0.4 },
        shape: points, auto: false },
    ],
  });

// An L: the bottom-right quarter bitten out of the box.
const L_SHAPE = [
  { x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 0.5 },
  { x: 0.5, y: 0.5 }, { x: 0.5, y: 1 }, { x: 0, y: 1 },
];

test("an L-shaped room is drawn as an L, not as its box", () => {
  const view = panel(shaped(L_SHAPE));
  const html = view._areasHtml();

  assert.match(html, /class="area-fill"/);
  assert.match(html, /clip-path:polygon\(/);
  // The step in the wall really is in the markup, not just a class name.
  assert.match(html, /50\.00% 50\.00%/);
});

test("an ordinary room stays an ordinary box", () => {
  // No shape is not "a rectangle drawn the long way round": nothing extra
  // gets rendered at all, so nothing extra can go wrong on the floors
  // nobody has edited.
  const html = panel(model())._areasHtml();

  assert.equal(html.includes("area-fill"), false);
  assert.equal(html.includes("clip-path"), false);
});

test("a stored outline nobody can read falls back to the box", () => {
  // A plan that refuses to draw because one corner arrived as a string is
  // a worse outcome than a room that is briefly a rectangle again.
  for (const broken of [null, [], [{ x: 0, y: 0 }], "square",
                        [{ x: "a", y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }]]) {
    const html = panel(shaped(broken))._areasHtml();
    assert.equal(html.includes("clip-path"), false);
  }
});

test("the clip goes on the fill, never on the box itself", () => {
  // Clipping the box would clip its own handles away and make an
  // L-shaped room the one room nobody can edit.
  const view = panel(shaped(L_SHAPE), { edit: true });
  const html = view._areasHtml();
  const box = html.slice(0, html.indexOf("area-fill"));

  assert.equal(box.includes("clip-path"), false);
  assert.match(html, /data-resize-area/);
});

test("the house view draws the same outline the floor view does", () => {
  // The two views disagreeing about the shape of a room is the bug that
  // made a cloud a rectangle in the house view.
  const view = panel(shaped(L_SHAPE), { floor: null });
  const svg = view._roomPolygon(0, view._model.areas[0]);

  // Six corners on the polygon, not four.
  const points = svg.match(/points="([^"]+)"/)[1].trim().split(/\s+/);
  assert.equal(points.length, 6);
});

// ── Editing corners ───────────────────────────────────────

test("corner mode replaces the wall handles rather than joining them", () => {
  // Both sit in the same places and would fight over every pointer press.
  const view = panel(model(), { edit: true });
  assert.match(view._areaHandlesHtml(view._model.areas[0]), /data-resize-area/);

  view._corners = true;
  const html = view._areaHandlesHtml(view._model.areas[0]);
  assert.equal(html.includes("data-resize-area"), false);
  assert.match(html, /data-corner-area/);
});

test("a plain room already has four corners to grab", () => {
  // Nothing to drag before anything has been decided is no editor at all.
  const view = panel(model(), { edit: true });
  view._corners = true;
  const html = view._areaHandlesHtml(view._model.areas[0]);

  assert.equal((html.match(/data-corner-area/g) || []).length, 4,
               "four corners to grab");
  assert.equal((html.match(/data-corner-add/g) || []).length, 4,
               "four wall midpoints to add one with");
  assert.equal((html.match(/data-corner-drop/g) || []).length, 4,
               "and a visible × on each, because Alt+click is not a button");
});

test("removing a corner is a button, not a hidden key combination", () => {
  // Alt+click cannot be seen, cannot be guessed, and on a tablet cannot
  // be pressed at all -- three good reasons it was not the answer.
  const view = panel(model(), { edit: true });
  view._corners = true;
  const html = view._areaHandlesHtml(view._model.areas[0]);

  assert.doesNotMatch(html, /Alt\+Klick/, "the × replaced it in the tooltip");
  assert.match(html, /data-corner-drop="wohnzimmer"/);
});

test("adding a corner splits the wall it sits on", () => {
  const view = panel(model(), { edit: true });
  view._addCorner("wohnzimmer", 0);
  const [section, key, values] = view._written[0];

  assert.equal(section, "areas");
  assert.equal(key, "wohnzimmer");
  assert.equal(values.shape.length, 5);
  // Inserted *after* its wall's first corner, so the winding survives.
  assert.deepEqual(values.shape[1], { x: 0.5, y: 0 });
});

test("the last corner removed hands the room back to the wall handles", () => {
  // Below four there is nothing left to shape, and a triangle nobody
  // asked for is worse than the rectangle they started with.
  const view = panel(model(), { edit: true });
  view._dropCorner("wohnzimmer", 2);

  assert.deepEqual(view._written[0][2], { shape: null });
});

test("a room with corners to spare just loses the one", () => {
  const view = panel(shaped(L_SHAPE), { edit: true });
  view._dropCorner("wohnzimmer", 2);

  assert.equal(view._written[0][2].shape.length, 5);
});

test("undoing a corner edit restores no shape, not a rectangle", () => {
  // Clearing the shape is how a room goes back to being an ordinary box,
  // and an explicit four-corner rectangle is not the same thing.
  const view = panel(model(), { edit: true });
  assert.deepEqual(view._shapeBefore(view._model.areas[0]), { shape: null });
});

// ── The plot ──────────────────────────────────────────────

const plotted = (plot) =>
  model({
    floors: [
      { id: "eg", name: "Erdgeschoss", level: 0, icon: "", has_outdoor: true,
        plot },
      { id: "og", name: "Obergeschoss", level: 1, icon: "" },
    ],
  });

test("no plot is drawn until somebody draws one", () => {
  // Home Assistant knows rooms, and a room is inside a building. Nothing
  // in it says where the land ends, so there is nothing to derive.
  assert.equal(panel(model())._plotHtml(), "");
  assert.equal(panel(model())._plot, null);
});

test("a plot is drawn under everything on its floor", () => {
  const square = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }];
  const html = panel(plotted(square))._plotHtml();

  assert.match(html, /class="plot"/);
  assert.match(html, /clip-path:polygon\(/);
});

test("the first plot reaches past the walls, into the garden", () => {
  // A plot the size of the house is a house, and says nothing.
  const view = panel(plotted(null));
  const first = view._defaultPlot();

  assert.equal(first.length, 4);
  assert.ok(first[0].x < 0, "the near corner sits outside the building");
  assert.ok(first[2].x > 1, "and the far one on the other side of it");
});

test("drawing a plot turns corner editing on with it", () => {
  // A plot nobody can reshape is a rectangle, which is not the point.
  const view = panel(plotted(null), { edit: true });
  view._togglePlot();

  assert.equal(view._written[0][0], "floors");
  assert.equal(view._corners, true);
  assert.equal(view._written[0][2].plot.length, 4);
});

test("a plot is cleared by the same button that drew it", () => {
  const square = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }];
  const view = panel(plotted(square), { edit: true });
  view._togglePlot();

  assert.deepEqual(view._written[0][2], { plot: null });
});

test("a plot corner is stored in floor coordinates, not box ones", () => {
  // The plot is the one outline with nothing around it to be relative to.
  const square = [{ x: -0.2, y: -0.2 }, { x: 1.2, y: -0.2 },
                  { x: 1.2, y: 1.2 }, { x: -0.2, y: 1.2 }];
  const view = panel(plotted(square), { edit: true });
  view._addPlotCorner(0);

  assert.deepEqual(view._written[0][2].plot[1], { x: 0.5, y: -0.2 });
});

test("a plot cannot be whittled below a boundary", () => {
  const triangle = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }];
  const view = panel(plotted(triangle), { edit: true });
  view._dropPlotCorner(1);

  assert.deepEqual(view._written[0][2], { plot: null });
});

// ── Custom shapes: no Home Assistant area behind them ────────

const withShapes = (shapes) => model({ shapes });

test("no shapes on a floor that never got one", () => {
  assert.equal(panel(model())._shapesHtml(), "");
  assert.deepEqual(panel(model())._shapes, []);
});

test("a shape only shows up on the floor it was drawn on", () => {
  const data = withShapes([
    { id: "flur", floor_id: "eg", name: "Flur", color: "",
      points: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }] },
    { id: "andere", floor_id: "og", name: "Anderswo", color: "",
      points: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }] },
  ]);
  const view = panel(data);
  assert.deepEqual(view._shapes.map((s) => s.id), ["flur"]);

  view._floorId = "og";
  assert.deepEqual(view._shapes.map((s) => s.id), ["andere"]);
});

test("drawing a new shape drops straight into reshaping it", () => {
  const view = panel(model(), { edit: true });
  view._addShape();

  assert.equal(view._written[0][0], "settings");
  assert.equal(view._written[0][1], "view");
  const written = view._written[0][2].custom_shapes;
  assert.equal(written.length, 1);
  assert.equal(written[0].name, "Fläche");
  assert.equal(written[0].points.length, 4);
  assert.equal(view._shapeEdit, written[0].id);
  assert.equal(view._corners, true);
});

test("a shape is drawn as its own polygon, named and configurable", () => {
  const data = withShapes([
    { id: "flur", floor_id: "eg", name: "Flur", color: "#112233",
      points: [{ x: 0.1, y: 0.1 }, { x: 0.4, y: 0.1 }, { x: 0.4, y: 0.9 },
               { x: 0.1, y: 0.9 }] },
  ]);
  const html = panel(data)._shapesHtml();
  assert.match(html, /data-shape="flur"/);
  assert.match(html, /clip-path:polygon\(/);
  assert.match(html, /background:#112233/);
  assert.match(html, /Flur/);
});

test("reshaping is only offered while arranging rooms", () => {
  const data = withShapes([
    { id: "flur", floor_id: "eg", name: "Flur", color: "",
      points: [{ x: 0.1, y: 0.1 }, { x: 0.4, y: 0.1 }, { x: 0.4, y: 0.9 }] },
  ]);
  const view = panel(data, { edit: false });
  assert.doesNotMatch(view._shapesHtml(), /shape-config/);
});

test("a shape corner is added at the midpoint, in floor coordinates", () => {
  const data = withShapes([
    { id: "flur", floor_id: "eg", name: "Flur", color: "",
      points: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }] },
  ]);
  const view = panel(data, { edit: true });
  view._addShapeCorner("flur", 0);

  const written = view._written[0][2].custom_shapes[0];
  assert.deepEqual(written.points[1], { x: 0.5, y: 0 });
  assert.equal(written.points.length, 4);
});

test("a shape below three corners is deleted rather than left broken", () => {
  const data = withShapes([
    { id: "flur", floor_id: "eg", name: "Flur", color: "",
      points: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }] },
  ]);
  const view = panel(data, { edit: true });
  view._dropShapeCorner("flur", 1);

  assert.deepEqual(view._written[0][2].custom_shapes, []);
});

test("deleting a shape clears whatever was pointed at it", () => {
  const data = withShapes([
    { id: "flur", floor_id: "eg", name: "Flur", color: "",
      points: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }] },
  ]);
  const view = panel(data, { edit: true });
  view._shapeEdit = "flur";
  view._shapeDialog = "flur";
  view._deleteShape("flur");

  assert.equal(view._shapeEdit, null);
  assert.equal(view._shapeDialog, null);
  assert.deepEqual(view._written[0][2].custom_shapes, []);
});

test("renaming and recolouring a shape keeps its points untouched", () => {
  const points = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }];
  const data = withShapes([
    { id: "flur", floor_id: "eg", name: "Flur", color: "", points },
  ]);
  const view = panel(data, { edit: true });
  view._renameShape("flur", { name: "Diele", color: "#ff0000" });

  const written = view._written[0][2].custom_shapes[0];
  assert.equal(written.name, "Diele");
  assert.equal(written.color, "#ff0000");
  assert.deepEqual(written.points, points);
});

// ── Das Erdreich um die unterste Etage ────────────────────
//
// Hier standen die Wolken. Sie bekamen eine eigene Ebene ueber dem Dach,
// und die kostete die Zeichnung mehr Hoehe als eine ganze Etage: 255
// Einheiten Abstand plus 340 Einheiten Etagenplatz, damit drei Kaesten
// nicht als Dachboden gelesen werden. Der Anschluss kommt aus dem Boden,
// also liegen sie jetzt im Ring um die unterste Etage -- auf einer Ebene,
// die es ohnehin gibt.

const withSoil = () =>
  model({
    floors: [
      { id: "keller", name: "Keller", level: -1, icon: "",
        has_outdoor: true, has_soil: true },
      { id: "eg", name: "Erdgeschoss", level: 0, icon: "", has_outdoor: true,
        ground: true },
      { id: "og", name: "Obergeschoss", level: 1, icon: "" },
    ],
    areas: [
      { id: "wohnzimmer", name: "Wohnzimmer", floor_id: "eg",
        position: at(0.25, 0.5), size: { width: 0.4, height: 0.4 } },
      { id: "lan", name: "LAN", floor_id: "keller", kind: "virtual",
        position: at(0.5, -0.14), size: { width: 0.3, height: 0.2 } },
    ],
  });

test("es gibt keine schwebende Ebene mehr", () => {
  // Der Stapel besteht aus Etagen, die es im Haus gibt. Eine erfundene
  // vorneweg war genau das, was die Bildhoehe gefressen hat.
  const view = panel(withSoil(), { floor: null });

  assert.deepEqual(view._stackFloors.map((floor) => floor.id),
                   ["og", "eg", "keller"], "oben nach unten, sonst nichts");
});

test("drei Etagen brauchen jetzt weniger Hoehe als vorher vier", () => {
  // Die Rechnung, die den Umbau ausgeloest hat: die Wolkenebene addierte
  // ihren Etagenplatz UND einen Abstand auf jede Zeichnung.
  const drei = geometry.stackHeight([{ id: "og" }, { id: "eg" }, { id: "keller" }]);
  const vier = geometry.stackHeight(
    [{ id: "sky" }, { id: "og" }, { id: "eg" }, { id: "keller" }]);

  assert.ok(drei < vier, "eine Ebene weniger ist eine Ebene weniger");
  assert.ok(vier - drei >= 340, `nur ${vier - drei} gespart`);
});

test("keine Etage schwebt ueber einer anderen", () => {
  // planeLift gab es einmal; jetzt liegen alle Ebenen im selben Raster.
  const floors = [{ id: "og" }, { id: "eg" }, { id: "keller" }];
  const project = (index) =>
    geometry.projectOnto({ frame: FRAME, gutter: 150, floors, index }, 0.5, 0.5);

  const abstaende = [
    project(1).y - project(0).y,
    project(2).y - project(1).y,
  ];
  assert.equal(abstaende[0], abstaende[1], "gleicher Abstand zwischen allen");
});

test("das Erdreich bekommt denselben Ring, den ein Garten bekommt", () => {
  // Im Grundriss eingesperrt laese sich der Anschluss als Kellerraum.
  const view = panel(withSoil(), { floor: "keller" });

  assert.ok(view._frame.min < 0);
  assert.ok(view._frame.span > 1);
});

test("die unterste Etage bekommt ein Erdband, das Erdgeschoss seinen Rasen", () => {
  const html = panel(withSoil(), { floor: null })._stackHtml();

  assert.match(html, /class="soil-plane"/, "Erde um den Keller");
  assert.match(html, /class="apron"/, "Rasen ums Erdgeschoss");
});

test("ein virtueller Bereich ist schraffiert und hat keine Waende", () => {
  // Erde wird in einer Bauzeichnung schraffiert. Waende haette sie nur,
  // wenn sie ein Raum waere -- und genau das soll sie nicht sein.
  const html = panel(withSoil(), { floor: null })._stackHtml();
  const soil = html.slice(html.indexOf('class="soil"'));
  const bis = soil.slice(0, soil.indexOf("LAN"));

  assert.match(bis, /class="soil-hatch"/, "Schraffur");
  assert.doesNotMatch(bis, /class="room-wall"/, "aber kein Mauerwerk");
});

test("die Schraffur bleibt im Kasten", () => {
  // Ein Strich, der ueber die Kante laeuft, ist ein Strich ueber der
  // Kante -- auch wenn ihn gerade zufaellig etwas verdeckt. Geprueft an
  // dem flachen Band, das ein Erdreich-Bereich wirklich ist, und nicht
  // am bequemen Quadrat.
  for (const [x0, y0, w, h] of [[0, 0, 1, 1], [-0.28, -0.25, 1.4, 0.22]]) {
    const punkte = geometry.soilHatch((x, y) => ({ x, y }), x0, y0, w, h);
    assert.ok(punkte.length >= 3, `zu wenige Striche: ${punkte.length}`);
    assert.ok(punkte.length <= geometry.SOIL_HATCH_MAX);
    for (const [von, nach] of punkte) {
      for (const p of [von, nach]) {
        assert.ok(p.x >= x0 - 1e-9 && p.x <= x0 + w + 1e-9, `x: ${p.x}`);
        assert.ok(p.y >= y0 - 1e-9 && p.y <= y0 + h + 1e-9, `y: ${p.y}`);
      }
    }
  }
});

test("die Schraffur haengt nicht an der Form des Kastens", () => {
  // Der Grund fuer den festen Abstand: mit fester Anzahl liegt die
  // Diagonale eines 1.4-auf-0.22-Bandes fast flach, und das Erdreich
  // sah aus wie Maserung.
  const winkel = (w, h) => {
    const [[von, nach]] = geometry.soilHatch((x, y) => ({ x, y }), 0, 0, w, h);
    return Math.atan2(nach.y - von.y, nach.x - von.x).toFixed(6);
  };
  assert.equal(winkel(1, 1), winkel(1.4, 0.22), "45 Grad bleiben 45 Grad");
});

test("ein breiteres Band bekommt mehr Striche, nicht laengere", () => {
  const schmal = geometry.soilHatch((x, y) => ({ x, y }), 0, 0, 0.4, 0.22);
  const breit = geometry.soilHatch((x, y) => ({ x, y }), 0, 0, 1.4, 0.22);

  assert.ok(breit.length > schmal.length, "eine Schraffur ist eine Dichte");
});

test("die Schraffur laeuft mit der Flucht, nicht quer dazu", () => {
  // Im Grundriss gerechnet und dann projiziert. Im Bild gerechnet stuende
  // sie auf jeder Etage anders schraeg.
  const floors = [{ id: "eg" }, { id: "og" }];
  const hatch = (index) =>
    geometry.soilHatch(
      (x, y) =>
        geometry.projectOnto({ frame: FRAME, gutter: 150, floors, index }, x, y),
      0, 0, 0.3, 0.2,
    );
  const winkel = ([von, nach]) =>
    Math.atan2(nach.y - von.y, nach.x - von.x).toFixed(4);

  assert.deepEqual(hatch(0).map(winkel), hatch(1).map(winkel),
                   "auf jeder Etage derselbe Winkel");
});

// ── Ein Redraw mitten im Ziehen ────────────────────────────

test("a refresh never rebuilds the plan out of a hand that is holding it", () => {
  // The reported symptom: the room stops dead after about a second and is
  // suddenly invisible until the button comes up. That second is the hub
  // pushing an update -- the redraw replaces the held element, every
  // further move writes to a node that is no longer in the document, and
  // the plan only agrees again on release.
  const view = panel(model(), { edit: true });
  let drawn = 0;
  view._renderShell = () => { drawn += 1; };
  view._root = { setAttribute() {}, innerHTML: "", querySelector: () => null,
                 style: { setProperty() {} } };
  view._fitted = true;
  view._applyCamera = () => {};
  view._revealCurrentTab = () => {};

  const target = element({ "data-area": "wohnzimmer" });
  view._onPointerDown(pointer(0, 0, { target: [target, stage()] }));
  view._render();

  assert.equal(drawn, 0, "not while a room is being dragged");

  view._onPointerMove(pointer(300, 700));
  assert.equal(target.style.left, "30%", "so the room keeps following");
});

test("what arrived during the drag is drawn the moment it ends", () => {
  // Deferred, never dropped: a plan that silently ignored an update would
  // be a worse bug than the one being fixed.
  const view = panel(model(), { edit: true });
  let drawn = 0;
  view._renderShell = () => { drawn += 1; };
  view._root = { setAttribute() {}, innerHTML: "", querySelector: () => null,
                 style: { setProperty() {} } };
  view._fitted = true;
  view._applyCamera = () => {};
  view._revealCurrentTab = () => {};

  view._onPointerDown(pointer(0, 0, {
    target: [element({ "data-area": "wohnzimmer" }), stage()],
  }));
  view._render();
  view._onPointerMove(pointer(300, 700));
  view._onPointerUp();

  assert.equal(drawn, 1, "exactly once, after the hand let go");
});

// ── Zwei Bearbeiten-Modi ───────────────────────────────────

test("rooms mode leaves the devices where they are", () => {
  const view = panel(model(), { edit: true, what: "rooms" });
  view._onPointerDown(pointer(0, 0, {
    target: [element({ "data-node": "a:one" }), stage()],
  }));

  assert.equal(view._drag, null, "a dot is not what this mode moves");
});

test("device mode leaves the walls where they are", () => {
  const view = panel(model(), { edit: true, what: "icons" });
  view._onPointerDown(pointer(0, 0, {
    target: [element({ "data-area": "wohnzimmer" }), stage()],
  }));

  assert.equal(view._drag, null, "a room is not what this mode moves");
});

test("the devices are out of the way while the rooms are being drawn", () => {
  const view = panel(model(), { edit: true, what: "rooms" });
  assert.match(view._stageHtml(), /editing-rooms/);
  const icons = panel(model(), { edit: true, what: "icons" });
  assert.match(icons._stageHtml(), /editing-icons/);
});

test("rooms mode is the one with the wall tools", () => {
  const rooms = panel(model(), { edit: true, what: "rooms" });
  assert.match(rooms._headerHtml(), /data-toggle-corners/);
  const icons = panel(model(), { edit: true, what: "icons" });
  assert.doesNotMatch(icons._headerHtml(), /data-toggle-corners/);
});

// ── Das Grundstück ist so groß wie der Garten ──────────────

test("the plot can be grown past the walls, and the view grows with it", () => {
  // Everybody's garden is a different size. A boundary that stopped at a
  // fixed apron would either hit an invisible wall or be drawn outside
  // the picture.
  const view = panel(model(), { edit: true });
  view._floor.plot = [
    { x: -0.2, y: -0.2 }, { x: 1.2, y: -0.2 },
    { x: 1.2, y: 1.2 }, { x: -0.2, y: 1.2 },
  ];
  const before = view._frame.span;

  view._scalePlot(1.5);
  const [, , values] = view._written[0];
  view._floor.plot = values.plot;

  assert.ok(values.plot.every((point) => point.x < -0.3 || point.x > 1.3),
            "every corner moved outwards");
  assert.ok(view._frame.span > before, "and the window opened up for it");
});

test("shrinking the plot is the same press the other way", () => {
  const view = panel(model(), { edit: true });
  view._floor.plot = [
    { x: -0.5, y: -0.5 }, { x: 1.5, y: -0.5 }, { x: 1.5, y: 1.5 },
  ];
  view._scalePlot(0.5);
  const [, , values] = view._written[0];

  assert.ok(Math.abs(values.plot[0].x - 0.1667) < 0.01, "halved around its middle");
});

test("a plot keeps its shape when it changes size", () => {
  const view = panel(model(), { edit: true });
  view._floor.plot = [
    { x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 0.5 }, { x: 0, y: 0.5 },
  ];
  view._scalePlot(2);
  const [, , values] = view._written[0];
  const width = values.plot[1].x - values.plot[0].x;
  const height = values.plot[2].y - values.plot[1].y;

  assert.ok(Math.abs(width / height - 2) < 0.01,
            "twice as wide as it is tall, before and after");
});

// ── Meter, für die die es genau wollen ─────────────────────

test("nothing asks for a number until somebody wants numbers", () => {
  const view = panel(model(), { edit: true });
  assert.equal(view._metersHtml(), "", "the editor works by eye");
  assert.doesNotMatch(view._areasHtml(), /area-dim/);
});

test("expert mode measures everything against one number", () => {
  const view = panel(model(), { edit: true });
  view._meters = true;
  view._floor.metres = 10;

  assert.match(view._metersHtml(), /value="10"/);
  // Every room is measured against that one number, in metres.
  assert.match(view._areasHtml(), /class="area-dim">\d+,\d × \d+,\d m</);
});

test("a house with no stated width still measures something sane", () => {
  const view = panel(model(), { edit: true });
  view._meters = true;

  assert.match(view._metersHtml(), /value="12"/, "twelve metres, not zero");
});

// ── Wie deutlich das Haus da ist ───────────────────────────

test("the house has a dial rather than a decision", () => {
  const view = panel(model(), { edit: true });
  view._model.theme = { ...view._model.theme, house_weight: 0.4 };

  assert.match(view._themeVars, /--fp-house:0\.4/);
});

test("an untouched dial forces nothing onto the page", () => {
  const view = panel(model(), { edit: true });
  assert.doesNotMatch(view._themeVars, /--fp-house/);
});

test("a stored zero cannot erase the house", () => {
  const view = panel(model(), { edit: true });
  view._model.theme = { ...view._model.theme, house_weight: 0 };

  assert.match(view._themeVars, /--fp-house:0\.2/, "clamped, not obeyed");
});

// ── Die Kopfzeile auf einem Telefon ────────────────────────

/** The panel's stylesheet, read from the source it ships. */
const styleSheet = () => {
  const source = rendererSource();
  const start = source.indexOf("const STYLES = `");
  assert.ok(start > 0, "the stylesheet moved");
  return source.slice(start, source.indexOf("`;", start));
};

test("the storey tabs can never be squeezed to nothing", () => {
  // Measured in a real browser at 390px: the tab strip was exactly 0
  // pixels wide, so the header appeared to start with the search box.
  // The storeys were not hidden -- they had no width. Everything else in
  // that row refuses to shrink, so the strip must either keep a usable
  // width or take a line of its own.
  const style = styleSheet();

  assert.match(style, /\.tabs\s*{[^}]*flex:1 1 220px/,
               "a basis wide enough to hold a storey name");
  assert.match(style, /header\s*{[^}]*flex-wrap:wrap/,
               "and a header that gives it its own line rather than crushing it");
});

test("the tab strip is the first thing in the header, wrapped or not", () => {
  const style = styleSheet();
  assert.match(style, /\.tabs\s*{[^}]*order:-1/,
               "so a wrapped header still starts with the storeys");
});

// ── Ein Bildschirm, der doppelt so hoch wie breit ist ──────

test("the legend follows the plan instead of sinking to the bottom", () => {
  // Measured on a 373×910 window: the plan ended at 485px and the legend
  // started at 866px -- 381 empty pixels in between, because `main` was
  // told to take all the leftover height and the plan sat at its top.
  const style = styleSheet();

  assert.match(style, /\nmain \{[^}]*flex:0 0 auto/,
               "the plan takes the height it needs and no more");
});

const screen = (innerWidth, innerHeight) => ({
  addEventListener() {}, removeEventListener() {}, confirm: () => true,
  innerWidth, innerHeight,
});

/** Baut ein Panel so, als stuende es auf diesem Bildschirm. */
const onScreen = (width, height, build = (view) => view) => {
  const previous = globalThis.window;
  try {
    globalThis.window = screen(width, height);
    return build(new SpatialHubPanel());
  } finally {
    globalThis.window = previous;
  }
};

test("a tall screen opens the legend rather than leaving half of it empty", () => {
  // A square plan on a tall narrow window can only be as wide as the
  // window, so the lower half is going spare. Filling it with the layers
  // and the providers beats filling it with nothing.
  //
  // Nicht auf dem Telefon: dort fuellt der Plan seit dem Vollbild den
  // ganzen Schirm, und die Legende liegt als Blatt darueber. Offen zu
  // starten hiesse da, ein Stueck Haus zuzudecken, bevor es jemand
  // gesehen hat.
  assert.equal(onScreen(800, 1600, (view) => view._legendOpen), true,
               "a tall tablet has room under the plan");
  assert.equal(onScreen(1400, 900, (view) => view._legendOpen), false,
               "on a normal screen the house still comes first");
  assert.equal(onScreen(373, 910, (view) => view._legendOpen), false,
               "on a phone the plan gets the screen");
});

// ── Vollbild auf dem Telefon ──────────────────────────────

test("a phone starts without any bars, a monitor keeps them", () => {
  assert.equal(onScreen(373, 910, (view) => view._bars), false);
  assert.equal(onScreen(1400, 900, (view) => view._bars), true);
  // Ein Panel neben offener Seitenleiste ist genauso schmal wie ein
  // Telefon und hat dasselbe Platzproblem -- die Breite entscheidet,
  // nicht das Geraet.
  assert.equal(onScreen(720, 900, (view) => view._bars), false);
});

test("the phone's only bar is the button that brings the bars back", () => {
  onScreen(373, 910, (view) => {
    assert.match(view._barsButtonHtml(), /data-bars/);
    assert.match(view._shellClasses(), /\bphone\b/);
    assert.match(view._shellClasses(), /\bbare\b/,
                 "no bars means the shell says so, and the stylesheet listens");

    view._bars = true;
    assert.doesNotMatch(view._shellClasses(), /\bbare\b/);
  });

  // Auf dem Monitor gibt es den Knopf nicht: dort sind die Leisten das
  // Werkzeug und kein Platzproblem.
  assert.equal(onScreen(1400, 900, (v) => v._barsButtonHtml()), "");
});

test("the plan gets the whole phone, not a card with margins around it", () => {
  const style = styleSheet();
  // "dvh" und nicht nur "vh": mit der ein- und ausfahrenden Adressleiste
  // ist "vh" zu hoch, und genau die Leiste, die weg sollte, kommt als
  // Scrollbalken zurueck.
  assert.match(style, /\.app\.phone \{[^}]*height:100dvh/);
  assert.match(style, /\.app\.phone \.body \{[^}]*padding:0/);
  assert.match(style, /\.app\.phone \.viewport \{[^}]*max-height:none/);
});

// ── Das Legendenblatt ─────────────────────────────────────

test("the legend can be pushed away downwards when a room needs the room", () => {
  onScreen(373, 910, () => {
    const view = panel();
    view._legendOpen = true;
    assert.match(view._legendHtml(), /data-legend-grab/);
  });

  // Auf dem Monitor steht die Legende unter dem Plan und nimmt ihm
  // nichts weg -- ein Griff waere dort eine Geste ohne Wirkung.
  onScreen(1400, 900, () => {
    const view = panel();
    view._legendOpen = true;
    assert.doesNotMatch(view._legendHtml(), /data-legend-grab/);
  });
});

/** Eine Ziehgeste auf dem Blatt, von oben nach unten, in Millisekunden. */
const dragSheet = (view, { by, ms = 400, height = 400 }) => {
  const sheet = { offsetHeight: height, style: {} };
  view._legendOpen = true;
  view._onSheetDown({ pointerId: 1, clientY: 100, target: {},
                      preventDefault() {} }, sheet);
  const started = view._sheet.time;
  view._onSheetMove({ pointerId: 1, clientY: 100 + by, preventDefault() {} });
  view._sheet.time = started - ms;
  view._onSheetUp();
  return sheet;
};

test("a short tug springs back, a real pull closes the sheet", () => {
  const view = onScreen(373, 910);
  view._render = () => {};

  dragSheet(view, { by: 40 });
  assert.equal(view._legendOpen, true, "40 of 400 is a wobble, not a decision");

  dragSheet(view, { by: 200 });
  assert.equal(view._legendOpen, false, "half the sheet is unmistakable");
});

test("a quick flick down closes the sheet without dragging it all the way", () => {
  // Ein Blatt, das nur bei genau der richtigen Zugweite schliesst, fuehlt
  // sich kaputt an. Ein schneller Wisch meint immer "weg damit".
  const view = onScreen(373, 910);
  view._render = () => {};

  dragSheet(view, { by: 90, ms: 120 });
  assert.equal(view._legendOpen, false);
});

test("dragging the sheet writes to the element, never through a re-render", () => {
  // Ein Neuaufbau mitten in der Bewegung ersetzt genau das Element, das
  // der Finger haelt -- dieselbe Falle wie beim Ziehen eines Raumes.
  const view = onScreen(373, 910);
  let renders = 0;
  view._render = () => { renders += 1; };
  view._legendOpen = true;

  const sheet = { offsetHeight: 400, style: {} };
  view._onSheetDown({ pointerId: 1, clientY: 100, target: {},
                      preventDefault() {} }, sheet);
  view._onSheetMove({ pointerId: 1, clientY: 160, preventDefault() {} });

  assert.equal(sheet.style.transform, "translateY(60px)");
  assert.equal(renders, 0);
});

test("the sheet only goes down: upwards there is nothing behind it", () => {
  const view = onScreen(373, 910);
  view._render = () => {};
  view._legendOpen = true;

  const sheet = { offsetHeight: 400, style: {} };
  view._onSheetDown({ pointerId: 1, clientY: 300, target: {},
                      preventDefault() {} }, sheet);
  view._onSheetMove({ pointerId: 1, clientY: 120, preventDefault() {} });

  assert.equal(sheet.style.transform, "translateY(0px)");
});

test("the widest storey sets the window, not the first one with a garden", () => {
  // A balcony upstairs and a drawn plot downstairs: taking the first
  // storey that has anything outdoors crops the garden out of its own
  // picture, because a balcony's apron is narrow and a plot is not.
  const data = model({
    floors: [
      { id: "eg", name: "Erdgeschoss", level: 0, icon: "", has_outdoor: true,
        plot: [{ x: -2, y: -2 }, { x: 3, y: -2 }, { x: 3, y: 3 }, { x: -2, y: 3 }] },
      { id: "og", name: "Obergeschoss", level: 1, icon: "", has_outdoor: true },
    ],
  });
  const view = panel(data, { floor: null });

  assert.equal(view._widestFloor.id, "eg");
  assert.ok(view._frame.span > 4, "the plot is drawn outside the window");
});

// ── Shared walls ──────────────────────────────────────────────────────

const twoRooms = (extra = {}) =>
  model({
    floors: [{ id: "eg", name: "Erdgeschoss", level: 0, icon: "" }],
    areas: [
      { id: "kueche", name: "Küche", floor_id: "eg", kind: "indoor",
        position: { x: 0.3, y: 0.5 }, size: { width: 0.2, height: 0.4 } },
      { id: "bad", name: "Bad", floor_id: "eg", kind: "indoor",
        position: { x: 0.5, y: 0.5 }, size: { width: 0.2, height: 0.4 },
        ...extra },
    ],
  });

test("two rooms that touch share the wall between them", () => {
  const data = twoRooms();
  const html = panel(data, { floor: null })._stackHtml();

  // Four walls each would be eight. One of them is shared, so seven --
  // otherwise two walls are drawn in the same place and the partition
  // comes out twice as thick as every other one.
  assert.equal((html.match(/class="room-wall"/g) || []).length, 7);
  assert.equal((html.match(/class="room-cap"/g) || []).length, 7);
});

test("rooms that only meet at a corner do not share anything", () => {
  const data = model({
    floors: [{ id: "eg", name: "Erdgeschoss", level: 0, icon: "" }],
    areas: [
      { id: "a", name: "A", floor_id: "eg", kind: "indoor",
        position: { x: 0.3, y: 0.3 }, size: { width: 0.2, height: 0.2 } },
      { id: "b", name: "B", floor_id: "eg", kind: "indoor",
        position: { x: 0.5, y: 0.5 }, size: { width: 0.2, height: 0.2 } },
    ],
  });

  assert.equal(joinsOf(data.areas).size, 0, "a point is not a wall");
});

test("a wall can be broken apart, and the break holds from both sides", () => {
  const fromMine = twoRooms();
  fromMine.areas[0].unjoined = ["bad"];
  const fromTheirs = twoRooms({ unjoined: ["kueche"] });

  for (const data of [fromMine, fromTheirs]) {
    assert.equal(joinsOf(data.areas).size, 0);
    const html = panel(data, { floor: null })._stackHtml();
    assert.equal((html.match(/class="room-wall"/g) || []).length, 8,
                 "a party wall between two flats really is two walls");
  }
});

test("the room in front draws the shared wall, not the one behind", () => {
  // Rooms are painted back to front. A wall drawn with the room behind
  // has the front room's floor painted over its foot.
  const back = { id: "b", position: { y: 0.2 } };
  const front = { id: "a", position: { y: 0.8 } };
  assert.equal(drawsTheWall(front, back), true);
  assert.equal(drawsTheWall(back, front), false);
});

test("a garden, a cloud and a niche have no wall to share", () => {
  for (const kind of ["outdoor", "virtual"]) {
    const data = twoRooms();
    data.areas[1].kind = kind;
    assert.equal(joinsOf(data.areas).size, 0, kind);
  }
  const shaped = twoRooms({
    shape: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 0.5 }, { x: 0, y: 1 }],
  });
  assert.equal(joinsOf(shaped.areas).size, 0, "a niche has no side called right");
});

test("dragging a room pulls its wall onto the neighbour's", () => {
  const view = panel(twoRooms(), { edit: true, floor: "eg" });
  const lines = view._wallLines("bad");
  const event = { shiftKey: false };

  // Küche runs 0.2 … 0.4. A room whose left wall lands at 0.41 is nearly
  // against it -- "nearly" is the difference between two rooms and one
  // shared wall, so it lands exactly.
  assert.equal(view._wallPull([0.41, 0.61], "x", event, lines), 0.4 - 0.41);
  // Shift is the escape hatch, here as everywhere else.
  assert.equal(view._wallPull([0.41, 0.61], "x", { shiftKey: true }, lines), 0);
  // Out of reach, nothing happens.
  assert.equal(view._wallPull([0.8, 1], "x", event, lines), 0);
});

test("a room never snaps to its own walls", () => {
  const view = panel(twoRooms(), { edit: true, floor: "eg" });
  assert.ok(!view._wallLines("bad").x.includes(0.6), "0.6 is Bad's own wall");
  assert.ok(view._wallLines("bad").x.includes(0.4), "0.4 is the Küche's");
});

test("clicking a room shows the marks on its shared walls", () => {
  const view = panel(twoRooms(), { edit: true, floor: "eg" });
  assert.equal(view._joinMarksHtml(view._model.areas[1]), "", "not until asked");

  view._joinArea = "bad";
  const marks = view._joinMarksHtml(view._model.areas[1]);
  assert.match(marks, /data-join-area="bad"/);
  assert.match(marks, /data-join-other="kueche"/);
  assert.match(marks, /join-mark left on/, "a red × on the wall it shares");
  assert.doesNotMatch(marks, /join-mark right/, "and nothing on the free walls");
});

test("a broken wall offers to be joined again", () => {
  // Without the +, breaking a join once is a decision nobody can undo.
  const view = panel(twoRooms({ unjoined: ["kueche"] }), { edit: true, floor: "eg" });
  view._joinArea = "bad";
  const marks = view._joinMarksHtml(view._model.areas[1]);

  assert.match(marks, /join-mark left off/);
  assert.match(marks, /\+<\/button>/);
});

// ── Dragging a device into another room ───────────────────────────────

const twoRoomHouse = (nodeExtra = {}) =>
  model({
    floors: [{ id: "eg", name: "Erdgeschoss", level: 0, icon: "" }],
    areas: [
      { id: "kueche", name: "Küche", floor_id: "eg", kind: "indoor",
        position: { x: 0.3, y: 0.5 }, size: { width: 0.2, height: 0.4 } },
      { id: "bad", name: "Bad", floor_id: "eg", kind: "indoor",
        position: { x: 0.7, y: 0.5 }, size: { width: 0.2, height: 0.4 } },
    ],
    nodes: [
      node("esp:board", {
        area_id: "kueche", position: at(0.3, 0.5),
        entity_id: "sensor.temperatur", ...nodeExtra,
      }),
    ],
  });

/** The panel under test, wired to a fake Home Assistant.
 *
 *  `_render` is stubbed: these tests are about which command goes over
 *  the wire, and the test harness has no shadow root to draw into.
 */
const movingPanel = (data, answer) => {
  const view = panel(data, { edit: true, floor: "eg" });
  view._render = () => {};
  view._hass = spyHass(answer);
  return view;
};

const spyHass = (answer = {}) => {
  const calls = [];
  return {
    calls,
    user: { is_admin: true },
    callWS: async (message) => {
      calls.push(message);
      return { scope: "device", target: "board", before: "kueche",
               after: message.area_id, ...answer };
    },
    connection: { subscribeMessage: async () => () => {} },
  };
};

test("a dot dropped in another room says which room that is", () => {
  const view = panel(twoRoomHouse(), { edit: true, floor: "eg" });

  assert.equal(view._areaAt(0.7, 0.5, "eg").id, "bad");
  assert.equal(view._areaAt(0.3, 0.5, "eg").id, "kueche");
  assert.equal(view._areaAt(0.95, 0.95, "eg"), null, "between rooms is no room");
});

test("overlapping rooms: the smaller one wins", () => {
  // A hallway drawn under a stairwell. The smaller room is always the
  // more specific answer.
  const data = twoRoomHouse();
  data.areas.push({
    id: "flur", name: "Flur", floor_id: "eg", kind: "indoor",
    position: { x: 0.5, y: 0.5 }, size: { width: 1, height: 1 },
  });
  const view = panel(data, { edit: true, floor: "eg" });

  assert.equal(view._areaAt(0.3, 0.5, "eg").id, "kueche");
  assert.equal(view._areaAt(0.05, 0.05, "eg").id, "flur");
});

test("dragging a device across a wall moves it in Home Assistant", async () => {
  const view = movingPanel(twoRoomHouse());

  await view._moveIntoArea(view._model.nodes[0], 0.7, 0.5);

  assert.deepEqual(view._hass.calls, [{
    type: "spatial_hub/area/assign",
    entity_id: "sensor.temperatur",
    area_id: "bad",
  }]);
  assert.equal(view._moved.room, "Bad");
});

test("dropping a device back in its own room changes nothing", async () => {
  // Every nudge inside a room would otherwise be a write to the registry.
  const view = movingPanel(twoRoomHouse());

  await view._moveIntoArea(view._model.nodes[0], 0.32, 0.52);

  assert.deepEqual(view._hass.calls, []);
  assert.equal(view._moved, null);
});

test("a node with no entity cannot be moved anywhere", async () => {
  // Nothing to write to: the provider gave a dot and no way back to
  // Home Assistant. Better to leave the plan alone than to guess.
  const view = movingPanel(twoRoomHouse({ entity_id: null }));

  await view._moveIntoArea(view._model.nodes[0], 0.7, 0.5);
  assert.deepEqual(view._hass.calls, []);
});

test("a guest cannot move a device into another room -- and hears why", async () => {
  // Der Name dieses Tests hiess einmal "cannot rearrange the house". Das
  // war irrefuehrend: Geprueft wird nicht das Anordnen -- das darf ein
  // Gast -- sondern das Umhaengen eines Geraets, und *das* schreibt in
  // das Register von Home Assistant.
  //
  // Vorher brach der Zug hier stumm ab. Der Punkt sprang zurueck, und
  // ohne ein Wort dazu liest sich das als Fehler im Programm. Die Regel
  // steht direkt darueber im Quelltext: Eine Aenderung, die nach
  // draussen wirkt, ist nie stumm -- ihr Ausbleiben auch nicht.
  const view = movingPanel(twoRoomHouse());
  view._hass.user.is_admin = false;

  await view._moveIntoArea(view._model.nodes[0], 0.7, 0.5);
  assert.deepEqual(view._hass.calls, [], "geschrieben wurde trotzdem");
  assert.match(String(view._error || ""), /Administratorrechte/,
               "der Zug verpufft ohne ein Wort");
});

test("the move is announced, and the way back is in the announcement", async () => {
  const view = movingPanel(twoRoomHouse());
  await view._moveIntoArea(view._model.nodes[0], 0.7, 0.5);

  const html = view._stageHtml();
  assert.match(html, /banner moved/);
  assert.match(html, /mit allen Entitäten des Geräts/);
  assert.match(html, /data-undo-move/);

  view._hass.calls.length = 0;
  await view._undoMove();
  assert.deepEqual(view._hass.calls, [{
    type: "spatial_hub/area/assign",
    entity_id: "sensor.temperatur",
    area_id: "kueche",
    scope: "device",
  }]);
  assert.equal(view._moved, null);
});

test("an entity pulled out of its device is announced as just itself", async () => {
  const view = movingPanel(twoRoomHouse(),
                           { scope: "entity", target: "sensor.temperatur" });
  await view._moveIntoArea(view._model.nodes[0], 0.7, 0.5);

  assert.match(view._stageHtml(), /nur diese Entität/);
});

test("wall grips keep their screen size instead of growing with the zoom", () => {
  const source = rendererSource();
  // Same counter-scale the device icons use: the grips live inside the
  // canvas the camera scales, so at 600 % an untouched 16px dot covered
  // the wall it was there to place.
  assert.match(
    source,
    /\.corner, \.handle \{ --grip-counter:min\(1, 1 \/ var\(--camera-zoom,1\)\); \}/,
  );
  assert.match(source, /\.corner \{[^}]*transform:scale\(var\(--grip-counter\)\)/s);
  assert.match(source, /\.handle \{[^}]*transform:scale\(var\(--grip-counter\)\)/s);
  // Hovering must not throw the counter away -- that was a grip that
  // jumped back to full size the moment the pointer arrived.
  assert.match(
    source,
    /\.corner:hover \{ transform:scale\(calc\(var\(--grip-counter\) \* 1\.15\)\); \}/,
  );
});

test("a grip is drawn small and hit large", () => {
  const source = rendererSource();
  const size = (selector) =>
    Number(
      new RegExp(`\\${selector} \\{[^}]*width:(\\d+)px`, "s").exec(source)[1],
    );
  assert.ok(size(".corner") <= 10, "the corner dot is still a blob");
  assert.ok(size(".handle") <= 9, "the wall grip is still a blob");
  // The invisible target around it grew as the dot shrank.
  assert.match(source, /\.corner::before \{[^}]*width:56px/s);
  assert.match(source, /\.handle::before \{[^}]*inset:-16px/s);
});

test("the house is one stack, however wide the window gets", () => {
  // Es gab hier einmal zwei Spalten, damit ein breiter Monitor nicht
  // links und rechts leer bleibt. Das hat aus vier Etagen vier Platten in
  // einem Raster gemacht, und ein Raster ist kein Haus: nebeneinander
  // liest man als zwei Gebaeude, untereinander als Stockwerke. Gegen
  // leeren Rand hilft der Zoom.
  const data = model();
  data.floors = ["a", "b", "c", "d", "e", "f"].map((id, level) => ({
    id, name: id.toUpperCase(), level, icon: "",
  }));
  const view = panel(data, { floor: null });
  view._root = { querySelector: () => ({ clientWidth: 2400 }) };

  // Jede Etage liegt unter der vorigen und nur um den Versatz weiter
  // rechts -- keine springt zurueck nach oben.
  for (let at = 1; at < data.floors.length; at += 1) {
    const above = view._project(at - 1, 0, 0);
    const here = view._project(at, 0, 0);
    assert.ok(here.y > above.y, `Etage ${at} steht nicht unter der vorigen`);
    assert.ok(here.x - above.x < 40, `Etage ${at} ist in eine Spalte gerutscht`);
  }

  // Und die Zeichnung ist so breit wie ein Stapel, nicht wie zwei.
  // Zwei Spalten waren gut 2000 breit; ein Stapel ist es nie.
  assert.ok(view._stackWidth < 1400, "so breit wird ein einzelner Stapel nie");
});

test("the stack is a line drawing, not four grey plates", () => {
  // Vorlage ist eine Schnittzeichnung: schwarze Flaechen, weisse Linien.
  // Vorher war jede Flaeche mit einem blaugrauen Schleier gefuellt, und
  // sechzehn davon uebereinander ergaben Grau auf Grau.
  const style = styleSheet();

  // Waende fuellen sich mit dem Hintergrund, damit sie einander wirklich
  // verdecken -- nicht mit einem Grauton, der sich aufsummiert.
  for (const part of ["room-wall", "room-cap", "shell-face", "shell-cap"]) {
    assert.match(style, new RegExp(`\\.${part} \\{[^}]*fill:var\\(--fp-[a-z-]+, var\\(--fp-surface`),
                 `${part} malt noch einen eigenen Grauton`);
  }
  // Der Boden im Raum bleibt der Hintergrund.
  assert.match(style, /\.stack \.room \{[^}]*fill:none/);
});

test("every storey says its name, in the margin and out of the plan", () => {
  const data = model({
    floors: [{ id: "kg", name: "Keller", level: -1, icon: "" },
             { id: "eg", name: "EG", level: 0, icon: "" }],
  });
  const view = panel(data, { floor: null });
  const html = view._stackHtml();

  // Versalien, wie in einer Schnittzeichnung.
  assert.match(html, /KELLER/);

  // Und links neben der Etage, nicht auf ihr: der Name steht weiter
  // links als der linkeste Punkt der Platte. Vorher wurde er am Bildrand
  // abgeschnitten, weil es dort keinen Rand gab.
  const leftmost = view._project(0, 0, 1).x;
  const name = /translate\((-?[\d.]+),/.exec(
    html.slice(html.indexOf("storey-name") - 300),
  );
  assert.ok(Number(name[1]) < leftmost, "der Name klebt an der Platte");
  assert.ok(Number(name[1]) > 0, "der Name faellt aus dem Bild");
});

test("the plan is centred once, not twice into the right-hand half", () => {
  // Gemeldet als "es kann nur die rechte Seite des Bildschirms benutzt
  // werden, das Modell schiebt sich immer wieder dorthin". Die Zeichnung
  // wurde zweimal zentriert: die Box per "margin-inline:auto" um den
  // halben Rest der *ungezoomten* Breite, und der Inhalt per translate um
  // den halben Rest der *gezoomten*. Beides addiert sich, und weil jeder
  // Klick neu klemmt, kam es nach jedem Schieben zurueck.
  const style = styleSheet();
  assert.doesNotMatch(style, /\.canvas \{[^}]*margin-inline:auto/,
                      "die Box zentriert sich wieder selbst");

  // Und die Kamera zentriert weiterhin: kleiner als das Fenster heisst
  // Mitte, egal wo die Ansicht vorher stand.
  const view = panel();
  view._root = {
    querySelector: (selector) =>
      selector === ".canvas"
        ? { offsetWidth: 1280, offsetHeight: 800 }
        : { clientWidth: 1990, clientHeight: 900 },
  };
  view._view = { zoom: 0.78, x: 700, y: 0 };
  view._clampView({ offsetWidth: 1280, offsetHeight: 800 });
  assert.equal(Math.round(view._view.x), Math.round((1990 - 1280 * 0.78) / 2));
});

test("fit-to-screen fills the window instead of parking the plan in a corner", () => {
  const view = panel();
  view._root = {
    querySelector: (selector) =>
      selector === ".canvas"
        ? { offsetWidth: 400, offsetHeight: 300, style: { setProperty() {} } }
        : { clientWidth: 1600, clientHeight: 900, getBoundingClientRect: () => ({}) },
  };
  view._fitToScreen();
  // 900/300 = 3 is the tighter axis; 0.9 of it keeps a margin.
  assert.equal(view._view.zoom, 2.7);
  assert.ok(view._view.zoom > 1, "a small plan used to stay small");
});

// ── Das Menue unter der rechten Maustaste ──────────────────

/** Ein Rechtsklick auf etwas, das die Menuelogik erkennen kann. */
const rightClick = (view, target, { x = 100, y = 100 } = {}) => {
  let prevented = false;
  view._render = () => {};
  view._onContextMenu({
    clientX: x,
    clientY: y,
    composedPath: () => target,
    preventDefault: () => { prevented = true; },
  });
  return prevented;
};

const ids = (view) =>
  view._menuItems().filter((item) => !item.separator).map((item) => item.id);

test("the right button offers what you clicked on, not one menu for everything", () => {
  const view = panel(model(), { edit: true });

  rightClick(view, [element({ "data-area": "wohnzimmer" }), stage()]);
  assert.deepEqual(view._menu.kind, "area");
  assert.ok(ids(view).includes("area-hide"));

  // Ein Geraet steht *im* Raum. Wer darauf klickt, meint das Geraet.
  rightClick(view, [
    element({ "data-node": "a:one" }),
    element({ "data-area": "wohnzimmer" }),
    stage(),
  ]);
  assert.equal(view._menu.kind, "node");

  rightClick(view, [stage()]);
  assert.equal(view._menu.kind, "plan");
});

test("outside the plan the browser keeps its own menu", () => {
  const view = panel(model(), { edit: true });
  // Eine Leiste ist keine Buehne: kopieren und untersuchen bleiben dort.
  assert.equal(rightClick(view, [element({ "data-toggle": "diagnostics" })]),
               false, "nothing was prevented");
  assert.equal(view._menu, null);
});

test("a right click is the way into editing, not a dead end", () => {
  const view = panel(model(), { edit: false });
  rightClick(view, [element({ "data-area": "wohnzimmer" }), stage()]);
  assert.deepEqual(ids(view), ["edit-on"]);

  view._onClick({ composedPath: () => [element({ "data-menu": "edit-on" })] });
  assert.equal(view._edit, true);
  assert.equal(view._menu, null, "the menu closes behind itself");
});

test("a guest is offered the pencil, because arranging is not an admin thing", () => {
  const view = panel(model(), { admin: false, edit: false });
  rightClick(view, [element({ "data-area": "wohnzimmer" }), stage()]);
  assert.deepEqual(ids(view), ["edit-on"],
                   "der Weg ins Bearbeiten fehlt einem Nicht-Verwalter");
});

test("nobody without a user gets a menu", () => {
  const view = panel(model(), { admin: false, edit: false });
  view._hass = {};
  rightClick(view, [element({ "data-area": "wohnzimmer" }), stage()]);
  assert.deepEqual(ids(view), []);
  assert.equal(view._menuHtml(), "", "and no empty bubble either");
});

test("the room menu shows which kind the room already is", () => {
  const view = panel(model(), { edit: true });
  rightClick(view, [element({ "data-area": "wohnzimmer" }), stage()]);
  const on = view._menuItems().filter((item) => item.on).map((item) => item.id);
  assert.deepEqual(on, ["kind-indoor"], "a room is a room until told otherwise");
});

test("picking a kind writes it, with the old one to fall back on", () => {
  const view = panel(model(), { edit: true });
  rightClick(view, [element({ "data-area": "wohnzimmer" }), stage()]);
  view._onClick({
    composedPath: () => [element({ "data-menu": "kind-outdoor" })],
  });
  const [section, key, values] = view._written[0];
  assert.equal(section, "areas");
  assert.equal(key, "wohnzimmer");
  assert.deepEqual(values, { kind: "outdoor" });
});

test("rooms and devices are two modes, and the menu says so", () => {
  const rooms = panel(model(), { edit: true, what: "rooms" });
  rightClick(rooms, [element({ "data-node": "a:one" }), stage()]);
  assert.deepEqual(ids(rooms), ["edit-icons"],
                   "no device actions while walls are being dragged");

  const icons = panel(model(), { edit: true, what: "icons" });
  rightClick(icons, [element({ "data-area": "wohnzimmer" }), stage()]);
  assert.deepEqual(ids(icons), ["edit-rooms"]);
});

test("the menu never offers to delete or duplicate a room", () => {
  // Bereiche gehoeren dem Register von Home Assistant. Ein Loeschen hier
  // waere ein Loeschen ueberall -- der Hub platziert, er verwaltet nicht.
  const view = panel(model(), { edit: true });
  rightClick(view, [element({ "data-area": "wohnzimmer" }), stage()]);
  for (const id of ids(view)) {
    assert.doesNotMatch(id, /delete|remove|duplicate/,
                        `the menu offered "${id}"`);
  }
  assert.ok(ids(view).includes("area-hide"),
            "the honest version of the same wish is there");
});

test("a click beside the menu closes it and does nothing else", () => {
  const view = panel(model(), { edit: true });
  rightClick(view, [element({ "data-area": "wohnzimmer" }), stage()]);
  let rendered = 0;
  view._render = () => { rendered += 1; };
  // Daneben liegt eine Schaltfläche, die sonst sofort etwas täte.
  view._onClick({
    composedPath: () => [element({ "data-hide-area": "wohnzimmer" }), stage()],
  });
  assert.equal(view._menu, null);
  assert.equal(view._written.length, 0,
               "the button underneath fired through the menu");
  assert.equal(rendered, 1);
  assert.equal(view._areaDialog, null);
});

test("the menu stays inside the window instead of hanging out of it", () => {
  const view = panel(model(), { edit: true });
  const room = { innerWidth: 800, innerHeight: 600 };
  const before = globalThis.window;
  globalThis.window = { ...before, ...room };
  try {
    rightClick(view, [element({ "data-area": "wohnzimmer" }), stage()],
               { x: 790, y: 590 });
    const html = view._menuHtml();
    const left = Number(/left:(-?\d+)px/.exec(html)[1]);
    const top = Number(/top:(-?\d+)px/.exec(html)[1]);
    assert.ok(left + 230 <= 800, `menu ran off the right edge at ${left}`);
    assert.ok(top < 590, `menu ran off the bottom at ${top}`);
  } finally {
    globalThis.window = before;
  }
});

test("the empty plan offers what belongs to the whole storey", () => {
  const view = panel(model(), { edit: true });
  rightClick(view, [stage()]);
  assert.deepEqual(ids(view), ["plot-toggle", "shape-new", "floor-reset"]);
  // Ohne gezeichnetes Grundstueck heisst der Eintrag anders herum.
  const item = view._menuItems().find((entry) => entry.id === "plot-toggle");
  assert.match(item.label, /zeichnen/);
});

/** Ein Finger, der irgendwo aufsetzt. */
const finger = (x, y, target = []) => ({
  touches: [{ clientX: x, clientY: y }],
  composedPath: () => target,
  preventDefault() {},
});

const held = async () =>
  new Promise((resolve) =>
    setTimeout(resolve, SpatialHubPanel.PRESS.time + 20),
  );

test("holding a finger still opens the same menu as the right button", async () => {
  const view = panel(model(), { edit: true });
  view._render = () => {};
  view._onTouchStart(finger(120, 220, [element({ "data-area": "wohnzimmer" }),
                                       stage()]));
  assert.equal(view._menu, null, "not before the time is up");
  await held();
  assert.deepEqual(
    { kind: view._menu.kind, id: view._menu.id, x: view._menu.x },
    { kind: "area", id: "wohnzimmer", x: 120 },
  );
});

test("a finger that travels is panning, not asking for a menu", async () => {
  const view = panel(model(), { edit: true });
  view._render = () => {};
  view._onTouchStart(finger(100, 100, [stage()]));
  view._onTouchMove(finger(100, 140));
  await held();
  assert.equal(view._menu, null);

  // Ein bisschen Wackeln darf sein: eine Hand haelt nicht auf das Pixel
  // genau still, und ein Menue, das daran scheitert, gibt es nicht.
  const steady = panel(model(), { edit: true });
  steady._render = () => {};
  steady._onTouchStart(finger(100, 100, [stage()]));
  steady._onTouchMove(finger(103, 102));
  await held();
  assert.ok(steady._menu, "three pixels of hand is still holding still");
});

test("lifting the finger early is a tap, and taps do not open menus", async () => {
  const view = panel(model(), { edit: true });
  view._render = () => {};
  view._onTouchStart(finger(100, 100, [stage()]));
  view._onTouchEnd();
  await held();
  assert.equal(view._menu, null);
});

test("two fingers are a pinch, and a pinch cancels the wait", async () => {
  const view = panel(model(), { edit: true });
  view._render = () => {};
  view._view = { zoom: 1, x: 0, y: 0 };
  view._onTouchStart(finger(100, 100, [stage()]));
  view._onTouchStart({
    touches: [{ clientX: 100, clientY: 100 }, { clientX: 200, clientY: 100 }],
    composedPath: () => [stage()],
  });
  await held();
  assert.equal(view._menu, null, "zooming must not drop a menu on the plan");
  assert.ok(view._pinch);
});

test("the menu takes the room back off the hook it was hanging on", async () => {
  // Ein Finger auf einem Raum startet einen Zug. Bleibt er liegen, war
  // kein Zug gemeint -- und beim Loslassen darf der Raum nicht springen.
  const view = panel(model(), { edit: true });
  view._render = () => {};
  view._onTouchStart(finger(100, 100, [element({ "data-area": "wohnzimmer" }),
                                       stage()]));
  view._drag = { mode: "area", key: "wohnzimmer" };
  await held();
  assert.equal(view._drag, null);
  assert.ok(view._menu);
});

test("the current kind is marked, not just tinted", () => {
  // Farbe allein sagt einem Teil der Leute nichts. Das Häkchen schon.
  const view = panel(model(), { edit: true });
  rightClick(view, [element({ "data-area": "wohnzimmer" }), stage()]);
  const html = view._menuHtml();
  assert.equal((html.match(/menu-tick/g) || []).length, 1,
               "exactly one entry is the current one");
});

// ── Einrasten an der Flucht des Hauses ─────────────────────

/** Zwei Etagen, die untere mit einer bekannten Aussenkante. */
const withGhost = ({ ghosts = true } = {}) => {
  const view = panel(
    model({
      floors: [
        { id: "eg", name: "Erdgeschoss", level: 0, icon: "",
          outline: { x: 0.1, y: 0.2, width: 0.6, height: 0.5 } },
        { id: "og", name: "Obergeschoss", level: 1, icon: "" },
      ],
      areas: [
        { id: "schlafen", name: "Schlafen", floor_id: "og",
          position: at(0.5, 0.5), size: { width: 0.3, height: 0.3 } },
      ],
    }),
    { edit: true, floor: "og" },
  );
  view._ghosts = ghosts;
  return view;
};

test("a wall can land on the outline of the floor below, not just on a neighbour", () => {
  const view = withGhost();
  const lines = view._wallLines("schlafen");
  assert.ok(lines.x.includes(0.1) && lines.x.includes(0.7),
            "the left and right of the floor below are places to land");
  assert.ok(lines.y.includes(0.2) && lines.y.includes(0.7));
});

test("a line nobody can see does not pull", () => {
  // Derselbe Knopf, der die Konturen einblendet, macht sie anziehend.
  // Sonst ruckelt der Raum an etwas, das gar nicht da ist.
  const view = withGhost({ ghosts: false });
  assert.deepEqual(view._wallLines("schlafen"), { x: [], y: [] });
});

test("the storey being edited does not pull on itself", () => {
  const view = withGhost();
  // Das Obergeschoss hat keine eigene Kontur in diesem Modell -- aber
  // haette es eine, waere sie aus den Raeumen abgeleitet, die man gerade
  // zieht. Ein Raum, der sich an seiner eigenen Aussenkante festhaelt,
  // kommt nicht mehr los.
  view._model.floors[1].outline = { x: 0.35, y: 0.35, width: 0.3, height: 0.3 };
  const lines = view._wallLines("schlafen");
  assert.ok(!lines.x.includes(0.35), "the current floor is not its own magnet");
});

test("a room pulled against the house line says which storey it met", () => {
  const view = withGhost();
  // Genau auf der linken Aussenkante des Erdgeschosses.
  assert.deepEqual(
    view._flushFloors({ left: 0.1, right: 0.4, top: 0.4, bottom: 0.44 }),
    ["eg"],
  );
  // Daneben ist daneben: fast eingerastet ist nicht eingerastet.
  assert.deepEqual(
    view._flushFloors({ left: 0.13, right: 0.4, top: 0.4, bottom: 0.44 }),
    [],
  );
});

test("nothing lights up while the contours are switched off", () => {
  const view = withGhost({ ghosts: false });
  assert.deepEqual(
    view._flushFloors({ left: 0.1, right: 0.4, top: 0.4, bottom: 0.44 }),
    [],
  );
});

test("letting go puts the highlight away", () => {
  const view = withGhost();
  const marks = [];
  view._root = {
    querySelectorAll: () => [
      { getAttribute: () => "eg",
        classList: { toggle: (_name, on) => marks.push(on) } },
    ],
  };
  view._showFlush({ left: 0.1, right: 0.4, top: 0.4, bottom: 0.44 });
  view._onPointerUp();
  assert.deepEqual(marks, [true, false]);
});

test("dragged roughly at the house line, the room lands exactly on it", () => {
  const drag = (shift) => {
    const view = withGhost();
    const target = element({ "data-area": "schlafen" });
    view._onPointerDown(pointer(0, 0, { target: [target, stage()] }));
    // Der Raum ist 0.3 breit; seine linke Wand landet knapp neben der
    // Aussenkante des Erdgeschosses bei 0.1.
    view._onPointerMove(pointer(268, 500, { shift }));
    view._onPointerUp();
    const written = view._written[view._written.length - 1][2];
    return written.position.x - 0.3 / 2;
  };
  assert.equal(Number(drag(false).toFixed(4)), 0.1,
               "the left wall sits on the outline below");
  assert.notEqual(Number(drag(true).toFixed(4)), 0.1,
                  "Shift still turns every magnet off");
});

test("a storey called Untergeschoss keeps its U", () => {
  // Der Rand links war eine feste Zahl und reichte fuer "EG". Home
  // Assistant schlaegt aber "Erdgeschoss" vor, und das wurde vorne
  // abgeschnitten -- sichtbar nur auf einem Bild, nie in einem Test.
  const stack = (names) =>
    panel(
      model({
        floors: names.map((name, i) => ({ id: `f${i}`, name, level: i })),
        areas: names.map((_name, i) => ({
          id: `a${i}`, name: "Raum", floor_id: `f${i}`,
          position: at(0.5, 0.5), size: { width: 0.4, height: 0.4 },
        })),
      }),
      { floor: null },
    );

  const short = stack(["EG", "OG"]);
  const long = stack(["Untergeschoss", "Erdgeschoss"]);
  // Der Name steht rechtsbuendig vor der Platte; was links davon liegt,
  // muss ins Bild passen.
  const room = (view) => view._project(0, 0, 1).x - 34;
  assert.ok(room(long) > room(short),
            "a longer name gets more room, not the same");
  assert.ok(room(long) >= "Untergeschoss".length * 23,
            "and enough of it for the whole word");
  assert.equal(room(short), 150 - 34, "short names keep the old look");
});

test("the drawing grows with the gutter instead of cutting it off", () => {
  const wide = panel(
    model({
      floors: [{ id: "f0", name: "Dachgeschoss links", level: 1 },
               { id: "f1", name: "EG", level: 0 }],
      areas: [{ id: "a0", name: "Raum", floor_id: "f0",
                position: at(0.5, 0.5), size: { width: 0.4, height: 0.4 } },
              { id: "a1", name: "Raum", floor_id: "f1",
                position: at(0.5, 0.5), size: { width: 0.4, height: 0.4 } }],
    }),
    { floor: null },
  );
  // Die rechte Kante des Hauses muss innerhalb des Bildes bleiben.
  assert.ok(wide._project(0, 1, 0).x < wide._stackWidth,
            "the house ran off the right edge while the name got its room");
});

test("the room's name gets out of the way of what is in the room", () => {
  // Beides stand in der Mitte: die Automatik setzt ein Geraet ohne eigene
  // Angabe in die Raummitte, und der Raumname stand dort auch. Auf dem
  // ersten Bild fuer die README lag "Adapter Arbeitszimmer" quer ueber
  // "Arbeitszimmer".
  const view = panel(
    model({
      areas: [{ id: "r", name: "Wohnzimmer", floor_id: "eg",
                position: at(0.5, 0.5), size: { width: 0.6, height: 0.6 } }],
      nodes: [node("a:lamp", { area_id: "r", position: at(0.5, 0.5) })],
    }),
    { floor: null },
  );
  const svg = view._stackHtml();
  const nameY = Number(/translate\([\d.-]+,([\d.-]+)\)[^>]*>\s*<text class="room-label"/
    .exec(svg)[1]);
  const plane = view._stackFloors.findIndex((floor) => floor.id === "eg");
  const middle = view._project(plane, 0.5, 0.5).y;
  const back = view._project(plane, 0.5, 0.2).y;
  assert.ok(nameY < middle, "the name is still sitting on the devices");
  assert.ok(nameY >= back, "and it has not climbed out through the back wall");
});

/** Wie tief der Raumname in seinem Raum sitzt: 0 = Hinterkante, 1 = vorn. */
const nameDepth = (view, floorId) => {
  const svg = view._stackHtml();
  const nameY = Number(
    /translate\([\d.-]+,([\d.-]+)\)[^>]*>\s*<text class="room-label"/
      .exec(svg)[1],
  );
  const plane = view._stackFloors.findIndex((floor) => floor.id === floorId);
  const back = view._project(plane, 0.5, 0.2).y;
  const front = view._project(plane, 0.5, 0.8).y;
  return (nameY - back) / (front - back);
};

const oneRoom = (extra = {}) =>
  model({
    areas: [{ id: "r", name: "Wohnzimmer", floor_id: "eg",
              position: at(0.5, 0.5), size: { width: 0.6, height: 0.6 } }],
    ...extra,
  });

test("a room with nothing in it keeps its name in the middle", () => {
  // Das Ausweichen nach hinten war die Antwort auf ein Geraet in der
  // Raummitte. Wo keines steht, war es ein Tausch und keine Loesung: Der
  // Name klebte an der Hinterwand, obwohl der ganze Raum frei ist.
  const leer = panel(oneRoom(), { floor: null });
  const voll = panel(
    oneRoom({ nodes: [node("a:lamp", { area_id: "r", position: at(0.5, 0.5) })] }),
    { floor: null },
  );
  assert.ok(nameDepth(leer, "eg") > 0.4,
            "der Name klebt an der Hinterwand, obwohl nichts im Raum steht");
  assert.ok(nameDepth(voll, "eg") < 0.3,
            "der Name sitzt auf dem Geraet, das in der Mitte steht");
});

test("a name does not dodge a device that is switched off", () => {
  // Wer die Ebene eines Providers ausblendet, sieht eine leerere
  // Zeichnung. Ein Name, der darin vor einem unsichtbaren Geraet
  // ausweicht, weicht vor nichts aus.
  const daten = oneRoom({
    nodes: [node("a:lamp", { area_id: "r", position: at(0.5, 0.5) })],
  });
  for (const layer of daten.layers) {
    if ((layer.provider_id || "") === "a") layer.visible = false;
  }
  const view = panel(daten, { floor: null });
  assert.equal(view._visibleNodes.length, 0, "die Vorbedingung stimmt nicht");
  assert.ok(nameDepth(view, "eg") > 0.4,
            "der Name weicht einem Geraet aus, das gar nicht gezeichnet wird");
});

test("the drawn name and the one decluttering knows about are the same", () => {
  // Zwei Rechnungen fuer denselben Punkt waeren zwei Stellen, an denen
  // er auseinanderlaeuft -- und ein Entzerren, das gegen den falschen
  // Punkt prueft, ist schlimmer als keines.
  const view = panel(oneRoom(), { floor: null });
  const svg = view._stackHtml();
  const drawn = Number(
    /translate\([\d.-]+,([\d.-]+)\)[^>]*>\s*<text class="room-label"/
      .exec(svg)[1],
  );
  const known = view._stackRoomLabels(view._stackFloors, view._counterScale)
    .find((label) => label.text === "Wohnzimmer");
  assert.ok(known, "das Entzerren kennt den Raumnamen gar nicht");
  assert.ok(Math.abs(known.y - drawn) < 0.5,
            `gezeichnet bei ${drawn}, bekannt als ${known.y}`);
});

/** Die Schriftgroesse, mit der ein Raumname gezeichnet wurde.
 *
 *  Ohne Escapen: Die Namen hier unten sind Raumnamen und keine Muster.
 */
const drawnSize = (view, name) => {
  const svg = view._stackHtml();
  const hit = new RegExp(
    '<text class="room-label"(?: style="font-size:([0-9.]+)px")?>' + name + "<",
  ).exec(svg);
  assert.ok(hit, `${name} steht gar nicht in der Zeichnung`);
  return hit[1] ? Number(hit[1]) : ROOM_LABEL.size;
};

const rowOf = (namen) =>
  model({
    floors: [{ id: "eg", name: "Erdgeschoss", level: 0, icon: "" }],
    areas: namen.map((n, i) => ({
      id: `r${i}`, name: n, floor_id: "eg", kind: "indoor",
      position: at((i + 0.5) / namen.length, 0.5),
      size: { width: 1 / namen.length, height: 1 },
    })),
    nodes: [],
  });

const NARROW = ["Diele", "Hauswirtschaftsraum", "Esszimmer",
                "Abstellkammer", "Bad", "Gästezimmer"];

test("a name too wide for its room is set smaller, not left to run over", () => {
  // Nachgemessen im gezeichneten SVG, nicht geschaetzt: Sechs Raeume
  // nebeneinander, und "Hauswirtschaftsraum" stand ueber zwei Nachbarn.
  const view = panel(rowOf(NARROW), { floor: null });
  assert.ok(drawnSize(view, "Hauswirtschaftsraum") < ROOM_LABEL.size,
            "der lange Name wurde nicht verkleinert");
});

test("one type size per storey, the way a drawing is lettered", () => {
  // Je Raum gerechnet stand "Diele" in 16 px neben "Hauswirtschaftsraum"
  // in 10 -- angesehen liest sich das als Rangfolge zwischen Raeumen,
  // die gleichrangig sind.
  const view = panel(rowOf(NARROW), { floor: null });
  const sizes = new Set(NARROW.map((name) => drawnSize(view, name)));
  assert.equal(sizes.size, 1,
               `die Etage traegt ${sizes.size} Schriftgroessen: `
               + `${[...sizes].join(", ")}`);
});

test("a storey with room to spare keeps the full size", () => {
  // Sonst kostete die Regel ueberall Groesse und nicht nur dort, wo
  // sie gebraucht wird -- am Demohaus aendert sich nichts.
  const view = panel(rowOf(["Bad", "Flur", "Küche"]), { floor: null });
  assert.equal(drawnSize(view, "Bad"), ROOM_LABEL.size);
});

test("a shrunk name never goes below the size at which it is still writing", () => {
  // Eine Schrift, die weiter schrumpft, ist keine Beschriftung mehr,
  // sondern ein grauer Strich, der so tut als waere er eine.
  const view = panel(
    rowOf(["A", "Hauswirtschaftsraumzugangsflur", "B", "C", "D", "E"]),
    { floor: null },
  );
  assert.equal(drawnSize(view, "Hauswirtschaftsraumzugangsflur"),
               ROOM_LABEL.min);
});

test("decluttering is told the size every name is actually drawn at", () => {
  // Ein Kasten, der groesser ist als seine Schrift, laesst Geraetenamen
  // ausweichen, die gepasst haetten -- und ein zu kleiner laesst sie
  // stehen, wo sie sich decken.
  //
  // Ueber *alle* Raeume und nicht nur einen: Als das Zeichnen auf eine
  // Groesse je Etage umgestellt wurde und das Entzerren noch je Raum
  // rechnete, fielen die beiden Zahlen fuer den laengsten Namen zufaellig
  // zusammen -- eine Wache, die nur ihn ansah, blieb gruen.
  const view = panel(rowOf(NARROW), { floor: null });
  const known = view._stackRoomLabels(view._stackFloors, view._counterScale);
  for (const name of NARROW) {
    const label = known.find((entry) => entry.text === name);
    assert.ok(label, `das Entzerren kennt ${name} gar nicht`);
    assert.ok(Math.abs(label.size - drawnSize(view, name)) < 0.01,
              `${name}: gezeichnet mit ${drawnSize(view, name)}, `
              + `bekannt als ${label.size}`);
  }
});

test("a flat gets its drawing, not a column with one word in it", () => {
  // Die Spalte links ist dazu da, Stockwerke untereinander lesbar zu
  // machen. Bei einem gibt es nichts zu sortieren -- und eine Wohnung ist
  // ein Haus mit einer Etage, also ist das kein Randfall, sondern jede
  // Etagenwohnung. Der Name „Untergeschoss" hat dort ein Drittel der
  // Bildbreite an eine Spalte verloren, in der ein Wort steht.
  const long = { id: "ug", name: "Untergeschoss", level: 0, icon: "" };
  const alone = panel(model({ floors: [long] }), { floor: null });
  const stacked = panel(
    model({ floors: [long, { id: "og", name: "Obergeschoss", level: 1, icon: "" }] }),
    { floor: null },
  );

  assert.ok(alone._oneStorey, "eine Etage ist eine Etage");
  assert.ok(!stacked._oneStorey);
  assert.ok(alone._nameGutter < stacked._nameGutter / 3,
    "die Spalte steht immer noch da");

  // Und das gewonnene Feld geht an die Zeichnung, nicht an den Rand.
  const share = (view) => {
    const front = view._project(0, 1, 1).x - view._project(0, 0, 1).x;
    return front / view._stackWidth;
  };
  assert.ok(share(alone) > share(stacked),
    "das Haus hat nichts vom kleineren Rand");
  assert.ok(share(alone) > 0.85, "immer noch zu viel Luft daneben");
});

test("the lone storey's name sits above the drawing, not beside it", () => {
  const view = panel(model({ floors: [{ id: "eg", name: "Erdgeschoss", level: 0, icon: "" }] }),
                     { floor: null });
  const markup = view._stackHtml();

  // Ueber der Mauerkrone, sonst laege der Name auf der Rueckwand.
  assert.match(markup, /class="storey-name alone"/);
  const top = Math.min(
    ...[0, 1].map((x) => view._project(0, x, 0).y - 26),
  );
  // Die letzte data-at-y *vor* der Beschriftung -- Knoten tragen
  // dieselbe Angabe, und die erste im Dokument ist nicht diese.
  const before = markup.slice(0, markup.indexOf('class="storey-name alone"'));
  const all = [...before.matchAll(/data-at-y="([-\d.]+)"/g)];
  const at = Number(all[all.length - 1][1]);
  assert.ok(at < top, "der Name liegt auf der Zeichnung statt darueber");
  assert.ok(at > 0, "und faellt oben aus dem Bild");
});

test("one storey stands on nothing; a stack stands on slabs", () => {
  // Die Bodenplatte trennt Etagen voneinander -- vier Zeichnungen
  // uebereinander werden dadurch vier Stockwerke eines Hauses. Steht dort
  // nur eine, gibt es nichts zu trennen, und was bleibt, ist eine Wanne:
  // ein Sockel mit dicker Vorderkante unter einem Grundriss, der auf gar
  // nichts steht. Eine Bauzeichnung zeichnet den Boden nicht.
  const floors = [
    { id: "eg", name: "Erdgeschoss", level: 0, icon: "" },
    { id: "og", name: "Obergeschoss", level: 1, icon: "" },
  ];
  const alone = panel(model({ floors: [floors[0]] }), { floor: null });
  const stacked = panel(model({ floors }), { floor: null });
  const count = (markup, what) => (markup.match(new RegExp(what, "g")) || []).length;

  assert.equal(count(alone._stackHtml(), 'class="storey"'), 0, "die Wanne ist noch da");
  assert.equal(count(alone._stackHtml(), "storey-side"), 0);

  assert.equal(count(stacked._stackHtml(), 'class="storey"'), 2,
    "im Stapel traegt jede Etage eine Platte");
  assert.ok(count(stacked._stackHtml(), "storey-side") >= 8);

  // Die Aussenwand bleibt in beiden Faellen: sie ist das, was den
  // Grundriss zu einem Stockwerk macht, und nicht die Platte darunter.
  assert.ok(count(alone._stackHtml(), "shell-face") >= 4);
});

// ── Die reinen Bausteine, ohne Panel drumherum ─────────────
//
// Ausgelagert, damit sie einzeln pruefbar sind: die Rechnungen unten
// entscheiden, wo im Bild etwas landet und welche Farbe es bekommt, und
// keine davon brauchte je ein Custom Element. In der Panel-Klasse waren
// sie zwischen 5000 Zeilen Interaktion nur ueber die fertige Zeichnung
// zu erreichen.

const geometry = await import(
  pathToFileURL(
    join(here, "..", "custom_components", "spatial_hub", "www",
         "panel-geometry.js"),
  ).href
);
const colour = await import(
  pathToFileURL(
    join(here, "..", "custom_components", "spatial_hub", "www",
         "panel-colour.js"),
  ).href
);

const FRAME = { min: 0, span: 1 };

test("die Flucht zieht beide Flanken nach innen, nicht beide nach rechts", () => {
  const floors = [{ id: "eg" }];
  const at = (x, y) =>
    geometry.projectOnto({ frame: FRAME, gutter: 150, floors, index: 0 }, x, y);
  // Hinten ist schmaler als vorne -- das ist die ganze Flucht.
  const frontWidth = at(1, 1).x - at(0, 1).x;
  const backWidth = at(1, 0).x - at(0, 0).x;
  assert.ok(backWidth < frontWidth, "die Hinterkante ist schmaler");
  // Und zwar von der Mitte aus: die linke Kante weicht nach rechts,
  // die rechte nach links. Gleichsinnig waere das Haus gekippt.
  assert.ok(at(0, 0).x > at(0, 1).x, "die linke Wand weicht nach rechts");
  assert.ok(at(1, 0).x < at(1, 1).x, "die rechte Wand weicht nach links");
});

test("es gibt nichts mehr, was schwebt", () => {
  // planeLift/skyOf sind weg. Ein Rest davon im Quelltext waere ein
  // Abstand, den irgendwann wieder jemand addiert.
  assert.equal(geometry.planeLift, undefined);
  assert.equal(geometry.skyOf, undefined);
});

test("eine Etage mehr macht die Zeichnung hoeher, nicht enger", () => {
  const one = geometry.stackHeight([{ id: "eg" }]);
  const two = geometry.stackHeight([{ id: "eg" }, { id: "og" }]);
  assert.ok(two > one, "das Bild waechst mit dem Haus");
});

test("Shift schaltet das Raster ab, nicht die Grenzen", () => {
  assert.equal(geometry.snapTo(0.313, FRAME), 0.32);
  assert.equal(geometry.snapTo(0.313, FRAME, true), 0.313);
  assert.equal(geometry.snapTo(4, FRAME, true), 1, "ausserhalb ist kein Ort");
  assert.equal(geometry.snapTo(-4, FRAME, true), 0);
});

test("eine Wand in Reichweite gewinnt gegen das Raster", () => {
  // 0.5 ist ein Rasterpunkt, 0.507 waere darauf zurueckgefallen.
  assert.equal(geometry.magnetTo(0.507, [0.51], FRAME), 0.51);
  // Zu weit weg: das Raster entscheidet wieder.
  assert.equal(geometry.magnetTo(0.507, [0.9], FRAME), 0.5);
  // Shift schaltet auch den Magneten ab.
  assert.equal(geometry.magnetTo(0.507, [0.51], FRAME, true), 0.507);
});

test("eine kleinere Zeichnung wird mittig festgenagelt, keine grosse", () => {
  // Groesser als das Fenster: kein Spalt an beiden Enden.
  assert.deepEqual(geometry.panRange(1000, 2000, 1), [-1000, 0]);
  // Kleiner: beide Grenzen gleich, also genau in der Mitte.
  const [low, high] = geometry.panRange(1000, 400, 1);
  assert.equal(low, high);
  // Noch kein Layout: raten waere schlechter als nichts tun.
  assert.equal(geometry.panRange(0, 400, 1), null);
});

test("das Theme schlaegt Home Assistant schlaegt den Fallback des Hubs", () => {
  const theme = {
    state_colors: { online: "rebeccapurple" },
    fallback: { state_colors: { eigen: "teal" } },
  };
  assert.equal(colour.stateColour(theme, "online"), "rebeccapurple");
  assert.equal(colour.stateColour(theme, "offline"), colour.HA_COLOURS.offline);
  assert.equal(colour.stateColour(theme, "eigen"), "teal");
  assert.equal(colour.stateColour(theme, "nie gehoert"), colour.STATE_SPARE);
});

test("ein Provider ist so deutlich wie seine klarste sichtbare Ebene", () => {
  const layers = [
    { provider_id: "a", opacity: 0.2 },
    { provider_id: "a", opacity: 0.8 },
    { provider_id: "a", opacity: 1, visible: false },
    { provider_id: "b", opacity: 0.1 },
  ];
  assert.equal(colour.providerOpacity(layers, "a:eins"), 0.8);
  // Kein Wort dazu heisst voll da, nicht unsichtbar.
  assert.equal(colour.providerOpacity(layers, "c:eins"), 1);
});
