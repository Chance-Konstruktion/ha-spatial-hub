# Spatial Provider Specification

**Version 1.0** · Provider API v1 · SDK v7

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

### Wie groß ein Bereich ist

Ein Bereich trägt zusätzlich ein `size`:

```json
{"width": 0.34, "height": 0.62}
```

In denselben Etagen-Koordinaten wie `position`, und `position` ist die
**Mitte** des Kastens, nicht seine Ecke — ein Raum reicht also von
`x - width/2` bis `x + width/2`. Ein Renderer, der die Ecke annimmt,
zeichnet jeden Raum um eine halbe Raumbreite verschoben.

Alles, was ein Bereich sonst an Geometrie trägt — `shape`, `doors` — ist
**kastenlokal** und rechnet gegen genau dieses Rechteck. Das ist der Grund
für die Aufteilung: Der Kasten wird verschoben, an den Wänden vergrößert und
in der Hausansicht projiziert, und der Inhalt fährt unverändert mit.

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

Ein Editor DARF an dieser Kontur einrasten lassen. Wenn er das tut, SOLLTE
er es nur an Konturen tun, die gerade **zu sehen** sind: Ein Magnet an
einer Linie, die niemand sieht, ist kein Einrasten, sondern ein Ruckeln
ohne erkennbaren Grund. Und er SOLLTE zeigen, *dass* eingerastet wurde —
eingerastet und knapp daneben sehen sonst gleich aus, bei einer blassen
Linie erst recht.

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
  in der einen Ansicht ein Rechteck und in der anderen etwas anderes ist.
- Eine unlesbare Kontur — zu wenige Punkte, keine Zahlen — fällt auf das
  Rechteck zurück. Ein Grundriss, der wegen einer kaputten Ecke nicht mehr
  zeichnet, ist das schlechtere Ergebnis.
- Keine Kontur ist **nicht** dasselbe wie ein Rechteck aus vier Punkten. Wer
  die letzte Ecke entfernt, löscht `shape` und gibt den Raum an die
  Wandgriffe zurück.

### Türen und Fenster

Ein Bereich DARF eine Liste `doors` tragen. Sie enthält **Öffnungen**, und
eine Öffnung ist keine eigene Form, sondern eine Angabe über die Wand.
Jeder Eintrag hat drei erforderliche Felder und ein optionales:

| Feld | Bedeutung |
|---|---|
| `side` | welche Kante — der Index in der Kontur, in derselben Reihenfolge, in der sie läuft. Ohne `shape` sind das die vier Kanten des Rechtecks: `0` hinten, `1` rechts, `2` vorne, `3` links |
| `at` | die **Mitte** der Öffnung auf dieser Kante, `0..1` von der einen Ecke zur anderen |
| `width` | wie viel der Kante die Öffnung einnimmt, `0..1` |
| `kind` | `"door"` oder `"window"`. Fehlt das Feld, ist es eine Tür |

Der Listenname `doors` ist älter als das Feld `kind` und bleibt, wie er ist:
Ihn umzubenennen hätte jede gespeicherte Anordnung entwertet, und dafür ist
ein besserer Name nicht genug.

Der Unterschied zwischen beiden Arten ist keine Farbe, sondern die Wand:

- Eine **Tür** ist eine **Lücke**. Die Wand hört davor auf und fängt dahinter
  wieder an.
- Ein **Fenster** sitzt **in** der Wand. Die Wand läuft durch — eine Wand,
  die unter dem Fenster aufhört, ist eine Tür.

Kastenlokal aus demselben Grund wie `shape`: Ein in Metern vermaßtes Türblatt
wanderte, sobald der Raum breiter gezogen wird. Als Anteil der Wand bleibt die
Öffnung, wo sie hingehört.

- Ein Renderer, der Wände mit Stärke zeichnet, MUSS die Lücke einer **Tür**
  durch die **ganze** Mauer führen — Wandfläche und Mauerkrone gleichermaßen.
  Nur die sichtbare Außenseite zu unterbrechen ergibt kein Durchgehen,
  sondern ein zugemauertes Fenster.
- Ein Renderer SOLL eine Öffnung in **jeder** Ansicht zeigen, in der er den
  Raum zeigt. Eine Öffnung, die nur in der Hausansicht erscheint, kann man in
  der Einzelansicht nicht setzen — man klickt, schiebt zwei Regler, und auf
  dem Bild passiert nichts. Genau das war hier der Fall.
- Ein `kind`, das der Renderer nicht kennt, SOLL wie `"door"` behandelt
  werden. Nichts zu zeichnen wäre eine Wand, die stillschweigend geschlossen
  ist.
