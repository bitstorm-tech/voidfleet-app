"""Alle Farben der Schiffe an einer Stelle (sRGB-Hex, wie im UI und in den GLB-Extras).

Flächen haben drei Töne (Licht, Halbschatten, Schatten). `tones(lit)` leitet die beiden dunkleren aus dem Licht-Ton
ab, kalibriert an der Palette des Clean-Toon-Prototyps (Abweichung dort unter ΔE 0,009 in OKLab): Farbton bleibt,
Helligkeit fällt affin, Chroma sinkt; was aus dem sRGB-Raum fiele, verliert Chroma statt Kanäle abzuschneiden.
Wer Töne von Hand will, gibt alle drei an. Lichter haben genau eine Farbe (unbeleuchtet, Emission 1).
Reines Python ohne bpy, damit auch Werkzeuge außerhalb von Blender die Palette lesen können.
"""

import math

# ---------------------------------------------------------------- Umrechnung


def srgb_to_linear(c):
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def linear_to_srgb(c):
    c = min(max(c, 0.0), 1.0)
    return 12.92 * c if c <= 0.0031308 else 1.055 * c ** (1 / 2.4) - 0.055


def rgb(code):
    """"#RRGGBB" -> sRGB-Kanäle 0..1."""
    code = code.lstrip("#")
    return tuple(int(code[i:i + 2], 16) / 255 for i in (0, 2, 4))


def linear(code):
    """"#RRGGBB" -> lineares RGB, wie Blender-Farben und glTF-Faktoren es erwarten."""
    return tuple(srgb_to_linear(c) for c in rgb(code))


def hex_code(channels):
    return "#" + "".join(f"{round(min(max(c, 0.0), 1.0) * 255):02x}" for c in channels)


def _oklab(code):
    r, g, b = linear(code)
    l = (0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b) ** (1 / 3)
    m = (0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b) ** (1 / 3)
    s = (0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b) ** (1 / 3)
    return (0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s,
            1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s,
            0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s)


def _from_oklab(lightness, a, b):
    """OKLab -> lineares RGB (kann außerhalb von 0..1 liegen)."""
    l = (lightness + 0.3963377774 * a + 0.2158037573 * b) ** 3
    m = (lightness - 0.1055613458 * a - 0.0638541728 * b) ** 3
    s = (lightness - 0.0894841775 * a - 1.2914855480 * b) ** 3
    return (4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
            -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
            -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s)


def oklch(lightness, chroma, hue):
    """OKLCH (Farbton in Grad) -> "#RRGGBB"; zu viel Chroma wird abgebaut, bis die Farbe in sRGB liegt."""
    h = math.radians(hue)
    for _ in range(40):
        channels = _from_oklab(lightness, chroma * math.cos(h), chroma * math.sin(h))
        if all(-1e-4 <= c <= 1.0001 for c in channels):
            break
        chroma *= 0.95
    return hex_code(linear_to_srgb(c) for c in channels)


def lch(code):
    lightness, a, b = _oklab(code)
    return lightness, math.hypot(a, b), math.degrees(math.atan2(b, a)) % 360


def pale(code, lightness=0.93, keep=0.35):
    """Heller, blasser Begleiter einer Lichtfarbe, etwa die Brennkammer der Düsen in der Admiralsfarbe."""
    _, chroma, hue = lch(code)
    return oklch(lightness, chroma * keep, hue)


# ---------------------------------------------------------------- Töne

# Halbschatten und Schatten aus dem Licht-Ton (OKLCH): L' = a + b·L, C' = k·C, Farbton + dh Grad.
# Kleinste Quadrate über die fünf Tonfamilien des Prototyps.
MID = (0.0331, 0.7252, 0.9497, 1.09)
SHADOW = (0.0607, 0.4509, 0.7371, 2.33)


def tones(lit):
    """Drei Töne (Licht, Halbschatten, Schatten) zu einem Licht-Ton; ein Tripel wird unverändert durchgereicht."""
    if not isinstance(lit, str):
        return tuple(lit)
    lightness, chroma, hue = lch(lit)
    derived = [oklch(a + b * lightness, k * chroma, hue + dh) for a, b, k, dh in (MID, SHADOW)]
    return (lit.lower(), *derived)


# ---------------------------------------------------------------- Flächen (Licht, Halbschatten, Schatten)

# Gemeinsame Tonfamilien aller Schiffe: tiefes, entsättigtes Blaugrau (Werte des Prototyps)
HULL = ("#56657a", "#3a4657", "#222a36")  # Rumpf
ARMOR = ("#5f6f84", "#414e60", "#262f3c")  # Panzerung, Schürzen, Kasematten: einen Hauch heller als der Rumpf
DARK = ("#323a47", "#252c37", "#161b23")  # Dunkelteile: Gehäuse, Barbetten, Verschlüsse, Kiel
STEEL = ("#6d7c8f", "#4a5667", "#2b3340")  # Rohre, Läufe, Düsenglocken (rund, mit Glanzpunkt)
GLASS = tones("#2f5f7a")  # Kanzeln (rund, mit Glanzpunkt)
WRECK = tones("#3b3532")  # verkohlte Bruchflächen der Wracks

