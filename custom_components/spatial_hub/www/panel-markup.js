/**
 * Zeichnung ohne Zustand: SVG-Bausteine, die nur ihre Argumente lesen.
 *
 * Der Renderer ist ein Custom Element mit viel Zustand -- Kamera, Auswahl,
 * das gerade Gezogene. Das hier ist der Teil, der davon nichts wissen
 * muss: gib ihm einen Raum und eine Projektion, und es gibt dir die
 * Formen zurueck. Genau deshalb steht es hier und nicht in der Klasse.
 *
 * Ein Raum wird in *beiden* Ansichten aus derselben Kontur gebaut. Dass
 * die Wolke einmal eine Wolke und einmal ein Rechteck war, kam daher,
 * dass es zwei Stellen gab, die dasselbe zeichnen wollten. Eine Funktion,
 * die die Projektion als Argument nimmt, kann es nur noch einmal geben.
 *
 * Kein Build, kein Bundle: Der Browser laedt das als ES-Modul direkt.
 */

import {
  STACK,
  centreOf,
  shapeOf,
  CLOUD_PATH,
  wallsOf,
  capsOf,
  swingsOf,
  windowsOf,
  sillsOf,
  stairsOf,
  deckingOf,
  AREA_KIND,
  kindOf,
  doorsOf,
  windowsOfArea,
  openingsOf,
  isStairs,
  sideName,
} from "./panel-geometry.js";

const escapeHtml = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (char) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        char
      ],
  );

/** Der Name eines Raumes, wie er in einer Bauzeichnung steht.
 *
 *  Versalien -- und in JavaScript, nicht in CSS: "text-transform" gilt
 *  fuer SVG-Text erst seit kurzem und nicht ueberall.
 *
 *  Umgebrochen, wenn er lang ist. "Wohnzimmer / Esszimmer" in einer Zeile
 *  ist breiter als das Zimmer, das er benennt -- er lag quer ueber der
 *  Wand und im Nachbarraum. Gebrochen wird am Schraegstrich, sonst in der
 *  Mitte der Wortfolge: beides sind Stellen, an denen ein Mensch auch
 *  umbrechen wuerde, und keine Silbentrennung, die raten muesste.
 */
/** `size` steht hier und nicht im Stylesheet, weil hier gerechnet wird:
 *  ob ein Name in sein Zimmer passt, haengt an seiner Groesse. Zwei
 *  Zahlen, die zueinander stimmen muessen, sind eine Zahl zu viel.
 *  `glyph` ist die mittlere Zeichenbreite in Versalien samt Sperrung --
 *  gemessen an Roboto, und grosszuegig genug, dass ein Name lieber etwas
 *  zu klein als einen Buchstaben zu breit gerechnet wird. */
const LABEL = { wrap: 13, line: 1.15, size: 11, glyph: 0.72, room: 0.86 };

/** Wie stark ein Name schrumpfen muss, damit er in sein Zimmer passt.
 *
 *  Ohne das stand "TREPPE" quer ueber dem WC nebenan: ein Name, der
 *  breiter ist als sein Raum, benennt zwei Raeume und keinen davon. Nach
 *  unten begrenzt, denn unter einem Drittel ist es kein Text mehr,
 *  sondern eine Struktur -- so kleine Zimmer bleiben lieber unbeschriftet
 *  lesbar als beschriftet unleserlich.
 */
const labelFit = (name, width) => {
  if (!(width > 0)) return 1;
  const longest = Math.max(
    ...roomLabelLines(String(name || "")).map((line) => line.length),
    1,
  );
  const needed = longest * LABEL.size * LABEL.glyph;
  return Math.min(1, Math.max(0.34, (width * LABEL.room) / needed));
};

const roomLabelLines = (name) => {
  const text = String(name || "").toLocaleUpperCase("de");
  if (text.length <= LABEL.wrap) return [text];
  const slash = text.indexOf("/");
  const words = text.split(/\s+/).filter(Boolean);
  let lines;
  if (slash > 0) {
    lines = [text.slice(0, slash + 1).trim(), text.slice(slash + 1).trim()];
  } else if (words.length > 1) {
    // Dort trennen, wo die beiden Haelften am gleichmaessigsten werden.
    let best = 1;
    let evenness = Infinity;
    for (let cut = 1; cut < words.length; cut += 1) {
      const left = words.slice(0, cut).join(" ").length;
      const right = words.slice(cut).join(" ").length;
      if (Math.abs(left - right) < evenness) {
        evenness = Math.abs(left - right);
        best = cut;
      }
    }
    lines = [words.slice(0, best).join(" "), words.slice(best).join(" ")];
  } else {
    lines = [text];
  }
  return lines;
};

