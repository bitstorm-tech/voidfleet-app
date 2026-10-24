// Der Computergegner: plant aus Brett und eigener Hand einen Zug. Er sieht nur,
// was auch ein Spieler sieht, insbesondere nicht den Plan des Gegners.
// Faustregeln: immer so viele Schiffe legen wie erlaubt (Kampfschiffe zuerst, robuste nach vorne,
// Jäger und Support in einen gedeckten Command-Slot), den Befehl spielen, der nach grober
// Schätzung am meisten Schaden anrichtet oder verhindert, und das Grundmanöver nutzen, um ein
// Schiff zu retten, in Deckung zu bringen oder ein anderes zu decken. Ab und zu weicht er einem
// vermuteten Torpedo aus oder zielt auf ein Ausweichmanöver, damit ihn ein Mensch nicht einfach
// berechnen kann.

import { Board, maxDeploys, nearest, opposite, SLOT_COUNT, slotTarget, type Lane, type LaneType, type Side, type Slot } from "../../shared/board.ts";
import type { CommandCard, ShipCard } from "../../shared/cards.ts";
import type { Deploy, RoundEvent, TurnPlan } from "../../shared/protocol.ts";
import { highest, resolveCombat } from "../../shared/resolution.ts";

export interface BotHands {
  readonly side: Side;
  readonly shipHand: readonly ShipCard[];
  readonly commandHand: readonly CommandCard[];
}

/** Schiffe landen möglichst mittig in der Lane. */
const LANE_CENTER = (SLOT_COUNT - 1) / 2;
/** Ein Abschuss ist mehr wert als der reine Schaden. */
const KILL_BONUS = 2;
/** So oft weicht er dem Schiff aus, auf das ein Torpedo am ehesten zielt, bzw. zielt auf ein Ausweichmanöver. */
const SURPRISE_CHANCE = 0.15;
/** Gewicht eines Torpedoziels, das sich wahrscheinlich bewegt. */
const UNSURE = 0.5;
/** Wie wahrscheinlich ein angeschlagenes, ungedecktes Schiff die Lane wechselt (für das Sperrfeuer). */
const FLEE_CHANCE = 0.4;

/** `random` liefert Zahlen in [0, 1), in Tests fest vorgegeben. */
export function planBotTurn(board: Board, bot: BotHands, round: number, random: () => number = Math.random): TurnPlan {
  // Geplant wird auf einer Kopie, auf der die gelegten Schiffe schon stehen.
  const after = copyOf(board);
  const ships = planShips(after, bot, maxDeploys(round));
  const situation = new Situation(after, bot, ships, random);
  const command = situation.planCommand();
  return {
    ships,
    command: command && { handIndex: command.handIndex, target: command.target && slotTarget(command.target), destination: command.destination?.index ?? null },
    maneuver: situation.planManeuver(command),
  };
}

/** Kopie zum Durchspielen, mit dem Overdrive der Runde. */
function copyOf(board: Board): Board {
  const copy = new Board();
  copy.load(board.snapshot());
  copy.overdrive = board.overdrive;
  return copy;
}

// --- Schiff ---

/** Kampfschiffe vor Support, dann nach Werten. */
function shipValue(card: ShipCard): number {
  return (card.atk > 0 ? 100 : 0) + card.hp + card.shield + 2 * card.atk;
}

/** Jäger und Support gehören in Deckung. */
function isFragile(card: ShipCard): boolean {
  return card.shipClass === "fighter" || card.shipClass === "support";
}

/** Legt die Schiffe nacheinander auf `board`, die Kopie des Bretts: jedes mit Rücksicht auf die vorigen. */
function planShips(board: Board, bot: BotHands, count: number): Deploy[] {
  const ships: Deploy[] = [];
  const hand = bot.shipHand.map((card, handIndex) => ({ card, handIndex }));
  for (let i = 0; i < count; i++) {
    const ship = planShip(board, bot.side, hand.map((entry) => entry.card));
    if (ship === null) break;
    const { card, handIndex } = hand.splice(ship.handIndex, 1)[0]!;
    board.place(board.lane(bot.side, ship.target.lane), ship.target.slotIndex, card);
    ships.push({ handIndex, target: ship.target });
  }
  return ships;
}

