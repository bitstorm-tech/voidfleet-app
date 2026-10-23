"""Die acht Schiffe von Voidfleet, je eine Funktion pro Karten-ID (siehe shared/cards.ts).

Größen in Blender-Einheiten; auf dem Brett wirkt MODEL_SCALE × BOARD_SCALE aus ship.ts.
Jäger ~6, Kreuzer ~6-7.5, Schlachtschiffe ~8.5, Unterstützer ~5 Einheiten lang.
Vorn ist -Y, oben +Z; `mirror=True` spiegelt ein Teil an der Längsachse.
"""

import math

from vf import (WHITE, Ship, antenna, box, dish, greebles, hoop, inset, keel, loft, missile_pod, ngon, octagon,
                palette, pd_turret, pipe, plate, post, radar, rbox, rect, revolve, rounded, sec, segment, smooth, sphere,
                superellipse, tip, tube, turret, vents, windows)

FIGHTER_ACCENT, FIGHTER_GLOW = (0.8, 0.14, 0.05), (1.0, 0.35, 0.1)
CRUISER_ACCENT, CRUISER_GLOW = (0.1, 0.3, 0.9), (0.25, 0.55, 1.0)
BATTLESHIP_HULL, BATTLESHIP_ACCENT, BATTLESHIP_GLOW = (0.34, 0.37, 0.42), (0.5, 0.54, 0.6), (0.3, 0.6, 1.0)
SUPPORT_ACCENT, SUPPORT_GLOW, SUPPORT_CANOPY = (0.08, 0.62, 0.4), (0.3, 1.0, 0.6), (0.1, 0.5, 0.3)
OCT = math.pi / 8  # Achteck mit flacher Ober- und Unterseite


def missile(s, m, at, length=0.9, r=0.05, mirror=False):
    """Lenkwaffe unter einem Pylon: Körper, Spitze, vier Finnen."""
    x, y, z = at
    s.add(tube(10, r, r, -length * 0.4, length * 0.45), m["steel"], at=(x, y, z), mirror=mirror)
    s.add(tube(10, r, 0.0, -length * 0.4, -length * 0.62), m["plain"], at=(x, y, z), mirror=mirror)
    s.add(tube(10, r * 0.8, r * 0.8, length * 0.45, length * 0.5), m["dark"], at=(x, y, z), mirror=mirror)
    for angle in (45, 135, 225, 315):
        s.add(plate([(length * 0.2, 0), (length * 0.45, 0), (length * 0.45, r * 2.4), (length * 0.32, r * 2.4)], 0.012, "yz"),
              m["accent"], at=(x, y, z), rot=(0, angle, 0), mirror=mirror)


# ---------------------------------------------------------------- Jäger


def void_interceptor():
    s = Ship("void_interceptor")
    m = palette(s.name, FIGHTER_ACCENT, FIGHTER_GLOW, tile=1.4)
    N = 20
    # Rumpf: runder Querschnitt, zur Nadelnase auslaufend
    s.add(loft(smooth([
        tip(-3.3, 0, -0.03),
        sec(-2.6, superellipse(0.26, 0.2, N)),
        sec(-1.7, superellipse(0.6, 0.42, N)),
        sec(-0.6, superellipse(0.92, 0.6, N)),
        sec(0.5, superellipse(0.94, 0.62, N)),
        sec(1.5, superellipse(0.8, 0.54, N)),
        sec(2.2, superellipse(0.62, 0.46, N)),
        sec(2.5, superellipse(0.52, 0.4, N)),
    ], 2)), m["hull"])
    # Rückenverkleidung
    s.add(loft(smooth([sec(-0.9, rounded(0.3, 0.1, 0.04)), sec(-0.2, rounded(0.46, 0.26, 0.08)), sec(1.6, rounded(0.46, 0.28, 0.08)),
                       sec(2.4, rounded(0.3, 0.16, 0.05))], 2)), m["hull"], at=(0, 0, 0.26))
    # Kanzel: dunkler Rahmen, Glas, Spant
    s.add(loft(smooth([sec(-2.05, rounded(0.16, 0.04, 0.02)), sec(-1.6, rounded(0.42, 0.26, 0.08)), sec(-0.8, rounded(0.46, 0.3, 0.1)),
                       sec(-0.25, rounded(0.36, 0.18, 0.06))], 2)), m["dark"], at=(0, 0, 0.22))
    s.add(loft(smooth([sec(-1.95, rounded(0.12, 0.03, 0.015)), sec(-1.55, rounded(0.36, 0.24, 0.07)), sec(-0.8, rounded(0.4, 0.28, 0.09)),
                       sec(-0.35, rounded(0.3, 0.16, 0.05))], 2)), m["canopy"], at=(0, 0, 0.26))
    s.add(box(0.44, 0.04, 0.3), m["steel"], at=(0, -1.15, 0.33))
    # Nasensonde und Sensorring
    s.add(tube(8, 0.02, 0.012, -3.25, -3.8), m["steel"])
    s.add(tube(16, 0.12, 0.1, -2.85, -2.95), m["plain"], at=(0, 0, -0.02))
    # Lufteinlässe an den Flanken mit Splitterblech
    s.add(rbox(0.34, 1.3, 0.38, 0.06, 2), m["hull"], at=(0.56, -0.75, -0.04), mirror=True)
    s.add(box(0.26, 0.08, 0.3), m["plain"], at=(0.56, -1.4, -0.04), mirror=True)
    s.add(box(0.012, 0.12, 0.3), m["steel"], at=(0.56, -1.41, -0.04), mirror=True)
    # Klingenflügel mit Plattenfugen, Vorderkantenstreifen und Wurzelverkleidung
    wing = plate([(0.4, -1.1), (1.9, 0.95), (1.9, 1.3), (0.4, 1.6)], 0.08, "xy")
    inset(wing, 0.04, 0.01, 0.2)
    s.add(wing, m["hull"], at=(0, 0, -0.05), rot=(0, -4, 0), mirror=True)
    s.add(plate([(0.45, -1.05), (1.85, 0.95), (1.85, 1.1), (0.45, -0.82)], 0.1, "xy"), m["accent"], at=(0, 0, -0.05), rot=(0, -4, 0), mirror=True)
    s.add(loft(smooth([sec(-0.4, rounded(0.2, 0.1, 0.03)), sec(0.3, rounded(0.5, 0.2, 0.06)), sec(1.3, rounded(0.5, 0.2, 0.06)),
                       sec(1.95, rounded(0.25, 0.12, 0.04))], 1)), m["hull"], at=(0.55, 0, 0.0), mirror=True)
    # Flügelspitzen: Schiene, Positionslichter (rot backbord, grün steuerbord)
    s.add(tube(8, 0.035, 0.035, 0.85, 1.45), m["steel"], at=(1.92, 0, -0.18), mirror=True)
    s.add(sphere(0.045, 1), m["navgreen"], at=(1.92, 0.82, -0.18))
    s.add(sphere(0.045, 1), m["navred"], at=(-1.92, 0.82, -0.18))
    # Pylone mit Lenkwaffen
    for x in (1.05, 1.5):
        y = 0.35 + (x - 1.05) * 1.2
        s.add(box(0.05, 0.42, 0.14), m["dark"], at=(x, y, -0.16), mirror=True)
        missile(s, m, (x, y, -0.27), mirror=True)
    # Triebwerksgondeln unter den Flügeln
    s.add(loft(smooth([tip(-0.9), sec(-0.5, superellipse(0.5, 0.48, 16)), sec(0.6, superellipse(0.54, 0.52, 16)),
                       sec(1.9, superellipse(0.52, 0.5, 16))], 2)), m["hull"], at=(0.82, 0, -0.16), mirror=True)
    s.add(box(0.2, 1.4, 0.06), m["accent"], at=(0.82, 0.6, 0.1), mirror=True)
    s.add(hoop(16, 0.25, 0.3, 0.05), m["steel"], at=(0.82, -0.2, -0.16), rot=(90, 0, 0), mirror=True)
    s.engine(m, 0.26, 1.9, 2.55, dx=0.82, dz=-0.16, n=20, mirror=True)
    # V-Leitwerk mit Ruderfuge und Akzentkante
    fin = plate([(0.9, 0.0), (2.2, 0.0), (2.45, 0.75), (2.05, 0.8)], 0.05, "yz")
    inset(fin, 0.03, 0.008, 0.15)
    s.add(fin, m["hull"], at=(0.32, 0, 0.25), rot=(0, 32, 0), mirror=True)
    s.add(plate([(2.0, 0.7), (2.45, 0.74), (2.42, 0.82), (2.0, 0.82)], 0.06, "yz"), m["accent"], at=(0.32, 0, 0.25), rot=(0, 32, 0), mirror=True)
    # Kielflosse und Bauchsensor
    s.add(plate([(-0.6, 0.0), (1.8, 0.0), (1.7, -0.3), (0.0, -0.35)], 0.06, "yz"), m["hull"], at=(0, 0, -0.28))
    s.add(sphere(0.09, 2), m["plain"], at=(0, -1.6, -0.3))
    s.add(hoop(14, 0.09, 0.13, 0.04), m["steel"], at=(0, -1.6, -0.3))
    # Bugkanonen: Verkleidung, Lauf, Mündung, Glühen
    s.add(tube(12, 0.09, 0.07, -1.0, -2.3), m["dark"], at=(0.42, 0, -0.02), mirror=True)
    s.add(tube(12, 0.045, 0.04, -2.3, -3.4), m["steel"], at=(0.42, 0, -0.02), mirror=True)
    s.add(tube(12, 0.06, 0.06, -3.4, -3.52), m["plain"], at=(0.42, 0, -0.02), mirror=True)
    s.add(tube(8, 0.03, 0.03, -3.52, -3.58), m["glow"], at=(0.42, 0, -0.02), mirror=True)
    # Rückendetails: Antenne, Blattantenne, Lüfter, Kleinteile, Leuchtstreifen
    antenna(s, m, (0.22, 0.2, 0.4), 0.35, discs=1)
    s.add(plate([(0.9, 0.0), (1.15, 0.0), (1.1, 0.16), (0.95, 0.16)], 0.015, "yz"), m["steel"], at=(-0.15, 0, 0.4))
    vents(s, m, (0.3, 0.7, 0.4), 0.16, 0.1, slots=3, rot=(-90, 0, 0), mirror=True)
    greebles(s, m, (-0.18, 1.2, 0.18, 2.25), 0.4, 5, size=(0.05, 0.14), seed=3)
    s.add(box(0.04, 0.6, 0.05), m["glow"], at=(0.47, 0.5, 0.06), mirror=True)
    s.add(box(0.05, 1.2, 0.02), m["glow"], at=(0, 0.6, 0.405))
    return s.finish()



