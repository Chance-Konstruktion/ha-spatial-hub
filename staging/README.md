# Wartehalle

Zwei Integrationen, die **umziehen** — in eigene Repositories, sobald sie
einmal an echter Hardware gelaufen sind. Hier liegen sie nur, damit sie
nicht in einem Container verloren gehen, der abgeräumt wird.

| | |
|---|---|
| `ha-spatial-zwave` | Z-Wave-Mesh: Controller, Nodes, RSSI |
| `ha-spatial-esphome` | ESPHome-Boards: ein Punkt pro Platine, nicht pro Entität |

## Warum sie nicht im Hub sind

Sie nennen Z-Wave und ESPHome in jeder zweiten Zeile. Genau deshalb dürfen
sie kein Teil des Hubs sein und werden es nie:

- **Wer den Adapter geschenkt bekommt, schreibt ihn nie selbst.** Läge der
  Z-Wave-Adapter im Hub, hätte `zwave_js` keinen Grund mehr, einen zu
  pflegen — und wir besäßen den Code für immer, während sich ihre API
  ändert.
- **Jede Integration außerhalb der Liste wäre zweite Klasse.** Der Moment,
  in dem der Hub zwei Integrationen kennt, ist der Moment, in dem er ein
  Katalog ist statt einer Plattform.
- **Der Z-Wave-Adapter gehört am Ende in `zwave_js` selbst.** Zwanzig
  Zeilen im Core, und niemand installiert mehr irgendwas. Dieses Repo hier
  ist die Vorstufe, an der sich zeigen lässt, dass es zwanzig Zeilen sind.

`tests/test_staging.py` hält die Wand: Der Hub importiert nichts hieraus,
und nichts hiervon liegt unter `custom_components/`.

## Stand

**Ungetestet an echter Hardware.** Beide sind gegen die dokumentierten
Strukturen gebaut und mit Fakes geprüft — ob ein echter Z-Wave-Stick die
Statistiken so herausgibt, wie der Adapter es annimmt, weiß nur ein echter
Stick.

Der Z-Wave-Adapter greift dafür in die Laufzeitdaten von `zwave_js`, was
keine zugesicherte Schnittstelle ist. Jeder einzelne Zugriff ist deshalb
abgesichert, und wenn irgendetwas nicht so aussieht wie erwartet, fällt die
Ebene auf die Device-Registry zurück und schreibt `quelle: registry` in ihre
Metadaten. Ein Grundriss, der nach einem Update die RSSI-Zahlen verliert,
ist ärgerlich. Einer, der die ganze Ebene verliert, ist kaputt.

## Installieren zum Testen

Ordner aus `custom_components/` in die eigene HA-Konfiguration kopieren,
neu starten, unter **Einstellungen → Geräte & Dienste** hinzufügen. Beide
haben nichts einzustellen.
