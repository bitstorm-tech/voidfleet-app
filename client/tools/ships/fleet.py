"""Die Schiffe von Voidfleet samt der Tokens (Drohne, Trugbild) und der Flaggschiffe der Admirale, je eine Funktion
pro Karten-ID (siehe shared/cards.ts).

Größen in Blender-Einheiten; auf dem Brett wirkt MODEL_SCALE × BOARD_SCALE aus ship.ts.
Jäger ~6, Kreuzer ~6-7.5, Schlachtschiffe ~8.5, Unterstützer ~5, Flaggschiffe 10-11 (die Mirage ~9) Einheiten lang.
Vorn ist -Y, oben +Z; `mirror=True` spiegelt ein Teil an der Längsachse. Der Slot liegt auf dem Brett bei z = -1,4.
"""

import math

import bmesh
from mathutils import Vector
from mathutils.bvhtree import BVHTree

from vf import (WHITE, Ship, antenna, box, dish, greebles, hexagon, hoop, inset, iridescent, keel, loft, material, missile_pod, ngon, octagon,
                palette, pd_turret, pipe, plate, post, radar, rbox, rect, revolve, rounded, sec, segment, smooth, sphere,
                superellipse, sweep, tip, tube, turret, vents, windows)

FIGHTER_ACCENT, FIGHTER_GLOW = (0.8, 0.14, 0.05), (1.0, 0.35, 0.1)
CRUISER_ACCENT, CRUISER_GLOW = (0.1, 0.3, 0.9), (0.25, 0.55, 1.0)
BATTLESHIP_HULL, BATTLESHIP_ACCENT, BATTLESHIP_GLOW = (0.34, 0.37, 0.42), (0.5, 0.54, 0.6), (0.3, 0.6, 1.0)
SUPPORT_ACCENT, SUPPORT_GLOW, SUPPORT_CANOPY = (0.08, 0.62, 0.4), (0.3, 1.0, 0.6), (0.1, 0.5, 0.3)
DRONE_ACCENT, DRONE_GLOW = (0.3, 0.16, 0.62), (0.6, 0.25, 1.0)  # Farben des Titan Carriers
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


def drone():
    """Unbemannter Jäger des Titan Carriers (Token, keine Deck-Karte): kleiner als die Jäger, in den Farben des Trägers."""
    s = Ship("drone")
    m = palette(s.name, DRONE_ACCENT, DRONE_GLOW, hull=BATTLESHIP_HULL, tile=0.9, canopy_glow=DRONE_GLOW)
    # Keilrumpf: facettierter Achteck-Querschnitt, vorn flach und spitz
    s.add(loft(smooth([
        tip(-2.0, 0, -0.02),
        sec(-1.6, octagon(0.34, 0.16, 0.35)),
        sec(-0.9, octagon(0.62, 0.32, 0.35)),
        sec(0.0, octagon(0.78, 0.42, 0.35)),
        sec(0.9, octagon(0.74, 0.4, 0.35)),
        sec(1.35, octagon(0.6, 0.34, 0.35)),
    ], 2)), m["hull"])
    # Rückenbuckel mit Sensorauge statt Kanzel: dunkler Rahmen, leuchtender Schlitz
    s.add(loft(smooth([sec(-1.1, rounded(0.2, 0.06, 0.02)), sec(-0.6, rounded(0.42, 0.2, 0.06)), sec(0.5, rounded(0.44, 0.22, 0.06)),
                       sec(1.2, rounded(0.3, 0.12, 0.04))], 2)), m["accent"], at=(0, 0, 0.17))
    s.add(loft(smooth([sec(-0.95, rounded(0.16, 0.04, 0.015)), sec(-0.7, rounded(0.34, 0.16, 0.05)), sec(-0.3, rounded(0.34, 0.16, 0.05)),
                       sec(-0.15, rounded(0.24, 0.08, 0.03))], 1)), m["dark"], at=(0, 0, 0.27))
    s.add(loft(smooth([sec(-0.9, rounded(0.12, 0.03, 0.012)), sec(-0.68, rounded(0.28, 0.14, 0.04)), sec(-0.35, rounded(0.28, 0.14, 0.04)),
                       sec(-0.22, rounded(0.18, 0.06, 0.02))], 1)), m["canopy"], at=(0, 0, 0.3))
    s.add(box(0.012, 0.42, 0.012), m["steel"], at=(0, 0.2, 0.39))
    # Bugsensor und Leuchtschlitze an den Bugflanken (rot wie auf der Karte)
    s.add(tube(8, 0.016, 0.01, -1.95, -2.35), m["steel"], at=(0, 0, -0.02))
    s.add(plate([(-1.3, 0.0), (-0.75, 0.0), (-0.8, 0.05), (-1.25, 0.05)], 0.02, "yz"), m["navred"], at=(0.29, 0, 0.0), rot=(0, 18, 0), mirror=True)
    # Gepfeilte Flügel mit Plattenfuge, Akzentstreifen an der Vorderkante und Wurzelverkleidung
    wing = plate([(0.3, -0.45), (1.75, 0.55), (1.75, 0.78), (0.3, 0.95)], 0.06, "xy")
    inset(wing, 0.03, 0.008, 0.12)
    s.add(wing, m["hull"], at=(0, 0, 0.0), rot=(0, -3, 0), mirror=True)
    s.add(plate([(0.35, -0.4), (1.7, 0.55), (1.7, 0.63), (0.35, -0.27)], 0.075, "xy"), m["accent"], at=(0, 0, 0.0), rot=(0, -3, 0), mirror=True)
    s.add(box(0.02, 0.3, 0.02), m["navred"], at=(1.1, 0.42, 0.06), rot=(0, -3, 34), mirror=True)
    s.add(loft(smooth([sec(-0.55, rounded(0.14, 0.08, 0.02)), sec(-0.1, rounded(0.36, 0.16, 0.05)), sec(0.7, rounded(0.36, 0.16, 0.05)),
                       sec(1.1, rounded(0.18, 0.1, 0.03))], 1)), m["hull"], at=(0.42, 0, 0.0), mirror=True)
    # Flügelspitzen mit nach außen geneigten Flossen und Positionslichtern
    tipfin = plate([(0.42, -0.04), (0.84, -0.04), (0.9, 0.3), (0.68, 0.32)], 0.04, "yz")
    inset(tipfin, 0.02, 0.006, 0.05)
    s.add(tipfin, m["hull"], at=(1.72, 0, -0.07), rot=(0, 14, 0), mirror=True)
    s.add(plate([(0.66, 0.28), (0.9, 0.27), (0.91, 0.34), (0.67, 0.35)], 0.05, "yz"), m["accent"], at=(1.72, 0, -0.07), rot=(0, 14, 0), mirror=True)
    s.add(sphere(0.03, 1), m["navgreen"], at=(1.77, 0.4, -0.08))
    s.add(sphere(0.03, 1), m["navred"], at=(-1.77, 0.4, -0.08))
    # Bugkanonen in den Flügelwurzeln
    s.add(tube(10, 0.06, 0.05, -0.5, -1.1), m["dark"], at=(0.52, 0, -0.06), mirror=True)
    s.add(tube(10, 0.03, 0.026, -1.1, -1.65), m["steel"], at=(0.52, 0, -0.06), mirror=True)
    s.add(tube(8, 0.018, 0.018, -1.65, -1.69), m["glow"], at=(0.52, 0, -0.06), mirror=True)
    # Zwei Triebwerke mit Einlaufring, dazwischen ein Kühlschlitz
    ex, ez = 0.3, -0.04
    s.add(loft(smooth([tip(-0.6), sec(-0.3, superellipse(0.36, 0.32, 16)), sec(0.6, superellipse(0.4, 0.36, 16)),
                       sec(1.3, superellipse(0.38, 0.34, 16))], 2)), m["hull"], at=(ex, 0, ez), mirror=True)
    s.add(hoop(16, 0.17, 0.21, 0.04), m["steel"], at=(ex, 0.3, ez), rot=(90, 0, 0), mirror=True)
    s.engine(m, 0.17, 1.3, 1.75, dx=ex, dz=ez, n=16, mirror=True)
    s.add(box(0.16, 0.04, 0.06), m["glow"], at=(0, 1.36, 0.02))
    s.add(box(0.2, 0.06, 0.1), m["dark"], at=(0, 1.35, 0.02))
    # Kielflosse, Bauchsensor, Antenne, Lüfter, Kleinteile, Leuchtstreifen
    s.add(plate([(0.1, 0.0), (1.2, 0.0), (1.15, -0.2), (0.4, -0.22)], 0.04, "yz"), m["hull"], at=(0, 0, -0.18))
    s.add(sphere(0.06, 2), m["plain"], at=(0, -0.7, -0.19))
    s.add(hoop(12, 0.06, 0.09, 0.03), m["steel"], at=(0, -0.7, -0.19))
    antenna(s, m, (0.14, 0.75, 0.33), 0.22, r=0.015, discs=1)
    vents(s, m, (0.17, 0.25, 0.33), 0.1, 0.07, slots=3, rot=(-90, 0, 0), mirror=True)
    greebles(s, m, (-0.12, 0.6, 0.12, 1.05), 0.3, 4, size=(0.03, 0.09), seed=7)
    s.add(box(0.03, 0.5, 0.03), m["glow"], at=(0.37, 0.15, 0.1), mirror=True)
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


# ---------------------------------------------------------------- Flaggschiffe der Admirale
#
# Gemeinsames Kennzeichen: die weiß-goldene Kommando-Zierlinie entlang des Rumpfs, eine Wappenplatte
# auf dem Rücken, eine erhöhte Brücke mit Fensterlichtern und Leuchten in der Admiralsfarbe (wie im UI).
# Größer als die Deckschiffe: 10-11 Einheiten lang, die Mirage als Jäger etwa 9.


def linear(code):
    """UI-Farbe (sRGB, "#RRGGBB") als lineares RGB, wie es die Materialien erwarten."""
    rgb = [int(code[i:i + 2], 16) / 255 for i in (1, 3, 5)]
    return tuple(c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4 for c in rgb)


