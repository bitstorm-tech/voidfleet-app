// Leuchtende Fadenkreuze auf Slots der Gegnerseite: zeigen, wohin der geplante Befehl
// zielt (Torpedo, Wärmesucher, Traktorstrahl; Durchschlag auf beide Slots seiner
// Slot-Nummer), und beim Wählen das Ziel unter dem Zeiger. Sie markieren den Slot beim
// Planen; was dort nach allen Bewegungen steht bzw. wohin das Schiff zieht, regelt die Auflösung.

import type { GlowLayer } from "@babylonjs/core/Layers/glowLayer";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { CreateBox } from "@babylonjs/core/Meshes/Builders/boxBuilder";
import { CreateTorus } from "@babylonjs/core/Meshes/Builders/torusBuilder";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import type { Scene } from "@babylonjs/core/scene";
import { color3 } from "../data/palette.ts";
import type { SlotPad } from "./slotPad.ts";

const DIAMETER = 1.3;
const THICKNESS = 0.05;
/** Die vier Striche ragen über den Ring hinaus nach außen. */
const TICK_LENGTH = 0.42;
const HEIGHT = 0.08;
/** Langsames Kreisen, damit das Fadenkreuz lebendig wirkt (Radiant pro Millisekunde). */
const SPIN = 0.0006;

export class TargetReticle {
  /** Je gezeigtem Slot ein Fadenkreuz; weitere entstehen bei Bedarf als Klon des ersten. */
  private readonly meshes: Mesh[];
  private shown: readonly SlotPad[] = [];

  constructor(
    scene: Scene,
    private readonly glow: GlowLayer,
  ) {
    const material = new StandardMaterial("target-reticle", scene);
    material.disableLighting = true;
    material.emissiveColor = color3("damage");
    material.alpha = 0.9;

    const ring = CreateTorus("target-reticle-ring", { diameter: DIAMETER, thickness: THICKNESS, tessellation: 48 }, scene);
    const ticks = [0, 1, 2, 3].map((quarter) => {
      const tick = CreateBox("target-reticle-tick", { width: TICK_LENGTH, height: THICKNESS, depth: THICKNESS }, scene);
      const angle = (quarter * Math.PI) / 2;
      const radius = DIAMETER / 2;
      tick.position.set(Math.cos(angle) * radius, 0, Math.sin(angle) * radius);
      tick.rotation.y = -angle;
      return tick;
    });
    const mesh = Mesh.MergeMeshes([ring, ...ticks], true, true)!;
    mesh.name = "target-reticle";
    mesh.material = material;
    mesh.isPickable = false;
    mesh.isVisible = false;
    mesh.position.y = HEIGHT;
    glow.addIncludedOnlyMesh(mesh);
    this.meshes = [mesh];
    scene.onBeforeRenderObservable.add(() => {
      const spin = SPIN * scene.getEngine().getDeltaTime();
      for (const reticle of this.meshes) if (reticle.isVisible) reticle.rotation.y += spin;
    });
  }

  /** Zeigt je ein Fadenkreuz auf den `pads`, mit einer leeren Liste keines. */
  show(pads: readonly SlotPad[]): void {
    if (pads.length === this.shown.length && pads.every((pad, index) => pad === this.shown[index])) return;
    this.shown = pads;
    while (this.meshes.length < pads.length) {
      const reticle = this.meshes[0]!.clone(`target-reticle-${this.meshes.length}`);
      this.glow.addIncludedOnlyMesh(reticle);
      this.meshes.push(reticle);
    }
    this.meshes.forEach((reticle, index) => {
      const pad = pads[index];
      reticle.isVisible = pad !== undefined;
      if (pad) reticle.parent = pad.root;
    });
  }
}
