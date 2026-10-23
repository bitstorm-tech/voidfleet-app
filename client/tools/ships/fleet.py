"""Die acht Schiffe von Voidfleet, je eine Funktion pro Karten-ID (siehe shared/cards.ts).

Größen in Blender-Einheiten; auf dem Brett wirkt MODEL_SCALE × BOARD_SCALE aus ship.ts.
Jäger ~5, Kreuzer ~6-7, Schlachtschiffe ~7.5, Unterstützer ~4.5 Einheiten lang.
Vorn ist -Y, oben +Z; `mirror=True` spiegelt ein Teil an der Längsachse.
"""

import math

from vf import (WHITE, Ship, box, dish, hexagon, hoop, keel, loft, ngon, octagon, palette, plate, post, rect, sec,
                sphere, tip, tube)

FIGHTER_ACCENT, FIGHTER_GLOW = (0.78, 0.13, 0.045), (1.0, 0.35, 0.1)
CRUISER_ACCENT, CRUISER_GLOW = (0.08, 0.26, 0.85), (0.25, 0.55, 1.0)
BATTLESHIP_HULL, BATTLESHIP_ACCENT, BATTLESHIP_GLOW = (0.13, 0.15, 0.19), (0.26, 0.3, 0.38), (0.3, 0.6, 1.0)
SUPPORT_ACCENT, SUPPORT_GLOW, SUPPORT_CANOPY = (0.08, 0.62, 0.4), (0.3, 1.0, 0.6), (0.1, 0.5, 0.3)
OCT = math.pi / 8  # Achteck mit flacher Ober- und Unterseite


def turret(s, m, at, barrel=1.1, r=0.42):
    """Drehbarer Zwillingsturm: Sockel, Gehäuse, zwei Rohre nach vorn."""
    x, y, z = at
    s.add(post(8, r, r * 0.92, 0.0, 0.16, x, y), m["steel"], at=(0, 0, z))
    s.add(loft([sec(-0.5, octagon(1.6 * r, 0.7 * r)), sec(0.5, octagon(1.7 * r, 0.75 * r))]), m["hull"], at=(x, y, z + 0.16 + 0.37 * r))
    for dx in (-0.32 * r, 0.32 * r):
        s.add(tube(6, 0.07, 0.06, -barrel, 0.0), m["steel"], at=(x + dx, y - 0.4, z + 0.16 + 0.42 * r))


# ---------------------------------------------------------------- Jäger


def void_interceptor():
    s = Ship("void_interceptor")
    m = palette(s.name, FIGHTER_ACCENT, FIGHTER_GLOW)
    # Rumpf mit Nadelnase
    s.add(loft([
        tip(-3.1),
        sec(-2.3, hexagon(0.34, 0.2)),
        sec(-1.2, hexagon(0.72, 0.46)),
        sec(0.0, hexagon(0.9, 0.58)),
        sec(1.3, hexagon(0.8, 0.52)),
        sec(2.1, hexagon(0.55, 0.42)),
    ]), m["hull"])
    # Kanzel
    s.add(loft([
        sec(-1.7, octagon(0.2, 0.05)),
        sec(-1.3, octagon(0.4, 0.22)),
        sec(-0.3, octagon(0.44, 0.26)),
        sec(0.2, octagon(0.3, 0.12)),
    ]), m["canopy"], at=(0, 0, 0.3))
    # Klingenflügel mit Streifen an der Vorderkante, leicht abgesenkt
    s.add(plate([(0.3, -1.2), (1.75, 0.9), (1.75, 1.25), (0.3, 1.5)], 0.08, "xy"), m["hull"], at=(0, 0, -0.05), rot=(0, -5, 0), mirror=True)
    s.add(plate([(0.35, -1.1), (1.65, 0.92), (1.65, 1.06), (0.35, -0.9)], 0.1, "xy"), m["accent"], at=(0, 0, -0.05), rot=(0, -5, 0), mirror=True)
    # Lufteinlässe an den Flanken
    s.add(box(0.3, 1.0, 0.32), m["hull"], at=(0.52, -0.3, 0.0), mirror=True)
    s.add(box(0.2, 0.08, 0.2), m["dark"], at=(0.52, -0.82, 0.0), mirror=True)
    # Triebwerksgondeln unter den Flügeln
    s.add(loft([tip(-0.7), sec(-0.3, ngon(8, 0.26, phase=OCT)), sec(1.9, ngon(8, 0.28, phase=OCT)), sec(2.3, ngon(8, 0.22, phase=OCT))]),
          m["hull"], at=(0.78, 0, -0.12), mirror=True)
    s.engine(m, 0.24, 2.2, 2.42, dx=0.78, dz=-0.12, mirror=True)
    # V-Leitwerk
    s.add(plate([(1.0, 0.0), (2.1, 0.0), (2.35, 0.7), (1.95, 0.75)], 0.05, "yz"), m["accent"], at=(0.3, 0, 0.2), rot=(0, 32, 0), mirror=True)
    # Bugkanonen mit leuchtender Mündung
    s.add(tube(6, 0.06, 0.03, -2.2, 0.0), m["steel"], at=(0.42, -1.2, -0.02), mirror=True)
    s.add(tube(6, 0.045, 0.045, -0.12, 0.0), m["glow"], at=(0.42, -3.3, -0.02), mirror=True)
    # Kiel und Positionslichter
    s.add(plate([(-0.8, 0), (1.6, 0), (1.5, -0.3), (-0.2, -0.32)], 0.08, "yz"), m["hull"], at=(0, 0, -0.28))
    s.add(box(0.06, 0.5, 0.06), m["glow"], at=(0.5, 0.6, 0.05), mirror=True)
    return s.finish()


