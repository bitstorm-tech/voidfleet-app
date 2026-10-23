// Spielt die aufgedeckten Ereignisse einer Runde auf dem Brett ab: Deploy,
// Befehle, Kampf und Cleanup nacheinander, gleichartige Ereignisse jeweils
// gleichzeitig. Nur die Schüsse im Kampf laufen einzeln ab, damit man bei
// vollem Brett nachvollziehen kann, wer wen trifft. Die Szene läuft dabei dem Spielzustand voraus; den Endzustand
// übernimmt danach der Server-Snapshot (`MatchController.syncBoard`) — auch
// dann, wenn der Spieler die Animation per `skip` abbricht.

import type { Color3 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { Side } from "../../shared/board.ts";
import { shipById, type ShipId } from "../../shared/cards.ts";
import type { RoundEvent, ShipRef, ShipStats, SlotTarget } from "../../shared/protocol.ts";
import { color3 } from "./data/palette.ts";
import { t } from "./i18n/index.ts";
import { destroyShip } from "./scene/destruction.ts";
import type { MatchScene } from "./scene/matchScene.ts";
import { ShipView } from "./scene/ship.ts";
import type { SlotPad } from "./scene/slotPad.ts";
import { easeInOutSine, setAnimationScope, skipAnimations, tween, wait } from "./scene/tween.ts";
import type { FloatingTexts, FloatTone } from "./ui/floatingText.ts";
import type { Hud } from "./ui/hud.ts";
import { describeEvent } from "./ui/roundLog.ts";

const SIDE_COLORS: Record<Side, Color3> = {
  player: color3("player"),
  enemy: color3("enemy"),
};
const TONE_COLORS: Record<FloatTone, Color3> = {
  damage: color3("damage"),
  heal: color3("heal"),
  shield: color3("shield"),
  buff: color3("buff"),
  debuff: color3("debuff"),
};

/** Pause zwischen zwei Schritten, damit man sie auseinanderhalten kann. */
const STEP_PAUSE = 280;
/** So lange steht das Befehls-Banner, bevor die Wirkung einsetzt. */
const BANNER_LEAD = 650;
const SHIP_CENTER = new Vector3(0, 0.15, 0);
const ABOVE_SHIP = new Vector3(0, 0.9, 0);
/** Orbitale Angriffe kommen von oben aus Richtung des Angreifers. */
const ORBIT_OFFSET = new Vector3(0, 9, 0);
/** Schüsse enden nicht im Mittelpunkt, sondern so weit davor auf der Hülle. */
const HULL_RADIUS = 0.45;

/** Ereignisse mit gleichem Schlüssel stehen hintereinander und laufen gemeinsam ab; `null` steht für sich allein. */
function stepKey(event: RoundEvent): string | null {
  switch (event.kind) {
    case "deploy":
    case "pass":
      return "deploy";
    case "effect":
    case "draw":
    case "noEffect":
      return `command-${event.side}-${event.cardId}`;
    case "attack":
      return null;
    default:
      return event.kind;
  }
}

function groupSteps(events: readonly RoundEvent[]): RoundEvent[][] {
  const steps: RoundEvent[][] = [];
  for (const event of events) {
    const last = steps.at(-1);
    const key = stepKey(event);
    if (last && key !== null && stepKey(last[0]!) === key) last.push(event);
    else steps.push([event]);
  }
  return steps;
}

export class RoundPlayback {
  private isSkipped = false;

  constructor(
    private readonly view: MatchScene,
    private readonly hud: Hud,
    private readonly floats: FloatingTexts,
  ) {}

  async play(round: number, events: readonly RoundEvent[]): Promise<void> {
    this.hud.appendLog([t.log.roundHeader(round)]);
    this.isSkipped = false;
    for (const step of groupSteps(events)) {
      this.hud.appendLog(step.map(describeEvent));
      if (this.isSkipped) continue;
      setAnimationScope(step[0]!.kind === "attack" ? "attack" : "general");
      await this.playStep(step);
      await wait(this.view.scene, STEP_PAUSE);
    }
    setAnimationScope("general");
    skipAnimations(false);
  }

  /** Bricht die laufende Runde ab: Animationen springen ans Ende, die restlichen Schritte landen nur noch im Log. */
  skip(): void {
    this.isSkipped = true;
    skipAnimations(true);
    this.floats.clear();
    this.hud.hideBanner();
  }

  private async playStep(step: readonly RoundEvent[]): Promise<void> {
    const first = step[0]!;
    if (first.kind === "effect" || first.kind === "draw" || first.kind === "noEffect") {
      this.announceCommand(first);
      await wait(this.view.scene, BANNER_LEAD);
    }
    await Promise.all(step.map((event) => this.playEvent(event)));
  }

  private announceCommand(event: Extract<RoundEvent, { kind: "effect" | "draw" | "noEffect" }>): void {
    const title = t.banner.command(t.log.who[event.side], t.commands[event.cardId].name);
    const subtitle =
      event.kind === "noEffect" ? t.banner.noEffect : event.kind === "draw" ? t.banner.draw(event.ships, event.commands) : null;
    this.hud.showBanner(title, subtitle, event.side);
  }

  private async playEvent(event: RoundEvent): Promise<void> {
    switch (event.kind) {
      case "deploy":
        return this.deploy(event.side, event.cardId, event.target);
      case "effect":
        return this.effect(event);
      case "attack": {
        const color = SIDE_COLORS[event.attacker.side];
        const origin = this.centerOf(this.padOf(event.attacker));
        await this.shoot(origin, this.padOf(event.target), color);
        return this.damage(event.target, event.amount, event.after, origin, color);
      }
      case "selfDamage":
        return this.damage(event.ship, event.amount, event.after, this.centerOf(this.padOf(event.ship)).add(ORBIT_OFFSET), TONE_COLORS.damage);
      case "destroyed":
        return this.destroy(event.ship);
      case "pass":
      case "command":
      case "draw":
      case "noEffect":
        return;
    }
  }

  // --- Einzelne Ereignisse ---

  private async deploy(side: Side, cardId: ShipId, target: SlotTarget): Promise<void> {
    await this.view.deploy(new ShipView(this.view.scene, shipById(cardId), false), side, target.lane, target.slotIndex);
  }

  private async effect(event: Extract<RoundEvent, { kind: "effect" }>): Promise<void> {
    const pad = this.padOf(event.ship);
    const { effect, after } = event;
    switch (effect.type) {
      case "damage": {
        const color = SIDE_COLORS[event.side];
        const origin = this.centerOf(pad).add(ORBIT_OFFSET);
        await this.view.effects.bolt(origin, this.impactFrom(pad, origin), color);
        return this.damage(event.ship, effect.amount, after, origin, color);
      }
      case "attack":
        return this.mark(pad, t.float.attack(effect.delta), effect.delta > 0 ? "buff" : "debuff");
      case "shield":
        pad.ship!.setStats(after.hp, after.shield);
        return this.mark(pad, t.float.shield(effect.amount), "shield", 2.2);
      case "disable":
        return this.mark(pad, t.float.disabled, "debuff");
      case "heal":
        pad.ship!.setStats(after.hp, after.shield);
        return this.mark(pad, t.float.heal(effect.amount), "heal");
      case "move":
        return this.move(pad, this.view.pad(event.ship.side, effect.to.lane, effect.to.slotIndex));
    }
  }

  /** Mündungsblitz bei `origin`, dann fliegt der Bolzen bis auf die Hülle des Ziels. */
  private async shoot(origin: Vector3, to: SlotPad, color: Color3): Promise<void> {
    void this.view.effects.pulse(origin, color, 0.7, 180);
    await this.view.effects.bolt(origin, this.impactFrom(to, origin), color);
  }

  /** Treffer eines Schusses aus Richtung `origin`: Einschlag auf der Hülle, Hüllenblitz und Schadenszahl. */
  private async damage(ref: ShipRef, amount: number, after: ShipStats, origin: Vector3, color: Color3): Promise<void> {
    const pad = this.padOf(ref);
    const ship = pad.ship!;
    ship.setStats(after.hp, after.shield);
    this.float(pad, t.float.damage(amount), "damage");
    await Promise.all([ship.flash(), this.view.effects.hit(this.impactFrom(pad, origin), origin, color)]);
  }

  /** Das Schiff geht in seiner eigenen Zerstörungssequenz unter; das Wrack brennt danach für sich weiter. */
  private async destroy(ref: ShipRef): Promise<void> {
    await destroyShip(this.padOf(ref).detachShip(), this.view);
  }

  /** Das Schiff gleitet in den neuen Slot; der Anker übernimmt es sofort, die Position folgt. */
  private async move(from: SlotPad, to: SlotPad): Promise<void> {
    const ship = from.detachShip();
    const start = ship.root.getAbsolutePosition().clone();
    to.attachShip(ship);
    ship.root.setAbsolutePosition(start);
    const offset = ship.root.position.clone();
    await tween(this.view.scene, 650, (progress) => {
      offset.scaleToRef(1 - easeInOutSine(progress), ship.root.position);
    });
  }

  /** Buffs und Debuffs: farbiger Impuls plus Text über dem Schiff. */
  private async mark(pad: SlotPad, text: string, tone: FloatTone, size = 1.6): Promise<void> {
    this.float(pad, text, tone);
    await this.view.effects.pulse(this.centerOf(pad), TONE_COLORS[tone], size, 650);
  }

  // --- Hilfen ---

  private padOf(ref: ShipRef): SlotPad {
    return this.view.pad(ref.side, ref.lane, ref.slotIndex);
  }

  private centerOf(pad: SlotPad): Vector3 {
    return pad.shipAnchor.getAbsolutePosition().add(SHIP_CENTER);
  }

  /** Wo ein Schuss aus Richtung `origin` die Hülle des Schiffs auf `pad` trifft. */
  private impactFrom(pad: SlotPad, origin: Vector3): Vector3 {
    const center = this.centerOf(pad);
    return center.subtract(center.subtract(origin).normalize().scale(HULL_RADIUS));
  }

  private float(pad: SlotPad, text: string, tone: FloatTone): void {
    this.floats.show(this.view.screenPosition(this.centerOf(pad).add(ABOVE_SHIP)), text, tone);
  }
}
