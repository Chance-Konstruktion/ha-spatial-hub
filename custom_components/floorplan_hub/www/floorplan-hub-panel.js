/**
 * Floorplan-Hub -- the built-in renderer.
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

const DOMAIN = "floorplan_hub";

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
const STACK = { pad: 40, width: 620, depth: 300, skew: 260, top: 50, gap: 230 };

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

class FloorplanHubPanel extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._model = null;
    this._error = null;
    // The house as a whole is the first thing to show. A single storey
    // is a detail of it, not the other way round.
    this._floorId = ALL_FLOORS;
    this._selected = null; // { kind, id }
    this._history = null;
    this._placing = null; // { section, key } -- next stage click places it
    this._showDiagnostics = false;
    this._diagnostics = null;
    this._unsubscribe = null;
    this._pending = false;
    this._edit = false;
    this._drag = null; // live pointer drag, never persisted until release
    this._dragged = false; // suppresses the click that follows a drag
    this._floorDialog = false;
    this._themeDialog = false;
    this._layerDialog = null; // the custom layer being written
    this._facets = null;
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
    if (this._hass && !this._unsubscribe) this._connect();
  }

  disconnectedCallback() {
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
      console.warn("Floorplan-Hub: no live updates", err);
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

  async _setLayout(section, key, values) {
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

  // ── Derived model ───────────────────────────────────────

  get _floors() {
    return (this._model && this._model.floors) || [];
  }

  get _stacked() {
    return this._floorId === ALL_FLOORS && this._floors.length > 1;
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
    const floors = this._floors;
    const real = floors.filter((floor) => !floor.unassigned).reverse();
    return [...real, ...floors.filter((floor) => floor.unassigned)];
  }

  /** Where a point on a given floor lands in the stacked drawing. */
  _project(floorIndex, x, y) {
    const gap = Math.min(
      STACK.gap,
      (1000 - STACK.top - STACK.depth) / Math.max(1, this._floors.length - 1),
    );
    return {
      x: STACK.pad + x * STACK.width + (1 - y) * STACK.skew,
      y: STACK.top + floorIndex * gap + y * STACK.depth,
    };
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
    return model.nodes.filter((node) => {
      if (hidden.has(this._providerOf(node.id))) return false;
      if (!node.position) return false;
      // A node with no floor belongs to no storey and would otherwise be
      // invisible everywhere. Better shown on each with a marker than lost.
      if (!node.floor_id || !floor) return true;
      return node.floor_id === floor.id;
    });
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
    return model.areas.filter(
      (area) => !floor || area.floor_id === floor.id,
    );
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
    root.addEventListener("input", (event) => this._onInput(event, false));
    root.addEventListener("change", (event) => this._onInput(event, true));
    root.innerHTML = `<div class="loading">Grundriss wird geladen …</div>`;
  }

  _render() {
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
    this._root.innerHTML = `
      ${this._headerHtml()}
      <div class="body">
        <main>${this._stageHtml()}</main>
        <aside>${this._sidebarHtml()}</aside>
      </div>
      ${this._showDiagnostics ? this._diagnosticsHtml() : ""}
      ${this._floorDialog ? this._floorDialogHtml() : ""}
      ${this._themeDialog ? this._themeDialogHtml() : ""}
      ${this._layerDialog ? this._layerDialogHtml() : ""}
      ${this._popupHtml()}
    `;
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
        ${
          this._edit
            ? `<button class="icon-btn" data-theme-dialog="1" title="Aussehen">
                 <ha-icon icon="mdi:palette-outline"></ha-icon>
               </button>
               <button class="icon-btn" data-floor-dialog="1" title="Etage einrichten">
                 <ha-icon icon="mdi:image-outline"></ha-icon>
               </button>
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

    const plans = floors.map((floor, at) => {
      const corners = [[0, 0], [1, 0], [1, 1], [0, 1]]
        .map(([x, y]) => this._project(at, x, y))
        .map((point) => `${point.x},${point.y}`)
        .join(" ");
      const label = this._project(at, 0, 0);
      const rooms = this._model.areas
        .filter((area) => area.floor_id === floor.id && area.position)
        .map((area) => this._roomPolygon(at, area))
        .join("");
      return `<g class="plane">
        <polygon class="storey" points="${corners}"/>
        ${rooms}
        <text class="storey-name" x="${label.x - 34}" y="${label.y - 6}"
          >${escapeHtml(floor.name)}</text>
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
          x1="${from.x}" y1="${from.y}" x2="${to.x}" y2="${to.y}"
          stroke="${this._qualityColour(edge.quality)}"
          stroke-width="${across ? 5 : 3}"
          ${edge.dashed ? 'stroke-dasharray="10 7"' : ""}
          data-edge="${escapeHtml(edge.id)}"/>`;
      })
      .join("");

    const nodes = this._visibleNodes
      .map((node) => {
        const at = spots.get(node.id);
        const selected =
          this._selected && this._selected.kind === "node" &&
          this._selected.id === node.id;
        const crowded = this._visibleNodes.filter(
          (other) => planeOf(other) === planeOf(node),
        ).length > 8;
        return `<g class="stack-node ${selected ? "on" : ""}
                   ${crowded ? "crowded" : ""}
                   ${node.floor_id ? "" : "floorless"}"
                   data-node="${escapeHtml(node.id)}"
                   transform="translate(${at.x},${at.y})">
          <circle r="11" fill="${this._stateColour(node.state)}"/>
          <text class="stack-label" y="26">${escapeHtml(node.label)}</text>
        </g>`;
      })
      .join("");

    return `<div class="stack">
      <svg viewBox="0 0 1000 1000">
        ${plans.join("")}
        ${edges}
        ${nodes}
      </svg>
    </div>
    <p class="hint">Alle Etagen auf einmal — die einzige Ansicht, in der eine
    Verbindung zwischen zwei Stockwerken überhaupt zu sehen ist. Zum
    Anordnen und für Details eine einzelne Etage wählen.</p>`;
  }

  _roomPolygon(plane, area) {
    const width = (area.size && area.size.width) || 0.3;
    const height = (area.size && area.size.height) || 0.3;
    const x0 = area.position.x - width / 2;
    const y0 = area.position.y - height / 2;
    const points = [[x0, y0], [x0 + width, y0], [x0 + width, y0 + height],
                    [x0, y0 + height]]
      .map(([x, y]) => this._project(plane, x, y))
      .map((point) => `${point.x},${point.y}`)
      .join(" ");
    const label = this._project(plane, x0, y0);
    return `<polygon class="room" points="${points}"/>
      <text class="room-label" x="${label.x + 6}" y="${label.y + 16}"
        >${escapeHtml(area.name)}</text>`;
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
    const banner = floor && floor.unassigned
      ? `<p class="banner">Diese Bereiche sind in Home Assistant keiner Etage
         zugeordnet. Sobald du das dort nachträgst, wandern sie von selbst auf
         die richtige Etage — hier ist nichts einzustellen.</p>`
      : model.providers.length
      ? ""
      : `<p class="banner">Dein Haus, direkt aus Home Assistant. Sobald eine
         Integration räumliche Daten liefert, erscheint sie hier von selbst —
         einzurichten ist dafür nichts.</p>`;

    if (this._stacked) return `${banner}${this._stackHtml()}`;

    const aspect = (floor && floor.aspect) || 1.6;
    const background = floor && floor.background;
    const nodes = this._visibleNodes;
    const edges = this._visibleEdges;

    return `
      ${banner}
      <div class="stage ${this._placing ? "placing" : ""} ${
        this._edit ? "editing" : ""
      } shape-${escapeHtml(this._theme.node_shape || "circle")}
        labels-${escapeHtml(this._theme.labels || "always")}
        rooms-${escapeHtml(this._theme.room_style || "outline")}"
           style="aspect-ratio:${aspect};${
             background
               ? `background-image:url('${escapeHtml(background)}')`
               : ""
           }">
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
      </div>
      ${
        this._edit && !this._placing
          ? `<p class="hint">Ziehen ordnet an, die Ecke eines Bereichs
             ändert seine Größe. <b>Shift</b> hält gedrückt das Raster aus.</p>`
          : ""
      }
      ${
        this._placing
          ? `<p class="hint">Klick auf den Grundriss setzt „${escapeHtml(
              this._placingLabel(),
            )}“. <button class="link" data-cancel-place="1">Abbrechen</button></p>`
          : ""
      }`;
  }

  _areasHtml() {
    return this._visibleAreas
      .filter((area) => area.position)
      .map((area) => {
        const size = area.size || { width: 0.3, height: 0.3 };
        return `
        <div class="area" data-area="${escapeHtml(area.id)}" style="
              left:${area.position.x * 100}%; top:${area.position.y * 100}%;
              width:${size.width * 100}%; height:${size.height * 100}%;">
          <span class="area-name">
            ${area.icon ? `<ha-icon icon="${escapeHtml(area.icon)}"></ha-icon>` : ""}
            ${escapeHtml(area.name)}
          </span>
          ${
            this._edit
              ? `<span class="grip" data-resize-area="${escapeHtml(area.id)}"
                       title="Größe ändern"></span>
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
        stroke-width="${edge.width || 2}"
        vector-effect="non-scaling-stroke"
        ${edge.dashed ? 'stroke-dasharray="6 5"' : ""}
        ${edge.directed ? 'marker-end="url(#arrow)"' : ""}`;
    const title = `<title>${escapeHtml(edge.label || edge.id)}</title>`;
    const [x1, y1] = [edge.from.x * 1000, edge.from.y * 1000];
    const [x2, y2] = [edge.to.x * 1000, edge.to.y * 1000];

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

  _nodeHtml(node) {
    const custom = this._customIcon(node);
    const colour =
      node.color || (custom && custom.default_color) || this._stateColour(node.state);
    const selected =
      this._selected &&
      this._selected.kind === "node" &&
      this._selected.id === node.id;
    const scale = (node.scale || 1) * (this._theme.node_size || 1);
    const icon = custom
      ? `<span class="custom-icon">${custom.svg}</span>`
      : `<ha-icon icon="${escapeHtml(node.icon || "mdi:circle-medium")}"></ha-icon>`;
    return `
      <button class="node ${selected ? "on" : ""} ${node.floor_id ? "" : "floorless"}"
        data-node="${escapeHtml(node.id)}"
        title="${escapeHtml(node.label)}${node.floor_id ? "" : " (keiner Etage zugeordnet)"}"
        style="left:${node.position.x * 100}%; top:${node.position.y * 100}%;
               --node-color:${escapeHtml(colour)}; --node-scale:${scale};
               ${node.rotation ? `--node-rotation:${node.rotation}deg;` : ""}">
        <span class="dot">${icon}</span>
        <span class="label">${escapeHtml(node.label)}</span>
      </button>`;
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

    const providers = (this._model.providers || [])
      .map(
        (provider) => `
        <li>
          ${provider.icon ? `<ha-icon icon="${escapeHtml(provider.icon)}"></ha-icon>` : ""}
          <span>${escapeHtml(provider.name || provider.id)}</span>
          <span class="muted">${escapeHtml(provider.version || "")}</span>
        </li>`,
      )
      .join("");

    return `
      <h3>Ebenen</h3>
      <div class="rows">${layers || '<p class="note">Keine Ebenen.</p>'}</div>
      ${tray}
      ${this._customLayersHtml()}
      ${this._hiddenTrayHtml()}
      <h3>Provider</h3>
      <ul class="providers">${providers}</ul>`;
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

    return `
      <div class="scrim" data-close="1"></div>
      <div class="popup" role="dialog">
        <div class="popup-head">
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
        ${
          item.entity_id
            ? `<button class="link" data-more-info="${escapeHtml(
                item.entity_id,
              )}">Entität öffnen</button>`
            : ""
        }
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

  /** Snap to a 2 % grid so rooms line up; Shift is the escape hatch. */
  _snap(value, event) {
    if (event.shiftKey) return Math.min(1, Math.max(0, value));
    return Math.min(1, Math.max(0, Math.round(value / 0.02) * 0.02));
  }

  _onPointerDown(event) {
    if (!this._edit || event.button !== 0) return;
    const path = event.composedPath();
    const find = (attribute) =>
      path.find(
        (element) =>
          element.getAttribute && element.getAttribute(attribute) !== null,
      );

    const stage = path.find(
      (element) => element.classList && element.classList.contains("stage"),
    );
    if (!stage) return;

    const grip = find("data-resize-area");
    const areaElement = find("data-area");
    const nodeElement = find("data-node");
    if (!grip && !areaElement && !nodeElement) return;

    // Buttons drawn on top of a draggable thing keep working.
    if (!grip && find("data-hide-area")) return;

    const target = grip
      ? { mode: "resize", section: "areas", key: grip.getAttribute("data-resize-area"),
          element: areaElement }
      : nodeElement
        ? { mode: "move", section: "nodes", key: nodeElement.getAttribute("data-node"),
            element: nodeElement }
        : { mode: "move", section: "areas", key: areaElement.getAttribute("data-area"),
            element: areaElement };

    event.preventDefault();
    this._dragged = false;
    this._drag = { ...target, stage, box: stage.getBoundingClientRect() };

    const move = (moveEvent) => this._onPointerMove(moveEvent);
    const up = (upEvent) => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      this._onPointerUp(upEvent);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  _onPointerMove(event) {
    const drag = this._drag;
    if (!drag) return;
    this._dragged = true;
    const x = (event.clientX - drag.box.left) / drag.box.width;
    const y = (event.clientY - drag.box.top) / drag.box.height;

    if (drag.mode === "resize") {
      // The grip sits at the bottom-right; the area is centred on its
      // position, so half the delta on each side keeps the centre still.
      const centreX = drag.element.offsetLeft / drag.box.width;
      const centreY = drag.element.offsetTop / drag.box.height;
      drag.value = {
        width: Math.min(1, Math.max(0.04, (x - centreX) * 2)),
        height: Math.min(1, Math.max(0.04, (y - centreY) * 2)),
      };
      drag.element.style.width = `${drag.value.width * 100}%`;
      drag.element.style.height = `${drag.value.height * 100}%`;
      return;
    }

    drag.value = { x: this._snap(x, event), y: this._snap(y, event) };
    drag.element.style.left = `${drag.value.x * 100}%`;
    drag.element.style.top = `${drag.value.y * 100}%`;
  }

  _onPointerUp() {
    const drag = this._drag;
    this._drag = null;
    if (!drag || !drag.value) return;
    if (drag.mode === "resize") {
      this._setLayout("areas", drag.key, {
        size: {
          width: Number(drag.value.width.toFixed(4)),
          height: Number(drag.value.height.toFixed(4)),
        },
      });
      return;
    }
    this._setLayout(drag.section, drag.key, {
      position: {
        x: Number(drag.value.x.toFixed(4)),
        y: Number(drag.value.y.toFixed(4)),
      },
    });
  }

  // ── Sliders and file pickers ────────────────────────────

  _onInput(event, committed) {
    const input = event.target;
    if (!input || !input.getAttribute) return;
    const attribute = (name) => input.getAttribute(name);

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
        console.warn("Floorplan-Hub: reset failed", section, key, err);
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

    const stage = path.find(
      (element) => element.classList && element.classList.contains("stage"),
    );

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
      const id = resetItem.getAttribute("data-reset-item");
      this._selected = null;
      this._hass
        .callWS({ type: `${DOMAIN}/layout/reset`, section: "nodes", key: id })
        .then(() => this._refresh())
        .catch(() => this._refresh());
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
      const x = Math.min(1, Math.max(0, (event.clientX - box.left) / box.width));
      const y = Math.min(1, Math.max(0, (event.clientY - box.top) / box.height));
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
      console.warn("Floorplan-Hub: history failed", err);
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
header { display:flex; align-items:center; gap:8px; padding:8px 12px;
         background:var(--fp-accent, var(--app-header-background-color, var(--primary-color,#03a9f4)));
         color:var(--app-header-text-color,#fff); }
.tabs { display:flex; gap:4px; flex-wrap:wrap; }
.tab { display:flex; align-items:center; gap:6px; border:0; border-radius:16px;
       padding:6px 14px; cursor:pointer; font:inherit; color:inherit;
       background:rgba(255,255,255,.15); }
.tab.on { background:rgba(255,255,255,.85); color:var(--primary-color,#03a9f4); }
.spacer { flex:1; }
.icon-btn { border:0; background:transparent; color:inherit; cursor:pointer;
            border-radius:50%; padding:6px; display:flex; }
.icon-btn.on { background:rgba(255,255,255,.25); }
.body { flex:1; display:flex; gap:16px; padding:16px; overflow:auto; align-items:flex-start; }
main { flex:1; min-width:0; }
aside { width:260px; flex:0 0 auto; background:var(--card-background-color,#fff);
        border-radius:12px; padding:12px 16px; box-shadow:var(--ha-card-box-shadow,0 1px 3px rgba(0,0,0,.12)); }
@media (max-width:800px) { .body { flex-direction:column; } aside { width:auto; align-self:stretch; } }

.stack { background:var(--fp-surface, var(--card-background-color,#fff));
         border-radius:12px; box-shadow:var(--ha-card-box-shadow,0 1px 3px rgba(0,0,0,.12));
         padding:8px; }
.stack svg { display:block; width:100%; height:auto; }
.storey { fill:none; stroke:var(--divider-color,rgba(128,128,128,.45)); stroke-width:2; }
.storey-name { font-size:26px; fill:currentColor; opacity:.65; text-anchor:end; }
.stack .room { fill:rgba(128,128,128,.10);
               stroke:var(--divider-color,rgba(128,128,128,.35)); stroke-width:1.5; }
.stack .room-label { font-size:17px; fill:currentColor; opacity:.5; }
.stack-edge { stroke-linecap:round; }
/* A connection between two storeys is the whole reason this view exists. */
.stack-edge.across { opacity:.95; }
.stack-node { cursor:pointer; }
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

.stage { position:relative; width:100%;
         background:var(--fp-surface, var(--card-background-color,#fff));
         border-radius:12px; background-size:cover; background-position:center;
         box-shadow:var(--ha-card-box-shadow,0 1px 3px rgba(0,0,0,.12)); overflow:hidden; }
.stage.placing { cursor:crosshair; outline:2px dashed var(--primary-color,#03a9f4); }
.edges { position:absolute; inset:0; width:100%; height:100%; pointer-events:none; }
.edge { pointer-events:stroke; cursor:pointer; opacity:.85; }
.edge.on { opacity:1; stroke-width:5; }
.edge.animated { stroke-dasharray:8 6; animation:flow 1.2s linear infinite; }
@keyframes flow { to { stroke-dashoffset:-28; } }

.area { position:absolute; transform:translate(-50%,-50%);
        border:1px dashed var(--divider-color,#e0e0e0); border-radius:10px;
        background:var(--secondary-background-color,#fafafa); opacity:.7; }
.area-name { position:absolute; top:6px; left:8px; font-size:12px;
             color:var(--secondary-text-color,#727272); display:flex; align-items:center; gap:4px; }

.node { position:absolute; transform:translate(-50%,-50%) scale(var(--node-scale,1));
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
.grip { position:absolute; right:-6px; bottom:-6px; width:14px; height:14px;
        border-radius:50%; background:var(--primary-color,#03a9f4);
        border:2px solid var(--card-background-color,#fff); cursor:nwse-resize; }
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
.popup { position:fixed; right:16px; bottom:16px; width:min(380px,calc(100vw - 32px));
         max-height:70vh; overflow:auto; background:var(--card-background-color,#fff);
         border-radius:14px; padding:16px; box-shadow:0 8px 24px rgba(0,0,0,.3); }
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

customElements.define("floorplan-hub-panel", FloorplanHubPanel);

// Exported so the test suite can drive the rendering logic without a
// browser. Home Assistant loads this file as a module and only ever uses
// the custom element above.
export { FloorplanHubPanel, HA_COLOURS };
