import { describe, expect, test } from "bun:test";
import { Board, type LaneType, type Side, type Slot } from "../../shared/board.ts";
import { commandById, shipById, type CommandId, type ShipId } from "../../shared/cards.ts";
import type { RoundEvent } from "../../shared/protocol.ts";
import { resolveCleanup, resolveCombat, resolveEffects, type Commander, type PlayedCommand } from "./resolution.ts";

function place(board: Board, side: Side, lane: LaneType, slotIndex: number, id: ShipId): Slot {
  return board.place(board.lane(side, lane), slotIndex, shipById(id))!;
}

const hp = (id: ShipId) => shipById(id).hp;

function commander(side: Side): Commander {
  return { side, drawExtra: () => ({ ships: 1, commands: 1 }) };
}

function play(side: Side, id: CommandId, target: Slot | null = null, destination: Slot | null = null): PlayedCommand {
  return { commander: commander(side), card: commandById(id), target, destination };
}

function round(board: Board, commands: PlayedCommand[] = []): RoundEvent[] {
  const events: RoundEvent[] = [];
  resolveEffects(board, commands, events);
  resolveCombat(board, events);
  resolveCleanup(board, events);
  return events;
}

describe("Combat", () => {
  test("alle Schiffe feuern gleichzeitig, auch ein im selben Kampf zerstörtes", () => {
    const board = new Board();
    const interceptor = place(board, "player", "strike", 0, "void_interceptor");
    const enemy = place(board, "enemy", "strike", 0, "void_interceptor");
    interceptor.hp = 3;
    enemy.hp = 3;
    const events = round(board);
    expect(interceptor.isOccupied).toBe(false);
    expect(enemy.isOccupied).toBe(false);
    expect(events.filter((event) => event.kind === "destroyed")).toHaveLength(2);
  });

  test("eigene Schüsse überspringen ein Ziel, das ein eigener Schuss schon zerstört hat", () => {
    const board = new Board();
    place(board, "player", "strike", 0, "void_interceptor");
    place(board, "player", "strike", 1, "void_interceptor");
    place(board, "player", "strike", 2, "void_interceptor");
    const weak = place(board, "enemy", "strike", 0, "horizon_cruiser");
    const other = place(board, "enemy", "strike", 3, "horizon_cruiser");
    weak.hp = 3;
    const targets = round(board)
      .filter((event) => event.kind === "attack")
      .filter((event) => event.attacker.side === "player")
      .map((event) => event.target.slotIndex);
    expect(targets).toEqual([0, 3, 3]);
    expect(weak.isOccupied).toBe(false);
    expect(other.hp).toBe(hp("horizon_cruiser") - 6);
  });

  test("übrige Schüsse verfallen, wenn kein Ziel mehr steht; die Deckung hält die Runde über", () => {
    const board = new Board();
    place(board, "player", "strike", 0, "void_interceptor");
    place(board, "player", "strike", 1, "void_interceptor");
    const front = place(board, "enemy", "strike", 0, "horizon_cruiser");
    const back = place(board, "enemy", "command", 0, "signal_booster");
    front.hp = 3;
    const shots = round(board)
      .filter((event) => event.kind === "attack")
      .filter((event) => event.attacker.side === "player");
    expect(shots).toHaveLength(1);
    expect(front.isOccupied).toBe(false);
    expect(back.hp).toBe(hp("signal_booster"));
  });

  test("ein im selben Kampf zerstörtes Schiff feuert noch, weil die Seiten gleichzeitig schießen", () => {
    const board = new Board();
    place(board, "player", "strike", 0, "void_interceptor");
    place(board, "player", "strike", 1, "void_interceptor");
    const enemy = place(board, "enemy", "strike", 0, "void_interceptor");
    const victim = place(board, "player", "strike", 2, "horizon_cruiser");
    victim.hp = 3;
    enemy.hp = 3;
    round(board);
    expect(enemy.isOccupied).toBe(false);
    expect(victim.isOccupied).toBe(false);
  });

  test("Schüsse wechseln sich zwischen den Seiten ab", () => {
    const board = new Board();
    place(board, "player", "strike", 0, "horizon_cruiser");
    place(board, "player", "strike", 1, "horizon_cruiser");
    place(board, "player", "strike", 2, "horizon_cruiser");
    place(board, "enemy", "strike", 0, "titan_carrier");
    place(board, "enemy", "strike", 1, "titan_carrier");
    const sides = round(board).flatMap((event) => (event.kind === "attack" ? [event.attacker.side] : []));
    expect(sides).toEqual(["player", "enemy", "player", "enemy", "player"]);
  });

  test("ein Command-Schiff ist nur gedeckt, wenn im Strike-Slot davor ein Schiff steht", () => {
    const board = new Board();
    place(board, "player", "strike", 0, "horizon_cruiser");
    const front = place(board, "enemy", "strike", 3, "titan_carrier");
    const covered = place(board, "enemy", "command", 3, "signal_booster");
    const exposed = place(board, "enemy", "command", 0, "signal_booster");
    round(board);
    expect(exposed.hp).toBe(hp("signal_booster") - 2);
    expect(covered.hp).toBe(hp("signal_booster"));
    expect(front.hp).toBe(hp("titan_carrier"));
  });

  test("Jäger nimmt das niedrigste HP, Schlachtschiff das höchste ATK, Kreuzer das nächstgelegene", () => {
    const board = new Board();
    place(board, "player", "command", 0, "void_interceptor");
    place(board, "player", "command", 1, "iron_dreadnought");
    place(board, "player", "command", 4, "horizon_cruiser");
    const weak = place(board, "enemy", "strike", 0, "signal_booster");
    const strong = place(board, "enemy", "strike", 2, "plasma_frigate");
    const tough = place(board, "enemy", "strike", 5, "titan_carrier");
    weak.hp = 3;
    const attacks = round(board)
      .filter((event) => event.kind === "attack")
      .filter((event) => event.attacker.side === "player");
    expect(attacks.map((event) => [event.attacker.cardId, event.target.cardId])).toEqual([
      ["void_interceptor", "signal_booster"],
      ["iron_dreadnought", "plasma_frigate"],
      ["horizon_cruiser", "titan_carrier"],
    ]);
    expect(weak.isOccupied).toBe(false);
    expect(strong.hp).toBe(hp("plasma_frigate") - 2);
    expect(tough.hp).toBe(hp("titan_carrier") - 2);
  });

  test("Jeder Schuss wird mit den Werten des Ziels danach gemeldet", () => {
    const board = new Board();
    place(board, "player", "strike", 0, "horizon_cruiser");
    place(board, "player", "strike", 1, "horizon_cruiser");
    place(board, "enemy", "strike", 0, "iron_dreadnought");
    const shots = round(board)
      .filter((event) => event.kind === "attack")
      .filter((event) => event.attacker.side === "player");
    expect(shots.map((event) => [event.amount, event.after])).toEqual([
      [2, { hp: hp("iron_dreadnought"), shield: 0 }],
      [2, { hp: hp("iron_dreadnought") - 2, shield: 0 }],
    ]);
  });

  test("Schild fängt Schaden zuerst ab und regeneriert nicht", () => {
    const board = new Board();
    place(board, "player", "strike", 0, "plasma_frigate");
    const dreadnought = place(board, "enemy", "strike", 0, "iron_dreadnought");
    round(board);
    expect([dreadnought.shield, dreadnought.hp]).toEqual([0, hp("iron_dreadnought") - 1]);
  });

  test("Support greift nicht an", () => {
    const board = new Board();
    place(board, "player", "strike", 0, "signal_booster");
    const enemy = place(board, "enemy", "strike", 0, "signal_booster");
    expect(round(board).some((event) => event.kind === "attack")).toBe(false);
    expect(enemy.hp).toBe(hp("signal_booster"));
  });
});

