// Spielzustand eines Matches aus Sicht des Clients: Brett, Hände und der
// geplante Zug der laufenden Runde. Der Server ist autoritativ; `apply`
// übernimmt seine Sicht, geplant wird lokal bis zum Submit.

import { commandById, shipById, type CommandCard, type ShipCard } from "../../../shared/cards.ts";
import { Board, isSameSlot, otherLane, type Slot } from "../../../shared/board.ts";
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

  /** Ob das eingeplante Schiff auf diesem Slot landet; auf dem Brett ist er bis zur Auflösung leer. */
  isPlannedDeploy(slot: Slot): boolean {
    const target = this.plan.ship?.target;
    return slot.lane.side === "player" && target !== undefined && isSameSlot(target, { lane: slot.lane.type, slotIndex: slot.index });
  }

  /** Das Schiff auf einem Slot, wie es für Befehle zählt: auch das eingeplante, das vor den Befehlen landet. */
  shipAt(slot: Slot): ShipCard | null {
    return this.isPlannedDeploy(slot) ? this.plannedShip : slot.card;
  }

  /**
   * Plant das Schiff oder nimmt es mit null zurück. Ein Befehl auf das bisher eingeplante Schiff
   * fällt mit weg, sobald auf dessen Slot nichts mehr landet.
   */
  planShip(ship: TurnPlan["ship"]): void {
    const previous = this.plan.ship?.target;
    const target = this.plan.command?.target;
    const keepsSlot = ship !== null && previous !== undefined && isSameSlot(ship.target, previous);
    if (previous && target && isSameSlot(target, previous) && !keepsSlot) this.plan.command = null;
    this.plan.ship = ship;
  }

  /**
   * Der eingeplante Lane-Wechsel: der Slot des Schiffs und der freie Slot, in den es geht. `from` kann
   * der Slot des eingeplanten Schiffs sein, der auf dem Brett noch leer ist (siehe `shipAt`).
   */
  get plannedMove(): { from: Slot; to: Slot } | null {
    const command = this.plan.command;
    if (!command?.target || command.destination === null) return null;
    const from = this.board.lane("player", command.target.lane).slots[command.target.slotIndex]!;
    return { from, to: this.board.lane("player", otherLane(from.lane.type)).slots[command.destination]! };
  }

  /**
   * Die Runde ist aufgelöst, der Plan verbraucht. Das meldet erst die Auflösung selbst: Wer als Zweiter
   * abgibt, bekommt keinen Zustand mit abgegebenem Plan, und nach der letzten Runde steigt die
   * Rundenzahl nicht mehr.
   */
  endRound(): void {
    this.plan = { ship: null, command: null };
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
