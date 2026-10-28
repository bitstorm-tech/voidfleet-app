"""Hive (Flaggschiff von Admiral Halvorsen, „der Schwarm“), Clean Toon.

Organischer Zwei-Kammer-Rumpf mit Taille und zwei Kragen in der Akzentfarbe. Auf der hinteren Kammer eine erhöhte,
dunkle Brutplattform mit zehn großen Waben: offene leuchten in der UI-Farbe des Admirals (ohne Glühen), verdeckelte
sind flache Kuppeln in Violett. Vorn der Sechseckturm als Brücke mit Fensterband und Mast, davor die Wappenplatte mit
drei goldenen Waben. An den Flanken zwei sechseckige Hangar-Sponsons mit je drei Buchten und zwei angedockten
Mini-Drohnen (Keil, Pfeilflügel, Sensorauge, zwei Düsen). Sensorauge im Bug, Kiel, drei Düsen.
"""

import math

import bmesh
from mathutils import Vector
from mathutils.bvhtree import BVHTree

import vf
from parts import engine, on_surface, ring_at, trim_line, trim_loop
from vf import Ship, box, flank, grow, hoop, loft, ngon, octagon, plate, post, rect, sec, smooth, sphere, superellipse, sweep, tip, tube

HEX = math.radians(30)  # Phase eines Sechsecks mit Spitze oben bzw. vorn


def band(rings, y0, y1, grow_by, below=None):
    """Lage auf einem runden Rumpf von y0 bis y1, die seinen Querschnitten folgt: um `grow_by` aufgeweitet; mit `below`
    nur unterhalb dieser Höhe (darüber liegt die Lage im Rumpf), also eine Bauchschale statt eines Kragens."""
    ys = [y0] + [r[0].y for r in rings if y0 < r[0].y < y1] + [y1]
    sections = []
    for y in ys:
        ring = ring_at(rings, y)
        cx = sum(p.x for p in ring) / len(ring)
        cz = sum(p.z for p in ring) / len(ring)
        shape = []
        for p in ring:
            d = Vector((p.x - cx, p.z - cz))
            step = grow_by if below is None or p.z < below else -0.15
            d = d * ((d.length + step) / d.length)
            shape.append((cx + d.x, cz + d.y))
        sections.append(sec(y, shape))
    return loft(sections)


def convex_hull(points):
    """Konvexe Hülle (x, y) gegen den Uhrzeigersinn."""
    pts = sorted(set(points))

    def half(seq):
        out = []
        for p in seq:
            while len(out) >= 2 and (out[-1][0] - out[-2][0]) * (p[1] - out[-2][1]) - (out[-1][1] - out[-2][1]) * (p[0] - out[-2][0]) <= 0:
                out.pop()
            out.append(p)
        return out

    lower, upper = half(pts), half(reversed(pts))
    return lower[:-1] + upper[:-1]


def mini_drone(m, k=1.15):
    """Angedockte Drohne in klein, wie das Token `drone`: Keilrumpf, gepfeilte Flügel mit violetter Vorderkante,
    Sensorauge in der UI-Farbe, zwei Düsen, auf einer dunklen Klammer. Liefert die Baugruppe, Ursprung am Fuß der
    Klammer, um `k` vergrößert."""
    g = Ship("mini_drone")
    g.add(box(0.32, 0.56, 0.24), m["dark"], at=(0, 0.05, 0.06))
    zb = 0.27
    g.add(loft([tip(-0.78, 0, -0.02), sec(-0.42, octagon(0.28, 0.15, 0.35)), sec(0.05, octagon(0.4, 0.22, 0.35)),
                sec(0.52, octagon(0.34, 0.19, 0.35))]), m["hull"], at=(0, 0, zb))
    g.add(plate([(0.1, -0.22), (0.62, 0.3), (0.62, 0.46), (0.1, 0.5)], 0.05, "xy"), m["hull"], at=(0, 0, zb - 0.02), mirror=True)
    g.add(plate([(0.12, -0.2), (0.6, 0.28), (0.6, 0.37), (0.12, -0.08)], 0.06, "xy"), m["accent"], at=(0, 0, zb - 0.01), mirror=True)
    g.add(post(6, 0.1, 0.07, 0.0, 0.07), m["signal"], at=(0, -0.22, zb + 0.08))
    g.add(tube(10, 0.1, 0.1, 0.4, 0.6), m["dark_round"], at=(0.13, 0, zb - 0.01), mirror=True)
    g.add(tube(10, 0.08, 0.0, 0.6, 0.67), m["core"], at=(0.13, 0, zb - 0.01), mirror=True)
    bmesh.ops.scale(g.bm, vec=(k, k, k), verts=g.bm.verts)
    return g


