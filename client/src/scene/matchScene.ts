// Die 3D-Szene des Match-Bretts: Kamera-Rig mit Maus-Parallaxe, Lichter,
// Glow, Hintergrund und die vier Lanes mit je sechs Landeplätzen.
//
// Koordinaten: Babylon ist linkshändig, die Godot-Szene rechtshändig. Alle
// Z-Werte aus der Godot-Szene sind hier negiert; x (Lanes) und y bleiben.

import { Engine } from "@babylonjs/core/Engines/engine";
import { FreeCamera } from "@babylonjs/core/Cameras/freeCamera";
import { GlowLayer } from "@babylonjs/core/Layers/glowLayer";
import { DirectionalLight } from "@babylonjs/core/Lights/directionalLight";
import { HemisphericLight } from "@babylonjs/core/Lights/hemisphericLight";
import { PointLight } from "@babylonjs/core/Lights/pointLight";
import { Color4 } from "@babylonjs/core/Maths/math.color";
import { Vector2, Vector3 } from "@babylonjs/core/Maths/math.vector";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { Scene } from "@babylonjs/core/scene";
import "@babylonjs/core/Culling/ray";
import { registerBuiltInLoaders } from "@babylonjs/loaders/dynamic";
import type { Board, Lane, Side } from "../game/board.ts";
import { Background } from "./background.ts";
import { LaneLabel } from "./laneLabel.ts";
import { SlotPad, createPadMaterials } from "./slotPad.ts";

const CAMERA_RIG_POSITION = new Vector3(0, 14.7, -15.7);
const CAMERA_PITCH = Math.atan2(0.6691, 0.7431);
const CAMERA_FOV = (32 * Math.PI) / 180;
const BOARD_Z = 2.5;
const LANE_X: Record<Side, Record<Lane["type"], number>> = {
  player: { command: -5.8, strike: -2.6 },
  enemy: { strike: 2.6, command: 5.8 },
};
/** Slot 0 liegt am hinteren Ende der Lane (weit von der Kamera). */
const SLOT_Z = [4.75, 2.85, 0.95, -0.95, -2.85, -4.75];
const LABEL_COLORS: Record<Side, string> = {
  player: "rgba(140, 217, 255, 0.7)",
  enemy: "rgba(255, 140, 128, 0.7)",
};

/** Kamera-Parallaxe: Reichweite in Welteinheiten, Nachlauf, Hintergrund in Pixeln. */
const MAX_SCROLL_OFFSET = new Vector2(0.75, 0.4);
const FOLLOW_SPEED = 4;
const BACKGROUND_SCROLL_STRENGTH = new Vector2(24, 12);

export class MatchScene {
  readonly engine: Engine;
  readonly scene: Scene;
  readonly pads: SlotPad[] = [];
  readonly padsByLane = new Map<Lane, SlotPad[]>();
  private readonly cameraRig: TransformNode;
  private readonly glow: GlowLayer;
  private readonly background: Background;
  private readonly laneLabels: LaneLabel[] = [];
  private readonly scrollOffset = new Vector2(0, 0);

  constructor(canvas: HTMLCanvasElement, board: Board) {
    registerBuiltInLoaders();
    this.engine = new Engine(canvas, true, { adaptToDeviceRatio: true });
    this.scene = new Scene(this.engine);
    this.scene.clearColor = new Color4(0.015, 0.02, 0.035, 1);
    this.background = new Background(this.scene);

    this.cameraRig = new TransformNode("camera-rig", this.scene);
    this.cameraRig.position = CAMERA_RIG_POSITION.clone();
    const camera = new FreeCamera("camera", Vector3.Zero(), this.scene);
    camera.parent = this.cameraRig;
    camera.rotation.x = CAMERA_PITCH;
    camera.fov = CAMERA_FOV;
    camera.minZ = 0.1;
    camera.maxZ = 80;
    camera.inputs.clear();
    this.scene.attachControl();

    this.createLights();
    // Nur die Rahmen gültiger Ziele bekommen Bloom, alles andere bleibt scharf.
    this.glow = new GlowLayer("glow", this.scene, { blurKernelSize: 48 });
    this.glow.intensity = 0.7;

    this.createBoard(board);

    this.scene.onBeforeRenderObservable.add(() => this.updateCameraParallax());
    window.addEventListener("resize", () => this.engine.resize());
    this.engine.runRenderLoop(() => this.scene.render());
  }

  /** Das Lane-Gitter lenkt nur ab, solange nichts platziert wird. */
  setGridVisible(value: boolean): void {
    for (const pad of this.pads) pad.setGridVisible(value);
    for (const label of this.laneLabels) label.visible = value;
  }

  padAt(x: number, y: number): SlotPad | null {
    const hit = this.scene.pick(x, y, (mesh) => mesh.metadata?.pad !== undefined);
    return hit.pickedMesh ? (hit.pickedMesh.metadata.pad as SlotPad) : null;
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

  private createBoard(board: Board): void {
    const boardRoot = new TransformNode("board", this.scene);
    boardRoot.position.z = BOARD_Z;
    const materials = createPadMaterials(this.scene);

    for (const lane of board.lanes) {
      const laneRoot = new TransformNode(`lane-${lane.side}-${lane.type}`, this.scene);
      laneRoot.parent = boardRoot;
      laneRoot.position.x = LANE_X[lane.side][lane.type];
      this.laneLabels.push(new LaneLabel(this.scene, laneRoot, lane.type.toUpperCase(), LABEL_COLORS[lane.side]));

      const facing = lane.side === "player" ? 1 : -1;
      const pads = lane.slots.map(
        (slot) => new SlotPad(this.scene, laneRoot, slot, new Vector3(0, 0, SLOT_Z[slot.index]!), facing, materials),
      );
      for (const pad of pads) this.glow.addIncludedOnlyMesh(pad.validGlow);
      this.pads.push(...pads);
      this.padsByLane.set(lane, pads);
    }
  }

  private updateCameraParallax(): void {
    const width = this.engine.getRenderWidth();
    const height = this.engine.getRenderHeight();
    if (width === 0 || height === 0) return;
    const ratioX = Math.min(Math.max(this.scene.pointerX / width, 0), 1) - 0.5;
    const ratioY = Math.min(Math.max(this.scene.pointerY / height, 0), 1) - 0.5;
    const targetX = -ratioX * MAX_SCROLL_OFFSET.x * 2;
    const targetY = ratioY * MAX_SCROLL_OFFSET.y * 2;

    const t = Math.min((this.engine.getDeltaTime() / 1000) * FOLLOW_SPEED, 1);
    this.scrollOffset.x += (targetX - this.scrollOffset.x) * t;
    this.scrollOffset.y += (targetY - this.scrollOffset.y) * t;
    this.cameraRig.position.x = CAMERA_RIG_POSITION.x + this.scrollOffset.x;
    this.cameraRig.position.y = CAMERA_RIG_POSITION.y + this.scrollOffset.y;
    this.background.setScrollOffset(
      -this.scrollOffset.x * BACKGROUND_SCROLL_STRENGTH.x,
      -this.scrollOffset.y * BACKGROUND_SCROLL_STRENGTH.y,
    );
  }
}
