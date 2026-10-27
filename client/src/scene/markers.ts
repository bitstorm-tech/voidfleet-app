// Leuchtende Marken am Boden unter einem Schiff, in der Farbe ihres Admirals: der Ring unter jedem Flaggschiff,
// die Zielerfassung der Pendulum (Fadenkreuz mit Rauten) und die Marken der Admiralsfähigkeiten — Stacheln beim
// Gegenfeuer, ein Fadenkreuz aus Zielklammern beim Fokusfeuer, kreisende Drohnen beim Schwarmangriff, eine Uhr beim
// Taktvorsprung — und die Ablenkung (Befehl): ein pulsierender Leuchtring mit Winkeln, die das Feuer nach innen
// ziehen. Beim Planen der Feuerbefehle zeigt ein gestrichelter Ring mit drei Kerben die Bereitschaft (das Schiff kann
// noch ein Ziel bekommen), das Visier aus Ring und vier nach außen zeigenden Spitzen den gewählten Schützen.
// Sie hängen am Schiff (`ShipView`) und folgen ihm, wenn es den Slot wechselt. Jede Marke besteht aus
// flachen Scheiben mit einer im Canvas gezeichneten Textur, die sich drehen oder pulsieren. Ihr Halter ist auf die
// Grundfläche des Schiffs gestreckt, damit die Marke um den Rumpf herum sichtbar bleibt, auch bei langen Schlachtschiffen.

import { Constants } from "@babylonjs/core/Engines/constants";
import { DynamicTexture } from "@babylonjs/core/Materials/Textures/dynamicTexture";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import type { Color3 } from "@babylonjs/core/Maths/math.color";
import { CreateGround } from "@babylonjs/core/Meshes/Builders/groundBuilder";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { Observer } from "@babylonjs/core/Misc/observable";
import type { Scene } from "@babylonjs/core/scene";
import type { PowerId } from "../../../shared/admirals.ts";
import { easeOutCubic, tween } from "./tween.ts";

export type MarkerKind = "halo" | "lock" | "taunt" | "ready" | "aim" | Exclude<PowerId, "decoy">;

export interface MarkerSpec {
  kind: MarkerKind;
  color: Color3;
  /** Erst eingeplant (Zielerfassung dieser Runde): blinkt, statt ruhig zu leuchten. */
  planned?: boolean;
}

/** Eine Ebene einer Marke: Textur, Drehung (rad/s) und Pulsieren der Größe (Hz, Ausschlag). */
interface Layer {
  glyph: Glyph;
  spin?: number;
  pulse?: { rate: number; amount: number };
}

type Glyph =
  | "halo"
  | "haloDashes"
  | "lock"
  | "lockRing"
  | "spikes"
  | "brackets"
  | "swarm"
  | "clock"
  | "clockHand"
  | "beacon"
  | "beaconChevrons"
  | "ready"
  | "aim"
  | "aimPointers";

/** Grundfläche eines Schiffs in Welteinheiten: Breite quer zur Nase, Länge entlang der Nase. */
export interface Footprint {
  width: number;
  length: number;
}

/** Zugabe zur Grundfläche (Welteinheiten) und die Ebenen je Marke; der Ring des Flaggschiffs liegt außen. */
const MARKERS: Record<MarkerKind, { margin: number; alpha: number; layers: readonly Layer[] }> = {
  halo: { margin: 0.8, alpha: 0.8, layers: [{ glyph: "halo", pulse: { rate: 0.45, amount: 0.02 } }, { glyph: "haloDashes", spin: 0.18 }] },
  lock: { margin: 0.6, alpha: 0.95, layers: [{ glyph: "lock" }, { glyph: "lockRing", spin: -0.5 }] },
  counterfire: { margin: 0.6, alpha: 0.9, layers: [{ glyph: "spikes", spin: 0.35 }] },
  focus_fire: { margin: 0.6, alpha: 0.95, layers: [{ glyph: "brackets", pulse: { rate: 1.6, amount: 0.05 } }] },
  swarm_strike: { margin: 0.6, alpha: 0.9, layers: [{ glyph: "swarm", spin: 1.3 }] },
  head_start: { margin: 0.6, alpha: 0.9, layers: [{ glyph: "clock" }, { glyph: "clockHand", spin: 2.4 }] },
  taunt: { margin: 0.6, alpha: 0.95, layers: [{ glyph: "beacon", pulse: { rate: 1.2, amount: 0.08 } }, { glyph: "beaconChevrons", spin: -0.4 }] },
  ready: { margin: 0.6, alpha: 0.6, layers: [{ glyph: "ready", spin: 0.25, pulse: { rate: 0.9, amount: 0.04 } }] },
  aim: { margin: 0.6, alpha: 0.95, layers: [{ glyph: "aim", pulse: { rate: 1.4, amount: 0.03 } }, { glyph: "aimPointers", spin: 0.8 }] },
};

