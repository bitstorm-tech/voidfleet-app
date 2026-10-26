"""Bausteine für die Schiffe von Voidfleet in Blender (bpy/bmesh).

Konventionen (Blender-Koordinaten): Die Nase zeigt nach -Y, oben ist +Z, Steuerbord ist +X.
Nach dem glTF-Export (Y-up) zeigt die Nase in Babylon nach +Z, wie `client/src/scene/ship.ts`
es erwartet. Jedes Schiff ist ein einziges Mesh aus geschlossenen Primitiven: smooth shaded mit
einem Bevel-Modifier (gehärtete Normalen) für weiche Kanten, Box-UVs je Fläche und kachelbaren
Rumpfplatten-Texturen aus `tex.py` (Farbe, Rauheit/Metall, Normalmap). Düsen und Lichter sind
Emission-Materialien für den Glow-Layer.
"""

import hashlib
import math
import os
import random
import tempfile

import bmesh
import bpy
from mathutils import Euler, Matrix, Vector

import tex

COLLECTION = "VF_Ships"
BEVEL_WIDTH = 0.02

# ---------------------------------------------------------------- Texturen


def _texture_dir():
    with open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "tex.py"), "rb") as f:
        digest = hashlib.md5(f.read()).hexdigest()[:8]
    return os.path.join(tempfile.gettempdir(), f"vf-textures-{digest}")


_textures = {}


def textures(style):
    """Die drei Bilder eines Textur-Stils, bei Bedarf erzeugt (Cache je Stand von tex.py)."""
    if style not in _textures:
        directory = _texture_dir()
        paths = {kind: os.path.join(directory, f"vf_{style}_{kind}.{ext}") for kind, ext in (("color", "jpg"), ("orm", "jpg"), ("normal", "png"))}
        if not all(os.path.exists(p) for p in paths.values()):
            paths = tex.save(style, directory)
        images = {}
        for kind, path in paths.items():
            image = bpy.data.images.get(os.path.basename(path)) or bpy.data.images.load(path)
            if kind != "color":
                image.colorspace_settings.name = "Non-Color"
            images[kind] = image
        _textures[style] = images
    return _textures[style]


# ---------------------------------------------------------------- Materialien

TILE = {}  # Materialname -> Kantenlänge einer Texturkachel in Blender-Einheiten


def _socket(sockets, identifier):
    return next(s for s in sockets if s.identifier == identifier)


def material(name, color, metallic=0.4, roughness=0.5, emission=None, strength=0.0, style=None, tile=1.5, normal_strength=1.0):
    """PBR-Material; mit `style` werden die Platten-Texturen eingehängt, `metallic` und `roughness`
    wirken dann als Faktoren auf die Texturwerte (Rauheit in der Textur liegt um 0.5)."""
    mat = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    mat.use_nodes = True
    nodes, links = mat.node_tree.nodes, mat.node_tree.links
    nodes.clear()
    out = nodes.new("ShaderNodeOutputMaterial")
    bsdf = nodes.new("ShaderNodeBsdfPrincipled")
    links.new(bsdf.outputs["BSDF"], out.inputs["Surface"])
    bsdf.inputs["Base Color"].default_value = (*color, 1.0)
    bsdf.inputs["Metallic"].default_value = metallic
    bsdf.inputs["Roughness"].default_value = roughness
    bsdf.inputs["Emission Color"].default_value = (*(emission or color), 1.0)
    bsdf.inputs["Emission Strength"].default_value = strength
    if style:
        images = textures(style)
        tex_color = nodes.new("ShaderNodeTexImage")
        tex_color.image = images["color"]
        mix = nodes.new("ShaderNodeMix")
        mix.data_type, mix.blend_type = "RGBA", "MULTIPLY"
        mix.inputs[0].default_value = 1.0
        links.new(tex_color.outputs["Color"], _socket(mix.inputs, "A_Color"))
        _socket(mix.inputs, "B_Color").default_value = (*color, 1.0)
        links.new(_socket(mix.outputs, "Result_Color"), bsdf.inputs["Base Color"])
        tex_orm = nodes.new("ShaderNodeTexImage")
        tex_orm.image = images["orm"]
        separate = nodes.new("ShaderNodeSeparateColor")
        links.new(tex_orm.outputs["Color"], separate.inputs["Color"])
        for channel, factor, target in (("Green", roughness, "Roughness"), ("Blue", metallic, "Metallic")):
            mul = nodes.new("ShaderNodeMath")
            mul.operation = "MULTIPLY"
            mul.inputs[1].default_value = factor
            links.new(separate.outputs[channel], mul.inputs[0])
            links.new(mul.outputs[0], bsdf.inputs[target])
        tex_normal = nodes.new("ShaderNodeTexImage")
        tex_normal.image = images["normal"]
        normal_map = nodes.new("ShaderNodeNormalMap")
        normal_map.inputs["Strength"].default_value = normal_strength
        links.new(tex_normal.outputs["Color"], normal_map.inputs["Color"])
        links.new(normal_map.outputs["Normal"], bsdf.inputs["Normal"])
    mat.diffuse_color = (*color, 1.0)
    TILE[mat.name] = tile
    return mat


