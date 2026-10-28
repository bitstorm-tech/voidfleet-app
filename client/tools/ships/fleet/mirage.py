"""Mirage (Flaggschiff von Admiral Moreau, „das Phantom“), Clean Toon.

Flacher, schmaler Tarnkappenrumpf aus ebenen Facetten mit scharfer Kimmkante in dunklen Tönen (`palette.PHANTOM`), darauf ein
noch dunkleres Rückengrat mit türkisen Nähten an seinem Fuß; die goldene Zierlinie läuft auf der Kimm und der Fuge zum
Flügel. Große Diamantflügel mit türkiser Platte oben und unten und Nahtkante, zwei schräge Projektorflossen mit
türkiser Platte, Nahtkante und leuchtender Projektorkante, eine helle Facettenkabine mit umlaufendem Fensterband und
Mast, dahinter die Wappenplatte: Goldrand und zwei längs versetzte, überlappende Rauten in Gold und Türkis (der
Phasentausch). Unten Kiel mit türkiser Platte, schräge Bauchflossen, türkise Nähte auf den Bodenkanten und kurze
Bugkanonen in den Flügelwurzeln, damit die Karte von schräg unten nicht leer ist; am Heck zwei Triebwerke.
"""

import palette
import vf
from parts import block, engine, stealth, trim_line
from vf import Ship, grow, loft, plate, post, sec, sphere, sweep, tip, tube

# Rumpfstationen (y, Breite an der Kimm, Höhe des Grats, Tiefe des Bodens)
STATIONS = [(-3.4, 0.9, 0.18, 0.12), (-1.8, 1.8, 0.32, 0.22), (0.2, 2.2, 0.38, 0.26), (2.4, 2.0, 0.36, 0.26),
            (3.6, 1.6, 0.3, 0.22), (4.15, 1.4, 0.26, 0.2)]
TOP = 0.36  # Anteil des flachen Grats an der Breite
LOW = 0.74  # Anteil des flachen Bodens an der Breite


def joint(y, w, up, z=0.08):
    """Punkt der Zierlinie auf der Fuge zwischen Rumpfflanke und Flügeloberseite (Höhe z) an der Station y."""
    return (w / 2 - (w / 2 - w * TOP / 2) * z / up + 0.01, y, z)


def seam(s, mat, points, w=0.06, h=0.05, mirror=True):
    """Naht oder Lichtband entlang einer Punktfolge (x, y, z)."""
    s.add(sweep(points, vf.rect(w, h)), mat, mirror=mirror)


