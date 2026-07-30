# Beispiele

Alle drei laufen. Keins davon ist ein Schnipsel, und keins kann
stillschweigend verrotten: Die Testsuite dieses Repos richtet sie ein und
treibt sie durch den echten Hub — die beiden Provider müssen dabei
denselben Conformance-Vertrag erfüllen wie fremder Code.

## Wenn du eine Integration anbindest

**Fang hier an:**
[`minimal_provider/`](minimal_provider/__init__.py) — **fünf Zeilen.** Eine
Liste von Entity-IDs, mehr nicht. Home Assistant weiß schon, wie
`light.kitchen` heißt, in welchem Bereich es liegt, welches Icon es hat und
ob es an ist; der Hub holt sich das dort und setzt die Lampe in ihr Zimmer.

```python
spatial_provider(
    hass, entry,
    name="Minimal Provider",
    data=lambda: ["light.kitchen", "switch.coffee_machine"],
)
```

**Danach:** [`example_provider/`](example_provider/__init__.py) — eine
ganze Integration, wenn eine Liste von IDs nicht mehr reicht: Verbindungen
zwischen Geräten, ein Detail-Popup, eine Action, und über einen
`DataUpdateCoordinator` läuft der Plan live mit.

Der Unterschied zwischen beiden ist genau das, was du dazulernst, wenn du
es brauchst — und nicht vorher.

| | `minimal_provider` | `example_provider` |
|---|---|---|
| Eigener Code | 18 Zeilen | 114 Zeilen |
| Knoten | Entity-IDs | `node()` mit Metadaten |
| Kanten | — | `edge()` mit Qualität |
| Live | — | `coordinator=` |
| Actions | — | `action=` |

Beide kopieren `spatial_hub_provider.py` neben sich, statt den Hub zu
importieren — das ist der Punkt: Ohne installierten Hub verhalten sie sich
exakt so, als gäbe es diesen Code nicht. Die Datei holst du dir mit
`python3 sdk/install.py --into custom_components/deine_integration`.

Weiter: [`sdk/README.md`](../sdk/README.md) ·
[`docs/PROVIDER_API.md`](../docs/PROVIDER_API.md) ·
[`docs/SPECIFICATION.md`](../docs/SPECIFICATION.md)

## Wenn du einen eigenen Renderer schreibst

[`second_renderer/`](second_renderer/) — 198 Zeilen HTML, die dasselbe Haus
zeichnen wie das mitgelieferte Panel, ohne eine Zeile mit ihm zu teilen.
Zwei Websocket-Aufrufe genügen: `spatial_hub/model` und
`spatial_hub/subscribe`.

Das ist der Beleg dafür, dass der Renderer austauschbar ist — eine
Behauptung, die man nur mit einem zweiten Renderer belegen kann.
