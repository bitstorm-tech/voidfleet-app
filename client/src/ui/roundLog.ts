// Formuliert die aufgedeckten Ereignisse einer Runde als Log-Zeilen.

import { commandById, shipById } from "../../../shared/cards.ts";
import type { Side } from "../../../shared/board.ts";
import type { RoundEvent, SlotTarget } from "../../../shared/protocol.ts";
import { t } from "../i18n/index.ts";

function slotLabel(side: Side, target: SlotTarget): string {
  return t.log.slot(side, t.lanes[target.lane], target.slotIndex + 1);
}

function describe(event: RoundEvent): string {
  const who = t.log.who[event.side];
  switch (event.kind) {
    case "deploy":
      return t.log.deploy(who, t.ships[event.cardId].name, slotLabel(event.side, event.target));
    case "pass":
      return t.log.pass(who);
    case "command": {
      const name = t.commands[event.cardId].name;
      return event.target ? t.log.commandOn(who, name, slotLabel(event.side, event.target)) : t.log.command(who, name);
    }
  }
}

export function roundLogLines(round: number, events: readonly RoundEvent[]): string[] {
  return [t.log.roundHeader(round), ...events.map(describe)];
}
