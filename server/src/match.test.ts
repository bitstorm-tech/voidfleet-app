import { expect, test } from "bun:test";
import type { AdmiralId } from "../../shared/admirals.ts";
import type { RoundEvent, SlotTarget, TurnPlan } from "../../shared/protocol.ts";
import { commandById, SHIPS, shipById, type ShipCard } from "../../shared/cards.ts";
import { Match } from "./match.ts";

const strike = (slotIndex: number): SlotTarget => ({ lane: "strike", slotIndex });
const command = (slotIndex: number): SlotTarget => ({ lane: "command", slotIndex });

/** Ein Zug; ohne Angaben passt er (in Runde 1 fehlt dann noch das Flaggschiff). */
function plan(parts: Partial<TurnPlan> = {}): TurnPlan {
  return { ships: [], command: null, maneuver: null, flagship: null, power: null, mark: null, fire: [], ...parts };
}

const pass = plan();
const deploy = plan({ ships: [{ handIndex: 0, target: strike(0) }] });
const interceptor = { kind: "ship" as const, id: "void_interceptor" as const, shipClass: "fighter" as const, hp: 3, atk: 3, shield: 0 };

/** Beide sitzen und haben ihren Admiral gewählt: Runde 1 kann beginnen. */
function newMatch(admirals: [AdmiralId, AdmiralId] = ["osei", "osei"], random?: () => number): Match {
  const match = new Match("test", random);
  match.join("a");
  match.join("b");
  match.chooseAdmiral(0, admirals[0]);
  match.chooseAdmiral(1, admirals[1]);
  return match;
}

/** Ein Match in Runde 2, auf dem Brett noch ohne Flaggschiffe; für eine einzelne Runde genügt das, danach ist es vorbei. */
function midGame(admirals?: [AdmiralId, AdmiralId], random?: () => number): Match {
  const match = newMatch(admirals, random);
  match.round = 2;
  return match;
}

function playRound(match: Match, plans = [pass, pass]): RoundEvent[] {
  expect(match.submit(0, plans[0]!)).toBeNull();
  expect(match.submit(1, plans[1]!)).toBeNull();
  return match.resolveRound();
}

/** Ersetzt die Schiffshände und leert die Schiffsdecks, damit kein Nachschub kommt. */
function setShipHands(match: Match, ...hands: ShipCard[][]): void {
  for (const [seat, player] of match.players.entries()) {
    player.shipHand.splice(0, player.shipHand.length, ...hands[seat]!);
    while (player.shipDeck.draw() !== null);
  }
}

test("Ereignisse für Seat 1 sind gespiegelt, auch in verschachtelten Schiffen", () => {
  const match = newMatch();
  const events = [
    { kind: "attack" as const, amount: 2, after: { hp: 1, shield: 0 },
      attacker: { side: "player" as const, lane: "strike" as const, slotIndex: 0, cardId: "horizon_cruiser" as const },
      target: { side: "enemy" as const, lane: "strike" as const, slotIndex: 1, cardId: "repair_drone" as const } },
  ];
  expect(match.eventsFor(1, events)).toEqual([
    { ...events[0]!, attacker: { ...events[0]!.attacker, side: "enemy" }, target: { ...events[0]!.target, side: "player" } },
  ]);
});

test("Vor Runde 1 wählt jeder einmal seinen Admiral, auch solange der Gegner fehlt; sehen kann ihn der Gegner erst, wenn beide gewählt haben", () => {
  const match = new Match("test");
  match.join("a");
  const opening = plan({ flagship: command(2) });
  expect(match.submit(0, opening)).toBe("admiral_required");
  expect(match.chooseAdmiral(0, "kerr")).toBeNull();
  expect(match.chooseAdmiral(0, "osei")).toBe("admiral_already_chosen");
  expect(match.view(0).admiral).toBe("kerr");
  expect(match.submit(0, opening)).toBe("opponent_missing");

  match.join("b");
  expect(match.submit(0, opening)).toBe("opponent_choosing");
  expect(match.submit(1, opening)).toBe("admiral_required");
  expect([match.view(1).admiral, match.view(1).opponent?.admiral]).toEqual([null, null]);
  expect(match.chooseAdmiral(1, "kerr")).toBeNull();
  expect([match.view(0).opponent?.admiral, match.view(1).opponent?.admiral]).toEqual(["kerr", "kerr"]);
  expect(match.submit(0, opening)).toBeNull();
});

test("Der Computergegner nimmt den freien Platz, wählt sofort seinen Admiral und zieht, sobald der Spieler abgibt", () => {
  const match = new Match("test", () => 0.99);
  match.join("a");
  expect(match.addBot()).toBe(1);
  expect(match.addBot()).toBeNull();
  expect(match.join("c")).toBeNull();
  expect(match.players[1]!.admiral).toBe("kerr");
  expect(match.view(0).opponent).toMatchObject({ admiral: null, submitted: false, playedCommands: [] });
  // Die Hände sind gemischt; ohne Schnellverlegung legt der Bot in Runde 1 genau zwei Schiffe.
  const bot = match.players[1]!;
  bot.commandHand.splice(0, bot.commandHand.length, commandById("emergency_shields"));

  const opening = plan({ ...deploy, flagship: command(2) });
  expect(match.submit(0, opening)).toBe("admiral_required");
  match.chooseAdmiral(0, "osei");
  expect(match.view(0).opponent?.admiral).toBe("kerr");
  expect(match.submit(0, opening)).toBeNull();
  expect(match.isRoundComplete).toBe(true);
  const events = match.resolveRound();
  // In Runde 1 legt auch der Bot sein Flaggschiff und zwei Schiffe.
  expect(events.flatMap((event) => (event.kind === "deploy" && event.side === "enemy" ? [event.cardId] : []))).toEqual([
    "pendulum",
    expect.any(String),
    expect.any(String),
  ]);
  expect(match.winner).toBeNull();
  expect(match.round).toBe(2);
});

