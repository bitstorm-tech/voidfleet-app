// Ein Schiff auf dem Brett. Die Nase zeigt nach lokal +Z, die Ausrichtung
// bestimmt allein der Elternknoten (der Anker des SlotPads).
// Die Modelle kommen als glTF aus `tools/ships/` (Blender); jede Datei wird
// einmal geladen und pro Schiff instanziiert. Zu jedem Modell gehört ein Wrack
// aus Bruchstücken, das bei der Zerstörung an seine Stelle tritt (`destruction.ts`).

import type { AssetContainer } from "@babylonjs/core/assetContainer";
import { LoadAssetContainerAsync } from "@babylonjs/core/Loading/sceneLoader";
import { Material } from "@babylonjs/core/Materials/material";
import { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Ray } from "@babylonjs/core/Culling/ray";
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
import { shipModel, wreckModel } from "../data/shipModels.ts";
import { randomInCone } from "./effects.ts";
import { Maneuver } from "./maneuver.ts";
import { easeInOutSine, easeOutCubic, tween } from "./tween.ts";

/** Schiffe sind für den Hangar modelliert und auf dem Brett zu groß. */
const BOARD_SCALE = 0.6;
const MODEL_SCALE = 0.5;
/** Die Balken schweben mindestens so hoch, bei hohen Aufbauten knapp über dem Modell. */
const BAR_MIN_HEIGHT = 1.15;
const BAR_MARGIN = 0.3;
/** Deploy: Das Schiff fliegt von hinten waagerecht ein und bremst vor dem Pad ab. */
const ARRIVAL_DURATION = 1300;
/** Überflug: so hoch über einem Schiff im Weg, Sinkflug ab knapp hinter dessen Mitte, Nase dabei leicht gesenkt. */
const OVERFLIGHT_HEIGHT = 1.7;
const DESCENT_START = 0.9;
const DESCENT_PITCH = Tools.ToRadians(12);
/** Treffer: Die Hülle leuchtet kurz auf und klingt wieder ab. */
const HIT_FLASH_COLOR = new Color3(1, 0.93, 0.8);
const HIT_FLASH_ALPHA = 0.75;
const HIT_FLASH_DURATION = 220;
/** Todeskampf: Zittern (Welteinheiten im Schiffsraum), Absacken und Krängen, jeweils bei voller Stärke. */
const DISTRESS_JITTER = 0.07;
const DISTRESS_SINK = 0.3;
const DISTRESS_PITCH = Tools.ToRadians(7);
const DISTRESS_ROLL = Tools.ToRadians(22);
/** Hüllenpunkte: Strahlen aus diesem Kegel um „oben“ (die Kamera schaut von schräg oben), Abstand zur Hülle in Welteinheiten. */
const SURFACE_CONE = Tools.ToRadians(75);
const SURFACE_CLEARANCE = 0.05;
/** Das Blitzlicht der Explosionen ist das fünfte Licht der Szene; Babylon rechnet sonst nur mit vier. */
const MAX_LIGHTS = 6;
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
    promise = LoadAssetContainerAsync(url, scene).then((container) => {
      for (const material of container.materials) if (material instanceof PBRMaterial) material.maxSimultaneousLights = MAX_LIGHTS;
      return container;
    });
    containerCache.set(url, promise);
  }
  return promise;
}

/**
 * Die Bruchstücke eines zerstörten Schiffs, an der Stelle des Modells: je Stück ein Knoten mit dem
 * Ursprung im Schwerpunkt. Der glTF-Loader macht aus einem Stück mit mehreren Materialien einen
 * TransformNode mit einem Mesh je Material, aus einem mit einem Material direkt ein Mesh.
 */
export interface Wreck {
  pieces: TransformNode[];
  /** Eigene Kopien der Materialien, damit Glühen und Ausblenden nur dieses Wrack betreffen. */
  materials: PBRMaterial[];
}

export class ShipView {
  readonly root: TransformNode;
  private readonly modelRoot: TransformNode;
  private readonly statusBars: TransformNode;
  private readonly hpFill: Mesh;
  private readonly shieldRow: TransformNode;
  private readonly shieldFill: Mesh;
  /** Eigene Materialien (Balken, Geist-Kopien, Wrack); glTF-Materialien gehören dem geteilten Container. */
  private readonly ownedMaterials: Material[] = [];
  /** Geist-Kopie je glTF-Material, damit Meshes mit gleichem Material auch die Kopie teilen. */
  private readonly ghostMaterials = new Map<Material, Material>();
  /** Zu welcher Seite das Schiff im Todeskampf krängt. */
  private readonly listSide = Math.random() < 0.5 ? 1 : -1;
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
    // Das Wrack wird schon jetzt geholt, damit es bei der Zerstörung ohne Wartezeit bereitliegt.
    if (!isGhost) void this.loadWreck();
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

  /** Mittelpunkt des Modells in Weltkoordinaten. */
  get center(): Vector3 {
    const { min, max } = this.modelRoot.getHierarchyBoundingVectors();
    return min.add(max).scale(0.5);
  }

  /** Halbe größte Ausdehnung des Modells in Welteinheiten. */
  get radius(): number {
    const { min, max } = this.modelRoot.getHierarchyBoundingVectors();
    return max.subtract(min).length() / 2;
  }