def scrap_raider():
    s = Ship("scrap_raider")
    m = palette(s.name, (0.62, 0.24, 0.07), (1.0, 0.45, 0.12), hull=(0.075, 0.07, 0.065), rust=(0.3, 0.13, 0.06))
    # Kantiger Rumpf, vorn zum Rammsporn zusammenlaufend
    s.add(loft([
        sec(-3.0, rect(0.5, 0.06)),
        sec(-2.3, octagon(0.8, 0.5)),
        sec(-1.0, octagon(1.35, 0.82)),
        sec(0.8, octagon(1.45, 0.88)),
        sec(2.2, octagon(1.1, 0.7)),
    ]), m["hull"])
    s.add(tube(6, 0.07, 0.0, -2.5, -3.6), m["steel"], at=(0, 0, 0.12))
    s.add(tube(6, 0.06, 0.0, -2.4, -3.3), m["steel"], at=(0.28, 0, -0.1), mirror=True)
    # Kanzel, seitlich versetzt
    s.add(loft([sec(-1.6, octagon(0.2, 0.06)), sec(-1.25, octagon(0.36, 0.24)), sec(-0.6, octagon(0.4, 0.26)), sec(-0.3, octagon(0.26, 0.1))]),
          m["canopy"], at=(0.2, 0, 0.42))
    # Backbord: schwere Kanonengondel mit langem Lauf
    s.add(loft([sec(-1.6, octagon(0.4, 0.4)), sec(-1.2, octagon(0.62, 0.6)), sec(1.5, octagon(0.62, 0.6)), sec(1.9, octagon(0.46, 0.46))]),
          m["hull"], at=(-1.05, 0, -0.1))
    s.add(tube(8, 0.12, 0.1, -3.4, -1.5), m["steel"], at=(-1.05, 0, -0.1))
    s.add(tube(8, 0.17, 0.17, -2.2, -1.9), m["dark"], at=(-1.05, 0, -0.1))
    s.add(box(0.5, 1.4, 0.16), m["rust"], at=(-0.72, 0.3, 0.05))
    s.engine(m, 0.2, 1.85, 2.05, dx=-1.05, dz=-0.1)
    # Steuerbord: Stummelflügel mit Stachel und kleiner Gondel
    s.add(plate([(0.7, -0.6), (1.5, -0.2), (1.6, 1.4), (0.7, 1.2)], 0.12, "xy"), m["rust"], at=(0, 0, -0.05))
    s.add(tube(6, 0.07, 0.0, -0.3, -1.5), m["steel"], at=(1.45, 0, -0.05))
    s.add(loft([tip(-0.9), sec(-0.5, octagon(0.34, 0.34)), sec(1.4, octagon(0.36, 0.36)), sec(1.7, octagon(0.28, 0.28))]), m["hull"], at=(1.25, 0, 0.16))
    s.engine(m, 0.16, 1.65, 1.82, dx=1.25, dz=0.16)
    # Drei Hauptdüsen im Dreieck
    for dx, dz in ((0, 0.28), (-0.42, -0.2), (0.42, -0.2)):
        s.add(tube(6, 0.3, 0.33, 2.1, 2.6, dx, dz, phase=math.pi / 6), m["dark"])
        s.add(tube(6, 0.23, 0.23, 2.5, 2.64, dx, dz, phase=math.pi / 6), m["glow"])
    # Zusammengeflickte Platten in schiefen Winkeln
    for x, y, z, tilt, w, l in ((0.5, -1.3, 0.38, 6, 0.5, 0.7), (-0.45, 0.3, 0.42, -4, 0.55, 0.9), (0.35, 1.3, 0.34, 4, 0.6, 0.5),
                                (0.7, -0.2, 0.06, 16, 0.3, 0.8), (-0.25, -1.9, 0.24, -8, 0.4, 0.5), (-0.66, 1.2, 0.0, -40, 0.3, 0.7)):
        s.add(box(w, l, 0.1), m["rust"], at=(x, y, z), rot=(0, tilt, 3))
    # Abgasrohr, schiefe Schrottflosse und Gitterplatte
    s.add(tube(6, 0.07, 0.07, -0.6, 1.4), m["dark"], at=(-0.55, 0.4, 0.5))
    s.add(tube(6, 0.07, 0.07, -0.25, 0.0), m["dark"], at=(-0.55, 0.0, 0.5), rot=(0, 0, 0))
    s.add(plate([(0.4, 0.0), (1.5, 0.1), (1.3, 0.75), (0.7, 0.6)], 0.06, "yz"), m["rust"], at=(-0.3, 0, 0.4), rot=(0, -25, 0))
    s.add(box(0.06, 0.5, 0.06), m["glow"], at=(-0.32, 0.9, 0.9), rot=(0, -25, 0))
    s.add(box(0.9, 0.5, 0.05), m["dark"], at=(0.1, 0.5, 0.46), rot=(0, 0, 5))
    # Lichter und Antenne
    s.add(box(0.06, 0.8, 0.06), m["glow"], at=(0.74, -0.8, 0.25))
    s.add(box(0.5, 0.06, 0.06), m["glow"], at=(0, -2.2, 0.3))
    s.add(post(6, 0.03, 0.02, 0.4, 1.3, -0.4, 1.2), m["steel"])
    return s.finish()


