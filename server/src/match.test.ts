import { expect, test } from "bun:test";
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
    { kind: "attack" as const, amount: 2,
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
  const plan = { ship: null, command: { handIndex: 0, target: { lane: "strike" as const, slotIndex: 0 } } };
  expect(match.submit(0, plan)).toBe("target_wrong_lane");
});

test("Wer keine angriffsfähigen Schiffe mehr hat, verliert; danach gibt es keine Züge mehr", () => {
  const match = startedMatch();
  const [first, second] = match.players;
  for (const player of [first!, second!]) {
    player.shipHand.splice(0, player.shipHand.length);
    while (player.shipDeck.draw() !== null);
  }
  match.board.place(match.board.lane("player", "strike"), 0, { kind: "ship", id: "void_interceptor", shipClass: "fighter", hp: 3, atk: 3, shield: 0 });
  const pass = { ship: null, command: null };
  match.submit(0, pass);
  match.submit(1, pass);
  match.resolveRound();
  expect(match.view(0).result).toBe("won");
  expect(match.view(1).result).toBe("lost");
  expect(match.submit(0, pass)).toBe("match_over");
});
