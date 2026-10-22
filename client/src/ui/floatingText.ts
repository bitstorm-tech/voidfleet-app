// Kurze Texte, die über einem Schiff aufsteigen und verblassen (Schaden, Heilung, Buffs).

export type FloatTone = "damage" | "heal" | "shield" | "buff" | "debuff";

export class FloatingTexts {
  private readonly layer: HTMLElement;

  constructor(container: HTMLElement) {
    this.layer = document.createElement("div");
    this.layer.className = "float-layer";
    container.append(this.layer);
  }

  /** Position in CSS-Pixeln; das Element entfernt sich nach seiner Animation selbst. */
  show(position: { x: number; y: number }, text: string, tone: FloatTone): void {
    const element = document.createElement("div");
    element.className = `float-text ${tone}`;
    element.textContent = text;
    element.style.left = `${position.x}px`;
    element.style.top = `${position.y}px`;
    element.addEventListener("animationend", () => element.remove());
    this.layer.append(element);
  }
}
