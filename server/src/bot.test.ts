import { expect, test } from "bun:test";
import { ADMIRAL_IDS, type AdmiralId } from "../../shared/admirals.ts";
import { Board, type LaneType, type Side, type Slot } from "../../shared/board.ts";
import { COMMANDS, type CommandId, commandById, deckCopies, type ShipId, shipById } from "../../shared/cards.ts";
import type { TurnPlan } from "../../shared/protocol.ts";
import { type BotView, planBotDraft, planBotTurn } from "./bot.ts";
import { Match } from "./match.ts";

function place(board: Board, side: Side, lane: LaneType, slotIndex: number, id: ShipId): Slot {
  return board.place(board.lane(side, lane), slotIndex, shipById(id))!;
}

/** Halvorsen braucht für seine Fähigkeit eigene Drohnen; ohne sie plant der Bot wie ohne Admiralsfähigkeit. */
function hands(ships: ShipId[], commands: CommandId[], admiral: AdmiralId = "halvorsen"): BotView {
  return {
    side: "player",
    admiral,
    shipHand: ships.map(shipById),
    commandHand: commands.map(commandById),
    opponent: { admiral: null, playedCommands: [], commandHandSize: 0, shipHandSize: 0 },
  };
}

/** Ein Zug ab Runde 2, mit einem Schiff; `random` steuert die seltenen Überraschungen (1: nie, 0: immer). */
function planTurn(board: Board, bot: BotView, random = () => 1) {
  return planBotTurn(board, bot, 2, random);
}

/** Ein Match (ab Runde 2), in dem Seat 0 nur die angegebenen Karten auf der Hand hat. */
function matchWith(ships: ShipId[], commands: CommandId[], round = 2, admiral: AdmiralId = "halvorsen"): Match {
  const match = new Match("bot");
  match.join("a");
  match.join("b");
  match.chooseAdmiral(0, admiral);
  match.chooseAdmiral(1, "halvorsen");
  match.round = round;
  const player = match.players[0]!;
  player.shipHand.splice(0, player.shipHand.length, ...ships.map(shipById));
  player.commandHand.splice(0, player.commandHand.length, ...commands.map(commandById));
  return match;
}

test("Bot gegen Bot: über 300 Partien mit allen Admiralen gilt jeder Zug und jede Partie endet", () => {
  // Der Overdrive lässt den Schaden steigen, bis Repair Drones nicht mehr mithalten.
  let stalemates = 0;
  for (let game = 0; game < 300; game++) {
    const match = new Match("bots");
    match.join("a");
    match.join("b");
    match.chooseAdmiral(0, ADMIRAL_IDS[game % ADMIRAL_IDS.length]!);
    match.chooseAdmiral(1, ADMIRAL_IDS[Math.floor(game / ADMIRAL_IDS.length) % ADMIRAL_IDS.length]!);
    while (match.winner === null) {
      if (match.round === 100) {
        stalemates += 1;
        break;
      }
      for (const player of match.players) {
        const offer = player.draftOffer;
        if (offer) expect(match.draft(player.seat, planBotDraft(match.board, match.botView(player.seat), offer))).toBeNull();
        expect(match.submit(player.seat, planBotTurn(match.board, match.botView(player.seat), match.round))).toBeNull();
      }
      match.resolveRound();
    }
  }
  expect(stalemates).toBe(0);
}, 30_000);

test("Auf leerem Brett kommt das stärkste Kampfschiff nach vorne in die Mitte", () => {
  const plan = planTurn(new Board(), hands(["repair_drone", "void_interceptor", "iron_dreadnought"], []));
  expect(plan.ships).toEqual([{ handIndex: 2, target: { lane: "strike", slotIndex: 2 } }]);
  expect(plan.command).toBeNull();
});

