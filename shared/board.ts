// Das Spielbrett: zwei Lanes pro Seite, Strike vorne, Command hinten.
// Kennt als einzige Stelle die Platzierungsregeln; die Slots tragen den
// Live-Zustand der Schiffe (HP, Schild, Rundenmodifikatoren). "player" ist immer die
// Seite des Betrachters; der Server spiegelt das Brett für den zweiten Spieler.

import { ABILITY_VALUES, type PowerId } from "./admirals.ts";
import { type CommandCard, type CommandId, extraDeploys, isFlagship, isToken, type ShipCard, type ShipId, shipById } from "./cards.ts";
import type { SlotTarget } from "./protocol.ts";

export type Side = "player" | "enemy";
export type LaneType = "strike" | "command";

export interface SlotState {
  cardId: ShipId;
  hp: number;
  shield: number;
  /** Dauerhafter ATK-Bonus des Scrap Raiders (`Slot.scrapBonus`). */
  scrapBonus: number;
  /** Von der gegnerischen Pendulum markiert: Ihre Railgun feuert in der nächsten Runde auf dieses Schiff (`Slot.marked`). */
  marked: boolean;
}

/** Serialisierbarer Brettzustand, je Seite und Lane die Slots in Index-Reihenfolge. */
export type BoardSnapshot = Record<Side, Record<LaneType, (SlotState | null)[]>>;

export function opposite(side: Side): Side {
  return side === "player" ? "enemy" : "player";
}

export function otherLane(type: LaneType): LaneType {
  return type === "strike" ? "command" : "strike";
}

export function isSameSlot(a: SlotTarget, b: SlotTarget): boolean {
  return a.lane === b.lane && a.slotIndex === b.slotIndex;
}

export function slotTarget(slot: Slot): SlotTarget {
  return { lane: slot.lane.type, slotIndex: slot.index };
}

/** Eine eingeplante Bewegung: der Slot des Schiffs und der Slot, in den es geht (beim Phasentausch belegt). */
export interface PlannedMove {
  from: Slot;
  to: Slot;
}

/** Ob die Bewegung ein Schiff aus der anderen Lane nach `lane` bringt, das zur Lane-Grenze zählt (kein Token). */
function joins(move: PlannedMove, lane: Lane): boolean {
  return move.to.lane === lane && move.from.lane !== lane && !(move.from.card && isToken(move.from.card));
}

export const SLOT_COUNT = 6;
export const MAX_SHIPS_PER_LANE = 4;
export const MAX_SHIPS_PER_SIDE = 6;

/** Aufstellung: In Runde 1 darf jede Seite zwei Schiffe legen, danach eines; mit Schnellverlegung (`command`) eines mehr. */
export function maxDeploys(round: number, command: CommandCard | null = null): number {
  return (round === 1 ? 2 : 1) + extraDeploys(command);
}

/** Ab dieser Runde bekommen alle Kampfschiffe Overdrive, damit Partien nicht im Patt enden. */
const OVERDRIVE_START = 8;
/** Alle so viele Runden steigt der Overdrive um 1 ATK. */
const OVERDRIVE_STEP = 4;

/** ATK-Bonus aller Kampfschiffe in dieser Runde: +1 ab Runde 8, +2 ab Runde 12, +3 ab Runde 16 usw. */
export function overdriveBonus(round: number): number {
  return round < OVERDRIVE_START ? 0 : Math.floor((round - OVERDRIVE_START) / OVERDRIVE_STEP) + 1;
}

const NO_POWERS: readonly PowerId[] = [];
const NO_LOCKS: readonly CommandId[] = [];

export class Slot {
  card: ShipCard | null = null;
  hp = 0;
  shield = 0;
  /** Scrap Raider: +1 ATK für jedes gegnerische Schiff, das in seiner Lane zerstört wurde; bleibt bis zu seiner Zerstörung. */
  scrapBonus = 0;
  /** Pendulum: Die Markierung folgt dem Schiff und hält über das Rundenende, bis die Railgun gefeuert hat. */
  marked = false;

