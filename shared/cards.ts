// Kartendefinitionen, portiert aus den Godot-Ressourcen (data/cards/*.tres).
// Von Client und Server gemeinsam genutzt; Karten werden über ihre id übertragen.
// Namen und Effekttexte sind Übersetzungen und liegen im Client (`client/src/i18n/`).

import type { LaneType } from "./board.ts";

export type ShipClass = "fighter" | "cruiser" | "battleship" | "support";
export type CommandType = "attack" | "buff" | "debuff" | "tactic" | "reposition" | "special";
export type TargetMode =
  | "none"
  | "auto_highest_hp"
  | "auto_highest_atk"
  | "auto_all"
  | "all_friendly_strike"
  | "all_enemy_strike"
  | "auto_moved"
  | "choose_friendly"
  | "choose_enemy"
  | "choose_enemy_slot";

interface ShipStats {
  shipClass: ShipClass;
  hp: number;
  atk: number;
  shield: number;
}

interface CommandStats {
  commandType: CommandType;
  targetMode: TargetMode;
  /** Bei Zielwahl eines eigenen Schiffs: nur Schiffe dieser Lane sind gültige Ziele. */
  targetLane?: LaneType;
  /** Verlegt das Zielschiff in einen frei gewählten Slot der anderen Lane. */
  moves?: true;
}

const SHIP_STATS = {
  horizon_cruiser: { shipClass: "cruiser", hp: 8, atk: 2, shield: 0 },
  iron_dreadnought: { shipClass: "battleship", hp: 12, atk: 2, shield: 2 },
  plasma_frigate: { shipClass: "cruiser", hp: 6, atk: 3, shield: 0 },
  repair_drone: { shipClass: "support", hp: 5, atk: 0, shield: 0 },
  scrap_raider: { shipClass: "fighter", hp: 6, atk: 2, shield: 0 },
  signal_booster: { shipClass: "support", hp: 5, atk: 0, shield: 0 },
  titan_carrier: { shipClass: "battleship", hp: 11, atk: 1, shield: 0 },
  void_interceptor: { shipClass: "fighter", hp: 5, atk: 3, shield: 0 },
} satisfies Record<string, ShipStats>;

const COMMAND_STATS = {
  emergency_shields: { commandType: "buff", targetMode: "choose_friendly" },
  emp_blast: { commandType: "debuff", targetMode: "auto_highest_atk" },
  flanking_maneuver: { commandType: "tactic", targetMode: "choose_friendly", moves: true },
  intercept: { commandType: "reposition", targetMode: "choose_friendly", targetLane: "command", moves: true },
  orbital_strike: { commandType: "attack", targetMode: "auto_highest_hp" },
  overcharge: { commandType: "special", targetMode: "choose_friendly" },
  power_surge: { commandType: "buff", targetMode: "all_friendly_strike" },
  recall: { commandType: "reposition", targetMode: "choose_friendly", targetLane: "strike", moves: true },
  scavenge: { commandType: "tactic", targetMode: "none" },
  sensor_sweep: { commandType: "special", targetMode: "none" },
  targeting_jammer: { commandType: "debuff", targetMode: "all_enemy_strike" },
  volley_fire: { commandType: "attack", targetMode: "auto_all" },
  torpedo: { commandType: "attack", targetMode: "choose_enemy_slot" },
  barrage: { commandType: "debuff", targetMode: "auto_moved" },
} satisfies Record<string, CommandStats>;

export type ShipId = keyof typeof SHIP_STATS;
export type CommandId = keyof typeof COMMAND_STATS;

export interface ShipCard extends ShipStats {
  kind: "ship";
  id: ShipId;
}

export interface CommandCard extends CommandStats {
  kind: "command";
  id: CommandId;
}

export type Card = ShipCard | CommandCard;

export const SHIPS: readonly ShipCard[] = Object.entries(SHIP_STATS).map(([id, stats]) => ({
  kind: "ship",
  id: id as ShipId,
  ...stats,
}));

export const COMMANDS: readonly CommandCard[] = Object.entries(COMMAND_STATS).map(([id, stats]) => ({
  kind: "command",
  id: id as CommandId,
  ...stats,
}));

const SHIPS_BY_ID = new Map(SHIPS.map((card) => [card.id, card]));
const COMMANDS_BY_ID = new Map(COMMANDS.map((card) => [card.id, card]));

export function shipById(id: ShipId): ShipCard {
  return SHIPS_BY_ID.get(id)!;
}

export function commandById(id: CommandId): CommandCard {
  return COMMANDS_BY_ID.get(id)!;
}

/** Befehle mit Zielwahl: ein eigenes Schiff oder (`targetsEnemySlot`) ein Slot der Gegnerseite. */
export function needsTarget(card: CommandCard): boolean {
  return card.targetMode === "choose_friendly" || targetsEnemySlot(card);
}

/** Torpedo: Ziel ist ein Slot der Gegnerseite, belegt oder leer; getroffen wird, wer nach allen Bewegungen dort steht. */
export function targetsEnemySlot(card: CommandCard): boolean {
  return card.targetMode === "choose_enemy_slot";
}

/** Ob ein Ziel in dieser Lane für den Befehl gültig ist. */
export function canTargetLane(card: CommandCard, lane: LaneType): boolean {
  return needsTarget(card) && (card.targetLane === undefined || card.targetLane === lane);
}
