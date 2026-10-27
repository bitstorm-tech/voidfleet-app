// Erzeugt die Kartenillustrationen über fal.ai (Flux Pro 1.1) und legt sie als
// `assets/images/cards/<id>.jpg` ab, dazu die Porträts der Admirale als `assets/images/admirals/<id>.jpg`.
// Vorhandene Bilder werden übersprungen.
//
//   FAL_KEY=… bun tools/generateCardArt.ts            # alle fehlenden Bilder
//   FAL_KEY=… bun tools/generateCardArt.ts --force    # alle neu
//   FAL_KEY=… bun tools/generateCardArt.ts recall osei   # nur diese Karten bzw. Admirale (immer neu)

import { ADMIRAL_IDS, type AdmiralId } from "../../shared/admirals.ts";
import { COMMANDS, FLAGSHIPS, SHIPS, TOKENS, type Card, type CommandType, type ShipClass } from "../../shared/cards.ts";

const MODEL = "fal-ai/flux-pro/v1.1";
const OUT_DIR = `${import.meta.dir}/../assets/images/cards`;
const PORTRAIT_DIR = `${import.meta.dir}/../assets/images/admirals`;
/** Kartenformat 5:7 (140×196 im UI), Maße als Vielfache von 32. */
const IMAGE_SIZE = { width: 736, height: 1024 };
const PARALLEL = 4;

const STYLE =
  "Stylized science-fiction illustration for a collectible card game. " +
  "Clean hard-surface design with faceted low-poly inspired shapes and flat cel-like shading, " +
  "bold readable silhouette, one large central subject filling the frame. " +
  "Deep dark space background with faint violet nebula haze and sparse stars, dramatic colored rim lighting. " +
  "Vertical portrait composition. " +
  "No text, no letters, no numbers, no logos, no user interface, no frame, no border, no watermark.";

/** Akzentfarbe je Schiffsklasse bzw. Befehlstyp, passend zu `src/data/cardColors.ts`. */
const SHIP_ACCENT: Record<ShipClass, string> = {
  fighter: "glowing orange-red accents",
  cruiser: "glowing cobalt blue accents",
  battleship: "steel grey armor with cool blue lights",
  support: "glowing emerald green accents",
};

/** Flaggschiffe tragen die Farbe ihres Admirals (wie im UI) und die weiß-goldene Zierlinie; das Trugbild ist ein Hologramm. */
const CARD_ACCENT: Partial<Record<Card["id"], string>> = {
  bastion: "with glowing amber accents and a white-gold command trim",
  vanguard: "with glowing crimson red accents and a white-gold command trim",
  hive: "with glowing violet accents and a white-gold command trim",
  mirage: "with glowing turquoise accents and a white-gold command trim",
  pendulum: "with glowing steel-blue accents, brass details and a white-gold command trim",
  decoy: "rendered entirely in translucent turquoise hologram light",
};

const COMMAND_ACCENT: Record<CommandType, string> = {
  attack: "crimson red",
  buff: "emerald green",
  debuff: "violet purple",
  tactic: "sky blue",
  reposition: "amber yellow",
  special: "bright orange",
};

