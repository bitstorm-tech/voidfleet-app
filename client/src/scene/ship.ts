// Ein Schiff auf dem Brett. Die Nase zeigt nach lokal +Z, die Ausrichtung
// bestimmt allein der Elternknoten (der Anker des SlotPads).
// Handgebaute Modelle pro Karten-ID; Schiffe ohne Modell nutzen den
// prozeduralen Kitbash-Fallback aus einfachen Primitiven.

import type { AssetContainer } from "@babylonjs/core/assetContainer";
import { LoadAssetContainerAsync } from "@babylonjs/core/Loading/sceneLoader";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { CreateBox } from "@babylonjs/core/Meshes/Builders/boxBuilder";
import { CreateCylinder } from "@babylonjs/core/Meshes/Builders/cylinderBuilder";
import { CreatePlane } from "@babylonjs/core/Meshes/Builders/planeBuilder";
import { CreateSphere } from "@babylonjs/core/Meshes/Builders/sphereBuilder";
import { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { Tools } from "@babylonjs/core/Misc/tools";
import type { Scene } from "@babylonjs/core/scene";
import type { ShipCard } from "../../../shared/cards.ts";
import { cardColor, lightened, type Rgb } from "../data/cardColors.ts";
import voidInterceptorUrl from "../../assets/models/void_interceptor_low_poly.glb";
import { easeInCubic, easeOutBack, easeOutCubic, tween } from "./tween.ts";

const MODEL_URLS: Record<string, string> = {
  void_interceptor: voidInterceptorUrl,
};
/** Schiffe sind für den Hangar modelliert und auf dem Brett zu groß. */
const BOARD_SCALE = 0.6;
const MODEL_SCALE = 0.55;
/** Höhe, aus der ein Schiff beim Deploy auf den Pad sinkt. */
const WARP_IN_HEIGHT = 1.6;
/** Geist-Schiffe zeigen einen geplanten, noch nicht ausgeführten Zug. */
const GHOST_VISIBILITY = 0.3;

/** Zylinder stehen aufrecht; um die x-Achse gekippt liegen sie entlang der Längsachse (z). */
const ALONG_Z = new Vector3(Tools.ToRadians(90), 0, 0);
const ALONG_X = new Vector3(0, 0, Tools.ToRadians(90));
/** Leichte Schräge der Tragflächen. */
const WING_CANT = new Vector3(0, 0, Tools.ToRadians(12));
const FIN_CANT_Z = new Vector3(0, 0, Tools.ToRadians(18));
const FIN_CANT_X = new Vector3(Tools.ToRadians(18), 0, 0);

const BAR_WIDTH = 2.56;
const HP_COLOR_EMPTY = new Color3(0.93, 0.22, 0.18);
const HP_COLOR_HALF = new Color3(0.95, 0.74, 0.2);
const HP_COLOR_FULL = new Color3(0.3, 0.86, 0.38);

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
  /** Eigene Materialien (Balken, Kitbash); glTF-Materialien gehören dem geteilten Container. */
  private readonly ownedMaterials: StandardMaterial[] = [];
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
    this.statusBars.position.y = 1.15;
    this.statusBars.setEnabled(!isGhost);

    this.createBar("hp-track", 2.72, 0.3, new Color3(0.13, 0.15, 0.22), 0.92, this.statusBars, 1);
    this.hpFill = this.createBar("hp-fill", BAR_WIDTH, 0.19, HP_COLOR_FULL, 0.999, this.statusBars, 2);

    this.shieldRow = new TransformNode("shield-row", scene);
    this.shieldRow.parent = this.statusBars;
    this.shieldRow.position.y = -0.29;
    this.createBar("shield-track", 2.72, 0.21, new Color3(0.13, 0.15, 0.22), 0.92, this.shieldRow, 1);
    this.shieldFill = this.createBar("shield-fill", BAR_WIDTH, 0.12, new Color3(0.36, 0.72, 1), 0.999, this.shieldRow, 2);

    const modelUrl = MODEL_URLS[card.id];
    if (modelUrl) {
      void this.addImportedModel(modelUrl);
    } else {
      this.buildKitbash();
    }
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

  /** Deploy: wächst aus dem Nichts und sinkt auf den Pad. */
  async warpIn(): Promise<void> {
    await tween(this.scene, 560, (progress) => {
      this.root.scaling.setAll(BOARD_SCALE * Math.max(easeOutBack(progress), 0));
      this.root.position.y = (1 - easeOutCubic(progress)) * WARP_IN_HEIGHT;
    });
  }

  /** Treffer: das Modell zittert kurz, die Balken bleiben ruhig. */
  async shake(): Promise<void> {
    await tween(this.scene, 320, (progress) => {
      const amplitude = 0.18 * (1 - progress);
      this.modelRoot.position.set(Math.sin(progress * 55) * amplitude, 0, Math.cos(progress * 41) * amplitude);
    });
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
    for (const material of this.ownedMaterials) material.dispose();
  }

  private async addImportedModel(url: string): Promise<void> {
    const container = await loadModel(url, this.scene);
    if (this.disposed) return;
    const entries = container.instantiateModelsToScene((name) => `${this.card.id}-${name}`, false);
    for (const node of entries.rootNodes) {
      node.parent = this.modelRoot;
      if (node instanceof TransformNode) {
        node.scaling.scaleInPlace(MODEL_SCALE);
      }
      for (const mesh of node.getChildMeshes()) this.applyGhost(mesh);
      if (node instanceof AbstractMesh) this.applyGhost(node);
    }
  }

  private applyGhost(mesh: AbstractMesh): void {
    mesh.isPickable = false;
    if (this.isGhost) mesh.visibility = GHOST_VISIBILITY;
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

  // --- Kitbash-Fallback ---

  private buildKitbash(): void {
    const color = cardColor(this.card);
    const hull = this.makeMaterial("hull", color);
    const accent = this.makeMaterial("accent", lightened(color, 0.35));
    switch (this.card.shipClass) {
      case "fighter":
        this.buildFighter(hull, accent);
        break;
      case "cruiser":
        this.buildCruiser(hull, accent);
        break;
      case "support":
        this.buildSupport(hull, accent);
        break;
      case "battleship":
        this.buildBattleship(hull, accent);
        break;
    }
  }

  private makeMaterial(name: string, color: Rgb): StandardMaterial {
    const material = new StandardMaterial(`${this.card.id}-${name}`, this.scene);
    material.diffuseColor = new Color3(...color);
    material.specularColor = new Color3(0.25, 0.25, 0.25);
    this.ownedMaterials.push(material);
    return material;
  }

  private addBox(size: Vector3, position: Vector3, rotation: Vector3, material: StandardMaterial): void {
    const mesh = CreateBox("part", { width: size.x, height: size.y, depth: size.z }, this.scene);
    this.addPart(mesh, position, rotation, material);
  }

  private addCylinder(topRadius: number, bottomRadius: number, height: number, position: Vector3, rotation: Vector3, material: StandardMaterial): void {
    const mesh = CreateCylinder("part", { diameterTop: topRadius * 2, diameterBottom: bottomRadius * 2, height }, this.scene);
    this.addPart(mesh, position, rotation, material);
  }

  private addSphere(radius: number, position: Vector3, material: StandardMaterial): void {
    const mesh = CreateSphere("part", { diameter: radius * 2 }, this.scene);
    this.addPart(mesh, position, Vector3.Zero(), material);
  }

  private addPart(mesh: Mesh, position: Vector3, rotation: Vector3, material: StandardMaterial): void {
    mesh.position.copyFrom(position);
    mesh.rotation.copyFrom(rotation);
    mesh.material = material;
    mesh.parent = this.modelRoot;
    this.applyGhost(mesh);
  }

  private buildFighter(hull: StandardMaterial, accent: StandardMaterial): void {
    this.addBox(new Vector3(0.38, 0.18, 2.2), new Vector3(0, 0, 0.1), Vector3.Zero(), hull);
    this.addBox(new Vector3(1.45, 0.06, 0.92), new Vector3(0, -0.06, -0.1), WING_CANT, hull);
    this.addBox(new Vector3(0.22, 0.16, 0.78), new Vector3(-0.48, 0, -0.82), Vector3.Zero(), accent);
    this.addBox(new Vector3(0.22, 0.16, 0.78), new Vector3(0.48, 0, -0.82), Vector3.Zero(), accent);
    this.addCylinder(0.16, 0.08, 0.44, new Vector3(0, 0, 1.18), ALONG_Z, accent);
  }

  private buildCruiser(hull: StandardMaterial, accent: StandardMaterial): void {
    this.addBox(new Vector3(0.82, 0.28, 2.9), Vector3.Zero(), Vector3.Zero(), hull);
    this.addBox(new Vector3(1.85, 0.12, 1.08), new Vector3(0, -0.08, -0.18), Vector3.Zero(), hull);
    this.addBox(new Vector3(0.5, 0.22, 0.7), new Vector3(0, 0.26, -0.18), Vector3.Zero(), accent);
    this.addBox(new Vector3(0.22, 0.16, 1.5), new Vector3(-0.78, 0, -0.3), Vector3.Zero(), accent);
    this.addBox(new Vector3(0.22, 0.16, 1.5), new Vector3(0.78, 0, -0.3), Vector3.Zero(), accent);
    this.addCylinder(0.18, 0.18, 0.58, new Vector3(0, 0, 1.56), ALONG_Z, accent);
  }

  private buildBattleship(hull: StandardMaterial, accent: StandardMaterial): void {
    this.addBox(new Vector3(1.02, 0.34, 3.5), new Vector3(0, 0, -0.1), Vector3.Zero(), hull);
    this.addBox(new Vector3(2.18, 0.18, 1.44), new Vector3(0, -0.1, -0.36), Vector3.Zero(), hull);
    this.addBox(new Vector3(0.62, 0.28, 1.0), new Vector3(0, 0.28, -0.22), Vector3.Zero(), accent);
    this.addBox(new Vector3(0.22, 0.3, 0.82), new Vector3(-0.88, 0.14, 0.28), Vector3.Zero(), accent);
    this.addBox(new Vector3(0.22, 0.3, 0.82), new Vector3(0.88, 0.14, 0.28), Vector3.Zero(), accent);
    this.addBox(new Vector3(0.18, 0.18, 0.84), new Vector3(-0.28, 0.34, 0.58), Vector3.Zero(), accent);
    this.addBox(new Vector3(0.18, 0.18, 0.84), new Vector3(0.28, 0.34, 0.58), Vector3.Zero(), accent);
    this.addCylinder(0.24, 0.22, 0.7, new Vector3(0, 0, 1.86), ALONG_Z, accent);
  }

  private buildSupport(hull: StandardMaterial, accent: StandardMaterial): void {
    this.addSphere(0.42, Vector3.Zero(), hull);
    this.addBox(new Vector3(1.8, 0.08, 0.3), Vector3.Zero(), FIN_CANT_Z, accent);
    this.addBox(new Vector3(0.3, 0.08, 1.8), Vector3.Zero(), FIN_CANT_X, accent);
    this.addBox(new Vector3(0.24, 0.18, 1.26), new Vector3(-0.62, 0, 0), Vector3.Zero(), hull);
    this.addBox(new Vector3(0.24, 0.18, 1.26), new Vector3(0.62, 0, 0), Vector3.Zero(), hull);
    this.addCylinder(0.12, 0.12, 1.5, Vector3.Zero(), ALONG_X, accent);
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