TRIM = linear("#F4D68C")
OSEI, VANCE, HALVORSEN, MOREAU, KERR = (linear(c) for c in ("#E8A33A", "#E2483D", "#9D5CF2", "#33D1C6", "#5B8DFF"))


def flagship_palette(ship, color, accent, hull=BATTLESHIP_HULL, tile=1.0, **extra):
    """Materialsatz eines Flaggschiffs: Düsen und Leuchtfeuer (`glow`, Stärke 20) in der Admiralsfarbe, dazu
    `signal` für die Kennzeichen: leuchtet genau in der UI-Farbe des Admirals (das Spiel hat kein Tone-Mapping und
    für Schiffe keinen Bloom, Stärke 20 brennt dort fast weiß aus); dazu die weiß-goldene Zierlinie (`trim`)."""
    m = palette(ship, accent, color, hull=hull, tile=tile, **extra)
    m["signal"] = material(f"{ship}_signal", tuple(c * 0.3 for c in color), 0.0, 0.4, emission=color, strength=1.0)
    m["trim"] = material(f"{ship}_trim", TRIM, 0.9, 0.3, emission=TRIM, strength=0.8)
    return m


def grow(points, d):
    """Konvexes Polygon (x, y) um d nach außen versetzt."""
    n = len(points)
    sign = 1 if sum(points[i][0] * points[(i + 1) % n][1] - points[(i + 1) % n][0] * points[i][1] for i in range(n)) > 0 else -1
    out = []
    for i in range(n):
        p0, p1, p2 = Vector(points[i - 1]), Vector(points[i]), Vector(points[(i + 1) % n])
        e1, e2 = (p1 - p0).normalized(), (p2 - p1).normalized()
        n1, n2 = Vector((e1.y, -e1.x)) * sign, Vector((e2.y, -e2.x)) * sign
        b = (n1 + n2).normalized()
        out.append(tuple(p1 + b * d / max(b.dot(n1), 0.3)))
    return out


def trim_loop(s, m, outline, z, w=0.07, h=0.07, d=0.02):
    """Zierlinie rund um ein Deck (Umriss x, y auf Höhe z), knapp außen auf der Kante."""
    pts = [(x, y, z) for x, y in grow(outline, d)]
    s.add(sweep(pts + pts[:2], rect(w, h)), m["trim"])


def trim_line(s, m, points, w=0.07, h=0.07, mirror=True):
    """Zierlinie entlang einer Punktfolge (x, y, z), gespiegelt auf beide Flanken."""
    s.add(sweep(points, rect(w, h)), m["trim"], mirror=mirror)


def lifted(s, dz):
    """Hebt das ganze Schiff an: Sein tiefster Punkt soll über dem Slot bleiben (Blender-z -1,4 auf dem Brett)."""
    bmesh.ops.translate(s.bm, verts=s.bm.verts, vec=(0, 0, dz))
    return s


def flank(rings, z, dx=0.03, at=(0, 0, 0)):
    """Punkte auf der Steuerbord-Flanke eines Lofts (Ringe wie aus `smooth`) in Höhe z, um dx nach außen versetzt:
    die Bahn einer Zierlinie, die dem Rumpf folgt; `at` ist der Versatz, mit dem der Rumpf eingefügt wurde."""
    ox, oy, oz = at
    out = []
    for ring in rings:
        if not isinstance(ring, list):
            continue
        hits = [a.lerp(b, (z - oz - a.z) / (b.z - a.z)) for a, b in zip(ring, ring[1:] + ring[:1])
                if (a.z - z + oz) * (b.z - z + oz) <= 0 and a.z != b.z]
        hits = [p for p in hits if p.x > 0]
        if hits:
            p = max(hits, key=lambda p: p.x)
            out.append((p.x + ox + dx, p.y + oy, z))
    return out


def slab(outline, thickness, bend=0.0):
    """Gewölbte Platte quer zur Längsachse: Umriss (x, z) ab y = 0 nach hinten, die Seiten um bend·x² zurückgezogen."""
    return loft([[Vector((x, d + bend * x * x, z)) for x, z in outline] for d in (0.0, thickness)])


def emblem(s, m, at, outline, symbol, rot=(0, 0, 0)):
    """Wappenplatte auf dem Rücken: dunkle Platte mit Goldrand, darauf das Zeichen des Admirals als Polygone
    (x, y) in Gold (`trim`) oder einem anderen Material der Palette."""
    x, y, z = at
    s.add(plate(grow(outline, 0.07), 0.08, "xy"), m["trim"], at=(x, y, z + 0.04), rot=rot)
    base = plate(outline, 0.1, "xy")
    inset(base, 0.06, 0.015, 0.2)
    s.add(base, m["dark"], at=(x, y, z + 0.06), rot=rot)
    for k, (points, mat) in enumerate(symbol):
        s.add(plate(points, 0.05, "xy"), m[mat], at=(x, y, z + 0.12 + 0.015 * k), rot=rot)


def crystal(r, h):
    """Doppelpyramide (Emitterkristall) um den Ursprung, Spitzen in ±z."""
    return loft([Vector((0, 0, -h)), [Vector((r * math.cos(a), r * math.sin(a), 0)) for a in (k * math.pi / 2 for k in range(4))], Vector((0, 0, h))])


def bridge(s, m, at, decks, per_deck=5, beacon=0.12, rake=0.0):
    """Erhöhte Kommandobrücke: Decks mit Fensterreihen vorn und seitlich (jedes um `rake` nach achtern versetzt),
    umlaufendes Fensterband und Zierlinie am obersten Deck, Mast mit Leuchtfeuer in der Admiralsfarbe;
    liefert die Oberkante."""
    x, y, z = at
    for k, (w, l, h) in enumerate(decks):
        yk = y + k * rake
        s.add(rbox(w, l, h, 0.03, 1), m["hull"], at=(x, yk, z + h / 2))
        s.add(box(w * 1.05, l * 1.05, 0.03), m["steel"], at=(x, yk, z + h))
        windows(s, m, (x - w * 0.36, yk - l / 2 - 0.01, z + h * 0.6), (x + w * 0.36, yk - l / 2 - 0.01, z + h * 0.6), per_deck, (0.05, 0.03, 0.05))
        windows(s, m, (x + w / 2 + 0.01, yk - l * 0.3, z + h * 0.6), (x + w / 2 + 0.01, yk + l * 0.3, z + h * 0.6), max(per_deck - 2, 2), (0.03, 0.05, 0.05), mirror=True)
        z += h
    w, l, h = decks[-1]
    y += (len(decks) - 1) * rake
    s.add(box(w * 1.02, l * 1.02, h * 0.22), m["window"], at=(x, y, z - h * 0.45))
    trim_loop(s, m, [(x + px, y + py) for px, py in rect(w * 1.06, l * 1.06)], z + 0.03, 0.06, 0.06, 0.0)
    s.add(post(10, 0.05, 0.035, 0.0, 0.9), m["steel"], at=(x, y + l * 0.15, z))
    s.add(box(w * 0.7, 0.05, 0.05), m["steel"], at=(x, y + l * 0.15, z + 0.5))
    s.add(sphere(beacon, 1), m["glow"], at=(x, y + l * 0.15, z + 0.9 + beacon * 0.6))
    return z


