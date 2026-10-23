// Ein Schiff auf dem Brett. Die Nase zeigt nach lokal +Z, die Ausrichtung
// bestimmt allein der Elternknoten (der Anker des SlotPads).
// Die Modelle kommen als glTF aus `tools/ships/` (Blender); jede Datei wird
// einmal geladen und pro Schiff instanziiert.

import type { AssetContainer } from "@babylonjs/core/assetContainer";
import { LoadAssetContainerAsync } from "@babylonjs/core/Loading/sceneLoader";
import { Material } from "@babylonjs/core/Materials/material";
import { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { CreatePlane } from "@babylonjs/core/Meshes/Builders/planeBuilder";
import { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { Tools } from "@babylonjs/core/Misc/tools";
import type { Scene } from "@babylonjs/core/scene";
// Registriert `renderOverlay` auf Mesh: zeichnet das Modell in einer Farbe darüber (Treffer-Blitz).
import "@babylonjs/core/Rendering/outlineRenderer";
import type { ShipCard } from "../../../shared/cards.ts";
import { color3 } from "../data/palette.ts";
import { shipModel } from "../data/shipModels.ts";
import { easeInCubic, easeOutCubic, tween } from "./tween.ts";

/** Schiffe sind für den Hangar modelliert und auf dem Brett zu groß. */
const BOARD_SCALE = 0.6;
const MODEL_SCALE = 0.5;
/** Die Balken schweben mindestens so hoch, bei hohen Aufbauten knapp über dem Modell. */
const BAR_MIN_HEIGHT = 1.15;
const BAR_MARGIN = 0.3;
/** Deploy: Das Schiff kommt aus dieser Höhe über dem Pad herunter und richtet sich beim Abbremsen auf. */
const LANDING_HEIGHT = 7;
const LANDING_DURATION = 950;
const LANDING_PITCH = Tools.ToRadians(-16);
/** Treffer: Die Hülle leuchtet kurz auf und klingt wieder ab. */
const HIT_FLASH_COLOR = new Color3(1, 0.93, 0.8);
const HIT_FLASH_ALPHA = 0.75;
const HIT_FLASH_DURATION = 220;
/** Geist-Schiffe zeigen einen geplanten, noch nicht ausgeführten Zug: halb durchsichtig. */
const GHOST_ALPHA = 0.35;
/** Hologramm-Schimmer in der Farbe der leuchtenden Slots, damit der Geist nicht wie ein echtes Schiff wirkt. */
const GHOST_TINT = new Color3(0.2, 0.62, 0.95);
const GHOST_ALBEDO = new Color3(0.45, 0.6, 0.75);

const BAR_WIDTH = 2.56;
const HP_COLOR_EMPTY = color3("hpEmpty");
const HP_COLOR_HALF = color3("hpHalf");
const HP_COLOR_FULL = color3("hpFull");
const BAR_TRACK_COLOR = new Color3(0.13, 0.15, 0.22);

const containerCache = new Map<string, Promise<AssetContainer>>();

function loadModel(url: string, scene: Scene): Promise<AssetContainer> {
  let promise = containerCache.get(url);
  if (!promise) {
    promise = LoadAssetContainerAsync(url, scene);
    containerCache.set(url, promise);
  }
  return promise;
}

export class ShipView {
  readonly root: TransformNode;
  private readonly modelRoot: TransformNode;
  private readonly statusBars: TransformNode;
  private readonly hpFill: Mesh;
  private readonly shieldRow: TransformNode;
  private readonly shieldFill: Mesh;
  /** Eigene Materialien (Balken, Geist-Kopien); glTF-Materialien gehören dem geteilten Container. */
  private readonly ownedMaterials: Material[] = [];
  /** Geist-Kopie je glTF-Material, damit Meshes mit gleichem Material auch die Kopie teilen. */
  private readonly ghostMaterials = new Map<Material, Material>();
  private disposed = false;

  constructor(
    private readonly scene: Scene,
    readonly card: ShipCard,
    readonly isGhost: boolean,
  ) {
    this.root = new TransformNode(`ship-${card.id}`, scene);
    this.root.scaling.setAll(BOARD_SCALE);

    this.modelRoot = new TransformNode("model", scene);
    this.modelRoot.parent = this.root;

    this.statusBars = new TransformNode("status", scene);
    this.statusBars.parent = this.root;
    this.statusBars.position.y = BAR_MIN_HEIGHT;
    this.statusBars.setEnabled(!isGhost);

    this.createBar("hp-track", 2.72, 0.3, BAR_TRACK_COLOR, 0.92, this.statusBars, 1);
    this.hpFill = this.createBar("hp-fill", BAR_WIDTH, 0.19, HP_COLOR_FULL, 0.999, this.statusBars, 2);

    this.shieldRow = new TransformNode("shield-row", scene);
    this.shieldRow.parent = this.statusBars;
    this.shieldRow.position.y = -0.29;
    this.createBar("shield-track", 2.72, 0.21, BAR_TRACK_COLOR, 0.92, this.shieldRow, 1);
    this.shieldFill = this.createBar("shield-fill", BAR_WIDTH, 0.12, color3("shield"), 0.999, this.shieldRow, 2);

    void this.addModel(shipModel(card));
    this.setStats(card.hp, card.shield);
  }

  /** Live-Werte über dem Schiff; die Maxima kommen aus der Karte. */
  setStats(hp: number, shield: number): void {
    const hpRatio = ratio(hp, this.card.hp);
    this.setFill(this.hpFill, hpRatio);
    (this.hpFill.material as StandardMaterial).emissiveColor = hpColor(hpRatio);

    const shieldMax = Math.max(this.card.shield, shield);
    this.shieldRow.setEnabled(shieldMax > 0);
    if (shieldMax > 0) this.setFill(this.shieldFill, ratio(shield, shieldMax));
  }

  /** Deploy: landet von oben auf dem Pad und bremst vor dem Aufsetzen ab; die Balken erscheinen erst danach. */
  async land(): Promise<void> {
    this.statusBars.setEnabled(false);
    await tween(this.scene, LANDING_DURATION, (progress) => {
      const remaining = 1 - easeOutCubic(progress);
      this.root.position.y = remaining * LANDING_HEIGHT;
      this.modelRoot.rotation.x = remaining * LANDING_PITCH;
    });
    this.statusBars.setEnabled(true);
  }

  /** Treffer: die Hülle blitzt hell auf; der Einschlag selbst kommt aus `BoardEffects.hit`. */
  async flash(): Promise<void> {
    const meshes = this.modelRoot.getChildMeshes().filter((mesh) => mesh instanceof Mesh);
    for (const mesh of meshes) {
      mesh.renderOverlay = true;
      mesh.overlayColor = HIT_FLASH_COLOR;
    }
    await tween(this.scene, HIT_FLASH_DURATION, (progress) => {
      for (const mesh of meshes) mesh.overlayAlpha = HIT_FLASH_ALPHA * (1 - progress) ** 2;
    });
    for (const mesh of meshes) mesh.renderOverlay = false;
  }

  /** Zerstörung: schrumpft weg und wird danach entsorgt. */
  async vanish(): Promise<void> {
    await tween(this.scene, 420, (progress) => {
      this.root.scaling.setAll(BOARD_SCALE * (1 - easeInCubic(progress)));
      this.root.rotation.z = progress * 0.9;
    });
    this.dispose();
  }

  dispose(): void {
    this.disposed = true;
    this.root.dispose(false, false);
    // Geist-Kopien klonen beim `clone()` auch ihre Texturen; die gehören dann ebenfalls diesem Schiff.
    for (const material of this.ownedMaterials) material.dispose(false, true);
  }

  private async addModel(url: string): Promise<void> {
    const container = await loadModel(url, this.scene);
    if (this.disposed) return;
    const entries = container.instantiateModelsToScene((name) => `${this.card.id}-${name}`, false);
    for (const node of entries.rootNodes) {
      node.parent = this.modelRoot;
      if (node instanceof TransformNode) node.scaling.scaleInPlace(MODEL_SCALE);
      for (const mesh of node.getChildMeshes()) this.prepareMesh(mesh);
      if (node instanceof AbstractMesh) this.prepareMesh(node);
    }
    // Höchsten Punkt des Modells in den Raum des Schiffs zurückrechnen, damit die Balken frei bleiben.
    this.root.computeWorldMatrix(true);
    const { max } = this.modelRoot.getHierarchyBoundingVectors();
    const top = Vector3.TransformCoordinates(max, this.root.getWorldMatrix().clone().invert()).y;
    this.statusBars.position.y = Math.max(BAR_MIN_HEIGHT, top + BAR_MARGIN);
  }

  private prepareMesh(mesh: AbstractMesh): void {
    mesh.isPickable = false;
    if (this.isGhost && mesh.material) mesh.material = this.ghostMaterial(mesh.material);
  }

  /**
   * Der glTF-Loader stellt undurchsichtige Materialien fest auf OPAQUE, `visibility` allein wirkt
   * dann nicht. Der Geist bekommt deshalb geblendete Kopien; der Tiefen-Vorlauf zeigt nur die
   * vorderste Hülle, statt Innenflächen durchscheinen zu lassen. Spiegelungen der Umgebung
   * würden PBR-Material sonst unabhängig vom Alpha voll deckend zeichnen.
   */
  private ghostMaterial(source: Material): Material {
    let ghost = this.ghostMaterials.get(source);
    if (!ghost) {
      ghost = source.clone(`${source.name}-ghost`)!;
      ghost.transparencyMode = Material.MATERIAL_ALPHABLEND;
      ghost.alpha = GHOST_ALPHA;
      ghost.needDepthPrePass = true;
      if (ghost instanceof PBRMaterial) {
        ghost.useRadianceOverAlpha = false;
        ghost.useSpecularOverAlpha = false;
        ghost.albedoColor = GHOST_ALBEDO;
        ghost.emissiveColor = GHOST_TINT;
        ghost.emissiveIntensity = 1;
      }
      this.ghostMaterials.set(source, ghost);
      this.ownedMaterials.push(ghost);
    }
    return ghost;
  }

  /** Alle Balken sind alpha-geblendet, damit `alphaIndex` die Reihenfolge Spur -> Füllung bestimmt. */
  private createBar(name: string, width: number, height: number, color: Color3, alpha: number, parent: TransformNode, order: number): Mesh {
    const material = new StandardMaterial(`${name}-material`, this.scene);
    material.disableLighting = true;
    material.emissiveColor = color;
    material.alpha = alpha;
    material.disableDepthWrite = true;
    this.ownedMaterials.push(material);
    const mesh = CreatePlane(name, { width, height }, this.scene);
    mesh.material = material;
    mesh.billboardMode = Mesh.BILLBOARDMODE_ALL;
    mesh.isPickable = false;
    mesh.renderingGroupId = 1;
    mesh.alphaIndex = order;
    mesh.parent = parent;
    return mesh;
  }

  /** Der Balken wächst von links: schmaler skalieren und nach links versetzen. */
  private setFill(bar: Mesh, fillRatio: number): void {
    bar.setEnabled(fillRatio > 0);
    bar.scaling.x = fillRatio;
    bar.position.x = (-BAR_WIDTH * (1 - fillRatio)) / 2;
  }
}

function ratio(current: number, maximum: number): number {
  if (maximum <= 0) return 0;
  return Math.min(Math.max(current / maximum, 0), 1);
}

function hpColor(hpRatio: number): Color3 {
  if (hpRatio >= 0.5) return Color3.Lerp(HP_COLOR_HALF, HP_COLOR_FULL, (hpRatio - 0.5) * 2);
  return Color3.Lerp(HP_COLOR_EMPTY, HP_COLOR_HALF, hpRatio * 2);
}
