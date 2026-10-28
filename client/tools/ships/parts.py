"""Gemeinsame Helfer der Schiffe im Clean-Toon-Stil: Baugruppen mit dem Materialsatz aus `vf.materials` (Turm, Düse,
Wappenplatte, Zierlinien) und Formen, die mehrere Schiffe teilen (Profile, Streben, Walzen, Facettenblöcke, Bänder
auf Lofts).

Ein Helfer kommt erst hierher, wenn ein zweites Schiff ihn braucht; bis dahin lebt er im Modul seines Schiffs
(fleet/<id>.py), damit parallel arbeitende Agents sich nicht in die Quere kommen. Wer hier etwas ändert, ändert alle
Schiffe, die es benutzen: vorher und nachher bauen und die Geometrie vergleichen.
"""

import math

import bmesh
from mathutils import Matrix, Vector

from vf import Ship, grow, loft, plate, post, rbox, rect, revolve, rounded, sec, smooth, sweep, tube

# ---------------------------------------------------------------- Baugruppen


def turret(s, m, at, r=0.5, barrel=1.35, yaw=0.0, mirror=False):
    """Zwillingsturm, grob: Barbette, gerundetes Gehäuse in der Akzentfarbe, Blende, zwei dicke Rohre mit Hülse und
    Mündung. `at` ist die Mitte der Barbette auf dem Deck, `r` der Turmradius; die Rohre zeigen nach -Y, gedreht um `yaw`."""
    x, y, z = at
    s.add(post(24, r * 1.06, r * 1.0, 0.0, 0.14), m["dark_round"], at=(x, y, z), mirror=mirror)
    g = Ship("turret")
    g.add(loft(smooth([sec(-0.95 * r, rounded(1.25 * r, 0.52 * r, 0.12 * r)), sec(-0.5 * r, rounded(1.75 * r, 0.84 * r, 0.16 * r)),
                       sec(0.6 * r, rounded(1.75 * r, 0.88 * r, 0.16 * r)), sec(1.05 * r, rounded(1.35 * r, 0.64 * r, 0.14 * r))], 1)), m["accent_round"])
    g.add(rbox(1.3 * r, 0.3 * r, 0.56 * r, 0.05 * r, 1), m["dark"], at=(0, -1.02 * r, 0.02 * r))
    rb = 0.19 * r
    for dx in (-0.38 * r, 0.38 * r):
        g.add(tube(16, rb * 1.5, rb * 1.4, -0.42 * barrel, -1.0 * r), m["dark_round"], at=(dx, 0, 0.04 * r))
        g.add(tube(16, rb, rb * 0.92, -barrel, -0.4 * barrel), m["steel"], at=(dx, 0, 0.04 * r))
        g.add(tube(16, rb * 1.32, rb * 1.32, -barrel - 0.06, -barrel + 0.16), m["dark_round"], at=(dx, 0, 0.04 * r))
    s.place(g, at=(x, y, z + 0.14 + 0.44 * r), rot=(0, 0, yaw), mirror=mirror)
    g.bm.free()


def engine(s, m, r, y0, y1, dx=0.0, dz=0.0, n=20, mirror=False):
    """Triebwerk ohne Rippen von y0 (vorn) bis y1 (Düsenende): dunkles Gehäuse, Düsenglocke mit Wandstärke, leuchtende
    Brennkammer (`core`) mit kurzer Fahne; `n` Segmente (kleine Düsen 10–16, sonst sprengen viele das Budget)."""
    length = y1 - y0
    ya, yb = y0 + 0.6 * length, y0 + 0.78 * length
    s.add(tube(n, r, r, y0, ya, dx, dz), m["dark_round"], mirror=mirror)
    # Die Glocke beginnt knapp im Gehäuse: deckungsgleiche Deckel verwirren Freestyle ("edge appears twice")
    bell = [(r * 0.97, ya - 0.04 * r), (r * 0.78, yb), (r * 0.74, yb + 0.05 * length), (r * 0.92, y1), (r * 0.8, y1), (r * 0.62, yb + 0.06 * length),
            (0.0, yb + 0.02 * length)]
    s.add(revolve(bell, n), m["steel"], at=(dx, 0, dz), mirror=mirror)
    s.add(revolve([(r * 0.62, yb + 0.03 * length), (r * 0.62, yb + 0.1 * length), (r * 0.52, y1 + 0.02 * length), (0.0, y1 + 0.22 * length)], n),
          m["core"], at=(dx, 0, dz), mirror=mirror)


