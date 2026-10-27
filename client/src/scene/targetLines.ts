// Bögen der Zielvorschau: je Schuss ein dünner leuchtender Bogen vom Schützen, der von oben auf sein Ziel
// fällt, in der Farbe seiner Seite. Sie bleiben flacher und dünner als der Bogenpfeil der Bewegungen;
// die eigenen stehen etwas höher und seitlich versetzt, damit Schüsse in beide Richtungen zwischen
// denselben Schiffen nebeneinander liegen statt übereinander. Der Schuss des gewählten Schützen ist dicker und
// heller; ein Schuss, der verpufft, weil sein Ziel dann schon zerstört ist, blass und gestrichelt, mit einem Kreuz
// statt der Spitze, das sich zur Kamera dreht.

import type { GlowLayer } from "@babylonjs/core/Layers/glowLayer";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Curve3 } from "@babylonjs/core/Maths/math.path";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { CreateBox } from "@babylonjs/core/Meshes/Builders/boxBuilder";
import { CreateCylinder } from "@babylonjs/core/Meshes/Builders/cylinderBuilder";
import { CreateTube } from "@babylonjs/core/Meshes/Builders/tubeBuilder";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import type { Scene } from "@babylonjs/core/scene";
import type { Side } from "../../../shared/board.ts";
import { color3 } from "../data/palette.ts";
import type { SlotPad } from "./slotPad.ts";

export interface TargetLine {
  from: SlotPad;
  to: SlotPad;
  /** Die Seite des Schützen bestimmt Farbe, Höhe und Versatz. */
  side: Side;
  /** Der Schuss verpufft: blass und gestrichelt, mit einem Kreuz statt der Spitze. */
  fizzle?: boolean;
  /** Der Schuss des gewählten Schützen: dicker und heller. */
  selected?: boolean;
}

/** Start über dem Schützen, Spitze knapp über dem Ziel, unter seinen Statusbalken. */
const START_HEIGHT = 0.9;
const TIP_HEIGHT = 0.95;
/** Scheitelhöhe über dem Brett. */
const ARC_HEIGHT: Record<Side, number> = { player: 2.7, enemy: 2.2 };
/** Seitlicher Versatz entlang der Lanes (Welt-z). */
const OFFSET: Record<Side, number> = { player: 0.16, enemy: -0.16 };
const TUBE_RADIUS = 0.022;
const HEAD_LENGTH = 0.34;
const HEAD_WIDTH = 0.24;
const SEGMENTS = 32;
const ALPHA = 0.75;
/** Der Schuss des gewählten Schützen: so viel dicker, fast deckend und zum Weiß hin aufgehellt. */
const SELECTED_SCALE = 1.9;
const SELECTED_ALPHA = 0.95;
const SELECTED_LIGHTEN = 0.3;
/** Ein verpuffender Schuss: blass und ins Grau gezogen, gewählt etwas kräftiger. */
const FIZZLE_ALPHA = 0.4;
const FIZZLE_SELECTED_ALPHA = 0.7;
const FIZZLE_GREY = new Color3(0.62, 0.64, 0.68);
const FIZZLE_FADE = 0.55;
/** Strichelung: so viele Abschnitte der Bahn je Strich, dann so viele frei. */
const DASH = 3;
const GAP = 2;
/** Das Kreuz an der Spitze eines verpuffenden Schusses. */
const CROSS_SIZE = 0.38;
const CROSS_WIDTH = 0.07;

export class TargetLines {
  /** Je Seite und Darstellung ein Material, erst bei Bedarf angelegt. */
  private readonly materials = new Map<string, StandardMaterial>();
  private meshes: Mesh[] = [];
  private lines: readonly TargetLine[] = [];
  /** Die gezeigten Bögen als Schlüssel, damit unveränderte nicht neu entstehen. */
  private shown = "";

  constructor(
    private readonly scene: Scene,
    private readonly glow: GlowLayer,
  ) {}

  /** Zeigt genau diese Bögen; ein leeres Array blendet alle aus. */
  show(lines: readonly TargetLine[]): void {
    const shown = lines.map(({ from, to, fizzle, selected }) => `${from.root.name}>${to.root.name}${fizzle ? "~" : ""}${selected ? "*" : ""}`).join(" ");
    if (shown === this.shown) return;
    this.clear();
    this.shown = shown;
    this.lines = lines;
    for (const line of lines) this.meshes.push(...this.arc(line));
  }

