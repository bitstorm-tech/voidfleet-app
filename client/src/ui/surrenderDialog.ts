// Aufgeben: Fahnen-Knopf links neben dem Fragezeichen öffnet eine Rückfrage; erst „Aufgeben“
// darin beendet das Match. Der Knopf steht nur da, solange gegen einen Gegner gespielt wird.

import { t } from "../i18n/index.ts";
import { iconDialog } from "./iconDialog.ts";

const ICON = `<path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z" />
  <line x1="4" y1="22" x2="4" y2="15" />`;

export class SurrenderDialog {
  private readonly toggle: HTMLButtonElement;
  private readonly dialog: HTMLDialogElement;

  constructor(container: HTMLElement, onSurrender: () => void) {
    this.dialog = iconDialog(container, "surrender", t.surrender.title, ICON);
    this.toggle = container.querySelector(".surrender-toggle")!;
    const close = this.dialog.querySelector(".dialog-close")!;
    const confirm = Object.assign(document.createElement("button"), {
      type: "button",
      className: "surrender-confirm",
      textContent: t.surrender.confirm,
    });
    confirm.addEventListener("click", () => {
      this.dialog.close();
      onSurrender();
    });
    const actions = Object.assign(document.createElement("div"), { className: "surrender-actions" });
    close.replaceWith(actions);
    actions.append(close, confirm);
    actions.before(Object.assign(document.createElement("p"), { className: "surrender-text", textContent: t.surrender.question }));
    this.setAvailable(false);
  }

  setAvailable(available: boolean): void {
    this.toggle.hidden = !available;
    if (!available && this.dialog.open) this.dialog.close();
  }
}
