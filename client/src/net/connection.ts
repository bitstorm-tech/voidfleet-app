// WebSocket-Verbindung zum Spielserver. Das Match steht in der URL
// (`?match=<id>`); fehlt es oder wird ein neues verlangt, wird ein neues angelegt. Das Token identifiziert
// den Spieler beim Neuladen und liegt pro Tab im sessionStorage, damit zwei
// Tabs im selben Browser als zwei Spieler zählen.

import type { ClientMessage, ServerMessage } from "../../../shared/protocol.ts";

/** Zufalls-Id ohne `crypto.randomUUID`, das es außerhalb von HTTPS/localhost nicht gibt. */
function randomId(bytes: number): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(bytes)), (b) => b.toString(16).padStart(2, "0")).join("");
}

function matchIdFromUrl(newMatch: boolean): string {
  const url = new URL(location.href);
  let matchId = newMatch ? null : url.searchParams.get("match");
  if (!matchId) {
    matchId = randomId(4);
    url.searchParams.set("match", matchId);
    history.replaceState(null, "", url);
  }
  return matchId;
}

function tokenFor(matchId: string): string {
  const key = `voidfleet-token-${matchId}`;
  const token = sessionStorage.getItem(key) ?? randomId(16);
  sessionStorage.setItem(key, token);
  return token;
}

export interface ConnectionCallbacks {
  onMessage: (message: ServerMessage) => void;
  onClose: () => void;
}

export class ServerConnection {
  readonly matchId: string;
  private readonly socket: WebSocket;
  private readonly listeners = new AbortController();

  constructor(callbacks: ConnectionCallbacks, newMatch = false) {
    this.matchId = matchIdFromUrl(newMatch);
    const protocol = location.protocol === "https:" ? "wss:" : "ws:";
    const params = new URLSearchParams({ match: this.matchId, token: tokenFor(this.matchId) });
    this.socket = new WebSocket(`${protocol}//${location.host}/ws?${params}`);
    const { signal } = this.listeners;
    this.socket.addEventListener("message", (event) => callbacks.onMessage(JSON.parse(event.data) as ServerMessage), { signal });
    this.socket.addEventListener("close", () => callbacks.onClose(), { signal });
  }

  /** Trennt die Verbindung, ohne dass noch Nachrichten oder `onClose` ankommen. */
  close(): void {
    this.listeners.abort();
    this.socket.close();
  }

  send(message: ClientMessage): void {
    this.socket.send(JSON.stringify(message));
  }
}
