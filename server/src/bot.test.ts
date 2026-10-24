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

/** Ein Zug ab Runde 2, mit einem Schiff; `random` steuert die seltenen Überraschungen (1: nie, 0: immer). */
function planTurn(board: Board, bot: BotHands, random = () => 1) {
  return planBotTurn(board, bot, 2, random);
}

/** Ein Match in Runde 2, in dem Seat 0 nur die angegebenen Karten auf der Hand hat. */
function matchWith(ships: ShipId[], commands: CommandId[]): Match {
  const match = new Match("bot");
  match.join("a");
  match.join("b");
  match.round = 2;
  const player = match.players[0]!;
  player.shipHand.splice(0, player.shipHand.length, ...ships.map(shipById));
  player.commandHand.splice(0, player.commandHand.length, ...commands.map(commandById));
  return match;
}

test("Bot gegen Bot: über 300 Partien gilt jeder Zug und jede Partie endet", () => {
  // Der Overdrive lässt den Schaden steigen, bis Repair Drones nicht mehr mithalten.
  let stalemates = 0;
  for (let game = 0; game < 300; game++) {
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

test("Ein angeschlagenes Strike-Schiff, das sonst fällt, zieht sich hinter ein anderes zurück", () => {
  const board = new Board();
  place(board, "player", "strike", 2, "plasma_frigate").hp = 2;
  place(board, "player", "strike", 3, "iron_dreadnought");
  const enemy = place(board, "enemy", "strike", 2, "void_interceptor");
  expect(planTurn(board, hands([], [])).maneuver).toEqual({ ship: { lane: "strike", slotIndex: 2 }, destination: { lane: "command", slotIndex: 3 } });
  // Zerstört sein Schuss den Gegner, ist er mehr wert als die 2 HP: Die Fregatte bleibt und tauscht.
  enemy.hp = 3;
  expect(planTurn(board, hands([], [])).maneuver).toBeNull();
});

test("Ein ungedecktes Support-Schiff hinten rückt innerhalb der Lane hinter ein Strike-Schiff", () => {
  const board = new Board();
  place(board, "player", "strike", 2, "iron_dreadnought");
  place(board, "player", "command", 0, "repair_drone");
  place(board, "enemy", "strike", 2, "void_interceptor");
  expect(planTurn(board, hands([], [])).maneuver).toEqual({ ship: { lane: "command", slotIndex: 0 }, destination: { lane: "command", slotIndex: 2 } });
  // Ist es schon gedeckt, bleibt es stehen.
  const covered = new Board();
  place(covered, "player", "strike", 2, "iron_dreadnought");
  place(covered, "player", "command", 2, "repair_drone");
  place(covered, "enemy", "strike", 2, "void_interceptor");
  expect(planTurn(covered, hands([], [])).maneuver).toBeNull();
});

test("Das einzige angriffsfähige Schiff manövriert nicht", () => {
  const board = new Board();
  place(board, "player", "strike", 2, "plasma_frigate").hp = 2;
  place(board, "player", "strike", 3, "repair_drone");
  place(board, "enemy", "strike", 2, "void_interceptor");
  // Rückzug nur, wenn vorne ein Angreifer bleibt; die Drohne zählt nicht.
  expect(planTurn(board, hands([], [])).maneuver).toBeNull();

  const alone = new Board();
  place(alone, "player", "strike", 2, "plasma_frigate");
  place(alone, "enemy", "strike", 2, "void_interceptor");
  // Auch dem vermuteten Torpedo weicht es nicht aus, wenn sonst niemand feuert.
  expect(planTurn(alone, hands([], []), () => 0).maneuver).toBeNull();
});

test("Manöver und Bewegungsbefehl verlegen verschiedene Schiffe in verschiedene Slots, und der Zug gilt", () => {
  const match = matchWith([], ["recall"]);
  const { board } = match;
  place(board, "player", "strike", 1, "plasma_frigate").hp = 2;
  place(board, "player", "strike", 2, "plasma_frigate").hp = 2;
  place(board, "player", "strike", 3, "iron_dreadnought");
  place(board, "enemy", "strike", 1, "void_interceptor");
  place(board, "enemy", "strike", 2, "void_interceptor");
  const plan = planBotTurn(board, match.players[0]!, match.round, () => 1);
  // Recall holt die erste Fregatte hinter die zweite; die zieht sich hinter den Dreadnought zurück,
  // weil Command-Slot 2 schon vergeben und Slot 1 nach dem Recall ungedeckt ist.
  expect(plan.command).toEqual({ handIndex: 0, target: { lane: "strike", slotIndex: 1 }, destination: 2 });
  expect(plan.maneuver).toEqual({ ship: { lane: "strike", slotIndex: 2 }, destination: { lane: "command", slotIndex: 3 } });
  expect(match.submit(0, plan)).toBeNull();
});

test("Der Torpedo zielt auf ein Schiff, das wohl stehen bleibt, selten auf den Slot, in den ein Gegner ausweicht", () => {
  const board = new Board();
  place(board, "player", "strike", 2, "iron_dreadnought");
  place(board, "player", "strike", 3, "void_interceptor");
  place(board, "enemy", "strike", 2, "plasma_frigate").hp = 3;
  place(board, "enemy", "strike", 3, "horizon_cruiser");
  // Die angeschlagene Fregatte fällt sonst im Kampf und weicht eher aus; der unbeschädigte Kreuzer bleibt.
  expect(planTurn(board, hands([], ["torpedo"])).command).toEqual({ handIndex: 0, target: { lane: "strike", slotIndex: 3 }, destination: null });
  // Ab und zu zielt er auf den gedeckten Slot hinter dem Kreuzer, in den sich die Fregatte zurückziehen würde.
  expect(planTurn(board, hands([], ["torpedo"]), () => 0).command).toEqual({
    handIndex: 0,
    target: { lane: "command", slotIndex: 3 },
    destination: null,
  });
});

test("Sperrfeuer lohnt sich, wenn ein angeschlagener Gegner sonst fällt und eher ausweicht", () => {
  const board = new Board();
  place(board, "player", "strike", 2, "iron_dreadnought");
  const enemy = place(board, "enemy", "strike", 2, "plasma_frigate");
  // Gegen ein unbeschädigtes Schiff hat es nur einen kleinen Grundwert; Nachziehen ist mehr wert.
  expect(planTurn(board, hands([], ["scavenge", "barrage"])).command?.handIndex).toBe(0);
  enemy.hp = 2;
  expect(planTurn(board, hands([], ["scavenge", "barrage"])).command?.handIndex).toBe(1);
});

test("Overcharge und Schild gehen auch an ein Kampfschiff, das gerade vorne landet", () => {
  const board = new Board();
  place(board, "player", "command", 2, "void_interceptor");
  place(board, "enemy", "strike", 2, "plasma_frigate");
  // Der Dreadnought deckt den Jäger und übersteht Overcharge samt Treffer.
  const overcharge = planTurn(board, hands(["iron_dreadnought"], ["overcharge"]));
  expect(overcharge.ships).toEqual([{ handIndex: 0, target: { lane: "strike", slotIndex: 2 } }]);
  expect(overcharge.command).toEqual({ handIndex: 0, target: { lane: "strike", slotIndex: 2 }, destination: null });

  const empty = new Board();
  place(empty, "enemy", "strike", 2, "plasma_frigate");
  expect(planTurn(empty, hands(["horizon_cruiser"], ["emergency_shields"])).command).toEqual({
    handIndex: 0,
    target: { lane: "strike", slotIndex: 2 },
    destination: null,
  });
});

test("Intercept holt einen frisch in die Command-Lane gelegten Jäger sofort nach vorne, und der Zug gilt", () => {
  const match = matchWith(["void_interceptor"], ["intercept"]);
  place(match.board, "player", "strike", 2, "iron_dreadnought");
  place(match.board, "enemy", "strike", 2, "horizon_cruiser");
  const plan = planBotTurn(match.board, match.players[0]!, match.round, () => 1);
  expect(plan.ships).toEqual([{ handIndex: 0, target: { lane: "command", slotIndex: 2 } }]);
  expect(plan.command).toEqual({ handIndex: 0, target: { lane: "command", slotIndex: 2 }, destination: 1 });
  expect(match.submit(0, plan)).toBeNull();
});
