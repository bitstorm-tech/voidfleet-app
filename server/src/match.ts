// Ein Match auf dem Server: zwei Sitzplätze, ein Brett, Decks und Hände.
// Der Server ist autoritativ: Er prüft die Züge, hält sie bis zum Aufdecken
// geheim und löst die Runde auf, sobald beide abgegeben haben. Die Phasen nach
// dem Deploy stehen in `resolution.ts`. Statt eines zweiten Menschen kann der
// Computergegner (`bot.ts`) einen Platz einnehmen; er zieht, sobald der Mensch abgibt.
// Intern sitzt Seat 0 auf der "player"-Seite des Bretts und Seat 1 auf der
// "enemy"-Seite; alles, was an Seat 1 geht, wird gespiegelt.

import { canTargetLane, needsTarget, targetsEnemySlot, type CommandCard, type ShipCard } from "../../shared/cards.ts";
import { Board, isSameSlot, maxDeploys, opposite, otherLane, overdriveBonus, type BoardSnapshot, type Side } from "../../shared/board.ts";
import type { ErrorCode, MatchResult, PlayerView, RoundEvent, SlotTarget, TurnPlan } from "../../shared/protocol.ts";
import { planBotTurn } from "./bot.ts";
import { buildDefaultCommandDeck, buildDefaultShipDeck, type Deck } from "./deck.ts";
import {
  resolveCleanup,
  resolveCombat,
  resolveEffects,
  resolveManeuver,
  type Commander,
  type PlayedCommand,
} from "./resolution.ts";

export type Seat = 0 | 1;

const HAND_LIMIT = 6;
/** Die Starthand bekommt immer 1 Support- und 3 Kampfschiffe, jeweils zufällig aus dem Deck. */
const STARTING_SUPPORT_SHIPS = 1;
const STARTING_COMBAT_SHIPS = 3;
const STARTING_COMMANDS = 3;

const SEAT_SIDE: Record<Seat, Side> = { 0: "player", 1: "enemy" };

function mirrorBoard(seat: Seat, board: BoardSnapshot): BoardSnapshot {
  return seat === 0 ? board : { player: board.enemy, enemy: board.player };
}

/** Spiegelt ein Ereignis für Seat 1: Jedes `side`-Feld, auch in verschachtelten Schiffen, wechselt die Seite. */
function mirrorEvent<T>(value: T): T {
  if (typeof value !== "object" || value === null) return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, inner]) => [key, key === "side" ? opposite(inner as Side) : mirrorEvent(inner)]),
  ) as T;
}

class Player implements Commander {
  readonly shipDeck: Deck<ShipCard> = buildDefaultShipDeck();
  readonly commandDeck: Deck<CommandCard> = buildDefaultCommandDeck();
  readonly shipHand: ShipCard[];
  readonly commandHand: CommandCard[];
  plan: TurnPlan | null = null;

  /** Der Computergegner hat kein Token; er wird nie über einen Socket angesprochen. */
  constructor(
    readonly token: string | null,
    readonly seat: Seat,
  ) {
    this.shipHand = [
      ...drawManyWhere(this.shipDeck, STARTING_SUPPORT_SHIPS, isSupport),
      ...drawManyWhere(this.shipDeck, STARTING_COMBAT_SHIPS, (card) => !isSupport(card)),
    ];
    this.commandHand = this.commandDeck.drawMany(STARTING_COMMANDS);
  }

  get side(): Side {
    return SEAT_SIDE[this.seat];
  }

  get isBot(): boolean {
    return this.token === null;
  }

  /** 1 Schiff + 1 Befehl nachziehen. Ist die Handhälfte voll, verfällt die Karte. */
  drawForRound(): void {
    drawInto(this.shipHand, this.shipDeck);
    drawInto(this.commandHand, this.commandDeck);
  }

  drawExtra(): { ships: number; commands: number } {
    return {
      ships: drawInto(this.shipHand, this.shipDeck) ? 1 : 0,
      commands: drawInto(this.commandHand, this.commandDeck) ? 1 : 0,
    };
  }

  /** Kein Kampfschiff (ATK > 0) mehr, weder auf dem Feld noch auf der Hand. */
  isDefeated(board: Board): boolean {
    return !board.ships(this.side).some((slot) => isCombat(slot.card!)) && !this.shipHand.some(isCombat);
  }
}

const isSupport = (card: ShipCard) => card.shipClass === "support";
const isCombat = (card: ShipCard) => card.atk > 0;

function drawManyWhere(deck: Deck<ShipCard>, count: number, predicate: (card: ShipCard) => boolean): ShipCard[] {
  return Array.from({ length: count }, () => deck.drawWhere(predicate)!);
}

/** Zieht eine Karte; true, wenn sie auf der Hand gelandet ist. */
function drawInto<T extends ShipCard | CommandCard>(hand: T[], deck: Deck<T>): boolean {
  const card = deck.draw();
  if (card === null || hand.length >= HAND_LIMIT) return false;
  hand.push(card);
  return true;
}

