// Kopfzeile (Runde + Status), Log-Panel, Befehls-Banner und Submit-Button als DOM-Overlay.

import type { Side } from "../../../shared/board.ts";
import { t } from "../i18n/index.ts";

export class Hud {
  private readonly roundLabel: HTMLElement;
  private readonly statusLabel: HTMLElement;
  private readonly logPanel: HTMLElement;
  private readonly logToggle: HTMLButtonElement;
  private readonly logText: HTMLElement;
  private readonly banner: HTMLElement;
  readonly submitButton: HTMLButtonElement;
  private readonly logLines: string[] = [];

  constructor(container: HTMLElement) {
    container.insertAdjacentHTML(
      "beforeend",
      `<div class="top-bar">
        <span class="round-label"></span>
        <span class="status-label"></span>
      </div>
      <div class="log-panel">
        <button type="button" class="log-toggle"></button>
        <div class="log-text"></div>
      </div>
      <div class="reveal-banner"></div>`,
    );
    this.roundLabel = container.querySelector(".round-label")!;
    this.statusLabel = container.querySelector(".status-label")!;
    this.logPanel = container.querySelector(".log-panel")!;
    this.logToggle = container.querySelector(".log-toggle")!;
    this.logText = container.querySelector(".log-text")!;
    this.banner = container.querySelector(".reveal-banner")!;
    this.logToggle.textContent = t.hud.showLog;
    this.logToggle.addEventListener("click", () => this.toggleLog());

    this.submitButton = document.createElement("button");
    this.submitButton.type = "button";
    this.submitButton.className = "submit-button";
    this.submitButton.textContent = t.hud.endTurn;
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
    // Klasse neu setzen, damit die Animation auch beim direkt folgenden Banner neu startet.
    this.banner.classList.remove("visible");
    void this.banner.offsetWidth;
    this.banner.classList.add("visible");
  }

  private toggleLog(): void {
    const expanded = this.logPanel.classList.toggle("expanded");
    this.logToggle.textContent = expanded ? t.hud.hideLog : t.hud.showLog;
  }
}
