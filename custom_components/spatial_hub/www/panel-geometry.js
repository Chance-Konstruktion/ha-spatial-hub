/**
 * Die Geometrie eines Grundrisses -- ohne DOM, ohne Zustand, ohne Panel.
 *
 * Alles hier sind reine Funktionen ueber Zahlen und Formen: wo ein Punkt
 * einer Etage im Bild landet, wie dick eine Wand ist, welche zwei Raeume
 * sich eine teilen, was von einer Wand uebrig bleibt, wenn man die Tueren
 * herausnimmt. Nichts davon muss wissen, dass es einen Browser gibt.
 *
 * Ausgelagert, weil es von aussen gebraucht wird und nicht herankam:
 * `tools/shots.mjs` und die Perspektiv-Proben mussten `_project`
 * ueberschreiben und `STACK` von Hand nachbauen, weil beides modulprivat
 * in einer 6000-Zeilen-Datei stand. Eine Konstante, die man abschreiben
 * muss, um sie zu benutzen, ist zweimal vorhanden -- und die zweite geht
 * irgendwann falsch.
 *
 * Kein Build, kein Bundle: Der Browser laedt das als ES-Modul direkt.
 */

// Wie aus einem flachen Grundriss eine Etage wird, die man ansieht.
//
// Frueher eine Parallelverschiebung: nach hinten rutschte jeder Punkt um
// denselben Betrag nach rechts. Damit lehnten beide Seitenwaende in
// dieselbe Richtung, und das Haus wirkte gekippt statt gesehen -- man sah
// die linke Aussenwand von aussen und die rechte von innen.
//
// Jetzt ein Fluchtpunkt: die Hinterkante ist schmaler als die
// Vorderkante, gerechnet von der Mitte aus. Die linke Wand weicht dadurch
// nach rechts, die rechte nach links -- beide zur Mitte, wie in jeder
// Architekturzeichnung. Raeume bleiben dabei *keine* Parallelogramme
// mehr; das ist der Preis und zugleich der Punkt.
const STACK = {
  // "margin" ist der Platz links neben dem Haus, in dem der Etagenname
  // steht -- aber nur die Untergrenze davon. Wie breit er wirklich sein
  // muss, haengt am laengsten Namen und steht in `_nameGutter`.
  pad: 40, margin: 150, width: 620, top: 50, gap: 340,
  // Die Flucht: wie breit die Hinterkante im Verhaeltnis zur Vorderkante
  // ist. 1 waere gar keine (Wand parallel), 0.78 schon Weitwinkel. Beide
  // Zahlen sind an einer echten Zeichnung abgemessen und nicht geraten --
  // dort laeuft die linke Wand ueber die volle Tiefe rund ein Achtel der
  // Haus-Halbbreite nach innen, und die Tiefe ist gut vier Zehntel der
  // Breite. Sie haengen zusammen: dieselbe Flucht wirkt bei tieferem
  // Grundriss staerker, weil die Flanken laenger sind.
  back: 0.87, depth: 250,
  // Rooms have standing walls and a storey has thickness. Flat outlines
  // drawn on top of each other are what turned this view into porridge:
  // four sheets of the same weight, and nothing in the picture saying
  // which line is a wall, which is a floor edge and which is a garden.
  // Height is what separates them, so height is what the drawing gets.
  rise: 26, slab: 15,
  // How thick a wall is drawn. The outer wall of the building carries the
  // house and is drawn heavier than the partitions inside it -- the same
  // thing a paper floor plan does, and the reason one can be read from
  // across a room.
  wall: 8, outerWall: 13,
  // Wie viele Stufen eine Treppe bekommt. Nicht die echte Zahl -- die
  // weiss niemand -- sondern so viele, dass das Rechteck als Treppe zu
  // lesen ist und nicht als schraffierte Flaeche.
  treads: 9,
};

// Hier stand einmal `stagger: 34` -- jede Etage ein Stueck weiter rechts
// als die darueber. Die Begruendung war, dass deckungsgleiche Etagen
// ineinander verschwimmen und das Auge nichts hat, woran es sie trennt.
//
// Das stimmte, als die Etagen flache Umrisse dicht beieinander waren.
// Seither haben sie `rise`, `slab` und Waende mit Dicke, und zwischen
// ihnen liegen `gap` = 340 Einheiten Luft: Sie sind unverwechselbar
// getrennte Koerper. Die Aufgabe des Versatzes war erledigt, er selbst
// aber nicht.
//
// Angesehen war er das Gegenteil von dem, was diese Ansicht leisten
// soll. 34 von 620 Haus­breite sind 5,5 % -- zu wenig fuer eine
// erkennbare Absicht und zu viel fuer eine Flucht: Man liest keine
// auseinandergezogene Zeichnung *eines* Gebaeudes, sondern drei
// Grundrisse, die nicht ganz uebereinanderliegen. Ohne Versatz teilen
// sich alle Etagen eine Senkrechte, und genau das sagt "ein Haus".
// Zur Gegenprobe mit 80 gezeichnet: Dann ist der Versatz zwar Absicht,
// aber es sind drei Zeichnungen auf einer Diagonale.
//
// Er kostete ausserdem Bildbreite, und zwar wachsend mit dem Haus: Bei
// drei Etagen belegte das Haus 71 % der Bildbreite statt 77 %, bei acht
// nur noch 59 %. Ein Stapel wird also umso kleiner gezeichnet, je mehr
// Stockwerke er hat -- in einer Ansicht, deren einziger Zweck der
// Stapel ist.

/** The middle of a projected outline. Where a room's name belongs: at the
 *  corner it collided with the neighbour's name two rooms in a row. */
const centreOf = (corners) => ({
  x: corners.reduce((sum, point) => sum + point.x, 0) / corners.length,
  y: corners.reduce((sum, point) => sum + point.y, 0) / corners.length,
});

/** The same outline, `amount` further in.
 *
 *  A wall is not a line, it is a thing with two sides -- that is what a
 *  floor plan draws and what makes one readable at a glance. So a room
 *  gets an outer edge and an inner one, and the band between them is the
 *  masonry.
 *
 *  Each corner steps straight towards the middle rather than the outline
 *  being scaled: scaling makes the wall of a long corridor thick at the
 *  ends and thin along the sides, which is not a wall, that is a funnel.
 *  A tiny room never turns inside out -- the step stops at not-quite-half
 *  the way to the middle.
 */
const insetOf = (corners, amount) => {
  const middle = centreOf(corners);
  return corners.map((corner) => {
    const dx = middle.x - corner.x;
    const dy = middle.y - corner.y;
    const reach = Math.hypot(dx, dy) || 1;
    const step = Math.min(amount, reach * 0.42);
    return { x: corner.x + (dx / reach) * step, y: corner.y + (dy / reach) * step };
  });
};

/** The top of a wall: the band between an outline and its inset.
 *
 *  One quad per wall rather than one ring with a hole in it. The ring was
 *  shorter, but a ring cannot leave a wall out -- and leaving a wall out
 *  is the whole of sharing one with the room next door.
 */
