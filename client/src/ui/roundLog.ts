// Formuliert die aufgedeckten Ereignisse einer Runde als Log-Zeilen.

import { type CommandId, isFlagship, shipById } from "../../../shared/cards.ts";
import type { RoundEvent, ShipRef, SlotRef } from "../../../shared/protocol.ts";
import { t } from "../i18n/index.ts";

export function slotLabel(slot: SlotRef): string {
  return t.log.slot(slot.side, t.lanes[slot.lane], slot.slotIndex + 1);
}

function shipLabel(ship: ShipRef): string {
  return t.log.ship(t.ships[ship.cardId].name, slotLabel(ship));
}

/** Was Schnellverlegung bzw. Freie Hand schon beim Planen erlaubt haben; für Banner und Log. */
export function ruleSubtitle(cardId: CommandId): string {
  return cardId === "rapid_deployment" ? t.banner.extraShip : t.banner.maneuverAndPower;
}

/** Was einen Schuss verstärkt, gelenkt oder beschleunigt hat: Admiralsfähigkeiten und die Ablenkung. */
function attackNotes(event: Extract<RoundEvent, { kind: "attack" }>): string[] {
  return [
    event.focus && t.powers.focus_fire.name,
    event.swarm && t.powers.swarm_strike.name,
    event.headStart && t.powers.head_start.name,
    event.taunt && t.commands.draw_fire.name,
  ].filter((note) => note !== undefined);
}

/**
 * Ein Schuss im Kampf. Galt er einem anderen Schiff (`aimedAt`), sagt die Zeile, wer ihn abgefangen hat: die Deckung
 * davor oder das Schiff mit Ablenkung.
 */
function describeAttack(event: Extract<RoundEvent, { kind: "attack" }>): string {
  const attacker = shipLabel(event.attacker);
  const target = shipLabel(event.target);
  const notes = attackNotes(event);
  if (!event.aimedAt) return t.log.attack(attacker, target, event.amount, notes);
  return (event.taunt ? t.log.drawn : t.log.covered)(attacker, shipLabel(event.aimedAt), target, event.amount, notes);
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
          return (effect.permanent ? t.log.shieldPermanent : t.log.shield)(name, ship, effect.amount);
        case "disable":
          return t.log.disable(name, ship);
        case "heal":
          return t.log.heal(name, ship, effect.amount);
        case "move":
          return (event.ship.side === event.side ? t.log.move : t.log.tow)(name, ship, slotLabel({ side: event.ship.side, ...effect.to }));
        case "jump":
          return t.log.jump(name, ship);
        case "taunt":
          return t.log.taunt(name, ship);
        case "spawn":
          return t.log.launch(name, ship);
        case "ram":
          return t.log.ram(name, ship, shipLabel(effect.target), effect.dealt, effect.taken);
        case "jam":
          return effect.power === "decoy" ? t.log.jamDecoy(name, ship) : t.log.jam(name, ship, t.powers[effect.power].name);
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
    case "countered":
      return t.log.countered(t.commands[event.cardId].name, t.log.who[event.side], t.commands[event.countered].name);
    case "rule":
      return t.log.rule(t.commands[event.cardId].name, t.log.who[event.side], ruleSubtitle(event.cardId));
    case "noEffect":
      return t.log.noEffect(t.commands[event.cardId].name, t.log.who[event.side]);
    case "miss":
      return t.log.miss(t.commands[event.cardId].name, slotLabel(event.target));
    case "railgun":
      return event.blocked
        ? t.log.railgunBlocked(shipLabel(event.source), shipLabel(event.target))
        : t.log.railgun(shipLabel(event.source), shipLabel(event.target), event.amount);
    case "attack":
      return describeAttack(event);
    case "fizzle":
      if (event.aimedAt) return t.log.fizzleCovered(shipLabel(event.attacker), shipLabel(event.aimedAt), shipLabel(event.target!));
      return event.target ? t.log.fizzle(shipLabel(event.attacker), shipLabel(event.target)) : t.log.fizzleGone(shipLabel(event.attacker));
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
    case "return":
      return t.log.rejoin(shipLabel(event.ship));
  }
}
