// Flugbahn eines Lane-Wechsels. Schiffe fliegen nur vorwärts und stehen vorher
// wie nachher mit der Nase zum Gegner: Nach vorn (Command → Strike) schwenken sie
// in einer S-Kurve in den neuen Slot, nach hinten (Strike → Command) fliegen sie
// eine Schleife — erst vom Ziel weg nach außen herum, dann von hinten in den Slot.
// Innerhalb der Lane versetzen sie seitlich, mit der Nase nach vorn und Schräglage in
// Flugrichtung.
// Gerechnet wird im Raum des Ziel-Ankers: x seitlich, z nach vorn, Ziel im Ursprung.
// Wie wendig ein Schiff ist, legt seine Klasse fest: Jäger fliegen schnell, eng und
// mit starker Schräglage, Schlachtschiffe beschleunigen träge und ziehen weite Bögen. Ein vom Traktorstrahl
// gezogenes Schiff (`towed`) gleitet langsamer, flacher und fast ohne Schräglage.

import { Tools } from "@babylonjs/core/Misc/tools";
import type { ShipClass } from "../../../shared/cards.ts";

interface Handling {
  /** Reisegeschwindigkeit in Welteinheiten pro Sekunde. */
  speed: number;
  /** Wenderadius der Schleife. */
  turnRadius: number;
  /** Anteil der Flugzeit, der jeweils auf Beschleunigen und Abbremsen entfällt. */
  acceleration: number;
  /** Größte Schräglage in Kurven. */
  bank: number;
}

const HANDLING: Record<ShipClass, Handling> = {
  fighter: { speed: 9, turnRadius: 0.9, acceleration: 0.2, bank: Tools.ToRadians(60) },
  support: { speed: 6.5, turnRadius: 1.2, acceleration: 0.28, bank: Tools.ToRadians(32) },
  cruiser: { speed: 5.5, turnRadius: 1.5, acceleration: 0.32, bank: Tools.ToRadians(22) },
  battleship: { speed: 4, turnRadius: 1.7, acceleration: 0.42, bank: Tools.ToRadians(10) },
};

/** Gezogen: Anteile von Tempo, Schräglage und Flughöhe der Klasse, dazu ein gleichmäßigeres Anfahren und Abbremsen. */
const TOWED = { speed: 0.5, bank: 0.2, height: 0.5, acceleration: 0.45 };

/** Die Schleife führt über andere Schiffe hinweg, die S-Kurve steigt je nach Seitenversatz leicht. */
const LOOP_HEIGHT = 1.6;
const SWERVE_HEIGHT_PER_UNIT = 0.25;
const SWERVE_MAX_HEIGHT = 1;
/** Die Wende in den Slot ist enger als die erste, damit die Schleife hinter der Command-Lane im Bild bleibt. */
const FINAL_TURN = 0.7;
/** Schräglage beim seitlichen Versetzen, relativ zur größten Schräglage der Klasse. */
const STRAFE_BANK = 0.6;
/** Bis zu diesem Längsabstand zum Ziel gilt ein Wechsel als innerhalb der Lane. */
const SAME_LANE_TOLERANCE = 0.01;
/** Bézier-Hebel für einen Viertelkreis, relativ zum Radius. */
const QUARTER_CIRCLE = 0.5523;
const SAMPLES_PER_SEGMENT = 48;
/** Die Schräglage folgt der über diese Strecke gemittelten Krümmung, damit sie an Übergängen nicht springt. */
const BANK_SMOOTHING = 0.8;

type Point = [x: number, z: number];

export interface Pose {
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  roll: number;
}

export class Maneuver {
  /** Flugdauer in ms. */
  readonly duration: number;
  private readonly handling: Handling;
  private readonly height: number;
  /** Seitliches Versetzen innerhalb der Lane: -1 nach links, 1 nach rechts, sonst 0. */
  private readonly strafe: number;
  /** Abgetastete Bahn: Punkte, zurückgelegte Strecke, Kurs und geglättete Krümmung je Punkt. */
  private readonly points: Point[] = [];
  private readonly distances: number[] = [];
  private readonly yaws: number[] = [];
  private readonly curvatures: number[] = [];