def canopy(s, m, at, length=1.6, width=0.46, height=0.3, mirror=False):
    """Kanzel: dunkler Rahmen, Glas, Spant; `at` ist das vordere Ende auf Höhe der Glasunterkante."""
    x, y, z = at
    frame = [sec(0.0, rounded(0.35 * width, 0.12 * height, 0.02)), sec(0.25 * length, rounded(0.92 * width, 0.85 * height, 0.08 * width)),
             sec(0.7 * length, rounded(width, height, 0.1 * width)), sec(length, rounded(0.8 * width, 0.6 * height, 0.06 * width))]
    s.add(loft(smooth(frame, 2)), m["dark"], at=(x, y, z - 0.04), mirror=mirror)
    glass = [sec(0.04 * length, rounded(0.28 * width, 0.1 * height, 0.015)), sec(0.27 * length, rounded(0.8 * width, 0.8 * height, 0.07 * width)),
             sec(0.7 * length, rounded(0.87 * width, 0.93 * height, 0.09 * width)), sec(0.95 * length, rounded(0.65 * width, 0.55 * height, 0.05 * width))]
    s.add(loft(smooth(glass, 2)), m["canopy"], at=(x, y, z), mirror=mirror)
    s.add(box(width * 0.96, 0.04, height * 0.9), m["steel"], at=(x, y + 0.5 * length, z + 0.03), mirror=mirror)


def tower(s, m, at, decks, per_deck=5):
    """Brückenturm aus gestapelten Decks mit Fensterreihen vorn und seitlich; liefert die Oberkante."""
    x, y, z = at
    for w, l, h in decks:
        s.add(rbox(w, l, h, 0.03, 1), m["hull"], at=(x, y, z + h / 2))
        s.add(box(w * 1.05, l * 1.05, 0.03), m["steel"], at=(x, y, z + h))
        windows(s, m, (x - w * 0.36, y - l / 2 - 0.01, z + h * 0.6), (x + w * 0.36, y - l / 2 - 0.01, z + h * 0.6), per_deck, (0.05, 0.03, 0.05))
        windows(s, m, (x + w / 2 + 0.01, y - l * 0.3, z + h * 0.6), (x + w / 2 + 0.01, y + l * 0.3, z + h * 0.6), max(per_deck - 2, 2), (0.03, 0.05, 0.05), mirror=True)
        z += h
    return z


def patch(s, m, at, size, rot=(0, 0, 0), mat="rust", studs=True):
    """Aufgeschweißte Platte mit Fuge und Schraubbolzen an den Ecken."""
    w, l = size
    part = box(w, l, 0.06)
    inset(part, 0.025, 0.008, 0.02)
    s.add(part, m[mat], at=at, rot=rot)
    if studs:
        for dx in (-w / 2 + 0.05, w / 2 - 0.05):
            for dy in (-l / 2 + 0.05, l / 2 - 0.05):
                s.add(post(6, 0.018, 0.015, 0.0, 0.05, dx, dy), m["steel"], at=at, rot=rot)


def solar_panel(s, m, at, width, length, rot=(0, 0, 0), cells=4, mirror=False):
    """Solarpaneel: dunkle Platte mit hellem Zellraster und Rahmen."""
    s.add(box(width, length, 0.03), m["steel"], at=at, rot=rot, mirror=mirror)
    s.add(box(width * 0.94, length * 0.94, 0.035), m["canopy"], at=at, rot=rot, mirror=mirror)
    for k in range(1, cells):
        s.add(box(width * 0.94, 0.012, 0.04), m["steel"], at=(at[0], at[1] - length / 2 + length * k / cells, at[2]), rot=rot, mirror=mirror)
    s.add(box(0.012, length * 0.94, 0.04), m["steel"], at=at, rot=rot, mirror=mirror)


