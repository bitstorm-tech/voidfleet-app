// Kurzlebige Effekte auf dem Brett: Laserbolzen, Impulse, Einschläge und
// Explosionen. Alle räumen sich nach dem Abspielen selbst weg.

import { Constants } from "@babylonjs/core/Engines/constants";
import type { GlowLayer } from "@babylonjs/core/Layers/glowLayer";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { RawTexture } from "@babylonjs/core/Materials/Textures/rawTexture";
import { Color3, Color4 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { CreatePlane } from "@babylonjs/core/Meshes/Builders/planeBuilder";
import { CreateSphere } from "@babylonjs/core/Meshes/Builders/sphereBuilder";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { Tools } from "@babylonjs/core/Misc/tools";
import { ParticleSystem } from "@babylonjs/core/Particles/particleSystem";
import type { Scene } from "@babylonjs/core/scene";
// Die Partikel-Shader kommen mit ins Bundle, sonst lädt Babylon sie beim ersten Einschlag nach.
import "@babylonjs/core/Shaders/particles.fragment";
import "@babylonjs/core/Shaders/particles.vertex";
import { animationTimeScale, easeInCubic, easeOutCubic, tween, wait } from "./tween.ts";

/** Welteinheiten pro Sekunde. */
const BOLT_SPEED = 15;
const BOLT_STRETCH = 5;
/** Impulse werden additiv gemischt und wirken so wie Licht statt wie eine Kugel. */
const PULSE_ALPHA = 0.55;
const EXPLOSION_CORE = new Color3(1, 0.95, 0.8);
const EXPLOSION_FIRE = new Color3(1, 0.45, 0.12);

/** Einschlag: Blitz und Druckwelle, Dauer in ms (vor der Streckung). */
const FLASH_DURATION = 140;
const RING_SIZE = 2.6;
const RING_DURATION = 300;
/** Kantenlänge der berechneten Sprite-Texturen (weiche Scheibe, Ring). */
const SPRITE_SIZE = 64;

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

export class BoardEffects {
  /** Weiche Scheibe: Partikel und Blitz. */
  private readonly dot: RawTexture;
  /** Ring mit weichen Kanten: Druckwelle. */
  private readonly ring: RawTexture;
  private lastHit: HitName | null = null;

  constructor(
    private readonly scene: Scene,
    private readonly glow: GlowLayer,
  ) {
    this.dot = createSpriteTexture("dot", scene, (distance) => Math.max(0, 1 - distance) ** 2);
    this.ring = createSpriteTexture("ring", scene, (distance) => Math.max(0, 1 - Math.abs(distance - 0.72) / 0.22) ** 1.5);
  }

  /** Ein gestreckter Leuchtbolzen fliegt geradlinig von `from` nach `to`. */
  async bolt(from: Vector3, to: Vector3, color: Color3): Promise<void> {
    const mesh = this.createSphere("bolt", 0.16, color, 1);
    mesh.scaling.z = BOLT_STRETCH;
    mesh.position.copyFrom(from);
    mesh.lookAt(to);
    const duration = (Vector3.Distance(from, to) / BOLT_SPEED) * 1000;
    await tween(this.scene, duration, (progress) => Vector3.LerpToRef(from, to, easeInCubic(progress) * 0.4 + progress * 0.6, mesh.position));
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
    const normal = origin.subtract(position).normalize();
    for (const burst of bursts) this.burst(name, position, burst.through ? normal.negate() : normal, burst, color);
    await Promise.all([
      this.flash(position, flash.color === "shot" ? Color3.Lerp(color, Color3.White(), 0.5) : flash.color, flash.size),
      ring ? this.shockwave(position, color) : null,
    ]);
  }

  async explosion(position: Vector3): Promise<void> {
    await Promise.all([
      this.pulse(position, EXPLOSION_CORE, 1.1, 300),
      this.pulse(position, EXPLOSION_FIRE, 2.4, 700),
    ]);
  }

  /** Zufällig eine Variante, aber nie zweimal dieselbe hintereinander. */
  private pickHit(): HitName {
    const names = HIT_NAMES.filter((name) => name !== this.lastHit);
    return (this.lastHit = names[Math.floor(Math.random() * names.length)]!);
  }

  private async flash(position: Vector3, color: Color3, size: number): Promise<void> {
    const mesh = this.createSprite("flash", this.dot, color, position);
    const material = mesh.material as StandardMaterial;
    await tween(this.scene, FLASH_DURATION, (progress) => {
      mesh.scaling.setAll(size * (0.6 + 0.4 * easeOutCubic(progress)));
      material.alpha = (1 - progress) ** 2;
    });
    this.disposeMesh(mesh);
  }

  /** Ein Ring, der sich schnell ausdehnt und dabei verblasst. */
  private async shockwave(position: Vector3, color: Color3): Promise<void> {
    const mesh = this.createSprite("shockwave", this.ring, color, position);
    const material = mesh.material as StandardMaterial;
    await tween(this.scene, RING_DURATION, (progress) => {
      mesh.scaling.setAll(Math.max(RING_SIZE * easeOutCubic(progress), 0.01));
      material.alpha = (1 - progress) ** 1.5;
    });
    this.disposeMesh(mesh);
  }

  /** Schickt alle Partikel des Schwarms auf einmal los und entsorgt das System, sobald das letzte verglüht ist. */
  private burst(name: string, position: Vector3, axis: Vector3, burst: Burst, shot: Color3): void {
    const system = new ParticleSystem(name, burst.count, this.scene);
    system.particleTexture = this.dot;
    system.blendMode = burst.opaque ? ParticleSystem.BLENDMODE_STANDARD : ParticleSystem.BLENDMODE_ADD;
    system.billboardMode = ParticleSystem.BILLBOARDMODE_STRETCHED;
    // Partikel altern in Sekunden und sind wie die Tweens gestreckt: Babylon zählt `updateSpeed` pro 60-Hz-Frame hoch.
    system.updateSpeed = 1 / 60 / animationTimeScale();
    system.emitter = position.clone();
    system.minEmitBox = new Vector3(-0.06, -0.06, -0.06);
    system.maxEmitBox = new Vector3(0.06, 0.06, 0.06);
    system.manualEmitCount = burst.count;
    [system.minLifeTime, system.maxLifeTime] = burst.lifeTime;
    system.minScaleY = system.maxScaleY = burst.stretch;
    system.gravity = new Vector3(0, burst.gravity, 0);
    system.startDirectionFunction = (_world, direction) => {
      randomInCone(axis, burst.cone).scaleToRef(randomBetween(burst.speed), direction);
    };
    const colors = typeof burst.colors === "function" ? burst.colors(shot) : burst.colors;
    for (const [gradient, color] of colors) system.addColorGradient(gradient, color);
    // Größen-Gradienten ersetzen die Größe (kein Faktor); mit zwei Werten würfelt Babylon je Partikel dazwischen.
    const grow = burst.grow ?? 0.3;
    system.addSizeGradient(0, ...burst.size).addSizeGradient(1, burst.size[0] * grow, burst.size[1] * grow);
    system.addVelocityGradient(0, 1).addVelocityGradient(1, 0.15);
    system.start();
    void wait(this.scene, (burst.lifeTime[1] + 0.1) * 1000).then(() => system.dispose(false));
  }

  private createSphere(name: string, diameter: number, color: Color3, alpha: number): Mesh {
    const mesh = CreateSphere(name, { diameter, segments: 12 }, this.scene);
    mesh.material = this.createMaterial(name, color, alpha);
    mesh.isPickable = false;
    this.glow.addIncludedOnlyMesh(mesh);
    return mesh;
  }

  /** Ein Billboard mit Alpha-Sprite; liegt über allem, damit die Hülle es nicht anschneidet. */
  private createSprite(name: string, texture: RawTexture, color: Color3, position: Vector3): Mesh {
    const material = this.createMaterial(name, color, 1);
    material.opacityTexture = texture;
    const mesh = CreatePlane(name, { size: 1 }, this.scene);
    mesh.material = material;
    mesh.billboardMode = Mesh.BILLBOARDMODE_ALL;
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

/** Zufällige Richtung im Kegel um `axis`, gleichverteilt über den Raumwinkel. */
function randomInCone(axis: Vector3, halfAngle: number): Vector3 {
  const helper = Math.abs(axis.y) < 0.9 ? Vector3.Up() : Vector3.Right();
  const side = Vector3.Cross(helper, axis).normalize();
  const up = Vector3.Cross(axis, side);
  const cos = 1 - Math.random() * (1 - Math.cos(halfAngle));
  const sin = Math.sqrt(1 - cos * cos);
  const around = Math.random() * Math.PI * 2;
  return axis.scale(cos).addInPlace(side.scale(sin * Math.cos(around))).addInPlace(up.scale(sin * Math.sin(around)));
}

function randomBetween([min, max]: readonly [number, number]): number {
  return min + Math.random() * (max - min);
}