  // Nur für die laufende Runde, im Cleanup zurückgesetzt. Zwischen den Runden
  // sind sie immer neutral und gehören deshalb nicht in den Snapshot.
  attackBonus = 0;
  shieldBonus = 0;
  disabled = false;
  /** Grundmanöver: Das Schiff hat diese Runde den Slot gewechselt und feuert dafür nicht. */
  maneuvered = false;
  /** Hat diese Runde den Slot gewechselt, per Grundmanöver oder Befehl (Ziel des Sperrfeuers). */
  moved = false;
  selfDamageAfterCombat = 0;
  /** Admiralsfähigkeiten, die in dieser Runde auf dem Schiff liegen (Gegenfeuer, Fokusfeuer, Schwarmangriff, Taktvorsprung); sie folgen ihm. */
  powers: readonly PowerId[] = NO_POWERS;
  /** Kam in dieser Runde aufs Brett: Deploy samt Flaggschiff, Drohne des Titan Carriers, Trugbild, Drohnenstaffel (Ziel des Minenfelds). */
  arrived = false;
  /** Ablenkung: Gegnerische Schützen nehmen diese Runde dieses Schiff, solange sie es beschießen können. */
  taunting = false;
  /** Gegnerische Befehle, die dieses Schiff erfasst haben (Wärmesucher, Traktorstrahl); sie folgen ihm. */
  locks: readonly CommandId[] = NO_LOCKS;
  /** Feuerbefehl dieser Runde: die Kennung (`uid`) des gegnerischen Schiffs, auf das es im Kampf feuert; null: Es feuert nicht. */
  aim: number | null = null;
  /**
   * Kennung des Schiffs, solange es auf dem Brett steht (`Board.nextUid`), 0 im leeren Slot; zieht mit ihm um. Gehört
   * nicht in den Snapshot: Feuerbefehle verweisen darauf nur innerhalb einer Runde.
   */
  uid = 0;

  constructor(
    readonly lane: Lane,
    readonly index: number,
  ) {}

  get isOccupied(): boolean {
    return this.card !== null;
  }

  /** Leer und nicht für ein Schiff im Kurzsprung gesperrt (`Board.jumping`): Hier darf ein Schiff hinein. */
  get isFree(): boolean {
    return !this.isOccupied && !this.lane.board.jumping.some((ship) => ship.lane === this.lane && ship.index === this.index);
  }

  get isDestroyed(): boolean {
    return this.isOccupied && this.hp <= 0;
  }

  /** Overdrive (`Board.overdrive`) gilt nur für Kampfschiffe, Support bleibt bei 0. */
  get attack(): number {
    if (!this.card) return 0;
    const overdrive = this.card.atk > 0 ? this.lane.board.overdrive : 0;
    return Math.max(0, this.card.atk + overdrive + this.scrapBonus + this.signalBoost + this.spearhead + this.attackBonus);
  }

  /** Vanguard (Speerspitze): Steht sie in der Command-Lane, hat das Kampfschiff im Strike-Slot direkt vor ihr mehr ATK. */
  get spearhead(): number {
    if (this.lane.type !== "strike" || this.card!.atk === 0) return 0;
    return this.lane.board.lane(this.lane.side, "command").slots[this.index]!.card?.id === "vanguard" ? ABILITY_VALUES.spearhead : 0;
  }

  /**
   * Signal Booster: +1 ATK je anderem Booster in derselben Lane. Ein im Kampf
   * tödlich getroffener Booster zählt noch, bis er im Cleanup das Brett verlässt.
   */
  get signalBoost(): number {
    return this.lane.occupiedSlots.filter((slot) => slot !== this && slot.card!.id === "signal_booster").length;
  }

  /** Support-Schiffe (Basis-ATK 0) greifen nie an, auch nicht mit Bonus. */
  get canAttack(): boolean {
    return this.card !== null && this.card.atk > 0 && this.attack > 0 && !this.disabled && !this.maneuvered && !this.isDestroyed;
  }

  place(card: ShipCard): void {
    this.clear();
    this.card = card;
    this.uid = this.lane.board.nextUid();
    this.hp = card.hp;
    this.shield = card.shield;
  }

  clear(): void {
    this.card = null;
    this.hp = 0;
    this.shield = 0;
    this.scrapBonus = 0;
    this.marked = false;
    this.attackBonus = 0;
    this.shieldBonus = 0;
    this.disabled = false;
    this.maneuvered = false;
    this.moved = false;
    this.selfDamageAfterCombat = 0;
    this.powers = NO_POWERS;
    this.arrived = false;
    this.taunting = false;
    this.locks = NO_LOCKS;
    this.aim = null;
    this.uid = 0;
  }

