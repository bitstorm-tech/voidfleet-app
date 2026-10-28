"""Vorschau der Schiffe im Clean-Toon-Look (Cycles, headless), generisch aus den Material-Extras (`vf`) jedes Schiffs.

    <blender> -b --factory-startup -P client/tools/ships/preview.py -- [ids...] [--views board,zoom,hero,wreck] [--sheet]

<blender> wie in build.py. Ohne Ids alle Schiffe aus fleet.IDS, ohne --views nur `board`. Gebaut wird direkt aus den
Modulen (kein GLB nötig). Ausgabe: client/tools/ships/renders/<id>/<ansicht>.png (nicht im Repo). `--sheet` legt danach
die vorhandenen Bilder der Ids je Ansicht zu einem Kontaktbogen zusammen (renders/sheet_<ansicht>.png, Reihenfolge
wie angegeben, fünf je Zeile, `board` auf die Bildmitte beschnitten); `--sheet-only` tut nur das.

Ansichten (Kamera und Ausschnitt wie beim Stilvergleich, damit Neubauten vergleichbar bleiben):
    board       640x400   Blick wie im Spiel (eigene Seite, schräg von oben) auf dem Slot-Pad vor dem Spielhintergrund,
                          fester Maßstab wie im Spiel: die Iron Dreadnought ~200 px breit, kleinere Schiffe kleiner,
                          Flaggschiffe um den Faktor 1,1 größer. Hier wird geprüft, was erkennbar bleibt.
    zoom        960x600   dieselbe Richtung, Schiff ~640 px breit
    behind      640x900   von hinten oben wie die zweite Spielkamera (etwa 50° geneigt), Schiff füllt das Bild: Wappen und
                          Aufbauten, die von der Seite verdeckt bleiben
    enemy       640x400   wie `board`, aber als Gegner: Schiff um 180° gedreht, das Licht wie im Spiel je Seite gespiegelt
    enemy_zoom  960x600   (also auch von vorn); dasselbe herangezoomt, zeigt die Steuerbordseite
    hero        736x1024  Kartenvorlage: Dreiviertelansicht von schräg unten auf dunklem Grund, Schiff füllt die Breite;
                          Schiffe mit dem Kennzeichen oben von schräg oben mit eigenem Licht (look.HERO_SHIPS)
    wreck       960x600   Explosionszeichnung des Wracks (wreck.py) auf dunklem Grund, Bruchflächen glühend
Licht, Stufen, Linien und Glühen je Ansicht stehen in look.py, die Farben in palette.py. Der Spielhintergrund
(assets/images/match_screen_background.png) wird vor jedem Render neu von der Platte gelesen.

Umgebung: VF_SAMPLES (Samples je Pixel, Standard 24; für Kartenvorlagen gern 64), VF_THREADS (Render-Threads,
Standard 2, weil mehrere Agents gleichzeitig rendern). Ein `board` rendert damit in etwa 3 s, samt Blender-Start und
Bau des Schiffs etwa 4 s; `zoom`, `hero` und `wreck` je 4-8 s.
"""

import math
import os
import sys
import time

ROOT = os.path.dirname(os.path.abspath(__file__))
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)

import bmesh  # noqa: E402
import bpy  # noqa: E402
import numpy as np  # noqa: E402
from bpy_extras.object_utils import world_to_camera_view  # noqa: E402
from mathutils import Quaternion, Vector  # noqa: E402

import fleet  # noqa: E402
import look  # noqa: E402
import palette  # noqa: E402
import vf  # noqa: E402
import wreck  # noqa: E402

BACKGROUND = os.path.normpath(os.path.join(ROOT, "..", "..", "assets", "images", "match_screen_background.png"))
OUT_DIR = os.path.join(ROOT, "renders")

