// Kartenfarben nach Schiffsklasse bzw. Befehlstyp, plus Farb-Helfer wie in Godot.

import type { Card, CommandType, ShipClass } from "../../../shared/cards.ts";

/** Farbe als RGB-Tripel im Bereich 0..1, wie Godots Color. */
export type Rgb = readonly [number, number, number];

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

/** Entspricht Godots Color.darkened(). */
export function darkened(color: Rgb, amount: number): Rgb {
  return [color[0] * (1 - amount), color[1] * (1 - amount), color[2] * (1 - amount)];
}

/** Entspricht Godots Color.lightened(). */
export function lightened(color: Rgb, amount: number): Rgb {
  return [
    color[0] + (1 - color[0]) * amount,
    color[1] + (1 - color[1]) * amount,
    color[2] + (1 - color[2]) * amount,
  ];
}

export function toCss(color: Rgb, alpha = 1): string {
  const [r, g, b] = color.map((c) => Math.round(c * 255));
  return `rgb(${r} ${g} ${b} / ${alpha})`;
}
