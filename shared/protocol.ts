// Nachrichten zwischen Client und Server über die WebSocket-Verbindung `/ws`.
// Alles ist aus Sicht des Empfängers formuliert: "player" ist die eigene Seite,
// "enemy" die des Gegners. Karten werden über ihre id übertragen.

import type { BoardSnapshot, LaneType, Side } from "./board.ts";

/** Ein Slot auf der eigenen Seite des Bretts. */
export interface SlotTarget {
  lane: LaneType;
  slotIndex: number;
}

/** Der Zug einer Runde: bis zu 1 Schiff und 1 Befehl, jeweils per Hand-Index. */
export interface TurnPlan {
  ship: { handIndex: number; target: SlotTarget } | null;
  command: { handIndex: number; target: SlotTarget | null } | null;
}

export interface PlayerView {
  matchId: string;
  round: number;
  board: BoardSnapshot;
  shipHand: string[];
  commandHand: string[];
  shipDeckSize: number;
  commandDeckSize: number;
  /** Der abgegebene Zug dieser Runde; null, solange noch geplant wird. */
  submittedPlan: TurnPlan | null;
  opponent: { joined: boolean; submitted: boolean };
}

/** Was in einer Runde aufgedeckt und aufgelöst wurde, in Auflösungsreihenfolge. */
export type RoundEvent =
  | { kind: "deploy"; side: Side; cardId: string; target: SlotTarget }
  | { kind: "pass"; side: Side }
  | { kind: "command"; side: Side; cardId: string; target: SlotTarget | null };

/** Die Verbindung selbst ist der Beitritt: `/ws?match=<id>&token=<token>`. */
export type ClientMessage = { type: "submit"; plan: TurnPlan };

export type ServerMessage =
  | { type: "state"; view: PlayerView }
  | { type: "round"; round: number; events: RoundEvent[] }
  | { type: "error"; message: string };
