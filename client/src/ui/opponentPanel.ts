// Was man vom Gegner weiß, oben rechts unter den Icon-Knöpfen: sein Admiral, sobald beide gewählt haben (Porträt,
// Name, Flaggschiff und Admiralsfähigkeit, ihre Texte im Tooltip), ob er seinen Zug schon beendet hat und wie viele
// Schiffs- und Befehlskarten er auf der Hand und noch im Deck hat. Welche Befehle er schon gespielt hat und welche
// ihm noch bleiben, zeigt das Feld bewusst nicht — mitzuzählen ist Sache des Spielers.

import { ADMIRALS, type AdmiralId } from "../../../shared/admirals.ts";
import type { OpponentView } from "../../../shared/protocol.ts";
import { admiralPortrait } from "../data/admirals.ts";
import { t } from "../i18n/index.ts";

/** Die Kartenzahlen aus `OpponentView`, wie sie in der kleinen Tabelle stehen: Hand, dann Deck, je Schiffe und Befehle. */
const COUNTS = ["shipHandSize", "commandHandSize", "shipDeckSize", "commandDeckSize"] as const;

export class OpponentPanel {
  private readonly panel: HTMLElement;
  private readonly state: HTMLElement;
  private readonly admiral: HTMLElement;
  private shownAdmiral: AdmiralId | null = null;
  private readonly counts: HTMLElement[];

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
