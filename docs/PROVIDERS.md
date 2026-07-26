# Wer mitmacht

Integrationen, die einen Floorplan-Hub-Adapter mitbringen. Die Liste steht
hier, damit Nutzer sehen, was es schon gibt — und Maintainer sehen, dass sie
nicht die Ersten sind.

| Integration | Domain | Repository | Angebunden seit |
|---|---|---|---|
| Powerline | `powerline` | [Chance-Konstruktion/ha-powerline](https://github.com/Chance-Konstruktion/ha-powerline) | 2026-07 |
| ESPEasy P2P | `espeasy_p2p` | [Chance-Konstruktion/ha-espeasy-p2p](https://github.com/Chance-Konstruktion/ha-espeasy-p2p) | 2026-07 |

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
- Er besteht das Conformance-Kit ([`sdk/floorplan_hub_conformance.py`](../sdk/floorplan_hub_conformance.py))
  in der eigenen Testsuite. Bitte den Test mit verlinken.

Es gibt keine Freigabe von uns und keine Prüfung durch uns. Wir sind nicht
die Instanz, die deine Integration segnet — die Bedingungen oben sind
nachprüfbar, und das reicht.

## Und wenn deine Integration fehlt?

Als Nutzer: [ASK_FOR_SUPPORT.md](ASK_FOR_SUPPORT.md) — freundlich fragen,
einmal. Und bis dahin baust du dir die Ebene im Editor selbst, was in den
meisten Fällen schon reicht.

Als Maintainer: [sdk/README.md](../sdk/README.md).
