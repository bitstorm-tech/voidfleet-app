import { describe, expect, test } from "bun:test";
import { Board, overdriveBonus, type LaneType, type Side, type Slot } from "../../shared/board.ts";
import { commandById, shipById, type CommandId, type ShipId } from "../../shared/cards.ts";
import { canMark, railgunFires } from "../../shared/powers.ts";
import type { RoundEvent, SlotTarget } from "../../shared/protocol.ts";
import {
  resolveCleanup,
  resolveCombat,
  resolveDeployAbilities,
  resolveEffects,
  resolveManeuver,
  resolveTurns,
  shipRef,
  type Commander,
  type PlayedCommand,
  type Turn,
} from "../../shared/resolution.ts";

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

/** Eine ganze Runde über `resolveTurns`; eine Seite ohne Angaben passt. */
function resolve(board: Board, player: Partial<Turn> = {}, enemy: Partial<Turn> = {}): RoundEvent[] {
  const turn = (side: Side, parts: Partial<Turn>): Turn => ({ commander: commander(side), ships: [], flagship: null, command: null, maneuver: null, power: null, mark: null, ...parts });
  return resolveTurns(board, [turn("player", player), turn("enemy", enemy)], null);
}

const at = (lane: LaneType, slotIndex: number): SlotTarget => ({ lane, slotIndex });

function attacksBy(events: RoundEvent[], side: Side) {
  return events.flatMap((event) => (event.kind === "attack" && event.attacker.side === side ? [event] : []));
}

describe("Fähigkeiten beim Deploy", () => {
  test("der Titan Carrier setzt eine Drohne in den nächsten freien Slot seiner Lane", () => {
    const board = new Board();
    place(board, "player", "strike", 3, "horizon_cruiser");
    const carrier = place(board, "player", "strike", 2, "titan_carrier");
    const events: RoundEvent[] = [];
    resolveDeployAbilities(board, [carrier], [], Math.random, events);
    expect(board.lane("player", "strike").slots[1]!.state).toEqual({ cardId: "drone", hp: 1, scrapBonus: 0, shield: 0, marked: false });
    expect(events).toEqual([
      {
        kind: "spawn",
        source: { side: "player", lane: "strike", slotIndex: 2, cardId: "titan_carrier" },
        ship: { side: "player", lane: "strike", slotIndex: 1, cardId: "drone" },
      },
    ]);
  });

  test("die Drohne meidet die Ziele der Bewegungen und entfällt nur, wenn kein Slot der Lane frei ist", () => {
    const board = new Board();
    const carrier = place(board, "player", "strike", 2, "titan_carrier");
    const strike = board.lane("player", "strike");
    resolveDeployAbilities(board, [carrier], [strike.slots[1]!, strike.slots[3]!], Math.random, []);
    expect(strike.slots[0]!.card?.id).toBe("drone");

    const full = new Board();
    for (const index of [0, 1, 3]) place(full, "player", "strike", index, "horizon_cruiser");
    place(full, "player", "strike", 4, "drone");
    const second = place(full, "player", "strike", 2, "titan_carrier");
    const events: RoundEvent[] = [];
    resolveDeployAbilities(full, [second], [full.lane("player", "strike").slots[5]!], Math.random, events);
    expect(events).toEqual([]);
  });

  test("die Drohne startet auch in eine Lane mit 4 Schiffen bei voller Flotte und zählt zu keiner Grenze", () => {
    const board = new Board();
    for (const index of [0, 1]) place(board, "player", "command", index, "horizon_cruiser");
    for (const index of [0, 1, 3]) place(board, "player", "strike", index, "horizon_cruiser");
    const carrier = place(board, "player", "strike", 2, "titan_carrier");
    resolveDeployAbilities(board, [carrier], [], Math.random, []);
    const strike = board.lane("player", "strike");
    expect(strike.slots[4]!.card?.id).toBe("drone");
    expect(strike.shipCount).toBe(4);
    expect(board.shipCount("player")).toBe(6);

    const command = board.lane("player", "command");
    command.slots[0]!.clear();
    expect(board.canPlace(strike, 5)).toBe(false);
    strike.slots[0]!.clear();
    expect(board.canPlace(strike, 5)).toBe(true);
    expect(board.canMove(strike.slots[4]!, { lane: "command", slotIndex: 0 })).toBe(true);
  });

  test("die Plasma Frigate trifft ein zufälliges gegnerisches Schiff der gleichnamigen Lane, auch gedeckt", () => {
    const board = new Board();
    const frigate = place(board, "player", "command", 0, "plasma_frigate");
    place(board, "enemy", "strike", 1, "horizon_cruiser");
    place(board, "enemy", "command", 1, "horizon_cruiser");
    const covered = place(board, "enemy", "command", 4, "signal_booster");
    const events: RoundEvent[] = [];
    resolveDeployAbilities(board, [frigate], [], () => 0.99, events);
    expect(covered.hp).toBe(hp("signal_booster") - 3);
    expect(events).toMatchObject([{ kind: "ability", source: { cardId: "plasma_frigate" }, ship: { cardId: "signal_booster" }, effect: { type: "damage", amount: 3 } }]);
  });

  test("die Plasma Frigate kann die frische Drohne abschießen, ohne Gegner in der Lane bleibt sie still", () => {
    const board = new Board();
    const frigate = place(board, "player", "strike", 0, "plasma_frigate");
    const idle = place(board, "player", "command", 0, "plasma_frigate");
    const carrier = place(board, "enemy", "strike", 0, "titan_carrier");
    const events: RoundEvent[] = [];
    resolveDeployAbilities(board, [frigate, idle, carrier], [], () => 0.99, events);
    expect(events.map((event) => event.kind)).toEqual(["spawn", "ability", "destroyed"]);
    expect(board.shipCount("enemy")).toBe(1);
  });
});