def iridescent(mat, thickness=420.0, ior=1.5):
    """Dünnschicht-Schimmer (Thin Film) auf einem Material; der glTF-Export schreibt ihn als KHR_materials_iridescence
    und liest den Faktor aus der Knotengruppe „glTF Material Output“. Ihr (unverbundener) Eingang „Occlusion“ hält
    den Exporter davon ab, das Material zu vereinfachen (inline) und die Gruppe dabei zu verlieren."""
    nodes = mat.node_tree.nodes
    bsdf = next(n for n in nodes if n.type == "BSDF_PRINCIPLED")
    bsdf.inputs["Thin Film Thickness"].default_value = thickness
    bsdf.inputs["Thin Film IOR"].default_value = ior
    group = bpy.data.node_groups.get("glTF Material Output")
    if group is None:
        group = bpy.data.node_groups.new("glTF Material Output", "ShaderNodeTree")
        for name in ("Occlusion", "Iridescence Factor", "Iridescence Thickness Minimum"):
            group.interface.new_socket(name, in_out="INPUT", socket_type="NodeSocketFloat")
    node = nodes.new("ShaderNodeGroup")
    node.node_tree = group
    node.inputs["Iridescence Factor"].default_value = 1.0
    node.inputs["Iridescence Thickness Minimum"].default_value = thickness
    return mat


GUNMETAL = (0.3, 0.33, 0.38)
DARK = (0.09, 0.095, 0.105)
STEEL = (0.62, 0.64, 0.66)
WHITE = (0.85, 0.86, 0.87)
WINDOW = (1.0, 0.85, 0.6)


def palette(ship, accent, glow, hull=GUNMETAL, style="plating", tile=1.5, canopy_glow=(0.03, 0.3, 0.42), **extra):
    """Materialsatz eines Schiffs; `extra` ergänzt Farben als Name -> (rgb) (texturiert) oder (rgb, glow) (leuchtend)."""
    mats = {
        "hull": material(f"{ship}_hull", hull, 0.85, 0.9, style=style, tile=tile),
        "accent": material(f"{ship}_accent", accent, 0.3, 1.0, style=style, tile=tile),
        "dark": material(f"{ship}_dark", DARK, 0.6, 1.0, style=style, tile=tile * 0.7),
        "steel": material(f"{ship}_steel", STEEL, 1.0, 0.75, style=style, tile=tile * 0.5, normal_strength=0.5),
        "plain": material(f"{ship}_plain", DARK, 0.7, 0.55),
        "glow": material(f"{ship}_glow", glow, 0.0, 0.4, emission=glow, strength=20.0),
        "window": material(f"{ship}_window", WINDOW, 0.0, 0.3, emission=WINDOW, strength=5.0),
        "canopy": material(f"{ship}_canopy", (0.01, 0.03, 0.045), 0.0, 0.08, emission=canopy_glow, strength=1.5),
        "navred": material(f"{ship}_navred", (1.0, 0.2, 0.1), 0.0, 0.4, emission=(1.0, 0.2, 0.1), strength=12.0),
        "navgreen": material(f"{ship}_navgreen", (0.2, 1.0, 0.3), 0.0, 0.4, emission=(0.2, 1.0, 0.3), strength=12.0),
    }
    for key, value in extra.items():
        if isinstance(value[0], tuple):
            mats[key] = material(f"{ship}_{key}", value[0], 0.0, 0.4, emission=value[1], strength=20.0)
        else:
            mats[key] = material(f"{ship}_{key}", value, 0.6, 1.0, style=style, tile=tile)
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


