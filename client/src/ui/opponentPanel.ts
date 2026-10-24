// Was man vom Gegner weiß, oben rechts unter den Icon-Knöpfen: ob er seinen Zug schon beendet hat, wie viele
// Schiffs- und Befehlskarten er auf der Hand und noch im Deck hat und welche Befehle er noch spielen kann — jeder
// Befehl mit den Kopien, die er noch nicht aufgedeckt hat (`deckCopies` minus gespielte). Ob eine davon auf der
// Hand liegt, im Deck steckt oder beim vollen Handlimit verfallen ist, bleibt verdeckt. Angriffe stehen oben,
// weil sie beim Planen am meisten zählen; der Effekttext steht im Tooltip.

import { COMMAND_ORDER, COMMANDS, deckCopies, type CommandId } from "../../../shared/cards.ts";
import type { OpponentView } from "../../../shared/protocol.ts";
import { cardColor } from "../data/cardColors.ts";
import { toCssChannels } from "../data/palette.ts";
import { t } from "../i18n/index.ts";

const LISTED = [...COMMAND_ORDER].reverse().flatMap((type) => COMMANDS.filter((card) => card.commandType === type));
/** Die Kartenzahlen aus `OpponentView`, wie sie in der kleinen Tabelle stehen: Hand, dann Deck, je Schiffe und Befehle. */
const COUNTS = ["shipHandSize", "commandHandSize", "shipDeckSize", "commandDeckSize"] as const;

export class OpponentPanel {
  private readonly panel: HTMLElement;
  private readonly state: HTMLElement;
  private readonly counts: HTMLElement[];
  private readonly commands = new Map<CommandId, { item: HTMLElement; count: HTMLElement }>();

  constructor(container: HTMLElement) {
    const text = t.opponent;
    container.insertAdjacentHTML(
      "beforeend",
      `<section class="opponent-panel" hidden>
        <header><span class="opponent-title"></span><span class="opponent-state"></span></header>
        <div class="opponent-cards">
          <span></span><span class="column"></span><span class="column"></span>
          <span class="row"></span><b></b><b></b>
          <span class="row"></span><b></b><b></b>
        </div>
        <h3></h3>
        <ul class="opponent-commands"></ul>
      </section>`,
    );
    this.panel = container.querySelector(".opponent-panel")!;
    this.state = this.panel.querySelector(".opponent-state")!;
    this.panel.querySelector(".opponent-title")!.textContent = text.title;
    const [ships, commands] = this.panel.querySelectorAll(".opponent-cards .column");
    ships!.textContent = text.ships;
    commands!.textContent = text.commands;
    const [hand, deck] = this.panel.querySelectorAll(".opponent-cards .row");
    hand!.textContent = text.hand;
    deck!.textContent = text.deck;
    this.counts = [...this.panel.querySelectorAll<HTMLElement>(".opponent-cards b")];
    this.panel.querySelector("h3")!.textContent = text.unplayed;

    const list = this.panel.querySelector(".opponent-commands")!;
    for (const card of LISTED) {
      const item = document.createElement("li");
      item.style.setProperty("--card-rgb", toCssChannels(cardColor(card)));
      item.title = t.commands[card.id].effect;
      const count = document.createElement("b");
      item.append(Object.assign(document.createElement("span"), { textContent: t.commands[card.id].name }), count);
      list.append(item);
      this.commands.set(card.id, { item, count });
    }
  }

  /** Ohne Gegner bleibt das Feld ausgeblendet. */
  show(opponent: OpponentView | null): void {
    this.panel.hidden = opponent === null;
    if (opponent === null) return;
    this.state.textContent = opponent.submitted ? t.opponent.ready : t.opponent.planning;
    this.state.classList.toggle("ready", opponent.submitted);
    COUNTS.forEach((key, index) => (this.counts[index]!.textContent = String(opponent[key])));
    for (const card of LISTED) {
      const left = deckCopies(card) - opponent.playedCommands.filter((id) => id === card.id).length;
      const { item, count } = this.commands.get(card.id)!;
      count.textContent = `${left}×`;
      item.classList.toggle("spent", left === 0);
    }
  }
}