def emblem(s, m, at, pitch):
    """Wappenplatte Halvorsens: dunkles Sechseck mit Goldrand, darauf drei goldene Waben; gekippt um `pitch` (Grad)."""
    outline = ngon(6, 0.75)
    g = Ship("emblem")
    g.add(plate(grow(outline, 0.09), 0.12, "xy"), m["trim"], at=(0, 0, -0.02))
    g.add(plate(outline, 0.3, "xy"), m["dark"], at=(0, 0, -0.08))
    for k in range(3):
        a = math.radians(90 + 120 * k)
        g.add(post(6, 0.23, 0.23, 0.0, 0.05), m["trim"], at=(0.31 * math.cos(a), 0.31 * math.sin(a), 0.07))
    s.place(g, at=at, rot=(pitch, 0, 0))
    g.bm.free()


def build():
    s = Ship("hive")
    m = vf.materials(s.name, "battleship")
    # Zwei-Kammer-Rumpf: vordere Kammer, Taille, größere hintere Kammer
    body = lambda w, h: superellipse(w, h, 24, 3.0)  # noqa: E731
    rings = smooth([
        sec(-4.85, body(0.9, 0.6), dz=-0.15),
        sec(-4.35, body(2.0, 1.3), dz=-0.08),
        sec(-2.8, body(3.0, 1.9)),
        sec(-0.75, body(2.3, 1.5)),
        sec(1.3, body(3.7, 2.3), dz=0.05),
        sec(3.3, body(3.5, 2.2), dz=0.05),
        sec(4.45, body(2.5, 1.6)),
        sec(4.85, body(1.6, 1.05)),
    ], 2)
    part = loft(rings)
    tree = BVHTree.FromBMesh(part)
    s.add(part, m["hull_round"])
    trim_line(s, m, flank(rings, 0.55, 0.02))
    for y in (-1.1, -0.35):
        s.add(band(rings, y - 0.12, y + 0.12, 0.07), m["accent_round"])
    # Bauchschale unter der vorderen Kammer als zweite Lage, darüber ein Lichtband
    s.add(band(rings, -4.05, -1.55, 0.09, below=0.0), m["armor_round"])
    s.add(sweep([p for p in flank(rings, 0.2, 0.0) if -3.75 < p[1] < -1.85], rect(0.05, 0.08)), m["glow"], mirror=True)
    # Brutplattform auf der hinteren Kammer: zehn Waben (Spitzen seitlich), offene in Signalfarbe, drei verdeckelt
    pitch, rc = 0.92, (0.92 - 0.16) / math.sqrt(3)
    yc, ztop = 2.25, 1.3
    cells = [(0.0, yc + (k - 1.5) * pitch) for k in range(4)]
    cells += [(sx * pitch * math.sqrt(3) / 2, yc + (k - 1) * pitch) for sx in (1, -1) for k in range(3)]
    corners = [(x + rc * math.cos(a), y + rc * math.sin(a)) for x, y in cells for a in (math.radians(60 * i) for i in range(6))]
    deck = grow(convex_hull(corners), 0.16)
    s.add(plate(deck, 0.7, "xy"), m["dark"], at=(0, 0, ztop - 0.35))
    for i, (x, y) in enumerate(cells):
        if i in (2, 4, 9):
            s.add(loft([sec(0.0, ngon(6, rc)), sec(0.12, ngon(6, rc * 0.9)), sec(0.22, ngon(6, rc * 0.5))]), m["accent"],
                  at=(x, y, ztop - 0.02), rot=(90, 0, 0))
        else:
            s.add(post(6, rc, rc, 0.0, 0.05), m["signal"], at=(x, y, ztop - 0.01))
    # Sechseckturm als Brücke: zwei Stufen, Fensterband rundum, Goldrand, Mast mit Leuchtfeuer
    ty = -2.1
    hit, _ = on_surface(tree, 0, ty)
    z = hit.z - 0.1
    s.add(post(6, 0.85, 0.81, 0.0, 0.62), m["hull"], at=(0, ty, z))
    trim_loop(s, m, [(x, y + ty) for x, y in ngon(6, 0.81)], z + 0.62 + 0.035, d=0.0)
    z += 0.62
    s.add(post(6, 0.62, 0.58, 0.0, 0.56), m["hull"], at=(0, ty, z))
    s.add(hoop(6, 0.55, 0.62, 0.11), m["window"], at=(0, ty, z + 0.36))
    s.add(post(6, 0.5, 0.4, 0.0, 0.14), m["dark"], at=(0, ty, z + 0.56))
    z += 0.7
    s.add(post(10, 0.09, 0.06, 0.0, 0.85), m["hull_round"], at=(0, ty + 0.15, z))
    s.add(sphere(0.1, 1), m["glow"], at=(0, ty + 0.15, z + 0.9))
    # Wappen vor dem Turm, der Wölbung der vorderen Kammer folgend
    hit, rot = on_surface(tree, 0, -3.7)
    emblem(s, m, (0, -3.7, hit.z + 0.04), rot[0])
    # Sensorauge im Bug: dunkler Sechseckrahmen, Auge in Signalfarbe
    s.add(tube(6, 0.44, 0.44, -4.97, -4.7, dz=-0.15, phase=HEX), m["dark"])
    s.add(tube(6, 0.3, 0.3, -5.0, -4.9, dz=-0.15, phase=HEX), m["signal"])
    # Hangar-Sponsons: Sechseckprismen (Spitze oben), drei Buchten außen, zwei angedockte Drohnen obenauf
    sx, sz, rx, rz = 2.3, -0.32, 0.6, 0.75
    pod = [sec(-0.95, ngon(6, 0.26, 0.3, HEX)), sec(-0.35, ngon(6, rx, rz, HEX)), sec(3.5, ngon(6, rx, rz, HEX)),
           sec(4.15, ngon(6, 0.4, 0.5, HEX))]
    s.add(loft(pod), m["accent"], at=(sx, 0, sz), mirror=True)
    face = sx + rx * math.cos(HEX)
    for y in (0.55, 1.6, 2.65):
        s.add(hoop(6, 0.2, 0.32, 0.12), m["dark"], at=(face + 0.01, y, sz), rot=(0, 90, 0), mirror=True)
        s.add(tube(6, 0.22, 0.22, -0.06, 0.03, phase=HEX), m["signal"], at=(face, y, sz), rot=(0, 0, -90), mirror=True)
    drone = mini_drone(m)
    for y in (0.05, 2.05):
        for side in (1, -1):
            s.place(drone, at=(side * (sx + 0.08), y, sz + rz - 0.07))
    drone.bm.free()
    # Kiel unter dem Rumpf
    s.add(plate([(-3.6, -0.55), (3.6, -0.65), (3.35, -1.35), (-2.9, -1.2)], 0.18, "yz"), m["dark"])
    # Drei Düsen: eine große Mitteldüse, zwei kleinere darunter
    engine(s, m, 0.5, 4.5, 5.45, dz=0.05)
    engine(s, m, 0.34, 4.35, 5.15, dx=0.8, dz=-0.45, mirror=True)
    return s.lift(0.25).finish()
