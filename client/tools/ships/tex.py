"""Kachelbare Rumpfplatten-Texturen für die Schiffe, prozedural mit numpy erzeugt (kein Baking).

Je Stil entstehen drei Bilder: Basisfarbe (neutrales Grau, im Material mit der Rumpffarbe
multipliziert), ORM (G = Rauheit, B = Metall) und eine Normalmap aus der Höhenkarte.
Das Muster: Zellen werden in Spalten und Zeilen unterteilt (Platten), dazwischen Fugen; manche
Platten bekommen eine innere Luke oder Nietenreihen, darüber Kratzer, Schmutzschlieren und
bei `rust` Rostflecken. Alle Operationen sind periodisch, die Texturen kacheln nahtlos.
"""

import os

import numpy as np

SIZE = 512

STYLES = {
    # Militärischer Rumpf: mittelgroße Platten, wenig Schmutz.
    "plating": dict(seed=7, coarse=5, splits=3, grime=0.3, scratches=40, rust=0.0, rivets=0.45, hatches=0.25),
    # Schrott: kleine schiefe Platten, viel Schmutz, Rost und Kratzer.
    "scrap": dict(seed=11, coarse=5, splits=4, grime=0.6, scratches=180, rust=0.7, rivets=0.9, hatches=0.4),
    # Zivile, helle Rümpfe: große ruhige Platten.
    "clean": dict(seed=3, coarse=4, splits=2, grime=0.15, scratches=12, rust=0.0, rivets=0.3, hatches=0.2),
}


def periodic_noise(size, cells, rng):
    """Zufallsgitter mit `cells` Zellen je Achse, glatt interpoliert und kachelbar."""
    cv, cu = cells if isinstance(cells, tuple) else (cells, cells)
    grid = rng.random((cv, cu))

    def axis(c):
        t = np.linspace(0, c, size, endpoint=False)
        i0 = np.floor(t).astype(int) % c
        f = t - np.floor(t)
        return i0, (i0 + 1) % c, f * f * (3 - 2 * f)

    v0, v1, fv = axis(cv)
    u0, u1, fu = axis(cu)
    fv, fu = fv[:, None], fu[None, :]
    return (grid[np.ix_(v0, u0)] * (1 - fv) * (1 - fu) + grid[np.ix_(v1, u0)] * fv * (1 - fu)
            + grid[np.ix_(v0, u1)] * (1 - fv) * fu + grid[np.ix_(v1, u1)] * fv * fu)


def fbm(size, rng, cells=4, octaves=5, gain=0.5):
    total, amp, norm = np.zeros((size, size)), 1.0, 0.0
    cv, cu = cells if isinstance(cells, tuple) else (cells, cells)
    for o in range(octaves):
        total += amp * periodic_noise(size, (cv << o, cu << o), rng)
        norm += amp
        amp *= gain
    return total / norm


def rect_mask(size, u0, v0, u1, v1):
    """Rechteck in Pixelkoordinaten, periodisch über den Rand hinaus."""
    m = np.zeros((size, size), bool)
    us = np.arange(u0, u1) % size
    vs = np.arange(v0, v1) % size
    m[np.ix_(vs, us)] = True
    return m


def draw_line(canvas, rng, length, value):
    u, v = rng.random(2) * canvas.shape[0]
    a = rng.random() * 2 * np.pi
    for t in np.arange(0, length, 0.7):
        canvas[int(v + t * np.sin(a)) % canvas.shape[0], int(u + t * np.cos(a)) % canvas.shape[1]] = value