def rounded(w, h, r, n=3):
    """Rechteck mit runden Ecken (Radius r, n Zwischenpunkte je Ecke)."""
    r = min(r, w / 2, h / 2)
    pts = []
    for cx, cz, a0 in ((w / 2 - r, -h / 2 + r, -90), (w / 2 - r, h / 2 - r, 0), (-w / 2 + r, h / 2 - r, 90), (-w / 2 + r, -h / 2 + r, 180)):
        for k in range(n + 2):
            a = math.radians(a0 + 90 * k / (n + 1))
            pts.append((cx + r * math.cos(a), cz + r * math.sin(a)))
    return pts


def superellipse(w, h, n=24, p=2.6, phase=0.0):
    """Rundliches Rechteck (Rumpf, Gondel); p = 2 ergibt eine Ellipse, größer wird kastiger."""
    pts = []
    for i in range(n):
        a = phase + 2 * math.pi * i / n
        c, s = math.cos(a), math.sin(a)
        pts.append((w / 2 * math.copysign(abs(c) ** (2 / p), c), h / 2 * math.copysign(abs(s) ** (2 / p), s)))
    return pts


def scaled(shape, sx, sz=None):
    sz = sx if sz is None else sz
    return [(x * sx, z * sz) for x, z in shape]


def shifted(shape, dx=0.0, dz=0.0):
    return [(x + dx, z + dz) for x, z in shape]


def resample(shape, n):
    """Polygon auf n gleichmäßig über den Umfang verteilte Punkte bringen; der Startpunkt bleibt."""
    pts = [Vector((x, z)) for x, z in shape]
    k = len(pts)
    seg = [(pts[(i + 1) % k] - pts[i]).length for i in range(k)]
    total = sum(seg)
    out = []
    for j in range(n):
        d, i = total * j / n, 0
        while i < k - 1 and d > seg[i]:
            d -= seg[i]
            i += 1
        t = d / seg[i] if seg[i] else 0.0
        p = pts[i].lerp(pts[(i + 1) % k], min(t, 1.0))
        out.append((p.x, p.y))
    return out


# ---------------------------------------------------------------- Querschnitte entlang Y


def sec(y, shape, dx=0.0, dz=0.0, n=None):
    """Ein Profil als Ring von 3D-Punkten bei Tiefe y (Rumpfachse); `n` sampelt auf n Punkte um."""
    if n:
        shape = resample(shape, n)
    return [Vector((x + dx, y, z + dz)) for x, z in shape]


def tip(y, dx=0.0, dz=0.0):
    return Vector((dx, y, dz))


def _catmull(p0, p1, p2, p3, t):
    return 0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t + (-p0 + 3 * p1 - 3 * p2 + p3) * t * t * t)


def smooth(sections, subdiv=3):
    """Fügt zwischen den Querschnitten Zwischenringe auf einer Catmull-Rom-Kurve ein (runde Rümpfe).
    Spitzen bleiben Spitzen; alle Ringe müssen gleich viele Punkte haben."""
    n = max(len(s) for s in sections if isinstance(s, list))
    pts = [s if isinstance(s, list) else [s] * n for s in sections]
    out = []
    for k in range(len(pts) - 1):
        p0, p1, p2, p3 = pts[max(k - 1, 0)], pts[k], pts[k + 1], pts[min(k + 2, len(pts) - 1)]
        out.append(sections[k])
        for j in range(1, subdiv + 1):
            t = j / (subdiv + 1)
            out.append([_catmull(p0[i], p1[i], p2[i], p3[i], t) for i in range(n)])
    out.append(sections[-1])
    return out


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


