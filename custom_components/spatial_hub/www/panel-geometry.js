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
  // Wie stark die Tiefe gestaucht wird. Eine Schraegansicht verkuerzt,
  // was vom Betrachter wegfuehrt -- ohne das waere der Grundriss ein
  // Grundriss von oben und nicht das Bild eines Hauses.
  //
  // Die Zahl ist der alte Festwert, rueckwaerts gerechnet: 250 Tiefe zu
  // 620 Breite bei einem Haus im Standardverhaeltnis 1,6 zu 1. Damit
  // sieht ein Haus, das nichts angibt, aus wie vorher -- und eines, das
  // sein Verhaeltnis kennt, endlich richtig.
  squash: 0.645,
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
  // Storeys sit slightly behind each other instead of exactly above.
  // Dead-aligned, the upper floor's outline lands on the lower one's and
  // the eye has nothing to separate them by except the gap; offset, each
  // storey shows its own corner and the stack reads as an exploded view
  // of one building.
  stagger: 34,
};

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

/** What is left of one wall once the doorways are taken out of it.
 *
 *  A list of `[from, to]` stretches along the edge, 0 at one corner and 1
 *  at the other. No doors means one stretch covering the whole wall, which
 *  is why everything that does not know about doors keeps working.
 *
 *  Overlapping doors are merged rather than drawn twice: two openings that
 *  touch are one opening, and a wall segment of negative length is not a
 *  thing a renderer should have to think about. Doors are sorted here and
 *  not trusted to arrive in order -- they are stored in the order the user
 *  added them, which is no order at all.
 */
