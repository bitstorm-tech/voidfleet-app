// Misst Spieltempo und Balance der Admirale: Bot gegen Bot über `Match`, beide Pläne per `planBotTurn`.
// Jede Paarung von Admiralen (auch gegen sich selbst) spielt gleich viele Partien, die Sitze wechseln sich ab.
// Aufruf aus server/: `bun tools/simulate.ts [partien je Paarung]` (Standard 2000).

import { ADMIRAL_IDS, ADMIRALS, type AdmiralId } from "../../shared/admirals.ts";
import { opposite, type Side } from "../../shared/board.ts";
import type { CommandId } from "../../shared/cards.ts";
import type { ErrorCode, RoundEvent, TurnPlan } from "../../shared/protocol.ts";
import { planBotTurn } from "../src/bot.ts";
import { Match, type Seat } from "../src/match.ts";

const GAMES = Number(process.argv[2] ?? 2000);
/** Wer so lange spielt, steckt im Patt. */
const ROUND_LIMIT = 60;

interface Game {
  admirals: readonly [AdmiralId, AdmiralId];
  /** Sitz des Siegers, "draw" bei Unentschieden, null bei Patt (Rundenlimit). */
  winner: Seat | "draw" | null;
  rounds: number;
}

const games: Game[] = [];
const firstKills: number[] = [];
let kills = 0;
let roundsWithoutKill = 0;
let combatDamage = 0;
let commandDamage = 0;
let commands = 0;
let commandsWithoutEffect = 0;
let torpedoHits = 0;
let torpedoMisses = 0;
let barrages = 0;
let barragesWithoutEffect = 0;
const emptyCommandHand = [0, 0];
const played = new Map<CommandId, number>();
const errors = new Map<ErrorCode, number>();
/** Je Admiral: Runden ab Runde 2, davon mit Fähigkeit bzw. Grundmanöver (samt Phasentausch), und was seine Fähigkeiten bewirkt haben. */
const usage = new Map(ADMIRAL_IDS.map((id) => [id, { games: 0, rounds: 0, powers: 0, maneuvers: 0, effects: new Map<string, number>() }]));

/** Was eine Flaggschiff- oder Admiralsfähigkeit bewirkt hat, für die Seite, deren Admiral sie gehört. */
function abilityEffect(event: RoundEvent): { side: Side; key: string; amount: number } | null {
  switch (event.kind) {
    case "counterfire":
      return { side: event.source.side, key: "Gegenfeuer-Schaden", amount: event.amount };
    case "attack":
      if (event.focus) return { side: event.attacker.side, key: "Fokustreffer", amount: 1 };
      if (event.swarm) return { side: event.attacker.side, key: "Schwarmtreffer", amount: 1 };
      if (event.target.cardId === "decoy") return { side: event.target.side, key: "Treffer aufs Trugbild", amount: 1 };
      return null;
    case "spawn":
      return event.source.cardId === "hive" ? { side: event.source.side, key: "Drohnen der Hive", amount: 1 } : null;
    case "swap":
      return { side: event.side, key: "Phasentausche", amount: 1 };
    case "railgun":
      return { side: event.source.side, key: event.blocked ? "Railgun blockiert" : "Railgun-Treffer", amount: 1 };
    case "silenced":
      return { side: opposite(event.ship.side), key: "verstummt", amount: 1 };
    default:
      return null;
  }
}

/** Ersatzzug, falls die Zugprüfung einen Bot-Zug ablehnt: nur das Flaggschiff in Runde 1, sonst passen. */
function fallback(round: number): TurnPlan {
  return { ships: [], command: null, maneuver: null, flagship: round === 1 ? { lane: "command", slotIndex: 2 } : null, power: null, mark: null };
}

function play(admirals: readonly [AdmiralId, AdmiralId]): Game {
  const match = new Match("simulate");
  match.join("a");
  match.join("b");
  for (const seat of [0, 1] as const) match.chooseAdmiral(seat, admirals[seat]);
  const side = (seat: Seat) => match.players[seat]!.side;
  const admiralOf = (of: Side) => admirals[side(0) === of ? 0 : 1];
  let firstKill: number | null = null;
  while (match.winner === null && match.round <= ROUND_LIMIT) {
    for (const player of match.players) {
      if (player.commandHand.length === 0) emptyCommandHand[player.seat]! += 1;
      const error = match.submit(player.seat, planBotTurn(match.board, match.botView(player.seat), match.round));
      if (error) {
        errors.set(error, (errors.get(error) ?? 0) + 1);
        match.submit(player.seat, fallback(match.round));
      }
    }
    const round = match.round;
    const events = match.resolveRound();
    const destroyed = events.filter((event) => event.kind === "destroyed").length;
    kills += destroyed;
    if (destroyed === 0) roundsWithoutKill += 1;
    else firstKill ??= round;
    if (round > 1) for (const of of [side(0), side(1)]) usage.get(admiralOf(of))!.rounds += 1;
    for (const event of events) {
      if (event.kind === "attack") combatDamage += event.amount;
      if (event.kind === "effect" && event.effect.type === "damage") commandDamage += event.effect.amount;
      if (event.kind === "command") {
        commands += 1;
        played.set(event.cardId, (played.get(event.cardId) ?? 0) + 1);
        if (event.cardId === "barrage") barrages += 1;
      }
      if (event.kind === "noEffect") {
        commandsWithoutEffect += 1;
        if (event.cardId === "barrage") barragesWithoutEffect += 1;
      }
      if (event.kind === "miss") {
        commandsWithoutEffect += 1;
        torpedoMisses += 1;
      }
      if (event.kind === "effect" && event.cardId === "torpedo") torpedoHits += 1;
      if (event.kind === "power") usage.get(admiralOf(event.side))!.powers += 1;
      if (event.kind === "maneuver" || event.kind === "swap") usage.get(admiralOf(event.side))!.maneuvers += 1;
      const effect = abilityEffect(event);
      if (effect) {
        const { effects } = usage.get(admiralOf(effect.side))!;
        effects.set(effect.key, (effects.get(effect.key) ?? 0) + effect.amount);
      }
    }
  }
  if (firstKill !== null) firstKills.push(firstKill);
  for (const admiral of admirals) usage.get(admiral)!.games += 1;
  const winner = match.winner === null ? null : match.winner === "draw" ? "draw" : match.winner === side(0) ? 0 : 1;
  return { admirals, winner, rounds: Math.min(match.round, ROUND_LIMIT) };
}