def _append(bm, part, matrix=None, flip=False):
    """Kopiert die Flächen von `part` samt Materialindex nach `bm` (optional transformiert) und gibt sie zurück."""
    vmap = {v: bm.verts.new(matrix @ v.co if matrix else v.co) for v in part.verts}
    faces = []
    for f in part.faces:
        verts = [vmap[v] for v in f.verts]
        if flip:
            verts.reverse()
        try:
            face = bm.faces.new(verts)
        except ValueError:
            continue
        face.material_index = f.material_index
        faces.append(face)
    return faces


def union(*parts):
    """Mehrere Teile zu einem bmesh (ohne Verschmelzen)."""
    bm = bmesh.new()
    for part in parts:
        _append(bm, part)
        part.free()
    return bm


def loft(sections, cap_start=True, cap_end=True):
    """Haut zwischen Ringen; eine Spitze (Vector) schließt mit einem Fächer. Ringe mit
    unterschiedlicher Punktzahl werden auf die größte umgesampelt."""
    n = max(len(s) for s in sections if isinstance(s, list))
    sections = [s if not isinstance(s, list) or len(s) == n else sec(s[0].y, [(p.x, p.z) for p in s], n=n) for s in sections]
    bm = bmesh.new()
    rings = [bm.verts.new(s) if isinstance(s, Vector) else [bm.verts.new(p) for p in s] for s in sections]
    for a, b in zip(rings, rings[1:]):
        if isinstance(a, list) and isinstance(b, list):
            for i in range(n):
                _face(bm, [a[i], a[(i + 1) % n], b[(i + 1) % n], b[i]])
        elif isinstance(a, list):
            for i in range(n):
                _face(bm, [a[i], a[(i + 1) % n], b])
        else:
            for i in range(n):
                _face(bm, [a, b[(i + 1) % n], b[i]])
    if cap_start and isinstance(rings[0], list):
        _face(bm, rings[0])
    if cap_end and isinstance(rings[-1], list):
        _face(bm, rings[-1])
    return _finish(bm)


def box(sx, sy, sz):
    return loft([sec(-sy / 2, rect(sx, sz)), sec(sy / 2, rect(sx, sz))])


def rbox(sx, sy, sz, r=0.05, segments=2):
    """Quader mit gerundeten Kanten."""
    bm = box(sx, sy, sz)
    bmesh.ops.bevel(bm, geom=bm.edges[:] + bm.verts[:], offset=min(r, sx / 2.2, sy / 2.2, sz / 2.2), segments=segments,
                    profile=0.5, affect="EDGES", clamp_overlap=True)
    return _finish(bm)


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


def revolve(profile, n=24, phase=0.0):
    """Rotationskörper um die Y-Achse aus (r, y)-Punkten; r = 0 ergibt eine Spitze."""
    return loft([tip(y) if r == 0 else sec(y, ngon(n, r, phase=phase)) for r, y in profile])


def sphere(r, subdivisions=2):
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


def dish(r, depth, n=24, rings=5, thickness=0.04):
    """Parabolschüssel mit Öffnung nach -Y; der Scheitel liegt im Ursprung."""
    sections = [tip(0.0)]
    for k in range(1, rings + 1):
        t = k / rings
        sections.append(sec(-depth * t * t, ngon(n, r * t)))
    bm = loft(sections, cap_end=False)
    bmesh.ops.solidify(bm, geom=bm.faces[:], thickness=thickness)
    return _finish(bm)


def segment(a, b, r, n=10):
    """Rohr von Punkt a nach Punkt b."""
    a, b = Vector(a), Vector(b)
    d = b - a
    bm = tube(n, r, r, 0.0, d.length)
    rot = Vector((0, 1, 0)).rotation_difference(d.normalized()).to_matrix().to_4x4()
    bmesh.ops.transform(bm, matrix=Matrix.Translation(a) @ rot, verts=bm.verts)
    return bm


