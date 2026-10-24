// Spielzustand eines Matches aus Sicht des Clients: Brett, Hände und der
// geplante Zug der laufenden Runde. Der Server ist autoritativ; `apply`
// übernimmt seine Sicht, geplant wird lokal bis zum Submit.

import { commandById, shipById, targetsEnemySlot, type CommandCard, type ShipCard } from "../../../shared/cards.ts";
import { Board, isSameSlot, maxDeploys, otherLane, overdriveBonus, slotTarget, type Slot } from "../../../shared/board.ts";
import type { Deploy, MatchResult, PlayerView, SlotTarget, TurnPlan } from "../../../shared/protocol.ts";

/** Eine eingeplante Bewegung: der Slot des Schiffs und der freie Slot, in den es geht. */
export interface PlannedMove {
  from: Slot;
  to: Slot;
}

/** Stand eines Zug-Teils: eingeplant, noch möglich oder gar nicht möglich. */
export type TurnPartState = "done" | "open" | "blocked";

const emptyPlan = (): TurnPlan => ({ ships: [], command: null, maneuver: null });

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
  surrendered = false;

  get plannedShips(): ShipCard[] {
    return this.plan.ships.map((ship) => this.shipHand[ship.handIndex]!);
  }

  /** Wie viele Schiffe in dieser Runde noch gelegt werden dürfen (`maxDeploys`). */
  get deploysLeft(): number {
    return maxDeploys(this.round) - this.plan.ships.length;
  }

  get plannedCommand(): CommandCard | null {
    return this.plan.command ? (this.commandHand[this.plan.command.handIndex] ?? null) : null;
  }

  /** Das eingeplante Schiff, das auf diesem Slot landet; auf dem Brett ist er bis zur Auflösung leer. */
  plannedDeployAt(slot: Slot): Deploy | null {
    if (slot.lane.side !== "player") return null;
    return this.plan.ships.find((ship) => isSameSlot(ship.target, slotTarget(slot))) ?? null;
  }

  /** Das Schiff auf einem Slot, wie es für Befehle zählt: auch ein eingeplantes, das vor den Befehlen landet. */
  shipAt(slot: Slot): ShipCard | null {
    const deploy = this.plannedDeployAt(slot);
    return deploy ? this.shipHand[deploy.handIndex]! : slot.card;
  }

  /** Der Zielslot eines eingeplanten Torpedos auf der Gegnerseite. */
  get plannedEnemyTarget(): SlotTarget | null {
    const card = this.plannedCommand;
    return card && targetsEnemySlot(card) ? this.plan.command!.target : null;
  }

  /**
   * Die eingeplanten Schiffe, die bleiben, wenn die Karte `handIndex` (neu) geplant wird: Sie selbst
   * zieht um, und sind schon alle Deploys vergeben, weicht das zuerst geplante Schiff.
   */
  keptDeploys(handIndex: number): Deploy[] {
    const others = this.plan.ships.filter((ship) => ship.handIndex !== handIndex);
    return others.slice(Math.max(0, others.length - maxDeploys(this.round) + 1));
  }

  /** Plant ein Schiff (siehe `keptDeploys`). */
  planShip(ship: Deploy): void {
    this.setShips([...this.keptDeploys(ship.handIndex), ship]);
  }

  /** Nimmt das eingeplante Schiff von der Hand-Karte `handIndex` zurück. */
  unplanShip(handIndex: number): void {
    this.setShips(this.plan.ships.filter((ship) => ship.handIndex !== handIndex));
  }

  /** Ein Befehl auf ein eingeplantes Schiff fällt mit weg, sobald auf dessen Slot nichts mehr landet. */
  private setShips(ships: Deploy[]): void {
    this.plan.ships = ships;
    const target = this.plannedEnemyTarget ? null : this.plan.command?.target;
    if (target && this.shipAt(this.board.lane("player", target.lane).slots[target.slotIndex]!) === null) this.plan.command = null;
  }

  /** Der Lane-Wechsel des Bewegungsbefehls. `from` kann der Slot des eingeplanten Schiffs sein, der auf dem Brett noch leer ist (siehe `shipAt`). */
  get plannedCommandMove(): PlannedMove | null {
    const command = this.plan.command;
    if (!command?.target || command.destination === null) return null;
    return this.move(command.target, { lane: otherLane(command.target.lane), slotIndex: command.destination });
  }

  /** Das Grundmanöver: ein Schiff, das schon auf dem Brett steht, in einen freien Slot beider Lanes; es feuert in dieser Runde nicht. */
  get plannedManeuver(): PlannedMove | null {
    const maneuver = this.plan.maneuver;
    return maneuver && this.move(maneuver.ship, maneuver.destination);
  }

  /**
   * Ziel-Slots für den Bewegungsbefehl auf das Schiff in `from`: nicht für das manövrierende Schiff,
   * und Deploys und Manöver-Ziel zählen als besetzt (`Board.canMove`).
   */
  commandMoveDestinations(from: Slot): Slot[] {
    const maneuver = this.plannedManeuver;
    if (maneuver?.from === from) return [];
    return this.board.laneSwitchDestinations(from, [...this.plannedDeploys, maneuver && slotTarget(maneuver.to)]);
  }

  /** Ziel-Slots für das Manöver des Schiffs in `from`: nur echte Schiffe, die kein Bewegungsbefehl verlegt. */
  maneuverDestinations(from: Slot): Slot[] {
    const command = this.plannedCommandMove;
    if (!from.isOccupied || command?.from === from) return [];
    return this.board.maneuverDestinations(from, [...this.plannedDeploys, command && slotTarget(command.to)]);
  }

  /**
   * Ob die Karte `handIndex` auf `slot` landen kann, neben den übrigen eingeplanten Schiffen (`keptDeploys`)
   * und ohne den eingeplanten Bewegungen im Weg zu stehen. Verlegt der Befehl ein Schiff, das dabei
   * wegfällt, fällt er beim Umplanen ohnehin weg (`planShip`).
   */
  canDeploy(slot: Slot, handIndex: number): boolean {
    const deploys = [...this.keptDeploys(handIndex).map((ship) => ship.target), slotTarget(slot)];
    if (!this.board.canPlace(slot.lane, slot.index, deploys.slice(0, -1))) return false;
    const command = this.plannedCommandMove;
    const keeps = (move: PlannedMove) => move.from.isOccupied || deploys.some((deploy) => isSameSlot(deploy, slotTarget(move.from)));
    const keptCommand = command !== null && keeps(command) ? command : null;
    const maneuver = this.plannedManeuver;
    const fits = (move: PlannedMove | null, other: PlannedMove | null) =>
      move === null || this.board.canMove(move.from, slotTarget(move.to), [...deploys, other && slotTarget(other.to)]);
    return fits(keptCommand, maneuver) && fits(maneuver, keptCommand);
  }

  /**
   * Was vom Zug noch offen ist. Schiffe gelten als erledigt, sobald alle Deploys vergeben sind oder
   * wenigstens eines eingeplant ist und kein weiteres mehr passt.
   */
  get turnProgress(): Record<"ships" | "command" | "maneuver", TurnPartState> {
    const playerSlots = this.board.lanesFor("player").flatMap((lane) => lane.slots);
    const unplanned = this.shipHand.map((_, index) => index).filter((index) => !this.plan.ships.some((ship) => ship.handIndex === index));
    const canDeployMore = this.deploysLeft > 0 && unplanned.some((index) => playerSlots.some((slot) => this.canDeploy(slot, index)));
    const canManeuver = playerSlots.some((slot) => this.maneuverDestinations(slot).length > 0);
    return {
      ships: canDeployMore ? "open" : this.plan.ships.length > 0 ? "done" : "blocked",
      command: this.plan.command ? "done" : this.commandHand.length > 0 ? "open" : "blocked",
      maneuver: this.plan.maneuver ? "done" : canManeuver ? "open" : "blocked",
    };
  }

  private get plannedDeploys(): SlotTarget[] {
    return this.plan.ships.map((ship) => ship.target);
  }

  private move(ship: SlotTarget, destination: SlotTarget): PlannedMove {
    const slotOf = ({ lane, slotIndex }: SlotTarget) => this.board.lane("player", lane).slots[slotIndex]!;
    return { from: slotOf(ship), to: slotOf(destination) };
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
    this.board.overdrive = overdriveBonus(view.round);
    this.shipHand = view.shipHand.map(shipById);
    this.commandHand = view.commandHand.map(commandById);
    this.shipDeckSize = view.shipDeckSize;
    this.commandDeckSize = view.commandDeckSize;
    this.opponent = view.opponent;
    this.result = view.result;
    this.surrendered = view.surrendered;
  }
}
