// Zeit-Helfer für Animationen im Render-Takt der Szene. Läuft die Szene nicht
// (Tab im Hintergrund), pausieren die Animationen mit ihr. Alle Animationen
// (Tweens, Partikel und über `--animation-time-scale` auch CSS) sind um die
// eingestellte Geschwindigkeit gestreckt; Angriffe und Schiffsbewegungen haben eigene Regler.

import type { Scene } from "@babylonjs/core/scene";
import { ANIMATION_SPEEDS, onSettingsChange, settings } from "../settings.ts";

export type AnimationScope = "attack" | "movement" | "general";

const SCOPE_SETTINGS = { attack: "attackSpeed", movement: "movementSpeed", general: "animationSpeed" } as const;

let scope: AnimationScope = "general";

/** Welcher Regler gerade gilt; die Rundenwiedergabe schaltet für Angriffe um. */
export function setAnimationScope(next: AnimationScope): void {
  scope = next;
  applyCssTimeScale();
}

export function animationTimeScale(of: AnimationScope = scope): number {
  return ANIMATION_SPEEDS[settings[SCOPE_SETTINGS[of]]];
}

function applyCssTimeScale(): void {
  document.documentElement.style.setProperty("--animation-time-scale", String(animationTimeScale()));
}

applyCssTimeScale();
onSettingsChange(applyCssTimeScale);

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

/** Ob gerade übersprungen wird; Soundeffekte bleiben dann stumm. */
export function animationsSkipped(): boolean {
  return isSkipping;
}

/**
 * Ruft `update` jeden Frame mit dem Fortschritt 0..1 auf und endet nach `duration` ms vor der Streckung
 * durch `tweenScope` (sonst den beim Start geltenden Regler); eine Umstellung der Einstellung wirkt auch auf laufende Tweens.
 */
export function tween(scene: Scene, duration: number, update: (progress: number) => void, tweenScope = scope): Promise<void> {
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
      elapsed += scene.getEngine().getDeltaTime() / animationTimeScale(tweenScope);
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
