// Kartendefinitionen, portiert aus den Godot-Ressourcen (data/cards/*.tres).
// Von Client und Server gemeinsam genutzt; Karten werden über ihre id übertragen.
// Namen und Effekttexte sind Übersetzungen und liegen im Client (`client/src/i18n/`).

import type { LaneType } from "./board.ts";

export type ShipClass = "fighter" | "cruiser" | "battleship" | "support";
export type CommandType = "attack" | "buff" | "debuff" | "tactic" | "reposition" | "special";
export type TargetMode =
  | "none"
  | "auto_highest_hp"
  | "auto_lowest_hp"
  | "auto_highest_atk"
  | "auto_all"
  | "all_friendly"
  | "all_friendly_strike"
  | "all_enemy_strike"
  | "all_enemy_command"
  | "auto_moved"
  | "auto_arrived"
  | "auto_unpaired"
  | "enemy_power"
  | "choose_friendly"
  | "choose_enemy"
  | "choose_enemy_slot"
  | "choose_enemy_column";

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
  /** Bei Zielwahl eines Schiffs: nie ein Flaggschiff (Rammkurs, Traktorstrahl). */
  notFlagship?: true;
  /** Bei Zielwahl eines eigenen Schiffs: nur Schiffe dieser Karte (Schrottverwertung). */
  targetShip?: keyof typeof SHIP_STATS;
  /** Verlegt das Zielschiff in einen frei gewählten Slot: der anderen Lane (`lane`) oder derselben (`within`, Ausweichmanöver). */
  moves?: "lane" | "within";
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

/**
 * Schiffe, die nicht im Deck liegen, sondern erst auf dem Brett entstehen: die Drohne (Titan Carrier, Hive)
 * und das Trugbild der Admiralsfähigkeit des Phantoms (steht eine Runde, greift nicht an, gibt Deckung).
 */
const TOKEN_STATS = {
  drone: { shipClass: "fighter", hp: 1, atk: 1, shield: 0 },
  decoy: { shipClass: "support", hp: 1, atk: 0, shield: 0 },
} satisfies Record<string, ShipStats>;

/** Flaggschiffe: liegen in keinem Deck; jeder Admiral bringt seins mit (`admirals.ts`) und legt es in Runde 1 zusätzlich. */
const FLAGSHIP_STATS = {
  bastion: { shipClass: "battleship", hp: 20, atk: 1, shield: 0 },
  vanguard: { shipClass: "cruiser", hp: 16, atk: 3, shield: 0 },
  hive: { shipClass: "battleship", hp: 18, atk: 1, shield: 0 },
  mirage: { shipClass: "fighter", hp: 21, atk: 3, shield: 0 },
  pendulum: { shipClass: "battleship", hp: 20, atk: 2, shield: 0 },
} satisfies Record<string, ShipStats>;

