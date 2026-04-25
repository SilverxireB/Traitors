import { defineConfig, type ViteDevServer } from "vite";
import react from "@vitejs/plugin-react";
import { WebSocketServer } from "ws";
import type { Server as HttpServer } from "node:http";

const rooms = new Map<string, unknown>();

export default defineConfig({
  plugins: [
    react(),
    {
      name: "vampir-room-server",
      configureServer(server: ViteDevServer) {
        if (!server.httpServer) return;

        const wss = new WebSocketServer({ server: server.httpServer as HttpServer, path: "/room-ws" });

        wss.on("connection", (socket) => {
          socket.on("message", (raw) => {
            const message = JSON.parse(String(raw)) as { type: string; room: string; state?: unknown };

            if (message.type === "join") {
              socket.send(JSON.stringify({ type: "state", state: rooms.get(message.room) ?? null }));
              return;
            }

            if (message.type === "state") {
              rooms.set(message.room, message.state);
              wss.clients.forEach((client) => {
                if (client !== socket && client.readyState === client.OPEN) {
                  client.send(JSON.stringify({ type: "state", state: message.state }));
                }
              });
            }
          });
        });
      },
    },
  ],
  server: {
    allowedHosts: ["engage-collected-overnight-stolen.trycloudflare.com"],
  },
});
