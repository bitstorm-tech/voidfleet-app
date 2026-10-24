// Ladebildschirm beim Start: deckt alles ab, bis die Assets geladen sind, und blendet dann aus.

import { t } from "../i18n/index.ts";

export class LoadingScreen {
  private readonly overlay: HTMLElement;
  private readonly fill: HTMLElement;
  private readonly label: HTMLElement;

  constructor(container: HTMLElement) {
    container.insertAdjacentHTML(
      "beforeend",
      `<div class="loading-overlay">
        <strong class="loading-title">Voidfleet</strong>
        <div class="loading-bar"><div class="loading-fill"></div></div>
        <span class="loading-label"></span>
      </div>`,
    );
    this.overlay = container.querySelector(".loading-overlay")!;
    this.fill = container.querySelector(".loading-fill")!;
    this.label = container.querySelector(".loading-label")!;
  }

  setProgress(fraction: number): void {
    this.fill.style.width = `${fraction * 100}%`;
    this.label.textContent = t.loading.assets(Math.round(fraction * 100));
  }

  hide(): void {
    this.overlay.classList.add("done");
    this.overlay.addEventListener("transitionend", () => this.overlay.remove(), { once: true });
  }

  fail(): void {
    this.overlay.classList.add("failed");
    this.label.textContent = t.loading.failed;
  }
}
