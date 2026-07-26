# Floorplan-Hub

> *„Ein Floorplan, der nicht malt, was du konfigurierst. Er malt, was dein Haus wirklich ist."*

Floorplan-Hub ist **keine Karte**. Es ist ein Systemdienst in Home
Assistant, der räumliche Daten aus beliebigen Integrationen einsammelt, mit
den Stockwerken und Bereichen von Home Assistant zusammenführt und daraus
**ein** Modell bereitstellt — das jeder Renderer zeichnen kann.

Der Hub weiß nichts über Powerline, UniFi oder Shelly. Er kennt nur
Provider, Layer, Nodes, Edges, Actions und Capabilities. Genau deshalb
kann eine neue Integration Teil des Grundrisses werden, ohne dass hier eine
einzige Zeile geändert wird.

## Status

**Die Roadmap ist durch — Phase 1–12:** Datenmodell, Provider-Registry,
Event-System, Storage, Config-Flow, die komplette Websocket-API, ein
Renderer in der Seitenleiste, ein Grundriss, der dem Haus von selbst folgt,
ein Edit-Modus für alles, was die Automatik falsch geraten hat, Themes — und
eigene Ebenen für jede Integration, die nie einen Adapter schreiben wird, und
ein SDK für die, die einen schreiben wollen.