function planShip(board: Board, side: Side, shipHand: readonly ShipCard[]): Deploy | null {
  const card = highest(shipHand, shipValue);
  if (card === null) return null;
  const strike = board.lane(side, "strike");
  const command = board.lane(side, "command");
  // Ein Strike-Schiff deckt den Command-Slot dahinter: Jäger und Support kommen in einen
  // gedeckten Command-Slot, robuste Schiffe vor ein ungedecktes Command-Schiff, sonst nach vorne.
  const free = (lane: Lane, behind: Lane) => lane.slots.filter((slot) => !slot.isOccupied && behind.slots[slot.index]!.isOccupied);
  const preferred = isFragile(card) ? free(command, strike) : free(strike, command);
  for (const slot of [nearest(preferred, LANE_CENTER), strike.freeSlotNear(LANE_CENTER), command.freeSlotNear(LANE_CENTER)]) {
    if (slot && board.canPlace(slot.lane, slot.index)) {
      return { handIndex: shipHand.indexOf(card), target: { lane: slot.lane.type, slotIndex: slot.index } };
    }
  }
  return null;
}

// --- Befehl und Manöver ---

interface Option {
  score: number;
  /** Das eigene Zielschiff, beim Torpedo der Slot der Gegnerseite. */
  target: Slot | null;
  /** Bei Befehlen, die ihr Ziel verlegen: der Slot in der anderen Lane. */
  destination: Slot | null;
}

/** Eine Bewegung dieser Runde, per Grundmanöver oder Befehl. */
interface Move {
  ship: Slot;
  destination: Slot;
}

const attacks = (slot: Slot) => slot.card!.atk > 0;
const hp = (slot: Slot) => slot.hp;
const damaged = (slot: Slot) => slot.hp < slot.card!.hp;
const lowest = (slots: readonly Slot[], value: (slot: Slot) => number) => highest(slots, (slot) => -value(slot));

function untargeted(score: number): Option {
  return { score, target: null, destination: null };
}

function on(slot: Slot, score: number, destination: Slot | null = null): Option {
  return { score, target: slot, destination };
}

/** Schaden, der bei einem Schiff ankommt, plus Bonus, wenn es dabei zerstört wird. */
function damageValue(slot: Slot, amount: number): number {
  const remaining = slot.hp + slot.shield;
  return Math.min(amount, remaining) + (remaining <= amount ? KILL_BONUS : 0);
}

/**
 * Die Lage nach dem Deploy: `board` ist eine Kopie, auf der die geplanten Schiffe schon stehen.
 * Befehle dürfen sie treffen, wo es sich lohnt, das Grundmanöver nicht (es bewegt nur Schiffe, die schon standen).
 */
class Situation {
  private readonly side: Side;
  private readonly own: readonly Slot[];
  private readonly enemies: readonly Slot[];
  /** Die in dieser Runde gelegten Schiffe. */
  private readonly fresh: ReadonlySet<Slot>;
  private readonly enemyAttack: number;
  private readonly enemyMaxAttack: number;
  /** Der Kampf dieser Runde, falls sich niemand bewegt und keiner einen Befehl spielt. */
  private readonly preview: Board;
  private readonly shots: Extract<RoundEvent, { kind: "attack" }>[];

