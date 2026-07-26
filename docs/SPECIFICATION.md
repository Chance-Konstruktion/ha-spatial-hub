# Spatial Provider Specification

**Version 1.0** · Provider API v1 · SDK v4

Dieses Dokument beschreibt das räumliche Datenmodell und die Rollenverteilung
zwischen **Provider**, **Hub** und **Renderer**. Es ist normativ: Wo Code und
Spezifikation sich widersprechen, ist eines von beiden ein Fehler, und ein
Test in [`tests/test_specification.py`](../tests/test_specification.py) hält
die Vokabulare beider Seiten zusammen.

Es ist bewusst kein README. Ein README beschreibt eine Implementierung;
das hier beschreibt ein Format, das mehrere Implementierungen erfüllen
können — der eingebaute Renderer ist nur die erste.

## Rollen

| Rolle | Zuständig für | Ausdrücklich nicht zuständig für |
|---|---|---|
| **Provider** | Daten, plus optional die eigene visuelle Identität: Icons, Farben, Animationen | Layout, Kamera, Interaktion, Speicherung |
| **Hub** | Sammeln, Platzieren, Nutzeranordnung anwenden, Themes auflösen | Zeichnen, eine Integration kennen |
| **Renderer** | Darstellung und Interaktion | Daten erfinden, Provider unterscheiden |
| **Home Assistant** | die Datenquelle: Etagen, Bereiche, Geräte, Entitäten, Zustände | — |

Der Hub darf **keine einzige Integration beim Namen kennen**. Diese Regel
ist der Grund für fast jede Entscheidung weiter unten.

### Schlüsselwörter

**MUSS**, **SOLLTE**, **DARF** im Sinne von RFC 2119.

## Transport

Provider und Hub sind über **ein Dict in `hass.data["floorplan_hub_providers"]`
plus drei Dispatcher-Signale** gekoppelt. Kein Import in irgendeine Richtung,
keine Ladereihenfolge. Renderer sprechen ausschließlich Websocket-Kommandos
(§ Websocket).

Alle Werte sind JSON-serialisierbar. Die Spezifikation nennt Aufzählungen bei
ihrem **Wert** (`"outdoor"`), weil JSON keine Enums kennt; in Code SOLLEN
Implementierungen dafür Enums oder Konstanten benutzen — siehe § Area Type.

---

## § Node

Ein Ding, das irgendwo sitzt: ein Adapter, eine Lampe, ein Bett, ein Sensor.

| Feld | Typ | Pflicht | Bedeutung |
|---|---|---|---|
| `id` | string | ja | eindeutig beim Provider; der Hub stellt `provider:` voran |
| `label` | string | — | Anzeigename; leer ⇒ aus Home Assistant |
| `area_id` | string \| null | — | Bereich; leer ⇒ aus der Entität abgeleitet |
| `floor_id` | string \| null | — | Etage; leer ⇒ aus dem Bereich abgeleitet |
| `position` | Position \| null | — | siehe § Position; null ⇒ der Hub platziert |
| `state` | string | — | siehe unten; Voreinstellung `"unknown"` |
| `icon` | string | — | siehe § Icon |
| `color` | string | — | CSS-Farbe; überschreibt die Zustandsfarbe |
| `entity_id` | string \| null | — | die Entität dahinter |
| `device_id` | string \| null | — | das Gerät dahinter; der Hub füllt es aus der Registry |
| `actions` | Action[] | — | siehe § Action |
| `metadata` | object | — | frei; landet im Popup |

Vom Hub ergänzt: `entities` (die Entitäten des Geräts, für das Popup) sowie
`scale`, `rotation` und `label_offset` aus der Nutzeranordnung.

Eine **nackte Entity-ID ist ein vollständiger Node**. `"light.kitchen"` ist
gleichwertig zu `{"id": "light.kitchen", "entity_id": "light.kitchen"}`, und
Name, Bereich, Etage, Icon, Gerät und Zustand kommen aus Home Assistant.

### Zustände

Ein Provider DARF jeden String senden — `"heating"` und `"docked"` bedeuten
etwas, und sie einzuebnen würde Information vernichten. Diese fünf SOLLEN
Renderer von sich aus einfärben können:

