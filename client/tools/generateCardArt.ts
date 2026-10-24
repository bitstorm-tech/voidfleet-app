// Erzeugt die Kartenillustrationen über fal.ai (Flux Pro 1.1) und legt sie als
// `assets/images/cards/<id>.jpg` ab. Vorhandene Bilder werden übersprungen.
//
//   FAL_KEY=… bun tools/generateCardArt.ts            # alle fehlenden Karten
//   FAL_KEY=… bun tools/generateCardArt.ts --force    # alle neu
//   FAL_KEY=… bun tools/generateCardArt.ts recall emp_blast   # nur diese (immer neu)

import { COMMANDS, SHIPS, type Card, type CommandType, type ShipClass } from "../../shared/cards.ts";

const MODEL = "fal-ai/flux-pro/v1.1";
const OUT_DIR = `${import.meta.dir}/../assets/images/cards`;
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
};

function prompt(card: Card): string {
  const accent =
    card.kind === "ship"
      ? `with ${SHIP_ACCENT[card.shipClass]}`
      : `dominated by ${COMMAND_ACCENT[card.commandType]} light`;
  return `${SUBJECTS[card.id]}, ${accent}. ${STYLE}`;
}

async function generate(card: Card, seed: number, apiKey: string): Promise<void> {
  const response = await fetch(`https://fal.run/${MODEL}`, {
    method: "POST",
    headers: { Authorization: `Key ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      prompt: prompt(card),
      image_size: IMAGE_SIZE,
      num_images: 1,
      output_format: "jpeg",
      safety_tolerance: "4",
      seed,
    }),
  });
  if (!response.ok) throw new Error(`${card.id}: fal antwortet ${response.status} ${await response.text()}`);
  const result = (await response.json()) as { images: { url: string }[] };
  const image = await fetch(result.images[0]!.url);
  if (!image.ok) throw new Error(`${card.id}: Download fehlgeschlagen (${image.status})`);
  await Bun.write(`${OUT_DIR}/${card.id}.jpg`, await image.arrayBuffer());
  console.log(`✓ ${card.id}`);
}

const apiKey = process.env.FAL_KEY;
if (!apiKey) throw new Error("FAL_KEY fehlt in der Umgebung.");

const args = process.argv.slice(2);
const force = args.includes("--force");
const requested = new Set(args.filter((arg) => !arg.startsWith("--")));
const all: readonly Card[] = [...SHIPS, ...COMMANDS];
const unknown = [...requested].filter((id) => !all.some((card) => card.id === id));
if (unknown.length) throw new Error(`Unbekannte Karten: ${unknown.join(", ")}`);

const queue = all.filter((card, index) => {
  if (requested.size) return requested.has(card.id);
  return force || !Bun.file(`${OUT_DIR}/${card.id}.jpg`).size;
});
console.log(`${queue.length} Bild(er) über ${MODEL} …`);

const failed: string[] = [];
await Promise.all(
  Array.from({ length: PARALLEL }, async () => {
    for (let card = queue.shift(); card; card = queue.shift()) {
      // Fester Seed je Karte, damit ein erneuter Lauf dasselbe Bild liefert.
      const seed = 1000 + all.findIndex((c) => c.id === card!.id);
      await generate(card, seed, apiKey).catch((error) => {
        failed.push(card!.id);
        console.error(`✗ ${(error as Error).message}`);
      });
    }
  }),
);
if (failed.length) {
  console.error(`Fehlgeschlagen: ${failed.join(", ")}`);
  process.exit(1);
}