test("In Runde 1 legt jeder sein Flaggschiff zusätzlich zu bis zu zwei Schiffen, in verschiedene Slots, danach nie mehr", () => {
  const match = newMatch(["vance", "kerr"]);
  const twoShips = (first: SlotTarget, second: SlotTarget, flagship: SlotTarget | null = command(5)): TurnPlan =>
    plan({ ships: [{ handIndex: 0, target: first }, { handIndex: 1, target: second }], flagship });
  const threeShips = plan({ ships: [0, 1, 2].map((handIndex) => ({ handIndex, target: strike(handIndex) })), flagship: command(5) });
  expect(match.submit(0, threeShips)).toBe("too_many_ships");
  expect(match.submit(0, twoShips(strike(2), strike(3), null))).toBe("flagship_required");
  expect(match.submit(0, twoShips(strike(2), strike(2)))).toBe("slot_unavailable");
  expect(match.submit(0, twoShips(strike(2), strike(3), strike(3)))).toBe("slot_unavailable");
  expect(match.submit(0, { ...twoShips(strike(2), strike(3)), ships: [{ handIndex: 1, target: strike(2) }, { handIndex: 1, target: strike(3) }] })).toBe("ship_not_in_hand");
  expect(match.submit(0, twoShips(strike(2), command(2)))).toBeNull();
  match.submit(1, twoShips(strike(1), strike(4), command(1)));
  const deploys = match.resolveRound().filter((event) => event.kind === "deploy");
  expect(deploys.filter((event) => event.side === "player")).toMatchObject([{ cardId: "vanguard", target: command(5) }, {}, {}]);
  expect(deploys.filter((event) => event.side === "enemy")).toMatchObject([{ cardId: "pendulum", target: command(1) }, {}, {}]);
  expect(match.players[0]!.shipHand).toHaveLength(3);
  expect(match.submit(0, twoShips(strike(0), strike(5), null))).toBe("too_many_ships");
  expect(match.submit(0, plan({ flagship: command(4) }))).toBe("flagship_not_allowed");
});

test("Das Flaggschiff und die Deploys halten zusammen Lane- und Flottengrenze ein", () => {
  const match = newMatch();
  const ship = match.players[0]!.shipHand[0]!;
  const twoShips = (first: SlotTarget, second: SlotTarget, flagship: SlotTarget): TurnPlan =>
    plan({ ships: [{ handIndex: 0, target: first }, { handIndex: 1, target: second }], flagship });
  for (const index of [0, 1]) match.board.place(match.board.lane("player", "strike"), index, ship);
  // Strike: 2 Schiffe + Flaggschiff + Deploy = 4, für den zweiten Deploy ist dort kein Platz mehr.
  expect(match.submit(0, twoShips(strike(3), strike(4), strike(2)))).toBe("slot_unavailable");
  match.board.place(match.board.lane("player", "command"), 0, ship);
  match.board.place(match.board.lane("player", "command"), 1, ship);
  // 4 Schiffe + Flaggschiff + 2 Deploys überschreiten die Flottengrenze von 6.
  expect(match.submit(0, twoShips(strike(3), command(3), command(2)))).toBe("slot_unavailable");
  expect(match.submit(0, plan({ ships: [{ handIndex: 0, target: strike(3) }], flagship: command(2) }))).toBeNull();
});

test("Befehle und Lane-Wechsel berücksichtigen das Flaggschiff und beide Deploys der ersten Runde", () => {
  const match = newMatch();
  match.players[0]!.commandHand.splice(0, match.players[0]!.commandHand.length, commandById("intercept"), commandById("emergency_shields"));
  const intercept = (destination: number): TurnPlan =>
    plan({
      ships: [{ handIndex: 0, target: strike(2) }, { handIndex: 1, target: command(4) }],
      flagship: command(0),
      command: { handIndex: 0, target: command(4), destination },
    });
  // Intercept auf das zweite gelegte Schiff, aber nicht in den Slot des ersten.
  expect(match.submit(0, intercept(2))).toBe("destination_unavailable");
  expect(match.submit(0, intercept(4))).toBeNull();
  match.players[0]!.plan = null;
  // Auch das Flaggschiff, das gerade landet, darf ein Befehl treffen.
  expect(match.submit(0, plan({ flagship: command(0), command: { handIndex: 1, target: command(0), destination: null } }))).toBeNull();
});

test("Befehlsziele müssen in der passenden Lane stehen", () => {
  const match = midGame();
  const player = match.players[0]!;
  match.board.place(match.board.lane("player", "strike"), 0, player.shipHand[0]!);
  player.commandHand.splice(0, player.commandHand.length, commandById("intercept"));
  expect(match.submit(0, plan({ command: { handIndex: 0, target: strike(0), destination: 1 } }))).toBe("target_wrong_lane");
});

test("Verlegende Befehle brauchen einen freien Ziel-Slot in der anderen Lane, auch nach dem eigenen Deploy", () => {
  const match = midGame();
  const player = match.players[0]!;
  const ship = player.shipHand[0]!;
  match.board.place(match.board.lane("player", "command"), 2, ship);
  match.board.place(match.board.lane("player", "strike"), 0, ship);
  player.commandHand.splice(0, player.commandHand.length, commandById("intercept"));
  const intercept = (destination: number | null, deployTo: number | null = null): TurnPlan =>
    plan({
      ships: deployTo === null ? [] : [{ handIndex: 0, target: strike(deployTo) }],
      command: { handIndex: 0, target: command(2), destination },
    });
  expect(match.submit(0, intercept(null))).toBe("destination_required");
  expect(match.submit(0, intercept(0))).toBe("destination_unavailable");
  expect(match.submit(0, intercept(4, 4))).toBe("destination_unavailable");
  expect(match.submit(0, intercept(5, 4))).toBeNull();
});

test("Befehle dürfen das Schiff treffen, das in derselben Runde gelegt wird", () => {
  const match = midGame();
  const player = match.players[0]!;
  player.commandHand.splice(0, player.commandHand.length, commandById("overcharge"));
  const overcharge = (target: SlotTarget): TurnPlan =>
    plan({ ships: [{ handIndex: 0, target: strike(2) }], command: { handIndex: 0, target, destination: null } });
  expect(match.submit(0, overcharge(strike(3)))).toBe("target_not_own_ship");
  expect(match.submit(0, { ...overcharge(strike(2)), ships: [] })).toBe("target_not_own_ship");
  expect(match.submit(0, overcharge(strike(2)))).toBeNull();
});

