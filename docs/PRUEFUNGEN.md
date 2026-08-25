# Wer prüft welche Zusage

Die Spezifikation beruft sich auf RFC 2119: Was dort **MUSS**, **SOLL** oder
**DARF** heißt, ist eine Zusage und keine Erzählung. Zusagen, die niemand
prüft, sind aber nur Erzählung mit Großbuchstaben.

Diese Tabelle sagt für **jede** normative Stelle der Spezifikation, wer sie
prüft. Sie wird nicht von Hand gepflegt, sondern von
`tests/test_specification.py` erzwungen:

- Jede normative Stelle **muss** hier stehen. Eine neue Regel ohne Eintrag
  macht den Lauf rot.
- Ein genannter Test **muss** existieren. Man kann also nicht behaupten,
  etwas sei geprüft.
- Die Zahl der `offen`-Einträge **darf nicht wachsen**.

Die Kennung ist die ersten acht Zeichen des SHA-256 über den Text der Regel,
ohne Auszeichnung. Wird eine Regel umformuliert, ändert sich ihre Kennung und
der Eintrag fällt auf — das ist gewollt: Eine geänderte Zusage will neu
geprüft werden.

| Wer | Bedeutung |
|---|---|
| `panel` | Der Hub prüft es für seinen eigenen Renderer. |
| `kit` | Das Renderer-Conformance-Kit prüft es, also auch bei Fremden. |
| `hub` | Eine Python-Prüfung am Hub selbst. |
| `prosa` | Begründung oder Geschmack — mit Absicht nicht maschinell prüfbar. |
| `offen` | Sollte geprüft werden, ist es aber nicht. |

## Was diese Tabelle nicht kann

Sie verhindert, dass jemand eine Prüfung **erfindet** — der genannte Test
muss existieren. Sie verhindert **nicht**, dass jemand eine Regel dem
falschen Test zuordnet. Ein Test, den es gibt, der aber etwas anderes
prüft, sieht hier aus wie Deckung.

Das ist keine theoretische Sorge: Beim Anlegen dieser Tabelle habe ich
fünf Testnamen aus dem Gedächtnis geschrieben, die es nicht gab. Der
Riegel hat sie gefunden. Für eine falsche *Zuordnung* gibt es keinen
Riegel, nur Lesen.

Die Kennung hilft dabei: Wird eine Regel umformuliert, ändert sich ihr
Hash, die Zeile fällt heraus und jemand muss die Zuordnung neu ansehen.

## Die Tabelle

| Kennung | Wer | Prüfung |
|---|---|---|
| a7416601 | panel | `test_the_renderer_speaks_the_same_vocabulary` |
| 4ebdfbcb | prosa | Was ein Provider senden darf, ist bewusst offen |
| 8b909b0c | hub | `test_node_lands_in_the_centre_of_its_area` |
| cb44f889 | hub | `test_the_rooms_fill_the_storey_wall_to_wall` |
| 895af35b | panel | `the other storeys' walls appear while editing a floor` |
| 7075b741 | prosa | Verbot einer Zwangsangleichung — kein Verhalten zum Messen |
| ac0a1a9b | panel | `eine Wand in Reichweite gewinnt gegen das Raster` |
| b8b12a80 | panel | `editing tools appear only in edit mode` |
| 3d26c96a | offen | Geräte im Raum-Modus ausblenden |
| 351cc7a9 | hub | `test_every_stored_area_field_is_documented` |
| fc1f982e | panel | `an L-shaped room is drawn as an L, not as its box` |
| d4bad3ae | hub | `test_every_stored_area_field_is_documented` |
| 65025059 | panel | `a doorway goes through the masonry, not just its outside face` |
| b76ffcac | panel | `a door is a gap in a wall, not a wall with a door drawn on it` |
| 2b35f5cf | panel | `a door on a wall that does not exist is left out, not guessed` |
| 64631b3b | panel | `two doors that touch are one opening, not two` |
| e62ad8af | hub | `test_every_stored_area_field_is_documented` |
| f3e06640 | panel | `a staircase is drawn as steps, by whatever the user called it` |
| bbb5aee9 | hub | `test_every_stored_area_field_is_documented` |
| ff9819b5 | offen | Grundstück unter allem anderen zeichnen |
| f81d1774 | panel | `the widest storey sets the window, not the first one with a garden` |
| 87cc20dd | hub | `test_every_stored_area_field_is_documented` |
| afd57e56 | prosa | „Nichts darf Maße voraussetzen" — eine Abwesenheit |
| 1218d08b | panel | `die Kette faengt am Haus an und hoert am Haus auf` |
| 80deb5c7 | panel | `ein Mass, das nicht unter seinen Strich passt, entfaellt` |
| be9c6d55 | panel | `die Zeichnung waechst, damit die unterste Kette darauf passt` |
| bb96328d | panel | `die Hausansicht setzt keine zwei Namen aufeinander` |
| dac575a7 | panel | `a room has standing walls, a garden does not` |
| fbaaa24a | prosa | Wandstärke ist ausdrücklich Geschmack |
| de5bd02b | offen | Popup mittig über dem Grundriss |
| e58e7b74 | panel | `history is offered only where the provider says it has any` |
| 2765c170 | panel | `ein Provider ist so deutlich wie seine klarste sichtbare Ebene` |
| bbcb626d | offen | MDI-Namen als Schlüssel für eigene Icons |
| 2d223e6f | offen | Zusage „in allen Ansichten anklickbar" |
| db96a05d | panel | `zooming keeps the point under the cursor where it was` |
| 73a65443 | panel | `test_the_specification_insists_the_kinds_are_an_enum` |
| 2629f8e3 | hub | `test_a_floors_kind_goes_over_the_wire_as_a_word` |
| 727fd0c4 | hub | `test_a_storey_that_held_only_the_garden_goes_with_it` |
| 4dc64746 | panel | `a node without a position is never drawn` |
| 13f81175 | panel | `rooms are drawn back to front, or the storey turns inside out` |
| d05274be | panel | `eine Etage mehr macht die Zeichnung hoeher, nicht enger` |
| 6c2fdfca | panel | `the outer wall is split around the rooms` |
| 4c103f58 | panel | `arranging is offered to everyone who is logged in, not just admins` |
| 3a231491 | panel | `a guest cannot move a device into another room -- and hears why` |
| be70ff39 | panel | `the move is announced, and the way back is in the announcement` |
| 4ca68ea9 | panel | `das Raster laesst sich ohne Tastatur abschalten` |
| 9e7b482a | panel | `der Hinweis nennt keine Taste, die es auf diesem Geraet nicht gibt` |
| 576c53a3 | prosa | Verbot einer erfundenen Ebene — eine Abwesenheit |
| 20a773b4 | offen | Erdreich schraffiert statt als Fläche mit Rahmen |
