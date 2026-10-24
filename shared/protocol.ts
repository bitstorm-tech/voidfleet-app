// Nachrichten zwischen Client und Server über die WebSocket-Verbindung `/ws`.
// Alles ist aus Sicht des Empfängers formuliert: "player" ist die eigene Seite,
// "enemy" die des Gegners. Karten werden über ihre id übertragen.

import type { BoardSnapshot, LaneType, Side } from "./board.ts";
import type { CommandId, ShipId } from "./cards.ts";

/** Ein Slot auf einer Seite des Bretts, die sich aus dem Zusammenhang ergibt. */
export interface SlotTarget {
  lane: LaneType;
  slotIndex: number;
}

/** Ein Slot samt Seite, wie ihn die Ereignisse melden. */
export interface SlotRef extends SlotTarget {
  side: Side;
}

/** Ein Schiff von der Hand, das auf einen eigenen Slot gelegt wird. */
export interface Deploy {
  handIndex: number;
  target: SlotTarget;
}

/**
 * Der Zug einer Runde: bis zu `maxDeploys` Schiffe (in Runde 1 zwei, sonst eines, in verschiedene
 * Slots) und 1 Befehl, jeweils per Hand-Index, dazu höchstens ein Grundmanöver. Ziele liegen auf der eigenen Seite, nur das Ziel eines Befehls mit `choose_enemy_slot`
 * (Torpedo) ist ein Slot der Gegnerseite, auch ein leerer. Verlegt der Befehl sein Ziel, ist `destination` der Slot-Index in der anderen Lane,
 * sonst null. Das Manöver verlegt ein eigenes Schiff, das schon auf dem Brett steht, in den freien Slot
 * `destination` der anderen oder derselben Lane; dafür feuert es in dieser Runde nicht. Eigene Ziele beziehen sich auf
 * die Stellung vor dem Manöver: Ein Befehl auf das manövrierte Schiff folgt ihm. Ein Slot der Gegnerseite
 * bleibt, was er ist: Getroffen wird, wer nach allen Bewegungen dort steht.
 */
export interface TurnPlan {
  ships: Deploy[];
  command: { handIndex: number; target: SlotTarget | null; destination: number | null } | null;
  maneuver: { ship: SlotTarget; destination: SlotTarget } | null;
}

/** Ein Schiff an einer Stelle des Bretts; die Karte steht dabei, weil der Slot danach leer sein kann. */
export interface ShipRef extends SlotRef {
  cardId: ShipId;
}

export type MatchResult = "won" | "lost" | "draw";

/** Was man vom Gegner weiß: ob er abgegeben hat, wie viele Karten er hält und welche Befehle er schon gespielt hat. */
export interface OpponentView {
  submitted: boolean;
  shipHandSize: number;
  commandHandSize: number;
  shipDeckSize: number;
  commandDeckSize: number;
  /** Seine aufgedeckten Befehle in der Reihenfolge, in der er sie gespielt hat. */
  playedCommands: CommandId[];
}

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
  /** Der Gegner, sobald er beigetreten ist. */
  opponent: OpponentView | null;
  /** Gesetzt, sobald das Match entschieden ist; danach gibt es keine Züge mehr. */
  result: MatchResult | null;
  /** Das Match endete, weil ein Spieler aufgegeben hat; wer, folgt aus `result`. */
  surrendered: boolean;
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
export type AbilityEffect = Extract<CommandEffect, { type: "heal" | "damage" | "attack" }>;

/**
 * Was in einer Runde aufgedeckt und aufgelöst wurde, in Auflösungsreihenfolge.
 * Im Kampf feuern erst alle Schiffe (`attack`), dann wirkt der summierte Schaden (`hit`).
 */
export type RoundEvent =
  | { kind: "deploy"; side: Side; cardId: ShipId; target: SlotTarget }
  | { kind: "pass"; side: Side }
  /** Grundmanöver nach dem Deploy: `ship` ist die Stelle davor; das Schiff feuert in dieser Runde nicht. */
  | { kind: "maneuver"; side: Side; ship: ShipRef; to: SlotTarget }
  /** `target` ist der Slot nach dem Manöver, beim Torpedo der gewählte Slot der Gegnerseite. */
  | { kind: "command"; side: Side; cardId: CommandId; target: SlotRef | null }
  | { kind: "effect"; side: Side; cardId: CommandId; ship: ShipRef; effect: CommandEffect; after: ShipStats }
  | { kind: "draw"; side: Side; cardId: CommandId; ships: number; commands: number }
  | { kind: "noEffect"; side: Side; cardId: CommandId }
  /** Torpedo in einen Slot, in dem nach allen Bewegungen kein Schiff steht. */
  | { kind: "miss"; side: Side; cardId: CommandId; target: SlotRef }
  /**
   * Fähigkeit eines Schiffs (`source`) an einem Schiff: der Schuss der Plasma Frigate beim Deploy (`damage`),
   * die Reparatur der Repair Drone im Cleanup (`heal`), der dauerhafte ATK-Bonus des Scrap Raiders an sich
   * selbst, sobald in seiner Lane Gegner zerstört wurden (`attack`, gleich nach den `destroyed`-Ereignissen).
   */
  | { kind: "ability"; source: ShipRef; ship: ShipRef; effect: AbilityEffect; after: ShipStats }
  /** Titan Carrier beim Deploy: Seine Drohne startet in den freien Slot `ship` derselben Lane. */
  | { kind: "spawn"; source: ShipRef; ship: ShipRef }
  | { kind: "attack"; attacker: ShipRef; target: ShipRef; amount: number; after: ShipStats }
  | { kind: "selfDamage"; ship: ShipRef; amount: number; after: ShipStats }
  | { kind: "destroyed"; ship: ShipRef };

/**
 * Die Verbindung selbst ist der Beitritt: `/ws?match=<id>&token=<token>`.
 * `addBot` setzt den Computergegner auf den freien Platz, statt auf einen Menschen zu warten.
 * `surrender` gibt das Match auf, jederzeit, auch nach abgegebenem Zug; der Gegner gewinnt sofort.
 */
export type ClientMessage = { type: "submit"; plan: TurnPlan } | { type: "addBot" } | { type: "surrender" };

/** Fehler werden als Code übertragen, der Client formuliert sie in seiner Sprache. */
export type ErrorCode =
  | "match_full"
  | "match_over"
  | "opponent_missing"
  | "already_submitted"
  | "ship_not_in_hand"
  | "too_many_ships"
  | "slot_unavailable"
  | "command_not_in_hand"
  | "target_required"
  | "target_not_allowed"
  | "target_not_own_ship"
  | "target_wrong_lane"
  | "target_not_enemy_slot"
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
