"""Bausteine für die Low-Poly-Schiffe von Voidfleet in Blender (bpy/bmesh).

Konventionen (Blender-Koordinaten): Die Nase zeigt nach -Y, oben ist +Z,
Steuerbord ist +X. Nach dem glTF-Export (Y-up) zeigt die Nase in Babylon nach
+Z, wie `client/src/scene/ship.ts` es erwartet. Jedes Schiff ist ein einziges
flat-shaded Mesh aus geschlossenen Primitiven mit wenigen Materialien ohne
Texturen und UVs; Emission (Düsen, Lichter) leuchtet über den Glow-Layer.
"""

import math

import bmesh
import bpy
from mathutils import Euler, Matrix, Vector

COLLECTION = "VF_Ships"

# ---------------------------------------------------------------- Materialien


def material(name, color, metallic=0.4, roughness=0.5, emission=None, strength=0.0):
    mat = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = (*color, 1.0)
    bsdf.inputs["Metallic"].default_value = metallic
    bsdf.inputs["Roughness"].default_value = roughness
    bsdf.inputs["Emission Color"].default_value = (*(emission or color), 1.0)
    bsdf.inputs["Emission Strength"].default_value = strength
    mat.diffuse_color = (*color, 1.0)
    return mat


GUNMETAL = (0.055, 0.062, 0.08)
DARK = (0.035, 0.04, 0.045)
STEEL = (0.36, 0.4, 0.46)
WHITE = (0.72, 0.75, 0.78)


def palette(ship, accent, glow, hull=GUNMETAL, canopy_glow=(0.03, 0.3, 0.42), **extra):
    """Materialsatz eines Schiffs; `extra` ergänzt weitere Farben als Name -> (rgb) oder (rgb, glow)."""
    mats = {
        "hull": material(f"{ship}_hull", hull, 0.45, 0.5),
        "accent": material(f"{ship}_accent", accent, 0.2, 0.4),
        "dark": material(f"{ship}_dark", DARK, 0.1, 0.8),
        "steel": material(f"{ship}_steel", STEEL, 0.65, 0.4),
        "glow": material(f"{ship}_glow", glow, 0.0, 0.4, emission=glow, strength=20.0),
        "canopy": material(f"{ship}_canopy", (0.01, 0.03, 0.045), 0.7, 0.1, emission=canopy_glow, strength=1.5),
    }
    for key, value in extra.items():
        if isinstance(value[0], tuple):
            mats[key] = material(f"{ship}_{key}", value[0], 0.0, 0.4, emission=value[1], strength=20.0)
        else:
            mats[key] = material(f"{ship}_{key}", value, 0.3, 0.5)
    return mats


# ---------------------------------------------------------------- 2D-Profile (x, z)


def rect(w, h):
    return [(w / 2, -h / 2), (w / 2, h / 2), (-w / 2, h / 2), (-w / 2, -h / 2)]


def hexagon(w, h):
    """Spitz an den Seiten, flach oben und unten: das klassische Rumpfprofil."""
    return [(w / 2, 0), (w / 4, h / 2), (-w / 4, h / 2), (-w / 2, 0), (-w / 4, -h / 2), (w / 4, -h / 2)]


def octagon(w, h, c=0.3):
    """Rechteck mit gefasten Ecken; c ist der Anteil der Fase an der halben Breite/Höhe."""
    x, z, fx, fz = w / 2, h / 2, w / 2 * c, h / 2 * c
    return [(x, -z + fz), (x, z - fz), (x - fx, z), (-x + fx, z), (-x, z - fz), (-x, -z + fz), (-x + fx, -z), (x - fx, -z)]


def ngon(n, rx, rz=None, phase=0.0):
    rz = rx if rz is None else rz
    return [(rx * math.cos(a), rz * math.sin(a)) for a in (phase + 2 * math.pi * i / n for i in range(n))]


def keel(w, h, drop=0.4):
    """Fünfeck mit flachem Deck und Kiel: Deckkanten oben, Spitze unten."""
    return [(w / 2, h / 2 - h * drop), (w / 2, h / 2), (-w / 2, h / 2), (-w / 2, h / 2 - h * drop), (0, -h / 2)]


