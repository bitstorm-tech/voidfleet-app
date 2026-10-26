// Verbindet Server, Spielzustand, 3D-Szene und DOM-UI zur Zugplanung:
// Vor Runde 1 wählt der Spieler seinen Admiral (`ui/admiralSelect.ts`); geplant wird erst, wenn beide gewählt haben.
// Der Spieler stellt seinen Zug zusammen (1 Schiff, in Runde 1 zwei samt Flaggschiff, + 1 Befehl), die gewählten
// Schiffe stehen als Geister auf ihren Slots, der gewählte Befehl bleibt markiert. Ein Klick auf
// einen Geist oder seine Karte nimmt genau dieses Schiff zurück; ohne Flaggschiff geht „Zug beenden“ in Runde 1 nicht.
// Beim Platzieren folgt der Geist dem Zeiger über die freien Slots. Die Geister der geplanten
// Schiffe sind für Befehle Ziele wie jedes andere eigene Schiff. Befehle, die
// ein Schiff in die andere Lane verlegen, brauchen zwei Klicks: Schiff, dann Ziel-Slot;
// dort steht das verlegte Schiff ebenfalls als Geist, ein Bogenpfeil zeigt den Weg.
// Ist keine Karte gewählt, plant ein Klick auf ein eigenes Schiff das Grundmanöver ebenso
// mit Ziel-Slot, Geist und Pfeil; das Schiff feuert dann nicht, seine Balken sind gedämpft. Die Mirage darf
// auch auf ein eigenes Schiff: Beim Phasentausch stehen beide als Geist über dem anderen, je mit Pfeil.
// Ein Klick auf das manövrierende Schiff oder Escape nimmt das Manöver zurück.
// Statt des Manövers geht die Admiralsfähigkeit (`ui/powerCard.ts`): Ihre Karte startet die Zielwahl, das Ziel
// trägt danach ihre Marke (`scene/markers.ts`), das Trugbild steht als Geist im Slot; wer das eine plant, verliert
// das andere, und die Statuszeile sagt es. Admiral Kerr erfasst mit dem Knopf darüber zusätzlich ein Ziel der Railgun.
// Der Torpedo zielt auf einen Slot der Gegnerseite, auch einen leeren; ein Fadenkreuz markiert ihn.
// Alles ist bis zum Submit änderbar; danach wartet der Zug auf den Gegner. Solange geplant wird, zeigt die
// Zielvorschau (`game/preview.ts`), wie die Runde mit diesem Plan liefe, wenn der Gegner nichts tut.
// Der Spielzustand kommt vom Server und steckt in `Match`, die Szene spiegelt ihn nur.
// „Neues Match“ wechselt nur die Verbindung; Szene und geladene Assets bleiben.
// Die Musik folgt der Phase: ruhig beim Planen, angespannt während die Runde abläuft, still nach Spielende.
// Zwischen den Runden meldet sich der Bordfunk (`audio/radio.ts`), während einer Runde die Wiedergabe.

import { PointerEventTypes, type PointerInfo } from "@babylonjs/core/Events/pointerEvents";
import { ADMIRALS, type AdmiralId } from "../../shared/admirals.ts";
import { canTargetLane, needsTarget, shipById, targetsEnemySlot, type CommandCard, type ShipCard } from "../../shared/cards.ts";
import { isSameSlot, maxDeploys, MAX_SHIPS_PER_LANE, MAX_SHIPS_PER_SIDE, overdriveBonus, slotTarget, type PlannedMove, type Slot } from "../../shared/board.ts";
import type { MatchResult, OpponentView, ServerMessage, SlotRef } from "../../shared/protocol.ts";
import { setMusicMood } from "./audio/music.ts";
import { say } from "./audio/radio.ts";
import { playUiSound } from "./audio/uiSounds.ts";
import { powerAdmiral } from "./data/admirals.ts";
import { color3 } from "./data/palette.ts";
import type { RadioCue } from "./data/radio.ts";
import { Match, type ShipPick } from "./game/match.ts";
import { previewRound, type RoundPreview } from "./game/preview.ts";
import { cardText, t } from "./i18n/index.ts";
import { ServerConnection } from "./net/connection.ts";
import { preloadAssets } from "./preload.ts";
import { RoundPlayback } from "./roundPlayback.ts";
import { MatchScene, pickedPad } from "./scene/matchScene.ts";
import type { MarkerSpec } from "./scene/markers.ts";
import type { MoveArrow } from "./scene/moveArrow.ts";
import { ShipView } from "./scene/ship.ts";
import type { SlotPad } from "./scene/slotPad.ts";
import { AdmiralSelect } from "./ui/admiralSelect.ts";
import { FloatingTexts } from "./ui/floatingText.ts";
import { HandView } from "./ui/hand.ts";
import { Hud } from "./ui/hud.ts";
import { LoadingScreen } from "./ui/loadingScreen.ts";
import { installFullscreen, toggleFullscreen } from "./ui/fullscreen.ts";
import { OpponentPanel } from "./ui/opponentPanel.ts";
import { PowerCard, type PowerCardView, type PowerState } from "./ui/powerCard.ts";
import { RadioSubtitle } from "./ui/radioSubtitle.ts";
import { ResultScreen } from "./ui/resultScreen.ts";
import { slotLabel } from "./ui/roundLog.ts";
import { RulesDialog } from "./ui/rulesDialog.ts";
import { SettingsDialog } from "./ui/settingsDialog.ts";
import { SurrenderDialog } from "./ui/surrenderDialog.ts";

/** Den Ausgang meldet der Bordfunk kurz nach dem Einsatz der Fanfare (Millisekunden). */
const RESULT_REPORT_DELAY = 1500;
const KERR = color3("kerr");

