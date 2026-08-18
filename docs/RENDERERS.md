# Wer den Hub zeichnet

Renderer, die das Modell des Spatial Hub darstellen. Die Liste steht hier,
damit Nutzer sehen, was es schon gibt — und damit die Behauptung „der
eingebaute Renderer ist **einer von möglichen**" etwas hinter sich hat.

Ein Renderer holt sich `spatial_hub/model`, abonniert `spatial_hub/subscribe`
und zeichnet. Mehr ist es nicht. Er läuft im Panel, im Browser, auf dem
Desktop, meinetwegen im Terminal — der Hub fragt nicht nach, wer da liest.

| Renderer | Kennung | Repository | Läuft wo | Bauart |
|---|---|---|---|---|
| Spatial Hub Panel | `panel` | [in diesem Repo](../custom_components/spatial_hub/www/) | Home Assistant | lesen und bearbeiten |
| Zweiter Renderer | `second_renderer` | [in diesem Repo](../examples/second_renderer/) | Desktop-Browser | nur lesen |

## Diese Liste ist Dokumentation, sonst nichts

Sie hat **keine Wirkung auf den Code**. Kein Modul liest sie, kein Renderer
wird davon freigeschaltet, keine Reihenfolge davon bestimmt. Ein Renderer, der
hier nicht steht, funktioniert exakt genauso — er ist nur schwerer zu finden.

Dasselbe gilt und aus demselben Grund wie bei
[den Providern](PROVIDERS.md): Erst ist es eine Liste zum Nachschlagen, dann
eine Liste mit einem Sonderfall, dann eine Liste, ohne die nichts mehr geht.
`tests/test_renderer_kit.py` liest die Kennungen aus dieser Tabelle und prüft,
dass keine davon im Quelltext des Hubs vorkommt. Wer eine Zeile hinzufügt, muss
also nichts weiter tun — und *kann* auch nichts weiter tun.

## Eintragen

PR auf diese Datei, eine Zeile. Bedingungen:

- Der Renderer ist veröffentlicht und benutzbar, nicht nur ein Branch.
- Er besteht das Conformance-Kit
  ([`sdk/spatial_hub_renderer_conformance.py`](../sdk/spatial_hub_renderer_conformance.py))
  in der eigenen Testsuite. Bitte den Test mit verlinken.

Es gibt keine Freigabe von uns und keine Prüfung durch uns. Die Bedingungen
oben sind nachprüfbar, und das reicht.

## Das Kit

Neun Regeln, jede davon ein Weg, auf dem ein Renderer aufhört, unabhängig zu
sein, ohne dass es jemandem auffällt:

| Regel | Warum sie da ist |
|---|---|
| spricht überhaupt mit dem Hub | jede andere Regel ist von einer leeren Datei erfüllt |
| nur dokumentierte Kommandos | ein Tippfehler schlägt still fehl — der Hub antwortet einfach nie |
| lesend reicht `model` + `subscribe` | wer mehr holt, baut meist nach, was er schon hat |
| schreibt die Anordnung nicht | das Einzige im Hub, was der Nutzer von Hand gemacht hat |
| greift in keine Hub-Datei | sonst ist es der eingebaute Renderer mit Hut auf |
| kennt kein Theme-Preset | sonst braucht ein sechstes Preset eine Änderung in jedem Renderer |
| kennt keine Integration beim Namen | ein Sonderfall bricht beim nächsten Nutzer, der etwas anderes betreibt |
| benutzt `theme.fallback` | siehe unten |
| ordnet nach `floor_id` zu | wer die Etage selbst ausrechnet, malt Räume übereinander |

Die letzte ist die interessanteste, weil sie aus einem echten Fehler stammt.

Voreingestellt ist das Preset `auto`, und dessen Farben sind leere Strings:
*„nimm, was Home Assistant sagt."* Innerhalb von Home Assistant genau richtig.
Außerhalb gibt es nichts zu erben — und das ganze Haus kommt grau heraus,
**während jeder Test grün bleibt**, denn ein leerer String ist für den Browser
eine völlig gültige Farbe. Der zweite Renderer ist da hineingelaufen, daraufhin
bekam jedes Theme zusätzlich `theme.fallback` mit echten Farben. Wer den Fallback
nie erwähnt, hat diesen Fehler noch vor sich.

### Die Etage nehmen, nicht ausrechnen

Bereiche ohne Etage verschwinden nicht. Der Hub gibt ihnen eine eigene Etage
mit `unassigned: true`, und die steht in `model.floors` wie jede andere.

Wer die Zuordnung selbst herleitet — danach, ob `floor.unassigned` falsch ist,
nach der Reihenfolge der Liste, nach dem Namen des Raums — malt genau diese
Räume **über eine echte Etage**. Es gibt keine Fehlermeldung. Der Grundriss
sieht plausibel aus, und wer ihn ansieht, hat keinen Anlass zu zweifeln.

```js
// richtig: die id nehmen, die man bekommen hat
const areas = model.areas.filter((a) => a.floor_id === floor.id);
```

Zwei Fälle in der Aufnahme (`examples/modell.json`) treffen genau hierhin, und
sie haben **zwei verschiedene richtige Antworten**: Die Abstellkammer hat keine
Etage und landet auf der Sammeletage. Die Garage hat auch keine, ist aber
Außenbereich — der Hub legt sie ins Erdgeschoss. Wer selbst rechnet, bekommt
höchstens einen der beiden Fälle richtig.

Beide mitgelieferten Renderer machen das korrekt. Gesagt hat es ihnen niemand,
und geprüft hat es auch niemand — es war zweimal Glück. Deshalb jetzt die Regel.

## Kein SDK, nur ein Kit

Provider bekommen beides: einen Shim, der die Registrierung abnimmt, und ein
Kit, das sie prüft. Renderer bekommen nur das Kit.

Das ist Absicht. Ein Shim müsste eine Sprache und einen Rahmen wählen, und
damit wäre eine Vorentscheidung getroffen, die dem Hub nicht zusteht — ein
Renderer im Terminal hat mit einer JavaScript-Hilfsbibliothek nichts zu tun.
Zwei Websocket-Kommandos und ein JSON-Modell brauchen keine Hilfe.
Unabhängigkeit dagegen lässt sich nicht behaupten, nur nachweisen.