  constructor(
    private readonly board: Board,
    private readonly bot: BotHands,
    ships: readonly Deploy[],
    private readonly random: () => number,
  ) {
    this.side = bot.side;
    this.own = board.ships(bot.side);
    this.enemies = board.ships(opposite(bot.side));
    this.fresh = new Set(ships.map((ship) => this.lane(ship.target.lane).slots[ship.target.slotIndex]!));
    this.enemyAttack = this.enemies.reduce((total, slot) => total + slot.attack, 0);
    this.enemyMaxAttack = Math.max(0, ...this.enemies.map((slot) => slot.attack));
    this.preview = copyOf(board);
    const events: RoundEvent[] = [];
    resolveCombat(this.preview, events);
    this.shots = events.filter((event) => event.kind === "attack");
  }

  private lane(type: LaneType) {
    return this.board.lane(this.side, type);
  }

  /** Ohne die frisch gelegten Schiffe. */
  private settled(slots: readonly Slot[]): Slot[] {
    return slots.filter((slot) => !this.fresh.has(slot));
  }

  /** Steht unter Beschuss und ein einzelner Treffer kann es zerstören. */
  private endangered(slot: Slot): boolean {
    return this.board.isExposed(slot) && slot.hp + slot.shield <= this.enemyMaxAttack;
  }

  private previewOf(slot: Slot): Slot {
    return this.preview.lane(slot.lane.side, slot.lane.type).slots[slot.index]!;
  }

  /** Fällt im Kampf dieser Runde, wenn es stehen bleibt. */
  private dies(slot: Slot): boolean {
    return this.previewOf(slot).hp <= 0;
  }

  /** Was die Gegenseite im Kampf an dem Schiff gewinnt, wenn es stehen bleibt. */
  private loss(slot: Slot): number {
    const after = this.previewOf(slot);
    return damageValue(slot, slot.hp + slot.shield - after.hp - after.shield);
  }

  /** Was das Schiff mit seinem Schuss in diesem Kampf anrichtet. */
  private shotValue(slot: Slot): number {
    const shot = this.shots.find(({ attacker }) => attacker.side === slot.lane.side && attacker.lane === slot.lane.type && attacker.slotIndex === slot.index);
    return shot ? damageValue(this.board.lane(shot.target.side, shot.target.lane).slots[shot.target.slotIndex]!, shot.amount) : 0;
  }

  /**
   * Wohin das Schiff beim Wechsel in die andere Lane geht: am liebsten in einen Slot, der mit einem
   * anderen Schiff der bisherigen Lane ein Paar bildet (vorne deckt es, hinten ist es gedeckt), sonst
   * möglichst nah. `other` ist der zweite Lane-Wechsel dieser Runde: Sein Ziel ist belegt, sein Schiff
   * bildet nur noch dort ein Paar. null, wenn die andere Lane keinen Platz hat.
   */
  private move(slot: Slot, other: Move | null = null): { destination: Slot; paired: boolean } | null {
    const free = this.board.laneSwitchDestinations(slot, other ? [slotTarget(other.destination)] : []);
    const partner = (index: number) => {
      const neighbour = slot.lane.slots[index]!;
      return neighbour === other?.destination || (neighbour.isOccupied && neighbour !== slot && neighbour !== other?.ship);
    };
    const paired = free.filter((destination) => partner(destination.index));
    const destination = nearest(paired.length > 0 ? paired : free, slot.index);
    return destination && { destination, paired: paired.length > 0 };
  }

  /**
   * Vorrücken lohnt als Deckung nur, wenn das Schiff vor einem anderen Command-Schiff landet;
   * Zurückziehen bringt nur Sicherheit, wenn es hinter einem anderen Strike-Schiff landet.
   */
  private pairsAfterMove(slot: Slot): boolean {
    return this.move(slot)?.paired ?? false;
  }

  /** Befehl auf ein Schiff, das dabei die Lane wechselt; null, wenn die andere Lane keinen Platz hat. */
  private moving(slot: Slot | null, score: number): Option | null {
    const move = slot && this.move(slot);
    return move && on(slot!, score, move.destination);
  }

  /** Ein Strike-Schiff, hinter dem ein Schiff steht, das ohne es ungedeckt wäre. */
  private uncovers(slot: Slot): boolean {
    return slot.lane.type === "strike" && this.board.lane(slot.lane.side, "command").slots[slot.index]!.isOccupied;
  }

