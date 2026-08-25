# Roadmap

Wo Spatial Hub steht, und was noch kommt.

Wohin das Ganze soll, steht in **[docs/Vision.md](docs/Vision.md)**:
installieren, öffnen, alles ist schon da. Diese Roadmap ist die Antwort
darauf, wie weit es bis dahin noch ist — die Phasen ab 15 sind direkt aus
der Vision abgeleitet und stehen noch aus.

Das Ziel dahinter ändert sich in keiner Phase: **Der Hub darf keine
einzige Integration beim Namen kennen.** Er kennt Provider, Layer, Nodes,
Edges, Actions und Capabilities — mehr nicht. In dem Moment, in dem
irgendwo ein Sonderfall für Powerline oder UniFi steht, ist aus der
Plattform ein weiteres Dashboard geworden.

Die zweite Hälfte der Vision ist eine Frage an jedes Feature:
**Macht das die Wohnung verständlicher?** Wenn nicht, gehört es nicht
hierher — egal wie gut es sich baut.

| Phase | Was | Status |
|---|---|---|
| 1 | Fundament: Datenmodell, Provider-Registry, Event-System | ✅ |
| 2 | Provider-API + DX | ✅ |
| 3 | Renderer | ✅ |
| 4 | Zero-Config: der Grundriss folgt dem Haus | ✅ |
| 5 | Edit-Modus | ✅ |
| 6 | Themes | ✅ |
| 7 | Generic Adapter | ✅ |
| 8 | Provider-SDK | ✅ |
| 9 | Eigene Provider migrieren | ✅ |
| 10 | Community | ✅ |
| 11 | Austauschbare Renderer | ✅ |
| 12 | Zero-Config als Endzustand | ✅ |
| 13 | Feedback aus der ersten Version | ✅ |
| 14 | Spezifikation 1.0 | ✅ |
| 15 | Gebäudeflucht: Außenwände über alle Etagen | ✅ |
| 16 | Licht, das den Raum beleuchtet | ⬜ |
| 17 | Ein Editor, den ein Kind bedient | ⬜ |
| 18 | Klima im Raum | ⬜ |
| 19 | Wetter über dem Haus | ⬜ |

---

# Die nächste Etappe

Ab Phase 14 sind es zwei verschiedene Baustellen, und sie brauchen
verschiedene Arbeit.

**Spatial Hub als Software.** Läuft, tut was es soll, und dem fehlt vor
allem Feinschliff. Das ist die Baustelle, an der bisher fast alle Zeit
verbraucht wurde.

**Spatial Hub als Standard.** Fertig gebaut und unbenutzt. SDK,
Conformance-Kit, Spezifikation, `ASK_FOR_SUPPORT` in zwei Sprachen — die
ganze Maschinerie steht seit Phase 8 bereit, und **noch nie hat sie jemand
Fremdes angefasst.**

Zwei Zahlen, an denen das hängt:

- Beide angebundenen Provider sind unsere eigenen. Powerline und
  ESPEasy P2P, beide aus demselben Haus.
- Der Renderer ist mit ~6.400 Zeilen größer als der gesamte Hub mit
  ~3.700 auf fünfzehn Module. Immerhin liegt er nicht mehr in *einer*
  Datei — Stylesheet und Geometrie sind heraus, die Klasse bleibt.

**Eine dritte Zahl ist dazugekommen, und sie ist unangenehmer.** Die
Spezifikation beruft sich auf RFC 2119 und stellt damit **49 Zusagen**
auf. Bis hierher konnte niemand — auch wir nicht — sagen, welche davon
geprüft werden und welche bloß Prosa sind. Jetzt steht das in
[`docs/PRUEFUNGEN.md`](docs/PRUEFUNGEN.md), und ein Test erzwingt es:
Jede normative Stelle braucht einen Eintrag, jeder genannte Test muss
existieren, und die Zahl der ungeprüften darf nicht wachsen.

Der Stand am Tag der Einführung: **6 von 49 ungeprüft**, dazu 6 bewusst
als Prosa geführt. Das ist besser, als ich erwartet hatte — und die
sechs offenen sind jetzt eine Liste statt eines Gefühls.

Beim Anlegen der Tabelle hat der Riegel sofort zugeschlagen: Fünf
Testnamen, die ich aus dem Gedächtnis eingetragen hatte, gab es nicht.
Eine Zeile, die auf einen erfundenen Test zeigt, ist schlimmer als
`offen` — sie sagt, hier sei alles in Ordnung.

Zwei eigene Provider sind eine Integration. Fünf fremde sind eine
Plattform. Solange nur wir selbst die API benutzen, ist sie womöglich
unbemerkt auf unsere Denkweise zugeschnitten — **der erste fremde
Entwickler ist der eigentliche Architekturtest**, und den hat es nie
gegeben.

Das ist strategisch die wichtigere Baustelle. Nicht weil Licht und
Animation unwichtig wären, sondern weil sie die zentrale Behauptung des
Projekts prüft: *Kann jeder Entwickler mit wenig Aufwand räumliche
Informationen bereitstellen?* Steht darauf einmal nachweislich „ja", ist
der schwierigste Teil einer Plattform geschafft, und der Renderer darf
danach noch jahrelang besser werden.

Wichtig ist dabei die Wortwahl: Es geht **nicht** um mehr Hub. Der
Hub-Code ist nicht der Engpass. Es geht um das **Ökosystem** — SDK,
Beispiele, Dokumentation, Conformance, Developer Experience. Das ist
etwas anderes als der Hub selbst.

## ✅ A — Den Renderer fertig machen, nicht erweitern

Niemand schreibt einen Provider für etwas, das er nicht gesehen und
gemocht hat. Der Renderer ist das Marketing, und wer heute auf dem
Repository landet, soll nicht „interessant" denken, sondern es
ausprobieren wollen.

„Fertig" ist aber keine Empfindung, sondern eine Liste, sonst wächst sie.
Diese hier ist geschlossen:

- [x] Rechtsklickmenü im Editor: Einstellungen, Raumart ändern, Ecken
      bearbeiten, Anordnung zurücksetzen, ausblenden — auf dem leeren Plan
      Grundstück und Etage. Später die Aufhängung für Möbel.

      **Ohne „duplizieren" und „löschen".** Bereiche gehören dem
      Bereichsregister von Home Assistant, nicht uns. Ein „Löschen" hier
      wäre ein Löschen *überall* — in jedem Dashboard, jeder
      Automatisierung, jeder Sprachsteuerung —, und ein „Duplizieren"
      würde „Wohnzimmer Kopie" ins Register schreiben, wo es nie
      hingehörte. Der Hub sammelt und platziert; er verwaltet nicht. Was
      stattdessen im Menü steht, ist „Ausblenden": derselbe Wunsch, ohne
      fremde Daten anzufassen. Wer einen Raum wirklich anlegen oder
      wegnehmen will, tut das dort, wo Räume herkommen.
- [x] Einrasten an der Kontur der anderen Etagen (der Rest von Phase 15) —
      nur an Konturen, die auch eingeblendet sind, und die getroffene
      Etage sagt es selbst
