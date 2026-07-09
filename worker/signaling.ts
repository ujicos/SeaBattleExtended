interface Env {
  ROOMS: DurableObjectNamespace;
  LOBBIES: DurableObjectNamespace;
  ADMIN_TOKEN?: string;
  DB_Leaderboard?: D1Database;
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
  status?: "open" | "full";
}

interface PresenceRecord {
  sessionId: string;
  updatedAt: number;
}

interface LeaderboardPlayer {
  playerId: string;
  displayName: string;
  lifetimeXp: number;
  xp: number;
  prestige: number;
  rank: number;
  wins: number;
  losses: number;
  games: number;
  shipsDestroyed: number;
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

function unauthorized(): Response {
  return json({ ok: false, error: "Admin token required" }, { status: 401 });
}

function hasAdminAccess(request: Request, env: Env): boolean {
  const token = env.ADMIN_TOKEN;
  if (!token) {
    return false;
  }
  return request.headers.get("authorization") === `Bearer ${token}`;
}

async function ensureLeaderboard(env: Env): Promise<boolean> {
  if (!env.DB_Leaderboard) {
    return false;
  }
  await env.DB_Leaderboard.prepare(`
    CREATE TABLE IF NOT EXISTS leaderboard_players (
      player_id TEXT PRIMARY KEY,
      display_name TEXT NOT NULL,
      lifetime_xp INTEGER NOT NULL DEFAULT 0,
      xp INTEGER NOT NULL DEFAULT 0,
      prestige INTEGER NOT NULL DEFAULT 0,
      rank INTEGER NOT NULL DEFAULT 1,
      wins INTEGER NOT NULL DEFAULT 0,
      losses INTEGER NOT NULL DEFAULT 0,
      games INTEGER NOT NULL DEFAULT 0,
      ships_destroyed INTEGER NOT NULL DEFAULT 0,
      updated_at INTEGER NOT NULL
    )
  `).run();
  await env.DB_Leaderboard.prepare(`
    CREATE INDEX IF NOT EXISTS idx_leaderboard_rank
    ON leaderboard_players(prestige DESC, lifetime_xp DESC, wins DESC)
  `).run();
  return true;
}

async function leaderboardStatus(env: Env): Promise<{ available: boolean; players: number }> {
  const available = await ensureLeaderboard(env);
  if (!available || !env.DB_Leaderboard) {
    return { available: false, players: 0 };
  }
  const row = await env.DB_Leaderboard.prepare("SELECT COUNT(*) AS count FROM leaderboard_players").first<{ count: number }>();
  return { available: true, players: row?.count ?? 0 };
}

function numberFrom(value: unknown, fallback = 0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.round(parsed)) : fallback;
}

function sanitizePlayer(body: Record<string, unknown>): LeaderboardPlayer | null {
  const playerId = String(body.playerId ?? "").trim().slice(0, 80);
  const displayName = String(body.displayName ?? "").trim().slice(0, 32);
  if (!playerId || !displayName) {
    return null;
  }
  return {
    playerId,
    displayName,
    lifetimeXp: numberFrom(body.lifetimeXp),
    xp: numberFrom(body.xp),
    prestige: numberFrom(body.prestige),
    rank: Math.max(1, numberFrom(body.rank, 1)),
    wins: numberFrom(body.wins),
    losses: numberFrom(body.losses),
    games: numberFrom(body.games),
    shipsDestroyed: numberFrom(body.shipsDestroyed)
  };
}