def scrap_raider():
    s = Ship("scrap_raider")
    m = palette(s.name, (0.62, 0.24, 0.07), (1.0, 0.45, 0.12), hull=(0.3, 0.27, 0.24), style="scrap", tile=1.2, rust=(0.42, 0.2, 0.09))
    N = 16
    # Kantiger Rumpf mit senkrechter Rammschneide
    s.add(loft(smooth([
        sec(-3.0, rect(0.1, 0.5), n=N),
        sec(-2.3, superellipse(0.8, 0.55, N, 4)),
        sec(-1.0, superellipse(1.35, 0.85, N, 4)),
        sec(0.8, superellipse(1.45, 0.9, N, 4)),
        sec(2.2, superellipse(1.1, 0.72, N, 4)),
        sec(2.5, superellipse(0.9, 0.6, N, 4)),
    ], 1)), m["hull"])
    # Rammsporn: Stahlplatte und drei Stacheln
    s.add(plate([(-0.35, -0.3), (0.35, -0.3), (0.3, 0.3), (-0.3, 0.3)], 0.12, "xz"), m["steel"], at=(0, -2.75, 0.0))
    s.add(tube(8, 0.07, 0.0, -2.6, -3.7), m["steel"], at=(0, 0, 0.12))
    s.add(tube(8, 0.06, 0.0, -2.5, -3.3), m["steel"], at=(0.28, 0, -0.1), mirror=True)
    s.add(hoop(8, 0.07, 0.1, 0.06), m["plain"], at=(0, -2.85, 0.12), rot=(90, 0, 0))
    # Kanzel nach steuerbord versetzt, mit Schutzbügeln
    canopy(s, m, (0.22, -1.65, 0.46), 1.3, 0.4, 0.26)
    s.add(box(0.03, 1.0, 0.03), m["steel"], at=(0.1, -1.0, 0.68))
    s.add(box(0.03, 1.0, 0.03), m["steel"], at=(0.34, -1.0, 0.68))
    # Backbord: schwere Kanonengondel mit Kühlrippen, Mündungsbremse und Verschlussblock
    s.add(loft(smooth([sec(-1.7, superellipse(0.4, 0.4, N, 4)), sec(-1.2, superellipse(0.64, 0.6, N, 4)), sec(1.5, superellipse(0.64, 0.6, N, 4)),
                       sec(1.85, superellipse(0.46, 0.46, N, 4))], 1)), m["hull"], at=(-1.05, 0, -0.1))
    s.add(rbox(0.5, 0.5, 0.5, 0.04, 1), m["dark"], at=(-1.05, -1.75, -0.1))
    s.add(tube(12, 0.12, 0.1, -3.4, -1.9), m["steel"], at=(-1.05, 0, -0.1))
    for y in (-2.1, -2.3, -2.5, -2.7, -2.9):
        s.add(hoop(12, 0.1, 0.18, 0.06), m["dark"], at=(-1.05, y, -0.1), rot=(90, 0, 0))
    s.add(tube(12, 0.17, 0.17, -3.65, -3.4), m["plain"], at=(-1.05, 0, -0.1))
    s.add(box(0.08, 0.14, 0.4), m["plain"], at=(-1.05, -3.52, -0.1))
    s.add(tube(8, 0.05, 0.05, -3.72, -3.65), m["glow"], at=(-1.05, 0, -0.1))
    s.add(pipe([(-0.7, -0.6, 0.35), (-1.0, -1.0, 0.3), (-1.05, -1.5, 0.2)], 0.04), m["dark"])
    s.add(box(0.5, 1.4, 0.16), m["rust"], at=(-0.72, 0.3, 0.05))
    s.add(box(0.06, 0.8, 0.06), m["glow"], at=(-1.38, -0.4, 0.0))
    s.engine(m, 0.22, 1.85, 2.45, dx=-1.05, dz=-0.1, n=16)
    # Steuerbord: Stummelflügel mit Stachel, offenem Gitterträger und kleiner Gondel
    wing = plate([(0.7, -0.6), (1.5, -0.2), (1.6, 1.4), (0.7, 1.2)], 0.12, "xy")
    inset(wing, 0.04, 0.012, 0.1)
    s.add(wing, m["rust"], at=(0, 0, -0.05))
    s.add(tube(8, 0.07, 0.0, -0.3, -1.5), m["steel"], at=(1.45, 0, -0.05))
    for y0, y1 in ((-0.4, 0.4), (0.4, 1.2)):
        s.add(segment((0.72, y0, -0.12), (1.5, y1, -0.12), 0.025, 6), m["steel"])
        s.add(segment((1.5, y0, -0.12), (0.72, y1, -0.12), 0.025, 6), m["steel"])
    s.add(loft(smooth([tip(-0.9), sec(-0.5, superellipse(0.34, 0.34, 12, 4)), sec(1.4, superellipse(0.36, 0.36, 12, 4))], 1)), m["hull"], at=(1.25, 0, 0.16))
    s.engine(m, 0.17, 1.4, 1.95, dx=1.25, dz=0.16, n=12)
    s.add(box(0.06, 0.8, 0.06), m["glow"], at=(1.44, -0.3, 0.16))
    # Drei ungleiche Hauptdüsen, eine mit offenem Turbinenkranz
    s.engine(m, 0.3, 2.0, 2.65, dx=0.0, dz=0.28, n=16)
    s.engine(m, 0.26, 2.0, 2.55, dx=-0.42, dz=-0.2, n=16)
    s.engine(m, 0.24, 2.05, 2.5, dx=0.42, dz=-0.2, n=16)
    s.add(hoop(16, 0.3, 0.36, 0.08), m["steel"], at=(0, 2.1, 0.28), rot=(90, 0, 0))
    for angle in range(0, 180, 45):
        s.add(box(0.02, 0.06, 0.64), m["plain"], at=(0, 2.08, 0.28), rot=(0, angle, 0))
    # Zusammengeflickte Platten in schiefen Winkeln
    for x, y, z, tilt, w, l in ((0.5, -1.3, 0.4, 6, 0.5, 0.7), (-0.45, 0.3, 0.44, -4, 0.55, 0.9), (0.35, 1.3, 0.36, 4, 0.6, 0.5),
                                (0.72, -0.2, 0.08, 16, 0.3, 0.8), (-0.25, -1.9, 0.26, -8, 0.4, 0.5), (-0.68, 1.2, 0.0, -40, 0.3, 0.7),
                                (0.0, 0.2, -0.46, 3, 0.7, 1.1)):
        patch(s, m, (x, y, z), (w, l), rot=(0, tilt, 3))
    # Rohrleitungen, Abgasrohre, schiefe Schrottflosse, Gitterplatte
    s.add(pipe([(-0.5, -1.2, 0.48), (-0.5, 0.4, 0.54), (-0.3, 1.2, 0.5), (-0.3, 2.0, 0.45)], 0.045), m["dark"])
    s.add(pipe([(0.62, 0.6, 0.3), (0.72, 1.4, 0.32), (0.55, 2.0, 0.25)], 0.035), m["steel"])
    s.add(tube(8, 0.07, 0.07, -0.6, 1.4), m["plain"], at=(-0.55, 0.4, 0.52))
    s.add(tube(8, 0.05, 0.05, 1.4, 1.5), m["glow"], at=(-0.55, 0.4, 0.52))
    fin = plate([(0.4, 0.0), (1.5, 0.1), (1.3, 0.75), (0.7, 0.6)], 0.06, "yz")
    inset(fin, 0.03, 0.008, 0.1)
    s.add(fin, m["rust"], at=(-0.3, 0, 0.42), rot=(0, -25, 0))
    s.add(box(0.06, 0.5, 0.06), m["glow"], at=(-0.33, 0.9, 0.92), rot=(0, -25, 0))
    s.add(box(0.9, 0.5, 0.05), m["plain"], at=(0.1, 0.5, 0.47), rot=(0, 0, 5))
    for k in range(5):
        s.add(box(0.9, 0.03, 0.07), m["steel"], at=(0.1, 0.3 + 0.1 * k, 0.47), rot=(0, 0, 5))
    vents(s, m, (0.74, -1.6, 0.05), 0.2, 0.28, slots=4, rot=(0, 0, 90))
    # Scheinwerfer, Antennen, Kleinteile, Lichter
    s.add(dish(0.12, 0.05, 12, 2, 0.02), m["steel"], at=(0.55, -2.0, 0.2), rot=(10, 0, 0))
    s.add(sphere(0.05, 1), m["glow"], at=(0.55, -2.06, 0.21))
    antenna(s, m, (-0.4, 1.3, 0.5), 0.9, discs=2)
    antenna(s, m, (-0.62, 0.9, 0.48), 0.5, discs=1)
    greebles(s, m, (-0.2, -0.8, 0.5, 0.2), 0.44, 7, size=(0.05, 0.16), seed=5, mats=("dark", "steel", "rust", "plain"))
    s.add(box(0.5, 0.06, 0.06), m["glow"], at=(0, -2.25, 0.32))
    return s.finish()


# ---------------------------------------------------------------- Kreuzer


def horizon_cruiser():
    s = Ship("horizon_cruiser")
    m = palette(s.name, CRUISER_ACCENT, CRUISER_GLOW, tile=1.3)
    N = 24
    # Langer schlanker Rumpf mit flachem Bug
    s.add(loft(smooth([
        tip(-3.7, 0, 0.02),
        sec(-3.0, superellipse(0.5, 0.28, N, 3)),
        sec(-1.9, superellipse(1.1, 0.6, N, 3)),
        sec(-0.4, superellipse(1.5, 0.78, N, 3)),
        sec(1.6, superellipse(1.5, 0.78, N, 3)),
        sec(2.8, superellipse(1.2, 0.68, N, 3)),
        sec(3.4, superellipse(0.9, 0.5, N, 3)),
    ], 2)), m["hull"])
    # Rückgrat mit Plattendeck, Flankenpanzer mit Fugen
    s.add(loft(smooth([sec(-2.5, rounded(0.5, 0.2, 0.06)), sec(-1.6, rounded(0.76, 0.42, 0.1)), sec(2.2, rounded(0.76, 0.42, 0.1)),
                       sec(2.8, rounded(0.5, 0.3, 0.08))], 2)), m["hull"], at=(0, 0, 0.42))
    deck = plate([(-0.34, -1.5), (0.34, -1.5), (0.34, 1.0), (-0.34, 1.0)], 0.04, "xy")
    inset(deck, 0.03, 0.01, 0.1)
    s.add(deck, m["steel"], at=(0, 0, 0.64))
    armor = plate([(-2.2, -0.25), (2.2, -0.3), (2.2, 0.25), (-2.0, 0.2)], 0.1, "yz")
    inset(armor, 0.04, 0.012, 0.15)
    s.add(armor, m["hull"], at=(0.74, 0, 0.0), mirror=True)
    s.add(box(0.06, 3.6, 0.08), m["accent"], at=(0.78, 0, -0.2), mirror=True)
    # Bug: Geschützturm, Sensorkuppel, Bugsensoren
    turret(s, m, (0, -2.0, 0.42), barrel=0.9, r=0.28)
    s.add(sphere(0.14, 2), m["plain"], at=(0, -2.75, 0.32))
    s.add(hoop(16, 0.14, 0.19, 0.04), m["steel"], at=(0, -2.75, 0.32))
    s.add(tube(8, 0.04, 0.02, -1.4, 0.0), m["steel"], at=(0.35, -2.5, -0.08), mirror=True)
    s.add(box(0.1, 0.36, 0.1), m["glow"], at=(0, -1.25, 0.66))
    # Brückenturm mit Fensterreihen, Mast, Radar und Schüsseln
    top = tower(s, m, (0, 1.5, 0.62), [(1.0, 1.2, 0.42), (0.74, 0.84, 0.34), (0.48, 0.52, 0.28)], per_deck=5)
    antenna(s, m, (0, 1.75, top), 0.9, r=0.035, discs=2)
    s.add(box(0.7, 0.05, 0.05), m["steel"], at=(0, 1.75, top + 0.5))
    radar(s, m, (0, 1.2, top), 0.5, 0.2)
    s.add(dish(0.2, 0.07, 12, 2, 0.02), m["steel"], at=(0.45, 1.3, 1.1), rot=(-50, 0, -40), mirror=True)
    s.add(post(8, 0.03, 0.03, 0.0, 0.12, 0.45, 1.3), m["steel"], at=(0, 0, 0.98), mirror=True)
    # Gondeln an Pylonen: Einlassring, Leuchtstreifen, Düse
    s.add(loft(smooth([tip(-1.2), sec(-0.7, superellipse(0.46, 0.5, 16, 3)), sec(1.0, superellipse(0.54, 0.58, 16, 3)),
                       sec(2.5, superellipse(0.5, 0.54, 16, 3))], 2)), m["hull"], at=(1.12, 0, 0.02), mirror=True)
    s.add(hoop(16, 0.2, 0.26, 0.06), m["glow"], at=(1.12, -0.95, 0.02), rot=(90, 0, 0), mirror=True)
    s.add(hoop(16, 0.26, 0.3, 0.08), m["steel"], at=(1.12, -0.9, 0.02), rot=(90, 0, 0), mirror=True)
    pylon = plate([(0.6, -0.3), (1.12, 0.1), (1.12, 2.2), (0.6, 2.0)], 0.14, "xy")
    inset(pylon, 0.03, 0.01, 0.1)
    s.add(pylon, m["hull"], at=(0, 0, 0.05), mirror=True)
    s.add(box(0.05, 2.2, 0.1), m["glow"], at=(1.39, 0.9, 0.1), mirror=True)
    s.add(box(0.05, 2.2, 0.1), m["accent"], at=(1.39, 0.9, -0.1), mirror=True)
    s.engine(m, 0.26, 2.5, 3.2, dx=1.12, dz=0.02, n=20, mirror=True)
    s.add(sphere(0.04, 1), m["navgreen"], at=(1.4, -0.8, 0.02))
    s.add(sphere(0.04, 1), m["navred"], at=(-1.4, -0.8, 0.02))
    # Hauptdüsen, Flak, Raketenwerfer, Radiatoren
    s.engine(m, 0.22, 3.05, 3.65, dx=0.3, dz=-0.02, n=16, mirror=True)
    pd_turret(s, m, (0.45, 0.3, 0.6), r=0.11, mirror=True)
    pd_turret(s, m, (0.0, 2.95, 0.5), r=0.11, yaw=180)
    missile_pod(s, m, (0.98, -0.9, 0.3), size=(0.36, 0.8, 0.28), cells=(2, 2), mirror=True)
    for y in (-0.6, 0.0, 0.6, 1.2):
        s.add(box(0.5, 0.025, 0.18), m["steel"], at=(0.0, y, -0.5))
    s.add(plate([(-1.2, 0.0), (2.6, 0.0), (2.8, -0.45), (0.2, -0.4)], 0.08, "yz"), m["hull"], at=(0, 0, -0.32))
    # Heckflossen, Rohrleitungen, Kleinteile, Fenster, Lichter
    fin = plate([(1.4, 0.0), (2.6, -0.05), (2.9, 0.45), (2.2, 0.5)], 0.06, "yz")
    inset(fin, 0.025, 0.008, 0.1)
    s.add(fin, m["accent"], at=(0.78, 0, 0.12), rot=(0, 50, 0), mirror=True)
    s.add(pipe([(0.42, -1.4, 0.6), (0.42, 0.6, 0.62)], 0.03, 8, joints=False), m["plain"], mirror=True)
    greebles(s, m, (-0.3, -0.9, 0.3, 0.8), 0.66, 8, size=(0.05, 0.16), seed=7)
    vents(s, m, (0.6, -1.0, 0.25), 0.3, 0.14, slots=3, rot=(0, 0, 90), mirror=True)
    windows(s, m, (0.76, -1.6, 0.08), (0.76, 1.4, 0.08), 8, (0.03, 0.05, 0.04), mirror=True)
    s.add(box(0.05, 1.2, 0.08), m["glow"], at=(0.5, -2.1, 0.12), mirror=True)
    s.add(box(0.5, 0.06, 0.06), m["glow"], at=(0, -3.3, 0.12))
    return s.finish()


