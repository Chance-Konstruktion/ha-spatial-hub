#!/usr/bin/env python3
"""Die Icons aller sechs Anbieter aus dem Hub-Icon ableiten.

    python3 tools/make_provider_icons.py            # alle sechs
    python3 tools/make_provider_icons.py zwave      # nur einen

Die sieben Repositories gehoeren zusammen, also sollen sie auch so
aussehen: dasselbe Haus mit seinen Ebenen, und ein Abzeichen unten
rechts, das sagt, welcher Anbieter es ist. Sechs voellig eigene Motive
wuerden die Verwandtschaft verschweigen -- und waeren sechsmal die Arbeit.

Warum dieses Skript im HUB liegt und nicht in jedem Anbieter:

  * Das Grundbild liegt hier. Eine Kopie in jedem Anbieter waere die
    siebte Datei, die auseinanderlaeuft -- genau der Fehler, den der
    SDK-Abgleich in tests/ schon einmal gefunden hat.
  * Der Zeichen-Code ist fuer alle sechs derselbe. Sechs Kopien davon
    haetten dasselbe Problem eine Etage hoeher: Wer die Ecke verschiebt,
    verschiebt sie in einem Repo und vergisst fuenf.

Geschrieben wird in die Arbeitskopien der Nachbar-Repos (Standard:
Geschwisterordner). Die fertigen PNGs werden dort eingecheckt -- ein
Anbieter soll sein Icon nicht erst bauen muessen, um es zu haben.

Die Zeichen sind vereinfachte Eigenzeichnungen in der jeweiligen
Protokollfarbe, keine Kopien der geschuetzten Herstellerlogos.
"""

from __future__ import annotations

import argparse
import io
import math
import sys
import urllib.error
import urllib.request
from pathlib import Path

try:
    from PIL import Image, ImageDraw, ImageFilter
except ImportError:  # pragma: no cover - Hinweis statt Absturz
    sys.exit("Pillow fehlt:  pip install pillow")

WURZEL = Path(__file__).resolve().parents[1]

BASIS_DATEI = WURZEL / "custom_components" / "spatial_hub" / "brand" / "icon@2x.png"
BASIS_URL = (
    "https://gitlab.schanz.ipv64.net/chance-konstruktion/ha-spatial-hub"
    "/-/raw/main/custom_components/spatial_hub/brand/icon%402x.png"
)

# Die 200-KiB-Grenze der GitLab-Instanz fuer Projektbilder. 384 px lagen beim
# Hub-Icon mit 237 KiB darueber, deshalb wird die Kantenlaenge gesucht statt
# geraten.
AVATAR_GRENZE = 200 * 1024
AVATAR_KANTEN = (384, 352, 320, 288, 256)

WEISS = (255, 255, 255, 255)


# --------------------------------------------------------------------------
# Die sechs Zeichen. Jedes bekommt eine Leinwand der Kantenlaenge s, auf der
# der farbige Kreis schon liegt, und zeichnet in Weiss darauf.
#
# Sie muessen sich auf 60 Pixel Kantenlaenge unterscheiden lassen -- so gross
# ist das Abzeichen im HACS-Listeneintrag. Deshalb je Anbieter EINE Grundform
# (Z, Rune, Sechseck, Chip, Netz, Pfeile) und keine Details darunter.
# --------------------------------------------------------------------------

def _linien(stift, s, punkte, staerke):
    """Linienzug in Weiss, mit runden Enden (sonst fransen die Ecken aus)."""
    stift.line(
        [(x * s, y * s) for x, y in punkte],
        fill=WEISS, width=max(1, int(s * staerke)), joint="curve",
    )
    # joint="curve" rundet nur die Knicke, nicht die Enden.
    r = max(1, int(s * staerke)) / 2
    for x, y in (punkte[0], punkte[-1]):
        stift.ellipse([x * s - r, y * s - r, x * s + r, y * s + r], fill=WEISS)


def _punkt(stift, s, x, y, radius):
    stift.ellipse(
        [(x - radius) * s, (y - radius) * s, (x + radius) * s, (y + radius) * s],
        fill=WEISS,
    )