/** Quer zur Nase bleibt jede Marke in ihrem Slot (sie liegen 2,2 auseinander), aber nie kleiner als dieser Kreis. */
const MAX_WIDTH = 2.15;
const MIN_SIZE = 1.5;

/** Knapp über der Platte des Pads, unter dem Schiff. */
const FLOOR_LIFT = 0.07;
/** Eine eingeplante Zielerfassung blinkt (Hz) zwischen dieser und voller Deckkraft. */
const PLANNED_BLINK = 1.4;
const PLANNED_MIN = 0.3;
/** Auftritt: Die Marke fällt aus dieser Größe auf ihre eigene zusammen (ms). */
const INTRO_SCALE = 2.2;
const INTRO_DURATION = 520;
const TEXTURE_SIZE = 256;

export class FloorMarker {
  /** Auf die Grundfläche gestreckt; die Scheiben darin drehen sich, so laufen ihre Muster um den Rumpf. */
  private readonly holder: TransformNode;
  private readonly meshes: Mesh[];
  private readonly observer: Observer<Scene>;
  private intro = 1;

  /** `parent` liegt am Boden unter dem Schiff, in Welteinheiten und mit der Nase nach +z. */
  constructor(
    private readonly scene: Scene,
    parent: TransformNode,
    footprint: Footprint,
    readonly spec: MarkerSpec,
  ) {
    const { margin, alpha, layers } = MARKERS[spec.kind];
    this.holder = new TransformNode(`marker-${spec.kind}`, scene);
    this.holder.parent = parent;
    const width = Math.min(Math.max(footprint.width + margin, MIN_SIZE), MAX_WIDTH);
    this.holder.scaling.set(width, 1, Math.max(footprint.length + margin, MIN_SIZE));
    const glow = scene.getGlowLayerByName("glow");
    this.meshes = layers.map((layer, index) => {
      const mesh = CreateGround(`marker-${spec.kind}`, { width: 1, height: 1 }, scene);
      mesh.material = markerMaterial(scene, layer.glyph, spec.color);
      mesh.parent = this.holder;
      // Jede Ebene ein Hauch höher, damit sich die Scheiben nicht flimmernd schneiden.
      mesh.position.y = FLOOR_LIFT + index * 0.004;
      mesh.isPickable = false;
      mesh.alphaIndex = 1;
      glow?.addIncludedOnlyMesh(mesh);
      return mesh;
    });
    this.observer = scene.onBeforeRenderObservable.add(() => {
      const seconds = performance.now() / 1000;
      const blink = spec.planned ? PLANNED_MIN + (1 - PLANNED_MIN) * (0.5 + 0.5 * Math.sin(seconds * PLANNED_BLINK * 2 * Math.PI)) : 1;
      layers.forEach((layer, index) => {
        const mesh = this.meshes[index]!;
        if (layer.spin) mesh.rotation.y = seconds * layer.spin;
        const pulse = layer.pulse ? 1 + layer.pulse.amount * Math.sin(seconds * layer.pulse.rate * 2 * Math.PI) : 1;
        mesh.scaling.setAll(pulse * this.intro);
        mesh.visibility = alpha * blink;
      });
    });
  }

  /** Erscheinen: Die Marke zieht sich aus großem Abstand auf das Schiff zusammen. */
  async appear(): Promise<void> {
    await tween(this.scene, INTRO_DURATION, (progress) => {
      this.intro = INTRO_SCALE - (INTRO_SCALE - 1) * easeOutCubic(progress);
    });
  }

  dispose(): void {
    this.scene.onBeforeRenderObservable.remove(this.observer);
    const glow = this.scene.getGlowLayerByName("glow");
    for (const mesh of this.meshes) glow?.removeIncludedOnlyMesh(mesh);
    this.holder.dispose();
  }
}

/** Ein Material je Glyphe und Farbe, für alle Marken der Szene; die Textur ist weiß, gefärbt wird über die Emission. */
const materials = new WeakMap<Scene, Map<string, StandardMaterial>>();

