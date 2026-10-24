// Verbindet Server, Spielzustand, 3D-Szene und DOM-UI zur Zugplanung:
// Der Spieler stellt seinen Zug zusammen (1 Schiff + 1 Befehl), das gewählte
// Schiff steht als Geist auf dem Slot, der gewählte Befehl bleibt markiert.
// Beim Platzieren folgt der Geist dem Zeiger über die freien Slots. Der Geist des geplanten
// Schiffs ist für Befehle ein Ziel wie jedes andere eigene Schiff. Befehle, die
// ein Schiff in die andere Lane verlegen, brauchen zwei Klicks: Schiff, dann Ziel-Slot;
// dort steht das verlegte Schiff ebenfalls als Geist, ein Bogenpfeil zeigt den Weg.
// Ist keine Karte gewählt, plant ein Klick auf ein eigenes Schiff das Grundmanöver ebenso
// mit Ziel-Slot, Geist und Pfeil; das Schiff feuert dann nicht, seine Balken sind gedämpft.
// Ein Klick auf das manövrierende Schiff oder Escape nimmt das Manöver zurück.
// Der Torpedo zielt auf einen Slot der Gegnerseite, auch einen leeren; ein Fadenkreuz markiert ihn.
// Alles ist bis zum Submit änderbar; danach wartet der Zug auf den Gegner.
// Der Spielzustand kommt vom Server und steckt in `Match`, die Szene spiegelt ihn nur.
// „Neues Match“ wechselt nur die Verbindung; Szene und geladene Assets bleiben.
// Die Musik folgt der Phase: ruhig beim Planen, angespannt während die Runde abläuft, still nach Spielende.

