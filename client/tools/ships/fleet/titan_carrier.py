"""Titan Carrier (Schlachtschiff), Neubau im Clean-Toon-Stil.

Breiter Rumpf unter einem großen Flugdeck: Deckrand in Stahlblau, dunkle Landebahn mit zwei Lichtbändern, drei geparkte
Drohnen im Violett der Drohne, Insel achtern an Steuerbord aus drei Blöcken mit Fensterband und Mast. An beiden Flanken
unter dem Deck ein Hangardeck mit zwei offenen Toren (stahlblauer Rahmen, dunkle Rückwand, Lichtband). Vor dem Deck fällt
der Bug als Schräge ab, darin der violette Reaktorkern als flache Kuppel in einem dunklen Rahmen. Unten Schürzen und
Kiel, achtern vier Düsen. Etwa 2,6k Dreiecke (das alte Modell hatte 10,6k und 55 schwebende Teile).
"""

import math

import palette
import vf
from parts import engine, sym
from vf import Ship, box, grow, loft, ngon, plate, post, sec, sphere, wedge

# Flugdeck (x, y), Steuerbordhälfte von vorn nach achtern; gespiegelt ergibt das den ganzen Umriss
DECK = [(0.95, -3.45), (2.0, -2.35), (2.55, -0.4), (2.55, 2.75), (2.15, 3.85)]
CROWN = math.tan(math.radians(3))  # Neigung der Deckhälften: Auf dem Brett trennt das Kantenlicht sie an der Mittellinie


def hull(w, h):
    """Rumpfprofil: flaches Deck, senkrechte Flanke, steile untere Fase (in der Karte halbhell), flacher Boden."""
    return [(w / 2, 0.0), (w / 2, h / 2), (-w / 2, h / 2), (-w / 2, 0.0), (-0.3 * w, -h / 2), (0.3 * w, -h / 2)]


def crowned(half, ridge, bottom, k):
    """Deckplatte mit flachem First: Umriss aus der Steuerbordhälfte `half` (x, y), oben zwei Ebenen
    z = ridge - k·|x|, unten flach bei `bottom`."""
    return loft([sec(y, [(x, bottom), (x, ridge - k * x), (0.0, ridge), (-x, ridge - k * x), (-x, bottom)]) for x, y in half])


def hangar(s, m, y0, y1, doors):
    """Hangardeck an der Steuerbordflanke (gespiegelt), y0 bis y1, mit offenen Toren (y-Bereiche): dunkle Rückwand,
    Rahmen in Stahlblau, in halber Torhöhe ein Lichtband (von oben wie von unten zu sehen)."""
    xi, xo, back = 1.6, 2.42, 2.26  # innen, Außenkante des Rahmens, Rückwand der Tore
    z0, z1, zd0, zd1 = -0.42, 0.47, -0.24, 0.27  # Hangardeck unten/oben, Tor unten/oben
    length, mid = y1 - y0, (y0 + y1) / 2
    s.add(box(back - xi, length - 0.06, z1 - z0 - 0.04), m["dark"], at=((xi + back) / 2, mid, (z0 + z1) / 2), mirror=True)
    w = xo - xi
    s.add(box(w, length, z1 - zd1), m["accent"], at=(xi + w / 2, mid, (zd1 + z1) / 2), mirror=True)
    s.add(box(w, length, zd0 - z0), m["accent"], at=(xi + w / 2, mid, (z0 + zd0) / 2), mirror=True)
    edges = [y0] + [y for door in doors for y in door] + [y1]
    for a, b in zip(edges[::2], edges[1::2]):
        s.add(box(w, b - a, zd1 - zd0), m["accent"], at=(xi + w / 2, (a + b) / 2, (zd0 + zd1) / 2), mirror=True)
    for a, b in doors:
        s.add(box(0.05, b - a - 0.14, 0.07), m["glow"], at=(back + 0.02, (a + b) / 2, (zd0 + zd1) / 2), mirror=True)


def drone(s, m, at, yaw):
    """Geparkte Drohne, flach: Pfeilflügel im Violett der Drohne, darauf ein schmaler Rumpf."""
    x, y, z = at
    wing = [(0.0, -0.5), (0.48, 0.22), (0.22, 0.32), (0.0, 0.18), (-0.22, 0.32), (-0.48, 0.22)]
    s.add(plate(wing, 0.07, "xy"), m["drone"], at=(x, y, z + 0.02), rot=(0, 0, yaw))
    s.add(wedge(0.24, 0.7, 0.16, front=0.45, taper=0.6), m["hull"], at=(x, y, z + 0.1), rot=(0, 0, yaw))


