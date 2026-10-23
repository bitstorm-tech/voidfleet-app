// Englisch ist die Ausgangssprache: Diese Datei legt Schlüssel und Parameter
// fest, jede weitere Sprache muss `Messages` vollständig erfüllen.

import type { LaneType, Side } from "../../../shared/board.ts";
import type { CommandId, ShipClass, ShipId, TargetMode } from "../../../shared/cards.ts";
import type { ErrorCode, MatchResult } from "../../../shared/protocol.ts";

export interface CardText {
  name: string;
  effect: string;
}

export const en = {
  hud: {
    round: (round: number) => `Round ${round}`,
    newRound: "New round",
    endTurn: "End turn",
    waiting: "Waiting for opponent",
    skip: "Skip animation",
    playComputer: "Play against computer",
    showLog: "Show log",
    hideLog: "Hide log",
  },
  status: {
    disconnected: "Lost connection to the server — reload the page.",
    connecting: "Connecting to the server …",
    submitted: "Turn ended — waiting for the opponent.",
    waitingForOpponent: (link: string) => `Waiting for the opponent — share this link: ${link}`,
    opponentSubmitted: "The opponent has already ended their turn.",
    fleet: (count: number, max: number) => `Fleet ${count}/${max}`,
    noFreeSlot: (ship: string, perLane: number, perSide: number) =>
      `no free slot for ${ship} (max. ${perLane} per lane, ${perSide} per side).`,
    placeShip: (ship: string) => `${ship}: tap a glowing slot. Click the card again to take it back.`,
    noCommandTarget: (command: string) => `no own ship to target with ${command}.`,
    chooseCommandTarget: (command: string) => `${command}: tap one of your ships. Click the card again to take it back.`,
    planned: (cards: string) => `${cards} ready. Click “End turn”, or tap a card to take it back.`,
    idle: "Tap a ship or command card, or click “End turn” without a card to pass.",
    resolving: "Both turns are revealed — resolving the round …",
    matchOver: "The match is over.",
  },
  result: {
    won: { title: "Victory", subtitle: "The enemy fleet is destroyed." },
    lost: { title: "Defeat", subtitle: "Your fleet is destroyed." },
    draw: { title: "Draw", subtitle: "Both fleets are destroyed." },
    rounds: (round: number) => `Decided in round ${round}`,
    viewBoard: "View board",
    newMatch: "New match",
  },
  log: {
    roundHeader: (round: number) => `— Round ${round} —`,
    who: { player: "You", enemy: "Enemy" } satisfies Record<Side, string>,
    slot: (side: Side, lane: string, slot: number) => `${side === "player" ? "your" : "enemy"} ${lane} slot ${slot}`,
    ship: (ship: string, slot: string) => `${ship} (${slot})`,
    deploy: (who: string, ship: string, slot: string) => `Deploy: ${who} — ${ship} on ${slot}`,
    pass: (who: string) => `Deploy: ${who} — no ship`,
    command: (who: string, command: string) => `Command: ${who} — ${command}`,
    commandOn: (who: string, command: string, slot: string) => `Command: ${who} — ${command} on ${slot}`,
    damage: (command: string, ship: string, amount: number) => `Effect: ${command} hits ${ship} for ${amount}`,
    attackBonus: (command: string, ship: string, delta: number) =>
      `Effect: ${command} — ${ship} ${delta > 0 ? "+" : ""}${delta} ATK this round`,
    shield: (command: string, ship: string, amount: number) => `Effect: ${command} — ${ship} +${amount} shield this round`,
    disable: (command: string, ship: string) => `Effect: ${command} — ${ship} cannot attack this round`,
    heal: (command: string, ship: string, amount: number) => `Effect: ${command} heals ${ship} for ${amount}`,
    move: (command: string, ship: string, slot: string) => `Effect: ${command} — ${ship} moves to ${slot}`,
    draw: (command: string, who: string, ships: number, commands: number) =>
      `Effect: ${command} — ${who} +${ships} ship, +${commands} command`,
    noEffect: (command: string, who: string) => `Effect: ${command} (${who}) has no effect`,
    attack: (attacker: string, target: string, amount: number) => `Combat: ${attacker} fires at ${target} (${amount})`,
    selfDamage: (ship: string, amount: number) => `Cleanup: ${ship} takes ${amount} self-damage`,
    destroyed: (ship: string) => `Destroyed: ${ship}`,
  },
  banner: {
    command: (who: string, command: string) => `${who}: ${command}`,
    noEffect: "no effect",
    draw: (ships: number, commands: number) => `+${ships} ship, +${commands} command`,
  },
  float: {
    damage: (amount: number) => `−${amount}`,
    heal: (amount: number) => `+${amount} HP`,
    shield: (amount: number) => `+${amount} Shield`,
    attack: (delta: number) => `${delta > 0 ? "+" : "−"}${Math.abs(delta)} ATK`,
    disabled: "Disabled",
  },
  errors: {
    match_full: "This match is already full.",
    match_over: "The match is over.",
    opponent_missing: "The opponent hasn't joined yet.",
    already_submitted: "You have already ended your turn this round.",
    ship_not_in_hand: "This ship card isn't in your hand.",
    slot_unavailable: "No ship can land on this slot.",
    command_not_in_hand: "This command card isn't in your hand.",
    target_required: "This command needs a target.",
    target_not_allowed: "This command takes no target.",
    target_not_own_ship: "The command target isn't one of your ships.",
    target_wrong_lane: "This command can't target a ship in that lane.",
  } satisfies Record<ErrorCode, string>,
  lanes: { strike: "Strike", command: "Command" } satisfies Record<LaneType, string>,
  stats: { hp: "HP", atk: "ATK", shield: "Shield" },
  shipClasses: {
    fighter: "Fighter",
    cruiser: "Cruiser",
    battleship: "Battleship",
    support: "Support",
  } satisfies Record<ShipClass, string>,
  targets: {
    none: "",
    auto_highest_hp: "Highest-HP Enemy",
    auto_highest_atk: "Highest-ATK Enemy",
    auto_all: "All Targets",
    all_friendly_strike: "All Allies",
    all_enemy_strike: "All Enemies",
    choose_friendly: "Choose Ally",
    choose_enemy: "Choose Enemy",
  } satisfies Record<TargetMode, string>,
  ships: {
    horizon_cruiser: { name: "Horizon Cruiser", effect: "Solid stats, reliable." },
    iron_dreadnought: { name: "Iron Dreadnought", effect: "Shield 2: Absorbs the first 2 damage each round." },
    plasma_frigate: { name: "Plasma Frigate", effect: "On Deploy: Deal 1 damage to a random enemy ship in the same lane." },
    repair_drone: { name: "Repair Drone", effect: "Heals 2 HP to the allied ship with the lowest HP each round." },
    scrap_raider: { name: "Scrap Raider", effect: "When an enemy ship in the same lane is destroyed: +1 ATK permanently." },
    signal_booster: { name: "Signal Booster", effect: "On Deploy: All allied ships in the same lane gain +1 ATK permanently." },
    titan_carrier: { name: "Titan Carrier", effect: "On Deploy: Spawn a Drone (1 HP, 1 ATK) in the same lane." },
    void_interceptor: { name: "Void Interceptor", effect: "Pure damage, no tricks." },
  } satisfies Record<ShipId, CardText>,
  commands: {
    emergency_shields: { name: "Emergency Shields", effect: "Chosen allied ship gains Shield 3 this round." },
    emp_blast: { name: "EMP Blast", effect: "The enemy ship with the highest ATK cannot attack this round." },
    flanking_maneuver: { name: "Flanking Maneuver", effect: "Chosen allied ship switches lanes (Strike ↔ Command)." },
    intercept: { name: "Intercept", effect: "Pull a chosen Command Line ship into the Strike Line. +2 ATK this round." },
    orbital_strike: { name: "Orbital Strike", effect: "Deal 4 damage to the enemy ship with the highest HP." },
    overcharge: { name: "Overcharge", effect: "Chosen ship gets +3 ATK this round. Takes 2 self-damage after combat." },
    power_surge: { name: "Power Surge", effect: "All allied ships in the Strike Line gain +1 ATK this round." },
    recall: { name: "Recall", effect: "A chosen Strike Line ship retreats to the Command Line. Heal 2 HP." },
    scavenge: { name: "Scavenge", effect: "Draw 1 extra ship and 1 extra command." },
    sensor_sweep: { name: "Sensor Sweep", effect: "Reveal all cards in the enemy hand for the next round." },
    targeting_jammer: { name: "Targeting Jammer", effect: "All enemy ships in the Strike Line get -1 ATK this round (min 0)." },
    volley_fire: { name: "Volley Fire", effect: "Deal 1 damage to ALL enemy ships." },
  } satisfies Record<CommandId, CardText>,
};

export type Messages = typeof en;
