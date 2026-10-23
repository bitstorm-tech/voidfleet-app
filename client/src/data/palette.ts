// Die eine Quelle für alle Farben, die eine Bedeutung tragen (Spieler, Gegner,
// Schaden, Schild …). Babylon liest sie als Color3, das DOM als CSS-Variablen
// (`rgb(var(--player))`), damit Szene und UI dieselben Töne zeigen.

import { Color3 } from "@babylonjs/core/Maths/math.color";

/** Farbe als RGB-Tripel im Bereich 0..1, wie Godots Color. */
export type Rgb = readonly [number, number, number];

export const PALETTE = {
  /** Hintergrund hinter allem: Seite und Szene. */
  background: [0.016, 0.02, 0.04],
  /** Eigene Seite: Schüsse, Banner, Akzente im UI. */
  player: [0.47, 0.76, 1],
  enemy: [1, 0.5, 0.42],
  /** Auswahl und gültige Ziele: Kartenrahmen, leuchtende Pads. */
  select: [0.45, 0.92, 1],
  /** Wirkung eines Ereignisses: Fließtexte, Pulse, Balken. */
  damage: [1, 0.44, 0.35],
  heal: [0.47, 0.93, 0.55],
  shield: [0.47, 0.76, 1],
  buff: [1, 0.84, 0.4],
  debuff: [0.78, 0.59, 1],
  /** Hüllenbalken, je nach Füllstand. */
  hpEmpty: [0.93, 0.22, 0.18],
  hpHalf: [0.95, 0.74, 0.2],
  hpFull: [0.3, 0.86, 0.38],
  /** Spielausgang. */
  won: [1, 0.84, 0.4],
  lost: [1, 0.38, 0.31],
  draw: [0.69, 0.74, 0.81],
} as const satisfies Record<string, Rgb>;

export type PaletteKey = keyof typeof PALETTE;

export function color3(key: PaletteKey): Color3 {
  return Color3.FromArray(PALETTE[key]);
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

/** Nur die drei Kanäle (0..255), für `rgb(var(--x) / alpha)` im CSS. */
export function toCssChannels(color: Rgb): string {
  return color.map((c) => Math.round(c * 255)).join(" ");
}

export function toCss(color: Rgb, alpha = 1): string {
  return `rgb(${toCssChannels(color)} / ${alpha})`;
}

/** Stellt jede Palettenfarbe als `--<key>` (Kanäle) auf dem Dokument bereit. */
export function installPalette(root: HTMLElement = document.documentElement): void {
  for (const [key, rgb] of Object.entries(PALETTE)) {
    root.style.setProperty(`--${key}`, toCssChannels(rgb));
  }
}
