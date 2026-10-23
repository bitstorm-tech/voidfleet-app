// Gemeinsamer Aufbau der Dialoge hinter den Icon-Knöpfen oben rechts: Knopf,
// modaler `<dialog>` mit Überschrift und „Schließen“; ein Klick auf den
// abgedunkelten Hintergrund schließt ebenfalls.

import { t } from "../i18n/index.ts";

/** Legt Knopf und Dialog an und gibt den Dialog zurück; Inhalte gehören vor `.dialog-close`. */
export function iconDialog(container: HTMLElement, name: string, title: string, icon: string): HTMLDialogElement {
  container.insertAdjacentHTML(
    "beforeend",
    `<button type="button" class="icon-button ${name}-toggle">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${icon}</svg>
    </button>
    <dialog class="dialog ${name}-dialog">
      <h2></h2>
      <button type="button" class="dialog-close"></button>
    </dialog>`,
  );
  const toggle = container.querySelector<HTMLButtonElement>(`.${name}-toggle`)!;
  const dialog = container.querySelector<HTMLDialogElement>(`.${name}-dialog`)!;
  const close = dialog.querySelector<HTMLButtonElement>(".dialog-close")!;
  toggle.title = title;
  dialog.querySelector("h2")!.textContent = title;
  close.textContent = t.dialog.close;

  toggle.addEventListener("click", () => dialog.showModal());
  close.addEventListener("click", () => dialog.close());
  // Der Hintergrund-Klick trifft das Dialog-Element selbst.
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) dialog.close();
  });
  return dialog;
}