# Kamerarichtungen (vom Schiff zur Kamera, Schiffskoordinaten). Brett: Breitseite der eigenen Seite (Backbord, -X)
# schräg von oben, die Nase zeigt im Bild nach rechts. Die Karte (`hero`) steht in look.py: von vorn links und leicht
# von unten, bei einigen Schiffen von vorn oben (look.HERO_SHIPS). Das Brett hat einen
# festen Abstand (50 mm): Bei 40,21 ist die Iron Dreadnought wie im Stilvergleich 200 px breit, etwa 22 px je Einheit.
BOARD_DIR = (-0.79, -0.11, 0.6)
ENEMY_DIR = (0.79, 0.11, 0.6)  # Gegner: um 180° gedreht, die Kamera sieht seine Steuerbordseite
BEHIND_DIR = (0.0, 0.64, 0.77)  # zweite Spielkamera: hinter der eigenen Seite, etwa 50° über dem Brett
WRECK_DIR = (-0.85, -1.0, 0.6)
BOARD_DISTANCE = 40.21
VIEWS = {
    "board": {"res": (640, 400), "dir": BOARD_DIR, "distance": BOARD_DISTANCE, "pad": True, "background": "game", "crop": (440, 300)},
    "zoom": {"res": (960, 600), "dir": BOARD_DIR, "width_px": 640, "pad": True, "background": "game"},
    "behind": {"res": (640, 900), "dir": BEHIND_DIR, "fill": 0.86, "pad": True, "background": "game"},
    "enemy": {"res": (640, 400), "dir": ENEMY_DIR, "distance": BOARD_DISTANCE, "pad": True, "background": "game", "crop": (440, 300)},
    "enemy_zoom": {"res": (960, 600), "dir": ENEMY_DIR, "width_px": 640, "pad": True, "background": "game"},
    "hero": {"res": (736, 1024), "dir": look.HERO_DIR, "fill": 0.92, "lens": 35, "pad": False, "background": "dark"},
    "wreck": {"res": (960, 600), "dir": WRECK_DIR, "fill": 0.85, "pad": False, "background": "dark"},
}
SPREAD = 0.6  # Explosionszeichnung: jedes Stück um diesen Anteil seines Abstands zur Mitte nach außen
DARK_BACKGROUND = "#161929"
# Slot-Pad aus slotPad.ts (2,5 x 1,7 Babylon-Einheiten) geteilt durch BOARD_SCALE x MODEL_SCALE = 0,3, Oberkante auf
# vf.slot; Farben von Oberseite und Seiten wie das beleuchtete Pad des Stilvergleichs
PAD_SIZE = (1.7 / 0.3, 2.5 / 0.3, 0.08 / 0.3)
PAD_TONES = ("#4c6ea6", "#426198")

LIT = []  # Knotenbäume, deren Licht- und Kantenlichtrichtung je Ansicht nachgestellt wird


# ---------------------------------------------------------------- Knoten-Helfer


def _math(nodes, links, op, a, b=None):
    node = nodes.new("ShaderNodeMath")
    node.operation = op
    for i, v in enumerate((a, b)):
        if v is None:
            continue
        if isinstance(v, (int, float)):
            node.inputs[i].default_value = v
        else:
            links.new(v, node.inputs[i])
    return node.outputs[0]


def _vmath(nodes, links, op, a, b=None, c=None, name=None):
    node = nodes.new("ShaderNodeVectorMath")
    node.operation = op
    if name:
        node.name = name
    for i, v in enumerate((a, b, c)):
        if v is None:
            continue
        if isinstance(v, (tuple, Vector)):
            node.inputs[i].default_value = tuple(v)
        else:
            links.new(v, node.inputs[i])
    return node.outputs["Value" if op == "DOT_PRODUCT" else "Vector"]


def _mix(nodes, links, factor, a, b):
    """Farbmischung; a und b sind Sockel oder sRGB-Hex."""
    node = nodes.new("ShaderNodeMix")
    node.data_type = "RGBA"
    links.new(factor, node.inputs["Factor"])
    for identifier, v in (("A_Color", a), ("B_Color", b)):
        socket = vf._socket(node.inputs, identifier)
        if isinstance(v, str):
            socket.default_value = (*palette.linear(v), 1.0)
        else:
            links.new(v, socket)
    return vf._socket(node.outputs, "Result_Color")


