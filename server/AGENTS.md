# Server (Bun)

- `bun install`, dann `bun run dev` (startet neu bei Änderungen) oder `bun run start`; Port über `PORT` (Standard 3000), `bun run typecheck`, `bun test`.
- Ein Prozess für alles: `Bun.serve` liefert `../client/index.html` aus (Bun bündelt den Client, im Dev-Modus mit HMR) und nimmt unter `/ws?match=<id>&token=<token>` die WebSockets an.

## Aufbau

- `src/main.ts` — HTTP/WebSocket, Räume (Match + Sockets der beiden Sitze), Nachrichtenversand.
- `src/match.ts` — autoritatives Match: Sitzplätze per Token (oder `addBot` für den Computergegner), Zugprüfung, Aufdecken und Deploy, Sieg-Check, Nachziehen, Sicht pro Spieler. Seat 0 ist intern die „player“-Seite des Bretts, für Seat 1 werden Brett und Ereignisse gespiegelt.
- `src/bot.ts` — der Computergegner: plant aus Brett und eigener Hand einen Zug nach Faustregeln (immer ein Schiff legen, Kampfschiffe zuerst, robuste nach vorne, Jäger und Support in die Command-Lane; den Befehl mit dem größten geschätzten Nutzen). Er sieht den Plan des Gegners nicht und zieht, sobald der Mensch abgibt.
- `src/resolution.ts` — die Phasen nach dem Deploy (portiert aus `game_mechanics.gd`): Effects (Befehle, nach Typ statt nach Seat geordnet, damit keiner im Vorteil ist), Combat (Auto-Targeting je Schiffsklasse, Schaden gleichzeitig, Schüsse abwechselnd je Seite gemeldet), Cleanup (Eigenschaden, Zerstörte entfernen, Rundenmodifikatoren zurücksetzen).
- `src/deck.ts` — gemischte Nachziehstapel.
- Gemeinsamer Code mit dem Client liegt in `../shared/`.
- Der Server verschickt keine Texte für Spieler: Karten gehen als Id, Fehler als `ErrorCode` (`shared/protocol.ts`); formuliert wird im Client (`client/src/i18n/`).

## Status

Matches leben nur im Speicher (Neustart = alle Matches weg). Wer den Link als Erster bzw. Zweiter öffnet, bekommt Sitz 0 bzw. 1; das Token im `sessionStorage` des Tabs bringt ihn nach einem Neuladen auf seinen Sitz zurück. Statt auf einen zweiten Menschen zu warten, kann der erste Spieler mit `addBot` den Computergegner auf den freien Platz setzen; danach ist das Match voll. Die Runde wird vollständig aufgelöst (Deploy → Effects → Combat → Cleanup); verloren hat, wer am Rundenende kein Schiff mit ATK > 0 auf dem Feld hat, auch in Runde 1 (beide gleichzeitig: Unentschieden). Die Starthand hat immer 1 Support- und 2 Kampfschiffe, danach wird zufällig nachgezogen. Noch ohne Wirkung: Sensor Sweep und alle Schiffs-Fähigkeiten (On Deploy, Repair Drone, Scrap Raider); Schilde regenerieren nicht.
