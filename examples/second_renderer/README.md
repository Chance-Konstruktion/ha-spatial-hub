# Ein zweiter Renderer

Eine Datei. Vom Desktop aus geöffnet, nicht in Home Assistant. Zeigt alle
Etagen nebeneinander statt eine nach der anderen, und kann nichts
bearbeiten.

```
open examples/second_renderer/index.html
```

URL und einen Long-Lived Access Token eintragen (Profil → Sicherheit →
Langlebige Zugriffstoken), fertig.

## Wozu

Der mitgelieferte Renderer soll **einer von möglichen** sein und nicht *der*
Renderer. Das ist leicht behauptet und schwer zu belegen, solange es nur
einen gibt. Diese Datei ist der Beleg:

- Sie teilt **keine Zeile Code** mit dem Hub.
- Sie läuft **außerhalb** von Home Assistant, also ohne jeden Sonderzugang,
  den ein eingebautes Panel noch haben könnte.
- Sie benutzt genau **zwei** Websocket-Kommandos: `spatial_hub/model` und
  `spatial_hub/subscribe`. Mehr braucht ein lesender Renderer nicht.
- Sie kennt **keine Integration** beim Namen und **kein Theme-Preset**.

`tests/test_second_renderer.py` hält jeden dieser Punkte fest.

## Was sie beim Bauen gefunden hat

Voreingestellt ist das Theme `auto`, und dessen Farben sind leere Strings:
*„nimm, was Home Assistant sagt."* In Home Assistant ist das genau richtig.
Vom Desktop aus gibt es nichts zu erben — und das ganze Haus kam grau heraus.

Damit war die Zusage aus Phase 6 („aufgelöst wird im Hub, damit ein zweiter
Renderer kein Preset nachbaut") nur halb eingelöst: Der zweite Renderer
hätte sich Farben ausdenken müssen, also genau das tun, was der Hub ihm
abnehmen sollte.

Jedes Theme trägt jetzt zusätzlich `theme.fallback` mit echten Farben für
das gemeinsame Vokabular. Leer bedeutet weiterhin „erben" — wer nichts zu
erben hat, nimmt den Fallback. Kein Renderer muss dafür wissen, welcher Fall
gerade vorliegt.

## Was sie bewusst nicht kann

Bearbeiten, Verlauf, Actions, Diagnose, eigene Ebenen. Das ist keine
Einschränkung der API, sondern der Punkt: Ein Renderer nimmt sich, was er
braucht, und der Hub fragt nicht nach, wer da liest.
