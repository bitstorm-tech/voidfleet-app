// Soundeffekte und Musik, erzeugt mit `tools/generateAudio.ts` (fal.ai: ElevenLabs Sound Effects und Music).
// Ein Effekt hat eine oder mehrere Varianten (`sfx/<id>_<n>.mp3`), von denen jedes Abspielen eine zufällig
// wählt. Alle Varianten werden beim Laden auf gleiche Lautheit gebracht (`audio/sounds.ts`); `volume` legt
// nur noch fest, wie laut ein Effekt im Verhältnis zu den anderen ist.

import cannon_heavy_1 from "../../assets/audio/sfx/cannon_heavy_1.mp3";
import cannon_heavy_2 from "../../assets/audio/sfx/cannon_heavy_2.mp3";
import defeat_1 from "../../assets/audio/sfx/defeat_1.mp3";
import defeat_2 from "../../assets/audio/sfx/defeat_2.mp3";
import emp_1 from "../../assets/audio/sfx/emp_1.mp3";
import engine_heavy_1 from "../../assets/audio/sfx/engine_heavy_1.mp3";
import engine_light_1 from "../../assets/audio/sfx/engine_light_1.mp3";
import engine_medium_1 from "../../assets/audio/sfx/engine_medium_1.mp3";
import explosion_large_1 from "../../assets/audio/sfx/explosion_large_1.mp3";
import explosion_large_2 from "../../assets/audio/sfx/explosion_large_2.mp3";
import explosion_small_1 from "../../assets/audio/sfx/explosion_small_1.mp3";
import explosion_small_2 from "../../assets/audio/sfx/explosion_small_2.mp3";
import explosion_small_3 from "../../assets/audio/sfx/explosion_small_3.mp3";
import hull_stress_1 from "../../assets/audio/sfx/hull_stress_1.mp3";
import hull_stress_2 from "../../assets/audio/sfx/hull_stress_2.mp3";
import impact_energy_1 from "../../assets/audio/sfx/impact_energy_1.mp3";
import impact_energy_2 from "../../assets/audio/sfx/impact_energy_2.mp3";
import impact_fire_1 from "../../assets/audio/sfx/impact_fire_1.mp3";
import impact_fire_2 from "../../assets/audio/sfx/impact_fire_2.mp3";
import impact_fire_3 from "../../assets/audio/sfx/impact_fire_3.mp3";
import impact_metal_1 from "../../assets/audio/sfx/impact_metal_1.mp3";
import impact_metal_2 from "../../assets/audio/sfx/impact_metal_2.mp3";
import impact_metal_3 from "../../assets/audio/sfx/impact_metal_3.mp3";
import jammer_1 from "../../assets/audio/sfx/jammer_1.mp3";
import laser_light_1 from "../../assets/audio/sfx/laser_light_1.mp3";
import laser_light_2 from "../../assets/audio/sfx/laser_light_2.mp3";
import laser_light_3 from "../../assets/audio/sfx/laser_light_3.mp3";
import laser_medium_1 from "../../assets/audio/sfx/laser_medium_1.mp3";
import laser_medium_2 from "../../assets/audio/sfx/laser_medium_2.mp3";
import laser_medium_3 from "../../assets/audio/sfx/laser_medium_3.mp3";
import missile_volley_1 from "../../assets/audio/sfx/missile_volley_1.mp3";
import orbital_strike_1 from "../../assets/audio/sfx/orbital_strike_1.mp3";
import plasma_shot_1 from "../../assets/audio/sfx/plasma_shot_1.mp3";
import plasma_shot_2 from "../../assets/audio/sfx/plasma_shot_2.mp3";
import power_up_1 from "../../assets/audio/sfx/power_up_1.mp3";
import reactor_breach_1 from "../../assets/audio/sfx/reactor_breach_1.mp3";
import repair_1 from "../../assets/audio/sfx/repair_1.mp3";
import scavenge_1 from "../../assets/audio/sfx/scavenge_1.mp3";
import shield_up_1 from "../../assets/audio/sfx/shield_up_1.mp3";
import victory_1 from "../../assets/audio/sfx/victory_1.mp3";
import victory_2 from "../../assets/audio/sfx/victory_2.mp3";
import battle from "../../assets/audio/music/battle.mp3";
import calm from "../../assets/audio/music/calm.mp3";

export const SOUNDS = {
  // Waffen, je nach Schiff
  laser_light: { files: [laser_light_1, laser_light_2, laser_light_3], volume: 0.4 },
  laser_medium: { files: [laser_medium_1, laser_medium_2, laser_medium_3], volume: 0.45 },
  cannon_heavy: { files: [cannon_heavy_1, cannon_heavy_2], volume: 0.6 },
  plasma_shot: { files: [plasma_shot_1, plasma_shot_2], volume: 0.5 },
  // Einschläge
  impact_metal: { files: [impact_metal_1, impact_metal_2, impact_metal_3], volume: 0.5 },
  impact_fire: { files: [impact_fire_1, impact_fire_2, impact_fire_3], volume: 0.55 },
  impact_energy: { files: [impact_energy_1, impact_energy_2], volume: 0.5 },
  // Zerstörung
  hull_stress: { files: [hull_stress_1, hull_stress_2], volume: 0.6 },
  explosion_small: { files: [explosion_small_1, explosion_small_2, explosion_small_3], volume: 0.65 },
  explosion_large: { files: [explosion_large_1, explosion_large_2], volume: 1 },
  reactor_breach: { files: [reactor_breach_1], volume: 0.7 },
  // Triebwerke (Schleifen)
  engine_light: { files: [engine_light_1], volume: 0.3 },
  engine_medium: { files: [engine_medium_1], volume: 0.3 },
  engine_heavy: { files: [engine_heavy_1], volume: 0.35 },
  // Befehle
  orbital_strike: { files: [orbital_strike_1], volume: 0.8 },
  missile_volley: { files: [missile_volley_1], volume: 0.6 },
  power_up: { files: [power_up_1], volume: 0.45 },
  jammer: { files: [jammer_1], volume: 0.4 },
  shield_up: { files: [shield_up_1], volume: 0.45 },
  emp: { files: [emp_1], volume: 0.6 },
  repair: { files: [repair_1], volume: 0.45 },
  scavenge: { files: [scavenge_1], volume: 0.45 },
  // Spielausgang
  victory: { files: [victory_1, victory_2], volume: 0.8 },
  defeat: { files: [defeat_1, defeat_2], volume: 0.8 },
} satisfies Record<string, { files: string[]; volume: number }>;

export type SoundId = keyof typeof SOUNDS;

/**
 * Hintergrundmusik: ruhig während der Planung, angespannt während eine Runde abgespielt wird. Die Stücke
 * blenden ein und aus; endlos läuft nur der Kernteil `loop` (Sekunden), gemessen mit `dev/sounds.html`.
 */
export const MUSIC = {
  calm: { file: calm, loop: [10, 161] },
  battle: { file: battle, loop: [4, 114] },
} satisfies Record<string, { file: string; loop: [number, number] }>;

export type MusicMood = keyof typeof MUSIC;