def _shadow(nodes, links, geo, normal):
    """1 im Licht, 0 im Schlagschatten: Strahl vom angehobenen Punkt zum Hauptlicht."""
    start = _vmath(nodes, links, "MULTIPLY_ADD", normal, (look.SHADOW_BIAS,) * 3, geo.outputs["Position"])
    ray = nodes.new("ShaderNodeRaycast")
    ray.name = "Key Ray"
    links.new(start, ray.inputs["Position"])
    ray.inputs["Length"].default_value = look.SHADOW_DISTANCE
    return _math(nodes, links, "SUBTRACT", 1.0, ray.outputs["Is Hit"])


def _toon(nodes, links, tones, round_, glint):
    """Farbe einer toon-Fläche nach look.py: Stufen auf N·L mit Schlagschatten, Kantenlicht, Saum, Glanzpunkt."""
    geo = nodes.new("ShaderNodeNewGeometry")
    normal = geo.outputs["Normal"]
    unshadowed = _shadow(nodes, links, geo, normal)
    light = _math(nodes, links, "MULTIPLY", _vmath(nodes, links, "DOT_PRODUCT", normal, (0, 0, 1), name="Key Dot"), unshadowed)
    ramp = nodes.new("ShaderNodeValToRGB")
    ramp.color_ramp.interpolation = "CONSTANT"
    elements = ramp.color_ramp.elements
    elements.remove(elements[1])
    lit, mid, shadow = (palette.linear(c) for c in tones)
    elements[0].position, elements[0].color = 0.0, (*shadow, 1.0)
    for position, color in ((look.STEPS[0], mid), (look.STEPS[1], lit)):
        elements.new(position).color = (*color, 1.0)
    links.new(light, ramp.inputs[0])
    weight = nodes.new("ShaderNodeLayerWeight")
    weight.inputs["Blend"].default_value = 0.5
    links.new(normal, weight.inputs["Normal"])
    facing = weight.outputs["Facing"]
    a, b, c = look.RIM_ROUND if round_ else look.RIM_FLAT
    rim_dot = _vmath(nodes, links, "DOT_PRODUCT", normal, (0, 0, 1), name="Rim Direction")
    rim = _math(nodes, links, "MULTIPLY", _math(nodes, links, "GREATER_THAN", rim_dot, a), _math(nodes, links, "GREATER_THAN", facing, b))
    if c < 1.0:  # nach oben zeigende Flächen ohne Kantenlicht
        up = _vmath(nodes, links, "DOT_PRODUCT", normal, (0, 0, 1))
        rim = _math(nodes, links, "MULTIPLY", rim, _math(nodes, links, "LESS_THAN", up, c))
    seam = _math(nodes, links, "MULTIPLY", _math(nodes, links, "GREATER_THAN", facing, look.SEAM_FACING),
                 _math(nodes, links, "LESS_THAN", light, look.STEPS[0]))
    rim = _math(nodes, links, "MAXIMUM", rim, _math(nodes, links, "MULTIPLY", seam, look.SEAM_MIX))
    color = _mix(nodes, links, _math(nodes, links, "MULTIPLY", rim, look.RIM_MIX), ramp.outputs["Color"], look.RIM_COLOR)
    if glint:
        half = _vmath(nodes, links, "NORMALIZE", _vmath(nodes, links, "ADD", geo.outputs["Incoming"], (0, 0, 1), name="Key Half"))
        hit = _math(nodes, links, "GREATER_THAN", _vmath(nodes, links, "DOT_PRODUCT", normal, half), look.GLINT_THRESHOLD)
        color = _mix(nodes, links, _math(nodes, links, "MULTIPLY", _math(nodes, links, "MULTIPLY", hit, unshadowed), glint), color, look.GLINT_COLOR)
    return color