def sweep(points, shape):
    """Profil (x, z) entlang einer Punktfolge ziehen (Leisten, Zierlinien): x zeigt zur Seite der Bahn,
    z nach oben; an Knicken steht der Querschnitt auf der gemittelten Richtung."""
    pts = [Vector(p) for p in points]
    rings = []
    for i, p in enumerate(pts):
        t = (pts[min(i + 1, len(pts) - 1)] - pts[max(i - 1, 0)]).normalized()
        side = t.cross(Vector((0, 0, 1)))
        if side.length < 1e-6:
            side = t.cross(Vector((0, 1, 0)))
        side.normalize()
        up = side.cross(t)
        rings.append([p + side * x + up * z for x, z in shape])
    return loft(rings)


def pipe(points, r, n=10, joints=True):
    """Rohrleitung entlang einer Punktfolge mit Kugelgelenken an den Knicken."""
    bm = bmesh.new()
    for a, b in zip(points, points[1:]):
        _append(bm, segment(a, b, r, n))
    if joints:
        for p in points[1:-1]:
            _append(bm, sphere(r * 1.15, 1), Matrix.Translation(Vector(p)))
    return _finish(bm)


def inset(bm, thickness=0.03, depth=0.012, min_area=0.02):
    """Plattenfugen: setzt jede größere Fläche einzeln nach innen ab und senkt sie ein."""
    faces = [f for f in bm.faces if f.calc_area() > min_area]
    bmesh.ops.inset_individual(bm, faces=faces, thickness=thickness, depth=-depth, use_even_offset=True)
    return bm


# ---------------------------------------------------------------- Schiff zusammensetzen


class Ship:
    def __init__(self, name):
        self.name = name
        self.bm = bmesh.new()
        self.materials = []
        self.rng = random.Random(name)

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

    def engine(self, m, r, y0, y1, dx=0.0, dz=0.0, n=24, mirror=False, glow="glow", plume=0.3):
        """Triebwerk: geripptes Gehäuse, Düsenglocke mit Wandstärke, leuchtende Brennkammer und kurze Fahne."""
        length = y1 - y0
        ya, yb = y0 + 0.6 * length, y0 + 0.78 * length
        self.add(tube(n, r, r, y0, ya, dx, dz), m["dark"], mirror=mirror)
        for yr in (y0 + 0.18 * length, y0 + 0.42 * length):
            self.add(hoop(n, r * 0.97, r * 1.06, 0.07 * length), m["steel"], at=(dx, yr, dz), rot=(90, 0, 0), mirror=mirror)
        bell = [(r * 1.0, ya), (r * 0.76, yb), (r * 0.72, yb + 0.05 * length), (r * 0.9, y1), (r * 0.8, y1),
                (r * 0.62, yb + 0.06 * length), (0.0, yb + 0.02 * length)]
        self.add(revolve(bell, n), m["steel"], at=(dx, 0, dz), mirror=mirror)
        self.add(revolve([(r * 0.6, yb + 0.03 * length), (r * 0.6, yb + 0.1 * length), (r * 0.5, y1 + 0.02 * length), (0.0, y1 + plume * length)], n),
                 m[glow], at=(dx, 0, dz), mirror=mirror)
        return self

    def _merge(self, part, index, matrix, flip=False):
        for face in _append(self.bm, part, matrix, flip):
            face.material_index = index

    def place(self, group, at=(0, 0, 0), rot=(0, 0, 0), mirror=False):
        """Eine fertig gebaute Baugruppe (ebenfalls ein Ship) transformiert einfügen."""
        matrix = Matrix.Translation(at) @ Euler([math.radians(a) for a in rot]).to_matrix().to_4x4()
        for m in group.materials:
            if m not in self.materials:
                self.materials.append(m)
        index = [self.materials.index(m) for m in group.materials]
        transforms = [(matrix, False), (Matrix.Diagonal((-1, 1, 1, 1)) @ matrix, True)] if mirror else [(matrix, False)]
        for m, flip in transforms:
            for face in _append(self.bm, group.bm, m, flip):
                face.material_index = index[face.material_index]
        return self

    def finish(self, bevel=BEVEL_WIDTH, panels=None):
        """Box-UVs, Smooth Shading und Bevel-Modifier; erzeugt das Objekt in COLLECTION und ersetzt ein gleichnamiges."""
        bm = self.bm
        bm.normal_update()
        uv_layer = bm.loops.layers.uv.new("UVMap")
        tiles = [TILE.get(m.name, 1.5) for m in self.materials]
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
        collection = ships_collection()
        old = bpy.data.objects.get(self.name)
        if old:
            mesh = old.data
            bpy.data.objects.remove(old)
            bpy.data.meshes.remove(mesh)
        mesh = bpy.data.meshes.new(self.name)
        bm.to_mesh(mesh)
        bm.free()
        for mat in self.materials:
            mesh.materials.append(mat)
        mesh.shade_smooth()
        obj = bpy.data.objects.new(self.name, mesh)
        collection.objects.link(obj)
        if bevel:
            mod = obj.modifiers.new("Bevel", "BEVEL")
            mod.width = bevel
            mod.segments = 1
            mod.limit_method = "ANGLE"
            mod.angle_limit = math.radians(32)
            mod.harden_normals = True
            mod.use_clamp_overlap = True
            mod.miter_outer = "MITER_ARC"
        return obj