test("Das gelegte Schiff darf sofort die Lane wechseln, die Lane-Grenze gilt dabei weiter", () => {
  const match = midGame();
  const player = match.players[0]!;
  const ship = player.shipHand[0]!;
  player.commandHand.splice(0, player.commandHand.length, commandById("intercept"), commandById("recall"));
  /** Legt ein Schiff in `lane` auf Slot `deployTo` und verlegt es mit Intercept (aus Command) bzw. Recall (aus Strike). */
  const deployAndMove = (lane: "strike" | "command", deployTo: number, destination: number): TurnPlan =>
    plan({
      ships: [{ handIndex: 0, target: { lane, slotIndex: deployTo } }],
      command: { handIndex: lane === "command" ? 0 : 1, target: { lane, slotIndex: deployTo }, destination },
    });
  // Intercept auf ein frisch in die Command-Lane gelegtes Schiff, auch in den Strike-Slot direkt davor.
  expect(match.submit(0, deployAndMove("command", 1, 1))).toBeNull();
  player.plan = null;

  // Strike voll: Das gelegte Schiff kommt nicht hinein, mit einem freien Platz schon.
  for (const index of [0, 1, 2, 3]) match.board.place(match.board.lane("player", "strike"), index, ship);
  expect(match.submit(0, deployAndMove("command", 1, 4))).toBe("destination_unavailable");
  match.board.lane("player", "strike").slots[3]!.clear();
  expect(match.submit(0, deployAndMove("command", 1, 4))).toBeNull();
  player.plan = null;

  // Recall vom gelegten Schiff zurück in die Command-Lane, aber nicht in einen belegten Slot.
  match.board.place(match.board.lane("player", "command"), 5, ship);
  expect(match.submit(0, deployAndMove("strike", 3, 5))).toBe("destination_unavailable");
  expect(match.submit(0, deployAndMove("strike", 3, 4))).toBeNull();
});

test("Ein anderes Schiff darf nicht in den Deploy-Slot wechseln und füllt die Lane des Deploys nicht über die Grenze", () => {
  const match = midGame();
  const player = match.players[0]!;
  const ship = player.shipHand[0]!;
  player.commandHand.splice(0, player.commandHand.length, commandById("recall"));
  match.board.place(match.board.lane("player", "strike"), 0, ship);
  const recall = (deployTo: number, destination: number): TurnPlan =>
    plan({ ships: [{ handIndex: 0, target: command(deployTo) }], command: { handIndex: 0, target: strike(0), destination } });
  expect(match.submit(0, recall(2, 2))).toBe("destination_unavailable");
  for (const index of [3, 4]) match.board.place(match.board.lane("player", "command"), index, ship);
  // Command: 2 Schiffe + Deploy = 3, der Wechsel macht 4.
  expect(match.submit(0, recall(2, 1))).toBeNull();
  player.plan = null;
  match.board.place(match.board.lane("player", "command"), 5, ship);
  // Command: 3 Schiffe + Deploy = 4, kein Platz mehr für den Wechsel.
  expect(match.submit(0, recall(2, 1))).toBe("destination_unavailable");
});

test("Ein Befehl auf das gelegte Schiff wirkt in derselben Runde, und es feuert schon mit seinem Feuerbefehl", () => {
  const match = midGame();
  for (const player of match.players) {
    player.shipHand.splice(0, player.shipHand.length, { ...interceptor, hp: 10 });
    player.commandHand.splice(0, player.commandHand.length, commandById("emergency_shields"), commandById("intercept"));
  }
  for (const side of ["player", "enemy"] as const) match.board.place(match.board.lane(side, "strike"), 5, shipById("horizon_cruiser"));
  const shielded = plan({ ...deploy, command: { handIndex: 0, target: strike(0), destination: null }, fire: [{ ship: strike(0), target: strike(5) }] });
  const intercepted = plan({
    ships: [{ handIndex: 0, target: command(2) }],
    command: { handIndex: 1, target: command(2), destination: 4 },
    fire: [{ ship: command(2), target: strike(5) }],
  });
  const events = playRound(match, [shielded, intercepted]);
  expect(events).toContainEqual(expect.objectContaining({ kind: "effect", cardId: "emergency_shields", ship: expect.objectContaining({ side: "player", ...strike(0) }) }));
  expect(match.board.lane("player", "strike").slots[0]!.state).toEqual({ cardId: "void_interceptor", hp: 10, shield: 0, scrapBonus: 0, marked: false });
  expect(match.board.lane("enemy", "command").slots[2]!.isOccupied).toBe(false);
  expect(match.board.lane("enemy", "strike").slots[4]!.state).toEqual({ cardId: "void_interceptor", hp: 10, shield: 0, scrapBonus: 0, marked: false });
  // Der Interceptor des Gegners trifft nach dem Intercept mit 3 + 2 ATK, der eigene mit 3.
  expect(match.board.lane("player", "strike").slots[5]!.hp).toBe(shipById("horizon_cruiser").hp - 5);
  expect(match.board.lane("enemy", "strike").slots[5]!.hp).toBe(shipById("horizon_cruiser").hp - 3);
});

test("Das Grundmanöver verlegt ein eigenes Schiff vom Brett in einen freien Slot, auch in derselben Lane", () => {
  const match = midGame();
  const player = match.players[0]!;
  const ship = player.shipHand[0]!;
  match.board.place(match.board.lane("player", "strike"), 1, ship);
  match.board.place(match.board.lane("player", "command"), 3, ship);
  const maneuver = (from: SlotTarget, destination: SlotTarget, deployTo: SlotTarget | null = null): TurnPlan =>
    plan({ ships: deployTo ? [{ handIndex: 0, target: deployTo }] : [], maneuver: { ship: from, destination } });
  expect(match.submit(0, maneuver(strike(0), command(2)))).toBe("maneuver_not_own_ship");
  // Das gelegte Schiff ist noch nicht auf dem Brett und manövriert nicht.
  expect(match.submit(0, maneuver(strike(2), command(2), strike(2)))).toBe("maneuver_not_own_ship");
  // In einen belegten Slot geht nur die Mirage (Phasentausch).
  expect(match.submit(0, maneuver(strike(1), command(3)))).toBe("swap_not_allowed");
  expect(match.submit(0, maneuver(strike(1), command(6)))).toBe("maneuver_destination_unavailable");
  expect(match.submit(0, maneuver(strike(1), command(2), command(2)))).toBe("maneuver_destination_unavailable");
  expect(match.submit(0, maneuver(strike(1), strike(1)))).toBe("maneuver_destination_unavailable");
  expect(match.submit(0, maneuver(strike(1), strike(4), strike(4)))).toBe("maneuver_destination_unavailable");
  expect(match.submit(0, maneuver(strike(1), strike(4)))).toBeNull();
});

