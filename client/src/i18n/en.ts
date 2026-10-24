// Englisch ist die Ausgangssprache: Diese Datei legt Schlüssel und Parameter
// fest, jede weitere Sprache muss `Messages` vollständig erfüllen.

import type { LaneType, Side } from "../../../shared/board.ts";
import type { CommandId, ShipClass, ShipId, TargetMode } from "../../../shared/cards.ts";
import type { ErrorCode, MatchResult } from "../../../shared/protocol.ts";
import type { AnimationSpeed } from "../settings.ts";

export interface CardText {
  name: string;
  effect: string;
}

export const en = {
  /** Name der Sprache in ihr selbst, für die Sprachwahl. */
  languageName: "English",
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
  settings: {
    title: "Settings",
    musicVolume: "Music",
    effectsVolume: "Sound effects",
    attackSpeed: "Attack speed",
    movementSpeed: "Movement speed",
    animationSpeed: "Other animations",
    language: "Language",
    speeds: { slow: "Slow", normal: "Normal", fast: "Fast", veryFast: "Very fast" } satisfies Record<AnimationSpeed, string>,
  },
  rules: {
    title: "Rules",
    sections: [
      {
        heading: "Goal",
        text: "Destroy the enemy fleet. Whoever has no combat ship left on the board after a round loses — support ships don't count. If it hits both sides, the match is a draw.",
      },
      {
        heading: "Your turn",
        text: "Each round, pick up to one ship and one command from your hand, then end your turn. Your opponent does the same at the same time without seeing your choice. There are no costs and no time limit. A command may also target the ship you deploy this round, for example to overcharge it or move it straight to the other lane. On top of that, you may maneuver one of your ships already on the board to a free slot in the other lane — tap it, then the slot. The price: that ship doesn't fire this round. A command on it follows it to its new slot.",
      },
      {
        heading: "The board",
        text: "Each side has two lanes: Strike in front, Command behind. A lane holds at most 4 ships, a side at most 8. A ship in the Command lane is covered as long as a ship stands in the Strike slot directly in front of it; otherwise it can be attacked. Ships change lanes through the maneuver of your turn or through commands like Flanking Maneuver, Intercept and Recall; these don't cost the ship its attack. Either way you pick any free slot in the other lane. Maneuver and command can't move the same ship or land on the same slot, and a slot vacated this round only frees up next round. Moving has a risk: Barrage hits every enemy ship that changed lanes this round.",
      },
      {
        heading: "Resolution",
        text: "Once both have ended their turn, the moves are revealed and resolved in phases: Deploy (ships enter the board), Maneuvers (ships switch lanes), Effects (commands take effect, attacks last: a Torpedo aims at a slot, not a ship, and hits whoever stands there after all moves — even a covered ship — or fizzles in the empty slot), Combat (all ships fire at once, no shot goes at an already destroyed target), Cleanup (round effects expire, Repair Drones repair). Then everyone draws a ship and a command (up to 6 cards per hand).",
      },
      {
        heading: "Ships",
        text: "Ships have hull (HP), attack (ATK) and shield; damage hits the shield first. Fighters attack the ship with the least HP, battleships the one with the highest ATK, cruisers the ship opposite them. Support ships never attack.",
      },
    ],
  },
  dialog: {
    close: "Close",
  },
  loading: {
    assets: (percent: number) => `Loading assets … ${percent} %`,
    failed: "Loading failed — reload the page.",
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
    chooseEnemySlot: (command: string) =>
      `${command}: tap a slot on the enemy side, even an empty one — it hits whichever ship stands there after all moves. Click the card again to take it back.`,
    chooseDestination: (command: string, ship: string) =>
      `${command}: tap a glowing slot for ${ship}. Click the card again to take it back.`,
    chooseManeuver: (ship: string) => `Maneuver: tap a glowing slot for ${ship}; it won't fire this round. Tap the ship again or press Esc to cancel.`,
    maneuver: (ship: string) => `maneuver of ${ship}`,
    planned: (cards: string) => `${cards} ready. Click “End turn”, or tap a card or the maneuvering ship to take it back.`,
    idle: "Tap a ship or command card, or one of your ships on the board to maneuver it. Click “End turn” without a card to pass.",
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
    maneuver: (who: string, ship: string, slot: string) => `Maneuver: ${who} — ${ship} moves to ${slot} and holds fire this round`,
    command: (who: string, command: string) => `Command: ${who} — ${command}`,
    commandOn: (who: string, command: string, slot: string) => `Command: ${who} — ${command} on ${slot}`,
    damage: (command: string, ship: string, amount: number) => `Effect: ${command} hits ${ship} for ${amount}`,
    attackBonus: (command: string, ship: string, delta: number) =>
      `Effect: ${command} — ${ship} ${delta > 0 ? "+" : ""}${delta} ATK this round`,
    shield: (command: string, ship: string, amount: number) => `Effect: ${command} — ${ship} +${amount} shield this round`,
    disable: (command: string, ship: string) => `Effect: ${command} — ${ship} cannot attack this round`,
    heal: (command: string, ship: string, amount: number) => `Effect: ${command} heals ${ship} for ${amount}`,
    move: (command: string, ship: string, slot: string) => `Effect: ${command} — ${ship} moves to ${slot}`,
    repair: (source: string, ship: string, amount: number) => `Cleanup: ${source} repairs ${ship} for ${amount}`,
    draw: (command: string, who: string, ships: number, commands: number) =>
      `Effect: ${command} — ${who} +${ships} ship, +${commands} command`,
    noEffect: (command: string, who: string) => `Effect: ${command} (${who}) has no effect`,
    miss: (command: string, slot: string) => `Effect: ${command} fizzles in ${slot}`,
    attack: (attacker: string, target: string, amount: number) => `Combat: ${attacker} fires at ${target} (${amount})`,
    selfDamage: (ship: string, amount: number) => `Cleanup: ${ship} takes ${amount} self-damage`,
    destroyed: (ship: string) => `Destroyed: ${ship}`,
  },
  banner: {
    command: (who: string, command: string) => `${who}: ${command}`,
    noEffect: "no effect",
    miss: (slot: string) => `fizzles in ${slot}`,
    draw: (ships: number, commands: number) => `+${ships} ship, +${commands} command`,
  },
  float: {
    damage: (amount: number) => `−${amount}`,
    heal: (amount: number) => `+${amount} HP`,
    shield: (amount: number) => `+${amount} Shield`,
    attack: (delta: number) => `${delta > 0 ? "+" : "−"}${Math.abs(delta)} ATK`,
    disabled: "Disabled",
    holdFire: "Holds fire",
    miss: "Miss",
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
    target_not_enemy_slot: "The command target isn't a slot on the enemy side.",
    destination_required: "This command needs a slot to move the ship to.",
    destination_not_allowed: "This command doesn't move a ship.",
    destination_unavailable: "The ship can't move to this slot.",
    maneuver_not_own_ship: "Only one of your ships already on the board can maneuver.",
    maneuver_destination_unavailable: "The ship can't maneuver to this slot.",
    maneuver_conflict: "A command can't move the ship that maneuvers this round.",
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
    auto_moved: "Moved Enemies",
    all_friendly_strike: "All Allies",
    all_enemy_strike: "All Enemies",
    choose_friendly: "Choose Ally",
    choose_enemy: "Choose Enemy",
    choose_enemy_slot: "Choose Enemy Slot",
  } satisfies Record<TargetMode, string>,
  ships: {
    horizon_cruiser: { name: "Horizon Cruiser", effect: "Solid stats, reliable." },
    iron_dreadnought: { name: "Iron Dreadnought", effect: "Shield 2: Absorbs the first 2 damage each round." },
    plasma_frigate: { name: "Plasma Frigate", effect: "On Deploy: Deal 1 damage to a random enemy ship in the same lane." },
    repair_drone: { name: "Repair Drone", effect: "End of each round: Repairs 2 HP on the damaged allied combat ship with the lowest HP." },
    scrap_raider: { name: "Scrap Raider", effect: "When an enemy ship in the same lane is destroyed: +1 ATK permanently." },
    signal_booster: { name: "Signal Booster", effect: "All other allied ships in the same lane have +1 ATK, as long as the Signal Booster is there." },
    titan_carrier: { name: "Titan Carrier", effect: "On Deploy: Spawn a Drone (1 HP, 1 ATK) in the same lane." },
    void_interceptor: { name: "Void Interceptor", effect: "Pure damage, no tricks." },
  } satisfies Record<ShipId, CardText>,
  commands: {
    emergency_shields: { name: "Emergency Shields", effect: "Chosen allied ship gains Shield 3 this round." },
    emp_blast: { name: "EMP Blast", effect: "The enemy ship with the highest ATK cannot attack this round." },
    flanking_maneuver: { name: "Flanking Maneuver", effect: "Chosen allied ship switches lanes (Strike ↔ Command) to a free slot of your choice." },
    intercept: { name: "Intercept", effect: "Pull a chosen Command Line ship into a free Strike Line slot of your choice. +2 ATK this round." },
    orbital_strike: { name: "Orbital Strike", effect: "Deal 4 damage to the enemy ship with the highest HP." },
    overcharge: { name: "Overcharge", effect: "Chosen ship gets +3 ATK this round. Takes 2 self-damage after combat." },
    power_surge: { name: "Power Surge", effect: "All allied ships in the Strike Line gain +1 ATK this round." },
    recall: { name: "Recall", effect: "A chosen Strike Line ship retreats to a free Command Line slot of your choice. Heal 2 HP." },
    scavenge: { name: "Scavenge", effect: "Draw 1 extra ship and 1 extra command." },
    sensor_sweep: { name: "Sensor Sweep", effect: "Reveal all cards in the enemy hand for the next round." },
    targeting_jammer: { name: "Targeting Jammer", effect: "All enemy ships in the Strike Line get -1 ATK this round (min 0)." },
    volley_fire: { name: "Volley Fire", effect: "Deal 1 damage to ALL enemy ships." },
    torpedo: { name: "Torpedo", effect: "Choose an enemy slot. After all moves, deal 5 damage to the ship there, even if covered. An empty slot: miss." },
    barrage: { name: "Barrage", effect: "Deal 3 damage to every enemy ship that changed lanes this round." },
  } satisfies Record<CommandId, CardText>,
};

export type Messages = typeof en;
