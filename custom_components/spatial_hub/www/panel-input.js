/**
 * Spatial Hub -- die Eingaben: Zeiger, Rad, Tasten, Klicks.
 *
 * Zweiundzwanzig Methoden, die auf Ereignisse antworten. Sie aendern
 * den Zustand des Panels und stossen Neuzeichnen an; keine erzeugt
 * HTML.
 *
 * Die neun ``_click*``-Abschnitte gehoeren zusammen und stehen in der
 * Reihenfolge, in der ``_onClick`` sie fragt. Diese Reihenfolge ist
 * Verhalten und keine Sortierung: jeder Knopf hat Vorrang vor der
 * Auswahl darunter.
 *
 * Wie bei der Ansicht sind die Rumpfe unveraendert und werden unten in
 * spatial-hub-panel.js an den Prototyp gehaengt.
 */
import {
  along,
  inFrame,
  inFrameY,
  shapeOf,
  spanY,
  yFrame,
  boxOf,
  hasShape,
  kindOf,
  AREA_KIND,
  OPENING,
  openingRun,
} from "./panel-geometry.js";
import { qualityColour, stateColour } from "./panel-colour.js";
import { DOMAIN, SHEET, ZOOM } from "./panel-const.js";


export const EINGABEN = {
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
  },

  _onSheetMove(event) {
    const drag = this._sheet;
    if (!drag || event.pointerId !== drag.id) return;
    drag.at = event.clientY;
    // Nur nach unten. Nach oben zu ziehen wuerde das Blatt ueber den
    // Bildschirmrand schieben, und dahinter ist nichts.
    const moved = Math.max(0, drag.at - drag.from);
    drag.sheet.style.transform = `translateY(${moved}px)`;
    event.preventDefault();
  },

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
  },

  _onWheel(event) {
    if (!event.deltaY) return;
    event.preventDefault();
    this._zoomBy(event.deltaY < 0 ? ZOOM.step : 1 / ZOOM.step, {
      x: event.clientX,
      y: event.clientY,
    });
  },

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
  },

  _onTouchMove(event) {
    // Wer schiebt, will nicht auswaehlen. Ein bisschen Wackeln ist kein
    // Schieben -- eine Hand haelt nicht auf das Pixel genau still.
    if (this._press && event.touches && event.touches.length) {
      const { clientX, clientY } = event.touches[0];
      if (
        Math.hypot(clientX - this._press.from.x, clientY - this._press.from.y) >
        // Ueber `this.constructor` und nicht ueber den Klassennamen: die
        // Methode steht jetzt in einer eigenen Datei, in der es den Namen
        // nicht gibt. Ihn zu importieren waere ein Ring -- das Panel
        // importiert diese Datei bereits.
        this.constructor.PRESS.slack
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
  },

  _onTouchEnd() {
    this._pinch = null;
    this._cancelLongPress();
  },

  _onContextMenu(event) {
    const target = this._menuFor(event.composedPath());
    // Ausserhalb des Plans bleibt das Menue des Browsers. Wer auf einer
    // Leiste rechtsklickt, will kopieren oder untersuchen, nicht bauen.
    if (!target) return;
    event.preventDefault();
    this._menu = { ...target, x: event.clientX, y: event.clientY };
    this._render();
  },

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

    const openingGrip = find("data-opening");
    const plotGrip = find("data-plot-index");
    const cornerGrip = find("data-corner-area");
    const shapeGrip = find("data-shape-index");
    const grip = find("data-resize-area");
    const areaElement = find("data-area");
    const nodeElement = find("data-node");
    const anyGrip = plotGrip || cornerGrip || shapeGrip || openingGrip;
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

    const target = openingGrip
      ? {
          mode: "opening",
          section: "areas",
          key: openingGrip.getAttribute("data-opening"),
          index: Number(openingGrip.getAttribute("data-opening-index")),
          element: openingGrip,
        }
      : plotGrip
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
        target.mode === "opening"
          ? { doors: (this._area(target.key) || {}).doors || [] }
          : target.mode === "corner"
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
        target.section === "areas" &&
        target.mode !== "corner" && target.mode !== "opening"
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
  },

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
        this._noSnap(event) ? value
          : Math.round((value * span) / 0.02) * 0.02 / span;
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

    if (drag.mode === "opening" && drag.start) {
      // Eine Oeffnung laeuft auf ihrer Wand und nirgendwo sonst. Der
      // Zeiger sagt, wo im Raum er ist; daraus wird der Anteil entlang
      // genau der einen Kante -- deshalb ist das hier kein
      // Verschieben in zwei Achsen, sondern in einer.
      const area = this._area(drag.key) || {};
      const doors = (area.doors || []).map((door) => ({ ...door }));
      const door = doors[drag.index];
      if (!door) return;
      const width = drag.start.right - drag.start.left || 1;
      const height = drag.start.bottom - drag.start.top || 1;
      // Kante 0 und 2 laufen in x, Kante 1 und 3 in y. Und 2 und 3
      // laufen rueckwaerts -- die Kontur laeuft im Uhrzeigersinn, also
      // ist "vorne" von rechts nach links.
      const side = Number(door.side);
      const raw = side === 0
        ? (x - drag.start.left) / width
        : side === 1
        ? (y - drag.start.top) / height
        : side === 2
        ? 1 - (x - drag.start.left) / width
        : 1 - (y - drag.start.top) / height;
      // Nicht ueber die Ecke hinaus: eine Oeffnung, deren Mitte am
      // Kantenende sitzt, ragt zur Haelfte in die Nachbarwand, und dort
      // ist sie kein Loch, sondern ein Fehler.
      const half = Math.min(Math.max(Number(door.width) || 0, 0), 1) / 2;
      const at = Math.min(1 - half, Math.max(half, raw));
      doors[drag.index] = {
        ...door,
        at: this._noSnap(event) ? at : Math.round(at * 20) / 20,
      };
      drag.value = { doors };
      // Sofort auf dem Element, damit die Oeffnung dem Zeiger folgt und
      // nicht erst beim Loslassen springt.
      const [from, to] = openingRun(doors[drag.index]);
      const start = `${(from * 100).toFixed(2)}%`;
      const span = `${((to - from) * 100).toFixed(2)}%`;
      if (side === 0 || side === 2) {
        drag.element.style.left = start;
        drag.element.style.width = span;
      } else {
        drag.element.style.top = start;
        drag.element.style.height = span;
      }
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
  },

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
  },

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
  },

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
      // Ganz zum Schluss vor der Auswahl: eine Wand ist die groesste
      // Trefferflaeche im Bild, und ein Knopf, der darauf liegt, soll
      // sein eigener Knopf bleiben.
      this._clickOpenings,
      this._clickSelection,
    ];
    for (const abschnitt of abschnitte) {
      if (abschnitt.call(this, hit, event, stage)) return;
    }
  },

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
  },

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
  },

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
    if (hit("data-grid")) {
      this._snapOff = !this._snapOff;
      this._render();
      return true;
    }
    return false;
  },

  /** Oeffnungen direkt am Grundriss: setzen, entfernen.
   *
   *  Der Weg ueber den Dialog bleibt -- fuer genaue Zahlen ist ein
   *  Regler besser als eine Hand. Aber der uebliche Fall ist "hier soll
   *  eine Tuer hin", und dafuer war er drei Klicks und zwei Regler zu
   *  lang: Zahnrad, ans Ende des Dialogs, "+ hinten", schieben, schieben.
   *
   *  Verschoben wird gezogen; das steht in `_onPointerDown`. Hier steht
   *  nur, was ein Klick tut, der nichts gezogen hat.
   *
   *  Gibt `true` zurueck, wenn der Klick hier verbraucht wurde.
   */
  _clickOpenings(hit, event, stage) {
    if (!this._editRooms) return false;

    // Alt auf einer vorhandenen Oeffnung entfernt sie -- dieselbe Geste,
    // mit der auch eine Ecke verschwindet.
    const opening = hit("data-opening");
    if (opening && (event.altKey || event.metaKey)) {
      const area = this._area(opening.getAttribute("data-opening"));
      const index = Number(opening.getAttribute("data-opening-index"));
      if (area) {
        this._setDoors(area, (doors) =>
          doors.filter((_door, at) => at !== index));
      }
      return true;
    }
    if (opening) return true;

    // Und ein Klick auf eine Wand setzt dort eine. Welche Wand und wo
    // darauf, sagt der Zeiger: der Raum ist ein Rechteck, also ist die
    // naechste Kante die mit dem kleinsten Abstand.
    //
    // Aber nur, wenn der Klick nichts anderes gemeint hat. Die acht
    // Griffe sitzen genau dort, wo auch die Waende sind -- ohne diese
    // Zeile bekommt jeder Griff, den jemand antippt statt zieht, eine
    // Tuer geschenkt. Dasselbe gilt fuer die Knoepfe am Bereich und fuer
    // ein Geraet, das nah an einer Wand steht.
    if (hit("data-resize-area") || hit("data-corner-area") ||
        hit("data-shape-index") || hit("data-hide-area") ||
        hit("data-area-dialog") || hit("data-node") || hit("data-join-area")) {
      return false;
    }
    const areaElement = hit("data-area");
    if (!areaElement || !stage) return false;
    const area = this._area(areaElement.getAttribute("data-area"));
    if (!area || kindOf(area) !== AREA_KIND.INDOOR || hasShape(area)) {
      return false;
    }
    const box = boxOf(area);
    const { x, y } = this._toFloor(event, { frame: this._frame, stage,
                                            box: stage.getBoundingClientRect() });
    const width = box.right - box.left || 1;
    const height = box.bottom - box.top || 1;
    const u = (x - box.left) / width;
    const v = (y - box.top) / height;
    // Nur der Rand zaehlt. Ein Klick mitten im Raum meint den Raum und
    // nicht die naechstgelegene Wand -- sonst bekaeme jedes Verschieben,
    // das kein Verschieben wurde, eine Tuer geschenkt.
    const EDGE = 0.14;
    const near = [v, 1 - u, 1 - v, u];
    const side = near.indexOf(Math.min(...near));
    if (near[side] > EDGE) return false;
    // Auf welchem Anteil der Kante: dieselbe Rechnung wie beim Ziehen,
    // einschliesslich der zwei rueckwaerts laufenden Kanten.
    const raw = side === 0 ? u : side === 1 ? v : side === 2 ? 1 - u : 1 - v;
    const span = 0.2;
    const at = Math.min(1 - span / 2, Math.max(span / 2, raw));
    this._setDoors(area, (doors) => [
      ...doors,
      { side, at: Math.round(at * 20) / 20, width: span, kind: OPENING.DOOR },
    ]);
    return true;
  },

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
      const kind = doorAdd.getAttribute("data-add-kind") || OPENING.DOOR;
      // In der Mitte und knapp ein Fuenftel breit: eine Oeffnung, die
      // man sieht, und die man von dort aus dahin schiebt, wo sie
      // hingehoert. Ein Fenster etwas breiter -- ein Fenster von der
      // Breite einer Tuer sieht aus wie eine Tuer mit Bruestung.
      if (area) {
        this._setDoors(area, (doors) => [
          ...doors,
          { side, at: 0.5, width: kind === OPENING.WINDOW ? 0.3 : 0.2, kind },
        ]);
      }
      return true;
    }

    // Tuer und Fenster sind dasselbe Ding an derselben Stelle, nur
    // anders gebaut. Umschalten statt loeschen und neu setzen: die
    // Stelle, die jemand ausgesucht hat, ist die Arbeit daran.
    const openingKindChip = hit("data-opening-kind");
    if (openingKindChip && this._areaDialog) {
      const area = (this._model.areas || []).find(
        (candidate) => candidate.id === this._areaDialog,
      );
      const index = Number(openingKindChip.getAttribute("data-door"));
      const kind = openingKindChip.getAttribute("data-opening-kind");
      if (area) {
        this._setDoors(area, (doors) =>
          doors.map((door, at) => (at === index ? { ...door, kind } : door)));
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
  },

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
  },

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
  },

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
  },

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
  },

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
  },
};
