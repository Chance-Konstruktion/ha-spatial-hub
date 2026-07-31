/**
 * Die Bilder für die README, aus dem echten Renderer.
 *
 * Nimmt das Modell, das `tools/demo_house.py` durch den echten Hub gedreht
 * hat, und lässt den echten `spatial-hub-panel.js` es zeichnen. Kein
 * Nachbau und keine Bildbearbeitung: Was hier herauskommt, ist, was der
 * Renderer kann -- und wenn es schlecht aussieht, ist das eine Auskunft
 * über den Renderer und nicht über das Skript.
 *
 *     python3 tools/demo_house.py > /tmp/demo.json
 *     node tools/shots.mjs /tmp/demo.json docs/images
 *
 * Braucht `playwright` und einen Chromium. Läuft absichtlich nicht in der
 * CI: Bilder wollen angesehen werden, nicht abgehakt.
 */

import { readFileSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { chromium } from "playwright";

// Das Panel definiert beim Laden ein Custom Element und fasst genau zwei
// Browser-Globals an. Mehr braucht es nicht, um sein HTML zu erzeugen.
globalThis.HTMLElement = class {
  attachShadow() {
    return { append() {}, childElementCount: 0 };
  }
  addEventListener() {}
};
globalThis.customElements = { define() {} };
globalThis.window = {
  addEventListener() {}, removeEventListener() {},
  confirm: () => true, innerWidth: 1600, innerHeight: 1000,
};

const here = dirname(fileURLToPath(import.meta.url));
const panelPath = join(
  here, "..", "custom_components", "spatial_hub", "www", "spatial-hub-panel.js",
);
const { SpatialHubPanel } = await import(pathToFileURL(panelPath).href);
// Importiert, nicht aus dem Quelltext geschnitten. Hier stand einmal ein
// `source.indexOf("const STYLES = \`")` -- das lief, solange niemand die
// Datei anfasste, und war genau deshalb eine Falle.
const { STYLES: styles } = await import(
  pathToFileURL(join(here, "..", "custom_components", "spatial_hub", "www",
                     "panel-styles.js")).href
);

const [modelPath, outDir = join(here, "..", "docs", "images")] =
  process.argv.slice(2);
if (!modelPath) {
  console.error("usage: node tools/shots.mjs <model.json> [out-dir]");
  process.exit(2);
}
const model = JSON.parse(readFileSync(modelPath, "utf8"));
mkdirSync(resolve(outDir), { recursive: true });

/** Ein Panel im gewünschten Zustand, ohne DOM dahinter. */
const panel = (set = () => {}) => {
  const view = new SpatialHubPanel();
  view._model = model;
  view._hass = { user: { is_admin: true }, callWS: async () => ({}) };
  view._floorId = "__all__";
  set(view);
  return view;
};

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM
    || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
});

/**
 * `height` gibt den Ausschnitt vor, durch den man auf den Plan sieht --
 * im Panel ist das Home Assistants Fenster. `null` heißt: so hoch wie die
 * Zeichnung selbst. Das ist für das Haus richtig, denn ein Stapel aus
 * fünf Etagen ist hoch, und ihn in einen Ausschnitt zu zwängen heißt, ihn
 * unten abzuschneiden -- was genau das verdeckt, was das Bild zeigen soll.
 */
const shoot = async (name, view, { width, height = null, body }) => {
  const page = await browser.newPage({
    viewport: { width, height: height || 800 }, deviceScaleFactor: 2,
  });
  await page.setContent(`<!doctype html><meta charset="utf8">
    <style>
      body { margin:0; background:var(--card-background-color,#fff);
             font-family:Roboto,-apple-system,system-ui,sans-serif; }
      ${styles}
      /* Im Panel begrenzt "max-height" den Ausschnitt auf das Fenster von
         Home Assistant. Hier gibt es kein Fenster, nur ein Bild -- und ein
         Bild, das die unterste Etage abschneidet, zeigt kein Haus. */
      .viewport { height:${height ? `${height - 40}px` : "auto"};
                  max-height:${height ? `${height - 40}px` : "none"}; }
    </style>
    <div class="app" style="${view._themeVars || ""}">${body(view)}</div>`);
  const file = join(resolve(outDir), `${name}.png`);
  await page.screenshot({ path: file, fullPage: !height });
  await page.close();
  console.log(file);
};

// 1 — Das ganze Haus. Das Bild, für das die Ansicht gemacht ist: eine
//     Verbindung zwischen zwei Stockwerken ist in keiner Einzelansicht zu
//     sehen, hier schon.
//
//     Ohne festen Ausschnitt: die Zeichnung gibt die Höhe vor. Mit einem
//     festen war die halbe Seite leer und das Untergeschoss trotzdem
//     abgeschnitten -- beides auf einmal, weil eine geratene Zahl weder
//     die eine noch die andere Sache trifft.
await shoot("haus", panel(), {
  width: 900,
  body: (view) => view._stackHtml(),
});

// 2 — Eine Etage, wie man sie täglich ansieht.
await shoot("etage", panel((view) => { view._floorId = "eg"; }), {
  width: 1100, height: 620,
  body: (view) => view._stageHtml(),
});

// 3 — Der Editor: die Kontur der Etage darunter, und das Menü der rechten
//     Maustaste auf einem Raum.
await shoot(
  "editor",
  panel((view) => {
    view._floorId = "og";
    view._edit = true;
    view._editWhat = "rooms";
    view._ghosts = true;
    const room = model.areas.find((area) => area.floor_id === "og");
    view._menu = { kind: "area", id: room && room.id, x: 470, y: 250 };
  }),
  {
    width: 1100, height: 720,
    body: (view) => `${view._stageHtml()}${view._menuHtml()}`,
  },
);

await browser.close();
