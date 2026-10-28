"""Void Interceptor (Jäger) im Clean-Toon-Stil.

Runder Rumpf, der vorn in eine lange Nadelnase ausläuft, darauf eine Glaskanzel. Klingenflügel mit breitem
Vorderkantenstreifen in Koralle, darunter zwei runde Triebwerksgondeln mit Lichtband, V-Leitwerk mit Koralle-Spitzen,
zwei Bugkanonen unter den Flügelwurzeln, dunkle Kielflosse.
"""

import palette
import vf
from parts import engine
from vf import Ship, box, loft, plate, sec, smooth, superellipse, tip, tube


def edge_band(a, b, width, x0, x1, out=0.015):
    """Streifen (x, y) entlang der Vorderkante a→b eines Flügels, dessen Inneres bei größerem y liegt: senkrecht
    `width` breit, um `out` über die Kante hinaus, an den Enden bei x0 und x1 gerade abgeschnitten."""
    (ax, ay), (bx, by) = a, b
    slope = (by - ay) / (bx - ax)
    cos = (bx - ax) / ((bx - ax) ** 2 + (by - ay) ** 2) ** 0.5

    def edge(x):
        return ay + (x - ax) * slope

    lo, hi = -out / cos, width / cos
    return [(x0, edge(x0) + lo), (x1, edge(x1) + lo), (x1, edge(x1) + hi), (x0, edge(x0) + hi)]


def build():
    s = Ship("void_interceptor")
    m = vf.materials(s.name, "fighter")
    # Vorderkantenstreifen: flache Platte, aber rundes Material ohne Glanzpunkt. Die Kanten bleiben hart (alle über 38°),
    # es greift nur das schmale Kantenlicht runder Teile; das breite der eckigen mischt waagrechte Flächen in der
    # Brettansicht zu 65 % in RIM_COLOR und macht Koralle fliederfarben, ein Glanzpunkt ließe die ganze Facette aufblitzen
    m["accent_plate"] = vf.toon(f"{s.name}_accent_plate", palette.CLASSES["fighter"]["accent"], round=True)
    N = 20
    # Runder Rumpf, vorn eine lange Nadelnase
    s.add(loft(smooth([
        tip(-3.8, dz=-0.02),
        sec(-3.2, superellipse(0.15, 0.13, N), dz=-0.02),
        sec(-2.5, superellipse(0.34, 0.28, N), dz=-0.01),
        sec(-1.6, superellipse(0.7, 0.52, N)),
        sec(-0.6, superellipse(0.96, 0.66, N)),
        sec(0.6, superellipse(0.98, 0.68, N)),
        sec(1.6, superellipse(0.82, 0.58, N)),
        sec(2.3, superellipse(0.62, 0.46, N)),
        sec(2.5, superellipse(0.5, 0.38, N)),
    ], 2)), m["hull_round"])
    # Glaskanzel, unten überall im Rumpf
    s.add(loft(smooth([
        sec(-2.2, superellipse(0.12, 0.06, 16), dz=0.17),
        sec(-1.7, superellipse(0.42, 0.3, 16), dz=0.27),
        sec(-1.0, superellipse(0.5, 0.36, 16), dz=0.3),
        sec(-0.35, superellipse(0.32, 0.16, 16), dz=0.32),
    ], 2)), m["glass"])
    # Klingenflügel mit Vorderkantenstreifen, leicht nach oben angestellt
    root, le_tip = (0.3, -1.25), (1.95, 0.75)
    wing = [root, le_tip, (1.95, 1.45), (0.3, 1.75)]
    s.add(plate(wing, 0.1, "xy"), m["hull"], at=(0, 0, -0.02), rot=(0, -3, 0), mirror=True)
    s.add(plate(edge_band(root, le_tip, 0.27, 0.25, 1.965), 0.12, "xy"), m["accent_plate"], at=(0, 0, -0.02), rot=(0, -3, 0), mirror=True)
    # Triebwerksgondeln unter den Flügeln, Lichtband an der Außenflanke
    gx, gz = 1.03, -0.27
    s.add(loft(smooth([tip(-1.0), sec(-0.55, superellipse(0.5, 0.48, 16)), sec(0.4, superellipse(0.62, 0.6, 16)),
                       sec(1.9, superellipse(0.58, 0.56, 16))], 2)), m["hull_round"], at=(gx, 0, gz), mirror=True)
    engine(s, m, 0.28, 1.85, 2.6, dx=gx, dz=gz, mirror=True)
    s.add(box(0.05, 1.0, 0.09), m["glow"], at=(gx + 0.3, 0.5, gz), mirror=True)
    # V-Leitwerk, nach außen geneigt, mit Koralle-Spitzen
    fin = [(0.95, -0.12), (2.2, -0.12), (2.5, 0.9), (2.12, 0.94)]
    s.add(plate(fin, 0.08, "yz"), m["hull"], at=(0.22, 0, 0.14), rot=(0, 30, 0), mirror=True)
    s.add(plate([(1.72, 0.6), (2.43, 0.6), (2.53, 0.92), (2.1, 0.97)], 0.1, "yz"), m["accent"], at=(0.22, 0, 0.14), rot=(0, 30, 0), mirror=True)
    # Dunkle Kielflosse
    s.add(plate([(-0.3, 0.06), (1.9, 0.06), (1.75, -0.3), (0.35, -0.34)], 0.1, "yz"), m["dark"], at=(0, 0, -0.26))
    # Bugkanonen unter den Flügelwurzeln: Gehäuse, Lauf, Mündung mit Glut
    cx, cz = 0.42, -0.2
    s.add(tube(16, 0.15, 0.15, -0.3, -1.6), m["dark_round"], at=(cx, 0, cz), mirror=True)
    s.add(tube(16, 0.095, 0.09, -1.6, -2.85), m["steel"], at=(cx, 0, cz), mirror=True)
    s.add(tube(16, 0.13, 0.13, -2.85, -3.02), m["dark_round"], at=(cx, 0, cz), mirror=True)
    s.add(tube(12, 0.08, 0.08, -3.02, -3.06), m["glow"], at=(cx, 0, cz), mirror=True)
    return s.finish()