def _emit(nodes, links, color, glow=None):
    """Emission Stärke 1 (Farbe als Sockel oder Hex), optional ins Glühen (AOV `glow`)."""
    emission = nodes.new("ShaderNodeEmission")
    emission.inputs["Strength"].default_value = 1.0
    if isinstance(color, str):
        emission.inputs["Color"].default_value = (*palette.linear(color), 1.0)
    else:
        links.new(color, emission.inputs["Color"])
    if glow is not None:
        aov = nodes.new("ShaderNodeOutputAOV")
        aov.aov_name = "glow"
        if isinstance(glow, str):
            aov.inputs["Color"].default_value = (*palette.linear(glow), 1.0)
        else:
            links.new(glow, aov.inputs["Color"])
    return emission.outputs["Emission"]


# ---------------------------------------------------------------- Materialien aus dem Vertrag


def shade(mat):
    """Ersetzt die Export-Knoten eines Materials durch das Toon-Shading seiner Art (vf.spec)."""
    s = vf.spec(mat)
    nodes, links = mat.node_tree.nodes, mat.node_tree.links
    nodes.clear()
    out = nodes.new("ShaderNodeOutputMaterial")
    kind = s["kind"]
    if kind == "toon":
        surface = _emit(nodes, links, _toon(nodes, links, s["tones"], s["round"], s["glint"]))
    elif kind == "wreck":
        heat = nodes.new("ShaderNodeTexImage")
        heat.image = wreck.heat_image()
        glow = _mix(nodes, links, heat.outputs["Color"], "#000000", s["heat"])
        add = nodes.new("ShaderNodeMix")
        add.data_type, add.blend_type = "RGBA", "ADD"
        add.inputs["Factor"].default_value = 1.0
        links.new(_toon(nodes, links, s["tones"], False, 0.0), vf._socket(add.inputs, "A_Color"))
        links.new(glow, vf._socket(add.inputs, "B_Color"))
        surface = _emit(nodes, links, vf._socket(add.outputs, "Result_Color"), glow)
    elif kind == "light":
        surface = _emit(nodes, links, s["color"], s["color"] if s["glow"] else None)
    elif kind == "hologram":
        mix = nodes.new("ShaderNodeMixShader")
        mix.inputs[0].default_value = s["alpha"]
        links.new(nodes.new("ShaderNodeBsdfTransparent").outputs["BSDF"], mix.inputs[1])
        links.new(_emit(nodes, links, s["color"], s["color"] if s["glow"] else None), mix.inputs[2])
        surface = mix.outputs["Shader"]
    else:
        raise ValueError(f"{mat.name}: unbekannte Art {kind!r}")
    links.new(surface, out.inputs["Surface"])
    if "Key Ray" in nodes:
        LIT.append(nodes)


def prepare(objects):
    """Materialien der Objekte schattieren (jedes nur einmal) und Hologramm-Flächen von den Konturen ausnehmen."""
    for obj in objects:
        mats = list(obj.data.materials)
        for mat in mats:
            if not mat.get("vf_shaded"):
                shade(mat)
                mat["vf_shaded"] = True
        holo = [vf.spec(m)["kind"] == "hologram" for m in mats]
        if any(holo):
            marks = obj.data.attributes.get("freestyle_face") or obj.data.attributes.new("freestyle_face", "BOOLEAN", "FACE")
            marks.data.foreach_set("value", [holo[p.material_index] for p in obj.data.polygons])


# ---------------------------------------------------------------- Szene


def make_scene():
    for obj in list(bpy.data.objects):
        bpy.data.objects.remove(obj)
    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    scene.cycles.device = "CPU"
    scene.cycles.samples = int(os.environ.get("VF_SAMPLES", "24"))
    scene.cycles.use_denoising = False
    scene.render.threads_mode = "FIXED"
    scene.render.threads = int(os.environ.get("VF_THREADS", "2"))
    scene.render.resolution_percentage = 100
    scene.render.film_transparent = False
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGB"
    scene.view_settings.view_transform = "Standard"  # das Spiel rendert ohne Tone-Mapping
    scene.view_settings.look = "None"
    camera = bpy.data.objects.new("VF_Camera", bpy.data.cameras.new("VF_Camera"))
    scene.collection.objects.link(camera)
    scene.camera = camera
    make_world(scene)
    make_lines(scene)
    make_glow(scene)
    return scene


