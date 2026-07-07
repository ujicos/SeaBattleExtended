import { WebSocketServer, type WebSocket } from "ws";

interface ClientInfo {
  roomCode: string;
  role: "host" | "guest";
}

const port = Number(process.env.PORT ?? 8787);
const server = new WebSocketServer({ port });
const clients = new Map<WebSocket, ClientInfo>();
const roomSignals = new Map<string, unknown[]>();

function peersInRoom(roomCode: string, sender: WebSocket): WebSocket[] {
  return [...clients.entries()]
    .filter(([client, info]) => client !== sender && info.roomCode === roomCode && client.readyState === client.OPEN)
    .map(([client]) => client);
}

server.on("connection", (socket) => {
  socket.on("message", (raw) => {
    const message = JSON.parse(raw.toString());

    if (message.type === "join-room") {
      clients.set(socket, { roomCode: message.roomCode, role: message.role });
      for (const signal of roomSignals.get(message.roomCode) ?? []) {
        socket.send(JSON.stringify(signal));
      }
      for (const peer of peersInRoom(message.roomCode, socket)) {
        peer.send(JSON.stringify({ type: "peer-joined", identity: message.identity }));
      }
      return;
    }

    const info = clients.get(socket);
    if (!info) {
      return;
    }

    if (message.type === "offer" || message.type === "ice") {
      const signals = roomSignals.get(info.roomCode) ?? [];
      roomSignals.set(info.roomCode, [...signals, message].slice(-40));
    }

    for (const peer of peersInRoom(info.roomCode, socket)) {
      peer.send(JSON.stringify(message));
    }
  });

  socket.on("close", () => {
    clients.delete(socket);
  });
});

console.log(`Sea Battle signaling server listening on ws://localhost:${port}`);