describe("Scrap Raider", () => {
  test("Ein zerstörtes Trugbild zählt nicht: Ein Hologramm hinterlässt keinen Schrott", () => {
    const board = new Board();
    const raider = place(board, "player", "strike", 0, "scrap_raider");
    place(board, "enemy", "strike", 0, "decoy");
    const events = round(board);
    expect(events).toContainEqual({ kind: "destroyed", ship: { side: "enemy", lane: "strike", slotIndex: 0, cardId: "decoy" } });
    expect(raider.scrapBonus).toBe(0);
  });

  test("bekommt dauerhaft +1 ATK für jeden Gegner, der in der gleichnamigen Lane zerstört wird", () => {
    const board = new Board();
    const raider = place(board, "player", "strike", 0, "scrap_raider");
    const bystander = place(board, "player", "command", 2, "scrap_raider");
    place(board, "enemy", "strike", 0, "repair_drone").hp = 1;
    place(board, "enemy", "strike", 1, "repair_drone").hp = 1;
    const events = round(board, [play("player", "volley_fire")]);
    expect(raider.scrapBonus).toBe(2);
    expect(raider.attack).toBe(shipById("scrap_raider").atk + 2);
    expect(bystander.scrapBonus).toBe(0);
    expect(events.filter((event) => event.kind === "ability")).toMatchObject([
      { source: { cardId: "scrap_raider", slotIndex: 0 }, ship: { cardId: "scrap_raider", slotIndex: 0 }, effect: { type: "attack", delta: 2 } },
    ]);
  });

  test("der Bonus bleibt über die Runde hinaus, folgt dem Schiff und steht im Snapshot", () => {
    const board = new Board();
    const raider = place(board, "player", "strike", 0, "scrap_raider");
    raider.scrapBonus = 1;
    round(board);
    const to = board.lane("player", "command").slots[3]!;
    resolveManeuver(raider, to, []);
    expect(to.scrapBonus).toBe(1);
    const copy = new Board();
    copy.load(board.snapshot());
    expect(copy.lane("player", "command").slots[3]!.attack).toBe(shipById("scrap_raider").atk + 1);
  });

  test("ein Raider, der selbst fällt, bekommt nichts", () => {
    const board = new Board();
    const raider = place(board, "player", "strike", 0, "scrap_raider");
    raider.hp = 1;
    place(board, "enemy", "strike", 0, "repair_drone").hp = 1;
    const events = round(board, [play("player", "volley_fire"), play("enemy", "volley_fire")]);
    expect(events.some((event) => event.kind === "ability")).toBe(false);
  });
});

