// Die Hand: Schiffskarten links, Submit in der Mitte, Befehlskarten rechts.
// Karten werden bei jedem Refresh aus der Hand neu aufgebaut.

import { cardColor, darkened, targetLabel, toCss, type CommandCard, type ShipCard } from "../data/cards.ts";

export interface HandCallbacks {
  onShipCardClick: (handIndex: number) => void;
  onCommandCardClick: (handIndex: number) => void;
}

export class HandView {
  private readonly shipRow: HTMLElement;
  private readonly commandRow: HTMLElement;

  constructor(
    container: HTMLElement,
    submitButton: HTMLButtonElement,
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
    container.querySelector(".submit-area")!.append(submitButton);
  }

  renderShips(hand: readonly ShipCard[], markedIndices: ReadonlySet<number>): void {
    this.shipRow.replaceChildren(
      ...hand.map((card, index) => {
        const element = this.createShipCard(card);
        element.classList.toggle("selected", markedIndices.has(index));
        element.addEventListener("click", () => this.callbacks.onShipCardClick(index));
        return element;
      }),
    );
  }

  renderCommands(hand: readonly CommandCard[], markedIndices: ReadonlySet<number>): void {
    this.commandRow.replaceChildren(
      ...hand.map((card, index) => {
        const element = this.createCommandCard(card);
        element.classList.toggle("selected", markedIndices.has(index));
        element.addEventListener("click", () => this.callbacks.onCommandCardClick(index));
        return element;
      }),
    );
  }

  private createShipCard(card: ShipCard): HTMLElement {
    const color = cardColor(card);
    const element = document.createElement("div");
    element.className = "card ship-card";
    element.style.setProperty("--card-bg", toCss(darkened(color, 0.72)));
    element.style.setProperty("--card-accent", toCss(color));
    element.innerHTML = `
      <div class="name"></div>
      <div class="class"></div>
      <div class="stats">
        <span>HP</span><b class="hp"></b>
        <span>ATK</span><b class="atk"></b>
        <span>SHIELD</span><b class="shield"></b>
      </div>`;
    element.querySelector(".name")!.textContent = card.name;
    element.querySelector(".class")!.textContent = card.shipClass.toUpperCase();
    element.querySelector(".hp")!.textContent = String(card.hp);
    element.querySelector(".atk")!.textContent = String(card.atk);
    element.querySelector(".shield")!.textContent = String(card.shield);
    return element;
  }

  private createCommandCard(card: CommandCard): HTMLElement {
    const element = document.createElement("div");
    element.className = "card command-card";
    element.style.setProperty("--card-bg", toCss(darkened(cardColor(card), 0.25)));
    element.innerHTML = `
      <div class="screen">
        <div class="name"></div>
        <div class="target"></div>
        <div class="effect"></div>
      </div>
      <div class="keys"><span></span><span></span><span></span><span></span></div>`;
    element.querySelector(".name")!.textContent = card.name;
    element.querySelector(".target")!.textContent = targetLabel(card);
    element.querySelector(".effect")!.textContent = card.effectText;
    return element;
  }
}
