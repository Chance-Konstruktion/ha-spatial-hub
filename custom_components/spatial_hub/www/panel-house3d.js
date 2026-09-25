/**
 * Spatial Hub -- das Haus als Stapel echter Geschosse.
 *
 * Die Hausansicht, von null gebaut: jedes Geschoss ist ein Koerper aus
 * Metern -- Bodenplatte, Mauern mit Staerke, Tueren als Durchbruch, Fenster
 * in der Mauerkrone, Treppen mit Stufen, Balkone mit Gelaender -- und wird
 * durch **eine** perspektivische Kamera gesehen. Alle Geschosse bekommen
 * dieselbe Kamera und werden danach nur senkrecht versetzt. Daraus folgt
 * die Zusage, um die es geht: Die Aussenwaende aller Geschosse stehen
 * parallel zueinander und in einer Flucht, vorne links wie hinten rechts.
 *
 * Verdeckt wird wie in einer Strichzeichnung: Flaechen sind in der Farbe
 * des Hintergrunds gefuellt, Kanten in der Farbe der Tinte. Was hinter einer
 * Mauer liegt, verschwindet, weil die Mauer spaeter gemalt wird. Die
 * Reihenfolge kommt aus einem BSP-Baum und ist damit richtig und nicht nur
 * meistens richtig; eine Flaeche, die dabei geteilt wird, zeichnet nur ihre
 * eigenen Kanten und nie die Schnittlinie.
 *
 * Reihenfolge je Geschoss, und warum sie stimmt (die Kamera steht immer
 * hoeher als die Mauerkrone):
 *
 *   1. Platten (Boden, Balkone) und alles, was flach auf dem Boden liegt --
 *      nichts auf Bodenhoehe kann etwas darueber verdecken.
 *   2. Alles Stehende (Wandflaechen, Tuerblaetter, Tore, Stufen, Gelaender)
 *      in BSP-Reihenfolge.
 *   3. Die Mauerkronen samt Fenstern. Der Sehstrahl zu einem Punkt auf der
 *      Krone laeuft ueberall hoeher als die Krone; nichts, was niedriger
 *      oder gleich hoch ist, kann davor liegen.
 *   4. Die Raumnamen, damit sie lesbar bleiben.
 *
 * Reine Funktionen, kein DOM, kein ``this``. Das Panel ruft `houseScene`
 * und bekommt SVG-Text und eine Projektion fuer seine Geraetepunkte.
 */
import {
  AREA_KIND,
  OPENING,
  boxOf,
  dimension,
  doorsOf,
  fold,
  houseAspect,
  houseMetres,
  isStairs,
  joinsOf,
  kindOf,
  openingKind,
  openingsOn,
  shapeOf,
  hasShape,
  unjoined,
} from "./panel-geometry.js";

/** Die Stellschrauben. Alle Laengen, die in Metern gemeint sind, stehen
 *  als Anteil der Hausbreite da und werden geklemmt: ein Haus mit 8 m und
 *  eines mit 40 m sollen beide aussehen wie ein Haus. */
const HOUSE3D = Object.freeze({
  pitch: 38, //            Grad, wie steil die Kamera hinabsieht
  distance: 1.75, //       Kameraabstand in Hausbreiten -- die Perspektive
  pixels: 1000, //         so breit wird das Haus im Bild
  gap: 64, //              Luft zwischen zwei Geschossen, in Bildpunkten
  margin: 28,
  wall: [0.07, 0.8, 1.5], //   Mauerhoehe (Schnitthoehe): Anteil, min, max
  outer: [0.024, 0.2, 0.45], // Aussenwand
  inner: [0.011, 0.1, 0.22], // Innenwand
  slab: [0.016, 0.12, 0.3], //  Bodenplatte
  gate: 2.3, //            ab so vielen Metern ist eine Tuer ein Tor
  tread: 0.28, //          Stufentiefe in Metern
  label: 17, //            Raumname, Bildpunkte
  storey: 30, //           Etagenname, Bildpunkte
  dim: 13, //              Schrift der Masskette, Bildpunkte
  tick: 7, //              halbe Laenge der Begrenzungsstriche
  hatch: 0.45, //          Abstand der Erdschraffur, Meter
});

const EPS = 1e-7;
const clampShare = (width, [share, min, max]) =>
  Math.min(max, Math.max(min, width * share));

// ── Vektoren ──────────────────────────────────────────────

const v3 = (x, y, z) => ({ x, y, z });
const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
const lerp = (a, b, t) =>
  v3(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, a.z + (b.z - a.z) * t);

/** Die Normale eines Polygons nach Newell -- robust auch bei fast
 *  kollinearen Ecken, die ein Kreuzprodukt aus den ersten drei nicht ist. */
const newell = (pts) => {
  let x = 0;
  let y = 0;
  let z = 0;
  for (let i = 0; i < pts.length; i += 1) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    x += (a.y - b.y) * (a.z + b.z);
    y += (a.z - b.z) * (a.x + b.x);
    z += (a.x - b.x) * (a.y + b.y);
  }
  const len = Math.hypot(x, y, z) || 1;
  return v3(x / len, y / len, z / len);
};

/** Ein Polygon fuer den Baum.
 *
 *  `edges[i]` sagt, ob die Kante von Ecke i zu Ecke i+1 gezeichnet wird.
 *  Beim Teilen bekommt die Schnittkante `false` -- sie ist eine Naht der
 *  Rechnung und keine Kante des Hauses. `lines` sind Striche, die in der
 *  Flaeche liegen (Gelaenderstaebe, Torlamellen) und mitgeteilt werden.
 *  `two` heisst zweiseitig: ein Tuerblatt hat keine Rueckseite, die man
 *  wegwerfen duerfte. `fill: false` verdeckt nichts, zeichnet nur Striche.
 */
