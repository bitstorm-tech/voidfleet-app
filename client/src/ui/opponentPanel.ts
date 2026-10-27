// Was man vom Gegner weiß, oben rechts unter den Icon-Knöpfen: sein Admiral, sobald beide gewählt haben (Porträt,
// Name, Flaggschiff und Admiralsfähigkeit, ihre Texte im Tooltip), ob er seinen Zug schon beendet hat, wie viele
// Schiffs- und Befehlskarten er auf der Hand und noch im Deck hat und welche Befehle er noch spielen kann — jeder
// Befehl mit den Kopien, die er noch nicht aufgedeckt hat (`deckCopies` minus gespielte). Ob eine davon auf der
// Hand liegt, im Deck steckt oder beim vollen Handlimit verfallen ist, bleibt verdeckt. Die Befehle stehen nach Typ
// gruppiert in der Typfarbe, kompakt als umbrechende Namen; Angriffe oben, weil sie beim Planen am meisten zählen,
// dann die übrigen Typen in der Reihenfolge von `COMMAND_ORDER`. Eine Zahl steht nur bei mehr als einer offenen
// Kopie; der Effekttext steht im Tooltip.

import { ADMIRALS, type AdmiralId } from "../../../shared/admirals.ts";
import { COMMAND_ORDER, COMMANDS, type CommandId, type CommandType, deckCopies } from "../../../shared/cards.ts";
import type { OpponentView } from "../../../shared/protocol.ts";
import { admiralPortrait } from "../data/admirals.ts";
import { cardColor } from "../data/cardColors.ts";
import { toCssChannels } from "../data/palette.ts";
import { t } from "../i18n/index.ts";

const TYPES: readonly CommandType[] = ["attack", ...COMMAND_ORDER.filter((type) => type !== "attack")];
/** Die Kartenzahlen aus `OpponentView`, wie sie in der kleinen Tabelle stehen: Hand, dann Deck, je Schiffe und Befehle. */
const COUNTS = ["shipHandSize", "commandHandSize", "shipDeckSize", "commandDeckSize"] as const;

export class OpponentPanel {
  private readonly panel: HTMLElement;
  private readonly state: HTMLElement;
  private readonly admiral: HTMLElement;
  private shownAdmiral: AdmiralId | null = null;
  private readonly counts: HTMLElement[];
  private readonly commands = new Map<CommandId, { item: HTMLElement; count: HTMLElement }>();

  constructor(container: HTMLElement) {
    const text = t.opponent;
    container.insertAdjacentHTML(
      "beforeend",
      `<section class="opponent-panel" hidden>
        <header><span class="opponent-title"></span><span class="opponent-state"></span></header>
        <div class="opponent-admiral" hidden>
          <img class="portrait" alt="" />
          <div class="identity"><b></b><span></span></div>
          <span class="ability flagship"></span>
          <span class="ability power"></span>
        </div>
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
    this.admiral = this.panel.querySelector(".opponent-admiral")!;
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
    for (const type of TYPES) {
      const cards = COMMANDS.filter((card) => card.commandType === type);
      const group = document.createElement("li");
      group.style.setProperty("--card-rgb", toCssChannels(cardColor(cards[0]!)));
      const names = document.createElement("div");
      group.append(Object.assign(document.createElement("h4"), { textContent: t.rules.commandTypes[type] }), names);
      for (const card of cards) {
        const item = Object.assign(document.createElement("span"), { title: t.commands[card.id].effect, textContent: t.commands[card.id].name });
        const count = document.createElement("b");
        item.append(count);
        names.append(item);
        this.commands.set(card.id, { item, count });
      }
      list.append(group);
    }
  }

  /**
   * Ohne Gegner bleibt das Feld ausgeblendet. Seinen Admiral nennt der Server erst, wenn beide gewählt haben; solange
   * man selbst noch wählt (`chosen` false), ist also offen, ob er schon gewählt hat.
   */
  show(opponent: OpponentView | null, chosen: boolean): void {
    this.panel.hidden = opponent === null;
    if (opponent === null) return;
    const waiting = chosen ? t.opponent.choosing : t.opponent.hidden;
    this.state.textContent = opponent.admiral === null ? waiting : opponent.submitted ? t.opponent.ready : t.opponent.planning;
    this.state.classList.toggle("ready", opponent.submitted);
    this.showAdmiral(opponent.admiral);
    COUNTS.forEach((key, index) => {
      this.counts[index]!.textContent = String(opponent[key]);
    });
    for (const card of COMMANDS) {
      const left = deckCopies(card) - opponent.playedCommands.filter((id) => id === card.id).length;
      const { item, count } = this.commands.get(card.id)!;
      count.textContent = left > 1 ? ` ${left}×` : "";
      item.classList.toggle("spent", left === 0);
    }
  }

  private showAdmiral(admiral: AdmiralId | null): void {
    this.admiral.hidden = admiral === null;
    if (admiral === null || admiral === this.shownAdmiral) return;
    this.shownAdmiral = admiral;
    const { flagship, power } = ADMIRALS[admiral];
    this.admiral.style.setProperty("--admiral-rgb", `var(--${admiral})`);
    this.admiral.querySelector("img")!.src = admiralPortrait(admiral);
    const [name, epithet] = this.admiral.querySelectorAll(".identity > *");
    name!.textContent = t.admirals[admiral].name;
    epithet!.textContent = t.admirals[admiral].epithet;
    const flagshipLine = this.admiral.querySelector<HTMLElement>(".flagship")!;
    flagshipLine.textContent = `${t.ships[flagship].name} · ${t.admirals[admiral].ability}`;
    flagshipLine.title = t.ships[flagship].effect;
    const powerLine = this.admiral.querySelector<HTMLElement>(".power")!;
    powerLine.textContent = t.powers[power].name;
    powerLine.title = t.powers[power].effect;
  }
}
