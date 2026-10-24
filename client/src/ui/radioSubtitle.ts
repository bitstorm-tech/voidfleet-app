// Untertitel des Bordfunks über dem Aktionsknopf: Absender und Text des laufenden Funkspruchs in der Sprache des
// Spielers. Er erscheint mit dem Spruch und blendet kurz nach dessen Ende aus.

import { onTransmission, type Transmission } from "../audio/radio.ts";
import { t } from "../i18n/index.ts";

/** So lange bleibt der Untertitel nach dem Ende des Spruchs stehen (Millisekunden). */
const LINGER = 900;

export class RadioSubtitle {
  private readonly element: HTMLElement;
  private readonly text: HTMLElement;
  private hideTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(container: HTMLElement) {
    container.insertAdjacentHTML(
      "beforeend",
      `<div class="radio-subtitle"><span class="radio-speaker"><i></i><i></i><i></i></span><span class="radio-text"></span></div>`,
    );
    this.element = container.querySelector(".radio-subtitle")!;
    this.text = this.element.querySelector(".radio-text")!;
    this.element.querySelector(".radio-speaker")!.append(t.radio.speaker);
    onTransmission((transmission) => this.show(transmission));
  }

  private show(transmission: Transmission | null): void {
    clearTimeout(this.hideTimer);
    this.element.classList.toggle("visible", transmission !== null);
    if (transmission === null) return;
    this.text.textContent = t.radio.lines[transmission.cue][transmission.variant]!;
    this.hideTimer = setTimeout(() => this.element.classList.remove("visible"), transmission.duration * 1000 + LINGER);
  }
}
