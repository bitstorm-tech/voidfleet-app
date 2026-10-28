// Misst Spieltempo und Balance der Admirale: Bot gegen Bot über `Match`, beide Pläne per `planBotTurn`.
// Jede Paarung von Admiralen (auch gegen sich selbst) spielt gleich viele Partien, die Sitze wechseln sich ab.
// Aufruf aus server/: `bun tools/simulate.ts [partien je Paarung]` (Standard 2000).

import { ADMIRAL_IDS, ADMIRALS, type AdmiralId } from "../../shared/admirals.ts";
import { type Board, opposite, type Side, slotTarget } from "../../shared/board.ts";
import { type CommandId, isFlagship, isToken, shipById } from "../../shared/cards.ts";
import type { ErrorCode, RoundEvent, SlotRef, TurnPlan } from "../../shared/protocol.ts";
import { planBotDraft, planBotTurn } from "../src/bot.ts";
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
/**
 * Schüsse im Kampf (ohne Railgun): alle, verpufft (`fizzle`), durchgegangen auf das Schiff hinter einem gefallenen
 * (`through`), von Ablenkung gezogen (`taunt`).
 */
const shots = { all: 0, fizzled: 0, through: 0, taunted: 0 };
type Mode = "ship" | "column";
/**
 * Feuerbefehle je Modus: alle, je Admiral und je Lane des Ziels beim Planen (Schiffsfeuer: das Ziel; Spaltenfeuer: das
 * vorderste Schiff der Spalte, `empty`, wenn sie leer war).
 */
const orders = {
  all: { ship: 0, column: 0 },
  admiral: new Map(ADMIRAL_IDS.map((id) => [id, { ship: 0, column: 0 }])),
  lane: { strike: { ship: 0, column: 0 }, command: { ship: 0, column: 0 }, empty: { ship: 0, column: 0 } },
};
/**
 * Was aus den Schüssen je Modus wurde: Treffer (Spaltenfeuer davon durchgegangen), von Ablenkung gezogen, verpufft
 * (Spaltenfeuer: ins Leere bzw. nach einem Abschuss in der Spalte; Schiffsfeuer: gedeckt, schon zerstört, nicht mehr
 * auf dem Brett). `swarm`: Drohnen im Schwarmangriff ohne eigenen
 * Feuerbefehl, `swarmFizzled` davon verpufft. `moved`: Schiffsfeuer auf ein Ziel, das in dieser Runde vor dem Kampf den
 * Slot gewechselt hat (Grundmanöver, Phasentausch, Befehl), `movedHit` davon Treffer.
 */
const outcomes = {
  column: { shots: 0, hit: 0, through: 0, taunted: 0, void: 0, cleared: 0 },
  ship: { shots: 0, hit: 0, taunted: 0, covered: 0, destroyed: 0, gone: 0, moved: 0, movedHit: 0 },
  /**
   * Woher die Deckung kam, an der Schiffsfeuer verpuffte: Sie stand schon beim Planen und fiel nicht, das Ziel zog in
   * Deckung, vor ihm landete ein neues Schiff (Deploy, Trugbild, Drohne) bzw. zog eines davor.
   */
  cover: { held: 0, retreated: 0, arrived: 0, moved: 0 },
  swarm: 0,
  swarmFizzled: 0,
};
/**
 * Grundmanöver (ohne Phasentausch): alle, davon in eine andere Spalte (Ausweichen), davon mit gegnerischen Schüssen auf
 * die alte Spalte, davon mit Schüssen ins Leere dort, die Zahl dieser Schüsse und wie oft das Schiff in der neuen Spalte
 * trotzdem getroffen wurde.
 */
const maneuvers = { all: 0, evasions: 0, targeted: 0, dodged: 0, voided: 0, struck: 0 };
/**
 * Flaggschiff-Duell: Runden, in denen beide Seiten nur noch ihr Flaggschiff haben (Tokens nicht gezählt), je Partie mit
 * Duell, dazu Feuerbefehle je Modus, Schüsse, verpuffte Schüsse und Grundmanöver darin.
 */
