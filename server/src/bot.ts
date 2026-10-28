// Der Computergegner: plant aus Brett und eigener Hand einen Zug. Er sieht nur,
// was auch ein Spieler sieht, insbesondere nicht den Plan des Gegners.
// Faustregeln: immer so viele Schiffe legen wie erlaubt (in Runde 1 das Flaggschiff mittig in die
// Command-Lane und das robusteste Kampfschiff davor; sonst Kampfschiffe zuerst, robuste nach vorne,
// Jäger und Support in einen gedeckten Command-Slot), den Befehl spielen, der nach grober
// Schätzung am meisten Schaden anrichtet oder verhindert, und das Grundmanöver nutzen, um das
// Flaggschiff oder ein anderes Schiff zu retten, in Deckung zu bringen oder ein anderes zu decken.
// Die Admiralsfähigkeit nimmt er statt des Manövers, wenn sie im Kampf dieser Runde mehr bringt.
// Befehle, die im Kampf dieser Runde wirken, spielt er auf einer Kopie durch; was vom unbekannten
// Gegnerzug abhängt (Gegenmaßnahmen, Funkstille, Minenfeld), schätzt er.
// Die Feuerbefehle gibt er zuletzt, für den fertigen Zug (`aimFire`): je Schütze eine Spalte der Gegnerseite, in der
// das vorderste Schiff den Schuss nimmt und Overkill auf das Schiff dahinter durchgeht, oder ein Schiff, dem der Schuss
// folgt, wenn es ausweicht, der aber an Deckung verpufft. Fällt das gegnerische Flaggschiff, feuern so viele darauf,
// wie es braucht, sonst sichert er wertvolle Abschüsse, ohne Schaden zu verschenken, und wer übrig ist, beschädigt das
// Flaggschiff oder das beste Ziel. Schiffsfeuer nimmt er für ein Ziel, das dabei fällt oder schwer getroffen wird und
// nur ungedeckt ausweichen kann; Spaltenfeuer für alles andere, auch um die Deckung davor zu brechen. Was der Gegner
// beschießt, vermutet er mit derselben Zielwahl aus dessen Sicht (`predictFire`); im Probekampf zielen beide so. Droht
// einem wertvollen Schiff dabei der Fall oder schwerer Schaden, weicht es per Grundmanöver aus (`evade`), in eine andere
// Spalte gegen Spaltenfeuer, hinter Deckung gegen Schiffsfeuer, und ein neues Schiff stellt sich vor ein Command-Schiff
// unter Schiffsfeuer. Ab und zu weicht er einem vermuteten Torpedo aus, zielt auf ein Ausweichmanöver oder hält vor,
// wohin das gegnerische Flaggschiff in Deckung ausweicht, damit ihn ein Mensch nicht einfach berechnen kann.

import { ABILITY_VALUES, ADMIRALS, type AdmiralId, type PowerId } from "../../shared/admirals.ts";
import {
  Board,
  isSameSlot,
  type LaneType,
  MAX_SHIPS_PER_SIDE,
  maxDeploys,
  nearest,
  opposite,
  otherLane,
  type Side,
  SLOT_COUNT,
  type Slot,
  slotTarget,
} from "../../shared/board.ts";
import {
  allowsManeuverAndPower,
  COMMANDS,
  type CommandCard,
  type CommandId,
  canTargetLane,
  canTargetShip,
  commandById,
  deckCopies,
  isFlagship,
  isToken,
  type ShipCard,
  shipById,
  targetsEnemyShip,
} from "../../shared/cards.ts";
import { canMark, powerTargets } from "../../shared/powers.ts";
import type { Deploy, DraftOffer, DraftPick, FireOrder, OpponentView, RoundEvent, SlotTarget, TurnPlan } from "../../shared/protocol.ts";
import {
  bindFire,
  type Commander,
  highest,
  resolveCleanup,
  resolveCombat,
  resolveEffects,
  resolveGuardianShields,
  resolveManeuver,
  resolvePower,
  resolveSwap,
} from "../../shared/resolution.ts";

/** Was der Computergegner beim Planen weiß: Seite, Admiral, eigene Hände und, was jeder vom Gegner sieht. */
export interface BotView {
  readonly side: Side;
  readonly admiral: AdmiralId;
  readonly shipHand: readonly ShipCard[];
  readonly commandHand: readonly CommandCard[];
  /** Aus `OpponentView`: sein Admiral, die Befehle, die er schon gespielt hat, und wie viele Karten er noch hält. */
  readonly opponent: Pick<OpponentView, "admiral" | "playedCommands" | "commandHandSize" | "shipHandSize">;
}

/** Schiffe landen möglichst mittig in der Lane. */
const LANE_CENTER = (SLOT_COUNT - 1) / 2;
/** Runde 1: Das Flaggschiff kommt mittig in die Command-Lane, das robusteste Kampfschiff davor. */
const FLAGSHIP_SLOT = 2;
/** Ein Abschuss ist mehr wert als der reine Schaden. */
const KILL_BONUS = 2;
/** Schaden am Flaggschiff zählt doppelt; sein Fall entscheidet das Match. */
const FLAGSHIP_WEIGHT = 2;
const DECISIVE = 1000;
/** Ein Flaggschiff vorne zieht sich ab so wenigen HP in Deckung zurück. */
const FLAGSHIP_RETREAT_HP = 7;
/** So oft weicht er dem Schiff aus, auf das ein Torpedo am ehesten zielt, bzw. zielt auf ein Ausweichmanöver. */
const SURPRISE_CHANCE = 0.15;
/** Gewicht eines Torpedoziels, das sich wahrscheinlich bewegt. */
const UNSURE = 0.5;
/** Wie wahrscheinlich ein angeschlagenes, ungedecktes Schiff die Lane wechselt (für das Sperrfeuer). */
const FLEE_CHANCE = 0.4;
/** So oft tauscht die Mirage den Platz, wenn ein Torpedo droht, damit er das Schiff trifft, mit dem sie getauscht hat. */
const SWAP_CHANCE = 0.4;
/**
 * Ausweichen vor dem vermuteten Feuer (`evade`): Bedroht ist ein Schiff, das fällt oder mindestens `hit` Schaden nimmt;
 * das Ausweichen muss im Probekampf mindestens `gain` bringen; ein gedeckter Ziel-Slot zählt `cover` mehr, weil er auch
 * in den Folgerunden schützt; unter den Slots, die höchstens `margin` weniger bringen als der beste, entscheidet der
 * Zufall; geht es nicht um das Match, bleibt das Schiff mit `stay` trotzdem stehen.
 */
const EVADE = { hit: 4, gain: 4, cover: 2, margin: 1, stay: 0.2 };
/**
 * Vorhalten (`Lead`): So oft setzt er darauf, dass das gegnerische Flaggschiff ausweicht: Reicht das Feuer nicht für den
 * Abschuss, wo es steht, und hinter der Deckung, hinter die es wohl ausweicht, geht die Deckung vor; und kann Moreau
 * ohne Schiff auf der Hand nur noch ihr Trugbild davor stellen oder ausweichen, nimmt er Schiffsfeuer statt Spaltenfeuer.
 */
const LEAD_CHANCE = 0.35;
/** Kerr: wie wahrscheinlich ein gedecktes Ziel beim Schuss der Railgun ungedeckt ist, bei schwacher bzw. stabiler Deckung. */
const KERR = { weakCover: 0.3, covered: 0.15 };
/**
 * Admiralsfähigkeit oder Grundmanöver: Das Manöver lohnt oft erst in den Folgerunden und bekommt diesen Vorschuss.
 * `future`: so viele Runden Feuer zählt jedes Schiff zusätzlich (ein Abschuss nimmt dem Gegner auch die nächsten Schüsse).
 */
const POWER = { maneuverHeadStart: 1, future: 2 };
/**
 * Schätzungen zum unbekannten Gegnerzug: wie oft er seine Admiralsfähigkeit einsetzt (Funkstille), wie oft er einen
 * Angriff oder eine Schwächung spielt, wenn er einen hält (Gegenmaßnahmen), wie sicher er ein Schiff legt und wie oft
 * Moreau ein Trugbild stellt (Minenfeld).
 */
const GUESS = { power: 0.45, hostile: 0.8, deploy: 0.9, decoy: 0.3 };
/** Gegenmaßnahmen: was ein typischer Angriff oder eine Schwächung anrichtet, und was ein gezogener Befehl wert ist. */
const COUNTER = { typical: 3, draw: 1 };
/** Schnellverlegung: Ein Schiff mehr auf dem Brett feuert auch in den Folgerunden; so viel zählt das über diese Runde hinaus. */
const RAPID_TEMPO = 1;
/**
 * Befehle, die er zusätzlich zur Schätzung im Probekampf durchspielt (`evaluate`): Schaden, Schwächung, ATK und Verlegung
 * können dem eigenen Feuer einen Abschuss ermöglichen oder eine Deckung wegräumen. Torpedo, Wärmesucher und Durchschlag
 * spielt er für jedes Ziel durch.
 */
const COMBOS: ReadonlySet<CommandId> = new Set<CommandId>([
  "orbital_strike",
  "volley_fire",
  "emp_blast",
  "targeting_jammer",
  "power_surge",
  "overcharge",
  "scrap_salvage",
  "coup_de_grace",
  "bombardment",
  "crossfire",
  "flanking_maneuver",
  "intercept",
  "recall",
]);

/** `random` liefert Zahlen in [0, 1), in Tests fest vorgegeben. */
export function planBotTurn(board: Board, bot: BotView, round: number, random: () => number = Math.random): TurnPlan {
  // Geplant wird auf einer Kopie, auf der die gelegten Schiffe schon stehen, in Runde 1 zuerst das Flaggschiff.
  const start = copyOf(board);
  const flagship: SlotTarget | null = round === 1 ? { lane: "command", slotIndex: FLAGSHIP_SLOT } : null;
  if (flagship) start.place(start.lane(bot.side, flagship.lane), flagship.slotIndex, shipById(ADMIRALS[bot.admiral].flagship));
  // Der Gegner zielt auf die Stellung, wie sie jetzt steht: Die Schiffe, die der Bot gleich legt, kennt er noch nicht.
  const enemyFire = predictFire(board, opposite(bot.side), guardOf(bot.shipHand.length, bot.admiral));
  // Vorhalten: Fällt das gegnerische Flaggschiff, zielt ein Teil des Feuers dorthin, wohin es wohl in Deckung ausweicht.
  const escapes = flagshipEscapes(board, opposite(bot.side), guardOf(bot.opponent.shipHandSize, bot.opponent.admiral));
  const lead = board.flagship(opposite(bot.side)) ? { escapes, gamble: random() < LEAD_CHANCE } : null;
  const deploy = (count: number) => {
    const after = copyOf(start);
    const ships = planShips(after, bot, count, enemyFire);
    // Auch das Flaggschiff landet erst in dieser Runde und manövriert noch nicht.
    const arrivals = [...ships.map((ship) => ship.target), ...(flagship ? [flagship] : [])];
    return { ships, situation: new Situation(after, bot, round, arrivals, enemyFire, lead, random) };
  };
  let { ships, situation } = deploy(maxDeploys(round));
  // Schnellverlegung: Passt ein weiteres Schiff, zählt, was es schon in dieser Runde bringt; gewählt, legt er es.
  const rapid = bot.commandHand.some((card) => card.id === "rapid_deployment") ? deploy(maxDeploys(round) + 1) : null;
  if (rapid && rapid.ships.length > ships.length) situation.extraShip = rapid.situation.arrivalGain(situation, rapid.ships.at(-1)!.target);
  const command = situation.planCommand();
  const card = command && bot.commandHand[command.handIndex]!;
  if (card?.id === "rapid_deployment") ({ ships, situation } = rapid!);
  const { maneuver, power } = situation.planPower(situation.planManeuver(command), command, allowsManeuverAndPower(card));
  return {
    ships,
    command: command && { handIndex: command.handIndex, target: command.target && slotTarget(command.target), destination: command.destination?.index ?? null },
    maneuver,
    flagship,
    power,
    mark: canMark(board, bot.side) ? situation.planMark(maneuver) : null,
    fire: situation.planFire({ power: power?.target, maneuver, command: command && { card: card!, target: command.target, destination: command.destination } }),
  };
}

