// Vorschau der Zerstörungsanimation ohne Server: alle acht Schiffe stehen auf dem
// Brett und gehen nacheinander unter, dann landen sie neu. `?slow=4` bremst die
// ganze Szene um den Faktor, `?ship=<id>` zeigt nur dieses Schiff in Dauerschleife.

import { Board } from "../../shared/board.ts";
import { SHIPS, type ShipCard } from "../../shared/cards.ts";
import { loadSounds } from "../src/audio/sounds.ts";
import { destroyShip } from "../src/scene/destruction.ts";
import { MatchScene } from "../src/scene/matchScene.ts";
import { loadShipModels, ShipView } from "../src/scene/ship.ts";
import type { SlotPad } from "../src/scene/slotPad.ts";
import { wait } from "../src/scene/tween.ts";

declare global {
  interface Window {
    /** Abgeschlossene Zerstörungen und das gerade untergehende Schiff, zum Synchronisieren von Screenshot-Serien. */
    destroyCount: number;
    destroying: string | null;
    /** Die Szene, zum Nachsehen in der Browser-Konsole. */
    view: MatchScene;
  }
}

const canvas = document.getElementById("render-canvas") as HTMLCanvasElement;
const view = new MatchScene(canvas, new Board());
await Promise.all([...loadShipModels(view.scene), ...loadSounds()]);
const params = new URLSearchParams(location.search);
const slow = Number(params.get("slow") ?? 1);
const only = SHIPS.find((ship) => ship.id === params.get("ship"));
const realDelta = view.engine.getDeltaTime.bind(view.engine);
view.engine.getDeltaTime = () => realDelta() / slow;

const PADS: SlotPad[] = only
  ? [view.pad("enemy", "strike", 3)]
  : [
      view.pad("player", "strike", 1), view.pad("player", "strike", 3), view.pad("player", "command", 2), view.pad("player", "command", 4),
      view.pad("enemy", "strike", 2), view.pad("enemy", "strike", 4), view.pad("enemy", "command", 1), view.pad("enemy", "command", 3),
    ];
const CARDS: ShipCard[] = only ? [only] : [...SHIPS];

async function deployAll(): Promise<void> {
  await Promise.all(
    PADS.map((pad, index) => view.deploy(new ShipView(view.scene, CARDS[index]!, false), pad.slot.lane.side, pad.slot.lane.type, pad.slot.index)),
  );
}

window.destroyCount = 0;
window.destroying = null;
window.view = view;
void (async () => {
  await deployAll();
  await wait(view.scene, 1200);
  for (;;) {
    for (const pad of PADS) {
      const ship = pad.detachShip();
      window.destroying = ship.card.id;
      await destroyShip(ship, view);
      window.destroying = null;
      window.destroyCount++;
      await wait(view.scene, 2200);
    }
    await wait(view.scene, 1500);
    await deployAll();
    await wait(view.scene, 1200);
  }
})();
