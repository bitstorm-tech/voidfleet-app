// Grundgerüst des Tons: ein AudioContext mit je einem Bus für Musik und Effekte, deren Lautstärke aus den
// Einstellungen kommt, und einem Limiter dahinter, damit viele gleichzeitige Explosionen nicht übersteuern.
// Browser geben Ton erst nach einer Geste frei: Der erste Klick oder Tastendruck startet den Context.
// Im Hintergrund-Tab ruht der Ton wie die Szene, deren Render-Takt dann stillsteht.

import { onSettingsChange, settings } from "../settings.ts";

export const context = new AudioContext();
export const musicBus = new GainNode(context, { gain: busGain(settings.musicVolume) });
export const effectsBus = new GainNode(context, { gain: busGain(settings.effectsVolume) });

const limiter = new DynamicsCompressorNode(context, { threshold: -6, knee: 3, ratio: 20, attack: 0.003, release: 0.25 });
musicBus.connect(limiter);
effectsBus.connect(limiter);
limiter.connect(context.destination);

// Beim Ziehen am Regler gleitet die Lautstärke, statt zu knacken.
onSettingsChange(() => {
  musicBus.gain.setTargetAtTime(busGain(settings.musicVolume), context.currentTime, 0.03);
  effectsBus.gain.setTargetAtTime(busGain(settings.effectsVolume), context.currentTime, 0.03);
});

/** Der Regler wirkt quadratisch, so fühlen sich seine Schritte gleichmäßiger an als linear. */
function busGain(volume: number): number {
  return volume ** 2;
}

let isUnlocked = false;
const unlockListeners: (() => void)[] = [];

/** `listener` läuft, sobald der Browser Ton erlaubt — sofort, wenn das schon der Fall ist. */
export function onUnlock(listener: () => void): void {
  if (isUnlocked) listener();
  else unlockListeners.push(listener);
}

/**
 * Ob Sounds jetzt erklingen: freigegeben und im Vordergrund. Der Context darf dabei noch anlaufen (gleich nach der
 * freigebenden Geste); was vorher oder im Hintergrund-Tab ausgelöst wird, entfällt, statt sich für später zu stauen.
 */
export function isAudible(): boolean {
  return isUnlocked && !document.hidden;
}

function unlock(): void {
  if (isUnlocked) return;
  isUnlocked = true;
  void context.resume();
  for (const listener of unlockListeners) listener();
}

window.addEventListener("pointerdown", unlock, { capture: true, once: true });
window.addEventListener("keydown", unlock, { capture: true, once: true });
// Manche Browser erlauben Ton auch ohne Geste, etwa auf oft besuchten Seiten.
context.addEventListener("statechange", () => {
  if (context.state === "running") unlock();
});

document.addEventListener("visibilitychange", () => {
  if (isUnlocked) void (document.hidden ? context.suspend() : context.resume());
});
