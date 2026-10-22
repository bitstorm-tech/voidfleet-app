// Spielzustand eines Matches aus Sicht des Clients: Brett, Hände, Decks und
// der geplante Zug der laufenden Runde. Die Auflösung (Befehle, Kampf, Cleanup)
// gehört später zum Server; hier wird nur die Deploy-Phase lokal ausgeführt.

import type { CommandCard, ShipCard } from "../data/cards.ts";
import { Board, type Lane } from "./board.ts";
import { buildDefaultCommandDeck, buildDefaultShipDeck, type Deck } from "./deck.ts";

export const HAND_LIMIT = 6;
const STARTING_SHIPS = 3;
const STARTING_COMMANDS = 3;

export interface SlotRef {
  lane: Lane;
  slotIndex: number;
}

export interface TurnPlan {
  ship: { handIndex: number; target: SlotRef } | null;
  command: { handIndex: number; target: SlotRef | null } | null;
}

export class Match {
  readonly board = new Board();
  readonly shipHand: ShipCard[];
  readonly commandHand: CommandCard[];
  readonly shipDeck: Deck<ShipCard>;
  readonly commandDeck: Deck<CommandCard>;
  round = 1;
  plan: TurnPlan = { ship: null, command: null };

  constructor() {
    this.shipDeck = buildDefaultShipDeck();
    this.commandDeck = buildDefaultCommandDeck();
    this.shipHand = this.shipDeck.drawMany(STARTING_SHIPS);
    this.commandHand = this.commandDeck.drawMany(STARTING_COMMANDS);
  }

  get plannedShip(): ShipCard | null {
    return this.plan.ship ? (this.shipHand[this.plan.ship.handIndex] ?? null) : null;
  }

  get plannedCommand(): CommandCard | null {
    return this.plan.command ? (this.commandHand[this.plan.command.handIndex] ?? null) : null;
  }

  /**
   * Führt den geplanten Zug lokal aus: nur Deploy und Nachziehen, kein Gegner
   * und kein Kampf. Gibt die Log-Zeilen der Runde zurück.
   */
  submit(): string[] {
    const lines: string[] = [`— Runde ${this.round} —`];
    const { ship, command } = this.plan;

    if (ship) {
      const card = this.shipHand[ship.handIndex]!;
      const slot = this.board.place(ship.target.lane, ship.target.slotIndex, card);
      if (slot) {
        this.shipHand.splice(ship.handIndex, 1);
        lines.push(`Deploy: Spieler spielt ${card.name} auf ${ship.target.lane.label} Slot ${ship.target.slotIndex + 1}`);
      } else {
        lines.push(`Deploy: ${card.name} findet auf ${ship.target.lane.label} keinen Platz`);
      }
    } else {
      lines.push("Deploy: Spieler passt");
    }

    if (command) {
      const card = this.commandHand[command.handIndex]!;
      this.commandHand.splice(command.handIndex, 1);
      const target = command.target
        ? ` auf ${command.target.lane.label} Slot ${command.target.slotIndex + 1}`
        : "";
      lines.push(`Befehl: ${card.name}${target} (Auflösung folgt mit dem Server)`);
    }

    this.drawInto(this.shipHand, this.shipDeck);
    this.drawInto(this.commandHand, this.commandDeck);
    lines.push(
      `Nachziehen: ${this.shipHand.length}/${HAND_LIMIT} Schiffe (Deck ${this.shipDeck.size}), ` +
        `${this.commandHand.length}/${HAND_LIMIT} Befehle (Deck ${this.commandDeck.size})`,
    );

    this.round += 1;
    this.plan = { ship: null, command: null };
    return lines;
  }

  /** 1 Karte nachziehen. Ist die Handhälfte voll, verfällt die Karte. */
  private drawInto<T extends ShipCard | CommandCard>(hand: T[], deck: Deck<T>): void {
    const card = deck.draw();
    if (card !== null && hand.length < HAND_LIMIT) hand.push(card);
  }
}
