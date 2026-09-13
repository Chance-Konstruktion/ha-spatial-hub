# Befund: Wände, die aussehen wie Wände

Stand nach der Arbeit auf `glm/waende`. Messlatte vorher aufgenommen:
`PYTHONUTF8=1 python -m pytest -q` → **370 bestanden** (der Auftrag nannte
369; die Suite ist seitdem um einen Test gewachsen — beide Male ohne
Skip, Node war also da). `node tests/test_panel_logic.mjs` → **351
bestanden** (Auftrag: 315; derselbe Grund). Nachher: **370 / 364**, keine
Skips, 13 neue Tests.

---

## Teil 1: Die Etagenansicht hat jetzt Wände

**Was gebaut wurde.** `_stageWalls()` in `panel-view.js` zeichnet in der
Einzelansicht ein SVG-Layer (`.walls`) mit einem Band je Wandseite:
Mauerwerk als Viereck zwischen Raumkante und Innenversatz, Türen als
Lücke mit Schwelle und Schwenk, Fenster als helle Scheibe im
durchlaufenden Band. Die Geometrie steht in `panel-geometry.js`
(`planWallsOf`, `planOpeningMarksOf`, `flushSidesOf`, `PLAN`) und teilt
mit dem Stapel, was dasselbe ist — `wallRuns`, `along`, `openingsOn`,
die Schwellen-/Lücken-Logik — und unterscheidet sich nur dort, wo die
Ansichten es müssen.

**Der Zeichenweg — Entscheidung und warum.** Der Auftrag schlug ein SVG
*unter* den Raum-`div`s vor. Gebaut habe ich den Layer **über** den
Räumen, direkt unter dem `edges`-SVG. Drei Gründe:

1. Die Raum-`div`s haben einen zu 70 % durchscheinenden Grund.
   Darunter gezeichnete Wände wären genau die halbdurchsichtige
   Andeutung geblieben, die der Stapel abgeschafft hat, weil sie sich
   mit sechzehn Räumen zu Grau summiert. Der Stapel zeichnet Mauerwerk
   **deckend** — derselbe Grund gilt hier.
2. Die gestrichelte Kante des Raumkastens *ist* heute die "Wand". Ein
   Layer unter dem Kasten ließe diese Randlinie über dem Mauerwerk
   stehen; ein Layer darüber ersetzt sie dort, wo Mauerwerk ist.
3. `pointer-events:none` macht die Lage egal: Getroffen wird, was unter
   dem Layer liegt. Der einzige Preis liegt im Sichtbaren, und der wird
   bezahlt: Der Raumname rückt um die Dicke der Wand vor seiner Ecke
   nach innen (`--wall-band-top`/`--wall-band-left` als CSS-Variablen
   am Raum, `calc` im Stylesheet), und während des Arrangierens tritt
   der Layer auf 30 % Deckkraft zurück, damit Griffe, Ecken und
   Trenn-Markierungen sichtbar bleiben. Ansichtsmodus: volle Wände.

`data-area` bleibt das Trefferziel, Verschoben und Größen-geändert wird
wie vorher — mit Test belegt (der Zeiger-Test drückt sogar den Fall
"Wand-Layer im Pfad" durch, und die CSS-Prüfung hält
`pointer-events:none` fest).

**Zwei Entscheidungen mehr, beide abweichend vom Stapel, jede mit
Grund:**

- **Dicke je Kante statt je Raum.** Der Stapel entscheidet
  `drawsTheWall` pro Raum, hier pro Kante — ein Raum kann auf der einen
  Seite teilen und auf der anderen nicht. Die Entscheidung selbst ist
  dieselbe (`drawsTheWall` über `_wallKeeper`, eine Funktion, an zwei
  Stellen benutzt: Zeichnen und Wandvierecke fürs Entzerren).
