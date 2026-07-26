# „Wann FloorPlan-Hub?"

Du benutzt eine Integration, die auf deinem Grundriss fehlt. Diese Seite
ist der Text, den du in deren Repository einreichst — und ein paar Bitten
dazu, wie.

> **Die meisten Integrationen werden auf Englisch entwickelt.** Schreib
> nicht auf Deutsch in ein englischsprachiges Repo — nimm
> [ASK_FOR_SUPPORT.en.md](ASK_FOR_SUPPORT.en.md), da steht derselbe Text
> zum Kopieren.

## Zuerst: Musst du überhaupt fragen?

Wahrscheinlich nicht. Im Hub, Bearbeiten-Modus → **+ Ebene**, beschreibst du
selbst, was auf den Grundriss soll: alle Lichter, alles in einem Bereich,
alles mit einem Label. Das braucht niemanden außer dir.

Ein eigener Adapter ist trotzdem besser — er weiß, was die Daten
*bedeuten*, kann Verbindungen zwischen Geräten zeichnen, Zustände richtig
benennen und Aktionen anbieten. Aber du bist nicht blockiert, während du
wartest, und das gehört in die Anfrage.

## Bitte einmal, freundlich, und dann nicht mehr

Ein Maintainer, der zehn identische Issues von zehn Leuten bekommt, macht
das Feature nicht schneller. Er macht das Repo zu.

- **Suche zuerst.** Gibt es das Issue schon, gib ihm einen 👍 und schreib
  nichts dazu. Ein „+1" ist eine Benachrichtigung ohne Inhalt.
- **Ein Repo, ein Issue.** Nicht zwanzig auf einmal, nicht als Serie.
- **Kein Datum verlangen.** Niemand schuldet dir einen Termin.
- **Ein Nein ist eine Antwort.** Es kostet dich nichts — siehe oben.
- **Biete an, es selbst zu machen.** Das ist der Unterschied zwischen einer
  Forderung und einem Angebot. Es sind ungefähr zwanzig Zeilen, und du
  darfst sie schreiben.

## Der Text

Alles ab hier kopieren. Die eckigen Klammern ersetzen.

---

**Titel:** Support für FloorPlan-Hub (optional, ~20 Zeilen, keine Abhängigkeit)

Hi — danke für diese Integration, ich benutze sie täglich.

Es gibt seit Kurzem [FloorPlan-Hub](https://github.com/Chance-Konstruktion/ha-floorplan-hub):
ein Dienst, der räumliche Daten aus beliebigen Integrationen einsammelt und
in *einem* Grundriss zusammenführt, statt dass jede Integration ihr eigenes
Dashboard mitbringt. Etagen und Bereiche kommen aus Home Assistant, die
Anordnung macht der Nutzer einmal, und sie gehört danach dem Hub.

Ich frage nicht nach einem Termin und wäre über ein Nein nicht enttäuscht.
Aber der Aufwand ist klein genug, dass ich es für erwähnenswert halte:

```python
from .floorplan_hub_provider import floorplan_provider

floorplan_provider(
    hass,
    entry,
    name="[Name der Integration]",
    icon="mdi:[icon]",
    data=lambda: [ ... entity_ids oder node()-Dicts ... ],
    coordinator=coordinator,
)
```

Das ist alles. Registrieren, beim Entladen abmelden und den Hub nach jedem
Coordinator-Refresh benachrichtigen steckt in dem einen Aufruf.

Was es **nicht** kostet:

- **Keine Abhängigkeit.** Eine Datei wird ins Repo kopiert, `manifest.json`
  bleibt unverändert. Es gibt nichts zu pinnen und nichts aufzulösen.
- **Kein anderes Verhalten ohne den Hub.** Die Datei schreibt ein Dict in
  `hass.data` und feuert ein Dispatcher-Signal. Ist der Hub nicht
  installiert, hört niemand zu — die Integration verhält sich exakt wie
  vorher. Ladereihenfolge ist egal.
- **Kein Frontend.** Keine Karte, kein YAML, kein CSS.
- **Kein Layout zum Speichern.** Positionen schickt man bewusst nicht; der
  Hub platziert, der Nutzer korrigiert, und das bleibt beim Hub.

Zum Prüfen gibt es ein Conformance-Kit — eine Datei in die Testsuite,
braucht nur pytest, kein Home Assistant und keinen installierten Hub.

Setup, das die Handarbeit abnimmt:

```bash
python3 sdk/install.py --into custom_components/[domain] --tests tests
```

Alles dazu: [sdk/README.md](https://github.com/Chance-Konstruktion/ha-floorplan-hub/blob/main/sdk/README.md).
Ein vollständiges Beispiel-Integration liegt in
[examples/](https://github.com/Chance-Konstruktion/ha-floorplan-hub/tree/main/examples/example_provider) —
keine Schnipsel, sondern eine ganze Datei, die in deren Testsuite mitläuft.

Wenn du magst, mache ich den PR. Sag einfach Bescheid.

---

## Wenn du den PR selbst machst

Umso besser. Kurz halten, und dem Maintainer die Prüfung leicht machen:

- Alles in **einen** Commit, klar benannt.
- Den Conformance-Test **mit** einreichen — dann muss der Maintainer nicht
  selbst herausfinden, ob es stimmt.
- In der PR-Beschreibung die drei Sätze zu „keine Abhängigkeit, kein
  Verhalten ohne den Hub, kein Frontend" wiederholen. Das ist die Frage,
  die ein Reviewer als Erstes hat.
- Nicht beleidigt sein, wenn er es anders haben will. Es ist sein Repo.
