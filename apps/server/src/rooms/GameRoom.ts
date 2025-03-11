import { Room, Client } from "colyseus";
import { Schema, type, MapSchema } from "@colyseus/schema";
import { 
  PlayerSchema, 
  BuildingSchema, 
  UnitSchema, 
  ResourceSchema,
  TILE_SIZE,
  CHUNK_SIZE,
  ResourceType,
  GameState as GameStateSchema
} from "../schemas/GameState";

// Schéma principal du jeu
class GameState extends Schema {
  @type({ map: PlayerSchema })
  players = new MapSchema<PlayerSchema>();

  @type({ map: UnitSchema })
  units = new MapSchema<UnitSchema>();

  @type({ map: BuildingSchema })
  buildings = new MapSchema<BuildingSchema>();

  @type({ map: ResourceSchema })
  resources = new MapSchema<ResourceSchema>();
}

export class GameRoom extends Room<GameState> {
  private readonly SIMULATION_INTERVAL = 1000 / 30; // 30 fois par seconde
  private intervalId: NodeJS.Timeout | null = null;
  private mapLines: string[] = [];
  private resourcesByChunk: Map<string, Set<string>> = new Map(); // Ressources par chunk
  
  // Stocker les ressources en dehors de l'état pour éviter la synchronisation automatique
  private resources: Map<string, ResourceSchema> = new Map();
  
  // Ajouter des propriétés pour l'optimisation des broadcasts
  private playerUpdateRates: Map<string, { 
    lastFullUpdate: number,
    lastPositionUpdate: number
  }> = new Map();
  private readonly NEARBY_UPDATE_RATE = 100; // 10 fois par seconde pour les objets proches
  private readonly DISTANT_UPDATE_RATE = 500; // 2 fois par seconde pour les objets distants

  // Constantes pour les quantités de ressources par type
  private readonly RESOURCE_AMOUNTS: {[key: string]: number} = {
    [ResourceType.GOLD]: 100,
    [ResourceType.WOOD]: 20,
    [ResourceType.STONE]: 75,
    [ResourceType.IRON]: 60,
    [ResourceType.COAL]: 40,
    [ResourceType.STEEL]: 30
  };

  private readonly RESOURCE_RESPAWN_TIMES: {[key: string]: number} = {
    [ResourceType.GOLD]: 999999999,   // Désactivé temporairement
    [ResourceType.WOOD]: 999999999,   // Désactivé temporairement
    [ResourceType.STONE]: 999999999,  // Désactivé temporairement
    [ResourceType.IRON]: 999999999,   // Désactivé temporairement
    [ResourceType.COAL]: 999999999,   // Désactivé temporairement
    [ResourceType.STEEL]: 999999999   // Désactivé temporairement
  };

  onCreate() {
    console.log("GameRoom created!");
    this.setState(new GameState());
    
    // Charger la carte et générer les ressources
    this.loadMap();
    this.generateWorld();
    this.generateResources();
    
    // Créer la boucle de simulation
    this.intervalId = setInterval(() => this.update(), this.SIMULATION_INTERVAL);
    
    // Configurer les gestionnaires de messages
    this.onMessage("move", (client, data) => {
      // Vérifier que les données sont valides
      if (data && typeof data.x === 'number' && typeof data.y === 'number') {
        this.handlePlayerMovement(client, data.x, data.y);
      }
    });
    
    this.onMessage("harvest", (client, data) => {
      this.handleHarvest(client, data);
    });
    
    this.onMessage("build", (client, data) => {
      this.handleBuild(client, data);
    });
  }