def make_world(scene):
    """Kamerastrahlen sehen den Spielhintergrund in Bildschirmkoordinaten oder eine dunkle Farbe (`set_background`)."""
    world = bpy.data.worlds.new("VF_Preview")
    if world.node_tree is None:
        world.use_nodes = True
    nodes, links = world.node_tree.nodes, world.node_tree.links
    nodes.clear()
    coords = nodes.new("ShaderNodeTexCoord")
    picture = nodes.new("ShaderNodeTexImage")
    picture.name = "Picture"
    picture.image = bpy.data.images.load(BACKGROUND, check_existing=False)
    picture.extension = "EXTEND"
    links.new(coords.outputs["Window"], picture.inputs["Vector"])
    choose = nodes.new("ShaderNodeMix")
    choose.name = "Choice"
    choose.data_type = "RGBA"
    links.new(picture.outputs["Color"], vf._socket(choose.inputs, "A_Color"))
    vf._socket(choose.inputs, "B_Color").default_value = (*palette.linear(DARK_BACKGROUND), 1.0)
    background = nodes.new("ShaderNodeBackground")
    links.new(vf._socket(choose.outputs, "Result_Color"), background.inputs["Color"])
    links.new(background.outputs["Background"], nodes.new("ShaderNodeOutputWorld").inputs["Surface"])
    scene.world = world


def set_background(scene, kind):
    nodes = scene.world.node_tree.nodes
    nodes["Choice"].inputs["Factor"].default_value = 0.0 if kind == "game" else 1.0
    if kind == "game":
        nodes["Picture"].image.reload()  # der 2D-Agent tauscht das Bild gerade aus


def make_lines(scene):
    """Freestyle in drei Stärken (look.LINES): Außenkontur, Silhouetten und Ränder, Kanten; nur Schiffe und Wracks."""
    scene.render.use_freestyle = True
    scene.render.line_thickness_mode = "ABSOLUTE"
    scene.render.line_thickness = 1.0
    layer = scene.view_layers[0]
    layer.use_freestyle = True
    fs = layer.freestyle_settings
    fs.mode = "EDITOR"
    fs.crease_angle = math.radians(look.CREASE_ANGLE)
    fs.use_culling = False
    fs.use_smoothness = False
    for ls in list(fs.linesets):
        fs.linesets.remove(ls)
    for name, edges in (("Contour", {"external_contour"}), ("Outer", {"silhouette", "border", "contour"}), ("Inner", {"crease"})):
        ls = fs.linesets.new(name)
        ls.select_by_visibility = True
        ls.visibility = "VISIBLE"
        ls.select_by_edge_types = True
        for key in ("silhouette", "border", "crease", "contour", "external_contour", "material_boundary", "edge_mark",
                    "suggestive_contour", "ridge_valley"):
            setattr(ls, f"select_{key}", key in edges)
        ls.select_by_collection = True
        ls.collection = vf.ships_collection()
        ls.select_by_face_marks = True  # Hologramm-Flächen tragen eine Freestyle-Marke und bekommen keine Linien
        ls.face_mark_negation = "EXCLUSIVE"
        ls.face_mark_condition = "ONE"
        style = bpy.data.linestyles.new(name)
        ls.linestyle = style
        style.color = palette.linear(look.LINE_COLOR)
        style.thickness_position = "CENTER"
        style.caps = "ROUND"
        style.chaining = "PLAIN"
        style.use_chaining = True


