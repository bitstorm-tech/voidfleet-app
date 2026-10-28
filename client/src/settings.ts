// Spieler-Einstellungen, vorerst nur im Browser (`localStorage`) gespeichert.
// Änderungen gelten sofort; wer darauf reagieren muss, meldet sich mit `onSettingsChange` an.

import type { Locale } from "./i18n/index.ts";
import type { CursorId } from "./ui/cursor.ts";

/**
 * Animationsgeschwindigkeit als Streckungsfaktor aller Animationen (Tweens,
 * Partikel und CSS); 1 spielt die Dauern so ab, wie sie im Code stehen. „Langsam“ und
 * „Normal“ liegen nah beieinander, „Schnell“ und „Sehr schnell“ beschleunigen deutlich.
 */
export const ANIMATION_SPEEDS = { slow: 1.6, normal: 1.25, fast: 0.6, veryFast: 0.35 } as const;

export type AnimationSpeed = keyof typeof ANIMATION_SPEEDS;

export interface Settings {
  /** Lautstärke von Musik, Effekten und Bordfunk, jeweils 0..1; Bordfunk auf 0 schaltet ihn samt Untertiteln ab. */
  musicVolume: number;
  effectsVolume: number;
  voiceVolume: number;
  /** Schüsse im Kampf. */
  attackSpeed: AnimationSpeed;
  /** Flüge der Schiffe: Deploy-Einflug und Lane-Wechsel. */
  movementSpeed: AnimationSpeed;
  /** Alle übrigen Animationen. */
  animationSpeed: AnimationSpeed;
  /**
   * Zuletzt eingestellte Kamera, das nächste Match beginnt dort: Stand zwischen den Ansichten (0 von der Seite, 1 von
   * hinten oben) und Versatz durch Zoom und Verschieben aus der Ruhelage (Welt-x, -y, -z).
   */
  camera: { view: number; zoom: [number, number, number] };
  /** Gewählter Mauszeiger (`ui/cursor.ts`). */
  cursor: CursorId;
  /** Gewählte Sprache; ohne Wahl gilt die Browsersprache. */
  language?: Locale;
}

const STORAGE_KEY = "voidfleet.settings";
const DEFAULTS: Settings = {
  musicVolume: 0.6,
  effectsVolume: 0.8,
  voiceVolume: 0.8,
  attackSpeed: "normal",
  movementSpeed: "normal",
  animationSpeed: "normal",
  camera: { view: 1, zoom: [0, 0, 0] },
  cursor: "classic",
};

export const settings: Settings = { ...DEFAULTS, ...JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}") };

const listeners = new Set<() => void>();

export function updateSettings(changes: Partial<Settings>): void {
  Object.assign(settings, changes);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  for (const listener of listeners) listener();
}

export function onSettingsChange(listener: () => void): void {
  listeners.add(listener);
}