`online` · `offline` · `on` · `off` · `unknown`

`unavailable`, `unknown` und Leerstrings aus Home Assistant werden auf
`"unknown"` normalisiert. Sonst nichts.

## § Edge

Eine Beziehung zwischen zwei Nodes: eine Verbindung, ein Fluss, ein Weg.

| Feld | Typ | Pflicht | Bedeutung |
|---|---|---|---|
| `id` | string | — | Voreinstellung `"<source>__<target>"` |
| `source`, `target` | string | ja | Node-IDs ohne Namespace |
| `label` | string | — | z. B. `"320 Mbit/s"` |
| `value` | number \| null | — | numerischer Messwert |
| `quality` | string | — | `good` · `fair` · `poor` · `unknown` |
| `color` | string | — | überschreibt die Qualitätsfarbe |
| `width` | number | — | Strichstärke, Voreinstellung 2 |
| `directed` | bool | — | Pfeilspitze |
| `dashed` | bool | — | gestrichelt; die Konvention für Schätzungen |
| `animated` | bool | — | Fluss-Animation |
| `actions` | Action[] | — | siehe § Action |
| `metadata` | object | — | frei |

`quality` ist die einzige Aussage über Güte. Eine Kante zwischen zwei Nodes,
von denen einer weggefallen ist, wird verworfen — eine Linie ins Nichts ist
schlimmer als eine fehlende Linie.

## § Layer

Eine Scheibe des Grundrisses, einzeln schaltbar.

| Feld | Typ | Bedeutung |
|---|---|---|
| `id` | string | eindeutig |
| `name`, `icon` | string | Beschriftung |
| `z_index` | int | Zeichenreihenfolge, Voreinstellung 10 |
| `opacity` | number | 0…1 |
| `visible` | bool | Nutzerentscheidung, wird gespeichert |
| `provider_id` | string | Eigentümer; vom Hub gesetzt |

Ein Provider ohne eigenen Layer bekommt einen. Nodes tragen keinen Layer,
sie gehören ihrem Provider: Ein Provider verschwindet vom Plan, wenn **alle**
seine Layer unsichtbar sind — nie halb, nie geraten.

## § Position

```json
{"x": 0.62, "y": 0.31, "z": 0.0}
```

Normalisierte Etagen-Koordinaten, nicht Pixel: dasselbe Modell rendert in
jeder Größe und in jedem Renderer. `z` ist freie Höhe für Renderer, die sie
können; 2D-Renderer ignorieren sie.

- Das Haus belegt **0…1** in x und y.
- Außenbereiche liegen **außerhalb** davon. Das Fenster einer Etage mit
  Außenbereich ist `-OUTDOOR_MARGIN … 1 + OUTDOOR_MARGIN`, aktuell
  **−0,28 … 1,28**. Der Hub meldet das pro Etage als `has_outdoor` und
  `outdoor_margin`; ein Renderer, der beides ignoriert, zeichnet das Haus
  weiterhin richtig und den Garten am Rand.
- Ein Provider SOLL **keine Position angeben**, wenn er sie nicht wirklich
  weiß. Der Hub setzt den Node in die Mitte seines Bereichs und verteilt
  mehrere auf ein Raster; die Nutzeranordnung schlägt beides.

## § Popup

Was beim Anklicken erscheint. Ein Renderer SOLL es **mittig über dem
Grundriss** zeigen, nicht am Rand, und er MUSS folgende Wege zurück nach
Home Assistant anbieten, soweit die Daten sie hergeben:

| Element | Bedingung |
|---|---|
| More-Info-Dialog | `entity_id` vorhanden |
| Gerät öffnen | `device_id` vorhanden |
| Entitäten anzeigen | `entities` nicht leer |
| Einstellungen | `entity_id` vorhanden |
| Provider-Ansicht | Provider meldet `panel_url` |

Dazu `metadata` als Tabelle, `history` bei entsprechender Capability, und
Actions (§ Action). `panel_url` MUSS ein Pfad innerhalb dieser Home-Assistant-
Instanz sein; alles andere wird verworfen.

## § Action

```json
{"id": "led_off", "label": "LED aus", "icon": "mdi:led-off", "confirm": true}
```

