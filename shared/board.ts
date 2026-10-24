// Das Spielbrett: zwei Lanes pro Seite, Strike vorne, Command hinten.
// Kennt als einzige Stelle die Platzierungsregeln; die Slots tragen den
// Live-Zustand der Schiffe (HP, Schild, Rundenmodifikatoren). "player" ist immer die
// Seite des Betrachters; der Server spiegelt das Brett für den zweiten Spieler.

import { shipById, type ShipCard, type ShipId } from "./cards.ts";
import type { SlotTarget } from "./protocol.ts";

export type Side = "player" | "enemy";
export type LaneType = "strike" | "command";

export interface SlotState {
  cardId: ShipId;
  hp: number;
  shield: number;
}

/** Serialisierbarer Brettzustand, je Seite und Lane die Slots in Index-Reihenfolge. */
export type BoardSnapshot = Record<Side, Record<LaneType, (SlotState | null)[]>>;

export function opposite(side: Side): Side {
  return side === "player" ? "enemy" : "player";
}

export function otherLane(type: LaneType): LaneType {
  return type === "strike" ? "command" : "strike";
}

export const SLOT_COUNT = 6;
export const MAX_SHIPS_PER_LANE = 4;
export const MAX_SHIPS_PER_SIDE = 8;

export class Slot {
  card: ShipCard | null = null;
  hp = 0;
  shield = 0;

  // Nur für die laufende Runde, im Cleanup zurückgesetzt. Zwischen den Runden
  // sind sie immer neutral und gehören deshalb nicht in den Snapshot.
  attackBonus = 0;
  shieldBonus = 0;
  disabled = false;
  selfDamageAfterCombat = 0;

  constructor(
    readonly lane: Lane,
    readonly index: number,
  ) {}

  get isOccupied(): boolean {
    return this.card !== null;
  }

  get isDestroyed(): boolean {
    return this.isOccupied && this.hp <= 0;
  }

  get attack(): number {
    return this.card ? Math.max(0, this.card.atk + this.signalBoost + this.attackBonus) : 0;
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
    return this.card !== null && this.card.atk > 0 && this.attack > 0 && !this.disabled && !this.isDestroyed;
  }

  place(card: ShipCard): void {
    this.clear();
    this.card = card;
    this.hp = card.hp;
    this.shield = card.shield;
  }

  clear(): void {
    this.card = null;
    this.hp = 0;
    this.shield = 0;
    this.attackBonus = 0;
    this.shieldBonus = 0;
    this.disabled = false;
    this.selfDamageAfterCombat = 0;
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
    this.selfDamageAfterCombat = 0;
  }

  /** Übernimmt Schiff samt Live-Zustand eines anderen Slots und leert diesen. */
  takeFrom(other: Slot): void {
    this.card = other.card;
    this.hp = other.hp;
    this.shield = other.shield;
    this.attackBonus = other.attackBonus;
    this.shieldBonus = other.shieldBonus;
    this.disabled = other.disabled;
    this.selfDamageAfterCombat = other.selfDamageAfterCombat;
    other.clear();
  }

  get state(): SlotState | null {
    return this.card ? { cardId: this.card.id, hp: this.hp, shield: this.shield } : null;
  }

  set state(state: SlotState | null) {
    this.clear();
    if (state === null) return;
    this.card = shipById(state.cardId);
    this.hp = state.hp;
    this.shield = state.shield;
  }
}

export class Lane {
  readonly slots: readonly Slot[];

  constructor(
    readonly side: Side,
    readonly type: LaneType,
  ) {
    this.slots = Array.from({ length: SLOT_COUNT }, (_, i) => new Slot(this, i));
  }

  get occupiedSlots(): Slot[] {
    return this.slots.filter((slot) => slot.isOccupied);
  }

  get isFull(): boolean {
    return this.occupiedSlots.length >= MAX_SHIPS_PER_LANE;
  }

  /** Freier Slot für ein Schiff, das hierher wechselt: derselbe Index, sonst der nächstgelegene. */
  freeSlotNear(index: number): Slot | null {
    if (this.isFull) return null;
    return nearest(this.slots.filter((slot) => !slot.isOccupied), index);
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
    new Lane("player", "command"),
    new Lane("player", "strike"),
    new Lane("enemy", "strike"),
    new Lane("enemy", "command"),
  ];

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

  /** Schutzregel: ein Command-Schiff ist gedeckt, solange im Strike-Slot davor ein Schiff steht. */
  isExposed(slot: Slot): boolean {
    return slot.lane.type === "strike" || !this.lane(slot.lane.side, "strike").slots[slot.index]!.isOccupied;
  }

  /** Schiffe einer Seite, die beschossen werden können, in `ships`-Reihenfolge. */
  exposedShips(side: Side): Slot[] {
    return this.ships(side).filter((slot) => this.isExposed(slot));
  }

  shipCount(side: Side): number {
    return this.ships(side).length;
  }

  canPlace(lane: Lane, slotIndex: number): boolean {
    const slot = lane.slots[slotIndex];
    if (slot === undefined || slot.isOccupied || lane.isFull) return false;
    return this.shipCount(lane.side) < MAX_SHIPS_PER_SIDE;
  }

  /**
   * Ob das Schiff in `from` in den Slot `index` der anderen Lane wechseln kann. `deploy` ist das
   * Schiff, das dieselbe Seite in dieser Runde legt: Es landet vor den Befehlen und belegt seinen Slot.
   */
  canMove(from: Slot, index: number, deploy: SlotTarget | null = null): boolean {
    const lane = this.lane(from.lane.side, otherLane(from.lane.type));
    const slot = lane.slots[index];
    if (slot === undefined || slot.isOccupied) return false;
    const deploysHere = deploy?.lane === lane.type;
    if (deploysHere && deploy.slotIndex === index) return false;
    return lane.occupiedSlots.length + (deploysHere ? 1 : 0) < MAX_SHIPS_PER_LANE;
  }

  /** Slot-Indizes der anderen Lane, in die das Schiff in `from` wechseln kann (siehe `canMove`). */
  moveDestinations(from: Slot, deploy: SlotTarget | null = null): number[] {
    return from.lane.slots.map((slot) => slot.index).filter((index) => this.canMove(from, index, deploy));
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