/** Was gerade gewählt ist und auf einen Klick aufs Brett wartet; es ist immer höchstens eines. */
type Selection =
  | { kind: "ship"; pick: ShipPick }
  /** Bei einem verlegenden Befehl: `moveSource` ist das gewählte Schiff, solange der Ziel-Slot noch fehlt. */
  | { kind: "command"; index: number; moveSource: Slot | null }
  /** Beim Grundmanöver: das gewählte Schiff, solange der Ziel-Slot noch fehlt. */
  | { kind: "maneuver"; source: Slot }
  | { kind: "power" }
  /** Zielerfassung der Pendulum. */
  | { kind: "mark" };

export class MatchController {
  private readonly match = new Match();
  private readonly view: MatchScene;
  private readonly hud: Hud;
  private readonly hand: HandView;
  private readonly powerCard: PowerCard;
  private readonly admiralSelect: AdmiralSelect;
  private readonly playback: RoundPlayback;
  private readonly resultScreen: ResultScreen;
  private readonly surrenderDialog: SurrenderDialog;
  private readonly opponentPanel: OpponentPanel;
  private connection: ServerConnection;
  private isConnected = true;
  /**
   * Server-Nachrichten werden der Reihe nach verarbeitet; eine Runde wartet, bis ihre Animation fertig ist.
   * Die erste wartet, bis alle Assets geladen sind.
   */
  private inbox: Promise<void>;
  private isResolving = false;

  private selection: Selection | null = null;
  /** Kurzer Hinweis vor dem Planungstext, was der letzte Klick bewirkt hat (die Fähigkeit ersetzt das Manöver …). */
  private notice: string | null = null;
  /** Der gewählte Admiral, bis der Server ihn bestätigt. */
  private pendingAdmiral: AdmiralId | null = null;
  private hoveredPad: SlotPad | null = null;
  private ghostPads: SlotPad[] = [];
  private validTargetCount = 0;
  /** Die Zielvorschau des eingeplanten Zugs; null, solange keine Runde geplant wird. */
  private preview: RoundPreview | null = null;
  /** Eigene Kriegsschiffe auf Brett und Hand beim letzten Zustand, für die Meldung, dass nur noch eines übrig ist. */
  private warships = 0;

