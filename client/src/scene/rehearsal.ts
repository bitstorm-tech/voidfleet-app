// Generalprobe hinter dem Ladebildschirm: Babylon übersetzt einen Shader erst, wenn etwas zum ersten
// Mal gezeichnet wird, und das Bild stockt dabei. Deshalb wird beim Laden alles einmal gezeigt, was im
// Spiel vorkommt — Schiffe mit Treffer-Blitz, Geister, glühende Wracks und alle Effekte — und danach
// wieder entsorgt. Die Shader bleiben übersetzt, weil `Effect.PersistentMode` sie nie freigibt (`matchScene.ts`).

import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { SHIPS } from "../../../shared/cards.ts";
import { color3 } from "../data/palette.ts";
import { HIT_NAMES } from "./effects.ts";
import type { MatchScene } from "./matchScene.ts";
import { ShipView } from "./ship.ts";

/** Mitten auf dem Brett, damit alles im Bild liegt: Manches übersetzt Babylon erst beim Zeichnen. */
const STAGE = new Vector3(0, 0.5, 2.5);

export async function rehearse(view: MatchScene): Promise<void> {
  const { scene, effects } = view;
  const color = color3("player");
  const ships: ShipView[] = [];
  for (const card of SHIPS) {
    const ship = new ShipView(scene, card, false);
    const ghost = new ShipView(scene, card, true);
    const wrecked = new ShipView(scene, card, false);
    const { pieces } = wrecked.breakApart();
    // Wie in `destruction.ts`: Glut, Blendlicht und Ausblenden laufen über das Overlay.
    for (const mesh of wrecked.root.getChildMeshes()) mesh.renderOverlay = true;
    effects.burn(pieces[0]!, 1, 0.3, 50);
    void ship.flash();
    ships.push(ship, ghost, wrecked);
  }
  for (const ship of ships) ship.root.position.copyFrom(STAGE);

  effects.pop(STAGE, Vector3.Up(), 1);
  const shots = [
    effects.bolt(STAGE.add(new Vector3(-3, 0, 0)), STAGE, color),
    ...HIT_NAMES.map((name) => effects.hit(STAGE, STAGE.add(new Vector3(-3, 0, 0)), color, name)),
    effects.detonate(STAGE, color, 1, "fire"),
    effects.detonate(STAGE, color, 1, "energy"),
  ];
  // Auch alles, was noch ausgeblendet ist (leuchtende Slots, Bogenpfeil), wird dabei übersetzt.
  await scene.whenReadyAsync();
  await Promise.all(shots);
  for (const ship of ships) ship.dispose();
  // Erst wenn der letzte Funke verglüht ist, darf der Ladebildschirm den Blick freigeben.
  await new Promise<void>((resolve) => {
    const observer = scene.onAfterRenderObservable.add(() => {
      if (scene.particleSystems.length > 0) return;
      scene.onAfterRenderObservable.remove(observer);
      resolve();
    });
  });
}
