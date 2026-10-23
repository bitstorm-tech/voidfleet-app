// Die Hand: Schiffskarten links, Submit in der Mitte, Befehlskarten rechts.
// Karten werden nur neu aufgebaut, wenn sich die Hand ändert (sonst würde die Karte
// unter der Maus ihr Hover verlieren und neu aufzoomen); jede trägt ihre
// Illustration (`cardArt`) als Hintergrund, das CSS legt Verläufe für den Text darüber.
// Neu gezogene Karten fliegen nacheinander ein und leuchten kurz auf.

import type { CommandCard, ShipCard } from "../../../shared/cards.ts";
import { cardArt } from "../data/cardArt.ts";
import { cardColor } from "../data/cardColors.ts";
import { darkened, toCss, toCssChannels } from "../data/palette.ts";
import { cardText, t, upper } from "../i18n/index.ts";

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
    actionButtons: readonly HTMLButtonElement[],
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
    container.querySelector(".submit-area")!.append(...actionButtons);
  }

  renderShips(hand: readonly ShipCard[], markedIndices: ReadonlySet<number>): void {
    if (!sameCards(hand, this.shipHand)) {
      const drawn = drawnIndices(this.shipHand, hand);
      this.shipHand = hand;
      this.shipRow.replaceChildren(
        ...hand.map((card, index) => {
          const element = this.createShipCard(card);
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
          const element = this.createCommandCard(card);
          element.addEventListener("click", () => this.callbacks.onCommandCardClick(index));
          markDrawn(element, drawn.indexOf(index));
          return element;
        }),
      );
    }
    markSelected(this.commandRow, markedIndices);
  }

  private createShipCard(card: ShipCard): HTMLElement {
    const color = cardColor(card);
    const element = document.createElement("div");
    element.className = "card ship-card";
    element.style.setProperty("--card-bg", toCss(darkened(color, 0.72)));
    element.style.setProperty("--card-accent", toCss(color));
    element.style.setProperty("--card-art", `url(${cardArt(card)})`);
    element.innerHTML = `
      <div class="name"></div>
      <div class="class"></div>
      <div class="stats">
        <span class="atk-label"></span><b class="atk"></b>
        <span class="hp-label"></span><b class="hp"></b>
      </div>`;
    element.querySelector(".name")!.textContent = cardText(card).name;
    element.querySelector(".class")!.textContent = upper(t.shipClasses[card.shipClass]);
    element.querySelector(".hp-label")!.textContent = upper(t.stats.hp);
    element.querySelector(".atk-label")!.textContent = upper(t.stats.atk);
    element.querySelector(".hp")!.textContent = String(card.hp);
    element.querySelector(".atk")!.textContent = String(card.atk);
    if (card.shield > 0) {
      const label = document.createElement("span");
      label.textContent = upper(t.stats.shield);
      const value = document.createElement("b");
      value.textContent = String(card.shield);
      element.querySelector(".stats")!.append(label, value);
    }
    return element;
  }

  private createCommandCard(card: CommandCard): HTMLElement {
    const element = document.createElement("div");
    element.className = "card command-card";
    element.style.setProperty("--card-rgb", toCssChannels(darkened(cardColor(card), 0.25)));
    element.style.setProperty("--card-art", `url(${cardArt(card)})`);
    element.innerHTML = `
      <div class="screen">
        <div class="name"></div>
        <div class="target"></div>
        <div class="effect"></div>
      </div>
      <div class="keys"><span></span><span></span><span></span><span></span></div>`;
    const text = cardText(card);
    element.querySelector(".name")!.textContent = text.name;
    element.querySelector(".target")!.textContent = t.targets[card.targetMode];
    element.querySelector(".effect")!.textContent = text.effect;
    return element;
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
  element.addEventListener("animationend", (event) => {
    if (event.pseudoElement === "::before") element.classList.remove("drawn");
  });
}

function sameCards(a: readonly object[], b: readonly object[]): boolean {
  return a.length === b.length && a.every((card, index) => card === b[index]);
}
