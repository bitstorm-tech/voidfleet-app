"""Horizon Cruiser (Kreuzer), Neubau im Clean-Toon-Stil.

Langer, schlanker Facettenrumpf, der zum Bug flach ausläuft; darauf ein großer Zwillingsturm in Kornblumenblau und ein
Rückendeck mit dem Brückenturm achtern (drei Blöcke, Fensterband, Mast mit Licht). Zwei runde Gondeln an gepfeilten
Pylonen mit blauem Lichtband und Akzent-Einlauf, zwei schräge Heckflossen, dunkler Kiel, vier Düsen. Etwa 4k Dreiecke
(das alte Modell hatte 9,4k).
"""

import vf
from parts import engine, turret
from vf import Ship, box, loft, ngon, octagon, plate, post, sec, smooth, sphere, wedge

NX = 1.18  # Gondeln: Abstand zur Mittelachse
NZ = 0.02  # Gondeln: Höhe der Achse


def hull(w, h):
    """Rumpfprofil: flaches Deck, obere Fase, senkrechte Flanke, steile untere Fase (fängt in der Karte Licht),
    schmaler Boden."""
    return [(w / 2, -0.05 * h), (w / 2, 0.3 * h), (0.33 * w, h / 2), (-0.33 * w, h / 2), (-w / 2, 0.3 * h), (-w / 2, -0.05 * h),
            (-0.22 * w, -h / 2), (0.22 * w, -h / 2)]


def build():
    s = Ship("horizon_cruiser")
    m = vf.materials(s.name, "cruiser")
    # Langer Facettenrumpf, vorn flach wie ein Spatel
    s.add(loft([
        sec(-3.85, hull(0.5, 0.1)),
        sec(-3.0, hull(1.0, 0.32), dz=0.06),
        sec(-2.45, hull(1.2, 0.5), dz=0.05),
        sec(-1.5, hull(1.45, 0.72)),
        sec(-0.4, hull(1.56, 0.8)),
        sec(1.7, hull(1.56, 0.8)),
        sec(2.9, hull(1.3, 0.7)),
        sec(3.4, hull(1.0, 0.56)),
    ]), m["hull"])
    # Rückendeck vom Turm bis achtern
    s.add(loft([sec(-1.45, octagon(0.4, 0.2), dz=-0.05), sec(-0.9, octagon(0.82, 0.36)), sec(2.5, octagon(0.86, 0.38)),
                sec(3.05, octagon(0.5, 0.26), dz=-0.04)]), m["armor"], at=(0, 0, 0.47))
    # Großer Zwillingsturm auf dem flachen Bug
    turret(s, m, (0, -2.05, 0.3), r=0.38, barrel=1.05)
    # Brückenturm achtern: drei Blöcke mit schräger Front, Fensterband, Mast mit Licht
    z = 0.65
    for w, l, h, y in ((0.98, 1.3, 0.42, 1.55), (0.74, 0.95, 0.36, 1.62), (0.52, 0.62, 0.3, 1.6)):
        s.add(wedge(w, l, h), m["hull"], at=(0, y, z + h / 2))
        z += h
    s.add(box(0.42, 0.04, 0.08), m["window"], at=(0, y - l / 2 + 0.1, z - 0.13))
    s.add(box(0.04, 0.34, 0.08), m["window"], at=(w / 2 + 0.01, y, z - 0.13), mirror=True)
    s.add(post(10, 0.08, 0.055, z, z + 0.8), m["hull_round"], at=(0, 1.72, 0))
    s.add(sphere(0.08, 1), m["glow"], at=(0, 1.72, z + 0.84))
    # Gondeln an gepfeilten Pylonen: Einlauf in Akzentfarbe, Lichtband außen, Düse
    s.add(plate([(0.55, -0.4), (NX, 0.0), (NX, 1.9), (0.55, 1.75)], 0.18, "xy"), m["hull"], at=(0, 0, NZ), mirror=True)
    s.add(loft(smooth([sec(-0.95, ngon(24, 0.2)), sec(-0.55, ngon(24, 0.29)), sec(1.6, ngon(24, 0.3)), sec(2.5, ngon(24, 0.27))], 1)),
          m["hull_round"], at=(NX, 0, NZ), mirror=True)
    s.add(loft([sec(-1.2, ngon(24, 0.27)), sec(-0.95, ngon(24, 0.31)), sec(-0.62, ngon(24, 0.32))]), m["accent_round"], at=(NX, 0, NZ), mirror=True)
    s.add(loft([sec(-1.22, ngon(24, 0.17)), sec(-1.0, ngon(24, 0.17))]), m["dark_round"], at=(NX, 0, NZ), mirror=True)
    s.add(box(0.05, 1.8, 0.08), m["glow"], at=(NX + 0.3, 0.55, NZ + 0.04), mirror=True)
    engine(s, m, 0.27, 2.35, 3.2, dx=NX, dz=NZ, mirror=True)
    # Heckflossen, schräg nach außen
    s.add(plate([(1.45, 0.0), (2.95, 0.0), (3.35, 0.9), (2.55, 0.94)], 0.1, "yz"), m["accent"], at=(0.4, 0, 0.3), rot=(0, 28, 0), mirror=True)
    # Kiel und zwei Hauptdüsen
    s.add(plate([(-2.5, 0.0), (2.6, 0.0), (2.85, -0.48), (0.5, -0.52), (-1.6, -0.36)], 0.16, "yz"), m["dark"], at=(0, 0, -0.3))
    engine(s, m, 0.24, 3.05, 3.8, dx=0.34, dz=-0.02, mirror=True)
    return s.finish()
