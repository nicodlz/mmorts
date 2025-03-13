import { Server } from "colyseus";
import { createServer } from "http";
import express from "express";
import cors from "cors";
import { monitor } from "@colyseus/monitor";
import { GameRoom } from "./rooms/GameRoom";
import { loadMap } from "./world/worldManager";

const port = Number(process.env.PORT || 2567);
const app = express();

// Configuration CORS plus permissive
app.use(cors({
  origin: true, // Permet toutes les origines
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept'],
  credentials: true,
  maxAge: 86400 // Cache pour 24 heures
}));

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
  presence: true,
  transport: {
    pingInterval: 5000,
    pingMaxRetries: 3,
    allowedOrigins: "*" // Permet toutes les origines pour WebSocket
  }
});

// Register game room with world data
gameServer.define("game_room", GameRoom, { worldData })
  .enableRealtimeListing();

// Start server
gameServer.listen(port, "0.0.0.0").then(() => {
  console.log(`🚀 Server started and listening on all interfaces (0.0.0.0:${port})`);
  console.log(`🎮 Colyseus monitor available at http://0.0.0.0:${port}/colyseus`);
  console.log(`📝 CORS enabled for all origins`);
}).catch(err => {
  console.error("Failed to start server:", err);
  process.exit(1);
}); 