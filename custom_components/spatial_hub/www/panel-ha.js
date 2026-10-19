/**
 * Spatial Hub -- die Bausteine von Home Assistant.
 *
 * Das Panel soll aussehen wie ein Teil von Home Assistant, und der sicherste
 * Weg dahin ist, dessen eigene Elemente zu benutzen statt eigene nachzubauen:
 * `hass-tabs-subpage` fuer Kopfzeile und Reiter, `ha-button`, `ha-input`,
 * `ha-select`, `ha-switch`, `ha-dialog`, `ha-alert`. Eigenes CSS gibt es nur
 * fuer Abstaende und Anordnung.
 *
 * Zwei Regeln halten das ehrlich:
 *
 *  1. Jedes Element hat einen Rueckfall. `haDefined(tag)` fragt, ob Home
 *     Assistant es gerade kennt; wenn nicht, schreiben die Aufrufer das
 *     schlichte HTML von frueher. Fehlt ein Baustein, bleibt das Panel
 *     bedienbar -- es sieht nur nicht mehr nach Home Assistant aus.
 *  2. Dieses Modul kennt kein `document` beim Import. Die Tests laden das
 *     Panel ohne Browser; dort ist jedes Element "nicht definiert", und der
 *     Rueckfall ist exakt das Markup, das die Tests seit jeher pruefen.
 *
 * Die Elemente von HA laden sich erst, wenn eine Seite sie braucht. Wie
 * HACS holen wir sie ueber die Konfigurationsseite (`loadHaBlocks`).
 */

