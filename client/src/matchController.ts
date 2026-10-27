// Verbindet Server, Spielzustand, 3D-Szene und DOM-UI zur Zugplanung:
// Vor Runde 1 wählt der Spieler seinen Admiral (`ui/admiralSelect.ts`); geplant wird erst, wenn beide gewählt haben.
// Der Spieler stellt seinen Zug zusammen (1 Schiff, in Runde 1 zwei samt Flaggschiff, + 1 Befehl), die gewählten
// Schiffe stehen als Geister auf ihren Slots, der gewählte Befehl bleibt markiert. Ein Klick auf die Karte eines
// eingeplanten Schiffs nimmt genau dieses Schiff zurück; ohne Flaggschiff geht „Zug beenden“ in Runde 1 nicht.
// Beim Platzieren folgt der Geist dem Zeiger über die freien Slots. Die Geister der geplanten
// Schiffe sind für Befehle Ziele wie jedes andere eigene Schiff. Befehle, die
// ein Schiff in die andere Lane verlegen, brauchen zwei Klicks: Schiff, dann Ziel-Slot;
// dort steht das verlegte Schiff ebenfalls als Geist, ein Bogenpfeil zeigt den Weg.
// Ist keine Karte gewählt, wählt ein Klick ein eigenes Schiff auf dem Brett oder einen Geist (eingeplantes oder
// bewegtes Schiff). Kann es feuern, leuchten alle gegnerischen Schiffe als Ziel, auch gedeckte: Ein Klick gibt ihm den
// Feuerbefehl oder ersetzt ihn, ein Klick auf das jetzige Ziel hebt ihn auf, das Schiff bleibt dabei gewählt. Ohne
// Feuerbefehl feuert kein Schiff, und jede Runde beginnt ohne. Steht das Schiff schon auf dem Brett, leuchten dazu die
// Ziel-Slots des Grundmanövers (Geist und Pfeil); dann feuert es nicht, seine Balken sind gedämpft und sein
// Feuerbefehl fällt weg. Die Mirage darf auch auf ein eigenes Schiff: Beim Phasentausch stehen beide als Geist über
// dem anderen, je mit Pfeil, und beide feuern. Ein Klick auf ein anderes eigenes Schiff wählt dieses; ein zweiter
// Klick auf das gewählte (oder seinen Geist) nimmt zurück, was es in dieser Runde bringt oder bewegt — das eingeplante
// Schiff bzw. das Manöver —, sonst endet die Auswahl wie mit Escape oder einem Klick neben das Brett. Escape ohne
// Auswahl nimmt das Manöver zurück.
// Statt des Manövers geht die Admiralsfähigkeit (`ui/powerCard.ts`): Ihre Karte startet die Zielwahl, das Ziel
// trägt danach ihre Marke (`scene/markers.ts`), das Trugbild steht als Geist im Slot; wer das eine plant, verliert
// das andere, und die Statuszeile sagt es. Admiral Kerr erfasst mit dem Knopf darüber zusätzlich ein Ziel der Railgun.
// Mit Freier Hand gehen Manöver und Fähigkeit zusammen, mit Schnellverlegung ein Schiff mehr; fällt der Befehl weg,
// fällt auch, was er erlaubt hat, und die Statuszeile sagt es.
// Der Torpedo zielt auf einen Slot der Gegnerseite, auch einen leeren, der Durchschlag auf eine Slot-Nummer dort,
// Wärmesucher und Traktorstrahl auf ein gegnerisches Schiff; Fadenkreuze markieren das Ziel.
// Alles ist bis zum Submit änderbar; danach wartet der Zug auf den Gegner. Solange geplant wird, zeigt die
// Zielvorschau (`game/preview.ts`), wie die Runde mit diesem Plan liefe, wenn der Gegner nichts tut: je Schuss ein
// Bogen (verpuffende gestrichelt), auf den Balken der Schaden.
// Der Spielzustand kommt vom Server und steckt in `Match`, die Szene spiegelt ihn nur.
// „Neues Match“ wechselt nur die Verbindung; Szene und geladene Assets bleiben.
// Die Musik folgt der Phase: ruhig beim Planen, angespannt während die Runde abläuft, still nach Spielende.
// Zwischen den Runden meldet sich der Bordfunk (`audio/radio.ts`), während einer Runde die Wiedergabe.

