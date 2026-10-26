// Zielvorschau beim Planen: die Runde, wie sie mit dem eigenen Plan abliefe, wenn der Gegner nichts tut — kein
// Schiff, kein Befehl, kein Manöver, keine Fähigkeit. Gerechnet wird mit derselben Auflösung wie auf dem Server
// (`shared/resolution.ts`) auf einer Kopie des Bretts, samt Flaggschiff, Admiralsfähigkeit und Markierung der
// Pendulum; nur der Zufallsschuss der Plasma Frigate bleibt außen vor.

import { Board, type Side, type Slot } from "../../../shared/board.ts";
import type { ShipStats, SlotRef } from "../../../shared/protocol.ts";
import { resolveTurns, type Commander, type Turn } from "../../../shared/resolution.ts";
import type { Match } from "./match.ts";

export interface RoundPreview {
  /** Wer im Kampf auf wen feuert (auch die Railgun, wenn sie trifft), jeweils mit dem Slot nach allen Bewegungen. */
  shots: { attacker: SlotRef; target: SlotRef }[];
  /** Wo Schiffe fallen, mit dem Slot zu diesem Zeitpunkt; eingeplante Schiffe eingeschlossen. */
  losses: SlotRef[];
  /** Wohin Titan Carrier ihre Drohnen beim Deploy schicken; die Drohne der Hive startet erst nach dem Kampf. */
  drones: SlotRef[];
  /** Je Schiff, das schon auf dem Brett steht (nach seinem jetzigen Slot): HP und Schild nach der Runde, null, wenn es fällt. */
  outcomes: Map<Slot, ShipStats | null>;
}

/** Nachgezogen wird in der Vorschau nicht. */
const commander = (side: Side): Commander => ({ side, drawExtra: () => ({ ships: 0, commands: 0 }) });

const slotRef = (slot: Slot): SlotRef => ({ side: slot.lane.side, lane: slot.lane.type, slotIndex: slot.index });
const key = ({ side, lane, slotIndex }: SlotRef) => `${side}-${lane}-${slotIndex}`;
const at = ({ side, lane, slotIndex }: SlotRef): SlotRef => ({ side, lane, slotIndex });

export function previewRound(match: Match): RoundPreview {
  const board = new Board();
  board.load(match.board.snapshot());
  board.overdrive = match.board.overdrive;
  board.hiveLaunches = { ...match.board.hiveLaunches };
  const { ships, flagship, command, maneuver, power, mark } = match.plan;
  const turn: Turn = {
    commander: commander("player"),
    ships: ships.map(({ handIndex, target }) => ({ card: match.shipHand[handIndex]!, target })),
    flagship: flagship && { card: match.flagship!, target: flagship },
    command: command && { card: match.commandHand[command.handIndex]!, target: command.target, destination: command.destination },
    maneuver,
    power: power && { id: match.power!, target: power.target },
    mark,
  };
  const idle: Turn = { commander: commander("enemy"), ships: [], flagship: null, command: null, maneuver: null, power: null, mark: null };
  const events = resolveTurns(board, [turn, idle], null);

  const preview: RoundPreview = { shots: [], losses: [], drones: [], outcomes: new Map() };
  /** Wohin Schiffe gewechselt sind; jedes Schiff bewegt sich höchstens einmal je Runde. */
  const moved = new Map<string, SlotRef>();
  for (const event of events) {
    if (event.kind === "maneuver") moved.set(key(event.ship), { side: event.side, ...event.to });
    if (event.kind === "swap") {
      moved.set(key(event.a), at(event.b));
      moved.set(key(event.b), at(event.a));
    }
    if (event.kind === "effect" && event.effect.type === "move") moved.set(key(event.ship), { side: event.ship.side, ...event.effect.to });
    if (event.kind === "attack") preview.shots.push({ attacker: event.attacker, target: event.target });
    if (event.kind === "railgun" && !event.blocked) preview.shots.push({ attacker: event.source, target: event.target });
    if (event.kind === "destroyed") preview.losses.push(event.ship);
    if (event.kind === "spawn" && event.source.cardId !== "hive") preview.drones.push(event.ship);
  }
  // Wer fällt, steht mit seinem Slot nach allen Bewegungen in `losses`; dort kann die Hive am Rundenende schon die
  // nächste Drohne starten.
  const lost = new Set(preview.losses.map(key));
  for (const slot of [...match.board.ships("player"), ...match.board.ships("enemy")]) {
    const to = moved.get(key(slotRef(slot))) ?? slotRef(slot);
    const after = board.lane(to.side, to.lane).slots[to.slotIndex]!;
    preview.outcomes.set(slot, lost.has(key(to)) ? null : { hp: after.hp, shield: after.shield });
  }
  return preview;
}
