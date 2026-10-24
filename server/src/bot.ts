// Der Computergegner: plant aus Brett und eigener Hand einen Zug. Er sieht nur,
// was auch ein Spieler sieht, insbesondere nicht den Plan des Gegners.
// Faustregeln: immer so viele Schiffe legen wie erlaubt (Kampfschiffe zuerst, robuste nach vorne,
// Jäger und Support in einen gedeckten Command-Slot) und den Befehl spielen, der
// nach grober Schätzung am meisten Schaden anrichtet oder verhindert. Das
// Grundmanöver nutzt er noch nicht.

import { Board, maxDeploys, nearest, opposite, otherLane, SLOT_COUNT, type Lane, type LaneType, type Side, type Slot } from "../../shared/board.ts";
import type { CommandCard, ShipCard } from "../../shared/cards.ts";
import type { Deploy, SlotTarget, TurnPlan } from "../../shared/protocol.ts";
import { highest } from "./resolution.ts";

export interface BotHands {
  readonly side: Side;
  readonly shipHand: readonly ShipCard[];
  readonly commandHand: readonly CommandCard[];
}

/** Schiffe landen möglichst mittig in der Lane. */
const LANE_CENTER = (SLOT_COUNT - 1) / 2;
/** Ein Abschuss ist mehr wert als der reine Schaden. */
const KILL_BONUS = 2;

export function planBotTurn(board: Board, bot: BotHands, round: number): TurnPlan {
  const ships = planShips(board, bot, maxDeploys(round));
  return { ships, command: planCommand(board, bot, ships), maneuver: null };
}

// --- Schiff ---

/** Kampfschiffe vor Support, dann nach Werten. */
function shipValue(card: ShipCard): number {
  return (card.atk > 0 ? 100 : 0) + card.hp + card.shield + 2 * card.atk;
}

