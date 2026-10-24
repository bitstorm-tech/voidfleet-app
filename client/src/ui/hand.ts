// Die Hand: Schiffskarten links, Submit samt Checkliste in der Mitte, Befehlskarten rechts.
// Karten werden nur neu aufgebaut, wenn sich die Hand ändert (sonst würde die Karte
// unter der Maus ihr Hover verlieren und neu aufzoomen); aufgebaut werden sie in `cardView.ts`.
// Neu gezogene Karten fliegen nacheinander ein, jede mit einem Wischen, und leuchten kurz auf.

import type { CommandCard, ShipCard } from "../../../shared/cards.ts";
import { playUiSound } from "../audio/uiSounds.ts";
import { createCommandCard, createShipCard } from "./cardView.ts";

export interface HandCallbacks {
  onShipCardClick: (handIndex: number) => void;
  onCommandCardClick: (handIndex: number) => void;
}

export class HandView {
  private readonly shipRow: HTMLElement;
  private readonly commandRow: HTMLElement;
  private shipHand: readonly ShipCard[] = [];
  private commandHand: readonly CommandCard[] = [];

  constructor(
    container: HTMLElement,
    actionElements: readonly HTMLElement[],
    private readonly callbacks: HandCallbacks,
  ) {
    container.insertAdjacentHTML(
      "beforeend",
      `<div class="hand-bar">
        <div class="hand ship-hand"></div>
        <div class="submit-area"></div>
        <div class="hand command-hand"></div>
      </div>`,
    );
    this.shipRow = container.querySelector(".ship-hand")!;
    this.commandRow = container.querySelector(".command-hand")!;
    container.querySelector(".submit-area")!.append(...actionElements);
  }

  renderShips(hand: readonly ShipCard[], markedIndices: ReadonlySet<number>): void {
    if (!sameCards(hand, this.shipHand)) {
      const drawn = drawnIndices(this.shipHand, hand);
      this.shipHand = hand;
      this.shipRow.replaceChildren(
        ...hand.map((card, index) => {
          const element = createShipCard(card);
          element.addEventListener("click", () => this.callbacks.onShipCardClick(index));
          markDrawn(element, drawn.indexOf(index));
          return element;
        }),
      );
    }
    markSelected(this.shipRow, markedIndices);
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
  }
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