def make_glow(scene):
    """Glühen der Lichter wie der Glow-Layer im Spiel: AOV `glow` zweimal weichzeichnen und aufaddieren."""
    layer = scene.view_layers[0]
    aov = layer.aovs.add()
    aov.name, aov.type = "glow", "COLOR"
    tree = bpy.data.node_groups.new("VF_Glow", "CompositorNodeTree")
    tree.interface.new_socket("Image", in_out="OUTPUT", socket_type="NodeSocketColor")
    scene.compositing_node_group = tree
    nodes, links = tree.nodes, tree.links
    layers = nodes.new("CompositorNodeRLayers")
    image = layers.outputs["Image"]
    for name, factor in zip(("Glow Near", "Glow Far"), look.GLOW_MIX):
        blur = nodes.new("CompositorNodeBlur")
        blur.name = name
        links.new(layers.outputs["glow"], blur.inputs["Image"])
        add = nodes.new("ShaderNodeMix")
        add.data_type, add.blend_type = "RGBA", "ADD"
        add.inputs["Factor"].default_value = factor
        links.new(image, vf._socket(add.inputs, "A_Color"))
        links.new(blur.outputs["Image"], vf._socket(add.inputs, "B_Color"))
        image = vf._socket(add.outputs, "Result_Color")
    links.new(image, nodes.new("NodeGroupOutput").inputs[0])


def make_pad(ship, scale):
    """Slot-Pad unter dem Schiff (bei Flaggschiffen um ihren Faktor `scale` kleiner, Oberkante auf vf.slot): flache
    Oberseite, dunklere Seiten, ohne Linien."""
    corners = [ship.matrix_world @ Vector(c) for c in ship.bound_box]
    cx = (min(c.x for c in corners) + max(c.x for c in corners)) / 2
    cy = (min(c.y for c in corners) + max(c.y for c in corners)) / 2
    size = [d / scale for d in PAD_SIZE]
    bm = vf.box(*size)
    mesh = bpy.data.meshes.new("VF_Pad")
    bm.to_mesh(mesh)
    bm.free()
    pad = bpy.data.objects.new("VF_Pad", mesh)
    bpy.context.scene.collection.objects.link(pad)
    pad.location = (cx, cy, vf.slot(ship.name) - size[2] / 2)
    mat = bpy.data.materials.get("VF_Pad") or bpy.data.materials.new("VF_Pad")
    nodes, links = mat.node_tree.nodes, mat.node_tree.links
    nodes.clear()
    separate = nodes.new("ShaderNodeSeparateXYZ")
    links.new(nodes.new("ShaderNodeNewGeometry").outputs["Normal"], separate.inputs["Vector"])
    up = _math(nodes, links, "GREATER_THAN", separate.outputs["Z"], 0.5)
    color = _mix(nodes, links, up, PAD_TONES[1], PAD_TONES[0])
    links.new(_emit(nodes, links, color), nodes.new("ShaderNodeOutputMaterial").inputs["Surface"])
    mesh.materials.append(mat)
    return pad


def remove(objects):
    for obj in objects:
        mesh = obj.data
        bpy.data.objects.remove(obj)
        if mesh and mesh.users == 0:
            bpy.data.meshes.remove(mesh)


# ---------------------------------------------------------------- Ansichten


def _hull(objects):
    """Eckpunkte der konvexen Hülle aller Objekte in Weltkoordinaten: Nur sie können im Bild außen liegen, auch dünne
    Spitzen (eine Stichprobe der Eckpunkte verfehlt sie), und es sind wenige."""
    bm = bmesh.new()
    for o in objects:
        for v in o.data.vertices:
            bm.verts.new(o.matrix_world @ v.co)
    everything = [v.co.copy() for v in bm.verts]
    hull = bmesh.ops.convex_hull(bm, input=bm.verts[:])
    points = [v.co.copy() for v in hull["geom"] if isinstance(v, bmesh.types.BMVert)]
    bm.free()
    return points if len(points) >= 4 else everything


