/**
 * Spatial Hub -- the built-in renderer.
 *
 * One of possibly many. It talks to the hub over the documented websocket
 * commands and nothing else: no imports from the integration, no knowledge
 * of which integrations produced the data. A node from the first provider
 * ever written and a node from one written next year are drawn by the same
 * code, and this file never learns either name. A test enforces that.
 *
 * Plain ES module on purpose -- no build step, no bundle, no npm. What is
 * in the repository is what the browser runs.
 */

import { STYLES } from "./panel-styles.js";
import { haTransport } from "./panel-transport.js";
import {
  STACK,
  centreOf,
  insetOf,
  along,
  wallRuns,
  capsOf,
  wallsOf,
  FRONT_WALL,
  BACK_WALL,
  houseMetres,
  metre,
  houseWeight,
  snapReach,
  frameOf,
  spanY,
  minY,
  yFrame,
  inFrame,
  inFrameY,
  RECTANGLE,
  shapeOf,
  hasShape,
  CLOUD_PATH,
  CLOUD_SVG,
  boxOf,
  SIDE,
  SIDE_NAME,
  JOIN_GAP,
  SNAP_REACH,
  joinable,
  unjoined,
  joinsOf,
  drawsTheWall,
  AREA_KIND,
  kindOf,
  fold,
  doorsOf,
  SIDE_NAMES,
  sideName,
  STAIR_WORDS,
  isStairs,
  planeLift,
  projectOnto,
  stackHeight,
  stackWidth,
  snapTo,
  magnetTo,
  wallLinesOf,
  flushWith,
  panRange,
  touchSpan,
} from "./panel-geometry.js";
import {
  HA_COLOURS,
  providerOf,
  vocabularyColour,
  stateColour,
  qualityColour,
  nodeColour,
  themeVars,
  providerOpacity,
  genericIcon,
  customIcon,
} from "./panel-colour.js";
import {
  roomPolygon,
  cornerHandlesHtml,
  doorsHtml,
  sparklineHtml,
  escapeHtml,
} from "./panel-markup.js";

const DOMAIN = "spatial_hub";

/** Fallback edge colours by the shared quality vocabulary. The hub's
 *  theme wins where it states one; these are what "inherit" means. */
/** The stacked view: every floor at once, which is the only view in which
 *  a connection between two storeys is visible at all. Per-floor tabs stay
 *  for detail and for arranging -- dragging in a sheared projection would
 *  be guesswork. */
const ALL_FLOORS = "__all__";

// How far the camera may be pushed in either direction. Beyond this a plan
// is either a single icon or a smear, and the way back is not obvious.
const ZOOM = { min: 0.4, max: 6, step: 1.15 };

/** Wie voll "einpassen" das Fenster macht. 0.9 der knapperen Achse: das
 *  Haus fuellt den Blick, behaelt aber einen Rand -- randlos sieht nicht
 *  nach Uebersicht aus, sondern nach abgeschnitten. */
const FIT = { fill: 0.9 };

/** Ab wann ein Bildschirm ein Telefon ist -- dieselbe Grenze wie im
 *  Stylesheet, damit Vollbild und Umbruch nicht bei verschiedenen
 *  Breiten umschalten und sich gegenseitig widersprechen. */
const PHONE = 760;

/** Das Legendenblatt: wie weit man ziehen muss, damit es zubleibt, und
 *  ab welcher Wurfgeschwindigkeit die Strecke egal ist. Ein Blatt, das
 *  nur bei genau der richtigen Zugweite schliesst, fuehlt sich kaputt an;
 *  ein schneller Wisch nach unten meint immer "weg damit". */
const SHEET = { close: 0.3, fling: 0.5 };

/** How many devices in one room turn into a single badge instead of one
 *  icon each. Past this, overlapping icons stop reading as separate
 *  devices and start reading as clutter -- the same point where labels
 *  already switch to stacking (see `_crowded`), one further step. */
const CLUSTER_THRESHOLD = 3;

const pretty = (key) =>
  String(key).replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());

const formatValue = (value) => {
  if (value === null || value === undefined || value === "") return "–";
  if (typeof value === "boolean") return value ? "ja" : "nein";
  if (Array.isArray(value)) return value.join(", ");
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
};