const roomLabel = (name) => {
  const lines = roomLabelLines(name);
  // Um eine halbe Zeile nach oben gerueckt, damit der Block als Ganzes
  // dort steht, wo vorher die eine Zeile stand.
  return lines
    .map(
      (line, index) =>
        `<text class="room-label" font-size="${LABEL.size}" y="${(
          (index - (lines.length - 1) / 2) * LABEL.line
        ).toFixed(2)}em">${escapeHtml(line)}</text>`,
    )
    .join("");
};

/** Wo der Name steht und wie gross er sein darf.
 *
 *  Die Breite des Raumes wird an seiner projizierten Kontur gemessen, an
 *  der schmalsten Stelle: die Flucht macht die Hinterkante schmaler, und
 *  ein Name, der vorne passt, laege hinten schon in der Wand.
 */
const labelSpot = (corners, area) => {
  const middle = centreOf(corners);
  const back = Math.min(...corners.map((corner) => corner.y));
  const xs = corners.map((corner) => corner.x);
  const width = Math.max(...xs) - Math.min(...xs);
  return {
    x: middle.x,
    y: middle.y - (middle.y - back) * 0.55,
    fit: labelFit(area && area.name, width),
  };
};

/** Ein Raum als Zeichnung: Boden, Waende, Mauerkrone, Stufen, Name.
 *
 *  `project` bildet einen Punkt des Grundrisses auf das Bild ab -- flach
 *  in der Einzelansicht, in der Flucht im Stapel. `floor` ist die Etage,
 *  auf der der Raum steht (fuer die Frage, ob ein Aussenbereich Rasen
 *  oder Balkon ist), `counterScale` haelt die Beschriftung lesbar,
 *  waehrend die Kamera zoomt.
 */
/** Fenster und Tuerbogen einer Raumkontur.
 *
 *  Das Fenster sitzt in der Luecke, die es selbst geschlagen hat: die
 *  Mauer laeuft duenner weiter, in ihrer Mitte die Scheibe. Der Bogen
 *  liegt auf der Mauerkrone, damit ihn nicht das naechste Stueck Wand
 *  verschluckt.
 */
const fittingsOf = ({ corners, crown, doors, windows }, keep = () => true) =>
  // Erst die Bruestung -- sie steht in der Wandebene und muss unter der
  // Mauerkrone liegen, sonst haette das Fenster keinen Unterbau.
  sillsOf(corners, windows, STACK.rise * 0.45, "window-sill", keep) +
  windowsOf(crown, windows, STACK.wall, "window", keep) +
  swingsOf(crown, doors, "door", keep);

