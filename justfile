# Voidfleet — gängige Befehle. `just` zeigt die Liste.

[private]
default:
    @just --list

# Abhängigkeiten in allen Paketen installieren
install:
    bun install
    cd client && bun install
    cd server && bun install
    cd desktop && bun install

# Spiel im Browser starten: Server mit Neustart bei Änderungen (liefert den Client aus, Port per PORT, Standard 3000)
dev:
    cd server && bun run dev

# Server im Produktionsmodus starten
start:
    cd server && bun run start

# Desktop-App bauen und starten
desktop:
    cd desktop && bun run start

# Desktop-Paket für das aktuelle System nach desktop/release/ bauen
dist:
    cd desktop && bun run dist

# Client-Bundle nach client/dist/ bauen
build:
    cd client && bun run build

# Tests des Servers
test *args:
    cd server && bun test {{ args }}

# Typecheck in client, server und desktop
typecheck:
    cd client && bun run typecheck
    cd server && bun run typecheck
    cd desktop && bun run typecheck

# Lint, Formatierung und Import-Reihenfolge prüfen
lint:
    bun run lint

# Automatisch behebbare Befunde beheben
fix:
    bun run fix

# Alles prüfen: Lint, Typecheck, Tests
check: lint typecheck test

# Balance-Simulation Bot gegen Bot (Partien je Paarung, Standard 2000)
simulate games="2000":
    cd server && bun tools/simulate.ts {{ games }}
