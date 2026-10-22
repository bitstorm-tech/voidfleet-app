// Das Spielbrett: zwei Lanes pro Seite, Strike vorne, Command hinten.
// Kennt als einzige Stelle die Platzierungsregeln.

import type { ShipCard } from "../data/cards.ts";

export type Side = "player" | "enemy";
export type LaneType = "strike" | "command";

export const SLOT_COUNT = 6;
export const MAX_SHIPS_PER_LANE = 4;
export const MAX_SHIPS_PER_SIDE = 8;

export class Slot {
  card: ShipCard | null = null;
  hp = 0;
  shield = 0;

  constructor(
    readonly lane: Lane,
    readonly index: number,
  ) {}

  get isOccupied(): boolean {
    return this.card !== null;
  }

  place(card: ShipCard): void {
    this.card = card;
    this.hp = card.hp;
    this.shield = card.shield;
  }

  clear(): void {
    this.card = null;
    this.hp = 0;
    this.shield = 0;
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

  get label(): string {
    return `${this.side === "player" ? "Spieler" : "Gegner"} ${this.type === "strike" ? "Strike" : "Command"}`;
  }
}

export class Board {
  readonly lanes: readonly Lane[] = [
    new Lane("player", "command"),
    new Lane("player", "strike"),
    new Lane("enemy", "strike"),
    new Lane("enemy", "command"),
  ];

  lanesFor(side: Side): Lane[] {
    return this.lanes.filter((lane) => lane.side === side);
  }

  shipCount(side: Side): number {
    return this.lanesFor(side).reduce((sum, lane) => sum + lane.occupiedSlots.length, 0);
  }

  canPlace(lane: Lane, slotIndex: number): boolean {
    const slot = lane.slots[slotIndex];
    if (slot === undefined || slot.isOccupied || lane.isFull) return false;
    return this.shipCount(lane.side) < MAX_SHIPS_PER_SIDE;
  }

  /** Platziert ein Schiff; gibt den Slot zurück oder null bei Regelverstoß. */
  place(lane: Lane, slotIndex: number, card: ShipCard): Slot | null {
    if (!this.canPlace(lane, slotIndex)) return null;
    const slot = lane.slots[slotIndex]!;
    slot.place(card);
    return slot;
  }
}
