// Kartendefinitionen, portiert aus den Godot-Ressourcen (data/cards/*.tres).
// Von Client und Server gemeinsam genutzt; Karten werden über ihre id übertragen.

export type ShipClass = "fighter" | "cruiser" | "battleship" | "support";
export type CommandType = "attack" | "buff" | "debuff" | "tactic" | "reposition" | "special";
export type TargetMode =
  | "none"
  | "auto_highest_hp"
  | "auto_highest_atk"
  | "auto_all"
  | "all_friendly_strike"
  | "all_enemy_strike"
  | "choose_friendly"
  | "choose_enemy";

export interface ShipCard {
  kind: "ship";
  id: string;
  name: string;
  shipClass: ShipClass;
  hp: number;
  atk: number;
  shield: number;
  effectText: string;
}

export interface CommandCard {
  kind: "command";
  id: string;
  name: string;
  commandType: CommandType;
  targetMode: TargetMode;
  effectText: string;
}

export type Card = ShipCard | CommandCard;

const TARGET_LABELS: Record<TargetMode, string> = {
  none: "",
  auto_highest_hp: "Highest-HP Enemy",
  auto_highest_atk: "Highest-ATK Enemy",
  auto_all: "All Targets",
  all_friendly_strike: "All Allies",
  all_enemy_strike: "All Enemies",
  choose_friendly: "Choose Ally",
  choose_enemy: "Choose Enemy",
};

export function targetLabel(card: CommandCard): string {
  return TARGET_LABELS[card.targetMode];
}

export function needsTarget(card: CommandCard): boolean {
  return card.targetMode === "choose_friendly";
}

function ship(
  id: string,
  name: string,
  shipClass: ShipClass,
  hp: number,
  atk: number,
  shield: number,
  effectText: string,
): ShipCard {
  return { kind: "ship", id, name, shipClass, hp, atk, shield, effectText };
}

function command(
  id: string,
  name: string,
  commandType: CommandType,
  targetMode: TargetMode,
  effectText: string,
): CommandCard {
  return { kind: "command", id, name, commandType, targetMode, effectText };
}

export const SHIPS: readonly ShipCard[] = [
  ship("horizon_cruiser", "Horizon Cruiser", "cruiser", 5, 2, 0, "Solid stats, reliable."),
  ship("iron_dreadnought", "Iron Dreadnought", "battleship", 8, 2, 2, "Shield 2: Absorbs the first 2 damage each round."),
  ship("plasma_frigate", "Plasma Frigate", "cruiser", 4, 3, 0, "On Deploy: Deal 1 damage to a random enemy ship in the same lane."),
  ship("repair_drone", "Repair Drone", "support", 3, 0, 0, "Heals 2 HP to the allied ship with the lowest HP each round."),
  ship("scrap_raider", "Scrap Raider", "fighter", 4, 2, 0, "When an enemy ship in the same lane is destroyed: +1 ATK permanently."),
  ship("signal_booster", "Signal Booster", "support", 3, 0, 0, "On Deploy: All allied ships in the same lane gain +1 ATK permanently."),
  ship("titan_carrier", "Titan Carrier", "battleship", 7, 1, 0, "On Deploy: Spawn a Drone (1 HP, 1 ATK) in the same lane."),
  ship("void_interceptor", "Void Interceptor", "fighter", 3, 3, 0, "Pure damage, no tricks."),
];

export const COMMANDS: readonly CommandCard[] = [
  command("emergency_shields", "Emergency Shields", "buff", "choose_friendly", "Chosen allied ship gains Shield 3 this round."),
  command("emp_blast", "EMP Blast", "debuff", "auto_highest_atk", "The enemy ship with the highest ATK cannot attack this round."),
  command("flanking_maneuver", "Flanking Maneuver", "tactic", "choose_friendly", "Chosen allied ship switches lanes (Strike ↔ Command)."),
  command("intercept", "Intercept", "reposition", "choose_friendly", "Pull a chosen Command Line ship into the Strike Line. +2 ATK this round."),
  command("orbital_strike", "Orbital Strike", "attack", "auto_highest_hp", "Deal 4 damage to the enemy ship with the highest HP."),
  command("overcharge", "Overcharge", "special", "choose_friendly", "Chosen ship gets +3 ATK this round. Takes 2 self-damage after combat."),
  command("power_surge", "Power Surge", "buff", "all_friendly_strike", "All allied ships in the Strike Line gain +1 ATK this round."),
  command("recall", "Recall", "reposition", "choose_friendly", "A chosen Strike Line ship retreats to the Command Line. Heal 2 HP."),
  command("scavenge", "Scavenge", "tactic", "none", "Draw 2 additional cards."),
  command("sensor_sweep", "Sensor Sweep", "special", "none", "Reveal all cards in the enemy hand for the next round."),
  command("targeting_jammer", "Targeting Jammer", "debuff", "all_enemy_strike", "All enemy ships in the Strike Line get -1 ATK this round (min 0)."),
  command("volley_fire", "Volley Fire", "attack", "auto_all", "Deal 1 damage to ALL enemy ships."),
];

const SHIPS_BY_ID = new Map(SHIPS.map((card) => [card.id, card]));
const COMMANDS_BY_ID = new Map(COMMANDS.map((card) => [card.id, card]));

export function shipById(id: string): ShipCard {
  return SHIPS_BY_ID.get(id)!;
}

export function commandById(id: string): CommandCard {
  return COMMANDS_BY_ID.get(id)!;
}
