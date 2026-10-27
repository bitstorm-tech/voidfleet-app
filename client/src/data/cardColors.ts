// Kartenfarben nach Schiffsklasse bzw. Befehlstyp.

import type { Card, CommandType, ShipClass } from "../../../shared/cards.ts";
import type { Rgb } from "./palette.ts";

const SHIP_COLORS: Record<ShipClass, Rgb> = {
  fighter: [0.9, 0.3, 0.2],
  cruiser: [0.3, 0.5, 0.9],
  battleship: [0.5, 0.5, 0.6],
  support: [0.2, 0.8, 0.5],
};

const COMMAND_COLORS: Record<CommandType, Rgb> = {
  attack: [0.9, 0.2, 0.2],
  buff: [0.2, 0.7, 0.3],
  debuff: [0.6, 0.2, 0.8],
  tactic: [0.2, 0.6, 0.9],
  reposition: [0.9, 0.7, 0.1],
  special: [0.9, 0.5, 0.1],
};

export function cardColor(card: Card): Rgb {
  return card.kind === "ship" ? SHIP_COLORS[card.shipClass] : COMMAND_COLORS[card.commandType];
}
