// Erzeugt die Bilder im Stil „Clean Toon“ über fal.ai: die Kartenillustrationen (`assets/images/cards/<id>.jpg`,
// 736×1024, auch Flaggschiffe, Drohne und Trugbild), die Porträts der Admirale (`assets/images/admirals/<id>.jpg`,
// 736×1024) und den Spielhintergrund (`assets/images/match_screen_background.png`, 2048×1143).
// Vorhandene Bilder werden übersprungen.
//
//   FAL_KEY=… bun tools/generateCardArt.ts                # alle fehlenden Bilder
//   FAL_KEY=… bun tools/generateCardArt.ts --force        # alle neu
//   FAL_KEY=… bun tools/generateCardArt.ts recall osei    # nur diese Karten bzw. Admirale (immer neu)
//   FAL_KEY=… bun tools/generateCardArt.ts ships          # nur eine Gruppe: ships, commands, admirals, background
//
// Jedes Bild entsteht in zwei Stufen:
// 1. Motiv. Befehle und Porträts: Flux Pro 1.1 mit `SUBJECTS` bzw. `PORTRAITS` im Stil der ersten Kartengeneration,
//    gespeichert im gitignorierten Cache `tools/cache/motifs/<id>.jpg` und nur erzeugt, wenn es dort fehlt. Schiffe:
//    der Hero-Render aus Blender (`tools/ships/renders/<id>/hero.png`); fehlt er, bricht das Skript ab. Der
//    Hintergrund hat kein Motiv.
// 2. Clean Toon: Nano Banana Pro mit dem Motiv bzw. Hero-Render als erstem und der Stilvorlage
//    `tools/cardStyleReference.jpg` als zweitem Bild, bei Schiffen mit Formbeschreibung und Palette aus `SHIP_LOOKS`.
//    Das Ergebnis wird mittig auf das Zielformat beschnitten.
//
// Warum Nano Banana Pro (Vergleich vom 2026-10-27 an Notschilde, Plündern und Kerr): Kontext pro nur mit Text behielt
// Glühen, dichte Sterne und den Felsboden des Motivs und zeichnete weichere Linien. Kontext multi und FLUX.2 pro edit
// mit der Stilvorlage übernahmen deren Schlachtschiff ins Bild, Seedream 4.5 malte dicke Sticker-Konturen und einen
// grellblauen Verlauf, Nano Banana (Flash) blieb glühender und uneinheitlicher. Nano Banana Pro traf Hintergrund,
// Konturen und flache Stufen der Vorlage am besten und hielt die Admirale erkennbar. Kosten je Bild: Nano Banana Pro
// 0,15 $, Kontext pro 0,04 $, Flux Pro 1.1 0,04 $ je Megapixel.
//
// Auch die Schiffe gehen über Nano Banana Pro statt FLUX.1 Kontext [pro] (Probe vom 2026-10-27, alle 15 Schiffe mit
// Kontext, die schwierigen auch mit Nano Banana Pro): Kontext deutete schmale, ungewöhnliche Schiffe (Drohne, Signal
// Booster, Mirage, Void Interceptor) in andere Ansichten und Formen um und setzte Lichtstreifen, Rauch und Glühhöfe in
// den Hintergrund; Guidance 2,5 und ein Prompt ohne Kompositionsvorgabe halfen nur zum Teil. Nano Banana Pro hielt jedes
// getestete Schiff in Form, Farbe und Blickwinkel und passt mit Verlauf und Linien zu den Befehlskarten. Es erfindet
// aber Teile, die die Beschreibung nennt und der Render nicht zeigt (Geschütztürme auf der Bastion): `SHIP_LOOKS` nennt
// deshalb nur sichtbare Teile.
//
// Seeds sind fest je Bild, ein erneuter Lauf liefert dasselbe Bild (auch bei Nano Banana Pro).
// - Motive: 1000 plus Index in `MOTIF_ORDER`, Porträts 2000 plus Index in `ADMIRAL_IDS`.
// - Zweite Stufe: `SEED` für alle Bilder. Misslingt eines (Schrift, Artefakte, Motiv unkenntlich, von der Moderation
//   abgelehnt), bekommt es in `RESEED` den nächsten Seed (8, 9, …) und wird mit seiner Id neu erzeugt; das Motiv
//   bleibt. Ein Eintrag bleibt nur, wenn das neue Bild besser ist.

