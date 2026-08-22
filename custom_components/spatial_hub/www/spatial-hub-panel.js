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
import { ANSICHT } from "./panel-view.js";
import { EINGABEN } from "./panel-input.js";
import { ALL_FLOORS, CLUSTER_THRESHOLD, DOMAIN, FIT, PHONE, ZOOM } from "./panel-const.js";
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
    // Hier stand die Wolkenebene vorneweg. Die gibt es nicht mehr: das
    // Erdreich ist keine eigene Ebene, sondern der Ring um die unterste
    // Etage -- und die steht im Stapel ohnehin schon unten.
    return [...real, ...floors.filter((floor) => floor.unassigned)];
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


// Ansicht und Eingaben an den Prototyp haengen.
//
// Beide Dateien enthalten Methoden dieser Klasse, wortgleich zu vorher --
// nur aufgeschrieben, wo sie hingehoeren. `this` bedeutet dort dasselbe
// wie hier, und die Reihenfolge spielt keine Rolle: die drei Mengen
// ueberschneiden sich nicht.
Object.assign(SpatialHubPanel.prototype, ANSICHT, EINGABEN);

customElements.define("spatial-hub-panel", SpatialHubPanel);

// Exported so the test suite can drive the rendering logic without a
// browser. Home Assistant loads this file as a module and only ever uses
// the custom element above.
export { SpatialHubPanel, HA_COLOURS, AREA_KIND, kindOf, joinsOf, drawsTheWall };