- [x] Langer Druck auf dem Touchscreen mit demselben Verhalten wie mit der
      Maus — ein halbe Sekunde, zehn Pixel Spielraum, und ein Zug, der
      noch nicht losgelaufen ist, wird dabei zurückgenommen
- [x] Ein Satz Screenshots, der die Hausansicht zeigt, wie sie gemeint ist —
      erzeugt statt abfotografiert, aus dem echten Hub und dem echten
      Renderer (`tools/demo_house.py`, `tools/shots.mjs`), und beim ersten
      Hinsehen sofort drei Fehler gefunden, die alle Tests grün gelassen
      hatten

Was **nicht** auf dieser Liste steht, gehört in eine spätere Phase:
Licht, Klima, Wetter, Mehrfachauswahl, Favoriten, eigene Icons hochladen,
freie Label-Positionen.

**Was der letzte Punkt gekostet und eingebracht hat.** Die Screenshots
waren als Werbung geplant und wurden zum Prüfmittel: Das erste Bild zeigte
auf einen Schlag drei Fehler, die alle 500 Tests grün gelassen hatten.
„Untergeschoss" war links abgeschnitten, weil der Platz für den Etagennamen
eine feste Zahl war und für „EG" gereicht hatte. Ein Balkon im
Obergeschoss lag als Ring um die ganze Wohnung, weil er dieselbe Anordnung
bekam wie ein Garten — richtig gezeichnet, falsch angeordnet. Und der
Raumname stand genau dort, wo die Automatik das erste Gerät hinsetzt, also
lag „Adapter Arbeitszimmer" quer über „Arbeitszimmer".

Keiner davon ist eine falsche Einzelentscheidung, und keiner war ohne
Hinsehen zu finden — dieselbe Lehre wie in
[`tools/README.md`](tools/README.md), nur diesmal ohne laufendes Home
Assistant. Deshalb sind die Bilder erzeugt und nicht abfotografiert: Sie
lassen sich nach jeder Änderung am Renderer neu machen und wieder ansehen.

## B — Das SDK von jemand anderem testen lassen

Hier liegt der eigentliche Erkenntnisgewinn, und er ist **nicht** von A
abhängig: Wer einen Provider schreibt, öffnet den Renderer nie. Er
schreibt Python, kopiert zwei Dateien und lässt das Conformance-Kit
laufen. A und B können deshalb nebeneinanderher laufen — nur das
*Ansprechen* eines fremden Maintainers lohnt erst, wenn A steht, weil man
den ersten Eindruck nur einmal hat.

Eine Integration, nicht zehn. Am besten jemand, der offen für Neues ist.
Die beiden möglichen Antworten sind beide wertvoll:

- *„Das waren wirklich nur dreißig Zeilen."* — die Plattform trägt.
- *„Ich musste an fünf Stellen suchen."* — genau dort ist nachzubessern,
  und das erfährt man auf keine andere Weise.

Vorher zu klären, weil es die Einstiegshürde senkt:

- [x] Die kürzeste Form — `data=lambda: ["light.kitchen"]`, eine Liste von
      Entity-IDs — stand an drei Stellen beschrieben und war nirgends
      vorgeführt. Jetzt liegt sie als `examples/minimal_provider/`: drei
      Lampen, ein Schalter, ein Sensor, **achtzehn Zeilen**, ohne
      `node()` und ohne Coordinator. Sie läuft in der Testsuite gegen den
      echten Hub und erfüllt denselben Conformance-Vertrag wie die große.

      Ein Test hält sie kurz. Ein Beispiel, dessen Zweck „so wenig ist
      es" lautet, wächst sonst zu: einer macht es live, der Nächste zeigt
      eine Action, und am Ende sagt es das Gegenteil. Was dazugehört,
      gehört nach nebenan.
- [x] Ist das Beispiel das Erste, was ein Maintainer findet? Es war in der
      README, in `sdk/README.md` und in `ASK_FOR_SUPPORT` genannt — und
      nichts davon hilft dem, der im Repository auf `examples/` klickt und
      zwei Ordner ohne Hinweis vorfindet. Jetzt steht dort ein
      `examples/README.md`, das mit dem kürzeren anfängt und in einer
      Tabelle sagt, was das längere mehr kann. Ein Test prüft, dass jeder
      Ordner darin vorkommt — sonst veraltet der Wegweiser beim dritten
      Beispiel.

## C — Rückmeldung sofort einarbeiten

Was der erste fremde Entwickler stolpernd findet, wird sonst jeder
folgende ebenfalls finden. Diese Phase hat bewusst keinen Inhalt: Sie
wird von B gefüllt.

## D — Erst danach weitere Provider

Und erst danach die Feature-Phasen 16–19.

## ✅ E — Die Etage als Zeichnung, nicht als Oberfläche

Der Anlass war eine hochgeladene Referenz: ein Grundriss auf schwarzem
Grund, weiße Haarlinien, Wände mit echter Dicke, Türen als Lücken, die
Treppe mit einzelnen Stufen, der Balkon schraffiert. Daneben gehalten war
klar, was hier gebaut worden war: **ein Dashboard, das Räume anzeigt** —
graue Karten mit gestrichelten Rändern und bunten Kreisen darauf. Die
Referenz ist das Umgekehrte: eine Zeichnung, die man bedienen kann.

Das ist kein Geschmacksstreit, sondern ein anderer Startpunkt, und der
war nie übernommen worden.

**Reihenfolge: erst eine Etage, dann der Stapel.** Nicht aus Vorsicht —
die Bodenplatte unten ist für die einzelne Etage falsch und für das
Sandwich vermutlich richtig, und beides gleichzeitig zu entscheiden geht
nicht.

- [x] **Die Perspektive.** War eine Parallelverschiebung: nach hinten
      rutschte jeder Punkt gleich weit nach rechts, also lehnten beide
      Seitenwände in dieselbe Richtung. Man sah die eine Außenwand von
      außen und die andere von innen — kein Standpunkt, den ein
      Betrachter einnehmen kann. Jetzt ein Fluchtpunkt: die Hinterkante
      ist schmaler als die Vorderkante, gerechnet von der Mitte aus.
      Beide Zahlen (Flucht 87 %, Tiefe 250) sind an der Referenz
      abgemessen, nicht geraten.

      Der alte Test dazu hat den Umbau **nicht bemerkt**, weil er nur die
      linke Flanke prüfte — die einzige, bei der beide Projektionen
      dasselbe tun. Der Unterschied steht rechts.

- [x] **Die Bodenplatte.** Weg, sobald nur eine Etage dasteht — im Stapel
      bleibt sie, denn dort ist sie das, was aus vier Zeichnungen
      übereinander vier Stockwerke macht. Die Gegenprobe aus der Frage
      hat sich also bestätigt: kein Fehler, ein Unterschied zwischen zwei
      Ansichten.

      **Und sie war nicht die Wanne.** Nach dem Entfernen stand das Band
      unten unverändert da. Es ist die vordere Außenwand — legitim, die
      gibt es in der Referenz auch — plus ein leerer Streifen davor, weil
      die Räume die Außenwand nicht erreichen. Auch eine dunklere Füllung
      der Wand ändert daran nichts; beides ausprobiert und angesehen.