def zeichen_zwave(stift, s):
    """Z-Wave: das Z, dick und kantig."""
    _linien(stift, s, [(0.28, 0.30), (0.72, 0.30), (0.28, 0.70), (0.72, 0.70)], 0.085)


def zeichen_zigbee(stift, s):
    """Zigbee: die Wabe. Kein Z darin -- sonst verwechselt man sie mit Z-Wave."""
    ecken = [
        (0.5 + 0.24 * math.cos(math.radians(w)), 0.5 + 0.24 * math.sin(math.radians(w)))
        for w in range(30, 391, 60)
    ]
    _linien(stift, s, ecken, 0.075)
    _punkt(stift, s, 0.5, 0.5, 0.065)


def zeichen_bluetooth(stift, s):
    """Bluetooth: die Bindrune aus Hagall und Bjarkan."""
    _linien(stift, s, [(0.5, 0.18), (0.5, 0.82)], 0.070)
    _linien(stift, s, [(0.5, 0.18), (0.70, 0.34), (0.30, 0.66)], 0.070)
    _linien(stift, s, [(0.5, 0.82), (0.70, 0.66), (0.30, 0.34)], 0.070)


def zeichen_esphome(stift, s):
    """ESPHome: der Chip mit seinen Beinchen."""
    a, b = 0.32, 0.68
    stift.rounded_rectangle(
        [a * s, a * s, b * s, b * s],
        radius=s * 0.05, outline=WEISS, width=max(1, int(s * 0.062)),
    )
    for versatz in (0.42, 0.50, 0.58):
        _linien(stift, s, [(versatz, 0.18), (versatz, a)], 0.050)   # oben
        _linien(stift, s, [(versatz, b), (versatz, 0.82)], 0.050)   # unten
        _linien(stift, s, [(0.18, versatz), (a, versatz)], 0.050)   # links
        _linien(stift, s, [(b, versatz), (0.82, versatz)], 0.050)   # rechts


def zeichen_thread(stift, s):
    """Thread: das Maschennetz -- jeder Knoten haengt an mehreren."""
    aussen = [
        (0.5 + 0.26 * math.cos(math.radians(w)), 0.5 + 0.26 * math.sin(math.radians(w)))
        for w in (270, 342, 54, 126, 198)
    ]
    for i, p in enumerate(aussen):
        _linien(stift, s, [p, (0.5, 0.5)], 0.042)
        _linien(stift, s, [p, aussen[(i + 1) % len(aussen)]], 0.042)
    for p in aussen:
        _punkt(stift, s, p[0], p[1], 0.055)
    _punkt(stift, s, 0.5, 0.5, 0.070)


def zeichen_matter(stift, s):
    """Matter: drei Pfeile, die auf einen Punkt zulaufen -- viele Systeme, ein Ziel."""
    for grad in (270, 30, 150):
        rad = math.radians(grad)
        dx, dy = math.cos(rad), math.sin(rad)
        aus = (0.5 + dx * 0.28, 0.5 + dy * 0.28)
        ein = (0.5 + dx * 0.17, 0.5 + dy * 0.17)
        _linien(stift, s, [aus, ein], 0.062)
        # Spitze nach innen: gleichschenkliges Dreieck auf der Achse.
        qx, qy = -dy, dx
        stift.polygon(
            [
                ((0.5 + dx * 0.10) * s, (0.5 + dy * 0.10) * s),
                ((ein[0] + qx * 0.090) * s, (ein[1] + qy * 0.090) * s),
                ((ein[0] - qx * 0.090) * s, (ein[1] - qy * 0.090) * s),
            ],
            fill=WEISS,
        )


# Farbe je Anbieter: an die Protokollfarbe angelehnt, aber vor allem
# untereinander unterscheidbar -- Marineblau, Azur, Rot, Cyan, Gruen, Orange.
# Zwei benachbarte Blautoene waeren in einer Liste nicht auseinanderzuhalten.
ANBIETER = {
    "zwave":     ((18, 58, 120),   zeichen_zwave),
    "zigbee":    ((196, 58, 52),   zeichen_zigbee),
    "bluetooth": ((0, 122, 245),   zeichen_bluetooth),
    "esphome":   ((28, 160, 200),  zeichen_esphome),
    "thread":    ((0, 148, 92),    zeichen_thread),
    "matter":    ((240, 148, 28),  zeichen_matter),
}