Der Hub führt nichts selbst aus. Er reicht `id` an den Provider durch, der
sie ausgelegt hat — *„toggle"* bedeutet bei einer Lampe etwas anderes als
bei einer Wärmepumpe. Actions sind **Admin-only**; `confirm: true` verlangt
eine Rückfrage vor dem Ausführen.

Der Provider bekommt `(kind, item_id, action_id, data)` mit `item_id` **ohne**
Namespace und antwortet mit einem Dict.

## § Theme

Ein Theme färbt das **gemeinsame Vokabular** — Zustände und Kantenqualität —
und **nie eine einzelne Integration**. Genau deshalb sieht die nächste
Integration, die dazukommt, von selbst richtig aus.

| Feld | Werte |
|---|---|
| `preset` | `auto` · `classic` · `blueprint` · `neon` · `paper` |
| `accent`, `surface`, `ink` | CSS-Farben |
| `state_colors` | Zustand → Farbe |
| `quality_colors` | Qualität → Farbe |
| `node_shape` | `circle` · `rounded` · `square` |
| `node_size` | 0,4…3 |
| `labels` | `always` · `hover` · `never` |
| `edge_style` | `straight` · `curved` |
| `room_style` | `outline` · `filled` · `none` |

Aufgelöst wird **im Hub**, nicht im Renderer: Ein zweiter Renderer bekommt
dieselben Farben, ohne ein einziges Preset nachzubauen. Ein leerer Farbwert
heißt *„erben"* (bei `auto`: vom Theme des Nutzers); wer nichts zu erben hat,
nimmt `theme.fallback`, das echte Farben enthält.

## § Icon

Die Reihenfolge, in der ein Icon gesucht wird — normativ:

1. **`icon_set` des Providers**, per Schlüssel aus `node.icon`
2. **`node.icon`** (bei Entity-Nodes: das in Home Assistant konfigurierte)
3. **Icon des Providers**

Ein Renderer DARF Geräte **nicht** als anonyme Punkte zeichnen. Hat eine
Entität überhaupt kein Icon, leitet der **Hub** eines aus Domain und
Geräteklasse ab — dort, nicht im Renderer, damit jeder Renderer dieselbe
Antwort erbt.

```python
icon_set={"mdi:lan-connect": {"svg": "<svg …>", "default_color": "#4caf50"}}
```

Als Schlüssel SOLLEN MDI-Namen dienen, die der Node ohnehin nennt: Ein
Renderer ohne Inline-SVG fällt damit auf dasselbe MDI-Icon zurück, und nichts
sieht falsch aus. Das ist die Hälfte, die dem Provider gehört — der Hub
entscheidet, **wo** ein Node gezeichnet wird, nie **wie** er aussieht.

## § Camera

Kein Datenfeld, sondern eine Zusage an den Nutzer. Ein konformer Renderer
MUSS in **allen** Ansichten anbieten:

| Geste | Erwartung |
|---|---|
| Mausrad | zoomt, verankert am Zeiger — was darunter liegt, bleibt darunter |
| Zwei Finger | zoomt, verankert an der Mitte zwischen ihnen |
| Ziehen | verschiebt |
| Fit-to-Screen | zeigt wieder alles, in einem Klick |

Das Verhalten MUSS in der Hausansicht identisch sein zu dem auf einer
einzelnen Etage. Die Kamera ist **Zustand des Renderers**, nicht des Modells:
Sie wird nicht gespeichert und nie an den Hub geschickt. Der eingebaute
Renderer begrenzt auf 0,4×…6×.

## § Area Type

Ein Bereich hat eine Art. Genau drei, und sie sind eine **Aufzählung**, kein
freier String:

| Wert | Bedeutung | Zeichnung |
|---|---|---|
| `indoor` | ein Raum | im Haus, 0…1 |
| `outdoor` | Garten, Terrasse, Garage, Einfahrt, Carport, Pool … | im Ring **um das Erdgeschoss** |
| `virtual` | Cloud, Internet, VPN — real genug zum Zeigen, in keinem Stockwerk | eigene Ebene über dem Dach |

