// Einstellungen: Zahnrad-Knopf oben rechts neben dem Log-Knopf öffnet einen modalen Dialog.
// Jede Auswahl gilt sofort und wird gespeichert (`settings.ts`).

import { t } from "../i18n/index.ts";
import { ANIMATION_SPEEDS, settings, updateSettings, type AnimationSpeed } from "../settings.ts";

export class SettingsDialog {
  constructor(container: HTMLElement) {
    container.insertAdjacentHTML(
      "beforeend",
      `<button type="button" class="icon-button settings-toggle">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
        </svg>
      </button>
      <dialog class="settings-dialog">
        <h2></h2>
        <fieldset class="settings-speed">
          <legend></legend>
        </fieldset>
        <button type="button" class="settings-close"></button>
      </dialog>`,
    );
    const toggle = container.querySelector<HTMLButtonElement>(".settings-toggle")!;
    const dialog = container.querySelector<HTMLDialogElement>(".settings-dialog")!;
    const speed = dialog.querySelector(".settings-speed")!;
    const close = dialog.querySelector<HTMLButtonElement>(".settings-close")!;
    toggle.title = t.settings.title;
    dialog.querySelector("h2")!.textContent = t.settings.title;
    speed.querySelector("legend")!.textContent = t.settings.animationSpeed;
    close.textContent = t.settings.close;

    for (const option of Object.keys(ANIMATION_SPEEDS) as AnimationSpeed[]) {
      const label = document.createElement("label");
      const input = Object.assign(document.createElement("input"), {
        type: "radio",
        name: "animation-speed",
        value: option,
        checked: option === settings.animationSpeed,
      });
      input.addEventListener("change", () => updateSettings({ animationSpeed: option }));
      label.append(input, Object.assign(document.createElement("span"), { textContent: t.settings.speeds[option] }));
      speed.append(label);
    }

    toggle.addEventListener("click", () => dialog.showModal());
    close.addEventListener("click", () => dialog.close());
    // Klick auf den abgedunkelten Hintergrund schließt; der trifft das Dialog-Element selbst.
    dialog.addEventListener("click", (event) => {
      if (event.target === dialog) dialog.close();
    });
  }
}
