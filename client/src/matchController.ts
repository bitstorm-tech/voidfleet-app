// Verbindet Server, Spielzustand, 3D-Szene und DOM-UI zur Zugplanung:
// Der Spieler stellt seinen Zug zusammen (1 Schiff + 1 Befehl), das gewählte
// Schiff steht als Geist auf dem Slot, der gewählte Befehl bleibt markiert.
// Beim Platzieren folgt der Geist dem Zeiger über die freien Slots. Befehle, die
// ein Schiff in die andere Lane verlegen, brauchen zwei Klicks: Schiff, dann Ziel-Slot;
// dort steht das verlegte Schiff ebenfalls als Geist.
// Alles ist bis zum Submit änderbar; danach wartet der Zug auf den Gegner.
// Der Spielzustand kommt vom Server und steckt in `Match`, die Szene spiegelt ihn nur.

import { PointerEventTypes, type PointerInfo } from "@babylonjs/core/Events/pointerEvents";
import { canTargetLane, needsTarget, type ShipCard } from "../../shared/cards.ts";
import { MAX_SHIPS_PER_LANE, MAX_SHIPS_PER_SIDE, type Lane, type Slot } from "../../shared/board.ts";
import type { ServerMessage, SlotTarget } from "../../shared/protocol.ts";
import { Match } from "./game/match.ts";
import { cardText, t } from "./i18n/index.ts";
import { ServerConnection } from "./net/connection.ts";
import { RoundPlayback } from "./roundPlayback.ts";
import { MatchScene, pickedPad } from "./scene/matchScene.ts";
import { ShipView } from "./scene/ship.ts";
import type { SlotPad } from "./scene/slotPad.ts";
import { FloatingTexts } from "./ui/floatingText.ts";
import { HandView } from "./ui/hand.ts";
import { Hud } from "./ui/hud.ts";
import { ResultScreen } from "./ui/resultScreen.ts";
import { RulesDialog } from "./ui/rulesDialog.ts";
import { SettingsDialog } from "./ui/settingsDialog.ts";

export class MatchController {
  private readonly match = new Match();
  private readonly view: MatchScene;
  private readonly hud: Hud;
  private readonly hand: HandView;
  private readonly playback: RoundPlayback;
  private readonly resultScreen: ResultScreen;
  private readonly connection: ServerConnection;
  private isConnected = true;
  /** Server-Nachrichten werden der Reihe nach verarbeitet; eine Runde wartet, bis ihre Animation fertig ist. */
  private inbox: Promise<void> = Promise.resolve();
  private isResolving = false;

  private selectedShipIndex: number | null = null;
  private selectedCommandIndex: number | null = null;
  /** Bei einem verlegenden Befehl: das gewählte Schiff, solange der Ziel-Slot noch fehlt. */
  private moveSource: Slot | null = null;
  private hoveredPad: SlotPad | null = null;
  private ghostPads: SlotPad[] = [];
  private validTargetCount = 0;

  constructor(canvas: HTMLCanvasElement, ui: HTMLElement) {
    this.view = new MatchScene(canvas, this.match.board);
    const floats = new FloatingTexts(ui);
    this.hud = new Hud(ui);
    this.playback = new RoundPlayback(this.view, this.hud, floats);
    this.resultScreen = new ResultScreen(ui);
    new SettingsDialog(ui);
    new RulesDialog(ui);
    this.hand = new HandView(ui, [this.hud.submitButton, this.hud.skipButton, this.hud.botButton], {
      onShipCardClick: (index) => this.onShipCardClick(index),
      onCommandCardClick: (index) => this.onCommandCardClick(index),
    });

    this.hud.submitButton.addEventListener("click", () => this.submit());
    this.hud.skipButton.addEventListener("click", () => this.playback.skip());
    this.hud.botButton.addEventListener("click", () => this.connection.send({ type: "addBot" }));
    this.view.scene.onPointerObservable.add((info) => this.onScenePointer(info));

    this.connection = new ServerConnection({
      onMessage: (message) => {
        this.inbox = this.inbox.then(() => this.onServerMessage(message));
      },
      onClose: () => {
        this.isConnected = false;
        this.refreshSelectionVisuals();
      },
    });
    this.refreshSelectionVisuals();
  }

  /** Geplant wird, solange der Zug dieser Runde noch nicht abgegeben und das Match nicht entschieden ist. */
  private get canPlan(): boolean {
    return this.isConnected && this.match.round > 0 && !this.match.submitted && this.match.result === null;
  }