const SUBJECTS: Record<Card["id"], string> = {
  // Schiffe
  void_interceptor:
    "A small aggressive single-seat space interceptor with a needle-sharp nose, swept blade-like wings and V-shaped tail fins, dark gunmetal hull, twin engine flares, banking hard toward the viewer in a three-quarter front view",
  scrap_raider:
    "A rugged asymmetric raider fighter cobbled together from salvaged hull plates and mismatched parts, exposed welds and rivets, a jutting scrap-metal ram prow, rusty gunmetal hull, three-quarter front view",
  horizon_cruiser:
    "An elongated balanced mid-size cruiser with a slender hull, raised bridge and symmetrical engine nacelles, dark gunmetal hull, flying above the curved horizon of a planet at dawn, three-quarter view",
  plasma_frigate:
    "A compact frigate built around one oversized forward plasma cannon, glowing plasma conduits along the hull, charged violet-blue energy crackling at the muzzle, dark gunmetal hull, three-quarter front view",
  iron_dreadnought:
    "An extremely massive wide brutalist dreadnought battleship with thick layered armor plating, multiple oversized twin-barrel turrets on the dorsal deck and heavy forward siege cannons, glowing shield emitter arrays, towering three-quarter view from slightly below",
  titan_carrier:
    "A huge broad carrier battleship with open hangar bays along its flanks and a flat flight deck, launching a small drone fighter from a glowing bay, three-quarter view",
  repair_drone:
    "A compact rounded utility support drone ship with folded multi-jointed robotic repair arms, welding lasers and a spherical sensor eye, white and gunmetal hull, three-quarter view",
  signal_booster:
    "A rounded technical support vessel bristling with communication dish antennas and relay masts, one large central parabolic dish with pulsing signal rings radiating from it, white and gunmetal hull, three-quarter view",
  drone:
    "A tiny unmanned attack drone with a compact wedge-shaped body, stubby wings and a single glowing engine, launching out of the open glowing hangar bay of a huge carrier in the dark background, three-quarter front view",
  decoy:
    "A holographic decoy projection of a sleek angular fighter ship, built only from bright glowing edges and faint see-through facets with thin scan lines, small flickering glitch fragments drifting off it, three-quarter front view",
  // Flaggschiffe der Admirale
  bastion:
    "A colossal flying fortress battleship, squat, broad and heavy, its bow a towering curved armored wall like a giant shield set with glowing shield emitter lenses, terraced layers of armor decks with battlements and round corner towers topped by shield pylons with glowing crystals, a raised command keep at the stern with lit windows, only a few small turrets, three-quarter front view",
  vanguard:
    "A long, slender, aggressive flagship cruiser shaped like a spearhead, a long armored ram prow with glowing blade edges, two heavy cannons beneath the ram and forward-facing twin turrets, swept-back armor blades along its flanks, a powerful cluster of engines, charging forward, three-quarter front view",
  hive:
    "A massive carrier flagship with a rounded, slightly organic two-chambered hull like a giant seed pod, no flat flight deck, its curved back covered by a dense honeycomb of open hexagonal cells, every cell lit bright violet from within like glowing brood chambers, side pods with hexagonal hangar openings and small drone fighters docked on them, a hexagonal command tower with lit windows, a plain unmarked hull, three-quarter view",
  mirage:
    "A sleek, flat and narrow stealth flagship made of sharp angular facets, a dark hull with an iridescent turquoise sheen, glowing seams along its edges, swept diamond-shaped wings with a sawtooth trailing edge, two canted holographic projector fins, a faceted raised bridge, three-quarter front view",
  pendulum:
    "A railgun flagship battleship in three-quarter side view, a very long railgun forming its spine and projecting far beyond the bow, the railgun ringed with glowing electromagnetic coils and brass collars, a huge brass toothed gear ring encircling the middle of the hull like a clockwork gimbal, a brass pendulum counterweight with a round bob hanging beneath the keel, a raised bridge with a round clock-face window",
  // Befehle
  orbital_strike:
    "A blinding orbital beam strikes down from above onto a warship, an impact explosion of light and debris, seen from the side at a distance",
  volley_fire:
    "A dense volley of dozens of glowing missiles and projectiles streaking across space in parallel trails, launched from a line of warships",
  power_surge:
    "A wave of energy sweeping through a formation of three warships flying in line, their engines and weapon systems flaring with light",
  emergency_shields:
    "A warship enveloped in a glowing hexagonal energy shield bubble, incoming shots splashing harmlessly against the barrier",
  emp_blast:
    "An electromagnetic shockwave ring expanding outward and engulfing a warship, its lights flickering out, lightning arcs crawling over the dark hull",
  targeting_jammer:
    "A warship surrounded by static interference and distorted glitching holographic targeting reticles, scrambled signal waves",
  flanking_maneuver:
    "A warship banking sharply along a curved holographic tactical arrow, slipping sideways around an enemy, glowing maneuver vectors",
  scavenge:
    "A ship with tractor beams pulling in floating salvage, cargo crates and wreckage from a debris field",
  intercept:
    "A warship surging forward with blazing afterburners along a holographic vector pointing ahead, bright engine trails",
  recall:
    "A damaged warship pulling back along a curved holographic retreat vector, small repair drones around it, engines glowing",
  overcharge:
    "A warship with its reactor core overloading, glowing cracks spreading across the hull, energy venting from every seam",
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
  coup_de_grace:
    "A single precise thin beam striking a heavily damaged, burning warship, its hull cracked and trailing smoke and debris",
  piercing_shot:
    "Two warships one behind the other on a single diagonal line from bottom left to top right, one straight beam traveling along that line, entering the nearer ship, bursting out of its bow and striking the second ship, glowing breach holes and explosions in both hulls",
  bombardment:
    "A rain of glowing shells and projectiles falling from above onto a rear row of warships lined up side by side, explosions blooming on their hulls",
  crossfire:
    "A single warship caught between two laser beams converging on it from the left and from the right, sparks where both beams hit",
};

/** Porträts der Admirale für die Auswahlkarten, im Stil der Kartenbilder; Uniform in der Farbe des Admirals. */
const PORTRAIT_STYLE =
  "Stylized science-fiction character portrait for a collectible card game, same art style as the ship cards: " +
  "clean graphic shapes with faceted low-poly inspired planes and flat cel-like shading, bold readable silhouette. " +
  "Head and shoulders, three-quarter view, one central figure filling the frame. " +
  "Deep dark space background with faint violet nebula haze and sparse stars, dramatic colored rim lighting. " +
  "Vertical portrait composition. " +
  "No text, no letters, no numbers, no logos, no user interface, no frame, no border, no watermark.";