def scaled(shape, sx, sz=None):
    sz = sx if sz is None else sz
    return [(x * sx, z * sz) for x, z in shape]


# ---------------------------------------------------------------- Querschnitte entlang Y


def sec(y, shape, dx=0.0, dz=0.0):
    """Ein Profil als Ring von 3D-Punkten bei Tiefe y (Rumpfachse)."""
    return [Vector((x + dx, y, z + dz)) for x, z in shape]


def tip(y, dx=0.0, dz=0.0):
    return Vector((dx, y, dz))


# ---------------------------------------------------------------- Primitive (liefern bmesh)


def _face(bm, verts):
    unique = []
    for v in verts:
        if v not in unique:
            unique.append(v)
    if len(unique) >= 3:
        try:
            bm.faces.new(unique)
        except ValueError:
            pass


def _finish(bm):
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return bm


def loft(sections, cap_start=True, cap_end=True):
    """Haut zwischen Ringen gleicher Punktzahl; eine Spitze (Vector) schließt mit einem Fächer."""
    bm = bmesh.new()
    rings = [bm.verts.new(s) if isinstance(s, Vector) else [bm.verts.new(p) for p in s] for s in sections]
    for a, b in zip(rings, rings[1:]):
        if isinstance(a, list) and isinstance(b, list):
            n = len(a)
            for i in range(n):
                _face(bm, [a[i], a[(i + 1) % n], b[(i + 1) % n], b[i]])
        elif isinstance(a, list):
            n = len(a)
            for i in range(n):
                _face(bm, [a[i], a[(i + 1) % n], b])
        else:
            n = len(b)
            for i in range(n):
                _face(bm, [a, b[(i + 1) % n], b[i]])
    if cap_start and isinstance(rings[0], list):
        _face(bm, rings[0])
    if cap_end and isinstance(rings[-1], list):
        _face(bm, rings[-1])
    return _finish(bm)


def box(sx, sy, sz):
    return loft([sec(-sy / 2, rect(sx, sz)), sec(sy / 2, rect(sx, sz))])


def plate(points, thickness, plane="xy"):
    """Prisma aus einem 2D-Polygon. 'xy': liegt flach (Dicke in z), 'yz': steht längs
    (Dicke in x, Punkte sind (y, z)), 'xz': steht quer (Dicke in y, Punkte sind (x, z))."""
    h = thickness / 2
    if plane == "xy":
        a, b = [Vector((x, y, -h)) for x, y in points], [Vector((x, y, h)) for x, y in points]
    elif plane == "yz":
        a, b = [Vector((-h, y, z)) for y, z in points], [Vector((h, y, z)) for y, z in points]
    else:
        a, b = [Vector((x, -h, z)) for x, z in points], [Vector((x, h, z)) for x, z in points]
    return loft([a, b])


def tube(n, r0, r1, y0, y1, dx=0.0, dz=0.0, phase=0.0, rz0=None, rz1=None):
    """Rohr oder Kegel entlang Y von y0 nach y1; Radius 0 ergibt eine Spitze."""
    s0 = tip(y0, dx, dz) if r0 == 0 else sec(y0, ngon(n, r0, rz0, phase), dx, dz)
    s1 = tip(y1, dx, dz) if r1 == 0 else sec(y1, ngon(n, r1, rz1, phase), dx, dz)
    return loft([s0, s1])


def post(n, r0, r1, z0, z1, dx=0.0, dy=0.0):
    """Rohr oder Kegel entlang Z (Masten, Antennen, Turmsockel)."""
    s0 = Vector((dx, dy, z0)) if r0 == 0 else [Vector((x + dx, y + dy, z0)) for x, y in ngon(n, r0)]
    s1 = Vector((dx, dy, z1)) if r1 == 0 else [Vector((x + dx, y + dy, z1)) for x, y in ngon(n, r1)]
    return loft([s0, s1])


def sphere(r, subdivisions=1):
    bm = bmesh.new()
    bmesh.ops.create_icosphere(bm, subdivisions=subdivisions, radius=r)
    return _finish(bm)