  // --- Server ---

  private async onServerMessage(message: ServerMessage): Promise<void> {
    switch (message.type) {
      case "state": {
        // Runde 1 versteht sich von selbst, ebenso der erste Zustand nach dem Laden der Seite.
        const isNewRound = this.match.round > 0 && message.view.round > this.match.round && message.view.result === null;
        this.match.apply(message.view);
        this.selectedShipIndex = null;
        this.selectedCommandIndex = null;
        this.syncBoard();
        this.refreshSelectionVisuals();
        this.resultScreen.show(this.match.result, this.match.round);
        if (isNewRound) this.hud.showRoundBanner(this.match.round);
        break;
      }
      case "round":
        // Der Geist weicht dem echten Schiff; der neue Zustand folgt als nächste Nachricht.
        this.isResolving = true;
        this.refreshSelectionVisuals();
        await this.playback.play(message.round, message.events);
        this.isResolving = false;
        this.updateHud();
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
      this.match.plan.command = { handIndex: index, target: null, destination: null };
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
    this.moveSource = null;
    if (index !== null) this.selectedShipIndex = null;
    this.refreshSelectionVisuals();
  }

  // --- Brett ---

  /**
   * Das Brett reagiert nur, solange eine Karte gewählt ist; `pickInfo` wird erst beim Zugriff berechnet.
   * Geklickt wird beim Loslassen, damit Ziehen die Kamera verschiebt, ohne Karten zu platzieren.
   */
  private onScenePointer(info: PointerInfo): void {
    const hasSelection = this.selectedShipIndex !== null || this.selectedCommandIndex !== null;
    if (info.type === PointerEventTypes.POINTERMOVE) {
      this.setHoveredPad(hasSelection ? pickedPad(info) : null);
    } else if (info.type === PointerEventTypes.POINTERUP && info.event.button === 0 && hasSelection && !this.view.wasPanned) {
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
   * eigene Slots, die einem eingeplanten Lane-Wechsel nicht im Weg stehen; gewählter Befehl ->
   * eigene Schiffe in einer erlaubten Lane, bei verlegenden Befehlen nur mit freiem Ziel-Slot,
   * danach die freien Slots der anderen Lane. Ohne Auswahl leuchten nur das bereits gewählte
   * Befehlsziel und sein Ziel-Slot weiter, bis die Runde aufgelöst wird. Die Gegnerseite ist nie Ziel.
   */
  private isValidTarget(pad: SlotPad): boolean {
    const { slot } = pad;
    const lane: Lane = slot.lane;
    const board = this.match.board;
    if (lane.side === "enemy" || this.isResolving) return false;
    if (this.selectedShipIndex !== null) {
      const move = this.match.plannedMove;
      const deploy = { lane: lane.type, slotIndex: slot.index };
      return board.canPlace(lane, slot.index) && (move === null || board.canMove(move.from, move.to.index, deploy));
    }
    if (this.selectedCommandIndex !== null) {
      if (this.moveSource !== null) {
        return lane !== this.moveSource.lane && board.canMove(this.moveSource, slot.index, this.plannedDeploy);
      }
      const card = this.match.commandHand[this.selectedCommandIndex]!;
      if (!slot.isOccupied || !canTargetLane(card, lane.type)) return false;
      return !card.moves || board.moveDestinations(slot, this.plannedDeploy).length > 0;
    }
    const target = this.match.plan.command?.target;
    const isTarget = target?.lane === lane.type && target.slotIndex === slot.index;
    return isTarget || this.match.plannedMove?.to === slot;
  }

  private get plannedDeploy(): SlotTarget | null {
    return this.match.plan.ship?.target ?? null;
  }

  /** Plant das Schiff auf den Slot; bis zur Auflösung steht es dort nur als Geist. */
  private stageShipOn(pad: SlotPad): void {
    this.match.plan.ship = {
      handIndex: this.selectedShipIndex!,
      target: { lane: pad.slot.lane.type, slotIndex: pad.slot.index },
    };
    this.selectShip(null);
  }

  /** Verlegende Befehle merken sich erst das Schiff und werden mit dem Ziel-Slot eingeplant. */
  private stageCommandTargetOn(pad: SlotPad): void {
    const card = this.match.commandHand[this.selectedCommandIndex!]!;
    if (card.moves && this.moveSource === null) {
      this.moveSource = pad.slot;
      this.refreshSelectionVisuals();
      return;
    }
    const target = this.moveSource ?? pad.slot;
    this.match.plan.command = {
      handIndex: this.selectedCommandIndex!,
      target: { lane: target.lane.type, slotIndex: target.index },
      destination: this.moveSource && pad.slot.index,
    };
    this.selectCommand(null);
  }

  /** Stellt die Geister dorthin, wo sie laut `ghostTargets` stehen sollen; stehen sie schon richtig, bleiben sie. */
  private refreshGhosts(): void {
    const targets = this.ghostTargets();
    const unchanged =
      targets.length === this.ghostPads.length &&
      targets.every((target, index) => target.pad === this.ghostPads[index] && target.card === target.pad.ship?.card);
    if (unchanged) return;
    this.clearGhosts();
    for (const { pad, card } of targets) pad.attachShip(new ShipView(this.view.scene, card, true));
    this.ghostPads = targets.map((target) => target.pad);
  }

  /**
   * Beim Platzieren zeigt der Geist den Slot unter dem Zeiger, sonst das eingeplante Schiff.
   * Ebenso steht das verlegte Schiff beim Wählen des Ziel-Slots unter dem Zeiger, sonst auf dem
   * eingeplanten Ziel-Slot, solange nicht gerade ein anderer Befehl gewählt wird.
   */
  private ghostTargets(): { pad: SlotPad; card: ShipCard }[] {
    if (this.isResolving) return [];
    const ghosts: { pad: SlotPad; card: ShipCard }[] = [];
    const hovered = this.hoveredPad !== null && this.isValidTarget(this.hoveredPad) ? this.hoveredPad : null;
    const ship = this.match.plan.ship;
    if (this.selectedShipIndex !== null && hovered !== null) {
      ghosts.push({ pad: hovered, card: this.match.shipHand[this.selectedShipIndex]! });
    } else if (ship !== null) {
      ghosts.push({ pad: this.view.pad("player", ship.target.lane, ship.target.slotIndex), card: this.match.shipHand[ship.handIndex]! });
    }
    const move = this.match.plannedMove;
    if (this.moveSource !== null && hovered !== null) {
      ghosts.push({ pad: hovered, card: this.moveSource.card! });
    } else if (this.selectedCommandIndex === null && move !== null) {
      ghosts.push({ pad: this.view.pad("player", move.to.lane.type, move.to.index), card: move.from.card! });
    }
    return ghosts;
  }

  private clearGhosts(): void {
    for (const pad of this.ghostPads) pad.clearShip();
    this.ghostPads = [];
  }

  // --- Runde ---

  private submit(): void {
    if (!this.canPlan || !this.match.opponent.joined) return;
    this.connection.send({ type: "submit", plan: this.match.plan });
  }

  /** Szene an den neuen Zustand angleichen (auch Schiffe, die die Lane gewechselt haben); der Geist kommt zuletzt. */
  private syncBoard(): void {
    this.clearGhosts();
    for (const pad of this.view.pads) {
      const slot = pad.slot;
      if (slot.isOccupied && pad.ship?.card !== slot.card) {
        pad.attachShip(new ShipView(this.view.scene, slot.card!, false));
      } else if (!slot.isOccupied && pad.ship !== null) {
        pad.clearShip();
      }
      pad.ship?.setStats(slot.hp, slot.shield);
    }
    this.refreshGhosts();
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
    this.view.setGridVisible(this.selectedShipIndex !== null || this.moveSource !== null);
    this.refreshGhosts();
    this.updateHud();
  }

  private updateHud(): void {
    this.hud.setRound(this.match.round);
    this.hud.setStatus(this.buildStatusText());
    // Solange kein Gegner da ist, bietet der Knopf den Computergegner an.
    const waitingForOpponent = this.isConnected && this.match.round > 0 && !this.match.opponent.joined;
    this.hud.showAction(this.isResolving ? "skip" : waitingForOpponent ? "bot" : "submit");
    this.hud.submitButton.disabled = !this.canPlan || !this.match.opponent.joined;
    this.hud.submitButton.textContent = this.match.submitted ? t.hud.waiting : t.hud.endTurn;
  }

  private buildStatusText(): string {
    if (!this.isConnected) return t.status.disconnected;
    if (this.match.round === 0) return t.status.connecting;
    if (this.isResolving) return t.status.resolving;
    if (this.match.result !== null) return t.status.matchOver;
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
      if (this.moveSource !== null) return t.status.chooseDestination(name, cardText(this.moveSource.card!).name);
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
    this.refreshGhosts();
  }
}
