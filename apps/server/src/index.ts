import { Server } from "@colyseus/core";
import { WebSocketTransport } from "@colyseus/ws-transport";
import { createServer } from "node:http";
import { join } from "node:path";
import express from "express";
import cors from "cors";
import compression from "compression";
import { monitor } from "@colyseus/monitor";
import { Encoder } from "@colyseus/schema";
import { GameRoom } from "./rooms/GameRoom";
import { loadMap } from "./world/worldManager";

export function createGameServer() {
  Encoder.BUFFER_SIZE = 64 * 1024;
  const app = express();
  app.use(compression());
  const allowedOrigins = process.env.ALLOWED_ORIGINS?.split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
  app.use(cors({ origin: allowedOrigins?.length ? allowedOrigins : true }));
  app.use(express.json({ limit: "16kb" }));
  app.get("/health", (_req, res) => res.json({ status: "ok" }));
  // Keep administration off public production servers unless explicitly configured.
  if (process.env.NODE_ENV !== "production") app.use("/colyseus", monitor());
  if (process.env.NODE_ENV === "production") {
    const clientDist = join(__dirname, "../../client/dist");
    app.use(
      "/assets",
      express.static(join(clientDist, "assets"), {
        immutable: true,
        maxAge: "1y",
      }),
    );
    app.use(express.static(clientDist));
  }
  const httpServer = createServer(app);
  const gameServer = new Server({
    transport: new WebSocketTransport({
      server: httpServer,
      maxPayload: 16 * 1024,
    }),
  });
  gameServer.define("game_room", GameRoom, { worldData: loadMap() });
  return { gameServer, httpServer, app };
}
if (require.main === module) {
  const port = Number(process.env.PORT || 2567);
  if (!Number.isInteger(port) || port < 0 || port > 65535)
    throw new Error("PORT must be a valid TCP port.");
  const { gameServer, httpServer } = createGameServer();
  gameServer
    .listen(port, process.env.HOST || "0.0.0.0")
    .then(() => {
      const address = httpServer.address();
      console.log(
        `PvPStrat server listening on port ${address && typeof address !== "string" ? address.port : port}`,
      );
    })
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    });
}