def hoop(n, r_in, r_out, h):
    """Flacher Ring um die Z-Achse (Signalring, Düsenkranz)."""
    bm = bmesh.new()
    rings = []
    for r, z in ((r_in, -h / 2), (r_out, -h / 2), (r_out, h / 2), (r_in, h / 2)):
        rings.append([bm.verts.new(Vector((x, y, z))) for x, y in ngon(n, r)])
    for k in range(4):
        a, b = rings[k], rings[(k + 1) % 4]
        for i in range(n):
            _face(bm, [a[i], a[(i + 1) % n], b[(i + 1) % n], b[i]])
    return _finish(bm)


def dish(r, depth, n=16, rings=3, thickness=0.05):
    """Parabolschüssel mit Öffnung nach -Y; der Scheitel liegt im Ursprung."""
    sections = [tip(0.0)]
    for k in range(1, rings + 1):
        t = k / rings
        sections.append(sec(-depth * t * t, ngon(n, r * t)))
    bm = loft(sections, cap_end=False)
    bmesh.ops.solidify(bm, geom=bm.faces[:], thickness=thickness)
    return _finish(bm)


# ---------------------------------------------------------------- Schiff zusammensetzen


class Ship:
    def __init__(self, name):
        self.name = name
        self.bm = bmesh.new()
        self.materials = []

    def add(self, part, mat, at=(0, 0, 0), rot=(0, 0, 0), scale=1.0, mirror=False):
        """Teil (bmesh) mit Material einfügen; `rot` in Grad, `mirror` spiegelt zusätzlich an x=0."""
        if mat not in self.materials:
            self.materials.append(mat)
        index = self.materials.index(mat)
        s = scale if isinstance(scale, (tuple, list)) else (scale, scale, scale)
        matrix = Matrix.Translation(at) @ Euler([math.radians(a) for a in rot]).to_matrix().to_4x4() @ Matrix.Diagonal((*s, 1.0))
        self._merge(part, index, matrix)
        if mirror:
            self._merge(part, index, Matrix.Diagonal((-1, 1, 1, 1)) @ matrix, flip=True)
        part.free()
        return self

    def engine(self, mats, r, y0, y1, dx=0.0, dz=0.0, n=8, mirror=False, glow="glow"):
        """Düse: dunkler Kranz mit leuchtender Scheibe am hinteren Ende (y1)."""
        self.add(tube(n, r * 0.92, r, y0, y1, dx, dz), mats["dark"], mirror=mirror)
        self.add(tube(n, r * 0.72, r * 0.72, y1 - 0.12, y1 + 0.02, dx, dz), mats[glow], mirror=mirror)
        return self

    def _merge(self, part, index, matrix, flip=False):
        bm = part.copy()
        bmesh.ops.transform(bm, matrix=matrix, verts=bm.verts)
        if flip:
            bmesh.ops.reverse_faces(bm, faces=bm.faces)
        for face in bm.faces:
            face.material_index = index
        temp = bpy.data.meshes.new("vf_part")
        bm.to_mesh(temp)
        bm.free()
        self.bm.from_mesh(temp)
        bpy.data.meshes.remove(temp)

    def finish(self):
        """Erzeugt das Objekt in der Sammlung COLLECTION und ersetzt ein gleichnamiges."""
        collection = ships_collection()
        old = bpy.data.objects.get(self.name)
        if old:
            mesh = old.data
            bpy.data.objects.remove(old)
            bpy.data.meshes.remove(mesh)
        mesh = bpy.data.meshes.new(self.name)
        self.bm.to_mesh(mesh)
        self.bm.free()
        for mat in self.materials:
            mesh.materials.append(mat)
        mesh.shade_flat()
        obj = bpy.data.objects.new(self.name, mesh)
        collection.objects.link(obj)
        return obj


def ships_collection():
    scene = bpy.context.scene
    collection = bpy.data.collections.get(COLLECTION)
    if collection is None:
        collection = bpy.data.collections.new(COLLECTION)
    if collection.name not in scene.collection.children:
        scene.collection.children.link(collection)
    return collection


