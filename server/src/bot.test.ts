import { expect, test } from "bun:test";
import { Board, type LaneType, type Side, type Slot } from "../../shared/board.ts";
import { commandById, shipById, type CommandId, type ShipId } from "../../shared/cards.ts";
import { planBotTurn, type BotHands } from "./bot.ts";
import { Match } from "./match.ts";

function place(board: Board, side: Side, lane: LaneType, slotIndex: number, id: ShipId): Slot {
  return board.place(board.lane(side, lane), slotIndex, shipById(id))!;
}

function hands(ships: ShipId[], commands: CommandId[]): BotHands {
  return { side: "player", shipHand: ships.map(shipById), commandHand: commands.map(commandById) };
}

/** Ein Zug ab Runde 2, mit einem Schiff. */
function planTurn(board: Board, bot: BotHands) {
  return planBotTurn(board, bot, 2);
}

test("Bot gegen Bot: jeder Zug gilt und jede Partie endet", () => {
  // Der Overdrive lässt den Schaden steigen, bis Repair Drones nicht mehr mithalten.
  let stalemates = 0;
  for (let game = 0; game < 200; game++) {
    const match = new Match("bots");
    match.join("a");
    match.join("b");
    while (match.winner === null) {
      if (match.round === 100) {
        stalemates += 1;
        break;
      }
      for (const player of match.players) {
        expect(match.submit(player.seat, planBotTurn(match.board, player, match.round))).toBeNull();
      }
      match.resolveRound();
    }
  }
  expect(stalemates).toBe(0);
});

test("Auf leerem Brett kommt das stärkste Kampfschiff nach vorne in die Mitte", () => {
  const plan = planTurn(new Board(), hands(["repair_drone", "void_interceptor", "iron_dreadnought"], []));
  expect(plan.ships).toEqual([{ handIndex: 2, target: { lane: "strike", slotIndex: 2 } }]);
  expect(plan.command).toBeNull();
});

test("In Runde 1 legt der Bot zwei Schiffe, das zweite mit Rücksicht auf das erste", () => {
  const plan = planBotTurn(new Board(), hands(["repair_drone", "void_interceptor", "iron_dreadnought"], []), 1);
  // Der Jäger steht gedeckt hinter dem Dreadnought.
  expect(plan.ships).toEqual([
    { handIndex: 2, target: { lane: "strike", slotIndex: 2 } },
    { handIndex: 1, target: { lane: "command", slotIndex: 2 } },
  ]);
});

test("Jäger und Support kommen in die Command-Lane, sobald vorne ein Schiff steht; robuste Schiffe nach vorne", () => {
  const board = new Board();
  place(board, "player", "strike", 2, "iron_dreadnought");
  expect(planTurn(board, hands(["void_interceptor"], [])).ships[0]?.target.lane).toBe("command");
  expect(planTurn(board, hands(["repair_drone"], [])).ships[0]?.target.lane).toBe("command");
  expect(planTurn(board, hands(["horizon_cruiser"], [])).ships[0]?.target).toEqual({ lane: "strike", slotIndex: 3 });
});

test("Ist die bevorzugte Lane voll, weicht das Schiff aus; ist die Flotte voll, legt der Bot nichts", () => {
  const board = new Board();
  for (let i = 0; i < 4; i++) place(board, "player", "strike", i, "horizon_cruiser");
  expect(planTurn(board, hands(["horizon_cruiser"], [])).ships[0]?.target.lane).toBe("command");
  for (let i = 0; i < 2; i++) place(board, "player", "command", i, "horizon_cruiser");
  expect(planTurn(board, hands(["horizon_cruiser"], [])).ships).toEqual([]);
});

test("Ohne Gegner auf dem Brett zieht der Bot nach, statt ins Leere zu schießen", () => {
  const plan = planTurn(new Board(), hands(["void_interceptor"], ["orbital_strike", "scavenge"]));
  expect(plan.command).toEqual({ handIndex: 1, target: null, destination: null });
});

test("Ein Angriff, der einen Gegner zerstört, geht vor", () => {
  const board = new Board();
  place(board, "player", "strike", 2, "iron_dreadnought");
  place(board, "enemy", "strike", 2, "horizon_cruiser").hp = 4;
  expect(planTurn(board, hands([], ["scavenge", "orbital_strike"])).command).toEqual({ handIndex: 1, target: null, destination: null });
});