def plasma_frigate():
    s = Ship("plasma_frigate")
    m = palette(s.name, CRUISER_ACCENT, CRUISER_GLOW, tile=1.3, plasma=((0.55, 0.2, 1.0), (0.6, 0.25, 1.0)))
    N = 24
    # Gedrungener Rumpf
    s.add(loft(smooth([
        sec(-2.6, superellipse(0.8, 0.6, N, 3.5)),
        sec(-2.0, superellipse(1.2, 0.9, N, 3.5)),
        sec(-0.6, superellipse(1.9, 1.1, N, 3.5)),
        sec(1.0, superellipse(1.9, 1.1, N, 3.5)),
        sec(2.3, superellipse(1.3, 0.9, N, 3.5)),
        sec(2.6, superellipse(1.1, 0.8, N, 3.5)),
    ], 2)), m["hull"])
    side = plate([(0.3, -1.6), (0.9, -1.2), (0.9, 1.4), (0.3, 1.6)], 0.08, "xy")
    inset(side, 0.04, 0.012, 0.1)
    s.add(side, m["accent"], at=(0, 0, 0.56), mirror=True)
    # Hauptkanone: Lagerblock, Kühlvanes, Lauf, Beschleunigerringe, Mündung
    s.add(rbox(1.0, 1.2, 0.9, 0.08, 2), m["dark"], at=(0, -2.1, -0.05))
    s.add(tube(16, 0.34, 0.3, -3.2, -1.3), m["dark"], at=(0, 0, -0.05))
    for angle in range(0, 360, 60):
        s.add(plate([(-2.9, 0.3), (-1.6, 0.34), (-1.6, 0.52), (-2.7, 0.48)], 0.02, "yz"), m["steel"], at=(0, 0, -0.05), rot=(0, angle, 0))
    s.add(tube(16, 0.26, 0.24, -4.0, -3.2), m["steel"], at=(0, 0, -0.05))
    for k, y in enumerate((-3.0, -3.25, -3.5, -3.75)):
        s.add(hoop(16, 0.26, 0.42 if k % 2 else 0.38, 0.09), m["plasma" if k % 2 else "steel"], at=(0, y, -0.05), rot=(90, 0, 0))
    s.add(hoop(16, 0.2, 0.42, 0.1), m["plasma"], at=(0, -4.08, -0.05), rot=(90, 0, 0))
    s.add(tube(16, 0.18, 0.18, -4.16, -4.0), m["plasma"], at=(0, 0, -0.05))
    # Kondensatorbänke mit Plasmaleitungen zur Kanone
    for x, z in ((0.5, 0.6), (-0.5, 0.6), (0.18, 0.74), (-0.18, 0.74)):
        s.add(tube(16, 0.15, 0.15, -0.9, 0.9), m["steel"], at=(x, 0, z))
        s.add(hoop(16, 0.15, 0.18, 0.05), m["dark"], at=(x, -0.9, z), rot=(90, 0, 0))
        s.add(hoop(16, 0.15, 0.18, 0.05), m["dark"], at=(x, 0.9, z), rot=(90, 0, 0))
    s.add(pipe([(0.5, -0.95, 0.6), (0.5, -1.5, 0.5), (0.35, -2.1, 0.42)], 0.04), m["plasma"], mirror=True)
    s.add(pipe([(0.18, -0.95, 0.74), (0.18, -1.6, 0.6), (0.12, -2.0, 0.48)], 0.035), m["plasma"], mirror=True)
    s.add(box(0.06, 2.0, 0.1), m["plasma"], at=(0.84, -0.2, 0.2), mirror=True)
    # Vier Gondeln mit leuchtenden Einlassringen und Stützen
    for dz in (0.4, -0.4):
        s.add(loft(smooth([tip(-1.6), sec(-1.2, superellipse(0.6, 0.6, 16, 3)), sec(0.6, superellipse(0.66, 0.66, 16, 3)),
                           sec(1.7, superellipse(0.62, 0.62, 16, 3))], 2)), m["hull"], at=(1.22, 0, dz), mirror=True)
        s.add(hoop(16, 0.17, 0.27, 0.08), m["glow"], at=(1.22, -1.24, dz), rot=(90, 0, 0), mirror=True)
        s.add(hoop(16, 0.27, 0.31, 0.1), m["steel"], at=(1.22, -1.2, dz), rot=(90, 0, 0), mirror=True)
        s.engine(m, 0.26, 1.7, 2.3, dx=1.22, dz=dz, n=16, mirror=True)
    s.add(rbox(0.5, 0.7, 1.1, 0.04, 1), m["dark"], at=(1.05, 0.3, 0), mirror=True)
    s.add(rbox(0.5, 0.4, 1.1, 0.04, 1), m["dark"], at=(1.05, -0.8, 0), mirror=True)
    s.add(box(0.06, 0.8, 0.08), m["glow"], at=(0.82, -1.9, -0.2), mirror=True)
    # Brücke, Sensoren, Reaktorwulst achtern
    s.add(loft(smooth([sec(-1.5, rounded(0.3, 0.1, 0.04)), sec(-0.7, rounded(0.8, 0.44, 0.12)), sec(0.5, rounded(0.9, 0.5, 0.14)),
                       sec(1.1, rounded(0.5, 0.3, 0.08))], 2)), m["hull"], at=(0, 0, 0.72))
    windows(s, m, (-0.3, -1.2, 0.86), (0.3, -1.2, 0.86), 5, (0.05, 0.03, 0.05))
    windows(s, m, (0.42, -0.6, 0.86), (0.42, 0.4, 0.86), 4, (0.03, 0.05, 0.05), mirror=True)
    antenna(s, m, (-0.3, 1.0, 1.0), 0.5, discs=1)
    radar(s, m, (0.25, 0.9, 0.95), 0.35, 0.15)
    s.add(revolve([(0.0, 1.0), (0.5, 1.3), (0.55, 2.0), (0.45, 2.55), (0.0, 2.6)], 16), m["dark"], at=(0, 0, 0.55))
    s.add(hoop(16, 0.5, 0.58, 0.06), m["plasma"], at=(0, 1.7, 0.55), rot=(90, 0, 0))
    # Heckdüsen, Radiatoren, Kleinteile
    s.engine(m, 0.3, 2.3, 2.95, dx=0.4, dz=-0.05, n=20, mirror=True)
    for y in (-0.4, 0.1, 0.6, 1.1):
        s.add(box(0.6, 0.025, 0.2), m["steel"], at=(0, y, -0.62))
    vents(s, m, (0.95, 0.4, 0.3), 0.3, 0.16, slots=3, rot=(0, 0, 90), mirror=True)
    greebles(s, m, (-0.4, 1.3, 0.4, 2.2), 0.72, 6, size=(0.05, 0.14), seed=11)
    s.add(box(0.5, 0.06, 0.06), m["glow"], at=(0, -2.55, 0.35))
    return s.finish()