def bastion():
    """Admiral Osei, „die Mauer“: fliegende Festung mit gewölbter Schildwand am Bug, Terrassen aus Panzerdecks
    über einem gestuften Sockel, vier Schildpylonen mit Bernstein-Emittern und nur wenigen kleinen Geschützen."""
    s = Ship("bastion")
    m = flagship_palette(s.name, OSEI, (0.5, 0.46, 0.4))
    # Rumpf: kastiger Hauptkörper, darunter zwei schmaler werdende Stufen (umgekehrte Stufenpyramide) und ein Kiel
    s.add(loft([
        sec(-4.2, octagon(3.8, 1.1, 0.4)),
        sec(-3.4, octagon(4.8, 1.3, 0.3)),
        sec(2.9, octagon(4.8, 1.3, 0.3)),
        sec(4.3, octagon(3.6, 1.1, 0.4)),
    ]), m["hull"], at=(0, 0, 0.2))
    step = [(0.0, -3.7), (1.7, -3.3), (2.05, -2.2), (2.05, 2.6), (1.55, 3.7), (-1.55, 3.7), (-2.05, 2.6), (-2.05, -2.2), (-1.7, -3.3)]
    for k, (sx, sy, z, t) in enumerate(((1.0, 1.0, -0.66, 0.5), (0.6, 0.78, -1.12, 0.44))):
        part = plate([(x * sx, y * sy + 0.3 * k) for x, y in step], t, "xy")
        inset(part, 0.05, 0.015, 0.25)
        s.add(part, m["hull" if k else "accent"], at=(0, 0, z))
    windows(s, m, (2.06, -2.0, -0.66), (2.06, 2.4, -0.66), 9, (0.03, 0.06, 0.05), mirror=True)
    keelfin = plate([(-2.2, 0.0), (2.6, 0.0), (2.7, -0.4), (-1.4, -0.36)], 0.14, "yz")
    inset(keelfin, 0.04, 0.012, 0.1)
    s.add(keelfin, m["hull"], at=(0, 0, -1.34))
    s.add(sphere(0.2, 2), m["plain"], at=(0, -1.9, -1.36))
    for y in (-0.4, 0.2, 0.8, 1.4):
        s.add(box(1.0, 0.035, 0.2), m["steel"], at=(0, y, -1.42))
    # Drei Panzerdecks übereinander, jedes schmaler: Festungsterrassen mit Plattenfugen, Zierlinie und Zinnen
    deck1 = [(0.0, -4.5), (2.28, -4.1), (2.8, -2.8), (2.8, 2.5), (2.42, 4.0), (1.3, 4.5), (-1.3, 4.5), (-2.42, 4.0), (-2.8, 2.5), (-2.8, -2.8), (-2.28, -4.1)]
    deck2 = [(x * 0.8, y * 0.86 + 0.2) for x, y in deck1]
    deck3 = [(-1.3, -1.6), (1.3, -1.6), (1.45, -0.8), (1.45, 3.2), (1.1, 3.7), (-1.1, 3.7), (-1.45, 3.2), (-1.45, -0.8)]
    for outline, z, t, mat in ((deck1, 0.98, 0.3, "accent"), (deck2, 1.28, 0.3, "hull"), (deck3, 1.56, 0.26, "hull")):
        part = plate(outline, t, "xy")
        inset(part, 0.06, 0.02, 0.3)
        s.add(part, m[mat], at=(0, 0, z))
    trim_loop(s, m, deck1, 1.08, 0.08, 0.08)
    trim_loop(s, m, deck3, 1.69, 0.06, 0.05)
    for k in range(8):
        s.add(box(0.2, 0.36, 0.2), m["hull"], at=(2.18, -2.9 + k * 0.82, 1.53), mirror=True)
    s.add(box(0.06, 5.0, 0.1), m["signal"], at=(2.42, -0.2, 0.32), mirror=True)
    windows(s, m, (2.43, -2.6, 0.0), (2.43, 2.6, 0.0), 12, (0.03, 0.06, 0.05), mirror=True)
    # Schildwand am Bug (eigene Baugruppe, zurückgeneigt): hoch und um den Bug gewölbt, zweilagig, mit Zierkante,
    # Emitterband, zwei Schildlinsen und Kristall; dahinter Stützpfeiler
    wall = [(-2.86, 1.3), (-2.35, 2.0), (-1.2, 2.45), (0.0, 2.75), (1.2, 2.45), (2.35, 2.0), (2.86, 1.3), (2.72, -0.4), (1.85, -1.35),
            (0.0, -1.8), (-1.85, -1.35), (-2.72, -0.4)]
    bend, inner = 0.12, 0.13
    g = Ship("bastion_wall")
    front = slab(wall, 0.5, bend)
    inset(front, 0.08, 0.03, 0.5)
    g.add(front, m["hull"])
    face = slab([(x * 0.86, z * 0.82 - 0.05) for x, z in wall], 0.2, inner)
    inset(face, 0.07, 0.02, 0.3)
    g.add(face, m["accent"], at=(0, -0.16, 0))
    g.add(sweep([(x, bend * x * x - 0.03, z + 0.04) for x, z in wall[:7]], rect(0.1, 0.1)), m["trim"])
    g.add(sweep([(x / 10, inner * (x / 10) ** 2 - 0.2, 1.05) for x in range(-20, 21, 2)], rect(0.08, 0.14)), m["signal"])
    for x in (-1.55, 0.0, 1.55):
        y = inner * x * x - 0.17
        g.add(hoop(16, 0.2, 0.32, 0.1), m["steel"], at=(x, y, 0.15), rot=(90, 0, 0))
        g.add(sphere(0.21, 2), m["signal"], at=(x, y + 0.1, 0.15), scale=(1, 0.5, 1))
    g.add(crystal(0.2, 0.32), m["signal"], at=(0, -0.24, 1.7), rot=(90, 0, 0), scale=(1, 1, 0.6))
    s.place(g, at=(0, -5.0, 0.15), rot=(-12, 0, 0))
    g.bm.free()
    for x in (0.9, 2.0):
        s.add(plate([(-4.6, 2.0), (-4.3, 2.1), (-3.3, 1.1), (-4.3, 1.1)], 0.18, "yz"), m["hull"], at=(x, 0, 0.0), mirror=True)
    # Eckbastionen: runde Türme mit Zinnenkranz, darauf die Schildpylone (Mast mit drei Spulenringen und
    # Emitterkristall in einer Dreizackfassung)
    for x, y, h in ((2.3, -2.6, 1.5), (2.3, 2.3, 1.3)):
        z0 = 1.13
        s.add(post(12, 0.5, 0.46, 0.0, 0.42), m["hull"], at=(x, y, z0), mirror=True)
        s.add(hoop(12, 0.4, 0.5, 0.06), m["trim"], at=(x, y, z0 + 0.42), mirror=True)
        for a in range(0, 360, 60):
            c, sn = math.cos(math.radians(a)), math.sin(math.radians(a))
            s.add(box(0.16, 0.16, 0.16), m["hull"], at=(x + 0.43 * c, y + 0.43 * sn, z0 + 0.53), rot=(0, 0, a), mirror=True)
        z0 += 0.42
        s.add(post(8, 0.26, 0.18, 0.0, 0.25), m["dark"], at=(x, y, z0), mirror=True)
        s.add(post(8, 0.09, 0.06, 0.25, h), m["steel"], at=(x, y, z0), mirror=True)
        for k in range(3):
            zz = z0 + 0.45 + k * 0.28
            s.add(hoop(12, 0.08, 0.24 - 0.04 * k, 0.08), m["signal"], at=(x, y, zz), mirror=True)
            s.add(hoop(12, 0.07, 0.26 - 0.04 * k, 0.04), m["dark"], at=(x, y, zz + 0.08), mirror=True)
        top = z0 + h
        for a in (90, 210, 330):
            c, sn = math.cos(math.radians(a)), math.sin(math.radians(a))
            s.add(segment((x, y, top), (x + 0.16 * c, y + 0.16 * sn, top + 0.3), 0.025, 6), m["steel"], mirror=True)
        s.add(crystal(0.13, 0.22), m["signal"], at=(x, y, top + 0.28), mirror=True)
    # Wenige, kleine Geschütze: zwei Zwillingstürme vorn, Flak an den Ecken
    turret(s, m, (1.05, -2.9, 1.43), barrel=0.6, r=0.24, mirror=True)
    pd_turret(s, m, (2.2, -3.75, 1.13), r=0.11, mirror=True)
    pd_turret(s, m, (2.0, 3.7, 1.13), r=0.11, yaw=180, mirror=True)
    # Bergfried: Kommandobrücke mit Fensterreihen, Radar und Leuchtfeuer
    top = bridge(s, m, (0, 2.2, 1.69), [(2.1, 1.7, 0.55), (1.6, 1.25, 0.5), (1.1, 0.85, 0.42)], per_deck=6)
    radar(s, m, (0, 1.65, top), 0.6, 0.24)
    s.add(dish(0.22, 0.08, 12, 2, 0.02), m["steel"], at=(0.85, 1.9, 2.8), rot=(-45, 0, -50), mirror=True)
    # Wappen: Schild mit Mauerwerk und Bernstein-Raute
    shield = [(-0.85, -0.7), (0.85, -0.7), (0.85, 0.2), (0.45, 0.78), (0.0, 1.02), (-0.45, 0.78), (-0.85, 0.2)]
    bricks = [rect(0.3, 0.16) for _ in range(5)]
    bricks = [[(x + dx, y + dy) for x, y in b] for b, (dx, dy) in zip(bricks, ((-0.36, -0.42), (0.0, -0.42), (0.36, -0.42), (-0.18, -0.22), (0.18, -0.22)))]
    emblem(s, m, (0, -0.35, 1.69), shield, [(b, "trim") for b in bricks] + [([(0, 0.0), (0.2, 0.3), (0, 0.62), (-0.2, 0.3)], "signal")], rot=(0, 0, 180))
    # Lüfter, Rohrleitungen, Kleinteile
    vents(s, m, (1.5, 3.0, 1.43), 0.5, 0.2, slots=4, rot=(-90, 0, 0), mirror=True)
    s.add(pipe([(1.75, -1.6, 1.45), (1.75, 1.0, 1.45)], 0.04, 8, joints=False), m["plain"], mirror=True)
    greebles(s, m, (0.3, 0.5, 1.2, 1.4), 1.69, 6, size=(0.06, 0.18), seed=37, mirror=True)
    greebles(s, m, (1.7, 2.0, 2.2, 3.4), 1.43, 5, size=(0.06, 0.16), seed=41, mirror=True)
    # Heckblock mit drei schweren Düsen, zwei kleine an den Deckecken
    s.add(rbox(3.6, 0.8, 1.2, 0.08, 1), m["dark"], at=(0, 4.25, 0.15))
    for dx in (-1.1, 0.0, 1.1):
        s.engine(m, 0.46, 4.5, 5.3, dx=dx, dz=0.15, n=20, plume=0.25)
    s.engine(m, 0.28, 4.1, 4.75, dx=2.1, dz=0.98, n=16, mirror=True)
    s.add(sphere(0.05, 1), m["navgreen"], at=(2.84, -2.8, 0.98))
    s.add(sphere(0.05, 1), m["navred"], at=(-2.84, -2.8, 0.98))
    return lifted(s, 0.5).finish()


