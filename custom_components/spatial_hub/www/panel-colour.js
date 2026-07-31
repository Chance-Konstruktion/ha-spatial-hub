/**
 * Wie aus dem gemeinsamen Vokabular eine Farbe wird -- ohne DOM, ohne
 * Zustand, ohne Panel.
 *
 * Der Hub loest Themes auf und schickt das Ergebnis mit dem Modell. Was
 * hier steht, ist nur die Reihenfolge, in der ein Renderer die Antworten
 * abfragt: erst das Theme, dann das, wozu Home Assistant selbst eine
 * Meinung hat, dann der Fallback des Hubs. Genau diese Reihenfolge muss
 * ein zweiter Renderer kennen, damit beide dasselbe Wort gleich faerben.
 *
 * Reine Funktionen ueber Theme, Modell und Knoten: kein `this`, kein
 * Element, keine Seiteneffekte. Deshalb sind sie hier und nicht in der
 * Panel-Klasse -- dort waren sie zwischen 5000 Zeilen Interaktion nicht
 * einzeln pruefbar, obwohl an ihnen haengt, welche Farbe der Nutzer sieht.
 *
 * Kein Build, kein Bundle: Der Browser laedt das als ES-Modul direkt.
 */

import { houseWeight } from "./panel-geometry.js";

/** Colours Home Assistant already has an opinion about, so a plan sits in
 *  whatever theme the user chose rather than in one of our own. Keyed by
 *  the shared vocabulary, never by a provider's private word. */
const HA_COLOURS = {
  online: "var(--success-color, #4caf50)",
  offline: "var(--error-color, #f44336)",
  unknown: "var(--disabled-text-color, #9e9e9e)",
  good: "var(--success-color, #4caf50)",
  fair: "var(--warning-color, #ff9800)",
  poor: "var(--error-color, #f44336)",
};

/** Which provider a namespaced id belongs to. */
const providerOf = (itemId) => String(itemId || "").split(":")[0];

/** A colour for one word of the shared vocabulary.
 *
 *  Order: what the theme says, then what Home Assistant's own theme says
 *  for the words it has an opinion about, then the hub's resolved
 *  fallback. That last step is why `on` and `off` are coloured at all:
 *  keeping a private table here meant every word the hub learned needed
 *  a change in every renderer, which is exactly what resolving themes in
 *  the hub was supposed to stop.
 */
const vocabularyColour = (theme, group, word, spare) => {
  const themed = ((theme || {})[group] || {})[word];
  if (themed) return themed;
  if (HA_COLOURS[word]) return HA_COLOURS[word];
  const fallback = ((theme || {}).fallback || {})[group] || {};
  return fallback[word] || spare;
};

const STATE_SPARE = "var(--fp-accent, var(--primary-color, #03a9f4))";
const QUALITY_SPARE = "var(--disabled-text-color, #9e9e9e)";

const stateColour = (theme, state) =>
  vocabularyColour(theme, "state_colors", state, STATE_SPARE);

const qualityColour = (theme, quality) =>
  vocabularyColour(theme, "quality_colors", quality, QUALITY_SPARE);

/** The colour of one node: what it was given, what its provider's icon set
 *  says, and only then the state vocabulary. */
const nodeColour = (theme, node, custom) =>
  node.color || (custom && custom.default_color) || stateColour(theme, node.state);

/** Theme values a renderer cannot express in CSS alone. */
const themeVars = (theme) => {
  const parts = [];
  if (!theme) return "";
  if (theme.accent) parts.push(`--fp-accent:${theme.accent}`);
  if (theme.surface) parts.push(`--fp-surface:${theme.surface}`);
  if (theme.ink) parts.push(`--fp-ink:${theme.ink}`);
  // Wie deutlich das Haus selbst da ist. Ein Grundriss ohne Innenwände
  // ist eine Fläche mit Punkten darauf und sagt nicht mehr, wo man
  // steht; ein Grundriss mit vollen Wänden erschlägt die Geräte, um die
  // es eigentlich geht. Wo dazwischen es richtig ist, weiß nur der, der
  // hinsieht -- deshalb ein Regler und keine Entscheidung.
  // Nur wenn jemand daran gedreht hat: ein Standardwert, den die Seite
  // trotzdem setzt, ist eine Vorgabe, die man nicht mehr erben kann.
  const house = houseWeight(theme);
  if (house !== 1) parts.push(`--fp-house:${house}`);
  return parts.join(";");
};

/** How solid a provider's things are drawn, from its layers.
 *
 *  The slider next to a layer wrote its value into the layout and the
 *  value came back in the model, and then nothing read it: turning a
 *  layer down did precisely nothing on screen. This is the missing half.
 *
 *  A node belongs to a provider, not to one layer, so the rule has to
 *  match the one visibility already uses: hidden when *every* layer is
 *  hidden, and here, as solid as the clearest layer the provider still
 *  has. Fading a provider out is then "turn all of its layers down",
 *  which is the same shape as hiding it.
 */
const providerOpacity = (layers, itemId) => {
  const owner = providerOf(itemId);
  const mine = (layers || []).filter(
    (layer) => (layer.provider_id || "") === owner && layer.visible !== false,
  );
  if (!mine.length) return 1;
  return mine.reduce(
    (best, layer) =>
      Math.max(best, typeof layer.opacity === "number" ? layer.opacity : 1),
    0,
  );
};

/** What to draw when nobody said anything.
 *
 *  Home Assistant's icon comes with the node, and a provider's own icon
 *  set beats even that -- an integration keeps its face on the plan. This
 *  is only the last step of the chain, and it is deliberately still an
 *  icon rather than a dot: a dot says nothing about what the thing is.
 */
const genericIcon = (providers, node) => {
  const provider = (providers || []).find(
    (candidate) => candidate.id === providerOf(node.id),
  );
  return (provider && provider.icon) || "mdi:shape-outline";
};

/** A provider's own icon for one node, if it published a set. */
const customIcon = (iconSets, node) => {
  const set = (iconSets || {})[providerOf(node.id)];
  return (set && set[node.icon]) || null;
};

export {
  HA_COLOURS,
  STATE_SPARE,
  QUALITY_SPARE,
  providerOf,
  vocabularyColour,
  stateColour,
  qualityColour,
  nodeColour,
  themeVars,
  providerOpacity,
  genericIcon,
  customIcon,
};
