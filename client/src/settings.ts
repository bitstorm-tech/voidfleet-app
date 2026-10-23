// Spieler-Einstellungen, vorerst nur im Browser (`localStorage`) gespeichert.
// Änderungen gelten sofort; wer darauf reagieren muss, meldet sich mit `onSettingsChange` an.

/**
 * Animationsgeschwindigkeit als Streckungsfaktor aller Animationen (Tweens,
 * Partikel und CSS). „Normal“ streckt auf das Doppelte: Die Auflösung einer
 * Runde soll sich cineastisch anfühlen, nicht hektisch.
 */
export const ANIMATION_SPEEDS = { slow: 3, normal: 2, fast: 1.2, veryFast: 0.6 } as const;

export type AnimationSpeed = keyof typeof ANIMATION_SPEEDS;

export interface Settings {
  /** Schüsse im Kampf. */
  attackSpeed: AnimationSpeed;
  /** Alle übrigen Animationen. */
  animationSpeed: AnimationSpeed;
}

const STORAGE_KEY = "voidfleet.settings";
const DEFAULTS: Settings = { attackSpeed: "normal", animationSpeed: "normal" };

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