const started = performance.now();
for (const [index, first] of ADMIRAL_IDS.entries()) {
  for (const second of ADMIRAL_IDS.slice(index)) {
    for (let game = 0; game < GAMES; game++) games.push(play(game % 2 === 0 ? [first, second] : [second, first]));
  }
}

const rounds = games.map((game) => game.rounds);
const totalRounds = rounds.reduce((sum, value) => sum + value, 0);
const sorted = [...rounds].sort((a, b) => a - b);
const quantile = (q: number) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))]!;
const percent = (part: number, whole: number) => `${((100 * part) / Math.max(1, whole)).toFixed(1)} %`;
const average = (values: number[]) => (values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length)).toFixed(1);

/** Siegquote von `admiral` gegen `opponent`; Unentschieden und Patts zählen halb. */
function score(admiral: AdmiralId, opponent: AdmiralId): number {
  let points = 0;
  let count = 0;
  for (const { admirals, winner } of games) {
    const seat = admirals[0] === admiral && admirals[1] === opponent ? 0 : admirals[1] === admiral && admirals[0] === opponent ? 1 : null;
    if (seat === null) continue;
    count += 1;
    points += winner === seat ? 1 : winner === "draw" || winner === null ? 0.5 : 0;
  }
  return points / count;
}

const name = (id: AdmiralId) => `${id} (${ADMIRALS[id].flagship})`;
console.log(`${GAMES} Partien je Paarung Bot gegen Bot, Sitze abwechselnd, ${games.length} insgesamt`);
console.log("Siegquote der Zeile gegen die Spalte (Unentschieden und Patts halb):");
console.log(`${"".padEnd(20)}${ADMIRAL_IDS.map((id) => id.padStart(11)).join("")}     gesamt`);
for (const row of ADMIRAL_IDS) {
  const others = ADMIRAL_IDS.filter((column) => column !== row);
  const cells = ADMIRAL_IDS.map((column) => (column === row ? "–" : `${(100 * score(row, column)).toFixed(0)} %`).padStart(11));
  const total = others.reduce((sum, column) => sum + score(row, column), 0) / others.length;
  console.log(`${name(row).padEnd(20)}${cells.join("")}   ${(100 * total).toFixed(1).padStart(6)} %`);
}
console.log(`Runden: Ø ${average(rounds)}, Median ${quantile(0.5)}, p10 ${quantile(0.1)}, p90 ${quantile(0.9)}, max ${sorted.at(-1)}`);
console.log(`Unentschieden: ${games.filter((game) => game.winner === "draw").length}, Patts (Runde ${ROUND_LIMIT} erreicht): ${games.filter((game) => game.winner === null).length}`);
console.log("Einsatz ab Runde 2 (Anteil der Runden) und Wirkung der Fähigkeiten je Partie:");
for (const id of ADMIRAL_IDS) {
  const { games: count, rounds: own, powers, maneuvers, effects } = usage.get(id)!;
  const perGame = [...effects].map(([key, amount]) => `${key} ${(amount / count).toFixed(1)}`).join(", ");
  console.log(`  ${name(id).padEnd(20)} Fähigkeit ${percent(powers, own).padStart(7)}, Grundmanöver ${percent(maneuvers, own).padStart(7)}; ${perGame}`);
}
console.log(`Abschüsse pro Runde: ${(kills / totalRounds).toFixed(2)}, Runden ohne Abschuss: ${percent(roundsWithoutKill, totalRounds)}`);
console.log(`Erster Abschuss: Ø Runde ${average(firstKills)}`);
console.log(`Schaden durch Befehle: ${percent(commandDamage, commandDamage + combatDamage)} (Nennwerte, ohne Eigenschaden)`);
console.log(`Befehle ohne Wirkung: ${percent(commandsWithoutEffect, commands)} (noEffect und Torpedo-Fehlschüsse)`);
console.log(`Leere Befehlshand: Seat 0 ${percent(emptyCommandHand[0]!, totalRounds)}, Seat 1 ${percent(emptyCommandHand[1]!, totalRounds)}`);
console.log(`Torpedo: ${torpedoHits} Treffer, ${torpedoMisses} Fehlschüsse (${percent(torpedoHits, torpedoHits + torpedoMisses)} Treffer)`);
console.log(`Sperrfeuer: ${barrages - barragesWithoutEffect} mit Wirkung, ${barragesWithoutEffect} ohne`);
console.log("Befehle je Karte (Anteil an allen gespielten):");
for (const [id, count] of [...played].sort((a, b) => b[1] - a[1])) console.log(`  ${id.padEnd(18)} ${String(count).padStart(6)}  ${percent(count, commands)}`);
console.log(errors.size === 0 ? "Zugprüfung: keine Fehler" : `Zugprüfung: ${[...errors].map(([code, count]) => `${code} ${count}×`).join(", ")}`);
console.log(`Dauer ${((performance.now() - started) / 1000).toFixed(1)} s`);