  constructor(from: { x: number; z: number }, shipClass: ShipClass, towed = false) {
    const handling = HANDLING[shipClass];
    this.handling = towed ? { ...handling, speed: handling.speed * TOWED.speed, bank: handling.bank * TOWED.bank, acceleration: TOWED.acceleration } : handling;
    const start: Point = [from.x, from.z];
    const isSameLane = Math.abs(from.z) < SAME_LANE_TOLERANCE;
    const isLoop = !isSameLane && from.z > 0;
    this.strafe = isSameLane ? -Math.sign(from.x) : 0;
    const segments = isSameLane ? sidestep(start) : isLoop ? loop(start, this.handling.turnRadius) : swerve(start);
    this.height = (isLoop ? LOOP_HEIGHT : Math.min(SWERVE_HEIGHT_PER_UNIT * Math.abs(from.x), SWERVE_MAX_HEIGHT)) * (towed ? TOWED.height : 1);
    this.sample(segments);
    this.duration = (this.length / this.handling.speed / (1 - this.handling.acceleration)) * 1000;
  }

  private get length(): number {
    return this.distances.at(-1)!;
  }

  /** Lage des Schiffs nach dem Anteil `progress` der Flugzeit. */
  pose(progress: number): Pose {
    const { travelled, speed } = this.travel(progress);
    const distance = travelled * this.length;
    const i = this.indexAt(distance);
    const span = this.distances[i + 1]! - this.distances[i]!;
    const f = span > 0 ? (distance - this.distances[i]!) / span : 0;
    const [x0, z0] = this.points[i]!;
    const [x1, z1] = this.points[i + 1]!;
    const yaw = this.strafe !== 0 ? 0 : lerpAngle(this.yaws[i]!, this.yaws[i + 1]!, f);
    const curvature = this.curvatures[i]! + (this.curvatures[i + 1]! - this.curvatures[i]!) * f;

    const phase = (Math.PI * distance) / this.length;
    const y = this.height * Math.sin(phase) ** 2;
    const climb = ((this.height * Math.PI) / this.length) * Math.sin(2 * phase);
    // Schräglage braucht Fahrt: Sie wächst mit Krümmung und Geschwindigkeit; Rechtskurve = rechte Seite runter.
    const turn = this.strafe !== 0 ? STRAFE_BANK * this.strafe : Math.max(-1, Math.min(1, curvature * this.handling.turnRadius));
    return {
      x: x0 + (x1 - x0) * f,
      y,
      z: z0 + (z1 - z0) * f,
      yaw,
      pitch: -Math.atan(climb),
      roll: -this.handling.bank * turn * speed,
    };
  }

  /**
   * Trapez-Profil: beschleunigen, mit Reisegeschwindigkeit fliegen, abbremsen. Liefert die
   * zurückgelegte Strecke (0..1) und die Geschwindigkeit relativ zur Reisegeschwindigkeit.
   */
  private travel(progress: number): { travelled: number; speed: number } {
    const a = this.handling.acceleration;
    const top = 1 / (1 - a);
    if (progress < a) return { travelled: (top * progress ** 2) / (2 * a), speed: progress / a };
    if (progress > 1 - a) return { travelled: 1 - (top * (1 - progress) ** 2) / (2 * a), speed: (1 - progress) / a };
    return { travelled: top * (progress - a / 2), speed: 1 };
  }

  private indexAt(distance: number): number {
    let low = 0;
    let high = this.distances.length - 2;
    while (low < high) {
      const mid = (low + high + 1) >> 1;
      if (this.distances[mid]! <= distance) low = mid;
      else high = mid - 1;
    }
    return low;
  }