import sharp from "sharp";
import { ADMIRAL_IDS, type AdmiralId } from "../../shared/admirals.ts";
import { type Card, COMMANDS, type CommandCard, type CommandId, type CommandType, FLAGSHIPS, SHIPS, type ShipId, TOKENS } from "../../shared/cards.ts";

const ASSETS = `${import.meta.dir}/../assets`;
const CACHE = `${import.meta.dir}/cache`;
/**
 * Stilvorlage: Kartenbild der Iron Dreadnought aus dem Clean-Toon-Prototyp (FLUX.1 Kontext aus dem Blender-Render). Alle
 * Bilder hängen an ihr; wer sie austauscht, bekommt bei gleichem Seed andere Bilder.
 */
const STYLE_REFERENCE = `${import.meta.dir}/cardStyleReference.jpg`;
const HERO_RENDERS = `${import.meta.dir}/ships/renders`;
/** Kartenformat 5:7 (140×196 im UI). */
const CARD_SIZE = { width: 736, height: 1024 };
const PARALLEL = 4;

const SEED = 7;
const RESEED: Partial<Record<string, number>> = { vance: 8, kerr: 8, orbital_strike: 8, targeting_jammer: 8, tractor_beam: 8, intercept: 8 };

// ---------------------------------------------------------------- Stufe 1: Motive (erste Kartengeneration)

const MOTIF_STYLE =
  "Stylized science-fiction illustration for a collectible card game. " +
  "Clean hard-surface design with faceted low-poly inspired shapes and flat cel-like shading, " +
  "bold readable silhouette, one large central subject filling the frame. " +
  "Deep dark space background with faint violet nebula haze and sparse stars, dramatic colored rim lighting. " +
  "Vertical portrait composition. " +
  "No text, no letters, no numbers, no logos, no user interface, no frame, no border, no watermark.";

const PORTRAIT_MOTIF_STYLE =
  "Stylized science-fiction character portrait for a collectible card game, same art style as the ship cards: " +
  "clean graphic shapes with faceted low-poly inspired planes and flat cel-like shading, bold readable silhouette. " +
  "Head and shoulders, three-quarter view, one central figure filling the frame. " +
  "Deep dark space background with faint violet nebula haze and sparse stars, dramatic colored rim lighting. " +
  "Vertical portrait composition. " +
  "No text, no letters, no numbers, no logos, no user interface, no frame, no border, no watermark.";

/** Farbe je Befehlstyp wie `src/data/cardColors.ts`: im Motiv als Licht, im Clean-Toon-Bild als einzige kräftige Farbe. */
const COMMAND_ACCENT: Record<CommandType, [name: string, hex: string]> = {
  attack: ["crimson red", "#E63333"],
  buff: ["emerald green", "#33B34D"],
  debuff: ["violet purple", "#9933CC"],
  tactic: ["sky blue", "#3399E6"],
  reposition: ["amber yellow", "#E6B31A"],
  special: ["bright orange", "#E6801A"],
};

