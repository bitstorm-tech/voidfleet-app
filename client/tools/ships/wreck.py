"""Wrackteile der Schiffe: zerbricht ein gebautes Schiff in Voronoi-Zellen (wie das Cell-Fracture-Add-on,
aber ohne Abhängigkeit) und exportiert die Stücke als `<id>_wreck.glb` für die Zerstörungsanimation.

Jede Zelle ist das, was von allen Teilen des Schiffs übrig bleibt, nachdem die Mittelsenkrechten zu den
übrigen Zellkernen alles jenseits weggeschnitten haben; die Schnittflächen werden geschlossen und bekommen
das Wrack-Material `<id>_wreck` (Art "wreck" im Material-Vertrag, siehe vf.py): verkohlte Töne und ein Glutmuster
als Emissionstextur, das der Client zur Laufzeit abkühlen lässt. Nur die Schnittflächen haben UVs (Box-Projektion),
sie sind flach schattiert, die übrigen Flächen behalten Material und Normalen des Schiffs. Jedes Stück ist ein
eigenes Objekt mit dem Ursprung in seinem Schwerpunkt, damit es sich darum drehen kann; die Stücke liegen im selben
Modellraum wie das Schiff und ersetzen es an Ort und Stelle. Ansehen: `preview.py -- <id> --views wreck`.
"""

import os
import random
import tempfile

import bmesh
import bpy
import numpy as np
from mathutils import Vector

import palette
import vf

COLLECTION = "VF_Wrecks"
# Zahl der Bruchstücke je Schiff; die Saat liegt fest, damit jeder Build dieselben Stücke liefert.
CELLS = {
    "void_interceptor": 9,
    "scrap_raider": 10,
    "horizon_cruiser": 14,
    "plasma_frigate": 13,
    "iron_dreadnought": 20,
    "titan_carrier": 20,
    "repair_drone": 9,
    "signal_booster": 11,
    "bastion": 22,
    "vanguard": 18,
    "hive": 20,
    "mirage": 14,
    "pendulum": 22,
    "decoy": 12,
}
# Splitter mit weniger Flächen verschwinden; sie wären auf dem Brett ohnehin nur Pixel.
MIN_FACES = 16
HEAT_SIZE = 256
HEAT_TILE = 0.9  # Kantenlänge einer Kachel des Glutmusters in Blender-Einheiten


def _noise(size, cells, rng):
    """Zufallsgitter mit `cells` Zellen je Achse, glatt interpoliert und kachelbar."""
    grid = rng.random((cells, cells))
    t = np.linspace(0, cells, size, endpoint=False)
    i0 = np.floor(t).astype(int) % cells
    i1 = (i0 + 1) % cells
    f = t - np.floor(t)
    f = f * f * (3 - 2 * f)
    fv, fu = f[:, None], f[None, :]
    return (grid[np.ix_(i0, i0)] * (1 - fv) * (1 - fu) + grid[np.ix_(i1, i0)] * fv * (1 - fu)
            + grid[np.ix_(i0, i1)] * (1 - fv) * fu + grid[np.ix_(i1, i1)] * fv * fu)


def _fbm(size, rng, cells, octaves):
    total, amp, norm = np.zeros((size, size)), 1.0, 0.0
    for o in range(octaves):
        total += amp * _noise(size, cells << o, rng)
        norm += amp
        amp *= 0.5
    return total / norm


