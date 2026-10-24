import { expect, test } from "bun:test";
import type { RoundEvent, SlotTarget, TurnPlan } from "../../shared/protocol.ts";
import { commandById, SHIPS, shipById, type ShipCard } from "../../shared/cards.ts";
import { Match } from "./match.ts";

function startedMatch(): Match {
  const match = new Match("test");
  match.join("a");
  match.join("b");
  return match;
}

test("Ereignisse für Seat 1 sind gespiegelt, auch in verschachtelten Schiffen", () => {
  const match = startedMatch();
  const events = [
    { kind: "attack" as const, amount: 2, after: { hp: 1, shield: 0 },
      attacker: { side: "player" as const, lane: "strike" as const, slotIndex: 0, cardId: "horizon_cruiser" as const },
      target: { side: "enemy" as const, lane: "strike" as const, slotIndex: 1, cardId: "repair_drone" as const } },
  ];
  expect(match.eventsFor(1, events)).toEqual([
    { ...events[0]!, attacker: { ...events[0]!.attacker, side: "enemy" }, target: { ...events[0]!.target, side: "player" } },
  ]);
});

test("Befehlsziele müssen in der passenden Lane stehen", () => {
  const match = startedMatch();
  const player = match.players[0]!;
  match.board.place(match.board.lane("player", "strike"), 0, player.shipHand[0]!);
  player.commandHand.splice(0, player.commandHand.length);
  player.commandHand.push({ kind: "command", id: "intercept", commandType: "reposition", targetMode: "choose_friendly", targetLane: "command" });
  const plan = { ships: [], command: { handIndex: 0, target: { lane: "strike" as const, slotIndex: 0 }, destination: 1 }, maneuver: null };
  expect(match.submit(0, plan)).toBe("target_wrong_lane");
});

test("Verlegende Befehle brauchen einen freien Ziel-Slot in der anderen Lane, auch nach dem eigenen Deploy", () => {
  const match = startedMatch();
  const player = match.players[0]!;
  const ship = player.shipHand[0]!;
  match.board.place(match.board.lane("player", "command"), 2, ship);
  match.board.place(match.board.lane("player", "strike"), 0, ship);
  player.commandHand.splice(0, player.commandHand.length, commandById("intercept"));
  const intercept = (destination: number | null, deployTo: number | null = null): TurnPlan => ({
    ships: deployTo === null ? [] : [{ handIndex: 0, target: { lane: "strike", slotIndex: deployTo } }],
    command: { handIndex: 0, target: { lane: "command", slotIndex: 2 }, destination },
    maneuver: null,
  });
  expect(match.submit(0, intercept(null))).toBe("destination_required");
  expect(match.submit(0, intercept(0))).toBe("destination_unavailable");
  expect(match.submit(0, intercept(4, 4))).toBe("destination_unavailable");
  expect(match.submit(0, intercept(5, 4))).toBeNull();
});

test("Befehle dürfen das Schiff treffen, das in derselben Runde gelegt wird", () => {
  const match = startedMatch();
  const player = match.players[0]!;
  player.commandHand.splice(0, player.commandHand.length, commandById("overcharge"));
  const overcharge = (lane: "strike" | "command", slotIndex: number): TurnPlan => ({
    ships: [{ handIndex: 0, target: { lane: "strike", slotIndex: 2 } }],
    command: { handIndex: 0, target: { lane, slotIndex }, destination: null },
    maneuver: null,
  });
  expect(match.submit(0, overcharge("strike", 3))).toBe("target_not_own_ship");
  expect(match.submit(0, { ...overcharge("strike", 2), ships: [] })).toBe("target_not_own_ship");
  expect(match.submit(0, overcharge("strike", 2))).toBeNull();
});

