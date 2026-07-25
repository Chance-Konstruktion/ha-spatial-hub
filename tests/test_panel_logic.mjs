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
const { FloorplanHubPanel, QUALITY } = await import(
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

const model = (overrides = {}) => ({
  api_version: 1,
  hidden: { nodes: [], areas: [] },
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
function panel(data = model(), { admin = true, edit = false } = {}) {
  const instance = new FloorplanHubPanel();
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
  for (const [quality, colour] of Object.entries(QUALITY)) {
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
  assert.match(html, /--node-color:var\(--primary-color/);
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
  assert.match(html, /class="area"/, "the areas alone are already your home");
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

test("the grip resizes the area around its centre", () => {
  const view = panel(model(), { edit: true });
  const area = element({ "data-area": "wohnzimmer" }, { left: 250, top: 500 });
  const grip = element({ "data-resize-area": "wohnzimmer" });
  view._onPointerDown(pointer(0, 0, { target: [grip, area, stage()] }));

  view._onPointerMove(pointer(450, 700));
  view._onPointerUp();

  assert.deepEqual(view._written, [
    ["areas", "wohnzimmer", { size: { width: 0.4, height: 0.4 } }],
  ]);
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
