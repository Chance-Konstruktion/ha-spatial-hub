# Auftrag: Waende, die aussehen wie Waende

Zwei Ansichten, zwei verschiedene Probleme. Beide betreffen die Waende,
deshalb stehen sie in einem Auftrag -- aber sie sind unabhaengig, und
Teil 1 ist der wichtigere.

**Vorher lesen:** `docs/RENDERERS.md` und die Kommentare am Kopf von
`panel-geometry.js`. Dort steht die Denkweise, nach der diese Zeichnung
gebaut ist ("eine Wand ist kein Strich, sie ist ein Ding mit zwei
Seiten"). Halte dich daran; das ist keine Geschmacksfrage, sondern der
Grund, warum die Stapelansicht lesbar ist.

**Messlatte vorher aufnehmen:**

```
PYTHONUTF8=1 python -m pytest -q     ->  369 bestanden
node tests/test_panel_logic.mjs      ->  alle gruen (315 Stueck)
```

Ohne `PYTHONUTF8=1` melden heile Tests einen Fehler, den es nicht gibt.
Und ohne Node ueberspringt sich der halbe Renderer **stumm** -- wenn dir
`pytest` "368 passed, 1 skipped" sagt, hast du den Renderer gar nicht
geprueft.

---

## Teil 1: Die Etagenansicht hat gar keine Waende

Das ist der Kern. Nicht "schlecht gezeichnete Waende" -- **keine**.

Ich habe beide Ansichten aus dem echten Renderer herausgeschrieben und im
Dokument nachgemessen, nicht auf einem Bild geschaetzt. Befund:

| | Etagenansicht (`_stageHtml`) | Stapelansicht (`_stackHtml`) |
| --- | --- | --- |
| Wand innen | `1px dashed #e0e0e0` -- Rand eines `div` | `room-wall`, Dicke `STACK.wall = 8` |
| Wand aussen | `2px solid rgba(128,145,170,0.55)` | eigene Schale, `outerWall = 13` |
| Tuer | weisser Balken 6 px, **ueber** die Linie gemalt | aus der Wand herausgerechnet (`wallRuns`) |
| Klassen im DOM | `area`, `opening`, `door`, `window` | `room-wall` 40x, `room-cap` 40x |

Die ganze Wandmechanik in `panel-geometry.js` -- `wallsOf`, `capsOf`,
`wallRuns`, `openingMarksOf`, die Ueberlegung mit den einzelnen Vierecken
statt eines Rings mit Loch -- bedient **nur** den Stapel. Die Ansicht, die
taeglich benutzt wird, bekommt davon nichts ab.

### Der Gedanke, von dem aus es leicht wird

Ein Grundriss ist der Blick senkrecht von oben. Was man dabei von einer
Wand sieht, ist ihre **Oberkante** -- und genau die rechnet `capsOf`
bereits aus: das Band zwischen Umriss und Innenversatz, ein Viereck je
Wand, mit den Tueroeffnungen ausgespart. In der Etagenansicht faellt nur
die Projektion weg.

Du baust also nichts Neues. Du nimmst, was da ist, und laesst die
Scherung weg. Wenn dir dabei auffaellt, dass `capsOf` dafuer zu eng an
der Stapelansicht klebt, trenne den gemeinsamen Teil sauber heraus, statt
ihn abzuschreiben -- **zwei Rechnungen fuer dieselbe Wand ist genau der
Fehler**, vor dem der Kommentar bei `openingMarksOf` warnt (Zeile 227).

### Die Falle: das Ziehen darf nicht kaputtgehen

Die Raeume sind `div`s mit `data-area`, und `panel-input.js` haengt daran
das Verschieben, die acht Griffe zum Groessenaendern und das Anfassen der
Nischen. Wenn du die Raeume zu SVG-Polygonen machst, faellt das alles um.

Mein Vorschlag -- pruefe ihn, nimm einen besseren, wenn du einen hast:
ein SVG **unter** den Raum-`div`s, in derselben normierten Flaeche wie das
vorhandene `edges`-SVG (`viewBox="0 0 1000 1000"`), mit
`pointer-events:none`. Die Waende werden gezeichnet, die Bedienung bleibt,
wo sie ist. `area-fill` arbeitet schon mit `clip-path:polygon(...)`, die
Ecken liegen also bereits in einer Form vor, die sich weiterverwenden
laesst.

Was immer du waehlst: **schreib in einem Absatz, warum**, und pruefe mit
einem Test, dass `data-area` weiterhin getroffen wird.

### Was gilt

- Innenwand und Aussenwand unterscheiden sich sichtbar in der Dicke --
  wie auf Papier, und aus demselben Grund: damit man den Plan aus zwei
  Metern Entfernung lesen kann.
- Eine Tuer ist eine **Luecke in der Wand**, kein weisser Balken darueber.
  Fenster genauso, mit eigenem Zeichen.
- Zwei Raeume, die sich eine Wand teilen, bekommen **eine** Wand, nicht
  zwei nebeneinander. `drawsTheWall` in `panel-view.js` entscheidet das
  heute schon fuer den Stapel -- nimm dieselbe Entscheidung, nicht eine
  zweite.
- Die Farben kommen aus den vorhandenen CSS-Variablen (`--fp-wall`,
  `--fp-wall-top`, ...). **Keine festen Farbwerte**; das Panel folgt dem
  Thema von Home Assistant, auch dem dunklen.
- Nischen und abgesetzte Waende (der Umriss ist nicht immer ein Rechteck)
  muessen weiter funktionieren.

---

## Teil 2: Im Stapel liegt die Beschriftung auf den Waenden

Nachgemessen, nicht angesehen: **13 von 29** Beschriftungen ueberdecken
Wandflaechen. "Adapter Kinderzimmer" ist 2 636 px^2 gross und liegt mit
5 278 px^2 auf Waenden -- es kreuzt also gleich zwei davon vollstaendig.
"Hausanschluss": 1 553 px^2 gross, 1 987 px^2 auf Wand.

**Was NICHT das Problem ist:** die Beschriftungen ueberlappen sich
untereinander **nicht** -- null Paare bei 32 Stueck. Das hatte ich nach
dem ersten Blick aufs Bild anders vermutet und beim Nachmessen
zurueckgenommen. Renn also nicht in ein Ausweichverfahren fuer Schrift
gegen Schrift hinein; das Problem ist Schrift gegen **Wand**.

Was hilft, in dieser Reihenfolge zu pruefen:

1. Die Beschriftung dorthin legen, wo Bodenflaeche ist, statt in die
   Mitte des Raumkastens -- die Mitte liegt bei schmalen Raeumen auf der
   Wand.
2. Wenn kein Platz bleibt: den Namen kuerzen oder weglassen, bevor er auf
   der Wand landet. Ein fehlender Name ist ehrlicher als einer, der die
   Zeichnung unleserlich macht.
3. Erst als Letztes: ein Traeger hinter der Schrift. Das ist Kosmetik und
   verdeckt die Wand trotzdem.

Ein Test, der die Ueberdeckung zaehlt, gehoert dazu -- sonst kriecht es
zurueck. Die Zahl im Test ist eine Obergrenze, kein Sollwert.

---

## Abnahme

- `PYTHONUTF8=1 python -m pytest -q` -- mindestens 369, keiner vorher
  gruener Test rot. **Pruefe die Zahl**, nicht nur die Farbe: wenn
  "skipped" auftaucht, hat Node gefehlt.
- `node tests/test_panel_logic.mjs` gruen, mit neuen Tests fuer die
  Waende und fuer die Ueberdeckung.
- Verschieben und Groessenaendern der Raeume funktionieren unveraendert
  -- mit Test.
- Helles und dunkles Thema, beide ueber die CSS-Variablen.
- `BEFUND.md`: was gebaut wurde, welche Entscheidung du beim Zeichenweg
  getroffen hast und warum, und **was du nicht pruefen konntest**. Du
  kannst die Zeichnung nicht ansehen -- Playwright laeuft hier nicht.
  Schreib also dazu, welche Stellen nur ein Mensch beurteilen kann.

## Was ausserhalb bleibt

- Die Datenseite (`hub.py`, `registry.py`, Anker, Provider-API) nicht
  anfassen. Das ist reine Zeichenarbeit.
- Keine neue Abhaengigkeit, kein Playwright ins Repo.
- `docs/` nur dort aendern, wo eine Aussage durch deine Arbeit falsch
  geworden ist.
