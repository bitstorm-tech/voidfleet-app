"""Scrap Raider (Jäger) im Clean-Toon-Stil, bewusst asymmetrisch.

Kantiger Rumpf in warmem Schrottgrau mit stumpfem Bug, davor ein dunkler Rammbalken mit schwerem Stahlsporn,
Glaskanzel nach steuerbord versetzt, backbord eine schwere Kanonengondel in Koralle mit langem Lauf, steuerbord ein
Stummelflügel aus Rostblech mit Stachel, eine schiefe Rückenflosse, ein nach steuerbord versetzter Kiel, drei ungleiche
Düsen (die größte als Buckel obenauf) und drei große Rostflicken. Der Schrottlook kommt aus Form und Farbe, nicht aus
Kleinteilen.
"""

import palette
import vf
from parts import engine
from vf import Ship, box, hexagon, loft, octagon, plate, rbox, sec, smooth, superellipse, tube, wedge


def patch(w, l, cut=0.18):
    """Aufgeschweißtes Blech (w × l, 0,06 dick) mit einer schräg abgeschnittenen Ecke, damit es nicht wie eine Luke wirkt."""
    return plate([(-w / 2, -l / 2), (w / 2, -l / 2), (w / 2, l / 2 - cut), (w / 2 - cut, l / 2), (-w / 2, l / 2)], 0.06, "xy")


def build():
    s = Ship("scrap_raider")
    m = vf.materials(s.name, "fighter")
    m["hull"] = vf.toon(f"{s.name}_hull", palette.SCRAP_HULL)  # Schrottgrau statt des Blaugraus der Klasse
    m["steel_flat"] = vf.toon(f"{s.name}_steel_flat", palette.STEEL)
    # Rost als rundes Material: flache Bleche bleiben flach (alle Kanten über 38°), bekommen aber nur das schmale
    # Kantenlicht; das breite der eckigen Materialien färbt sie auf dem Brett grau
    m["rust"] = vf.toon(f"{s.name}_rust", palette.RUST, round=True)
    # Kantiger Rumpf, vorn stumpf
    s.add(loft([
        sec(-2.8, octagon(0.46, 0.46), dz=-0.04),
        sec(-2.2, octagon(0.86, 0.66)),
        sec(-1.1, octagon(1.32, 0.86)),
        sec(0.8, octagon(1.42, 0.9)),
        sec(2.1, octagon(1.18, 0.76)),
        sec(2.45, octagon(0.98, 0.62)),
    ]), m["hull"])
    # Rammsporn: dunkler Rammbalken vor dem Bug, darin ein breiter Stahlkeil, der in eine waagrechte Schneide ausläuft
    s.add(rbox(0.8, 0.2, 0.58, 0.05, 1), m["dark"], at=(0, -2.8, -0.06))
    s.add(loft([sec(-2.6, hexagon(0.7, 0.42), dz=-0.08), sec(-3.8, hexagon(0.24, 0.07), dz=-0.13)]), m["steel_flat"])
    # Kanzel steuerbord
    s.add(loft(smooth([
        sec(-2.25, superellipse(0.14, 0.08, 16), dz=0.3),
        sec(-1.85, superellipse(0.38, 0.3, 16), dz=0.4),
        sec(-1.25, superellipse(0.42, 0.36, 16), dz=0.44),
        sec(-0.7, superellipse(0.3, 0.16, 16), dz=0.45),
    ], 2)), m["glass"], at=(0.27, 0, 0))
    # Backbord: schwere Kanonengondel in Koralle mit Lichtband, Verschluss, Lauf mit Kühlmantel und Mündungsbremse
    px, pz = -0.92, -0.1
    s.add(loft(smooth([
        sec(-1.35, superellipse(0.62, 0.6, 16, 3)),
        sec(-0.95, superellipse(0.68, 0.66, 16, 3)),
        sec(1.25, superellipse(0.68, 0.66, 16, 3)),
    ], 1)), m["accent_round"], at=(px, 0, pz))
    s.add(loft([sec(1.2, superellipse(0.64, 0.62, 16, 3)), sec(1.85, superellipse(0.44, 0.42, 16, 3))]), m["dark_round"], at=(px, 0, pz))
    s.add(box(0.05, 1.2, 0.09), m["glow"], at=(px - 0.335, 0.0, pz))
    s.add(rbox(0.5, 0.56, 0.5, 0.06, 1), m["dark"], at=(px, -1.55, pz))
    s.add(tube(16, 0.14, 0.12, -1.8, -3.35), m["steel"], at=(px, 0, pz))
    s.add(tube(16, 0.21, 0.21, -2.1, -2.7), m["dark_round"], at=(px, 0, pz))
    s.add(tube(16, 0.22, 0.22, -3.3, -3.62), m["dark_round"], at=(px, 0, pz))
    s.add(tube(12, 0.11, 0.11, -3.62, -3.66), m["glow"], at=(px, 0, pz))
    # Steuerbord: Stummelflügel aus Rostblech auf Deckhöhe, leicht angestellt, mit Stachel an der Spitze
    s.add(plate([(0.5, -0.7), (1.55, -0.25), (1.66, 1.1), (0.5, 1.3)], 0.16, "xy"), m["rust"], at=(0, 0, 0.2), rot=(0, -6, 0))
    s.add(tube(12, 0.11, 0.0, -0.2, -1.25), m["steel"], at=(1.5, 0, 0.36))
    # Schiefe Rückenflosse, nach steuerbord geneigt
    s.add(plate([(-0.6, -0.12), (0.85, -0.12), (0.75, 0.82), (0.05, 0.94)], 0.12, "yz"), m["hull"], at=(-0.25, 0, 0.42), rot=(0, 15, 0))
    # Rostflicken: Deck backbord vorn, obere Kante backbord über der Gondel, Bauch
    s.add(patch(0.36, 0.8), m["rust"], at=(-0.26, -1.55, 0.415), rot=(-5, 0, 174))
    s.add(patch(0.26, 1.2, 0.14), m["rust"], at=(-0.61, 0.55, 0.405), rot=(2, -33, 0))
    s.add(patch(0.6, 1.1, 0.24), m["rust"], at=(-0.27, 0.35, -0.45), rot=(0, 2, -6))
    # Dunkler Kiel, aus der Mitte nach steuerbord versetzt
    s.add(plate([(-2.1, 0.02), (1.5, 0.02), (1.3, -0.26), (-1.5, -0.3)], 0.16, "yz"), m["dark"], at=(0.25, 0, -0.42))
    # Drei ungleiche Düsen: die größte als Buckel obenauf auf einem kantigen Sockel, eine mittlere backbord unten und eine
    # kleine steuerbord, die unter dem Rumpf hängt und am weitesten hinausragt, damit sie von backbord zu sehen ist
    s.add(wedge(0.6, 1.1, 0.34, front=0.6), m["hull"], at=(0.06, 1.5, 0.5))
    engine(s, m, 0.34, 1.9, 2.75, dx=0.06, dz=0.3)
    engine(s, m, 0.27, 2.0, 2.55, dx=-0.42, dz=-0.24)
    engine(s, m, 0.2, 2.05, 2.88, dx=0.4, dz=-0.4)
    return s.finish()
