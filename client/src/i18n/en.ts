// Englisch ist die Ausgangssprache: Diese Datei legt Schlüssel und Parameter
// fest, jede weitere Sprache muss `Messages` vollständig erfüllen.

import { ABILITY_VALUES, type AdmiralId, type PowerId, type PowerTarget } from "../../../shared/admirals.ts";
import type { LaneType, Side } from "../../../shared/board.ts";
import { type CommandId, type CommandType, type ShipClass, type ShipId, shipById, type TargetMode } from "../../../shared/cards.ts";
import type { ErrorCode, MatchResult } from "../../../shared/protocol.ts";
import type { AnimationSpeed } from "../settings.ts";
import type { CursorId } from "../ui/cursor.ts";

export interface CardText {
  name: string;
  effect: string;
  /** Statt der Zielart (`targets`), wenn der Befehl nur bestimmte Schiffe zum Ziel haben darf. */
  target?: string;
}

/** Name und Beiname eines Admirals und der Name der Fähigkeit seines Flaggschiffs; deren Text steht beim Schiff (`ships`). */
export interface AdmiralText {
  name: string;
  epithet: string;
  ability: string;
}

const { guardianShield, guardianShieldFront, spearhead, maxDrones, hiveBudget, railgun, counterfire, focusFire, swarmStrike } = ABILITY_VALUES;
/** HP und ATK eines Flaggschiffs aus den Kartendaten, für die Regeln. */
const stats = (id: ShipId) => `${shipById(id).hp} HP, ${shipById(id).atk} ATK`;

/** Ein Kapitel der Spielregeln; `caption` beschriftet die Illustration des Kapitels. */
export interface RulesSection {
  heading: string;
  paragraphs: readonly string[];
  caption?: string;
}

/**
 * Funksprüche des Bordfunks (`audio/radio.ts`): je Spruch der gesprochene Text seiner Varianten. Die Aufnahmen sind
 * englisch, `tools/generateAudio.ts` liest ihre Texte von hier; andere Sprachen übersetzen nur den Untertitel.
 */
const radioLines = {
  battle_start: ["All ships at battle stations. Awaiting your orders, Admiral.", "Fleet in position. Ready when you are, Admiral."],
  orders_sent: ["Orders confirmed. Executing.", "Copy that, Admiral.", "Understood. All ships, execute."],
  enemy_ready: ["The enemy fleet has locked in their moves.", "The enemy is ready, Admiral. Your call."],
  overdrive: ["Reactors at overdrive. All weapons free!", "Overdrive engaged! Every gun at full power!"],
  overdrive_up: ["Overdrive rising! The reactors are running hot!", "Pushing the reactors further. Expect heavier fire!"],
  last_ship: ["That's our last warship, Admiral!", "We're down to our last warship!"],
  victory: ["Enemy fleet destroyed. The sector is ours, Admiral!", "That's the last of them. Victory, Admiral!"],
  defeat: ["We've lost the fleet. All hands, abandon ship.", "Our fleet is gone. All survivors, fall back."],
  draw: ["Both fleets are gone. No one wins today."],
  enemy_surrender: ["The enemy is withdrawing. They've surrendered!"],
  retreat: ["Signal the retreat. All ships, disengage."],
  torpedo_away: ["Torpedo away!", "Fish in the water!"],
  torpedo_hit: ["Direct hit!", "Torpedo impact confirmed!"],
  torpedo_missed: ["Torpedo missed! They moved out of the way.", "No impact. The target slipped away."],
  torpedo_incoming: ["Incoming torpedo!", "Torpedo inbound! Brace for impact!"],
  torpedo_dodged: ["Their torpedo missed!", "Torpedo went wide. Nice flying!"],
  barrage_hit: ["Caught them moving!", "Barrage on target! They flew right into it!"],
  barrage_missed: ["Barrage hit nothing. They held their ground."],
  barrage_caught: ["Barrage! We flew right into it!", "They were waiting for us to move!"],
  orbital_strike: ["Orbital strike inbound on target!"],
  orbital_incoming: ["Orbital strike incoming! Brace!"],
  volley: ["All batteries, fire!"],
  volley_incoming: ["Missiles incoming!"],
  emp_hit: ["EMP hit! Their weapons are down."],
  emp_incoming: ["EMP! Our weapons are offline!"],
  jammer: ["Jamming their targeting systems."],
  jammed: ["They're jamming our targeting!"],
  shields_up: ["Shields up!", "Diverting power to shields!"],
  overcharge: ["Overcharging weapons. She won't hold together for long!"],
  power_surge: ["Power surge to the strike line!"],
  scavenge: ["Salvage teams report new supplies."],
  intercept: ["Moving to intercept!"],
  recall: ["Pull her back and patch her up!"],
  flanking: ["Flanking maneuver, go!"],
  drone_launch: ["Drone away!"],
  frigate_fire: ["Frigate firing on arrival!"],
  repair: ["Repair drones at work."],
  scrap: ["The raider is stripping the wreckage!"],
  enemy_destroyed: ["Enemy ship destroyed!", "Target down!", "Splash one!", "Kill confirmed!"],
  ship_lost: ["We lost a ship!", "Ship down! Ship down!", "We've lost one of ours!"],
  hull_critical: ["Hull integrity critical!", "She's badly hurt, Admiral!"],
} as const;