const roomPolygon = (
  { project, floor, counterScale, borrowed, withLabel = true,
    withFittings = true },
  area,
  keep = () => true,
) => {
  const width = (area.size && area.size.width) || 0.3;
  const height = (area.size && area.size.height) || 0.3;
  const x0 = area.position.x - width / 2;
  const y0 = area.position.y - height / 2;
  // The same outline the single-floor view clips to, projected. The two
  // views disagreeing about the shape of a room is the bug that made
  // the cloud a rectangle in the house view, and a niche visible on one
  // tab only would be the same bug wearing a different hat.
  const corners = shapeOf(area)
    .map((point) => [x0 + point.x * width, y0 + point.y * height])
    .map(([x, y]) => project(x, y));
  const points = corners.map((point) => `${point.x},${point.y}`).join(" ");
  // Der Raumname im Raum, wie in jedem Grundriss -- aber nicht in
  // seiner Mitte, sondern im hinteren Drittel.
  //
  // In der Mitte stand er genau dort, wo auch die Geraete stehen: die
  // Automatik setzt ein Geraet ohne eigene Angabe in die Raummitte, und
  // dessen Beschriftung haengt darunter. Auf dem ersten Bild fuer die
  // README las man deshalb "Adapter Arbeitszimmer" quer durch das Wort
  // "Arbeitszimmer". Nach hinten geschoben teilen sich beide den Raum:
  // der Name des Raumes hinten, was darin steht davor.
  //
  // Die Verschiebung geht nach oben statt auf einen festen Punkt im
  // Raumkasten, damit sie fuer jede Kontur gilt und nicht nur fuer das
  // Rechteck. Die hintere Kante ist im Bild waagerecht -- die Schraege
  // des Sandwiches verschiebt nur x --, also liegt alles zwischen Mitte
  // und dieser Kante sicher noch im Raum.
  const label = labelSpot(corners, area);

  // A virtual area is a cloud here too. It was a cloud on its own tab
  // and a rectangle in the house view, so the two views disagreed about
  // what the thing *is* -- and the house view is the one people open.
  // Walls, and only for rooms. A garden has no walls, and a cloud has
  // neither -- standing a terrace up on 26 units of masonry would say
  // the exact opposite of what a terrace is.
  //
  // Three parts, in the order you would see them: the floor inside the
  // room, the outside faces of the walls standing on it, and the top of
  // the masonry as a band with two edges. The band is what makes this
  // read as a plan rather than as a grey rectangle with a line round it.
  // Ein Balkon und ein Garten sind beide "outdoor", aber nicht dasselbe
  // Ding: der eine haengt am Haus, der andere liegt darum herum. Das
  // Modell kennt keinen eigenen Typ dafuer, also gilt hier dieselbe
  // Regel wie beim Rasen weiter oben -- Erdgeschoss ist Grundstueck,
  // alles darueber haengt am Bau. Ein Gelaender um den Rasen waere
  // genau das, wovor der Kommentar direkt darueber warnt.
      const outdoor = kindOf(area) === AREA_KIND.OUTDOOR;
  const deck = outdoor && !(floor && floor.ground);
  let shape = `<polygon class="room ${deck ? "deck" : ""}" points="${points}"/>`;
  if (kindOf(area) === AREA_KIND.INDOOR) {
    // Tueren und Fenster sind Luecken, keine eigenen Formen: die Wand
    // hoert davor auf und faengt dahinter wieder an. Deshalb wissen Wand
    // und Mauerkrone davon, und sonst nichts im Bild.
    // Eigene Oeffnungen -- und die des Nachbarn, dessen gemeinsame Wand
    // dieser Raum zeichnet. Eine Tuer gehoert der Wand, nicht dem Raum,
    // der sie eingetragen hat: wer die Wand malt, malt auch ihre Loecher.
    const lent = borrowed || {};
    const doors = [...doorsOf(area, corners.length), ...(lent.doors || [])];
    const windows = [
      ...windowsOfArea(area, corners.length),
      ...(lent.windows || []),
    ];
    const openings = [...openingsOf(area, corners.length), ...doors, ...windows]
      .filter((opening, index, all) => all.indexOf(opening) === index);
    const crown = corners.map((corner) => ({
      x: corner.x,
      y: corner.y - STACK.rise,
    }));
    shape += wallsOf(corners, STACK.rise, "room-wall", keep, openings) +
      capsOf(crown, STACK.wall, "room-cap", keep, openings);
    // Fenster und Tuerbogen koennen auch getrennt kommen: im Bild werden
    // sie zuletzt gezeichnet, sonst deckt die Aussenwand des Hauses sie
    // zu -- und die sitzt genau dort, wo die Fenster sind.
    if (withFittings) {
      shape += fittingsOf({ corners, crown, doors, windows }, keep);
    }
  }
  // Stufen. In der Referenzzeichnung ist die Treppe das, was einen
  // Grundriss auf den ersten Blick als Grundriss lesbar macht.
  //
  // Auf Hoehe der Mauerkrone und nach den Waenden gezeichnet, nicht auf
  // dem Rohboden davor: der Raum ist oben offen, aber seine vordere
  // Wandflaeche ist undurchsichtig und deckt alles zu, was auf der
  // Bodenplatte liegt -- die Stufen waren gezeichnet und trotzdem nicht
  // zu sehen. Quer zur langen Seite, denn dorthin laeuft eine Treppe.
  if (isStairs(area)) {
    shape += stairsOf(
      { project, x0, y0, width, height, lift: STACK.rise },
      STACK.treads,
    );
  }
  // A balcony stands on the house, it does not stand inside it: a
  // railing you can see over instead of a wall you can't is the one
  // thing that says "outside" in a drawing made of nothing but lines.
  //
  // Und ein Belag darunter: eine leere Flaeche mit einem Gelaender darum
  // sieht aus wie ein Loch im Bild, kein Balkon.
  if (deck) {
    shape += deckingOf({ project, x0, y0, width, height }) +
      wallsOf(corners, STACK.rise * 0.35, "deck-rail", keep);
  }
  if (kindOf(area) === AREA_KIND.VIRTUAL) {
    // Der Grundriss steht in der Flucht, also steht die Wolke mit
    // darin: zwei Kanten des projizierten Raumes sind die Achsen, an
    // denen sie gezeichnet wird. Damit gilt das auch weiter, seit die
    // Flanken nicht mehr parallel laufen.
    const origin = project(x0, y0);
    const alongX = project(x0 + width, y0);
    const alongY = project(x0, y0 + height);
    const matrix = [
      (alongX.x - origin.x) / 100, (alongX.y - origin.y) / 100,
      (alongY.x - origin.x) / 60, (alongY.y - origin.y) / 60,
      origin.x, origin.y,
    ]
      .map((value) => value.toFixed(4))
      .join(",");
    shape = `<path class="stack-cloud" transform="matrix(${matrix})"
      d="${CLOUD_PATH}"/>`;
  }

  // Die Beschriftung kann auch getrennt kommen: im Bild wird sie zuletzt
  // gezeichnet, sonst malt die Vorderwand des Hauses sie zu.
  return withLabel ? `${shape}${roomLabelHtml(
    { counterScale },
    area,
    label,
  )}` : shape;
};