# ---------------------------------------------------------------- Schlachtschiffe


def deck_lights(s, m, polygon, z, spacing=0.55, size=0.06):
    """Randbefeuerung: kleine Leuchtpunkte entlang eines Polygons (x, y)."""
    pts = list(polygon)
    for a, b in zip(pts, pts[1:] + pts[:1]):
        length = math.hypot(b[0] - a[0], b[1] - a[1])
        count = max(int(length / spacing), 1)
        for k in range(count):
            t = (k + 0.5) / count
            s.add(box(size, size, 0.03), m["glow"], at=(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, z))


def iron_dreadnought():
    s = Ship("iron_dreadnought")
    m = palette(s.name, BATTLESHIP_ACCENT, BATTLESHIP_GLOW, hull=BATTLESHIP_HULL, tile=1.0, shield=((1.0, 0.15, 0.55), (1.0, 0.2, 0.6)))
    # Breiter, kantiger Keilrumpf
    s.add(loft([
        sec(-4.0, keel(0.6, 0.5)),
        sec(-2.8, keel(1.8, 0.9)),
        sec(-1.2, keel(3.6, 1.3)),
        sec(0.6, keel(4.4, 1.4)),
        sec(2.4, keel(3.8, 1.3)),
        sec(3.4, keel(2.6, 1.0)),
    ]), m["hull"], at=(0, 0, 0.1))
    # Panzerschürzen in zwei Lagen mit Plattenfugen
    skirt = plate([(0.6, -3.0), (2.3, -1.0), (2.6, 1.0), (2.2, 2.9), (0.6, 2.9)], 0.22, "xy")
    inset(skirt, 0.06, 0.02, 0.3)
    s.add(skirt, m["accent"], at=(0, 0, 0.3), mirror=True)
    lower = plate([(0.8, -2.2), (2.5, -0.4), (2.5, 1.6), (0.8, 2.4)], 0.2, "xy")
    inset(lower, 0.06, 0.02, 0.3)
    s.add(lower, m["hull"], at=(0, 0, -0.2), mirror=True)
    for y in (-1.6, -0.6, 0.4, 1.4):
        s.add(box(0.12, 0.04, 0.4), m["steel"], at=(2.35, y, 0.05), mirror=True)
    # Dorsaldeck mit Plattenfugen, vier Zwillingstürme (einer überhöht), Hecktürme
    s.add(loft([sec(-3.0, octagon(0.6, 0.3)), sec(-2.2, octagon(1.8, 0.5)), sec(2.6, octagon(2.2, 0.55)), sec(3.2, octagon(1.4, 0.4))]), m["hull"], at=(0, 0, 0.95))
    deckplate = plate([(-0.85, -2.1), (0.85, -2.1), (1.05, 2.4), (-1.05, 2.4)], 0.04, "xy")
    inset(deckplate, 0.05, 0.012, 0.2)
    s.add(deckplate, m["hull"], at=(0, 0, 1.24))
    turret(s, m, (0, -1.9, 1.24))
    s.add(post(20, 0.52, 0.5, 1.24, 1.5), m["hull"], at=(0, -0.4, 0))
    turret(s, m, (0, -0.4, 1.5))
    turret(s, m, (1.4, 0.9, 0.9), mirror=True)
    turret(s, m, (0.75, 3.0, 1.24), barrel=0.7, r=0.26, yaw=180, mirror=True)
    # Aufbauten: Hauptturm mit Fensterreihen, Mast, Radar, Kuppel; kleiner Heckturm
    top = tower(s, m, (0, 1.9, 1.24), [(1.6, 1.3, 0.5), (1.1, 0.9, 0.45), (0.7, 0.6, 0.4)], per_deck=6)
    antenna(s, m, (0, 2.0, top), 1.0, r=0.05, discs=3)
    s.add(box(1.0, 0.06, 0.06), m["steel"], at=(0, 2.0, top + 0.55))
    s.add(box(0.6, 0.06, 0.06), m["steel"], at=(0, 2.0, top + 0.8))
    radar(s, m, (0, 1.55, top), 0.6, 0.25)
    s.add(sphere(0.12, 2), m["plain"], at=(0.4, 2.2, top + 0.12))
    s.add(sphere(0.12, 2), m["plain"], at=(-0.4, 2.2, top + 0.12))
    s.add(dish(0.22, 0.08, 12, 2, 0.02), m["steel"], at=(0.7, 1.6, 1.95), rot=(-45, 0, -50), mirror=True)
    tower(s, m, (0, 2.95, 1.24), [(0.8, 0.5, 0.35)], per_deck=3)
    # Seitliche Kasematten mit Doppelrohren
    case = box(0.7, 1.6, 0.5)
    inset(case, 0.04, 0.012, 0.2)
    s.add(case, m["hull"], at=(2.1, 0.6, 0.35), mirror=True)
    for dx in (-0.15, 0.15):
        s.add(tube(10, 0.06, 0.05, -1.0, 0.0), m["steel"], at=(2.1 + dx, -0.1, 0.45), mirror=True)
        s.add(tube(10, 0.08, 0.08, -0.5, -0.3), m["dark"], at=(2.1 + dx, -0.1, 0.45), mirror=True)
    # Belagerungskanonen am Bug: Verschlussblock, Kühlringe, Lauf, Mündungsbremse
    s.add(rbox(0.5, 0.8, 0.5, 0.05, 1), m["dark"], at=(0.5, -2.3, 0.35), mirror=True)
    s.add(tube(14, 0.17, 0.15, -4.5, -2.7), m["steel"], at=(0.5, 0, 0.35), mirror=True)
    for y in (-2.9, -3.1, -3.3):
        s.add(hoop(14, 0.15, 0.22, 0.08), m["dark"], at=(0.5, y, 0.35), rot=(90, 0, 0), mirror=True)
    s.add(tube(14, 0.21, 0.21, -4.72, -4.45), m["plain"], at=(0.5, 0, 0.35), mirror=True)
    s.add(box(0.5, 0.14, 0.1), m["plain"], at=(0.5, -4.6, 0.35), mirror=True)
    s.add(tube(10, 0.1, 0.1, -4.8, -4.72), m["shield"], at=(0.5, 0, 0.35), mirror=True)
    # Schildemitter (magenta): Deckstreifen, Pylone mit Kugeln, Bugemitter
    s.add(box(0.08, 1.4, 0.1), m["shield"], at=(1.1, -1.4, 1.0), mirror=True)
    for y in (-2.3, -1.2, 0.1):
        s.add(post(8, 0.04, 0.03, 0.0, 0.3), m["steel"], at=(1.0, y, 1.24), mirror=True)
        s.add(sphere(0.07, 1), m["shield"], at=(1.0, y, 1.58), mirror=True)
    s.add(box(0.4, 0.06, 0.14), m["shield"], at=(0, -3.72, 0.5))
    # Flak, Raketenwerfer, Lüfter, Rohrleitungen, Kleinteile, Fenster
    pd_turret(s, m, (0.55, -2.75, 1.15), r=0.12, mirror=True)
    pd_turret(s, m, (1.7, 1.9, 0.76), r=0.12, mirror=True)
    pd_turret(s, m, (1.4, -0.2, 0.42), r=0.12, mirror=True)
    missile_pod(s, m, (2.0, -0.5, 0.56), size=(0.4, 0.9, 0.3), cells=(2, 2), mirror=True)
    vents(s, m, (1.65, 2.2, 0.62), 0.5, 0.2, slots=4, rot=(-90, 0, 0), mirror=True)
    vents(s, m, (2.46, 1.6, 0.05), 0.3, 0.2, slots=3, rot=(0, 0, 90), mirror=True)
    s.add(pipe([(0.85, -2.0, 1.26), (0.85, 1.2, 1.26)], 0.035, 8, joints=False), m["plain"], mirror=True)
    s.add(pipe([(1.9, -0.3, 0.42), (1.9, 2.3, 0.42), (1.6, 2.8, 0.42)], 0.03), m["dark"], mirror=True)
    greebles(s, m, (0.65, -1.6, 0.95, 1.4), 1.24, 8, size=(0.05, 0.16), seed=13, mirror=True)
    greebles(s, m, (1.4, -0.9, 2.1, 1.8), 0.41, 8, size=(0.07, 0.22), seed=17, mirror=True)
    windows(s, m, (2.31, -1.2, 0.2), (2.31, 2.2, 0.2), 8, (0.03, 0.06, 0.04), mirror=True)
    s.add(box(0.08, 1.2, 0.08), m["glow"], at=(2.2, 1.0, 0.65), mirror=True)
    s.add(box(0.06, 0.8, 0.08), m["glow"], at=(0.83, 1.9, 1.5), mirror=True)
    s.add(box(0.5, 0.06, 0.08), m["glow"], at=(0, 2.37, 2.3))
    # Kiel, Bauchsensor, Radiatoren, vier Heckdüsen
    keelfin = plate([(-2.0, 0.0), (2.8, 0.0), (2.9, -0.4), (-1.0, -0.35)], 0.1, "yz")
    inset(keelfin, 0.03, 0.01, 0.1)
    s.add(keelfin, m["hull"], at=(0, 0, -0.5))
    s.add(sphere(0.16, 2), m["plain"], at=(0, -2.2, -0.45))
    for y in (0.0, 0.5, 1.0, 1.5):
        s.add(box(1.0, 0.03, 0.2), m["steel"], at=(0, y, -0.7))
    for dz in (0.45, -0.25):
        s.engine(m, 0.32, 3.3, 4.0, dx=0.6, dz=dz, n=20, mirror=True)
    return s.finish()