def vanguard():
    """Admiral Vance, „der Hammer“: schlanker, kantiger Kreuzer, der nach vorn drängt: langer gepanzerter Rammbug als
    Speerspitze mit glühenden Schneiden, darunter zwei schwere Bugkanonen, gepfeilte Panzerklingen, zurückgestaffelte
    Brücke und ein kräftiger Düsencluster."""
    s = Ship("vanguard")
    m = flagship_palette(s.name, VANCE, (0.42, 0.04, 0.035), hull=(0.25, 0.26, 0.29), tile=1.2)
    # Kantiger Rumpf mit Rückgrat
    hull = [
        sec(-2.6, octagon(1.2, 0.85, 0.45)),
        sec(-1.7, octagon(2.0, 1.15, 0.45)),
        sec(0.4, octagon(2.4, 1.3, 0.4)),
        sec(2.6, octagon(2.4, 1.3, 0.4)),
        sec(3.6, octagon(2.1, 1.15, 0.45)),
        sec(4.0, octagon(1.8, 0.95, 0.45)),
    ]
    part = loft(hull)
    inset(part, 0.05, 0.015, 0.3)
    s.add(part, m["hull"])
    spine = loft([sec(-2.3, octagon(0.5, 0.2, 0.4)), sec(-1.4, octagon(1.05, 0.5, 0.4)), sec(2.9, octagon(1.15, 0.55, 0.4)),
                  sec(3.7, octagon(0.7, 0.3, 0.4))])
    inset(spine, 0.04, 0.012, 0.2)
    s.add(spine, m["hull"], at=(0, 0, 0.58))
    trim_line(s, m, flank(hull, 0.34, 0.025))
    # Rammbug als Speerspitze: Klinge mit Sechseckquerschnitt (Schneiden an den Seiten), Panzerlage, Goldgrat, glühende Schneiden
    ram = [(-5.0, 0.6, 0.32), (-3.9, 1.8, 0.8), (-3.15, 2.0, 0.95), (-2.45, 1.35, 1.0), (-1.9, 1.15, 1.0)]
    part = loft([tip(-5.6, 0, -0.12)] + [sec(y, hexagon(w, h)) for y, w, h in ram])
    inset(part, 0.05, 0.015, 0.3)
    s.add(part, m["hull"])
    armor = [(-4.6, 0.55, 0.28), (-3.8, 1.45, 0.6), (-3.05, 1.6, 0.7), (-2.3, 1.05, 0.75)]
    part = loft([tip(-5.25, 0, 0.06)] + [sec(y, hexagon(w, h)) for y, w, h in armor])
    inset(part, 0.04, 0.012, 0.15)
    s.add(part, m["accent"], at=(0, 0, 0.2))
    s.add(sweep([(0, -5.25, 0.28)] + [(0, y, 0.2 + h / 2 + 0.015) for y, w, h in armor], rect(0.09, 0.06)), m["trim"])
    s.add(sweep([(0.0, -5.62, -0.12)] + [(w / 2 + 0.01, y, 0.0) for y, w, h in ram[:4]], rect(0.06, 0.09)), m["signal"], mirror=True)
    # Zwei schwere Bugkanonen unter dem Rammbug: Gehäuse, Kühlringe, Lauf, Mündungsbremse, Glühen
    gx, gz = 0.68, -0.6
    s.add(rbox(0.6, 2.2, 0.55, 0.06, 1), m["dark"], at=(gx, -1.5, gz), mirror=True)
    s.add(tube(14, 0.16, 0.14, -4.6, -2.4), m["steel"], at=(gx, 0, gz), mirror=True)
    for y in (-2.65, -2.85, -3.05, -3.25):
        s.add(hoop(14, 0.14, 0.22, 0.08), m["dark"], at=(gx, y, gz), rot=(90, 0, 0), mirror=True)
    s.add(tube(14, 0.2, 0.2, -4.85, -4.6), m["plain"], at=(gx, 0, gz), mirror=True)
    s.add(box(0.46, 0.12, 0.09), m["plain"], at=(gx, -4.72, gz), mirror=True)
    s.add(tube(10, 0.1, 0.1, -4.92, -4.85), m["signal"], at=(gx, 0, gz), mirror=True)
    # Gepfeilte Panzerklingen an den Flanken in zwei Lagen, Zierkante, Leuchtstreifen
    blade = plate([(0.9, -1.6), (1.55, -0.6), (2.12, 2.4), (2.12, 3.85), (1.62, 3.25), (0.9, 2.85)], 0.14, "xy")
    inset(blade, 0.04, 0.012, 0.15)
    s.add(blade, m["accent"], at=(0, 0, 0.17), mirror=True)
    lower = plate([(0.9, -0.8), (1.4, -0.1), (1.86, 2.7), (1.82, 3.5), (0.9, 3.1)], 0.1, "xy")
    inset(lower, 0.035, 0.01, 0.15)
    s.add(lower, m["hull"], at=(0, 0, -0.22), mirror=True)
    trim_line(s, m, [(x + 0.025, y, 0.2) for x, y in ((1.55, -0.6), (2.12, 2.4), (2.12, 3.85))], 0.05, 0.09)
    s.add(sweep([(1.3, -0.6, 0.25), (1.75, 2.0, 0.25), (1.78, 3.1, 0.25)], rect(0.05, 0.03)), m["signal"], mirror=True)
    pd_turret(s, m, (1.6, 1.2, 0.24), r=0.11, mirror=True)
    missile_pod(s, m, (1.45, 0.0, 0.4), size=(0.36, 0.8, 0.3), cells=(2, 2), mirror=True)
    # Zwei schwere Türme nach vorn, der hintere überhöht
    turret(s, m, (0, -0.55, 0.85), barrel=1.5, r=0.34)
    s.add(post(20, 0.44, 0.42, 0.85, 1.17), m["hull"], at=(0, 0.75, 0))
    turret(s, m, (0, 0.75, 1.17), barrel=1.45, r=0.34)
    # Wappen vor den Türmen: zwei verschachtelte Winkel als Speerspitze
    kite = [(0.0, -0.75), (0.5, -0.2), (0.45, 0.45), (0.0, 0.6), (-0.45, 0.45), (-0.5, -0.2)]
    outer = [(0.0, -0.55), (0.36, -0.02), (0.22, 0.08), (0.0, -0.26), (-0.22, 0.08), (-0.36, -0.02)]
    inner = [(x, y + 0.3) for x, y in outer]
    emblem(s, m, (0, -1.75, 0.68), kite, [(outer, "trim"), (inner, "signal")])
    # Zurückgestaffelte Brücke achtern, Radar, Schüsseln
    top = bridge(s, m, (0, 2.1, 0.85), [(1.3, 1.4, 0.45), (1.0, 1.05, 0.4), (0.7, 0.72, 0.34)], per_deck=5, rake=0.22)
    radar(s, m, (0, 2.15, top), 0.5, 0.2)
    s.add(dish(0.18, 0.07, 12, 2, 0.02), m["steel"], at=(0.6, 2.6, 1.6), rot=(-50, 0, -50), mirror=True)
    # Kräftiger Düsencluster: Gehäuse mit Leuchtstreifen, große Mitteldüse und vier äußere
    s.add(rbox(2.6, 0.8, 1.55, 0.1, 1), m["dark"], at=(0, 3.95, 0.0))
    s.add(box(2.64, 0.08, 0.08), m["signal"], at=(0, 3.85, 0.5))
    s.add(box(2.64, 0.08, 0.08), m["signal"], at=(0, 3.85, -0.5))
    s.engine(m, 0.58, 4.1, 5.05, dx=0.0, dz=0.0, n=20, plume=0.22)
    for dz in (0.42, -0.42):
        s.engine(m, 0.38, 4.1, 4.9, dx=0.82, dz=dz, n=16, mirror=True, plume=0.22)
    # Kiel, Fenster, Lüfter, Kleinteile, Lichter
    keelfin = plate([(-1.4, 0.0), (3.4, 0.0), (3.6, -0.5), (-0.4, -0.4)], 0.1, "yz")
    inset(keelfin, 0.03, 0.01, 0.1)
    s.add(keelfin, m["hull"], at=(0, 0, -0.6))
    windows(s, m, (1.2, -1.2, 0.02), (1.2, 3.2, 0.02), 10, (0.03, 0.06, 0.04), mirror=True)
    vents(s, m, (0.45, 3.2, 0.86), 0.3, 0.14, slots=3, rot=(-90, 0, 0), mirror=True)
    greebles(s, m, (-0.4, 1.4, 0.4, 3.4), 0.86, 6, size=(0.05, 0.14), seed=43)
    s.add(sphere(0.045, 1), m["navgreen"], at=(2.14, 3.8, 0.17))
    s.add(sphere(0.045, 1), m["navred"], at=(-2.14, 3.8, 0.17))
    return s.finish()

def on_surface(tree, x, y, z=10.0):
    """Punkt und Neigung (Grad, für `rot`) der Oberfläche unter (x, y), per Strahl von oben auf `tree` (BVHTree)."""
    hit, normal, _, _ = tree.ray_cast(Vector((x, y, z)), Vector((0, 0, -1)))
    if hit is None:
        return None, None
    euler = Vector((0, 0, 1)).rotation_difference(normal).to_euler()
    return hit, tuple(math.degrees(a) for a in euler)


def mini_drone(s, m, at, k=0.42, yaw=0.0):
    """Angedockte Drohne in klein (wie `drone`): Keilrumpf, Pfeilflügel, Sensorauge, glimmende Düse."""
    g = Ship("mini_drone")
    g.add(loft([tip(-2.0 * k), sec(-1.2 * k, octagon(0.62 * k, 0.32 * k, 0.35)), sec(0.0, octagon(0.8 * k, 0.42 * k, 0.35)),
                sec(1.3 * k, octagon(0.6 * k, 0.34 * k, 0.35))]), m["hull"])
    g.add(plate([(0.3 * k, -0.45 * k), (1.75 * k, 0.55 * k), (1.75 * k, 0.8 * k), (0.3 * k, 0.95 * k)], 0.06 * k, "xy"), m["accent"], mirror=True)
    g.add(sphere(0.12 * k, 1), m["canopy"], at=(0, -0.6 * k, 0.2 * k))
    g.add(tube(8, 0.2 * k, 0.16 * k, 1.3 * k, 1.6 * k), m["dark"], at=(0.3 * k, 0, 0), mirror=True)
    g.add(tube(8, 0.13 * k, 0.0, 1.55 * k, 1.9 * k), m["signal"], at=(0.3 * k, 0, 0), mirror=True)
    s.place(g, at=at, rot=(0, 0, yaw))
    g.bm.free()


