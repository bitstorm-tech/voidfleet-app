"""Equirektangulare HDR-Umgebung der Match-Szene (client/assets/env/space.hdr), prozedural mit numpy.

Dunkler Weltraum mit violett-blauem Nebel, Sternen, einer warmen Hauptlichtquelle oben vorn und
kühlem Gegenlicht. Babylon filtert sie beim Laden vor; sie liefert die Reflexionen und das
indirekte Licht der PBR-Schiffsmaterialien. Aufruf (Blender nur als RGBE-Schreiber):
/Applications/Blender.app/Contents/MacOS/Blender -b -P client/tools/ships/env.py [-- pfad.hdr]
"""

import os
import sys

import bpy
import numpy as np

W, H = 512, 256
DEFAULT = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "assets", "env", "space.hdr"))


def periodic_noise(rng, cells, octaves=5, gain=0.5):
    total, amp, norm = np.zeros((H, W)), 1.0, 0.0
    for o in range(octaves):
        cv, cu = cells << o, (cells * 2) << o
        grid = rng.random((cv, cu))
        tv, tu = np.linspace(0, cv, H, endpoint=False), np.linspace(0, cu, W, endpoint=False)
        v0, u0 = np.floor(tv).astype(int) % cv, np.floor(tu).astype(int) % cu
        fv, fu = tv - np.floor(tv), tu - np.floor(tu)
        fv, fu = (fv * fv * (3 - 2 * fv))[:, None], (fu * fu * (3 - 2 * fu))[None, :]
        v1, u1 = (v0 + 1) % cv, (u0 + 1) % cu
        total += amp * (grid[np.ix_(v0, u0)] * (1 - fv) * (1 - fu) + grid[np.ix_(v1, u0)] * fv * (1 - fu)
                        + grid[np.ix_(v0, u1)] * (1 - fv) * fu + grid[np.ix_(v1, u1)] * fv * fu)
        norm += amp
        amp *= gain
    return total / norm


def build():
    rng = np.random.default_rng(5)
    lat = np.linspace(np.pi / 2, -np.pi / 2, H)[:, None] * np.ones((1, W))  # oberste Zeile = Zenit
    lon = np.linspace(-np.pi, np.pi, W, endpoint=False)[None, :] * np.ones((H, 1))
    up = (np.sin(lat) + 1) / 2
    base = np.stack([0.012 + 0.02 * up, 0.016 + 0.03 * up, 0.035 + 0.06 * up], axis=2)
    n1 = np.clip((periodic_noise(rng, 2, 6) - 0.45) * 2.0, 0, 1) ** 1.5
    n2 = np.clip((periodic_noise(rng, 3, 5) - 0.5) * 2.5, 0, 1) ** 1.5
    nebula = n1[..., None] * np.array([0.35, 0.1, 0.6]) * 0.5 + n2[..., None] * np.array([0.08, 0.2, 0.55]) * 0.5
    stars = np.zeros((H, W))
    for _ in range(900):
        stars[rng.integers(0, H), rng.integers(0, W)] = rng.uniform(1.5, 6.0)

    def blob(lat0, lon0, size, strength):
        d = np.arccos(np.clip(np.sin(lat) * np.sin(lat0) + np.cos(lat) * np.cos(lat0) * np.cos(lon - lon0), -1, 1))
        return strength * np.exp(-((d / size) ** 2))

    key = blob(np.radians(55), np.radians(-40), 0.35, 14.0)[..., None] * np.array([1.0, 0.93, 0.8])
    rim = blob(np.radians(20), np.radians(150), 0.5, 3.0)[..., None] * np.array([0.5, 0.65, 1.0])
    glow = blob(np.radians(-25), np.radians(120), 1.0, 0.6)[..., None] * np.array([0.7, 0.4, 1.0])
    return base + nebula + stars[..., None] * np.array([0.9, 0.95, 1.0]) + key + rim + glow


def save(path=DEFAULT):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    rgba = np.concatenate([build(), np.ones((H, W, 1))], axis=2).astype(np.float32)
    image = bpy.data.images.new("space_env", W, H, alpha=False, float_buffer=True)
    image.pixels.foreach_set(rgba[::-1].ravel())  # Blender-Pixel laufen von unten nach oben
    image.file_format = "HDR"
    image.filepath_raw = path
    image.save()
    bpy.data.images.remove(image)
    return path


if __name__ == "__main__":
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    print("saved", save(argv[0] if argv else DEFAULT))