  /**
   * Deploy: fliegt aus `distance` hinter dem Pad ein und bremst ab; die Balken erscheinen erst danach.
   * Steht `obstacle` weiter hinten ein Schiff im Weg, kommt es in Überflughöhe und sinkt erst danach.
   */
  async arrive(distance: number, obstacle: number | null): Promise<void> {
    this.statusBars.setEnabled(false);
    const descentStart = obstacle === null ? 0 : -obstacle + DESCENT_START;
    await tween(this.scene, ARRIVAL_DURATION, (progress) => {
      const z = -distance * (1 - easeOutCubic(progress));
      this.root.position.z = z;
      if (obstacle === null) return;
      // 1 bis zum Beginn des Sinkflugs, 0 auf dem Pad.
      const altitude = Math.min(z / descentStart, 1);
      this.root.position.y = OVERFLIGHT_HEIGHT * easeInOutSine(altitude);
      this.modelRoot.rotation.x = DESCENT_PITCH * Math.sin(Math.PI * altitude);
    }, "movement");
    this.statusBars.setEnabled(true);
  }

  /**
   * Lane-Wechsel: Das Schiff hängt schon am neuen Anker und steht noch an seiner alten Stelle;
   * es fliegt von dort auf der Bahn aus `maneuver.ts` in den Slot, mit Kurs, Steigung und Schräglage.
   */
  async maneuver(): Promise<void> {
    const flight = new Maneuver(this.root.position, this.card.shipClass);
    await tween(this.scene, flight.duration, (progress) => {
      const pose = flight.pose(progress);
      this.root.position.set(pose.x, pose.y, pose.z);
      this.root.rotation.y = pose.yaw;
      this.modelRoot.rotation.set(pose.pitch, 0, pose.roll);
    }, "movement");
    this.root.position.setAll(0);
    this.root.rotation.setAll(0);
    this.modelRoot.rotation.setAll(0);
  }

  /** Treffer: die Hülle blitzt hell auf; der Einschlag selbst kommt aus `BoardEffects.hit`. */
  async flash(strength = HIT_FLASH_ALPHA): Promise<void> {
    const meshes = this.modelRoot.getChildMeshes().filter((mesh) => mesh instanceof Mesh);
    for (const mesh of meshes) {
      mesh.renderOverlay = true;
      mesh.overlayColor = HIT_FLASH_COLOR;
    }
    await tween(this.scene, HIT_FLASH_DURATION, (progress) => {
      for (const mesh of meshes) mesh.overlayAlpha = strength * (1 - progress) ** 2;
    });
    for (const mesh of meshes) mesh.renderOverlay = false;
  }

  // --- Zerstörung ---

  hideStatus(): void {
    this.statusBars.setEnabled(false);
  }

  /**
   * Zufällige Punkte außen auf der Hülle (Welt), an denen sie aufbricht: Strahlen von oben und
   * von den Seiten auf den Mittelpunkt zu, genommen wird der erste Treffer. Die Modelle bestehen
   * aus überlappenden Teilen, Eckpunkte lägen oft im Inneren.
   */
  surfacePoints(count: number): Vector3[] {
    const hull = new Set(this.modelRoot.getChildMeshes());
    const center = this.center;
    const reach = this.radius + 1;
    const points: Vector3[] = [];
    for (let attempt = 0; attempt < count * 8 && points.length < count; attempt++) {
      const direction = randomInCone(Vector3.Up(), SURFACE_CONE);
      const ray = new Ray(center.add(direction.scale(reach)), direction.negate(), reach);
      const hit = this.scene.pickWithRay(ray, (mesh) => hull.has(mesh));
      if (hit?.pickedPoint) points.push(hit.pickedPoint.add(direction.scale(SURFACE_CLEARANCE)));
    }
    return points;
  }

  /** Todeskampf: das Schiff zittert immer stärker, sackt ab und krängt zur Seite (`amount` 0..1). */
  distress(amount: number): void {
    const jitter = DISTRESS_JITTER * (0.2 + 0.8 * amount ** 2);
    this.modelRoot.position.set(
      (Math.random() - 0.5) * jitter,
      -DISTRESS_SINK * amount ** 2 + (Math.random() - 0.5) * jitter,
      (Math.random() - 0.5) * jitter,
    );
    this.modelRoot.rotation.set(DISTRESS_PITCH * amount ** 2, 0, this.listSide * DISTRESS_ROLL * amount ** 3);
  }

  loadWreck(): Promise<AssetContainer> {
    return loadModel(wreckModel(this.card), this.scene);
  }

  /** Tauscht das Modell gegen die Bruchstücke, die exakt an seiner Stelle liegen (auch in der Krängung). */
  async breakApart(): Promise<Wreck> {
    const container = await this.loadWreck();
    for (const node of this.modelRoot.getChildren()) node.dispose();
    const entries = container.instantiateModelsToScene((name) => `${this.card.id}-wreck-${name}`, true);
    const root = entries.rootNodes[0] as TransformNode;
    root.parent = this.modelRoot;
    root.scaling.scaleInPlace(MODEL_SCALE);
    const materials = new Set<PBRMaterial>();
    for (const mesh of root.getChildMeshes()) {
      mesh.isPickable = false;
      if (mesh.material instanceof PBRMaterial) materials.add(mesh.material);
    }
    this.ownedMaterials.push(...materials);
    return { pieces: root.getChildren().filter((node) => node instanceof TransformNode), materials: [...materials] };
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