def hive():
    """Admiral Halvorsen, „der Schwarm“: Trägerschiff mit leicht organischem Zwei-Kammer-Rumpf; auf dem Rücken die
    Brutkammer aus Waben, die violett leuchten (manche verdeckelt), an den Flanken sechseckige Hangarbuchten und
    Andockarme mit Drohnen, vorn ein Sechseck-Turm als Brücke."""
    s = Ship("hive")
    m = flagship_palette(s.name, HALVORSEN, (0.2, 0.08, 0.3), hull=(0.26, 0.26, 0.32), tile=1.0)
    N = 28
    body = lambda w, h: superellipse(w, h, N, 2.4)  # noqa: E731
    # Rumpf: vordere und hintere Kammer mit Taille dazwischen
    rings = smooth([
        sec(-4.7, body(1.0, 0.7), dz=-0.1),
        sec(-4.1, body(2.2, 1.45), dz=-0.05),
        sec(-2.6, body(3.1, 1.95)),
        sec(-0.6, body(2.7, 1.75)),
        sec(1.3, body(3.7, 2.3), dz=0.05),
        sec(3.3, body(3.5, 2.2), dz=0.05),
        sec(4.5, body(2.4, 1.55)),
        sec(4.9, body(1.5, 1.0)),
    ], 2)
    part = loft(rings)
    tree = BVHTree.FromBMesh(part)
    s.add(part, m["hull"])
    trim_line(s, m, flank(rings, 0.5, 0.025), 0.07, 0.08)
    # Rippen über der Taille (Außenskelett) und Grat auf dem Rücken
    for y, w, h in ((-1.25, 2.86, 1.8), (-0.6, 2.78, 1.8), (0.05, 3.02, 1.94)):
        arc = [(x * 1.03, y, z * 1.03) for x, z in superellipse(w, h, 24, 2.4)[:13]]
        s.add(sweep(arc, rect(0.16, 0.12)), m["accent"])
    s.add(sweep([(0, y, z) for y, z in ((-4.3, 0.62), (-3.2, 0.98), (-2.2, 1.0), (-0.6, 0.9), (0.6, 1.14))], rect(0.12, 0.14)), m["accent"])
    # Brutkammer: Waben auf der Wölbung der hinteren Kammer; offene leuchten violett, verdeckelte sind dunkel
    r, gap = 0.3, 0.035
    for i in range(-4, 5):
        for j in range(-1, 9):
            x, y = i * 1.5 * r, 0.55 + j * math.sqrt(3) * r + (math.sqrt(3) / 2 * r if i % 2 else 0)
            if abs(x) > 1.45 - 0.25 * (j < 0 or j > 6) or y > 3.65:
                continue
            hit, rot = on_surface(tree, x, y)
            if hit is None:
                continue
            at = hit + Vector((0, 0, -0.04))
            s.add(hoop(6, r - gap - 0.05, r - gap, 0.2), m["dark"], at=(at.x, at.y, at.z + 0.1), rot=rot)
            if s.rng.random() < 0.28:
                s.add(post(6, r - gap - 0.03, r - gap - 0.07, 0.0, 0.17), m["accent"], at=at, rot=rot)
            else:
                s.add(post(6, r - gap - 0.05, r - gap - 0.05, 0.0, 0.06), m["signal"], at=at, rot=rot)
    # Hangar-Sponsons an den Flanken: Gondel an Streben, drei offene Sechseckbuchten mit Leuchten im Inneren,
    # obenauf eine angedockte Drohne in ihrer Klammer
    sx, sz = 2.32, -0.2
    pod = smooth([tip(-0.9), sec(-0.4, superellipse(0.7, 0.66, 16, 2.6)), sec(0.4, superellipse(0.9, 0.84, 16, 2.6)),
                  sec(3.3, superellipse(0.9, 0.84, 16, 2.6)), sec(4.0, superellipse(0.66, 0.6, 16, 2.6))], 2)
    s.add(loft(pod), m["accent"], at=(sx, 0, sz), mirror=True)
    for y in (0.3, 1.6, 2.9):
        s.add(plate([(-0.3, 0.25), (0.35, 0.25), (0.2, -0.2), (-0.15, -0.2)], 0.12, "xz"), m["hull"], at=(1.95, y + 0.3, sz), mirror=True)
    for y in (0.65, 1.65, 2.65):
        s.add(hoop(6, 0.27, 0.37, 0.16), m["steel"], at=(sx + 0.46, y, sz), rot=(0, 90, 0), mirror=True)
        s.add(post(6, 0.3, 0.3, 0.0, 0.03), m["dark"], at=(sx + 0.42, y, sz), rot=(0, 90, 0), mirror=True)
        s.add(post(6, 0.21, 0.21, 0.0, 0.02), m["signal"], at=(sx + 0.45, y, sz), rot=(0, 90, 0), mirror=True)
    s.add(sweep([(sx + 0.47, y, sz) for y in (-0.15, 0.2)], rect(0.04, 0.3)), m["signal"], mirror=True)
    for side in (1, -1):
        s.add(rbox(0.36, 1.0, 0.1, 0.03, 1), m["dark"], at=(side * sx, 1.65, sz + 0.44))
        s.add(box(0.05, 0.8, 0.04), m["signal"], at=(side * sx, 1.65, sz + 0.5))
        mini_drone(s, m, (side * sx, 1.6, sz + 0.62), k=0.36)
    # Kopf: Sensorauge im Sechseckrahmen, zwei Fühlerantennen
    s.add(hoop(6, 0.26, 0.38, 0.12), m["steel"], at=(0, -4.62, -0.08), rot=(90, 0, 0))
    s.add(sphere(0.25, 2), m["signal"], at=(0, -4.6, -0.08))
    for sx in (1, -1):
        s.add(pipe([(sx * 0.5, -3.9, 0.55), (sx * 0.75, -4.6, 0.85), (sx * 0.7, -5.15, 0.8)], 0.03, 6), m["steel"])
        s.add(sphere(0.05, 1), m["signal"], at=(sx * 0.7, -5.16, 0.8))
    # Sechseckturm als Brücke: Decks mit Fenstern auf allen Seiten, Zierlinie, Mast mit Leuchtfeuer
    hit, _ = on_surface(tree, 0, -1.75)
    z = hit.z - 0.05
    for rr, h, count in ((0.8, 0.45, 3), (0.62, 0.42, 2), (0.46, 0.36, 2)):
        s.add(post(6, rr, rr * 0.95, 0.0, h), m["hull"], at=(0, -1.75, z))
        s.add(hoop(6, rr * 0.85, rr * 1.04, 0.04), m["steel"], at=(0, -1.75, z + h))
        apothem = rr * 0.975 * math.cos(math.pi / 6)
        for k in range(6):
            phi = math.radians(30 + 60 * k)
            for t in range(count):
                off = (t - (count - 1) / 2) * 0.16
                s.add(box(0.03, 0.08, 0.06), m["window"], at=(apothem * math.cos(phi) - off * math.sin(phi), -1.75 + apothem * math.sin(phi) + off * math.cos(phi),
                                                            z + h * 0.58), rot=(0, 0, math.degrees(phi)))
        z += h
    trim_loop(s, m, [(x, y - 1.75) for x, y in ngon(6, 0.5)], z + 0.03, 0.06, 0.06, 0.0)
    s.add(post(10, 0.05, 0.035, 0.0, 0.85), m["steel"], at=(0, -1.6, z))
    s.add(box(0.5, 0.05, 0.05), m["steel"], at=(0, -1.6, z + 0.5))
    s.add(sphere(0.12, 1), m["glow"], at=(0, -1.6, z + 0.92))
    radar(s, m, (0.0, -2.1, z), 0.4, 0.16)
    # Wappen vor dem Turm: Sechseck mit drei Waben in Gold und violettem Kern
    hit, rot = on_surface(tree, 0, -3.15)
    hexes = [[(x + 0.24 * math.cos(math.radians(a)), y + 0.24 * math.sin(math.radians(a))) for x, y in ngon(6, 0.17)] for a in (90, 210, 330)]
    emblem(s, m, (0, -3.15, hit.z - 0.06), ngon(6, 0.62), [(h, "trim") for h in hexes] + [(ngon(6, 0.09), "signal")], rot=(rot[0], 0, 0))
    # Flak, Fenster, Lüfter, Kleinteile
    for x, y in ((1.25, -2.4), (1.3, 3.75)):
        hit, rot = on_surface(tree, x, y)
        pd_turret(s, m, (hit.x, hit.y, hit.z - 0.02), r=0.12, yaw=0 if y < 0 else 180, mirror=True)
    windows(s, m, (1.64, -3.2, -0.15), (1.42, -1.6, -0.15), 5, (0.03, 0.06, 0.05), mirror=True)
    vents(s, m, (1.5, 0.5, -0.55), 0.3, 0.16, slots=3, rot=(0, 0, 90), mirror=True)
    # Unterseite: Kiel, Bauchsensor, Radiatoren
    keelfin = plate([(-3.4, 0.0), (3.6, 0.0), (3.3, -0.4), (-2.6, -0.35)], 0.12, "yz")
    inset(keelfin, 0.03, 0.01, 0.1)
    s.add(keelfin, m["hull"], at=(0, 0, -1.08))
    s.add(sphere(0.18, 2), m["plain"], at=(0, -2.6, -0.98))
    for y in (1.2, 1.8, 2.4, 3.0):
        s.add(box(1.4, 0.035, 0.2), m["steel"], at=(0, y, -1.18))
    # Düsen: eine große Mitteldüse, zwei kleinere darunter, in sechseckigen Fassungen
    s.engine(m, 0.5, 4.6, 5.45, dx=0.0, dz=0.15, n=20, plume=0.22)
    s.add(hoop(6, 0.5, 0.64, 0.2), m["accent"], at=(0, 4.75, 0.15), rot=(90, 0, 0))
    s.engine(m, 0.34, 4.5, 5.2, dx=0.85, dz=-0.38, n=16, mirror=True, plume=0.22)
    s.add(sphere(0.05, 1), m["navgreen"], at=(2.0, 2.0, 0.55))
    s.add(sphere(0.05, 1), m["navred"], at=(-2.0, 2.0, 0.55))
    return lifted(s, 0.25).finish()

def facet(w, h, top=0.36, low=0.5, drop=0.6):
    """Facettierter Tarnkappen-Querschnitt: scharfe Kimmkanten an den Seiten, schmaler flacher Grat oben, flacher Boden."""
    return [(w / 2, 0.0), (w * top / 2, h / 2), (-w * top / 2, h / 2), (-w / 2, 0.0), (-w * low / 2, -h / 2 * drop), (w * low / 2, -h / 2 * drop)]


