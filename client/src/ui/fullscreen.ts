// Fenstermodus und Vollbild: Icon-Knopf ganz rechts neben dem Log-Knopf, die Taste F und ein Doppelklick auf eine
// freie Stelle des Bretts (`matchController.ts`) schalten das Vollbild um, wie bei einem Video; die Einstellungen
// wählen den Modus direkt (`settingsDialog.ts`).
// In der Desktop-App ist es das Vollbild des Fensters selbst, das der Hauptprozess schaltet (`desktop/src/main.ts`);
// dort gibt es außerdem „maximiert“, und der Modus wird gespeichert, damit die App beim nächsten Start so öffnet.
// Im Browser ist es das Vollbild der Seite. Dort fängt der Browser Escape sonst selbst ab, das Spiel bekäme es nie;
// deshalb sperrt es die Taste per Keyboard Lock (Chromium): Ein kurzer Druck erreicht das Spiel, langes Halten beendet
// das Vollbild.

import { t } from "../i18n/index.ts";
import { updateSettings, type WindowMode } from "../settings.ts";

const ENTER_ICON = `<path d="M8 3H5a2 2 0 0 0-2 2v3M21 8V5a2 2 0 0 0-2-2h-3M3 16v3a2 2 0 0 0 2 2h3M16 21h3a2 2 0 0 0 2-2v-3" />`;
const EXIT_ICON = `<path d="M8 3v3a2 2 0 0 1-2 2H3M21 8h-3a2 2 0 0 1-2-2V3M3 16h3a2 2 0 0 1 2 2v3M16 21v-3a2 2 0 0 1 2-2h3" />`;

/** Keyboard Lock fehlt in den DOM-Typen von TypeScript und in Firefox und Safari. */
type KeyboardLock = { keyboard?: { lock(keyCodes: string[]): Promise<void> } };

const desktop = window.voidfleetDesktop;
const listeners = new Set<() => void>();

/** Die Modi, die es hier gibt, in der Reihenfolge der Auswahl. */
export const WINDOW_MODES: WindowMode[] = desktop ? ["windowed", "maximized", "fullscreen"] : ["windowed", "fullscreen"];

export let windowMode: WindowMode = desktop ? desktop.windowMode : "windowed";

function changed(mode: WindowMode): void {
  windowMode = mode;
  if (desktop) updateSettings({ windowMode: mode });
  for (const listener of listeners) listener();
}

if (desktop) desktop.onWindowModeChange(changed);
else
  for (const event of ["fullscreenchange", "fullscreenerror"])
    document.addEventListener(event, () => changed(document.fullscreenElement ? "fullscreen" : "windowed"));

export function onWindowModeChange(listener: () => void): void {
  listeners.add(listener);
}

export function setWindowMode(mode: WindowMode): void {
  if (desktop) desktop.setWindowMode(mode);
  else if (mode !== "fullscreen") void document.exitFullscreen();
  else void document.documentElement.requestFullscreen().then(() => (navigator as KeyboardLock).keyboard?.lock(["Escape"]));
}

/** Verlässt das Vollbild in der Desktop-App maximiert, so startet sie auch ohne gespeicherte Wahl. */
export function toggleFullscreen(): void {
  setWindowMode(windowMode !== "fullscreen" ? "fullscreen" : desktop ? "maximized" : "windowed");
}

export function installFullscreen(container: HTMLElement): void {
  container.insertAdjacentHTML(
    "beforeend",
    `<button type="button" class="icon-button fullscreen-toggle">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></svg>
    </button>`,
  );
  const toggle = container.querySelector<HTMLButtonElement>(".fullscreen-toggle")!;
  const icon = toggle.querySelector("svg")!;
  const update = () => {
    const active = windowMode === "fullscreen";
    icon.innerHTML = active ? EXIT_ICON : ENTER_ICON;
    toggle.title = active ? t.fullscreen.exit : t.fullscreen.enter;
  };
  update();
  toggle.addEventListener("click", toggleFullscreen);
  onWindowModeChange(update);
  window.addEventListener("keydown", (event) => {
    if (event.code !== "KeyF" || event.repeat || event.ctrlKey || event.metaKey || event.altKey) return;
    toggleFullscreen();
  });
}