  /**
   * Wie gern ein Torpedo auf dieses Schiff zielt, aus Sicht der Gegenseite: der Schaden, voll für ein
   * Schiff, das wahrscheinlich stehen bleibt (unbeschädigt, gedeckt hinten oder einziger Angreifer
   * vorne), halb für eines, das ausweichen könnte. So zielt der Bot selbst, so erwartet er es vom Gegner.
   */
  private torpedoValue(slot: Slot): number {
    const strike = this.board.lane(slot.lane.side, "strike");
    const stays =
      !damaged(slot) ||
      !this.board.isExposed(slot) ||
      (slot.lane.type === "strike" && !strike.occupiedSlots.some((other) => other !== slot && attacks(other)));
    return damageValue(slot, 5) * (stays ? 1 : UNSURE);
  }

  /** Wohin sich ein angeschlagenes gegnerisches Strike-Schiff, das sonst fällt, am ehesten zurückzieht. */
  private likelyRetreat(): Move | null {
    const fleeing = this.board.lane(opposite(this.side), "strike").occupiedSlots.filter(
      (slot) => damaged(slot) && this.dies(slot) && this.pairsAfterMove(slot),
    );
    const ship = highest(fleeing, (slot) => damageValue(slot, 5));
    return ship && { ship, destination: this.move(ship)!.destination };
  }

  /** Der Befehl mit dem größten geschätzten Nutzen; null, wenn keiner etwas bringt. */
  planCommand(): (Option & { handIndex: number }) | null {
    let best: (Option & { handIndex: number }) | null = null;
    for (const [handIndex, card] of this.bot.commandHand.entries()) {
      const option = this.evaluate(card);
      if (option && option.score > (best?.score ?? 0)) best = { handIndex, ...option };
    }
    return best;
  }

