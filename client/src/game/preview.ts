// Zielvorschau beim Planen: die Runde, wie sie mit dem eigenen Plan abliefe. Gerechnet wird mit derselben Auflösung
// wie auf dem Server (`shared/resolution.ts`) auf Kopien des Bretts, samt Flaggschiff, Admiralsfähigkeit, Markierung
// der Pendulum und Feuerbefehlen; nur der Zufallsschuss der Plasma Frigate bleibt außen vor. Der Gegner tut dabei
// nichts — kein Schiff, kein Befehl, kein Manöver, keine Fähigkeit, kein Feuerbefehl —, die eigenen Schüsse und was sie
// auf der Gegnerseite anrichten, stimmen also genau. Was der Gegner den eigenen Schiffen antun kann, zeigt die
// Bedrohung: je eigenes Schiff auf dem Brett ein weiterer Durchgang, in dem alle seine Kampfschiffe darauf feuern
// (Fokusfeuer bzw. Schwarmangriff auch darauf, wenn sein Admiral sie hat). Deckung, Ablenkung, EMP und Taktvorsprung
// wirken darin wie im Spiel; ein Schiff, das in dieser Runde landet, ist kein Ziel, fängt als Deckung aber Schüsse ab.

import { ADMIRALS, type PowerId } from "../../../shared/admirals.ts";
import { Board, isSameSlot, slotTarget, type Side, type Slot } from "../../../shared/board.ts";
import { powerTargets } from "../../../shared/powers.ts";
import type { FireOrder, RoundEvent, ShipRef, ShipStats, SlotRef, SlotTarget, TurnPlan } from "../../../shared/protocol.ts";
import { resolveTurns, type Commander, type Turn } from "../../../shared/resolution.ts";
import type { Match } from "./match.ts";

/** Ein Schuss im Kampf, mit den Slots nach allen Bewegungen. */
export interface PreviewShot {
  attacker: SlotRef;
  /** Bei eigenen Schüssen der Slot des Schützen beim Planen, an dem sein Feuerbefehl hängt; bei der Railgun null. */
  shooter: SlotTarget | null;
  /** Das Schiff, das der Schuss trifft (auch die Deckung, die ihn abfängt); bei einem verpuffenden das, das er treffen sollte. */
  target: ShipRef;
  /** Das Ziel des Feuerbefehls, wenn die Deckung davor den Schuss abfängt (auch eine schon zerstörte: Er verpufft an ihr). */
  aimedAt: ShipRef | null;
  /** Der Schuss verpufft: Sein Ziel ist dann schon zerstört. */
  fizzle: boolean;
}

export interface RoundPreview {
  /** Wer im Kampf auf wen feuert: die eigenen Schüsse samt verpuffenden und die Railguns, wenn sie treffen. */
  shots: PreviewShot[];
  /**
   * Wo Schiffe fallen, mit dem Slot zu diesem Zeitpunkt, eingeplante eingeschlossen: gegnerische durch den eigenen Zug,
   * eigene, wenn der Gegner sein Feuer auf sie (oder auf das Schiff hinter ihnen) zusammenzieht.
   */
  losses: SlotRef[];
  /**
   * Wohin Titan Carrier ihre Drohnen beim Deploy schicken und die Drohnenstaffel ihre startet; die Drohne der Hive
   * startet erst nach dem Kampf.
   */
  drones: SlotRef[];
  /**
   * Je Schiff, das schon auf dem Brett steht (nach seinem jetzigen Slot): HP und Schild nach der Runde, bei eigenen im
   * schlimmsten Fall der Bedrohung; null, wenn es fällt bzw. fallen kann. Ein Schiff im Kurzsprung ist am Rundenende wieder da.
   */
  outcomes: Map<Slot, ShipStats | null>;
}

/** Ein Durchgang der Runde auf einer Kopie des Bretts: das Brett danach, die Ereignisse und wo Schiffe fallen. */
interface Run {
  board: Board;
  events: RoundEvent[];
  losses: SlotRef[];
}