def build():
    s = Ship("titan_carrier")
    m = vf.materials(s.name, "battleship")
    m["reactor"] = vf.light(f"{s.name}_reactor", palette.PLASMA)
    m["drone"] = vf.toon(f"{s.name}_drone", palette.DRONE_ACCENT)
    # Unterrumpf, vorn als Schräge unter die Deckskante gezogen
    s.add(loft([
        sec(-4.1, hull(1.6, 0.5), dz=-0.5),
        sec(-3.45, hull(2.3, 1.3)),
        sec(-2.4, hull(3.2, 1.3)),
        sec(-0.6, hull(3.8, 1.4)),
        sec(2.4, hull(3.8, 1.4)),
        sec(3.5, hull(3.1, 1.15)),
        sec(3.85, hull(2.5, 0.95)),
    ]), m["hull"], at=(0, 0, -0.2))
    # Flugdeck: stahlblaue Grundplatte als Rand, darauf die Deckfläche, dunkle Landebahn mit zwei Lichtbändern
    k = CROWN
    inner = sorted([p for p in grow(sym(DECK), -0.2) if p[0] > 1e-6], key=lambda p: p[1])
    ridge = 0.68 + DECK[2][0] * k
    s.add(crowned(DECK, ridge, 0.44, k), m["accent"])
    s.add(crowned(inner, ridge + 0.05, ridge - 0.2, k), m["hull"])
    deck = ridge + 0.05  # Deckfläche auf der Mittellinie; bei x liegt sie bei deck - k·|x|
    top = deck + 0.04
    s.add(crowned([(0.75, -3.0), (0.75, 3.4)], top, top - 0.12, k), m["dark"])
    s.add(box(0.07, 5.0, 0.03), m["glow"], at=(0.58, -0.5, top - k * 0.58 + 0.005), rot=(0, math.degrees(k), 0), mirror=True)
    # Geparkte Drohnen: zwei an Backbord, eine startbereit auf der Landebahn
    for x, y, z, yaw in ((-1.55, -0.65, deck - k * 1.55, 28), (-1.55, 0.65, deck - k * 1.55, 28), (0.0, -2.3, top, 0)):
        drone(s, m, (x, y, z), yaw)
    # Insel achtern an Steuerbord: drei Blöcke mit schräger Front, Fensterband, Mast mit Licht
    ix, iy, z = 1.6, 2.45, deck - k * 2.25
    for w, l, h, dy in ((1.3, 2.2, 0.55, 0.0), (1.0, 1.6, 0.5, 0.1), (0.72, 1.0, 0.42, 0.08)):
        s.add(wedge(w, l, h), m["hull"], at=(ix, iy + dy, z + h / 2))
        z += h
    s.add(box(0.6, 0.04, 0.1), m["window"], at=(ix, iy + dy - l / 2 + 0.14, z - 0.18))
    s.add(box(0.04, 0.55, 0.1), m["window"], at=(ix - w / 2, iy + dy, z - 0.18))
    s.add(post(10, 0.09, 0.06, z, z + 0.68), m["hull_round"], at=(ix, iy + 0.25, 0))
    s.add(sphere(0.08, 1), m["glow"], at=(ix, iy + 0.25, z + 0.72))
    # Hangardecks an den Flanken unter dem Deck
    hangar(s, m, -2.45, 2.95, [(-2.1, -0.1), (0.35, 2.6)])
    # Reaktorkern im Bug: dunkler Rahmen auf der Bugschräge, violetter Kern
    s.add(plate(ngon(8, 0.54, phase=0.3927), 0.16, "xz"), m["dark"], at=(0, -3.8, 0.02), rot=(-36, 0, 0), scale=(1.35, 1, 1))
    s.add(sphere(0.4, 2), m["reactor"], at=(0, -3.82, 0.04), rot=(-36, 0, 0), scale=(1.35, 0.6, 1))
    # Schürzen unter dem Hangardeck und Kiel
    s.add(plate([(0.7, -3.0), (1.75, -2.6), (2.25, -1.8), (2.25, 2.7), (1.8, 3.3), (0.7, 3.3)], 0.22, "xy"), m["armor"], at=(0, 0, -0.53), mirror=True)
    s.add(plate([(-3.7, 0.0), (3.0, 0.0), (3.15, -0.3), (0.5, -0.4), (-2.6, -0.45), (-3.3, -0.28)], 0.22, "yz"), m["dark"], at=(0, 0, -0.78))
    # Vier Heckdüsen
    engine(s, m, 0.36, 3.45, 4.45, dx=0.6, dz=-0.12, mirror=True)
    engine(s, m, 0.28, 3.4, 4.25, dx=1.4, dz=-0.12, mirror=True)
    return s.finish()
