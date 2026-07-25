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
| 7 | Generic Adapter | ⬜ |
| 8 | Provider-SDK | ⬜ |
| 9 | Eigene Provider migrieren | 🟡 Powerline steht |
| 10 | Community | ⬜ |
| 11 | Austauschbare Renderer | 🟡 Fundament steht |
| 12 | Zero-Config als Endzustand | ⬜ |

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

## ⬜ Phase 7 — Generic Adapter

Ein Provider, den der Nutzer selbst konfiguriert: „diese Entities, dieses
Label, dieser Layer". Damit kommt jede Integration ohne eigenen Adapter auf
den Grundriss — ohne dass der Hub sie kennt.

## ⬜ Phase 8 — Provider-SDK

Aus der kopierten Shim-Datei ein gepflegtes Paket machen — falls sich
herausstellt, dass das überhaupt jemand will. Kopieren hat den Vorteil,
dass niemand eine Abhängigkeit erbt; das ist nicht leichtfertig
aufzugeben.

## 🟡 Phase 9 — Eigene Provider migrieren

[ha-powerline](https://github.com/Chance-Konstruktion/ha-powerline) ist
angebunden und besteht den Conformance-Vertrag ohne Sonderbehandlung.
Weitere folgen.

## ⬜ Phase 10 — Community

Dokumentation, Beispiel-Provider, ein Weg für fremde Integrationen,
mitzumachen, ohne zu fragen. Das Conformance-Kit ist dafür gebaut: Ein
Entwickler soll prüfen können, ob er den Vertrag erfüllt, ohne den Hub zu
installieren.

## 🟡 Phase 11 — Austauschbare Renderer

Das Fundament steht: Der mitgelieferte Renderer hat keinen Sonderzugang und
lässt sich in den Optionen abschalten. Was fehlt, ist ein zweiter Renderer,
der beweist, dass es stimmt.

## ⬜ Phase 12 — Zero-Config als Endzustand

Installieren, und der Grundriss ist da. Nichts anlegen, nichts zeichnen,
nichts konfigurieren — korrigieren nur, was die Automatik falsch geraten
hat.
