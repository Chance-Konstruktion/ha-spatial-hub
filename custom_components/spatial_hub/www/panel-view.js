/**
 * Spatial Hub -- die Auszeichnung: alles, was HTML erzeugt.
 *
 * Sechsunddreissig Methoden, die aus dem Modell Zeichenketten machen
 * und sonst nichts. Sie lesen den Zustand des Panels und geben Text
 * zurueck; keine einzige aendert etwas, keine ruft den Hub.
 *
 * Angehaengt werden sie unten in spatial-hub-panel.js an den Prototyp.
 * Das ist Absicht und kein Zwischenschritt: die Rumpfe sind Zeichen fuer
 * Zeichen dieselben wie vorher, ``this`` bedeutet weiterhin das Panel,
 * und es gibt keine Stelle, an der sich beim Verschieben ein Fehler
 * einschleichen konnte.
 *
 * Der naechste Schritt waere, sie zu Funktionen zu machen, die ihre
 * Daten als Parameter bekommen statt ueber ``this``. Das ist ein
 * Umschreiben, kein Verschieben, und gehoert nicht in denselben Commit.
 */
import {
  AREA_KIND,
  BACK_WALL,
  FRONT_WALL,
  SIDE_NAME,
  STACK,
  capsOf,
  centreOf,
  drawsTheWall,
  hasShape,
  houseMetres,
  houseWeight,
  inFrame,
  inFrameY,
  joinsOf,
  kindOf,
  doorsOf,
  OPENING,
  openingKind,
  openingRun,
  declutter,
  LABEL,
  DIM,
  dimension,
  dimensionStops,
  metre,
  minY,
  shapeOf,
  snapReach,
  spanY,
  wallsOf,
} from "./panel-geometry.js";
import {
  cornerHandlesHtml,
  doorsHtml,
  escapeHtml,
  sparklineHtml,
  cornersOf,
  labelPointOf,
} from "./panel-markup.js";
import { ALL_FLOORS, formatValue, pretty } from "./panel-const.js";

// Wie gross die zwei Beschriftungen im Stapel sind und wie weit der
// Geraetename unter seinem Punkt haengt. Steht hier und nicht nur im
// Stylesheet, weil das Entzerren die Groesse braucht, bevor irgendetwas
// im Dokument haengt -- und zwei Zahlen, die dasselbe meinen und
// auseinanderlaufen koennen, sind schlimmer als eine an der falschen
// Stelle. Wer die Schriftgroesse aendert, aendert sie hier und in
// `panel-styles.js`; der Test darunter haelt beide zusammen.
const ROOM_LABEL_SIZE = 16;
const STACK_LABEL_SIZE = 18;
const STACK_LABEL_DROP = 30;
const STOREY_LABEL_SIZE = 30;
const STOREY_LABEL_ALONE = 16;


