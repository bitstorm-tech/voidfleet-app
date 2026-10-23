// Kopfzeile (Runde + Status), Log-Panel, Befehls-Banner, Ankündigung einer neuen Runde sowie der Aktionsknopf
// (Submit, Überspringen oder Computergegner, je nach Lage) als DOM-Overlay.

import type { Side } from "../../../shared/board.ts";
import { t } from "../i18n/index.ts";

export class Hud {
  private readonly roundLabel: HTMLElement;
  private readonly statusLabel: HTMLElement;
  private readonly logPanel: HTMLElement;
  private readonly logToggle: HTMLButtonElement;
  private readonly logText: HTMLElement;
  private readonly banner: HTMLElement;
  private readonly roundBanner: HTMLElement;
  readonly submitButton: HTMLButtonElement;
  /** Steht während der Rundenauflösung an der Stelle des Submit-Buttons. */
  readonly skipButton: HTMLButtonElement;
  /** Steht an der Stelle des Submit-Buttons, solange kein Gegner da ist. */
  readonly botButton: HTMLButtonElement;
  private readonly logLines: string[] = [];

  constructor(container: HTMLElement) {
    container.insertAdjacentHTML(
      "beforeend",
      `<div class="top-bar">
        <span class="round-label"></span>
        <span class="status-label"></span>
      </div>
      <div class="log-panel">
        <button type="button" class="log-toggle">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
            <path d="M4 6h16M4 12h16M4 18h10" />
          </svg>
        </button>
        <div class="log-text"></div>
      </div>
      <div class="reveal-banner"></div>
      <div class="round-banner"></div>`,
    );
    this.roundLabel = container.querySelector(".round-label")!;
    this.statusLabel = container.querySelector(".status-label")!;
    this.logPanel = container.querySelector(".log-panel")!;
    this.logToggle = container.querySelector(".log-toggle")!;
    this.logText = container.querySelector(".log-text")!;
    this.banner = container.querySelector(".reveal-banner")!;
    this.roundBanner = container.querySelector(".round-banner")!;
    this.logToggle.title = t.hud.showLog;
    this.logToggle.addEventListener("click", () => this.toggleLog());

    this.submitButton = createButton("submit-button", t.hud.endTurn);
    this.skipButton = createButton("submit-button", t.hud.skip);
    this.botButton = createButton("submit-button", t.hud.playComputer);
    this.showAction("submit");
  }

  /** Welcher Knopf an der Stelle des Submit-Buttons steht. */
  showAction(action: "submit" | "skip" | "bot"): void {
    this.submitButton.hidden = action !== "submit";
    this.skipButton.hidden = action !== "skip";
    this.botButton.hidden = action !== "bot";
  }

  setRound(round: number): void {
    this.roundLabel.textContent = t.hud.round(round);
  }

  setStatus(text: string): void {
    this.statusLabel.textContent = text;
  }

  appendLog(lines: string[]): void {
    this.logLines.push(...lines);
    this.logText.textContent = this.logLines.join("\n");
    this.logText.scrollTop = this.logText.scrollHeight;
  }

  /** Kündigt einen aufgedeckten Befehl an; blendet sich per CSS-Animation selbst wieder aus. */
  showBanner(title: string, subtitle: string | null, side: Side): void {
    this.banner.replaceChildren(Object.assign(document.createElement("strong"), { textContent: title }));
    if (subtitle) this.banner.append(Object.assign(document.createElement("span"), { textContent: subtitle }));
    this.banner.dataset.side = side;
    restartAnimation(this.banner);
  }

  /** Kündigt groß in der Bildmitte an, dass eine neue Runde begonnen hat; blendet sich selbst wieder aus. */
  showRoundBanner(round: number): void {
    this.roundBanner.replaceChildren(
      Object.assign(document.createElement("span"), { textContent: t.hud.newRound }),
      Object.assign(document.createElement("strong"), { textContent: t.hud.round(round) }),
    );
    restartAnimation(this.roundBanner);
  }

  hideBanner(): void {
    this.banner.classList.remove("visible");
  }

  private toggleLog(): void {
    const expanded = this.logPanel.classList.toggle("expanded");
    this.logToggle.title = expanded ? t.hud.hideLog : t.hud.showLog;
  }
}

/** Klasse neu setzen, damit die Animation auch beim direkt folgenden Aufruf neu startet. */
function restartAnimation(element: HTMLElement): void {
  element.classList.remove("visible");
  void element.offsetWidth;
  element.classList.add("visible");
}

function createButton(className: string, text: string): HTMLButtonElement {
  return Object.assign(document.createElement("button"), { type: "button", className, textContent: text });
}
