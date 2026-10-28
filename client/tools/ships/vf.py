"""Bausteine für die Schiffe von Voidfleet in Blender (bpy/bmesh), Stil „Clean Toon“.

Konventionen (Blender-Koordinaten): Die Nase zeigt nach -Y, oben ist +Z, Steuerbord ist +X. Nach dem glTF-Export
(Y-up) zeigt die Nase in Babylon nach +Z, wie `client/src/scene/ship.ts` es erwartet. Jedes Schiff ist ein einziges
Mesh aus geschlossenen, sich überlappenden Primitiven (`Ship.add`), ohne Bevel, ohne UVs, ohne Texturen. Auf dem Brett
liegt der Slot bei Blender-z −1,4, bei Flaggschiffen wegen ihres Faktors 1,1 bei −1,27 (`slot`): Kein Teil darf darunter,
sonst `Ship.lift`. Teile ohne Berührung zum übrigen Schiff findet `loose_parts`; `build.py` meldet beides.

Normalen: Flächen eckiger Materialien sind flach (Flächennormale, ein Ton je Facette), Flächen runder Materialien und
der Lichter geglättet, wobei Kanten über 38° hart bleiben (`SHARP_ANGLE`). Rund oder eckig ist also eine Eigenschaft
des Materials: Rohre, Türme, Düsen und Barbetten bekommen die `_round`-Variante bzw. `steel`, alles Kantige die eckige.

Material-Vertrag mit dem Spiel
------------------------------
Jedes Material trägt seine Art und seine Farben als Custom Property `vf`. Der Export (`export_extras=True`) schreibt sie
nach `materials[i].extras.vf`, Babylon liefert sie als `material.metadata.gltf.extras.vf` (Loader-Erweiterung
`ExtrasAsMetadata`, die `registerBuiltInLoaders()` immer aktiviert; Klone behalten `metadata`). Farben in `vf` sind
sRGB-Hex "#rrggbb" (wie `client/src/data/palette.ts`), die glTF-Faktoren daneben linear (glTF-Norm). Vier Arten:

  {"kind": "toon", "tones": [Licht, Halbschatten, Schatten], "round": bool, "glint": float}
      Gestufte Fläche. `round`: geglättete Normalen und das schmalere Kantenlicht runder Teile; `glint`: Deckkraft des
      harten Glanzpunkts (0 = keiner). glTF: baseColorFactor = Licht-Ton, metallicFactor 0, roughnessFactor 1
      (Vorgabe, fehlt im JSON), keine Texturen. Auch die Zierlinie der Flaggschiffe `<id>_trim` (Goldtöne).
  {"kind": "light", "color": Farbe, "glow": bool}
      Unbeleuchtet in genau dieser Farbe: Düsen, Fenster, Emitter, Positionslichter (`glow`: true = glüht im Spiel) und
      die Kennzeichen der Flaggschiffe `<id>_signal` in der UI-Farbe des Admirals (`glow`: false).
      glTF: baseColorFactor schwarz, emissiveFactor = Farbe (Stärke 1).
  {"kind": "hologram", "color": Farbe, "alpha": float, "glow": bool}
      Durchscheinend und emissiv (das Trugbild), ohne Konturen. glTF: alphaMode BLEND, doubleSided (als einzige Art),
      baseColorFactor schwarz mit `alpha`, emissiveFactor = Farbe.
  {"kind": "wreck", "tones": [Licht, Halbschatten, Schatten], "heat": Farbe}
      Bruchflächen der Wracks (`<id>_wreck`, nur in `<id>_wreck.glb`, siehe wreck.py): verkohlte Töne wie ein eckiges
      toon-Material, dazu Glut. glTF: baseColorFactor = Licht-Ton, emissiveFactor = `heat`, emissiveTexture = Glutmuster
      (Graustufen, kachelbar); nur die Primitive dieses Materials tragen TEXCOORD_0.

Aufbau: `<id>.glb` ist ein Knoten mit einem Mesh, je Material ein Primitive (POSITION, NORMAL, Indizes); `<id>_wreck.glb`
hat je Bruchstück einen Knoten (Ursprung im Schwerpunkt), seine Primitive mit dem Wrack-Material tragen zusätzlich
TEXCOORD_0. Materialien heißen `<id>_<schlüssel>` (siehe `materials`), keine glTF-Erweiterungen. Nur Hologramme sind
doubleSided, alle anderen einseitig: Jede Hülle ist geschlossen und nach außen orientiert, auch gespiegelte Teile und die
Bruchflächen der Wracks (`bad_shells`, build.py meldet Verstöße).

Farben und Töne stehen in palette.py, Licht, Linien und Glühen der Vorschau (Vorlage fürs Spiel) in look.py.
"""