# ---------------------------------------------------------------- Kreuzer


def horizon_cruiser():
    s = Ship("horizon_cruiser")
    m = palette(s.name, CRUISER_ACCENT, CRUISER_GLOW)
    # Langer schlanker Rumpf mit flachem Bug
    s.add(loft([
        tip(-3.6, 0, 0.02),
        sec(-3.0, hexagon(0.5, 0.26)),
        sec(-1.9, hexagon(1.1, 0.6)),
        sec(-0.4, hexagon(1.45, 0.76)),
        sec(1.6, hexagon(1.45, 0.76)),
        sec(2.8, hexagon(1.15, 0.66)),
        sec(3.3, hexagon(0.85, 0.5)),
    ]), m["hull"])
    # Rückgrat und Aufbauten
    s.add(loft([
        sec(-2.4, octagon(0.5, 0.2)),
        sec(-1.6, octagon(0.74, 0.42)),
        sec(2.2, octagon(0.74, 0.42)),
        sec(2.7, octagon(0.5, 0.3)),
    ]), m["hull"], at=(0, 0, 0.42))
    s.add(box(0.56, 0.7, 0.22), m["accent"], at=(0, -1.1, 0.62))
    s.add(box(0.1, 0.36, 0.12), m["glow"], at=(0, -1.1, 0.78))
    turret(s, m, (0, -2.0, 0.42), barrel=0.8, r=0.26)
    # Brückenturm mit Mast
    s.add(box(1.0, 1.2, 0.42), m["hull"], at=(0, 1.5, 0.82))
    s.add(box(0.72, 0.82, 0.34), m["steel"], at=(0, 1.55, 1.18))
    s.add(box(0.46, 0.5, 0.26), m["hull"], at=(0, 1.6, 1.46))
    s.add(box(0.5, 0.12, 0.1), m["canopy"], at=(0, 1.14, 1.2))
    s.add(post(6, 0.04, 0.03, 1.5, 2.4, 0, 1.75), m["steel"])
    s.add(box(0.7, 0.05, 0.05), m["steel"], at=(0, 1.75, 2.2))
    s.add(box(0.4, 0.05, 0.05), m["steel"], at=(0, 1.75, 2.0))
    # Gondeln an Pylonen, blaue Leuchtstreifen
    s.add(loft([
        tip(-1.1),
        sec(-0.7, octagon(0.46, 0.5)),
        sec(2.4, octagon(0.52, 0.56)),
        sec(2.9, octagon(0.44, 0.48)),
    ]), m["hull"], at=(1.12, 0, 0.02), mirror=True)
    s.add(plate([(0.6, -0.3), (1.12, 0.1), (1.12, 2.2), (0.6, 2.0)], 0.14, "xy"), m["hull"], at=(0, 0, 0.05), mirror=True)
    s.add(box(0.05, 2.2, 0.1), m["glow"], at=(1.39, 0.9, 0.08), mirror=True)
    s.add(box(0.05, 2.2, 0.1), m["accent"], at=(1.39, 0.9, -0.1), mirror=True)
    s.engine(m, 0.24, 2.85, 3.08, dx=1.12, dz=0.02, mirror=True)
    # Hauptdüsen, Flankenpaneele, Heckflossen, Bugsensoren
    s.engine(m, 0.2, 3.25, 3.5, dx=0.3, dz=-0.02, mirror=True)
    s.add(box(0.6, 1.6, 0.05), m["accent"], at=(0.5, 0.2, -0.36), mirror=True)
    s.add(box(0.05, 1.2, 0.08), m["glow"], at=(0.5, -2.1, 0.12), mirror=True)
    s.add(plate([(1.4, 0.0), (2.6, -0.05), (2.9, 0.45), (2.2, 0.5)], 0.06, "yz"), m["accent"], at=(0.78, 0, 0.1), rot=(0, 50, 0), mirror=True)
    s.add(tube(6, 0.05, 0.02, -1.6, 0), m["steel"], at=(0.4, -2.4, -0.05), mirror=True)
    s.add(plate([(0.6, 0.0), (2.6, 0.0), (2.8, -0.55), (1.4, -0.5)], 0.08, "yz"), m["hull"], at=(0, 0, -0.3))
    s.add(box(0.05, 1.0, 0.1), m["canopy"], at=(0.38, 0.2, 0.52), mirror=True)
    return s.finish()


