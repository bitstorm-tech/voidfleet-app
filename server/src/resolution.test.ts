import { describe, expect, test } from "bun:test";
import { ABILITY_VALUES } from "../../shared/admirals.ts";
import { Board, type LaneType, opposite, overdriveBonus, type Side, type Slot } from "../../shared/board.ts";
import { type CommandId, commandById, type ShipId, shipById } from "../../shared/cards.ts";
import { canMark, railgunFires } from "../../shared/powers.ts";
import type { RoundEvent, SlotTarget } from "../../shared/protocol.ts";
import {
  type Commander,
  type PlayedCommand,
  resolveCleanup,
  resolveCombat,
  resolveDeployAbilities,
  resolveEffects,
  resolveManeuver,
  resolveTurns,
  shipRef,
  type Turn,
} from "../../shared/resolution.ts";

function place(board: Board, side: Side, lane: LaneType, slotIndex: number, id: ShipId): Slot {
  return board.place(board.lane(side, lane), slotIndex, shipById(id))!;
}

const hp = (id: ShipId) => shipById(id).hp;

function commander(side: Side): Commander {
  return { side, drawExtra: (ships, commands) => ({ ships, commands }) };
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

function turnOf(side: Side, parts: Partial<Turn>): Turn {
  return { commander: commander(side), ships: [], flagship: null, command: null, maneuver: null, power: null, mark: null, fire: [], ...parts };
}

/** Eine ganze Runde über `resolveTurns`; eine Seite ohne Angaben passt. */
function resolve(board: Board, player: Partial<Turn> = {}, enemy: Partial<Turn> = {}): RoundEvent[] {
  return resolveTurns(board, [turnOf("player", player), turnOf("enemy", enemy)], null);
}

const at = (lane: LaneType, slotIndex: number): SlotTarget => ({ lane, slotIndex });

function attacksBy(events: RoundEvent[], side: Side) {
  return events.flatMap((event) => (event.kind === "attack" && event.attacker.side === side ? [event] : []));
}

function fizzlesBy(events: RoundEvent[], side: Side) {
  return events.flatMap((event) => (event.kind === "fizzle" && event.attacker.side === side ? [event] : []));
}

/** Feuerbefehl ohne `resolveTurns`: `shooter` feuert im Kampf auf das Schiff, das jetzt in `target` steht (`Slot.aim`). */
function aim(shooter: Slot, target: Slot): void {
  shooter.aim = target.uid;
}

/** Feuerbefehl im Zug: das eigene Schiff in `ship` auf das gegnerische in `target`, beides Slots beim Planen. */
const fire = (ship: SlotTarget, target: SlotTarget) => ({ ship, target });

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
    expect(events).toMatchObject([
      { kind: "ability", source: { cardId: "plasma_frigate" }, ship: { cardId: "signal_booster" }, effect: { type: "damage", amount: 3 } },
    ]);
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
    aim(raider, place(board, "enemy", "strike", 0, "decoy"));
    const events = round(board);
    expect(events).toContainEqual({ kind: "destroyed", ship: { side: "enemy", lane: "strike", slotIndex: 0, cardId: "decoy" } });
    expect(events.some((event) => event.kind === "ability")).toBe(false);
  });

  test("birgt Schrott, sobald ein Gegner in der gleichnamigen Lane zerstört wird, einmal je Raider; der Bonus kommt erst mit dem Nachschub", () => {
    const board = new Board();
    const raider = place(board, "player", "strike", 0, "scrap_raider");
    place(board, "player", "command", 2, "scrap_raider");
    place(board, "enemy", "strike", 0, "repair_drone").hp = 1;
    place(board, "enemy", "strike", 1, "repair_drone").hp = 1;
    const events = round(board, [play("player", "volley_fire")]);
    expect(raider.scrapBonus).toBe(0);
    expect(events.filter((event) => event.kind === "ability")).toMatchObject([
      { source: { cardId: "scrap_raider", slotIndex: 0 }, ship: { cardId: "scrap_raider", slotIndex: 0 }, effect: { type: "salvage" } },
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
    const enemy = place(board, "enemy", "strike", 0, "void_interceptor");
    aim(from, enemy);
    aim(enemy, from);
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
    aim(place(board, "enemy", "strike", 0, "void_interceptor"), drone);
    const front = board.lane("player", "strike").slots[2]!;
    resolveManeuver(cruiser, front, []);
    // Der Jäger zielt auf die Drohne; jetzt deckt der Kreuzer sie und fängt den Schuss ab.
    const attacks = round(board).filter((event) => event.kind === "attack");
    expect(attacks.map((event) => [event.attacker.side, event.target.cardId, event.aimedAt?.cardId])).toEqual([["enemy", "horizon_cruiser", "repair_drone"]]);
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
    aim(interceptor, enemy);
    aim(enemy, interceptor);
    const events = round(board);
    expect(interceptor.isOccupied).toBe(false);
    expect(enemy.isOccupied).toBe(false);
    expect(events.filter((event) => event.kind === "destroyed")).toHaveLength(2);
  });

  test("ein Schuss auf ein Ziel, das ein eigener Schuss schon zerstört hat, verpufft", () => {
    const board = new Board();
    const shooters = [0, 1, 2].map((index) => place(board, "player", "strike", index, "void_interceptor"));
    const weak = place(board, "enemy", "strike", 0, "horizon_cruiser");
    const other = place(board, "enemy", "strike", 3, "horizon_cruiser");
    weak.hp = 3;
    aim(shooters[0]!, weak);
    aim(shooters[1]!, weak);
    aim(shooters[2]!, other);
    const events = round(board);
    expect(attacksBy(events, "player").map((event) => [event.attacker.slotIndex, event.target.slotIndex])).toEqual([
      [0, 0],
      [2, 3],
    ]);
    expect(fizzlesBy(events, "player")).toEqual([
      {
        kind: "fizzle",
        attacker: { side: "player", lane: "strike", slotIndex: 1, cardId: "void_interceptor" },
        target: { side: "enemy", lane: "strike", slotIndex: 0, cardId: "horizon_cruiser" },
      },
    ]);
    expect(weak.isOccupied).toBe(false);
    expect(other.hp).toBe(hp("horizon_cruiser") - 3);
  });

  test("ohne Feuerbefehl feuert kein Schiff, gleich welcher Klasse; mit Feuerbefehl jedes auf sein Ziel", () => {
    const board = new Board();
    const interceptor = place(board, "player", "command", 0, "void_interceptor");
    const dreadnought = place(board, "player", "command", 1, "iron_dreadnought");
    place(board, "player", "command", 4, "horizon_cruiser");
    const weak = place(board, "enemy", "strike", 0, "signal_booster");
    place(board, "enemy", "strike", 2, "plasma_frigate");
    const tough = place(board, "enemy", "strike", 5, "titan_carrier");
    aim(interceptor, tough);
    aim(dreadnought, weak);
    const attacks = attacksBy(round(board), "player");
    expect(attacks.map((event) => [event.attacker.cardId, event.target.cardId])).toEqual([
      ["void_interceptor", "titan_carrier"],
      ["iron_dreadnought", "signal_booster"],
    ]);
    expect(weak.hp).toBe(hp("signal_booster") - 2);
    expect(tough.hp).toBe(hp("titan_carrier") - 3);
  });

  test("der Schuss folgt seinem Ziel; hat es das Brett verlassen, verpufft er", () => {
    const board = new Board();
    const cruiser = place(board, "player", "strike", 0, "horizon_cruiser");
    const raider = place(board, "player", "strike", 1, "scrap_raider");
    const mover = place(board, "enemy", "strike", 2, "void_interceptor");
    const gone = place(board, "enemy", "strike", 4, "void_interceptor");
    aim(cruiser, mover);
    aim(raider, gone);
    const to = board.lane("enemy", "strike").slots[5]!;
    resolveManeuver(mover, to, []);
    gone.clear();
    const events = round(board);
    expect(attacksBy(events, "player")).toMatchObject([{ attacker: { cardId: "horizon_cruiser" }, target: { slotIndex: 5, cardId: "void_interceptor" } }]);
    expect(fizzlesBy(events, "player")).toEqual([{ kind: "fizzle", attacker: shipRef(raider), target: null }]);
  });

  test("die Deckung hält die Runde über: Ist das deckende Schiff schon zerstört, verpufft der Schuss auf das Schiff dahinter", () => {
    const board = new Board();
    const first = place(board, "player", "strike", 0, "void_interceptor");
    const second = place(board, "player", "strike", 1, "void_interceptor");
    const front = place(board, "enemy", "strike", 0, "horizon_cruiser");
    const back = place(board, "enemy", "command", 0, "signal_booster");
    front.hp = 3;
    aim(first, front);
    aim(second, back);
    const fizzle = { kind: "fizzle" as const, attacker: shipRef(second), target: shipRef(front), aimedAt: shipRef(back) };
    const events = round(board);
    expect(attacksBy(events, "player")).toHaveLength(1);
    expect(fizzlesBy(events, "player")).toEqual([fizzle]);
    expect(front.isOccupied).toBe(false);
    expect(back.hp).toBe(hp("signal_booster"));
  });

  test("ein im selben Kampf zerstörtes Schiff feuert noch, weil die Seiten gleichzeitig schießen", () => {
    const board = new Board();
    aim(place(board, "player", "strike", 0, "void_interceptor"), place(board, "enemy", "strike", 0, "void_interceptor"));
    const enemy = board.lane("enemy", "strike").slots[0]!;
    const victim = place(board, "player", "strike", 2, "horizon_cruiser");
    victim.hp = 3;
    enemy.hp = 3;
    aim(enemy, victim);
    round(board);
    expect(enemy.isOccupied).toBe(false);
    expect(victim.isOccupied).toBe(false);
  });

  test("Schüsse wechseln sich zwischen den Seiten ab", () => {
    const board = new Board();
    const own = [0, 1, 2].map((index) => place(board, "player", "strike", index, "horizon_cruiser"));
    const enemies = [0, 1].map((index) => place(board, "enemy", "strike", index, "titan_carrier"));
    for (const ship of own) aim(ship, enemies[0]!);
    for (const ship of enemies) aim(ship, own[0]!);
    const sides = round(board).flatMap((event) => (event.kind === "attack" ? [event.attacker.side] : []));
    expect(sides).toEqual(["player", "enemy", "player", "enemy", "player"]);
  });

  test("ein Command-Schiff ist nur gedeckt, wenn im Strike-Slot davor ein Schiff steht; die Deckung fängt den Schuss ab", () => {
    const board = new Board();
    const first = place(board, "player", "strike", 0, "horizon_cruiser");
    const second = place(board, "player", "strike", 1, "horizon_cruiser");
    const front = place(board, "enemy", "strike", 3, "titan_carrier");
    const covered = place(board, "enemy", "command", 3, "signal_booster");
    const exposed = place(board, "enemy", "command", 0, "signal_booster");
    aim(first, covered);
    aim(second, exposed);
    const events = round(board);
    expect(attacksBy(events, "player")).toEqual([
      {
        kind: "attack",
        attacker: shipRef(first),
        target: shipRef(front),
        amount: 2,
        after: { hp: hp("titan_carrier") - 2, shield: 0 },
        aimedAt: shipRef(covered),
      },
      { kind: "attack", attacker: shipRef(second), target: shipRef(exposed), amount: 2, after: { hp: hp("signal_booster") - 2, shield: 0 } },
    ]);
    expect(exposed.hp).toBe(hp("signal_booster") - 2);
    expect(covered.hp).toBe(hp("signal_booster"));
    expect(front.hp).toBe(hp("titan_carrier") - 2);
  });

  test("Jeder Schuss wird mit den Werten des Ziels danach gemeldet", () => {
    const board = new Board();
    const target = place(board, "enemy", "strike", 0, "iron_dreadnought");
    aim(place(board, "player", "strike", 0, "horizon_cruiser"), target);
    aim(place(board, "player", "strike", 1, "horizon_cruiser"), target);
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
    const dreadnought = place(board, "enemy", "strike", 0, "iron_dreadnought");
    aim(place(board, "player", "strike", 0, "plasma_frigate"), dreadnought);
    round(board);
    expect([dreadnought.shield, dreadnought.hp]).toEqual([0, hp("iron_dreadnought") - 1]);
  });

  test("Support greift nicht an", () => {
    const board = new Board();
    const enemy = place(board, "enemy", "strike", 0, "signal_booster");
    aim(place(board, "player", "strike", 0, "signal_booster"), enemy);
    expect(round(board).some((event) => event.kind === "attack" || event.kind === "fizzle")).toBe(false);
    expect(enemy.hp).toBe(hp("signal_booster"));
  });
});

