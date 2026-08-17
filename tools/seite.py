"""Baut aus den Markdown-Dateien des Repos eine statische Webseite.

Die Dokumentation ist der groesste Teil dieses Projekts, und sie war
bisher nur lesbar, wenn man sich durch GitLab klickt. Pages laeuft, also
kann sie eine Adresse bekommen.

Bewusst klein gehalten: eine Abhaengigkeit (`markdown`), kein Generator,
kein Theme, keine Konfigurationsdatei. Was hier passiert, passt in einen
Kopf -- und das ist bei einem Werkzeug, das niemand pflegt, mehr wert als
jedes Merkmal.

    python tools/seite.py public

Die eigentliche Arbeit sind die Verweise. Im Repo zeigen sie auf
`docs/PROVIDERS.md`; auf der Webseite muessen sie auf `PROVIDERS.html`
zeigen. Genau da bricht so etwas still: Die Seite wird gebaut, sieht
richtig aus, und jeder dritte Verweis fuehrt ins Leere.
`tests/test_seite.py` prueft deshalb jeden erzeugten Verweis.
"""

from __future__ import annotations

import html
import re
import shutil
import sys
from pathlib import Path

WURZEL = Path(__file__).resolve().parents[1]
REPO = "https://gitlab.schanz.ipv64.net/chance-konstruktion/ha-spatial-hub"

# Quelle -> Zieldatei. Die Reihenfolge ist die der Navigation.
SEITEN: list[tuple[str, str, str]] = [
    ("README.md", "index.html", "Start"),
    ("docs/SPECIFICATION.md", "SPECIFICATION.html", "Spezifikation"),
    ("docs/PROVIDER_API.md", "PROVIDER_API.html", "Provider-API"),
    ("docs/PROVIDERS.md", "PROVIDERS.html", "Provider"),
    ("docs/RENDERERS.md", "RENDERERS.html", "Renderer"),
    ("sdk/README.md", "sdk.html", "SDK"),
    ("docs/Vision.md", "Vision.html", "Vision"),
    ("ROADMAP.md", "ROADMAP.html", "Fahrplan"),
    ("CONTRIBUTING.md", "CONTRIBUTING.html", "Mitmachen"),
    ("docs/ASK_FOR_SUPPORT.de.md", "ASK_FOR_SUPPORT.de.html", "Anfrage (de)"),
    ("docs/ASK_FOR_SUPPORT.en.md", "ASK_FOR_SUPPORT.en.html", "Anfrage (en)"),
]

STIL = """
:root { --grund:#fff; --schrift:#1a1a1a; --leise:#666; --linie:#e2e2e2;
        --akzent:#0366d6; --kasten:#f6f8fa; }
@media (prefers-color-scheme: dark) {
  :root { --grund:#0d1117; --schrift:#e6edf3; --leise:#9aa4ae;
          --linie:#30363d; --akzent:#58a6ff; --kasten:#161b22; }
}
* { box-sizing: border-box; }
body { margin:0; background:var(--grund); color:var(--schrift);
       font:16px/1.65 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif; }
nav { border-bottom:1px solid var(--linie); background:var(--kasten);
      padding:.7rem 1rem; display:flex; flex-wrap:wrap; gap:.25rem 1rem; }
nav a { color:var(--leise); text-decoration:none; font-size:.9rem; }
nav a:hover, nav a[aria-current] { color:var(--akzent); }
nav a[aria-current] { font-weight:600; }
main { max-width:52rem; margin:0 auto; padding:1.5rem 1rem 5rem; }
h1,h2,h3 { line-height:1.25; margin:2rem 0 .6rem; }
h1 { font-size:1.9rem; } h2 { font-size:1.4rem; } h3 { font-size:1.15rem; }
h2 { border-bottom:1px solid var(--linie); padding-bottom:.3rem; }
a { color:var(--akzent); }
code { background:var(--kasten); padding:.15em .35em; border-radius:4px;
       font-size:.9em; }
pre { background:var(--kasten); padding:.9rem 1rem; border-radius:6px;
      overflow-x:auto; border:1px solid var(--linie); }
pre code { background:none; padding:0; }
blockquote { margin:1rem 0; padding:.2rem 1rem; border-left:3px solid var(--linie);
             color:var(--leise); }
table { border-collapse:collapse; width:100%; display:block; overflow-x:auto; }
th,td { border:1px solid var(--linie); padding:.45rem .6rem; text-align:left;
        vertical-align:top; }
th { background:var(--kasten); }
img { max-width:100%; }
footer { max-width:52rem; margin:0 auto; padding:0 1rem 3rem;
         color:var(--leise); font-size:.85rem; border-top:1px solid var(--linie);
         padding-top:1rem; }
"""

