// Lädt beim Start alle Assets, damit im Spiel nichts mehr nachgeladen wird:
// Schiffsmodelle samt Wracks, Kartenillustrationen, Hintergrund und HDR-Umgebung.
// Danach übersetzt die Generalprobe alle Shader.

import { loadCardArt } from "./data/cardArt.ts";
import type { MatchScene } from "./scene/matchScene.ts";
import { rehearse } from "./scene/rehearsal.ts";
import { loadShipModels } from "./scene/ship.ts";

/** Anteil der Generalprobe am Fortschrittsbalken; den Rest teilen sich die Dateien. */
const REHEARSAL_SHARE = 0.1;

/** Meldet den Fortschritt als Anteil (0–1). */
export async function preloadAssets(view: MatchScene, onProgress: (fraction: number) => void): Promise<void> {
  const tasks = [...loadShipModels(view.scene), ...loadCardArt(), view.texturesReady()];
  let done = 0;
  onProgress(0);
  await Promise.all(tasks.map((task) => task.then(() => onProgress((++done / tasks.length) * (1 - REHEARSAL_SHARE)))));
  await rehearse(view);
  onProgress(1);
}
