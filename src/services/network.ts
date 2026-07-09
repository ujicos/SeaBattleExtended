import type { NetworkMessage, PeerIdentity } from "../types/game";

type Listener = (message: NetworkMessage) => void;
type StatusListener = (status: string) => void;

const defaultSignalingUrl =
  import.meta.env.VITE_SIGNALING_URL ??
  "wss://seabattle-extended.yohabbodude.workers.dev";
const adminTokenSessionKey = "sea-battle.admin-token";
const adminTokenLocalKey = "sea-battle.admin-token.remembered";

export interface LobbySummary {
  roomCode: string;
  updatedAt: number;
  status?: "open" | "full";
}

export interface PresenceStatus {
  onlinePlayers: number;
  activeGames: number;
  lobbies: LobbySummary[];
}

export interface GlobalLeaderboardPlayer {
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
  updatedAt: number;
}

export interface AdminStatus extends PresenceStatus {
  leaderboard?: {
    available: boolean;
    players: number;
  };
}

export function isHiddenLeaderboardName(displayName: string): boolean {
  return displayName.toLowerCase().includes("dev");
}

export function loadAdminToken(): { token: string; remembered: boolean } {
  const remembered = localStorage.getItem(adminTokenLocalKey);
  if (remembered) {
    return { token: remembered, remembered: true };
  }
  return { token: sessionStorage.getItem(adminTokenSessionKey) ?? "", remembered: false };
}

export function saveAdminToken(token: string, remember: boolean): void {
  const trimmed = token.trim();
  sessionStorage.setItem(adminTokenSessionKey, trimmed);
  if (remember) {
    localStorage.setItem(adminTokenLocalKey, trimmed);
  } else {
    localStorage.removeItem(adminTokenLocalKey);
  }
}

export function clearAdminToken(): void {
  sessionStorage.removeItem(adminTokenSessionKey);
  localStorage.removeItem(adminTokenLocalKey);
}

function signalingHttpUrl(pathname: string, signalingUrl = defaultSignalingUrl): URL {
  const url = new URL(signalingUrl);
  url.protocol = url.protocol === "wss:" ? "https:" : "http:";
  url.pathname = pathname;
  url.search = "";
  return url;
}

export async function listOpenLobbies(signalingUrl = defaultSignalingUrl): Promise<LobbySummary[]> {
  const url = signalingHttpUrl("/lobbies", signalingUrl);
  const response = await fetch(url.toString(), { cache: "no-store" });
  if (!response.ok) {
    return [];
  }
  const data = (await response.json()) as { lobbies?: LobbySummary[] };
  return data.lobbies ?? [];
}

export async function fetchPresenceStatus(signalingUrl = defaultSignalingUrl): Promise<PresenceStatus> {
  const url = signalingHttpUrl("/status", signalingUrl);
  const response = await fetch(url.toString(), { cache: "no-store" });
  if (!response.ok) {
    return { onlinePlayers: 1, activeGames: 0, lobbies: [] };
  }
  const data = (await response.json()) as Partial<PresenceStatus>;
  return {
    onlinePlayers: data.onlinePlayers ?? 1,
    activeGames: data.activeGames ?? data.lobbies?.length ?? 0,
    lobbies: data.lobbies ?? []
  };
}

export async function pingPresence(sessionId: string, signalingUrl = defaultSignalingUrl): Promise<PresenceStatus> {
  const url = signalingHttpUrl("/presence", signalingUrl);
  const response = await fetch(url.toString(), {
    method: "POST",
    cache: "no-store",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ sessionId })
  });
  if (!response.ok) {
    return fetchPresenceStatus(signalingUrl);
  }
  const data = (await response.json()) as Partial<PresenceStatus>;
  return {
    onlinePlayers: data.onlinePlayers ?? 1,
    activeGames: data.activeGames ?? data.lobbies?.length ?? 0,
    lobbies: data.lobbies ?? []
  };
}