const duel = { lengths: [] as number[], orders: { ship: 0, column: 0 }, shots: 0, fizzled: 0, maneuvers: 0 };
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

/** Zählt ein Grundmanöver und, wechselt es die Spalte, was die gegnerischen Schüsse daraus machen (`events` der Runde). */
function evasion(event: Extract<RoundEvent, { kind: "maneuver" }>, events: readonly RoundEvent[]): void {
  maneuvers.all += 1;
  const { ship, to } = event;
  if (to.slotIndex === ship.slotIndex) return;
  maneuvers.evasions += 1;
  const aimed = events.some(
    (other) =>
      (other.kind === "fizzle" && other.attacker.side !== ship.side && "column" in other && other.column === ship.slotIndex) ||
      (other.kind === "attack" && other.attacker.side !== ship.side && !other.swarm && !other.taunt && other.target.slotIndex === ship.slotIndex),
  );
  if (aimed) maneuvers.targeted += 1;
  const voided = events.filter(
    (other) => other.kind === "fizzle" && "column" in other && !other.cleared && other.attacker.side !== ship.side && other.column === ship.slotIndex,
  ).length;
  maneuvers.voided += voided;
  if (voided > 0) maneuvers.dodged += 1;
  const struck = events.some(
    (other) => other.kind === "attack" && other.target.side === ship.side && other.target.lane === to.lane && other.target.slotIndex === to.slotIndex,
  );
  if (struck) maneuvers.struck += 1;
}

/**
 * Ordnet die Schüsse einer Runde den Feuerbefehlen zu und zählt Modus und Ausgang (`orders`, `outcomes`). Vor der Auflösung
 * aufgerufen, mit den Zügen beider Seiten; die zurückgegebene Funktion nimmt die Ereignisse der Runde. Die Schiffe werden
 * dafür bis zum Kampf über die Ereignisse verfolgt: Deploy, Manöver, Phasentausch, Verlegung per Befehl, Kurzsprung und
 * was neu aufs Brett kommt.
 */
