// Die Hand: Schiffskarten links, in Runde 1 vorn das Flaggschiff, Submit samt Checkliste in der Mitte,
// rechts die Admiralsfähigkeit (`powerCard.ts`) und die Befehlskarten. Gleiche Karten liegen als ein Stapel mit
// Anzahl. Passt eine Seite nicht in ihre Hälfte der Leiste, schieben sich ihre Karten übereinander; die Karte unter
// der Maus liegt oben.
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
  private shipStacks: Stack<ShipCard>[] = [];
  private commandStacks: Stack<CommandCard>[] = [];
  /** Was gerade eingeplant und gewählt ist; ein Klick auf einen Stapel wählt danach das Exemplar. */
  private ships: { planned: ReadonlySet<ShipPick>; selected: ShipPick | null } = { planned: new Set(), selected: null };
  private commands: { planned: number | null; selected: number | null } = { planned: null, selected: null };

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

  /**
   * Die Schiffe der Hand, davor in Runde 1 das Flaggschiff; `planned` sind die eingeplanten, `selected` das gewählte.
   * Ein Klick auf einen Stapel meint das gewählte Exemplar, sonst das nächste freie, sonst das zuletzt eingeplante.
   */
  renderShips(hand: readonly ShipCard[], flagship: ShipCard | null, planned: ReadonlySet<ShipPick>, selected: ShipPick | null): void {
    this.ships = { planned, selected };
    if (!sameCards(hand, this.shipHand) || flagship !== this.flagship) {
      const drawn = drawnIndices(this.shipHand, hand);
      this.shipHand = hand;
      this.flagship = flagship;
      this.shipStacks = stacksOf(hand);
      const cards = this.shipStacks.map((stack) =>
        stackElement(createShipCard(stack.card), stack, drawn, () => {
          const { planned, selected } = this.ships;
          const free = stack.indices.find((index) => !planned.has(index));
          const pick = stack.indices.find((index) => index === selected) ?? free ?? stack.indices.findLast((index) => planned.has(index))!;
          this.callbacks.onShipCardClick(pick);
        }),
      );
      if (flagship) {
        const element = createShipCard(flagship);
        element.addEventListener("click", () => this.callbacks.onShipCardClick("flagship"));
        cards.unshift(element);
      }
      this.shipRow.replaceChildren(...cards);
    }
    const marked = (pick: ShipPick) => planned.has(pick) || pick === selected;
    const picks: ShipPick[][] = [...(this.flagship ? [["flagship" as const]] : []), ...this.shipStacks.map((stack) => stack.indices)];
    markSelected(this.shipRow, picks.map((stack) => stack.some(marked)));
  }

  /** Ein Klick auf einen Stapel meint den eingeplanten Befehl, sonst den gewählten, sonst das erste Exemplar. */
  renderCommands(hand: readonly CommandCard[], planned: number | null, selected: number | null): void {
    this.commands = { planned, selected };
    if (!sameCards(hand, this.commandHand)) {
      const drawn = drawnIndices(this.commandHand, hand);
      this.commandHand = hand;
      this.commandStacks = stacksOf(hand);
      this.commandRow.replaceChildren(
        ...this.commandStacks.map((stack) =>
          stackElement(createCommandCard(stack.card), stack, drawn, () => {
            const { planned, selected } = this.commands;
            const pick = [planned, selected].find((index) => index !== null && stack.indices.includes(index));
            this.callbacks.onCommandCardClick(pick ?? stack.indices[0]!);
          }),
        ),
      );
    }
    markSelected(
      this.commandRow,
      this.commandStacks.map((stack) => stack.indices.some((index) => index === planned || index === selected)),
    );
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

function markSelected(row: HTMLElement, marked: readonly boolean[]): void {
  for (const [index, element] of [...row.children].entries()) element.classList.toggle("selected", marked[index]!);
}

/** Gleiche Karten der Hand liegen als ein Stapel, an der Stelle der ersten; `indices` sind ihre Hand-Indizes. */
interface Stack<T> {
  card: T;
  indices: number[];
}

function stacksOf<T extends ShipCard | CommandCard>(hand: readonly T[]): Stack<T>[] {
  const stacks = new Map<string, Stack<T>>();
  hand.forEach((card, index) => {
    const stack = stacks.get(card.id);
    if (stack) stack.indices.push(index);
    else stacks.set(card.id, { card, indices: [index] });
  });
  return [...stacks.values()];
}

/** Die Karte eines Stapels: ab zwei Exemplaren mit Anzahl und Kanten dahinter; sie fliegt ein, wenn ein Exemplar neu ist. */
function stackElement<T>(element: HTMLElement, stack: Stack<T>, drawn: readonly number[], onClick: () => void): HTMLElement {
  const count = stack.indices.length;
  if (count > 1) {
    element.classList.add(count > 2 ? "stacked-deep" : "stacked");
    element.insertAdjacentHTML("beforeend", `<span class="stack-count">×${count}</span>`);
  }
  element.addEventListener("click", onClick);
  const orders = stack.indices.map((index) => drawn.indexOf(index)).filter((order) => order !== -1);
  markDrawn(element, orders.length > 0 ? Math.min(...orders) : -1);
  return element;
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
