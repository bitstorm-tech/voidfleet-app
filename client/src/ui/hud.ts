// Kopfzeile (Runde + Status), Log-Panel und Submit-Button als DOM-Overlay.

export class Hud {
  private readonly roundLabel: HTMLElement;
  private readonly statusLabel: HTMLElement;
  private readonly logPanel: HTMLElement;
  private readonly logToggle: HTMLButtonElement;
  private readonly logText: HTMLElement;
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
        <button type="button" class="log-toggle">Log einblenden</button>
        <div class="log-text"></div>
      </div>`,
    );
    this.roundLabel = container.querySelector(".round-label")!;
    this.statusLabel = container.querySelector(".status-label")!;
    this.logPanel = container.querySelector(".log-panel")!;
    this.logToggle = container.querySelector(".log-toggle")!;
    this.logText = container.querySelector(".log-text")!;
    this.logToggle.addEventListener("click", () => this.toggleLog());

    this.submitButton = document.createElement("button");
    this.submitButton.type = "button";
    this.submitButton.className = "submit-button";
    this.submitButton.textContent = "Runde ausführen";
  }

  setRound(round: number): void {
    this.roundLabel.textContent = `Runde ${round}`;
  }

  setStatus(text: string): void {
    this.statusLabel.textContent = text;
  }

  appendLog(lines: string[]): void {
    this.logLines.push(...lines);
    this.logText.textContent = this.logLines.join("\n");
    this.logText.scrollTop = this.logText.scrollHeight;
  }

  private toggleLog(): void {
    const expanded = this.logPanel.classList.toggle("expanded");
    this.logToggle.textContent = expanded ? "Log ausblenden" : "Log einblenden";
  }
}