test("Innerhalb der Lane manövriert ein Schiff auch in einer vollen Lane, etwa in die Deckung", () => {
  const match = midGame();
  const player = match.players[0]!;
  const drone = shipById("repair_drone");
  match.board.place(match.board.lane("player", "strike"), 2, player.shipHand[0]!);
  for (const index of [0, 3, 4, 5]) match.board.place(match.board.lane("player", "command"), index, drone);
  const lane = match.board.lane("player", "command");
  expect(match.board.isExposed(lane.slots[0]!)).toBe(true);
  // In die volle Command-Lane wechselt niemand, innerhalb von ihr schon.
  expect(match.board.canMove(match.board.lane("player", "strike").slots[2]!, command(1))).toBe(false);
  const events = playRound(match, [plan({ maneuver: { ship: command(0), destination: command(2) } }), pass]);

  expect(events.find((event) => event.kind === "maneuver")).toMatchObject({ ship: { lane: "command", slotIndex: 0 }, to: command(2) });
  expect(lane.slots[0]!.isOccupied).toBe(false);
  expect(lane.slots[2]!.card?.id).toBe("repair_drone");
  expect(match.board.isExposed(lane.slots[2]!)).toBe(false);
});

test("Manöver und Bewegungsbefehl bewegen verschiedene Schiffe in verschiedene Slots, zusammen mit dem Deploy unter der Lane-Grenze", () => {
  const match = midGame();
  const player = match.players[0]!;
  const ship = player.shipHand[0]!;
  for (const index of [1, 4]) match.board.place(match.board.lane("player", "strike"), index, ship);
  for (const index of [3, 5]) match.board.place(match.board.lane("player", "command"), index, ship);
  player.commandHand.splice(0, player.commandHand.length, commandById("flanking_maneuver"));
  const moves = (deployTo: SlotTarget | null, from: SlotTarget, destination: SlotTarget, flankFrom: SlotTarget, flankTo: number): TurnPlan =>
    plan({
      ships: deployTo ? [{ handIndex: 0, target: deployTo }] : [],
      command: { handIndex: 0, target: flankFrom, destination: flankTo },
      maneuver: { ship: from, destination },
    });
  expect(match.submit(0, moves(null, strike(1), command(2), strike(1), 4))).toBe("maneuver_conflict");
  expect(match.submit(0, moves(null, strike(1), command(2), strike(4), 2))).toBe("destination_unavailable");
  // Der Slot, den das Manöver räumt, bleibt für den Befehl belegt.
  expect(match.submit(0, moves(null, command(3), strike(2), strike(1), 3))).toBe("destination_unavailable");
  // Command: 2 Schiffe + Deploy + Manöver = 4, für den Befehl ist kein Platz mehr; ohne Deploy schon.
  expect(match.submit(0, moves(command(0), strike(1), command(2), strike(4), 4))).toBe("destination_unavailable");
  expect(match.submit(0, moves(null, strike(1), command(2), strike(4), 4))).toBeNull();
});

test("Ein Manöver innerhalb der Ziel-Lane des Bewegungsbefehls und eine Drohne zählen dort nicht zusätzlich zur Lane-Grenze", () => {
  const match = midGame();
  const player = match.players[0]!;
  const ship = player.shipHand[0]!;
  for (const index of [0, 1, 2]) match.board.place(match.board.lane("player", "strike"), index, ship);
  for (const index of [1, 3]) match.board.place(match.board.lane("player", "command"), index, ship);
  match.board.place(match.board.lane("player", "command"), 5, shipById("drone"));
  player.commandHand.splice(0, player.commandHand.length, commandById("intercept"));
  const intercept = (from: SlotTarget, destination: SlotTarget): TurnPlan =>
    plan({ command: { handIndex: 0, target: command(3), destination: 4 }, maneuver: { ship: from, destination } });
  // Strike: 3 Schiffe und das verlegte macht 4; das manövrierende bleibt in der Lane, die Drohne zählt nicht.
  expect(match.submit(0, intercept(strike(0), strike(5)))).toBeNull();
  player.plan = null;
  expect(match.submit(0, intercept(command(5), strike(5)))).toBeNull();
  player.plan = null;
  // Ein Schiff aus der Command-Lane wäre das fünfte; in den Slot des Manövers wechselt der Befehl nie.
  expect(match.submit(0, intercept(command(1), strike(5)))).toBe("destination_unavailable");
  expect(match.submit(0, intercept(strike(0), strike(4)))).toBe("destination_unavailable");
});

test("Ein Befehl auf das manövrierte Schiff folgt ihm; es feuert nicht, wird aber beschossen", () => {
  const match = midGame();
  match.players[0]!.commandHand.splice(0, match.players[0]!.commandHand.length, commandById("overcharge"));
  for (const side of ["player", "enemy"] as const) match.board.place(match.board.lane(side, "strike"), 0, { ...interceptor, hp: 7 });
  const overchargeAndManeuver = plan({
    command: { handIndex: 0, target: strike(0), destination: null },
    maneuver: { ship: strike(0), destination: command(2) },
  });
  const events = playRound(match, [overchargeAndManeuver, plan({ fire: [{ ship: strike(0), target: strike(0) }] })]);

  expect(events.find((event) => event.kind === "maneuver")).toEqual({
    kind: "maneuver",
    side: "player",
    ship: { side: "player", lane: "strike", slotIndex: 0, cardId: "void_interceptor" },
    to: command(2),
  });
  expect(events.find((event) => event.kind === "command")).toMatchObject({ target: command(2) });
  expect(events.find((event) => event.kind === "effect")).toMatchObject({ ship: { lane: "command", slotIndex: 2 } });
  expect(events.filter((event) => event.kind === "attack").map((event) => event.attacker.side)).toEqual(["enemy"]);
  // 7 HP, 3 Schaden vom Gegner, 2 Eigenschaden durch Overcharge.
  expect(match.board.lane("player", "command").slots[2]!.state).toEqual({ cardId: "void_interceptor", hp: 2, shield: 0, scrapBonus: 0, marked: false });
  expect(match.board.lane("player", "command").slots[2]!.maneuvered).toBe(false);
  expect(match.board.lane("enemy", "strike").slots[0]!.state).toEqual({ cardId: "void_interceptor", hp: 7, shield: 0, scrapBonus: 0, marked: false });
});

test("Die Starthand hat genau 1 Support- und 3 Kampfschiffe", () => {
  for (let i = 0; i < 50; i++) {
    for (const player of newMatch().players) {
      const classes = player.shipHand.map((card) => card.shipClass === "support");
      expect(classes.sort()).toEqual([false, false, false, true]);
      expect(player.shipDeck.size).toBe(SHIPS.length * 2 - 4);
    }
  }
});

