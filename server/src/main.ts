// Spielserver: liefert den Client aus (Bun bündelt index.html samt HMR) und
// verbindet die Spieler über WebSockets. Matches leben nur im Speicher und
// entstehen beim ersten Beitritt; wer den Match-Link öffnet, sitzt mit drin.

import type { ServerWebSocket } from "bun";
import index from "../../client/index.html";
import type { ClientMessage, ServerMessage, TurnPlan } from "../../shared/protocol.ts";
import { Match, type Seat } from "./match.ts";

interface SocketData {
  matchId: string;
  token: string;
  seat: Seat | null;
}

type Socket = ServerWebSocket<SocketData>;

interface Room {
  match: Match;
  sockets: [Socket | null, Socket | null];
}

const rooms = new Map<string, Room>();

function roomFor(matchId: string): Room {
  let room = rooms.get(matchId);
  if (!room) {
    room = { match: new Match(matchId), sockets: [null, null] };
    rooms.set(matchId, room);
  }
  return room;
}

function send(socket: Socket | null, message: ServerMessage): void {
  socket?.send(JSON.stringify(message));
}

function broadcastState(room: Room): void {
  for (const player of room.match.players) {
    send(room.sockets[player.seat], { type: "state", view: room.match.view(player.seat) });
  }
}

function onSubmit(socket: Socket, room: Room, seat: Seat, plan: TurnPlan): void {
  const error = room.match.submit(seat, plan);
  if (error) {
    send(socket, { type: "error", code: error });
    return;
  }
  if (room.match.isRoundComplete) {
    const round = room.match.round;
    const events = room.match.resolveRound();
    for (const player of room.match.players) {
      send(room.sockets[player.seat], { type: "round", round, events: room.match.eventsFor(player.seat, events) });
    }
  }
  broadcastState(room);
}

function onSurrender(socket: Socket, room: Room, seat: Seat): void {
  const error = room.match.surrender(seat);
  if (error) {
    send(socket, { type: "error", code: error });
    return;
  }
  broadcastState(room);
}

function onAddBot(socket: Socket, room: Room): void {
  if (room.match.addBot() === null) {
    send(socket, { type: "error", code: "match_full" });
    return;
  }
  broadcastState(room);
}

// Die Icons im Manifest der installierbaren App brauchen feste Pfade; Bun schreibt nur die Links
// in index.html auf seine gebündelten Dateien um, nicht die Pfade im Manifest.
const APP_ICONS = ["icon-192.png", "icon-512.png", "icon-maskable-192.png", "icon-maskable-512.png"];
const appIconRoutes = Object.fromEntries(
  APP_ICONS.map((file) => [`/app/${file}`, Bun.file(`${import.meta.dir}/../../client/assets/app/${file}`)]),
);

const server = Bun.serve({
  port: Number(process.env.PORT ?? 3000),
  development: process.env.NODE_ENV !== "production",
  routes: {
    "/": index,
    ...appIconRoutes,
    "/ws": (req, server) => {
      const params = new URL(req.url).searchParams;
      const matchId = params.get("match");
      const token = params.get("token");
      if (!matchId || !token) return new Response("match und token fehlen", { status: 400 });
      if (server.upgrade(req, { data: { matchId, token, seat: null } })) return undefined;
      return new Response("WebSocket erwartet", { status: 400 });
    },
  },
  websocket: {
    data: {} as SocketData,
    open(socket) {
      const room = roomFor(socket.data.matchId);
      const seat = room.match.join(socket.data.token);
      if (seat === null) {
        send(socket, { type: "error", code: "match_full" });
        socket.close();
        return;
      }
      socket.data.seat = seat;
      // Ein zweiter Tab mit demselben Token übernimmt den Platz.
      room.sockets[seat]?.close();
      room.sockets[seat] = socket;
      broadcastState(room);
    },
    message(socket, raw) {
      const seat = socket.data.seat;
      if (seat === null) return;
      const message = JSON.parse(String(raw)) as ClientMessage;
      const room = roomFor(socket.data.matchId);
      if (message.type === "submit") onSubmit(socket, room, seat, message.plan);
      else if (message.type === "surrender") onSurrender(socket, room, seat);
      else onAddBot(socket, room);
    },
    close(socket) {
      const room = rooms.get(socket.data.matchId);
      if (room && socket.data.seat !== null && room.sockets[socket.data.seat] === socket) {
        room.sockets[socket.data.seat] = null;
      }
    },
  },
});

console.log(`Voidfleet-Server läuft auf ${server.url}`);