  /** Zeichnet die Bögen an der jetzigen Stelle der Pads neu, während das Brett beim Wechsel der Ansicht umzieht. */
  refresh(): void {
    const lines = this.lines;
    this.clear();
    this.show(lines);
  }

  private arc({ from, to, side, fizzle = false, selected = false }: TargetLine): Mesh[] {
    const up = Vector3.Up();
    const offset = new Vector3(0, 0, OFFSET[side]);
    const start = from.root.getAbsolutePosition().add(offset).addInPlace(up.scale(START_HEIGHT));
    const tip = to.root.getAbsolutePosition().add(offset).addInPlace(up.scale(TIP_HEIGHT));
    const headBase = tip.add(up.scale(HEAD_LENGTH));
    // Wie der Bogenpfeil: steil nach oben und leicht zum Ziel, am Ende senkrecht auf das Ziel herab.
    const curve = Curve3.CreateCubicBezier(
      start,
      start.add(up.scale(ARC_HEIGHT[side] - START_HEIGHT)).addInPlace(headBase.subtract(start).scale(0.25)),
      headBase.add(up.scale(ARC_HEIGHT[side] - TIP_HEIGHT)),
      headBase,
      SEGMENTS,
    );
    const scale = selected ? SELECTED_SCALE : 1;
    const points = curve.getPoints();
    const tube = fizzle
      ? this.dashes(points, TUBE_RADIUS * scale)
      : CreateTube("target-line", { path: points, radius: TUBE_RADIUS * scale, tessellation: 8 }, this.scene);
    const head = fizzle
      ? this.cross(scale)
      : CreateCylinder(
          "target-line-head",
          { height: HEAD_LENGTH, diameterTop: HEAD_WIDTH * Math.sqrt(scale), diameterBottom: 0, tessellation: 12 },
          this.scene,
        );
    head.position = tip.add(up.scale(HEAD_LENGTH / 2));
    for (const mesh of [tube, head]) {
      mesh.material = this.material(side, fizzle, selected);
      mesh.isPickable = false;
      this.glow.addIncludedOnlyMesh(mesh);
    }
    return [tube, head];
  }

  /** Die Bahn als Striche, zu einem Mesh verschmolzen. */
  private dashes(points: readonly Vector3[], radius: number): Mesh {
    const dashes: Mesh[] = [];
    for (let first = 0; first < points.length - 1; first += DASH + GAP) {
      dashes.push(CreateTube("target-line-dash", { path: points.slice(first, first + DASH + 1), radius, tessellation: 8 }, this.scene));
    }
    return Mesh.MergeMeshes(dashes, true)!;
  }

  /** Zwei gekreuzte Balken, immer zur Kamera gedreht, damit sie in beiden Ansichten zu lesen sind. */
  private cross(scale: number): Mesh {
    const bars = [Math.PI / 4, -Math.PI / 4].map((angle) => {
      const bar = CreateBox("target-line-cross", { width: CROSS_SIZE * Math.sqrt(scale), height: CROSS_WIDTH, depth: 0.01 }, this.scene);
      bar.rotation.z = angle;
      return bar;
    });
    const cross = Mesh.MergeMeshes(bars, true)!;
    cross.billboardMode = Mesh.BILLBOARDMODE_ALL;
    return cross;
  }

  private material(side: Side, fizzle: boolean, selected: boolean): StandardMaterial {
    const key = `${side}-${fizzle ? "fizzle" : "shot"}${selected ? "-selected" : ""}`;
    let material = this.materials.get(key);
    if (material) return material;
    material = new StandardMaterial(`target-line-${key}`, this.scene);
    material.disableLighting = true;
    const color = color3(side);
    if (fizzle) {
      material.emissiveColor = Color3.Lerp(color, FIZZLE_GREY, FIZZLE_FADE);
      material.alpha = selected ? FIZZLE_SELECTED_ALPHA : FIZZLE_ALPHA;
    } else {
      material.emissiveColor = selected ? Color3.Lerp(color, Color3.White(), SELECTED_LIGHTEN) : color;
      material.alpha = selected ? SELECTED_ALPHA : ALPHA;
    }
    this.materials.set(key, material);
    return material;
  }

  private clear(): void {
    for (const mesh of this.meshes) {
      this.glow.removeIncludedOnlyMesh(mesh);
      mesh.dispose();
    }
    this.meshes = [];
    this.shown = "";
  }
}