import { PointerEventTypes, type PointerInfo } from "@babylonjs/core/Events/pointerEvents";
import { ADMIRALS, type AdmiralId } from "../../shared/admirals.ts";
import { isSameSlot, MAX_SHIPS_PER_LANE, MAX_SHIPS_PER_SIDE, overdriveBonus, type PlannedMove, type Slot, slotTarget } from "../../shared/board.ts";
import {
  type CommandCard,
  canTargetShip,
  needsTarget,
  type ShipCard,
  shipById,
  targetsEnemyColumn,
  targetsEnemyShip,
  targetsEnemySide,
  targetsEnemySlot,
} from "../../shared/cards.ts";
import type { MatchResult, OpponentView, ServerMessage, ShipRef, SlotRef, SlotTarget, TurnPlan } from "../../shared/protocol.ts";
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
import type { MarkerSpec } from "./scene/markers.ts";
import { MatchScene, pickedPad } from "./scene/matchScene.ts";
import type { MoveArrow } from "./scene/moveArrow.ts";
import { ShipView } from "./scene/ship.ts";
import type { SlotPad } from "./scene/slotPad.ts";
import { AdmiralSelect } from "./ui/admiralSelect.ts";
import { FloatingTexts } from "./ui/floatingText.ts";
import { installFullscreen, toggleFullscreen } from "./ui/fullscreen.ts";
import { HandView } from "./ui/hand.ts";
import { Hud } from "./ui/hud.ts";
import { LoadingScreen } from "./ui/loadingScreen.ts";
import { OpponentPanel } from "./ui/opponentPanel.ts";
import { PowerCard, type PowerCardView, type PowerState } from "./ui/powerCard.ts";
import { RadioSubtitle } from "./ui/radioSubtitle.ts";
import { ResultScreen } from "./ui/resultScreen.ts";
import { slotLabel } from "./ui/roundLog.ts";
import { RulesDialog } from "./ui/rulesDialog.ts";
import { SettingsDialog } from "./ui/settingsDialog.ts";
import { SurrenderDialog } from "./ui/surrenderDialog.ts";
import { installViewToggle } from "./ui/viewToggle.ts";

/** Den Ausgang meldet der Bordfunk kurz nach dem Einsatz der Fanfare (Millisekunden). */
const RESULT_REPORT_DELAY = 1500;
const KERR = color3("kerr");
const PLAYER = color3("player");
const SELECT = color3("select");
/** Die Marken der Feuerbefehle beim Planen: Bereitschaft und Visier des gewählten Schützen. */
const FIRE_MARKERS = ["ready", "aim"] as const;

