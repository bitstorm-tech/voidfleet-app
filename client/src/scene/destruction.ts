// Die Zerstörung eines Schiffs in drei Akten: Todeskampf (Zittern, Krängen,
// Sekundärexplosionen aus der Hülle), Detonation (Kern, Druckwellen, Blitzlicht,
// Kamerawackeln) und das Wrack, dessen glühende Bruchstücke auseinanderfliegen,
// brennen, abkühlen und verblassen. Jedes Schiff hat sein eigenes Profil; die
// Bruchstücke kommen aus `<id>_wreck.glb` (tools/ships/wreck.py). Flaggschiffe gehen in der Farbe ihres
// Admirals unter, mit der größten Detonation auf dem Brett.

import { Space } from "@babylonjs/core/Maths/math.axis";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import type { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { ShipId } from "../../../shared/cards.ts";
import { playSound } from "../audio/sounds.ts";
import { color3 } from "../data/palette.ts";
import { type BlastStyle, randomBetween, randomInCone } from "./effects.ts";
import type { MatchScene } from "./matchScene.ts";
import type { ShipView, Wreck } from "./ship.ts";
import { tween } from "./tween.ts";

export interface DestructionProfile {
  /** Farbe der freigesetzten Energie (Reaktor, Antrieb): Kern, Druckwellen, Entladungen. */
  energy: Color3;
  style: BlastStyle;
  /** Größe der Detonation; 1 passt zu einem Jäger. */
  size: number;
  /** Todeskampf vor der Detonation: Dauer in ms und Zahl der Risse, aus denen es dabei herausbricht. */
  agony: number;
  pops: number;
  /** Wucht: Geschwindigkeit der Trümmer in Welteinheiten pro Sekunde und Kamerawackeln in Welteinheiten. */
  force: number;
  shake: number;
  /** Wie lange die Trümmer sichtbar bleiben (ms), bevor sie verblassen. */
  linger: number;
}

const FIGHTER_ENERGY = new Color3(1, 0.45, 0.15);
const CRUISER_ENERGY = new Color3(0.3, 0.6, 1);
const PLASMA = new Color3(0.6, 0.3, 1);
const SUPPORT_ENERGY = new Color3(0.3, 1, 0.6);
const CYAN = new Color3(0.2, 0.9, 1);

export const PROFILES: Record<ShipId, DestructionProfile> = {
  /** Jäger: zu klein für einen langen Todeskampf, ein einziger scharfer Knall reißt ihn auseinander. */
  void_interceptor: { energy: FIGHTER_ENERGY, style: "fire", size: 0.9, agony: 350, pops: 1, force: 5, shake: 0.12, linger: 1400 },
  /** Träger-Drohne: verpufft fast ohne Todeskampf in einem kleinen Knall. */
  drone: { energy: FIGHTER_ENERGY, style: "fire", size: 0.6, agony: 200, pops: 0, force: 5, shake: 0.06, linger: 1000 },
  /** Schrott: fällt schon vor der Detonation an mehreren Stellen auseinander. */
  scrap_raider: { energy: FIGHTER_ENERGY, style: "fire", size: 1, agony: 650, pops: 3, force: 4, shake: 0.14, linger: 1600 },
  /** Kreuzer: eine Kette von Explosionen läuft den Rumpf entlang, dann bricht er in Sektionen. */
  horizon_cruiser: { energy: CRUISER_ENERGY, style: "fire", size: 1.4, agony: 1000, pops: 4, force: 3.5, shake: 0.22, linger: 2000 },
  /** Plasmafregatte: die Kondensatoren entladen sich, der Reaktor geht in einem violetten Blitz hoch. */
  plasma_frigate: { energy: PLASMA, style: "energy", size: 1.5, agony: 800, pops: 3, force: 4.5, shake: 0.25, linger: 1800 },
  /** Schlachtschiff: langer Todeskampf, Deck für Deck, dann die größte Detonation auf dem Brett. */
  iron_dreadnought: { energy: CRUISER_ENERGY, style: "fire", size: 2, agony: 1600, pops: 7, force: 3, shake: 0.4, linger: 2600 },
  /** Träger: Hangars und Flugdeck brennen, dann reißt der Kern im Bug alles mit. */
  titan_carrier: { energy: PLASMA, style: "energy", size: 2, agony: 1500, pops: 6, force: 3, shake: 0.38, linger: 2600 },
  /** Drohne: kleiner Knall, die Arme und Kapseln fliegen davon. */
  repair_drone: { energy: SUPPORT_ENERGY, style: "fire", size: 0.9, agony: 450, pops: 2, force: 4, shake: 0.1, linger: 1400 },
  /** Relais: die Sender entladen sich in Blitzen, die Schüssel segelt davon. */
  signal_booster: { energy: CYAN, style: "energy", size: 1, agony: 500, pops: 2, force: 4, shake: 0.12, linger: 1500 },
  /** Trugbild: Das Hologramm zersplittert ohne Todeskampf in einem kurzen Lichtblitz. */
  decoy: { energy: color3("moreau"), style: "energy", size: 0.8, agony: 150, pops: 0, force: 4.5, shake: 0.05, linger: 900 },
  /** Bastion: Panzerdeck um Panzerdeck bricht auf, bis der Kern die Festung zerreißt. */
  bastion: { energy: color3("osei"), style: "fire", size: 2.6, agony: 2100, pops: 9, force: 3, shake: 0.6, linger: 3200 },
  /** Vanguard: Die Speerspitze bricht in einer Kette von Explosionen vom Bug zum Heck. */
  vanguard: { energy: color3("vance"), style: "fire", size: 2.3, agony: 1700, pops: 8, force: 3.5, shake: 0.5, linger: 2900 },
  /** Hive: Die Brutkammern platzen eine nach der anderen, dann geht der Kern violett hoch. */
  hive: { energy: color3("halvorsen"), style: "energy", size: 2.5, agony: 1900, pops: 9, force: 3, shake: 0.55, linger: 3100 },
  /** Mirage: Der Phasenantrieb flackert, dann zerreißt ihn eine Entladung. */
  mirage: { energy: color3("moreau"), style: "energy", size: 2.1, agony: 1300, pops: 6, force: 4.5, shake: 0.45, linger: 2500 },
  /** Pendulum: Die Railgun entlädt sich ein letztes Mal in den eigenen Rumpf. */
  pendulum: { energy: color3("kerr"), style: "energy", size: 2.6, agony: 2000, pops: 9, force: 3, shake: 0.6, linger: 3200 },
};

/** Sekundärexplosionen und Nachexplosionen sind kleiner als die Detonation; die Hülle blitzt dabei nur leicht. */
const POP_SIZE = 0.9;
const POP_FLASH = 0.2;
/** Ausblenden der Trümmer am Ende (ms). */
const FADE = 700;
/** Trümmer: Sinken (Welteinheiten/s²) und Abbremsen (Anteil pro Sekunde), damit sie lesbar bleiben. */
const GRAVITY = 1.1;
const DRAG = 0.45;
/** Sekunden, bis die Bruchkanten dunkel sind und bis Düsen und Fenster erloschen sind. */
const COOL_TIME = 1.6;
const LIGHTS_OUT = 1.1;
/** Glühen der Bruchkanten: weißglühend beim Aufbrechen, dann orange, zuletzt dunkelrot. */
const WHITE_HOT = new Color3(1, 0.72, 0.4);
const COLD = new Color3(0.7, 0.06, 0);
/** Die ganze Hülle wird vom Feuerball angestrahlt (Overlay) und verliert das Licht in dieser Zeit (s). */
const GLARE = new Color3(1, 0.6, 0.3);
const GLARE_TIME = 0.5;
/** Zum Schluss verdunkeln die Stücke (Overlay) und schrumpfen; Alpha-Mischung würde Flammen vor ihnen verdecken. */
const DARK = Color3.Black();
const SHRINK = 0.6;

/** Ein fliegendes Bruchstück: Geschwindigkeit im Raum des Wracks, Taumelachse und Drehrate (rad/s). */
interface Body {
  piece: TransformNode;
  velocity: Vector3;
  axis: Vector3;
  spin: number;
  /** Größte Ausdehnung in Welteinheiten; große Stücke brennen und fliegen langsamer. */
  extent: number;
}

/**
 * Spielt die Zerstörung ab. Endet, sobald die Detonation ihre Wucht entfaltet
 * hat; die Trümmer fliegen und brennen für sich weiter und entsorgen das Schiff am Ende.
 */
export async function destroyShip(ship: ShipView, view: MatchScene): Promise<void> {
  const profile = PROFILES[ship.card.id];
  ship.hideStatus();
  await agony(ship, profile, view);
  const center = ship.center;
  const wreck = ship.breakApart();
  view.shake(profile.shake);
  void scatter(wreck, center, profile, ship, view);
  await view.effects.detonate(center, profile.energy, profile.size, profile.style);
}

/**
 * Todeskampf: das Schiff zittert und krängt, dabei brechen Risse in der Hülle auf, gegen Ende immer dichter.
 * Die Hülle ächzt umso lauter, je länger der Todeskampf dauert; die Detonation schneidet es ab.
 */
async function agony(ship: ShipView, profile: DestructionProfile, view: MatchScene): Promise<void> {
  const center = ship.center;
  const groan = playSound("hull_stress", { at: center, volume: Math.min(profile.agony / 1600, 1) });
  const points = ship.surfacePoints(profile.pops);
  const schedule = points.map(() => 0.12 + 0.8 * Math.random() ** 0.7).sort((a, b) => a - b);
  let next = 0;
  await tween(view.scene, profile.agony, (progress) => {
    ship.distress(progress);
    while (next < schedule.length && schedule[next]! <= progress) {
      const point = points[next++]!;
      view.effects.pop(point, point.subtract(center).normalize(), POP_SIZE * profile.size ** 0.75);
      view.shake(profile.shake * 0.25);
      void ship.flash(POP_FLASH);
    }
  });
  groan.stop(0.3);
}

/**
 * Die Bruchstücke fliegen radial auseinander und taumeln, die größten brennen und
 * explodieren nach; Bruchkanten kühlen ab, Lichter erlöschen, zuletzt verblasst alles.
 */
async function scatter(wreck: Wreck, center: Vector3, profile: DestructionProfile, ship: ShipView, view: MatchScene): Promise<void> {
  const { pieces, materials } = wreck;
  const cuts = materials.filter((material) => material.name.endsWith("_wreck"));
  // Die Kennzeichen der Flaggschiffe (`<id>_signal`) leuchten nur mit Stärke 1, erlöschen aber wie Lichter.
  const lights = materials.filter((material) => !cuts.includes(material) && (material.emissiveIntensity > 1 || material.name.endsWith("_signal")));
  const brightness = new Map(lights.map((material) => [material, material.emissiveIntensity]));

  const bodies = launch(pieces, center, profile);
  const burning = [...bodies].sort((a, b) => b.extent - a.extent).slice(0, Math.ceil(profile.size * 1.5));
  for (const body of burning) view.effects.burn(body.piece, 0.3 + 0.3 * body.extent, body.extent * 0.35, profile.linger);
  const aftershocks = burning.slice(0, Math.round(profile.size)).map((body) => ({ body, at: randomBetween([0.2, 0.7]) * (profile.linger / 1000) }));
  const meshes = pieces.flatMap((piece) => [piece, ...piece.getChildMeshes()]).filter((node) => node instanceof Mesh);
  for (const mesh of meshes) {
    mesh.renderOverlay = true;
    mesh.overlayColor = GLARE;
  }

  const total = profile.linger + FADE;
  let last = 0;
  await tween(view.scene, total, (progress) => {
    const t = (progress * total) / 1000;
    const dt = ((progress - last) * total) / 1000;
    last = progress;
    for (const body of bodies) {
      body.velocity.y -= GRAVITY * dt;
      body.velocity.scaleInPlace(Math.exp(-DRAG * dt));
      body.piece.position.addInPlace(body.velocity.scale(dt));
      body.piece.rotate(body.axis, body.spin * dt, Space.LOCAL);
    }
    for (const shock of aftershocks) {
      if (shock.at > t) continue;
      shock.at = Infinity;
      view.effects.pop(shock.body.piece.getAbsolutePosition(), randomInCone(Vector3.Up(), Math.PI), POP_SIZE * 0.8 * profile.size ** 0.75);
      view.shake(profile.shake * 0.3);
    }
    const heat = Math.max(0, 1 - t / COOL_TIME);
    for (const cut of cuts) {
      cut.emissiveIntensity = 0.4 + 10 * heat ** 3;
      Color3.LerpToRef(COLD, WHITE_HOT, heat ** 2, cut.emissiveColor);
    }
    const power = Math.max(0, 1 - t / LIGHTS_OUT);
    for (const light of lights) light.emissiveIntensity = brightness.get(light)! * power * (0.5 + 0.5 * Math.random());
    const glare = Math.max(0, 1 - t / GLARE_TIME) ** 2;
    const fade = Math.min(Math.max((t - profile.linger / 1000) / (FADE / 1000), 0), 1);
    for (const mesh of meshes) {
      mesh.overlayColor = fade > 0 ? DARK : GLARE;
      mesh.overlayAlpha = fade > 0 ? fade : 0.75 * glare;
      mesh.renderOverlay = fade > 0 || glare > 0;
    }
    if (fade > 0) for (const piece of pieces) piece.scaling.setAll(1 - SHRINK * fade);
  });
  ship.dispose();
}

/** Flugbahnen: radial vom Explosionsherd, kleine Stücke schneller, jedes mit eigenem Taumeln. */
function launch(pieces: TransformNode[], center: Vector3, profile: DestructionProfile): Body[] {
  const root = pieces[0]!.parent!;
  root.computeWorldMatrix(true);
  // Geschwindigkeiten gelten in Welteinheiten, die Stücke bewegen sich aber im (skalierten) Raum des Wracks.
  const worldPerLocal = Vector3.TransformNormal(Vector3.Right(), root.getWorldMatrix()).length();
  const origin = Vector3.TransformCoordinates(center, root.getWorldMatrix().clone().invert());
  // Etwas neben der Mitte, damit das Wrack nicht symmetrisch auseinanderfällt.
  origin.addInPlace(randomInCone(Vector3.Up(), Math.PI).scale(0.6));
  return pieces.map((piece) => {
    const { min, max } = piece.getHierarchyBoundingVectors();
    const extent = max.subtract(min).length();
    const mass = Math.min(Math.max(extent / 0.8, 0.5), 2.5);
    const direction = piece.position.subtract(origin);
    if (direction.length() < 0.01) direction.copyFrom(randomInCone(Vector3.Up(), Math.PI));
    direction.normalize().addInPlace(randomInCone(Vector3.Up(), Math.PI).scale(0.35)).normalize();
    const speed = (profile.force * randomBetween([0.7, 1.3])) / Math.sqrt(mass);
    return {
      piece,
      extent,
      velocity: direction.scale(speed / worldPerLocal),
      axis: randomInCone(Vector3.Up(), Math.PI),
      spin: randomBetween([1.5, 4.5]) / Math.sqrt(mass),
    };
  });
}
