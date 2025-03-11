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
    // Initialiser l'état du jeu
    this.setState(new GameState());

    // Charger la carte
    this.loadMap();

    // Configurer les gestionnaires de messages
    this.onMessage("move", (client, data) => {
      const player = this.state.players.get(client.sessionId);
      if (player) {
        player.x = data.x;
        player.y = data.y;
        
        // Diffuser le mouvement à tous les autres clients
        this.broadcast("playerMoved", {
          sessionId: client.sessionId,
          x: data.x,
          y: data.y
        }, { except: client });
      }
    });

    this.onMessage("harvest", (client, data) => {
      this.handleHarvest(client, data);
    });

    this.onMessage("build", (client, data) => {
      this.handleBuild(client, data);
    });

    // Log de débogage pour les connexions
    console.log("Room créée, en attente de joueurs...");
    
    // Démarrer la boucle de simulation
    this.intervalId = setInterval(() => this.update(), this.SIMULATION_INTERVAL);
    
    // Générer le monde initial
    this.generateWorld();
  }

  // Nouveau joueur rejoint la partie
  onJoin(client: Client, options: any) {
    console.log(`Joueur ${client.sessionId} a rejoint la partie`);
    console.log("Options reçues:", options);
    
    // Créer un joueur avec nom et couleur
    const player = new PlayerSchema();
    player.id = client.sessionId;
    
    // Position initiale aléatoire
    player.x = Math.floor(Math.random() * 800) + 800;
    player.y = Math.floor(Math.random() * 800) + 800;
    
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
    
    // Annoncer aux autres clients qu'un nouveau joueur a rejoint
    this.broadcast("playerJoined", { 
      sessionId: client.sessionId,
      name: player.name,
      x: player.x,
      y: player.y,
      hue: player.hue
    }, { except: client });
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
    // Mise à jour de l'IA et de la production
    this.updateAI();
    this.updateProduction();
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
          resource.maxAmount = this.RESOURCE_AMOUNTS[resourceType];
          resource.respawnTime = this.RESOURCE_RESPAWN_TIMES[resourceType];
          
          this.state.resources.set(resource.id, resource);
        }
      }
    }
  }

  // Gestion de la récolte de ressources
  private handleHarvest(client: Client, data: any) {
    const player = this.state.players.get(client.sessionId);
    const resourceId = data.resourceId;
    const resource = this.state.resources.get(resourceId) as ResourceSchema;
    
    if (!player || !resource) {
      console.log(`Ressource ou joueur non trouvé: ${resourceId}`);
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
    
    // Initialiser les ressources du joueur si nécessaire
    if (!player.resources) {
      player.resources = new MapSchema<number>();
    }
    
    // Ajouter la ressource au joueur
    const currentAmount = player.resources.get(resource.type) || 0;
    player.resources.set(resource.type, currentAmount + 1);
    
    // Broadcast la mise à jour de la ressource à tous les clients
    this.broadcast("resourceUpdate", {
      resourceId: resourceId,
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
        if (this.state.resources.has(resourceId)) {
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
} 