"""Repair Drone (Unterstützer) im Clean-Toon-Stil.

Runder, heller Körper mit breitem mintgrünem und orangem Band, große Kanzel mit grünem Rahmen über den Bug, zwei
Werkzeuglichter an den Wangen. Oben zwei gefaltete Reparaturarme wie Fangarme (helle kantige Glieder, grüne Gelenke,
dunkle Greifer), vorn unten an Steuerbord ein Schweißarm mit Brenner im Werkzeuglicht. Seitengondeln an Streben mit
Einlass, orangem Band, Lichtband und je einer Düse, zwei Heckdüsen, unter dem Bauch eine Frachtkapsel mit Warnstreifen.
Etwa 3,9k Dreiecke (das alte Modell hatte 8,1k).
"""

from mathutils import Vector
from mathutils.bvhtree import BVHTree

import palette
import vf
from parts import axle, beam, engine, on_surface, ring_at
from vf import Ship, box, loft, post, rounded, sec, smooth, superellipse, tip, tube


def body_sections(n=20, p=2.4):
    return [tip(-2.1), sec(-1.85, superellipse(0.8, 0.66, n, p)), sec(-1.3, superellipse(1.48, 1.22, n, p)),
            sec(-0.4, superellipse(1.76, 1.46, n, p)), sec(0.6, superellipse(1.76, 1.46, n, p)),
            sec(1.4, superellipse(1.42, 1.18, n, p)), sec(1.95, superellipse(0.98, 0.82, n, p))]


