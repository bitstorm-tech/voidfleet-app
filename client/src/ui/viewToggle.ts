// Ansicht: Icon-Knopf oben rechts neben dem Vollbild-Knopf und die Taste V fahren mit einer kurzen Kamerafahrt zur
// anderen Ansicht, von der Seite oder von hinten oben (`MatchScene.toggleCameraView`); solange ← oder → gedrückt ist,
// dreht sich die Kamera stufenlos dazwischen (`MatchScene.orbitCamera`), ↑ und ↓ zoomen hinein und heraus
// (`MatchScene.zoomCamera`). Wo die Kamera zuletzt stand, gilt im nächsten Match wieder.

import { t } from "../i18n/index.ts";

/** Kamera mit Pfeilen in beide Richtungen (Lucide „switch-camera“). */
const ICON = `<path d="M11 19H4a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h5" />
  <path d="M13 5h7a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2h-5" />
  <circle cx="12" cy="12" r="3" />
  <path d="m18 22-3-3 3-3" />
  <path d="m6 2 3 3-3 3" />`;

/** ← dreht die Kamera nach links hinter die eigene Flotte, → zurück zur Seite; ↑ zoomt hinein, ↓ heraus. */
const ORBIT_KEYS = new Map([
  ["ArrowLeft", 1],
  ["ArrowRight", -1],
]);
const ZOOM_KEYS = new Map([
  ["ArrowUp", 1],
  ["ArrowDown", -1],
]);

/** Was die Szene für Ansicht und Zoom per Knopf und Tastatur anbietet (`MatchScene`). */
interface CameraControls {
  toggleCameraView(): void;
  orbitCamera(direction: number): void;
  zoomCamera(direction: number): void;
}

export function installViewToggle(container: HTMLElement, camera: CameraControls): void {
  container.insertAdjacentHTML(
    "beforeend",
    `<button type="button" class="icon-button view-toggle">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICON}</svg>
    </button>`,
  );
  const button = container.querySelector<HTMLButtonElement>(".view-toggle")!;
  button.title = t.cameraView.toggle;
  button.addEventListener("click", () => camera.toggleCameraView());

  // Gegenrichtungen heben sich auf; gemeldet wird nur die Achse der Taste, die sich geändert hat.
  const held = new Set<string>();
  const direction = (keys: Map<string, number>) => [...held].reduce((sum, code) => sum + (keys.get(code) ?? 0), 0);
  const steer = (code: string) => {
    if (ORBIT_KEYS.has(code)) camera.orbitCamera(direction(ORBIT_KEYS));
    if (ZOOM_KEYS.has(code)) camera.zoomCamera(direction(ZOOM_KEYS));
  };
  window.addEventListener("keydown", (event) => {
    if (event.repeat || event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.code === "KeyV") camera.toggleCameraView();
    // In offenen Dialogen gehören die Pfeiltasten den Reglern und dem Scrollen.
    if (!(ORBIT_KEYS.has(event.code) || ZOOM_KEYS.has(event.code)) || document.querySelector("dialog[open]") !== null) return;
    held.add(event.code);
    steer(event.code);
  });
  window.addEventListener("keyup", (event) => {
    if (held.delete(event.code)) steer(event.code);
  });
  // Verliert das Fenster den Fokus, kommt das Loslassen nicht mehr an.
  window.addEventListener("blur", () => {
    held.clear();
    camera.orbitCamera(0);
    camera.zoomCamera(0);
  });
}
