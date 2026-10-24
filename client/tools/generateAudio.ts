// Erzeugt die Soundeffekte und die Hintergrundmusik über fal.ai und legt sie unter `assets/audio/` ab:
// Effekte mit ElevenLabs Sound Effects v2 als `sfx/<id>_<n>.mp3` (mehrere Varianten je Sound, eingebunden
// in `src/data/sounds.ts`), Musik mit ElevenLabs Music als `music/<id>.mp3`. Vorhandene Dateien werden
// übersprungen; eine missratene Variante löscht man und startet das Skript erneut.
//
//   FAL_KEY=… bun tools/generateAudio.ts                       # alle fehlenden Dateien
//   FAL_KEY=… bun tools/generateAudio.ts --force               # alle neu
//   FAL_KEY=… bun tools/generateAudio.ts explosion_large calm  # nur diese (immer neu, alle Varianten)

import { mkdir } from "node:fs/promises";

const SFX_MODEL = "fal-ai/elevenlabs/sound-effects/v2";
const MUSIC_MODEL = "fal-ai/elevenlabs/music";
const OUT_DIR = `${import.meta.dir}/../assets/audio`;
const PARALLEL = 4;
const POLL_INTERVAL = 1500;

/** Effekte stehen für sich, damit sie sich im Spiel frei mit Musik und anderen Effekten mischen lassen. */
const fx = (text: string) => `${text} Cinematic science-fiction space battle sound effect, isolated, clean, no music, no voice.`;

interface SoundJob {
  prompt: string;
  /** Länge in Sekunden (0,5–22). */
  seconds: number;
  variants: number;
  /** Nahtlose Schleife, für Triebwerke. */
  loop?: true;
}

const SOUNDS: Record<string, SoundJob> = {
  // Waffen, je nach Schiff
  laser_light: {
    prompt: fx("A single short laser blaster shot from a small starfighter: a bright, punchy pew with a fast electric zap tail."),
    seconds: 0.7,
    variants: 3,
  },
  laser_medium: {
    prompt: fx("A single laser cannon shot from a mid-size warship: a powerful energy blast with a crisp attack and a short sizzling tail."),
    seconds: 1,
    variants: 3,
  },
  cannon_heavy: {
    prompt: fx("A single shot from a heavy battleship energy turret: a deep, booming cannon blast with a low rumbling tail."),
    seconds: 1.5,
    variants: 2,
  },
  plasma_shot: {
    prompt: fx("A plasma cannon firing: a very short rising charge whine followed by a thick, sizzling plasma bolt whooshing away."),
    seconds: 1.2,
    variants: 2,
  },
  // Einschläge, passend zu den Einschlag-Varianten in `src/scene/effects.ts`
  impact_metal: {
    prompt: fx("An energy bolt slamming into thick starship armor plating: a sharp metallic clang with a burst of crackling sparks."),
    seconds: 0.9,
    variants: 3,
  },
  impact_fire: {
    prompt: fx("An energy bolt hitting a starship hull and igniting a small fiery explosion: a punchy whoomp with crackling flames."),
    seconds: 1.2,
    variants: 3,
  },
  impact_energy: {
    prompt: fx("An energy bolt hitting a starship and discharging: a sharp electric crackle and zap with buzzing arcs."),
    seconds: 0.9,
    variants: 2,
  },
  // Zerstörung
  hull_stress: {
    prompt: fx("A starship hull groaning under extreme stress just before it breaks apart: deep bending and creaking metal, crackling electrical failures."),
    seconds: 2.5,
    variants: 2,
  },
  explosion_small: {
    prompt: fx(
      "A small spaceship exploding: a deep, bass-heavy boom with a punchy low thump, a short rumble and a burst of debris.",
    ),
    seconds: 1.5,
    variants: 3,
  },
  explosion_large: {
    prompt: fx(
      "A massive starship exploding: an enormous, deep, bass-heavy detonation followed by a long rolling rumble like thunder and scattering metal debris.",
    ),
    seconds: 4,
    variants: 2,
  },
  reactor_breach: {
    prompt: fx("A starship reactor core breaching: a violent electric energy discharge, a rising whine and a crackling plasma burst."),
    seconds: 2.5,
    variants: 1,
  },
  // Triebwerke beim Deploy-Einflug und Lane-Wechsel, je nach Schiffsklasse
  engine_light: {
    prompt: fx("The steady engine of a small, agile starfighter in flight: a smooth, high-pitched jet thruster hum."),
    seconds: 3,
    variants: 1,
    loop: true,
  },
  engine_medium: {
    prompt: fx("The steady engines of a mid-size spaceship in flight: a smooth, even thruster drone."),
    seconds: 3,
    variants: 1,
    loop: true,
  },
  engine_heavy: {
    prompt: fx("The engines of a huge capital warship in flight: a deep, powerful, rumbling thruster drone."),
    seconds: 4,
    variants: 1,
    loop: true,
  },
  // Befehle: nur die Ursache, der Einschlag kommt von den Einschlägen oben
  orbital_strike: {
    prompt: fx("An orbital laser cannon firing from high above: a rising charge-up whine that releases into a powerful descending energy beam."),
    seconds: 3,
    variants: 1,
  },
  missile_volley: {
    prompt: fx("A salvo of many small missiles launching in rapid succession: overlapping ignitions and whooshes streaking away."),
    seconds: 2.5,
    variants: 1,
  },
  power_up: {
    prompt: fx("Energy surging into a starship's weapon systems: a rising electric power-up hum with a bright shimmer."),
    seconds: 1.8,
    variants: 1,
  },
  jammer: {
    prompt: fx("An electronic jamming signal: harsh radio static and glitchy, scrambled interference bursts."),
    seconds: 1.8,
    variants: 1,
  },
  shield_up: {
    prompt: fx("An energy force field shield activating around a starship: a swelling, resonant hum with a soft shimmer."),
    seconds: 1.8,
    variants: 1,
  },
  emp: {
    prompt: fx("An electromagnetic pulse blast: a deep thump with spreading electric crackle, then systems powering down with a falling whine."),
    seconds: 2.5,
    variants: 1,
  },
  repair: {
    prompt: fx("Repair drones fixing a starship hull: quick welding sparks and soft mechanical whirring, ending in a gentle positive tone."),
    seconds: 2,
    variants: 1,
  },
  scavenge: {
    prompt: fx("A tractor beam humming while pulling in floating metal salvage: a steady energy hum with soft metallic clanks."),
    seconds: 2.5,
    variants: 1,
  },
  // Spielausgang
  victory: {
    prompt: "A short triumphant orchestral victory fanfare with bold brass and timpani, epic science-fiction film style, ending on a sustained major chord.",
    seconds: 5,
    variants: 2,
  },
  defeat: {
    prompt: "A short somber defeat stinger: low brass and strings sinking into a dark, fading synth drone, science-fiction film style.",
    seconds: 5,
    variants: 2,
  },
};