# ---------------------------------------------------------------- Wiederkehrende Baugruppen


def turret(s, m, at, barrel=1.1, r=0.42, barrels=2, yaw=0.0, mirror=False):
    """Geschützturm: Sockelring, Barbette, gerundetes Gehäuse, Blende, Rohre mit Hülsen und Mündungen, Luke, Sensor."""
    x, y, z = at
    s.add(post(20, r * 1.05, r * 1.0, 0.0, 0.1), m["steel"], at=(x, y, z), mirror=mirror)
    s.add(post(20, r * 0.86, r * 0.86, 0.1, 0.24), m["dark"], at=(x, y, z), mirror=mirror)
    g = Ship("turret")
    g.add(loft(smooth([sec(-0.95 * r, rounded(1.2 * r, 0.5 * r, 0.12 * r)), sec(-0.5 * r, rounded(1.7 * r, 0.8 * r, 0.16 * r)),
                       sec(0.55 * r, rounded(1.7 * r, 0.84 * r, 0.16 * r)), sec(1.05 * r, rounded(1.3 * r, 0.6 * r, 0.14 * r))], 1)), m["hull"])
    g.add(rbox(1.25 * r, 0.3 * r, 0.52 * r, 0.05 * r, 1), m["dark"], at=(0, -1.05 * r, 0.02 * r))
    g.add(rbox(0.5 * r, 0.5 * r, 0.08 * r, 0.03 * r, 1), m["steel"], at=(0.3 * r, 0.3 * r, 0.44 * r))
    g.add(box(0.16 * r, 0.3 * r, 0.14 * r), m["plain"], at=(-0.55 * r, 0.1 * r, 0.44 * r))
    g.add(tube(10, 0.03 * r, 0.03 * r, -0.5 * r, 0.5 * r), m["steel"], at=(0.75 * r, 0.1 * r, 0.42 * r))
    rb = 0.16 * r
    for dx in ([0.0] if barrels == 1 else [-0.36 * r, 0.36 * r]):
        g.add(tube(12, rb * 1.45, rb * 1.35, -0.45 * barrel, -1.0 * r), m["dark"], at=(dx, 0, 0.05 * r))
        g.add(tube(12, rb, rb * 0.9, -barrel, -0.4 * barrel), m["steel"], at=(dx, 0, 0.05 * r))
        g.add(tube(12, rb * 1.25, rb * 1.25, -barrel - 0.08, -barrel + 0.1), m["dark"], at=(dx, 0, 0.05 * r))
    s.place(g, at=(x, y, z + 0.24 + 0.4 * r), rot=(0, 0, yaw), mirror=mirror)
    g.bm.free()


def pd_turret(s, m, at, r=0.14, yaw=0.0, mirror=False):
    """Kleiner Flak-Turm: Sockel, Kuppel, dünner Doppellauf."""
    x, y, z = at
    s.add(post(14, r * 1.1, r, 0.0, 0.5 * r), m["steel"], at=(x, y, z), mirror=mirror)
    s.add(sphere(r, 2), m["hull"], at=(x, y, z + 0.5 * r), mirror=mirror)
    for dx in (-0.35 * r, 0.35 * r):
        s.add(tube(8, 0.12 * r, 0.1 * r, -3.2 * r, 0.0), m["plain"], at=(x + dx, y, z + 0.6 * r), rot=(0, 0, yaw), mirror=mirror)


