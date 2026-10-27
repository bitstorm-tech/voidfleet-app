// Die Auflösung einer Runde: Deploy samt Fähigkeiten, Manöver, Effects, Combat, Cleanup. Portiert aus
// game_mechanics.gd. Der Server löst damit die aufgedeckten Züge auf (`Match.resolveRound`), der Client
// rechnet mit denselben Regeln die Zielvorschau beim Planen (`client/src/game/preview.ts`). Jede Phase
// arbeitet auf dem Brett aus Sicht von Seat 0 und hängt ihre Ereignisse an `events` an. Dazu kommen die
// Fähigkeiten der Flaggschiffe und Admirale (`admirals.ts`, Zahlen in `ABILITY_VALUES`).

import { ABILITY_VALUES, targetsEnemy, type PowerId } from "./admirals.ts";
import { isSameSlot, nearest, opposite, otherLane, Slot, SLOT_COUNT, slotTarget, type Board, type Side } from "./board.ts";
import {
  COMMAND_ORDER,
  destinationLane,
  isFlagship,
  isToken,
  shipById,
  targetsEnemyColumn,
  targetsEnemyShip,
  targetsEnemySide,
  targetsEnemySlot,
  type CommandCard,
  type ShipCard,
} from "./cards.ts";
import { railgunFires } from "./powers.ts";
import type { CommandEffect, RoundEvent, ShipRef, ShipStats, SlotRef, SlotTarget, TurnPlan } from "./protocol.ts";

const SIDES: readonly Side[] = ["player", "enemy"];

export interface Commander {
  readonly side: Side;
  /** Zieht zusätzlich (Plündern 1 + 1, Gegenmaßnahmen 0 + 1); zählt, was auf der Hand gelandet ist. */
  drawExtra(ships: number, commands: number): { ships: number; commands: number };
}

export interface PlayedCommand {
  commander: Commander;
  card: CommandCard;
  /**
   * Das eigene Zielschiff, beim Torpedo der gewählte Slot der Gegnerseite (auch leer), beim Durchschlag der Strike-Slot
   * der Slot-Nummer. Wärmesucher und Traktorstrahl suchen ihr Ziel beim Wirken über die Erfassung (`Slot.locks`).
   */
  target: Slot | null;
  /** Bei Befehlen, die ihr Ziel verlegen: der freie Slot der Ziel-Lane (`destinationLane`), geprüft beim Submit. */
  destination: Slot | null;
}

/**
 * Der aufgedeckte Zug einer Seite: wie `TurnPlan`, aber mit den Karten statt ihrer Hand-Indizes. Er ist
 * geprüft (`Match.validate`); eigene Ziele beziehen sich auf die Stellung vor dem Manöver.
 */
export interface Turn {
  commander: Commander;
  ships: { card: ShipCard; target: SlotTarget }[];
  /** Runde 1: das Flaggschiff des Admirals, das zusätzlich gelegt wird. */
  flagship: { card: ShipCard; target: SlotTarget } | null;
  command: { card: CommandCard; target: SlotTarget | null; destination: number | null } | null;
  maneuver: TurnPlan["maneuver"];
  /** Die Admiralsfähigkeit statt des Grundmanövers. */
  power: { id: PowerId; target: SlotTarget } | null;
  /** Pendulum: das markierte gegnerische Schiff (Slot beim Planen). */
  mark: SlotTarget | null;
}

export function shipRef(slot: Slot): ShipRef {
  return { side: slot.lane.side, lane: slot.lane.type, slotIndex: slot.index, cardId: slot.card!.id };
}

function stats(slot: Slot): ShipStats {
  return { hp: slot.hp, shield: slot.shield };
}