export function leavePresence(sessionId: string, signalingUrl = defaultSignalingUrl): void {
  const url = signalingHttpUrl("/presence", signalingUrl);
  url.searchParams.set("session", sessionId);
  void fetch(url.toString(), { method: "DELETE", keepalive: true }).catch(() => undefined);
}

export async function fetchGlobalLeaderboard(signalingUrl = defaultSignalingUrl): Promise<GlobalLeaderboardPlayer[]> {
  const url = signalingHttpUrl("/leaderboard", signalingUrl);
  const response = await fetch(url.toString(), { cache: "no-store" });
  if (!response.ok) {
    return [];
  }
  const data = (await response.json()) as { players?: GlobalLeaderboardPlayer[] };
  return data.players ?? [];
}

export async function submitGlobalLeaderboard(
  player: Omit<GlobalLeaderboardPlayer, "updatedAt">,
  signalingUrl = defaultSignalingUrl
): Promise<void> {
  const url = signalingHttpUrl("/leaderboard", signalingUrl);
  await fetch(url.toString(), {
    method: "POST",
    cache: "no-store",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(player)
  });
}

async function fetchAdmin<T>(
  token: string,
  pathname: string,
  init: RequestInit = {},
  signalingUrl = defaultSignalingUrl
): Promise<T> {
  const url = signalingHttpUrl(pathname, signalingUrl);
  const response = await fetch(url.toString(), {
    ...init,
    cache: "no-store",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
      ...init.headers
    }
  });
  const data = (await response.json()) as T & { ok?: boolean; error?: string };
  if (!response.ok || data.ok === false) {
    throw new Error(data.error ?? `Admin request failed (${response.status})`);
  }
  return data;
}

export function fetchAdminStatus(token: string, signalingUrl = defaultSignalingUrl): Promise<AdminStatus> {
  return fetchAdmin<AdminStatus>(token, "/admin/status", {}, signalingUrl);
}

export function adminCloseLobby(token: string, roomCode: string, signalingUrl = defaultSignalingUrl): Promise<{ ok: boolean }> {
  return fetchAdmin<{ ok: boolean }>(
    token,
    "/admin/close-lobby",
    {
      method: "POST",
      body: JSON.stringify({ roomCode })
    },
    signalingUrl
  );
}

export function adminClearLobbies(token: string, signalingUrl = defaultSignalingUrl): Promise<{ ok: boolean }> {
  return fetchAdmin<{ ok: boolean }>(token, "/admin/clear-lobbies", { method: "POST" }, signalingUrl);
}

export function adminResetLeaderboard(token: string, signalingUrl = defaultSignalingUrl): Promise<{ ok: boolean }> {
  return fetchAdmin<{ ok: boolean }>(token, "/admin/reset-leaderboard", { method: "POST" }, signalingUrl);
}

export class PeerGameClient {
  private socket: WebSocket | null = null;
  private peer: RTCPeerConnection | null = null;
  private channel: RTCDataChannel | null = null;
  private listeners = new Set<Listener>();
  private statusListeners = new Set<StatusListener>();
  private seenMessages = new Set<string>();
  private pendingMessages: NetworkMessage[] = [];
  private pendingSignals: unknown[] = [];

  constructor(
    private readonly signalingUrl = defaultSignalingUrl
  ) {}