export const ANSICHT = {
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
                      `
               }
               ${
                 // Der Massstab gilt in beiden Ansichten, also gehoert
                 // der Schalter in beide. Er stand im Block darueber und
                 // war damit in der Hausansicht nicht erreichbar -- und
                 // genau dort sind die Massketten etwas wert, weil man
                 // dort das ganze Haus sieht.
                 this._editRooms
                   ? `<button class="icon-btn ${this._meters ? "on" : ""}"
                              data-toggle-meters="1"
                              title="${
                                this._meters
                                  ? "Maße ausblenden"
                                  : "Maße in Metern (Expertenmodus)"
                              }">
                        <ha-icon icon="mdi:tape-measure"></ha-icon>
                      </button>`
                   : ""
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
  },

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

    // Alles, was fest im Bild steht und deshalb beim Entzerren der
    // Geraetenamen im Weg sein kann: Etagennamen und Massketten. Beide
    // entstehen hier beim Zeichnen der Etagen, also werden sie hier
    // eingesammelt -- die Namen der Geraete kommen erst danach und
    // koennen dann allen ausweichen.
    const scale = this._counterScale;
    const fixed = this._stackRoomLabels(floors, scale);

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
      // Und dasselbe eine Etage tiefer, nur als Erde statt als Rasen:
      // die unterste Etage liegt im Boden, und was um sie herum liegt,
      // ist Erdreich. Dort steckt der Hausanschluss, und dort stehen
      // seit dem Umzug die virtuellen Bereiche.
      //
      // Zwei Faelle, nicht einer mit einer Klasse dran: eine Etage kann
      // beides sein -- ein Haus ohne Keller hat Garten *und* Erdreich um
      // dasselbe Erdgeschoss. Dann liegt die Erde unter dem Rasen.
      const ground = (className) =>
        `<polygon class="${className}" points="${outline(
          at, frame.min, frame.min + frame.span,
          minY(frame), minY(frame) + spanY(frame),
        )}"/>`;
      const apron = `${floor.has_soil ? ground("soil-plane") : ""}${
        floor.has_outdoor && floor.ground ? ground("apron") : ""
      }`;
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
      const dims = this._dimensionsOf(at, floor);
      fixed.push(...dims.labels);
      // Der Etagenname ist rechtsbuendig gesetzt; sein Kasten liegt also
      // links von seinem Punkt und nicht um ihn herum.
      fixed.push({
        x: label.x, y: label.y,
        text: String(floor.name || "").toLocaleUpperCase("de"),
        size: this._oneStorey ? STOREY_LABEL_ALONE : STOREY_LABEL_SIZE,
        scale, anchor: this._oneStorey ? "start" : "end", fixed: true,
      });

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
        ${dims.html}
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
    // Namen entzerren, bevor irgendeiner gezeichnet wird.
    //
    // Vorher galt eine Pauschale: mehr als fuenf Geraete auf einer Ebene,
    // und *alle* ihre Namen verschwanden bis zum Darueberfahren. Das traf
    // auch die, die sich nie in die Quere kamen, und liess bei fuenf
    // Geraeten zwei uebereinander stehen -- gezaehlt wurde ja, nicht
    // nachgesehen. Jetzt wird nachgesehen.
    //
    // Raumnamen sind fest: ein Raumname gehoert in seinen Raum, und ihn
    // zu verschieben hiesse, ihn ueber die Wand des Nachbarn zu schieben.
    // Beweglich sind die Geraetenamen -- die haengen ohnehin schon unter
    // ihrem Punkt und nicht darin.
    const nodeLabels = this._visibleNodes.map((node) => {
      const at = spots.get(node.id);
      return {
        x: at.x, y: at.y + STACK_LABEL_DROP * scale,
        text: node.label, size: STACK_LABEL_SIZE, scale,
      };
    });
    const placed = declutter([...fixed, ...nodeLabels]).slice(fixed.length);

    const nodes = this._visibleNodes
      .map((node, order) => {
        const at = spots.get(node.id);
        const selected =
          this._selected && this._selected.kind === "node" &&
          this._selected.id === node.id;
        const spot = placed[order] || { shift: 0, hidden: false };
        const dimmed = matches && !matches.has(node.id);
        return `<g class="stack-node ${selected ? "on" : ""}
                   ${spot.hidden ? "crowded" : ""} ${dimmed ? "dimmed" : ""}
                   ${matches && !dimmed ? "found" : ""}
                   ${node.floor_id ? "" : "floorless"}"
                   data-node="${escapeHtml(node.id)}"
                   style="--layer-opacity:${this._providerOpacity(node.id)}"
                   data-at-x="${at.x}" data-at-y="${at.y}"
                   transform="translate(${at.x},${at.y}) scale(${scale})">
          <circle r="14" fill="${this._nodeColour(node)}"/>
          ${this._stackIconHtml(node)}
          <text class="stack-label" y="${
            // Zurueck in die Einheiten des Elements: der Kasten wurde im
            // Bild gerechnet, das <text> haengt aber in einem <g>, das
            // schon mit counterScale skaliert ist.
            (STACK_LABEL_DROP + spot.shift / (scale || 1)).toFixed(1)
          }">${escapeHtml(node.label)}</text>
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
  },

  /** Die Masskette unter einer Etage.
   *
   *  Geteilt an jeder Wand, die vorne ankommt -- das ist genau das, was
   *  eine Bauzeichnung unter den Riss setzt, und der Grund, warum man
   *  einen Grundriss mit zum Baumarkt nehmen kann und einen Netzplan
   *  nicht.
   *
   *  Zwei Reihen: die Teilmasse und darunter das Gesamtmass. Die zweite
   *  Reihe entfaellt bei nur einem Abschnitt -- dann stuende dieselbe
   *  Zahl zweimal untereinander.
   *
   *  Der Massstab ist der **dieser** Etage (`floor.metres`). Ein Keller,
   *  den jemand schmaler eingetragen hat als das Erdgeschoss, ist
   *  schmaler, und eine Kette, die das verschweigt, ist eine falsche
   *  Angabe und nicht nur eine ungenaue.
   */
  _dimensionsOf(at, floor) {
    const nichts = { html: "", labels: [] };
    if (!this._meters) return nichts;
    const rooms = (this._model.areas || []).filter(
      (area) =>
        area.floor_id === floor.id && area.position &&
        this._inSandwich(area) && kindOf(area) === AREA_KIND.INDOOR,
    );
    const stops = dimensionStops(rooms);
    if (stops.length < 2) return nichts;
    const across = houseMetres(floor);
    const scale = this._counterScale;

    // Die Vorderkante liegt im Bild waagerecht: die Flucht verschiebt
    // nur x, und bei y = 1 haben alle Punkte dieselbe Hoehe. Deshalb
    // ist die Kette eine Gerade und keine Rechnung.
    const front = (x) => this._project(at, x, 1);
    const base = front(0).y;

    // Jede gesetzte Zahl wird mitgeschrieben. Das Entzerren der
    // Geraetenamen muss von ihr wissen -- sonst steht "Adapter
    // Wohnzimmer" auf "3,60 m", und beide sind weg.
    const labels = [];
    const text = (x, y, label) => {
      labels.push({ x, y, text: label, size: DIM.size, scale, fixed: true });
      return `<g data-at-x="${x.toFixed(1)}" data-at-y="${y.toFixed(1)}"
         transform="translate(${x.toFixed(1)},${y.toFixed(1)}) scale(${scale})"
       ><text class="dim-text">${escapeHtml(label)}</text></g>`;
    };

    const chain = (row, from, to, label) => {
      const y = base + DIM.drop + row * DIM.row;
      const a = front(from);
      const b = front(to);
      // Der schraege Begrenzungsstrich der Bauzeichnung, nicht ein
      // Pfeil: ein Pfeil an einem Mass von zwoelf Bildpunkten ist
      // groesser als das Mass.
      const slash = (point) =>
        `<line class="dim-tick" x1="${(point.x - DIM.tick / 2).toFixed(1)}"
           y1="${(y + DIM.tick / 2).toFixed(1)}"
           x2="${(point.x + DIM.tick / 2).toFixed(1)}"
           y2="${(y - DIM.tick / 2).toFixed(1)}"/>`;
      // Ein Mass, das breiter ist als sein Abschnitt, steht ueber den
      // Nachbarn und macht aus drei lesbaren Zahlen eine unlesbare.
      // Dann lieber nur die Begrenzungsstriche: dass dort geteilt ist,
      // sagen die auch, und die Reihe darunter sagt weiter die Summe.
      //
      // Das ist der Normalfall und kein Sonderfall: Raeume, die noch
      // nicht Wand an Wand liegen, haben Fugen von wenigen Zentimetern,
      // und die sind echt -- sie werden nicht verschwiegen, nur nicht
      // beschriftet.
      const room = Math.abs(b.x - a.x);
      const fits =
        String(label).length * DIM.size * LABEL.perChar * scale + 6 <= room;
      return `<line class="dim-line" x1="${a.x.toFixed(1)}" y1="${y.toFixed(1)}"
                x2="${b.x.toFixed(1)}" y2="${y.toFixed(1)}"/>
        ${slash(a)}${slash(b)}
        ${fits ? text((a.x + b.x) / 2, y - DIM.lift, label) : ""}`;
    };

    // Hilfslinien von der Wand herunter bis zur untersten Kette, damit
    // sichtbar ist, *was* da gemessen wurde. Eine Kette ohne sie ist
    // eine Zahlenreihe unter einem Bild.
    const reach = DIM.drop + (stops.length > 2 ? DIM.row : 0);
    const helpers = stops
      .map((x) => {
        const point = front(x);
        return `<line class="dim-help" x1="${point.x.toFixed(1)}"
          y1="${point.y.toFixed(1)}" x2="${point.x.toFixed(1)}"
          y2="${(base + reach + DIM.tick).toFixed(1)}"/>`;
      })
      .join("");

    const parts = stops
      .slice(0, -1)
      .map((from, index) =>
        chain(0, from, stops[index + 1],
              dimension((stops[index + 1] - from) * across)))
      .join("");

    const whole = stops.length > 2
      ? chain(1, 0, 1, dimension(across))
      : "";

    return { html: `<g class="dims">${helpers}${parts}${whole}</g>`, labels };
  },

  /** Wo im Stapel welcher Raumname steht.
   *
   *  Dieselbe Rechnung wie beim Zeichnen, aus derselben Quelle
   *  (`cornersOf`/`labelPointOf`): Zwei Rechnungen dafuer waeren zwei
   *  Stellen, an denen ein Name um ein paar Einheiten danebenliegt --
   *  und ein Entzerren, das gegen die falschen Kaesten prueft, ist
   *  schlimmer als keines.
   */
  _stackRoomLabels(floors, scale) {
    const labels = [];
    floors.forEach((floor, at) => {
      for (const area of this._model.areas || []) {
        if (area.floor_id !== floor.id || !area.position) continue;
        if (!this._inSandwich(area)) continue;
        const point = labelPointOf(
          cornersOf((x, y) => this._project(at, x, y), area),
        );
        labels.push({
          x: point.x, y: point.y, text: area.name,
          size: ROOM_LABEL_SIZE, scale, fixed: true,
        });
      }
    });
    return labels;
  },

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
  },

  /** The camera lives here: one wrapper, both views, identical behaviour. */
  _viewportHtml(inner) {
    return `<div class="viewport"><div class="canvas">${inner}</div></div>`;
  },

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
  },

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
  },

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
  },

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
  },

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
  },

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
  },

  /** Die Oeffnungen eines Raumes im Grundriss, auf seinen Kanten.
   *
   *  Das hier war der eigentliche Fehler an den Tueren: sie wurden nur
   *  in der Hausansicht gezeichnet. Angelegt werden sie aber hier, in
   *  der Einzelansicht -- man klickte also "+ hinten", schob zwei Regler
   *  und auf dem Bild passierte nichts. Eine Oeffnung, die man beim
   *  Setzen nicht sieht, kann man auch nicht setzen.
   *
   *  Nicht im SVG, sondern als Kaesten auf dem Kasten: ein Raum ist in
   *  dieser Ansicht ein `div` mit Rahmen, und ein SVG daneben muesste
   *  jede Verschiebung noch einmal nachrechnen.
   *
   *  Nur Rechtecke. Eine freie Kontur hat Kanten, die quer im Kasten
   *  liegen, und die traefe ein Streifen an dessen Rand nicht -- lieber
   *  nichts zeigen als etwas Falsches an der falschen Stelle.
   */
  _openingsHtml(area) {
    if (kindOf(area) !== AREA_KIND.INDOOR || hasShape(area)) return "";
    const id = escapeHtml(area.id);
    return doorsOf(area, 4)
      .map((door, index) => {
        const side = Number(door.side);
        const [from, to] = openingRun(door);
        const span = `${((to - from) * 100).toFixed(2)}%`;
        const start = `${(from * 100).toFixed(2)}%`;
        // Die Kante entscheidet, welche Achse die Laenge ist. Waagerecht
        // fuer hinten und vorne, senkrecht fuer die Flanken.
        const place = [
          `top:-3px;left:${start};width:${span};height:6px;`,
          `right:-3px;top:${start};height:${span};width:6px;`,
          `bottom:-3px;left:${start};width:${span};height:6px;`,
          `left:-3px;top:${start};height:${span};width:6px;`,
        ][side];
        const kind = openingKind(door);
        // Waagerecht oder senkrecht: die Laibungsstriche stehen quer zur
        // Oeffnung, und quer ist auf einer Flanke etwas anderes als auf
        // der Vorder- oder Rueckwand.
        const lie = side === 0 || side === 2 ? "flat" : "upright";
        return `<span class="opening ${kind} ${lie}" style="${place}"
          data-opening="${id}" data-opening-index="${index}"
          title="${kind === OPENING.WINDOW ? "Fenster" : "Tür"} — ziehen zum Verschieben, Alt-Klick entfernt"></span>`;
      })
      .join("");
  },

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
  },

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
  },

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
  },

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
  },

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
  },

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
          ${this._openingsHtml(area)}
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
  },

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
  },

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
  },

  _nodesHtml() {
    const { singles, clusters } = this._nodeGroups;
    return (
      singles.map((node) => this._nodeHtml(node)).join("") +
      clusters.map((group) => this._clusterHtml(group)).join("")
    );
  },

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
  },

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
  },

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
  },

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
  },

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
  },

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
  },

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
      [AREA_KIND.VIRTUAL, "Virtuell (Internet, VPN, Cloud)", "mdi:transmission-tower"],
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
        Garage passen alle darauf, ohne ein Stockwerk zu erfinden.
        Virtuelle Bereiche liegen im Erdreich um die unterste Etage:
        dort, wo der Hausanschluss herkommt.</p>
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
  },

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
  },

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
  },

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
  },

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
  },

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
  },

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
  },

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
  },

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
  },

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
  },

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
  },
};