  // Nouveau joueur rejoint la partie
  onJoin(client: Client, options: any) {
    console.log(`Joueur ${client.sessionId} a rejoint la partie`);
    console.log("Options reçues:", options);
    
    // Créer un joueur avec nom et couleur
    const player = new PlayerSchema();
    player.id = client.sessionId;
    
    // Position initiale fixe à 10,12 (en tuiles)
    const spawnX = 10;
    const spawnY = 12;
    player.x = spawnX * TILE_SIZE;
    player.y = spawnY * TILE_SIZE;
    console.log(`Position de spawn définie : (${player.x}, ${player.y})`);
    
    // Récupérer les infos du joueur depuis les options
    if (options && options.name) {
      player.name = options.name.substring(0, 16); // Limiter à 16 caractères
    } else {
      player.name = `Player ${client.sessionId.substring(0, 4)}`;
    }
    
    if (options && options.hue !== undefined) {
      console.log(`Teinte reçue du client: ${options.hue} (type: ${typeof options.hue})`);
      // Utiliser directement la valeur de teinte (entre 0-360)
      player.hue = options.hue;
    } else {
      // Couleur aléatoire si non spécifiée
      player.hue = Math.floor(Math.random() * 360);
      console.log(`Aucune teinte reçue, génération aléatoire: ${player.hue}`);
    }
    
    console.log(`Joueur créé: ${player.name} (${player.x}, ${player.y}), hue: ${player.hue}`);
    
    // Ajouter le joueur à la room
    this.state.players.set(client.sessionId, player);
    
    // Log de débogage pour les joueurs actuels
    console.log(`Nombre de joueurs actuels: ${this.state.players.size}`);
    this.state.players.forEach((p: PlayerSchema, id: string) => {
      console.log(`- Joueur ${id}: ${p.name} à (${p.x}, ${p.y})`);
    });
    
    // Envoyer uniquement les ressources dans les chunks proches du joueur
    const nearbyResources = this.getResourcesInRange(player.x, player.y);
    console.log(`Envoi de ${nearbyResources.size} ressources au nouveau joueur (sur ${this.resources.size} au total)`);
    
    const resourcesData = Array.from(nearbyResources).map(id => {
      const resource = this.resources.get(id);
      return {
        id: resource?.id,
        type: resource?.type,
        x: resource?.x,
        y: resource?.y,
        amount: resource?.amount
      };
    });

    // Envoyer les ressources initiales au client
    client.send("initialResources", resourcesData);
  }

  // Joueur quitte la partie
  onLeave(client: Client, consented: boolean) {
    console.log(`Joueur ${client.sessionId} a quitté la partie`);
    
    // Supprimer le joueur
    this.state.players.delete(client.sessionId);
    
    // Annoncer aux autres clients que le joueur est parti
    this.broadcast("playerLeft", { sessionId: client.sessionId });
    
    // Log de débogage pour les joueurs restants
    console.log(`Nombre de joueurs restants: ${this.state.players.size}`);
  }

