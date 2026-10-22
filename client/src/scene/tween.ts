// Zeit-Helfer für Animationen im Render-Takt der Szene. Läuft die Szene nicht
// (Tab im Hintergrund), pausieren die Animationen mit ihr.

import type { Scene } from "@babylonjs/core/scene";

/**
 * Streckt alle Animationen gleichmäßig: Die Auflösung einer Runde soll sich
 * cineastisch anfühlen, nicht hektisch. Gilt auch für die CSS-Animationen
 * (`--animation-time-scale`, gesetzt in `main.ts`).
 */
export const ANIMATION_TIME_SCALE = 2;

/** Ruft `update` jeden Frame mit dem Fortschritt 0..1 auf und endet nach `duration` ms (vor der Streckung). */
export function tween(scene: Scene, duration: number, update: (progress: number) => void): Promise<void> {
  const scaledDuration = duration * ANIMATION_TIME_SCALE;
  return new Promise((resolve) => {
    let elapsed = 0;
    update(0);
    const observer = scene.onBeforeRenderObservable.add(() => {
      elapsed += scene.getEngine().getDeltaTime();
      const progress = Math.min(elapsed / scaledDuration, 1);
      update(progress);
      if (progress === 1) {
        scene.onBeforeRenderObservable.remove(observer);
        resolve();
      }
    });
  });
}

export function wait(scene: Scene, duration: number): Promise<void> {
  return tween(scene, duration, () => {});
}

export const easeOutCubic = (t: number) => 1 - (1 - t) ** 3;
export const easeInCubic = (t: number) => t ** 3;
export const easeInOutSine = (t: number) => -(Math.cos(Math.PI * t) - 1) / 2;
