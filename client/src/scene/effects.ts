// Kurzlebige Effekte auf dem Brett: Laserbolzen, Impulse und Explosionen.
// Alle leuchten über den GlowLayer und räumen sich nach dem Abspielen selbst weg.

import { Constants } from "@babylonjs/core/Engines/constants";
import type { GlowLayer } from "@babylonjs/core/Layers/glowLayer";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { CreateSphere } from "@babylonjs/core/Meshes/Builders/sphereBuilder";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import type { Scene } from "@babylonjs/core/scene";
import { easeInCubic, easeOutCubic, tween } from "./tween.ts";

/** Welteinheiten pro Sekunde. */
const BOLT_SPEED = 15;
const BOLT_STRETCH = 5;
/** Impulse werden additiv gemischt und wirken so wie Licht statt wie eine Kugel. */
const PULSE_ALPHA = 0.55;
const EXPLOSION_CORE = new Color3(1, 0.95, 0.8);
const EXPLOSION_FIRE = new Color3(1, 0.45, 0.12);

export class BoardEffects {
  constructor(
    private readonly scene: Scene,
    private readonly glow: GlowLayer,
  ) {}

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

  async explosion(position: Vector3): Promise<void> {
    await Promise.all([
      this.pulse(position, EXPLOSION_CORE, 1.1, 300),
      this.pulse(position, EXPLOSION_FIRE, 2.4, 700),
    ]);
  }

  private createSphere(name: string, diameter: number, color: Color3, alpha: number): Mesh {
    const material = new StandardMaterial(`${name}-material`, this.scene);
    material.disableLighting = true;
    material.emissiveColor = color;
    material.alpha = alpha;
    material.alphaMode = Constants.ALPHA_ADD;
    material.disableDepthWrite = true;
    const mesh = CreateSphere(name, { diameter, segments: 12 }, this.scene);
    mesh.material = material;
    mesh.isPickable = false;
    this.glow.addIncludedOnlyMesh(mesh);
    return mesh;
  }

  private disposeMesh(mesh: Mesh): void {
    this.glow.removeIncludedOnlyMesh(mesh);
    mesh.material!.dispose();
    mesh.dispose();
  }
}