  // Nettoyage lors de la suppression de la room
  onDispose() {
    console.log("Room supprimée");
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  // Mise à jour du jeu (appelée à intervalle régulier)
  private update() {
    // Mettre à jour l'IA des unités
    this.updateAI();
    
    // Mettre à jour la production des bâtiments
    this.updateProduction();
    
    // Optimiser les broadcasts en fonction de la distance
    this.optimizeBroadcasts();
  }

  // Nouvelle méthode pour optimiser les broadcasts
  private optimizeBroadcasts() {
    const now = Date.now();
    
    // Parcourir tous les joueurs
    this.state.players.forEach((player, sessionId) => {
      // Initialiser les données de mise à jour si nécessaires
      if (!this.playerUpdateRates.has(sessionId)) {
        this.playerUpdateRates.set(sessionId, {
          lastFullUpdate: 0,
          lastPositionUpdate: 0
        });
      }
      
      const updateData = this.playerUpdateRates.get(sessionId)!;
      
      // Parcourir les autres joueurs pour déterminer les fréquences de mise à jour
      this.state.players.forEach((otherPlayer, otherSessionId) => {
        if (sessionId === otherSessionId) return; // Ne pas traiter le joueur lui-même
        
        // Calculer la distance entre les joueurs
        const distance = Math.sqrt(
          Math.pow(player.x - otherPlayer.x, 2) + 
          Math.pow(player.y - otherPlayer.y, 2)
        );
        
        const client = this.clients.find(c => c.sessionId === sessionId);
        if (!client) return;
        
        // Si le joueur est proche, mises à jour fréquentes
        if (distance < TILE_SIZE * CHUNK_SIZE * 3) {
          // Mettre à jour position seulement si le temps écoulé est suffisant
          if (now - updateData.lastPositionUpdate > this.NEARBY_UPDATE_RATE) {
            client.send("playerPosition", {
              sessionId: otherSessionId,
              x: otherPlayer.x,
              y: otherPlayer.y
            });
            updateData.lastPositionUpdate = now;
          }
        } 
        // Sinon, mises à jour moins fréquentes
        else {
          // Mettre à jour position seulement si le temps écoulé est suffisant
          if (now - updateData.lastPositionUpdate > this.DISTANT_UPDATE_RATE) {
            client.send("playerPosition", {
              sessionId: otherSessionId,
              x: otherPlayer.x,
              y: otherPlayer.y
            });
            updateData.lastPositionUpdate = now;
          }
        }
      });
      
      // Mise à jour complète moins fréquente pour les entités éloignées
      if (now - updateData.lastFullUpdate > this.DISTANT_UPDATE_RATE) {
        // Envoyer des mises à jour pour les ressources et bâtiments éloignés à un taux réduit
        updateData.lastFullUpdate = now;
      }
    });
  }

  // Génération du monde initial
  private generateWorld() {
    console.log("Génération du monde...");

    // Générer les ressources
    this.generateResources();
  }

  // Méthode pour créer les ressources
  private generateResources() {
    console.log("Génération des ressources...");
    
    // Générer les ressources selon la carte
    for (let y = 0; y < this.mapLines.length; y++) {
      for (let x = 0; x < this.mapLines[y].length; x++) {
        const char = this.mapLines[y][x];
        let resourceType = null;
        
        switch (char) {
          case 'G':
            resourceType = ResourceType.GOLD;
            break;
          case 'W':
          case 'T':
            resourceType = ResourceType.WOOD;
            break;
          case 'S':
            resourceType = ResourceType.STONE;
            break;
          case 'I':
            resourceType = ResourceType.IRON;
            break;
          case 'C':
            resourceType = ResourceType.COAL;
            break;
        }
        
        if (resourceType) {
          const resource = new ResourceSchema();
          resource.id = `${resourceType}_${x}_${y}`;
          resource.type = resourceType;
          resource.x = x * TILE_SIZE + TILE_SIZE/2;
          resource.y = y * TILE_SIZE + TILE_SIZE/2;
          resource.amount = this.RESOURCE_AMOUNTS[resourceType];
          
          // Stocker la ressource dans notre map locale au lieu de l'état global
          this.resources.set(resource.id, resource);
          
          // Ajouter la ressource au chunk correspondant
          const chunkX = Math.floor(x / CHUNK_SIZE);
          const chunkY = Math.floor(y / CHUNK_SIZE);
          const chunkKey = `${chunkX},${chunkY}`;
          
          if (!this.resourcesByChunk.has(chunkKey)) {
            this.resourcesByChunk.set(chunkKey, new Set());
          }
          this.resourcesByChunk.get(chunkKey)?.add(resource.id);
        }
      }
    }
    
    console.log(`Nombre total de ressources générées: ${this.resources.size}`);
    console.log(`Nombre de chunks contenant des ressources: ${this.resourcesByChunk.size}`);
  }

  // Nouvelle méthode pour obtenir les ressources dans un rayon de chunks
  private getResourcesInRange(centerX: number, centerY: number, range: number = 2): Set<string> {
    const centerChunkX = Math.floor(centerX / (TILE_SIZE * CHUNK_SIZE));
    const centerChunkY = Math.floor(centerY / (TILE_SIZE * CHUNK_SIZE));
    const resources = new Set<string>();

    for (let dy = -range; dy <= range; dy++) {
      for (let dx = -range; dx <= range; dx++) {
        const chunkKey = `${centerChunkX + dx},${centerChunkY + dy}`;
        const chunkResources = this.resourcesByChunk.get(chunkKey);
        if (chunkResources) {
          chunkResources.forEach(resourceId => resources.add(resourceId));
        }
      }
    }

    return resources;
  }

  // Gestion de la récolte de ressources
  private handleHarvest(client: Client, data: any) {
    const player = this.state.players.get(client.sessionId);
    if (!player) return;
    
    const { resourceId } = data;
    if (!resourceId) return;
    
    // Utiliser la map locale au lieu de l'état global
    const resource = this.resources.get(resourceId);
    if (!resource) {
      console.log(`Ressource ${resourceId} non trouvée`);
      return;
    }
    
    // Vérifier la distance entre le joueur et la ressource
    const distance = Math.sqrt(
      Math.pow(player.x - resource.x, 2) + 
      Math.pow(player.y - resource.y, 2)
    );
    
    // Si le joueur est trop loin, annuler la récolte
    if (distance > 50) {
      console.log(`Joueur trop loin pour récolter: ${distance.toFixed(2)} pixels`);
      return;
    }

    const now = Date.now();
    
    // Vérifier si la ressource est en cours de réapparition
    if (resource.isRespawning) {
      console.log(`La ressource ${resourceId} est en cours de réapparition`);
      return;
    }
    
    // Vérifier s'il reste des ressources à collecter
    if (resource.amount <= 0) {
      console.log(`La ressource ${resourceId} est épuisée`);
      return;
    }

    // Vérifier le cooldown de récolte (500ms entre chaque récolte)
    if (now - resource.lastHarvestTime < 500) {
      return;
    }
    
    // Mettre à jour le temps de dernière récolte
    resource.lastHarvestTime = now;
    
    // Réduire la quantité de ressource disponible
    resource.amount -= 1;
    
    // Informer le client qui a récolté
    client.send("resourceUpdate", {
      resourceId,
      amount: resource.amount,
      playerId: client.sessionId,
      resourceType: resource.type
    });
    
    // Si la ressource est épuisée, planifier sa réapparition
    if (resource.amount <= 0) {
      resource.isRespawning = true;
      
      // Planifier la réapparition
      const respawnTime = this.RESOURCE_RESPAWN_TIMES[resource.type] || 60000;
      setTimeout(() => {
        if (this.resources.has(resourceId)) {
          resource.amount = this.RESOURCE_AMOUNTS[resource.type] || resource.maxAmount;
          resource.isRespawning = false;
          
          // Broadcast la réapparition
          this.broadcast("resourceRespawned", {
            resourceId: resourceId,
            amount: resource.amount
          });
        }
      }, respawnTime);
      
      // Broadcast l'épuisement
      this.broadcast("resourceDepleted", {
        resourceId: resourceId,
        respawnTime: respawnTime
      });
    }
  }

  // Gestion de la construction
  private handleBuild(client: Client, data: any) {
    // Implémenter la construction ici
    console.log(`${client.sessionId} tente de construire à (${data.x}, ${data.y})`);
  }

  // Mise à jour de l'IA
  private updateAI() {
    // Mettre à jour l'IA ici
  }

  // Mise à jour de la production
  private updateProduction() {
    // Mettre à jour la production ici
  }

  // Méthode pour charger la carte
  private loadMap() {
    const fs = require('fs');
    const path = require('path');
    
    try {
      // Chemin vers le fichier de carte
      const mapPath = path.join(__dirname, '..', 'default.map');
      console.log("Chargement de la carte depuis:", mapPath);
      
      // Lire le fichier
      const mapContent = fs.readFileSync(mapPath, 'utf8');
      this.mapLines = mapContent.split('\n');
      
      console.log(`Carte chargée avec succès: ${this.mapLines.length} lignes`);
    } catch (error) {
      console.error("Erreur lors du chargement de la carte:", error);
      // Créer une petite carte par défaut en cas d'erreur
      this.mapLines = [
        "################",
        "#..............#",
        "#....G...W....S#",
        "#..............#",
        "################"
      ];
      console.log("Utilisation de la carte par défaut");
    }
  }

  // Modifier handlePlayerMovement pour mettre à jour les ressources visibles
  private handlePlayerMovement(client: Client, newX: number, newY: number) {
    const player = this.state.players.get(client.sessionId);
    if (!player) return;

    // Calculer les anciens et nouveaux chunks
    const oldChunkX = Math.floor(player.x / (TILE_SIZE * CHUNK_SIZE));
    const oldChunkY = Math.floor(player.y / (TILE_SIZE * CHUNK_SIZE));
    const newChunkX = Math.floor(newX / (TILE_SIZE * CHUNK_SIZE));
    const newChunkY = Math.floor(newY / (TILE_SIZE * CHUNK_SIZE));

    // Si le joueur a changé de chunk
    if (oldChunkX !== newChunkX || oldChunkY !== newChunkY) {
      console.log(`Joueur ${client.sessionId} a changé de chunk: (${oldChunkX}, ${oldChunkY}) -> (${newChunkX}, ${newChunkY})`);
      
      const nearbyResources = this.getResourcesInRange(newX, newY);
      console.log(`Envoi de ${nearbyResources.size} ressources au joueur ${client.sessionId}`);
      
      const resourcesData = Array.from(nearbyResources).map(id => {
        const resource = this.resources.get(id);
        return {
          id: resource?.id,
          type: resource?.type,
          x: resource?.x,
          y: resource?.y,
          amount: resource?.amount
        };
      });

      // Envoyer la mise à jour des ressources au client
      client.send("updateVisibleResources", resourcesData);
    }

    // Mettre à jour la position du joueur
    player.x = newX;
    player.y = newY;
    
    // Diffuser le mouvement à tous les autres clients
    this.broadcast("playerMoved", {
      sessionId: client.sessionId,
      x: newX,
      y: newY
    }, { except: client });
  }
} 