// Die 3D-Szene des Match-Bretts: Kamera-Rig mit Maus-Parallaxe,
// Mausrad-Zoom und Verschieben per Ziehen, Lichter, Glow, Hintergrund und die vier Lanes mit je sechs Landeplätzen.
//
// Koordinaten: Babylon ist linkshändig, die Godot-Szene rechtshändig. Alle
// Z-Werte aus der Godot-Szene sind hier negiert; x (Lanes) und y bleiben.

import { TargetCamera } from "@babylonjs/core/Cameras/targetCamera";
import { Engine } from "@babylonjs/core/Engines/engine";
import type { PointerInfo } from "@babylonjs/core/Events/pointerEvents";
import { GlowLayer } from "@babylonjs/core/Layers/glowLayer";
import { DirectionalLight } from "@babylonjs/core/Lights/directionalLight";
import { HemisphericLight } from "@babylonjs/core/Lights/hemisphericLight";
import { PointLight } from "@babylonjs/core/Lights/pointLight";
import { BaseTexture } from "@babylonjs/core/Materials/Textures/baseTexture";
import { Effect } from "@babylonjs/core/Materials/effect";
import { HDRCubeTexture } from "@babylonjs/core/Materials/Textures/hdrCubeTexture";
import { Color4 } from "@babylonjs/core/Maths/math.color";
import { Matrix, Vector2, Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { Tools } from "@babylonjs/core/Misc/tools";
import { Scene } from "@babylonjs/core/scene";
import "@babylonjs/core/Culling/ray";
import { registerBuiltInLoaders } from "@babylonjs/loaders/dynamic";
import environmentUrl from "../../assets/env/space.hdr";
import type { Board, Lane, LaneType, Side } from "../../../shared/board.ts";
import { color3 } from "../data/palette.ts";
import { t, upper } from "../i18n/index.ts";
import { Background } from "./background.ts";
import { BoardEffects } from "./effects.ts";
import { LaneLabel } from "./laneLabel.ts";
import { MoveArrow } from "./moveArrow.ts";
import type { ShipView } from "./ship.ts";
import { SlotPad, createPadMaterials } from "./slotPad.ts";
import { TargetReticle } from "./targetReticle.ts";
import { animationTimeScale } from "./tween.ts";

const CAMERA_RIG_POSITION = new Vector3(0, 14.7, -15.7);
const CAMERA_PITCH = Tools.ToRadians(42);
const CAMERA_FOV = Tools.ToRadians(33.5);
const BOARD_Z = 2.5;
const LANE_X: Record<Side, Record<Lane["type"], number>> = {
  player: { command: -6.15, strike: -2.75 },
  enemy: { strike: 2.75, command: 6.15 },
};
/** Neue Schiffe fliegen von hier aus ein, außerhalb des Bildes am Rand ihrer Seite (Welt-|x|). */
const ARRIVAL_X = 19;
/** Slot 0 liegt am hinteren Ende der Lane (weit von der Kamera); zwischen den Pads bleibt eine Fuge. */
const SLOT_Z = [5.5, 3.3, 1.1, -1.1, -3.3, -5.5];
/** Die HDR-Umgebung (tools/ships/env.py) liefert Reflexionen und indirektes Licht der PBR-Schiffe. */
const ENVIRONMENT_SIZE = 128;
const ENVIRONMENT_INTENSITY = 0.8;
const LABEL_COLORS: Record<Side, string> = {
  player: "rgba(140, 217, 255, 0.7)",
  enemy: "rgba(255, 140, 128, 0.7)",
};

/** Kamerawackeln bei Explosionen: Abklingrate pro Sekunde und die Frequenzen (rad/s) der überlagerten Schwingungen. */
const SHAKE_DECAY = 4.5;
const SHAKE_FREQUENCIES = { x: 83, y: 109, sway: 23 };

/** Kamera-Parallaxe: Reichweite in Welteinheiten und Nachlauf. */
const MAX_SCROLL_OFFSET = new Vector2(0.75, 0.4);
const FOLLOW_SPEED = 4;
/** Hintergrund-Versatz als Anteil des Viewports pro Welteinheit Kameraversatz. */
const BACKGROUND_SCROLL_STRENGTH = new Vector2(0.0125, 0.011);

/**
 * Mausrad-Zoom: Die Kamera fährt auf den Brettpunkt unter dem Zeiger zu und
 * beim Herauszoomen zurück in die Ruhelage. Höhe der Kamera als Grenze nach unten.
 */
const ZOOM_MIN_HEIGHT = 2.6;
/** Höhenfaktor pro Pixel Mausrad (exponentiell, damit Trackpads und Rasterräder gleich wirken). */
const ZOOM_SPEED = 0.0018;
const ZOOM_FOLLOW_SPEED = 8;
/** Ab dieser Zeigerbewegung in CSS-Pixeln wird aus einem Klick ein Verschieben der Kamera. */
const PAN_THRESHOLD = 5;
/** Brettbereich, auf den gezoomt und die Kamera ausgerichtet werden kann (Welt-x und -z). */
const ZOOM_FOCUS_X = 7.5;
const ZOOM_FOCUS_Z: [number, number] = [BOARD_Z - 6.5, BOARD_Z + 6.5];

const isPadHitbox = (mesh: AbstractMesh): boolean => mesh.metadata?.pad !== undefined;

/** Der SlotPad unter dem Zeiger eines Pointer-Events, sofern einer getroffen wurde. */
export function pickedPad(info: PointerInfo): SlotPad | null {
  return (info.pickInfo?.pickedMesh?.metadata?.pad as SlotPad | undefined) ?? null;
}

export class MatchScene {
  readonly engine: Engine;
  readonly scene: Scene;
  readonly pads: SlotPad[] = [];
  readonly padsByLane = new Map<Lane, SlotPad[]>();
  readonly effects: BoardEffects;
  /** Pfeile der beiden möglichen Bewegungen eines Zugs: Bewegungsbefehl und Grundmanöver. */
  readonly moveArrow: MoveArrow;
  readonly maneuverArrow: MoveArrow;
  /** Zielslot des Torpedos auf der Gegnerseite. */
  readonly reticle: TargetReticle;
  private readonly camera: TargetCamera;
  private readonly cameraRig: TransformNode;
  private readonly glow: GlowLayer;
  private readonly background: Background;
  private readonly laneLabels: LaneLabel[] = [];
  private readonly scrollOffset = new Vector2(0, 0);
  /** Versatz der Kamera aus der Ruhelage durch den Zoom: Ziel und geglätteter Ist-Wert. */
  private readonly zoomTarget = Vector3.Zero();
  private readonly zoomOffset = Vector3.Zero();
  /** Gedrückte linke Maustaste: Startpunkt, letzte Position und ob schon verschoben wird. */
  private drag: { startX: number; startY: number; lastX: number; lastY: number; panning: boolean } | null = null;
  private panned = false;
  /** Stärke des Kamerawackelns (Welteinheiten) und seine Uhr. */
  private shakeStrength = 0;
  private shakeTime = 0;
  private readonly shakeOffset = new Vector2(0, 0);

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly board: Board,
  ) {
    registerBuiltInLoaders();
    // Übersetzte Shader bleiben, auch wenn ihr letztes Material entsorgt wird (Effekte, Wracks, Geister):
    // Die Generalprobe beim Laden übersetzt sie alle einmal (`rehearsal.ts`).
    Effect.PersistentMode = true;
    this.engine = new Engine(canvas, true, { adaptToDeviceRatio: true });
    this.scene = new Scene(this.engine);
    this.scene.clearColor = Color4.FromColor3(color3("background"), 1);
    this.background = new Background(this.scene);

    this.cameraRig = new TransformNode("camera-rig", this.scene);
    this.cameraRig.position = CAMERA_RIG_POSITION.clone();
    const camera = (this.camera = new TargetCamera("camera", Vector3.Zero(), this.scene));
    camera.parent = this.cameraRig;
    camera.rotation.x = CAMERA_PITCH;
    camera.fov = CAMERA_FOV;
    camera.minZ = 0.1;
    camera.maxZ = 80;

    // Pointer-Events der Szene treffen nur die Hitboxen der Pads.
    this.scene.pointerMovePredicate = isPadHitbox;
    this.scene.pointerDownPredicate = isPadHitbox;
    this.scene.pointerUpPredicate = isPadHitbox;

    this.createLights();
    this.createEnvironment();
    // Nur die Rahmen gültiger Ziele bekommen Bloom, alles andere bleibt scharf.
    this.glow = new GlowLayer("glow", this.scene, { blurKernelSize: 48 });
    this.glow.intensity = 0.7;
    this.effects = new BoardEffects(this.scene, this.glow);
    this.moveArrow = new MoveArrow(this.scene, this.glow);
    this.maneuverArrow = new MoveArrow(this.scene, this.glow);
    this.reticle = new TargetReticle(this.scene, this.glow);

    this.createBoard(board);

    this.scene.onBeforeRenderObservable.add(() => this.updateCamera());
    canvas.addEventListener("wheel", (event) => this.onWheel(event), { passive: false });
    canvas.addEventListener("pointerdown", (event) => this.onPointerDown(event));
    canvas.addEventListener("pointermove", (event) => this.onPointerMove(event));
    canvas.addEventListener("pointerup", () => (this.drag = null));
    canvas.addEventListener("pointercancel", () => (this.drag = null));
    window.addEventListener("resize", () => this.engine.resize());
    this.engine.runRenderLoop(() => this.scene.render());
  }

  /** Ob die letzte Geste mit gedrückter Maustaste die Kamera verschoben hat statt zu klicken. */
  get wasPanned(): boolean {
    return this.panned;
  }

  /** Wartet, bis Hintergrundbild und HDR-Umgebung geladen sind. */
  texturesReady(): Promise<void> {
    return new Promise((resolve) => BaseTexture.WhenAllReady([this.background.texture, this.scene.environmentTexture!], resolve));
  }

  pad(side: Side, lane: LaneType, slotIndex: number): SlotPad {
    return this.padsByLane.get(this.board.lane(side, lane))![slotIndex]!;
  }

  /**
   * Stellt ein neues Schiff auf den Slot und lässt es vom Bildrand seiner Seite einfliegen. Die
   * Command-Lane liegt näher am Rand: Steht dort im selben Slot ein Schiff, überfliegt es ein Schiff für die Strike-Lane.
   */
  async deploy(ship: ShipView, side: Side, lane: LaneType, slotIndex: number): Promise<void> {
    this.pad(side, lane, slotIndex).attachShip(ship);
    const x = Math.abs(LANE_X[side][lane]);
    const blocked = lane === "strike" && this.pad(side, "command", slotIndex).ship !== null;
    await ship.arrive(ARRIVAL_X - x, blocked ? Math.abs(LANE_X[side].command) - x : null);
  }

  /** Bildschirmposition eines Weltpunkts in CSS-Pixeln, für DOM-Overlays. */
  screenPosition(world: Vector3): { x: number; y: number } {
    const { clientWidth: width, clientHeight: height } = this.canvas;
    const viewport = this.camera.viewport.toGlobal(width, height);
    const projected = Vector3.Project(world, Matrix.IdentityReadOnly, this.scene.getTransformMatrix(), viewport);
    return { x: projected.x, y: projected.y };
  }

  /** Stößt die Kamera an: Sie zittert mit `strength` Welteinheiten und beruhigt sich wieder. */
  shake(strength: number): void {
    this.shakeStrength = Math.max(this.shakeStrength, strength);
  }

  /** Das Lane-Gitter lenkt nur ab, solange nichts platziert wird. */
  setGridVisible(value: boolean): void {
    for (const pad of this.pads) pad.setGridVisible(value);
    for (const label of this.laneLabels) label.visible = value;
  }

  private createLights(): void {
    const key = new DirectionalLight("key", new Vector3(0.4, -0.78, 0.48), this.scene);
    key.intensity = 1.6;
    const fill = new PointLight("fill", new Vector3(0, 5, -3), this.scene);
    fill.intensity = 0.9;
    fill.range = 26;
    const rim = new PointLight("rim", new Vector3(0, 4, 11), this.scene);
    rim.intensity = 0.7;
    rim.range = 22;
    const ambient = new HemisphericLight("ambient", new Vector3(0, 1, 0), this.scene);
    ambient.intensity = 0.25;
  }

  private createEnvironment(): void {
    this.scene.environmentTexture = new HDRCubeTexture(environmentUrl, this.scene, ENVIRONMENT_SIZE, false, true, false, true);
    this.scene.environmentIntensity = ENVIRONMENT_INTENSITY;
  }

  private createBoard(board: Board): void {
    const boardRoot = new TransformNode("board", this.scene);
    boardRoot.position.z = BOARD_Z;
    const materials = createPadMaterials(this.scene);

    for (const lane of board.lanes) {
      const laneRoot = new TransformNode(`lane-${lane.side}-${lane.type}`, this.scene);
      laneRoot.parent = boardRoot;
      laneRoot.position.x = LANE_X[lane.side][lane.type];
      this.laneLabels.push(new LaneLabel(this.scene, laneRoot, upper(t.lanes[lane.type]), LABEL_COLORS[lane.side]));

      const facing = lane.side === "player" ? 1 : -1;
      const pads = lane.slots.map(
        (slot) => new SlotPad(this.scene, laneRoot, slot, new Vector3(0, 0, SLOT_Z[slot.index]!), facing, materials),
      );
      for (const pad of pads) this.glow.addIncludedOnlyMesh(pad.validGlow);
      this.pads.push(...pads);
      this.padsByLane.set(lane, pads);
    }
  }

  /** Zoomt auf den Brettpunkt unter dem Zeiger zu oder zurück in Richtung Ruhelage. */
  private onWheel(event: WheelEvent): void {
    event.preventDefault();
    const pixels = event.deltaMode === WheelEvent.DOM_DELTA_LINE ? event.deltaY * 16 : event.deltaY;
    const factor = Math.exp(pixels * ZOOM_SPEED);
    const rest = CAMERA_RIG_POSITION;
    const height = rest.y + this.zoomTarget.y;

    if (factor < 1) {
      const focus = this.boardPointUnderPointer();
      if (!focus) return;
      const nextHeight = Math.max(height * factor, ZOOM_MIN_HEIGHT);
      // Auf der Geraden Kamera → Fokus bleibt der Punkt unter dem Zeiger stehen.
      const camera = rest.add(this.zoomTarget);
      const next = Vector3.Lerp(focus, camera, (nextHeight - focus.y) / (camera.y - focus.y));
      this.zoomTarget.copyFrom(next.subtract(rest));
      this.clampZoomTarget();
    } else {
      // Herauszoomen schrumpft den Versatz, bis die Kamera wieder in der Ruhelage steht.
      if (height >= rest.y) return;
      const nextHeight = Math.min(height * factor, rest.y);
      this.zoomTarget.scaleInPlace((rest.y - nextHeight) / (rest.y - height));
    }
  }

  /** Zeigerposition im Canvas in CSS-Pixeln, wie Babylon sie für `scene.pointerX/Y` berechnet. */
  private canvasPoint(event: PointerEvent): { x: number; y: number } {
    const rect = this.canvas.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  private onPointerDown(event: PointerEvent): void {
    if (event.button !== 0) return;
    const { x, y } = this.canvasPoint(event);
    this.drag = { startX: x, startY: y, lastX: x, lastY: y, panning: false };
    this.panned = false;
    this.canvas.setPointerCapture(event.pointerId);
  }

  /** Verschieben gibt es nur herangezoomt; in der Ruhelage ist das ganze Brett zu sehen. */
  private onPointerMove(event: PointerEvent): void {
    const drag = this.drag;
    if (!drag || this.zoomTarget.y >= 0) return;
    const { x, y } = this.canvasPoint(event);
    if (!drag.panning) {
      if (Math.hypot(x - drag.startX, y - drag.startY) < PAN_THRESHOLD) return;
      drag.panning = this.panned = true;
    }
    // Der Brettpunkt unter dem Zeiger wandert mit, als würde man das Brett greifen.
    const from = this.boardPointAt(drag.lastX, drag.lastY);
    const to = this.boardPointAt(x, y);
    drag.lastX = x;
    drag.lastY = y;
    if (!from || !to) return;
    const before = this.zoomTarget.clone();
    this.zoomTarget.x += from.x - to.x;
    this.zoomTarget.z += from.z - to.z;
    this.clampZoomTarget();
    // Ohne Nachlauf, damit das Brett direkt an der Maus hängt.
    this.zoomOffset.addInPlace(this.zoomTarget.subtract(before));
  }

  /** Hält den Blickpunkt der Kamera (Bildmitte auf dem Brett) im Brettbereich. */
  private clampZoomTarget(): void {
    const rest = CAMERA_RIG_POSITION;
    const height = rest.y + this.zoomTarget.y;
    const lookAhead = height / Math.tan(CAMERA_PITCH);
    this.zoomTarget.x = Math.min(Math.max(this.zoomTarget.x, -ZOOM_FOCUS_X - rest.x), ZOOM_FOCUS_X - rest.x);
    const focusZ = Math.min(Math.max(rest.z + this.zoomTarget.z + lookAhead, ZOOM_FOCUS_Z[0]), ZOOM_FOCUS_Z[1]);
    this.zoomTarget.z = focusZ - lookAhead - rest.z;
  }

  /** Schnittpunkt des Zeigerstrahls mit der Brettebene, auf den Brettbereich begrenzt. */
  private boardPointUnderPointer(): Vector3 | null {
    const point = this.boardPointAt(this.scene.pointerX, this.scene.pointerY);
    if (!point) return null;
    point.x = Math.min(Math.max(point.x, -ZOOM_FOCUS_X), ZOOM_FOCUS_X);
    point.z = Math.min(Math.max(point.z, ZOOM_FOCUS_Z[0]), ZOOM_FOCUS_Z[1]);
    return point;
  }

  /** Schnittpunkt des Strahls durch einen Canvas-Punkt (CSS-Pixel) mit der Brettebene. */
  private boardPointAt(x: number, y: number): Vector3 | null {
    const ray = this.scene.createPickingRay(x, y, Matrix.Identity(), this.camera);
    if (ray.direction.y >= 0) return null;
    return ray.origin.add(ray.direction.scale(-ray.origin.y / ray.direction.y));
  }

  private updateCamera(): void {
    const seconds = this.engine.getDeltaTime() / 1000;
    this.updateCameraParallax(seconds);
    this.updateShake(seconds);
    const t = Math.min(seconds * ZOOM_FOLLOW_SPEED, 1);
    this.zoomOffset.addInPlace(this.zoomTarget.subtract(this.zoomOffset).scaleInPlace(t));
    this.cameraRig.position.set(
      CAMERA_RIG_POSITION.x + this.scrollOffset.x + this.zoomOffset.x + this.shakeOffset.x,
      CAMERA_RIG_POSITION.y + this.scrollOffset.y + this.zoomOffset.y + this.shakeOffset.y,
      CAMERA_RIG_POSITION.z + this.zoomOffset.z,
    );
  }

  /** Zwei schnelle Schwingungen und ein langsames Schwanken, die mit der Stärke abklingen; läuft im Animationstakt. */
  private updateShake(seconds: number): void {
    if (this.shakeStrength < 0.001) {
      this.shakeStrength = 0;
      this.shakeOffset.set(0, 0);
      return;
    }
    const scaled = seconds / animationTimeScale();
    this.shakeTime += scaled;
    const { x, y, sway } = SHAKE_FREQUENCIES;
    const t = this.shakeTime;
    this.shakeOffset.set(
      this.shakeStrength * (0.7 * Math.sin(t * x) + 0.3 * Math.sin(t * sway)),
      this.shakeStrength * (0.5 * Math.sin(t * y + 1.3) + 0.3 * Math.sin(t * sway * 1.4 + 0.7)),
    );
    this.shakeStrength *= Math.exp(-SHAKE_DECAY * scaled);
  }

  private updateCameraParallax(seconds: number): void {
    // Zeigerposition und Canvas-Größe beide in CSS-Pixeln; die Render-Größe
    // wäre auf HiDPI-Displays um den Device-Pixel-Ratio größer.
    const { clientWidth: width, clientHeight: height } = this.canvas;
    if (width === 0 || height === 0) return;
    const ratioX = Math.min(Math.max(this.scene.pointerX / width, 0), 1) - 0.5;
    const ratioY = Math.min(Math.max(this.scene.pointerY / height, 0), 1) - 0.5;
    // Nah am Brett wäre die volle Parallaxe zu unruhig; sie schrumpft mit der Kamerahöhe.
    const closeness = (CAMERA_RIG_POSITION.y + this.zoomOffset.y) / CAMERA_RIG_POSITION.y;
    const targetX = -ratioX * MAX_SCROLL_OFFSET.x * 2 * closeness;
    const targetY = ratioY * MAX_SCROLL_OFFSET.y * 2 * closeness;

    const t = Math.min(seconds * FOLLOW_SPEED, 1);
    this.scrollOffset.x += (targetX - this.scrollOffset.x) * t;
    this.scrollOffset.y += (targetY - this.scrollOffset.y) * t;
    this.background.setScrollOffset(
      -this.scrollOffset.x * BACKGROUND_SCROLL_STRENGTH.x,
      -this.scrollOffset.y * BACKGROUND_SCROLL_STRENGTH.y,
    );
  }
}