test("In Runde 1 kommt das Flaggschiff mittig in die Command-Lane, das robusteste Kampfschiff davor, und der Zug gilt", () => {
  const match = matchWith(["repair_drone", "void_interceptor", "iron_dreadnought"], [], 1);
  const plan = planBotTurn(match.board, match.botView(0), match.round, () => 1);
  expect(plan.flagship).toEqual({ lane: "command", slotIndex: 2 });
  // Hinter dem Dreadnought ist kein Command-Slot mehr frei: Der Jäger kommt daneben nach vorne.
  expect(plan.ships).toEqual([
    { handIndex: 2, target: { lane: "strike", slotIndex: 2 } },
    { handIndex: 1, target: { lane: "strike", slotIndex: 3 } },
  ]);
  // Beim Planen steht noch kein gegnerisches Schiff: In Runde 1 feuert niemand.
  expect(plan.fire).toEqual([]);
  expect(match.submit(0, plan)).toBeNull();
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
  const plan = planTurn(board, hands([], []));
  expect(plan.maneuver).toEqual({ ship: { lane: "strike", slotIndex: 2 }, destination: { lane: "command", slotIndex: 3 } });
  // Wer manövriert, feuert nicht und bekommt keinen Feuerbefehl.
  expect(plan.fire).toEqual([{ ship: { lane: "strike", slotIndex: 3 }, target: { lane: "strike", slotIndex: 2 } }]);
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
  const plan = planBotTurn(board, match.botView(0), match.round, () => 1);
  // Recall holt die erste Fregatte hinter die zweite; die zieht sich hinter den Dreadnought zurück,
  // weil Command-Slot 2 schon vergeben und Slot 1 nach dem Recall ungedeckt ist.
  expect(plan.command).toEqual({ handIndex: 0, target: { lane: "strike", slotIndex: 1 }, destination: 2 });
  expect(plan.maneuver).toEqual({ ship: { lane: "strike", slotIndex: 2 }, destination: { lane: "command", slotIndex: 3 } });
  expect(match.submit(0, plan)).toBeNull();
});

test("Der Torpedo zielt auf ein Schiff, das wohl stehen bleibt, selten auf den Slot, in den ein Gegner ausweicht", () => {
  const board = new Board();
  place(board, "player", "strike", 2, "iron_dreadnought");
  place(board, "player", "strike", 3, "horizon_cruiser");
  place(board, "enemy", "strike", 2, "plasma_frigate").hp = 3;
  place(board, "enemy", "strike", 3, "horizon_cruiser");
  // Die angeschlagene Fregatte fällt sonst im Kampf und weicht eher aus; der unbeschädigte Kreuzer bleibt. Ihr Schuss
  // zerstört kein eigenes Schiff, es lohnt also nicht, sie vor dem Kampf zu versenken.
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
  // Den Kreuzer kann der Gegner in dieser Runde nicht beschießen, aber er fängt den Schuss auf den Jäger dahinter ab.
  expect(planTurn(board, hands(["horizon_cruiser"], ["emergency_shields"])).command).toEqual({
    handIndex: 0,
    target: { lane: "strike", slotIndex: 2 },
    destination: null,
  });
  // Ohne Ziel für den Gegner ist der Schild auf dem frischen Schiff nichts wert.
  const empty = new Board();
  place(empty, "enemy", "strike", 2, "plasma_frigate");
  expect(planTurn(empty, hands(["horizon_cruiser"], ["emergency_shields"])).command).toBeNull();
});

test("Intercept holt einen frisch in die Command-Lane gelegten Jäger sofort nach vorne, und der Zug gilt", () => {
  const match = matchWith(["void_interceptor"], ["intercept"]);
  place(match.board, "player", "strike", 2, "iron_dreadnought");
  place(match.board, "enemy", "strike", 2, "horizon_cruiser");
  const plan = planBotTurn(match.board, match.botView(0), match.round, () => 1);
  expect(plan.ships).toEqual([{ handIndex: 0, target: { lane: "command", slotIndex: 2 } }]);
  expect(plan.command).toEqual({ handIndex: 0, target: { lane: "command", slotIndex: 2 }, destination: 1 });
  expect(match.submit(0, plan)).toBeNull();
});

