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

const DOMAIN = "spatial_hub";

/** Fallback edge colours by the shared quality vocabulary. The hub's
 *  theme wins where it states one; these are what "inherit" means. */
/** Home Assistant's own variables, preferred over the hub's fallback when
 *  running inside it: they follow whatever theme the user already chose.
 *  Keyed by the shared vocabulary, never by a provider's private word. */
const HA_COLOURS = {
  online: "var(--success-color, #4caf50)",
  offline: "var(--error-color, #f44336)",
  unknown: "var(--disabled-text-color, #9e9e9e)",
  good: "var(--success-color, #4caf50)",
  fair: "var(--warning-color, #ff9800)",
  poor: "var(--error-color, #f44336)",
};

/** The stacked view: every floor at once, which is the only view in which
 *  a connection between two storeys is visible at all. Per-floor tabs stay
 *  for detail and for arranging -- dragging in a sheared projection would
 *  be guesswork. */
const ALL_FLOORS = "__all__";

// The shear that turns a flat plan into a storey seen from the side. Not
// a true isometric projection: rooms stay rectangles-in-parallel, which
// keeps them recognisable as the same rooms from the detail view.
const STACK = {
  // "pad" ist links breiter als noetig, und zwar mit Absicht: dort steht
  // der Etagenname. Vorher lag er bei 40 halb ausserhalb des Bildes.
  pad: 40, margin: 150, width: 620, depth: 220, skew: 50, top: 50, gap: 340,
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

const escapeHtml = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (char) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        char
      ],
  );

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
  }

  get _canEdit() {
    return Boolean(this._hass && this._hass.user && this._hass.user.is_admin);
  }

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
      this._unsubscribe = await this._hass.connection.subscribeMessage(
        () => this._refresh(),
        { type: `${DOMAIN}/subscribe` },
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
      this._model = await this._hass.callWS({ type: `${DOMAIN}/model` });
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
      this._diagnostics = await this._hass.callWS({
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
      await this._hass.callWS({
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
      const done = await this._hass.callWS({
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
      await this._hass.callWS({
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

  /** How far above the storeys a plane floats.
   *
   *  Only the sky floats, and it has to clear the top storey by more than
   *  a storey's own depth, or a cloud plane reads as an attic with weather
   *  painted on the ceiling.
   */
  _planeLift(floorIndex) {
    const floor = this._stackFloors[floorIndex];
    return floor && floor.virtual ? STACK.depth * 0.5 + 130 : 0;
  }

  /** Where a point on a given floor lands in the stacked drawing.
   *
   *  Coordinates outside 0..1 are not an error -- that is the garden --
   *  so the whole window is mapped rather than the house alone.
   */
  _project(floorIndex, x, y) {
    const frame = this._frame;
    const nx = (x - frame.min) / frame.span;
    const ny = (y - minY(frame)) / spanY(frame);
    // Headroom for the sky, added to everything so the lift pushes the
    // clouds up *within* the drawing instead of off the top of it.
    const sky = Math.max(
      0,
      ...this._stackFloors.map((_floor, at) => this._planeLift(at)),
    );
    // Ein Stapel. Immer.
    //
    // Es gab hier einmal zwei Spalten, damit ein hoher schmaler Turm auf
    // einem breiten Monitor nicht links und rechts die Flaeche leer
    // laesst. Das hat den freien Platz gefuellt und dafuer das Bild
    // zerstoert: vier Etagen wurden zu vier Platten in einem Raster, und
    // ein Raster ist kein Haus. Ein Sandwich hat eine Achse, sonst ist es
    // keins -- man liest oben-nach-unten als Stockwerke, nebeneinander
    // liest man als zwei Gebaeude. Leerer Rand ist der guenstigere Preis;
    // dagegen hilft der Zoom, nicht das Umbrechen.
    return {
      x: STACK.margin + STACK.stagger * floorIndex +
        nx * STACK.width + (1 - ny) * STACK.skew,
      y: STACK.top + sky + floorIndex * STACK.gap + ny * STACK.depth -
        this._planeLift(floorIndex),
    };
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
    const sky = Math.max(0, ...this._stackFloors.map((_f, at) => this._planeLift(at)));
    return (
      STACK.top + sky +
      Math.max(0, this._stackFloors.length - 1) * STACK.gap +
      STACK.depth + STACK.slab + STACK.pad
    );
  }

  /** How wide the drawing has to be. Every storey is offset a little
   *  further right than the one above it, so the bottom one decides. */
  get _stackWidth() {
    return (
      STACK.margin + STACK.pad + STACK.width + STACK.skew +
      Math.max(0, this._stackFloors.length - 1) * STACK.stagger
    );
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
  _providerOpacity(itemId) {
    const owner = this._providerOf(itemId);
    const mine = ((this._model && this._model.layers) || []).filter(
      (layer) => (layer.provider_id || "") === owner &&
                 layer.visible !== false,
    );
    if (!mine.length) return 1;
    return mine.reduce(
      (best, layer) =>
        Math.max(best, typeof layer.opacity === "number" ? layer.opacity : 1),
      0,
    );
  }

  /** The theme the hub resolved. Never a preset table of our own -- a
   *  second renderer must be able to agree with this one for free. */
  get _theme() {
    return (this._model && this._model.theme) || {};
  }

  /** A colour for one word of the shared vocabulary.
   *
   *  Order: what the theme says, then what Home Assistant's own theme says
   *  for the words it has an opinion about, then the hub's resolved
   *  fallback. That last step is why `on` and `off` are coloured at all:
   *  keeping a private table here meant every word the hub learned needed
   *  a change in every renderer, which is exactly what resolving themes in
   *  the hub was supposed to stop.
   */
  _vocabularyColour(group, word, spare) {
    const themed = (this._theme[group] || {})[word];
    if (themed) return themed;
    if (HA_COLOURS[word]) return HA_COLOURS[word];
    const fallback = (this._theme.fallback || {})[group] || {};
    return fallback[word] || spare;
  }

  _stateColour(state) {
    return this._vocabularyColour(
      "state_colors", state,
      "var(--fp-accent, var(--primary-color, #03a9f4))",
    );
  }

  _qualityColour(quality) {
    return this._vocabularyColour(
      "quality_colors", quality,
      "var(--disabled-text-color, #9e9e9e)",
    );
  }

  /** Theme values a renderer cannot express in CSS alone. */
  get _themeVars() {
    const theme = this._theme;
    const parts = [];
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
  }

  _providerOf(itemId) {
    return String(itemId || "").split(":")[0];
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
    const sets = (this._model && this._model.icon_sets) || {};
    const set = sets[this._providerOf(node.id)];
    return (set && set[node.icon]) || null;
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
    const along = (extent, size) => {
      // No layout yet (first paint, or a headless test): nothing to clamp
      // against, and guessing would be worse than leaving it alone.
      if (!extent || !size) return null;
      const scaled = size * view.zoom;
      if (scaled >= extent) {
        return [extent - scaled, 0]; // bigger than the window: no gap at either end
      }
      // Smaller than the window: pinned to the middle rather than allowed
      // to roam. A house drawn at 55 % in the top-left corner of a wide
      // monitor looks like a rendering accident, and there is nothing for
      // the user to do about it -- there is no direction left to drag.
      const middle = (extent - scaled) / 2;
      return [middle, middle];
    };
    const clamp = (value, range) =>
      range === null ? value : Math.min(range[1], Math.max(range[0], value));

    view.x = clamp(
      view.x,
      along(viewport.clientWidth, canvas.offsetWidth),
    );
    view.y = clamp(
      view.y,
      along(viewport.clientHeight, canvas.offsetHeight),
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
    return Math.hypot(
      touches[0].clientX - touches[1].clientX,
      touches[0].clientY - touches[1].clientY,
    );
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
      const label = {
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
             })"><text class="storey-name">${escapeHtml(
               String(floor.name || "").toLocaleUpperCase("de"),
             )}</text></g>
        </g>`;
      }
      // The storey is a floor slab, not a sheet of paper: a thin band of
      // edge under it is the difference between four drawings above each
      // other and four floors of one house.
      // The outer wall is split around the rooms on purpose: the two walls
      // facing the viewer are drawn after them and hide their lower edge,
      // which is what puts the rooms *inside* the house instead of on top
      // of a slab shaped like one.
      const house = corners(at, 0, 1);
      const crown = house.map((corner) => ({ x: corner.x, y: corner.y - STACK.rise }));
      return `<g class="plane">
        ${apron}
        ${wallsOf(house, -STACK.slab, "storey-side")}
        <polygon class="storey" points="${outline(at, 0, 1)}"/>
        ${wallsOf(house, STACK.rise, "shell-face", BACK_WALL)}
        ${rooms}
        ${wallsOf(house, STACK.rise, "shell-face", FRONT_WALL)}
        ${capsOf(crown, STACK.outerWall, "shell-cap")}
        <g data-at-x="${label.x}" data-at-y="${label.y}"
           transform="translate(${label.x},${label.y}) scale(${
             this._counterScale
           })"><text class="storey-name">${escapeHtml(
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

  _roomPolygon(plane, area, keep = () => true) {
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
      .map(([x, y]) => this._project(plane, x, y));
    const points = corners.map((point) => `${point.x},${point.y}`).join(" ");
    // The room's name in the middle of the room, the way a floor plan has
    // always labelled a room. Hung off the corner it landed on the wall it
    // shared with the next room, and two names on one line is neither.
    const label = centreOf(corners);

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
    const floor = this._stackFloors[plane];
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
        const point = this._project(plane, x, y);
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
      // The plan is skewed, so the cloud is skewed with it: two edges of
      // the projected room are the axes it is drawn along.
      const origin = this._project(plane, x0, y0);
      const alongX = this._project(plane, x0 + width, y0);
      const alongY = this._project(plane, x0, y0 + height);
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
           this._counterScale
         })"><text class="room-label">${escapeHtml(area.name)}</text></g>`;
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
    const nodes = this._visibleNodes;
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
        ${nodes.map((node) => this._nodeHtml(node)).join("")}
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
    if (this._corners) return this._cornerHandlesHtml(area);
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
  _cornerHandlesHtml(area) {
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
  }

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
    const custom = this._customIcon(node);
    return (
      node.color ||
      (custom && custom.default_color) ||
      this._stateColour(node.state)
    );
  }

  /** What to draw when nobody said anything.
   *
   *  Home Assistant's icon comes with the node, and a provider's own icon
   *  set beats even that -- an integration keeps its face on the plan. This
   *  is only the last step of the chain, and it is deliberately still an
   *  icon rather than a dot: a dot says nothing about what the thing is.
   */
  _genericIcon(node) {
    const provider = ((this._model && this._model.providers) || []).find(
      (candidate) => candidate.id === this._providerOf(node.id),
    );
    return (provider && provider.icon) || "mdi:shape-outline";
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
        ${this._doorsHtml(area)}
      </div>`;
  }

  /** Die Tueren eines Raumes, zum Anlegen und Wegnehmen.
   *
   *  Nur fuer Raeume: ein Garten hat keine Waende, in die eine Luecke
   *  passen koennte, und die Wolke erst recht nicht.
   */
  _doorsHtml(area) {
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
  }

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
    this._hass
      .callWS({ type: `${DOMAIN}/layout/reset`, section, key })
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
        this._facets = await this._hass.callWS({
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

    const canAct = this._hass.user && this._hass.user.is_admin;
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
                     ? this._sparklineHtml(this._history)
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

  _sparklineHtml(series) {
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
    const low = frame.min;
    const high = frame.min + frame.span;
    const clamped = Math.min(high, Math.max(low, value));
    if (event.shiftKey) return clamped;
    return Math.min(high, Math.max(low, Math.round(clamped / 0.02) * 0.02));
  }

  /** Every other room's walls on this floor, split by axis.
   *
   *  What a dragged wall can land on. The room being dragged is left out,
   *  or it would snap to itself and never move again.
   */
  _wallLines(exceptId) {
    const lines = { x: [], y: [] };
    for (const area of this._visibleAreas) {
      if (area.id === exceptId || !joinable(area)) continue;
      if (this._floor && area.floor_id !== this._floor.id) continue;
      const box = boxOf(area);
      lines.x.push(box.left, box.right);
      lines.y.push(box.top, box.bottom);
    }
    // Und die Aussenkanten der anderen Etagen, damit eine Wand nicht nur
    // an ihre Nachbarn andocken kann, sondern auch an die Flucht des
    // Hauses. Das ist der Sinn der Konturen: sehen, wo die Wand darunter
    // verlaeuft -- und dann nicht danebentreffen.
    //
    // Nur wenn sie auch zu sehen sind. Ein Magnet an einer Linie, die
    // niemand sieht, ist kein Einrasten, sondern ein Ruckeln ohne Grund;
    // derselbe Knopf, der die Konturen einblendet, macht sie anziehend.
    if (this._ghosts) {
      for (const floor of this._ghostFloors()) {
        const box = floor.outline;
        lines.x.push(box.x, box.x + box.width);
        lines.y.push(box.y, box.y + box.height);
      }
    }
    return lines;
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
    const same = (a, b) => Math.abs(a - b) <= JOIN_GAP;
    return this._ghostFloors()
      .filter((floor) => {
        const box = floor.outline;
        return (
          same(rect.left, box.x) || same(rect.right, box.x + box.width) ||
          same(rect.top, box.y) || same(rect.bottom, box.y + box.height)
        );
      })
      .map((floor) => floor.id);
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
    if (!event.shiftKey && lines) {
      let best = null;
      let reach = SNAP_REACH;
      for (const line of lines[axis]) {
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
    return this._snap(value, event, frame);
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
    const grip = find("data-resize-area");
    const areaElement = find("data-area");
    const nodeElement = find("data-node");
    const anyGrip = plotGrip || cornerGrip;
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
        await this._hass.callWS({
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

    const zoom = hit("data-zoom");
    if (zoom) {
      const how = zoom.getAttribute("data-zoom");
      if (how === "fit") this._fitToScreen();
      else this._zoomBy(how === "in" ? ZOOM.step : 1 / ZOOM.step);
      return;
    }

    if (hit("data-toggle-corners")) {
      this._corners = !this._corners;
      this._render();
      return;
    }

    if (hit("data-toggle-plot")) {
      this._togglePlot();
      return;
    }

    const editWhat = hit("data-edit-what");
    if (editWhat) {
      this._editWhat = editWhat.getAttribute("data-edit-what");
      // Ecken sind Räume-Werkzeug. Wer zu den Geräten wechselt, will
      // keine Anfasser mehr sehen, auch nicht die von vorhin.
      if (this._editWhat !== "rooms") this._corners = false;
      this._selected = null;
      this._render();
      return;
    }

    const plotScale = hit("data-plot-scale");
    if (plotScale) {
      this._scalePlot(Number(plotScale.getAttribute("data-plot-scale")));
      return;
    }

    if (hit("data-toggle-meters")) {
      this._meters = !this._meters;
      this._render();
      return;
    }

    const plotDrop = hit("data-plot-drop");
    if (plotDrop) {
      this._dropPlotCorner(Number(plotDrop.getAttribute("data-plot-drop")));
      return;
    }

    const plotCorner = hit("data-plot-index");
    if (plotCorner && (event.altKey || event.metaKey)) {
      this._dropPlotCorner(Number(plotCorner.getAttribute("data-plot-index")));
      return;
    }

    const plotAdder = hit("data-plot-add");
    if (plotAdder) {
      this._addPlotCorner(Number(plotAdder.getAttribute("data-plot-add")));
      return;
    }

    const cornerDrop = hit("data-corner-drop");
    if (cornerDrop) {
      this._dropCorner(
        cornerDrop.getAttribute("data-corner-drop"),
        Number(cornerDrop.getAttribute("data-corner-index")),
      );
      return;
    }

    const corner = hit("data-corner-area");
    if (corner && (event.altKey || event.metaKey)) {
      this._dropCorner(
        corner.getAttribute("data-corner-area"),
        Number(corner.getAttribute("data-corner-index")),
      );
      return;
    }

    const adder = hit("data-corner-add");
    if (adder) {
      this._addCorner(
        adder.getAttribute("data-corner-add"),
        Number(adder.getAttribute("data-corner-index")),
      );
      return;
    }

    if (hit("data-toggle-ghosts")) {
      this._ghosts = !this._ghosts;
      this._render();
      return;
    }

    if (hit("data-legend")) {
      this._legendOpen = !this._legendOpen;
      this._render();
      return;
    }

    if (hit("data-bars")) {
      this._toggleBars();
      return;
    }

    if (hit("data-undo")) {
      this._undoStep();
      return;
    }
    if (hit("data-redo")) {
      this._redoStep();
      return;
    }

    const areaDialog = hit("data-area-dialog");
    if (areaDialog) {
      this._areaDialog = areaDialog.getAttribute("data-area-dialog");
      this._render();
      return;
    }

    if (hit("data-close-area")) {
      this._areaDialog = null;
      this._render();
      return;
    }

    const areaKind = hit("data-area-kind");
    if (areaKind && this._areaDialog) {
      this._setAreaKind(
        (this._model.areas || []).find(
          (candidate) => candidate.id === this._areaDialog,
        ),
        areaKind.getAttribute("data-area-kind"),
      );
      return;
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
      return;
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
      return;
    }

    const navigate = hit("data-navigate");
    if (navigate) {
      // Home Assistant's own navigation event: it keeps the app state, so
      // the user's way back to the floor plan is the browser's back button.
      this.dispatchEvent(
        new CustomEvent("hass-navigate", {
          detail: { path: navigate.getAttribute("data-navigate") },
          bubbles: true,
          composed: true,
        }),
      );
      if (window.history && window.history.pushState) {
        window.history.pushState(null, "", navigate.getAttribute("data-navigate"));
        window.dispatchEvent(new CustomEvent("location-changed"));
      }
      return;
    }

    const settings = hit("data-settings");
    if (settings) {
      // The more-info dialog is the door to an entity's settings, and it
      // opens over the floor plan instead of navigating away from it.
      this.dispatchEvent(
        new CustomEvent("hass-more-info", {
          detail: { entityId: settings.getAttribute("data-settings"),
                    view: "settings" },
          bubbles: true,
          composed: true,
        }),
      );
      return;
    }

    if (hit("data-toggle-entities")) {
      this._showEntities = !this._showEntities;
      this._render();
      return;
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
      return;
    }

    const floorButton = hit("data-floor");
    if (floorButton) {
      this._floorId = floorButton.getAttribute("data-floor");
      this._selected = null;
      this._render();
      return;
    }

    if (hit("data-toggle-edit")) {
      this._edit = !this._edit;
      this._placing = null;
      this._selected = null;
      this._floorDialog = false;
      this._render();
      return;
    }

    const newLayer = hit("data-new-layer");
    const editLayer = hit("data-edit-layer");
    if (newLayer || editLayer) {
      this._openLayerDialog(
        editLayer ? editLayer.getAttribute("data-edit-layer") : null,
      );
      return;
    }

    if (hit("data-close-layer")) {
      this._layerDialog = null;
      this._render();
      return;
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
      return;
    }

    if (hit("data-save-layer")) {
      this._saveLayer();
      return;
    }

    if (hit("data-delete-layer")) {
      this._deleteLayer();
      return;
    }

    if (hit("data-theme-dialog")) {
      this._themeDialog = true;
      this._render();
      return;
    }

    if (hit("data-close-theme")) {
      this._themeDialog = false;
      this._render();
      return;
    }

    const preset = hit("data-preset");
    if (preset) {
      // Only the preset: anything else would overrule what it decided.
      this._setLayout("settings", "view", {
        theme: { preset: preset.getAttribute("data-preset") },
      });
      return;
    }

    if (hit("data-reset-theme")) {
      this._themeDialog = false;
      this._hass
        .callWS({ type: `${DOMAIN}/layout/reset`, section: "settings", key: "view" })
        .then(() => this._refresh())
        .catch(() => this._refresh());
      return;
    }

    if (hit("data-floor-dialog")) {
      this._floorDialog = true;
      this._render();
      return;
    }

    if (hit("data-close-floor")) {
      this._floorDialog = false;
      this._render();
      return;
    }

    if (hit("data-clear-background")) {
      if (this._floor) this._setLayout("floors", this._floor.id, { background: null });
      this._floorDialog = false;
      return;
    }

    if (hit("data-reset-floor")) {
      this._resetFloor();
      return;
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
      return;
    }

    if (hit("data-undo-move")) {
      this._undoMove();
      return;
    }

    const joinMark = hit("data-join-area");
    if (joinMark) {
      this._toggleJoin(
        joinMark.getAttribute("data-join-area"),
        joinMark.getAttribute("data-join-other"),
      );
      return;
    }

    const hideArea = hit("data-hide-area");
    if (hideArea) {
      this._setLayout("areas", hideArea.getAttribute("data-hide-area"), {
        hidden: true,
      });
      return;
    }

    const showArea = hit("data-show-area");
    if (showArea) {
      this._setLayout("areas", showArea.getAttribute("data-show-area"), {
        hidden: null,
      });
      return;
    }

    const hideNode = hit("data-hide-node");
    if (hideNode) {
      this._selected = null;
      this._setLayout("nodes", hideNode.getAttribute("data-hide-node"), {
        hidden: true,
      });
      return;
    }

    const showNode = hit("data-show-node");
    if (showNode) {
      this._setLayout("nodes", showNode.getAttribute("data-show-node"), {
        hidden: null,
      });
      return;
    }

    const resetItem = hit("data-reset-item");
    if (resetItem) {
      this._selected = null;
      this._resetItem("nodes", resetItem.getAttribute("data-reset-item"));
      return;
    }

    const toggle = hit("data-toggle");
    if (toggle) {
      this._showDiagnostics = !this._showDiagnostics;
      if (this._showDiagnostics) {
        this._loadDiagnostics().then(() => this._render());
      } else {
        this._render();
      }
      return;
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
      return;
    }

    const placeArea = hit("data-place-area");
    if (placeArea) {
      const key = placeArea.getAttribute("data-place-area");
      this._placing =
        this._placing && this._placing.key === key
          ? null
          : { section: "areas", key };
      this._render();
      return;
    }

    if (hit("data-cancel-place")) {
      this._placing = null;
      this._render();
      return;
    }

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
      return;
    }

    if (hit("data-close")) {
      this._selected = null;
      this._history = null;
      this._render();
      return;
    }

    const moreInfo = hit("data-more-info");
    if (moreInfo) {
      this.dispatchEvent(
        new CustomEvent("hass-more-info", {
          detail: { entityId: moreInfo.getAttribute("data-more-info") },
          bubbles: true,
          composed: true,
        }),
      );
      return;
    }

    if (hit("data-history")) {
      this._loadHistory();
      return;
    }

    const actionButton = hit("data-action");
    if (actionButton) {
      this._runAction(
        actionButton.getAttribute("data-action"),
        actionButton.getAttribute("data-confirm") === "1",
      );
      return;
    }

    const nodeButton = hit("data-node");
    if (nodeButton) {
      this._select("node", nodeButton.getAttribute("data-node"));
      return;
    }

    const edgeLine = hit("data-edge");
    if (edgeLine) {
      this._select("edge", edgeLine.getAttribute("data-edge"));
    }
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
      const response = await this._hass.callWS({
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
      await this._hass.callWS({
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

const STYLES = `
:host { display:block; height:100%; background:var(--primary-background-color,#f5f5f5); }
.app { display:flex; flex-direction:column; height:100%; color:var(--primary-text-color,#212121);
       font-family:var(--paper-font-body1_-_font-family, Roboto, sans-serif); }
/* Auf dem Telefon ist der Grundriss der Bildschirm.
 *
 * "100dvh" und nicht "100vh": die Adressleiste eines mobilen Browsers
 * faehrt beim Scrollen ein und aus, und "vh" rechnet mit der Hoehe ohne
 * sie -- der Plan waere immer ein Stueck laenger als das Fenster, also
 * genau die Leiste zurueck, die weg sollte. Fuer Browser ohne dvh steht
 * die alte Einheit als Rueckfall darueber. */
.app.phone { height:100vh; height:100dvh; }
/* Vollbild heisst randlos: kein Innenabstand, keine Karte, keine
 * Schatten. Was hier noch Platz kostet, kostet ihn am Haus. */
.app.phone .body { padding:0; gap:0; overflow:hidden; position:relative; }
.app.phone main { flex:1 1 auto; min-height:0; display:flex; }
.app.phone .viewport { max-height:none; height:100%; width:100%;
                       border-radius:0; }
.app.phone .stage, .app.phone .stack { border-radius:0; box-shadow:none; }
/* Die Kopfzeile ist im Vollbild nicht schmaler, sondern weg -- und mit
 * ihr die Etagenreiter. Deshalb bleibt der eine Knopf, der sie
 * zurueckholt, immer sichtbar. */
.bars-btn { position:absolute; top:8px; left:8px; z-index:6; border:0;
            border-radius:50%; padding:8px; cursor:pointer; display:flex;
            color:var(--primary-text-color,#212121);
            background:var(--card-background-color,#fff);
            box-shadow:var(--ha-card-box-shadow,0 1px 3px rgba(0,0,0,.3));
            opacity:.85; }
.bars-btn:active { opacity:1; }
header { display:flex; align-items:center; gap:8px; padding:8px 12px;
         background:var(--fp-accent, var(--app-header-background-color, var(--primary-color,#03a9f4)));
         color:var(--app-header-text-color,#fff);
         /* Umbrechen statt zerdruecken. Suche, Zoom und die
            Werkzeugknoepfe geben keine Breite her, die Reiterleiste
            schon -- auf einem Telefon schrumpfte sie deshalb auf null
            und die Kopfzeile begann mit dem Suchfeld: die Etagen waren
            nicht versteckt, sie waren null Pixel breit. Jetzt weichen
            sie in eine eigene Zeile aus. */
         flex-wrap:wrap; row-gap:8px; }
/* Ein Haus mit zwölf Etagen darf die Kopfzeile nicht in vier Zeilen
   umbrechen: die Reiter blieben sonst nicht dort, wo der Nutzer sie
   zuletzt gesehen hat, und der Grundriss darunter würde bei jedem
   Etagenwechsel springen. Also eine Zeile, und bei Bedarf seitlich
   scrollbar -- die Leiste wird schmaler, nie höher. */
/* "flex:1 1 auto" statt "0 1 auto": die Leiste nimmt sich den freien Platz
   selbst, statt ihn dem Abstandshalter zu überlassen und danach auf zwei
   Reiter zusammenzuschrumpfen. Bei sieben Etagen auf einem schmalen
   Fenster lagen die letzten sonst unerreichbar unter dem Suchfeld. */
/* "1 1 220px" statt "1 1 auto": die Leiste darf schmaler werden, aber
   nicht schmaler als eine Etage breit ist. Passen 220px und die Werkzeuge
   nicht nebeneinander, bricht die Zeile -- und zwar an einer Breite, die
   sich aus dem Platz ergibt, nicht aus einer geratenen Bildschirmgroesse.
   Ein Panel neben offener Seitenleiste ist genauso schmal wie ein Telefon
   und hatte dasselbe Problem. */
.tabs { display:flex; gap:4px; flex-wrap:nowrap; overflow-x:auto;
        min-width:0; flex:1 1 220px; scrollbar-width:none;
        overscroll-behavior-x:contain; order:-1; }
.tabs::-webkit-scrollbar { display:none; }
.tab { display:flex; align-items:center; gap:6px; border:0; border-radius:16px;
       padding:6px 14px; cursor:pointer; font:inherit; color:inherit;
       background:rgba(255,255,255,.15);
       /* Reiter geben keine Breite her: ein auf drei Buchstaben
          gequetschtes "Dachgeschoss" ist kein Reiter mehr. */
       flex:0 0 auto; white-space:nowrap; }
.tab.on { background:rgba(255,255,255,.85); color:var(--primary-color,#03a9f4); }
.spacer { flex:0 1 0; min-width:0; }
/* Auf einem schmalen Bildschirm gewinnt kein Werkzeug gegen die Etagen.
   Eine einzige Zeile bedeutet dort, dass Suche und Zoom die Reiterleiste
   zusammendrücken, bis die letzten Etagen unter dem Suchfeld liegen und
   nicht mehr erreichbar sind. Ab hier bekommen die Reiter deshalb eine
   eigene Zeile -- die oberste, weil "welche Etage" die erste Frage ist
   und alles andere Werkzeug dazu. */
/* Sobald die Reiter eine eigene Zeile haben, sollen sie die ganze
   nehmen -- eine halbe Zeile Etagen neben halb leerem Platz waere
   Verschnitt. Der Abstandshalter schiebt die Werkzeuge nach rechts. */
@media (max-width: 760px) {
  .tabs { flex:1 0 100%; }
  .spacer { flex:1 1 auto; }
  .search input { width:88px; }
}
@media (max-width: 420px) {
  /* Noch schmaler: das Suchfeld schrumpft auf die Lupe und wächst erst
     wieder, wenn jemand hineintippt. Ein Zoomknopf, der nicht mehr auf
     den Schirm passt, ist schlimmer als ein kurzes Suchfeld. */
  .search input { width:0; padding:0; }
  .search:focus-within input { width:110px; }
}
.icon-btn { border:0; background:transparent; color:inherit; cursor:pointer;
            border-radius:50%; padding:6px; display:flex; }
.icon-btn.on { background:rgba(255,255,255,.25); }
/* Ebenen und Provider stehen unter dem Grundriss, nicht daneben: der Plan
   ist das Einzige, was Breite wirklich braucht. */
.body { flex:1; display:flex; flex-direction:column; gap:16px; padding:16px; overflow:auto; }
/* "flex:1" hat den Plan oben festgenagelt und die Legende ans untere
   Ende geschoben -- auf einem 22:9-Telefon lagen 381 leere Pixel
   dazwischen. Der Plan ist quadratisch und damit von der Breite
   begrenzt; die uebrige Hoehe gehoert deshalb nicht in die Mitte,
   sondern hinter alles. Jetzt steht die Legende direkt unter dem
   Grundriss, egal wie hoch der Bildschirm ist. */
main { flex:0 0 auto; min-width:0; }
/* Eingeklappt: erst das Haus, dann die Erklärung dazu. */
.legend-toggle { display:flex; align-items:center; gap:6px; border:0;
                 background:transparent; color:var(--secondary-text-color,#727272);
                 font:inherit; cursor:pointer; padding:4px 0; border-radius:8px; }
.legend-toggle:hover { color:var(--primary-text-color,#212121); }
/* Im Hochformat ist die Höhe knapp und der Plan ist das, wofür man
   gekommen ist. Eine Legende, die unbegrenzt mitwächst, schiebt ihn aus
   dem sichtbaren Bereich -- also bekommt sie hier ein Dach und rollt
   selbst, statt die ganze Seite zu rollen. */
@media (orientation: portrait) {
  .legend.open { max-height:38vh; overflow-y:auto; -webkit-overflow-scrolling:touch; }
}
/* Auf dem Telefon liegt die Legende ueber dem Plan statt darunter.
 *
 * Darunter hiesse: der Plan wird kuerzer, sobald jemand nachsieht,
 * welche Ebene was zeichnet -- und beim Einrichten eines Raumes ist das
 * genau der falsche Moment, um Flaeche zu verlieren. Als Blatt kostet
 * sie nichts, solange sie zu ist, und laesst sich mit dem Daumen wieder
 * wegschieben, ohne den kleinen Schalter treffen zu muessen. */
.app.phone .legend { position:absolute; left:0; right:0; bottom:0; z-index:5;
                     background:var(--card-background-color,#fff);
                     border-radius:16px 16px 0 0;
                     box-shadow:0 -2px 12px rgba(0,0,0,.22);
                     padding:0 8px 8px;
                     transition:transform .18s ease-out; }
.app.phone .legend.open { max-height:60dvh; overflow-y:auto;
                          -webkit-overflow-scrolling:touch; }
/* Zu heisst zu: nur die Zeile mit dem Schalter, der Rest ist Plan. */
.app.phone .legend:not(.open) { box-shadow:none;
                                background:var(--card-background-color,#fff); }
.app.phone .legend .dock { box-shadow:none; border-radius:0; padding:0 8px 8px; }
.app.phone .legend-toggle { padding:8px 4px; }
/* Der Griff. Breit genug fuer einen Daumen, schmal genug, um nicht wie
   ein Knopf auszusehen -- er tut ja nichts, wenn man nur tippt.
   Sichtbar sind 5px, zu treffen sind 33: der Innenabstand gehoert zur
   Flaeche, gemalt wird nur der Inhalt ("background-clip:content-box").
   Ein Griff, den man verfehlt, ist schlimmer als gar keiner. */
.grab { display:block; margin:0 auto; width:44px; height:5px;
        padding:14px 0; box-sizing:content-box; background-clip:content-box;
        border-radius:3px; background-color:var(--divider-color,#d0d0d0);
        cursor:grab; touch-action:none; }
.grab:active { cursor:grabbing; }
.dock { display:flex; flex-wrap:wrap; gap:24px; align-items:flex-start;
        background:var(--card-background-color,#fff); border-radius:12px;
        padding:4px 16px 14px; box-shadow:var(--ha-card-box-shadow,0 1px 3px rgba(0,0,0,.12)); }
.dock-col { flex:1 1 240px; min-width:0; }
.provider-group { margin:6px 0 10px; }
.provider-head { display:flex; align-items:center; gap:6px; font-size:13px; }
.entities { list-style:none; margin:8px 0 0; padding:0; max-height:200px; overflow:auto; }
.entities li { display:flex; justify-content:space-between; gap:8px; padding:3px 0;
               font-size:13px; border-top:1px solid var(--divider-color,#e0e0e0); }
.links { display:flex; flex-wrap:wrap; gap:6px; margin:10px 0 4px; }
.links .chip { display:flex; align-items:center; gap:4px; font-size:13px; }
/* Suche und Zoom geben keine Breite her -- die Reiterleiste scrollt. */
.search { display:flex; align-items:center; gap:4px; background:rgba(255,255,255,.18);
          border-radius:16px; padding:2px 10px; flex:0 0 auto; }
.search input { border:0; background:transparent; color:inherit; font:inherit;
                width:120px; outline:none; }
.search input::placeholder { color:inherit; opacity:.7; }
.zoom { display:flex; align-items:center; gap:2px; font-size:12px; flex:0 0 auto; }
.icon-btn[disabled] { opacity:.4; cursor:default; }

/* The camera. Transform only, so panning never rebuilds the plan. */
/* Der Grundriss ist quadratisch, ein Bildschirm ist es nicht. Ohne Deckel
   ragt das Haus auf einem 16:9-Monitor unten aus dem Fenster und die
   Ansicht wirkt wie im Hochformat. */
.viewport { overflow:hidden; touch-action:none; border-radius:12px;
            max-height:calc(100vh - 200px); }
/* Kein "will-change:transform": das befördert die Fläche auf eine eigene
   Ebene, die einmal gerastert und danach nur noch als Bitmap vergrößert
   wird -- beim Hineinzoomen werden die Icons dadurch unscharf statt neu
   gezeichnet. Chromium tut das konsequent, Firefox nicht, daher sah es
   auf dem einen Rechner scharf und auf dem anderen matschig aus. */
/* Untergrenze, Obergrenze, Mitte. Die Zeichnung skaliert mit der Breite
   des Fensters, und ohne Untergrenze wurde aus einem schmalen Fenster ein
   noch schmalerer Turm: der Grundriss schrumpfte weiter, obwohl die
   Kamera ohnehin schieben und zoomen kann. Unter 560px wird jetzt nicht
   mehr gequetscht, sondern geschoben. */
/* Kein "margin-inline:auto". Zentriert wird die Zeichnung von der
   Kamera: ist sie kleiner als das Fenster, setzt "_clampView" sie in die
   Mitte. Beides zusammen zentriert zweimal -- einmal die Box im Fenster
   (halber Rest der *ungezoomten* Breite) und einmal den Inhalt per
   translate (halber Rest der *gezoomten*) -- und die Summe schob den
   Grundriss auf einem breiten Bildschirm in die rechte Haelfte, immer
   wieder, weil jeder Klick neu klemmt. Eine Zentrierung genuegt, und die
   der Kamera ist die, die auch beim Zoomen noch stimmt. */
.canvas { transform-origin:0 0; width:clamp(560px, 100%, 1280px); }

.stack { background:var(--fp-surface, var(--card-background-color,#fff));
         border-radius:12px; box-shadow:var(--ha-card-box-shadow,0 1px 3px rgba(0,0,0,.12));
         padding:8px; }
.stack svg { display:block; width:100%; height:auto; }
/* Es gibt keinen Gebäudekörper mehr, der über allen Etagen liegt. Weder
   durchscheinende Wände noch ein Dach noch Eckpfosten: alles davon lag
   über dem Grundriss, und der ist der Grund, warum jemand hinschaut. Was
   das Haus zusammenhält, sind jetzt die Wände der Etagen selbst. */
/* Drei Gewichte, damit das Auge sofort sortiert: die Aussenkante des
   Stockwerks am staerksten, die Innenwaende leiser, der Garten nur
   gestrichelt. Vorher hatte alles dieselbe Staerke -- deshalb war das
   Sandwich ein Brei. */
/* Bodenplatte: fast schwarz, eine helle Kante darum. Eine Bauzeichnung
   fuellt nichts -- was die Etage traegt, ist die Linie. */
.storey { fill:var(--fp-slab, var(--fp-surface, var(--card-background-color,#fff)));
          fill-opacity:var(--fp-slab-opacity, .92);
          stroke:var(--fp-house-line, currentColor);
          stroke-opacity:calc(.75 * var(--fp-house,1));
          stroke-width:calc(1.6px * var(--fp-house,1));
          vector-effect:non-scaling-stroke; }
/* Die Kante unter dem Stockwerk. Sie traegt die Etage, deshalb ist sie
   etwas dunkler als die Flaeche darueber. */
.storey-side { fill:var(--fp-slab-side, var(--fp-surface, var(--card-background-color,#fff)));
               stroke:var(--fp-house-line, currentColor);
               stroke-opacity:calc(.6 * var(--fp-house,1));
               stroke-width:calc(1.2px * var(--fp-house,1));
               vector-effect:non-scaling-stroke; }
/* Der Etagenname steht im linken Rand, gross und ruhig, auf Hoehe der
   Etage -- das Erste, was man in einer Schnittzeichnung liest. Vorher
   klebte er bei .65 Deckkraft an der Plattenkante und wurde vom Rand des
   Bildes abgeschnitten, weil links kein Rand war. */
.storey-name { font-size:30px; fill:var(--fp-ink, currentColor); opacity:.8;
               letter-spacing:.1em; text-anchor:end; }
.stack-cloud { fill:var(--fp-virtual, rgba(120,144,180,.16));
               stroke:var(--fp-virtual-line, rgba(120,144,180,.7));
               stroke-width:1.5; vector-effect:non-scaling-stroke;
               stroke-dasharray:7 5; }
/* Innenwaende. Vorher eine Andeutung, die auf einem hellen Hintergrund
   praktisch verschwand -- und damit war das Haus im Sandwich eine leere
   Platte mit Punkten darauf. Jetzt eine Wand: sichtbar, aber immer noch
   leiser als die Aussenwand, die sie umschliesst. Der Regler bewegt
   beide, damit das Verhaeltnis stimmt. */
/* Der Boden im Raum bleibt der Hintergrund. Eine Fuellung hier war der
   Grund, warum sich sechzehn Raeume zu einer grauen Flaeche addierten. */
.stack .room { fill:none; stroke:none; }
/* Stehende Waende: die Aussenseite. Gefuellt, damit sie einander wirklich
   verdecken -- eine Wand, durch die man den Raum dahinter sieht, ist
   keine. Deckend, nicht durchscheinend, sonst summieren sich sechzehn
   Waende zu Grau. */
.room-wall { fill:var(--fp-wall, var(--fp-surface, var(--card-background-color,#fff)));
             stroke:var(--fp-shell-line, currentColor);
             stroke-width:calc(1.1px * var(--fp-house,1));
             stroke-opacity:calc(.8 * var(--fp-house,1));
             stroke-linejoin:round;
             vector-effect:non-scaling-stroke; }
/* Die Mauerkrone: das Band zwischen Aussen- und Innenkante. Das ist der
   Unterschied zwischen einem Grundriss und einem Rechteck mit Strich
   drumherum -- eine Wand hat zwei Seiten, und genau die sieht man hier. */
.room-cap { fill:var(--fp-wall-top, var(--fp-surface, var(--card-background-color,#fff)));
            stroke:var(--fp-shell-line, currentColor);
            stroke-width:calc(1.1px * var(--fp-house,1));
            stroke-opacity:calc(.95 * var(--fp-house,1));
            stroke-linejoin:round;
            vector-effect:non-scaling-stroke; }
/* Die Marke auf einer gemeinsamen Wand. Rotes × trennt, gruenes + fuegt
   wieder zusammen -- ohne das + waere das Trennen eine Entscheidung, die
   niemand zuruecknehmen kann. Sie sitzt mittig auf der Wand, die sie
   meint, und ist so gross, dass ein Daumen sie trifft. */
.join-mark { position:absolute; width:22px; height:22px; border-radius:50%;
             border:none; cursor:pointer; padding:0; z-index:5;
             font:600 15px/22px system-ui, sans-serif; color:#fff;
             box-shadow:0 1px 3px rgba(0,0,0,.4); }
.join-mark.on { background:var(--error-color,#db4437); }
.join-mark.off { background:var(--success-color,#43a047); }
.join-mark.top { left:50%; top:0; transform:translate(-50%,-50%); }
.join-mark.bottom { left:50%; top:100%; transform:translate(-50%,-50%); }
.join-mark.left { left:0; top:50%; transform:translate(-50%,-50%); }
.join-mark.right { left:100%; top:50%; transform:translate(-50%,-50%); }
/* Mauerwerk ist hier Darstellung, kein Bedienelement: ein Punkt, der
   halb unter einer Wand liegt, muss trotzdem das sein, was der Klick
   trifft. */
.room-wall, .room-cap, .shell-face, .shell-cap, .storey-side {
  pointer-events:none; }
/* Die Aussenwand traegt das Haus und ist deshalb staerker als die
   Zwischenwaende -- dasselbe, was eine Bauzeichnung auf Papier macht. */
.shell-face { fill:var(--fp-wall, var(--fp-surface, var(--card-background-color,#fff)));
              stroke:var(--fp-house-line, currentColor);
              stroke-opacity:calc(.85 * var(--fp-house,1));
              stroke-width:calc(1.4px * var(--fp-house,1));
              stroke-linejoin:round;
              vector-effect:non-scaling-stroke; }
.shell-cap { fill:var(--fp-wall-top, var(--fp-surface, var(--card-background-color,#fff)));
             stroke:var(--fp-house-line, currentColor);
             stroke-opacity:var(--fp-house,1);
             stroke-width:calc(1.6px * var(--fp-house,1));
             stroke-linejoin:round;
             vector-effect:non-scaling-stroke; }
/* Raumnamen wie in einer Bauzeichnung: Versalien, gesperrt, ruhig. Bei
   .55 Deckkraft standen sie auf dem dunklen Boden praktisch nicht da --
   ein Grundriss, dessen Raeume man nicht lesen kann, ist ein Muster. */
.stack .room-label { font-size:16px; fill:var(--fp-ink, currentColor);
                     opacity:.92; letter-spacing:.06em;
                     text-anchor:middle; dominant-baseline:middle; }
/* Ein Balkon ist kein Zimmer: die Deckflaeche bekommt einen eigenen Ton
   statt der Zimmerfarbe, das Gelaender bleibt niedrig. */
.stack .room.deck { fill:var(--fp-deck, var(--fp-house-line, currentColor));
                     fill-opacity:.08; stroke:var(--fp-house-line, currentColor);
                     stroke-opacity:.55; stroke-dasharray:2 3;
                     vector-effect:non-scaling-stroke; }
.doors { display:flex; flex-direction:column; gap:6px; margin:6px 0; }
.door { display:flex; align-items:center; gap:10px; flex-wrap:wrap; }
.door-side { min-width:5.5em; font-weight:600; }
.door-slide { display:flex; align-items:center; gap:6px; flex:1 1 8em; }
.door-slide input[type=range] { flex:1 1 auto; min-width:0; }
/* Stufen: leichter als eine Wand, sonst liest sich die Treppe als Raster. */
.tread { fill:none; stroke:var(--fp-house-line, currentColor);
         stroke-opacity:.75; stroke-width:1px;
         vector-effect:non-scaling-stroke; }
.deck-rail { fill:var(--fp-surface, var(--card-background-color,#fff));
             stroke:var(--fp-house-line, currentColor); stroke-opacity:.7;
             stroke-width:1px; vector-effect:non-scaling-stroke; }
.stack-edge { stroke-linecap:round; opacity:var(--layer-opacity,1); }
/* A connection between two storeys is the whole reason this view exists. */
.stack-edge.across { opacity:calc(var(--layer-opacity,1) * .95); }
/* Ebenen-Deckkraft und die Abblendung der Suche multiplizieren sich,
   statt sich gegenseitig zu überschreiben. */
/* Die Gegenskalierung sitzt im transform-Attribut, siehe
   _holdStackIconSize -- hier steht bewusst kein scale. */
.stack-node { cursor:pointer; opacity:var(--layer-opacity,1); }
.stack-node circle { stroke:var(--card-background-color,#fff); stroke-width:2; }
.stack-node.on circle { stroke:var(--fp-accent, var(--primary-color,#03a9f4)); stroke-width:4; }
.stack-node.floorless circle { stroke-dasharray:3 2; }
.stack-label { font-size:18px; fill:currentColor; text-anchor:middle; }
/* Nineteen labels on one storey is a smear, not information. On a crowded
   plane they appear on hover and for the selected node -- the dot is still
   there, and clicking it still says what it is. */
.stack-node.crowded .stack-label { opacity:0; transition:opacity .12s; }
.stack-node.crowded:hover .stack-label,
.stack-node.crowded.on .stack-label { opacity:1; }
.stack-icon { color:#fff; pointer-events:none; overflow:visible; }
.stack-icon ha-icon { --mdc-icon-size:22px; color:#fff; }
/* Das mitgelieferte Provider-SVG bringt keine Größe mit. Im HTML-Kontext
   des foreignObject greift diese hier zuverlässig. */
.stack-icon .custom-icon { display:block; width:22px; height:22px; }
.stack-icon .custom-icon svg { width:22px; height:22px; display:block; fill:#fff; }
/* Der Garten ist der Ring ums Erdgeschoss, keine eigene Etage. */
.apron { fill:var(--fp-outdoor, rgba(76,175,80,.10));
         stroke:var(--fp-outdoor-line, rgba(76,175,80,.45));
         stroke-width:2; stroke-dasharray:12 8; }
.plane.virtual .storey { stroke-dasharray:14 10; opacity:.7; }
/* Die Suche blendet nicht aus, sie stellt zurück: der Rest bleibt sichtbar. */
.stack-node.dimmed { opacity:calc(var(--layer-opacity,1) * .25); }
.stack-node.found circle { stroke:var(--fp-accent, var(--primary-color,#03a9f4));
                           stroke-width:4; }

.stage { position:relative; width:100%;
         background:var(--fp-surface, var(--card-background-color,#fff));
         border-radius:12px; background-size:cover; background-position:center;
         box-shadow:var(--ha-card-box-shadow,0 1px 3px rgba(0,0,0,.12)); overflow:hidden; }
.stage.placing { cursor:crosshair; outline:2px dashed var(--primary-color,#03a9f4); }
.edges { position:absolute; inset:0; width:100%; height:100%; pointer-events:none; }
.edge { pointer-events:stroke; cursor:pointer;
        opacity:calc(var(--layer-opacity,1) * .85); }
.edge.on { opacity:var(--layer-opacity,1); stroke-width:5; }
.edge.animated { stroke-dasharray:8 6; animation:flow 1.2s linear infinite; }
@keyframes flow { to { stroke-dashoffset:-28; } }

/* Die Außenwände der anderen Etagen: eine Linie, kein Raum. Nicht
   anklickbar, nicht im Weg -- nur da, damit man sieht, wo das Haus
   darunter aufhört. */
.ghost { position:absolute; pointer-events:none; border-radius:4px;
         border:2px dashed var(--fp-ghost, rgba(128,128,128,.55));
         background:transparent; }
/* Getroffen: aus der Linie, an der man sich orientiert, wird kurz die
   Linie, auf der man steht. Durchgezogen statt gestrichelt, weil ein
   eingerasteter Zustand kein Vorschlag mehr ist. */
.ghost.flush { border-style:solid;
               border-color:var(--primary-color,#03a9f4);
               box-shadow:0 0 0 3px rgba(3,169,244,.14); }
.ghost.flush .ghost-name { color:var(--primary-color,#03a9f4); }
.ghost-name { position:absolute; top:-9px; left:8px; padding:0 4px;
              font-size:10px; letter-spacing:.04em; text-transform:uppercase;
              color:var(--secondary-text-color,#727272);
              background:var(--fp-surface, var(--card-background-color,#fff)); }

.area { position:absolute; transform:translate(-50%,-50%);
        border:1px dashed var(--divider-color,#e0e0e0); border-radius:10px;
        background:var(--secondary-background-color,#fafafa); opacity:.7; }
/* Ein Raum mit eigener Kontur: der Kasten selbst wird unsichtbar, die
   Fläche darin übernimmt Rahmen und Hintergrund und wird auf das Polygon
   beschnitten. Der Kasten bleibt, was er war -- er wird gezogen, an acht
   Wänden verändert und in der Sandwich-Ansicht projiziert; nur sieht man
   ihn nicht mehr. Beschnitte man den Kasten, wären auch seine eigenen
   Griffe weg. */
/* Das Grundstück: die Grenze um Haus und Garten. Home Assistant weiß
   nichts davon -- es kennt Räume, und ein Raum ist im Gebäude. Deshalb
   wird es gezeichnet und nicht abgeleitet, liegt unter allem anderen und
   ist erst da, wenn jemand es angelegt hat. */
.plot { position:absolute; inset:0; z-index:0; pointer-events:none;
        background:var(--fp-plot, rgba(139,195,74,.08));
        outline:2px solid var(--fp-plot-line, rgba(124,179,66,.55));
        outline-offset:-2px; border-radius:2px; }
.plot-corner { z-index:4; }
.area.shaped { border-color:transparent; background:transparent; }
.area-fill { position:absolute; inset:0; border-radius:10px;
             background:var(--secondary-background-color,#fafafa);
             outline:1px dashed var(--divider-color,#e0e0e0);
             outline-offset:-1px; pointer-events:none; }
.area.outdoor.shaped .area-fill { background:var(--fp-outdoor, rgba(76,175,80,.10));
             outline:1px solid var(--fp-outdoor-line, rgba(76,175,80,.6)); }
/* Ecken-Modus: ein Griff je Ecke, ein kleinerer in jeder Wandmitte zum
   Einfügen. Damit werden Nischen und Wandversätze gezeichnet. */
/* Der sichtbare Punkt bleibt klein, das Ziel darum herum ist gross: ein
   Kreis mit unsichtbarem Rand. Zehn Pixel sind genug, um zu sagen "hier
   ist die Ecke" -- ein fetter Punkt verdeckt genau die Wand, die man
   gerade ausrichten will. Getroffen wird ohnehin der unsichtbare Rand.

   Und wie die Geraetepunkte haelt der Griff beim Zoomen seine Groesse:
   er sitzt im mitskalierenden .canvas, also zieht --grip-counter die
   Kamera wieder heraus. Ohne das wird derselbe Griff bei sechsfachem
   Zoom zum Teller ueber dem halben Zimmer -- also genau dann riesig,
   wenn man herangefahren ist, um praezise zu arbeiten. Gedeckelt bei 1,
   aus demselben Grund wie bei den Geraeten: herausgezoomt darf er mit
   dem Plan schrumpfen, statt als einziges Ding in Originalgroesse
   stehenzubleiben. */
.corner, .handle { --grip-counter:min(1, 1 / var(--camera-zoom,1)); }
.corner { position:absolute; width:10px; height:10px; margin:-5px 0 0 -5px;
          border-radius:50%; cursor:move; z-index:4; touch-action:none;
          display:flex; align-items:center; justify-content:center;
          background:var(--primary-color,#03a9f4);
          transform:scale(var(--grip-counter));
          box-shadow:0 0 0 2px var(--card-background-color,#fff),
                     0 1px 3px rgba(0,0,0,.35); }
/* Das Ziel waechst mit dem Kehrwert mit: der Griff wird kleiner
   gezeichnet, der Daumen bekommt trotzdem seine Flaeche. */
.corner::before { content:""; position:absolute; width:56px; height:56px;
                  border-radius:50%; }
.corner:hover { transform:scale(calc(var(--grip-counter) * 1.15)); }
/* Die Ecke einfuegen ist ein Plus und die Ecke entfernen ein Kreuz --
   beides steht dran. Vorher hiess "entfernen" Alt+Klick, was niemand
   sieht und auf einem Tablet nicht einmal existiert. */
.corner.add { width:12px; height:12px; margin:-6px 0 0 -6px; cursor:copy;
              font:600 9px/1 system-ui,sans-serif;
              color:var(--primary-color,#03a9f4);
              background:var(--card-background-color,#fff);
              box-shadow:0 0 0 2px var(--primary-color,#03a9f4),
                         0 1px 4px rgba(0,0,0,.3); }
.corner.add:hover { background:var(--primary-color,#03a9f4); color:#fff; }
.corner-drop { position:absolute; top:-11px; right:-11px; width:16px; height:16px;
               border:0; border-radius:50%; cursor:pointer; padding:0;
               font:600 13px/1 system-ui,sans-serif;
               background:var(--error-color,#db4437); color:#fff;
               box-shadow:0 1px 4px rgba(0,0,0,.35);
               opacity:0; pointer-events:none; transition:opacity .12s; }
/* Erst sichtbar, wenn diese Ecke gemeint ist -- acht Kreuze gleichzeitig
   waeren ein Minenfeld auf dem eigenen Grundriss. */
.corner:hover .corner-drop, .corner:focus-within .corner-drop {
  opacity:1; pointer-events:auto; }
/* Im Raum-Modus sind die Geraete weg. Zwanzig Punkte ueber den Waenden,
   die man gerade zieht, sind zwanzig Fehlgriffe -- und die Frage "wo ist
   die Wand" beantwortet kein Punkt. Sie sind nicht geloescht, nur nicht
   im Weg: ein Klick auf "Geraete" holt sie zurueck. */
.stage.editing-rooms .node,
.stage.editing-rooms .edges { display:none; }
/* Umgekehrt: beim Sortieren halten die Raeume still und treten zurueck,
   damit man sieht, in welchem Raum ein Punkt gerade landet. */
.stage.editing-icons .area { opacity:.75; }
.area-dim { position:absolute; bottom:4px; right:6px; font-size:11px;
            font-variant-numeric:tabular-nums; pointer-events:none;
            color:var(--secondary-text-color,#727272); }
.hint.meters { display:flex; flex-wrap:wrap; align-items:center; gap:10px; }
.hint.meters input { width:72px; font:inherit; padding:2px 6px; border-radius:6px;
                     border:1px solid var(--divider-color,#e0e0e0);
                     background:transparent; color:inherit; }
.mode { display:flex; gap:4px; flex:0 0 auto; }
.mode .chip { display:flex; align-items:center; gap:4px; white-space:nowrap;
              border-color:rgba(255,255,255,.4); }
.area-name { position:absolute; top:6px; left:8px; font-size:12px;
             color:var(--secondary-text-color,#727272); display:flex; align-items:center; gap:4px; }

.node { position:absolute; opacity:var(--layer-opacity,1);
        transform:translate(-50%,-50%) scale(calc(var(--node-scale,1) * min(1, 1 / var(--camera-zoom,1))));
        border:0; background:transparent; cursor:pointer; padding:0;
        display:flex; flex-direction:column; align-items:center; gap:2px; }
.node .dot { width:36px; height:36px; border-radius:50%; display:flex;
             align-items:center; justify-content:center; color:#fff;
             background:var(--node-color); box-shadow:0 1px 4px rgba(0,0,0,.3);
             transform:rotate(var(--node-rotation,0deg)); }
.node.floorless .dot { outline:2px dashed var(--warning-color,#ff9800); outline-offset:2px; }
.node.on .dot { box-shadow:0 0 0 4px var(--node-color); }
.node .label { font-size:11px; white-space:nowrap; color:var(--primary-text-color,#212121);
               background:var(--card-background-color,#fff); border-radius:4px; padding:0 4px; }
/* Fünf Geräte in einem Wohnzimmer ergaben fünf Namen übereinander --
   "HKV L HKV Wohnz Plug Fibaro 1" liest niemand. Auf einem vollen Raum
   erscheint der Name beim Zeigen und für das ausgewählte Gerät; der Punkt
   bleibt sichtbar, und ein Klick sagt weiterhin, was es ist. */
.node.crowded .label { opacity:0; transition:opacity .12s; }
.node.crowded:hover .label, .node.crowded.on .label { opacity:1; }
.node.crowded:hover, .node.crowded.on { z-index:3; }
.custom-icon svg { width:22px; height:22px; fill:currentColor; }

h3 { margin:12px 0 6px; font-size:14px; }
.rows { display:flex; flex-direction:column; }
.row { display:flex; align-items:center; gap:8px; border:0; background:transparent;
       padding:6px 4px; cursor:pointer; font:inherit; color:inherit; text-align:left; border-radius:8px; }
.row:hover { background:var(--secondary-background-color,#fafafa); }
.muted { color:var(--secondary-text-color,#727272); }
.note { color:var(--secondary-text-color,#727272); font-size:13px; margin:4px 0; }
.chips { display:flex; flex-wrap:wrap; gap:6px; }
.chip { border:1px solid var(--divider-color,#e0e0e0); border-radius:14px; padding:4px 10px;
        background:transparent; cursor:pointer; font:inherit; color:inherit; }
.chip.on { background:var(--fp-accent, var(--primary-color,#03a9f4)); color:#fff;
           border-color:transparent; }
.providers { list-style:none; margin:0; padding:0; }
.providers li { display:flex; align-items:center; gap:6px; padding:3px 0; font-size:13px; }
.hint { font-size:13px; margin:8px 2px; }
/* ── Theme: shapes, labels, rooms ─────────────────────────── */
.stage.shape-rounded .dot { border-radius:22%; }
.stage.shape-square .dot { border-radius:2px; }
.stage.labels-never .node .label { display:none; }
.stage.labels-hover .node .label { opacity:0; transition:opacity .12s; }
.stage.labels-hover .node:hover .label,
.stage.labels-hover .node.on .label { opacity:1; }
.stage.rooms-none .area { border-color:transparent; background:transparent; }
.stage.rooms-none .area-name { opacity:.55; }
.stage.rooms-filled .area { border-style:solid;
  background:var(--fp-accent, var(--primary-color,#03a9f4)); opacity:.14; }
.stage.rooms-filled .area-name { color:var(--fp-ink, var(--primary-text-color,#212121)); opacity:1; }

.swatches { display:flex; flex-wrap:wrap; align-items:center; gap:10px; margin:10px 0; }
.swatches > .muted { width:100%; font-size:12px; }
.swatch { display:flex; flex-direction:column; align-items:center; gap:2px;
          font-size:11px; color:var(--secondary-text-color,#727272); }
.swatch input[type=color] { width:34px; height:26px; border:0; background:none;
                            padding:0; cursor:pointer; }
select { font:inherit; padding:6px; border-radius:8px;
         border:1px solid var(--divider-color,#e0e0e0);
         background:var(--card-background-color,#fff); color:inherit; }

.stage.editing .area { cursor:grab; opacity:.9; border-style:solid; }
.stage.editing .node { cursor:grab; }
/* The grid is an overlay, so it never fights the floor's background image. */
.stage.editing::before { content:""; position:absolute; inset:0; pointer-events:none;
  background-image:
    linear-gradient(to right, rgba(127,127,127,.14) 1px, transparent 1px),
    linear-gradient(to bottom, rgba(127,127,127,.14) 1px, transparent 1px);
  background-size:4% 4%; }
/* Acht Griffe: jede Wand und jede Ecke lässt sich ziehen. */
.handle { position:absolute; background:var(--primary-color,#03a9f4);
          border:1px solid var(--card-background-color,#fff); border-radius:50%;
          width:9px; height:9px; opacity:.9;
          transform:scale(var(--grip-counter)); }
/* Wie bei der Ecke: klein gezeichnet, gross zu treffen. */
.handle::before { content:""; position:absolute; inset:-16px;
                  border-radius:50%; }
.handle-n { top:-5px; left:50%; margin-left:-5px; cursor:ns-resize; }
.handle-s { bottom:-5px; left:50%; margin-left:-5px; cursor:ns-resize; }
.handle-w { left:-5px; top:50%; margin-top:-5px; cursor:ew-resize; }
.handle-e { right:-5px; top:50%; margin-top:-5px; cursor:ew-resize; }
.handle-nw { top:-5px; left:-5px; cursor:nwse-resize; }
.handle-se { bottom:-5px; right:-5px; cursor:nwse-resize; }
.handle-ne { top:-5px; right:-5px; cursor:nesw-resize; }
.handle-sw { bottom:-5px; left:-5px; cursor:nesw-resize; }
.area-config { position:absolute; top:2px; right:26px; border:0; background:transparent;
               color:var(--secondary-text-color,#727272); cursor:pointer; padding:2px;
               display:flex; border-radius:50%; }
.area.outdoor { border-style:solid; border-color:var(--fp-outdoor-line, rgba(76,175,80,.6));
                background:var(--fp-outdoor, rgba(76,175,80,.10)); }
/* Ein virtueller Bereich ist kein Raum, und ein Rechteck mit gepunktetem
   Rand sagt das niemandem. Jeder so markierte Bereich bekommt seine eigene
   Wolke: Cloud, VPN und Server sind drei Dinge, nicht ein Kasten mit drei
   Kästen darin. */
.area.virtual { border:0; background:transparent; opacity:1; }
.area.virtual .cloud { position:absolute; inset:0; overflow:visible;
                       pointer-events:none; }
.area.virtual .cloud path {
  fill:var(--fp-virtual, rgba(120,144,180,.16));
  stroke:var(--fp-virtual-line, rgba(120,144,180,.7));
  stroke-width:1.5; vector-effect:non-scaling-stroke; stroke-dasharray:7 5; }
.area.virtual .area-name { top:30%; left:0; right:0; justify-content:center; }
/* Die Ablage steht bewusst außerhalb des Grundrisses: was hier liegt,
   hat noch keinen Platz im Haus, und einer im Raster wäre eine Behauptung. */
.tray { margin:10px 0 0; padding:8px 12px; border-radius:12px;
        background:var(--card-background-color,#fff);
        box-shadow:var(--ha-card-box-shadow,0 1px 3px rgba(0,0,0,.12)); }
.tray-head { display:flex; align-items:center; flex-wrap:wrap; gap:6px;
             margin:0 0 8px; font-size:13px; }
.tray-items { display:flex; flex-wrap:wrap; gap:6px; }
.tray-item { display:flex; align-items:center; gap:6px; border:0; font:inherit;
             color:inherit; cursor:pointer; border-radius:16px; padding:3px 10px 3px 3px;
             background:var(--secondary-background-color,#fafafa); font-size:13px; }
.tray-item:hover { background:var(--divider-color,#e0e0e0); }
.tray-item .dot { width:26px; height:26px; border-radius:50%; display:flex;
                  align-items:center; justify-content:center; color:#fff;
                  background:var(--node-color);
                  outline:2px dashed var(--warning-color,#ff9800); outline-offset:1px; }
.tray-item .dot ha-icon { --mdc-icon-size:16px; }
.tray-item .custom-icon svg { width:16px; height:16px; fill:currentColor; }
/* Die Bauflucht: die Linie, an der das Haus aufhört und der Garten
   anfängt. Ohne sie ist der Grundriss ein Raster aus Kästen, in dem der
   Garten zufällig auch ein Kasten ist. */
.building-line { position:absolute; pointer-events:none; border-radius:6px;
                 border:2px solid var(--fp-shell-line, rgba(128,145,170,.55));
                 background:var(--fp-shell, rgba(128,145,170,.06)); }
.stage.with-apron { outline:none; }
.node.dimmed { opacity:calc(var(--layer-opacity,1) * .25); }
.node.found .dot { box-shadow:0 0 0 4px var(--fp-accent, var(--primary-color,#03a9f4)); }
.area-hide { position:absolute; top:2px; right:2px; border:0; background:transparent;
             color:var(--secondary-text-color,#727272); cursor:pointer; padding:2px;
             display:flex; border-radius:50%; }
.area-hide:hover { background:var(--secondary-background-color,#fafafa); }

.layer { display:flex; flex-direction:column; }
.layer-edit { display:flex; align-items:center; gap:4px; padding:0 4px 6px 30px; }
.layer-edit input[type=range] { flex:1; min-width:0; }
.icon-btn.small { padding:2px; }
.icon-btn.small ha-icon { --mdc-icon-size:18px; }

.edit-panel { border-top:1px solid var(--divider-color,#e0e0e0);
              border-bottom:1px solid var(--divider-color,#e0e0e0);
              padding:8px 0; margin:8px 0; }
.field { display:flex; flex-direction:column; gap:4px; font-size:13px; margin:8px 0; }
.field input[type=range] { width:100%; }
.field input[type=text] { font:inherit; padding:8px; border-radius:8px;
  border:1px solid var(--divider-color,#e0e0e0);
  background:var(--card-background-color,#fff); color:inherit; }
.field i { font-style:normal; color:var(--secondary-text-color,#727272); }
.popup > .muted { display:block; font-size:12px; margin:10px 0 4px; }
.edit-buttons { display:flex; gap:8px; flex-wrap:wrap; margin-top:8px; }
.edit-buttons .chip { display:flex; align-items:center; gap:4px; }

/* Der einzige Hinweis, der von einer Aenderung *ausserhalb* des Hubs
   berichtet. Deshalb faellt er auf und deshalb steht der Weg zurueck
   direkt darin. */
.banner.moved { border-left:4px solid var(--fp-accent, var(--primary-color,#03a9f4)); }
.banner.moved .link { background:none; border:none; padding:0 0 0 6px;
                      color:var(--fp-accent, var(--primary-color,#03a9f4));
                      font:inherit; cursor:pointer; text-decoration:underline; }
.banner { margin:0 0 12px; padding:10px 14px; border-radius:10px; font-size:13px;
          background:var(--card-background-color,#fff); color:var(--secondary-text-color,#727272);
          box-shadow:var(--ha-card-box-shadow,0 1px 3px rgba(0,0,0,.12)); }
.link { border:0; background:transparent; color:var(--primary-color,#03a9f4);
        cursor:pointer; font:inherit; padding:0; text-decoration:underline; }

.empty, .loading { padding:48px 24px; text-align:center; color:var(--secondary-text-color,#727272); }
.empty h2 { color:var(--primary-text-color,#212121); }
.empty p { max-width:44ch; margin:8px auto; }

.diagnostics { margin:0 16px 16px; background:var(--card-background-color,#fff);
               border-radius:12px; padding:8px 16px 16px; }
.diag-head { display:flex; align-items:center; justify-content:space-between; }
.diag-provider { padding:6px 0; border-top:1px solid var(--divider-color,#e0e0e0); }
.diag-provider ul { margin:4px 0; padding-left:18px; color:var(--error-color,#f44336); font-size:13px; }
.ok { color:var(--success-color,#4caf50); font-size:13px; margin:4px 0; }

.scrim { position:fixed; inset:0; background:rgba(0,0,0,.4); }

/* Das Rechtsklickmenü. Der Vorhang darunter ist durchsichtig: er fängt
   nur den Klick daneben ab, verdunkelt aber nichts -- man soll weiter
   sehen, worauf man geklickt hat, während man auswählt. */
.menu-scrim { position:fixed; inset:0; z-index:40; }
.menu { position:fixed; z-index:41; min-width:210px; padding:6px;
        background:var(--card-background-color,#fff); border-radius:12px;
        box-shadow:0 12px 32px rgba(0,0,0,.32); }
.menu-item { display:flex; align-items:center; gap:10px; width:100%;
             padding:7px 10px; border:0; border-radius:8px; background:none;
             color:var(--primary-text-color,#111); font:inherit; font-size:14px;
             text-align:left; cursor:pointer; }
.menu-item:hover { background:rgba(127,127,127,.14); }
.menu-item ha-icon { --mdc-icon-size:19px; opacity:.72; flex:0 0 auto; }
/* Der eingeschaltete Eintrag ist keine Schaltfläche, die gedrückt aussieht,
   sondern der aktuelle Zustand: Häkchen statt Hervorhebung. */
.menu-item.on { color:var(--primary-color,#03a9f4); }
.menu-item.on ha-icon { opacity:1; }
.menu-label { flex:1 1 auto; }
.menu-tick { --mdc-icon-size:17px; flex:0 0 auto; }
.menu-rule { height:1px; margin:5px 6px;
             background:var(--divider-color,rgba(127,127,127,.28)); }
/* Mittig über dem Grundriss, nicht am Rand: ein Modal, das man auch auf
   einem großen Bildschirm sofort findet. */
.popup { position:fixed; left:50%; top:50%; transform:translate(-50%,-50%);
         width:min(460px,calc(100vw - 32px));
         max-height:80vh; overflow:auto; background:var(--card-background-color,#fff);
         border-radius:16px; padding:20px; box-shadow:0 16px 48px rgba(0,0,0,.35); }
.popup-icon { display:flex; align-items:center; justify-content:center;
              width:36px; height:36px; border-radius:50%; color:#fff;
              background:var(--node-color, var(--primary-color,#03a9f4)); flex:0 0 auto; }
.popup-icon svg { width:22px; height:22px; fill:currentColor; }
.inline { display:flex; align-items:center; gap:8px; font-size:13px; margin:6px 0; }
.popup-head { display:flex; align-items:flex-start; justify-content:space-between; gap:8px; }
.popup h2 { margin:0; font-size:18px; }
.popup .sub { margin:2px 0 10px; color:var(--secondary-text-color,#727272); font-size:13px; }
.popup table { width:100%; border-collapse:collapse; font-size:13px; }
.popup th { text-align:left; font-weight:500; color:var(--secondary-text-color,#727272);
            padding:3px 8px 3px 0; vertical-align:top; white-space:nowrap; }
.popup td { padding:3px 0; word-break:break-word; }
.actions { display:flex; flex-wrap:wrap; gap:8px; margin-top:12px; }
.action { display:flex; align-items:center; gap:6px; border:0; border-radius:18px;
          padding:8px 16px; cursor:pointer; font:inherit;
          background:var(--fp-accent, var(--primary-color,#03a9f4)); color:#fff; }
.spark { width:100%; height:48px; margin-top:8px; }
`;

customElements.define("spatial-hub-panel", SpatialHubPanel);

// Exported so the test suite can drive the rendering logic without a
// browser. Home Assistant loads this file as a module and only ever uses
// the custom element above.
export { SpatialHubPanel, HA_COLOURS, AREA_KIND, kindOf, joinsOf, drawsTheWall };