- [x] **Die Räume füllen das Haus nicht.** Die Automatik legte sie auf ein
      Raster mit Rand: vorn blieben 2,5 % der Haustiefe über die ganze
      Breite leer, dazu Lücken zwischen den Spalten. In einem echten
      Grundriss ist jeder Quadratmeter jemandes Zimmer, und genau dieser
      Streifen ist es, der zusammen mit der Außenwand als Sockel las.
      Das war **keine Zeichenfrage** — es war `_grid_cell` unter
      `async_arrange_areas`, also die Anordnung, und damit ein Eingriff
      auf der Hub-Seite.

      Der Rand ist weg: jede Zelle gab rundum ein Zwanzigstel ab. Und die
      letzte Reihe ist selten voll — fünf Räume ergeben drei Spalten und
      zwei Reihen, die sechste Zelle blieb leer. Ein Loch im Grundriss.
      Sie wird nicht gefüllt, sie fällt weg: die Räume der letzten Reihe
      teilen die Breite unter sich auf. Am Demohaus bedeckten die Räume
      vorher **67,5 %** ihrer Etage, jetzt 100 %, ohne Überlappung.

      **Was dabei nebenbei heil wurde: die Maßkette.** Jede Fuge war ein
      eigener Abschnitt, zu schmal für seine Zahl, also unbeschriftet —
      von zwanzig Abschnitten trugen zehn ein Maß, und die Teilmaße
      addierten sich nicht zum Gesamtmaß (5,40 + 5,40 unter einem Haus
      von 12,00 m). Jetzt sind es elf Abschnitte, alle elf beschriftet,
      und 6,00 + 6,00 ergibt 12,00. Die Kette hatte nie einen Fehler; sie
      hat die ganze Zeit korrekt gemeldet, dass dort Fugen sind.