[ha-powerline](https://github.com/Chance-Konstruktion/ha-powerline) und
[ha-espeasy-p2p](https://github.com/Chance-Konstruktion/ha-espeasy-p2p) sind
angebunden — die zweite ohne `DataUpdateCoordinator`, was zwei Löcher im SDK
ans Licht gebracht hat. Der vollständige Plan steht in
**[ROADMAP.md](ROADMAP.md)**.

## Der Renderer

Nach der Einrichtung steht **Floorplan** in der Seitenleiste. Kein
Dashboard anlegen, keine Karte konfigurieren, kein YAML:

- **Etagen** als Reiter, direkt aus der Floor-Registry
- **Bereiche** als Räume, automatisch angeordnet
- **Ebenen** einzeln ein-/ausschaltbar — die Auswahl wird gespeichert
- **Nodes** mit Zustandsfarbe, Provider-Icon oder eigenem Inline-SVG
- **Edges** mit Qualitätsfarbe, gestrichelt für Schätzungen, animiert für Fluss
- **Popup** mit allen Metadaten, Verlauf und Actions (Actions nur für Admins)
- **Diagnose** direkt im Panel: was jeder Provider geliefert hat, und was daran
  beanstandet wurde
- **Themes**: fünf Presets, freie Farben, Formen, Beschriftungsmodus,
  gerade oder gebogene Verbindungen — voreingestellt ist `auto`, das dem
  Theme folgt, das der Nutzer in Home Assistant ohnehin schon hat
- **Bearbeiten** (nur Admins): Nodes und Bereiche ziehen, Bereiche in der
  Größe ändern, Nodes skalieren und drehen, ausblenden und zurückholen,
  Grundriss-Bild pro Etage, Ebenen sortieren und abdunkeln — alles mit
  Rasterfang, `Shift` hält das Raster aus

Der Renderer ist ein reines ES-Modul: kein Build, kein npm, kein Bundle.
Was im Repository liegt, führt der Browser aus. Er kennt **keine einzige
Integration beim Namen** — Farben kommen aus `state` und `quality`, Formen
aus `icon`, alles vom Provider geliefert. Ein Test hält das fest.

Wer einen eigenen Renderer mitbringt, schaltet unseren in den Optionen ab.
Der Hub liefert dann weiter seine Daten und nichts anderes. Dass das
wirklich geht, steht als **eine Datei** in
[examples/second_renderer/](examples/second_renderer/): vom Desktop aus
geöffnet, ohne eine geteilte Zeile Code, mit genau zwei Kommandos.

## Architektur in einem Bild

```
Integration A ─┐
Integration B ─┼─► hass.data["floorplan_hub_providers"] ─► Hub ─► Websocket ─► Renderer
Integration C ─┘                                            ▲
                          HA Floors + Areas ────────────────┤
                          Nutzer-Anordnung (Storage) ───────┘
```

Die Kopplung ist ein Dict in `hass.data` plus drei Dispatcher-Signale.
Kein Import in irgendeine Richtung, keine Ladereihenfolge, keine
Abhängigkeit. Eine Integration mit Provider-Adapter funktioniert unverändert
weiter, wenn der Hub gar nicht installiert ist.

## Aufgabenteilung

| | zuständig für |
|---|---|
| **Provider** | *was* es gibt: Nodes, Edges, Zustand, Metadaten |
| **Home Assistant** | *wo* es grob ist: Floor- und Area-Registry |
| **Hub** | *wie* es angeordnet ist: Auto-Platzierung + Nutzerkorrekturen |
| **Renderer** | *wie* es aussieht |
| **Theme** | *in welchen Farben* — für Zustände und Qualität, nie pro Integration |

Der mitgelieferte Renderer benutzt ausschließlich die dokumentierte
Websocket-API — dieselbe, die auch eine 3D-Ansicht oder ein Druck-Export
benutzen würde. Er hat keinen Sonderzugang.

Ein Provider erfährt nie, dass der Nutzer seinen Node verschoben hat. Das
gehört dem Hub und wird bei jedem Refresh neu angewendet.

## Zero-Config

Bereiche stehen bereits in Home Assistant. Sie noch einmal in einem
Grundriss-Editor zu erfassen, ist genau das, was dieses Projekt vermeiden
will:

1. Stockwerke kommen aus der Floor-Registry (nach Level sortiert)
2. Bereiche werden pro Stockwerk automatisch auf ein Raster gelegt
3. Jeder Node landet in der Mitte seines Bereichs, mehrere werden gefächert
4. Der Nutzer korrigiert nur das, was falsch liegt — einmalig, persistent

Und es bleibt richtig. Wird ein Bereich umbenannt, eine Etage angelegt oder
ein Gerät in einen anderen Raum verschoben, zieht der Grundriss nach; die
Entities darauf sind live, unabhängig davon, wie langsam der Provider
pollt, der sie benannt hat. Beobachtet wird dabei nur, was gerade zu sehen
ist — schaut niemand hin, ist nichts zu aktualisieren.

## Ohne Adapter: eigene Ebenen

Die meisten Integrationen werden nie einen Floorplan-Hub-Provider
schreiben. Das ist kein Versäumnis, sondern der Normalfall — und eine
Plattform, die nur für die Eingeweihten funktioniert, funktioniert nicht.

Also beschreibt der Nutzer stattdessen eine Ebene: *„alle Lichter"*,
*„alles mit Label security"*, *„diese vier Entitäten"*. Im Bearbeiten-Modus,
Seitenleiste, **+ Ebene**.

Eine **Regel, keine Liste**: „alle Lichter" stimmt auch noch, wenn nächsten
Monat eine Lampe dazukommt — aus demselben Grund, aus dem Stockwerke und
Bereiche aus den Registries kommen und nicht aus einem Zeichenprogramm.

Und Home Assistant weiß bei vielen Geräten selbst, **worüber** sie erreicht
werden — jedes Gerät hinter einer Bridge, einem Controller oder einem Hub
trägt dessen ID. Diese Verbindungen lassen sich pro Ebene einschalten. Das
ist echte Topologie, ohne dass der Hub eine einzige Integration beim Namen
nennt: Wer `via_device` schreibt, ist ihm egal, und wie *gut* die Verbindung
ist, behauptet er nicht — das misst niemand.

Was er dafür bewusst **nicht** tut: in die eigene Websocket-API irgendeiner
Integration greifen, um Routen, Nachbartabellen oder Signalstärken zu holen.
Die gibt es je genau einmal, für je genau eine Integration — und die erste,
die der Hub beim Namen fragt, wäre der letzte Tag, an dem er eine Plattform
ist.

Und der entscheidende Teil: Diese Ebenen registrieren sich über **denselben
öffentlichen Provider-Vertrag** wie jeder Fremde. Kein Sonderweg in den Hub,
dieselbe Validierung, dieselbe Fehler-Isolierung. Ein Test hält das fest —
eine Abkürzung an dieser Stelle wäre der erste Riss in dem, was den Hub
überhaupt wertvoll macht.

## Eine Integration anbinden

Für Maintainer: **[sdk/README.md](sdk/README.md)** — eine Seite, die ganze
Antwort. Referenz: **[docs/PROVIDER_API.md](docs/PROVIDER_API.md)**.

```bash
python3 sdk/install.py --into custom_components/<domain> --tests tests
```

Kopiert zwei Dateien und druckt den Code, der noch fehlt. Die vollständige
Anbindung ist ein Aufruf:

```python
from .floorplan_hub_provider import floorplan_provider   # kopierte Datei

floorplan_provider(
    hass,
    entry,
    name="My Integration",
    icon="mdi:flash",
    data=lambda: ["light.kitchen", "sensor.hallway_temperature"],
    coordinator=coordinator,
)
```

Mehr ist nicht nötig. Der Aufruf registriert, meldet beim Entladen des
Config-Entries wieder ab und benachrichtigt den Hub nach jedem
Coordinator-Refresh — Register/Unregister/Notify schreibt niemand von Hand.

**Eine Entity-ID ist ein vollständiger Node.** Name, Bereich, Icon und
Zustand stehen längst in Home Assistant; der Hub holt sie sich dort. Wer
mehr zu sagen hat, nimmt die Builder `node()` / `edge()` / `action()` —
alles Zusätzliche landet automatisch in den Metadaten und damit im Popup.

**Und ein Conformance-Kit**, das Entwickler in ihre eigene Testsuite
kopieren ([sdk/floorplan_hub_conformance.py](sdk/floorplan_hub_conformance.py)):
eine Klasse, nur pytest als Abhängigkeit, kein Home Assistant und kein
installierter Hub nötig. Es fängt die Fehler, die Grundrisse im Feld
zerlegen — allen voran Node-IDs, die sich zwischen zwei Polls ändern und
damit die gesamte Anordnung des Nutzers stillschweigend wegwerfen, und
Metadaten, die sich nicht als JSON verschicken lassen und das Modell für
*alle* Provider mitreißen.

Ein **vollständiges Beispiel** liegt in
[examples/example_provider/](examples/example_provider/) — keine Schnipsel,
sondern eine ganze Integration, die in unserer eigenen Testsuite gegen den
echten Hub läuft und denselben Conformance-Vertrag erfüllen muss wie fremder
Code. Sie kann also nicht stillschweigend verrotten.

Und wenn du Nutzer einer Integration bist, die noch fehlt:
**[docs/ASK_FOR_SUPPORT.md](docs/ASK_FOR_SUPPORT.md)** ist der Text, den du
dort einreichst — samt der Bitte, es einmal zu tun und freundlich. Weil die
meisten Integrationen englischsprachig entwickelt werden, liegt derselbe
Text auch als [ASK_FOR_SUPPORT.en.md](docs/ASK_FOR_SUPPORT.en.md) bereit.

Wer schon angebunden ist, steht in
**[docs/PROVIDERS.md](docs/PROVIDERS.md)**. Diese Liste ist reine
Dokumentation — kein Modul liest sie, und ein Test hält fest, dass keine
Domain daraus im Quelltext des Hubs vorkommt.

Provider-Code gilt dem Hub als nicht vertrauenswürdig: Wer eine Exception
wirft, ins Timeout läuft oder Unsinn liefert, verliert seinen eigenen Layer
für genau einen Refresh — und sonst passiert nichts. Damit das kein
Ratespiel wird, sagt `floorplan_hub/diagnostics` pro Provider, was verworfen
wurde und warum, inklusive vermuteter Tippfehler in der Registrierung.

## Websocket-API

| Command | Zweck |
|---|---|
| `floorplan_hub/model` | das komplette räumliche Modell |
| `floorplan_hub/providers` | wer registriert ist, und was er kann |
| `floorplan_hub/subscribe` | Push-Hinweis bei Änderungen |
| `floorplan_hub/layout/set` | Nutzeranordnung speichern |
| `floorplan_hub/layout/reset` | Overrides eines Objekts verwerfen |
| `floorplan_hub/history` | Zeitreihe zu Node oder Edge |
| `floorplan_hub/action` | Provider-Action ausführen (Admin) |
| `floorplan_hub/diagnostics` | was jeder Provider geliefert hat, inkl. Fehler |
| `floorplan_hub/entities/facets` | welche Arten, Label und Geräteklassen es im Haus gibt |

Unter `theme` steht das aufgelöste Theme — Preset plus Nutzerkorrekturen,
fertig ausgerechnet. Ein zweiter Renderer bekommt damit dieselben Farben,
ohne ein einziges Preset nachzubauen.

Im Modell steht unter `hidden` außerdem, was der Nutzer ausgeblendet hat —
Ausblenden ist keine Einbahnstraße, ein Editor braucht die Liste, um es
zurückzuholen. Ein einfacher Renderer zeichnet weiterhin nur `nodes`.

## Installation

HACS → Custom Repository → dieses Repo als *Integration* hinzufügen,
installieren, Home Assistant neu starten, unter *Geräte & Dienste* →
*Integration hinzufügen* → **Floorplan-Hub**. Es gibt nichts einzustellen.

## Tests

```bash
python3 -m pytest
```

Läuft in der CI bei jedem Pull Request (pytest, HACS, hassfest) und lokal
ohne Home-Assistant-Installation — `tests/conftest.py` stubbt die
benötigten Teile, wie in ha-powerline. Die Renderer-Logik wird von
`tests/test_panel_logic.mjs` mitgeprüft (`node --test`); pytest ruft sie
mit auf und überspringt sie, wenn kein Node installiert ist.

## Lizenz

MIT
