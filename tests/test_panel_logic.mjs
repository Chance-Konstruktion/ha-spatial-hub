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
function panel(data = model()) {
  const instance = new FloorplanHubPanel();
  instance._model = data;
  instance._hass = { user: { is_admin: true } };
  return instance;
}

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

test("no providers yet says so instead of showing a blank rectangle", () => {
  const view = panel(model({ providers: [], nodes: [], edges: [] }));
  assert.match(view._stageHtml(), /Noch kein Provider/);
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