import json
import math
import random
import struct

import bmesh
import bpy
from mathutils import Euler, Matrix, Vector
from mathutils.bvhtree import BVHTree

import palette

COLLECTION = "VF_Ships"
SHARP_ANGLE = math.radians(38)
FLOOR = -1.4  # Oberkante des Slots im Modellraum (ship.ts: -SHIP_ANCHOR_HEIGHT / BOARD_SCALE / MODEL_SCALE)
FLAGSHIP_SCALE = 1.1  # ship.ts vergrößert Flaggschiffe; ihr Slot liegt deshalb bei FLOOR / FLAGSHIP_SCALE = -1,27
GLINT = 0.6  # Glanzpunkt auf Türmen, Rohren und Glas

# ---------------------------------------------------------------- Materialien


def _socket(sockets, identifier):
    return next(s for s in sockets if s.identifier == identifier)


def surface(name, spec, base, emission=None, alpha=1.0):
    """Material mit glTF-tauglichem Principled BSDF (metallic 0, roughness 1) und dem Vertrag `spec` als Custom
    Property `vf`. `base` und `emission` sind sRGB-Hex. Die Vorschau ersetzt die Knoten durch das Toon-Shading."""
    mat = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    nodes, links = mat.node_tree.nodes, mat.node_tree.links
    nodes.clear()
    out = nodes.new("ShaderNodeOutputMaterial")
    bsdf = nodes.new("ShaderNodeBsdfPrincipled")
    links.new(bsdf.outputs["BSDF"], out.inputs["Surface"])
    bsdf.inputs["Base Color"].default_value = (*palette.linear(base), 1.0)
    bsdf.inputs["Metallic"].default_value = 0.0
    bsdf.inputs["Roughness"].default_value = 1.0
    if emission:
        bsdf.inputs["Emission Color"].default_value = (*palette.linear(emission), 1.0)
        bsdf.inputs["Emission Strength"].default_value = 1.0
    if alpha < 1.0:
        bsdf.inputs["Alpha"].default_value = alpha
        mat.surface_render_method = "BLENDED"
    # Einseitig (glTF doubleSided false), nur Hologramme beidseitig: Die Hüllen sind geschlossen und nach außen
    # orientiert (bad_shells), das Spiel spart so die Rückseiten
    mat.use_backface_culling = spec["kind"] != "hologram"
    mat["vf"] = spec
    mat.diffuse_color = (*palette.linear(emission or base), 1.0)
    return mat


def toon(name, tones, round=False, glint=0.0):
    """Gestufte Fläche; `tones` ist der Licht-Ton (die anderen leitet palette.tones ab) oder ein Tripel."""
    t = palette.tones(tones)
    return surface(name, {"kind": "toon", "tones": list(t), "round": round, "glint": glint}, t[0])


def light(name, color, glow=True):
    """Unbeleuchtete Fläche in genau `color`; `glow` sagt dem Spiel, dass sie glühen soll."""
    return surface(name, {"kind": "light", "color": color, "glow": glow}, "#000000", emission=color)


def hologram(name, color, alpha, glow=False):
    """Durchscheinende, leuchtende Fläche eines Hologramms (konstantes Alpha, beidseitig)."""
    return surface(name, {"kind": "hologram", "color": color, "alpha": alpha, "glow": glow}, "#000000", emission=color, alpha=alpha)


def spec(mat):
    """Der Vertrag eines Materials als dict (siehe Docstring)."""
    return mat["vf"].to_dict()


def smooth_normals(mat):
    """Geglättete Normalen: runde toon-Materialien und Lichter; eckige, Hologramme und Bruchflächen sind flach."""
    s = mat["vf"]
    return s["kind"] == "light" or (s["kind"] == "toon" and bool(s["round"]))


