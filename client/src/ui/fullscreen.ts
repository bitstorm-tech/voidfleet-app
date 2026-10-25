// Vollbild: Icon-Knopf ganz rechts neben dem Log-Knopf, die Taste F und ein Doppelklick auf eine
// freie Stelle des Bretts (`matchController.ts`) schalten um, wie bei einem Video. Escape beendet
// das Vollbild über den Browser.

import { t } from "../i18n/index.ts";

const ENTER_ICON = `<path d="M8 3H5a2 2 0 0 0-2 2v3M21 8V5a2 2 0 0 0-2-2h-3M3 16v3a2 2 0 0 0 2 2h3M16 21h3a2 2 0 0 0 2-2v-3" />`;
const EXIT_ICON = `<path d="M8 3v3a2 2 0 0 1-2 2H3M21 8h-3a2 2 0 0 1-2-2V3M3 16h3a2 2 0 0 1 2 2v3M16 21v-3a2 2 0 0 1 2-2h3" />`;

export function toggleFullscreen(): void {
  if (document.fullscreenElement) void document.exitFullscreen();
  else void document.documentElement.requestFullscreen();
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
    const active = document.fullscreenElement !== null;
    icon.innerHTML = active ? EXIT_ICON : ENTER_ICON;
    toggle.title = active ? t.fullscreen.exit : t.fullscreen.enter;
  };
  update();
  toggle.addEventListener("click", toggleFullscreen);
  document.addEventListener("fullscreenchange", update);
  window.addEventListener("keydown", (event) => {
    if (event.code !== "KeyF" || event.repeat || event.ctrlKey || event.metaKey || event.altKey) return;
    toggleFullscreen();
  });
}