const poly = (pts, opts = {}) => {
  const n = opts.normal || newell(pts);
  return {
    pts,
    n,
    d: dot(n, pts[0]),
    edges: opts.edges || pts.map(() => true),
    lines: opts.lines || [],
    two: Boolean(opts.two),
    fill: opts.fill !== false,
    cls: opts.cls || "",
  };
};

const withPlane = (source, pts, edges, lines) => ({
  ...source,
  pts,
  edges,
  lines,
});

/** Ein Polygon an einer Ebene teilen. Gibt {front, back, on} zurueck. */
const splitPoly = (p, plane) => {
  const dist = p.pts.map((pt) => dot(plane.n, pt) - plane.d);
  let front = false;
  let back = false;
  for (const value of dist) {
    if (value > EPS) front = true;
    else if (value < -EPS) back = true;
  }
  if (!front && !back) return { on: p };
  if (!back) return { front: p };
  if (!front) return { back: p };

  const F = [];
  const Fe = [];
  const B = [];
  const Be = [];
  const count = p.pts.length;
  for (let i = 0; i < count; i += 1) {
    const j = (i + 1) % count;
    const a = p.pts[i];
    const b = p.pts[j];
    const da = dist[i];
    const db = dist[j];
    const edge = p.edges[i];
    const aF = da > EPS;
    const aB = da < -EPS;
    if (!aB) {
      F.push(a);
      Fe.push(db >= -EPS ? edge : aF ? edge : false);
    }
    if (!aF) {
      B.push(a);
      Be.push(db <= EPS ? edge : aB ? edge : false);
    }
    if ((aF && db < -EPS) || (aB && db > EPS)) {
      const cut = lerp(a, b, da / (da - db));
      F.push(cut);
      B.push(cut);
      if (aF) {
        Fe.push(false);
        Be.push(edge);
      } else {
        Fe.push(edge);
        Be.push(false);
      }
    }
  }

  const frontLines = [];
  const backLines = [];
  for (const [s, t] of p.lines) {
    const ds = dot(plane.n, s) - plane.d;
    const dt = dot(plane.n, t) - plane.d;
    if (ds >= -EPS && dt >= -EPS) frontLines.push([s, t]);
    else if (ds <= EPS && dt <= EPS) backLines.push([s, t]);
    else {
      const cut = lerp(s, t, ds / (ds - dt));
      if (ds > 0) {
        frontLines.push([s, cut]);
        backLines.push([cut, t]);
      } else {
        backLines.push([s, cut]);
        frontLines.push([cut, t]);
      }
    }
  }

  return {
    front: F.length >= 3 ? withPlane(p, F, Fe, frontLines) : null,
    back: B.length >= 3 ? withPlane(p, B, Be, backLines) : null,
  };
};

/** Wie viele Polygone eine Ebene zerschneiden wuerde. */
const splitsOf = (plane, polys) => {
  let splits = 0;
  for (const p of polys) {
    let front = false;
    let back = false;
    for (const pt of p.pts) {
      const value = dot(plane.n, pt) - plane.d;
      if (value > EPS) front = true;
      else if (value < -EPS) back = true;
      if (front && back) {
        splits += 1;
        break;
      }
    }
  }
  return splits;
};

const buildBsp = (polys) => {
  if (!polys.length) return null;
  // Eine Handvoll Kandidaten, der mit den wenigsten Schnitten gewinnt.
  // Alle zu pruefen waere quadratisch in jeder Ebene des Baums.
  const tries = Math.min(polys.length, 8);
  let best = 0;
  let fewest = Infinity;
  for (let k = 0; k < tries; k += 1) {
    const index = Math.floor((k * polys.length) / tries);
    const cost = splitsOf(polys[index], polys);
    if (cost < fewest) {
      fewest = cost;
      best = index;
    }
  }
  const splitter = polys[best];
  const plane = { n: splitter.n, d: splitter.d };
  const on = [splitter];
  const front = [];
  const back = [];
  polys.forEach((p, index) => {
    if (index === best) return;
    const part = splitPoly(p, plane);
    if (part.on) on.push(part.on);
    if (part.front) front.push(part.front);
    if (part.back) back.push(part.back);
  });
  return { plane, on, front: buildBsp(front), back: buildBsp(back) };
};

/** Von hinten nach vorn, vom Auge aus gesehen. */
const walkBsp = (node, eye, out) => {
  if (!node) return;
  const side = dot(node.plane.n, eye) - node.plane.d;
  const [far, near] = side >= 0 ? [node.back, node.front] : [node.front, node.back];
  walkBsp(far, eye, out);
  for (const p of node.on) {
    if (p.two || dot(p.n, eye) - p.d > EPS) out.push(p);
  }
  walkBsp(near, eye, out);
};

// ── Kamera ────────────────────────────────────────────────

/** Eine Kamera vorne oben, mittig vor dem Haus. Dieselbe fuer jedes
 *  Geschoss: Das ist die ganze Flucht. */
const cameraOf = (W, D) => {
  const pitch = (HOUSE3D.pitch * Math.PI) / 180;
  const sin = Math.sin(pitch);
  const cos = Math.cos(pitch);
  const R = HOUSE3D.distance * Math.max(W, D);
  const target = v3(W / 2, D / 2, 0);
  const eye = v3(target.x, target.y + R * cos, R * sin);
  const F = (HOUSE3D.pixels * R) / W;
  const project = (p) => {
    const dx = p.x - eye.x;
    const dy = p.y - eye.y;
    const dz = p.z - eye.z;
    const up = -dy * sin + dz * cos;
    const depth = Math.max(-dy * cos - dz * sin, 1e-3);
    return { x: (F * dx) / depth, y: (-F * up) / depth };
  };
  return { eye, project };
};