- [x] **Die Raumnamen.** Sie kleben an der Hinterwand und laufen
      ineinander („DIELE TREPPE ESSZIMMER"). Nach hinten geschoben wurden
      sie, damit sie nicht auf dem ersten automatisch platzierten Gerät
      liegen — in einer leeren Zeichnung ist das schlicht falsch. Die
      Lösung muss beides können, nicht das eine gegen das andere
      tauschen.

      **Das Kleben ist weg.** Das Ausweichen war eine Pauschale:
      `labelPointOf` schob *jeden* Namen 55 % zur Hinterkante, gemessen
      saß jeder bei Tiefe 0,21 seines Raumes. Jetzt entscheidet der Raum
      — `crowded` sagt, ob in der Mittelbahn wirklich etwas liegt, und
      nur dann weicht der Name aus. Am Demohaus ist das Gäste-WC der
      einzige leere Raum, und sein Name steht jetzt bei 0,48 statt 0,21.

      Gezählt werden dabei die **sichtbaren** Geräte. Wer die Ebene eines
      Providers ausblendet, bekommt eine leerere Zeichnung; ein Name, der
      darin vor einem unsichtbaren Gerät ausweicht, weicht vor nichts
      aus. Das war vorher nicht falsch entschieden, es war gar nicht
      entschieden.

      **Das Ineinanderlaufen ist auch weg.** Es war echt — mit echten
      Textmaßen nachgemessen, nicht geschätzt: Sechs Räume nebeneinander,
      „Hauswirtschaftsraum" 283 px breit in einem Raum von 198 px,
      „Abstellkammer" 201 px in 175 px, drei überlagernde Paare.

      Ein Raumname ist in `declutter` `fixed` — er weicht nicht aus und
      wird nicht weggeblendet, und das bleibt richtig: Ein Raum ohne
      Namen ist schlimmer als ein Gerät ohne Namen. Also wird er
      **kleiner gesetzt**, so wie in einer Bauzeichnung. Unter 10 px hört
      das auf — eine Schrift, die weiter schrumpft, ist keine
      Beschriftung mehr, sondern ein grauer Strich, der so tut als wäre
      er eine.

      **Eine Größe je Etage, nicht je Raum.** Zuerst rechnete jeder Raum
      für sich, und das war messbar richtig und angesehen falsch: „Diele"
      in 16 px direkt neben „Hauswirtschaftsraum" in 10 px liest sich als
      Rangfolge zwischen Räumen, die gleichrangig sind — sechs
      Schriftgrößen in einem Riss sehen aus, als sei etwas
      schiefgegangen. Der Maßstab wird nach dem längsten Namen gewählt,
      so wie am Zeichenbrett auch. Das kostet Größe dort, wo Platz
      gewesen wäre; eine Etage ohne langen Namen bleibt unberührt.

      Gefunden wurde das **nur durch Hinsehen**. Beide Fassungen sind
      nach der Messung gleich gut: null Überlagerungen, kein Name außer­
      halb seines Raumes.

      Gemessen wird gegen die **Kontur auf der Höhe des Namens**, nicht
      gegen das umschließende Rechteck: Ein Raum mit abgeschrägter Ecke
      ist oben schmaler als unten, und ein Name, der gegen das Rechteck
      geprüft wurde, stünde dort trotzdem im Freien.

      Nachher am selben Fall: null Überlagerungen, kein Name mehr außer­
      halb seines Raumes, und alle sechs in derselben Größe. Am Demohaus
      ändert sich **nichts** — alle sechzehn Namen bleiben bei 16 px. Der
      Umbau greift genau dort ein, wo er gebraucht wird.

- [x] **Der leere linke Rand.** Der Etagenname stand groß und gesperrt in
      einer eigenen Spalte, die bei einer einzelnen Etage ein Drittel der
      Fläche fraß. Jetzt ein kleines Wort oben links, sobald nur ein
      Stockwerk dasteht; im Stapel bleibt die Spalte, denn dort sortiert
      sie die Etagen. Zwei Ansichten, zwei Antworten.

      **Das ist kein Randfall.** Eine Wohnung ist ein Haus mit einer
      Etage — wer in einer wohnt, hat bisher ein Drittel des Bildes an
      eine Spalte verloren, in der ein einziges Wort steht.

- [x] **Dann erst das Sandwich.** Und dort noch einmal von vorn: die
      Flucht gilt jetzt pro Etage, `stagger` schob sie gegeneinander —
      ob das zusammen noch als *ein* Gebäude liest, war ungeprüft.

      Nachgesehen: **nein.** `stagger` ist raus.

      Er war einmal richtig. Als die Etagen flache Umrisse dicht
      beieinander waren, hatte das Auge ohne ihn nichts, woran es sie
      trennt. Seither haben sie `rise`, `slab`, Wände mit Dicke und 340
      Einheiten Luft dazwischen — die Aufgabe war erledigt, der Versatz
      nicht.

      34 von 620 Hausbreite sind **5,5 %**: zu wenig für eine erkennbare
      Absicht, zu viel für eine Flucht. Man las keine auseinandergezogene
      Zeichnung *eines* Gebäudes, sondern drei Grundrisse, die nicht ganz
      übereinanderliegen. Zur Gegenprobe mit 80 gezeichnet — dann ist der
      Versatz zwar Absicht, aber es sind drei Zeichnungen auf einer
      Diagonale. Ohne Versatz teilen sich alle Etagen eine Senkrechte,
      und genau das sagt „ein Haus".

      Dazu ein Preis, der mit dem Haus wuchs: Der Versatz addierte sich in
      die Bildbreite. Bei drei Etagen belegte das Haus **71 %** der Breite
      statt 77 %, bei acht nur noch **59 %**. Ein Stapel wurde also umso
      kleiner gezeichnet, je mehr Stockwerke er hat — in der Ansicht,
      deren einziger Zweck der Stapel ist. Jetzt sind es 77 %, unabhängig
      von der Etagenzahl.

      Auch das war **nur durch Hinsehen** zu finden. Der Test dazu hielt
      den Versatz sogar fest (`lower.x > upper.x`) — er prüfte, dass das
      Gewollte geschieht, und nicht, ob es das Richtige ist.

**Was diese Phase gelehrt hat.** Von sechs Punkten waren drei mit Tests
gar nicht zu finden: dass der Name in einem leeren Raum an der Wand
klebt, dass sechs Schriftgrößen in einem Riss wie ein Fehler aussehen,
und dass der Versatz das Gebäude auseinandernimmt statt es zu zeigen.
Bei allen dreien war die Suite grün, und beim Versatz hielt der Test das
Falsche sogar ausdrücklich fest — er prüfte, dass das Gewollte
geschieht, nicht ob es das Richtige ist. Dieselbe Lehre wie bei den
Screenshots in [`tools/README.md`](tools/README.md), nur diesmal
dreimal hintereinander.

**Nachtrag: der Name, der nicht ausweichen konnte.** „Terrasse" lag unter
einem Gerätepunkt, und beide standen bei derselben x-Koordinate — die
Automatik setzt Name und erstes Gerät in die Mitte der Fläche. Das Band
ist rund 35 Einheiten tief, der Punkt 30: senkrecht war nichts zu holen.
Seitwärts lagen im selben Band über 600 Einheiten frei.

Ein Raumname weicht jetzt **zur Seite** aus, solange er in seiner eigenen
Kontur bleibt — und zwar **in die Mitte der Lücke**, nicht knapp am Punkt
vorbei: 128 statt 54 Einheiten Abstand. Ein Name, der an einem Symbol
klebt, sieht aus wie ausgewichen; einer, der in seiner Lücke steht, sieht
aus wie gesetzt. Wo keine Lücke ist, bleibt er stehen; ein Raum ohne Namen
wäre schlimmer.

Danach kommt die Frage, die bewusst offen liegt: **wo der Zustand
hingehört.** Die Referenz kennt kein „Licht an" — sie ist eine
Architekturzeichnung, und das ist ihre Stärke. Der Panel muss es trotzdem
zeigen. Licht *im Raum* statt als Punkt an der Wand wäre die naheliegende
Antwort, und es ist genau das, was Phase 16 ohnehin vorhat. Eine
Gestaltungsentscheidung, keine technische.

## Nebenher: die eine große Datei

`spatial-hub-panel.js` wuchs schneller als alles andere und wurde von
jedem visuellen Feature angefasst — 6272 Zeilen.

**Zwei Stücke sind raus** (5091 Zeilen übrig), und zwar nicht nach
Zeilenzahl, sondern nach dem, was sich schon beschwert hatte:
`panel-styles.js`, weil zwei Werkzeuge das CSS mit einem `indexOf` aus
dem Quelltext schnitten, und `panel-geometry.js`, weil für die
Perspektiv-Proben `_project` monkey-gepatcht und `STACK` von Hand
nachgebaut werden musste. Das Prinzip „kein Build-Schritt" hat das
ausgehalten: ES-Module importieren sich nativ.

Dabei fielen zwei Fallen auf, die vorher unsichtbar waren — die
Cache-Kennung hashte nur eine Datei, und drei Tests, die den *ganzen*
Renderer bewachen sollten, lasen nur eine.

Die Klasse selbst (4966 Zeilen) bleibt vorerst. Ihre Methoden reden
durchgehend über `this`; in Mixins zerschnitten sucht man hinterher
länger als vorher. Nähte gibt es (Editor/Ziehen, Popup, Websocket,
Kamera) — aber das ist ein eigener Auftrag mit echtem Regressionsrisiko
und gehört nicht in denselben Atemzug wie ein optischer Umbau.

---

## ✅ Phase 1 — Fundament

Räumliches Datenmodell in normalisierten 0..1-Koordinaten, Provider-
Registry, Storage für die Nutzeranordnung, Websocket-API.

Die Kopplung zwischen Hub und Provider ist **ein Dict in `hass.data` plus
drei Dispatcher-Signale**. Kein Import in irgendeine Richtung, keine
Ladereihenfolge, keine Abhängigkeit — eine Integration mit Provider-Adapter
läuft unverändert weiter, wenn der Hub gar nicht installiert ist.

Provider-Code gilt als nicht vertrauenswürdig: Exception, Timeout oder
Unsinn kosten den eigenen Layer für genau einen Refresh.

## ✅ Phase 2 — Provider-API

Die vollständige Anbindung ist **ein Aufruf**:

```python
spatial_provider(hass, entry, name="My Integration",
                   data=lambda: ["light.kitchen"], coordinator=coordinator)
```

Registrieren, beim Entladen abmelden, nach jedem Coordinator-Refresh
benachrichtigen, Capabilities ableiten — alles darin. Eine Entity-ID ist
ein vollständiger Node; Name, Bereich, Icon und Zustand holt der Hub aus
Home Assistant.

Dazu `spatial_hub/diagnostics` (was wurde verworfen und warum, inklusive
vermuteter Tippfehler in der Registrierung) und das **Conformance-Kit** —
eine Datei zum Kopieren, nur pytest nötig, das die Fehler fängt, die
Grundrisse im Feld zerlegen.

## ✅ Phase 3 — Renderer

Ein Panel in der Seitenleiste: Etagen als Reiter, Bereiche als Räume,
schaltbare Ebenen, Nodes nach Zustand eingefärbt, Edges nach Qualität,
Popup mit Metadaten/Verlauf/Actions, Diagnose einen Klick entfernt.

Reines ES-Modul, kein Build. Er kennt **keine Integration beim Namen**;
ein Test grept den Quelltext. Er benutzt ausschließlich die dokumentierte
Websocket-API — dieselbe, die auch eine 3D-Ansicht benutzen würde.

## ✅ Phase 4 — Der Grundriss folgt dem Haus

Zero-Config ist nicht nur der erste Render. Ein Plan, der am Montag stimmt
und am Freitag nicht mehr, ist ein Plan, dem niemand traut — und „einmal
neu laden" ist keine Antwort.

- **Registries werden beobachtet.** Bereich umbenannt, Etage angelegt,
  Gerät in einen anderen Raum verschoben: der Plan zieht nach.
- **Entities auf dem Plan sind live**, unabhängig davon, wie langsam der
  Provider pollt, der sie benannt hat.
- **Nur was zu sehen ist, wird beobachtet.** Schaut niemand hin, ist nichts
  zu aktualisieren.
- **Ein Bündel Änderungen kostet einen Refresh**, nicht fünfzehn.
- **Das Haus erscheint vor dem ersten Provider.** Direkt nach der
  Installation stehen Etagen und Bereiche da, statt eines leeren Rechtecks.

---

## ✅ Phase 5 — Edit-Modus

Ein Stift in der Kopfzeile, nur für Admins. Danach: Nodes und Bereiche
ziehen (mit Rasterfang, `Shift` hält ihn aus), Bereiche an der Ecke in der
Größe ändern, Nodes skalieren und drehen, ausblenden — und zurückholen,
denn Ausblenden ist keine Einbahnstraße. Dazu Grundriss-Bild und
Seitenverhältnis pro Etage, Ebenen sortieren und abdunkeln, und ein
Zurücksetzen für die ganze Etage.

Geschrieben wird beim Loslassen, nicht bei jeder Mausbewegung: Ein Zug ist
ein Eintrag im Storage, kein Strom aus fünfzig.

Grundsatz bleibt: Der Provider erfährt nie, dass etwas verschoben wurde.
Und `null` löscht ein Override, statt einen Gegenwert festzuschreiben — was
zurückgesetzt wurde, folgt wieder der Automatik.

## ✅ Phase 6 — Themes

Die interessante Frage war nicht, wie man Farben speichert, sondern **was
ein Theme überhaupt einfärben darf**. Nicht Integrationen: Gäbe es je ein
„Powerline-Blau", bräuchte jeder Provider eine eigene Palette, und wer
keine hat, sähe kaputt aus, ohne etwas falsch gemacht zu haben.

Ein Theme färbt deshalb das **gemeinsame Vokabular** — die Zustände
`online`/`offline`/`unknown` und die Qualitäten `good`/`fair`/`poor`, die
ohnehin jeder Provider spricht. Eine Integration, die nächstes Jahr
geschrieben wird, sieht in dem Moment richtig aus, in dem sie sich
registriert.

Fünf Presets (`auto`, `classic`, `blueprint`, `neon`, `paper`), dazu freie
Farben pro Wort, Knotenform und -größe, Beschriftungsmodus, gerade oder
gebogene Verbindungen, Raumdarstellung. Voreingestellt ist `auto`: leere
Farben bedeuten „nimm, was Home Assistant sagt" — der Hub streitet nicht
mit dem Theme, das der Nutzer längst gewählt hat.

Aufgelöst wird im **Hub**, nicht im Renderer. `model["theme"]` ist fertig
ausgerechnet, damit ein zweiter Renderer dieselben Farben bekommt, ohne ein
einziges Preset nachzubauen.

## ✅ Phase 7 — Generic Adapter

Die meisten Integrationen werden nie einen Provider schreiben. Eine
Plattform, die nur für die Eingeweihten funktioniert, funktioniert nicht.

Also beschreibt der Nutzer eine Ebene selbst — nach Art, Bereich, Label,
Geräteklasse, oder namentlich. Eine **Regel, keine Liste**: „alle Lichter"
stimmt auch noch, wenn nächsten Monat eine Lampe dazukommt. Jede Ebene ist
ein eigener Provider und lässt sich damit einzeln schalten.

Der entscheidende Teil ist, **wie** sie sich registriert: über denselben
öffentlichen Vertrag wie jeder Fremde, mit derselben Validierung und
derselben Fehler-Isolierung. Ein Sonderweg an dieser Stelle wäre der erste
Riss — die eingebauten Ebenen wären dann stillschweigend bessere Bürger als
die Integration von irgendjemand anderem. Ein Test hält das fest.

Seit die Standard-Ebenen dazugekommen sind, gilt das auch ohne jedes
Zutun: Licht, Klima, Türen & Bewegung, Medien sind nach der Installation
da. Und weil Home Assistant in `via_device` selbst führt, worüber ein Gerät
erreicht wird, zeichnet die Licht-Ebene die Bridges und Controller gleich
mit — echte Topologie, ohne eine Integration beim Namen zu nennen.

Dazu `spatial_hub/entities/facets`: welche Arten, Label und Geräteklassen
es in diesem Haus wirklich gibt. Ohne das müsste der Editor raten — und
Raten endet in einer fest verdrahteten Liste von Integrationsnamen.

## ✅ Phase 8 — Provider-SDK

Ursprünglich stand hier „ein gepflegtes Paket auf PyPI". Das wäre der
falsche Schritt gewesen: Das ganze Versprechen an einen fremden Maintainer
lautet *„das kostet dich nichts"* — und eine Abhängigkeit ist nicht nichts.
Sie ist eine Version zum Pinnen, ein Konflikt zum Auflösen, eine
Supply-Chain-Frage im Review und ein weiterer Grund, nein zu sagen.

Also ein **Vendoring-SDK**:

- `sdk/install.py` kopiert die zwei Dateien und druckt den fehlenden Code,
  mit der Domain schon eingesetzt. Läuft auf einem nackten Python, ohne
  Home Assistant, ohne Hub, ohne Netz.
- Der Shim stempelt eine `SDK_VERSION` in seine Registrierung. Der Hub
  meldet in `spatial_hub/diagnostics`, wenn eine Kopie veraltet ist — das
  Einzige, was ein Paket überhaupt gebracht hätte. Eine alte Kopie
  funktioniert weiter; ihr Autor wird informiert, nicht bestraft.
- `examples/example_provider/` ist eine **ganze** Integration, keine
  Schnipsel. Sie läuft in unserer Testsuite gegen den echten Hub und muss
  dasselbe Conformance-Kit bestehen wie fremder Code — Beispiele, die
  verrotten, sind schlimmer als keine.
- `docs/ASK_FOR_SUPPORT.de.md` ist der Text, den ein *Nutzer* bei einer
  fremden Integration einreicht. Mit der Bitte, es einmal zu tun,
  freundlich, und mit dem Angebot, den PR selbst zu schreiben. Der Weg
  einer Plattform führt über die Nutzer der anderen, nicht über uns.

## ✅ Phase 9 — Eigene Provider migrieren

Zwei sind angebunden, und die zweite war der Punkt.

[ha-powerline](https://gitlab.schanz.ipv64.net/chance-konstruktion/ha-powerline) besteht
den Conformance-Vertrag seit Phase 2 ohne Sonderbehandlung — und hat vier
Phasen lang jede SDK-Entscheidung bestätigt, weil es genau die Form hatte,
für die das SDK gebaut war. Ein Provider ist keine Stichprobe.

[espeasy-p2p](https://gitlab.schanz.ipv64.net/chance-konstruktion/espeasy-p2p) hat
in zwanzig Minuten zwei Fehler gefunden. Es hat **keinen
`DataUpdateCoordinator`**, sondern einen UDP-Socket und eigene
Dispatcher-Signale. Der Shim nahm sein `coordinator=` entgegen, fand kein
`async_add_listener` und tat stillschweigend nichts — der Grundriss wäre
einmal gezeichnet worden und hätte sich nie wieder bewegt. Daraus wurde
`signals=` (SDK v2). Und beim Schreiben des Adapters fiel der Fehler *in*
dieser neuen Funktion auf: Dispatcher-Signale reichen ihre Nutzlast an die
Zuhörer weiter, `async_notify()` nimmt keine Argumente. Alle drei
ESPEasy-Signale tragen eine Unit-Nummer — jedes hätte in Produktion beim
ersten Paket geworfen (SDK v3).

Der Adapter selbst hält sich an das, was seine Integration **weiß**: Sie
kann den Pfad zwischen zwei ESP-Knoten nicht messen, also erfindet sie
keine Kanten dazwischen. Home Assistant in der Mitte, eine gestrichelte
Kante je Unit, eingefärbt nach der Stille seit dem letzten Paket — mit einem
Warnband dazwischen, damit ein Knoten sichtbar ist, bevor er rausfällt.

## ✅ Phase 10 — Community

Die Mechanik stand nach Phase 8. Was fehlte, war der Weg dorthin — und ein
Fehler darin, der die ganze vorige Phase halbiert hat: Der Text, den ein
Nutzer bei einer *fremden* Integration einreichen soll, gab es nur auf
Deutsch. Integrationen werden fast durchgehend englischsprachig entwickelt.
[`docs/ASK_FOR_SUPPORT.en.md`](docs/ASK_FOR_SUPPORT.en.md) ist jetzt die
Fassung, die tatsächlich kopiert wird; die deutsche Seite schickt einen
gleich dorthin.

Dazu:

- [`docs/PROVIDERS.md`](docs/PROVIDERS.md) — wer angebunden ist. **Reine
  Dokumentation.** `tests/test_community.py` liest die Domains aus der
  Tabelle und prüft, dass keine davon im Quelltext des Hubs vorkommt. Genau
  hier kippt so ein Projekt üblicherweise: erst eine Liste zum
  Nachschlagen, dann eine Liste mit einem Sonderfall, dann eine Liste, ohne
  die nichts mehr geht.
- Issue-Templates, die zuerst *vom* Issue wegführen: Wer eine fehlende
  Integration meldet, landet beim Editor oder beim SDK. Jede Anfrage, die
  dort endet, wird nie das Problem eines Maintainers — unseres so wenig wie
  seines.
- [`CONTRIBUTING.md`](CONTRIBUTING.md) mit der einen Regel und den drei
  Tests, die sie halten. Und dem Satz, auf den es ankommt: **Du musst uns
  nicht fragen.** Kein Allowlist-Eintrag, keine Freigabe, kein Release von
  uns, auf das jemand wartet.
- Ein Test, der jeden lokalen Link in jeder Markdown-Datei auflöst. Ein
  toter Link im Onboarding-Pfad kostet den Leser, ohne dass es je jemand
  merkt.

## ✅ Phase 11 — Austauschbare Renderer

Zwischendurch wurde das Panel zum ersten Mal in einem echten Home Assistant
gerendert — und lieferte sofort den ersten echten Fehler des Projekts:
Bereiche ohne Etage lagen auf *jeder* Etage über deren Räumen. Behoben im
Hub, nicht im Renderer, damit ein zweiter Renderer die Korrektur erbt.
[`tools/`](tools/README.md) ist das, was ihn gefunden hat.

Und dann gibt es diesen zweiten Renderer:
[`examples/second_renderer/`](examples/second_renderer/) — **eine Datei, vom
Desktop aus geöffnet**, nicht in Home Assistant. Alle Etagen nebeneinander
statt eine nach der anderen, ohne Bearbeiten. Keine geteilte Zeile Code mit
dem Hub, kein Sonderzugang, und genau **zwei** Kommandos: `model` und
`subscribe`. Mehr braucht ein lesender Renderer nicht.

Bauen belegt anders als Behaupten. Der zweite Renderer hat sofort eine
halbe Zusage aus Phase 6 aufgedeckt: `auto` löst seine Farben zu leeren
Strings auf — *„nimm, was Home Assistant sagt"* — und vom Desktop aus gibt
es nichts zu erben. Das ganze Haus kam grau heraus, und der Renderer hätte
sich Farben ausdenken müssen, also genau das Preset nachbauen, das im Hub
aufzulösen der Sinn der Sache war. Jedes Theme trägt jetzt zusätzlich
`theme.fallback` mit echten Farben. Leer heißt weiter „erben"; wer nichts zu
erben hat, nimmt den Fallback, ohne zu wissen, welcher Fall vorliegt.

## ✅ Phase 12 — Zero-Config als Endzustand

Installieren, und der Grundriss ist da. Nichts anlegen, nichts zeichnen,
nichts konfigurieren — korrigieren nur, was die Automatik falsch geraten hat.

Nachgeprüft auf einer frisch aufgesetzten Instanz, nicht behauptet:

- **Registry noch leer**: kein leeres Rechteck, sondern „Noch nichts zu
  zeichnen" und der eine Satz, der weiterhilft — *Bereiche unter
  Einstellungen → Bereiche & Zonen anlegen, der Grundriss folgt von selbst.*
  Keine Fehlermeldung, kein Ladezustand, der nie endet.
- **Bereiche vorhanden**: der Plan steht nach dem Hinzufügen der Integration
  da. Kein Dashboard, keine Karte, kein YAML.
- **Und er folgt**: Etage angelegt, Bereich angelegt, Bereich umbenannt —
  alles drei im offenen Panel sichtbar, **ohne Reload**.
  [`tools/live_follow.py`](tools/README.md) prüft genau das und räumt hinter
  sich auf.



## ✅ Phase 13 — Das erste Feedback

Die erste Version lief, und die Rückmeldung dazu war präziser als jede
Planung: sieben Punkte, alle über *Darstellung und Interaktion* — also
genau die Hälfte, die dem Hub gehört. Nichts davon hat einen Provider
angefasst, und kein Provider musste etwas nachziehen.

- **Geräte-Icons statt Punkte.** Ein Node wird mit dem Icon gezeichnet, das
  in Home Assistant konfiguriert ist; hat die Entität keins, leitet der Hub
  eins aus Domain und Geräteklasse ab. Registriert ein Provider ein
  `icon_set`, gewinnt das — die Integration behält ihr Gesicht, auch in der
  Hausansicht, die vorher nur Punkte kannte.
- **Ebenen und Provider unter der Karte.** Die Seitenspalte ist weg; der
  Grundriss bekommt die Breite. Ebenen sind dabei nach Provider gruppiert,
  mit einem Schalter für den ganzen Provider.
- **Der Garten ist keine Etage.** Außenbereiche legen sich als Ring um das
  Erdgeschoss — ein Koordinatenfenster von −0.28 bis 1.28 statt 0..1.
  Vorgarten, Hintergarten, Terrasse, Garage, Einfahrt, Carport, Gartenhaus
  und Pool passen alle darauf. Ob ein Bereich draußen liegt, rät der Hub aus
  seinem Namen; die Vermutung ist ein Klick weit von der Korrektur entfernt.
- **Zentrales Popup.** Modal über dem Grundriss statt am Rand, mit allen
  Türen zurück nach Home Assistant: More-Info, Gerät, Entitäten,
  Einstellungen — und, wenn der Provider eins nennt, sein eigenes Panel.
- **Räume vollständig editierbar.** Acht Griffe: jede Wand und jede Ecke
  lässt sich ziehen, die gegenüberliegende Wand bleibt stehen. Dazu
  Undo/Redo für alles, was der Editor schreibt.
- **Zoom überall gleich.** Mausrad, Pinch, Ziehen und „alles zeigen" —
  dieselbe Kamera in der Hausansicht wie auf einer einzelnen Etage.
- **Sandwich konfigurierbar.** Pro Bereich: Art (Raum, Außenbereich,
  virtuell), *in der Hausansicht zeigen*, *nur Einzelansicht*. Virtuelle
  Bereiche — Internet, VPN, Cloud — liegen im Erdreich um die unterste
  Etage: Sie müssen irgendwo hin, in keinem Stockwerk liegen sie, und der
  Anschluss kommt aus dem Boden neben dem Haus.

Dazu aus der Ideenliste: Suche (blendet nicht aus, sondern stellt zurück),
Provider-Untergruppen, Drag & Drop und Snap-to-Grid waren schon da.

### Was aus der Liste noch offen ist

- Mehrfachauswahl und das gemeinsame Verschieben mehrerer Geräte
- Favoriten
- Eigene Icons hochladen (Provider-Icon-Sets gibt es, Nutzer-Uploads nicht)
- Labels frei verschieben (`label_offset` wird gespeichert, aber noch von
  keinem Griff gesetzt)

## ✅ Phase 14 — Aus einer API wird ein Standard

[`docs/SPECIFICATION.md`](docs/SPECIFICATION.md) — **Spatial Provider
Specification 1.0**. Kein README, sondern ein Format, das mehrere
Implementierungen erfüllen können; der eingebaute Renderer ist nur die erste.
Kapitel: Node, Edge, Layer, Position, Popup, Action, Theme, Icon, Camera,
Area Type. Dazu Rollen, Fehlerverhalten und eine eigene Versionierung.

Normativ heißt getestet: [`tests/test_specification.py`](tests/test_specification.py)
hält Dokument und Code an den Stellen zusammen, an denen sie still
auseinanderlaufen können — die Vokabulare, die Versionsnummern und die
Feldnamen, die einem Provider zugesagt werden. Ein Dokument, das eine ältere
Version beschreibt, ist schlimmer als keins: es ist ein Versprechen, das der
Code nicht hält.

**AreaKind ist ein Enum**, kein String. Auf allen drei Seiten: `AreaKind` im
Hub, `AREA_KIND` (frozen) im Renderer, `AreaKind`/`NodeState`/`EdgeQuality`
im kopierten Shim. Ein unbekannter Wert am Websocket wird abgelehnt und die
Fehlermeldung nennt die gültigen; ein unbekannter Wert in bereits
gespeicherten Daten wird repariert, wenn er eindeutig ist (`outside`,
`garden`, `außen`, `cloud`), und sonst mit Warnung auf `indoor` gesetzt. Ein
Grundriss verschwindet nicht wegen eines Tippfehlers — aber niemand rätselt
still.

---

# Was aus der Vision noch fehlt

Ab hier ist nichts gebaut. Die vier Phasen stehen so in
[`docs/Vision.md`](docs/Vision.md) und sind die Antwort darauf, warum der
Hub heute einen Grundriss zeigt und noch keine Wohnung.

## ✅ Phase 15 — Gebäudeflucht

Jede Etage soll ihre **Außenwände** kennen, und der Editor soll sie über
alle Etagen hinweg einblenden — als blasse Kontur der jeweils anderen
Stockwerke hinter der, die man gerade bearbeitet.

Erst dann passt das Haus im Sandwich wirklich übereinander. Eine Etage darf
anders aussehen als die darunter — eine Terrasse, ein Erker, ein
zurückgesetztes Dachgeschoss sind der Normalfall, kein Fehler. Aber der
Nutzer muss *sehen* können, wo die Wand darunter verläuft, sonst rät er.

Dazu gehört Einrasten an der fremden Kontur, nicht nur am Raster. Und es
gehört bewusst **nicht** dazu, die Etagen zur Deckungsgleichheit zu
zwingen: Das Haus richtet sich nach dem Nutzer, nicht umgekehrt.

**Steht:** Jede Etage meldet ihre `outline`, abgeleitet aus ihren
Innenräumen — ohne Editor, ohne Speicher, folgt beim Ziehen mit. Der
Garten zählt nicht mit, sonst bestimmte die Terrasse die Flucht. Eine
gespeicherte Angabe schlägt die Ableitung. Im Bearbeiten-Modus liegen die
Konturen der anderen Etagen als blasse Linien hinter der aktuellen,
abschaltbar, und der Knopf erscheint nur, wenn es überhaupt etwas zu
vergleichen gibt. Und eine gezogene Wand rastet an dieser Kontur ein,
nicht nur am Raster — aber nur, solange die Kontur auch eingeblendet ist:
Ein Magnet an einer Linie, die niemand sieht, ist kein Einrasten, sondern
ein Ruckeln ohne Grund. Die getroffene Etage hebt sich hervor, weil
eingerastet und knapp daneben sonst gleich aussehen.

## ⬜ Phase 16 — Licht

Heute färbt eine eingeschaltete Lampe ihr eigenes Icon. Das ist der Zustand
des Geräts, nicht der Zustand des Raums.

Ziel ist ein Raum, der **beleuchtet aussieht**: ein einstellbarer
Leuchtradius pro Node, RGB und Farbtemperatur aus der Entity, Helligkeit als
Intensität — und Wände, die das Licht begrenzen, damit es im Raum bleibt, in
dem die Lampe steht.

Der Punkt aus der Vision, der das Ganze trägt: Es geht nicht darum, Icons zu
zeichnen, sondern den Zustand der Wohnung zu zeigen. Und es muss beides
können — ein Kind stellt eine Lampe in ein Zimmer, ein Nerd gibt seinem
LED-Streifen einen Radius, eine Richtung und eine Farbe.

## ⬜ Phase 17 — Editor

Der Edit-Modus kann heute ziehen, skalieren, Ecken fassen, einrasten,
rückgängig machen. Was fehlt, ist der Anspruch der Vision:
**einfach genug für ein Kind, mächtig genug für einen Enthusiasten.**

**Erledigt:** Räume sind keine Rechtecke mehr. Der Ecken-Modus zieht,
setzt und entfernt Ecken — Nischen, Erker und Wandversätze sind damit
zeichenbar, und dieselbe Kontur gilt in Einzel- wie Hausansicht. Auf
derselben Mechanik sitzt das **Grundstück**: die gezeichnete Grenze um Haus
und Garten, unter allem anderen, auf der Nebengebäude wie Garage und
Gartenhütte als Außenbereiche stehen. Das Grundstück hat dabei **vier
Ränder statt einer Zahl** — wer hinter dem Haus dreihundert Meter Garten
hat und vorne drei, bekommt genau das und nicht zweimal denselben Rand.

**Türen und Fenster** sitzen in der Wand: pro Wand anlegbar, mit Mitte und
Breite als Anteil der Wand, damit sie beim Vergrößern des Raums bleiben, wo
sie hingehören. Der Unterschied zwischen beiden ist die Wand selbst — eine
Tür ist eine Lücke, die durch die ganze Mauer geht und nicht nur durch ihre
Außenseite; ein Fenster sitzt darin, die Wand läuft durch, und Brüstung und
Sturz stehen als Striche im Bild. Gesetzt werden beide direkt am Grundriss:
auf eine Wand klicken setzt, ziehen verschiebt, Alt-Klick entfernt. Der
Dialog bleibt für genaue Zahlen — für die ist ein Regler besser als eine
Hand.

Dazu die Hausansicht selbst, die aussehen soll wie eine Bauzeichnung und
nicht wie vier graue Platten: flacher Blickwinkel statt Raute, sichtbare
Innenwände, **Treppen als Stufen**, und ein Balkon, der ein Geländer
bekommt statt Zimmerwänden — während der Rasen keins bekommt, weil ein
Garten kein Anbau ist.

**Maßketten** unter jeder Etage, geteilt an den Wänden, mit dem Gesamtmaß
in einer zweiten Reihe — das, was einen Grundriss von einem beschrifteten
Rechteck unterscheidet. Und **Beschriftungen, die sich nicht decken**:
Raumnamen und Maße stehen fest, Gerätenamen weichen aus, und was auch dann
keinen Platz findet, wird weggeblendet, bis jemand darauf zeigt. Vorher galt
dafür eine Pauschale — mehr als fünf Geräte auf einer Ebene, und alle Namen
verschwanden.

Auf dem Smartphone ist der Plan **Vollbild ohne Leisten**, und die Legende
lässt sich nach unten wegziehen: Wer einen Raum einrichtet, braucht den
Platz.

Offen sind unter anderem Mehrfachauswahl, Labels an einen eigenen Platz
ziehen und ein Weg, einen Raum zu zeichnen, ohne ihn erst in Home
Assistant anzulegen.

**Diese Liste stand lange falsch hier.** Sie nannte das Rechtsklickmenü
und den langen Druck auf dem Touchscreen als offen — beides ist seit
Abschnitt A erledigt. Schlimmer als veraltet war aber, *was* sie vom Menü
verlangte: „duplizieren, löschen". Genau das hat Abschnitt A mit
Begründung ausgeschlossen, weil Bereiche dem Bereichsregister von Home
Assistant gehören und ein „Löschen" hier ein Löschen *überall* wäre. Wer
Phase 17 gelesen und gebaut hätte, hätte die destruktive Aktion
eingebaut, gegen die sich das Projekt ausdrücklich entschieden hat. Das
Menü im Code hat sie nicht — nachgesehen.

Interaktion ist hier mitgemeint und größtenteils schon da: **kurzer Klick
schaltet**, **langer Druck öffnet** das mittige Modal mit Werten, Entities,
More-Info und dem Panel des Providers — der Grundriss bleibt dahinter
sichtbar. Der lange Druck auf dem Touchscreen verhält sich seit
Abschnitt A wie die Maus.

### Was „ein Kind" heute noch verhindert

Zwei Befunde aus dem Nachsehen, und beide sind grundsätzlich:

- [x] **Das Raster ließ sich nur mit der Umschalttaste abschalten.**
      `event.shiftKey` stand an fünf Stellen im Code und war der einzige
      Weg. Ein Tablet hat keine Umschalttaste, und ein Zeigerereignis aus
      einem Finger meldet `shiftKey` immer als falsch — am Gerät, an dem
      ein Kind sitzt, war das Raster also gar nicht abschaltbar. Der
      Hinweistext nannte den Weg trotzdem, und zwar in schiefem Deutsch:
      „Shift hält gedrückt das Raster aus."

      Jetzt eine Frage an einer Stelle (`_noSnap`), ein Knopf **Raster**
      in der Leiste, und ein Hinweis, der nur Wege nennt, die es auf
      diesem Gerät gibt. Die Taste bleibt — wer eine hat, will sie nicht
      gegen einen Knopf tauschen.

- [x] **Bearbeiten setzte ein Adminkonto voraus.** `canEdit()` war
      `hass.user.is_admin`, sonst nichts. Ein Kind hat in Home Assistant
      normalerweise kein Adminkonto — es konnte den Editor also nicht
      einmal öffnen, und keine Verbesserung an seiner Bedienbarkeit
      erreichte es.

      **Es war keine offene Frage, sondern ein Widerspruch.** Die
      Spezifikation sagt beim einzigen Befehl, der außerhalb des Hubs
      schreibt, wörtlich: „Admin-pflichtig. **Anordnen ist es nicht**, das
      hier schon." Das Backend hält sich daran — `spatial_hub/layout/set`
      und `layout/reset` haben gar keine Verwalterprüfung, während
      `action` und `area/assign` `@websocket_api.require_admin` tragen.
      Nur das Frontend sperrte alles hinter `is_admin`, und die strengere
      Seite hat gewonnen, ohne dass es jemand entschieden hat.

      Der Vertrag in `panel-transport.js` sagte es sogar selbst: Die
      Funktion hieß „ob der Betrachter **die Anordnung** ändern darf" und
      gab `is_admin` zurück. Zwei Fragen in einer.

      Jetzt sind es zwei: `canArrange()` — angemeldet genügt — und
      `isAdmin()` für das, was nach außen wirkt. Und wer als
      Nicht-Verwalter ein Gerät in einen anderen Raum zieht, bekommt jetzt
      einen Satz dazu statt eines Zuges, der stumm verpufft. Die Regel
      dafür stand längst im Quelltext daneben: Eine Änderung, die nach
      draußen wirkt, ist nie stumm — ihr Ausbleiben auch nicht.

## ⬜ Phase 18 — Klima

Temperatur, Luftfeuchte, Luftqualität und Lüftung als **Verlauf über die
Fläche**, nicht als Zahl am Icon. Ein kalter Raum soll kalt aussehen.

Bewusst zuletzt: Es ist die Phase, in der am ehesten etwas entsteht, das gut
aussieht und nichts erklärt — und damit die Frage aus der Vision als Erstes
mit „nein" beantworten würde.

## ⬜ Phase 19 — Wetter über dem Haus

Die Wetter-Entität wird nicht als Kachel gezeigt, sondern als **Zustand des
Himmels über dem Haus**:

- **Regen** und bei bewölktem Himmel **dunkle Wolken** über dem First
- Eine **Sonne, die zum Mond wird**, und ihren Lauf über das Haus zieht
- **Schnee**, **Blitze** bei Gewitter

Hier stand einmal „die virtuellen Wolken regnen — es gibt sie schon". Es
gibt sie nicht mehr: Sie waren die Darstellung der virtuellen Bereiche, und
die liegen inzwischen im Erdreich neben dem Haus, wo auch der Anschluss
herkommt. Das Wetter braucht also eigene Wolken, und zwar solche, die nichts
bedeuten außer Wetter — was ohnehin die bessere Trennung ist: Ein Kasten, der
gleichzeitig „VPN" heißt und „es regnet" sagt, sagt keines von beidem.

Bewusst nach dem Editor und nach dem Gebäudekörper. Es ist die Phase mit dem
größten Verhältnis von Wirkung zu Nutzen, und ein Haus, das schneit, aber sich
nicht einrichten lässt, hat die Reihenfolge falsch herum. Erst muss das Haus
ein Haus sein.