- **Aussenwand = Seite an der Bauflucht, kein Ring um 0..1.** Der Stapel
  legt einen 13er-Ring um die ganze Platte, auch dorthin, wo kein Raum
  steht, und übermalt damit (an der Vorderkante) Türen, die im
  Aussenraum liegen. Der flache Grundriss zeichnet nur, was Bauten hat:
  Eine Raumseite, die auf dem Rand von `floor.outline` liegt — den
  Kasten leitet der Hub aus den Räumen her —, bekommt die dicke
  Aussenwand; alles andere Innenwand. Eine Haustür bleibt also eine
  Lücke, und ein Hof ohne Raum bekommt keine Mauer aus dem Nichts. Die
  Dicke selbst ist dieselbe Proportion wie im Stapel
  (`STACK.wall/STACK.width`, `STACK.outerWall/STACK.width` als `PLAN`),
  nur auf die Hausbreite bezogen statt in Bildeinheiten.

**Der ViewBox.** Der Auftrag schlug dieselbe normierte Fläche wie das
`edges`-SVG (`viewBox="0 0 1000 1000"`) vor. Das habe ich korrigiert:
Die Bühne wird gestreckt, damit das Haus sein echtes Seitenverhältnis
hält — gleiche Dicke in x und y wäre auf dem Schirm um genau diesen
Faktor verschieden gewesen (links/rechts 1,6× so dick wie
oben/unten). Der Wand-ViewBox rechnet die Streckung heraus
(`viewBox="0 0 1000 H"`, `H = 1000·spanY/(aspect·span)`); eine Einheit
ist dort eine Einheit, und die Wand ist rundum gleich dick — das ist
der Sinn von "wie auf Papier".

**Nischen.** Freie Konturen laufen durch dieselben Funktionen wie
Rechtecke; der Einrast-Punkt jeder Kante wird senkrecht zur Kante
versetzt, die Laufrichtung der Kontur wird über die Fläche mit
Vorzeichen (`shoelace`) erkannt, damit eine gegenläufig gesetzte Ecke
Mauerwerk *im* Raum lässt und nicht im Garten.

---

## Teil 2: Die Beschriftung bleibt auf dem Boden

**Was gebaut wurde.** Die Wandvierecke des Stapels — dieselben, die
gezeichnet werden, als Punkte statt als Zeichen
(`wallQuadsOf`/`capQuadsOf`/`wallPolygonsOf`, die String-Erzeuger
`wallsOf`/`capsOf` darüber) — sind jetzt Hindernisse für die
Beschriftung:

1. **Raumnamen** (`roomLabelSpot`) weichen vertikal aus, bis der Kasten
   wandfrei liegt; bleibt keine Stelle, bekommen sie einen Träger
   hinter die Schrift (`room-label-backdrop`), bevor sie unlesbar aufs
   Mauerwerk fallen. Der Punkt wird an *einer* Stelle gerechnet
   (`roomLabelSpot`) und an zwei benutzt — Zeichnen und Entzerren —,
   damit sie sich nie um ein Pixel verfehlen.
2. **Gerätenamen** weichen im `declutter` den Wänden aus wie den
   anderen Namen. Die Wände sind dabei ein **weiches** Hindernis:
   erst der wandfreie Platz, dann der mit dem wenigsten Mauerwerk, und
   erst wenn nicht einmal die Wand neben den anderen Namen Platz bietet,
   wird weggeblendet. Ohne Wand-Argument verhält sich `declutter`
   zeichengleich wie vorher (alle Bestandstests darüber laufen
   unverändert).

**Zwei Entscheidungen, die der Auftrag anders erwarten ließ:**

- **Raumnamen werden nie gekürzt.** Der Auftrag nennt Kürzen als
  zweite Stufe. Sie kollidiert mit einer Entscheidung, die die Suite
  bereits festhält: Eine Etage setzt Raumnamen in *einer* Größe, mit
  Untergrenze 10 px, und was dann noch über die Wand hinaussteht, ist
  die ehrliche Auskunft ("der Raum ist zu schmal für seinen Namen").
  Ein halber Name mit Auslassungspunkten widerspricht dem und würde den
  Test "a name too wide for its room is set smaller" brechen. Raumnamen
  springen also von Stufe 1 (Ausweichen) direkt zu Stufe 3 (Träger);
  die Stufe 2 gehört den Gerätenamen, und deren "weglassen" gibt es
  längst (`hidden`).