const SUBJECTS: Record<Exclude<CommandId, "scrap_salvage">, string> = {
  orbital_strike: "A blinding orbital beam strikes down from above onto a warship, an impact explosion of light and debris, seen from the side at a distance",
  volley_fire: "A dense volley of dozens of glowing missiles and projectiles streaking across space in parallel trails, launched from a line of warships",
  power_surge: "A wave of energy sweeping through a formation of three warships flying in line, their engines and weapon systems flaring with light",
  emergency_shields: "A warship enveloped in a glowing hexagonal energy shield bubble, incoming shots splashing harmlessly against the barrier",
  emp_blast:
    "An electromagnetic shockwave ring expanding outward and engulfing a warship, its lights flickering out, lightning arcs crawling over the dark hull",
  targeting_jammer: "A warship surrounded by static interference and distorted glitching holographic targeting reticles, scrambled signal waves",
  flanking_maneuver: "A warship banking sharply along a curved holographic tactical arrow, slipping sideways around an enemy, glowing maneuver vectors",
  scavenge: "A ship with tractor beams pulling in floating salvage, cargo crates and wreckage from a debris field",
  intercept: "A warship surging forward with blazing afterburners along a holographic vector pointing ahead, bright engine trails",
  recall: "A damaged warship pulling back along a curved holographic retreat vector, small repair drones around it, engines glowing",
  overcharge: "A warship with its reactor core overloading, glowing cracks spreading across the hull, energy venting from every seam",
  torpedo:
    "A single heavy torpedo with a glowing warhead diving steeply from above toward a holographic targeting reticle locked onto an empty patch of space, a long bright exhaust trail behind it",
  barrage:
    "A wall of flak bursts and tracer fire filling a corridor of space, a warship caught mid-turn as it swerves through the curtain of explosions, its engine trail bending",
  evasive_action:
    "A warship sliding sideways with its lateral thrusters firing bright jets, a faint shimmer of shield around it, an enemy projectile streaking harmlessly through the empty space where the ship just was",
  micro_jump:
    "A warship vanishing in the blinding flash of a short-range jump, leaving behind a ghostly afterimage of its silhouette outlined in glowing light contours and a collapsing ring of light",
  rapid_deployment:
    "Several warships dropping out of hyperspace at the same moment in tight formation, each one arriving in a bright flash of entry light with streaks of warp trails behind them",
  draw_fire:
    "Many bright enemy laser beams coming in from all sides and converging on one heavily armored warship at the center of the frame, its thick front armor lit by impact sparks everywhere, bright flashing signal beacons on its hull, two small ships hiding safely behind it",
  shield_grid:
    "A fleet of four warships flying together, all linked by one continuous glowing hexagonal shield lattice stretched between and around them like a net",
  ablative_armor:
    "Extreme close-up of the curved armored flank of a warship hull in space, robotic welding arms attaching a thick new armor plate on top of existing layered heavy armor plates, bright welding sparks and glowing weld seams between the plates",
  covering_fire:
    "Two warships flying close together one behind the other as a wingman pair, both firing forward together, enclosed in one shared glowing shield bubble",
  drone_squadron:
    "A squadron of small wedge-shaped attack drones launching in tight formation out of a glowing hangar bay, bright engine trails streaming behind them",
  collision_course:
    "Two spaceships colliding in deep space: the pointed armored ram bow of a warship on the left driven deep into the crumpled flank of a second, larger warship on the right, the impact point bursting with buckling metal plates, fire and flying debris",
  countermeasures:
    "A warship ejecting a spray of bright flare decoys, its point-defense turrets shooting incoming missiles out of the sky, small explosions all around it",
  carte_blanche:
    "A gloved hand in a uniform sleeve hovering over a round glowing hologram projector, above it a three-dimensional hologram of a small fleet of starships, a big curved glowing arrow sweeping around them and a radiant star emblem flaring up at the same moment",
  radio_silence:
    "A warship drifting in darkness with its communication dishes and antennas dead and dark, shattered rings of signal waves breaking apart around it like broken glass, a faint haze of fading static, its hull lights going out",
  minefield:
    "A field of floating spiked space mines with blinking lights, one mine detonating in a bright explosion against a warship that has just arrived among them",
  tractor_beam:
    "A thick, bright, solid beam of light crossing the frame diagonally from the top left corner, its end wrapped around a warship and pulling it sideways out of a row of three warships, the captured ship tilted and dragged off course",
  heat_seeker:
    "Rear view of a fleeing warship with bright hot glowing engines, a small missile right behind it closing in on its engine exhaust, the missile's long smoke trail curving sharply in a tight arc behind it",
  coup_de_grace: "A single precise thin beam striking a heavily damaged, burning warship, its hull cracked and trailing smoke and debris",
  piercing_shot:
    "Two warships one behind the other on a single diagonal line from bottom left to top right, one straight beam traveling along that line, entering the nearer ship, bursting out of its bow and striking the second ship, glowing breach holes and explosions in both hulls",
  bombardment:
    "A rain of glowing shells and projectiles falling from above onto a rear row of warships lined up side by side, explosions blooming on their hulls",
  crossfire: "A single warship caught between two laser beams converging on it from the left and from the right, sparks where both beams hit",
};

