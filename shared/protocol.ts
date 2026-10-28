// Nachrichten zwischen Client und Server über die WebSocket-Verbindung `/ws`.
// Alles ist aus Sicht des Empfängers formuliert: "player" ist die eigene Seite,
// "enemy" die des Gegners. Karten werden über ihre id übertragen.

import type { AdmiralId, PowerId } from "./admirals.ts";
import type { BoardSnapshot, LaneType, Side } from "./board.ts";
import type { CommandId, ShipId } from "./cards.ts";

/** Ein Slot auf einer Seite des Bretts, die sich aus dem Zusammenhang ergibt. */
export interface SlotTarget {
  lane: LaneType;
  slotIndex: number;
}

/** Ein Slot samt Seite, wie ihn die Ereignisse melden. */
export interface SlotRef extends SlotTarget {
  side: Side;
}

/** Ein Schiff von der Hand, das auf einen eigenen Slot gelegt wird. */
export interface Deploy {
  handIndex: number;
  target: SlotTarget;
}

/**
 * Der Zug einer Runde: bis zu `maxDeploys` Schiffe (in Runde 1 zwei, sonst eines, mit Schnellverlegung eines mehr, in
 * verschiedene Slots) und 1 Befehl, jeweils per Hand-Index, dazu entweder ein Grundmanöver oder die Admiralsfähigkeit
 * (mit Freier Hand beides). Ziele liegen auf der eigenen Seite, außer bei Befehlen mit Ziel auf der Gegnerseite
 * (`targetsEnemySide`): `choose_enemy` (Wärmesucher, Traktorstrahl) ist ein gegnerisches Schiff, das beim Planen dort
 * steht, und der Befehl folgt ihm; `choose_enemy_slot` (Torpedo) ist ein Slot der Gegnerseite, auch ein leerer, und
 * `choose_enemy_column` (Durchschlag) ebenso, nur zählt dort allein die Slot-Nummer. Verlegt der Befehl sein Ziel, ist
 * `destination` der Slot-Index in der Ziel-Lane (`destinationLane`: die andere Lane, beim Ausweichmanöver dieselbe),
 * sonst null. Das Manöver verlegt ein eigenes Schiff, das schon auf dem Brett steht, in den freien Slot
 * `destination` der anderen oder derselben Lane; dafür feuert es in dieser Runde nicht. Die Mirage darf dabei auch in einen
 * belegten eigenen Slot: Sie tauscht mit dem Schiff dort die Plätze (Phasentausch), und beide feuern. Eigene Ziele beziehen sich auf
 * die Stellung vor dem Manöver: Ein Befehl auf das manövrierte Schiff folgt ihm. Ein Slot der Gegnerseite
 * bleibt, was er ist: Getroffen wird, wer nach allen Bewegungen dort steht. Im Kampf feuert nur, wer einen
 * Feuerbefehl hat (`fire`); es gibt keine automatische Zielwahl.
 */
export interface TurnPlan {
  ships: Deploy[];
  command: { handIndex: number; target: SlotTarget | null; destination: number | null } | null;
  maneuver: { ship: SlotTarget; destination: SlotTarget } | null;
  /** Runde 1: der Slot, auf dem das eigene Flaggschiff landet, zusätzlich zu den Schiffen (Pflicht); danach immer null. */
  flagship: SlotTarget | null;
  /** Die Admiralsfähigkeit statt des Grundmanövers (nie beides); was `target` sein darf, steht in `POWER_TARGETS`. */
  power: { target: SlotTarget } | null;
  /** Pendulum: der Slot des gegnerischen Schiffs (Stellung beim Planen), das sie markiert; nur in Runden, in denen sie nicht feuert. */
  mark: SlotTarget | null;
  /** Feuerbefehle: je eigenem Kampfschiff höchstens einer; jede Runde neu, ein Schiff ohne Feuerbefehl feuert nicht. */
  fire: FireOrder[];
}

/**
 * Ein Feuerbefehl: `ship` ist ein eigenes Kampfschiff (Slot beim Planen, auch eines, das in dieser Runde landet, nicht
 * das Schiff des Grundmanövers), `target` ein gegnerisches Schiff, das beim Planen dort steht, auch ein gedecktes. Beide
 * folgen ihrem Schiff, wenn es sich bewegt. Steht das Ziel zu Kampfbeginn gedeckt, fängt das Schiff davor den Schuss ab;
 * ist es schon zerstört oder nicht mehr auf dem Brett, verpufft der Schuss.
 */
export interface FireOrder {
  ship: SlotTarget;
  target: SlotTarget;
}

/** Ein Schiff an einer Stelle des Bretts; die Karte steht dabei, weil der Slot danach leer sein kann. */
export interface ShipRef extends SlotRef {
  cardId: ShipId;
}

