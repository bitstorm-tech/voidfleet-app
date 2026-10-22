// Verbindet Spielzustand, 3D-Szene und DOM-UI zur Zugplanung:
// Der Spieler stellt seinen Zug zusammen (1 Schiff + 1 Befehl), das gewählte
// Schiff steht als Geist auf dem Slot, der gewählte Befehl bleibt markiert.
// Alles ist bis zum Submit änderbar. Der Spielzustand steckt in `Match`,
// die Szene spiegelt ihn nur.

import { PointerEventTypes, type PointerInfo } from "@babylonjs/core/Events/pointerEvents";
import { needsTarget } from "./data/cards.ts";
import { MAX_SHIPS_PER_SIDE, type Lane } from "./game/board.ts";
import { Match } from "./game/match.ts";
import { MatchScene, pickedPad } from "./scene/matchScene.ts";
import { ShipView } from "./scene/ship.ts";
import type { SlotPad } from "./scene/slotPad.ts";
import { HandView } from "./ui/hand.ts";
import { Hud } from "./ui/hud.ts";

export class MatchController {
  private readonly match = new Match();
  private readonly view: MatchScene;
  private readonly hud: Hud;
  private readonly hand: HandView;

  private selectedShipIndex: number | null = null;
  private selectedCommandIndex: number | null = null;
  private hoveredPad: SlotPad | null = null;
  private ghostPad: SlotPad | null = null;
  private validTargetCount = 0;

  constructor(canvas: HTMLCanvasElement, ui: HTMLElement) {
    this.view = new MatchScene(canvas, this.match.board);
    this.hud = new Hud(ui);
    this.hand = new HandView(ui, this.hud.submitButton, {
      onShipCardClick: (index) => this.onShipCardClick(index),
      onCommandCardClick: (index) => this.onCommandCardClick(index),
    });

    this.hud.submitButton.addEventListener("click", () => this.submit());
    this.view.scene.onPointerObservable.add((info) => this.onScenePointer(info));

    this.refreshHand();
    this.refreshSelectionVisuals();
  }

  // --- Hand ---

  private onShipCardClick(index: number): void {
    if (this.match.plan.ship?.handIndex === index) {
      // Erneutes Antippen der geplanten Karte nimmt den Zug zurück.
      this.clearShipPlan();
      this.selectShip(null);
    } else if (this.selectedShipIndex === index) {
      this.selectShip(null);
    } else {
      this.selectShip(index);
    }
  }

  /** Befehle ohne Zielwahl sind mit einem Klick eingeplant, sonst folgt der Klick auf ein eigenes Schiff. */
  private onCommandCardClick(index: number): void {
    const card = this.match.commandHand[index]!;
    if (this.match.plan.command?.handIndex === index) {
      this.match.plan.command = null;
      this.selectCommand(null);
    } else if (this.selectedCommandIndex === index) {
      this.selectCommand(null);
    } else if (needsTarget(card)) {
      this.selectCommand(index);
    } else {
      this.match.plan.command = { handIndex: index, target: null };
      this.selectCommand(null);
    }
  }

  /** Schiffs- und Befehlskarte sind nie gleichzeitig gewählt. */
  private selectShip(index: number | null): void {
    this.selectedShipIndex = index;
    if (index !== null) this.selectedCommandIndex = null;
    this.refreshSelectionVisuals();
  }

  private selectCommand(index: number | null): void {
    this.selectedCommandIndex = index;
    if (index !== null) this.selectedShipIndex = null;
    this.refreshSelectionVisuals();
  }

  // --- Brett ---

  /** Das Brett reagiert nur, solange eine Karte gewählt ist; `pickInfo` wird erst beim Zugriff berechnet. */
  private onScenePointer(info: PointerInfo): void {
    const hasSelection = this.selectedShipIndex !== null || this.selectedCommandIndex !== null;
    if (info.type === PointerEventTypes.POINTERMOVE) {
      this.setHoveredPad(hasSelection ? pickedPad(info) : null);
    } else if (info.type === PointerEventTypes.POINTERDOWN && info.event.button === 0 && hasSelection) {
      this.onBoardClick(pickedPad(info));
    }
  }

  private onBoardClick(pad: SlotPad | null): void {
    if (pad === null) {
      this.selectShip(null);
      this.selectCommand(null);
      return;
    }
    if (!this.isValidTarget(pad)) return;

    if (this.selectedShipIndex !== null) {
      this.stageShipOn(pad);
    } else {
      this.stageCommandTargetOn(pad);
    }
  }

  /**
   * Einzige Gültigkeitsregel für Highlight und Klick: gewähltes Schiff -> freie
   * eigene Slots, gewählter Befehl -> eigene besetzte Slots. Ohne Auswahl leuchtet
   * nur das bereits gewählte Befehlsziel weiter. Die Gegnerseite ist nie Ziel.
   */
  private isValidTarget(pad: SlotPad): boolean {
    const lane: Lane = pad.slot.lane;
    if (lane.side === "enemy") return false;
    if (this.selectedShipIndex !== null) return this.match.board.canPlace(lane, pad.slot.index);
    if (this.selectedCommandIndex !== null) return pad.slot.isOccupied;
    const target = this.match.plan.command?.target;
    return target !== undefined && target !== null && target.lane === lane && target.slotIndex === pad.slot.index;
  }

