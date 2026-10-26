// Aufbau einer Karte als DOM-Element, geteilt von der Hand und der Kartengalerie des
// Regel-Dialogs: Schiffskarten mit Illustration als Hintergrund und Werten unten — Flaggschiffe mit
// goldenem Rahmen, Krone und der Farbe ihres Admirals —, Befehlskarten als Datapad mit Zielangabe und Effekttext.

import type { Card, CommandCard, ShipCard } from "../../../shared/cards.ts";
import { flagshipAdmiral } from "../data/admirals.ts";
import { cardArt } from "../data/cardArt.ts";
import { cardColor } from "../data/cardColors.ts";
import { darkened, toCss, toCssChannels } from "../data/palette.ts";
import { cardText, t, upper } from "../i18n/index.ts";

export function createCard(card: Card): HTMLElement {
  return card.kind === "ship" ? createShipCard(card) : createCommandCard(card);
}

/** Krone der Flaggschiffe, auch auf ihrer Karte und in der Admiralswahl. */
export const CROWN_ICON = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 18 2 7l5.5 4L12 4l4.5 7L22 7l-1 11Z" /><rect x="3" y="19.5" width="18" height="2.5" rx="0.6" /></svg>`;

export function createShipCard(card: ShipCard): HTMLElement {
  const color = cardColor(card);
  const element = document.createElement("div");
  element.className = "card ship-card";
  const admiral = flagshipAdmiral(card.id);
  if (admiral) {
    element.classList.add("flagship-card");
    element.style.setProperty("--admiral-rgb", `var(--${admiral})`);
    element.insertAdjacentHTML("beforeend", `<span class="crown">${CROWN_ICON}</span>`);
  }
  element.style.setProperty("--card-bg", toCss(darkened(color, 0.72)));
  element.style.setProperty("--card-accent", toCss(color));
  element.style.setProperty("--card-art", `url(${cardArt(card)})`);
  element.insertAdjacentHTML(
    "beforeend",
    `<div class="name"></div>
    <div class="class"></div>
    <div class="stats">
      <span class="atk-label"></span><b class="atk"></b>
      <span class="hp-label"></span><b class="hp"></b>
    </div>`,
  );
  element.querySelector(".name")!.textContent = cardText(card).name;
  element.querySelector(".class")!.textContent = upper(t.shipClasses[card.shipClass]);
  element.querySelector(".hp-label")!.textContent = upper(t.stats.hp);
  element.querySelector(".atk-label")!.textContent = upper(t.stats.atk);
  element.querySelector(".hp")!.textContent = String(card.hp);
  element.querySelector(".atk")!.textContent = String(card.atk);
  if (card.shield > 0) {
    const label = document.createElement("span");
    label.textContent = upper(t.stats.shield);
    const value = document.createElement("b");
    value.textContent = String(card.shield);
    element.querySelector(".stats")!.append(label, value);
  }
  return element;
}

export function createCommandCard(card: CommandCard): HTMLElement {
  const element = document.createElement("div");
  element.className = "card command-card";
  element.style.setProperty("--card-rgb", toCssChannels(darkened(cardColor(card), 0.25)));
  element.style.setProperty("--card-art", `url(${cardArt(card)})`);
  element.innerHTML = `
    <div class="screen">
      <div class="name"></div>
      <div class="target"></div>
      <div class="effect"></div>
    </div>
    <div class="keys"><span></span><span></span><span></span><span></span></div>`;
  const text = cardText(card);
  element.querySelector(".name")!.textContent = text.name;
  element.querySelector(".target")!.textContent = t.targets[card.targetMode];
  element.querySelector(".effect")!.textContent = text.effect;
  return element;
}