test("Die Admiralsfähigkeit gibt es statt des Grundmanövers, nur auf ein Ziel, das sie haben darf", () => {
  const match = midGame(["vance", "osei"]);
  match.board.place(match.board.lane("player", "strike"), 0, shipById("horizon_cruiser"));
  match.board.place(match.board.lane("enemy", "strike"), 1, shipById("horizon_cruiser"));
  const focus = (target: SlotTarget, parts: Partial<TurnPlan> = {}) => plan({ power: { target }, ...parts });
  expect(match.submit(0, focus(strike(1), { maneuver: { ship: strike(0), destination: strike(3) } }))).toBe("power_and_maneuver");
  expect(match.submit(0, focus(strike(0)))).toBe("power_target_invalid");
  expect(match.submit(0, focus(strike(1)))).toBeNull();
});

test("Gegenfeuer und Taktvorsprung zielen auf eigene Schiffe, auch gelegte, der Taktvorsprung nur auf ein Kampfschiff", () => {
  const match = midGame(["kerr", "osei"]);
  match.players[0]!.shipHand.splice(0, match.players[0]!.shipHand.length, shipById("repair_drone"), shipById("void_interceptor"));
  const deployAndPower = (handIndex: number): TurnPlan => plan({ ships: [{ handIndex, target: strike(3) }], power: { target: strike(3) } });
  expect(match.submit(0, deployAndPower(0))).toBe("power_target_invalid");
  expect(match.submit(0, deployAndPower(1))).toBeNull();

  const wall = midGame(["osei", "osei"]);
  wall.board.place(wall.board.lane("enemy", "strike"), 3, shipById("horizon_cruiser"));
  expect(wall.submit(0, plan({ power: { target: strike(3) } }))).toBe("power_target_invalid");
  wall.board.place(wall.board.lane("player", "command"), 3, shipById("repair_drone"));
  expect(wall.submit(0, plan({ power: { target: command(3) } }))).toBeNull();
});

test("Den Schwarmangriff fliegen Drohnen, die schon stehen, nie auf das Flaggschiff", () => {
  const match = midGame(["halvorsen", "osei"]);
  match.board.place(match.board.lane("enemy", "strike"), 1, shipById("horizon_cruiser"));
  match.board.place(match.board.lane("enemy", "command"), 2, shipById("bastion"));
  expect(match.submit(0, plan({ power: { target: strike(1) } }))).toBe("power_target_invalid");
  match.board.place(match.board.lane("player", "strike"), 0, shipById("drone"));
  expect(match.submit(0, plan({ power: { target: command(2) } }))).toBe("power_target_invalid");
  expect(match.submit(0, plan({ power: { target: strike(1) } }))).toBeNull();
});

test("Das Trugbild erscheint nur in einem freien eigenen Strike-Slot, in dem in dieser Runde nichts landet", () => {
  const match = midGame(["moreau", "osei"]);
  const player = match.players[0]!;
  player.commandHand.splice(0, player.commandHand.length, commandById("intercept"));
  match.board.place(match.board.lane("player", "strike"), 0, shipById("horizon_cruiser"));
  match.board.place(match.board.lane("player", "command"), 3, shipById("horizon_cruiser"));
  const decoy = (target: SlotTarget, parts: Partial<TurnPlan> = {}) => plan({ power: { target }, ...parts });
  const intercept = { command: { handIndex: 0, target: command(3), destination: 4 } };
  expect(match.submit(0, decoy(strike(0)))).toBe("power_target_invalid");
  expect(match.submit(0, decoy(command(1)))).toBe("power_target_invalid");
  expect(match.submit(0, decoy(strike(2), { ships: [{ handIndex: 0, target: strike(2) }] }))).toBe("power_target_invalid");
  expect(match.submit(0, decoy(strike(4), intercept))).toBe("power_target_invalid");
  expect(match.submit(0, decoy(strike(5), intercept))).toBeNull();
});

test("Nur die Mirage tauscht beim Grundmanöver mit einem eigenen Schiff, und kein Befehl verlegt eins der beiden", () => {
  const match = midGame(["moreau", "osei"]);
  const player = match.players[0]!;
  player.commandHand.splice(0, player.commandHand.length, commandById("recall"));
  match.board.place(match.board.lane("player", "strike"), 1, shipById("mirage"));
  match.board.place(match.board.lane("player", "strike"), 2, shipById("horizon_cruiser"));
  match.board.place(match.board.lane("player", "command"), 1, shipById("iron_dreadnought"));
  const maneuver = (from: SlotTarget, destination: SlotTarget, parts: Partial<TurnPlan> = {}) => plan({ maneuver: { ship: from, destination }, ...parts });
  expect(match.submit(0, maneuver(strike(2), command(1)))).toBe("swap_not_allowed");
  expect(match.submit(0, maneuver(strike(1), strike(1)))).toBe("maneuver_destination_unavailable");
  expect(match.submit(0, maneuver(strike(1), strike(2), { command: { handIndex: 0, target: strike(2), destination: 4 } }))).toBe("maneuver_conflict");
  expect(match.submit(0, maneuver(strike(1), command(1)))).toBeNull();
});

test("Die Pendulum markiert ein gegnerisches Schiff, nur wenn sie auf dem Brett steht und ihre Railgun nicht feuert", () => {
  const match = midGame(["kerr", "osei"]);
  const target = match.board.place(match.board.lane("enemy", "strike"), 3, shipById("horizon_cruiser"))!;
  const mark = (slot: SlotTarget) => plan({ mark: slot });
  expect(match.submit(0, mark(strike(3)))).toBe("mark_unavailable");
  match.board.place(match.board.lane("player", "command"), 2, shipById("pendulum"));
  expect(match.submit(0, mark(strike(2)))).toBe("mark_target_invalid");
  target.marked = true;
  expect(match.submit(0, mark(strike(3)))).toBe("mark_unavailable");
  target.marked = false;
  expect(match.submit(0, mark(strike(3)))).toBeNull();
});

