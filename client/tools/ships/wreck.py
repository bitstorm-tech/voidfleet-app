"""Wrackteile der Schiffe: zerbricht ein gebautes Schiff in Voronoi-Zellen (wie das Cell-Fracture-Add-on,
aber ohne Abhängigkeit) und exportiert die Stücke als `<id>_wreck.glb` für die Zerstörungsanimation.

Jede Zelle ist das, was von allen Teilen des Schiffs übrig bleibt, nachdem die Mittelsenkrechten zu den
übrigen Zellkernen alles jenseits weggeschnitten haben; die Schnittflächen werden geschlossen und bekommen
das Wrack-Material (verkohlt, mit glühendem Plattenmuster, das der Client zur Laufzeit abkühlen lässt).
Jedes Stück ist ein eigenes Objekt mit dem Ursprung in seinem Schwerpunkt, damit es sich darum drehen
kann; die Stücke liegen im selben Modellraum wie das Schiff und ersetzen es an Ort und Stelle.
"""

import math
import os
import random

import bmesh
import bpy
import numpy as np
from mathutils import Vector

import tex
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
# Hologramme (das Trugbild) zerfallen in Licht-Splitter: Die Schnitte bleiben offen (keine Schnittflächen, kein
# verkohltes Wrack-Material), die Stücke bleiben dünne, flach schattierte Scherben aus dem Material des Hologramms,
# und auch kleine Splitter bleiben erhalten.
HOLOGRAMS = {"decoy"}
# Winkel, ab dem Kanten hart schattiert werden (das Wrack hat keinen Bevel-Modifier).
SHARP_ANGLE = math.radians(32)
# Splitter mit weniger Flächen verschwinden; sie wären auf dem Brett ohnehin nur Pixel.
MIN_FACES = 16
CHAR = (0.05, 0.045, 0.04)
HEAT = (1.0, 0.32, 0.06)
HEAT_SIZE = 256


def heat_image():
    """Glutmuster der Bruchflächen: helle Adern in dunkler Schlacke wie erstarrende Lava, kachelbar
    (numpy wie tex.py). Der Client fährt die Emission hoch und lässt sie abkühlen; die Adern glühen am längsten."""
    path = os.path.join(vf._texture_dir(), "vf_heat.png")
    name = os.path.basename(path)
    image = bpy.data.images.get(name)
    if image is None:
        if not os.path.exists(path):
            rng = np.random.default_rng(5)
            base = tex.fbm(HEAT_SIZE, rng, cells=4, octaves=5)
            veins = np.clip(1 - np.abs(base - 0.5) * 16, 0, 1) ** 2
            glow = 0.05 + 0.95 * veins * (0.5 + 0.5 * tex.fbm(HEAT_SIZE, rng, cells=3, octaves=3))
            rgba = np.stack([glow, glow, glow, np.ones_like(glow)], axis=2).astype(np.float32)
            scratch = bpy.data.images.new(name, HEAT_SIZE, HEAT_SIZE, alpha=False)
            scratch.pixels.foreach_set(rgba.ravel())
            scratch.file_format = "PNG"
            scratch.filepath_raw = path
            scratch.save()
            bpy.data.images.remove(scratch)
        image = bpy.data.images.load(path)
        image.colorspace_settings.name = "Non-Color"
    return image


def wreck_material(ship, style="plating"):
    """Bruchflächen: verkohltes Metall mit glühenden Adern (Emission mal Glutmuster)."""
    mat = vf.material(f"{ship}_wreck", CHAR, 0.3, 0.95, emission=HEAT, strength=3.0, style=style, tile=0.9)
    nodes, links = mat.node_tree.nodes, mat.node_tree.links
    bsdf = next(n for n in nodes if n.type == "BSDF_PRINCIPLED")
    heat = nodes.new("ShaderNodeTexImage")
    heat.image = heat_image()
    mix = nodes.new("ShaderNodeMix")
    mix.data_type, mix.blend_type = "RGBA", "MULTIPLY"
    mix.inputs[0].default_value = 1.0
    links.new(heat.outputs["Color"], vf._socket(mix.inputs, "A_Color"))
    vf._socket(mix.inputs, "B_Color").default_value = (*HEAT, 1.0)
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


