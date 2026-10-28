"""Iron Dreadnought (Schlachtschiff), Referenzschiff des Clean-Toon-Stils.

Breiter, kantiger Keilrumpf mit zwei Lagen Panzerschürzen und Dorsaldeck, ohne Plattenfugen. Drei große Zwillingstürme
in Stahlblau (vorn, überhöht, seitlich), zwei schwere Belagerungskanonen am Bug mit magenta Mündung, ein Aufbau aus drei
Blöcken mit schräger Front und Fensterband, ein Mast mit Licht, Kasematten mit Lichtband, Schildemitter als Kuppeln am
Deckrand, Kiel und vier Heckdüsen. Etwa 6,5k Dreiecke (das alte Modell hatte 36,5k).
"""

import palette
import vf
from parts import engine, turret
from vf import Ship, box, keel, loft, octagon, plate, post, rbox, sec, sphere, tube, wedge


def build():
    s = Ship("iron_dreadnought")
    m = vf.materials(s.name, "battleship")
    m["shield"] = vf.light(f"{s.name}_shield", palette.SHIELD)
    # Breiter, kantiger Keilrumpf
    s.add(loft([
        sec(-4.0, keel(0.6, 0.5)),
        sec(-2.8, keel(1.8, 0.9)),
        sec(-1.2, keel(3.6, 1.3)),
        sec(0.6, keel(4.4, 1.4)),
        sec(2.4, keel(3.8, 1.3)),
        sec(3.4, keel(2.6, 1.0)),
    ]), m["hull"], at=(0, 0, 0.1))
    # Panzerschürzen in zwei Lagen
    s.add(plate([(0.6, -3.0), (2.3, -1.0), (2.6, 1.0), (2.2, 2.9), (0.6, 2.9)], 0.24, "xy"), m["armor"], at=(0, 0, 0.3), mirror=True)
    s.add(plate([(0.8, -2.2), (2.5, -0.4), (2.5, 1.6), (0.8, 2.4)], 0.22, "xy"), m["hull"], at=(0, 0, -0.2), mirror=True)
    # Dorsaldeck und Deckplatte
    s.add(loft([sec(-3.0, octagon(0.6, 0.3)), sec(-2.2, octagon(1.8, 0.5)), sec(2.6, octagon(2.2, 0.55)), sec(3.2, octagon(1.4, 0.4))]),
          m["hull"], at=(0, 0, 0.95))
    s.add(plate([(-0.85, -2.1), (0.85, -2.1), (1.05, 2.4), (-1.05, 2.4)], 0.05, "xy"), m["hull"], at=(0, 0, 1.24))
    # Drei große Zwillingstürme: vorn, überhöht auf einer Barbette, seitlich
    turret(s, m, (0, -1.85, 1.265))
    s.add(post(24, 0.56, 0.54, 1.265, 1.6), m["hull_round"], at=(0, -0.3, 0))
    turret(s, m, (0, -0.3, 1.6))
    turret(s, m, (1.45, 0.95, 0.86), r=0.46, barrel=1.2, mirror=True)
    # Aufbau: drei Blöcke mit schräger Front, Fensterband an der Brücke, Mast mit Licht
    z = 1.265
    for w, l, h, y in ((1.7, 1.5, 0.5, 2.0), (1.25, 1.1, 0.45, 2.05), (0.92, 0.75, 0.4, 2.0)):
        s.add(wedge(w, l, h), m["hull"], at=(0, y, z + h / 2))
        z += h
    s.add(box(0.8, 0.04, 0.09), m["window"], at=(0, 2.0 - 0.75 / 2 + 0.12, z - 0.17))
    s.add(box(0.04, 0.5, 0.09), m["window"], at=(0.465, 2.05, z - 0.17), mirror=True)
    s.add(post(10, 0.09, 0.06, z, z + 0.95), m["hull_round"], at=(0, 2.15, 0))
    s.add(sphere(0.08, 1), m["glow"], at=(0, 2.15, z + 0.99))
    # Seitliche Kasematten mit kaltem Lichtband
    s.add(box(0.7, 1.6, 0.5), m["armor"], at=(2.1, 0.6, 0.35), mirror=True)
    s.add(box(0.04, 1.2, 0.08), m["glow"], at=(2.46, 0.6, 0.42), mirror=True)
    # Belagerungskanonen am Bug: Verschluss, ein Kühlmantel, Lauf, Mündungsbremse mit magenta Kern
    cx, cz = 0.52, 0.36
    s.add(rbox(0.62, 1.0, 0.62, 0.06, 1), m["dark"], at=(cx, -2.35, cz), mirror=True)
    s.add(tube(18, 0.24, 0.21, -4.6, -2.7), m["steel"], at=(cx, 0, cz), mirror=True)
    s.add(tube(18, 0.3, 0.3, -3.35, -2.8), m["dark_round"], at=(cx, 0, cz), mirror=True)
    s.add(tube(18, 0.31, 0.31, -4.9, -4.5), m["dark_round"], at=(cx, 0, cz), mirror=True)
    s.add(tube(18, 0.15, 0.15, -4.94, -4.88), m["shield"], at=(cx, 0, cz), mirror=True)
    # Schildemitter (magenta): Leiste am Deck, zwei Kuppeln je Seite am Deckrand, Bugemitter
    s.add(box(0.08, 1.6, 0.1), m["shield"], at=(1.0, -1.3, 1.02), mirror=True)
    for y in (-2.25, 0.05):
        s.add(post(16, 0.17, 0.15, 0.0, 0.12), m["dark_round"], at=(0.98, y, 1.06), mirror=True)
        s.add(sphere(0.13, 2), m["shield"], at=(0.98, y, 1.2), mirror=True)
    s.add(box(0.5, 0.06, 0.18), m["shield"], at=(0, -3.72, 0.5))
    # Kiel und vier Heckdüsen
    s.add(plate([(-2.0, 0.0), (2.8, 0.0), (2.9, -0.4), (-1.0, -0.35)], 0.12, "yz"), m["dark"], at=(0, 0, -0.5))
    for dz in (0.45, -0.25):
        engine(s, m, 0.32, 3.3, 4.0, dx=0.6, dz=dz, mirror=True)
    return s.finish()
