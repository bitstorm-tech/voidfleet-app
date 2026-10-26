// Spielzustand eines Matches aus Sicht des Clients: Brett, Hände, Admirale und der
// geplante Zug der laufenden Runde. Der Server ist autoritativ; `apply`
// übernimmt seine Sicht, geplant wird lokal bis zum Submit.

import { ADMIRALS, targetsEnemy, type AdmiralId, type PowerId } from "../../../shared/admirals.ts";
import { commandById, isToken, shipById, targetsEnemySlot, type CommandCard, type ShipCard } from "../../../shared/cards.ts";
import { Board, isSameSlot, maxDeploys, otherLane, overdriveBonus, slotTarget, type PlannedMove, type Side, type Slot } from "../../../shared/board.ts";
import { canMark, markTargets, powerTargets, railgunFires } from "../../../shared/powers.ts";
import type { MatchResult, OpponentView, PlayerView, SlotRef, SlotTarget, TurnPlan } from "../../../shared/protocol.ts";

/** Ein Schiff zum Legen: eine Karte der Schiffshand (Index) oder in Runde 1 das Flaggschiff. */
export type ShipPick = number | "flagship";

/** Ein eingeplantes Schiff und der Slot, auf dem es landet. */
export interface Arrival {
  pick: ShipPick;
  target: SlotTarget;
}

/** Stand eines Zug-Teils: eingeplant, noch möglich oder gar nicht möglich. */
export type TurnPartState = "done" | "open" | "blocked";

/** Die Teile eines Zugs für die Checkliste; null heißt, der Teil gehört in dieser Runde nicht dazu. */
export interface TurnProgress {
  /** Runde 1: das Flaggschiff, Pflicht. */
  flagship: TurnPartState | null;
  ships: TurnPartState;
  command: TurnPartState;
  /** Grundmanöver oder Admiralsfähigkeit. */
  maneuver: TurnPartState;
  /** Pendulum: die Zielerfassung, nur in Runden, in denen sie markieren darf. */
  mark: TurnPartState | null;
}

const emptyPlan = (): TurnPlan => ({ ships: [], command: null, maneuver: null, flagship: null, power: null, mark: null });

export class Match {
  readonly board = new Board();
  shipHand: ShipCard[] = [];
  commandHand: CommandCard[] = [];
  shipDeckSize = 0;
  commandDeckSize = 0;
  round = 0;
  /** Der eigene Admiral; null, solange noch nicht gewählt. */
  admiral: AdmiralId | null = null;
  plan: TurnPlan = emptyPlan();
  /** Der Zug ist abgegeben und bis zur Auflösung gesperrt. */
  submitted = false;
  /** Was man vom Gegner weiß, sobald er beigetreten ist. */
  opponent: OpponentView | null = null;
  result: MatchResult | null = null;
  surrendered = false;

  /** Das eigene Flaggschiff; null, solange kein Admiral gewählt ist. */
  get flagship(): ShipCard | null {
    return this.admiral && shipById(ADMIRALS[this.admiral].flagship);
  }

  /** Die eigene Admiralsfähigkeit; null, solange kein Admiral gewählt ist. */
  get power(): PowerId | null {
    return this.admiral && ADMIRALS[this.admiral].power;
  }

  /** Runde 1 beginnt erst, wenn beide ihren Admiral gewählt haben; erst dann sieht man den des Gegners. */
  get admiralsChosen(): boolean {
    return this.admiral !== null && (this.opponent?.admiral ?? null) !== null;
  }

  /** In Runde 1 kommt das Flaggschiff aufs Brett; „Zug beenden“ geht erst, wenn es eingeplant ist. */
  get needsFlagship(): boolean {
    return this.round === 1 && this.flagship !== null;
  }

  get flagshipMissing(): boolean {
    return this.needsFlagship && this.plan.flagship === null;
  }

  get plannedShips(): ShipCard[] {
    return this.plan.ships.map((ship) => this.shipHand[ship.handIndex]!);
  }

  /** Wie viele Schiffe in dieser Runde noch gelegt werden dürfen (`maxDeploys`); das Flaggschiff zählt nicht mit. */
  get deploysLeft(): number {
    return maxDeploys(this.round) - this.plan.ships.length;
  }

  get plannedCommand(): CommandCard | null {
    return this.plan.command ? (this.commandHand[this.plan.command.handIndex] ?? null) : null;
  }