const PORTRAITS: Record<AdmiralId, string> = {
  osei: "Fleet admiral Osei, a calm, steadfast veteran: a West African man in his sixties with dark skin, close-cropped grey hair and a short grey beard, an unshakable composed gaze, wearing a high-collared dark naval uniform with glowing amber piping and white-gold epaulettes, a shield-shaped amber crest on his chest, warm amber rim light",
  vance:
    "Fleet admiral Vance, combative and hard: a Latina woman in her forties with tan skin, a fierce challenging stare and a thin scar through one eyebrow, dark hair shaved at the sides and pulled back tight, wearing an armored dark uniform with crimson red accents and white-gold epaulettes, a spearhead insignia on her collar, crimson rim light",
  halvorsen:
    "Fleet admiral Halvorsen, coolly calculating: a stern Scandinavian woman around sixty, weathered pale skin with visible wrinkles and crow's feet, silver-blond hair pulled into a tight severe bun, piercing ice-blue eyes, thin pressed lips, a cold appraising stare, a plain face without makeup, wearing a sleek dark uniform with violet accents and white-gold epaulettes, a hexagonal honeycomb insignia on her chest, three small drones with violet lights hovering in the dark behind her, violet rim light",
  moreau:
    "Fleet admiral Moreau, inscrutable: a French man of North African descent in his forties with olive-brown skin, a neatly trimmed dark beard and a faint enigmatic smile, half of his face lit by cold turquoise hologram light and the other half in deep shadow, wearing a dark high-collared uniform with turquoise accents and white-gold epaulettes, translucent holographic fragments flickering around him",
  kerr: "Fleet admiral Kerr, precise and meticulous: an elderly Japanese man in his sixties with neatly combed silver hair and a trimmed silver mustache, a brass clockwork monocle with tiny visible gears over his right eye, a focused, exacting gaze, wearing a dark uniform with steel-blue accents, brass buttons and white-gold epaulettes, a gear and clock-hands insignia on his chest, steel-blue rim light",
};

/**
 * Reihenfolge, in der die Karten dazukamen; der Seed eines Motivs ist 1000 plus der Index darin. Schiffe, Tokens und
 * Flaggschiffe haben keine Motive mehr, behalten aber ihre Plätze, damit die Befehle ihre Seeds behalten. Neue Befehle
 * hängt `COMMANDS` hinten an, sie landen damit am Ende.
 */
const MOTIF_ORDER: readonly Card[] = [...SHIPS, ...COMMANDS.slice(0, 13), ...TOKENS, ...FLAGSHIPS, ...COMMANDS.slice(13)];

// ---------------------------------------------------------------- Stufe 2: Clean Toon

/** Wie die Stilvorlage: flache Flächen, wenige harte Stufen, dunkle Konturen, ruhiger dunkler Weltraum. */
const LOOK =
  "Flat color areas with two or three hard-edged shading steps, crisp even dark navy outlines that are bolder on the outer silhouettes, " +
  "no textures, no metallic gloss, no gradients on objects.";
const SPACE = "Calm dark navy space background with a few sparse small stars and a very subtle cool blue gradient, no nebula, no purple haze";
const CLEAN = "No text, no letters, no numbers, no logos, no frame, no border, no watermark.";

function commandPrompt(type: CommandType): string {
  const [name, hex] = COMMAND_ACCENT[type];
  return (
    "Redraw the first image as a clean cel-shaded illustration in the exact art style of the second image. " +
    "Keep the subject, composition and camera angle of the first image and every element that tells its story; " +
    "take only the rendering style, line work, ship colors and background treatment from the second image, not its battleship. " +
    `${LOOK} Starships in deep desaturated blue-grey with a few small glowing lights. ` +
    `All glowing energy effects (beams, shots, shields, explosions, engine flares) in ${name} (${hex}), the only strong color in the image. ` +
    `${SPACE}, no planets, no ground, no landscape: anything standing on a ground floats in open space instead. ` +
    `The subject large and clearly readable in the center. ${CLEAN}`
  );
}

