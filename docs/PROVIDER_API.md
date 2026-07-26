# Provider API (v1)

Wie eine Integration auf den Grundriss kommt. Lesezeit: zwei Minuten.

## Die Kurzfassung

```python
from .floorplan_hub_provider import floorplan_provider

floorplan_provider(
    hass,
    entry,
    name="My Integration",
    icon="mdi:flash",
    data=lambda: ["light.kitchen", "sensor.hallway_temperature"],
    coordinator=coordinator,
)
```

Das ist die vollständige Anbindung. Kein Frontend, kein Rendering, kein
Config-Flow für Kartenoptionen, kein Registrieren/Abmelden/Benachrichtigen
von Hand.

Was dieser eine Aufruf erledigt:

- **registriert** den Provider beim Hub
- **meldet ihn ab**, wenn dein Config-Entry entladen wird (via `entry.async_on_unload`)
- **benachrichtigt den Hub nach jedem Coordinator-Refresh** — das ist es, was den Grundriss live macht
- **leitet die `provider_id`** aus der Domain deines Entries ab
- **leitet die Capabilities ab** aus dem, was du übergeben hast — vergisst du ein Flag, wird trotzdem nichts abgeschaltet

## Vorbereitung

Ein Aufruf erledigt das Kopieren und sagt dir, was noch zu tun ist:

```bash
python3 sdk/install.py --into custom_components/<domain> --tests tests
```

Oder von Hand: [`sdk/floorplan_hub_provider.py`](../sdk/floorplan_hub_provider.py)
in deinen Integrationsordner **kopieren**. Nicht importieren.

Der Grund: Der Hub ist keine Abhängigkeit. Die Datei importiert nichts aus
`floorplan_hub`, sie schreibt ein Dict in `hass.data` und feuert ein
Dispatcher-Signal. Beides kostet nichts, wenn niemand zuhört. Deine
Integration verhält sich ohne installierten Hub exakt wie vorher — und die
Ladereihenfolge ist egal, weil beide Seiten das Dict anlegen können.

## Ohne Coordinator: `signals`

Nicht jede Integration hat einen `DataUpdateCoordinator`. Ein UDP-Listener,
ein MQTT-Abo, alles Push-Förmige feuert stattdessen eigene
Dispatcher-Signale. Nenne sie, und der Hub hört mit:

```python
floorplan_provider(
    hass, entry, name="ESPEasy P2P",
    data=lambda: {...},
    signals=[SIGNAL_NODE_DISCOVERED, SIGNAL_NODE_AVAILABILITY],
)
```

Beim Entladen werden sie mit allem anderen wieder getrennt.

Übergibst du ein `coordinator`-Objekt ohne `async_add_listener` und keine
`signals`, sagt der Shim es dir im Log. Vorher hat er es stillschweigend
ignoriert — der Grundriss wurde einmal gezeichnet und bewegte sich nie
wieder, ohne dass irgendwo stand, warum.

## Nodes

**Eine Entity-ID ist ein vollständiger Node.** Home Assistant kennt Name,
Bereich, Icon und Zustand bereits — dich das wiederholen zu lassen, ist
genau die Fleißarbeit, die dieses Projekt abschaffen will:

```python
data=lambda: ["light.kitchen", "sensor.hallway_temperature"]
```

Wenn du mehr zu sagen hast, nimm `node()`. Alles, was du zusätzlich
übergibst, landet in den Metadaten und erscheint im Popup:

```python
from .floorplan_hub_provider import node, edge, action

data=lambda: {
    "nodes": [
        node("f5e0dc",
             label="Router EG",
             area_id="wohnzimmer",        # oder entity_id=... und der Hub holt ihn
             state="online",
             icon="mdi:lan",
             actions=[action("reboot", "Neustart", confirm=True)],
             tx_rate=560, firmware="1.2.3"),   # → Metadaten
    ],
    "edges": [
        edge("f5e0dc", "f5dba7", value=560, quality="good", animated=True),
    ],
}
```

Plain Dicts funktionieren genauso — die Builder existieren nur, damit ein
Tippfehler im Schlüsselnamen ein `TypeError` an der Aufrufstelle ist statt
ein stillschweigend fehlendes Label.

### Positionen: gib keine an

