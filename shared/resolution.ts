// Die Auflösung einer Runde: Deploy samt Fähigkeiten, Manöver, Effects, Combat, Cleanup. Portiert aus
// game_mechanics.gd. Der Server löst damit die aufgedeckten Züge auf (`Match.resolveRound`), der Client
// rechnet mit denselben Regeln die Zielvorschau beim Planen (`client/src/game/preview.ts`). Jede Phase
// arbeitet auf dem Brett aus Sicht von Seat 0 und hängt ihre Ereignisse an `events` an.

import { isSameSlot, nearest, opposite, otherLane, slotTarget, type Board, type Side, type Slot } from "./board.ts";
import { COMMAND_ORDER, shipById, targetsEnemySlot, type CommandCard, type ShipCard } from "./cards.ts";
import type { CommandEffect, RoundEvent, ShipRef, ShipStats, SlotTarget, TurnPlan } from "./protocol.ts";

const SIDES: readonly Side[] = ["player", "enemy"];

export interface Commander {
  readonly side: Side;
  /** Scavenge: zieht 1 Schiff + 1 Befehl zusätzlich; zählt, was auf der Hand gelandet ist. */
  drawExtra(): { ships: number; commands: number };
}

export interface PlayedCommand {
  commander: Commander;
  card: CommandCard;
  /** Das eigene Zielschiff, beim Torpedo der gewählte Slot der Gegnerseite (auch leer). */
  target: Slot | null;
  /** Bei Befehlen, die ihr Ziel verlegen: der freie Slot in der anderen Lane, geprüft beim Submit. */
  destination: Slot | null;
}

/**
 * Der aufgedeckte Zug einer Seite: wie `TurnPlan`, aber mit den Karten statt ihrer Hand-Indizes. Er ist
 * geprüft (`Match.validate`); eigene Ziele beziehen sich auf die Stellung vor dem Manöver.
 */
export interface Turn {
  commander: Commander;
  ships: { card: ShipCard; target: SlotTarget }[];
  command: { card: CommandCard; target: SlotTarget | null; destination: number | null } | null;
  maneuver: TurnPlan["maneuver"];
}

export function shipRef(slot: Slot): ShipRef {
  return { side: slot.lane.side, lane: slot.lane.type, slotIndex: slot.index, cardId: slot.card!.id };
}

function stats(slot: Slot): ShipStats {
  return { hp: slot.hp, shield: slot.shield };
}

/** Element mit dem höchsten Wert; bei Gleichstand das erste (bei Schiffen: in `board.ships`-Reihenfolge). */
export function highest<T>(items: readonly T[], value: (item: T) => number): T | null {
  let best: T | null = null;
  for (const item of items) {
    if (best === null || value(item) > value(best)) best = item;
  }
  return best;
}

// --- Runde ---

/**
 * Löst eine Runde mit den Zügen beider Seiten auf und gibt ihre Ereignisse zurück: Deploy samt Fähigkeiten,
 * Manöver, Effects, Combat, Cleanup. `random` liefert Zahlen in [0, 1); ohne ihn (Zielvorschau) feuern
 * Plasma Frigates beim Deploy nicht, weil ihr Ziel Zufall ist.
 */
export function resolveTurns(board: Board, turns: readonly Turn[], random: (() => number) | null): RoundEvent[] {
  const events: RoundEvent[] = [];
  const deployed: Slot[] = [];
  for (const { commander, ships } of turns) {
    for (const { card, target } of ships) {
      deployed.push(board.place(board.lane(commander.side, target.lane), target.slotIndex, card)!);
      events.push({ kind: "deploy", side: commander.side, cardId: card.id, target });
    }
    if (ships.length === 0) events.push({ kind: "pass", side: commander.side });
  }
  resolveDeployAbilities(board, deployed, turns.flatMap((turn) => moveDestinations(board, turn)), random, events);

  // Jede Seite bewegt nur eigene Schiffe, die Manöver kommen sich also nicht in die Quere.
  // Ein Schiff, das schon beim Deploy gefallen ist, bewegt sich nicht mehr.
  for (const { commander, maneuver } of turns) {
    const from = maneuver && ownSlot(board, commander.side, maneuver.ship);
    if (from?.isOccupied) resolveManeuver(from, ownSlot(board, commander.side, maneuver!.destination), events);
  }

  const commands = turns.filter((turn) => turn.command !== null).map((turn) => revealCommand(board, turn, events));
  resolveEffects(board, commands, events);
  resolveCombat(board, events);
  resolveCleanup(board, events);
  return events;
}