def titan_carrier():
    s = Ship("titan_carrier")
    m = palette(s.name, BATTLESHIP_ACCENT, BATTLESHIP_GLOW, hull=BATTLESHIP_HULL, tile=1.0, core=((0.55, 0.2, 1.0), (0.6, 0.25, 1.0)))
    # Unterrumpf
    s.add(loft([
        sec(-3.8, keel(0.5, 0.4)),
        sec(-2.4, keel(2.2, 1.0)),
        sec(-0.4, keel(3.9, 1.35)),
        sec(2.2, keel(3.9, 1.35)),
        sec(3.4, keel(2.9, 1.05)),
        sec(3.8, keel(2.0, 0.8)),
    ]), m["hull"], at=(0, 0, -0.2))
    # Flugdeck in zwei Lagen, Landebahn, Katapultschienen, Aufzüge, Fangseile, Randbefeuerung
    deck = [(0.0, -4.1), (1.7, -2.5), (2.4, 0.2), (2.4, 2.6), (2.0, 3.8), (-2.0, 3.8), (-2.4, 2.6), (-2.4, 0.2), (-1.7, -2.5)]
    base = plate(deck, 0.2, "xy")
    inset(base, 0.06, 0.02, 0.5)
    s.add(base, m["accent"], at=(0, 0, 0.5))
    s.add(plate([(x * 0.93, y * 0.93) for x, y in deck], 0.05, "xy"), m["dark"], at=(0, 0, 0.62))
    s.add(box(0.05, 5.6, 0.03), m["glow"], at=(0.55, -0.4, 0.655), mirror=True)
    for y in range(-3, 4):
        s.add(box(0.08, 0.4, 0.03), m["glow"], at=(0, y * 0.9 - 0.3, 0.655))
    s.add(box(0.4, 0.05, 0.03), m["glow"], at=(0, -3.2, 0.655))
    s.add(box(0.05, 2.2, 0.03), m["accent"], at=(0.22, -2.4, 0.655), mirror=True)
    for x, y in ((1.5, 1.9), (-1.5, 0.3)):
        s.add(box(0.9, 1.1, 0.03), m["steel"], at=(x, y, 0.65))
        s.add(box(0.8, 1.0, 0.035), m["dark"], at=(x, y, 0.65))
    for y in (2.6, 2.9, 3.2):
        s.add(box(3.0, 0.02, 0.025), m["steel"], at=(0, y, 0.655))
    deck_lights(s, m, [(x * 0.96, y * 0.96) for x, y in deck], 0.66)
    # Hangars an den Flanken: Öffnung, beleuchteter Innenraum, Torrahmen, Deckslippe
    for y in (-0.6, 1.2):
        s.add(box(0.5, 1.3, 0.55), m["dark"], at=(2.2, y, 0.08), mirror=True)
        s.add(box(0.06, 1.0, 0.35), m["glow"], at=(2.46, y, 0.08), mirror=True)
        for dy in (-0.6, 0.6):
            s.add(box(0.1, 0.1, 0.6), m["steel"], at=(2.45, y + dy, 0.08), mirror=True)
        s.add(box(0.1, 1.3, 0.08), m["steel"], at=(2.45, y, 0.4), mirror=True)
        s.add(box(0.3, 1.5, 0.05), m["steel"], at=(2.5, y, -0.22), mirror=True)
    # Insel achtern mit Flugleitkanzel, Mast, Radar, Schüsseln
    top = tower(s, m, (0.9, 2.4, 0.64), [(1.2, 1.4, 0.45), (0.9, 1.0, 0.4), (0.6, 0.6, 0.35)], per_deck=5)
    canopy(s, m, (0.9, 1.55, 0.64 + 0.45), 0.5, 0.5, 0.18)
    antenna(s, m, (0.9, 2.5, top), 1.0, r=0.045, discs=3)
    s.add(box(0.8, 0.06, 0.06), m["steel"], at=(0.9, 2.5, top + 0.55))
    radar(s, m, (0.9, 2.05, top), 0.5, 0.22)
    s.add(dish(0.2, 0.07, 12, 2, 0.02), m["steel"], at=(1.3, 2.8, 1.5), rot=(-50, 0, -60))
    s.add(post(8, 0.03, 0.03, 0.0, 0.14, 1.3, 2.8), m["steel"], at=(0, 0, 1.36))
    antenna(s, m, (-1.4, 3.4, 0.66), 0.7, r=0.03, discs=1)
    # Drohnen auf dem Deck, Deckskran, Kleinteile
    for at, yaw in (((0.0, -0.8, 0.68), 0), ((-1.3, 1.6, 0.68), 12), ((1.5, 0.5, 0.68), -8)):
        s.add(plate([(0.0, -0.5), (0.42, 0.3), (0.0, 0.2), (-0.42, 0.3)], 0.07, "xy"), m["accent"], at=at, rot=(0, 0, yaw))
        s.add(loft(smooth([tip(-0.45), sec(-0.2, rounded(0.16, 0.1, 0.03)), sec(0.15, rounded(0.2, 0.14, 0.04)), sec(0.35, rounded(0.14, 0.1, 0.03))], 1)),
              m["hull"], at=(at[0], at[1], at[2] + 0.06), rot=(0, 0, yaw))
        s.add(sphere(0.05, 1), m["canopy"], at=(at[0], at[1] - 0.15, at[2] + 0.14), rot=(0, 0, yaw))
        s.add(tube(8, 0.05, 0.04, 0.3, 0.42), m["dark"], at=(at[0], at[1], at[2] + 0.06), rot=(0, 0, yaw))
    s.add(post(8, 0.05, 0.04, 0.0, 0.6, -1.9, 2.9), m["steel"], at=(0, 0, 0.66))
    s.add(box(0.05, 0.9, 0.05), m["steel"], at=(-1.9, 2.5, 1.26))
    s.add(box(0.4, 0.4, 0.3), m["hull"], at=(1.9, 3.1, 0.8))
    s.add(box(0.7, 0.3, 0.2), m["dark"], at=(-1.6, -1.0, 0.75))
    greebles(s, m, (-2.2, 0.4, -1.5, 2.0), 0.66, 6, size=(0.05, 0.16), seed=19)
    greebles(s, m, (1.6, -1.6, 2.2, -0.2), 0.66, 5, size=(0.05, 0.16), seed=23)
    # Geschütze auf Sponsons, Flak
    turret(s, m, (2.0, 2.0, 0.64), barrel=0.6, r=0.22, mirror=True)
    pd_turret(s, m, (2.15, 3.3, 0.64), r=0.12, yaw=180, mirror=True)
    pd_turret(s, m, (1.3, -2.6, 0.64), r=0.12, mirror=True)
    # Reaktorkern im Bug mit Streben, Bugsensoren
    s.add(plate(ngon(6, 0.5), 0.2, "xz"), m["dark"], at=(0, -3.75, 0.0))
    s.add(plate(ngon(6, 0.36), 0.3, "xz"), m["core"], at=(0, -3.95, 0.0))
    for angle in (90, 210, 330):
        s.add(segment((0, -3.6, 0), (0.55 * math.cos(math.radians(angle)), -3.7, 0.55 * math.sin(math.radians(angle))), 0.03, 6), m["steel"])
    s.add(tube(8, 0.03, 0.02, -1.2, 0.0), m["steel"], at=(0.5, -3.2, 0.3), mirror=True)
    # Rumpfseiten: Rohrleitungen, Fenster, Lüfter, Lichter
    s.add(pipe([(1.9, -1.8, -0.1), (2.3, -0.2, -0.1), (2.3, 2.4, -0.1), (1.9, 3.2, -0.1)], 0.035), m["plain"], mirror=True)
    windows(s, m, (1.6, -2.2, -0.35), (2.3, 0.2, -0.35), 6, (0.03, 0.06, 0.04), mirror=True)
    vents(s, m, (2.0, 3.2, 0.05), 0.3, 0.2, slots=3, rot=(0, 0, 90), mirror=True)
    s.add(box(0.08, 2.0, 0.08), m["glow"], at=(2.42, -1.4, 0.3), mirror=True)
    # Kiel, Bauchsensor, Radiatoren, Düsen
    keelfin = plate([(-3.6, -0.3), (-1.6, -0.3), (-1.2, -1.0), (-2.8, -0.9)], 0.1, "yz")
    inset(keelfin, 0.03, 0.01, 0.1)
    s.add(keelfin, m["hull"])
    s.add(sphere(0.14, 2), m["plain"], at=(0, 0.6, -0.9))
    for y in (1.2, 1.7, 2.2, 2.7):
        s.add(box(1.2, 0.03, 0.2), m["steel"], at=(0, y, -0.95))
    for dx, r in ((0.5, 0.34), (1.3, 0.26)):
        s.engine(m, r, 3.55, 4.3, dx=dx, dz=-0.15, n=20, mirror=True)
    return s.finish()


