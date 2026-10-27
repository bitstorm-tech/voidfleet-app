// Die 3D-Szene des Match-Bretts: Kamera-Rig mit Maus-Parallaxe, Mausrad-Zoom und Verschieben per Ziehen, zwei
// Ansichten mit jedem Stand dazwischen, Lichter, Glow, Hintergrund und die vier Lanes mit je sechs Landeplätzen.
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
import { setScreenSide } from "../audio/sounds.ts";
import { color3 } from "../data/palette.ts";
import { t, upper } from "../i18n/index.ts";
import { type CameraView, onSettingsChange, settings } from "../settings.ts";
import { Background } from "./background.ts";
import { BoardEffects } from "./effects.ts";
import { LaneLabel } from "./laneLabel.ts";
import { MoveArrow } from "./moveArrow.ts";
import type { ShipView } from "./ship.ts";
import { PAD_DEPTH, PAD_WIDTH, SlotPad, createPadMaterials } from "./slotPad.ts";
import { TargetLines } from "./targetLines.ts";
import { TargetReticle } from "./targetReticle.ts";
import { animationTimeScale, easeInOutSine } from "./tween.ts";

const BOARD_Z = 2.5;

/**
 * Eine Kameraansicht samt Aufteilung des Bretts. `yaw` dreht die Kamera um die Hochachse, `pitch` neigt sie nach unten;
 * wo sie steht, folgt aus `frame` (`MatchScene.frameBoard`).
 */
interface ViewSpec {
  yaw: number;
  pitch: number;
  fov: number;
  /** Bildband, das die Pads senkrecht füllen: Ober- und Unterkante in Bildhöhen von oben. */
  frame: [top: number, bottom: number];
  /** Welt-x der Lanes. */
  laneX: Record<Side, Record<LaneType, number>>;
  /** Abstand der Slots entlang der Lane; zwischen den Pads bleibt eine Fuge. */
  slotStep: number;
  /** Lane-z der Beschriftung, jenseits von Slot 0. */
  labelZ: number;
}

/**
 * Von der Seite liegt die eigene Seite links und Slot 0 hinten, die Beschriftung steht hinter ihm. Von hinten oben liegt
 * die eigene Seite unten und Slot 0 links, die Beschriftung links daneben; die Lanes rücken zusammen und die Slots
 * auseinander, damit das Brett über die Hand passt. Dazwischen ist jeder Stand möglich: Ausrichtung, Bildband und
 * Aufteilung werden gemischt, Lanes und Slots gleiten mit.
 */
const VIEWS: Record<CameraView, ViewSpec> = {
  side: {
    yaw: 0,
    pitch: Tools.ToRadians(42),
    fov: Tools.ToRadians(33.5),
    frame: [0.175, 0.767],
    laneX: { player: { command: -6.15, strike: -2.75 }, enemy: { strike: 2.75, command: 6.15 } },
    slotStep: 2.2,
    labelZ: 6.4,
  },
  top: {
    yaw: Math.PI / 2,
    pitch: Tools.ToRadians(50),
    fov: Tools.ToRadians(30),
    frame: [0.153, 0.679],
    laneX: { player: { command: -5.4, strike: -2 }, enemy: { strike: 2, command: 5.4 } },
    slotStep: 2.6,
    labelZ: 9.1,
  },
};
/** Stand zwischen den Ansichten, an dem jede liegt. */
const VIEW_BLEND: Record<CameraView, number> = { side: 0, top: 1 };
/** Dauer der Kamerafahrt zwischen den Ansichten in ms, gestreckt wie die übrigen Animationen. */
const VIEW_SWITCH_DURATION = 1100;
/** Mit gehaltener Pfeiltaste dreht die Kamera in dieser Zeit (ms) von einer Ansicht zur anderen; An- und Auslauf in ms. */
const ORBIT_DURATION = 1600;
const ORBIT_RAMP = 150;
/** Lane-z eines Slots: Slot 0 am Ende mit dem größten z, die sechs Slots symmetrisch um die Lane-Mitte. */
const slotZ = (index: number, step: number): number => (2.5 - index) * step;
/** Neue Schiffe fliegen von hier aus ein, außerhalb des Bildes am Rand ihrer Seite (Welt-|x|). */
const ARRIVAL_X = 19;
/** Die Lichter kreisen mit der Kamera um die Brettmitte; ihre Lage gilt von der Seite gesehen. */
const BOARD_CENTER = new Vector3(0, 0, BOARD_Z);
const KEY_DIRECTION = new Vector3(0.4, -0.78, 0.48);
const FILL_OFFSET = new Vector3(0, 5, -5.5);
const RIM_OFFSET = new Vector3(0, 4, 8.5);
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
const ZOOM_FOCUS_Z: [number, number] = [BOARD_Z - 7.5, BOARD_Z + 7.5];

