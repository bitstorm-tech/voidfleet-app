// Formuliert die aufgedeckten Ereignisse einer Runde als Log-Zeilen.

import { isFlagship, shipById } from "../../../shared/cards.ts";
import type { RoundEvent, ShipRef, SlotRef } from "../../../shared/protocol.ts";
import { t } from "../i18n/index.ts";

export function slotLabel(slot: SlotRef): string {
  return t.log.slot(slot.side, t.lanes[slot.lane], slot.slotIndex + 1);
}

function shipLabel(ship: ShipRef): string {
  return t.log.ship(t.ships[ship.cardId].name, slotLabel(ship));
}

/** Welche Admiralsfähigkeit einen Schuss gelenkt oder beschleunigt hat; null ohne. */
function attackPower(event: Extract<RoundEvent, { kind: "attack" }>): string | null {
  if (event.focus) return t.powers.focus_fire.name;
  if (event.swarm) return t.powers.swarm_strike.name;
  if (event.headStart) return t.powers.head_start.name;
  return null;
}

export function describeEvent(event: RoundEvent): string {
  switch (event.kind) {
    case "deploy": {
      const deploy = isFlagship(shipById(event.cardId)) ? t.log.deployFlagship : t.log.deploy;
      return deploy(t.log.who[event.side], t.ships[event.cardId].name, slotLabel({ side: event.side, ...event.target }));
    }
    case "pass":
      return t.log.pass(t.log.who[event.side]);
    case "power":
      return t.log.power(t.log.who[event.side], t.powers[event.power].name, slotLabel(event.target));
    case "decoy":
      return t.log.decoy(shipLabel(event.ship));
    case "mark":
      return t.log.mark(t.log.who[event.side], shipLabel(event.ship));
    case "maneuver":
      return t.log.maneuver(t.log.who[event.side], shipLabel(event.ship), slotLabel({ side: event.side, ...event.to }));
    case "swap":
      return t.log.swap(t.log.who[event.side], shipLabel(event.a), shipLabel(event.b));
    case "command": {
      const who = t.log.who[event.side];
      const name = t.commands[event.cardId].name;
      return event.target ? t.log.commandOn(who, name, slotLabel(event.target)) : t.log.command(who, name);
    }
    case "effect": {
      const name = t.commands[event.cardId].name;
      const ship = shipLabel(event.ship);
      const effect = event.effect;
      switch (effect.type) {
        case "damage":
          return t.log.damage(name, ship, effect.amount);
        case "attack":
          return t.log.attackBonus(name, ship, effect.delta);
        case "shield":
          return t.log.shield(name, ship, effect.amount);
        case "disable":
          return t.log.disable(name, ship);
        case "heal":
          return t.log.heal(name, ship, effect.amount);
        case "move":
          return t.log.move(name, ship, slotLabel({ side: event.ship.side, ...effect.to }));
      }
    }
    case "ability": {
      const source = shipLabel(event.source);
      const effect = event.effect;
      switch (effect.type) {
        case "damage":
          return t.log.abilityDamage(source, shipLabel(event.ship), effect.amount);
        case "heal":
          return t.log.repair(source, shipLabel(event.ship), effect.amount);
        case "attack":
          return t.log.scrap(source, effect.delta);
        case "shield":
          return t.log.guardianShield(source, shipLabel(event.ship), effect.amount);
      }
    }
    case "spawn":
      return (event.source.cardId === "hive" ? t.log.brood : t.log.spawn)(shipLabel(event.source), shipLabel(event.ship));
    case "draw":
      return t.log.draw(t.commands[event.cardId].name, t.log.who[event.side], event.ships, event.commands);
    case "noEffect":
      return t.log.noEffect(t.commands[event.cardId].name, t.log.who[event.side]);
    case "miss":
      return t.log.miss(t.commands[event.cardId].name, slotLabel(event.target));
    case "railgun":
      return event.blocked
        ? t.log.railgunBlocked(shipLabel(event.source), shipLabel(event.target))
        : t.log.railgun(shipLabel(event.source), shipLabel(event.target), event.amount);
    case "attack":
      return t.log.attack(shipLabel(event.attacker), shipLabel(event.target), event.amount, attackPower(event));
    case "silenced":
      return t.log.silenced(shipLabel(event.ship));
    case "counterfire":
      return t.log.counterfire(shipLabel(event.ship), shipLabel(event.source), event.amount);
    case "selfDamage":
      return t.log.selfDamage(shipLabel(event.ship), event.amount);
    case "destroyed":
      return (isFlagship(shipById(event.ship.cardId)) ? t.log.flagshipDestroyed : t.log.destroyed)(shipLabel(event.ship));
    case "vanish":
      return t.log.vanish(shipLabel(event.ship));
  }
}