def build(style, size=SIZE):
    """Liefert (color RGB, orm RGB, normal RGB) als float-Arrays der Form (size, size, 3), Zeile = v."""
    p = STYLES[style]
    rng = np.random.default_rng(p["seed"])
    cell = size // p["coarse"]
    min_w = max(10, cell // 7)

    panel_value = np.zeros((size, size))  # Helligkeitsabweichung je Platte
    height = np.zeros((size, size))
    seams = np.zeros((size, size), bool)
    rivets = np.zeros((size, size), bool)

    def split(a, b, parts):
        cuts = [a]
        for _ in range(parts - 1):
            lo, hi = cuts[-1] + min_w, b - min_w * (parts - len(cuts))
            if hi <= lo:
                break
            cuts.append(int(rng.integers(lo, hi + 1)))
        return cuts + [b]

    for ci in range(p["coarse"]):
        for cj in range(p["coarse"]):
            u_a, v_a = ci * cell, cj * cell
            cols = split(u_a, u_a + cell, int(rng.integers(1, p["splits"] + 1)))
            for u0, u1 in zip(cols, cols[1:]):
                rows = split(v_a, v_a + cell, int(rng.integers(1, p["splits"] + 1)))
                for v0, v1 in zip(rows, rows[1:]):
                    panel = rect_mask(size, u0, v0, u1, v1)
                    panel_value[panel] = rng.normal(0, 0.06)
                    height[panel] = rng.random() * 0.35
                    seams |= rect_mask(size, u0, v0, u1, v0 + 1) | rect_mask(size, u0, v0, u0 + 1, v1)
                    w, h = u1 - u0, v1 - v0
                    if w > 28 and h > 28 and rng.random() < p["hatches"]:
                        m = int(rng.integers(5, 9))
                        inner = rect_mask(size, u0 + m, v0 + m, u1 - m, v1 - m)
                        edge = inner & ~rect_mask(size, u0 + m + 1, v0 + m + 1, u1 - m - 1, v1 - m - 1)
                        seams |= edge
                        height[inner] += 0.12 * rng.choice([-1, 1])
                    if w > 20 and h > 20 and rng.random() < p["rivets"]:
                        step = 8
                        for u in range(u0 + 5, u1 - 4, step):
                            rivets[(v0 + 4) % size, u % size] = rivets[(v1 - 5) % size, u % size] = True
                        for v in range(v0 + 5, v1 - 4, step):
                            rivets[v % size, (u0 + 4) % size] = rivets[v % size, (u1 - 5) % size] = True

    # Fugen: weich auslaufend über zwei Pixel, Nieten als kleine Kuppeln
    groove = seams.astype(float)
    for d in (1, 2):
        ring = np.zeros_like(seams)
        for axis in (0, 1):
            ring |= np.roll(seams, d, axis) | np.roll(seams, -d, axis)
        groove = np.maximum(groove, ring * (1 - d * 0.4))
    dome = rivets.astype(float)
    for axis in (0, 1):
        dome = np.maximum(dome, 0.6 * (np.roll(rivets, 1, axis) | np.roll(rivets, -1, axis)))

    scratches = np.zeros((size, size))
    for _ in range(p["scratches"]):
        draw_line(scratches, rng, rng.integers(8, 60), 1.0)

    grime = np.clip((fbm(size, rng, cells=(3, 2), octaves=5) - 0.42) * 2.2, 0, 1) * p["grime"]
    streaks = np.clip((fbm(size, rng, cells=(2, 12), octaves=3) - 0.5) * 2.5, 0, 1) * p["grime"] * 0.6
    rust = np.clip((fbm(size, rng, cells=4, octaves=6, gain=0.6) - 0.5) * 3.5, 0, 1) * p["rust"]
    fine = fbm(size, rng, cells=32, octaves=3) - 0.5

    height += dome * 0.5 - groove * 0.9 - scratches * 0.15 + fine * 0.06 + rust * 0.15

    base = 0.86 + panel_value - groove * 0.42 + scratches * 0.1 + fine * 0.05
    base *= 1 - 0.35 * grime - 0.25 * streaks
    color = np.repeat(np.clip(base, 0.05, 1.0)[..., None], 3, axis=2)
    color[..., 2] *= 1 - 0.08 * grime
    if p["rust"]:
        rust_color = np.array([0.52, 0.25, 0.1])
        color = color * (1 - rust[..., None]) + rust_color * rust[..., None] * (0.7 + 0.3 * fine[..., None] * 4)

    rough = 0.5 + 0.3 * grime + 0.35 * streaks + 0.25 * groove - 0.15 * scratches + 0.3 * rust + fine * 0.15
    orm = np.stack([np.ones((size, size)), np.clip(rough, 0.15, 1.0), np.clip(1 - rust * 0.6, 0, 1)], axis=2)

    du = (np.roll(height, -1, axis=1) - np.roll(height, 1, axis=1)) * 0.5
    dv = (np.roll(height, -1, axis=0) - np.roll(height, 1, axis=0)) * 0.5
    n = np.stack([-du * 2.2, -dv * 2.2, np.ones((size, size))], axis=2)
    n /= np.linalg.norm(n, axis=2, keepdims=True)
    normal = n * 0.5 + 0.5
    return color, orm, normal


def save(style, directory, size=SIZE):
    """Schreibt die drei Bilder über bpy nach `directory` und liefert die Pfade (color, orm, normal)."""
    import bpy

    os.makedirs(directory, exist_ok=True)
    paths = {}
    for kind, data, fmt in zip(("color", "orm", "normal"), build(style, size), ("JPEG", "JPEG", "PNG")):
        name = f"vf_{style}_{kind}"
        image = bpy.data.images.get(name)
        if image:
            bpy.data.images.remove(image)
        image = bpy.data.images.new(name, size, size, alpha=False)
        rgba = np.concatenate([data, np.ones((size, size, 1))], axis=2).astype(np.float32)
        image.pixels.foreach_set(rgba.ravel())
        path = os.path.join(directory, f"{name}.{'jpg' if fmt == 'JPEG' else 'png'}")
        image.file_format = fmt
        image.filepath_raw = path
        image.save(quality=90)
        bpy.data.images.remove(image)
        paths[kind] = path
    return paths


if __name__ == "__main__":
    import sys

    out = sys.argv[sys.argv.index("--") + 1]
    for style in STYLES:
        print(save(style, out))
