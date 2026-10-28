"""Die Schiffe von Voidfleet: je Karten-ID (shared/cards.ts) ein Modul `fleet/<id>.py` mit `build()`, das das fertige
Objekt liefert, auch für die Tokens (Drohne, Trugbild) und die Flaggschiffe der Admirale.

Wer ein Schiff neu baut, ändert nur dessen Modul; neue Helfer gehören zuerst dorthin (parts.py erst, wenn ein zweites
Schiff sie braucht). Stilregeln: STYLE.md. Module werden erst beim Bauen importiert, ein halbfertiges Modul stört die
anderen Schiffe also nicht.

Größen in Blender-Einheiten; auf dem Brett wirkt MODEL_SCALE × BOARD_SCALE aus ship.ts. Jäger ~6, Kreuzer ~6-7.5,
Schlachtschiffe ~8.5, Unterstützer ~5, Flaggschiffe 10-11 (die Mirage ~9) Einheiten lang.
"""

import importlib

IDS = ("void_interceptor", "scrap_raider", "horizon_cruiser", "plasma_frigate", "iron_dreadnought", "titan_carrier", "drone",
       "repair_drone", "signal_booster", "bastion", "vanguard", "hive", "mirage", "pendulum", "decoy")


def module(ship_id):
    return importlib.import_module(f"fleet.{ship_id}")


SHIPS = {ship_id: (lambda ship_id=ship_id: module(ship_id).build()) for ship_id in IDS}


def build(ship_id):
    """Baut das Schiff `ship_id` und liefert sein Objekt (in der Collection VF_Ships)."""
    return SHIPS[ship_id]()
