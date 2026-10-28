"""Drohne (Token des Titan Carriers und der Hive), Neubau im Clean-Toon-Stil.

Kleiner Facettenkeil mit violettem Rückenkamm, vorn darauf das große violette Sensorauge in dunklem Rahmen statt
einer Kanzel. Gepfeilte Flügel mit violetter Vorderkante, zwei Düsengondeln mit violetter Brennkammer, darunter eine
dunkle Kielflosse. Farben des Trägers: Rumpf im gemeinsamen Blaugrau, Akzent im Violett der Drohne (palette.DRONE_ACCENT),
Lichter in Plasma-Violett. Deutlich kleiner als die Jäger, die Mini-Drohnen der Hive ähneln ihr. Etwa 1,3k Dreiecke
(das alte Modell hatte 4,8k).
"""

import palette
import vf
from parts import engine
from vf import Ship, facet, loft, octagon, plate, sec, smooth, tip


def build():
    s = Ship("drone")
    m = vf.materials(s.name, "fighter")
    m["accent"] = vf.toon(f"{s.name}_accent", palette.DRONE_ACCENT)
    m["core"] = vf.light(f"{s.name}_core", palette.PLASMA)
    m["eye"] = vf.light(f"{s.name}_eye", palette.PLASMA)
    # Facettenkeil, vorn flach und spitz
    s.add(loft([
        tip(-2.05, dz=-0.02),
        sec(-1.5, facet(0.44, 0.18)),
        sec(-0.8, facet(0.78, 0.34)),
        sec(0.1, facet(0.94, 0.44)),
        sec(0.95, facet(0.86, 0.42)),
        sec(1.35, facet(0.66, 0.34)),
    ]), m["hull"])
    # Violetter Rückenkamm, vorn darauf das Sensorauge in dunklem Rahmen
    s.add(loft([sec(-1.15, facet(0.2, 0.08), dz=-0.07), sec(-0.6, facet(0.46, 0.22)), sec(0.7, facet(0.48, 0.24)),
                sec(1.25, facet(0.3, 0.14), dz=-0.05)]), m["accent"], at=(0, 0, 0.2))
    s.add(loft([sec(-1.05, octagon(0.22, 0.08)), sec(-0.86, octagon(0.42, 0.2)), sec(-0.3, octagon(0.42, 0.2)), sec(-0.16, octagon(0.28, 0.1))]),
          m["dark"], at=(0, 0, 0.3))
    s.add(loft(smooth([sec(-1.0, octagon(0.16, 0.08)), sec(-0.84, octagon(0.34, 0.2)), sec(-0.36, octagon(0.34, 0.2)), sec(-0.24, octagon(0.22, 0.1))], 1)),
          m["eye"], at=(0, 0, 0.35))
    # Gepfeilte Flügel mit violetter Vorderkante
    s.add(plate([(0.3, -0.5), (1.8, 0.5), (1.8, 0.84), (0.3, 1.0)], 0.08, "xy"), m["hull"], at=(0, 0, 0.0), rot=(0, -3, 0), mirror=True)
    s.add(plate([(0.3, -0.52), (1.82, 0.5), (1.82, 0.71), (0.3, -0.24)], 0.1, "xy"), m["accent"], at=(0, 0, 0.0), rot=(0, -3, 0), mirror=True)
    # Zwei Düsengondeln mit violetter Brennkammer
    s.add(loft([sec(-0.45, octagon(0.2, 0.16)), sec(-0.05, octagon(0.4, 0.34)), sec(1.2, octagon(0.42, 0.36))]), m["hull"], at=(0.32, 0, -0.07), mirror=True)
    engine(s, m, 0.17, 1.05, 1.8, dx=0.32, dz=-0.07, mirror=True)
    # Kielflosse
    s.add(plate([(-0.25, 0.0), (1.25, 0.0), (1.2, -0.36), (0.4, -0.4)], 0.1, "yz"), m["dark"], at=(0, 0, -0.09))
    return s.finish()
