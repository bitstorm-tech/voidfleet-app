// Misst Spieltempo und Balance der Admirale: Bot gegen Bot über `Match`, beide Pläne per `planBotTurn`.
// Jede Paarung von Admiralen (auch gegen sich selbst) spielt gleich viele Partien, die Sitze wechseln sich ab.
// Aufruf aus server/: `bun tools/simulate.ts [partien je Paarung]` (Standard 2000).

import { ADMIRAL_IDS, ADMIRALS, type AdmiralId } from "../../shared/admirals.ts";
import { opposite, type Side, slotTarget } from "../../shared/board.ts";
import { type CommandId, isFlagship, shipById } from "../../shared/cards.ts";
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
/** Je Partie die Runde, in der das erste Flaggschiff fiel. */
const flagshipFalls: number[] = [];
let kills = 0;
let roundsWithoutKill = 0;
let combatDamage = 0;
let commandDamage = 0;
/** Schüsse im Kampf (ohne Railgun): alle, verpufft (`fizzle`), von der Deckung abgefangen (`aimedAt` ohne `taunt`), von Ablenkung gezogen (`taunt`). */
const shots = { all: 0, fizzled: 0, covered: 0, taunted: 0 };
let commands = 0;
let commandsWithoutEffect = 0;
const emptyCommandHand = [0, 0];
/** Je Karte: wie oft gespielt, wie oft ohne Wirkung (`noEffect`, `miss`), wie oft von Gegenmaßnahmen verpufft. */
const cards = new Map<CommandId, { played: number; held: number; idle: number; countered: number }>();
const card = (id: CommandId) => cards.get(id) ?? cards.set(id, { played: 0, held: 0, idle: 0, countered: 0 }).get(id)!;
/** Kennzahlen der neuen Karten aus der Erweiterung, über alle Partien. */
const stats = new Map<string, number>();
const count = (key: string, amount = 1) => stats.set(key, (stats.get(key) ?? 0) + amount);
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

/** Zählt, was ein Effekt der neuen Befehle bewirkt hat; `flagships` stehen vor der Runde, `events` sind die der Runde. */
function newCardEffect(
  event: Extract<RoundEvent, { kind: "effect" }>,
  flagships: readonly { side: Side; lane: string; slotIndex: number }[],
  events: readonly RoundEvent[],
): void {
  const { cardId, effect, ship } = event;
  if (effect.type === "jump") {
    count("Kurzsprung");
    if (isFlagship(shipById(ship.cardId))) count("Kurzsprung: Flaggschiff");
  }
  if (effect.type === "ram") {
    count("Rammkurs");
    if (effect.targetAfter.hp <= 0) count("Rammkurs: Ziel zerstört");
    if (event.after.hp <= 0) count("Rammkurs: Rammer zerstört");
  }
  if (effect.type === "jam") count("Funkstille: Marke bzw. Trugbild entfernt");
  if (cardId === "heat_seeker" && effect.type === "damage" && effect.amount === 5) count("Wärmesucher: 5 Schaden (bewegtes Ziel)");
  if (cardId === "minefield") count("Minenfeld: Treffer");
  if (cardId === "drone_squadron") count("Drohnenstaffel: Drohnen");
  if (cardId === "tractor_beam" && effect.type === "move" && ship.lane === "strike") {
    const flagship = flagships.find((slot) => slot.side === ship.side && slot.lane === "command" && slot.slotIndex === ship.slotIndex);
    if (flagship) {
      count("Traktorstrahl: Flaggschiff freigelegt");
      const hit = events.some((other) => other.kind === "attack" && other.target.side === flagship.side && isFlagship(shipById(other.target.cardId)));
      if (hit) count("Traktorstrahl: freigelegtes Flaggschiff beschossen");
    }
  }
}

/** Ersatzzug, falls die Zugprüfung einen Bot-Zug ablehnt: nur das Flaggschiff in Runde 1, sonst passen. */
function fallback(round: number): TurnPlan {
  return { ships: [], command: null, maneuver: null, flagship: round === 1 ? { lane: "command", slotIndex: 2 } : null, power: null, mark: null, fire: [] };
}

