import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { extname, join, resolve } from "node:path";
import { WebSocketServer } from "ws";

const portArgIndex = process.argv.findIndex((arg) => arg === "--port" || arg === "-p");
const portArg = portArgIndex >= 0 ? process.argv[portArgIndex + 1] : undefined;
const port = Number(portArg ?? process.env.PORT ?? 4173);
const root = resolve("dist");
const rooms = new Map();
const clients = new Map();

const contentTypes = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
};

const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? "/", `http://${request.headers.host}`);
  const requestedPath = url.pathname === "/" ? "/index.html" : url.pathname;
  const filePath = join(root, requestedPath);
  const safePath = filePath.startsWith(root) && existsSync(filePath) ? filePath : join(root, "index.html");

  try {
    const body = await readFile(safePath);
    response.writeHead(200, {
      "content-type": contentTypes[extname(safePath)] ?? "application/octet-stream",
      "cache-control": safePath.endsWith("index.html") ? "no-store" : "public, max-age=31536000, immutable",
    });
    response.end(body);
  } catch {
    response.writeHead(404);
    response.end("Not found");
  }
});

const wss = new WebSocketServer({ server, path: "/room-ws" });

function send(socket, payload) {
  if (socket.readyState === socket.OPEN) {
    socket.send(JSON.stringify(payload));
  }
}

function broadcast(room, payload, sender) {
  for (const [socket, socketRoom] of clients.entries()) {
    if (socket !== sender && socketRoom === room) send(socket, payload);
  }
}

wss.on("connection", (socket) => {
  socket.on("message", (raw) => {
    const message = JSON.parse(String(raw));
    const room = message.room ?? "VAMP-2026";
    clients.set(socket, room);

    if (message.type === "join") {
      send(socket, { type: "state", state: rooms.get(room) ?? null });
      return;
    }

    if (message.type === "state") {
      rooms.set(room, message.state);
      broadcast(room, { type: "state", state: message.state }, socket);
    }
  });

  socket.on("close", () => {
    clients.delete(socket);
  });
});

server.listen(port, "0.0.0.0", () => {
  console.log(`Vampir Koylu server listening on http://0.0.0.0:${port}`);
});
