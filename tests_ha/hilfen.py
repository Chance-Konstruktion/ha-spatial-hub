"""Kleine Helfer fuer die Tests gegen ein echtes Home Assistant.

Bewusst neben der conftest.py und nicht darin: eine conftest wird von
pytest selbst geladen und ist kein normales Modul, das man importieren
sollte. ``pythonpath`` in pytest-ha.ini nimmt diesen Ordner auf, deshalb
genuegt hier ein glatter Import.
"""

from __future__ import annotations

from typing import Any, Callable

from homeassistant.core import HomeAssistant


def anbieter_anmelden(
    hass: HomeAssistant, anbieter_id: str, daten: Callable[[], Any]
) -> None:
    """Einen Anbieter ueber genau den Vertrag anmelden, den Fremde nutzen.

    Kein Import aus dem Hub, kein Zugriff auf interne Objekte -- ein Dict
    in ``hass.data``. Das ist die ganze Kopplung, und sie ist mit Absicht
    so duenn: ein Anbieter, der sich anmeldet, waehrend der Hub gar nicht
    installiert ist, hinterlaesst nur ein Dict, das niemand liest.

    Deshalb steht hier auch bewusst die nackte Zeichenkette
    ``spatial_hub_providers`` und nicht ``DATA_PROVIDERS``: sechs fremde
    Integrationen haben sie abgeschrieben. Wird sie im Hub geaendert,
    brechen alle sechs -- und dieser Test faellt um, statt gruen zu
    bleiben, weil er die Konstante mitgezogen haette.
    """
    hass.data.setdefault("spatial_hub_providers", {})[anbieter_id] = {
        "provider_id": anbieter_id,
        "api_version": 1,
        "sdk_version": 4,
        "name": anbieter_id.title(),
        "icon": "mdi:test-tube",
        "data": daten,
    }