test("Kerr markiert mit der Pendulum ein gegnerisches Schiff, aber nicht in der Runde, in der ihre Railgun feuert", () => {
  const board = new Board();
  place(board, "player", "command", 2, "pendulum");
  place(board, "player", "strike", 2, "iron_dreadnought");
  const target = place(board, "enemy", "strike", 3, "horizon_cruiser");
  expect(planTurn(board, hands([], [], "kerr")).mark).toEqual({ lane: "strike", slotIndex: 3 });
  target.marked = true;
  expect(planTurn(board, hands([], [], "kerr")).mark).toBeNull();
});

test("Vance setzt Fokusfeuer statt eines Manövers, wenn es im Kampf dieser Runde ein Schiff zerstört", () => {
  const board = new Board();
  place(board, "player", "strike", 0, "horizon_cruiser");
  place(board, "player", "strike", 4, "horizon_cruiser");
  place(board, "enemy", "strike", 0, "titan_carrier");
  place(board, "enemy", "strike", 2, "scrap_raider");
  const plan = planTurn(board, hands([], [], "vance"));
  expect([plan.power, plan.maneuver]).toEqual([{ target: { lane: "strike", slotIndex: 2 } }, null]);
});

test("Das Flaggschiff geht in Deckung, wenn es ungedeckt unter Beschuss steht", () => {
  const board = new Board();
  place(board, "player", "command", 0, "bastion");
  place(board, "player", "strike", 3, "horizon_cruiser");
  place(board, "enemy", "strike", 0, "horizon_cruiser");
  place(board, "enemy", "strike", 1, "plasma_frigate");
  // Hinter dem Kreuzer fängt er die Schüsse auf die Bastion ab; das bringt mehr als Gegenfeuer.
  expect(planTurn(board, hands([], [], "osei")).maneuver).toEqual({ ship: { lane: "command", slotIndex: 0 }, destination: { lane: "command", slotIndex: 3 } });
});

test("Die Mirage tauscht ungedeckt unter Beschuss mit einem robusten Schiff in Deckung", () => {
  const board = new Board();
  place(board, "player", "strike", 1, "mirage");
  place(board, "player", "strike", 2, "iron_dreadnought");
  place(board, "player", "command", 2, "titan_carrier");
  place(board, "enemy", "strike", 1, "horizon_cruiser");
  const plan = planTurn(board, hands([], [], "moreau"));
  expect(plan.maneuver).toEqual({ ship: { lane: "strike", slotIndex: 1 }, destination: { lane: "command", slotIndex: 2 } });
  // Beim Phasentausch feuern beide.
  expect(plan.fire.map((order) => order.ship)).toEqual(
    expect.arrayContaining([
      { lane: "strike", slotIndex: 1 },
      { lane: "command", slotIndex: 2 },
    ]),
  );
});

test("Ein markiertes Schiff, das die gegnerische Railgun zerstören würde, geht in Deckung", () => {
  const board = new Board();
  place(board, "player", "command", 0, "plasma_frigate").marked = true;
  place(board, "player", "strike", 3, "iron_dreadnought");
  place(board, "enemy", "command", 2, "pendulum");
  expect(planTurn(board, hands([], [], "osei")).maneuver).toEqual({ ship: { lane: "command", slotIndex: 0 }, destination: { lane: "command", slotIndex: 3 } });
});

test("Der Kurzsprung rettet das Flaggschiff, wenn kein Notschild reicht; reicht einer, bekommt es den Schild", () => {
  const board = new Board();
  place(board, "player", "strike", 2, "hive").hp = 3;
  place(board, "enemy", "strike", 2, "plasma_frigate");
  expect(planTurn(board, hands([], ["micro_jump", "emergency_shields"])).command).toEqual({
    handIndex: 1,
    target: { lane: "strike", slotIndex: 2 },
    destination: null,
  });
  // Hält der Gegner noch Befehle, droht zusätzlich sein Torpedo: Gegen 3 + 5 Schaden hilft nur der Sprung.
  const bot = hands([], ["micro_jump", "emergency_shields"]);
  const armed = { ...bot, opponent: { ...bot.opponent, commandHandSize: 3 } };
  expect(planTurn(board, armed).command).toEqual({ handIndex: 0, target: { lane: "strike", slotIndex: 2 }, destination: null });
});