describe("Befehle", () => {
  test("Orbital Strike trifft das Schiff mit dem höchsten HP, bevor es feuern kann", () => {
    const board = new Board();
    const own = place(board, "player", "strike", 0, "signal_booster");
    place(board, "enemy", "strike", 0, "void_interceptor").hp = 3;
    const target = place(board, "enemy", "command", 0, "scrap_raider");
    own.hp = 4;
    target.hp = 4;
    round(board, [play("player", "orbital_strike")]);
    expect(target.isOccupied).toBe(false);
    expect(own.hp).toBe(4 - 3);
  });

  test("Emergency Shields fängt Orbital Strike ab, weil Buffs vor Angriffen wirken", () => {
    const board = new Board();
    const own = place(board, "player", "strike", 0, "horizon_cruiser");
    const events: RoundEvent[] = [];
    resolveEffects(board, [play("enemy", "orbital_strike"), play("player", "emergency_shields", own)], events);
    expect([own.hp, own.shield]).toEqual([hp("horizon_cruiser") - (4 - 3), 0]);
    expect(events.map((event) => event.kind)).toEqual(["effect", "effect"]);
  });

  test("Bonus-Schild verfällt im Cleanup, soweit er noch steht", () => {
    const board = new Board();
    const own = place(board, "player", "strike", 0, "iron_dreadnought");
    round(board, [play("player", "emergency_shields", own)]);
    expect([own.shield, own.hp]).toEqual([2, hp("iron_dreadnought")]);
  });

  test("EMP Blast legt das stärkste Schiff lahm, Targeting Jammer senkt die Strike-Lane", () => {
    const board = new Board();
    const frigate = place(board, "enemy", "strike", 0, "plasma_frigate");
    const cruiser = place(board, "enemy", "strike", 1, "horizon_cruiser");
    const own = place(board, "player", "strike", 0, "titan_carrier");
    round(board, [play("player", "emp_blast"), play("player", "targeting_jammer")]);
    expect(own.hp).toBe(hp("titan_carrier") - (2 - 1));
    expect(frigate.disabled).toBe(false);
    expect(cruiser.attack).toBe(2);
  });

  test("Intercept zieht ein Schiff in den gewählten Strike-Slot und gibt +2 ATK", () => {
    const board = new Board();
    const back = place(board, "player", "command", 2, "horizon_cruiser");
    const enemy = place(board, "enemy", "strike", 2, "titan_carrier");
    const events = round(board, [play("player", "intercept", back, board.lane("player", "strike").slots[5]!)]);
    expect(back.isOccupied).toBe(false);
    expect(board.lane("player", "strike").slots[5]!.card?.id).toBe("horizon_cruiser");
    expect(events).toContainEqual(expect.objectContaining({ effect: { type: "move", to: { lane: "strike", slotIndex: 5 } } }));
    expect(enemy.hp).toBe(hp("titan_carrier") - 4);
  });

  test("Recall zieht zurück und heilt; Overcharge kostet nach dem Kampf 2", () => {
    const board = new Board();
    const front = place(board, "player", "strike", 1, "horizon_cruiser");
    front.hp = 2;
    const moved = board.lane("player", "command").slots[4]!;
    round(board, [play("player", "recall", front, moved)]);
    expect(moved.hp).toBe(4);

    round(board, [play("player", "overcharge", moved)]);
    expect(moved.hp).toBe(2);
  });
});