function play(admirals: readonly [AdmiralId, AdmiralId]): Game {
  const match = new Match("simulate");
  match.join("a");
  match.join("b");
  for (const seat of [0, 1] as const) match.chooseAdmiral(seat, admirals[seat]);
  const side = (seat: Seat) => match.players[seat]!.side;
  const admiralOf = (of: Side) => admirals[side(0) === of ? 0 : 1];
  let firstKill: number | null = null;
  let flagshipFall: number | null = null;
  while (match.winner === null && match.round <= ROUND_LIMIT) {
    for (const player of match.players) {
      if (player.commandHand.length === 0) emptyCommandHand[player.seat]! += 1;
      for (const { id } of player.commandHand) card(id).held += 1;
      const error = match.submit(player.seat, planBotTurn(match.board, match.botView(player.seat), match.round));
      if (error) {
        errors.set(error, (errors.get(error) ?? 0) + 1);
        match.submit(player.seat, fallback(match.round));
      }
    }
    const round = match.round;
    // Wo die Flaggschiffe vor der Runde stehen: Zieht ein Traktorstrahl den Wächter davor weg, liegt eins frei.
    const flagships = [side(0), side(1)]
      .map((of) => match.board.flagship(of))
      .filter((slot) => slot !== null)
      .map((slot) => ({ side: slot.lane.side, ...slotTarget(slot) }));
    const events = match.resolveRound();
    const destroyed = events.filter((event) => event.kind === "destroyed").length;
    kills += destroyed;
    if (destroyed === 0) roundsWithoutKill += 1;
    else firstKill ??= round;
    if (round > 1) for (const of of [side(0), side(1)]) usage.get(admiralOf(of))!.rounds += 1;
    for (const event of events) {
      if (event.kind === "attack" || event.kind === "fizzle") shots.all += 1;
      if (event.kind === "fizzle") shots.fizzled += 1;
      if (event.kind === "attack" && event.aimedAt && !event.taunt) shots.covered += 1;
      if (event.kind === "attack" && event.taunt) shots.taunted += 1;
      if (event.kind === "destroyed" && isFlagship(shipById(event.ship.cardId))) flagshipFall ??= round;
      if (event.kind === "attack") combatDamage += event.amount;
      if (event.kind === "effect" && event.effect.type === "damage") commandDamage += event.effect.amount;
      if (event.kind === "command") {
        commands += 1;
        card(event.cardId).played += 1;
      }
      if (event.kind === "noEffect" || event.kind === "miss") {
        commandsWithoutEffect += 1;
        card(event.cardId).idle += 1;
      }
      if (event.kind === "countered") {
        card(event.countered).countered += 1;
        count("Gegenmaßnahmen: verpufft");
      }
      if (event.kind === "draw" && event.cardId === "countermeasures") count("Gegenmaßnahmen: gezogen");
      if (event.kind === "power") usage.get(admiralOf(event.side))!.powers += 1;
      if (event.kind === "maneuver" || event.kind === "swap") usage.get(admiralOf(event.side))!.maneuvers += 1;
      if (event.kind === "effect") newCardEffect(event, flagships, events);
      const effect = abilityEffect(event);
      if (effect) {
        const { effects } = usage.get(admiralOf(effect.side))!;
        effects.set(effect.key, (effects.get(effect.key) ?? 0) + effect.amount);
      }
    }
    for (const of of [side(0), side(1)]) {
      const own = (event: RoundEvent) => "side" in event && event.side === of;
      if (events.some((event) => own(event) && event.kind === "rule" && event.cardId === "carte_blanche")) {
        count(
          "Freie Hand: mit Manöver und Fähigkeit",
          events.some((event) => own(event) && (event.kind === "maneuver" || event.kind === "swap")) &&
            events.some((event) => own(event) && event.kind === "power")
            ? 1
            : 0,
        );
      }
    }
  }
  if (firstKill !== null) firstKills.push(firstKill);
  if (flagshipFall !== null) flagshipFalls.push(flagshipFall);
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
console.log(
  `Unentschieden: ${games.filter((game) => game.winner === "draw").length}, Patts (Runde ${ROUND_LIMIT} erreicht): ${games.filter((game) => game.winner === null).length}`,
);
console.log("Einsatz ab Runde 2 (Anteil der Runden) und Wirkung der Fähigkeiten je Partie:");
for (const id of ADMIRAL_IDS) {
  const { games: count, rounds: own, powers, maneuvers, effects } = usage.get(id)!;
  const perGame = [...effects].map(([key, amount]) => `${key} ${(amount / count).toFixed(1)}`).join(", ");
  console.log(`  ${name(id).padEnd(20)} Fähigkeit ${percent(powers, own).padStart(7)}, Grundmanöver ${percent(maneuvers, own).padStart(7)}; ${perGame}`);
}
console.log(`Abschüsse pro Runde: ${(kills / totalRounds).toFixed(2)}, Runden ohne Abschuss: ${percent(roundsWithoutKill, totalRounds)}`);
console.log(`Erster Abschuss: Ø Runde ${average(firstKills)}; erstes Flaggschiff fällt: Ø Runde ${average(flagshipFalls)}`);
console.log(
  `Schüsse im Kampf: ${(shots.all / totalRounds).toFixed(2)} je Runde, davon verpufft ${percent(shots.fizzled, shots.all)}, ` +
    `von Deckung abgefangen ${percent(shots.covered, shots.all)}, von Ablenkung gezogen ${percent(shots.taunted, shots.all)}`,
);
console.log(`Schaden durch Befehle: ${percent(commandDamage, commandDamage + combatDamage)} (Nennwerte, ohne Eigenschaden)`);
console.log(`Befehle ohne Wirkung: ${percent(commandsWithoutEffect, commands)} (noEffect und Fehlschüsse)`);
console.log(`Leere Befehlshand: Seat 0 ${percent(emptyCommandHand[0]!, totalRounds)}, Seat 1 ${percent(emptyCommandHand[1]!, totalRounds)}`);
console.log("Befehle je Karte: gespielt (Anteil an allen), wie oft gespielt je Runde auf der Hand, davon ohne Wirkung bzw. von Gegenmaßnahmen verpufft:");
for (const [id, { played, held, idle, countered }] of [...cards].sort((a, b) => b[1].played - a[1].played)) {
  const columns = [percent(played, commands), percent(played, held), percent(idle, played), percent(countered, played)].map((value) => value.padStart(7));
  console.log(
    `  ${id.padEnd(18)} ${String(played).padStart(6)} ${columns[0]}   je Handrunde ${columns[1]}   ohne Wirkung ${columns[2]}   verpufft ${columns[3]}`,
  );
}
console.log("Neue Karten (Anzahl über alle Partien):");
const playedOf = (id: CommandId) => cards.get(id)?.played ?? 0;
console.log(`  Kurzsprünge ${stats.get("Kurzsprung") ?? 0}, davon Flaggschiff ${stats.get("Kurzsprung: Flaggschiff") ?? 0}`);
console.log(
  `  Rammstöße ${stats.get("Rammkurs") ?? 0}, Ziel zerstört ${stats.get("Rammkurs: Ziel zerstört") ?? 0}, Rammer zerstört ${stats.get("Rammkurs: Rammer zerstört") ?? 0}`,
);
console.log(
  `  Gegenmaßnahmen ${playedOf("countermeasures")}: Befehl verpufft ${stats.get("Gegenmaßnahmen: verpufft") ?? 0}, gezogen ${stats.get("Gegenmaßnahmen: gezogen") ?? 0}`,
);
console.log(`  Funkstille ${playedOf("radio_silence")}: entfernte Marken bzw. Trugbilder ${stats.get("Funkstille: Marke bzw. Trugbild entfernt") ?? 0}`);
console.log(
  `  Traktorstrahl ${playedOf("tractor_beam")}: Flaggschiff freigelegt ${stats.get("Traktorstrahl: Flaggschiff freigelegt") ?? 0}, danach beschossen ${stats.get("Traktorstrahl: freigelegtes Flaggschiff beschossen") ?? 0}`,
);
console.log(`  Wärmesucher ${playedOf("heat_seeker")}: mit 5 Schaden ${stats.get("Wärmesucher: 5 Schaden (bewegtes Ziel)") ?? 0}`);
console.log(
  `  Minenfeld ${playedOf("minefield")}: Treffer je Karte ${((stats.get("Minenfeld: Treffer") ?? 0) / Math.max(1, playedOf("minefield"))).toFixed(2)}`,
);
console.log(
  `  Drohnenstaffel ${playedOf("drone_squadron")}: Drohnen je Karte ${((stats.get("Drohnenstaffel: Drohnen") ?? 0) / Math.max(1, playedOf("drone_squadron"))).toFixed(2)}`,
);
console.log(`  Freie Hand ${playedOf("carte_blanche")}: mit Manöver und Fähigkeit ${stats.get("Freie Hand: mit Manöver und Fähigkeit") ?? 0}`);
console.log(errors.size === 0 ? "Zugprüfung: keine Fehler" : `Zugprüfung: ${[...errors].map(([code, count]) => `${code} ${count}×`).join(", ")}`);
console.log(`Dauer ${((performance.now() - started) / 1000).toFixed(1)} s`);
