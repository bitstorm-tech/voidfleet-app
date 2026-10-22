// Beschriftung einer Lane als Billboard-Text im 3D-Raum (Godots Label3D).

import { DynamicTexture } from "@babylonjs/core/Materials/Textures/dynamicTexture";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { CreatePlane } from "@babylonjs/core/Meshes/Builders/planeBuilder";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import type { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { Scene } from "@babylonjs/core/scene";

const TEXTURE_WIDTH = 1024;
const TEXTURE_HEIGHT = 160;
const PLANE_WIDTH = 3.6;

export class LaneLabel {
  readonly mesh: Mesh;

  constructor(scene: Scene, parent: TransformNode, text: string, color: string) {
    const texture = new DynamicTexture(`label-${text}`, { width: TEXTURE_WIDTH, height: TEXTURE_HEIGHT }, scene);
    texture.hasAlpha = true;
    texture.drawText(text, null, null, "bold 112px sans-serif", color, null, true);

    const material = new StandardMaterial(`label-${text}`, scene);
    material.diffuseTexture = texture;
    material.useAlphaFromDiffuseTexture = true;
    material.emissiveColor = Color3.White();
    material.disableLighting = true;
    material.backFaceCulling = false;

    this.mesh = CreatePlane(`label-${text}`, { width: PLANE_WIDTH, height: (PLANE_WIDTH * TEXTURE_HEIGHT) / TEXTURE_WIDTH }, scene);
    this.mesh.material = material;
    this.mesh.billboardMode = Mesh.BILLBOARDMODE_ALL;
    this.mesh.isPickable = false;
    this.mesh.parent = parent;
    this.mesh.position = new Vector3(0, 0.35, 6.4);
  }

  set visible(value: boolean) {
    this.mesh.isVisible = value;
  }
}
