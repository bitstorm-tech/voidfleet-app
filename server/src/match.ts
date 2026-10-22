// Ein Match auf dem Server: zwei Sitzplätze, ein Brett, Decks und Hände.
// Der Server ist autoritativ: Er prüft die Züge, hält sie bis zum Aufdecken
// geheim und löst die Runde auf, sobald beide abgegeben haben.
// Intern sitzt Seat 0 auf der "player"-Seite des Bretts und Seat 1 auf der
// "enemy"-Seite; alles, was an Seat 1 geht, wird gespiegelt.

import { needsTarget, type CommandCard, type ShipCard } from "../../shared/cards.ts";
import { Board, opposite, type BoardSnapshot, type Side } from "../../shared/board.ts";
import type { PlayerView, RoundEvent, TurnPlan } from "../../shared/protocol.ts";
import { buildDefaultCommandDeck, buildDefaultShipDeck, type Deck } from "./deck.ts";

export type Seat = 0 | 1;

const HAND_LIMIT = 6;
const STARTING_SHIPS = 3;
const STARTING_COMMANDS = 3;

const SEAT_SIDE: Record<Seat, Side> = { 0: "player", 1: "enemy" };

/** Übersetzt eine Brettseite in die Sicht des Seats. */
function sideFor(seat: Seat, side: Side): Side {
  return seat === 0 ? side : opposite(side);
}

function mirrorBoard(seat: Seat, board: BoardSnapshot): BoardSnapshot {
  return seat === 0 ? board : { player: board.enemy, enemy: board.player };
}

class Player {
  readonly shipDeck: Deck<ShipCard> = buildDefaultShipDeck();
  readonly commandDeck: Deck<CommandCard> = buildDefaultCommandDeck();
  readonly shipHand: ShipCard[];
  readonly commandHand: CommandCard[];
  plan: TurnPlan | null = null;

  constructor(
    readonly token: string,
    readonly seat: Seat,
  ) {
    this.shipHand = this.shipDeck.drawMany(STARTING_SHIPS);
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
}

function drawInto<T extends ShipCard | CommandCard>(hand: T[], deck: Deck<T>): void {
  const card = deck.draw();
  if (card !== null && hand.length < HAND_LIMIT) hand.push(card);
}

export class Match {
  readonly board = new Board();
  readonly players: Player[] = [];
  round = 1;

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

  /** Nimmt den Zug an. Gibt eine Fehlermeldung zurück, wenn er nicht gilt. */
  submit(seat: Seat, plan: TurnPlan): string | null {
    const player = this.players[seat]!;
    if (this.players.length < 2) return "Der Gegner ist noch nicht beigetreten.";
    if (player.plan !== null) return "Der Zug dieser Runde ist bereits abgegeben.";

    if (plan.ship) {
      const { handIndex, target } = plan.ship;
      if (player.shipHand[handIndex] === undefined) return "Diese Schiffskarte ist nicht auf der Hand.";
      if (!this.board.canPlace(this.board.lane(player.side, target.lane), target.slotIndex)) {
        return "Auf diesem Slot kann kein Schiff landen.";
      }
    }
    if (plan.command) {
      const { handIndex, target } = plan.command;
      const card = player.commandHand[handIndex];
      if (card === undefined) return "Diese Befehlskarte ist nicht auf der Hand.";
      if (needsTarget(card) !== (target !== null)) return `${card.name} braucht ${target ? "kein" : "ein"} Ziel.`;
      if (target && !this.board.lane(player.side, target.lane).slots[target.slotIndex]?.isOccupied) {
        return "Das Befehlsziel ist kein eigenes Schiff.";
      }
    }

    player.plan = plan;
    return null;
  }

  get isRoundComplete(): boolean {
    return this.players.length === 2 && this.players.every((player) => player.plan !== null);
  }

  /**
   * Deckt beide Züge auf und löst die Runde auf: Deploy, Befehle (noch ohne
   * Wirkung), Nachziehen. Combat und Cleanup fehlen noch. Gibt die Ereignisse
   * aus Sicht von Seat 0 zurück.
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

    for (const player of this.players) {
      const command = player.plan!.command;
      if (command) {
        const [card] = player.commandHand.splice(command.handIndex, 1);
        events.push({ kind: "command", side: player.side, cardId: card!.id, target: command.target });
      }
    }

    for (const player of this.players) {
      player.drawForRound();
      player.plan = null;
    }
    this.round += 1;
    return events;
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
    };
  }

  eventsFor(seat: Seat, events: RoundEvent[]): RoundEvent[] {
    return events.map((event) => ({ ...event, side: sideFor(seat, event.side) }));
  }
}