const along = (from, to, at) => ({
  x: from.x + (to.x - from.x) * at,
  y: from.y + (to.y - from.y) * at,
});

const OPENING = Object.freeze({ DOOR: "door", WINDOW: "window" });

/** Tuer oder Fenster? Fehlt die Angabe, ist es eine Tuer.
 *
 *  Das Feld kam spaeter dazu. Eine Anordnung, die vorher gespeichert
 *  wurde, hat es nicht -- und die soll weiter gelten, statt beim Laden
 *  zu einem Raum ohne Oeffnungen zu werden.
 */
const openingKind = (door) =>
  (door && door.kind) === OPENING.WINDOW ? OPENING.WINDOW : OPENING.DOOR;

/** Wo eine Oeffnung auf ihrer Wand anfaengt und aufhoert, 0..1.
 *
 *  Eine Stelle, nicht drei: `at` ist die Mitte und `width` die Breite,
 *  und jede Rechnung, die daraus Anfang und Ende macht, muss dieselbe
 *  Klemmung anwenden. Zwei Fassungen davon waren der Grund, warum eine
 *  Tuer am Rand im Bild woanders sass als im Dialog.
 */
const openingRun = (door) => {
  const width = Math.min(Math.max(Number(door && door.width) || 0, 0), 1);
  const at = Math.min(Math.max(Number(door && door.at), 0), 1);
  return [at - width / 2, at + width / 2];
};

/** Die Oeffnungen einer Wand, in der Reihenfolge, in der sie darauf liegen.
 *
 *  Gespeichert werden sie in der Reihenfolge, in der jemand sie angelegt
 *  hat, und das ist keine Reihenfolge. Wer sie zeichnet, braucht sie
 *  sortiert.
 */
const openingsOn = (doors, side) =>
  (Array.isArray(doors) ? doors : [])
    .filter((door) => door && Number(door.side) === side)
    .map((door) => ({ door, run: openingRun(door) }))
    .filter(({ run }) => run[1] > run[0])
    .sort((a, b) => a.run[0] - b.run[0]);

/** What is left of one wall once the doorways are taken out of it.
 *
 *  A list of `[from, to]` stretches along the edge, 0 at one corner and 1
 *  at the other. No doors means one stretch covering the whole wall, which
 *  is why everything that does not know about doors keeps working.
 *
 *  Overlapping doors are merged rather than drawn twice: two openings that
 *  touch are one opening, and a wall segment of negative length is not a
 *  thing a renderer should have to think about.
 *
 *  Ein **Fenster** ist hier keine Luecke. Es sitzt in der Wand, es
 *  ersetzt sie nicht -- eine Wand, die unter dem Fenster aufhoert, ist
 *  eine Tuer. Gezeichnet wird es deshalb zusaetzlich und nicht anstelle
 *  der Wand, und diese Funktion sieht davon nichts.
 */
const wallRuns = (doors, side) => {
  const holes = openingsOn(doors, side)
    .filter(({ door }) => openingKind(door) === OPENING.DOOR)
    .map(({ run }) => run);

  const runs = [];
  let cursor = 0;
  for (const [from, to] of holes) {
    if (from > cursor) runs.push([cursor, Math.min(from, 1)]);
    cursor = Math.max(cursor, to);
  }
  if (cursor < 1) runs.push([cursor, 1]);
  // Ein Rest von einem Tausendstel Wand ist keine Wand, sondern ein
  // Strich, der auf dem Bildschirm als Schmutz ankommt.
  return runs.filter(([from, to]) => to - from > 0.001);
};

const capsOf = (corners, thickness, className, keep = () => true,
                doors = null) => {
  const inner = insetOf(corners, thickness);
  return corners
    .map((corner, index) => {
      if (!keep(index)) return "";
      const next = (index + 1) % corners.length;
      return wallRuns(doors, index)
        .map(([from, to]) => {
          const outerA = along(corner, corners[next], from);
          const outerB = along(corner, corners[next], to);
          const innerA = along(inner[index], inner[next], from);
          const innerB = along(inner[index], inner[next], to);
          return `<polygon class="${className}" points="${outerA.x},${outerA.y} ` +
            `${outerB.x},${outerB.y} ` +
            `${innerB.x},${innerB.y} ${innerA.x},${innerA.y}"/>`;
        })
        .join("");
    })
    .join("");
};

/** Fenster und Tuerschwenk: was eine Oeffnung ausser einer Luecke ist.
 *
 *  Eine Luecke allein sagt nicht, was sie ist. In einer Bauzeichnung
 *  steht am Durchgang ein Viertelkreis -- der Schwenk des Tuerblatts --
 *  und im Fenster liegt eine Bruestung. Genau daran liest man einen
 *  Grundriss als Grundriss, und ohne das waren beide dasselbe: nichts.
 *
 *  `corners` ist die projizierte Kontur, `rise` die Wandhoehe. Beides
 *  wie bei `wallsOf`, damit Wand und Oeffnung nicht aus zwei Rechnungen
 *  kommen und sich um ein Pixel verfehlen.
 */
const openingMarksOf = (corners, rise, doors, keep = () => true) =>
  corners
    .map((corner, index) => {
      if (!keep(index)) return "";
      const next = corners[(index + 1) % corners.length];
      return openingsOn(doors, index)
        .map(({ door, run: [from, to] }) => {
          const start = along(corner, next, from);
          const end = along(corner, next, to);
          if (openingKind(door) === OPENING.WINDOW) {
            // Ein Fenster ist eine duennere Wand mit einer Bruestung
            // darunter, keine Luecke: die Wand laeuft durch, und was
            // sie zum Fenster macht, sind die zwei waagerechten Linien
            // auf Bruestungs- und Sturzhoehe.
            const band = (height) =>
              `<polyline class="window-bar" points="${start.x},${
                start.y - height
              } ${end.x},${end.y - height}"/>`;
            return `<polygon class="window-pane" points="${start.x},${start.y} ` +
              `${end.x},${end.y} ${end.x},${end.y - rise} ` +
              `${start.x},${start.y - rise}"/>` +
              band(rise * 0.35) + band(rise * 0.85);
          }
          // Der Schwenk: Tuerblatt und Viertelkreis, das Zeichen, an dem
          // man eine Tuer in einem Grundriss erkennt. Die Angel sitzt am
          // vorderen Ende der Oeffnung -- welches das ist, entscheidet
          // die Laufrichtung der Kontur, und damit schwenken alle Tueren
          // eines Raumes gleichsinnig statt jede, wie es sich ergibt.
          const span = Math.hypot(end.x - start.x, end.y - start.y);
          // Unter einem Pixel ist der Kreis ein Punkt und der Bogen ein
          // Fehler im SVG. Die Luecke bleibt, das Zeichen entfaellt.
          if (span < 1.5) return "";
          // Nach innen heisst: nach rechts von der Laufrichtung. Die
          // Kontur laeuft (0,0) (1,0) (1,1) (0,1), im Bild also im
          // Uhrzeigersinn -- eine Fallunterscheidung je Wand braucht es
          // dafuer nicht.
          const nx = -(end.y - start.y) / span;
          const ny = (end.x - start.x) / span;
          const hinge = { x: start.x, y: start.y - rise };
          const jamb = { x: end.x, y: end.y - rise };
          const leaf = { x: hinge.x + nx * span, y: hinge.y + ny * span };
          return `<path class="door-swing" d="M${hinge.x.toFixed(2)},${
            hinge.y.toFixed(2)
          } L${leaf.x.toFixed(2)},${leaf.y.toFixed(2)} A${span.toFixed(2)},${
            span.toFixed(2)
          } 0 0 1 ${jamb.x.toFixed(2)},${jamb.y.toFixed(2)}"/>`;
        })
        .join("");
    })
    .join("");

