"""Vanguard (Flaggschiff von Admiralin Vance, „der Hammer“), Neubau im Clean-Toon-Stil.

Schlanker, kantiger Kreuzer, der nach vorn drängt: Keilrumpf mit Rückgrat, goldener Zierlinie und Fensterband, davor
der Rammbug als Speerspitze mit leuchtenden Schneiden und Panzerlage in Karmin, darunter zwei schwere Bugkanonen. An den
Flanken gepfeilte Panzerklingen in Karmin, auf dem Rückgrat die Wappenplatte mit Vances Pfeilspitze und zwei Türme (der
hintere überhöht), achtern eine nach hinten gestaffelte Brücke mit Fensterband und Mast, am Heck ein Düsencluster aus
einer großen und vier kleinen Düsen. Etwa 5k Dreiecke (das alte Modell hatte 10,4k).
"""

import vf
from parts import badge, engine, sym, trim_line, turret
from vf import Ship, box, hexagon, keel, loft, octagon, plate, post, rbox, sec, sphere, tip, tube, wedge


# Abzeichen von Admiralin Vance wie auf ihrer Uniform: Pfeilspitze mit Schaft und Fiederung, zeigt zum Bug
PLATE = sym([(0.0, -0.85), (0.58, -0.3), (0.58, 0.52), (0.0, 0.82)])
ARROW = sym([(0.0, -0.66), (0.4, -0.18), (0.13, -0.18), (0.13, 0.19), (0.36, 0.38), (0.36, 0.56), (0.0, 0.26)])


def build():
    s = Ship("vanguard")
    m = vf.materials(s.name, "cruiser")

    # Kantiger Keilrumpf mit Rückgrat
    hull = [(-2.4, 1.8, 1.0), (-1.2, 2.4, 1.3), (2.9, 2.5, 1.35), (3.9, 2.0, 1.1)]
    s.add(loft([sec(y, keel(w, h)) for y, w, h in hull]), m["hull"])
    spine = 0.8
    s.add(loft([sec(-3.5, octagon(1.1, 0.34), dz=-0.14), sec(-3.1, octagon(1.75, 0.5)), sec(3.0, octagon(1.75, 0.6)), sec(3.6, octagon(1.1, 0.4))]),
          m["hull"], at=(0, 0, spine))
    trim_line(s, m, [(w / 2 + 0.01, y, h / 2 + 0.005) for y, w, h in hull])
    s.add(box(0.04, 3.6, 0.08), m["window"], at=(0.885, 0.3, spine), mirror=True)

    # Rammbug als Speerspitze: Klinge mit scharfen Seitenkanten, Panzerlage in Karmin, leuchtende Schneiden
    ram = [(-4.7, 0.95, 0.42, -0.05), (-3.5, 2.05, 0.85, 0.0), (-2.6, 1.55, 0.95, 0.05), (-1.6, 1.6, 1.0, 0.08)]
    s.add(loft([tip(-5.65, dz=-0.1)] + [sec(y, hexagon(w, h), dz=dz) for y, w, h, dz in ram]), m["hull"])
    armor = [(-4.5, 0.7, 0.3, 0.12), (-3.5, 1.55, 0.55, 0.25), (-2.5, 1.15, 0.6, 0.32), (-1.7, 1.15, 0.6, 0.34)]
    s.add(loft([tip(-5.2, dz=0.05)] + [sec(y, hexagon(w, h), dz=dz) for y, w, h, dz in armor]), m["accent"])
    edge = [(0.0, -5.67, -0.1)] + [(w / 2 + 0.01, y, dz) for y, w, h, dz in ram[:3]]
    s.add(vf.sweep(edge, vf.rect(0.06, 0.1)), m["glow"], mirror=True)

    # Zwei schwere Bugkanonen unter dem Rammbug: Verschluss, Lauf, Kühlmantel, Mündungsbremse mit glühendem Kern
    gx, gz = 0.78, -0.62
    s.add(rbox(0.62, 1.7, 0.6, 0.06, 1), m["dark"], at=(gx, -1.9, gz), mirror=True)
    s.add(tube(18, 0.21, 0.19, -4.75, -2.6), m["steel"], at=(gx, 0, gz), mirror=True)
    s.add(tube(18, 0.27, 0.27, -3.35, -2.75), m["dark_round"], at=(gx, 0, gz), mirror=True)
    s.add(tube(18, 0.28, 0.28, -5.0, -4.6), m["dark_round"], at=(gx, 0, gz), mirror=True)
    s.add(tube(18, 0.14, 0.14, -5.04, -4.98), m["glow"], at=(gx, 0, gz), mirror=True)

    # Gepfeilte Panzerklingen in zwei Lagen
    s.add(plate([(1.0, -1.7), (1.6, -0.7), (2.2, 2.4), (2.2, 3.9), (1.7, 3.3), (1.0, 2.9)], 0.22, "xy"), m["accent"], at=(0, 0, 0.2), mirror=True)
    s.add(plate([(0.7, -0.9), (1.35, -0.1), (1.85, 2.7), (1.8, 3.5), (0.7, 3.1)], 0.18, "xy"), m["hull"], at=(0, 0, -0.2), mirror=True)

    # Zwei Türme auf dem Rückgrat, der hintere überhöht auf einer Barbette
    top = spine + 0.25
    turret(s, m, (0, 0.15, top), r=0.46, barrel=1.15)
    s.add(post(24, 0.54, 0.52, top, top + 0.34), m["hull_round"], at=(0, 1.35, 0))
    turret(s, m, (0, 1.35, top + 0.34), r=0.46, barrel=1.35)

    # Wappenplatte vor den Türmen
    badge(s, m, (0, -2.1, top), PLATE, ARROW)

    # Nach achtern gestaffelte Brücke mit Fensterband, Mast mit Licht
    z = top
    for w, l, h, y in ((1.6, 1.5, 0.5, 2.65), (1.25, 1.15, 0.45, 2.93), (0.95, 0.85, 0.4, 3.2)):
        s.add(wedge(w, l, h), m["hull"], at=(0, y, z + h / 2))
        z += h
    s.add(box(0.8, 0.04, 0.09), m["window"], at=(0, 3.2 - 0.425 + 0.11, z - 0.16))
    s.add(box(0.04, 0.5, 0.09), m["window"], at=(0.485, 3.25, z - 0.16), mirror=True)
    s.add(post(10, 0.09, 0.06, z, z + 0.6), m["hull_round"], at=(0, 3.35, 0))
    s.add(sphere(0.08, 1), m["glow"], at=(0, 3.35, z + 0.64))

    # Düsencluster: Gehäuse, eine große und vier kleine Düsen
    s.add(rbox(2.6, 0.8, 1.55, 0.08, 1), m["dark"], at=(0, 3.95, 0.0))
    s.add(box(0.04, 0.66, 0.12), m["signal"], at=(1.3, 3.95, 0.3), mirror=True)
    engine(s, m, 0.58, 4.0, 5.15)
    engine(s, m, 0.38, 4.0, 4.95, dx=0.85, dz=0.45, mirror=True)
    engine(s, m, 0.38, 4.0, 4.95, dx=0.85, dz=-0.45, mirror=True)

    # Kiel
    s.add(plate([(-1.4, -0.5), (3.4, -0.5), (3.6, -1.05), (-0.4, -0.95)], 0.14, "yz"), m["dark"])
    return s.finish()