test("Fähigkeit und Markierung werden aufgedeckt und für Seat 1 gespiegelt, wie die Markierung im Brett und der Zähler der Hive", () => {
  const match = midGame(["kerr", "halvorsen"]);
  match.board.place(match.board.lane("player", "command"), 2, shipById("pendulum"));
  match.board.place(match.board.lane("player", "strike"), 2, shipById("iron_dreadnought"));
  match.board.place(match.board.lane("enemy", "command"), 2, shipById("hive"));
  match.board.place(match.board.lane("enemy", "strike"), 4, shipById("titan_carrier"));
  match.board.hiveLaunches = { player: 0, enemy: 3 };
  const events = playRound(match, [plan({ power: { target: strike(2) }, mark: strike(4) }), pass]);
  const power: RoundEvent = { kind: "power", side: "player", power: "head_start", target: { side: "player", ...strike(2) } };
  expect(events).toContainEqual(power);
  expect(match.eventsFor(1, events)).toContainEqual({ ...power, side: "enemy", target: { side: "enemy", ...strike(2) } });
  expect(events).toContainEqual({ kind: "mark", side: "player", ship: { side: "enemy", ...strike(4), cardId: "titan_carrier" } });
  expect(match.view(0).board.enemy.strike[4]).toMatchObject({ cardId: "titan_carrier", marked: true });
  expect(match.view(1).board.player.strike[4]).toMatchObject({ cardId: "titan_carrier", marked: true });
  // Die Hive hat am Rundenende ihre vierte Drohne gestartet.
  expect([match.view(0).hiveLaunches, match.view(1).hiveLaunches]).toEqual([{ player: 0, enemy: 4 }, { player: 4, enemy: 0 }]);
  expect(match.winner).toBeNull();
});

test("Wessen Flaggschiff fällt, verliert; danach gibt es keine Züge mehr", () => {
  const match = midGame(["vance", "vance"]);
  match.board.place(match.board.lane("player", "strike"), 0, shipById("vanguard"))!.hp = 3;
  match.board.place(match.board.lane("enemy", "strike"), 0, shipById("vanguard"));
  const duel = plan({ fire: [{ ship: strike(0), target: strike(0) }] });
  playRound(match, [duel, duel]);
  expect(match.view(0).result).toBe("lost");
  expect(match.view(1).result).toBe("won");
  expect(match.round).toBe(2);
  expect(match.submit(0, pass)).toBe("match_over");
});

test("Fallen beide Flaggschiffe in derselben Runde, endet das Match unentschieden", () => {
  const match = midGame(["vance", "vance"]);
  for (const side of ["player", "enemy"] as const) match.board.place(match.board.lane(side, "strike"), 0, shipById("vanguard"))!.hp = 3;
  const duel = plan({ fire: [{ ship: strike(0), target: strike(0) }] });
  playRound(match, [duel, duel]);
  expect([match.view(0).result, match.view(1).result]).toEqual(["draw", "draw"]);
});

test("Feuerbefehle: je eigenes Kampfschiff einer, auch für ein gelegtes, nicht fürs manövrierende; Ziel ist ein gegnerisches Schiff, auch ein gedecktes", () => {
  const match = midGame(["moreau", "osei"]);
  const player = match.players[0]!;
  setShipHands(match, [shipById("void_interceptor")], []);
  const place = (side: "player" | "enemy", target: SlotTarget, id: Parameters<typeof shipById>[0]) => match.board.place(match.board.lane(side, target.lane), target.slotIndex, shipById(id));
  place("player", strike(1), "horizon_cruiser");
  place("player", strike(2), "repair_drone");
  place("player", command(3), "mirage");
  place("enemy", strike(4), "titan_carrier");
  place("enemy", command(4), "signal_booster");
  const submit = (parts: Partial<TurnPlan>) => {
    const error = match.submit(0, plan(parts));
    player.plan = null;
    return error;
  };
  const at = (ship: SlotTarget, target: SlotTarget) => ({ ship, target });

  expect(submit({ fire: [at(strike(1), strike(4)), at(command(3), command(4))] })).toBeNull();
  expect(submit({ ships: [{ handIndex: 0, target: strike(0) }], fire: [at(strike(0), command(4))] })).toBeNull();
  expect(submit({ fire: [at(strike(2), strike(4))] })).toBe("fire_ship_invalid");
  expect(submit({ fire: [at(strike(0), strike(4))] })).toBe("fire_ship_invalid");
  expect(submit({ fire: [at(strike(1), strike(4)), at(strike(1), command(4))] })).toBe("fire_ship_invalid");
  expect(submit({ maneuver: { ship: strike(1), destination: strike(3) }, fire: [at(strike(1), strike(4))] })).toBe("fire_ship_invalid");
  // Beim Phasentausch feuern beide.
  expect(submit({ maneuver: { ship: command(3), destination: strike(1) }, fire: [at(command(3), strike(4)), at(strike(1), strike(4))] })).toBeNull();
  expect(submit({ fire: [at(strike(1), strike(3))] })).toBe("fire_target_invalid");
});

test("Solange beide Flaggschiffe stehen, geht es weiter, auch ohne andere Kampfschiffe auf Brett und Hand", () => {
  const match = midGame();
  setShipHands(match, [], []);
  for (const side of ["player", "enemy"] as const) match.board.place(match.board.lane(side, "command"), 2, shipById("bastion"));
  playRound(match);
  expect(match.winner).toBeNull();
  expect(match.round).toBe(3);
});

test("Wer aufgibt, verliert sofort, auch mit abgegebenem Zug; danach gibt es keine Züge mehr", () => {
  const match = newMatch();
  const opening = plan({ flagship: command(2) });
  expect(match.submit(0, opening)).toBeNull();
  expect(match.surrender(1)).toBeNull();
  expect(match.view(0)).toMatchObject({ result: "won", surrendered: true, submittedPlan: null });
  expect(match.view(1)).toMatchObject({ result: "lost", surrendered: true });
  expect(match.isRoundComplete).toBe(false);
  expect(match.submit(1, opening)).toBe("match_over");
  expect(match.surrender(0)).toBe("match_over");
});

test("Aufgeben geht erst, wenn der Gegner da ist", () => {
  const match = new Match("test");
  match.join("a");
  expect(match.surrender(0)).toBe("opponent_missing");
});

test("Ab Runde 8 gilt der Overdrive schon beim Planen der Runde", () => {
  const match = midGame();
  match.round = 7;
  for (const side of ["player", "enemy"] as const) match.board.place(match.board.lane(side, "command"), 2, shipById("bastion"));
  playRound(match);
  expect(match.round).toBe(8);
  expect(match.board.overdrive).toBe(1);
});