export type MatchResult = "won" | "lost" | "draw";

/** Was man vom Gegner weiß: ob er abgegeben hat, wie viele Karten er hält und welche Befehle er schon gespielt hat. */
export interface OpponentView {
  /** Sein Admiral; null, solange noch nicht beide gewählt haben (die Wahl ist verdeckt). */
  admiral: AdmiralId | null;
  submitted: boolean;
  shipHandSize: number;
  commandHandSize: number;
  shipDeckSize: number;
  commandDeckSize: number;
  /** Seine aufgedeckten Befehle in der Reihenfolge, in der er sie gespielt hat. */
  playedCommands: CommandId[];
}

/**
 * Der Nachschub nach jeder Runde: bis zu 3 Schiffe und 3 Befehle aus den Decks, davon nimmt der Spieler je eines auf die
 * Hand; die übrigen gehen zurück ins Deck. Eine volle Handhälfte bekommt kein Angebot. Hat ein eigener Scrap Raider in
 * der Runde Schrott geborgen und steht danach noch einer auf dem Brett, ist einer der Befehle die Schrottverwertung
 * (`salvage`, dann höchstens 2 Befehle aus dem Deck): +1 ATK dauerhaft für einen eigenen Scrap Raider nach Wahl, sofort.
 */
export interface DraftOffer {
  ships: ShipId[];
  commands: CommandId[];
  salvage: boolean;
}

/**
 * Die Wahl aus dem Nachschub: `ship` ist ein Index in `DraftOffer.ships` (Pflicht, wenn es Schiffe gibt); entweder
 * `command` als Index in `DraftOffer.commands` oder `salvage` als Slot des eigenen Scrap Raiders, der +1 ATK bekommt
 * (eines davon ist Pflicht, wenn es Befehle oder die Schrottverwertung gibt).
 */
export interface DraftPick {
  ship: number | null;
  command: number | null;
  salvage: SlotTarget | null;
}

/**
 * Ob eine Pendulum in dieser Runde feuert, folgt aus dem Brett: Auf der Gegenseite steht ein markiertes
 * Schiff (`SlotState.marked`). Runde 1 beginnt erst, wenn beide ihren Admiral gewählt haben.
 */
export interface PlayerView {
  matchId: string;
  round: number;
  /** Der eigene Admiral; null, solange noch nicht gewählt. */
  admiral: AdmiralId | null;
  board: BoardSnapshot;
  /** So viele Drohnen hat die Hive je Seite in diesem Match schon gestartet (`ABILITY_VALUES.hiveBudget`). */
  hiveLaunches: Record<Side, number>;
  shipHand: ShipId[];
  commandHand: CommandId[];
  shipDeckSize: number;
  commandDeckSize: number;
  /** Der abgegebene Zug dieser Runde; null, solange noch geplant wird. */
  submittedPlan: TurnPlan | null;
  /** Der Nachschub nach der letzten Runde, solange nicht gewählt; erst danach wird geplant. */
  draft: DraftOffer | null;
  /** Der Gegner, sobald er beigetreten ist. */
  opponent: OpponentView | null;
  /** Gesetzt, sobald das Match entschieden ist; danach gibt es keine Züge mehr. */
  result: MatchResult | null;
  /** Das Match endete, weil ein Spieler aufgegeben hat; wer, folgt aus `result`. */
  surrendered: boolean;
}

/** HP und Schild eines Schiffs nach einem Ereignis, damit der Client die Runde Schritt für Schritt zeigen kann. */
export interface ShipStats {
  hp: number;
  shield: number;
}

/**
 * Was ein Befehl an einem Schiff bewirkt (`ship` im Ereignis `effect`, Stellung vor der Wirkung). `move` verlegt auch ein
 * gegnerisches Schiff (Traktorstrahl). Neu dazu: `shield` mit `permanent` (Ablativpanzerung, verfällt nicht am
 * Rundenende); `jump` (Kurzsprung: das Schiff verlässt das Brett bis zum Cleanup, siehe `return`); `taunt` (Ablenkung:
 * zieht diese Runde das Feuer auf sich); `spawn` (Drohnenstaffel: `ship` ist die gerade gestartete Drohne); `ram`
 * (Rammkurs: `ship` rammt `target`, `dealt` ist der Schaden am Ziel, `taken` der am Rammer, beide Nennwerte vor dem
 * Schild; `after` im Ereignis gilt dem Rammer, `targetAfter` dem Ziel); `jam` (Funkstille: die gegnerische
 * Admiralsfähigkeit `power` auf diesem Schiff fällt weg; beim Trugbild (`power: "decoy"`) verschwindet es sofort).
 */