export type RadioCue = keyof typeof radioLines;
/** Ein Tupel gleicher Länge mit beliebigen Texten. */
type Translated<Lines> = { readonly [Variant in keyof Lines]: string };
/** Je Funkspruch so viele Untertitel wie Aufnahmen, in der Sprache des Spielers. */
export type RadioLines = { [Cue in RadioCue]: Translated<(typeof radioLines)[Cue]> };

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
      flagship: "Deploy your flagship",
      ships: (planned: number, max: number) => (max > 1 ? `Deploy ships (${planned}/${max})` : "Deploy a ship"),
      command: "Play a command",
      maneuver: "Maneuver or ability",
      /** Freie Hand: Grundmanöver und Fähigkeit getrennt. */
      maneuverOnly: "Maneuver",
      power: "Admiral ability",
      fire: (assigned: number, shooters: number) => (shooters > 0 ? `Assign targets (${assigned}/${shooters})` : "Assign targets"),
      mark: "Target lock",
    },
    /** Die Fähigkeitskarte neben den Befehlen. */
    power: "Admiral ability",
    powerHint: "instead of the maneuver",
    /** Der Knopf der Pendulum über der Fähigkeitskarte und was er in der Feuerrunde zeigt. */
    markButton: "Target lock",
    markHint: "Pendulum: lock onto an enemy ship. Next round the railgun hits it at the start of combat, if it's exposed.",
    marked: (ship: string) => `Locked: ${ship}`,
    railgun: (ship: string) => `Railgun → ${ship}`,
    railgunHint: (amount: number) => `The railgun hits the locked ship for ${amount} at the start of combat, if it's exposed.`,
    shotLost: "The Pendulum moves — the shot is lost.",
    lockLost: "The Pendulum moves — the lock is lost.",
    underFire: (ship: string) => `Enemy railgun on ${ship}`,
  },
  admiralSelect: {
    title: "Choose your admiral",
    hint: "Your choice stays hidden until both have chosen. The admiral ability replaces the maneuver, every round. If your flagship falls, you lose.",
    flagship: "Flagship",
    power: "Admiral ability",
    choose: "Choose",
  },
  draft: {
    title: "Supplies",
    hint: "Take one ship and one command into your hand; the rest goes back into the deck.",
    ships: "Ships",
    commands: "Commands",
    none: "Nothing to choose — hand full or deck empty.",
    confirm: "Take",
    peek: "View battlefield",
    show: "Show supplies",
  },
  settings: {
    title: "Settings",
    musicVolume: "Music",
    effectsVolume: "Sound effects",
    voiceVolume: "Radio chatter",
    attackSpeed: "Attack speed",
    movementSpeed: "Movement speed",
    animationSpeed: "Other animations",
    language: "Language",
    install: "App",
    installButton: "Install Voidfleet as an app",
    speeds: { slow: "Slow", normal: "Normal", fast: "Fast", veryFast: "Very fast" } satisfies Record<AnimationSpeed, string>,
    cursor: "Mouse pointer",
    cursors: {
      arrow: "Toon arrow",
      fighter: "Fighter",
      delta: "Delta glider",
      flagship: "Flagship",
      needle: "Navigation needle",
      shard: "Crystal shard",
      formation: "Formation",
      holo: "Holo arrow",
      thruster: "Thruster",
      crosshair: "Crosshair",
    } satisfies Record<CursorId, string>,
  },
  rules: {
    title: "Rules",
    /** Kapitel in der Reihenfolge der Navigation; die Illustrationen hängt `rulesDialog.ts` nach Id an. */
    sections: {
      goal: {
        heading: "Goal of the game",
        paragraphs: [
          "Voidfleet is a duel between two fleets, each led by an admiral and their flagship. You win by destroying the enemy flagship: whoever loses their flagship loses the match on the spot, and the rest of the round is skipped. If both flagships fall at the same time, for example in the same combat, the match is a draw.",
          "Before round 1 each player secretly picks one of five admirals. The admiral brings a flagship — a ship outside the decks with an ability of its own — and an admiral ability you can use every round instead of the maneuver (see “Admirals and flagships”).",
          "Both players plan their moves at the same time, without seeing each other's choice, and there is no time limit: a turn may take as long as you like. There is no energy or mana — every card in your hand is playable right away.",
          "So that no match drags on forever, Overdrive kicks in from round 8: every combat ship on both sides gets +1 ATK, and the bonus grows by one every 4 rounds (round 12, 16, …). Repairs can't keep up with that forever.",
        ],
        caption: "Overdrive adds attack to every combat ship on both sides, the longer the match lasts.",
      },
      turn: {
        heading: "Your turn",
        paragraphs: [
          "Each round you plan up to three things and then click “End turn”: one ship from your hand onto a free slot of your side, one command from your hand, and either one maneuver of a ship already on the board to another free slot or your admiral ability. All three are optional — you may also pass with an empty turn. On top of that you give your combat ships their fire orders: the enemy ship each of them fires at in combat (see “Combat”). Admiral Kerr may also lock a target with the Pendulum.",
          "In round 1 you set up your fleet: your flagship, plus up to two ships instead of one, plus a command. The flagship is mandatory — “End turn” only works once it is planned. From round 2 on it's one ship per round. Two commands change the turn itself while they are planned: Rapid Deployment lets you deploy one extra ship, Carte Blanche gives you the maneuver and your admiral ability together. Take the command back and the extra ship or the ability drops out again.",
          "A command may target a ship you deploy in the same turn — your flagship too —, for example to overcharge it or shield it immediately. Planned ships appear on the board as translucent ghosts; a command on a ghost is resolved as if the ship already stood there, and a ghost can get a fire order too.",
          "Nothing is final until you end your turn: everything you planned can be taken back or changed (see “Controls”). Your opponent only ever sees your turn once both have submitted.",
        ],
        caption: "Placing a ship: tap the card, then one of the glowing slots on your side.",
      },
      admirals: {
        heading: "Admirals and flagships",
        paragraphs: [
          "Before round 1 both players choose their admiral at the same time and in secret; you only learn your opponent's choice once both have picked, and then round 1 begins. Each admiral stands for a style of play and brings a flagship and an admiral ability.",
          "The flagship isn't part of any deck. In round 1 you deploy it in addition to your up to two ships, following the normal placement rules; it counts toward the lane and fleet limit. Otherwise it is a regular combat ship: it fires at the target you give it, maneuvers and can receive your commands. If it is destroyed, you lose. On the board flagships stand out: a little bigger, with a ring in their admiral's color beneath them and a crown next to the hull bar.",
          "The admiral ability is available every round, but it takes the place of the maneuver: each turn you either maneuver a ship or use the ability, never both — planning one drops the other. Only the command Carte Blanche allows both in the same turn. Tap the ability card next to your commands, then one of the glowing targets; tap the card again or press Escape to take it back. Abilities are revealed right after the deploys. Their mark follows a ship that moves; an ability on one of your ships may also target a ship you deploy this turn.",
        ],
      },
      roster: {
        heading: "The five admirals",
        paragraphs: [
          `Admiral Osei, The Wall, commands the Bastion (Battleship, ${stats("bastion")}). Guardian Shield: after the maneuvers, the Bastion gains +${guardianShield} shield for the round, the ship in the Strike slot directly in front of her +${guardianShieldFront}. Counterfire: choose one of your ships; every enemy ship except a flagship that hits it in combat takes ${counterfire} damage per hit afterwards.`,
          `Admiral Vance, The Hammer, commands the Vanguard (Cruiser, ${stats("vanguard")}). Spearhead: the combat ship in the Strike slot directly in front of her has +${spearhead} ATK. Focus Fire: choose an enemy ship, even a covered one; this round every hit on it in combat deals +${focusFire} damage. It doesn't steer any shot — your fire orders decide who fires at it.`,
          `Admiral Halvorsen, The Swarm, commands the Hive (Battleship, ${stats("hive")}). Brood Chamber: at the end of every round the Hive launches a Drone into the nearest free Strike slot — at most ${maxDrones} of your Drones at a time and ${hiveBudget} per match. Swarm Strike needs one of your Drones on the board: choose an enemy ship other than the flagship, covered or not; all your Drones fire at it instead of their own targets — through cover, without fire orders, even those launched this round —, each hit dealing +${swarmStrike} damage.`,
          `Admiral Moreau, The Phantom, commands the Mirage (Fighter, ${stats("mirage")}). Phase Shift: the Mirage's maneuver may also target one of your occupied slots — then both ships swap places and both still fire. Decoy: choose a free Strike slot of yours; a Decoy (1 HP) stands there for this round. It never attacks and covers the Command slot behind it: shots at the ship there hit the Decoy — and once it is destroyed, they fizzle. Flagships see through it: it doesn't cover against them. At the end of the round it dissolves.`,
          `Admiral Kerr, The Clockmaker, commands the Pendulum (Battleship, ${stats("pendulum")}). Railgun: in a round in which her railgun doesn't fire, Kerr may lock onto an enemy ship. Next round the railgun hits it for ${railgun} at the start of combat if it is exposed; if it is covered, the shot is blocked. If the Pendulum moves in either round, the shot is lost. Locked ships carry a crosshair on both sides of the board. Head Start: choose one of your combat ships; it fires before everyone else, and whatever it destroys no longer fires.`,
        ],
        caption: "The admirals with their flagship, its ability and the admiral ability.",
      },
      board: {
        heading: "The board",
        paragraphs: [
          "Each side has two lanes with 6 slots each: the Strike lane in front, facing the enemy, and the Command lane behind it. A lane holds at most 4 ships and a side at most 6 (Drones count toward neither), so at least two slots per lane stay empty.",
          "The Command lane offers cover: a ship there is covered as long as a ship stands in the Strike slot directly in front of it (same slot number). A shot at a covered ship hits the ship in front of it instead. Without a ship in front, a Command ship is just as exposed as one in the Strike lane.",
          "Cover is decided once at the start of combat and lasts for the whole combat: if the covering ship is destroyed by a shot of the same combat, the ship behind it stays covered until next round — further shots at it fizzle. Damage from commands ignores cover: Orbital Strike, Torpedo, Heat Seeker, Bombardment and every other damaging command hit covered ships too. Only Collision Course needs an exposed ship opposite.",
          "Ships in either lane fire with full strength; the lane only matters for cover, for lane-specific commands (Power Surge, Targeting Jammer, Intercept, Recall, Collision Course, Bombardment) and for the Signal Booster, which boosts the ships in its own lane.",
        ],
        caption: "Each side: Strike in front, Command behind. A Command ship is covered by the Strike slot directly in front of it.",
      },
      movement: {
        heading: "Moving ships",
        paragraphs: [
          "Once per round — unless you use your admiral ability instead — you may maneuver one of your ships already on the board to any free slot of your side, in the other lane or the same one: tap the ship, then a glowing slot. Within the lane that is how you tuck a Repair Drone in behind a Strike ship, for example. The price: a maneuvering ship doesn't fire this round. It can still be shot at and still covers or is covered from its new position, and a command played on it follows it to the new slot, just like the fire orders aimed at it. Only the Mirage may maneuver onto one of your occupied slots: both ships swap places and keep firing.",
          "Commands move ships as well: Flanking Maneuver switches a ship to the other lane, Intercept pulls a Command ship forward into the Strike lane with +2 ATK, Recall retreats a Strike ship into the Command lane and repairs 2 HP, Evasive Action shifts a ship to a free slot of the same lane with Shield 2. Ships moved by a command keep firing. Micro-Jump takes one of your ships out of the battle after all moves until the end of the round: nothing hits it — shots aimed at it fizzle —, but it neither fires nor covers. Tractor Beam moves an enemy ship instead: after all moves it pulls it into the nearest free slot of its other lane.",
          "Evasive Action stays within the lane, the other movement commands switch to the other lane. Maneuver and movement command can't move the same ship and can't land on the same slot. The slot a ship leaves stays blocked for the rest of the round — it only frees up next round, also for ships you deploy. Deployed ships and both destinations together count toward the limit of 4 ships per lane.",
          "Moving carries a risk: Barrage deals 3 damage to every enemy ship that changed slots this round, no matter how, and Heat Seeker follows its target and hits a ship that changed slots for 5 instead of 3. A Torpedo targets a slot, not a ship — Piercing Shot a slot number: it hits whoever stands there after all moves, so dodging it — or walking into it — is part of the game.",
        ],
        caption:
          "A planned maneuver: the Scrap Raider will retreat from the Strike lane into the Command lane and hold fire this round. A maneuver may also stay within the lane.",
      },
      resolution: {
        heading: "Resolving a round",
        paragraphs: [
          "Once both players have ended their turn, both turns are revealed and resolved in fixed phases. Within a phase both sides act at the same time; no side ever goes first.",
        ],
        caption:
          "Commands in the Effects phase run by type, not by player: repositioning first, then tactics, buffs, special effects, debuffs, and damage last.",
      },
      combat: {
        heading: "Combat",
        paragraphs: [
          "Each round you give your combat ships their fire orders: for every ship with attack above 0 you pick the enemy ship it fires at. Any enemy ship that is on the board while you plan can be picked, covered ones and the enemy flagship included. A ship without a fire order doesn't fire — there is no automatic targeting, and every round starts without fire orders. Ships you deploy this round can get a fire order too; a ship that maneuvers holds fire (the Mirage's Phase Shift is the exception: both ships keep firing), and one disabled by EMP Blast can't fire.",
          "A fire order sticks to both ships: if the shooter or its target moves — by maneuver, command or Tractor Beam —, the shot goes to the target where it stands now, so moving doesn't dodge gunfire. If the target is covered at the start of combat, the ship in front of it takes the shot (flagships see through a Decoy). If the ship that would be hit is already destroyed — by an earlier shot of your own side, say — or has left the board (destroyed before combat, Micro-Jump), the shot fizzles. Nothing prevents overkill: while you plan, the preview shows how much damage each enemy ship takes, so spread your fire.",
          "All shots are simultaneous: a ship destroyed in this combat still fires. Only ships that are on the board while you plan can be targeted, so round 1 has no gunfire, and a ship deployed this round can only be hit as cover or with Draw Fire. Drones launched during the round don't fire before the next one, unless Swarm Strike sends them.",
          "Damage goes to the shield first and only then to the hull. A ship's own shield (Iron Dreadnought: 2) doesn't regenerate; extra shield from commands like Emergency Shields lasts for the round only, except for Ablative Armor, which stays until it is shot away. A ship with 0 HP is destroyed and removed — after the Effects phase, after combat, and after self-damage in Cleanup.",
          "The attack value already includes everything: round bonuses from commands, the Scrap Raider's bonus, the Signal Booster aura, the Vanguard's Spearhead and Overdrive. Support ships never attack, no matter the bonus.",
          `Admirals bend these rules: the Pendulum's railgun fires before anyone else, Head Start lets one ship shoot before the rest, Focus Fire adds +${focusFire} damage to every hit on its target, Swarm Strike sends all your Drones at its target — through cover and without fire orders —, and Counterfire strikes back once all shots are fired. The command Draw Fire pulls the enemy shots onto your chosen ship as long as it stands and is exposed to the shooter; only Swarm Strike and the railgun keep their targets.`,
        ],
        caption:
          "Fire orders: each combat ship fires at the enemy ship you pick. A shot at a covered ship hits the ship in front of it; a shot at a ship that is already destroyed fizzles.",
      },
      ships: {
        heading: "Ships",
        paragraphs: [
          "Ships have hull points (HP), attack (ATK) and sometimes a shield. There are four classes: Fighters, Cruisers and Battleships are combat ships, Support ships never attack (0 ATK). Your ship deck holds two copies of each ship.",
          "Some ships have an ability. On deploy, once both sides have placed their ships: a Titan Carrier launches its Drone into the nearest free slot of its lane (Drones count toward neither the lane nor the fleet limit; there is no Drone only if every slot of the lane is taken), then every Plasma Frigate deals 3 damage to a random enemy ship in the lane of the same name (Strike against Strike, Command against Command), ignoring cover — a fresh Drone can be hit too. A ship destroyed that way neither maneuvers nor receives your command.",
          "The Drone (1 HP, 1 ATK, Fighter) isn't in any deck; it counts as a combat ship, but toward neither the lane nor the fleet limit. Titan Carriers launch it on deploy, Drone Squadron launches two in the Effects phase, the Hive at the end of the round. It only launches if there is room — also for the destinations of your maneuver and movement command this round. A Drone launched during the round only fires from the next round on, with Swarm Strike right away. The Scrap Raider permanently gains +1 ATK whenever an enemy ship in the lane of the same name is destroyed, however it falls; it keeps the bonus when it moves. The Repair Drone repairs in Cleanup, the Signal Booster boosts its lane.",
          "The gallery also shows the five flagships and the Decoy of Admiral Moreau; neither is part of a deck.",
        ],
      },
      commands: {
        heading: "Commands",
        paragraphs: [
          "Commands are played once and resolved in the Effects phase, before combat. Some pick a target when you plan them — one of your ships, an enemy ship (Heat Seeker, Tractor Beam), a slot on the enemy side (Torpedo) or an enemy slot number (Piercing Shot) —, the others choose their target automatically. Round effects like ATK bonuses, extra shield and EMP end in Cleanup.",
          "Commands resolve by type, in this order: repositioning, tactics, buffs, special, debuffs, attacks. Countermeasures (special) makes the opponent's attack or debuff command of the same round fizzle before it acts. Your command deck holds one copy of each, except Torpedo and Barrage with two.",
        ],
      },
      hand: {
        heading: "Hand and decks",
        paragraphs: [
          "You start with 4 ships — always 1 support ship and 3 combat ships — and 3 commands. After every round you get supplies: 3 ships and 3 commands from your decks, of which you take one ship and one command into your hand; the rest is shuffled back into the deck. Only then do you plan your turn. Each hand holds at most 10 cards: a full hand gets no supplies, so play your cards. If one of your Scrap Raiders salvaged scrap in the round and one is still on the board, one of the three commands is Scrap Salvage: you play it like any command, and the chosen Scrap Raider gets +1 ATK permanently. If you don't take it, it's gone. Identical cards form a stack, but each still counts. Scavenge draws 1 extra ship and 1 extra command right away, Countermeasures 1 command if nothing was countered, again within the hand limit.",
          "Your ship deck has 16 cards (each ship twice), your command deck 34 (Torpedo and Barrage twice, every other command once). When a deck runs low, the supplies show only what is left.",
        ],
      },
      controls: {
        heading: "Controls",
        paragraphs: [
          "Tap a card in your hand, then a glowing slot or ship on the board; the status line at the top tells you what the selected card needs. Tapping the card again takes it back. In round 1 your flagship stands at the front of your ship hand with a golden frame. Without a card selected, tapping one of your ships — or a ghost ship — selects it: every enemy ship lights up, and tapping one gives your ship its fire order or replaces it; tapping the current target again cancels the order. A ship already on the board also shows the slots it can maneuver to; a maneuver cancels its fire order. Tapping the selected ship once more takes back its deployment or maneuver; Escape, a right-click or a tap next to the board ends the selection. Your admiral ability is the card to the left of your commands, Admiral Kerr's target lock the button above it. The checklist below “End turn” shows which parts of your turn are planned, still open or impossible.",
          "While you plan, the board previews the round as if your opponent did nothing: an arc shows each fire order (dashed if the shot would fizzle), hull bars blink with the damage a ship would take, and a skull marks every ship that would be destroyed. Chance, like the Plasma Frigate's shot, isn't included. The panel at the top right shows what you know about your opponent: whether they have ended their turn, how many cards they hold and have left in their decks, and how many copies of each command they haven't played yet.",
          "“End turn” submits your plan. While the round is resolved you can skip the animation; the log button at the top right lists every event of the match. Scroll or hold ↑/↓ to zoom the board, and drag to pan while zoomed in. The camera button at the top right or V switches between the side view and the view from behind; hold ← or → or drag with the middle mouse button to turn the camera freely in between. Angle and zoom carry over to your next match. Sound, radio chatter, animation speed and language live in the settings next to this dialog; the flag next to it surrenders the match after a confirmation, and your opponent wins immediately.",
        ],
      },
    } satisfies Record<string, RulesSection>,
    phases: {
      deploy: {
        name: "Deploy",
        text: "New ships land, in round 1 the flagships too. Admiral abilities are revealed (a Decoy appears), Titan Carriers launch Drones, Plasma Frigates fire, the Pendulum locks on.",
      },
      maneuver: {
        name: "Maneuvers",
        text: "Maneuvering ships switch slots and hold fire, the Mirage swaps places. Then the Bastion raises its Guardian Shield.",
      },
      effects: { name: "Effects", text: "Commands take effect, by type; damage last. Destroyed ships are removed." },
      combat: {
        name: "Combat",
        text: "Railgun first, then Head Start, then all other ships with a fire order at once; cover takes the shots at the ships behind it, shots at destroyed ships fizzle. Counterfire strikes back last. Destroyed ships are removed.",
      },
      cleanup: {
        name: "Cleanup",
        text: "Micro-jumped ships return, self-damage from Overcharge, Repair Drones repair, round effects expire, the Decoy dissolves, the Hive launches a Drone.",
      },
      draw: { name: "Supplies", text: "Everyone picks a ship and a command out of three each (hand limit 10)." },
      check: { name: "Check", text: "Whoever has lost their flagship loses; if both fell, it's a draw." },
    },
    figures: {
      you: "You",
      enemy: "Enemy",
      slot: (index: number) => `Slot ${index}`,
      covered: "covered",
      exposed: "exposed",
      laneLimit: "max. 4 ships per lane, 6 per side",
      /** Die drei Fälle der Feuerbefehle: freie Wahl, die Deckung fängt ab, ein Schuss auf ein zerstörtes Schiff verpufft. */
      anyShip: "Any enemy ship",
      coverTakes: "Cover takes the shot",
      fizzles: "Destroyed: shot fizzles",
      round: (round: number) => `Round ${round}`,
      overdrive: (bonus: number) => (bonus === 0 ? "no Overdrive" : `+${bonus} ATK`),
      rounds: (from: number, to: number | null) => (to === null ? `from round ${from}` : `rounds ${from}–${to}`),
      maneuver: "Maneuver",
      turnParts: ["1 ship", "1 command", "maneuver or ability", "fire orders"],
      or: "or",
      roundOne: "Round 1: flagship + 2 ships",
    },
    commandTypes: {
      reposition: "Repositioning",
      tactic: "Tactics",
      buff: "Buffs",
      special: "Special",
      debuff: "Debuffs",
      attack: "Attacks",
    } satisfies Record<CommandType, string>,
    copies: (count: number) => `${count}× in deck`,
    flagship: (admiral: string) => `Flagship of ${admiral}`,
    token: "Token, not in any deck",
  },
  dialog: {
    close: "Close",
  },
  fullscreen: {
    enter: "Fullscreen (F)",
    exit: "Exit fullscreen (F)",
  },
  cameraView: {
    toggle: "Switch view (V); turn freely with ← → or the middle mouse button",
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
    chooseAdmiral: (link: string | null) => (link ? `Choose your admiral. Invite an opponent with this link: ${link}` : "Choose your admiral."),
    opponentChoosing: "The opponent is choosing their admiral …",
    draft: "Supplies: choose one ship and one command for your hand.",
    flagshipFirst: (flagship: string) =>
      `Round 1: deploy your flagship ${flagship} — tap its card at the front of your hand, then a glowing slot. “End turn” only works once it is planned.`,
    fleet: (count: number, max: number) => `Fleet ${count}/${max}`,
    noFreeSlot: (ship: string, perLane: number, perSide: number) =>
      `no free slot for ${ship} (max. ${perLane} per lane, ${perSide} per side, planned ships included).`,
    deploysLeft: (count: number) => (count === 0 ? "all ships planned" : `${count} ${count === 1 ? "ship" : "ships"} left to deploy`),
    placeShip: (ship: string) => `${ship}: tap a glowing slot. Click the card again to take it back.`,
    noCommandTarget: (command: string) => `no own ship to target with ${command}.`,
    chooseCommandTarget: (command: string) => `${command}: tap one of your ships. Click the card again to take it back.`,
    chooseEnemySlot: (command: string) =>
      `${command}: tap a slot on the enemy side, even an empty one — it hits whichever ship stands there after all moves. Click the card again to take it back.`,
    chooseEnemyShip: (command: string) => `${command}: tap an enemy ship — the command follows it if it moves. Click the card again to take it back.`,
    chooseEnemyColumn: (command: string) =>
      `${command}: tap a slot on the enemy side — it hits the slot number, front ship first, after all moves. Click the card again to take it back.`,
    noEnemyTarget: (command: string) => `no enemy ship to target with ${command}.`,
    commandDropped: (command: string, dropped: string) => `Without ${command}: ${dropped} dropped.`,
    chooseDestination: (command: string, ship: string) => `${command}: tap a glowing slot for ${ship}. Click the card again to take it back.`,
    /** Ein gewähltes eigenes Schiff: sein Feuerbefehl, sein Grundmanöver und was ein zweiter Klick zurücknimmt. */
    chooseFireTarget: (ship: string) => `${ship}: tap an enemy ship as its target — at a covered one, the ship in front takes the shot.`,
    noFireTarget: (ship: string) => `${ship}: no enemy ship to fire at yet.`,
    maneuverInstead: "Or tap a glowing slot of yours to maneuver — then it won't fire.",
    maneuverOrSwap:
      "Or tap a glowing slot of yours to maneuver (then it won't fire), or one of your ships to swap places with it (Phase Shift, both keep firing).",
    noGuns: (ship: string) => `${ship} has no guns.`,
    maneuvering: (ship: string) => `${ship} maneuvers and won't fire.`,
    commandHoldsFire: (ship: string, command: string) => `${ship} won't fire this round (${command}).`,
    maneuverHint: "Tap a glowing slot to maneuver it.",
    changeManeuver: "Tap another glowing slot to change the maneuver.",
    fireTarget: (target: string) => `Target: ${target} — tap it again to clear the order.`,
    fireCovered: (cover: string, target: string) => `${cover} covers ${target} and takes the shot.`,
    fireFizzles: (target: string) => `The shot fizzles: ${target} is already destroyed by then.`,
    coverFizzles: (cover: string, target: string) => `The shot fizzles: ${cover} is already destroyed by then but still covers ${target}.`,
    swarmFire: (power: string) => `It flies the ${power}; its own target only counts if the swarm target is gone.`,
    againUnplan: "Tap the ship again to take it back.",
    againManeuver: "Tap the ship again to cancel the maneuver.",
    escCancels: "Esc cancels.",
    fireCleared: (ship: string) => `${ship} won't fire this round — its fire order is cleared.`,
    fireOrders: (count: number) => (count === 1 ? "1 target" : `${count} targets`),
    fizzles: (count: number) =>
      count === 1 ? "1 shot fizzles — its target is already destroyed by then." : `${count} shots fizzle — their targets are already destroyed by then.`,
    maneuver: (ship: string) => `maneuver of ${ship}`,
    swap: (ship: string, partner: string) => `Phase Shift of ${ship} and ${partner}`,
    choosePowerTarget: (power: string) => `${power}: tap a glowing target. Tap the ability again or press Esc to cancel.`,
    noPowerTarget: (power: string) => `no target for ${power} right now.`,
    noDrone: (power: string) => `${power} needs one of your Drones on the board.`,
    power: (power: string, target: string) => `${power} on ${target}`,
    powerReplacesManeuver: (power: string, ship: string) => `${power} replaces the maneuver of ${ship}.`,
    maneuverReplacesPower: (power: string) => `The maneuver replaces ${power}.`,
    chooseMark: "Target lock: tap an enemy ship — next round the Pendulum's railgun hits it, if it's exposed. Tap the button again or press Esc to cancel.",
    mark: (ship: string) => `target lock on ${ship}`,
    planned: (cards: string) => `${cards} ready. Click “End turn”, or tap a card to take it back — or a ship on the board to change its target or move.`,
    idle: "Tap a ship or command card, or one of your ships on the board to give it a target or maneuver it. Click “End turn” without a card to pass.",
    resolving: "Both turns are revealed — resolving the round …",
    matchOver: "The match is over.",
  },
  opponent: {
    title: "Opponent",
    choosing: "choosing an admiral …",
    /** Solange man selbst noch wählt, bleibt die Wahl des Gegners verdeckt, auch ob er schon gewählt hat. */
    hidden: "choice hidden",
    planning: "planning …",
    ready: "turn ended",
    ships: "Ships",
    commands: "Commands",
    hand: "Hand",
    deck: "Deck",
  },
  radio: {
    /** Absender im Untertitel. */
    speaker: "Fleet Comms",
    lines: radioLines as RadioLines,
  },
  result: {
    won: { title: "Victory", subtitle: (flagship: string) => `The enemy flagship ${flagship} is destroyed.` },
    lost: { title: "Defeat", subtitle: (flagship: string) => `Your flagship ${flagship} is destroyed.` },
    draw: { title: "Draw", subtitle: (own: string, enemy: string) => `Both flagships are destroyed: your ${own} and the enemy ${enemy}.` },
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
    deployFlagship: (who: string, ship: string, slot: string) => `Deploy: ${who} — flagship ${ship} on ${slot}`,
    power: (who: string, power: string, target: string) => `Ability: ${who} — ${power} on ${target}`,
    decoy: (ship: string) => `Ability: ${ship} appears`,
    mark: (who: string, ship: string) => `Target lock: ${who} — the Pendulum locks onto ${ship}`,
    swap: (who: string, ship: string, partner: string) => `Phase Shift: ${who} — ${ship} and ${partner} swap places and keep firing`,
    pass: (who: string) => `Deploy: ${who} — no ship`,
    maneuver: (who: string, ship: string, slot: string) => `Maneuver: ${who} — ${ship} moves to ${slot} and holds fire this round`,
    command: (who: string, command: string) => `Command: ${who} — ${command}`,
    commandOn: (who: string, command: string, slot: string) => `Command: ${who} — ${command} on ${slot}`,
    damage: (command: string, ship: string, amount: number) => `Effect: ${command} hits ${ship} for ${amount}`,
    attackBonus: (command: string, ship: string, delta: number) => `Effect: ${command} — ${ship} ${delta > 0 ? "+" : ""}${delta} ATK this round`,
    shield: (command: string, ship: string, amount: number) => `Effect: ${command} — ${ship} +${amount} shield this round`,
    disable: (command: string, ship: string) => `Effect: ${command} — ${ship} cannot attack this round`,
    heal: (command: string, ship: string, amount: number) => `Effect: ${command} heals ${ship} for ${amount}`,
    move: (command: string, ship: string, slot: string) => `Effect: ${command} — ${ship} moves to ${slot}`,
    shieldPermanent: (command: string, ship: string, amount: number) => `Effect: ${command} — ${ship} +${amount} shield, permanently`,
    tow: (command: string, ship: string, slot: string) => `Effect: ${command} pulls ${ship} to ${slot}`,
    jump: (command: string, ship: string) => `Effect: ${command} — ${ship} jumps off the board until cleanup`,
    taunt: (command: string, ship: string) => `Effect: ${command} — ${ship} draws enemy fire this round`,
    launch: (command: string, ship: string) => `Effect: ${command} launches ${ship}`,
    ram: (command: string, ship: string, target: string, dealt: number, taken: number) =>
      `Effect: ${command} — ${ship} rams ${target}: ${dealt} dealt, ${taken} taken`,
    jam: (command: string, ship: string, power: string) => `Effect: ${command} — ${power} on ${ship} is cut off`,
    jamDecoy: (command: string, ship: string) => `Effect: ${command} — ${ship} dissolves`,
    countered: (command: string, who: string, countered: string) => `Effect: ${command} (${who}) intercepts ${countered}`,
    rule: (command: string, who: string, detail: string) => `Effect: ${command} (${who}) — ${detail} this round`,
    rejoin: (ship: string) => `Cleanup: ${ship} returns from its jump`,
    repair: (source: string, ship: string, amount: number) => `Cleanup: ${source} repairs ${ship} for ${amount}`,
    abilityDamage: (source: string, ship: string, amount: number) => `Deploy: ${source} hits ${ship} for ${amount}`,
    guardianShield: (source: string, ship: string, amount: number) => `Guardian Shield: ${source} gives ${ship} +${amount} shield this round`,
    spawn: (source: string, ship: string) => `Deploy: ${source} launches ${ship}`,
    brood: (source: string, ship: string) => `Brood Chamber: ${source} launches ${ship}`,
    salvage: (ship: string) => `Salvage: ${ship} recovers scrap — Scrap Salvage comes with the next supplies`,
    draw: (command: string, who: string, ships: number, commands: number) =>
      `Effect: ${command} — ${who} ${ships > 0 ? `+${ships} ship, ` : ""}+${commands} command`,
    noEffect: (command: string, who: string) => `Effect: ${command} (${who}) has no effect`,
    miss: (command: string, slot: string) => `Effect: ${command} fizzles in ${slot}`,
    railgun: (source: string, target: string, amount: number) => `Railgun: ${source} hits ${target} for ${amount}`,
    railgunBlocked: (source: string, target: string) => `Railgun: the shot of ${source} at ${target} is blocked — the target is covered`,
    /** Ein Schuss im Kampf; `notes` nennt, was ihn verstärkt, gelenkt oder beschleunigt hat (Admiralsfähigkeiten, Ablenkung). */
    attack: (attacker: string, target: string, amount: number, notes: readonly string[]) =>
      `Combat: ${attacker} fires at ${target} (${[amount, ...notes].join(", ")})`,
    /** Der Schuss galt `aimed`, aber das Schiff davor (`cover`) fing ihn als Deckung ab. */
    covered: (attacker: string, aimed: string, cover: string, amount: number, notes: readonly string[]) =>
      `Combat: ${attacker} fires at ${aimed} — ${cover} in front takes the shot (${[amount, ...notes].join(", ")})`,
    /** Der Schuss galt `aimed`, aber `ship` zog ihn mit der Ablenkung auf sich. */
    drawn: (attacker: string, aimed: string, ship: string, amount: number, notes: readonly string[]) =>
      `Combat: ${attacker} fires at ${aimed} — ${ship} draws the shot (${[amount, ...notes].join(", ")})`,
    /** Der Schuss verpufft: Sein Ziel `target` ist schon zerstört. */
    fizzle: (attacker: string, target: string) => `Combat: the shot of ${attacker} fizzles — ${target} is already destroyed`,
    /** Der Schuss verpufft: Sein Ziel steht nicht mehr auf dem Brett (vor dem Kampf zerstört, Kurzsprung). */
    fizzleGone: (attacker: string) => `Combat: the shot of ${attacker} fizzles — its target is no longer on the board`,
    /** Die Deckung vor dem Ziel des Feuerbefehls ist schon zerstört und fängt den Schuss trotzdem ab. */
    fizzleCovered: (attacker: string, aimed: string, cover: string) =>
      `Combat: the shot of ${attacker} at ${aimed} fizzles — ${cover} in front of it is already destroyed`,
    silenced: (ship: string) => `Head Start: ${ship} is destroyed before it can fire`,
    counterfire: (ship: string, source: string, amount: number) => `Counterfire: ${ship} takes ${amount} for hitting ${source}`,
    selfDamage: (ship: string, amount: number) => `Cleanup: ${ship} takes ${amount} self-damage`,
    destroyed: (ship: string) => `Destroyed: ${ship}`,
    flagshipDestroyed: (ship: string) => `Destroyed: flagship ${ship}!`,
    vanish: (ship: string) => `Cleanup: ${ship} dissolves`,
  },
  banner: {
    command: (who: string, command: string) => `${who}: ${command}`,
    markTarget: (ship: string) => `locks onto ${ship}`,
    blocked: "blocked — the target is covered",
    noEffect: "no effect",
    miss: (slot: string) => `fizzles in ${slot}`,
    draw: (ships: number, commands: number) => `${ships > 0 ? `+${ships} ship, ` : ""}+${commands} command`,
    countered: (command: string) => `intercepts ${command}`,
    extraShip: "+1 ship",
    maneuverAndPower: "maneuver and ability",
  },
  float: {
    damage: (amount: number) => `−${amount}`,
    heal: (amount: number) => `+${amount} HP`,
    shield: (amount: number) => `+${amount} Shield`,
    attack: (delta: number) => `${delta > 0 ? "+" : "−"}${Math.abs(delta)} ATK`,
    salvage: "Scrap",
    disabled: "Disabled",
    holdFire: "Holds fire",
    miss: "Miss",
    silenced: "Silenced",
    locked: "Locked",
    blocked: "Blocked",
    decoy: "Decoy",
    shieldPermanent: (amount: number) => `+${amount} Shield (permanent)`,
    taunt: "Draws fire",
    jammed: "Radio silence",
    jump: "Jump",
    /** Ein Schuss im Kampf verpufft: am schon zerstörten Ziel oder, wenn es nicht mehr auf dem Brett steht, im Leeren. */
    fizzle: "Fizzled",
    /** Am Schiff, auf das ein Schuss gezielt war: Die Deckung davor fing ihn ab bzw. die Ablenkung zog ihn weg. */
    covered: "Covered",
    diverted: "Diverted",
  },
  errors: {
    match_full: "This match is already full.",
    match_over: "The match is over.",
    opponent_missing: "The opponent hasn't joined yet.",
    admiral_required: "Choose your admiral first.",
    admiral_already_chosen: "You have already chosen your admiral.",
    opponent_choosing: "The opponent is still choosing their admiral.",
    draft_pending: "Choose your supplies first.",
    draft_unavailable: "There are no supplies to choose right now.",
    draft_invalid: "Choose one ship and one command from the supplies.",
    flagship_required: "Deploy your flagship in round 1.",
    flagship_not_allowed: "The flagship is only deployed in round 1.",
    power_and_maneuver: "Use either the maneuver or your admiral ability, not both.",
    power_target_invalid: "Your admiral ability can't target that.",
    mark_unavailable: "The Pendulum can't lock onto a target this round.",
    mark_target_invalid: "The Pendulum can only lock onto an enemy ship.",
    swap_not_allowed: "Only the Mirage can swap places with one of your ships.",
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
    target_not_enemy_ship: "The command target isn't an enemy ship.",
    target_wrong_ship: "This command can't target this ship.",
    destination_required: "This command needs a slot to move the ship to.",
    destination_not_allowed: "This command doesn't move a ship.",
    destination_unavailable: "The ship can't move to this slot.",
    maneuver_not_own_ship: "Only one of your ships already on the board can maneuver.",
    maneuver_destination_unavailable: "The ship can't maneuver to this slot.",
    maneuver_conflict: "A command can't move the ship that maneuvers this round.",
    fire_ship_invalid: "Only your combat ships can get a fire order, one each — not the ship that maneuvers this round.",
    fire_target_invalid: "A fire order needs an enemy ship on the board as its target.",
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
    auto_lowest_hp: "Lowest-HP Enemy",
    auto_highest_atk: "Highest-ATK Enemy",
    auto_all: "All Targets",
    auto_moved: "Moved Enemies",
    auto_arrived: "New Enemies",
    auto_unpaired: "Unpaired Enemies",
    all_friendly: "All Allies",
    all_friendly_strike: "Allies in Strike",
    all_enemy_strike: "Enemies in Strike",
    all_enemy_command: "Enemies in Command",
    enemy_power: "Enemy Power",
    choose_friendly: "Choose Ally",
    choose_enemy: "Choose Enemy",
    choose_enemy_slot: "Choose Enemy Slot",
    choose_enemy_column: "Choose Enemy Column",
  } satisfies Record<TargetMode, string>,
  ships: {
    horizon_cruiser: { name: "Horizon Cruiser", effect: "Solid stats, reliable." },
    iron_dreadnought: { name: "Iron Dreadnought", effect: "Shield 2: Absorbs the first 2 damage before the hull." },
    plasma_frigate: { name: "Plasma Frigate", effect: "On Deploy: Deal 3 damage to a random enemy ship in the same lane." },
    repair_drone: { name: "Repair Drone", effect: "End of each round: Repairs 2 HP on the damaged allied combat ship with the lowest HP." },
    scrap_raider: {
      name: "Scrap Raider",
      effect: "When an enemy ship in the same lane is destroyed, your next supplies include Scrap Salvage: +1 ATK permanently for a Scrap Raider.",
    },
    signal_booster: { name: "Signal Booster", effect: "All other allied ships in the same lane have +1 ATK, as long as the Signal Booster is there." },
    titan_carrier: { name: "Titan Carrier", effect: "On Deploy: Spawn a Drone (1 HP, 1 ATK) in the same lane." },
    drone: {
      name: "Drone",
      effect: "Launched by the Titan Carrier on deploy, by Drone Squadron and by the Hive at the end of the round; not part of any deck.",
    },
    void_interceptor: { name: "Void Interceptor", effect: "Pure damage, no tricks." },
    decoy: {
      name: "Decoy",
      effect:
        "Admiral Moreau's hologram: stands for one round, never attacks and covers the Command slot behind it — shots at the ship there hit the Decoy. Flagships see through it; destroyed, it leaves no scrap.",
    },
    bastion: {
      name: "Bastion",
      effect: `After the maneuvers, she gains +${guardianShield} shield for the round, the ship in the Strike slot directly in front of her +${guardianShieldFront}.`,
    },
    vanguard: { name: "Vanguard", effect: `The combat ship in the Strike slot directly in front of her has +${spearhead} ATK.` },
    hive: {
      name: "Hive",
      effect: `End of each round: launches a Drone into the nearest free Strike slot — at most ${maxDrones} Drones at a time and ${hiveBudget} per match.`,
    },
    mirage: { name: "Mirage", effect: "Her maneuver may also target one of your occupied slots: both ships swap places and both still fire." },
    pendulum: {
      name: "Pendulum",
      effect: `In a round her railgun doesn't fire, she may lock onto an enemy ship. Next round the railgun hits it for ${railgun} if it's exposed. If she moves in either round, the shot is lost.`,
    },
  } satisfies Record<ShipId, CardText>,
  admirals: {
    osei: { name: "Admiral Osei", epithet: "The Wall", ability: "Guardian Shield" },
    vance: { name: "Admiral Vance", epithet: "The Hammer", ability: "Spearhead" },
    halvorsen: { name: "Admiral Halvorsen", epithet: "The Swarm", ability: "Brood Chamber" },
    moreau: { name: "Admiral Moreau", epithet: "The Phantom", ability: "Phase Shift" },
    kerr: { name: "Admiral Kerr", epithet: "The Clockmaker", ability: "Railgun" },
  } satisfies Record<AdmiralId, AdmiralText>,
  admiralTitle: (name: string, epithet: string) => `${name} – ${epithet}`,
  powers: {
    counterfire: {
      name: "Counterfire",
      effect: `Choose one of your ships. Every enemy ship except a flagship that hits it in combat takes ${counterfire} damage per hit afterwards.`,
    },
    focus_fire: { name: "Focus Fire", effect: `Choose an enemy ship, even a covered one. This round every hit on it in combat deals +${focusFire} damage.` },
    swarm_strike: {
      name: "Swarm Strike",
      effect: `Choose an enemy ship other than the flagship, even a covered one. All your Drones fire at it without fire orders, each hit +${swarmStrike} damage.`,
    },
    decoy: {
      name: "Decoy",
      effect:
        "Choose a free Strike slot. A Decoy (1 HP) stands there this round and covers the slot behind it: shots at that ship hit the Decoy. Flagships see through it.",
    },
    head_start: { name: "Head Start", effect: "Choose one of your combat ships. It fires before everyone else, and whatever it destroys no longer fires." },
  } satisfies Record<PowerId, CardText>,
  powerTargets: {
    own_ship: "Choose Ally",
    own_combat_ship: "Choose Combat Ally",
    enemy_ship: "Choose Enemy",
    enemy_ship_not_flagship: "Choose Enemy",
    free_own_strike_slot: "Choose Strike Slot",
  } satisfies Record<PowerTarget, string>,
  commands: {
    emergency_shields: { name: "Emergency Shields", effect: "Chosen allied ship gains Shield 3 this round." },
    emp_blast: { name: "EMP Blast", effect: "The enemy ship with the highest ATK cannot attack this round." },
    flanking_maneuver: { name: "Flanking Maneuver", effect: "Chosen allied ship switches lanes (Strike ↔ Command) to a free slot of your choice." },
    intercept: { name: "Intercept", effect: "Pull a chosen Command lane ship into a free Strike lane slot of your choice. +2 ATK this round." },
    orbital_strike: { name: "Orbital Strike", effect: "Deal 4 damage to the enemy ship with the highest HP." },
    overcharge: { name: "Overcharge", effect: "Chosen ship gets +3 ATK this round. Takes 2 self-damage after combat." },
    power_surge: { name: "Power Surge", effect: "All allied ships in the Strike lane gain +1 ATK this round." },
    recall: { name: "Recall", effect: "A chosen Strike lane ship retreats to a free Command lane slot of your choice. Heal 2 HP." },
    scavenge: { name: "Scavenge", effect: "Draw 1 extra ship and 1 extra command." },
    targeting_jammer: { name: "Targeting Jammer", effect: "All enemy ships in the Strike lane get -1 ATK this round (min 0)." },
    volley_fire: { name: "Volley Fire", effect: "Deal 1 damage to ALL enemy ships." },
    torpedo: { name: "Torpedo", effect: "Choose an enemy slot. After all moves, deal 5 damage to the ship there, even if covered. An empty slot: miss." },
    barrage: { name: "Barrage", effect: "Deal 3 damage to every enemy ship that changed slots this round." },
    evasive_action: { name: "Evasive Action", effect: "Chosen allied ship moves to a free slot in the same lane and gains Shield 2 this round." },
    micro_jump: {
      name: "Micro-Jump",
      effect:
        "After all moves, chosen allied ship leaves the battle and returns at the end of the round. Until then nothing can hit it, but it neither fires nor gives cover.",
    },
    rapid_deployment: { name: "Rapid Deployment", effect: "You may deploy one extra ship this round." },
    draw_fire: {
      name: "Draw Fire",
      effect:
        "This round the chosen allied ship draws the shots of all enemy ships with a fire order, as long as it stands and is exposed to them. Swarm Strike and the railgun keep their targets.",
    },
    shield_grid: { name: "Shield Grid", effect: "All allied ships gain Shield 1 this round." },
    ablative_armor: { name: "Ablative Armor", effect: "Chosen allied ship gains a permanent Shield 2. It does not expire at the end of the round." },
    covering_fire: {
      name: "Covering Fire",
      effect: "Chosen allied ship and the ship directly in front of or behind it each gain +1 ATK and Shield 1 this round.",
    },
    drone_squadron: {
      name: "Drone Squadron",
      effect:
        "Two Drones (1 HP, 1 ATK) launch into free Strike slots, in front of uncovered Command ships first. They give cover at once; this round they fire only with Swarm Strike.",
    },
    collision_course: {
      name: "Collision Course",
      effect:
        "Chosen allied Strike ship (not a flagship) rams the exposed enemy ship opposite. Each takes damage equal to the other's HP. The rammer does not fire this round.",
    },
    countermeasures: {
      name: "Countermeasures",
      effect: "If your opponent plays an attack or debuff command this round, it fizzles. Otherwise, draw a command.",
    },
    carte_blanche: { name: "Carte Blanche", effect: "You may use both the basic maneuver and your admiral ability this round." },
    radio_silence: { name: "Radio Silence", effect: "The enemy admiral ability fizzles this round; a Decoy dissolves." },
    minefield: {
      name: "Minefield",
      effect: "Deal 3 damage to every enemy ship that entered the board this round (deployed, launched Drone, Decoy).",
    },
    tractor_beam: {
      name: "Tractor Beam",
      effect: "After all moves, pull the chosen enemy ship (not a flagship) into the nearest free slot of its other lane. It counts as moved.",
    },
    heat_seeker: { name: "Heat Seeker", effect: "Follows the chosen enemy ship: 3 damage, even if covered; 5 if it changed slots this round." },
    coup_de_grace: { name: "Coup de Grâce", effect: "Deal 4 damage to the enemy ship with the lowest HP, even if covered (not Drones or Decoys)." },
    piercing_shot: {
      name: "Piercing Shot",
      effect: "Choose an enemy slot number. After all moves, deal 3 damage to the front ship there and 2 to the ship behind it.",
    },
    bombardment: { name: "Bombardment", effect: "Deal 2 damage to every ship in the enemy Command lane." },
    crossfire: { name: "Crossfire", effect: "Deal 3 damage to every enemy ship with no ship directly in front of or behind it." },
    scrap_salvage: { name: "Scrap Salvage", target: "Allied Scrap Raider", effect: "The chosen Scrap Raider gets +1 ATK permanently." },
  } satisfies Record<CommandId, CardText>,
};

export type Messages = typeof en;
