// Vorschau des Deploy-Einflugs ohne Server: Schiffe fliegen in Dauerschleife von
// beiden Seiten ein, in die Strike-Lane teils über ein Schiff in der Command-Lane.
// `?slow=4` bremst die ganze Szene um den Faktor.

import { Board, type LaneType, type Side } from "../../shared/board.ts";
import { SHIPS } from "../../shared/cards.ts";
import { MatchScene } from "../src/scene/matchScene.ts";
import { ShipView } from "../src/scene/ship.ts";
import { wait } from "../src/scene/tween.ts";

declare global {
  interface Window {
    /** Abgeschlossene Einflüge, zum Synchronisieren von Screenshot-Serien. */
    arrivalCount: number;
  }
}

const canvas = document.getElementById("render-canvas") as HTMLCanvasElement;
const view = new MatchScene(canvas, new Board());
const slow = Number(new URLSearchParams(location.search).get("slow") ?? 1);
const realDelta = view.engine.getDeltaTime.bind(view.engine);
view.engine.getDeltaTime = () => realDelta() / slow;

view.pad("player", "command", 2).attachShip(new ShipView(view.scene, SHIPS[2]!, false));
view.pad("enemy", "command", 4).attachShip(new ShipView(view.scene, SHIPS[3]!, false));

async function arrive(side: Side, lane: LaneType, slotIndex: number, shipIndex: number): Promise<void> {
  await view.deploy(new ShipView(view.scene, SHIPS[shipIndex % SHIPS.length]!, false), side, lane, slotIndex);
}

window.arrivalCount = 0;
void (async () => {
  await wait(view.scene, 800);
  for (let round = 0; ; round++) {
    await Promise.all([arrive("player", "strike", 2, round), arrive("enemy", "strike", 4, round + 3)]);
    window.arrivalCount++;
    await wait(view.scene, 900);
    await Promise.all([arrive("player", "command", 0, round + 1), arrive("enemy", "strike", 1, round + 4)]);
    window.arrivalCount++;
    await wait(view.scene, 900);
    view.pad("player", "command", 0).clearShip();
    view.pad("enemy", "strike", 1).clearShip();
  }
})();