function slotRef(slot: Slot): SlotRef {
  return { side: slot.lane.side, ...slotTarget(slot) };
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
 * Löst eine Runde mit den Zügen beider Seiten auf und gibt ihre Ereignisse zurück: Deploy samt Flaggschiff,
 * Admiralsfähigkeiten, Erfassung durch Wärmesucher und Traktorstrahl (`Slot.locks`), Fähigkeiten beim Deploy,
 * Markierung der Pendulum, Manöver und Phasentausch,
 * Wächterschild, Effects, Combat, Cleanup, Brutkammer. `random` liefert Zahlen in [0, 1); ohne ihn
 * (Zielvorschau) feuern Plasma Frigates beim Deploy nicht, weil ihr Ziel Zufall ist.
 */
export function resolveTurns(board: Board, turns: readonly Turn[], random: (() => number) | null): RoundEvent[] {
  const events: RoundEvent[] = [];
  // Die Railgun feuert auf eine Markierung aus der Vorrunde; eine Markierung dieser Runde gilt erst in der nächsten.
  const railguns = SIDES.filter((side) => railgunFires(board, side));
  // Ein Phasentausch ist ein Manöver auf ein belegtes Feld; das steht vor den Deploys fest.
  const swaps = new Set(turns.filter(({ commander, maneuver }) => maneuver && ownSlot(board, commander.side, maneuver.destination).isOccupied).map(({ commander }) => commander.side));
  const deployed: Slot[] = [];
  for (const { commander, ships, flagship } of turns) {
    const arrivals = flagship ? [flagship, ...ships] : ships;
    for (const { card, target } of arrivals) {
      const slot = board.place(board.lane(commander.side, target.lane), target.slotIndex, card)!;
      slot.arrived = true;
      deployed.push(slot);
      events.push({ kind: "deploy", side: commander.side, cardId: card.id, target });
    }
    if (arrivals.length === 0) events.push({ kind: "pass", side: commander.side });
  }
  for (const { commander, power } of turns) {
    if (power) resolvePower(board, commander.side, power, events);
  }
  // Wärmesucher und Traktorstrahl erfassen ihr Schiff, bevor sich etwas bewegt; die Erfassung folgt ihm.
  for (const { commander, command } of turns) {
    if (!command?.target || !targetsEnemyShip(command.card)) continue;
    const slot = ownSlot(board, opposite(commander.side), command.target);
    if (slot.isOccupied) slot.locks = [...slot.locks, command.card.id];
  }
  resolveDeployAbilities(board, deployed, turns.flatMap((turn) => moveDestinations(board, turn)), random, events);
  for (const { commander, mark } of turns) {
    if (mark) resolveMark(board, commander.side, mark, events);
  }

  // Jede Seite bewegt nur eigene Schiffe, die Manöver kommen sich also nicht in die Quere.
  // Ein Schiff, das schon beim Deploy gefallen ist, bewegt sich nicht mehr; fiel beim Phasentausch der Partner,
  // bleibt die Mirage stehen und feuert. Ein Befehl auf ein eigenes Schiff bleibt dann auf seinem Slot.
  const swapped = new Set<Side>();
  const stayed = new Set<Side>();
  for (const { commander, maneuver } of turns) {
    if (!maneuver) continue;
    const from = ownSlot(board, commander.side, maneuver.ship);
    const to = ownSlot(board, commander.side, maneuver.destination);
    if (!from.isOccupied || (swaps.has(commander.side) && !to.isOccupied)) stayed.add(commander.side);
    else if (to.isOccupied) {
      resolveSwap(from, to, events);
      swapped.add(commander.side);
    } else resolveManeuver(from, to, events);
  }
  resolveGuardianShields(board, events);

  const commands = turns
    .filter((turn) => turn.command !== null)
    .map((turn) => revealCommand(board, stayed.has(turn.commander.side) ? { ...turn, maneuver: null } : turn, swapped.has(turn.commander.side), events));
  resolveEffects(board, commands, events);
  // Bewegt sich die Pendulum (auch per Kurzsprung), fällt ihr Schuss aus: in dieser Runde und, wenn sie gerade markiert hat, in der nächsten.
  const pendulums = [...SIDES.flatMap((side) => board.ships(side)), ...board.jumping].filter((slot) => slot.card!.id === "pendulum");
  const moved = SIDES.filter((side) => pendulums.some((slot) => slot.lane.side === side && slot.moved));
  resolveCombat(board, events, railguns.filter((side) => !moved.includes(side)));
  resolveCleanup(board, events);
  resolveBroodChamber(board, events);
  // Nach dem Schuss, auch einem ausgefallenen, ist die Markierung verbraucht.
  for (const side of SIDES.filter((side) => railguns.includes(side) || moved.includes(side))) {
    for (const slot of board.ships(opposite(side))) slot.marked = false;
  }
  return events;
}

function ownSlot(board: Board, side: Side, { lane, slotIndex }: SlotTarget): Slot {
  return board.lane(side, lane).slots[slotIndex]!;
}

/** Die Ziel-Slots der Bewegungen im Zug: Grundmanöver und Bewegungsbefehl (der nie das manövrierte Schiff verlegt). */
function moveDestinations(board: Board, { commander, maneuver, command }: Turn): Slot[] {
  const moved = command?.target && command.destination !== null ? { lane: destinationLane(command.card, command.target.lane), slotIndex: command.destination } : null;
  return [maneuver?.destination, moved].filter((target) => target != null).map((target) => ownSlot(board, commander.side, target));
}

/**
 * Deckt den Befehl auf: Ein eigenes Ziel folgt dem Manöver, ein Slot der Gegnerseite (Torpedo) bleibt stehen, der
 * Durchschlag meldet den Strike-Slot seiner Slot-Nummer, ein erfasstes Schiff (Wärmesucher, Traktorstrahl) seinen
 * Slot jetzt, null, wenn es nicht mehr auf dem Brett steht.
 */
function revealCommand(board: Board, { commander, command, maneuver }: Turn, swapped: boolean, events: RoundEvent[]): PlayedCommand {
  const { card, target, destination } = command!;
  const enemy = opposite(commander.side);
  let slot: Slot | null = null;
  if (target && targetsEnemyShip(card)) slot = locked(board, enemy, card);
  else if (target && targetsEnemyColumn(card)) slot = board.lane(enemy, "strike").slots[target.slotIndex]!;
  else if (target && targetsEnemySlot(card)) slot = ownSlot(board, enemy, target);
  else if (target) slot = ownSlot(board, commander.side, afterManeuver(maneuver, target, swapped));
  events.push({ kind: "command", side: commander.side, cardId: card.id, target: slot && slotRef(slot) });
  return {
    commander,
    card,
    target: slot,
    destination: slot && destination !== null ? board.lane(slot.lane.side, destinationLane(card, slot.lane.type)).slots[destination]! : null,
  };
}

/** Das Schiff der Seite `side`, das der Befehl `card` der Gegenseite erfasst hat; null, wenn es nicht (mehr) auf dem Brett steht. */
function locked(board: Board, side: Side, card: CommandCard): Slot | null {
  return board.ships(side).find((slot) => slot.locks.includes(card.id)) ?? null;
}

/**
 * Wo ein eigenes Befehlsziel nach dem Manöver steht: Zielt der Befehl auf das manövrierte Schiff, folgt er ihm;
 * nach einem Phasentausch folgt er auch dem Schiff, das mit der Mirage getauscht hat.
 */
function afterManeuver(maneuver: Turn["maneuver"], target: SlotTarget, swapped: boolean): SlotTarget {
  if (maneuver && isSameSlot(target, maneuver.ship)) return maneuver.destination;
  if (maneuver && swapped && isSameSlot(target, maneuver.destination)) return maneuver.ship;
  return target;
}

// --- Deploy ---

/**
 * Die Admiralsfähigkeit, gleich nach den Deploys: Das Trugbild erscheint in seinem Strike-Slot; die übrigen liegen
 * in dieser Runde auf dem gewählten Schiff (`Slot.powers`) und folgen ihm, wenn es sich bewegt.
 */
export function resolvePower(board: Board, side: Side, { id, target }: NonNullable<Turn["power"]>, events: RoundEvent[]): void {
  const targetSide = targetsEnemy(id) ? opposite(side) : side;
  const slot = board.lane(targetSide, target.lane).slots[target.slotIndex]!;
  events.push({ kind: "power", side, power: id, target: { side: targetSide, ...target } });
  if (id !== "decoy") {
    slot.powers = [...slot.powers, id];
    return;
  }
  slot.place(shipById("decoy"));
  slot.arrived = true;
  events.push({ kind: "decoy", ship: shipRef(slot) });
}

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
    const slot = nearest(carrier.lane.slots.filter((slot) => slot.isFree && !reserved.includes(slot)), carrier.index);
    if (slot === null) continue;
    slot.place(shipById("drone"));
    slot.arrived = true;
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

/** Pendulum: markiert nach den Deploys das gegnerische Schiff im geplanten Slot, sofern es noch steht; die Markierung folgt ihm. */
function resolveMark(board: Board, side: Side, target: SlotTarget, events: RoundEvent[]): void {
  const slot = board.lane(opposite(side), target.lane).slots[target.slotIndex]!;
  if (!slot.isOccupied) return;
  slot.marked = true;
  events.push({ kind: "mark", side, ship: shipRef(slot) });
}

// --- Manöver ---

/** Grundmanöver: Das Schiff wechselt in einen freien Slot, in der anderen oder derselben Lane, und feuert dafür in dieser Runde nicht. */
export function resolveManeuver(from: Slot, to: Slot, events: RoundEvent[]): void {
  const ship = shipRef(from);
  to.takeFrom(from);
  to.maneuvered = true;
  events.push({ kind: "maneuver", side: ship.side, ship, to: slotTarget(to) });
}

/** Phasentausch statt Grundmanöver: Die Mirage und das Schiff im Ziel-Slot tauschen die Plätze samt Zustand und feuern beide. */
export function resolveSwap(mirage: Slot, other: Slot, events: RoundEvent[]): void {
  events.push({ kind: "swap", side: mirage.lane.side, a: shipRef(mirage), b: shipRef(other) });
  mirage.swapWith(other);
}

/**
 * Bastion (Wächterschild): Nach den Manövern bekommt sie Schild für diese Runde (wie Notschilde, er verfällt im
 * Cleanup); steht sie in der Command-Lane, auch das Schiff im Strike-Slot direkt vor ihr.
 */
function resolveGuardianShields(board: Board, events: RoundEvent[]): void {
  for (const side of SIDES) {
    const bastion = board.flagship(side);
    if (bastion?.card!.id !== "bastion") continue;
    const front = bastion.lane.type === "command" ? board.lane(side, "strike").slots[bastion.index]! : null;
    for (const slot of front?.isOccupied ? [bastion, front] : [bastion]) {
      slot.addShield(ABILITY_VALUES.guardianShield);
      events.push({ kind: "ability", source: shipRef(bastion), ship: shipRef(slot), effect: { type: "shield", amount: ABILITY_VALUES.guardianShield }, after: stats(slot) });
    }
  }
}

// --- Effects ---

/**
 * Die Befehle nach `COMMAND_ORDER`. Gegenmaßnahmen (Spezial) lassen einen Schwächungs- oder Angriffsbefehl der
 * Gegenseite verpuffen, sonst ziehen sie einen Befehl. Alle Rammstöße der Runde wirken gleichzeitig (`resolveRams`).
 */
export function resolveEffects(board: Board, commands: readonly PlayedCommand[], events: RoundEvent[]): void {
  const ordered = [...commands].sort(
    (a, b) => COMMAND_ORDER.indexOf(a.card.commandType) - COMMAND_ORDER.indexOf(b.card.commandType),
  );
  const countered = new Set<PlayedCommand>();
  for (const command of ordered) {
    const { commander, card } = command;
    if (countered.has(command)) continue;
    if (card.id === "countermeasures") {
      const hostile = commands.find((other) => other.commander.side !== commander.side && (other.card.commandType === "debuff" || other.card.commandType === "attack"));
      if (hostile) {
        countered.add(hostile);
        events.push({ kind: "countered", side: commander.side, cardId: card.id, countered: hostile.card.id });
      } else events.push({ kind: "draw", side: commander.side, cardId: card.id, ...commander.drawExtra(0, 1) });
    } else if (card.id === "collision_course") {
      // Alle Rammstöße beim ersten auf einmal.
      if (ordered.find((other) => other.card.id === "collision_course") === command) {
        resolveRams(board, ordered.filter((other) => other.card.id === "collision_course"), events);
      }
    } else if (!applyCommand(board, command, events)) {
      events.push({ kind: "noEffect", side: commander.side, cardId: card.id });
    }
  }
  removeDestroyed(board, events);
}

/**
 * Rammkurs: Das Ziel jedes Rammers ist das ungedeckte gegnerische Schiff mit derselben Slot-Nummer, sonst das
 * nächstgelegene (Deckung ohne `seeThrough`: Ein Trugbild deckt und kann gerammt werden). Das Ziel nimmt die HP des
 * Rammers, der Rammer die des Ziels, beides vor dem Schild. Ziele und Beträge stehen mit dem Stand vor dem ersten
 * Rammstoß fest; rammen sich zwei Schiffe gegenseitig, ist das eine Kollision, gemeldet beim ersten Befehl. Der
 * Rammer feuert in dieser Runde nicht.
 */
function resolveRams(board: Board, commands: readonly PlayedCommand[], events: RoundEvent[]): void {
  const rams = commands.map((command) => {
    const rammer = command.target!;
    const valid = rammer.isOccupied && !rammer.isDestroyed;
    const targets = valid ? board.exposedShips(opposite(command.commander.side)).filter((slot) => !slot.isDestroyed) : [];
    const target = nearest(targets, rammer.index);
    return { command, rammer, target, dealt: rammer.hp, taken: target?.hp ?? 0 };
  });
  for (const { rammer, target } of rams) {
    if (target) rammer.disabled = true;
  }
  for (const [index, { command, rammer, target, dealt, taken }] of rams.entries()) {
    const { side } = command.commander;
    if (target === null) {
      events.push({ kind: "noEffect", side, cardId: command.card.id });
      continue;
    }
    if (rams.slice(0, index).some((other) => other.rammer === target && other.target === rammer)) continue;
    const ship = shipRef(rammer);
    const struck = shipRef(target);
    target.damage(dealt);
    rammer.damage(taken);
    events.push({
      kind: "effect",
      side,
      cardId: command.card.id,
      ship,
      effect: { type: "ram", target: struck, dealt, taken, targetAfter: stats(target) },
      after: stats(rammer),
    });
  }
}

/** Wendet den Befehl an; false, wenn er nichts bewirkt hat. */
function applyCommand(board: Board, { commander, card, target, destination }: PlayedCommand, events: RoundEvent[]): boolean {
  // Das eigene Ziel kann schon vor den Befehlen gefallen sein, durch den Schuss einer Plasma Frigate.
  if (target && !target.isOccupied && !targetsEnemySide(card)) return false;
  const side = commander.side;
  const enemy = opposite(side);
  const enemyShips = board.ships(enemy);
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
  const damage = (amount: number) => (slot: Slot): CommandEffect => {
    slot.damage(amount);
    return { type: "damage", amount };
  };
  const shield = (amount: number) => (slot: Slot): CommandEffect => {
    slot.addShield(amount);
    return { type: "shield", amount };
  };
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
      events.push({ kind: "draw", side, cardId: card.id, ...commander.drawExtra(1, 1) });
      return true;
    case "evasive_action": {
      const ship = moveTarget();
      affectOne(ship, shield(2));
      return true;
    }
    case "micro_jump": {
      // Das Schiff verlässt samt Zustand das Brett; sein Slot bleibt bis zur Rückkehr im Cleanup gesperrt.
      const ship = new Slot(target!.lane, target!.index);
      ship.copy(target!);
      ship.moved = true;
      target!.clear();
      board.jumping.push(ship);
      affect(shipRef(ship), { type: "jump" }, ship);
      return true;
    }
    case "rapid_deployment":
    case "carte_blanche":
      events.push({ kind: "rule", side, cardId: card.id });
      return true;
    case "draw_fire":
      return affectOne(target, (slot) => {
        slot.taunting = true;
        return { type: "taunt" };
      });
    case "shield_grid":
      return affectAll(board.ships(side), shield(1));
    case "ablative_armor":
      return affectOne(target, (slot) => {
        slot.shield += 2;
        return { type: "shield", amount: 2, permanent: true };
      });
    case "covering_fire": {
      const partner = board.lane(side, otherLane(target!.lane.type)).slots[target!.index]!;
      for (const slot of partner.isOccupied ? [target!, partner] : [target!]) {
        const ship = shipRef(slot);
        slot.attackBonus += 1;
        affect(ship, { type: "attack", delta: 1 }, slot);
        affect(ship, shield(1)(slot), slot);
      }
      return true;
    }
    case "drone_squadron": {
      // `ship` ist die gerade gestartete Drohne.
      const slots = launchSlots(board, side).slice(0, 2);
      for (const slot of slots) {
        slot.place(shipById("drone"));
        slot.arrived = true;
        affect(shipRef(slot), { type: "spawn" }, slot);
      }
      return slots.length > 0;
    }
    case "radio_silence":
      return jamPowers(board, side, (ship, power, slot) => affect(ship, { type: "jam", power }, slot));
    case "minefield":
      return affectAll(enemyShips.filter((slot) => slot.arrived), damage(3));
    case "tractor_beam": {
      const ship = locked(board, enemy, card);
      const to = ship && board.lane(enemy, otherLane(ship.lane.type)).freeSlotNear(ship.index, isToken(ship.card!));
      if (!ship || !to) return false;
      const from = shipRef(ship);
      to.takeFrom(ship);
      affect(from, { type: "move", to: slotTarget(to) }, to);
      return true;
    }
    case "heat_seeker":
      // Ignoriert Deckung; ein Schiff, das sich in dieser Runde bewegt hat, trifft er härter.
      return affectOne(locked(board, enemy, card), (slot) => damage(slot.moved ? 5 : 3)(slot));
    case "coup_de_grace":
      return affectOne(highest(enemyShips.filter((slot) => !isToken(slot.card!) && !slot.isDestroyed), (slot) => -slot.hp), damage(4));
    case "piercing_shot": {
      // Das vorderste Schiff der Slot-Nummer nimmt 3; stand vorne ein Strike-Schiff, nimmt das Command-Schiff dahinter 2.
      const column = [target!, board.lane(enemy, "command").slots[target!.index]!].filter((slot) => slot.isOccupied && !slot.isDestroyed);
      if (column.length === 0) {
        events.push({ kind: "miss", side, cardId: card.id, target: slotRef(target!) });
        return true;
      }
      affectOne(column[0]!, damage(3));
      if (column.length === 2) affectOne(column[1]!, damage(2));
      return true;
    }
    case "bombardment":
      return affectAll(board.lane(enemy, "command").occupiedSlots.filter((slot) => !slot.isDestroyed), damage(2));
    case "crossfire": {
      // Ohne Partner: kein (nicht zerstörtes) Schiff im Slot gleicher Nummer der anderen Lane; Tokens zählen mit.
      const standing = enemyShips.filter((slot) => !slot.isDestroyed);
      const paired = (slot: Slot) => standing.some((other) => other.index === slot.index && other !== slot);
      return affectAll(standing.filter((slot) => !paired(slot)), damage(3));
    }
    case "countermeasures":
    case "collision_course":
      // Wirken in `resolveEffects`, weil sie die Befehle beider Seiten brauchen.
      return true;
  }
}