  private sample(segments: Point[][]): void {
    for (const [p0, p1, p2, p3] of segments) {
      for (let step = this.points.length === 0 ? 0 : 1; step <= SAMPLES_PER_SEGMENT; step++) {
        this.points.push(bezier(p0!, p1!, p2!, p3!, step / SAMPLES_PER_SEGMENT));
      }
    }
    let travelled = 0;
    for (let i = 0; i < this.points.length; i++) {
      if (i > 0) travelled += distance(this.points[i - 1]!, this.points[i]!);
      this.distances.push(travelled);
    }
    // Kurs aus der Richtung zum Nachbarpunkt; Start und Ziel liegen exakt in Flugrichtung +z.
    for (let i = 0; i < this.points.length; i++) {
      const [ax, az] = this.points[Math.max(i - 1, 0)]!;
      const [bx, bz] = this.points[Math.min(i + 1, this.points.length - 1)]!;
      this.yaws.push(Math.atan2(bx - ax, bz - az));
    }
    this.yaws[0] = 0;
    this.yaws[this.yaws.length - 1] = 0;
    const raw = this.yaws.map((yaw, i) => {
      if (i === 0) return 0;
      const step = this.distances[i]! - this.distances[i - 1]!;
      return step > 0 ? wrapAngle(yaw - this.yaws[i - 1]!) / step : 0;
    });
    // Gleitender Mittelwert der Krümmung über die Strecke.
    for (let i = 0; i < raw.length; i++) {
      let sum = 0;
      let count = 0;
      for (let j = i; j >= 0 && this.distances[i]! - this.distances[j]! <= BANK_SMOOTHING / 2; j--, count++) sum += raw[j]!;
      for (let j = i + 1; j < raw.length && this.distances[j]! - this.distances[i]! <= BANK_SMOOTHING / 2; j++, count++) sum += raw[j]!;
      this.curvatures.push(sum / count);
    }
  }
}

/** Nach vorn: eine S-Kurve, die geradeaus los- und geradeaus ankommt. */
function swerve(start: Point): Point[][] {
  const lever = -start[1] / 2;
  return [[start, [start[0], start[1] + lever], [0, -lever], [0, 0]]];
}

/** Innerhalb der Lane: geradewegs seitlich in den Slot. */
function sidestep(start: Point): Point[][] {
  return [[start, [(start[0] * 2) / 3, 0], [start[0] / 3, 0], [0, 0]]];
}

/**
 * Nach hinten: Halbkreis vom Ziel weg nach außen, zurück hinter die Ziel-Lane und mit einem
 * zweiten Halbkreis von hinten in den Slot. Bei gleicher Slot-Höhe wendet das Schiff zur +x-Seite.
 */
function loop(start: Point, radius: number): Point[][] {
  const [sx, sz] = start;
  const side = Math.sign(sx) || 1;
  const k = QUARTER_CIRCLE * radius;
  const r = FINAL_TURN * radius;
  const kr = QUARTER_CIRCLE * r;
  const apex: Point = [sx + side * radius, sz + radius];
  const turned: Point = [sx + 2 * side * radius, sz];
  const behind: Point = [2 * side * r, 0];
  const bottom: Point = [side * r, -r];
  const lever = distance(turned, behind) * 0.4;
  return [
    [start, [sx, sz + k], [apex[0] - side * k, apex[1]], apex],
    [apex, [apex[0] + side * k, apex[1]], [turned[0], turned[1] + k], turned],
    [turned, [turned[0], turned[1] - lever], [behind[0], behind[1] + lever], behind],
    [behind, [behind[0], -kr], [bottom[0] + side * kr, bottom[1]], bottom],
    [bottom, [bottom[0] - side * kr, bottom[1]], [0, -kr], [0, 0]],
  ];
}

function bezier(p0: Point, p1: Point, p2: Point, p3: Point, t: number): Point {
  const u = 1 - t;
  const a = u ** 3;
  const b = 3 * u ** 2 * t;
  const c = 3 * u * t ** 2;
  const d = t ** 3;
  return [a * p0[0] + b * p1[0] + c * p2[0] + d * p3[0], a * p0[1] + b * p1[1] + c * p2[1] + d * p3[1]];
}

function distance(a: Point, b: Point): number {
  return Math.hypot(b[0] - a[0], b[1] - a[1]);
}

function wrapAngle(angle: number): number {
  return Math.atan2(Math.sin(angle), Math.cos(angle));
}

function lerpAngle(a: number, b: number, f: number): number {
  return a + wrapAngle(b - a) * f;
}