const clamp = (value: number, min: number, max: number): number => Math.min(Math.max(value, min), max);

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
  /** Pfeile der Bewegungen eines Zugs: Bewegungsbefehl, Grundmanöver und beim Phasentausch der Rückweg des Tauschpartners. */
  readonly moveArrow: MoveArrow;
  readonly maneuverArrow: MoveArrow;
  readonly swapArrow: MoveArrow;
  /** Zielslot des Torpedos auf der Gegnerseite. */
  readonly reticle: TargetReticle;
  /** Zielvorschau beim Planen: wer im Kampf auf wen feuert. */
  readonly targetLines: TargetLines;
  private readonly camera: TargetCamera;
  private readonly cameraRig: TransformNode;
  private readonly glow: GlowLayer;
  private readonly background: Background;
  private readonly lights: { key: DirectionalLight; fill: PointLight; rim: PointLight };
  /** Je Lane ihr Knoten, dessen Welt-x der Ansicht folgt, und ihre Beschriftung. */
  private readonly lanes: { lane: Lane; root: TransformNode; label: LaneLabel }[] = [];
  /** Stand zwischen den Ansichten (0 von der Seite, 1 von hinten oben) und sein Tempo pro Sekunde. */
  private blend: number;
  private blendSpeed = 0;
  /** Richtung der gedrückten Pfeiltasten: 1 nach hinten oben, −1 zur Seite. */
  private orbitDirection = 0;
  /** Stand einer Ansicht, zu dem die Kamera per Knopf, Taste V oder Einstellung fährt. */
  private viewGoal: number | null = null;
  /** Ruhelage und Ausrichtung der Kamera beim jetzigen Stand zwischen den Ansichten. */
  private readonly rest = Vector3.Zero();
  private yaw = 0;
  private pitch = 0;
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
    const camera = (this.camera = new TargetCamera("camera", Vector3.Zero(), this.scene));
    camera.parent = this.cameraRig;
    camera.minZ = 0.1;
    camera.maxZ = 80;

    // Pointer-Events der Szene treffen nur die Hitboxen der Pads.
    this.scene.pointerMovePredicate = isPadHitbox;
    this.scene.pointerDownPredicate = isPadHitbox;
    this.scene.pointerUpPredicate = isPadHitbox;

    this.lights = this.createLights();
    this.createEnvironment();
    // Nur die Rahmen gültiger Ziele bekommen Bloom, alles andere bleibt scharf.
    this.glow = new GlowLayer("glow", this.scene, { blurKernelSize: 48 });
    this.glow.intensity = 0.7;
    this.effects = new BoardEffects(this.scene, this.glow);
    this.moveArrow = new MoveArrow(this.scene, this.glow);
    this.maneuverArrow = new MoveArrow(this.scene, this.glow);
    this.swapArrow = new MoveArrow(this.scene, this.glow);
    this.reticle = new TargetReticle(this.scene, this.glow);
    this.targetLines = new TargetLines(this.scene, this.glow);

    this.createBoard(board);
    this.blend = VIEW_BLEND[settings.cameraView];
    this.applyView();
    // Eine andere Standardansicht in den Einstellungen gilt sofort.
    let defaultView = settings.cameraView;
    onSettingsChange(() => {
      if (settings.cameraView === defaultView) return;
      defaultView = settings.cameraView;
      this.turnTo(VIEW_BLEND[defaultView]);
    });
    setScreenSide((at) => (this.screenPosition(at).x / this.canvas.clientWidth) * 2 - 1);

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
    const x = Math.abs(this.laneX(side, lane));
    const blocked = lane === "strike" && this.pad(side, "command", slotIndex).ship !== null;
    await ship.arrive(ARRIVAL_X - x, blocked ? Math.abs(this.laneX(side, "command")) - x : null);
  }

  /** Mitte einer Brettseite zwischen ihren Lanes, für Effekte und Sounds, die zu keinem Schiff gehören. */
  sideCenter(side: Side): Vector3 {
    return new Vector3((this.laneX(side, "strike") + this.laneX(side, "command")) / 2, 0, BOARD_Z);
  }

  /**
   * Fährt zur anderen Ansicht, von einem Stand dazwischen zur ferneren, und kehrt eine laufende Fahrt um; herangezoomt geht
   * es dabei zurück in die Ruhelage.
   */
  toggleCameraView(): void {
    this.turnTo((this.viewGoal ?? this.blend) < 0.5 ? VIEW_BLEND.top : VIEW_BLEND.side);
  }

  /** Dreht die Kamera stufenlos zwischen den Ansichten, solange `direction` nicht 0 ist: 1 nach hinten oben, −1 zur Seite. */
  orbitCamera(direction: number): void {
    this.orbitDirection = direction;
    if (direction === 0) return;
    this.viewGoal = null;
    this.zoomTarget.setAll(0);
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
    for (const { label } of this.lanes) label.visible = value;
  }

  private turnTo(goal: number): void {
    this.viewGoal = goal;
    this.zoomTarget.setAll(0);
  }

  private get isTurning(): boolean {
    return this.viewGoal !== null || this.blendSpeed !== 0;
  }

  private laneX(side: Side, type: LaneType): number {
    return this.lanes.find(({ lane }) => lane.side === side && lane.type === type)!.root.position.x;
  }

  /** Die Lage von Füll- und Kantenlicht und die Richtung des Hauptlichts setzt `applyView`. */
  private createLights(): { key: DirectionalLight; fill: PointLight; rim: PointLight } {
    const key = new DirectionalLight("key", KEY_DIRECTION.clone(), this.scene);
    key.intensity = 1.6;
    const fill = new PointLight("fill", Vector3.Zero(), this.scene);
    fill.intensity = 0.9;
    fill.range = 26;
    const rim = new PointLight("rim", Vector3.Zero(), this.scene);
    rim.intensity = 0.7;
    rim.range = 22;
    const ambient = new HemisphericLight("ambient", new Vector3(0, 1, 0), this.scene);
    ambient.intensity = 0.25;
    return { key, fill, rim };
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
      const root = new TransformNode(`lane-${lane.side}-${lane.type}`, this.scene);
      root.parent = boardRoot;
      const label = new LaneLabel(this.scene, root, upper(t.lanes[lane.type]), LABEL_COLORS[lane.side]);
      this.lanes.push({ lane, root, label });

      const facing = lane.side === "player" ? 1 : -1;
      const pads = lane.slots.map((slot) => new SlotPad(this.scene, root, slot, facing, materials));
      for (const pad of pads) this.glow.addIncludedOnlyMesh(pad.validGlow);
      this.pads.push(...pads);
      this.padsByLane.set(lane, pads);
    }
  }

  /**
   * Stellt Lanes, Slots, Beschriftungen, Kamera und Lichter auf den Stand zwischen den Ansichten; Zielbögen und Pfeile
   * folgen den Pads.
   */
  private applyView(): void {
    const { side, top } = VIEWS;
    const progress = easeInOutSine(this.blend);
    const mix = (from: number, to: number) => from + (to - from) * progress;

    for (const { lane, root, label } of this.lanes) {
      root.position.x = mix(side.laneX[lane.side][lane.type], top.laneX[lane.side][lane.type]);
      label.mesh.position.z = mix(side.labelZ, top.labelZ);
    }
    const slotStep = mix(side.slotStep, top.slotStep);
    for (const pad of this.pads) {
      pad.root.position.z = slotZ(pad.slot.index, slotStep);
      // Erzwungen: Bögen und Pfeile lesen gleich die Weltlage, auch wenn ein Knoten in diesem Bild schon gerechnet war.
      pad.root.computeWorldMatrix(true);
    }

    this.yaw = mix(side.yaw, top.yaw);
    this.pitch = mix(side.pitch, top.pitch);
    this.cameraRig.rotation.y = this.yaw;
    this.camera.rotation.x = this.pitch;
    this.camera.fov = mix(side.fov, top.fov);
    const halfWidth = Math.max(...this.lanes.map(({ root }) => Math.abs(root.position.x))) + PAD_WIDTH / 2;
    const halfDepth = slotZ(0, slotStep) + PAD_DEPTH / 2;
    this.frameBoard(halfWidth, halfDepth, mix(side.frame[0], top.frame[0]), mix(side.frame[1], top.frame[1]));

    const turn = Matrix.RotationY(this.yaw);
    this.lights.key.direction = Vector3.TransformNormal(KEY_DIRECTION, turn);
    this.lights.fill.position = BOARD_CENTER.add(Vector3.TransformCoordinates(FILL_OFFSET, turn));
    this.lights.rim.position = BOARD_CENTER.add(Vector3.TransformCoordinates(RIM_OFFSET, turn));

    this.targetLines.refresh();
    for (const arrow of [this.moveArrow, this.maneuverArrow, this.swapArrow]) arrow.refresh();
  }

  /**
   * Stellt die Kamera bei ihrer Ausrichtung so, dass die Brettmitte waagerecht in der Bildmitte liegt und die Pads senkrecht
   * genau das Band von `top` bis `bottom` (Bildhöhen von oben) füllen. Alle Punkte auf einer Bildhöhe y (unten −1, oben 1)
   * liegen in einer Ebene durch die Kamera mit der Normalen oben − y·tan(fov/2)·vorn; am höchsten bzw. tiefsten liegt eine
   * Brettecke, `ahead` weit vor der parallelen Ebene durch die Brettmitte. Damit sind Abstand und Höhe der Kamera linear
   * bestimmt. Schräg reicht das Brett in Blickrichtung weiter (`reach`), die Kamera rückt also zurück.
   */
  private frameBoard(halfWidth: number, halfDepth: number, top: number, bottom: number): void {
    const { yaw, pitch } = this;
    const tan = Math.tan(this.camera.fov / 2);
    const reach = halfWidth * Math.sin(yaw) + halfDepth * Math.cos(yaw);
    const screenY = (fromTop: number) => 1 - 2 * fromTop;
    const ahead = (fromTop: number) => reach * (Math.sin(pitch) - screenY(fromTop) * tan * Math.cos(pitch));
    const distance = (ahead(top) + ahead(bottom)) / (tan * (screenY(top) - screenY(bottom)));
    const lift = ahead(top) - distance * screenY(top) * tan;
    const forward = new Vector3(Math.sin(yaw) * Math.cos(pitch), -Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch));
    const up = new Vector3(Math.sin(yaw) * Math.sin(pitch), Math.cos(pitch), Math.cos(yaw) * Math.sin(pitch));
    this.rest.copyFrom(BOARD_CENTER).addInPlace(up.scaleInPlace(lift)).subtractInPlace(forward.scaleInPlace(distance));
  }

  /** Waagerecht nach rechts im Bild. */
  private screenRight(): Vector3 {
    return new Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
  }

  /** Zoomt auf den Brettpunkt unter dem Zeiger zu oder zurück in Richtung Ruhelage; nicht, während sich die Ansicht dreht. */
  private onWheel(event: WheelEvent): void {
    event.preventDefault();
    if (this.isTurning) return;
    const pixels = event.deltaMode === WheelEvent.DOM_DELTA_LINE ? event.deltaY * 16 : event.deltaY;
    const factor = Math.exp(pixels * ZOOM_SPEED);
    const rest = this.rest;
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
    const camera = this.rest.add(this.zoomTarget);
    const lookAhead = camera.y / Math.tan(this.pitch);
    const focusX = camera.x + Math.sin(this.yaw) * lookAhead;
    const focusZ = camera.z + Math.cos(this.yaw) * lookAhead;
    this.zoomTarget.x += clamp(focusX, -ZOOM_FOCUS_X, ZOOM_FOCUS_X) - focusX;
    this.zoomTarget.z += clamp(focusZ, ZOOM_FOCUS_Z[0], ZOOM_FOCUS_Z[1]) - focusZ;
  }

  /** Schnittpunkt des Zeigerstrahls mit der Brettebene, auf den Brettbereich begrenzt. */
  private boardPointUnderPointer(): Vector3 | null {
    const point = this.boardPointAt(this.scene.pointerX, this.scene.pointerY);
    if (!point) return null;
    point.x = clamp(point.x, -ZOOM_FOCUS_X, ZOOM_FOCUS_X);
    point.z = clamp(point.z, ZOOM_FOCUS_Z[0], ZOOM_FOCUS_Z[1]);
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
    this.updateView(seconds);
    this.updateCameraParallax(seconds);
    this.updateShake(seconds);
    const t = Math.min(seconds * ZOOM_FOLLOW_SPEED, 1);
    this.zoomOffset.addInPlace(this.zoomTarget.subtract(this.zoomOffset).scaleInPlace(t));
    // Parallaxe und Wackeln versetzen die Kamera waagerecht im Bild und in der Höhe.
    const sideways = this.screenRight().scaleInPlace(this.scrollOffset.x + this.shakeOffset.x);
    this.cameraRig.position.copyFrom(this.rest).addInPlace(this.zoomOffset).addInPlace(sideways);
    this.cameraRig.position.y += this.scrollOffset.y + this.shakeOffset.y;
  }

  /**
   * Dreht die Ansicht, solange eine Pfeiltaste gedrückt ist, sonst bis zum Ziel der Kamerafahrt im Takt der übrigen
   * Animationen. Das Tempo läuft kurz an und aus; an den Ansichten selbst bremst `easeInOutSine` in `applyView` sanft.
   */
  private updateView(seconds: number): void {
    const goal = this.orbitDirection === 0 ? this.viewGoal : null;
    const direction = goal === null ? this.orbitDirection : Math.sign(goal - this.blend);
    const topSpeed = 1000 / (goal === null ? ORBIT_DURATION : VIEW_SWITCH_DURATION * animationTimeScale("general"));
    const change = (topSpeed * seconds * 1000) / ORBIT_RAMP;
    this.blendSpeed = clamp(direction * topSpeed, this.blendSpeed - change, this.blendSpeed + change);
    const blend = clamp(this.blend + this.blendSpeed * seconds, 0, 1);
    if (blend === 0 || blend === 1) this.blendSpeed = 0;
    if (blend === this.viewGoal) this.viewGoal = null;
    if (blend === this.blend) return;
    this.blend = blend;
    this.applyView();
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
    const closeness = (this.rest.y + this.zoomOffset.y) / this.rest.y;
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