def box_uvs(bm, tiles):
    """Box-UVs wie in Ship.finish, hier für die neuen Schnittflächen (die übrigen Flächen ändern sich nicht)."""
    uv_layer = bm.loops.layers.uv.verify()
    bm.normal_update()
    for face in bm.faces:
        n = face.normal
        ax, ay, az = abs(n.x), abs(n.y), abs(n.z)
        t = tiles[face.material_index]
        for loop in face.loops:
            co = loop.vert.co
            if ax >= ay and ax >= az:
                u, v = co.y, co.z
            elif ay >= az:
                u, v = co.x, co.z
            else:
                u, v = co.x, co.y
            loop[uv_layer].uv = (u / t, v / t)


def mark_sharp(bm):
    for edge in bm.edges:
        faces = edge.link_faces
        if len(faces) == 2 and faces[0].normal.angle(faces[1].normal, 0.0) > SHARP_ANGLE:
            edge.smooth = False


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
    """Zerbricht das Schiffsobjekt `obj` (ohne Modifier) in Stücke; ersetzt vorhandene Stücke desselben Schiffs."""
    ship_id = obj.name
    rng = random.Random(seed or f"{ship_id}-wreck")
    for old in pieces_of(ship_id):
        mesh = old.data
        bpy.data.objects.remove(old)
        bpy.data.meshes.remove(mesh)
    materials = list(obj.data.materials)
    hologram = ship_id in HOLOGRAMS
    wreck_index = None
    if not hologram:
        materials.append(wreck_material(ship_id, "scrap" if ship_id == "scrap_raider" else "plating"))
        wreck_index = len(materials) - 1
    tiles = [vf.TILE.get(m.name, 1.5) for m in materials]

    base = bmesh.new()
    base.from_mesh(obj.data)
    points = seeds(obj.data, cells or CELLS.get(ship_id, 12), rng)
    collection = wrecks_collection()
    pieces = []
    for k, point in enumerate(points):
        bm = cut(base, point, [p for p in points if p is not point], wreck_index, 4 if hologram else MIN_FACES)
        if bm is None:
            continue
        box_uvs(bm, tiles)
        mark_sharp(bm)
        origin = centroid(bm)
        for v in bm.verts:
            v.co -= origin
        mesh = bpy.data.meshes.new(f"{ship_id}_wreck_{k:02d}")
        bm.to_mesh(mesh)
        bm.free()
        for mat in materials:
            mesh.materials.append(mat)
        if hologram:
            mesh.shade_flat()
        else:
            mesh.shade_smooth()
        piece = bpy.data.objects.new(mesh.name, mesh)
        piece.location = origin
        collection.objects.link(piece)
        pieces.append(piece)
    base.free()
    return pieces


def export_glb(pieces, path):
    bpy.ops.object.select_all(action="DESELECT")
    for piece in pieces:
        piece.select_set(True)
    bpy.context.view_layer.objects.active = pieces[0]
    bpy.ops.export_scene.gltf(
        filepath=path,
        export_format="GLB",
        use_selection=True,
        use_active_scene=True,
        export_apply=True,
        export_yup=True,
        export_image_format="AUTO",
        export_image_quality=85,
        export_animations=False,
        export_lights=False,
        export_cameras=False,
    )


def stats(pieces):
    tris = sum(sum(len(p.vertices) - 2 for p in piece.data.polygons) for piece in pieces)
    return {"pieces": len(pieces), "tris": tris}


def render(pieces, path, view="front", spread=0.6, zoom=1.0):
    """Explosionszeichnung: jedes Stück um `spread` seiner Schwerpunktsrichtung nach außen versetzt."""
    scene = vf.preview_scene()
    for other in list(vf.ships_collection().objects) + list(wrecks_collection().objects):
        other.hide_render = other not in pieces
    origins = {piece: piece.location.copy() for piece in pieces}
    center = sum(origins.values(), Vector()) / len(pieces)
    for piece, origin in origins.items():
        piece.location = origin + (origin - center) * spread
    bpy.context.view_layer.update()
    corners = [piece.matrix_world @ Vector(c) for piece in pieces for c in piece.bound_box]
    mid = sum(corners, Vector()) / len(corners)
    radius = max((c - mid).length for c in corners)
    camera = scene.camera
    aspect = scene.render.resolution_x / scene.render.resolution_y
    fov = min(camera.data.angle, 2 * math.atan(math.tan(camera.data.angle / 2) / aspect))
    direction = vf.VIEWS[view].normalized()
    camera.location = mid + direction * radius / math.sin(fov / 2) * 1.05 / zoom
    camera.rotation_euler = (-direction).to_track_quat("-Z", "Y").to_euler()
    scene.render.filepath = path
    bpy.ops.render.render(write_still=True)
    for piece, origin in origins.items():
        piece.location = origin
    return path