/** Fokusfeuer und Schwarmangriff des Gegners machen zusammengezogenes Feuer stärker; seine übrigen Fähigkeiten nicht. */
const THREAT_POWERS: readonly PowerId[] = ["focus_fire", "swarm_strike"];

/** Nachgezogen wird in der Vorschau nicht (Plündern, Gegenmaßnahmen). */
const commander = (side: Side): Commander => ({ side, drawExtra: (_ships: number, _commands: number) => ({ ships: 0, commands: 0 }) });

const slotRef = (slot: Slot): SlotRef => ({ side: slot.lane.side, lane: slot.lane.type, slotIndex: slot.index });
const key = ({ side, lane, slotIndex }: SlotRef) => `${side}-${lane}-${slotIndex}`;
const at = ({ side, lane, slotIndex }: SlotRef): SlotRef => ({ side, lane, slotIndex });

/** `plan`: der eigene Zug, sonst der eingeplante (unter dem Zeiger etwa mit einem anderen Ziel, siehe `Match.tryPlan`). */
export function previewRound(match: Match, plan: TurnPlan = match.plan): RoundPreview {
  const own = ownTurn(match, plan);
  const base = resolve(match, own, enemyTurn());
  // Wohin Schiffe gewechselt sind, je Schiff höchstens einmal; in jedem Durchgang dieselben, der Gegner bewegt nichts.
  const moves = base.events.flatMap((event): { from: SlotRef; to: SlotRef }[] => {
    if (event.kind === "maneuver") return [{ from: at(event.ship), to: { side: event.side, ...event.to } }];
    if (event.kind === "swap") return [{ from: at(event.a), to: at(event.b) }, { from: at(event.b), to: at(event.a) }];
    if (event.kind === "effect" && event.effect.type === "move") return [{ from: at(event.ship), to: { side: event.ship.side, ...event.effect.to } }];
    return [];
  });
  const after = (ref: SlotRef) => moves.find((move) => key(move.from) === key(ref))?.to ?? ref;
  const before = (ref: SlotRef) => moves.find((move) => key(move.to) === key(ref))?.from ?? ref;
  /**
   * Das Ziel eines Schusses, der ins Leere geht: Das Schiff seines Feuerbefehls ist schon vor dem Kampf gefallen, dort,
   * wo es zuletzt stand. (Drohnen im Schwarmangriff verpuffen nur an ihrem Ziel, das dann noch steht.)
   */
  const gone = (shooter: SlotRef): ShipRef => {
    const order = plan.fire.find((order) => isSameSlot(order.ship, shooter))!;
    const aimed = match.board.lane("enemy", order.target.lane).slots[order.target.slotIndex]!;
    return { ...after(slotRef(aimed)), cardId: aimed.card!.id };
  };

  const preview: RoundPreview = { shots: [], losses: [], drones: [], outcomes: new Map() };
  for (const event of base.events) {
    if (event.kind === "attack") {
      preview.shots.push({ attacker: at(event.attacker), shooter: before(event.attacker), target: event.target, aimedAt: event.aimedAt ?? null, fizzle: false });
    }
    if (event.kind === "fizzle") {
      const shooter = before(event.attacker);
      preview.shots.push({ attacker: at(event.attacker), shooter, target: event.target ?? gone(shooter), aimedAt: event.aimedAt ?? null, fizzle: true });
    }
    if (event.kind === "railgun" && !event.blocked) preview.shots.push({ attacker: event.source, shooter: null, target: event.target, aimedAt: null, fizzle: false });
    if (event.kind === "spawn" && event.source.cardId !== "hive") preview.drones.push(event.ship);
    if (event.kind === "effect" && event.effect.type === "spawn") preview.drones.push(event.ship);
  }

  // Wer fällt, steht mit seinem Slot nach allen Bewegungen in `losses`; dort kann die Hive am Rundenende schon die
  // nächste Drohne starten.
  const outcome = (run: Run, slot: Slot): ShipStats | null => {
    const to = after(slotRef(slot));
    if (run.losses.some((ref) => key(ref) === key(to))) return null;
    const { hp, shield } = run.board.lane(to.side, to.lane).slots[to.slotIndex]!;
    return { hp, shield };
  };
  const runs = [base, ...threats(match, own)];
  for (const slot of match.board.ships("enemy")) preview.outcomes.set(slot, outcome(base, slot));
  for (const slot of match.board.ships("player")) preview.outcomes.set(slot, runs.map((run) => outcome(run, slot)).reduce(worse));
  const losses = new Map(base.losses.map((ref) => [key(ref), ref]));
  for (const ref of runs.flatMap((run) => run.losses).filter((ref) => ref.side === "player")) losses.set(key(ref), ref);
  preview.losses = [...losses.values()];
  return preview;
}