// ── Geometrie eines Geschosses ────────────────────────────

const BALCONY_WORDS = ["balkon", "balcony", "loggia", "dachterrasse"];
const TERRACE_WORDS = ["terrasse", "terrace", "veranda", "patio", "sitzplatz"];
const saysAny = (area, words) => {
  const text = fold(`${area.name || ""} ${area.icon || ""}`);
  return words.some((word) => text.includes(word));
};

/** Ein Bereich in Metern: Kasten und Kontur. */
const metricOf = (area, W, D) => {
  const box = boxOf(area);
  const rect = {
    l: box.left * W, r: box.right * W, t: box.top * D, b: box.bottom * D,
  };
  const shape = shapeOf(area).map((pt) => ({
    x: rect.l + pt.x * (rect.r - rect.l),
    y: rect.t + pt.y * (rect.b - rect.t),
  }));
  return { rect, shape };
};

/** Die Flaeche einer Kontur, mit Vorzeichen (x rechts, y nach vorn). */
const signedArea = (pts) => {
  let sum = 0;
  for (let i = 0; i < pts.length; i += 1) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    sum += a.x * b.y - b.x * a.y;
  }
  return sum / 2;
};

/** Achsparallele Rechtecke vereinigen, Luecken abziehen, Rand verfolgen.
 *
 *  Die Mauern eines Geschosses sind ein Koerper, keine Sammlung von
 *  Kaesten: dort, wo zwei Waende aufeinandertreffen, darf keine Linie
 *  stehen. Also ein Raster aus allen vorkommenden Koordinaten, jede Zelle
 *  Mauer oder nicht, und der Rand dieser Zellmenge als geschlossene
 *  Schleifen -- die Mauer liegt beim Durchlaufen immer links.
 */
const unionLoops = (rects, holes) => {
  const snap = (value) => Math.round(value * 1e4) / 1e4;
  const unique = (values) =>
    [...new Set(values.map(snap))].sort((a, b) => a - b);
  const all = [...rects, ...holes];
  const xs = unique(all.flatMap((r) => [r.x0, r.x1]));
  const ys = unique(all.flatMap((r) => [r.y0, r.y1]));
  const nx = xs.length - 1;
  const ny = ys.length - 1;
  if (nx < 1 || ny < 1) return [];
  const inside = (r, x, y) => x > r.x0 && x < r.x1 && y > r.y0 && y < r.y1;
  const solid = new Uint8Array(nx * ny);
  for (let j = 0; j < ny; j += 1) {
    const cy = (ys[j] + ys[j + 1]) / 2;
    for (let i = 0; i < nx; i += 1) {
      const cx = (xs[i] + xs[i + 1]) / 2;
      if (
        rects.some((r) => inside(r, cx, cy)) &&
        !holes.some((r) => inside(r, cx, cy))
      ) {
        solid[j * nx + i] = 1;
      }
    }
  }
  const at = (i, j) =>
    i >= 0 && j >= 0 && i < nx && j < ny && solid[j * nx + i] === 1;

  // Gerichtete Randkanten zwischen Gitterpunkten, Mauer links.
  const next = new Map();
  const key = (i, j) => `${i},${j}`;
  const addEdge = (a, b) => {
    const from = key(...a);
    if (!next.has(from)) next.set(from, []);
    next.get(from).push({ a, b, used: false });
  };
  for (let j = 0; j < ny; j += 1) {
    for (let i = 0; i < nx; i += 1) {
      if (!at(i, j)) continue;
      if (!at(i, j - 1)) addEdge([i, j], [i + 1, j]);
      if (!at(i + 1, j)) addEdge([i + 1, j], [i + 1, j + 1]);
      if (!at(i, j + 1)) addEdge([i + 1, j + 1], [i, j + 1]);
      if (!at(i - 1, j)) addEdge([i, j + 1], [i, j]);
    }
  }

  const loops = [];
  for (const list of next.values()) {
    for (const start of list) {
      if (start.used) continue;
      const loop = [];
      let edge = start;
      while (edge && !edge.used) {
        edge.used = true;
        loop.push(edge.a);
        const candidates = (next.get(key(...edge.b)) || []).filter((e) => !e.used);
        edge = candidates[0] || null;
      }
      // Geradeaus laufende Ecken zusammenfassen: eine Wand ist eine Flaeche,
      // nicht so viele, wie das Raster Spalten hat.
      const points = loop.map(([i, j]) => ({ x: xs[i], y: ys[j] }));
      const simple = points.filter((p, index) => {
        const prev = points[(index - 1 + points.length) % points.length];
        const after = points[(index + 1) % points.length];
        const cross =
          (p.x - prev.x) * (after.y - p.y) - (p.y - prev.y) * (after.x - p.x);
        return Math.abs(cross) > 1e-9;
      });
      if (simple.length >= 3) loops.push(simple);
    }
  }
  return loops;
};

/** Ein Quader mit Aussennormalen, als sechs (bzw. fuenf) Flaechen. */
const boxFaces = (x0, x1, y0, y1, z0, z1, cls = "") => {
  const P = (x, y, z) => v3(x, y, z);
  return [
    poly([P(x0, y0, z1), P(x1, y0, z1), P(x1, y1, z1), P(x0, y1, z1)],
      { normal: v3(0, 0, 1), cls }),
    poly([P(x0, y1, z0), P(x1, y1, z0), P(x1, y1, z1), P(x0, y1, z1)],
      { normal: v3(0, 1, 0), cls }),
    poly([P(x1, y0, z0), P(x0, y0, z0), P(x0, y0, z1), P(x1, y0, z1)],
      { normal: v3(0, -1, 0), cls }),
    poly([P(x1, y1, z0), P(x1, y0, z0), P(x1, y0, z1), P(x1, y1, z1)],
      { normal: v3(1, 0, 0), cls }),
    poly([P(x0, y0, z0), P(x0, y1, z0), P(x0, y1, z1), P(x0, y0, z1)],
      { normal: v3(-1, 0, 0), cls }),
  ];
};