const COMMAND_STATS = {
  emergency_shields: { commandType: "buff", targetMode: "choose_friendly" },
  emp_blast: { commandType: "debuff", targetMode: "auto_highest_atk" },
  flanking_maneuver: { commandType: "tactic", targetMode: "choose_friendly", moves: "lane" },
  intercept: { commandType: "reposition", targetMode: "choose_friendly", targetLane: "command", moves: "lane" },
  orbital_strike: { commandType: "attack", targetMode: "auto_highest_hp" },
  overcharge: { commandType: "special", targetMode: "choose_friendly" },
  power_surge: { commandType: "buff", targetMode: "all_friendly_strike" },
  recall: { commandType: "reposition", targetMode: "choose_friendly", targetLane: "strike", moves: "lane" },
  scavenge: { commandType: "tactic", targetMode: "none" },
  targeting_jammer: { commandType: "debuff", targetMode: "all_enemy_strike" },
  volley_fire: { commandType: "attack", targetMode: "auto_all" },
  torpedo: { commandType: "attack", targetMode: "choose_enemy_slot" },
  barrage: { commandType: "debuff", targetMode: "auto_moved" },
  // Umgruppierung
  evasive_action: { commandType: "reposition", targetMode: "choose_friendly", moves: "within" },
  micro_jump: { commandType: "reposition", targetMode: "choose_friendly" },
  // Taktik
  rapid_deployment: { commandType: "tactic", targetMode: "none" },
  draw_fire: { commandType: "tactic", targetMode: "choose_friendly" },
  // Verstärkung
  shield_grid: { commandType: "buff", targetMode: "all_friendly" },
  ablative_armor: { commandType: "buff", targetMode: "choose_friendly" },
  covering_fire: { commandType: "buff", targetMode: "choose_friendly" },
  drone_squadron: { commandType: "buff", targetMode: "none" },
  // Spezial
  collision_course: { commandType: "special", targetMode: "choose_friendly", targetLane: "strike", notFlagship: true },
  countermeasures: { commandType: "special", targetMode: "none" },
  carte_blanche: { commandType: "special", targetMode: "none" },
  // Schwächung
  radio_silence: { commandType: "debuff", targetMode: "enemy_power" },
  minefield: { commandType: "debuff", targetMode: "auto_arrived" },
  tractor_beam: { commandType: "debuff", targetMode: "choose_enemy", notFlagship: true },
  // Angriff
  heat_seeker: { commandType: "attack", targetMode: "choose_enemy" },
  coup_de_grace: { commandType: "attack", targetMode: "auto_lowest_hp" },
  piercing_shot: { commandType: "attack", targetMode: "choose_enemy_column" },
  bombardment: { commandType: "attack", targetMode: "all_enemy_command" },
  crossfire: { commandType: "attack", targetMode: "auto_unpaired" },
  // Liegt in keinem Deck: kommt nur über den Nachschub, wenn ein eigener Scrap Raider Schrott geborgen hat (`deckCopies`).
  scrap_salvage: { commandType: "buff", targetMode: "choose_friendly", targetShip: "scrap_raider" },
} satisfies Record<string, CommandStats>;

export type ShipId = keyof typeof SHIP_STATS | keyof typeof TOKEN_STATS | keyof typeof FLAGSHIP_STATS;
export type CommandId = keyof typeof COMMAND_STATS;

/**
 * Befehle wirken gleichzeitig. Damit kein Spieler im Vorteil ist, laufen sie nach
 * Typ statt nach Spieler: erst Positionen, dann Verstärkung, dann Schwächung, zuletzt
 * Schaden. Zwei Befehle gleichen Typs betreffen nie dieselben Schiffe; nur Rammstöße treffen beide Seiten und wirken
 * deshalb gleichzeitig, und Funkstille entfernt nur die Marken der Gegenseite.
 */
export const COMMAND_ORDER: readonly CommandType[] = ["reposition", "tactic", "buff", "special", "debuff", "attack"];

export interface ShipCard extends ShipStats {
  kind: "ship";
  id: ShipId;
}

export interface CommandCard extends CommandStats {
  kind: "command";
  id: CommandId;
}

export type Card = ShipCard | CommandCard;

function shipCards(stats: Record<string, ShipStats>): ShipCard[] {
  return Object.entries(stats).map(([id, ship]) => ({ kind: "ship", id: id as ShipId, ...ship }));
}

/** Die Schiffe im Deck. */
export const SHIPS: readonly ShipCard[] = shipCards(SHIP_STATS);
/** Schiffe, die nur durch Fähigkeiten aufs Brett kommen (`TOKEN_STATS`). */
export const TOKENS: readonly ShipCard[] = shipCards(TOKEN_STATS);
/** Die Flaggschiffe der Admirale (`FLAGSHIP_STATS`). */
export const FLAGSHIPS: readonly ShipCard[] = shipCards(FLAGSHIP_STATS);

export const COMMANDS: readonly CommandCard[] = Object.entries(COMMAND_STATS).map(([id, stats]) => ({
  kind: "command",
  id: id as CommandId,
  ...stats,
}));

const SHIPS_BY_ID = new Map([...SHIPS, ...TOKENS, ...FLAGSHIPS].map((card) => [card.id, card]));
const COMMANDS_BY_ID = new Map(COMMANDS.map((card) => [card.id, card]));

export function shipById(id: ShipId): ShipCard {
  return SHIPS_BY_ID.get(id)!;
}

export function commandById(id: CommandId): CommandCard {
  return COMMANDS_BY_ID.get(id)!;
}

