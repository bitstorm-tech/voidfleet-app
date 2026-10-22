// Formuliert die aufgedeckten Ereignisse einer Runde als Log-Zeilen.

import { commandById, shipById } from "../../../shared/cards.ts";
import type { LaneType, Side } from "../../../shared/board.ts";
import type { RoundEvent, SlotTarget } from "../../../shared/protocol.ts";

const WHO: Record<Side, string> = { player: "Du", enemy: "Gegner" };

function slotLabel(side: Side, target: SlotTarget): string {
  const lane: Record<LaneType, string> = { strike: "Strike", command: "Command" };
  return `${side === "player" ? "eigene" : "gegnerische"} ${lane[target.lane]} Slot ${target.slotIndex + 1}`;
}

function describe(event: RoundEvent): string {
  switch (event.kind) {
    case "deploy":
      return `Deploy: ${WHO[event.side]} — ${shipById(event.cardId).name} auf ${slotLabel(event.side, event.target)}`;
    case "pass":
      return `Deploy: ${WHO[event.side]} — kein Schiff`;
    case "command": {
      const target = event.target ? ` auf ${slotLabel(event.side, event.target)}` : "";
      return `Befehl: ${WHO[event.side]} — ${commandById(event.cardId).name}${target} (noch ohne Wirkung)`;
    }
  }
}

export function roundLogLines(round: number, events: readonly RoundEvent[]): string[] {
  return [`— Runde ${round} —`, ...events.map(describe)];
}