def missile_pod(s, m, at, size=(0.5, 0.9, 0.34), cells=(3, 2), rot=(0, 0, 0), mirror=False):
    """Raketenwerfer: gerundeter Kasten mit Rohröffnungen vorn und Akzentstreifen."""
    w, l, h = size
    s.add(rbox(w, l, h, 0.04, 1), m["hull"], at=at, rot=rot, mirror=mirror)
    cx, cz = cells
    rr = min(w / cx, h / cz) * 0.36
    for i in range(cx):
        for j in range(cz):
            dx = (i - (cx - 1) / 2) * w / cx
            dz = (j - (cz - 1) / 2) * h / cz
            s.add(tube(10, rr * 1.15, rr * 1.15, -0.04, 0.0), m["plain"], at=(at[0] + dx, at[1] - l / 2, at[2] + dz), rot=rot, mirror=mirror)
            s.add(tube(10, rr * 0.85, 0.0, 0.0, 0.06), m["dark"], at=(at[0] + dx, at[1] - l / 2 - 0.04, at[2] + dz), rot=rot, mirror=mirror)
    s.add(box(w * 1.02, 0.08, h * 0.4), m["accent"], at=(at[0], at[1] + l * 0.3, at[2]), rot=rot, mirror=mirror)


def antenna(s, m, at, height, r=0.025, discs=2, mirror=False):
    """Mast mit Querscheiben und rotem Positionslicht an der Spitze."""
    x, y, z = at
    s.add(post(8, r, r * 0.6, 0.0, height), m["steel"], at=(x, y, z), mirror=mirror)
    for k in range(discs):
        zz = height * (0.45 + 0.4 * k / max(discs - 1, 1))
        s.add(hoop(10, r * 1.2, r * 4, r * 1.2), m["plain"], at=(x, y, z + zz), mirror=mirror)
    s.add(sphere(r * 1.6, 1), m["navred"] if "navred" in m else m["glow"], at=(x, y, z + height + r), mirror=mirror)


def radar(s, m, at, width=0.6, height=0.25, yaw=0.0):
    """Phased-Array-Platte auf kurzem Mast mit Rückenstruktur."""
    x, y, z = at
    s.add(post(10, 0.04, 0.03, 0.0, 0.18), m["steel"], at=(x, y, z))
    s.add(box(width, 0.05, height), m["dark"], at=(x, y, z + 0.18 + height / 2), rot=(0, 0, yaw))
    s.add(box(width * 0.92, 0.02, height * 0.84), m["steel"], at=(x, y - 0.035, z + 0.18 + height / 2), rot=(0, 0, yaw))
    for k in range(3):
        s.add(box(width * 0.9, 0.025, 0.012), m["plain"], at=(x, y - 0.05, z + 0.18 + height * (0.25 + 0.25 * k)), rot=(0, 0, yaw))


def windows(s, m, start, end, count, size=(0.05, 0.03, 0.05), mirror=False):
    """Fensterreihe: kleine leuchtende Kästen von start bis end."""
    a, b = Vector(start), Vector(end)
    for k in range(count):
        p = a.lerp(b, (k + 0.5) / count)
        s.add(box(*size), m["window"], at=tuple(p), mirror=mirror)


def vents(s, m, at, width, height, slots=4, depth=0.03, rot=(0, 0, 0), mirror=False):
    """Lüftungsgitter: dunkler Kasten in der XZ-Ebene (zeigt nach -Y) mit hellen Stegen."""
    s.add(box(width, depth, height), m["plain"], at=at, rot=rot, mirror=mirror)
    pitch = height / (slots + 1)
    for k in range(slots):
        s.add(box(width * 0.9, depth * 1.4, pitch * 0.35), m["steel"],
              at=(at[0], at[1], at[2] - height / 2 + pitch * (k + 1)), rot=rot, mirror=mirror)