/** Standing walls along a projected outline.
 *
 *  `rise` upwards for a room's walls, negative for the slab a storey
 *  stands on. One quad per edge, in the outline's own order -- the
 *  projection shears x and y together, so a wall is a parallelogram and
 *  needs no trigonometry beyond "the same points, higher up".
 */
const wallsOf = (corners, rise, className, keep = () => true, doors = null) =>
  corners
    .map((corner, index) => {
      if (!keep(index)) return "";
      const next = corners[(index + 1) % corners.length];
      return wallRuns(doors, index)
        .map(([from, to]) => {
          const start = along(corner, next, from);
          const end = along(corner, next, to);
          return `<polygon class="${className}" points="${start.x},${start.y} ` +
            `${end.x},${end.y} ${end.x},${end.y - rise} ` +
            `${start.x},${start.y - rise}"/>`;
        })
        .join("");
    })
    .join("");

/** Which of the four outer walls stand between the viewer and the rooms.
 *
 *  The house outline runs (0,0) (1,0) (1,1) (0,1), so edges 1 and 2 face
 *  the viewer and edges 0 and 3 are behind the storey. They have to be
 *  drawn on opposite sides of the rooms: all four in front and the back
 *  wall paints over the plan; all four behind and the front wall stops
 *  being a wall the rooms stand inside.
 */
const FRONT_WALL = (index) => index === 1 || index === 2;
const BACK_WALL = (index) => !FRONT_WALL(index);

/** The house occupies 0..1; a garden lives outside it.
 *
 *  Everything drawn shares one coordinate system, and a floor that carries
 *  outdoor areas simply shows more of it: -margin .. 1+margin in both
 *  directions. That is what makes the garden surround the ground floor
 *  instead of becoming a storey underneath it.
 */
/** How strongly the building itself is drawn, 0.2 … 1.6.
 *
 *  Clamped rather than trusted: a stored zero would erase the house and
 *  leave a panel that looks broken, with the setting that did it three
 *  dialogs away.
 */
/** How wide the house itself is, in metres. The one number everything
 *  else is measured against -- and the only one anybody has to know. */
const houseMetres = (floor) => {
  const value = Number((floor || {}).metres);
  if (!Number.isFinite(value) || value <= 0) return 12;
  return Math.min(200, Math.max(1, value));
};

const metre = (value) => value.toFixed(1).replace(".", ",");

const houseWeight = (theme) => {
  const value = Number((theme || {}).house_weight);
  if (!Number.isFinite(value)) return 1;
  return Math.min(1.6, Math.max(0.2, value));
};

/** How eagerly a dragged wall reaches for a neighbour, as a multiple of
 *  `SNAP_REACH`. 0.4 … 3, same clamp as the backend applies to what it
 *  stores -- a renderer trusts its own theme, but not a number that
 *  arrived unclamped from an older stored value. */
const snapReach = (theme) => {
  const value = Number((theme || {}).snap_reach);
  if (!Number.isFinite(value)) return 1;
  return Math.min(3, Math.max(0.4, value));
};

/** Wie viel Umland das Bild zeigt -- je Himmelsrichtung einzeln.
 *
 *  Frueher war das eine einzige Zahl fuer alle vier Seiten. Wer hinter
 *  dem Haus 300m Garten hat und davor die Strasse, bekam damit auch vorn,
 *  links und rechts 300m: das Haus schrumpfte in der Mitte eines fast
 *  leeren Bildes zusammen, und der Garten liess sich nicht nach hinten
 *  erweitern, ohne alles andere mitzuziehen. Ein Grundstueck ist selten
 *  quadratisch und das Haus steht fast nie in seiner Mitte.
 *
 *  Deshalb vier Raender. Der Rahmen ist danach nicht mehr quadratisch --
 *  darum tragen die Achsen getrennte Spannen, und die Buehne bekommt das
 *  Seitenverhaeltnis des Rahmens, damit ein quadratischer Raum
 *  quadratisch bleibt.
 */
const frameOf = (floor, areas) => {
  // Garten und Erdreich brauchen beide das Umland: beide liegen im Ring
  // um die Etage, nicht in ihrem Grundriss. Eine Etage, deren Fenster
  // genau so breit ist wie ihre Waende, kann nichts davon zeigen.
  const wide = floor && floor.has_outdoor;
  const base = wide ? floor.outdoor_margin || 0.28 : 0;
  // links, rechts, oben, unten -- das Haus liegt immer auf 0..1.
  const side = { left: base, right: base, top: base, bottom: base };
  const widen = (box, extra) => {
    side.left = Math.max(side.left, -box.left + extra);
    side.right = Math.max(side.right, box.right - 1 + extra);
    side.top = Math.max(side.top, -box.top + extra);
    side.bottom = Math.max(side.bottom, box.bottom - 1 + extra);
  };

  // A drawn plot decides how much surroundings there are. Everybody's
  // garden is a different size, and a fixed apron would mean the boundary
  // either stops at an invisible wall or is drawn outside the picture --
  // so the window grows to hold whatever was drawn.
  //
  // Und mit demselben Zuschlag wie ein gezogener Garten: wer eine Ecke an
  // den Rand zieht, soll beim naechsten Mal Platz haben, sie weiter zu
  // ziehen -- statt "ziehen, loslassen, ziehen" ein Dutzend Mal.
  const plot = floor && Array.isArray(floor.plot) ? floor.plot : null;
  if (plot && plot.length >= 3) {
    const reach = { left: 0, right: 0, top: 0, bottom: 0 };
    for (const point of plot) {
      if (!point || typeof point.x !== "number" || typeof point.y !== "number") {
        continue;
      }
      reach.left = Math.max(reach.left, -point.x);
      reach.right = Math.max(reach.right, point.x - 1);
      reach.top = Math.max(reach.top, -point.y);
      reach.bottom = Math.max(reach.bottom, point.y - 1);
    }
    for (const where of ["left", "right", "top", "bottom"]) {
      if (reach[where] > side[where]) side[where] = reach[where] + 0.5;
      else side[where] = Math.max(side[where], reach[where] + 0.04);
    }
  }
  // Same idea without a drawn plot: a garden dragged bigger than the
  // default apron is still something somebody drew on purpose, not an
  // overflow to clip away. Without this the fixed apron is a wall nobody
  // can see, and growing a garden past it takes a dozen trips through
  // "drag to the edge, let go, drag again" before it is even visible.
  //
  // Der Zuschlag ist grosszuegig, damit einmal Ziehen Platz fuer das
  // naechste Mal schafft -- aber er gilt nur noch fuer die Seite, an der
  // wirklich etwas hinausragt.
  //
  // Der Zuschlag greift nur an der Seite, an der wirklich etwas ueber den
  // Standardrand hinausragt: ein kleiner Garten, der in die Schuerze
  // passt, darf das Fenster nicht trotzdem aufziehen.
  if (wide && floor && Array.isArray(areas)) {
    const reach = { left: 0, right: 0, top: 0, bottom: 0 };
    for (const area of areas) {
      if (kindOf(area) !== AREA_KIND.OUTDOOR) continue;
      if (area.floor_id !== floor.id || !area.position) continue;
      const box = boxOf(area);
      reach.left = Math.max(reach.left, -box.left);
      reach.right = Math.max(reach.right, box.right - 1);
      reach.top = Math.max(reach.top, -box.top);
      reach.bottom = Math.max(reach.bottom, box.bottom - 1);
    }
    for (const where of ["left", "right", "top", "bottom"]) {
      if (reach[where] > side[where]) side[where] = reach[where] + 0.5;
    }
  }

  // Vier Hausbreiten je Seite sind schon ein Park; darueber wird das Haus
  // zum Punkt, und niemand findet mehr ein Geraet darin.
  const cap = (value) => Math.min(4, Math.max(0, value));
  const left = cap(side.left);
  const right = cap(side.right);
  const top = cap(side.top);
  const bottom = cap(side.bottom);
  return {
    min: left ? -left : 0,
    span: 1 + left + right,
    minY: top ? -top : 0,
    spanY: 1 + top + bottom,
  };
};