describe("Manöver", () => {
  test("das manövrierte Schiff feuert nicht, wird aber beschossen", () => {
    const board = new Board();
    const from = place(board, "player", "strike", 0, "void_interceptor");
    place(board, "enemy", "strike", 0, "void_interceptor");
    const to = board.lane("player", "command").slots[0]!;
    const events: RoundEvent[] = [];
    resolveManeuver(from, to, events);
    expect(from.isOccupied).toBe(false);
    expect(to.maneuvered).toBe(true);
    const attacks = round(board).filter((event) => event.kind === "attack");
    expect(attacks.map((event) => [event.attacker.side, event.target.lane, event.target.slotIndex])).toEqual([["enemy", "command", 0]]);
    expect(to.hp).toBe(hp("void_interceptor") - 3);
    expect(to.maneuvered).toBe(false);
  });

  test("die Deckung nach dem Manöver gilt schon in derselben Runde", () => {
    const board = new Board();
    const drone = place(board, "player", "command", 2, "repair_drone");
    const cruiser = place(board, "player", "command", 4, "horizon_cruiser");
    place(board, "enemy", "strike", 0, "void_interceptor");
    const front = board.lane("player", "strike").slots[2]!;
    resolveManeuver(cruiser, front, []);
    // Der Jäger nähme sonst die Drohne (wenigste HP); jetzt deckt der Kreuzer sie.
    const attacks = round(board).filter((event) => event.kind === "attack");
    expect(attacks.map((event) => [event.attacker.side, event.target.cardId])).toEqual([["enemy", "horizon_cruiser"]]);
    expect(drone.hp).toBe(hp("repair_drone"));
  });
});

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