def materials(ship, ship_class):
    """Standardsatz eines Schiffs, Namen `<ship>_<key>`: eckig `hull`, `armor`, `dark`, `accent`; rund `hull_round`,
    `armor_round`, `dark_round`, `accent_round` (Türme), `steel` (Rohre), `glass` (Kanzeln); Lichter `glow` (Lichtbänder,
    Leuchtfeuer), `core` (Brennkammer), `window`. Rumpf, Panzerung, Akzent und Lichtfarbe kommen aus der Klasse
    (palette.CLASSES). Flaggschiffe
    (palette.FLAGSHIPS) nehmen Akzent und Lichter ihres Admirals und bekommen dazu `signal` (Kennzeichen in der
    UI-Farbe) und `trim` (Zierlinie). Weitere Materialien legt das Schiff selbst an (`toon`, `light`)."""
    admiral = palette.FLAGSHIPS.get(ship)
    look = palette.CLASSES[ship_class]
    accent = palette.ADMIRAL_ACCENT[admiral] if admiral else look["accent"]
    glow = palette.ADMIRALS[admiral] if admiral else look["glow"]
    core = palette.pale(glow) if admiral else look["core"]
    m = {
        "hull": toon(f"{ship}_hull", look["hull"]),
        "armor": toon(f"{ship}_armor", look["armor"]),
        "dark": toon(f"{ship}_dark", palette.DARK),
        "accent": toon(f"{ship}_accent", accent),
        "hull_round": toon(f"{ship}_hull_round", look["hull"], round=True),
        "armor_round": toon(f"{ship}_armor_round", look["armor"], round=True),
        "dark_round": toon(f"{ship}_dark_round", palette.DARK, round=True),
        "accent_round": toon(f"{ship}_accent_round", accent, round=True, glint=GLINT),
        "steel": toon(f"{ship}_steel", palette.STEEL, round=True, glint=GLINT),
        "glass": toon(f"{ship}_glass", palette.GLASS, round=True, glint=GLINT),
        "glow": light(f"{ship}_glow", glow),
        "core": light(f"{ship}_core", core),
        "window": light(f"{ship}_window", palette.WINDOW),
    }
    if admiral:
        m["signal"] = light(f"{ship}_signal", palette.ADMIRALS[admiral], glow=False)
        m["trim"] = toon(f"{ship}_trim", palette.TRIM)
    return m


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


def facet(w, h, top=0.36, low=0.5, drop=0.6):
    """Facettierter Tarnkappen-Querschnitt: scharfe Kimmkanten an den Seiten, schmaler flacher Grat oben, flacher Boden."""
    return [(w / 2, 0.0), (w * top / 2, h / 2), (-w * top / 2, h / 2), (-w / 2, 0.0), (-w * low / 2, -h / 2 * drop), (w * low / 2, -h / 2 * drop)]


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


def grow(points, d):
    """Konvexes Polygon (x, y) um d nach außen versetzt."""
    n = len(points)
    sign = 1 if sum(points[i][0] * points[(i + 1) % n][1] - points[(i + 1) % n][0] * points[i][1] for i in range(n)) > 0 else -1
    out = []
    for i in range(n):
        p0, p1, p2 = Vector(points[i - 1]), Vector(points[i]), Vector(points[(i + 1) % n])
        e1, e2 = (p1 - p0).normalized(), (p2 - p1).normalized()
        n1, n2 = Vector((e1.y, -e1.x)) * sign, Vector((e2.y, -e2.x)) * sign
        b = (n1 + n2).normalized()
        out.append(tuple(p1 + b * d / max(b.dot(n1), 0.3)))
    return out


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


def flank(rings, z, dx=0.03, at=(0, 0, 0)):
    """Punkte auf der Steuerbord-Flanke eines Lofts (Ringe wie aus `smooth`) in Höhe z, um dx nach außen versetzt:
    die Bahn einer Zierlinie, die dem Rumpf folgt; `at` ist der Versatz, mit dem der Rumpf eingefügt wurde."""
    ox, oy, oz = at
    out = []
    for ring in rings:
        if not isinstance(ring, list):
            continue
        hits = [a.lerp(b, (z - oz - a.z) / (b.z - a.z)) for a, b in zip(ring, ring[1:] + ring[:1])
                if (a.z - z + oz) * (b.z - z + oz) <= 0 and a.z != b.z]
        hits = [p for p in hits if p.x > 0]
        if hits:
            p = max(hits, key=lambda p: p.x)
            out.append((p.x + ox + dx, p.y + oy, z))
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
    """Quader mit gerundeten (bei segments=1 gefasten) Kanten."""
    bm = box(sx, sy, sz)
    bmesh.ops.bevel(bm, geom=bm.edges[:] + bm.verts[:], offset=min(r, sx / 2.2, sy / 2.2, sz / 2.2), segments=segments,
                    profile=0.5, affect="EDGES", clamp_overlap=True)
    return _finish(bm)


