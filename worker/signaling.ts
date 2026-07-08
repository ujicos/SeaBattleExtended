interface Env {
  ROOMS: DurableObjectNamespace;
  LOBBIES: DurableObjectNamespace;
}

interface JoinMessage {
  type: "join-room";
  roomCode: string;
  role: "host" | "guest";
  identity?: unknown;
}

interface ClientInfo {
  roomCode: string;
  role: "host" | "guest";
  identity?: unknown;
}

interface LobbyRecord {
  roomCode: string;
  updatedAt: number;
}

interface PresenceRecord {
  sessionId: string;
  updatedAt: number;
}

function json(data: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: {
      "content-type": "application/json",
      "access-control-allow-origin": "*",
      ...init?.headers
    }
  });
}

function serviceInfo(request: Request): Response {
  const url = new URL(request.url);
  return json({
    ok: true,
    service: "sea-battle-signaling",
    websocket: `${url.protocol === "https:" ? "wss" : "ws"}://${url.host}/?room=ROOMCODE&role=host`,
    note: "This endpoint is healthy. Open it as a WebSocket from the game, not as a normal browser page."
  });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const roomCode = url.searchParams.get("room")?.trim().toUpperCase();

    if (request.method === "OPTIONS") {
      return new Response(null, {
        headers: {
          "access-control-allow-origin": "*",
          "access-control-allow-methods": "GET, POST, DELETE, OPTIONS",
          "access-control-allow-headers": "content-type"
        }
      });
    }

    if (url.pathname === "/health") {
      return serviceInfo(request);
    }

    if (url.pathname === "/lobbies" || url.pathname === "/presence" || url.pathname === "/status") {
      const registry = env.LOBBIES.get(env.LOBBIES.idFromName("global"));
      return registry.fetch(request);
    }

    if (request.headers.get("upgrade") !== "websocket") {
      return serviceInfo(request);
    }

    if (!roomCode) {
      return json({ ok: false, error: "Missing ?room=CODE" }, { status: 400 });
    }

    if (url.searchParams.get("role") !== "guest") {
      const registry = env.LOBBIES.get(env.LOBBIES.idFromName("global"));
      await registry.fetch("https://registry/lobbies", {
        method: "POST",
        body: JSON.stringify({ roomCode })
      });
    } else {
      const registry = env.LOBBIES.get(env.LOBBIES.idFromName("global"));
      await registry.fetch(`https://registry/lobbies?room=${encodeURIComponent(roomCode)}`, {
        method: "DELETE"
      });
    }

    const roomId = env.ROOMS.idFromName(roomCode);
    const room = env.ROOMS.get(roomId);
    return room.fetch(request);
  }
};

export class LobbyRegistry {
  private readonly ttlMs = 12 * 60 * 1000;
  private readonly presenceTtlMs = 75 * 1000;

  constructor(private readonly state: DurableObjectState) {
    void this.state.blockConcurrencyWhile(async () => {
      const stored = await this.state.storage.get<LobbyRecord[]>("lobbies");
      if (!stored) {
        await this.state.storage.put("lobbies", []);
      }
      const presence = await this.state.storage.get<PresenceRecord[]>("presence");
      if (!presence) {
        await this.state.storage.put("presence", []);
      }
    });
  }

  async fetch(request: Request): Promise<Response> {
    if (request.method === "OPTIONS") {
      return new Response(null, {
        headers: {
          "access-control-allow-origin": "*",
          "access-control-allow-methods": "GET, POST, DELETE, OPTIONS",
          "access-control-allow-headers": "content-type"
        }
      });
    }

    const url = new URL(request.url);

    if (url.pathname === "/presence") {
      if (request.method === "DELETE") {
        const sessionId = url.searchParams.get("session")?.trim();
        if (sessionId) {
          await this.removePresence(sessionId);
        }
        return json({ ok: true });
      }

      if (request.method !== "POST") {
        const presence = await this.prunedPresence();
        await this.state.storage.put("presence", presence);
        return json({ ok: true, onlinePlayers: presence.length });
      }

      const body = (await request.json()) as { sessionId?: string };
      const sessionId = body.sessionId?.trim();
      if (!sessionId) {
        return json({ ok: false, error: "Missing sessionId" }, { status: 400 });
      }
      const presence = await this.prunedPresence();
      const next = [{ sessionId, updatedAt: Date.now() }, ...presence.filter((record) => record.sessionId !== sessionId)];
      const lobbies = await this.prunedLobbies();
      await this.state.storage.put("presence", next.slice(0, 500));
      await this.state.storage.put("lobbies", lobbies);
      return json({ ok: true, onlinePlayers: next.length, activeGames: lobbies.length, lobbies });
    }

    if (url.pathname === "/status") {
      const lobbies = await this.prunedLobbies();
      const presence = await this.prunedPresence();
      await this.state.storage.put("lobbies", lobbies);
      await this.state.storage.put("presence", presence);
      return json({ ok: true, onlinePlayers: presence.length, activeGames: lobbies.length, lobbies });
    }

    if (request.method === "POST") {
      const body = (await request.json()) as { roomCode?: string };
      const roomCode = body.roomCode?.trim().toUpperCase();
      if (!roomCode) {
        return json({ ok: false, error: "Missing roomCode" }, { status: 400 });
      }
      const lobbies = await this.prunedLobbies();
      const next = [{ roomCode, updatedAt: Date.now() }, ...lobbies.filter((lobby) => lobby.roomCode !== roomCode)].slice(0, 30);
      await this.state.storage.put("lobbies", next);
      return json({ ok: true });
    }

    if (request.method === "DELETE") {
      const roomCode = url.searchParams.get("room")?.trim().toUpperCase();
      if (roomCode) {
        await this.removeLobby(roomCode);
      }
      return json({ ok: true });
    }

    const lobbies = await this.prunedLobbies();
    await this.state.storage.put("lobbies", lobbies);
    return json({ ok: true, lobbies });
  }

