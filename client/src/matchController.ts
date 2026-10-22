// Verbindet Server, Spielzustand, 3D-Szene und DOM-UI zur Zugplanung:
// Der Spieler stellt seinen Zug zusammen (1 Schiff + 1 Befehl), das gewählte
// Schiff steht als Geist auf dem Slot, der gewählte Befehl bleibt markiert.
// Alles ist bis zum Submit änderbar; danach wartet der Zug auf den Gegner.
// Der Spielzustand kommt vom Server und steckt in `Match`, die Szene spiegelt ihn nur.

import { PointerEventTypes, type PointerInfo } from "@babylonjs/core/Events/pointerEvents";
import { needsTarget } from "../../shared/cards.ts";
import { MAX_SHIPS_PER_LANE, MAX_SHIPS_PER_SIDE, type Lane } from "../../shared/board.ts";
import type { ServerMessage } from "../../shared/protocol.ts";
import { Match } from "./game/match.ts";
import { cardText, t } from "./i18n/index.ts";
import { ServerConnection } from "./net/connection.ts";
import { MatchScene, pickedPad } from "./scene/matchScene.ts";
import { ShipView } from "./scene/ship.ts";
import type { SlotPad } from "./scene/slotPad.ts";
import { HandView } from "./ui/hand.ts";
import { Hud } from "./ui/hud.ts";
import { roundLogLines } from "./ui/roundLog.ts";

export class MatchController {
  private readonly match = new Match();
  private readonly view: MatchScene;
  private readonly hud: Hud;
  private readonly hand: HandView;
  private readonly connection: ServerConnection;
  private isConnected = true;

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

    this.connection = new ServerConnection({
      onMessage: (message) => this.onServerMessage(message),
      onClose: () => {
        this.isConnected = false;
        this.refreshSelectionVisuals();
      },
    });
    this.refreshSelectionVisuals();
  }

  /** Geplant wird, solange der Zug dieser Runde noch nicht abgegeben ist. */
  private get canPlan(): boolean {
    return this.isConnected && this.match.round > 0 && !this.match.submitted;
  }

  // --- Server ---

  private onServerMessage(message: ServerMessage): void {
    switch (message.type) {
      case "state":
        this.match.apply(message.view);
        this.selectedShipIndex = null;
        this.selectedCommandIndex = null;
        this.syncBoard();
        this.refreshSelectionVisuals();
        break;
      case "round":
        this.hud.appendLog(roundLogLines(message.round, message.events));
        break;
      case "error":
        this.hud.appendLog([`Server: ${t.errors[message.code]}`]);
        break;
    }
  }

  // --- Hand ---

  private onShipCardClick(index: number): void {
    if (!this.canPlan) return;
    if (this.match.plan.ship?.handIndex === index) {
      // Erneutes Antippen der geplanten Karte nimmt den Zug zurück.
      this.match.plan.ship = null;
      this.clearGhost();
      this.selectShip(null);
    } else if (this.selectedShipIndex === index) {
      this.selectShip(null);
    } else {
      this.selectShip(index);
    }
  }

  /** Befehle ohne Zielwahl sind mit einem Klick eingeplant, sonst folgt der Klick auf ein eigenes Schiff. */
  private onCommandCardClick(index: number): void {
    if (!this.canPlan) return;
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
    return target !== undefined && target !== null && target.lane === lane.type && target.slotIndex === pad.slot.index;
  }

  /** Plant das Schiff auf den Slot; bis zur Auflösung steht es dort nur als Geist. */
  private stageShipOn(pad: SlotPad): void {
    this.match.plan.ship = {
      handIndex: this.selectedShipIndex!,
      target: { lane: pad.slot.lane.type, slotIndex: pad.slot.index },
    };
    this.showGhost();
    this.selectShip(null);
  }

  private stageCommandTargetOn(pad: SlotPad): void {
    this.match.plan.command = {
      handIndex: this.selectedCommandIndex!,
      target: { lane: pad.slot.lane.type, slotIndex: pad.slot.index },
    };
    this.selectCommand(null);
  }

  private showGhost(): void {
    this.clearGhost();
    const ship = this.match.plan.ship;
    if (ship === null) return;
    const lane = this.match.board.lane("player", ship.target.lane);
    this.ghostPad = this.view.padsByLane.get(lane)![ship.target.slotIndex]!;
    this.ghostPad.attachShip(new ShipView(this.view.scene, this.match.shipHand[ship.handIndex]!, true));
  }

  private clearGhost(): void {
    this.ghostPad?.clearShip();
    this.ghostPad = null;
  }

  // --- Runde ---

  private submit(): void {
    if (!this.canPlan || !this.match.opponent.joined) return;
    this.connection.send({ type: "submit", plan: this.match.plan });
  }

  /** Szene an den neuen Zustand angleichen; der Geist kommt erst nach den echten Schiffen. */
  private syncBoard(): void {
    this.clearGhost();
    for (const pad of this.view.pads) {
      const slot = pad.slot;
      if (slot.isOccupied && pad.ship === null) {
        pad.attachShip(new ShipView(this.view.scene, slot.card!, false));
      } else if (!slot.isOccupied && pad.ship !== null) {
        pad.clearShip();
      }
      pad.ship?.setStats(slot.hp, slot.shield);
    }
    this.showGhost();
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
    this.hud.submitButton.disabled = !this.canPlan || !this.match.opponent.joined;
  }

  private buildStatusText(): string {
    if (!this.isConnected) return t.status.disconnected;
    if (this.match.round === 0) return t.status.connecting;
    if (this.match.submitted) return t.status.submitted;
    if (!this.match.opponent.joined) return t.status.waitingForOpponent(this.shareLink());
    const fleet = t.status.fleet(this.match.board.shipCount("player"), MAX_SHIPS_PER_SIDE);
    const opponent = this.match.opponent.submitted ? ` ${t.status.opponentSubmitted}` : "";
    return `${fleet} — ${this.buildPlanningText()}${opponent}`;
  }

  /** Der Match-Link ohne `?lang=`, damit der Gegner seine eigene Sprache bekommt. */
  private shareLink(): string {
    const url = new URL(location.href);
    url.searchParams.delete("lang");
    return url.href;
  }

  private buildPlanningText(): string {
    if (this.selectedShipIndex !== null) {
      const name = cardText(this.match.shipHand[this.selectedShipIndex]!).name;
      if (this.validTargetCount === 0) return t.status.noFreeSlot(name, MAX_SHIPS_PER_LANE, MAX_SHIPS_PER_SIDE);
      return t.status.placeShip(name);
    }
    if (this.selectedCommandIndex !== null) {
      const name = cardText(this.match.commandHand[this.selectedCommandIndex]!).name;
      if (this.validTargetCount === 0) return t.status.noCommandTarget(name);
      return t.status.chooseCommandTarget(name);
    }
    const planned = [this.match.plannedShip, this.match.plannedCommand].filter((card) => card !== null);
    if (planned.length > 0) return t.status.planned(planned.map((card) => cardText(card).name).join(" + "));
    return t.status.idle;
  }

  private setHoveredPad(pad: SlotPad | null): void {
    if (pad === this.hoveredPad) return;
    this.hoveredPad?.setHovered(false);
    this.hoveredPad = pad;
    this.hoveredPad?.setHovered(true);
  }
}