// Eigene Kopie statt `import` aus panel-markup.js: das importiert seinerseits
// dieses Modul (fuer die Tuerliste), und ein Ring waere die Folge.
const ESCAPES = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
const escapeHtml = (value) =>
  String(value ?? "").replace(/[&<>"']/g, (char) => ESCAPES[char]);

/** Kennt Home Assistant dieses Element gerade? Ohne Browser immer nein. */
export const haDefined = (tag) =>
  typeof customElements !== "undefined" &&
  typeof customElements.get === "function" &&
  Boolean(customElements.get(tag));

/** Die Elemente nachladen, die HA sonst nur auf der Konfigurationsseite
 *  definiert. Gibt immer ein Versprechen zurueck und wirft nie: Fehlt ein
 *  Baustein, nimmt der Aufbau das schlichte Element. */
export async function loadHaBlocks() {
  if (typeof document === "undefined" || typeof customElements === "undefined") {
    return;
  }
  if (typeof customElements.get !== "function") return;
  if (customElements.get("hass-tabs-subpage-data-table")) return;
  try {
    const resolver = document.createElement("partial-panel-resolver");
    const routes = resolver._getRoutes
      ? resolver._getRoutes([{ component_name: "config", url_path: "a" }])
      : resolver.getRoutes([{ component_name: "config", url_path: "a" }]);
    await routes.routes.a.load();
    const config = document.createElement("ha-panel-config");
    await config.routerOptions.routes.integrations.load();
  } catch (err) {
    // Der Rueckfall unten wartet trotzdem.
  }
  await Promise.race([
    customElements.whenDefined("hass-tabs-subpage-data-table"),
    new Promise((resolve) => setTimeout(resolve, 8000)),
  ]);
}

// Reine Zeichenketten, damit sie in den bestehenden Vorlagen stehen koennen.
// Die Aufrufer maskieren ihre Texte selbst (so war es immer); die Attribute
// hier werden maskiert.
const attr = (name, value) =>
  value === undefined || value === null || value === ""
    ? ""
    : ` ${name}="${escapeHtml(value)}"`;

/** Ein Knopf. `attrs` sind rohe Attribute (data-...), `text` fertiges HTML.
 *  appearance: filled | outlined | plain; variant: brand | danger. */
export const haBtn = ({
  attrs = "", text = "", icon = "", appearance = "outlined",
  variant = "brand", title = "", disabled = false, cls = "", size = "small",
}) =>
  `<ha-button ${attrs}${attr("class", cls)}${attr("title", title)}` +
  ` appearance="${appearance}" variant="${variant}"${attr("size", size)}` +
  `${disabled ? " disabled" : ""}>` +
  `${icon ? `<ha-icon slot="start" icon="${escapeHtml(icon)}"></ha-icon>` : ""}` +
  `${text}</ha-button>`;

/** Ein Symbolknopf. Das Symbol ist ein <ha-icon> im Knopf. */
export const haIconBtn = ({ attrs = "", icon, label = "", cls = "", on = false }) =>
  `<ha-icon-button ${attrs}${attr("class", `${cls}${on ? " on" : ""}`.trim())}` +
  `${attr("label", label)}${attr("title", label)}>` +
  `<ha-icon icon="${escapeHtml(icon)}"></ha-icon></ha-icon-button>`;

/** Eine Zeile mit Schalter, wie in den Einstellungen von HA. */
export const haSwitchRow = ({ attrs = "", checked = false, heading = "", description = "" }) =>
  `<ha-settings-row>` +
  `<span slot="heading">${heading}</span>` +
  (description ? `<span slot="description">${description}</span>` : "") +
  `<ha-switch ${attrs}${checked ? " checked" : ""}></ha-switch>` +
  `</ha-settings-row>`;

/** Ein Eingabefeld. `ha-input` meldet sich mit `input`. */
export const haInput = ({
  attrs = "", label = "", value = "", type = "", min, max, step,
  placeholder = "", hint = "", cls = "",
}) =>
  `<ha-input ${attrs}${attr("class", cls)}${attr("label", label)}` +
  `${attr("value", value)}${attr("type", type)}${attr("min", min)}` +
  `${attr("max", max)}${attr("step", step)}${attr("placeholder", placeholder)}` +
  `${attr("hint", hint)}></ha-input>`;

/** Eine Auswahl. `ha-select` nimmt seine Optionen als Eigenschaft und meldet
 *  `selected`; die Optionen reisen hier als JSON im Attribut und werden von
 *  `fillSelects` nach dem Einfuegen gesetzt. Werte muessen nicht leer sein. */
export const haSelect = ({ attrs = "", label = "", value = "", options = [] }) => {
  const list = options.map(([v, text]) => ({ value: String(v), label: String(text) }));
  return `<ha-select ${attrs}${attr("label", label)}` +
    ` data-ao="${escapeHtml(JSON.stringify(list))}"` +
    ` data-wert="${escapeHtml(value)}"></ha-select>`;
};

/** Optionen und Wert in alle ha-select unterhalb von `scope` eintragen. */
export function fillSelects(scope) {
  if (!scope || typeof scope.querySelectorAll !== "function") return;
  scope.querySelectorAll("ha-select[data-ao]").forEach((el) => {
    let options;
    try {
      options = JSON.parse(el.getAttribute("data-ao"));
    } catch (err) {
      options = [];
    }
    const value = el.getAttribute("data-wert") || "";
    el.removeAttribute("data-ao");
    // Der Wert, den wir selbst setzen, ist keine Eingabe des Nutzers: das
    // Panel merkt ihn sich und ueberhoert ein `selected` mit demselben Wert.
    el._eigen = value;
    el.options = options;
    el.value = value;
  });
}

/** Ein Schieberegler. HA hat `ha-slider`; ohne ihn bleibt der native. */
export const haSlider = ({ attrs = "", value, min, max, step, title = "" }) =>
  `<ha-slider ${attrs} labeled${attr("value", value)}${attr("min", min)}` +
  `${attr("max", max)}${attr("step", step)}${attr("title", title)}></ha-slider>`;

/** Eine Meldung. typ: error | warning | info | success. */
export const haAlert = (type, inner, { title = "", action = "" } = {}) =>
  `<ha-alert alert-type="${type}"${attr("title", title)}>${inner}` +
  `${action ? `<span slot="action">${action}</span>` : ""}</ha-alert>`;

/** Die Etagen als Reiter von HA. Die Pfade sind schlichte Umrisse, weil HA
 *  auf dem schmalen Schirm ein Symbol je Reiter in die untere Leiste setzt. */
export const ICON_HOUSE = "M12,16L19.36,10.27L21,9L12,2L3,9L4.63,10.27M12,18.54L4.62,12.81L3,14.07L12,21.07L21,14.07L19.38,12.81L12,18.54Z";
export const ICON_FLOOR = "M3,3H21V21H3V3M5,5V19H19V5H5Z";

/** Ein Teil der Adresse fuer eine Etage: /spatial/<teil>. */
export const HOUSE_SLUG = "haus";
export const floorSlug = (id, allId) =>
  id === allId ? HOUSE_SLUG : encodeURIComponent(String(id));

/** Nur Anordnung: Abstaende, Raster, Platz. Aussehen kommt von Home Assistant.
 *  Wird nur angehaengt, wenn der Rahmen von HA da ist -- das alte Stylesheet
 *  bleibt unberuehrt und ist der Rueckfall. */
export const HA_STYLES = `
hass-tabs-subpage { display:block; height:100%; }
.app.phone { height:100%; }
.app { background:var(--primary-background-color,#fafafa); }
header.ha { background:var(--card-background-color,#fff);
            color:var(--primary-text-color,#212121);
            border-bottom:1px solid var(--divider-color,#e0e0e0); }
header.ha .search-ha { flex:0 1 220px; min-width:120px; }
header.ha .zoom { color:var(--secondary-text-color,#727272); }
header.ha .zoom span { min-width:3.2em; text-align:center; }
.editbar ha-button.tool-ha { flex:0 0 auto; }
.tool-group { gap:4px; }
@media (max-width: 900px) {
  .tool-ha .tool-label { display:none; }
  .tool-group.mode .tool-ha .tool-label { display:inline; }
}
ha-icon-button.bars-btn { padding:0; --mdc-icon-button-size:40px; }
.links ha-button, .chips ha-button, .edit-buttons ha-button, .actions ha-button {
  flex:0 0 auto; }
.chips { display:flex; flex-wrap:wrap; gap:6px; margin:6px 0; }
.edit-buttons { display:flex; flex-wrap:wrap; gap:8px; margin-top:12px; }
.actions { display:flex; flex-wrap:wrap; gap:8px; margin-top:12px; }
.field-ha { display:block; margin:8px 0; }
.slider-row { display:flex; align-items:center; gap:8px; margin:8px 0; }
.slider-row > span { flex:0 0 auto; min-width:6em; color:var(--secondary-text-color,#727272); }
.slider-row ha-slider { flex:1 1 auto; min-width:0; }
.swatches { display:flex; flex-wrap:wrap; gap:8px 12px; align-items:center; margin:8px 0; }
ha-alert { display:block; margin:8px 0; }
.app > ha-card.diagnostics { margin:8px 16px; display:block; }
.app > ha-card.diagnostics .card-content { padding:0 16px 16px; }
ha-dialog ha-input, ha-dialog ha-select, ha-dialog ha-settings-row { display:block; }
ha-dialog ha-select { width:100%; margin:8px 0; }
ha-dialog ha-input { margin:8px 0; }
ha-dialog h3 { font-size:var(--ha-font-size-l,16px);
               font-weight:var(--ha-font-weight-medium,500); margin:16px 0 4px; }
ha-dialog .note { color:var(--secondary-text-color,#727272);
                  font-size:var(--ha-font-size-s,12px); margin:4px 0 8px; }
`;

/** Ein Dialog.
 *
 *  Mit `ha-dialog` ein Element, das Home Assistant mit Titel, Kreuz, Scrim und
 *  Esc selbst versorgt; `data-closer` sagt dem Panel, welche Aktion sein
 *  altes Kreuz hatte (siehe `_onDialogClosed`). Ohne `ha-dialog` das Blatt von
 *  frueher: Scrim, Kopf mit Kreuz, Inhalt. `title` ist roher Text. `footer`
 *  sind die Knoepfe: bei HA im Fuss des Dialogs, sonst am Ende des Inhalts. */
export const dialogShell = ({
  key, title, closer, cls = "popup", body = "", footer = "",
  footerCls = "edit-buttons", head = "", plainAttrs = "",
}) => {
  const safe = escapeHtml(title);
  if (haDefined("ha-dialog")) {
    return `<ha-dialog data-dlg="${key}" data-closer="${closer}" data-title="${safe}">` +
      `${head ? `<div class="dialog-head">${head}</div>` : ""}${body}` +
      `${footer ? `<div slot="footer" class="dialog-footer">${footer}</div>` : ""}` +
      `</ha-dialog>`;
  }
  return `
      <div class="scrim" ${closer}="1"></div>
      <div class="${cls}"${plainAttrs ? ` ${plainAttrs}` : ""}>
        <div class="popup-head">
          ${head}<h2>${safe}</h2>
          <button class="icon-btn" ${closer}="1">
            <ha-icon icon="mdi:close"></ha-icon>
          </button>
        </div>
        ${body}${footer ? `<div class="${footerCls}">${footer}</div>` : ""}
      </div>`;
};

/** Ein Knopf, der an- oder ausgeschaltet sein kann (Chip). `old` ist das
 *  schlichte Markup von frueher. */
export const haChip = ({ attrs, text, icon = "", on = false, old }) =>
  haDefined("ha-button")
    ? haBtn({ attrs, text, icon, appearance: on ? "filled" : "outlined" })
    : old;

/** Ein Textknopf ("link"). */
export const haLink = ({ attrs, text, old, danger = false }) =>
  haDefined("ha-button")
    ? haBtn({ attrs, text, appearance: "plain", variant: danger ? "danger" : "brand" })
    : old;

/** Ein Schalter mit Text, sonst die alte Haekchenzeile. */
export const haToggle = ({ attrs, checked, text, description = "", old }) =>
  haDefined("ha-switch") && haDefined("ha-settings-row")
    ? haSwitchRow({ attrs, checked, heading: text, description })
    : old;

/** Ein Regler mit Beschriftung, sonst der native. `old` ist die Zeile von frueher. */
export const haRange = ({ attrs, value, min, max, step, title = "", label = "", old }) =>
  haDefined("ha-slider")
    ? `<div class="slider-row">${label ? `<span>${label}</span>` : ""}` +
      `${haSlider({ attrs, value, min, max, step, title })}</div>`
    : old;