/** Akzentfarbe je Admiral wie `src/data/palette.ts`: Uniform und Randlicht im Porträt, Akzente seines Flaggschiffs. */
const ADMIRAL_ACCENT: Record<AdmiralId, string> = {
  osei: "amber (#E8A33A)",
  vance: "crimson red (#E2483D)",
  halvorsen: "violet (#9D5CF2)",
  moreau: "turquoise (#33D1C6)",
  kerr: "steel blue (#5B8DFF)",
};

const portraitPrompt = (admiral: AdmiralId) =>
  "Redraw the first image as a clean cel-shaded character portrait in the exact art style of the second image. " +
  "Keep the exact same person from the first image: same face and facial features, age, skin tone, hairstyle, facial hair, expression, " +
  "accessories, uniform and the objects around them, same head-and-shoulders framing; " +
  "take only the rendering style, line work and background treatment from the second image, not its battleship. " +
  "Flat color areas with two or three hard-edged shading steps, crisp even dark navy outlines that are bolder on the outer silhouette, " +
  "no textures, no painterly brushwork, no gradients on skin or clothes. " +
  `Uniform accents and rim light in ${ADMIRAL_ACCENT[admiral]}. ${SPACE}. ${CLEAN}`;

/**
 * Hintergrund hinter dem Brett: so dunkel und ruhig, dass Schiffe mit dunklen Konturen davor lesbar bleiben. Statt eines
 * Verlaufs ein Toon-Glühen aus wenigen, kaum helleren Stufen; mit hellen Flächen oder sanftem Verlauf wurde er zu hell.
 */
const BACKGROUND_PROMPT =
  "Paint a wide, empty space backdrop in exactly the art style and colors of the background of this image, without its battleship: " +
  "dark navy space (#161c2b) with a few sparse small stars of slightly different sizes. Instead of a smooth gradient, a very subtle cel-shaded glow " +
  "toward the upper right: two or three large, softly curved areas, each only a little lighter than the one around it (#1a2133, then #1e283c), " +
  "with clean edges and no outlines; everything else stays dark and calm. Extremely low contrast, no bright areas. " +
  `No nebula clouds, no purple, no noise, no texture, no ships, no objects, no planets. ${CLEAN}`;

const HULL = "deep desaturated blue-grey hull";
const TRIM = "a thin white-gold (#F4D68C) command trim";

/**
 * Form, Blickwinkel und Palette je Schiff, wie sie der Hero-Render zeigt. Die Farben folgen `tools/ships/palette.py`
 * (Klassen, Admirale, Sonderfarben), Lichter so, wie sie im Render glühen (das Plasma #B45CFF etwa wirkt rosa-violett);
 * ändern sich Modell oder Farben, hier nachziehen. Nur sichtbare Teile nennen, genannte erfindet das Modell sonst dazu.
 */
