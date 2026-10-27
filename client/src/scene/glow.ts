// Der GlowLayer der Szene. Er zeichnet nur, was ihm ausdrücklich gegeben wird, in ein eigenes Bild, verwischt es und
// legt es über die Szene. Damit der Schein der Marken am Boden nicht durch die Schiffe darüber scheint, zeichnen sich
// die Rümpfe in diesem Bild schwarz: Sie verdecken dort, was hinter ihnen leuchtet, ohne selbst zu leuchten.

import { GlowLayer } from "@babylonjs/core/Layers/glowLayer";
import type { Material } from "@babylonjs/core/Materials/material";
import type { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import type { Color4 } from "@babylonjs/core/Maths/math.color";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import type { Scene } from "@babylonjs/core/scene";

const occluders = new WeakSet<AbstractMesh>();

export function createGlowLayer(scene: Scene): GlowLayer {
  const glow = new GlowLayer("glow", scene, { blurKernelSize: 48 });
  glow.intensity = 0.7;
  glow.customEmissiveColorSelector = emissiveColor;
  return glow;
}

/** `mesh` verdeckt im Bild des GlowLayers, was hinter ihm leuchtet. */
export function occludeGlow(scene: Scene, mesh: AbstractMesh): void {
  occluders.add(mesh);
  scene.getGlowLayerByName("glow")?.addIncludedOnlyMesh(mesh as Mesh);
}

/** Wie Babylons eigene Wahl (Emission mal Stärke der Emissionstextur; leuchten tun nur StandardMaterials), nur Verdecker bleiben schwarz. */
function emissiveColor(mesh: Mesh, _subMesh: unknown, material: Material, result: Color4): void {
  if (occluders.has(mesh)) {
    result.set(0, 0, 0, 1);
    return;
  }
  const { emissiveColor: color, emissiveTexture } = material as StandardMaterial;
  const level = emissiveTexture?.level ?? 1;
  result.set(color.r * level, color.g * level, color.b * level, material.alpha);
}