/** Legt die Schiffe nacheinander: jedes auf ein Brett, auf dem die vorigen schon stehen. */
function planShips(board: Board, bot: BotHands, count: number): Deploy[] {
  const ships: Deploy[] = [];
  const after = new Board();
  after.load(board.snapshot());
  const hand = bot.shipHand.map((card, handIndex) => ({ card, handIndex }));
  for (let i = 0; i < count; i++) {
    const ship = planShip(after, bot.side, hand.map((entry) => entry.card));
    if (ship === null) break;
    const { card, handIndex } = hand.splice(ship.handIndex, 1)[0]!;
    after.place(after.lane(bot.side, ship.target.lane), ship.target.slotIndex, card);
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
  const fragile = card.shipClass === "fighter" || card.shipClass === "support";
  const free = (lane: Lane, behind: Lane) => lane.slots.filter((slot) => !slot.isOccupied && behind.slots[slot.index]!.isOccupied);
  const preferred = fragile ? free(command, strike) : free(strike, command);
  for (const slot of [nearest(preferred, LANE_CENTER), strike.freeSlotNear(LANE_CENTER), command.freeSlotNear(LANE_CENTER)]) {
    if (slot && board.canPlace(slot.lane, slot.index)) {
      return { handIndex: shipHand.indexOf(card), target: { lane: slot.lane.type, slotIndex: slot.index } };
    }
  }
  return null;
}

// --- Befehl ---

interface Option {
  score: number;
  target: SlotTarget | null;
  destination: number | null;
}

function planCommand(board: Board, bot: BotHands, ships: readonly Deploy[]): TurnPlan["command"] {
  const situation = new Situation(board, bot, ships);
  let best: (Option & { handIndex: number }) | null = null;
  for (const [handIndex, card] of bot.commandHand.entries()) {
    const option = situation.evaluate(card);
    if (option && option.score > (best?.score ?? 0)) best = { handIndex, ...option };
  }
  return best && { handIndex: best.handIndex, target: best.target, destination: best.destination };
}

const attacks = (slot: Slot) => slot.card!.atk > 0;
const hp = (slot: Slot) => slot.hp;
const lowest = (slots: readonly Slot[], value: (slot: Slot) => number) => highest(slots, (slot) => -value(slot));

function untargeted(score: number): Option {
  return { score, target: null, destination: null };
}

function on(slot: Slot, score: number, destination: Slot | null = null): Option {
  return { score, target: { lane: slot.lane.type, slotIndex: slot.index }, destination: destination?.index ?? null };
}

/** Schaden, der bei einem Schiff ankommt, plus Bonus, wenn es dabei zerstört wird. */
function damageValue(slot: Slot, amount: number): number {
  const remaining = slot.hp + slot.shield;
  return Math.min(amount, remaining) + (remaining <= amount ? KILL_BONUS : 0);
}

/** Die Lage vor der Bewertung der Befehle; die geplanten Schiffe zählen schon mit, sind aber noch kein Ziel. */
class Situation {
  private readonly side: Side;
  private readonly own: readonly Slot[];
  private readonly enemies: readonly Slot[];
  /** Eigene Schiffe je Lane nach dem Deploy. */
  private readonly count: Record<LaneType, number>;
  private readonly enemyAttack: number;
  private readonly enemyMaxAttack: number;
  /** Wie viele der geplanten Schiffe vorne mitschießen. */
  private readonly strikeAttackerDeploys: number;
  private readonly deploys: readonly SlotTarget[];

  constructor(
    private readonly board: Board,
    private readonly bot: BotHands,
    ships: readonly Deploy[],
  ) {
    this.side = bot.side;
    this.own = board.ships(bot.side);
    this.enemies = board.ships(opposite(bot.side));
    this.deploys = ships.map((ship) => ship.target);
    const deploysIn = (lane: LaneType) => this.deploys.filter((deploy) => deploy.lane === lane).length;
    this.count = {
      strike: this.lane("strike").occupiedSlots.length + deploysIn("strike"),
      command: this.lane("command").occupiedSlots.length + deploysIn("command"),
    };
    this.enemyAttack = this.enemies.reduce((total, slot) => total + slot.attack, 0);
    this.enemyMaxAttack = Math.max(0, ...this.enemies.map((slot) => slot.attack));
    this.strikeAttackerDeploys = ships.filter((ship) => ship.target.lane === "strike" && bot.shipHand[ship.handIndex]!.atk > 0).length;
  }

  private lane(type: LaneType) {
    return this.board.lane(this.side, type);
  }

  /** Steht unter Beschuss und ein einzelner Treffer kann es zerstören. */
  private endangered(slot: Slot): boolean {
    return this.board.isExposed(slot) && slot.hp + slot.shield <= this.enemyMaxAttack;
  }

  /** Ob nach den Deploys ein Schiff in diesem Slot steht. */
  private occupied(lane: LaneType, index: number): boolean {
    return this.lane(lane).slots[index]!.isOccupied || this.deploys.some((deploy) => deploy.lane === lane && deploy.slotIndex === index);
  }

  /**
   * Wohin das Schiff beim Wechsel in die andere Lane geht: am liebsten in einen Slot, der mit einem
   * anderen Schiff der bisherigen Lane ein Paar bildet (vorne deckt es, hinten ist es gedeckt), sonst
   * möglichst nah. null, wenn die andere Lane keinen Platz hat.
   */
  private move(slot: Slot): { destination: Slot; paired: boolean } | null {
    const lane = this.lane(otherLane(slot.lane.type));
    const free = this.board.moveDestinations(slot, this.deploys).map((index) => lane.slots[index]!);
    const paired = free.filter((other) => other.index !== slot.index && this.occupied(slot.lane.type, other.index));
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

  /** Bewertet den Befehl; null oder Score 0, wenn er nichts bringt. */
  evaluate(card: CommandCard): Option | null {
    const { enemies, count } = this;
    switch (card.id) {
      case "orbital_strike": {
        const target = highest(enemies, hp);
        return target && untargeted(damageValue(target, 4));
      }
      case "volley_fire":
        return untargeted(enemies.reduce((total, slot) => total + damageValue(slot, 1), 0));
      case "torpedo": {
        // Der Torpedo zielt auf einen Slot: auf das Schiff, das dort am meisten verliert, falls es stehen bleibt.
        const target = highest(enemies, (slot) => damageValue(slot, 5));
        return target && on(target, damageValue(target, 5));
      }
      case "barrage":
        // Ob sich ein Gegner bewegt, sieht der Bot nicht voraus; ein kleiner fester Wert.
        return untargeted(enemies.length > 0 ? 1 : 0);
      case "emp_blast": {
        const target = highest(enemies, (slot) => slot.attack);
        return target && untargeted(target.attack);
      }
      case "targeting_jammer":
        return untargeted(this.board.lane(opposite(this.side), "strike").occupiedSlots.filter((slot) => slot.attack > 0).length);
      case "power_surge":
        return untargeted(this.lane("strike").occupiedSlots.filter(attacks).length + this.strikeAttackerDeploys);
      case "emergency_shields": {
        // Jäger schießen auf das schwächste ungedeckte Schiff: Das bekommt den Schild.
        const target = lowest(this.board.exposedShips(this.side), hp);
        return target && on(target, Math.min(3, this.enemyAttack) + (this.endangered(target) ? 1 : 0));
      }
      case "overcharge": {
        // +3 ATK gegen 2 Eigenschaden: nur für ein Kampfschiff, das das und einen Treffer übersteht.
        const sturdy = this.own.filter(
          (slot) => attacks(slot) && slot.hp > 2 + (this.board.isExposed(slot) ? this.enemyMaxAttack : 0),
        );
        const target = highest(sturdy, hp);
        return target && on(target, 2);
      }
      case "flanking_maneuver": {
        // Das robusteste Schiff nach vorne, wenn es damit ein anderes deckt; sonst ein angeschlagenes
        // Schiff vorne in einen gedeckten Slot bringen, solange vorne jemand bleibt.
        const advance = highest(this.lane("command").occupiedSlots.filter((slot) => this.pairsAfterMove(slot)), hp);
        if (advance) return this.moving(advance, 2);
        const retreat = lowest(this.lane("strike").occupiedSlots, hp);
        if (retreat && this.endangered(retreat) && this.pairsAfterMove(retreat) && count.strike >= 2) {
          return this.moving(retreat, 1.5);
        }
        return null;
      }
      case "intercept": {
        // Holt ein Schiff nach vorne: +2 ATK für ein Kampfschiff, dazu Deckung für die anderen.
        const target = highest(this.lane("command").occupiedSlots, (slot) => (attacks(slot) ? 100 : 0) + slot.hp);
        return target && this.moving(target, (attacks(target) ? 1.5 : 0) + (this.pairsAfterMove(target) ? 2 : 0));
      }
      case "recall": {
        // Zieht ein angeschlagenes Schiff nach hinten und heilt es; vorne muss aber jemand bleiben.
        // Zwei gelegte Schiffe zählen vorne mit, ohne schon auf dem Brett zu stehen.
        const target = lowest(this.lane("strike").occupiedSlots, hp);
        if (count.strike < 2 || target === null) return null;
        const healing = Math.min(2, target.card!.hp - target.hp);
        return this.moving(target, healing + (this.endangered(target) && this.pairsAfterMove(target) ? 1.5 : 0));
      }
      case "scavenge":
        // Nachziehen lohnt sich, solange die Schiffshand dünn ist; eine volle Hand verschluckt die Karte.
        return untargeted(this.bot.shipHand.length <= 3 ? 1.5 : 0.5);
      case "sensor_sweep":
        // Noch ohne Wirkung; spielen räumt wenigstens die Hand auf.
        return untargeted(0.1);
    }
  }
}
