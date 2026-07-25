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

**Phase 1 + 2 der Roadmap sind fertig:** Datenmodell, Provider-Registry,
Event-System, Storage, Config-Flow und die komplette Websocket-API.

Ein Renderer (Phase 3) ist noch nicht enthalten — das Modell lässt sich
aber bereits vollständig über die Websocket-API abfragen, und
[ha-powerline](https://github.com/Chance-Konstruktion/ha-powerline) ist als
erster Provider angebunden.

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

## Eine Integration anbinden

Siehe **[docs/PROVIDER_API.md](docs/PROVIDER_API.md)**. Die vollständige
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
kopieren ([docs/floorplan_hub_conformance.py](docs/floorplan_hub_conformance.py)):
eine Klasse, nur pytest als Abhängigkeit, kein Home Assistant und kein
installierter Hub nötig. Es fängt die Fehler, die Grundrisse im Feld
zerlegen — allen voran Node-IDs, die sich zwischen zwei Polls ändern und
damit die gesamte Anordnung des Nutzers stillschweigend wegwerfen, und
Metadaten, die sich nicht als JSON verschicken lassen und das Modell für
*alle* Provider mitreißen.

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

## Installation

HACS → Custom Repository → dieses Repo als *Integration* hinzufügen,
installieren, Home Assistant neu starten, unter *Geräte & Dienste* →
*Integration hinzufügen* → **Floorplan-Hub**. Es gibt nichts einzustellen.

## Tests

```bash
python3 -m pytest
```

Läuft ohne Home-Assistant-Installation — `tests/conftest.py` stubbt die
benötigten Teile, wie in ha-powerline.

## Lizenz

MIT