const PORTRAITS: Record<AdmiralId, string> = {
  osei:
    "Fleet admiral Osei, a calm, steadfast veteran: a West African man in his sixties with dark skin, close-cropped grey hair and a short grey beard, an unshakable composed gaze, wearing a high-collared dark naval uniform with glowing amber piping and white-gold epaulettes, a shield-shaped amber crest on his chest, warm amber rim light",
  vance:
    "Fleet admiral Vance, combative and hard: a Latina woman in her forties with tan skin, a fierce challenging stare and a thin scar through one eyebrow, dark hair shaved at the sides and pulled back tight, wearing an armored dark uniform with crimson red accents and white-gold epaulettes, a spearhead insignia on her collar, crimson rim light",
  halvorsen:
    "Fleet admiral Halvorsen, coolly calculating: a stern Scandinavian woman around sixty, weathered pale skin with visible wrinkles and crow's feet, silver-blond hair pulled into a tight severe bun, piercing ice-blue eyes, thin pressed lips, a cold appraising stare, a plain face without makeup, wearing a sleek dark uniform with violet accents and white-gold epaulettes, a hexagonal honeycomb insignia on her chest, three small drones with violet lights hovering in the dark behind her, violet rim light",
  moreau:
    "Fleet admiral Moreau, inscrutable: a French man of North African descent in his forties with olive-brown skin, a neatly trimmed dark beard and a faint enigmatic smile, half of his face lit by cold turquoise hologram light and the other half in deep shadow, wearing a dark high-collared uniform with turquoise accents and white-gold epaulettes, translucent holographic fragments flickering around him",
  kerr:
    "Fleet admiral Kerr, precise and meticulous: an elderly Japanese man in his sixties with neatly combed silver hair and a trimmed silver mustache, a brass clockwork monocle with tiny visible gears over his right eye, a focused, exacting gaze, wearing a dark uniform with steel-blue accents, brass buttons and white-gold epaulettes, a gear and clock-hands insignia on his chest, steel-blue rim light",
};

function prompt(card: Card): string {
  const accent =
    CARD_ACCENT[card.id] ??
    (card.kind === "ship" ? `with ${SHIP_ACCENT[card.shipClass]}` : `dominated by ${COMMAND_ACCENT[card.commandType]} light`);
  return `${SUBJECTS[card.id]}, ${accent}. ${STYLE}`;
}

interface Job {
  id: string;
  prompt: string;
  seed: number;
  path: string;
}

async function generate(job: Job, apiKey: string): Promise<void> {
  const response = await fetch(`https://fal.run/${MODEL}`, {
    method: "POST",
    headers: { Authorization: `Key ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      prompt: job.prompt,
      image_size: IMAGE_SIZE,
      num_images: 1,
      output_format: "jpeg",
      safety_tolerance: "4",
      seed: job.seed,
    }),
  });
  if (!response.ok) throw new Error(`${job.id}: fal antwortet ${response.status} ${await response.text()}`);
  const result = (await response.json()) as { images: { url: string }[] };
  const image = await fetch(result.images[0]!.url);
  if (!image.ok) throw new Error(`${job.id}: Download fehlgeschlagen (${image.status})`);
  await Bun.write(job.path, await image.arrayBuffer());
  console.log(`✓ ${job.id}`);
}

const apiKey = process.env.FAL_KEY;
if (!apiKey) throw new Error("FAL_KEY fehlt in der Umgebung.");

const args = process.argv.slice(2);
const force = args.includes("--force");
const requested = new Set(args.filter((arg) => !arg.startsWith("--")));
// Fester Seed je Bild, damit ein erneuter Lauf dasselbe Bild liefert. Er folgt dem Index in dieser Liste, die in
// der Reihenfolge wächst, in der die Karten dazukamen: erst die 13 ersten Befehle, dann Tokens und Flaggschiffe,
// dann die übrigen Befehle. Neue Karten gehören ans Ende, sonst wandern fremde Seeds. Porträts zählen ab 2000.
const all: readonly Card[] = [...SHIPS, ...COMMANDS.slice(0, 13), ...TOKENS, ...FLAGSHIPS, ...COMMANDS.slice(13)];
const jobs: Job[] = [
  ...all.map((card, index) => ({ id: card.id, prompt: prompt(card), seed: 1000 + index, path: `${OUT_DIR}/${card.id}.jpg` })),
  ...ADMIRAL_IDS.map((id, index) => ({ id, prompt: `${PORTRAITS[id]}. ${PORTRAIT_STYLE}`, seed: 2000 + index, path: `${PORTRAIT_DIR}/${id}.jpg` })),
];
const unknown = [...requested].filter((id) => !jobs.some((job) => job.id === id));
if (unknown.length) throw new Error(`Unbekannte Karten oder Admirale: ${unknown.join(", ")}`);

const queue = jobs.filter((job) => (requested.size ? requested.has(job.id) : force || !Bun.file(job.path).size));
console.log(`${queue.length} Bild(er) über ${MODEL} …`);

const failed: string[] = [];
await Promise.all(
  Array.from({ length: PARALLEL }, async () => {
    for (let job = queue.shift(); job; job = queue.shift()) {
      await generate(job, apiKey).catch((error) => {
        failed.push(job!.id);
        console.error(`✗ ${(error as Error).message}`);
      });
    }
  }),
);
if (failed.length) {
  console.error(`Fehlgeschlagen: ${failed.join(", ")}`);
  process.exit(1);
}