test("Mit Schnellverlegung legt der Bot zwei Schiffe, und der Zug gilt", () => {
  const match = matchWith(["horizon_cruiser", "iron_dreadnought"], ["rapid_deployment"]);
  place(match.board, "enemy", "strike", 2, "horizon_cruiser");
  const plan = planBotTurn(match.board, match.botView(0), match.round, () => 1);
  expect(plan.command).toEqual({ handIndex: 0, target: null, destination: null });
  expect(plan.ships.map((ship) => ship.handIndex).sort()).toEqual([0, 1]);
  expect(match.submit(0, plan)).toBeNull();
});

test("Mit Freier Hand plant der Bot Grundmanöver und Admiralsfähigkeit, und der Zug gilt", () => {
  const match = matchWith([], ["carte_blanche"], 2, "vance");
  const { board } = match;
  place(board, "player", "strike", 0, "horizon_cruiser");
  place(board, "player", "strike", 4, "horizon_cruiser");
  place(board, "player", "command", 1, "repair_drone");
  place(board, "enemy", "strike", 0, "titan_carrier");
  place(board, "enemy", "strike", 2, "scrap_raider");
  const plan = planBotTurn(board, match.botView(0), match.round, () => 1);
  expect(plan.command).toEqual({ handIndex: 0, target: null, destination: null });
  // Die Drohne geht hinter einen Kreuzer in Deckung, das Fokusfeuer liegt auf dem Scrap Raider.
  expect(plan.maneuver?.ship).toEqual({ lane: "command", slotIndex: 1 });
  expect(plan.power).toEqual({ target: { lane: "strike", slotIndex: 2 } });
  expect(match.submit(0, plan)).toBeNull();
});

test("Rammkurs mit einem großen Schiff gegen ein kleineres, nie mit einem kleinen gegen ein großes", () => {
  const board = new Board();
  place(board, "player", "strike", 2, "iron_dreadnought");
  place(board, "enemy", "strike", 2, "void_interceptor");
  expect(planTurn(board, hands([], ["collision_course"])).command).toEqual({ handIndex: 0, target: { lane: "strike", slotIndex: 2 }, destination: null });

  const small = new Board();
  place(small, "player", "strike", 2, "scrap_raider");
  place(small, "enemy", "strike", 2, "iron_dreadnought");
  expect(planTurn(small, hands([], ["collision_course"])).command).toBeNull();
});

test("Der Traktorstrahl zieht den Wächter vor dem gegnerischen Flaggschiff weg, und der Zug gilt", () => {
  const match = matchWith([], ["tractor_beam"]);
  const { board } = match;
  for (const index of [1, 2, 3]) place(board, "player", "strike", index, "horizon_cruiser");
  place(board, "player", "command", 2, "hive");
  place(board, "enemy", "command", 2, "hive");
  place(board, "enemy", "strike", 2, "horizon_cruiser");
  place(board, "enemy", "strike", 4, "scrap_raider");
  const plan = planBotTurn(board, match.botView(0), match.round, () => 1);
  expect(plan.command).toEqual({ handIndex: 0, target: { lane: "strike", slotIndex: 2 }, destination: null });
  expect(match.submit(0, plan)).toBeNull();
});

test("Gegenmaßnahmen, solange der Gegner viele Angriffe übrig hat; hat er keine mehr, zieht der Bot lieber", () => {
  const bot = hands([], ["scavenge", "countermeasures"]);
  const armed = { ...bot, opponent: { ...bot.opponent, commandHandSize: 6 } };
  expect(planTurn(new Board(), armed).command?.handIndex).toBe(1);
  const hostile = COMMANDS.filter((card) => card.commandType === "attack" || card.commandType === "debuff").flatMap((card) =>
    Array<CommandId>(deckCopies(card)).fill(card.id),
  );
  const spent = { ...bot, opponent: { ...armed.opponent, playedCommands: hostile } };
  expect(planTurn(new Board(), spent).command?.handIndex).toBe(0);
});

