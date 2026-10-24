// Der Computergegner: plant aus Brett und eigener Hand einen Zug. Er sieht nur,
// was auch ein Spieler sieht, insbesondere nicht den Plan des Gegners.
// Faustregeln: immer ein Schiff legen (Kampfschiffe zuerst, robuste nach vorne,
// Jäger und Support in einen gedeckten Command-Slot) und den Befehl spielen, der
// nach grober Schätzung am meisten Schaden anrichtet oder verhindert. Das
// Grundmanöver nutzt er noch nicht.

import { nearest, opposite, otherLane, SLOT_COUNT, type Board, type Lane, type LaneType, type Side, type Slot } from "../../shared/board.ts";
import type { CommandCard, ShipCard } from "../../shared/cards.ts";
import type { SlotTarget, TurnPlan } from "../../shared/protocol.ts";
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

export function planBotTurn(board: Board, bot: BotHands): TurnPlan {
  const ship = planShip(board, bot);
  return { ship, command: planCommand(board, bot, ship), maneuver: null };
}

// --- Schiff ---

/** Kampfschiffe vor Support, dann nach Werten. */
function shipValue(card: ShipCard): number {
  return (card.atk > 0 ? 100 : 0) + card.hp + card.shield + 2 * card.atk;
}

function planShip(board: Board, bot: BotHands): TurnPlan["ship"] {
  const card = highest(bot.shipHand, shipValue);
  if (card === null) return null;
  const strike = board.lane(bot.side, "strike");
  const command = board.lane(bot.side, "command");
  // Ein Strike-Schiff deckt den Command-Slot dahinter: Jäger und Support kommen in einen
  // gedeckten Command-Slot, robuste Schiffe vor ein ungedecktes Command-Schiff, sonst nach vorne.
  const fragile = card.shipClass === "fighter" || card.shipClass === "support";
  const free = (lane: Lane, behind: Lane) => lane.slots.filter((slot) => !slot.isOccupied && behind.slots[slot.index]!.isOccupied);
  const preferred = fragile ? free(command, strike) : free(strike, command);
  for (const slot of [nearest(preferred, LANE_CENTER), strike.freeSlotNear(LANE_CENTER), command.freeSlotNear(LANE_CENTER)]) {
    if (slot && board.canPlace(slot.lane, slot.index)) {
      return { handIndex: bot.shipHand.indexOf(card), target: { lane: slot.lane.type, slotIndex: slot.index } };
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

function planCommand(board: Board, bot: BotHands, ship: TurnPlan["ship"]): TurnPlan["command"] {
  const situation = new Situation(board, bot, ship);
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

/** Die Lage vor der Bewertung der Befehle; das geplante Schiff zählt schon mit, ist aber noch kein Ziel. */
class Situation {
  private readonly side: Side;
  private readonly own: readonly Slot[];
  private readonly enemies: readonly Slot[];
  /** Eigene Schiffe je Lane nach dem Deploy. */
  private readonly count: Record<LaneType, number>;
  private readonly enemyAttack: number;
  private readonly enemyMaxAttack: number;
  /** Ob das geplante Schiff vorne mitschießt. */
  private readonly deploysStrikeAttacker: boolean;
  private readonly deploy: SlotTarget | null;

  constructor(
    private readonly board: Board,
    private readonly bot: BotHands,
    ship: TurnPlan["ship"],
  ) {
    this.side = bot.side;
    this.own = board.ships(bot.side);
    this.enemies = board.ships(opposite(bot.side));
    this.count = {
      strike: this.lane("strike").occupiedSlots.length + (ship?.target.lane === "strike" ? 1 : 0),
      command: this.lane("command").occupiedSlots.length + (ship?.target.lane === "command" ? 1 : 0),
    };
    this.enemyAttack = this.enemies.reduce((total, slot) => total + slot.attack, 0);
    this.enemyMaxAttack = Math.max(0, ...this.enemies.map((slot) => slot.attack));
    this.deploysStrikeAttacker = ship?.target.lane === "strike" && bot.shipHand[ship.handIndex]!.atk > 0;
    this.deploy = ship?.target ?? null;
  }

  private lane(type: LaneType) {
    return this.board.lane(this.side, type);
  }

  /** Steht unter Beschuss und ein einzelner Treffer kann es zerstören. */
  private endangered(slot: Slot): boolean {
    return this.board.isExposed(slot) && slot.hp + slot.shield <= this.enemyMaxAttack;
  }

  /** Ob nach dem Deploy ein Schiff in diesem Slot steht. */
  private occupied(lane: LaneType, index: number): boolean {
    const deploy = this.deploy;
    return this.lane(lane).slots[index]!.isOccupied || (deploy?.lane === lane && deploy.slotIndex === index);
  }

  /**
   * Wohin das Schiff beim Wechsel in die andere Lane geht: am liebsten in einen Slot, der mit einem
   * anderen Schiff der bisherigen Lane ein Paar bildet (vorne deckt es, hinten ist es gedeckt), sonst
   * möglichst nah. null, wenn die andere Lane keinen Platz hat.
   */
  private move(slot: Slot): { destination: Slot; paired: boolean } | null {
    const lane = this.lane(otherLane(slot.lane.type));
    const free = this.board.moveDestinations(slot, [this.deploy]).map((index) => lane.slots[index]!);
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
      case "emp_blast": {
        const target = highest(enemies, (slot) => slot.attack);
        return target && untargeted(target.attack);
      }
      case "targeting_jammer":
        return untargeted(this.board.lane(opposite(this.side), "strike").occupiedSlots.filter((slot) => slot.attack > 0).length);
      case "power_surge":
        return untargeted(this.lane("strike").occupiedSlots.filter(attacks).length + (this.deploysStrikeAttacker ? 1 : 0));
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
        if (count.strike < 2) return null;
        const target = lowest(this.lane("strike").occupiedSlots, hp)!;
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