  onMessage(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  onStatus(listener: StatusListener): () => void {
    this.statusListeners.add(listener);
    return () => this.statusListeners.delete(listener);
  }

  async createRoom(identity: PeerIdentity): Promise<string> {
    const roomCode = Math.random().toString(36).slice(2, 8).toUpperCase();
    await this.connectSocket(roomCode, "host", identity);
    await this.createPeer(true);
    return roomCode;
  }

  async joinRoom(roomCode: string, identity: PeerIdentity): Promise<void> {
    await this.connectSocket(roomCode.toUpperCase(), "guest", identity);
    await this.createPeer(false);
  }

  send(type: NetworkMessage["type"], payload: unknown): void {
    const message: NetworkMessage = {
      type,
      payload,
      messageId: crypto.randomUUID(),
      sentAt: Date.now()
    };
    if (this.channel?.readyState !== "open") {
      this.pendingMessages.push(message);
      this.emitStatus("P2P channel opening");
      return;
    }
    this.channel.send(JSON.stringify(message));
  }

  close(): void {
    this.channel?.close();
    this.peer?.close();
    this.socket?.close();
    this.channel = null;
    this.peer = null;
    this.socket = null;
  }

  private emitStatus(status: string): void {
    this.statusListeners.forEach((listener) => listener(status));
  }

  private emitMessage(message: NetworkMessage): void {
    if (this.seenMessages.has(message.messageId)) {
      return;
    }
    this.seenMessages.add(message.messageId);
    this.listeners.forEach((listener) => listener(message));
  }

  private roomUrl(roomCode: string, role: "host" | "guest"): string {
    const url = new URL(this.signalingUrl);
    url.searchParams.set("room", roomCode);
    url.searchParams.set("role", role);
    return url.toString();
  }

  private connectSocket(roomCode: string, role: "host" | "guest", identity: PeerIdentity): Promise<void> {
    this.socket = new WebSocket(this.roomUrl(roomCode, role));
    return new Promise((resolve, reject) => {
      if (!this.socket) {
        reject(new Error("Socket unavailable"));
        return;
      }

      this.socket.onopen = () => {
        this.socket?.send(JSON.stringify({ type: "join-room", roomCode, role, identity }));
        this.emitStatus(`Signaling connected: ${roomCode}`);
        resolve();
      };
      this.socket.onerror = () => reject(new Error("Could not connect signaling server"));
      this.socket.onmessage = (event) => void this.handleSignal(JSON.parse(event.data));
    });
  }

  private async createPeer(isHost: boolean): Promise<void> {
    this.peer = new RTCPeerConnection({
      iceServers: [{ urls: "stun:stun.l.google.com:19302" }]
    });

    this.peer.onicecandidate = (event) => {
      if (event.candidate) {
        this.socket?.send(JSON.stringify({ type: "ice", candidate: event.candidate }));
      }
    };
    this.peer.onconnectionstatechange = () => this.emitStatus(this.peer?.connectionState ?? "closed");

    if (isHost) {
      this.bindChannel(this.peer.createDataChannel("sea-battle", { ordered: true }));
      const offer = await this.peer.createOffer();
      await this.peer.setLocalDescription(offer);
      this.socket?.send(JSON.stringify({ type: "offer", offer }));
    } else {
      this.peer.ondatachannel = (event) => this.bindChannel(event.channel);
    }

    await this.flushPendingSignals();
  }

  private bindChannel(channel: RTCDataChannel): void {
    this.channel = channel;
    this.channel.onopen = () => {
      this.emitStatus("P2P data channel open");
      for (const message of this.pendingMessages.splice(0)) {
        this.channel?.send(JSON.stringify(message));
      }
    };
    this.channel.onclose = () => this.emitStatus("P2P data channel closed");
    this.channel.onmessage = (event) => this.emitMessage(JSON.parse(event.data) as NetworkMessage);
  }

  private async flushPendingSignals(): Promise<void> {
    for (const signal of this.pendingSignals.splice(0)) {
      await this.handleSignal(signal);
    }
  }

  private async handleSignal(signal: any): Promise<void> {
    if (signal.type === "peer-joined" && signal.identity) {
      this.emitMessage({
        type: "identity",
        payload: signal.identity,
        messageId: crypto.randomUUID(),
        sentAt: Date.now()
      });
      return;
    }

    if (!this.peer) {
      this.pendingSignals.push(signal);
      return;
    }

    if (signal.type === "offer") {
      await this.peer.setRemoteDescription(signal.offer);
      const answer = await this.peer.createAnswer();
      await this.peer.setLocalDescription(answer);
      this.socket?.send(JSON.stringify({ type: "answer", answer }));
    }

    if (signal.type === "answer") {
      await this.peer.setRemoteDescription(signal.answer);
    }

    if (signal.type === "ice" && signal.candidate) {
      await this.peer.addIceCandidate(signal.candidate);
    }
  }
}