function trackFire(board: Board, turns: readonly { side: Side; admiral: AdmiralId; plan: TurnPlan }[]): (events: readonly RoundEvent[]) => void {
  const key = ({ side, lane, slotIndex }: SlotRef) => `${side} ${lane} ${slotIndex}`;
  /** Wer wo steht, je Kennung (`Slot.uid`, für neue Schiffe negativ). */
  const at = new Map(board.lanes.flatMap((lane) => lane.occupiedSlots.map((slot) => [key({ side: lane.side, ...slotTarget(slot) }), slot.uid] as const)));
  let fresh = 0;
  const fire = turns.flatMap(({ side, admiral, plan }) =>
    plan.fire.map((order) => {
      const enemy = opposite(side);
      const mode: Mode = "target" in order ? "ship" : "column";
      const front = board.lane(enemy, "strike").slots["target" in order ? order.target.slotIndex : order.column]!;
      const lane =
        "target" in order
          ? order.target.lane
          : front.isOccupied
            ? "strike"
            : board.lane(enemy, "command").slots[order.column]!.isOccupied
              ? "command"
              : "empty";
      orders.all[mode] += 1;
      orders.admiral.get(admiral)![mode] += 1;
      orders.lane[lane][mode] += 1;
      return {
        side,
        mode,
        shooter: { side, ...order.ship },
        target: "target" in order ? { side: enemy, ...order.target } : null,
        shooterId: 0,
        targetId: 0,
      };
    }),
  );
  return (events) => {
    const moved = new Set<number>();
    const jumping = new Map<string, number>();
    let bound = false;
    const move = (from: SlotRef, to: SlotRef) => {
      const id = at.get(key(from))!;
      at.delete(key(from));
      at.set(key(to), id);
      moved.add(id);
    };
    for (const event of events) {
      // Die Feuerbefehle greifen, sobald alle Schiffe stehen.
      if (!bound && event.kind !== "deploy" && event.kind !== "pass") {
        bound = true;
        for (const order of fire) {
          order.shooterId = at.get(key(order.shooter)) ?? 0;
          order.targetId = order.target ? (at.get(key(order.target)) ?? 0) : 0;
        }
      }
      switch (event.kind) {
        case "deploy":
          at.set(key({ side: event.side, ...event.target }), --fresh);
          break;
        case "decoy":
          at.set(key(event.ship), --fresh);
          break;
        case "spawn":
          at.set(key(event.ship), --fresh);
          break;
        case "maneuver":
          move(event.ship, { side: event.side, ...event.to });
          break;
        case "swap": {
          const [a, b] = [at.get(key(event.a))!, at.get(key(event.b))!];
          at.set(key(event.a), b);
          at.set(key(event.b), a);
          moved.add(a).add(b);
          break;
        }
        case "effect":
          if (event.effect.type === "spawn") at.set(key(event.ship), --fresh);
          if (event.effect.type === "move") move(event.ship, { side: event.ship.side, ...event.effect.to });
          if (event.effect.type === "jump") {
            jumping.set(key(event.ship), at.get(key(event.ship))!);
            at.delete(key(event.ship));
          }
          break;
        case "return":
          at.set(key(event.ship), jumping.get(key(event.ship))!);
          break;
        case "destroyed":
          at.delete(key(event.ship));
          break;
        case "attack":
        case "fizzle": {
          const shooter = at.get(key(event.attacker));
          const order = fire.find((candidate) => candidate.side === event.attacker.side && candidate.shooterId === shooter);
          if (!order) {
            outcomes.swarm += 1;
            if (event.kind === "fizzle") outcomes.swarmFizzled += 1;
            break;
          }
          if (order.mode === "column") {
            const column = outcomes.column;
            column.shots += 1;
            if (event.kind === "attack") {
              column[event.taunt ? "taunted" : "hit"] += 1;
              if (event.through) column.through += 1;
            } else column["cleared" in event && event.cleared ? "cleared" : "void"] += 1;
            break;
          }
          const ship = outcomes.ship;
          ship.shots += 1;
          const followed = moved.has(order.targetId);
          if (followed) ship.moved += 1;
          if (event.kind === "attack") {
            ship[event.taunt ? "taunted" : "hit"] += 1;
            if (followed && !event.taunt) ship.movedHit += 1;
          } else if ("target" in event) {
            if (event.covered) {
              ship.covered += 1;
              const front = at.get(key({ ...event.target!, lane: "strike" }))!;
              outcomes.cover[followed ? "retreated" : front < 0 ? "arrived" : moved.has(front) ? "moved" : "held"] += 1;
            } else ship[event.target ? "destroyed" : "gone"] += 1;
          }
          break;
        }
      }
    }
  };
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
  let duelRounds = 0;
  while (match.winner === null && match.round <= ROUND_LIMIT) {
    const dueling = [side(0), side(1)].every(
      (of) => match.board.flagship(of) !== null && match.board.ships(of).every((slot) => isFlagship(slot.card!) || isToken(slot.card!)),
    );
    const turns = match.players.map((player) => {
      const offer = player.draftOffer;
      if (offer) match.draft(player.seat, planBotDraft(match.botView(player.seat), offer));
      if (player.commandHand.length === 0) emptyCommandHand[player.seat]! += 1;
      for (const { id } of player.commandHand) card(id).held += 1;
      let plan = planBotTurn(match.board, match.botView(player.seat), match.round);
      const error = match.submit(player.seat, plan);
      if (error) {
        errors.set(error, (errors.get(error) ?? 0) + 1);
        plan = fallback(match.round);
        match.submit(player.seat, plan);
      }
      return { side: player.side, admiral: admirals[player.seat]!, plan };
    });
    const fired = trackFire(match.board, turns);
    const round = match.round;
    // Wo die Flaggschiffe vor der Runde stehen: Zieht ein Traktorstrahl den Wächter davor weg, liegt eins frei.
    const flagships = [side(0), side(1)]
      .map((of) => match.board.flagship(of))
      .filter((slot) => slot !== null)
      .map((slot) => ({ side: slot.lane.side, ...slotTarget(slot) }));
    const events = match.resolveRound();
    fired(events);
    if (dueling) {
      duelRounds += 1;
      for (const { plan } of turns) for (const order of plan.fire) duel.orders["target" in order ? "ship" : "column"] += 1;
      duel.shots += events.filter((event) => event.kind === "attack" || event.kind === "fizzle").length;
      duel.fizzled += events.filter((event) => event.kind === "fizzle").length;
      duel.maneuvers += events.filter((event) => event.kind === "maneuver" || event.kind === "swap").length;
    }
    const destroyed = events.filter((event) => event.kind === "destroyed").length;
    kills += destroyed;
    if (destroyed === 0) roundsWithoutKill += 1;
    else firstKill ??= round;
    if (round > 1) for (const of of [side(0), side(1)]) usage.get(admiralOf(of))!.rounds += 1;
    for (const event of events) {
      if (event.kind === "attack" || event.kind === "fizzle") shots.all += 1;
      if (event.kind === "fizzle") shots.fizzled += 1;
      if (event.kind === "attack" && event.through) shots.through += 1;
      if (event.kind === "attack" && event.taunt) shots.taunted += 1;
      if (event.kind === "maneuver") evasion(event, events);
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
  if (duelRounds > 0) duel.lengths.push(duelRounds);
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
const pairings = ADMIRAL_IDS.flatMap((row) => ADMIRAL_IDS.filter((column) => column !== row).map((column) => score(row, column)));
console.log(`${GAMES} Partien je Paarung Bot gegen Bot, Sitze abwechselnd, ${games.length} insgesamt`);
console.log("Siegquote der Zeile gegen die Spalte (Unentschieden und Patts halb):");
console.log(`${"".padEnd(20)}${ADMIRAL_IDS.map((id) => id.padStart(11)).join("")}     gesamt`);
for (const row of ADMIRAL_IDS) {
  const others = ADMIRAL_IDS.filter((column) => column !== row);
  const cells = ADMIRAL_IDS.map((column) => (column === row ? "–" : `${(100 * score(row, column)).toFixed(0)} %`).padStart(11));
  const total = others.reduce((sum, column) => sum + score(row, column), 0) / others.length;
  console.log(`${name(row).padEnd(20)}${cells.join("")}   ${(100 * total).toFixed(1).padStart(6)} %`);
}
console.log(`Paarungen: ${(100 * Math.min(...pairings)).toFixed(1)} bis ${(100 * Math.max(...pairings)).toFixed(1)} %`);
console.log(`Runden: Ø ${average(rounds)}, Median ${quantile(0.5)}, p10 ${quantile(0.1)}, p90 ${quantile(0.9)}, max ${sorted.at(-1)}`);
console.log(`Bis Runde 6 entschieden: ${percent(games.filter((game) => game.winner !== null && game.rounds <= 6).length, games.length)}`);
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
const { column, ship } = outcomes;
console.log(
  `Schüsse im Kampf: ${(shots.all / totalRounds).toFixed(2)} je Runde, davon verpufft ${percent(shots.fizzled, shots.all)} ` +
    `(Spalte ins Leere ${percent(column.void, shots.all)}, Spalte nach Abschuss ${percent(column.cleared, shots.all)}, ` +
    `Schiff gedeckt ${percent(ship.covered, shots.all)}, Schiff schon zerstört ${percent(ship.destroyed, shots.all)}, ` +
    `Schiff weg ${percent(ship.gone, shots.all)}, Schwarmangriff ${percent(outcomes.swarmFizzled, shots.all)}), ` +
    `durchgegangen ${percent(shots.through, shots.all)}, von Ablenkung gezogen ${percent(shots.taunted, shots.all)}`,
);
const shipShare = ({ ship, column }: { ship: number; column: number }) => `${percent(ship, ship + column)} von ${ship + column}`;
console.log(
  `Feuerbefehle: ${((orders.all.ship + orders.all.column) / totalRounds).toFixed(2)} je Runde, Schiffsfeuer ${shipShare(orders.all)}; ` +
    `je Admiral ${ADMIRAL_IDS.map((id) => `${id} ${shipShare(orders.admiral.get(id)!)}`).join(", ")}`,
);
console.log(
  `  Schiffsfeuer je Lane des Ziels beim Planen (Spaltenfeuer: vorderstes Schiff der Spalte): Strike ${shipShare(orders.lane.strike)}, ` +
    `Command ${shipShare(orders.lane.command)}; auf eine leere Spalte ${orders.lane.empty.column}`,
);
console.log(
  `  Spaltenfeuer: ${column.shots} Schüsse, Treffer ${percent(column.hit, column.shots)} (durchgegangen ${percent(column.through, column.shots)}), ` +
    `von Ablenkung gezogen ${percent(column.taunted, column.shots)}, ins Leere ${percent(column.void, column.shots)}, nach Abschuss ${percent(column.cleared, column.shots)}`,
);
console.log(
  `  Schiffsfeuer: ${ship.shots} Schüsse, Treffer ${percent(ship.hit, ship.shots)}, von Ablenkung gezogen ${percent(ship.taunted, ship.shots)}, ` +
    `gedeckt ${percent(ship.covered, ship.shots)} (Deckung stand schon und hielt ${percent(outcomes.cover.held, ship.covered)}, ` +
    `Ziel zog in Deckung ${percent(outcomes.cover.retreated, ship.covered)}, neues Schiff davor ${percent(outcomes.cover.arrived, ship.covered)}, ` +
    `Schiff zog davor ${percent(outcomes.cover.moved, ship.covered)}), ` +
    `schon zerstört ${percent(ship.destroyed, ship.shots)}, weg ${percent(ship.gone, ship.shots)}`,
);
console.log(
  `  Schiffsfeuer auf ein Ziel, das vor dem Kampf den Slot wechselte: ${ship.moved}, davon getroffen ${percent(ship.movedHit, ship.moved)}; ` +
    `Schwarmangriff ohne Feuerbefehl: ${outcomes.swarm} Schüsse`,
);
const duelRounds = duel.lengths.reduce((sum, value) => sum + value, 0);
console.log(
  `Flaggschiff-Duell (beide nur noch mit Flaggschiff): in ${percent(duel.lengths.length, games.length)} der Partien, ` +
    `Ø ${average(duel.lengths)} Runden, max ${Math.max(0, ...duel.lengths)}; darin Schiffsfeuer ${shipShare(duel.orders)} Befehlen, ` +
    `verpufft ${percent(duel.fizzled, duel.shots)} der Schüsse, Grundmanöver ${(duel.maneuvers / Math.max(1, duelRounds)).toFixed(2)} je Runde`,
);
console.log(
  `Grundmanöver: ${(maneuvers.all / totalRounds).toFixed(2)} je Runde (${percent(maneuvers.all, 2 * totalRounds)} der Züge), ` +
    `davon in eine andere Spalte ${percent(maneuvers.evasions, maneuvers.all)}; ` +
    `auf deren alte Spalte schoss der Gegner bei ${percent(maneuvers.targeted, maneuvers.evasions)}, ` +
    `${percent(maneuvers.dodged, maneuvers.evasions)} ließen Schüsse ins Leere laufen ` +
    `(${(maneuvers.voided / Math.max(1, maneuvers.dodged)).toFixed(2)} je Ausweichen), ` +
    `${percent(maneuvers.struck, maneuvers.evasions)} wurden in der neuen Spalte trotzdem getroffen`,
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