export class Match {
  readonly board = new Board();
  readonly players: Player[] = [];
  round = 1;
  /** Gewinner aus Sicht des Bretts, "draw" bei Gleichstand; null, solange gespielt wird. */
  winner: Side | "draw" | null = null;
  /** Wer aufgegeben hat; null, wenn das Match auf dem Brett entschieden wurde oder noch läuft. */
  surrenderedBy: Side | null = null;

  constructor(readonly id: string) {}

  /** Sitzplatz für ein Token: bekannter Spieler, sonst ein freier Platz; null, wenn das Match voll ist. */
  join(token: string): Seat | null {
    const known = this.players.find((player) => player.token === token);
    return known ? known.seat : this.seatPlayer(token);
  }

  /** Setzt den Computergegner auf den freien Platz; null, wenn das Match voll ist. */
  addBot(): Seat | null {
    return this.seatPlayer(null);
  }

  private seatPlayer(token: string | null): Seat | null {
    if (this.players.length >= 2) return null;
    const seat = this.players.length as Seat;
    this.players.push(new Player(token, seat));
    return seat;
  }

  /** Nimmt den Zug an. Gibt einen Fehlercode zurück, wenn er nicht gilt. */
  submit(seat: Seat, plan: TurnPlan): ErrorCode | null {
    const player = this.players[seat]!;
    if (this.players.length < 2) return "opponent_missing";
    if (this.winner !== null) return "match_over";
    if (player.plan !== null) return "already_submitted";
    const error = this.validate(player, plan);
    if (error) return error;

    player.plan = plan;
    // Der Computergegner zieht, sobald der Mensch abgegeben hat; den fremden Plan kennt er nicht.
    for (const bot of this.players) {
      if (bot.isBot && bot.plan === null) bot.plan = planBotTurn(this.board, bot, this.round);
    }
    return null;
  }

  /** Gibt das Match auf: Der Gegner gewinnt sofort, ein abgegebener Zug verfällt. */
  surrender(seat: Seat): ErrorCode | null {
    if (this.players.length < 2) return "opponent_missing";
    if (this.winner !== null) return "match_over";
    const side = SEAT_SIDE[seat];
    this.surrenderedBy = side;
    this.winner = opposite(side);
    for (const player of this.players) player.plan = null;
    return null;
  }

  private validate(player: Player, plan: TurnPlan): ErrorCode | null {
    if (plan.ships.length > maxDeploys(this.round)) return "too_many_ships";
    // Die Schiffe, die in dieser Runde gelegt werden, landen vor Manöver und Befehlen und belegen ihre Slots;
    // jeder Deploy zählt die vorigen zur Lane- und Flottengrenze.
    const deploys = plan.ships.map((ship) => ship.target);
    for (const [i, { handIndex, target }] of plan.ships.entries()) {
      if (player.shipHand[handIndex] === undefined || plan.ships.slice(0, i).some((other) => other.handIndex === handIndex)) {
        return "ship_not_in_hand";
      }
      if (!this.board.canPlace(this.board.lane(player.side, target.lane), target.slotIndex, deploys.slice(0, i))) return "slot_unavailable";
    }
    // Manöver und Bewegungsbefehl dürfen nicht im selben Slot landen und zusammen mit den Deploys die
    // Lane-Grenze nicht überschreiten; `canMove` prüft das beim Befehl mit allen Ankünften.
    const maneuver = plan.maneuver?.destination ?? null;
    if (plan.maneuver) {
      const { ship, destination } = plan.maneuver;
      const slot = this.board.lane(player.side, ship.lane).slots[ship.slotIndex];
      if (!slot?.isOccupied) return "maneuver_not_own_ship";
      if (!this.board.canMove(slot, destination, deploys)) return "maneuver_destination_unavailable";
    }
    if (plan.command) {
      const { handIndex, target } = plan.command;
      const card = player.commandHand[handIndex];
      if (card === undefined) return "command_not_in_hand";
      if (needsTarget(card) && target === null) return "target_required";
      if (!needsTarget(card) && target !== null) return "target_not_allowed";
      // Der Torpedo zielt auf einen Slot der Gegnerseite, auch einen leeren; alle übrigen auf ein eigenes Schiff.
      const enemySlot = targetsEnemySlot(card);
      const slot = target && this.board.lane(enemySlot ? opposite(player.side) : player.side, target.lane).slots[target.slotIndex];
      if (target && enemySlot && !slot) return "target_not_enemy_slot";
      if (target && !enemySlot && !slot?.isOccupied && !deploys.some((deploy) => isSameSlot(target, deploy))) return "target_not_own_ship";
      if (target && !canTargetLane(card, target.lane)) return "target_wrong_lane";
      const { destination } = plan.command;
      if (card.moves && destination === null) return "destination_required";
      if (!card.moves && destination !== null) return "destination_not_allowed";
      if (card.moves && target && plan.maneuver && isSameSlot(target, plan.maneuver.ship)) return "maneuver_conflict";
      // Bewegt sich ein gelegtes Schiff, ist `from` sein noch leerer Slot; `canMove` zählt Deploys nur in der Ziel-Lane.
      const to = target && destination !== null ? { lane: otherLane(target.lane), slotIndex: destination } : null;
      if (slot && to && !this.board.canMove(slot, to, [...deploys, maneuver])) return "destination_unavailable";
    }
    return null;
  }

