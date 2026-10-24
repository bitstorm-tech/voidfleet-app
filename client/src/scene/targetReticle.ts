// Leuchtendes Fadenkreuz auf einem Slot der Gegnerseite: zeigt, wohin der geplante
// Torpedo zielt, und beim Wählen den Slot unter dem Zeiger. Es markiert den Slot,
// nicht das Schiff, weil der Torpedo trifft, wer nach allen Bewegungen dort steht.

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
  private readonly mesh: Mesh;
  private shown: SlotPad | null = null;

  constructor(scene: Scene, glow: GlowLayer) {
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
    this.mesh = Mesh.MergeMeshes([ring, ...ticks], true, true)!;
    this.mesh.name = "target-reticle";
    this.mesh.material = material;
    this.mesh.isPickable = false;
    this.mesh.isVisible = false;
    this.mesh.position.y = HEIGHT;
    glow.addIncludedOnlyMesh(this.mesh);
    scene.onBeforeRenderObservable.add(() => {
      if (this.shown) this.mesh.rotation.y += SPIN * scene.getEngine().getDeltaTime();
    });
  }

  /** Zeigt das Fadenkreuz auf `pad`, mit null nirgends. */
  show(pad: SlotPad | null): void {
    if (pad === this.shown) return;
    this.shown = pad;
    this.mesh.isVisible = pad !== null;
    if (pad) this.mesh.parent = pad.root;
  }
}