  /** Setzt das Geist-Schiff auf den Slot. Das Brett bleibt bis zum Submit unberührt. */
  private stageShipOn(pad: SlotPad): void {
    const handIndex = this.selectedShipIndex!;
    this.clearGhost();
    this.match.plan.ship = { handIndex, target: { lane: pad.slot.lane, slotIndex: pad.slot.index } };
    this.ghostPad = pad;
    pad.attachShip(new ShipView(this.view.scene, this.match.shipHand[handIndex]!, true));
    this.selectShip(null);
  }

  private stageCommandTargetOn(pad: SlotPad): void {
    this.match.plan.command = {
      handIndex: this.selectedCommandIndex!,
      target: { lane: pad.slot.lane, slotIndex: pad.slot.index },
    };
    this.selectCommand(null);
  }

  private clearShipPlan(): void {
    this.match.plan.ship = null;
    this.clearGhost();
  }

  private clearGhost(): void {
    this.ghostPad?.clearShip();
    this.ghostPad = null;
  }

  // --- Runde ---

  private submit(): void {
    this.selectShip(null);
    this.selectCommand(null);
    this.clearGhost();
    this.hud.appendLog(this.match.submit());
    this.syncBoardShips();
    this.refreshHand();
    this.refreshSelectionVisuals();
  }

  /** Pads und Brett abgleichen: besetzte Slots ohne Schiff bekommen eins. */
  private syncBoardShips(): void {
    for (const pad of this.view.pads) {
      const slot = pad.slot;
      if (slot.isOccupied && pad.ship === null) {
        pad.attachShip(new ShipView(this.view.scene, slot.card!, false));
      } else if (!slot.isOccupied && pad.ship !== null) {
        pad.clearShip();
      }
      pad.ship?.setStats(slot.hp, slot.shield);
    }
  }

  // --- Darstellung ---

  private refreshHand(): void {
    const shipMarks = new Set<number>();
    if (this.selectedShipIndex !== null) shipMarks.add(this.selectedShipIndex);
    if (this.match.plan.ship) shipMarks.add(this.match.plan.ship.handIndex);
    this.hand.renderShips(this.match.shipHand, shipMarks);

    const commandMarks = new Set<number>();
    if (this.selectedCommandIndex !== null) commandMarks.add(this.selectedCommandIndex);
    if (this.match.plan.command) commandMarks.add(this.match.plan.command.handIndex);
    this.hand.renderCommands(this.match.commandHand, commandMarks);
  }

  private refreshSelectionVisuals(): void {
    this.refreshHand();
    this.validTargetCount = 0;
    for (const pad of this.view.pads) {
      const valid = this.isValidTarget(pad);
      pad.setValidTarget(valid);
      if (valid) this.validTargetCount += 1;
    }
    this.view.setGridVisible(this.selectedShipIndex !== null);
    this.updateHud();
  }

  private updateHud(): void {
    this.hud.setRound(this.match.round);
    this.hud.setStatus(this.buildStatusText());
  }

  private buildStatusText(): string {
    const fleet = `Flotte ${this.match.board.shipCount("player")}/${MAX_SHIPS_PER_SIDE}`;
    if (this.selectedShipIndex !== null) {
      const name = this.match.shipHand[this.selectedShipIndex]!.name;
      if (this.validTargetCount === 0) return `${fleet} — kein freier Slot für ${name} (max. 4 pro Lane, 8 pro Seite).`;
      return `${fleet} — ${name}: leuchtenden Slot antippen. Nochmal auf die Karte klicken nimmt zurück.`;
    }
    if (this.selectedCommandIndex !== null) {
      const name = this.match.commandHand[this.selectedCommandIndex]!.name;
      if (this.validTargetCount === 0) return `${fleet} — kein eigenes Schiff als Ziel für ${name}.`;
      return `${fleet} — ${name}: eigenes Schiff antippen. Nochmal auf die Karte klicken nimmt zurück.`;
    }
    const planned = [this.match.plannedShip?.name, this.match.plannedCommand?.name].filter((name) => name !== undefined);
    if (planned.length > 0) {
      return `${fleet} — ${planned.join(" + ")} steht bereit. „Runde ausführen“ oder Karte antippen zum Zurücknehmen.`;
    }
    return `${fleet} — Schiffs- oder Befehlskarte antippen, oder ohne Zug „Runde ausführen“ (Pass).`;
  }

  private setHoveredPad(pad: SlotPad | null): void {
    if (pad === this.hoveredPad) return;
    this.hoveredPad?.setHovered(false);
    this.hoveredPad = pad;
    this.hoveredPad?.setHovered(true);
  }
}
