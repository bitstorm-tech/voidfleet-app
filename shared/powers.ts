// Ziele der Admiralsfähigkeiten und der Markierung der Pendulum beim Planen: Der Client bietet damit die
// Zielwahl an, der Server prüft den Zug mit denselben Regeln (`Match.validate`). Ziele gelten zur Stellung
// beim Planen; was in der Runde daraus wird, regelt `resolution.ts`.

import { POWER_TARGETS, type PowerId } from "./admirals.ts";
import { isSameSlot, opposite, slotTarget, type Board, type Side, type Slot } from "./board.ts";
import { isFlagship, type ShipCard } from "./cards.ts";
import type { SlotRef, SlotTarget } from "./protocol.ts";

/** Ein eigenes Schiff, das in dieser Runde landet (Deploy oder Flaggschiff), samt seinem Slot. */
export interface PlannedArrival {
  card: ShipCard;
  target: SlotTarget;
}

function slotRef(slot: Slot): SlotRef {
  return { side: slot.lane.side, ...slotTarget(slot) };
}

/**
 * Gültige Ziele der Admiralsfähigkeit `power` für `side` beim Planen. `arrivals`: eigene Schiffe, die in dieser
 * Runde landen (Deploys samt Flaggschiff); sie zählen als eigene Schiffe bzw. belegen ihren Slot. `blocked`:
 * eigene Slots, in die sich in dieser Runde etwas bewegt (Ziel eines Bewegungsbefehls, mit Freier Hand auch des
 * Grundmanövers); dort kann kein Trugbild erscheinen.
 */
export function powerTargets(board: Board, side: Side, power: PowerId, arrivals: readonly PlannedArrival[], blocked: readonly SlotTarget[]): SlotRef[] {
  const own = board.ships(side);
  const enemies = board.ships(opposite(side));
  const landing = ({ target }: PlannedArrival): SlotRef => ({ side, ...target });
  // Den Schwarmangriff fliegen die Drohnen, die beim Planen schon stehen.
  if (power === "swarm_strike" && !own.some((slot) => slot.card!.id === "drone")) return [];
  switch (POWER_TARGETS[power]) {
    case "own_ship":
      return [...own.map(slotRef), ...arrivals.map(landing)];
    case "own_combat_ship":
      return [...own.filter((slot) => slot.card!.atk > 0).map(slotRef), ...arrivals.filter(({ card }) => card.atk > 0).map(landing)];
    case "enemy_ship":
      return enemies.map(slotRef);
    case "enemy_ship_not_flagship":
      return enemies.filter((slot) => !isFlagship(slot.card!)).map(slotRef);
    case "free_own_strike_slot": {
      const taken = [...arrivals.map((arrival) => arrival.target), ...blocked];
      return board
        .lane(side, "strike")
        .slots.filter((slot) => !slot.isOccupied && !taken.some((target) => isSameSlot(target, slotTarget(slot))))
        .map(slotRef);
    }
  }
}

/** Ob die Railgun der Pendulum von `side` in dieser Runde feuert: Auf der Gegenseite steht ein Schiff, das sie in der Vorrunde markiert hat. */
export function railgunFires(board: Board, side: Side): boolean {
  return board.ships(opposite(side)).some((slot) => slot.marked);
}

/** Ob die Pendulum der Seite in dieser Runde markieren darf (sie steht auf dem Brett und feuert in dieser Runde nicht). */
export function canMark(board: Board, side: Side): boolean {
  return board.flagship(side)?.card!.id === "pendulum" && !railgunFires(board, side);
}

/** Gültige Ziele der Markierung (gegnerische Schiffe), leer, wenn `canMark` false ist. */
export function markTargets(board: Board, side: Side): SlotRef[] {
  return canMark(board, side) ? board.ships(opposite(side)).map(slotRef) : [];
}
