// Ein gemischter Nachziehstapel, getrennt für Schiffe und Befehle.

import { COMMANDS, SHIPS, type Card, type CommandCard, type CommandId, type ShipCard } from "../../shared/cards.ts";

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

  /** Zieht die oberste passende Karte; null, wenn keine passt. */
  drawWhere(predicate: (card: T) => boolean): T | null {
    const index = this.cards.findLastIndex(predicate);
    return index === -1 ? null : this.cards.splice(index, 1)[0]!;
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

/** Die Konter auf den gegnerischen Plan liegen doppelt im Deck, damit man mit ihnen rechnen muss. */
const DOUBLE_COMMANDS: readonly CommandId[] = ["torpedo", "barrage"];

/** Eine Kopie je Befehl, zwei von `DOUBLE_COMMANDS`. */
export function buildDefaultCommandDeck(): Deck<CommandCard> {
  const deck = new Deck(COMMANDS.flatMap((card) => (DOUBLE_COMMANDS.includes(card.id) ? [card, card] : [card])));
  deck.shuffle();
  return deck;
}