  /** Bewertet den Befehl; null oder Score 0, wenn er nichts bringt. */
  private evaluate(card: CommandCard): Option | null {
    const { enemies, fresh } = this;
    const strikeCount = this.lane("strike").occupiedSlots.length;
    switch (card.id) {
      case "orbital_strike": {
        const target = highest(enemies, hp);
        return target && untargeted(damageValue(target, 4));
      }
      case "volley_fire":
        return untargeted(enemies.reduce((total, slot) => total + damageValue(slot, 1), 0));
      case "torpedo": {
        // Er trifft, wer nach allen Bewegungen im Slot steht: meist ein Schiff, das wohl stehen bleibt,
        // ab und zu der Slot, in den sich ein angeschlagenes Strike-Schiff am ehesten zurückzieht.
        const retreat = this.random() < SURPRISE_CHANCE ? this.likelyRetreat() : null;
        if (retreat) return on(retreat.destination, damageValue(retreat.ship, 5) * UNSURE);
        const target = highest(enemies, (slot) => this.torpedoValue(slot));
        return target && on(target, this.torpedoValue(target));
      }
      case "barrage": {
        // Trifft nur, wer die Lane wechselt: am ehesten angeschlagene Gegner, die sonst im Kampf fallen.
        // Mehr als zwei Bewegungen (Manöver und Befehl) hat keine Seite.
        const fleeing = enemies.filter((slot) => damaged(slot) && this.dies(slot));
        const values = fleeing.map((slot) => FLEE_CHANCE * damageValue(slot, 3)).sort((a, b) => b - a);
        return untargeted(enemies.length > 0 ? 0.5 + (values[0] ?? 0) + (values[1] ?? 0) : 0);
      }
      case "emp_blast": {
        const target = highest(enemies, (slot) => slot.attack);
        return target && untargeted(target.attack);
      }
      case "targeting_jammer":
        return untargeted(this.board.lane(opposite(this.side), "strike").occupiedSlots.filter((slot) => slot.attack > 0).length);
      case "power_surge":
        return untargeted(this.lane("strike").occupiedSlots.filter(attacks).length);
      case "emergency_shields": {
        // Jäger schießen auf das schwächste ungedeckte Schiff: Das bekommt den Schild, auch ein frisch
        // gelegtes Kampfschiff vorne.
        const candidates = this.board.exposedShips(this.side).filter((slot) => !fresh.has(slot) || (slot.lane.type === "strike" && attacks(slot)));
        const target = lowest(candidates, hp);
        return target && on(target, Math.min(3, this.enemyAttack) + (this.endangered(target) ? 1 : 0));
      }
      case "overcharge": {
        // +3 ATK gegen 2 Eigenschaden: nur für ein Kampfschiff, das das und einen Treffer übersteht,
        // auch für eines, das gerade vorne landet.
        const sturdy = this.own.filter(
          (slot) =>
            attacks(slot) &&
            (!fresh.has(slot) || slot.lane.type === "strike") &&
            slot.hp > 2 + (this.board.isExposed(slot) ? this.enemyMaxAttack : 0),
        );
        const target = highest(sturdy, hp);
        return target && on(target, 2);
      }
      case "flanking_maneuver": {
        // Das robusteste Schiff nach vorne, wenn es damit ein anderes deckt; sonst ein angeschlagenes
        // Schiff vorne in einen gedeckten Slot bringen, solange vorne jemand bleibt.
        const advance = highest(this.settled(this.lane("command").occupiedSlots).filter((slot) => this.pairsAfterMove(slot)), hp);
        if (advance) return this.moving(advance, 2);
        const retreat = lowest(this.settled(this.lane("strike").occupiedSlots), hp);
        if (retreat && this.endangered(retreat) && this.pairsAfterMove(retreat) && strikeCount >= 2) {
          return this.moving(retreat, 1.5);
        }
        return null;
      }
      case "intercept": {
        // Holt ein Schiff nach vorne: +2 ATK für ein Kampfschiff, dazu Deckung für die anderen. Ein
        // frisch in die Command-Lane gelegtes Kampfschiff darf sofort mit.
        const candidates = this.lane("command").occupiedSlots.filter((slot) => !fresh.has(slot) || attacks(slot));
        const target = highest(candidates, (slot) => (attacks(slot) ? 100 : 0) + slot.hp);
        return target && this.moving(target, (attacks(target) ? 1.5 : 0) + (this.pairsAfterMove(target) ? 2 : 0));
      }
      case "recall": {
        // Zieht ein angeschlagenes Schiff nach hinten und heilt es; vorne muss aber jemand bleiben,
        // gelegte Schiffe zählen mit.
        const target = lowest(this.settled(this.lane("strike").occupiedSlots), hp);
        if (strikeCount < 2 || target === null) return null;
        const healing = Math.min(2, target.card!.hp - target.hp);
        return this.moving(target, healing + (this.endangered(target) && this.pairsAfterMove(target) ? 1.5 : 0));
      }
      case "scavenge":
        // Nachziehen lohnt sich, solange die Schiffshand dünn ist; eine volle Hand verschluckt die Karte.
        return untargeted(this.bot.shipHand.length <= 3 ? 1.5 : 0.5);
    }
  }

  /**
   * Das Grundmanöver neben dem geplanten Befehl: Es lässt dessen Zielschiff in Ruhe und meidet den Slot,
   * in den der Befehl verlegt. Erst Rückzug, dann Deckung, dann Vorrücken, sonst selten ein Ausweichen.
   */
  planManeuver(command: Option | null): TurnPlan["maneuver"] {
    const other = command?.destination ? { ship: command.target!, destination: command.destination } : null;
    const movable = this.settled(this.own).filter((slot) => slot !== command?.target);
    const move =
      this.retreat(movable, other) ??
      this.takeCover(movable, other) ??
      this.advance(movable, other) ??
      (this.random() < SURPRISE_CHANCE ? this.dodge(movable, other) : null);
    return move && { ship: slotTarget(move.ship), destination: slotTarget(move.destination) };
  }