  cardOf(pick: ShipPick): ShipCard {
    return pick === "flagship" ? this.flagship! : this.shipHand[pick]!;
  }

  /** Was in dieser Runde landet: das Flaggschiff (Runde 1) und die eingeplanten Schiffe der Hand. */
  get arrivals(): Arrival[] {
    return this.keptArrivals(null);
  }

  /** Das eingeplante Schiff, das auf diesem Slot landet; auf dem Brett ist er bis zur Auflösung leer. */
  plannedPickAt(slot: Slot): ShipPick | null {
    if (slot.lane.side !== "player") return null;
    return this.arrivals.find((arrival) => isSameSlot(arrival.target, slotTarget(slot)))?.pick ?? null;
  }

  /** Das Schiff auf einem Slot, wie es für Befehle und Fähigkeit zählt: auch ein eingeplantes, das vor ihnen landet. */
  shipAt(slot: Slot): ShipCard | null {
    const pick = this.plannedPickAt(slot);
    return pick === null ? slot.card : this.cardOf(pick);
  }

  /** Der Zielslot eines eingeplanten Torpedos auf der Gegnerseite. */
  get plannedEnemyTarget(): SlotTarget | null {
    const card = this.plannedCommand;
    return card && targetsEnemySlot(card) ? this.plan.command!.target : null;
  }

  /**
   * Die übrigen Ankünfte, wenn `pick` (neu) geplant wird (null: alle): Es selbst zieht um, und sind schon alle
   * Deploys vergeben, weicht beim Schiff der Hand das zuerst geplante. Das Flaggschiff zählt nicht zu den Deploys.
   */
  keptArrivals(pick: ShipPick | null): Arrival[] {
    const flagship: Arrival[] = this.plan.flagship && pick !== "flagship" ? [{ pick: "flagship", target: this.plan.flagship }] : [];
    const ships = pick === null ? this.plan.ships : this.keptDeploys(pick);
    return [...flagship, ...ships.map((ship) => ({ pick: ship.handIndex, target: ship.target }))];
  }

  /** Plant ein Schiff (siehe `keptArrivals`). */
  planShip(pick: ShipPick, target: SlotTarget): void {
    if (pick === "flagship") this.setArrivals(target, this.plan.ships);
    else this.setArrivals(this.plan.flagship, [...this.keptDeploys(pick), { handIndex: pick, target }]);
  }

  /** Nimmt das eingeplante Schiff zurück. */
  unplanShip(pick: ShipPick): void {
    if (pick === "flagship") this.setArrivals(null, this.plan.ships);
    else this.setArrivals(this.plan.flagship, this.plan.ships.filter((ship) => ship.handIndex !== pick));
  }

  /** Die eingeplanten Schiffe der Hand ohne `pick`; sind schon alle Deploys vergeben, weicht das zuerst geplante. */
  private keptDeploys(pick: ShipPick): TurnPlan["ships"] {
    if (pick === "flagship") return this.plan.ships;
    const others = this.plan.ships.filter((ship) => ship.handIndex !== pick);
    return others.slice(Math.max(0, others.length - maxDeploys(this.round) + 1));
  }

  /**
   * Ein Befehl auf ein eingeplantes Schiff fällt mit weg, sobald auf dessen Slot nichts mehr landet; die Fähigkeit, sobald
   * ihr Ziel nicht mehr gilt (z. B. Taktvorsprung, wenn statt des Kampfschiffs ein Support-Schiff auf dem Slot landet).
   */
  private setArrivals(flagship: SlotTarget | null, ships: TurnPlan["ships"]): void {
    this.plan.flagship = flagship;
    this.plan.ships = ships;
    const target = this.plannedEnemyTarget ? null : this.plan.command?.target;
    if (target && this.shipAt(this.ownSlot(target)) === null) this.plan.command = null;
    const power = this.plannedPowerTarget;
    if (power && !this.powerTargets.some((ref) => ref.side === power.side && isSameSlot(ref, power))) this.plan.power = null;
  }

  /** Der Lane-Wechsel des Bewegungsbefehls. `from` kann der Slot des eingeplanten Schiffs sein, der auf dem Brett noch leer ist (siehe `shipAt`). */
  get plannedCommandMove(): PlannedMove | null {
    const command = this.plan.command;
    if (!command?.target || command.destination === null) return null;
    return this.move(command.target, { lane: otherLane(command.target.lane), slotIndex: command.destination });
  }

