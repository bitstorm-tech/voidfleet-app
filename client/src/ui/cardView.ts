// Aufbau einer Karte als DOM-Element, geteilt von der Hand und der Kartengalerie des
// Regel-Dialogs: Schiffskarten mit Illustration als Hintergrund und Werten unten,
// Befehlskarten als Datapad mit Zielangabe und Effekttext.

import type { Card, CommandCard, ShipCard } from "../../../shared/cards.ts";
import { cardArt } from "../data/cardArt.ts";
import { cardColor } from "../data/cardColors.ts";
import { darkened, toCss, toCssChannels } from "../data/palette.ts";
import { cardText, t, upper } from "../i18n/index.ts";

export function createCard(card: Card): HTMLElement {
  return card.kind === "ship" ? createShipCard(card) : createCommandCard(card);
}

export function createShipCard(card: ShipCard): HTMLElement {
  const color = cardColor(card);
  const element = document.createElement("div");
  element.className = "card ship-card";
  element.style.setProperty("--card-bg", toCss(darkened(color, 0.72)));
  element.style.setProperty("--card-accent", toCss(color));
  element.style.setProperty("--card-art", `url(${cardArt(card)})`);
  element.innerHTML = `
    <div class="name"></div>
    <div class="class"></div>
    <div class="stats">
      <span class="atk-label"></span><b class="atk"></b>
      <span class="hp-label"></span><b class="hp"></b>
    </div>`;
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
