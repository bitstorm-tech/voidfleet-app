// Die Auflösung einer Runde nach dem Deploy: Effects, Combat, Cleanup.
// Portiert aus game_mechanics.gd. Jede Phase arbeitet auf dem Brett aus Sicht
// von Seat 0 und hängt ihre Ereignisse an `events` an.

import { nearest, opposite, type Board, type Lane, type Side, type Slot } from "../../shared/board.ts";
import type { CommandCard, CommandType } from "../../shared/cards.ts";
import type { CommandEffect, RoundEvent, ShipRef, ShipStats } from "../../shared/protocol.ts";

const SIDES: readonly Side[] = ["player", "enemy"];

/**
 * Befehle wirken gleichzeitig. Damit kein Seat im Vorteil ist, laufen sie nach
 * Typ statt nach Seat: erst Positionen, dann Verstärkung, dann Schwächung, zuletzt
 * Schaden. Zwei Befehle gleichen Typs betreffen nie dieselben Schiffe.
 */
const COMMAND_ORDER: readonly CommandType[] = ["reposition", "tactic", "buff", "special", "debuff", "attack"];

export interface Commander {
  readonly side: Side;
  /** Scavenge: zieht 1 Schiff + 1 Befehl zusätzlich; zählt, was auf der Hand gelandet ist. */
  drawExtra(): { ships: number; commands: number };
}

export interface PlayedCommand {
  commander: Commander;
  card: CommandCard;
  target: Slot | null;
}

export function shipRef(slot: Slot): ShipRef {
  return { side: slot.lane.side, lane: slot.lane.type, slotIndex: slot.index, cardId: slot.card!.id };
}

function stats(slot: Slot): ShipStats {
  return { hp: slot.hp, shield: slot.shield };
}

/** Schiff mit dem höchsten Wert; bei Gleichstand das erste in `board.ships`-Reihenfolge. */
function highest(ships: readonly Slot[], value: (slot: Slot) => number): Slot | null {
  let best: Slot | null = null;
  for (const ship of ships) {
    if (best === null || value(ship) > value(best)) best = ship;
  }
  return best;
}

/** Wechselt in den nächstgelegenen freien Slot der Ziel-Lane; null, wenn sie voll ist. */
function move(slot: Slot, to: Lane): Slot | null {
  const destination = to.freeSlotNear(slot.index);
  destination?.takeFrom(slot);
  return destination;
}

// --- Effects ---

export function resolveEffects(board: Board, commands: readonly PlayedCommand[], events: RoundEvent[]): void {
  const ordered = [...commands].sort(
    (a, b) => COMMAND_ORDER.indexOf(a.card.commandType) - COMMAND_ORDER.indexOf(b.card.commandType),
  );
  for (const command of ordered) {
    if (!applyCommand(board, command, events)) {
      events.push({ kind: "noEffect", side: command.commander.side, cardId: command.card.id });
    }
  }
  removeDestroyed(board, events);
}

