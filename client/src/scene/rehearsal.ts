// Generalprobe hinter dem Ladebildschirm: Babylon übersetzt einen Shader erst, wenn etwas zum ersten
// Mal gezeichnet wird, und das Bild stockt dabei. Deshalb wird beim Laden alles einmal gezeigt, was im
// Spiel vorkommt — Schiffe samt Flaggschiffen (Ring, Krone) und Trugbild mit Treffer-Blitz und Zielvorschau (dabei
// auch Toon-Material, Kantenpuffer und Glühen der Schiffslichter), Geister, Wracks mit glühenden Bruchflächen (die
// zweite Variante des Toon-Materials, im Glühen mit Glutmuster), alle Marken am Boden (auch der Leuchtring der
// Ablenkung, Bereitschaft und Visier der Feuerbefehle), die Bögen der Zielvorschau in jeder Darstellung (gewählt,
// verpuffend) und alle Effekte samt verpuffendem Bolzen, Zielmarke, Railgun-Strahl, Schildblase, Rakete des
// Wärmesuchers mit Leuchtspur und Traktorstrahl — und danach wieder entsorgt. Die Shader bleiben übersetzt, weil
// `Effect.PersistentMode` sie nie freigibt (`matchScene.ts`). Die Effekte bleiben dabei stumm, auch wenn ein Klick auf
// den Ladebildschirm den Ton schon freigegeben hat.

import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { FLAGSHIPS, SHIPS, TOKENS } from "../../../shared/cards.ts";
import { muteSounds } from "../audio/sounds.ts";
import { color3 } from "../data/palette.ts";
import { HIT_NAMES } from "./effects.ts";
import type { MarkerKind } from "./markers.ts";
import type { MatchScene } from "./matchScene.ts";
import { ShipView } from "./ship.ts";
import { wait } from "./tween.ts";

/** Die Marken, die zu einem Schiff dazukommen; den Ring tragen die Flaggschiffe von selbst. */
const MARKERS: readonly Exclude<MarkerKind, "halo">[] = ["lock", "counterfire", "focus_fire", "swarm_strike", "head_start", "taunt", "ready", "aim"];

/** Mitten auf dem Brett, damit alles im Bild liegt: Manches übersetzt Babylon erst beim Zeichnen. */
const STAGE = new Vector3(0, 0.5, 2.5);

export async function rehearse(view: MatchScene): Promise<void> {
  const { scene, effects } = view;
  const color = color3("player");
  muteSounds(true);
  const ships: ShipView[] = [];
  for (const card of [...SHIPS, ...TOKENS, ...FLAGSHIPS]) {
    const ship = new ShipView(scene, card, false);
    const ghost = new ShipView(scene, card, true);
    const wrecked = new ShipView(scene, card, false);
    const pieces = wrecked.breakApart();
    // Wie in `destruction.ts`: Die Bruchflächen glühen, Blendlicht und Ausblenden laufen über das Overlay.
    wrecked.toon.heat = new Color3(1, 0.5, 0.2);
    for (const mesh of wrecked.root.getChildMeshes()) mesh.renderOverlay = true;
    effects.burn(pieces[0]!, 1, 0.3, 50);
    void ship.flash();
    ship.setPreview({ hp: 1, shield: 0 });
    ship.setDoomed(true);
    ghost.setDoomed(true);
    ships.push(ship, ghost, wrecked);
  }
  ships[0]!.setMarkers(MARKERS.map((kind, index) => ({ kind, color, planned: index === 0 })));
  for (const ship of ships) ship.root.position.copyFrom(STAGE);
  // Je Seite jede Darstellung der Bögen: Schuss, gewählter Schuss, verpuffender, gewählter verpuffender, alle mit dem
  // Ring des Schiffsfeuers.
  const lines = (["player", "enemy"] as const).flatMap((side) =>
    [0, 1, 2, 3].map((index) => ({
      from: view.pad(side, "strike", index),
      to: view.pad(side, "command", 5 - index),
      side,
      selected: index % 2 === 1,
      fizzle: index >= 2,
      tracking: true,
    })),
  );
  view.targetLines.show(lines);

  effects.pop(STAGE, Vector3.Up(), 1);
  const shots = [
    effects.bolt(STAGE.add(new Vector3(-3, 0, 0)), STAGE, color),
    effects.fizzle(STAGE.add(new Vector3(-3, 0, 0)), STAGE, color),
    effects.reticle(STAGE, color),
    ...HIT_NAMES.map((name) => effects.hit(STAGE, STAGE.add(new Vector3(-3, 0, 0)), color, name)),
    effects.detonate(STAGE, color, 1, "fire"),
    effects.detonate(STAGE, color, 1, "energy"),
    effects.beam(STAGE.add(new Vector3(-3, 0, 0)), STAGE, color),
    effects.bubble(STAGE, color, 2),
    effects.missile(STAGE.add(new Vector3(-3, 0, 0)), STAGE, color),
    (async () => {
      const release = effects.tether(STAGE.add(new Vector3(-3, 3, 0)), () => STAGE, color);
      await wait(scene, 300);
      await release();
    })(),
  ];
  // Auch alles, was noch ausgeblendet ist (leuchtende Slots, Bogenpfeil), wird dabei übersetzt.
  await scene.whenReadyAsync();
  await Promise.all(shots);
  view.targetLines.show([]);
  for (const ship of ships) ship.dispose();
  // Erst wenn der letzte Funke verglüht ist, darf der Ladebildschirm den Blick freigeben.
  await new Promise<void>((resolve) => {
    const observer = scene.onAfterRenderObservable.add(() => {
      if (scene.particleSystems.length > 0) return;
      scene.onAfterRenderObservable.remove(observer);
      resolve();
    });
  });
  muteSounds(false);
}