/**
 * Befehle mit Zielwahl: ein eigenes Schiff, ein gegnerisches Schiff (`targetsEnemyShip`) oder ein Slot der
 * Gegnerseite (`targetsEnemySlot`).
 */
export function needsTarget(card: CommandCard): boolean {
  return card.targetMode === "choose_friendly" || targetsEnemySide(card);
}

/** Ob das Ziel auf der Gegnerseite liegt: ein gegnerisches Schiff oder ein Slot der Gegnerseite. */
export function targetsEnemySide(card: CommandCard): boolean {
  return targetsEnemyShip(card) || targetsEnemySlot(card);
}

/**
 * Wärmesucher, Traktorstrahl: Ziel ist ein gegnerisches Schiff, das beim Planen auf dem Brett steht. Der Befehl
 * folgt ihm, wenn es sich in der Runde bewegt.
 */
export function targetsEnemyShip(card: CommandCard): boolean {
  return card.targetMode === "choose_enemy";
}

/**
 * Torpedo, Durchschlag: Ziel ist ein Slot der Gegnerseite, belegt oder leer; getroffen wird, wer nach allen
 * Bewegungen dort steht. Beim Durchschlag zählt nur die Slot-Nummer (`targetsEnemyColumn`).
 */
export function targetsEnemySlot(card: CommandCard): boolean {
  return card.targetMode === "choose_enemy_slot" || targetsEnemyColumn(card);
}

/** Durchschlag: Das Ziel ist eine Slot-Nummer der Gegnerseite, also ihr Strike- und ihr Command-Slot. */
export function targetsEnemyColumn(card: CommandCard): boolean {
  return card.targetMode === "choose_enemy_column";
}

/** Ob ein Ziel in dieser Lane für den Befehl gültig ist. */
export function canTargetLane(card: CommandCard, lane: LaneType): boolean {
  return needsTarget(card) && (card.targetLane === undefined || card.targetLane === lane);
}

/** Ob der Befehl dieses Schiff zum Ziel haben darf: Manche nie ein Flaggschiff (`notFlagship`), manche nur eine Karte (`targetShip`). */
export function canTargetShip(card: CommandCard, ship: ShipCard): boolean {
  return !(card.notFlagship && isFlagship(ship)) && (card.targetShip === undefined || card.targetShip === ship.id);
}

/** Die Lane, in die ein verlegender Befehl sein Ziel bringt: die andere (`moves: "lane"`) oder dieselbe (`moves: "within"`). */
export function destinationLane(card: CommandCard, from: LaneType): LaneType {
  if (card.moves === "within") return from;
  return from === "strike" ? "command" : "strike";
}

/** Schnellverlegung: Mit diesem Befehl darf in der Runde ein Schiff mehr gelegt werden (`maxDeploys`). */
export function extraDeploys(card: CommandCard | null): number {
  return card?.id === "rapid_deployment" ? 1 : 0;
}

/** Freie Hand: Mit diesem Befehl gibt es in der Runde das Grundmanöver und die Admiralsfähigkeit. */
export function allowsManeuverAndPower(card: CommandCard | null): boolean {
  return card?.id === "carte_blanche";
}

/** Ob das Schiff ein Token ist (`TOKEN_STATS`): Es liegt in keinem Deck und zählt weder zur Lane- noch zur Flottengrenze. */
export function isToken(card: Card): boolean {
  return card.id in TOKEN_STATS;
}

/** Ob das Schiff ein Flaggschiff ist (`FLAGSHIP_STATS`): Fällt es, hat seine Seite verloren. */
export function isFlagship(card: Card): boolean {
  return card.id in FLAGSHIP_STATS;
}

/**
 * Kopien je Karte im Nachziehstapel: jedes Schiff zweimal, die Konter Torpedo und Sperrfeuer auch, jeder andere Befehl
 * einmal; Tokens, Flaggschiffe und die Schrottverwertung nie.
 */
export function deckCopies(card: Card): number {
  if (isToken(card) || isFlagship(card) || card.id === "scrap_salvage") return 0;
  return card.kind === "ship" || card.id === "torpedo" || card.id === "barrage" ? 2 : 1;
}