/**
 * Drohnenstaffel: freie eigene Strike-Slots in Startreihenfolge: zuerst vor dem ungedeckten eigenen Flaggschiff, dann
 * vor anderen ungedeckten eigenen Command-Schiffen (niedrigere Nummer zuerst), dann nach Nähe zur Lane-Mitte
 * (Gleichstand: niedrigerer Index).
 */
function launchSlots(board: Board, side: Side): Slot[] {
  const command = board.lane(side, "command").slots;
  const rank = (slot: Slot): number => {
    const behind = command[slot.index]!;
    if (behind.isOccupied && isFlagship(behind.card!)) return 0;
    if (behind.isOccupied) return 1 + slot.index / SLOT_COUNT;
    return 2 + Math.abs(slot.index - (SLOT_COUNT - 1) / 2) + slot.index / (SLOT_COUNT * SLOT_COUNT);
  };
  return board
    .lane(side, "strike")
    .slots.filter((slot) => slot.isFree)
    .sort((a, b) => rank(a) - rank(b));
}

/**
 * Funkstille von `side`: Alle Marken der gegnerischen Admiralsfähigkeit fallen weg, auf gegnerischen Schiffen die mit
 * eigenem Ziel, auf eigenen die mit gegnerischem Ziel; ein gegnerisches Trugbild verschwindet sofort (ohne Schrott,
 * ohne `vanish`). Meldet jede entfernte Marke an `report` (Schiff vorher, Fähigkeit, Slot danach); false, wenn keine da war.
 */
