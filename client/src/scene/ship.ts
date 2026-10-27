// Ein Schiff auf dem Brett. Die Nase zeigt nach lokal +Z, die Ausrichtung
// bestimmt allein der Elternknoten (der Anker des SlotPads). Beim Planen zeigt es die
// Zielvorschau: auf den Balken den drohenden Verlust, neben ihnen einen Totenkopf, wenn es fällt.
// Flaggschiffe sind etwas größer, tragen einen Ring in der Farbe ihres Admirals am Boden und eine Krone
// rechts neben dem Hüllenbalken; am Boden liegen auch die Marken von Fähigkeiten und Zielerfassung
// (`markers.ts`). Das Trugbild flackert als Hologramm, baut sich auf und löst sich wieder auf. Beim Rammkurs fliegt
// das Schiff auf sein Ziel zu (`charge`) und, wenn es den Aufprall übersteht, zurück (`withdraw`).
// Die Modelle kommen als glTF aus `tools/ships/` (Blender); alle Dateien werden
// beim Start geladen (`loadShipModels`) und pro Schiff instanziiert. Zu jedem Modell gehört ein Wrack
// aus Bruchstücken, das bei der Zerstörung an seine Stelle tritt (`destruction.ts`).

import type { AssetContainer } from "@babylonjs/core/assetContainer";
import { LoadAssetContainerAsync } from "@babylonjs/core/Loading/sceneLoader";
import { DynamicTexture } from "@babylonjs/core/Materials/Textures/dynamicTexture";
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
import type { Observer } from "@babylonjs/core/Misc/observable";
import type { Scene } from "@babylonjs/core/scene";
// Registriert `renderOverlay` auf Mesh: zeichnet das Modell in einer Farbe darüber (Treffer-Blitz).
import "@babylonjs/core/Rendering/outlineRenderer";
import { isFlagship, type ShipCard, type ShipClass } from "../../../shared/cards.ts";
import type { ShipStats } from "../../../shared/protocol.ts";
import { loopSound } from "../audio/sounds.ts";
import { flagshipAdmiral } from "../data/admirals.ts";
import { color3, PALETTE, toCss } from "../data/palette.ts";
import { allShipModels, shipModel, wreckModel } from "../data/shipModels.ts";
import type { SoundId } from "../data/sounds.ts";
import { randomInCone } from "./effects.ts";
import { occludeGlow } from "./glow.ts";
import { Maneuver } from "./maneuver.ts";
import { FloorMarker, type Footprint, type MarkerKind, type MarkerSpec } from "./markers.ts";
import { SHIP_ANCHOR_HEIGHT } from "./slotPad.ts";
import { easeInCubic, easeInOutSine, easeOutCubic, tween } from "./tween.ts";

/** Schiffe sind für den Hangar modelliert und auf dem Brett zu groß. */
const BOARD_SCALE = 0.6;
const MODEL_SCALE = 0.5;
/**
 * Flaggschiffe heben sich durch ihre Größe ab: Ihre Modelle sind schon gut ein Fünftel größer gebaut, dazu dieser
 * Faktor. Die Bastion, das breiteste, bleibt so knapp 2 breit (Slots liegen 2,2 auseinander) und reicht mit einem
 * Schiff in der anderen Lane nicht über deren Abstand von 3,4.
 */
const FLAGSHIP_SCALE = 1.1;
/** Die Balken schweben mindestens so hoch, bei hohen Aufbauten knapp über dem Modell. */
const BAR_MIN_HEIGHT = 1.15;
const BAR_MARGIN = 0.3;
/** Deploy: Das Schiff fliegt von hinten waagerecht ein und bremst vor dem Pad ab. */
const ARRIVAL_DURATION = 1300;
/** Überflug: so hoch über einem Schiff im Weg, Sinkflug ab knapp hinter dessen Mitte, Nase dabei leicht gesenkt. */
const OVERFLIGHT_HEIGHT = 1.7;
const DESCENT_START = 0.9;
const DESCENT_PITCH = Tools.ToRadians(12);
/** Triebwerk je Schiffsklasse während eines Flugs; nach der Landung verklingt es in so vielen Sekunden. */
const ENGINE_SOUNDS: Record<ShipClass, SoundId> = {
  fighter: "engine_light",
  support: "engine_medium",
  cruiser: "engine_medium",
  battleship: "engine_heavy",
};
const ENGINE_FADE = 0.5;
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