test("Der Schild geht an das schwächste ungedeckte Schiff", () => {
  const board = new Board();
  place(board, "player", "strike", 1, "iron_dreadnought");
  place(board, "player", "strike", 3, "horizon_cruiser");
  const fighter = place(board, "player", "command", 1, "void_interceptor");
  place(board, "enemy", "strike", 2, "plasma_frigate");
  // Der Jäger steht gedeckt hinter dem Dreadnought.
  expect(planTurn(board, hands([], ["emergency_shields"])).command).toEqual({
    handIndex: 0,
    target: { lane: "strike", slotIndex: 3 },
    destination: null,
  });
  // Ungedeckt ist er das schwächste Ziel.
  board.lane("player", "command").slots[2]!.takeFrom(fighter);
  expect(planTurn(board, hands([], ["emergency_shields"])).command).toEqual({
    handIndex: 0,
    target: { lane: "command", slotIndex: 2 },
    destination: null,
  });
});

test("Intercept holt nur aus der Command-Lane, Recall nur aus der Strike-Lane und nur, wenn vorne jemand bleibt", () => {
  const board = new Board();
  place(board, "player", "strike", 1, "horizon_cruiser").hp = 3;
  place(board, "player", "command", 4, "void_interceptor");
  place(board, "enemy", "strike", 2, "horizon_cruiser");

  expect(planTurn(board, hands([], ["intercept"])).command).toEqual({
    handIndex: 0,
    target: { lane: "command", slotIndex: 4 },
    destination: 4,
  });
  // Allein vorne: Recall würde die Command-Lane freilegen.
  expect(planTurn(board, hands([], ["recall"])).command).toBeNull();
  // Mit einem neuen Schiff vorne darf das angeschlagene zurück.
  const plan = planTurn(board, hands(["horizon_cruiser"], ["recall"]));
  expect(plan.ships[0]?.target.lane).toBe("strike");
  expect(plan.command).toEqual({ handIndex: 0, target: { lane: "strike", slotIndex: 1 }, destination: 1 });
});

test("Ein Schiff rückt vor, wenn es damit ein ungedecktes Schiff deckt", () => {
  const board = new Board();
  place(board, "player", "strike", 3, "iron_dreadnought");
  place(board, "player", "command", 2, "repair_drone");
  place(board, "player", "command", 3, "horizon_cruiser");
  place(board, "enemy", "strike", 2, "void_interceptor");
  // Der Kreuzer landet in Strike-Slot 2 und deckt damit die Drohne; die Drohne selbst würde nur vor ihren leeren Slot rücken.
  expect(planTurn(board, hands([], ["flanking_maneuver"])).command).toEqual({
    handIndex: 0,
    target: { lane: "command", slotIndex: 3 },
    destination: 2,
  });
});

test("Robuste Schiffe stellen sich vor ein ungedecktes Command-Schiff", () => {
  const board = new Board();
  place(board, "player", "strike", 2, "iron_dreadnought");
  place(board, "player", "command", 4, "repair_drone");
  expect(planTurn(board, hands(["horizon_cruiser"], [])).ships[0]?.target).toEqual({ lane: "strike", slotIndex: 4 });
});

test("Befehle ohne Nutzen bleiben auf der Hand", () => {
  const board = new Board();
  place(board, "player", "command", 2, "void_interceptor");
  place(board, "enemy", "command", 2, "repair_drone");
  // Power Surge ohne Schiff vorne, Jammer ohne gegnerische Strike-Schiffe, EMP gegen ein Schiff ohne ATK.
  expect(planTurn(board, hands([], ["power_surge", "targeting_jammer", "emp_blast"])).command).toBeNull();
});

test("Der Torpedo zielt auf den Slot des Gegners, der am meisten verliert, auch hinter Deckung", () => {
  const board = new Board();
  place(board, "player", "strike", 2, "iron_dreadnought");
  place(board, "enemy", "strike", 1, "titan_carrier");
  place(board, "enemy", "command", 1, "plasma_frigate").hp = 5;
  expect(planTurn(board, hands([], ["torpedo"])).command).toEqual({ handIndex: 0, target: { lane: "command", slotIndex: 1 }, destination: null });
});
