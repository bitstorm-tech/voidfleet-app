// Nachrichten zwischen Client und Server über die WebSocket-Verbindung `/ws`.
// Alles ist aus Sicht des Empfängers formuliert: "player" ist die eigene Seite,
// "enemy" die des Gegners. Karten werden über ihre id übertragen.

import type { BoardSnapshot, LaneType, Side } from "./board.ts";
import type { CommandId, ShipId } from "./cards.ts";

/** Ein Slot auf der eigenen Seite des Bretts. */
export interface SlotTarget {
  lane: LaneType;
  slotIndex: number;
}

/**
 * Der Zug einer Runde: bis zu 1 Schiff und 1 Befehl, jeweils per Hand-Index, dazu höchstens ein
 * Grundmanöver. Verlegt der Befehl sein Ziel, ist `destination` der Slot-Index in der anderen Lane,
 * sonst null. Das Manöver verlegt ein eigenes Schiff, das schon auf dem Brett steht, in den Slot
 * `destination` der anderen Lane; dafür feuert es in dieser Runde nicht. Ziele beziehen sich auf die
 * Stellung vor dem Manöver: Ein Befehl auf das manövrierte Schiff folgt ihm.
 */
export interface TurnPlan {
  ship: { handIndex: number; target: SlotTarget } | null;
  command: { handIndex: number; target: SlotTarget | null; destination: number | null } | null;
  maneuver: { ship: SlotTarget; destination: number } | null;
}

/** Ein Schiff an einer Stelle des Bretts; die Karte steht dabei, weil der Slot danach leer sein kann. */
export interface ShipRef {
  side: Side;
  lane: LaneType;
  slotIndex: number;
  cardId: ShipId;
}

export type MatchResult = "won" | "lost" | "draw";

export interface PlayerView {
  matchId: string;
  round: number;
  board: BoardSnapshot;
  shipHand: ShipId[];
  commandHand: CommandId[];
  shipDeckSize: number;
  commandDeckSize: number;
  /** Der abgegebene Zug dieser Runde; null, solange noch geplant wird. */
  submittedPlan: TurnPlan | null;
  opponent: { joined: boolean; submitted: boolean };
  /** Gesetzt, sobald das Match entschieden ist; danach gibt es keine Züge mehr. */
  result: MatchResult | null;
}

/** HP und Schild eines Schiffs nach einem Ereignis, damit der Client die Runde Schritt für Schritt zeigen kann. */
export interface ShipStats {
  hp: number;
  shield: number;
}

/** Was ein Befehl an einem Schiff bewirkt. */
export type CommandEffect =
  | { type: "damage"; amount: number }
  | { type: "attack"; delta: number }
  | { type: "shield"; amount: number }
  | { type: "disable" }
  | { type: "heal"; amount: number }
  | { type: "move"; to: SlotTarget };

/** Was eine Schiffs-Fähigkeit an einem Schiff bewirkt. */
export type AbilityEffect = Extract<CommandEffect, { type: "heal" }>;

/**
 * Was in einer Runde aufgedeckt und aufgelöst wurde, in Auflösungsreihenfolge.
 * Im Kampf feuern erst alle Schiffe (`attack`), dann wirkt der summierte Schaden (`hit`).
 */
export type RoundEvent =
  | { kind: "deploy"; side: Side; cardId: ShipId; target: SlotTarget }
  | { kind: "pass"; side: Side }
  /** Grundmanöver nach dem Deploy: `ship` ist die Stelle davor; das Schiff feuert in dieser Runde nicht. */
  | { kind: "maneuver"; side: Side; ship: ShipRef; to: SlotTarget }
  | { kind: "command"; side: Side; cardId: CommandId; target: SlotTarget | null }
  | { kind: "effect"; side: Side; cardId: CommandId; ship: ShipRef; effect: CommandEffect; after: ShipStats }
  | { kind: "draw"; side: Side; cardId: CommandId; ships: number; commands: number }
  | { kind: "noEffect"; side: Side; cardId: CommandId }
  /** Fähigkeit eines Schiffs (`source`) an einem anderen, bisher nur die Reparatur der Repair Drone im Cleanup. */
  | { kind: "ability"; source: ShipRef; ship: ShipRef; effect: AbilityEffect; after: ShipStats }
  | { kind: "attack"; attacker: ShipRef; target: ShipRef; amount: number; after: ShipStats }
  | { kind: "selfDamage"; ship: ShipRef; amount: number; after: ShipStats }
  | { kind: "destroyed"; ship: ShipRef };

/**
 * Die Verbindung selbst ist der Beitritt: `/ws?match=<id>&token=<token>`.
 * `addBot` setzt den Computergegner auf den freien Platz, statt auf einen Menschen zu warten.
 */
export type ClientMessage = { type: "submit"; plan: TurnPlan } | { type: "addBot" };

/** Fehler werden als Code übertragen, der Client formuliert sie in seiner Sprache. */
export type ErrorCode =
  | "match_full"
  | "match_over"
  | "opponent_missing"
  | "already_submitted"
  | "ship_not_in_hand"
  | "slot_unavailable"
  | "command_not_in_hand"
  | "target_required"
  | "target_not_allowed"
  | "target_not_own_ship"
  | "target_wrong_lane"
  | "destination_required"
  | "destination_not_allowed"
  | "destination_unavailable"
  | "maneuver_not_own_ship"
  | "maneuver_destination_unavailable"
  | "maneuver_conflict";

export type ServerMessage =
  | { type: "state"; view: PlayerView }
  | { type: "round"; round: number; events: RoundEvent[] }
  | { type: "error"; code: ErrorCode };