# Zierlinie der Flaggschiffe: Licht-Ton = flagshipTrim aus client/src/data/palette.ts; Schatten von Hand ins Warme
# gezogen, abgeleitet würden sie olivgrün
TRIM = ("#f4d68c", "#c9a05a", "#7f5a2c")

# ---------------------------------------------------------------- Lichter (eine Farbe, unbeleuchtet)

GLOW = "#5cc4ff"  # Positions- und Zierlichter, Lichtbänder
CORE = "#c8f0ff"  # Brennkammer der Düsen
WINDOW = "#9fe0ff"  # Fensterbänder
SHIELD = "#ff3fa6"  # Schildemitter
RED = "#ff5040"  # Positionslicht Backbord
GREEN = "#50ff7a"  # Positionslicht Steuerbord
AMBER = "#ffb347"  # Werkzeuglichter der Repair Drone
PLASMA = "#b45cff"  # Plasma: Leitungen der Plasma Frigate, Reaktor des Titan Carriers, Düsen der Drohne
HEAT = "#ff9945"  # Glut der Bruchflächen, heiß (das Spiel lässt sie abkühlen)

# ---------------------------------------------------------------- Schiffsklassen

# Akzentfläche je Klasse, im Farbton der Kartenfarbe aus client/src/data/cardColors.ts; dazu die Lichter, in denen
# Düsen und Lichtbänder der Klasse leuchten. Schlachtschiffe behalten das Stahlblau der Prototyp-Türme. Unterstützer
# sind zivil und haben einen hellen Rumpf, alle anderen das gemeinsame Blaugrau; die Panzerung ist je Klasse einen Hauch
# heller als der Rumpf.
CLASSES = {
    "fighter": {"hull": HULL, "armor": ARMOR, "accent": tones(oklch(0.66, 0.13, 35)), "glow": "#ff8a3d", "core": "#ffe3c2"},
    "cruiser": {"hull": HULL, "armor": ARMOR, "accent": tones(oklch(0.68, 0.11, 262)), "glow": "#5cb2ff", "core": "#cfe8ff"},
    "battleship": {"hull": HULL, "armor": ARMOR, "accent": ("#8ba7c6", "#5d7796", "#34465c"), "glow": GLOW, "core": CORE},
    "support": {"hull": tones("#a3afbe"), "armor": tones("#aebac9"), "accent": tones(oklch(0.74, 0.12, 158)), "glow": "#4dffaa",
                "core": "#d2ffe8"},
}

# ---------------------------------------------------------------- Admirale (client/src/data/palette.ts)

ADMIRALS = {"osei": "#e8a33a", "vance": "#e2483d", "halvorsen": "#9d5cf2", "moreau": "#33d1c6", "kerr": "#5b8dff"}
FLAGSHIPS = {"bastion": "osei", "vanguard": "vance", "hive": "halvorsen", "mirage": "moreau", "pendulum": "kerr"}
# Akzentfläche der Flaggschiffe: Farbton des Admirals, gedämpft wie die Klassenakzente; die Kennzeichen tragen die
# UI-Farbe selbst (Licht ohne Glühen), Düsen und Leuchtfeuer leuchten in ihr
ADMIRAL_ACCENT = {
    "osei": tones(oklch(0.70, 0.09, 72)),
    "vance": tones(oklch(0.60, 0.13, 28)),
    "halvorsen": tones(oklch(0.62, 0.12, 300)),
    "moreau": tones(oklch(0.68, 0.09, 188)),
    "kerr": tones(oklch(0.66, 0.11, 266)),
}

# ---------------------------------------------------------------- Sonderfarben einzelner Schiffe

DRONE_ACCENT = tones(oklch(0.58, 0.14, 300))  # Drohne: Violett ihres Trägers, des Titan Carriers
SCRAP_HULL = tones("#5f5a55")  # Scrap Raider: warmes Schrottgrau
RUST = tones("#8f4f2c")  # Scrap Raider: aufgeschweißte Rostplatten
STRIPE = tones("#e08a3a")  # Repair Drone: Warnstreifen
BRASS = ("#c39a52", "#a2702b", "#663c0f")  # Pendulum: Messing; Schatten von Hand ins Warme wie TRIM, abgeleitet kippt er ins Oliv
# Mirage: Tarnkappenrumpf zwischen DARK und HULL, Töne von Hand; der Schatten etwas heller als abgeleitet (#1a202a),
# sonst versinkt die Unterseite in der Karte im dunklen Grund
PHANTOM = ("#3e4858", "#2d3643", "#222934")
CYAN = "#5cf0ff"  # Signal Booster: Sender und Signalring (Licht)
HOLOGRAM = (ADMIRALS["moreau"], pale(ADMIRALS["moreau"], 0.9, 0.7))  # Trugbild: Facetten, leuchtende Kanten

# ---------------------------------------------------------------- Konturen

OUTLINE = "#0b0e15"
