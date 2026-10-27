// Spielt die aufgedeckten Ereignisse einer Runde auf dem Brett ab: Deploy, Admiralsfähigkeiten,
// Zielerfassung, Manöver, Befehle, Kampf und Cleanup nacheinander, gleichartige Ereignisse jeweils
// gleichzeitig. Die Schüsse im Kampf laufen als Salve kurz versetzt und
// überlappend ab, Einschläge auf dasselbe Ziel mit etwas Abstand, damit man bei
// vollem Brett nachvollziehen kann, wer wen trifft; vor ihnen feuert die Railgun, dann der Taktvorsprung,
// nach ihnen schlägt das Gegenfeuer zurück. Angriffsbefehle unterscheiden sich im Bild: Orbitalschlag, Torpedo und
// Sperrfeuer kommen von oben, der Wärmesucher als Rakete, das Minenfeld explodiert am Schiff, der Durchschlag geht als
// Strahl durch beide Schiffe einer Slot-Nummer, das Bombardement schlägt mehrfach ein, das Kreuzfeuer kommt von beiden
// Seiten, der Gnadenstoß als heller Präzisionsschuss. Der Bordfunk kündigt Schritte an und reagiert auf ihren
// Ausgang (`radioCues.ts`). Die Szene läuft dabei dem Spielzustand voraus; den Endzustand
// übernimmt danach der Server-Snapshot (`MatchController.syncBoard`) — auch
// dann, wenn der Spieler die Animation per `skip` abbricht.

import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { AdmiralId, PowerId } from "../../shared/admirals.ts";
import type { Side } from "../../shared/board.ts";
import { shipById, type CommandId, type ShipId } from "../../shared/cards.ts";
import type { CommandEffect, RoundEvent, ShipRef, ShipStats, SlotRef, SlotTarget } from "../../shared/protocol.ts";
import { say, silenceRadio } from "./audio/radio.ts";
import { playSound, stopSounds } from "./audio/sounds.ts";
import { playUiSound } from "./audio/uiSounds.ts";
import { flagshipAdmiral, powerAdmiral } from "./data/admirals.ts";
import { color3 } from "./data/palette.ts";
import type { SoundId } from "./data/sounds.ts";
import { admiralTitle, t } from "./i18n/index.ts";
import { announcement, reactions } from "./radioCues.ts";
import { destroyShip } from "./scene/destruction.ts";
import { boltDuration, type HitName } from "./scene/effects.ts";
import type { MatchScene } from "./scene/matchScene.ts";
import { ShipView } from "./scene/ship.ts";
import type { SlotPad } from "./scene/slotPad.ts";
import { setAnimationScope, skipAnimations, wait } from "./scene/tween.ts";
import type { FloatingTexts, FloatTone } from "./ui/floatingText.ts";
import type { Hud } from "./ui/hud.ts";
import { describeEvent, ruleSubtitle, slotLabel } from "./ui/roundLog.ts";

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
/** Schüsse, die eine Admiralsfähigkeit lenkt oder beschleunigt, ziehen ihre Leuchtspur in der Farbe ihres Admirals. */
const POWER_TRACERS = { focus: color3("vance"), swarm: color3("halvorsen"), headStart: color3("kerr") } as const;