export type CommandEffect =
  | { type: "damage"; amount: number }
  | { type: "attack"; delta: number }
  | { type: "shield"; amount: number; permanent?: true }
  | { type: "disable" }
  | { type: "heal"; amount: number }
  | { type: "move"; to: SlotTarget }
  | { type: "jump" }
  | { type: "taunt" }
  | { type: "spawn" }
  | { type: "ram"; target: ShipRef; dealt: number; taken: number; targetAfter: ShipStats }
  | { type: "jam"; power: PowerId };

/** Was eine Schiffs-Fähigkeit an einem Schiff bewirkt; `salvage`: Der Scrap Raider birgt Schrott (`DraftOffer.salvage`). */
export type AbilityEffect = Extract<CommandEffect, { type: "heal" | "damage" | "shield" }> | { type: "salvage" };

/**
 * Was in einer Runde aufgedeckt und aufgelöst wurde, in Auflösungsreihenfolge.
 * Im Kampf feuern erst alle Schiffe (`attack`), dann wirkt der summierte Schaden (`hit`).
 */
export type RoundEvent =
  /** Auch das Flaggschiff in Runde 1. */
  | { kind: "deploy"; side: Side; cardId: ShipId; target: SlotTarget }
  | { kind: "pass"; side: Side }
  /** Die Admiralsfähigkeit, gleich nach den Deploys aufgedeckt: `target` ist das gewählte Schiff bzw. der Slot des Trugbilds. */
  | { kind: "power"; side: Side; power: PowerId; target: SlotRef }
  /** Trugbild: erscheint nach `power` im gewählten Strike-Slot und verschwindet am Rundenende (`vanish`). */
  | { kind: "decoy"; ship: ShipRef }
  /** Pendulum: markiert nach den Deploys ein gegnerisches Schiff; die Markierung folgt ihm, die Railgun feuert in der nächsten Runde. */
  | { kind: "mark"; side: Side; ship: ShipRef }
  /** Grundmanöver nach dem Deploy: `ship` ist die Stelle davor; das Schiff feuert in dieser Runde nicht. */
  | { kind: "maneuver"; side: Side; ship: ShipRef; to: SlotTarget }
  /** Phasentausch statt `maneuver`: Die Mirage (`a`) und das Schiff `b` tauschen die Plätze (Stellung davor) und feuern beide. */
  | { kind: "swap"; side: Side; a: ShipRef; b: ShipRef }
  /**
   * `target` ist der Slot nach dem Manöver, beim Torpedo der gewählte Slot der Gegnerseite, beim Durchschlag der
   * Strike-Slot der gewählten Slot-Nummer, bei Wärmesucher und Traktorstrahl der Slot, in dem das gewählte
   * gegnerische Schiff beim Aufdecken steht (null, wenn es nicht mehr auf dem Brett steht).
   */
  | { kind: "command"; side: Side; cardId: CommandId; target: SlotRef | null }
  | { kind: "effect"; side: Side; cardId: CommandId; ship: ShipRef; effect: CommandEffect; after: ShipStats }
  /** Plündern (1 Schiff, 1 Befehl) und Gegenmaßnahmen ohne gegnerischen Angriff (1 Befehl): was auf der Hand gelandet ist. */
  | { kind: "draw"; side: Side; cardId: CommandId; ships: number; commands: number }
  | { kind: "noEffect"; side: Side; cardId: CommandId }
  /** Gegenmaßnahmen (`cardId`) von `side`: Der Angriffs- oder Schwächungsbefehl `countered` der Gegenseite verpufft. */
  | { kind: "countered"; side: Side; cardId: CommandId; countered: CommandId }
  /** Befehl, der den Zug selbst verändert hat (Schnellverlegung, Freie Hand); er hat schon beim Planen gewirkt. */
  | { kind: "rule"; side: Side; cardId: CommandId }
  /** Torpedo in einen Slot, in dem nach allen Bewegungen kein Schiff steht. */
  | { kind: "miss"; side: Side; cardId: CommandId; target: SlotRef }
  /**
   * Fähigkeit eines Schiffs (`source`) an einem Schiff: der Schuss der Plasma Frigate beim Deploy (`damage`),
   * die Reparatur der Repair Drone im Cleanup (`heal`), der Schrott, den der Scrap Raider birgt, sobald in seiner
   * Lane ein Gegner zerstört wurde (`salvage` an sich selbst, gleich nach den `destroyed`-Ereignissen),
   * der Wächterschild der Bastion für sie und das Schiff vor ihr nach den Manövern (`shield`).
   */
  | { kind: "ability"; source: ShipRef; ship: ShipRef; effect: AbilityEffect; after: ShipStats }
  /** Drohnenstart: Titan Carrier beim Deploy (freier Slot derselben Lane), Hive am Rundenende (freier Strike-Slot). */
  | { kind: "spawn"; source: ShipRef; ship: ShipRef }
  /** Railgun der Pendulum zu Kampfbeginn auf das markierte Schiff; `blocked`, wenn es gedeckt war (dann kein Schaden). */
  | { kind: "railgun"; source: ShipRef; target: ShipRef; amount: number; after: ShipStats; blocked: boolean }
  /** Taktvorsprung: Das Schiff fiel durch einen Schuss, der vor allen anderen kam, und feuert nicht mehr. */
  | { kind: "silenced"; ship: ShipRef }
  /**
   * Ein Schuss im Kampf; `focus`/`swarm`/`headStart`: verstärkt, gelenkt bzw. beschleunigt von der Admiralsfähigkeit.
   * `aimedAt`: Das Schiff des Feuerbefehls, wenn der Schuss ein anderes trifft: die Deckung davor fängt ihn ab, oder
   * (`taunt`) die Ablenkung zieht ihn auf sich.
   */
  | {
      kind: "attack";
      attacker: ShipRef;
      target: ShipRef;
      amount: number;
      after: ShipStats;
      focus?: true;
      swarm?: true;
      headStart?: true;
      aimedAt?: ShipRef;
      taunt?: true;
    }
  /**
   * Ein Schuss, der verpufft: Sein Ziel ist schon zerstört (`target`) oder nicht mehr auf dem Brett (`target` null).
   * Fängt eine schon zerstörte Deckung den Schuss ab, ist sie `target` und `aimedAt` das Schiff des Feuerbefehls dahinter.
   */
  | { kind: "fizzle"; attacker: ShipRef; target: ShipRef | null; aimedAt?: ShipRef; headStart?: true }
  /** Gegenfeuer nach dem Kampf: `ship` hat `source` getroffen und nimmt dafür Schaden. */
  | { kind: "counterfire"; source: ShipRef; ship: ShipRef; amount: number; after: ShipStats }
  | { kind: "selfDamage"; ship: ShipRef; amount: number; after: ShipStats }
  | { kind: "destroyed"; ship: ShipRef }
  /** Kurzsprung: Das Schiff kehrt zu Beginn des Cleanups in seinen Slot zurück (`ship`), mit HP und Schild `after`. */
  | { kind: "return"; ship: ShipRef; after: ShipStats }
  /** Das Trugbild verschwindet am Rundenende (sofern es nicht zerstört wurde). */
  | { kind: "vanish"; ship: ShipRef };

