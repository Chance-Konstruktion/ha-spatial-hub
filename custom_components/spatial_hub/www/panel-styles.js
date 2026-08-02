/**
 * Das Stylesheet des Panels.
 *
 * Ausgelagert, weil es sonst niemand bekommt: `tools/shots.mjs` hat es
 * bis hierher mit `source.indexOf("const STYLES = `")` aus dem Quelltext
 * herausgeschnitten -- Textchirurgie an einer Datei, nur weil es kein
 * `import` gab. Zwei Werkzeuge machten das bereits.
 *
 * Reines CSS, keine einzige Interpolation. Was Werte braucht, bekommt sie
 * ueber Custom Properties, die das Panel am Wurzelelement setzt.
 */

export const STYLES = `
:host { display:block; height:100%; background:var(--primary-background-color,#f5f5f5); }
.app { display:flex; flex-direction:column; height:100%; color:var(--primary-text-color,#212121);
       font-family:var(--paper-font-body1_-_font-family, Roboto, sans-serif); }
/* Auf dem Telefon ist der Grundriss der Bildschirm.
 *
 * "100dvh" und nicht "100vh": die Adressleiste eines mobilen Browsers
 * faehrt beim Scrollen ein und aus, und "vh" rechnet mit der Hoehe ohne
 * sie -- der Plan waere immer ein Stueck laenger als das Fenster, also
 * genau die Leiste zurueck, die weg sollte. Fuer Browser ohne dvh steht
 * die alte Einheit als Rueckfall darueber. */
.app.phone { height:100vh; height:100dvh; }
/* Vollbild heisst randlos: kein Innenabstand, keine Karte, keine
 * Schatten. Was hier noch Platz kostet, kostet ihn am Haus. */
.app.phone .body { padding:0; gap:0; overflow:hidden; position:relative; }
.app.phone main { flex:1 1 auto; min-height:0; display:flex; }
.app.phone .viewport { max-height:none; height:100%; width:100%;
                       border-radius:0; }
.app.phone .stage, .app.phone .stack { border-radius:0; box-shadow:none; }
/* Die Kopfzeile ist im Vollbild nicht schmaler, sondern weg -- und mit
 * ihr die Etagenreiter. Deshalb bleibt der eine Knopf, der sie
 * zurueckholt, immer sichtbar. */
.bars-btn { position:absolute; top:8px; left:8px; z-index:6; border:0;
            border-radius:50%; padding:8px; cursor:pointer; display:flex;
            color:var(--primary-text-color,#212121);
            background:var(--card-background-color,#fff);
            box-shadow:var(--ha-card-box-shadow,0 1px 3px rgba(0,0,0,.3));
            opacity:.85; }
.bars-btn:active { opacity:1; }
header { display:flex; align-items:center; gap:8px; padding:8px 12px;
         background:var(--fp-accent, var(--app-header-background-color, var(--primary-color,#03a9f4)));
         color:var(--app-header-text-color,#fff);
         /* Umbrechen statt zerdruecken. Suche, Zoom und die
            Werkzeugknoepfe geben keine Breite her, die Reiterleiste
            schon -- auf einem Telefon schrumpfte sie deshalb auf null
            und die Kopfzeile begann mit dem Suchfeld: die Etagen waren
            nicht versteckt, sie waren null Pixel breit. Jetzt weichen
            sie in eine eigene Zeile aus. */
         flex-wrap:wrap; row-gap:8px; }
/* Ein Haus mit zwölf Etagen darf die Kopfzeile nicht in vier Zeilen
   umbrechen: die Reiter blieben sonst nicht dort, wo der Nutzer sie
   zuletzt gesehen hat, und der Grundriss darunter würde bei jedem
   Etagenwechsel springen. Also eine Zeile, und bei Bedarf seitlich
   scrollbar -- die Leiste wird schmaler, nie höher. */
/* "flex:1 1 auto" statt "0 1 auto": die Leiste nimmt sich den freien Platz
   selbst, statt ihn dem Abstandshalter zu überlassen und danach auf zwei
   Reiter zusammenzuschrumpfen. Bei sieben Etagen auf einem schmalen
   Fenster lagen die letzten sonst unerreichbar unter dem Suchfeld. */
/* "1 1 220px" statt "1 1 auto": die Leiste darf schmaler werden, aber
   nicht schmaler als eine Etage breit ist. Passen 220px und die Werkzeuge
   nicht nebeneinander, bricht die Zeile -- und zwar an einer Breite, die
   sich aus dem Platz ergibt, nicht aus einer geratenen Bildschirmgroesse.
   Ein Panel neben offener Seitenleiste ist genauso schmal wie ein Telefon
   und hatte dasselbe Problem. */
.tabs { display:flex; gap:4px; flex-wrap:nowrap; overflow-x:auto;
        min-width:0; flex:1 1 220px; scrollbar-width:none;
        overscroll-behavior-x:contain; order:-1; }
.tabs::-webkit-scrollbar { display:none; }
.tab { display:flex; align-items:center; gap:6px; border:0; border-radius:16px;
       padding:6px 14px; cursor:pointer; font:inherit; color:inherit;
       background:rgba(255,255,255,.15);
       /* Reiter geben keine Breite her: ein auf drei Buchstaben
          gequetschtes "Dachgeschoss" ist kein Reiter mehr. */
       flex:0 0 auto; white-space:nowrap; }
.tab.on { background:rgba(255,255,255,.85); color:var(--primary-color,#03a9f4); }
.spacer { flex:0 1 0; min-width:0; }
/* Auf einem schmalen Bildschirm gewinnt kein Werkzeug gegen die Etagen.
   Eine einzige Zeile bedeutet dort, dass Suche und Zoom die Reiterleiste
   zusammendrücken, bis die letzten Etagen unter dem Suchfeld liegen und
   nicht mehr erreichbar sind. Ab hier bekommen die Reiter deshalb eine
   eigene Zeile -- die oberste, weil "welche Etage" die erste Frage ist
   und alles andere Werkzeug dazu. */
/* Sobald die Reiter eine eigene Zeile haben, sollen sie die ganze
   nehmen -- eine halbe Zeile Etagen neben halb leerem Platz waere
   Verschnitt. Der Abstandshalter schiebt die Werkzeuge nach rechts. */
@media (max-width: 760px) {
  .tabs { flex:1 0 100%; }
  .spacer { flex:1 1 auto; }
  .search input { width:88px; }
}
@media (max-width: 420px) {
  /* Noch schmaler: das Suchfeld schrumpft auf die Lupe und wächst erst
     wieder, wenn jemand hineintippt. Ein Zoomknopf, der nicht mehr auf
     den Schirm passt, ist schlimmer als ein kurzes Suchfeld. */
  .search input { width:0; padding:0; }
  .search:focus-within input { width:110px; }
}
.icon-btn { border:0; background:transparent; color:inherit; cursor:pointer;
            border-radius:50%; padding:6px; display:flex; }
.icon-btn.on { background:rgba(255,255,255,.25); }
/* Ebenen und Provider stehen unter dem Grundriss, nicht daneben: der Plan
   ist das Einzige, was Breite wirklich braucht. */
.body { flex:1; display:flex; flex-direction:column; gap:16px; padding:16px; overflow:auto; }
/* "flex:1" hat den Plan oben festgenagelt und die Legende ans untere
   Ende geschoben -- auf einem 22:9-Telefon lagen 381 leere Pixel
   dazwischen. Der Plan ist quadratisch und damit von der Breite
   begrenzt; die uebrige Hoehe gehoert deshalb nicht in die Mitte,
   sondern hinter alles. Jetzt steht die Legende direkt unter dem
   Grundriss, egal wie hoch der Bildschirm ist. */
main { flex:0 0 auto; min-width:0; }
/* Eingeklappt: erst das Haus, dann die Erklärung dazu. */
.legend-toggle { display:flex; align-items:center; gap:6px; border:0;
                 background:transparent; color:var(--secondary-text-color,#727272);
                 font:inherit; cursor:pointer; padding:4px 0; border-radius:8px; }
.legend-toggle:hover { color:var(--primary-text-color,#212121); }
/* Im Hochformat ist die Höhe knapp und der Plan ist das, wofür man
   gekommen ist. Eine Legende, die unbegrenzt mitwächst, schiebt ihn aus
   dem sichtbaren Bereich -- also bekommt sie hier ein Dach und rollt
   selbst, statt die ganze Seite zu rollen. */
@media (orientation: portrait) {
  .legend.open { max-height:38vh; overflow-y:auto; -webkit-overflow-scrolling:touch; }
}
/* Auf dem Telefon liegt die Legende ueber dem Plan statt darunter.
 *
 * Darunter hiesse: der Plan wird kuerzer, sobald jemand nachsieht,
 * welche Ebene was zeichnet -- und beim Einrichten eines Raumes ist das
 * genau der falsche Moment, um Flaeche zu verlieren. Als Blatt kostet
 * sie nichts, solange sie zu ist, und laesst sich mit dem Daumen wieder
 * wegschieben, ohne den kleinen Schalter treffen zu muessen. */
.app.phone .legend { position:absolute; left:0; right:0; bottom:0; z-index:5;
                     background:var(--card-background-color,#fff);
                     border-radius:16px 16px 0 0;
                     box-shadow:0 -2px 12px rgba(0,0,0,.22);
                     padding:0 8px 8px;
                     transition:transform .18s ease-out; }
.app.phone .legend.open { max-height:60dvh; overflow-y:auto;
                          -webkit-overflow-scrolling:touch; }
/* Zu heisst zu: nur die Zeile mit dem Schalter, der Rest ist Plan. */
.app.phone .legend:not(.open) { box-shadow:none;
                                background:var(--card-background-color,#fff); }
.app.phone .legend .dock { box-shadow:none; border-radius:0; padding:0 8px 8px; }
.app.phone .legend-toggle { padding:8px 4px; }
/* Der Griff. Breit genug fuer einen Daumen, schmal genug, um nicht wie
   ein Knopf auszusehen -- er tut ja nichts, wenn man nur tippt.
   Sichtbar sind 5px, zu treffen sind 33: der Innenabstand gehoert zur
   Flaeche, gemalt wird nur der Inhalt ("background-clip:content-box").
   Ein Griff, den man verfehlt, ist schlimmer als gar keiner. */
.grab { display:block; margin:0 auto; width:44px; height:5px;
        padding:14px 0; box-sizing:content-box; background-clip:content-box;
        border-radius:3px; background-color:var(--divider-color,#d0d0d0);
        cursor:grab; touch-action:none; }
.grab:active { cursor:grabbing; }
.dock { display:flex; flex-wrap:wrap; gap:24px; align-items:flex-start;
        background:var(--card-background-color,#fff); border-radius:12px;
        padding:4px 16px 14px; box-shadow:var(--ha-card-box-shadow,0 1px 3px rgba(0,0,0,.12)); }
.dock-col { flex:1 1 240px; min-width:0; }
.provider-group { margin:6px 0 10px; }
.provider-head { display:flex; align-items:center; gap:6px; font-size:13px; }
.entities { list-style:none; margin:8px 0 0; padding:0; max-height:200px; overflow:auto; }
.entities li { display:flex; justify-content:space-between; gap:8px; padding:3px 0;
               font-size:13px; border-top:1px solid var(--divider-color,#e0e0e0); }
.links { display:flex; flex-wrap:wrap; gap:6px; margin:10px 0 4px; }
.links .chip { display:flex; align-items:center; gap:4px; font-size:13px; }
/* Suche und Zoom geben keine Breite her -- die Reiterleiste scrollt. */
.search { display:flex; align-items:center; gap:4px; background:rgba(255,255,255,.18);
          border-radius:16px; padding:2px 10px; flex:0 0 auto; }
.search input { border:0; background:transparent; color:inherit; font:inherit;
                width:120px; outline:none; }
.search input::placeholder { color:inherit; opacity:.7; }
.zoom { display:flex; align-items:center; gap:2px; font-size:12px; flex:0 0 auto; }
.icon-btn[disabled] { opacity:.4; cursor:default; }

/* The camera. Transform only, so panning never rebuilds the plan. */
/* Der Grundriss ist quadratisch, ein Bildschirm ist es nicht. Ohne Deckel
   ragt das Haus auf einem 16:9-Monitor unten aus dem Fenster und die
   Ansicht wirkt wie im Hochformat. */
.viewport { overflow:hidden; touch-action:none; border-radius:12px;
            max-height:calc(100vh - 200px); }
/* Kein "will-change:transform": das befördert die Fläche auf eine eigene
   Ebene, die einmal gerastert und danach nur noch als Bitmap vergrößert
   wird -- beim Hineinzoomen werden die Icons dadurch unscharf statt neu
   gezeichnet. Chromium tut das konsequent, Firefox nicht, daher sah es
   auf dem einen Rechner scharf und auf dem anderen matschig aus. */
/* Untergrenze, Obergrenze, Mitte. Die Zeichnung skaliert mit der Breite
   des Fensters, und ohne Untergrenze wurde aus einem schmalen Fenster ein
   noch schmalerer Turm: der Grundriss schrumpfte weiter, obwohl die
   Kamera ohnehin schieben und zoomen kann. Unter 560px wird jetzt nicht
   mehr gequetscht, sondern geschoben. */
/* Kein "margin-inline:auto". Zentriert wird die Zeichnung von der
   Kamera: ist sie kleiner als das Fenster, setzt "_clampView" sie in die
   Mitte. Beides zusammen zentriert zweimal -- einmal die Box im Fenster
   (halber Rest der *ungezoomten* Breite) und einmal den Inhalt per
   translate (halber Rest der *gezoomten*) -- und die Summe schob den
   Grundriss auf einem breiten Bildschirm in die rechte Haelfte, immer
   wieder, weil jeder Klick neu klemmt. Eine Zentrierung genuegt, und die
   der Kamera ist die, die auch beim Zoomen noch stimmt. */
.canvas { transform-origin:0 0; width:clamp(560px, 100%, 1280px); }

.stack { background:var(--fp-surface, var(--card-background-color,#fff));
         border-radius:12px; box-shadow:var(--ha-card-box-shadow,0 1px 3px rgba(0,0,0,.12));
         padding:8px; }
.stack svg { display:block; width:100%; height:auto; }
/* Es gibt keinen Gebäudekörper mehr, der über allen Etagen liegt. Weder
   durchscheinende Wände noch ein Dach noch Eckpfosten: alles davon lag
   über dem Grundriss, und der ist der Grund, warum jemand hinschaut. Was
   das Haus zusammenhält, sind jetzt die Wände der Etagen selbst. */
/* Drei Gewichte, damit das Auge sofort sortiert: die Aussenkante des
   Stockwerks am staerksten, die Innenwaende leiser, der Garten nur
   gestrichelt. Vorher hatte alles dieselbe Staerke -- deshalb war das
   Sandwich ein Brei. */
/* Bodenplatte: fast schwarz, eine helle Kante darum. Eine Bauzeichnung
   fuellt nichts -- was die Etage traegt, ist die Linie. */
.storey { fill:var(--fp-slab, var(--fp-surface, var(--card-background-color,#fff)));
          fill-opacity:var(--fp-slab-opacity, .92);
          stroke:var(--fp-house-line, currentColor);
          stroke-opacity:calc(.75 * var(--fp-house,1));
          stroke-width:calc(1.6px * var(--fp-house,1));
          vector-effect:non-scaling-stroke; }
/* Die Kante unter dem Stockwerk. Sie traegt die Etage, deshalb ist sie
   etwas dunkler als die Flaeche darueber. */
.storey-side { fill:var(--fp-slab-side, var(--fp-surface, var(--card-background-color,#fff)));
               stroke:var(--fp-house-line, currentColor);
               stroke-opacity:calc(.6 * var(--fp-house,1));
               stroke-width:calc(1.2px * var(--fp-house,1));
               vector-effect:non-scaling-stroke; }
/* Der Etagenname steht im linken Rand, gross und ruhig, auf Hoehe der
   Etage -- das Erste, was man in einer Schnittzeichnung liest. Vorher
   klebte er bei .65 Deckkraft an der Plattenkante und wurde vom Rand des
   Bildes abgeschnitten, weil links kein Rand war. */
/* Steht nur eine Etage da, ist der Name kein Ordnungsmerkmal mehr,
   sondern eine Beschriftung: klein, oben links, nach rechts laufend --
   und nicht 30px rechtsbuendig in einer Spalte, die es nicht gibt. */
.storey-name.alone { font-size:16px; text-anchor:start; opacity:.65; }
.storey-name { font-size:30px; fill:var(--fp-ink, currentColor); opacity:.8;
               letter-spacing:.1em; text-anchor:end; }
.stack-cloud { fill:var(--fp-virtual, rgba(120,144,180,.16));
               stroke:var(--fp-virtual-line, rgba(120,144,180,.7));
               stroke-width:1.5; vector-effect:non-scaling-stroke;
               stroke-dasharray:7 5; }
/* Innenwaende. Vorher eine Andeutung, die auf einem hellen Hintergrund
   praktisch verschwand -- und damit war das Haus im Sandwich eine leere
   Platte mit Punkten darauf. Jetzt eine Wand: sichtbar, aber immer noch
   leiser als die Aussenwand, die sie umschliesst. Der Regler bewegt
   beide, damit das Verhaeltnis stimmt. */
/* Der Boden im Raum bleibt der Hintergrund. Eine Fuellung hier war der
   Grund, warum sich sechzehn Raeume zu einer grauen Flaeche addierten. */
.stack .room { fill:none; stroke:none; }
/* Stehende Waende: die Aussenseite. Gefuellt, damit sie einander wirklich
   verdecken -- eine Wand, durch die man den Raum dahinter sieht, ist
   keine. Deckend, nicht durchscheinend, sonst summieren sich sechzehn
   Waende zu Grau. */
.room-wall { fill:var(--fp-wall, var(--fp-surface, var(--card-background-color,#fff)));
             stroke:var(--fp-shell-line, currentColor);
             stroke-width:calc(1.1px * var(--fp-house,1));
             stroke-opacity:calc(.8 * var(--fp-house,1));
             stroke-linejoin:round;
             vector-effect:non-scaling-stroke; }
/* Die Mauerkrone: das Band zwischen Aussen- und Innenkante. Das ist der
   Unterschied zwischen einem Grundriss und einem Rechteck mit Strich
   drumherum -- eine Wand hat zwei Seiten, und genau die sieht man hier. */
.room-cap { fill:var(--fp-wall-top, var(--fp-surface, var(--card-background-color,#fff)));
            stroke:var(--fp-shell-line, currentColor);
            stroke-width:calc(1.1px * var(--fp-house,1));
            stroke-opacity:calc(.95 * var(--fp-house,1));
            stroke-linejoin:round;
            vector-effect:non-scaling-stroke; }
/* Die Marke auf einer gemeinsamen Wand. Rotes × trennt, gruenes + fuegt
   wieder zusammen -- ohne das + waere das Trennen eine Entscheidung, die
   niemand zuruecknehmen kann. Sie sitzt mittig auf der Wand, die sie
   meint, und ist so gross, dass ein Daumen sie trifft. */
.join-mark { position:absolute; width:22px; height:22px; border-radius:50%;
             border:none; cursor:pointer; padding:0; z-index:5;
             font:600 15px/22px system-ui, sans-serif; color:#fff;
             box-shadow:0 1px 3px rgba(0,0,0,.4); }
.join-mark.on { background:var(--error-color,#db4437); }
.join-mark.off { background:var(--success-color,#43a047); }
.join-mark.top { left:50%; top:0; transform:translate(-50%,-50%); }
.join-mark.bottom { left:50%; top:100%; transform:translate(-50%,-50%); }
.join-mark.left { left:0; top:50%; transform:translate(-50%,-50%); }
.join-mark.right { left:100%; top:50%; transform:translate(-50%,-50%); }
/* Mauerwerk ist hier Darstellung, kein Bedienelement: ein Punkt, der
   halb unter einer Wand liegt, muss trotzdem das sein, was der Klick
   trifft. */
.room-wall, .room-cap, .shell-face, .shell-cap, .storey-side {
  pointer-events:none; }
/* Die Aussenwand traegt das Haus und ist deshalb staerker als die
   Zwischenwaende -- dasselbe, was eine Bauzeichnung auf Papier macht. */
.shell-face { fill:var(--fp-wall, var(--fp-surface, var(--card-background-color,#fff)));
              stroke:var(--fp-house-line, currentColor);
              stroke-opacity:calc(.85 * var(--fp-house,1));
              stroke-width:calc(1.4px * var(--fp-house,1));
              stroke-linejoin:round;
              vector-effect:non-scaling-stroke; }
.shell-cap { fill:var(--fp-wall-top, var(--fp-surface, var(--card-background-color,#fff)));
             stroke:var(--fp-house-line, currentColor);
             stroke-opacity:var(--fp-house,1);
             stroke-width:calc(1.6px * var(--fp-house,1));
             stroke-linejoin:round;
             vector-effect:non-scaling-stroke; }
/* Raumnamen wie in einer Bauzeichnung: Versalien, gesperrt, ruhig. Bei
   .55 Deckkraft standen sie auf dem dunklen Boden praktisch nicht da --
   ein Grundriss, dessen Raeume man nicht lesen kann, ist ein Muster. */
.stack .room-label { font-size:16px; fill:var(--fp-ink, currentColor);
                     opacity:.92; letter-spacing:.06em;
                     text-anchor:middle; dominant-baseline:middle; }
/* Ein Balkon ist kein Zimmer: die Deckflaeche bekommt einen eigenen Ton
   statt der Zimmerfarbe, das Gelaender bleibt niedrig. */
.stack .room.deck { fill:var(--fp-deck, var(--fp-house-line, currentColor));
                     fill-opacity:.08; stroke:var(--fp-house-line, currentColor);
                     stroke-opacity:.55; stroke-dasharray:2 3;
                     vector-effect:non-scaling-stroke; }
.doors { display:flex; flex-direction:column; gap:6px; margin:6px 0; }
.door { display:flex; align-items:center; gap:10px; flex-wrap:wrap; }
.door-side { min-width:5.5em; font-weight:600; }
.door-slide { display:flex; align-items:center; gap:6px; flex:1 1 8em; }
.door-slide input[type=range] { flex:1 1 auto; min-width:0; }
/* Stufen: leichter als eine Wand, sonst liest sich die Treppe als Raster. */
.tread { fill:none; stroke:var(--fp-house-line, currentColor);
         stroke-opacity:.75; stroke-width:1px;
         vector-effect:non-scaling-stroke; }
.deck-rail { fill:var(--fp-surface, var(--card-background-color,#fff));
             stroke:var(--fp-house-line, currentColor); stroke-opacity:.7;
             stroke-width:1px; vector-effect:non-scaling-stroke; }
.stack-edge { stroke-linecap:round; opacity:var(--layer-opacity,1); }
/* A connection between two storeys is the whole reason this view exists. */
.stack-edge.across { opacity:calc(var(--layer-opacity,1) * .95); }
/* Ebenen-Deckkraft und die Abblendung der Suche multiplizieren sich,
   statt sich gegenseitig zu überschreiben. */
/* Die Gegenskalierung sitzt im transform-Attribut, siehe
   _holdStackIconSize -- hier steht bewusst kein scale. */
.stack-node { cursor:pointer; opacity:var(--layer-opacity,1); }
.stack-node circle { stroke:var(--card-background-color,#fff); stroke-width:2; }
.stack-node.on circle { stroke:var(--fp-accent, var(--primary-color,#03a9f4)); stroke-width:4; }
.stack-node.floorless circle { stroke-dasharray:3 2; }
.stack-label { font-size:18px; fill:currentColor; text-anchor:middle; }
/* Nineteen labels on one storey is a smear, not information. On a crowded
   plane they appear on hover and for the selected node -- the dot is still
   there, and clicking it still says what it is. */
.stack-node.crowded .stack-label { opacity:0; transition:opacity .12s; }
.stack-node.crowded:hover .stack-label,
.stack-node.crowded.on .stack-label { opacity:1; }
.stack-icon { color:#fff; pointer-events:none; overflow:visible; }
.stack-icon ha-icon { --mdc-icon-size:22px; color:#fff; }
/* Das mitgelieferte Provider-SVG bringt keine Größe mit. Im HTML-Kontext
   des foreignObject greift diese hier zuverlässig. */
.stack-icon .custom-icon { display:block; width:22px; height:22px; }
.stack-icon .custom-icon svg { width:22px; height:22px; display:block; fill:#fff; }
/* Der Garten ist der Ring ums Erdgeschoss, keine eigene Etage. */
.apron { fill:var(--fp-outdoor, rgba(76,175,80,.10));
         stroke:var(--fp-outdoor-line, rgba(76,175,80,.45));
         stroke-width:2; stroke-dasharray:12 8; }
.plane.virtual .storey { stroke-dasharray:14 10; opacity:.7; }
/* Die Suche blendet nicht aus, sie stellt zurück: der Rest bleibt sichtbar. */
.stack-node.dimmed { opacity:calc(var(--layer-opacity,1) * .25); }
.stack-node.found circle { stroke:var(--fp-accent, var(--primary-color,#03a9f4));
                           stroke-width:4; }

.stage { position:relative; width:100%;
         background:var(--fp-surface, var(--card-background-color,#fff));
         border-radius:12px; background-size:cover; background-position:center;
         box-shadow:var(--ha-card-box-shadow,0 1px 3px rgba(0,0,0,.12)); overflow:hidden; }
.stage.placing { cursor:crosshair; outline:2px dashed var(--primary-color,#03a9f4); }
.edges { position:absolute; inset:0; width:100%; height:100%; pointer-events:none; }
.edge { pointer-events:stroke; cursor:pointer;
        opacity:calc(var(--layer-opacity,1) * .85); }
.edge.on { opacity:var(--layer-opacity,1); stroke-width:5; }
.edge.animated { stroke-dasharray:8 6; animation:flow 1.2s linear infinite; }
@keyframes flow { to { stroke-dashoffset:-28; } }

/* Die Außenwände der anderen Etagen: eine Linie, kein Raum. Nicht
   anklickbar, nicht im Weg -- nur da, damit man sieht, wo das Haus
   darunter aufhört. */
.ghost { position:absolute; pointer-events:none; border-radius:4px;
         border:2px dashed var(--fp-ghost, rgba(128,128,128,.55));
         background:transparent; }
/* Getroffen: aus der Linie, an der man sich orientiert, wird kurz die
   Linie, auf der man steht. Durchgezogen statt gestrichelt, weil ein
   eingerasteter Zustand kein Vorschlag mehr ist. */
.ghost.flush { border-style:solid;
               border-color:var(--primary-color,#03a9f4);
               box-shadow:0 0 0 3px rgba(3,169,244,.14); }
.ghost.flush .ghost-name { color:var(--primary-color,#03a9f4); }
/* Derselbe Gedanke fuer einen Raum, der beim Ziehen auf eine fremde Wand
   eingerastet ist: ohne dieses Aufleuchten sieht ein Magnet-Treffer genau
   so aus wie das gewoehnliche 2 %-Raster, und niemand erfaehrt, dass die
   Wand gerade wirklich mit der Nachbarwand teilt. */
.area.snapped { outline:2px solid var(--primary-color,#03a9f4);
                outline-offset:-2px; }
.ghost-name { position:absolute; top:-9px; left:8px; padding:0 4px;
              font-size:10px; letter-spacing:.04em; text-transform:uppercase;
              color:var(--secondary-text-color,#727272);
              background:var(--fp-surface, var(--card-background-color,#fff)); }

.area { position:absolute; transform:translate(-50%,-50%);
        border:1px dashed var(--divider-color,#e0e0e0); border-radius:10px;
        background:var(--secondary-background-color,#fafafa); opacity:.7; }
/* Ein Raum mit eigener Kontur: der Kasten selbst wird unsichtbar, die
   Fläche darin übernimmt Rahmen und Hintergrund und wird auf das Polygon
   beschnitten. Der Kasten bleibt, was er war -- er wird gezogen, an acht
   Wänden verändert und in der Sandwich-Ansicht projiziert; nur sieht man
   ihn nicht mehr. Beschnitte man den Kasten, wären auch seine eigenen
   Griffe weg. */
/* Das Grundstück: die Grenze um Haus und Garten. Home Assistant weiß
   nichts davon -- es kennt Räume, und ein Raum ist im Gebäude. Deshalb
   wird es gezeichnet und nicht abgeleitet, liegt unter allem anderen und
   ist erst da, wenn jemand es angelegt hat. */
.plot { position:absolute; inset:0; z-index:0; pointer-events:none;
        background:var(--fp-plot, rgba(139,195,74,.08));
        outline:2px solid var(--fp-plot-line, rgba(124,179,66,.55));
        outline-offset:-2px; border-radius:2px; }
.plot-corner { z-index:4; }
.area.shaped { border-color:transparent; background:transparent; }
.area-fill { position:absolute; inset:0; border-radius:10px;
             background:var(--secondary-background-color,#fafafa);
             outline:1px dashed var(--divider-color,#e0e0e0);
             outline-offset:-1px; pointer-events:none; }
.area.outdoor.shaped .area-fill { background:var(--fp-outdoor, rgba(76,175,80,.10));
             outline:1px solid var(--fp-outdoor-line, rgba(76,175,80,.6)); }
/* Ein Bild in genau diesem einen Raum -- derselbe Gedanke wie der
   Grundriss-Hintergrund einer Etage, nur auf den Kasten des Raumes
   beschnitten statt auf die ganze Bühne. Liegt unter der Füllung, damit
   ein Raum mit eigener Kontur das Bild ebenfalls zeigt statt es unter dem
   Rechteck zu verstecken. */
.area-background { position:absolute; inset:0; border-radius:10px;
             background-size:cover; background-position:center;
             pointer-events:none; }
/* Ecken-Modus: ein Griff je Ecke, ein kleinerer in jeder Wandmitte zum
   Einfügen. Damit werden Nischen und Wandversätze gezeichnet. */
/* Der sichtbare Punkt bleibt klein, das Ziel darum herum ist gross: ein
   Kreis mit unsichtbarem Rand. Zehn Pixel sind genug, um zu sagen "hier
   ist die Ecke" -- ein fetter Punkt verdeckt genau die Wand, die man
   gerade ausrichten will. Getroffen wird ohnehin der unsichtbare Rand.

   Und wie die Geraetepunkte haelt der Griff beim Zoomen seine Groesse:
   er sitzt im mitskalierenden .canvas, also zieht --grip-counter die
   Kamera wieder heraus. Ohne das wird derselbe Griff bei sechsfachem
   Zoom zum Teller ueber dem halben Zimmer -- also genau dann riesig,
   wenn man herangefahren ist, um praezise zu arbeiten. Gedeckelt bei 1,
   aus demselben Grund wie bei den Geraeten: herausgezoomt darf er mit
   dem Plan schrumpfen, statt als einziges Ding in Originalgroesse
   stehenzubleiben. */
.corner, .handle { --grip-counter:min(1, 1 / var(--camera-zoom,1)); }
.corner { position:absolute; width:10px; height:10px; margin:-5px 0 0 -5px;
          border-radius:50%; cursor:move; z-index:4; touch-action:none;
          display:flex; align-items:center; justify-content:center;
          background:var(--primary-color,#03a9f4);
          transform:scale(var(--grip-counter));
          box-shadow:0 0 0 2px var(--card-background-color,#fff),
                     0 1px 3px rgba(0,0,0,.35); }
/* Das Ziel waechst mit dem Kehrwert mit: der Griff wird kleiner
   gezeichnet, der Daumen bekommt trotzdem seine Flaeche. */
.corner::before { content:""; position:absolute; width:56px; height:56px;
                  border-radius:50%; }
.corner:hover { transform:scale(calc(var(--grip-counter) * 1.15)); }
/* Die Ecke einfuegen ist ein Plus und die Ecke entfernen ein Kreuz --
   beides steht dran. Vorher hiess "entfernen" Alt+Klick, was niemand
   sieht und auf einem Tablet nicht einmal existiert. */
.corner.add { width:12px; height:12px; margin:-6px 0 0 -6px; cursor:copy;
              font:600 9px/1 system-ui,sans-serif;
              color:var(--primary-color,#03a9f4);
              background:var(--card-background-color,#fff);
              box-shadow:0 0 0 2px var(--primary-color,#03a9f4),
                         0 1px 4px rgba(0,0,0,.3); }
.corner.add:hover { background:var(--primary-color,#03a9f4); color:#fff; }
.corner-drop { position:absolute; top:-11px; right:-11px; width:16px; height:16px;
               border:0; border-radius:50%; cursor:pointer; padding:0;
               font:600 13px/1 system-ui,sans-serif;
               background:var(--error-color,#db4437); color:#fff;
               box-shadow:0 1px 4px rgba(0,0,0,.35);
               opacity:0; pointer-events:none; transition:opacity .12s; }
/* Erst sichtbar, wenn diese Ecke gemeint ist -- acht Kreuze gleichzeitig
   waeren ein Minenfeld auf dem eigenen Grundriss. */
.corner:hover .corner-drop, .corner:focus-within .corner-drop {
  opacity:1; pointer-events:auto; }
/* Im Raum-Modus sind die Geraete weg. Zwanzig Punkte ueber den Waenden,
   die man gerade zieht, sind zwanzig Fehlgriffe -- und die Frage "wo ist
   die Wand" beantwortet kein Punkt. Sie sind nicht geloescht, nur nicht
   im Weg: ein Klick auf "Geraete" holt sie zurueck. */
.stage.editing-rooms .node,
.stage.editing-rooms .edges { display:none; }
/* Umgekehrt: beim Sortieren halten die Raeume still und treten zurueck,
   damit man sieht, in welchem Raum ein Punkt gerade landet. */
.stage.editing-icons .area { opacity:.75; }
.area-dim { position:absolute; bottom:4px; right:6px; font-size:11px;
            font-variant-numeric:tabular-nums; pointer-events:none;
            color:var(--secondary-text-color,#727272); }
.hint.meters { display:flex; flex-wrap:wrap; align-items:center; gap:10px; }
.hint.meters input { width:72px; font:inherit; padding:2px 6px; border-radius:6px;
                     border:1px solid var(--divider-color,#e0e0e0);
                     background:transparent; color:inherit; }
.mode { display:flex; gap:4px; flex:0 0 auto; }
.mode .chip { display:flex; align-items:center; gap:4px; white-space:nowrap;
              border-color:rgba(255,255,255,.4); }
.area-name { position:absolute; top:6px; left:8px; font-size:12px;
             color:var(--secondary-text-color,#727272); display:flex; align-items:center; gap:4px; }

.node { position:absolute; opacity:var(--layer-opacity,1);
        transform:translate(-50%,-50%) scale(calc(var(--node-scale,1) * min(1, 1 / var(--camera-zoom,1))));
        border:0; background:transparent; cursor:pointer; padding:0;
        display:flex; flex-direction:column; align-items:center; gap:2px; }
.node .dot { width:36px; height:36px; border-radius:50%; display:flex;
             align-items:center; justify-content:center; color:#fff;
             background:var(--node-color); box-shadow:0 1px 4px rgba(0,0,0,.3);
             transform:rotate(var(--node-rotation,0deg)); }
.node.floorless .dot { outline:2px dashed var(--warning-color,#ff9800); outline-offset:2px; }
.node.on .dot { box-shadow:0 0 0 4px var(--node-color); }
.node .label { font-size:11px; white-space:nowrap; color:var(--primary-text-color,#212121);
               background:var(--card-background-color,#fff); border-radius:4px; padding:0 4px; }
/* Fünf Geräte in einem Wohnzimmer ergaben fünf Namen übereinander --
   "HKV L HKV Wohnz Plug Fibaro 1" liest niemand. Auf einem vollen Raum
   erscheint der Name beim Zeigen und für das ausgewählte Gerät; der Punkt
   bleibt sichtbar, und ein Klick sagt weiterhin, was es ist. */
.node.crowded .label { opacity:0; transition:opacity .12s; }
.node.crowded:hover .label, .node.crowded.on .label { opacity:1; }
.node.crowded:hover, .node.crowded.on { z-index:3; }
.custom-icon svg { width:22px; height:22px; fill:currentColor; }
/* Ein Sammel-Icon steht fuer ein ganzes Zimmer voller Geraete -- die
   Zahl ist der ganze Unterschied zu einem einzelnen Punkt, sonst waere
   nicht zu sehen, dass hier mehr als eines wartet. */
.node.cluster .dot { background:var(--secondary-text-color,#727272); }
.node.cluster .cluster-count {
  position:absolute; top:-4px; right:-4px; min-width:16px; height:16px;
  padding:0 3px; border-radius:8px; font-size:10px; line-height:16px;
  text-align:center; color:#fff; background:var(--fp-accent, var(--primary-color,#03a9f4));
  box-shadow:0 0 0 2px var(--card-background-color,#fff);
}
.cluster-popup .cluster-list { display:flex; flex-direction:column; gap:2px;
  max-height:60vh; overflow-y:auto; }
.cluster-item { display:flex; align-items:center; gap:10px; border:0;
  background:transparent; padding:8px 4px; cursor:pointer; font:inherit;
  color:inherit; text-align:left; border-radius:8px; }
.cluster-item:hover { background:var(--secondary-background-color,#fafafa); }

h3 { margin:12px 0 6px; font-size:14px; }
.rows { display:flex; flex-direction:column; }
.row { display:flex; align-items:center; gap:8px; border:0; background:transparent;
       padding:6px 4px; cursor:pointer; font:inherit; color:inherit; text-align:left; border-radius:8px; }
.row:hover { background:var(--secondary-background-color,#fafafa); }
.muted { color:var(--secondary-text-color,#727272); }
.note { color:var(--secondary-text-color,#727272); font-size:13px; margin:4px 0; }
.chips { display:flex; flex-wrap:wrap; gap:6px; }
.chip { border:1px solid var(--divider-color,#e0e0e0); border-radius:14px; padding:4px 10px;
        background:transparent; cursor:pointer; font:inherit; color:inherit; }
.chip.on { background:var(--fp-accent, var(--primary-color,#03a9f4)); color:#fff;
           border-color:transparent; }
.providers { list-style:none; margin:0; padding:0; }
.providers li { display:flex; align-items:center; gap:6px; padding:3px 0; font-size:13px; }
.hint { font-size:13px; margin:8px 2px; }
/* ── Theme: shapes, labels, rooms ─────────────────────────── */
.stage.shape-rounded .dot { border-radius:22%; }
.stage.shape-square .dot { border-radius:2px; }
.stage.labels-never .node .label { display:none; }
.stage.labels-hover .node .label { opacity:0; transition:opacity .12s; }
.stage.labels-hover .node:hover .label,
.stage.labels-hover .node.on .label { opacity:1; }
.stage.rooms-none .area { border-color:transparent; background:transparent; }
.stage.rooms-none .area-name { opacity:.55; }
.stage.rooms-filled .area { border-style:solid;
  background:var(--fp-accent, var(--primary-color,#03a9f4)); opacity:.14; }
.stage.rooms-filled .area-name { color:var(--fp-ink, var(--primary-text-color,#212121)); opacity:1; }

.swatches { display:flex; flex-wrap:wrap; align-items:center; gap:10px; margin:10px 0; }
.swatches > .muted { width:100%; font-size:12px; }
.swatch { display:flex; flex-direction:column; align-items:center; gap:2px;
          font-size:11px; color:var(--secondary-text-color,#727272); }
.swatch input[type=color] { width:34px; height:26px; border:0; background:none;
                            padding:0; cursor:pointer; }
select { font:inherit; padding:6px; border-radius:8px;
         border:1px solid var(--divider-color,#e0e0e0);
         background:var(--card-background-color,#fff); color:inherit; }

.stage.editing .area { cursor:grab; opacity:.9; border-style:solid; }
.stage.editing .node { cursor:grab; }
/* The grid is an overlay, so it never fights the floor's background image. */
.stage.editing::before { content:""; position:absolute; inset:0; pointer-events:none;
  background-image:
    linear-gradient(to right, rgba(127,127,127,.14) 1px, transparent 1px),
    linear-gradient(to bottom, rgba(127,127,127,.14) 1px, transparent 1px);
  background-size:4% 4%; }
/* Acht Griffe: jede Wand und jede Ecke lässt sich ziehen. */
.handle { position:absolute; background:var(--primary-color,#03a9f4);
          border:1px solid var(--card-background-color,#fff); border-radius:50%;
          width:9px; height:9px; opacity:.9;
          transform:scale(var(--grip-counter)); }
/* Wie bei der Ecke: klein gezeichnet, gross zu treffen. */
.handle::before { content:""; position:absolute; inset:-16px;
                  border-radius:50%; }
.handle-n { top:-5px; left:50%; margin-left:-5px; cursor:ns-resize; }
.handle-s { bottom:-5px; left:50%; margin-left:-5px; cursor:ns-resize; }
.handle-w { left:-5px; top:50%; margin-top:-5px; cursor:ew-resize; }
.handle-e { right:-5px; top:50%; margin-top:-5px; cursor:ew-resize; }
.handle-nw { top:-5px; left:-5px; cursor:nwse-resize; }
.handle-se { bottom:-5px; right:-5px; cursor:nwse-resize; }
.handle-ne { top:-5px; right:-5px; cursor:nesw-resize; }
.handle-sw { bottom:-5px; left:-5px; cursor:nesw-resize; }
.area-config { position:absolute; top:2px; right:26px; border:0; background:transparent;
               color:var(--secondary-text-color,#727272); cursor:pointer; padding:2px;
               display:flex; border-radius:50%; }
.area.outdoor { border-style:solid; border-color:var(--fp-outdoor-line, rgba(76,175,80,.6));
                background:var(--fp-outdoor, rgba(76,175,80,.10)); }
/* Ein virtueller Bereich ist kein Raum, und ein Rechteck mit gepunktetem
   Rand sagt das niemandem. Jeder so markierte Bereich bekommt seine eigene
   Wolke: Cloud, VPN und Server sind drei Dinge, nicht ein Kasten mit drei
   Kästen darin. */
.area.virtual { border:0; background:transparent; opacity:1; }
.area.virtual .cloud { position:absolute; inset:0; overflow:visible;
                       pointer-events:none; }
.area.virtual .cloud path {
  fill:var(--fp-virtual, rgba(120,144,180,.16));
  stroke:var(--fp-virtual-line, rgba(120,144,180,.7));
  stroke-width:1.5; vector-effect:non-scaling-stroke; stroke-dasharray:7 5; }
.area.virtual .area-name { top:30%; left:0; right:0; justify-content:center; }
/* Die Ablage steht bewusst außerhalb des Grundrisses: was hier liegt,
   hat noch keinen Platz im Haus, und einer im Raster wäre eine Behauptung. */
.tray { margin:10px 0 0; padding:8px 12px; border-radius:12px;
        background:var(--card-background-color,#fff);
        box-shadow:var(--ha-card-box-shadow,0 1px 3px rgba(0,0,0,.12)); }
.tray-head { display:flex; align-items:center; flex-wrap:wrap; gap:6px;
             margin:0 0 8px; font-size:13px; }
.tray-items { display:flex; flex-wrap:wrap; gap:6px; }
.tray-item { display:flex; align-items:center; gap:6px; border:0; font:inherit;
             color:inherit; cursor:pointer; border-radius:16px; padding:3px 10px 3px 3px;
             background:var(--secondary-background-color,#fafafa); font-size:13px; }
.tray-item:hover { background:var(--divider-color,#e0e0e0); }
.tray-item .dot { width:26px; height:26px; border-radius:50%; display:flex;
                  align-items:center; justify-content:center; color:#fff;
                  background:var(--node-color);
                  outline:2px dashed var(--warning-color,#ff9800); outline-offset:1px; }
.tray-item .dot ha-icon { --mdc-icon-size:16px; }
.tray-item .custom-icon svg { width:16px; height:16px; fill:currentColor; }
/* Die Bauflucht: die Linie, an der das Haus aufhört und der Garten
   anfängt. Ohne sie ist der Grundriss ein Raster aus Kästen, in dem der
   Garten zufällig auch ein Kasten ist. */
.building-line { position:absolute; pointer-events:none; border-radius:6px;
                 border:2px solid var(--fp-shell-line, rgba(128,145,170,.55));
                 background:var(--fp-shell, rgba(128,145,170,.06)); }
.stage.with-apron { outline:none; }
.node.dimmed { opacity:calc(var(--layer-opacity,1) * .25); }
.node.found .dot { box-shadow:0 0 0 4px var(--fp-accent, var(--primary-color,#03a9f4)); }
.area-hide { position:absolute; top:2px; right:2px; border:0; background:transparent;
             color:var(--secondary-text-color,#727272); cursor:pointer; padding:2px;
             display:flex; border-radius:50%; }
.area-hide:hover { background:var(--secondary-background-color,#fafafa); }

.layer { display:flex; flex-direction:column; }
.layer-edit { display:flex; align-items:center; gap:4px; padding:0 4px 6px 30px; }
.layer-edit input[type=range] { flex:1; min-width:0; }
.icon-btn.small { padding:2px; }
.icon-btn.small ha-icon { --mdc-icon-size:18px; }

.edit-panel { border-top:1px solid var(--divider-color,#e0e0e0);
              border-bottom:1px solid var(--divider-color,#e0e0e0);
              padding:8px 0; margin:8px 0; }
.field { display:flex; flex-direction:column; gap:4px; font-size:13px; margin:8px 0; }
.field input[type=range] { width:100%; }
.field input[type=text] { font:inherit; padding:8px; border-radius:8px;
  border:1px solid var(--divider-color,#e0e0e0);
  background:var(--card-background-color,#fff); color:inherit; }
.field i { font-style:normal; color:var(--secondary-text-color,#727272); }
.popup > .muted { display:block; font-size:12px; margin:10px 0 4px; }
.edit-buttons { display:flex; gap:8px; flex-wrap:wrap; margin-top:8px; }
.edit-buttons .chip { display:flex; align-items:center; gap:4px; }

/* Der einzige Hinweis, der von einer Aenderung *ausserhalb* des Hubs
   berichtet. Deshalb faellt er auf und deshalb steht der Weg zurueck
   direkt darin. */
.banner.moved { border-left:4px solid var(--fp-accent, var(--primary-color,#03a9f4)); }
.banner.moved .link { background:none; border:none; padding:0 0 0 6px;
                      color:var(--fp-accent, var(--primary-color,#03a9f4));
                      font:inherit; cursor:pointer; text-decoration:underline; }
.banner { margin:0 0 12px; padding:10px 14px; border-radius:10px; font-size:13px;
          background:var(--card-background-color,#fff); color:var(--secondary-text-color,#727272);
          box-shadow:var(--ha-card-box-shadow,0 1px 3px rgba(0,0,0,.12)); }
.link { border:0; background:transparent; color:var(--primary-color,#03a9f4);
        cursor:pointer; font:inherit; padding:0; text-decoration:underline; }

.empty, .loading { padding:48px 24px; text-align:center; color:var(--secondary-text-color,#727272); }
.empty h2 { color:var(--primary-text-color,#212121); }
.empty p { max-width:44ch; margin:8px auto; }

.diagnostics { margin:0 16px 16px; background:var(--card-background-color,#fff);
               border-radius:12px; padding:8px 16px 16px; }
.diag-head { display:flex; align-items:center; justify-content:space-between; }
.diag-provider { padding:6px 0; border-top:1px solid var(--divider-color,#e0e0e0); }
.diag-provider ul { margin:4px 0; padding-left:18px; color:var(--error-color,#f44336); font-size:13px; }
.ok { color:var(--success-color,#4caf50); font-size:13px; margin:4px 0; }

.scrim { position:fixed; inset:0; background:rgba(0,0,0,.4); }

/* Das Rechtsklickmenü. Der Vorhang darunter ist durchsichtig: er fängt
   nur den Klick daneben ab, verdunkelt aber nichts -- man soll weiter
   sehen, worauf man geklickt hat, während man auswählt. */
.menu-scrim { position:fixed; inset:0; z-index:40; }
.menu { position:fixed; z-index:41; min-width:210px; padding:6px;
        background:var(--card-background-color,#fff); border-radius:12px;
        box-shadow:0 12px 32px rgba(0,0,0,.32); }
.menu-item { display:flex; align-items:center; gap:10px; width:100%;
             padding:7px 10px; border:0; border-radius:8px; background:none;
             color:var(--primary-text-color,#111); font:inherit; font-size:14px;
             text-align:left; cursor:pointer; }
.menu-item:hover { background:rgba(127,127,127,.14); }
.menu-item ha-icon { --mdc-icon-size:19px; opacity:.72; flex:0 0 auto; }
/* Der eingeschaltete Eintrag ist keine Schaltfläche, die gedrückt aussieht,
   sondern der aktuelle Zustand: Häkchen statt Hervorhebung. */
.menu-item.on { color:var(--primary-color,#03a9f4); }
.menu-item.on ha-icon { opacity:1; }
.menu-label { flex:1 1 auto; }
.menu-tick { --mdc-icon-size:17px; flex:0 0 auto; }
.menu-rule { height:1px; margin:5px 6px;
             background:var(--divider-color,rgba(127,127,127,.28)); }
/* Mittig über dem Grundriss, nicht am Rand: ein Modal, das man auch auf
   einem großen Bildschirm sofort findet. */
.popup { position:fixed; left:50%; top:50%; transform:translate(-50%,-50%);
         width:min(460px,calc(100vw - 32px));
         max-height:80vh; overflow:auto; background:var(--card-background-color,#fff);
         border-radius:16px; padding:20px; box-shadow:0 16px 48px rgba(0,0,0,.35); }
.popup-icon { display:flex; align-items:center; justify-content:center;
              width:36px; height:36px; border-radius:50%; color:#fff;
              background:var(--node-color, var(--primary-color,#03a9f4)); flex:0 0 auto; }
.popup-icon svg { width:22px; height:22px; fill:currentColor; }
.inline { display:flex; align-items:center; gap:8px; font-size:13px; margin:6px 0; }
.popup-head { display:flex; align-items:flex-start; justify-content:space-between; gap:8px; }
.popup h2 { margin:0; font-size:18px; }
.popup .sub { margin:2px 0 10px; color:var(--secondary-text-color,#727272); font-size:13px; }
.popup table { width:100%; border-collapse:collapse; font-size:13px; }
.popup th { text-align:left; font-weight:500; color:var(--secondary-text-color,#727272);
            padding:3px 8px 3px 0; vertical-align:top; white-space:nowrap; }
.popup td { padding:3px 0; word-break:break-word; }
.actions { display:flex; flex-wrap:wrap; gap:8px; margin-top:12px; }
.action { display:flex; align-items:center; gap:6px; border:0; border-radius:18px;
          padding:8px 16px; cursor:pointer; font:inherit;
          background:var(--fp-accent, var(--primary-color,#03a9f4)); color:#fff; }
.spark { width:100%; height:48px; margin-top:8px; }
`;