def build():
    s = Ship("repair_drone")
    m = vf.materials(s.name, "support")
    m["stripe"] = vf.toon(f"{s.name}_stripe", palette.STRIPE, round=True)
    m["amber"] = vf.light(f"{s.name}_amber", palette.AMBER)
    # Runder Körper; seine Oberfläche dient als Maß für alles, was darauf sitzt
    rings = smooth(body_sections(), 2)
    body = loft(rings)
    tree = BVHTree.FromBMesh(body)

    def top(x, y):
        return on_surface(tree, x, y)[0].z

    def nose(x, z):
        return tree.ray_cast(Vector((x, -5.0, z)), Vector((0, 1, 0)))[0].y

    s.add(body, m["hull_round"])
    # Breites mintgrünes und oranges Band
    s.add(loft([ring_at(rings, -0.5, 0.045), ring_at(rings, -0.1, 0.045)]), m["accent_round"])
    s.add(loft([ring_at(rings, 0.28, 0.045), ring_at(rings, 0.58, 0.045)]), m["stripe"])
    # Große Kanzel mit grünem Rahmen über den Bug, dem Rumpf folgend (Profile tief genug, dass ihre Flanken im Rumpf stecken)
    frame = [(-2.02, 0.3, 0.3), (-1.75, 0.82, 0.5), (-1.3, 1.08, 0.56), (-0.9, 1.06, 0.56), (-0.6, 0.74, 0.4)]
    s.add(loft(smooth([sec(y, rounded(w, h, 0.12, 1), dz=top(0, y) - h / 2 + 0.12) for y, w, h in frame], 1)), m["accent_round"])
    glass = [(-1.96, 0.18, 0.24), (-1.72, 0.6, 0.44), (-1.3, 0.8, 0.52), (-0.95, 0.78, 0.5), (-0.72, 0.5, 0.34)]
    s.add(loft(smooth([sec(y, rounded(w, h, 0.1, 1), dz=top(0, y) - h / 2 + 0.2) for y, w, h in glass], 1)), m["glass"])
    # Zwei gefaltete Reparaturarme oben wie Fangarme einer Gottesanbeterin: Sockel, Schulter hinten, Oberarm steil nach
    # vorn oben, Ellbogen, Unterarm nach vorn unten, Greifer zum Rumpf
    x = 0.45
    shoulder, elbow, wrist = Vector((x, 1.1, top(x, 1.1) + 0.18)), Vector((x, 0.45, 1.64)), Vector((x, -0.12, 1.28))
    s.add(post(14, 0.19, 0.16, top(x, 1.1) - 0.12, shoulder.z), m["dark_round"], at=(x, 1.1, 0), mirror=True)
    s.add(axle(0.15, 0.3, 10), m["accent_round"], at=shoulder, mirror=True)
    s.add(beam(shoulder, elbow, 0.2, 0.22), m["hull"], mirror=True)
    s.add(axle(0.15, 0.3, 10), m["accent_round"], at=elbow, mirror=True)
    s.add(beam(elbow, wrist, 0.18, 0.2), m["hull"], mirror=True)
    s.add(box(0.24, 0.26, 0.26), m["dark"], at=wrist, mirror=True)
    s.add(beam(wrist, wrist + Vector((0, -0.32, -0.08)), 0.15, 0.15), m["dark"], mirror=True)
    s.add(beam(wrist, wrist + Vector((0, -0.1, -0.3)), 0.15, 0.15), m["dark"], mirror=True)
    # Zwei Werkzeuglichter an den Wangen des Bugs
    y = nose(0.3, -0.06)
    s.add(tube(10, 0.09, 0.09, y - 0.06, y + 0.04), m["amber"], at=(0.3, 0, -0.06), mirror=True)
    # Schweißarm vorn unten an Steuerbord mit Brenner
    s.add(box(0.32, 0.36, 0.32), m["dark"], at=(0.58, -0.95, -0.52))
    j1, j2, head = (0.74, -1.0, -0.56), (0.86, -1.68, -0.68), (0.8, -2.25, -0.52)
    s.add(axle(0.14, 0.3, 10), m["accent_round"], at=j1)
    s.add(beam(j1, j2, 0.18, 0.18), m["hull"])
    s.add(axle(0.13, 0.26, 10), m["accent_round"], at=j2)
    s.add(beam(j2, head, 0.16, 0.16), m["hull"])
    s.add(box(0.26, 0.3, 0.26), m["dark"], at=head)
    s.add(tube(12, 0.11, 0.08, -2.58, -2.38), m["steel"], at=(head[0], 0, head[2]))
    s.add(tube(10, 0.08, 0.0, -2.76, -2.56), m["amber"], at=(head[0], 0, head[2]))
    # Seitengondeln an Streben: Einlass vorn, oranges Band, Lichtband, Düse
    gx, gz = 1.32, -0.25
    nacelle = smooth([sec(-0.9, superellipse(0.44, 0.44, 14, 2.4)), sec(-0.75, superellipse(0.6, 0.6, 14, 2.4)),
                      sec(-0.45, superellipse(0.64, 0.64, 14, 2.4)), sec(1.0, superellipse(0.64, 0.64, 14, 2.4)),
                      sec(1.5, superellipse(0.58, 0.58, 14, 2.4))], 1)
    s.add(loft(nacelle), m["hull_round"], at=(gx, 0, gz), mirror=True)
    s.add(tube(12, 0.16, 0.16, -0.95, -0.85), m["dark_round"], at=(gx, 0, gz), mirror=True)
    s.add(loft([ring_at(nacelle, -0.42, 0.035), ring_at(nacelle, -0.2, 0.035)]), m["stripe"], at=(gx, 0, gz), mirror=True)
    s.add(box(0.54, 0.9, 0.2), m["dark"], at=(0.94, 0.45, gz - 0.06), mirror=True)
    s.add(box(0.05, 0.9, 0.07), m["glow"], at=(gx + 0.315, 0.45, gz), mirror=True)
    engine(s, m, 0.25, 1.38, 2.0, dx=gx, dz=gz, n=12, mirror=True)
    # Zwei Heckdüsen
    engine(s, m, 0.2, 1.85, 2.42, dx=0.3, dz=-0.1, n=10, mirror=True)
    # Frachtkapsel mit Warnstreifen unter dem Bauch
    pod = smooth([tip(-0.95), sec(-0.65, superellipse(0.56, 0.46, 16, 2.4)), sec(0.55, superellipse(0.62, 0.5, 16, 2.4)),
                  sec(0.95, superellipse(0.5, 0.4, 16, 2.4)), tip(1.2)], 1)
    s.add(loft(pod), m["hull_round"], at=(0, 0.3, -0.79))
    s.add(loft([ring_at(pod, -0.25, 0.04), ring_at(pod, 0.1, 0.04)]), m["stripe"], at=(0, 0.3, -0.79))
    return s.finish()