def wedge(w, l, h, front=0.35, taper=0.85):
    """Kastiger Aufbau mit schräger Front: Querschnitte entlang Y, vorn niedriger und schmaler (Brücken, Decksblöcke)."""
    return loft([sec(-l / 2, rect(w * taper, h * 0.55), dz=-h * 0.225), sec(-l / 2 + l * front, rect(w, h)), sec(l / 2, rect(w, h))])


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


def slab(outline, thickness, bend=0.0):
    """Gewölbte Platte quer zur Längsachse: Umriss (x, z) ab y = 0 nach hinten, die Seiten um bend·x² zurückgezogen."""
    return loft([[Vector((x, d + bend * x * x, z)) for x, z in outline] for d in (0.0, thickness)])


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


def crystal(r, h):
    """Doppelpyramide (Emitterkristall) um den Ursprung, Spitzen in ±z."""
    return loft([Vector((0, 0, -h)), [Vector((r * math.cos(a), r * math.sin(a), 0)) for a in (k * math.pi / 2 for k in range(4))], Vector((0, 0, h))])


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
    return _canonical(bm)


def _canonical(bm):
    """Dieselbe Form in fester Reihenfolge: Eckpunkte nach Lage sortiert, jede Fläche beginnt an ihrem kleinsten Eckpunkt.
    bmesh.ops.solidify ordnet die Flächen je Lauf anders an, und der Export trianguliert Vierecke ab dem ersten Eckpunkt;
    ohne das wäre das GLB bei jedem Bau ein anderes."""
    out = bmesh.new()
    verts = {co: out.verts.new(co) for co in sorted(tuple(v.co) for v in bm.verts)}
    faces = []
    for f in bm.faces:
        corners = [tuple(v.co) for v in f.verts]
        k = corners.index(min(corners))
        faces.append(corners[k:] + corners[:k])
    for corners in sorted(faces):
        _face(out, [verts[c] for c in corners])
    bm.free()
    return _finish(out)


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

    def lift(self, dz):
        """Hebt das ganze Schiff an, damit sein tiefster Punkt über dem Slot bleibt (`slot`)."""
        bmesh.ops.translate(self.bm, verts=self.bm.verts, vec=(0, 0, dz))
        return self

    def finish(self):
        """Normalen nach Material (flach bzw. geglättet mit harten Kanten ab SHARP_ANGLE), Objekt in COLLECTION;
        ersetzt ein gleichnamiges und warnt, wenn ein Teil unter den Slot ragt."""
        bm = self.bm
        bm.normal_update()
        smooth_by_index = [smooth_normals(m) for m in self.materials]
        for face in bm.faces:
            face.smooth = smooth_by_index[face.material_index]
        mark_sharp(bm)
        low, floor = min((v.co.z for v in bm.verts), default=0.0), slot(self.name)
        if low < floor - 1e-3:
            print(f"WARNUNG {self.name}: tiefster Punkt bei z = {low:.2f} liegt unter dem Slot (z = {floor:.2f}), Ship.lift benutzen")
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
        obj = bpy.data.objects.new(self.name, mesh)
        collection.objects.link(obj)
        return obj


def slot(ship):
    """Höhe der Slot-Oberkante im Modellraum des Schiffs; kein Teil darf darunter."""
    return FLOOR / FLAGSHIP_SCALE if ship in palette.FLAGSHIPS else FLOOR


def mark_sharp(bm):
    """Kanten zwischen Flächen, deren Normalen mehr als SHARP_ANGLE auseinanderliegen, werden hart."""
    for edge in bm.edges:
        faces = edge.link_faces
        edge.smooth = not (len(faces) == 2 and faces[0].normal.angle(faces[1].normal, 0.0) > SHARP_ANGLE)


def ships_collection():
    scene = bpy.context.scene
    collection = bpy.data.collections.get(COLLECTION)
    if collection is None:
        collection = bpy.data.collections.new(COLLECTION)
    if collection.name not in scene.collection.children:
        scene.collection.children.link(collection)
    return collection


# ---------------------------------------------------------------- Prüfen


def stats(obj):
    mesh = obj.data
    xs = [v.co.x for v in mesh.vertices]
    ys = [v.co.y for v in mesh.vertices]
    zs = [v.co.z for v in mesh.vertices]
    return {
        "tris": sum(len(p.vertices) - 2 for p in mesh.polygons),
        "size": [round(max(xs) - min(xs), 2), round(max(ys) - min(ys), 2), round(max(zs) - min(zs), 2)],
        "y": [round(min(ys), 2), round(max(ys), 2)],
        "z": [round(min(zs), 2), round(max(zs), 2)],
    }


