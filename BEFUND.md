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

## Was nur ein Mensch beurteilen kann

Playwright läuft hier nicht — das Panel wurde nie gerendert gesehen.
Geprüft ist, *was* gezeichnet wird (364 Node-Tests, darunter 13 neue,
rechnen die SVG-Strings nach); wie es *aussieht*, steht in diesen
Punkten auf Probe:

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