async function leaderboardResponse(request: Request, env: Env): Promise<Response> {
  const available = await ensureLeaderboard(env);
  if (!available || !env.DB_Leaderboard) {
    return json({ ok: false, error: "Leaderboard database is not bound" }, { status: 503 });
  }

  if (request.method === "POST") {
    const player = sanitizePlayer(await request.json() as Record<string, unknown>);
    if (!player) {
      return json({ ok: false, error: "Missing playerId or displayName" }, { status: 400 });
    }
    await env.DB_Leaderboard.prepare(`
      INSERT INTO leaderboard_players (
        player_id, display_name, lifetime_xp, xp, prestige, rank, wins, losses, games, ships_destroyed, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(player_id) DO UPDATE SET
        display_name = excluded.display_name,
        lifetime_xp = excluded.lifetime_xp,
        xp = excluded.xp,
        prestige = excluded.prestige,
        rank = excluded.rank,
        wins = excluded.wins,
        losses = excluded.losses,
        games = excluded.games,
        ships_destroyed = excluded.ships_destroyed,
        updated_at = excluded.updated_at
    `).bind(
      player.playerId,
      player.displayName,
      player.lifetimeXp,
      player.xp,
      player.prestige,
      player.rank,
      player.wins,
      player.losses,
      player.games,
      player.shipsDestroyed,
      Date.now()
    ).run();
    return json({ ok: true });
  }

  const rows = await env.DB_Leaderboard.prepare(`
    SELECT
      player_id AS playerId,
      display_name AS displayName,
      lifetime_xp AS lifetimeXp,
      xp,
      prestige,
      rank,
      wins,
      losses,
      games,
      ships_destroyed AS shipsDestroyed,
      updated_at AS updatedAt
    FROM leaderboard_players
    ORDER BY prestige DESC, lifetime_xp DESC, wins DESC
    LIMIT 50
  `).all();
  return json({ ok: true, players: rows.results ?? [] });
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
          "access-control-allow-headers": "authorization, content-type"
        }
      });
    }

    if (url.pathname === "/health") {
      return serviceInfo(request);
    }

    if (url.pathname === "/leaderboard") {
      return leaderboardResponse(request, env);
    }

    if (url.pathname.startsWith("/admin")) {
      if (!hasAdminAccess(request, env)) {
        return unauthorized();
      }
      const registry = env.LOBBIES.get(env.LOBBIES.idFromName("global"));

      if (url.pathname === "/admin/status") {
        const status = await registry.fetch("https://registry/status?admin=1");
        const registryStatus = await status.json() as Record<string, unknown>;
        return json({ ok: true, ...registryStatus, leaderboard: await leaderboardStatus(env) });
      }

      if (url.pathname === "/admin/clear-lobbies" && request.method === "POST") {
        await registry.fetch("https://registry/admin/clear-lobbies", { method: "POST" });
        return json({ ok: true });
      }

      if (url.pathname === "/admin/close-lobby" && request.method === "POST") {
        const body = await request.json() as { roomCode?: string };
        const roomCode = body.roomCode?.trim().toUpperCase();
        if (!roomCode) {
          return json({ ok: false, error: "Missing roomCode" }, { status: 400 });
        }
        const room = env.ROOMS.get(env.ROOMS.idFromName(roomCode));
        await room.fetch("https://room/admin/close", { method: "POST" });
        await registry.fetch(`https://registry/lobbies?room=${encodeURIComponent(roomCode)}`, { method: "DELETE" });
        return json({ ok: true });
      }

      if (url.pathname === "/admin/reset-leaderboard" && request.method === "POST") {
        if (await ensureLeaderboard(env)) {
          await env.DB_Leaderboard?.prepare("DELETE FROM leaderboard_players").run();
        }
        return json({ ok: true });
      }

      return json({ ok: false, error: "Unknown admin action" }, { status: 404 });
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
        body: JSON.stringify({ roomCode, status: "open" })
      });
    } else {
      const registry = env.LOBBIES.get(env.LOBBIES.idFromName("global"));
      await registry.fetch("https://registry/lobbies", {
        method: "POST",
        body: JSON.stringify({ roomCode, status: "full" })
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
          "access-control-allow-headers": "authorization, content-type"
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
      const openLobbies = this.visibleLobbies(lobbies, false);
      await this.state.storage.put("presence", next.slice(0, 500));
      await this.state.storage.put("lobbies", lobbies);
      return json({ ok: true, onlinePlayers: next.length, activeGames: lobbies.length, lobbies: openLobbies });
    }

    if (url.pathname === "/status") {
      const lobbies = await this.prunedLobbies();
      const presence = await this.prunedPresence();
      const includeFull = url.searchParams.get("admin") === "1";
      await this.state.storage.put("lobbies", lobbies);
      await this.state.storage.put("presence", presence);
      return json({ ok: true, onlinePlayers: presence.length, activeGames: lobbies.length, lobbies: this.visibleLobbies(lobbies, includeFull) });
    }

    if (url.pathname === "/admin/clear-lobbies" && request.method === "POST") {
      await this.state.storage.put("lobbies", []);
      return json({ ok: true });
    }

    if (request.method === "POST") {
      const body = (await request.json()) as { roomCode?: string; status?: "open" | "full" };
      const roomCode = body.roomCode?.trim().toUpperCase();
      if (!roomCode) {
        return json({ ok: false, error: "Missing roomCode" }, { status: 400 });
      }
      const lobbies = await this.prunedLobbies();
      const next = [
        { roomCode, updatedAt: Date.now(), status: body.status === "full" ? "full" : "open" },
        ...lobbies.filter((lobby) => lobby.roomCode !== roomCode)
      ].slice(0, 60);
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
    return json({ ok: true, lobbies: this.visibleLobbies(lobbies, false) });
  }

  private async prunedLobbies(): Promise<LobbyRecord[]> {
    const now = Date.now();
    const lobbies = (await this.state.storage.get<LobbyRecord[]>("lobbies")) ?? [];
    return lobbies
      .filter((lobby) => now - lobby.updatedAt < this.ttlMs)
      .map((lobby) => ({ ...lobby, status: lobby.status ?? "open" }));
  }

  private visibleLobbies(lobbies: LobbyRecord[], includeFull: boolean): LobbyRecord[] {
    return includeFull ? lobbies : lobbies.filter((lobby) => (lobby.status ?? "open") === "open");
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
    const url = new URL(request.url);
    if (url.pathname === "/admin/close" && request.method === "POST") {
      const message = JSON.stringify({ type: "admin-close", reason: "Room closed by admin" });
      for (const [socket] of this.sessions) {
        if (socket.readyState === WebSocket.OPEN) {
          socket.send(message);
          socket.close(4001, "Room closed by admin");
        }
      }
      this.sessions.clear();
      return json({ ok: true });
    }

    if (request.headers.get("upgrade") !== "websocket") {
      return json({ ok: false, error: "Expected WebSocket upgrade" }, { status: 426 });
    }

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
