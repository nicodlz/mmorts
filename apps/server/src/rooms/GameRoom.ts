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

import { BUILDING_COSTS, BuildingType } from "shared";

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
  
  // Système de production
  private readonly PRODUCTION_RATES: { [key: string]: number } = {
    [BuildingType.FURNACE]: 10000, // 10 secondes pour produire du charbon
    [BuildingType.FORGE]: 8000,    // 8 secondes pour produire du fer
    [BuildingType.FACTORY]: 30000  // 30 secondes pour produire de l'acier
  };
  
  // Recettes pour les bâtiments de production
  private readonly PRODUCTION_RECIPES: { 
    [key: string]: { 
      inputs: { [resource: string]: number },
      outputs: { [resource: string]: number }
    } 
  } = {
    [BuildingType.FURNACE]: {
      inputs: { [ResourceType.WOOD]: 5 },
      outputs: { [ResourceType.COAL]: 1 }
    },
    [BuildingType.FORGE]: {
      inputs: { [ResourceType.STONE]: 5 },
      outputs: { [ResourceType.IRON]: 1 }
    },
    [BuildingType.FACTORY]: {
      inputs: { [ResourceType.COAL]: 3, [ResourceType.IRON]: 3 },
      outputs: { [ResourceType.STEEL]: 1 }
    }
  };
  
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

  onCreate(options: { worldData: { mapLines: string[], resources: Map<string, ResourceSchema>, resourcesByChunk: Map<string, Set<string>> } }) {
    console.log("GameRoom created!");
    this.setState(new GameState());
    
    // Utiliser les données du monde partagé
    this.mapLines = options.worldData.mapLines;
    this.resources = options.worldData.resources;
    this.resourcesByChunk = options.worldData.resourcesByChunk;
    
    console.log(`GameRoom initialisée avec ${this.resources.size} ressources dans ${this.resourcesByChunk.size} chunks`);
    
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

    this.onMessage("destroyBuilding", (client, data) => {
      // Vérifier que le client est le propriétaire du bâtiment ou a le droit de le détruire
      const building = this.state.buildings.get(data.buildingId);
      if (building && building.owner === client.sessionId) {
        this.handleDestroyBuilding(data.buildingId);
      } else {
        console.log(`Le client ${client.sessionId} n'est pas autorisé à détruire le bâtiment ${data.buildingId}`);
      }
    });
    
    // Gestionnaire pour activer/désactiver la production d'un bâtiment
    this.onMessage("toggleProduction", (client, data) => {
      const { buildingId, active } = data;
      const building = this.state.buildings.get(buildingId);
      
      if (building && building.owner === client.sessionId) {
        building.productionActive = active;
        console.log(`Production ${active ? 'activée' : 'désactivée'} pour le bâtiment ${buildingId}`);
      }
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

    // Initialiser les ressources du joueur
    player.resources = new MapSchema<number>();
    player.resources.set(ResourceType.WOOD, 500);
    player.resources.set(ResourceType.STONE, 500);
    player.resources.set(ResourceType.GOLD, 500);
    player.resources.set(ResourceType.IRON, 500);
    player.resources.set(ResourceType.COAL, 500);
    player.resources.set(ResourceType.STEEL, 500);
    
    // Définir la population initiale à 1 au lieu de 0
    player.population = 1;
    // Définir la population maximale à 0 (sera augmentée lors de la construction de maisons)
    player.maxPopulation = 0;
    
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

  // Méthode appelée à chaque tick de simulation
  private update() {
    // Vérifier si la Room existe encore
    if (!this.state) return;
    
    // Gérer la production des bâtiments
    this.updateProduction();
    
    // Envoyer uniquement les mises à jour aux joueurs qui ont besoin de les voir
    this.optimizeBroadcasts();
  }

  // Méthode pour gérer la production des bâtiments
  private updateProduction() {
    // Parcourir tous les bâtiments
    for (const [buildingId, building] of this.state.buildings.entries()) {
      // Vérifier si c'est un bâtiment de production
      if (this.PRODUCTION_RATES[building.type] && building.productionActive) {
        const player = this.state.players.get(building.owner);
        if (!player) continue;
        
        // Incrémenter la progression de la production, mais limiter les mises à jour
        const increment = (this.SIMULATION_INTERVAL / this.PRODUCTION_RATES[building.type]) * 100;
        const newProgress = building.productionProgress + increment;
        
        // Ne mettre à jour que si le changement est significatif (au moins 1%)
        // Cette approche réduit considérablement le nombre de mises à jour réseau
        if (Math.floor(newProgress) > Math.floor(building.productionProgress)) {
          building.productionProgress = newProgress;
        } else {
          // Mettre à jour localement sans déclencher d'événement réseau
          building["_productionProgress"] = newProgress;
          
          // Si on franchit un seuil, synchroniser avec la valeur réelle
          if (Math.floor(building["_productionProgress"]) > Math.floor(building.productionProgress)) {
            building.productionProgress = building["_productionProgress"];
          }
        }
        
        // Si la production est terminée (100%)
        if (building.productionProgress >= 100) {
          // Réinitialiser la progression
          building.productionProgress = 0;
          if (building["_productionProgress"]) building["_productionProgress"] = 0;
          
          // Obtenir la recette pour ce type de bâtiment
          const recipe = this.PRODUCTION_RECIPES[building.type];
          if (!recipe) continue;
          
          // Vérifier si le joueur a les ressources nécessaires
          let hasAllInputs = true;
          for (const [resource, amount] of Object.entries(recipe.inputs)) {
            const playerResource = player.resources.get(resource) || 0;
            if (playerResource < amount) {
              hasAllInputs = false;
              console.log(`Production impossible: ressources insuffisantes pour ${building.type} (${resource}: ${playerResource}/${amount})`);
              break;
            }
          }
          
          // Si le joueur a toutes les ressources nécessaires
          if (hasAllInputs) {
            // Déduire les ressources d'entrée
            for (const [resource, amount] of Object.entries(recipe.inputs)) {
              const currentAmount = player.resources.get(resource) || 0;
              player.resources.set(resource, currentAmount - amount);
            }
            
            // Ajouter les ressources produites
            for (const [resource, amount] of Object.entries(recipe.outputs)) {
              const currentAmount = player.resources.get(resource) || 0;
              player.resources.set(resource, currentAmount + amount);
            }
            
            // Log détaillé pour le débogage
            console.log(`PRODUCTION RÉUSSIE: Bâtiment ${building.type} (${buildingId}) a produit pour ${building.owner}`);
            console.log(`  Entrées:`, recipe.inputs);
            console.log(`  Sorties:`, recipe.outputs);
            
            // Notifier le client de la production avec un délai pour éviter les conditions de course
            setTimeout(() => {
              const client = this.clients.find(c => c.sessionId === building.owner);
              if (client) {
                client.send("resourceProduced", {
                  buildingId,
                  inputs: recipe.inputs,
                  outputs: recipe.outputs
                });
                console.log(`Notification de production envoyée à ${building.owner}`);
              }
            }, 50);
          } else {
            console.log(`Production échouée pour ${building.type} (${buildingId}): ressources insuffisantes`);
            
            // Notifier le client de l'échec (optionnel)
            const client = this.clients.find(c => c.sessionId === building.owner);
            if (client) {
              client.send("productionFailed", {
                buildingId,
                reason: "resources_insufficient",
                requiredResources: recipe.inputs
              });
            }
          }
        }
      }
    }
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
    
    // Ajouter la ressource à l'inventaire du joueur
    // Initialiser les ressources du joueur si nécessaire
    if (!player.resources) {
      player.resources = new MapSchema<number>();
    }
    
    // Ajouter la ressource au joueur
    const currentAmount = player.resources.get(resource.type) || 0;
    player.resources.set(resource.type, currentAmount + 1);
    
    console.log(`Joueur ${client.sessionId} a récolté 1 ${resource.type}, total: ${currentAmount + 1}`);
    
    // Informer le client qui a récolté
    client.send("resourceUpdate", {
      resourceId,
      amount: resource.amount,
      playerId: client.sessionId,
      resourceType: resource.type,
      // Ajouter les ressources du joueur à la réponse
      playerResources: {
        [resource.type]: currentAmount + 1
      }
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
    const player = this.state.players.get(client.sessionId);
    if (!player) return;

    const { type, x, y } = data;
    if (!type || x === undefined || y === undefined) return;

    // Vérifier la distance avec le joueur
    const playerTileX = Math.floor(player.x / TILE_SIZE);
    const playerTileY = Math.floor(player.y / TILE_SIZE);
    const buildingTileX = Math.floor(x / TILE_SIZE);
    const buildingTileY = Math.floor(y / TILE_SIZE);
    
    const distance = Math.max(
      Math.abs(playerTileX - buildingTileX),
      Math.abs(playerTileY - buildingTileY)
    );

    if (distance > 2) {
      console.log(`Construction trop loin pour le joueur ${client.sessionId}`);
      return;
    }

    // Vérifier si l'emplacement est libre
    for (const [_, building] of this.state.buildings.entries()) {
      if (Math.floor(building.x / TILE_SIZE) === buildingTileX && 
          Math.floor(building.y / TILE_SIZE) === buildingTileY) {
        console.log(`Emplacement déjà occupé en (${buildingTileX}, ${buildingTileY})`);
        return;
      }
    }

    // Vérifier et déduire les ressources
    const costs = BUILDING_COSTS[type];
    if (!costs) {
      console.log(`Type de bâtiment invalide: ${type}`);
      return;
    }

    // Vérifier que le joueur a assez de ressources
    for (const [resource, amount] of Object.entries(costs)) {
      const playerResource = player.resources.get(resource) || 0;
      if (playerResource < amount) {
        console.log(`Ressources insuffisantes pour ${type}: manque de ${resource}`);
        return;
      }
    }

    // Déduire les ressources
    for (const [resource, amount] of Object.entries(costs)) {
      const currentAmount = player.resources.get(resource) || 0;
      player.resources.set(resource, currentAmount - amount);
    }

    // Créer le bâtiment
    const building = new BuildingSchema();
    building.id = `${type}_${Date.now()}_${client.sessionId}`;
    building.type = type;
    building.owner = client.sessionId;
    building.x = x;
    building.y = y;
    
    // Initialiser les propriétés de production pour les bâtiments de production
    if (this.PRODUCTION_RATES[type]) {
      building.productionProgress = 0;
      building.productionActive = true;
      console.log(`Bâtiment de production ${type} créé avec production active`);
    }
    
    // Définir la propriété fullTileCollision à true pour les murs
    if (type === BuildingType.PLAYER_WALL) {
      building.fullTileCollision = true;
    }
    
    // Ajouter le bâtiment à l'état du jeu
    this.state.buildings.set(building.id, building);

    // Appliquer les effets spécifiques au type de bâtiment
    if (type === BuildingType.HOUSE) {
      // Augmenter la population maximale du joueur de 10
      player.maxPopulation = (player.maxPopulation || 0) + 10;
      
      // Informer le client que sa population maximale a été mise à jour
      this.clients.find(c => c.sessionId === client.sessionId)?.send('populationUpdate', {
        population: player.population,
        maxPopulation: player.maxPopulation
      });
    }

    console.log(`Bâtiment ${type} construit par ${client.sessionId} en (${x}, ${y})`);
  }

  // Mise à jour de l'IA
  private updateAI() {
    // Mettre à jour l'IA ici
  }

  // Méthode pour gérer la destruction d'un bâtiment
  private handleDestroyBuilding(buildingId: string) {
    const building = this.state.buildings.get(buildingId);
    if (!building) return;

    console.log(`Destruction du bâtiment ${building.type} (${buildingId})`);
    
    const player = this.state.players.get(building.owner);
    if (!player) {
      this.state.buildings.delete(buildingId);
      return;
    }
    
    // Rembourser 75% des ressources utilisées pour la construction
    const costs = BUILDING_COSTS[building.type];
    if (costs) {
      // Calculer le remboursement pour chaque ressource
      const refunds: {[key: string]: number} = {};
      
      for (const [resource, amount] of Object.entries(costs)) {
        // Arrondir à l'entier inférieur
        const refundAmount = Math.floor(amount * 0.75);
        if (refundAmount > 0) {
          // Mettre à jour les ressources du joueur
          const currentAmount = player.resources.get(resource) || 0;
          player.resources.set(resource, currentAmount + refundAmount);
          
          // Enregistrer pour le message de log
          refunds[resource] = refundAmount;
        }
      }
      
      // Informer le client des ressources récupérées
      this.clients.find(c => c.sessionId === building.owner)?.send('resourcesRefunded', {
        buildingType: building.type,
        refunds
      });
      
      console.log(`Joueur ${building.owner} a récupéré des ressources:`, refunds);
    }
    
    // Si c'est une maison, réduire la population maximale du joueur
    if (building.type === BuildingType.HOUSE) {
      // Réduire la population maximale de 10
      player.maxPopulation = Math.max(0, (player.maxPopulation || 0) - 10);
      
      // Si la population actuelle dépasse la nouvelle limite, l'ajuster
      if (player.population > player.maxPopulation) {
        player.population = player.maxPopulation;
      }
      
      // Informer le client que sa population maximale a été mise à jour
      this.clients.find(c => c.sessionId === building.owner)?.send('populationUpdate', {
        population: player.population,
        maxPopulation: player.maxPopulation
      });
      
      console.log(`Population maximale de ${building.owner} réduite à ${player.maxPopulation}`);
    }
    
    // Supprimer le bâtiment de l'état du jeu
    this.state.buildings.delete(buildingId);
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