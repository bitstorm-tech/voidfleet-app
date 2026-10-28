// Der Nachschub nach jeder Runde: Solange er offen ist, liegt über dem Brett ein Overlay mit bis zu drei Schiffen und
// drei Befehlen; ein Klick wählt je eines, ein zweiter nimmt die Wahl zurück. Hat ein eigener Scrap Raider Schrott
// geborgen, ist einer der Befehle die Schrottverwertung; stehen mehrere Scrap Raider, wählen Knöpfe darunter, welcher
// die +1 ATK bekommt. „Übernehmen“ schickt die Wahl (`draft`); bis der Server bestätigt, bleibt das Overlay gesperrt.
// Die Hand darunter bleibt sichtbar.

import { type Slot, slotTarget } from "../../../shared/board.ts";
import { commandById, shipById } from "../../../shared/cards.ts";
import type { DraftOffer, DraftPick } from "../../../shared/protocol.ts";
import { cardArt } from "../data/cardArt.ts";
import { cardColor } from "../data/cardColors.ts";
import { darkened, toCssChannels } from "../data/palette.ts";
import { t } from "../i18n/index.ts";
import { createCommandCard, createShipCard } from "./cardView.ts";

/** Die Wahl bei den Befehlen: ein Index in `DraftOffer.commands` oder die Schrottverwertung. */
type CommandChoice = number | "salvage";

export class DraftSelect {
  private readonly overlay: HTMLElement;
  private readonly ships: HTMLElement;
  private readonly commands: HTMLElement;
  private readonly confirm: HTMLButtonElement;
  /** Das gezeigte Angebot; ein neues setzt die Wahl zurück. */
  private shown: string | null = null;
  private offer: DraftOffer | null = null;
  private raiders: Slot[] = [];
  private ship: number | null = null;
  private command: CommandChoice | null = null;
  private raider: Slot | null = null;
  private pending = false;

  constructor(container: HTMLElement, onConfirm: (pick: DraftPick) => void) {
    container.insertAdjacentHTML(
      "beforeend",
      `<div class="draft-overlay" hidden>
        <h2 class="admiral-title"></h2>
        <p class="admiral-hint"></p>
        <div class="draft-rows">
          <section class="draft-row"><h3></h3><div class="draft-cards ships"></div></section>
          <section class="draft-row"><h3></h3><div class="draft-cards commands"></div></section>
        </div>
        <button type="button" class="draft-confirm"></button>
      </div>`,
    );
    this.overlay = container.querySelector(".draft-overlay")!;
    this.overlay.querySelector(".admiral-title")!.textContent = t.draft.title;
    this.overlay.querySelector(".admiral-hint")!.textContent = t.draft.hint;
    const [shipsHeading, commandsHeading] = this.overlay.querySelectorAll(".draft-row h3");
    shipsHeading!.textContent = t.draft.ships;
    commandsHeading!.textContent = t.draft.commands;
    this.ships = this.overlay.querySelector(".draft-cards.ships")!;
    this.commands = this.overlay.querySelector(".draft-cards.commands")!;
    this.confirm = this.overlay.querySelector(".draft-confirm")!;
    this.confirm.textContent = t.draft.confirm;
    this.confirm.addEventListener("click", () => {
      if (!this.isComplete) return;
      const { ship, command, raider } = this;
      onConfirm({ ship, command: command === "salvage" ? null : command, salvage: command === "salvage" ? slotTarget(raider!) : null });
    });
  }

  /**
   * Zeigt den Nachschub, solange `offer` gesetzt ist; `raiders` sind die eigenen Scrap Raider für die
   * Schrottverwertung, `pending` sperrt bis zur Bestätigung durch den Server.
   */
  show(offer: DraftOffer | null, raiders: Slot[], pending: boolean): void {
    this.overlay.hidden = offer === null;
    const key = offer && JSON.stringify(offer);
    const changed =
      key !== this.shown || pending !== this.pending || raiders.length !== this.raiders.length || raiders.some((raider, i) => raider !== this.raiders[i]);
    if (key !== this.shown) {
      this.shown = key;
      this.offer = offer;
      this.ship = null;
      this.command = null;
      this.raider = raiders.length === 1 ? raiders[0]! : null;
    }
    this.pending = pending;
    this.raiders = raiders;
    if (this.raider && !raiders.includes(this.raider)) this.raider = null;
    if (changed) this.render();
  }