/** Waffe je Schiff; das Trugbild feuert nie. */
const SHOT_SOUNDS: Record<ShipId, SoundId> = {
  void_interceptor: "laser_light",
  scrap_raider: "laser_light",
  horizon_cruiser: "laser_medium",
  plasma_frigate: "plasma_shot",
  iron_dreadnought: "cannon_heavy",
  titan_carrier: "laser_medium",
  repair_drone: "laser_light",
  signal_booster: "laser_light",
  drone: "laser_light",
  decoy: "laser_light",
  bastion: "cannon_heavy",
  vanguard: "laser_medium",
  hive: "laser_medium",
  mirage: "laser_light",
  pendulum: "cannon_heavy",
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
  targeting_jammer: "jammer",
  volley_fire: "missile_volley",
  torpedo: "orbital_strike",
  barrage: "missile_volley",
  evasive_action: null,
  micro_jump: "power_up",
  rapid_deployment: null,
  draw_fire: "jammer",
  shield_grid: "shield_up",
  ablative_armor: "shield_up",
  covering_fire: "power_up",
  drone_squadron: null,
  collision_course: null,
  countermeasures: "emp",
  carte_blanche: null,
  radio_silence: "jammer",
  minefield: null,
  tractor_beam: "power_up",
  heat_seeker: "missile_volley",
  coup_de_grace: "orbital_strike",
  piercing_shot: "cannon_heavy",
  bombardment: "orbital_strike",
  crossfire: "laser_medium",
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
/** Durchmesser der Schildblase des Wächterschilds. */
const GUARDIAN_BUBBLE = 2.1;
/** Der Zielstrahl der Zielerfassung ist dünner als der Schuss der Railgun. */
const LOCK_BEAM_WIDTH = 0.35;
/** Der Wärmesucher startet so weit vor der eigenen Strike-Lane (Welt-x zur Mitte), knapp über dem Brett. */
const MISSILE_LAUNCH = new Vector3(0, 0.8, 0);
/** Minenfeld: erst glimmt die Mine unter dem Schiff auf (ms), dann explodiert sie. */
const MINE_FUSE = 260;
/** Bombardement: so viele Einschläge je Schiff, im Abstand (ms) und um so viel versetzt. */
const BOMBARD_SHELLS = 3;
const BOMBARD_STAGGER = 140;
const BOMBARD_SPREAD = 0.45;
/** Kreuzfeuer: Die beiden Schüsse kommen so weit seitlich entlang der Lane und so hoch. */
const CROSSFIRE_REACH = 4;
const CROSSFIRE_HEIGHT = 1.4;
/** Gnadenstoß: ein dünner, fast weißer Strahl. */
const COUP_BEAM_WIDTH = 0.55;
/** Durchschlag: Der Strahl beginnt über der Mitte der eigenen Seite und tritt so weit hinter dem hinteren Slot aus. */
const PIERCE_OVERSHOOT = 2.5;
/** Rammkurs: Der Rammer hält so weit vor der Mitte des Ziels (Welteinheiten), dort kracht es. */
const RAM_STANDOFF = 1.1;
const RAM_BLAST = 0.6;
const RAM_SHAKE = 0.3;
/** Kurzsprung: Lichtpunkt am Ort des Absprungs und der Rückkehr. */
const JUMP_PULSE = 1.5;
/** Traktorstrahl: Er greift von hoch über der eigenen Seite und hält kurz, bevor er zieht (ms). */
const TRACTOR_ORIGIN = new Vector3(0, 3.5, 0);
const TRACTOR_GRIP = 350;

/** Was ein Befehl bewirkt hat; danach richten sich Banner und Klang. */
type CommandOutcome = Extract<RoundEvent, { kind: "effect" | "draw" | "noEffect" | "miss" | "countered" | "rule" }>;
const COMMAND_OUTCOMES: ReadonlySet<RoundEvent["kind"]> = new Set(["effect", "draw", "noEffect", "miss", "countered", "rule"]);
const isCommandOutcome = (event: RoundEvent): event is CommandOutcome => COMMAND_OUTCOMES.has(event.kind);
/** Ein Schuss einer Salve: im Kampf vom Angreifer aufs Ziel, beim Gegenfeuer vom getroffenen Schiff auf den Schützen. */
type Shot = Extract<RoundEvent, { kind: "attack" | "counterfire" }>;

const shooterOf = (shot: Shot): ShipRef => (shot.kind === "attack" ? shot.attacker : shot.source);
const targetOf = (shot: Shot): ShipRef => (shot.kind === "attack" ? shot.target : shot.ship);

function bannerSubtitle(event: CommandOutcome): string | null {
  switch (event.kind) {
    case "noEffect":
      return t.banner.noEffect;
    case "draw":
      return t.banner.draw(event.ships, event.commands);
    case "miss":
      return t.banner.miss(slotLabel(event.target));
    case "countered":
      return t.banner.countered(t.commands[event.countered].name);
    case "rule":
      return ruleSubtitle(event.cardId);
    case "effect":
      return null;
  }
}

/** Der Slot, an dem ein Befehl wirkt: das getroffene Schiff oder beim Fehlschuss der leere Slot. */
function eventSlot(event: Extract<CommandOutcome, { kind: "effect" | "miss" }>): SlotRef {
  return event.kind === "effect" ? event.ship : event.target;
}

/**
 * Ereignisse mit gleichem Schlüssel stehen hintereinander und laufen gemeinsam ab. Das Trugbild erscheint im Schritt
 * seiner Fähigkeit, der Phasentausch fliegt mit den Manövern, die Schüsse mit Taktvorsprung bilden eine eigene Salve.
 */
function stepKey(event: RoundEvent): string {
  switch (event.kind) {
    case "deploy":
    case "pass":
      return "deploy";
    case "power":
    case "mark":
      return `${event.kind}-${event.side}`;
    case "decoy":
      return `power-${event.ship.side}`;
    case "swap":
      return "maneuver";
    case "effect":
    case "draw":
    case "noEffect":
    case "miss":
    case "countered":
    case "rule":
      return `command-${event.side}-${event.cardId}`;
    case "ability":
      return `ability-${event.source.side}-${event.source.lane}-${event.source.slotIndex}`;
    case "spawn":
      return `spawn-${event.source.side}`;
    case "attack":
      return event.headStart ? "attack-headStart" : "attack";
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

/** Schritte des Kampfs laufen mit dem Regler für Angriffe. */
const COMBAT_KINDS: ReadonlySet<RoundEvent["kind"]> = new Set(["attack", "railgun", "silenced", "counterfire"]);

/** Schlüssel eines Slots, um Ereignisse am selben Schiff nacheinander abzuspielen. */
const slotKey = (slot: SlotRef): string => `${slot.side}-${slot.lane}-${slot.slotIndex}`;

export class RoundPlayback {
  private isSkipped = false;
  /** Schiffe im Kurzsprung, nach ihrem Slot: Sie verlassen das Brett und kehren im Cleanup zurück (`return`). */
  private readonly jumped = new Map<string, ShipView>();

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
      setAnimationScope(COMBAT_KINDS.has(step[0]!.kind) ? "attack" : "general");
      await this.playStep(step);
      await wait(this.view.scene, STEP_PAUSE);
    }
    // Übersprungen, bevor sie zurück waren: Der Server-Snapshot stellt sie neu auf.
    for (const ship of this.jumped.values()) ship.dispose();
    this.jumped.clear();
    setAnimationScope("general");
    skipAnimations(false);
  }

  /** Bricht die laufende Runde ab: Animationen springen ans Ende, die restlichen Schritte landen nur noch im Log. */
  skip(): void {
    this.isSkipped = true;
    skipAnimations(true);
    stopSounds();
    silenceRadio();
    this.floats.clear();
    this.hud.hideBanner();
  }

  /** Ein Schritt samt Bordfunk: die Ankündigung zusammen mit dem Banner, die Reaktion, sobald er abgespielt ist. */
  private async playStep(step: readonly RoundEvent[]): Promise<void> {
    const cue = announcement(step);
    if (cue) say(cue);
    await this.playEvents(step);
    for (const reaction of reactions(step)) say(reaction);
  }

  private async playEvents(step: readonly RoundEvent[]): Promise<void> {
    const first = step[0]!;
    if (first.kind === "attack" && first.headStart) this.announce(first.attacker.side, t.powers.head_start.name, null, "kerr");
    if (first.kind === "counterfire") this.announce(first.source.side, t.powers.counterfire.name, null, "osei");
    if (first.kind === "attack" || first.kind === "counterfire") {
      if (first.kind === "counterfire" || first.headStart) await wait(this.view.scene, BANNER_LEAD);
      return this.salvo(step as Shot[]);
    }
    this.hud.appendLog(step.map(describeEvent));
    if (isCommandOutcome(first)) {
      this.announceCommand(first);
      await wait(this.view.scene, BANNER_LEAD);
      this.commandSound(first);
      if (first.cardId === "piercing_shot") this.pierceBeam(first.side, step);
      return this.inSequence(step);
    }
    if (first.kind === "ability" || first.kind === "spawn" || first.kind === "railgun") {
      const admiral = flagshipAdmiral(first.source.cardId);
      const subtitle = first.kind === "railgun" && first.blocked ? t.banner.blocked : admiral && t.admirals[admiral].ability;
      this.announce(first.source.side, t.ships[first.source.cardId].name, subtitle, admiral);
      await wait(this.view.scene, BANNER_LEAD);
    } else if (first.kind === "power") {
      const admiral = powerAdmiral(first.power);
      this.announce(first.side, t.powers[first.power].name, admiralTitle(admiral), admiral);
      await wait(this.view.scene, BANNER_LEAD);
    } else if (first.kind === "mark") {
      this.announce(first.side, t.hud.markButton, t.banner.markTarget(t.ships[first.ship.cardId].name), "kerr");
      await wait(this.view.scene, BANNER_LEAD);
    }
    await Promise.all(step.map((event) => this.playEvent(event)));
  }

  /**
   * Die Wirkungen eines Befehls: an verschiedenen Schiffen gleichzeitig, am selben Schiff nacheinander, damit Impulse
   * und Schwebetexte nicht übereinanderliegen (Feuerschutz: ATK, dann Schild). Ein verlegtes Schiff nimmt seine Kette
   * in den neuen Slot mit (Ausweichmanöver: erst der Flug, dann der Schild).
   */
  private async inSequence(step: readonly RoundEvent[]): Promise<void> {
    const chains = new Map<string, Promise<void>>();
    for (const event of step) {
      const key = event.kind === "effect" ? slotKey(event.ship) : event.kind;
      const chain = (chains.get(key) ?? Promise.resolve()).then(() => this.playEvent(event));
      chains.set(key, chain);
      if (event.kind === "effect" && event.effect.type === "move") chains.set(slotKey({ side: event.ship.side, ...event.effect.to }), chain);
    }
    await Promise.all(chains.values());
  }

  private announce(side: Side, name: string, subtitle: string | null, admiral: AdmiralId | null): void {
    this.hud.showBanner(t.banner.command(t.log.who[side], name), subtitle, side, admiral);
  }

  /**
   * Die Schüsse starten im Abstand `SALVO_STAGGER` und kommen dabei je Schuss ins Log; ein Schuss wartet
   * zusätzlich, bis sein Einschlag `SAME_TARGET_GAP` nach dem vorigen auf dasselbe Ziel liegt. So treffen
   * die Schüsse jedes Ziel in der gemeldeten Reihenfolge, und die Statusbalken springen nicht zurück.
   */
  private async salvo(shots: readonly Shot[]): Promise<void> {
    const impacts = new Map<SlotPad, number>();
    let start = -SALVO_STAGGER;
    await Promise.all(
      shots.map((shot) => {
        const origin = this.centerOf(this.padOf(shooterOf(shot)));
        const target = this.padOf(targetOf(shot));
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

  private announceCommand(event: CommandOutcome): void {
    const title = t.banner.command(t.log.who[event.side], t.commands[event.cardId].name);
    this.hud.showBanner(title, bannerSubtitle(event), event.side);
  }

  /** Einmal je Befehl, auch wenn er mehrere Schiffe trifft; ohne Wirkung verpufft er hörbar, der Torpedo ins Leere am Slot. */
  private commandSound(event: CommandOutcome): void {
    const sound = COMMAND_SOUNDS[event.cardId];
    if (event.kind === "noEffect") return playUiSound("denied");
    if (!sound) return;
    playSound(sound, { x: event.kind === "effect" || event.kind === "miss" ? this.centerOf(this.padOf(eventSlot(event))).x : SIDE_X[event.side] });
  }

  private async playEvent(event: RoundEvent): Promise<void> {
    switch (event.kind) {
      case "deploy":
        return this.deploy(event.side, event.cardId, event.target);
      case "power":
        return this.power(event);
      case "decoy":
        return this.decoy(event);
      case "mark":
        return this.lock(event);
      case "maneuver":
        return this.maneuver(event);
      case "swap":
        return this.swap(event);
      case "effect":
        return this.effect(event);
      case "miss":
        return this.miss(event);
      case "ability":
        return this.ability(event);
      case "spawn":
        return this.spawn(event);
      case "railgun":
        return this.railgun(event);
      case "attack": {
        const color = event.focus ? POWER_TRACERS.focus : event.swarm ? POWER_TRACERS.swarm : event.headStart ? POWER_TRACERS.headStart : SIDE_COLORS[event.attacker.side];
        const origin = this.centerOf(this.padOf(event.attacker));
        await this.shoot(origin, this.padOf(event.target), color, SHOT_SOUNDS[event.attacker.cardId]);
        return this.damage(event.target, event.amount, event.after, origin, color);
      }
      case "silenced":
        return this.silence(event.ship);
      case "counterfire": {
        const color = color3("osei");
        const origin = this.centerOf(this.padOf(event.source));
        await this.shoot(origin, this.padOf(event.ship), color, "laser_light");
        return this.damage(event.ship, event.amount, event.after, origin, color);
      }
      case "selfDamage":
        return this.damage(event.ship, event.amount, event.after, this.centerOf(this.padOf(event.ship)).add(ORBIT_OFFSET), TONE_COLORS.damage);
      case "destroyed":
        return this.destroy(event.ship);
      case "vanish":
        return this.vanish(this.padOf(event.ship));
      case "return":
        return this.rejoin(event);
      case "pass":
      case "command":
      case "draw":
      case "noEffect":
      case "countered":
      case "rule":
        return;
    }
  }

  // --- Einzelne Ereignisse ---

  private async deploy(side: Side, cardId: ShipId, target: SlotTarget): Promise<void> {
    await this.view.deploy(new ShipView(this.view.scene, shipById(cardId), false), side, target.lane, target.slotIndex);
  }

  /** Admiralsfähigkeit: Ihre Marke fällt auf das gewählte Schiff und bleibt bis zum Rundenende; das Trugbild erscheint für sich (`decoy`). */
  private async power(event: Extract<RoundEvent, { kind: "power" }>): Promise<void> {
    if (event.power === "decoy") return;
    const pad = this.padOf(event.target);
    playSound("power_up", { x: this.centerOf(pad).x });
    await pad.ship!.addMarker({ kind: event.power, color: color3(powerAdmiral(event.power)) });
  }

  /** Trugbild: Das Hologramm baut sich im gewählten Strike-Slot auf. */
  private async decoy(event: Extract<RoundEvent, { kind: "decoy" }>): Promise<void> {
    const pad = this.padOf(event.ship);
    const ship = new ShipView(this.view.scene, shipById("decoy"), false);
    pad.attachShip(ship);
    const center = this.centerOf(pad);
    playSound("shield_up", { x: center.x });
    void this.view.effects.pulse(center, color3("moreau"), 1.6, 700);
    this.float(pad, t.float.decoy, "buff");
    await ship.materialize();
  }

  /** Zielerfassung: ein dünner Zielstrahl von der Pendulum, dann zieht sich das Fadenkreuz um das Ziel zusammen. */
  private async lock(event: Extract<RoundEvent, { kind: "mark" }>): Promise<void> {
    const pad = this.padOf(event.ship);
    const color = color3("kerr");
    const pendulum = this.view.pads.find((candidate) => candidate.slot.lane.side === event.side && candidate.ship?.card.id === "pendulum");
    playSound("jammer", { x: this.centerOf(pad).x });
    if (pendulum) void this.view.effects.beam(this.centerOf(pendulum), this.centerOf(pad), color, LOCK_BEAM_WIDTH);
    this.float(pad, t.float.locked, "debuff");
    await pad.ship!.addMarker({ kind: "lock", color });
  }

  /** Grundmanöver: Flug in den neuen Slot, danach sind die Balken gedämpft, bis die Runde vorbei ist (`MatchController.syncBoard`). */
  private async maneuver(event: Extract<RoundEvent, { kind: "maneuver" }>): Promise<void> {
    const to = this.view.pad(event.side, event.to.lane, event.to.slotIndex);
    await this.move(this.padOf(event.ship), to);
    to.ship!.setHoldingFire(true);
    return this.mark(to, t.float.holdFire, "debuff");
  }

  /** Phasentausch: Beide Schiffe schrumpfen zu Lichtpunkten und erscheinen im Slot des anderen; beide feuern weiter. */
  private async swap(event: Extract<RoundEvent, { kind: "swap" }>): Promise<void> {
    const a = this.padOf(event.a);
    const b = this.padOf(event.b);
    const color = color3("moreau");
    playSound("power_up", { x: this.centerOf(a).x });
    for (const pad of [a, b]) void this.view.effects.pulse(this.centerOf(pad), color, 1.5, 450);
    await Promise.all([a.ship!.phaseOut(), b.ship!.phaseOut()]);
    const mirage = a.detachShip();
    const partner = b.detachShip();
    a.attachShip(partner);
    b.attachShip(mirage);
    for (const pad of [a, b]) void this.view.effects.pulse(this.centerOf(pad), color, 1.5, 450);
    await Promise.all([mirage.phaseIn(), partner.phaseIn()]);
  }

  private async effect(event: Extract<RoundEvent, { kind: "effect" }>): Promise<void> {
    const pad = this.padOf(event.ship);
    const { effect, after } = event;
    switch (effect.type) {
      case "damage":
        return this.strike(event, effect.amount);
      case "attack":
        return this.mark(pad, t.float.attack(effect.delta), effect.delta > 0 ? "buff" : "debuff");
      case "shield":
        pad.ship!.setStats(after.hp, after.shield);
        return this.mark(pad, effect.permanent ? t.float.shieldPermanent(effect.amount) : t.float.shield(effect.amount), "shield", 2.2);
      case "disable":
        return this.mark(pad, t.float.disabled, "debuff");
      case "heal":
        pad.ship!.setStats(after.hp, after.shield);
        return this.mark(pad, t.float.heal(effect.amount), "heal");
      case "move": {
        const to = this.view.pad(event.ship.side, effect.to.lane, effect.to.slotIndex);
        return event.ship.side === event.side ? this.move(pad, to) : this.tow(event.side, pad, to);
      }
      case "jump":
        return this.jump(event.ship);
      case "taunt":
        this.float(pad, t.float.taunt, "debuff");
        void this.view.effects.pulse(this.centerOf(pad), SIDE_COLORS[event.side], 1.8, 650);
        return pad.ship!.addMarker({ kind: "taunt", color: SIDE_COLORS[event.side] });
      case "spawn":
        return this.view.deploy(new ShipView(this.view.scene, shipById(event.ship.cardId), false), event.ship.side, event.ship.lane, event.ship.slotIndex);
      case "ram":
        return this.ram(pad, event.ship, effect, after);
      case "jam":
        return this.jam(pad, effect.power);
    }
  }

  /**
   * Schaden durch einen Befehl, je Karte anders ins Bild gesetzt: Orbitalschlag, Torpedo und Sperrfeuer kommen als Bolzen
   * von oben, die übrigen siehe `roundPlayback`-Kopf. Der Durchschlag zieht seinen Strahl einmal für beide Schiffe
   * (`pierceBeam`); hier trifft er nur noch ein.
   */
  private async strike(event: Extract<RoundEvent, { kind: "effect" }>, amount: number): Promise<void> {
    const pad = this.padOf(event.ship);
    const center = this.centerOf(pad);
    const color = SIDE_COLORS[event.side];
    const hit = (origin: Vector3, name?: HitName) => this.damage(event.ship, amount, event.after, origin, color, name);
    switch (event.cardId) {
      case "heat_seeker": {
        const origin = this.ownStrikeFront(event.side, center);
        await this.view.effects.missile(origin, this.impactFrom(pad, origin.add(ORBIT_OFFSET)), color);
        return hit(origin.add(ORBIT_OFFSET), "fireball");
      }
      case "minefield": {
        const floor = pad.root.getAbsolutePosition();
        await this.view.effects.pulse(floor, TONE_COLORS.damage, 0.9, MINE_FUSE);
        this.view.shake(0.08);
        return hit(center.add(new Vector3(0, 1, 0)), "fireball");
      }
      case "piercing_shot":
        return hit(this.pierceOrigin(event.side, center), "pierce");
      case "bombardment": {
        const origin = center.add(ORBIT_OFFSET);
        const shells = Array.from({ length: BOMBARD_SHELLS }, (_, index) => {
          const offset = new Vector3((Math.random() - 0.5) * 2, 0, (Math.random() - 0.5) * 2).scale(BOMBARD_SPREAD);
          return wait(this.view.scene, index * BOMBARD_STAGGER).then(async () => {
            const impact = this.impactFrom(pad, origin).add(offset);
            await this.view.effects.bolt(origin.add(offset), impact, color);
            if (index < BOMBARD_SHELLS - 1) await Promise.all([pad.ship!.flash(0.4), this.view.effects.hit(impact, origin, color, "fire")]);
          });
        });
        await Promise.all(shells);
        return hit(origin, "fireball");
      }
      case "crossfire": {
        const sides = [1, -1].map((direction) => center.add(new Vector3(0, CROSSFIRE_HEIGHT, direction * CROSSFIRE_REACH)));
        await Promise.all(sides.map((origin) => this.shoot(origin, pad, color, "laser_medium")));
        void this.view.effects.hit(this.impactFrom(pad, sides[1]!), sides[1]!, color, "sparks");
        return hit(sides[0]!, "sparks");
      }
      case "coup_de_grace": {
        const origin = center.add(ORBIT_OFFSET);
        const bright = Color3.Lerp(color, Color3.White(), 0.75);
        void this.view.effects.pulse(this.impactFrom(pad, origin), bright, 1.4, 300);
        void this.view.effects.beam(origin, this.impactFrom(pad, origin), bright, COUP_BEAM_WIDTH);
        this.view.shake(0.1);
        return hit(origin, "discharge");
      }
      default: {
        const origin = center.add(ORBIT_OFFSET);
        await this.view.effects.bolt(origin, this.impactFrom(pad, origin), color);
        return hit(origin);
      }
    }
  }

  /** Durchschlag: ein gerader Strahl über die ganze Slot-Nummer, durch beide Schiffe hindurch, einmal je Befehl. */
  private pierceBeam(side: Side, step: readonly RoundEvent[]): void {
    const first = step.find((event) => event.kind === "effect" || event.kind === "miss");
    if (!first) return;
    const slot = first.kind === "effect" ? first.ship : first.target;
    const back = this.centerOf(this.view.pad(slot.side, "command", slot.slotIndex));
    const origin = this.pierceOrigin(side, back);
    const exit = back.add(new Vector3(Math.sign(back.x - origin.x) * PIERCE_OVERSHOOT, 0, 0));
    playSound("cannon_heavy", { x: origin.x, rate: 0.9 });
    void this.view.effects.pulse(origin, SIDE_COLORS[side], 1, 260);
    void this.view.effects.beam(origin, exit, SIDE_COLORS[side], 0.8);
    this.view.shake(0.1);
  }

  /** Woher der Durchschlag kommt: aus der Mitte der Seite, die ihn spielt, auf Höhe von `target`. */
  private pierceOrigin(side: Side, target: Vector3): Vector3 {
    return new Vector3(SIDE_X[side], target.y, target.z);
  }

  /** Startpunkt des Wärmesuchers: vor der eigenen Strike-Lane, auf Höhe des Ziels. */
  private ownStrikeFront(side: Side, target: Vector3): Vector3 {
    const strike = this.centerOf(this.view.pad(side, "strike", 0));
    return new Vector3(strike.x, 0, target.z).add(MISSILE_LAUNCH);
  }

  /**
   * Der Torpedo kommt von oben wie ein Orbitalschlag und schlägt im leeren Slot ein. Der Durchschlag hat seinen Strahl
   * schon gezogen (`pierceBeam`); am leeren Strike-Slot bleibt nur das „Daneben“.
   */
  private async miss(event: Extract<RoundEvent, { kind: "miss" }>): Promise<void> {
    const pad = this.padOf(event.target);
    this.float(pad, t.float.miss, "debuff");
    if (event.cardId === "piercing_shot") return;
    const color = SIDE_COLORS[event.side];
    const point = this.centerOf(pad);
    const origin = point.add(ORBIT_OFFSET);
    await this.view.effects.bolt(origin, point, color);
    await this.view.effects.hit(point, origin, color);
  }

  /** Kurzsprung: Das Schiff schrumpft zu einem Lichtpunkt und verlässt das Brett; die ShipView wartet auf `return`. */
  private async jump(ref: ShipRef): Promise<void> {
    const pad = this.padOf(ref);
    const ship = pad.ship!;
    const center = this.centerOf(pad);
    void this.view.effects.pulse(center, TONE_COLORS.shield, JUMP_PULSE, 450);
    this.float(pad, t.float.jump, "shield");
    await ship.phaseOut();
    pad.detachShip();
    ship.root.setEnabled(false);
    this.jumped.set(slotKey(ref), ship);
  }

  /** Rückkehr aus dem Kurzsprung: Das Schiff erscheint als Lichtpunkt im Slot und wächst auf seine Größe. */
  private async rejoin(event: Extract<RoundEvent, { kind: "return" }>): Promise<void> {
    const key = slotKey(event.ship);
    const ship = this.jumped.get(key)!;
    this.jumped.delete(key);
    const pad = this.padOf(event.ship);
    pad.attachShip(ship);
    ship.root.setEnabled(true);
    ship.setStats(event.after.hp, event.after.shield);
    playSound("power_up", { x: this.centerOf(pad).x });
    void this.view.effects.pulse(this.centerOf(pad), TONE_COLORS.shield, JUMP_PULSE, 450);
    await ship.phaseIn();
  }

  /**
   * Rammkurs: Der Rammer fliegt auf sein Ziel zu, beim Aufprall kracht es mit Explosion und Kamerawackeln, beide zeigen
   * ihren Schaden. Übersteht er es, kehrt er in seinen Slot zurück und feuert diese Runde nicht; sonst bleibt er bis
   * zu seiner Zerstörung am Ziel liegen.
   */
  private async ram(pad: SlotPad, ref: ShipRef, effect: Extract<CommandEffect, { type: "ram" }>, after: ShipStats): Promise<void> {
    const ship = pad.ship!;
    const targetPad = this.padOf(effect.target);
    const target = targetPad.ship!;
    const from = pad.shipAnchor.getAbsolutePosition();
    const goal = targetPad.shipAnchor.getAbsolutePosition();
    const stop = goal.subtract(goal.subtract(from).normalize().scale(RAM_STANDOFF));
    await ship.charge(stop);
    const impact = Vector3.Center(stop, goal).add(SHIP_CENTER);
    this.view.shake(RAM_SHAKE);
    void this.view.effects.detonate(impact, TONE_COLORS.damage, RAM_BLAST, "fire");
    ship.setStats(after.hp, after.shield);
    target.setStats(effect.targetAfter.hp, effect.targetAfter.shield);
    this.float(targetPad, t.float.damage(effect.dealt), "damage");
    this.floatAt(stop.add(SHIP_CENTER), t.float.damage(effect.taken), "damage");
    await Promise.all([ship.flash(), target.flash(), this.view.effects.hit(impact, this.centerOf(pad), TONE_COLORS.damage, "fireball")]);
    if (after.hp <= 0) return;
    await ship.withdraw();
    ship.setHoldingFire(true);
    return this.mark(this.padOf(ref), t.float.holdFire, "debuff");
  }

  /**
   * Funkstille: Die gegnerische Admiralsfähigkeit auf dem Schiff fällt weg, ihre Marke erlischt. Das Trugbild löst
   * sich sofort auf wie am Rundenende.
   */
  private async jam(pad: SlotPad, power: PowerId): Promise<void> {
    this.float(pad, t.float.jammed, "debuff");
    if (power === "decoy") return this.vanish(pad);
    pad.ship!.removeMarker(power);
    await this.view.effects.pulse(this.centerOf(pad), TONE_COLORS.debuff, 1.6, 650);
  }

  /**
   * Traktorstrahl: Ein Strahl greift von hoch über der Seite, die ihn spielt, nach dem gegnerischen Schiff, hält es kurz
   * und zieht es dann ruhig in den neuen Slot.
   */
  private async tow(side: Side, from: SlotPad, to: SlotPad): Promise<void> {
    const ship = from.ship!;
    const origin = new Vector3(SIDE_X[side], 0, this.centerOf(from).z).add(TRACTOR_ORIGIN);
    const release = this.view.effects.tether(origin, () => ship.root.getAbsolutePosition().add(SHIP_CENTER), SIDE_COLORS[side]);
    void this.view.effects.pulse(this.centerOf(from), SIDE_COLORS[side], 1.3, 400);
    await wait(this.view.scene, TRACTOR_GRIP);
    await this.move(from, to, true);
    await release();
  }

  /**
   * Plasma Frigate: ein Schuss auf das Ziel. Repair Drone: erst ein Impuls an der Quelle, dann die Reparatur
   * am Ziel. Scrap Raider: der Bonus leuchtet am Raider selbst auf. Bastion: Die Schildblase des Wächterschilds
   * legt sich um sie und das Schiff vor ihr.
   */
  private async ability(event: Extract<RoundEvent, { kind: "ability" }>): Promise<void> {
    const pad = this.padOf(event.ship);
    const source = this.centerOf(this.padOf(event.source));
    const { effect, after } = event;
    switch (effect.type) {
      case "damage": {
        const color = SIDE_COLORS[event.source.side];
        await this.shoot(source, pad, color, SHOT_SOUNDS[event.source.cardId]);
        return this.damage(event.ship, effect.amount, after, source, color);
      }
      case "heal":
        playSound("repair", { x: source.x });
        await this.view.effects.pulse(source, SIDE_COLORS[event.source.side], 1.2, 350);
        pad.ship!.setStats(after.hp, after.shield);
        return this.mark(pad, t.float.heal(effect.amount), "heal");
      case "attack":
        playSound("power_up", { x: source.x });
        return this.mark(pad, t.float.attack(effect.delta), "buff");
      case "shield":
        playSound("shield_up", { x: source.x });
        pad.ship!.setStats(after.hp, after.shield);
        this.float(pad, t.float.shield(effect.amount), "shield");
        return this.view.effects.bubble(this.centerOf(pad), color3("osei"), GUARDIAN_BUBBLE);
    }
  }

  /** Titan Carrier beim Deploy, Hive am Rundenende: Die Drohne startet am Träger und fliegt in ihren Slot. */
  private async spawn(event: Extract<RoundEvent, { kind: "spawn" }>): Promise<void> {
    const ship = new ShipView(this.view.scene, shipById(event.ship.cardId), false);
    this.padOf(event.ship).attachShip(ship);
    ship.root.setAbsolutePosition(this.padOf(event.source).shipAnchor.getAbsolutePosition());
    await ship.maneuver();
  }

  /**
   * Railgun: Ein Strahl schießt von der Pendulum auf das erfasste Schiff, das Fadenkreuz ist damit verbraucht. Ist
   * das Ziel gedeckt, bricht der Strahl am deckenden Schiff davor ab.
   */
  private async railgun(event: Extract<RoundEvent, { kind: "railgun" }>): Promise<void> {
    const target = this.padOf(event.target);
    const color = color3("kerr");
    const origin = this.centerOf(this.padOf(event.source));
    playSound("cannon_heavy", { x: origin.x, rate: 0.8 });
    void this.view.effects.pulse(origin, color, 1.1, 260);
    this.view.shake(0.12);
    target.ship!.removeMarker("lock");
    if (event.blocked) {
      const cover = this.view.pad(event.target.side, "strike", event.target.slotIndex);
      const impact = this.impactFrom(cover, origin);
      void this.view.effects.beam(origin, impact, color);
      this.float(cover, t.float.blocked, "debuff");
      await Promise.all([cover.ship!.flash(), this.view.effects.hit(impact, origin, color, "discharge")]);
      return;
    }
    void this.view.effects.beam(origin, this.impactFrom(target, origin), color);
    return this.damage(event.target, event.amount, event.after, origin, color);
  }

  /** Taktvorsprung: Das Schiff fiel, bevor es feuern konnte; seine Waffe verpufft, die Balken sind gedämpft. */
  private async silence(ref: ShipRef): Promise<void> {
    const pad = this.padOf(ref);
    pad.ship!.setHoldingFire(true);
    playUiSound("denied");
    return this.mark(pad, t.float.silenced, "debuff", 1.2);
  }

  /** Mündungsblitz und Schuss bei `origin`, dann fliegt der Bolzen bis auf die Hülle des Ziels. */
  private async shoot(origin: Vector3, to: SlotPad, color: Color3, sound: SoundId): Promise<void> {
    playSound(sound, { x: origin.x });
    void this.view.effects.pulse(origin, color, 0.7, 180);
    await this.view.effects.bolt(origin, this.impactFrom(to, origin), color);
  }

  /** Treffer eines Schusses aus Richtung `origin`: Einschlag auf der Hülle (`hit`, sonst zufällig), Hüllenblitz und Schadenszahl. */
  private async damage(ref: ShipRef, amount: number, after: ShipStats, origin: Vector3, color: Color3, hit?: HitName): Promise<void> {
    const pad = this.padOf(ref);
    const ship = pad.ship!;
    ship.setStats(after.hp, after.shield);
    this.float(pad, t.float.damage(amount), "damage");
    await Promise.all([ship.flash(), this.view.effects.hit(this.impactFrom(pad, origin), origin, color, hit)]);
  }

  /** Das Schiff geht in seiner eigenen Zerstörungssequenz unter; das Wrack brennt danach für sich weiter. */
  private async destroy(ref: ShipRef): Promise<void> {
    await destroyShip(this.padOf(ref).detachShip(), this.view);
  }

  /** Das Trugbild löst sich auf: am Rundenende oder durch Funkstille. */
  private async vanish(pad: SlotPad): Promise<void> {
    const ship = pad.detachShip();
    playSound("jammer", { x: ship.root.getAbsolutePosition().x, volume: 0.6 });
    await ship.dematerialize();
    ship.dispose();
  }

  /** Der Anker übernimmt das Schiff sofort, es fliegt von seiner alten Stelle aus in den neuen Slot (gezogen: `towed`). */
  private async move(from: SlotPad, to: SlotPad, towed = false): Promise<void> {
    const ship = from.detachShip();
    const start = ship.root.getAbsolutePosition().clone();
    to.attachShip(ship);
    ship.root.setAbsolutePosition(start);
    await ship.maneuver(towed);
  }

  /** Buffs und Debuffs: farbiger Impuls plus Text über dem Schiff. */
  private async mark(pad: SlotPad, text: string, tone: FloatTone, size = 1.6): Promise<void> {
    this.float(pad, text, tone);
    await this.view.effects.pulse(this.centerOf(pad), TONE_COLORS[tone], size, 650);
  }

  // --- Hilfen ---

  private padOf(ref: SlotRef): SlotPad {
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
    this.floatAt(this.centerOf(pad), text, tone);
  }

  /** Schwebetext über einem Punkt, an dem gerade ein Schiff steht, auch wenn es nicht auf seinem Pad ist (Rammkurs). */
  private floatAt(point: Vector3, text: string, tone: FloatTone): void {
    this.floats.show(this.view.screenPosition(point.add(ABOVE_SHIP)), text, tone);
  }
}