/** Die y-Spanne eines Rahmens. Aeltere Rahmen (Tests, gespeicherte
 *  Zustaende) kennen nur eine Spanne fuer beides -- die gilt dann fuer
 *  beide Achsen, und alles verhaelt sich wie vorher. */
const spanY = (frame) => (frame.spanY === undefined ? frame.span : frame.spanY);
const minY = (frame) => (frame.minY === undefined ? frame.min : frame.minY);

/** Der Rahmen der y-Achse als eigener Rahmen -- fuer alles, was mit
 *  einer Achse rechnet und nicht wissen muss, welche es ist. */
const yFrame = (frame) => ({ min: minY(frame), span: spanY(frame) });

const inFrame = (value, frame) => ((value - frame.min) / frame.span) * 100;
const inFrameY = (value, frame) =>
  ((value - minY(frame)) / spanY(frame)) * 100;

/** A room is a rectangle until somebody says otherwise.
 *
 *  Real homes have niches, chimney breasts and walls that step -- an
 *  L-shaped living room drawn as a rectangle is simply the wrong room. So
 *  an area may carry a `shape`: its own outline, in coordinates *local to
 *  its box*, where 0,0 is the top-left corner and 1,1 the bottom-right.
 *
 *  Local on purpose. The box keeps doing everything it did before -- it
 *  is what gets dragged, what gets resized by the eight wall handles, and
 *  what the sandwich projects. The shape rides inside it, so widening a
 *  room widens its niche too instead of tearing the outline off the walls.
 */
const RECTANGLE = Object.freeze([
  Object.freeze({ x: 0, y: 0 }), Object.freeze({ x: 1, y: 0 }),
  Object.freeze({ x: 1, y: 1 }), Object.freeze({ x: 0, y: 1 }),
]);

/** An area's outline, always at least a rectangle.
 *
 *  Anything that is not a usable polygon -- absent, too few corners,
 *  a number that is not a number -- falls back rather than throwing. A
 *  plan that refuses to draw because one stored corner is a string is a
 *  worse outcome than a room that is briefly a rectangle again.
 */
const shapeOf = (area) => {
  const shape = area && area.shape;
  if (!Array.isArray(shape) || shape.length < 3) return RECTANGLE;
  const points = shape
    .map((point) => ({ x: Number(point && point.x), y: Number(point && point.y) }))
    .filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y));
  return points.length >= 3 ? points : RECTANGLE;
};

/** Whether an area has an outline of its own worth mentioning. */
const hasShape = (area) => shapeOf(area) !== RECTANGLE;

/** Der Abstand zweier Schraffurstriche, in Grundriss-Einheiten.
 *
 *  Fester Abstand statt fester Anzahl. Mit einer festen Anzahl haengt der
 *  Winkel an der Form des Kastens: das Erdreich ist ein Band von 1.4 auf
 *  0.22, und die Diagonale eines solchen Kastens liegt fast flach -- auf
 *  dem Bild sah das aus wie Maserung und nicht wie Erde. Ein fester
 *  Abstand laesst den Winkel in Ruhe und die Zahl der Striche mitwachsen,
 *  was genau richtig herum ist: eine Schraffur ist eine Dichte.
 */
const SOIL_HATCH_GAP = 0.075;

/** Wie viele Striche hoechstens. Ein Bereich ueber das ganze Grundstueck
 *  gezogen bekaeme sonst dreistellig viele Linien, und der Renderer
 *  zeichnet sie alle, bevor jemand merkt, dass es zu viele sind. */
const SOIL_HATCH_MAX = 48;

/** Die Schraffur eines Erdreich-Bereichs, als Striche in Bildkoordinaten.
 *
 *  Diagonal unter 45 Grad im Grundriss, weil senkrecht wie eine Wand
 *  aussaehe und waagerecht wie ein Boden.
 *
 *  `project` bildet einen Punkt des Grundrisses ab. Die Striche werden
 *  deshalb im Grundriss gerechnet und erst dann projiziert: eine
 *  Schraffur, die im Bild gerechnet wird, steht auf jeder Etage anders
 *  schraeg -- die Flucht wirkt ja auf jeder Ebene anders.
 *
 *  Abgeschnitten wird mit der Fallunterscheidung und nicht mit einer
 *  Clip-Maske: ein Strich, der ueber die Kante laeuft, ist im SVG ein
 *  Strich ueber der Kante, auch wenn ihn gerade zufaellig etwas verdeckt.
 */
const soilHatch = (project, x0, y0, width, height, gap = SOIL_HATCH_GAP) => {
  const reach = width + height;
  const step = Math.max(gap, reach / SOIL_HATCH_MAX);
  const lines = [];
  for (let t = step; t < reach; t += step) {
    const from = t <= height ? [0, t] : [t - height, height];
    const to = t <= width ? [t, 0] : [width, t - width];
    lines.push([
      project(x0 + from[0], y0 + from[1]),
      project(x0 + to[0], y0 + to[1]),
    ]);
  }
  return lines;
};