def abzeichen(groesse: int, farbe: tuple[int, int, int], zeichnen) -> Image.Image:
    """Farbiger Kreis mit weissem Ring und dem Zeichen darin."""
    # Vierfach gezeichnet und dann verkleinert -- Linien, die direkt in der
    # Zielgroesse gezogen werden, haben harte Treppen an den Flanken.
    s = groesse * 4
    bild = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    stift = ImageDraw.Draw(bild)

    rand = s * 0.04
    stift.ellipse([rand, rand, s - rand, s - rand], fill=farbe + (255,))
    stift.ellipse(
        [rand, rand, s - rand, s - rand],
        outline=(255, 255, 255, 235), width=int(s * 0.035),
    )
    zeichnen(stift, s)
    return bild.resize((groesse, groesse), Image.LANCZOS)


def _ueberstand(bild: Image.Image, x: int, y: int, gross: int) -> float:
    """Anteil des Abzeichens, der neben dem Motiv liegt (0 = sitzt ganz drauf).

    An einer gerundeten Ecke ist das nicht selbstverstaendlich, und ein halb
    ueberstehendes Abzeichen faellt auf hellem Hintergrund sofort auf. Statt
    das per Augenmass zu beurteilen, wird der Alphakanal darunter gelesen.
    """
    grund = bild.getchannel("A").crop((x, y, x + gross, y + gross))
    rund = Image.new("L", (gross, gross), 0)
    ImageDraw.Draw(rund).ellipse([0, 0, gross - 1, gross - 1], fill=255)
    # Schwelle 200, nicht 250: Das Grundbild ist nirgends voll deckend -- im
    # Inneren liegt der Alphakanal bei 250 bis 253. Mit 250 haette dieser Test
    # immer angeschlagen, auch mitten im Haus, und waere damit kein Test
    # gewesen, sondern eine Sperre.
    # tobytes() statt getdata(): letzteres ist ab Pillow 14 weg.
    draussen = sum(
        1 for a, m in zip(grund.tobytes(), rund.tobytes()) if m > 128 and a < 200
    )
    return draussen / (math.pi * (gross / 2) ** 2)


def zusammensetzen(basis: Image.Image, kante: int, farbe, zeichnen) -> Image.Image:
    """Grundbild in Zielgroesse, Abzeichen unten rechts daraufgesetzt."""
    bild = basis.resize((kante, kante), Image.LANCZOS)

    # 0.26 statt 0.40: Beim ersten Versuch verdeckte das Abzeichen ein Viertel
    # des Hauses und ragte ueber die gerundete Ecke hinaus -- es sah aufgeklebt
    # aus statt zugehoerig. Ein Abzeichen soll kennzeichnen, nicht uebernehmen.
    gross = int(kante * 0.26)
    marke = abzeichen(gross, farbe, zeichnen)

    # Der Abstand zur Kante wird gesucht, nicht gesetzt: Wie weit die Rundung
    # des Grundbildes hereinreicht, haengt am Motiv -- ein fester Wert waere
    # beim naechsten Bild wieder falsch. Der kleinste Abstand gewinnt, bei dem
    # nichts mehr uebersteht; so bleibt das Abzeichen so weit aussen wie
    # moeglich. Der Suchbereich geht bis 20 %, weil die Rundung weit
    # hereinreicht: Auf der Diagonalen ist schon bei 90 % der Kante nichts mehr.
    for anteil in (0.055, 0.07, 0.085, 0.10, 0.115, 0.13, 0.15, 0.17, 0.20):
        x = y = kante - gross - int(kante * anteil)
        if _ueberstand(bild, x, y, gross) == 0:
            break
    else:
        raise SystemExit(
            f"Bei {kante} px sitzt das Abzeichen selbst mit 20 % Abstand nicht "
            "vollstaendig auf dem Motiv -- Groesse verringern."
        )

    # Schatten darunter, sonst klebt das Abzeichen flach auf dem Motiv.
    schatten = Image.new("RGBA", bild.size, (0, 0, 0, 0))
    rund = Image.new("RGBA", (gross, gross), (0, 0, 0, 0))
    ImageDraw.Draw(rund).ellipse([0, 0, gross - 1, gross - 1], fill=(0, 0, 0, 150))
    schatten.paste(rund, (x, y + max(1, int(kante * 0.012))), rund)
    schatten = schatten.filter(ImageFilter.GaussianBlur(max(1, kante * 0.012)))

    bild = Image.alpha_composite(bild, schatten)
    bild.paste(marke, (x, y), marke)
    return bild


