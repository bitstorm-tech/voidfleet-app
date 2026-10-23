// Spielzustand eines Matches aus Sicht des Clients: Brett, Hände und der
// geplante Zug der laufenden Runde. Der Server ist autoritativ; `apply`
// übernimmt seine Sicht, geplant wird lokal bis zum Submit.

import { commandById, shipById, type CommandCard, type ShipCard } from "../../../shared/cards.ts";
import { Board, otherLane, type Slot } from "../../../shared/board.ts";
import type { MatchResult, PlayerView, TurnPlan } from "../../../shared/protocol.ts";

export class Match {
  readonly board = new Board();
  shipHand: ShipCard[] = [];
  commandHand: CommandCard[] = [];
  shipDeckSize = 0;
  commandDeckSize = 0;
  round = 0;
  plan: TurnPlan = { ship: null, command: null };
  /** Der Zug ist abgegeben und bis zur Auflösung gesperrt. */
  submitted = false;
  opponent = { joined: false, submitted: false };
  result: MatchResult | null = null;

  get plannedShip(): ShipCard | null {
    return this.plan.ship ? (this.shipHand[this.plan.ship.handIndex] ?? null) : null;
  }

  get plannedCommand(): CommandCard | null {
    return this.plan.command ? (this.commandHand[this.plan.command.handIndex] ?? null) : null;
  }

  /** Der eingeplante Lane-Wechsel: das Schiff und der freie Slot, in den es geht. */
  get plannedMove(): { from: Slot; to: Slot } | null {
    const command = this.plan.command;
    if (!command?.target || command.destination === null) return null;
    const from = this.board.lane("player", command.target.lane).slots[command.target.slotIndex]!;
    return { from, to: this.board.lane("player", otherLane(from.lane.type)).slots[command.destination]! };
  }

  /** Übernimmt die Server-Sicht. Ein noch nicht abgegebener Plan bleibt innerhalb der Runde erhalten. */
  apply(view: PlayerView): void {
    if (view.submittedPlan) {
      this.plan = view.submittedPlan;
    } else if (view.round !== this.round) {
      this.plan = { ship: null, command: null };
    }
    this.submitted = view.submittedPlan !== null;
    this.round = view.round;
    this.board.load(view.board);
    this.shipHand = view.shipHand.map(shipById);
    this.commandHand = view.commandHand.map(commandById);
    this.shipDeckSize = view.shipDeckSize;
    this.commandDeckSize = view.commandDeckSize;
    this.opponent = view.opponent;
    this.result = view.result;
  }
}
