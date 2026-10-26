// Die Admiralswahl vor Runde 1: Solange der eigene Admiral fehlt, liegt über dem Brett ein Overlay mit fünf
// Karten — Porträt, Name und Beiname, das Flaggschiff mit Klasse, HP, ATK und Fähigkeit, die Admiralsfähigkeit,
// alles in der Akzentfarbe des Admirals. Ein Klick wählt (`chooseAdmiral`); bis der Server bestätigt, bleibt die
// Karte markiert und die übrigen sind gesperrt. Die Hand darunter bleibt frei, auch der Knopf für den Computergegner.

import { ADMIRAL_IDS, ADMIRALS, type AdmiralId } from "../../../shared/admirals.ts";
import { shipById } from "../../../shared/cards.ts";
import { admiralPortrait } from "../data/admirals.ts";
import { t, upper } from "../i18n/index.ts";
import { CROWN_ICON } from "./cardView.ts";

export class AdmiralSelect {
  private readonly overlay: HTMLElement;
  private readonly cards = new Map<AdmiralId, HTMLButtonElement>();

  constructor(container: HTMLElement, onChoose: (admiral: AdmiralId) => void) {
    container.insertAdjacentHTML(
      "beforeend",
      `<div class="admiral-overlay" hidden>
        <h2 class="admiral-title"></h2>
        <p class="admiral-hint"></p>
        <div class="admiral-cards"></div>
      </div>`,
    );
    this.overlay = container.querySelector(".admiral-overlay")!;
    this.overlay.querySelector(".admiral-title")!.textContent = t.admiralSelect.title;
    this.overlay.querySelector(".admiral-hint")!.textContent = t.admiralSelect.hint;
    const row = this.overlay.querySelector(".admiral-cards")!;
    for (const admiral of ADMIRAL_IDS) {
      const card = buildCard(admiral);
      card.addEventListener("click", () => onChoose(admiral));
      row.append(card);
      this.cards.set(admiral, card);
    }
  }

  /** Zeigt die Wahl, solange `open`; `pending` ist der gewählte Admiral, bis der Server ihn bestätigt. */
  show(open: boolean, pending: AdmiralId | null): void {
    this.overlay.hidden = !open;
    for (const [admiral, card] of this.cards) {
      card.classList.toggle("chosen", admiral === pending);
      card.disabled = pending !== null;
    }
  }
}

function buildCard(admiral: AdmiralId): HTMLButtonElement {
  const { flagship: flagshipId, power } = ADMIRALS[admiral];
  const flagship = shipById(flagshipId);
  const text = t.admirals[admiral];
  const card = Object.assign(document.createElement("button"), { type: "button", className: "admiral-card" });
  card.style.setProperty("--admiral-rgb", `var(--${admiral})`);
  card.innerHTML = `
    <div class="portrait"></div>
    <div class="identity"><b></b><span></span></div>
    <section class="flagship">
      <h4>${CROWN_ICON}<span></span></h4>
      <div class="ship"><b></b><span></span></div>
      <p><b></b> <span></span></p>
    </section>
    <section class="power">
      <h4><span></span></h4>
      <p><b></b> <span></span></p>
    </section>
    <span class="choose"></span>`;
  card.querySelector<HTMLElement>(".portrait")!.style.backgroundImage = `url(${admiralPortrait(admiral)})`;
  const [name, epithet] = card.querySelectorAll(".identity > *");
  name!.textContent = text.name;
  epithet!.textContent = text.epithet;
  const flagshipSection = card.querySelector(".flagship")!;
  flagshipSection.querySelector("h4 span")!.textContent = upper(t.admiralSelect.flagship);
  const [shipName, shipStats] = flagshipSection.querySelectorAll(".ship > *");
  shipName!.textContent = t.ships[flagship.id].name;
  shipStats!.textContent = `${t.shipClasses[flagship.shipClass]} · ${flagship.hp} ${t.stats.hp} · ${flagship.atk} ${t.stats.atk}`;
  const [abilityName, abilityText] = flagshipSection.querySelectorAll("p > *");
  abilityName!.textContent = `${text.ability}:`;
  abilityText!.textContent = t.ships[flagship.id].effect;
  const powerSection = card.querySelector(".power")!;
  powerSection.querySelector("h4 span")!.textContent = upper(t.admiralSelect.power);
  const [powerName, powerText] = powerSection.querySelectorAll("p > *");
  powerName!.textContent = `${t.powers[power].name}:`;
  powerText!.textContent = t.powers[power].effect;
  card.querySelector(".choose")!.textContent = t.admiralSelect.choose;
  return card;
}
