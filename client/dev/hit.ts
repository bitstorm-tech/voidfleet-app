// Vorschau des Treffer-Effekts ohne Server: zwei Schiffe beschießen sich abwechselnd.
// `?slow=4` bremst die ganze Szene (Tweens und Partikel) um den Faktor,
// `?hit=<name>` erzwingt eine Einschlag-Variante statt der zufälligen Wahl.

import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Board } from "../../shared/board.ts";
import { SHIPS } from "../../shared/cards.ts";
import { loadSounds } from "../src/audio/sounds.ts";
import { HIT_NAMES, type HitName } from "../src/scene/effects.ts";
import { MatchScene } from "../src/scene/matchScene.ts";
import { loadShipModels, ShipView } from "../src/scene/ship.ts";
import type { SlotPad } from "../src/scene/slotPad.ts";
import { wait } from "../src/scene/tween.ts";

declare global {
  interface Window {
    /** Abgeschlossene Treffer, zum Synchronisieren von Screenshot-Serien. */
    hitCount: number;
  }
}

const canvas = document.getElementById("render-canvas") as HTMLCanvasElement;
const view = new MatchScene(canvas, new Board());
await Promise.all([...loadShipModels(view.scene), ...loadSounds()]);
const params = new URLSearchParams(location.search);
const slow = Number(params.get("slow") ?? 1);
const forcedHit = HIT_NAMES.find((name) => name === params.get("hit"));
const realDelta = view.engine.getDeltaTime.bind(view.engine);
view.engine.getDeltaTime = () => realDelta() / slow;

const SHIP_CENTER = new Vector3(0, 0.15, 0);
const HULL_RADIUS = 0.45;
const COLORS = { player: new Color3(0.35, 0.85, 1), enemy: new Color3(1, 0.42, 0.32) };

const player = view.pad("player", "strike", 3);
const enemy = view.pad("enemy", "strike", 3);
player.attachShip(new ShipView(view.scene, SHIPS[0]!, false));
enemy.attachShip(new ShipView(view.scene, SHIPS[1]!, false));
view.pad("player", "command", 2).attachShip(new ShipView(view.scene, SHIPS[2]!, false));
view.pad("enemy", "command", 4).attachShip(new ShipView(view.scene, SHIPS[3]!, false));

const centerOf = (pad: SlotPad) => pad.shipAnchor.getAbsolutePosition().add(SHIP_CENTER);

async function shoot(from: SlotPad, to: SlotPad, color: Color3): Promise<void> {
  const origin = centerOf(from);
  const center = centerOf(to);
  const impact = center.subtract(center.subtract(origin).normalize().scale(HULL_RADIUS));
  void view.effects.pulse(origin, color, 0.7, 180);
  await view.effects.bolt(origin, impact, color);
  await Promise.all([to.ship!.flash(), view.effects.hit(impact, origin, color, forcedHit)]);
}

window.hitCount = 0;
void (async () => {
  await wait(view.scene, 800);
  for (;;) {
    await shoot(player, enemy, COLORS.player);
    window.hitCount++;
    await wait(view.scene, 900);
    await shoot(enemy, player, COLORS.enemy);
    window.hitCount++;
    await wait(view.scene, 900);
  }
})();