const SHIP_LOOKS: Record<ShipId, [shape: string, palette: string]> = {
  void_interceptor: [
    "a slim needle-nosed interceptor seen from below, with a small glass canopy dome, two forward gun barrels with glowing muzzles, " +
      "two big rounded engine pods and a long straight stabilizer bar with a small upright fin at the stern",
    `${HULL}, a muted orange-red wing and accent panels, glowing orange (#FF8A3D) muzzles and light strips, a blue glass canopy`,
  ],
  scrap_raider: [
    "a blocky raider fighter seen from below, built around one huge forward cannon with a glowing muzzle, " +
      "a pointed wedge-shaped armor prow, a big armor block at the stern and a small dorsal fin",
    "dark grey and warm brownish scrap-grey hull, a rust-orange armor block and plates, a glowing orange (#FF8A3D) muzzle and light strip",
  ],
  horizon_cruiser: [
    "an elongated cruiser seen from below, with a long flat wedge-shaped prow, a stepped bridge tower with an antenna, " +
      "a dorsal twin-barrel turret, a big round engine nacelle at the stern and a small swept fin",
    `${HULL}, cornflower-blue turret, fin and engine rim, glowing light blue (#5CB2FF) engine rings and light strips`,
  ],
  plasma_frigate: [
    "a compact frigate seen from below, built around one huge forward plasma cannon ringed with glowing coils, " +
      "three round rear engines with glowing rims and a short antenna mast",
    `${HULL}, glowing pink-violet (#FF8CFF) plasma coils and muzzle, glowing light blue (#5CB2FF) engine rims`,
  ],
  iron_dreadnought: [
    "a massive, wide brutalist battleship seen from below, with layered armor skirts, twin-barrel turrets on the dorsal deck " +
      "and two heavy forward siege cannons",
    `${HULL}, pale cool steel-blue (#8BA7C6) turrets and armor edges, glowing magenta (#FF3FA6) shield emitters and muzzle cores ` +
      "on the two siege cannons, a few small glowing cool blue (#5CC4FF) lights",
  ],
  titan_carrier: [
    "a huge carrier seen from above, with a broad flat hexagonal flight deck with two runway light lines and three small parked drones, " +
      "a stepped island bridge with an antenna, layered hull sides and a large hexagonal glowing hangar opening at the front",
    `${HULL}, pale cool steel-blue (#8BA7C6) hull sides and deck rim, glowing cool blue (#5CC4FF) runway lines, violet drones, ` +
      "a glowing pink-violet (#FF8CFF) hangar opening",
  ],
  repair_drone: [
    "a rounded egg-shaped utility drone seen from below, with two jointed robotic repair arms on top, " +
      "a small grabber arm at the front with a glowing welding tip and a round engine pod at the stern",
    "light grey-blue civilian hull, mint-green accent bands and joints, orange warning stripes on the engine pod, " +
      "glowing amber (#FFB347) work lights and welding tip, a glowing green (#4DFFAA) light strip",
  ],
  signal_booster: [
    "a rounded support vessel seen from below, with a ring around its hull, a large tilted parabolic dish on top with a glowing rim ring " +
      "and a feed horn, two thin masts with lights, a glowing round transmitter at the front, a flat side antenna panel and a round engine pod",
    "light grey-blue civilian hull, mint-green accent bands, a glowing cyan (#5CF0FF) signal ring and transmitter, green (#4DFFAA) mast lights",
  ],
  drone: [
    "a small attack drone seen from below, with a sharp dark wedge-shaped body, one long thin straight wing reaching far to the side, " +
      "one short swept wing, a ventral fin, a glowing sensor arc on top and one rear engine nozzle",
    `${HULL} and dark grey parts, muted violet (#8864C0) wing edges and accent panels, a glowing violet (#B45CFF) sensor arc`,
  ],
  decoy: [
    "a holographic projection of a sleek angular delta-wing fighter with two round engines, made only of glowing edges and translucent facets",
    "only translucent turquoise (#33D1C6) hologram light with brighter glowing edges, the stars shining through it, no solid hull",
  ],
  bastion: [
    "a flying fortress seen from above: a rounded rectangular armored platform with a curved shield wall at the bow, " +
      "four round corner towers with spires topped by glowing crystals, a central octagonal command tower with an antenna, " +
      "a few small blocky structures and a triangular emblem plate on the deck",
    `${HULL}, muted amber-gold shield wall and spires, glowing amber (#E8A33A) crystals and emblem, a cool blue light band on the command tower, ` +
      `${TRIM} along the deck edges`,
  ],
  vanguard: [
    "a long, angular spearhead cruiser seen from below, with a long armored ram prow with a glowing blade edge, " +
      "two heavy cannons beneath it with glowing muzzles, swept armor blades at the stern and a stepped bridge with an antenna",
    `${HULL}, muted crimson armor blades and panels, glowing crimson red (#E2483D) blade edge, muzzles and beacon, ${TRIM} along the hull`,
  ],
  hive: [
    "a carrier flagship seen from above, with a rounded two-chambered pod-shaped hull, a honeycomb brood chamber of glowing hexagonal cells " +
      "on its back, side pods with small docked drones, a hexagonal command tower with an antenna, a hexagonal emblem plate with three hexagons " +
      "and a glowing engine at the stern",
    `${HULL}, muted violet side pods and drones, glowing violet (#9D5CF2) honeycomb cells, light strips and engine, a golden emblem, ${TRIM} along the hull`,
  ],
  mirage: [
    "a long, flat, narrow stealth flagship seen from below, with one long straight leading edge, angular panels underneath, a small canted fin " +
      "at the stern, a long glowing canopy strip, two slim gun barrels and a short antenna",
    `dark slate hull, teal accent panels, glowing turquoise (#33D1C6) seams and lights, a bright cyan-white canopy glow, ${TRIM} along the leading edge`,
  ],
  pendulum: [
    "a railgun battleship lying diagonally in the frame, its very long railgun pointing to the upper right and ringed with glowing coils " +
      "and brass collars, a huge toothed brass gear ring with a tilted coil ring around the hull, a small brass gear on the deck, " +
      "a bridge with an antenna and a round brass pendulum bob beneath the keel",
    `${HULL}, muted steel-blue accent panels, glowing steel blue (#5B8DFF) coils, rings and lights, brass (#C39A52) gear rings, collars and pendulum, ` +
      `${TRIM} along the hull`,
  ],
};