const wallRuns = (doors, side) => {
  const holes = (Array.isArray(doors) ? doors : [])
    .filter((door) => door && Number(door.side) === side)
    .map((door) => {
      const width = Math.min(Math.max(Number(door.width) || 0, 0), 1);
      const at = Math.min(Math.max(Number(door.at), 0), 1);
      return [at - width / 2, at + width / 2];
    })
    .filter(([from, to]) => to > from)
    .sort((a, b) => a[0] - b[0]);

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

/** Der Schwenkbogen einer Tuer.
 *
 *  Das Zeichen, an dem ein Grundriss als Grundriss gelesen wird: Blatt und
 *  Bogen sagen, wo die Tuer haengt und wohin sie aufgeht. Eine Luecke
 *  allein sagt nur, dass die Wand dort aufhoert -- ein Durchgang und eine
 *  Tuer sehen dann gleich aus.
 *
 *  Der Bogen wird abgetastet und nicht als `A` geschrieben. Die Projektion
 *  schert das Bild, ein Kreis wird darin zur Ellipse in beliebiger Lage --
 *  und die schreibt man in SVG nur mit Halbachsen und Drehwinkel, die hier
 *  niemand hat. Punkte dagegen bilden sich einzeln ab und liegen immer
 *  richtig, weil die Abbildung affin ist.
 */
const SWING = { steps: 12 };

const swingsOf = (corners, doors, className, keep = () => true) => {
  const middle = centreOf(corners);
  return corners
    .map((corner, index) => {
      if (!keep(index)) return "";
      const next = corners[(index + 1) % corners.length];
      return (Array.isArray(doors) ? doors : [])
        .filter((door) => door && Number(door.side) === index)
        .map((door) => {
          const width = Math.min(Math.max(Number(door.width) || 0, 0), 1);
          const at = Math.min(Math.max(Number(door.at), 0), 1);
          const from = at - width / 2;
          const to = at + width / 2;
          if (!(to > from)) return "";
          // Das Band haengt an der Kante: Angel am einen Ende der
          // Oeffnung, geschlossen liegt das Blatt am anderen.
          const hinge = along(corner, next, from);
          const shut = along(corner, next, to);
          const leaf = { x: shut.x - hinge.x, y: shut.y - hinge.y };
          // Nach innen heisst zur Raummitte -- und zwar um genau die
          // Blattlaenge, sonst waere der Bogen keiner.
          const edge = along(corner, next, 0.5);
          const inward = { x: middle.x - edge.x, y: middle.y - edge.y };
          const reach = Math.hypot(inward.x, inward.y) || 1;
          const open = {
            x: (inward.x / reach) * Math.hypot(leaf.x, leaf.y),
            y: (inward.y / reach) * Math.hypot(leaf.x, leaf.y),
          };
          const arc = [];
          for (let step = 0; step <= SWING.steps; step += 1) {
            const angle = (step / SWING.steps) * (Math.PI / 2);
            arc.push(
              `${(hinge.x + leaf.x * Math.cos(angle) + open.x * Math.sin(angle)).toFixed(2)},` +
                `${(hinge.y + leaf.y * Math.cos(angle) + open.y * Math.sin(angle)).toFixed(2)}`,
            );
          }
          return (
            `<polyline class="${className}-arc" points="${arc.join(" ")}"/>` +
            `<line class="${className}-leaf" x1="${hinge.x.toFixed(2)}" y1="${hinge.y.toFixed(2)}" ` +
            `x2="${(hinge.x + open.x).toFixed(2)}" y2="${(hinge.y + open.y).toFixed(2)}"/>`
          );
        })
        .join("");
    })
    .join("");
};

/** Fenster: eine Oeffnung, durch die man nicht geht.
 *
 *  Gezeichnet wie in jeder Bauzeichnung -- die Mauer laeuft duenner
 *  weiter, und in ihrer Mitte steht die Scheibe als Linie. Eine Tuer
 *  unterbricht die Wand, ein Fenster fuellt sie anders: waeren beide nur
 *  Luecken, saehe eine Kuechenzeile aus wie eine offene Hauswand.
 */
const windowsOf = (corners, windows, thickness, className, keep = () => true) => {
  const inner = insetOf(corners, thickness);
  return corners
    .map((corner, index) => {
      if (!keep(index)) return "";
      const next = (index + 1) % corners.length;
      return (Array.isArray(windows) ? windows : [])
        .filter((hole) => hole && Number(hole.side) === index)
        .map((hole) => {
          const width = Math.min(Math.max(Number(hole.width) || 0, 0), 1);
          const at = Math.min(Math.max(Number(hole.at), 0), 1);
          const from = at - width / 2;
          const to = at + width / 2;
          if (!(to > from)) return "";
          const outerA = along(corners[index], corners[next], from);
          const outerB = along(corners[index], corners[next], to);
          const innerA = along(inner[index], inner[next], from);
          const innerB = along(inner[index], inner[next], to);
          const glassA = along(outerA, innerA, 0.5);
          const glassB = along(outerB, innerB, 0.5);
          return (
            `<polygon class="${className}-frame" points="${outerA.x},${outerA.y} ` +
            `${outerB.x},${outerB.y} ${innerB.x},${innerB.y} ${innerA.x},${innerA.y}"/>` +
            `<line class="${className}-glass" x1="${glassA.x.toFixed(2)}" ` +
            `y1="${glassA.y.toFixed(2)}" x2="${glassB.x.toFixed(2)}" ` +
            `y2="${glassB.y.toFixed(2)}"/>`
          );
        })
        .join("");
    })
    .join("");
};

/** Die Bruestung unter einem Fenster.
 *
 *  Ohne sie ist ein Fenster eine Luecke wie eine Tuer: die Wandflaeche
 *  hoert auf, und man sieht durch das Haus hindurch. Ein Fenster hat aber
 *  unten Mauerwerk -- das ist der Unterschied zwischen einem Fenster und
 *  einem Loch, und in einer Zeichnung aus lauter Linien der einzige.
 */
const sillsOf = (corners, windows, rise, className, keep = () => true) =>
  corners
    .map((corner, index) => {
      if (!keep(index)) return "";
      const next = corners[(index + 1) % corners.length];
      return (Array.isArray(windows) ? windows : [])
        .filter((hole) => hole && Number(hole.side) === index)
        .map((hole) => {
          const width = Math.min(Math.max(Number(hole.width) || 0, 0), 1);
          const at = Math.min(Math.max(Number(hole.at), 0), 1);
          const from = at - width / 2;
          const to = at + width / 2;
          if (!(to > from)) return "";
          const start = along(corner, next, Math.max(0, from));
          const end = along(corner, next, Math.min(1, to));
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
/** Das Seitenverhaeltnis einer Etage: wie viel breiter das Haus ist als
 *  tief. Eine Zahl, an der zwei Rechnungen haengen -- die Tiefe der
 *  Zeichnung und jede Laengenangabe in y --, also steht sie an einer
 *  Stelle. */
const ASPECT = 1.6;

const aspectOf = (floor) => {
  const value = Number(floor && floor.aspect);
  return Number.isFinite(value) && value > 0 ? value : ASPECT;
};

/** Eine Strecke quer zum Haus, in Metern. */
const metresAcross = (units, floor) => units * houseMetres(floor);

/** Eine Strecke in die Tiefe, in Metern.
 *
 *  Und *nicht* dieselbe Rechnung wie quer. Das Haus ist in beiden Achsen
 *  eine Einheit gross, aber nur in x ist eine Einheit die ganze
 *  Hausbreite -- in y ist sie die Tiefe, und die ist um das
 *  Seitenverhaeltnis kuerzer.
 *
 *  Genau das stand lange falsch im Bild: die Tiefe eines Zimmers wurde
 *  mit der Hausbreite multipliziert, als waere das Haus quadratisch. Bei
 *  einem Haus im Standardverhaeltnis war damit jede Tiefenangabe um
 *  sechzig Prozent zu gross -- ein Zimmer, an dem "4,0 x 3,0 m" stand,
 *  war in Wirklichkeit 4,0 x 1,9 m. Die Zeichnung selbst war immer
 *  richtig; nur die Zahlen daneben logen.
 */
const metresDeep = (units, floor) =>
  (units * houseMetres(floor)) / aspectOf(floor);

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
  // Sky gets the same room as garden. A cloud belongs *around* the house,
  // not squeezed into its footprint -- the internet is not a room on the
  // second floor, and a plane exactly as wide as the walls says it is.
  const wide = floor && (floor.has_outdoor || floor.virtual);
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

/** The outline every virtual area is drawn in.
 *
 *  Stretched to whatever the area's box is, so a wide VPN and a small
 *  cloud are the same shape at different sizes rather than two shapes.
 *  `preserveAspectRatio="none"` is the point: it is a label for "this is
 *  not a room", not a picture of a cloud that has to stay round.
 */
const CLOUD_PATH = "M26 52 C12 52 5 44 5 35 C5 26 12 19 21 19 " +
  "C24 9 33 3 43 3 C56 3 66 12 68 24 C79 24 88 30 88 39 " +
  "C88 47 80 52 70 52 Z";

const CLOUD_SVG = `<svg class="cloud" viewBox="0 0 100 60"
  preserveAspectRatio="none" aria-hidden="true"><path d="${CLOUD_PATH}"/></svg>`;

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

/** Die Endpunkte einer Kastenkante im Grundriss.
 *
 *  In der Reihenfolge von RECTANGLE: oben laeuft nach rechts, rechts nach
 *  unten, unten nach links, links nach oben. Das ist dieselbe Ordnung, in
 *  der die Waende gezeichnet werden -- eine zweite Zaehlweise waere eine
 *  zweite Wahrheit.
 */
const edgeOf = (area, side) => {
  const box = boxOf(area);
  const corners = [
    [{ x: box.left, y: box.top }, { x: box.right, y: box.top }],
    [{ x: box.right, y: box.top }, { x: box.right, y: box.bottom }],
    [{ x: box.right, y: box.bottom }, { x: box.left, y: box.bottom }],
    [{ x: box.left, y: box.bottom }, { x: box.left, y: box.top }],
  ];
  return corners[side] || corners[0];
};

/** Eine Oeffnung des Nachbarn, auf die eigene Kante umgerechnet.
 *
 *  Zwei Raeume teilen sich eine Wand, aber nur einer zeichnet sie -- sonst
 *  stuenden dort zwei Waende. Die Tuer des anderen verschwand damit
 *  spurlos: sie war in einer Wand eingetragen, die niemand malt. Eine Tuer
 *  gehoert aber der Wand und nicht dem Raum, der sie eingetragen hat.
 *
 *  Gerechnet wird ueber den Grundriss und nicht ueber die Anteile: die
 *  beiden Kanten sind gleich lang nur im Glueckfall, und sie laufen
 *  gegeneinander -- die rechte Kante des einen Raumes zeigt nach unten,
 *  die linke des anderen nach oben. Anteile direkt zu uebernehmen haette
 *  jede Tuer gespiegelt.
 */
const mapOpening = (from, sideFrom, to, sideTo, opening) => {
  const source = edgeOf(from, sideFrom);
  const target = edgeOf(to, sideTo);
  const width = Math.min(Math.max(Number(opening.width) || 0, 0), 1);
  const at = Math.min(Math.max(Number(opening.at), 0), 1);
  const span = {
    x: target[1].x - target[0].x,
    y: target[1].y - target[0].y,
  };
  const length = span.x * span.x + span.y * span.y;
  if (!length) return null;
  // Punkt auf der fremden Kante -> Anteil auf der eigenen. Beide liegen
  // aufeinander, also genuegt die Projektion auf die eigene Richtung.
  const share = (share_) => {
    const point = along(source[0], source[1], share_);
    return (
      ((point.x - target[0].x) * span.x + (point.y - target[0].y) * span.y) /
      length
    );
  };
  const one = share(at - width / 2);
  const two = share(at + width / 2);
  const low = Math.max(0, Math.min(one, two));
  const high = Math.min(1, Math.max(one, two));
  if (!(high > low)) return null;
  return { ...opening, side: sideTo, at: (low + high) / 2, width: high - low };
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

/** Die Fenster eines Raumes -- dieselbe Buchhaltung wie bei den Tueren.
 *
 *  Bewusst eine eigene Liste und kein Feld "art" an der Tuer: eine Tuer
 *  hat eine Angel und einen Bogen, ein Fenster hat eine Bruestung. Was
 *  verschieden gezeichnet wird, verschieden zu speichern erspart jeder
 *  Stelle im Bild die Frage, was das Ding gerade ist.
 */
const windowsOfArea = (area, sides = 4) =>
  (Array.isArray(area && area.windows) ? area.windows : []).filter((hole) => {
    const side = Number(hole && hole.side);
    return (
      Number.isInteger(side) && side >= 0 && side < sides &&
      Number.isFinite(Number(hole.at)) && Number(hole.width) > 0
    );
  });

/** Alles, was die stehende Wand unterbricht. Die Wandflaeche kennt nur
 *  "hier ist Mauer, hier nicht" -- ob wegen einer Tuer oder eines
 *  Fensters, entscheidet erst, was darueber gezeichnet wird. */
const openingsOf = (area, sides = 4) => [
  ...doorsOf(area, sides),
  ...windowsOfArea(area, sides),
];

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

/** Eine Treppe: Stufen, Wangen, Laufrichtung.
 *
 *  Vorher nur die Stufen -- quer liegende Striche in einem leeren
 *  Rechteck, die genauso gut eine Schraffur sein konnten. Was eine Treppe
 *  daraus macht, sind die beiden Wangen daneben und der Pfeil, der sagt,
 *  wohin es hinaufgeht. Beides steht in jeder Bauzeichnung und kostet
 *  drei Linien.
 *
 *  `lift` hebt alles auf Hoehe der Mauerkrone: die vordere Wandflaeche
 *  eines Raumes ist undurchsichtig und deckt sonst zu, was auf der
 *  Bodenplatte liegt -- die Stufen waren gezeichnet und trotzdem nicht zu
 *  sehen.
 */
const stairsOf = ({ project, x0, y0, width, height, lift = 0 }, treads = 9) => {
  const alongX = width >= height;
  const at = (x, y) => {
    const point = project(x, y);
    return { x: point.x, y: point.y - lift };
  };
  const point = (x, y) => {
    const spot = at(x, y);
    return `${spot.x.toFixed(2)},${spot.y.toFixed(2)}`;
  };
  // Ein Rand ringsum: eine Treppe fuellt ihren Raum nicht bis an die
  // Wand, sie steht darin.
  const inset = 0.08;
  const left = x0 + width * inset;
  const right = x0 + width * (1 - inset);
  const top = y0 + height * inset;
  const bottom = y0 + height * (1 - inset);
  let out = `<polygon class="stair-run" points="${point(left, top)} ` +
    `${point(right, top)} ${point(right, bottom)} ${point(left, bottom)}"/>`;
  for (let step = 1; step < treads; step += 1) {
    const along_ = step / treads;
    const [from, to] = alongX
      ? [point(left + (right - left) * along_, top),
         point(left + (right - left) * along_, bottom)]
      : [point(left, top + (bottom - top) * along_),
         point(right, top + (bottom - top) * along_)];
    out += `<polyline class="tread" points="${from} ${to}"/>`;
  }
  // Die Laufrichtung: eine Linie mitten durch den Lauf, mit einer Spitze
  // am oberen Ende. Ohne sie sagt die Zeichnung nicht, ob man hinauf oder
  // hinunter geht -- und das ist bei einer Treppe die einzige Frage.
  const midA = alongX
    ? { x: left, y: (top + bottom) / 2 }
    : { x: (left + right) / 2, y: bottom };
  const midB = alongX
    ? { x: right, y: (top + bottom) / 2 }
    : { x: (left + right) / 2, y: top };
  const head = at(midB.x, midB.y);
  const tail = at(midA.x, midA.y);
  const back = { x: head.x - tail.x, y: head.y - tail.y };
  const reach = Math.hypot(back.x, back.y) || 1;
  const barb = 9;
  const wing = { x: (-back.y / reach) * barb * 0.6, y: (back.x / reach) * barb * 0.6 };
  const foot = {
    x: head.x - (back.x / reach) * barb,
    y: head.y - (back.y / reach) * barb,
  };
  out += `<line class="stair-way" x1="${tail.x.toFixed(2)}" y1="${tail.y.toFixed(2)}" ` +
    `x2="${head.x.toFixed(2)}" y2="${head.y.toFixed(2)}"/>` +
    `<polyline class="stair-way" points="${(foot.x + wing.x).toFixed(2)},` +
    `${(foot.y + wing.y).toFixed(2)} ${head.x.toFixed(2)},${head.y.toFixed(2)} ` +
    `${(foot.x - wing.x).toFixed(2)},${(foot.y - wing.y).toFixed(2)}"/>`;
  return out;
};

/** Der Belag eines Balkons: ein Raster aus Fugen.
 *
 *  Ein Balkon ist sonst eine leere Flaeche mit einem Gelaender darum, und
 *  eine leere Flaeche sieht aus wie ein Loch im Bild. Der Belag sagt, dass
 *  man darauf steht. Die Fugen laufen im Grundriss und werden projiziert,
 *  also stehen sie in der Flucht wie alles andere auch.
 */
const deckingOf = ({ project, x0, y0, width, height }, spacing = 0.055) => {
  const step = Math.max(spacing, 0.02);
  const lines = [];
  const point = (x, y) => {
    const spot = project(x, y);
    return `${spot.x.toFixed(2)},${spot.y.toFixed(2)}`;
  };
  for (let at = step; at < width; at += step) {
    lines.push(`<polyline class="deck-seam" points="${point(x0 + at, y0)} ` +
      `${point(x0 + at, y0 + height)}"/>`);
  }
  for (let at = step; at < height; at += step) {
    lines.push(`<polyline class="deck-seam" points="${point(x0, y0 + at)} ` +
      `${point(x0 + width, y0 + at)}"/>`);
  }
  return lines.join("");
};

// ── Der Stapel: wo eine Etage im Bild landet ──────────────
//
// Bisher steckte das in der Panel-Klasse, und `tools/shots.mjs` musste
// `_project` ueberschreiben, um an dieselbe Rechnung zu kommen. Eine
// Projektion, die man nur mit einem Custom Element in der Hand ausrechnen
// kann, ist keine Geometrie mehr, sondern ein Nebeneffekt.

/** How far above the storeys a plane floats.
 *
 *  Only the sky floats, and it has to clear the top storey by more than
 *  a storey's own depth, or a cloud plane reads as an attic with weather
 *  painted on the ceiling.
 */
const planeLift = (floor, depth = STACK.depth) =>
  (floor && floor.virtual ? depth * 0.5 + 130 : 0);

/** Headroom for the sky, added to everything so the lift pushes the
 *  clouds up *within* the drawing instead of off the top of it. */
const skyOf = (floors, depth = STACK.depth) =>
  Math.max(0, ...(floors || []).map((floor) => planeLift(floor, depth)));

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
/** Wie tief die Zeichnung wird -- aus dem Haus, nicht aus einer Konstante.
 *
 *  Vorher stand hier eine feste Zahl, und damit war jedes Haus im Bild
 *  gleich tief: ein langgestrecktes Reihenhaus wurde zum Quadrat gestaucht,
 *  ein tiefer Bungalow in die Breite gezogen. Ein Zimmer, das im Grundriss
 *  quadratisch ist, kam als Rechteck heraus -- und das ist keine
 *  Ansichtssache, das ist falsch.
 *
 *  Die Rechnung: das Haus ist in x eine Einheit breit und `aspect` mal so
 *  breit wie tief, also ist eine Einheit y um `aspect` kuerzer als eine
 *  Einheit x. Der Rahmen kann in beiden Achsen mehr zeigen als das Haus
 *  (Garten), deshalb stehen `span` und `spanY` mit darin.
 */
/** Der Abstand zwischen zwei Etagen -- aus der Tiefe, nicht aus einer
 *  Konstante. Bei einem flachen, breiten Haus schwebten die Stockwerke
 *  sonst weit auseinander: die Luft dazwischen war fast doppelt so hoch
 *  wie eine Etage tief, und der Stapel las sich als drei Zeichnungen
 *  untereinander statt als ein Haus. Das Verhaeltnis ist das alte (340 zu
 *  250), damit ein Haus im Standardverhaeltnis aussieht wie bisher. */
const gapOf = (depth) => depth * (STACK.gap / STACK.depth);

const depthOf = (frame, floor) =>
  ((STACK.width * spanY(frame)) / (frame.span * aspectOf(floor))) *
  STACK.squash;

const projectOnto = ({ frame, gutter, floors, index, depth }, x, y) => {
  const nx = (x - frame.min) / frame.span;
  const ny = (y - minY(frame)) / spanY(frame);
  const shrink = STACK.back + (1 - STACK.back) * ny;
  const deep = Number.isFinite(depth) && depth > 0 ? depth : STACK.depth;
  return {
    x: gutter + STACK.stagger * index +
      STACK.width / 2 + (nx - 0.5) * STACK.width * shrink,
    y: STACK.top + skyOf(floors, deep) + index * gapOf(deep) + ny * deep -
      planeLift((floors || [])[index], deep),
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
const stackHeight = (floors, depth = STACK.depth) =>
  STACK.top + skyOf(floors, depth) +
  Math.max(0, (floors || []).length - 1) * gapOf(depth) +
  depth + STACK.slab + STACK.pad;

/** How wide the drawing has to be. Every storey is offset a little
 *  further right than the one above it, so the bottom one decides. */
const stackWidth = (gutter, count) =>
  gutter + STACK.pad + STACK.width + Math.max(0, count - 1) * STACK.stagger;

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
  capsOf,
  wallsOf,
  swingsOf,
  windowsOf,
  sillsOf,
  stairsOf,
  deckingOf,
  FRONT_WALL,
  BACK_WALL,
  houseMetres,
  ASPECT,
  aspectOf,
  metresAcross,
  metresDeep,
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
  edgeOf,
  mapOpening,
  joinsOf,
  drawsTheWall,
  AREA_KIND,
  kindOf,
  fold,
  doorsOf,
  windowsOfArea,
  openingsOf,
  SIDE_NAMES,
  sideName,
  STAIR_WORDS,
  isStairs,
  planeLift,
  skyOf,
  depthOf,
  gapOf,
  projectOnto,
  stackHeight,
  stackWidth,
  snapTo,
  magnetTo,
  wallLinesOf,
  flushWith,
  panRange,
  touchSpan,
};
