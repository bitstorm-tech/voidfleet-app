// Vorschau der Befehlswirkungen ohne Server: Die echte Rundenwiedergabe (`RoundPlayback`) spielt nacheinander je
// Befehl erfundene Ereignisse auf einem kleinen Brett ab, mit Banner, Log und Schwebetexten, in Dauerschleife; dazu
// Schüsse im Kampf, die die Deckung abfängt oder die verpuffen (`combat`).
// `?card=<id>` zeigt nur die Szenen dieses Befehls (`?card=combat` die Kampfszenen), `?slow=4` bremst die Szene um den
// Faktor, `?lang=de` auf Deutsch.

import { Board, type LaneType, type Side } from "../../shared/board.ts";
import { type CommandId, type ShipId, shipById } from "../../shared/cards.ts";
import type { CommandEffect, RoundEvent, ShipRef } from "../../shared/protocol.ts";
import { loadSounds } from "../src/audio/sounds.ts";
import { color3, installPalette } from "../src/data/palette.ts";
import { RoundPlayback } from "../src/roundPlayback.ts";
import { MatchScene } from "../src/scene/matchScene.ts";
import { loadShipModels, ShipView } from "../src/scene/ship.ts";
import { wait } from "../src/scene/tween.ts";
import { FloatingTexts } from "../src/ui/floatingText.ts";
import { Hud } from "../src/ui/hud.ts";

declare global {
  interface Window {
    view: MatchScene;
    /** Die gerade gespielte Szene und wie viele schon fertig sind, zum Synchronisieren von Screenshot-Serien. */
    scene: string;
    sceneCount: number;
  }
}

installPalette();
const canvas = document.getElementById("render-canvas") as HTMLCanvasElement;
const ui = document.getElementById("ui") as HTMLElement;
const view = new MatchScene(canvas, new Board());
await Promise.all([...loadShipModels(view.scene), ...loadSounds()]);
const params = new URLSearchParams(location.search);
const slow = Number(params.get("slow") ?? 1);
const realDelta = view.engine.getDeltaTime.bind(view.engine);
view.engine.getDeltaTime = () => realDelta() / slow;
const playback = new RoundPlayback(view, new Hud(ui), new FloatingTexts(ui));
window.view = view;

type Placement = [side: Side, lane: LaneType, slotIndex: number, cardId: ShipId];

/** Eine Szene: die Schiffe auf dem Brett und die Ereignisse, die darauf abgespielt werden. */
interface Scene {
  /** Der Befehl der Szene; `combat` für Schüsse im Kampf ohne Befehl. */
  card: CommandId | "combat";
  name: string;
  ships: Placement[];
  /** Vorbereitung nach dem Aufstellen, etwa eine Admiralsmarke, die Funkstille wieder wegnimmt. */
  prepare?: () => Promise<void>;
  events: RoundEvent[];
}

const ref = (side: Side, lane: LaneType, slotIndex: number, cardId: ShipId): ShipRef => ({ side, lane, slotIndex, cardId });
const stats = (cardId: ShipId, damage = 0, shield = 0) => {
  const card = shipById(cardId);
  return { hp: card.hp - damage, shield: card.shield + shield };
};
function effect(side: Side, card: CommandId, ship: ShipRef, value: CommandEffect, after = stats(ship.cardId)): RoundEvent {
  return { kind: "effect", side, cardId: card, ship, effect: value, after };
}

const FLEET: Placement[] = [
  ["player", "strike", 2, "void_interceptor"],
  ["player", "strike", 3, "horizon_cruiser"],
  ["player", "command", 3, "repair_drone"],
  ["enemy", "strike", 2, "scrap_raider"],
  ["enemy", "strike", 3, "iron_dreadnought"],
  ["enemy", "command", 3, "titan_carrier"],
  ["enemy", "command", 1, "plasma_frigate"],
];

