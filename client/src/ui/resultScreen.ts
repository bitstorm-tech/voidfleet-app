// Ergebnis-Overlay nach Matchende: Sieg, Niederlage oder Unentschieden groß in der Bildmitte, darunter
// das zerstörte Flaggschiff, nach einer Aufgabe stattdessen die Aufgabe. „Brett ansehen“ blendet es aus und lässt ein Abzeichen in der
// Kopfzeile stehen, über das es wieder aufgeht; „Neues Match“ legt ein neues an, ohne die Seite neu zu laden.
// Solange das Match entschieden ist, trägt der UI-Container die Klasse `match-over`.
// Beim Erscheinen erklingt eine Fanfare, bei Niederlage und Unentschieden eine düstere.

import type { MatchResult } from "../../../shared/protocol.ts";
import { playSound } from "../audio/sounds.ts";
import { t } from "../i18n/index.ts";

export class ResultScreen {
  private readonly overlay: HTMLElement;
  private readonly title: HTMLElement;
  private readonly subtitle: HTMLElement;
  private readonly rounds: HTMLElement;
  private readonly badge: HTMLButtonElement;
  private result: MatchResult | null = null;

  constructor(
    private readonly container: HTMLElement,
    onNewMatch: () => void,
  ) {
    container.insertAdjacentHTML(
      "beforeend",
      `<div class="result-overlay" hidden>
        <div class="result-panel">
          <strong class="result-title"></strong>
          <span class="result-subtitle"></span>
          <span class="result-rounds"></span>
          <div class="result-actions">
            <button type="button" class="result-board"></button>
            <button type="button" class="result-new"></button>
          </div>
        </div>
      </div>
      <button type="button" class="result-badge" hidden></button>`,
    );
    this.overlay = container.querySelector(".result-overlay")!;
    this.title = container.querySelector(".result-title")!;
    this.subtitle = container.querySelector(".result-subtitle")!;
    this.rounds = container.querySelector(".result-rounds")!;
    this.badge = container.querySelector(".result-badge")!;
    const boardButton = container.querySelector<HTMLButtonElement>(".result-board")!;
    const newButton = container.querySelector<HTMLButtonElement>(".result-new")!;
    boardButton.textContent = t.result.viewBoard;
    newButton.textContent = t.result.newMatch;
    boardButton.addEventListener("click", () => this.setOpen(false));
    this.badge.addEventListener("click", () => this.setOpen(true));
    newButton.addEventListener("click", onNewMatch);
  }

  /** Öffnet das Overlay, sobald ein Ergebnis feststeht; bleibt danach in der Hand des Spielers. `flagships` sind die Namen beider Flaggschiffe. */
  show(result: MatchResult | null, round: number, surrendered: boolean, flagships: { own: string; enemy: string }): void {
    if (result === this.result) return;
    this.result = result;
    this.container.classList.toggle("match-over", result !== null);
    if (result === null) {
      this.overlay.hidden = true;
      this.badge.hidden = true;
      return;
    }
    const text = t.result[result];
    this.overlay.dataset.result = result;
    this.badge.dataset.result = result;
    this.title.textContent = text.title;
    this.subtitle.textContent = subtitle(result, surrendered, flagships);
    this.rounds.textContent = t.result.rounds(round);
    this.badge.textContent = text.title;
    this.setOpen(true);
    playSound(result === "won" ? "victory" : "defeat");
  }

  private setOpen(open: boolean): void {
    this.overlay.hidden = !open;
    this.badge.hidden = open;
  }
}

/** Der Untertitel nennt die Aufgabe oder das zerstörte Flaggschiff. */
function subtitle(result: MatchResult, surrendered: boolean, flagships: { own: string; enemy: string }): string {
  if (surrendered && result !== "draw") return t.result.surrendered[result];
  switch (result) {
    case "won":
      return t.result.won.subtitle(flagships.enemy);
    case "lost":
      return t.result.lost.subtitle(flagships.own);
    case "draw":
      return t.result.draw.subtitle(flagships.own, flagships.enemy);
  }
}