def loose_parts(obj, tolerance=0.03):
    """Schwebende Teile: Gruppen geschlossener Teile, die das übrige Schiff weder berühren noch schneiden noch in ihm
    stecken; Lücken unter `tolerance` (0,03 ≈ 1 px im Zoom) gelten als Berührung. Liefert je Gruppe (Mittelpunkt, Zahl
    der Dreiecke), leer wenn alles zusammenhängt."""
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    bm.verts.ensure_lookup_table()
    bm.faces.ensure_lookup_table()
    bm.normal_update()
    island = [-1] * len(bm.verts)
    count = 0
    for start in bm.verts:
        if island[start.index] >= 0:
            continue
        island[start.index] = count
        stack = [start]
        while stack:
            for edge in stack.pop().link_edges:
                for v in edge.verts:
                    if island[v.index] < 0:
                        island[v.index] = count
                        stack.append(v)
        count += 1
    face_island = [island[f.verts[0].index] for f in bm.faces]
    parent = list(range(count))

    def root(i):
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i

    tree = BVHTree.FromBMesh(bm)
    up = Vector((0, 0, 1))
    for v in bm.verts:
        own = island[v.index]
        touching = {face_island[hit[2]] for hit in tree.find_nearest_range(v.co, tolerance)} - {own}
        if not touching:
            # Steckt der Punkt in einem anderen Teil? Der Strahl nach oben verlässt dieses dann, ohne es betreten zu haben.
            origin = v.co + up * 1e-4
            entered = set()
            for _ in range(64):
                hit, normal, index, _ = tree.ray_cast(origin, up)
                if hit is None:
                    break
                other = face_island[index]
                if other != own:
                    if normal.dot(up) < 0:
                        entered.add(other)
                    elif other in entered:
                        entered.discard(other)
                    else:
                        touching = {other}
                        break
                origin = hit + up * 1e-4
        for other in touching:
            parent[root(other)] = root(own)
    faces = [0] * count
    for i in face_island:
        faces[i] += 1
    biggest = max(range(count), key=lambda i: faces[i]) if count else 0
    # Was noch nicht am Rumpf hängt, kann ihn ohne Eckpunkt im Inneren durchstoßen (Leiste durch ein Gehäuse):
    # Dreiecke des Teils gegen alle anderen schneiden
    by_island = {}
    for f in bm.faces:
        if root(face_island[f.index]) != root(biggest):
            by_island.setdefault(face_island[f.index], []).append(f)
    for own, island_faces in by_island.items():
        verts = {v for f in island_faces for v in f.verts}
        index = {v: k for k, v in enumerate(verts)}
        part = BVHTree.FromPolygons([v.co for v in verts], [[index[v] for v in f.verts] for f in island_faces])
        for _, other in part.overlap(tree):
            if face_island[other] != own:
                parent[root(face_island[other])] = root(own)
    main = root(biggest)
    groups = {}
    for v in bm.verts:
        r = root(island[v.index])
        if r != main:
            groups.setdefault(r, []).append(v.co.copy())
    out = []
    for r, points in groups.items():
        tris = sum(len(f.verts) - 2 for f in bm.faces if root(face_island[f.index]) == r)
        out.append((sum(points, Vector()) / len(points), tris))
    bm.free()
    return out


def bad_shells(obj):
    """Teile, deren Hülle für einseitige Materialien nicht taugt: offen (Kante mit mehr oder weniger als zwei Flächen),
    uneinheitlich orientiert oder innen nach außen (negatives Volumen). Liefert je Teil (Mittelpunkt, Dreiecke, Befund);
    Teile nur aus Hologramm-Flächen zählen nicht, die sind beidseitig."""
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    hologram = {i for i, mat in enumerate(obj.data.materials) if spec(mat)["kind"] == "hologram"}
    seen, out = set(), []
    for start in bm.faces:
        if start.index in seen:
            continue
        seen.add(start.index)
        faces, stack = [], [start]
        while stack:
            face = stack.pop()
            faces.append(face)
            for edge in face.edges:
                for other in edge.link_faces:
                    if other.index not in seen:
                        seen.add(other.index)
                        stack.append(other)
        if all(f.material_index in hologram for f in faces):
            continue
        edges = {e for f in faces for e in f.edges}
        if any(len(e.link_faces) != 2 for e in edges):
            problem = "offen"
        elif not all(e.is_contiguous for e in edges):
            problem = "uneinheitlich orientiert"
        else:
            o = faces[0].verts[0].co
            volume = sum((f.verts[0].co - o).dot((f.verts[i].co - o).cross(f.verts[i + 1].co - o)) for f in faces for i in range(1, len(f.verts) - 1))
            problem = "innen nach außen" if volume < 0 else None
        if problem:
            center = sum((f.calc_center_median() for f in faces), Vector()) / len(faces)
            out.append((obj.matrix_world @ center, sum(len(f.verts) - 2 for f in faces), problem))
    bm.free()
    return out