**Ein Garten ist keine Etage.** Bekäme er eine, läge sie zwischen Keller und
Erdgeschoss, als könne man hinunter in den Garten steigen — und ein Haus mit
Vorgarten, Hintergarten und Terrasse hätte gleich drei davon. Stattdessen
gehören alle Außenbereiche zum Erdgeschoss und legen sich als Apron darum.
Eine Etage, die dadurch leer wird, verschwindet mit ihnen.

Implementierungen MÜSSEN gegen Konstanten vergleichen, nicht gegen Literale:

```python
from .const import AreaKind

if area["kind"] is AreaKind.OUTDOOR:      # richtig
if area["kind"] == "outside":             # der Fehler, um den es geht
```

Der Hub rät die Art aus dem Bereichsnamen (deutsch und englisch,
umlautunempfindlich). Die Vermutung ist billig, falsch zu sein: Ein Klick im
Editor korrigiert sie, und die Korrektur wird gespeichert.

**Umgang mit unbekannten Werten**, normativ:

- Am Websocket wird ein unbekannter Wert **abgelehnt**, mit einer Fehlermeldung,
  die die drei gültigen nennt. Ein Standard, der stillschweigend alles annimmt,
  ist keiner.
- Beim **Lesen gespeicherter Daten** wird eine eindeutige Beinahe-Schreibweise
  (`outside`, `garden`, `außen`, `cloud`, …) repariert und der Rest auf
  `indoor` gesetzt — mit einer Warnung im Log, die den Bereich, den Wert und
  die gültigen Werte nennt. Ein Grundriss verschwindet nicht wegen eines
  Tippfehlers, aber niemand rätselt still.

### Sandwich

Pro Bereich und pro Etage:

| Feld | Voreinstellung | Bedeutung |
|---|---|---|
| `in_sandwich` | `true` | in der Hausansicht zeigen |
| `single_only` | `false` | nur in der Einzelansicht — impliziert `in_sandwich: false` |

Eine ausgeklammerte Etage nimmt ihre Nodes mit; sonst schwebten sie über der
darunterliegenden und läsen sich, als gehörten sie dorthin.

---

## Capabilities

Ein Provider beschreibt sich selbst; der Hub schaltet danach Funktionen frei
und behandelt nie eine Integration namentlich als Sonderfall.

`nodes` · `edges` · `history` · `animation` · `popup` · `actions` ·
`custom_icons`

## Websocket

| Kommando | Zweck |
|---|---|
| `floorplan_hub/model` | das komplette räumliche Modell |
| `floorplan_hub/providers` | wer registriert ist, und was er kann |
| `floorplan_hub/subscribe` | Push-Hinweis bei Änderungen (nur der Grund, nie das Modell) |
| `floorplan_hub/layout/set` | Nutzeranordnung speichern |
| `floorplan_hub/layout/reset` | Overrides eines Objekts verwerfen |
| `floorplan_hub/history` | Zeitreihe zu Node oder Edge |
| `floorplan_hub/action` | Provider-Action ausführen (Admin) |
| `floorplan_hub/diagnostics` | was jeder Provider geliefert hat, inklusive Fehler |
| `floorplan_hub/entities/facets` | welche Arten, Label und Geräteklassen es im Haus gibt |

Ein **lesender** Renderer braucht davon zwei: `model` und `subscribe`.

## Fehlerverhalten

Provider-Code gilt als nicht vertrauenswürdig. Exception, Timeout (10 s) oder
Unsinn kosten den eigenen Layer für **genau einen Refresh** — nie den
Grundriss. Ein verworfener Node wird gezählt und in `diagnostics` mit Grund
gemeldet, statt still zu verschwinden. Unbekannte Schlüssel in einer
Registrierung werden als vermuteter Tippfehler gemeldet.

## Versionierung

- **`api_version`** (aktuell 1) ist der Vertrag. Eine Registrierung mit
  höherer Major-Version wird abgelehnt statt missverstanden.
- **`sdk_version`** (aktuell 4) ist die Revision der kopierten Shim-Datei.
  Eine ältere Kopie funktioniert weiter; der Hub notiert in der Diagnose,
  dass es eine neuere gibt.
- **Diese Spezifikation** wird mit ihrer eigenen Versionsnummer geführt.
  Ergänzungen erhöhen die Minor-Version; alles, was ein bestehender Provider
  oder Renderer neu lernen müsste, erhöht die Major-Version.