  /**
   * Das Grundmanöver: ein Schiff, das schon auf dem Brett steht, in einen freien Slot beider Lanes; es feuert in dieser
   * Runde nicht. Die Mirage darf auch in einen belegten Slot: Phasentausch, beide tauschen die Plätze und feuern.
   */
  get plannedManeuver(): PlannedMove | null {
    const maneuver = this.plan.maneuver;
    return maneuver && this.move(maneuver.ship, maneuver.destination);
  }

  /** Ob das Grundmanöver ein Phasentausch ist: Sein Ziel-Slot ist belegt. */
  get plannedSwap(): PlannedMove | null {
    const maneuver = this.plannedManeuver;
    return maneuver?.to.isOccupied ? maneuver : null;
  }

  /** Das Trugbild: der freie Strike-Slot, in dem es in dieser Runde steht. */
  get plannedDecoy(): SlotTarget | null {
    return this.power === "decoy" ? (this.plan.power?.target ?? null) : null;
  }

  /**
   * Ziel-Slots für den Bewegungsbefehl auf das Schiff in `from`: nicht für das manövrierende Schiff (auch nicht für
   * den Tauschpartner der Mirage), und Deploys, Manöver-Ziel und Trugbild zählen als besetzt (`Board.canMove`).
   */
  commandMoveDestinations(from: Slot): Slot[] {
    const maneuver = this.plannedManeuver;
    if (maneuver?.from === from || this.plannedSwap?.to === from) return [];
    // Beim Phasentausch ist das Ziel schon belegt; der Tausch ändert die Schiffszahl keiner Lane.
    const destinations = this.board.laneSwitchDestinations(from, this.arrivals.map((arrival) => arrival.target), this.plannedSwap ? null : maneuver);
    const decoy = this.plannedDecoy;
    return decoy ? destinations.filter((slot) => !isSameSlot(slotTarget(slot), decoy)) : destinations;
  }

  /**
   * Ziel-Slots für das Manöver des Schiffs in `from`: nur echte Schiffe, die kein Bewegungsbefehl verlegt. Die Mirage
   * tauscht auch mit einem eigenen Schiff, das schon auf dem Brett steht und das kein Bewegungsbefehl verlegt.
   */
  maneuverDestinations(from: Slot): Slot[] {
    const command = this.plannedCommandMove;
    if (!from.isOccupied || command?.from === from) return [];
    const free = this.board.maneuverDestinations(from, this.arrivals.map((arrival) => arrival.target), command);
    if (from.card!.id !== "mirage") return free;
    const partners = this.board.ships("player").filter((slot) => slot !== from && slot !== command?.from);
    return [...free, ...partners];
  }

  /**
   * Ob `pick` auf `slot` landen kann, neben den übrigen Ankünften (`keptArrivals`), nicht im Slot des Trugbilds
   * und ohne den eingeplanten Bewegungen im Weg zu stehen. Verlegt der Befehl ein Schiff, das dabei
   * wegfällt, fällt er beim Umplanen ohnehin weg (`planShip`).
   */
  canDeploy(slot: Slot, pick: ShipPick): boolean {
    const decoy = this.plannedDecoy;
    if (decoy && isSameSlot(decoy, slotTarget(slot))) return false;
    const deploys = [...this.keptArrivals(pick).map((arrival) => arrival.target), slotTarget(slot)];
    if (!this.board.canPlace(slot.lane, slot.index, deploys.slice(0, -1))) return false;
    const command = this.plannedCommandMove;
    const keeps = (move: PlannedMove) => move.from.isOccupied || deploys.some((deploy) => isSameSlot(deploy, slotTarget(move.from)));
    const keptCommand = command !== null && keeps(command) ? command : null;
    // Der Phasentausch geht in einen belegten Slot; ihm kann kein Deploy im Weg stehen.
    const maneuver = this.plannedSwap ? null : this.plannedManeuver;
    const fits = (move: PlannedMove | null, other: PlannedMove | null) => move === null || this.board.canMove(move.from, slotTarget(move.to), deploys, other);
    return fits(keptCommand, maneuver) && fits(maneuver, keptCommand);
  }