describe("Befehle", () => {
  test("Orbital Strike trifft das Schiff mit dem höchsten HP, bevor es feuern kann", () => {
    const board = new Board();
    const own = place(board, "player", "strike", 0, "signal_booster");
    const interceptor = place(board, "enemy", "strike", 0, "void_interceptor");
    interceptor.hp = 3;
    const target = place(board, "enemy", "command", 0, "scrap_raider");
    own.hp = 4;
    target.hp = 4;
    aim(interceptor, own);
    aim(target, own);
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
    aim(frigate, own);
    aim(cruiser, own);
    round(board, [play("player", "emp_blast"), play("player", "targeting_jammer")]);
    expect(own.hp).toBe(hp("titan_carrier") - (2 - 1));
    expect(frigate.disabled).toBe(false);
    expect(cruiser.attack).toBe(2);
  });

  test("Intercept zieht ein Schiff in den gewählten Strike-Slot und gibt +2 ATK", () => {
    const board = new Board();
    const back = place(board, "player", "command", 2, "horizon_cruiser");
    const enemy = place(board, "enemy", "strike", 2, "titan_carrier");
    aim(back, enemy);
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
    resolveEffects(board, [play("player", "barrage"), play("enemy", "flanking_maneuver", flanking, slot(board, "enemy", "strike", 4))], events);
    const hits = events.flatMap((event) => (event.kind === "effect" && event.cardId === "barrage" ? [[event.ship.lane, event.ship.slotIndex]] : []));
    expect(hits).toEqual([
      ["strike", 4],
      ["command", 2],
    ]);
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
    aim(enemy, own);
    aim(own, enemy);
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
    aim(cruiser, frigate);
    aim(frigate, booster);
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
    aim(place(board, "enemy", "strike", 0, "plasma_frigate"), drone);
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
    const interceptor = place(board, "player", "strike", 1, "void_interceptor");
    const target = place(board, "enemy", "strike", 0, "iron_dreadnought");
    aim(interceptor, target);
    aim(target, interceptor);
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
  test("Wächterschild: Nach den Manövern bekommen die Bastion 2 und das Schiff vor ihr 1 Schild für die Runde", () => {
    const board = new Board();
    const bastion = place(board, "player", "command", 2, "bastion");
    const guard = place(board, "player", "strike", 2, "horizon_cruiser");
    const other = place(board, "player", "strike", 0, "horizon_cruiser");
    place(board, "enemy", "strike", 2, "plasma_frigate");
    const events = resolve(board, {}, { fire: [fire(at("strike", 2), at("strike", 2))] });
    expect(events.filter((event) => event.kind === "ability")).toEqual([
      { kind: "ability", source: shipRef(bastion), ship: shipRef(bastion), effect: { type: "shield", amount: 2 }, after: { hp: hp("bastion"), shield: 2 } },
      {
        kind: "ability",
        source: shipRef(bastion),
        ship: shipRef(guard),
        effect: { type: "shield", amount: 1 },
        after: { hp: hp("horizon_cruiser"), shield: 1 },
      },
    ]);
    // Der Schild fängt 1 der 3 Schaden der Plasma Frigate ab und verfällt im Cleanup.
    expect([guard.hp, guard.shield, other.shield, bastion.shield]).toEqual([hp("horizon_cruiser") - 2, 0, 0, 0]);
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
    place(board, "enemy", "command", 5, "titan_carrier");
    const turn = (side: Side, parts: Partial<Turn>): Turn => ({
      commander: commander(side),
      ships: [],
      flagship: null,
      command: null,
      maneuver: null,
      power: null,
      mark: null,
      fire: [],
      ...parts,
    });
    // Die Plasma Frigate des Gegners schießt beim Deploy auf das einzige Schiff gegenüber, den Tauschpartner.
    const events = resolveTurns(
      board,
      [
        turn("player", {
          maneuver: { ship: at("command", 2), destination: at("strike", 0) },
          command: { card: commandById("overcharge"), target: at("strike", 0), destination: null },
          fire: [fire(at("command", 2), at("command", 5))],
        }),
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
      {
        maneuver: { ship: at("strike", 1), destination: at("command", 4) },
        command: { card: commandById("emergency_shields"), target: at("command", 4), destination: null },
        fire: [fire(at("strike", 1), at("strike", 1)), fire(at("command", 4), at("strike", 1))],
      },
      { command: { card: commandById("barrage"), target: null, destination: null }, fire: [fire(at("strike", 1), at("strike", 1))] },
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
    expect(board.lane("player", "strike").slots[1]!.state).toEqual({
      cardId: "iron_dreadnought",
      hp: hp("iron_dreadnought"),
      shield: 2,
      scrapBonus: 0,
      marked: false,
    });
    // Der Feuerbefehl des Titan Carriers folgt der Mirage in die Command-Lane, wo sie ungedeckt steht.
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
    expect(firing[0]).toEqual({
      kind: "railgun",
      source: shipRef(pendulum),
      target: shipRef(target),
      amount: ABILITY_VALUES.railgun,
      after: { hp: before - ABILITY_VALUES.railgun, shield: 0 },
      blocked: false,
    });
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
    expect(decoyed.find((event) => event.kind === "railgun")).toMatchObject({ amount: ABILITY_VALUES.railgun, blocked: false });
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
    const events = resolve(fragile, {}, { fire: [fire(at("strike", 2), at("strike", 2))] });
    expect(events.find((event) => event.kind === "railgun")).toMatchObject({ after: { hp: hp("void_interceptor") - ABILITY_VALUES.railgun } });
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
    const atGuard = [at("strike", 1), at("strike", 2), at("command", 0)].map((ship) => fire(ship, at("strike", 2)));
    const events = resolve(
      board,
      { power: { id: "counterfire", target: at("strike", 2) }, fire: [fire(at("strike", 2), at("command", 0))] },
      { fire: atGuard },
    );
    expect(events).toContainEqual({ kind: "power", side: "player", power: "counterfire", target: { side: "player", ...at("strike", 2) } });
    expect(attacksBy(events, "enemy").map((event) => event.attacker.cardId)).toEqual(["horizon_cruiser", "horizon_cruiser", "vanguard"]);
    expect(events.filter((event) => event.kind === "counterfire")).toEqual([
      { kind: "counterfire", source: shipRef(guard), ship: shipRef(far), amount: 1, after: { hp: hp("horizon_cruiser") - 1, shield: 0 } },
      { kind: "counterfire", source: shipRef(guard), ship: shipRef(near), amount: 1, after: { hp: hp("horizon_cruiser") - 1, shield: 0 } },
    ]);
    // Den Treffer des Dreadnoughts nimmt die Vanguard, Gegenfeuer nicht.
    expect(vanguard.hp).toBe(hp("vanguard") - 2);
  });

  test("Fokusfeuer: Jeder Treffer auf das Ziel macht 1 mehr; es lenkt keinen Schuss um, und auf das zerstörte Ziel verpufft er", () => {
    const board = new Board();
    place(board, "player", "strike", 0, "horizon_cruiser");
    place(board, "player", "strike", 1, "iron_dreadnought");
    place(board, "player", "strike", 2, "void_interceptor");
    place(board, "player", "strike", 3, "horizon_cruiser");
    place(board, "enemy", "strike", 5, "scrap_raider");
    place(board, "enemy", "strike", 0, "titan_carrier");
    const raider = at("strike", 5);
    const events = resolve(board, {
      power: { id: "focus_fire", target: raider },
      fire: [fire(at("strike", 0), raider), fire(at("strike", 1), raider), fire(at("strike", 2), at("strike", 0)), fire(at("strike", 3), raider)],
    });
    expect(attacksBy(events, "player").map((event) => [event.attacker.cardId, event.target.cardId, event.amount, event.focus ?? false])).toEqual([
      ["horizon_cruiser", "scrap_raider", 3, true],
      ["iron_dreadnought", "scrap_raider", 3, true],
      ["void_interceptor", "titan_carrier", 3, false],
    ]);
    expect(fizzlesBy(events, "player")).toMatchObject([{ attacker: { slotIndex: 3 } }]);
  });

  test("Fokusfeuer: Ein Schuss, den die Deckung abfängt, bekommt keinen Bonus", () => {
    const board = new Board();
    place(board, "player", "strike", 0, "horizon_cruiser");
    place(board, "enemy", "strike", 3, "titan_carrier");
    const covered = place(board, "enemy", "command", 3, "signal_booster");
    const events = resolve(board, { power: { id: "focus_fire", target: at("command", 3) }, fire: [fire(at("strike", 0), at("command", 3))] });
    expect(attacksBy(events, "player").map((event) => [event.target.cardId, event.amount, event.focus ?? false])).toEqual([["titan_carrier", 2, false]]);
    expect(covered.hp).toBe(hp("signal_booster"));
  });

  test("Schwarmangriff: Die Drohnen feuern auch ohne Feuerbefehl auf das Ziel, durch Deckung, je Treffer +1; ist es zerstört, verpufft der Rest", () => {
    const board = new Board();
    place(board, "player", "strike", 0, "drone");
    place(board, "player", "strike", 1, "drone");
    place(board, "player", "strike", 2, "horizon_cruiser");
    place(board, "enemy", "strike", 3, "titan_carrier");
    place(board, "enemy", "command", 3, "signal_booster").hp = 2;
    const events = resolve(board, {
      power: { id: "swarm_strike", target: at("command", 3) },
      fire: [fire(at("strike", 1), at("strike", 3)), fire(at("strike", 2), at("strike", 3))],
    });
    expect(attacksBy(events, "player").map((event) => [event.attacker.cardId, event.target.cardId, event.amount, event.swarm ?? false])).toEqual([
      ["drone", "signal_booster", 2, true],
      ["horizon_cruiser", "titan_carrier", 2, false],
    ]);
    expect(fizzlesBy(events, "player")).toMatchObject([{ attacker: { slotIndex: 1, cardId: "drone" }, target: { cardId: "signal_booster" } }]);
  });

  test("Trugbild: erscheint nach den Deploys im gewählten Strike-Slot, deckt den Slot dahinter und fängt die Schüsse darauf ab", () => {
    const board = new Board();
    const hidden = place(board, "player", "command", 3, "repair_drone");
    place(board, "enemy", "strike", 0, "void_interceptor");
    const events = resolve(board, { power: { id: "decoy", target: at("strike", 3) } }, { fire: [fire(at("strike", 0), at("command", 3))] });
    const decoy = { side: "player", lane: "strike", slotIndex: 3, cardId: "decoy" } as const;
    expect(events.slice(0, 4)).toEqual([
      { kind: "pass", side: "player" },
      { kind: "pass", side: "enemy" },
      { kind: "power", side: "player", power: "decoy", target: { side: "player", ...at("strike", 3) } },
      { kind: "decoy", ship: decoy },
    ]);
    expect(attacksBy(events, "enemy")).toMatchObject([{ target: decoy, aimedAt: shipRef(hidden) }]);
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
    const atHidden = [at("strike", 0), at("strike", 3)].map((ship) => fire(ship, at("command", 3)));
    const events = resolve(board, { power: { id: "decoy", target: at("strike", 3) } }, { fire: atHidden });
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
    const atQuick = [at("strike", 0), at("strike", 1)].map((ship) => fire(ship, at("strike", 0)));
    const events = resolve(board, { power: { id: "head_start", target: at("strike", 0) }, fire: [fire(at("strike", 0), at("strike", 0))] }, { fire: atQuick });
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
    const events = resolve(
      board,
      { ...headStart, fire: [fire(at("strike", 0), at("strike", 0)), fire(at("strike", 1), at("strike", 0))] },
      { ...headStart, fire: [fire(at("strike", 0), at("strike", 0))] },
    );
    expect(events.filter((event) => event.kind === "attack" || event.kind === "silenced" || event.kind === "fizzle")).toMatchObject([
      { kind: "attack", attacker: { side: "player", cardId: "void_interceptor" }, headStart: true },
      { kind: "attack", attacker: { side: "enemy", cardId: "void_interceptor" }, headStart: true },
      { kind: "fizzle", attacker: { side: "player", cardId: "horizon_cruiser" } },
    ]);
    expect(events.filter((event) => event.kind === "destroyed")).toHaveLength(2);
  });

  test("Die Marke einer Fähigkeit folgt dem Schiff, wenn es sich in der Runde bewegt", () => {
    const board = new Board();
    place(board, "player", "strike", 0, "horizon_cruiser");
    place(board, "enemy", "strike", 0, "titan_carrier");
    place(board, "enemy", "strike", 3, "scrap_raider");
    const events = resolve(
      board,
      { power: { id: "focus_fire", target: at("strike", 3) }, fire: [fire(at("strike", 0), at("strike", 3))] },
      { maneuver: { ship: at("strike", 3), destination: at("strike", 5) } },
    );
    expect(attacksBy(events, "player")).toMatchObject([{ target: { lane: "strike", slotIndex: 5, cardId: "scrap_raider" }, amount: 3, focus: true }]);
  });
});

describe("Feuerbefehle", () => {
  test("Ein Schiff, das in dieser Runde landet, feuert mit seinem Feuerbefehl schon im Kampf", () => {
    const board = new Board();
    const target = place(board, "enemy", "strike", 1, "horizon_cruiser");
    const events = resolve(board, { ships: [{ card: shipById("void_interceptor"), target: at("strike", 4) }], fire: [fire(at("strike", 4), at("strike", 1))] });
    expect(attacksBy(events, "player")).toMatchObject([{ attacker: { slotIndex: 4, cardId: "void_interceptor" }, target: shipRef(target), amount: 3 }]);
  });

  test("Fällt die Deckung schon vor dem Kampf, trifft der Schuss das Schiff dahinter", () => {
    const board = new Board();
    place(board, "player", "strike", 0, "plasma_frigate");
    const guard = place(board, "enemy", "strike", 2, "void_interceptor");
    const flagship = place(board, "enemy", "command", 2, "pendulum");
    const events = resolve(board, { command: order("torpedo", at("strike", 2)), fire: [fire(at("strike", 0), at("command", 2))] });
    expect(guard.isOccupied).toBe(false);
    expect(attacksBy(events, "player")).toEqual([
      {
        kind: "attack",
        attacker: { side: "player", ...at("strike", 0), cardId: "plasma_frigate" },
        target: shipRef(flagship),
        amount: 3,
        after: { hp: hp("pendulum") - 3, shield: 0 },
      },
    ]);
  });

  test("Der Feuerbefehl folgt dem Schützen, auch wenn der Gegner ihn per Traktorstrahl verlegt", () => {
    const board = new Board();
    place(board, "player", "command", 1, "horizon_cruiser");
    const target = place(board, "enemy", "strike", 4, "titan_carrier");
    const events = resolve(board, { fire: [fire(at("command", 1), at("strike", 4))] }, { command: order("tractor_beam", at("command", 1)) });
    expect(attacksBy(events, "player")).toMatchObject([{ attacker: { lane: "strike", slotIndex: 1 }, target: shipRef(target) }]);
  });

  test("Feuerbefehle beider Seiten gehen gleich aus, mit vertauschten Sitzen", () => {
    const { events } = mirrored(
      (board, a, b) => {
        place(board, a, "strike", 0, "void_interceptor");
        place(board, a, "strike", 1, "horizon_cruiser");
        place(board, b, "strike", 3, "horizon_cruiser").hp = 3;
        place(board, b, "command", 3, "signal_booster");
        place(board, b, "strike", 4, "scrap_raider");
      },
      { fire: [fire(at("strike", 0), at("strike", 3)), fire(at("strike", 1), at("command", 3))] },
      { fire: [fire(at("strike", 3), at("strike", 0)), fire(at("strike", 4), at("strike", 1))] },
    );
    expect(attacksBy(events, "player")).toHaveLength(1);
    expect(fizzlesBy(events, "player")).toHaveLength(1);
    expect(attacksBy(events, "enemy")).toHaveLength(2);
  });
});

// --- Neue Befehle ---

const order = (id: CommandId, target: SlotTarget | null = null, destination: number | null = null): Turn["command"] => ({
  card: commandById(id),
  target,
  destination,
});
const slotOf = (board: Board, side: Side, lane: LaneType, slotIndex: number) => board.lane(side, lane).slots[slotIndex]!;

function effectsOf(events: RoundEvent[], cardId: CommandId) {
  return events.flatMap((event) => (event.kind === "effect" && event.cardId === cardId ? [event] : []));
}

/**
 * Dieselbe Lage mit vertauschten Sitzen: `a` spielt einmal auf der "player"-Seite (zuerst), einmal auf der "enemy"-Seite
 * (danach). Das Brett muss gespiegelt gleich ausgehen; zurück kommt das Brett des ersten Laufs samt Ereignissen.
 */
function mirrored(setup: (board: Board, a: Side, b: Side) => void, a: Partial<Turn>, b: Partial<Turn>) {
  const run = (first: Side) => {
    const board = new Board();
    setup(board, first, opposite(first));
    const parts = first === "player" ? [a, b] : [b, a];
    const events = resolveTurns(board, [turnOf("player", parts[0]!), turnOf("enemy", parts[1]!)], null);
    return { board, events };
  };
  const straight = run("player");
  const swapped = run("enemy").board.snapshot();
  expect({ player: swapped.enemy, enemy: swapped.player }).toEqual(straight.board.snapshot());
  return straight;
}

describe("Umgruppierung", () => {
  test("Ausweichmanöver: verlegt in derselben Lane, gibt Schild 2; der Wärmesucher folgt dem Schiff und trifft es als bewegt mit 5", () => {
    const board = new Board();
    place(board, "player", "strike", 1, "horizon_cruiser");
    const events = resolve(board, { command: order("evasive_action", at("strike", 1), 4) }, { command: order("heat_seeker", at("strike", 1)) });
    expect(events).toContainEqual({ kind: "command", side: "enemy", cardId: "heat_seeker", target: { side: "player", ...at("strike", 1) } });
    expect([...effectsOf(events, "evasive_action"), ...effectsOf(events, "heat_seeker")]).toMatchObject([
      { ship: { slotIndex: 1 }, effect: { type: "move", to: at("strike", 4) } },
      { ship: { slotIndex: 4 }, effect: { type: "shield", amount: 2 }, after: { hp: 8, shield: 2 } },
      { ship: { side: "player", slotIndex: 4 }, effect: { type: "damage", amount: 5 }, after: { hp: 5, shield: 0 } },
    ]);
    expect(slotOf(board, "player", "strike", 4).hp).toBe(5);
  });

  test("Kurzsprung: Der Torpedo trifft ins Leere, das Schiff feuert nicht und kehrt im Cleanup samt Zustand zurück", () => {
    const board = new Board();
    const raider = place(board, "player", "strike", 2, "scrap_raider");
    raider.hp = 4;
    raider.shield = 1;
    raider.scrapBonus = 1;
    place(board, "enemy", "strike", 2, "horizon_cruiser");
    const events = resolve(
      board,
      { command: order("micro_jump", at("strike", 2)), fire: [fire(at("strike", 2), at("strike", 2))] },
      { command: order("torpedo", at("strike", 2)) },
    );
    expect(effectsOf(events, "micro_jump")).toMatchObject([
      { ship: { slotIndex: 2, cardId: "scrap_raider" }, effect: { type: "jump" }, after: { hp: 4, shield: 1 } },
    ]);
    expect(events).toContainEqual({ kind: "miss", side: "enemy", cardId: "torpedo", target: { side: "player", ...at("strike", 2) } });
    expect(events.filter((event) => event.kind === "attack" || event.kind === "fizzle")).toEqual([]);
    expect(events).toContainEqual({
      kind: "return",
      ship: { side: "player", lane: "strike", slotIndex: 2, cardId: "scrap_raider" },
      after: { hp: 4, shield: 1 },
    });
    expect(raider.state).toEqual({ cardId: "scrap_raider", hp: 4, shield: 1, scrapBonus: 1, marked: false });
    expect(board.jumping).toEqual([]);
  });

  test("Kurzsprung: Das springende Flaggschiff entgeht tödlichem Schaden, Schüsse darauf verpuffen, das Schiff dahinter verliert die Deckung", () => {
    const board = new Board();
    const vanguard = place(board, "player", "strike", 3, "vanguard");
    vanguard.hp = 1;
    const behind = place(board, "player", "command", 3, "signal_booster");
    place(board, "enemy", "strike", 3, "horizon_cruiser");
    place(board, "enemy", "strike", 4, "void_interceptor");
    const events = resolve(
      board,
      { command: order("micro_jump", at("strike", 3)) },
      { command: order("volley_fire"), fire: [fire(at("strike", 3), at("command", 3)), fire(at("strike", 4), at("strike", 3))] },
    );
    expect(board.flagship("player")).toBe(vanguard);
    expect(vanguard.hp).toBe(1);
    expect(attacksBy(events, "enemy")).toMatchObject([{ target: { lane: "command", slotIndex: 3 }, amount: 2 }]);
    expect(fizzlesBy(events, "enemy")).toMatchObject([{ attacker: { slotIndex: 4 }, target: null }]);
    expect(behind.hp).toBe(hp("signal_booster") - 1 - 2);
  });

  test("Kurzsprung: Die Pendulum verliert ihren Schuss, die Markierung ist verbraucht", () => {
    const board = new Board();
    place(board, "player", "command", 2, "pendulum");
    const marked = place(board, "enemy", "strike", 0, "horizon_cruiser");
    marked.marked = true;
    const events = resolve(board, { command: order("micro_jump", at("command", 2)) });
    expect(events.some((event) => event.kind === "railgun")).toBe(false);
    expect(marked.hp).toBe(hp("horizon_cruiser"));
    expect(marked.marked).toBe(false);
  });

  test("Kurzsprung: Der Slot bleibt bis zur Rückkehr gesperrt; der Traktorstrahl zieht in den nächsten freien Slot", () => {
    const board = new Board();
    place(board, "player", "strike", 2, "horizon_cruiser");
    place(board, "player", "command", 2, "repair_drone");
    const events = resolve(board, { command: order("micro_jump", at("strike", 2)) }, { command: order("tractor_beam", at("command", 2)) });
    expect(effectsOf(events, "tractor_beam")).toMatchObject([
      { side: "enemy", ship: { side: "player", ...at("command", 2) }, effect: { type: "move", to: at("strike", 1) } },
    ]);
    expect(slotOf(board, "player", "strike", 1).card?.id).toBe("repair_drone");
    expect(slotOf(board, "player", "strike", 2).card?.id).toBe("horizon_cruiser");
  });

  test("Kurzsprung: Wärmesucher und Traktorstrahl verpuffen, wenn ihr Schiff springt", () => {
    const board = new Board();
    place(board, "player", "strike", 2, "horizon_cruiser");
    const events = resolve(board, { command: order("micro_jump", at("strike", 2)) }, { command: order("heat_seeker", at("strike", 2)) });
    expect(events).toContainEqual({ kind: "noEffect", side: "enemy", cardId: "heat_seeker" });
    expect(slotOf(board, "player", "strike", 2).hp).toBe(hp("horizon_cruiser"));
  });
});

describe("Taktik", () => {
  test("Schnellverlegung und Freie Hand haben beim Planen gewirkt und melden nur `rule`", () => {
    const board = new Board();
    const events = resolve(board, { command: order("rapid_deployment") }, { command: order("carte_blanche") });
    expect(events.filter((event) => event.kind === "rule")).toEqual([
      { kind: "rule", side: "player", cardId: "rapid_deployment" },
      { kind: "rule", side: "enemy", cardId: "carte_blanche" },
    ]);
  });

  test("Ablenkung: Das Schiff zieht die Schüsse mit Feuerbefehl auf sich, solange es steht; danach gelten wieder die Feuerbefehle", () => {
    const board = new Board();
    const decoy = place(board, "player", "strike", 0, "horizon_cruiser");
    decoy.hp = 3;
    const drone = place(board, "player", "strike", 4, "repair_drone");
    place(board, "enemy", "strike", 4, "horizon_cruiser");
    place(board, "enemy", "strike", 3, "void_interceptor");
    place(board, "enemy", "strike", 5, "void_interceptor");
    const events = resolve(
      board,
      { command: order("draw_fire", at("strike", 0)) },
      { fire: [fire(at("strike", 3), at("strike", 4)), fire(at("strike", 4), at("strike", 4))] },
    );
    expect(effectsOf(events, "draw_fire")).toMatchObject([{ ship: { slotIndex: 0 }, effect: { type: "taunt" } }]);
    // Der Jäger in Slot 3 fällt auf die Ablenkung herein und zerstört sie; der Kreuzer trifft danach sein Ziel. Wer keinen Feuerbefehl hat, feuert nicht.
    expect(
      attacksBy(events, "enemy").map((event) => [event.attacker.slotIndex, event.target.slotIndex, event.aimedAt?.slotIndex, event.taunt ?? false]),
    ).toEqual([
      [3, 0, 4, true],
      [4, 4, undefined, false],
    ]);
    expect(decoy.isOccupied).toBe(false);
    expect(drone.hp).toBe(hp("repair_drone") - 2);
  });

  test("Ablenkung: Ein gedecktes Schiff zieht kein Feuer, der Schuss geht auf sein Ziel", () => {
    const board = new Board();
    place(board, "player", "strike", 0, "iron_dreadnought");
    place(board, "player", "command", 0, "repair_drone");
    place(board, "enemy", "strike", 2, "void_interceptor");
    const events = resolve(board, { command: order("draw_fire", at("command", 0)) }, { fire: [fire(at("strike", 2), at("strike", 0))] });
    expect(attacksBy(events, "enemy")).toMatchObject([{ target: { lane: "strike", slotIndex: 0 } }]);
    expect(attacksBy(events, "enemy")[0]!.taunt).toBeUndefined();
  });
});

describe("Verstärkung", () => {
  test("Schildgitter: Alle eigenen Schiffe, auch Tokens, bekommen Schild 1 für die Runde", () => {
    const board = new Board();
    place(board, "player", "strike", 0, "horizon_cruiser");
    place(board, "player", "strike", 1, "drone");
    place(board, "player", "command", 0, "repair_drone");
    const events = round(board, [play("player", "shield_grid")]);
    expect(effectsOf(events, "shield_grid").map((event) => [event.ship.cardId, event.effect])).toEqual([
      ["horizon_cruiser", { type: "shield", amount: 1 }],
      ["drone", { type: "shield", amount: 1 }],
      ["repair_drone", { type: "shield", amount: 1 }],
    ]);
    expect(board.ships("player").map((slot) => slot.shield)).toEqual([0, 0, 0]);
  });

  test("Ablativpanzerung: Schild +2, der am Rundenende bleibt", () => {
    const board = new Board();
    const ship = place(board, "player", "strike", 0, "horizon_cruiser");
    const events = round(board, [play("player", "ablative_armor", ship)]);
    expect(effectsOf(events, "ablative_armor")).toMatchObject([{ effect: { type: "shield", amount: 2, permanent: true }, after: { hp: 8, shield: 2 } }]);
    expect(ship.state).toMatchObject({ shield: 2 });
  });

  test("Feuerschutz: Das Ziel und sein Partner in der anderen Lane bekommen +1 ATK und Schild 1", () => {
    const board = new Board();
    const front = place(board, "player", "strike", 1, "horizon_cruiser");
    const back = place(board, "player", "command", 1, "plasma_frigate");
    place(board, "player", "command", 2, "void_interceptor");
    const events: RoundEvent[] = [];
    resolveEffects(board, [play("player", "covering_fire", back)], events);
    expect(effectsOf(events, "covering_fire").map((event) => [event.ship.lane, event.effect])).toEqual([
      ["command", { type: "attack", delta: 1 }],
      ["command", { type: "shield", amount: 1 }],
      ["strike", { type: "attack", delta: 1 }],
      ["strike", { type: "shield", amount: 1 }],
    ]);
    expect([front.attack, front.shield, back.attack, back.shield]).toEqual([3, 1, 4, 1]);
  });

  test("Drohnenstaffel: zuerst vor das ungedeckte Flaggschiff, dann vor andere ungedeckte Command-Schiffe, sonst zur Lane-Mitte", () => {
    const board = new Board();
    place(board, "player", "command", 4, "bastion");
    place(board, "player", "command", 1, "repair_drone");
    place(board, "player", "command", 0, "horizon_cruiser");
    place(board, "player", "strike", 0, "horizon_cruiser");
    const events: RoundEvent[] = [];
    resolveEffects(board, [play("player", "drone_squadron")], events);
    expect(effectsOf(events, "drone_squadron")).toEqual([
      {
        kind: "effect",
        side: "player",
        cardId: "drone_squadron",
        ship: { side: "player", ...at("strike", 4), cardId: "drone" },
        effect: { type: "spawn" },
        after: { hp: 1, shield: 0 },
      },
      {
        kind: "effect",
        side: "player",
        cardId: "drone_squadron",
        ship: { side: "player", ...at("strike", 1), cardId: "drone" },
        effect: { type: "spawn" },
        after: { hp: 1, shield: 0 },
      },
    ]);
    expect(slotOf(board, "player", "strike", 4).arrived).toBe(true);

    const empty = new Board();
    resolveEffects(empty, [play("player", "drone_squadron")], []);
    expect(empty.ships("player").map((slot) => slot.index)).toEqual([2, 3]);

    const full = new Board();
    for (const index of [0, 1, 2, 3, 4, 5]) place(full, "player", "strike", index, "drone");
    const none: RoundEvent[] = [];
    resolveEffects(full, [play("player", "drone_squadron")], none);
    expect(none).toEqual([{ kind: "noEffect", side: "player", cardId: "drone_squadron" }]);
  });

  test("Drohnenstaffel: Die Drohnen haben in dieser Runde keinen Feuerbefehl; feuern können sie nur per Schwarmangriff", () => {
    const board = new Board();
    place(board, "enemy", "strike", 2, "horizon_cruiser");
    const idle = resolve(board, { command: order("drone_squadron") });
    expect(idle.some((event) => event.kind === "attack" || event.kind === "fizzle")).toBe(false);

    const swarming = new Board();
    place(swarming, "enemy", "strike", 2, "horizon_cruiser");
    const events = resolve(swarming, { command: order("drone_squadron"), power: { id: "swarm_strike", target: at("strike", 2) } });
    expect(attacksBy(events, "player").map((event) => [event.attacker.cardId, event.amount, event.swarm])).toEqual([
      ["drone", 2, true],
      ["drone", 2, true],
    ]);
  });
});

describe("Spezial", () => {
  test("Rammkurs: Ziel und Rammer nehmen die HP des anderen, der Schild fängt ab; der Rammer feuert nicht", () => {
    const board = new Board();
    const rammer = place(board, "player", "strike", 1, "horizon_cruiser");
    rammer.hp = 6;
    const target = place(board, "enemy", "strike", 2, "iron_dreadnought");
    place(board, "enemy", "command", 1, "repair_drone");
    place(board, "enemy", "strike", 1, "signal_booster");
    target.hp = 5;
    place(board, "player", "strike", 4, "plasma_frigate");
    const atTarget = [at("strike", 1), at("strike", 4)].map((ship) => fire(ship, at("strike", 2)));
    const events = resolve(board, { command: order("collision_course", at("strike", 1)), fire: atTarget });
    // Gleiche Slot-Nummer zuerst: der Signal Booster vor der gedeckten Repair Drone.
    expect(effectsOf(events, "collision_course")).toEqual([
      {
        kind: "effect",
        side: "player",
        cardId: "collision_course",
        ship: { side: "player", ...at("strike", 1), cardId: "horizon_cruiser" },
        effect: {
          type: "ram",
          target: { side: "enemy", ...at("strike", 1), cardId: "signal_booster" },
          dealt: 6,
          taken: 5,
          targetAfter: { hp: -1, shield: 0 },
        },
        after: { hp: 1, shield: 0 },
      },
    ]);
    expect(attacksBy(events, "player").map((event) => event.attacker.cardId)).toEqual(["plasma_frigate"]);
  });

  test("Rammkurs: sonst das nächstgelegene ungedeckte Schiff; der Schild fängt den Nennwert ab", () => {
    const board = new Board();
    place(board, "player", "strike", 1, "scrap_raider");
    const dreadnought = place(board, "enemy", "strike", 3, "iron_dreadnought");
    place(board, "enemy", "command", 0, "horizon_cruiser");
    const events = resolve(board, { command: order("collision_course", at("strike", 1)) });
    expect(effectsOf(events, "collision_course")).toMatchObject([{ effect: { target: { slotIndex: 0, lane: "command" }, dealt: 6, taken: 8 } }]);
    expect(dreadnought.hp).toBe(hp("iron_dreadnought"));

    const shielded = new Board();
    place(shielded, "player", "strike", 1, "scrap_raider");
    const tough = place(shielded, "enemy", "strike", 1, "iron_dreadnought");
    resolve(shielded, { command: order("collision_course", at("strike", 1)) });
    expect([tough.hp, tough.shield]).toEqual([hp("iron_dreadnought") - 4, 0]);
  });

  test("Rammkurs gegen ein Trugbild: Es fällt ohne Schrott, der Rammer nimmt 1", () => {
    const board = new Board();
    const rammer = place(board, "player", "strike", 2, "scrap_raider");
    const events = resolve(board, { command: order("collision_course", at("strike", 2)) }, { power: { id: "decoy", target: at("strike", 2) } });
    expect(effectsOf(events, "collision_course")).toMatchObject([{ effect: { target: { cardId: "decoy" }, dealt: 6, taken: 1 } }]);
    expect([rammer.hp, rammer.scrapBonus]).toEqual([5, 0]);
    expect(events.some((event) => event.kind === "vanish")).toBe(false);
  });

  test("Rammkurs ohne Ziel bleibt ohne Wirkung, der Rammer feuert dann", () => {
    const board = new Board();
    place(board, "player", "strike", 2, "scrap_raider");
    const events = resolve(board, { command: order("collision_course", at("strike", 2)) });
    expect(events).toContainEqual({ kind: "noEffect", side: "player", cardId: "collision_course" });
  });

  test("Rammkurs gegen Rammkurs: eine Kollision, gleich mit vertauschten Sitzen", () => {
    const { board, events } = mirrored(
      (board, a, b) => {
        place(board, a, "strike", 2, "scrap_raider");
        place(board, b, "strike", 2, "horizon_cruiser");
      },
      { command: order("collision_course", at("strike", 2)) },
      { command: order("collision_course", at("strike", 2)) },
    );
    expect(effectsOf(events, "collision_course")).toHaveLength(1);
    expect(board.ships("player")).toEqual([]);
    expect(slotOf(board, "enemy", "strike", 2).hp).toBe(2);
  });

  test("Rammkurs: Ziele und Beträge stehen vor dem ersten Rammstoß fest", () => {
    const board = new Board();
    place(board, "player", "strike", 0, "horizon_cruiser");
    place(board, "enemy", "strike", 1, "scrap_raider");
    place(board, "enemy", "strike", 0, "plasma_frigate");
    // Der Kreuzer rammt die Fregatte, der Raider den Kreuzer, beide mit den HP vor allen Rammstößen.
    const events = resolve(board, { command: order("collision_course", at("strike", 0)) }, { command: order("collision_course", at("strike", 1)) });
    expect(effectsOf(events, "collision_course").map((event) => event.effect)).toMatchObject([
      { target: { cardId: "plasma_frigate" }, dealt: 8, taken: 6 },
      { target: { cardId: "horizon_cruiser" }, dealt: 6, taken: 8 },
    ]);
    expect(board.ships("player")).toEqual([]);
  });

  test("Gegenmaßnahmen: Angriff und Schwächung der Gegenseite verpuffen, sonst ziehen sie einen Befehl", () => {
    const board = new Board();
    const ship = place(board, "player", "strike", 0, "horizon_cruiser");
    const torpedo = resolve(board, { command: order("countermeasures") }, { command: order("torpedo", at("strike", 0)) });
    expect(torpedo.filter((event) => event.kind !== "command" && "cardId" in event)).toEqual([
      { kind: "countered", side: "player", cardId: "countermeasures", countered: "torpedo" },
    ]);
    expect(ship.hp).toBe(hp("horizon_cruiser"));

    place(board, "enemy", "strike", 0, "repair_drone");
    const emp = resolve(board, { command: order("countermeasures"), fire: [fire(at("strike", 0), at("strike", 0))] }, { command: order("emp_blast") });
    expect(emp).toContainEqual({ kind: "countered", side: "player", cardId: "countermeasures", countered: "emp_blast" });
    expect(attacksBy(emp, "player")).toHaveLength(1);

    const shields = resolve(board, { command: order("countermeasures") }, { command: order("emergency_shields", at("strike", 0)) });
    expect(shields).toContainEqual({ kind: "draw", side: "player", cardId: "countermeasures", ships: 0, commands: 1 });
    expect(effectsOf(shields, "emergency_shields")).toHaveLength(1);
  });

  test("Gegenmaßnahmen auf beiden Seiten: Beide ziehen, gleich mit vertauschten Sitzen", () => {
    const { events } = mirrored(
      (board, a, b) => {
        place(board, a, "strike", 0, "horizon_cruiser");
        place(board, b, "strike", 1, "void_interceptor");
      },
      { command: order("countermeasures") },
      { command: order("countermeasures") },
    );
    expect(events.filter((event) => event.kind === "draw")).toHaveLength(2);
  });
});

describe("Schwächung", () => {
  test("Funkstille: entfernt jede gegnerische Fähigkeit dieser Runde, das Trugbild verschwindet sofort", () => {
    const cases = [
      { id: "counterfire", target: at("strike", 0), jammed: { side: "enemy", ...at("strike", 0), cardId: "horizon_cruiser" } },
      { id: "head_start", target: at("strike", 0), jammed: { side: "enemy", ...at("strike", 0), cardId: "horizon_cruiser" } },
      { id: "focus_fire", target: at("strike", 1), jammed: { side: "player", ...at("strike", 1), cardId: "horizon_cruiser" } },
      { id: "swarm_strike", target: at("strike", 1), jammed: { side: "player", ...at("strike", 1), cardId: "horizon_cruiser" } },
      { id: "decoy", target: at("strike", 3), jammed: { side: "enemy", ...at("strike", 3), cardId: "decoy" } },
    ] as const;
    for (const { id, target, jammed } of cases) {
      const board = new Board();
      place(board, "player", "strike", 1, "horizon_cruiser");
      place(board, "enemy", "strike", 0, "horizon_cruiser");
      place(board, "enemy", "strike", 5, "drone");
      const events = resolve(
        board,
        { command: order("radio_silence"), fire: [fire(at("strike", 1), at("strike", 0))] },
        { power: { id, target }, fire: [fire(at("strike", 0), at("strike", 1)), fire(at("strike", 5), at("strike", 1))] },
      );
      expect(effectsOf(events, "radio_silence")).toMatchObject([{ ship: jammed, effect: { type: "jam", power: id } }]);
      const kinds = events.map((event) => event.kind);
      expect(kinds).not.toContain("counterfire");
      expect(kinds).not.toContain("vanish");
      expect(events.some((event) => event.kind === "attack" && (event.focus || event.swarm || event.headStart))).toBe(false);
      expect(events.some((event) => event.kind === "destroyed" && event.ship.cardId === "decoy")).toBe(false);
    }
    const board = new Board();
    expect(resolve(board, { command: order("radio_silence") })).toContainEqual({ kind: "noEffect", side: "player", cardId: "radio_silence" });
  });

  test("Funkstille im Spiegelmatch: Die eigene Marke bleibt, gleich mit vertauschten Sitzen", () => {
    const counterfire = { id: "counterfire" as const, target: at("strike", 0) };
    const { board, events } = mirrored(
      (board, a, b) => {
        place(board, a, "strike", 0, "horizon_cruiser");
        place(board, b, "strike", 0, "horizon_cruiser");
      },
      { command: order("radio_silence"), power: counterfire, fire: [fire(at("strike", 0), at("strike", 0))] },
      { power: counterfire, fire: [fire(at("strike", 0), at("strike", 0))] },
    );
    expect(effectsOf(events, "radio_silence")).toMatchObject([{ ship: { side: "enemy" }, effect: { power: "counterfire" } }]);
    expect(slotOf(board, "player", "strike", 0).hp).toBe(6);
    expect(slotOf(board, "enemy", "strike", 0).hp).toBe(5);
  });

  test("Minenfeld: trifft Deploys, die Drohne des Titan Carriers und das Trugbild, nicht die Hive-Drohne der Vorrunde", () => {
    const board = new Board();
    place(board, "enemy", "command", 0, "hive");
    place(board, "enemy", "strike", 0, "drone");
    const events = resolve(
      board,
      { command: order("minefield") },
      { ships: [{ card: shipById("titan_carrier"), target: at("strike", 3) }], power: { id: "decoy", target: at("strike", 5) } },
    );
    expect(effectsOf(events, "minefield").map((event) => [event.ship.slotIndex, event.ship.cardId])).toEqual([
      [2, "drone"],
      [3, "titan_carrier"],
      [5, "decoy"],
    ]);
    expect(resolve(board, { command: order("minefield") })).toContainEqual({ kind: "noEffect", side: "player", cardId: "minefield" });
  });

  test("Minenfeld: Die Brutkammer setzt kein Flag, das in die nächste Runde reicht", () => {
    const board = new Board();
    place(board, "enemy", "command", 2, "hive");
    resolve(board);
    expect(board.ships("enemy").map((slot) => [slot.card!.id, slot.arrived])).toEqual([
      ["drone", false],
      ["hive", false],
    ]);
  });

  test("Traktorstrahl: zieht in die andere Lane, die Lane-Grenze gilt, eine Drohne braucht nur einen freien Slot", () => {
    const board = new Board();
    const cruiser = place(board, "enemy", "strike", 2, "horizon_cruiser");
    const events = resolve(board, { command: order("tractor_beam", at("strike", 2)) });
    expect(effectsOf(events, "tractor_beam")).toMatchObject([{ ship: { side: "enemy", ...at("strike", 2) }, effect: { type: "move", to: at("command", 2) } }]);
    expect(cruiser.card).toBeNull();
    expect(slotOf(board, "enemy", "command", 2).card?.id).toBe("horizon_cruiser");

    const full = new Board();
    for (const index of [0, 1, 2, 3]) place(full, "enemy", "command", index, "repair_drone");
    place(full, "enemy", "strike", 4, "horizon_cruiser");
    place(full, "enemy", "strike", 3, "drone");
    expect(resolve(full, { command: order("tractor_beam", at("strike", 4)) })).toContainEqual({ kind: "noEffect", side: "player", cardId: "tractor_beam" });
    const drone = resolve(full, { command: order("tractor_beam", at("strike", 3)) });
    expect(effectsOf(drone, "tractor_beam")).toMatchObject([{ effect: { to: at("command", 4) } }]);
  });

  test("Traktorstrahl auf beiden Seiten: gleich mit vertauschten Sitzen", () => {
    const { board } = mirrored(
      (board, a, b) => {
        place(board, a, "strike", 1, "horizon_cruiser");
        place(board, a, "command", 1, "repair_drone");
        place(board, b, "strike", 1, "void_interceptor");
        place(board, b, "strike", 2, "horizon_cruiser");
      },
      { command: order("tractor_beam", at("strike", 1)) },
      { command: order("tractor_beam", at("strike", 1)) },
    );
    expect(slotOf(board, "player", "command", 0).card?.id).toBe("horizon_cruiser");
    expect(slotOf(board, "enemy", "command", 1).card?.id).toBe("void_interceptor");
  });
});

describe("Angriff", () => {
  test("Wärmesucher: 3 Schaden am erfassten Schiff, auch gedeckt; ohne Bewegung", () => {
    const board = new Board();
    place(board, "enemy", "strike", 2, "horizon_cruiser");
    const covered = place(board, "enemy", "command", 2, "repair_drone");
    const events = resolve(board, { command: order("heat_seeker", at("command", 2)) });
    expect(effectsOf(events, "heat_seeker")).toMatchObject([{ effect: { type: "damage", amount: 3 } }]);
    expect(covered.hp).toBe(2);
  });

  test("Wärmesucher: Die Erfassung folgt dem Manöver und trifft mit 5", () => {
    const board = new Board();
    place(board, "enemy", "strike", 2, "iron_dreadnought");
    const events = resolve(board, { command: order("heat_seeker", at("strike", 2)) }, { maneuver: { ship: at("strike", 2), destination: at("command", 4) } });
    expect(events).toContainEqual({ kind: "command", side: "player", cardId: "heat_seeker", target: { side: "enemy", ...at("command", 4) } });
    expect(slotOf(board, "enemy", "command", 4).hp).toBe(hp("iron_dreadnought") - 3);
  });

  test("Gnadenstoß: 4 Schaden am Schiff mit den wenigsten HP, ohne Tokens", () => {
    const board = new Board();
    place(board, "enemy", "strike", 0, "drone");
    place(board, "enemy", "strike", 1, "horizon_cruiser");
    const weak = place(board, "enemy", "command", 3, "repair_drone");
    const events: RoundEvent[] = [];
    resolveEffects(board, [play("player", "coup_de_grace")], events);
    expect(effectsOf(events, "coup_de_grace")).toMatchObject([{ ship: { cardId: "repair_drone" }, effect: { type: "damage", amount: 4 } }]);
    expect(weak.hp).toBe(1);
  });

  test("Durchschlag: 3 am vordersten Schiff der Slot-Nummer, 2 am Command-Schiff dahinter; sonst nur das Command-Schiff; leer verfehlt", () => {
    const board = new Board();
    const front = place(board, "enemy", "strike", 1, "horizon_cruiser");
    const back = place(board, "enemy", "command", 1, "iron_dreadnought");
    const lone = place(board, "enemy", "command", 3, "horizon_cruiser");
    const strikeSlot = (index: number) => board.lane("enemy", "strike").slots[index]!;
    const events: RoundEvent[] = [];
    resolveEffects(board, [play("player", "piercing_shot", strikeSlot(1))], events);
    resolveEffects(board, [play("player", "piercing_shot", strikeSlot(3))], events);
    resolveEffects(board, [play("player", "piercing_shot", strikeSlot(5))], events);
    expect([front.hp, back.hp, back.shield, lone.hp]).toEqual([5, 12, 0, 5]);
    expect(events).toContainEqual({ kind: "miss", side: "player", cardId: "piercing_shot", target: { side: "enemy", ...at("strike", 5) } });
  });

  test("Bombardement: 2 an jedes Schiff der gegnerischen Command-Lane", () => {
    const board = new Board();
    const front = place(board, "enemy", "strike", 1, "horizon_cruiser");
    const ships = [place(board, "enemy", "command", 1, "horizon_cruiser"), place(board, "enemy", "command", 4, "repair_drone")];
    const events: RoundEvent[] = [];
    resolveEffects(board, [play("player", "bombardment")], events);
    expect([front.hp, ...ships.map((slot) => slot.hp)]).toEqual([8, 6, 3]);
    const none: RoundEvent[] = [];
    resolveEffects(new Board(), [play("player", "bombardment")], none);
    expect(none).toEqual([{ kind: "noEffect", side: "player", cardId: "bombardment" }]);
  });

  test("Kreuzfeuer: 3 an jedes gegnerische Schiff ohne Partner; Tokens zählen als Partner und als Ziel", () => {
    const board = new Board();
    place(board, "enemy", "strike", 0, "horizon_cruiser");
    place(board, "enemy", "command", 0, "horizon_cruiser");
    place(board, "enemy", "strike", 1, "horizon_cruiser");
    place(board, "enemy", "command", 2, "repair_drone");
    place(board, "enemy", "strike", 3, "drone");
    place(board, "enemy", "command", 3, "horizon_cruiser");
    place(board, "enemy", "strike", 5, "drone");
    const events: RoundEvent[] = [];
    resolveEffects(board, [play("player", "crossfire")], events);
    expect(effectsOf(events, "crossfire").map((event) => [event.ship.lane, event.ship.slotIndex])).toEqual([
      ["strike", 1],
      ["strike", 5],
      ["command", 2],
    ]);
  });
});

describe("Spielende", () => {
  test("Fällt ein Flaggschiff bei den Effects, endet die Runde sofort: kein Kampf, kein Cleanup", () => {
    const board = new Board();
    place(board, "player", "strike", 0, "horizon_cruiser");
    place(board, "enemy", "strike", 2, "vanguard").hp = 1;
    place(board, "enemy", "strike", 3, "horizon_cruiser");
    place(board, "enemy", "command", 3, "repair_drone");
    const events = resolve(
      board,
      { command: order("torpedo", at("strike", 2)), fire: [fire(at("strike", 0), at("strike", 3))] },
      { fire: [fire(at("strike", 3), at("strike", 0))] },
    );
    expect(events.at(-1)).toEqual({ kind: "destroyed", ship: { side: "enemy", ...at("strike", 2), cardId: "vanguard" } });
    expect(events.some((event) => event.kind === "attack")).toBe(false);
    expect(board.flagship("enemy")).toBeNull();
  });

  test("Fallen beide Flaggschiffe im selben Kampf, ist es unentschieden; danach folgt nichts mehr", () => {
    const board = new Board();
    const wounded = place(board, "player", "strike", 1, "horizon_cruiser");
    wounded.hp -= 1;
    place(board, "player", "strike", 0, "vanguard").hp = 1;
    place(board, "player", "command", 1, "repair_drone");
    place(board, "enemy", "strike", 0, "vanguard").hp = 1;
    place(board, "enemy", "strike", 1, "horizon_cruiser");
    const events = resolve(board, { fire: [fire(at("strike", 1), at("strike", 0))] }, { fire: [fire(at("strike", 1), at("strike", 0))] });
    expect(events.slice(-2)).toMatchObject([
      { kind: "destroyed", ship: { side: "player", cardId: "vanguard" } },
      { kind: "destroyed", ship: { side: "enemy", cardId: "vanguard" } },
    ]);
    expect(wounded.hp).toBe(hp("horizon_cruiser") - 1);
    expect([board.flagship("player"), board.flagship("enemy")]).toEqual([null, null]);
  });

  test("Fällt ein Flaggschiff durch Taktvorsprung, feuern die übrigen Schiffe nicht mehr", () => {
    const board = new Board();
    place(board, "player", "strike", 0, "void_interceptor");
    const own = place(board, "player", "strike", 1, "vanguard");
    own.hp = 1;
    place(board, "enemy", "strike", 0, "vanguard").hp = 1;
    place(board, "enemy", "strike", 1, "horizon_cruiser");
    const events = resolve(
      board,
      { power: { id: "head_start", target: at("strike", 0) }, fire: [fire(at("strike", 0), at("strike", 0))] },
      { fire: [fire(at("strike", 1), at("strike", 1))] },
    );
    expect(attacksBy(events, "enemy")).toEqual([]);
    expect(events.at(-1)).toMatchObject({ kind: "destroyed", ship: { side: "enemy", cardId: "vanguard" } });
    expect(board.flagship("player")).toBe(own);
  });
});
