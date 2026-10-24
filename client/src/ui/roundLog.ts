// Formuliert die aufgedeckten Ereignisse einer Runde als Log-Zeilen.

import type { Side } from "../../../shared/board.ts";
import type { RoundEvent, ShipRef, SlotTarget } from "../../../shared/protocol.ts";
import { t } from "../i18n/index.ts";

function slotLabel(side: Side, target: SlotTarget): string {
  return t.log.slot(side, t.lanes[target.lane], target.slotIndex + 1);
}

function shipLabel(ship: ShipRef): string {
  return t.log.ship(t.ships[ship.cardId].name, slotLabel(ship.side, ship));
}

export function describeEvent(event: RoundEvent): string {
  switch (event.kind) {
    case "deploy":
      return t.log.deploy(t.log.who[event.side], t.ships[event.cardId].name, slotLabel(event.side, event.target));
    case "pass":
      return t.log.pass(t.log.who[event.side]);
    case "command": {
      const who = t.log.who[event.side];
      const name = t.commands[event.cardId].name;
      return event.target ? t.log.commandOn(who, name, slotLabel(event.side, event.target)) : t.log.command(who, name);
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
          return t.log.move(name, ship, slotLabel(event.ship.side, effect.to));
      }
    }
    case "ability":
      return t.log.repair(shipLabel(event.source), shipLabel(event.ship), event.effect.amount);
    case "draw":
      return t.log.draw(t.commands[event.cardId].name, t.log.who[event.side], event.ships, event.commands);
    case "noEffect":
      return t.log.noEffect(t.commands[event.cardId].name, t.log.who[event.side]);
    case "attack":
      return t.log.attack(shipLabel(event.attacker), shipLabel(event.target), event.amount);
    case "selfDamage":
      return t.log.selfDamage(shipLabel(event.ship), event.amount);
    case "destroyed":
      return t.log.destroyed(shipLabel(event.ship));
  }
}
