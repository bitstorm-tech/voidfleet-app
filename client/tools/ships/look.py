"""Look-Parameter von Clean Toon: Licht, Stufen, Schlagschatten, Kantenlicht, Saum, Glanzpunkt, Linien, Glühen.

preview.py rendert damit in Cycles, das Spiel baut sie in Babylon nach; die Farben der Schiffe stehen in palette.py,
die Materialien liefern sie über `extras.vf` (vf.py). Reines Python ohne bpy.

Alles Licht ist gerechnet, nicht beleuchtet: Jede toon-Fläche ist Emission mit Stärke 1, ohne Tone-Mapping (Ansicht
„Standard“, wie im Spiel). Je Pixel einer toon-Fläche mit Normale N (Weltraum), Blickrichtung V (vom Punkt zur Kamera)
und Hauptlicht L (Richtung zum Licht, normiert):

  1. light = max(N·L, 0) · (1 − Schatten); Schatten = 1, wenn ein Strahl vom Punkt (um SHADOW_BIAS entlang N
     angehoben) Richtung L innerhalb SHADOW_DISTANCE etwas trifft. Schlagschatten haben nur Vorschau und Karten; das
     Spiel lässt sie in Brettgröße weg (client/src/scene/toon.ts).
  2. Ton nach STEPS: light < 0,12 → Schatten-Ton, < 0,5 → Halbschatten, sonst Licht-Ton (konstante Rampe).
  3. Kantenlicht: R = normalize(−Kamerarichtung + (0, 0, RIM_UP)), also von hinten oben. facing = 1 − |N·V|.
     rim = (N·R > a) · (facing > b) · (N·oben ≤ c) mit (a, b, c) = RIM_FLAT bzw. RIM_ROUND bei `round`-Materialien.
     Eckige Flächen, die nach oben zeigen (N·oben > 0,8, weniger als etwa 37° gegen die Waagrechte), bekommen also
     keins: Ihr facing liegt im Brettwinkel um die Schwelle 0,4 und wechselt mit der Perspektive über die Fläche, große
     Decks und Flügel zerfielen sonst entlang einer Kurve in zwei Töne. Runde Flächen erreichen ihre Schwelle oben nie.
     Saum: seam = (facing > SEAM_FACING) · (light < STEPS[0]). Farbe = mix(Ton, RIM_COLOR, RIM_MIX · max(rim, SEAM_MIX · seam)).
  4. Glanzpunkt (nur `glint` > 0): H = normalize(V + L); g = (N·H > GLINT_THRESHOLD) · (1 − Schatten);
     Farbe = mix(Farbe, GLINT_COLOR, glint · g).
Lichter (`light`) sind genau ihre Farbe; mit `glow` landen sie zusätzlich im Glühen (Compositor: zweimal Gauß-weich
gezeichnet mit den Radien aus GLOW und mit GLOW_MIX aufaddiert; im Spiel der GlowLayer). Hologramme: Farbe mit Deckkraft
`alpha` über dem Hintergrund, ohne Konturen. Wracks: wie eine eckige toon-Fläche plus heat × Glutmuster.

Richtungen sind Blender-Schiffskoordinaten (Nase −Y, oben +Z, Steuerbord +X), so wie die Vorschau-Kamera auf das Schiff
schaut. Im glTF ist das (x, z, −y), im Babylon-Modellraum nach dem glTF-Loader (Wurzel um 180° gedreht und z gespiegelt)
(−x, z, −y). Das Spiel hält das Hauptlicht fest am Brett und spiegelt es je Seite, damit auch Gegner von vorn
beleuchtet werden; in ihren Schiffskoordinaten ist dann x gespiegelt (`enemy`).
"""

from palette import OUTLINE