/** Die Einbauten eines Raumes, ohne den Raum: Fenster und Tuerbogen.
 *
 *  Getrennt aus demselben Grund wie der Name: die Aussenwand des Hauses
 *  wird nach den Raeumen gezeichnet, und ein Fenster sitzt genau in ihr.
 *  Beim Raum gezeichnet lag jedes Fenster einer Aussenwand hinter der
 *  Wand, in der es steckt.
 */
const roomFittingsHtml = ({ project, borrowed }, area, keep = () => true) => {
  if (kindOf(area) !== AREA_KIND.INDOOR) return "";
  const width = (area.size && area.size.width) || 0.3;
  const height = (area.size && area.size.height) || 0.3;
  const x0 = area.position.x - width / 2;
  const y0 = area.position.y - height / 2;
  const corners = shapeOf(area)
    .map((point) => [x0 + point.x * width, y0 + point.y * height])
    .map(([x, y]) => project(x, y));
  const lent = borrowed || {};
  return fittingsOf(
    {
      corners,
      crown: corners.map((corner) => ({
        x: corner.x,
        y: corner.y - STACK.rise,
      })),
      doors: [...doorsOf(area, corners.length), ...(lent.doors || [])],
      windows: [
        ...windowsOfArea(area, corners.length),
        ...(lent.windows || []),
      ],
    },
    keep,
  );
};

/** Wo der Name eines Raumes steht -- als eigenes Stueck Zeichnung.
 *
 *  Getrennt, weil die Reihenfolge im Bild eine andere ist als die
 *  Reihenfolge im Raum: erst alle Raeume, dann die Vorderwand des Hauses,
 *  und ganz zuletzt die Namen. Stand der Name beim Raum, verschwand er
 *  hinter der Wand davor -- ausgerechnet in den vorderen Zimmern, die dem
 *  Betrachter am naechsten sind.
 */
const roomLabelHtml = ({ counterScale }, area, label) =>
  `<g data-at-x="${label.x}" data-at-y="${label.y}"
       transform="translate(${label.x},${label.y}) scale(${
         (counterScale * (label.fit === undefined ? 1 : label.fit)).toFixed(3)
       })">${roomLabel(area.name)}</g>`;

/** Wo die Beschriftung eines Raumes sitzt, ohne ihn zu zeichnen. */
const roomLabelAt = ({ project }, area) => {
  const width = (area.size && area.size.width) || 0.3;
  const height = (area.size && area.size.height) || 0.3;
  const x0 = area.position.x - width / 2;
  const y0 = area.position.y - height / 2;
  const corners = shapeOf(area)
    .map((point) => [x0 + point.x * width, y0 + point.y * height])
    .map(([x, y]) => project(x, y));
  return labelSpot(corners, area);
};

/** Die Ecken einer Raumkontur zum Anfassen: ziehen, entfernen, eine
 *  neue dazwischensetzen. */
const cornerHandlesHtml = (area) => {
  const id = escapeHtml(area.id);
  const shape = shapeOf(area);
  const at = (point) =>
    `left:${(point.x * 100).toFixed(2)}%;top:${(point.y * 100).toFixed(2)}%`;
  const corners = shape
    .map(
      (point, index) => `<span class="corner" style="${at(point)}"
          data-corner-area="${id}" data-corner-index="${index}"
          title="Ecke ziehen"
          ><button class="corner-drop" data-corner-drop="${id}"
                   data-corner-index="${index}"
                   title="Diese Ecke entfernen">×</button></span>`,
    )
    .join("");
  // Only worth offering while there is still a corner to spare: below
  // three points there is no polygon left to draw.
  const adders = shape
    .map((point, index) => {
      const next = shape[(index + 1) % shape.length];
      const middle = { x: (point.x + next.x) / 2, y: (point.y + next.y) / 2 };
      return `<span class="corner add" style="${at(middle)}"
          data-corner-add="${id}" data-corner-index="${index}"
          title="Hier eine neue Ecke setzen">+</span>`;
    })
    .join("");
  return corners + adders;
};


