import { expect, test } from "bun:test";
import type { TurnPlan } from "../../shared/protocol.ts";
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
  const plan = { ship: null, command: { handIndex: 0, target: { lane: "strike" as const, slotIndex: 0 }, destination: 1 } };
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
  });
  expect(match.submit(0, intercept(null))).toBe("destination_required");
  expect(match.submit(0, intercept(0))).toBe("destination_unavailable");
  expect(match.submit(0, intercept(4, 4))).toBe("destination_unavailable");
  expect(match.submit(0, intercept(5, 4))).toBeNull();
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
const pass: TurnPlan = { ship: null, command: null };
const deploy: TurnPlan = { ship: { handIndex: 0, target: { lane: "strike", slotIndex: 0 } }, command: null };

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
  const deployCombat: TurnPlan = { ship: { handIndex: 1, target: { lane: "strike", slotIndex: 0 } }, command: null };
  expect(match.submit(0, deployCombat)).toBeNull();
  expect(match.isRoundComplete).toBe(true);
  match.resolveRound();
  expect(match.board.shipCount("enemy")).toBe(1);
  expect(match.winner).toBeNull();
  expect(match.round).toBe(2);
});
