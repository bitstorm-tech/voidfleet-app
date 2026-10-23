// Ein Match auf dem Server: zwei Sitzplätze, ein Brett, Decks und Hände.
// Der Server ist autoritativ: Er prüft die Züge, hält sie bis zum Aufdecken
// geheim und löst die Runde auf, sobald beide abgegeben haben. Die Phasen nach
// dem Deploy stehen in `resolution.ts`.
// Intern sitzt Seat 0 auf der "player"-Seite des Bretts und Seat 1 auf der
// "enemy"-Seite; alles, was an Seat 1 geht, wird gespiegelt.

import { canTargetLane, needsTarget, type CommandCard, type ShipCard } from "../../shared/cards.ts";
import { Board, opposite, type BoardSnapshot, type Side } from "../../shared/board.ts";
import type { ErrorCode, MatchResult, PlayerView, RoundEvent, TurnPlan } from "../../shared/protocol.ts";
import { buildDefaultCommandDeck, buildDefaultShipDeck, type Deck } from "./deck.ts";
import { resolveCleanup, resolveCombat, resolveEffects, type Commander, type PlayedCommand } from "./resolution.ts";

export type Seat = 0 | 1;

const HAND_LIMIT = 6;
/** Die Starthand bekommt immer 1 Support- und 2 Kampfschiffe, jeweils zufällig aus dem Deck. */
const STARTING_SUPPORT_SHIPS = 1;
const STARTING_COMBAT_SHIPS = 2;
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

  constructor(
    readonly token: string,
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

  /** Kein angriffsfähiges Schiff (ATK > 0) mehr auf dem Feld; wer gar keines gelegt hat, zählt genauso. */
  isDefeated(board: Board): boolean {
    return !board.ships(this.side).some((slot) => slot.card!.atk > 0);
  }
}

const isSupport = (card: ShipCard) => card.shipClass === "support";

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

  constructor(readonly id: string) {}

  /** Sitzplatz für ein Token: bekannter Spieler, sonst ein freier Platz; null, wenn das Match voll ist. */
  join(token: string): Seat | null {
    const known = this.players.find((player) => player.token === token);
    if (known) return known.seat;
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

    if (plan.ship) {
      const { handIndex, target } = plan.ship;
      if (player.shipHand[handIndex] === undefined) return "ship_not_in_hand";
      if (!this.board.canPlace(this.board.lane(player.side, target.lane), target.slotIndex)) return "slot_unavailable";
    }
    if (plan.command) {
      const { handIndex, target } = plan.command;
      const card = player.commandHand[handIndex];
      if (card === undefined) return "command_not_in_hand";
      if (needsTarget(card) && target === null) return "target_required";
      if (!needsTarget(card) && target !== null) return "target_not_allowed";
      if (target && !this.board.lane(player.side, target.lane).slots[target.slotIndex]?.isOccupied) {
        return "target_not_own_ship";
      }
      if (target && !canTargetLane(card, target.lane)) return "target_wrong_lane";
    }

    player.plan = plan;
    return null;
  }

  get isRoundComplete(): boolean {
    return this.players.length === 2 && this.players.every((player) => player.plan !== null);
  }

  /**
   * Deckt beide Züge auf und löst die Runde in Phasen auf: Deploy, Effects,
   * Combat, Cleanup. Danach wird geprüft, ob eine Flotte vernichtet ist; sonst
   * ziehen beide nach. Gibt die Ereignisse aus Sicht von Seat 0 zurück.
   */
  resolveRound(): RoundEvent[] {
    const events: RoundEvent[] = [];

    for (const player of this.players) {
      const ship = player.plan!.ship;
      if (ship) {
        const [card] = player.shipHand.splice(ship.handIndex, 1);
        this.board.place(this.board.lane(player.side, ship.target.lane), ship.target.slotIndex, card!);
        events.push({ kind: "deploy", side: player.side, cardId: card!.id, target: ship.target });
      } else {
        events.push({ kind: "pass", side: player.side });
      }
    }

    const commands: PlayedCommand[] = [];
    for (const player of this.players) {
      const command = player.plan!.command;
      if (!command) continue;
      const [card] = player.commandHand.splice(command.handIndex, 1);
      const { target } = command;
      commands.push({
        commander: player,
        card: card!,
        target: target && this.board.lane(player.side, target.lane).slots[target.slotIndex]!,
      });
      events.push({ kind: "command", side: player.side, cardId: card!.id, target });
    }

    resolveEffects(this.board, commands, events);
    resolveCombat(this.board, events);
    resolveCleanup(this.board, events);

    for (const player of this.players) player.plan = null;
    this.winner = this.decideWinner();
    if (this.winner === null) {
      for (const player of this.players) player.drawForRound();
      this.round += 1;
    }
    return events;
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
    };
  }

  eventsFor(seat: Seat, events: RoundEvent[]): RoundEvent[] {
    return seat === 0 ? events : events.map(mirrorEvent);
  }
}
