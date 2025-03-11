import { Server } from "colyseus";
import { createServer } from "http";
import express from "express";
import cors from "cors";
import { monitor } from "@colyseus/monitor";
import { GameRoom } from "./rooms/GameRoom";
import { loadMap } from "./world/worldManager";

const port = Number(process.env.PORT || 2567);
const app = express();

app.use(cors());
app.use(express.json());

// Monitoring route
app.use("/colyseus", monitor());

// Initialiser le monde au démarrage du serveur
console.log("Initialisation du monde du serveur...");
const worldData = loadMap();
console.log("Monde initialisé avec succès!");

// Create HTTP & WebSocket servers
const server = createServer(app);
const gameServer = new Server({
  server,
});

// Register game room with world data
gameServer.define("game_room", GameRoom, { worldData })
  .enableRealtimeListing();

// Start server
gameServer.listen(port).then(() => {
  console.log(`🚀 Server started on http://localhost:${port}`);
  console.log(`🎮 Colyseus monitor available at http://localhost:${port}/colyseus`);
}).catch(err => {
  console.error(err);
  process.exit(1);
}); 