/** Die Wandflaechen einer Randschleife: senkrechte Vierecke, Normale nach
 *  aussen (rechts der Laufrichtung, die Mauer liegt links). */
const loopFaces = (loop, z0, z1, cls = "") =>
  loop.map((a, index) => {
    const b = loop[(index + 1) % loop.length];
    const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    return poly(
      [v3(a.x, a.y, z0), v3(b.x, b.y, z0), v3(b.x, b.y, z1), v3(a.x, a.y, z1)],
      { normal: v3((b.y - a.y) / len, -(b.x - a.x) / len, 0), cls },
    );
  });

/** Alles, was ein Geschoss an Koerpern und Zeichen hat, in Metern. */
const storeyOf = (floor, areas, dims, pins = [], options = {}) => {
  const { W, D, h, T, t, slab } = dims;
  const rooms = areas.filter(
    (area) => area.position && kindOf(area) === AREA_KIND.INDOOR,
  );
  const outside = areas.filter(
    (area) => area.position && kindOf(area) === AREA_KIND.OUTDOOR,
  );
  const soil = areas.filter(
    (area) => area.position && kindOf(area) === AREA_KIND.VIRTUAL,
  );

  const plates = []; //  Platten: vor allem anderen
  const flat = []; //    Striche auf dem Boden: {pts, cls, closed}
  const standing = []; // BSP
  const caps = []; //    {loops} oder Einzelpolygone
  const windows = []; // Fensterzeichen auf der Krone
  const labels = []; //  {at, text, width}
  const chains = []; //  Massketten: {rows: [{y, stops, values}]}

  // Die Bauflucht dieses Geschosses in Metern.
  let outline = null;
  const metric = rooms.map((room) => ({ room, ...metricOf(room, W, D) }));
  if (metric.length) {
    const given = floor.outline;
    outline = given && Number.isFinite(given.width)
      ? {
        l: given.x * W, r: (given.x + given.width) * W,
        t: given.y * D, b: (given.y + given.height) * D,
      }
      : null;
    // Die gemeldete Flucht kann Aussenbereiche mitzaehlen (aeltere Hubs):
    // die Raeume selbst sind die Auskunft, auf die Verlass ist.
    const fromRooms = {
      l: Math.min(...metric.map((m) => m.rect.l)),
      r: Math.max(...metric.map((m) => m.rect.r)),
      t: Math.min(...metric.map((m) => m.rect.t)),
      b: Math.max(...metric.map((m) => m.rect.b)),
    };
    if (
      !outline ||
      outline.l < fromRooms.l - 0.02 * W || outline.r > fromRooms.r + 0.02 * W ||
      outline.t < fromRooms.t - 0.02 * D || outline.b > fromRooms.b + 0.02 * D
    ) {
      outline = fromRooms;
    }
  }
  // Der Raumname steht in der Mitte -- es sei denn, dort steht ein Geraet.
  // Dann rueckt er nach hinten, statt unter dem Punkt zu verschwinden.
  const labelOf = (area, rect) => {
    const cx = (rect.l + rect.r) / 2;
    const cy = (rect.t + rect.b) / 2;
    const busy = pins.some((pin) =>
      Math.abs(pin.x * W - cx) < (rect.r - rect.l) * 0.3 &&
      Math.abs(pin.y * D - cy) < (rect.b - rect.t) * 0.25);
    return {
      at: v3(cx, busy ? rect.t + (rect.b - rect.t) * 0.24 : cy, 0),
      text: area.name || "",
      width: rect.r - rect.l,
    };
  };
  const tolX = 0.012 * W;
  const tolY = 0.012 * D;

  // Die Bodenplatte unter der Flucht.
  if (outline) {
    plates.push(...boxFaces(outline.l, outline.r, outline.t, outline.b, -slab, 0, "slab"));
  }

  const wallRects = [];
  const gaps = [];
  const clampToOutline = (r) =>
    outline
      ? {
        x0: Math.max(r.x0, outline.l), x1: Math.min(r.x1, outline.r),
        y0: Math.max(r.y0, outline.t), y1: Math.min(r.y1, outline.b),
      }
      : r;

  // Wo zwei Raeume eine Wand teilen koennten, es aber ausdruecklich nicht
  // tun (`unjoined`), stehen zwei Mauern mit einer Fuge dazwischen. Die
  // Geometrie fragen, nicht die Trennung -- sonst waere nicht zu sehen,
  // welcher Nachbar gemeint ist.
  const touching = joinsOf(rooms, false);
  const byId = new Map(rooms.map((room) => [room.id, room]));
  const apart = (room, side) => {
    const other = byId.get((touching.get(room.id) || new Map()).get(side));
    return Boolean(other) && unjoined(room, other);
  };

  for (const { room, rect, shape } of metric) {
    const shaped = hasShape(room);
    const orient = signedArea(shape) >= 0 ? 1 : -1;
    const doors = doorsOf(room, shape.length);

    shape.forEach((a, side) => {
      const b = shape[(side + 1) % shape.length];
      const len = Math.hypot(b.x - a.x, b.y - a.y);
      if (len < 1e-6) return;
      const dir = { x: (b.x - a.x) / len, y: (b.y - a.y) / len };
      // Nach innen: links der Laufrichtung, wenn die Kontur positiv laeuft.
      const inward = { x: -dir.y * orient, y: dir.x * orient };
      const horizontal = Math.abs(dir.y) < 1e-6;
      const vertical = Math.abs(dir.x) < 1e-6;
      const onOutline = Boolean(outline) && (
        (horizontal && (Math.abs(a.y - outline.t) < tolY || Math.abs(a.y - outline.b) < tolY)) ||
        (vertical && (Math.abs(a.x - outline.l) < tolX || Math.abs(a.x - outline.r) < tolX))
      );
      const thick = onOutline ? T : t;
      // Quer zur Wand: von wo bis wo, gemessen entlang `inward` ab der Kante.
      // Eine getrennte Wand steht ganz auf der eigenen Seite, mit Fuge.
      const split = !onOutline && !shaped && apart(room, side);
      const across = onOutline ? [0, T] : split ? [t * 0.3, t * 1.1] : [-t / 2, t / 2];
      const point = (s, q) => ({
        x: a.x + dir.x * s + inward.x * q,
        y: a.y + dir.y * s + inward.y * q,
      });
      const rectOf = (s0, s1, q0, q1) => {
        const corners = [point(s0, q0), point(s1, q0), point(s1, q1), point(s0, q1)];
        return {
          x0: Math.min(...corners.map((c) => c.x)),
          x1: Math.max(...corners.map((c) => c.x)),
          y0: Math.min(...corners.map((c) => c.y)),
          y1: Math.max(...corners.map((c) => c.y)),
        };
      };
      // Oeffnungen, die sich beruehren, sind eine: zwei Tueren nebeneinander
      // ergeben einen Durchgang und ein Blatt, nicht zwei Blaetter im selben
      // Loch. Fenster bleiben fuer sich -- sie brechen die Mauer nicht.
      const openings = [];
      for (const entry of openingsOn(doors, side)) {
        const last = openings[openings.length - 1];
        const isDoor = openingKind(entry.door) !== OPENING.WINDOW;
        if (last && isDoor && openingKind(last.door) !== OPENING.WINDOW &&
            entry.run[0] <= last.run[1] + 1e-6) {
          last.run = [last.run[0], Math.max(last.run[1], entry.run[1])];
        } else {
          openings.push({ door: entry.door, run: [...entry.run] });
        }
      }
      const axis = horizontal || vertical;
      const reach = onOutline || split ? 0 : t / 2;

      if (axis) {
        wallRects.push(clampToOutline(rectOf(-reach, len + reach, across[0], across[1])));
      } else {
        // Schraege Wand: ein eigener Quader je Wandstueck zwischen den
        // Oeffnungen. Die Ecken stossen stumpf -- ehrlicher als geraten.
        let from = 0;
        const pieces = [];
        for (const { door, run } of openings) {
          if (openingKind(door) === OPENING.WINDOW) continue;
          pieces.push([from, Math.max(from, run[0] * len)]);
          from = Math.min(len, run[1] * len);
        }
        pieces.push([from, len]);
        for (const [s0, s1] of pieces) {
          if (s1 - s0 < 1e-3) continue;
          const c = [point(s0, across[0]), point(s1, across[0]),
            point(s1, across[1]), point(s0, across[1])];
          // Grundriss gegen den Uhrzeigersinn (Mauer links), dann hochziehen.
          const ring = signedArea(c) >= 0 ? c : [...c].reverse();
          standing.push(...loopFaces(ring, 0, h, "wall"));
          caps.push(poly(ring.map((p) => v3(p.x, p.y, h)), { normal: v3(0, 0, 1), cls: "cap" }));
        }
      }

      for (const { door, run } of openings) {
        const s0 = Math.max(0, run[0]) * len;
        const s1 = Math.min(1, run[1]) * len;
        if (s1 - s0 < 1e-3) continue;
        const width = s1 - s0;
        if (openingKind(door) === OPENING.WINDOW) {
          const q0 = across[0] + thick * 0.18;
          const q1 = across[1] - thick * 0.18;
          const qm = (q0 + q1) / 2;
          const z = h + 0.002;
          const P = (s, q) => {
            const p = point(s, q);
            return v3(p.x, p.y, z);
          };
          const frame = [P(s0, q0), P(s1, q0), P(s1, q1), P(s0, q1)];
          const sm = (s0 + s1) / 2;
          windows.push(poly(frame, {
            normal: v3(0, 0, 1),
            cls: "window",
            lines: [[P(s0, qm), P(s1, qm)], [P(sm, q0), P(sm, q1)]],
          }));
          continue;
        }
        // Tuer: ein Durchbruch durch die ganze Mauer.
        if (axis) {
          gaps.push(rectOf(s0, s1, across[0] - 0.02, across[1] + 0.02));
        }
        if (width >= HOUSE3D.gate) {
          // Ein Tor: Lamellen in der Wandebene statt eines Tuerblatts.
          const q = onOutline ? T * 0.35 : 0;
          const A = point(s0, q);
          const B = point(s1, q);
          const slats = [];
          const count = 6;
          for (let k = 1; k < count; k += 1) {
            const z = (h * 0.98 * k) / count;
            slats.push([v3(A.x, A.y, z), v3(B.x, B.y, z)]);
          }
          standing.push(poly(
            [v3(A.x, A.y, 0), v3(B.x, B.y, 0), v3(B.x, B.y, h * 0.98), v3(A.x, A.y, h * 0.98)],
            { two: true, cls: "gate", lines: slats },
          ));
          continue;
        }
        // Tuerblatt, um 90 Grad in den Raum geoeffnet, und sein Bogen.
        const q = across[1];
        const hinge = point(s0, q);
        const tip = {
          x: hinge.x + inward.x * width, y: hinge.y + inward.y * width,
        };
        const leaf = h * 0.92;
        standing.push(poly(
          [v3(hinge.x, hinge.y, 0), v3(tip.x, tip.y, 0),
            v3(tip.x, tip.y, leaf), v3(hinge.x, hinge.y, leaf)],
          { two: true, cls: "leaf" },
        ));
        const arc = [];
        const steps = 14;
        for (let k = 0; k <= steps; k += 1) {
          const angle = (Math.PI / 2) * (k / steps);
          arc.push(v3(
            hinge.x + (inward.x * Math.cos(angle) + dir.x * Math.sin(angle)) * width,
            hinge.y + (inward.y * Math.cos(angle) + dir.y * Math.sin(angle)) * width,
            0.001,
          ));
        }
        flat.push({ pts: arc, cls: "swing", closed: false });
      }
    });

    // Treppe: echte Stufen, schwebend als Zickzack im Profil.
    if (isStairs(room) && !shaped) {
      const inset = t / 2 + 0.02;
      const x0 = rect.l + inset;
      const x1 = rect.r - inset;
      const y0 = rect.t + inset;
      const y1 = rect.b - inset;
      const alongY = y1 - y0 >= x1 - x0;
      const length = alongY ? y1 - y0 : x1 - x0;
      const count = Math.max(4, Math.min(16, Math.round(length / HOUSE3D.tread)));
      const rise = (h * 0.96) / count;
      for (let k = 0; k < count; k += 1) {
        const z0 = k * rise;
        const z1 = (k + 1) * rise;
        if (alongY) {
          // Vorne unten, hinten oben.
          const b = y1 - (length * k) / count;
          const a = y1 - (length * (k + 1)) / count;
          standing.push(...boxFaces(x0, x1, a, b, z0, z1, "step"));
        } else {
          const a = x0 + (length * k) / count;
          const b = x0 + (length * (k + 1)) / count;
          standing.push(...boxFaces(a, b, y0, y1, z0, z1, "step"));
        }
      }
    }

    labels.push(labelOf(room, rect));
  }

  // Die Mauern als ein Koerper.
  if (wallRects.length) {
    const loops = unionLoops(
      wallRects.filter((r) => r.x1 - r.x0 > 1e-4 && r.y1 - r.y0 > 1e-4),
      gaps,
    );
    for (const loop of loops) standing.push(...loopFaces(loop, 0, h, "wall"));
    caps.unshift({ loops });
  }

  // Draussen: Balkon mit Gelaender, Terrasse als Platte, Garten gestrichelt.
  for (const area of outside) {
    const { rect } = metricOf(area, W, D);
    const upstairs = !floor.ground;
    const balcony = saysAny(area, BALCONY_WORDS) ||
      (upstairs && !saysAny(area, TERRACE_WORDS));
    const terrace = !balcony && saysAny(area, TERRACE_WORDS);
    if (balcony || terrace) {
      plates.push(...boxFaces(rect.l, rect.r, rect.t, rect.b, -slab, 0, "deck"));
    } else {
      flat.push({
        pts: [v3(rect.l, rect.t, 0), v3(rect.r, rect.t, 0),
          v3(rect.r, rect.b, 0), v3(rect.l, rect.b, 0)],
        cls: "garden",
        closed: true,
      });
    }
    if (balcony) {
      const rail = h * 0.9;
      const sides = [
        [v3(rect.l, rect.t, 0), v3(rect.r, rect.t, 0)],
        [v3(rect.r, rect.t, 0), v3(rect.r, rect.b, 0)],
        [v3(rect.r, rect.b, 0), v3(rect.l, rect.b, 0)],
        [v3(rect.l, rect.b, 0), v3(rect.l, rect.t, 0)],
      ];
      const againstHouse = ([a, b]) => {
        if (!outline) return false;
        const midX = (a.x + b.x) / 2;
        const midY = (a.y + b.y) / 2;
        const within = (value, lo, hi) => value > lo - tolX && value < hi + tolX;
        if (Math.abs(a.y - b.y) < 1e-6) {
          return (Math.abs(a.y - outline.t) < tolY || Math.abs(a.y - outline.b) < tolY) &&
            within(midX, outline.l, outline.r);
        }
        return (Math.abs(a.x - outline.l) < tolX || Math.abs(a.x - outline.r) < tolX) &&
          within(midY, outline.t, outline.b);
      };
      const spacing = Math.max(0.11, W / 110);
      for (const [a, b] of sides) {
        if (againstHouse([a, b])) continue;
        const len = Math.hypot(b.x - a.x, b.y - a.y);
        const bars = [];
        const count = Math.max(2, Math.round(len / spacing));
        for (let k = 1; k < count; k += 1) {
          const p = lerp(a, b, k / count);
          bars.push([v3(p.x, p.y, 0), v3(p.x, p.y, rail)]);
        }
        standing.push(poly(
          [a, b, v3(b.x, b.y, rail), v3(a.x, a.y, rail)],
          { two: true, fill: false, cls: "rail", lines: bars },
        ));
      }
    }
    labels.push(labelOf(area, rect));
  }

  // Das Erdreich: Material, kein Raum. Schraffur ohne Rahmen, jeder
  // virtuelle Bereich fuer sich.
  for (const area of soil) {
    const { rect } = metricOf(area, W, D);
    const gap = HOUSE3D.hatch;
    const width = rect.r - rect.l;
    const depth = rect.b - rect.t;
    // Striche unter 45 Grad: x + y = c, geschnitten mit dem Kasten.
    for (let c = gap / 2; c < width + depth; c += gap) {
      const a = { x: rect.l + Math.min(c, width), y: rect.t + Math.max(0, c - width) };
      const b = { x: rect.l + Math.max(0, c - depth), y: rect.t + Math.min(c, depth) };
      flat.push({ pts: [v3(a.x, a.y, 0), v3(b.x, b.y, 0)], cls: "soil", closed: false });
    }
    labels.push(labelOf(area, rect));
  }

  // Die Masskette unter dem Geschoss, geteilt an jeder Wand, die vorne
  // ankommt -- nur, wenn jemand sie eingeschaltet hat und die Etage ihre
  // Breite in Metern kennt. Ohne `metres` gaebe es nur erfundene Zahlen.
  const known = Number(floor.metres) > 0;
  if (options.dimensions && known && outline) {
    const xs = [outline.l, outline.r];
    for (const { rect } of metric) {
      if (Math.abs(rect.b - outline.b) < tolY) xs.push(rect.l, rect.r);
    }
    const stops = [];
    for (const x of xs.filter((v) => v > outline.l - tolX && v < outline.r + tolX)
      .sort((a, b) => a - b)) {
      if (!stops.length || x - stops[stops.length - 1] > tolX) stops.push(x);
    }
    // Der Massstab ist der dieser Etage, nicht der des Bezugsgeschosses.
    const perMetre = houseMetres(floor) / W;
    const drop = Math.max(0.5, W * 0.045);
    const rows = [{ y: outline.b + drop, stops }];
    if (stops.length > 2) {
      rows.push({ y: outline.b + drop * 1.8, stops: [stops[0], stops[stops.length - 1]] });
    }
    chains.push({
      from: outline.b,
      z: -slab,
      rows: rows.map((row) => ({
        ...row,
        values: row.stops.slice(1).map((x, i) => dimension((x - row.stops[i]) * perMetre)),
      })),
    });
  }

  return { outline, plates, flat, standing, caps, windows, labels, chains };
};

