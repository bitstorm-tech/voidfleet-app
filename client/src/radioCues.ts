// Welche Funksprüche des Bordfunks (`audio/radio.ts`) zu den Schritten einer Rundenwiedergabe gehören: beim
// Aufdecken eines Befehls oder einer Fähigkeit die Ankündigung, nach dem Schritt die Reaktion auf seinen Ausgang.
// Gesprochen wird aus Sicht der eigenen Flotte: eigene Befehle bestätigt der Funk, gegnerische Angriffe meldet er.
// Drohnen sind keinen Funkspruch wert, wenn sie fallen.

import { isToken, shipById, type CommandId } from "../../shared/cards.ts";
import type { AbilityEffect, RoundEvent } from "../../shared/protocol.ts";
import type { RadioCue } from "./data/radio.ts";

/** Ab diesem Anteil seiner HP gilt ein eigenes Schiff nach dem Kampf als schwer getroffen. */
const CRITICAL_HULL = 0.3;

const ANNOUNCEMENTS: Partial<Record<CommandId, { player?: RadioCue; enemy?: RadioCue }>> = {
  torpedo: { player: "torpedo_away", enemy: "torpedo_incoming" },
  orbital_strike: { player: "orbital_strike", enemy: "orbital_incoming" },
  volley_fire: { player: "volley", enemy: "volley_incoming" },
  targeting_jammer: { player: "jammer", enemy: "jammed" },
  emergency_shields: { player: "shields_up" },
  overcharge: { player: "overcharge" },
  power_surge: { player: "power_surge" },
  scavenge: { player: "scavenge" },
  intercept: { player: "intercept" },
  recall: { player: "recall" },
  flanking_maneuver: { player: "flanking" },
};

/** Eigene Fähigkeiten: Die Plasma Frigate feuert, die Repair Drone repariert, der Scrap Raider plündert, die Bastion hebt den Wächterschild. */
const ABILITIES: Record<AbilityEffect["type"], RadioCue> = { damage: "frigate_fire", heal: "repair", attack: "scrap", shield: "shields_up" };

/** Der Spruch, mit dem ein Schritt beginnt; ein Befehl ohne Wirkung wird nicht angekündigt. */
export function announcement(step: readonly RoundEvent[]): RadioCue | null {
  const first = step[0]!;
  switch (first.kind) {
    case "effect":
    case "draw":
    case "miss":
      return ANNOUNCEMENTS[first.cardId]?.[first.side] ?? null;
    // Titan Carrier beim Deploy, Hive am Rundenende.
    case "spawn":
      return first.source.side === "player" ? "drone_launch" : null;
    case "ability":
      return first.source.side === "player" ? ABILITIES[first.effect.type] : null;
    default:
      return null;
  }
}

/** Die Sprüche nach einem Schritt: wie Torpedo, Sperrfeuer und EMP ausgingen, Verluste und schwer getroffene eigene Schiffe. */
export function reactions(step: readonly RoundEvent[]): RadioCue[] {
  const first = step[0]!;
  switch (first.kind) {
    case "effect":
    case "noEffect":
    case "miss": {
      const own = first.side === "player";
      if (first.cardId === "torpedo") {
        if (first.kind === "miss") return [own ? "torpedo_missed" : "torpedo_dodged"];
        return own ? ["torpedo_hit"] : [];
      }
      if (first.cardId === "barrage") {
        if (own) return [first.kind === "effect" ? "barrage_hit" : "barrage_missed"];
        return first.kind === "effect" ? ["barrage_caught"] : [];
      }
      if (first.cardId === "emp_blast" && first.kind === "effect") return [own ? "emp_hit" : "emp_incoming"];
      return [];
    }
    case "destroyed": {
      const ships = step.flatMap((event) => (event.kind === "destroyed" && !isToken(shipById(event.ship.cardId)) ? [event.ship] : []));
      const cues: RadioCue[] = [];
      if (ships.some((ship) => ship.side === "player")) cues.push("ship_lost");
      if (ships.some((ship) => ship.side === "enemy")) cues.push("enemy_destroyed");
      return cues;
    }
    case "attack": {
      // Je getroffenem eigenem Schiff zählt der letzte Treffer: Es übersteht den Kampf knapp.
      const hulls = new Map<string, number>();
      for (const event of step) {
        if (event.kind === "attack" && event.target.side === "player") {
          hulls.set(`${event.target.lane}-${event.target.slotIndex}`, event.after.hp / shipById(event.target.cardId).hp);
        }
      }
      return [...hulls.values()].some((hull) => hull > 0 && hull <= CRITICAL_HULL) ? ["hull_critical"] : [];
    }
    default:
      return [];
  }
}