/** Der eigene Zug aus dem Plan, mit den Karten statt der Hand-Indizes. */
function ownTurn(match: Match, { ships, flagship, command, maneuver, power, mark, fire }: TurnPlan): Turn {
  return {
    commander: commander("player"),
    ships: ships.map(({ handIndex, target }) => ({ card: match.shipHand[handIndex]!, target })),
    flagship: flagship && { card: match.flagship!, target: flagship },
    command: command && { card: match.commandHand[command.handIndex]!, target: command.target, destination: command.destination },
    maneuver,
    power: power && { id: match.power!, target: power.target },
    mark,
    fire,
  };
}

/** Der Zug des Gegners: nichts, in den Durchgängen der Bedrohung nur Feuerbefehle und Fähigkeit. */
function enemyTurn(fire: FireOrder[] = [], power: Turn["power"] = null): Turn {
  return { commander: commander("enemy"), ships: [], flagship: null, command: null, maneuver: null, power, mark: null, fire };
}

/**
 * Die Durchgänge der Bedrohung: je eigenes Schiff auf dem Brett einer, in dem alle gegnerischen Kampfschiffe darauf
 * feuern, und einer mit Fokusfeuer bzw. Schwarmangriff darauf, wenn der gegnerische Admiral sie hat und das Schiff ein
 * Ziel dafür ist (`powerTargets` aus seiner Sicht). Beide, weil der Schwarmangriff die Drohnen an der Deckung vorbeilenkt:
 * Ohne ihn trifft die Deckung mehr, auch ein Schiff, das in dieser Runde landet.
 */
function threats(match: Match, own: Turn): Run[] {
  const gunners = match.board.ships("enemy").filter((slot) => slot.card!.atk > 0);
  if (gunners.length === 0) return [];
  const admiral = match.opponent?.admiral;
  const power = admiral && THREAT_POWERS.includes(ADMIRALS[admiral].power) ? ADMIRALS[admiral].power : null;
  const powered = power ? powerTargets(match.board, "enemy", power, [], []) : [];
  return match.board.ships("player").flatMap((ship) => {
    const target = slotTarget(ship);
    const fire = gunners.map((slot) => ({ ship: slotTarget(slot), target }));
    const runs = [resolve(match, own, enemyTurn(fire))];
    if (power && powered.some((ref) => isSameSlot(ref, target))) runs.push(resolve(match, own, enemyTurn(fire, { id: power, target })));
    return runs;
  });
}

function resolve(match: Match, own: Turn, enemy: Turn): Run {
  const board = new Board();
  board.load(match.board.snapshot());
  board.overdrive = match.board.overdrive;
  board.hiveLaunches = { ...match.board.hiveLaunches };
  const events = resolveTurns(board, [own, enemy], null);
  return { board, events, losses: events.flatMap((event) => (event.kind === "destroyed" ? [at(event.ship)] : [])) };
}

/** Der schlimmere von zwei Ausgängen: gefallen, sonst weniger HP, bei Gleichstand weniger Schild. */
function worse(a: ShipStats | null, b: ShipStats | null): ShipStats | null {
  if (a === null || b === null) return null;
  return a.hp < b.hp || (a.hp === b.hp && a.shield <= b.shield) ? a : b;
}
