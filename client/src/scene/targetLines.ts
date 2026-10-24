// Bögen der Zielvorschau: je Schuss ein dünner leuchtender Bogen vom Schützen, der von oben auf sein Ziel
// fällt, in der Farbe seiner Seite. Sie bleiben flacher und dünner als der Bogenpfeil der Bewegungen;
// die eigenen stehen etwas höher und seitlich versetzt, damit Schüsse in beide Richtungen zwischen
// denselben Schiffen nebeneinander liegen statt übereinander.

import type { GlowLayer } from "@babylonjs/core/Layers/glowLayer";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Curve3 } from "@babylonjs/core/Maths/math.path";
import { CreateCylinder } from "@babylonjs/core/Meshes/Builders/cylinderBuilder";
import { CreateTube } from "@babylonjs/core/Meshes/Builders/tubeBuilder";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import type { Scene } from "@babylonjs/core/scene";
import type { Side } from "../../../shared/board.ts";
import { color3 } from "../data/palette.ts";
import type { SlotPad } from "./slotPad.ts";

export interface TargetLine {
  from: SlotPad;
  to: SlotPad;
  /** Die Seite des Schützen bestimmt Farbe, Höhe und Versatz. */
  side: Side;
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

export class TargetLines {
  private readonly materials: Record<Side, StandardMaterial>;
  private meshes: Mesh[] = [];
  /** Die gezeigten Bögen als Schlüssel, damit unveränderte nicht neu entstehen. */
  private shown = "";

  constructor(
    private readonly scene: Scene,
    private readonly glow: GlowLayer,
  ) {
    const material = (side: Side) => {
      const material = new StandardMaterial(`target-line-${side}`, scene);
      material.disableLighting = true;
      material.emissiveColor = color3(side);
      material.alpha = ALPHA;
      return material;
    };
    this.materials = { player: material("player"), enemy: material("enemy") };
  }

  /** Zeigt genau diese Bögen; ein leeres Array blendet alle aus. */
  show(lines: readonly TargetLine[]): void {
    const shown = lines.map(({ from, to }) => `${from.root.name}>${to.root.name}`).join(" ");
    if (shown === this.shown) return;
    this.clear();
    this.shown = shown;
    for (const line of lines) this.meshes.push(...this.arc(line));
  }

  private arc({ from, to, side }: TargetLine): Mesh[] {
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
    const tube = CreateTube("target-line", { path: curve.getPoints(), radius: TUBE_RADIUS, tessellation: 8 }, this.scene);
    const head = CreateCylinder("target-line-head", { height: HEAD_LENGTH, diameterTop: HEAD_WIDTH, diameterBottom: 0, tessellation: 12 }, this.scene);
    head.position = tip.add(up.scale(HEAD_LENGTH / 2));
    for (const mesh of [tube, head]) {
      mesh.material = this.materials[side];
      mesh.isPickable = false;
      this.glow.addIncludedOnlyMesh(mesh);
    }
    return [tube, head];
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
