# Im Browser nachsehen

164 Python- und 64 JS-Tests prüfen die Logik. Sie können nicht sehen, dass
ein Kasten über einem anderen liegt — und genau das war der erste echte
Fehler des Projekts: Bereiche ohne Etage wurden auf *jeder* Etage gezeichnet,
über Räume, deren Raster ohne sie ausgemessen worden war. Alle Tests waren
grün, und zwar zu Recht: Jede Einzelentscheidung stimmte. Falsch war, was
passiert, wenn zwei richtige aufeinandertreffen.

Diese zwei Skripte sind das, was ihn gefunden hat.

## Einmal aufsetzen

```bash
python3 -m venv hass-venv && ./hass-venv/bin/pip install homeassistant playwright
./hass-venv/bin/hass -c ~/hass-test          # einmal starten, Nutzer anlegen
```

Dann in `~/hass-test`:

- `custom_components/floorplan_hub` — dieses Repo hineinkopieren oder verlinken
- `custom_components/example_provider` — aus [`examples/`](../examples/), damit
  überhaupt Nodes auf dem Plan liegen
- `configuration.yaml`: `frontend:`, `http:` und `example_provider:`

Integration hinzufügen wie ein Nutzer: **Einstellungen → Geräte & Dienste →
Floorplan-Hub**.

## Das Testhaus bauen

```bash
python3 tools/live_setup.py --token <long-lived-token>
```

Zwei Etagen, fünf Bereiche — und **drei davon absichtlich ohne Etage**. Das
ist der Normalzustand einer echten Installation (Etagen kamen in Home
Assistant Jahre nach den Bereichen) und genau der Fall, den die Testsuite
nie hatte. Läuft mehrfach; was schon da ist, wird gemeldet, nicht bemängelt.

## Rendern lassen

```bash
python3 tools/live_check.py --password <passwort>
```

Klickt jeden Etagen-Reiter durch und meldet pro Reiter, was auf dem Schirm
steht: welche Bereiche, welche Nodes, **welche Bereiche sich überlappen**,
wie groß die Bühne ist und wie viel Platz darunter ungenutzt bleibt. Dazu ein
Screenshot pro Reiter.

Es ist ein **Berichterstatter, kein Test.** Es hat keine Meinung darüber, was
richtig ist — du siehst dir die Zahlen und die Bilder an. Ein Skript, das
selbst entscheidet, was gut aussieht, hätte den Fehler oben auch nicht
gefunden.

## Warum das nicht in der CI läuft

Eine echte Home-Assistant-Installation plus Browser in jedem PR wäre teuer
und wackelig — und der Nutzen liegt ohnehin im Hinsehen, nicht im grünen
Haken. Vor einer Änderung am Renderer einmal laufen lassen ist die Regel.

Eine Warnung noch: `live_check.py` meldet auch Fehler, die aus dem Frontend
von Home Assistant selbst kommen und mit dem Panel nichts zu tun haben.
Vergleiche im Zweifel mit einem Reiter, auf dem das Panel gar nicht offen ist.