def plasma_frigate():
    s = Ship("plasma_frigate")
    m = palette(s.name, CRUISER_ACCENT, CRUISER_GLOW, plasma=((0.55, 0.2, 1.0), (0.6, 0.25, 1.0)))
    # Gedrungener Rumpf
    s.add(loft([
        sec(-2.6, octagon(0.8, 0.6)),
        sec(-2.0, octagon(1.2, 0.9)),
        sec(-0.6, octagon(1.9, 1.1)),
        sec(1.0, octagon(1.9, 1.1)),
        sec(2.3, octagon(1.3, 0.9)),
    ]), m["hull"])
    s.add(plate([(0.3, -1.6), (0.9, -1.2), (0.9, 1.4), (0.3, 1.6)], 0.08, "xy"), m["accent"], at=(0, 0, 0.56), mirror=True)
    # Hauptkanone: Lagerblock, Lauf, Mündung mit Plasmaring
    s.add(loft([sec(-3.0, ngon(8, 0.3, phase=OCT)), sec(-2.6, ngon(8, 0.46, phase=OCT)), sec(-1.2, ngon(8, 0.5, phase=OCT))]), m["dark"], at=(0, 0, -0.05))
    s.add(tube(8, 0.3, 0.34, -3.5, -3.0, dz=-0.05, phase=OCT), m["steel"])
    s.add(hoop(8, 0.2, 0.4, 0.12), m["plasma"], at=(0, -3.55, -0.05), rot=(90, 0, 0))
    s.add(tube(8, 0.18, 0.18, -3.62, -3.5, dz=-0.05), m["plasma"])
    # Vier Gondeln mit leuchtenden Einlassringen
    for dz in (0.4, -0.4):
        s.add(loft([tip(-1.6), sec(-1.2, ngon(8, 0.3, phase=OCT)), sec(1.7, ngon(8, 0.33, phase=OCT)), sec(2.0, ngon(8, 0.26, phase=OCT))]),
              m["hull"], at=(1.22, 0, dz), mirror=True)
        s.add(hoop(8, 0.14, 0.27, 0.08), m["glow"], at=(1.22, -1.22, dz), rot=(90, 0, 0), mirror=True)
        s.engine(m, 0.24, 1.9, 2.1, dx=1.22, dz=dz, mirror=True)
    s.add(box(0.5, 0.6, 1.1), m["dark"], at=(1.05, 0.3, 0), mirror=True)
    s.add(box(0.5, 0.4, 1.1), m["dark"], at=(1.05, -0.8, 0), mirror=True)
    for y, mat in ((-3.3, "plasma"), (-3.1, "steel"), (-2.9, "plasma")):
        s.add(hoop(8, 0.3, 0.41, 0.07), m[mat], at=(0, y, -0.05), rot=(90, 0, 0))
    # Plasmaleitungen, Sensoren, Brücke, Heckdüsen
    s.add(box(0.06, 2.0, 0.1), m["plasma"], at=(0.82, -0.2, 0.2), mirror=True)
    s.add(box(0.06, 0.8, 0.08), m["glow"], at=(0.82, -1.9, -0.2), mirror=True)
    s.add(loft([sec(-1.5, octagon(0.3, 0.1)), sec(-0.7, octagon(0.8, 0.44)), sec(0.5, octagon(0.9, 0.5)), sec(1.1, octagon(0.5, 0.3))]),
          m["hull"], at=(0, 0, 0.62))
    s.add(box(0.5, 0.1, 0.12), m["canopy"], at=(0, -1.0, 0.72))
    s.add(box(0.4, 0.5, 0.2), m["accent"], at=(0, 0.9, 0.84))
    s.add(post(6, 0.03, 0.02, 0.7, 1.4, -0.3, 1.0), m["steel"])
    s.engine(m, 0.28, 2.3, 2.56, dx=0.38, dz=-0.05, mirror=True)
    return s.finish()


