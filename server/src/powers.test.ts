import { describe, expect, test } from "bun:test";
import { Board, type LaneType, type Side, type Slot } from "../../shared/board.ts";
import { type ShipId, shipById } from "../../shared/cards.ts";
import { canMark, markTargets, powerTargets, railgunFires } from "../../shared/powers.ts";
import type { SlotRef, SlotTarget } from "../../shared/protocol.ts";

function place(board: Board, side: Side, lane: LaneType, slotIndex: number, id: ShipId): Slot {
  return board.place(board.lane(side, lane), slotIndex, shipById(id))!;
}

const ref = (side: Side, lane: LaneType, slotIndex: number): SlotRef => ({ side, lane, slotIndex });
const at = (lane: LaneType, slotIndex: number): SlotTarget => ({ lane, slotIndex });

/** Eigene Seite: ein Kreuzer vorne, eine Repair Drone dahinter; Gegner: ein Jäger vor seiner Hive. */
function board(): Board {
  const board = new Board();
  place(board, "player", "strike", 1, "horizon_cruiser");
  place(board, "player", "command", 1, "repair_drone");
  place(board, "enemy", "strike", 2, "void_interceptor");
  place(board, "enemy", "command", 2, "hive");
  return board;
}

describe("Ziele der Admiralsfähigkeiten", () => {
  const flagship = { card: shipById("vanguard"), target: at("command", 4) };

  test("Gegenfeuer auf jedes eigene Schiff, auch auf eines, das in dieser Runde landet", () => {
    expect(powerTargets(board(), "player", "counterfire", [flagship], [])).toEqual([
      ref("player", "strike", 1),
      ref("player", "command", 1),
      ref("player", "command", 4),
    ]);
  });

  test("Taktvorsprung nur auf eigene Kampfschiffe, gelegte eingeschlossen", () => {
    const booster = { card: shipById("signal_booster"), target: at("strike", 0) };
    expect(powerTargets(board(), "player", "head_start", [flagship, booster], [])).toEqual([ref("player", "strike", 1), ref("player", "command", 4)]);
  });

  test("Fokusfeuer auf jedes gegnerische Schiff, gedeckt oder nicht", () => {
    expect(powerTargets(board(), "player", "focus_fire", [], [])).toEqual([ref("enemy", "strike", 2), ref("enemy", "command", 2)]);
  });

  test("Schwarmangriff nur mit einer eigenen Drohne auf dem Brett und nie auf das Flaggschiff", () => {
    const withDrone = board();
    expect(powerTargets(withDrone, "player", "swarm_strike", [], [])).toEqual([]);
    place(withDrone, "player", "strike", 5, "drone");
    expect(powerTargets(withDrone, "player", "swarm_strike", [], [])).toEqual([ref("enemy", "strike", 2)]);
  });

  test("Trugbild in einen freien eigenen Strike-Slot, in dem in dieser Runde nichts landet oder hinzieht", () => {
    const deploy = { card: shipById("iron_dreadnought"), target: at("strike", 0) };
    const targets = powerTargets(board(), "player", "decoy", [deploy, flagship], [at("strike", 5)]);
    expect(targets).toEqual([ref("player", "strike", 2), ref("player", "strike", 3), ref("player", "strike", 4)]);
  });
});

describe("Markierung der Pendulum", () => {
  test("nur mit der Pendulum auf dem Brett, auf jedes gegnerische Schiff, nicht in der Runde, in der ihre Railgun feuert", () => {
    const board = new Board();
    const target = place(board, "enemy", "strike", 0, "horizon_cruiser");
    place(board, "enemy", "command", 3, "bastion");
    expect([canMark(board, "player"), markTargets(board, "player")]).toEqual([false, []]);
    place(board, "player", "command", 2, "pendulum");
    expect(markTargets(board, "player")).toEqual([ref("enemy", "strike", 0), ref("enemy", "command", 3)]);
    target.marked = true;
    expect([railgunFires(board, "player"), railgunFires(board, "enemy")]).toEqual([true, false]);
    expect([canMark(board, "player"), markTargets(board, "player")]).toEqual([false, []]);
  });
});