function ownSlot(board: Board, side: Side, { lane, slotIndex }: SlotTarget): Slot {
  return board.lane(side, lane).slots[slotIndex]!;
}

/** Die Ziel-Slots der Bewegungen im Zug: Grundmanöver und Bewegungsbefehl (der nie das manövrierte Schiff verlegt). */
function moveDestinations(board: Board, { commander, maneuver, command }: Turn): Slot[] {
  const moved = command?.target && command.destination !== null ? { lane: otherLane(command.target.lane), slotIndex: command.destination } : null;
  return [maneuver?.destination, moved].filter((target) => target != null).map((target) => ownSlot(board, commander.side, target));
}

/** Deckt den Befehl auf: Ein eigenes Ziel folgt dem Manöver, ein Slot der Gegnerseite (Torpedo) bleibt stehen. */
function revealCommand(board: Board, { commander, command, maneuver }: Turn, events: RoundEvent[]): PlayedCommand {
  const { card, destination } = command!;
  const side = targetsEnemySlot(card) ? opposite(commander.side) : commander.side;
  const target = command!.target && (side === commander.side ? afterManeuver(maneuver, command!.target) : command!.target);
  events.push({ kind: "command", side: commander.side, cardId: card.id, target: target && { side, ...target } });
  return {
    commander,
    card,
    target: target && board.lane(side, target.lane).slots[target.slotIndex]!,
    destination: target && destination !== null ? board.lane(side, otherLane(target.lane)).slots[destination]! : null,
  };
}

/** Wo ein eigenes Befehlsziel nach dem Manöver steht: Zielt der Befehl auf das manövrierte Schiff, folgt er ihm. */
function afterManeuver(maneuver: Turn["maneuver"], target: SlotTarget): SlotTarget {
  return maneuver && isSameSlot(target, maneuver.ship) ? maneuver.destination : target;
}

// --- Deploy ---

/**
 * Fähigkeiten beim Deploy, sobald beide Seiten gelegt haben (`deployed`, in Deploy-Reihenfolge): Erst
 * startet die Drohne jedes Titan Carriers in den freien Slot seiner Lane, der ihm am nächsten liegt.
 * `reserved` sind die Ziel-Slots der Bewegungen dieser Runde (Grundmanöver, Bewegungsbefehl): Die Drohne
 * meidet sie, die Bewegungen bleiben also gültig. Zu Lane- und Flottengrenze zählt sie nicht; nur wenn
 * kein Slot der Lane frei ist, gibt es keine Drohne. Dann schießt jede Plasma Frigate 3 Schaden
 * auf ein zufälliges gegnerisches Schiff der gleichnamigen Lane, gedeckt oder nicht, auch auf eine frische Drohne.
 * `random` liefert Zahlen in [0, 1); ohne ihn (Zielvorschau) feuern die Plasma Frigates nicht.
 */
export function resolveDeployAbilities(
  board: Board,
  deployed: readonly Slot[],
  reserved: readonly Slot[],
  random: (() => number) | null,
  events: RoundEvent[],
): void {
  for (const carrier of deployed.filter((slot) => slot.card!.id === "titan_carrier")) {
    const slot = nearest(carrier.lane.slots.filter((slot) => !slot.isOccupied && !reserved.includes(slot)), carrier.index);
    if (slot === null) continue;
    slot.place(shipById("drone"));
    events.push({ kind: "spawn", source: shipRef(carrier), ship: shipRef(slot) });
  }
  if (random === null) return;
  for (const frigate of deployed.filter((slot) => slot.card!.id === "plasma_frigate")) {
    const targets = board.lane(opposite(frigate.lane.side), frigate.lane.type).occupiedSlots.filter((slot) => !slot.isDestroyed);
    if (targets.length === 0) continue;
    const target = targets[Math.floor(random() * targets.length)]!;
    const ship = shipRef(target);
    target.damage(3);
    events.push({ kind: "ability", source: shipRef(frigate), ship, effect: { type: "damage", amount: 3 }, after: stats(target) });
  }
  removeDestroyed(board, events);
}

