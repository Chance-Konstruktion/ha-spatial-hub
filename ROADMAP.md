# Roadmap

Wo FloorPlan-Hub steht, und was noch kommt.

Das Ziel dahinter ändert sich in keiner Phase: **Der Hub darf keine
einzige Integration beim Namen kennen.** Er kennt Provider, Layer, Nodes,
Edges, Actions und Capabilities — mehr nicht. In dem Moment, in dem
irgendwo ein Sonderfall für Powerline oder UniFi steht, ist aus der
Plattform ein weiteres Dashboard geworden.

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
floorplan_provider(hass, entry, name="My Integration",
                   data=lambda: ["light.kitchen"], coordinator=coordinator)
```

Registrieren, beim Entladen abmelden, nach jedem Coordinator-Refresh
benachrichtigen, Capabilities ableiten — alles darin. Eine Entity-ID ist
ein vollständiger Node; Name, Bereich, Icon und Zustand holt der Hub aus
Home Assistant.

Dazu `floorplan_hub/diagnostics` (was wurde verworfen und warum, inklusive
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

Dazu `floorplan_hub/entities/facets`: welche Arten, Label und Geräteklassen
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
  meldet in `floorplan_hub/diagnostics`, wenn eine Kopie veraltet ist — das
  Einzige, was ein Paket überhaupt gebracht hätte. Eine alte Kopie
  funktioniert weiter; ihr Autor wird informiert, nicht bestraft.
- `examples/example_provider/` ist eine **ganze** Integration, keine
  Schnipsel. Sie läuft in unserer Testsuite gegen den echten Hub und muss
  dasselbe Conformance-Kit bestehen wie fremder Code — Beispiele, die
  verrotten, sind schlimmer als keine.
- `docs/ASK_FOR_SUPPORT.md` ist der Text, den ein *Nutzer* bei einer
  fremden Integration einreicht. Mit der Bitte, es einmal zu tun,
  freundlich, und mit dem Angebot, den PR selbst zu schreiben. Der Weg
  einer Plattform führt über die Nutzer der anderen, nicht über uns.

## ✅ Phase 9 — Eigene Provider migrieren

Zwei sind angebunden, und die zweite war der Punkt.

[ha-powerline](https://github.com/Chance-Konstruktion/ha-powerline) besteht
den Conformance-Vertrag seit Phase 2 ohne Sonderbehandlung — und hat vier
Phasen lang jede SDK-Entscheidung bestätigt, weil es genau die Form hatte,
für die das SDK gebaut war. Ein Provider ist keine Stichprobe.

[ha-espeasy-p2p](https://github.com/Chance-Konstruktion/ha-espeasy-p2p) hat
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
  Bereiche — Cloud, Internet, VPN — bekommen eine Ebene über dem Dach, weil
  sie irgendwo hin müssen, aber in keinem Stockwerk liegen.

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