test("Gegen den letzten Gegner ohne Partner trifft Kreuzfeuer, gegen die Command-Lane das Bombardement", () => {
  const board = new Board();
  place(board, "player", "strike", 2, "iron_dreadnought");
  place(board, "enemy", "strike", 1, "horizon_cruiser");
  place(board, "enemy", "command", 1, "repair_drone").hp = 2;
  place(board, "enemy", "command", 3, "repair_drone").hp = 2;
  // Bombardement zerstört beide Drohnen hinten; Kreuzfeuer trifft nur die ungepaarte in Slot 3.
  expect(planTurn(board, hands([], ["crossfire", "bombardment"])).command?.handIndex).toBe(1);
});

// --- Feuerbefehle ---

/** Ein Zug ohne Schiff, Befehl und Feuer. */
const PASS: TurnPlan = { ships: [], command: null, maneuver: null, flagship: null, power: null, mark: null, fire: [] };

test("Fällt das gegnerische Flaggschiff, zielen so viele darauf, wie es braucht; die übrigen nehmen andere Ziele", () => {
  const match = matchWith([], []);
  const { board } = match;
  for (const index of [1, 2, 3]) place(board, "player", "strike", index, "horizon_cruiser");
  place(board, "player", "strike", 4, "void_interceptor");
  place(board, "player", "command", 3, "hive");
  place(board, "enemy", "command", 2, "hive").hp = 4;
  place(board, "enemy", "strike", 0, "drone");
  const plan = planBotTurn(board, match.botView(0), match.round, () => 1);
  // Interceptor und Hive reichen für die 4 HP, ein Kreuzer schießt die Drohne ab, die übrigen zielen zur Sicherheit aufs Flaggschiff.
  expect(plan.fire).toHaveLength(5);
  expect(plan.fire.filter((order) => order.target.lane === "strike")).toHaveLength(1);
  expect(match.submit(0, plan)).toBeNull();
  expect(match.submit(1, PASS)).toBeNull();
  const destroyed = match.resolveRound().flatMap((event) => (event.kind === "destroyed" ? [event.ship.cardId] : []));
  expect(destroyed.sort()).toEqual(["drone", "hive"]);
});

test("Er verteilt das Feuer, statt Schaden zu verschenken", () => {
  const board = new Board();
  place(board, "player", "strike", 1, "horizon_cruiser");
  place(board, "player", "strike", 2, "horizon_cruiser");
  place(board, "enemy", "strike", 1, "void_interceptor").hp = 2;
  place(board, "enemy", "strike", 3, "void_interceptor").hp = 2;
  // Jeder Kreuzer reicht für einen Jäger; ein zweiter Schuss auf denselben verpuffte.
  expect(
    planTurn(board, hands([], []))
      .fire.map((order) => order.target.slotIndex)
      .sort(),
  ).toEqual([1, 3]);
});

test("Feuerbefehle gibt es für eigene Kampfschiffe, auch ein frisch gelegtes, auf gegnerische Schiffe; der Zug gilt", () => {
  const match = matchWith(["void_interceptor"], []);
  place(match.board, "player", "strike", 2, "iron_dreadnought");
  place(match.board, "player", "command", 2, "repair_drone");
  place(match.board, "enemy", "strike", 2, "horizon_cruiser");
  const plan = planBotTurn(match.board, match.botView(0), match.round, () => 1);
  // Die Repair Drone greift nie an; Dreadnought und der gelegte Jäger feuern auf den Kreuzer.
  expect(plan.ships).toEqual([{ handIndex: 0, target: { lane: "strike", slotIndex: 3 } }]);
  expect(plan.fire).toEqual([
    { ship: { lane: "strike", slotIndex: 2 }, target: { lane: "strike", slotIndex: 2 } },
    { ship: { lane: "strike", slotIndex: 3 }, target: { lane: "strike", slotIndex: 2 } },
  ]);
  expect(match.submit(0, plan)).toBeNull();
});

