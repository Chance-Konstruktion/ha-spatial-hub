/**
 * Spatial Hub -- die Zahlen und Woerter, an denen mehr als eine Datei haengt.
 *
 * Sie standen bis zur Aufteilung im Panel selbst. Dort koennen sie nicht
 * bleiben: Ansicht und Eingaben liegen jetzt in eigenen Dateien und
 * brauchen dieselben Werte. Aus dem Panel zu importieren waere ein Ring
 * -- das Panel importiert die beiden, die beiden das Panel -- und Ringe
 * halten in ES-Modulen zwar, brechen aber beim ersten Umsortieren der
 * Importe auf eine Art, die niemand sucht.
 *
 * Was hier steht, ist deshalb bewusst nur das Geteilte, nicht alles
 * Konstante: eine Zahl, die genau eine Datei braucht, gehoert in diese
 * Datei.
 */

export const DOMAIN = "spatial_hub";

/** Fallback edge colours by the shared quality vocabulary. The hub's
 *  theme wins where it states one; these are what "inherit" means. */
/** The stacked view: every floor at once, which is the only view in which
 *  a connection between two storeys is visible at all. Per-floor tabs stay
 *  for detail and for arranging -- dragging in a sheared projection would
 *  be guesswork. */
export const ALL_FLOORS = "__all__";

// How far the camera may be pushed in either direction. Beyond this a plan
// is either a single icon or a smear, and the way back is not obvious.
export const ZOOM = { min: 0.4, max: 6, step: 1.15 };

/** Wie voll "einpassen" das Fenster macht. 0.9 der knapperen Achse: das
 *  Haus fuellt den Blick, behaelt aber einen Rand -- randlos sieht nicht
 *  nach Uebersicht aus, sondern nach abgeschnitten. */
export const FIT = { fill: 0.9 };

/** Ab wann ein Bildschirm ein Telefon ist -- dieselbe Grenze wie im
 *  Stylesheet, damit Vollbild und Umbruch nicht bei verschiedenen
 *  Breiten umschalten und sich gegenseitig widersprechen. */
export const PHONE = 760;

/** Das Legendenblatt: wie weit man ziehen muss, damit es zubleibt, und
 *  ab welcher Wurfgeschwindigkeit die Strecke egal ist. Ein Blatt, das
 *  nur bei genau der richtigen Zugweite schliesst, fuehlt sich kaputt an;
 *  ein schneller Wisch nach unten meint immer "weg damit". */
export const SHEET = { close: 0.3, fling: 0.5 };

/** How many devices in one room turn into a single badge instead of one
 *  icon each. Past this, overlapping icons stop reading as separate
 *  devices and start reading as clutter -- the same point where labels
 *  already switch to stacking (see `_crowded`), one further step. */
export const CLUSTER_THRESHOLD = 3;

export const pretty = (key) =>
  String(key).replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());

export const formatValue = (value) => {
  if (value === null || value === undefined || value === "") return "–";
  if (typeof value === "boolean") return value ? "ja" : "nein";
  if (Array.isArray(value)) return value.join(", ");
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
};
