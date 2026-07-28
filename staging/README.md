# Wartehalle

Integrationen, die **umziehen** — in eigene Repositories, sobald sie einmal
an echter Hardware gelaufen sind. Hier liegen sie nur, damit sie nicht in
einem Container verloren gehen, der abgeräumt wird.

| | |
|---|---|
| `ha-spatial-esphome` | ESPHome-Boards: ein Punkt pro Platine, nicht pro Entität |

## Ausgezogen

| | |
|---|---|
| Z-Wave | [`Chance-Konstruktion/ha-spatial-zwave`](https://github.com/Chance-Konstruktion/ha-spatial-zwave) |

Der Z-Wave-Adapter hat die Wartehalle verlassen: eigenes Repository, eigene
Tests, eigenes Conformance-Kit. Was hier lag, ist **gelöscht statt kopiert**
— zwei Kopien desselben Adapters laufen auseinander, und dann gewinnt die
schlechtere, weil niemand merkt, welche er gerade liest.

## Warum sie nicht im Hub sind

Sie nennen ESPHome und Z-Wave in jeder zweiten Zeile. Genau deshalb dürfen
sie kein Teil des Hubs sein und werden es nie:

- **Wer den Adapter geschenkt bekommt, schreibt ihn nie selbst.** Läge der
  Z-Wave-Adapter im Hub, hätte `zwave_js` keinen Grund mehr, einen zu
  pflegen — und wir besäßen den Code für immer, während sich ihre API
  ändert.
- **Jede Integration außerhalb der Liste wäre zweite Klasse.** Der Moment,
  in dem der Hub zwei Integrationen kennt, ist der Moment, in dem er ein
  Katalog ist statt einer Plattform.
- **Der Adapter gehört am Ende in die Integration selbst.** Zwanzig Zeilen
  im Core, und niemand installiert mehr irgendwas. Ein eigenes Repository
  ist die Vorstufe, an der sich zeigen lässt, dass es zwanzig Zeilen sind.

Das ist auch die Antwort auf „muss ich dafür jetzt fünf Repositories
installieren?" — **nein.** Der Hub allein zeigt das Haus: Etagen und
Bereiche kommen aus Home Assistant, und Licht, Klima, Türen & Bewegung und
Medien sind als Ebenen ab Werk da. Ein Provider kommt nur dazu, wenn jemand
etwas will, das in keiner Registry steht: die Topologie seines Funknetzes.
Wer die nicht braucht, installiert nichts.

`tests/test_staging.py` hält die Wand: Der Hub importiert nichts hieraus,
und nichts hiervon liegt unter `custom_components/`.

## Stand

**Ungetestet an echter Hardware.** Gegen die dokumentierten Strukturen
gebaut und mit Fakes geprüft — ob ein echtes Board sich so verhält, wie der
Adapter es annimmt, weiß nur ein echtes Board.

## Installieren zum Testen

Ordner aus `custom_components/` in die eigene HA-Konfiguration kopieren,
neu starten, unter **Einstellungen → Geräte & Dienste** hinzufügen. Nichts
einzustellen.