/** Die Oeffnungen eines Raumes als Bedienelemente.
 *
 *  Tueren und Fenster teilen sich diese Liste, weil sie sich dieselben
 *  drei Angaben teilen: welche Kante, wo darauf, wie breit. Was sie
 *  unterscheidet, entscheidet die Zeichnung -- ein Bogen oder eine
 *  Bruestung -- und nicht das Formular.
 */
const OPENINGS = {
  door: {
    title: "Türen",
    one: "Tür",
    note: `Eine Tür ist eine Lücke in der Wand — sie hört davor auf und
           fängt dahinter wieder an. Angaben als Anteil der Wand, damit die
           Tür bleibt, wo sie ist, wenn der Raum größer wird.`,
    empty: "Noch keine Tür.",
  },
  window: {
    title: "Fenster",
    one: "Fenster",
    note: `Ein Fenster ist eine Lücke mit Brüstung: die Mauer läuft
           darunter weiter. Gemessen wie eine Tür, als Anteil der Wand.`,
    empty: "Noch kein Fenster.",
  },
};

const openingsHtml = (area, kind, openings) => {
  const words = OPENINGS[kind];
  const sides = shapeOf(area).length;
  const rows = openings
    .map(
      (opening, index) => `
      <div class="door">
        <span class="door-side">${escapeHtml(sideName(Number(opening.side)))}</span>
        <label class="door-slide">
          <span class="muted">Mitte</span>
          <input type="range" min="0" max="1" step="0.01"
                 value="${Number(opening.at)}"
                 data-${kind}="${index}" data-${kind}-field="at">
        </label>
        <label class="door-slide">
          <span class="muted">Breite</span>
          <input type="range" min="0.05" max="0.9" step="0.01"
                 value="${Number(opening.width)}"
                 data-${kind}="${index}" data-${kind}-field="width">
        </label>
        <button class="icon-btn" data-${kind}-remove="${index}"
                title="${escapeHtml(words.one)} entfernen">
          <ha-icon icon="mdi:close"></ha-icon>
        </button>
      </div>`,
    )
    .join("");
  const add = Array.from({ length: sides }, (_unused, side) => side)
    .map(
      (side) => `<button class="chip" data-${kind}-add="${side}">
        + ${escapeHtml(sideName(side))}
      </button>`,
    )
    .join("");
  return `
    <h3>${escapeHtml(words.title)}</h3>
    <p class="note">${words.note}</p>
    ${rows ? `<div class="doors">${rows}</div>`
           : `<p class="note">${escapeHtml(words.empty)}</p>`}
    <div class="chips">${add}</div>`;
};

/** Die Tuer- und Fensterliste eines Raumes als Bedienelemente.
 *
 *  Nur fuer Raeume: ein Garten hat keine Waende, in die eine Luecke
 *  passen koennte, und die Wolke erst recht nicht.
 */
const doorsHtml = (area) => {
  if (kindOf(area) !== AREA_KIND.INDOOR) return "";
  const sides = shapeOf(area).length;
  return (
    openingsHtml(area, "door", doorsOf(area, sides)) +
    openingsHtml(area, "window", windowsOfArea(area, sides))
  );
};


/** Ein Verlauf als Kurve. Zwei Punkte sind das Minimum -- ein einzelner
 *  Messwert ist kein Verlauf, sondern eine Zahl. */
const sparklineHtml = (series) => {
  const points = series
    .map((point) => Number(point.value))
    .filter((value) => Number.isFinite(value));
  if (points.length < 2) {
    return `<p class="note">Zu wenig Verlauf für eine Kurve.</p>`;
  }
  const min = Math.min(...points);
  const max = Math.max(...points);
  const span = max - min || 1;
  const path = points
    .map(
      (value, index) =>
        `${(index / (points.length - 1)) * 100},${
          30 - ((value - min) / span) * 28
        }`,
    )
    .join(" ");
  return `
    <svg class="spark" viewBox="0 0 100 30" preserveAspectRatio="none">
      <polyline points="${path}" fill="none"
        stroke="var(--primary-color, #03a9f4)" stroke-width="1.5"
        vector-effect="non-scaling-stroke"/>
    </svg>
    <p class="note">${points.length} Punkte · ${min} … ${max}</p>`;
};


export {
  openingsHtml,
  roomFittingsHtml,
  roomLabel,
  roomLabelLines,
  labelFit,
  roomLabelHtml,
  roomLabelAt,
  roomPolygon,
  cornerHandlesHtml,
  doorsHtml,
  sparklineHtml,
  escapeHtml,
};
