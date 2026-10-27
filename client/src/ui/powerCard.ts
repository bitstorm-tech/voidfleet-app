// Die Admiralsfähigkeit links neben den Befehlen: eine Karte mit dem Porträt des Admirals, dem Namen, der Zielangabe
// und dem Kurztext in seiner Akzentfarbe. Ein Klick startet die Zielwahl, ein weiterer bricht sie ab bzw. nimmt die
// eingeplante Fähigkeit zurück. Bei Admiral Kerr steht darüber der Knopf der Zielerfassung, in der Runde, in der die
// Railgun feuert, stattdessen ihr Ziel — mit einer Warnung, wenn die Pendulum geplant bewegt wird.

import { ABILITY_VALUES, ADMIRALS, type AdmiralId, POWER_TARGETS } from "../../../shared/admirals.ts";
import { admiralPortrait } from "../data/admirals.ts";
import { t, upper } from "../i18n/index.ts";

/** Stand der Fähigkeit bzw. der Zielerfassung: möglich, Ziel wird gewählt, eingeplant oder gerade nicht möglich. */
export type PowerState = "open" | "selecting" | "planned" | "blocked";

export interface PowerCardView {
  admiral: AdmiralId;
  power: PowerState;
  /**
   * Admiral Kerr: der Knopf der Zielerfassung oder die Anzeige der Railgun in ihrer Feuerrunde, jeweils mit einer
   * Warnung, wenn die Pendulum sich bewegt; null ohne Pendulum auf dem Brett.
   */
  lock: { state: PowerState; label: string; warning: string | null } | { railgun: string; warning: string | null } | null;
}

const CROSSHAIR = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">
  <circle cx="12" cy="12" r="7" /><path d="M12 1v6M12 17v6M1 12h6M17 12h6" /></svg>`;

export class PowerCard {
  readonly element: HTMLElement;
  private readonly card: HTMLElement;
  private readonly lockButton: HTMLButtonElement;
  private readonly railgun: HTMLElement;
  private admiral: AdmiralId | null = null;

  constructor(onPowerClick: () => void, onLockClick: () => void) {
    this.element = Object.assign(document.createElement("div"), { className: "admiral-area" });
    this.element.innerHTML = `
      <button type="button" class="lock-button" hidden>${CROSSHAIR}<span></span><em></em></button>
      <div class="railgun-status" hidden>${CROSSHAIR}<span></span><em></em></div>`;
    this.lockButton = this.element.querySelector(".lock-button")!;
    this.railgun = this.element.querySelector(".railgun-status")!;
    this.card = Object.assign(document.createElement("div"), { className: "card power-card" });
    this.element.append(this.card);
    this.lockButton.title = t.hud.markHint;
    this.railgun.title = t.hud.railgunHint(ABILITY_VALUES.railgun);
    this.card.addEventListener("click", onPowerClick);
    this.lockButton.addEventListener("click", onLockClick);
    this.element.hidden = true;
  }

  /** null blendet alles aus, solange kein Admiral gewählt ist. */
  show(view: PowerCardView | null): void {
    this.element.hidden = view === null;
    if (view === null) return;
    if (view.admiral !== this.admiral) this.build(view.admiral);
    setState(this.card, view.power);
    const { lock } = view;
    this.lockButton.hidden = lock === null || "railgun" in lock;
    this.railgun.hidden = lock === null || !("railgun" in lock);
    if (lock === null) return;
    const target = "railgun" in lock ? this.railgun : this.lockButton;
    target.querySelector("span")!.textContent = "railgun" in lock ? lock.railgun : lock.label;
    target.querySelector("em")!.textContent = lock.warning ?? "";
    target.classList.toggle("warning", lock.warning !== null);
    if (!("railgun" in lock)) setState(this.lockButton, lock.state);
  }

  private build(admiral: AdmiralId): void {
    this.admiral = admiral;
    this.element.style.setProperty("--admiral-rgb", `var(--${admiral})`);
    fillPowerCard(this.card, admiral);
  }
}

/** Die Karte der Admiralsfähigkeit als DOM, für die Hand und den Regel-Dialog. */
export function createPowerCard(admiral: AdmiralId): HTMLElement {
  const card = Object.assign(document.createElement("div"), { className: "card power-card" });
  card.style.setProperty("--admiral-rgb", `var(--${admiral})`);
  fillPowerCard(card, admiral);
  return card;
}

function fillPowerCard(card: HTMLElement, admiral: AdmiralId): void {
  const power = ADMIRALS[admiral].power;
  card.style.setProperty("--portrait", `url(${admiralPortrait(admiral)})`);
  card.innerHTML = `<div class="power-label"></div><div class="name"></div><div class="target"></div><div class="effect"></div><div class="hint"></div>`;
  card.querySelector(".power-label")!.textContent = upper(t.hud.power);
  card.querySelector(".name")!.textContent = t.powers[power].name;
  card.querySelector(".target")!.textContent = t.powerTargets[POWER_TARGETS[power]];
  card.querySelector(".effect")!.textContent = t.powers[power].effect;
  card.querySelector(".hint")!.textContent = t.hud.powerHint;
}

function setState(element: HTMLElement, state: PowerState): void {
  element.classList.toggle("selecting", state === "selecting");
  element.classList.toggle("selected", state === "planned");
  element.classList.toggle("blocked", state === "blocked");
}
