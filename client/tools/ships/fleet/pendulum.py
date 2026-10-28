"""Pendulum (Flaggschiff von Admiral Kerr, „der Uhrmacher“), Clean Toon.

Railgun-Schlachtschiff auf einem schmalen Keilrumpf. Die Railgun ist das Rückgrat: ein Gehäuse in der Akzentfarbe auf
dem Deck, vorn ragen ihre Schienen weit über den Bug, umwickelt von fünf groben Spulen im Wechsel Messing und Signalblau,
mit Mündungsjoch. Um den Rumpf das Gimbal: ein senkrechter Messing-Zahnkranz mit sechzehn groben Zähnen auf Zapfen an den
Flanken, darin ein um die Hochachse gedrehter Spulenring, der auf dem Brett als Ellipse zu sehen ist. Unter dem Kiel
schwingt das Pendel nach achtern. Auf dem Verschluss das Wappen Kerrs (Zahnrad, Zifferblatt, Zeiger), achtern die
Brücke aus drei Keilen mit Fensterband und Mast, Panzerschürzen, Zierlinie, Kiel und vier Düsen.
"""

import math

from mathutils import Vector

import palette
import vf
from parts import engine, trim_line
from vf import Ship, box, flank, hoop, keel, loft, octagon, plate, post, revolve, sec, segment, sphere, tube, wedge


def gear(teeth, r_root, r_tip, width=0.5):
    """Zahnrad-Umriss (x, y) mit `teeth` trapezförmigen Zähnen zwischen r_root und r_tip; `width` ist der Anteil des
    Zahns an der Teilung."""
    pts = []
    for k in range(teeth):
        a = 2 * math.pi * k / teeth
        half = math.pi / teeth * width
        for angle, radius in ((a - half * 1.25, r_root), (a - half * 0.75, r_tip), (a + half * 0.75, r_tip), (a + half * 1.25, r_root)):
            pts.append((radius * math.cos(angle), radius * math.sin(angle)))
    return pts


def gear_ring(teeth, r_in, r_root, r_tip, depth):
    """Zahnkranz um die Z-Achse: innen rund (Radius r_in), außen Zähne, `depth` dick."""
    outer = gear(teeth, r_root, r_tip)
    inner = [(r_in * x / math.hypot(x, y), r_in * y / math.hypot(x, y)) for x, y in outer]
    h = depth / 2
    rings = [[Vector((x, y, z)) for x, y in pts] for pts, z in ((inner, -h), (outer, -h), (outer, h), (inner, h), (inner, -h))]
    return loft(rings, cap_start=False, cap_end=False)


def emblem(s, m, at):
    """Wappen Kerrs liegend: Messing-Zahnrad, Zifferblatt in Signalblau, zwei goldene Zeiger."""
    x, y, z = at
    s.add(plate(gear(12, 0.6, 0.8), 0.14, "xy"), m["brass"], at=(x, y, z + 0.02))
    s.add(post(24, 0.46, 0.46, 0.0, 0.05), m["signal"], at=(x, y, z + 0.07))
    for length, width, angle in ((0.4, 0.13, 25), (0.28, 0.17, 145)):
        hand = [(-width / 2, -0.06), (width / 2, -0.06), (width / 4, length), (-width / 4, length)]
        a = math.radians(angle)
        hand = [(px * math.cos(a) - py * math.sin(a), px * math.sin(a) + py * math.cos(a)) for px, py in hand]
        s.add(plate(hand, 0.05, "xy"), m["trim"], at=(x, y, z + 0.13))
    s.add(post(12, 0.08, 0.08, 0.0, 0.09), m["trim"], at=(x, y, z + 0.11))