/**
 * Die Wahl aus dem Nachschub: das stärkste Schiff (`shipValue`, Kampfschiffe vor Support), die Schrottverwertung, sonst
 * den Befehl, von dem er am wenigsten auf der Hand hat (bei Gleichstand den ersten).
 */
export function planBotDraft(bot: BotView, offer: DraftOffer): DraftPick {
  const ships = offer.ships.map(shipById);
  const ship = highest(ships, shipValue);
  const held = (id: CommandId) => bot.commandHand.filter((card) => card.id === id).length;
  const command = offer.commands.includes("scrap_salvage") ? "scrap_salvage" : highest(offer.commands, (id) => -held(id));
  return { ship: ship && ships.indexOf(ship), command: command && offer.commands.indexOf(command) };
}

/** Kopie zum Durchspielen, mit dem Overdrive der Runde und den Drohnen, die die Hive schon gestartet hat. */
function copyOf(board: Board): Board {
  const copy = new Board();
  copy.load(board.snapshot());
  copy.overdrive = board.overdrive;
  copy.hiveLaunches = { ...board.hiveLaunches };
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

/**
 * Legt die Schiffe nacheinander auf `board`, die Kopie des Bretts: jedes mit Rücksicht auf die vorigen. `enemyFire`: die
 * vermuteten Feuerbefehle des Gegners (`predictFire`).
 */
function planShips(board: Board, bot: BotView, count: number, enemyFire: readonly FireOrder[]): Deploy[] {
  const ships: Deploy[] = [];
  const hand = bot.shipHand.map((card, handIndex) => ({ card, handIndex }));
  for (let i = 0; i < count; i++) {
    const ship = planShip(
      board,
      bot.side,
      hand.map((entry) => entry.card),
      enemyFire,
    );
    if (ship === null) break;
    const { card, handIndex } = hand.splice(ship.handIndex, 1)[0]!;
    board.place(board.lane(bot.side, ship.target.lane), ship.target.slotIndex, card);
    ships.push({ handIndex, target: ship.target });
  }
  return ships;
}

/** Die ungedeckten Command-Schiffe von `side`, vor die ein Schiff gelegt werden kann. */
function guardable(board: Board, side: Side): Slot[] {
  const strike = board.lane(side, "strike");
  return board.lane(side, "command").occupiedSlots.filter((slot) => board.canPlace(strike, slot.index));
}

/**
 * Vor welches der ungedeckten Command-Schiffe `exposed` (`guardable`) ein robustes Schiff kommt (`planShip`): das
 * Flaggschiff, sonst ein markiertes (die gegnerische Railgun zielt darauf), sonst das, auf das am meisten Feuer zielt
 * (`fire`), sonst das nächst der Mitte. So erwartet der Bot es auch vom Gegner.
 */
function guardTarget(exposed: readonly Slot[], fire: (slot: Slot) => number): Slot | null {
  return (
    exposed.find((slot) => isFlagship(slot.card!)) ??
    exposed.find((slot) => slot.marked) ??
    highest(
      exposed.filter((slot) => fire(slot) > 0),
      fire,
    ) ??
    nearest(exposed, LANE_CENTER)
  );
}

function planShip(board: Board, side: Side, shipHand: readonly ShipCard[], enemyFire: readonly FireOrder[]): Deploy | null {
  const card = highest(shipHand, shipValue);
  if (card === null) return null;
  const strike = board.lane(side, "strike");
  const command = board.lane(side, "command");
  const deploy = (ship: ShipCard, slot: Slot) => ({ handIndex: shipHand.indexOf(ship), target: slotTarget(slot) });
  // Ein Strike-Schiff deckt den Command-Slot dahinter: Schiffsfeuer darauf verpufft, und es nimmt die ersten Schüsse auf
  // die Spalte. Vor das ungedeckte Flaggschiff und ein markiertes Schiff stellt sich das robusteste Kampfschiff; sonst
  // kommen robuste Schiffe vor das ungedeckte Command-Schiff, auf das der Gegner wohl am meisten feuert (`guardTarget`),
  // sonst nach vorne, Jäger und Support in einen gedeckten Command-Slot.
  const guarded = guardTarget(guardable(board, side), (slot) => fireOn(board, side, enemyFire, slot));
  if (guarded && (isFlagship(guarded.card!) || guarded.marked)) {
    const guard =
      highest(
        shipHand.filter((ship) => ship.atk > 0),
        (ship) => ship.hp + ship.shield,
      ) ?? card;
    return deploy(guard, strike.slots[guarded.index]!);
  }
  const covered = command.slots.filter((slot) => !slot.isOccupied && strike.slots[slot.index]!.isOccupied);
  const preferred = isFragile(card) ? nearest(covered, LANE_CENTER) : guarded && strike.slots[guarded.index]!;
  for (const slot of [preferred, strike.freeSlotNear(LANE_CENTER), command.freeSlotNear(LANE_CENTER)]) {
    if (slot && board.canPlace(slot.lane, slot.index)) return deploy(card, slot);
  }
  return null;
}

/** Wie viel Schaden der Gegner mit seinen vermuteten Feuerbefehlen `enemyFire` auf das ungedeckte Schiff `slot` von `side` lenkt. */
function fireOn(board: Board, side: Side, enemyFire: readonly FireOrder[], slot: Slot): number {
  const shooter = ({ lane, slotIndex }: SlotTarget) => board.lane(opposite(side), lane).slots[slotIndex]!;
  const aimed = (order: FireOrder) => ("target" in order ? isSameSlot(order.target, slotTarget(slot)) : order.column === slot.index);
  return enemyFire.reduce((total, order) => total + (aimed(order) ? shooter(order.ship).attack : 0), 0);
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

/**
 * Was der Probekampf vom eigenen Zug durchspielt (`Situation.battle`): Admiralsfähigkeit, Grundmanöver und Befehl (Slots
 * der Kopie mit den gelegten Schiffen); für die Funkstille stattdessen die Fähigkeit des Gegners.
 */
interface Trial {
  power?: SlotTarget;
  maneuver?: TurnPlan["maneuver"];
  command?: { card: CommandCard; target: Slot | null; destination: Slot | null } | null;
  enemyPower?: { id: PowerId; target: SlotTarget };
}

const attacks = (slot: Slot) => slot.card!.atk > 0;
const hp = (slot: Slot) => slot.hp;
const durability = (slot: Slot) => slot.hp + slot.shield;
const damaged = (slot: Slot) => slot.hp < slot.card!.hp;
const lowest = (slots: readonly Slot[], value: (slot: Slot) => number) => highest(slots, (slot) => -value(slot));

function untargeted(score: number): Option {
  return { score, target: null, destination: null };
}

function on(slot: Slot, score: number, destination: Slot | null = null): Option {
  return { score, target: slot, destination };
}

/** Schaden, der bei einem Schiff ankommt, plus Bonus, wenn es dabei zerstört wird; beim Flaggschiff doppelt, sein Fall entscheidet. */
function damageValue(slot: Slot, amount: number): number {
  const remaining = durability(slot);
  const dealt = Math.min(amount, remaining);
  if (isFlagship(slot.card!)) return dealt * FLAGSHIP_WEIGHT + (remaining <= amount ? DECISIVE : 0);
  return dealt + (remaining <= amount ? KILL_BONUS : 0);
}

/** Wie viele Kopien eines Befehls der Gegner noch nicht gespielt hat. */
function unplayed(bot: BotView, id: CommandId): number {
  return deckCopies(commandById(id)) - bot.opponent.playedCommands.filter((played) => played === id).length;
}

/**
 * Ob ein Schiff wahrscheinlich stehen bleibt: unbeschädigt, gedeckt hinten oder einziger Angreifer vorne. Für Befehle,
 * die einen Slot treffen (Torpedo, Durchschlag), und die Feuerbefehle (`risks`); so zielt der Bot selbst, so erwartet er
 * es vom Gegner.
 */
function stays(slot: Slot): boolean {
  const { board } = slot.lane;
  const strike = board.lane(slot.lane.side, "strike");
  return !damaged(slot) || !board.isExposed(slot) || (slot.lane.type === "strike" && !strike.occupiedSlots.some((other) => other !== slot && attacks(other)));
}

/**
 * Vorhalten: die Spalten, in deren gedeckten Command-Slot das tödlich bedrohte gegnerische Flaggschiff wohl ausweicht, die
 * wahrscheinlichste zuerst (`flagshipEscapes`), und ob der Bot auf das Ausweichen setzt (`LEAD_CHANCE`).
 */
interface Lead {
  escapes: readonly number[];
  gamble: boolean;
}

/**
 * Womit eine Seite in dieser Runde wohl noch Deckung schafft (`risks`): mit einem Schiff von ihrer Hand ("ship"), vor ein
 * Command-Schiff oder einen freien Command-Slot, in den eins ausweicht; ohne Schiff mit Moreaus Trugbild ("decoy"), das
 * sie statt des Grundmanövers stellt; sonst null.
 */
type Guard = "ship" | "decoy" | null;

function guardOf(shipHandSize: number, admiral: AdmiralId | null): Guard {
  return shipHandSize > 0 ? "ship" : admiral === "moreau" ? "decoy" : null;
}

/** Wie ein Schiff den Schüssen der Gegenseite wohl entgeht (`risks`). */
interface Risk {
  /**
   * Es entgeht wohl jedem Schuss, auf es zu zielen zählt halb: Vor ihm landet das nächste Schiff seiner Seite, das die
   * ersten Schüsse auf seine Spalte nimmt und an dem Schiffsfeuer verpufft, oder es weicht angeschlagen aus, und
   * Schiffsfeuer folgt ihm nicht (`open`).
   */
  unsure: boolean;
  /**
   * Weicht es aus, dann nur ungedeckt: Dorthin folgt ihm Schiffsfeuer, Spaltenfeuer ginge ins Leere. Sonst bringt
   * Schiffsfeuer nichts, was Spaltenfeuer nicht auch bringt.
   */
  open: boolean;
  /**
   * Ein ungedecktes Command-Schiff, vor das die Seite noch etwas legen kann (`guardable`, `Guard`); wovor es kommt,
   * entscheidet `guardTarget`.
   */
  guard: Guard;
}

const SAFE: Risk = { unsure: false, open: false, guard: null };

/**
 * Wie die Schiffe von `side` den Schüssen der Gegenseite wohl entgehen, für deren Zielwahl (`aimFire`). Kann die Seite
 * noch Deckung schaffen (`guard`), legt sie sie vor ein ungedecktes Command-Schiff (`guardTarget`), und gibt es keins,
 * vorne mittig vor einen freien Command-Slot, hinter den eins ausweichen kann.
 * Ausweichen kann ein Schiff in einen freien Slot einer anderen Spalte (`escapeRoute`); angeschlagen tut es das wohl
 * (`stays`), und wo dabei Deckung ist, nimmt es die. Ein Strike-Schiff, das ein Schiff dahinter deckt, gilt nicht als
 * `open`: Weicht es doch aus, trifft Spaltenfeuer das Schiff dahinter.
 */
function risks(board: Board, side: Side, guard: Guard): Map<Slot, Risk> {
  const strike = board.lane(side, "strike");
  const command = board.lane(side, "command");
  const exposed = guard ? guardable(board, side) : [];
  const guarded = guardTarget(exposed, () => 0);
  const center = strike.freeSlotNear(LANE_CENTER);
  const shelter = guard && !guarded && center && board.canPlace(strike, center.index) ? center.index : null;
  return new Map(
    board.ships(side).map((slot) => {
      const covering = slot.lane.type === "strike" && command.slots[slot.index]!.isOccupied;
      const open = escapeRoute(board, slot, shelter) === "open" && !covering;
      return [slot, { unsure: slot === guarded || (!stays(slot) && !open), open, guard: exposed.includes(slot) ? guard : null }];
    }),
  );
}

/**
 * Wohin ein Schiff ausweichen kann, wie der Bot es täte (`Situation.evasions`): in einen freien Slot einer anderen Spalte,
 * das Flaggschiff nur in die Command-Lane, die Mirage auch per Phasentausch. "cover", wenn einer davon gedeckt ist, auch
 * hinter dem Strike-Slot `shelter`, in den die Seite ihr nächstes Schiff legt; null für Tokens, die nie ausweichen, und
 * wenn kein Slot frei ist.
 */
function escapeRoute(board: Board, slot: Slot, shelter: number | null): "cover" | "open" | null {
  if (isToken(slot.card!)) return null;
  const strike = board.lane(slot.lane.side, "strike");
  const flagship = isFlagship(slot.card!);
  const destinations = board.maneuverDestinations(slot).filter((to) => to.index !== slot.index && (!flagship || to.lane.type === "command"));
  if (slot.card!.id === "mirage") destinations.push(...board.ships(slot.lane.side).filter((to) => to.index !== slot.index && !isToken(to.card!)));
  if (destinations.length === 0) return null;
  const covered = (to: Slot) => to.lane.type === "command" && (strike.slots[to.index]!.isOccupied || to.index === shelter);
  return destinations.some(covered) ? "cover" : "open";
}

/**
 * Die Lage nach dem Deploy: `board` ist eine Kopie, auf der die geplanten Schiffe schon stehen.
 * Befehle dürfen sie treffen, wo es sich lohnt, das Grundmanöver nicht (es bewegt nur Schiffe, die schon standen).
 */
class Situation {
  private readonly side: Side;
  private readonly own: readonly Slot[];
  private readonly enemies: readonly Slot[];
  /** Die in dieser Runde gelegten Schiffe, in Runde 1 auch das Flaggschiff. */
  private readonly fresh: ReadonlySet<Slot>;
  private readonly enemyAttack: number;
  private readonly enemyMaxAttack: number;
  private readonly flagship: Slot | null;
  /** Der stärkste Angriffsbefehl, den der Gegner noch auf das eigene Flaggschiff spielen kann (`commandThreat`). */
  private readonly commandDanger: number;
  /** Wie die gegnerischen Schiffe seinen Schüssen wohl entgehen (`risks`): danach wählt er Ziel und Modus. */
  private readonly risks: ReadonlyMap<Slot, Risk>;
  /** Der Kampf dieser Runde samt Railgun, falls sich niemand bewegt und keiner einen Befehl spielt. */
  private readonly preview: Board;
  private readonly shots: Extract<RoundEvent, { kind: "attack" }>[];
  /** Schnellverlegung: was das zusätzliche Schiff bringt (`arrivalGain`); null, wenn keins mehr passt. */
  extraShip: number | null = null;
  /** Die Stellung nach dem Kampf dieser Runde ohne Befehl und Manöver (`standing`). */
  private baseline: number | null = null;
  /** Das Grundmanöver neben einem Befehl ohne eigenes Zielschiff (`planManeuver`), einmal geplant. */
  private freeManeuver: TurnPlan["maneuver"] | undefined;
  /** Für Befehle auf der Kopie: Was er dabei ziehen würde, zählt der Probelauf nicht. */
  private readonly commander: Commander;

  /**
   * `enemyFire`: die vermuteten Feuerbefehle des Gegners (`predictFire`), Slots beim Planen aus seiner Sicht. `lead`: wohin
   * er vorhält, null, wenn das gegnerische Flaggschiff nicht fällt.
   */
  constructor(
    private readonly board: Board,
    private readonly bot: BotView,
    private readonly round: number,
    arrivals: readonly SlotTarget[],
    private readonly enemyFire: readonly FireOrder[],
    private readonly lead: Lead | null,
    private readonly random: () => number,
  ) {
    this.commander = { side: bot.side, drawExtra: () => ({ ships: 0, commands: 0 }) };
    this.side = bot.side;
    this.own = board.ships(bot.side);
    this.enemies = board.ships(opposite(bot.side));
    this.fresh = new Set(arrivals.map((target) => this.lane(target.lane).slots[target.slotIndex]!));
    this.enemyAttack = this.enemies.reduce((total, slot) => total + slot.attack, 0);
    this.enemyMaxAttack = Math.max(0, ...this.enemies.map((slot) => slot.attack));
    this.flagship = board.flagship(bot.side);
    this.commandDanger = this.flagship ? this.commandThreat(this.flagship) : 0;
    this.risks = risks(board, opposite(bot.side), guardOf(bot.opponent.shipHandSize, bot.opponent.admiral));
    this.preview = this.battle({}).board;
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
    return this.board.isExposed(slot) && durability(slot) <= this.enemyMaxAttack;
  }

  private previewOf(slot: Slot): Slot {
    return this.preview.lane(slot.lane.side, slot.lane.type).slots[slot.index]!;
  }

  /** Fällt im Kampf dieser Runde, wenn es stehen bleibt. */
  private dies(slot: Slot): boolean {
    return this.previewOf(slot).hp <= 0;
  }

  /** Schaden im Kampf dieser Runde (samt Railgun), wenn es stehen bleibt; den Wächterschild verbraucht er zuerst. */
  private hit(slot: Slot): number {
    const after = this.previewOf(slot);
    return Math.max(0, durability(slot) - after.hp - after.shield);
  }

  /** Was die Gegenseite im Kampf an dem Schiff gewinnt, wenn es stehen bleibt. */
  private loss(slot: Slot): number {
    return damageValue(slot, this.hit(slot));
  }

  /** Was das Schiff mit seinem Schuss in diesem Kampf anrichtet. */
  private shotValue(slot: Slot): number {
    const shot = this.shots.find(({ attacker }) => attacker.side === slot.lane.side && attacker.lane === slot.lane.type && attacker.slotIndex === slot.index);
    return shot ? damageValue(this.board.lane(shot.target.side, shot.target.lane).slots[shot.target.slotIndex]!, shot.amount) : 0;
  }

  /**
   * Was ein eigenes Schiff im Kampf dieser Runde schlimmstenfalls trifft: Jedes gegnerische Kampfschiff kann auf seine
   * Spalte zielen (beim Fokusfeuer je Treffer 1 mehr). Steht ein Schiff davor, nimmt es die Schüsse in Kampfreihenfolge,
   * bis es fällt, der Rest geht durch. Dazu die Railgun. Fürs Flaggschiff, dessen Fall entscheidet; für die übrigen
   * Schiffe zählt der vermutete Kampf (`hit`).
   */
  private fireThreat(slot: Slot): number {
    const admiral = this.bot.opponent.admiral;
    const focus = admiral && ADMIRALS[admiral].power === "focus_fire" ? ABILITY_VALUES.focusFire : 0;
    const front = this.lane("strike").slots[slot.index]!;
    let cover = slot.lane.type === "command" && front.isOccupied ? durability(front) : 0;
    let fire = 0;
    for (const enemy of this.enemies.filter(attacks)) {
      if (cover > 0) cover -= enemy.attack;
      else fire += enemy.attack + focus;
    }
    return fire + (slot.marked && this.board.isExposed(slot, true) ? ABILITY_VALUES.railgun : 0);
  }

  /** Was dem eigenen Flaggschiff in dieser Runde schlimmstenfalls droht: der Kampf und ein starker Befehl, abzüglich Wächterschild. */
  private flagshipThreat(): number {
    const flagship = this.flagship;
    if (flagship === null) return 0;
    const guard = flagship.card!.id === "bastion" ? ABILITY_VALUES.guardianShield : 0;
    return Math.max(0, this.fireThreat(flagship) + this.commandDanger - guard);
  }

  /** Der stärkste Angriffsbefehl auf das Flaggschiff, von dem der Gegner noch eine Kopie hat. */
  private commandThreat(flagship: Slot): number {
    if (this.bot.opponent.commandHandSize === 0) return 0;
    const ships = this.own.filter((slot) => !isToken(slot.card!));
    const front = this.board.isExposed(flagship);
    const threats: [CommandId, number][] = [
      ["torpedo", 5],
      ["orbital_strike", highest(this.own, hp) === flagship ? 4 : 0],
      ["coup_de_grace", lowest(ships, hp) === flagship ? 4 : 0],
      ["heat_seeker", 3],
      ["piercing_shot", front ? 3 : 2],
      ["crossfire", this.partner(flagship).isOccupied ? 0 : 3],
      ["bombardment", flagship.lane.type === "command" ? 2 : 0],
      ["volley_fire", 1],
    ];
    return Math.max(0, ...threats.filter(([id]) => unplayed(this.bot, id) > 0).map(([, amount]) => amount));
  }

  /** Ob ein Schild dieser Stärke das Flaggschiff rettet, dem sonst in dieser Runde der Fall droht. */
  private rescues(shield: number): boolean {
    const flagship = this.flagship;
    const threat = this.flagshipThreat();
    return flagship !== null && threat >= durability(flagship) && threat - shield < durability(flagship);
  }

  /** Der Slot gleicher Nummer in der anderen Lane derselben Seite. */
  private partner(slot: Slot): Slot {
    return this.board.lane(slot.lane.side, otherLane(slot.lane.type)).slots[slot.index]!;
  }

  /**
   * Wohin das Schiff beim Wechsel in die andere Lane geht: am liebsten in einen Slot, der mit einem
   * anderen Schiff der bisherigen Lane ein Paar bildet (vorne deckt es, hinten ist es gedeckt), sonst
   * möglichst nah. `other` ist der zweite Lane-Wechsel dieser Runde: Sein Ziel ist belegt, sein Schiff
   * bildet nur noch dort ein Paar. null, wenn die andere Lane keinen Platz hat.
   */
  private move(slot: Slot, other: Move | null = null): { destination: Slot; paired: boolean } | null {
    const free = this.destinations(slot, other).filter((destination) => destination.lane !== slot.lane);
    const partner = (index: number) => {
      const neighbour = slot.lane.slots[index]!;
      return neighbour === other?.destination || (neighbour.isOccupied && neighbour !== slot && neighbour !== other?.ship);
    };
    const paired = free.filter((destination) => partner(destination.index));
    const destination = nearest(paired.length > 0 ? paired : free, slot.index);
    return destination && { destination, paired: paired.length > 0 };
  }

  /**
   * Freie Slots, in die das Schiff wechseln kann, neben dem Lane-Wechsel `other` (siehe `Board.canMove`): Sein Ziel ist
   * belegt, und die Lane-Grenze gilt für beide Bewegungen zusammen, so wie der Server sie prüft.
   */
  private destinations(slot: Slot, other: Move | null): Slot[] {
    return this.board.maneuverDestinations(slot, [], other && { from: other.ship, to: other.destination });
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

  /** Wie gern ein Torpedo auf dieses Schiff zielt: der Schaden, halb für eines, das ausweichen könnte (`stays`). */
  private torpedoValue(slot: Slot): number {
    return damageValue(slot, 5) * (stays(slot) ? 1 : UNSURE);
  }

  /** Ob ein angeschlagenes gegnerisches Schiff, das sonst fällt, wohl die Lane wechselt (Wärmesucher). */
  private flees(slot: Slot): boolean {
    return damaged(slot) && this.dies(slot) && this.pairsAfterMove(slot);
  }

  /** Wohin sich ein angeschlagenes gegnerisches Strike-Schiff, das sonst fällt, am ehesten zurückzieht. */
  private likelyRetreat(): Move | null {
    const fleeing = this.board
      .lane(opposite(this.side), "strike")
      .occupiedSlots.filter((slot) => damaged(slot) && this.dies(slot) && this.pairsAfterMove(slot));
    const ship = highest(fleeing, (slot) => damageValue(slot, 5));
    return ship && { ship, destination: this.move(ship)!.destination };
  }

  /** Ein freier, gedeckter Command-Slot für ein eigenes Schiff (`covered`). */
  private shelter(slot: Slot, other: Move | null): Slot | null {
    return nearest(
      this.destinations(slot, other).filter((destination) => this.covered(destination, slot, other)),
      slot.index,
    );
  }

  /** Ob ein eigener Command-Slot für `slot` gedeckt ist: davor ein Strike-Schiff, das stehen bleibt, oder das Ziel von `other`. */
  private covered(destination: Slot, slot: Slot, other: Move | null): boolean {
    const front = this.lane("strike").slots[destination.index]!;
    return destination.lane.type === "command" && (front === other?.destination || (front.isOccupied && front !== other?.ship && front !== slot));
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

  /** Bewertet den Befehl (`estimate`); bei den `COMBOS` zählt der Probekampf, wenn er mehr bringt. */
  private evaluate(card: CommandCard): Option | null {
    const option = this.estimate(card);
    if (option === null || !COMBOS.has(card.id)) return option;
    return { ...option, score: Math.max(option.score, this.simulated(card, option.target, option.destination)) };
  }

  /** Schätzt den Nutzen des Befehls; null oder Score 0, wenn er nichts bringt. Flaggschiffe bewegt er per Befehl nicht nach vorne. */
  private estimate(card: CommandCard): Option | null {
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
        // Feuert die eigene Railgun auf ein Schiff hinter schwacher Deckung, räumt der Torpedo die Deckung weg.
        const cover = this.markCover();
        if (cover) return on(cover.front, damageValue(cover.front, 5) + damageValue(cover.marked, ABILITY_VALUES.railgun));
        // Er trifft, wer nach allen Bewegungen im Slot steht: meist ein Schiff, das wohl stehen bleibt (im Probekampf samt
        // dem, was er dem eigenen Feuer ermöglicht), ab und zu der Slot, in den sich ein angeschlagenes Strike-Schiff
        // am ehesten zurückzieht.
        const retreat = this.random() < SURPRISE_CHANCE ? this.likelyRetreat() : null;
        if (retreat) return on(retreat.destination, damageValue(retreat.ship, 5) * UNSURE);
        const value = (slot: Slot) => Math.max(this.torpedoValue(slot), this.simulated(card, slot) * (stays(slot) ? 1 : UNSURE));
        const target = highest(enemies, value);
        return target && on(target, value(target));
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
        // Ohne gegnerisches Schiff beim Planen (Runde 1) bekommt niemand einen Feuerbefehl.
        return enemies.length > 0 ? untargeted(this.lane("strike").occupiedSlots.filter(attacks).length) : null;
      case "emergency_shields": {
        // Droht dem Flaggschiff der Fall und rettet es der Schild, bekommt es ihn.
        const flagship = this.flagship;
        const threat = this.flagshipThreat();
        if (flagship && threat >= durability(flagship) && threat - 3 < durability(flagship)) return on(flagship, DECISIVE / 2);
        // Sonst dorthin, wo das vermutete Feuer im Probekampf am meisten anrichtet, auch auf ein frisch gelegtes
        // Schiff vorne, das die Schüsse auf seine Spalte abfängt, oder ein gedecktes, zu dem Overkill durchgeht.
        return this.bestTarget(card, this.own);
      }
      case "overcharge": {
        // +3 ATK gegen 2 Eigenschaden: nur für ein Kampfschiff, das das und einen Treffer übersteht,
        // auch für eines, das gerade vorne landet; nie für das Flaggschiff, nie ohne gegnerisches Ziel (Runde 1).
        if (enemies.length === 0) return null;
        const sturdy = this.own.filter(
          (slot) =>
            attacks(slot) &&
            !isFlagship(slot.card!) &&
            (!fresh.has(slot) || slot.lane.type === "strike") &&
            slot.hp > 2 + (this.board.isExposed(slot) ? this.enemyMaxAttack : 0),
        );
        const target = highest(sturdy, hp);
        return target && on(target, 2);
      }
      case "scrap_salvage": {
        // +1 ATK für immer: für den Scrap Raider, der am längsten durchhält.
        const target = highest(
          this.own.filter((slot) => canTargetShip(card, slot.card!)),
          hp,
        );
        return target && on(target, 1.5);
      }
      case "flanking_maneuver": {
        // Das robusteste Schiff nach vorne, wenn es damit ein anderes deckt; sonst ein angeschlagenes
        // Schiff vorne in einen gedeckten Slot bringen, solange vorne jemand bleibt.
        const advance = highest(
          this.settled(this.lane("command").occupiedSlots).filter((slot) => !isFlagship(slot.card!) && this.pairsAfterMove(slot)),
          hp,
        );
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
        const candidates = this.lane("command").occupiedSlots.filter((slot) => (!fresh.has(slot) || attacks(slot)) && !isFlagship(slot.card!));
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
      case "evasive_action": {
        // Ausweichen innerhalb der Lane samt Schild 2: für ein Schiff unter Beschuss, in den Slot, der im Probekampf am meisten bringt.
        let best: Option | null = null;
        const ships = this.own.filter((slot) => slot.card!.id !== "pendulum" && (this.hit(slot) > 0 || (slot === this.flagship && this.rescues(2))));
        for (const ship of ships) {
          for (const destination of this.destinations(ship, null).filter((slot) => slot.lane === ship.lane)) {
            const score = Math.max(this.simulated(card, ship, destination), ship === this.flagship && this.rescues(2) ? DECISIVE / 2 : 0);
            if (score > (best?.score ?? 0)) best = on(ship, score, destination);
          }
        }
        return best;
      }
      case "micro_jump": {
        // Droht dem Flaggschiff der Fall, springt es (reicht ein Notschild, ist der lieber); sonst ein Schiff, das im Kampf
        // mehr verliert, als sein Schuss bringt. Die Pendulum springt nur zur Rettung, sonst fiele ihre Railgun aus.
        const flagship = this.flagship;
        if (flagship && this.flagshipThreat() >= durability(flagship)) return on(flagship, DECISIVE / 2 - (this.rescues(3) ? 1 : 0));
        return this.bestTarget(
          card,
          this.own.filter((slot) => slot.card!.id !== "pendulum" && this.hit(slot) > 0),
        );
      }
      case "rapid_deployment":
        return this.extraShip === null ? null : untargeted(this.extraShip);
      case "draw_fire":
        return this.bestTarget(
          card,
          this.own.filter((slot) => this.board.isExposed(slot)),
        );
      case "shield_grid":
        return untargeted(Math.max(this.simulated(card, null), this.rescues(1) ? DECISIVE / 2 : 0));
      case "ablative_armor":
      case "covering_fire": {
        // Rettet der Schild das Flaggschiff (Feuerschutz auch über seinen Partner), geht er dorthin; sonst wohin er im Probekampf am meisten bringt.
        const flagship = this.flagship;
        if (flagship && this.rescues(card.id === "ablative_armor" ? 2 : 1)) return on(flagship, DECISIVE / 2);
        return this.bestTarget(card, this.own);
      }
      case "drone_squadron":
        return untargeted(this.simulated(card, null));
      case "collision_course":
        return this.bestTarget(
          card,
          this.lane("strike").occupiedSlots.filter((slot) => canTargetShip(card, slot.card!)),
        );
      case "countermeasures": {
        // Lässt einen Angriff oder eine Schwächung des Gegners verpuffen, sonst zieht er einen Befehl. Wackelt das eigene
        // Flaggschiff erst durch einen Befehl, kann sie das Match retten.
        const chance = this.hostileChance();
        const flagship = this.flagship;
        const decisive = flagship !== null && this.fireThreat(flagship) < durability(flagship) && this.flagshipThreat() >= durability(flagship);
        return untargeted(chance * (decisive ? DECISIVE / 2 : COUNTER.typical) + (1 - chance) * COUNTER.draw);
      }
      case "carte_blanche": {
        // Grundmanöver und Fähigkeit zusammen: Sie bringt, was das schwächere der beiden zusätzlich bringt.
        const maneuver = this.planManeuver(null);
        const power = maneuver && this.bestPower(null, maneuver);
        return power ? untargeted(Math.min(this.maneuverGain(maneuver!), power.gain)) : null;
      }
      case "radio_silence": {
        // Die gegnerische Fähigkeit dieser Runde verpufft: so oft, wie er sie einsetzt, mal ihr Wert an seinem besten Ziel.
        const admiral = this.bot.opponent.admiral;
        if (admiral === null) return null;
        const enemy = opposite(this.side);
        const id = ADMIRALS[admiral].power;
        const losses = powerTargets(this.board, enemy, id, [], []).map(
          ({ lane, slotIndex }) => this.standing() - this.outcome({ enemyPower: { id, target: { lane, slotIndex } } }),
        );
        return untargeted(GUESS.power * Math.max(0, ...losses));
      }
      case "minefield": {
        // Trifft, was beim Gegner in dieser Runde ankommt: meist ein Schiff, in Runde 1 zwei und das Flaggschiff, bei Moreau manchmal ein Trugbild.
        const flagship = this.round === 1 ? 3 * FLAGSHIP_WEIGHT : 0;
        return untargeted(this.enemyDeploys() * GUESS.deploy * 3 + flagship + (this.bot.opponent.admiral === "moreau" ? GUESS.decoy : 0));
      }
      case "tractor_beam":
        // Zieht ein Schiff in die andere Lane, am liebsten den Wächter vor dem Flaggschiff.
        return this.bestTarget(
          card,
          enemies.filter((slot) => canTargetShip(card, slot.card!)),
        );
      case "heat_seeker": {
        // Folgt seinem Ziel: 3 Schaden, 5 an einem Schiff, das wohl ausweicht; im Probekampf samt dem, was er dem eigenen Feuer ermöglicht.
        const value = (slot: Slot) => Math.max(damageValue(slot, this.flees(slot) ? 5 : 3), this.simulated(card, slot));
        const target = highest(enemies, value);
        return target && on(target, value(target));
      }
      case "coup_de_grace": {
        const target = lowest(
          enemies.filter((slot) => !isToken(slot.card!)),
          hp,
        );
        return target && untargeted(damageValue(target, 4));
      }
      case "piercing_shot": {
        // Wie der Torpedo nach allen Bewegungen: 3 am vordersten Schiff der Slot-Nummer, 2 am Command-Schiff dahinter.
        const strike = this.board.lane(opposite(this.side), "strike");
        const sure = (slot: Slot, amount: number) => damageValue(slot, amount) * (stays(slot) ? 1 : UNSURE);
        const column = (front: Slot) => {
          const back = this.partner(front);
          if (!front.isOccupied) return back.isOccupied ? sure(back, 3) : 0;
          return sure(front, 3) + (back.isOccupied ? sure(back, 2) : 0);
        };
        // Im Probekampf samt dem, was er dem eigenen Feuer ermöglicht, halb gewichtet, wenn ein Schiff der Slot-Nummer wohl ausweicht.
        const stand = (front: Slot) => [front, this.partner(front)].every((slot) => !slot.isOccupied || stays(slot));
        const value = (front: Slot) => (column(front) > 0 ? Math.max(column(front), this.simulated(card, front) * (stand(front) ? 1 : UNSURE)) : 0);
        const target = highest(strike.slots, value)!;
        return on(target, value(target));
      }
      case "bombardment":
        return untargeted(this.board.lane(opposite(this.side), "command").occupiedSlots.reduce((total, slot) => total + damageValue(slot, 2), 0));
      case "crossfire": {
        // Ein Schiff, das der Gegner in dieser Runde legt, gibt einem ungepaarten oft einen Partner.
        const unpaired = enemies.filter((slot) => !this.partner(slot).isOccupied).reduce((total, slot) => total + damageValue(slot, 3), 0);
        return untargeted(unpaired * (this.enemyDeploys() ? UNSURE : 1));
      }
    }
  }

  /** Wie viele Schiffe der Gegner in dieser Runde höchstens legt: so viele, wie Hand, Flottengrenze und Runde erlauben. */
  private enemyDeploys(): number {
    const room = MAX_SHIPS_PER_SIDE - this.board.shipCount(opposite(this.side));
    return Math.min(this.bot.opponent.shipHandSize, room, maxDeploys(this.round));
  }

  /** Wie wahrscheinlich der Gegner einen Angriff oder eine Schwächung spielt: ob er einen hält (aus seinen ungespielten Kopien) und spielt. */
  private hostileChance(): number {
    let total = 0;
    let hostile = 0;
    for (const card of COMMANDS) {
      const copies = unplayed(this.bot, card.id);
      total += copies;
      if (card.commandType === "attack" || card.commandType === "debuff") hostile += copies;
    }
    if (total === 0) return 0;
    return GUESS.hostile * (1 - (1 - hostile / total) ** this.bot.opponent.commandHandSize);
  }

  /** Was der Befehl im Kampf dieser Runde bringt: auf einer Kopie angewendet, verglichen mit der Lage ohne ihn (`standing`). */
  private simulated(card: CommandCard, target: Slot | null, destination: Slot | null = null): number {
    return this.outcome({ command: { card, target, destination } }) - this.standing();
  }

  /** Das gültige Ziel, auf dem der Befehl im Probekampf am meisten bringt; null, wenn er nirgends etwas bringt. */
  private bestTarget(card: CommandCard, targets: readonly Slot[]): Option | null {
    let best: Option | null = null;
    for (const target of targets.filter((slot) => canTargetLane(card, slot.lane.type) && canTargetShip(card, slot.card!))) {
      const score = this.simulated(card, target);
      if (score > (best?.score ?? 0)) best = on(target, score);
    }
    return best;
  }

  /** Schnellverlegung, auf der Kopie mit dem zusätzlichen Schiff in `target`: was es im Kampf dieser Runde gegenüber `without` bringt. */
  arrivalGain(without: Situation, target: SlotTarget): number {
    const ship = this.lane(target.lane).slots[target.slotIndex]!;
    const worth = durability(ship) + KILL_BONUS + ship.attack * POWER.future;
    return RAPID_TEMPO + this.standing() - without.standing() - worth;
  }

  /** Feuert die eigene Railgun in dieser Runde auf ein Command-Schiff hinter einer Deckung, die ein Torpedo zerstört: Deckung und Ziel. */
  private markCover(): { front: Slot; marked: Slot } | null {
    const marked = this.enemies.find((slot) => slot.marked);
    if (marked?.lane.type !== "command") return null;
    const front = this.board.lane(opposite(this.side), "strike").slots[marked.index]!;
    return front.isOccupied && durability(front) <= 5 ? { front, marked } : null;
  }

  /**
   * Das Grundmanöver neben dem geplanten Befehl: Es lässt dessen Zielschiff in Ruhe und meidet den Slot,
   * in den der Befehl verlegt. Erst einem wertvollen Schiff aus dem vermuteten Feuer helfen (zuerst dem
   * Flaggschiff), dann das ungedeckte Flaggschiff in Deckung bringen, ein markiertes Schiff aus dem Schuss
   * der Railgun nehmen, der Phasentausch der Mirage, Rückzug, Deckung, Vorrücken, ein Ausweichen des
   * Flaggschiffs vor einem Torpedo, sonst selten ein Ausweichen.
   */
  planManeuver(command: Option | null): TurnPlan["maneuver"] {
    // Ohne eigenes Zielschiff steht es schon fest, wenn Freie Hand es bewertet hat.
    if (command?.target != null) return this.maneuverBeside(command);
    if (this.freeManeuver === undefined) this.freeManeuver = this.maneuverBeside(null);
    return this.freeManeuver;
  }

  private maneuverBeside(command: Option | null): TurnPlan["maneuver"] {
    const other = command?.destination ? { ship: command.target!, destination: command.destination } : null;
    const movable = this.settled(this.own).filter((slot) => slot !== command?.target);
    // Die Pendulum bleibt sonst stehen: Sie feuert oder markiert jede Runde, und bewegt sie sich, fällt der Schuss aus.
    const free = movable.filter((slot) => slot.card!.id !== "pendulum");
    const move =
      this.evade(movable, other) ??
      this.protectFlagship(movable, other) ??
      this.evadeMark(free, other) ??
      this.phaseSwap(free, other) ??
      this.retreat(free, other) ??
      this.takeCover(free, other) ??
      this.advance(free, other) ??
      this.flagshipDodge(free, other) ??
      (this.random() < SURPRISE_CHANCE ? this.dodge(free, other) : null);
    return move && { ship: slotTarget(move.ship), destination: slotTarget(move.destination) };
  }

  /**
   * Ausweichen vor dem vermuteten Feuer: Der Gegner zielt auf die Spalten beim Planen (`enemyFire`). Droht einem
   * wertvollen eigenen Schiff dort der Fall oder schwerer Schaden (`EVADE.hit`), zuerst dem Flaggschiff, wechselt es in
   * einen freien Slot einer anderen Spalte (`evasions`). Jeder Slot wird im Probekampf durchgespielt, samt dem Schuss, den
   * das Schiff dafür verliert, und dem, was die Schüsse auf seine alte Spalte jetzt treffen; ein gedeckter Slot zählt
   * etwas mehr. Unter den Slots, die fast so viel bringen wie der beste, entscheidet der Zufall, und geht es nicht um das
   * Match, bleibt das Schiff manchmal stehen: So kann der Gegner nicht einfach vorhalten. Ein Kampfschiff weicht nur aus,
   * wenn ein anderes weiter feuert, ein Wächter vor dem Flaggschiff nie, die Pendulum nur, wenn sie sonst fällt.
   */
  private evade(movable: readonly Slot[], other: Move | null): Move | null {
    const flagship = this.flagship;
    const threatened = movable
      .filter(
        (slot) =>
          !isToken(slot.card!) &&
          (this.dies(slot) || this.hit(slot) >= EVADE.hit) &&
          (slot.card!.id !== "pendulum" || this.dies(slot)) &&
          (slot === flagship || ((!attacks(slot) || this.attackerRemains(slot)) && !this.guards(slot))),
      )
      .sort((a, b) => Number(b === flagship) - Number(a === flagship) || this.loss(b) - this.loss(a));
    for (const ship of threatened) {
      const options = this.evasions(ship, movable, other)
        .map((destination) => {
          const gain = this.outcome({ maneuver: { ship: slotTarget(ship), destination: slotTarget(destination) } }) - this.standing();
          return { destination, gain, score: gain + (this.covered(destination, ship, other) ? EVADE.cover : 0) };
        })
        .filter((option) => option.gain >= EVADE.gain);
      if (options.length === 0) continue;
      const best = Math.max(...options.map((option) => option.score));
      const good = options.filter((option) => option.score >= best - EVADE.margin);
      const choice = good[Math.min(good.length - 1, Math.floor(this.random() * good.length))]!;
      // Rettet es das Flaggschiff, weicht es immer aus.
      const decisive = ship === flagship && this.dies(ship) && choice.gain >= DECISIVE / 2;
      if (!decisive && this.random() < EVADE.stay) return null;
      return { ship, destination: choice.destination };
    }
    return null;
  }

  /** Wohin ein Schiff ausweichen kann: in einen freien Slot einer anderen Spalte, das Flaggschiff nur in die Command-Lane; die Mirage tauscht auch. */
  private evasions(ship: Slot, movable: readonly Slot[], other: Move | null): Slot[] {
    const free = this.destinations(ship, other).filter((slot) => slot.index !== ship.index && (ship !== this.flagship || slot.lane.type === "command"));
    if (ship.card!.id !== "mirage") return free;
    return [...free, ...movable.filter((slot) => slot.index !== ship.index && !isToken(slot.card!))];
  }

  /** Ein Strike-Schiff vor dem eigenen Flaggschiff. */
  private guards(slot: Slot): boolean {
    return slot.lane.type === "strike" && this.partner(slot) === this.flagship;
  }

  /**
   * Das Flaggschiff in Sicherheit: ungedeckt, sobald ein Gegner darauf feuern kann (auch die Railgun, `fireThreat`), oder
   * vorne angeschlagen, geht es hinter ein Strike-Schiff. Die Mirage tauscht lieber (`phaseSwap`); die Pendulum bewegt
   * sich nur, wenn ihr der Fall droht.
   */
  private protectFlagship(movable: readonly Slot[], other: Move | null): Move | null {
    const flagship = this.flagship;
    if (flagship === null || !movable.includes(flagship) || flagship.card!.id === "mirage" || !this.board.isExposed(flagship)) return null;
    const threat = this.fireThreat(flagship);
    const falls = threat >= durability(flagship);
    const inDanger = flagship.lane.type === "strike" ? falls || durability(flagship) <= FLAGSHIP_RETREAT_HP : threat > 0;
    if (!inDanger || (flagship.card!.id === "pendulum" && !falls)) return null;
    const destination = this.shelter(flagship, other);
    return destination && { ship: flagship, destination };
  }

  /** Ein markiertes Schiff (die gegnerische Railgun feuert in dieser Runde) geht in Deckung, wenn ihr Schuss es zerstören kann. */
  private evadeMark(movable: readonly Slot[], other: Move | null): Move | null {
    const marked = movable.find((slot) => slot.marked && !isFlagship(slot.card!));
    if (!marked || !this.board.isExposed(marked) || durability(marked) > ABILITY_VALUES.railgun + 1) return null;
    const destination = this.shelter(marked, other);
    return destination && { ship: marked, destination };
  }

  /**
   * Phasentausch der Mirage: Ungedeckt unter Beschuss tauscht sie mit einem robusten Schiff in Deckung;
   * droht ein Torpedo, tauscht sie manchmal einfach den Platz, damit er das andere Schiff trifft.
   */
  private phaseSwap(movable: readonly Slot[], other: Move | null): Move | null {
    const mirage = this.flagship;
    if (mirage?.card?.id !== "mirage" || !movable.includes(mirage)) return null;
    const partners = movable.filter((slot) => slot !== mirage && slot !== other?.ship);
    const covered = partners.filter((slot) => !this.board.isExposed(slot));
    if (this.board.isExposed(mirage) && this.fireThreat(mirage) > 0) {
      const partner = highest(
        covered.filter((slot) => durability(slot) > this.hit(mirage) + 1 && !isToken(slot.card!)),
        durability,
      );
      if (partner) return { ship: mirage, destination: partner };
    }
    const torpedo = this.bot.opponent.commandHandSize > 0 && unplayed(this.bot, "torpedo") > 0;
    if (!torpedo || this.random() >= SWAP_CHANCE) return null;
    const partner = highest(this.board.isExposed(mirage) ? partners : covered, durability);
    return partner && { ship: mirage, destination: partner };
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
    const shelter = (slot: Slot) =>
      nearest(
        this.destinations(slot, other).filter((destination) => destination.lane === slot.lane && covered(destination)),
        slot.index,
      );
    const candidates = movable.filter(
      (slot) => slot.lane.type === "command" && this.board.isExposed(slot) && this.loss(slot) > this.shotValue(slot) && shelter(slot),
    );
    const ship = highest(candidates, (slot) => this.loss(slot) - this.shotValue(slot));
    return ship && { ship, destination: shelter(ship)! };
  }

  /** Vorrücken: Greift vorne niemand an, deckt ein robustes Command-Schiff (kein Flaggschiff) ein anderes. */
  private advance(movable: readonly Slot[], other: Move | null): Move | null {
    if (this.enemyAttack === 0 || this.attackersInFront(null, other) > 0) return null;
    const candidates = movable.filter(
      (slot) =>
        slot.lane.type === "command" &&
        !isFlagship(slot.card!) &&
        attacks(slot) &&
        !isFragile(slot.card!) &&
        durability(slot) > this.enemyMaxAttack &&
        this.attackerRemains(slot) &&
        this.move(slot, other)?.paired,
    );
    const ship = highest(candidates, hp);
    return ship && { ship, destination: this.move(ship, other)!.destination };
  }

  /** Das Flaggschiff weicht einem vermuteten Torpedo in einen anderen gedeckten Command-Slot aus, angeschlagen öfter. */
  private flagshipDodge(movable: readonly Slot[], other: Move | null): Move | null {
    const flagship = this.flagship;
    if (flagship === null || !movable.includes(flagship) || flagship.lane.type !== "command") return null;
    if (this.bot.opponent.commandHandSize === 0 || unplayed(this.bot, "torpedo") === 0) return null;
    if (this.random() >= (durability(flagship) <= 10 ? 0.3 : 0.1)) return null;
    const destination = this.shelter(flagship, other);
    return destination && { ship: flagship, destination };
  }

  /** Ausweichen: das Schiff (kein Flaggschiff), auf das ein gegnerischer Torpedo am ehesten zielt, wechselt die Lane. */
  private dodge(movable: readonly Slot[], other: Move | null): Move | null {
    const ship = highest(
      this.settled(this.own).filter((slot) => !isFlagship(slot.card!)),
      (slot) => this.torpedoValue(slot),
    );
    if (ship === null || !movable.includes(ship) || this.uncovers(ship) || !this.attackerRemains(ship)) return null;
    const move = this.move(ship, other);
    return move && { ship, destination: move.destination };
  }

  // --- Admiralsfähigkeit und Markierung ---

  /**
   * Admiralsfähigkeit statt Grundmanöver: Jedes mögliche Ziel der Fähigkeit und das geplante Manöver werden im
   * Kampf dieser Runde durchgespielt (gegen das vermutete Feuer des Gegners, sonst ohne seinen Zug); die Fähigkeit
   * gewinnt, wenn sie mehr bringt als das Manöver samt Vorschuss. Mit Freier Hand (`both`) gibt es beide.
   */
  planPower(maneuver: TurnPlan["maneuver"], command: Option | null, both = false): { maneuver: TurnPlan["maneuver"]; power: TurnPlan["power"] } {
    const best = this.bestPower(command, both ? maneuver : null);
    if (best === null) return { maneuver, power: null };
    if (!both && maneuver && this.maneuverGain(maneuver) >= best.gain) return { maneuver, power: null };
    return { maneuver: both ? maneuver : null, power: { target: best.target } };
  }

  /** Das beste Ziel der Fähigkeit und was sie bringt; null, wenn sie nichts bringt. Sie meidet die Ziel-Slots von Befehl und `maneuver`. */
  private bestPower(command: Option | null, maneuver: TurnPlan["maneuver"]): { target: SlotTarget; gain: number } | null {
    let best: { target: SlotTarget; gain: number } | null = null;
    for (const target of this.powerTargets(command, maneuver)) {
      const gain = this.outcome({ power: target }) - this.standing();
      if (gain > (best?.gain ?? 0)) best = { target, gain };
    }
    return best;
  }

  /** Was das Grundmanöver im Kampf dieser Runde bringt, samt Vorschuss. */
  private maneuverGain(maneuver: NonNullable<TurnPlan["maneuver"]>): number {
    return this.outcome({ maneuver }) - this.standing() + POWER.maneuverHeadStart;
  }

  /** Die Stellung nach dem Kampf dieser Runde, wenn niemand etwas tut. */
  private standing(): number {
    this.baseline ??= this.outcome({});
    return this.baseline;
  }

  /**
   * Der Kampf dieser Runde auf einer Kopie mit `trial`: die Stellung danach aus eigener Sicht, samt dem Feuer der
   * Folgerunden. Wie in `flagshipThreat` zählt dazu der stärkste Befehl des Gegners: Bleibt dem eigenen Flaggschiff nach
   * dem Kampf nicht mehr, fällt es (der Befehl wirkt vor dem Kampf); so rettet ein Schild nur, wenn er auch dafür reicht.
   */
  private outcome(trial: Trial): number {
    const { board } = this.battle(trial);
    resolveCombat(board, []);
    const flagship = board.flagship(this.side);
    const doomed = flagship !== null && flagship.hp > 0 && durability(flagship) <= this.commandDanger;
    resolveCleanup(board, []);
    const firepower = (side: Side) => board.ships(side).reduce((total, slot) => total + slot.attack, 0) * POWER.future;
    return positionScore(board, this.side) - (doomed ? DECISIVE : 0) + firepower(this.side) - firepower(opposite(this.side));
  }

  /**
   * Die Kopie zu Kampfbeginn, wie er sie erwartet: Die vermuteten Feuerbefehle des Gegners greifen wie beim Aufdecken
   * vor allen Bewegungen; sie folgen ihren Schützen, Schiffsfeuer auch seinem Ziel, die Spalten bleiben. Dann der eigene
   * Zug in der Reihenfolge der Auflösung (Fähigkeit, Manöver, Wächterschild, Befehl); zuletzt zielt er selbst (`aimFire`,
   * mit `lead` auch vorhaltend), mit allem, was er über seinen Zug weiß. Feuerbefehle gibt es auf beiden Seiten nur für
   * Schiffe, die beim Planen standen, Schiffsfeuer nur auf solche: `planned` nennt den Slot jedes Schiffs beim Planen je
   * Kennung (`Slot.uid`).
   */
  private battle({ power, maneuver, command, enemyPower }: Trial, lead: Lead | null = null): { board: Board; planned: Map<number, SlotTarget> } {
    const board = copyOf(this.board);
    const enemy = opposite(this.side);
    const at = (slot: Slot) => board.lane(slot.lane.side, slot.lane.type).slots[slot.index]!;
    const planned = new Map([...board.ships(this.side), ...board.ships(enemy)].map((slot) => [slot.uid, slotTarget(slot)]));
    const risk = new Map([...this.risks].map(([slot, value]) => [at(slot).uid, value]));
    for (const order of this.enemyFire) bindFire(board, enemy, order);
    if (power) resolvePower(board, this.side, { id: ADMIRALS[this.bot.admiral].power, target: power }, []);
    if (enemyPower) resolvePower(board, enemy, enemyPower, []);
    if (maneuver) applyMove(board, this.side, maneuver);
    resolveGuardianShields(board, []);
    if (command) {
      const ship = command.target && at(command.target);
      // Wärmesucher und Traktorstrahl wirken auf das erfasste Schiff.
      if (ship && targetsEnemyShip(command.card)) ship.locks = [command.card.id];
      resolveEffects(board, [{ commander: this.commander, card: command.card, target: ship, destination: command.destination && at(command.destination) }], []);
    }
    const aims = aimFire(
      board,
      this.side,
      (slot) => planned.has(slot.uid),
      (slot) => risk.get(slot.uid) ?? SAFE,
      lead,
    );
    for (const [shooter, target] of aims) shooter.aim = "ship" in target ? { uid: target.ship.uid } : target;
    return { board, planned };
  }

  /**
   * Die Feuerbefehle zum fertigen Zug: seine Zielwahl im Probekampf mit dem ganzen Zug, in den Slots beim Planen. Nur hier
   * hält er vor; die Probekämpfe, mit denen er Befehl, Manöver und Fähigkeit wählt, zielen auf die Stellung, wie sie ist.
   */
  planFire(trial: Trial): FireOrder[] {
    const { board, planned } = this.battle(trial, this.lead);
    return board.ships(this.side).flatMap(({ aim, uid }) => {
      if (aim === null) return [];
      const ship = planned.get(uid)!;
      return ["column" in aim ? { ship, column: aim.column } : { ship, target: planned.get(aim.uid)! }];
    });
  }

  /** Die gültigen Ziele der eigenen Fähigkeit (`powerTargets` auf der Kopie mit den gelegten Schiffen). */
  private powerTargets(command: Option | null, maneuver: TurnPlan["maneuver"]): SlotTarget[] {
    const power = ADMIRALS[this.bot.admiral].power;
    const blocked = [...(command?.destination ? [slotTarget(command.destination)] : []), ...(maneuver ? [maneuver.destination] : [])];
    return powerTargets(this.board, this.side, power, [], blocked).map(({ lane, slotIndex }) => ({ lane, slotIndex }));
  }

  /** Pendulum: markiert das Ziel, das ihre Railgun in der nächsten Runde am ehesten ungedeckt trifft; nicht, wenn sie sich bewegt. */
  planMark(maneuver: TurnPlan["maneuver"]): SlotTarget | null {
    if (maneuver && isSameSlot(maneuver.ship, slotTarget(this.flagship!))) return null;
    const strike = this.board.lane(opposite(this.side), "strike");
    const exposure = (slot: Slot) => {
      if (slot.lane.type === "strike") return 0.8;
      const front = strike.slots[slot.index]!;
      if (!front.isOccupied) return 0.6;
      return durability(front) <= 5 ? KERR.weakCover : KERR.covered;
    };
    const target = highest(
      this.enemies.filter((slot) => !isToken(slot.card!)),
      (slot) => damageValue(slot, ABILITY_VALUES.railgun) * exposure(slot),
    );
    return target && slotTarget(target);
  }
}

/** Die Stellung aus Sicht von `side`: HP und Schild aller Schiffe (des Flaggschiffs doppelt), je Schiff außer Tokens ein Bonus; der Fall eines Flaggschiffs entscheidet. */
function positionScore(board: Board, side: Side): number {
  const value = (of: Side) =>
    board
      .ships(of)
      .reduce((total, slot) => total + durability(slot) * (isFlagship(slot.card!) ? FLAGSHIP_WEIGHT : 1) + (isToken(slot.card!) ? 0 : KILL_BONUS), 0);
  const fallen = (of: Side) => (board.flagship(of) ? 0 : DECISIVE);
  return value(side) - value(opposite(side)) - fallen(side) + fallen(opposite(side));
}

/** Das Grundmanöver auf einer Brettkopie: Wechsel in einen freien Slot oder Phasentausch. */
function applyMove(board: Board, side: Side, { ship, destination }: NonNullable<TurnPlan["maneuver"]>): void {
  const from = board.lane(side, ship.lane).slots[ship.slotIndex]!;
  const to = board.lane(side, destination.lane).slots[destination.slotIndex]!;
  if (to.isOccupied) resolveSwap(from, to, []);
  else resolveManeuver(from, to, []);
}

// --- Feuerbefehle ---

/**
 * Die vermuteten Feuerbefehle von `side`, dem Gegner: dieselbe Zielwahl aus seiner Sicht (`aimFire`), auf die Stellung
 * beim Planen samt Wächterschild. Die Schiffe, die der Bot in dieser Runde legt, stehen dort noch nicht; sie fangen
 * höchstens die ersten Schüsse auf ihre Spalte ab, und Schiffsfeuer auf das Schiff dahinter verpufft an ihnen. `guard`:
 * womit der Bot noch Deckung schaffen kann (`Guard`).
 */
function predictFire(board: Board, side: Side, guard: Guard): FireOrder[] {
  const view = copyOf(board);
  resolveGuardianShields(view, []);
  const risk = risks(view, opposite(side), guard);
  const aims = aimFire(
    view,
    side,
    () => true,
    (slot) => risk.get(slot)!,
  );
  return [...aims].map(([shooter, target]) =>
    "ship" in target ? { ship: slotTarget(shooter), target: slotTarget(target.ship) } : { ship: slotTarget(shooter), column: target.column },
  );
}

/**
 * Vorhalten: Wohin das Flaggschiff von `side` in Deckung ausweicht, wenn es das vermutete Feuer der Gegenseite
 * (`predictFire`) fällt, wie der Bot es an seiner Stelle täte (`Situation.evade`): in einen freien Command-Slot einer
 * anderen Spalte hinter einem Strike-Schiff, der es rettet, am ehesten dorthin, wo ihm nach dem Kampf am meisten bleibt.
 * Gibt die Spalten zurück; leer, wenn es nicht fällt oder kein solcher Slot es rettet. Ungedeckte Slots zählen nicht: Dort
 * rettet es nur, wenn der Gegner auf seine Spalte zielt, und das tut er, wenn es auch in Deckung ausweichen kann.
 * `guard`: womit `side` noch Deckung schaffen kann (`Guard`).
 */
function flagshipEscapes(board: Board, side: Side, guard: Guard): number[] {
  const flagship = board.flagship(side);
  if (flagship === null) return [];
  const fire = predictFire(board, opposite(side), guard);
  /** Was dem Flaggschiff nach dem Kampf bleibt, wenn es in den Command-Slot `destination` ausweicht (null: bleibt stehen). */
  const remaining = (destination: Slot | null) => {
    const copy = copyOf(board);
    for (const order of fire) bindFire(copy, opposite(side), order);
    const from = copy.lane(side, flagship.lane.type).slots[flagship.index]!;
    const to = destination && copy.lane(side, "command").slots[destination.index]!;
    if (to) resolveManeuver(from, to, []);
    resolveGuardianShields(copy, []);
    resolveCombat(copy, []);
    const ship = to ?? from;
    return ship.hp > 0 ? durability(ship) : 0;
  };
  if (remaining(null) > 0) return [];
  const strike = board.lane(side, "strike");
  return board
    .maneuverDestinations(flagship)
    .filter((slot) => slot.lane.type === "command" && slot.index !== flagship.index && strike.slots[slot.index]!.isOccupied)
    .map((slot) => ({ slot, left: remaining(slot) }))
    .filter(({ left }) => left > 0)
    .sort((a, b) => b.left - a.left)
    .map(({ slot }) => slot.index);
}

/** Ein Feuerbefehl im Probekampf (`aimFire`): Spaltenfeuer auf eine Spalte der Gegenseite oder Schiffsfeuer auf ein gegnerisches Schiff. */
type Target = { column: number } | { ship: Slot };

/**
 * Die Zielwahl von `side` im Kampf auf `board`, der Stellung zu Kampfbeginn, wie die Seite sie erwartet: je Schütze eine
 * Spalte oder ein Schiff der Gegnerseite. Schützen sind ihre Kampfschiffe, die feuern können, Ziele für Schiffsfeuer die
 * gegnerischen Schiffe, beide nur, wenn sie beim Planen standen (`planned`). Gezielt wird erst wie mit Spaltenfeuer, das
 * in dieser Stellung nie weniger bringt: Jeder Schuss trifft das vorderste Schiff der Spalte, das dann noch steht
 * (Flaggschiffe schießen am Trugbild vorbei), in Kampfreihenfolge (Taktvorsprung zuerst, dann nach Slots), sodass
 * Overkill auf das vordere Schiff auf das dahinter durchgeht; vorher feuert die Railgun, und Drohnen fliegen den
 * Schwarmangriff ohnehin (ihr Feuerbefehl gilt der Spalte ihres Ziels, falls Funkstille ihn aufhebt). So:
 * 1. Fällt das gegnerische Flaggschiff, feuern so viele auf seine Spalte, wie es dafür braucht, auch durch das Schiff
 *    davor: Das entscheidet das Match. Mit `lead` (Vorhalten) fällen es die übrigen, soweit sie reichen, auch in den
 *    gedeckten Spalten, in die es wohl ausweicht, per Spaltenfeuer durch die Deckung, die wahrscheinlichste zuerst; mit
 *    `lead.gamble` geht sie der Spalte vor, in der es steht. Ungedeckt auszuweichen rettet es nur vor Spaltenfeuer, und
 *    kann es nur das, folgt ihm schon der Abschuss per Schiffsfeuer (siehe 4.).
 * 2. Ein Schiff mit Taktvorsprung schießt einen gegnerischen Schützen vorne in einer Spalte ab, bevor der feuert.
 * 3. Dann Schritt für Schritt, was je Schaden am meisten bringt: ein Abschuss (`killValue`), auch des Schiffs hinter einem,
 *    das dabei fällt, mit möglichst wenig verschenktem Schaden (`killing`), oder ein Treffer ohne Abschuss, am Flaggschiff
 *    doppelt; bei Gleichstand der Abschuss, sonst das Ziel, das danach am wenigsten übrig hat. Ein Ziel, das wohl jedem
 *    Schuss entgeht (`Risk.unsure`), zählt halb.
 * 4. Schiffsfeuer: Was dabei fällt oder schwer getroffen wird (`EVADE.hit`), weicht wohl aus. Kann es das nur ungedeckt
 *    (`Risk.open`) und legt der Gegner nichts davor (`guardTarget`: vor das ungedeckte Command-Schiff, auf das dieser
 *    Plan am meisten feuert, zuerst vor das Flaggschiff; kann davor nur Moreaus Trugbild landen, setzt er beim
 *    Flaggschiff mit `lead.gamble` auf das Ausweichen), zielt jeder Schuss, der es trifft, auf das Schiff statt auf die
 *    Spalte: Er trifft dasselbe, folgt ihm aber in jede Spalte. So bricht Spaltenfeuer die Deckung, und Schiffsfeuer
 *    trifft das Schiff dahinter.
 * 5. Wer dann noch übrig ist, weil alles in Reichweite schon fällt, zielt zur Sicherheit auf das wertvollste Ziel, am
 *    liebsten das Flaggschiff, wie in 4. per Schiffs- oder Spaltenfeuer (der Schuss verpufft, wenn es fällt, und trifft,
 *    wenn ihn ein Schild rettet oder ein frisch gelegtes Schiff davor die ersten Schüsse nimmt).
 * Gibt je Schütze das Ziel seines Feuerbefehls zurück.
 */
function aimFire(board: Board, side: Side, planned: (slot: Slot) => boolean, risk: (slot: Slot) => Risk, lead: Lead | null = null): Map<Slot, Target> {
  const enemy = opposite(side);
  const own = board.ships(side);
  const ships = board.ships(enemy);
  // ATK einmal je Schiff: `Slot.attack` rechnet Aura und Speerspitze bei jedem Aufruf neu.
  const attack = new Map([...own, ...ships].map((slot) => [slot, slot.attack]));
  /** Was jedem gegnerischen Schiff bis zum Abschuss fehlt, wenn die Salven beginnen: nach Railgun und Schwarmangriff. */
  const left = new Map(ships.map((slot) => [slot, durability(slot)]));
  const marked = ships.find((slot) => slot.marked);
  if (marked && board.isExposed(marked, true)) left.set(marked, left.get(marked)! - ABILITY_VALUES.railgun);
  const damage = (shooter: Slot, hit: Slot) => attack.get(shooter)! + (hit.powers.includes("focus_fire") ? ABILITY_VALUES.focusFire : 0);
  const orders = new Map<Slot, Target>();
  const shooters = own.filter((slot) => slot.canAttack);
  const swarmed = ships.find((slot) => slot.powers.includes("swarm_strike"));
  const drones = swarmed ? shooters.filter((slot) => slot.card!.id === "drone") : [];
  for (const drone of drones) {
    left.set(swarmed!, left.get(swarmed!)! - damage(drone, swarmed!) - ABILITY_VALUES.swarmStrike);
    if (planned(drone)) orders.set(drone, { column: swarmed!.index });
  }
  // Kampfreihenfolge: Taktvorsprung zuerst, dann nach Slots.
  const rank = new Map(own.map((slot, index) => [slot, (slot.powers.includes("head_start") ? 0 : own.length) + index]));
  let free = shooters.filter((slot) => planned(slot) && !drones.includes(slot)).sort((a, b) => attack.get(b)! - attack.get(a)!);
  /** Je Spalte die Schiffe, die stehen, wenn die Salven beginnen (vorne zuerst), und die Schützen, die darauf feuern. */
  const columns = Array.from({ length: SLOT_COUNT }, (_, index) => ({
    stack: (["strike", "command"] as const).map((lane) => board.lane(enemy, lane).slots[index]!).filter((slot) => slot.isOccupied && left.get(slot)! > 0),
    volley: [] as Slot[],
  }));
  /** Was den Schiffen von `stack` (vorne zuerst) nach den Schüssen `shots` in Kampfreihenfolge noch fehlt; `hit` erfährt jeden Treffer. */
  const rest = (stack: readonly Slot[], shots: readonly Slot[], hit?: (shooter: Slot, ship: Slot) => void): number[] => {
    const remaining = stack.map((slot) => left.get(slot)!);
    const standing = (index: number) => index < stack.length && remaining[index]! > 0;
    // Steht nur ein Schiff in der Spalte, spielt die Reihenfolge keine Rolle.
    for (const shooter of stack.length > 1 || hit ? [...shots].sort((a, b) => rank.get(a)! - rank.get(b)!) : shots) {
      // Wie in der Auflösung: das vorderste Schiff, das noch steht; Flaggschiffe schießen an einem Trugbild vorbei.
      const past = standing(1) && isFlagship(shooter.card!) && stack[0]!.card!.id === "decoy";
      const index = standing(0) && !past ? 0 : standing(1) ? 1 : -1;
      if (index < 0) continue;
      remaining[index]! -= damage(shooter, stack[index]!);
      hit?.(shooter, stack[index]!);
    }
    return remaining;
  };
  /** Was die Treffer in `stack` bringen: je Abschuss `killValue`, sonst der Schaden, am Flaggschiff doppelt; unsichere Ziele halb. */
  const worth = (stack: readonly Slot[], after: readonly number[]) =>
    stack.reduce((total, slot, index) => {
      const need = left.get(slot)!;
      const gain = after[index]! <= 0 ? killValue(slot, need, attack.get(slot)!) : (need - after[index]!) * (isFlagship(slot.card!) ? FLAGSHIP_WEIGHT : 1);
      return total + gain * (risk(slot).unsure ? UNSURE : 1);
    }, 0);
  /**
   * Die freien Schützen, die zusammen mit `volley` das Schiff `stack[target]` fällen, auch durch das Schiff davor, mit
   * möglichst wenig verschenktem Schaden: erst wie `killers` nach dem Schaden, der bis dahin fehlt, dann nachgelegt, falls
   * Overkill vorne einen Schuss mehr kostet, zuletzt ohne die Entbehrlichen, die stärksten zuerst; null, wenn alle
   * zusammen nicht reichen. `now`: was der Spalte nach `volley` noch fehlt; `pool`: die Schützen, die in Frage kommen.
   */
  const killing = (stack: readonly Slot[], volley: readonly Slot[], target: number, now = rest(stack, volley), pool = free): Slot[] | null => {
    // Steht nur ein Schiff in der Spalte, reicht der Schaden, der ihm fehlt.
    if (stack.length === 1) return killers(pool, now[0]!, (slot) => damage(slot, stack[0]!));
    const falls = (shots: readonly Slot[]) => rest(stack, [...volley, ...shots])[target]! <= 0;
    const need = now.slice(0, target + 1).reduce((total, value) => total + Math.max(0, value), 0);
    const first = killers(pool, need, (slot) => attack.get(slot)!);
    if (first === null) return null;
    let chosen = first;
    for (const extra of pool.filter((slot) => !first.includes(slot))) {
      if (falls(chosen)) break;
      chosen = [...chosen, extra];
    }
    if (!falls(chosen)) return null;
    for (const shooter of chosen) {
      const without = chosen.filter((slot) => slot !== shooter);
      if (without.length > 0 && falls(without)) chosen = without;
    }
    return chosen;
  };
  const assign = (shooters: readonly Slot[], column: number) => {
    for (const shooter of shooters) orders.set(shooter, { column });
    columns[column]!.volley.push(...shooters);
    free = free.filter((slot) => !shooters.includes(slot));
  };
  /** Schützen, die vorhalten: Sie zielen auf das Ausweichen des Flaggschiffs und behalten ihren Modus. */
  const leading = new Set<Slot>();

  // 1. Das Flaggschiff, wenn es fällt, auch durch das Schiff davor; mit Vorhalten auch hinter der Deckung, hinter die es
  //    wohl ausweicht. Ungedeckt auszuweichen rettet es nur vor Spaltenfeuer: Kann es nur das, folgt ihm der Abschuss per
  //    Schiffsfeuer (siehe 4.), sonst weicht es in Deckung aus.
  const flagship = ships.find((slot) => isFlagship(slot.card!));
  if (flagship && columns[flagship.index]!.stack.includes(flagship)) {
    const strike = board.lane(enemy, "strike");
    const away = (lead?.escapes ?? []).filter(
      (column) => column !== flagship.index && strike.slots[column]!.isOccupied && left.get(strike.slots[column]!)! > 0,
    );
    const stay = flagship.index;
    for (const column of lead?.gamble ? [...away.slice(0, 1), stay, ...away.slice(1)] : [stay, ...away]) {
      const stack = column === stay ? columns[column]!.stack : [strike.slots[column]!, flagship];
      const shooters = killing(stack, [], stack.indexOf(flagship));
      if (shooters === null) continue;
      assign(shooters, column);
      if (column !== stay) for (const shooter of shooters) leading.add(shooter);
    }
  }
  // 2. Taktvorsprung: ein gegnerischer Schütze vorne in einer Spalte, auf die noch niemand feuert, den er allein fällt.
  for (const shooter of free.filter((slot) => slot.powers.includes("head_start"))) {
    const prey = columns.flatMap(({ stack, volley }, column) => {
      const hit = stack[0];
      return hit && volley.length === 0 && hit.canAttack && damage(shooter, hit) >= left.get(hit)! ? [{ hit, column }] : [];
    });
    const target = highest(prey, ({ hit }) => killValue(hit, left.get(hit)!, attack.get(hit)!) + attack.get(hit)!);
    if (target) assign([shooter], target.column);
  }
  // 3. Der nächste Schritt: Abschuss oder Treffer mit dem meisten Wert je Schaden; bei Gleichstand der mit weniger Rest.
  /** Die möglichen Schritte auf eine Spalte: je stehendem Schiff ein Abschuss, dazu ein Treffer ohne Abschuss. */
  const stepsOn = (column: number) => {
    const { stack, volley } = columns[column]!;
    if (stack.length === 0 || free.length === 0) return [];
    const now = rest(stack, volley);
    const base = worth(stack, now);
    const steps: { shooters: Slot[]; rest: number }[] = [];
    for (const [target, value] of now.entries()) {
      const shooters = value > 0 ? killing(stack, volley, target, now) : null;
      if (shooters) steps.push({ shooters, rest: 0 });
    }
    // Ein Treffer ohne Abschuss: der stärkste freie Schütze, dessen Schuss nichts fällt.
    const spares = (slot: Slot) =>
      stack.length === 1 ? damage(slot, stack[0]!) < now[0]! : rest(stack, [...volley, slot]).every((value, index) => value > 0 || now[index]! <= 0);
    const chip = free.find(spares);
    if (chip) {
      const after = rest(stack, [...volley, chip]);
      steps.push({ shooters: [chip], rest: Math.min(...after.filter((value, index) => value < now[index]!)) });
    }
    return steps.map((step) => {
      const gain = worth(stack, rest(stack, [...volley, ...step.shooters])) - base;
      return { ...step, column, density: gain / step.shooters.reduce((total, slot) => total + attack.get(slot)!, 0) };
    });
  };
  const bestStep = () => {
    let best: ReturnType<typeof stepsOn>[number] | null = null;
    for (const step of columns.flatMap((_, column) => stepsOn(column))) {
      if (step.density > 0 && (best === null || step.density > best.density || (step.density === best.density && step.rest < best.rest))) best = step;
    }
    return best;
  };
  for (let step = bestStep(); step !== null; step = bestStep()) assign(step.shooters, step.column);
  // 4. Schiffsfeuer auf das, was dabei fällt oder schwer getroffen wird und nur ungedeckt ausweichen kann. Vor das
  //    ungedeckte Command-Schiff, auf das dieser Plan am meisten feuert, legt der Gegner wohl sein nächstes Schiff.
  const after = new Map<Slot, number>();
  const hits = new Map<Slot, Slot>();
  for (const { stack, volley } of columns) {
    const remaining = rest(stack, volley, (shooter, ship) => hits.set(shooter, ship));
    for (const [index, slot] of stack.entries()) after.set(slot, remaining[index]!);
  }
  const dealt = (slot: Slot) => durability(slot) - (after.get(slot) ?? left.get(slot)!);
  const guarded = guardTarget(
    ships.filter((slot) => risk(slot).guard !== null),
    dealt,
  );
  const follows = (slot: Slot) =>
    planned(slot) &&
    risk(slot).open &&
    (slot !== guarded || (risk(slot).guard === "decoy" && isFlagship(slot.card!) && lead?.gamble === true)) &&
    ((after.get(slot) ?? left.get(slot)!) <= 0 || dealt(slot) >= EVADE.hit);
  for (const [shooter, ship] of hits) {
    if (!leading.has(shooter) && follows(ship)) orders.set(shooter, { ship });
  }
  // 5. Zur Sicherheit.
  const spare = highest(ships, (slot) => killValue(slot, 0, attack.get(slot)!));
  for (const shooter of spare ? free : []) orders.set(shooter, follows(spare!) ? { ship: spare! } : { column: spare!.index });
  return orders;
}

/**
 * Die Schützen für einen Abschuss, dem `need` Schaden fehlt, mit möglichst wenig verschenktem Schaden: der schwächste, der
 * allein reicht, sonst der stärkste und weiter so; null, wenn alle zusammen nicht reichen. `able` ist nach Schaden absteigend sortiert.
 */
function killers(able: readonly Slot[], need: number, damage: (slot: Slot) => number): Slot[] | null {
  const pool = [...able];
  const chosen: Slot[] = [];
  for (let left = need; left > 0; ) {
    const finisher = pool.findLast((slot) => damage(slot) >= left);
    if (finisher) return [...chosen, finisher];
    const strongest = pool.shift();
    if (strongest === undefined) return null;
    chosen.push(strongest);
    left -= damage(strongest);
  }
  return chosen;
}

/**
 * Was der Abschuss eines Schiffs mit `attack` ATK bringt, dem noch `left` Schaden fehlt, gerechnet wie die Stellung
 * (`positionScore`): der Schaden, am Flaggschiff doppelt (sein Fall entscheidet), ein Bonus je Schiff außer Tokens und
 * sein Feuer in den Folgerunden.
 */
function killValue(slot: Slot, left: number, attack: number): number {
  const flagship = isFlagship(slot.card!);
  return left * (flagship ? FLAGSHIP_WEIGHT : 1) + (flagship ? DECISIVE : 0) + (isToken(slot.card!) ? 0 : KILL_BONUS) + attack * POWER.future;
}