test("Das gelegte Schiff darf sofort die Lane wechseln, die Lane-Grenze gilt dabei weiter", () => {
  const match = startedMatch();
  const player = match.players[0]!;
  const ship = player.shipHand[0]!;
  player.commandHand.splice(0, player.commandHand.length, commandById("intercept"), commandById("recall"));
  /** Legt ein Schiff in `lane` auf Slot `deployTo` und verlegt es mit Intercept (aus Command) bzw. Recall (aus Strike). */
  const deployAndMove = (lane: "strike" | "command", deployTo: number, destination: number): TurnPlan => ({
    ships: [{ handIndex: 0, target: { lane, slotIndex: deployTo } }],
    command: { handIndex: lane === "command" ? 0 : 1, target: { lane, slotIndex: deployTo }, destination },
    maneuver: null,
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
  const match = startedMatch();
  const player = match.players[0]!;
  const ship = player.shipHand[0]!;
  player.commandHand.splice(0, player.commandHand.length, commandById("recall"));
  match.board.place(match.board.lane("player", "strike"), 0, ship);
  const recall = (deployTo: number, destination: number): TurnPlan => ({
    ships: [{ handIndex: 0, target: { lane: "command", slotIndex: deployTo } }],
    command: { handIndex: 0, target: { lane: "strike", slotIndex: 0 }, destination },
    maneuver: null,
  });
  expect(match.submit(0, recall(2, 2))).toBe("destination_unavailable");
  for (const index of [3, 4]) match.board.place(match.board.lane("player", "command"), index, ship);
  // Command: 2 Schiffe + Deploy = 3, der Wechsel macht 4.
  expect(match.submit(0, recall(2, 1))).toBeNull();
  player.plan = null;
  match.board.place(match.board.lane("player", "command"), 5, ship);
  // Command: 3 Schiffe + Deploy = 4, kein Platz mehr für den Wechsel.
  expect(match.submit(0, recall(2, 1))).toBe("destination_unavailable");
});

test("Ein Befehl auf das gelegte Schiff wirkt in derselben Runde", () => {
  const match = startedMatch();
  for (const player of match.players) {
    player.shipHand.splice(0, player.shipHand.length, { ...interceptor, hp: 10 });
    player.commandHand.splice(0, player.commandHand.length, commandById("emergency_shields"), commandById("intercept"));
  }
  const shielded: TurnPlan = { ...deploy, command: { handIndex: 0, target: { lane: "strike", slotIndex: 0 }, destination: null } };
  const intercepted: TurnPlan = {
    ships: [{ handIndex: 0, target: { lane: "command", slotIndex: 2 } }],
    command: { handIndex: 1, target: { lane: "command", slotIndex: 2 }, destination: 4 },
    maneuver: null,
  };
  playRound(match, [shielded, intercepted]);
  // Schild 3 fängt den Treffer des Interceptors (3 + 2 ATK durch Intercept) bis auf 2 ab.
  expect(match.board.lane("player", "strike").slots[0]!.state).toEqual({ cardId: "void_interceptor", hp: 8, shield: 0, scrapBonus: 0 });
  expect(match.board.lane("enemy", "command").slots[2]!.isOccupied).toBe(false);
  expect(match.board.lane("enemy", "strike").slots[4]!.state).toEqual({ cardId: "void_interceptor", hp: 7, shield: 0, scrapBonus: 0 });
});

const strike = (slotIndex: number): SlotTarget => ({ lane: "strike", slotIndex });
const command = (slotIndex: number): SlotTarget => ({ lane: "command", slotIndex });

test("Das Grundmanöver verlegt ein eigenes Schiff vom Brett in einen freien Slot, auch in derselben Lane", () => {
  const match = startedMatch();
  const player = match.players[0]!;
  const ship = player.shipHand[0]!;
  match.board.place(match.board.lane("player", "strike"), 1, ship);
  match.board.place(match.board.lane("player", "command"), 3, ship);
  const maneuver = (from: SlotTarget, destination: SlotTarget, deployTo: SlotTarget | null = null): TurnPlan => ({
    ships: deployTo ? [{ handIndex: 0, target: deployTo }] : [],
    command: null,
    maneuver: { ship: from, destination },
  });
  expect(match.submit(0, maneuver(strike(0), command(2)))).toBe("maneuver_not_own_ship");
  // Das gelegte Schiff ist noch nicht auf dem Brett und manövriert nicht.
  expect(match.submit(0, maneuver(strike(2), command(2), strike(2)))).toBe("maneuver_not_own_ship");
  expect(match.submit(0, maneuver(strike(1), command(3)))).toBe("maneuver_destination_unavailable");
  expect(match.submit(0, maneuver(strike(1), command(6)))).toBe("maneuver_destination_unavailable");
  expect(match.submit(0, maneuver(strike(1), command(2), command(2)))).toBe("maneuver_destination_unavailable");
  expect(match.submit(0, maneuver(strike(1), strike(1)))).toBe("maneuver_destination_unavailable");
  expect(match.submit(0, maneuver(strike(1), strike(4), strike(4)))).toBe("maneuver_destination_unavailable");
  expect(match.submit(0, maneuver(strike(1), strike(4)))).toBeNull();
});

test("Innerhalb der Lane manövriert ein Schiff auch in einer vollen Lane, etwa in die Deckung", () => {
  const match = startedMatch();
  const player = match.players[0]!;
  const drone = shipById("repair_drone");
  match.board.place(match.board.lane("player", "strike"), 2, player.shipHand[0]!);
  for (const index of [0, 3, 4, 5]) match.board.place(match.board.lane("player", "command"), index, drone);
  const lane = match.board.lane("player", "command");
  expect(match.board.isExposed(lane.slots[0]!)).toBe(true);
  // In die volle Command-Lane wechselt niemand, innerhalb von ihr schon.
  expect(match.board.canMove(match.board.lane("player", "strike").slots[2]!, command(1))).toBe(false);
  expect(match.submit(0, { ships: [], command: null, maneuver: { ship: command(0), destination: command(2) } })).toBeNull();
  match.submit(1, pass);
  const events = match.resolveRound();

  expect(events.find((event) => event.kind === "maneuver")).toMatchObject({ ship: { lane: "command", slotIndex: 0 }, to: command(2) });
  expect(lane.slots[0]!.isOccupied).toBe(false);
  expect(lane.slots[2]!.card?.id).toBe("repair_drone");
  expect(match.board.isExposed(lane.slots[2]!)).toBe(false);
});

test("Manöver und Bewegungsbefehl bewegen verschiedene Schiffe in verschiedene Slots, zusammen mit dem Deploy unter der Lane-Grenze", () => {
  const match = startedMatch();
  const player = match.players[0]!;
  const ship = player.shipHand[0]!;
  for (const index of [1, 4]) match.board.place(match.board.lane("player", "strike"), index, ship);
  for (const index of [3, 5]) match.board.place(match.board.lane("player", "command"), index, ship);
  player.commandHand.splice(0, player.commandHand.length, commandById("flanking_maneuver"));
  const plan = (deployTo: SlotTarget | null, from: SlotTarget, destination: SlotTarget, flankFrom: SlotTarget, flankTo: number): TurnPlan => ({
    ships: deployTo ? [{ handIndex: 0, target: deployTo }] : [],
    command: { handIndex: 0, target: flankFrom, destination: flankTo },
    maneuver: { ship: from, destination },
  });
  expect(match.submit(0, plan(null, strike(1), command(2), strike(1), 4))).toBe("maneuver_conflict");
  expect(match.submit(0, plan(null, strike(1), command(2), strike(4), 2))).toBe("destination_unavailable");
  // Der Slot, den das Manöver räumt, bleibt für den Befehl belegt.
  expect(match.submit(0, plan(null, command(3), strike(2), strike(1), 3))).toBe("destination_unavailable");
  // Command: 2 Schiffe + Deploy + Manöver = 4, für den Befehl ist kein Platz mehr; ohne Deploy schon.
  expect(match.submit(0, plan(command(0), strike(1), command(2), strike(4), 4))).toBe("destination_unavailable");
  expect(match.submit(0, plan(null, strike(1), command(2), strike(4), 4))).toBeNull();
});

test("Ein Befehl auf das manövrierte Schiff folgt ihm; es feuert nicht, wird aber beschossen", () => {
  const match = startedMatch();
  for (const player of match.players) {
    player.shipHand.splice(0, player.shipHand.length, { ...interceptor, hp: 10 });
    player.commandHand.splice(0, player.commandHand.length, commandById("overcharge"));
  }
  playRound(match, [deploy, deploy]);
  const overchargeAndManeuver: TurnPlan = {
    ships: [],
    command: { handIndex: 0, target: strike(0), destination: null },
    maneuver: { ship: strike(0), destination: command(2) },
  };
  expect(match.submit(0, overchargeAndManeuver)).toBeNull();
  match.submit(1, pass);
  const events = match.resolveRound();

  expect(events.find((event) => event.kind === "maneuver")).toEqual({
    kind: "maneuver",
    side: "player",
    ship: { side: "player", lane: "strike", slotIndex: 0, cardId: "void_interceptor" },
    to: command(2),
  });
  expect(events.find((event) => event.kind === "command")).toMatchObject({ target: command(2) });
  expect(events.find((event) => event.kind === "effect")).toMatchObject({ ship: { lane: "command", slotIndex: 2 } });
  expect(events.filter((event) => event.kind === "attack").map((event) => event.attacker.side)).toEqual(["enemy"]);
  // 7 HP nach Runde 1, 3 Schaden vom Gegner, 2 Eigenschaden durch Overcharge.
  expect(match.board.lane("player", "command").slots[2]!.state).toEqual({ cardId: "void_interceptor", hp: 2, shield: 0, scrapBonus: 0 });
  expect(match.board.lane("player", "command").slots[2]!.maneuvered).toBe(false);
  expect(match.board.lane("enemy", "strike").slots[0]!.state).toEqual({ cardId: "void_interceptor", hp: 7, shield: 0, scrapBonus: 0 });
});

test("Die Starthand hat genau 1 Support- und 3 Kampfschiffe", () => {
  for (let i = 0; i < 50; i++) {
    for (const player of startedMatch().players) {
      const classes = player.shipHand.map((card) => card.shipClass === "support");
      expect(classes.sort()).toEqual([false, false, false, true]);
      expect(player.shipDeck.size).toBe(SHIPS.length * 2 - 4);
    }
  }
});

const interceptor = { kind: "ship" as const, id: "void_interceptor" as const, shipClass: "fighter" as const, hp: 3, atk: 3, shield: 0 };
const pass: TurnPlan = { ships: [], command: null, maneuver: null };
const deploy: TurnPlan = { ships: [{ handIndex: 0, target: { lane: "strike", slotIndex: 0 } }], command: null, maneuver: null };

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

test("In Runde 1 darf jeder zwei Schiffe in verschiedene Slots legen, danach eines", () => {
  const match = startedMatch();
  const twoShips = (first: SlotTarget, second: SlotTarget): TurnPlan => ({
    ships: [{ handIndex: 0, target: first }, { handIndex: 1, target: second }],
    command: null,
    maneuver: null,
  });
  const threeShips: TurnPlan = { ...twoShips(strike(0), strike(1)), ships: [0, 1, 2].map((handIndex) => ({ handIndex, target: strike(handIndex) })) };
  expect(match.submit(0, threeShips)).toBe("too_many_ships");
  expect(match.submit(0, twoShips(strike(2), strike(2)))).toBe("slot_unavailable");
  expect(match.submit(0, { ...twoShips(strike(2), strike(3)), ships: [{ handIndex: 1, target: strike(2) }, { handIndex: 1, target: strike(3) }] })).toBe("ship_not_in_hand");
  expect(match.submit(0, twoShips(strike(2), command(2)))).toBeNull();
  match.submit(1, twoShips(strike(1), strike(4)));
  const deploys = match.resolveRound().filter((event) => event.kind === "deploy");
  expect(deploys.filter((event) => event.side === "player")).toHaveLength(2);
  expect(deploys.filter((event) => event.side === "enemy")).toHaveLength(2);
  expect(match.players[0]!.shipHand).toHaveLength(3);
  expect(match.submit(0, twoShips(strike(0), strike(5)))).toBe("too_many_ships");
});

test("Zwei Deploys halten zusammen Lane- und Flottengrenze ein", () => {
  const match = startedMatch();
  const ship = match.players[0]!.shipHand[0]!;
  const twoShips = (first: SlotTarget, second: SlotTarget): TurnPlan => ({
    ships: [{ handIndex: 0, target: first }, { handIndex: 1, target: second }],
    command: null,
    maneuver: null,
  });
  for (const index of [0, 1, 2]) match.board.place(match.board.lane("player", "strike"), index, ship);
  expect(match.submit(0, twoShips(strike(3), strike(4)))).toBe("slot_unavailable");
  match.board.place(match.board.lane("player", "command"), 0, ship);
  match.board.place(match.board.lane("player", "command"), 1, ship);
  // 5 Schiffe + 2 Deploys überschreiten die Flottengrenze von 6.
  expect(match.submit(0, twoShips(strike(3), command(2)))).toBe("slot_unavailable");
  expect(match.submit(0, { ...twoShips(strike(3), command(2)), ships: [{ handIndex: 0, target: strike(3) }] })).toBeNull();
});

test("Befehle und Lane-Wechsel berücksichtigen beide Deploys der ersten Runde", () => {
  const match = startedMatch();
  match.players[0]!.commandHand.splice(0, match.players[0]!.commandHand.length, commandById("intercept"));
  const plan = (destination: number): TurnPlan => ({
    ships: [{ handIndex: 0, target: strike(2) }, { handIndex: 1, target: command(4) }],
    command: { handIndex: 0, target: command(4), destination },
    maneuver: null,
  });
  // Intercept auf das zweite gelegte Schiff, aber nicht in den Slot des ersten.
  expect(match.submit(0, plan(2))).toBe("destination_unavailable");
  expect(match.submit(0, plan(4))).toBeNull();
});

test("Wer am Rundenende weder auf dem Feld noch auf der Hand ein Kampfschiff hat, verliert; danach gibt es keine Züge mehr", () => {
  const match = startedMatch();
  setShipHands(match, [{ ...interceptor, hp: 10 }], [{ ...interceptor, hp: 10 }]);
  for (const player of match.players) player.commandHand.splice(0, player.commandHand.length);
  playRound(match, [deploy, deploy]);
  expect(match.winner).toBeNull();

  match.board.lane("enemy", "strike").slots[0]!.clear();
  playRound(match);
  expect(match.view(0).result).toBe("won");
  expect(match.view(1).result).toBe("lost");
  expect(match.round).toBe(2);
  expect(match.submit(0, pass)).toBe("match_over");
});

test("Wer aufgibt, verliert sofort, auch mit abgegebenem Zug; danach gibt es keine Züge mehr", () => {
  const match = startedMatch();
  expect(match.submit(0, pass)).toBeNull();
  expect(match.surrender(1)).toBeNull();
  expect(match.view(0)).toMatchObject({ result: "won", surrendered: true, submittedPlan: null });
  expect(match.view(1)).toMatchObject({ result: "lost", surrendered: true });
  expect(match.isRoundComplete).toBe(false);
  expect(match.submit(1, pass)).toBe("match_over");
  expect(match.surrender(0)).toBe("match_over");
});

test("Aufgeben geht erst, wenn der Gegner da ist", () => {
  const match = new Match("test");
  match.join("a");
  expect(match.surrender(0)).toBe("opponent_missing");
});

test("Ohne Kampfschiff auf dem Feld geht es weiter, solange eines auf der Hand liegt", () => {
  const match = startedMatch();
  setShipHands(match, [interceptor], [interceptor]);
  playRound(match, [deploy, pass]);
  expect(match.winner).toBeNull();
  expect(match.round).toBe(2);
});

test("Support-Schiffe allein halten die Flotte nicht am Leben, auch nicht auf der Hand", () => {
  const match = startedMatch();
  setShipHands(match, [{ ...interceptor, hp: 10 }], [shipById("repair_drone"), shipById("signal_booster")]);
  playRound(match, [deploy, deploy]);
  expect(match.view(0).result).toBe("won");
  expect(match.view(1).result).toBe("lost");
});

test("Hat keiner mehr ein Kampfschiff, weder auf dem Feld noch auf der Hand, endet das Match unentschieden", () => {
  const match = startedMatch();
  setShipHands(match, [], []);
  playRound(match);
  expect(match.view(0).result).toBe("draw");
});

test("Sind beide Flotten in derselben Runde vernichtet und die Hände leer, endet das Match unentschieden", () => {
  const match = startedMatch();
  setShipHands(match, [{ ...interceptor, hp: 1 }], [{ ...interceptor, hp: 1 }]);
  for (const player of match.players) player.commandHand.splice(0, player.commandHand.length);
  playRound(match, [deploy, deploy]);
  expect(match.view(0).result).toBe("draw");
  expect(match.view(1).result).toBe("draw");
});

test("Ab Runde 8 gilt der Overdrive schon beim Planen der Runde", () => {
  const match = startedMatch();
  match.round = 7;
  playRound(match);
  expect(match.round).toBe(8);
  expect(match.board.overdrive).toBe(1);
});

test("Der Gegner sieht Handgrößen, Decks und die aufgedeckten Befehle, aber keine Handkarten", () => {
  const alone = new Match("test");
  alone.join("a");
  expect(alone.view(0).opponent).toBeNull();

  const match = startedMatch();
  const player = match.players[0]!;
  player.commandHand.splice(0, player.commandHand.length, commandById("scavenge"), commandById("torpedo"));
  const torpedo = { ships: [], command: { handIndex: 1, target: { lane: "strike" as const, slotIndex: 0 }, destination: null }, maneuver: null };
  expect(match.submit(0, torpedo)).toBeNull();
  // Bis zum Aufdecken ist nur bekannt, dass er abgegeben hat.
  expect(match.view(1).opponent).toMatchObject({ submitted: true, commandHandSize: 2, playedCommands: [] });
  expect(match.submit(1, { ships: [], command: null, maneuver: null })).toBeNull();
  match.resolveRound();
  expect(match.view(1).opponent).toEqual({
    submitted: false,
    shipHandSize: 5,
    commandHandSize: 2,
    shipDeckSize: 11,
    commandDeckSize: 11,
    playedCommands: ["torpedo"],
  });
});

test("Der Computergegner nimmt den freien Platz und zieht, sobald der Spieler abgibt", () => {
  const match = new Match("test");
  match.join("a");
  expect(match.addBot()).toBe(1);
  expect(match.addBot()).toBeNull();
  expect(match.join("c")).toBeNull();
  expect(match.view(0).opponent).toMatchObject({ submitted: false, playedCommands: [] });

  expect(match.submit(0, deploy)).toBeNull();
  expect(match.isRoundComplete).toBe(true);
  const events = match.resolveRound();
  // In Runde 1 legt auch der Bot zwei Schiffe.
  expect(events.filter((event) => event.kind === "deploy" && event.side === "enemy")).toHaveLength(2);
  expect(match.winner).toBeNull();
  expect(match.round).toBe(2);
});

test("Der Torpedo zielt auf einen Slot der Gegnerseite, auch einen leeren, und verlegt nichts", () => {
  const match = startedMatch();
  const player = match.players[0]!;
  player.commandHand.splice(0, player.commandHand.length, commandById("torpedo"));
  const torpedo = (target: SlotTarget | null, destination: number | null = null): TurnPlan => ({
    ships: [],
    command: { handIndex: 0, target, destination },
    maneuver: null,
  });
  expect(match.submit(0, torpedo(null))).toBe("target_required");
  expect(match.submit(0, torpedo(strike(6)))).toBe("target_not_enemy_slot");
  expect(match.submit(0, torpedo(strike(2), 2))).toBe("destination_not_allowed");
  expect(match.submit(0, torpedo(command(4)))).toBeNull();
});

test("Seat 1 schießt einen Torpedo: Er trifft den gespiegelten Brett-Slot, nach einem Manöver verpufft er", () => {
  const match = startedMatch();
  const [first, second] = match.players;
  first!.shipHand.splice(0, first!.shipHand.length, { ...interceptor, hp: 20 });
  second!.shipHand.splice(0, second!.shipHand.length, { ...interceptor, hp: 20 });
  second!.commandHand.splice(0, second!.commandHand.length, commandById("torpedo"), commandById("torpedo"));
  const deployTo = (slotIndex: number): TurnPlan => ({ ships: [{ handIndex: 0, target: strike(slotIndex) }], command: null, maneuver: null });
  playRound(match, [deployTo(2), deployTo(0)]);
  const torpedo: TurnPlan = { ships: [], command: { handIndex: 0, target: strike(2), destination: null }, maneuver: null };

  match.submit(0, pass);
  match.submit(1, torpedo);
  const hit = match.resolveRound();
  // Brett: Seat 1 sitzt auf "enemy", sein Ziel liegt auf "player". 20 − 3 (Kampf in Runde 1) − 5.
  expect(hit.find((event) => event.kind === "effect")).toMatchObject({ ship: { side: "player", lane: "strike", slotIndex: 2 }, after: { hp: 12 } });
  const commandEvent: RoundEvent = { kind: "command", side: "enemy", cardId: "torpedo", target: { side: "player", ...strike(2) } };
  expect(hit).toContainEqual(commandEvent);
  expect(match.eventsFor(1, hit)).toContainEqual({ ...commandEvent, side: "player", target: { side: "enemy", ...strike(2) } });
  expect(match.eventsFor(1, hit).find((event) => event.kind === "effect")).toMatchObject({
    side: "player",
    ship: { side: "enemy", lane: "strike", slotIndex: 2 },
    effect: { type: "damage", amount: 5 },
  });

  match.submit(0, { ships: [], command: null, maneuver: { ship: strike(2), destination: command(3) } });
  match.submit(1, torpedo);
  const missed = match.resolveRound();
  const miss: RoundEvent = { kind: "miss", side: "enemy", cardId: "torpedo", target: { side: "player", ...strike(2) } };
  expect(missed).toContainEqual(miss);
  expect(match.eventsFor(1, missed)).toContainEqual({ ...miss, side: "player", target: { side: "enemy", ...strike(2) } });
  expect(match.board.lane("player", "command").slots[3]!.card?.id).toBe("void_interceptor");
});

test("Fällt ein Schiff schon beim Deploy durch die Plasma Frigate, entfallen sein Manöver und der Befehl darauf", () => {
  const match = new Match("test", () => 0);
  match.join("a");
  match.join("b");
  setShipHands(match, [], [shipById("plasma_frigate")]);
  const first = match.players[0]!;
  first.commandHand.splice(0, first.commandHand.length, commandById("emergency_shields"));
  match.board.place(match.board.lane("player", "strike"), 3, { ...interceptor, hp: 1 });
  const plan: TurnPlan = {
    ships: [],
    command: { handIndex: 0, target: strike(3), destination: null },
    maneuver: { ship: strike(3), destination: command(1) },
  };
  const events = playRound(match, [plan, { ships: [{ handIndex: 0, target: strike(2) }], command: null, maneuver: null }]);
  expect(events.map((event) => event.kind)).toEqual(["pass", "deploy", "ability", "destroyed", "command", "noEffect"]);
});