# ---------------------------------------------------------------- Unterstützer


def arm(s, m, points, r=0.06, claw=True):
    """Roboterarm: Segmente mit Gelenkkugeln, Hydraulikzylindern und Greifer am Ende."""
    pts = [tuple(p) for p in points]
    for a, b in zip(pts, pts[1:]):
        s.add(segment(a, b, r, 10), m["plain"])
        mid_a = tuple(x + (y - x) * 0.2 for x, y in zip(a, b))
        mid_b = tuple(x + (y - x) * 0.8 for x, y in zip(a, b))
        s.add(segment((mid_a[0], mid_a[1], mid_a[2] + r * 1.4), (mid_b[0], mid_b[1], mid_b[2] + r * 1.4), r * 0.4, 6), m["steel"])
    for p in pts[1:-1]:
        s.add(sphere(r * 1.5, 2), m["accent"], at=p)
    if claw:
        end = pts[-1]
        s.add(sphere(r * 1.2, 1), m["dark"], at=end)
        for dx in (-r * 1.2, r * 1.2):
            s.add(box(r * 0.5, r * 3.0, r * 2.0), m["steel"], at=(end[0] + dx, end[1], end[2] - r * 1.2))


def repair_drone():
    s = Ship("repair_drone")
    m = palette(s.name, SUPPORT_ACCENT, SUPPORT_GLOW, hull=WHITE, style="clean", tile=1.2, canopy_glow=SUPPORT_CANOPY,
                amber=((1.0, 0.55, 0.15), (1.0, 0.6, 0.2)), stripe=(0.95, 0.5, 0.1))
    N = 24
    body = superellipse
    # Runder Körper mit zwei Zierbändern
    s.add(loft(smooth([
        tip(-2.1), sec(-1.85, body(0.76, 0.64, N, 2.3)), sec(-1.3, body(1.44, 1.2, N, 2.3)), sec(-0.4, body(1.8, 1.48, N, 2.3)),
        sec(0.6, body(1.8, 1.48, N, 2.3)), sec(1.4, body(1.4, 1.16, N, 2.3)), sec(1.9, body(0.72, 0.6, N, 2.3)), tip(2.1),
    ], 2)), m["hull"])
    s.add(loft([sec(-0.45, body(1.84, 1.52, N, 2.3)), sec(-0.2, body(1.84, 1.52, N, 2.3))]), m["accent"])
    s.add(loft([sec(0.35, body(1.84, 1.52, N, 2.3)), sec(0.48, body(1.84, 1.52, N, 2.3))]), m["stripe"])
    # Kanzel mit grünem Rahmen, Sensorauge und kleine Linse vorn
    s.add(loft(smooth([sec(-1.65, rounded(0.44, 0.1, 0.04)), sec(-1.2, rounded(0.8, 0.36, 0.1)), sec(-0.3, rounded(0.86, 0.4, 0.12)),
                       sec(0.15, rounded(0.54, 0.18, 0.06))], 2)), m["accent"], at=(0, 0, 0.54))
    canopy(s, m, (0, -1.6, 0.62), 1.6, 0.7, 0.3)
    s.add(hoop(16, 0.2, 0.3, 0.1), m["dark"], at=(0.42, -1.72, 0.05), rot=(90, 0, 0))
    s.add(hoop(16, 0.3, 0.34, 0.06), m["steel"], at=(0.42, -1.74, 0.05), rot=(90, 0, 0))
    s.add(sphere(0.2, 2), m["canopy"], at=(0.42, -1.75, 0.05))
    s.add(hoop(12, 0.1, 0.17, 0.08), m["dark"], at=(-0.45, -1.68, -0.18), rot=(90, 0, 0))
    s.add(sphere(0.1, 1), m["glow"], at=(-0.45, -1.7, -0.18))
    s.add(dish(0.12, 0.05, 12, 2, 0.02), m["steel"], at=(-0.15, -1.95, -0.3), rot=(10, 0, 0))
    s.add(sphere(0.05, 1), m["amber"], at=(-0.15, -2.01, -0.29))
    # Seitliche Triebwerksgondeln mit Streben
    s.add(loft(smooth([tip(-0.95), sec(-0.6, body(0.6, 0.6, 16, 2.5)), sec(1.0, body(0.68, 0.68, 16, 2.5)), sec(1.5, body(0.64, 0.64, 16, 2.5))], 2)),
          m["hull"], at=(1.2, 0, -0.1), mirror=True)
    s.add(rbox(0.6, 0.7, 0.3, 0.04, 1), m["dark"], at=(0.85, 0.3, -0.1), mirror=True)
    s.add(box(0.05, 1.2, 0.08), m["glow"], at=(1.5, 0.4, -0.1), mirror=True)
    s.add(box(0.16, 0.9, 0.04), m["stripe"], at=(1.2, 0.3, 0.23), mirror=True)
    s.engine(m, 0.26, 1.5, 2.1, dx=1.2, dz=-0.1, n=16, mirror=True)
    s.add(sphere(0.04, 1), m["navgreen"], at=(1.52, -0.5, -0.1))
    s.add(sphere(0.04, 1), m["navred"], at=(-1.52, -0.5, -0.1))
    # Gefaltete Reparaturarme oben mit Schultergelenken
    for sx in (1, -1):
        s.add(rbox(0.22, 0.32, 0.22, 0.03, 1), m["dark"], at=(sx * 0.4, 0.5, 0.78))
        arm(s, m, [(sx * 0.4, 0.5, 0.9), (sx * 0.4, -0.2, 1.35), (sx * 0.4, 0.45, 1.6), (sx * 0.35, 0.9, 1.5)], r=0.055)
    # Ausgestreckter Schweißarm rechts unten mit Brenner
    s.add(rbox(0.3, 0.3, 0.2, 0.03, 1), m["dark"], at=(0.7, -0.9, -0.5))
    arm(s, m, [(0.75, -0.9, -0.5), (0.95, -1.5, -0.45), (0.95, -2.0, -0.42)], r=0.05, claw=False)
    s.add(tube(8, 0.05, 0.03, -0.35, 0.0), m["steel"], at=(0.95, -2.0, -0.42))
    s.add(sphere(0.045, 1), m["amber"], at=(0.95, -2.37, -0.42))
    # Werkzeugträger, Frachtkapsel unter dem Bauch
    s.add(rbox(0.3, 0.6, 0.2, 0.03, 1), m["dark"], at=(-0.65, 0.3, 0.55))
    for k in range(4):
        s.add(tube(6, 0.025, 0.02, -0.25, 0.0), m["steel"], at=(-0.72 + 0.05 * k, 0.0, 0.58))
    s.add(loft(smooth([tip(-0.9), sec(-0.6, body(0.5, 0.4, 16, 2.5)), sec(0.6, body(0.56, 0.44, 16, 2.5)), sec(1.0, body(0.46, 0.36, 16, 2.5)), tip(1.2)], 1)),
          m["hull"], at=(0, 0.3, -0.78))
    s.add(loft([sec(-0.2, body(0.58, 0.46, 16, 2.5)), sec(-0.05, body(0.58, 0.46, 16, 2.5))]), m["stripe"], at=(0, 0.3, -0.78))
    s.add(loft([sec(0.3, body(0.58, 0.46, 16, 2.5)), sec(0.45, body(0.58, 0.46, 16, 2.5))]), m["stripe"], at=(0, 0.3, -0.78))
    # Antenne, Radar, Fenster, Lüfter, Kleinteile, Lichter, Heckdüsen
    antenna(s, m, (-0.35, 1.3, 0.6), 0.5, discs=1)
    radar(s, m, (0.3, 1.2, 0.6), 0.3, 0.12, yaw=20)
    windows(s, m, (0.88, -0.9, 0.15), (0.88, 0.1, 0.15), 3, (0.03, 0.06, 0.05), mirror=True)
    vents(s, m, (0.0, 1.2, 0.68), 0.3, 0.14, slots=3, rot=(-90, 0, 0))
    greebles(s, m, (-0.5, 0.7, 0.5, 1.5), 0.6, 5, size=(0.05, 0.14), seed=29, mats=("dark", "steel", "hull"))
    s.add(box(0.5, 0.06, 0.06), m["amber"], at=(0.0, -1.9, 0.38))
    s.add(box(0.05, 0.6, 0.06), m["glow"], at=(0.86, -0.6, 0.3), mirror=True)
    s.engine(m, 0.2, 1.95, 2.5, dx=0.3, dz=-0.25, n=16, mirror=True)
    return s.finish()