function jamPowers(board: Board, side: Side, report: (ship: ShipRef, power: PowerId, slot: Slot) => void): boolean {
  let jammed = false;
  for (const slot of [...board.ships(opposite(side)), ...board.ships(side)]) {
    const ship = shipRef(slot);
    if (slot.lane.side !== side && slot.card!.id === "decoy") {
      slot.clear();
      report(ship, "decoy", slot);
      jammed = true;
      continue;
    }
    const hostile = slot.powers.filter((power) => targetsEnemy(power) === (slot.lane.side === side));
    if (hostile.length === 0) continue;
    slot.powers = slot.powers.filter((power) => !hostile.includes(power));
    for (const power of hostile) report(ship, power, slot);
    jammed = true;
  }
  return jammed;
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

/** Ein Treffer auf ein Schiff mit Gegenfeuer (`source`); der Schütze nimmt dafür nach dem Kampf Schaden. */
interface Counterfire {
  attacker: Slot;
  source: Slot;
}

/**
 * Beide Seiten feuern gleichzeitig: Wer zu Kampfbeginn schießen kann (`Slot.canAttack`,
 * also weder per EMP gelähmt noch manövriert), schießt, auch wenn er im selben Kampf zerstört wird. Ziel sind nur ungedeckte Schiffe
 * (`Board.exposedShips`); die Deckung gilt für die ganze Runde, auch wenn das
 * deckende Schiff im selben Kampf zerstört wird. Flaggschiffe durchschauen Trugbilder: Sie beschießen
 * keins, und keins deckt gegen sie. Innerhalb einer Seite zielen die Schiffe nacheinander in
 * Slot-Reihenfolge und überspringen Ziele, die ein eigener Schuss schon zerstört hat; so verpufft kein
 * Schuss. Findet ein Schiff kein Ziel mehr, verfällt sein Schuss. Die Seiten beeinflussen sich dabei
 * nicht, weil jede nur die Schiffe der anderen trifft. Gemeldet werden die
 * Schüsse abwechselnd, damit die Animation hin und her geht.
 *
 * Mit den Admiralen: Zuerst feuert die Railgun jeder Pendulum in `railguns` (ohne Angabe jede, deren Markierung
 * steht) auf ihr markiertes Schiff. Dann die Schiffe mit Taktvorsprung, beider Seiten gleichzeitig; wer dabei
 * fällt und noch stand, feuert nicht mehr (`silenced`), ein Ziel der Railgun dagegen schon. Dann alle übrigen:
 * Drohnen auf das Ziel des Schwarmangriffs, auch durch Deckung, solange es steht; sonst auf das Ziel des
 * Fokusfeuers, solange es steht und für den Schützen ungedeckt ist; sonst auf das Schiff mit Ablenkung, solange es
 * steht und für den Schützen ungedeckt ist; sonst nach der Klassenregel. Zuletzt das
 * Gegenfeuer: Wer ein Schiff damit getroffen hat, nimmt je Treffer Schaden, Flaggschiffe ausgenommen.
 */
export function resolveCombat(board: Board, events: RoundEvent[], railguns: readonly Side[] = SIDES.filter((side) => railgunFires(board, side))): void {
  const attackers = SIDES.map((side) => board.ships(side).filter((slot) => slot.canAttack));
  const railgunShots = railguns.flatMap((side) => fireRailgun(board, side));
  const counterfire: Counterfire[] = [];
  const fire = (shooters: readonly (readonly Slot[])[]) => interleave(shooters.map((slots, index) => volley(board, SIDES[index]!, slots, counterfire)));
  const headStart = (slot: Slot) => slot.powers.includes("head_start");
  const later = attackers.map((slots) => slots.filter((slot) => !headStart(slot)));
  const standing = later.flat().filter((slot) => !slot.isDestroyed);
  const earlyShots = fire(attackers.map((slots) => slots.filter(headStart)));
  const silenced = standing.filter((slot) => slot.isDestroyed);
  const shots = fire(later.map((slots) => slots.filter((slot) => !silenced.includes(slot))));
  events.push(...railgunShots, ...earlyShots, ...silenced.map((slot) => ({ kind: "silenced" as const, ship: shipRef(slot) })), ...shots);
  for (const { attacker, source } of counterfire) {
    attacker.damage(ABILITY_VALUES.counterfire);
    events.push({ kind: "counterfire", source: shipRef(source), ship: shipRef(attacker), amount: ABILITY_VALUES.counterfire, after: stats(attacker) });
  }
}

/**
 * Railgun der Pendulum zu Kampfbeginn: Schaden auf das markierte Schiff, wenn es ungedeckt ist (ein Trugbild
 * deckt nicht, die Pendulum durchschaut es), sonst ist der Schuss blockiert.
 */
function fireRailgun(board: Board, side: Side): RoundEvent[] {
  const pendulum = board.flagship(side);
  const target = board.ships(opposite(side)).find((slot) => slot.marked);
  if (pendulum === null || target === undefined) return [];
  const blocked = !board.isExposed(target, true);
  const amount = blocked ? 0 : ABILITY_VALUES.railgun;
  target.damage(amount);
  return [{ kind: "railgun", source: shipRef(pendulum), target: shipRef(target), amount, after: stats(target), blocked }];
}

/** Die Schüsse einer Seite in Slot-Reihenfolge (siehe `resolveCombat`); Treffer auf ein Schiff mit Gegenfeuer landen in `counterfire`. */
function volley(board: Board, side: Side, shooters: readonly Slot[], counterfire: Counterfire[]): RoundEvent[] {
  const enemy = opposite(side);
  const targets = board.exposedShips(enemy);
  const flagshipTargets = board.exposedShips(enemy, true);
  const marked = (power: PowerId) => board.ships(enemy).find((slot) => slot.powers.includes(power)) ?? null;
  const swarm = marked("swarm_strike");
  const focus = marked("focus_fire");
  const taunt = board.ships(enemy).find((slot) => slot.taunting) ?? null;
  const shots: RoundEvent[] = [];
  for (const attacker of shooters) {
    const view = (isFlagship(attacker.card!) ? flagshipTargets : targets).filter((slot) => !slot.isDestroyed);
    const swarmed = attacker.card!.id === "drone" && swarm !== null && !swarm.isDestroyed ? swarm : null;
    const focused = swarmed === null && focus !== null && view.includes(focus) ? focus : null;
    const taunted = taunt !== null && view.includes(taunt) ? taunt : null;
    const target = swarmed ?? focused ?? taunted ?? chooseTarget(attacker, view);
    if (target === null) continue;
    const amount = attacker.attack + (swarmed ? ABILITY_VALUES.swarmStrike : 0) + (focused ? ABILITY_VALUES.focusFire : 0);
    target.damage(amount);
    if (target.powers.includes("counterfire") && !isFlagship(attacker.card!)) counterfire.push({ attacker, source: target });
    shots.push({
      kind: "attack",
      attacker: shipRef(attacker),
      target: shipRef(target),
      amount,
      after: stats(target),
      ...(focused ? { focus: true as const } : {}),
      ...(swarmed ? { swarm: true as const } : {}),
      ...(attacker.powers.includes("head_start") ? { headStart: true as const } : {}),
    });
  }
  return shots;
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

/**
 * Rückkehr aus dem Kurzsprung, Eigenschaden, Zerstörte entfernen, Reparaturen, das Trugbild verschwindet,
 * Rundenmodifikatoren zurücksetzen.
 */
export function resolveCleanup(board: Board, events: RoundEvent[]): void {
  for (const ship of board.jumping) {
    const slot = ship.lane.slots[ship.index]!;
    slot.copy(ship);
    events.push({ kind: "return", ship: shipRef(slot), after: stats(slot) });
  }
  board.jumping = [];
  for (const side of SIDES) {
    for (const slot of board.ships(side)) {
      if (slot.selfDamageAfterCombat === 0) continue;
      slot.damage(slot.selfDamageAfterCombat);
      events.push({ kind: "selfDamage", ship: shipRef(slot), amount: slot.selfDamageAfterCombat, after: stats(slot) });
    }
  }
  removeDestroyed(board, events);
  resolveRepairs(board, events);
  for (const slot of SIDES.flatMap((side) => board.ships(side)).filter((slot) => slot.card!.id === "decoy")) {
    events.push({ kind: "vanish", ship: shipRef(slot) });
    slot.clear();
  }
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
 * Hive (Brutkammer): Am Rundenende, nach dem Cleanup, startet sie eine Drohne in den freien Strike-Slot, der ihr am
 * nächsten liegt, solange ihre Seite weniger Drohnen hat als `maxDrones` (auch die der Titan Carrier) und sie in
 * diesem Match weniger als `hiveBudget` gestartet hat (`Board.hiveLaunches`).
 */
function resolveBroodChamber(board: Board, events: RoundEvent[]): void {
  for (const side of SIDES) {
    const hive = board.flagship(side);
    if (hive?.card!.id !== "hive" || board.hiveLaunches[side] >= ABILITY_VALUES.hiveBudget) continue;
    if (board.ships(side).filter((slot) => slot.card!.id === "drone").length >= ABILITY_VALUES.maxDrones) continue;
    const slot = nearest(board.lane(side, "strike").slots.filter((slot) => !slot.isOccupied), hive.index);
    if (slot === null) continue;
    slot.place(shipById("drone"));
    board.hiveLaunches[side] += 1;
    events.push({ kind: "spawn", source: shipRef(hive), ship: shipRef(slot) });
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
    // Ein Trugbild ist ein Hologramm und hinterlässt keinen Schrott.
    const kills = destroyed.filter((slot) => slot.lane.side !== raider.lane.side && slot.lane.type === raider.lane.type && slot.card!.id !== "decoy").length;
    if (kills === 0) continue;
    raider.scrapBonus += kills;
    const ship = shipRef(raider);
    events.push({ kind: "ability", source: ship, ship, effect: { type: "attack", delta: kills }, after: stats(raider) });
  }
  for (const slot of destroyed) slot.clear();
}
