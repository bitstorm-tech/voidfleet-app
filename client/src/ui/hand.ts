// Die Hand: Schiffskarten links, in Runde 1 vorn das Flaggschiff, Submit samt Checkliste in der Mitte,
// rechts die Admiralsfähigkeit (`powerCard.ts`) und die Befehlskarten. Passt eine Seite nicht in ihre Hälfte
// der Leiste, schieben sich ihre Karten übereinander; die Karte unter der Maus liegt oben.
// Karten werden nur neu aufgebaut, wenn sich die Hand ändert (sonst würde die Karte
// unter der Maus ihr Hover verlieren und neu aufzoomen); aufgebaut werden sie in `cardView.ts`.
// Neu gezogene Karten fliegen nacheinander ein, jede mit einem Wischen, und leuchten kurz auf.

import type { CommandCard, ShipCard } from "../../../shared/cards.ts";
import { playUiSound } from "../audio/uiSounds.ts";
import type { ShipPick } from "../game/match.ts";
import { createCommandCard, createShipCard } from "./cardView.ts";

/** Breite einer Karte, Abstand zweier Karten und der Abstand zwischen Fähigkeitskarte und Befehlen (`styles.css`). */
const CARD_WIDTH = 140;
const CARD_GAP = 10;
const SIDE_GAP = 16;
/** Mindestabstand jeder Hand zum Aktionsknopf in der Mitte. */
const CENTER_MARGIN = 20;

export interface HandCallbacks {
  onShipCardClick: (pick: ShipPick) => void;
  onCommandCardClick: (handIndex: number) => void;
}

export class HandView {
  private readonly bar: HTMLElement;
  private readonly submitArea: HTMLElement;
  private readonly shipRow: HTMLElement;
  private readonly commandRow: HTMLElement;
  private shipHand: readonly ShipCard[] = [];
  private flagship: ShipCard | null = null;
  private commandHand: readonly CommandCard[] = [];

  constructor(
    container: HTMLElement,
    actionElements: readonly HTMLElement[],
    private readonly admiralElement: HTMLElement,
    private readonly callbacks: HandCallbacks,
  ) {
    container.insertAdjacentHTML(
      "beforeend",
      `<div class="hand-bar">
        <div class="hand ship-hand"></div>
        <div class="submit-area"></div>
        <div class="hand-side">
          <div class="hand command-hand"></div>
        </div>
      </div>`,
    );
    this.bar = container.querySelector(".hand-bar")!;
    this.submitArea = container.querySelector(".submit-area")!;
    this.shipRow = container.querySelector(".ship-hand")!;
    this.commandRow = container.querySelector(".command-hand")!;
    this.submitArea.append(...actionElements);
    this.commandRow.before(admiralElement);
    window.addEventListener("resize", () => this.fit());
  }

  /** Die Schiffe der Hand, davor in Runde 1 das Flaggschiff; `marked` sind die gewählten und eingeplanten. */
  renderShips(hand: readonly ShipCard[], flagship: ShipCard | null, marked: ReadonlySet<ShipPick>): void {
    if (!sameCards(hand, this.shipHand) || flagship !== this.flagship) {
      const drawn = drawnIndices(this.shipHand, hand);
      this.shipHand = hand;
      this.flagship = flagship;
      const cards = hand.map((card, index) => {
        const element = createShipCard(card);
        element.addEventListener("click", () => this.callbacks.onShipCardClick(index));
        markDrawn(element, drawn.indexOf(index));
        return element;
      });
      if (flagship) {
        const element = createShipCard(flagship);
        element.addEventListener("click", () => this.callbacks.onShipCardClick("flagship"));
        cards.unshift(element);
      }
      this.shipRow.replaceChildren(...cards);
    }
    const picks: ShipPick[] = [...(this.flagship ? (["flagship"] as const) : []), ...hand.map((_, index) => index)];
    markSelected(this.shipRow, new Set(picks.flatMap((pick, index) => (marked.has(pick) ? [index] : []))));
  }

  renderCommands(hand: readonly CommandCard[], markedIndices: ReadonlySet<number>): void {
    if (!sameCards(hand, this.commandHand)) {
      const drawn = drawnIndices(this.commandHand, hand);
      this.commandHand = hand;
      this.commandRow.replaceChildren(
        ...hand.map((card, index) => {
          const element = createCommandCard(card);
          element.addEventListener("click", () => this.callbacks.onCommandCardClick(index));
          markDrawn(element, drawn.indexOf(index));
          return element;
        }),
      );
    }
    markSelected(this.commandRow, markedIndices);
    this.fit();
  }

  /**
   * Die Hände teilen sich die Leiste neben dem Aktionsknopf: Jede bekommt mindestens die Hälfte, und was die andere
   * nicht braucht. Reicht der Platz nicht, rücken die Karten der Hand zusammen und überlappen sich.
   */
  private fit(): void {
    const room = this.bar.clientWidth - this.submitArea.offsetWidth - 2 * CENTER_MARGIN;
    const admiral = this.admiralElement.hidden ? 0 : this.admiralElement.offsetWidth + SIDE_GAP;
    const rows = [
      { row: this.shipRow, extra: 0 },
      { row: this.commandRow, extra: admiral },
    ];
    const widths = rows.map(({ row, extra }) => rowWidth(row.children.length) + extra);
    rows.forEach(({ row, extra }, index) => {
      const count = row.children.length;
      const space = Math.max(room / 2, room - widths[1 - index]!) - extra;
      const gap = count > 1 && rowWidth(count) > space ? CARD_GAP - (rowWidth(count) - space) / (count - 1) : CARD_GAP;
      row.style.setProperty("--card-gap", `${gap}px`);
    });
  }
}

/** Breite einer Reihe von `count` Karten ohne Überlappung. */
function rowWidth(count: number): number {
  return count * CARD_WIDTH + Math.max(count - 1, 0) * CARD_GAP;
}

function markSelected(row: HTMLElement, markedIndices: ReadonlySet<number>): void {
  [...row.children].forEach((element, index) => element.classList.toggle("selected", markedIndices.has(index)));
}

/** Indizes der Karten in `next`, die in `previous` noch nicht lagen (gleiche Karten zählen mehrfach). */
function drawnIndices(previous: readonly object[], next: readonly object[]): number[] {
  const remaining = [...previous];
  return next.flatMap((card, index) => {
    const kept = remaining.indexOf(card);
    if (kept === -1) return [index];
    remaining.splice(kept, 1);
    return [];
  });
}

/** Die `order`-te neue Karte fliegt versetzt ein; -1 heißt: lag schon auf der Hand. */
function markDrawn(element: HTMLElement, order: number): void {
  if (order === -1) return;
  element.classList.add("drawn");
  element.style.setProperty("--draw-delay", `${order * 0.18}s`);
  element.addEventListener("animationstart", (event) => {
    if (event.animationName === "card-draw") playUiSound("draw");
  });
  element.addEventListener("animationend", (event) => {
    if (event.pseudoElement === "::before") element.classList.remove("drawn");
  });
}

function sameCards(a: readonly object[], b: readonly object[]): boolean {
  return a.length === b.length && a.every((card, index) => card === b[index]);
}