  constructor(canvas: HTMLCanvasElement, ui: HTMLElement) {
    this.view = new MatchScene(canvas, this.match.board);
    const floats = new FloatingTexts(ui);
    this.hud = new Hud(ui);
    this.playback = new RoundPlayback(this.view, this.hud, floats);
    // Vor der Hand im DOM, damit vergrößerte Karten über der Admiralswahl liegen.
    this.admiralSelect = new AdmiralSelect(ui, (admiral) => this.chooseAdmiral(admiral));
    this.resultScreen = new ResultScreen(ui, () => this.startNewMatch());
    installFullscreen(ui);
    new SettingsDialog(ui);
    new RulesDialog(ui);
    this.opponentPanel = new OpponentPanel(ui);
    new RadioSubtitle(ui);
    this.surrenderDialog = new SurrenderDialog(ui, () => this.connection.send({ type: "surrender" }));
    this.powerCard = new PowerCard(
      () => this.onPowerClick(),
      () => this.onMarkClick(),
    );
    this.hand = new HandView(ui, [this.hud.submitButton, this.hud.skipButton, this.hud.botButton, this.hud.checklist], this.powerCard.element, {
      onShipCardClick: (pick) => this.onShipCardClick(pick),
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

  /** Der erste Zustand des neuen Matches überschreibt Brett, Hände, Admirale und Ergebnis; die Admiralswahl erscheint wieder. */
  private startNewMatch(): void {
    this.connection.close();
    this.isConnected = true;
    this.pendingAdmiral = null;
    this.connection = this.connect(true);
  }

  /** Geplant wird, sobald beide ihren Admiral haben, solange der Zug dieser Runde offen und das Match nicht entschieden ist. */
  private get canPlan(): boolean {
    return this.isConnected && this.match.round > 0 && this.match.admiralsChosen && !this.match.submitted && this.match.result === null;
  }

  // --- Server ---

  private async onServerMessage(message: ServerMessage): Promise<void> {
    switch (message.type) {
      case "state": {
        // Runde 1 versteht sich von selbst, ebenso der erste Zustand nach dem Laden der Seite.
        const isNewRound = this.match.round > 0 && message.view.round > this.match.round && message.view.result === null;
        const before = { opponent: this.match.opponent, result: this.match.result };
        this.match.apply(message.view);
        if (this.match.admiral !== null) this.pendingAdmiral = null;
        setMusicMood(this.match.result === null ? "calm" : null);
        this.selection = null;
        this.notice = null;
        this.syncBoard();
        this.refreshSelectionVisuals();
        this.resultScreen.show(this.match.result, this.match.round, this.match.surrendered, this.flagshipNames());
        if (isNewRound) this.hud.showRoundBanner(this.match.round);
        this.reportByRadio(before, isNewRound);
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

  /** Die Namen beider Flaggschiffe für das Ergebnis; vor der Admiralswahl gibt es keine. */
  private flagshipNames(): { own: string; enemy: string } {
    const name = (admiral: AdmiralId | null | undefined) => (admiral ? t.ships[ADMIRALS[admiral].flagship].name : "");
    return { own: name(this.match.admiral), enemy: name(this.match.opponent?.admiral) };
  }

  /** Einmal vor Runde 1, auch solange der Gegner fehlt; bis zur Bestätigung bleibt die Wahl gesperrt. */
  private chooseAdmiral(admiral: AdmiralId): void {
    if (this.pendingAdmiral !== null || this.match.admiral !== null || !this.isConnected) return;
    this.pendingAdmiral = admiral;
    this.connection.send({ type: "chooseAdmiral", admiral });
    playUiSound("confirm");
    this.updateHud();
  }

  // --- Hand ---

  private onShipCardClick(pick: ShipPick): void {
    this.notice = null;
    if (!this.canPlan) return playUiSound("denied");
    if (this.match.arrivals.some((arrival) => arrival.pick === pick)) {
      this.unplanShip(pick);
    } else if (this.selection?.kind === "ship" && this.selection.pick === pick) {
      this.select(null);
      playUiSound("cancel");
    } else {
      this.select({ kind: "ship", pick });
      playUiSound("select");
    }
  }

  /** Befehle ohne Zielwahl sind mit einem Klick eingeplant, sonst folgt der Klick auf ein eigenes Schiff. */
  private onCommandCardClick(index: number): void {
    this.notice = null;
    if (!this.canPlan) return playUiSound("denied");
    const card = this.match.commandHand[index]!;
    if (this.match.plan.command?.handIndex === index) {
      this.match.plan.command = null;
      this.select(null);
      playUiSound("cancel");
    } else if (this.selection?.kind === "command" && this.selection.index === index) {
      this.select(null);
      playUiSound("cancel");
    } else if (needsTarget(card)) {
      this.select({ kind: "command", index, moveSource: null });
      playUiSound("select");
    } else {
      this.match.plan.command = { handIndex: index, target: null, destination: null };
      this.select(null);
      playUiSound("place");
    }
  }

  /** Die Fähigkeitskarte: startet die Zielwahl; ein weiterer Klick bricht sie ab bzw. nimmt die eingeplante Fähigkeit zurück. */
  private onPowerClick(): void {
    this.notice = null;
    if (!this.canPlan) return playUiSound("denied");
    if (this.match.plan.power !== null) return this.cancelPower();
    if (this.selection?.kind === "power") {
      this.select(null);
      return playUiSound("cancel");
    }
    if (this.match.powerTargets.length === 0) {
      const name = t.powers[this.match.power!].name;
      this.notice = this.match.power === "swarm_strike" ? t.status.noDrone(name) : t.status.noPowerTarget(name);
      this.updateHud();
      return playUiSound("denied");
    }
    this.select({ kind: "power" });
    playUiSound("select");
  }

  /** Der Knopf der Zielerfassung: wie die Fähigkeitskarte, aber für das Ziel der Railgun in der nächsten Runde. */
  private onMarkClick(): void {
    this.notice = null;
    if (!this.canPlan || !this.match.canMark) return playUiSound("denied");
    if (this.match.plan.mark !== null) {
      this.match.plan.mark = null;
      this.select(null);
      return playUiSound("cancel");
    }
    if (this.selection?.kind === "mark") {
      this.select(null);
      return playUiSound("cancel");
    }
    if (this.match.markTargets.length === 0) return playUiSound("denied");
    this.select({ kind: "mark" });
    playUiSound("select");
  }

  /** Höchstens eine Auswahl wartet auf das Brett; jede neue ersetzt die alte. */
  private select(selection: Selection | null): void {
    this.selection = selection;
    this.refreshSelectionVisuals();
  }

  private get selectedCommand(): CommandCard | null {
    return this.selection?.kind === "command" ? this.match.commandHand[this.selection.index]! : null;
  }

  /** Nimmt ein eingeplantes Schiff zurück, samt Befehl und Fähigkeit auf dieses Schiff; ein angefangener Lane-Wechsel des Schiffs bricht ab. */
  private unplanShip(pick: ShipPick): void {
    const selection = this.selection;
    const moving = selection?.kind === "command" && selection.moveSource !== null && this.match.plannedPickAt(selection.moveSource) === pick;
    this.match.unplanShip(pick);
    this.select(moving || selection?.kind === "ship" ? null : selection);
    playUiSound("cancel");
  }

  private cancelManeuver(): void {
    this.match.plan.maneuver = null;
    this.refreshSelectionVisuals();
    playUiSound("cancel");
  }

  private cancelPower(): void {
    this.match.plan.power = null;
    this.select(null);
    playUiSound("cancel");
  }

  /**
   * Escape bricht eine angefangene Auswahl ab, sonst nimmt es das eingeplante Manöver bzw. die Fähigkeit zurück,
   * zuletzt die Zielerfassung. Offene Dialoge gehen vor.
   */
  private onKeyDown(event: KeyboardEvent): void {
    if (event.key !== "Escape" || !this.canPlan || document.querySelector("dialog[open]") !== null) return;
    this.notice = null;
    const { plan } = this.match;
    if (this.selection !== null) {
      this.select(null);
      playUiSound("cancel");
    } else if (plan.maneuver !== null) {
      this.cancelManeuver();
    } else if (plan.power !== null) {
      this.cancelPower();
    } else if (plan.mark !== null) {
      plan.mark = null;
      this.refreshSelectionVisuals();
      playUiSound("cancel");
    }
  }

  // --- Brett ---

  /**
   * Das Brett zeigt den Zeiger nur, solange etwas gewählt ist; ohne Auswahl startet ein Klick das Grundmanöver.
   * `pickInfo` wird erst beim Zugriff berechnet. Geklickt wird beim Loslassen, damit Ziehen die Kamera verschiebt,
   * ohne Karten zu platzieren. Ein Doppelklick auf eine freie Stelle schaltet das Vollbild um.
   */
  private onScenePointer(info: PointerInfo): void {
    if (info.type === PointerEventTypes.POINTERMOVE) {
      this.setHoveredPad(this.selection !== null ? pickedPad(info) : null);
    } else if (info.type === PointerEventTypes.POINTERUP && info.event.button === 0 && !this.view.wasPanned) {
      this.notice = null;
      if (this.selection !== null) this.onBoardClick(pickedPad(info));
      else if (this.canPlan && !this.isResolving) this.onShipClick(pickedPad(info));
    } else if (info.type === PointerEventTypes.POINTERDOUBLETAP && info.event.button === 0 && pickedPad(info) === null) {
      toggleFullscreen();
    }
  }

  private onBoardClick(pad: SlotPad | null): void {
    const selection = this.selection!;
    // Daneben oder erneut auf das Manöver-Schiff: Die Auswahl bricht ab.
    if (pad === null || (selection.kind === "maneuver" && pad.slot === selection.source)) {
      this.select(null);
      return playUiSound("cancel");
    }
    if (!this.isValidTarget(pad)) return playUiSound("denied");
    switch (selection.kind) {
      case "ship":
        return this.stageShipOn(selection.pick, pad);
      case "maneuver":
        return this.stageManeuverOn(selection.source, pad);
      case "command":
        return this.stageCommandTargetOn(selection, pad);
      case "power":
        return this.stagePowerOn(pad);
      case "mark":
        return this.stageMarkOn(pad);
    }
  }

  /**
   * Ohne Auswahl: Ein Klick auf ein eigenes Schiff beginnt das Grundmanöver, einer auf das manövrierende Schiff
   * oder seinen Geist (auch beim Phasentausch) nimmt es zurück, einer auf den Geist eines eingeplanten Schiffs nimmt
   * dieses zurück, einer auf das Trugbild die Fähigkeit. Leere Slots und der Geist eines Bewegungsbefehls reagieren nicht.
   */
  private onShipClick(pad: SlotPad | null): void {
    if (pad === null || pad.slot.lane.side === "enemy") return;
    const maneuver = this.match.plannedManeuver;
    if (maneuver !== null && (pad.slot === maneuver.from || pad.slot === maneuver.to)) return this.cancelManeuver();
    const decoy = this.match.plannedDecoy;
    if (decoy && isSameSlot(decoy, slotTarget(pad.slot))) return this.cancelPower();
    const pick = this.match.plannedPickAt(pad.slot);
    if (pick !== null) return this.unplanShip(pick);
    if (!pad.slot.isOccupied) return;
    if (this.match.maneuverDestinations(pad.slot).length === 0) return playUiSound("denied");
    this.select({ kind: "maneuver", source: pad.slot });
    playUiSound("select");
  }

  /**
   * Einzige Gültigkeitsregel für Highlight und Klick: gewähltes Schiff -> freie eigene Slots, die den eingeplanten
   * Bewegungen nicht im Weg stehen; Manöver-Schiff -> seine Ziel-Slots in beiden Lanes (bei der Mirage auch eigene
   * Schiffe); gewählter Befehl -> eigene Schiffe in einer erlaubten Lane, auch das eingeplante, bei verlegenden
   * Befehlen nur mit freiem Ziel-Slot, danach die freien Slots der anderen Lane; der Torpedo -> jeder Slot der
   * Gegnerseite; Fähigkeit und Zielerfassung -> ihre Ziele aus `shared/powers.ts`. Ohne Auswahl leuchten nur das
   * bereits gewählte eigene Befehlsziel, die Ziel-Slots und das manövrierende Schiff weiter, bis die Runde aufgelöst
   * wird; den Zielslot des Torpedos zeigt das Fadenkreuz, die Ziele von Fähigkeit und Zielerfassung ihre Marke.
   */
  private isValidTarget(pad: SlotPad): boolean {
    if (this.isResolving) return false;
    const { slot } = pad;
    const own = slot.lane.side === "player";
    const selection = this.selection;
    switch (selection?.kind) {
      case "power":
        return this.match.powerTargets.some((ref) => this.padOf(ref) === pad);
      case "mark":
        return this.match.markTargets.some((ref) => this.padOf(ref) === pad);
      case "ship":
        return own && this.match.canDeploy(slot, selection.pick);
      case "maneuver":
        return own && this.match.maneuverDestinations(selection.source).includes(slot);
      case "command": {
        const command = this.selectedCommand!;
        if (targetsEnemySlot(command)) return !own;
        if (!own) return false;
        if (selection.moveSource !== null) return this.match.commandMoveDestinations(selection.moveSource).includes(slot);
        if (this.match.shipAt(slot) === null || !canTargetLane(command, slot.lane.type)) return false;
        return !command.moves || this.match.commandMoveDestinations(slot).length > 0;
      }
      default: {
        if (!own) return false;
        const target = this.match.plannedEnemyTarget ? null : this.match.plan.command?.target;
        const maneuver = this.match.plannedManeuver;
        return (target != null && isSameSlot(target, slotTarget(slot))) || this.match.plannedCommandMove?.to === slot || maneuver?.from === slot || maneuver?.to === slot;
      }
    }
  }

  /** Plant das Schiff auf den Slot; bis zur Auflösung steht es dort nur als Geist. */
  private stageShipOn(pick: ShipPick, pad: SlotPad): void {
    this.match.planShip(pick, slotTarget(pad.slot));
    this.select(null);
    playUiSound("place");
  }

  /** Plant das Grundmanöver; es ersetzt die Fähigkeit. Das Schiff steht bis zur Auflösung als Geist im Ziel-Slot. */
  private stageManeuverOn(source: Slot, pad: SlotPad): void {
    const { plan } = this.match;
    if (plan.power !== null) this.notice = t.status.maneuverReplacesPower(t.powers[this.match.power!].name);
    plan.maneuver = { ship: slotTarget(source), destination: slotTarget(pad.slot) };
    plan.power = null;
    this.select(null);
    playUiSound("place");
  }

  /** Verlegende Befehle merken sich erst das Schiff und werden mit dem Ziel-Slot eingeplant. */
  private stageCommandTargetOn(selection: Extract<Selection, { kind: "command" }>, pad: SlotPad): void {
    const card = this.match.commandHand[selection.index]!;
    if (card.moves && selection.moveSource === null) {
      this.select({ ...selection, moveSource: pad.slot });
      return playUiSound("select");
    }
    const target = selection.moveSource ?? pad.slot;
    this.match.plan.command = {
      handIndex: selection.index,
      target: slotTarget(target),
      destination: selection.moveSource && pad.slot.index,
    };
    this.select(null);
    playUiSound("place");
  }

  /** Plant die Admiralsfähigkeit auf das Ziel; sie ersetzt das Grundmanöver. */
  private stagePowerOn(pad: SlotPad): void {
    const { plan } = this.match;
    const replaced = this.match.plannedManeuver;
    if (replaced !== null) this.notice = t.status.powerReplacesManeuver(t.powers[this.match.power!].name, cardText(replaced.from.card!).name);
    plan.power = { target: slotTarget(pad.slot) };
    plan.maneuver = null;
    this.select(null);
    playUiSound("place");
  }

  /** Die Zielerfassung kommt zum Zug dazu, ohne etwas zu ersetzen. */
  private stageMarkOn(pad: SlotPad): void {
    this.match.plan.mark = slotTarget(pad.slot);
    this.select(null);
    playUiSound("place");
  }

  /**
   * Stellt die Geister dorthin, wo sie laut `ghostTargets` stehen sollen; stehen sie schon richtig, bleiben sie.
   * Die Pfeile der Bewegungen folgen den Geistern der verlegten Schiffe. Danach kommen die Marken und die
   * Zielvorschau dazu, die auch an den Geistern hängen.
   */
  private refreshGhosts(): void {
    const maneuver = this.shownManeuver();
    const swap = maneuver?.to.slot.isOccupied ? maneuver : null;
    showArrow(this.view.moveArrow, this.shownCommandMove());
    showArrow(this.view.maneuverArrow, maneuver);
    showArrow(this.view.swapArrow, swap && { from: swap.to, to: swap.from });
    this.view.reticle.show(this.shownEnemyTarget());

    const targets = this.ghostTargets();
    const unchanged =
      targets.length === this.ghostPads.length &&
      targets.every((target, index) => target.pad === this.ghostPads[index] && target.card === target.pad.ghost?.card);
    if (!unchanged) {
      this.clearGhosts();
      for (const { pad, card } of targets) pad.attachGhost(new ShipView(this.view.scene, card, true));
      this.ghostPads = targets.map((target) => target.pad);
    }
    this.refreshMarkers();
    this.showPreview();
  }

  /**
   * Beim Platzieren zeigt der Geist den Slot unter dem Zeiger, sonst das eingeplante Schiff (auch das Flaggschiff).
   * Ebenso stehen die verlegten Schiffe beim Wählen des Ziel-Slots unter dem Zeiger, sonst auf dem
   * eingeplanten Ziel-Slot (siehe `shownMove`); beim Phasentausch steht auch der Tauschpartner als Geist im Slot der
   * Mirage. Das Trugbild steht als Geist im gewählten Strike-Slot. Die Drohnen, die eingeplante Titan Carrier laut
   * Zielvorschau starten, stehen zuerst in der Liste: Ein Geist unter dem Zeiger auf ihrem Slot verdrängt sie.
   */
  private ghostTargets(): { pad: SlotPad; card: ShipCard }[] {
    if (this.isResolving) return [];
    const ghosts = (this.preview?.drones ?? []).map((drone) => ({ pad: this.padOf(drone), card: shipById("drone") }));
    const hovered = this.validHoveredPad();
    const placing = this.selection?.kind === "ship" && hovered !== null ? this.selection.pick : null;
    for (const { pick, target } of placing !== null ? this.match.keptArrivals(placing) : this.match.arrivals) {
      ghosts.push({ pad: this.view.pad("player", target.lane, target.slotIndex), card: this.match.cardOf(pick) });
    }
    if (placing !== null) ghosts.push({ pad: hovered!, card: this.match.cardOf(placing) });
    for (const move of [this.shownCommandMove(), this.shownManeuver()]) {
      if (move === null) continue;
      ghosts.push({ pad: move.to, card: this.match.shipAt(move.from.slot)! });
      if (move.to.slot.isOccupied) ghosts.push({ pad: move.from, card: move.to.slot.card! });
    }
    const decoy = this.shownDecoy();
    if (decoy) ghosts.push({ pad: decoy, card: shipById("decoy") });
    return ghosts;
  }

  /** Der Slot unter dem Zeiger, sofern er für die Auswahl ein gültiges Ziel ist. */
  private validHoveredPad(): SlotPad | null {
    return this.hoveredPad !== null && this.isValidTarget(this.hoveredPad) ? this.hoveredPad : null;
  }

  /** Das Fadenkreuz steht beim Wählen auf dem Slot unter dem Zeiger, sonst auf dem eingeplanten Zielslot des Torpedos. */
  private shownEnemyTarget(): SlotPad | null {
    if (this.isResolving) return null;
    const command = this.selectedCommand;
    if (command && targetsEnemySlot(command)) return this.validHoveredPad();
    const target = this.match.plannedEnemyTarget;
    return target && this.view.pad("enemy", target.lane, target.slotIndex);
  }

  private shownCommandMove(): { from: SlotPad; to: SlotPad } | null {
    const selection = this.selection?.kind === "command" ? this.selection : null;
    return this.shownMove(selection?.moveSource ?? null, this.match.plannedCommandMove, selection !== null);
  }

  private shownManeuver(): { from: SlotPad; to: SlotPad } | null {
    return this.shownMove(this.selection?.kind === "maneuver" ? this.selection.source : null, this.match.plannedManeuver, false);
  }

  /**
   * Eine Bewegung, wie Geist und Pfeil sie zeigen: beim Wählen (`source`) zum Slot unter dem Zeiger,
   * sonst der eingeplante, solange er nicht gerade neu gewählt wird.
   */
  private shownMove(source: Slot | null, planned: PlannedMove | null, isReplanning: boolean): { from: SlotPad; to: SlotPad } | null {
    if (this.isResolving) return null;
    const padOf = (slot: Slot) => this.view.pad("player", slot.lane.type, slot.index);
    if (source !== null) {
      const hovered = this.validHoveredPad();
      return hovered && { from: padOf(source), to: hovered };
    }
    if (isReplanning || planned === null) return null;
    return { from: padOf(planned.from), to: padOf(planned.to) };
  }

  /** Das Trugbild steht beim Wählen im Slot unter dem Zeiger, sonst im eingeplanten. */
  private shownDecoy(): SlotPad | null {
    if (this.match.power !== "decoy") return null;
    if (this.selection?.kind === "power") return this.validHoveredPad();
    const decoy = this.match.plannedDecoy;
    return decoy && this.view.pad("player", decoy.lane, decoy.slotIndex);
  }

  /**
   * Die Marken am Boden: die Zielerfassung der Railgun, wie sie auf dem Brett steht (auf beiden Seiten), dazu beim
   * Planen die eigene Fähigkeit und die eigene Zielerfassung, beim Wählen auf dem Ziel unter dem Zeiger. Die Marke
   * einer Fähigkeit liegt auf dem Schiff, das nach den Bewegungen dort steht: auf dem Geist eines eingeplanten
   * Schiffs, auf ein verlegtes eigenes Schiff folgt sie ihm. In der Auflösung setzt die Wiedergabe die Marken.
   */
  private refreshMarkers(): void {
    if (this.isResolving) return;
    const markers = new Map<ShipView, MarkerSpec[]>();
    const add = (ship: ShipView | null, spec: MarkerSpec) => {
      if (ship) markers.set(ship, [...(markers.get(ship) ?? []), spec]);
    };
    for (const pad of this.view.pads) if (pad.slot.marked) add(pad.ship, { kind: "lock", color: KERR });
    const selection = this.selection;
    const power = this.match.power;
    const powerTarget = selection?.kind === "power" ? this.validHoveredPad() : this.match.plannedPowerTarget && this.padOf(this.match.plannedPowerTarget);
    if (power !== null && power !== "decoy" && powerTarget) {
      const move = this.shownCommandMove();
      const holder = move?.from === powerTarget ? move.to.ghost : (powerTarget.ghost ?? powerTarget.ship);
      add(holder, { kind: power, color: color3(powerAdmiral(power)) });
    }
    const mark = this.match.plan.mark;
    const lockTarget = selection?.kind === "mark" ? this.validHoveredPad() : mark && this.view.pad("enemy", mark.lane, mark.slotIndex);
    if (lockTarget) add(lockTarget.ship, { kind: "lock", color: KERR, planned: true });
    for (const pad of this.view.pads) {
      pad.ship?.setMarkers(markers.get(pad.ship) ?? []);
      pad.ghost?.setMarkers(markers.get(pad.ghost) ?? []);
    }
  }

  /** Rechnet die Zielvorschau neu, sobald sich Brett oder Plan ändern; während der Auflösung und nach Spielende gibt es keine. */
  private updatePreview(): void {
    const planning = !this.isResolving && this.match.round > 0 && this.match.admiralsChosen && this.match.result === null;
    this.preview = planning ? previewRound(this.match) : null;
  }

  /**
   * Die Zielvorschau auf dem Brett: Bögen der Schüsse, auf den Balken der drohende Verlust und ein Totenkopf an
   * jedem Schiff, das fallen würde, auch an Geistern. Ein Schiff, das sich bewegt, steht dabei schon im Ziel-Slot;
   * den Totenkopf trägt, wer nach den Bewegungen im Slot steht — der Geist, sonst das echte Schiff.
   */
  private showPreview(): void {
    const preview = this.preview;
    const shots = preview?.shots ?? [];
    this.view.targetLines.show(shots.map(({ attacker, target }) => ({ from: this.padOf(attacker), to: this.padOf(target), side: attacker.side })));
    const losses = new Set(preview?.losses.map((ref) => this.padOf(ref)));
    for (const pad of this.view.pads) {
      pad.ghost?.setDoomed(losses.has(pad));
      pad.ship?.setDoomed(losses.has(pad) && pad.ghost === null);
      pad.ship?.setPreview(preview?.outcomes.get(pad.slot));
    }
  }

  private padOf(ref: SlotRef): SlotPad {
    return this.view.pad(ref.side, ref.lane, ref.slotIndex);
  }

  /** Das manövrierende Schiff feuert nicht und zeigt das mit gedämpften Balken, beim Phasentausch nicht; in der Auflösung setzt sie die Wiedergabe. */
  private refreshHoldFire(): void {
    if (this.isResolving) return;
    const maneuver = this.match.plannedSwap ? null : this.match.plannedManeuver;
    const maneuvering = this.selection?.kind === "maneuver" ? this.selection.source : (maneuver?.from ?? null);
    for (const pad of this.view.pads) pad.ship?.setHoldingFire(pad.slot === maneuvering);
  }

  private clearGhosts(): void {
    for (const pad of this.ghostPads) pad.clearGhost();
    this.ghostPads = [];
  }

  // --- Runde ---

  private submit(): void {
    if (!this.canPlan || this.match.opponent === null || this.match.flagshipMissing) return;
    this.connection.send({ type: "submit", plan: this.match.plan });
    playUiSound("confirm");
    say("orders_sent");
  }

  /**
   * Was der Bordfunk zwischen den Runden meldet: den Gefechtsbeginn, sobald beide Admirale feststehen, den Overdrive,
   * das letzte eigene Kriegsschiff, dass der Gegner seinen Zug beendet hat, und zuletzt den Ausgang des Matches.
   */
  private reportByRadio(before: { opponent: OpponentView | null; result: MatchResult | null }, isNewRound: boolean): void {
    const { match } = this;
    const warships = match.warships;
    const lostTheLast = warships === 1 && this.warships > 1;
    this.warships = warships;
    if (match.result !== null) {
      if (before.result === null) setTimeout(() => say(resultCue(match.result!, match.surrendered)), RESULT_REPORT_DELAY);
      return;
    }
    if (!before.opponent?.admiral && match.opponent?.admiral && match.round === 1) say("battle_start");
    const overdrive = overdriveBonus(match.round);
    if (isNewRound && overdrive > overdriveBonus(match.round - 1)) say(overdrive === 1 ? "overdrive" : "overdrive_up");
    if (lostTheLast) say("last_ship");
    if (!before.opponent?.submitted && match.opponent?.submitted && !match.submitted) say("enemy_ready");
  }

  /** Szene an den neuen Zustand angleichen (auch Schiffe, die die Lane gewechselt haben); die Geister kommen zuletzt. */
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
    this.updatePreview();
    this.refreshGhosts();
  }

  // --- Darstellung ---

  /** Die Hand samt Fähigkeitskarte; diese zuerst, weil die Hand ihren Platz mit ihr teilt. */
  private refreshHand(): void {
    const { match, selection } = this;
    this.powerCard.show(this.powerCardView());
    const shipMarks = new Set<ShipPick>(match.arrivals.map((arrival) => arrival.pick));
    if (selection?.kind === "ship") shipMarks.add(selection.pick);
    this.hand.renderShips(match.shipHand, match.needsFlagship ? match.flagship : null, shipMarks);

    const commandMarks = new Set<number>();
    if (selection?.kind === "command") commandMarks.add(selection.index);
    if (match.plan.command) commandMarks.add(match.plan.command.handIndex);
    this.hand.renderCommands(match.commandHand, commandMarks);
  }

  private refreshSelectionVisuals(): void {
    this.refreshHand();
    this.validTargetCount = 0;
    for (const pad of this.view.pads) {
      const valid = this.isValidTarget(pad);
      pad.setValidTarget(valid);
      if (valid) this.validTargetCount += 1;
    }
    // Das Gitter zeigt sich, solange ein freier Slot gesucht wird: beim Legen, für einen Lane-Wechsel, ein Manöver oder das Trugbild.
    const selection = this.selection;
    const choosingSlot =
      selection?.kind === "ship" ||
      selection?.kind === "maneuver" ||
      (selection?.kind === "command" && selection.moveSource !== null) ||
      (selection?.kind === "power" && this.match.power === "decoy");
    this.view.setGridVisible(choosingSlot);
    this.updatePreview();
    this.refreshGhosts();
    this.refreshHoldFire();
    this.updateHud();
  }

  private updateHud(): void {
    const { match } = this;
    this.hud.setRound(match.round);
    this.hud.setOverdrive(overdriveBonus(match.round));
    this.hud.setStatus(this.buildStatusText());
    // Solange kein Gegner da ist, bietet der Knopf den Computergegner an.
    const waitingForOpponent = this.isConnected && match.round > 0 && match.opponent === null;
    this.hud.showAction(this.isResolving ? "skip" : waitingForOpponent ? "bot" : "submit");
    this.hud.submitButton.disabled = !this.canPlan || match.opponent === null || match.flagshipMissing;
    this.hud.submitButton.textContent = match.submitted ? t.hud.waiting : t.hud.endTurn;
    const planning = !this.isResolving && this.canPlan && match.opponent !== null;
    this.hud.setChecklist(planning ? match.turnProgress : null, { planned: match.plan.ships.length, max: maxDeploys(match.round) });
    this.admiralSelect.show(this.isConnected && match.round > 0 && match.admiral === null && match.result === null, this.pendingAdmiral);
    this.surrenderDialog.setAvailable(this.isConnected && match.opponent !== null && match.result === null);
    this.opponentPanel.show(match.opponent, match.admiral !== null);
  }

  /** Fähigkeitskarte und Zielerfassung, sobald der eigene Admiral feststeht. */
  private powerCardView(): PowerCardView | null {
    const { match, selection } = this;
    if (match.admiral === null) return null;
    const planning = this.canPlan && !this.isResolving;
    const state = (planned: boolean, selecting: boolean, possible: boolean): PowerState =>
      planned ? "planned" : selecting ? "selecting" : planning && possible ? "open" : "blocked";
    const power = state(match.plan.power !== null, selection?.kind === "power", match.powerTargets.length > 0);
    if (match.admiral !== "kerr") return { admiral: match.admiral, power, lock: null };
    const railgun = match.railgunTarget;
    if (railgun) return { admiral: match.admiral, power, lock: { railgun: t.hud.railgun(cardText(railgun.card!).name), warning: match.pendulumMoves ? t.hud.shotLost : null } };
    if (!match.canMark) return { admiral: match.admiral, power, lock: null };
    const mark = match.plan.mark;
    const marked = mark && this.view.pad("enemy", mark.lane, mark.slotIndex).slot.card;
    return {
      admiral: match.admiral,
      power,
      lock: {
        state: state(mark !== null, selection?.kind === "mark", match.markTargets.length > 0),
        label: marked ? t.hud.marked(cardText(marked).name) : t.hud.markButton,
        warning: mark !== null && match.pendulumMoves ? t.hud.lockLost : null,
      },
    };
  }

  private buildStatusText(): string {
    const { match } = this;
    if (!this.isConnected) return t.status.disconnected;
    if (match.round === 0) return t.status.connecting;
    if (this.isResolving) return t.status.resolving;
    if (match.result !== null) return t.status.matchOver;
    if (match.admiral === null) return t.status.chooseAdmiral(match.opponent === null ? this.shareLink() : null);
    if (match.opponent === null) return t.status.waitingForOpponent(this.shareLink());
    if (match.opponent.admiral === null) return t.status.opponentChoosing;
    if (match.submitted) return t.status.submitted;
    const fleet = t.status.fleet(match.board.shipCount("player"), MAX_SHIPS_PER_SIDE);
    // Aufstellung: Solange mehr als ein Schiff erlaubt ist, steht dabei, wie viele noch gelegt werden dürfen.
    const deploys = maxDeploys(match.round) > 1 ? ` · ${t.status.deploysLeft(match.deploysLeft)}` : "";
    return `${fleet}${deploys} — ${this.notice ? `${this.notice} ` : ""}${this.buildPlanningText()}`;
  }

  /** Der Match-Link ohne `?lang=`, damit der Gegner seine eigene Sprache bekommt. */
  private shareLink(): string {
    const url = new URL(location.href);
    url.searchParams.delete("lang");
    return url.href;
  }

  private buildPlanningText(): string {
    const { match, selection } = this;
    switch (selection?.kind) {
      case "maneuver": {
        const name = cardText(selection.source.card!).name;
        return selection.source.card!.id === "mirage" ? t.status.chooseSwap(name) : t.status.chooseManeuver(name);
      }
      case "ship": {
        const name = cardText(match.cardOf(selection.pick)).name;
        if (this.validTargetCount === 0) return t.status.noFreeSlot(name, MAX_SHIPS_PER_LANE, MAX_SHIPS_PER_SIDE);
        return t.status.placeShip(name);
      }
      case "command": {
        const command = this.selectedCommand!;
        const name = cardText(command).name;
        if (targetsEnemySlot(command)) return t.status.chooseEnemySlot(name);
        if (selection.moveSource !== null) return t.status.chooseDestination(name, cardText(match.shipAt(selection.moveSource)!).name);
        if (this.validTargetCount === 0) return t.status.noCommandTarget(name);
        return t.status.chooseCommandTarget(name);
      }
      case "power":
        return t.status.choosePowerTarget(t.powers[match.power!].name);
      case "mark":
        return t.status.chooseMark;
    }
    if (match.flagshipMissing) return t.status.flagshipFirst(cardText(match.flagship!).name);
    const cards = [...match.arrivals.map((arrival) => match.cardOf(arrival.pick)), match.plannedCommand].filter((card) => card !== null);
    const planned = cards.map((card) => cardText(card).name);
    const maneuver = match.plannedManeuver;
    const swap = match.plannedSwap;
    if (swap !== null) planned.push(t.status.swap(cardText(swap.from.card!).name, cardText(swap.to.card!).name));
    else if (maneuver !== null) planned.push(t.status.maneuver(cardText(maneuver.from.card!).name));
    const power = match.plannedPowerTarget;
    if (power !== null) planned.push(t.status.power(t.powers[match.power!].name, this.targetLabel(power)));
    const mark = match.plan.mark;
    if (mark !== null) planned.push(t.status.mark(cardText(this.view.pad("enemy", mark.lane, mark.slotIndex).slot.card!).name));
    if (planned.length > 0) return t.status.planned(planned.join(" + "));
    return t.status.idle;
  }

  /** Das Ziel einer Fähigkeit in Worten: das Schiff dort, auch ein eingeplantes, beim Trugbild der Slot. */
  private targetLabel(ref: SlotRef): string {
    const pad = this.padOf(ref);
    const ship = ref.side === "player" ? this.match.shipAt(pad.slot) : pad.slot.card;
    return ship ? cardText(ship).name : slotLabel(ref);
  }

  private setHoveredPad(pad: SlotPad | null): void {
    if (pad === this.hoveredPad) return;
    this.hoveredPad?.setHovered(false);
    this.hoveredPad = pad;
    this.hoveredPad?.setHovered(true);
    this.refreshGhosts();
  }
}

/** Der Funkspruch zum Ausgang; nach einer Aufgabe meldet er den Rückzug. */
function resultCue(result: MatchResult, surrendered: boolean): RadioCue {
  if (result === "draw") return "draw";
  if (result === "won") return surrendered ? "enemy_surrender" : "victory";
  return surrendered ? "retreat" : "defeat";
}

function showArrow(arrow: MoveArrow, move: { from: SlotPad; to: SlotPad } | null): void {
  if (move === null) arrow.hide();
  else arrow.show(move.from, move.to);
}