test("Der Gegner sieht Admiral, Handgrößen, Decks und die aufgedeckten Befehle, aber keine Handkarten", () => {
  const alone = new Match("test");
  alone.join("a");
  expect(alone.view(0).opponent).toBeNull();

  const match = newMatch(["vance", "osei"]);
  const player = match.players[0]!;
  player.commandHand.splice(0, player.commandHand.length, commandById("scavenge"), commandById("torpedo"));
  const torpedo = plan({ flagship: command(2), command: { handIndex: 1, target: strike(0), destination: null } });
  expect(match.submit(0, torpedo)).toBeNull();
  // Bis zum Aufdecken ist nur bekannt, dass er abgegeben hat.
  expect(match.view(1).opponent).toMatchObject({ submitted: true, commandHandSize: 2, playedCommands: [] });
  expect(match.submit(1, plan({ flagship: command(2) }))).toBeNull();
  match.resolveRound();
  expect(match.view(1).opponent).toEqual({
    admiral: "vance",
    submitted: false,
    shipHandSize: 5,
    commandHandSize: 2,
    shipDeckSize: 11,
    commandDeckSize: 30,
    playedCommands: ["torpedo"],
  });
});

test("Der Torpedo zielt auf einen Slot der Gegnerseite, auch einen leeren, und verlegt nichts", () => {
  const match = midGame();
  const player = match.players[0]!;
  player.commandHand.splice(0, player.commandHand.length, commandById("torpedo"));
  const torpedo = (target: SlotTarget | null, destination: number | null = null): TurnPlan => plan({ command: { handIndex: 0, target, destination } });
  expect(match.submit(0, torpedo(null))).toBe("target_required");
  expect(match.submit(0, torpedo(strike(6)))).toBe("target_not_enemy_slot");
  expect(match.submit(0, torpedo(strike(2), 2))).toBe("destination_not_allowed");
  expect(match.submit(0, torpedo(command(4)))).toBeNull();
});

test("Seat 1 schießt einen Torpedo: Er trifft den gespiegelten Brett-Slot", () => {
  const match = midGame();
  match.players[1]!.commandHand.splice(0, match.players[1]!.commandHand.length, commandById("torpedo"));
  match.board.place(match.board.lane("player", "strike"), 2, { ...interceptor, hp: 17 });
  match.board.place(match.board.lane("enemy", "strike"), 0, { ...interceptor, hp: 20 });
  const hit = playRound(match, [pass, plan({ command: { handIndex: 0, target: strike(2), destination: null } })]);
  // Brett: Seat 1 sitzt auf "enemy", sein Ziel liegt auf "player". 17 − 5.
  expect(hit.find((event) => event.kind === "effect")).toMatchObject({ ship: { side: "player", lane: "strike", slotIndex: 2 }, after: { hp: 12 } });
  const commandEvent: RoundEvent = { kind: "command", side: "enemy", cardId: "torpedo", target: { side: "player", ...strike(2) } };
  expect(hit).toContainEqual(commandEvent);
  expect(match.eventsFor(1, hit)).toContainEqual({ ...commandEvent, side: "player", target: { side: "enemy", ...strike(2) } });
  expect(match.eventsFor(1, hit).find((event) => event.kind === "effect")).toMatchObject({
    side: "player",
    ship: { side: "enemy", lane: "strike", slotIndex: 2 },
    effect: { type: "damage", amount: 5 },
  });
});

test("Seat 1 schießt einen Torpedo in den Slot, aus dem der Gegner manövriert: Er verpufft", () => {
  const match = midGame();
  match.players[1]!.commandHand.splice(0, match.players[1]!.commandHand.length, commandById("torpedo"));
  match.board.place(match.board.lane("player", "strike"), 2, { ...interceptor, hp: 12 });
  const missed = playRound(match, [
    plan({ maneuver: { ship: strike(2), destination: command(3) } }),
    plan({ command: { handIndex: 0, target: strike(2), destination: null } }),
  ]);
  const miss: RoundEvent = { kind: "miss", side: "enemy", cardId: "torpedo", target: { side: "player", ...strike(2) } };
  expect(missed).toContainEqual(miss);
  expect(match.eventsFor(1, missed)).toContainEqual({ ...miss, side: "player", target: { side: "enemy", ...strike(2) } });
  expect(match.board.lane("player", "command").slots[3]!.card?.id).toBe("void_interceptor");
});

test("Fällt ein Schiff schon beim Deploy durch die Plasma Frigate, entfallen sein Manöver und der Befehl darauf", () => {
  const match = midGame(undefined, () => 0);
  setShipHands(match, [], [shipById("plasma_frigate")]);
  const first = match.players[0]!;
  first.commandHand.splice(0, first.commandHand.length, commandById("emergency_shields"));
  match.board.place(match.board.lane("player", "strike"), 3, { ...interceptor, hp: 1 });
  const shieldAndManeuver = plan({
    command: { handIndex: 0, target: strike(3), destination: null },
    maneuver: { ship: strike(3), destination: command(1) },
  });
  const events = playRound(match, [shieldAndManeuver, plan({ ships: [{ handIndex: 0, target: strike(2) }] })]);
  expect(events.map((event) => event.kind)).toEqual(["pass", "deploy", "ability", "destroyed", "command", "noEffect"]);
});

test("Mit Schnellverlegung darf ein Schiff mehr gelegt werden, in Runde 1 also drei", () => {
  const match = midGame();
  const player = match.players[0]!;
  player.commandHand.splice(0, player.commandHand.length, commandById("rapid_deployment"), commandById("scavenge"));
  const deploys = (count: number, handIndex: number): TurnPlan =>
    plan({ ships: Array.from({ length: count }, (_, i) => ({ handIndex: i, target: strike(i) })), command: { handIndex, target: null, destination: null } });
  expect(match.submit(0, deploys(2, 1))).toBe("too_many_ships");
  expect(match.submit(0, deploys(3, 0))).toBe("too_many_ships");
  expect(match.submit(0, deploys(2, 0))).toBeNull();

  const opening = newMatch();
  opening.players[0]!.commandHand.splice(0, opening.players[0]!.commandHand.length, commandById("rapid_deployment"));
  const events = playRound(opening, [{ ...deploys(3, 0), flagship: command(2) }, plan({ flagship: command(2) })]);
  expect(events.filter((event) => event.kind === "deploy" && event.side === "player")).toHaveLength(4);
  expect(events).toContainEqual({ kind: "rule", side: "player", cardId: "rapid_deployment" });
});