# ---------------------------------------------------------------- Export


def export_glb(objects, path):
    """GLB mit den Material-Extras (`vf`), ohne Kameras, Lichter und Animationen."""
    bpy.ops.object.select_all(action="DESELECT")
    for obj in objects:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = objects[0]
    bpy.ops.export_scene.gltf(
        filepath=path,
        export_format="GLB",
        use_selection=True,
        use_active_scene=True,
        export_apply=True,
        export_yup=True,
        export_extras=True,
        export_image_format="AUTO",
        export_animations=False,
        export_lights=False,
        export_cameras=False,
    )
    _drop_unused_texcoords(path)


def _uses_texture(value):
    if isinstance(value, dict):
        return any(key.endswith("Texture") or _uses_texture(v) for key, v in value.items())
    return isinstance(value, list) and any(_uses_texture(v) for v in value)


def _drop_unused_texcoords(path):
    """Der Exporter schreibt die UV-Ebene eines Meshes in jedes seiner Primitive, auch in die ohne Textur; bei den Wracks
    sind das fast alle (nur die Bruchflächen tragen das Glutmuster). Entfernt dort TEXCOORD_n und packt den Binärteil
    neu; Reihenfolge und Inhalt von allem anderen bleiben."""
    with open(path, "rb") as f:
        data = f.read()
    json_length = struct.unpack_from("<I", data, 12)[0]
    gltf = json.loads(data[20:20 + json_length])
    start = 20 + json_length
    binary = data[start + 8:start + 8 + struct.unpack_from("<I", data, start)[0]]
    textured = {i for i, mat in enumerate(gltf.get("materials", [])) if _uses_texture(mat)}
    primitives = [p for mesh in gltf.get("meshes", []) for p in mesh["primitives"]]
    stale = [(p, name) for p in primitives if p.get("material") not in textured for name in p["attributes"] if name.startswith("TEXCOORD_")]
    if not stale or "animations" in gltf or "skins" in gltf:
        return
    for p, name in stale:
        del p["attributes"][name]
    used = sorted({i for p in primitives for i in [*p["attributes"].values(), p.get("indices"), *(v for t in p.get("targets", []) for v in t.values())]
                   if i is not None})
    accessor = {old: new for new, old in enumerate(used)}
    for p in primitives:
        p["attributes"] = {name: accessor[i] for name, i in p["attributes"].items()}
        if "indices" in p:
            p["indices"] = accessor[p["indices"]]
        if "targets" in p:
            p["targets"] = [{name: accessor[i] for name, i in t.items()} for t in p["targets"]]
    accessors = [gltf["accessors"][i] for i in used]
    images = gltf.get("images", [])
    views = sorted({a["bufferView"] for a in accessors if "bufferView" in a} | {img["bufferView"] for img in images if "bufferView" in img})
    view = {old: new for new, old in enumerate(views)}
    packed, buffer_views = bytearray(), []
    for old in views:
        entry = dict(gltf["bufferViews"][old])
        offset = entry.get("byteOffset", 0)
        packed += bytes(-len(packed) % 4)
        entry["byteOffset"] = len(packed)
        packed += binary[offset:offset + entry["byteLength"]]
        buffer_views.append(entry)
    packed += bytes(-len(packed) % 4)
    for item in accessors + images:
        if "bufferView" in item:
            item["bufferView"] = view[item["bufferView"]]
    gltf["accessors"], gltf["bufferViews"] = accessors, buffer_views
    gltf["buffers"][0]["byteLength"] = len(packed)
    text = json.dumps(gltf, separators=(",", ":")).encode()
    text += b" " * (-len(text) % 4)
    with open(path, "wb") as f:
        f.write(struct.pack("<4sII", b"glTF", 2, 12 + 8 + len(text) + 8 + len(packed)))
        f.write(struct.pack("<I4s", len(text), b"JSON") + text)
        f.write(struct.pack("<I4s", len(packed), b"BIN\0") + packed)