- Öffnungen, die sich überlappen, SOLLEN als **eine** Öffnung gelten. Zwei
  Türen, die sich berühren, sind eine Tür, und ein Wandstück negativer Länge
  ist nichts, worüber ein Renderer nachdenken sollte.
- Ein Eintrag, der nicht gelesen werden kann — eine Kante, die es nicht gibt,
  keine Breite, `at` keine Zahl — wird **weggelassen**, nicht geraten. Eine
  halb erfundene Öffnung ist schlechter als gar keine.
- `width` erreicht nie `1`. Eine Wand, die vollständig Türöffnung ist, ist
  keine Wand mit einer Tür darin, sondern eine fehlende Wand — und dafür gibt
  es die gemeinsame Wand (§ Gemeinsame Wände).

Wie beim `shape` gilt: Der Hub speichert und liefert `doors` und **liest sie
nie**. Was eine Tür oder ein Fenster bedeutet, ist die Frage dessen, der den
Grundriss zeichnet.

### Hintergrundbild eines Bereichs

Ein Bereich DARF ein `background` tragen: ein Bild, das innerhalb seines
Kastens gezeichnet wird — ein Grundriss-Ausschnitt, ein Foto des Zimmers,
was auch immer beim Wiedererkennen hilft. Wie bei einer Etage ist es eine
Datenlänge (typischerweise eine `data:`-URL), keine Datei auf der Platte;
der Hub speichert und liefert sie und **liest sie nie**.

Es lebt im selben Kasten wie `position` und `size` und wandert mit, wenn der
Raum verschoben oder verändert wird. Trägt der Bereich zusätzlich `shape`,
wird das Bild auf dieselbe Kontur beschnitten wie die Füllung — sonst zeigt
es das ganze Rechteck.

### Treppen

Ein Renderer DARF einen Raum als **Treppe** zeichnen — als Stufen quer zur
Laufrichtung statt als leere Fläche. Es gibt dafür bewusst **keine eigene
Raumart**: Der Katalog in § Area Type ist das, was jeder Provider spricht,
und eine Stufe wird nie von einem Provider kommen. Sie ist ein Zeichendetail.

Woran ein Renderer sie erkennt, ist ihm überlassen; der eingebaute nimmt
Name und Symbol, so wie der Hub auch Außenbereiche aus dem Namen rät. Ein
Renderer, der Treppen nicht kennt, zeichnet einen gewöhnlichen Raum — und
das ist kein Fehler, sondern die richtige Antwort auf ein Detail, das er
nicht darstellt.

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

### Eigene Flächen

Das Modell TRÄGT eine Liste `shapes`: Flächen, die jemand gezeichnet hat, ohne
dass ein Bereich aus Home Assistant dahintersteht — ein Flur, eine
dekorative Kontur, was auch immer sonst keinen eigenen Platz im Bereichs-
register hat. Jeder Eintrag trägt `id`, `floor_id`, `name`, `color` und
`points`: eine Liste von mindestens drei Punkten `{x, y}` in
Etagenkoordinaten, wie `plot`.

Anders als `plot` gibt es davon beliebig viele je Etage, und jede hat eine
eigene Kennung, die sich der Editor selbst ausdenkt — es gibt kein
Register, das eine vergibt. Wie beim `plot` und beim `shape` eines Raumes
gilt: Der Hub speichert und liefert `shapes` und **liest sie nie**.

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
| `virtual` | Internet, VPN, Cloud — real genug zum Zeigen, in keinem Stockwerk | Erdreich im Ring um die unterste Etage |

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

Wohin virtuelle Bereiche kommen, steht unter § Das Erdreich.

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

#### Höhe ist das, was Etagen zu Etagen macht

Die Hausansicht zeigt Räume mit **stehenden Wänden** und Geschosse auf einer
**Bodenplatte mit Dicke**. Flache Umrisse übereinander sind vier Zeichnungen,
kein Haus: alles hat dieselbe Strichstärke, und nichts im Bild sagt, welche
Linie eine Wand ist und welche eine Bodenkante.

- Räume MÜSSEN **von hinten nach vorn** gezeichnet werden. Mit Höhe verdeckt,
  wer zuletzt gezeichnet wird — in Speicherreihenfolge kehrt sich das Geschoss
  nach innen.
- Nur `indoor` bekommt Wände. Ein Garten hat keine, das Erdreich erst recht nicht.
- Die Zeichnung MUSS **mit dem Haus wachsen**, statt das Haus in eine feste
  Fläche zu quetschen. Der Abstand zwischen zwei Geschossen MUSS größer sein
  als die Tiefe eines Geschosses, sonst werden sie ineinander gezeichnet.
