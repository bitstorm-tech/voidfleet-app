// Kurzlebige Effekte auf dem Brett: Laserbolzen, der Strahl der Railgun, die Rakete des Wärmesuchers mit Leuchtspur,
// der Traktorstrahl, Impulse, Schildblasen, Einschläge, Sekundärexplosionen, Detonationen und brennende Trümmer.
// Alle räumen sich nach dem Abspielen selbst weg.

import { Constants } from "@babylonjs/core/Engines/constants";
import type { GlowLayer } from "@babylonjs/core/Layers/glowLayer";
import { PointLight } from "@babylonjs/core/Lights/pointLight";
import { FresnelParameters } from "@babylonjs/core/Materials/fresnelParameters";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { RawTexture } from "@babylonjs/core/Materials/Textures/rawTexture";
import { Color3, Color4 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { CreateCylinder } from "@babylonjs/core/Meshes/Builders/cylinderBuilder";
import { CreatePlane } from "@babylonjs/core/Meshes/Builders/planeBuilder";
import { CreateSphere } from "@babylonjs/core/Meshes/Builders/sphereBuilder";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import type { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { Tools } from "@babylonjs/core/Misc/tools";
import { ParticleSystem } from "@babylonjs/core/Particles/particleSystem";
import type { Scene } from "@babylonjs/core/scene";
// Die Partikel-Shader kommen mit ins Bundle, sonst lädt Babylon sie beim ersten Einschlag nach.
import "@babylonjs/core/Shaders/particles.fragment";
import "@babylonjs/core/Shaders/particles.vertex";
import { playSound } from "../audio/sounds.ts";
import type { SoundId } from "../data/sounds.ts";
import { animationTimeScale, easeInCubic, easeOutCubic, tween, wait } from "./tween.ts";

/** Welteinheiten pro Sekunde. */
const BOLT_SPEED = 15;
const BOLT_STRETCH = 5;
/** Impulse werden additiv gemischt und wirken so wie Licht statt wie eine Kugel. */
const PULSE_ALPHA = 0.55;
/** Strahl der Railgun: weißer Kern, Mantel in der Schussfarbe, der sich beim Verblassen weitet (ms). */
const BEAM_CORE = 0.07;
const BEAM_SHEATH = 0.26;
const BEAM_DURATION = 520;
/** Rakete des Wärmesuchers: Welteinheiten pro Sekunde entlang ihrer Bahn, Höhe und seitlicher Schwung der Kurve. */
const MISSILE_SPEED = 8;
const MISSILE_ARC = 3.2;
const MISSILE_SWING = 2.4;
/** Traktorstrahl: dünner als die Railgun, flimmert (Hz), blendet ein und aus (ms). */
const TETHER_WIDTH = 0.6;
const TETHER_SHIMMER = 9;
const TETHER_FADE_IN = 220;
const TETHER_FADE_OUT = 300;
/** Schildblase: Sie wächst in einem Drittel der Zeit auf ihre Größe, leuchtet am Rand und verblasst am Ende (ms). */
const BUBBLE_DURATION = 1100;
const BUBBLE_ALPHA = 0.85;

/** Einschlag: Blitz und Druckwelle, Dauer in ms (vor der Streckung). */
const FLASH_DURATION = 140;
const RING_SIZE = 2.6;
const RING_DURATION = 300;
/** Kantenlänge der berechneten Sprite-Texturen (weiche Scheibe, Ring). */
const SPRITE_SIZE = 64;
/** Das Blitzlicht reicht über das halbe Brett; Nachbarn und Pads werden kurz angestrahlt. */
const LIGHT_RANGE = 16;

/** Ein Schwarm Partikel, der auf einmal aus dem Einschlagpunkt spritzt. */
interface Burst {
  count: number;
  /** Halber Öffnungswinkel des Kegels; seine Achse zeigt zum Angreifer, mit `through` durch das Schiff hindurch. */
  cone: number;
  through?: boolean;
  /** Welteinheiten pro Sekunde und Lebensdauer in Sekunden, jeweils min und max. */
  speed: [number, number];
  lifeTime: [number, number];
  /** Startgröße in Welteinheiten (min, max) und Faktor am Lebensende; ohne `grow` schrumpft der Partikel auf 0,3. */
  size: [number, number];
  grow?: number;
  /** Streckung entlang der Flugrichtung; 1 bleibt rund. */
  stretch: number;
  gravity: number;
  /** Alpha-Mischung statt additivem Leuchten, für Rauch. */
  opaque?: boolean;
  /** Farbe über die Lebensdauer (0..1), die Alpha-Komponente blendet aus; wahlweise aus der Schussfarbe abgeleitet. */
  colors: readonly (readonly [number, Color4])[] | ((shot: Color3) => readonly (readonly [number, Color4])[]);
}

/** Eine Einschlag-Variante: Blitz, wahlweise Druckwelle und die Partikelschwärme. */
interface Hit {
  /** Größe in Welteinheiten; die Farbe ist die aufgehellte Schussfarbe oder eine feste. */
  flash: { size: number; color: Color3 | "shot" };
  ring: boolean;
  bursts: readonly Burst[];
}

const FIRE_FLASH = new Color3(1, 0.8, 0.5);
/** Weißglühend über Orange nach Rot. */
const FIRE = [
  [0, new Color4(1, 0.95, 0.7, 1)],
  [0.3, new Color4(1, 0.55, 0.15, 1)],
  [0.7, new Color4(0.9, 0.2, 0.05, 0.7)],
  [1, new Color4(0.4, 0.03, 0, 0)],
] as const;
/** Glut: warm und lange sichtbar. */
const EMBER = [
  [0, new Color4(1, 0.85, 0.5, 1)],
  [0.5, new Color4(1, 0.45, 0.12, 0.9)],
  [1, new Color4(0.6, 0.1, 0, 0)],
] as const;
/** Rauch: erst vom Feuer angeleuchtet, dann grau und verwehend. */
const SMOKE = [
  [0, new Color4(0.95, 0.55, 0.3, 0.85)],
  [0.3, new Color4(0.55, 0.52, 0.58, 0.7)],
  [1, new Color4(0.4, 0.4, 0.45, 0)],
] as const;
/** Ruß einer Detonation: dunkler und träger als der Rauch eines Brandes. */
const SOOT = [
  [0, new Color4(0.95, 0.5, 0.25, 0.9)],
  [0.25, new Color4(0.36, 0.34, 0.37, 0.8)],
  [1, new Color4(0.18, 0.18, 0.2, 0)],
] as const;
/** Energie in der Schussfarbe: weiß aufblitzend, dann in der Farbe verblassend. */
const shotColors = (shot: Color3) =>
  [
    [0, new Color4(1, 1, 1, 1)],
    [0.3, Color4.FromColor3(shot, 1)],
    [1, Color4.FromColor3(shot, 0)],
  ] as const;

export type HitName = "sparks" | "fireball" | "discharge" | "pierce" | "fire";

/** Die Einschlag-Varianten; je Treffer wird zufällig eine gespielt. */
const HITS: Record<HitName, Hit> = {
  /** Funkenfächer: glühende Splitter spritzen zum Angreifer zurück, Glut glimmt nach. */
  sparks: {
    flash: { size: 1.6, color: "shot" },
    ring: true,
    bursts: [
      { count: 90, cone: Tools.ToRadians(60), speed: [3, 9], lifeTime: [0.3, 0.75], size: [0.09, 0.18], stretch: 4, gravity: -6, colors: FIRE },
      { count: 16, cone: Tools.ToRadians(80), speed: [0.6, 2.5], lifeTime: [0.6, 1.2], size: [0.06, 0.13], stretch: 1, gravity: -2.5, colors: EMBER },
    ],
  },
  /** Feuerball: eine Wolke großer, langsamer Flammen, dazu brennende Trümmer. */
  fireball: {
    flash: { size: 2.6, color: FIRE_FLASH },
    ring: false,
    bursts: [
      { count: 50, cone: Tools.ToRadians(100), speed: [2.5, 6], lifeTime: [0.6, 1], size: [0.5, 0.8], grow: 0.4, stretch: 1, gravity: 0.5, colors: FIRE },
      { count: 30, cone: Tools.ToRadians(70), speed: [3, 7], lifeTime: [0.6, 1.1], size: [0.07, 0.14], stretch: 2.5, gravity: -5, colors: EMBER },
    ],
  },
  /** Entladung: die Energie des Schusses zuckt in dünnen Fäden nach allen Seiten. */
  discharge: {
    flash: { size: 1.4, color: "shot" },
    ring: true,
    bursts: [
      { count: 60, cone: Tools.ToRadians(150), speed: [6, 14], lifeTime: [0.12, 0.3], size: [0.05, 0.09], stretch: 10, gravity: 0, colors: shotColors },
      { count: 24, cone: Tools.ToRadians(120), speed: [0.5, 2], lifeTime: [0.3, 0.6], size: [0.08, 0.14], stretch: 1, gravity: 0, colors: shotColors },
    ],
  },
  /** Durchschlag: ein Strahl aus Splittern tritt auf der Gegenseite aus, am Eintritt spritzt es zurück. */
  pierce: {
    flash: { size: 1.2, color: "shot" },
    ring: true,
    bursts: [
      { count: 50, cone: Tools.ToRadians(14), through: true, speed: [8, 16], lifeTime: [0.3, 0.6], size: [0.08, 0.16], stretch: 6, gravity: -3, colors: FIRE },
      { count: 30, cone: Tools.ToRadians(50), speed: [2, 5], lifeTime: [0.3, 0.6], size: [0.07, 0.13], stretch: 3, gravity: -6, colors: FIRE },
    ],
  },
  /** Brand: Flammen schlagen aus dem Riss, Rauch steigt auf und verweht. */
  fire: {
    flash: { size: 1.4, color: FIRE_FLASH },
    ring: false,
    bursts: [
      { count: 50, cone: Tools.ToRadians(60), speed: [2, 4], lifeTime: [0.5, 1], size: [0.25, 0.4], grow: 0.25, stretch: 1.5, gravity: 4, colors: FIRE },
      { count: 18, cone: Tools.ToRadians(70), speed: [0.5, 1.5], lifeTime: [0.9, 1.5], size: [0.35, 0.55], grow: 2.2, stretch: 1, gravity: 1, opaque: true, colors: SMOKE },
    ],
  },
};
export const HIT_NAMES = Object.keys(HITS) as HitName[];

/** Wie ein Einschlag klingt: Metall, Feuer oder Entladung. */
const HIT_SOUNDS: Record<HitName, SoundId> = {
  sparks: "impact_metal",
  pierce: "impact_metal",
  fireball: "impact_fire",
  fire: "impact_fire",
  discharge: "impact_energy",
};

/** Leuchtspur der Rakete: ein Dauerstrom kleiner, langsam verwehender Funken in der Schussfarbe hinter dem Kopf. */
const TRAIL: Omit<Burst, "count" | "cone"> = {
  speed: [0.1, 0.5], lifeTime: [0.35, 0.7], size: [0.1, 0.16], grow: 0.2, stretch: 1, gravity: 0.3, colors: (shot) => [
    [0, new Color4(1, 1, 1, 0.9)],
    [0.25, Color4.FromColor3(shot, 0.8)],
    [1, Color4.FromColor3(shot, 0)],
  ],
};
const TRAIL_RATE = 220;

/** Sekundärexplosion: ein Riss in der Hülle, aus dem Feuer, Funken und ein Rauchpilz brechen. */
const POP: readonly Burst[] = [
  { count: 24, cone: Tools.ToRadians(75), speed: [1.5, 4], lifeTime: [0.4, 0.8], size: [0.22, 0.4], grow: 0.5, stretch: 1.2, gravity: 0.6, colors: FIRE },
  { count: 36, cone: Tools.ToRadians(65), speed: [3, 8], lifeTime: [0.3, 0.7], size: [0.06, 0.12], stretch: 4, gravity: -5, colors: FIRE },
  { count: 8, cone: Tools.ToRadians(60), speed: [0.5, 1.4], lifeTime: [1, 1.7], size: [0.3, 0.45], grow: 2.2, stretch: 1, gravity: 0.8, opaque: true, colors: SMOKE },
];

export type BlastStyle = "fire" | "energy";

/** Ab dieser Größe (Kreuzer) klingt die Detonation nach großer Explosion; je größer, desto tiefer. */
const LARGE_BLAST = 1.4;

const SPHERE = Math.PI;
/** Detonation: Feuerball, Funkenregen, Glut und Ruß nach allen Seiten (Größen und Geschwindigkeiten mal `size`). */
const BLAST: Record<BlastStyle, readonly Burst[]> = {
  /** Chemisch: ein wogender Feuerball, der in einer Rußwolke erstickt. */
  fire: [
    { count: 70, cone: SPHERE, speed: [1.5, 4.5], lifeTime: [0.6, 1.2], size: [0.5, 0.9], grow: 0.6, stretch: 1.2, gravity: 0.4, colors: FIRE },
    { count: 180, cone: SPHERE, speed: [5, 13], lifeTime: [0.5, 1], size: [0.08, 0.16], stretch: 5, gravity: -4, colors: FIRE },
    { count: 70, cone: SPHERE, speed: [1.5, 4.5], lifeTime: [1.4, 2.6], size: [0.05, 0.12], stretch: 1.5, gravity: -1.2, colors: EMBER },
    { count: 36, cone: SPHERE, speed: [0.8, 2], lifeTime: [2.2, 3.4], size: [0.6, 1], grow: 2, stretch: 1, gravity: 0.35, opaque: true, colors: SOOT },
  ],
  /** Reaktorbruch: die freigesetzte Energie zuckt in Fäden heraus, das Feuer bleibt kleiner, kaum Ruß. */
  energy: [
    { count: 110, cone: SPHERE, speed: [9, 20], lifeTime: [0.15, 0.4], size: [0.06, 0.1], stretch: 12, gravity: 0, colors: shotColors },
    { count: 36, cone: SPHERE, speed: [1, 3], lifeTime: [0.5, 0.9], size: [0.8, 1.3], grow: 0.5, stretch: 1, gravity: 0, colors: shotColors },
    { count: 40, cone: SPHERE, speed: [1.5, 4], lifeTime: [0.6, 1.1], size: [0.45, 0.8], grow: 0.5, stretch: 1.2, gravity: 0.4, colors: FIRE },
    { count: 140, cone: SPHERE, speed: [5, 13], lifeTime: [0.5, 1], size: [0.08, 0.16], stretch: 5, gravity: -4, colors: FIRE },
    { count: 50, cone: SPHERE, speed: [1.5, 4.5], lifeTime: [1.4, 2.6], size: [0.05, 0.12], stretch: 1.5, gravity: -1.2, colors: EMBER },
    { count: 16, cone: SPHERE, speed: [0.8, 2], lifeTime: [2, 3], size: [0.6, 1], grow: 2, stretch: 1, gravity: 0.35, opaque: true, colors: SOOT },
  ],
};

/** Ein laufender Lichtblitz; das eine Blitzlicht zeigt immer den gerade stärksten. */
interface Flash {
  position: Vector3;
  intensity: number;
}

/** Flugzeit eines Bolzens von `from` nach `to` in ms (vor der Streckung). */
export function boltDuration(from: Vector3, to: Vector3): number {
  return (Vector3.Distance(from, to) / BOLT_SPEED) * 1000;
}

export class BoardEffects {
  /** Weiche Scheibe: Partikel und Blitz. */
  private readonly dot: RawTexture;
  /** Ring mit weichen Kanten: Druckwelle. */
  private readonly ring: RawTexture;
  /** Ein Punktlicht für alle Explosionen; es existiert von Anfang an, damit die Shader es schon kennen. */
  private readonly light: PointLight;
  private readonly flashes = new Set<Flash>();
  private lastHit: HitName | null = null;

  constructor(
    private readonly scene: Scene,
    private readonly glow: GlowLayer,
  ) {
    this.dot = createSpriteTexture("dot", scene, (distance) => Math.max(0, 1 - distance) ** 2);
    this.ring = createSpriteTexture("ring", scene, (distance) => Math.max(0, 1 - Math.abs(distance - 0.72) / 0.22) ** 1.5);
    this.light = new PointLight("blast", Vector3.Zero(), scene);
    this.light.intensity = 0;
    this.light.range = LIGHT_RANGE;
    this.light.diffuse = new Color3(1, 0.75, 0.5);
    this.light.specular = this.light.diffuse;
    scene.onBeforeRenderObservable.add(() => this.updateLight());
  }

  /** Ein gestreckter Leuchtbolzen fliegt geradlinig von `from` nach `to`. */
  async bolt(from: Vector3, to: Vector3, color: Color3): Promise<void> {
    const mesh = this.createSphere("bolt", 0.16, color, 1);
    mesh.scaling.z = BOLT_STRETCH;
    mesh.position.copyFrom(from);
    mesh.lookAt(to);
    await tween(this.scene, boltDuration(from, to), (progress) => Vector3.LerpToRef(from, to, easeInCubic(progress) * 0.4 + progress * 0.6, mesh.position));
    this.disposeMesh(mesh);
  }

  /**
   * Ein gerader Strahl steht sofort zwischen `from` und `to` und verblasst, sein Mantel weitet sich dabei;
   * `width` skaliert ihn (dünn für den Zielstrahl der Zielerfassung).
   */
  async beam(from: Vector3, to: Vector3, color: Color3, width = 1): Promise<void> {
    const length = Vector3.Distance(from, to);
    const core = this.createBeam("beam-core", BEAM_CORE * width, length, Color3.Lerp(color, Color3.White(), 0.7), from, to);
    const sheath = this.createBeam("beam-sheath", BEAM_SHEATH * width, length, color, from, to);
    await tween(this.scene, BEAM_DURATION, (progress) => {
      (core.material as StandardMaterial).alpha = (1 - progress) ** 2;
      (sheath.material as StandardMaterial).alpha = 0.6 * (1 - progress);
      sheath.scaling.x = sheath.scaling.y = 1 + 1.4 * easeOutCubic(progress);
    });
    this.disposeMesh(core);
    this.disposeMesh(sheath);
  }

  /**
   * Rakete des Wärmesuchers: Ein heller Kopf steigt von `from` auf, schwingt seitlich aus und stürzt auf `to`, hinter
   * sich eine Leuchtspur aus Partikeln, die noch kurz nachglimmt.
   */
  async missile(from: Vector3, to: Vector3, color: Color3): Promise<void> {
    const head = this.createSphere("missile", 0.15, Color3.Lerp(color, Color3.White(), 0.6), 1);
    const swing = Math.random() < 0.5 ? -1 : 1;
    const lift = from.add(new Vector3(0, MISSILE_ARC, swing * MISSILE_SWING));
    const dive = to.add(new Vector3(0, MISSILE_ARC * 1.2, swing * MISSILE_SWING * 0.4));
    const emitter = from.clone();
    const trail = this.particles("missile-trail", { ...TRAIL, count: Math.ceil(TRAIL_RATE * TRAIL.lifeTime[1]) + 10, cone: SPHERE }, color, 1);
    trail.emitter = emitter;
    trail.emitRate = TRAIL_RATE;
    trail.startDirectionFunction = (_world, direction) => randomInCone(Vector3.Up(), SPHERE).scaleToRef(randomBetween(TRAIL.speed), direction);
    trail.start();
    const length = Vector3.Distance(from, lift) + Vector3.Distance(lift, dive) + Vector3.Distance(dive, to);
    await tween(this.scene, (length / MISSILE_SPEED) * 1000, (progress) => {
      cubicBezierToRef(from, lift, dive, to, easeInCubic(progress) * 0.35 + progress * 0.65, emitter);
      head.position.copyFrom(emitter);
    });
    this.disposeMesh(head);
    trail.stop();
    void wait(this.scene, (TRAIL.lifeTime[1] + 0.1) * 1000).then(() => trail.dispose(false));
  }

  /**
   * Traktorstrahl: Ein flimmernder Strahl steht von `from` zu dem Punkt, den `target` in jedem Bild liefert, und folgt
   * ihm so; er blendet ein und verblasst erst, wenn die zurückgegebene Funktion ihn freigibt.
   */
  tether(from: Vector3, target: () => Vector3, color: Color3): () => Promise<void> {
    const core = this.createBeam("tether-core", BEAM_CORE * TETHER_WIDTH, 1, Color3.Lerp(color, Color3.White(), 0.6), from, target());
    const sheath = this.createBeam("tether-sheath", BEAM_SHEATH * TETHER_WIDTH, 1, color, from, target());
    let fade = 0;
    const observer = this.scene.onBeforeRenderObservable.add(() => {
      const to = target();
      for (const mesh of [core, sheath]) {
        Vector3.CenterToRef(from, to, mesh.position);
        mesh.scaling.z = Vector3.Distance(from, to);
        mesh.lookAt(to);
      }
      const shimmer = 0.75 + 0.25 * Math.sin((performance.now() / 1000) * TETHER_SHIMMER * 2 * Math.PI);
      (core.material as StandardMaterial).alpha = fade * shimmer;
      (sheath.material as StandardMaterial).alpha = 0.45 * fade * shimmer;
    });
    void tween(this.scene, TETHER_FADE_IN, (progress) => (fade = progress));
    return async () => {
      await tween(this.scene, TETHER_FADE_OUT, (progress) => (fade = 1 - progress));
      this.scene.onBeforeRenderObservable.remove(observer);
      this.disposeMesh(core);
      this.disposeMesh(sheath);
    };
  }

  /** Schildblase um ein Schiff: eine Kugel, die am Rand leuchtet, auf `size` wächst, kurz steht und verblasst. */
  async bubble(position: Vector3, color: Color3, size: number): Promise<void> {
    const mesh = this.createSphere("bubble", 1, color, BUBBLE_ALPHA);
    const material = mesh.material as StandardMaterial;
    material.emissiveFresnelParameters = new FresnelParameters({ leftColor: Color3.White(), rightColor: Color3.Black(), power: 2.2 });
    mesh.position.copyFrom(position);
    await tween(this.scene, BUBBLE_DURATION, (progress) => {
      mesh.scaling.setAll(Math.max(size * easeOutCubic(Math.min(progress * 3, 1)), 0.01));
      material.alpha = BUBBLE_ALPHA * Math.min(1, (1 - progress) * 2.5);
    });
    this.disposeMesh(mesh);
  }

  /** Eine Leuchtkugel wächst auf `size` und verblasst dabei. */
  async pulse(position: Vector3, color: Color3, size: number, duration: number): Promise<void> {
    const mesh = this.createSphere("pulse", 1, color, PULSE_ALPHA);
    const material = mesh.material as StandardMaterial;
    mesh.position.copyFrom(position);
    await tween(this.scene, duration, (progress) => {
      mesh.scaling.setAll(Math.max(size * easeOutCubic(progress), 0.01));
      material.alpha = PULSE_ALPHA * (1 - progress) ** 2;
    });
    this.disposeMesh(mesh);
  }

  /**
   * Einschlag eines Schusses aus Richtung `origin` in der Schussfarbe `color`,
   * ohne `name` in einer zufälligen Variante. Endet mit Blitz und Druckwelle;
   * die Partikel glimmen für sich weiter und räumen sich selbst weg.
   */
  async hit(position: Vector3, origin: Vector3, color: Color3, name: HitName = this.pickHit()): Promise<void> {
    const { flash, ring, bursts } = HITS[name];
    playSound(HIT_SOUNDS[name], { x: position.x });
    const normal = origin.subtract(position).normalize();
    for (const burst of bursts) this.burst(name, position, burst.through ? normal.negate() : normal, burst, color);
    await Promise.all([
      this.flash(position, flash.color === "shot" ? Color3.Lerp(color, Color3.White(), 0.5) : flash.color, flash.size, FLASH_DURATION),
      ring ? this.shockwave(position, color, RING_SIZE, RING_DURATION, false) : null,
    ]);
  }

  /** Sekundärexplosion auf der Hülle: bricht in Richtung `outward` auf; `size` 1 passt zu einem Jäger. */
  pop(position: Vector3, outward: Vector3, size: number): void {
    playSound("explosion_small", { x: position.x, volume: 0.5, rate: 1.05 - 0.1 * size });
    for (const burst of POP) this.burst("pop", position, outward, burst, FIRE_FLASH, size);
    void this.flash(position, FIRE_FLASH, 1.1 * size, 160);
    void this.flashLight(position, 6 * size, 220);
  }

  /**
   * Die Detonation eines Schiffs: Kern und Blitz, eine flache Druckwelle über das Brett und eine aufrechte,
   * dazu die Schwärme des Stils und das Blitzlicht. Endet, sobald der Kern verglüht ist; der Rest läuft weiter.
   */
  async detonate(position: Vector3, energy: Color3, size: number, style: BlastStyle): Promise<void> {
    playSound(size >= LARGE_BLAST ? "explosion_large" : "explosion_small", { x: position.x, rate: 1 - 0.1 * size });
    if (style === "energy") playSound("reactor_breach", { x: position.x });
    for (const burst of BLAST[style]) this.burst(`blast-${style}`, position, Vector3.Up(), burst, energy, size);
    void this.flash(position, Color3.Lerp(energy, Color3.White(), 0.6), 2.2 * size, 180);
    void this.shockwave(position, energy, 5 * size, 700, true);
    void this.shockwave(position, Color3.Lerp(energy, Color3.White(), 0.4), 3 * size, 450, false);
    void this.flashLight(position, 55 * size, 650);
    void this.pulse(position, energy, 2 * size, 650);
    await this.pulse(position, Color3.Lerp(energy, Color3.White(), 0.7), 1.2 * size, 380);
  }

  /**
   * Feuer und Rauch schlagen `duration` ms lang aus einem Trümmerstück und erlöschen dann; `spread` ist
   * die halbe Ausdehnung des Stücks in Welteinheiten, damit die Flammen aus seiner ganzen Oberfläche kommen.
   * Die Systeme folgen dem Stück über einen Punkt statt am Mesh zu hängen: Babylon würde sie sonst beim
   * Entsorgen des Meshes mitsamt der gemeinsamen Partikeltextur entsorgen.
   */
  burn(piece: TransformNode, size: number, spread: number, duration: number): void {
    const anchor = piece.getAbsolutePosition().clone();
    const fire = this.stream("burn-fire", anchor, size, spread, {
      rate: 50, speed: [0.4, 1.2], lifeTime: [0.4, 0.8], size: [0.25, 0.45], grow: 0.3, stretch: 1.2, gravity: 1.5, colors: FIRE,
    });
    const smoke = this.stream("burn-smoke", anchor, size, spread, {
      rate: 12, speed: [0.3, 0.8], lifeTime: [1, 1.8], size: [0.3, 0.5], grow: 2.5, stretch: 1, gravity: 0.8, opaque: true, colors: SMOKE,
    });
    const follow = this.scene.onBeforeRenderObservable.add(() => {
      if (!piece.isDisposed()) anchor.copyFrom(piece.getAbsolutePosition());
    });
    void wait(this.scene, duration).then(async () => {
      fire.stop();
      smoke.stop();
      await wait(this.scene, 2000);
      this.scene.onBeforeRenderObservable.remove(follow);
      fire.dispose(false);
      smoke.dispose(false);
    });
  }

  /** Zufällig eine Variante, aber nie zweimal dieselbe hintereinander. */
  private pickHit(): HitName {
    const names = HIT_NAMES.filter((name) => name !== this.lastHit);
    return (this.lastHit = names[Math.floor(Math.random() * names.length)]!);
  }

  private async flash(position: Vector3, color: Color3, size: number, duration: number): Promise<void> {
    const mesh = this.createSprite("flash", this.dot, color, position, false);
    const material = mesh.material as StandardMaterial;
    await tween(this.scene, duration, (progress) => {
      mesh.scaling.setAll(size * (0.6 + 0.4 * easeOutCubic(progress)));
      material.alpha = (1 - progress) ** 2;
    });
    this.disposeMesh(mesh);
  }

  /** Ein Ring, der sich schnell ausdehnt und dabei verblasst; `flat` legt ihn in die Brettebene. */
  private async shockwave(position: Vector3, color: Color3, size: number, duration: number, flat: boolean): Promise<void> {
    const mesh = this.createSprite("shockwave", this.ring, color, position, flat);
    const material = mesh.material as StandardMaterial;
    await tween(this.scene, duration, (progress) => {
      mesh.scaling.setAll(Math.max(size * easeOutCubic(progress), 0.01));
      material.alpha = (1 - progress) ** 1.5;
    });
    this.disposeMesh(mesh);
  }

  /** Das Blitzlicht springt auf `intensity` und klingt über `duration` ms ab. */
  private async flashLight(position: Vector3, intensity: number, duration: number): Promise<void> {
    const flash: Flash = { position: position.clone(), intensity };
    this.flashes.add(flash);
    await tween(this.scene, duration, (progress) => {
      flash.intensity = intensity * (1 - progress) ** 2;
    });
    this.flashes.delete(flash);
  }

  private updateLight(): void {
    let strongest: Flash | null = null;
    for (const flash of this.flashes) if (!strongest || flash.intensity > strongest.intensity) strongest = flash;
    this.light.intensity = strongest?.intensity ?? 0;
    if (strongest) this.light.position.copyFrom(strongest.position);
  }

  /** Schickt alle Partikel des Schwarms auf einmal los und entsorgt das System, sobald das letzte verglüht ist. */
  private burst(name: string, position: Vector3, axis: Vector3, burst: Burst, shot: Color3, scale = 1): void {
    const system = this.particles(name, burst, shot, scale);
    system.emitter = position.clone();
    system.manualEmitCount = burst.count;
    // Große Explosionen werfen weiter, aber nicht proportional: sonst überquert der Funkenregen das halbe Brett.
    const throwing = Math.sqrt(scale);
    system.startDirectionFunction = (_world, direction) => {
      randomInCone(axis, burst.cone).scaleToRef(randomBetween(burst.speed) * throwing, direction);
    };
    system.start();
    void wait(this.scene, (burst.lifeTime[1] + 0.1) * 1000).then(() => system.dispose(false));
  }

  /** Ein Dauerstrom von Partikeln aus dem Kasten (halbe Kantenlänge `spread`, Welteinheiten) um `emitter`, nach oben und zu allen Seiten. */
  private stream(name: string, emitter: Vector3, scale: number, spread: number, burst: Omit<Burst, "count" | "cone"> & { rate: number }): ParticleSystem {
    const system = this.particles(name, { ...burst, count: Math.ceil(burst.rate * burst.lifeTime[1]) + 10, cone: SPHERE }, FIRE_FLASH, scale);
    system.emitter = emitter;
    system.emitRate = burst.rate;
    system.minEmitBox.setAll(-spread);
    system.maxEmitBox.setAll(spread);
    system.startDirectionFunction = (_world, direction) => {
      randomInCone(Vector3.Up(), Tools.ToRadians(120)).scaleToRef(randomBetween(burst.speed) * scale, direction);
    };
    system.start();
    return system;
  }

  private particles(name: string, burst: Burst, shot: Color3, scale: number): ParticleSystem {
    const system = new ParticleSystem(name, burst.count, this.scene);
    system.particleTexture = this.dot;
    system.blendMode = burst.opaque ? ParticleSystem.BLENDMODE_STANDARD : ParticleSystem.BLENDMODE_ADD;
    system.billboardMode = ParticleSystem.BILLBOARDMODE_STRETCHED;
    // Partikel altern in Sekunden und sind wie die Tweens gestreckt: Babylon zählt `updateSpeed` pro 60-Hz-Frame hoch.
    system.updateSpeed = 1 / 60 / animationTimeScale();
    system.minEmitBox = new Vector3(-0.06, -0.06, -0.06);
    system.maxEmitBox = new Vector3(0.06, 0.06, 0.06);
    [system.minLifeTime, system.maxLifeTime] = burst.lifeTime;
    system.minScaleY = system.maxScaleY = burst.stretch;
    system.gravity = new Vector3(0, burst.gravity * scale, 0);
    const colors = typeof burst.colors === "function" ? burst.colors(shot) : burst.colors;
    for (const [gradient, color] of colors) system.addColorGradient(gradient, color);
    // Größen-Gradienten ersetzen die Größe (kein Faktor); mit zwei Werten würfelt Babylon je Partikel dazwischen.
    const grow = burst.grow ?? 0.3;
    const [min, max] = [burst.size[0] * scale, burst.size[1] * scale];
    system.addSizeGradient(0, min, max).addSizeGradient(1, min * grow, max * grow);
    system.addVelocityGradient(0, 1).addVelocityGradient(1, 0.15);
    return system;
  }

  private createSphere(name: string, diameter: number, color: Color3, alpha: number): Mesh {
    const mesh = CreateSphere(name, { diameter, segments: 12 }, this.scene);
    mesh.material = this.createMaterial(name, color, alpha);
    mesh.isPickable = false;
    this.glow.addIncludedOnlyMesh(mesh);
    return mesh;
  }

  /** Ein Zylinder von `from` nach `to`, selbstleuchtend und im Glow. */
  private createBeam(name: string, diameter: number, length: number, color: Color3, from: Vector3, to: Vector3): Mesh {
    const mesh = CreateCylinder(name, { height: length, diameter, tessellation: 10 }, this.scene);
    // Die Achse des Zylinders liegt auf y; gekippt zeigt sie nach z, und `lookAt` richtet z aufs Ziel.
    mesh.rotation.x = Math.PI / 2;
    mesh.bakeCurrentTransformIntoVertices();
    mesh.position = Vector3.Center(from, to);
    mesh.lookAt(to);
    mesh.material = this.createMaterial(name, color, 1);
    mesh.isPickable = false;
    this.glow.addIncludedOnlyMesh(mesh);
    return mesh;
  }

  /** Ein Billboard mit Alpha-Sprite (oder flach in der Brettebene); liegt über allem, damit die Hülle es nicht anschneidet. */
  private createSprite(name: string, texture: RawTexture, color: Color3, position: Vector3, flat: boolean): Mesh {
    const material = this.createMaterial(name, color, 1);
    material.opacityTexture = texture;
    const mesh = CreatePlane(name, { size: 1, sideOrientation: Mesh.DOUBLESIDE }, this.scene);
    mesh.material = material;
    if (flat) mesh.rotation.x = Math.PI / 2;
    else mesh.billboardMode = Mesh.BILLBOARDMODE_ALL;
    mesh.renderingGroupId = 1;
    mesh.isPickable = false;
    mesh.position.copyFrom(position);
    return mesh;
  }

  /** Selbstleuchtend und additiv, ohne Tiefenschreiben: wirkt wie Licht. */
  private createMaterial(name: string, color: Color3, alpha: number): StandardMaterial {
    const material = new StandardMaterial(`${name}-material`, this.scene);
    material.disableLighting = true;
    material.emissiveColor = color;
    material.alpha = alpha;
    material.alphaMode = Constants.ALPHA_ADD;
    material.disableDepthWrite = true;
    return material;
  }

  private disposeMesh(mesh: Mesh): void {
    this.glow.removeIncludedOnlyMesh(mesh);
    mesh.material!.dispose();
    mesh.dispose();
  }
}

/** Weißes Quadrat, dessen Alpha `alphaAt` aus dem Abstand zur Mitte bestimmt (0 Mitte, 1 Rand). */
function createSpriteTexture(name: string, scene: Scene, alphaAt: (distance: number) => number): RawTexture {
  const data = new Uint8Array(SPRITE_SIZE * SPRITE_SIZE * 4);
  for (let y = 0; y < SPRITE_SIZE; y++) {
    for (let x = 0; x < SPRITE_SIZE; x++) {
      const distance = Math.hypot(((x + 0.5) / SPRITE_SIZE) * 2 - 1, ((y + 0.5) / SPRITE_SIZE) * 2 - 1);
      const alpha = Math.min(Math.max(alphaAt(distance), 0), 1);
      data.set([255, 255, 255, Math.round(alpha * 255)], (y * SPRITE_SIZE + x) * 4);
    }
  }
  const texture = RawTexture.CreateRGBATexture(data, SPRITE_SIZE, SPRITE_SIZE, scene, true, false, Constants.TEXTURE_TRILINEAR_SAMPLINGMODE);
  texture.name = name;
  return texture;
}

/** Punkt der kubischen Bézierkurve `p0`…`p3` beim Anteil `t`, geschrieben nach `result`. */
function cubicBezierToRef(p0: Vector3, p1: Vector3, p2: Vector3, p3: Vector3, t: number, result: Vector3): void {
  const u = 1 - t;
  result.copyFrom(p0).scaleInPlace(u ** 3);
  result.addInPlace(p1.scale(3 * u ** 2 * t)).addInPlace(p2.scale(3 * u * t ** 2)).addInPlace(p3.scale(t ** 3));
}

/** Zufällige Richtung im Kegel um `axis`, gleichverteilt über den Raumwinkel. */
export function randomInCone(axis: Vector3, halfAngle: number): Vector3 {
  const helper = Math.abs(axis.y) < 0.9 ? Vector3.Up() : Vector3.Right();
  const side = Vector3.Cross(helper, axis).normalize();
  const up = Vector3.Cross(axis, side);
  const cos = 1 - Math.random() * (1 - Math.cos(halfAngle));
  const sin = Math.sqrt(1 - cos * cos);
  const around = Math.random() * Math.PI * 2;
  return axis.scale(cos).addInPlace(side.scale(sin * Math.cos(around))).addInPlace(up.scale(sin * Math.sin(around)));
}

export function randomBetween([min, max]: readonly [number, number]): number {
  return min + Math.random() * (max - min);
}