def badge(s, m, at, outline, symbol, rim=0.08, dy=0.0):
    """Wappenplatte eines Flaggschiffs, liegend; `at` ist die Mitte ihrer Unterseite: Goldrand (`trim`, um `rim` breiter),
    dunkle Platte mit dem Umriss `outline`, darauf das Zeichen `symbol` in `signal`, um `dy` längs versetzt."""
    x, y, z = at
    s.add(plate(grow(outline, rim), 0.06, "xy"), m["trim"], at=(x, y, z + 0.03))
    s.add(plate(outline, 0.1, "xy"), m["dark"], at=(x, y, z + 0.05))
    s.add(plate(symbol, 0.06, "xy"), m["signal"], at=(x, y + dy, z + 0.12))


def trim_loop(s, m, outline, z, w=0.07, h=0.07, d=0.02):
    """Zierlinie (`trim`) rund um ein Deck (Umriss x, y auf Höhe z), knapp außen auf der Kante."""
    pts = [(x, y, z) for x, y in grow(outline, d)]
    s.add(sweep(pts + pts[:2], rect(w, h)), m["trim"])


def trim_line(s, m, points, w=0.07, h=0.07, mirror=True):
    """Zierlinie (`trim`) entlang einer Punktfolge (x, y, z), gespiegelt auf beide Flanken."""
    s.add(sweep(points, rect(w, h)), m["trim"], mirror=mirror)


def on_surface(tree, x, y, z=10.0):
    """Punkt und Neigung (Grad, für `rot`) der Oberfläche unter (x, y), per Strahl von oben auf `tree` (BVHTree)."""
    hit, normal, _, _ = tree.ray_cast(Vector((x, y, z)), Vector((0, 0, -1)))
    if hit is None:
        return None, None
    euler = Vector((0, 0, 1)).rotation_difference(normal).to_euler()
    return hit, tuple(math.degrees(a) for a in euler)


# ---------------------------------------------------------------- Formen


def sym(half):
    """Symmetrischer Umriss (x, y) aus der Steuerbordhälfte, von vorn nach achtern; Punkte auf x = 0 nur einmal."""
    return half + [(-x, y) for x, y in reversed(half) if x > 1e-6]


def stealth(w, up, down, top=0.36, low=0.6):
    """Tarnkappen-Querschnitt (x, z): scharfe Kimmkante bei z = 0, schmaler flacher Grat oben (Anteil `top` der Breite)
    auf Höhe `up`, flacher Boden (Anteil `low`) in Tiefe `down`. Wie vf.facet, nur mit Höhen statt Anteilen."""
    return [(w / 2, 0.0), (w * top / 2, up), (-w * top / 2, up), (-w / 2, 0.0), (-w * low / 2, -down), (w * low / 2, -down)]


def block(outline, levels, plane="xy"):
    """Facettenblock aus einem konvexen Umriss auf mehreren Lagen [(Lage, Einzug)]: 'xy' liegt (Umriss x, y, Lagen
    in z), 'yz' steht längs (Umriss y, z, Lagen in x). Ein Einzug an der ersten oder letzten Lage fast die Kante."""
    rings = []
    for level, d in levels:
        pts = grow(outline, -d) if d else outline
        rings.append([Vector((a, b, level)) if plane == "xy" else Vector((level, a, b)) for a, b in pts])
    return loft(rings)


def beam(a, b, w, h):
    """Kantige Strebe oder Armglied von a nach b, Querschnitt w (quer) × h."""
    a, b = Vector(a), Vector(b)
    d = b - a
    bm = loft([sec(0.0, rect(w, h)), sec(d.length, rect(w, h))])
    rot = Vector((0, 1, 0)).rotation_difference(d.normalized()).to_matrix().to_4x4()
    bmesh.ops.transform(bm, matrix=Matrix.Translation(a) @ rot, verts=bm.verts)
    return bm


def axle(r, length, n=12):
    """Walze entlang X um den Ursprung (Achse, Gelenk)."""
    bm = tube(n, r, r, -length / 2, length / 2)
    bmesh.ops.rotate(bm, verts=bm.verts, matrix=Matrix.Rotation(-math.pi / 2, 4, "Z"))
    return bm


def ring_at(rings, y, offset=0.0):
    """Querschnitt eines Lofts (Ringe wie aus `smooth`) bei Tiefe y, radial um `offset` von der Längsachse weg versetzt:
    Bänder, die dem Rumpf genau folgen (`loft([ring_at(r, y0, 0.04), ring_at(r, y1, 0.04)])`)."""
    rings = [r for r in rings if isinstance(r, list)]
    for a, b in zip(rings, rings[1:]):
        if a[0].y <= y <= b[0].y:
            t = (y - a[0].y) / (b[0].y - a[0].y)
            return [Vector((p.x, y, p.z)) + Vector((p.x, 0.0, p.z)).normalized() * offset for p in (p.lerp(q, t) for p, q in zip(a, b))]
    raise ValueError(f"y = {y} liegt außerhalb des Lofts")