/** Wendet den Befehl an; false, wenn er nichts bewirkt hat. */
function applyCommand(board: Board, { commander, card, target }: PlayedCommand, events: RoundEvent[]): boolean {
  const side = commander.side;
  const enemyShips = board.ships(opposite(side));
  /** `ship` ist die Stelle vor dem Effekt, `after` gibt die Werte danach an. */
  const affect = (ship: ShipRef, effect: CommandEffect, after: Slot) => {
    events.push({ kind: "effect", side, cardId: card.id, ship, effect, after: stats(after) });
  };
  const affectAll = (ships: readonly Slot[], apply: (slot: Slot) => CommandEffect) => {
    for (const slot of ships) {
      const ship = shipRef(slot);
      affect(ship, apply(slot), slot);
    }
    return ships.length > 0;
  };
  const affectOne = (ship: Slot | null, apply: (slot: Slot) => CommandEffect) => affectAll(ship ? [ship] : [], apply);
  const moveTo = (slot: Slot, to: Lane): Slot | null => {
    const from = shipRef(slot);
    const destination = move(slot, to);
    if (destination) affect(from, { type: "move", to: { lane: to.type, slotIndex: destination.index } }, destination);
    return destination;
  };

  switch (card.id) {
    case "orbital_strike":
      return affectOne(highest(enemyShips, (slot) => slot.hp), (slot) => {
        slot.damage(4);
        return { type: "damage", amount: 4 };
      });
    case "volley_fire":
      return affectAll(enemyShips, (slot) => {
        slot.damage(1);
        return { type: "damage", amount: 1 };
      });
    case "power_surge":
      return affectAll(board.lane(side, "strike").occupiedSlots, (slot) => {
        slot.attackBonus += 1;
        return { type: "attack", delta: 1 };
      });
    case "targeting_jammer":
      return affectAll(board.lane(opposite(side), "strike").occupiedSlots, (slot) => {
        slot.attackBonus -= 1;
        return { type: "attack", delta: -1 };
      });
    case "emp_blast":
      return affectOne(highest(enemyShips, (slot) => slot.attack), (slot) => {
        slot.disabled = true;
        return { type: "disable" };
      });
    case "emergency_shields":
      return affectOne(target, (slot) => {
        slot.addShield(3);
        return { type: "shield", amount: 3 };
      });
    case "overcharge":
      return affectOne(target, (slot) => {
        slot.attackBonus += 3;
        slot.selfDamageAfterCombat = 2;
        return { type: "attack", delta: 3 };
      });
    case "flanking_maneuver":
      return moveTo(target!, board.lane(side, target!.lane.type === "strike" ? "command" : "strike")) !== null;
    case "intercept": {
      const ship = moveTo(target!, board.lane(side, "strike"));
      if (ship === null) return false;
      ship.attackBonus += 2;
      affect(shipRef(ship), { type: "attack", delta: 2 }, ship);
      return true;
    }
    case "recall": {
      const ship = moveTo(target!, board.lane(side, "command"));
      if (ship === null) return false;
      ship.heal(2);
      affect(shipRef(ship), { type: "heal", amount: 2 }, ship);
      return true;
    }
    case "scavenge":
      events.push({ kind: "draw", side, cardId: card.id, ...commander.drawExtra() });
      return true;
    case "sensor_sweep":
      // Braucht eine aufgedeckte Gegnerhand in der Sicht des Spielers; kommt später.
      return false;
  }
}

// --- Combat ---

/** Schutzregel: die Command-Lane ist erst Ziel, wenn die Strike-Lane leer ist. */
function targetLane(board: Board, side: Side): Lane | null {
  const strike = board.lane(side, "strike");
  if (strike.occupiedSlots.length > 0) return strike;
  const command = board.lane(side, "command");
  return command.occupiedSlots.length > 0 ? command : null;
}

/**
 * Zielwahl nach Schiffsklasse (Gleichstand: niedrigerer Slot-Index): Jäger das
 * niedrigste HP, Schlachtschiff das höchste ATK, Kreuzer das gegenüberliegende
 * Schiff, sonst das nächstgelegene. Support greift nie an.
 */
function chooseTarget(attacker: Slot, lane: Lane): Slot {
  const ships = lane.occupiedSlots;
  switch (attacker.card!.shipClass) {
    case "fighter":
      return highest(ships, (slot) => -slot.hp)!;
    case "battleship":
      return highest(ships, (slot) => slot.attack)!;
    default:
      return nearest(ships, attacker.index)!;
  }
}

/**
 * Alle Schiffe feuern gleichzeitig: erst alle Ziele wählen, dann den Schaden
 * Schuss für Schuss anwenden und jeden Schuss mit den Werten des Ziels danach melden.
 */
export function resolveCombat(board: Board, events: RoundEvent[]): void {
  const shots: [attacker: Slot, target: Slot][] = [];
  for (const side of SIDES) {
    const lane = targetLane(board, opposite(side));
    if (lane === null) continue;
    for (const attacker of board.ships(side)) {
      if (attacker.canAttack) shots.push([attacker, chooseTarget(attacker, lane)]);
    }
  }
  for (const [attacker, target] of shots) {
    target.damage(attacker.attack);
    events.push({
      kind: "attack",
      attacker: shipRef(attacker),
      target: shipRef(target),
      amount: attacker.attack,
      after: stats(target),
    });
  }
}

// --- Cleanup ---

export function resolveCleanup(board: Board, events: RoundEvent[]): void {
  for (const side of SIDES) {
    for (const slot of board.ships(side)) {
      if (slot.selfDamageAfterCombat === 0) continue;
      slot.damage(slot.selfDamageAfterCombat);
      events.push({ kind: "selfDamage", ship: shipRef(slot), amount: slot.selfDamageAfterCombat, after: stats(slot) });
    }
  }
  removeDestroyed(board, events);
  for (const lane of board.lanes) {
    for (const slot of lane.slots) slot.endRound();
  }
}

function removeDestroyed(board: Board, events: RoundEvent[]): void {
  for (const side of SIDES) {
    for (const slot of board.ships(side)) {
      if (!slot.isDestroyed) continue;
      events.push({ kind: "destroyed", ship: shipRef(slot) });
      slot.clear();
    }
  }
}
