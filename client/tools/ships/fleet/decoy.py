"""Trugbild (Token der Admiralsfähigkeit von Admiral Moreau, „das Phantom“), Clean Toon.

Hologramm eines Jägers aus Moreaus Werft, formverwandt mit der Mirage: flacher Facettenpfeil mit Rückengrat und Kanzel,
Diamantflügel mit Platte, zwei schräge Flossen mit Platte, zwei Düsenringe. Durchscheinende Flächen in Moreaus Türkis
(palette.HOLOGRAM), nach oben gewandte heller, als fiele Licht darauf, Platten und Rückengrat noch heller; Umrisse,
Kimm, Grat und zwei Scanlinien als leuchtende Kanten. Wenige Dreiecke; wreck.py zerlegt es in offene Licht-Splitter.
"""

import palette
import vf
from parts import block, stealth
from vf import Ship, hoop, loft, sec, sweep, tip, tube

FACE, EDGE = palette.HOLOGRAM

# Rumpfstationen wie bei der Mirage (y, Breite an der Kimm, Höhe des Grats, Tiefe des Bodens), kürzer und schlanker
STATIONS = [(-2.2, 0.66, 0.14, 0.08), (-1.0, 1.25, 0.27, 0.16), (0.4, 1.5, 0.31, 0.18), (1.9, 1.35, 0.29, 0.18), (2.7, 1.0, 0.22, 0.15)]
TOP = 0.36


def lit_from_above(s, mat, lit, z=0.35):
    """Nach oben gewandte Flächen von `mat` bekommen `lit`: Das Hologramm ist unbeleuchtet, so liest sich die Form
    trotzdem wie von oben angestrahlt."""
    if lit not in s.materials:
        s.materials.append(lit)
    src, dst = s.materials.index(mat), s.materials.index(lit)
    s.bm.normal_update()
    for face in s.bm.faces:
        if face.material_index == src and face.normal.z > z:
            face.material_index = dst


def build():
    s = Ship("decoy")
    m = {
        "face": vf.hologram(f"{s.name}_face", FACE, 0.14),
        "top": vf.hologram(f"{s.name}_top", FACE, 0.3),
        "panel": vf.hologram(f"{s.name}_panel", FACE, 0.42),
        "canopy": vf.hologram(f"{s.name}_canopy", EDGE, 0.38),
        "edge": vf.hologram(f"{s.name}_edge", EDGE, 0.9, glow=True),
    }
    edge = vf.rect(0.05, 0.05)

    def line(points, closed=False, mirror=False):
        pts = list(points) + (list(points[:2]) if closed else [])
        s.add(sweep(pts, edge), m["edge"], mirror=mirror)

    # Rumpf: Facettenpfeil; Kanten auf Kimm und Grat, Heckring
    nose = (0.0, -3.1, 0.02)
    rings = [sec(y, stealth(w, up, down)) for y, w, up, down in STATIONS]
    s.add(loft([tip(nose[1], 0, nose[2])] + rings), m["face"])
    lit_from_above(s, m["face"], m["top"])
    line([nose] + [(w / 2, y, 0.0) for y, w, _, _ in STATIONS], mirror=True)
    line([nose] + [(w * TOP / 2, y, up) for y, w, up, _ in STATIONS], mirror=True)
    line([tuple(p) for p in rings[-1]], closed=True)
    # Scanlinien: zwei Querringe, wie sie ein Projektor zeichnet
    for y in (-1.9, 1.25):
        k = next(i for i, st in enumerate(STATIONS) if st[0] > y)
        t = (y - STATIONS[k - 1][0]) / (STATIONS[k][0] - STATIONS[k - 1][0])
        line([tuple(a.lerp(b, t)) for a, b in zip(rings[k - 1], rings[k])], closed=True)
    # Rückengrat und Kanzel
    spine = [(y, w * TOP * 0.95, up) for y, w, up, _ in STATIONS[:4]]
    s.add(loft([tip(-2.6, 0, 0.12)] + [sec(y, [(hw / 2, up - 0.03), (hw * 0.3, up + 0.1), (-hw * 0.3, up + 0.1), (-hw / 2, up - 0.03)])
                                       for y, hw, up in spine]), m["panel"])
    canopy = [(0.07, -1.35), (0.26, -0.75), (0.27, 0.15), (0.18, 0.4), (-0.18, 0.4), (-0.27, 0.15), (-0.26, -0.75), (-0.07, -1.35)]
    s.add(block(canopy, [(0.26, 0.0), (0.42, 0.0), (0.52, 0.1)]), m["canopy"])

    # Diamantflügel: Fläche, Platte, leuchtender Umriss
    wing = [(0.45, -1.75), (2.1, 0.7), (0.55, 2.05), (0.4, 2.05)]
    s.add(block(wing, [(-0.025, 0.0), (0.025, 0.0)]), m["face"], mirror=True)
    s.add(block([(0.75, -0.75), (1.6, 0.65), (0.75, 1.55)], [(0.025, 0.0), (0.05, 0.0)]), m["panel"], mirror=True)
    line([(x, y, 0.0) for x, y in wing[:3]], mirror=True)

    # Schräge Flossen: Fläche, Platte, leuchtender Umriss
    fin = [(0.8, 0.0), (2.55, 0.0), (2.8, 0.98), (2.18, 1.04)]
    g = Ship("decoy_fin")
    g.add(block(fin, [(-0.02, 0.0), (0.02, 0.0)], "yz"), m["face"])
    g.add(block([(1.35, 0.16), (2.36, 0.16), (2.55, 0.78), (2.2, 0.82)], [(-0.035, 0.0), (0.035, 0.0)], "yz"), m["panel"])
    g.add(sweep([(0.0, y, z) for y, z in fin + fin[:2]], edge), m["edge"])
    for side in (1, -1):
        s.place(g, at=(side * 0.5, 0, 0.18), rot=(0, side * 24, 0))
    g.bm.free()

    # Zwei Düsen: leuchtende Ringe, durchscheinender Strahl
    for side in (1, -1):
        s.add(hoop(12, 0.12, 0.2, 0.05), m["edge"], at=(side * 0.3, 2.72, 0.0), rot=(90, 0, 0))
        s.add(tube(12, 0.13, 0.0, 2.72, 3.15), m["top"], at=(side * 0.3, 0, 0.0))
    return s.finish()