def frame(scene, objects, spec, scale=1.0):
    """Kamera aus spec["dir"] auf die Mitte der Objekte richten und per Shift zentrieren: fester Abstand `distance`
    (geteilt durch den Faktor `scale` der Flaggschiffe) oder der Abstand, bei dem die Breite im Bild `width_px` ist bzw.
    das Bild zu `fill` gefüllt ist. Der wird halbiert statt geschätzt: Lange Schiffe, die zur Kamera zeigen, sind
    perspektivisch so verzerrt, dass eine Schätzung über das Größenverhältnis hin und her springt."""
    res = spec["res"]
    scene.render.resolution_x, scene.render.resolution_y = res
    camera = scene.camera
    camera.data.lens = spec.get("lens", 50)
    camera.data.shift_x = camera.data.shift_y = 0.0
    direction = Vector(spec["dir"]).normalized()
    points = _hull(objects)
    center = (Vector([min(p[i] for p in points) for i in range(3)]) + Vector([max(p[i] for p in points) for i in range(3)])) / 2

    def project(distance):
        camera.location = center + direction * distance
        # `roll` dreht die Kamera um ihre Blickachse (Grad, positiv gegen den Uhrzeigersinn im Bild gesehen: das Bild
        # dreht sich im Uhrzeigersinn), etwa um ein langes Schiff diagonal ins Hochformat zu legen
        aim = (-direction).to_track_quat("-Z", "Y") @ Quaternion((0, 0, 1), math.radians(spec.get("roll", 0.0)))
        camera.rotation_euler = aim.to_euler()
        bpy.context.view_layer.update()
        projected = [world_to_camera_view(scene, camera, p) for p in points]
        return [q.x for q in projected], [q.y for q in projected]

    def too_big(distance):
        xs, ys = project(distance)
        width, height = (max(xs) - min(xs)) * res[0], (max(ys) - min(ys)) * res[1]
        if "width_px" in spec:
            return width > spec["width_px"]
        return width > spec["fill"] * res[0] or height > spec["fill"] * res[1]

    if "distance" in spec:
        distance = spec["distance"] / scale
    else:
        # Kamera außerhalb der Hüllkugel, damit alle Punkte vor ihr liegen; dann den Abstand einschachteln
        near = max((p - center).length for p in points) * 1.01
        far = near * 8
        while too_big(far):
            far *= 2
        for _ in range(32):
            middle = math.sqrt(near * far)
            near, far = (middle, far) if too_big(middle) else (near, middle)
        distance = far
    xs, ys = project(distance)
    larger = max(res)
    camera.data.shift_x = ((max(xs) + min(xs)) / 2 - 0.5) * res[0] / larger
    camera.data.shift_y = ((max(ys) + min(ys)) / 2 - 0.5) * res[1] / larger


def set_view(scene, name, spec, collection):
    """Hauptlicht (`spec["key"]` oder look.KEY), Kantenlicht, Linienstärken, Glühradien und Hintergrund der Ansicht `name`."""
    key = tuple(Vector(spec.get("key", look.KEY[name])).normalized())
    back = tuple((-Vector(spec["dir"]).normalized() + Vector((0.0, 0.0, look.RIM_UP))).normalized())
    for nodes in LIT:
        nodes["Key Ray"].inputs["Direction"].default_value = key
        for node_name, value in (("Key Dot", key), ("Key Half", key), ("Rim Direction", back)):
            if node_name in nodes:
                nodes[node_name].inputs[1].default_value = value
    fs = scene.view_layers[0].freestyle_settings
    for ls, thickness in zip(fs.linesets, look.LINES[name]):
        ls.linestyle.thickness = thickness
        ls.collection = collection
    nodes = scene.compositing_node_group.nodes
    for node_name, size in zip(("Glow Near", "Glow Far"), look.GLOW[name]):
        nodes[node_name].inputs["Size"].default_value = (size, size)
    set_background(scene, spec["background"])


def render(scene, path):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    scene.render.filepath = path
    started = time.time()
    bpy.ops.render.render(write_still=True)
    print(f"Vorschau {os.path.relpath(path, ROOT)} ({time.time() - started:.1f} s)", flush=True)