  /** Schaden geht erst auf den Schild, der Rest auf die HP. */
  damage(amount: number): void {
    const absorbed = Math.min(this.shield, amount);
    this.shield -= absorbed;
    this.shieldBonus = Math.min(this.shieldBonus, this.shield);
    this.hp -= amount - absorbed;
  }

  /** Heilt höchstens bis zur HP der Karte. */
  heal(amount: number): void {
    this.hp = Math.min(this.hp + amount, this.card!.hp);
  }

  addShield(amount: number): void {
    this.shield += amount;
    this.shieldBonus += amount;
  }

  /** Rundenmodifikatoren zurücksetzen; ein Bonus-Schild verfällt, soweit er noch steht. */
  endRound(): void {
    this.shield -= this.shieldBonus;
    this.attackBonus = 0;
    this.shieldBonus = 0;
    this.disabled = false;
    this.maneuvered = false;
    this.moved = false;
    this.selfDamageAfterCombat = 0;
    this.powers = NO_POWERS;
    this.arrived = false;
    this.taunting = false;
    this.locks = NO_LOCKS;
    this.aim = null;
  }

  /** Übernimmt Schiff samt Live-Zustand eines anderen Slots und leert diesen; das Schiff gilt als bewegt. */
  takeFrom(other: Slot): void {
    this.copy(other);
    this.moved = true;
    other.clear();
  }

  /** Phasentausch: Beide Schiffe tauschen die Plätze samt Live-Zustand; keins gilt dabei als bewegt. */
  swapWith(other: Slot): void {
    const ship = new Slot(this.lane, this.index);
    ship.copy(this);
    this.copy(other);
    other.copy(ship);
  }

  /** Schiff samt Live-Zustand eines anderen Slots. */
  copy(other: Slot): void {
    this.card = other.card;
    this.hp = other.hp;
    this.shield = other.shield;
    this.scrapBonus = other.scrapBonus;
    this.marked = other.marked;
    this.attackBonus = other.attackBonus;
    this.shieldBonus = other.shieldBonus;
    this.disabled = other.disabled;
    this.maneuvered = other.maneuvered;
    this.moved = other.moved;
    this.selfDamageAfterCombat = other.selfDamageAfterCombat;
    this.powers = other.powers;
    this.arrived = other.arrived;
    this.taunting = other.taunting;
    this.locks = other.locks;
    this.aim = other.aim;
    this.uid = other.uid;
  }

  get state(): SlotState | null {
    return this.card ? { cardId: this.card.id, hp: this.hp, shield: this.shield, scrapBonus: this.scrapBonus, marked: this.marked } : null;
  }

  set state(state: SlotState | null) {
    this.clear();
    if (state === null) return;
    this.card = shipById(state.cardId);
    this.uid = this.lane.board.nextUid();
    this.hp = state.hp;
    this.shield = state.shield;
    this.scrapBonus = state.scrapBonus;
    this.marked = state.marked;
  }
}

export class Lane {
  readonly slots: readonly Slot[];

  constructor(
    readonly board: Board,
    readonly side: Side,
    readonly type: LaneType,
  ) {
    this.slots = Array.from({ length: SLOT_COUNT }, (_, i) => new Slot(this, i));
  }

  get occupiedSlots(): Slot[] {
    return this.slots.filter((slot) => slot.isOccupied);
  }

  /** Schiffe der Lane für die Lane-Grenze (`MAX_SHIPS_PER_LANE`), auch eines im Kurzsprung; Tokens (Drohne, Trugbild) zählen nicht. */
  get shipCount(): number {
    const jumping = this.board.jumping.filter((ship) => ship.lane === this);
    return [...this.occupiedSlots, ...jumping].filter((slot) => !isToken(slot.card!)).length;
  }

  get isFull(): boolean {
    return this.shipCount >= MAX_SHIPS_PER_LANE;
  }

