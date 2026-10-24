// Zielvorschau beim Planen: die Runde, wie sie mit dem eigenen Plan abliefe, wenn der Gegner nichts tut — kein
// Schiff, kein Befehl, kein Manöver. Gerechnet wird mit derselben Auflösung wie auf dem Server
// (`shared/resolution.ts`) auf einer Kopie des Bretts; nur der Zufallsschuss der Plasma Frigate bleibt außen vor.

import { Board, type Side, type Slot } from "../../../shared/board.ts";
import type { ShipStats, SlotRef } from "../../../shared/protocol.ts";
import { resolveTurns, type Commander, type Turn } from "../../../shared/resolution.ts";
import type { Match } from "./match.ts";

export interface RoundPreview {
  /** Wer im Kampf auf wen feuert, jeweils mit dem Slot nach allen Bewegungen. */
  shots: { attacker: SlotRef; target: SlotRef }[];
  /** Wo Schiffe fallen, mit dem Slot zu diesem Zeitpunkt; eingeplante Schiffe eingeschlossen. */
  losses: SlotRef[];
  /** Wohin Titan Carrier ihre Drohnen schicken. */
  drones: SlotRef[];
  /** Je Schiff, das schon auf dem Brett steht (nach seinem jetzigen Slot): HP und Schild nach der Runde, null, wenn es fällt. */
  outcomes: Map<Slot, ShipStats | null>;
}

/** Nachgezogen wird in der Vorschau nicht. */
const commander = (side: Side): Commander => ({ side, drawExtra: () => ({ ships: 0, commands: 0 }) });

const slotRef = (slot: Slot): SlotRef => ({ side: slot.lane.side, lane: slot.lane.type, slotIndex: slot.index });
const key = ({ side, lane, slotIndex }: SlotRef) => `${side}-${lane}-${slotIndex}`;

export function previewRound(match: Match): RoundPreview {
  const board = new Board();
  board.load(match.board.snapshot());
  board.overdrive = match.board.overdrive;
  const { ships, command, maneuver } = match.plan;
  const turn: Turn = {
    commander: commander("player"),
    ships: ships.map(({ handIndex, target }) => ({ card: match.shipHand[handIndex]!, target })),
    command: command && { card: match.commandHand[command.handIndex]!, target: command.target, destination: command.destination },
    maneuver,
  };
  const events = resolveTurns(board, [turn, { commander: commander("enemy"), ships: [], command: null, maneuver: null }], null);

  const preview: RoundPreview = { shots: [], losses: [], drones: [], outcomes: new Map() };
  /** Wohin Schiffe gewechselt sind; jedes Schiff bewegt sich höchstens einmal je Runde. */
  const moved = new Map<string, SlotRef>();
  for (const event of events) {
    if (event.kind === "maneuver") moved.set(key(event.ship), { side: event.side, ...event.to });
    if (event.kind === "effect" && event.effect.type === "move") moved.set(key(event.ship), { side: event.ship.side, ...event.effect.to });
    if (event.kind === "attack") preview.shots.push({ attacker: event.attacker, target: event.target });
    if (event.kind === "destroyed") preview.losses.push(event.ship);
    if (event.kind === "spawn") preview.drones.push(event.ship);
  }
  // Wer fällt, hinterlässt einen leeren Slot: Nach allen Bewegungen landet dort kein anderes Schiff mehr.
  for (const slot of [...match.board.ships("player"), ...match.board.ships("enemy")]) {
    const at = moved.get(key(slotRef(slot))) ?? slotRef(slot);
    const after = board.lane(at.side, at.lane).slots[at.slotIndex]!;
    preview.outcomes.set(slot, after.isOccupied ? { hp: after.hp, shield: after.shield } : null);
  }
  return preview;
}