/**
 * Die Verbindung selbst ist der Beitritt: `/ws?match=<id>&token=<token>`.
 * `chooseAdmiral` wählt den eigenen Admiral, einmal und vor Runde 1, auch schon, solange der Gegner fehlt.
 * `addBot` setzt den Computergegner auf den freien Platz, statt auf einen Menschen zu warten; er wählt sofort.
 * `draft` wählt aus dem Nachschub (`PlayerView.draft`), bevor der Zug der Runde abgegeben werden kann.
 * `surrender` gibt das Match auf, jederzeit, auch nach abgegebenem Zug; der Gegner gewinnt sofort.
 */
export type ClientMessage =
  | { type: "chooseAdmiral"; admiral: AdmiralId }
  | { type: "draft"; pick: DraftPick }
  | { type: "submit"; plan: TurnPlan }
  | { type: "addBot" }
  | { type: "surrender" };

/** Fehler werden als Code übertragen, der Client formuliert sie in seiner Sprache. */
export type ErrorCode =
  | "match_full"
  | "match_over"
  | "opponent_missing"
  | "admiral_required"
  | "admiral_already_chosen"
  | "opponent_choosing"
  | "draft_pending"
  | "draft_unavailable"
  | "draft_invalid"
  | "flagship_required"
  | "flagship_not_allowed"
  | "power_and_maneuver"
  | "power_target_invalid"
  | "mark_unavailable"
  | "mark_target_invalid"
  | "swap_not_allowed"
  | "already_submitted"
  | "ship_not_in_hand"
  | "too_many_ships"
  | "slot_unavailable"
  | "command_not_in_hand"
  | "target_required"
  | "target_not_allowed"
  | "target_not_own_ship"
  | "target_wrong_lane"
  | "target_not_enemy_slot"
  | "target_not_enemy_ship"
  | "target_flagship"
  | "destination_required"
  | "destination_not_allowed"
  | "destination_unavailable"
  | "maneuver_not_own_ship"
  | "maneuver_destination_unavailable"
  | "maneuver_conflict"
  | "fire_ship_invalid"
  | "fire_target_invalid";

export type ServerMessage = { type: "state"; view: PlayerView } | { type: "round"; round: number; events: RoundEvent[] } | { type: "error"; code: ErrorCode };
