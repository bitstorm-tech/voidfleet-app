# Client (TypeScript + Babylon.js, Bun)

- `bun install`, dann `bun run build` (Bundle nach `dist/`), `bun run typecheck`. Zum Spielen liefert der Server den Client aus (`cd ../server && bun run dev`), weil der Client ohne WebSocket-Verbindung nichts tut.
- Kein Vite, kein Node: `index.html` ist der Entry, Bun bündelt `src/main.ts` und die CSS-Datei. Assets (`assets/`) werden per `import` eingebunden und vom file-Loader als URL geliefert (Typen in `src/assets.d.ts`).

## Aufbau

- `../shared/` — mit dem Server geteilt: `cards.ts` (Kartendefinitionen), `board.ts` (Lanes, Slots, Platzierungsregeln, Snapshot), `protocol.ts` (Nachrichten).
- `src/data/cardColors.ts` — Kartenfarben und Farb-Helfer.
- `src/game/match.ts` — Spielzustand aus Server-Sicht (Brett, Hände, Zugplan) ohne Rendering.
- `src/net/connection.ts` — WebSocket zum Server; Match-Id aus `?match=`, Spieler-Token pro Tab im `sessionStorage`.
- `src/scene/` — Babylon-Szene: `matchScene.ts` (Kamera-Rig mit Maus-Parallaxe, Lichter, Glow, Lanes), `slotPad.ts`, `laneLabel.ts`, `ship.ts` (glTF-Modell oder Kitbash-Fallback), `background.ts`.
- `src/ui/` — DOM-Overlay über dem Canvas: `hud.ts` (Runde, Status, Log, Submit), `hand.ts` (Schiffs- und Befehlskarten), `roundLog.ts` (Rundenereignisse als Log-Text), `cursor.ts` (Maus-Cursor aus SVG, pro Pixeldichte gerastert).
- `src/matchController.ts` — verbindet Server, Zustand, Szene und UI; die Szene spiegelt den Zustand nur.

## Koordinaten

Babylon ist linkshändig, Godot rechtshändig. Z-Werte aus der Godot-Szene (`match_screen.tscn`) sind hier negiert; x und y bleiben. Slot 0 liegt am hinteren Ende der Lane (weit von der Kamera). Schiffe zeigen mit der Nase nach lokal +Z und werden über den Pad-Anker zum Gegner gedreht.

## Status

Nur die Match-Szene ist portiert. Der Client plant den Zug und schickt ihn mit „Zug abgeben“ an den Server; aufgelöst wird dort. „player“ ist immer die eigene Seite, der Server spiegelt für den zweiten Spieler.