  /** Freier Slot für ein Schiff, das hierher wechselt: derselbe Index, sonst der nächstgelegene; ein Token braucht nur einen freien Slot. */
  freeSlotNear(index: number, token = false): Slot | null {
    if (this.isFull && !token) return null;
    return nearest(
      this.slots.filter((slot) => slot.isFree),
      index,
    );
  }
}

/** Slot mit dem kleinsten Indexabstand; bei Gleichstand gewinnt der niedrigere Index. */
export function nearest(slots: readonly Slot[], index: number): Slot | null {
  let best: Slot | null = null;
  for (const slot of slots) {
    if (best === null || Math.abs(slot.index - index) < Math.abs(best.index - index)) best = slot;
  }
  return best;
}

export class Board {
  readonly lanes: readonly Lane[] = [
    new Lane(this, "player", "command"),
    new Lane(this, "player", "strike"),
    new Lane(this, "enemy", "strike"),
    new Lane(this, "enemy", "command"),
  ];
  /** ATK-Bonus aller Kampfschiffe aus der Rundenzahl (`overdriveBonus`); gehört nicht in den Snapshot. */
  overdrive = 0;
  /** So viele Drohnen hat die Hive je Seite in diesem Match gestartet (`ABILITY_VALUES.hiveBudget`); gehört nicht in den Snapshot. */
  hiveLaunches: Record<Side, number> = { player: 0, enemy: 0 };
  /**
   * Kurzsprung: Schiffe, die in dieser Runde das Brett verlassen haben, je als abgelöster Slot samt Zustand; Lane und
   * Index nennen den Slot, in den es im Cleanup zurückkehrt und der bis dahin gesperrt ist (`Slot.isFree`). Zwischen den
   * Runden leer; gehört nicht in den Snapshot.
   */
  jumping: Slot[] = [];
  /** Zuletzt vergebene Schiffskennung (`Slot.uid`). */
  private lastUid = 0;

  /** Eine neue Kennung für ein Schiff, das aufs Brett kommt. */
  nextUid(): number {
    return ++this.lastUid;
  }

  lane(side: Side, type: LaneType): Lane {
    return this.lanes.find((lane) => lane.side === side && lane.type === type)!;
  }

  lanesFor(side: Side): Lane[] {
    return this.lanes.filter((lane) => lane.side === side);
  }

  /** Schiffe einer Seite, Strike vor Command, jeweils nach Slot-Index. */
  ships(side: Side): Slot[] {
    return [this.lane(side, "strike"), this.lane(side, "command")].flatMap((lane) => lane.occupiedSlots);
  }

  /** Das Flaggschiff der Seite; null vor Runde 1 und sobald es gefallen ist. */
  flagship(side: Side): Slot | null {
    return this.ships(side).find((slot) => isFlagship(slot.card!)) ?? null;
  }

  /**
   * Schutzregel: ein Command-Schiff ist gedeckt, solange im Strike-Slot davor ein Schiff steht. `seeThrough`: so
   * sehen es Flaggschiffe, die Trugbilder durchschauen; ein Trugbild davor deckt dann nicht.
   */
  isExposed(slot: Slot, seeThrough = false): boolean {
    if (slot.lane.type === "strike") return true;
    const front = this.lane(slot.lane.side, "strike").slots[slot.index]!;
    return !front.isOccupied || (seeThrough && front.card!.id === "decoy");
  }

  /** Schiffe einer Seite, die beschossen werden können, in `ships`-Reihenfolge; mit `seeThrough` ist ein Trugbild weder Ziel noch Deckung. */
  exposedShips(side: Side, seeThrough = false): Slot[] {
    return this.ships(side).filter((slot) => this.isExposed(slot, seeThrough) && !(seeThrough && slot.card!.id === "decoy"));
  }

  /** Schiffe einer Seite für die Flottengrenze (`MAX_SHIPS_PER_SIDE`); Tokens (Drohne, Trugbild) zählen nicht. */
  shipCount(side: Side): number {
    return this.ships(side).filter((slot) => !isToken(slot.card!)).length;
  }

