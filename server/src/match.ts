// Ein Match auf dem Server: zwei Sitzplätze, ein Brett, Decks und Hände.
// Der Server ist autoritativ: Er prüft die Züge, hält sie bis zum Aufdecken
// geheim und löst die Runde auf, sobald beide abgegeben haben. Die Phasen der
// Runde stehen in `shared/resolution.ts`. Vor Runde 1 wählt jeder verdeckt seinen
// Admiral (`shared/admirals.ts`). Nach jeder Runde wählt jeder aus dem Nachschub (`DraftOffer`) ein Schiff und
// einen Befehl, bevor er den nächsten Zug abgibt. Statt eines zweiten Menschen kann der
// Computergegner (`bot.ts`) einen Platz einnehmen; er zieht, sobald der Mensch abgibt.
// Intern sitzt Seat 0 auf der "player"-Seite des Bretts und Seat 1 auf der
// "enemy"-Seite; alles, was an Seat 1 geht, wird gespiegelt.

import { ADMIRAL_IDS, ADMIRALS, type AdmiralId } from "../../shared/admirals.ts";
import { Board, isSameSlot, maxDeploys, opposite, overdriveBonus, type PlannedMove, type Side, SLOT_COUNT } from "../../shared/board.ts";
import {
  allowsManeuverAndPower,
  type Card,
  type CommandCard,
  type CommandId,
  canTargetLane,
  canTargetShip,
  commandById,
  deckCopies,
  destinationLane,
  needsTarget,
  type ShipCard,
  shipById,
  targetsEnemyShip,
  targetsEnemySide,
} from "../../shared/cards.ts";
import { canMark, markTargets, type PlannedArrival, powerTargets } from "../../shared/powers.ts";
import type { DraftOffer, DraftPick, ErrorCode, MatchResult, OpponentView, PlayerView, RoundEvent, SlotTarget, TurnPlan } from "../../shared/protocol.ts";
import { type Commander, resolveTurns, type Turn } from "../../shared/resolution.ts";
import { type BotView, planBotDraft, planBotTurn } from "./bot.ts";
import { buildDefaultCommandDeck, buildDefaultShipDeck, type Deck } from "./deck.ts";

export type Seat = 0 | 1;

/** Höchstens so viele Schiffe und ebenso viele Befehle auf der Hand; gestapelte gleiche Karten zählen einzeln. */
const HAND_LIMIT = 10;
/** Die Starthand bekommt immer 1 Support- und 3 Kampfschiffe, jeweils zufällig aus dem Deck. */
const STARTING_SUPPORT_SHIPS = 1;
const STARTING_COMBAT_SHIPS = 3;
const STARTING_COMMANDS = 3;
/** Der Nachschub nach jeder Runde zeigt je so viele Schiffe und Befehle. */
const DRAFT_SIZE = 3;

const SEAT_SIDE: Record<Seat, Side> = { 0: "player", 1: "enemy" };

/** Ein Wert je Seite (Brett, Hive-Zähler) aus Sicht des Sitzes: Für Seat 1 tauschen die Seiten. */
function mirrorSides<T>(seat: Seat, { player, enemy }: Record<Side, T>): Record<Side, T> {
  return seat === 0 ? { player, enemy } : { player: enemy, enemy: player };
}

/** Spiegelt ein Ereignis für Seat 1: Jedes `side`-Feld, auch in verschachtelten Schiffen, wechselt die Seite. */
function mirrorEvent<T>(value: T): T {
  if (typeof value !== "object" || value === null) return value;
  return Object.fromEntries(Object.entries(value).map(([key, inner]) => [key, key === "side" ? opposite(inner as Side) : mirrorEvent(inner)])) as T;
}

class Player implements Commander {
  readonly shipDeck: Deck<ShipCard> = buildDefaultShipDeck();
  readonly commandDeck: Deck<CommandCard> = buildDefaultCommandDeck();
  readonly shipHand: ShipCard[];
  readonly commandHand: CommandCard[];
  /** Die aufgedeckten Befehle in der Reihenfolge, in der er sie gespielt hat; der Gegner sieht sie (`OpponentView`). */
  readonly playedCommands: CommandId[] = [];
  /** Vor Runde 1 gewählt (`Match.chooseAdmiral`), beim Computergegner sofort. */
  admiral: AdmiralId | null = null;
  plan: TurnPlan | null = null;
  /** Der Nachschub nach der letzten Runde, bis er gewählt hat (`Match.draft`); die Karten fehlen solange im Deck. */
  draft: { ships: ShipCard[]; commands: CommandCard[] } | null = null;

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