- **Ein bestehender Test ist angepasst worden.**
  "die Hausansicht setzt keine zwei Namen aufeinander" zählte bisher
  auch *weggeblendete* Namen als Kästen — ein Fall, der in seinem Modell
  nie eintrat. Mit Wand-Flucht blendet das Entzerren in dem vollen
  Raum ("Deckenlicht") einen Namen aus, statt ihn aufs Mauerwerk zu
  setzen — genau die ehrliche Reihenfolge des Auftrags. Der Test
  überspringt `crowded`-Knoten jetzt wie sein Schwester-Test
  ("kein sichtbarer Name liegt auf einem fremden Geraetesymbol"), der
  das schon immer so hielt. Das ist die einzige Stelle, an der ein
  vorher grüner Test verändert wurde; seine Aussage ("keine zwei
  *sichtbaren* Namen aufeinander") ist schärfer gefasst, nicht
  abgeschwächt.

**Der Zähltest.** `Beschriftungen liegen auf Boden, nicht auf
Mauerwerk` liest Wände und Namen aus dem gezeichneten SVG zurück
(geprüft wird das Bild, nicht die Absicht) und summiert die
Schnittfläche (Sutherland–Hodgman-Clip + Fläche, `coveredAreaOf`).
Obergrenze: 400 px² gesamt, eine messbar betroffene Beschriftung —
Rauschen an einer Kante soll nicht rot schlagen, ein Rückfall in
"Wand ist Beschriftungsfläche" schon. Ohne die Wand-Flucht liegt der
Wert im vierstelligen Bereich; das nachprüft der Entwurf des Tests
gegen die alte Mechanik.

---

## Zusammenführung: `main` nachholen (MR !16)

**Der Stand.** Der Zweig war von `e6b58fd` (25. August) abgezweigt, und
`main` war um fünfzehn Commits weitergezogen — zwei davon in diesem
Gebiet: `83ea464`, der Raumname weicht einem Geraetepunkt **seitwärts**
aus (`slide`, `_roomLabelSlide`), und `e019c2d`, die Tiefenangabe
rechnet gegen die **Tiefe** (`metresDeep`). Vier Konfliktblöcke in drei
Dateien, alle mit der Form „zwei fertige Lösungen für verwandte
Probleme". Die Testdatei hat git selbst zusammengeführt — 364 + 13 =
377 Tests ohne eine einzige Konfliktmarke, die gefährlichste Stelle des
Auftrags, weil sie wie ein Erfolg aussieht.

**Die Reihenfolge der Ausweichwege — Entscheidung und warum.** Die
beiden Lösungen lösen *verschiedene* Kollisionen: der Versatz einen
Geraetepunkt in der Raummitte, die Wandsuche das Mauerwerk. Sie greifen
jetzt in dieser Ordnung: **erst seitwärts, dann senkrecht, dann der
Träger.** Mechanisch heißt das: `roomLabelSpot()` hat einen Parameter
`slide` bekommen und setzt ihn an den *Anfang* seiner Suche — der Name
beginnt dort, wohin der Versatz ihn gestellt hat, und sucht von dieser
Stelle aus vertikal den freien Boden. Der Versatz wird also nicht mehr,
wie auf `main`, hinten ans Ergebnis geklebt. Drei Gründe:

1. Die Wandsuche prüft dann die Stelle, an der der Name am Ende steht.
   Käme der Versatz nach der Suche, könnte er den Namen auf das
   Mauerwerk zurückschieben, das sie gerade vermieden hat — und der
   Träger wäre an einer Stelle entschieden worden, an der der Name gar
   nicht mehr steht. Genau der Fehler, der in keinem Test auffällt, der
   nur eine der beiden Seiten liest.
2. Der Versatz ist die billigere, kontursichere Weisung: `slideClear`
   hält die Namensmitte innerhalb der eigenen Kontur — er kann der
   Suche nichts Kaputtes vorlegen.
3. Die Invariante bleibt gewahrt: Zeichnen und Entzerren rechnen
   dieselbe Stelle. Beide Seiten (`_roomPolygon`, `_stackRoomLabels`)
   rufen `roomLabelSpot` mit demselben Versatz aus `_roomLabelSlide`;
   mains Test „the drawn name and the one decluttering knows about
   slide together" gleicht die Stelle jetzt sogar schärfer ab, denn sie
   enthält beide Mechanismen.

Der Vertrag steht dreifach hingeschrieben (am Erzeuger
`_roomLabelSlide`, an der Suche `roomLabelSpot`, am Zeichner
`roomPolygon`), und ein neuer Test hält ihn fest: „der Seitenversatz
setzt den Anfang der Wandsuche, nicht ihr Ende". Gegengeprobt: unter
der umgekehrten Reihenfolge liefert dieselbe Rechnung y=148 statt
y=100 — der Test schlägt an.

**Ehrliche Grenze.** Der Versatz wird an der Ausgangshöhe gegen die
Kontur geprüft (`spanRangeAt`). Wandert die Suche danach senkrecht,
kann bei getaperten Konturen (Trapez, Nische) die verschobene x-Lage an
der neuen Höhe enger sein als an der alten; die Suche prüft
Wandbedeckung, nicht Konturzugehörigkeit — das tat sie vor der
Zusammenführung genauso, denn auch die Raummitte liegt in einer Nische
nicht auf jeder Höhe drin. Für Rechtecke ist es bedeutungslos; für das
Auge vermerkt unten.

**Das Seitenverhältnis aus `e019c2d` — nachgerechnet, nichts zu
ändern.** Zweig und Commit rechnen am selben Verhältnis aus zwei
Richtungen, und beide Rechnungen bleiben richtig:

- Der Wand-ViewBox hebt die Streckung der Bühne exakt auf:
  `viewHeight = 1000 · spanY / (houseAspect · span)` ist der Kehrwert
  der Bühnen-Achse `houseAspect · span / spanY`. Eine Einheit im
  Wand-Layer ist auf dem Schirm in beiden Achsen gleich lang: x-Einheit
  W/1000 px, y-Einheit H/viewHeight mit H = W·spanY/(houseAspect·span)
  — beides W/1000. (Zahlenbeispiel: Haus 1,6 × 1, Bühne 2000 × 1000 px,
  ViewBox 1000 × 500 — 2 px je Einheit in beiden Achsen.)
- `e019c2d` korrigiert nur die Zahlen *neben* der Zeichnung. Die
  Wanddicke ist ein Anteil der Haus*breite* (`PLAN.wall`), und weil der
  Layer maßstäblich ist, liest sich derselbe Anteil in beiden Achsen
  als dieselbe physische Dicke — eine Dicke, die mit der Richtung
  schwankte, wäre der Fehler von `e019c2d` nur in die Zeichnung
  verlagert.
- Die Raummaße stehen nach der Zusammenführung auf
  `metresAcross`/`metresDeep`; die beiden Nachrechne-Tests von
  `e019c2d` laufen grün. Übrig gebliebene direkte
  `houseMetres`-Verwendungen: die Maßkette quer zur Vorderkante (die
  misst Breite — richtig so) und das Hausbreiten-Eingabefeld selbst.

**Die dreizehn Tests aus `main`: keiner hat etwas zu beanstanden.**
Alle liefen nach der Zusammenführung ohne Anpassung grün. Die vier
Versatz-Tests spielen auf der Terrasse — einem Deck ohne Mauerwerk,
`_stackWallPolys` sammelt nur für INDOOR —, dort greift der Versatz
allein, und sein Ergebnis stimmt mit der neuen Ordnung: die Suche
startet an der verschobenen Stelle, findet sie wandfrei und rückt
nicht senkrecht. Der angepasste Zweig-Test „die Hausansicht setzt keine
zwei Namen aufeinander" hat seinen ersten Lauf gegen das seitliche
Ausweichen bestanden (drei Kästen, keine Überlappung). Gelöscht oder
abgeschwächt wurde kein Test.

**Neu in der Suite.** Ein Test (siehe oben) — 378 statt der als
Messlatte genannten 377; der zusätzliche hält die
Reihenfolge-Entscheidung als Vertrag fest, sie lebte sonst nur in
Kommentaren. Dazu zwei Kommentar-Reparaturen ohne Code-Änderung:
`roomLabelSpot` behauptete, der Name probiere „einen gekürzten Namen"
— gekürzt wird bewusst nie (Entscheidung in Teil 2); `slideClear`
behauptete pauschal, ein Raumname weiche „nicht nach oben oder unten"
aus — das gilt für den Versatz gegen Punkte, nicht für die Wandsuche.

---

## Was nur ein Mensch beurteilen kann

Playwright läuft hier nicht — das Panel wurde nie gerendert gesehen.
Geprüft ist, *was* gezeichnet wird (378 Node-Tests, darunter 13 neue aus
`main` und einer für die Ausweich-Reihenfolge, rechnen die SVG-Strings
nach); wie es *aussieht*, steht in diesen Punkten auf Probe:

- **Ein Raumname, der beide Ausweichwege zugleich braucht:** seitwärts
  eng, weil ein Geraetepunkt in der Mitte steht, *und* auf Mauerwerk an
  der verschobenen Stelle. Der Name muss seitwärts ausrücken und von
  dort senkrecht weiter; genau dieser Fall existierte vor der
  Zusammenführung in keiner der beiden Lösungen. Der neue Test prüft
  die Reihenfolge — den Anblick sieht er nicht.

- **Etagenansicht, Ansichtsmodus:** Lesen die Wände sich als Mauerwerk
  (Bandfarbe = Mauerkrone des Stapels, Fallback-Kette
  `--fp-wall-top → --fp-surface → --card-background-color`)? Ist der
  Unterschied dick/dünn aus zwei Metern zu sehen, und zwar in *beiden*
  Achsen (der ViewBox soll die Streckung rausrechnen — das ist
  nachgerechnet, nie angesehen)?
- **Türen und Fenster im Grundriss:** Steht der Türschwenk im Raum und
  nicht im Nachbarraum (Winding-Erkennung über `shoelace` — bei
  gegenläufig gesetzten Nichten wäre das die erste falsche Stelle)?
  Wischt die Schwelle die Kante sauber weg, ohne dass man sie merkt?
- **Bearbeiten-Modus:** Sind 30 % Wanddeckkraft der richtige
  Kompromiss? Man sieht Kanten und Griffe durch das leise Mauerwerk —
  ob das "Arrangieren mit Anhaltspunkt" oder "Zwei Zeichnungen
  übereinander" liest, entscheidet die Hand.
- **Raumnamen über den Bändern:** Der Versatz rechnet die Wanddicke in
  Prozent des Kastens um (`--wall-band-top`). Bei sehr flachen Räumen
  könnte der Name tiefer als beabsichtigt stehen; nachgemessen ist die
  Formel, nicht der Anblick.
- **Dunkles Thema:** Die Farben kommen aus denselben Ketten wie im
  Stapel und folgen `--card-background-color`/`currentColor` — aber ob
  ein dunkles Band mit heller Kante auf dem dunklen Blatt *liest*, ist
  Anblicksache.
- **Der Träger hinter Raumnamen:** Er tritt nur auf, wenn kein freier
  Boden war (im Testmodell: ein 8 % tiefer Raum). Ob er als "Blatt des
  Planes" liest und nicht als Sprechblase, kann nur das Auge sagen.
- **Der Stapel danach:** Die Namen wandern (Ausweichen, Träger) — ob
  die neue Verteilung *ruhiger* ist als die alte, dafür gilt dieselbe
  Messlatte wie vorher: Bild ansehen.

## Was außerhalb blieb

`hub.py`, `registry.py`, Anker, Provider-API: unangetastet. Keine neue
Abhängigkeit, kein Playwright. `docs/` blieb ganz wie es war — keine
Aussage dort ist durch diese Arbeit falsch geworden; die
Spezifikationsregeln zu Türen (Lücke durch die ganze Mauer, Öffnung in
jeder Ansicht, Unlesbares weglassen statt raten) werden von der neuen
Zeichnung erfüllt, nicht nur von der alten.
