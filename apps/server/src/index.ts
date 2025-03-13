import { Server } from "colyseus";
import { createServer } from "http";
import express from "express";
import cors from "cors";
import { monitor } from "@colyseus/monitor";
import { GameRoom } from "./rooms/GameRoom";
import { loadMap } from "./world/worldManager";

// Déterminer le mode d'exécution
const isProduction = process.env.NODE_ENV === 'production';
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
  server: server,
  // Simplifier la configuration en retirant presence et transport
});

// Register game room with world data
gameServer.define("game_room", GameRoom, { worldData })
  .enableRealtimeListing();

// Start server
gameServer.listen(port, "0.0.0.0").then(() => {
  console.log(`🚀 Server started in ${isProduction ? 'PRODUCTION' : 'DEVELOPMENT'} mode`);
  console.log(`🚀 Listening on all interfaces (0.0.0.0:${port})`);
  console.log(`🎮 Colyseus monitor available at http://0.0.0.0:${port}/colyseus`);
  console.log(`📝 CORS enabled for all origins`);
}).catch(err => {
  console.error("Failed to start server:", err);
  process.exit(1);
}); 