// Die Admirale: Zu Matchbeginn wählt jeder Spieler einen, beide wählen verdeckt. Jeder bringt sein
// Flaggschiff mit (eine Schiffskarte außerhalb der Decks mit eigener Fähigkeit, `cards.ts`), das er in
// Runde 1 zusätzlich zu seinen Schiffen legt, und hat eine Admiralsfähigkeit, die er jede Runde statt
// des Grundmanövers einsetzen darf. Wessen Flaggschiff fällt, hat verloren.
// Namen und Texte liegen im Client (`client/src/i18n/`).

import type { ShipId } from "./cards.ts";

export type AdmiralId = "osei" | "vance" | "halvorsen" | "moreau" | "kerr";
export type PowerId = "counterfire" | "focus_fire" | "swarm_strike" | "decoy" | "head_start";

/**
 * Wohin eine Admiralsfähigkeit zielt (`TurnPlan.power.target`, gültig zur Stellung beim Planen):
 * - `own_ship`: ein eigenes Schiff, auch eines, das in dieser Runde gelegt wird (Gegenfeuer)
 * - `own_combat_ship`: ebenso, aber nur ein Kampfschiff mit ATK > 0 (Taktvorsprung)
 * - `enemy_ship`: ein gegnerisches Schiff (Fokusfeuer; es wirkt nur, solange das Ziel im Kampf ungedeckt ist)
 * - `enemy_ship_not_flagship`: ein gegnerisches Schiff außer dem Flaggschiff, auch ein gedecktes (Schwarmangriff)
 * - `free_own_strike_slot`: ein freier eigener Strike-Slot, in dem in dieser Runde nichts anderes landet (Trugbild)
 * Die Marke einer Fähigkeit folgt ihrem Schiff, wenn es sich in der Runde bewegt.
 */
export type PowerTarget = "own_ship" | "own_combat_ship" | "enemy_ship" | "enemy_ship_not_flagship" | "free_own_strike_slot";

export interface Admiral {
  id: AdmiralId;
  flagship: ShipId;
  power: PowerId;
}

/**
 * Osei, die Mauer: Bastion (Wächterschild) und Gegenfeuer. Vance, der Hammer: Vanguard (Speerspitze) und
 * Fokusfeuer. Halvorsen, der Schwarm: Hive (Brutkammer) und Schwarmangriff. Moreau, das Phantom: Mirage
 * (Phasentausch) und Trugbild. Kerr, der Uhrmacher: Pendulum (Railgun) und Taktvorsprung.
 */
export const ADMIRALS: Record<AdmiralId, Admiral> = {
  osei: { id: "osei", flagship: "bastion", power: "counterfire" },
  vance: { id: "vance", flagship: "vanguard", power: "focus_fire" },
  halvorsen: { id: "halvorsen", flagship: "hive", power: "swarm_strike" },
  moreau: { id: "moreau", flagship: "mirage", power: "decoy" },
  kerr: { id: "kerr", flagship: "pendulum", power: "head_start" },
};

export const ADMIRAL_IDS = Object.keys(ADMIRALS) as AdmiralId[];

export const POWER_TARGETS: Record<PowerId, PowerTarget> = {
  counterfire: "own_ship",
  focus_fire: "enemy_ship",
  swarm_strike: "enemy_ship_not_flagship",
  decoy: "free_own_strike_slot",
  head_start: "own_combat_ship",
};

/** Ob die Fähigkeit ein Schiff der Gegenseite zum Ziel hat; sonst liegt ihr Ziel auf der eigenen Seite. */
export function targetsEnemy(power: PowerId): boolean {
  return POWER_TARGETS[power] === "enemy_ship" || POWER_TARGETS[power] === "enemy_ship_not_flagship";
}

/** Die Zahlen der Flaggschiff- und Admiralsfähigkeiten, abgestimmt per Bot-Simulation; der Regel-Dialog nennt sie. */
export const ABILITY_VALUES = {
  /** Bastion (Wächterschild): Schild für sie und das Schiff im Strike-Slot vor ihr, jede Runde. */
  guardianShield: 2,
  /** Vanguard (Speerspitze): ATK-Bonus des Kampfschiffs im Strike-Slot vor ihr. */
  spearhead: 1,
  /** Hive (Brutkammer): höchstens so viele Drohnen gleichzeitig auf ihrer Seite … */
  maxDrones: 2,
  /** … und so viele startet sie im ganzen Match (seit den neuen Befehlen 7 statt 10, sonst gewann Halvorsen 60 %). */
  hiveBudget: 7,
  /** Pendulum (Railgun): Schaden auf das markierte Schiff, wenn es zu Kampfbeginn ungedeckt ist. */
  railgun: 6,
  /** Gegenfeuer: Schaden je Treffer am Schützen (Flaggschiffe ausgenommen). */
  counterfire: 1,
  /** Fokusfeuer: zusätzlicher Schaden je Treffer auf das Ziel. */
  focusFire: 1,
  /** Schwarmangriff: zusätzlicher Schaden je Drohnentreffer auf das Ziel. */
  swarmStrike: 1,
} as const;
