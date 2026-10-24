// Spieler-Einstellungen, vorerst nur im Browser (`localStorage`) gespeichert.
// Änderungen gelten sofort; wer darauf reagieren muss, meldet sich mit `onSettingsChange` an.

import type { Locale } from "./i18n/index.ts";

/**
 * Animationsgeschwindigkeit als Streckungsfaktor aller Animationen (Tweens,
 * Partikel und CSS). „Normal“ spielt die Dauern so ab, wie sie im Code stehen.
 */
export const ANIMATION_SPEEDS = { slow: 2, normal: 1, fast: 0.6, veryFast: 0.35 } as const;

export type AnimationSpeed = keyof typeof ANIMATION_SPEEDS;

export interface Settings {
  /** Lautstärke von Musik und Effekten, jeweils 0..1. */
  musicVolume: number;
  effectsVolume: number;
  /** Schüsse im Kampf. */
  attackSpeed: AnimationSpeed;
  /** Flüge der Schiffe: Deploy-Einflug und Lane-Wechsel. */
  movementSpeed: AnimationSpeed;
  /** Alle übrigen Animationen. */
  animationSpeed: AnimationSpeed;
  /** Gewählte Sprache; ohne Wahl gilt die Browsersprache. */
  language?: Locale;
}

const STORAGE_KEY = "voidfleet.settings";
const DEFAULTS: Settings = {
  musicVolume: 0.6,
  effectsVolume: 0.8,
  attackSpeed: "normal",
  movementSpeed: "normal",
  animationSpeed: "normal",
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