/** Was gerade gewählt ist und auf einen Klick aufs Brett wartet; es ist immer höchstens eines. */
type Selection =
  | { kind: "ship"; pick: ShipPick }
  /** Bei einem verlegenden Befehl: `moveSource` ist das gewählte Schiff, solange der Ziel-Slot noch fehlt. */
  | { kind: "command"; index: number; moveSource: Slot | null }
  /** Ein eigenes Schiff (Slot beim Planen, auch ein eingeplantes): wartet auf sein Ziel und, auf dem Brett, auf sein Grundmanöver. */
  | { kind: "unit"; slot: Slot }
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
    installViewToggle(ui, this.view);
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
        // Der Geist weicht dem echten Schiff; der neue Zustand folgt als nächste Nachricht. Wer als Zweiter abgibt,
        // bekommt die Runde ohne Zwischenstand, eine offene Auswahl samt Gitter muss also hier weichen.
        this.isResolving = true;
        this.selection = null;
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
      this.setCommand(null);
      this.select(null);
      playUiSound("cancel");
    } else if (this.selection?.kind === "command" && this.selection.index === index) {
      this.select(null);
      playUiSound("cancel");
    } else if (needsTarget(card)) {
      this.select({ kind: "command", index, moveSource: null });
      playUiSound("select");
    } else {
      this.setCommand({ handIndex: index, target: null, destination: null });
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

  /**
   * Nimmt ein eingeplantes Schiff zurück, samt Befehl, Fähigkeit und Feuerbefehl auf dieses Schiff; ein angefangener
   * Lane-Wechsel des Schiffs bricht ab, ebenso seine Auswahl auf dem Brett.
   */
  private unplanShip(pick: ShipPick): void {
    const selection = this.selection;
    const moving = selection?.kind === "command" && selection.moveSource !== null && this.match.plannedPickAt(selection.moveSource) === pick;
    this.match.unplanShip(pick);
    const gone = selection?.kind === "unit" && this.match.shipAt(selection.slot) === null;
    this.select(moving || gone || selection?.kind === "ship" ? null : selection);
    playUiSound("cancel");
  }

  /**
   * Plant einen Befehl (null: keinen); fällt mit dem alten Befehl ein Schiff oder die Fähigkeit weg oder feuert das Ziel
   * des neuen nicht (Rammkurs, Kurzsprung), sagt es der Hinweis.
   */
  private setCommand(command: Match["plan"]["command"]): void {
    const before = this.match.plannedCommand;
    const { ship, power, fire } = this.match.setCommand(command);
    const lost = [ship && cardText(ship).name, power && t.powers[this.match.power!].name].filter((name) => typeof name === "string");
    if (lost.length > 0) this.notice = t.status.commandDropped(cardText(before!).name, lost.join(" + "));
    if (fire) this.addNotice(t.status.fireCleared(cardText(fire).name));
  }

  /** Hängt einen Hinweis an; er gilt bis zum nächsten Klick. */
  private addNotice(text: string): void {
    this.notice = this.notice === null ? text : `${this.notice} ${text}`;
  }

  private cancelManeuver(): void {
    this.match.setManeuver(null);
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
   * Das Brett zeigt den Zeiger nur, solange etwas gewählt ist; ohne Auswahl wählt ein Klick ein eigenes Schiff.
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
    // Daneben: Die Auswahl bricht ab.
    if (pad === null) {
      this.select(null);
      return playUiSound("cancel");
    }
    if (selection.kind === "unit") return this.onUnitClick(selection.slot, pad);
    if (!this.isValidTarget(pad)) return playUiSound("denied");
    switch (selection.kind) {
      case "ship":
        return this.stageShipOn(selection.pick, pad);
      case "command":
        return this.stageCommandTargetOn(selection, pad);
      case "power":
        return this.stagePowerOn(pad);
      case "mark":
        return this.stageMarkOn(pad);
    }
  }

  /**
   * Ohne Auswahl: Ein Klick auf ein eigenes Schiff, auch auf den Geist eines eingeplanten oder bewegten, wählt es
   * (`selectUnit`); einer auf das Trugbild nimmt die Fähigkeit zurück. Leere Slots und die Drohnen eingeplanter Träger
   * reagieren nicht.
   */
  private onShipClick(pad: SlotPad | null): void {
    if (pad === null || pad.slot.lane.side === "enemy") return;
    const decoy = this.match.plannedDecoy;
    if (decoy && isSameSlot(decoy, slotTarget(pad.slot))) return this.cancelPower();
    const unit = this.unitAt(pad);
    if (unit !== null) this.selectUnit(unit);
  }

  /** Wählt das eigene Schiff; eines, mit dem sich nichts planen oder zurücknehmen lässt, verweigert den Klick. */
  private selectUnit(slot: Slot): void {
    const { match } = this;
    const canAim = match.canFire(slot) && match.board.ships("enemy").length > 0;
    const selectable = canAim || match.plannedPickAt(slot) !== null || this.isManeuvering(slot) || match.maneuverDestinations(slot).length > 0;
    if (!selectable) return playUiSound("denied");
    this.select({ kind: "unit", slot });
    playUiSound("select");
  }

  /**
   * Klick bei gewähltem Schiff: auf das Schiff selbst (auch auf seinen Geist) nimmt zurück (`takeBack`), auf ein
   * gegnerisches Schiff gibt ihm das Ziel, auf einen Ziel-Slot das Grundmanöver, auf ein anderes eigenes Schiff wählt dieses.
   */
  private onUnitClick(unit: Slot, pad: SlotPad): void {
    if (this.showsUnit(pad, unit)) return this.takeBack(unit);
    if (this.isValidTarget(pad)) return pad.slot.lane.side === "enemy" ? this.stageFireOn(unit, pad) : this.stageManeuverOn(unit, pad);
    const other = this.unitAt(pad);
    if (other !== null) return this.selectUnit(other);
    playUiSound("denied");
  }

  /**
   * Der zweite Klick auf das gewählte Schiff nimmt zurück, was es in dieser Runde bringt oder bewegt: das eingeplante
   * Schiff, sonst sein Grundmanöver (auch den Phasentausch, von beiden Schiffen aus); sonst endet nur die Auswahl.
   */
  private takeBack(unit: Slot): void {
    const pick = this.match.plannedPickAt(unit);
    if (pick !== null) return this.unplanShip(pick);
    if (this.isManeuvering(unit)) this.match.setManeuver(null);
    this.select(null);
    playUiSound("cancel");
  }

  /**
   * Das eigene Schiff, für das ein Pad steht, als Slot beim Planen: das echte Schiff oder der Geist eines eingeplanten;
   * der Geist im Ziel-Slot einer Bewegung steht für das bewegte Schiff. Drohnen eingeplanter Träger und das Trugbild
   * zählen nicht.
   */
  private unitAt(pad: SlotPad): Slot | null {
    if (pad.slot.lane.side === "enemy") return null;
    if (this.match.shipAt(pad.slot) !== null) return pad.slot;
    return [this.match.plannedManeuver, this.match.plannedCommandMove].find((move) => move?.to === pad.slot)?.from ?? null;
  }

  /** Ob der Pad das Schiff zeigt, echt oder als Geist; beim Phasentausch stehen beide Schiffe auf beiden Pads. */
  private showsUnit(pad: SlotPad, unit: Slot): boolean {
    const swap = this.match.plannedSwap;
    const swapped = swap !== null && [swap.from, swap.to].includes(unit) && [swap.from, swap.to].includes(pad.slot);
    return swapped || this.unitAt(pad) === unit;
  }

  /** Ob das Schiff im eingeplanten Grundmanöver den Slot wechselt, beim Phasentausch auch der Tauschpartner. */
  private isManeuvering(slot: Slot): boolean {
    const maneuver = this.match.plannedManeuver;
    return maneuver !== null && (maneuver.from === slot || (this.match.plannedSwap !== null && maneuver.to === slot));
  }

  /** Das gewählte Schiff, wenn es feuern kann (Slot beim Planen). */
  private get selectedShooter(): Slot | null {
    const selection = this.selection;
    return selection?.kind === "unit" && this.match.canFire(selection.slot) ? selection.slot : null;
  }

  /**
   * Einzige Gültigkeitsregel für Highlight und Klick: gewählte Schiffskarte -> freie eigene Slots, die den eingeplanten
   * Bewegungen nicht im Weg stehen; gewähltes Schiff auf dem Brett -> jedes gegnerische Schiff, auch ein gedecktes, wenn
   * es feuern kann, dazu seine Ziel-Slots des Grundmanövers in beiden Lanes (bei der Mirage auch eigene Schiffe);
   * gewählter Befehl -> eigene Schiffe in einer erlaubten Lane, auch das eingeplante, bei verlegenden
   * Befehlen nur mit freiem Ziel-Slot, danach die freien Slots der Ziel-Lane; Torpedo und Durchschlag -> jeder Slot
   * der Gegnerseite; Wärmesucher und Traktorstrahl -> gegnerische Schiffe (`canTargetShip`); Fähigkeit und
   * Zielerfassung -> ihre Ziele aus `shared/powers.ts`. Ohne Auswahl leuchten nur das bereits gewählte eigene
   * Befehlsziel, die Ziel-Slots und das manövrierende Schiff weiter, bis die Runde aufgelöst wird; Ziele auf der
   * Gegnerseite zeigt das Fadenkreuz, die Ziele von Fähigkeit und Zielerfassung ihre Marke.
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
      case "unit":
        if (!own) return slot.isOccupied && this.match.canFire(selection.slot);
        return this.match.maneuverDestinations(selection.slot).includes(slot);
      case "command": {
        const command = this.selectedCommand!;
        if (targetsEnemySlot(command)) return !own;
        if (targetsEnemyShip(command)) return !own && slot.isOccupied && canTargetShip(command, slot.card!);
        if (!own) return false;
        if (selection.moveSource !== null) return this.match.commandMoveDestinations(command, selection.moveSource).includes(slot);
        if (!this.match.canTargetOwn(command, slot)) return false;
        return !command.moves || this.match.commandMoveDestinations(command, slot).length > 0;
      }
      default: {
        if (!own) return false;
        const target = this.match.plannedOwnTarget;
        const maneuver = this.match.plannedManeuver;
        return (
          (target != null && isSameSlot(target, slotTarget(slot))) ||
          this.match.plannedCommandMove?.to === slot ||
          maneuver?.from === slot ||
          maneuver?.to === slot
        );
      }
    }
  }

  /** Plant das Schiff auf den Slot; bis zur Auflösung steht es dort nur als Geist. */
  private stageShipOn(pick: ShipPick, pad: SlotPad): void {
    this.match.planShip(pick, slotTarget(pad.slot));
    this.select(null);
    playUiSound("place");
  }

  /**
   * Plant das Grundmanöver des gewählten Schiffs; es steht bis zur Auflösung als Geist im Ziel-Slot. Was dabei wegfällt,
   * die Fähigkeit (außer mit Freier Hand) und sein Feuerbefehl (außer beim Phasentausch), sagt der Hinweis.
   */
  private stageManeuverOn(source: Slot, pad: SlotPad): void {
    const { power, fire } = this.match.setManeuver({ ship: slotTarget(source), destination: slotTarget(pad.slot) });
    if (power) this.addNotice(t.status.maneuverReplacesPower(t.powers[this.match.power!].name));
    if (fire) this.addNotice(t.status.fireCleared(cardText(fire).name));
    this.select(null);
    playUiSound("place");
  }

  /** Der Feuerbefehl des gewählten Schiffs auf das gegnerische Schiff; auf sein jetziges Ziel hebt ihn der Klick auf. Das Schiff bleibt gewählt. */
  private stageFireOn(shooter: Slot, pad: SlotPad): void {
    const order = this.match.fireOrderAt(shooter);
    if (order && isSameSlot(order.target, slotTarget(pad.slot))) {
      this.match.clearFire(shooter);
      playUiSound("cancel");
    } else {
      this.match.setFire(shooter, pad.slot);
      playUiSound("place");
    }
    this.refreshSelectionVisuals();
  }

  /**
   * Verlegende Befehle merken sich erst das Schiff und werden mit dem Ziel-Slot eingeplant. Der Durchschlag schickt
   * den Strike-Slot der gewählten Slot-Nummer.
   */
  private stageCommandTargetOn(selection: Extract<Selection, { kind: "command" }>, pad: SlotPad): void {
    const card = this.match.commandHand[selection.index]!;
    if (card.moves && selection.moveSource === null) {
      this.select({ ...selection, moveSource: pad.slot });
      return playUiSound("select");
    }
    const target = selection.moveSource ?? pad.slot;
    this.setCommand({
      handIndex: selection.index,
      target: targetsEnemyColumn(card) ? { lane: "strike", slotIndex: target.index } : slotTarget(target),
      destination: selection.moveSource && pad.slot.index,
    });
    this.select(null);
    playUiSound("place");
  }

  /** Plant die Admiralsfähigkeit auf das Ziel; sie ersetzt das Grundmanöver, außer mit Freier Hand. */
  private stagePowerOn(pad: SlotPad): void {
    this.match.plan.power = { target: slotTarget(pad.slot) };
    const replaced = this.match.plannedManeuver;
    if (replaced !== null && !this.match.keepsManeuverAndPower) {
      this.notice = t.status.powerReplacesManeuver(t.powers[this.match.power!].name, cardText(replaced.from.card!).name);
      this.match.setManeuver(null);
    }
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
    this.view.reticle.show(this.shownEnemyTargets());

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

  /**
   * Die Fadenkreuze stehen beim Wählen auf dem Ziel unter dem Zeiger, sonst auf dem eingeplanten Ziel auf der
   * Gegnerseite; beim Durchschlag auf beiden Slots der Slot-Nummer.
   */
  private shownEnemyTargets(): SlotPad[] {
    if (this.isResolving) return [];
    const selected = this.selectedCommand;
    const card = selected && targetsEnemySide(selected) ? selected : this.match.plannedCommand;
    const hovered = this.validHoveredPad();
    const target = selected && targetsEnemySide(selected) ? hovered && slotTarget(hovered.slot) : this.match.plannedEnemyTarget;
    if (!card || !target) return [];
    if (!targetsEnemyColumn(card)) return [this.view.pad("enemy", target.lane, target.slotIndex)];
    return [this.view.pad("enemy", "strike", target.slotIndex), this.view.pad("enemy", "command", target.slotIndex)];
  }

  private shownCommandMove(): { from: SlotPad; to: SlotPad } | null {
    const selection = this.selection?.kind === "command" ? this.selection : null;
    return this.shownMove(selection?.moveSource ?? null, this.match.plannedCommandMove, selection !== null);
  }

  /** Das Grundmanöver, wie Geist und Pfeil es zeigen: beim gewählten Schiff zum eigenen Ziel-Slot unter dem Zeiger, sonst das eingeplante. */
  private shownManeuver(): { from: SlotPad; to: SlotPad } | null {
    const hovered = this.validHoveredPad();
    if (this.selection?.kind === "unit" && hovered?.slot.lane.side === "player") return { from: this.padAt(this.selection.slot), to: hovered };
    return this.shownMove(null, this.match.plannedManeuver, false);
  }

  /**
   * Eine Bewegung, wie Geist und Pfeil sie zeigen: beim Wählen (`source`) zum Slot unter dem Zeiger,
   * sonst der eingeplante, solange er nicht gerade neu gewählt wird.
   */
  private shownMove(source: Slot | null, planned: PlannedMove | null, isReplanning: boolean): { from: SlotPad; to: SlotPad } | null {
    if (this.isResolving) return null;
    if (source !== null) {
      const hovered = this.validHoveredPad();
      return hovered && { from: this.padAt(source), to: hovered };
    }
    if (isReplanning || planned === null) return null;
    return { from: this.padAt(planned.from), to: this.padAt(planned.to) };
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
   * Schiffs, auf ein verlegtes eigenes Schiff folgt sie ihm. Zu den Feuerbefehlen trägt der gewählte Schütze das
   * Visier und, solange geplant wird, jedes Schiff, das noch ein Ziel bekommen kann, die Bereitschaft, beide am Slot
   * beim Planen (am echten Schiff, sonst am Geist). In der Auflösung setzt die Wiedergabe die Marken; die der
   * Feuerbefehle gehören nur zur Planung und gehen dann.
   */
  private refreshMarkers(): void {
    if (this.isResolving) {
      for (const pad of this.view.pads) for (const kind of FIRE_MARKERS) pad.ship?.removeMarker(kind);
      return;
    }
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
    const shooter = this.selectedShooter;
    for (const slot of this.canPlan && this.match.board.ships("enemy").length > 0 ? this.match.shooters : []) {
      const pad = this.padAt(slot);
      if (slot === shooter) add(pad.ship ?? pad.ghost, { kind: "aim", color: SELECT });
      else if (!this.match.isArmed(slot)) add(pad.ship ?? pad.ghost, { kind: "ready", color: PLAYER });
    }
    for (const pad of this.view.pads) {
      pad.ship?.setMarkers(markers.get(pad.ship) ?? []);
      pad.ghost?.setMarkers(markers.get(pad.ghost) ?? []);
    }
  }

  /**
   * Rechnet die Zielvorschau neu, sobald sich Brett oder Plan ändern, beim gewählten Schiff auch mit dem Ziel unter dem
   * Zeiger; während der Auflösung und nach Spielende gibt es keine.
   */
  private updatePreview(): void {
    const planning = !this.isResolving && this.match.round > 0 && this.match.admiralsChosen && this.match.result === null;
    this.preview = planning ? previewRound(this.match, this.previewPlan()) : null;
  }

  /** Der Plan der Zielvorschau: beim gewählten Schiff mit dem Ziel bzw. Ziel-Slot unter dem Zeiger, sonst der eingeplante. */
  private previewPlan(): TurnPlan {
    const { match, selection } = this;
    const hovered = this.validHoveredPad();
    if (selection?.kind !== "unit" || hovered === null) return match.plan;
    const unit = selection.slot;
    if (hovered.slot.lane.side === "enemy") return match.tryPlan(() => match.setFire(unit, hovered.slot));
    return match.tryPlan(() => match.setManeuver({ ship: slotTarget(unit), destination: slotTarget(hovered.slot) }));
  }

  /**
   * Die Zielvorschau auf dem Brett: je Schuss ein Bogen, der des gewählten Schützen hervorgehoben, verpuffende
   * gestrichelt; auf den Balken der drohende Verlust und ein Totenkopf an jedem Schiff, das fallen würde, auch an
   * Geistern. Ein Schiff, das sich bewegt, steht dabei schon im Ziel-Slot; den Totenkopf trägt, wer nach den
   * Bewegungen im Slot steht — der Geist, sonst das echte Schiff.
   */
  private showPreview(): void {
    const preview = this.preview;
    const shooter = this.selectedShooter;
    const selected = (from: SlotTarget | null) => shooter !== null && from !== null && isSameSlot(from, slotTarget(shooter));
    this.view.targetLines.show(
      (preview?.shots ?? []).map((shot) => ({
        from: this.padOf(shot.attacker),
        to: this.padOf(shot.target),
        side: shot.attacker.side,
        fizzle: shot.fizzle,
        selected: selected(shot.shooter),
      })),
    );
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

  private padAt(slot: Slot): SlotPad {
    return this.view.pad(slot.lane.side, slot.lane.type, slot.index);
  }

  /**
   * Das manövrierende Schiff feuert nicht und zeigt das mit gedämpften Balken, schon solange sein Ziel-Slot unter dem
   * Zeiger liegt, beim Phasentausch nicht; in der Auflösung setzt sie die Wiedergabe.
   */
  private refreshHoldFire(): void {
    if (this.isResolving) return;
    const maneuver = this.shownManeuver();
    const maneuvering = maneuver !== null && !maneuver.to.slot.isOccupied ? maneuver.from.slot : null;
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
    const planned = new Set<ShipPick>(match.arrivals.map((arrival) => arrival.pick));
    this.hand.renderShips(match.shipHand, match.needsFlagship ? match.flagship : null, planned, selection?.kind === "ship" ? selection.pick : null);
    this.hand.renderCommands(match.commandHand, match.plan.command?.handIndex ?? null, selection?.kind === "command" ? selection.index : null);
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
      (selection?.kind === "unit" && this.match.maneuverDestinations(selection.slot).length > 0) ||
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
    this.hud.setChecklist(planning ? match.turnProgress : null, { planned: match.plan.ships.length, max: match.deployLimit });
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
    if (railgun)
      return {
        admiral: match.admiral,
        power,
        lock: { railgun: t.hud.railgun(cardText(railgun.card!).name), warning: match.pendulumMoves ? t.hud.shotLost : null },
      };
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
    const deploys = match.deployLimit > 1 ? ` · ${t.status.deploysLeft(match.deploysLeft)}` : "";
    // Verpuffende Schüsse sind verschenkt; beim gewählten Schützen sagt es sein eigener Text.
    const fizzles = this.selection?.kind === "unit" ? 0 : (this.preview?.shots.filter((shot) => shot.fizzle).length ?? 0);
    const warning = fizzles > 0 ? `${t.status.fizzles(fizzles)} ` : "";
    return `${fleet}${deploys} — ${this.notice ? `${this.notice} ` : ""}${warning}${this.buildPlanningText()}`;
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
      case "unit":
        return this.unitText(selection.slot);
      case "ship": {
        const name = cardText(match.cardOf(selection.pick)).name;
        if (this.validTargetCount === 0) return t.status.noFreeSlot(name, MAX_SHIPS_PER_LANE, MAX_SHIPS_PER_SIDE);
        return t.status.placeShip(name);
      }
      case "command": {
        const command = this.selectedCommand!;
        const name = cardText(command).name;
        if (targetsEnemyColumn(command)) return t.status.chooseEnemyColumn(name);
        if (targetsEnemySlot(command)) return t.status.chooseEnemySlot(name);
        if (targetsEnemyShip(command)) return this.validTargetCount === 0 ? t.status.noEnemyTarget(name) : t.status.chooseEnemyShip(name);
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
    if (match.plan.fire.length > 0) planned.push(t.status.fireOrders(match.plan.fire.length));
    if (planned.length > 0) return t.status.planned(planned.join(" + "));
    return t.status.idle;
  }

  /**
   * Das gewählte Schiff: ob und worauf es feuern kann, ob es manövrieren kann, wohin sein Schuss laut Vorschau geht und
   * was ein zweiter Klick darauf zurücknimmt.
   */
  private unitText(slot: Slot): string {
    const { match } = this;
    const ship = match.shipAt(slot)!;
    const name = cardText(ship).name;
    const maneuvering = this.isManeuvering(slot);
    const canManeuver = match.maneuverDestinations(slot).length > 0;
    const texts: string[] = [];
    if (!match.canFire(slot)) {
      texts.push(
        ship.atk === 0
          ? t.status.noGuns(name)
          : maneuvering
            ? t.status.maneuvering(name)
            : t.status.commandHoldsFire(name, cardText(match.plannedCommand!).name),
      );
      if (canManeuver) texts.push(maneuvering ? t.status.changeManeuver : t.status.maneuverHint);
    } else if (match.board.ships("enemy").length === 0) {
      texts.push(t.status.noFireTarget(name));
    } else {
      texts.push(t.status.chooseFireTarget(name));
      if (canManeuver) texts.push(ship.id === "mirage" ? t.status.maneuverOrSwap : t.status.maneuverInstead);
      texts.push(...this.shotTexts(slot));
    }
    texts.push(match.plannedPickAt(slot) !== null ? t.status.againUnplan : maneuvering ? t.status.againManeuver : t.status.escCancels);
    return texts.join(" ");
  }

  /**
   * Der Schuss des gewählten Schützen laut Vorschau: sein jetziges Ziel (nicht, solange ein anderes unter dem Zeiger
   * liegt), ob die Deckung davor ihn abfängt oder er verpufft; die Drohne im eigenen Schwarmangriff fliegt dessen Ziel an.
   */
  private shotTexts(slot: Slot): string[] {
    const { match } = this;
    const name = (ref: ShipRef) => cardText(shipById(ref.cardId)).name;
    const texts: string[] = [];
    const order = match.fireOrderAt(slot);
    const hovered = this.validHoveredPad();
    const aiming = hovered?.slot.lane.side === "enemy" ? slotTarget(hovered.slot) : null;
    if (order && (aiming === null || isSameSlot(aiming, order.target)))
      texts.push(t.status.fireTarget(cardText(this.padOf({ side: "enemy", ...order.target }).slot.card!).name));
    if (match.fliesSwarm(slot)) texts.push(t.status.swarmFire(t.powers.swarm_strike.name));
    const shot = this.preview?.shots.find((shot) => shot.shooter !== null && isSameSlot(shot.shooter, slotTarget(slot)));
    if (shot?.fizzle && shot.aimedAt) texts.push(t.status.coverFizzles(name(shot.target), name(shot.aimedAt)));
    else if (shot?.fizzle) texts.push(t.status.fireFizzles(name(shot.target)));
    else if (shot?.aimedAt) texts.push(t.status.fireCovered(name(shot.target), name(shot.aimedAt)));
    return texts;
  }

  /** Das Ziel einer Fähigkeit in Worten: das Schiff dort, auch ein eingeplantes, beim Trugbild der Slot. */
  private targetLabel(ref: SlotRef): string {
    const pad = this.padOf(ref);
    const ship = ref.side === "player" ? this.match.shipAt(pad.slot) : pad.slot.card;
    return ship ? cardText(ship).name : slotLabel(ref);
  }

  /** Beim gewählten Schiff rechnet die Vorschau mit dem Ziel unter dem Zeiger, und die Statuszeile sagt, wohin der Schuss geht. */
  private setHoveredPad(pad: SlotPad | null): void {
    if (pad === this.hoveredPad) return;
    this.hoveredPad?.setHovered(false);
    this.hoveredPad = pad;
    this.hoveredPad?.setHovered(true);
    if (this.selection?.kind !== "unit") return this.refreshGhosts();
    this.updatePreview();
    this.refreshGhosts();
    this.refreshHoldFire();
    this.updateHud();
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
