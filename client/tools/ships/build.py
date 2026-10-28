"""Baut die Schiffe und exportiert sie nach client/assets/models/ships/<id>.glb, dazu ihre Wrackteile (wreck.py) nach
<id>_wreck.glb.

Headless:   <blender> -b --factory-startup -P client/tools/ships/build.py -- [ids...]
            <blender> ist auf dem Mac /Applications/Blender.app/Contents/MacOS/Blender, auf dem Linux-Server ohne GPU
            ~/.local/opt/blender-5.2.3-linux-x64/run.sh (portables Blender mit Mesa llvmpipe).
Interaktiv: in Blender `import build; build.build_all()` (lädt die Module vorher neu).
Ohne Ids werden alle Schiffe aus fleet.SHIPS gebaut. Meldet je Schiff Dreiecke, Maße und GLB-Größe samt Wrack und warnt
bei Teilen unter dem Slot (vf.slot), bei schwebenden Teilen (vf.loose_parts) und bei Hüllen, die offen oder falsch herum
orientiert sind (vf.bad_shells, an Schiff und Wrackstücken; die Materialien sind einseitig).
"""

import importlib
import os
import sys

ROOT = os.path.dirname(os.path.abspath(__file__))
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)

import fleet  # noqa: E402
import vf  # noqa: E402
import wreck  # noqa: E402

OUT_DIR = os.path.normpath(os.path.join(ROOT, "..", "..", "assets", "models", "ships"))


def reload_modules():
    """Lädt die Schiffsmodule in Abhängigkeitsreihenfolge neu (für eine laufende Blender-Instanz)."""
    names = ["palette", "vf", "parts", "look", "wreck"] + sorted(n for n in sys.modules if n.startswith("fleet.")) + ["fleet"]
    for name in names:
        if name in sys.modules:
            importlib.reload(sys.modules[name])


def build_all(ids=None):
    reload_modules()
    os.makedirs(OUT_DIR, exist_ok=True)
    report = {}
    for ship_id in ids or fleet.SHIPS:
        obj = fleet.build(ship_id)
        path = os.path.join(OUT_DIR, f"{ship_id}.glb")
        vf.export_glb([obj], path)
        pieces = wreck.build(obj)
        wreck_path = os.path.join(OUT_DIR, f"{ship_id}_wreck.glb")
        vf.export_glb(pieces, wreck_path)
        shells = vf.bad_shells(obj) + [shell for piece in pieces for shell in vf.bad_shells(piece)]
        report[ship_id] = {**vf.stats(obj), "kb": os.path.getsize(path) / 1024, "loose": vf.loose_parts(obj), "shells": shells,
                           "wreck": {**wreck.stats(pieces), "kb": os.path.getsize(wreck_path) / 1024}}
    return report


if __name__ == "__main__":
    requested = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    for ship_id, info in build_all(requested or None).items():
        w = info["wreck"]
        print(f"{ship_id}: {info['tris']} Dreiecke, {info['kb']:.0f} KB, Maße {info['size']}, z {info['z']}; "
              f"Wrack {w['pieces']} Stücke, {w['tris']} Dreiecke, {w['kb']:.0f} KB")
        for center, tris in info["loose"]:
            print(f"  WARNUNG {ship_id}: schwebendes Teil bei ({center.x:.2f}, {center.y:.2f}, {center.z:.2f}), {tris} Dreiecke")
        for center, tris, problem in info["shells"]:
            print(f"  WARNUNG {ship_id}: Hülle {problem} bei ({center.x:.2f}, {center.y:.2f}, {center.z:.2f}), {tris} Dreiecke")