function markerMaterial(scene: Scene, glyph: Glyph, color: Color3): StandardMaterial {
  let cache = materials.get(scene);
  if (!cache) materials.set(scene, (cache = new Map()));
  const key = `${glyph}-${color.toHexString()}`;
  let material = cache.get(key);
  if (material) return material;
  material = new StandardMaterial(`marker-${key}`, scene);
  material.diffuseTexture = glyphTexture(scene, glyph);
  material.useAlphaFromDiffuseTexture = true;
  material.emissiveColor = color;
  material.disableLighting = true;
  material.disableDepthWrite = true;
  material.alphaMode = Constants.ALPHA_ADD;
  cache.set(key, material);
  return material;
}

const textures = new WeakMap<Scene, Map<Glyph, DynamicTexture>>();

function glyphTexture(scene: Scene, glyph: Glyph): DynamicTexture {
  let cache = textures.get(scene);
  if (!cache) textures.set(scene, (cache = new Map()));
  let texture = cache.get(glyph);
  if (texture) return texture;
  texture = new DynamicTexture(`marker-${glyph}`, { width: TEXTURE_SIZE, height: TEXTURE_SIZE }, scene, true);
  texture.hasAlpha = true;
  const context = texture.getContext() as unknown as CanvasRenderingContext2D;
  context.clearRect(0, 0, TEXTURE_SIZE, TEXTURE_SIZE);
  context.translate(TEXTURE_SIZE / 2, TEXTURE_SIZE / 2);
  context.scale(TEXTURE_SIZE / 2, TEXTURE_SIZE / 2);
  context.fillStyle = context.strokeStyle = "white";
  GLYPHS[glyph](context);
  texture.update();
  cache.set(glyph, texture);
  return texture;
}