  get isRoundComplete(): boolean {
    return this.players.length === 2 && this.players.every((player) => player.plan !== null);
  }

  /**
   * Deckt beide Züge auf und löst die Runde in Phasen auf: Deploy, Manöver, Effects,
   * Combat, Cleanup. Danach ziehen beide nach, und es wird geprüft, ob eine Flotte
   * vernichtet ist; sonst beginnt die nächste Runde. Gibt die Ereignisse aus Sicht von Seat 0 zurück.
   */
  resolveRound(): RoundEvent[] {
    const events: RoundEvent[] = [];

    for (const player of this.players) {
      const { ships } = player.plan!;
      for (const { handIndex, target } of ships) {
        const card = player.shipHand[handIndex]!;
        this.board.place(this.board.lane(player.side, target.lane), target.slotIndex, card);
        events.push({ kind: "deploy", side: player.side, cardId: card.id, target });
      }
      // Von hinten entfernen, damit die übrigen Hand-Indizes gültig bleiben.
      for (const index of ships.map((ship) => ship.handIndex).sort((a, b) => b - a)) player.shipHand.splice(index, 1);
      if (ships.length === 0) events.push({ kind: "pass", side: player.side });
    }

    // Jede Seite bewegt nur eigene Schiffe, die Manöver kommen sich also nicht in die Quere.
    for (const player of this.players) {
      const maneuver = player.plan!.maneuver;
      if (!maneuver) continue;
      const slotOf = ({ lane, slotIndex }: SlotTarget) => this.board.lane(player.side, lane).slots[slotIndex]!;
      resolveManeuver(slotOf(maneuver.ship), slotOf(maneuver.destination), events);
    }

    const commands: PlayedCommand[] = [];
    for (const player of this.players) {
      const command = player.plan!.command;
      if (!command) continue;
      const [card] = player.commandHand.splice(command.handIndex, 1);
      const { destination } = command;
      // Ein Slot der Gegnerseite bleibt stehen, ein eigenes Ziel folgt dem Manöver.
      const side = targetsEnemySlot(card!) ? opposite(player.side) : player.side;
      const target = command.target && (side === player.side ? this.afterManeuver(player, command.target) : command.target);
      commands.push({
        commander: player,
        card: card!,
        target: target && this.board.lane(side, target.lane).slots[target.slotIndex]!,
        destination: target && destination !== null ? this.board.lane(side, otherLane(target.lane)).slots[destination]! : null,
      });
      events.push({ kind: "command", side: player.side, cardId: card!.id, target: target && { side, ...target } });
    }

    resolveEffects(this.board, commands, events);
    resolveCombat(this.board, events);
    resolveCleanup(this.board, events);

    for (const player of this.players) {
      player.plan = null;
      player.drawForRound();
    }
    this.winner = this.decideWinner();
    if (this.winner === null) {
      this.round += 1;
      // Gilt schon beim Planen der neuen Runde, damit der Computergegner mit denselben Werten rechnet.
      this.board.overdrive = overdriveBonus(this.round);
    }
    return events;
  }

  /** Wo ein Befehlsziel nach dem Manöver steht: Zielt der Befehl auf das manövrierte Schiff, folgt er ihm. */
  private afterManeuver(player: Player, target: SlotTarget): SlotTarget {
    const maneuver = player.plan!.maneuver;
    if (!maneuver || !isSameSlot(target, maneuver.ship)) return target;
    return maneuver.destination;
  }

  private decideWinner(): Side | "draw" | null {
    const [first, second] = this.players.map((player) => player.isDefeated(this.board));
    if (first && second) return "draw";
    if (first) return this.players[1]!.side;
    if (second) return this.players[0]!.side;
    return null;
  }

  private resultFor(seat: Seat): MatchResult | null {
    if (this.winner === null) return null;
    if (this.winner === "draw") return "draw";
    return this.winner === SEAT_SIDE[seat] ? "won" : "lost";
  }

  view(seat: Seat): PlayerView {
    const player = this.players[seat]!;
    const opponent = this.players[seat === 0 ? 1 : 0];
    return {
      matchId: this.id,
      round: this.round,
      board: mirrorBoard(seat, this.board.snapshot()),
      shipHand: player.shipHand.map((card) => card.id),
      commandHand: player.commandHand.map((card) => card.id),
      shipDeckSize: player.shipDeck.size,
      commandDeckSize: player.commandDeck.size,
      submittedPlan: player.plan,
      opponent: { joined: opponent !== undefined, submitted: opponent?.plan != null },
      result: this.resultFor(seat),
      surrendered: this.surrenderedBy !== null,
    };
  }

  eventsFor(seat: Seat, events: RoundEvent[]): RoundEvent[] {
    return seat === 0 ? events : events.map(mirrorEvent);
  }
}