def mirage():
    """Admiral Moreau, „das Phantom“: Tarnkappen-Flaggschiff, flach und schmal, aus ebenen Facetten mit scharfen
    Kanten; dunkler Rumpf mit türkisen Nähten und Paneelen, zwei schräge Projektorflossen, facettierte Brücke."""
    s = Ship("mirage")
    m = flagship_palette(s.name, MOREAU, (0.03, 0.3, 0.29), hull=(0.06, 0.07, 0.085), tile=1.1)
    # Dunkler Rumpf und türkise Paneele mit Dünnschicht-Schimmer
    m["hull"] = iridescent(material("mirage_hull", (0.06, 0.07, 0.085), 0.9, 0.6, style="plating", tile=1.1), 485, 1.45)
    m["accent"] = iridescent(material("mirage_accent", (0.03, 0.3, 0.29), 0.9, 0.45, style="plating", tile=1.1, normal_strength=0.6), 340, 1.45)
    # Facettierter Rumpf mit Plattenfugen: Kimmkanten an den Seiten in Gold, Gratkanten oben in Türkis
    sections = [(-3.5, 0.75, 0.3), (-2.0, 1.6, 0.55), (-0.2, 2.2, 0.72), (2.0, 2.0, 0.68), (3.3, 1.5, 0.52), (3.9, 1.1, 0.4)]
    part = loft([tip(-4.6, 0, 0.0)] + [sec(y, facet(w, h)) for y, w, h in sections])
    inset(part, 0.04, 0.012, 0.15)
    s.add(part, m["hull"])
    trim_line(s, m, [(0.0, -4.62, 0.0)] + [(w / 2 + 0.015, y, 0.0) for y, w, h in sections], 0.05, 0.07)
    s.add(sweep([(0.0, -4.5, 0.03)] + [(w * 0.18 + 0.012, y, h / 2 + 0.008) for y, w, h in sections[:4]], rect(0.035, 0.025)), m["signal"], mirror=True)
    # Tarnkappen-Einlässe an den Flanken: schräge Facettenkästen mit dunklem Gitter
    intake = [(-1.6, 0.36, 0.06), (-0.9, 0.5, 0.26), (0.6, 0.5, 0.3), (1.4, 0.4, 0.22)]
    s.add(loft([sec(y, facet(w, h, 0.6, 0.8, 1.0)) for y, w, h in intake]), m["hull"], at=(0.95, 0, 0.12), mirror=True)
    s.add(box(0.36, 0.05, 0.16), m["plain"], at=(0.95, -0.92, 0.14), mirror=True)
    for k in range(3):
        s.add(box(0.37, 0.06, 0.012), m["steel"], at=(0.95, -0.93, 0.08 + 0.05 * k), mirror=True)
    # Phasen-Emitter: Reihe türkiser Linsen auf dem Rückengrat vor der Brücke
    for k in range(4):
        s.add(post(6, 0.06, 0.04, 0.0, 0.04), m["signal"], at=(0, -3.4 + 0.38 * k, 0.12 + 0.07 * k))
    # Flache Diamantflügel mit Sägezahn-Hinterkante, türkisen Paneelen und leuchtender Vorderkante
    wing = [(0.85, -2.5), (2.05, 0.9), (2.1, 1.65), (1.6, 1.4), (1.2, 2.45), (0.85, 2.35)]
    part = plate(wing, 0.09, "xy")
    inset(part, 0.04, 0.012, 0.2)
    s.add(part, m["hull"], at=(0, 0, -0.06), rot=(0, -3, 0), mirror=True)
    panel = plate([(1.05, -1.4), (1.8, 0.75), (1.8, 1.25), (1.15, 1.55)], 0.1, "xy")
    inset(panel, 0.03, 0.01, 0.1)
    s.add(panel, m["accent"], at=(0, 0, -0.05), rot=(0, -3, 0), mirror=True)
    s.add(sweep([(0.9, -2.45, -0.03), (2.08, 0.92, -0.1)], rect(0.04, 0.05)), m["signal"], mirror=True)
    s.add(sweep([(1.0, -1.9, 0.0), (1.45, -0.4, -0.02), (1.45, 1.9, -0.04), (1.2, 2.3, -0.04)], rect(0.025, 0.02)), m["signal"], at=(0, 0, 0.0), mirror=True)
    for k in range(3):
        y = 0.2 + 0.45 * k
        s.add(box(0.32, 0.22, 0.03), m["dark"], at=(1.25, y + 0.9, 0.0), rot=(0, -3, 0), mirror=True)
    missile_pod(s, m, (1.25, 0.3, -0.18), size=(0.3, 0.9, 0.16), cells=(2, 1), mirror=True)
    # Projektorflossen: zwei nach außen geneigte Rückenflossen mit Emitterkante, Linsen und Kristall an der Spitze
    fin = [(1.0, 0.0), (3.55, 0.0), (3.95, 1.25), (3.05, 1.32)]
    g = Ship("mirage_fin")
    part = plate(fin, 0.06, "yz")
    inset(part, 0.025, 0.008, 0.1)
    g.add(part, m["hull"])
    g.add(plate([(1.6, 0.25), (3.3, 0.25), (3.55, 1.0), (3.0, 1.05)], 0.08, "yz"), m["accent"])
    g.add(sweep([(0, 1.0, 0.02), (0, 3.05, 1.34)], rect(0.05, 0.05)), m["signal"])
    for k in range(3):
        g.add(sphere(0.05, 1), m["signal"], at=(0.035, 2.0 + 0.4 * k, 0.6 + 0.2 * k), scale=(0.5, 1, 1))
    g.add(crystal(0.08, 0.16), m["signal"], at=(0, 3.5, 1.4), rot=(90, 0, 0))
    for side in (1, -1):
        s.place(g, at=(side * 0.42, 0, 0.26), rot=(0, side * 26, 0))
    g.bm.free()
    # Bauchflossen an den Flügelspitzen
    for side in (1, -1):
        s.add(plate([(0.6, 0.0), (1.7, 0.0), (1.85, -0.45), (1.2, -0.5)], 0.04, "yz"), m["hull"], at=(side * 2.02, 0, -0.1), rot=(0, side * -20, 0))
        s.add(sweep([(side * 2.02, 0.6, -0.1), (side * (2.02 + 0.17), 1.2, -0.58)], rect(0.03, 0.03)), m["signal"])
    # Erhöhte, facettierte Brücke: Fensterband, dunkle Kanzel, Oberdeck mit Zierlinie, Mast mit Leuchtfeuer
    pod = [(-1.9, 0.3, 0.08), (-1.2, 0.95, 0.46), (0.1, 1.05, 0.52), (0.85, 0.65, 0.3)]
    part = loft([sec(y, facet(w, h, 0.5, 0.8, 1.0)) for y, w, h in pod])
    inset(part, 0.025, 0.008, 0.06)
    s.add(part, m["hull"], at=(0, 0, 0.36))
    s.add(loft([sec(y, facet(w, h, 0.5, 0.8, 1.0)) for y, w, h in ((-1.5, 0.5, 0.22), (-1.15, 0.86, 0.4), (-0.75, 0.9, 0.42))]), m["canopy"], at=(0, -0.03, 0.4))
    windows(s, m, (0.49, -0.9, 0.5), (0.49, 0.1, 0.5), 5, (0.03, 0.07, 0.04), mirror=True)
    deck = [(-0.32, -0.55), (0.32, -0.55), (0.38, 0.35), (-0.38, 0.35)]
    s.add(plate(deck, 0.16, "xy"), m["hull"], at=(0, 0, 0.7))
    trim_loop(s, m, deck, 0.78, 0.04, 0.04, 0.0)
    windows(s, m, (-0.2, -0.56, 0.72), (0.2, -0.56, 0.72), 3, (0.05, 0.03, 0.04))
    s.add(post(8, 0.035, 0.025, 0.0, 0.55), m["steel"], at=(0, 0.1, 0.78))
    s.add(sphere(0.08, 1), m["glow"], at=(0, 0.1, 1.38))
    # Rückendeck mit Wappen: zwei versetzte Rauten, Gold und Türkis, die einander überlappen (Phasentausch)
    spine = [(-0.45, 0.85), (0.45, 0.85), (0.5, 2.9), (0.0, 3.3), (-0.5, 2.9)]
    part = plate(spine, 0.1, "xy")
    inset(part, 0.03, 0.01, 0.1)
    s.add(part, m["dark"], at=(0, 0, 0.36))
    diamond = [(0.0, -0.66), (0.44, 0.0), (0.0, 0.66), (-0.44, 0.0)]
    rhomb = [(0.0, -0.3), (0.2, 0.0), (0.0, 0.3), (-0.2, 0.0)]
    emblem(s, m, (0, 1.95, 0.39), diamond, [([(x - 0.08, y + 0.12) for x, y in rhomb], "trim"),
                                            ([(x * 0.55 + 0.08, y * 0.55 - 0.12) for x, y in rhomb], "signal")])
    # Fensterreihen über den Kimmkanten, Sensorflossen am Bug, Projektorlinsen achtern zwischen den Flossen
    windows(s, m, (0.86, -1.8, 0.08), (1.02, 1.6, 0.08), 9, (0.03, 0.07, 0.035), mirror=True)
    s.add(plate([(-2.9, 0.0), (-2.45, 0.0), (-2.55, 0.22), (-2.75, 0.24)], 0.02, "yz"), m["hull"], at=(0.16, 0, 0.16), rot=(0, 18, 0), mirror=True)
    s.add(sweep([(0.16, -2.9, 0.17), (0.2, -2.75, 0.39)], rect(0.02, 0.02)), m["signal"], mirror=True)
    for k in range(3):
        s.add(hoop(10, 0.035, 0.07, 0.04), m["steel"], at=(0.0, 3.25 + 0.28 * k, 0.33), mirror=False)
        s.add(sphere(0.04, 1), m["signal"], at=(0.0, 3.25 + 0.28 * k, 0.35))
    # Canards am Bug, Projektorgondeln an den Flügelspitzen
    canard = plate([(0.3, -3.0), (0.95, -2.45), (0.95, -2.22), (0.3, -2.3)], 0.05, "xy")
    s.add(canard, m["hull"], at=(0, 0, 0.02), mirror=True)
    s.add(sweep([(0.32, -2.98, 0.05), (0.95, -2.45, 0.05)], rect(0.03, 0.03)), m["signal"], mirror=True)
    tippod = [(-0.2, 0.12, 0.08), (0.2, 0.2, 0.14), (1.0, 0.2, 0.14), (1.3, 0.12, 0.08)]
    s.add(loft([tip(-0.6)] + [sec(y, facet(w, h, 0.6, 0.8, 1.0)) for y, w, h in tippod]), m["dark"], at=(2.1, 0.6, -0.1), mirror=True)
    for k in range(3):
        s.add(sphere(0.035, 1), m["signal"], at=(2.18, 0.8 + 0.25 * k, -0.06), scale=(0.6, 1, 1), mirror=True)
    # Verdeckte Bugkanonen in den Flügelwurzeln
    s.add(tube(10, 0.08, 0.07, -1.0, -2.6), m["dark"], at=(0.82, 0, -0.08), mirror=True)
    s.add(tube(10, 0.04, 0.035, -2.6, -3.3), m["steel"], at=(0.82, 0, -0.08), mirror=True)
    s.add(tube(8, 0.028, 0.028, -3.3, -3.36), m["signal"], at=(0.82, 0, -0.08), mirror=True)
    # Flache Düsenverkleidung mit zwei Triebwerken, türkiser Abschluss
    s.add(loft([sec(y, facet(w, h, 0.6, 0.8, 1.0)) for y, w, h in ((2.6, 1.9, 0.5), (3.9, 2.0, 0.55), (4.2, 1.8, 0.45))]), m["dark"], at=(0, 0, -0.05))
    s.engine(m, 0.24, 3.9, 4.55, dx=0.5, dz=-0.05, n=16, mirror=True, plume=0.25)
    s.add(hoop(16, 0.24, 0.29, 0.05), m["signal"], at=(0.5, 4.25, -0.05), rot=(90, 0, 0), mirror=True)
    s.add(box(1.7, 0.04, 0.04), m["signal"], at=(0, 4.22, 0.17))
    vents(s, m, (0.55, 3.55, 0.2), 0.3, 0.12, slots=3, rot=(-90, 0, 0), mirror=True)
    for k in range(3):
        s.add(sphere(0.06, 1), m["dark"], at=(0.0, 3.0 + 0.32 * k, 0.37 - 0.03 * k), scale=(1, 1.4, 0.6))
    # Kiel, Sensorkugel unter dem Bug, Antennen, Lüfter, Kleinteile, Lichter
    s.add(plate([(-2.5, 0.0), (1.8, 0.0), (1.6, -0.22), (-1.6, -0.2)], 0.06, "yz"), m["hull"], at=(0, 0, -0.2))
    s.add(sphere(0.1, 2), m["signal"], at=(0, -2.9, -0.2))
    s.add(hoop(12, 0.1, 0.14, 0.04), m["steel"], at=(0, -2.9, -0.2))
    s.add(plate([(0.9, 0.0), (1.3, 0.0), (1.25, 0.18), (0.95, 0.2)], 0.015, "yz"), m["steel"], at=(0.2, 0, 0.62))
    vents(s, m, (0.35, 2.85, 0.34), 0.22, 0.1, slots=3, rot=(-90, 0, 0), mirror=True)
    greebles(s, m, (-0.3, 3.0, 0.3, 3.6), 0.28, 4, size=(0.04, 0.1), seed=47, mats=("dark", "plain"))
    s.add(sphere(0.04, 1), m["navgreen"], at=(2.12, 1.2, -0.08))
    s.add(sphere(0.04, 1), m["navred"], at=(-2.12, 1.2, -0.08))
    return s.finish()

