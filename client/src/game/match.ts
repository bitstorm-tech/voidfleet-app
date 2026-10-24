// Spielzustand eines Matches aus Sicht des Clients: Brett, Hände und der
// geplante Zug der laufenden Runde. Der Server ist autoritativ; `apply`
// übernimmt seine Sicht, geplant wird lokal bis zum Submit.

import { commandById, shipById, targetsEnemySlot, type CommandCard, type ShipCard } from "../../../shared/cards.ts";
import { Board, isSameSlot, otherLane, slotTarget, type Slot } from "../../../shared/board.ts";
import type { MatchResult, PlayerView, SlotTarget, TurnPlan } from "../../../shared/protocol.ts";

/** Ein eingeplanter Lane-Wechsel: der Slot des Schiffs und der freie Slot der anderen Lane, in den es geht. */
export interface PlannedMove {
  from: Slot;
  to: Slot;
}

const emptyPlan = (): TurnPlan => ({ ship: null, command: null, maneuver: null });

export class Match {
  readonly board = new Board();
  shipHand: ShipCard[] = [];
  commandHand: CommandCard[] = [];
  shipDeckSize = 0;
  commandDeckSize = 0;
  round = 0;
  plan: TurnPlan = emptyPlan();
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

  /** Der Zielslot eines eingeplanten Torpedos auf der Gegnerseite. */
  get plannedEnemyTarget(): SlotTarget | null {
    const card = this.plannedCommand;
    return card && targetsEnemySlot(card) ? this.plan.command!.target : null;
  }

  /**
   * Plant das Schiff oder nimmt es mit null zurück. Ein Befehl auf das bisher eingeplante Schiff
   * fällt mit weg, sobald auf dessen Slot nichts mehr landet.
   */
  planShip(ship: TurnPlan["ship"]): void {
    const previous = this.plan.ship?.target;
    const target = this.plannedEnemyTarget ? null : this.plan.command?.target;
    const keepsSlot = ship !== null && previous !== undefined && isSameSlot(ship.target, previous);
    if (previous && target && isSameSlot(target, previous) && !keepsSlot) this.plan.command = null;
    this.plan.ship = ship;
  }

  /** Der Lane-Wechsel des Bewegungsbefehls. `from` kann der Slot des eingeplanten Schiffs sein, der auf dem Brett noch leer ist (siehe `shipAt`). */
  get plannedCommandMove(): PlannedMove | null {
    const command = this.plan.command;
    if (!command?.target || command.destination === null) return null;
    return this.move(command.target, command.destination);
  }

  /** Das Grundmanöver: ein Schiff, das schon auf dem Brett steht; es feuert in dieser Runde nicht. */
  get plannedManeuver(): PlannedMove | null {
    const maneuver = this.plan.maneuver;
    return maneuver && this.move(maneuver.ship, maneuver.destination);
  }

  /**
   * Ziel-Slots für den Bewegungsbefehl auf das Schiff in `from`: nicht für das manövrierende Schiff,
   * und Deploy und Manöver-Ziel zählen als besetzt (`Board.canMove`).
   */
  commandMoveDestinations(from: Slot): number[] {
    const maneuver = this.plannedManeuver;
    if (maneuver?.from === from) return [];
    return this.board.moveDestinations(from, [this.plannedDeploy, maneuver && slotTarget(maneuver.to)]);
  }

  /** Ziel-Slots für das Manöver des Schiffs in `from`: nur echte Schiffe, die kein Bewegungsbefehl verlegt. */
  maneuverDestinations(from: Slot): number[] {
    const command = this.plannedCommandMove;
    if (!from.isOccupied || command?.from === from) return [];
    return this.board.moveDestinations(from, [this.plannedDeploy, command && slotTarget(command.to)]);
  }

  /**
   * Ob das gewählte Schiff auf `slot` landen kann, ohne den eingeplanten Lane-Wechseln im Weg zu stehen.
   * Verlegt der Befehl das bisher geplante Schiff, fällt er beim Umplanen ohnehin weg (`planShip`).
   */
  canDeploy(slot: Slot): boolean {
    if (!this.board.canPlace(slot.lane, slot.index)) return false;
    const deploy = slotTarget(slot);
    const command = this.plannedCommandMove;
    const keptCommand = command !== null && !this.isPlannedDeploy(command.from) ? command : null;
    const maneuver = this.plannedManeuver;
    const fits = (move: PlannedMove | null, other: PlannedMove | null) =>
      move === null || this.board.canMove(move.from, move.to.index, [deploy, other && slotTarget(other.to)]);
    return fits(keptCommand, maneuver) && fits(maneuver, keptCommand);
  }

  private get plannedDeploy(): SlotTarget | null {
    return this.plan.ship?.target ?? null;
  }

  private move(ship: SlotTarget, destination: number): PlannedMove {
    const from = this.board.lane("player", ship.lane).slots[ship.slotIndex]!;
    return { from, to: this.board.lane("player", otherLane(ship.lane)).slots[destination]! };
  }

  /**
   * Die Runde ist aufgelöst, der Plan verbraucht. Das meldet erst die Auflösung selbst: Wer als Zweiter
   * abgibt, bekommt keinen Zustand mit abgegebenem Plan, und nach der letzten Runde steigt die
   * Rundenzahl nicht mehr.
   */
  endRound(): void {
    this.plan = emptyPlan();
  }

  /** Übernimmt die Server-Sicht. Ein noch nicht abgegebener Plan bleibt innerhalb der Runde erhalten. */
  apply(view: PlayerView): void {
    if (view.submittedPlan) {
      this.plan = view.submittedPlan;
    } else if (view.round !== this.round) {
      this.plan = emptyPlan();
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
