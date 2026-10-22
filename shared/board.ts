// Das Spielbrett: zwei Lanes pro Seite, Strike vorne, Command hinten.
// Kennt als einzige Stelle die Platzierungsregeln. "player" ist immer die
// Seite des Betrachters; der Server spiegelt das Brett für den zweiten Spieler.

import { shipById, type ShipCard } from "./cards.ts";

export type Side = "player" | "enemy";
export type LaneType = "strike" | "command";

export interface SlotState {
  cardId: string;
  hp: number;
  shield: number;
}

/** Serialisierbarer Brettzustand, je Seite und Lane die Slots in Index-Reihenfolge. */
export type BoardSnapshot = Record<Side, Record<LaneType, (SlotState | null)[]>>;

export function opposite(side: Side): Side {
  return side === "player" ? "enemy" : "player";
}

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

  get state(): SlotState | null {
    return this.card ? { cardId: this.card.id, hp: this.hp, shield: this.shield } : null;
  }

  set state(state: SlotState | null) {
    if (state === null) {
      this.clear();
      return;
    }
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
