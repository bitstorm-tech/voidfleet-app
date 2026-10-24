// Misst das Spieltempo: Bot gegen Bot über `Match`, beide Pläne per `planBotTurn`.
// Aufruf aus server/: `bun tools/simulate.ts [partien]` (Standard 2000).

import type { CommandId } from "../../shared/cards.ts";
import type { ErrorCode } from "../../shared/protocol.ts";
import { planBotTurn } from "../src/bot.ts";
import { Match } from "../src/match.ts";

const GAMES = Number(process.argv[2] ?? 2000);
/** Wer so lange spielt, steckt im Patt. */
const ROUND_LIMIT = 60;

const rounds: number[] = [];
const firstKills: number[] = [];
let draws = 0;
let stalemates = 0;
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
const maneuvers = [0, 0];
const played = new Map<CommandId, number>();
const errors = new Map<ErrorCode, number>();

for (let game = 0; game < GAMES; game++) {
  const match = new Match("simulate");
  match.join("a");
  match.join("b");
  let firstKill: number | null = null;
  while (match.winner === null) {
    if (match.round > ROUND_LIMIT) {
      stalemates += 1;
      break;
    }
    for (const player of match.players) {
      if (player.commandHand.length === 0) emptyCommandHand[player.seat]! += 1;
      const plan = planBotTurn(match.board, player, match.round);
      if (plan.maneuver) maneuvers[player.seat]! += 1;
      const error = match.submit(player.seat, plan);
      if (error) {
        errors.set(error, (errors.get(error) ?? 0) + 1);
        match.submit(player.seat, { ships: [], command: null, maneuver: null });
      }
    }
    const round = match.round;
    const events = match.resolveRound();
    const destroyed = events.filter((event) => event.kind === "destroyed").length;
    kills += destroyed;
    if (destroyed === 0) roundsWithoutKill += 1;
    else firstKill ??= round;
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
    }
  }
  if (match.winner === "draw") draws += 1;
  rounds.push(Math.min(match.round, ROUND_LIMIT));
  if (firstKill !== null) firstKills.push(firstKill);
}

const totalRounds = rounds.reduce((sum, value) => sum + value, 0);
const sorted = [...rounds].sort((a, b) => a - b);
const quantile = (q: number) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))]!;
const percent = (part: number, whole: number) => `${((100 * part) / Math.max(1, whole)).toFixed(1)} %`;
const average = (values: number[]) => (values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length)).toFixed(1);

console.log(`${GAMES} Partien Bot gegen Bot`);
console.log(`Runden: Ø ${average(rounds)}, Median ${quantile(0.5)}, p10 ${quantile(0.1)}, p90 ${quantile(0.9)}, max ${sorted.at(-1)}`);
console.log(`Unentschieden: ${draws}, Patts (Runde ${ROUND_LIMIT} erreicht): ${stalemates}`);
console.log(`Abschüsse pro Runde: ${(kills / totalRounds).toFixed(2)}, Runden ohne Abschuss: ${percent(roundsWithoutKill, totalRounds)}`);
console.log(`Erster Abschuss: Ø Runde ${average(firstKills)}`);
console.log(`Schaden durch Befehle: ${percent(commandDamage, commandDamage + combatDamage)} (Nennwerte, ohne Eigenschaden)`);
console.log(`Befehle ohne Wirkung: ${percent(commandsWithoutEffect, commands)} (noEffect und Torpedo-Fehlschüsse)`);
console.log(`Leere Befehlshand: Seat 0 ${percent(emptyCommandHand[0]!, totalRounds)}, Seat 1 ${percent(emptyCommandHand[1]!, totalRounds)}`);
console.log(`Runden mit Manöver: Seat 0 ${percent(maneuvers[0]!, totalRounds)}, Seat 1 ${percent(maneuvers[1]!, totalRounds)}`);
console.log(`Torpedo: ${torpedoHits} Treffer, ${torpedoMisses} Fehlschüsse (${percent(torpedoHits, torpedoHits + torpedoMisses)} Treffer)`);
console.log(`Sperrfeuer: ${barrages - barragesWithoutEffect} mit Wirkung, ${barragesWithoutEffect} ohne`);
console.log("Befehle je Karte (Anteil an allen gespielten):");
for (const [id, count] of [...played].sort((a, b) => b[1] - a[1])) console.log(`  ${id.padEnd(18)} ${String(count).padStart(6)}  ${percent(count, commands)}`);
console.log(errors.size === 0 ? "Zugprüfung: keine Fehler" : `Zugprüfung: ${[...errors].map(([code, count]) => `${code} ${count}×`).join(", ")}`);