// ── Zeichnen ──────────────────────────────────────────────

const num = (value) => (Math.round(value * 10) / 10).toString();

const escapeText = (value) =>
  String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

/** Ein Polygon als Flaeche plus seine eigenen Kanten. */
const polySvg = (p, project, cls = "") => {
  const pts = p.pts.map(project);
  let out = "";
  if (p.fill) {
    out += `<path class="f" d="M${pts.map((q) => `${num(q.x)} ${num(q.y)}`).join("L")}Z"/>`;
  }
  let lines = "";
  pts.forEach((a, i) => {
    if (!p.edges[i]) return;
    const b = pts[(i + 1) % pts.length];
    lines += `M${num(a.x)} ${num(a.y)}L${num(b.x)} ${num(b.y)}`;
  });
  for (const [s, e] of p.lines) {
    const a = project(s);
    const b = project(e);
    lines += `M${num(a.x)} ${num(a.y)}L${num(b.x)} ${num(b.y)}`;
  }
  if (lines) out += `<path class="l ${p.cls || cls}" d="${lines}"/>`;
  return out;
};

const pathOf = (pts, closed) =>
  `M${pts.map((q) => `${num(q.x)} ${num(q.y)}`).join("L")}${closed ? "Z" : ""}`;

/** Das ganze Haus.
 *
 *  `floors` von oben nach unten, so wie der Stapel sie fuehrt;
 *  `areasOf(floor)` liefert die Bereiche einer Etage, `pinsOf(floor)`
 *  die Geraetepunkte darauf (Etagenkoordinaten), denen Namen ausweichen. Zurueck kommen der
 *  SVG-Inhalt, das Bildformat und `project(index, x, y, z)`, mit dem das
 *  Panel seine Geraete in dasselbe Bild setzt.
 */
