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
  AREA_KIND,
  kindOf,
  doorsOf,
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

/** Ein Raum als Zeichnung: Boden, Waende, Mauerkrone, Stufen, Name.
 *
 *  `project` bildet einen Punkt des Grundrisses auf das Bild ab -- flach
 *  in der Einzelansicht, in der Flucht im Stapel. `floor` ist die Etage,
 *  auf der der Raum steht (fuer die Frage, ob ein Aussenbereich Rasen
 *  oder Balkon ist), `counterScale` haelt die Beschriftung lesbar,
 *  waehrend die Kamera zoomt.
 */
const roomPolygon = ({ project, floor, counterScale }, area, keep = () => true) => {
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
  const middle = centreOf(corners);
  const back = Math.min(...corners.map((corner) => corner.y));
  const label = { x: middle.x, y: middle.y - (middle.y - back) * 0.55 };

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
    // Tueren sind Luecken, keine eigenen Formen: die Wand hoert davor
    // auf und faengt dahinter wieder an. Deshalb wissen Wand und
    // Mauerkrone davon, und sonst nichts im Bild.
    const doors = doorsOf(area, corners.length);
    shape += wallsOf(corners, STACK.rise, "room-wall", keep, doors) +
      capsOf(
        corners.map((corner) => ({ x: corner.x, y: corner.y - STACK.rise })),
        STACK.wall,
        "room-cap",
        keep,
        doors,
      );
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
    const alongX = width >= height;
    const tread = (x, y) => {
      const point = project(x, y);
      return `${point.x},${point.y - STACK.rise}`;
    };
    for (let step = 1; step < STACK.treads; step += 1) {
      const at = step / STACK.treads;
      const [from, to] = alongX
        ? [tread(x0 + at * width, y0), tread(x0 + at * width, y0 + height)]
        : [tread(x0, y0 + at * height), tread(x0 + width, y0 + at * height)];
      shape += `<polyline class="tread" points="${from} ${to}"/>`;
    }
  }
  // A balcony stands on the house, it does not stand inside it: a
  // railing you can see over instead of a wall you can't is the one
  // thing that says "outside" in a drawing made of nothing but lines.
  if (deck) {
    shape += wallsOf(corners, STACK.rise * 0.35, "deck-rail", keep);
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

  return `${shape}
    <g data-at-x="${label.x}" data-at-y="${label.y}"
       transform="translate(${label.x},${label.y}) scale(${
         counterScale
       })"><text class="room-label">${escapeHtml(area.name)}</text></g>`;
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


/** Die Tuerliste eines Raumes als Bedienelemente. */
const doorsHtml = (area) => {
  if (kindOf(area) !== AREA_KIND.INDOOR) return "";
  const sides = shapeOf(area).length;
  const doors = doorsOf(area, sides);
  const rows = doors
    .map(
      (door, index) => `
      <div class="door">
        <span class="door-side">${escapeHtml(sideName(Number(door.side)))}</span>
        <label class="door-slide">
          <span class="muted">Mitte</span>
          <input type="range" min="0" max="1" step="0.01"
                 value="${Number(door.at)}"
                 data-door="${index}" data-door-field="at">
        </label>
        <label class="door-slide">
          <span class="muted">Breite</span>
          <input type="range" min="0.05" max="0.9" step="0.01"
                 value="${Number(door.width)}"
                 data-door="${index}" data-door-field="width">
        </label>
        <button class="icon-btn" data-door-remove="${index}"
                title="Tür entfernen">
          <ha-icon icon="mdi:close"></ha-icon>
        </button>
      </div>`,
    )
    .join("");
  const add = Array.from({ length: sides }, (_unused, side) => side)
    .map(
      (side) => `<button class="chip" data-door-add="${side}">
        + ${escapeHtml(sideName(side))}
      </button>`,
    )
    .join("");
  return `
    <h3>Türen</h3>
    <p class="note">Eine Tür ist eine Lücke in der Wand — sie hört davor
    auf und fängt dahinter wieder an. Angaben als Anteil der Wand, damit
    die Tür bleibt, wo sie ist, wenn der Raum größer wird.</p>
    ${rows ? `<div class="doors">${rows}</div>`
           : '<p class="note">Noch keine Tür.</p>'}
    <div class="chips">${add}</div>`;
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
  roomPolygon,
  cornerHandlesHtml,
  doorsHtml,
  sparklineHtml,
  escapeHtml,
};