describe("Torpedo und Sperrfeuer", () => {
  const slot = (board: Board, side: Side, lane: LaneType, index: number) => board.lane(side, lane).slots[index]!;

  test("Torpedo trifft, wer nach dem Manöver im Slot steht, und verpufft im geräumten Slot", () => {
    const board = new Board();
    const dodger = place(board, "enemy", "strike", 3, "plasma_frigate");
    const mover = place(board, "enemy", "strike", 4, "horizon_cruiser");
    resolveManeuver(dodger, slot(board, "enemy", "command", 2), []);
    resolveManeuver(mover, slot(board, "enemy", "command", 4), []);

    const missed: RoundEvent[] = [];
    resolveEffects(board, [play("player", "torpedo", slot(board, "enemy", "strike", 3))], missed);
    expect(missed).toEqual([{ kind: "miss", side: "player", cardId: "torpedo", target: { side: "enemy", lane: "strike", slotIndex: 3 } }]);
    expect(slot(board, "enemy", "command", 2).hp).toBe(hp("plasma_frigate"));

    const hit: RoundEvent[] = [];
    resolveEffects(board, [play("player", "torpedo", slot(board, "enemy", "command", 4))], hit);
    expect(hit).toMatchObject([{ kind: "effect", effect: { type: "damage", amount: 5 }, ship: { side: "enemy", lane: "command", slotIndex: 4 } }]);
    expect(slot(board, "enemy", "command", 4).hp).toBe(hp("horizon_cruiser") - 5);
  });

  test("Torpedo trifft auch ein gedecktes Command-Schiff, der Schild fängt zuerst ab", () => {
    const board = new Board();
    place(board, "enemy", "strike", 1, "titan_carrier");
    const covered = place(board, "enemy", "command", 1, "iron_dreadnought");
    resolveEffects(board, [play("player", "torpedo", covered)], []);
    expect([covered.shield, covered.hp]).toEqual([0, hp("iron_dreadnought") - 3]);
  });

  test("Sperrfeuer trifft nur Schiffe, die per Manöver oder Bewegungsbefehl die Lane gewechselt haben, gedeckt oder nicht", () => {
    const board = new Board();
    const staying = place(board, "enemy", "strike", 0, "horizon_cruiser");
    const maneuvering = place(board, "enemy", "strike", 2, "horizon_cruiser");
    const flanking = place(board, "enemy", "command", 0, "horizon_cruiser");
    const own = place(board, "player", "strike", 5, "horizon_cruiser");
    resolveManeuver(maneuvering, slot(board, "enemy", "command", 2), []);
    resolveManeuver(own, slot(board, "player", "command", 5), []);
    place(board, "enemy", "strike", 2, "titan_carrier");
    const events: RoundEvent[] = [];
    resolveEffects(
      board,
      [play("player", "barrage"), play("enemy", "flanking_maneuver", flanking, slot(board, "enemy", "strike", 4))],
      events,
    );
    const hits = events.flatMap((event) => (event.kind === "effect" && event.cardId === "barrage" ? [[event.ship.lane, event.ship.slotIndex]] : []));
    expect(hits).toEqual([["strike", 4], ["command", 2]]);
    expect(staying.hp).toBe(hp("horizon_cruiser"));
    expect(slot(board, "enemy", "command", 2).hp).toBe(hp("horizon_cruiser") - 3);
    expect(slot(board, "player", "command", 5).hp).toBe(hp("horizon_cruiser"));
  });

  test("Sperrfeuer ohne bewegten Gegner bleibt ohne Wirkung; das Flag gilt nur eine Runde", () => {
    const board = new Board();
    const enemy = place(board, "enemy", "command", 0, "horizon_cruiser");
    resolveManeuver(enemy, slot(board, "enemy", "strike", 0), []);
    round(board);
    const events: RoundEvent[] = [];
    resolveEffects(board, [play("player", "barrage")], events);
    expect(events).toEqual([{ kind: "noEffect", side: "player", cardId: "barrage" }]);
  });

  test("ein Schiff, das gegen Sperrfeuer manövriert, wird getroffen und feuert nicht", () => {
    const board = new Board();
    const enemy = place(board, "enemy", "strike", 0, "plasma_frigate");
    const own = place(board, "player", "strike", 0, "horizon_cruiser");
    const to = slot(board, "enemy", "command", 0);
    resolveManeuver(enemy, to, []);
    const events = round(board, [play("player", "barrage")]);
    expect(events.filter((event) => event.kind === "attack").map((event) => event.attacker.side)).toEqual(["player"]);
    expect(to.hp).toBe(hp("plasma_frigate") - 3 - 2);
    expect(own.hp).toBe(hp("horizon_cruiser"));
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

describe("Overdrive", () => {
  test("ab Runde 8 +1 ATK, alle 4 Runden ein weiterer Punkt", () => {
    expect([1, 7, 8, 11, 12, 16].map(overdriveBonus)).toEqual([0, 0, 1, 1, 2, 3]);
  });

  test("Kampfschiffe treffen mit dem Bonus, Support-Schiffe bleiben bei 0 ATK", () => {
    const board = new Board();
    board.overdrive = 2;
    const drone = place(board, "player", "command", 0, "repair_drone");
    place(board, "player", "strike", 1, "void_interceptor");
    const target = place(board, "enemy", "strike", 0, "iron_dreadnought");
    expect(drone.attack).toBe(0);
    expect(drone.canAttack).toBe(false);
    const attacks = round(board).filter((event) => event.kind === "attack");
    expect(attacks.map((event) => [event.attacker.cardId, event.amount])).toEqual([
      ["void_interceptor", shipById("void_interceptor").atk + 2],
      ["iron_dreadnought", shipById("iron_dreadnought").atk + 2],
    ]);
    expect(target.hp + target.shield).toBe(hp("iron_dreadnought") + shipById("iron_dreadnought").shield - shipById("void_interceptor").atk - 2);
  });
});

describe("Flaggschiffe", () => {
  test("Wächterschild: Nach den Manövern bekommen die Bastion und das Schiff vor ihr 2 Schild für die Runde", () => {
    const board = new Board();
    const bastion = place(board, "player", "command", 2, "bastion");
    const guard = place(board, "player", "strike", 2, "horizon_cruiser");
    const other = place(board, "player", "strike", 0, "horizon_cruiser");
    place(board, "enemy", "strike", 2, "plasma_frigate");
    const events = resolve(board);
    expect(events.filter((event) => event.kind === "ability")).toEqual([
      { kind: "ability", source: shipRef(bastion), ship: shipRef(bastion), effect: { type: "shield", amount: 2 }, after: { hp: hp("bastion"), shield: 2 } },
      { kind: "ability", source: shipRef(bastion), ship: shipRef(guard), effect: { type: "shield", amount: 2 }, after: { hp: hp("horizon_cruiser"), shield: 2 } },
    ]);
    // Der Schild fängt 2 der 3 Schaden der Plasma Frigate ab und verfällt im Cleanup.
    expect([guard.hp, guard.shield, other.shield, bastion.shield]).toEqual([hp("horizon_cruiser") - 1, 0, 0, 0]);
  });

  test("Wächterschild: Steht die Bastion vorne, bekommt nur sie den Schild", () => {
    const board = new Board();
    const bastion = place(board, "player", "strike", 1, "bastion");
    place(board, "player", "command", 1, "horizon_cruiser");
    expect(resolve(board).filter((event) => event.kind === "ability")).toMatchObject([{ ship: shipRef(bastion), effect: { type: "shield", amount: 2 } }]);
  });

  test("Speerspitze: Steht die Vanguard hinten, hat das Kampfschiff im Strike-Slot direkt vor ihr +1 ATK", () => {
    const board = new Board();
    const vanguard = place(board, "player", "command", 1, "vanguard");
    const front = place(board, "player", "strike", 1, "horizon_cruiser");
    const beside = place(board, "player", "strike", 2, "horizon_cruiser");
    expect([front.attack, beside.attack, vanguard.attack]).toEqual([3, 2, 3]);
    const forward = board.lane("player", "strike").slots[3]!;
    resolveManeuver(vanguard, forward, []);
    expect([front.attack, forward.attack]).toEqual([2, 3]);

    const support = new Board();
    place(support, "player", "command", 0, "vanguard");
    expect(place(support, "player", "strike", 0, "repair_drone").attack).toBe(0);
  });

  test("Brutkammer: Nach dem Cleanup startet die Hive eine Drohne in den freien Strike-Slot, der ihr am nächsten liegt", () => {
    const board = new Board();
    const hive = place(board, "player", "command", 2, "hive");
    place(board, "player", "strike", 2, "horizon_cruiser");
    const events = resolve(board);
    expect(events.at(-1)).toEqual({ kind: "spawn", source: shipRef(hive), ship: { side: "player", lane: "strike", slotIndex: 1, cardId: "drone" } });
    expect(board.hiveLaunches).toEqual({ player: 1, enemy: 0 });
  });

  test("Brutkammer: höchstens 2 Drohnen auf der Seite, auch die des Titan Carriers, und 10 im ganzen Match", () => {
    const board = new Board();
    place(board, "player", "command", 2, "hive");
    place(board, "player", "strike", 5, "drone");
    const drones = () => board.ships("player").filter((slot) => slot.card!.id === "drone").length;
    resolve(board);
    expect(drones()).toBe(2);
    expect(resolve(board).some((event) => event.kind === "spawn")).toBe(false);
    board.lane("player", "strike").slots[5]!.clear();
    board.hiveLaunches.player = 10;
    expect(resolve(board).some((event) => event.kind === "spawn")).toBe(false);
    expect(drones()).toBe(1);
  });

  test("Phasentausch entfällt, wenn der Partner schon beim Deploy fällt: Die Mirage bleibt stehen und feuert, ein Befehl auf den Partner verpufft", () => {
    const board = new Board();
    const mirage = place(board, "player", "command", 2, "mirage");
    place(board, "player", "strike", 0, "void_interceptor").hp = 2;
    const turn = (side: Side, parts: Partial<Turn>): Turn => ({ commander: commander(side), ships: [], flagship: null, command: null, maneuver: null, power: null, mark: null, ...parts });
    // Die Plasma Frigate des Gegners schießt beim Deploy auf das einzige Schiff gegenüber, den Tauschpartner.
    const events = resolveTurns(
      board,
      [
        turn("player", { maneuver: { ship: at("command", 2), destination: at("strike", 0) }, command: { card: commandById("overcharge"), target: at("strike", 0), destination: null } }),
        turn("enemy", { ships: [{ card: shipById("plasma_frigate"), target: at("strike", 0) }] }),
      ],
      () => 0,
    );
    expect(events.some((event) => event.kind === "swap" || event.kind === "maneuver")).toBe(false);
    expect(board.lane("player", "command").slots[2]).toBe(mirage);
    expect(mirage.card!.id).toBe("mirage");
    expect(events).toContainEqual({ kind: "noEffect", side: "player", cardId: "overcharge" });
    expect(events.some((event) => event.kind === "attack" && event.attacker.cardId === "mirage")).toBe(true);
    expect(events.some((event) => event.kind === "selfDamage")).toBe(false);
  });

  test("Phasentausch: Die Mirage tauscht mit einem eigenen Schiff die Plätze samt Zustand; beide feuern, keins gilt als bewegt", () => {
    const board = new Board();
    place(board, "player", "strike", 1, "mirage").hp = 9;
    place(board, "player", "command", 4, "iron_dreadnought");
    place(board, "enemy", "strike", 1, "titan_carrier");
    const events = resolve(
      board,
      { maneuver: { ship: at("strike", 1), destination: at("command", 4) }, command: { card: commandById("emergency_shields"), target: at("command", 4), destination: null } },
      { command: { card: commandById("barrage"), target: null, destination: null } },
    );
    expect(events).toContainEqual({
      kind: "swap",
      side: "player",
      a: { side: "player", lane: "strike", slotIndex: 1, cardId: "mirage" },
      b: { side: "player", lane: "command", slotIndex: 4, cardId: "iron_dreadnought" },
    });
    expect(events.some((event) => event.kind === "maneuver")).toBe(false);
    // Der Schild folgt dem Dreadnought, das Sperrfeuer findet kein bewegtes Schiff.
    expect(events).toContainEqual({ kind: "command", side: "player", cardId: "emergency_shields", target: { side: "player", ...at("strike", 1) } });
    expect(events).toContainEqual({ kind: "noEffect", side: "enemy", cardId: "barrage" });
    expect(attacksBy(events, "player").map((event) => event.attacker.cardId)).toEqual(["iron_dreadnought", "mirage"]);
    expect(board.lane("player", "strike").slots[1]!.state).toEqual({ cardId: "iron_dreadnought", hp: hp("iron_dreadnought"), shield: 2, scrapBonus: 0, marked: false });
    // Der Titan Carrier zielt auf das höchste ATK: die Mirage.
    expect(board.lane("player", "command").slots[4]!.state).toEqual({ cardId: "mirage", hp: 8, shield: 0, scrapBonus: 0, marked: false });
  });

  test("Railgun: Die Markierung kommt nach den Deploys, die Railgun feuert in der nächsten Runde vor allen Schüssen", () => {
    const board = new Board();
    const pendulum = place(board, "player", "command", 2, "pendulum");
    place(board, "player", "strike", 2, "repair_drone");
    const target = place(board, "enemy", "strike", 4, "titan_carrier");
    const marking = resolve(board, { mark: at("strike", 4) });
    expect(marking).toContainEqual({ kind: "mark", side: "player", ship: shipRef(target) });
    expect(marking.some((event) => event.kind === "railgun")).toBe(false);
    expect([target.marked, railgunFires(board, "player"), canMark(board, "player")]).toEqual([true, true, false]);

    const before = target.hp;
    const firing = resolve(board).filter((event) => event.kind === "railgun" || event.kind === "attack");
    expect(firing[0]).toEqual({ kind: "railgun", source: shipRef(pendulum), target: shipRef(target), amount: 6, after: { hp: before - 6, shield: 0 }, blocked: false });
    expect([target.marked, canMark(board, "player")]).toEqual([false, true]);
  });

  test("Railgun: Ist das markierte Schiff zu Kampfbeginn gedeckt, ist der Schuss blockiert; ein Trugbild deckt nicht gegen sie", () => {
    const board = new Board();
    place(board, "player", "command", 2, "pendulum");
    place(board, "player", "strike", 2, "repair_drone");
    const target = place(board, "enemy", "command", 3, "signal_booster");
    target.marked = true;
    const covered = resolve(board, {}, { ships: [{ card: shipById("horizon_cruiser"), target: at("strike", 3) }] });
    expect(covered.find((event) => event.kind === "railgun")).toMatchObject({ amount: 0, blocked: true, after: { hp: hp("signal_booster") } });
    expect(target.marked).toBe(false);

    board.lane("enemy", "strike").slots[3]!.clear();
    target.marked = true;
    const decoyed = resolve(board, {}, { power: { id: "decoy", target: at("strike", 3) } });
    expect(decoyed.find((event) => event.kind === "railgun")).toMatchObject({ amount: 6, blocked: false });
  });

  test("Railgun: Bewegt sich die Pendulum in der Markierungs- oder in der Feuerrunde, fällt der Schuss aus", () => {
    const board = new Board();
    place(board, "player", "command", 2, "pendulum");
    const target = place(board, "enemy", "strike", 4, "titan_carrier");
    const marking = resolve(board, { mark: at("strike", 4), maneuver: { ship: at("command", 2), destination: at("command", 3) } });
    expect(marking.some((event) => event.kind === "mark")).toBe(true);
    expect(target.marked).toBe(false);

    target.marked = true;
    const firing = resolve(board, { maneuver: { ship: at("command", 3), destination: at("command", 2) } });
    expect(firing.some((event) => event.kind === "railgun")).toBe(false);
    expect(target.marked).toBe(false);
  });

  test("Railgun: Die Markierung folgt dem Schiff; ein Ziel, das die Railgun zerstört, feuert in dieser Runde noch", () => {
    const board = new Board();
    place(board, "player", "command", 2, "pendulum");
    place(board, "enemy", "strike", 4, "titan_carrier");
    resolve(board, { mark: at("strike", 4) }, { maneuver: { ship: at("strike", 4), destination: at("command", 4) } });
    expect(board.lane("enemy", "command").slots[4]!.marked).toBe(true);

    const fragile = new Board();
    place(fragile, "player", "command", 2, "pendulum");
    const own = place(fragile, "player", "strike", 2, "horizon_cruiser");
    place(fragile, "enemy", "strike", 2, "void_interceptor").marked = true;
    const events = resolve(fragile);
    expect(events.find((event) => event.kind === "railgun")).toMatchObject({ after: { hp: hp("void_interceptor") - 6 } });
    expect(attacksBy(events, "enemy")).toMatchObject([{ attacker: { cardId: "void_interceptor" }, target: shipRef(own) }]);
    expect(events.some((event) => event.kind === "silenced")).toBe(false);
    expect(own.hp).toBe(hp("horizon_cruiser") - 3);
  });
});

describe("Admiralsfähigkeiten", () => {
  test("Gegenfeuer: Wer das Schiff im Kampf trifft, nimmt danach je Treffer 1 Schaden, ein Flaggschiff nicht", () => {
    const board = new Board();
    const guard = place(board, "player", "strike", 2, "iron_dreadnought");
    const near = place(board, "enemy", "strike", 2, "horizon_cruiser");
    const far = place(board, "enemy", "strike", 1, "horizon_cruiser");
    const vanguard = place(board, "enemy", "command", 0, "vanguard");
    const events = resolve(board, { power: { id: "counterfire", target: at("strike", 2) } });
    expect(events).toContainEqual({ kind: "power", side: "player", power: "counterfire", target: { side: "player", ...at("strike", 2) } });
    expect(attacksBy(events, "enemy").map((event) => event.attacker.cardId)).toEqual(["horizon_cruiser", "horizon_cruiser", "vanguard"]);
    expect(events.filter((event) => event.kind === "counterfire")).toEqual([
      { kind: "counterfire", source: shipRef(guard), ship: shipRef(far), amount: 1, after: { hp: hp("horizon_cruiser") - 1, shield: 0 } },
      { kind: "counterfire", source: shipRef(guard), ship: shipRef(near), amount: 1, after: { hp: hp("horizon_cruiser") - 1, shield: 0 } },
    ]);
    // Den Treffer des Dreadnoughts nimmt die Vanguard, Gegenfeuer nicht.
    expect(vanguard.hp).toBe(hp("vanguard") - 2);
  });

  test("Fokusfeuer: Alle eigenen Schiffe feuern auf das ungedeckte Ziel, je Treffer +1; ist es zerstört, feuern die übrigen normal", () => {
    const board = new Board();
    place(board, "player", "strike", 0, "horizon_cruiser");
    place(board, "player", "strike", 1, "iron_dreadnought");
    place(board, "player", "strike", 2, "void_interceptor");
    place(board, "enemy", "strike", 5, "scrap_raider");
    place(board, "enemy", "strike", 0, "titan_carrier");
    const events = resolve(board, { power: { id: "focus_fire", target: at("strike", 5) } });
    expect(attacksBy(events, "player").map((event) => [event.attacker.cardId, event.target.cardId, event.amount, event.focus ?? false])).toEqual([
      ["horizon_cruiser", "scrap_raider", 3, true],
      ["iron_dreadnought", "scrap_raider", 3, true],
      ["void_interceptor", "titan_carrier", 3, false],
    ]);
  });

  test("Fokusfeuer wirkt nicht, wenn das Ziel zu Kampfbeginn gedeckt ist", () => {
    const board = new Board();
    place(board, "player", "strike", 0, "horizon_cruiser");
    place(board, "enemy", "strike", 3, "titan_carrier");
    const covered = place(board, "enemy", "command", 3, "signal_booster");
    const events = resolve(board, { power: { id: "focus_fire", target: at("command", 3) } });
    expect(attacksBy(events, "player").map((event) => [event.target.cardId, event.amount, event.focus ?? false])).toEqual([["titan_carrier", 2, false]]);
    expect(covered.hp).toBe(hp("signal_booster"));
  });

  test("Schwarmangriff: Die eigenen Drohnen feuern auf das Ziel, auch durch Deckung, je Treffer +1, solange es steht", () => {
    const board = new Board();
    place(board, "player", "strike", 0, "drone");
    place(board, "player", "strike", 1, "drone");
    place(board, "player", "strike", 2, "horizon_cruiser");
    place(board, "enemy", "strike", 3, "titan_carrier");
    place(board, "enemy", "command", 3, "signal_booster").hp = 2;
    const events = resolve(board, { power: { id: "swarm_strike", target: at("command", 3) } });
    expect(attacksBy(events, "player").map((event) => [event.attacker.cardId, event.target.cardId, event.amount, event.swarm ?? false])).toEqual([
      ["drone", "signal_booster", 2, true],
      ["drone", "titan_carrier", 1, false],
      ["horizon_cruiser", "titan_carrier", 2, false],
    ]);
  });

  test("Trugbild: erscheint nach den Deploys im gewählten Strike-Slot, deckt den Slot dahinter und wird beschossen wie ein Schiff", () => {
    const board = new Board();
    const hidden = place(board, "player", "command", 3, "repair_drone");
    place(board, "enemy", "strike", 0, "void_interceptor");
    const events = resolve(board, { power: { id: "decoy", target: at("strike", 3) } });
    const decoy = { side: "player", lane: "strike", slotIndex: 3, cardId: "decoy" } as const;
    expect(events.slice(0, 4)).toEqual([
      { kind: "pass", side: "player" },
      { kind: "pass", side: "enemy" },
      { kind: "power", side: "player", power: "decoy", target: { side: "player", ...at("strike", 3) } },
      { kind: "decoy", ship: decoy },
    ]);
    expect(attacksBy(events, "enemy")).toMatchObject([{ target: decoy }]);
    expect(events).toContainEqual({ kind: "destroyed", ship: decoy });
    expect(events.some((event) => event.kind === "vanish")).toBe(false);
    expect(hidden.hp).toBe(hp("repair_drone"));
  });

  test("Trugbild: verschwindet am Rundenende und zählt als Token zu keiner Grenze", () => {
    const board = new Board();
    for (const index of [0, 1, 2, 3]) place(board, "player", "strike", index, "horizon_cruiser");
    const events = resolve(board, { power: { id: "decoy", target: at("strike", 4) } });
    expect(events.at(-1)).toEqual({ kind: "vanish", ship: { side: "player", lane: "strike", slotIndex: 4, cardId: "decoy" } });
    expect(board.lane("player", "strike").slots[4]!.isOccupied).toBe(false);
    expect(board.lane("player", "strike").shipCount).toBe(4);
  });

  test("Trugbild: Flaggschiffe durchschauen es; sie beschießen es nicht, und es deckt nicht gegen sie", () => {
    const board = new Board();
    place(board, "player", "command", 3, "repair_drone");
    place(board, "enemy", "strike", 0, "void_interceptor");
    place(board, "enemy", "strike", 3, "vanguard");
    const events = resolve(board, { power: { id: "decoy", target: at("strike", 3) } });
    expect(attacksBy(events, "enemy").map((event) => [event.attacker.cardId, event.target.cardId])).toEqual([
      ["void_interceptor", "decoy"],
      ["vanguard", "repair_drone"],
    ]);
  });

  test("Taktvorsprung: Das Schiff feuert vor allen anderen; wer dabei fällt und noch stand, feuert nicht mehr", () => {
    const board = new Board();
    const quick = place(board, "player", "strike", 0, "void_interceptor");
    place(board, "enemy", "strike", 0, "void_interceptor").hp = 3;
    place(board, "enemy", "strike", 1, "horizon_cruiser");
    const events = resolve(board, { power: { id: "head_start", target: at("strike", 0) } });
    expect(events.filter((event) => event.kind === "attack" || event.kind === "silenced")).toMatchObject([
      { kind: "attack", attacker: { side: "player", cardId: "void_interceptor" }, target: { side: "enemy", slotIndex: 0 }, headStart: true },
      { kind: "silenced", ship: { side: "enemy", lane: "strike", slotIndex: 0, cardId: "void_interceptor" } },
      { kind: "attack", attacker: { side: "enemy", cardId: "horizon_cruiser" }, target: shipRef(quick) },
    ]);
    expect(quick.hp).toBe(hp("void_interceptor") - 2);
  });

  test("Taktvorsprung auf beiden Seiten: Diese Schiffe feuern zuerst und gleichzeitig", () => {
    const board = new Board();
    place(board, "player", "strike", 0, "void_interceptor").hp = 3;
    place(board, "player", "strike", 1, "horizon_cruiser");
    place(board, "enemy", "strike", 0, "void_interceptor").hp = 3;
    const headStart = { power: { id: "head_start" as const, target: at("strike", 0) } };
    const events = resolve(board, headStart, headStart);
    expect(events.filter((event) => event.kind === "attack" || event.kind === "silenced")).toMatchObject([
      { kind: "attack", attacker: { side: "player", cardId: "void_interceptor" }, headStart: true },
      { kind: "attack", attacker: { side: "enemy", cardId: "void_interceptor" }, headStart: true },
    ]);
    expect(events.filter((event) => event.kind === "destroyed")).toHaveLength(2);
  });

  test("Die Marke einer Fähigkeit folgt dem Schiff, wenn es sich in der Runde bewegt", () => {
    const board = new Board();
    place(board, "player", "strike", 0, "horizon_cruiser");
    place(board, "enemy", "strike", 0, "titan_carrier");
    place(board, "enemy", "strike", 3, "scrap_raider");
    const events = resolve(board, { power: { id: "focus_fire", target: at("strike", 3) } }, { maneuver: { ship: at("strike", 3), destination: at("strike", 5) } });
    expect(attacksBy(events, "player")).toMatchObject([{ target: { lane: "strike", slotIndex: 5, cardId: "scrap_raider" }, amount: 3, focus: true }]);
  });
});