Es sei denn, du weißt wirklich, wo das Gerät hängt. Der Hub setzt jeden
Node in die Mitte seines Bereichs, der Nutzer zieht ihn von dort weg, und
diese Position gehört ab dann dem Hub. Du erfährst nie davon — und musst
sie auch nie speichern.

### Zustände

`online` / `offline` / `unknown` sind das gemeinsame Vokabular, aber du
darfst alles schicken. `heating`, `docked`, `dimmed` bedeuten deinem Layer
etwas, und der Hub plättet sie nicht. Nur `unavailable`/`unknown` von
Entities werden zu `unknown` vereinheitlicht.

### Edges

`quality` ist `good` / `fair` / `poor` / `unknown` — dieselbe Sprache über
alle Provider hinweg, damit ein Renderer deine Kanten einfärben kann, ohne
zu wissen, was sie bedeuten. `dashed` für Schätzungen, `animated` für Fluss.

## Robustheit: dein Code gilt als nicht vertrauenswürdig

Ein `data`-Aufruf, der eine Exception wirft, ins Timeout läuft (10 s) oder
Unsinn liefert, kostet **deinen** Layer für genau einen Refresh — sonst
passiert nichts. Ein einzelner kaputter Node fliegt raus, nicht der ganze
Payload. Liefere also lieber unvollständige Daten als eine Exception.

Damit das kein Ratespiel wird, sagt dir der Hub, was er verworfen hat:

```js
await hass.connection.sendMessagePromise({ type: "floorplan_hub/diagnostics" })
```

Pro Provider: Anzahl gelieferter Nodes/Edges, verworfene Objekte mit
Begründung, Exceptions, Timeouts — und vermutete Tippfehler in deiner
Registrierung (`capabilties` statt `capabilities` wird gemeldet, nicht
stillschweigend ignoriert).

## Prüfen, ob es stimmt

[`sdk/floorplan_hub_conformance.py`](../sdk/floorplan_hub_conformance.py) in deine
Tests kopieren, eine Klasse schreiben, fertig:

```python
from .floorplan_hub_conformance import FakeHass, FloorplanHubConformance

class TestFloorplanHub(FloorplanHubConformance):
    def build_registration(self):
        hass = FakeHass()
        async_setup_my_provider(hass, entry, coordinator)
        return hass.registrations["my_integration"]
```

**Braucht nur pytest** — kein Home Assistant, kein installierter Hub, kein
Async-Plugin. Es läuft gegen dasselbe Registrierungs-Dict, das auch der Hub
sieht, und prüft die Dinge, die Grundrisse im Feld wirklich kaputt machen:

- **IDs, die sich zwischen zwei Polls ändern** — jede gespeicherte
  Nutzerposition hängt an deinen Node-IDs. Ein Zähler oder Zeitstempel darin
  wirft die Anordnung des Nutzers bei jedem Poll weg, still und leise.
- **Metadaten, die kein JSON sind** — ein `datetime` reißt das Modell für
  *alle* Provider mit runter, nicht nur für deinen.
- Edges auf nicht existierende Nodes, doppelte IDs, Pixel- statt
  normalisierte Koordinaten, privates `quality`-Vokabular, Actions ohne
  Callable, Capabilities ohne Umsetzung, Tippfehler in Schlüsseln.

Jeder Fehlschlag sagt nicht nur *was* falsch ist, sondern *warum es weh tut*.

## Was du dafür bekommst

Ohne eine weitere Zeile erscheint deine Integration im Panel des Hubs:
eigene Ebene mit Ein/Aus-Schalter, Nodes auf der richtigen Etage im
richtigen Bereich, Edges in Qualitätsfarbe, ein Popup mit all deinen
Metadaten, deine Actions als Buttons, dein Verlauf als Kurve.

Der Renderer kennt deinen Namen nicht und will ihn nicht kennen. Er färbt
nach `state` und `quality`, zeichnet nach `icon` — deshalb bist du keine
Sonderbehandlung wert und musst auch nie um eine bitten.

## Optional: History

```python
def history(kind: str, item_id: str, hours: float) -> list[dict]:
    """kind ist "node" oder "edge"; item_id ist DEINE id, ohne Namespace."""
    return [{"t": "2026-07-25T20:00:00+02:00", "value": 560}]
```

## Optional: Actions

