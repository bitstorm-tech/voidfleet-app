import { expect, test } from "bun:test";
import type { RoundEvent, SlotTarget, TurnPlan } from "../../shared/protocol.ts";
import { commandById, SHIPS, shipById } from "../../shared/cards.ts";
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
  const plan = { ship: null, command: { handIndex: 0, target: { lane: "strike" as const, slotIndex: 0 }, destination: 1 }, maneuver: null };
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
    ship: deployTo === null ? null : { handIndex: 0, target: { lane: "strike", slotIndex: deployTo } },
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
    ship: { handIndex: 0, target: { lane: "strike", slotIndex: 2 } },
    command: { handIndex: 0, target: { lane, slotIndex }, destination: null },
    maneuver: null,
  });
  expect(match.submit(0, overcharge("strike", 3))).toBe("target_not_own_ship");
  expect(match.submit(0, { ...overcharge("strike", 2), ship: null })).toBe("target_not_own_ship");
  expect(match.submit(0, overcharge("strike", 2))).toBeNull();
});

test("Das gelegte Schiff darf sofort die Lane wechseln, die Lane-Grenze gilt dabei weiter", () => {
  const match = startedMatch();
  const player = match.players[0]!;
  const ship = player.shipHand[0]!;
  player.commandHand.splice(0, player.commandHand.length, commandById("intercept"), commandById("recall"));
  /** Legt ein Schiff in `lane` auf Slot `deployTo` und verlegt es mit Intercept (aus Command) bzw. Recall (aus Strike). */
  const deployAndMove = (lane: "strike" | "command", deployTo: number, destination: number): TurnPlan => ({
    ship: { handIndex: 0, target: { lane, slotIndex: deployTo } },
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
    ship: { handIndex: 0, target: { lane: "command", slotIndex: deployTo } },
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
    ship: { handIndex: 0, target: { lane: "command", slotIndex: 2 } },
    command: { handIndex: 1, target: { lane: "command", slotIndex: 2 }, destination: 4 },
    maneuver: null,
  };
  playRound(match, [shielded, intercepted]);
  // Schild 3 fängt den Treffer des Interceptors (3 + 2 ATK durch Intercept) bis auf 2 ab.
  expect(match.board.lane("player", "strike").slots[0]!.state).toEqual({ cardId: "void_interceptor", hp: 8, shield: 0 });
  expect(match.board.lane("enemy", "command").slots[2]!.isOccupied).toBe(false);
  expect(match.board.lane("enemy", "strike").slots[4]!.state).toEqual({ cardId: "void_interceptor", hp: 7, shield: 0 });
});

const strike = (slotIndex: number): SlotTarget => ({ lane: "strike", slotIndex });
const command = (slotIndex: number): SlotTarget => ({ lane: "command", slotIndex });

test("Das Grundmanöver verlegt ein eigenes Schiff vom Brett in einen freien Slot der anderen Lane", () => {
  const match = startedMatch();
  const player = match.players[0]!;
  const ship = player.shipHand[0]!;
  match.board.place(match.board.lane("player", "strike"), 1, ship);
  match.board.place(match.board.lane("player", "command"), 3, ship);
  const maneuver = (from: SlotTarget, destination: number, deployTo: SlotTarget | null = null): TurnPlan => ({
    ship: deployTo && { handIndex: 0, target: deployTo },
    command: null,
    maneuver: { ship: from, destination },
  });
  expect(match.submit(0, maneuver(strike(0), 2))).toBe("maneuver_not_own_ship");
  // Das gelegte Schiff ist noch nicht auf dem Brett und manövriert nicht.
  expect(match.submit(0, maneuver(strike(2), 2, strike(2)))).toBe("maneuver_not_own_ship");
  expect(match.submit(0, maneuver(strike(1), 3))).toBe("maneuver_destination_unavailable");
  expect(match.submit(0, maneuver(strike(1), 6))).toBe("maneuver_destination_unavailable");
  expect(match.submit(0, maneuver(strike(1), 2, command(2)))).toBe("maneuver_destination_unavailable");
  expect(match.submit(0, maneuver(strike(1), 1))).toBeNull();
});

test("Manöver und Bewegungsbefehl bewegen verschiedene Schiffe in verschiedene Slots, zusammen mit dem Deploy unter der Lane-Grenze", () => {
  const match = startedMatch();
  const player = match.players[0]!;
  const ship = player.shipHand[0]!;
  for (const index of [1, 4]) match.board.place(match.board.lane("player", "strike"), index, ship);
  for (const index of [3, 5]) match.board.place(match.board.lane("player", "command"), index, ship);
  player.commandHand.splice(0, player.commandHand.length, commandById("flanking_maneuver"));
  const plan = (deployTo: SlotTarget | null, from: SlotTarget, destination: number, flankFrom: SlotTarget, flankTo: number): TurnPlan => ({
    ship: deployTo && { handIndex: 0, target: deployTo },
    command: { handIndex: 0, target: flankFrom, destination: flankTo },
    maneuver: { ship: from, destination },
  });
  expect(match.submit(0, plan(null, strike(1), 2, strike(1), 4))).toBe("maneuver_conflict");
  expect(match.submit(0, plan(null, strike(1), 2, strike(4), 2))).toBe("destination_unavailable");
  // Der Slot, den das Manöver räumt, bleibt für den Befehl belegt.
  expect(match.submit(0, plan(null, command(3), 2, strike(1), 3))).toBe("destination_unavailable");
  // Command: 2 Schiffe + Deploy + Manöver = 4, für den Befehl ist kein Platz mehr; ohne Deploy schon.
  expect(match.submit(0, plan(command(0), strike(1), 2, strike(4), 4))).toBe("destination_unavailable");
  expect(match.submit(0, plan(null, strike(1), 2, strike(4), 4))).toBeNull();
});

test("Ein Befehl auf das manövrierte Schiff folgt ihm; es feuert nicht, wird aber beschossen", () => {
  const match = startedMatch();
  for (const player of match.players) {
    player.shipHand.splice(0, player.shipHand.length, { ...interceptor, hp: 10 });
    player.commandHand.splice(0, player.commandHand.length, commandById("overcharge"));
  }
  playRound(match, [deploy, deploy]);
  const overchargeAndManeuver: TurnPlan = {
    ship: null,
    command: { handIndex: 0, target: strike(0), destination: null },
    maneuver: { ship: strike(0), destination: 2 },
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
  expect(match.board.lane("player", "command").slots[2]!.state).toEqual({ cardId: "void_interceptor", hp: 2, shield: 0 });
  expect(match.board.lane("player", "command").slots[2]!.maneuvered).toBe(false);
  expect(match.board.lane("enemy", "strike").slots[0]!.state).toEqual({ cardId: "void_interceptor", hp: 7, shield: 0 });
});

test("Die Starthand hat genau 1 Support- und 2 Kampfschiffe", () => {
  for (let i = 0; i < 50; i++) {
    for (const player of startedMatch().players) {
      const classes = player.shipHand.map((card) => card.shipClass === "support");
      expect(classes.sort()).toEqual([false, false, true]);
      expect(player.shipDeck.size).toBe(SHIPS.length * 2 - 3);
    }
  }
});

const interceptor = { kind: "ship" as const, id: "void_interceptor" as const, shipClass: "fighter" as const, hp: 3, atk: 3, shield: 0 };
const pass: TurnPlan = { ship: null, command: null, maneuver: null };
const deploy: TurnPlan = { ship: { handIndex: 0, target: { lane: "strike", slotIndex: 0 } }, command: null, maneuver: null };

function playRound(match: Match, plans = [pass, pass]): void {
  match.submit(0, plans[0]!);
  match.submit(1, plans[1]!);
  match.resolveRound();
}

test("Wer am Rundenende kein angriffsfähiges Schiff mehr auf dem Feld hat, verliert, auch mit Schiffen auf der Hand; danach gibt es keine Züge mehr", () => {
  const match = startedMatch();
  for (const player of match.players) {
    player.shipHand.splice(0, player.shipHand.length, { ...interceptor, hp: 10 });
    player.commandHand.splice(0, player.commandHand.length);
  }
  playRound(match, [deploy, deploy]);
  expect(match.winner).toBeNull();

  match.board.lane("enemy", "strike").slots[0]!.clear();
  match.players[1]!.shipHand.push(interceptor);
  playRound(match);
  expect(match.view(0).result).toBe("won");
  expect(match.view(1).result).toBe("lost");
  expect(match.submit(0, pass)).toBe("match_over");
});

test("Wer in Runde 1 kein Schiff legt, hat verloren", () => {
  const match = startedMatch();
  match.players[0]!.shipHand.splice(0, match.players[0]!.shipHand.length, interceptor);
  playRound(match, [deploy, pass]);
  expect(match.view(0).result).toBe("won");
  expect(match.view(1).result).toBe("lost");
});

test("Support-Schiffe allein halten die Flotte nicht am Leben", () => {
  const match = startedMatch();
  const [first, second] = match.players;
  first!.shipHand.splice(0, first!.shipHand.length, { ...interceptor, hp: 10 });
  second!.shipHand.splice(0, second!.shipHand.length, shipById("repair_drone"));
  playRound(match, [deploy, deploy]);
  expect(match.view(0).result).toBe("won");
  expect(match.view(1).result).toBe("lost");
});

test("Legen beide in Runde 1 kein Schiff, endet das Match unentschieden", () => {
  const match = startedMatch();
  playRound(match);
  expect(match.view(0).result).toBe("draw");
});

test("Sind beide Flotten in derselben Runde vernichtet, endet das Match unentschieden", () => {
  const match = startedMatch();
  for (const player of match.players) {
    player.shipHand.splice(0, player.shipHand.length, { ...interceptor, hp: 1 });
    player.commandHand.splice(0, player.commandHand.length);
  }
  playRound(match, [deploy, deploy]);
  expect(match.view(0).result).toBe("draw");
  expect(match.view(1).result).toBe("draw");
});

test("Der Computergegner nimmt den freien Platz und zieht, sobald der Spieler abgibt", () => {
  const match = new Match("test");
  match.join("a");
  expect(match.addBot()).toBe(1);
  expect(match.addBot()).toBeNull();
  expect(match.join("c")).toBeNull();
  expect(match.view(0).opponent).toEqual({ joined: true, submitted: false });

  // Hand-Index 1 ist ein Kampfschiff; mit Index 0 (Support) wäre die Flotte sofort geschlagen.
  const deployCombat: TurnPlan = { ship: { handIndex: 1, target: { lane: "strike", slotIndex: 0 } }, command: null, maneuver: null };
  expect(match.submit(0, deployCombat)).toBeNull();
  expect(match.isRoundComplete).toBe(true);
  match.resolveRound();
  expect(match.board.shipCount("enemy")).toBe(1);
  expect(match.winner).toBeNull();
  expect(match.round).toBe(2);
});

test("Der Torpedo zielt auf einen Slot der Gegnerseite, auch einen leeren, und verlegt nichts", () => {
  const match = startedMatch();
  const player = match.players[0]!;
  player.commandHand.splice(0, player.commandHand.length, commandById("torpedo"));
  const torpedo = (target: SlotTarget | null, destination: number | null = null): TurnPlan => ({
    ship: null,
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
  const deployTo = (slotIndex: number): TurnPlan => ({ ship: { handIndex: 0, target: strike(slotIndex) }, command: null, maneuver: null });
  playRound(match, [deployTo(2), deployTo(0)]);
  const torpedo: TurnPlan = { ship: null, command: { handIndex: 0, target: strike(2), destination: null }, maneuver: null };

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

  match.submit(0, { ship: null, command: null, maneuver: { ship: strike(2), destination: 3 } });
  match.submit(1, torpedo);
  const missed = match.resolveRound();
  const miss: RoundEvent = { kind: "miss", side: "enemy", cardId: "torpedo", target: { side: "player", ...strike(2) } };
  expect(missed).toContainEqual(miss);
  expect(match.eventsFor(1, missed)).toContainEqual({ ...miss, side: "player", target: { side: "enemy", ...strike(2) } });
  expect(match.board.lane("player", "command").slots[3]!.card?.id).toBe("void_interceptor");
});