  /**
   * Ob ein Schiff auf dem Slot landen kann. `arrivals` sind die übrigen Deploys derselben Seite in
   * dieser Runde: Ihre Slots gelten als besetzt, sie zählen zur Lane- und zur Flottengrenze.
   */
  canPlace(lane: Lane, slotIndex: number, arrivals: readonly SlotTarget[] = []): boolean {
    const slot = lane.slots[slotIndex];
    if (slot === undefined || slot.isOccupied) return false;
    const incoming = arrivals.filter((arrival) => arrival.lane === lane.type);
    if (incoming.some((arrival) => arrival.slotIndex === slotIndex)) return false;
    if (lane.shipCount + incoming.length >= MAX_SHIPS_PER_LANE) return false;
    return this.shipCount(lane.side) + arrivals.length < MAX_SHIPS_PER_SIDE;
  }

  /**
   * Ob das Schiff in `from` in den freien Slot `to` seiner Seite wechseln kann, in der anderen oder
   * derselben Lane. `deploys` sind die Slots, auf denen dieselbe Seite in dieser Runde Schiffe legt (sie
   * landen vor allen Bewegungen), `other` ist ihre zweite Bewegung (Grundmanöver bzw. Bewegungsbefehl;
   * ein Phasentausch ändert die Schiffszahl keiner Lane und gehört nicht hierher). Ihre Slots gelten
   * als besetzt. Zur Lane-Grenze zählen die Deploys und die zweite Bewegung, wenn sie ein Schiff aus der
   * anderen Lane bringt. Bewusst streng: Ein Schiff, das sich bewegt, gibt seinen Slot und seinen Platz
   * in der Lane für die anderen Bewegungen dieser Runde nicht frei. Eine Bewegung innerhalb der Lane
   * ändert deren Schiffszahl nicht. Eine Drohne zählt nicht zur Lane-Grenze und braucht nur einen
   * freien Slot.
   */
  canMove(from: Slot, to: SlotTarget, deploys: readonly SlotTarget[] = [], other: PlannedMove | null = null): boolean {
    const lane = this.lane(from.lane.side, to.lane);
    const slot = lane.slots[to.slotIndex];
    if (slot === undefined || slot.isOccupied || slot === other?.to) return false;
    const incoming = deploys.filter((deploy) => deploy.lane === lane.type);
    if (incoming.some((deploy) => deploy.slotIndex === to.slotIndex)) return false;
    // `from` ist noch leer, wenn das Schiff erst in dieser Runde landet.
    if (from.card && isToken(from.card)) return true;
    const joining = other && joins(other, lane) ? 1 : 0;
    const staying = lane === from.lane ? 1 : 0;
    return lane.shipCount + incoming.length + joining - staying < MAX_SHIPS_PER_LANE;
  }

  /** Slots der anderen Lane, in die das Schiff in `from` per Bewegungsbefehl wechseln kann (siehe `canMove`). */
  laneSwitchDestinations(from: Slot, deploys: readonly SlotTarget[] = [], other: PlannedMove | null = null): Slot[] {
    const lane = this.lane(from.lane.side, otherLane(from.lane.type));
    return lane.slots.filter((slot) => this.canMove(from, slotTarget(slot), deploys, other));
  }

  /** Slots beider eigenen Lanes, in die das Schiff in `from` per Grundmanöver wechseln kann (siehe `canMove`). */
  maneuverDestinations(from: Slot, deploys: readonly SlotTarget[] = [], other: PlannedMove | null = null): Slot[] {
    return this.lanesFor(from.lane.side)
      .flatMap((lane) => lane.slots)
      .filter((slot) => this.canMove(from, slotTarget(slot), deploys, other));
  }

  /** Platziert ein Schiff; gibt den Slot zurück oder null bei Regelverstoß. */
  place(lane: Lane, slotIndex: number, card: ShipCard): Slot | null {
    if (!this.canPlace(lane, slotIndex)) return null;
    const slot = lane.slots[slotIndex]!;
    slot.place(card);
    return slot;
  }

  snapshot(): BoardSnapshot {
    const lanesOf = (side: Side) => ({
      strike: this.lane(side, "strike").slots.map((slot) => slot.state),
      command: this.lane(side, "command").slots.map((slot) => slot.state),
    });
    return { player: lanesOf("player"), enemy: lanesOf("enemy") };
  }

  load(snapshot: BoardSnapshot): void {
    for (const lane of this.lanes) {
      for (const slot of lane.slots) slot.state = snapshot[lane.side][lane.type][slot.index] ?? null;
    }
  }
}