test("Mit Freier Hand gibt es Grundmanöver und Admiralsfähigkeit; das Trugbild erscheint nicht im Ziel-Slot des Manövers", () => {
  const match = midGame(["moreau", "osei"]);
  const player = match.players[0]!;
  player.commandHand.splice(0, player.commandHand.length, commandById("carte_blanche"), commandById("scavenge"));
  match.board.place(match.board.lane("player", "command"), 1, shipById("horizon_cruiser"));
  const both = (handIndex: number, decoy: SlotTarget): TurnPlan =>
    plan({ command: { handIndex, target: null, destination: null }, maneuver: { ship: command(1), destination: strike(1) }, power: { target: decoy } });
  expect(match.submit(0, both(1, strike(3)))).toBe("power_and_maneuver");
  expect(match.submit(0, both(0, strike(1)))).toBe("power_target_invalid");
  expect(match.submit(0, both(0, strike(3)))).toBeNull();
  expect(match.submit(1, pass)).toBeNull();
  const kinds = match.resolveRound().map((event) => event.kind);
  expect(kinds).toContain("maneuver");
  expect(kinds).toContain("decoy");
  expect(kinds).toContain("rule");
});

test("Wärmesucher und Traktorstrahl zielen auf ein gegnerisches Schiff, der Traktorstrahl nie auf ein Flaggschiff", () => {
  const match = midGame();
  const player = match.players[0]!;
  player.commandHand.splice(0, player.commandHand.length, commandById("heat_seeker"), commandById("tractor_beam"));
  match.board.place(match.board.lane("enemy", "strike"), 1, shipById("horizon_cruiser"));
  match.board.place(match.board.lane("enemy", "command"), 2, shipById("bastion"));
  const aim = (handIndex: number, target: SlotTarget | null, destination: number | null = null): TurnPlan => plan({ command: { handIndex, target, destination } });
  expect(match.submit(0, aim(0, null))).toBe("target_required");
  expect(match.submit(0, aim(0, strike(2)))).toBe("target_not_enemy_ship");
  // Ein eigenes Schiff, das im gleichen Slot der eigenen Seite landet, macht den leeren gegnerischen Slot nicht zum Ziel.
  expect(match.submit(0, plan({ ships: [{ handIndex: 0, target: strike(2) }], command: { handIndex: 0, target: strike(2), destination: null } }))).toBe(
    "target_not_enemy_ship",
  );
  expect(match.submit(0, aim(0, strike(6)))).toBe("target_not_enemy_slot");
  expect(match.submit(0, aim(0, strike(1), 2))).toBe("destination_not_allowed");
  expect(match.submit(0, aim(1, command(2)))).toBe("target_flagship");
  expect(match.submit(0, aim(0, command(2)))).toBeNull();
});

test("Rammkurs nur mit einem eigenen Strike-Schiff, nie mit dem Flaggschiff, auch nicht dem gerade gelegten", () => {
  const opening = newMatch(["vance", "osei"]);
  opening.players[0]!.commandHand.splice(0, opening.players[0]!.commandHand.length, commandById("collision_course"));
  const ram = (target: SlotTarget, parts: Partial<TurnPlan> = {}): TurnPlan => plan({ command: { handIndex: 0, target, destination: null }, ...parts });
  expect(opening.submit(0, ram(strike(2), { flagship: strike(2) }))).toBe("target_flagship");
  expect(opening.submit(0, ram(command(2), { flagship: command(2) }))).toBe("target_wrong_lane");
  expect(opening.submit(0, ram(strike(0), { flagship: command(2), ships: [{ handIndex: 0, target: strike(0) }] }))).toBeNull();
});

test("Der Durchschlag zielt auf eine Slot-Nummer der Gegnerseite, gemeldet als ihr Strike-Slot", () => {
  const match = midGame();
  match.players[1]!.commandHand.splice(0, match.players[1]!.commandHand.length, commandById("piercing_shot"));
  match.board.place(match.board.lane("player", "command"), 4, { ...interceptor, hp: 10 });
  const shot = (target: SlotTarget): TurnPlan => plan({ command: { handIndex: 0, target, destination: null } });
  expect(match.submit(1, shot(command(6)))).toBe("target_not_enemy_slot");
  expect(match.submit(0, pass)).toBeNull();
  expect(match.submit(1, shot(command(4)))).toBeNull();
  const events = match.resolveRound();
  expect(events).toContainEqual({ kind: "command", side: "enemy", cardId: "piercing_shot", target: { side: "player", ...strike(4) } });
  expect(match.board.lane("player", "command").slots[4]!.hp).toBe(7);
});

test("Das Ausweichmanöver verlegt in einen freien Slot derselben Lane, nicht das manövrierte Schiff und nicht ins Manöverziel", () => {
  const match = midGame();
  const player = match.players[0]!;
  player.commandHand.splice(0, player.commandHand.length, commandById("evasive_action"));
  for (const index of [0, 1, 2, 3]) match.board.place(match.board.lane("player", "strike"), index, { ...interceptor });
  const evade = (destination: number, parts: Partial<TurnPlan> = {}): TurnPlan => plan({ command: { handIndex: 0, target: strike(0), destination }, ...parts });
  expect(match.submit(0, evade(1))).toBe("destination_unavailable");
  expect(match.submit(0, evade(4, { maneuver: { ship: strike(0), destination: command(0) } }))).toBe("maneuver_conflict");
  expect(match.submit(0, evade(4, { maneuver: { ship: strike(1), destination: strike(4) } }))).toBe("destination_unavailable");
  // Die Lane ist voll, das Ausweichen innerhalb der Lane geht trotzdem.
  expect(match.submit(0, evade(5, { maneuver: { ship: strike(1), destination: strike(4) } }))).toBeNull();
});

test("Ziehende Befehle ziehen über den Spieler: Plündern 1 + 1, Gegenmaßnahmen ohne gegnerischen Angriff 1 Befehl", () => {
  const match = midGame();
  const [first, second] = match.players as [(typeof match.players)[0], (typeof match.players)[0]];
  first.commandHand.splice(0, first.commandHand.length, commandById("countermeasures"));
  second.commandHand.splice(0, second.commandHand.length, commandById("emergency_shields"));
  match.board.place(match.board.lane("enemy", "strike"), 0, { ...interceptor });
  const events = playRound(match, [
    plan({ command: { handIndex: 0, target: null, destination: null } }),
    plan({ command: { handIndex: 0, target: strike(0), destination: null } }),
  ]);
  expect(events).toContainEqual({ kind: "draw", side: "player", cardId: "countermeasures", ships: 0, commands: 1 });
  // Gezogen beim Gegenmaßnahmen-Befehl, dann das Nachziehen der Runde.
  expect(first.commandHand).toHaveLength(2);
});