  private get isComplete(): boolean {
    const offer = this.offer;
    if (offer === null || this.pending) return false;
    const shipDone = offer.ships.length === 0 || this.ship !== null;
    const commandDone = (offer.commands.length === 0 && !offer.salvage) || (this.command !== null && (this.command !== "salvage" || this.raider !== null));
    return shipDone && commandDone;
  }

  private render(): void {
    const offer = this.offer;
    if (offer === null) return;
    this.ships.replaceChildren(
      ...option(
        offer.ships.map((id, index) => this.choice(createShipCard(shipById(id)), this.ship === index, () => (this.ship = this.ship === index ? null : index))),
      ),
    );
    const commands = offer.commands.map((id, index) =>
      this.choice(createCommandCard(commandById(id)), this.command === index, () => (this.command = this.command === index ? null : index)),
    );
    if (offer.salvage) {
      const card = this.choice(createSalvageCard(), this.command === "salvage", () => (this.command = this.command === "salvage" ? null : "salvage"));
      commands.push(this.command === "salvage" && this.raiders.length > 1 ? this.withRaiders(card) : card);
    }
    this.commands.replaceChildren(...option(commands));
    this.confirm.disabled = !this.isComplete;
  }

  /** Eine Karte des Angebots; ein Klick wählt sie bzw. nimmt sie zurück. */
  private choice(card: HTMLElement, selected: boolean, toggle: () => void): HTMLElement {
    card.classList.toggle("selected", selected);
    card.classList.toggle("locked", this.pending);
    card.addEventListener("click", () => {
      if (this.pending) return;
      toggle();
      this.render();
    });
    return card;
  }

  /** Die Schrottverwertung mit einem Knopf je eigenem Scrap Raider darunter. */
  private withRaiders(card: HTMLElement): HTMLElement {
    const column = Object.assign(document.createElement("div"), { className: "draft-salvage" });
    const buttons = this.raiders.map((raider) => {
      const button = Object.assign(document.createElement("button"), {
        type: "button",
        className: raider === this.raider ? "selected" : "",
        disabled: this.pending,
        textContent: t.draft.raider(t.lanes[raider.lane.type], raider.index + 1, raider.attack),
      });
      button.addEventListener("click", () => {
        this.raider = raider;
        this.render();
      });
      return button;
    });
    column.append(card, ...buttons);
    return column;
  }
}

/** Eine leere Reihe sagt, warum es nichts zu wählen gibt. */
function option(cards: HTMLElement[]): HTMLElement[] {
  return cards.length > 0 ? cards : [Object.assign(document.createElement("p"), { className: "draft-none", textContent: t.draft.none })];
}

/** Die Schrottverwertung im Stil einer Befehlskarte, mit Bild und Farbe des Scrap Raiders. */
function createSalvageCard(): HTMLElement {
  const raider = shipById("scrap_raider");
  const element = document.createElement("div");
  element.className = "card command-card salvage-card";
  element.style.setProperty("--card-rgb", toCssChannels(darkened(cardColor(raider), 0.25)));
  element.style.setProperty("--card-art", `url(${cardArt(raider)})`);
  element.innerHTML = `
    <div class="screen">
      <div class="name"></div>
      <div class="target"></div>
      <div class="effect"></div>
    </div>
    <div class="keys"><span></span><span></span><span></span><span></span></div>`;
  element.querySelector(".name")!.textContent = t.draft.salvage.name;
  element.querySelector(".target")!.textContent = t.draft.salvage.target;
  element.querySelector(".effect")!.textContent = t.draft.salvage.effect;
  return element;
}