def build():
    s = Ship("pendulum")
    m = vf.materials(s.name, "battleship")
    m["brass"] = vf.toon(f"{s.name}_brass", palette.BRASS)
    m["brass_round"] = vf.toon(f"{s.name}_brass_round", palette.BRASS, round=True, glint=vf.GLINT)
    zc = 1.0
    deck = zc + 0.75
    # Schmaler Keilrumpf mit flachem Deck, Zierlinie an der Deckkante
    hull = [sec(-3.3, keel(1.3, 0.9), dz=zc + 0.15), sec(-2.5, keel(2.6, 1.3), dz=zc + 0.1), sec(-0.8, keel(3.2, 1.5), dz=zc),
            sec(2.6, keel(3.2, 1.5), dz=zc), sec(3.8, keel(2.6, 1.3), dz=zc + 0.1), sec(4.3, keel(2.0, 1.0), dz=zc + 0.25)]
    s.add(loft(hull), m["hull"])
    trim_line(s, m, flank(hull, deck - 0.12, 0.02))
    # Panzerschürzen vor und hinter dem Gimbal
    s.add(plate([(1.15, -2.95), (1.62, -2.2), (1.7, -1.75), (1.3, -1.75)], 0.18, "xy"), m["armor"], at=(0, 0, zc + 0.05), mirror=True)
    s.add(plate([(1.3, -0.65), (1.75, -0.65), (1.75, 2.9), (1.45, 3.75), (1.2, 3.75)], 0.18, "xy"), m["armor"], at=(0, 0, zc + 0.05), mirror=True)
    # Railgun als Rückgrat: Gehäuse in der Akzentfarbe mit Lichtband, dunkler Verschluss, vorn Schienen, fünf Spulen, Joch
    zr = 2.0
    s.add(loft([sec(-3.15, octagon(0.9, 0.6, 0.35), dz=zr - 0.1), sec(-2.5, octagon(1.05, 0.72, 0.35), dz=zr),
                sec(0.6, octagon(1.05, 0.72, 0.35), dz=zr)]), m["accent"])
    s.add(box(0.09, 3.0, 0.05), m["glow"], at=(0, -1.1, zr + 0.36))
    s.add(loft([sec(0.45, octagon(1.6, 0.66, 0.4), dz=zr - 0.02), sec(0.75, octagon(1.95, 0.76, 0.35), dz=zr),
                sec(2.3, octagon(1.95, 0.76, 0.35), dz=zr)]), m["dark"])
    for x in (0.25, -0.25):
        s.add(box(0.17, 3.9, 0.5), m["steel"], at=(x, -3.65, zr))
    for k, y in enumerate((-3.45, -3.9, -4.35, -4.8, -5.25)):
        s.add(hoop(24, 0.34, 0.6, 0.22), m["signal" if k % 2 else "brass_round"], at=(0, y, zr), rot=(90, 0, 0))
    s.add(loft([sec(-5.8, octagon(0.86, 0.86, 0.4)), sec(-5.72, octagon(1.02, 1.02, 0.4)), sec(-5.47, octagon(1.02, 1.02, 0.4))]), m["dark"],
          at=(0, 0, zr))
    s.add(box(0.32, 0.05, 0.5), m["signal"], at=(0, -5.81, zr))
    # Gimbal: senkrechter Messing-Zahnkranz auf Zapfen an den Flanken, darin der gedrehte Spulenring auf Stiften
    gy, gz = -1.2, 1.3
    s.add(gear_ring(16, 1.8, 2.02, 2.26, 0.3), m["brass"], at=(0, gy, gz), rot=(90, 0, 0))
    s.add(tube(20, 0.19, 0.19, 1.4, 1.92), m["brass_round"], at=(0, gy, gz), rot=(0, 0, -90), mirror=True)
    s.add(box(0.24, 0.6, 0.56), m["dark"], at=(1.57, gy, gz), mirror=True)
    s.add(hoop(32, 1.42, 1.6, 0.2), m["accent"], at=(0, gy, gz), rot=(90, 0, -35))
    s.add(hoop(32, 1.28, 1.43, 0.14), m["signal"], at=(0, gy, gz), rot=(90, 0, -35))
    for z0, z1 in ((gz + 1.5, gz + 1.88), (gz - 1.88, gz - 1.5)):
        s.add(post(12, 0.11, 0.11, z0, z1), m["brass_round"], at=(0, gy, 0))
    # Pendel unter dem Kiel: Lagerbock, Achse, Stange, Linse mit Signalkern, nach achtern ausgeschwungen
    pivot = Vector((0, 1.75, 0.2))
    swing = math.radians(14)
    d = Vector((0, math.sin(swing), -math.cos(swing)))
    s.add(box(0.5, 0.62, 0.42), m["dark"], at=(0, pivot.y, pivot.z + 0.14))
    s.add(tube(16, 0.12, 0.12, -0.34, 0.34), m["brass_round"], at=tuple(pivot), rot=(0, 0, -90))
    s.add(segment(pivot, pivot + d * 0.75, 0.09, 12), m["brass_round"])
    bob = pivot + d * 0.92
    s.add(revolve([(0.0, -0.14), (0.36, -0.12), (0.52, -0.05), (0.52, 0.05), (0.36, 0.12), (0.0, 0.14)], 28), m["brass_round"],
          at=tuple(bob), rot=(0, 0, -90))
    s.add(tube(24, 0.26, 0.26, -0.16, 0.16), m["signal"], at=tuple(bob), rot=(0, 0, -90))
    # Wappen auf dem Verschluss
    emblem(s, m, (0, 1.45, zr + 0.38))
    # Brücke achtern: drei Keile, Fensterband, Mast mit Leuchtfeuer
    z, by = deck, 3.15
    for w, l, h in ((1.7, 1.4, 0.5), (1.25, 1.05, 0.45), (0.9, 0.75, 0.4)):
        s.add(wedge(w, l, h), m["hull"], at=(0, by, z + h / 2))
        z += h
    s.add(box(0.8, 0.04, 0.09), m["window"], at=(0, by - 0.75 / 2 + 0.12, z - 0.17))
    s.add(box(0.04, 0.5, 0.09), m["window"], at=(0.465, by + 0.05, z - 0.17), mirror=True)
    s.add(post(10, 0.09, 0.06, z, z + 0.95), m["hull_round"], at=(0, by + 0.15, 0))
    s.add(sphere(0.08, 1), m["glow"], at=(0, by + 0.15, z + 0.99))
    # Kiel vorn und Düsenblock mit vier Düsen
    s.add(plate([(-3.15, 0.68), (-1.8, 0.42), (-1.8, -0.05), (-2.75, 0.2)], 0.16, "yz"), m["dark"])
    s.add(box(2.5, 0.5, 1.2), m["dark"], at=(0, 4.25, zc + 0.25))
    engine(s, m, 0.44, 4.3, 5.05, dx=0.6, dz=zc + 0.05, mirror=True)
    engine(s, m, 0.3, 4.3, 4.85, dx=1.25, dz=zc + 0.5, mirror=True)
    return s.finish()