def build():
    s = Ship("mirage")
    m = vf.materials(s.name, "fighter")
    m["phantom"] = vf.toon(f"{s.name}_phantom", palette.PHANTOM)

    # Rumpf: flacher Facettenpfeil, Kimmkante bei z = 0; goldene Zierlinie auf der Kimm, im Flügelbereich auf der Fuge
    s.add(loft([tip(-4.65, 0, 0.02)] + [sec(y, stealth(w, up, down, TOP, LOW)) for y, w, up, down in STATIONS]), m["phantom"])
    trim_line(s, m, [(0.0, -4.66, 0.02), (0.46, -3.4, 0.0), (0.66, -2.75, 0.0)] + [joint(y, w, up) for y, w, up, _ in STATIONS[1:4]]
              + [(0.84, 3.05, 0.0)] + [(w / 2 + 0.01, y, 0.0) for y, w, _, _ in STATIONS[4:]])
    # Rückengrat: dunklere, facettierte Lage auf dem Grat, türkise Nähte an ihrem Fuß
    spine = [(-3.9, 0.0, 0.12)] + [(y, w * TOP * 0.95, up) for y, w, up, _ in STATIONS[:5]]
    rings = [sec(y, [(hw / 2, up - 0.04), (hw * 0.3, up + 0.16), (-hw * 0.3, up + 0.16), (-hw / 2, up - 0.04)]) for y, hw, up in spine[1:]]
    s.add(loft([tip(spine[0][0], 0, spine[0][2])] + rings), m["dark"])
    seam(s, m["signal"], [(0.0, -3.92, 0.14)] + [(hw / 2 + 0.02, y, up + 0.01) for y, hw, up in spine[1:]])

    # Diamantflügel: Facettenplatte mit gefasten Kanten, türkise Platten oben und unten, Naht auf der Vorderkante
    wing = [(0.7, -2.7), (2.25, 0.95), (0.8, 2.95), (0.65, 2.95), (0.6, -2.7)]
    s.add(block(wing, [(-0.09, 0.08), (-0.04, 0.0), (0.03, 0.0), (0.08, 0.1)]), m["phantom"], mirror=True)
    panel = [(1.0, -1.3), (1.9, 0.8), (1.05, 2.25), (0.95, 2.25)]
    s.add(block(panel, [(0.06, 0.0), (0.11, 0.04)]), m["accent"], mirror=True)
    s.add(block(panel, [(-0.12, 0.04), (-0.07, 0.0)]), m["accent"], mirror=True)
    seam(s, m["signal"], [(0.72, -2.72, 0.0), (2.28, 0.95, 0.0)], 0.07, 0.08)

    # Projektorflossen: schräg nach außen, dunkler Rahmen, türkise Platte, leuchtende Projektorkante oben
    # Die Wurzel reicht 0,22 unter die Einbauhöhe, damit die Flosse auf der schrägen Rumpfflanke aufsitzt
    fin = [(0.98, -0.22), (3.75, -0.22), (4.1, 1.3), (3.3, 1.38)]
    g = Ship("mirage_fin")
    g.add(block(fin, [(-0.07, 0.05), (-0.03, 0.0), (0.03, 0.0), (0.07, 0.05)], "yz"), m["phantom"])
    g.add(block([(1.95, 0.22), (3.55, 0.22), (3.78, 1.05), (3.35, 1.1)], [(-0.085, 0.0), (0.085, 0.0)], "yz"), m["accent"])
    g.add(sweep([(0.0, 3.32, 1.38), (0.0, 4.1, 1.3)], vf.rect(0.1, 0.08)), m["glow"])
    g.add(sweep([(0.0, 1.1, -0.14), (0.0, 3.3, 1.36)], vf.rect(0.16, 0.06)), m["signal"])
    for side in (1, -1):
        s.place(g, at=(side * 0.66, 0, 0.3), rot=(0, side * 24, 0))
    g.bm.free()

    # Brücke: hellere Facettenkabine auf dem Rückengrat mit umlaufendem Fensterband und schrägem Dach, Mast mit Licht
    cabin = [(0.1, -1.75), (0.4, -0.95), (0.42, 0.3), (0.28, 0.65), (-0.28, 0.65), (-0.42, 0.3), (-0.4, -0.95), (-0.1, -1.75)]
    s.add(block(cabin, [(0.25, 0.0), (0.68, 0.0), (0.84, 0.16)]), m["hull"])
    band = [(x, y, 0.6) for x, y in grow(cabin, 0.012)]
    s.add(sweep(band + band[:2], vf.rect(0.04, 0.1)), m["window"])
    s.add(post(10, 0.09, 0.06, 0.8, 1.42), m["hull_round"], at=(0, 0.25, 0))
    s.add(sphere(0.09, 1), m["glow"], at=(0, 0.25, 1.47))

    # Wappenplatte hinter der Brücke: Raute mit Goldrand, darauf zwei längs versetzte, überlappende Rauten in Gold und
    # Türkis (der Phasentausch)
    y0 = 1.65
    diamond = [(0.0, -0.78), (0.44, 0.0), (0.0, 0.78), (-0.44, 0.0)]
    s.add(block(grow(diamond, 0.09), [(0.22, 0.0), (0.6, 0.0)]), m["trim"], at=(0, y0, 0))
    s.add(block(diamond, [(0.25, 0.0), (0.62, 0.0), (0.67, 0.05)]), m["dark"], at=(0, y0, 0))
    rhomb = [(0.0, -0.34), (0.24, 0.0), (0.0, 0.34), (-0.24, 0.0)]
    s.add(block(rhomb, [(0.6, 0.0), (0.75, 0.0)]), m["trim"], at=(0, y0 - 0.26, 0))
    s.add(block(rhomb, [(0.62, 0.0), (0.78, 0.0)]), m["signal"], at=(0, y0 + 0.26, 0))

    # Unterseite: Kiel mit türkiser Platte (im Hero im Licht), schräge Bauchflossen unter den Flügelwurzeln, türkise Nähte
    # auf den Bodenkanten, kurze Bugkanonen in Gehäusen unter den Flügelwurzeln
    s.add(plate([(-1.6, 0.0), (3.3, 0.0), (3.0, -0.42), (-0.6, -0.38)], 0.16, "yz"), m["dark"], at=(0, 0, -0.2))
    s.add(plate([(-0.7, -0.1), (2.75, -0.1), (2.6, -0.32), (-0.25, -0.3)], 0.2, "yz"), m["accent"], at=(0, 0, -0.2))
    belly = [(-0.7, 0.0), (1.3, 0.0), (1.1, -0.36), (0.0, -0.4)]
    for side in (1, -1):
        s.add(block(belly, [(-0.06, 0.04), (0.06, 0.04)], "yz"), m["phantom"], at=(side * 1.25, 0, -0.06), rot=(0, side * -18, 0))
    seam(s, m["signal"], [(w * LOW / 2 + 0.01, y, -down - 0.005) for y, w, _, down in STATIONS[:5]])
    s.add(block([(0.62, -2.4), (0.98, -2.0), (0.98, -0.6), (0.62, -0.4)], [(-0.3, 0.06), (-0.22, 0.0), (-0.05, 0.0)]), m["dark"], mirror=True)
    s.add(tube(16, 0.1, 0.1, -2.95, -2.2), m["steel"], at=(0.8, 0, -0.17), mirror=True)
    s.add(tube(16, 0.13, 0.13, -3.1, -2.85), m["dark_round"], at=(0.8, 0, -0.17), mirror=True)

    # Heck: flache Düsenverkleidung, zwei Triebwerke
    s.add(block([(0.95, 2.9), (0.95, 3.9), (-0.95, 3.9), (-0.95, 2.9)], [(-0.3, 0.1), (-0.2, 0.0), (0.22, 0.0), (0.3, 0.1)]), m["dark"])
    engine(s, m, 0.3, 3.6, 4.6, dx=0.55, dz=-0.02, mirror=True)
    return s.finish()