const houseScene = ({ floors, areasOf, pinsOf = () => [], dimensions = false }) => {
  const reference =
    floors.find((floor) => floor.ground) ||
    floors.find((floor) => !floor.unassigned && !floor.virtual) ||
    floors[0] || {};
  const W = houseMetres(reference);
  const D = W / houseAspect(reference);
  const dims = {
    W,
    D,
    h: clampShare(W, HOUSE3D.wall),
    T: clampShare(W, HOUSE3D.outer),
    t: clampShare(W, HOUSE3D.inner),
    slab: clampShare(W, HOUSE3D.slab),
  };
  const camera = cameraOf(W, D);
  const { eye, project } = camera;

  const storeys = floors.map((floor) =>
    storeyOf(floor, areasOf(floor), dims, pinsOf(floor), { dimensions }));

  // Wie hoch jedes Geschoss im Bild ist: alles, was es hat, plus die Flucht
  // des Bezugsgeschosses, damit ein leeres nicht zu nichts zusammenfaellt.
  const boundsOf = (storey) => {
    const points = [];
    const add = (p) => points.push(project(p));
    const house = [[0, 0], [W, 0], [W, D], [0, D]];
    for (const [x, y] of house) {
      add(v3(x, y, -dims.slab));
      add(v3(x, y, dims.h));
    }
    for (const p of [...storey.plates, ...storey.standing]) p.pts.forEach(add);
    for (const item of storey.flat) item.pts.forEach(add);
    for (const chain of storey.chains) {
      for (const row of chain.rows) {
        for (const x of row.stops) add(v3(x, row.y + 0.3, chain.z));
      }
    }
    const pad = storey.chains.length ? HOUSE3D.dim + 6 : 0;
    return {
      x0: Math.min(...points.map((p) => p.x)),
      x1: Math.max(...points.map((p) => p.x)),
      y0: Math.min(...points.map((p) => p.y)),
      y1: Math.max(...points.map((p) => p.y)) + pad,
    };
  };
  const bounds = storeys.map(boundsOf);

  // Von oben nach unten stapeln. Nur senkrecht versetzt -- waagerecht
  // bleibt jedes Geschoss, wo die Kamera es hinstellt, und damit in Flucht.
  const shift = [];
  let cursor = 0;
  bounds.forEach((box, index) => {
    shift[index] = cursor - box.y0;
    cursor += box.y1 - box.y0 + HOUSE3D.gap;
  });

  const minX = Math.min(...bounds.map((b) => b.x0));
  const maxX = Math.max(...bounds.map((b) => b.x1));
  // So viel Rand, wie der laengste Etagenname braucht. Geschaetzt statt
  // gemessen -- das SVG entsteht, bevor es irgendwo haengt --, und lieber
  // grosszuegig: zu viel Rand sieht man kaum, zu wenig schneidet ab.
  const longest = Math.max(0, ...floors.map((floor) => String(floor.name || "").length));
  const gutter = longest * HOUSE3D.storey * 0.72 + 40;
  const left = minX - gutter - HOUSE3D.margin;
  const top = -HOUSE3D.margin;
  const width = maxX - left + HOUSE3D.margin;
  const height = cursor - HOUSE3D.gap + 2 * HOUSE3D.margin;

  const at = (index) => (p) => {
    const q = project(p);
    return { x: q.x - left, y: q.y + shift[index] - top };
  };

  // Unten zuerst: ein hoeheres Geschoss liegt naeher an der Kamera.
  const parts = [];
  for (let index = storeys.length - 1; index >= 0; index -= 1) {
    const storey = storeys[index];
    const P = at(index);
    let svg = "";

    const plates = [];
    walkBsp(buildBsp(storey.plates), eye, plates);
    for (const p of plates) svg += polySvg(p, P);

    for (const item of storey.flat) {
      svg += `<path class="l ${item.cls}" d="${pathOf(item.pts.map(P), item.closed)}"/>`;
    }

    const standing = [];
    walkBsp(buildBsp(storey.standing), eye, standing);
    for (const p of standing) svg += polySvg(p, P);

    for (const cap of storey.caps) {
      if (cap.loops) {
        if (!cap.loops.length) continue;
        const d = cap.loops
          .map((loop) => pathOf(loop.map((q) => P(v3(q.x, q.y, dims.h))), true))
          .join("");
        svg += `<path class="f cap" fill-rule="evenodd" d="${d}"/>`;
        svg += `<path class="l cap" d="${d}"/>`;
      } else {
        svg += polySvg(cap, P);
      }
    }
    for (const w of storey.windows) svg += polySvg(w, P, "window");

    for (const label of storey.labels) {
      if (!label.text) continue;
      const spot = P(label.at);
      // So gross, wie der Raum es zulaesst -- und nie groesser als die
      // Voreinstellung. Eine Kammer bekommt eine kleinere Schrift, keinen
      // Namen quer ueber die Nachbarwand.
      const room = P(v3(label.at.x + label.width / 2, label.at.y, 0)).x -
        P(v3(label.at.x - label.width / 2, label.at.y, 0)).x;
      const fits = (room * 0.86) / Math.max(1, label.text.length * 0.68);
      const size = Math.max(9, Math.min(HOUSE3D.label, fits));
      svg += `<g data-at-x="${num(spot.x)}" data-at-y="${num(spot.y)}"
        transform="translate(${num(spot.x)},${num(spot.y)})"><text
        class="h3-room" font-size="${num(size)}" dy="0.35em">${escapeText(
  label.text.toLocaleUpperCase("de-DE"),
)}</text></g>`;
    }

    for (const chain of storey.chains) {
      for (const row of chain.rows) {
        const ends = row.stops.map((x) => P(v3(x, row.y, chain.z)));
        let lines = pathOf([ends[0], ends[ends.length - 1]], false);
        row.stops.forEach((x, i) => {
          const foot = P(v3(x, chain.from + 0.15, chain.z));
          const tip = P(v3(x, row.y + 0.25, chain.z));
          const at = ends[i];
          lines += pathOf([foot, tip], false);
          lines += pathOf([
            { x: at.x - HOUSE3D.tick, y: at.y + HOUSE3D.tick },
            { x: at.x + HOUSE3D.tick, y: at.y - HOUSE3D.tick },
          ], false);
        });
        svg += `<path class="l dim" d="${lines}"/>`;
        row.values.forEach((text, i) => {
          const a = ends[i];
          const b = ends[i + 1];
          // Ein Mass, das nicht zwischen seine Striche passt, entfaellt --
          // die Striche bleiben.
          if (text.length * HOUSE3D.dim * 0.6 > Math.abs(b.x - a.x) - 6) return;
          svg += `<text class="h3-dim" x="${num((a.x + b.x) / 2)}" y="${num((a.y + b.y) / 2 - 6)}"
            font-size="${HOUSE3D.dim}">${escapeText(text)}</text>`;
        });
      }
    }

    const floor = floors[index];
    const box = bounds[index];
    const nameAt = {
      x: box.x0 - left - 24,
      y: (box.y0 + box.y1) / 2 + shift[index] - top,
    };
    const name = `<text class="h3-storey" x="${num(nameAt.x)}" y="${num(nameAt.y)}"
      font-size="${HOUSE3D.storey}" dy="0.35em">${escapeText(
  String(floor.name || "").toLocaleUpperCase("de-DE"),
)}</text>`;

    parts.push(`<g class="h3-floor" data-floor="${escapeText(floor.id)}">${svg}${name}</g>`);
  }

  return {
    svg: parts.join(""),
    width: Math.ceil(width),
    height: Math.ceil(height),
    /** Ein Punkt der Etage `index` (Etagenkoordinaten) im Bild. */
    project: (index, x, y, z = 0.05) => at(Math.max(0, Math.min(storeys.length - 1, index)))(
      v3(x * W, y * D, z),
    ),
  };
};

export {
  HOUSE3D,
  houseScene,
  unionLoops,
  buildBsp,
  walkBsp,
  splitPoly,
  poly,
  cameraOf,
};