def heat_image():
    """Glutmuster der Bruchflächen: helle Adern in dunkler Schlacke wie erstarrende Lava, kachelbar, Graustufen.
    Der Client fährt die Emission hoch und lässt sie abkühlen; die Adern glühen am längsten."""
    image = bpy.data.images.get("vf_heat")
    if image is None:
        rng = np.random.default_rng(5)
        base = _fbm(HEAT_SIZE, rng, 4, 5)
        veins = np.clip(1 - np.abs(base - 0.5) * 16, 0, 1) ** 2
        glow = 0.05 + 0.95 * veins * (0.5 + 0.5 * _fbm(HEAT_SIZE, rng, 3, 3))
        rgba = np.stack([glow, glow, glow, np.ones_like(glow)], axis=2).astype(np.float32)
        # Eigenes Verzeichnis je Prozess, weil mehrere Builds gleichzeitig laufen können; der Dateiname wird zum
        # Bildnamen im GLB
        with tempfile.TemporaryDirectory() as folder:
            path = os.path.join(folder, "vf_heat.png")
            scratch = bpy.data.images.new("vf_heat_scratch", HEAT_SIZE, HEAT_SIZE, alpha=False)
            scratch.pixels.foreach_set(rgba.ravel())
            scratch.file_format = "PNG"
            scratch.filepath_raw = path
            scratch.save()
            bpy.data.images.remove(scratch)
            image = bpy.data.images.load(path)
            image.pack()
        image.name = "vf_heat"
        image.colorspace_settings.name = "Non-Color"
    return image


def wreck_material(ship):
    """Bruchflächen `<ship>_wreck`: verkohlte Töne, Emission = Glutmuster × Glutfarbe (Export als emissiveTexture
    mit emissiveFactor)."""
    mat = vf.surface(f"{ship}_wreck", {"kind": "wreck", "tones": list(palette.WRECK), "heat": palette.HEAT}, palette.WRECK[0],
                     emission=palette.HEAT)
    nodes, links = mat.node_tree.nodes, mat.node_tree.links
    bsdf = next(n for n in nodes if n.type == "BSDF_PRINCIPLED")
    heat = nodes.new("ShaderNodeTexImage")
    heat.image = heat_image()
    mix = nodes.new("ShaderNodeMix")
    mix.data_type, mix.blend_type = "RGBA", "MULTIPLY"
    mix.inputs[0].default_value = 1.0
    links.new(heat.outputs["Color"], vf._socket(mix.inputs, "A_Color"))
    vf._socket(mix.inputs, "B_Color").default_value = (*palette.linear(palette.HEAT), 1.0)
    links.new(vf._socket(mix.outputs, "Result_Color"), bsdf.inputs["Emission Color"])
    return mat


def seeds(mesh, count, rng):
    """Zellkerne: Eckpunkte des Schiffs mit Mindestabstand, damit sich die Stücke über das ganze Schiff verteilen
    und Baugruppen wie Gondeln, Türme oder Flügel eigene Stücke werden."""
    verts = [v.co.copy() for v in mesh.vertices]
    lo = Vector([min(v[i] for v in verts) for i in range(3)])
    hi = Vector([max(v[i] for v in verts) for i in range(3)])
    size = hi - lo
    volume = max(size.x, 0.3) * max(size.y, 0.3) * max(size.z, 0.3)
    min_dist = 0.9 * (volume / count) ** (1 / 3)
    rng.shuffle(verts)
    chosen = []
    while len(chosen) < count and min_dist > 0.05:
        for v in verts:
            if len(chosen) >= count:
                break
            if all((v - c).length >= min_dist for c in chosen):
                chosen.append(v)
        min_dist *= 0.8
    # Leicht ins Innere ziehen, damit kein Kern genau auf einer Fläche liegt.
    center = (lo + hi) / 2
    return [c + (center - c) * 0.08 for c in chosen]


def cut(base, point, others, wreck_index, min_faces=MIN_FACES):
    """Die Voronoi-Zelle von `point`: alles jenseits der Mittelsenkrechten zu `others` wird abgeschnitten,
    die Schnittflächen geschlossen (ohne `wreck_index` bleiben sie offen). Liefert None, wenn nichts übrig bleibt."""
    bm = base.copy()
    for other in sorted(others, key=lambda o: (o - point).length):
        normal = other - point
        co = point + normal / 2
        normal.normalize()
        sides = [(v.co - co).dot(normal) for v in bm.verts]
        if max(sides) <= 1e-5:
            continue
        if min(sides) >= -1e-5:
            bm.free()
            return None
        geom = bm.verts[:] + bm.edges[:] + bm.faces[:]
        result = bmesh.ops.bisect_plane(bm, geom=geom, dist=1e-5, plane_co=co, plane_no=normal, clear_outer=True)
        edges = [e for e in result["geom_cut"] if isinstance(e, bmesh.types.BMEdge)]
        if edges and wreck_index is not None:
            for face in bmesh.ops.holes_fill(bm, edges=edges, sides=0)["faces"]:
                face.material_index = wreck_index
    if len(bm.faces) < min_faces:
        bm.free()
        return None
    return bm


