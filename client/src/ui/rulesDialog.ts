// Spielregeln: Fragezeichen-Knopf links neben dem Zahnrad öffnet einen modalen
// Dialog mit einer Kurzfassung der Regeln, je Abschnitt Überschrift und Text.

import { t } from "../i18n/index.ts";
import { iconDialog } from "./iconDialog.ts";

const ICON = `<circle cx="12" cy="12" r="10" />
  <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
  <line x1="12" y1="17" x2="12.01" y2="17" />`;

export class RulesDialog {
  constructor(container: HTMLElement) {
    const dialog = iconDialog(container, "rules", t.rules.title, ICON);
    const body = Object.assign(document.createElement("div"), { className: "rules-body" });
    for (const section of t.rules.sections) {
      body.append(
        Object.assign(document.createElement("h3"), { textContent: section.heading }),
        Object.assign(document.createElement("p"), { textContent: section.text }),
      );
    }
    dialog.querySelector(".dialog-close")!.before(body);
  }
}