/** A room's four walls in floor coordinates. */
const boxOf = (area) => {
  const size = (area && area.size) || { width: 0.3, height: 0.3 };
  return {
    left: area.position.x - size.width / 2,
    right: area.position.x + size.width / 2,
    top: area.position.y - size.height / 2,
    bottom: area.position.y + size.height / 2,
  };
};

/** The walls of a room's box, in the order its outline runs. */
const SIDE = Object.freeze({ TOP: 0, RIGHT: 1, BOTTOM: 2, LEFT: 3 });
const SIDE_NAME = Object.freeze(["top", "right", "bottom", "left"]);

// How close two walls must be to be one wall, and how far a dragged wall
// reaches for a neighbour to snap onto. The reach is the larger of the
// two on purpose: you aim roughly, it lands exactly, and after that the
// join is a fact rather than a guess about what you meant.
const JOIN_GAP = 0.006;
const SNAP_REACH = 0.03;

/** Rooms that can share a wall.
 *
 *  A rectangle with walls: not a garden, not a cloud, and not a room with
 *  an outline of its own -- a niche has no side called "right", so there
 *  is nothing to join and nothing honest to draw.
 */
const joinable = (area) =>
  Boolean(area) && Boolean(area.position) &&
  kindOf(area) === AREA_KIND.INDOOR && !hasShape(area);

/** Has somebody said these two rooms really do have two walls?
 *
 *  Stored on either side and honoured from both: a party wall between two
 *  flats is two walls, and it must not come back the next time the other
 *  room is the one being edited.
 */
const unjoined = (a, b) =>
  (Array.isArray(a.unjoined) && a.unjoined.includes(b.id)) ||
  (Array.isArray(b.unjoined) && b.unjoined.includes(a.id));

/** Which walls of which rooms are the same wall.
 *
 *  Returns `id -> Map(side -> neighbour id)`. Two rooms share a wall when
 *  one's wall lands on the other's and they actually run alongside each
 *  other -- touching at a single corner is not a shared wall, it is two
 *  rooms meeting at a point.
 *
 *  `honourBreaks: false` reports what the geometry says regardless of
 *  what anybody switched off, which is how a broken join can still offer
 *  to be joined again.
 */
const joinsOf = (areas, honourBreaks = true) => {
  const rooms = areas.filter(joinable);
  const found = new Map();
  const add = (id, side, other) => {
    if (!found.has(id)) found.set(id, new Map());
    found.get(id).set(side, other);
  };
  for (let i = 0; i < rooms.length; i += 1) {
    for (let j = i + 1; j < rooms.length; j += 1) {
      const a = rooms[i];
      const b = rooms[j];
      if (honourBreaks && unjoined(a, b)) continue;
      const one = boxOf(a);
      const two = boxOf(b);
      const alongY = Math.min(one.bottom, two.bottom) - Math.max(one.top, two.top);
      const alongX = Math.min(one.right, two.right) - Math.max(one.left, two.left);
      if (alongY > JOIN_GAP) {
        if (Math.abs(one.right - two.left) <= JOIN_GAP) {
          add(a.id, SIDE.RIGHT, b.id);
          add(b.id, SIDE.LEFT, a.id);
        }
        if (Math.abs(two.right - one.left) <= JOIN_GAP) {
          add(b.id, SIDE.RIGHT, a.id);
          add(a.id, SIDE.LEFT, b.id);
        }
      }
      if (alongX > JOIN_GAP) {
        if (Math.abs(one.bottom - two.top) <= JOIN_GAP) {
          add(a.id, SIDE.BOTTOM, b.id);
          add(b.id, SIDE.TOP, a.id);
        }
        if (Math.abs(two.bottom - one.top) <= JOIN_GAP) {
          add(b.id, SIDE.BOTTOM, a.id);
          add(a.id, SIDE.TOP, b.id);
        }
      }
    }
  }
  return found;
};

/** Of two rooms sharing a wall, which one draws it.
 *
 *  The one in front. Rooms are painted back to front, so a wall drawn
 *  with the room behind would have the front room's floor painted over
 *  its foot -- a wall standing in the neighbour's carpet.
 */
const drawsTheWall = (a, b) =>
  a.position.y !== b.position.y ? a.position.y > b.position.y : a.id > b.id;

/** The three area kinds, frozen. Specification § Area Type.
 *
 *  A renderer that compares against a literal is a renderer that quietly
 *  draws a garden as a living room the day somebody writes "outside". The
 *  hub normalises what it stores; this is the same promise on this side. */
const AREA_KIND = Object.freeze({
  INDOOR: "indoor",
  OUTDOOR: "outdoor",
  VIRTUAL: "virtual",
});

/** The kind of an area, or INDOOR when it says nothing recognisable. */
const kindOf = (area) =>
  Object.values(AREA_KIND).includes(area && area.kind)
    ? area.kind
    : AREA_KIND.INDOOR;

/** Kleingeschrieben, ohne Umlaute, ohne Zeichensetzung -- nur zum
 *  Vergleichen. Dasselbe Falten wie `_fold` im Backend. */
const fold = (value) =>
  String(value ?? "")
    .toLowerCase()
    .replace(/ä/g, "a")
    .replace(/ö/g, "o")
    .replace(/ü/g, "u")
    .replace(/ß/g, "ss")
    .replace(/[^a-z0-9]+/g, " ");

/** Die Tueren eines Raumes, so wie sie gezeichnet werden duerfen.
 *
 *  Kastenlokal wie `shape`: `side` ist die Kante, `at` die Mitte der
 *  Oeffnung darauf (0..1) und `width` ihre Breite als Anteil der Kante.
 *  Damit ueberlebt eine Tuer Verschieben und Groessenaendern, ohne dass
 *  irgendwo eine Laenge in Metern steht.
 *
 *  Was hier nicht durchkommt, wird weggelassen statt geraten: eine Tuer
 *  auf einer Kante, die es nicht gibt, ist ein Fehler des Schreibers, und
 *  eine halb erfundene Oeffnung waere schlimmer als gar keine.
 */
const doorsOf = (area, sides = 4) =>
  (Array.isArray(area && area.doors) ? area.doors : []).filter((door) => {
    const side = Number(door && door.side);
    return (
      Number.isInteger(side) && side >= 0 && side < sides &&
      Number.isFinite(Number(door.at)) && Number(door.width) > 0
    );
  });

/** Wie die vier Kanten eines Raumes heissen, aus Sicht des Betrachters.
 *
 *  Die Reihenfolge ist die von RECTANGLE, und "vorne" ist die Kante, die
 *  in der Hausansicht zum Betrachter zeigt -- dieselbe, die FRONT_WALL
 *  meint. Ein Raum mit eigener Form hat mehr Kanten als Namen; die
 *  bekommen eine Nummer, denn "hinten links aussen" waere geraten.
 */
const SIDE_NAMES = ["hinten", "rechts", "vorne", "links"];
const sideName = (side) => SIDE_NAMES[side] || `Kante ${side + 1}`;

