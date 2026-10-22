// Ein gemischter Nachziehstapel, getrennt für Schiffe und Befehle.

import { COMMANDS, SHIPS, type Card, type CommandCard, type ShipCard } from "../data/cards.ts";

export class Deck<T extends Card> {
  private cards: T[];

  constructor(cards: readonly T[]) {
    this.cards = [...cards];
  }

  shuffle(): void {
    for (let i = this.cards.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [this.cards[i], this.cards[j]] = [this.cards[j]!, this.cards[i]!];
    }
  }

  draw(): T | null {
    return this.cards.pop() ?? null;
  }

  drawMany(count: number): T[] {
    const result: T[] = [];
    for (let i = 0; i < count; i++) {
      const card = this.draw();
      if (card === null) break;
      result.push(card);
    }
    return result;
  }

  get size(): number {
    return this.cards.length;
  }
}

/** Zwei Kopien je Schiff. */
export function buildDefaultShipDeck(): Deck<ShipCard> {
  const deck = new Deck(SHIPS.flatMap((card) => [card, card]));
  deck.shuffle();
  return deck;
}

/** Eine Kopie je Befehl. */
export function buildDefaultCommandDeck(): Deck<CommandCard> {
  const deck = new Deck(COMMANDS);
  deck.shuffle();
  return deck;
}
