import type { NetworkMessage, PeerIdentity } from "../types/game";

type Listener = (message: NetworkMessage) => void;
type StatusListener = (status: string) => void;

export class PeerGameClient {
  private socket: WebSocket | null = null;
  private peer: RTCPeerConnection | null = null;
  private channel: RTCDataChannel | null = null;
  private listeners = new Set<Listener>();
  private statusListeners = new Set<StatusListener>();
  private seenMessages = new Set<string>();

  constructor(
    private readonly signalingUrl =
      import.meta.env.VITE_SIGNALING_URL ??
      `${location.protocol === "https:" ? "wss" : "ws"}://${location.hostname}:8787`
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
    if (this.channel?.readyState !== "open") {
      this.emitStatus("P2P channel not ready yet");
      return;
    }
    const message: NetworkMessage = {
      type,
      payload,
      messageId: crypto.randomUUID(),
      sentAt: Date.now()
    };
    this.channel?.send(JSON.stringify(message));
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
  }

  private bindChannel(channel: RTCDataChannel): void {
    this.channel = channel;
    this.channel.onopen = () => this.emitStatus("P2P data channel open");
    this.channel.onclose = () => this.emitStatus("P2P data channel closed");
    this.channel.onmessage = (event) => this.emitMessage(JSON.parse(event.data) as NetworkMessage);
  }

  private async handleSignal(signal: any): Promise<void> {
    if (!this.peer) {
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
