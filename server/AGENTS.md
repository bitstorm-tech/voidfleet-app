# Server (Bun)

- `bun install`, dann `bun run dev` (startet neu bei Änderungen) oder `bun run start`; Port über `PORT` (Standard 3000), `bun run typecheck`.
- Ein Prozess für alles: `Bun.serve` liefert `../client/index.html` aus (Bun bündelt den Client, im Dev-Modus mit HMR) und nimmt unter `/ws?match=<id>&token=<token>` die WebSockets an.

## Aufbau

- `src/main.ts` — HTTP/WebSocket, Räume (Match + Sockets der beiden Sitze), Nachrichtenversand.
- `src/match.ts` — autoritatives Match: Sitzplätze per Token, Zugprüfung, Auflösung, Sicht pro Spieler. Seat 0 ist intern die „player“-Seite des Bretts, für Seat 1 werden Brett und Ereignisse gespiegelt.
- `src/deck.ts` — gemischte Nachziehstapel.
- Gemeinsamer Code mit dem Client liegt in `../shared/`.

## Status

Matches leben nur im Speicher (Neustart = alle Matches weg). Wer den Link als Erster bzw. Zweiter öffnet, bekommt Sitz 0 bzw. 1; das Token im `sessionStorage` des Tabs bringt ihn nach einem Neuladen auf seinen Sitz zurück. Die Auflösung macht nur Deploy und Nachziehen; Befehle werden verbraucht, aber noch ohne Wirkung, Combat und Cleanup fehlen (Vorlage: `game_mechanics.gd` im Godot-Repo).