def greebles(s, m, region, z, count, size=(0.08, 0.25), seed=1, mats=("dark", "steel", "hull", "plain"), mirror=False):
    """Zufällige kleine Aufbauten (Kästen, Zylinder) auf einer Fläche: region = (x0, y0, x1, y1), Oberseite bei z."""
    rng = random.Random(seed)
    x0, y0, x1, y1 = region
    for _ in range(count):
        w, l = rng.uniform(*size), rng.uniform(*size)
        h = rng.uniform(size[0] * 0.4, size[0] * 1.6)
        x, y = rng.uniform(x0 + w / 2, x1 - w / 2), rng.uniform(y0 + l / 2, y1 - l / 2)
        mat = m[rng.choice(mats)]
        if rng.random() < 0.3:
            s.add(post(10, w / 2, w / 2 * 0.9, 0.0, h), mat, at=(x, y, z), mirror=mirror)
        else:
            s.add(box(w, l, h), mat, at=(x, y, z + h / 2), mirror=mirror)


def ships_collection():
    scene = bpy.context.scene
    collection = bpy.data.collections.get(COLLECTION)
    if collection is None:
        collection = bpy.data.collections.new(COLLECTION)
    if collection.name not in scene.collection.children:
        scene.collection.children.link(collection)
    return collection


def stats(obj):
    depsgraph = bpy.context.evaluated_depsgraph_get()
    mesh = obj.evaluated_get(depsgraph).data
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
        export_image_format="AUTO",
        export_image_quality=85,
        export_animations=False,
        export_lights=False,
        export_cameras=False,
    )


# ---------------------------------------------------------------- Vorschau


def preview_scene():
    """Eigene Szene mit Himmelsverlauf (für Reflexionen), drei Sonnen und einer Kamera; lässt die Nutzer-Szene in Ruhe."""
    scene = bpy.data.scenes.get("Voidfleet")
    if scene is None:
        scene = bpy.data.scenes.new("Voidfleet")
    bpy.context.window.scene = scene
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x, scene.render.resolution_y = 960, 640
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.eevee.taa_render_samples = 32
    world = bpy.data.worlds.get("VF_World") or bpy.data.worlds.new("VF_World")
    world.use_nodes = True
    nodes, links = world.node_tree.nodes, world.node_tree.links
    nodes.clear()
    out = nodes.new("ShaderNodeOutputWorld")
    background = nodes.new("ShaderNodeBackground")
    coords = nodes.new("ShaderNodeTexCoord")
    separate = nodes.new("ShaderNodeSeparateXYZ")
    ramp = nodes.new("ShaderNodeValToRGB")
    ramp.color_ramp.elements[0].position, ramp.color_ramp.elements[0].color = 0.0, (0.01, 0.012, 0.02, 1)
    ramp.color_ramp.elements[1].position, ramp.color_ramp.elements[1].color = 1.0, (0.35, 0.42, 0.55, 1)
    mid = ramp.color_ramp.elements.new(0.5)
    mid.color = (0.05, 0.06, 0.1, 1)
    links.new(coords.outputs["Generated"], separate.inputs["Vector"])
    links.new(separate.outputs["Z"], ramp.inputs["Fac"])
    links.new(ramp.outputs["Color"], background.inputs["Color"])
    links.new(background.outputs["Background"], out.inputs["Surface"])
    background.inputs["Strength"].default_value = 1.0
    scene.world = world
    ships_collection()
    for name, rotation, energy, color in (
        ("VF_Key", (50, 12, -35), 4.0, (1.0, 0.97, 0.92)),
        ("VF_Fill", (65, -20, 120), 1.5, (0.75, 0.85, 1.0)),
        ("VF_Rim", (-60, 0, 160), 2.5, (0.6, 0.75, 1.0)),
    ):
        light = bpy.data.objects.get(name)
        if light is None:
            data = bpy.data.lights.new(name, "SUN")
            light = bpy.data.objects.new(name, data)
            scene.collection.objects.link(light)
        light.data.energy = energy
        light.data.color = color
        light.data.angle = math.radians(6)
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
    "game": Vector((0.3, 0.9, 1.0)),
    "game_front": Vector((-0.3, -0.9, 1.0)),
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