# ---------------------------------------------------------------- Schlachtschiffe


def iron_dreadnought():
    s = Ship("iron_dreadnought")
    m = palette(s.name, BATTLESHIP_ACCENT, BATTLESHIP_GLOW, hull=BATTLESHIP_HULL, shield=((1.0, 0.15, 0.55), (1.0, 0.2, 0.6)))
    # Breiter Keilrumpf
    s.add(loft([
        sec(-3.9, keel(0.6, 0.5)),
        sec(-2.8, keel(1.8, 0.9)),
        sec(-1.2, keel(3.6, 1.3)),
        sec(0.6, keel(4.4, 1.4)),
        sec(2.4, keel(3.8, 1.3)),
        sec(3.4, keel(2.6, 1.0)),
    ]), m["hull"], at=(0, 0, 0.1))
    # Panzerschürzen in zwei Lagen
    s.add(plate([(0.6, -3.0), (2.3, -1.0), (2.6, 1.0), (2.2, 2.9), (0.6, 2.9)], 0.22, "xy"), m["steel"], at=(0, 0, 0.3), mirror=True)
    s.add(plate([(0.8, -2.2), (2.5, -0.4), (2.5, 1.6), (0.8, 2.4)], 0.2, "xy"), m["accent"], at=(0, 0, -0.2), mirror=True)
    # Dorsaldeck mit vier Zwillingstürmen
    s.add(loft([sec(-3.0, octagon(0.6, 0.3)), sec(-2.2, octagon(1.8, 0.5)), sec(2.6, octagon(2.2, 0.55)), sec(3.2, octagon(1.4, 0.4))]), m["hull"], at=(0, 0, 0.95))
    for at in ((0, -1.9, 1.2), (0, -0.4, 1.22), (-1.4, 0.9, 0.95), (1.4, 0.9, 0.95)):
        turret(s, m, at)
    # Aufbauten achtern mit Mast
    s.add(box(1.6, 1.3, 0.5), m["hull"], at=(0, 1.9, 1.45))
    s.add(box(1.1, 0.9, 0.45), m["steel"], at=(0, 2.0, 1.9))
    s.add(box(0.7, 0.6, 0.4), m["hull"], at=(0, 2.05, 2.3))
    s.add(box(1.1, 0.1, 0.12), m["canopy"], at=(0, 1.44, 1.9))
    s.add(post(6, 0.05, 0.03, 2.5, 3.4, 0, 2.1), m["steel"])
    s.add(box(1.0, 0.06, 0.06), m["steel"], at=(0, 2.1, 3.0))
    s.add(box(0.6, 0.06, 0.06), m["steel"], at=(0, 2.1, 3.25))
    s.add(sphere(0.12), m["dark"], at=(0, 2.1, 3.45))
    # Seitliche Kasematten
    s.add(box(0.7, 1.6, 0.5), m["hull"], at=(2.1, 0.6, 0.35), mirror=True)
    s.add(tube(6, 0.06, 0.05, -1.0, 0.0), m["steel"], at=(2.0, -0.2, 0.45), mirror=True)
    s.add(tube(6, 0.06, 0.05, -1.0, 0.0), m["steel"], at=(2.25, -0.2, 0.45), mirror=True)
    # Belagerungskanonen am Bug
    s.add(tube(8, 0.16, 0.14, -4.6, -2.6), m["steel"], at=(0.5, 0, 0.35), mirror=True)
    s.add(tube(8, 0.21, 0.21, -3.2, -2.9), m["dark"], at=(0.5, 0, 0.35), mirror=True)
    s.add(tube(8, 0.1, 0.1, -4.72, -4.58), m["shield"], at=(0.5, 0, 0.35), mirror=True)
    # Schildemitter (magenta) und Positionslichter
    s.add(box(0.08, 1.4, 0.1), m["shield"], at=(1.1, -1.4, 0.95), mirror=True)
    s.add(box(0.4, 0.06, 0.14), m["shield"], at=(0, -3.55, 0.5))
    s.add(box(0.08, 1.2, 0.08), m["glow"], at=(2.2, 1.0, 0.65), mirror=True)
    # Deckaufbauten, Hecktürme, Leuchtstreifen am Turm
    for y in (-1.0, 0.2, 1.4):
        s.add(box(0.3, 0.5, 0.25), m["dark"], at=(1.9, y, 0.75), mirror=True)
    turret(s, m, (0.9, 3.0, 0.95), barrel=0.7, r=0.26)
    turret(s, m, (-0.9, 3.0, 0.95), barrel=0.7, r=0.26)
    s.add(box(0.06, 0.8, 0.08), m["glow"], at=(0.83, 1.9, 1.5), mirror=True)
    s.add(box(0.5, 0.06, 0.08), m["glow"], at=(0, 2.37, 2.3))
    # Vier Heckdüsen
    for dz in (0.45, -0.25):
        s.engine(m, 0.32, 3.4, 3.75, dx=0.6, dz=dz, mirror=True)
    return s.finish()


