// Vorschau der Lane-Wechsel ohne Server: Je ein Schiff jeder Klasse wechselt in
// Dauerschleife zwischen Strike und Command, abwechselnd nach vorn (S-Kurve) und
// nach hinten (Schleife), mit wechselndem Slot-Versatz. `?slow=4` bremst die
// Szene um den Faktor, `?ship=<id>` zeigt nur dieses Schiff.

import { Board, type LaneType } from "../../shared/board.ts";
import { SHIPS, type ShipId } from "../../shared/cards.ts";
import { loadSounds } from "../src/audio/sounds.ts";
import { MatchScene } from "../src/scene/matchScene.ts";
import { loadShipModels, ShipView } from "../src/scene/ship.ts";
import type { SlotPad } from "../src/scene/slotPad.ts";
import { wait } from "../src/scene/tween.ts";

declare global {
  interface Window {
    view: MatchScene;
    /** Abgeschlossene Wechsel, zum Synchronisieren von Screenshot-Serien. */
    moveCount: number;
  }
}

const canvas = document.getElementById("render-canvas") as HTMLCanvasElement;
const view = new MatchScene(canvas, new Board());
await Promise.all([...loadShipModels(view.scene), ...loadSounds()]);
const params = new URLSearchParams(location.search);
const slow = Number(params.get("slow") ?? 1);
const realDelta = view.engine.getDeltaTime.bind(view.engine);
view.engine.getDeltaTime = () => realDelta() / slow;
window.view = view;

const only = params.get("ship") as ShipId | null;
const ids: ShipId[] = only ? [only] : ["void_interceptor", "repair_drone", "horizon_cruiser", "iron_dreadnought"];
/** Je Schiff ein eigener Streifen aus Slots; der Versatz pro Wechsel läuft 0, +1, -1, +2. */
const OFFSETS = [1, -1, 0, 2, -2, 1, -1];
const ships = ids.map((id, i) => {
  const ship = new ShipView(view.scene, SHIPS.find((card) => card.id === id)!, false);
  const slot = only ? 2 : [0, 2, 3, 5][i]!;
  view.pad("player", "command", slot).attachShip(ship);
  return { ship, lane: "command" as LaneType, slot, home: slot };
});

async function move(entry: (typeof ships)[number], step: number): Promise<void> {
  const lane: LaneType = entry.lane === "command" ? "strike" : "command";
  const offset = only ? OFFSETS[step % OFFSETS.length]! : step % 2 === 0 ? 0 : entry.home < 3 ? 1 : -1;
  const slot = Math.max(0, Math.min(5, entry.home + offset));
  const from: SlotPad = view.pad("player", entry.lane, entry.slot);
  const to = view.pad("player", lane, slot);
  const ship = from.detachShip();
  const start = ship.root.getAbsolutePosition().clone();
  to.attachShip(ship);
  ship.root.setAbsolutePosition(start);
  entry.lane = lane;
  entry.slot = slot;
  await ship.maneuver();
}

window.moveCount = 0;
void (async () => {
  await wait(view.scene, 800);
  for (let step = 0; ; step++) {
    await Promise.all(ships.map((entry) => move(entry, step)));
    window.moveCount++;
    await wait(view.scene, 700);
  }
})();