test("Schüsse auf ein gedecktes Schiff rechnet er dem Schiff davor zu", () => {
  const board = new Board();
  place(board, "player", "strike", 1, "void_interceptor");
  place(board, "player", "strike", 2, "horizon_cruiser");
  place(board, "enemy", "command", 2, "hive").hp = 2;
  place(board, "enemy", "strike", 2, "horizon_cruiser");
  place(board, "enemy", "strike", 4, "void_interceptor").hp = 3;
  // Die Hive fiele mit einem Schuss, doch der Kreuzer davor fängt ihn ab: Der Jäger schießt den Interceptor ab, der
  // eigene Kreuzer beschädigt den gegnerischen.
  expect(planTurn(board, hands([], [])).fire).toEqual([
    { ship: { lane: "strike", slotIndex: 1 }, target: { lane: "strike", slotIndex: 4 } },
    { ship: { lane: "strike", slotIndex: 2 }, target: { lane: "strike", slotIndex: 2 } },
  ]);
});

test("Der Torpedo räumt die Deckung vor dem gegnerischen Flaggschiff weg, wenn das Feuer es danach zerstört", () => {
  const board = new Board();
  place(board, "player", "strike", 1, "horizon_cruiser");
  place(board, "player", "strike", 2, "void_interceptor");
  place(board, "player", "strike", 3, "horizon_cruiser");
  place(board, "enemy", "command", 2, "hive").hp = 6;
  place(board, "enemy", "strike", 2, "horizon_cruiser").hp = 5;
  const plan = planTurn(board, hands([], ["torpedo"]));
  expect(plan.command).toEqual({ handIndex: 0, target: { lane: "strike", slotIndex: 2 }, destination: null });
  // Ohne Deckung reichen 2 + 3 + 2 für die 6 HP: Alle zielen auf die Hive.
  expect(plan.fire.map((order) => order.target)).toEqual(Array(3).fill({ lane: "command", slotIndex: 2 }));
});

test("Kerr gibt Taktvorsprung dem Schiff, das einen gegnerischen Schützen abschießt, bevor er feuert", () => {
  const board = new Board();
  place(board, "player", "command", 2, "pendulum");
  place(board, "player", "strike", 2, "void_interceptor").hp = 3;
  place(board, "player", "strike", 3, "horizon_cruiser");
  place(board, "enemy", "strike", 2, "void_interceptor").hp = 3;
  const plan = planTurn(board, hands([], [], "kerr"));
  expect(plan.power).toEqual({ target: { lane: "strike", slotIndex: 2 } });
  expect(plan.fire).toContainEqual({ ship: { lane: "strike", slotIndex: 2 }, target: { lane: "strike", slotIndex: 2 } });
});

test("Drohnen, die den Schwarmangriff fliegen, zielen auch per Feuerbefehl auf sein Ziel", () => {
  const board = new Board();
  place(board, "player", "command", 2, "hive");
  place(board, "player", "strike", 1, "drone");
  place(board, "player", "strike", 3, "drone");
  place(board, "enemy", "strike", 2, "iron_dreadnought");
  place(board, "enemy", "command", 2, "scrap_raider").hp = 3;
  // Hinter dem Dreadnought erreicht nur der Schwarmangriff den angeschlagenen Raider: 2 × (1 + 1) Schaden.
  const plan = planTurn(board, hands([], []));
  expect(plan.power).toEqual({ target: { lane: "command", slotIndex: 2 } });
  for (const slotIndex of [1, 3]) expect(plan.fire).toContainEqual({ ship: { lane: "strike", slotIndex }, target: { lane: "command", slotIndex: 2 } });
});