describe("Fähigkeiten", () => {
  test("Signal Booster gibt allen anderen eigenen Schiffen seiner Lane +1 ATK, solange er steht", () => {
    const board = new Board();
    const booster = place(board, "player", "strike", 2, "signal_booster");
    const neighbour = place(board, "player", "strike", 0, "horizon_cruiser");
    const otherLane = place(board, "player", "command", 0, "horizon_cruiser");
    const enemy = place(board, "enemy", "strike", 4, "horizon_cruiser");
    expect([neighbour.attack, otherLane.attack, enemy.attack, booster.attack]).toEqual([3, 2, 2, 0]);
    place(board, "player", "strike", 5, "signal_booster");
    expect(neighbour.attack).toBe(4);
  });

  test("ein im Kampf zerstörter Signal Booster verstärkt die Schüsse dieses Kampfes noch, danach nicht mehr", () => {
    const board = new Board();
    const booster = place(board, "player", "strike", 2, "signal_booster");
    const cruiser = place(board, "player", "strike", 0, "horizon_cruiser");
    const frigate = place(board, "enemy", "strike", 2, "plasma_frigate");
    booster.hp = 3;
    round(board);
    expect(booster.isOccupied).toBe(false);
    expect(frigate.hp).toBe(hp("plasma_frigate") - 3);
    expect(cruiser.attack).toBe(2);
  });

  test("Repair Drone heilt am Rundenende das beschädigte Kampfschiff mit den wenigsten HP", () => {
    const board = new Board();
    const drone = place(board, "player", "command", 0, "repair_drone");
    const scratched = place(board, "player", "command", 1, "iron_dreadnought");
    const weakest = place(board, "player", "command", 2, "horizon_cruiser");
    place(board, "player", "command", 3, "signal_booster").hp = 1;
    drone.hp = 1;
    scratched.hp = 11;
    weakest.hp = 3;
    const events = round(board);
    expect(events.filter((event) => event.kind === "ability")).toHaveLength(1);
    expect([drone.hp, scratched.hp, weakest.hp]).toEqual([1, 11, 5]);
  });

  test("eine im Kampf zerstörte Repair Drone heilt nicht mehr", () => {
    const board = new Board();
    const drone = place(board, "player", "strike", 0, "repair_drone");
    const cruiser = place(board, "player", "command", 1, "horizon_cruiser");
    place(board, "enemy", "strike", 0, "plasma_frigate");
    drone.hp = 3;
    cruiser.hp = 4;
    expect(round(board).some((event) => event.kind === "ability")).toBe(false);
    expect(cruiser.hp).toBe(4);
  });
});