- Eine Wand hat **zwei Seiten**. Gezeichnet wird die Außenfläche und die
  Mauerkrone als Band zwischen Außen- und Innenkante — ein einzelner Strich
  ist eine Grenze, kein Mauerwerk. Die Außenwand des Hauses ist stärker als
  die Zwischenwände.
- Die Außenwand MUSS **um die Räume herum** gezeichnet werden: die beiden
  zum Betrachter zeigenden Flächen nach den Räumen, die beiden hinteren
  davor. Alle vier vorn, und die Rückwand übermalt den Grundriss; alle vier
  hinten, und die Räume stehen auf einer hausförmigen Platte statt in einem
  Haus.
- Etagen stehen **leicht versetzt**, nicht exakt übereinander. Deckungsgleich
  fällt der Umriss der oberen auf den der unteren, und nur der Abstand
  unterscheidet sie.
- Über den Etagen wird **nichts** gezeichnet: kein Dach, keine
  durchscheinenden Wände, keine Eckpfosten. Alles davon liegt über dem
  Grundriss. Was das Haus zusammenhält, sind die Wände der Etagen selbst.
- Drei Gewichte, nicht eines: Außenwand am stärksten, Innenwände leiser,
  Garten nur gestrichelt.

### Ein Gerät in einen anderen Raum ziehen

Der Hub ordnet sonst nur ein Bild an. Dies ist der **einzige** Befehl, der
außerhalb des Hubs schreibt: `spatial_hub/area/assign` ändert die
Bereichszuordnung in Home Assistant, sichtbar in jedem Dashboard und jeder
Automatisierung.

- **Admin-pflichtig.** Anordnen ist es nicht, das hier schon.
- **Gerät oder Entität wird nicht gefragt, sondern hergeleitet.** Ein Punkt
  liegt dort, wo er liegt, weil entweder eine Überschreibung an der Entität
  oder der Bereich ihres Geräts das entschieden hat. Was den Punkt dorthin
  gelegt hat, wird bewegt. Eine Platine zieht also alle ihre Entitäten mit;
  eine Entität, die bewusst aus dem Raum ihres Geräts geholt wurde — ein
  WiFi-CSI-Sensor, der das Gäste-WC beobachtet, während seine Lampe im
  Vorgarten steht — bewegt sich allein.
- Die Antwort enthält `scope`, `target`, `before` und `after` — genug, um es
  vollständig zurückzunehmen.
- **Ein Gerät kann seit Home Assistant 2026.8 mehrfach in der Registry
  stehen.** Ein Gerät gehört dort zu genau einem Config-Entry; was vorher
  über mehrere Integrationen zu einem Gerät verschmolzen war, wird
  aufgetrennt. Ein Umzug schreibt nur den Eintrag, an dem der Punkt hängt —
  die anderen Einträge zu überschreiben würde Entitäten mitziehen, die
  niemand gezogen hat. Bleiben Einträge derselben Hardware in einem anderen
  Bereich zurück, nennt die Antwort sie in `siblings`
  (`device_id`, `name`, `area_id`). Ohne solche Einträge fehlt das Feld.
- Ein Umzug MUSS **sichtbar** sein: eine Zeile über dem Plan, die benennt was
  wohin ging, mit „Rückgängig" darin. Eine Änderung an fremder Konfiguration
  darf nie stillschweigend passieren.
- Ein Punkt ohne `entity_id` bewegt nichts. Es gibt nichts, worauf man
  schreiben könnte, und Raten ist schlechter als Nichtstun.

### Gemeinsame Wände

Zwei Räume, deren Wände aufeinander liegen, haben **eine** Wand.

- Verbunden wird **automatisch**, sobald zwei Wände aufeinander liegen und
  tatsächlich nebeneinander herlaufen. Eine Ecke ist keine gemeinsame Wand.
- Gezeichnet wird die Wand vom Raum **davor**. Rechts der Raum dahinter, und
  der vordere malt seinen Boden über den Wandfuß.
- Beim Ziehen **rastet** eine Wand auf die des Nachbarn ein. Ohne das landet
  eine Wand dort, wo die halbe Raumbreite gerade hinfällt — und „fast" ist der
  ganze Unterschied zwischen zwei Räumen und einer gemeinsamen Wand. `Shift`
  schaltet es ab, wie beim Raster.