/** Beide Stimmungen in derselben Tonart, damit die Überblendung zwischen ihnen nicht holpert. */
const MUSIC: Record<string, { prompt: string; seconds: number }> = {
  calm: {
    prompt:
      "Dark, atmospheric space ambient underscore for a turn-based science-fiction strategy card game. " +
      "Slowly evolving analog synth pads, deep sub-bass drones, distant metallic textures and sparse, soft high piano notes. " +
      "Subtle tension, spacious and calm, no drums, no melody that demands attention, unobtrusive for long listening. D minor, 70 BPM.",
    seconds: 180,
  },
  battle: {
    prompt:
      "Tense cinematic space battle underscore for a science-fiction strategy card game. " +
      "Pulsing low synth ostinato, driving hybrid percussion with taiko drums, dark string swells and occasional brass hits. " +
      "Intense and propulsive but not overwhelming, steady throughout without a big intro or ending. D minor, 100 BPM.",
    seconds: 120,
  },
};

interface Job {
  id: string;
  path: string;
  model: string;
  input: Record<string, unknown>;
}

const jobs: Job[] = [
  ...Object.entries(SOUNDS).flatMap(([id, sound]) =>
    Array.from({ length: sound.variants }, (_, index) => ({
      id,
      path: `${OUT_DIR}/sfx/${id}_${index + 1}.mp3`,
      model: SFX_MODEL,
      input: { text: sound.prompt, duration_seconds: sound.seconds, prompt_influence: 0.5, loop: sound.loop ?? false },
    })),
  ),
  ...Object.entries(MUSIC).map(([id, track]) => ({
    id,
    path: `${OUT_DIR}/music/${id}.mp3`,
    model: MUSIC_MODEL,
    input: { prompt: track.prompt, music_length_ms: track.seconds * 1000, force_instrumental: true },
  })),
];

/** Über die Warteschlange von fal statt `fal.run`: Musik braucht länger, als ein einzelner Request offen bleibt. */
async function generate(job: Job, apiKey: string): Promise<void> {
  const headers = { Authorization: `Key ${apiKey}`, "Content-Type": "application/json" };
  const submitted = await fetch(`https://queue.fal.run/${job.model}`, { method: "POST", headers, body: JSON.stringify(job.input) });
  if (!submitted.ok) throw new Error(`${job.id}: fal antwortet ${submitted.status} ${await submitted.text()}`);
  const { status_url, response_url } = (await submitted.json()) as { status_url: string; response_url: string };
  for (;;) {
    await Bun.sleep(POLL_INTERVAL);
    const status = (await (await fetch(status_url, { headers })).json()) as { status: string };
    if (status.status === "COMPLETED") break;
  }
  const response = await fetch(response_url, { headers });
  if (!response.ok) throw new Error(`${job.id}: fal antwortet ${response.status} ${await response.text()}`);
  const result = (await response.json()) as { audio: { url: string } };
  const audio = await fetch(result.audio.url);
  if (!audio.ok) throw new Error(`${job.id}: Download fehlgeschlagen (${audio.status})`);
  await Bun.write(job.path, await audio.arrayBuffer());
  console.log(`✓ ${job.path.slice(OUT_DIR.length + 1)}`);
}

const apiKey = process.env.FAL_KEY;
if (!apiKey) throw new Error("FAL_KEY fehlt in der Umgebung.");

const args = process.argv.slice(2);
const force = args.includes("--force");
const requested = new Set(args.filter((arg) => !arg.startsWith("--")));
const unknown = [...requested].filter((id) => !jobs.some((job) => job.id === id));
if (unknown.length) throw new Error(`Unbekannte Sounds: ${unknown.join(", ")}`);

const queue = jobs.filter((job) => {
  if (requested.size) return requested.has(job.id);
  return force || !Bun.file(job.path).size;
});
await mkdir(`${OUT_DIR}/sfx`, { recursive: true });
await mkdir(`${OUT_DIR}/music`, { recursive: true });
console.log(`${queue.length} Datei(en) über fal.ai …`);

const failed: string[] = [];
await Promise.all(
  Array.from({ length: PARALLEL }, async () => {
    for (let job = queue.shift(); job; job = queue.shift()) {
      await generate(job, apiKey).catch((error) => {
        failed.push(job!.path.slice(OUT_DIR.length + 1));
        console.error(`✗ ${(error as Error).message}`);
      });
    }
  }),
);
if (failed.length) {
  console.error(`Fehlgeschlagen: ${failed.join(", ")}`);
  process.exit(1);
}