const STAIR_WORDS = ["treppe", "stiege", "stairs", "stairway", "staircase"];

/** Ist dieser Raum eine Treppe?
 *
 *  Bewusst *keine* vierte Raumart: der Katalog der Raumarten steht in der
 *  Spezifikation und gilt fuer jeden Provider, eine Stufe ist aber nichts,
 *  was ein Provider je liefern wird -- sie ist ein Zeichendetail. Erkannt
 *  wird sie deshalb so, wie das Backend auch schon Aussenbereiche erkennt:
 *  an dem, was der Benutzer hingeschrieben hat, Name oder Symbol.
 */
const isStairs = (area) =>
  kindOf(area) === AREA_KIND.INDOOR &&
  STAIR_WORDS.some((word) =>
    fold(`${(area && area.name) || ""} ${(area && area.icon) || ""}`)
      .includes(word),
  );

// ── Der Stapel: wo eine Etage im Bild landet ──────────────
//
// Bisher steckte das in der Panel-Klasse, und `tools/shots.mjs` musste
// `_project` ueberschreiben, um an dieselbe Rechnung zu kommen. Eine
// Projektion, die man nur mit einem Custom Element in der Hand ausrechnen
// kann, ist keine Geometrie mehr, sondern ein Nebeneffekt.

// Hier stand einmal `planeLift`/`skyOf`: der Abstand, den die Wolkenebene
// ueber dem Dach brauchte, um nicht als Dachboden mit aufgemaltem Wetter
// gelesen zu werden. Das waren STACK.depth/2 + 130 = 255 Einheiten Luft,
// die auf *jede* Zeichnung addiert wurden, plus die 340 des eigenen
// Etagenplatzes -- bei einem Haus mit vier Ebenen zusammen gut vier
// Zehntel der Bildhoehe fuer eine Ebene, auf der drei Kaesten standen.
//
// Das Erdreich braucht davon nichts: es liegt im Ring um die unterste
// Etage, also auf einer Ebene, die es ohnehin schon gibt.

/** Where a point on a given floor lands in the stacked drawing.
 *
 *  Coordinates outside 0..1 are not an error -- that is the garden -- so
 *  the whole window is mapped rather than the house alone.
 *
 *  Die Flucht wirkt von der Mitte der Etage aus, nicht von ihrer linken
 *  Kante: nur so weichen beide Flanken nach innen. Zieht man stattdessen
 *  alles nach rechts, lehnen sie gleichsinnig, und man sieht die eine
 *  Aussenwand von aussen und die andere von innen -- was kein Standpunkt
 *  ist, den ein Betrachter einnehmen kann.
 */
const projectOnto = ({ frame, gutter, floors, index }, x, y) => {
  const nx = (x - frame.min) / frame.span;
  const ny = (y - minY(frame)) / spanY(frame);
  const shrink = STACK.back + (1 - STACK.back) * ny;
  return {
    x: gutter + STACK.width / 2 + (nx - 0.5) * STACK.width * shrink,
    y: STACK.top + index * STACK.gap + ny * STACK.depth,
  };
};

/** How tall the drawing has to be to hold the house.
 *
 *  The storeys used to be squeezed into a fixed 1000x1000 box: with a sky
 *  plane and four floors the spacing collapsed to under a third of a
 *  storey's own depth, so every floor was drawn *through* the one below
 *  it. Air between the storeys is what makes them storeys, so the picture
 *  grows with the house instead of the house shrinking into the picture.
 */
/** `extra` ist Platz unter der untersten Etage: die Massketten haengen
 *  unter der Vorderkante, und bei der untersten ist unter der
 *  Vorderkante das Ende des Bildes. Ohne diesen Zuschlag ist die Kette
 *  gezeichnet und trotzdem nicht zu sehen -- und zwar nur bei einer
 *  einzigen Etage, was der unangenehmste Fehler von allen ist. */
const stackHeight = (floors, extra = 0) =>
  STACK.top +
  Math.max(0, (floors || []).length - 1) * STACK.gap +
  STACK.depth + STACK.slab + STACK.pad + Math.max(0, extra);

/** How wide the drawing has to be.
 *
 *  Unabhaengig von der Zahl der Etagen: Sie liegen alle auf derselben
 *  Senkrechten, also ist die breiteste Stelle die Vorderkante -- einmal.
 *  `count` bleibt in der Signatur, damit ein Renderer, der eine eigene
 *  Anordnung baut, die Zahl weiterhin bekommt.
 */
const stackWidth = (gutter, count = 0) =>
  gutter + STACK.pad + STACK.width;

// ── Einrasten ─────────────────────────────────────────────

/** Auf das Raster, und in den Rahmen. `free` ist die Shift-Taste: sie
 *  schaltet das Raster ab, nicht die Grenzen -- ausserhalb des Rahmens
 *  ist kein Ort, an dem etwas liegen koennte. */
const snapTo = (value, frame = { min: 0, span: 1 }, free = false) => {
  const low = frame.min;
  const high = frame.min + frame.span;
  const clamped = Math.min(high, Math.max(low, value));
  if (free) return clamped;
  return Math.min(high, Math.max(low, Math.round(clamped / 0.02) * 0.02));
};

/** Pull a wall onto a neighbour's wall when one is within reach.
 *
 *  This is what makes a shared wall shared without anybody typing a
 *  number: you drag a room roughly against the next one, it lands
 *  exactly, and from then on the two walls are one. Falls back to the
 *  grid, so a room with no neighbour behaves exactly as it did before.
 */
const magnetTo = (value, candidates, frame, free = false, reachScale = 1) => {
  if (!free && candidates && candidates.length) {
    let best = null;
    let reach = SNAP_REACH * reachScale;
    for (const line of candidates) {
      const distance = Math.abs(line - value);
      if (distance <= reach) {
        reach = distance;
        best = line;
      }
    }
    if (best !== null) {
      return Math.min(frame.min + frame.span, Math.max(frame.min, best));
    }
  }
  return snapTo(value, frame, free);
};

/** Every wall of these rooms, split by axis -- what a dragged wall can
 *  land on. `outlines` are the other storeys' outer walls, so a wall can
 *  dock onto the flush of the building and not just onto its neighbours. */
const wallLinesOf = (areas, outlines = []) => {
  const lines = { x: [], y: [] };
  for (const area of areas) {
    const box = boxOf(area);
    lines.x.push(box.left, box.right);
    lines.y.push(box.top, box.bottom);
  }
  for (const box of outlines) {
    lines.x.push(box.x, box.x + box.width);
    lines.y.push(box.y, box.y + box.height);
  }
  return lines;
};

/** Welche fremden Konturen dieser Kasten gerade genau trifft.
 *
 *  Fuer die Rueckmeldung beim Ziehen: eingerastet und *fast* eingerastet
 *  sehen auf dem Schirm gleich aus.
 */
