// Zeit-Helfer für Animationen im Render-Takt der Szene. Läuft die Szene nicht
// (Tab im Hintergrund), pausieren die Animationen mit ihr.

import type { Scene } from "@babylonjs/core/scene";

/** Ruft `update` jeden Frame mit dem Fortschritt 0..1 auf und endet nach `duration` ms. */
export function tween(scene: Scene, duration: number, update: (progress: number) => void): Promise<void> {
  return new Promise((resolve) => {
    let elapsed = 0;
    update(0);
    const observer = scene.onBeforeRenderObservable.add(() => {
      elapsed += scene.getEngine().getDeltaTime();
      const progress = Math.min(elapsed / duration, 1);
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
