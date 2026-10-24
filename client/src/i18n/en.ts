// Englisch ist die Ausgangssprache: Diese Datei legt Schlüssel und Parameter
// fest, jede weitere Sprache muss `Messages` vollständig erfüllen.

import type { LaneType, Side } from "../../../shared/board.ts";
import type { CommandId, CommandType, ShipClass, ShipId, TargetMode } from "../../../shared/cards.ts";
import type { ErrorCode, MatchResult } from "../../../shared/protocol.ts";
import type { AnimationSpeed } from "../settings.ts";

export interface CardText {
  name: string;
  effect: string;
}

/** Ein Kapitel der Spielregeln; `caption` beschriftet die Illustration des Kapitels. */
export interface RulesSection {
  heading: string;
  paragraphs: readonly string[];
  caption?: string;
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
    overdrive: (bonus: number) => `Overdrive +${bonus}`,
    overdriveHint: (bonus: number) => `Overdrive: all combat ships +${bonus} ATK`,
    checklist: {
      ships: (planned: number, max: number) => (max > 1 ? `Deploy ships (${planned}/${max})` : "Deploy a ship"),
      command: "Play a command",
      maneuver: "Maneuver a ship",
    },
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
    /** Kapitel in der Reihenfolge der Navigation; die Illustrationen hängt `rulesDialog.ts` nach Id an. */
    sections: {
      goal: {
        heading: "Goal of the game",
        paragraphs: [
          "Voidfleet is a duel between two fleets. You win by destroying every combat ship your opponent has: whoever ends a round with no combat ship left — neither on the board nor in hand — loses. Support ships (Repair Drone, Signal Booster) don't count; a fleet of nothing but support ships is beaten.",
          "The check happens at the very end of a round, after both players have drawn new cards. So a player whose last ship has just been destroyed stays in the game as long as they still hold a combat ship to deploy. If both fleets are beaten in the same round, the match is a draw.",
          "Both players plan their moves at the same time, without seeing each other's choice, and there is no time limit: a turn may take as long as you like. There is no energy or mana — every card in your hand is playable right away.",
          "So that no match drags on forever, Overdrive kicks in from round 8: every combat ship on both sides gets +1 ATK, and the bonus grows by one every 4 rounds (round 12, 16, …). Repairs can't keep up with that forever.",
        ],
        caption: "Overdrive adds attack to every combat ship on both sides, the longer the match lasts.",
      },
      turn: {
        heading: "Your turn",
        paragraphs: [
          "Each round you plan up to three things and then click “End turn”: one ship from your hand onto a free slot of your side, one command from your hand, and one maneuver of a ship already on the board to another free slot. All three are optional — you may also pass with an empty turn.",
          "In round 1 you set up your fleet: up to two ships instead of one, plus a command. From round 2 on it's one ship per round.",
          "A command may target a ship you deploy in the same turn, for example to overcharge it or shield it immediately. Planned ships appear on the board as translucent ghosts; a command on a ghost is resolved as if the ship already stood there.",
          "Nothing is final until you end your turn: click a selected card, a ghost ship or the maneuvering ship to take it back. Your opponent only ever sees your turn once both have submitted.",
        ],
        caption: "Placing a ship: tap the card, then one of the glowing slots on your side.",
      },
      board: {
        heading: "The board",
        paragraphs: [
          "Each side has two lanes with 6 slots each: the Strike lane in front, facing the enemy, and the Command lane behind it. A lane holds at most 4 ships and a side at most 6, so at least two slots per lane stay empty.",
          "The Command lane offers cover: a ship there is covered as long as a ship stands in the Strike slot directly in front of it (same slot number). Covered ships can't be targeted by regular fire. Without a ship in front, a Command ship is just as exposed as one in the Strike lane.",
          "Cover is decided once at the start of combat and lasts for the whole combat: if the covering ship is destroyed by a shot of the same combat, the ship behind it stays covered until next round. Damage from commands ignores cover: Orbital Strike, Volley Fire, Torpedo and Barrage hit covered ships too.",
          "Ships in either lane fire with full strength; the lane only matters for cover, for lane-specific commands (Power Surge, Targeting Jammer, Intercept, Recall) and for the Signal Booster, which boosts the ships in its own lane.",
        ],
        caption: "Each side: Strike in front, Command behind. A Command ship is covered by the Strike slot directly in front of it.",
      },
      movement: {
        heading: "Moving ships",
        paragraphs: [
          "Once per round you may maneuver one of your ships already on the board to any free slot of your side, in the other lane or the same one: tap the ship, then a glowing slot. Within the lane that is how you tuck a Repair Drone in behind a Strike ship, for example. The price: a maneuvering ship doesn't fire this round. It can still be shot at and still covers or is covered from its new position, and a command played on it follows it to the new slot.",
          "Commands move ships as well: Flanking Maneuver switches a ship to the other lane, Intercept pulls a Command ship forward into the Strike lane with +2 ATK, Recall retreats a Strike ship into the Command lane and repairs 2 HP. Ships moved by a command keep firing.",
          "Commands always move to the other lane. Maneuver and movement command can't move the same ship and can't land on the same slot. The slot a ship leaves stays blocked for the rest of the round — it only frees up next round, also for ships you deploy. Deployed ships and both destinations together count toward the limit of 4 ships per lane.",
          "Moving carries a risk: Barrage deals 3 damage to every enemy ship that changed slots this round, no matter how. And a Torpedo targets a slot, not a ship: it hits whoever stands there after all moves, so dodging it — or walking into it — is part of the game.",
        ],
        caption: "A planned maneuver: the Scrap Raider will retreat from the Strike lane into the Command lane and hold fire this round. A maneuver may also stay within the lane.",
      },
      resolution: {
        heading: "Resolving a round",
        paragraphs: [
          "Once both players have ended their turn, both turns are revealed and resolved in fixed phases. Within a phase both sides act at the same time; no side ever goes first.",
        ],
        caption: "Commands in the Effects phase run by type, not by player: repositioning first, then tactics, buffs, special effects, debuffs, and damage last.",
      },
      combat: {
        heading: "Combat",
        paragraphs: [
          "Every ship with attack above 0 fires once per round, unless it maneuvered this round or was disabled by EMP Blast. Ships pick their targets automatically by class among the exposed enemy ships: Fighters shoot the ship with the fewest HP, Battleships the ship with the highest ATK, Cruisers the ship opposite them (same slot number, otherwise the nearest). On a tie, the ship with the lower slot number is hit.",
          "All shots are simultaneous: a ship destroyed in this combat still fires. The ships of one side take aim one after the other in slot order (Strike before Command) and skip targets that their own earlier shots have already destroyed, so no shot is wasted. If no target is left, the remaining shots of that side fizzle.",
          "Damage goes to the shield first and only then to the hull. A ship's own shield (Iron Dreadnought: 2) doesn't regenerate; the extra shield from Emergency Shields lasts for the round only. A ship with 0 HP is destroyed and removed — after the Effects phase, after combat, and after self-damage in Cleanup.",
          "The attack value shown on the board already includes everything: round bonuses from commands, the Signal Booster aura and Overdrive. Support ships never attack, no matter the bonus.",
        ],
        caption: "Targeting by class: Fighters pick the lowest HP, Battleships the highest ATK, Cruisers the ship opposite them.",
      },
      ships: {
        heading: "Ships",
        paragraphs: [
          "Ships have hull points (HP), attack (ATK) and sometimes a shield. There are four classes; the class decides how the ship picks its target in combat. Your ship deck holds two copies of each ship.",
          "Still in the works: the abilities of Plasma Frigate, Scrap Raider and Titan Carrier printed on their cards are not active yet.",
        ],
      },
      commands: {
        heading: "Commands",
        paragraphs: [
          "Commands are played once and resolved in the Effects phase, before combat. Some pick a target when you plan them (one of your ships, or a slot on the enemy side for the Torpedo), the others choose their target automatically. Round effects like ATK bonuses, extra shield and EMP end in Cleanup.",
          "Commands resolve by type, in this order. Your command deck holds one copy of each, except Torpedo and Barrage with two.",
        ],
      },
      hand: {
        heading: "Hand and decks",
        paragraphs: [
          "You start with 4 ships — always 1 support ship and 3 combat ships — and 3 commands. At the end of every round you draw 1 ship and 1 command. Each hand holds at most 6 cards: with a full hand you draw nothing, so play your cards. Scavenge draws 1 extra ship and 1 extra command right away, again within the hand limit.",
          "Your ship deck has 16 cards (each ship twice), your command deck 16 cards too (Torpedo and Barrage twice, every other command once). When a deck is empty, you simply draw nothing from it.",
        ],
      },
      controls: {
        heading: "Controls",
        paragraphs: [
          "Tap a card in your hand, then a glowing slot or ship on the board; the status line at the top tells you what the selected card needs. Tapping the card again takes it back, as does tapping a ghost ship. To maneuver, tap one of your ships on the board without a card selected, then the destination slot; tap the ship again or press Escape to cancel.",
          "“End turn” submits your plan. While the round is resolved you can skip the animation; the log button at the top right lists every event of the match. Scroll to zoom the board and drag to pan while zoomed in. Sound, animation speed and language live in the settings next to this dialog; the flag next to it surrenders the match after a confirmation, and your opponent wins immediately.",
        ],
      },
    } satisfies Record<string, RulesSection>,
    phases: {
      deploy: { name: "Deploy", text: "Both players' new ships land on their slots." },
      maneuver: { name: "Maneuvers", text: "Maneuvering ships switch slots and hold fire." },
      effects: { name: "Effects", text: "Commands take effect, by type; damage last. Destroyed ships are removed." },
      combat: { name: "Combat", text: "All ships fire at once at exposed targets; destroyed ships are removed." },
      cleanup: { name: "Cleanup", text: "Self-damage from Overcharge, Repair Drones repair, round effects expire." },
      draw: { name: "Draw", text: "Everyone draws a ship and a command (hand limit 6)." },
      check: { name: "Check", text: "A player without combat ships on board and in hand loses." },
    },
    figures: {
      you: "You",
      enemy: "Enemy",
      slot: (index: number) => `Slot ${index}`,
      covered: "covered",
      exposed: "exposed",
      laneLimit: "max. 4 ships per lane, 6 per side",
      lowestHp: "fewest HP",
      highestAtk: "highest ATK",
      opposite: "same slot",
      stat: (hp: number, atk: number) => `${hp} HP · ${atk} ATK`,
      round: (round: number) => `Round ${round}`,
      overdrive: (bonus: number) => (bonus === 0 ? "no Overdrive" : `+${bonus} ATK`),
      rounds: (from: number, to: number | null) => (to === null ? `from round ${from}` : `rounds ${from}–${to}`),
      maneuver: "Maneuver",
      turnParts: ["1 ship", "1 command", "1 maneuver"],
      roundOne: "Round 1: 2 ships",
    },
    classes: {
      fighter: "fires at the exposed enemy ship with the fewest HP.",
      cruiser: "fires at the exposed enemy ship in the same slot number, otherwise the nearest one.",
      battleship: "fires at the exposed enemy ship with the highest ATK.",
      support: "never attacks (0 ATK) and doesn't count as a combat ship.",
    } satisfies Record<ShipClass, string>,
    commandTypes: {
      reposition: "Repositioning",
      tactic: "Tactics",
      buff: "Buffs",
      special: "Special",
      debuff: "Debuffs",
      attack: "Attacks",
    } satisfies Record<CommandType, string>,
    copies: (count: number) => `${count}× in deck`,
  },
  dialog: {
    close: "Close",
  },
  surrender: {
    title: "Surrender",
    question: "Give up this match? Your opponent wins immediately.",
    confirm: "Surrender",
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
      `no free slot for ${ship} (max. ${perLane} per lane, ${perSide} per side, planned ships included).`,
    deploysLeft: (count: number) => (count === 0 ? "all ships planned" : `${count} ${count === 1 ? "ship" : "ships"} left to deploy`),
    placeShip: (ship: string) => `${ship}: tap a glowing slot. Click the card again to take it back.`,
    noCommandTarget: (command: string) => `no own ship to target with ${command}.`,
    chooseCommandTarget: (command: string) => `${command}: tap one of your ships. Click the card again to take it back.`,
    chooseEnemySlot: (command: string) =>
      `${command}: tap a slot on the enemy side, even an empty one — it hits whichever ship stands there after all moves. Click the card again to take it back.`,
    chooseDestination: (command: string, ship: string) =>
      `${command}: tap a glowing slot for ${ship}. Click the card again to take it back.`,
    chooseManeuver: (ship: string) => `Maneuver: tap a glowing slot for ${ship}; it won't fire this round. Tap the ship again or press Esc to cancel.`,
    maneuver: (ship: string) => `maneuver of ${ship}`,
    planned: (cards: string) => `${cards} ready. Click “End turn”, or tap a card, a ghost ship or the maneuvering ship to take it back.`,
    idle: "Tap a ship or command card, or one of your ships on the board to maneuver it. Click “End turn” without a card to pass.",
    resolving: "Both turns are revealed — resolving the round …",
    matchOver: "The match is over.",
  },
  result: {
    won: { title: "Victory", subtitle: "The enemy fleet is destroyed." },
    lost: { title: "Defeat", subtitle: "Your fleet is destroyed." },
    draw: { title: "Draw", subtitle: "Both fleets are destroyed." },
    surrendered: { won: "The opponent has surrendered.", lost: "You surrendered." } satisfies Record<Exclude<MatchResult, "draw">, string>,
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
    too_many_ships: "You can't deploy that many ships this round.",
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
    iron_dreadnought: { name: "Iron Dreadnought", effect: "Shield 2: Absorbs the first 2 damage before the hull." },
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
    targeting_jammer: { name: "Targeting Jammer", effect: "All enemy ships in the Strike Line get -1 ATK this round (min 0)." },
    volley_fire: { name: "Volley Fire", effect: "Deal 1 damage to ALL enemy ships." },
    torpedo: { name: "Torpedo", effect: "Choose an enemy slot. After all moves, deal 5 damage to the ship there, even if covered. An empty slot: miss." },
    barrage: { name: "Barrage", effect: "Deal 3 damage to every enemy ship that changed slots this round." },
  } satisfies Record<CommandId, CardText>,
};

export type Messages = typeof en;