function shipPrompt(id: ShipId): string {
  const [shape, palette] = SHIP_LOOKS[id];
  return (
    "Redraw the first image as a clean cel-shaded illustration in the exact art style of the second image. " +
    `Keep the exact same ship from the first image, ${shape}: same shape, silhouette, proportions, colors, camera angle, framing and composition; ` +
    "do not add, remove or move any parts; take only the line work, shading and background treatment from the second image, not its battleship. " +
    `${LOOK} Palette: ${palette}; no other colors. ${SPACE}. ${CLEAN}`
  );
}

// ---------------------------------------------------------------- fal.ai

async function fal(model: string, input: Record<string, unknown>): Promise<Buffer> {
  const response = await fetch(`https://fal.run/${model}`, {
    method: "POST",
    headers: { Authorization: `Key ${process.env.FAL_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ num_images: 1, output_format: "jpeg", safety_tolerance: "4", ...input }),
  });
  if (!response.ok) throw new Error(`fal antwortet ${response.status} ${await response.text()}`);
  const result = (await response.json()) as { images: { url: string }[] };
  const image = await fetch(result.images[0]!.url);
  if (!image.ok) throw new Error(`Download fehlgeschlagen (${image.status})`);
  return Buffer.from(await image.arrayBuffer());
}

async function dataUri(path: string): Promise<string> {
  return `data:image/jpeg;base64,${(await sharp(path).jpeg({ quality: 92 }).toBuffer()).toString("base64")}`;
}

/** Stufe 1: Motiv mit Flux Pro 1.1. */
export function motif(prompt: string, seed: number, size: { width: number; height: number }): Promise<Buffer> {
  return fal("fal-ai/flux-pro/v1.1", { prompt, seed, image_size: size });
}

/** Stufe 2: Clean Toon mit Nano Banana Pro; nach den Bildern (Motiv bzw. Hero-Render) kommt die Stilvorlage. */
export async function toon(prompt: string, seed: number, aspectRatio: string, images: string[], resolution = "1K"): Promise<Buffer> {
  const image_urls = await Promise.all([...images, STYLE_REFERENCE].map(dataUri));
  return fal("fal-ai/nano-banana-pro/edit", { prompt, seed, aspect_ratio: aspectRatio, resolution, image_urls });
}

// ---------------------------------------------------------------- Aufträge

interface Job {
  id: string;
  group: "ships" | "commands" | "admirals" | "background";
  path: string;
  size: { width: number; height: number };
  /** Motiv der ersten Stufe; ohne `makeMotif` muss es schon da sein (Hero-Render). */
  motif?: string;
  makeMotif?: () => Promise<Buffer>;
  paint: () => Promise<Buffer>;
}

const seed = (id: string) => RESEED[id] ?? SEED;
const cached = (id: string) => `${CACHE}/motifs/${id}.jpg`;
const cardPath = (id: string) => `${ASSETS}/images/cards/${id}.jpg`;

const JOBS: Job[] = [
  ...[...SHIPS, ...TOKENS, ...FLAGSHIPS].map((card): Job => {
    const render = `${HERO_RENDERS}/${card.id}/hero.png`;
    return {
      id: card.id,
      group: "ships",
      path: cardPath(card.id),
      size: CARD_SIZE,
      motif: render,
      paint: () => toon(shipPrompt(card.id), seed(card.id), "3:4", [render]),
    };
  }),
  // Die Schrottverwertung zeigt das Bild des Scrap Raiders (`cardArt.ts`).
  ...COMMANDS.filter((card): card is CommandCard & { id: keyof typeof SUBJECTS } => card.id !== "scrap_salvage").map(
    (card): Job => ({
      id: card.id,
      group: "commands",
      path: cardPath(card.id),
      size: CARD_SIZE,
      motif: cached(card.id),
      makeMotif: () =>
        motif(`${SUBJECTS[card.id]}, dominated by ${COMMAND_ACCENT[card.commandType][0]} light. ${MOTIF_STYLE}`, 1000 + MOTIF_ORDER.indexOf(card), CARD_SIZE),
      paint: () => toon(commandPrompt(card.commandType), seed(card.id), "3:4", [cached(card.id)]),
    }),
  ),
  ...ADMIRAL_IDS.map(
    (id, index): Job => ({
      id,
      group: "admirals",
      path: `${ASSETS}/images/admirals/${id}.jpg`,
      size: CARD_SIZE,
      motif: cached(id),
      makeMotif: () => motif(`${PORTRAITS[id]}. ${PORTRAIT_MOTIF_STYLE}`, 2000 + index, CARD_SIZE),
      paint: () => toon(portraitPrompt(id), seed(id), "3:4", [cached(id)]),
    }),
  ),
  {
    id: "background",
    group: "background",
    path: `${ASSETS}/images/match_screen_background.png`,
    size: { width: 2048, height: 1143 },
    paint: () => toon(BACKGROUND_PROMPT, seed("background"), "16:9", [], "2K"),
  },
];

async function run(job: Job): Promise<void> {
  if (job.motif && job.makeMotif && !Bun.file(job.motif).size) {
    await Bun.write(job.motif, await job.makeMotif());
    console.log(`  Motiv ${job.id}`);
  }
  const image = sharp(await job.paint()).resize(job.size.width, job.size.height, { fit: "cover" });
  await (job.path.endsWith(".png") ? image.png() : image.jpeg({ quality: 90 })).toFile(job.path);
  console.log(`✓ ${job.id}`);
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const force = args.includes("--force");
  const requested = new Set(args.filter((arg) => !arg.startsWith("--")));
  const unknown = [...requested].filter((name) => !JOBS.some((job) => job.id === name || job.group === name));
  if (unknown.length) throw new Error(`Unbekannte Karten, Admirale oder Gruppen: ${unknown.join(", ")}`);

  const queue = JOBS.filter((job) => (requested.size ? requested.has(job.id) || requested.has(job.group) : force || !Bun.file(job.path).size));
  const renders = queue.filter((job) => job.motif && !job.makeMotif && !Bun.file(job.motif).size);
  if (renders.length) {
    throw new Error(
      `Hero-Render fehlt für ${renders.map((job) => job.id).join(", ")}: erst mit dem Vorschau-Werkzeug in tools/ships/ ` +
        `nach tools/ships/renders/<id>/hero.png rendern (736×1024, dunkler Hintergrund, Kamera schräg von unten).`,
    );
  }
  if (queue.length && !process.env.FAL_KEY) throw new Error("FAL_KEY fehlt in der Umgebung.");
  console.log(`${queue.length} Bild(er) …`);

  const failed: string[] = [];
  await Promise.all(
    Array.from({ length: PARALLEL }, async () => {
      for (let job = queue.shift(); job; job = queue.shift()) {
        await run(job).catch((error) => {
          failed.push(job!.id);
          console.error(`✗ ${job!.id}: ${(error as Error).message}`);
        });
      }
    }),
  );
  if (failed.length) {
    console.error(`Fehlgeschlagen: ${failed.join(", ")}`);
    process.exit(1);
  }
}
