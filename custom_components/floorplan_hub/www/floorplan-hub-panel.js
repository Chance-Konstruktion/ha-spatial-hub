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

/** Edge colours by the shared quality vocabulary. */
const QUALITY = {
  good: "var(--success-color, #4caf50)",
  fair: "var(--warning-color, #ff9800)",
  poor: "var(--error-color, #f44336)",
  unknown: "var(--disabled-text-color, #9e9e9e)",
};

/** Node colours by state. Anything else is a provider's own word, and gets
 *  the accent colour rather than being forced into online/offline. */
const STATE = {
  online: "var(--success-color, #4caf50)",
  offline: "var(--error-color, #f44336)",
  unknown: "var(--disabled-text-color, #9e9e9e)",
};

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
    this._floorId = null;
    this._selected = null; // { kind, id }
    this._history = null;
    this._placing = null; // { section, key } -- next stage click places it
    this._showDiagnostics = false;
    this._diagnostics = null;
    this._unsubscribe = null;
    this._pending = false;
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

  get _floor() {
    const floors = this._floors;
    return (
      floors.find((floor) => floor.id === this._floorId) || floors[0] || null
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
    return model.areas.filter(
      (area) => !floor || !area.floor_id || area.floor_id === floor.id,
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

    this._root.innerHTML = `
      ${this._headerHtml()}
      <div class="body">
        <main>${this._stageHtml()}</main>
        <aside>${this._sidebarHtml()}</aside>
      </div>
      ${this._showDiagnostics ? this._diagnosticsHtml() : ""}
      ${this._popupHtml()}
    `;
  }

  _headerHtml() {
    const floors = this._floors;
    const current = this._floor;
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
        <div class="tabs">${tabs}</div>
        <div class="spacer"></div>
        <button class="icon-btn ${this._showDiagnostics ? "on" : ""}"
                data-toggle="diagnostics" title="Diagnose">
          <ha-icon icon="mdi:stethoscope"></ha-icon>
        </button>
      </header>`;
  }

  _stageHtml() {
    const model = this._model;
    if (!model.providers.length) {
      return `<div class="empty">
        <h2>Noch kein Provider</h2>
        <p>Der Hub läuft, aber keine Integration liefert bisher räumliche
        Daten. Sobald eine es tut, erscheint sie hier von selbst — hier ist
        nichts einzurichten.</p>
      </div>`;
    }

    const floor = this._floor;
    const aspect = (floor && floor.aspect) || 1.6;
    const background = floor && floor.background;
    const nodes = this._visibleNodes;
    const edges = this._visibleEdges;

    return `
      <div class="stage ${this._placing ? "placing" : ""}"
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
        <div class="area" style="
              left:${area.position.x * 100}%; top:${area.position.y * 100}%;
              width:${size.width * 100}%; height:${size.height * 100}%;">
          <span class="area-name">
            ${area.icon ? `<ha-icon icon="${escapeHtml(area.icon)}"></ha-icon>` : ""}
            ${escapeHtml(area.name)}
          </span>
        </div>`;
      })
      .join("");
  }

  _edgeHtml(edge) {
    const colour = edge.color || QUALITY[edge.quality] || QUALITY.unknown;
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
    return `
      <line class="${classes}" data-edge="${escapeHtml(edge.id)}"
        x1="${edge.from.x * 1000}" y1="${edge.from.y * 1000}"
        x2="${edge.to.x * 1000}" y2="${edge.to.y * 1000}"
        stroke="${escapeHtml(colour)}"
        stroke-width="${edge.width || 2}"
        vector-effect="non-scaling-stroke"
        ${edge.dashed ? 'stroke-dasharray="6 5"' : ""}
        ${edge.directed ? 'marker-end="url(#arrow)"' : ""}
      ><title>${escapeHtml(edge.label || edge.id)}</title></line>`;
  }

  _nodeHtml(node) {
    const custom = this._customIcon(node);
    const colour =
      node.color ||
      (custom && custom.default_color) ||
      STATE[node.state] ||
      "var(--primary-color, #03a9f4)";
    const selected =
      this._selected &&
      this._selected.kind === "node" &&
      this._selected.id === node.id;
    const scale = node.scale || 1;
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
        <button class="row" data-layer="${escapeHtml(layer.id)}">
          <ha-icon icon="${
            layer.visible === false ? "mdi:eye-off-outline" : "mdi:eye-outline"
          }"></ha-icon>
          <span class="${layer.visible === false ? "muted" : ""}">
            ${escapeHtml(layer.name || layer.id)}
          </span>
        </button>`,
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
      <h3>Provider</h3>
      <ul class="providers">${providers}</ul>`;
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

  _onClick(event) {
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
         background:var(--app-header-background-color, var(--primary-color,#03a9f4));
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

.stage { position:relative; width:100%; background:var(--card-background-color,#fff);
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
.chip.on { background:var(--primary-color,#03a9f4); color:#fff; border-color:transparent; }
.providers { list-style:none; margin:0; padding:0; }
.providers li { display:flex; align-items:center; gap:6px; padding:3px 0; font-size:13px; }
.hint { font-size:13px; margin:8px 2px; }
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
          background:var(--primary-color,#03a9f4); color:#fff; }
.spark { width:100%; height:48px; margin-top:8px; }
`;

customElements.define("floorplan-hub-panel", FloorplanHubPanel);

// Exported so the test suite can drive the rendering logic without a
// browser. Home Assistant loads this file as a module and only ever uses
// the custom element above.
export { FloorplanHubPanel, QUALITY, STATE };
