// Zielvorschau beim Planen: die Runde, wie sie mit dem eigenen Plan abliefe, wenn der Gegner nichts tut — kein
// Schiff, kein Befehl, kein Manöver, keine Fähigkeit, kein Feuerbefehl. Gerechnet wird mit derselben Auflösung wie auf
// dem Server (`shared/resolution.ts`) auf einer Kopie des Bretts, samt Flaggschiff, Admiralsfähigkeit, Markierung der
// Pendulum und Feuerbefehlen; nur der Zufallsschuss der Plasma Frigate bleibt außen vor. Die eigenen Schüsse und was
// sie anrichten, stimmen also genau; was der Gegner in dieser Runde vorhat, zeigt die Vorschau nicht.

import { Board, isSameSlot, opposite, type Side, type Slot } from "../../../shared/board.ts";
import type { Miss, ShipRef, ShipStats, SlotRef, SlotTarget, TurnPlan } from "../../../shared/protocol.ts";
import { type Commander, resolveTurns, type Turn } from "../../../shared/resolution.ts";
import type { Match } from "./match.ts";

/**
 * Ein Schuss im Kampf, mit den Slots nach allen Bewegungen: Er trifft ein Schiff (`hit`; `through`: Spaltenfeuer, das
 * durchging, weil das vordere Schiff der Spalte vorher gefallen ist) oder verpufft (`miss`, mit dem Grund).
 */
export type PreviewShot = {
  attacker: SlotRef;
  /** Bei eigenen Schüssen der Slot des Schützen beim Planen, an dem sein Feuerbefehl hängt; bei der Railgun null. */
  shooter: SlotTarget | null;
  /**
   * Wohin der Bogen fällt: auf das getroffene Schiff; verpufft der Schuss, auf das verfolgte Schiff bzw. bei Spaltenfeuer
   * auf das vorderste Schiff, das in der Spalte gefallen ist, sonst auf ihren Strike-Slot.
   */
  target: SlotRef;
  /** Schiffsfeuer: Der Schuss verfolgt sein Ziel. */
  tracking: boolean;
} & ({ hit: ShipRef; through: boolean } | { miss: Miss });

export interface RoundPreview {
  /** Wer im Kampf worauf feuert: die eigenen Schüsse samt verpuffenden und die Railguns, wenn sie treffen. */
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
    if (event.kind === "swap")
      return [
        { from: at(event.a), to: at(event.b) },
        { from: at(event.b), to: at(event.a) },
      ];
    if (event.kind === "effect" && event.effect.type === "move") return [{ from: at(event.ship), to: { side: event.ship.side, ...event.effect.to } }];
    return [];
  });
  const after = (ref: SlotRef) => moves.find((move) => key(move.from) === key(ref))?.to ?? ref;
  const before = (ref: SlotRef) => moves.find((move) => key(move.to) === key(ref))?.from ?? ref;
  /** Das Ziel des Schiffsfeuers eines eigenen Schützen (Slot beim Planen); null bei Spaltenfeuer oder ohne Feuerbefehl. */
  const tracked = (shooter: SlotRef): SlotTarget | null => {
    const order = plan.fire.find((order) => isSameSlot(order.ship, shooter));
    return order && "target" in order ? order.target : null;
  };
  const losses = events.flatMap((event) => (event.kind === "destroyed" ? [at(event.ship)] : []));
  const fell = new Set(losses.map(key));
  /** Wo verpuffendes Spaltenfeuer verlischt: am vordersten Schiff, das in der Spalte gefallen ist, sonst im Strike-Slot. */
  const columnEnd = (side: Side, column: number): SlotRef => {
    const front: SlotRef = { side, lane: "strike", slotIndex: column };
    const back: SlotRef = { side, lane: "command", slotIndex: column };
    return !fell.has(key(front)) && fell.has(key(back)) ? back : front;
  };

  const preview: RoundPreview = { shots: [], losses, drones: [], outcomes: new Map() };
  for (const event of events) {
    if (event.kind === "attack") {
      const shooter = before(event.attacker);
      const tracking = tracked(shooter) !== null && !event.swarm && !event.taunt;
      preview.shots.push({ attacker: at(event.attacker), shooter, target: event.target, tracking, hit: event.target, through: event.through ?? false });
    }
    if (event.kind === "fizzle") {
      const shooter = before(event.attacker);
      // Schiffsfeuer auf ein Schiff, das schon vor dem Kampf gefallen ist, geht dorthin, wo es zuletzt stand. (Drohnen im
      // Schwarmangriff verpuffen nur an ihrem Ziel, das dann noch steht.)
      const target =
        "column" in event ? columnEnd(opposite(event.attacker.side), event.column) : (event.target ?? after({ side: "enemy", ...tracked(shooter)! }));
      preview.shots.push({ attacker: at(event.attacker), shooter, target, tracking: "target" in event && tracked(shooter) !== null, miss: event });
    }
    if (event.kind === "railgun" && !event.blocked)
      preview.shots.push({ attacker: event.source, shooter: null, target: event.target, tracking: false, hit: event.target, through: false });
    if (event.kind === "spawn" && event.source.cardId !== "hive") preview.drones.push(event.ship);
    if (event.kind === "effect" && event.effect.type === "spawn") preview.drones.push(event.ship);
  }

  // Wer fällt, steht mit seinem Slot nach allen Bewegungen in `losses`; dort kann die Hive am Rundenende schon die
  // nächste Drohne starten.
  for (const slot of [...match.board.ships("player"), ...match.board.ships("enemy")]) {
    const to = after(slotRef(slot));
    const { hp, shield } = board.lane(to.side, to.lane).slots[to.slotIndex]!;
    preview.outcomes.set(slot, fell.has(key(to)) ? null : { hp, shield });
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