  /** Das Flaggschiff seines Admirals, das er in Runde 1 zusätzlich legt. */
  get flagshipCard(): ShipCard {
    return shipById(ADMIRALS[this.admiral!].flagship);
  }

  /**
   * Zieht den Nachschub: je bis zu 3 Karten, für eine volle Handhälfte keine; mit der Schrottverwertung (`salvage`) ist
   * sie die erste der Befehle. Ohne Karten gibt es nichts zu wählen.
   */
  offerDraft(salvage: boolean): void {
    const full = (hand: readonly Card[]) => hand.length >= HAND_LIMIT;
    const ships = full(this.shipHand) ? [] : this.shipDeck.drawMany(DRAFT_SIZE);
    const commands = full(this.commandHand)
      ? []
      : salvage
        ? [commandById("scrap_salvage"), ...this.commandDeck.drawMany(DRAFT_SIZE - 1)]
        : this.commandDeck.drawMany(DRAFT_SIZE);
    this.draft = ships.length > 0 || commands.length > 0 ? { ships, commands } : null;
  }

  /** Nimmt die gewählten Karten des Nachschubs auf die Hand; die übrigen gehen zurück ins Deck. */
  takeDraft(ship: number | null, command: number | null): void {
    const { ships, commands } = this.draft!;
    takeFrom(ships, ship, this.shipHand, this.shipDeck);
    takeFrom(commands, command, this.commandHand, this.commandDeck);
    this.draft = null;
  }

  get draftOffer(): DraftOffer | null {
    const { draft } = this;
    return draft && { ships: draft.ships.map((card) => card.id), commands: draft.commands.map((card) => card.id) };
  }

  drawExtra(ships: number, commands: number): { ships: number; commands: number } {
    const drawn = (count: number, draw: () => boolean) => Array.from({ length: count }, draw).filter(Boolean).length;
    return {
      ships: drawn(ships, () => drawInto(this.shipHand, this.shipDeck)),
      commands: drawn(commands, () => drawInto(this.commandHand, this.commandDeck)),
    };
  }

  /** Deckt den abgegebenen Zug auf: Seine Karten verlassen die Hand, der Befehl ist ab jetzt für den Gegner sichtbar. */
  reveal(): Turn {
    const { ships, flagship, command, maneuver, power, mark, fire } = this.plan!;
    const deploys = ships.map(({ handIndex, target }) => ({ card: this.shipHand[handIndex]!, target }));
    // Von hinten entfernen, damit die übrigen Hand-Indizes gültig bleiben.
    for (const index of ships.map((ship) => ship.handIndex).sort((a, b) => b - a)) this.shipHand.splice(index, 1);
    const card = command && this.commandHand.splice(command.handIndex, 1)[0]!;
    if (card) this.playedCommands.push(card.id);
    return {
      commander: this,
      ships: deploys,
      flagship: flagship && { card: this.flagshipCard, target: flagship },
      command: command && { card: card!, target: command.target, destination: command.destination },
      maneuver,
      power: power && { id: ADMIRALS[this.admiral!].power, target: power.target },
      mark,
      fire,
    };
  }

  /** Was der Gegner von diesem Spieler weiß; den Admiral erst, wenn beide gewählt haben. */
  publicView(admiralsChosen: boolean): OpponentView {
    return {
      admiral: admiralsChosen ? this.admiral : null,
      submitted: this.plan !== null,
      shipHandSize: this.shipHand.length,
      commandHandSize: this.commandHand.length,
      shipDeckSize: this.shipDeck.size,
      commandDeckSize: this.commandDeck.size,
      playedCommands: this.playedCommands,
    };
  }
}

const isSupport = (card: ShipCard) => card.shipClass === "support";

function drawManyWhere(deck: Deck<ShipCard>, count: number, predicate: (card: ShipCard) => boolean): ShipCard[] {
  return Array.from({ length: count }, () => deck.drawWhere(predicate)!);
}