  /** Kampfschiffe vorne, nachdem `other` die Lane gewechselt hat; `except` zählt nicht mit. */
  private attackersInFront(except: Slot | null, other: Move | null): number {
    return this.own.filter((slot) => slot !== except && attacks(slot) && (slot === other?.ship ? other.destination : slot).lane.type === "strike").length;
  }

  /** Ob außer `except` noch ein Kampfschiff in dieser Runde feuert. */
  private attackerRemains(except: Slot): boolean {
    return this.own.some((slot) => slot !== except && attacks(slot));
  }

  /**
   * Rückzug: Ein angeschlagenes Strike-Schiff, das sonst im Kampf fällt, geht in einen gedeckten
   * Command-Slot, wenn der Verlust schwerer wiegt als sein verschenkter Schuss, vorne ein Angreifer
   * bleibt und dahinter niemand ungedeckt zurückbleibt.
   */
  private retreat(movable: readonly Slot[], other: Move | null): Move | null {
    const candidates = movable.filter(
      (slot) =>
        slot.lane.type === "strike" &&
        damaged(slot) &&
        this.dies(slot) &&
        this.loss(slot) > this.shotValue(slot) &&
        !this.uncovers(slot) &&
        this.attackersInFront(slot, other) > 0 &&
        this.move(slot, other)?.paired,
    );
    const ship = highest(candidates, (slot) => this.loss(slot) - this.shotValue(slot));
    return ship && { ship, destination: this.move(ship, other)!.destination };
  }

  /**
   * Deckung: Ein ungedecktes Command-Schiff, das im Kampf mehr verliert, als sein Schuss bringt, rückt
   * innerhalb der Lane hinter ein Strike-Schiff, das stehen bleibt (oder hinter das Ziel von `other`).
   */
  private takeCover(movable: readonly Slot[], other: Move | null): Move | null {
    const covered = (slot: Slot) => {
      const front = this.lane("strike").slots[slot.index]!;
      return front === other?.destination || (front.isOccupied && front !== other?.ship);
    };
    const shelter = (slot: Slot) => {
      const free = this.board.maneuverDestinations(slot, other ? [slotTarget(other.destination)] : []);
      return nearest(free.filter((destination) => destination.lane === slot.lane && covered(destination)), slot.index);
    };
    const candidates = movable.filter(
      (slot) => slot.lane.type === "command" && this.board.isExposed(slot) && this.loss(slot) > this.shotValue(slot) && shelter(slot),
    );
    const ship = highest(candidates, (slot) => this.loss(slot) - this.shotValue(slot));
    return ship && { ship, destination: shelter(ship)! };
  }

  /** Vorrücken: Greift vorne niemand an, deckt ein robustes Command-Schiff ein anderes. */
  private advance(movable: readonly Slot[], other: Move | null): Move | null {
    if (this.enemyAttack === 0 || this.attackersInFront(null, other) > 0) return null;
    const candidates = movable.filter(
      (slot) =>
        slot.lane.type === "command" &&
        attacks(slot) &&
        !isFragile(slot.card!) &&
        slot.hp + slot.shield > this.enemyMaxAttack &&
        this.attackerRemains(slot) &&
        this.move(slot, other)?.paired,
    );
    const ship = highest(candidates, hp);
    return ship && { ship, destination: this.move(ship, other)!.destination };
  }

  /** Ausweichen: das Schiff, auf das ein gegnerischer Torpedo am ehesten zielt, wechselt die Lane. */
  private dodge(movable: readonly Slot[], other: Move | null): Move | null {
    const ship = highest(this.settled(this.own), (slot) => this.torpedoValue(slot));
    if (ship === null || !movable.includes(ship) || this.uncovers(ship) || !this.attackerRemains(ship)) return null;
    const move = this.move(ship, other);
    return move && { ship, destination: move.destination };
  }
}