def titan_carrier():
    s = Ship("titan_carrier")
    m = palette(s.name, BATTLESHIP_ACCENT, BATTLESHIP_GLOW, hull=BATTLESHIP_HULL, core=((0.55, 0.2, 1.0), (0.6, 0.25, 1.0)))
    # Unterrumpf
    s.add(loft([
        sec(-3.8, keel(0.5, 0.4)),
        sec(-2.4, keel(2.2, 1.0)),
        sec(-0.4, keel(3.9, 1.35)),
        sec(2.2, keel(3.9, 1.35)),
        sec(3.4, keel(2.9, 1.05)),
        sec(3.8, keel(2.0, 0.8)),
    ]), m["hull"], at=(0, 0, -0.2))
    # Flugdeck mit Landebahnmarkierungen
    deck = [(0.0, -4.1), (1.7, -2.5), (2.4, 0.2), (2.4, 2.6), (2.0, 3.8), (-2.0, 3.8), (-2.4, 2.6), (-2.4, 0.2), (-1.7, -2.5)]
    s.add(plate(deck, 0.2, "xy"), m["steel"], at=(0, 0, 0.5))
    s.add(plate([(x * 0.93, y * 0.93) for x, y in deck], 0.04, "xy"), m["hull"], at=(0, 0, 0.62))
    s.add(box(0.05, 5.6, 0.03), m["glow"], at=(0.55, -0.4, 0.655), mirror=True)
    for y in range(-3, 4):
        s.add(box(0.08, 0.4, 0.03), m["glow"], at=(0, y * 0.9 - 0.3, 0.655))
    s.add(box(0.4, 0.05, 0.03), m["glow"], at=(0, -3.2, 0.655))
    # Hangars an den Flanken mit leuchtenden Toren
    for y in (-0.6, 1.2):
        s.add(box(0.5, 1.3, 0.55), m["dark"], at=(2.2, y, 0.08), mirror=True)
        s.add(box(0.06, 1.0, 0.35), m["glow"], at=(2.46, y, 0.08), mirror=True)
    # Insel achtern mit Masten
    s.add(box(1.5, 1.4, 0.45), m["hull"], at=(0.2, 2.5, 0.85))
    s.add(box(1.0, 1.0, 0.4), m["steel"], at=(0.2, 2.6, 1.27))
    s.add(box(0.6, 0.6, 0.35), m["hull"], at=(0.2, 2.7, 1.64))
    s.add(box(0.9, 0.08, 0.12), m["canopy"], at=(0.2, 2.09, 1.27))
    s.add(post(6, 0.05, 0.03, 1.8, 2.8, 0.2, 2.8), m["steel"])
    s.add(box(0.8, 0.06, 0.06), m["steel"], at=(0.2, 2.8, 2.5))
    s.add(post(6, 0.03, 0.02, 1.0, 1.9, -0.5, 3.0), m["steel"])
    # Drohnen auf dem Deck, Deckstrukturen, Sponsons mit Flaktürmen
    for at, yaw in (((0.0, -0.8, 0.7), 0), ((-1.3, 1.6, 0.7), 12), ((1.4, 0.6, 0.7), -8)):
        s.add(plate([(0.0, -0.5), (0.4, 0.3), (0.0, 0.2), (-0.4, 0.3)], 0.08, "xy"), m["accent"], at=at, rot=(0, 0, yaw))
        s.add(box(0.12, 0.5, 0.1), m["dark"], at=(at[0], at[1] + 0.05, at[2] + 0.04), rot=(0, 0, yaw))
    s.add(box(0.5, 0.9, 0.22), m["dark"], at=(-1.7, 2.7, 0.72))
    s.add(box(0.4, 0.4, 0.3), m["hull"], at=(1.8, 3.0, 0.76))
    s.add(box(0.7, 0.3, 0.2), m["dark"], at=(-1.6, -1.0, 0.7))
    turret(s, m, (2.0, 2.3, 0.62), barrel=0.6, r=0.22)
    turret(s, m, (-2.0, 2.3, 0.62), barrel=0.6, r=0.22)
    s.add(plate([(-3.6, -0.3), (-1.6, -0.3), (-1.2, -1.0), (-2.8, -0.9)], 0.1, "yz"), m["hull"], at=(0, 0, 0))
    # Reaktorkern im Bug
    s.add(plate(ngon(6, 0.5), 0.2, "xz"), m["dark"], at=(0, -3.75, 0.0))
    s.add(plate(ngon(6, 0.36), 0.3, "xz"), m["core"], at=(0, -3.95, 0.0))
    # Katapultschienen, Seitenlichter, Düsen
    s.add(box(0.06, 1.6, 0.06), m["accent"], at=(0.25, -2.4, 0.66), mirror=True)
    s.add(box(0.08, 2.0, 0.08), m["glow"], at=(2.42, -1.4, 0.3), mirror=True)
    for dx, r in ((0.5, 0.34), (1.3, 0.26)):
        s.engine(m, r, 3.7, 4.05, dx=dx, dz=-0.15, mirror=True)
    return s.finish()


