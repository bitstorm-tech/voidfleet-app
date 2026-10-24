// Spielt die aufgedeckten Ereignisse einer Runde auf dem Brett ab: Deploy,
// Befehle, Kampf und Cleanup nacheinander, gleichartige Ereignisse jeweils
// gleichzeitig. Die Schüsse im Kampf laufen als Salve kurz versetzt und
// überlappend ab, Einschläge auf dasselbe Ziel mit etwas Abstand, damit man bei
// vollem Brett nachvollziehen kann, wer wen trifft. Die Szene läuft dabei dem Spielzustand voraus; den Endzustand
// übernimmt danach der Server-Snapshot (`MatchController.syncBoard`) — auch
// dann, wenn der Spieler die Animation per `skip` abbricht.

import type { Color3 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { Side } from "../../shared/board.ts";
import { shipById, type CommandId, type ShipId } from "../../shared/cards.ts";
import type { RoundEvent, ShipRef, ShipStats, SlotTarget } from "../../shared/protocol.ts";
import { playSound, stopSounds } from "./audio/sounds.ts";
import { playUiSound } from "./audio/uiSounds.ts";
import { color3 } from "./data/palette.ts";
import type { SoundId } from "./data/sounds.ts";
import { t } from "./i18n/index.ts";
import { destroyShip } from "./scene/destruction.ts";
import { boltDuration } from "./scene/effects.ts";
import type { MatchScene } from "./scene/matchScene.ts";
import { ShipView } from "./scene/ship.ts";
import type { SlotPad } from "./scene/slotPad.ts";
import { setAnimationScope, skipAnimations, tween, wait } from "./scene/tween.ts";
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

/** Waffe je Schiff. */
const SHOT_SOUNDS: Record<ShipId, SoundId> = {
  void_interceptor: "laser_light",
  scrap_raider: "laser_light",
  horizon_cruiser: "laser_medium",
  plasma_frigate: "plasma_shot",
  iron_dreadnought: "cannon_heavy",
  titan_carrier: "laser_medium",
  repair_drone: "laser_light",
  signal_booster: "laser_light",
};
/** Was man von einem Befehl hört, sobald er wirkt; Lane-Wechsel hört man an den Triebwerken, Treffer an den Einschlägen. */
const COMMAND_SOUNDS: Record<CommandId, SoundId | null> = {
  emergency_shields: "shield_up",
  emp_blast: "emp",
  flanking_maneuver: null,
  intercept: "power_up",
  orbital_strike: "orbital_strike",
  overcharge: "power_up",
  power_surge: "power_up",
  recall: "repair",
  scavenge: "scavenge",
  sensor_sweep: null,
  targeting_jammer: "jammer",
  volley_fire: "missile_volley",
};
/** Mitte einer Brettseite (Welt-x), für Sounds ohne Schiff. */
const SIDE_X: Record<Side, number> = { player: -4.5, enemy: 4.5 };

/** Pause zwischen zwei Schritten, damit man sie auseinanderhalten kann. */
const STEP_PAUSE = 200;
/** Abstand zwischen den Starts zweier Schüsse einer Salve. */
const SALVO_STAGGER = 250;
/** Mindestabstand zweier Einschläge auf dasselbe Ziel, damit die Schadenszahlen nicht übereinanderliegen. */
const SAME_TARGET_GAP = 500;
/** So lange steht das Befehls-Banner, bevor die Wirkung einsetzt. */
const BANNER_LEAD = 650;
const SHIP_CENTER = new Vector3(0, 0.15, 0);
const ABOVE_SHIP = new Vector3(0, 0.9, 0);
/** Orbitale Angriffe kommen von oben aus Richtung des Angreifers. */
const ORBIT_OFFSET = new Vector3(0, 9, 0);
/** Schüsse enden nicht im Mittelpunkt, sondern so weit davor auf der Hülle. */
const HULL_RADIUS = 0.45;

/** Ereignisse mit gleichem Schlüssel stehen hintereinander und laufen gemeinsam ab. */
function stepKey(event: RoundEvent): string {
  switch (event.kind) {
    case "deploy":
    case "pass":
      return "deploy";
    case "effect":
    case "draw":
    case "noEffect":
      return `command-${event.side}-${event.cardId}`;
    case "ability":
      return `ability-${event.source.side}-${event.source.lane}-${event.source.slotIndex}`;
    default:
      return event.kind;
  }
}

function groupSteps(events: readonly RoundEvent[]): RoundEvent[][] {
  const steps: RoundEvent[][] = [];
  for (const event of events) {
    const last = steps.at(-1);
    const key = stepKey(event);
    if (last && stepKey(last[0]!) === key) last.push(event);
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
      if (this.isSkipped) {
        this.hud.appendLog(step.map(describeEvent));
        continue;
      }
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
    stopSounds();
    this.floats.clear();
    this.hud.hideBanner();
  }

  private async playStep(step: readonly RoundEvent[]): Promise<void> {
    const first = step[0]!;
    if (first.kind === "attack") return this.salvo(step as Extract<RoundEvent, { kind: "attack" }>[]);
    this.hud.appendLog(step.map(describeEvent));
    if (first.kind === "effect" || first.kind === "draw" || first.kind === "noEffect") {
      this.announceCommand(first);
      await wait(this.view.scene, BANNER_LEAD);
      this.commandSound(first);
    } else if (first.kind === "ability") {
      this.hud.showBanner(t.banner.command(t.log.who[first.source.side], t.ships[first.source.cardId].name), null, first.source.side);
      await wait(this.view.scene, BANNER_LEAD);
    }
    await Promise.all(step.map((event) => this.playEvent(event)));
  }

  /**
   * Die Schüsse starten im Abstand `SALVO_STAGGER` und kommen dabei je Schuss ins Log; ein Schuss wartet
   * zusätzlich, bis sein Einschlag `SAME_TARGET_GAP` nach dem vorigen auf dasselbe Ziel liegt. So treffen
   * die Schüsse jedes Ziel in der gemeldeten Reihenfolge, und die Statusbalken springen nicht zurück.
   */
  private async salvo(shots: readonly Extract<RoundEvent, { kind: "attack" }>[]): Promise<void> {
    const impacts = new Map<SlotPad, number>();
    let start = -SALVO_STAGGER;
    await Promise.all(
      shots.map((shot) => {
        const origin = this.centerOf(this.padOf(shot.attacker));
        const target = this.padOf(shot.target);
        const flight = boltDuration(origin, this.impactFrom(target, origin));
        start = Math.max(start + SALVO_STAGGER, (impacts.get(target) ?? -Infinity) + SAME_TARGET_GAP - flight);
        impacts.set(target, start + flight);
        return wait(this.view.scene, start).then(() => {
          this.hud.appendLog([describeEvent(shot)]);
          return this.playEvent(shot);
        });
      }),
    );
  }

  private announceCommand(event: Extract<RoundEvent, { kind: "effect" | "draw" | "noEffect" }>): void {
    const title = t.banner.command(t.log.who[event.side], t.commands[event.cardId].name);
    const subtitle =
      event.kind === "noEffect" ? t.banner.noEffect : event.kind === "draw" ? t.banner.draw(event.ships, event.commands) : null;
    this.hud.showBanner(title, subtitle, event.side);
  }

  /** Einmal je Befehl, auch wenn er mehrere Schiffe trifft; ohne Wirkung verpufft er hörbar. */
  private commandSound(event: Extract<RoundEvent, { kind: "effect" | "draw" | "noEffect" }>): void {
    const sound = COMMAND_SOUNDS[event.cardId];
    if (event.kind === "noEffect") playUiSound("denied");
    else if (sound) playSound(sound, { x: event.kind === "effect" ? this.centerOf(this.padOf(event.ship)).x : SIDE_X[event.side] });
  }

  private async playEvent(event: RoundEvent): Promise<void> {
    switch (event.kind) {
      case "deploy":
        return this.deploy(event.side, event.cardId, event.target);
      case "effect":
        return this.effect(event);
      case "ability":
        return this.ability(event);
      case "attack": {
        const color = SIDE_COLORS[event.attacker.side];
        const origin = this.centerOf(this.padOf(event.attacker));
        await this.shoot(origin, this.padOf(event.target), color, SHOT_SOUNDS[event.attacker.cardId]);
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

  /** Erst ein Impuls an der Quelle, dann die Reparatur am Ziel. */
  private async ability(event: Extract<RoundEvent, { kind: "ability" }>): Promise<void> {
    const pad = this.padOf(event.ship);
    const source = this.centerOf(this.padOf(event.source));
    playSound("repair", { x: source.x });
    await this.view.effects.pulse(source, SIDE_COLORS[event.source.side], 1.2, 350);
    pad.ship!.setStats(event.after.hp, event.after.shield);
    return this.mark(pad, t.float.heal(event.effect.amount), "heal");
  }

  /** Mündungsblitz und Schuss bei `origin`, dann fliegt der Bolzen bis auf die Hülle des Ziels. */
  private async shoot(origin: Vector3, to: SlotPad, color: Color3, sound: SoundId): Promise<void> {
    playSound(sound, { x: origin.x });
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

  /** Der Anker übernimmt das Schiff sofort, es fliegt von seiner alten Stelle aus in den neuen Slot. */
  private async move(from: SlotPad, to: SlotPad): Promise<void> {
    const ship = from.detachShip();
    const start = ship.root.getAbsolutePosition().clone();
    to.attachShip(ship);
    ship.root.setAbsolutePosition(start);
    await ship.maneuver();
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