def gear(teeth, r, depth, width=0.5):
    """Zahnrad-Umriss (x, y): `teeth` Zähne zwischen Radius r - depth und r, `width` ist der Anteil des Zahns an der Teilung."""
    pts = []
    for k in range(teeth):
        a = 2 * math.pi * k / teeth
        half = math.pi / teeth * width
        for angle, radius in ((a - half * 1.25, r - depth), (a - half * 0.75, r), (a + half * 0.75, r), (a + half * 1.25, r - depth)):
            pts.append((radius * math.cos(angle), radius * math.sin(angle)))
    return pts


def pendulum():
    """Admiral Kerr, „der Uhrmacher“: Railgun-Schlachtschiff. Die Railgun ist das Rückgrat, vorn ragen ihre Schienen
    mit stahlblau leuchtenden Spulen weit über den Bug; um den Rumpf ein Gimbal aus Messing-Zahnkranz und geneigtem
    Spulenring, unter dem Kiel ein schwingendes Pendel als Gegengewicht."""
    s = Ship("pendulum")
    m = flagship_palette(s.name, KERR, (0.08, 0.12, 0.26), hull=(0.28, 0.31, 0.38), tile=1.0)
    m["brass"] = material("pendulum_brass", (0.62, 0.42, 0.14), 0.95, 0.5, style="plating", tile=0.8, normal_strength=0.5)
    zc = 1.0
    # Rumpf: Keilprofil mit flachem Deck, Panzerschürzen mit Fugen, Zierlinie an der Deckkante
    hull = [sec(-3.2, keel(1.2, 0.9), dz=zc), sec(-2.4, keel(2.6, 1.3), dz=zc), sec(-0.8, keel(3.2, 1.5), dz=zc),
            sec(2.6, keel(3.2, 1.5), dz=zc), sec(3.8, keel(2.6, 1.3), dz=zc), sec(4.3, keel(2.0, 1.0), dz=zc)]
    part = loft(hull)
    inset(part, 0.05, 0.015, 0.3)
    s.add(part, m["hull"])
    trim_line(s, m, flank(hull, zc + 0.62, 0.02), 0.07, 0.07)
    skirt = plate([(1.2, -2.6), (1.7, -1.6), (1.75, 2.8), (1.4, 3.7), (1.2, 3.7)], 0.16, "xy")
    inset(skirt, 0.04, 0.012, 0.2)
    s.add(skirt, m["accent"], at=(0, 0, zc + 0.1), mirror=True)
    # Railgun als Rückgrat: Gehäuse auf dem Deck, davor zwei Schienen mit Führungskanal, Spulen (Messing und
    # stahlblau leuchtend im Wechsel), Joch am Bug, Mündung; achtern der Verschluss mit Kondensatorbank
    zr = zc + 0.95
    s.add(loft([sec(-3.1, octagon(0.9, 0.6, 0.35), dz=zr), sec(0.6, octagon(1.0, 0.7, 0.35), dz=zr)]), m["dark"])
    for x in (0.22, -0.22):
        s.add(box(0.16, 3.7, 0.56), m["steel"], at=(x, -3.75, zr))
        s.add(box(0.05, 3.7, 0.06), m["brass"], at=(x * 1.45, -3.75, zr + 0.3))
    s.add(box(0.12, 3.8, 0.06), m["signal"], at=(0, -3.75, zr - 0.2))
    for k in range(9):
        y = -5.25 + 0.34 * k + (0.0 if k < 6 else 0.36 * (k - 5))
        if k % 2:
            s.add(hoop(16, 0.36, 0.5, 0.1), m["signal"], at=(0, y, zr), rot=(90, 0, 0))
        else:
            s.add(hoop(16, 0.36, 0.58, 0.16), m["brass"], at=(0, y, zr), rot=(90, 0, 0))
    s.add(rbox(0.9, 0.3, 0.9, 0.05, 1), m["dark"], at=(0, -5.6, zr))
    s.add(box(0.3, 0.06, 0.5), m["signal"], at=(0, -5.76, zr))
    s.add(plate([(-0.5, 0.25), (0.5, 0.25), (0.35, -0.9), (-0.35, -0.9)], 0.3, "xz"), m["hull"], at=(0, -3.25, zr - 0.2))
    s.add(rbox(1.6, 1.5, 0.75, 0.08, 1), m["hull"], at=(0, 1.35, zc + 1.05))
    for k in range(4):
        s.add(post(12, 0.13, 0.13, 0.0, 0.32), m["dark"], at=(0.85, 0.85 + 0.35 * k, zc + 0.85), mirror=True)
        s.add(post(12, 0.09, 0.09, 0.32, 0.36), m["signal"], at=(0.85, 0.85 + 0.35 * k, zc + 0.85), mirror=True)
    s.add(sweep([(0.0, -3.1, zr + 0.36), (0.0, 0.6, zr + 0.4)], rect(0.06, 0.04)), m["signal"])
    # Gimbal um den Rumpf: Messing-Zahnkranz quer, darin ein geneigter Spulenring, beide auf Zapfen an den Flanken
    gy, gz = -1.2, zc + 0.15
    s.add(hoop(48, 1.84, 1.96, 0.24), m["brass"], at=(0, gy, gz), rot=(90, 0, 0))
    s.add(hoop(48, 1.8, 1.86, 0.12), m["signal"], at=(0, gy, gz), rot=(90, 0, 0))
    for k in range(40):
        a = 2 * math.pi * k / 40
        s.add(box(0.14, 0.2, 0.13), m["brass"], at=(2.02 * math.cos(a), gy, gz + 2.02 * math.sin(a)), rot=(0, -math.degrees(a), 0))
    s.add(hoop(48, 1.64, 1.73, 0.12), m["steel"], at=(0, gy, gz), rot=(142, 0, 0))
    s.add(hoop(48, 1.6, 1.65, 0.07), m["signal"], at=(0, gy, gz), rot=(142, 0, 0))
    s.add(tube(16, 0.17, 0.17, -0.3, 0.3), m["brass"], at=(1.75, gy, gz), rot=(0, 0, 90), mirror=True)
    s.add(tube(16, 0.11, 0.11, 0.3, 0.36), m["signal"], at=(1.75, gy, gz), rot=(0, 0, 90), mirror=True)
    s.add(tube(12, 0.26, 0.26, -0.12, 0.12), m["dark"], at=(1.62, gy, gz), rot=(0, 0, 90), mirror=True)
    # Pendel unter dem Kiel: Lagerbock, Messingstange, linsenförmiges Gewicht mit leuchtendem Kern, im Schwung nach achtern
    py, pz, swing = 1.7, zc - 0.78, math.radians(14)
    d = Vector((0, math.sin(swing), -math.cos(swing)))
    pivot = Vector((0, py, pz))
    s.add(rbox(0.5, 0.5, 0.3, 0.05, 1), m["dark"], at=(0, py, pz + 0.12))
    s.add(tube(16, 0.09, 0.09, -0.3, 0.3), m["brass"], at=(0, py, pz), rot=(0, 0, 90))
    s.add(segment(pivot, pivot + d * 0.75, 0.05, 8), m["brass"])
    bob = pivot + d * 0.92
    s.add(revolve([(0.0, -0.13), (0.3, -0.1), (0.44, -0.04), (0.44, 0.04), (0.3, 0.1), (0.0, 0.13)], 28), m["brass"], at=tuple(bob), rot=(0, 0, 90))
    s.add(tube(20, 0.2, 0.2, -0.14, 0.14), m["signal"], at=tuple(bob), rot=(0, 0, 90))
    s.add(hoop(28, 0.44, 0.5, 0.06), m["steel"], at=tuple(bob), rot=(0, 90, 0))
    # Zwei Türme auf dem Vorschiff neben dem Railgun-Gehäuse
    turret(s, m, (1.0, -2.4, zc + 0.75), barrel=0.8, r=0.3, mirror=True)
    # Wappen auf dem Verschluss: Zahnrad mit Zeigern
    face = ngon(20, 0.62)
    hands = [[(-0.035, -0.02), (0.035, -0.02), (0.025, 0.36), (-0.025, 0.36)], [(-0.035, -0.02), (0.035, -0.02), (0.025, 0.25), (-0.025, 0.25)]]
    hands = [hands[0], [(x * math.cos(2.1) - y * math.sin(2.1), x * math.sin(2.1) + y * math.cos(2.1)) for x, y in hands[1]]]
    emblem(s, m, (0, 1.35, zc + 1.42), face, [(gear(12, 0.5, 0.09), "brass"), (ngon(16, 0.3), "signal")] + [(h, "trim") for h in hands])
    # Brücke achtern mit Uhrenfenster am zweiten Deck
    top = bridge(s, m, (0, 3.0, zc + 0.75), [(1.6, 1.3, 0.5), (1.15, 0.95, 0.45), (0.8, 0.65, 0.38)], per_deck=6)
    s.add(tube(24, 0.24, 0.24, -0.03, 0.03), m["brass"], at=(0, 3.0 - 0.95 / 2 - 0.03, zc + 0.75 + 0.5 + 0.22))
    s.add(tube(24, 0.19, 0.19, -0.05, 0.0), m["signal"], at=(0, 3.0 - 0.95 / 2 - 0.05, zc + 0.75 + 0.5 + 0.22))
    radar(s, m, (0, 2.75, top), 0.5, 0.2)
    s.add(dish(0.2, 0.07, 12, 2, 0.02), m["steel"], at=(0.7, 3.3, zc + 1.6), rot=(-50, 0, -50), mirror=True)
    # Düsen in Messingfassungen, Flak, Fenster, Lüfter, Kleinteile, Kiel
    s.add(rbox(2.4, 0.6, 1.3, 0.08, 1), m["dark"], at=(0, 4.25, zc + 0.15))
    for dx, dz, r in ((0.6, 0.0, 0.44), (1.25, 0.4, 0.28)):
        s.engine(m, r, 4.35, 5.05 if r > 0.3 else 4.85, dx=dx, dz=zc + dz, n=20 if r > 0.3 else 16, mirror=True, plume=0.22)
        s.add(hoop(20, r, r + 0.08, 0.1), m["brass"], at=(dx, 4.6, zc + dz), rot=(90, 0, 0), mirror=True)
    pd_turret(s, m, (1.35, 1.6, zc + 0.75), r=0.11, mirror=True)
    pd_turret(s, m, (1.2, 3.9, zc + 0.75), r=0.11, yaw=180, mirror=True)
    windows(s, m, (1.62, -2.0, zc + 0.35), (1.62, 3.4, zc + 0.35), 12, (0.03, 0.06, 0.05), mirror=True)
    vents(s, m, (0.95, 3.6, zc + 0.76), 0.4, 0.16, slots=3, rot=(-90, 0, 0), mirror=True)
    greebles(s, m, (0.55, -0.4, 1.3, 0.6), zc + 0.75, 6, size=(0.06, 0.16), seed=53, mirror=True)
    keelfin = plate([(-2.6, 0.0), (0.6, 0.0), (0.4, -0.35), (-2.0, -0.3)], 0.1, "yz")
    inset(keelfin, 0.03, 0.01, 0.1)
    s.add(keelfin, m["hull"], at=(0, 0, zc - 0.7))
    s.add(sphere(0.05, 1), m["navgreen"], at=(1.62, -2.0, zc + 0.75))
    s.add(sphere(0.05, 1), m["navred"], at=(-1.62, -2.0, zc + 0.75))
    return s.finish()