// --- Manöver ---

/** Grundmanöver: Das Schiff wechselt in einen freien Slot, in der anderen oder derselben Lane, und feuert dafür in dieser Runde nicht. */
export function resolveManeuver(from: Slot, to: Slot, events: RoundEvent[]): void {
  const ship = shipRef(from);
  to.takeFrom(from);
  to.maneuvered = true;
  events.push({ kind: "maneuver", side: ship.side, ship, to: slotTarget(to) });
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
function applyCommand(board: Board, { commander, card, target, destination }: PlayedCommand, events: RoundEvent[]): boolean {
  // Das eigene Ziel kann schon vor den Befehlen gefallen sein, durch den Schuss einer Plasma Frigate.
  if (target && !target.isOccupied && !targetsEnemySlot(card)) return false;
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
  /**
   * Verlegt das Ziel in den gewählten Slot. Positionen ändern sich nur durch eigene Manöver und Befehle,
   * und die Zugprüfung hält ihre Ziel-Slots auseinander; er ist also noch frei.
   */
  const moveTarget = (): Slot => {
    const from = shipRef(target!);
    destination!.takeFrom(target!);
    affect(from, { type: "move", to: slotTarget(destination!) }, destination!);
    return destination!;
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
    case "torpedo":
      // Trifft, wer nach allen Bewegungen im Slot steht, gedeckt oder nicht; sonst verpufft er sichtbar.
      if (!target!.isOccupied) {
        events.push({ kind: "miss", side, cardId: card.id, target: { side: target!.lane.side, ...slotTarget(target!) } });
        return true;
      }
      return affectOne(target, (slot) => {
        slot.damage(5);
        return { type: "damage", amount: 5 };
      });
    case "barrage":
      // Debuffs wirken nach allen Bewegungen; Deckung spielt keine Rolle.
      return affectAll(enemyShips.filter((slot) => slot.moved), (slot) => {
        slot.damage(3);
        return { type: "damage", amount: 3 };
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
      moveTarget();
      return true;
    case "intercept": {
      const ship = moveTarget();
      ship.attackBonus += 2;
      affect(shipRef(ship), { type: "attack", delta: 2 }, ship);
      return true;
    }
    case "recall": {
      const ship = moveTarget();
      ship.heal(2);
      affect(shipRef(ship), { type: "heal", amount: 2 }, ship);
      return true;
    }
    case "scavenge":
      events.push({ kind: "draw", side, cardId: card.id, ...commander.drawExtra() });
      return true;
  }
}

// --- Combat ---

/**
 * Zielwahl nach Schiffsklasse (Gleichstand: niedrigerer Slot-Index): Jäger das
 * niedrigste HP, Schlachtschiff das höchste ATK, Kreuzer das gegenüberliegende
 * Schiff, sonst das nächstgelegene. Support greift nie an.
 */
function chooseTarget(attacker: Slot, ships: readonly Slot[]): Slot | null {
  switch (attacker.card!.shipClass) {
    case "fighter":
      return highest(ships, (slot) => -slot.hp);
    case "battleship":
      return highest(ships, (slot) => slot.attack);
    default:
      return nearest(ships, attacker.index);
  }
}

/**
 * Beide Seiten feuern gleichzeitig: Wer zu Kampfbeginn schießen kann (`Slot.canAttack`,
 * also weder per EMP gelähmt noch manövriert), schießt, auch wenn er im selben Kampf zerstört wird. Ziel sind nur ungedeckte Schiffe
 * (`Board.exposedShips`); die Deckung gilt für die ganze Runde, auch wenn das
 * deckende Schiff im selben Kampf zerstört wird. Innerhalb einer Seite zielen
 * die Schiffe nacheinander in Slot-Reihenfolge und überspringen Ziele, die ein
 * eigener Schuss schon zerstört hat; so verpufft kein Schuss. Bleibt kein Ziel,
 * verfallen die übrigen Schüsse dieser Seite. Die Seiten beeinflussen sich dabei
 * nicht, weil jede nur die Schiffe der anderen trifft. Gemeldet werden die
 * Schüsse abwechselnd, damit die Animation hin und her geht.
 */
export function resolveCombat(board: Board, events: RoundEvent[]): void {
  const attackersBySide = SIDES.map((side) => board.ships(side).filter((attacker) => attacker.canAttack));
  const shotsBySide = attackersBySide.map((attackers, index) => {
    const targets = board.exposedShips(opposite(SIDES[index]!));
    const shots: RoundEvent[] = [];
    for (const attacker of attackers) {
      const target = chooseTarget(attacker, targets.filter((slot) => !slot.isDestroyed));
      if (target === null) break;
      target.damage(attacker.attack);
      shots.push({
        kind: "attack",
        attacker: shipRef(attacker),
        target: shipRef(target),
        amount: attacker.attack,
        after: stats(target),
      });
    }
    return shots;
  });
  events.push(...interleave(shotsBySide));
}

/** Reißverschluss: abwechselnd ein Element aus jeder Liste, bis alle leer sind. */
function interleave<T>(lists: readonly (readonly T[])[]): T[] {
  const result: T[] = [];
  const length = Math.max(0, ...lists.map((list) => list.length));
  for (let index = 0; index < length; index++) {
    for (const list of lists) {
      if (index < list.length) result.push(list[index]!);
    }
  }
  return result;
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
  resolveRepairs(board, events);
  for (const lane of board.lanes) {
    for (const slot of lane.slots) slot.endRound();
  }
}

/**
 * Repair Drone: Jede überlebende Drohne heilt am Rundenende 2 HP beim beschädigten
 * eigenen Kampfschiff mit den wenigsten HP. Support-Schiffe heilt sie nicht, sonst
 * halten sich Drohnen in der Strike-Lane gegenseitig am Leben. Mehrere Drohnen
 * wirken nacheinander und wählen jeweils neu.
 */
function resolveRepairs(board: Board, events: RoundEvent[]): void {
  for (const side of SIDES) {
    const ships = board.ships(side);
    for (const drone of ships.filter((slot) => slot.card!.id === "repair_drone")) {
      const damaged = ships.filter((slot) => slot.card!.atk > 0 && slot.hp < slot.card!.hp);
      const target = highest(damaged, (slot) => -slot.hp);
      if (target === null) continue;
      target.heal(2);
      events.push({ kind: "ability", source: shipRef(drone), ship: shipRef(target), effect: { type: "heal", amount: 2 }, after: stats(target) });
    }
  }
}

/**
 * Entfernt die zerstörten Schiffe. Jeder überlebende Scrap Raider bekommt dauerhaft +1 ATK für jedes
 * davon, das auf der Gegenseite in der gleichnamigen Lane stand, egal wodurch es fiel.
 */
function removeDestroyed(board: Board, events: RoundEvent[]): void {
  const destroyed = SIDES.flatMap((side) => board.ships(side)).filter((slot) => slot.isDestroyed);
  for (const slot of destroyed) events.push({ kind: "destroyed", ship: shipRef(slot) });
  for (const raider of SIDES.flatMap((side) => board.ships(side))) {
    if (raider.card!.id !== "scrap_raider" || raider.isDestroyed) continue;
    const kills = destroyed.filter((slot) => slot.lane.side !== raider.lane.side && slot.lane.type === raider.lane.type).length;
    if (kills === 0) continue;
    raider.scrapBonus += kills;
    const ship = shipRef(raider);
    events.push({ kind: "ability", source: ship, ship, effect: { type: "attack", delta: kills }, after: stats(raider) });
  }
  for (const slot of destroyed) slot.clear();
}