const flushWith = (rect, box) => {
  const same = (a, b) => Math.abs(a - b) <= JOIN_GAP;
  return (
    same(rect.left, box.x) || same(rect.right, box.x + box.width) ||
    same(rect.top, box.y) || same(rect.bottom, box.y + box.height)
  );
};

// ── Kamera ────────────────────────────────────────────────

// ── Maßketten ─────────────────────────────────────────────
//
// Eine Bauzeichnung sagt nicht nur, wo etwas steht, sondern wie breit es
// ist -- und zwar nicht als Zahl im Kasten, sondern als Kette unter dem
// Riss: Hilfslinien an jeder Wand, dazwischen ein Strich mit einem Maß
// darauf. Erst damit ist ein Grundriss etwas, mit dem man zum Baumarkt
// gehen kann.

/** Wie eine Maßkette im Bild liegt, in Bildeinheiten.
 *
 *  Die Kette haengt unter der Vorderkante der Etage, weil dort im Bild
 *  nichts ist -- ueber dem Riss laege sie auf der Rueckwand, und darin
 *  liegt schon die Beschriftung der Etage.
 */
const DIM = Object.freeze({
  // Abstand der ersten Kette von der Vorderkante, und der zweiten von
  // der ersten. Die zweite traegt das Gesamtmass.
  drop: 44,
  row: 34,
  // Laenge der schraegen Begrenzungsstriche und Abstand der Schrift
  // ueber der Kette.
  tick: 8,
  lift: 7,
  size: 13,
});

/** Ein Mass in Metern, wie es auf einer Kette steht.
 *
 *  Zwei Nachkommastellen, nicht eine wie sonst im Panel: Auf einer
 *  Masskette steht in einer Bauzeichnung immer der Zentimeter, und
 *  "3,0 m" liest sich als gerundet, wo "3,00 m" als gemessen gilt.
 *  Genau dieser Unterschied ist der Grund, warum jemand eine Kette
 *  einblendet.
 */
const dimension = (value) => `${value.toFixed(2).replace(".", ",")} m`;

/** Wo eine Masskette geteilt wird: an jeder Wand, die vorne ankommt.
 *
 *  Die linke und die rechte Kante jedes Raumes, dazu die zwei Kanten des
 *  Hauses. Zwei Waende, die dieselbe sind, sind eine Teilung -- sonst
 *  bekaeme jede geteilte Wand zwei Hilfslinien im Abstand eines
 *  Tausendstels und dazwischen ein Mass von null.
 *
 *  Alles ausserhalb des Hauses faellt weg. Ein Garten hat keine Wand,
 *  die vorne ankommt, und ein Mass, das im Rasen anfaengt, misst nichts.
 */
const dimensionStops = (areas, gap = JOIN_GAP) => {
  const edges = [0, 1];
  for (const area of Array.isArray(areas) ? areas : []) {
    if (!area || !area.position) continue;
    const box = boxOf(area);
    edges.push(box.left, box.right);
  }
  const sorted = edges
    .filter((x) => Number.isFinite(x) && x > -gap && x < 1 + gap)
    .map((x) => Math.min(1, Math.max(0, x)))
    .sort((a, b) => a - b);
  const stops = [];
  for (const x of sorted) {
    if (!stops.length || x - stops[stops.length - 1] > gap) stops.push(x);
  }
  return stops;
};

// ── Beschriftungen entzerren ──────────────────────────────
//
// Zwei Namen an derselben Stelle sind schlechter als einer: man liest
// keinen von beiden. In der Hausansicht passiert das staendig, weil der
// Name eines Geraetes unter seinem Punkt haengt und der Name des Raumes
// davor in dessen hinterem Drittel steht -- bei zwei Zimmerreihen
// uebereinander sind das ein paar Einheiten Abstand.
//
// Bisher gab es dagegen nur eine Pauschale: mehr als fuenf Geraete auf
// einer Ebene, und *alle* Namen verschwanden bis zum Darueberfahren.
// Das trifft auch die vier, die sich nie in die Quere gekommen waeren,
// und laesst bei fuenf Geraeten zwei uebereinander stehen.

/** Wie eine Beschriftung im Bild Platz braucht.
 *
 *  Geschaetzt, nicht gemessen: Im SVG steht kein Text, den man messen
 *  koennte, bevor er im Dokument haengt -- und die Zeichnung wird
 *  gebaut, bevor sie haengt. Ein Mittelwert je Zeichen ist fuer diese
 *  Frage genau genug: Es geht darum, ob zwei Namen aufeinanderliegen,
 *  und nicht darum, sie auf ein Pixel zu setzen.
 */
/** Der Raumname: Groesse, Untergrenze und die Luft zur Wand.
 *
 *  `size` steht auch in `panel-styles.js` -- das Entzerren braucht sie,
 *  bevor irgendetwas im Dokument haengt. Der Test darunter haelt beide
 *  zusammen. `pad` ist die Luft, die links und rechts zur Wand bleibt:
 *  ein Name, der die Wand beruehrt, liest sich als angeklebt.
 */
const ROOM_LABEL = Object.freeze({ size: 16, min: 10, pad: 6 });

const LABEL = Object.freeze({
  // Breite je Zeichen als Anteil der Schriftgroesse. 0.55 ist der grobe
  // Mittelwert einer Grotesk -- "iii" ist schmaler, "WWW" breiter, und
  // beides kommt in Raumnamen selten allein vor.
  perChar: 0.55,
  // Zeilenhoehe und Schrittweite, beides als Vielfaches der Groesse.
  // Der Schritt ist groesser als die Zeile, damit ein verschobener Name
  // nicht direkt an dem klebt, dem er ausgewichen ist.
  height: 1.4,
  step: 1.5,
  // Wie viele Zeilen nach oben und unten versucht werden. Danach ist
  // Wegblenden ehrlicher: ein Name drei Zeilen neben seinem Punkt
  // beschriftet nichts mehr, er behauptet nur noch etwas.
  tries: 3,
});

/** Der Kasten, den eine Beschriftung im Bild belegt.
 *
 *  `anchor` ist dasselbe wie `text-anchor` im SVG und muss dasselbe
 *  sagen: Der Etagenname ist rechtsbuendig gesetzt, und ein Kasten, der
 *  ihn mittig annimmt, liegt eine halbe Namenslaenge daneben -- das
 *  Entzerren wuerde dann gegen einen Platz pruefen, an dem nichts steht.
 */
/** Wie breit ein Raum auf einer bestimmten Hoehe ist.
 *
 *  Nicht die Breite des umschliessenden Rechtecks: Ein Raum mit
 *  abgeschraegter Ecke ist oben schmaler als unten, und ein Name, der
 *  gegen das Rechteck geprueft wurde, steht dann trotzdem im Freien.
 *  Geschnitten wird die Kontur mit der Waagerechten durch den Namen.
 */