# ---------------------------------------------------------------- Unterstützer


def repair_drone():
    s = Ship("repair_drone")
    m = palette(s.name, SUPPORT_ACCENT, SUPPORT_GLOW, hull=WHITE, canopy_glow=SUPPORT_CANOPY, amber=((1.0, 0.55, 0.15), (1.0, 0.6, 0.2)))
    # Runder Körper
    s.add(loft([
        tip(-2.1),
        sec(-1.85, ngon(8, 0.38, 0.32, OCT)),
        sec(-1.3, ngon(8, 0.72, 0.6, OCT)),
        sec(-0.4, ngon(8, 0.9, 0.74, OCT)),
        sec(0.6, ngon(8, 0.9, 0.74, OCT)),
        sec(1.4, ngon(8, 0.7, 0.58, OCT)),
        sec(1.9, ngon(8, 0.36, 0.3, OCT)),
        tip(2.1),
    ]), m["hull"])
    # Kanzel mit grünem Rahmen
    s.add(loft([sec(-1.55, octagon(0.4, 0.1)), sec(-1.2, octagon(0.74, 0.34)), sec(-0.3, octagon(0.8, 0.38)), sec(0.15, octagon(0.5, 0.16))]),
          m["accent"], at=(0, 0, 0.56))
    s.add(loft([sec(-1.5, octagon(0.3, 0.06)), sec(-1.2, octagon(0.6, 0.26)), sec(-0.3, octagon(0.66, 0.3)), sec(0.1, octagon(0.4, 0.1))]),
          m["canopy"], at=(0, 0, 0.62))
    # Sensorauge und kleine Linse vorn
    s.add(hoop(8, 0.2, 0.3, 0.1), m["dark"], at=(0.42, -1.72, 0.05), rot=(90, 0, 0))
    s.add(sphere(0.2), m["canopy"], at=(0.42, -1.75, 0.05))
    s.add(hoop(8, 0.1, 0.17, 0.08), m["dark"], at=(-0.45, -1.68, -0.18), rot=(90, 0, 0))
    s.add(sphere(0.1), m["glow"], at=(-0.45, -1.7, -0.18))
    # Seitliche Triebwerksgondeln
    s.add(loft([tip(-0.95), sec(-0.6, ngon(8, 0.3, phase=OCT)), sec(1.5, ngon(8, 0.34, phase=OCT)), sec(1.8, ngon(8, 0.28, phase=OCT))]),
          m["hull"], at=(1.2, 0, -0.1), mirror=True)
    s.add(box(0.6, 0.7, 0.3), m["dark"], at=(0.85, 0.3, -0.1), mirror=True)
    s.add(box(0.05, 1.2, 0.08), m["glow"], at=(1.5, 0.4, -0.1), mirror=True)
    s.engine(m, 0.26, 1.7, 1.9, dx=1.2, dz=-0.1, mirror=True)
    # Gefaltete Reparaturarme oben
    s.add(box(0.2, 0.3, 0.2), m["dark"], at=(0.4, 0.5, 0.78), mirror=True)
    s.add(box(0.12, 0.9, 0.12), m["dark"], at=(0.4, 0.2, 1.05), rot=(-35, 0, 0), mirror=True)
    s.add(sphere(0.1), m["accent"], at=(0.4, -0.15, 1.3), mirror=True)
    s.add(box(0.1, 0.8, 0.1), m["dark"], at=(0.4, 0.2, 1.42), rot=(20, 0, 0), mirror=True)
    s.add(box(0.06, 0.22, 0.14), m["steel"], at=(0.35, 0.6, 1.52), mirror=True)
    s.add(box(0.06, 0.22, 0.14), m["steel"], at=(0.45, 0.6, 1.52), mirror=True)
    # Ausgestreckter Schweißarm rechts unten
    s.add(box(0.14, 0.9, 0.14), m["dark"], at=(0.75, -1.1, -0.35), rot=(0, 0, -20))
    s.add(sphere(0.1), m["accent"], at=(0.9, -1.55, -0.4))
    s.add(box(0.1, 0.7, 0.1), m["dark"], at=(0.9, -1.9, -0.4))
    s.add(tube(6, 0.05, 0.02, -0.35, 0.0), m["amber"], at=(0.9, -2.25, -0.4))
    # Lichter und Heckdüsen
    s.add(box(0.5, 0.06, 0.06), m["amber"], at=(0.0, -1.9, 0.35))
    s.add(box(0.05, 0.6, 0.06), m["glow"], at=(0.86, -0.6, 0.3), mirror=True)
    s.engine(m, 0.2, 1.95, 2.15, dx=0.3, dz=-0.25, mirror=True)
    return s.finish()