def basis_holen(pfad: Path | None) -> Image.Image:
    """Das Hub-Icon: aus der Arbeitskopie, sonst aus dem GitLab."""
    quelle = pfad or (BASIS_DATEI if BASIS_DATEI.exists() else None)
    if quelle:
        return Image.open(quelle).convert("RGBA")
    try:
        with urllib.request.urlopen(BASIS_URL, timeout=20) as antwort:
            return Image.open(io.BytesIO(antwort.read())).convert("RGBA")
    except (urllib.error.URLError, TimeoutError, OSError) as fehler:
        sys.exit(f"Grundbild nicht erreichbar ({fehler}).\n  {BASIS_URL}")


def avatar_schreiben(basis, ziel: Path, farbe, zeichnen) -> None:
    """Groesste Kantenlaenge, die unter der Instanz-Grenze bleibt."""
    for kante in AVATAR_KANTEN:
        zusammensetzen(basis, kante, farbe, zeichnen).save(
            ziel, "PNG", optimize=True, compress_level=9
        )
        groesse = ziel.stat().st_size
        if groesse < AVATAR_GRENZE:
            print(
                f"  {'avatar.png':16} {kante}x{kante}  {groesse / 1024:6.1f} KiB  "
                f"({(AVATAR_GRENZE - groesse) / 1024:.0f} KiB Luft)"
            )
            return
    sys.exit(
        f"Selbst {AVATAR_KANTEN[-1]} px bleiben nicht unter "
        f"{AVATAR_GRENZE // 1024} KiB -- das Grundbild ist zu detailreich."
    )


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("anbieter", nargs="*", choices=sorted(ANBIETER) or None,
                   help="Standard: alle sechs")
    p.add_argument("--basis", type=Path, help="Grundbild lokal statt aus dem GitLab")
    p.add_argument("--ziel", type=Path, default=WURZEL.parent,
                   help="Ordner mit den Anbieter-Arbeitskopien (Standard: neben dem Hub)")
    args = p.parse_args()

    basis = basis_holen(args.basis)
    if basis.size[0] != basis.size[1]:
        sys.exit(f"Grundbild ist nicht quadratisch: {basis.size}")

    fehlend = []
    for name in (args.anbieter or sorted(ANBIETER)):
        farbe, zeichnen = ANBIETER[name]
        repo = args.ziel / f"ha-spatial-{name}"
        if not repo.is_dir():
            fehlend.append(repo)
            continue

        marke = repo / "custom_components" / f"spatial_{name}" / "brand"
        marke.mkdir(parents=True, exist_ok=True)
        print(f"{name}:")
        for datei, kante in (("icon.png", 256), ("icon@2x.png", 512),
                             ("logo.png", 256), ("logo@2x.png", 512)):
            ziel = marke / datei
            zusammensetzen(basis, kante, farbe, zeichnen).save(
                ziel, "PNG", optimize=True, compress_level=9
            )
            print(f"  {datei:16} {kante}x{kante}  {ziel.stat().st_size / 1024:6.1f} KiB")
        avatar_schreiben(basis, repo / "avatar.png", farbe, zeichnen)

    if fehlend:
        print("\nNicht ausgecheckt, uebersprungen:")
        for r in fehlend:
            print(f"  {r}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