const spanAt = (corners, y) => {
  let lo = Infinity;
  let hi = -Infinity;
  for (let index = 0; index < corners.length; index += 1) {
    const a = corners[index];
    const b = corners[(index + 1) % corners.length];
    if ((a.y <= y && b.y >= y) || (b.y <= y && a.y >= y)) {
      const along = b.y === a.y ? 0 : (y - a.y) / (b.y - a.y);
      const x = a.x + (b.x - a.x) * along;
      lo = Math.min(lo, x);
      hi = Math.max(hi, x);
    }
  }
  return hi > lo ? hi - lo : 0;
};

/** Welche Groesse ein Raumname **braucht**, damit er hineinpasst.
 *
 *  Nicht die, in der er gesetzt wird: Das entscheidet die Etage. Diese
 *  Funktion beantwortet nur die Frage fuer einen Raum, und der Aufrufer
 *  nimmt die kleinste Antwort seiner Etage fuer alle.
 *
 *  Denn eine Bauzeichnung setzt Raumnamen in **einer** Groesse. Je Raum
 *  gerechnet stand "Diele" in 16 px neben "Hauswirtschaftsraum" in 10 --
 *  angesehen liest sich das als Rangfolge zwischen den Raeumen, und die
 *  gibt es nicht. Der Massstab wird nach dem laengsten Namen gewaehlt,
 *  so wie am Zeichenbrett auch.
 *
 *  Die Alternative waere, den zu langen Namen wegzublenden, und ein Raum
 *  ohne Namen ist im Riss schlimmer als ein kleiner Name -- der Riss ist
 *  ja dafuer da.
 *
 *  Unter `ROOM_LABEL.min` wird nicht verkleinert. Was dort nicht mehr
 *  hineinpasst, steht ueber die Wand hinaus, und das ist die ehrlichere
 *  Auskunft: Der Raum ist zu schmal fuer seinen Namen. Eine Schrift, die
 *  weiter schrumpft, ist irgendwann keine Beschriftung mehr, sondern ein
 *  grauer Strich, der so tut als waere er eine.
 */
const roomLabelSize = (corners, text, scale, at) => {
  const span = spanAt(corners, at.y) - ROOM_LABEL.pad * 2;
  const natural =
    String(text || "").length * ROOM_LABEL.size * scale * LABEL.perChar;
  if (natural <= 0 || span <= 0 || natural <= span) return ROOM_LABEL.size;
  return Math.max(ROOM_LABEL.min, ROOM_LABEL.size * (span / natural));
};

const labelBox = (label, shift = 0) => {
  const size = (label.size || 16) * (label.scale || 1);
  const width = String(label.text || "").length * size * LABEL.perChar;
  const height = size * LABEL.height;
  const y = label.y + shift;
  const x0 = label.anchor === "end"
    ? label.x - width
    : label.anchor === "start"
    ? label.x
    : label.x - width / 2;
  return { x0, x1: x0 + width, y0: y - height / 2, y1: y + height / 2 };
};

const boxesOverlap = (a, b) =>
  a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;

/** Beschriftungen so verschieben, dass sie sich nicht mehr decken.
 *
 *  `fixed` heisst "diese steht, wo sie steht": ein Raumname gehoert in
 *  seinen Raum, und ihn zu verschieben hiesse, ihn ueber die Wand des
 *  Nachbarn zu schieben. Verschoben wird also, was beweglich ist, und
 *  das sind die Namen der Geraete -- die haengen ohnehin schon unter
 *  ihrem Punkt und nicht darin.
 *
 *  Abwechselnd nach unten und nach oben, in wachsendem Abstand. Nur nach
 *  unten waere eine Reihe von fuenf Geraeten am Ende eine Spalte, die
 *  aus dem Geschoss herauslaeuft.
 *
 *  Was keinen Platz findet, bekommt `hidden` -- und der Aufrufer blendet
 *  es weg, bis jemand darauf zeigt. Ein Name, der sich nirgendwo
 *  hinstellen kann, ist an *jeder* Stelle unlesbar.
 *
 *  Die Reihenfolge der Rueckgabe ist die der Eingabe, damit der Aufrufer
 *  sie neben seine eigene Liste legen kann.
 */
const declutter = (labels) => {
  const list = Array.isArray(labels) ? labels : [];
  const taken = [];
  const answer = new Array(list.length);

  // Die festen zuerst und vollstaendig: sonst weicht ein Geraetename
  // einem Raumnamen aus, der erst danach dazukommt.
  list.forEach((label, index) => {
    if (!label || !label.fixed) return;
    taken.push(labelBox(label));
    answer[index] = { shift: 0, hidden: false };
  });

  // Von oben nach unten, damit dasselbe Bild zweimal dasselbe Ergebnis
  // hat. Die Reihenfolge im Modell ist keine Reihenfolge.
  const movable = list
    .map((label, index) => ({ label, index }))
    .filter(({ label }) => label && !label.fixed)
    .sort((a, b) => a.label.y - b.label.y || a.index - b.index);

  for (const { label, index } of movable) {
    const size = (label.size || 16) * (label.scale || 1);
    const step = size * LABEL.step;
    let placed = null;
    for (let ring = 0; ring <= LABEL.tries && placed === null; ring += 1) {
      for (const shift of ring === 0 ? [0] : [ring * step, -ring * step]) {
        const box = labelBox(label, shift);
        if (!taken.some((other) => boxesOverlap(box, other))) {
          taken.push(box);
          placed = shift;
          break;
        }
      }
    }
    answer[index] = placed === null
      ? { shift: 0, hidden: true }
      : { shift: placed, hidden: false };
  }

  return answer;
};

/** Wie weit die Zeichnung in einer Achse verschoben werden darf.
 *
 *  Groesser als das Fenster: kein Spalt an beiden Enden, der Blick bleibt
 *  voll Plan. Kleiner: in der Mitte festgenagelt statt frei herumtreibend
 *  -- ein Haus in der Ecke eines breiten Monitors sieht aus wie ein
 *  Rendering-Unfall, und der Nutzer kann nichts dagegen tun.
 *
 *  `null` heisst "noch kein Layout" (erster Anstrich oder ein Test ohne
 *  DOM): dann ist Raten schlechter als Nichtstun.
 */
const panRange = (extent, size, zoom) => {
  if (!extent || !size) return null;
  const scaled = size * zoom;
  if (scaled >= extent) return [extent - scaled, 0];
  const middle = (extent - scaled) / 2;
  return [middle, middle];
};

/** Der Abstand zweier Finger. */
const touchSpan = (touches) =>
  Math.hypot(
    touches[0].clientX - touches[1].clientX,
    touches[0].clientY - touches[1].clientY,
  );

export {
  STACK,
  centreOf,
  insetOf,
  along,
  wallRuns,
  openingMarksOf,
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
  SOIL_HATCH_GAP,
  SOIL_HATCH_MAX,
  soilHatch,
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
  OPENING,
  openingKind,
  openingRun,
  openingsOn,
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
  LABEL,
  ROOM_LABEL,
  spanAt,
  roomLabelSize,
  labelBox,
  declutter,
  DIM,
  dimension,
  dimensionStops,
};
