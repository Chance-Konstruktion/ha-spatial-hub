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
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

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
                      confirm: () => true };

const here = dirname(fileURLToPath(import.meta.url));
const { FloorplanHubPanel, HA_COLOURS } = await import(
  pathToFileURL(
    join(here, "..", "custom_components", "floorplan_hub", "www",
         "floorplan-hub-panel.js"),
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
                                 floor = "eg" } = {}) {
  const instance = new FloorplanHubPanel();
  instance._floorId = floor === null ? "__all__" : floor;
  instance._model = data;
  instance._edit = edit;
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

test("a node with no floor is shown on every floor rather than nowhere", () => {
  const view = panel(model({ nodes: [node("a:homeless", { floor_id: null })] }));
  assert.equal(view._visibleNodes.length, 1);
  view._floorId = "og";
  assert.equal(view._visibleNodes.length, 1, "still visible upstairs");
  assert.match(view._nodeHtml(view._visibleNodes[0]), /floorless/);
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
  const view = panel();
  assert.match(view._sparklineHtml([{ value: 5 }]), /Zu wenig Verlauf/);
  assert.match(view._sparklineHtml([{ value: 1 }, { value: 2 }]), /<polyline/);
});

test("a constant series does not divide by zero", () => {
  const view = panel();
  const html = view._sparklineHtml([{ value: 7 }, { value: 7 }, { value: 7 }]);
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

test("only an admin is offered the pencil", () => {
  assert.match(panel()._headerHtml(), /data-toggle-edit/);
  assert.doesNotMatch(panel(model(), { admin: false })._headerHtml(),
                      /data-toggle-edit/);
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
  const view = panel(model(), { edit: true });
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
  const view = panel(model(), { edit: true });
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
  const view = panel(model(), { edit: true });
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

test("the same point on a higher storey is drawn higher up", () => {
  const view = panel(model(), { floor: null });
  const upper = view._project(0, 0.5, 0.5);
  const lower = view._project(1, 0.5, 0.5);

  assert.equal(upper.x, lower.x);
  assert.ok(upper.y < lower.y, "the storeys would sit on top of each other");
});

test("the back of a storey is sheared right, which is what makes it a solid", () => {
  const view = panel(model(), { floor: null });
  assert.ok(view._project(0, 0, 0).x > view._project(0, 0, 1).x);
});

test("many storeys are squeezed instead of running off the bottom", () => {
  const data = model();
  data.floors = ["a", "b", "c", "d", "e", "f"].map((id, level) => ({
    id, name: id.toUpperCase(), level, icon: "",
  }));
  const view = panel(data, { floor: null });

  assert.ok(view._project(5, 1, 1).y <= 1000, "the bottom storey is off-canvas");
});

test("a node on no storey at all is drawn, not silently missing", () => {
  const data = model({ nodes: [node("a:lost", { floor_id: null })] });
  const view = panel(data, { floor: null });

  assert.match(view._stackHtml(), /floorless/);
  assert.match(view._stackHtml(), /a:lost/);
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

test("a crowded storey hides its labels until you point at one", () => {
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
  assert.deepEqual(view._frame, { min: 0, span: 1 });
  assert.match(view._areasHtml(), /left:25%/);
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
  const source = readFileSync(
    join(here, "..", "custom_components", "floorplan_hub", "www",
         "floorplan-hub-panel.js"),
    "utf8",
  );
  assert.match(source, /scale\(calc\(var\(--node-scale,1\) \/ var\(--camera-zoom,1\)\)\)/);
  assert.match(source, /scale:calc\(1 \/ var\(--camera-zoom, 1\)\)/);
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
  const view = panel(model(), { edit: true });
  const written = [];
  view._setLayout = FloorplanHubPanel.prototype._setLayout;
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

test("a plan smaller than the window stays inside it", () => {
  const view = framed(panel(), { viewport: 1000, canvas: 1000 });
  view._view = { zoom: 0.5, x: -400, y: 900 };
  view._applyCamera();

  assert.equal(view._view.x, 0, "not off the left edge");
  assert.equal(view._view.y, 500, "and no further than its own height allows");
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
  const source = readFileSync(
    join(here, "..", "custom_components", "floorplan_hub", "www",
         "floorplan-hub-panel.js"),
    "utf8",
  );
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
  const source = readFileSync(
    join(here, "..", "custom_components", "floorplan_hub", "www",
         "floorplan-hub-panel.js"),
    "utf8",
  );
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