import { PointerEventTypes, type PointerInfo } from "@babylonjs/core/Events/pointerEvents";
import { canTargetLane, needsTarget, targetsEnemySlot, type CommandCard, type ShipCard } from "../../shared/cards.ts";
import { MAX_SHIPS_PER_LANE, MAX_SHIPS_PER_SIDE, slotTarget, type Lane, type Slot } from "../../shared/board.ts";
import type { ServerMessage } from "../../shared/protocol.ts";
import { setMusicMood } from "./audio/music.ts";
import { playUiSound } from "./audio/uiSounds.ts";
import { Match, type PlannedMove } from "./game/match.ts";
import { cardText, t } from "./i18n/index.ts";
import { ServerConnection } from "./net/connection.ts";
import { preloadAssets } from "./preload.ts";
import { RoundPlayback } from "./roundPlayback.ts";
import { MatchScene, pickedPad } from "./scene/matchScene.ts";
import type { MoveArrow } from "./scene/moveArrow.ts";
import { ShipView } from "./scene/ship.ts";
import type { SlotPad } from "./scene/slotPad.ts";
import { FloatingTexts } from "./ui/floatingText.ts";
import { HandView } from "./ui/hand.ts";
import { Hud } from "./ui/hud.ts";
import { LoadingScreen } from "./ui/loadingScreen.ts";
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
  private connection: ServerConnection;
  private isConnected = true;
  /**
   * Server-Nachrichten werden der Reihe nach verarbeitet; eine Runde wartet, bis ihre Animation fertig ist.
   * Die erste wartet, bis alle Assets geladen sind.
   */
  private inbox: Promise<void>;
  private isResolving = false;

  private selectedShipIndex: number | null = null;
  private selectedCommandIndex: number | null = null;
  /** Bei einem verlegenden Befehl: das gewählte Schiff, solange der Ziel-Slot noch fehlt. */
  private moveSource: Slot | null = null;
  /** Beim Grundmanöver: das gewählte Schiff, solange der Ziel-Slot noch fehlt. */
  private maneuverSource: Slot | null = null;
  private hoveredPad: SlotPad | null = null;
  private ghostPads: SlotPad[] = [];
  private validTargetCount = 0;

  constructor(canvas: HTMLCanvasElement, ui: HTMLElement) {
    this.view = new MatchScene(canvas, this.match.board);
    const floats = new FloatingTexts(ui);
    this.hud = new Hud(ui);
    this.playback = new RoundPlayback(this.view, this.hud, floats);
    this.resultScreen = new ResultScreen(ui, () => this.startNewMatch());
    new SettingsDialog(ui);
    new RulesDialog(ui);
    this.hand = new HandView(ui, [this.hud.submitButton, this.hud.skipButton, this.hud.botButton], {
      onShipCardClick: (index) => this.onShipCardClick(index),
      onCommandCardClick: (index) => this.onCommandCardClick(index),
    });
    const loading = new LoadingScreen(ui);
    this.inbox = preloadAssets(this.view, (fraction) => loading.setProgress(fraction)).then(
      () => loading.hide(),
      (error) => {
        loading.fail();
        throw error;
      },
    );

    this.hud.submitButton.addEventListener("click", () => this.submit());
    this.hud.skipButton.addEventListener("click", () => this.playback.skip());
    this.hud.botButton.addEventListener("click", () => this.connection.send({ type: "addBot" }));
    this.view.scene.onPointerObservable.add((info) => this.onScenePointer(info));
    window.addEventListener("keydown", (event) => this.onKeyDown(event));

    this.connection = this.connect(false);
    this.refreshSelectionVisuals();
  }

  private connect(newMatch: boolean): ServerConnection {
    return new ServerConnection(
      {
        onMessage: (message) => {
          this.inbox = this.inbox.then(() => this.onServerMessage(message));
        },
        onClose: () => {
          this.isConnected = false;
          this.refreshSelectionVisuals();
        },
      },
      newMatch,
    );
  }

  /** Der erste Zustand des neuen Matches überschreibt Brett, Hände und Ergebnis. */
  private startNewMatch(): void {
    this.connection.close();
    this.isConnected = true;
    this.connection = this.connect(true);
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
        setMusicMood(this.match.result === null ? "calm" : null);
        this.selectedShipIndex = null;
        this.selectedCommandIndex = null;
        this.moveSource = null;
        this.maneuverSource = null;
        this.syncBoard();
        this.refreshSelectionVisuals();
        this.resultScreen.show(this.match.result, this.match.round);
        if (isNewRound) this.hud.showRoundBanner(this.match.round);
        break;
      }
      case "round":
        // Der Geist weicht dem echten Schiff; der neue Zustand folgt als nächste Nachricht.
        this.isResolving = true;
        this.match.endRound();
        this.refreshSelectionVisuals();
        setMusicMood("battle");
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
    if (!this.canPlan) return playUiSound("denied");
    if (this.match.plan.ship?.handIndex === index) {
      // Erneutes Antippen der geplanten Karte nimmt den Zug zurück, samt Befehl auf dieses Schiff;
      // ein angefangener Lane-Wechsel des Schiffs bricht ab.
      if (this.moveSource !== null && this.match.isPlannedDeploy(this.moveSource)) this.moveSource = null;
      this.match.planShip(null);
      this.selectShip(null);
      playUiSound("cancel");
    } else if (this.selectedShipIndex === index) {
      this.selectShip(null);
      playUiSound("cancel");
    } else {
      this.selectShip(index);
      playUiSound("select");
    }
  }

  /** Befehle ohne Zielwahl sind mit einem Klick eingeplant, sonst folgt der Klick auf ein eigenes Schiff. */
  private onCommandCardClick(index: number): void {
    if (!this.canPlan) return playUiSound("denied");
    const card = this.match.commandHand[index]!;
    if (this.match.plan.command?.handIndex === index) {
      this.match.plan.command = null;
      this.selectCommand(null);
      playUiSound("cancel");
    } else if (this.selectedCommandIndex === index) {
      this.selectCommand(null);
      playUiSound("cancel");
    } else if (needsTarget(card)) {
      this.selectCommand(index);
      playUiSound("select");
    } else {
      this.match.plan.command = { handIndex: index, target: null, destination: null };
      this.selectCommand(null);
      playUiSound("place");
    }
  }

  /** Schiffskarte, Befehlskarte und Manöver-Schiff sind nie gleichzeitig gewählt. */
  private selectShip(index: number | null): void {
    this.selectedShipIndex = index;
    if (index !== null) {
      this.selectedCommandIndex = null;
      this.moveSource = null;
      this.maneuverSource = null;
    }
    this.refreshSelectionVisuals();
  }

  private selectCommand(index: number | null): void {
    this.selectedCommandIndex = index;
    this.moveSource = null;
    if (index !== null) {
      this.selectedShipIndex = null;
      this.maneuverSource = null;
    }
    this.refreshSelectionVisuals();
  }

  private selectManeuver(slot: Slot | null): void {
    this.maneuverSource = slot;
    if (slot !== null) {
      this.selectedShipIndex = null;
      this.selectedCommandIndex = null;
      this.moveSource = null;
    }
    this.refreshSelectionVisuals();
  }

  private clearSelection(): void {
    this.selectedShipIndex = null;
    this.selectedCommandIndex = null;
    this.moveSource = null;
    this.maneuverSource = null;
    this.refreshSelectionVisuals();
  }

  private get selectedCommand(): CommandCard | null {
    return this.selectedCommandIndex === null ? null : this.match.commandHand[this.selectedCommandIndex]!;
  }

  private get hasSelection(): boolean {
    return this.selectedShipIndex !== null || this.selectedCommandIndex !== null || this.maneuverSource !== null;
  }

  private cancelManeuver(): void {
    this.match.plan.maneuver = null;
    this.refreshSelectionVisuals();
    playUiSound("cancel");
  }

  /** Escape bricht eine angefangene Auswahl ab, sonst nimmt es das eingeplante Manöver zurück. Offene Dialoge gehen vor. */
  private onKeyDown(event: KeyboardEvent): void {
    if (event.key !== "Escape" || !this.canPlan || document.querySelector("dialog[open]") !== null) return;
    if (this.hasSelection) {
      this.clearSelection();
      playUiSound("cancel");
    } else if (this.match.plan.maneuver !== null) {
      this.cancelManeuver();
    }
  }

  // --- Brett ---

  /**
   * Das Brett zeigt den Zeiger nur, solange eine Karte oder ein Manöver-Schiff gewählt ist; ohne
   * Auswahl startet ein Klick das Grundmanöver. `pickInfo` wird erst beim Zugriff berechnet.
   * Geklickt wird beim Loslassen, damit Ziehen die Kamera verschiebt, ohne Karten zu platzieren.
   */
  private onScenePointer(info: PointerInfo): void {
    if (info.type === PointerEventTypes.POINTERMOVE) {
      this.setHoveredPad(this.hasSelection ? pickedPad(info) : null);
    } else if (info.type === PointerEventTypes.POINTERUP && info.event.button === 0 && !this.view.wasPanned) {
      if (this.hasSelection) this.onBoardClick(pickedPad(info));
      else if (this.canPlan && !this.isResolving) this.onShipClick(pickedPad(info));
    }
  }

  private onBoardClick(pad: SlotPad | null): void {
    // Daneben oder erneut auf das Manöver-Schiff: Die Auswahl bricht ab.
    if (pad === null || pad.slot === this.maneuverSource) {
      this.clearSelection();
      return playUiSound("cancel");
    }
    if (!this.isValidTarget(pad)) return playUiSound("denied");

    if (this.selectedShipIndex !== null) {
      this.stageShipOn(pad);
    } else if (this.maneuverSource !== null) {
      this.stageManeuverOn(pad);
    } else {
      this.stageCommandTargetOn(pad);
    }
  }

  /**
   * Ohne gewählte Karte: Ein Klick auf ein eigenes Schiff beginnt das Grundmanöver, einer auf das
   * manövrierende Schiff oder seinen Geist nimmt es zurück. Leere Slots und Geister reagieren nicht.
   */
  private onShipClick(pad: SlotPad | null): void {
    if (pad === null || pad.slot.lane.side === "enemy") return;
    const maneuver = this.match.plannedManeuver;
    if (maneuver !== null && (pad.slot === maneuver.from || pad.slot === maneuver.to)) return this.cancelManeuver();
    if (!pad.slot.isOccupied) return;
    if (this.match.maneuverDestinations(pad.slot).length === 0) return playUiSound("denied");
    this.selectManeuver(pad.slot);
    playUiSound("select");
  }

  /**
   * Einzige Gültigkeitsregel für Highlight und Klick: gewähltes Schiff -> freie
   * eigene Slots, die den eingeplanten Lane-Wechseln nicht im Weg stehen; Manöver-Schiff -> seine
   * Ziel-Slots in der anderen Lane; gewählter Befehl -> eigene Schiffe in einer erlaubten Lane, auch
   * das eingeplante, bei verlegenden Befehlen nur mit freiem Ziel-Slot, danach die freien Slots der
   * anderen Lane; der Torpedo -> jeder Slot der Gegnerseite, sonst ist sie nie Ziel. Ohne Auswahl
   * leuchten nur das bereits gewählte eigene Befehlsziel, die Ziel-Slots und das manövrierende Schiff
   * weiter, bis die Runde aufgelöst wird; den Zielslot des Torpedos zeigt das Fadenkreuz.
   */
  private isValidTarget(pad: SlotPad): boolean {
    const { slot } = pad;
    const lane: Lane = slot.lane;
    if (this.isResolving) return false;
    const command = this.selectedCommand;
    if (command && targetsEnemySlot(command)) return lane.side === "enemy";
    if (lane.side === "enemy") return false;
    if (this.selectedShipIndex !== null) return this.match.canDeploy(slot);
    if (this.maneuverSource !== null) {
      return lane !== this.maneuverSource.lane && this.match.maneuverDestinations(this.maneuverSource).includes(slot.index);
    }
    if (this.selectedCommandIndex !== null) {
      if (this.moveSource !== null) {
        return lane !== this.moveSource.lane && this.match.commandMoveDestinations(this.moveSource).includes(slot.index);
      }
      if (this.match.shipAt(slot) === null || !canTargetLane(command!, lane.type)) return false;
      return !command!.moves || this.match.commandMoveDestinations(slot).length > 0;
    }
    const target = this.match.plannedEnemyTarget ? null : this.match.plan.command?.target;
    const isTarget = target?.lane === lane.type && target.slotIndex === slot.index;
    const maneuver = this.match.plannedManeuver;
    return isTarget || this.match.plannedCommandMove?.to === slot || maneuver?.from === slot || maneuver?.to === slot;
  }

  /** Plant das Schiff auf den Slot; bis zur Auflösung steht es dort nur als Geist. */
  private stageShipOn(pad: SlotPad): void {
    this.match.planShip({
      handIndex: this.selectedShipIndex!,
      target: { lane: pad.slot.lane.type, slotIndex: pad.slot.index },
    });
    this.selectShip(null);
    playUiSound("place");
  }

  /** Plant das Grundmanöver; das Schiff steht bis zur Auflösung als Geist im Ziel-Slot. */
  private stageManeuverOn(pad: SlotPad): void {
    this.match.plan.maneuver = { ship: slotTarget(this.maneuverSource!), destination: pad.slot.index };
    this.selectManeuver(null);
    playUiSound("place");
  }

  /** Verlegende Befehle merken sich erst das Schiff und werden mit dem Ziel-Slot eingeplant. */
  private stageCommandTargetOn(pad: SlotPad): void {
    const card = this.match.commandHand[this.selectedCommandIndex!]!;
    if (card.moves && this.moveSource === null) {
      this.moveSource = pad.slot;
      this.refreshSelectionVisuals();
      return playUiSound("select");
    }
    const target = this.moveSource ?? pad.slot;
    this.match.plan.command = {
      handIndex: this.selectedCommandIndex!,
      target: { lane: target.lane.type, slotIndex: target.index },
      destination: this.moveSource && pad.slot.index,
    };
    this.selectCommand(null);
    playUiSound("place");
  }

  /**
   * Stellt die Geister dorthin, wo sie laut `ghostTargets` stehen sollen; stehen sie schon richtig, bleiben sie.
   * Die Pfeile der Lane-Wechsel folgen den Geistern der verlegten Schiffe.
   */
  private refreshGhosts(): void {
    showArrow(this.view.moveArrow, this.shownCommandMove());
    showArrow(this.view.maneuverArrow, this.shownManeuver());
    this.view.reticle.show(this.shownEnemyTarget());

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
   * Ebenso stehen die verlegten Schiffe beim Wählen des Ziel-Slots unter dem Zeiger, sonst auf dem
   * eingeplanten Ziel-Slot (siehe `shownMove`).
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
    for (const move of [this.shownCommandMove(), this.shownManeuver()]) {
      if (move !== null) ghosts.push({ pad: move.to, card: this.match.shipAt(move.from.slot)! });
    }
    return ghosts;
  }

  /** Das Fadenkreuz steht beim Wählen auf dem Slot unter dem Zeiger, sonst auf dem eingeplanten Zielslot des Torpedos. */
  private shownEnemyTarget(): SlotPad | null {
    if (this.isResolving) return null;
    const command = this.selectedCommand;
    if (command && targetsEnemySlot(command)) return this.hoveredPad !== null && this.isValidTarget(this.hoveredPad) ? this.hoveredPad : null;
    const target = this.match.plannedEnemyTarget;
    return target && this.view.pad("enemy", target.lane, target.slotIndex);
  }

  private shownCommandMove(): { from: SlotPad; to: SlotPad } | null {
    return this.shownMove(this.moveSource, this.match.plannedCommandMove, this.selectedCommandIndex !== null);
  }

  private shownManeuver(): { from: SlotPad; to: SlotPad } | null {
    return this.shownMove(this.maneuverSource, this.match.plannedManeuver, false);
  }

  /**
   * Ein Lane-Wechsel, wie Geist und Pfeil ihn zeigen: beim Wählen (`source`) zum Slot unter dem Zeiger,
   * sonst der eingeplante, solange er nicht gerade neu gewählt wird.
   */
  private shownMove(source: Slot | null, planned: PlannedMove | null, isReplanning: boolean): { from: SlotPad; to: SlotPad } | null {
    if (this.isResolving) return null;
    const padOf = (slot: Slot) => this.view.pad("player", slot.lane.type, slot.index);
    const hovered = this.hoveredPad;
    if (source !== null) {
      return hovered !== null && this.isValidTarget(hovered) ? { from: padOf(source), to: hovered } : null;
    }
    if (isReplanning || planned === null) return null;
    return { from: padOf(planned.from), to: padOf(planned.to) };
  }

  /** Das manövrierende Schiff feuert nicht und zeigt das mit gedämpften Balken; in der Auflösung setzt sie die Wiedergabe. */
  private refreshHoldFire(): void {
    if (this.isResolving) return;
    const maneuvering = this.maneuverSource ?? this.match.plannedManeuver?.from ?? null;
    for (const pad of this.view.pads) pad.ship?.setHoldingFire(pad.slot === maneuvering);
  }

  private clearGhosts(): void {
    for (const pad of this.ghostPads) pad.clearShip();
    this.ghostPads = [];
  }

  // --- Runde ---

  private submit(): void {
    if (!this.canPlan || !this.match.opponent.joined) return;
    this.connection.send({ type: "submit", plan: this.match.plan });
    playUiSound("confirm");
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
    this.view.setGridVisible(this.selectedShipIndex !== null || this.moveSource !== null || this.maneuverSource !== null);
    this.refreshGhosts();
    this.refreshHoldFire();
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
    if (this.maneuverSource !== null) return t.status.chooseManeuver(cardText(this.maneuverSource.card!).name);
    if (this.selectedShipIndex !== null) {
      const name = cardText(this.match.shipHand[this.selectedShipIndex]!).name;
      if (this.validTargetCount === 0) return t.status.noFreeSlot(name, MAX_SHIPS_PER_LANE, MAX_SHIPS_PER_SIDE);
      return t.status.placeShip(name);
    }
    const command = this.selectedCommand;
    if (command !== null) {
      const name = cardText(command).name;
      if (targetsEnemySlot(command)) return t.status.chooseEnemySlot(name);
      if (this.moveSource !== null) return t.status.chooseDestination(name, cardText(this.match.shipAt(this.moveSource)!).name);
      if (this.validTargetCount === 0) return t.status.noCommandTarget(name);
      return t.status.chooseCommandTarget(name);
    }
    const cards = [this.match.plannedShip, this.match.plannedCommand].filter((card) => card !== null);
    const planned = cards.map((card) => cardText(card).name);
    const maneuver = this.match.plannedManeuver;
    if (maneuver !== null) planned.push(t.status.maneuver(cardText(maneuver.from.card!).name));
    if (planned.length > 0) return t.status.planned(planned.join(" + "));
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

function showArrow(arrow: MoveArrow, move: { from: SlotPad; to: SlotPad } | null): void {
  if (move === null) arrow.hide();
  else arrow.show(move.from, move.to);
}
