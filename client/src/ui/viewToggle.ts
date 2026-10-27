// Ansicht: Icon-Knopf oben rechts neben dem Vollbild-Knopf und die Taste V schalten mit einer kurzen Kamerafahrt
// zwischen dem Blick von der Seite und von hinten oben um (`MatchScene.toggleCameraView`). Mit welcher Ansicht das
// Brett startet, steht in den Einstellungen.

import { t } from "../i18n/index.ts";

/** Kamera mit Pfeilen in beide Richtungen (Lucide „switch-camera“). */
const ICON = `<path d="M11 19H4a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h5" />
  <path d="M13 5h7a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2h-5" />
  <circle cx="12" cy="12" r="3" />
  <path d="m18 22-3-3 3-3" />
  <path d="m6 2 3 3-3 3" />`;

export function installViewToggle(container: HTMLElement, toggle: () => void): void {
  container.insertAdjacentHTML(
    "beforeend",
    `<button type="button" class="icon-button view-toggle">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICON}</svg>
    </button>`,
  );
  const button = container.querySelector<HTMLButtonElement>(".view-toggle")!;
  button.title = t.cameraView.toggle;
  button.addEventListener("click", toggle);
  window.addEventListener("keydown", (event) => {
    if (event.code !== "KeyV" || event.repeat || event.ctrlKey || event.metaKey || event.altKey) return;
    toggle();
  });
}
