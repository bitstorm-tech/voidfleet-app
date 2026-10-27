// Zielvorschau beim Planen: die Runde, wie sie mit dem eigenen Plan abliefe, wenn der Gegner nichts tut — kein
// Schiff, kein Befehl, kein Manöver, keine Fähigkeit, kein Feuerbefehl. Gerechnet wird mit derselben Auflösung wie auf
// dem Server (`shared/resolution.ts`) auf einer Kopie des Bretts, samt Flaggschiff, Admiralsfähigkeit, Markierung der
// Pendulum und Feuerbefehlen; nur der Zufallsschuss der Plasma Frigate bleibt außen vor. Die eigenen Schüsse und was
// sie anrichten, stimmen also genau; was der Gegner in dieser Runde vorhat, zeigt die Vorschau nicht.

import { Board, isSameSlot, type Side, type Slot } from "../../../shared/board.ts";
import type { ShipRef, ShipStats, SlotRef, SlotTarget, TurnPlan } from "../../../shared/protocol.ts";
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
  /** Wo Schiffe fallen, mit dem Slot zu diesem Zeitpunkt; eingeplante Schiffe eingeschlossen. */
  losses: SlotRef[];
  /**
   * Wohin Titan Carrier ihre Drohnen beim Deploy schicken und die Drohnenstaffel ihre startet; die Drohne der Hive
   * startet erst nach dem Kampf.
   */
  drones: SlotRef[];
  /**
   * Je Schiff, das schon auf dem Brett steht (nach seinem jetzigen Slot): HP und Schild nach der Runde, null, wenn es
   * fällt. Ein Schiff im Kurzsprung ist am Rundenende wieder da.
   */
  outcomes: Map<Slot, ShipStats | null>;
}

/** Nachgezogen wird in der Vorschau nicht (Plündern, Gegenmaßnahmen). */
const commander = (side: Side): Commander => ({ side, drawExtra: (_ships: number, _commands: number) => ({ ships: 0, commands: 0 }) });

const slotRef = (slot: Slot): SlotRef => ({ side: slot.lane.side, lane: slot.lane.type, slotIndex: slot.index });
const key = ({ side, lane, slotIndex }: SlotRef) => `${side}-${lane}-${slotIndex}`;
const at = ({ side, lane, slotIndex }: SlotRef): SlotRef => ({ side, lane, slotIndex });

/** `plan`: der eigene Zug, sonst der eingeplante (unter dem Zeiger etwa mit einem anderen Ziel, siehe `Match.tryPlan`). */
export function previewRound(match: Match, plan: TurnPlan = match.plan): RoundPreview {
  const board = new Board();
  board.load(match.board.snapshot());
  board.overdrive = match.board.overdrive;
  board.hiveLaunches = { ...match.board.hiveLaunches };
  const idle: Turn = { commander: commander("enemy"), ships: [], flagship: null, command: null, maneuver: null, power: null, mark: null, fire: [] };
  const events = resolveTurns(board, [ownTurn(match, plan), idle], null);
  // Wohin Schiffe gewechselt sind, je Schiff höchstens einmal.
  const moves = events.flatMap((event): { from: SlotRef; to: SlotRef }[] => {
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
  for (const event of events) {
    if (event.kind === "attack") {
      preview.shots.push({ attacker: at(event.attacker), shooter: before(event.attacker), target: event.target, aimedAt: event.aimedAt ?? null, fizzle: false });
    }
    if (event.kind === "fizzle") {
      const shooter = before(event.attacker);
      preview.shots.push({ attacker: at(event.attacker), shooter, target: event.target ?? gone(shooter), aimedAt: event.aimedAt ?? null, fizzle: true });
    }
    if (event.kind === "railgun" && !event.blocked) preview.shots.push({ attacker: event.source, shooter: null, target: event.target, aimedAt: null, fizzle: false });
    if (event.kind === "destroyed") preview.losses.push(at(event.ship));
    if (event.kind === "spawn" && event.source.cardId !== "hive") preview.drones.push(event.ship);
    if (event.kind === "effect" && event.effect.type === "spawn") preview.drones.push(event.ship);
  }

  // Wer fällt, steht mit seinem Slot nach allen Bewegungen in `losses`; dort kann die Hive am Rundenende schon die
  // nächste Drohne starten.
  const lost = new Set(preview.losses.map(key));
  for (const slot of [...match.board.ships("player"), ...match.board.ships("enemy")]) {
    const to = after(slotRef(slot));
    const { hp, shield } = board.lane(to.side, to.lane).slots[to.slotIndex]!;
    preview.outcomes.set(slot, lost.has(key(to)) ? null : { hp, shield });
  }
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