```python
async def action(kind: str, item_id: str, action_id: str, data: dict) -> dict:
    if action_id == "reboot":
        await my_reboot(item_id)
    return {"success": True}
```

Der Hub leitet weiter, ohne zu interpretieren — was „toggle" bedeutet,
entscheidest du. Actions erfordern einen Admin-Nutzer.

## Optional: eigene Icons

```python
icon_set={
    "powerline_online": {"svg": "<svg …>", "default_color": "#00ff00"},
    "powerline_offline": {"svg": "<svg …>", "animation": "pulse"},
}
```

Im `icon`-Feld eines Nodes per Schlüsselname referenzieren. Renderer, die
kein Inline-SVG können, fallen auf MDI zurück — deshalb ist ein MDI-Name
als Schlüssel (`"mdi:lan-connect"`) die bequemste Wahl: derselbe Node sieht
dann überall richtig aus, mit deinem Icon, wo es geht.

Die Reihenfolge, in der ein Renderer ein Icon sucht:

1. dein `icon_set` — deine Integration behält ihr Gesicht,
2. das Icon, das der Node nennt (bei Entity-Nodes das aus Home Assistant),
3. dein Provider-Icon.

Ein Punkt ist nie die Antwort: er sagt nichts darüber, was das Ding ist.

## Optional: deine eigene Ansicht

```python
panel_url="/powerline"
```

Hat deine Integration ein eigenes Panel, verlinkt der Hub es im Popup jedes
Nodes, den du geliefert hast. Er fragt nicht, was dahinter liegt. Nur Pfade
innerhalb dieser Home-Assistant-Instanz werden akzeptiert.

Das ist die Arbeitsteilung, in einem Feld: **du lieferst die Daten und
optional deine visuelle Identität (Icons, Farben, Animationen), der Hub
entscheidet über Darstellung und Interaktion, Home Assistant bleibt die
Datenquelle.**

## Capabilities

Beschreibe dich selbst; der Hub schaltet Funktionen danach frei und
behandelt nie eine Integration namentlich als Sonderfall. Übergibst du
nichts, wird abgeleitet: `history` und `actions` an, wenn du die Callables
mitgibst, `custom_icons` an, wenn du ein `icon_set` mitschickst.

| Capability | Bedeutung |
|---|---|
| `nodes` | du lieferst Nodes |
| `edges` | du lieferst Verbindungen |
| `history` | dein `history`-Callable liefert Zeitreihen |
| `animation` | deine Edges/Nodes sind zum Animieren gedacht |
| `popup` | deine Metadaten lohnen ein Detail-Popup |
| `actions` | dein `action`-Callable ist aufrufbar |
| `custom_icons` | du lieferst ein `icon_set` |

Zusätzlich, außerhalb der Capabilities: `panel_url` (deine eigene Ansicht,
siehe oben) und `device_id` an einem Node. Letzteres füllt der Hub bei
Entity-Nodes selbst aus der Registry — das Popup verlinkt damit auf das
Gerät, seine Entitäten und seine Einstellungen, ohne dass du etwas tust.

## IDs

Der Hub namespaced deine IDs (`powerline:f5e0dc`), damit zwei Provider
beide einen Node „router" haben dürfen. In deinem Payload benutzt du
durchgehend deine eigenen, schlichten IDs — auch in `source`/`target` von
Edges. In `history`/`action` bekommst du sie ebenfalls ohne Namespace
zurück.

## Websocket-API (für Renderer)

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

Eigene Ebenen können zusätzlich `topology: true` setzen. Dann zeichnet der
Hub die `via_device`-Beziehungen aus der Device-Registry als Kanten — die
einzige echte Topologie, die Home Assistant selbst führt und die keiner
Integration gehört.

Das Modell enthält unter `theme` die fertig aufgelösten Farben für die
Zustands- und Qualitätswörter, unter `hidden` die vom Nutzer ausgeblendeten
Objekte. Beides ist für Renderer gedacht; als Provider musst du dich um
nichts davon kümmern.

`history` und `action` adressieren über `item_id` (die genamespacte ID) —
nicht über `id`, das im HA-Websocket-Protokoll der Message gehört.

In `layout/set` löscht ein `null`-Wert ein Override und stellt die
automatische Platzierung wieder her — so wird „Reset" ausgedrückt.