  private async prunedLobbies(): Promise<LobbyRecord[]> {
    const now = Date.now();
    const lobbies = (await this.state.storage.get<LobbyRecord[]>("lobbies")) ?? [];
    return lobbies.filter((lobby) => now - lobby.updatedAt < this.ttlMs);
  }

  private async prunedPresence(): Promise<PresenceRecord[]> {
    const now = Date.now();
    const presence = (await this.state.storage.get<PresenceRecord[]>("presence")) ?? [];
    return presence.filter((record) => now - record.updatedAt < this.presenceTtlMs);
  }

  private async removePresence(sessionId: string): Promise<void> {
    const presence = await this.prunedPresence();
    await this.state.storage.put("presence", presence.filter((record) => record.sessionId !== sessionId));
  }

  private async removeLobby(roomCode: string): Promise<void> {
    const lobbies = await this.prunedLobbies();
    await this.state.storage.put("lobbies", lobbies.filter((lobby) => lobby.roomCode !== roomCode));
  }
}

export class SignalingRoom {
  private readonly sessions = new Map<WebSocket, ClientInfo>();
  private readonly recentSignals: unknown[] = [];

  constructor(private readonly state: DurableObjectState) {
    void this.state;
  }

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get("upgrade") !== "websocket") {
      return json({ ok: false, error: "Expected WebSocket upgrade" }, { status: 426 });
    }

    const url = new URL(request.url);
    const roomCode = url.searchParams.get("room")?.trim().toUpperCase();
    const role = url.searchParams.get("role") === "guest" ? "guest" : "host";

    if (!roomCode) {
      return json({ ok: false, error: "Missing room" }, { status: 400 });
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    server.accept();

    const info: ClientInfo = { roomCode, role };
    this.sessions.set(server, info);

    server.addEventListener("message", (event) => this.handleMessage(server, event.data));
    server.addEventListener("close", () => this.close(server));
    server.addEventListener("error", () => this.close(server));

    return new Response(null, { status: 101, webSocket: client });
  }

  private handleMessage(sender: WebSocket, raw: string | ArrayBuffer): void {
    const message = JSON.parse(typeof raw === "string" ? raw : new TextDecoder().decode(raw));
    const info = this.sessions.get(sender);

    if (!info) {
      return;
    }

    if (message.type === "join-room") {
      const join = message as JoinMessage;
      this.sessions.set(sender, {
        roomCode: join.roomCode.toUpperCase(),
        role: join.role,
        identity: join.identity
      });

      for (const signal of this.recentSignals) {
        sender.send(JSON.stringify(signal));
      }

      this.broadcastIdentified(sender, { type: "peer-joined", identity: join.identity });
      for (const [, peerInfo] of this.sessions) {
        if (peerInfo.identity && peerInfo.identity !== join.identity) {
          sender.send(JSON.stringify({ type: "peer-joined", identity: peerInfo.identity }));
        }
      }
      return;
    }

    if (message.type === "offer" || message.type === "answer" || message.type === "ice") {
      this.recentSignals.push(message);
      while (this.recentSignals.length > 60) {
        this.recentSignals.shift();
      }
    }

    this.broadcast(sender, message);
  }

  private broadcast(sender: WebSocket, message: unknown): void {
    const rendered = JSON.stringify(message);
    for (const [socket] of this.sessions) {
      if (socket !== sender && socket.readyState === WebSocket.OPEN) {
        socket.send(rendered);
      }
    }
  }

  private broadcastIdentified(sender: WebSocket, message: unknown): void {
    const rendered = JSON.stringify(message);
    for (const [socket, info] of this.sessions) {
      if (socket !== sender && info.identity && socket.readyState === WebSocket.OPEN) {
        socket.send(rendered);
      }
    }
  }

  private close(socket: WebSocket): void {
    this.sessions.delete(socket);
  }
}