def signal_booster():
    s = Ship("signal_booster")
    m = palette(s.name, SUPPORT_ACCENT, SUPPORT_GLOW, hull=WHITE, style="clean", tile=1.2, canopy_glow=SUPPORT_CANOPY,
                cyan=((0.2, 0.9, 1.0), (0.2, 0.9, 1.0)))
    N = 20
    # Kantig-runder Rumpf, Gerätedeck oben, Akzentplatte unten
    s.add(loft(smooth([
        sec(-2.4, superellipse(0.6, 0.4, N, 4)), sec(-1.6, superellipse(1.4, 0.8, N, 4)), sec(0.6, superellipse(1.7, 0.95, N, 4)),
        sec(1.8, superellipse(1.3, 0.8, N, 4)), sec(2.3, superellipse(0.9, 0.6, N, 4)),
    ], 2)), m["hull"])
    deck = rbox(1.0, 1.6, 0.3, 0.04, 1)
    inset(deck, 0.04, 0.01, 0.3)
    s.add(deck, m["dark"], at=(0, 0.2, 0.55))
    belly = plate([(-0.35, -1.1), (0.35, -1.1), (0.35, 1.1), (-0.35, 1.1)], 0.08, "xy")
    inset(belly, 0.03, 0.01, 0.2)
    s.add(belly, m["accent"], at=(0, 0, -0.5))
    # Große Hauptschüssel auf Gabelmast mit Rippen, Randleuchte und Speisehorn
    s.add(post(10, 0.1, 0.08, 0.5, 1.3, 0.2, -0.3), m["steel"])
    s.add(rbox(0.5, 0.22, 0.22, 0.03, 1), m["dark"], at=(0.2, -0.3, 1.3))
    s.add(hoop(16, 0.14, 0.18, 0.06), m["steel"], at=(0.2, -0.3, 1.3), rot=(0, 90, 0))
    tilt = -55
    g = Ship("dish")
    g.add(dish(1.1, 0.36, 24, 5, 0.04), m["hull"])
    for angle in range(0, 360, 30):
        g.add(plate([(0.0, 0.0), (0.07, 0.0), (-0.3, 1.06), (-0.37, 1.06)], 0.02, "yz"), m["steel"], rot=(0, angle, 0))
    g.add(hoop(24, 1.06, 1.13, 0.05), m["cyan"], at=(0, -0.36, 0), rot=(90, 0, 0))
    g.add(sphere(0.08, 1), m["dark"], at=(0, 0.06, 0))
    for angle in (90, 210, 330):
        rim = (0.95 * math.cos(math.radians(angle)), -0.3, 0.95 * math.sin(math.radians(angle)))
        g.add(segment(rim, (0, -0.84, 0), 0.02, 6), m["steel"])
    g.add(box(0.14, 0.14, 0.14), m["dark"], at=(0, -0.84, 0))
    g.add(sphere(0.06, 1), m["cyan"], at=(0, -0.92, 0))
    s.place(g, at=(0.2, -0.3, 1.45), rot=(tilt, 0, 0))
    g.bm.free()
    # Zwei kleine Schüsseln achtern, Relaismasten mit Querstreben und Geräteboxen
    s.add(post(8, 0.04, 0.04, 0.3, 0.75, 0.95, 1.0), m["steel"], mirror=True)
    s.add(dish(0.4, 0.14, 16, 3, 0.03), m["hull"], at=(0.95, 1.0, 0.8), rot=(-40, 0, -30), mirror=True)
    s.add(sphere(0.03, 1), m["cyan"], at=(0.95, 0.72, 1.0), mirror=True)
    s.add(post(8, 0.05, 0.03, 0.4, 2.2, -0.65, 1.5), m["steel"])
    for z in (1.6, 1.9, 2.1):
        s.add(box(0.5, 0.05, 0.05), m["steel"], at=(-0.65, 1.5, z))
        s.add(box(0.06, 0.06, 0.12), m["plain"], at=(-0.42, 1.5, z), mirror=False)
    s.add(sphere(0.03, 1), m["navred"], at=(-0.65, 1.5, 2.24))
    s.add(post(8, 0.04, 0.03, 0.4, 1.7, 0.7, -1.5), m["steel"])
    s.add(rbox(0.22, 0.22, 0.32, 0.03, 1), m["dark"], at=(0.7, -1.5, 1.1))
    s.add(box(0.4, 0.05, 0.05), m["steel"], at=(0.7, -1.5, 1.5))
    s.add(sphere(0.04, 1), m["cyan"], at=(0.7, -1.5, 1.72))
    # Signalring um den Rumpf mit vier Emittern
    s.add(hoop(32, 1.72, 1.78, 0.04), m["cyan"], at=(0, 0.2, -0.1), rot=(6, 0, 0))
    s.add(hoop(32, 1.78, 1.86, 0.025), m["steel"], at=(0, 0.2, -0.1), rot=(6, 0, 0))
    for angle in (0, 90, 180, 270):
        x, y = 1.76 * math.cos(math.radians(angle)), 1.76 * math.sin(math.radians(angle))
        s.add(box(0.12, 0.12, 0.1), m["dark"], at=(x, 0.2 + y, -0.1 - 0.02 * y / 1.76 * 1.76), rot=(6, 0, 0))
    # Solarpaneele an Auslegern
    for sx in (1, -1):
        s.add(segment((sx * 0.8, 0.9, 0.2), (sx * 1.45, 1.0, 0.45), 0.03, 6), m["steel"])
        solar_panel(s, m, (sx * 1.9, 1.0, 0.5), 0.9, 0.7, rot=(0, sx * 15, 0), cells=3)
    # Seitliche Gondeln mit Streben
    s.add(loft(smooth([tip(-0.8), sec(-0.5, superellipse(0.56, 0.56, 16, 3)), sec(1.0, superellipse(0.62, 0.62, 16, 3)), sec(1.6, superellipse(0.58, 0.58, 16, 3))], 2)),
          m["hull"], at=(1.25, 0, -0.15), mirror=True)
    s.add(rbox(0.6, 0.6, 0.3, 0.04, 1), m["dark"], at=(0.9, 0.5, -0.15), mirror=True)
    s.add(box(0.16, 0.8, 0.04), m["accent"], at=(1.25, 0.2, 0.15), mirror=True)
    s.engine(m, 0.23, 1.6, 2.15, dx=1.25, dz=-0.15, n=16, mirror=True)
    # Bugsensorcluster, Kanzel, Fenster, Lüfter, Kleinteile, Lichter
    s.add(rbox(0.5, 0.3, 0.3, 0.04, 1), m["dark"], at=(0, -2.35, 0.1))
    s.add(sphere(0.14, 2), m["cyan"], at=(0, -2.5, 0.1))
    s.add(hoop(16, 0.14, 0.19, 0.05), m["steel"], at=(0, -2.5, 0.1), rot=(90, 0, 0))
    s.add(tube(6, 0.02, 0.012, -0.5, 0.0), m["steel"], at=(0.2, -2.5, 0.22), mirror=True)
    canopy(s, m, (-0.25, -1.9, 0.45), 0.9, 0.4, 0.2)
    windows(s, m, (0.78, -1.0, 0.1), (0.78, 0.6, 0.1), 4, (0.03, 0.06, 0.05), mirror=True)
    vents(s, m, (0.86, -1.2, 0.2), 0.3, 0.14, slots=3, rot=(0, 0, 90), mirror=True)
    greebles(s, m, (-0.45, -0.5, 0.45, 0.95), 0.7, 7, size=(0.05, 0.14), seed=31, mats=("dark", "steel", "hull", "plain"))
    s.add(box(0.05, 1.0, 0.08), m["glow"], at=(0.86, -0.4, 0.2), mirror=True)
    s.add(box(0.5, 0.06, 0.06), m["glow"], at=(0, -2.3, 0.3))
    return s.finish()

SHIPS = {
    "void_interceptor": void_interceptor,
    "scrap_raider": scrap_raider,
    "horizon_cruiser": horizon_cruiser,
    "plasma_frigate": plasma_frigate,
    "iron_dreadnought": iron_dreadnought,
    "titan_carrier": titan_carrier,
    "repair_drone": repair_drone,
    "signal_booster": signal_booster,
}


def build(ship_id):
    return SHIPS[ship_id]()