const TRACK_WIDTH = 2.72;
const BAR_WIDTH = 2.56;
const HP_COLOR_EMPTY = color3("hpEmpty");
const HP_COLOR_HALF = color3("hpHalf");
const HP_COLOR_FULL = color3("hpFull");
const BAR_TRACK_COLOR = new Color3(0.13, 0.15, 0.22);
/** Ein Schiff, das diese Runde manövriert und deshalb nicht feuert, zeigt seine Balken gedämpft. */
const HOLD_FIRE_ALPHA = 0.3;
/** Zielvorschau: Der drohende Verlust blinkt in der Schadensfarbe, der Totenkopf pulsiert mit (Takt in Hz, schwächste Deckkraft). */
const LOSS_COLOR = color3("damage");
const PREVIEW_PULSE = 1.4;
const PREVIEW_MIN_VISIBILITY = 0.25;
/** Kantenlänge des Totenkopfs; er steht links neben dem Hüllenbalken. */
const SKULL_SIZE = 0.62;
/** Die Krone eines Flaggschiffs steht rechts neben dem Hüllenbalken. */
const CROWN_SIZE = 0.62;
/** Hologramm des Trugbilds: Deckkraft schwankt um diesen Wert, ab und zu setzt das Bild kurz aus und springt seitlich. */
const HOLOGRAM_ALPHA = 0.82;
const HOLOGRAM_FLICKER = 0.18;
const HOLOGRAM_GLITCH = 0.025;
const HOLOGRAM_JITTER = 0.09;
/** Aufbau und Auflösen des Trugbilds (ms). */
const MATERIALIZE_DURATION = 750;
const DEMATERIALIZE_DURATION = 650;
/** Phasentausch: so lange schrumpft das Schiff zu einem Lichtpunkt und wächst am neuen Ort wieder (ms). */
const PHASE_DURATION = 320;
/** Rammkurs: Anflug mit Beschleunigung und leichtem Bogen, Rückflug in den Slot (ms, Welteinheiten). */
const RAM_DURATION = 620;
const RAM_ARC = 0.5;
const RAM_PITCH = Tools.ToRadians(8);
const RAM_RETURN_DURATION = 900;

const containers = new Map<string, AssetContainer>();