const P_STRIKE_2 = ref("player", "strike", 2, "void_interceptor");
const P_STRIKE_3 = ref("player", "strike", 3, "horizon_cruiser");
const P_COMMAND_3 = ref("player", "command", 3, "repair_drone");
const E_STRIKE_2 = ref("enemy", "strike", 2, "scrap_raider");
const E_STRIKE_3 = ref("enemy", "strike", 3, "iron_dreadnought");
const E_COMMAND_3 = ref("enemy", "command", 3, "titan_carrier");
const E_COMMAND_1 = ref("enemy", "command", 1, "plasma_frigate");

const SCENES: Scene[] = [
  {
    card: "evasive_action",
    name: "Ausweichmanöver",
    ships: FLEET,
    events: [
      effect("player", "evasive_action", P_STRIKE_2, { type: "move", to: { lane: "strike", slotIndex: 0 } }),
      effect("player", "evasive_action", ref("player", "strike", 0, "void_interceptor"), { type: "shield", amount: 2 }, stats("void_interceptor", 0, 2)),
    ],
  },
  {
    card: "micro_jump",
    name: "Kurzsprung",
    ships: FLEET,
    events: [
      effect("player", "micro_jump", P_STRIKE_3, { type: "jump" }),
      { kind: "attack", attacker: E_STRIKE_3, target: P_STRIKE_2, amount: 3, after: stats("void_interceptor", 3) },
      { kind: "return", ship: P_STRIKE_3, after: stats("horizon_cruiser") },
    ],
  },
  { card: "rapid_deployment", name: "Schnellverlegung", ships: FLEET, events: [{ kind: "rule", side: "player", cardId: "rapid_deployment" }] },
  { card: "carte_blanche", name: "Freie Hand", ships: FLEET, events: [{ kind: "rule", side: "enemy", cardId: "carte_blanche" }] },
  { card: "draw_fire", name: "Ablenkung", ships: FLEET, events: [effect("player", "draw_fire", P_STRIKE_3, { type: "taunt" })] },
  {
    card: "draw_fire",
    name: "Ablenkung im Kampf",
    ships: FLEET,
    events: [
      effect("player", "draw_fire", P_STRIKE_3, { type: "taunt" }),
      { kind: "attack", attacker: E_STRIKE_2, target: P_STRIKE_3, amount: 2, after: stats("horizon_cruiser", 2), taunt: true },
      { kind: "attack", attacker: E_COMMAND_3, target: P_STRIKE_3, amount: 1, after: stats("horizon_cruiser", 3), taunt: true },
    ],
  },
  {
    card: "combat",
    name: "Schiffsfeuer verpufft an der Deckung",
    ships: FLEET,
    events: [
      { kind: "fizzle", attacker: P_STRIKE_2, target: E_COMMAND_3, covered: true },
      { kind: "fizzle", attacker: E_STRIKE_2, target: P_COMMAND_3, covered: true },
    ],
  },
  {
    card: "combat",
    name: "Spaltenfeuer geht durch",
    ships: FLEET,
    prepare: async () => view.pad("enemy", "strike", 3).ship!.setStats(3, 0),
    events: [
      { kind: "attack", attacker: P_STRIKE_2, target: E_STRIKE_3, amount: 3, after: { hp: 0, shield: 0 } },
      { kind: "attack", attacker: P_STRIKE_3, target: E_COMMAND_3, amount: 2, after: stats("titan_carrier", 2), through: true },
      { kind: "destroyed", ship: E_STRIKE_3 },
    ],
  },
  {
    card: "combat",
    name: "Spaltenfeuer verpufft: leere Spalte",
    ships: FLEET,
    events: [
      { kind: "fizzle", attacker: P_STRIKE_3, column: 5 },
      { kind: "fizzle", attacker: E_STRIKE_3, column: 0 },
    ],
  },
  {
    card: "combat",
    name: "Verpufft: schon zerstört",
    ships: FLEET,
    prepare: async () => view.pad("enemy", "strike", 2).ship!.setStats(3, 0),
    events: [
      { kind: "attack", attacker: P_STRIKE_2, target: E_STRIKE_2, amount: 3, after: { hp: 0, shield: 0 } },
      { kind: "attack", attacker: E_STRIKE_3, target: P_STRIKE_2, amount: 2, after: stats("void_interceptor", 2) },
      { kind: "fizzle", attacker: P_STRIKE_3, target: E_STRIKE_2 },
      { kind: "destroyed", ship: E_STRIKE_2 },
    ],
  },
  {
    card: "combat",
    name: "Spaltenfeuer verpufft: Spalte geräumt",
    ships: FLEET,
    prepare: async () => view.pad("enemy", "strike", 2).ship!.setStats(3, 0),
    events: [
      { kind: "attack", attacker: P_STRIKE_2, target: E_STRIKE_2, amount: 3, after: { hp: 0, shield: 0 } },
      { kind: "fizzle", attacker: P_STRIKE_3, column: 2, cleared: true },
      { kind: "destroyed", ship: E_STRIKE_2 },
    ],
  },
  {
    card: "combat",
    name: "Verpufft: Ziel nicht mehr auf dem Brett",
    ships: FLEET,
    events: [
      effect("player", "micro_jump", P_STRIKE_3, { type: "jump" }),
      { kind: "fizzle", attacker: E_STRIKE_3, target: null },
      { kind: "fizzle", attacker: E_COMMAND_3, target: null },
      { kind: "return", ship: P_STRIKE_3, after: stats("horizon_cruiser") },
    ],
  },
  {
    card: "shield_grid",
    name: "Schildgitter",
    ships: FLEET,
    events: [P_STRIKE_2, P_STRIKE_3, P_COMMAND_3].map((ship) => effect("player", "shield_grid", ship, { type: "shield", amount: 1 }, stats(ship.cardId, 0, 1))),
  },
  {
    card: "ablative_armor",
    name: "Ablativpanzerung",
    ships: FLEET,
    events: [effect("player", "ablative_armor", P_STRIKE_3, { type: "shield", amount: 2, permanent: true }, stats("horizon_cruiser", 0, 2))],
  },
  {
    card: "covering_fire",
    name: "Feuerschutz",
    ships: FLEET,
    events: [P_STRIKE_3, P_COMMAND_3].flatMap((ship) => [
      effect("player", "covering_fire", ship, { type: "attack", delta: 1 }),
      effect("player", "covering_fire", ship, { type: "shield", amount: 1 }, stats(ship.cardId, 0, 1)),
    ]),
  },
  {
    card: "drone_squadron",
    name: "Drohnenstaffel",
    ships: FLEET,
    events: [ref("player", "command", 2, "drone"), ref("player", "command", 4, "drone")].map((ship) =>
      effect("player", "drone_squadron", ship, { type: "spawn" }),
    ),
  },
  {
    card: "collision_course",
    name: "Rammkurs",
    ships: FLEET,
    events: [
      effect(
        "player",
        "collision_course",
        P_STRIKE_3,
        { type: "ram", target: E_STRIKE_3, dealt: 5, taken: 3, targetAfter: stats("iron_dreadnought", 5) },
        stats("horizon_cruiser", 3),
      ),
    ],
  },
  {
    card: "collision_course",
    name: "Rammkurs, Rammer fällt",
    ships: FLEET,
    events: [
      effect(
        "enemy",
        "collision_course",
        E_STRIKE_2,
        { type: "ram", target: P_STRIKE_2, dealt: 3, taken: 9, targetAfter: stats("void_interceptor", 3) },
        { hp: 0, shield: 0 },
      ),
      { kind: "destroyed", ship: E_STRIKE_2 },
    ],
  },
  {
    card: "countermeasures",
    name: "Gegenmaßnahmen",
    ships: FLEET,
    events: [{ kind: "countered", side: "player", cardId: "countermeasures", countered: "torpedo" }],
  },
  {
    card: "countermeasures",
    name: "Gegenmaßnahmen ohne Angriff",
    ships: FLEET,
    events: [{ kind: "draw", side: "enemy", cardId: "countermeasures", ships: 0, commands: 1 }],
  },
  {
    card: "radio_silence",
    name: "Funkstille",
    ships: FLEET,
    prepare: () => view.pad("enemy", "strike", 3).ship!.addMarker({ kind: "focus_fire", color: color3("vance") }),
    events: [effect("player", "radio_silence", E_STRIKE_3, { type: "jam", power: "focus_fire" })],
  },
  {
    card: "radio_silence",
    name: "Funkstille gegen das Trugbild",
    ships: [...FLEET, ["enemy", "strike", 0, "decoy"]],
    events: [effect("player", "radio_silence", ref("enemy", "strike", 0, "decoy"), { type: "jam", power: "decoy" })],
  },
  {
    card: "minefield",
    name: "Minenfeld",
    ships: FLEET,
    events: [E_STRIKE_2, E_COMMAND_3].map((ship) => effect("player", "minefield", ship, { type: "damage", amount: 3 }, stats(ship.cardId, 3))),
  },
  {
    card: "tractor_beam",
    name: "Traktorstrahl",
    ships: FLEET,
    events: [effect("player", "tractor_beam", E_STRIKE_2, { type: "move", to: { lane: "strike", slotIndex: 5 } })],
  },
  {
    card: "heat_seeker",
    name: "Wärmesucher",
    ships: FLEET,
    events: [effect("player", "heat_seeker", E_COMMAND_1, { type: "damage", amount: 5 }, stats("plasma_frigate", 5))],
  },
  {
    card: "heat_seeker",
    name: "Wärmesucher des Gegners",
    ships: FLEET,
    events: [effect("enemy", "heat_seeker", P_COMMAND_3, { type: "damage", amount: 3 }, stats("repair_drone", 3))],
  },
  {
    card: "coup_de_grace",
    name: "Gnadenstoß",
    ships: FLEET,
    events: [effect("player", "coup_de_grace", E_STRIKE_2, { type: "damage", amount: 4 }, stats("scrap_raider", 4))],
  },
  {
    card: "piercing_shot",
    name: "Durchschlag",
    ships: FLEET,
    events: [
      effect("player", "piercing_shot", E_STRIKE_3, { type: "damage", amount: 3 }, stats("iron_dreadnought", 3)),
      effect("player", "piercing_shot", E_COMMAND_3, { type: "damage", amount: 2 }, stats("titan_carrier", 2)),
    ],
  },
  {
    card: "piercing_shot",
    name: "Durchschlag ins Leere",
    ships: FLEET,
    events: [
      { kind: "miss", side: "player", cardId: "piercing_shot", target: { side: "enemy", lane: "strike", slotIndex: 1 } },
      effect("player", "piercing_shot", E_COMMAND_1, { type: "damage", amount: 2 }, stats("plasma_frigate", 2)),
    ],
  },
  {
    card: "bombardment",
    name: "Bombardement",
    ships: FLEET,
    events: [E_COMMAND_1, E_COMMAND_3].map((ship) => effect("player", "bombardment", ship, { type: "damage", amount: 2 }, stats(ship.cardId, 2))),
  },
  {
    card: "crossfire",
    name: "Kreuzfeuer",
    ships: FLEET,
    events: [E_STRIKE_2, E_COMMAND_1].map((ship) => effect("player", "crossfire", ship, { type: "damage", amount: 3 }, stats(ship.cardId, 3))),
  },
];

const only = params.get("card");
const scenes = only ? SCENES.filter((scene) => scene.card === only) : SCENES;
window.sceneCount = 0;
for (let round = 1; ; round++) {
  for (const scene of scenes) {
    window.scene = scene.name;
    for (const pad of view.pads) pad.clearShip();
    for (const [side, lane, slotIndex, cardId] of scene.ships) view.pad(side, lane, slotIndex).attachShip(new ShipView(view.scene, shipById(cardId), false));
    await scene.prepare?.();
    await wait(view.scene, 600);
    await playback.play(round, scene.events);
    window.sceneCount++;
    await wait(view.scene, 1200);
  }
}
