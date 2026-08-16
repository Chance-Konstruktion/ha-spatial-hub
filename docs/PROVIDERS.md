# Wer mitmacht

Integrationen, die einen Spatial Hub-Adapter mitbringen. Die Liste steht
hier, damit Nutzer sehen, was es schon gibt — und Maintainer sehen, dass sie
nicht die Ersten sind.

Zwei Bauarten stehen nebeneinander: Eine Integration bringt ihren Adapter
selbst mit (Powerline, ESPEasy), oder der Adapter ist ein eigenes Add-on zu
einer fremden Integration, die davon nichts weiß (die sechs Funkprotokolle).
Für den Hub ist das derselbe Vertrag — er sieht nur Provider.

| Integration | Domain | Repository | Angebunden seit |
|---|---|---|---|
| Powerline | `powerline` | [chance-konstruktion/ha-powerline](https://gitlab.schanz.ipv64.net/chance-konstruktion/ha-powerline) | 2026-07 |
| ESPEasy P2P | `espeasy_p2p` | [chance-konstruktion/espeasy-p2p](https://gitlab.schanz.ipv64.net/chance-konstruktion/espeasy-p2p) | 2026-07 |
| Z-Wave | `spatial_zwave` | [chance-konstruktion/ha-spatial-zwave](https://gitlab.schanz.ipv64.net/chance-konstruktion/ha-spatial-zwave) | 2026-08 |
| Zigbee | `spatial_zigbee` | [chance-konstruktion/ha-spatial-zigbee](https://gitlab.schanz.ipv64.net/chance-konstruktion/ha-spatial-zigbee) | 2026-08 |
| Thread | `spatial_thread` | [chance-konstruktion/ha-spatial-thread](https://gitlab.schanz.ipv64.net/chance-konstruktion/ha-spatial-thread) | 2026-08 |
| Matter | `spatial_matter` | [chance-konstruktion/ha-spatial-matter](https://gitlab.schanz.ipv64.net/chance-konstruktion/ha-spatial-matter) | 2026-08 |
| Bluetooth | `spatial_bluetooth` | [chance-konstruktion/ha-spatial-bluetooth](https://gitlab.schanz.ipv64.net/chance-konstruktion/ha-spatial-bluetooth) | 2026-08 |
| ESPHome | `spatial_esphome` | [chance-konstruktion/ha-spatial-esphome](https://gitlab.schanz.ipv64.net/chance-konstruktion/ha-spatial-esphome) | 2026-08 |

## Diese Liste ist Dokumentation, sonst nichts

Sie hat **keine Wirkung auf den Code**. Kein Modul liest sie, kein Layer
wird davon freigeschaltet, keine Reihenfolge davon bestimmt. Eine
Integration, die hier nicht steht, funktioniert exakt genauso — sie ist nur
schwerer zu finden.

Das ist kein Zufall, sondern die Stelle, an der so ein Projekt üblicherweise
kippt: Erst ist es eine Liste zum Nachschlagen, dann eine Liste mit einem
Sonderfall, dann eine Liste, ohne die nichts mehr geht. `tests/test_community.py`
liest die Domains aus dieser Tabelle und prüft, dass keine davon im Quelltext
des Hubs vorkommt. Wer eine Zeile hinzufügt, muss also nichts weiter tun —
und *kann* auch nichts weiter tun.

## Eintragen

PR auf diese Datei, eine Zeile. Bedingungen:

- Der Adapter ist im Repository der Integration **released**, nicht nur in
  einem Branch.
- Er besteht das Conformance-Kit ([`sdk/spatial_hub_conformance.py`](../sdk/spatial_hub_conformance.py))
  in der eigenen Testsuite. Bitte den Test mit verlinken.

Es gibt keine Freigabe von uns und keine Prüfung durch uns. Wir sind nicht
die Instanz, die deine Integration segnet — die Bedingungen oben sind
nachprüfbar, und das reicht.

## Und wenn deine Integration fehlt?

Als Nutzer: [ASK_FOR_SUPPORT.de.md](ASK_FOR_SUPPORT.de.md) — freundlich fragen,
einmal. Und bis dahin baust du dir die Ebene im Editor selbst, was in den
meisten Fällen schon reicht.

Als Maintainer: [sdk/README.md](../sdk/README.md).
