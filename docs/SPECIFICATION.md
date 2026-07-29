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

Provider und Hub sind über **ein Dict in `hass.data["spatial_hub_providers"]`
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

### Bauflucht

Jede Etage meldet ihre Außenwände als `outline` — ein Kasten
`{x, y, width, height}` in denselben Koordinaten, oder `null`, wenn die
Etage keine Innenräume hat.

Der Hub leitet ihn aus den Räumen der Etage ab; eine gespeicherte Angabe
schlägt die Ableitung. **Außenbereiche zählen nicht mit**: Der Garten ist
nicht das Gebäude, und ließe man die Terrasse die Flucht bestimmen, bliebe
genau der Versatz unsichtbar, den diese Angabe zeigen soll.

Ein Editor SOLLTE beim Bearbeiten einer Etage die `outline` der **anderen**
Etagen einblenden. Ein Haus ist ein Gebäude und seine Geschosse liegen
übereinander — aber jedes Geschoss ist ein eigener Reiter, und ohne die
fremde Kontur bleibt nur, sich das andere Geschoss zu merken.

Ein Renderer DARF Etagen **nicht** zur Deckungsgleichheit zwingen. Eine
Terrasse, ein Erker, ein zurückgesetztes Dachgeschoss sind der Normalfall,
kein Fehler; die Kontur ist eine Auskunft, keine Vorschrift.

### Bearbeiten ist zweierlei

Ein Renderer, der beides anbietet — Wände ziehen und Geräte einsortieren —
MUSS sie **trennen**. Beides gleichzeitig heißt keins von beiden: ein Griff
zwischen zwanzig Gerätepunkten trifft immer den Punkt, und ein Punkt zwischen
lauter Anfassern trifft immer den Anfasser.

Im Raum-Modus SOLL ein Renderer die Geräte **ausblenden**. Sie sind nicht
gelöscht, nur nicht im Weg, und ein Wechsel zurück holt sie sofort wieder.

### Räume, die keine Rechtecke sind

Ein Bereich DARF eine eigene Kontur `shape` tragen: eine Liste von mindestens
drei Punkten `{x, y}` in **Koordinaten seines eigenen Kastens** — `0,0` ist die
linke obere Ecke, `1,1` die rechte untere. Fehlt sie, ist der Bereich ein
Rechteck.

Bewusst kastenlokal: Der Kasten bleibt, was er war — er wird verschoben, an
seinen Wänden vergrößert und in der Hausansicht projiziert. Die Kontur fährt
darin mit, sodass ein breiter gezogener Raum seine Nische mitzieht, statt sie
von den Wänden zu reißen.

- Ein Renderer MUSS dieselbe Kontur in **jeder** Ansicht zeichnen. Eine Nische,
  die nur auf einem Reiter sichtbar ist, ist derselbe Fehler wie ein Raum, der
  in der einen Ansicht ein Rechteck und in der anderen eine Wolke ist.
- Eine unlesbare Kontur — zu wenige Punkte, keine Zahlen — fällt auf das
  Rechteck zurück. Ein Grundriss, der wegen einer kaputten Ecke nicht mehr
  zeichnet, ist das schlechtere Ergebnis.
- Keine Kontur ist **nicht** dasselbe wie ein Rechteck aus vier Punkten. Wer
  die letzte Ecke entfernt, löscht `shape` und gibt den Raum an die
  Wandgriffe zurück.

### Grundstück

Eine Etage DARF ein `plot` tragen: eine Liste von mindestens drei Punkten
`{x, y}` in **Etagenkoordinaten**, also derselben Ebene wie `position` — und
damit ausdrücklich auch außerhalb von `0..1`, dort, wo der Garten liegt.

Anders als die `outline` wird nichts davon abgeleitet. Home Assistant kennt
Räume, und ein Raum ist im Gebäude; wo das Grundstück endet, steht dort
nirgends. Ein `plot` existiert deshalb erst, wenn ihn jemand gezeichnet hat,
und `null` bedeutet: kein Grundstück, nicht "unbekannt".

Ein Renderer SOLL es **unter allem anderen** zeichnen. Es ist der Grund, auf
dem das Haus steht, und Nebengebäude — Garage, Gartenhütte — sind Außenbereiche
darauf, keine Geschosse.

Das Grundstück bestimmt, **wie viel Umgebung es gibt**. Ein Renderer MUSS
sein Sichtfenster so weit öffnen, dass ein gezeichnetes `plot` vollständig
hineinpasst; ein fester Rand um das Haus wäre eine Behauptung über fremde
Gärten. Das Haus bleibt dabei in der Mitte — es wird nicht kleiner, weil
jemand mehr Grundstück hat, es bekommt nur mehr Rand.

### Maße

Eine Etage DARF ein `metres` tragen: wie breit das Haus in der Wirklichkeit
ist. Genau diese eine Zahl, und alle anderen Längen der Etage rechnen sich
daraus.

Nichts DARF sie voraussetzen. Der Editor funktioniert nach Augenmaß —
ziehen, bis es aussieht wie zu Hause — und ein so gezeichneter Grundriss ist
ein gültiger Grundriss. `metres` ist die Antwort für die, die ihr Haus auf
den Zentimeter kennen, und sonst für niemanden; fehlt es, MUSS ein Renderer
schlicht keine Maße anzeigen statt eine erfundene Zahl.