/** Lädt Modell und Wrack aller Schiffe; erst danach lassen sich `ShipView`s erzeugen. */
export function loadShipModels(scene: Scene): Promise<void>[] {
  return allShipModels().map(async (url) => {
    const container = await LoadAssetContainerAsync(url, scene);
    for (const material of container.materials) if (material instanceof PBRMaterial) material.maxSimultaneousLights = MAX_LIGHTS;
    containers.set(url, container);
  });
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
  /**
   * Halter über dem Modell für Balken, Totenkopf und Krone, als Billboard zur Kamera gedreht: Babylon versetzt Billboards
   * entlang der Weltachsen, ihre Kinder dagegen in seinem Raum. So stehen die Teile in jeder Ansicht nebeneinander im Bild.
   */
  private readonly overlay: TransformNode;
  private readonly statusBars: TransformNode;
  private readonly hpFill: Mesh;
  private readonly shieldRow: TransformNode;
  private readonly shieldFill: Mesh;
  /** Zielvorschau: drohender Verlust rechts neben der Füllung, blinkend. */
  private readonly hpLoss: Mesh;
  private readonly shieldLoss: Mesh;
  /** Totenkopf der Zielvorschau; auf Höhe der Balken, aber auch an Geistern, die keine Balken haben. */
  private readonly skull: Mesh;
  /** Boden unter dem Schiff in Welteinheiten: Ring des Flaggschiffs, Marken von Fähigkeiten und Zielerfassung. */
  private readonly floor: TransformNode;
  private readonly markers = new Map<MarkerKind, FloorMarker>();
  /** Grundfläche des Modells; die Marken am Boden umschließen sie. */
  private footprint: Footprint = { width: 0, length: 0 };
  private readonly pulse: Observer<Scene>;
  /** Flackern des Trugbilds; null bei allen anderen Schiffen. */
  private readonly hologram: Observer<Scene> | null;
  /** Deckkraft des Trugbilds beim Auf- und Abbau, unter dem Flackern. */
  private hologramFade = 1;
  private current: ShipStats;
  /** HP und Schild nach der Runde laut Zielvorschau, null: das Schiff fällt; ohne Vorschau undefined. */
  private preview: ShipStats | null | undefined;
  /** Material und volle Deckkraft je Balken, zum Dämpfen (`setHoldingFire`). */
  private readonly bars: { material: StandardMaterial; alpha: number }[] = [];
  /** Eigene Materialien (Balken, Geist-Kopien, Wrack); glTF-Materialien gehören dem geteilten Container. */
  private readonly ownedMaterials: Material[] = [];
  /** Geist-Kopie je glTF-Material, damit Meshes mit gleichem Material auch die Kopie teilen. */
  private readonly ghostMaterials = new Map<Material, Material>();
  /** Zu welcher Seite das Schiff im Todeskampf krängt. */
  private readonly listSide = Math.random() < 0.5 ? 1 : -1;

  constructor(
    private readonly scene: Scene,
    readonly card: ShipCard,
    readonly isGhost: boolean,
  ) {
    this.root = new TransformNode(`ship-${card.id}`, scene);
    this.root.scaling.setAll(BOARD_SCALE);

    this.modelRoot = new TransformNode("model", scene);
    this.modelRoot.parent = this.root;
    if (isFlagship(card)) this.modelRoot.scaling.setAll(FLAGSHIP_SCALE);

    this.floor = new TransformNode("floor", scene);
    this.floor.parent = this.root;
    this.floor.position.y = -SHIP_ANCHOR_HEIGHT / BOARD_SCALE;
    this.floor.scaling.setAll(1 / BOARD_SCALE);

    this.overlay = new TransformNode("overlay", scene);
    this.overlay.parent = this.root;
    this.overlay.billboardMode = TransformNode.BILLBOARDMODE_ALL;
    this.overlay.position.y = BAR_MIN_HEIGHT;

    this.statusBars = new TransformNode("status", scene);
    this.statusBars.parent = this.overlay;
    this.statusBars.setEnabled(!isGhost);

    this.createBar("hp-track", TRACK_WIDTH, 0.3, BAR_TRACK_COLOR, 0.92, this.statusBars, 1);
    this.hpFill = this.createBar("hp-fill", BAR_WIDTH, 0.19, HP_COLOR_FULL, 0.999, this.statusBars, 2);
    this.hpLoss = this.createBar("hp-loss", BAR_WIDTH, 0.19, LOSS_COLOR, 0.999, this.statusBars, 2);

    this.shieldRow = new TransformNode("shield-row", scene);
    this.shieldRow.parent = this.statusBars;
    this.shieldRow.position.y = -0.29;
    this.createBar("shield-track", TRACK_WIDTH, 0.21, BAR_TRACK_COLOR, 0.92, this.shieldRow, 1);
    this.shieldFill = this.createBar("shield-fill", BAR_WIDTH, 0.12, color3("shield"), 0.999, this.shieldRow, 2);
    this.shieldLoss = this.createBar("shield-loss", BAR_WIDTH, 0.12, LOSS_COLOR, 0.999, this.shieldRow, 2);

    this.skull = CreatePlane("skull", { size: SKULL_SIZE }, scene);
    this.skull.material = skullMaterial(scene);
    this.skull.isPickable = false;
    this.skull.renderingGroupId = 1;
    this.skull.alphaIndex = 3;
    this.skull.parent = this.overlay;
    this.skull.position.set(-(TRACK_WIDTH + SKULL_SIZE) / 2 - 0.08, -0.05, 0);
    this.skull.setEnabled(false);
    // Verlust und Totenkopf blinken im selben Takt, über alle Schiffe gleich.
    this.pulse = scene.onBeforeRenderObservable.add(() => {
      const strength = 0.5 + 0.5 * Math.sin((performance.now() / 1000) * PREVIEW_PULSE * 2 * Math.PI);
      const visibility = PREVIEW_MIN_VISIBILITY + (1 - PREVIEW_MIN_VISIBILITY) * strength;
      this.hpLoss.visibility = this.shieldLoss.visibility = visibility;
      this.skull.visibility = 0.55 + 0.45 * strength;
    });

    this.addModel();
    const admiral = flagshipAdmiral(card.id);
    if (admiral) {
      this.markers.set("halo", new FloorMarker(scene, this.floor, this.footprint, { kind: "halo", color: color3(admiral) }));
      if (!isGhost) this.createCrown();
    }
    this.hologram = card.id === "decoy" ? scene.onBeforeRenderObservable.add(() => this.flicker()) : null;
    this.current = { hp: card.hp, shield: card.shield };
    this.updateBars();
  }

  /** Live-Werte über dem Schiff; die Maxima kommen aus der Karte. */
  setStats(hp: number, shield: number): void {
    this.current = { hp, shield };
    this.updateBars();
  }

  /**
   * Zielvorschau: HP und Schild nach der Runde, `null`, wenn das Schiff fällt, `undefined` ohne Vorschau.
   * Die Füllung zeigt dann, was bleibt, der blinkende Rest dahinter, was verloren geht.
   */
  setPreview(after: ShipStats | null | undefined): void {
    this.preview = after;
    this.updateBars();
  }

  /** Totenkopf links neben dem Hüllenbalken: Laut Zielvorschau fällt das Schiff in dieser Runde. */
  setDoomed(value: boolean): void {
    this.skull.setEnabled(value);
  }

  /**
   * Die Marken am Boden (Fähigkeiten, Zielerfassung), genau diese; der Ring eines Flaggschiffs bleibt. Eine Marke,
   * die schon liegt, bleibt liegen, damit ihre Drehung beim Neuzeichnen nicht springt.
   */
  setMarkers(specs: readonly MarkerSpec[]): void {
    for (const [kind, marker] of this.markers) {
      const spec = specs.find((candidate) => candidate.kind === kind);
      if (kind === "halo" || (spec && sameSpec(spec, marker.spec))) continue;
      marker.dispose();
      this.markers.delete(kind);
    }
    for (const spec of specs) {
      if (!this.markers.has(spec.kind)) this.markers.set(spec.kind, new FloorMarker(this.scene, this.floor, this.footprint, spec));
    }
  }

  /** Legt eine Marke dazu und lässt sie auf das Schiff herabfallen (Rundenwiedergabe). */
  async addMarker(spec: MarkerSpec): Promise<void> {
    this.markers.get(spec.kind)?.dispose();
    const marker = new FloorMarker(this.scene, this.floor, this.footprint, spec);
    this.markers.set(spec.kind, marker);
    await marker.appear();
  }

  removeMarker(kind: MarkerKind): void {
    this.markers.get(kind)?.dispose();
    this.markers.delete(kind);
  }

  /** Dämpft die Statusbalken, solange das Schiff wegen seines Manövers nicht feuert. */
  setHoldingFire(value: boolean): void {
    for (const { material, alpha } of this.bars) material.alpha = alpha * (value ? HOLD_FIRE_ALPHA : 1);
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
    this.floor.setEnabled(false);
    const descentStart = obstacle === null ? 0 : -obstacle + DESCENT_START;
    await this.fly(ARRIVAL_DURATION, (progress) => {
      const z = -distance * (1 - easeOutCubic(progress));
      this.root.position.z = z;
      if (obstacle === null) return;
      // 1 bis zum Beginn des Sinkflugs, 0 auf dem Pad.
      const altitude = Math.min(z / descentStart, 1);
      this.root.position.y = OVERFLIGHT_HEIGHT * easeInOutSine(altitude);
      this.modelRoot.rotation.x = DESCENT_PITCH * Math.sin(Math.PI * altitude);
    });
    this.statusBars.setEnabled(true);
    this.floor.setEnabled(true);
  }

  /**
   * Slot-Wechsel: Das Schiff hängt schon am neuen Anker und steht noch an seiner alten Stelle;
   * es fliegt von dort auf der Bahn aus `maneuver.ts` in den Slot, mit Kurs, Steigung und Schräglage.
   * Vom Traktorstrahl gezogen (`towed`) gleitet es ruhiger und ohne eigenes Triebwerk.
   */
  async maneuver(towed = false): Promise<void> {
    const flight = new Maneuver(this.root.position, this.card.shipClass, towed);
    // Die Marken am Boden landen mit dem Schiff, statt mitzufliegen.
    this.floor.setEnabled(false);
    await this.fly(flight.duration, (progress) => {
      const pose = flight.pose(progress);
      this.root.position.set(pose.x, pose.y, pose.z);
      this.root.rotation.y = pose.yaw;
      this.modelRoot.rotation.set(pose.pitch, 0, pose.roll);
    }, !towed);
    this.root.position.setAll(0);
    this.root.rotation.setAll(0);
    this.modelRoot.rotation.setAll(0);
    this.floor.setEnabled(true);
  }

  /** Phasentausch, erste Hälfte: Das Schiff schrumpft zu einem Lichtpunkt. */
  async phaseOut(): Promise<void> {
    await tween(this.scene, PHASE_DURATION, (progress) => this.root.scaling.setAll(BOARD_SCALE * Math.max(1 - easeInCubic(progress), 0.01)));
  }

  /** Phasentausch, zweite Hälfte: Am neuen Anker wächst es wieder auf seine Größe. */
  async phaseIn(): Promise<void> {
    await tween(this.scene, PHASE_DURATION, (progress) => this.root.scaling.setAll(BOARD_SCALE * Math.max(easeOutCubic(progress), 0.01)));
  }

  /**
   * Rammkurs, Anflug: Das Schiff dreht die Nase auf `point` (Welt, auf Höhe des Ankers) und beschleunigt bis dorthin,
   * in einem flachen Bogen und mit gesenkter Nase. Es bleibt dort stehen, bis `withdraw` es zurückholt oder es fällt.
   */
  async charge(point: Vector3): Promise<void> {
    const target = Vector3.TransformCoordinates(point, (this.root.parent as TransformNode).getWorldMatrix().clone().invert());
    const yaw = Math.atan2(target.x, target.z);
    this.floor.setEnabled(false);
    await this.fly(RAM_DURATION, (progress) => {
      const travelled = easeInCubic(progress);
      this.root.position.set(target.x * travelled, RAM_ARC * Math.sin(Math.PI * travelled), target.z * travelled);
      this.root.rotation.y = yaw * easeOutCubic(Math.min(progress * 2.5, 1));
      this.modelRoot.rotation.x = RAM_PITCH * Math.sin(Math.PI * travelled);
    });
  }

  /** Rammkurs, Rückkehr: Abgeprallt treibt das Schiff rückwärts in seinen Slot und richtet sich wieder aus. */
  async withdraw(): Promise<void> {
    const start = this.root.position.clone();
    const yaw = this.root.rotation.y;
    await this.fly(RAM_RETURN_DURATION, (progress) => {
      const back = easeInOutSine(progress);
      Vector3.LerpToRef(start, Vector3.ZeroReadOnly, back, this.root.position);
      this.root.rotation.y = yaw * (1 - back);
    });
    this.root.position.setAll(0);
    this.root.rotation.setAll(0);
    this.modelRoot.rotation.setAll(0);
    this.floor.setEnabled(true);
  }

  /** Das Trugbild baut sich auf: Es wächst von der Platte nach oben und flackert dabei ins Bild. */
  async materialize(): Promise<void> {
    this.statusBars.setEnabled(false);
    await tween(this.scene, MATERIALIZE_DURATION, (progress) => {
      this.modelRoot.scaling.set(1, Math.max(easeOutCubic(progress), 0.01), 1);
      this.hologramFade = progress < 1 ? progress * (Math.random() < 0.3 ? 0.3 : 1) : 1;
    });
    this.statusBars.setEnabled(true);
  }

  /** Das Trugbild löst sich auf: Es sinkt flackernd in sich zusammen. */
  async dematerialize(): Promise<void> {
    this.statusBars.setEnabled(false);
    await tween(this.scene, DEMATERIALIZE_DURATION, (progress) => {
      this.modelRoot.scaling.set(1 + 0.3 * progress, Math.max(1 - easeInCubic(progress), 0.01), 1 + 0.3 * progress);
      this.hologramFade = (1 - progress) * (Math.random() < 0.35 ? 0.2 : 1);
    });
  }

  /** Ein Flug im Takt der Bewegungen: Das Triebwerk folgt dem Schiff im Stereobild und verklingt nach der Landung. */
  private async fly(duration: number, update: (progress: number) => void, withEngine = true): Promise<void> {
    const engine = withEngine ? loopSound(ENGINE_SOUNDS[this.card.shipClass], { at: this.root.getAbsolutePosition() }) : null;
    await tween(this.scene, duration, (progress) => {
      update(progress);
      engine?.follow(this.root.getAbsolutePosition());
    }, "movement");
    engine?.stop(ENGINE_FADE);
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

  /** Balken, Totenkopf, Krone und Marken verschwinden, sobald der Todeskampf beginnt. */
  hideStatus(): void {
    this.statusBars.setEnabled(false);
    this.skull.setEnabled(false);
    this.floor.setEnabled(false);
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

  /** Tauscht das Modell gegen die Bruchstücke, die exakt an seiner Stelle liegen (auch in der Krängung). */
  breakApart(): Wreck {
    for (const node of this.modelRoot.getChildren()) node.dispose();
    const entries = containers.get(wreckModel(this.card))!.instantiateModelsToScene((name) => `${this.card.id}-wreck-${name}`, true);
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
    this.scene.onBeforeRenderObservable.remove(this.pulse);
    if (this.hologram) this.scene.onBeforeRenderObservable.remove(this.hologram);
    for (const marker of this.markers.values()) marker.dispose();
    this.root.dispose(false, false);
    // Geist-Kopien klonen beim `clone()` auch ihre Texturen; die gehören dann ebenfalls diesem Schiff.
    for (const material of this.ownedMaterials) material.dispose(false, true);
  }

  private addModel(): void {
    const entries = containers.get(shipModel(this.card))!.instantiateModelsToScene((name) => `${this.card.id}-${name}`, false);
    for (const node of entries.rootNodes) {
      node.parent = this.modelRoot;
      if (node instanceof TransformNode) node.scaling.scaleInPlace(MODEL_SCALE);
      for (const mesh of node.getChildMeshes()) this.prepareMesh(mesh);
      if (node instanceof AbstractMesh) this.prepareMesh(node);
    }
    // Höchsten Punkt des Modells in den Raum des Schiffs zurückrechnen, damit die Balken frei bleiben; die
    // Grundfläche in Welteinheiten bestimmt die Größe der Marken am Boden.
    this.root.computeWorldMatrix(true);
    const toShip = this.root.getWorldMatrix().clone().invert();
    const { min, max } = this.modelRoot.getHierarchyBoundingVectors();
    const size = Vector3.TransformCoordinates(max, toShip).subtract(Vector3.TransformCoordinates(min, toShip)).scale(BOARD_SCALE);
    this.footprint = { width: Math.abs(size.x), length: Math.abs(size.z) };
    const top = Vector3.TransformCoordinates(max, toShip).y;
    this.overlay.position.y = Math.max(BAR_MIN_HEIGHT, top + BAR_MARGIN);
  }

  private prepareMesh(mesh: AbstractMesh): void {
    mesh.isPickable = false;
    if (this.isGhost && mesh.material) mesh.material = this.ghostMaterial(mesh.material);
    // Der Rumpf verdeckt den Schein der Marken am Boden, das durchscheinende Trugbild nicht.
    if (!this.isGhost) occludeGlow(this.scene, mesh);
  }

  /** Hologramm: Die Deckkraft schwankt, ab und zu setzt das Bild aus und springt seitlich. */
  private flicker(): void {
    const glitch = Math.random() < HOLOGRAM_GLITCH;
    const alpha = (glitch ? 0.25 : HOLOGRAM_ALPHA + HOLOGRAM_FLICKER * (Math.random() - 0.5)) * this.hologramFade;
    for (const mesh of this.modelRoot.getChildMeshes()) mesh.visibility = alpha;
    this.modelRoot.position.x = glitch ? (Math.random() - 0.5) * HOLOGRAM_JITTER : 0;
  }

  /** Krone in der Zierfarbe der Flaggschiffe, rechts neben dem Hüllenbalken. */
  private createCrown(): void {
    const crown = CreatePlane("crown", { size: CROWN_SIZE }, this.scene);
    crown.material = crownMaterial(this.scene);
    crown.isPickable = false;
    crown.renderingGroupId = 1;
    crown.alphaIndex = 3;
    crown.parent = this.statusBars;
    crown.position.set((TRACK_WIDTH + CROWN_SIZE) / 2 + 0.08, -0.05, 0);
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
    this.bars.push({ material, alpha });
    const mesh = CreatePlane(name, { width, height }, this.scene);
    mesh.material = material;
    mesh.isPickable = false;
    mesh.renderingGroupId = 1;
    mesh.alphaIndex = order;
    mesh.parent = parent;
    return mesh;
  }

  /** Füllung bis zu dem, was nach der Vorschau bleibt (ohne Vorschau: alles), dahinter der Verlust bis zum jetzigen Stand. */
  private updateBars(): void {
    const after = this.preview === undefined ? this.current : (this.preview ?? { hp: 0, shield: 0 });
    const hp = Math.min(after.hp, this.current.hp);
    this.setSection(this.hpFill, 0, ratio(hp, this.card.hp));
    this.setSection(this.hpLoss, ratio(hp, this.card.hp), ratio(this.current.hp, this.card.hp));
    (this.hpFill.material as StandardMaterial).emissiveColor = hpColor(ratio(hp, this.card.hp));

    const shieldMax = Math.max(this.card.shield, this.current.shield);
    this.shieldRow.setEnabled(shieldMax > 0);
    if (shieldMax === 0) return;
    const shield = Math.min(after.shield, this.current.shield);
    this.setSection(this.shieldFill, 0, ratio(shield, shieldMax));
    this.setSection(this.shieldLoss, ratio(shield, shieldMax), ratio(this.current.shield, shieldMax));
  }

  /** Ein Abschnitt des Balkens zwischen zwei Anteilen, von links gemessen: schmaler skalieren und versetzen. */
  private setSection(bar: Mesh, from: number, to: number): void {
    bar.setEnabled(to > from);
    bar.scaling.x = to - from;
    bar.position.x = BAR_WIDTH * ((from + to) / 2 - 0.5);
  }
}

function sameSpec(a: MarkerSpec, b: MarkerSpec): boolean {
  return a.kind === b.kind && a.color.equals(b.color) && !a.planned === !b.planned;
}

const crownMaterials = new WeakMap<Scene, StandardMaterial>();

/** Ein Material für alle Kronen der Szene: goldene Krone mit dunklem Rand auf transparentem Grund. */
function crownMaterial(scene: Scene): StandardMaterial {
  let material = crownMaterials.get(scene);
  if (material) return material;
  const size = 128;
  const texture = new DynamicTexture("crown", { width: size, height: size }, scene);
  texture.hasAlpha = true;
  const context = texture.getContext();
  context.clearRect(0, 0, size, size);
  // Fünf Zacken mit Kugeln, darunter das Band.
  context.beginPath();
  context.moveTo(14, 96);
  context.lineTo(10, 38);
  context.lineTo(38, 62);
  context.lineTo(64, 24);
  context.lineTo(90, 62);
  context.lineTo(118, 38);
  context.lineTo(114, 96);
  context.closePath();
  context.fillStyle = toCss(PALETTE.flagshipTrim);
  context.strokeStyle = "rgb(40 28 8 / 0.9)";
  context.lineWidth = 6;
  context.stroke();
  context.fill();
  context.fillRect(14, 100, 100, 14);
  context.strokeRect(14, 100, 100, 14);
  for (const [x, y] of [[10, 36], [64, 22], [118, 36]] as const) {
    context.beginPath();
    context.arc(x, y, 8, 0, 2 * Math.PI);
    context.fill();
  }
  texture.update();

  material = new StandardMaterial("crown", scene);
  material.diffuseTexture = texture;
  material.useAlphaFromDiffuseTexture = true;
  material.emissiveColor = Color3.White();
  material.disableLighting = true;
  material.disableDepthWrite = true;
  crownMaterials.set(scene, material);
  return material;
}

const skullMaterials = new WeakMap<Scene, StandardMaterial>();

/** Ein Material für alle Totenköpfe der Szene: weißer Schädel auf einer Plakette in der Schadensfarbe. */
function skullMaterial(scene: Scene): StandardMaterial {
  let material = skullMaterials.get(scene);
  if (material) return material;
  const size = 128;
  const texture = new DynamicTexture("skull", { width: size, height: size }, scene);
  texture.hasAlpha = true;
  const context = texture.getContext();
  const badge = toCss(PALETTE.damage);
  context.fillStyle = badge;
  context.beginPath();
  context.arc(64, 64, 62, 0, 2 * Math.PI);
  context.fill();
  // Schädel und Kiefer weiß, Augen, Nase und Zahnlücken in der Farbe der Plakette ausgespart.
  context.fillStyle = "rgb(255 250 245)";
  context.beginPath();
  context.arc(64, 56, 35, 0, 2 * Math.PI);
  context.fill();
  context.fillRect(44, 70, 40, 34);
  context.fillStyle = badge;
  for (const x of [50, 78]) {
    context.beginPath();
    context.arc(x, 60, 11, 0, 2 * Math.PI);
    context.fill();
  }
  context.beginPath();
  context.moveTo(64, 70);
  context.lineTo(58, 82);
  context.lineTo(70, 82);
  context.fill();
  for (const x of [56, 64, 72]) context.fillRect(x - 1.5, 90, 3, 14);
  texture.update();

  material = new StandardMaterial("skull", scene);
  material.diffuseTexture = texture;
  material.useAlphaFromDiffuseTexture = true;
  material.emissiveColor = Color3.White();
  material.disableLighting = true;
  material.disableDepthWrite = true;
  skullMaterials.set(scene, material);
  return material;
}

function ratio(current: number, maximum: number): number {
  if (maximum <= 0) return 0;
  return Math.min(Math.max(current / maximum, 0), 1);
}

function hpColor(hpRatio: number): Color3 {
  if (hpRatio >= 0.5) return Color3.Lerp(HP_COLOR_HALF, HP_COLOR_FULL, (hpRatio - 0.5) * 2);
  return Color3.Lerp(HP_COLOR_EMPTY, HP_COLOR_HALF, hpRatio * 2);
}