# Hauptlicht je Ansicht. Brett und Zoom: von oben und vorn, leicht von der Kameraseite (Backbord): Deck hell, Flanke
# halbhell, Schatten fallen nach achtern. Das Licht steht fest am Brett: Von hinten oben (`behind`) bleibt es dasselbe;
# Gegner (um 180° gedreht, die Kamera sieht ihre Steuerbordseite) bekommen es gespiegelt, also auch von vorn und von der
# Kameraseite. Karte: von vorn links oben, sonst läge die von unten gesehene Flanke im Schatten.
KEY = {
    "board": (-0.25, -0.75, 0.62),
    "zoom": (-0.25, -0.75, 0.62),
    "behind": (-0.25, -0.75, 0.62),
    "enemy": (0.25, -0.75, 0.62),
    "enemy_zoom": (0.25, -0.75, 0.62),
    "hero": (-0.68, -0.62, 0.36),
    "wreck": (-0.25, -0.75, 0.62),
}
# Kartenkamera (Ansicht `hero`, Richtung vom Schiff zur Kamera): Standard ist die Dreiviertelansicht von vorn links und
# leicht von unten mit dem Licht KEY["hero"]. Schiffe, deren Kennzeichen oben liegen, schauen stattdessen von vorn oben,
# mit einem Licht von vorn links oben: Deck hell, Flanke und Bug halbhell wie auf dem Brett. `roll` dreht die Kamera um
# ihre Blickachse (Grad; negativ hebt den Bug nach rechts oben), damit ein langes Schiff das Hochformat diagonal füllt.
HERO_DIR = (-0.5, -1.0, -0.3)
HERO_TOP_KEY = (-0.45, -0.35, 0.82)
HERO_SHIPS = {
    "titan_carrier": {"dir": (-0.55, -1.0, 0.6), "key": HERO_TOP_KEY},  # Flugdeck mit Landebahn und Insel
    "hive": {"dir": (-0.5, -0.9, 0.8), "key": HERO_TOP_KEY},  # Brutwaben auf dem Rücken
    "bastion": {"dir": (-0.75, -0.6, 0.8), "key": HERO_TOP_KEY},  # Terrassen, Bergfried und Pylone statt nur der Bugwand
}
STEPS = (0.12, 0.5)  # Schwellen auf light: Schatten | Halbschatten | Licht
SHADOW_BIAS = 0.012  # Blender-Einheiten
SHADOW_DISTANCE = 40.0

RIM_COLOR = "#86acd2"
RIM_MIX = 0.65
RIM_UP = 0.9
RIM_FLAT = (0.28, 0.4, 0.8)  # eckige Flächen: N·R > 0,28, facing > 0,4, N·oben höchstens 0,8
RIM_ROUND = (0.0, 0.62, 2.0)  # runde Flächen: schmaler, nur am Umriss, ohne Grenze nach oben
SEAM_FACING = 0.86
SEAM_MIX = 0.5

GLINT_COLOR = "#e4ecf4"
GLINT_THRESHOLD = 0.975

# Freestyle-Linien in Pixeln je Ansicht: Außenkontur (gegen den Hintergrund), Silhouetten und Ränder, Kanten (Knick
# über 180° − CREASE_ANGLE = 40°). Alle in OUTLINE, runde Enden. Hologramme haben keine.
LINES = {
    "board": (1.8, 1.3, 0.7),
    "zoom": (3.0, 2.2, 1.1),
    "behind": (3.0, 2.2, 1.1),
    "enemy": (1.8, 1.3, 0.7),
    "enemy_zoom": (3.0, 2.2, 1.1),
    "hero": (3.2, 2.4, 1.2),
    "wreck": (3.0, 2.2, 1.1),
}
CREASE_ANGLE = 140
LINE_COLOR = OUTLINE

# Glühen der Lichter: zwei Gauß-Weichzeichner (Radius in Pixeln, nah und fern), mit GLOW_MIX aufaddiert
GLOW = {
    "board": (3, 9),
    "zoom": (6, 20),
    "behind": (6, 20),
    "enemy": (3, 9),
    "enemy_zoom": (6, 20),
    "hero": (7, 24),
    "wreck": (6, 20),
}
GLOW_MIX = (0.9, 0.55)
