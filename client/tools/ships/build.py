"""Baut alle Schiffe und exportiert sie nach client/assets/models/ships/<id>.glb.

Headless:   /Applications/Blender.app/Contents/MacOS/Blender -b -P client/tools/ships/build.py -- [ids...]
Interaktiv: in Blender (z. B. über den Blender-MCP) `import build; build.build_all()`.
Ohne Ids werden alle Schiffe aus fleet.SHIPS gebaut.
"""

import importlib
import os
import sys

ROOT = os.path.dirname(os.path.abspath(__file__))
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)

import fleet  # noqa: E402
import vf  # noqa: E402

OUT_DIR = os.path.normpath(os.path.join(ROOT, "..", "..", "assets", "models", "ships"))


def build_all(ids=None):
    importlib.reload(vf)
    importlib.reload(fleet)
    os.makedirs(OUT_DIR, exist_ok=True)
    report = {}
    for ship_id in ids or fleet.SHIPS:
        obj = fleet.build(ship_id)
        vf.export_glb(obj, os.path.join(OUT_DIR, f"{ship_id}.glb"))
        report[ship_id] = vf.stats(obj)
    return report


if __name__ == "__main__":
    requested = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    for ship_id, info in build_all(requested or None).items():
        print(f"{ship_id}: {info['tris']} Dreiecke, Maße {info['size']}")