def stats(obj):
    mesh = obj.data
    xs = [v.co.x for v in mesh.vertices]
    ys = [v.co.y for v in mesh.vertices]
    zs = [v.co.z for v in mesh.vertices]
    return {
        "faces": len(mesh.polygons),
        "tris": sum(len(p.vertices) - 2 for p in mesh.polygons),
        "size": [round(max(xs) - min(xs), 2), round(max(ys) - min(ys), 2), round(max(zs) - min(zs), 2)],
        "y": [round(min(ys), 2), round(max(ys), 2)],
        "z": [round(min(zs), 2), round(max(zs), 2)],
    }


# ---------------------------------------------------------------- Export


def export_glb(obj, path):
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.export_scene.gltf(
        filepath=path,
        export_format="GLB",
        use_selection=True,
        use_active_scene=True,
        export_apply=True,
        export_yup=True,
        export_animations=False,
        export_lights=False,
        export_cameras=False,
    )


# ---------------------------------------------------------------- Vorschau


def preview_scene():
    """Eigene Szene mit dunklem Hintergrund, drei Sonnen und einer Kamera; lässt die Nutzer-Szene in Ruhe."""
    scene = bpy.data.scenes.get("Voidfleet")
    if scene is None:
        scene = bpy.data.scenes.new("Voidfleet")
    bpy.context.window.scene = scene
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x, scene.render.resolution_y = 960, 640
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.eevee.taa_render_samples = 24
    world = bpy.data.worlds.get("VF_World") or bpy.data.worlds.new("VF_World")
    world.use_nodes = True
    background = world.node_tree.nodes["Background"]
    background.inputs["Color"].default_value = (0.012, 0.014, 0.024, 1.0)
    background.inputs["Strength"].default_value = 1.0
    scene.world = world
    ships_collection()
    for name, rotation, energy, color in (
        ("VF_Key", (50, 12, -35), 5.0, (1.0, 0.97, 0.92)),
        ("VF_Fill", (65, -20, 120), 1.8, (0.75, 0.85, 1.0)),
        ("VF_Rim", (-60, 0, 160), 2.5, (0.6, 0.75, 1.0)),
    ):
        light = bpy.data.objects.get(name)
        if light is None:
            data = bpy.data.lights.new(name, "SUN")
            light = bpy.data.objects.new(name, data)
            scene.collection.objects.link(light)
        light.data.energy = energy
        light.data.color = color
        light.data.angle = math.radians(8)
        light.rotation_euler = Euler([math.radians(a) for a in rotation])
    camera = bpy.data.objects.get("VF_Camera")
    if camera is None:
        camera = bpy.data.objects.new("VF_Camera", bpy.data.cameras.new("VF_Camera"))
        scene.collection.objects.link(camera)
    camera.data.lens = 50
    scene.camera = camera
    return scene


VIEWS = {
    "front": Vector((-0.85, -1.0, 0.6)),
    "rear": Vector((0.8, 1.0, 0.5)),
    "top": Vector((0.0, -0.08, 1.0)),
    "side": Vector((1.0, -0.05, 0.12)),
}


def render(obj, path, view="front", zoom=1.0):
    """Rendert nur `obj` aus einer der VIEWS-Richtungen nach `path`."""
    scene = preview_scene()
    for other in ships_collection().objects:
        other.hide_render = other is not obj
    corners = [obj.matrix_world @ Vector(c) for c in obj.bound_box]
    center = sum(corners, Vector()) / 8
    radius = max((c - center).length for c in corners)
    camera = scene.camera
    aspect = scene.render.resolution_x / scene.render.resolution_y
    fov = min(camera.data.angle, 2 * math.atan(math.tan(camera.data.angle / 2) / aspect))
    distance = radius / math.sin(fov / 2) * 1.05 / zoom
    direction = VIEWS[view].normalized()
    camera.location = center + direction * distance
    camera.rotation_euler = (-direction).to_track_quat("-Z", "Y").to_euler()
    scene.render.filepath = path
    bpy.ops.render.render(write_still=True)
    return path
