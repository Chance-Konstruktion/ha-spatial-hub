# Auftrag für GLM — Die Wände auf den heutigen Stand bringen

> Zu MR !16. Der Zweig `glm/waende` ist rot, und es liegt **nicht** an
> der Arbeit: die Pipeline ist grün (7838, alle fünf Jobs), die Tests
> laufen durch. Rot ist `merge_status = cannot_be_merged`, Ursache
> `conflict`.
>
> Nicht committen — der Arbeitsbaum bleibt zur Durchsicht liegen.

## 1. Was passiert ist, und wessen Fehler das ist

Der Zweig wurde von einem **veralteten `main`** abgezweigt. Die Basis ist
`e6b58fd` vom **25. August**; seither sind fünfzehn Commits auf `main`
gelandet. Das ist mein Fehler beim Anlegen des Auftrags, nicht deiner —
der Klon war nicht frisch geholt, bevor der Zweig gesetzt wurde.

Textuell ist der Schaden klein: **vier Konfliktblöcke** in drei Dateien.
Inhaltlich ist er es nicht, denn zwei der fünfzehn Commits liegen genau
in dem Bereich, den dieser Auftrag angefasst hat.

## 2. Der eigentliche Konflikt: zwei Lösungen für dasselbe Problem

**`83ea464` — „Ein Name weicht zur Seite und stellt sich in die Mitte"**
(25. August). Ein Raumname weicht **seitwärts** aus, solange er in seiner
eigenen Kontur bleibt. Nach oben und unten ausdrücklich nicht: dort wäre
er im Raum des Nachbarn, und der heißt anders. Der Versatz heißt `slide`
und wird von `_roomLabelSlide()` berechnet.

**Dein Zweig** lässt denselben Raumnamen **senkrecht** ausweichen und gibt
ihm sonst einen Träger hinter die Schrift, um dem Mauerwerk zu entgehen.
Der Parameter heißt `walls`.

Beide sitzen auf demselben Aufruf:

```js
const roomPolygon = (
<<<<<<< HEAD
  { project, floor, counterScale, crowded = true, labelSize = null, walls = null },
=======
  { project, floor, counterScale, crowded = true, labelSize = null, slide = 0 },
>>>>>>> origin/main
```

Ein `git checkout --ours` oder `--theirs` wirft hier jedes Mal eine
fertige, begründete Lösung weg. **Beide Ausweichwege müssen zusammen
bestehen**, und die Reihenfolge, in der sie greifen, ist eine
Entscheidung, die getroffen und aufgeschrieben werden muss.

Mein Vorschlag, ausdrücklich kein Befehl: seitwärts zuerst (er kostet
nichts, der Name bleibt in seiner eigenen Kontur), dann senkrecht, dann
der Träger. Wenn das Lesen des Codes eine bessere Ordnung zeigt, gilt die
bessere — mit Begründung in der BEFUND.md.

Die vierte Stelle, `panel-view.js`, ist derselbe Konflikt eine Ebene
höher: `roomLabelSpot(corners, walls, …)` gegen
`labelPointOf(corners, …) + _roomLabelSlide(…)`. Wichtig daran ist der
Kommentar, der auf `main` steht — *„Derselbe Versatz, den `_roomPolygon`
beim Zeichnen setzt."* Wer die beiden Stellen auseinanderlaufen lässt,
zeichnet den Namen woanders hin, als die Entzerrung ihn verbucht hat. Das
fällt in keinem Test auf, der nur eine der beiden Seiten liest.

## 3. Die zweite Baustelle: `e019c2d`

**„Die Tiefe rechnet gegen die Tiefe, nicht gegen die Breite"**
(6. September). Auf `main` wurde eine Tiefenangabe korrigiert, die um das
Seitenverhältnis zu groß war — bei 1,6 also um 60 %.

Das berührt deine **zweite bewusste Abweichung**: das eigene
Seitenverhältnis im ViewBox statt `0 0 1000 1000`, damit die Wand in
beiden Achsen gleich dick ist. Beides rechnet am selben Verhältnis, aus
verschiedenen Richtungen. Diese Datei kommt in der Konfliktliste vor, und
hier genügt es nicht, dass es sich übersetzen lässt — es muss danach noch
**stimmen**. Nachrechnen, nicht nur auflösen.

## 4. Die stille Gefahr: die Testdatei führt sich selbst zusammen

`tests/test_panel_logic.mjs` hat **keinen** Konflikt. Git fügt beide
Seiten zusammen, und heraus kommen **377 Tests** — deine 364 plus
dreizehn, die auf `main` dazugekommen sind.

Das ist die gefährlichste Stelle des ganzen Auftrags, weil sie wie ein
Erfolg aussieht. Diese dreizehn Tests sind nie gegen deinen Code
gelaufen, und mehrere davon prüfen genau die Beschriftungslogik, die du
umgebaut hast. Ebenso ist dein angepasster Test *„die Hausansicht setzt
keine zwei Namen aufeinander"* nie gegen `main`s seitliches Ausweichen
gelaufen.

Läuft ein Test von `main` nach der Zusammenführung rot, ist die erste
Frage **nicht**, wie man ihn grün bekommt, sondern ob er recht hat.

## 5. Was zu tun ist

```bash
cd /c/Users/Chris/.claudecode/repos/ha-spatial-hub
git fetch origin
git merge origin/main
```

Dann die vier Blöcke auflösen, so dass beide Ausweichwege bestehen
bleiben. Danach beide Suiten, und beide müssen **ganz** grün sein:

```bash
PYTHONUTF8=1 python -m pytest -q
```
```bash
node tests/test_panel_logic.mjs
```

Messlatte nach der Zusammenführung: **377** Node-Tests, `fail 0`,
`skipped 0`. Die Python-Seite darf keinen Skip zeigen — ein Skip
bedeutet dort, dass Node fehlt und Hunderte JS-Tests stumm übersprungen
werden.

Kein Test von `main` darf gelöscht oder abgeschwächt werden, um die
Zusammenführung grün zu bekommen. Muss doch einer angefasst werden, ist
das ein eigener, benannter Punkt in der BEFUND.md, mit demselben Maß an
Begründung wie beim letzten Mal — dort war der Eingriff in die Messlatte
sauber offengelegt, und genau deshalb war er in Ordnung.

## 6. Abnahme

- `git status` zeigt keine Konfliktmarken, `grep -rn '<<<<<<<' custom_components tests` findet nichts.
- 377 Node-Tests, `fail 0`, `skipped 0`.
- Python grün, ohne Skip.
- `BEFUND.md` ergänzt um einen Abschnitt „Zusammenführung": wie die
  beiden Ausweichwege geordnet wurden und warum, was mit dem
  Seitenverhältnis aus `e019c2d` passiert ist, und welche der dreizehn
  neuen Tests etwas zu beanstanden hatten.
- Für das menschliche Auge dazuschreiben, was jetzt neu nachzusehen ist:
  ein Raumname, der **beide** Ausweichwege zugleich braucht — seitlich
  eng und auf Mauerwerk. Das ist der Fall, den vorher keine der beiden
  Lösungen kannte.

## 7. Danach

Der nächste Auftrag liegt schon: `AUFTRAG-GLM-EXPERTEN-SKALA.md` in
`repos/monad` auf dem Zweig `glm/experten-skala`. Der hier geht vor —
eine fertige Arbeit, die nicht hineingeht, ist keine fertige Arbeit.
