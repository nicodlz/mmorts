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

import { 
  BUILDING_COSTS, 
  BuildingType, 
  PRODUCTION_RATES, 
  PRODUCTION_RECIPES, 
  RESOURCE_AMOUNTS, 
  RESOURCE_RESPAWN_TIMES,
  PERFORMANCE,
  UNIT_COSTS,
  COMBAT,
  DEATH_SYSTEM,
  PLAYER_STARTING_RESOURCES,
  HARVEST_AMOUNT
} from "shared";

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
  private readonly SIMULATION_INTERVAL = PERFORMANCE.SIMULATION_INTERVAL;
  private mapLines: string[] = [];
  private resourcesByChunk: Map<string, Set<string>> = new Map(); // Ressources par chunk
  
  // Stocker les ressources en dehors de l'état pour éviter la synchronisation automatique
  private resources: Map<string, ResourceSchema> = new Map();
  
  // Map pour stocker les informations de micro-mouvement des unités
  private unitMicroMovements: Map<string, { x: number, y: number, phase: number }> = new Map();
  
  // Ajouter des propriétés pour l'optimisation des broadcasts
  private playerUpdateRates: Map<string, { 
    lastFullUpdate: number,
    lastPositionUpdate: number
  }> = new Map();
  private readonly NEARBY_UPDATE_RATE = PERFORMANCE.NEARBY_UPDATE_RATE;
  private readonly DISTANT_UPDATE_RATE = PERFORMANCE.DISTANT_UPDATE_RATE;

  // Nouvelles propriétés pour les Interest Areas
  private playerVisibleChunks: Map<string, Set<string>> = new Map(); // Chunks visibles par joueur
  private readonly INTEREST_AREA_RADIUS = 1; // Rayon en chunks pour définir la zone d'intérêt (3×3 chunks)
  private readonly INTEREST_UPDATE_INTERVAL = 500; // Intervalle de mise à jour des zones d'intérêt en ms
  private lastInterestUpdate: number = 0; // Timestamp de la dernière mise à jour des zones d'intérêt
  private entityPositions: Map<string, {type: string, x: number, y: number}> = new Map(); // Position de toutes les entités
  private entitiesByChunk: Map<string, {players: Set<string>, units: Set<string>, buildings: Set<string>}> = new Map(); // Entités par chunk

  onCreate(options: { worldData: { mapLines: string[], resources: Map<string, ResourceSchema>, resourcesByChunk: Map<string, Set<string>> } }) {
    // Initialiser l'état du jeu
    this.setState(new GameState());
    
    console.log("GameRoom créée");
    
    // Si des données de monde sont fournies, les utiliser
    if (!options.worldData) {
      console.error("ERREUR: Données de monde manquantes");
      return;
    }
    
    this.mapLines = options.worldData.mapLines;
    this.resources = options.worldData.resources;
    this.resourcesByChunk = options.worldData.resourcesByChunk;
    
    console.log(`GameRoom initialisée avec ${this.resources.size} ressources dans ${this.resourcesByChunk.size} chunks`);
    
    // Configurer le filtrage des entités (Interest Areas)
    this.setupEntityFiltering();
    
    // Configurer l'intervalle de simulation
    // Utiliser la méthode setSimulationInterval pour définir un intervalle fixe
    this.setSimulationInterval((deltaTime) => this.update(), 16); // 60fps (1000/16)
    
    // S'assurer que la salle est persistante dès sa création
    this.setRoomPersistence(true);
    
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

    // Gestionnaire pour la création d'unités (soldats)
    this.onMessage("spawnUnit", (client, data) => {
      const { buildingId, unitType } = data;
      
      // Vérifier que le client est le propriétaire du bâtiment
      const building = this.state.buildings.get(buildingId);
      if (!building || building.owner !== client.sessionId) {
        console.log(`Le client ${client.sessionId} n'est pas autorisé à créer des unités dans le bâtiment ${buildingId}`);
        return;
      }
      
      // Vérifier que le bâtiment est une caserne
      if (building.type !== BuildingType.BARRACKS) {
        console.log(`Le bâtiment ${buildingId} n'est pas une caserne`);
        return;
      }
      
      // Obtenir le joueur
      const player = this.state.players.get(client.sessionId);
      if (!player) return;
      
      // Vérifier que le joueur a assez de ressources
      const goldCost = UNIT_COSTS.WARRIOR[ResourceType.GOLD];
      const ironCost = UNIT_COSTS.WARRIOR[ResourceType.IRON];
      
      if ((player.resources.get(ResourceType.GOLD) || 0) < goldCost || 
          (player.resources.get(ResourceType.IRON) || 0) < ironCost) {
        console.log(`Le joueur ${client.sessionId} n'a pas assez de ressources pour créer un soldat`);
        // Notifier le client que la création a échoué
        client.send("unitCreationFailed", {
          reason: "Ressources insuffisantes",
          required: {
            [ResourceType.GOLD]: goldCost,
            [ResourceType.IRON]: ironCost
          }
        });
        return;
      }
      
      // Vérifier la population
      if (player.population >= player.maxPopulation) {
        console.log(`Le joueur ${client.sessionId} a atteint sa limite de population`);
        client.send("unitCreationFailed", {
          reason: "Population maximale atteinte"
        });
        return;
      }
      
      // Déduire les ressources
      player.resources.set(ResourceType.GOLD, (player.resources.get(ResourceType.GOLD) || 0) - goldCost);
      player.resources.set(ResourceType.IRON, (player.resources.get(ResourceType.IRON) || 0) - ironCost);
      
      // Créer l'unité
      const unit = new UnitSchema();
      unit.id = `${unitType}_${client.sessionId}_${Date.now()}`;
      unit.type = unitType;
      unit.owner = client.sessionId;
      
      // Positionner l'unité près de la caserne en évitant les superpositions
      // Vérifier s'il y a déjà des unités près de la caserne
      const existingPositions: Array<{x: number, y: number}> = [];
      
      // Collecter les positions des unités existantes
      this.state.units.forEach((unit) => {
        if (Math.abs(unit.x - building.x) < TILE_SIZE * 3 && 
            Math.abs(unit.y - building.y) < TILE_SIZE * 3) {
          existingPositions.push({x: unit.x, y: unit.y});
        }
      });
      
      // Positions possibles autour de la caserne (8 directions)
      const positions = [
        { x: building.x + TILE_SIZE, y: building.y },              // droite
        { x: building.x - TILE_SIZE, y: building.y },              // gauche
        { x: building.x, y: building.y + TILE_SIZE },              // bas
        { x: building.x, y: building.y - TILE_SIZE },              // haut
        { x: building.x + TILE_SIZE, y: building.y + TILE_SIZE },  // bas-droite
        { x: building.x - TILE_SIZE, y: building.y + TILE_SIZE },  // bas-gauche
        { x: building.x + TILE_SIZE, y: building.y - TILE_SIZE },  // haut-droite
        { x: building.x - TILE_SIZE, y: building.y - TILE_SIZE }   // haut-gauche
      ];
      
      // Trouver une position libre
      let position = positions[0]; // Position par défaut
      
      for (const pos of positions) {
        // Vérifier si cette position est déjà occupée
        const isOccupied = existingPositions.some(existingPos => 
          Math.abs(existingPos.x - pos.x) < TILE_SIZE / 2 && 
          Math.abs(existingPos.y - pos.y) < TILE_SIZE / 2
        );
        
        if (!isOccupied) {
          position = pos;
          break;
        }
      }
      
      // Si toutes les positions sont occupées, ajouter un petit décalage aléatoire
      if (position === positions[0] && existingPositions.length > 0) {
        position.x += Math.random() * TILE_SIZE - TILE_SIZE / 2;
        position.y += Math.random() * TILE_SIZE - TILE_SIZE / 2;
      }
      
      unit.x = position.x;
      unit.y = position.y;
      
      // Ajouter l'unité à l'état du jeu
      this.state.units.set(unit.id, unit);
      
      // Augmenter la population du joueur
      player.population += 1;
      
      console.log(`Soldat créé: ${unit.id} pour le joueur ${client.sessionId}`);
      
      // Notifier le client que la création a réussi
      client.send("unitCreated", {
        unitId: unit.id,
        type: unitType,
        position: { x: unit.x, y: unit.y }
      });
    });

    // Gestionnaire pour la position du curseur en mode cible
    this.onMessage("targetCursorPosition", (client, data) => {
      const player = this.state.players.get(client.sessionId);
      if (!player) return;

      // Vérifier si le mode cible a changé
      const isTargetModeChanged = player.isTargetMode !== data.isTargetMode;

      // Mettre à jour les propriétés du joueur
      player.cursorTargetX = data.x;
      player.cursorTargetY = data.y;
      player.isTargetMode = data.isTargetMode;
      
      // N'afficher le message que si le mode a changé
      if (isTargetModeChanged) {
        console.log(`Mode cible de ${client.sessionId}: ${data.isTargetMode ? 'activé' : 'désactivé'} à (${data.x}, ${data.y})`);
      }
    });
    
    // Gestionnaire pour le déplacement des unités vers une cible
    this.onMessage("unitMoveTarget", (client, data) => {
      const player = this.state.players.get(client.sessionId);
      if (!player) return;
      
      // Mettre à jour les propriétés du joueur
      player.unitMoveTargetX = data.x;
      player.unitMoveTargetY = data.y;
      player.isMovingUnits = data.isMoving;
      
      console.log(`Déplacement des unités de ${client.sessionId}: ${data.isMoving ? 'activé' : 'désactivé'} vers (${data.x}, ${data.y})`);
    });
  }

  // Méthode pour définir la persistance de la salle
  private setRoomPersistence(persistent: boolean) {
    // Définir autoDispose à l'inverse de persistent
    this.autoDispose = !persistent;
    
    // Si la salle doit être persistante, augmenter aussi le temps de présence
    if (persistent) {
      // Configurer la salle pour qu'elle persiste même sans joueurs
      // Note: setPresentationDelay n'existe pas dans Colyseus, nous utilisons autoDispose
      // pour contrôler si la salle doit être détruite quand elle est vide
      
      console.log("La salle est configurée pour être persistante, même sans joueurs");
    } else {
      console.log("La salle sera automatiquement détruite quand elle sera vide");
    }
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
    
    // Utiliser les ressources de départ définies dans balance.ts
    Object.entries(PLAYER_STARTING_RESOURCES).forEach(([resource, amount]) => {
      player.resources.set(resource, amount);
    });
    
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
    
    // Initialiser les zones d'intérêt pour ce joueur
    this.initPlayerInterestArea(player, client.sessionId);
    
    // Envoyer uniquement les ressources dans les chunks proches du joueur
    // Ici on utilise directement la zone d'intérêt créée précédemment
    const visibleChunks = this.playerVisibleChunks.get(client.sessionId) || new Set<string>();
    const nearbyResources = this.getResourcesFromChunks([...visibleChunks]);
    console.log(`Envoi de ${nearbyResources.length} ressources au nouveau joueur (sur ${this.resources.size} au total)`);
    
    // Envoyer les données du joueur principal explicitement
    const playerResources = {};
    // Convertir les ressources en objet simple
    player.resources.forEach((value, key) => {
      playerResources[key] = value;
    });
    
    client.send("mainPlayerData", {
      id: client.sessionId,
      x: player.x,
      y: player.y,
      name: player.name,
      hue: player.hue,
      health: player.health,
      maxHealth: player.maxHealth,
      population: player.population,
      maxPopulation: player.maxPopulation,
      isDead: player.isDead,
      resources: playerResources
    });
    
    // Envoyer les ressources initiales au client
    client.send("initialResources", nearbyResources);
    
    // Envoyer les entités visibles initiales
    const visibleEntities = this.getEntitiesFromChunks([...visibleChunks]);
    client.send("initialEntities", visibleEntities);
    
    // Envoyer un message pour confirmer que l'initialisation est terminée
    client.send("initializationComplete", {
      timestamp: Date.now(),
      playerId: client.sessionId
    });
    
    // Informer les autres clients qu'un nouveau joueur a rejoint
    this.broadcast("playerJoined", {
      sessionId: client.sessionId,
      name: player.name,
      x: player.x,
      y: player.y,
      hue: player.hue
    }, { except: client });
  }

  // Initialiser la zone d'intérêt d'un joueur
  private initPlayerInterestArea(player: PlayerSchema, playerId: string) {
    const playerChunkX = Math.floor(player.x / (TILE_SIZE * CHUNK_SIZE));
    const playerChunkY = Math.floor(player.y / (TILE_SIZE * CHUNK_SIZE));
    
    // Créer un ensemble de chunks visibles
    const visibleChunks = new Set<string>();
    
    // Ajouter tous les chunks dans le rayon d'intérêt
    for (let dy = -this.INTEREST_AREA_RADIUS; dy <= this.INTEREST_AREA_RADIUS; dy++) {
      for (let dx = -this.INTEREST_AREA_RADIUS; dx <= this.INTEREST_AREA_RADIUS; dx++) {
        const chunkKey = `${playerChunkX + dx},${playerChunkY + dy}`;
        visibleChunks.add(chunkKey);
      }
    }
    
    // Stocker les chunks visibles pour ce joueur
    this.playerVisibleChunks.set(playerId, visibleChunks);
    
    console.log(`Zone d'intérêt initialisée pour ${playerId}: ${visibleChunks.size} chunks (grille de ${this.INTEREST_AREA_RADIUS * 2 + 1}×${this.INTEREST_AREA_RADIUS * 2 + 1})`);
    console.log(`Chunks visibles: [${Array.from(visibleChunks).join(', ')}]`);
  }

  // Joueur quitte la partie
  onLeave(client: Client, consented: boolean) {
    console.log(`Joueur ${client.sessionId} a quitté la partie`);
    
    // Supprimer le joueur
    this.state.players.delete(client.sessionId);
    
    // Annoncer aux autres clients que le joueur est parti
    this.broadcast("playerLeft", {
      sessionId: client.sessionId
    });
    
    // Supprimer toutes les unités appartenant au joueur
    this.removeAllUnitsFromPlayer(client.sessionId);
    
    // Supprimer les bâtiments appartenant au joueur (facultatif, peut être modifié selon la logique souhaitée)
    // Si vous voulez conserver les bâtiments des joueurs déconnectés, commentez ce bloc
    const buildingsToRemove: string[] = [];
    this.state.buildings.forEach((building, buildingId) => {
      if (building.owner === client.sessionId) {
        buildingsToRemove.push(buildingId);
      }
    });
    
    buildingsToRemove.forEach(buildingId => {
      this.handleDestroyBuilding(buildingId);
    });
    
    // Supprimer les informations du joueur du système de zones d'intérêt
    this.playerVisibleChunks.delete(client.sessionId);
    
    // Supprimer les taux de mise à jour du joueur
    this.playerUpdateRates.delete(client.sessionId);
    
    // IMPORTANT: Ne pas nettoyer les ressources de la carte
    // Elles doivent persister même si tous les joueurs sont déconnectés
    
    console.log(`Nettoyage des entités du joueur ${client.sessionId} terminé`);
    
    // Important: Empêcher la destruction de la salle même quand elle est vide
    // Cette ligne est cruciale pour conserver l'état du monde
    if (this.state.players.size === 0) {
      console.log("La salle est vide mais nous la conservons pour préserver les ressources du monde");
      this.autoDispose = false; // Empêcher Colyseus de disposer automatiquement de la salle
    }
  }

  // Nettoyage lors de la suppression de la room
  onDispose() {
    console.log("Libération des ressources de la room");
    
    // Ne pas nettoyer les ressources car nous voulons qu'elles persistent
    // même quand tous les joueurs sont déconnectés
    // this.resources.clear();
    // this.resourcesByChunk.clear();
    
    // Nettoyer seulement les entités dynamiques
    this.entitiesByChunk.clear();
    this.entityPositions.clear();
    
    console.log("Ressources de la room préservées, seules les entités dynamiques ont été nettoyées");
  }

  // Méthode appelée à chaque tick de simulation
  private update() {
    // Vérifier si la Room existe encore
    if (!this.state) return;
    
    const now = Date.now();

    // Mettre à jour les zones d'intérêt périodiquement
    if (now - this.lastInterestUpdate > this.INTEREST_UPDATE_INTERVAL) {
      this.updateInterestAreas();
      this.lastInterestUpdate = now;
    }
    
    // Gérer la production des bâtiments
    this.updateProduction();
    
    // Mettre à jour les positions des unités
    this.updateUnitPositions();
    
    // Mettre à jour le système de combat
    this.updateCombat();
    
    // Gérer le respawn des joueurs morts
    this.updatePlayerRespawn();
    
    // Envoyer uniquement les mises à jour aux joueurs qui ont besoin de les voir
    this.optimizeBroadcasts();
  }

  // Méthode pour gérer la production des bâtiments
  private updateProduction() {
    // Parcourir tous les bâtiments
    for (const [buildingId, building] of this.state.buildings.entries()) {
      // Vérifier si c'est un bâtiment de production
      if (PRODUCTION_RATES[building.type] && building.productionActive) {
        const player = this.state.players.get(building.owner);
        if (!player) continue;
        
        // Incrémenter la progression de la production, mais limiter les mises à jour
        const increment = (this.SIMULATION_INTERVAL / PRODUCTION_RATES[building.type]) * 100;
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
          const recipe = PRODUCTION_RECIPES[building.type];
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
      const client = this.clients.find(c => c.sessionId === sessionId);
      
      if (!client) return;
      
      // Récupérer les chunks visibles par ce joueur
      const visibleChunks = this.playerVisibleChunks.get(sessionId) || new Set<string>();
      
      // Mettre à jour les positions des joueurs visibles
      if (now - updateData.lastPositionUpdate > this.NEARBY_UPDATE_RATE) {
        const playerUpdates = [];
        
        // Collecter les joueurs visibles dans les chunks d'intérêt
        visibleChunks.forEach(chunkKey => {
          const chunk = this.entitiesByChunk.get(chunkKey);
          if (chunk) {
            chunk.players.forEach(otherPlayerId => {
              if (otherPlayerId !== sessionId) { // Ne pas inclure le joueur lui-même
                const otherPlayer = this.state.players.get(otherPlayerId);
                if (otherPlayer) {
                  playerUpdates.push({
                    sessionId: otherPlayerId,
                    x: otherPlayer.x,
                    y: otherPlayer.y
                  });
                }
              }
            });
          }
        });
        
        // Envoyer les mises à jour des positions des joueurs
        if (playerUpdates.length > 0) {
          client.send("playerPositions", { players: playerUpdates });
        }
        
        updateData.lastPositionUpdate = now;
      }
      
      // Mise à jour des unités - avec fréquence augmentée
      if (now - updateData.lastFullUpdate > 100) {
        // Collecter toutes les unités visibles par ce joueur
        const visibleUnits = [];
        
        // Les unités du joueur sont toujours visibles
        const playerOwnedUnits = Array.from(this.state.units.values())
          .filter(unit => unit.owner === sessionId);
        
        // Ajouter les unités dans les chunks visibles
        visibleChunks.forEach(chunkKey => {
          const chunk = this.entitiesByChunk.get(chunkKey);
          if (chunk) {
            chunk.units.forEach(unitId => {
              const unit = this.state.units.get(unitId);
              if (unit && unit.owner !== sessionId) { // Ne pas dupliquer les unités du joueur
                visibleUnits.push(unit);
              }
            });
          }
        });
        
        // Combiner les unités propres au joueur et les unités visibles
        const allVisibleUnits = [...playerOwnedUnits, ...visibleUnits];
        
        // Envoyer les mises à jour des unités au client
        if (allVisibleUnits.length > 0) {
          const unitUpdates = allVisibleUnits.map(unit => ({
            id: unit.id,
            x: unit.x,
            y: unit.y,
            owner: unit.owner,
            type: unit.type,
            health: unit.health,
            maxHealth: unit.maxHealth
          }));
          
          client.send("unitPositions", {
            units: unitUpdates
          });
          
          // Réduire la verbosité du log en n'affichant pas à chaque envoi
          if (Math.random() < 0.1) { // Log seulement 10% des envois
            console.log(`Envoi de ${unitUpdates.length} positions d'unités à ${sessionId}`);
          }
        }
        
        // Mettre à jour les bâtiments visibles
        const visibleBuildings = [];
        
        // Ajouter les bâtiments dans les chunks visibles
        visibleChunks.forEach(chunkKey => {
          const chunk = this.entitiesByChunk.get(chunkKey);
          if (chunk) {
            chunk.buildings.forEach(buildingId => {
              const building = this.state.buildings.get(buildingId);
              if (building) {
                visibleBuildings.push({
                  id: building.id,
                  type: building.type,
                  owner: building.owner,
                  x: building.x,
                  y: building.y,
                  health: building.health,
                  maxHealth: building.maxHealth,
                  productionProgress: building.productionProgress,
                  productionActive: building.productionActive
                });
              }
            });
          }
        });
        
        // Envoyer les mises à jour des bâtiments
        if (visibleBuildings.length > 0) {
          client.send("buildingUpdates", {
            buildings: visibleBuildings
          });
        }
        
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
          resource.amount = RESOURCE_AMOUNTS[resourceType];
          
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
    
    // Récupérer la quantité à récolter depuis balance.ts
    const harvestAmount = HARVEST_AMOUNT[resource.type as ResourceType] || 0;
    
    // Réduire la quantité de ressource disponible
    resource.amount = Math.max(0, resource.amount - harvestAmount);
    
    // Ajouter la ressource à l'inventaire du joueur
    // Initialiser les ressources du joueur si nécessaire
    if (!player.resources) {
      player.resources = new MapSchema<number>();
    }
    
    // Ajouter la ressource au joueur
    const currentAmount = player.resources.get(resource.type) || 0;
    player.resources.set(resource.type, currentAmount + harvestAmount);
    
    console.log(`Joueur ${client.sessionId} a récolté ${harvestAmount} ${resource.type}, total: ${currentAmount + harvestAmount}`);
    
    // Informer le client qui a récolté
    client.send("resourceUpdate", {
      resourceId,
      amount: resource.amount,
      playerId: client.sessionId,
      resourceType: resource.type,
      // Ajouter les ressources du joueur à la réponse
      playerResources: {
        [resource.type]: currentAmount + harvestAmount
      }
    });
    
    // Si la ressource est épuisée, planifier sa réapparition
    if (resource.amount <= 0) {
      resource.isRespawning = true;
      
      // Planifier la réapparition
      const respawnTime = RESOURCE_RESPAWN_TIMES[resource.type as ResourceType] || 60000;
      setTimeout(() => {
        if (this.resources.has(resourceId)) {
          resource.amount = RESOURCE_AMOUNTS[resource.type as ResourceType] || resource.maxAmount;
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
    if (PRODUCTION_RATES[type]) {
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
    
    // Ignorer les mouvements si le joueur est mort
    if (player.isDead) {
      console.log(`Mouvement ignoré pour le joueur ${client.sessionId} car il est mort`);
      return;
    }

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

  // Nouvelle méthode pour mettre à jour les positions des unités
  private updateUnitPositions() {
    // Pour chaque joueur
    this.state.players.forEach((player: PlayerSchema, playerId: string) => {
      // Trouver toutes les unités appartenant à ce joueur
      const playerUnits = Array.from(this.state.units.values())
        .filter((unit: UnitSchema) => unit.owner === playerId && unit.type === "warrior");
      
      if (playerUnits.length === 0) return;
      
      // Déterminer le mode de mouvement des unités
      if (player.isMovingUnits) {
        // Mode déplacement vers une cible
        // Activer le mode de ciblage par clic pour toutes les unités
        playerUnits.forEach(unit => {
          unit.isClickTargeting = true;
        });
        this.updateUnitsMoveTo(player, playerUnits);
      }
      else {
        // Si on n'est plus en mode déplacement par clic,
        // désactiver immédiatement le mode de ciblage pour toutes les unités
        playerUnits.forEach(unit => {
          unit.isClickTargeting = false;
        });
        
        if (player.isTargetMode) {
          // Mode cible (tab): formation en arcs face au curseur
          this.updateUnitsTargetMode(player, playerUnits);
        } else {
          // Mode normal: formation derrière le joueur
          this.updateUnitsFollowMode(player, playerUnits);
        }
      }
    });
  }
  
  // Formation en mode suivi normal (derrière le joueur)
  private updateUnitsFollowMode(player: PlayerSchema, playerUnits: UnitSchema[]) {
    const FOLLOW_DISTANCE = TILE_SIZE * 0.6; // Encore plus près du joueur
    const UNIT_SPACING = TILE_SIZE * 0.45; // Formations encore plus denses
    
    // Calculer les positions en formation plus naturelle
    playerUnits.forEach((unit: UnitSchema, index: number) => {
      // Utiliser une formation en demi-cercle plutôt qu'en grille pour un aspect plus naturel
      const unitCount = playerUnits.length;
      
      // Calculer l'angle pour chaque unité
      // Distribuer les unités sur un arc de cercle de 180 degrés derrière le joueur
      const angleStep = Math.PI / Math.max(unitCount - 1, 1);
      let angle = Math.PI / 2 - Math.PI / 2; // Commence à -90 degrés (quart inférieur gauche)
      
      if (unitCount > 1) {
        angle += angleStep * index;
      }
      
      // Rayon du cercle basé sur le nombre d'unités (plus d'unités = cercle légèrement plus grand)
      const radius = FOLLOW_DISTANCE + (Math.floor(index / 8) * UNIT_SPACING * 0.8);
      
      // Positions cibles relatives au joueur en utilisant des coordonnées polaires
      // Ajout d'une légère variation pour un aspect plus naturel
      const variationFactor = 0.15; // 15% de variation aléatoire
      const radiusVariation = (1 - variationFactor/2) + Math.random() * variationFactor;
      
      let targetX = player.x + Math.cos(angle) * radius * radiusVariation;
      let targetY = player.y + Math.sin(angle) * radius * radiusVariation;
      
      // Le reste du code existant pour le mouvement, la collision, etc.
      this.moveUnitToTarget(unit, targetX, targetY, playerUnits, index);
    });
  }
  
  // Nouvelle méthode: Formation en mode cible (devant le joueur, face au curseur)
  private updateUnitsTargetMode(player: PlayerSchema, playerUnits: UnitSchema[]) {
    const unitCount = playerUnits.length;
    
    // Calculer l'angle vers le curseur
    const angle = Math.atan2(player.cursorTargetY - player.y, player.cursorTargetX - player.x);
    
    // Paramètres de formation
    const ARC_WIDTH = Math.PI * 0.6; // Arc de 108 degrés (plus large que 90)
    const DISTANCE_FACTOR = TILE_SIZE * 0.8; // Distance de base depuis le joueur
    const UNITS_PER_ARC = 7; // Nombre maximum d'unités par arc
    
    // Déterminer le nombre d'arcs nécessaires
    const arcCount = Math.ceil(unitCount / UNITS_PER_ARC);
    
    // Distribuer les unités sur plusieurs arcs
    playerUnits.forEach((unit: UnitSchema, index: number) => {
      // Déterminer à quel arc appartient cette unité
      const arcIndex = Math.floor(index / UNITS_PER_ARC);
      const indexInArc = index % UNITS_PER_ARC;
      
      // Calculer le nombre d'unités dans cet arc particulier
      const unitsInThisArc = Math.min(UNITS_PER_ARC, unitCount - arcIndex * UNITS_PER_ARC);
      
      // Calculer l'angle de cette unité dans l'arc
      const arcStartAngle = angle - ARC_WIDTH / 2;
      const arcStepAngle = unitsInThisArc <= 1 ? 0 : ARC_WIDTH / (unitsInThisArc - 1);
      const unitAngle = arcStartAngle + arcStepAngle * indexInArc;
      
      // Distance de cet arc particulier (les arcs plus éloignés sont plus distants)
      const arcDistance = DISTANCE_FACTOR * (1 + arcIndex * 0.6);
      
      // Calculer la position cible
      let targetX = player.x + Math.cos(unitAngle) * arcDistance;
      let targetY = player.y + Math.sin(unitAngle) * arcDistance;
      
      // Ajouter un léger décalage aléatoire pour un aspect plus naturel
      const variationFactor = 0.1; // 10% de variation
      targetX += (Math.random() - 0.5) * TILE_SIZE * variationFactor;
      targetY += (Math.random() - 0.5) * TILE_SIZE * variationFactor;
      
      // Déplacer l'unité vers sa position cible
      this.moveUnitToTarget(unit, targetX, targetY, playerUnits, index);
    });
  }
  
  // Nouvelle méthode pour déplacer les unités vers une position cible spécifique
  private updateUnitsMoveTo(player: PlayerSchema, playerUnits: UnitSchema[]) {
    const unitCount = playerUnits.length;
    
    // Coordonnées de la cible
    const targetX = player.unitMoveTargetX;
    const targetY = player.unitMoveTargetY;
    
    // Distance entre les unités dans la formation carrée (réduite pour une formation très serrée)
    // Utiliser un écartement fixe qui ne dépend pas du nombre de soldats
    const UNIT_SPACING = TILE_SIZE * 0.25; // Très serrée, 25% de la taille d'une tuile
    
    // Calculer un point central pour les unités qui vont former un groupe autour
    const centerPoint = {
      x: targetX,
      y: targetY
    };
    
    // Vérifier si le groupe a atteint sa destination
    let allUnitsReachedTarget = true;
    
    // Organisation en formation carrée
    // Calculer le nombre d'unités par côté du carré
    const unitsPerSide = Math.ceil(Math.sqrt(unitCount));
    
    // Distribuer les unités en rangs et colonnes (formation carrée très serrée)
    playerUnits.forEach((unit: UnitSchema, index: number) => {
      // Calcul de la position dans la grille (ligne et colonne)
      const row = Math.floor(index / unitsPerSide);
      const col = index % unitsPerSide;
      
      // Centrer la formation autour du point central
      const offsetX = (col - (unitsPerSide - 1) / 2) * UNIT_SPACING;
      const offsetY = (row - (unitsPerSide - 1) / 2) * UNIT_SPACING;
      
      // Position cible finale - formation en rangs très serrés
      const finalTargetX = centerPoint.x + offsetX;
      const finalTargetY = centerPoint.y + offsetY;
      
      // Calculer la distance actuelle à la cible finale
      const distanceToTarget = Math.sqrt(
        Math.pow(finalTargetX - unit.x, 2) + 
        Math.pow(finalTargetY - unit.y, 2)
      );
      
      // Si l'unité est loin de sa cible, elle n'a pas atteint sa destination
      if (distanceToTarget > TILE_SIZE * 0.5) {
        allUnitsReachedTarget = false;
      }
      
      // Déplacer l'unité vers sa position finale
      this.moveUnitToTarget(unit, finalTargetX, finalTargetY, playerUnits, index);
    });
    
    // Si toutes les unités ont atteint leur cible, on peut éventuellement notifier le client
    if (allUnitsReachedTarget) {
      // Notifier le client que les unités sont arrivées (pas besoin de désactiver isClickTargeting ici)
      const client = this.clients.find(c => c.sessionId === player.id);
      if (client) {
        client.send("unitsReachedTarget", { success: true });
      }
    }
  }

  // Méthode commune pour déplacer une unité vers sa cible en évitant les obstacles
  private moveUnitToTarget(unit: UnitSchema, targetX: number, targetY: number, allUnits: UnitSchema[], unitIndex: number) {
    // Éviter que les unités ne se superposent
    const isTooClose = allUnits.some((otherUnit: UnitSchema, otherIndex: number) => {
      if (otherIndex >= unitIndex) return false; // Ne pas comparer avec les unités qui n'ont pas encore été positionnées
      
      const dx = targetX - otherUnit.x;
      const dy = targetY - otherUnit.y;
      const distance = Math.sqrt(dx * dx + dy * dy);
      
      return distance < TILE_SIZE * 0.2; // Permettre une proximité encore plus grande (20% de la taille d'une tuile)
    });
    
    // Si l'unité est trop proche d'une autre, ajuster légèrement sa position
    if (isTooClose) {
      targetX += (Math.random() - 0.5) * TILE_SIZE * 0.2;
      targetY += (Math.random() - 0.5) * TILE_SIZE * 0.2;
    }
    
    // Vérifier si la position cible est valide (pas sur un mur ou une ressource)
    if (!this.isValidPosition(targetX, targetY)) {
      // Si la position n'est pas valide, essayer de trouver une position valide à proximité
      let validPositionFound = false;
      
      // Essayer jusqu'à 8 positions autour du joueur
      const angles = [0, Math.PI/4, Math.PI/2, 3*Math.PI/4, Math.PI, 5*Math.PI/4, 3*Math.PI/2, 7*Math.PI/4];
      
      for (let i = 0; i < angles.length; i++) {
        const testAngle = angles[i];
        const testRadius = TILE_SIZE * 1.1; // Légèrement plus loin
        const testX = targetX + Math.cos(testAngle) * testRadius;
        const testY = targetY + Math.sin(testAngle) * testRadius;
        
        if (this.isValidPosition(testX, testY)) {
          targetX = testX;
          targetY = testY;
          validPositionFound = true;
          break;
        }
      }
      
      // Si aucune position valide n'est trouvée, essayer des distances plus grandes
      if (!validPositionFound) {
        for (let extraRadius = 1.2; extraRadius <= 2.0; extraRadius += 0.2) {
          for (let i = 0; i < angles.length; i++) {
            const testAngle = angles[i];
            const testRadius = TILE_SIZE * extraRadius;
            const testX = targetX + Math.cos(testAngle) * testRadius;
            const testY = targetY + Math.sin(testAngle) * testRadius;
            
            if (this.isValidPosition(testX, testY)) {
              targetX = testX;
              targetY = testY;
              validPositionFound = true;
              break;
            }
          }
          
          if (validPositionFound) break;
        }
      }
      
      // En dernier recours, si aucune position valide n'est trouvée, garder la position actuelle
      if (!validPositionFound) {
        targetX = unit.x;
        targetY = unit.y;
      }
    }
    
    // Ajouter un micro-mouvement réduit pour un aspect vivant mais stable
    if (!this.unitMicroMovements.has(unit.id)) {
      this.unitMicroMovements.set(unit.id, {
        x: (Math.random() - 0.5) * TILE_SIZE * 0.1,
        y: (Math.random() - 0.5) * TILE_SIZE * 0.1,
        phase: Math.random() * Math.PI * 2
      });
    }
    
    // Récupérer les informations de micro-mouvement pour cette unité
    const microMovement = this.unitMicroMovements.get(unit.id);
    
    // Appliquer un micro-mouvement sinusoïdal avec une période unique pour chaque unité
    // Ralentir la fréquence du micro-mouvement pour plus de stabilité
    const time = Date.now() / 1000;
    
    let microX = 0;
    let microY = 0;
    
    // Vérifier que microMovement existe avant de l'utiliser
    if (microMovement) {
      microX = Math.sin(time * 0.3 + microMovement.phase) * microMovement.x;
      microY = Math.cos(time * 0.4 + microMovement.phase) * microMovement.y;
    }
    
    // Vérifier que la position avec micro-mouvement est valide
    const newTargetX = targetX + microX;
    const newTargetY = targetY + microY;
    
    // N'appliquer le micro-mouvement que si la nouvelle position est valide
    if (this.isValidPosition(newTargetX, newTargetY)) {
      targetX = newTargetX;
      targetY = newTargetY;
    }
    
    // Déplacer l'unité vers sa position cible avec un effet de lissage
    const distanceToTarget = Math.sqrt(
      Math.pow(targetX - unit.x, 2) + 
      Math.pow(targetY - unit.y, 2)
    );
    
    let newX, newY;
    
    // Vérifier si l'unité est en mode de ciblage par clic (déplacement vers point cliqué)
    if (unit.isClickTargeting) {
      // Approche de VITESSE CONSTANTE (pas de facteur)
      // Utiliser un déplacement fixe en pixels par frame au lieu d'un pourcentage de la distance
      
      // Vitesse constante en pixels par frame, indépendante de la distance
      // Vitesse de 3 pixels par frame
      const FIXED_MOVEMENT_SPEED = 3.0; // pixels par frame
      
      // Si la distance est inférieure à la vitesse fixe, on arrive directement à destination
      if (distanceToTarget <= FIXED_MOVEMENT_SPEED) {
        newX = targetX;
        newY = targetY;
      } else {
        // Sinon, calculer le vecteur de direction normalisé
        const dirX = (targetX - unit.x) / distanceToTarget;
        const dirY = (targetY - unit.y) / distanceToTarget;
        
        // Appliquer la vitesse constante dans la direction calculée
        newX = unit.x + dirX * FIXED_MOVEMENT_SPEED;
        newY = unit.y + dirY * FIXED_MOVEMENT_SPEED;
      }
    } else {
      // Pour les autres modes (suivi normal, mode cible), conserver le comportement original
      // Vitesse de base et vitesse max
      const BASE_SPEED = 0.3;
      const MAX_SPEED = 0.8;
      
      // Déterminer le facteur de vitesse en fonction de la distance
      let speedFactor = BASE_SPEED;
      
      // Augmenter la vitesse en fonction de la distance
      if (distanceToTarget > TILE_SIZE) {
        // Calculer un facteur entre 0 et 1 basé sur la distance
        const distanceFactor = Math.min((distanceToTarget - TILE_SIZE) / (TILE_SIZE * 2), 1);
        
        // Appliquer une fonction d'easing pour une transition plus lisse
        const easedFactor = distanceFactor * distanceFactor; // Fonction quadratique simple
        
        // Interpoler entre la vitesse de base et la vitesse max
        speedFactor = BASE_SPEED + easedFactor * (MAX_SPEED - BASE_SPEED);
      }
      
      // Calculer la nouvelle position avec le facteur de vitesse
      newX = unit.x + (targetX - unit.x) * speedFactor;
      newY = unit.y + (targetY - unit.y) * speedFactor;
    }
    
    // Vérifier que la nouvelle position est valide
    if (this.isValidPosition(newX, newY)) {
      // Appliquer le mouvement uniquement si la destination est valide
      unit.x = newX;
      unit.y = newY;
    }
  }

  // Nouvelle méthode pour vérifier si une position est valide pour les unités
  private isValidPosition(x: number, y: number): boolean {
    // 1. Convertir en coordonnées de tuile
    const tileX = Math.floor(x / TILE_SIZE);
    const tileY = Math.floor(y / TILE_SIZE);
    
    // 2. Vérifier les murs
    if (tileY < 0 || tileX < 0 || tileY >= this.mapLines.length || tileX >= this.mapLines[0].length) {
      return false; // En dehors de la carte
    }
    
    // Si c'est un mur (#), la position n'est pas valide
    if (this.mapLines[tileY][tileX] === '#') {
      return false;
    }
    
    // 3. Vérifier les ressources - augmenter le rayon de recherche pour s'assurer de trouver toutes les ressources pertinentes
    const nearbyResources = this.getResourcesInRange(x, y, 1); // Augmenté de 0.5 à 1 chunk
    for (const resourceId of nearbyResources) {
      const resource = this.resources.get(resourceId);
      if (resource && resource.amount > 0) {  // Ignorer les ressources avec une quantité de 0
        // Déterminer un rayon de collision basé sur le type de ressource
        let collisionRadius = TILE_SIZE * 0.8; // Rayon de base augmenté
        
        // Ajuster le rayon selon le type de ressource
        switch (resource.type) {
          case ResourceType.WOOD:
            // Les arbres ont un rayon plus grand
            collisionRadius = TILE_SIZE * 1.2;
            break;
          case ResourceType.STONE:
            // Les pierres ont un rayon moyen
            collisionRadius = TILE_SIZE * 1.0;
            break;
          case ResourceType.GOLD:
            // L'or a un rayon standard
            collisionRadius = TILE_SIZE * 0.9;
            break;
          default:
            // Autres ressources, rayon standard
            collisionRadius = TILE_SIZE * 0.8;
        }
        
        // Calcul de distance entre la position et le centre de la ressource
        const dx = x - resource.x;
        const dy = y - resource.y;
        const distance = Math.sqrt(dx * dx + dy * dy);
        
        // Si la distance est inférieure au rayon de collision, la position n'est pas valide
        if (distance < collisionRadius) {
          return false;
        }
      }
    }
    
    // 4. Vérifier les bâtiments
    for (const [_, building] of this.state.buildings.entries()) {
      // Calcul de distance entre la position et le centre du bâtiment
      const buildingCenterX = building.x + TILE_SIZE/2;
      const buildingCenterY = building.y + TILE_SIZE/2;
      const dx = x - buildingCenterX;
      const dy = y - buildingCenterY;
      const distance = Math.sqrt(dx * dx + dy * dy);
      
      // Si la distance est inférieure au rayon de collision, la position n'est pas valide
      if (distance < TILE_SIZE * 0.8) {
        return false;
      }
    }
    
    // Si toutes les vérifications sont passées, la position est valide
    return true;
  }

  // Nouvelle méthode pour gérer le respawn des joueurs
  private updatePlayerRespawn() {
    const now = Date.now();
    this.state.players.forEach((player, playerId) => {
      // Vérifier si le joueur est mort et si le temps de respawn est passé
      if (player.isDead && now >= player.respawnTime) {
        console.log(`Respawning player ${playerId}`); // Log pour déboguer
        
        // Réinitialiser le joueur
        player.isDead = false;
        player.health = player.maxHealth;
        player.isInvulnerable = true;
        
        // Utiliser les mêmes coordonnées de spawn que lors de l'initialisation (onJoin)
        const spawnX = 10;
        const spawnY = 12;
        player.x = spawnX * TILE_SIZE;
        player.y = spawnY * TILE_SIZE;
        
        console.log(`Position de respawn définie : (${player.x}, ${player.y})`);
        
        // Notifier le client du respawn
        const client = this.clients.find(c => c.sessionId === playerId);
        if (client) {
          client.send("playerRespawned", {
            x: player.x,
            y: player.y,
            health: player.health,
            maxHealth: player.maxHealth
          });
        }
        
        // Notifier tous les autres clients qu'un joueur a réapparu
        this.broadcast("otherPlayerRespawned", {
          sessionId: playerId,
          x: player.x,
          y: player.y
        }, { except: client });
        
        // Planifier la fin de l'invulnérabilité
        setTimeout(() => {
          if (this.state.players.has(playerId)) {
            const p = this.state.players.get(playerId);
            if (p) p.isInvulnerable = false;
          }
        }, 2000); // 2 secondes d'invulnérabilité
      }
    });
  }

  // Nouvelle méthode pour gérer le combat
  private updateCombat() {
    const now = Date.now();
    const allUnits = Array.from(this.state.units.values());
    const allPlayers = Array.from(this.state.players.entries());
    
    // Créer une grille spatiale pour optimiser la détection de proximité
    const GRID_SIZE = 100; // Taille de la cellule de la grille
    const spatialGrid = new Map<string, UnitSchema[]>();
    
    // Ajouter toutes les unités à la grille spatiale
    allUnits.forEach(unit => {
      const gridX = Math.floor(unit.x / GRID_SIZE);
      const gridY = Math.floor(unit.y / GRID_SIZE);
      const gridKey = `${gridX},${gridY}`;
      
      if (!spatialGrid.has(gridKey)) {
        spatialGrid.set(gridKey, []);
      }
      
      spatialGrid.get(gridKey)?.push(unit);
    });
    
    // Vérifier les combats potentiels pour chaque cellule de la grille
    for (const [gridKey, unitsInCell] of spatialGrid.entries()) {
      for (const attacker of unitsInCell) {
        // Ignorer les unités qui ne sont pas des guerriers
        if (attacker.type !== "warrior") continue;
        
        // Vérifier le cooldown d'attaque
        if (now - attacker.lastAttackTime < COMBAT.ATTACK_COOLDOWN) continue;
        
        // Vérifier si l'unité peut attaquer d'autres unités dans la même cellule
        for (const target of unitsInCell) {
          // Ne pas s'attaquer soi-même ou aux unités du même propriétaire
          if (target.id === attacker.id || target.owner === attacker.owner) continue;
          
          // Calculer la distance
          const distance = Math.sqrt(
            Math.pow(attacker.x - target.x, 2) + 
            Math.pow(attacker.y - target.y, 2)
          );
          
          // Vérifier si la cible est à portée d'attaque
          if (distance <= COMBAT.ATTACK_RANGE) {
            // L'unité attaque cette cible
            this.performAttack(attacker, target, now);
            // Une seule attaque par tick
            break;
          }
        }
        
        // Vérifier si l'unité peut attaquer un joueur
        let hasAttackedPlayer = false;
        allPlayers.forEach(([playerId, player]) => {
          // Ne pas attaquer son propre joueur
          if (attacker.owner === playerId || hasAttackedPlayer) return;
          
          // Ne pas attaquer les joueurs invulnérables ou morts
          if (player.isInvulnerable || player.isDead) return;
          
          // Calculer la distance au joueur
          const distance = Math.sqrt(
            Math.pow(attacker.x - player.x, 2) + 
            Math.pow(attacker.y - player.y, 2)
          );
          
          // Vérifier si le joueur est à portée d'attaque
          if (distance <= COMBAT.ATTACK_RANGE) {
            // L'unité attaque le joueur
            this.performPlayerAttack(attacker, player, playerId, now);
            hasAttackedPlayer = true; // Marquer qu'une attaque a été effectuée
          }
        });
      }
    }
  }
  
  // Méthode pour gérer une attaque entre unités
  private performAttack(attacker: UnitSchema, target: UnitSchema, now: number) {
    // Mettre à jour le temps de la dernière attaque
    attacker.lastAttackTime = now;
    attacker.attackTarget = target.id;
    
    // Calculer les dégâts de base avec une légère variation aléatoire
    const baseDamage = attacker.damage * (1 - COMBAT.DAMAGE_RANDOM_VARIATION + Math.random() * COMBAT.DAMAGE_RANDOM_VARIATION * 2);
    
    // Vérifier si la cible est en position défensive
    const targetOwner = this.state.players.get(target.owner);
    let finalDamage = baseDamage;
    
    // Appliquer le bonus défensif si conditions remplies
    if (targetOwner && targetOwner.isTargetMode && !targetOwner.isMovingUnits) {
      finalDamage *= (1 - COMBAT.DEFENSIVE_MODE_REDUCTION);
    }
    
    // Arrondir les dégâts
    finalDamage = Math.round(finalDamage);
    
    // Appliquer les dégâts
    target.health -= finalDamage;
    
    // Limiter à 0 minimum
    if (target.health < 0) target.health = 0;
    
    // Vérifier si l'unité est morte
    if (target.health <= 0) {
      // Supprimer l'unité
      this.state.units.delete(target.id);
      
      // Mettre à jour la population du joueur
      if (targetOwner) {
        targetOwner.population -= 1; // Réduire la population
      }
      
      // Notifier le client
      const client = this.clients.find(c => c.sessionId === target.owner);
      if (client) {
        client.send("unitKilled", {
          unitId: target.id,
          killedBy: attacker.owner
        });
      }
      
      // Notifier aussi l'attaquant
      const attackerClient = this.clients.find(c => c.sessionId === attacker.owner);
      if (attackerClient) {
        attackerClient.send("unitKilledEnemy", {
          unitId: attacker.id,
          enemyId: target.id
        });
      }
    } else {
      // Notifier les clients des dégâts (seulement s'ils ne sont pas morts)
      const client = this.clients.find(c => c.sessionId === target.owner);
      if (client) {
        client.send("unitDamaged", {
          unitId: target.id,
          damage: finalDamage,
          health: target.health,
          maxHealth: target.maxHealth,
          attackerId: attacker.id
        });
      }
    }
  }
  
  // Méthode pour gérer une attaque sur un joueur
  private performPlayerAttack(attacker: UnitSchema, player: PlayerSchema, playerId: string, now: number) {
    console.log(`Attaque sur joueur ${playerId} - Santé avant: ${player.health}/${player.maxHealth}`);
    
    // Mettre à jour le temps de la dernière attaque
    attacker.lastAttackTime = now;
    
    // Les dégâts contre le joueur sont légèrement réduits
    const baseDamage = attacker.damage * (1 - COMBAT.PLAYER_DAMAGE_REDUCTION) * (1 - COMBAT.DAMAGE_RANDOM_VARIATION + Math.random() * COMBAT.DAMAGE_RANDOM_VARIATION * 2);
    
    // Appliquer le bonus défensif si conditions remplies
    let finalDamage = baseDamage;
    if (player.isTargetMode && !player.isMovingUnits) {
      finalDamage *= (1 - COMBAT.DEFENSIVE_MODE_REDUCTION);
    }
    
    // Arrondir les dégâts
    finalDamage = Math.round(finalDamage);
    console.log(`Dégâts calculés: ${finalDamage}`);
    
    // Appliquer les dégâts
    player.health -= finalDamage;
    
    // Limiter à 0 minimum
    if (player.health < 0) player.health = 0;
    
    console.log(`Santé après attaque: ${player.health}/${player.maxHealth}`);
    
    // Notifier le joueur des dégâts
    const client = this.clients.find(c => c.sessionId === playerId);
    if (client) {
      client.send("playerDamaged", {
        damage: finalDamage,
        health: player.health,
        maxHealth: player.maxHealth,
        attackerId: attacker.id
      });
    } else {
      console.log(`Client non trouvé pour le joueur ${playerId}`);
    }
    
    // Vérifier si le joueur est mort
    if (player.health <= 0 && !player.isDead) {
      console.log(`Le joueur ${playerId} est mort`);
      // Marquer le joueur comme mort
      player.isDead = true;
      player.deathTime = now;
      
      const respawnDelayMs = DEATH_SYSTEM.PLAYER_RESPAWN_TIME;
      player.respawnTime = now + respawnDelayMs;
      
      // Faire tomber une partie des ressources
      const droppedResources = {};
      for (const [resourceType, amount] of Object.entries(player.resources)) {
        const amountToDrop = Math.floor(Number(amount) * DEATH_SYSTEM.RESOURCE_LOSS_PERCENT);
        if (amountToDrop > 0) {
          droppedResources[resourceType] = amountToDrop;
          player.resources[resourceType] -= amountToDrop;
        }
      }
      
      // Créer un drop de ressources sur la position du joueur
      // Ceci est une simplification, vous pourriez vouloir créer des entités de ressources réelles
      
      // Notifier le joueur de sa mort
      if (client) {
        client.send("playerDied", {
          respawnTimeMs: respawnDelayMs, // Envoyer la durée plutôt que le timestamp
          killedBy: attacker.owner
        });
      }
      
      // Notifier tous les autres clients qu'un joueur est mort pour mettre à jour les visuels
      this.broadcast("otherPlayerDied", {
        sessionId: playerId,
        killedBy: attacker.owner
      }, { except: client });
      
      // Notifier le tueur
      const killerClient = this.clients.find(c => c.sessionId === attacker.owner);
      if (killerClient) {
        killerClient.send("killedPlayer", {
          victimId: playerId,
          unitId: attacker.id
        });
      }
      
      // Supprimer toutes les unités appartenant au joueur mort
      this.removeAllUnitsFromPlayer(playerId);
    }
  }

  // Méthode pour supprimer toutes les unités d'un joueur
  private removeAllUnitsFromPlayer(playerId: string) {
    console.log(`Suppression de toutes les unités du joueur ${playerId}`);
    
    // Trouver toutes les unités appartenant au joueur
    const unitsToRemove: string[] = [];
    
    this.state.units.forEach((unit, unitId) => {
      if (unit.owner === playerId) {
        unitsToRemove.push(unitId);
      }
    });
    
    // Supprimer les unités
    unitsToRemove.forEach(unitId => {
      console.log(`Suppression de l'unité ${unitId}`);
      this.state.units.delete(unitId);
      
      // Notifier tous les clients pour qu'ils suppriment le visuel de cette unité
      this.broadcast("unitKilled", {
        unitId: unitId,
        killedBy: "death" // Spécifier qu'elles sont mortes à cause de la mort du joueur
      });
    });
    
    console.log(`${unitsToRemove.length} unités ont été supprimées`);
  }

  // Méthode pour mettre à jour les zones d'intérêt des joueurs
  private updateInterestAreas() {
    // Mettre à jour les positions de toutes les entités
    this.updateEntityPositions();

    // Mettre à jour les entités par chunk
    this.updateEntitiesByChunk();

    // Pour chaque joueur, mettre à jour sa zone d'intérêt
    this.state.players.forEach((player, playerId) => {
      this.updatePlayerInterestArea(player, playerId);
    });
  }

  // Mettre à jour les positions de toutes les entités
  private updateEntityPositions() {
    // Vider la map actuelle pour éviter les entités obsolètes
    this.entityPositions.clear();

    // Enregistrer les positions des joueurs
    this.state.players.forEach((player, playerId) => {
      this.entityPositions.set(playerId, {
        type: 'player',
        x: player.x,
        y: player.y
      });
    });

    // Enregistrer les positions des unités
    this.state.units.forEach((unit, unitId) => {
      this.entityPositions.set(unitId, {
        type: 'unit',
        x: unit.x,
        y: unit.y
      });
    });

    // Enregistrer les positions des bâtiments
    this.state.buildings.forEach((building, buildingId) => {
      this.entityPositions.set(buildingId, {
        type: 'building',
        x: building.x,
        y: building.y
      });
    });
  }

  // Mettre à jour les entités par chunk
  private updateEntitiesByChunk() {
    // Vider la map actuelle
    this.entitiesByChunk.clear();

    // Pour chaque entité, déterminer son chunk et l'ajouter à la map
    this.entityPositions.forEach((entity, entityId) => {
      const chunkX = Math.floor(entity.x / (TILE_SIZE * CHUNK_SIZE));
      const chunkY = Math.floor(entity.y / (TILE_SIZE * CHUNK_SIZE));
      const chunkKey = `${chunkX},${chunkY}`;

      // Initialiser le chunk s'il n'existe pas encore
      if (!this.entitiesByChunk.has(chunkKey)) {
        this.entitiesByChunk.set(chunkKey, {
          players: new Set<string>(),
          units: new Set<string>(),
          buildings: new Set<string>()
        });
      }

      // Ajouter l'entité au chunk correspondant
      const chunk = this.entitiesByChunk.get(chunkKey)!;
      if (entity.type === 'player') {
        chunk.players.add(entityId);
      } else if (entity.type === 'unit') {
        chunk.units.add(entityId);
      } else if (entity.type === 'building') {
        chunk.buildings.add(entityId);
      }
    });
  }

  // Mettre à jour la zone d'intérêt d'un joueur
  private updatePlayerInterestArea(player: PlayerSchema, playerId: string) {
    const playerChunkX = Math.floor(player.x / (TILE_SIZE * CHUNK_SIZE));
    const playerChunkY = Math.floor(player.y / (TILE_SIZE * CHUNK_SIZE));
    
    // Créer un nouvel ensemble de chunks visibles
    const visibleChunks = new Set<string>();
    
    // Ajouter tous les chunks dans le rayon d'intérêt
    for (let dy = -this.INTEREST_AREA_RADIUS; dy <= this.INTEREST_AREA_RADIUS; dy++) {
      for (let dx = -this.INTEREST_AREA_RADIUS; dx <= this.INTEREST_AREA_RADIUS; dx++) {
        const chunkKey = `${playerChunkX + dx},${playerChunkY + dy}`;
        visibleChunks.add(chunkKey);
      }
    }
    
    // Récupérer l'ancien ensemble de chunks visibles
    const previousChunks = this.playerVisibleChunks.get(playerId) || new Set<string>();
    
    // Déterminer les nouveaux chunks (entrée dans la zone d'intérêt)
    const newChunks = [...visibleChunks].filter(chunk => !previousChunks.has(chunk));
    
    // Déterminer les chunks qui ne sont plus visibles (sortie de la zone d'intérêt)
    const removedChunks = [...previousChunks].filter(chunk => !visibleChunks.has(chunk));
    
    // Si des changements ont eu lieu, envoyer les mises à jour au client
    if (newChunks.length > 0 || removedChunks.length > 0) {
      console.log(`Zone d'intérêt mise à jour pour ${playerId}: ${visibleChunks.size} chunks (${newChunks.length} ajoutés, ${removedChunks.length} supprimés)`);
      if (newChunks.length > 0) console.log(`Nouveaux chunks: [${newChunks.join(', ')}]`);
      if (removedChunks.length > 0) console.log(`Chunks supprimés: [${removedChunks.join(', ')}]`);
      
      const client = this.clients.find(c => c.sessionId === playerId);
      if (client) {
        // Notifier les nouveaux chunks visibles
        if (newChunks.length > 0) {
          // Collecter les ressources des nouveaux chunks
          const newResources = this.getResourcesFromChunks(newChunks);
          
          // Collecter les entités des nouveaux chunks
          const newEntities = this.getEntitiesFromChunks(newChunks);
          
          // Envoyer les nouvelles entités visibles
          client.send("visibleChunksUpdated", {
            added: newChunks,
            removed: removedChunks,
            resources: newResources,
            entities: newEntities
          });
        } else {
          // Juste notifier les chunks qui ne sont plus visibles
          client.send("visibleChunksUpdated", {
            added: [],
            removed: removedChunks
          });
        }
      }
    }
    
    // Mettre à jour les chunks visibles pour ce joueur
    this.playerVisibleChunks.set(playerId, visibleChunks);
  }

  // Récupérer les ressources à partir d'une liste de chunks
  private getResourcesFromChunks(chunks: string[]): any[] {
    const resources: any[] = [];
    
    chunks.forEach(chunkKey => {
      const chunkResources = this.resourcesByChunk.get(chunkKey);
      if (chunkResources) {
        chunkResources.forEach(resourceId => {
          const resource = this.resources.get(resourceId);
          if (resource) {
            resources.push({
              id: resource.id,
              type: resource.type,
              x: resource.x,
              y: resource.y,
              amount: resource.amount
            });
          }
        });
      }
    });
    
    return resources;
  }

  // Récupérer les entités à partir d'une liste de chunks
  private getEntitiesFromChunks(chunks: string[]): any {
    const entities = {
      players: [],
      units: [],
      buildings: []
    };
    
    chunks.forEach(chunkKey => {
      const chunk = this.entitiesByChunk.get(chunkKey);
      if (chunk) {
        // Récupérer les joueurs
        chunk.players.forEach(playerId => {
          const player = this.state.players.get(playerId);
          if (player) {
            entities.players.push({
              id: playerId,
              name: player.name,
              x: player.x,
              y: player.y,
              hue: player.hue
            });
          }
        });
        
        // Récupérer les unités
        chunk.units.forEach(unitId => {
          const unit = this.state.units.get(unitId);
          if (unit) {
            entities.units.push({
              id: unitId,
              type: unit.type,
              owner: unit.owner,
              x: unit.x,
              y: unit.y,
              health: unit.health,
              maxHealth: unit.maxHealth
            });
          }
        });
        
        // Récupérer les bâtiments
        chunk.buildings.forEach(buildingId => {
          const building = this.state.buildings.get(buildingId);
          if (building) {
            entities.buildings.push({
              id: buildingId,
              type: building.type,
              owner: building.owner,
              x: building.x,
              y: building.y,
              health: building.health,
              maxHealth: building.maxHealth,
              productionProgress: building.productionProgress,
              productionActive: building.productionActive
            });
          }
        });
      }
    });
    
    return entities;
  }

  // Configurer le filtrage des entités basé sur les zones d'intérêt
  private setupEntityFiltering() {
    console.log("Configuration du filtrage des entités basé sur les zones d'intérêt...");
    
    // Dans Colyseus, nous devons configurer le filtrage au niveau du schéma
    // en utilisant la méthode onFilterSchema
    this.state.players.onAdd = (player, sessionId) => {
      console.log(`Joueur ajouté à l'état: ${sessionId}`);
      player.onChange = (changes) => {
        // Notifier uniquement les clients qui sont dans la zone d'intérêt
        this.clients.forEach(client => {
          if (client.sessionId === sessionId || this.isEntityInClientView(client.sessionId, 'player', sessionId)) {
            this.broadcast("playerUpdate", {
              id: sessionId,
              changes: changes.map(change => ({
                field: change.field,
                value: change.value
              }))
            }, { clients: [client] });
          }
        });
      };
    };
    
    this.state.units.onAdd = (unit, unitId) => {
      console.log(`Unité ajoutée à l'état: ${unitId}`);
      unit.onChange = (changes) => {
        // Notifier uniquement les clients qui sont dans la zone d'intérêt
        // ou qui sont propriétaires de l'unité
        this.clients.forEach(client => {
          if (unit.owner === client.sessionId || this.isEntityInClientView(client.sessionId, 'unit', unitId)) {
            this.broadcast("unitUpdate", {
              id: unitId,
              changes: changes.map(change => ({
                field: change.field,
                value: change.value
              }))
            }, { clients: [client] });
          }
        });
      };
    };
    
    this.state.buildings.onAdd = (building, buildingId) => {
      console.log(`Bâtiment ajouté à l'état: ${buildingId}`);
      building.onChange = (changes) => {
        // Notifier uniquement les clients qui sont dans la zone d'intérêt
        // ou qui sont propriétaires du bâtiment
        this.clients.forEach(client => {
          if (building.owner === client.sessionId || this.isEntityInClientView(client.sessionId, 'building', buildingId)) {
            this.broadcast("buildingUpdate", {
              id: buildingId,
              changes: changes.map(change => ({
                field: change.field,
                value: change.value
              }))
            }, { clients: [client] });
          }
        });
      };
    };
    
    console.log("Filtrage des entités configuré avec succès.");
  }
  
  // Vérifier si une entité est dans la vue d'un client
  private isEntityInClientView(clientId: string, entityType: string, entityId: string): boolean {
    // Récupérer les chunks visibles par le client
    const visibleChunks = this.playerVisibleChunks.get(clientId) || new Set<string>();
    
    // Récupérer la position de l'entité
    const entityPosition = this.entityPositions.get(entityId);
    if (!entityPosition) return false;
    
    // Calculer le chunk de l'entité
    const entityChunkX = Math.floor(entityPosition.x / (TILE_SIZE * CHUNK_SIZE));
    const entityChunkY = Math.floor(entityPosition.y / (TILE_SIZE * CHUNK_SIZE));
    const entityChunkKey = `${entityChunkX},${entityChunkY}`;
    
    // Vérifier si le chunk de l'entité est visible par le client
    return visibleChunks.has(entityChunkKey);
  }
} 