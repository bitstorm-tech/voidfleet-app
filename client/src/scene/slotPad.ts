// Ein Landeplatz auf dem Brett: zeigt an, ob er gerade ein gültiges Ziel ist,
// und trägt das platzierte Schiff und den Geist eines eingeplanten. Die Breite liegt entlang der Lane-Achse (x),
// Schiffe unter dem Anker zeigen mit der Nase zum Gegner.

import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { CreateBox } from "@babylonjs/core/Meshes/Builders/boxBuilder";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { Scene } from "@babylonjs/core/scene";
import type { Slot } from "../../../shared/board.ts";
import { color3 } from "../data/palette.ts";
import type { ShipView } from "./ship.ts";

export const PAD_WIDTH = 2.5;
export const PAD_DEPTH = 1.7;
export const SHIP_ANCHOR_HEIGHT = 0.42;
/** Steht schon ein Schiff auf dem Pad (Phasentausch der Mirage), schwebt der Geist so hoch darüber. */
export const GHOST_LIFT = 0.85;
/** Breite des leuchtenden Rahmens um ein gültiges Ziel. */
const RIM = 0.12;

export interface PadMaterials {
  base: StandardMaterial;
  valid: StandardMaterial;
  hover: StandardMaterial;
}

export function createPadMaterials(scene: Scene): PadMaterials {
  const base = new StandardMaterial("pad-base", scene);
  base.diffuseColor = new Color3(0.07, 0.13, 0.21);
  base.specularColor = new Color3(0.08, 0.08, 0.08);
  base.emissiveColor = new Color3(0.09, 0.2, 0.32).scale(0.3);
  base.alpha = 0.45;

  const valid = new StandardMaterial("pad-valid", scene);
  valid.disableLighting = true;
  valid.emissiveColor = color3("select");
  valid.alpha = 0.42;

  const hover = new StandardMaterial("pad-hover", scene);
  hover.disableLighting = true;
  hover.emissiveColor = new Color3(0.82, 0.98, 1);
  hover.alpha = 0.45;

  return { base, valid, hover };
}

export class SlotPad {
  readonly root: TransformNode;
  readonly shipAnchor: TransformNode;
  /** Unsichtbarer Treffer-Körper für das Picking, etwas höher als die Platte. */
  readonly pickBox: Mesh;
  /** Leuchtender Rahmen; das einzige Mesh des Pads, das in den GlowLayer gehört. */
  readonly validGlow: Mesh;
  private readonly baseMesh: Mesh;
  private readonly hoverGlow: Mesh;
  private isGridVisible = false;
  private isValidTarget = false;
  private isHovered = false;
  ship: ShipView | null = null;
  /** Geist eines eingeplanten Schiffs, das nach den Bewegungen dieser Runde hier steht. */
  ghost: ShipView | null = null;

  constructor(
    scene: Scene,
    parent: TransformNode,
    readonly slot: Slot,
    /** Blickrichtung der Schiffe: +1 für die Spielerseite (nach rechts), -1 für den Gegner. */
    facing: 1 | -1,
    materials: PadMaterials,
  ) {
    const name = `pad-${slot.lane.side}-${slot.lane.type}-${slot.index}`;
    this.root = new TransformNode(name, scene);
    this.root.parent = parent;

    this.baseMesh = CreateBox(`${name}-base`, { width: PAD_WIDTH, height: 0.08, depth: PAD_DEPTH }, scene);
    this.baseMesh.material = materials.base;

    this.validGlow = createFrame(`${name}-valid`, PAD_WIDTH, PAD_DEPTH, scene);
    this.validGlow.material = materials.valid;
    this.validGlow.position.y = -0.035;

    this.hoverGlow = CreateBox(`${name}-hover`, { width: PAD_WIDTH - 0.08, height: 0.02, depth: PAD_DEPTH - 0.08 }, scene);
    this.hoverGlow.material = materials.hover;
    this.hoverGlow.position.y = 0.055;

    this.pickBox = CreateBox(`${name}-pick`, { width: PAD_WIDTH, height: 0.5, depth: PAD_DEPTH }, scene);
    this.pickBox.isVisible = false;
    this.pickBox.metadata = { pad: this };

    for (const mesh of [this.baseMesh, this.validGlow, this.hoverGlow, this.pickBox]) {
      mesh.parent = this.root;
    }
    for (const mesh of [this.baseMesh, this.validGlow, this.hoverGlow]) {
      mesh.isPickable = false;
    }

    this.shipAnchor = new TransformNode(`${name}-anchor`, scene);
    this.shipAnchor.parent = this.root;
    this.shipAnchor.position.y = SHIP_ANCHOR_HEIGHT;
    this.shipAnchor.rotation.y = (facing * Math.PI) / 2;

    this.updateVisuals();
  }

  /** Der Landeplatz selbst ist nur beim Platzieren zu sehen; das Schiff darauf bleibt. */
  setGridVisible(value: boolean): void {
    this.isGridVisible = value;
    this.updateVisuals();
  }

  setValidTarget(value: boolean): void {
    this.isValidTarget = value;
    this.updateVisuals();
  }

  setHovered(value: boolean): void {
    this.isHovered = value;
    this.updateVisuals();
  }

  attachShip(ship: ShipView): void {
    this.clearShip();
    this.ship = ship;
    ship.root.parent = this.shipAnchor;
    this.updateVisuals();
  }

  /** Nimmt das Schiff vom Pad, ohne es zu entsorgen (Lane-Wechsel, Zerstörung). */
  detachShip(): ShipView {
    const ship = this.ship!;
    this.ship = null;
    this.updateVisuals();
    return ship;
  }

  clearShip(): void {
    this.ship?.dispose();
    this.ship = null;
    this.updateVisuals();
  }

  /** Stellt den Geist auf den Pad; über einem echten Schiff schwebt er (`GHOST_LIFT`). */
  attachGhost(ghost: ShipView): void {
    this.clearGhost();
    this.ghost = ghost;
    ghost.root.parent = this.shipAnchor;
    ghost.root.position.y = this.ship ? GHOST_LIFT : 0;
    this.updateVisuals();
  }

  clearGhost(): void {
    this.ghost?.dispose();
    this.ghost = null;
    this.updateVisuals();
  }

  private updateVisuals(): void {
    this.baseMesh.isVisible = this.isGridVisible;
    this.validGlow.isVisible = this.isValidTarget;
    // Beim Platzieren (Gitter sichtbar) zeigt der Geist unter dem Zeiger den Slot schon an. Der Geist
    // des geplanten Schiffs als Befehlsziel wird markiert wie ein echtes Schiff.
    this.hoverGlow.isVisible = this.isValidTarget && this.isHovered && !(this.isGridVisible && this.ghost !== null);
  }
}

/** Vier dünne Kästen als Rahmen außen um die Platte, zu einem Mesh verschmolzen. */
function createFrame(name: string, width: number, depth: number, scene: Scene): Mesh {
  const height = 0.04;
  const alongX = { width: width + 2 * RIM, height, depth: RIM };
  const alongZ = { width: RIM, height, depth };
  const north = CreateBox(`${name}-n`, alongX, scene);
  north.position.z = depth / 2 + RIM / 2;
  const south = CreateBox(`${name}-s`, alongX, scene);
  south.position.z = -depth / 2 - RIM / 2;
  const east = CreateBox(`${name}-e`, alongZ, scene);
  east.position.x = width / 2 + RIM / 2;
  const west = CreateBox(`${name}-w`, alongZ, scene);
  west.position.x = -width / 2 - RIM / 2;
  return Mesh.MergeMeshes([north, south, east, west], true, true)!;
}
