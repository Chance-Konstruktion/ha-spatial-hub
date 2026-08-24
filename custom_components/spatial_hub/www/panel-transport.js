/**
 * Spatial Hub -- der Transport.
 *
 * Die einzige Stelle, an der der eingebaute Renderer Home Assistant
 * anfasst. Alles andere in diesem Ordner rechnet, zeichnet und faerbt,
 * ohne zu wissen, in welcher Anwendung es laeuft.
 *
 * Der Grund dafuer ist nicht Ordnungsliebe. Der Renderer soll auslagerbar
 * sein -- ein anderes Projekt, ein Dashboard, eine Wandtafel, irgendwann
 * vielleicht ein eigenes Paket. Solange `hass.callWS` ueber die ganze
 * Datei verstreut ist, geht das nicht, ohne ueberall gleichzeitig zu
 * schneiden. Liegt es hinter diesen fuenf Methoden, tauscht man eine
 * Datei aus und ist fertig.
 *
 * ── Der Vertrag ──────────────────────────────────────────────────────
 *
 * Wer den Renderer woanders einsetzt, stellt ein Objekt mit genau diesen
 * fuenf Methoden und setzt es ueber `panel.transport = ...`:
 *
 *   call(message)              -> Promise<Antwort>
 *       Ein Websocket-Befehl des Hubs. `message.type` ist immer einer der
 *       in docs/PROVIDER_API.md dokumentierten Namen. Wirft bei Fehlern.
 *
 *   subscribe(message, handler) -> Promise<() => void>
 *       Bestellt die Aenderungsmeldungen des Hubs. Gibt zurueck, womit man
 *       sie wieder abbestellt. Darf werfen -- der Renderer faengt das ab
 *       und zeichnet dann eben ohne Aktualisierung weiter.
 *
 *   canArrange()               -> boolean
 *       Ob der Betrachter die **Anordnung** aendern darf -- also das Bild,
 *       das nur der Hub speichert. Das ist ausdruecklich **keine**
 *       Verwaltersache: Die Spezifikation sagt zum einzigen Befehl, der
 *       ausserhalb des Hubs schreibt, "Admin-pflichtig. Anordnen ist es
 *       nicht, das hier schon." Hier stand einmal eine einzige Frage
 *       `canEdit()`, die "Anordnung" hiess und `is_admin` zurueckgab --
 *       damit war der ganze Editor fuer jeden gesperrt, der kein
 *       Verwalter ist, obwohl der Hub seine Schreibbefehle laengst
 *       durchgelassen haette.
 *
 *   isAdmin()                  -> boolean
 *       Ob der Betrachter tun darf, was **ausserhalb** des Hubs wirkt:
 *       Aktionen eines Providers (die schalten echte Geraete) und das
 *       Umhaengen eines Geraets in einen anderen Bereich (das schreibt in
 *       das Register von Home Assistant, sichtbar in jedem Dashboard).
 *
 *   navigate(path)             -> void
 *       Zu einer anderen Seite der umgebenden Anwendung wechseln.
 *
 *   moreInfo(entityId, view)   -> void
 *       Die Einzelheiten zu einer Entitaet zeigen. `view` ist entweder
 *       leer oder "settings". Wer nichts Vergleichbares hat, darf hier
 *       nichts tun -- der Renderer kommt ohne aus.
 *
 * Nichts davon muss zu Home Assistant fuehren. Eine Umsetzung, die
 * `call` gegen eine JSON-Datei laufen laesst, ergibt einen Renderer, der
 * einen gespeicherten Grundriss zeigt, ohne dass irgendetwas laeuft.
 */

/** Die Umsetzung fuer Home Assistant.
 *
 *  `host` ist das Panel-Element selbst. Es wird bei jedem Aufruf neu
 *  gefragt statt einmal ausgelesen: Home Assistant tauscht sein
 *  `hass`-Objekt bei jeder Zustandsaenderung gegen ein neues aus, und ein
 *  festgehaltenes waere nach der ersten Lampe veraltet.
 */
export function haTransport(host) {
  const hass = () => host.hass;

  return {
    call(message) {
      return hass().callWS(message);
    },

    subscribe(message, handler) {
      return hass().connection.subscribeMessage(handler, message);
    },

    canArrange() {
      // Angemeldet genuegt. Wer den Grundriss sehen darf, darf ihn auch
      // ordnen -- das schreibt in den Speicher des Hubs und sonst
      // nirgends.
      const h = hass();
      return Boolean(h && h.user);
    },

    isAdmin() {
      const h = hass();
      return Boolean(h && h.user && h.user.is_admin);
    },

    navigate(path) {
      // Home Assistants eigenes Ereignis: es behaelt den Anwendungs-
      // zustand, damit der Weg zurueck zum Grundriss der Zurueck-Knopf
      // des Browsers ist.
      host.dispatchEvent(
        new CustomEvent("hass-navigate", {
          detail: { path },
          bubbles: true,
          composed: true,
        }),
      );
      if (window.history && window.history.pushState) {
        window.history.pushState(null, "", path);
        window.dispatchEvent(new CustomEvent("location-changed"));
      }
    },

    moreInfo(entityId, view) {
      // Der Einzelheiten-Dialog ist die Tuer zu den Einstellungen einer
      // Entitaet, und er geht ueber dem Grundriss auf, statt von ihm weg
      // zu navigieren.
      host.dispatchEvent(
        new CustomEvent("hass-more-info", {
          detail: view ? { entityId, view } : { entityId },
          bubbles: true,
          composed: true,
        }),
      );
    },
  };
}