### Wie deutlich das Haus ist

Ein Renderer SOLL die **Innenwände sichtbar** zeichnen, nicht nur andeuten:
ein Grundriss ohne sie ist eine Fläche mit Punkten darauf und beantwortet
nicht mehr die Frage, in welchem Raum man steht.

Wie stark, ist nicht festzulegen — das hängt am Haus, am Bildschirm und am
Geschmack. Ein Renderer SOLL es deshalb **einstellbar** machen (`house_weight`
im Theme, `0.2 … 1.6`) und MUSS Außenwände, Innenwände und Etagenplatten
gemeinsam bewegen, damit ihr Verhältnis zueinander erhalten bleibt. Der Wert
`0` ist verboten: ein verschwundenes Haus sieht aus wie ein Fehler, und der
Regler, der es getan hat, liegt drei Dialoge weit weg.

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

### Etagen, die keine sind

Home Assistant kennt **nur Etagen**. Wer einen Garten oder ein Netzdiagramm
unterbringen will, legt es also dort an, wo Etagen liegen — und es landet als
Stockwerk zwischen Keller und Erdgeschoss.

Eine Etage DARF deshalb dieselbe Art tragen wie ein Bereich (`kind`). Trägt sie
eine, gilt sie für **alles auf ihr**:

| Antwort | Quelle | Vorrang |
|---|---|---|
| gespeicherte Art **dieses Bereichs** | Editor | 1 (gewinnt immer) |
| Art der **Etage** | gespeichert, sonst aus dem Etagennamen geraten | 2 |
| Name des Bereichs | geraten | 3 |

Diese Reihenfolge ist normativ, und der mittlere Schritt ist der Grund für
diesen Abschnitt: Eine Etage „Draußen“ mit den Bereichen `Vorgarten`,
`Gartenhütte` und `Autos` wird sonst nur zu zwei Dritteln aufgelöst — die
ersten beiden wandern nach draußen, der dritte hält die Etage am Leben, und
übrig bleibt ein Garten, der immer noch ein Stockwerk ist.

Eine Etage, die selbst nicht `indoor` ist, DARF NICHT als Erdgeschoss gewählt
werden. Sonst wird der Garten zu der Etage, um die sich der Garten legt, und
hält sich damit selbst am Leben.

Jeder `virtual`-Bereich wird **einzeln** gezeichnet — eine Wolke pro Bereich.
Cloud, VPN und Server sind drei Dinge, nicht ein Kasten mit drei Kästen darin.

### Ohne Etage

Ein Knoten ohne Etage DARF NICHT in den Grundriss gezeichnet werden. Er gehört
in keinen Raum, also ist jede Position, die der Hub für ihn erfindet, eine
Behauptung, die der Nutzer anschließend widerlegen muss — und sie liegt über
einem Raster, das ohne ihn vermessen wurde.

Solche Knoten gehören in eine **Ablage außerhalb des Grundrisses**, auf jeder
Etage sichtbar, weil die Zuordnung in Home Assistant passiert und nicht hier.
Ist die Ablage leer, verschwindet sie.

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

### Der Himmel

Eine virtuelle Etage ist keine Etage, sondern der Himmel über dem Haus.

- Sie wird **zuoberst** gezeichnet, unabhängig von der Reihenfolge, die Home
  Assistant gemeldet hat. Eine Wolkenebene, die ihre Höhe aus der Etagenliste
  erbt, landet zwischen zwei Geschossen — und das Internet ist nicht im ersten
  Stock.
- Sie MUSS **frei über dem Dach** schweben, nicht auf dem obersten Geschoss
  liegen. Der First steht über der obersten Ebene; eine Wolkenebene als
  gewöhnliche Platte landet darin statt darüber.
- Sie bekommt **dieselbe Weite wie der Garten** (`-margin … 1+margin`). In den
  Grundriss gequetscht liest sich eine Wolke als Raum im Dachgeschoss.
- Sie trägt **keine Bodenplatte und keinen Rand**. Dort oben sind die Wolken
  die ganze Ebene.

---

## Capabilities

Ein Provider beschreibt sich selbst; der Hub schaltet danach Funktionen frei
und behandelt nie eine Integration namentlich als Sonderfall.

`nodes` · `edges` · `history` · `animation` · `popup` · `actions` ·
`custom_icons`

## Websocket

| Kommando | Zweck |
|---|---|
| `spatial_hub/model` | das komplette räumliche Modell |
| `spatial_hub/providers` | wer registriert ist, und was er kann |
| `spatial_hub/subscribe` | Push-Hinweis bei Änderungen (nur der Grund, nie das Modell) |
| `spatial_hub/layout/set` | Nutzeranordnung speichern |
| `spatial_hub/layout/reset` | Overrides eines Objekts verwerfen |
| `spatial_hub/history` | Zeitreihe zu Node oder Edge |
| `spatial_hub/action` | Provider-Action ausführen (Admin) |
| `spatial_hub/diagnostics` | was jeder Provider geliefert hat, inklusive Fehler |
| `spatial_hub/entities/facets` | welche Arten, Label und Geräteklassen es im Haus gibt |

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
