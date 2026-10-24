// Leuchtender Bogenpfeil über dem Brett, der eine geplante Bewegung zeigt:
// Er steigt über dem Schiff auf, wölbt sich zum Ziel-Slot und fällt senkrecht
// auf ihn herab, damit die Spitze klar auf den Slot zeigt.

import type { GlowLayer } from "@babylonjs/core/Layers/glowLayer";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Curve3 } from "@babylonjs/core/Maths/math.path";
import { CreateCylinder } from "@babylonjs/core/Meshes/Builders/cylinderBuilder";
import { CreateTube } from "@babylonjs/core/Meshes/Builders/tubeBuilder";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import type { Scene } from "@babylonjs/core/scene";
import { color3 } from "../data/palette.ts";
import type { SlotPad } from "./slotPad.ts";

/** Start über dem Schiff, Spitze über dem Geist im Ziel-Slot, damit sie nicht im Modell verschwindet. */
const START_HEIGHT = 1.1;
const TIP_HEIGHT = 1.45;
/** Scheitelhöhe des Bogens über dem Brett. */
const ARC_HEIGHT = 4;
const TUBE_RADIUS = 0.045;
const HEAD_LENGTH = 0.6;
const HEAD_WIDTH = 0.46;
const SEGMENTS = 48;

export class MoveArrow {
  private readonly material: StandardMaterial;
  private meshes: Mesh[] = [];
  private shown: { from: SlotPad; to: SlotPad } | null = null;

  constructor(
    private readonly scene: Scene,
    private readonly glow: GlowLayer,
  ) {
    this.material = new StandardMaterial("move-arrow", scene);
    this.material.disableLighting = true;
    this.material.emissiveColor = color3("select");
    this.material.alpha = 0.9;
  }

  /** Zeigt den Pfeil von `from` nach `to`; steht er schon so, bleibt er. */
  show(from: SlotPad, to: SlotPad): void {
    if (this.shown?.from === from && this.shown.to === to) return;
    this.hide();
    this.shown = { from, to };

    const up = Vector3.Up();
    const start = from.root.getAbsolutePosition().add(up.scale(START_HEIGHT));
    const tip = to.root.getAbsolutePosition().add(up.scale(TIP_HEIGHT));
    const headBase = tip.add(up.scale(HEAD_LENGTH));
    // Erst steil nach oben und leicht zum Ziel, am Ende senkrecht über dem Ziel herab.
    const lift = up.scale(ARC_HEIGHT - START_HEIGHT);
    const curve = Curve3.CreateCubicBezier(
      start,
      start.add(lift).add(headBase.subtract(start).scale(0.25)),
      headBase.add(up.scale(ARC_HEIGHT - TIP_HEIGHT)),
      headBase,
      SEGMENTS,
    );

    const tube = CreateTube("move-arrow-tube", { path: curve.getPoints(), radius: TUBE_RADIUS, tessellation: 12 }, this.scene);
    // Spitze nach unten: oben breit, unten null.
    const head = CreateCylinder(
      "move-arrow-head",
      { height: HEAD_LENGTH, diameterTop: HEAD_WIDTH, diameterBottom: 0, tessellation: 16 },
      this.scene,
    );
    head.position = tip.add(up.scale(HEAD_LENGTH / 2));

    this.meshes = [tube, head];
    for (const mesh of this.meshes) {
      mesh.material = this.material;
      mesh.isPickable = false;
      this.glow.addIncludedOnlyMesh(mesh);
    }
  }

  hide(): void {
    for (const mesh of this.meshes) {
      this.glow.removeIncludedOnlyMesh(mesh);
      mesh.dispose();
    }
    this.meshes = [];
    this.shown = null;
  }
}