/** Die gewählte Karte (Index in `offered`) kommt auf die Hand, die übrigen zurück ins Deck. */
function takeFrom<T extends ShipCard | CommandCard>(offered: T[], index: number | null, hand: T[], deck: Deck<T>): void {
  if (index !== null) hand.push(...offered.splice(index, 1));
  // Was in keinem Deck liegt (die Schrottverwertung), verfällt.
  deck.putBack(offered.filter((card) => deckCopies(card) > 0));
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

  /** `random` (Zahlen in [0, 1)) entscheidet über das Ziel der Plasma Frigate und den Admiral des Computergegners; Tests geben ihn fest vor. */
  constructor(
    readonly id: string,
    private readonly random: () => number = Math.random,
  ) {}

  /** Sitzplatz für ein Token: bekannter Spieler, sonst ein freier Platz; null, wenn das Match voll ist. */
  join(token: string): Seat | null {
    const known = this.players.find((player) => player.token === token);
    return known ? known.seat : this.seatPlayer(token);
  }

  /** Setzt den Computergegner auf den freien Platz; er wählt seinen Admiral sofort, zufällig. null, wenn das Match voll ist. */
  addBot(): Seat | null {
    const seat = this.seatPlayer(null);
    if (seat !== null) this.players[seat]!.admiral = ADMIRAL_IDS[Math.floor(this.random() * ADMIRAL_IDS.length)]!;
    return seat;
  }

  private seatPlayer(token: string | null): Seat | null {
    if (this.players.length >= 2) return null;
    const seat = this.players.length as Seat;
    this.players.push(new Player(token, seat));
    return seat;
  }

  /** Wählt den Admiral des Sitzes, einmal und vor Runde 1, auch schon, solange der Gegner fehlt. */
  chooseAdmiral(seat: Seat, admiral: AdmiralId): ErrorCode | null {
    const player = this.players[seat]!;
    if (player.admiral !== null) return "admiral_already_chosen";
    player.admiral = admiral;
    return null;
  }

  /** Runde 1 beginnt, sobald beide Spieler ihren Admiral gewählt haben; erst dann sieht jeder den des anderen. */
  get started(): boolean {
    return this.players.length === 2 && this.players.every((player) => player.admiral !== null);
  }

  /** Nimmt den Zug an. Gibt einen Fehlercode zurück, wenn er nicht gilt. */
  submit(seat: Seat, plan: TurnPlan): ErrorCode | null {
    const player = this.players[seat]!;
    if (this.winner !== null) return "match_over";
    if (player.admiral === null) return "admiral_required";
    if (this.players.length < 2) return "opponent_missing";
    if (!this.started) return "opponent_choosing";
    if (player.plan !== null) return "already_submitted";
    if (player.draft !== null) return "draft_pending";
    const error = this.validate(player, plan);
    if (error) return error;

    player.plan = plan;
    // Der Computergegner zieht, sobald der Mensch abgegeben hat; den fremden Plan kennt er nicht.
    for (const bot of this.players) {
      if (bot.isBot && bot.plan === null) bot.plan = planBotTurn(this.board, this.botView(bot.seat), this.round);
    }
    return null;
  }

  /** Die Wahl aus dem Nachschub: ein Schiff, wenn es welche gibt, und ein Befehl, wenn es welche gibt. */
  draft(seat: Seat, pick: DraftPick): ErrorCode | null {
    const player = this.players[seat]!;
    if (this.winner !== null) return "match_over";
    const offer = player.draft;
    if (offer === null) return "draft_unavailable";
    // Ein Index ist Pflicht, sobald es etwas zu wählen gibt.
    const valid = (index: number | null, count: number) => (index === null ? count === 0 : index >= 0 && index < count);
    if (!valid(pick.ship, offer.ships.length) || !valid(pick.command, offer.commands.length)) return "draft_invalid";
    player.takeDraft(pick.ship, pick.command);
    return null;
  }

  /** Was der Computergegner auf diesem Sitz beim Planen weiß: eigene Karten und, was jeder vom Gegner sieht. */
  botView(seat: Seat): BotView {
    const player = this.players[seat]!;
    const opponent = this.players[seat === 0 ? 1 : 0]!;
    return { side: player.side, admiral: player.admiral!, shipHand: player.shipHand, commandHand: player.commandHand, opponent: opponent.publicView(true) };
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
    const { board } = this;
    const side = player.side;
    // Der Befehl kann den Zug selbst ändern (Schnellverlegung, Freie Hand); geprüft wird er unten.
    const card = plan.command ? (player.commandHand[plan.command.handIndex] ?? null) : null;
    if (plan.ships.length > maxDeploys(this.round, card)) return "too_many_ships";
    if (this.round === 1 && plan.flagship === null) return "flagship_required";
    if (this.round > 1 && plan.flagship !== null) return "flagship_not_allowed";
    // Die Schiffe, die in dieser Runde gelegt werden (in Runde 1 zuerst das Flaggschiff), landen vor Manöver
    // und Befehlen und belegen ihre Slots; jeder Deploy zählt die vorigen zur Lane- und Flottengrenze.
    const arrivals: PlannedArrival[] = plan.flagship ? [{ card: player.flagshipCard, target: plan.flagship }] : [];
    for (const [i, { handIndex, target }] of plan.ships.entries()) {
      const card = player.shipHand[handIndex];
      if (card === undefined || plan.ships.slice(0, i).some((other) => other.handIndex === handIndex)) return "ship_not_in_hand";
      arrivals.push({ card, target });
    }
    const deploys = arrivals.map((arrival) => arrival.target);
    for (const [i, target] of deploys.entries()) {
      if (!board.canPlace(board.lane(side, target.lane), target.slotIndex, deploys.slice(0, i))) return "slot_unavailable";
    }
    // Das Grundmanöver geht in einen freien Slot; nur die Mirage darf in einen belegten und tauscht dann (Phasentausch).
    let swap = false;
    let maneuver: PlannedMove | null = null;
    if (plan.maneuver) {
      const { ship, destination } = plan.maneuver;
      const slot = board.lane(side, ship.lane).slots[ship.slotIndex];
      if (!slot?.isOccupied) return "maneuver_not_own_ship";
      const to = board.lane(side, destination.lane).slots[destination.slotIndex];
      swap = to !== undefined && to !== slot && to.isOccupied;
      if (swap && slot.card!.id !== "mirage") return "swap_not_allowed";
      if (!swap && !board.canMove(slot, destination, deploys)) return "maneuver_destination_unavailable";
      // Der Phasentausch ändert die Schiffszahl keiner Lane und steht dem Befehl nicht im Weg.
      if (!swap) maneuver = { from: slot, to: to! };
    }
    // Manöver und Bewegungsbefehl dürfen nicht im selben Slot landen und zusammen mit den Deploys die
    // Lane-Grenze nicht überschreiten; `canMove` prüft das beim Befehl mit den Deploys und dem Manöver.
    let moved: SlotTarget | null = null;
    if (plan.command) {
      const { target } = plan.command;
      if (card === null) return "command_not_in_hand";
      if (needsTarget(card) && target === null) return "target_required";
      if (!needsTarget(card) && target !== null) return "target_not_allowed";
      // Torpedo und Durchschlag zielen auf einen Slot der Gegnerseite, auch einen leeren; Wärmesucher und Traktorstrahl
      // auf ein gegnerisches Schiff; alle übrigen auf ein eigenes Schiff, auch eines, das in dieser Runde landet.
      const enemy = targetsEnemySide(card);
      const slot = target && board.lane(enemy ? opposite(side) : side, target.lane).slots[target.slotIndex];
      // Eingeplante Schiffe zählen nur auf der eigenen Seite.
      const ship = target && (slot?.card ?? (enemy ? null : arrivals.find((arrival) => isSameSlot(arrival.target, target))?.card));
      if (target && enemy && !slot) return "target_not_enemy_slot";
      if (target && targetsEnemyShip(card) && !ship) return "target_not_enemy_ship";
      if (target && !enemy && !ship) return "target_not_own_ship";
      if (target && !canTargetLane(card, target.lane)) return "target_wrong_lane";
      if (ship && !canTargetShip(card, ship)) return "target_wrong_ship";
      const { destination } = plan.command;
      if (card.moves && destination === null) return "destination_required";
      if (!card.moves && destination !== null) return "destination_not_allowed";
      // Das Grundmanöver bewegt sein Schiff, der Phasentausch auch das Schiff im Ziel-Slot; keins davon verlegt der Befehl.
      const maneuvered = plan.maneuver ? [plan.maneuver.ship, ...(swap ? [plan.maneuver.destination] : [])] : [];
      if (card.moves && target && maneuvered.some((ship) => isSameSlot(ship, target))) return "maneuver_conflict";
      // Bewegt sich ein gelegtes Schiff, ist `from` sein noch leerer Slot; `canMove` zählt Deploys nur in der Ziel-Lane.
      moved = target && destination !== null ? { lane: destinationLane(card, target.lane), slotIndex: destination } : null;
      if (slot && moved && !board.canMove(slot, moved, deploys, maneuver)) return "destination_unavailable";
    }
    // Die Admiralsfähigkeit statt des Grundmanövers, mit Freier Hand dazu; das Trugbild erscheint nicht, wo der Befehl
    // oder das Manöver ein Schiff hinbringt.
    if (plan.power) {
      if (plan.maneuver && !allowsManeuverAndPower(card)) return "power_and_maneuver";
      const blocked = [moved, plan.maneuver?.destination].filter((target) => target != null);
      const targets = powerTargets(board, side, ADMIRALS[player.admiral!].power, arrivals, blocked);
      if (!targets.some((target) => isSameSlot(target, plan.power!.target))) return "power_target_invalid";
    }
    if (plan.mark) {
      if (!canMark(board, side)) return "mark_unavailable";
      if (!markTargets(board, side).some((target) => isSameSlot(target, plan.mark!))) return "mark_target_invalid";
    }
    // Feuerbefehle: je eigenem Kampfschiff höchstens einer, auch für ein gelegtes, nicht für das Schiff des Grundmanövers
    // (es feuert nicht; beim Phasentausch feuern beide); Ziel ist eine Spalte der Gegnerseite, auch eine leere, oder ein
    // gegnerisches Schiff beim Planen, auch ein gedecktes.
    for (const [i, order] of plan.fire.entries()) {
      const { ship } = order;
      const shooter = board.lane(side, ship.lane).slots[ship.slotIndex]?.card ?? arrivals.find((arrival) => isSameSlot(arrival.target, ship))?.card;
      if (!shooter || shooter.atk === 0 || plan.fire.slice(0, i).some((other) => isSameSlot(other.ship, ship))) return "fire_ship_invalid";
      if (plan.maneuver && !swap && isSameSlot(plan.maneuver.ship, ship)) return "fire_ship_invalid";
      const valid =
        "column" in order
          ? Number.isInteger(order.column) && order.column >= 0 && order.column < SLOT_COUNT
          : board.lane(opposite(side), order.target.lane).slots[order.target.slotIndex]?.isOccupied;
      if (!valid) return "fire_target_invalid";
    }
    return null;
  }

  get isRoundComplete(): boolean {
    return this.players.length === 2 && this.players.every((player) => player.plan !== null);
  }

  /**
   * Deckt beide Züge auf und löst die Runde in Phasen auf (`resolveTurns`), die mit einem gefallenen Flaggschiff
   * sofort abbricht. Danach wird geprüft, ob ein Flaggschiff gefallen ist; sonst beginnt die nächste Runde mit dem Nachschub, den der Computergegner gleich wählt. Gibt die Ereignisse aus
   * Sicht von Seat 0 zurück.
   */
  resolveRound(): RoundEvent[] {
    const events = resolveTurns(
      this.board,
      this.players.map((player) => player.reveal()),
      this.random,
    );
    for (const player of this.players) player.plan = null;
    this.winner = this.decideWinner();
    if (this.winner === null) {
      this.round += 1;
      // Gilt schon beim Planen der neuen Runde, damit der Computergegner mit denselben Werten rechnet.
      this.board.overdrive = overdriveBonus(this.round);
      for (const player of this.players) {
        player.offerDraft(this.salvaged(player.side, events));
        if (player.isBot && player.draft) this.draft(player.seat, planBotDraft(this.botView(player.seat), player.draftOffer!));
      }
    }
    return events;
  }

  /** Ein eigener Scrap Raider hat in der Runde Schrott geborgen, und auf der Seite steht danach noch einer. */
  private salvaged(side: Side, events: RoundEvent[]): boolean {
    const scrap = events.some((event) => event.kind === "ability" && event.effect.type === "salvage" && event.source.side === side);
    return scrap && this.board.ships(side).some((slot) => slot.card!.id === "scrap_raider");
  }

  /** Wessen Flaggschiff gefallen ist, hat verloren; fallen beide in derselben Runde, ist es unentschieden. */
  private decideWinner(): Side | "draw" | null {
    const [first, second] = this.players.map((player) => this.board.flagship(player.side) === null);
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
      admiral: player.admiral,
      board: mirrorSides(seat, this.board.snapshot()),
      hiveLaunches: mirrorSides(seat, this.board.hiveLaunches),
      shipHand: player.shipHand.map((card) => card.id),
      commandHand: player.commandHand.map((card) => card.id),
      shipDeckSize: player.shipDeck.size,
      commandDeckSize: player.commandDeck.size,
      submittedPlan: player.plan,
      draft: player.draftOffer,
      opponent: opponent?.publicView(this.started) ?? null,
      result: this.resultFor(seat),
      surrendered: this.surrenderedBy !== null,
    };
  }

  eventsFor(seat: Seat, events: RoundEvent[]): RoundEvent[] {
    return seat === 0 ? events : events.map(mirrorEvent);
  }
}