- `unjoined` auf einem Bereich listet die Nachbarn, mit denen er **keine**
  Wand teilt. Von **beiden Seiten** gelesen: eine Trennung darf nicht
  zurückkommen, sobald der Nachbar bearbeitet wird.
- Nur rechteckige Innenräume. Ein Garten hat keine Wand, das Erdreich erst
  recht nicht, und ein Raum mit eigenem Umriss hat keine Seite namens
  „rechts".

### Draußen gehört zu einer Etage, nicht zum Erdgeschoss

Ein Außenbereich wird in den Ring **um sein Geschoss** gelegt, nicht um das
Erdgeschoss.

- Ein Außenbereich, den Home Assistant bereits auf einer echten Etage führt,
  **behält sie**. Ein Balkon im Obergeschoss ist im Obergeschoss; ihn nach
  unten zu ziehen sagt das Gegenteil, und ein Haus mit einem Balkon pro Etage
  hätte sie alle im Vorgarten gestapelt.
- Nur Außenbereiche **ohne eigene Etage** kommen ans Erdgeschoss — der
  Garten, die Einfahrt, alles was auf einer Etage saß, die selbst „draußen"
  ist.
- `has_outdoor` bekommt **jede** Etage, die etwas Draußen trägt.
- In der Hausansicht teilen sich alle Geschosse **ein** Fenster, und zwar das
  der **weitesten** Etage. Die erste zu nehmen, die etwas Draußen hat, schnitte
  ein gezeichnetes Grundstück im Erdgeschoss ab, sobald oben ein Balkon hängt.
- Das Fenster wächst außerdem mit, sobald ein Außenbereich über den
  Standardrand von 0,28 hinausgezogen wird — nicht nur beim gezeichneten
  Grundstück. Sonst ist bei einem großen Garten irgendwann Schluss, ohne dass
  eine Wand zu sehen wäre, die das erklärt.
- Nur die tatsächliche Erdgeschoss-Etage bekommt in der Hausansicht die grüne
  Fläche unter sich (`ground: true`, gesetzt von `_ground_floor`). Ein Balkon
  oder eine Garage auf einer anderen Etage bleibt dort weiterhin als Fläche
  definierbar und wird auch als Raum gezeichnet — nur eben ohne Rasenfläche
  unter der ganzen Etage, denn ein Balkon ist kein zweiter Garten.

### Das Erdreich

Virtuelle Bereiche liegen im **Ring um die unterste Etage** — dort, wo der
Hausanschluss ankommt.

Bis dahin bekamen sie eine eigene Ebene über dem Dach, gezeichnet als Wolken.
Die stand am falschen Ort und kostete zu viel: Sie musste das Dach um mehr als
eine Geschosstiefe überragen, sonst las sie sich als Dachboden mit
aufgemaltem Wetter — bei drei Geschossen waren das mit ihrem eigenen
Etagenplatz zusammen gut vier Zehntel der Bildhöhe für eine Ebene mit zwei
Kästen darauf. Und das Internet kommt nicht aus dem Himmel, es kommt aus dem
Boden neben dem Haus.

- Ein virtueller Bereich wird auf die **unterste echte Etage** gelegt und
  bekommt dort `has_soil: true`. Das ist der Keller, wenn es einen gibt, sonst
  das Erdgeschoss — dann liegt die Erde unter dem Rasen.
- Eine **eigene Ebene** DARF NICHT dafür erfunden werden. Sie ist ein
  Etagenreiter, den niemand öffnet, und im Stapel ein Geschoss, das es im
  Haus nicht gibt.
- Er bekommt **denselben Ring wie ein Garten** (`-margin … 1+margin`), und
  die Etage bekommt dafür `has_outdoor`. In den Grundriss gequetscht liest
  sich ein virtueller Bereich als Kellerraum.
- Garten und Erdreich **teilen sich diesen Ring**. Ein Ring hat seine Plätze
  nur einmal; rechnet jede Art für sich aus, wie viele es sind, bekommen zwei
  Bereiche denselben Platz.
- Jeder `virtual`-Bereich wird **einzeln** gezeichnet. Cloud, VPN und Server
  sind drei Dinge, nicht ein Kasten mit drei Kästen darin.
- Er trägt **keine Wände**. Ein Renderer SOLL ihn als Material zeichnen —
  schraffiert, wie eine Bauzeichnung Erde zeichnet — und nicht als Fläche mit
  Rahmen: ein Kasten neben dem Haus sieht aus wie ein Raum, den jemand
  vergessen hat.

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
| `spatial_hub/area/assign` | ein Gerät oder eine Entität in einen anderen Bereich legen — **schreibt in Home Assistant**, nur Admin |

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