def finish_cuts(bm, wreck_index):
    """Schnittflächen flach und mit Box-UVs (Kachel HEAT_TILE) fürs Glutmuster; danach harte Kanten neu nach Winkel."""
    bm.normal_update()
    uv_layer = bm.loops.layers.uv.verify()
    for face in bm.faces:
        if face.material_index != wreck_index:
            continue
        face.smooth = False
        n = face.normal
        ax, ay, az = abs(n.x), abs(n.y), abs(n.z)
        for loop in face.loops:
            co = loop.vert.co
            u, v = (co.y, co.z) if ax >= ay and ax >= az else (co.x, co.z) if ay >= az else (co.x, co.y)
            loop[uv_layer].uv = (u / HEAT_TILE, v / HEAT_TILE)
    vf.mark_sharp(bm)


def centroid(bm):
    """Flächengewichteter Schwerpunkt der Oberfläche."""
    total, weight = Vector(), 0.0
    for face in bm.faces:
        area = face.calc_area()
        total += face.calc_center_median() * area
        weight += area
    return total / weight if weight else Vector()


def wrecks_collection():
    scene = bpy.context.scene
    collection = bpy.data.collections.get(COLLECTION)
    if collection is None:
        collection = bpy.data.collections.new(COLLECTION)
    if collection.name not in scene.collection.children:
        scene.collection.children.link(collection)
    return collection


def pieces_of(ship_id):
    return [o for o in bpy.data.objects if o.name.startswith(f"{ship_id}_wreck_")]


def build(obj, cells=None, seed=None):
    """Zerbricht das Schiffsobjekt `obj` in Stücke; ersetzt vorhandene Stücke desselben Schiffs."""
    ship_id = obj.name
    rng = random.Random(seed or f"{ship_id}-wreck")
    for old in pieces_of(ship_id):
        mesh = old.data
        bpy.data.objects.remove(old)
        bpy.data.meshes.remove(mesh)
    materials = list(obj.data.materials)
    # Hologramme (das Trugbild) zerfallen in Licht-Splitter: Die Schnitte bleiben offen (keine Schnittflächen, kein
    # Wrack-Material), die Stücke bleiben dünne, flache Scherben, und auch kleine Splitter bleiben erhalten.
    hologram = all(vf.spec(m)["kind"] == "hologram" for m in materials)
    wreck_index = None
    if not hologram:
        materials.append(wreck_material(ship_id))
        wreck_index = len(materials) - 1

    base = bmesh.new()
    base.from_mesh(obj.data)
    points = seeds(obj.data, cells or CELLS.get(ship_id, 12), rng)
    collection = wrecks_collection()
    pieces = []
    for k, point in enumerate(points):
        bm = cut(base, point, [p for p in points if p is not point], wreck_index, 4 if hologram else MIN_FACES)
        if bm is None:
            continue
        if not hologram:
            finish_cuts(bm, wreck_index)
        origin = centroid(bm)
        for v in bm.verts:
            v.co -= origin
        mesh = bpy.data.meshes.new(f"{ship_id}_wreck_{k:02d}")
        bm.to_mesh(mesh)
        bm.free()
        for mat in materials:
            mesh.materials.append(mat)
        piece = bpy.data.objects.new(mesh.name, mesh)
        piece.location = origin
        collection.objects.link(piece)
        pieces.append(piece)
    base.free()
    return pieces


def stats(pieces):
    tris = sum(sum(len(p.vertices) - 2 for p in piece.data.polygons) for piece in pieces)
    return {"pieces": len(pieces), "tris": tris}
