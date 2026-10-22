# Client (TypeScript + Babylon.js, Bun)

- `bun install`, dann `bun run dev` (Bun-Dev-Server mit HMR auf `index.html`, Port über `BUN_PORT`), `bun run build` (Bundle nach `dist/`), `bun run typecheck`.
- Kein Vite, kein Node: `index.html` ist der Entry, Bun bündelt `src/main.ts` und die CSS-Datei. Assets (`assets/`) werden per `import` eingebunden und vom file-Loader als URL geliefert (Typen in `src/assets.d.ts`).

## Aufbau

- `src/data/cards.ts` — Kartendefinitionen (aus den Godot-`.tres`-Dateien portiert) plus Farb-Helfer.
- `src/game/` — reiner Spielzustand ohne Rendering: `board.ts` (Lanes, Slots, Platzierungsregeln), `deck.ts`, `match.ts` (Hände, Zugplan, lokale Deploy-Phase).
- `src/scene/` — Babylon-Szene: `matchScene.ts` (Kamera-Rig mit Maus-Parallaxe, Lichter, Glow, Lanes), `slotPad.ts`, `laneLabel.ts`, `ship.ts` (glTF-Modell oder Kitbash-Fallback), `background.ts`.
- `src/ui/` — DOM-Overlay über dem Canvas: `hud.ts` (Runde, Status, Log, Submit), `hand.ts` (Schiffs- und Befehlskarten).
- `src/matchController.ts` — verbindet Zustand, Szene und UI; die Szene spiegelt den Zustand nur.

## Koordinaten

Babylon ist linkshändig, Godot rechtshändig. Z-Werte aus der Godot-Szene (`match_screen.tscn`) sind hier negiert; x und y bleiben. Slot 0 liegt am hinteren Ende der Lane (weit von der Kamera). Schiffe zeigen mit der Nase nach lokal +Z und werden über den Pad-Anker zum Gegner gedreht.

## Status

Nur die Match-Szene ist portiert. Die Rundenauflösung (Gegner-KI, Befehle, Kampf, Cleanup) fehlt bewusst; sie gehört zum Server. `Runde ausführen` führt lokal nur Deploy und Nachziehen aus.