RAHMEN = """<!doctype html>
<html lang="de"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>{titel} — Spatial Hub</title>
<style>{stil}</style></head><body>
<nav>{navigation}</nav>
<main>{inhalt}</main>
<footer>Erzeugt aus dem Repository — <a href="{repo}">Quelltext auf GitLab</a>.
Diese Seiten sind eine Kopie der Markdown-Dateien; im Zweifel gilt das
Repository.</footer>
</body></html>
"""


def navigation(aktuell: str) -> str:
    return "".join(
        '<a href="%s"%s>%s</a>' % (ziel, ' aria-current="page"' if ziel == aktuell else "", html.escape(name))
        for _quelle, ziel, name in SEITEN
    )


def verweise_umschreiben(text: str, quelle: str) -> str:
    """Macht aus `docs/PROVIDERS.md` das Ziel `PROVIDERS.html`.

    Was nicht auf dieser Webseite liegt -- Beispiele, einzelne Quelldateien
    -- zeigt auf das Repository statt ins Leere. Ein toter Verweis waere
    hier besonders aergerlich: Die Seite existiert ja, sie fuehrt nur
    nirgendwohin.
    """
    bekannt = {q: z for q, z, _ in SEITEN}
    ordner = Path(quelle).parent

    def ersetzen(treffer: re.Match) -> str:
        ziel, anker = treffer.group(1), treffer.group(2) or ""
        if ziel.startswith(("http://", "https://", "#", "mailto:")):
            return treffer.group(0)
        pfad = str((ordner / ziel).resolve().relative_to(WURZEL)).replace("\\", "/")
        if pfad in bekannt:
            return "](%s%s)" % (bekannt[pfad], anker)
        return "](%s/-/blob/main/%s%s)" % (REPO, pfad, anker)

    return re.sub(r"\]\(([^)#\s]+)(#[^)\s]*)?\)", ersetzen, text)


def bauen(ziel_ordner: Path) -> list[Path]:
    import markdown

    if ziel_ordner.exists():
        shutil.rmtree(ziel_ordner)
    ziel_ordner.mkdir(parents=True)

    gebaut = []
    for quelle, ziel, name in SEITEN:
        pfad = WURZEL / quelle
        if not pfad.is_file():
            raise SystemExit(
                "%s fehlt -- die Seitenliste in tools/seite.py nennt eine "
                "Datei, die es nicht gibt" % quelle)
        text = verweise_umschreiben(pfad.read_text(encoding="utf-8"), quelle)
        inhalt = markdown.markdown(
            text, extensions=["tables", "fenced_code", "sane_lists", "attr_list"])
        seite = RAHMEN.format(titel=html.escape(name), stil=STIL,
                              navigation=navigation(ziel), inhalt=inhalt,
                              repo=REPO)
        (ziel_ordner / ziel).write_text(seite, encoding="utf-8")
        gebaut.append(ziel_ordner / ziel)
    return gebaut


if __name__ == "__main__":
    ordner = Path(sys.argv[1] if len(sys.argv) > 1 else "public")
    dateien = bauen(ordner)
    print("%d Seiten nach %s" % (len(dateien), ordner))
