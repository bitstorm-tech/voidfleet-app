// Die Pfeile vor den Spalten der Gegnerseite: Solange ein eigenes Schiff zielt, liegt vor jeder gegnerischen Spalte ein
// Ring mit zwei Winkeln auf dem Brett, die in die Spalte zeigen; ein Tipp darauf gibt dem Schiff Spaltenfeuer auf diese
// Spalte. Gilt sein Feuerbefehl schon dieser Spalte, ist der Ring gefüllt, unter dem Zeiger wird er größer. Jeder hängt
// zur Brettmitte hin vor dem Strike-Pad seiner Spalte und gleitet mit ihm, wenn die Ansicht wechselt.

import { Constants } from "@babylonjs/core/Engines/constants";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { DynamicTexture } from "@babylonjs/core/Materials/Textures/dynamicTexture";
import { CreateBox } from "@babylonjs/core/Meshes/Builders/boxBuilder";
import { CreateGround } from "@babylonjs/core/Meshes/Builders/groundBuilder";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { Scene } from "@babylonjs/core/scene";
import { color3 } from "../data/palette.ts";
import { PAD_WIDTH, type SlotPad } from "./slotPad.ts";

/** Kantenlänge des Pfeils und sein Abstand vom Strike-Pad (Welteinheiten), Platz für dessen leuchtenden Rahmen gelassen. */
const SIZE = 0.62;
const GAP = 0.22;
/** Knapp über dem Brett, wie die Marken. */
const LIFT = 0.07;
/** Deckkraft ohne Zeiger und Wahl; unter dem Zeiger wächst er. */
const IDLE_ALPHA = 0.7;
const HOVER_SCALE = 1.2;
const TEXTURE_SIZE = 128;

export interface ColumnMarkMaterials {
  open: StandardMaterial;
  /** Der Feuerbefehl des gewählten Schiffs gilt dieser Spalte. */
  chosen: StandardMaterial;
}

/** Ein Material je Zustand, für alle Pfeile; die Textur ist weiß, gefärbt wird über die Emission wie bei den Marken. */
export function createColumnMarkMaterials(scene: Scene): ColumnMarkMaterials {
  const material = (filled: boolean) => {
    const name = `column-mark-${filled ? "chosen" : "open"}`;
    const material = new StandardMaterial(name, scene);
    material.diffuseTexture = markTexture(name, scene, filled);
    material.useAlphaFromDiffuseTexture = true;
    material.emissiveColor = color3("select");
    material.disableLighting = true;
    material.disableDepthWrite = true;
    material.alphaMode = Constants.ALPHA_ADD;
    return material;
  };
  return { open: material(false), chosen: material(true) };
}

export class ColumnMark {
  readonly column: number;
  /** Das sichtbare Symbol; gehört in den GlowLayer. */
  readonly icon: Mesh;
  /** Unsichtbarer Treffer-Körper für das Picking, etwas größer als das Symbol; treffbar nur, solange es zu sehen ist. */
  readonly pickBox: Mesh;
  isShown = false;

  /** `pad` ist der Strike-Pad der Spalte auf der Gegnerseite; die Brettmitte liegt von ihm aus bei −x. */
  constructor(
    scene: Scene,
    pad: SlotPad,
    private readonly materials: ColumnMarkMaterials,
  ) {
    this.column = pad.slot.index;
    const name = `column-mark-${this.column}`;
    const root = new TransformNode(name, scene);
    root.parent = pad.root;
    root.position.x = -(PAD_WIDTH / 2 + GAP + SIZE / 2);

    this.icon = CreateGround(name, { width: SIZE, height: SIZE }, scene);
    this.icon.parent = root;
    this.icon.position.y = LIFT;
    this.icon.isPickable = false;
    this.icon.alphaIndex = 1;

    this.pickBox = CreateBox(`${name}-pick`, { width: SIZE + 0.3, height: 0.5, depth: SIZE + 0.4 }, scene);
    this.pickBox.parent = root;
    this.pickBox.isVisible = false;
    this.pickBox.metadata = { columnMark: this };
    this.show(false, false, false);
  }

  /** `shown`: Ein eigenes Schiff zielt gerade; `chosen`: Sein Spaltenfeuer gilt dieser Spalte; `hovered`: unter dem Zeiger. */
  show(shown: boolean, chosen: boolean, hovered: boolean): void {
    this.isShown = shown;
    this.icon.isVisible = shown;
    this.icon.material = chosen ? this.materials.chosen : this.materials.open;
    this.icon.scaling.setAll(hovered ? HOVER_SCALE : 1);
    this.icon.visibility = chosen || hovered ? 1 : IDLE_ALPHA;
  }
}

/** Ring mit zwei Winkeln, die nach +x in die Spalte zeigen, gefüllt mit schwachem Schein; im Einheitskreis gezeichnet. */
function markTexture(name: string, scene: Scene, filled: boolean): DynamicTexture {
  const texture = new DynamicTexture(name, { width: TEXTURE_SIZE, height: TEXTURE_SIZE }, scene, true);
  texture.hasAlpha = true;
  const context = texture.getContext() as unknown as CanvasRenderingContext2D;
  context.clearRect(0, 0, TEXTURE_SIZE, TEXTURE_SIZE);
  context.translate(TEXTURE_SIZE / 2, TEXTURE_SIZE / 2);
  context.scale(TEXTURE_SIZE / 2, TEXTURE_SIZE / 2);
  context.strokeStyle = "white";
  if (filled) {
    context.fillStyle = "rgb(255 255 255 / 0.4)";
    context.beginPath();
    context.arc(0, 0, 0.84, 0, 2 * Math.PI);
    context.fill();
  }
  context.lineWidth = 0.1;
  context.beginPath();
  context.arc(0, 0, 0.84, 0, 2 * Math.PI);
  context.stroke();
  context.lineWidth = 0.15;
  for (const tip of [-0.04, 0.3]) {
    context.beginPath();
    context.moveTo(tip - 0.28, -0.34);
    context.lineTo(tip, 0);
    context.lineTo(tip - 0.28, 0.34);
    context.stroke();
  }
  texture.update();
  return texture;
}
