// Zeit-Helfer für Animationen im Render-Takt der Szene. Läuft die Szene nicht
// (Tab im Hintergrund), pausieren die Animationen mit ihr.

import type { Scene } from "@babylonjs/core/scene";
import { animationTimeScale } from "../settings.ts";

/** Laufende Tweens, die `skipAnimations` sofort auf ihren Endzustand setzen kann. */
const running = new Set<() => void>();
let isSkipping = false;

/**
 * Überspringen an/aus: Beim Einschalten springen alle laufenden Tweens auf ihr
 * Ende, und solange es an ist, enden neue Tweens sofort.
 */
export function skipAnimations(skip: boolean): void {
  isSkipping = skip;
  if (skip) for (const finish of [...running]) finish();
}

/**
 * Ruft `update` jeden Frame mit dem Fortschritt 0..1 auf und endet nach `duration` ms vor der Streckung
 * durch die eingestellte Animationsgeschwindigkeit; eine Umstellung wirkt auch auf laufende Tweens.
 */
export function tween(scene: Scene, duration: number, update: (progress: number) => void): Promise<void> {
  return new Promise((resolve) => {
    const finish = () => {
      scene.onBeforeRenderObservable.remove(observer);
      running.delete(finish);
      update(1);
      resolve();
    };
    let elapsed = 0;
    update(0);
    const observer = scene.onBeforeRenderObservable.add(() => {
      elapsed += scene.getEngine().getDeltaTime() / animationTimeScale();
      if (elapsed >= duration) return finish();
      update(elapsed / duration);
    });
    running.add(finish);
    if (isSkipping) finish();
  });
}

export function wait(scene: Scene, duration: number): Promise<void> {
  return tween(scene, duration, () => {});
}

export const easeOutCubic = (t: number) => 1 - (1 - t) ** 3;
export const easeInCubic = (t: number) => t ** 3;
export const easeInOutSine = (t: number) => -(Math.cos(Math.PI * t) - 1) / 2;
