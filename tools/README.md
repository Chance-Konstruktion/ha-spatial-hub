# Im Browser nachsehen

300 Python- und 266 JS-Tests prüfen die Logik. Sie können nicht sehen, dass
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

- `custom_components/spatial_hub` — dieses Repo hineinkopieren oder verlinken
- `custom_components/example_provider` — aus [`examples/`](../examples/), damit
  überhaupt Nodes auf dem Plan liegen
- `configuration.yaml`: `frontend:`, `http:` und `example_provider:`

Integration hinzufügen wie ein Nutzer: **Einstellungen → Geräte & Dienste →
Spatial Hub**.

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

## Den Edit-Modus durchgehen

```bash
python3 tools/live_edit.py --password <passwort>
```

`live_check.py` schaut nur; dieses hier **fasst an**. Es zieht einen Node
mit echten Mausbewegungen, lädt neu und prüft, ob die Position hält, ändert
einen Bereich in der Größe, blendet etwas aus und holt es zurück, ruft eine
Provider-Action auf und setzt die Etage zurück. Jeder Schritt ist eine
Zusage, die das Projekt schriftlich gemacht hat — hier hat es also eine
Meinung, anders als `live_check.py`.

```
ok    Ein Node lässt sich ziehen  — 641 → 759
ok    Die Position überlebt einen Reload  — 759 → 759
ok    Ein Bereich lässt sich in der Größe ändern  — 762 → 552
ok    Ausblenden blendet aus
ok    Ausgeblendetes kommt zurück  — über „Adapter Dachboden“
ok    Zurücksetzen stellt die Automatik wieder her  — 552 → 762
```

Es **schreibt** in den Layout-Speicher. Nur gegen eine Wegwerf-Instanz.

Zwei Fallen, in die die erste Fassung selbst getappt ist, beide jetzt im
Code kommentiert: Sie hat „irgendeinen Knopf in der Seitenleiste" gesucht,
um etwas zurückzuholen — und dabei den Ebenen-Schalter erwischt und den
Provider dauerhaft abgeschaltet. Und sie hat einen Bereich *vergrößern*
wollen, der schon neun Zehntel des Plans füllte; das korrekte Clamping am
Rand sah dann aus wie ein kaputtes Resize. Ein Werkzeug, das still das
kaputtmacht, was es prüft, ist schlimmer als keins.

## Ob der Plan dem Haus folgt

```bash
python3 tools/live_follow.py --password <passwort>
```

Phase 4 verspricht nicht „es rendert einmal", sondern dass ein Plan, der am
Montag stimmt, auch am Freitag stimmt: Bereich umbenennen, Etage anlegen,
Gerät umziehen — der Plan zieht nach, ohne dass jemand neu lädt. Genau das
lässt sich mit keinem Stub zeigen.

Also legt dieses Skript eine Etage und einen Bereich über die Websocket-API
an, während das Panel offen bleibt, und schaut zu. **Es lädt nie neu** — ein
Reload wäre genau die Antwort, die diese Zusage vermeiden soll.

```
ok    Eine neue Etage erscheint ohne Reload
ok    Ein neuer Bereich erscheint ohne Reload
ok    Ein umbenannter Bereich heißt sofort anders
aufgeräumt
```

Es **räumt hinter sich auf**: Was es anlegt, löscht es wieder. Bricht es
mittendrin ab, heißen die Reste `Spatial Hub Test…` und sind damit
auffindbar. Nach der Erfahrung mit `live_edit.py` — das beim ersten Versuch
still einen Provider dauerhaft abgeschaltet hat — ist das keine Höflichkeit,
sondern Pflicht.

## Warum das nicht in der CI läuft

Eine echte Home-Assistant-Installation plus Browser in jedem PR wäre teuer
und wackelig — und der Nutzen liegt ohnehin im Hinsehen, nicht im grünen
Haken. Vor einer Änderung am Renderer einmal laufen lassen ist die Regel.

Eine Warnung noch: `live_check.py` meldet auch Fehler, die aus dem Frontend
von Home Assistant selbst kommen und mit dem Panel nichts zu tun haben.
Vergleiche im Zweifel mit einem Reiter, auf dem das Panel gar nicht offen ist.

## Die Bilder für die README

```bash
python3 tools/demo_house.py > /tmp/demo.json
node tools/shots.mjs /tmp/demo.json docs/images
```

`demo_house.py` baut ein kleines, aufgeräumtes Haus — drei Etagen, vierzehn
Bereiche, dreizehn Geräte — und dreht es durch den **echten** Hub, mit den
Registry-Stubs aus `tests/`. `shots.mjs` lädt das Ergebnis in den **echten**
Renderer und macht drei Bilder daraus: das Haus, eine Etage, der Editor.

Kein handgeschriebenes JSON und keine Bildbearbeitung. Ein Bild aus einem
gemalten Modell zeigt, was jemand haben wollte; diese zeigen, was der Code
tut — und veralten mit ihm, statt neben ihm.

Sie sind dabei auch ein Prüfmittel. Das erste Bild dieser Art hat auf einen
Schlag drei Fehler sichtbar gemacht, die alle 500 Tests grün gelassen
haben: „Untergeschoss" war links abgeschnitten, weil der Rand für den Namen
eine feste Zahl war; ein Balkon im Obergeschoss lag als Ring um die ganze
Wohnung, weil er dieselbe Anordnung bekam wie ein Garten; und der Raumname
stand genau dort, wo die Automatik das erste Gerät hinsetzt, sodass
„Adapter Arbeitszimmer" quer über „Arbeitszimmer" lag. Nichts davon ist
eine falsche Einzelentscheidung — genau wie bei `live_check.py` oben.