class SpatialHubPanel extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._model = null;
    this._error = null;
    // The house as a whole is the first thing to show. A single storey
    // is a detail of it, not the other way round.
    this._floorId = ALL_FLOORS;
    this._selected = null; // { kind, id }
    // The room whose shared walls are on show. Not a selection in the
    // popup sense -- clicking a room in room mode asks "what is this room
    // attached to", and nothing else on screen should change.
    this._joinArea = null;
    // What the last drag changed in Home Assistant itself, kept only long
    // enough to offer taking it back.
    this._moved = null;
    this._history = null;
    this._placing = null; // { section, key } -- next stage click places it
    this._showDiagnostics = false;
    this._diagnostics = null;
    this._unsubscribe = null;
    this._pending = false;
    this._edit = false;
    // Bearbeiten heißt zweierlei, und beides gleichzeitig heißt keins von
    // beiden: Wände ziehen zwischen zwanzig Gerätepunkten trifft immer den
    // Punkt, und ein Gerät einsortieren zwischen lauter Anfassern trifft
    // immer den Anfasser. Also nacheinander -- Räume oder Geräte.
    this._editWhat = "rooms";
    // Maße sind für die, die es genau wollen -- und für niemanden sonst.
    // Ohne sie bleibt der Editor eine Zeichnung, die auch ein Kind
    // bedienen kann: ziehen, bis es aussieht wie zu Hause.
    this._meters = false;
    this._drag = null; // live pointer drag, never persisted until release
    this._dragged = false; // suppresses the click that follows a drag
    this._floorDialog = false;
    this._themeDialog = false;
    this._layerDialog = null; // the custom layer being written
    this._areaDialog = null; // the area whose kind is being set
    this._clusterOpen = null; // the area whose device list is open
    this._shapeEdit = null; // the custom shape currently reshaped by corners
    this._shapeDialog = null; // the custom shape whose name/colour is being set
    this._menu = null; // {x, y, kind, id}: the right-click menu, if open
    this._press = null; // a finger being held still, on its way to the menu
    this._showEntities = false; // the device's entity list, in the popup
    // The legend starts folded away. It is a reference, not a destination:
    // the first thing somebody wants to see is their house, not a list of
    // the layers it is made of. One click opens it and it stays open.
    // Auf einem hohen schmalen Bildschirm war sie frueher offen, weil der
    // Plan von der Breite begrenzt war und die untere Haelfte sonst leer
    // blieb. Auf dem Telefon fuellt der Plan jetzt den Schirm, und die
    // Legende liegt als Blatt darueber -- offen zu starten hiesse dort,
    // ein Drittel des Hauses zuzudecken, bevor es jemand gesehen hat.
    this._legendOpen =
      typeof window !== "undefined" && window.innerHeight && !this._isPhone()
        ? window.innerHeight / window.innerWidth > 1.9
        : false;
    // Vollbild auf dem Telefon: der Grundriss bekommt den Schirm, die
    // Leisten kommen auf Knopfdruck zurueck. Auf einem Monitor ist Platz
    // fuer beides, und eine Kopfzeile, die man erst hervorholen muss,
    // waere dort nur eine Klickstrecke mehr.
    this._bars = !this._isPhone();
    // Wie weit das Legendenblatt gerade nach unten gezogen ist, in Pixeln.
    // Nur waehrend der Geste gesetzt; danach ist es entweder offen oder
    // zu, und nichts dazwischen.
    this._sheet = null;
    // The other storeys' walls, shown while editing. On by default: the
    // whole point is to notice the drift without having gone looking for
    // a setting first.
    this._ghosts = true;
    // Corner editing, off by default: most rooms really are rectangles,
    // and eight wall handles are the right answer until one is not.
    this._corners = false;
    this._facets = null;
    // The camera. One per view, shared by the stacked and the single
    // floor: zooming in, switching tabs and finding the same magnification
    // is what "the behaviour is identical everywhere" means.
    this._view = { zoom: 1, x: 0, y: 0 };
    this._pan = null;
    this._pinch = null;
    this._search = "";
    // Every layout write, with the value it replaced. That pair is all an
    // undo needs, and it makes redo the same operation the other way round.
    this._undo = [];
    this._redo = [];
    // Die einzige Verbindung nach draussen. Austauschbar ueber den
    // Setter unten -- siehe den Vertrag in panel-transport.js.
    this._io = haTransport(this);
  }

  /** Womit dieser Renderer nach draussen spricht.
   *
   *  Ab Werk Home Assistant. Wer ihn woanders einsetzt, setzt hier ein
   *  eigenes Objekt mit denselben fuenf Methoden ein -- danach kommt in
   *  dieser Datei kein `hass` mehr vor.
   */
  set transport(io) {
    this._io = io;
    // Ohne Home Assistant faellt der `hass`-Setter aus, der sonst den
    // ersten Abruf ausloest. Wer einen eigenen Transport einsetzt, hat
    // damit alles gesagt, was zum Anfangen noetig ist.
    if (!this._unsubscribe && !this._model) this._connect();
  }

  get transport() {
    return this._io;
  }

  get _canEdit() {
    return this._io.canEdit();
  }

  /** Home Assistants Eingang -- die letzte Stelle, die seinen Namen kennt.
   *
   *  Home Assistant setzt diese Eigenschaft von aussen und tauscht das
   *  Objekt bei jeder Zustandsaenderung aus. Sie kann deshalb nicht in den
   *  Transport wandern; sie ist die Tuer, durch die er sein `hass`
   *  ueberhaupt bekommt. Gelesen wird es nur dort -- siehe
   *  panel-transport.js. Wer den Renderer anderswo einsetzt, ruehrt diese
   *  Eigenschaft nicht an und setzt stattdessen `transport`.
   */
  set hass(hass) {
    const first = !this._hass;
    this._hass = hass;
    if (first) this._connect();
  }

  get hass() {
    return this._hass;
  }

  set narrow(value) {
    this._narrow = value;
  }

  connectedCallback() {
    this._renderShell();
    // Ein gedrehtes Telefon ist ein anderer Bildschirm: quer ist Platz
    // fuer die Leisten, hoch nicht. Ohne das bliebe das Vollbild an der
    // Breite haengen, die beim Oeffnen zufaellig galt.
    if (typeof window !== "undefined" && window.addEventListener) {
      this._onResize = () => {
        const phone = this._isPhone();
        if (phone === this._wasPhone) return;
        this._wasPhone = phone;
        this._bars = !phone;
        if (this._model) this._render();
      };
      this._wasPhone = this._isPhone();
      window.addEventListener("resize", this._onResize);
    }
    if (this._hass && !this._unsubscribe) this._connect();
  }

  disconnectedCallback() {
    if (this._onResize && typeof window !== "undefined") {
      window.removeEventListener("resize", this._onResize);
      this._onResize = null;
    }
    if (this._unsubscribe) {
      Promise.resolve(this._unsubscribe).then((off) => off && off());
      this._unsubscribe = null;
    }
  }

  // ── Data ────────────────────────────────────────────────

  async _connect() {
    await this._refresh();
    try {
      // The hub pushes a reason, never the model: a renderer that does not
      // care about the changed layer simply ignores the hint.
      this._unsubscribe = await this._io.subscribe(
        { type: `${DOMAIN}/subscribe` },
        () => this._refresh(),
      );
    } catch (err) {
      // Losing live updates is not worth losing the floor plan over.
      console.warn("Spatial Hub: no live updates", err);
    }
  }

  async _refresh() {
    if (this._pending) return;
    this._pending = true;
    try {
      this._model = await this._io.call({ type: `${DOMAIN}/model` });
      this._error = null;
    } catch (err) {
      this._error = err && err.message ? err.message : String(err);
    } finally {
      this._pending = false;
    }
    if (this._showDiagnostics) await this._loadDiagnostics();
    this._render();
  }

  async _loadDiagnostics() {
    try {
      this._diagnostics = await this._io.call({
        type: `${DOMAIN}/diagnostics`,
      });
    } catch (err) {
      this._diagnostics = { providers: {}, error: String(err) };
    }
  }

  /** Persist one piece of the arrangement.
   *
   *  `previous` is what the values were before, and passing it is what
   *  makes the change undoable: the pair is a complete description of the
   *  step in both directions, so undo and redo are the same call.
   */
  async _setLayout(section, key, values, previous) {
    if (previous !== undefined) {
      this._undo.push({ section, key, values, previous });
      // A new change makes the abandoned future unreachable, which is what
      // every editor does and what users expect when they carry on.
      this._redo = [];
      if (this._undo.length > 50) this._undo.shift();
    }
    try {
      await this._io.call({
        type: `${DOMAIN}/layout/set`,
        section,
        key,
        values,
      });
    } catch (err) {
      this._error = err && err.message ? err.message : String(err);
      this._render();
    }
  }

  /** Which room a point on this floor is in.
   *
   *  The smallest one that contains it. Rooms overlap -- a hallway drawn
   *  under a stairwell -- and the smaller of two is always the more
   *  specific answer.
   */
  _areaAt(x, y, floorId) {
    let best = null;
    let smallest = Infinity;
    for (const area of this._visibleAreas) {
      if (!area.position || area.floor_id !== floorId) continue;
      if (kindOf(area) === AREA_KIND.VIRTUAL) continue;
      const box = boxOf(area);
      if (x < box.left || x > box.right || y < box.top || y > box.bottom) continue;
      const size = (box.right - box.left) * (box.bottom - box.top);
      if (size < smallest) {
        smallest = size;
        best = area;
      }
    }
    return best;
  }

  /** A dot dragged into another room moves the thing itself.
   *
   *  This is the one gesture that writes outside the hub, so it says so:
   *  the plan gets a line above it naming what moved where, with a way
   *  back. Everything else in this panel arranges a picture; this changes
   *  the configuration every dashboard and every automation reads, and a
   *  change like that must never be silent.
   */
  async _moveIntoArea(node, x, y) {
    if (!this._canEdit || !node || !node.entity_id) return;
    const room = this._areaAt(x, y, node.floor_id);
    const from = node.area_id || null;
    const to = room ? room.id : null;
    if (to === from || (!room && !from)) return;

    try {
      const done = await this._io.call({
        type: `${DOMAIN}/area/assign`,
        entity_id: node.entity_id,
        area_id: to,
      });
      this._moved = {
        label: node.label,
        room: room ? room.name : "keinem Bereich",
        entity_id: node.entity_id,
        ...done,
      };
    } catch (err) {
      this._error = err && err.message ? err.message : String(err);
    }
    this._render();
  }

  /** Put back whatever the last drag changed in Home Assistant. */
  async _undoMove() {
    const move = this._moved;
    this._moved = null;
    if (!move) {
      this._render();
      return;
    }
    try {
      await this._io.call({
        type: `${DOMAIN}/area/assign`,
        entity_id: move.entity_id,
        area_id: move.before,
        scope: move.scope,
      });
    } catch (err) {
      this._error = err && err.message ? err.message : String(err);
    }
    this._render();
  }

  async _undoStep() {
    const step = this._undo.pop();
    if (!step) return;
    this._redo.push(step);
    await this._setLayout(step.section, step.key, step.previous);
    this._render();
  }

  async _redoStep() {
    const step = this._redo.pop();
    if (!step) return;
    this._undo.push(step);
    await this._setLayout(step.section, step.key, step.values);
    this._render();
  }

  // ── Derived model ───────────────────────────────────────

  get _floors() {
    return (this._model && this._model.floors) || [];
  }

  get _stacked() {
    return this._floorId === ALL_FLOORS && this._floors.length > 1;
  }

  /** The coordinate window of the floor being drawn.
   *
   *  A floor with a garden shows the apron around the house as well, so
   *  everything on it is drawn through the same widened window -- rooms,
   *  nodes and the pointer arithmetic that drags them.
   */
  get _frame() {
    return frameOf(
      this._stacked ? this._widestFloor : this._floor,
      this._model.areas,
    );
  }

  /** In the stack every storey shares one window, or they would not line
   *  up: a ground floor with a garden would be drawn smaller than the one
   *  above it and the house would look like a wedding cake.
   *
   *  The widest one, not the first one that has anything outdoors. More
   *  than one storey can: a garden downstairs and a balcony upstairs. Take
   *  the first and a drawn plot on the ground floor loses to a balcony's
   *  narrow apron, which crops the garden out of its own picture.
   */
  get _widestFloor() {
    let widest = null;
    let span = 0;
    for (const floor of this._floors) {
      const frame = frameOf(floor, this._model.areas);
      // Die groessere der beiden Spannen entscheidet: ein Grundstueck,
      // das nur nach hinten reicht, macht die Etage genauso "weit" wie
      // eines, das nur nach rechts reicht.
      const reach = Math.max(frame.span, spanY(frame));
      if (reach > span) {
        span = reach;
        widest = floor;
      }
    }
    return widest;
  }

  /** Does this area appear in the stacked house view? */
  _inSandwich(item) {
    return item.in_sandwich !== false && !item.single_only;
  }

  /** Nodes matching the search box, or null when nobody is searching. */
  get _matches() {
    const needle = this._search.trim().toLowerCase();
    if (!needle) return null;
    const hit = (value) => String(value || "").toLowerCase().includes(needle);
    return new Set(
      (this._model.nodes || [])
        .filter(
          (node) =>
            hit(node.label) ||
            hit(node.entity_id) ||
            hit(node.state) ||
            hit(this._providerOf(node.id)),
        )
        .map((node) => node.id),
    );
  }

  get _floor() {
    if (this._stacked) return null;
    const floors = this._floors;
    return (
      floors.find((floor) => floor.id === this._floorId) || floors[0] || null
    );
  }

  /** Floors bottom-up in the model; drawn top-down, like a section.
   *
   *  The storey for rooms with no floor is not a storey and must not be
   *  reversed into the attic: it stays at the bottom, where "everything
   *  else" belongs.
   */
  get _stackFloors() {
    const floors = this._floors.filter((floor) => this._inSandwich(floor));
    const real = floors.filter(
      (floor) => !floor.unassigned && !floor.virtual,
    ).reverse();
    // Sky first, whatever order Home Assistant gave it. A cloud plane
    // that inherits its position from a floor list ends up between two
    // storeys, and the internet is not on the first floor.
    return [
      ...floors.filter((floor) => floor.virtual && !floor.unassigned),
      ...real,
      ...floors.filter((floor) => floor.unassigned),
    ];
  }

  _planeLift(floorIndex) {
    return planeLift(this._stackFloors[floorIndex]);
  }

  /** Wo ein Punkt einer Etage im Bild landet. Die Rechnung steht in
   *  `panel-geometry.js`; hier kommt nur der Rahmen dieses Panels dazu. */
  _project(floorIndex, x, y) {
    return projectOnto(
      {
        frame: this._frame,
        gutter: this._nameGutter,
        floors: this._stackFloors,
        index: floorIndex,
      },
      x,
      y,
    );
  }

  /** How tall the drawing has to be to hold the house.
   *
   *  The storeys used to be squeezed into a fixed 1000×1000 box: with a
   *  sky plane and four floors the spacing collapsed to under a third of
   *  a storey's own depth, so every floor was drawn *through* the one
   *  below it. That was the porridge -- not the line weights, the
   *  spacing. Air between the storeys is what makes them storeys, so the
   *  picture grows with the house instead of the house shrinking into
   *  the picture. The camera already scrolls and zooms; a taller drawing
   *  costs nothing but says which floor is which.
   */
  get _stackHeight() {
    return stackHeight(this._stackFloors);
  }

  /** How wide the drawing has to be. Every storey is offset a little
   *  further right than the one above it, so the bottom one decides.
   *
   *  Kein Zuschlag mehr fuer die Flucht. Die Parallelverschiebung schob
   *  die Hinterkante ueber die rechte Bildkante hinaus und musste dort
   *  wieder eingeholt werden; die Flucht zieht nach innen, also ist die
   *  Vorderkante die breiteste Stelle und `width` die ganze Wahrheit.
   */
  get _stackWidth() {
    return stackWidth(this._nameGutter, this._stackFloors.length);
  }

  /** Wieviel Platz links neben dem Haus der laengste Etagenname braucht.
   *
   *  Der Rand war lange eine feste Zahl, und die reichte fuer „EG" und
   *  „OG". Wer seine Etagen „Untergeschoss" nennt -- also so, wie Home
   *  Assistant sie selbst vorschlaegt --, bekam den Namen links
   *  abgeschnitten: das U fehlte, und aus „Obergeschoss" wurde
   *  „ergeschoss". Kein Test konnte das sehen, weil kein Test misst, wie
   *  breit Text wird; gefunden hat es das erste Bild fuer die README.
   *
   *  Geschaetzt statt gemessen: Der Name steht in einem SVG, das gezeichnet
   *  wird, bevor es im Dokument haengt -- es gibt zu diesem Zeitpunkt
   *  nichts auszumessen. Grosszuegig geschaetzt ist hier richtig, denn zu
   *  viel Rand sieht man kaum, zu wenig schneidet einen Buchstaben ab.
   */
  get _nameGutter() {
    // Eine einzelne Etage braucht die Spalte nicht. Sie ist dazu da, die
    // Stockwerke untereinander lesbar zu machen -- bei einem gibt es
    // nichts zu sortieren, und der Name steht dann oben links am Blatt
    // statt in einem Rand, der ein Drittel der Flaeche kostet.
    //
    // Das ist kein Randfall fuer eine Demo: eine Wohnung ist ein Haus mit
    // einer Etage. Wer in einer wohnt, hat bisher ein Drittel des Bildes
    // an eine Spalte verloren, in der ein einziges Wort steht.
    if (this._oneStorey) return STACK.pad;
    const longest = Math.max(
      0,
      ...this._stackFloors.map((floor) => String(floor.name || "").length),
    );
    // 30px Schriftgroesse, Grossbuchstaben, plus Sperrung -- und die 34,
    // um die der Name von der Plattenkante wegrueckt.
    return Math.max(STACK.margin, longest * 23 + 34 + STACK.pad);
  }

  /** Steht hier nur ein Stockwerk? Dann ist die Zeichnung ein Grundriss
   *  und kein Schnitt, und ein paar Entscheidungen kippen mit. */
  get _oneStorey() {
    return this._stackFloors.length <= 1;
  }

  /** Providers whose every layer is switched off.
   *
   *  Nodes carry no layer of their own -- they belong to whoever produced
   *  them. So a provider disappears when all of its layers are hidden, and
   *  a provider with several layers is never half-hidden on a guess.
   */
  get _hiddenProviders() {
    const layers = (this._model && this._model.layers) || [];
    const byProvider = {};
    for (const layer of layers) {
      const owner = layer.provider_id || "";
      byProvider[owner] = byProvider[owner] || [];
      byProvider[owner].push(layer);
    }
    return new Set(
      Object.keys(byProvider).filter((owner) =>
        byProvider[owner].every((layer) => layer.visible === false),
      ),
    );
  }

  _providerOpacity(itemId) {
    return providerOpacity((this._model && this._model.layers) || [], itemId);
  }

  /** The theme the hub resolved. Never a preset table of our own -- a
   *  second renderer must be able to agree with this one for free. */
  get _theme() {
    return (this._model && this._model.theme) || {};
  }

  _vocabularyColour(group, word, spare) {
    return vocabularyColour(this._theme, group, word, spare);
  }

  _stateColour(state) {
    return stateColour(this._theme, state);
  }

  _qualityColour(quality) {
    return qualityColour(this._theme, quality);
  }

  /** Theme values a renderer cannot express in CSS alone. */
  get _themeVars() {
    return themeVars(this._theme);
  }

  _providerOf(itemId) {
    return providerOf(itemId);
  }

  get _visibleNodes() {
    const model = this._model;
    if (!model) return [];
    const floor = this._floor;
    const hidden = this._hiddenProviders;
    const stackable = new Set(this._stackFloors.map((entry) => entry.id));
    return model.nodes.filter((node) => {
      if (hidden.has(this._providerOf(node.id))) return false;
      if (!node.position) return false;
      // A node with no floor has no place on the plan -- it gets the tray
      // underneath instead. Dropping it somewhere in the rooms was the
      // worst of both: it looked assigned, and it sat on top of a grid
      // measured without it.
      if (!node.floor_id) return false;
      // In the house view, a storey the user kept out of the sandwich
      // takes its nodes with it -- otherwise they float over the storey
      // below and read as belonging to it.
      if (!floor) return stackable.has(node.floor_id);
      return node.floor_id === floor.id;
    });
  }

  /** Everything Home Assistant has not put on a storey yet.
   *
   *  These are not drawn in the plan. They belong to no room, so any
   *  position the hub invents for them is a lie the user then has to
   *  un-believe -- and the one time it matters is precisely when they are
   *  looking for what is still unsorted. They go in a strip under the
   *  house, on every floor, because the fix is one click away in Home
   *  Assistant and nowhere in here.
   */
  get _floorlessNodes() {
    const model = this._model;
    if (!model) return [];
    const hidden = this._hiddenProviders;
    return model.nodes.filter(
      (node) => !node.floor_id && !hidden.has(this._providerOf(node.id)),
    );
  }

  get _visibleEdges() {
    const model = this._model;
    if (!model) return [];
    const known = new Map(this._visibleNodes.map((node) => [node.id, node]));
    return model.edges
      .filter((edge) => known.has(edge.source) && known.has(edge.target))
      .map((edge) => ({
        ...edge,
        from: known.get(edge.source).position,
        to: known.get(edge.target).position,
      }));
  }

  get _visibleAreas() {
    const model = this._model;
    if (!model) return [];
    const floor = this._floor;
    // Every area the hub hands over has a floor -- the ones the user never
    // assigned get a storey of their own. Drawing a floorless area on each
    // tab instead would drop it on top of that floor's real rooms, whose
    // grid was measured without it.
    return model.areas.filter((area) => {
      if (!floor) return this._inSandwich(area);
      return area.floor_id === floor.id;
    });
  }

  _node(nodeId) {
    return (this._model.nodes || []).find((node) => node.id === nodeId) || null;
  }

  _edge(edgeId) {
    return (this._model.edges || []).find((edge) => edge.id === edgeId) || null;
  }

  _capabilities(itemId) {
    const providerId = this._providerOf(itemId);
    const provider = ((this._model && this._model.providers) || []).find(
      (candidate) => candidate.id === providerId,
    );
    return (provider && provider.capabilities) || {};
  }

  _customIcon(node) {
    return customIcon((this._model && this._model.icon_sets) || {}, node);
  }

  // ── Rendering ───────────────────────────────────────────

  _renderShell() {
    if (this.shadowRoot.childElementCount) return;
    const style = document.createElement("style");
    style.textContent = STYLES;
    const root = document.createElement("div");
    root.className = "app";
    this.shadowRoot.append(style, root);
    this._root = root;
    root.addEventListener("click", (event) => this._onClick(event));
    root.addEventListener("pointerdown", (event) => this._onPointerDown(event));
    root.addEventListener("contextmenu", (event) => this._onContextMenu(event));
    root.addEventListener("input", (event) => this._onInput(event, false));
    root.addEventListener("change", (event) => this._onInput(event, true));
    root.addEventListener("wheel", (event) => {
      if (this._inViewport(event)) this._onWheel(event);
    }, { passive: false });
    root.addEventListener("touchstart", (event) => this._onTouchStart(event),
                          { passive: true });
    root.addEventListener("touchmove", (event) => this._onTouchMove(event),
                          { passive: false });
    root.addEventListener("touchend", () => this._onTouchEnd());
    root.innerHTML = `<div class="loading">Grundriss wird geladen …</div>`;
  }

  _render() {
    // Never rebuild the plan out from under a hand that is holding it.
    //
    // A drag moves one element by writing straight to its style, and the
    // hub pushes a refresh whenever any provider so much as blinks. Redraw
    // in the middle and the held element is replaced by a fresh one: the
    // room stops dead where it was, every further move writes to a node
    // that is no longer in the document -- so it also vanishes -- and it
    // only reappears when the button comes up and the next render puts it
    // back. That was reported as "the room stops after a second and is
    // suddenly hidden", and it is exactly this.
    //
    // The redraw is not dropped, only deferred: whatever arrived while the
    // hand was down is drawn the moment it lets go.
    if (this._drag || this._pan) {
      this._renderWanted = true;
      return;
    }
    this._renderWanted = false;
    this._renderShell();
    const model = this._model;
    if (this._error && !model) {
      this._root.innerHTML = `<div class="empty">
        <h2>Der Hub antwortet nicht</h2>
        <p>${escapeHtml(this._error)}</p>
      </div>`;
      return;
    }
    if (!model) return;

    this._root.setAttribute("style", this._themeVars);
    this._root.className = this._shellClasses();
    this._root.innerHTML = `
      ${this._bars || !this._isPhone() ? this._headerHtml() : ""}
      <div class="body">
        ${this._barsButtonHtml()}
        <main>${this._stageHtml()}</main>
        ${this._legendHtml()}
      </div>
      ${this._showDiagnostics ? this._diagnosticsHtml() : ""}
      ${this._floorDialog ? this._floorDialogHtml() : ""}
      ${this._themeDialog ? this._themeDialogHtml() : ""}
      ${this._layerDialog ? this._layerDialogHtml() : ""}
      ${this._areaDialog ? this._areaDialogHtml() : ""}
      ${this._shapeDialog ? this._shapeDialogHtml() : ""}
      ${this._popupHtml()}
      ${this._menuHtml()}
    `;
    // The very first plan a user ever sees must be the whole plan. The
    // stacked view is square and taller than any 16:9 window, so without
    // this it opened with the lower storeys already below the fold -- on
    // the one screen that is supposed to say "this is my home". Once only:
    // after that the camera is theirs, and a plan that snapped back to
    // fit on every refresh would be unusable.
    if (!this._fitted) {
      this._fitted = true;
      this._fitToScreen();
    } else {
      this._applyCamera();
    }
    this._revealCurrentTab();
  }

  /** Keep the storey you are on where you can see it.
   *
   *  The tab strip is one scrolling line rather than a block that grows
   *  downwards, so in a tall house the selected floor can sit outside it
   *  -- most obviously right after switching to a floor near the end.
   */
  _revealCurrentTab() {
    const tab = this._root.querySelector(".tab.on");
    if (!tab || !tab.scrollIntoView) return;
    tab.scrollIntoView({ block: "nearest", inline: "nearest" });
  }

  // ── Vollbild und das Legendenblatt ──────────────────────

  /** Ist das hier ein Telefon?
   *
   *  Nur die Breite, kein "user agent". Ein Panel neben einer offenen
   *  Seitenleiste ist genauso schmal wie ein Telefon und will dasselbe;
   *  ein Telefon im Querformat ist breit und bekommt seine Leisten
   *  zurueck, weil dort Platz dafuer ist.
   */
  _isPhone() {
    if (typeof window === "undefined" || !window.innerWidth) return false;
    return window.innerWidth <= PHONE;
  }

  /** Die Klassen am Wurzelelement: was gerade Vollbild ist und was nicht.
   *
   *  Als Klasse und nicht als Media Query, weil "Leisten aus" eine
   *  Entscheidung des Nutzers ist und keine Eigenschaft des Geraets. Die
   *  Breite bestimmt nur den Startwert.
   */
  _shellClasses() {
    const phone = this._isPhone();
    return [
      "app",
      phone ? "phone" : "",
      phone && !this._bars ? "bare" : "",
      this._legendOpen ? "legend-open" : "",
    ]
      .filter(Boolean)
      .join(" ");
  }

  /** Leisten zeigen oder verstecken.
   *
   *  Der Grundriss behaelt dabei seinen Zoom: die Flaeche waechst, das
   *  Haus bleibt, wo es war. Neu einpassen waere hier falsch -- wer
   *  hineingezoomt hat, um eine Wand zu ziehen, will nicht bei jedem
   *  Ein- und Ausblenden von vorn anfangen.
   */
  _toggleBars() {
    this._bars = !this._bars;
    this._render();
  }

  /** Das Legendenblatt nach unten wegziehen.
   *
   *  Wer einen Raum einrichtet, braucht Platz, und der Platz liegt unter
   *  dem Blatt. Ein Knopf dafuer gibt es auch, aber die Hand ist beim
   *  Konfigurieren ohnehin auf dem Blatt -- also darf sie es einfach
   *  wegschieben.
   *
   *  Waehrend der Geste wird direkt in den Stil geschrieben, nie neu
   *  gerendert: ein Neuaufbau mitten in der Bewegung ersetzt genau das
   *  Element, das der Finger gerade haelt.
   */
  _onSheetDown(event, sheet) {
    if (!sheet || !this._legendOpen) return;
    const height = sheet.offsetHeight || 1;
    this._sheet = {
      id: event.pointerId,
      from: event.clientY,
      at: event.clientY,
      time: Date.now(),
      height,
      sheet,
    };
    sheet.style.transition = "none";
    if (event.target && event.target.setPointerCapture) {
      try {
        event.target.setPointerCapture(event.pointerId);
      } catch (err) {
        /* kein Capture, kein Beinbruch: pointermove kommt trotzdem */
      }
    }
    event.preventDefault();
  }

  _onSheetMove(event) {
    const drag = this._sheet;
    if (!drag || event.pointerId !== drag.id) return;
    drag.at = event.clientY;
    // Nur nach unten. Nach oben zu ziehen wuerde das Blatt ueber den
    // Bildschirmrand schieben, und dahinter ist nichts.
    const moved = Math.max(0, drag.at - drag.from);
    drag.sheet.style.transform = `translateY(${moved}px)`;
    event.preventDefault();
  }

  /** Loslassen: entweder weit genug gezogen, oder schnell genug geworfen. */
  _onSheetUp() {
    const drag = this._sheet;
    if (!drag) return;
    this._sheet = null;
    const moved = Math.max(0, drag.at - drag.from);
    const seconds = Math.max(0.001, (Date.now() - drag.time) / 1000);
    const speed = moved / seconds / drag.height;
    drag.sheet.style.transition = "";
    drag.sheet.style.transform = "";
    if (moved > drag.height * SHEET.close || speed > SHEET.fling) {
      this._legendOpen = false;
      this._render();
    }
  }

  // ── Camera: zoom, pan, fit ──────────────────────────────

  /** The camera is CSS, not markup: panning must not rebuild the plan.
   *
   *  Same transform for the stacked view and a single floor, which is the
   *  whole point -- the wheel, two fingers and the fit button behave
   *  identically wherever the user happens to be.
   */
  _applyCamera() {
    const canvas = this._root.querySelector(".canvas");
    if (!canvas) return;
    this._clampView(canvas);
    const { zoom, x, y } = this._view;
    canvas.style.transform = `translate(${x}px, ${y}px) scale(${zoom})`;
    canvas.style.setProperty("--camera-zoom", zoom);
    this._holdStackIconSize(canvas);
    const readout = this._root.querySelector("[data-zoom-value]");
    if (readout) readout.textContent = `${Math.round(zoom * 100)} %`;
  }

  /** Keep the stacked view's markers one size, without moving them.
   *
   *  Written into the SVG `transform` attribute rather than left to the
   *  CSS `scale` property. Order is the whole point: `translate` then
   *  `scale` scales the marker *about its own anchor*, so it stays on the
   *  spot it marks. The CSS property composes the other way round and
   *  needs `transform-box`/`transform-origin` to say where the middle is
   *  -- which browsers answer differently for a group whose bounding box
   *  includes the label underneath. That is why the icons crept further
   *  from their rooms the deeper you zoomed, and why it looked right in
   *  Firefox and wrong in Chromium. An attribute has one meaning.
   */
  /** The factor that keeps a marker its own size, never larger.
   *
   *  Capped at 1 on purpose. Counter-scaling in both directions is
   *  symmetrical and wrong: zoomed *out* to see the whole house it blows
   *  every label up to full size over a plan drawn at half, and twenty
   *  devices turn into one smear of overlapping words. Zoomed in it does
   *  its job. Zoomed out, letting the lettering shrink with the plan is
   *  what makes the house readable at all.
   */
  get _counterScale() {
    return Math.min(1, 1 / this._view.zoom);
  }

  _holdStackIconSize(canvas) {
    // No real DOM (first paint, or a headless test): nothing drawn yet.
    if (!canvas || typeof canvas.querySelectorAll !== "function") return;
    const counter = this._counterScale;
    // Markers *and* lettering. Room names are drawn in the same user
    // units as the plan, so without this a room called "Ender3pKE" grows
    // into a billboard across the storey the moment anybody zooms in --
    // the text ends up shouting over the very thing it labels.
    for (const marker of canvas.querySelectorAll("[data-at-x]")) {
      const x = marker.getAttribute("data-at-x");
      const y = marker.getAttribute("data-at-y");
      if (x === null || y === null) continue;
      marker.setAttribute("transform", `translate(${x},${y}) scale(${counter})`);
    }
  }

  /** Keep the plan against the window it is drawn in.
   *
   *  Without this the map can be shoved right out of the viewport and the
   *  user is left looking at an empty rectangle with no clue which
   *  direction their house went. There is a fit button, but needing it to
   *  undo an ordinary drag is not a camera, it is a trap.
   *
   *  The bound is the drawing's own edge -- with a garden, that is the
   *  outer edge of the apron, because the apron is part of the canvas.
   *  Zoomed in, the edge may not travel inside the viewport, so the view
   *  is always full of plan. Zoomed out far enough that the whole thing
   *  fits, it simply stays inside instead.
   */
  _clampView(canvas) {
    const viewport = this._root.querySelector(".viewport");
    if (!viewport) return;
    const view = this._view;
    const clamp = (value, range) =>
      range === null ? value : Math.min(range[1], Math.max(range[0], value));

    view.x = clamp(
      view.x,
      panRange(viewport.clientWidth, canvas.offsetWidth, view.zoom),
    );
    view.y = clamp(
      view.y,
      panRange(viewport.clientHeight, canvas.offsetHeight, view.zoom),
    );
  }

  /** Zoom about a point, so what is under the cursor stays under it. */
  _zoomBy(factor, anchor) {
    const view = this._view;
    const next = Math.min(ZOOM.max, Math.max(ZOOM.min, view.zoom * factor));
    const applied = next / view.zoom;
    if (applied === 1) return;
    const viewport = this._root.querySelector(".viewport");
    const box = viewport ? viewport.getBoundingClientRect() : null;
    const point = anchor
      ? { x: anchor.x - (box ? box.left : 0), y: anchor.y - (box ? box.top : 0) }
      : { x: box ? box.width / 2 : 0, y: box ? box.height / 2 : 0 };
    view.x = point.x - (point.x - view.x) * applied;
    view.y = point.y - (point.y - view.y) * applied;
    view.zoom = next;
    this._applyCamera();
  }

  /** Back to the whole plan, centred. The way out of any lost zoom.
   *
   *  "Show everything" has to mean it. The plan is square and a screen is
   *  not, so on a wide monitor 100 % is not the whole house -- the bottom
   *  storey sits below the fold and the button that promises to fix that
   *  did nothing.
   *
   *  Es zoomt inzwischen in beide Richtungen. Nur herauszoomen hiess:
   *  ein kleiner Grundriss blieb bei 100 % in der Ecke eines grossen
   *  Monitors liegen, und "alles zeigen" zeigte vor allem Hintergrund.
   *  Ziel ist FIT.fill der knapperen Achse -- ein Rand bleibt, damit das
   *  Haus nicht am Fensterrand klebt, aber die Flaeche wird benutzt.
   */
  _fitToScreen() {
    this._view = { zoom: 1, x: 0, y: 0 };
    const canvas = this._root && this._root.querySelector(".canvas");
    const viewport = this._root && this._root.querySelector(".viewport");
    if (canvas && viewport && canvas.offsetWidth && canvas.offsetHeight) {
      const fits = Math.min(
        viewport.clientWidth / canvas.offsetWidth,
        viewport.clientHeight / canvas.offsetHeight,
      ) * FIT.fill;
      if (fits > 0) {
        this._view.zoom = Math.min(ZOOM.max, Math.max(ZOOM.min, fits));
      }
    }
    this._applyCamera();
  }

  _onWheel(event) {
    if (!event.deltaY) return;
    event.preventDefault();
    this._zoomBy(event.deltaY < 0 ? ZOOM.step : 1 / ZOOM.step, {
      x: event.clientX,
      y: event.clientY,
    });
  }

  _startPan(event) {
    const view = this._view;
    this._pan = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: view.x,
      originY: view.y,
    };
    const move = (moveEvent) => {
      if (!this._pan) return;
      moveEvent.preventDefault();
      this._view.x = this._pan.originX + (moveEvent.clientX - this._pan.startX);
      this._view.y = this._pan.originY + (moveEvent.clientY - this._pan.startY);
      // Any real movement means this was a pan, not a click on the plan.
      if (
        Math.abs(moveEvent.clientX - this._pan.startX) > 3 ||
        Math.abs(moveEvent.clientY - this._pan.startY) > 3
      ) {
        this._dragged = true;
      }
      this._applyCamera();
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      this._pan = null;
      this._flushRender();
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  /** Two fingers: the same zoom, driven by the distance between them. */
  /** Wie lange ein Finger liegen muss, und wie ruhig, fuer das Menue. */
  static get PRESS() {
    return { time: 500, slack: 10 };
  }

  _onTouchStart(event) {
    if (!event.touches) return;
    // Ein Finger, der liegen bleibt, ist die rechte Maustaste des Telefons.
    // Ohne das waere das Menue auf dem Geraet, auf dem der Plan am
    // haeufigsten angesehen wird, gar nicht erreichbar.
    if (event.touches.length === 1) {
      this._armLongPress(event.touches[0], event.composedPath
                                             ? event.composedPath() : []);
      return;
    }
    this._cancelLongPress();
    if (event.touches.length !== 2) return;
    this._pinch = {
      distance: this._touchSpan(event.touches),
      zoom: this._view.zoom,
    };
  }

  _armLongPress(touch, path) {
    this._cancelLongPress();
    const target = this._menuFor(path);
    if (!target) return;
    const from = { x: touch.clientX, y: touch.clientY };
    this._press = {
      from,
      timer: setTimeout(() => {
        this._press = null;
        // Ein Zug, der noch nicht losgelaufen ist, wird zurueckgenommen:
        // sonst haengt beim Loslassen ein Raum an einem Menue.
        if (this._drag) {
          this._drag = null;
          this._dragged = true;
        }
        this._menu = { ...target, x: from.x, y: from.y };
        this._render();
      }, SpatialHubPanel.PRESS.time),
    };
  }

  _cancelLongPress() {
    if (this._press) clearTimeout(this._press.timer);
    this._press = null;
  }

  _onTouchMove(event) {
    // Wer schiebt, will nicht auswaehlen. Ein bisschen Wackeln ist kein
    // Schieben -- eine Hand haelt nicht auf das Pixel genau still.
    if (this._press && event.touches && event.touches.length) {
      const { clientX, clientY } = event.touches[0];
      if (
        Math.hypot(clientX - this._press.from.x, clientY - this._press.from.y) >
        SpatialHubPanel.PRESS.slack
      ) {
        this._cancelLongPress();
      }
    }
    if (!this._pinch || !event.touches || event.touches.length !== 2) return;
    event.preventDefault();
    const span = this._touchSpan(event.touches);
    if (!this._pinch.distance) return;
    const target = this._pinch.zoom * (span / this._pinch.distance);
    const midpoint = {
      x: (event.touches[0].clientX + event.touches[1].clientX) / 2,
      y: (event.touches[0].clientY + event.touches[1].clientY) / 2,
    };
    this._zoomBy(
      Math.min(ZOOM.max, Math.max(ZOOM.min, target)) / this._view.zoom,
      midpoint,
    );
  }

  _onTouchEnd() {
    this._pinch = null;
    this._cancelLongPress();
  }

  _touchSpan(touches) {
    return touchSpan(touches);
  }

  /** Editing the building itself: walls, corners, the plot. */
  get _editRooms() {
    return this._edit && this._editWhat === "rooms";
  }

  /** Editing where the devices sit. Rooms hold still, dots move. */
  get _editIcons() {
    return this._edit && this._editWhat === "icons";
  }

  _inViewport(event) {
    return (event.composedPath() || []).some(
      (element) => element.classList && element.classList.contains("viewport"),
    );
  }

  _headerHtml() {
    const floors = this._floors;
    const current = this._floor;
    const stackTab = floors.length > 1
      ? `<button class="tab ${this._stacked ? "on" : ""}"
                 data-floor="${ALL_FLOORS}" title="Alle Etagen übereinander">
           <ha-icon icon="mdi:layers-triple-outline"></ha-icon> Haus
         </button>`
      : "";
    const tabs = floors
      .map(
        (floor) => `
        <button class="tab ${current && floor.id === current.id ? "on" : ""}"
                data-floor="${escapeHtml(floor.id)}">
          ${floor.icon ? `<ha-icon icon="${escapeHtml(floor.icon)}"></ha-icon>` : ""}
          ${escapeHtml(floor.name)}
        </button>`,
      )
      .join("");
    return `
      <header>
        <div class="tabs">${stackTab}${tabs}</div>
        <div class="spacer"></div>
        <label class="search" title="Gerät suchen">
          <ha-icon icon="mdi:magnify"></ha-icon>
          <input type="search" data-search="1" placeholder="Suchen"
                 value="${escapeHtml(this._search)}">
        </label>
        <div class="zoom">
          <button class="icon-btn" data-zoom="out" title="Verkleinern">
            <ha-icon icon="mdi:magnify-minus-outline"></ha-icon>
          </button>
          <span data-zoom-value>100 %</span>
          <button class="icon-btn" data-zoom="in" title="Vergrößern">
            <ha-icon icon="mdi:magnify-plus-outline"></ha-icon>
          </button>
          <button class="icon-btn" data-zoom="fit" title="Alles zeigen">
            <ha-icon icon="mdi:fit-to-screen-outline"></ha-icon>
          </button>
        </div>
        ${
          this._edit
            ? `<div class="mode" role="group" aria-label="Was wird bearbeitet">
                 <button class="chip ${this._editWhat === "rooms" ? "on" : ""}"
                         data-edit-what="rooms"
                         title="Räume: Wände ziehen, Ecken setzen, Grundstück">
                   <ha-icon icon="mdi:floor-plan"></ha-icon> Räume
                 </button>
                 <button class="chip ${this._editWhat === "icons" ? "on" : ""}"
                         data-edit-what="icons"
                         title="Geräte: Punkte in ihre Räume sortieren">
                   <ha-icon icon="mdi:shape-plus-outline"></ha-icon> Geräte
                 </button>
               </div>
               <button class="icon-btn" data-undo="1" title="Rückgängig"
                       ${this._undo.length ? "" : "disabled"}>
                 <ha-icon icon="mdi:undo"></ha-icon>
               </button>
               <button class="icon-btn" data-redo="1" title="Wiederholen"
                       ${this._redo.length ? "" : "disabled"}>
                 <ha-icon icon="mdi:redo"></ha-icon>
               </button>
               <button class="icon-btn" data-theme-dialog="1" title="Aussehen">
                 <ha-icon icon="mdi:palette-outline"></ha-icon>
               </button>
               <button class="icon-btn" data-floor-dialog="1" title="Etage einrichten">
                 <ha-icon icon="mdi:image-outline"></ha-icon>
               </button>
               ${
                 this._stacked || !this._editRooms
                   ? ""
                   : `<button class="icon-btn ${this._corners ? "on" : ""}"
                              data-toggle-corners="1"
                              title="${
                                this._corners
                                  ? "Ecken fertig — zurück zu den Wänden"
                                  : "Ecken bearbeiten: Nischen und Wandversätze"
                              }">
                        <ha-icon icon="mdi:vector-polygon"></ha-icon>
                      </button>
                      <button class="icon-btn ${this._plot ? "on" : ""}"
                              data-toggle-plot="1"
                              title="${
                                this._plot
                                  ? "Grundstück entfernen"
                                  : "Grundstück zeichnen: die Grenze um Haus und Garten"
                              }">
                        <ha-icon icon="mdi:map-marker-path"></ha-icon>
                      </button>
                      ${
                        this._plot
                          ? `<button class="icon-btn" data-plot-scale="1.12"
                                     title="Grundstück vergrößern">
                               <ha-icon icon="mdi:arrow-expand-all"></ha-icon>
                             </button>
                             <button class="icon-btn" data-plot-scale="0.89"
                                     title="Grundstück verkleinern">
                               <ha-icon icon="mdi:arrow-collapse-all"></ha-icon>
                             </button>`
                          : ""
                      }
                      <button class="icon-btn ${this._meters ? "on" : ""}"
                              data-toggle-meters="1"
                              title="${
                                this._meters
                                  ? "Maße ausblenden"
                                  : "Maße in Metern (Expertenmodus)"
                              }">
                        <ha-icon icon="mdi:tape-measure"></ha-icon>
                      </button>`
               }
               ${
                 this._ghostFloorCount
                   ? `<button class="icon-btn ${this._ghosts ? "on" : ""}"
                              data-toggle-ghosts="1"
                              title="Außenwände der anderen Etagen">
                        <ha-icon icon="mdi:layers-outline"></ha-icon>
                      </button>`
                   : ""
               }
               <button class="icon-btn" data-reset-floor="1"
                       title="Anordnung dieser Etage zurücksetzen">
                 <ha-icon icon="mdi:backup-restore"></ha-icon>
               </button>`
            : ""
        }
        <button class="icon-btn ${this._showDiagnostics ? "on" : ""}"
                data-toggle="diagnostics" title="Diagnose">
          <ha-icon icon="mdi:stethoscope"></ha-icon>
        </button>
        ${
          this._canEdit
            ? `<button class="icon-btn ${this._edit ? "on" : ""}"
                       data-toggle-edit="1"
                       title="${this._edit ? "Bearbeiten beenden" : "Bearbeiten"}">
                 <ha-icon icon="${
                   this._edit ? "mdi:check" : "mdi:pencil-outline"
                 }"></ha-icon>
               </button>`
            : ""
        }
      </header>`;
  }

  _stackHtml() {
    const floors = this._stackFloors;
    const index = new Map(floors.map((floor, at) => [floor.id, at]));
    const last = Math.max(0, floors.length - 1);
    // A node with no storey at all still exists. Drawn on the front plane
    // and marked, rather than quietly missing from the one view that is
    // supposed to show the whole house.
    const planeOf = (node) =>
      index.has(node.floor_id) ? index.get(node.floor_id) : last;

    const spots = new Map(
      this._visibleNodes.map((node) => [
        node.id,
        this._project(planeOf(node), node.position.x, node.position.y),
      ]),
    );

    // Die y-Grenzen duerfen von den x-Grenzen abweichen: der Rahmen ist
    // nicht mehr quadratisch, seit jede Himmelsrichtung ihren eigenen
    // Rand hat. Ohne Angabe gelten die x-Grenzen fuer beides -- das ist
    // das Haus selbst, und das liegt auf 0..1 in beiden Achsen.
    const corners = (at, from, to, fromY = from, toY = to) =>
      [[from, fromY], [to, fromY], [to, toY], [from, toY]]
        .map(([x, y]) => this._project(at, x, y));

    const outline = (at, from, to, fromY, toY) =>
      corners(at, from, to, fromY, toY)
        .map((point) => `${point.x},${point.y}`).join(" ");

    const plans = floors.map((floor, at) => {
      const frame = this._frame;
      // The garden is drawn as what it is: the ground floor's apron, one
      // ring around the house, on the same plane. No extra storey, and
      // Vorgarten, Terrasse and Einfahrt all fit on it at once.
      //
      // Only the real ground floor gets this field, even though other
      // storeys may carry outdoor areas of their own -- a balcony upstairs
      // is still edited and drawn as a room (see `rooms` below), it just
      // does not turn its whole storey into a lawn.
      const apron = floor.has_outdoor && floor.ground
        ? `<polygon class="apron" points="${outline(
            at, frame.min, frame.min + frame.span,
            minY(frame), minY(frame) + spanY(frame),
          )}"/>`
        : "";
      // Der Name steht links neben der Etage, im Rand -- nicht an ihrer
      // Kante. Die x-Koordinate kommt vom linkesten Punkt der Platte,
      // die y-Koordinate aus der oberen Haelfte: so steht der Name auf
      // Hoehe der Etage, statt an ihrer Unterkante zu haengen.
      //
      // Bei einer einzelnen Etage stattdessen oben links ueber dem Blatt,
      // klein und laufend statt gross und rechtsbuendig: dort gibt es
      // keine Reihe, in die er sich einordnen muesste, und der Rand, in
      // dem er sonst steht, waere leere Flaeche neben einem Grundriss.
      // Ueber die Mauerkrone gesetzt, sonst laege er auf der Rueckwand.
      const label = this._oneStorey
        ? { x: this._project(at, 0, 0).x - 34, y: STACK.top - STACK.rise - 10 }
        : {
            x: this._project(at, 0, 1).x - 34,
            y: this._project(at, 0, 0.35).y,
          };
      // Back to front. Rooms have height now, so a room further back can
      // be hidden behind the walls of one in front -- which is what depth
      // looks like. Drawn in storage order instead, a back room paints
      // over the front one and the whole storey turns inside out.
      const onThisFloor = this._model.areas.filter(
        (area) =>
          area.floor_id === floor.id && area.position && this._inSandwich(area),
      );
      // Two rooms side by side used to draw two walls in the same place,
      // which is what a plan looks like when nobody has told it that a
      // partition is one wall with a room on either side. Whoever is in
      // front draws it; the other simply leaves that wall out.
      const joins = joinsOf(onThisFloor);
      const byId = new Map(onThisFloor.map((area) => [area.id, area]));
      const rooms = onThisFloor
        .slice()
        .sort((a, b) => a.position.y - b.position.y)
        .map((area) => {
          const shared = joins.get(area.id);
          const keep = shared
            ? (side) => {
                const other = byId.get(shared.get(side));
                return !other || drawsTheWall(area, other);
              }
            : undefined;
          return this._roomPolygon(at, area, keep);
        })
        .join("");
      // Sky is not a storey. It got a floor slab and an outline like
      // every other plane, which is exactly what made the cloud level
      // read as an attic with clouds painted on it. Up there the clouds
      // are the whole plane -- nothing under them, nothing around them.
      if (floor.virtual) {
        return `<g class="plane virtual">
          ${rooms}
          <g data-at-x="${label.x}" data-at-y="${label.y}"
             transform="translate(${label.x},${label.y}) scale(${
               this._counterScale
             })"><text class="storey-name ${this._oneStorey ? "alone" : ""}">${escapeHtml(
               String(floor.name || "").toLocaleUpperCase("de"),
             )}</text></g>
        </g>`;
      }
      // The storey is a floor slab, not a sheet of paper: a thin band of
      // edge under it is the difference between four drawings above each
      // other and four floors of one house.
      //
      // Genau deshalb faellt sie weg, sobald nur eine Etage dasteht. Dann
      // gibt es nichts zu trennen, und was bleibt, ist eine Wanne: ein
      // Sockel mit dicker Vorderkante, unter einem Grundriss, der gar
      // nicht auf etwas steht. Eine Bauzeichnung zeichnet den Boden
      // nicht, sie zeichnet die Waende -- der Boden ist das Blatt.
      //
      // The outer wall is split around the rooms on purpose: the two walls
      // facing the viewer are drawn after them and hide their lower edge,
      // which is what puts the rooms *inside* the house instead of on top
      // of a slab shaped like one.
      const house = corners(at, 0, 1);
      const crown = house.map((corner) => ({ x: corner.x, y: corner.y - STACK.rise }));
      const slab = this._oneStorey
        ? ""
        : `${wallsOf(house, -STACK.slab, "storey-side")}
           <polygon class="storey" points="${outline(at, 0, 1)}"/>`;
      return `<g class="plane">
        ${apron}
        ${slab}
        ${wallsOf(house, STACK.rise, "shell-face", BACK_WALL)}
        ${rooms}
        ${wallsOf(house, STACK.rise, "shell-face", FRONT_WALL)}
        ${capsOf(crown, STACK.outerWall, "shell-cap")}
        <g data-at-x="${label.x}" data-at-y="${label.y}"
           transform="translate(${label.x},${label.y}) scale(${
             this._counterScale
           })"><text class="storey-name ${this._oneStorey ? "alone" : ""}">${escapeHtml(
             String(floor.name || "").toLocaleUpperCase("de"),
           )}</text></g>
      </g>`;
    });

    const edges = this._visibleEdges
      .filter((edge) => spots.has(edge.source) && spots.has(edge.target))
      .map((edge) => {
        const from = spots.get(edge.source);
        const to = spots.get(edge.target);
        const across = planeOf(this._node(edge.source)) !==
          planeOf(this._node(edge.target));
        return `<line class="stack-edge ${across ? "across" : ""}"
          style="--layer-opacity:${this._providerOpacity(edge.id)}"
          x1="${from.x}" y1="${from.y}" x2="${to.x}" y2="${to.y}"
          stroke="${this._qualityColour(edge.quality)}"
          stroke-width="${across ? 5 : 3}"
          ${edge.dashed ? 'stroke-dasharray="10 7"' : ""}
          data-edge="${escapeHtml(edge.id)}"/>`;
      })
      .join("");

    const matches = this._matches;
    const nodes = this._visibleNodes
      .map((node) => {
        const at = spots.get(node.id);
        const selected =
          this._selected && this._selected.kind === "node" &&
          this._selected.id === node.id;
        const crowded = this._visibleNodes.filter(
          (other) => planeOf(other) === planeOf(node),
        ).length > 5;
        const dimmed = matches && !matches.has(node.id);
        return `<g class="stack-node ${selected ? "on" : ""}
                   ${crowded ? "crowded" : ""} ${dimmed ? "dimmed" : ""}
                   ${matches && !dimmed ? "found" : ""}
                   ${node.floor_id ? "" : "floorless"}"
                   data-node="${escapeHtml(node.id)}"
                   style="--layer-opacity:${this._providerOpacity(node.id)}"
                   data-at-x="${at.x}" data-at-y="${at.y}"
                   transform="translate(${at.x},${at.y}) scale(${
                     this._counterScale
                   })">
          <circle r="14" fill="${this._nodeColour(node)}"/>
          ${this._stackIconHtml(node)}
          <text class="stack-label" y="30">${escapeHtml(node.label)}</text>
        </g>`;
      })
      .join("");

    return `${this._viewportHtml(`<div class="stack">
      <svg viewBox="0 0 ${Math.round(this._stackWidth)} ${Math.round(this._stackHeight)}">
        ${plans.join("")}
        ${edges}
        ${nodes}
      </svg>
    </div>`)}
    <p class="hint">Alle Etagen auf einmal — die einzige Ansicht, in der eine
    Verbindung zwischen zwei Stockwerken überhaupt zu sehen ist. Zum
    Anordnen und für Details eine einzelne Etage wählen.</p>`;
  }

  /** The icon in the stack, in the same shape as on a single floor.
   *
   *  `foreignObject` so this is literally the same `ha-icon` element: the
   *  house view must not be the one place where a device looks different
   *  from everywhere else.
   */
  _stackIconHtml(node) {
    const custom = this._customIcon(node);
    // Both kinds go through `foreignObject`, and that is not a detail.
    // A provider ships its icon as a bare `<svg viewBox="0 0 24 24">`
    // with no width or height. Dropped straight into this SVG that is a
    // *nested viewport*, which defaults to 100% × 100% of the drawing:
    // Firefox honours the CSS width, Chromium did not, so one device came
    // out as a 1000-unit white shape covering the whole house. In HTML
    // the same markup is an ordinary sized element, in every browser.
    const inner = custom
      ? `<span class="custom-icon">${custom.svg}</span>`
      : `<ha-icon icon="${escapeHtml(
          node.icon || this._genericIcon(node),
        )}"></ha-icon>`;
    return `<foreignObject x="-11" y="-11" width="22" height="22"
              class="stack-icon">${inner}</foreignObject>`;
  }

  /** The camera lives here: one wrapper, both views, identical behaviour. */
  _viewportHtml(inner) {
    return `<div class="viewport"><div class="canvas">${inner}</div></div>`;
  }

  /** Ein Raum als Zeichnung. Die Formen stehen in `panel-markup.js`;
   *  hier wird nur die Projektion dieser Etage hineingereicht. */
  _roomPolygon(plane, area, keep = () => true) {
    return roomPolygon(
      {
        project: (x, y) => this._project(plane, x, y),
        floor: this._stackFloors[plane],
        counterScale: this._counterScale,
      },
      area,
      keep,
    );
  }

  _stageHtml() {
    const model = this._model;
    const areas = this._visibleAreas.filter((area) => area.position);

    // Nothing at all to draw: no provider and no house either. Anything
    // else gets rendered -- the areas alone are already the user's home,
    // and an empty rectangle after installing is a bad first impression.
    if (!model.providers.length && !areas.length) {
      return `<div class="empty">
        <h2>Noch nichts zu zeichnen</h2>
        <p>Keine Bereiche in Home Assistant und keine Integration, die
        räumliche Daten liefert. Lege Bereiche unter <i>Einstellungen →
        Bereiche & Zonen</i> an — der Grundriss folgt von selbst.</p>
      </div>`;
    }

    const floor = this._floor;
    const moved = this._moved
      ? `<p class="banner moved">
           <b>${escapeHtml(this._moved.label)}</b> ist jetzt in
           <b>${escapeHtml(this._moved.room)}</b>${
             this._moved.scope === "device"
               ? " — mit allen Entitäten des Geräts"
               : " — nur diese Entität"
           }. Das steht so in Home Assistant.
           <button class="link" data-undo-move="1">Rückgängig</button>
         </p>`
      : "";
    const banner = floor && floor.unassigned
      ? `<p class="banner">Diese Bereiche sind in Home Assistant keiner Etage
         zugeordnet. Sobald du das dort nachträgst, wandern sie von selbst auf
         die richtige Etage — hier ist nichts einzustellen.</p>`
      : model.providers.length
      ? ""
      : `<p class="banner">Dein Haus, direkt aus Home Assistant. Sobald eine
         Integration räumliche Daten liefert, erscheint sie hier von selbst —
         einzurichten ist dafür nichts.</p>`;

    if (this._stacked) return `${moved}${banner}${this._stackHtml()}`;

    // Das Seitenverhaeltnis des Hauses mal dem des Rahmens. Sonst wuerde
    // ein Grundstueck, das nur nach hinten reicht, die Buehne in die
    // Breite ziehen und jeden quadratischen Raum zu einem Rechteck
    // machen: die Raeume rechnen in Prozent der Buehne, und Prozent von
    // etwas Falschem bleibt falsch.
    const houseAspect = (floor && floor.aspect) || 1.6;
    const frameShape = this._frame;
    const aspect = (
      houseAspect * (frameShape.span / spanY(frameShape))
    ).toFixed(4);
    const background = floor && floor.background;
    const edges = this._visibleEdges;

    const stage = `
      <div class="stage ${this._placing ? "placing" : ""} ${
        this._edit ? `editing editing-${this._editWhat}` : ""
      } ${floor && floor.has_outdoor ? "with-apron" : ""}
        shape-${escapeHtml(this._theme.node_shape || "circle")}
        labels-${escapeHtml(this._theme.labels || "always")}
        rooms-${escapeHtml(this._theme.room_style || "outline")}"
           style="aspect-ratio:${aspect};${
             background
               ? `background-image:url('${escapeHtml(background)}')`
               : ""
           }">
        ${this._plotHtml()}
        ${this._buildingLineHtml()}
        ${this._ghostsHtml()}
        ${this._shapesHtml()}
        ${this._areasHtml()}
        <svg class="edges" viewBox="0 0 1000 1000" preserveAspectRatio="none">
          <defs>
            <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5"
                    markerWidth="5" markerHeight="5" orient="auto-start-reverse">
              <path d="M0,0 L10,5 L0,10 z" fill="context-stroke"/>
            </marker>
          </defs>
          ${edges.map((edge) => this._edgeHtml(edge)).join("")}
        </svg>
        ${this._nodesHtml()}
      </div>`;

    return `
      ${moved}${banner}
      ${this._viewportHtml(stage)}
      ${this._trayHtml()}
      ${this._editHintHtml()}
      ${this._metersHtml()}
      ${
        this._placing
          ? `<p class="hint">Klick auf den Grundriss setzt „${escapeHtml(
              this._placingLabel(),
            )}“. <button class="link" data-cancel-place="1">Abbrechen</button></p>`
          : ""
      }`;
  }

  /** One sentence that says what this mode does with a drag.
   *
   *  Three modes, three answers, and the wrong one is worse than none:
   *  somebody told to drag walls while the device mode is on drags a
   *  device and concludes the editor is broken.
   */
  _editHintHtml() {
    if (!this._edit || this._placing) return "";
    if (this._editIcons) {
      return `<p class="hint">Geräte-Modus: Punkte ziehen sortiert sie in
        ihre Räume. Die Wände bleiben, wo sie sind — für die gibt es oben
        <b>Räume</b>.</p>`;
    }
    if (this._corners) {
      return `<p class="hint">Ecken-Modus: eine Ecke ziehen verschiebt sie,
        das <b>+</b> in der Wandmitte setzt eine neue — so entstehen
        Nischen und Wandversätze. Das <b>×</b> an einer Ecke entfernt sie;
        bleiben weniger als vier übrig, ist der Raum wieder ein Rechteck.
        <b>Shift</b> hält das Raster aus.</p>`;
    }
    return `<p class="hint">Räume-Modus: ziehen ordnet an, an Wänden und
      Ecken eines Bereichs ändert sich seine Größe. <b>Shift</b> hält
      gedrückt das Raster aus.</p>`;
  }

  /** The expert's answer, and only when asked for.
   *
   *  Everything else in this editor works by eye: drag until it looks
   *  like home, and a child can do it. Some people know their house to
   *  the centimetre and want to type that in -- so the metres are a
   *  second layer over the same drawing, never a field you must fill in
   *  before anything works.
   */
  _metersHtml() {
    if (!this._meters || !this._editRooms || this._placing) return "";
    const floor = this._floor;
    if (!floor) return "";
    const across = houseMetres(floor);
    const plot = this._plot;
    const size = plot
      ? (() => {
          const xs = plot.map((point) => point.x);
          const ys = plot.map((point) => point.y);
          return {
            width: (Math.max(...xs) - Math.min(...xs)) * across,
            height: (Math.max(...ys) - Math.min(...ys)) * across,
          };
        })()
      : null;
    return `<p class="hint meters">
      <label>Haus breit
        <input type="number" min="1" max="200" step="0.1" value="${across}"
               data-house-metres="1"> m
      </label>
      <span class="muted">Alles andere rechnet sich daraus.</span>
      ${
        size
          ? `<b>Grundstück ${metre(size.width)} × ${metre(size.height)} m</b>`
          : `<span class="muted">Kein Grundstück gezeichnet.</span>`
      }
    </p>`;
  }

  /** Where the building stops and the garden starts.
   *
   *  The apron already worked -- outdoor areas really were arranged in a
   *  ring around the rooms. It just did not *look* like one, because
   *  nothing on screen said where the house ended, so a garden tile and a
   *  living room were two rectangles of slightly different green. Drawing
   *  the building line is the whole difference between "a grid of boxes"
   *  and "my house, with the garden around it".
   *
   *  Only on a floor that has a garden: without one the building line is
   *  the edge of the drawing, and a rectangle around everything says
   *  nothing.
   */
  _buildingLineHtml() {
    const floor = this._floor;
    if (!floor || !floor.has_outdoor || !floor.outline) return "";
    const frame = this._frame;
    const box = floor.outline;
    return `<div class="building-line" style="
      left:${inFrame(box.x, frame)}%;
      top:${inFrameY(box.y, frame)}%;
      width:${(box.width / frame.span) * 100}%;
      height:${(box.height / spanY(frame)) * 100}%;"></div>`;
  }

  /** The strip under the house: everything still waiting for a room.
   *
   *  Outside the plan on purpose. These devices have no place in it yet,
   *  and the whole job of this strip is to be the list that gets shorter
   *  -- so it says where the fix is (Home Assistant, not here) and gets
   *  out of the way the moment it is empty.
   */
  _trayHtml() {
    const waiting = this._floorlessNodes;
    if (!waiting.length) return "";
    return `
      <section class="tray">
        <p class="tray-head">
          <ha-icon icon="mdi:tray-arrow-down"></ha-icon>
          <span>${waiting.length} ohne Etage</span>
          <span class="muted">— in Home Assistant unter <i>Einstellungen →
          Bereiche &amp; Zonen</i> einem Raum zuweisen, dann wandern sie von
          selbst an ihren Platz.</span>
        </p>
        <div class="tray-items">
          ${waiting
            .map((node) => {
              const custom = this._customIcon(node);
              return `
              <button class="tray-item" data-node="${escapeHtml(node.id)}"
                      title="${escapeHtml(node.label)}">
                <span class="dot" style="--node-color:${escapeHtml(
                  this._nodeColour(node),
                )}">${
                  custom
                    ? `<span class="custom-icon">${custom.svg}</span>`
                    : `<ha-icon icon="${escapeHtml(
                        node.icon || this._genericIcon(node),
                      )}"></ha-icon>`
                }</span>
                <span>${escapeHtml(node.label)}</span>
              </button>`;
            })
            .join("")}
        </div>
      </section>`;
  }

  /** The eight handles that make a room properly editable.
   *
   *  Dragging a wall moves that wall and leaves the opposite one where it
   *  is, which is what "make this room wider" means to anybody who has
   *  ever drawn a floor plan. A corner moves two walls at once.
   */
  _areaHandlesHtml(area) {
    const id = escapeHtml(area.id);
    // Two different jobs, and only ever one of them at a time. Wall
    // handles and corner handles sit in the same places and would fight
    // over every pointer press, so the toolbar switch decides which
    // question is being answered: how big is this room, or what shape.
    if (this._corners) return cornerHandlesHtml(area);
    return ["n", "s", "e", "w", "nw", "ne", "sw", "se"]
      .map(
        (edge) => `<span class="handle handle-${edge}"
            data-resize-area="${id}" data-resize-edge="${edge}"
            title="Größe ändern"></span>`,
      )
      .join("");
  }

  /** One grip per corner, and one per wall to add a corner with.
   *
   *  This is the whole answer to niches and stepped walls: drag a corner
   *  to move it, click the dot in the middle of a wall to put a new
   *  corner there, alt-click a corner to take it away again. A rectangle
   *  starts out with its own four corners already listed, so there is
   *  something to drag before anything has been decided.
   *
   *  Positions are per cent of the box, which is exactly the coordinate
   *  system the shape is stored in -- no conversion, and the grips follow
   *  the room through every move and resize on their own.
   */

  /** The property the house stands on.
   *
   *  Home Assistant knows rooms, and a room is inside a building. It has
   *  no idea where the land ends -- so unlike the building line, which is
   *  derived from the rooms and needs no editor at all, a plot only ever
   *  exists because somebody drew one. Until then this is null and
   *  nothing is drawn.
   *
   *  Stored in floor coordinates, not box coordinates: the plot is the
   *  one outline with nothing around it to be relative to.
   */
  get _plot() {
    const floor = this._floor;
    const plot = floor && floor.plot;
    if (!Array.isArray(plot) || plot.length < 3) return null;
    const points = plot
      .map((point) => ({ x: Number(point && point.x), y: Number(point && point.y) }))
      .filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y));
    return points.length >= 3 ? points : null;
  }

  /** A first plot to start from: the whole window, pulled in a little.
   *
   *  A rectangle, because every plot is a rectangle until it is not, and
   *  because four corners are exactly what the corner handles are for.
   *  Inset so its edges sit visibly inside the drawing and can be grabbed
   *  rather than lying on the border of the viewport.
   */
  _defaultPlot() {
    const frame = this._frame;
    const inset = frame.span * 0.04;
    const insetY = spanY(frame) * 0.04;
    const low = frame.min + inset;
    const high = frame.min + frame.span - inset;
    const lowY = minY(frame) + insetY;
    const highY = minY(frame) + spanY(frame) - insetY;
    return [
      { x: low, y: lowY }, { x: high, y: lowY },
      { x: high, y: highY }, { x: low, y: highY },
    ].map((point) => ({
      x: Number(point.x.toFixed(4)),
      y: Number(point.y.toFixed(4)),
    }));
  }

  /** Draw or clear the plot on this floor. */
  _togglePlot() {
    const floor = this._floor;
    if (!floor) return;
    const drawing = !this._plot;
    this._setLayout(
      "floors",
      floor.id,
      { plot: drawing ? this._defaultPlot() : null },
      { plot: floor.plot || null },
    );
    // A plot nobody can reshape is a rectangle, which is not the point.
    if (drawing) this._corners = true;
  }

  /** Grow or shrink the whole plot around its own middle.
   *
   *  Corner by corner is right for the *shape* of a boundary and wrong for
   *  its size: nobody whose garden is simply bigger than the default wants
   *  to drag eight corners outwards one at a time and hope they stay in
   *  proportion. One press moves all of them and keeps the shape.
   */
  _scalePlot(factor) {
    const plot = this._plot;
    if (!plot) return;
    const middle = plot.reduce(
      (sum, point) => ({ x: sum.x + point.x / plot.length,
                         y: sum.y + point.y / plot.length }),
      { x: 0, y: 0 },
    );
    // The window follows the plot rather than the plot the window, so the
    // only limit is one that keeps the house from becoming a dot: four
    // house-widths of garden in every direction is already a park.
    const reach = (value) => Math.min(4, Math.max(-4, Number(value.toFixed(4))));
    const grown = plot.map((point) => ({
      x: reach(middle.x + (point.x - middle.x) * factor),
      y: reach(middle.y + (point.y - middle.y) * factor),
    }));
    this._writePlot(grown);
  }

  _plotHtml() {
    const plot = this._plot;
    if (!plot) return "";
    const frame = this._frame;
    const spot = (point) =>
      `left:${inFrame(point.x, frame).toFixed(2)}%;top:${inFrameY(
        point.y,
        frame,
      ).toFixed(2)}%`;
    const polygon = plot
      .map(
        (point) =>
          `${inFrame(point.x, frame).toFixed(2)}% ${inFrame(
            point.y,
            frame,
          ).toFixed(2)}%`,
      )
      .join(",");
    const grips =
      this._editRooms && this._corners
        ? plot
            .map(
              (point, index) => `<span class="corner plot-corner"
                  style="${spot(point)}" data-plot-index="${index}"
                  title="Grundstücksecke ziehen"
                  ><button class="corner-drop" data-plot-drop="${index}"
                           title="Diese Ecke entfernen">×</button></span>`,
            )
            .join("") +
          plot
            .map((point, index) => {
              const next = plot[(index + 1) % plot.length];
              return `<span class="corner add plot-corner" style="${spot({
                x: (point.x + next.x) / 2,
                y: (point.y + next.y) / 2,
              })}" data-plot-add="${index}"
                 title="Hier eine neue Ecke setzen">+</span>`;
            })
            .join("")
        : "";
    return `<div class="plot" aria-hidden="true"
                 style="clip-path:polygon(${polygon})"></div>${grips}`;
  }

  /** The area a shape edit is about, or null if it has gone away. */
  _area(id) {
    return (this._model.areas || []).find((area) => area.id === id) || null;
  }

  /** What is stored for a room's outline right now -- the far end of an undo.
   *
   *  A room that has never been shaped stores nothing, and undoing back to
   *  that has to restore *nothing* rather than the rectangle it happened
   *  to look like: clearing the shape is how a room goes back to being an
   *  ordinary box, and an explicit four-corner rectangle is not the same
   *  thing.
   */
  _shapeBefore(area) {
    return { shape: Array.isArray(area.shape) ? area.shape.map((p) => ({ ...p })) : null };
  }

  /** Put a new corner in the middle of one wall.
   *
   *  This is the move that makes a niche: split a wall, then drag the new
   *  corner inwards. Inserting it after the wall's first corner keeps the
   *  polygon's winding intact, which is the whole reason the shape is an
   *  ordered list rather than a set of points.
   */
  _addCorner(areaId, index) {
    const area = this._area(areaId);
    if (!area || !Number.isInteger(index)) return;
    const shape = shapeOf(area).map((point) => ({ ...point }));
    const next = shape[(index + 1) % shape.length];
    const here = shape[index];
    if (!here || !next) return;
    shape.splice(index + 1, 0, {
      x: Number(((here.x + next.x) / 2).toFixed(4)),
      y: Number(((here.y + next.y) / 2).toFixed(4)),
    });
    this._setLayout("areas", areaId, { shape }, this._shapeBefore(area));
  }

  /** Take a corner away again.
   *
   *  Below four corners there is nothing left to shape, so the last one
   *  removed clears the shape entirely and hands the room back to the
   *  eight wall handles -- rather than leaving a triangle nobody asked
   *  for or a rectangle that only looks like an ordinary room.
   */
  _dropCorner(areaId, index) {
    const area = this._area(areaId);
    if (!area || !Number.isInteger(index)) return;
    const shape = shapeOf(area).map((point) => ({ ...point }));
    if (index < 0 || index >= shape.length) return;
    if (shape.length <= 4) {
      this._setLayout("areas", areaId, { shape: null }, this._shapeBefore(area));
      return;
    }
    shape.splice(index, 1);
    this._setLayout("areas", areaId, { shape }, this._shapeBefore(area));
  }

  /** The same two moves on the plot, in floor coordinates.
   *
   *  Kept separate from the room versions rather than generalised: a room
   *  corner is relative to its own walls and a plot corner is not, and a
   *  single function pretending both are the same coordinate is how the
   *  outline ends up in the wrong place on the one floor with a garden.
   */
  _writePlot(points) {
    const floor = this._floor;
    if (!floor) return;
    this._setLayout(
      "floors",
      floor.id,
      {
        plot: points && points.map((point) => ({
          x: Number(point.x.toFixed(4)),
          y: Number(point.y.toFixed(4)),
        })),
      },
      { plot: floor.plot || null },
    );
  }

  _addPlotCorner(index) {
    const plot = this._plot;
    if (!plot || !Number.isInteger(index) || !plot[index]) return;
    const next = plot[(index + 1) % plot.length];
    const points = plot.map((point) => ({ ...point }));
    points.splice(index + 1, 0, {
      x: (plot[index].x + next.x) / 2,
      y: (plot[index].y + next.y) / 2,
    });
    this._writePlot(points);
  }

  _dropPlotCorner(index) {
    const plot = this._plot;
    if (!plot || !Number.isInteger(index) || !plot[index]) return;
    // Three corners is the least a plot can be. Below that there is no
    // boundary left, so the answer is no boundary at all.
    if (plot.length <= 3) {
      this._writePlot(null);
      return;
    }
    const points = plot.map((point) => ({ ...point }));
    points.splice(index, 1);
    this._writePlot(points);
  }

  // ── Eigene Flaechen: ohne HA-Bereich dahinter ────────────
  //
  // Ein Grundstueck ist einer je Etage; eine eigene Flaeche ist keins von
  // beidem eingeschraenkt -- ein Flur, eine dekorative Kontur, beliebig
  // viele pro Etage. Deshalb eine eigene, kleinere Kopie derselben
  // Eck-Bearbeitung statt einer gemeinsamen Funktion: ein Grundstueck
  // gehoert zur Etage, eine Flaeche zu sich selbst, und ein Versuch, beide
  // unter einem Dach zu verallgemeinern, ist genau die Art Umbau, die das
  // Grundstueck kaputt macht, um die Flaeche zu retten.

  /** Every shape drawn on the floor currently open. */
  get _shapes() {
    const floor = this._floor;
    if (!floor) return [];
    return (this._model.shapes || []).filter(
      (shape) => shape.floor_id === floor.id,
    );
  }

  _shape(id) {
    return (this._model.shapes || []).find((shape) => shape.id === id) || null;
  }

  /** A short id nobody else could have picked, since a shape has no
   *  registry to hand one out. */
  _newShapeId() {
    return `shape-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
  }

  /** A first rectangle to start from, the same idea as `_defaultPlot` but
   *  smaller: a plot wraps the whole picture, a shape starts as something
   *  one can immediately see is a single room-sized thing to reshape. */
  _defaultShapePoints() {
    const frame = this._frame;
    const cx = frame.min + frame.span / 2;
    const cy = minY(frame) + spanY(frame) / 2;
    const hw = frame.span * 0.08;
    const hh = spanY(frame) * 0.08;
    return [
      { x: cx - hw, y: cy - hh }, { x: cx + hw, y: cy - hh },
      { x: cx + hw, y: cy + hh }, { x: cx - hw, y: cy + hh },
    ].map((point) => ({
      x: Number(point.x.toFixed(4)),
      y: Number(point.y.toFixed(4)),
    }));
  }

  /** Draw a brand new shape and drop straight into reshaping it -- a
   *  rectangle nobody can adjust is not a drawing tool, it is a sticker. */
  _addShape() {
    const floor = this._floor;
    if (!floor) return;
    const name = window.prompt("Name der Fläche?", "Fläche") || "Fläche";
    const shape = {
      id: this._newShapeId(),
      floor_id: floor.id,
      name,
      color: "",
      points: this._defaultShapePoints(),
    };
    this._writeShapes([...(this._model.shapes || []), shape]);
    this._shapeEdit = shape.id;
    this._corners = true;
  }

  _writeShapes(shapes) {
    this._setLayout(
      "settings", "view",
      { custom_shapes: shapes.map((shape) => ({
        id: shape.id,
        floor_id: shape.floor_id,
        name: shape.name,
        color: shape.color || "",
        points: shape.points.map((point) => ({
          x: Number(point.x.toFixed(4)),
          y: Number(point.y.toFixed(4)),
        })),
      })) },
      { custom_shapes: this._model.shapes || [] },
    );
  }

  _renameShape(id, patch) {
    const shapes = (this._model.shapes || []).map((shape) =>
      shape.id === id ? { ...shape, ...patch } : shape,
    );
    this._writeShapes(shapes);
  }

  _deleteShape(id) {
    if (this._shapeEdit === id) this._shapeEdit = null;
    if (this._shapeDialog === id) this._shapeDialog = null;
    this._writeShapes((this._model.shapes || []).filter((shape) => shape.id !== id));
  }

  _addShapeCorner(id, index) {
    const shape = this._shape(id);
    if (!shape || !Number.isInteger(index) || !shape.points[index]) return;
    const points = shape.points.map((point) => ({ ...point }));
    const next = shape.points[(index + 1) % shape.points.length];
    points.splice(index + 1, 0, {
      x: (shape.points[index].x + next.x) / 2,
      y: (shape.points[index].y + next.y) / 2,
    });
    this._writeShapes(
      (this._model.shapes || []).map((entry) =>
        entry.id === id ? { ...entry, points } : entry,
      ),
    );
  }

  _dropShapeCorner(id, index) {
    const shape = this._shape(id);
    if (!shape || !Number.isInteger(index) || !shape.points[index]) return;
    if (shape.points.length <= 3) {
      this._deleteShape(id);
      return;
    }
    const points = shape.points.map((point) => ({ ...point }));
    points.splice(index, 1);
    this._writeShapes(
      (this._model.shapes || []).map((entry) =>
        entry.id === id ? { ...entry, points } : entry,
      ),
    );
  }

  _shapesHtml() {
    const shapes = this._shapes;
    if (!shapes.length) return "";
    const frame = this._frame;
    return shapes
      .map((shape) => {
        const polygon = shape.points
          .map(
            (point) =>
              `${inFrame(point.x, frame).toFixed(2)}% ${inFrameY(
                point.y,
                frame,
              ).toFixed(2)}%`,
          )
          .join(",");
        const centre = centreOf(shape.points);
        const left = inFrame(centre.x, frame).toFixed(2);
        const top = inFrameY(centre.y, frame).toFixed(2);
        const editingThis = this._editRooms && this._shapeEdit === shape.id;
        return `
          <div class="custom-shape" data-shape="${escapeHtml(shape.id)}"
               style="clip-path:polygon(${polygon});${
                 shape.color ? `background:${escapeHtml(shape.color)};` : ""
               }"></div>
          <span class="custom-shape-name" style="left:${left}%; top:${top}%;">
            ${escapeHtml(shape.name)}
          </span>
          ${
            this._editRooms
              ? `<button class="shape-config" data-shape-dialog="${escapeHtml(
                  shape.id,
                )}" style="left:${left}%; top:${top}%;"
                  title="Fläche einstellen">
                  <ha-icon icon="mdi:tune-variant"></ha-icon>
                </button>`
              : ""
          }
          ${editingThis ? this._shapeGripsHtml(shape) : ""}`;
      })
      .join("");
  }

  _shapeGripsHtml(shape) {
    const frame = this._frame;
    const points = shape.points;
    const spot = (point) =>
      `left:${inFrame(point.x, frame).toFixed(2)}%;top:${inFrameY(
        point.y,
        frame,
      ).toFixed(2)}%`;
    return (
      points
        .map(
          (point, index) => `<span class="corner plot-corner"
              style="${spot(point)}" data-shape-index="${index}"
              data-shape-owner="${escapeHtml(shape.id)}"
              title="Ecke ziehen"
              ><button class="corner-drop" data-shape-drop="${index}"
                       data-shape-owner="${escapeHtml(shape.id)}"
                       title="Diese Ecke entfernen">×</button></span>`,
        )
        .join("") +
      points
        .map((point, index) => {
          const next = points[(index + 1) % points.length];
          return `<span class="corner add plot-corner" style="${spot({
            x: (point.x + next.x) / 2,
            y: (point.y + next.y) / 2,
          })}" data-shape-add="${index}" data-shape-owner="${escapeHtml(
            shape.id,
          )}" title="Hier eine neue Ecke setzen">+</span>`;
        })
        .join("")
    );
  }

  _shapeDialogHtml() {
    const shape = this._shape(this._shapeDialog);
    if (!shape) return "";
    return `
      <div class="scrim" data-close-shape="1"></div>
      <div class="popup centred">
        <div class="popup-head">
          <h2>${escapeHtml(shape.name)}</h2>
          <button class="icon-btn" data-close-shape="1">
            <ha-icon icon="mdi:close"></ha-icon>
          </button>
        </div>
        <label class="field">
          <span>Name</span>
          <input type="text" value="${escapeHtml(shape.name)}"
                 data-shape-name="${escapeHtml(shape.id)}">
        </label>
        <label class="field">
          <span>Farbe</span>
          <input type="color" value="${escapeHtml(shape.color || "#8899aa")}"
                 data-shape-color="${escapeHtml(shape.id)}">
        </label>
        <button class="link" data-shape-reshape="${escapeHtml(shape.id)}">
          ${this._shapeEdit === shape.id ? "Ecken fertig" : "Ecken bearbeiten"}
        </button>
        <button class="link" data-shape-delete="${escapeHtml(shape.id)}">
          Fläche löschen
        </button>
      </div>`;
  }

  /** The other storeys' outer walls, behind the one being edited.
   *
   *  A house is one building and its floors are meant to sit above each
   *  other, but each floor is its own tab -- so until now the only way to
   *  line the cellar up with the ground floor was to remember what the
   *  ground floor looked like. Nobody can, and the sandwich showed the
   *  drift that nothing during editing had revealed.
   *
   *  Only in edit mode, and only on a single floor: in the stacked view
   *  the storeys are already drawn over each other, and outside editing
   *  the lines are clutter over a plan nobody is changing.
   */
  _ghostFloors() {
    if (!this._editRooms || this._stacked) return [];
    const current = this._floor;
    if (!current) return [];
    return this._floors.filter(
      (floor) =>
        floor.id !== current.id && floor.outline && !floor.virtual &&
        !floor.unassigned,
    );
  }

  /** Whether there is anything to show, so the button can stay away. */
  get _ghostFloorCount() {
    return this._ghostFloors().length;
  }

  _ghostsHtml() {
    if (!this._ghosts) return "";
    const frame = this._frame;
    return this._ghostFloors()
      .map((floor) => {
        const box = floor.outline;
        return `
        <div class="ghost" data-ghost="${escapeHtml(floor.id)}" style="
              left:${((box.x - frame.min) / frame.span) * 100}%;
              top:${((box.y - minY(frame)) / spanY(frame)) * 100}%;
              width:${(box.width / frame.span) * 100}%;
              height:${(box.height / spanY(frame)) * 100}%;">
          <span class="ghost-name">${escapeHtml(floor.name)}</span>
        </div>`;
      })
      .join("");
  }

  _areasHtml() {
    const frame = this._frame;
    return this._visibleAreas
      .filter((area) => area.position)
      .map((area) => {
        const size = area.size || { width: 0.3, height: 0.3 };
        // A niche is a clip on a fill inside the box, not on the box
        // itself: the walls, the drag and the eight handles stay exactly
        // what they were, and the room simply stops being a rectangle
        // within them. Clipping the box would clip its own handles away
        // and make an L-shaped room the one room nobody can edit.
        // A cloud has an outline of its own and ignores all of this.
        const shaped = hasShape(area) && kindOf(area) !== AREA_KIND.VIRTUAL;
        const fill = shaped
          ? `<div class="area-fill" style="clip-path:polygon(${shapeOf(area)
              .map(
                (point) =>
                  `${(point.x * 100).toFixed(2)}% ${(point.y * 100).toFixed(2)}%`,
              )
              .join(",")})"></div>`
          : "";
        const areaBackground = area.background
          ? `<div class="area-background" style="background-image:url('${escapeHtml(
              area.background,
            )}');${
              shaped
                ? `clip-path:polygon(${shapeOf(area)
                    .map(
                      (point) =>
                        `${(point.x * 100).toFixed(2)}% ${(point.y * 100).toFixed(2)}%`,
                    )
                    .join(",")});`
                : ""
            }"></div>`
          : "";
        return `
        <div class="area ${
          kindOf(area) === AREA_KIND.OUTDOOR ? "outdoor" : ""
        } ${kindOf(area) === AREA_KIND.VIRTUAL ? "virtual" : ""} ${
          shaped ? "shaped" : ""
        }" data-area="${escapeHtml(area.id)}" style="
              left:${inFrame(area.position.x, frame)}%;
              top:${inFrameY(area.position.y, frame)}%;
              width:${(size.width / frame.span) * 100}%;
              height:${(size.height / spanY(frame)) * 100}%;">
          ${areaBackground}
          ${fill}
          ${kindOf(area) === AREA_KIND.VIRTUAL ? CLOUD_SVG : ""}
          <span class="area-name">
            ${area.icon ? `<ha-icon icon="${escapeHtml(area.icon)}"></ha-icon>` : ""}
            ${escapeHtml(area.name)}
          </span>
          ${
            this._meters && this._editRooms && area.size
              ? `<span class="area-dim">${metre(
                  area.size.width * houseMetres(this._floor),
                )} × ${metre(
                  area.size.height * houseMetres(this._floor),
                )} m</span>`
              : ""
          }
          ${this._joinMarksHtml(area)}
          ${
            this._editRooms
              ? `${this._areaHandlesHtml(area)}
                 <button class="area-config" data-area-dialog="${escapeHtml(
                   area.id,
                 )}" title="Bereich einstellen">
                   <ha-icon icon="mdi:tune-variant"></ha-icon>
                 </button>
                 <button class="area-hide" data-hide-area="${escapeHtml(area.id)}"
                         title="Bereich ausblenden">
                   <ha-icon icon="mdi:eye-off-outline"></ha-icon>
                 </button>`
              : ""
          }
        </div>`;
      })
      .join("");
  }

  /** The × and + on a room's shared walls.
   *
   *  Only on the room that was clicked, and only while rooms are being
   *  arranged. Every wall that is shared with the room next door gets a
   *  red × to break it apart; a wall that touches but has been broken
   *  gets a green + to put it back. Without the +, breaking a join once
   *  would be a decision nobody could take back.
   */
  _joinMarksHtml(area) {
    if (!this._editRooms || this._joinArea !== area.id) return "";
    const here = this._visibleAreas.filter(
      (candidate) =>
        candidate.position &&
        (!this._floor || candidate.floor_id === this._floor.id),
    );
    const joined = joinsOf(here).get(area.id) || new Map();
    const touching = joinsOf(here, false).get(area.id) || new Map();
    const id = escapeHtml(area.id);

    return [...touching.keys()]
      .map((side) => {
        const together = joined.has(side);
        const other = touching.get(side);
        const name = (this._area(other) || {}).name || other;
        return `<button class="join-mark ${SIDE_NAME[side]} ${
          together ? "on" : "off"
        }" data-join-area="${id}" data-join-side="${side}"
                data-join-other="${escapeHtml(other)}"
                title="${
                  together
                    ? `Gemeinsame Wand mit ${escapeHtml(name)} trennen`
                    : `Wand wieder mit ${escapeHtml(name)} verbinden`
                }">${together ? "×" : "+"}</button>`;
      })
      .join("");
  }

  _edgeHtml(edge) {
    const colour = edge.color || this._qualityColour(edge.quality);
    const classes = [
      "edge",
      edge.animated ? "animated" : "",
      this._selected &&
      this._selected.kind === "edge" &&
      this._selected.id === edge.id
        ? "on"
        : "",
    ]
      .filter(Boolean)
      .join(" ");
    const shared = `class="${classes}" data-edge="${escapeHtml(edge.id)}"
        stroke="${escapeHtml(colour)}"
        style="--layer-opacity:${this._providerOpacity(edge.id)}"
        stroke-width="${edge.width || 2}"
        vector-effect="non-scaling-stroke"
        ${edge.dashed ? 'stroke-dasharray="6 5"' : ""}
        ${edge.directed ? 'marker-end="url(#arrow)"' : ""}`;
    const title = `<title>${escapeHtml(edge.label || edge.id)}</title>`;
    const frame = this._frame;
    const [x1, y1] = [
      inFrame(edge.from.x, frame) * 10,
      inFrameY(edge.from.y, frame) * 10,
    ];
    const [x2, y2] = [
      inFrame(edge.to.x, frame) * 10,
      inFrameY(edge.to.y, frame) * 10,
    ];

    if (this._theme.edge_style === "curved") {
      // Bow the line out perpendicular to itself, so two edges between the
      // same pair stay distinguishable and a dense plan reads as a network
      // rather than a hairball.
      const [dx, dy] = [x2 - x1, y2 - y1];
      const bow = 0.14;
      const cx = (x1 + x2) / 2 - dy * bow;
      const cy = (y1 + y2) / 2 + dx * bow;
      return `<path ${shared} fill="none"
        d="M ${x1} ${y1} Q ${cx.toFixed(1)} ${cy.toFixed(1)} ${x2} ${y2}"
      >${title}</path>`;
    }

    return `<line ${shared}
        x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"
      >${title}</line>`;
  }

  /** The colour of a node's icon plate: its own, its provider's, its state. */
  _nodeColour(node) {
    return nodeColour(this._theme, node, this._customIcon(node));
  }

  _genericIcon(node) {
    return genericIcon((this._model && this._model.providers) || [], node);
  }

  /** Is this node sharing its room with enough others to stack labels?
   *
   *  Counted per area, not per floor: a spread-out storey with twelve
   *  devices reads fine, and one living room with five does not.
   */
  _crowded(node) {
    if ((this._theme.labels || "always") !== "always") return false;
    if (!node.area_id) return false;
    const together = this._visibleNodes.filter(
      (other) => other.area_id === node.area_id,
    ).length;
    return together > 3;
  }

  /** Devices in the same room, past the point where their icons stop
   *  being readable as separate things and start being a smear.
   *
   *  Sorted into groups sharing an `area_id`, one cluster button per room
   *  once a room passes `CLUSTER_THRESHOLD`. Switched off while arranging
   *  icons -- a device you cannot see individually is one you cannot
   *  drag -- and while searching, or the very device somebody is looking
   *  for would be the one hidden inside a badge.
   */
  get _nodeGroups() {
    const nodes = this._visibleNodes;
    if (this._editIcons || this._matches) return { singles: nodes, clusters: [] };
    const byRoom = new Map();
    const singles = [];
    for (const node of nodes) {
      if (!node.area_id) {
        singles.push(node);
        continue;
      }
      const key = `${node.floor_id || ""}:${node.area_id}`;
      if (!byRoom.has(key)) byRoom.set(key, []);
      byRoom.get(key).push(node);
    }
    const clusters = [];
    for (const group of byRoom.values()) {
      if (group.length > CLUSTER_THRESHOLD) clusters.push(group);
      else singles.push(...group);
    }
    return { singles, clusters };
  }

  _nodesHtml() {
    const { singles, clusters } = this._nodeGroups;
    return (
      singles.map((node) => this._nodeHtml(node)).join("") +
      clusters.map((group) => this._clusterHtml(group)).join("")
    );
  }

  /** One badge standing in for a whole room's worth of devices.
   *
   *  Placed at the group's own centre of gravity rather than the room's
   *  box: devices already spread themselves out inside a room, and their
   *  average position is where a hand would expect to find them.
   */
  _clusterHtml(group) {
    const frame = this._frame;
    const cx = group.reduce((sum, node) => sum + node.position.x, 0) / group.length;
    const cy = group.reduce((sum, node) => sum + node.position.y, 0) / group.length;
    const areaId = group[0].area_id;
    const area = this._area(areaId);
    const open = this._clusterOpen === areaId;
    return `
      <button class="node cluster ${open ? "on" : ""}" data-cluster="${escapeHtml(
        areaId,
      )}"
        title="${group.length} Geräte${
          area ? ` in ${escapeHtml(area.name)}` : ""
        }"
        style="left:${inFrame(cx, frame)}%; top:${inFrameY(cy, frame)}%;">
        <span class="dot"><ha-icon icon="mdi:dots-grid"></ha-icon></span>
        <span class="cluster-count">${group.length}</span>
        <span class="label">${escapeHtml((area || {}).name || "")}</span>
      </button>
      ${open ? this._clusterListHtml(group, area) : ""}`;
  }

  /** The devices behind one cluster, named and tappable.
   *
   *  Picking one opens exactly the same details popup a lone icon would
   *  -- clustering changes how a room is drawn, never what a device is.
   */
  _clusterListHtml(group, area) {
    const rows = group
      .map(
        (node) => `
      <button class="cluster-item" data-cluster-node="${escapeHtml(node.id)}">
        <ha-icon icon="${escapeHtml(
          node.icon || this._genericIcon(node),
        )}"></ha-icon>
        <span>${escapeHtml(node.label)}</span>
      </button>`,
      )
      .join("");
    return `
      <div class="scrim" data-close-cluster="1"></div>
      <div class="popup centred cluster-popup">
        <div class="popup-head">
          <h2>${escapeHtml((area || {}).name || "Geräte")}</h2>
          <button class="icon-btn" data-close-cluster="1">
            <ha-icon icon="mdi:close"></ha-icon>
          </button>
        </div>
        <div class="cluster-list">${rows}</div>
      </div>`;
  }

  _nodeHtml(node) {
    const custom = this._customIcon(node);
    const colour = this._nodeColour(node);
    const selected =
      this._selected &&
      this._selected.kind === "node" &&
      this._selected.id === node.id;
    const scale = (node.scale || 1) * (this._theme.node_size || 1);
    const icon = custom
      ? `<span class="custom-icon">${custom.svg}</span>`
      : `<ha-icon icon="${escapeHtml(
          node.icon || this._genericIcon(node),
        )}"></ha-icon>`;
    const matches = this._matches;
    const frame = this._frame;
    return `
      <button class="node ${selected ? "on" : ""} ${node.floor_id ? "" : "floorless"}
        ${this._crowded(node) ? "crowded" : ""}
        ${matches && !matches.has(node.id) ? "dimmed" : ""}
        ${matches && matches.has(node.id) ? "found" : ""}"
        data-node="${escapeHtml(node.id)}"
        title="${escapeHtml(node.label)}${node.floor_id ? "" : " (keiner Etage zugeordnet)"}"
        style="left:${inFrame(node.position.x, frame)}%;
               top:${inFrameY(node.position.y, frame)}%;
               --node-color:${escapeHtml(colour)}; --node-scale:${scale};
               --layer-opacity:${this._providerOpacity(node.id)};
               ${node.rotation ? `--node-rotation:${node.rotation}deg;` : ""}">
        <span class="dot">${icon}</span>
        <span class="label">${escapeHtml(node.label)}</span>
      </button>`;
  }

  /** Der einzige Knopf, der im Vollbild uebrig bleibt.
   *
   *  Er liegt ueber dem Plan statt in einer Leiste, denn eine Leiste, die
   *  nur den Knopf zum Ausblenden der Leisten enthaelt, hat nichts
   *  ausgeblendet. Auf dem Monitor gibt es ihn nicht: dort sind die
   *  Leisten kein Platzproblem, sondern das Werkzeug.
   */
  _barsButtonHtml() {
    if (!this._isPhone()) return "";
    const open = this._bars;
    return `
      <button class="bars-btn ${open ? "on" : ""}" data-bars="1"
              aria-expanded="${open ? "true" : "false"}"
              title="${open ? "Vollbild: Leisten ausblenden" : "Leisten einblenden"}">
        <ha-icon icon="${
          open ? "mdi:fullscreen" : "mdi:fullscreen-exit"
        }"></ha-icon>
      </button>`;
  }

  /** The legend, folded away until somebody asks for it.
   *
   *  Collapsed is the honest default: layers and providers are how you
   *  adjust the plan once you already trust it, and a wall of chips under
   *  a house nobody has looked at yet is noise on the one screen that is
   *  supposed to say "this is my home".
   */
  _legendHtml() {
    const open = this._legendOpen;
    // Der Griff steht ueber dem Schalter, nicht daneben: nach unten
    // wegziehen ist auf dem Telefon die schnellere Geste, und ein Blatt
    // ohne sichtbaren Griff sieht nicht aus, als koennte man es ziehen.
    // Nur auf dem Telefon: dort ist die Legende ein Blatt ueber dem Plan.
    // Auf einem Monitor steht sie unter dem Grundriss und nimmt ihm
    // nichts weg -- ein Griff, der dort nur eine Zeile verschiebt, waere
    // eine Geste ohne Wirkung.
    const grab =
      open && this._isPhone()
        ? `<div class="grab" data-legend-grab
                title="Nach unten ziehen, um Platz zu machen"></div>`
        : "";
    return `
      <section class="legend ${open ? "open" : ""}">
        ${grab}
        <button class="legend-toggle" data-legend
                aria-expanded="${open ? "true" : "false"}">
          <ha-icon icon="${
            open ? "mdi:chevron-down" : "mdi:chevron-right"
          }"></ha-icon>
          <span>Legende</span>
        </button>
        ${open ? `<div class="dock">${this._sidebarHtml()}</div>` : ""}
      </section>`;
  }

  _sidebarHtml() {
    const layers = (this._model.layers || [])
      .slice()
      .reverse()
      .map(
        (layer) => `
        <div class="layer">
          <button class="row" data-layer="${escapeHtml(layer.id)}">
            <ha-icon icon="${
              layer.visible === false ? "mdi:eye-off-outline" : "mdi:eye-outline"
            }"></ha-icon>
            <span class="${layer.visible === false ? "muted" : ""}">
              ${escapeHtml(layer.name || layer.id)}
            </span>
          </button>
          ${
            this._edit
              ? `<div class="layer-edit">
                   <input type="range" min="0.1" max="1" step="0.05"
                          value="${layer.opacity ?? 1}"
                          data-layer-opacity="${escapeHtml(layer.id)}"
                          title="Deckkraft">
                   <button class="icon-btn small" data-layer-up="${escapeHtml(
                     layer.id,
                   )}" title="Nach vorn"><ha-icon icon="mdi:arrow-up"></ha-icon></button>
                   <button class="icon-btn small" data-layer-down="${escapeHtml(
                     layer.id,
                   )}" title="Nach hinten"><ha-icon icon="mdi:arrow-down"></ha-icon></button>
                 </div>`
              : ""
          }
        </div>`,
      )
      .join("");

    const unplaced = this._visibleAreas.filter((area) => !area.position);
    const tray = unplaced.length
      ? `
      <h3>Nicht platziert</h3>
      <p class="note">Automatische Anordnung ist aus. Bereich wählen, dann in
      den Grundriss klicken.</p>
      <div class="chips">
        ${unplaced
          .map(
            (area) => `
          <button class="chip ${
            this._placing && this._placing.key === area.id ? "on" : ""
          }" data-place-area="${escapeHtml(area.id)}">
            ${escapeHtml(area.name)}
          </button>`,
          )
          .join("")}
      </div>`
      : "";

    // Grouped by provider, because "that integration → its access points,
    // its switches, its clients" is how somebody thinks about their house
    // -- and because a flat list of thirty layers from four integrations
    // is not a list, it is a wall.
    const byProvider = new Map();
    for (const provider of this._model.providers || []) {
      byProvider.set(provider.id, { provider, layers: [] });
    }
    for (const layer of this._model.layers || []) {
      const group = byProvider.get(layer.provider_id);
      if (group) group.layers.push(layer);
    }

    const providers = [...byProvider.values()]
      .map(
        ({ provider, layers: own }) => `
        <div class="provider-group">
          <div class="provider-head">
            ${
              provider.icon
                ? `<ha-icon icon="${escapeHtml(provider.icon)}"></ha-icon>`
                : ""
            }
            <b>${escapeHtml(provider.name || provider.id)}</b>
            <span class="muted">${escapeHtml(provider.version || "")}</span>
            <button class="icon-btn small"
                    data-toggle-provider="${escapeHtml(provider.id)}"
                    title="Alle Ebenen dieses Providers umschalten">
              <ha-icon icon="${
                this._hiddenProviders.has(provider.id)
                  ? "mdi:eye-off-outline"
                  : "mdi:eye-outline"
              }"></ha-icon>
            </button>
          </div>
          <div class="chips">
            ${own
              .map(
                (layer) => `
              <button class="chip ${layer.visible === false ? "" : "on"}"
                      data-layer="${escapeHtml(layer.id)}">
                ${
                  layer.icon
                    ? `<ha-icon icon="${escapeHtml(layer.icon)}"></ha-icon>`
                    : ""
                }
                ${escapeHtml(layer.name || layer.id)}
              </button>`,
              )
              .join("") || '<span class="note">Keine Ebene.</span>'}
          </div>
        </div>`,
      )
      .join("");

    return `
      <div class="dock-col">
        <h3>Ebenen</h3>
        <div class="rows">${layers || '<p class="note">Keine Ebenen.</p>'}</div>
        ${this._customLayersHtml()}
      </div>
      <div class="dock-col">
        <h3>Provider</h3>
        ${providers || '<p class="note">Keine Integration liefert Daten.</p>'}
      </div>
      ${
        tray || this._hiddenTrayHtml()
          ? `<div class="dock-col">${tray}${this._hiddenTrayHtml()}</div>`
          : ""
      }`;
  }

  /** What an area *is*, and where it may appear. */
  _areaDialogHtml() {
    const area = (this._model.areas || []).find(
      (candidate) => candidate.id === this._areaDialog,
    );
    if (!area) return "";
    const kind = kindOf(area);
    const kinds = [
      [AREA_KIND.INDOOR, "Raum", "mdi:home-outline"],
      [AREA_KIND.OUTDOOR, "Garten / Außenbereich", "mdi:tree-outline"],
      [AREA_KIND.VIRTUAL, "Virtuell (Cloud, Internet, VPN)", "mdi:cloud-outline"],
    ];
    return `
      <div class="scrim" data-close-area="1"></div>
      <div class="popup centred">
        <div class="popup-head">
          <h2>${escapeHtml(area.name)}</h2>
          <button class="icon-btn" data-close-area="1">
            <ha-icon icon="mdi:close"></ha-icon>
          </button>
        </div>
        <p class="note">Ein Garten ist keine Etage. Außenbereiche legen sich
        als Ring um das Erdgeschoss — Vorgarten, Terrasse, Einfahrt und
        Garage passen alle darauf, ohne ein Stockwerk zu erfinden.</p>
        <div class="chips">
          ${kinds
            .map(
              ([value, label, icon]) => `
            <button class="chip ${kind === value ? "on" : ""}"
                    data-area-kind="${value}">
              <ha-icon icon="${icon}"></ha-icon> ${label}
            </button>`,
            )
            .join("")}
        </div>
        <h3>Sandwich</h3>
        <label class="inline">
          <input type="checkbox" data-area-flag="in_sandwich"
                 ${area.in_sandwich === false ? "" : "checked"}>
          In der Hausansicht zeigen
        </label>
        <label class="inline">
          <input type="checkbox" data-area-flag="single_only"
                 ${area.single_only ? "checked" : ""}>
          Nur in der Einzelansicht
        </label>
        <h3>Hintergrundbild</h3>
        <label class="field">
          <span>Bild für diesen Raum</span>
          <input type="file" accept="image/*" data-area-background="1">
        </label>
        ${
          area.background
            ? `<button class="link" data-clear-area-background="1">Bild entfernen</button>`
            : ""
        }
        ${doorsHtml(area)}
      </div>`;
  }

  /** Die Tueren eines Raumes, zum Anlegen und Wegnehmen.
   *
   *  Nur fuer Raeume: ein Garten hat keine Waende, in die eine Luecke
   *  passen koennte, und die Wolke erst recht nicht.
   */

  /** Die Tuerliste dieses Raumes, geaendert und zurueckgeschrieben.
   *
   *  Immer die ganze Liste: eine Tuer hat keine eigene Kennung, ihre
   *  Stelle in der Liste *ist* ihre Kennung. Einzelne Felder zu schicken
   *  hiesse, dem Server zu erklaeren, wie man eine Liste sortiert.
   */
  _setDoors(area, change) {
    const doors = doorsOf(area, shapeOf(area).length)
      .map((door) => ({
        side: Number(door.side),
        at: Number(door.at),
        width: Number(door.width),
      }));
    const next = change(doors);
    if (!next) return;
    this._setLayout("areas", area.id, { doors: next }, { doors: next });
  }

  // ── Das Menue unter der rechten Maustaste ───────────────

  /** Worauf rechts geklickt wurde: ein Raum, ein Geraet, oder der Plan.
   *
   *  Die Reihenfolge ist die des Auges: was obenauf liegt, gewinnt. Ein
   *  Geraet steht im Raum, also kommt es zuerst -- sonst waere jeder
   *  Rechtsklick auf eine Lampe einer auf das Wohnzimmer.
   */
  _menuFor(path) {
    const find = (attribute) =>
      path.find(
        (element) =>
          element.getAttribute && element.getAttribute(attribute) !== null,
      );
    const node = find("data-node");
    if (node) return { kind: "node", id: node.getAttribute("data-node") };
    const area = find("data-area");
    if (area) return { kind: "area", id: area.getAttribute("data-area") };
    const stage = path.find(
      (element) =>
        element.classList &&
        (element.classList.contains("stage") ||
          element.classList.contains("stack")),
    );
    return stage ? { kind: "plan", id: null } : null;
  }

  _onContextMenu(event) {
    const target = this._menuFor(event.composedPath());
    // Ausserhalb des Plans bleibt das Menue des Browsers. Wer auf einer
    // Leiste rechtsklickt, will kopieren oder untersuchen, nicht bauen.
    if (!target) return;
    event.preventDefault();
    this._menu = { ...target, x: event.clientX, y: event.clientY };
    this._render();
  }

  /** Was in dem Menue steht -- als Liste, nicht als HTML.
   *
   *  Getrennt, weil hier die Entscheidungen liegen: welcher Eintrag zu
   *  wem gehoert und wann er fehlt. Das ist pruefbar, das Aussehen nicht.
   *
   *  Was nicht darin steht: Raum anlegen, duplizieren, loeschen. Bereiche
   *  gehoeren dem Bereichsregister von Home Assistant, nicht uns. Ein
   *  „Loeschen" hier wuerde den Raum ueberall entfernen -- in jedem
   *  Dashboard, jeder Automatisierung, jeder Sprachsteuerung -- und ein
   *  „Duplizieren" wuerde „Wohnzimmer Kopie" ins Register schreiben, wo
   *  es nie hingehoerte. Der Hub sammelt und platziert; er verwaltet
   *  nicht. Wer einen Raum wirklich anlegen will, tut das dort, wo Raeume
   *  herkommen. Was hier stattdessen steht, ist „Ausblenden": derselbe
   *  Wunsch, ohne fremde Daten anzufassen.
   */
  _menuItems() {
    const menu = this._menu;
    if (!menu) return [];
    const items = [];

    if (!this._edit) {
      // Rechtsklick ist der Weg *ins* Bearbeiten. Ein Menue, das ausserhalb
      // gar nicht aufgeht, liest sich wie ein Fehler.
      if (this._canEdit) {
        items.push({ id: "edit-on", label: "Bearbeiten einschalten",
                     icon: "mdi:pencil" });
      }
      if (menu.kind === "node") {
        items.push({ id: "node-details", label: "Details",
                     icon: "mdi:information-outline" });
      }
      return items;
    }

    if (menu.kind === "node") {
      if (!this._editIcons) {
        return [{ id: "edit-icons", label: "Zu den Geräten wechseln",
                  icon: "mdi:lightbulb-outline" }];
      }
      return [
        { id: "node-details", label: "Details",
          icon: "mdi:information-outline" },
        { id: "node-reset", label: "Zurücksetzen",
          icon: "mdi:backup-restore" },
        { id: "node-hide", label: "Ausblenden",
          icon: "mdi:eye-off-outline" },
      ];
    }

    if (menu.kind === "area") {
      if (!this._editRooms) {
        return [{ id: "edit-rooms", label: "Zu den Räumen wechseln",
                  icon: "mdi:floor-plan" }];
      }
      const area = (this._model.areas || []).find(
        (candidate) => candidate.id === menu.id,
      );
      if (!area) return [];
      const kind = kindOf(area);
      items.push({ id: "area-settings", label: "Einstellungen …",
                   icon: "mdi:tune-variant" });
      items.push({ separator: true });
      items.push({ id: "kind-indoor", label: "Raum",
                   icon: "mdi:home-outline",
                   on: kind === AREA_KIND.INDOOR });
      items.push({ id: "kind-outdoor", label: "Außenbereich",
                   icon: "mdi:tree-outline",
                   on: kind === AREA_KIND.OUTDOOR });
      items.push({ id: "kind-virtual", label: "Virtuell",
                   icon: "mdi:cloud-outline",
                   on: kind === AREA_KIND.VIRTUAL });
      items.push({ separator: true });
      items.push({ id: "area-corners",
                   label: this._corners ? "Ecken fertig" : "Ecken bearbeiten",
                   icon: "mdi:vector-square", on: this._corners });
      items.push({ id: "area-reset", label: "Anordnung zurücksetzen",
                   icon: "mdi:backup-restore" });
      items.push({ id: "area-hide", label: "Ausblenden",
                   icon: "mdi:eye-off-outline" });
      return items;
    }

    // Der leere Plan: was die ganze Etage angeht.
    if (this._editRooms) {
      items.push({ id: "plot-toggle",
                   label: this._plot ? "Grundstück entfernen"
                                     : "Grundstück zeichnen",
                   icon: "mdi:vector-polygon", on: !!this._plot });
      items.push({ id: "shape-new", label: "Neue Fläche zeichnen",
                   icon: "mdi:shape-polygon-plus" });
    }
    if (this._floor) {
      items.push({ id: "floor-reset", label: "Etage zurücksetzen",
                   icon: "mdi:backup-restore" });
    }
    return items;
  }

  _menuHtml() {
    const menu = this._menu;
    if (!menu) return "";
    const items = this._menuItems();
    // Ein Menue ohne Eintraege ist eine leere Sprechblase. Dann lieber
    // keines: der Rechtsklick hat schon nichts getan, er soll nicht auch
    // noch etwas hinstellen, das man wegklicken muss.
    if (!items.length) return "";
    const rows = items
      .map((item) =>
        item.separator
          ? `<div class="menu-rule"></div>`
          : `<button class="menu-item ${item.on ? "on" : ""}"
                     data-menu="${escapeHtml(item.id)}">
               <ha-icon icon="${escapeHtml(item.icon)}"></ha-icon>
               <span class="menu-label">${escapeHtml(item.label)}</span>
               ${item.on
                   ? '<ha-icon class="menu-tick" icon="mdi:check"></ha-icon>'
                   : ""}
             </button>`,
      )
      .join("");
    // Am rechten oder unteren Rand klappt das Menue zur anderen Seite auf,
    // statt aus dem Fenster zu laufen. Grob geschaetzte Masse: genau
    // ausmessen hiesse, erst zu zeichnen und dann zu springen.
    const width = 230;
    const height = 34 * items.length + 16;
    const room = typeof window !== "undefined" ? window : { innerWidth: 1e4,
                                                            innerHeight: 1e4 };
    const left = Math.max(4, Math.min(menu.x, (room.innerWidth || 1e4) - width - 4));
    const top = Math.max(4, Math.min(menu.y, (room.innerHeight || 1e4) - height - 4));
    return `
      <div class="menu-scrim" data-menu-close="1"></div>
      <div class="menu" style="left:${left}px; top:${top}px;">${rows}</div>`;
  }

  /** Einen Eintrag ausfuehren. Das Menue geht dabei immer zu. */
  _runMenu(id) {
    const menu = this._menu;
    this._menu = null;
    if (!menu) return;
    const area = () =>
      (this._model.areas || []).find(
        (candidate) => candidate.id === menu.id,
      );

    switch (id) {
      case "edit-on":
        this._edit = true;
        break;
      case "edit-rooms":
        this._editWhat = "rooms";
        break;
      case "edit-icons":
        this._editWhat = "icons";
        this._corners = false;
        break;
      case "node-details":
        this._selected = { kind: "node", id: menu.id };
        break;
      case "node-hide":
        this._selected = null;
        this._setLayout("nodes", menu.id, { hidden: true });
        return;
      case "node-reset":
        this._selected = null;
        this._resetItem("nodes", menu.id);
        return;
      case "area-settings":
        this._areaDialog = menu.id;
        break;
      case "kind-indoor":
      case "kind-outdoor":
      case "kind-virtual":
        this._setAreaKind(area(), id.slice("kind-".length));
        return;
      case "area-corners":
        this._corners = !this._corners;
        break;
      case "area-hide":
        this._setLayout("areas", menu.id, { hidden: true });
        return;
      case "area-reset":
        this._resetItem("areas", menu.id);
        return;
      case "plot-toggle":
        this._togglePlot();
        return;
      case "shape-new":
        this._addShape();
        return;
      case "floor-reset":
        this._resetFloor();
        return;
      default:
        break;
    }
    this._render();
  }

  /** Die Art eines Bereichs setzen: Raum, Aussenbereich oder virtuell.
   *
   *  Mit dem alten Wert als Ruecknahme, damit ein fehlgeschlagener
   *  Schreibvorgang den Plan nicht in einem Zustand stehen laesst, den
   *  niemand gewaehlt hat.
   */
  _setAreaKind(area, kind) {
    if (!area) return;
    this._setLayout("areas", area.id, { kind }, { kind: kindOf(area) });
  }

  /** Eine einzelne Anordnung vergessen und neu holen. */
  _resetItem(section, key) {
    this._io
      .call({ type: `${DOMAIN}/layout/reset`, section, key })
      .then(() => this._refresh())
      .catch(() => this._refresh());
  }

  get _customLayers() {
    return (this._model && this._model.custom_layers) || [];
  }

  _customLayersHtml() {
    if (!this._edit) return "";
    const layers = this._customLayers
      .map(
        (layer) => `
        <button class="row" data-edit-layer="${escapeHtml(layer.id)}">
          <ha-icon icon="${escapeHtml(layer.icon || "mdi:shape-outline")}"></ha-icon>
          <span>${escapeHtml(layer.name || layer.id)}</span>
        </button>`,
      )
      .join("");
    return `
      <h3>Eigene Ebenen</h3>
      <p class="note">Beschreibe, was auf den Grundriss soll — die
      Integration dahinter spielt keine Rolle und wird nie gefragt.</p>
      <div class="rows">${layers}</div>
      <button class="chip" data-new-layer="1">+ Ebene</button>`;
  }

  _layerDialogHtml() {
    const layer = this._layerDialog;
    const facets = this._facets || { domains: [], labels: [], device_classes: [] };

    const chips = (field, options, empty) =>
      options.length
        ? `<div class="chips">
             ${options
               .map(
                 ({ value, count, label }) => `
               <button class="chip ${
                 (layer[field] || []).includes(value) ? "on" : ""
               }" data-facet="${escapeHtml(field)}"
                  data-value="${escapeHtml(value)}">
                 ${escapeHtml(label || value)}${
                   count ? ` <span class="muted">${count}</span>` : ""
                 }
               </button>`,
               )
               .join("")}
           </div>`
        : `<p class="note">${empty}</p>`;

    const areas = (this._model.areas || []).map((area) => ({
      value: area.id,
      label: area.name,
    }));

    return `
      <div class="scrim" data-close-layer="1"></div>
      <div class="popup">
        <div class="popup-head">
          <h2>${layer._isNew ? "Neue Ebene" : "Ebene bearbeiten"}</h2>
          <button class="icon-btn" data-close-layer="1">
            <ha-icon icon="mdi:close"></ha-icon>
          </button>
        </div>
        <label class="field">
          <span>Name</span>
          <input type="text" value="${escapeHtml(layer.name || "")}"
                 data-layer-field="name" placeholder="Lichter">
        </label>
        <label class="field">
          <span>Icon</span>
          <input type="text" value="${escapeHtml(layer.icon || "")}"
                 data-layer-field="icon" placeholder="mdi:lightbulb">
        </label>

        <h3>Was gehört dazu?</h3>
        <p class="note">Eine Regel, keine Liste: „alle Lichter" stimmt auch
        noch, wenn nächsten Monat eine Lampe dazukommt.</p>

        <span class="muted">Art</span>
        ${chips("domains", facets.domains, "Keine Entitäten gefunden.")}
        <span class="muted">Bereich <i>(leer = überall)</i></span>
        ${chips("areas", areas, "Keine Bereiche angelegt.")}
        ${
          facets.labels.length
            ? `<span class="muted">Label</span>${chips("labels", facets.labels, "")}`
            : ""
        }
        ${
          facets.device_classes.length
            ? `<span class="muted">Geräteklasse</span>
               ${chips("device_classes", facets.device_classes, "")}`
            : ""
        }

        <label class="field">
          <span>Zusätzlich <i>(Entity-IDs, mit Komma getrennt)</i></span>
          <input type="text" value="${escapeHtml((layer.entities || []).join(", "))}"
                 data-layer-field="entities" placeholder="sensor.aussen, light.flur">
        </label>
        <label class="field">
          <span>Ausnehmen</span>
          <input type="text" value="${escapeHtml((layer.exclude || []).join(", "))}"
                 data-layer-field="exclude">
        </label>

        <label class="field">
          <span>Verbindungen zeichnen</span>
          <label class="inline">
            <input type="checkbox" data-layer-toggle="topology"
                   ${layer.topology ? "checked" : ""}>
            Geräte mit ihrer Bridge, ihrem Controller oder ihrem Hub verbinden
          </label>
          <i class="muted">Home Assistant weiß bei vielen Geräten, worüber sie
          erreicht werden. Diese Verbindung wird gezeichnet — ohne Aussage
          darüber, wie gut sie ist, denn das misst niemand.</i>
        </label>

        <div class="edit-buttons">
          <button class="action" data-save-layer="1">Speichern</button>
          ${
            layer._isNew
              ? ""
              : `<button class="chip" data-delete-layer="1">
                   <ha-icon icon="mdi:delete-outline"></ha-icon> Löschen
                 </button>`
          }
        </div>
      </div>`;
  }

  async _openLayerDialog(layerId) {
    const existing = this._customLayers.find((layer) => layer.id === layerId);
    this._layerDialog = existing
      ? { ...existing }
      : {
          id: `l${Date.now().toString(36)}`,
          name: "",
          icon: "",
          domains: [],
          areas: [],
          _isNew: true,
        };
    if (!this._facets) {
      try {
        this._facets = await this._io.call({
          type: `${DOMAIN}/entities/facets`,
        });
      } catch (err) {
        this._facets = { domains: [], labels: [], device_classes: [] };
      }
    }
    this._render();
  }

  _writeCustomLayers(layers) {
    this._setLayout("settings", "view", { custom_layers: layers });
  }

  _saveLayer() {
    const layer = { ...this._layerDialog };
    const isNew = layer._isNew;
    delete layer._isNew;
    if (!layer.name) layer.name = "Eigene Ebene";
    // Drop the empty criteria: an absent key reads as "no opinion", and
    // storing a pile of empty lists makes the stored rule unreadable.
    for (const key of ["domains", "areas", "labels", "device_classes",
                       "entities", "exclude"]) {
      if (!layer[key] || !layer[key].length) delete layer[key];
    }
    if (!layer.topology) delete layer.topology;
    const others = this._customLayers.filter(
      (candidate) => candidate.id !== layer.id,
    );
    this._layerDialog = null;
    this._writeCustomLayers(isNew ? [...others, layer] : [...others, layer]);
  }

  _deleteLayer() {
    const id = this._layerDialog.id;
    this._layerDialog = null;
    this._writeCustomLayers(
      this._customLayers.filter((layer) => layer.id !== id),
    );
  }

  _hiddenTrayHtml() {
    const hidden = (this._model && this._model.hidden) || {};
    const nodes = hidden.nodes || [];
    const areas = hidden.areas || [];
    if (!nodes.length && !areas.length) return "";
    return `
      <h3>Ausgeblendet</h3>
      <p class="note">Anklicken holt es zurück.</p>
      <div class="chips">
        ${areas
          .map(
            (area) => `
          <button class="chip" data-show-area="${escapeHtml(area.id)}">
            ${escapeHtml(area.name)}
          </button>`,
          )
          .join("")}
        ${nodes
          .map(
            (node) => `
          <button class="chip" data-show-node="${escapeHtml(node.id)}">
            ${escapeHtml(node.label)}
          </button>`,
          )
          .join("")}
      </div>`;
  }

  _themeDialogHtml() {
    const theme = this._theme;
    const chips = ["auto", "classic", "blueprint", "neon", "paper"]
      .map(
        (preset) => `
        <button class="chip ${theme.preset === preset ? "on" : ""}"
                data-preset="${preset}">${preset}</button>`,
      )
      .join("");

    const choice = (attribute, label, options, current) => `
      <label class="field">
        <span>${label}</span>
        <select data-${attribute}>
          ${options
            .map(
              ([value, text]) => `
            <option value="${value}" ${value === current ? "selected" : ""}>
              ${text}
            </option>`,
            )
            .join("")}
        </select>
      </label>`;

    const swatches = (attribute, colours, title) => `
      <div class="swatches">
        <span class="muted">${title}</span>
        ${Object.entries(colours || {})
          .map(
            ([word, colour]) => `
          <label class="swatch" title="${escapeHtml(word)}">
            <input type="color" value="${escapeHtml(colour || "#888888")}"
                   data-${attribute}="${escapeHtml(word)}">
            <span>${escapeHtml(word)}</span>
          </label>`,
          )
          .join("")}
      </div>`;

    return `
      <div class="scrim" data-close-theme="1"></div>
      <div class="popup">
        <div class="popup-head">
          <h2>Aussehen</h2>
          <button class="icon-btn" data-close-theme="1">
            <ha-icon icon="mdi:close"></ha-icon>
          </button>
        </div>
        <p class="note">Ein Theme färbt das gemeinsame Vokabular — Zustände
        und Verbindungsqualität. Nie eine einzelne Integration: die nächste,
        die dazukommt, sieht dadurch von selbst richtig aus.</p>
        <div class="chips">${chips}</div>
        ${choice("node-shape", "Form", [
          ["circle", "Kreis"], ["rounded", "Abgerundet"], ["square", "Eckig"],
        ], theme.node_shape)}
        ${choice("labels", "Beschriftung", [
          ["always", "Immer"], ["hover", "Beim Zeigen"], ["never", "Nie"],
        ], theme.labels)}
        ${choice("edge-style", "Verbindungen", [
          ["straight", "Gerade"], ["curved", "Gebogen"],
        ], theme.edge_style)}
        ${choice("room-style", "Räume", [
          ["outline", "Umriss"], ["filled", "Gefüllt"], ["none", "Aus"],
        ], theme.room_style)}
        <label class="field">
          <span>Größe <b data-size-value>${(theme.node_size || 1).toFixed(
            2,
          )}×</b></span>
          <input type="range" min="0.4" max="3" step="0.05"
                 value="${theme.node_size || 1}" data-theme-size="1">
        </label>
        <label class="field">
          <span>Haus <b data-house-value>${houseWeight(theme).toFixed(2)}×</b></span>
          <input type="range" min="0.2" max="1.6" step="0.05"
                 value="${houseWeight(theme)}" data-theme-house="1">
        </label>
        <p class="note">Außenwände, Innenwände und Etagenplatten zusammen.
        Ganz links bleibt fast nur der Umriss und die Geräte stehen für
        sich; ganz rechts ist es ein Bauplan, in dem man sieht, welcher
        Raum welcher ist.</p>
        <label class="field">
          <span>Einrasten <b data-snap-value>${snapReach(theme).toFixed(2)}×</b></span>
          <input type="range" min="0.4" max="3" step="0.1"
                 value="${snapReach(theme)}" data-theme-snap="1">
        </label>
        <p class="note">Wie leicht eine gezogene Wand an der Nachbarwand
        oder der Hausflucht einrastet. Ganz links zielt man genau, ganz
        rechts reicht ungefähr hin.</p>
        ${swatches("state-color", theme.state_colors, "Zustände")}
        ${swatches("quality-color", theme.quality_colors, "Qualität")}
        <button class="link" data-reset-theme="1">Auf Standard zurücksetzen</button>
      </div>`;
  }

  _floorDialogHtml() {
    const floor = this._floor;
    if (!floor) return "";
    return `
      <div class="scrim" data-close-floor="1"></div>
      <div class="popup">
        <div class="popup-head">
          <h2>${escapeHtml(floor.name)}</h2>
          <button class="icon-btn" data-close-floor="1">
            <ha-icon icon="mdi:close"></ha-icon>
          </button>
        </div>
        <p class="note">Ein Grundriss-Bild als Hintergrund. Es bleibt im
        Browser des Nutzers nichts hängen — der Hub speichert es, und jeder
        Renderer bekommt es mit dem Modell.</p>
        <label class="field">
          <span>Hintergrundbild</span>
          <input type="file" accept="image/*" data-background="1">
        </label>
        ${
          floor.background
            ? `<button class="link" data-clear-background="1">Bild entfernen</button>`
            : ""
        }
        <label class="field">
          <span>Seitenverhältnis <b data-aspect-value>${(
            floor.aspect || 1.6
          ).toFixed(2)}</b></span>
          <input type="range" min="0.5" max="3" step="0.05"
                 value="${floor.aspect || 1.6}" data-aspect="1">
        </label>
      </div>`;
  }

  _editPanelHtml(kind, id, item) {
    if (kind !== "node") return "";
    return `
      <div class="edit-panel">
        <label class="field">
          <span>Größe <b>${(item.scale || 1).toFixed(2)}×</b></span>
          <input type="range" min="0.4" max="3" step="0.1"
                 value="${item.scale || 1}" data-node-scale="${escapeHtml(id)}">
        </label>
        <label class="field">
          <span>Drehung <b>${Math.round(item.rotation || 0)}°</b></span>
          <input type="range" min="-180" max="180" step="5"
                 value="${item.rotation || 0}" data-node-rotation="${escapeHtml(id)}">
        </label>
        <div class="edit-buttons">
          <button class="chip" data-hide-node="${escapeHtml(id)}">
            <ha-icon icon="mdi:eye-off-outline"></ha-icon> Ausblenden
          </button>
          <button class="chip" data-reset-item="${escapeHtml(id)}">
            <ha-icon icon="mdi:backup-restore"></ha-icon> Zurücksetzen
          </button>
        </div>
      </div>`;
  }

  _diagnosticsHtml() {
    const providers = (this._diagnostics && this._diagnostics.providers) || {};
    const entries = Object.entries(providers);
    const body = entries.length
      ? entries
          .map(([providerId, status]) => {
            const problems = [
              ...(status.error ? [status.error] : []),
              ...(status.warnings || []),
              ...(status.registration_warnings || []),
            ];
            return `
            <div class="diag-provider">
              <b>${escapeHtml(providerId)}</b>
              <span class="muted">${status.nodes ?? 0} Nodes · ${
                status.edges ?? 0
              } Edges</span>
              ${
                problems.length
                  ? `<ul>${problems
                      .map((problem) => `<li>${escapeHtml(problem)}</li>`)
                      .join("")}</ul>`
                  : `<p class="ok">Keine Beanstandungen.</p>`
              }
            </div>`;
          })
          .join("")
      : `<p class="note">Kein Provider hat bisher geliefert.</p>`;
    return `
      <section class="diagnostics">
        <div class="diag-head">
          <h3>Diagnose</h3>
          <button class="icon-btn" data-toggle="diagnostics">
            <ha-icon icon="mdi:close"></ha-icon>
          </button>
        </div>
        ${body}
      </section>`;
  }

  _popupHtml() {
    if (!this._selected) return "";
    const { kind, id } = this._selected;
    const item = kind === "node" ? this._node(id) : this._edge(id);
    if (!item) return "";

    const capabilities = this._capabilities(id);
    const metadata = Object.entries(item.metadata || {}).filter(
      ([key]) => key !== "auto_position",
    );
    const rows = metadata.length
      ? metadata
          .map(
            ([key, value]) => `
        <tr><th>${escapeHtml(pretty(key))}</th>
            <td>${escapeHtml(formatValue(value))}</td></tr>`,
          )
          .join("")
      : `<tr><td colspan="2" class="note">Keine Details geliefert.</td></tr>`;

    const actions = (item.actions || [])
      .map(
        (action) => `
        <button class="action" data-action="${escapeHtml(action.id)}"
                data-confirm="${action.confirm ? "1" : ""}">
          ${action.icon ? `<ha-icon icon="${escapeHtml(action.icon)}"></ha-icon>` : ""}
          ${escapeHtml(action.label || action.id)}
        </button>`,
      )
      .join("");

    const canAct = this._io.canEdit();
    const custom = kind === "node" ? this._customIcon(item) : null;
    const badge = kind === "node"
      ? `<span class="popup-icon" style="--node-color:${escapeHtml(
          this._nodeColour(item),
        )}">${
          custom
            ? `<span class="custom-icon">${custom.svg}</span>`
            : `<ha-icon icon="${escapeHtml(
                item.icon || this._genericIcon(item),
              )}"></ha-icon>`
        }</span>`
      : "";

    return `
      <div class="scrim" data-close="1"></div>
      <div class="popup centred" role="dialog" aria-modal="true">
        <div class="popup-head">
          ${badge}
          <h2>${escapeHtml(item.label || id)}</h2>
          <button class="icon-btn" data-close="1">
            <ha-icon icon="mdi:close"></ha-icon>
          </button>
        </div>
        <p class="sub">
          ${escapeHtml(kind === "node" ? item.state : item.quality)}
          ${item.value != null ? ` · ${escapeHtml(item.value)}` : ""}
          · <span class="muted">${escapeHtml(this._providerOf(id))}</span>
        </p>
        ${this._popupLinksHtml(kind, id, item)}
        ${this._edit ? this._editPanelHtml(kind, id, item) : ""}
        <table>${rows}</table>
        ${
          capabilities.history
            ? `<div class="history">
                 ${
                   this._history
                     ? sparklineHtml(this._history)
                     : `<button class="link" data-history="1">Verlauf laden</button>`
                 }
               </div>`
            : ""
        }
        ${
          actions
            ? canAct
              ? `<div class="actions">${actions}</div>`
              : `<p class="note">Aktionen erfordern Administratorrechte.</p>`
            : ""
        }
      </div>`;
  }

  /** Every way out of the popup that leads somewhere useful.
   *
   *  The point is that the user never has to leave the floor plan to find
   *  out more, and when they do leave, it is by a door they chose: the
   *  more-info dialog, the device, its entities, its settings, or the
   *  provider's own view. Home Assistant stays the source of the data;
   *  the hub only knows where its doors are.
   */
  _popupLinksHtml(kind, id, item) {
    if (kind !== "node") return "";
    const provider = ((this._model && this._model.providers) || []).find(
      (candidate) => candidate.id === this._providerOf(id),
    );
    const entities = item.entities || [];
    const links = [];

    if (item.entity_id) {
      links.push(`<button class="chip" data-more-info="${escapeHtml(
        item.entity_id,
      )}"><ha-icon icon="mdi:information-outline"></ha-icon> More-Info</button>`);
    }
    if (item.device_id) {
      links.push(`<button class="chip" data-navigate="/config/devices/device/${escapeHtml(
        item.device_id,
      )}"><ha-icon icon="mdi:devices"></ha-icon> Gerät öffnen</button>`);
    }
    if (entities.length) {
      links.push(`<button class="chip" data-toggle-entities="1">
        <ha-icon icon="mdi:format-list-bulleted"></ha-icon>
        Entitäten (${entities.length})</button>`);
    }
    if (item.entity_id) {
      links.push(`<button class="chip" data-settings="${escapeHtml(
        item.entity_id,
      )}"><ha-icon icon="mdi:cog-outline"></ha-icon> Einstellungen</button>`);
    }
    if (provider && provider.panel_url) {
      links.push(`<button class="chip" data-navigate="${escapeHtml(
        provider.panel_url,
      )}">${
        provider.icon
          ? `<ha-icon icon="${escapeHtml(provider.icon)}"></ha-icon>`
          : ""
      } ${escapeHtml(provider.name || provider.id)}</button>`);
    }

    const list = this._showEntities && entities.length
      ? `<ul class="entities">
          ${entities
            .map(
              (entity) => `
            <li>
              <button class="link" data-more-info="${escapeHtml(
                entity.entity_id,
              )}">${escapeHtml(entity.name || entity.entity_id)}</button>
              <span class="muted">${escapeHtml(entity.state || "")}</span>
            </li>`,
            )
            .join("")}
        </ul>`
      : "";

    return links.length ? `<div class="links">${links.join("")}</div>${list}` : "";
  }


  // ── Interaction ─────────────────────────────────────────

  _placingLabel() {
    const area = (this._model.areas || []).find(
      (candidate) => candidate.id === this._placing.key,
    );
    return (area && area.name) || this._placing.key;
  }

  // ── Dragging ────────────────────────────────────────────

  /** Snap to a 2 % grid so rooms line up; Shift is the escape hatch.
   *
   *  Clamped to the window being drawn, which on a floor with a garden is
   *  wider than the house -- dragging a bench onto the terrace must not
   *  snap it back inside the walls.
   */
  _snap(value, event, frame = { min: 0, span: 1 }) {
    return snapTo(value, frame, event.shiftKey);
  }

  /** Every other room's walls on this floor, split by axis.
   *
   *  What a dragged wall can land on. The room being dragged is left out,
   *  or it would snap to itself and never move again.
   */
  _wallLines(exceptId) {
    const mine = this._visibleAreas.filter(
      (area) =>
        area.id !== exceptId && joinable(area) &&
        !(this._floor && area.floor_id !== this._floor.id),
    );
    // Und die Aussenkanten der anderen Etagen, damit eine Wand nicht nur
    // an ihre Nachbarn andocken kann, sondern auch an die Flucht des
    // Hauses -- aber nur, wenn sie auch zu sehen sind. Ein Magnet an
    // einer Linie, die niemand sieht, ist kein Einrasten, sondern ein
    // Ruckeln ohne Grund; derselbe Knopf, der die Konturen einblendet,
    // macht sie anziehend.
    //
    // Die eigene Aussenkante zaehlt bewusst *nicht* dazu: sie ist aus
    // genau den Raeumen abgeleitet, die hier gezogen werden, und ein Raum,
    // der sich an seiner eigenen Kontur festhaelt, kommt nicht mehr los.
    const outlines = this._ghosts
      ? this._ghostFloors().map((floor) => floor.outline)
      : [];
    return wallLinesOf(mine, outlines);
  }

  /** Welche fremden Konturen dieser Kasten gerade genau trifft.
   *
   *  Fuer die Rueckmeldung beim Ziehen: eingerastet und *fast* eingerastet
   *  sehen auf dem Schirm gleich aus, und bei einer blassen gestrichelten
   *  Linie sieht man den Unterschied erst recht nicht. Eine Etage, deren
   *  Flucht getroffen ist, sagt es also selbst.
   */
  _flushFloors(rect) {
    if (!this._ghosts) return [];
    return this._ghostFloors()
      .filter((floor) => flushWith(rect, floor.outline))
      .map((floor) => floor.id);
  }

  /** Hat die gerade gezogene Wand auf eine fremde Wand eingerastet?
   *
   *  Eingerastet und *fast* eingerastet sehen auf dem Bildschirm gleich
   *  aus -- ohne dieses Signal weiss niemand, ob das Ruckeln beim
   *  Ziehen ein Magnet war oder nur das 2 %-Raster.
   */
  _showSnap(element, rect, lines) {
    if (!element || !element.classList || !element.classList.toggle) return;
    const hit = (value, list) =>
      (list || []).some((line) => Math.abs(line - value) <= JOIN_GAP);
    const snapped =
      hit(rect.left, lines && lines.x) || hit(rect.right, lines && lines.x) ||
      hit(rect.top, lines && lines.y) || hit(rect.bottom, lines && lines.y);
    element.classList.toggle("snapped", snapped);
  }

  /** Die getroffenen Konturen hervorheben, ohne neu zu zeichnen.
   *
   *  Direkt am Element, wie der gezogene Raum selbst: ein Neuzeichnen
   *  mitten im Ziehen nimmt der Hand weg, was sie gerade haelt.
   */
  _showFlush(rect) {
    if (!this._root || !this._root.querySelectorAll) return;
    const flush = new Set(this._flushFloors(rect));
    for (const element of this._root.querySelectorAll("[data-ghost]")) {
      element.classList.toggle(
        "flush",
        flush.has(element.getAttribute("data-ghost")),
      );
    }
  }

  /** Pull a wall onto a neighbour's wall when one is within reach.
   *
   *  This is what makes a shared wall shared without anybody typing a
   *  number: you drag a room roughly against the next one, it lands
   *  exactly, and from then on the two walls are one. Shift still turns
   *  everything off, the same as it does for the grid.
   *
   *  Falls back to the grid, so a room with no neighbour behaves exactly
   *  as it did before.
   */
  _magnet(value, axis, event, frame, lines) {
    return magnetTo(
      value, lines && lines[axis], frame, event.shiftKey,
      snapReach(this._theme),
    );
  }

  _onPointerDown(event) {
    if (event.button !== 0 && event.button !== 1) return;
    const path = event.composedPath();
    const find = (attribute) =>
      path.find(
        (element) =>
          element.getAttribute && element.getAttribute(attribute) !== null,
      );

    // Der Griff des Legendenblatts kommt vor allem anderen: er liegt
    // ueber dem Plan, und was darunter liegt, geht ihn nichts an.
    if (find("data-legend-grab")) {
      this._onSheetDown(
        event,
        path.find(
          (element) =>
            element.classList && element.classList.contains("legend"),
        ),
      );
      if (!this._sheet) return;
      const move = (moveEvent) => this._onSheetMove(moveEvent);
      const up = (upEvent) => {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
        window.removeEventListener("pointercancel", up);
        this._onSheetUp(upEvent);
      };
      window.addEventListener("pointermove", move, { passive: false });
      window.addEventListener("pointerup", up);
      window.addEventListener("pointercancel", up);
      return;
    }

    const stage = path.find(
      (element) =>
        element.classList &&
        (element.classList.contains("stage") ||
          element.classList.contains("stack")),
    );

    const plotGrip = find("data-plot-index");
    const cornerGrip = find("data-corner-area");
    const shapeGrip = find("data-shape-index");
    const grip = find("data-resize-area");
    const areaElement = find("data-area");
    const nodeElement = find("data-node");
    const anyGrip = plotGrip || cornerGrip || shapeGrip;
    const draggable =
      this._edit && stage &&
      (anyGrip || grip || areaElement || nodeElement) &&
      // Buttons drawn on top of a draggable thing keep working.
      (anyGrip || grip ||
        !(find("data-hide-area") || find("data-area-dialog"))) &&
      // Alt on a corner means "remove this one", which the click handler
      // deals with. Starting a drag as well would move it first.
      !(anyGrip && (event.altKey || event.metaKey)) &&
      // The × sits on top of its own corner. Dragging it would move the
      // corner first and delete it second, which is one gesture too many.
      !find("data-corner-drop") && !find("data-plot-drop") &&
      !find("data-corner-add") && !find("data-plot-add") &&
      !find("data-shape-drop") && !find("data-shape-add") &&
      // Two editing modes, two sets of things that move. Rooms hold still
      // while devices are sorted, and devices hold still while walls are
      // dragged -- otherwise every grab in a busy room hits the wrong one.
      (nodeElement ? this._editIcons : this._editRooms);

    if (!draggable) {
      // Everything that is not being arranged pans the view, in every
      // view: the plan is a map, and a map is dragged.
      if (this._inViewport(event) && !find("data-node") && !find("data-edge")) {
        this._startPan(event);
      }
      return;
    }

    const target = plotGrip
      ? {
          mode: "plot",
          section: "floors",
          key: (this._floor || {}).id,
          index: Number(plotGrip.getAttribute("data-plot-index")),
          element: plotGrip,
        }
      : shapeGrip
      ? {
          mode: "shape",
          section: "settings",
          key: shapeGrip.getAttribute("data-shape-owner"),
          index: Number(shapeGrip.getAttribute("data-shape-index")),
          element: shapeGrip,
        }
      : cornerGrip
      ? {
          mode: "corner",
          section: "areas",
          key: cornerGrip.getAttribute("data-corner-area"),
          index: Number(cornerGrip.getAttribute("data-corner-index")),
          element: cornerGrip,
        }
      : grip
      ? {
          mode: "resize",
          section: "areas",
          key: grip.getAttribute("data-resize-area"),
          edge: grip.getAttribute("data-resize-edge") || "se",
          element: areaElement,
        }
      : nodeElement
        ? { mode: "move", section: "nodes", key: nodeElement.getAttribute("data-node"),
            element: nodeElement }
        : { mode: "area", section: "areas", key: areaElement.getAttribute("data-area"),
            element: areaElement };

    event.preventDefault();
    this._dragged = false;
    this._drag = {
      ...target,
      stage,
      frame: this._frame,
      // A corner drag changes the outline, not the box, so its undo is
      // the outline -- restoring a position here would put the shape
      // back and leave the room somewhere else.
      before:
        target.mode === "corner"
          ? this._shapeBefore(this._area(target.key) || {})
          : target.mode === "plot"
          ? { plot: (this._floor || {}).plot || null }
          : target.mode === "shape"
          ? { custom_shapes: this._model.shapes || [] }
          : this._layoutOf(target.section, target.key),
      start: this._rectOf(target.section, target.key),
      // The neighbours' walls, taken once. Recomputing them on every
      // pointer move would let a room snap to a wall it has already
      // pushed, which is a room that walks.
      lines:
        target.section === "areas" && target.mode !== "corner"
          ? this._wallLines(target.key)
          : null,
      box: stage.getBoundingClientRect(),
    };

    const move = (moveEvent) => this._onPointerMove(moveEvent);
    const up = (upEvent) => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      this._onPointerUp(upEvent);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  /** What is stored for an item right now -- the far end of an undo. */
  _layoutOf(section, key) {
    const item = section === "nodes"
      ? this._node(key)
      : (this._model.areas || []).find((area) => area.id === key);
    if (!item) return {};
    return section === "nodes"
      ? { position: item.position ? { ...item.position } : null }
      : {
          position: item.position ? { ...item.position } : null,
          size: item.size ? { ...item.size } : null,
        };
  }

  /** Break a shared wall apart, or put it back together.
   *
   *  Stored on the room that was clicked, and read from both sides: a
   *  break made here must still be a break when the neighbour is the one
   *  being edited. Storing it on one side only and reading it from one
   *  side only would let the same wall be joined and broken at once,
   *  depending on which room you happened to look at.
   */
  _toggleJoin(id, other) {
    const area = this._area(id);
    const neighbour = this._area(other);
    if (!area || !neighbour) return;

    const mine = Array.isArray(area.unjoined) ? area.unjoined : [];
    const theirs = Array.isArray(neighbour.unjoined) ? neighbour.unjoined : [];
    if (mine.includes(other) || theirs.includes(id)) {
      // Joining again has to clear the break wherever it was written,
      // or the wall stays apart and the + does nothing.
      if (mine.includes(other)) {
        this._setLayout("areas", id, {
          unjoined: mine.filter((entry) => entry !== other),
        });
      }
      if (theirs.includes(id)) {
        this._setLayout("areas", other, {
          unjoined: theirs.filter((entry) => entry !== id),
        });
      }
      return;
    }
    this._setLayout("areas", id, { unjoined: [...mine, other] });
  }

  /** An area's walls, in floor coordinates. */
  _rectOf(section, key) {
    if (section !== "areas") return null;
    const area = (this._model.areas || []).find(
      (candidate) => candidate.id === key,
    );
    if (!area || !area.position) return null;
    const size = area.size || { width: 0.3, height: 0.3 };
    return {
      left: area.position.x - size.width / 2,
      right: area.position.x + size.width / 2,
      top: area.position.y - size.height / 2,
      bottom: area.position.y + size.height / 2,
    };
  }

  /** Pointer position in floor coordinates, apron included. */
  _toFloor(event, drag) {
    const frame = drag.frame;
    return {
      x: frame.min + ((event.clientX - drag.box.left) / drag.box.width) * frame.span,
      y: minY(frame) +
        ((event.clientY - drag.box.top) / drag.box.height) * spanY(frame),
    };
  }

  _onPointerMove(event) {
    const drag = this._drag;
    if (!drag) return;
    this._dragged = true;
    const frame = drag.frame;
    const { x, y } = this._toFloor(event, drag);

    if (drag.mode === "plot") {
      // Floor coordinates straight through: the plot is the outline with
      // nothing around it, so there is no box to be relative to. The
      // frame is the only limit, and on a floor with a garden that is
      // already wider than the house.
      const plot = (this._plot || []).map((point) => ({ ...point }));
      if (!plot[drag.index]) return;
      plot[drag.index] = {
        x: this._snap(x, event, frame),
        y: this._snap(y, event, yFrame(frame)),
      };
      drag.value = { plot };
      const shell = drag.element.parentElement &&
        drag.element.parentElement.querySelector(".plot");
      if (shell) {
        shell.style.clipPath = `polygon(${plot
          .map(
            (point) =>
              `${inFrame(point.x, frame).toFixed(2)}% ${inFrameY(
                point.y,
                frame,
              ).toFixed(2)}%`,
          )
          .join(",")})`;
      }
      drag.element.style.left = `${inFrame(plot[drag.index].x, frame).toFixed(2)}%`;
      drag.element.style.top = `${inFrameY(plot[drag.index].y, frame).toFixed(2)}%`;
      return;
    }

    if (drag.mode === "shape") {
      // Same idea as a plot corner -- floor coordinates straight through,
      // no box to be relative to -- except there can be several of these
      // per floor, so the one being dragged is picked out by its own id.
      const shape = this._shape(drag.key);
      if (!shape || !shape.points[drag.index]) return;
      const points = shape.points.map((point) => ({ ...point }));
      points[drag.index] = {
        x: this._snap(x, event, frame),
        y: this._snap(y, event, yFrame(frame)),
      };
      drag.value = {
        shapes: (this._model.shapes || []).map((entry) =>
          entry.id === drag.key ? { ...entry, points } : entry,
        ),
      };
      const shell = drag.element.parentElement &&
        drag.element.parentElement.querySelector(
          `[data-shape="${drag.key}"]`,
        );
      if (shell) {
        shell.style.clipPath = `polygon(${points
          .map(
            (point) =>
              `${inFrame(point.x, frame).toFixed(2)}% ${inFrameY(
                point.y,
                frame,
              ).toFixed(2)}%`,
          )
          .join(",")})`;
      }
      drag.element.style.left = `${inFrame(points[drag.index].x, frame).toFixed(2)}%`;
      drag.element.style.top = `${inFrameY(points[drag.index].y, frame).toFixed(2)}%`;
      return;
    }

    if (drag.mode === "corner" && drag.start) {
      // The shape lives in box coordinates, so the pointer is asked
      // where it is *within this room* -- 0 at one wall, 1 at the
      // opposite one. A corner never leaves its own box: the box is what
      // the walls, the label and the sandwich all agree on, and a corner
      // outside it would be a room bigger than itself.
      const width = drag.start.right - drag.start.left || 1;
      const height = drag.start.bottom - drag.start.top || 1;
      const inside = (value) => Math.min(1, Math.max(0, value));
      const grid = (value, span) =>
        event.shiftKey ? value : Math.round((value * span) / 0.02) * 0.02 / span;
      const shape = shapeOf(this._area(drag.key) || {}).map((point) => ({
        ...point,
      }));
      if (!shape[drag.index]) return;
      shape[drag.index] = {
        x: inside(grid((x - drag.start.left) / width, width)),
        y: inside(grid((y - drag.start.top) / height, height)),
      };
      drag.value = { shape };
      // Redrawn straight onto the fill, so the outline follows the
      // pointer instead of appearing once the drag is over.
      const fill = drag.element.parentElement &&
        drag.element.parentElement.querySelector(".area-fill");
      const polygon = `polygon(${shape
        .map((point) => `${(point.x * 100).toFixed(2)}% ${(point.y * 100).toFixed(2)}%`)
        .join(",")})`;
      if (fill) fill.style.clipPath = polygon;
      drag.element.style.left = `${(shape[drag.index].x * 100).toFixed(2)}%`;
      drag.element.style.top = `${(shape[drag.index].y * 100).toFixed(2)}%`;
      return;
    }

    if (drag.mode === "resize" && drag.start) {
      // Each handle moves the wall it sits on and leaves the opposite one
      // alone -- so a room is widened rather than scaled around its middle,
      // and its position changes as a consequence, which is what dragging
      // a wall does in a real plan.
      const rect = { ...drag.start };
      const minimum = 0.04;
      const lines = drag.lines;
      if (drag.edge.includes("w")) {
        rect.left = Math.min(
          this._magnet(x, "x", event, frame, lines), rect.right - minimum);
      }
      if (drag.edge.includes("e")) {
        rect.right = Math.max(
          this._magnet(x, "x", event, frame, lines), rect.left + minimum);
      }
      if (drag.edge.includes("n")) {
        rect.top = Math.min(
          this._magnet(y, "y", event, yFrame(frame), lines), rect.bottom - minimum);
      }
      if (drag.edge.includes("s")) {
        rect.bottom = Math.max(
          this._magnet(y, "y", event, yFrame(frame), lines), rect.top + minimum);
      }
      drag.value = {
        position: { x: (rect.left + rect.right) / 2,
                    y: (rect.top + rect.bottom) / 2 },
        size: { width: rect.right - rect.left, height: rect.bottom - rect.top },
      };
      drag.element.style.left = `${inFrame(drag.value.position.x, frame)}%`;
      drag.element.style.top = `${inFrameY(drag.value.position.y, frame)}%`;
      drag.element.style.width = `${(drag.value.size.width / frame.span) * 100}%`;
      drag.element.style.height = `${(drag.value.size.height / spanY(frame)) * 100}%`;
      this._showFlush(rect);
      this._showSnap(drag.element, rect, lines);
      return;
    }

    drag.value = {
      x: this._snap(x, event, frame),
      y: this._snap(y, event, yFrame(frame)),
    };
    // A room lands by its walls, not by its middle. Snapping the centre
    // puts a wall wherever half the room's width happens to fall, which
    // is never quite against the neighbour -- and "never quite" is the
    // whole difference between two rooms and a shared wall.
    if (drag.mode === "area" && drag.start && drag.lines) {
      const size = {
        width: drag.start.right - drag.start.left,
        height: drag.start.bottom - drag.start.top,
      };
      drag.value.x += this._wallPull(
        [drag.value.x - size.width / 2, drag.value.x + size.width / 2],
        "x", event, drag.lines,
      );
      drag.value.y += this._wallPull(
        [drag.value.y - size.height / 2, drag.value.y + size.height / 2],
        "y", event, drag.lines,
      );
      this._showFlush({
        left: drag.value.x - size.width / 2,
        right: drag.value.x + size.width / 2,
        top: drag.value.y - size.height / 2,
        bottom: drag.value.y + size.height / 2,
      });
    }
    drag.element.style.left = `${inFrame(drag.value.x, frame)}%`;
    drag.element.style.top = `${inFrameY(drag.value.y, frame)}%`;
  }

  /** How far to shift a room so one of its walls lands on a neighbour's.
   *
   *  Both walls on the axis are offered and the nearer one wins, so a
   *  room can be pushed against the one on its left or the one on its
   *  right without being told which.
   */
  _wallPull(walls, axis, event, lines) {
    if (event.shiftKey) return 0;
    let shift = 0;
    let reach = SNAP_REACH;
    for (const wall of walls) {
      for (const line of lines[axis]) {
        const distance = Math.abs(line - wall);
        if (distance < reach) {
          reach = distance;
          shift = line - wall;
        }
      }
    }
    return shift;
  }

  /** Draw whatever arrived while a hand was on the plan. */
  _flushRender() {
    if (this._renderWanted) this._render();
  }

  _onPointerUp() {
    const drag = this._drag;
    this._drag = null;
    // Die Hervorhebung gehoert zum Ziehen, nicht zum Ergebnis: was
    // stehenbleibt, waere eine Etage, die dauerhaft leuchtet.
    this._showFlush({ left: NaN, right: NaN, top: NaN, bottom: NaN });
    if (drag && drag.element && drag.element.classList &&
        drag.element.classList.remove) {
      drag.element.classList.remove("snapped");
    }
    // A room that was pressed and not moved was asked a question: what is
    // this attached to. Pressing it again puts the marks away, so the
    // same gesture is both halves of it.
    if (drag && drag.mode === "area" && !this._dragged) {
      this._joinArea = this._joinArea === drag.key ? null : drag.key;
      this._storeDrag(drag);
      this._render();
      return;
    }
    this._storeDrag(drag);
    // A device dragged across a wall did not just move on the picture --
    // it moved house. Checked after the position is stored, so the dot
    // stays where it was put even if Home Assistant refuses the move.
    if (drag && drag.section === "nodes" && this._dragged && drag.value) {
      this._moveIntoArea(this._node(drag.key), drag.value.x, drag.value.y);
    }
    this._flushRender();
  }

  _storeDrag(drag) {
    if (!drag || !drag.value) return;
    const round = (value) => Number(value.toFixed(4));
    if (drag.mode === "plot") {
      this._setLayout(
        "floors",
        drag.key,
        {
          plot: drag.value.plot.map((point) => ({
            x: round(point.x),
            y: round(point.y),
          })),
        },
        drag.before,
      );
      return;
    }
    if (drag.mode === "shape") {
      this._setLayout(
        "settings",
        "view",
        {
          custom_shapes: drag.value.shapes.map((shape) => ({
            id: shape.id,
            floor_id: shape.floor_id,
            name: shape.name,
            color: shape.color || "",
            points: shape.points.map((point) => ({
              x: round(point.x),
              y: round(point.y),
            })),
          })),
        },
        drag.before,
      );
      return;
    }
    if (drag.mode === "corner") {
      this._setLayout(
        "areas",
        drag.key,
        {
          shape: drag.value.shape.map((point) => ({
            x: round(point.x),
            y: round(point.y),
          })),
        },
        drag.before,
      );
      return;
    }
    if (drag.mode === "resize") {
      this._setLayout(
        "areas",
        drag.key,
        {
          position: {
            x: round(drag.value.position.x),
            y: round(drag.value.position.y),
          },
          size: {
            width: round(drag.value.size.width),
            height: round(drag.value.size.height),
          },
        },
        drag.before,
      );
      return;
    }
    this._setLayout(
      drag.section,
      drag.key,
      { position: { x: round(drag.value.x), y: round(drag.value.y) } },
      drag.before,
    );
  }

  // ── Sliders and file pickers ────────────────────────────

  _onInput(event, committed) {
    const input = event.target;
    if (!input || !input.getAttribute) return;
    const attribute = (name) => input.getAttribute(name);

    if (attribute("data-search") !== null) {
      // Re-rendering per keystroke keeps the plan and the box in step; the
      // model is already in memory, so nothing is fetched to do it.
      this._search = input.value;
      this._render();
      const box = this._root.querySelector("[data-search]");
      if (box && box.focus) {
        box.focus();
        if (box.setSelectionRange) {
          box.setSelectionRange(box.value.length, box.value.length);
        }
      }
      return;
    }

    const shapeName = attribute("data-shape-name");
    if (shapeName !== null && committed) {
      this._renameShape(shapeName, { name: input.value.trim() || "Fläche" });
      return;
    }

    const shapeColor = attribute("data-shape-color");
    if (shapeColor !== null && committed) {
      this._renameShape(shapeColor, { color: input.value });
      return;
    }

    const areaFlag = attribute("data-area-flag");
    if (areaFlag !== null && this._areaDialog) {
      const area = (this._model.areas || []).find(
        (candidate) => candidate.id === this._areaDialog,
      );
      this._setLayout(
        "areas",
        this._areaDialog,
        { [areaFlag]: input.checked },
        { [areaFlag]: Boolean(area && area[areaFlag]) },
      );
      return;
    }

    const doorField = attribute("data-door-field");
    if (doorField !== null && this._areaDialog) {
      const area = (this._model.areas || []).find(
        (candidate) => candidate.id === this._areaDialog,
      );
      const index = Number(input.getAttribute("data-door"));
      const value = Number(input.value);
      // Erst beim Loslassen speichern: ein Schieberegler feuert bei jedem
      // Pixel, und jeder davon waere sonst ein Schreibvorgang.
      if (area && committed) {
        this._setDoors(area, (doors) =>
          doors.map((door, at) =>
            at === index ? { ...door, [doorField]: value } : door));
      }
      return;
    }

    const nodeScale = attribute("data-node-scale");
    if (nodeScale !== null) {
      if (committed) this._setLayout("nodes", nodeScale, { scale: Number(input.value) });
      return;
    }
    const nodeRotation = attribute("data-node-rotation");
    if (nodeRotation !== null) {
      if (committed) {
        this._setLayout("nodes", nodeRotation, { rotation: Number(input.value) });
      }
      return;
    }
    for (const [attributeName, key] of [
      ["data-node-shape", "node_shape"],
      ["data-labels", "labels"],
      ["data-edge-style", "edge_style"],
      ["data-room-style", "room_style"],
    ]) {
      if (attribute(attributeName) !== null) {
        this._setTheme({ [key]: input.value });
        return;
      }
    }

    if (attribute("data-theme-size") !== null) {
      const label = this._root.querySelector("[data-size-value]");
      if (label) label.textContent = `${Number(input.value).toFixed(2)}×`;
      if (committed) this._setTheme({ node_size: Number(input.value) });
      return;
    }

    if (attribute("data-house-metres") !== null) {
      const floor = this._floor;
      if (committed && floor) {
        this._setLayout(
          "floors",
          floor.id,
          { metres: Number(input.value) || null },
          { metres: floor.metres ?? null },
        );
      }
      return;
    }

    if (attribute("data-theme-house") !== null) {
      const label = this._root.querySelector("[data-house-value]");
      if (label) label.textContent = `${Number(input.value).toFixed(2)}×`;
      // Live auf die Variable, damit der Regler das Haus sofort bewegt --
      // ein Regler, dessen Wirkung erst beim Loslassen kommt, wird blind
      // hin und her geschoben.
      this._root.style.setProperty("--fp-house", String(Number(input.value)));
      if (committed) this._setTheme({ house_weight: Number(input.value) });
      return;
    }

    if (attribute("data-theme-snap") !== null) {
      const label = this._root.querySelector("[data-snap-value]");
      if (label) label.textContent = `${Number(input.value).toFixed(2)}×`;
      if (committed) this._setTheme({ snap_reach: Number(input.value) });
      return;
    }

    const layerToggle = attribute("data-layer-toggle");
    if (layerToggle !== null && this._layerDialog) {
      this._layerDialog[layerToggle] = input.checked;
      return;
    }

    const layerField = attribute("data-layer-field");
    if (layerField !== null && this._layerDialog) {
      // Kept in the open dialog and written on save, so a half-typed name
      // is not a round trip to the hub per keystroke.
      this._layerDialog[layerField] =
        layerField === "entities" || layerField === "exclude"
          ? input.value.split(",").map((part) => part.trim()).filter(Boolean)
          : input.value;
      return;
    }

    const stateColour = attribute("data-state-color");
    if (stateColour !== null) {
      if (committed) {
        this._setTheme({
          state_colors: { ...this._theme.state_colors, [stateColour]: input.value },
        });
      }
      return;
    }

    const qualityColour = attribute("data-quality-color");
    if (qualityColour !== null) {
      if (committed) {
        this._setTheme({
          quality_colors: {
            ...this._theme.quality_colors,
            [qualityColour]: input.value,
          },
        });
      }
      return;
    }

    const layerOpacity = attribute("data-layer-opacity");
    if (layerOpacity !== null) {
      if (committed) {
        this._setLayout("layers", layerOpacity, { opacity: Number(input.value) });
      }
      return;
    }
    if (attribute("data-aspect") !== null) {
      const label = this._root.querySelector("[data-aspect-value]");
      if (label) label.textContent = Number(input.value).toFixed(2);
      if (committed && this._floor) {
        this._setLayout("floors", this._floor.id, { aspect: Number(input.value) });
      }
      return;
    }
    if (attribute("data-background") !== null && input.files && input.files[0]) {
      this._readBackground(input.files[0]);
    }
    if (attribute("data-area-background") !== null && input.files && input.files[0]) {
      this._readAreaBackground(input.files[0]);
    }
  }

  _readBackground(file) {
    // 4 MB is the hub's own limit; refusing here means a clear message
    // instead of a websocket error after a long upload.
    if (file.size > 3 * 1024 * 1024) {
      this._error = "Bild zu groß (max. 3 MB). Bitte vorher verkleinern.";
      this._render();
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      if (!this._floor) return;
      this._setLayout("floors", this._floor.id, { background: reader.result });
      this._floorDialog = false;
    };
    reader.readAsDataURL(file);
  }

  _readAreaBackground(file) {
    if (file.size > 3 * 1024 * 1024) {
      this._error = "Bild zu groß (max. 3 MB). Bitte vorher verkleinern.";
      this._render();
      return;
    }
    const areaId = this._areaDialog;
    const reader = new FileReader();
    reader.onload = () => {
      if (!areaId) return;
      this._setLayout("areas", areaId, { background: reader.result });
    };
    reader.readAsDataURL(file);
  }

  /** Pin what is on screen, then apply the change.
   *
   *  Picking a *preset* is different: it sends the preset alone, so the
   *  preset's own answers take over instead of being overruled by values
   *  the user never actually chose.
   */
  _setTheme(patch) {
    const theme = this._theme;
    this._setLayout("settings", "view", {
      theme: {
        preset: theme.preset || "auto",
        accent: theme.accent || "",
        node_shape: theme.node_shape,
        node_size: theme.node_size,
        labels: theme.labels,
        edge_style: theme.edge_style,
        room_style: theme.room_style,
        house_weight: theme.house_weight,
        snap_reach: theme.snap_reach,
        state_colors: { ...theme.state_colors },
        quality_colors: { ...theme.quality_colors },
        ...patch,
      },
    });
  }

  async _resetFloor() {
    const floor = this._floor;
    if (!floor) return;
    if (!window.confirm(`Anordnung von „${floor.name}“ zurücksetzen?`)) return;

    const areas = this._visibleAreas.map((area) => ["areas", area.id]);
    const nodes = this._visibleNodes.map((node) => ["nodes", node.id]);
    for (const [section, key] of [...areas, ...nodes, ["floors", floor.id]]) {
      try {
        await this._io.call({
          type: `${DOMAIN}/layout/reset`,
          section,
          key,
        });
      } catch (err) {
        console.warn("Spatial Hub: reset failed", section, key, err);
      }
    }
    await this._refresh();
  }

  _onClick(event) {
    // A drag ends in a click; that must not also open a popup.
    if (this._dragged) {
      this._dragged = false;
      return;
    }

    const path = event.composedPath();
    const hit = (attribute) =>
      path.find(
        (element) =>
          element.getAttribute && element.getAttribute(attribute) !== null,
      );

    // Das Menue liegt ueber allem, also wird es vor allem gefragt -- und
    // jeder Klick daneben macht es zu, ohne sonst etwas auszuloesen. Wer
    // ein offenes Menue wegklickt, meint das Wegklicken und nicht den
    // Raum darunter.
    if (this._menu) {
      const item = hit("data-menu");
      if (item) {
        this._runMenu(item.getAttribute("data-menu"));
      } else {
        this._menu = null;
        this._render();
      }
      return;
    }

    const stage = path.find(
      (element) => element.classList && element.classList.contains("stage"),
    );

    // Ab hier entscheidet die Reihenfolge, und nur sie: der erste
    // Abschnitt, der sich zustaendig fuehlt, meldet das mit `true` und
    // die Kette endet. Genau so lief es vorher als eine einzige Folge
    // von `return`s -- nur dass man die Abschnitte jetzt benennen und
    // einzeln lesen kann.
    const abschnitte = [
      this._clickView,
      this._clickCorners,
      this._clickBars,
      this._clickAreaDialog,
      this._clickOutward,
      this._clickLayers,
      this._clickThemeAndFloor,
      this._clickArrange,
      this._clickSelection,
    ];
    for (const abschnitt of abschnitte) {
      if (abschnitt.call(this, hit, event, stage)) return;
    }
  }

  /** Ansicht und Werkzeugwahl: Zoom, Anfasser, Grundriss, Masse.
   *
   *  Gibt `true` zurueck, wenn der Klick hier verbraucht wurde.
   */
  _clickView(hit, event, stage) {
    const zoom = hit("data-zoom");
    if (zoom) {
      const how = zoom.getAttribute("data-zoom");
      if (how === "fit") this._fitToScreen();
      else this._zoomBy(how === "in" ? ZOOM.step : 1 / ZOOM.step);
      return true;
    }

    if (hit("data-toggle-corners")) {
      this._corners = !this._corners;
      this._render();
      return true;
    }

    if (hit("data-toggle-plot")) {
      this._togglePlot();
      return true;
    }

    const editWhat = hit("data-edit-what");
    if (editWhat) {
      this._editWhat = editWhat.getAttribute("data-edit-what");
      // Ecken sind Räume-Werkzeug. Wer zu den Geräten wechselt, will
      // keine Anfasser mehr sehen, auch nicht die von vorhin.
      if (this._editWhat !== "rooms") this._corners = false;
      this._selected = null;
      this._render();
      return true;
    }

    const plotScale = hit("data-plot-scale");
    if (plotScale) {
      this._scalePlot(Number(plotScale.getAttribute("data-plot-scale")));
      return true;
    }

    if (hit("data-toggle-meters")) {
      this._meters = !this._meters;
      this._render();
      return true;
    }
    return false;
  }

  /** Ecken -- die des Grundstuecks und die freier Raumformen.
   *
   *  Setzen, verschieben, einfuegen, loeschen. Der Alt-Klick auf eine
   *  bestehende Ecke ist das Loeschen ohne eigenen Knopf.
   *
   *  Gibt `true` zurueck, wenn der Klick hier verbraucht wurde.
   */
  _clickCorners(hit, event, stage) {
    const plotDrop = hit("data-plot-drop");
    if (plotDrop) {
      this._dropPlotCorner(Number(plotDrop.getAttribute("data-plot-drop")));
      return true;
    }

    const plotCorner = hit("data-plot-index");
    if (plotCorner && (event.altKey || event.metaKey)) {
      this._dropPlotCorner(Number(plotCorner.getAttribute("data-plot-index")));
      return true;
    }

    const plotAdder = hit("data-plot-add");
    if (plotAdder) {
      this._addPlotCorner(Number(plotAdder.getAttribute("data-plot-add")));
      return true;
    }

    const shapeDrop = hit("data-shape-drop");
    if (shapeDrop) {
      this._dropShapeCorner(
        shapeDrop.getAttribute("data-shape-owner"),
        Number(shapeDrop.getAttribute("data-shape-drop")),
      );
      return true;
    }

    const shapeCorner = hit("data-shape-index");
    if (shapeCorner && (event.altKey || event.metaKey)) {
      this._dropShapeCorner(
        shapeCorner.getAttribute("data-shape-owner"),
        Number(shapeCorner.getAttribute("data-shape-index")),
      );
      return true;
    }

    const shapeAdder = hit("data-shape-add");
    if (shapeAdder) {
      this._addShapeCorner(
        shapeAdder.getAttribute("data-shape-owner"),
        Number(shapeAdder.getAttribute("data-shape-add")),
      );
      return true;
    }

    const shapeDialog = hit("data-shape-dialog");
    if (shapeDialog) {
      this._shapeDialog = shapeDialog.getAttribute("data-shape-dialog");
      this._render();
      return true;
    }

    if (hit("data-close-shape")) {
      this._shapeDialog = null;
      this._render();
      return true;
    }

    const shapeReshape = hit("data-shape-reshape");
    if (shapeReshape) {
      const id = shapeReshape.getAttribute("data-shape-reshape");
      this._shapeEdit = this._shapeEdit === id ? null : id;
      this._corners = true;
      this._shapeDialog = null;
      this._render();
      return true;
    }

    const shapeDelete = hit("data-shape-delete");
    if (shapeDelete) {
      const id = shapeDelete.getAttribute("data-shape-delete");
      const shape = this._shape(id);
      if (
        !shape ||
        window.confirm(`„${shape.name}“ wirklich löschen?`)
      ) {
        this._deleteShape(id);
      }
      this._render();
      return true;
    }

    const cornerDrop = hit("data-corner-drop");
    if (cornerDrop) {
      this._dropCorner(
        cornerDrop.getAttribute("data-corner-drop"),
        Number(cornerDrop.getAttribute("data-corner-index")),
      );
      return true;
    }

    const corner = hit("data-corner-area");
    if (corner && (event.altKey || event.metaKey)) {
      this._dropCorner(
        corner.getAttribute("data-corner-area"),
        Number(corner.getAttribute("data-corner-index")),
      );
      return true;
    }

    const adder = hit("data-corner-add");
    if (adder) {
      this._addCorner(
        adder.getAttribute("data-corner-add"),
        Number(adder.getAttribute("data-corner-index")),
      );
      return true;
    }
    return false;
  }

  /** Leisten, Legende und die Schritte zurueck.
   *
   *  Gibt `true` zurueck, wenn der Klick hier verbraucht wurde.
   */
  _clickBars(hit, event, stage) {
    if (hit("data-toggle-ghosts")) {
      this._ghosts = !this._ghosts;
      this._render();
      return true;
    }

    if (hit("data-legend")) {
      this._legendOpen = !this._legendOpen;
      this._render();
      return true;
    }

    if (hit("data-bars")) {
      this._toggleBars();
      return true;
    }

    if (hit("data-undo")) {
      this._undoStep();
      return true;
    }
    if (hit("data-redo")) {
      this._redoStep();
      return true;
    }
    return false;
  }

  /** Der Bereichsdialog: Art des Raums und seine Tueren.
   *
   *  Gibt `true` zurueck, wenn der Klick hier verbraucht wurde.
   */
  _clickAreaDialog(hit, event, stage) {
    const areaDialog = hit("data-area-dialog");
    if (areaDialog) {
      this._areaDialog = areaDialog.getAttribute("data-area-dialog");
      this._render();
      return true;
    }

    if (hit("data-close-area")) {
      this._areaDialog = null;
      this._render();
      return true;
    }

    const areaKind = hit("data-area-kind");
    if (areaKind && this._areaDialog) {
      this._setAreaKind(
        (this._model.areas || []).find(
          (candidate) => candidate.id === this._areaDialog,
        ),
        areaKind.getAttribute("data-area-kind"),
      );
      return true;
    }

    const doorAdd = hit("data-door-add");
    if (doorAdd && this._areaDialog) {
      const area = (this._model.areas || []).find(
        (candidate) => candidate.id === this._areaDialog,
      );
      const side = Number(doorAdd.getAttribute("data-door-add"));
      // In der Mitte und knapp ein Fuenftel breit: eine Tuer, die man
      // sieht, und die man von dort aus dahin schiebt, wo sie hingehoert.
      if (area) {
        this._setDoors(area, (doors) => [...doors, { side, at: 0.5, width: 0.2 }]);
      }
      return true;
    }

    const doorRemove = hit("data-door-remove");
    if (doorRemove && this._areaDialog) {
      const area = (this._model.areas || []).find(
        (candidate) => candidate.id === this._areaDialog,
      );
      const index = Number(doorRemove.getAttribute("data-door-remove"));
      if (area) {
        this._setDoors(area, (doors) =>
          doors.filter((_door, at) => at !== index));
      }
      return true;
    }
    return false;
  }

  /** Die zwei Wege aus dem Grundriss heraus.
   *
   *  Beide gehen ueber den Transport, weil sie das Einzige sind, was
   *  dieser Renderer von der umgebenden Anwendung verlangt.
   *
   *  Gibt `true` zurueck, wenn der Klick hier verbraucht wurde.
   */
  _clickOutward(hit, event, stage) {
    const navigate = hit("data-navigate");
    if (navigate) {
      this._io.navigate(navigate.getAttribute("data-navigate"));
      return true;
    }

    const settings = hit("data-settings");
    if (settings) {
      this._io.moreInfo(settings.getAttribute("data-settings"), "settings");
      return true;
    }
    return false;
  }

  /** Ebenen, Anbieter und die Etagenwahl -- was gezeigt wird.
   *
   *  Gibt `true` zurueck, wenn der Klick hier verbraucht wurde.
   */
  _clickLayers(hit, event, stage) {
    if (hit("data-toggle-entities")) {
      this._showEntities = !this._showEntities;
      this._render();
      return true;
    }

    const toggleProvider = hit("data-toggle-provider");
    if (toggleProvider) {
      const providerId = toggleProvider.getAttribute("data-toggle-provider");
      const off = this._hiddenProviders.has(providerId);
      for (const layer of this._model.layers || []) {
        if (layer.provider_id === providerId) {
          this._setLayout("layers", layer.id, { visible: off });
        }
      }
      return true;
    }

    const floorButton = hit("data-floor");
    if (floorButton) {
      this._floorId = floorButton.getAttribute("data-floor");
      this._selected = null;
      this._render();
      return true;
    }

    if (hit("data-toggle-edit")) {
      this._edit = !this._edit;
      this._placing = null;
      this._selected = null;
      this._floorDialog = false;
      this._render();
      return true;
    }

    const newLayer = hit("data-new-layer");
    const editLayer = hit("data-edit-layer");
    if (newLayer || editLayer) {
      this._openLayerDialog(
        editLayer ? editLayer.getAttribute("data-edit-layer") : null,
      );
      return true;
    }

    if (hit("data-close-layer")) {
      this._layerDialog = null;
      this._render();
      return true;
    }

    const facet = hit("data-facet");
    if (facet && this._layerDialog) {
      const field = facet.getAttribute("data-facet");
      const value = facet.getAttribute("data-value");
      const current = this._layerDialog[field] || [];
      this._layerDialog[field] = current.includes(value)
        ? current.filter((item) => item !== value)
        : [...current, value];
      this._render();
      return true;
    }

    if (hit("data-save-layer")) {
      this._saveLayer();
      return true;
    }

    if (hit("data-delete-layer")) {
      this._deleteLayer();
      return true;
    }
    return false;
  }

  /** Die Dialoge fuer Thema und Etage, samt Hintergrundbildern.
   *
   *  Gibt `true` zurueck, wenn der Klick hier verbraucht wurde.
   */
  _clickThemeAndFloor(hit, event, stage) {
    if (hit("data-theme-dialog")) {
      this._themeDialog = true;
      this._render();
      return true;
    }

    if (hit("data-close-theme")) {
      this._themeDialog = false;
      this._render();
      return true;
    }

    const preset = hit("data-preset");
    if (preset) {
      // Only the preset: anything else would overrule what it decided.
      this._setLayout("settings", "view", {
        theme: { preset: preset.getAttribute("data-preset") },
      });
      return true;
    }

    if (hit("data-reset-theme")) {
      this._themeDialog = false;
      this._io
        .call({ type: `${DOMAIN}/layout/reset`, section: "settings", key: "view" })
        .then(() => this._refresh())
        .catch(() => this._refresh());
      return true;
    }

    if (hit("data-floor-dialog")) {
      this._floorDialog = true;
      this._render();
      return true;
    }

    if (hit("data-close-floor")) {
      this._floorDialog = false;
      this._render();
      return true;
    }

    if (hit("data-clear-background")) {
      if (this._floor) this._setLayout("floors", this._floor.id, { background: null });
      this._floorDialog = false;
      return true;
    }

    if (hit("data-clear-area-background")) {
      if (this._areaDialog) {
        this._setLayout("areas", this._areaDialog, { background: null });
      }
      return true;
    }

    if (hit("data-reset-floor")) {
      this._resetFloor();
      return true;
    }

    const layerUp = hit("data-layer-up");
    const layerDown = hit("data-layer-down");
    if (layerUp || layerDown) {
      const id = (layerUp || layerDown).getAttribute(
        layerUp ? "data-layer-up" : "data-layer-down",
      );
      const layer = (this._model.layers || []).find((l) => l.id === id);
      if (layer) {
        this._setLayout("layers", id, {
          z_index: (layer.z_index || 10) + (layerUp ? 5 : -5),
        });
      }
      return true;
    }
    return false;
  }

  /** Anordnen: verstecken, zeigen, sortieren, zuruecksetzen, platzieren.
   *
   *  Gibt `true` zurueck, wenn der Klick hier verbraucht wurde.
   */
  _clickArrange(hit, event, stage) {
    if (hit("data-undo-move")) {
      this._undoMove();
      return true;
    }

    const joinMark = hit("data-join-area");
    if (joinMark) {
      this._toggleJoin(
        joinMark.getAttribute("data-join-area"),
        joinMark.getAttribute("data-join-other"),
      );
      return true;
    }

    const hideArea = hit("data-hide-area");
    if (hideArea) {
      this._setLayout("areas", hideArea.getAttribute("data-hide-area"), {
        hidden: true,
      });
      return true;
    }

    const showArea = hit("data-show-area");
    if (showArea) {
      this._setLayout("areas", showArea.getAttribute("data-show-area"), {
        hidden: null,
      });
      return true;
    }

    const hideNode = hit("data-hide-node");
    if (hideNode) {
      this._selected = null;
      this._setLayout("nodes", hideNode.getAttribute("data-hide-node"), {
        hidden: true,
      });
      return true;
    }

    const showNode = hit("data-show-node");
    if (showNode) {
      this._setLayout("nodes", showNode.getAttribute("data-show-node"), {
        hidden: null,
      });
      return true;
    }

    const resetItem = hit("data-reset-item");
    if (resetItem) {
      this._selected = null;
      this._resetItem("nodes", resetItem.getAttribute("data-reset-item"));
      return true;
    }

    const toggle = hit("data-toggle");
    if (toggle) {
      this._showDiagnostics = !this._showDiagnostics;
      if (this._showDiagnostics) {
        this._loadDiagnostics().then(() => this._render());
      } else {
        this._render();
      }
      return true;
    }

    const layerButton = hit("data-layer");
    if (layerButton) {
      const layerId = layerButton.getAttribute("data-layer");
      const layer = (this._model.layers || []).find(
        (candidate) => candidate.id === layerId,
      );
      if (layer) {
        this._setLayout("layers", layerId, {
          visible: layer.visible === false,
        });
      }
      return true;
    }

    const placeArea = hit("data-place-area");
    if (placeArea) {
      const key = placeArea.getAttribute("data-place-area");
      this._placing =
        this._placing && this._placing.key === key
          ? null
          : { section: "areas", key };
      this._render();
      return true;
    }

    if (hit("data-cancel-place")) {
      this._placing = null;
      this._render();
      return true;
    }
    return false;
  }

  /** Was ein Klick auf den Grundriss selbst auswaehlt.
   *
   *  Zuletzt, und das ist Absicht: jeder Knopf oben drueber hat
   *  Vorrang, sonst waehlte ein Klick auf eine Schaltflaeche den
   *  Raum aus, der zufaellig darunter liegt.
   *
   *  Gibt `true` zurueck, wenn der Klick hier verbraucht wurde.
   */
  _clickSelection(hit, event, stage) {
    // Placement wins over selection: the user asked to put something down.
    if (this._placing && stage) {
      const box = stage.getBoundingClientRect();
      const frame = this._frame;
      const place = (offset, size, along) =>
        Math.min(
          along.min + along.span,
          Math.max(along.min, along.min + (offset / size) * along.span),
        );
      const x = place(event.clientX - box.left, box.width, frame);
      const y = place(event.clientY - box.top, box.height, yFrame(frame));
      const { section, key } = this._placing;
      this._placing = null;
      this._setLayout(section, key, {
        position: { x: Number(x.toFixed(4)), y: Number(y.toFixed(4)) },
      });
      return true;
    }

    if (hit("data-close")) {
      this._selected = null;
      this._history = null;
      this._render();
      return true;
    }

    const moreInfo = hit("data-more-info");
    if (moreInfo) {
      this._io.moreInfo(moreInfo.getAttribute("data-more-info"));
      return true;
    }

    if (hit("data-history")) {
      this._loadHistory();
      return true;
    }

    const actionButton = hit("data-action");
    if (actionButton) {
      this._runAction(
        actionButton.getAttribute("data-action"),
        actionButton.getAttribute("data-confirm") === "1",
      );
      return true;
    }

    const clusterButton = hit("data-cluster");
    if (clusterButton) {
      const areaId = clusterButton.getAttribute("data-cluster");
      this._clusterOpen = this._clusterOpen === areaId ? null : areaId;
      this._render();
      return true;
    }

    if (hit("data-close-cluster")) {
      this._clusterOpen = null;
      this._render();
      return true;
    }

    const clusterNode = hit("data-cluster-node");
    if (clusterNode) {
      this._clusterOpen = null;
      this._select("node", clusterNode.getAttribute("data-cluster-node"));
      return true;
    }

    const nodeButton = hit("data-node");
    if (nodeButton) {
      this._select("node", nodeButton.getAttribute("data-node"));
      return true;
    }

    const edgeLine = hit("data-edge");
    if (edgeLine) {
      this._select("edge", edgeLine.getAttribute("data-edge"));
      return true;
    }
    return false;
  }

  _select(kind, id) {
    this._selected = { kind, id };
    this._history = null;
    this._showEntities = false;
    this._render();
  }

  async _loadHistory() {
    if (!this._selected) return;
    try {
      const response = await this._io.call({
        type: `${DOMAIN}/history`,
        kind: this._selected.kind,
        item_id: this._selected.id,
        hours: 24,
      });
      this._history = response.series || [];
    } catch (err) {
      this._history = [];
      console.warn("Spatial Hub: history failed", err);
    }
    this._render();
  }

  async _runAction(actionId, confirm) {
    if (!this._selected) return;
    if (confirm && !window.confirm(`„${actionId}“ wirklich ausführen?`)) return;
    try {
      await this._io.call({
        type: `${DOMAIN}/action`,
        kind: this._selected.kind,
        item_id: this._selected.id,
        action: actionId,
        data: {},
      });
    } catch (err) {
      this._error = err && err.message ? err.message : String(err);
    }
    await this._refresh();
  }
}


customElements.define("spatial-hub-panel", SpatialHubPanel);

// Exported so the test suite can drive the rendering logic without a
// browser. Home Assistant loads this file as a module and only ever uses
// the custom element above.
export { SpatialHubPanel, HA_COLOURS, AREA_KIND, kindOf, joinsOf, drawsTheWall };