  /** Gültige Ziele der eigenen Admiralsfähigkeit beim jetzigen Plan (`powerTargets`); ein geplantes Manöver weicht ihr. */
  get powerTargets(): SlotRef[] {
    const power = this.power;
    if (power === null) return [];
    const arrivals = this.arrivals.map(({ pick, target }) => ({ card: this.cardOf(pick), target }));
    const move = this.plannedCommandMove;
    return powerTargets(this.board, "player", power, arrivals, move ? [slotTarget(move.to)] : []);
  }

  /** Die eingeplante Fähigkeit als Slot samt Seite. */
  get plannedPowerTarget(): SlotRef | null {
    return this.plan.power && { side: targetsEnemy(this.power!) ? "enemy" : "player", ...this.plan.power.target };
  }

  /** Die Pendulum darf markieren: Sie steht und ihre Railgun feuert in dieser Runde nicht (`canMark`). */
  get canMark(): boolean {
    return canMark(this.board, "player");
  }

  get markTargets(): SlotRef[] {
    return markTargets(this.board, "player");
  }

  /** Das gegnerische Schiff, auf das die eigene Railgun in dieser Runde feuert; null, wenn sie nicht feuert. */
  get railgunTarget(): Slot | null {
    return railgunFires(this.board, "player") ? this.board.ships("enemy").find((slot) => slot.marked)! : null;
  }

  /** Ob sich die eigene Pendulum laut Plan bewegt: Dann verfällt ihre Markierung bzw. ihr Schuss. */
  get pendulumMoves(): boolean {
    const pendulum = this.board.flagship("player");
    if (pendulum?.card!.id !== "pendulum") return false;
    return this.plannedManeuver?.from === pendulum || this.plannedCommandMove?.from === pendulum;
  }

  /**
   * Was vom Zug noch offen ist. Schiffe gelten als erledigt, sobald alle Deploys vergeben sind oder
   * wenigstens eines eingeplant ist und kein weiteres mehr passt.
   */
  get turnProgress(): TurnProgress {
    const playerSlots = this.board.lanesFor("player").flatMap((lane) => lane.slots);
    const unplanned = this.shipHand.map((_, index) => index).filter((index) => !this.plan.ships.some((ship) => ship.handIndex === index));
    const canDeployMore = this.deploysLeft > 0 && unplanned.some((index) => playerSlots.some((slot) => this.canDeploy(slot, index)));
    const canManeuver = playerSlots.some((slot) => this.maneuverDestinations(slot).length > 0) || this.powerTargets.length > 0;
    return {
      flagship: this.needsFlagship ? (this.plan.flagship ? "done" : "open") : null,
      ships: canDeployMore ? "open" : this.plan.ships.length > 0 ? "done" : "blocked",
      command: this.plan.command ? "done" : this.commandHand.length > 0 ? "open" : "blocked",
      maneuver: this.plan.maneuver || this.plan.power ? "done" : canManeuver ? "open" : "blocked",
      mark: this.canMark ? (this.plan.mark ? "done" : this.markTargets.length > 0 ? "open" : "blocked") : null,
    };
  }

  /** Eigene Kriegsschiffe auf Brett und Hand, ohne Drohnen. */
  get warships(): number {
    return [...this.board.ships("player").map((slot) => slot.card!), ...this.shipHand].filter((card) => card.atk > 0 && !isToken(card)).length;
  }

  private ownSlot({ lane, slotIndex }: SlotTarget): Slot {
    return this.board.lane("player", lane).slots[slotIndex]!;
  }

  private move(ship: SlotTarget, destination: SlotTarget): PlannedMove {
    return { from: this.ownSlot(ship), to: this.ownSlot(destination) };
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
    } else if (view.round !== this.round || view.admiral !== this.admiral) {
      this.plan = emptyPlan();
    }
    this.submitted = view.submittedPlan !== null;
    this.round = view.round;
    this.admiral = view.admiral;
    this.board.load(view.board);
    this.board.overdrive = overdriveBonus(view.round);
    this.board.hiveLaunches = { ...view.hiveLaunches };
    this.shipHand = view.shipHand.map(shipById);
    this.commandHand = view.commandHand.map(commandById);
    this.shipDeckSize = view.shipDeckSize;
    this.commandDeckSize = view.commandDeckSize;
    this.opponent = view.opponent;
    this.result = view.result;
    this.surrendered = view.surrendered;
  }
}