def signal_booster():
    s = Ship("signal_booster")
    m = palette(s.name, SUPPORT_ACCENT, SUPPORT_GLOW, hull=WHITE, canopy_glow=SUPPORT_CANOPY, cyan=((0.2, 0.9, 1.0), (0.2, 0.9, 1.0)))
    # Kantiger Rumpf
    s.add(loft([
        sec(-2.4, octagon(0.6, 0.4)),
        sec(-1.6, octagon(1.4, 0.8)),
        sec(0.6, octagon(1.7, 0.95)),
        sec(1.8, octagon(1.3, 0.8)),
        sec(2.3, octagon(0.9, 0.6)),
    ]), m["hull"])
    s.add(box(1.0, 1.6, 0.3), m["dark"], at=(0, 0.2, 0.55))
    s.add(box(0.7, 2.2, 0.08), m["accent"], at=(0, 0, -0.5))
    # Große Hauptschüssel auf Gabelmast, Öffnung schräg nach vorn oben
    s.add(post(8, 0.1, 0.08, 0.5, 1.3, 0.2, -0.3), m["steel"])
    s.add(box(0.5, 0.2, 0.2), m["dark"], at=(0.2, -0.3, 1.3))
    tilt = -55
    s.add(dish(1.1, 0.36, 16, 3, 0.05), m["hull"], at=(0.2, -0.3, 1.45), rot=(tilt, 0, 0))
    axis = (0.0, -math.cos(math.radians(-tilt)), math.sin(math.radians(-tilt)))
    rim = tuple(c + 0.36 * a for c, a in zip((0.2, -0.3, 1.45), axis))
    focus = tuple(c + 0.84 * a for c, a in zip((0.2, -0.3, 1.45), axis))
    s.add(hoop(16, 1.06, 1.13, 0.05), m["cyan"], at=rim, rot=(tilt + 90, 0, 0))
    s.add(tube(6, 0.03, 0.03, -0.9, 0.0), m["steel"], at=(0.2, -0.3, 1.45), rot=(tilt, 0, 0))
    s.add(box(0.14, 0.14, 0.14), m["dark"], at=focus)
    s.add(sphere(0.06), m["cyan"], at=focus)
    # Zwei kleine Schüsseln achtern
    s.add(post(6, 0.04, 0.04, 0.3, 0.75, 0.95, 1.0), m["steel"])
    s.add(dish(0.4, 0.14, 12, 2, 0.04), m["hull"], at=(0.95, 1.0, 0.8), rot=(-40, 0, -30), mirror=True)
    s.add(post(6, 0.04, 0.04, 0.3, 0.75, -0.95, 1.0), m["steel"])
    # Relaismasten mit Querstreben
    s.add(post(6, 0.05, 0.03, 0.4, 2.2, -0.65, 1.5), m["steel"])
    for z in (1.6, 1.9, 2.1):
        s.add(box(0.5, 0.05, 0.05), m["steel"], at=(-0.65, 1.5, z))
    s.add(post(6, 0.04, 0.03, 0.4, 1.7, 0.7, -1.5), m["steel"])
    s.add(box(0.2, 0.2, 0.3), m["dark"], at=(0.7, -1.5, 1.1))
    s.add(box(0.4, 0.05, 0.05), m["steel"], at=(0.7, -1.5, 1.5))
    # Signalring um den Rumpf
    s.add(hoop(16, 1.7, 1.76, 0.03), m["cyan"], at=(0, 0.2, -0.1), rot=(6, 0, 0))
    # Seitliche Gondeln
    s.add(loft([tip(-0.8), sec(-0.5, ngon(8, 0.28, phase=OCT)), sec(1.6, ngon(8, 0.3, phase=OCT)), sec(1.9, ngon(8, 0.24, phase=OCT))]),
          m["hull"], at=(1.25, 0, -0.15), mirror=True)
    s.add(box(0.6, 0.6, 0.3), m["dark"], at=(0.9, 0.5, -0.15), mirror=True)
    s.engine(m, 0.22, 1.8, 2.0, dx=1.25, dz=-0.15, mirror=True)
    # Bugsensor und Lichter
    s.add(box(0.5, 0.3, 0.3), m["dark"], at=(0, -2.35, 0.1))
    s.add(sphere(0.14), m["cyan"], at=(0, -2.5, 0.1))
    s.add(box(0.05, 1.0, 0.08), m["glow"], at=(0.86, -0.4, 0.2), mirror=True)
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