/** Zeichnet im Einheitskreis (Mitte 0, Rand 1); das Schiff verdeckt die Mitte, alles Wichtige liegt außen. */
const GLYPHS: Record<Glyph, (context: CanvasRenderingContext2D) => void> = {
  /** Weicher Lichtring mit scharfer Kante. */
  halo: (context) => {
    const gradient = context.createRadialGradient(0, 0, 0.5, 0, 0, 1);
    gradient.addColorStop(0, "rgb(255 255 255 / 0)");
    gradient.addColorStop(0.62, "rgb(255 255 255 / 0.55)");
    gradient.addColorStop(0.7, "rgb(255 255 255 / 0.25)");
    gradient.addColorStop(1, "rgb(255 255 255 / 0)");
    context.fillStyle = gradient;
    context.fillRect(-1, -1, 2, 2);
    ring(context, 0.86, 0.025);
  },
  /** Kranz aus Strichen außen um den Ring, wie die Zacken einer Krone. */
  haloDashes: (context) => {
    for (let index = 0; index < 24; index++) {
      context.save();
      context.rotate((index / 24) * 2 * Math.PI);
      context.fillRect(-0.012, -0.97, 0.024, index % 3 === 0 ? 0.08 : 0.04);
      context.restore();
    }
  },
  /** Fadenkreuz: Ring, Kreuz bis über den Rand, kleine Rauten auf den Diagonalen. */
  lock: (context) => {
    ring(context, 0.8, 0.035);
    for (let quarter = 0; quarter < 4; quarter++) {
      context.save();
      context.rotate((quarter * Math.PI) / 2);
      context.fillRect(-0.022, -0.99, 0.044, 0.34);
      context.rotate(Math.PI / 4);
      context.beginPath();
      context.moveTo(0, -0.97);
      context.lineTo(0.05, -0.91);
      context.lineTo(0, -0.85);
      context.lineTo(-0.05, -0.91);
      context.fill();
      context.restore();
    }
  },
  /** Gestrichelter Außenring, der gegen das Kreuz läuft. */
  lockRing: (context) => {
    context.lineWidth = 0.03;
    context.setLineDash([0.16, 0.1]);
    context.beginPath();
    context.arc(0, 0, 0.9, 0, 2 * Math.PI);
    context.stroke();
  },
  /** Ring mit sechzehn Stacheln nach außen. */
  spikes: (context) => {
    ring(context, 0.76, 0.035);
    for (let index = 0; index < 16; index++) {
      context.save();
      context.rotate((index / 16) * 2 * Math.PI);
      context.beginPath();
      context.moveTo(-0.06, -0.77);
      context.lineTo(0, -0.99);
      context.lineTo(0.06, -0.77);
      context.fill();
      context.restore();
    }
  },
  /** Fadenkreuz aus vier Zielklammern und kurzen Strichen von außen auf das Ziel. */
  brackets: (context) => {
    const reach = 0.7;
    const arm = 0.3;
    const width = 0.06;
    for (let quarter = 0; quarter < 4; quarter++) {
      context.save();
      context.rotate((quarter * Math.PI) / 2);
      context.fillRect(reach - arm, reach - width, arm, width);
      context.fillRect(reach - width, reach - arm, width, arm);
      context.fillRect(-0.03, -1, 0.06, 0.24);
      context.restore();
    }
    ring(context, 0.9, 0.02);
  },
  /** Sechs kleine Drohnen-Pfeile auf einer gepunkteten Bahn. */
  swarm: (context) => {
    for (let index = 0; index < 40; index++) {
      const angle = (index / 40) * 2 * Math.PI;
      context.beginPath();
      context.arc(Math.cos(angle) * 0.86, Math.sin(angle) * 0.86, 0.014, 0, 2 * Math.PI);
      context.fill();
    }
    for (let index = 0; index < 6; index++) {
      context.save();
      context.rotate((index / 6) * 2 * Math.PI);
      context.translate(0, -0.86);
      context.beginPath();
      context.moveTo(-0.13, -0.08);
      context.lineTo(0.12, 0);
      context.lineTo(-0.13, 0.08);
      context.lineTo(-0.07, 0);
      context.fill();
      context.restore();
    }
  },
  /** Zifferblatt: Ring mit zwölf Strichen, die vier Viertel länger. */
  clock: (context) => {
    ring(context, 0.9, 0.03);
    for (let index = 0; index < 12; index++) {
      context.save();
      context.rotate((index / 12) * 2 * Math.PI);
      const long = index % 3 === 0;
      context.fillRect(-0.02, -0.88, 0.04, long ? 0.16 : 0.08);
      context.restore();
    }
  },
  /** Der Zeiger reicht bis ans Zifferblatt, damit man ihn neben dem Schiff kreisen sieht. */
  clockHand: (context) => {
    context.beginPath();
    context.moveTo(-0.035, 0);
    context.lineTo(0, -0.97);
    context.lineTo(0.035, 0);
    context.fill();
  },
  /** Leuchtring: weicher Schein, zwei scharfe Kanten. */
  beacon: (context) => {
    const gradient = context.createRadialGradient(0, 0, 0.55, 0, 0, 0.95);
    gradient.addColorStop(0, "rgb(255 255 255 / 0)");
    gradient.addColorStop(0.55, "rgb(255 255 255 / 0.5)");
    gradient.addColorStop(1, "rgb(255 255 255 / 0)");
    context.fillStyle = gradient;
    context.fillRect(-1, -1, 2, 2);
    context.fillStyle = "white";
    ring(context, 0.74, 0.04);
    ring(context, 0.84, 0.02);
  },
  /** Gestrichelter Ring mit drei Kerben nach außen: Die Geschütze warten auf ein Ziel. */
  ready: (context) => {
    context.lineWidth = 0.035;
    context.setLineDash([0.12, 0.09]);
    context.beginPath();
    context.arc(0, 0, 0.82, 0, 2 * Math.PI);
    context.stroke();
    for (let index = 0; index < 3; index++) {
      context.save();
      context.rotate((index / 3) * 2 * Math.PI);
      context.fillRect(-0.025, -0.99, 0.05, 0.12);
      context.restore();
    }
  },
  /** Kräftiger Ring mit feinem Innenring: Dieses Schiff wählt gerade sein Ziel. */
  aim: (context) => {
    ring(context, 0.8, 0.05);
    ring(context, 0.7, 0.015);
  },
  /** Vier Spitzen außen auf dem Ring, nach außen gerichtet: Von hier geht der Schuss aus. */
  aimPointers: (context) => {
    for (let quarter = 0; quarter < 4; quarter++) {
      context.save();
      context.rotate((quarter * Math.PI) / 2);
      context.beginPath();
      context.moveTo(-0.09, -0.84);
      context.lineTo(0, -0.99);
      context.lineTo(0.09, -0.84);
      context.fill();
      context.restore();
    }
  },
  /** Acht Winkel außen um den Ring, die Spitzen nach innen: Hierher zielt das Feuer. */
  beaconChevrons: (context) => {
    for (let index = 0; index < 8; index++) {
      context.save();
      context.rotate((index / 8) * 2 * Math.PI);
      context.beginPath();
      context.moveTo(-0.1, -0.99);
      context.lineTo(0, -0.89);
      context.lineTo(0.1, -0.99);
      context.lineTo(0.1, -0.94);
      context.lineTo(0, -0.84);
      context.lineTo(-0.1, -0.94);
      context.fill();
      context.restore();
    }
  },
};

function ring(context: CanvasRenderingContext2D, radius: number, width: number): void {
  context.lineWidth = width;
  context.setLineDash([]);
  context.beginPath();
  context.arc(0, 0, radius, 0, 2 * Math.PI);
  context.stroke();
}