def preview(scene, ship_id, views):
    ship = fleet.build(ship_id)
    prepare([ship])
    scale = vf.FLAGSHIP_SCALE if ship_id in palette.FLAGSHIPS else 1.0
    pad = make_pad(ship, scale)
    # Reine Hologramme haben keine Linien; Freestyle meldete sonst "strokes set empty"
    scene.render.use_freestyle = not all(vf.spec(m)["kind"] == "hologram" for m in ship.data.materials)
    for name in views:
        spec = {**VIEWS[name], **look.HERO_SHIPS.get(ship_id, {})} if name == "hero" else VIEWS[name]
        if name == "wreck":
            pieces = wreck.build(ship)
            prepare(pieces)
            ship.hide_render = pad.hide_render = True
            center = sum((p.location for p in pieces), Vector()) / len(pieces)
            for p in pieces:
                p.location += (p.location - center) * SPREAD
            bpy.context.view_layer.update()
            set_view(scene, name, spec, wreck.wrecks_collection())
            frame(scene, pieces, spec)
            render(scene, os.path.join(OUT_DIR, ship_id, f"{name}.png"))
            remove(pieces)
            ship.hide_render = False
            continue
        pad.hide_render = not spec["pad"]
        set_view(scene, name, spec, vf.ships_collection())
        frame(scene, [ship], spec, scale)
        render(scene, os.path.join(OUT_DIR, ship_id, f"{name}.png"))
    remove([ship, pad])


# ---------------------------------------------------------------- Kontaktbogen


def sheet(ids, view, columns=5):
    """Die vorhandenen Bilder `renders/<id>/<view>.png` als Raster (Reihenfolge wie `ids`), `board` auf die Mitte beschnitten."""
    tiles = []
    for ship_id in ids:
        path = os.path.join(OUT_DIR, ship_id, f"{view}.png")
        if not os.path.exists(path):
            continue
        image = bpy.data.images.load(path, check_existing=False)
        w, h = image.size
        pixels = np.array(image.pixels[:], dtype=np.float32).reshape(h, w, 4)
        bpy.data.images.remove(image)
        cw, ch = VIEWS[view].get("crop", (w, h))
        x0, y0 = (w - cw) // 2, (h - ch) // 2
        tiles.append(pixels[y0:y0 + ch, x0:x0 + cw])
    if not tiles:
        return None
    th, tw = tiles[0].shape[:2]
    rows = (len(tiles) + columns - 1) // columns
    canvas = np.zeros((rows * th, min(columns, len(tiles)) * tw, 4), dtype=np.float32)
    canvas[..., 3] = 1.0
    for k, tile in enumerate(tiles):
        r, c = divmod(k, columns)
        y = (rows - 1 - r) * th  # Blender-Bilder beginnen unten
        canvas[y:y + th, c * tw:(c + 1) * tw] = tile
    out = bpy.data.images.new(f"sheet_{view}", canvas.shape[1], canvas.shape[0])
    out.pixels.foreach_set(canvas.ravel())
    path = os.path.join(OUT_DIR, f"sheet_{view}.png")
    out.filepath_raw = path
    out.file_format = "PNG"
    out.save()
    print(f"Kontaktbogen {os.path.relpath(path, ROOT)}: {', '.join(i for i in ids if os.path.exists(os.path.join(OUT_DIR, i, f'{view}.png')))}")
    return path


def main():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    views = ["board"]
    if "--views" in argv:
        k = argv.index("--views")
        views = argv[k + 1].split(",")
        argv = argv[:k] + argv[k + 2:]
    flags = {a for a in argv if a.startswith("--")}
    ids = [a for a in argv if not a.startswith("--")] or list(fleet.IDS)
    unknown = [v for v in views if v not in VIEWS] + [i for i in ids if i not in fleet.SHIPS]
    if unknown:
        raise SystemExit(f"Unbekannt: {', '.join(unknown)} (Ansichten: {', '.join(VIEWS)}; Schiffe: {', '.join(fleet.IDS)})")
    if "--sheet-only" not in flags:
        scene = make_scene()
        for ship_id in ids:
            preview(scene, ship_id, views)
    if flags & {"--sheet", "--sheet-only"}:
        for view in views:
            sheet(ids, view)


if __name__ == "__main__":
    main()