def hologram(name, color, alpha, strength):
    """Leuchtendes, durchscheinendes Material eines Hologramms: konstantes Alpha unter 1 (glTF alphaMode BLEND),
    beidseitig, Emission in der Farbe."""
    mat = material(name, color, 0.0, 0.3, emission=color, strength=strength)
    bsdf = next(n for n in mat.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
    bsdf.inputs["Alpha"].default_value = alpha
    mat.surface_render_method = "BLENDED"
    mat.use_backface_culling = False
    return mat


def decoy():
    """Trugbild (Token der Admiralsfähigkeit des Phantoms): Hologramm eines Jägers in Moreaus Türkis, aus
    durchscheinenden Facetten mit leuchtenden Kanten und Scanlinien; wenige Dreiecke, kein Bevel, flach schattiert."""
    s = Ship("decoy")
    m = {"face": hologram("decoy_face", MOREAU, 0.16, 0.6), "edge": hologram("decoy_edge", MOREAU, 0.9, 2.4)}
    edge = rect(0.03, 0.03)

    def outline(points):
        s.add(sweep(points + points[:2], edge), m["edge"])

    # Rumpf: Facetten wie bei der Mirage; Längskanten und drei Scanlinien-Ringe
    stations = [(-2.2, 0.5, 0.2), (-0.9, 1.0, 0.4), (0.7, 1.15, 0.46), (2.1, 0.85, 0.36), (2.7, 0.6, 0.28)]
    rings = [sec(y, facet(w, h)) for y, w, h in stations]
    nose = tip(-3.1, 0, 0.0)
    s.add(loft([nose] + rings), m["face"])
    for i in range(6):
        s.add(sweep([nose] + [ring[i] for ring in rings], edge), m["edge"])
    outline([tuple(p) for p in rings[-1]])
    for y in (-1.6, -0.1, 1.4):
        a, b = (0, 1) if y < -0.9 else (1, 2) if y < 0.7 else (2, 3)
        ya, yb = stations[a][0], stations[b][0]
        t = (y - ya) / (yb - ya)
        ring = [ra.lerp(rb, t) for ra, rb in zip(rings[a], rings[b])]
        outline([tuple(p) for p in ring])
    # Kanzel als leuchtende Facette
    s.add(loft([sec(y, facet(w, h, 0.5, 0.8, 1.0)) for y, w, h in ((-1.5, 0.26, 0.06), (-0.9, 0.5, 0.26), (-0.2, 0.42, 0.22))]), m["edge"], at=(0, 0, 0.2))
    # Diamantflügel und schräge Flossen: Fläche und leuchtender Umriss
    wing = [(0.45, -1.3), (2.05, 0.75), (2.1, 1.25), (1.55, 1.05), (1.15, 1.85), (0.45, 1.75)]
    for side in (1, -1):
        pts = [(side * x, y) for x, y in wing]
        s.add(plate(pts, 0.03, "xy"), m["face"], at=(0, 0, -0.04))
        outline([(x, y, -0.04) for x, y in pts])
        fin = [(0.9, 0.0), (2.6, 0.0), (2.95, 0.95), (2.25, 1.0)]
        g = Ship("decoy_fin")
        g.add(plate(fin, 0.02, "yz"), m["face"])
        g.add(sweep([(0, y, z) for y, z in fin + fin[:2]], edge), m["edge"])
        s.place(g, at=(side * 0.3, 0, 0.18), rot=(0, side * 24, 0))
        g.bm.free()
    # Düsen als Lichtringe
    for side in (1, -1):
        s.add(hoop(12, 0.12, 0.2, 0.04), m["edge"], at=(side * 0.3, 2.72, 0.0), rot=(90, 0, 0))
        s.add(tube(12, 0.12, 0.0, 2.7, 3.1), m["face"], at=(side * 0.3, 0, 0.0))
    obj = s.finish(bevel=None)
    obj.data.shade_flat()
    return obj

SHIPS = {
    "void_interceptor": void_interceptor,
    "scrap_raider": scrap_raider,
    "horizon_cruiser": horizon_cruiser,
    "plasma_frigate": plasma_frigate,
    "iron_dreadnought": iron_dreadnought,
    "titan_carrier": titan_carrier,
    "drone": drone,
    "repair_drone": repair_drone,
    "signal_booster": signal_booster,
    "bastion": bastion,
    "vanguard": vanguard,
    "hive": hive,
    "mirage": mirage,
    "pendulum": pendulum,
    "decoy": decoy,
}


def build(ship_id):
    return SHIPS[ship_id]()
