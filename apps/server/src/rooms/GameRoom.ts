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
  UnitType,
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
  HARVEST_AMOUNT,
  UnitState
} from "shared";

// Interfaces pour les données envoyées au client
interface PlayerClientInfo {
  id: string;
  name: string;
  x: number;
  y: number;
  hue: number;
}

interface UnitClientInfo {
  id: string;
  type: string;
  owner: string;
  x: number;
  y: number;
  health: number;
  maxHealth: number;
}

interface BuildingClientInfo {
  id: string;
  type: string;
  owner: string;
  x: number;
  y: number;
  health: number;
  maxHealth: number;
  productionProgress: number;
  productionActive: boolean;
}

interface ResourceClientInfo {
  id: string;
  type: string;
  x: number;
  y: number;
  amount: number;
}

interface RequiredResources {
  [key: string]: number;
}

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

export class GameRoom extends Room<GameStateSchema> {
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
  private readonly INTEREST_AREA_RADIUS = 2; // Rayon en chunks pour définir la zone d'intérêt (5×5 chunks)
  private readonly INTEREST_UPDATE_INTERVAL = 500; // Intervalle de mise à jour des zones d'intérêt en ms
  private lastInterestUpdate: number = 0; // Timestamp de la dernière mise à jour des zones d'intérêt
  private entityPositions: Map<string, {type: string, x: number, y: number}> = new Map(); // Position de toutes les entités
  private entitiesByChunk: Map<string, {players: Set<string>, units: Set<string>, buildings: Set<string>}> = new Map(); // Entités par chunk

  // Timestamp de la dernière mise à jour de l'IA des villageois
  private lastVillagerAIUpdate: number = 0;
  private lastVillagerStatLog: number = 0;

  // Variables privées pour les groupes de chunks
  private chunkGroups: Map<string, Set<string>> = new Map(); // Map<chunkKey, Set<clientId>>

  // Cache pour stocker le dernier état connu des entités par client
  private lastKnownEntityStates: Map<string, Map<string, any>> = new Map();

  // Constantes pour la compression des propriétés
  private readonly PROPERTY_MAP = {
    x: 1,           // Position X
    y: 2,           // Position Y
    health: 3,      // Santé
    maxHealth: 4,   // Santé maximale
    owner: 5,       // Propriétaire
    type: 6,        // Type
    resources: 7,   // Ressources
    name: 8,        // Nom
    hue: 9,         // Teinte
    productionProgress: 10, // Progression de production
    productionActive: 11    // Production active
  };

  // Compresser les changements pour économiser de la bande passante
  private compressChanges(changes: any[]): any[] {
    return changes.map(change => {
      const fieldId = this.PROPERTY_MAP[change.field || change.f];
      
      // Si la propriété a un ID court, l'utiliser
      if (fieldId !== undefined) {
        return {
          i: fieldId,        // 'i' pour 'id' au lieu de 'field'/'f'
          v: change.value || change.v  // 'v' est déjà court
        };
      }
      
      // Sinon garder le format compact standard
      return {
        f: change.field || change.f,
        v: change.value || change.v
      };
    });
  }
  
  // Envoyer des mises à jour d'entités optimisées avec delta encoding et compression maximale
  private sendSuperOptimizedEntityUpdate(entityType: 'player' | 'unit' | 'building', entityId: string, changes: any) {
    // Récupérer l'entité
    let entity: { x: number, y: number, owner?: string } | undefined;
    
    if (entityType === 'player') {
      entity = this.state.players.get(entityId);
    } else if (entityType === 'unit') {
      entity = this.state.units.get(entityId);
    } else if (entityType === 'building') {
      entity = this.state.buildings.get(entityId);
    }
    
    if (!entity) return;
    
    // Déterminer les chunks concernés par cette entité
    const affectedChunks = this.getChunksAroundPosition(entity.x, entity.y);
    
    // Pour chaque client concerné
    for (const client of this.clients) {
      // Le propriétaire reçoit toujours les mises à jour de ses entités
      const isOwner = entity.owner === client.sessionId || (entityType === 'player' && entityId === client.sessionId);
      
      // Vérifier si le client voit l'entité
      if (isOwner || this.isEntityInClientView(client.sessionId, entityType, entityId)) {
        // Créer ou récupérer le cache pour ce client
        if (!this.lastKnownEntityStates.has(client.sessionId)) {
          this.lastKnownEntityStates.set(client.sessionId, new Map());
        }
        const clientCache = this.lastKnownEntityStates.get(client.sessionId)!;
        
        // Récupérer le cache spécifique à cette entité
        const entityCacheKey = `${entityType}:${entityId}`;
        const previousState = clientCache.get(entityCacheKey) || {};
        
        // Filtrer les modifications pour ne garder que ce qui a changé par rapport à l'état précédent
        const significantChanges = Array.isArray(changes) 
          ? changes.filter(change => {
              const field = change.field || change.f;
              const value = change.value || change.v;
              const hasChanged = !previousState[field] || previousState[field] !== value;
              
              // Mise à jour de l'état précédent avec la nouvelle valeur
              if (hasChanged) {
                previousState[field] = value;
              }
              
              return hasChanged;
            })
          : [changes].filter(change => {
              const field = change.field || change.f;
              const value = change.value || change.v;
              const hasChanged = !previousState[field] || previousState[field] !== value;
              
              // Mise à jour de l'état précédent avec la nouvelle valeur
              if (hasChanged) {
                previousState[field] = value;
              }
              
              return hasChanged;
            });
        
        // Stocker le nouvel état
        clientCache.set(entityCacheKey, previousState);
        
        // N'envoyer que s'il y a des changements significatifs
        if (significantChanges.length > 0) {
          // Compresser davantage en utilisant des IDs courts pour les propriétés courantes
          const compressedChanges = this.compressChanges(significantChanges);
          
          // Format de message ultra-compact:
          // t: type (1=player, 2=unit, 3=building)
          // i: id
          // c: changes
          const typeCode = entityType === 'player' ? 1 : (entityType === 'unit' ? 2 : 3);
          const message = {
            t: typeCode,
            i: entityId,
            c: compressedChanges
          };
          
          client.send("e", message); // 'e' pour 'entity update', très court
          
          // Log pour débogage et analyse des performances
          if (Math.random() < 0.001) { // Échantillonnage à 0.1% pour éviter trop de logs
            const compressionRatio = JSON.stringify(significantChanges).length / JSON.stringify(compressedChanges).length;
            console.log(`[Compression] Client ${client.sessionId}: Ratio ${compressionRatio.toFixed(2)}x pour ${entityType} ${entityId}`);
          }
        }
      }
    }
  }

  onCreate(options: { worldData: { mapLines: string[], resources: Map<string, ResourceSchema>, resourcesByChunk: Map<string, Set<string>> } }) {
    // Initialiser l'état du jeu
    this.setState(new GameStateSchema());
    
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
    
    // Gestionnaire pour la création de villageois
    this.onMessage("spawnVillager", (client, data) => {
      const { buildingId } = data;
      
      // Vérifier que le client est le propriétaire du bâtiment
      const building = this.state.buildings.get(buildingId);
      if (!building || building.owner !== client.sessionId) {
        console.log(`Le client ${client.sessionId} n'est pas autorisé à créer des villageois dans le bâtiment ${buildingId}`);
        return;
      }
      
      // Vérifier que le bâtiment est un centre-ville
      if (building.type !== BuildingType.TOWN_CENTER) {
        console.log(`Le bâtiment ${buildingId} n'est pas un centre-ville`);
        return;
      }
      
      // Obtenir le joueur
      const player = this.state.players.get(client.sessionId);
      if (!player) return;
      
      // Vérifier que le joueur a assez de ressources
      const goldCost = UNIT_COSTS.VILLAGER[ResourceType.GOLD];
      
      if ((player.resources.get(ResourceType.GOLD) || 0) < goldCost) {
        console.log(`Le joueur ${client.sessionId} n'a pas assez d'or pour créer un villageois`);
        // Notifier le client que la création a échoué
        client.send("unitCreationFailed", {
          reason: "Ressources insuffisantes",
          required: { [ResourceType.GOLD]: goldCost }
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
      
      // Créer le villageois
      const unit = new UnitSchema();
      unit.id = `villager_${client.sessionId}_${Date.now()}`;
      unit.type = UnitType.VILLAGER;
      unit.owner = client.sessionId;
      
      // Définir les propriétés du villageois
      unit.state = UnitState.IDLE;
      unit.homeBaseId = buildingId; // Associer le villageois à ce centre-ville
      
      // Positionner le villageois près du centre-ville en évitant les superpositions
      const existingPositions: Array<{x: number, y: number}> = [];
      
      // Collecter les positions des unités existantes
      this.state.units.forEach((existingUnit) => {
        if (Math.abs(existingUnit.x - building.x) < TILE_SIZE * 3 && 
            Math.abs(existingUnit.y - building.y) < TILE_SIZE * 3) {
          existingPositions.push({x: existingUnit.x, y: existingUnit.y});
        }
      });
      
      // Positions possibles autour du centre-ville (8 directions)
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
      let position = positions[0];
      
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
      
      // Ajouter le villageois à l'état du jeu
      this.state.units.set(unit.id, unit);
      
      // Augmenter la population du joueur
      player.population += 1;
      
      console.log(`Villageois créé: ${unit.id} pour le joueur ${client.sessionId}`);
      
      // Notifier le client que la création a réussi
      client.send("unitCreated", {
        unitId: unit.id,
        type: UnitType.VILLAGER,
        position: { x: unit.x, y: unit.y }
      });
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
    
    // Mettre à jour l'IA des villageois (réduit à 4 fois par seconde)
    if (!this.lastVillagerAIUpdate || now - this.lastVillagerAIUpdate > 250) {
      this.updateVillagerAI();
      this.lastVillagerAIUpdate = now;
    }
    
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
      try {
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
          const playerUpdates: Array<{sessionId: string, x: number, y: number}> = [];
          
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
            try {
              client.send("playerPositions", { players: playerUpdates });
            } catch (error) {
              console.error(`Erreur lors de l'envoi des positions de joueurs à ${sessionId}:`, error);
            }
          }
          
          updateData.lastPositionUpdate = now;
        }
        
        // Mise à jour des unités - avec fréquence augmentée
        if (now - updateData.lastFullUpdate > 100) {
          try {
            // Collecter toutes les unités visibles par ce joueur
            const visibleUnits: UnitSchema[] = [];
            
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
              const unitUpdates: UnitClientInfo[] = allVisibleUnits.map(unit => ({
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
            const visibleBuildings: BuildingClientInfo[] = [];
            
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
          } catch (error) {
            console.error(`Erreur lors de l'envoi des mises à jour à ${sessionId}:`, error);
          }
          
          updateData.lastFullUpdate = now;
        }
      } catch (error) {
        console.error(`Erreur globale dans optimizeBroadcasts pour ${sessionId}:`, error);
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
    // Rediriger vers l'implémentation optimisée
    return this.getResourcesInRangeV2(centerX, centerY, range);
  }

  // Nouvelle méthode pour obtenir les ressources dans un rayon de chunks
  private getResourcesInRangeV2(x: number, y: number, radius: number = 2): Set<string> {
    const resourcesInRange = new Set<string>();
    
    // Calculer les limites de la zone de recherche en termes de chunks
    const tileRadius = radius * TILE_SIZE;
    const minChunkX = Math.floor((x - tileRadius) / (CHUNK_SIZE * TILE_SIZE));
    const maxChunkX = Math.floor((x + tileRadius) / (CHUNK_SIZE * TILE_SIZE));
    const minChunkY = Math.floor((y - tileRadius) / (CHUNK_SIZE * TILE_SIZE));
    const maxChunkY = Math.floor((y + tileRadius) / (CHUNK_SIZE * TILE_SIZE));
    
    // Parcourir tous les chunks dans la zone
    for (let chunkX = minChunkX; chunkX <= maxChunkX; chunkX++) {
      for (let chunkY = minChunkY; chunkY <= maxChunkY; chunkY++) {
        const chunkKey = `${chunkX},${chunkY}`;
        
        // Si ce chunk contient des ressources, les ajouter à notre ensemble
        if (this.resourcesByChunk.has(chunkKey)) {
          const chunkResources = this.resourcesByChunk.get(chunkKey);
          
          if (chunkResources) {
            // Pour chaque ressource dans ce chunk, vérifier si elle est dans le rayon
            for (const resourceId of chunkResources) {
              const resource = this.resources.get(resourceId);
              
              if (resource) {
                const distance = this.getDistance(x, y, resource.x, resource.y);
                
                // Si la ressource est dans le rayon, l'ajouter à notre ensemble
                if (distance <= tileRadius) {
                  resourcesInRange.add(resourceId);
                }
              }
            }
          }
        }
      }
    }
    
    return resourcesInRange;
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
      // Utiliser la méthode centralisée pour gérer l'épuisement
      this.handleResourceDepletion(resourceId);
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

  // Méthode pour mettre à jour l'IA des villageois
  private updateVillagerAI() {
    // Récupérer tous les villageois
    const villagers = Array.from(this.state.units.values())
      .filter(unit => unit.type === UnitType.VILLAGER);
    
    const now = Date.now();
    const deltaTime = now - (this.lastVillagerAIUpdate || now);
    
    // Statistiques pour le diagnostic
    let totalVillagers = villagers.length;
    let idle = 0, harvesting = 0, returning = 0, errors = 0;
    
    // Pour chaque villageois
    for (const villager of villagers) {
      try {
        // Trouver le propriétaire du villageois
        const ownerId = villager.owner;
        const owner = this.state.players.get(ownerId);
        if (!owner) {
          errors++;
          continue;
        }
        
        // Si le villageois n'a pas de centre-ville associé, trouver le plus proche
        if (!villager.homeBaseId) {
          const townCenters = Array.from(this.state.buildings.values())
            .filter(building => building.type === BuildingType.TOWN_CENTER && building.owner === ownerId);
          
          if (townCenters.length > 0) {
            // Trouver le centre-ville le plus proche
            let closestTC = townCenters[0];
            let closestDistance = this.getDistance(villager.x, villager.y, closestTC.x, closestTC.y);
            
            for (const tc of townCenters) {
              const distance = this.getDistance(villager.x, villager.y, tc.x, tc.y);
              if (distance < closestDistance) {
                closestTC = tc;
                closestDistance = distance;
              }
            }
            
            villager.homeBaseId = closestTC.id;
          } else {
            // Pas de centre-ville, rester inactif
            villager.state = UnitState.IDLE;
            idle++;
            continue;
          }
        }
        
        // Comportement selon l'état
        switch (villager.state) {
          case UnitState.IDLE:
            // Incrémenter le compteur pour stats
            idle++;
            // Chercher une ressource à collecter
            this.findResourceToCollect(villager);
            break;
            
          case UnitState.HARVESTING:
            // Incrémenter le compteur pour stats
            harvesting++;
            
            // Si le villageois a une cible
            if (villager.targetResourceId) {
              const resource = this.resources.get(villager.targetResourceId);
              
              // Si la ressource existe et a toujours des ressources
              if (resource && resource.amount > 0) {
                // Calculer la distance à la ressource
                const distance = this.getDistance(villager.x, villager.y, resource.x, resource.y);
                
                // Vérifier si le villageois est en état de récolte depuis trop longtemps
                const harvestingTime = now - (villager.stateStartTime || now);
                if (!villager.stateStartTime) {
                  villager.stateStartTime = now;
                } else if (harvestingTime > 60000) { // 60 secondes max en HARVESTING
                  console.log(`Villageois ${villager.id} en HARVESTING depuis plus de 60s - passage forcé en RETURNING`);
                  villager.state = UnitState.RETURNING;
                  villager.stateStartTime = now;
                  break;
                }
                
                // Log la distance pour debug (limité à 1% des cas pour éviter trop de logs)
                if (Math.random() < 0.01) {
                  console.log(`Villageois ${villager.id} distance à la ressource: ${distance.toFixed(2)}, TILE_SIZE * 1 = ${(TILE_SIZE * 1).toFixed(2)}`);
                }
                
                // Si assez proche, collecter (distance beaucoup plus petite)
                if (distance < TILE_SIZE * 1) { // Augmenté de 0.3 à 1 pour permettre une récolte à plus grande distance
                  // Vérifier le temps écoulé depuis la dernière collecte
                  const timeSinceLastHarvest = now - (villager.lastHarvestTime || 0);
                  const harvestRate = 1000; // 1 seconde entre chaque collecte
                  
                  // Debug log
                  if (Math.random() < 0.05) { // Limiter le volume de logs (5% de chance)
                    console.log(`Villageois ${villager.id} récoltant ${resource.type}, distance=${distance}, sac: ${villager.carryingAmount}/20`);
                  }
                  
                  if (timeSinceLastHarvest > harvestRate) {
                    // Collecter une unité de ressource (limité par le montant disponible)
                    const collectAmount = Math.min(resource.amount, 1);
                    
                    // Debug log pour la récolte
                    console.log(`Villageois ${villager.id} récolte ${collectAmount} de ${resource.type}, sac: ${villager.carryingAmount}/20`);
                    
                    // Seulement si on peut réellement collecter quelque chose
                    if (collectAmount > 0) {
                      // Réduire effectivement le montant de la ressource
                      resource.amount -= collectAmount;
                      
                      // Activer l'animation de récolte
                      villager.isHarvesting = true;
                      
                      // Notifier les clients de la récolte pour l'animation
                      this.broadcast("resourceHarvested", {
                        resourceId: resource.id,
                        amount: collectAmount,
                        villagerX: villager.x,
                        villagerY: villager.y
                      });
                      
                      // Si la ressource est épuisée, notifier tous les clients
                      if (resource.amount <= 0) {
                        // Marquer la ressource comme épuisée pour le système
                        this.handleResourceDepletion(resource.id);
                        
                        console.log(`Ressource ${resource.id} épuisée par villageois ${villager.id}`);
                      }
                      
                      // Si c'est la première collecte, définir le type de ressource transportée
                      if (villager.carryingAmount === 0) {
                        villager.carryingType = resource.type;
                      }
                      
                      // Ajouter à la quantité transportée
                      villager.carryingAmount += collectAmount;
                      villager.lastHarvestTime = now;
                      
                      // Si le sac est plein (capacité de 20) ou ressource épuisée, retourner au centre-ville
                      if (villager.carryingAmount >= 20 || resource.amount <= 0) {
                        villager.state = UnitState.RETURNING;
                        console.log(`Villageois ${villager.id} passe en mode RETURNING avec ${villager.carryingAmount} ressources de ${villager.carryingType}`);
                      }
                    } else {
                      // Si la ressource est épuisée, chercher une autre
                      villager.targetResourceId = "";
                      this.findResourceToCollect(villager);
                    }
                  }
                } else {
                  // Se déplacer vers la ressource avec delta time
                  this.moveVillagerTo(villager, resource.x, resource.y);
                }
              } else {
                // Si la ressource n'existe plus ou est épuisée, chercher une autre
                villager.targetResourceId = "";
                this.findResourceToCollect(villager);
              }
            } else {
              // Si pas de cible, chercher une ressource
              this.findResourceToCollect(villager);
            }
            break;
            
          case UnitState.RETURNING:
            // Incrémenter le compteur pour stats
            returning++;
            
            // Désactiver l'animation de récolte lorsqu'on retourne au centre
            if (villager.isHarvesting) {
              villager.isHarvesting = false;
              console.log(`Villageois ${villager.id} arrête de récolter pour retourner au centre-ville`);
            }
            
            // Trouver le centre-ville associé
            const homeBase = this.state.buildings.get(villager.homeBaseId);
            
            // Si le centre-ville n'existe plus, retourner à l'état IDLE
            if (!homeBase) {
              console.log(`Centre-ville ${villager.homeBaseId} introuvable pour le villageois ${villager.id}, retour à IDLE`);
              villager.state = UnitState.IDLE;
              villager.homeBaseId = "";
              break;
            }
            
            // Vérifier le temps passé en état RETURNING pour éviter les blocages
            const returningTime = now - (villager.stateStartTime || now);
            if (!villager.stateStartTime) {
              villager.stateStartTime = now;
            } else if (returningTime > 60000) { // 60 secondes max en RETURNING
              console.log(`Villageois ${villager.id} en RETURNING depuis plus de 60s - passage forcé en IDLE`);
              villager.state = UnitState.IDLE;
              villager.stateStartTime = now;
              
              // Déposer les ressources directement dans l'inventaire du joueur pour éviter de les perdre
              if (villager.carryingAmount > 0 && villager.carryingType) {
                // Récupérer le type de ressource transportée
                const resourceType = villager.carryingType;
                
                // Ajouter aux ressources du joueur
                const currentAmount = owner.resources.get(resourceType) || 0;
                
                // Stocker la quantité déposée avant de la réinitialiser
                const depositedAmount = villager.carryingAmount;
                
                // Mettre à jour les ressources du joueur
                owner.resources.set(resourceType, currentAmount + depositedAmount);
                
                // Log détaillé du dépôt
                console.log(`Villageois ${villager.id} dépose ${depositedAmount} ${resourceType} au centre-ville. Nouveau total: ${currentAmount + depositedAmount}`);
                
                // Réinitialiser le transport
                villager.carryingAmount = 0;
                villager.carryingType = "";
                
                // Envoyer un message de confirmation du dépôt au client
                this.broadcast("resourceDeposited", {
                  playerId: owner.id,
                  type: resourceType,
                  amount: depositedAmount,
                  villagerX: villager.x,
                  villagerY: villager.y,
                  totalAmount: currentAmount + depositedAmount
                });

                // Log détaillé pour vérifier l'envoi de l'événement resourceDeposited
                console.log(`EVENT resourceDeposited envoyé: player=${owner.id}, type=${resourceType}, amount=${depositedAmount}, total=${currentAmount + depositedAmount}`);
              }
              
              break;
            }
            
            // Calculer la distance au centre-ville
            const distanceToBase = this.getDistance(villager.x, villager.y, homeBase.x, homeBase.y);
            
            // Debug log pour la distance (limité à 1% des cas)
            if (Math.random() < 0.01) {
              console.log(`Villageois ${villager.id} distance au centre-ville: ${distanceToBase.toFixed(2)}, TILE_SIZE * 1.5 = ${(TILE_SIZE * 1.5).toFixed(2)}`);
            }
            
            // Si suffisamment proche du centre-ville, déposer les ressources
            if (distanceToBase < TILE_SIZE * 1.5) {
              if (villager.carryingAmount > 0 && villager.carryingType) {
                // Récupérer le type de ressource transportée
                const resourceType = villager.carryingType;
                
                // Ajouter aux ressources du joueur
                const currentAmount = owner.resources.get(resourceType) || 0;
                
                // Stocker la quantité déposée avant de la réinitialiser
                const depositedAmount = villager.carryingAmount;
                
                // Mettre à jour les ressources du joueur
                owner.resources.set(resourceType, currentAmount + depositedAmount);
                
                // Log détaillé du dépôt
                console.log(`Villageois ${villager.id} dépose ${depositedAmount} ${resourceType} au centre-ville. Nouveau total: ${currentAmount + depositedAmount}`);
                
                // Réinitialiser le transport
                villager.carryingAmount = 0;
                villager.carryingType = "";
                
                // Envoyer un message de confirmation du dépôt au client
                this.broadcast("resourceDeposited", {
                  playerId: owner.id,
                  type: resourceType,
                  amount: depositedAmount,
                  villagerX: villager.x,
                  villagerY: villager.y,
                  totalAmount: currentAmount + depositedAmount
                });

                // Log détaillé pour vérifier l'envoi de l'événement resourceDeposited
                console.log(`EVENT resourceDeposited envoyé: player=${owner.id}, type=${resourceType}, amount=${depositedAmount}, total=${currentAmount + depositedAmount}`);
              }
              
              // Retourner à l'état IDLE pour chercher d'autres ressources
              villager.state = UnitState.IDLE;
              villager.blockedTime = 0; // Réinitialiser le compteur de blocage
              villager.stateStartTime = now;
              console.log(`Villageois ${villager.id} a déposé ses ressources, retour à IDLE`);
            } else {
              // Continuer à se déplacer vers le centre-ville
              this.moveVillagerTo(villager, homeBase.x, homeBase.y);
            }
            break;
            
          default:
            // État inconnu, réinitialiser
            villager.state = UnitState.IDLE;
            this.findResourceToCollect(villager);
            errors++;
        }
      } catch (error) {
        console.error(`Erreur lors de la mise à jour du villageois ${villager.id}:`, error);
        // Réinitialiser l'état du villageois en cas d'erreur
        villager.state = UnitState.IDLE;
        errors++;
      }
    }
    
    // Log de résumé des villageois toutes les 5 secondes
    if (!this.lastVillagerStatLog || now - this.lastVillagerStatLog > 5000) {
      if (totalVillagers > 0) {
        console.log(`[Villagers] Total: ${totalVillagers} | Idle: ${idle} | Harvesting: ${harvesting} | Returning: ${returning} | Errors: ${errors}`);
      }
      this.lastVillagerStatLog = now;
    }
    
    // Mettre à jour le timestamp de la dernière update
    this.lastVillagerAIUpdate = now;
  }

  // Méthode pour trouver une ressource à collecter
  private findResourceToCollect(villager: UnitSchema) {
    // Types de ressources que les villageois peuvent collecter
    const collectableTypes = [ResourceType.GOLD, ResourceType.WOOD, ResourceType.STONE];
    
    // Augmenter le rayon de recherche pour trouver des ressources plus éloignées
    const searchRadius = 20;
    
    // Obtenir toutes les ressources dans le rayon de recherche
    const nearbyResources = this.getResourcesInRange(villager.x, villager.y, searchRadius);
    
    // Initialiser la ressource la plus proche à null et la distance minimale à l'infini
    let closestResource = null;
    let minDistance = Infinity;
    
    // Parcourir toutes les ressources proches
    for (const resourceId of nearbyResources) {
      const resource = this.resources.get(resourceId);
      
      // Vérifier si la ressource existe, a encore des ressources et est d'un type collectable
      if (resource && 
          resource.amount > 0 && 
          collectableTypes.includes(resource.type as ResourceType)) {
        
        // Calculer la distance à cette ressource
        const distance = this.getDistance(villager.x, villager.y, resource.x, resource.y);
        
        // Si c'est plus proche que la ressource actuelle la plus proche, mettre à jour
        if (distance < minDistance) {
          minDistance = distance;
          closestResource = resource;
        }
      }
    }
    
    // Si une ressource a été trouvée, la cibler
    if (closestResource) {
      villager.targetResourceId = closestResource.id;
      villager.state = UnitState.HARVESTING;
      
      // Déplacer immédiatement le villageois vers la ressource
      this.moveVillagerTo(villager, closestResource.x, closestResource.y);
    } else {
      // Si on n'a rien trouvé, rester en IDLE
      villager.state = UnitState.IDLE;
      
      // Si on a vraiment rien trouvé, essayer avec un rayon encore plus grand
      if (nearbyResources.size === 0 && Math.random() < 0.1) {
        const extraSearchRadius = 40;
        const farResources = this.getResourcesInRange(villager.x, villager.y, extraSearchRadius);
        
        if (farResources.size > 0) {
          // Prendre une ressource aléatoire dans ce lot plus éloigné
          const farResourceIds = Array.from(farResources);
          const randomResourceId = farResourceIds[Math.floor(Math.random() * farResourceIds.length)];
          const randomResource = this.resources.get(randomResourceId);
          
          if (randomResource && randomResource.amount > 0 && 
              collectableTypes.includes(randomResource.type as ResourceType)) {
            villager.targetResourceId = randomResource.id;
            villager.state = UnitState.HARVESTING;
            this.moveVillagerTo(villager, randomResource.x, randomResource.y);
          }
        }
      }
    }
  }

  // Méthode pour déplacer un villageois vers une position
  private moveVillagerTo(villager: UnitSchema, targetX: number, targetY: number) {
    // Vitesse de base en unités par seconde
    const BASE_VILLAGER_SPEED = 70; // Augmentation de la vitesse de base pour un meilleur mouvement
    const MAX_BLOCKED_TIME = 3000; // ms
    
    // Utiliser le temps écoulé depuis la dernière mise à jour pour normaliser la vitesse
    const now = Date.now();
    const deltaTime = now - (villager.lastMoveTime || now);
    const deltaSeconds = deltaTime / 1000; // Convertir en secondes
    
    // Vitesse ajustée selon le delta time
    const speedThisFrame = BASE_VILLAGER_SPEED * deltaSeconds;
    
    // Initialiser les données de position si nécessaire
    if (!villager.lastMoveTime) {
      villager.lastMoveTime = now;
      villager.lastX = villager.x;
      villager.lastY = villager.y;
    } else if (deltaTime > 50) { // Vérifier si plus de 50ms ont passé
      // Calculer la distance parcourue depuis la dernière vérification
      const distanceMoved = this.getDistance(villager.x, villager.y, villager.lastX, villager.lastY);
      
      // Si le villageois ne s'est presque pas déplacé, incrémenter son compteur de blocage
      if (distanceMoved < speedThisFrame * 0.5 && deltaTime > 500) {
        villager.blockedTime = (villager.blockedTime || 0) + deltaTime;
        
        // Si le villageois est bloqué trop longtemps, débloquer avec plus de force
        if ((villager.blockedTime || 0) > MAX_BLOCKED_TIME) {
          // S'assurer que nous revenons à IDLE si nous sommes bloqués trop longtemps pendant la récolte
          if (villager.state === UnitState.HARVESTING && !this.resources.has(villager.targetResourceId)) {
            villager.state = UnitState.IDLE;
            villager.targetResourceId = "";
            villager.blockedTime = 0;
            return;
          }
          
          // S'assurer que nous revenons à IDLE si nous sommes bloqués trop longtemps en retournant au centre-ville
          if (villager.state === UnitState.RETURNING && !this.state.buildings.has(villager.homeBaseId)) {
            console.log(`Villageois ${villager.id} bloqué en RETURNING - centre-ville disparu, retour à IDLE, sac: ${villager.carryingAmount}/${villager.carryingType}`);
            villager.state = UnitState.IDLE;
            villager.homeBaseId = "";
            villager.blockedTime = 0;
            return;
          }
          
          // Calculer une direction aléatoire pour débloquer
          const randomAngle = Math.random() * Math.PI * 2;
          const randomDistance = TILE_SIZE * 2; // Distance réduite pour un déblocage plus contrôlé
          const randomDx = Math.cos(randomAngle) * randomDistance;
          const randomDy = Math.sin(randomAngle) * randomDistance;
          
          // Essayer de se déplacer dans cette direction
          const newX = villager.x + randomDx;
          const newY = villager.y + randomDy;
          
          if (this.isValidPosition(newX, newY)) {
            villager.x = newX;
            villager.y = newY;
            villager.blockedTime = 0; // Réinitialiser le compteur
            
            // Mettre à jour les dernières positions connues
            villager.lastMoveTime = now;
            villager.lastX = villager.x;
            villager.lastY = villager.y;
            
            // Log pour diagnostic
            console.log(`Villageois ${villager.id} débloqué avec un mouvement aléatoire`);
            return;
          }
        }
      } else {
        // Réinitialiser le compteur s'il se déplace normalement
        villager.blockedTime = 0;
      }
      
      // Mettre à jour les dernières positions connues
      villager.lastMoveTime = now;
      villager.lastX = villager.x;
      villager.lastY = villager.y;
    }
    
    // Calculer le vecteur de direction
    const dx = targetX - villager.x;
    const dy = targetY - villager.y;
    
    // Calculer la distance à la cible
    const length = Math.sqrt(dx * dx + dy * dy);
    
    // Si la distance est très petite, considérer qu'on est arrivé
    if (length < 0.1) { // Réduit de 0.5 à 0.1 pour permettre de s'approcher au maximum
      return; // Déjà à destination, ne pas bouger davantage
    }
    
    // Normaliser le vecteur pour avoir une vitesse constante
    const normalizedDx = dx / length;
    const normalizedDy = dy / length;
    
    // Calculer la nouvelle position en fonction du delta time
    const moveDistance = Math.min(speedThisFrame, length); // Ne pas dépasser la cible
    const newX = villager.x + normalizedDx * moveDistance;
    const newY = villager.y + normalizedDy * moveDistance;
    
    // Vérifier si nous sommes très proches de la ressource cible
    let forceMove = false;
    if (villager.state === UnitState.HARVESTING && villager.targetResourceId) {
      const targetResource = this.resources.get(villager.targetResourceId);
      if (targetResource) {
        const distanceToResource = this.getDistance(villager.x, villager.y, targetResource.x, targetResource.y);
        // Si nous sommes suffisamment proches, forcer le mouvement
        if (distanceToResource < TILE_SIZE * 1.2) { // Augmenté à 1.2 pour être cohérent avec la distance de récolte
          forceMove = true;
          console.log(`Villageois ${villager.id} force le mouvement vers la ressource, distance=${distanceToResource.toFixed(2)}`);
        }
      }
    }
    
    // Vérifier les collisions et mettre à jour la position (ignorer les collisions si on force le mouvement)
    if (forceMove || this.isValidPosition(newX, newY)) {
      villager.x = newX;
      villager.y = newY;
    } else {
      // Si collision, essayer des directions alternatives
      const directions = [
        { x: newX, y: villager.y }, // Horizontal
        { x: villager.x, y: newY }, // Vertical
        { x: villager.x + normalizedDx * moveDistance * 0.7, y: villager.y + normalizedDy * moveDistance * 0.3 }, // Diagonal 1
        { x: villager.x + normalizedDx * moveDistance * 0.3, y: villager.y + normalizedDy * moveDistance * 0.7 }  // Diagonal 2
      ];
      
      // Essayer chaque direction alternative
      let moved = false;
      for (const dir of directions) {
        if (this.isValidPosition(dir.x, dir.y)) {
          villager.x = dir.x;
          villager.y = dir.y;
          moved = true;
          break;
        }
      }
      
      // Si aucune direction n'a fonctionné, marquer comme bloqué
      if (!moved) {
        villager.blockedTime = (villager.blockedTime || 0) + deltaTime;
      }
    }
    
    // Mettre à jour la rotation pour faire face à la direction du mouvement
    villager.rotation = Math.atan2(dy, dx);
    
    // Désactiver l'animation de récolte pendant le déplacement
    if (villager.isHarvesting) {
        villager.isHarvesting = false;
        console.log(`Villageois ${villager.id} arrête de récolter pour se déplacer`);
    }
  }

  // Méthode utilitaire pour calculer la distance entre deux points
  private getDistance(x1: number, y1: number, x2: number, y2: number): number {
    return Math.sqrt(Math.pow(x2 - x1, 2) + Math.pow(y2 - y1, 2));
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
        let collisionRadius = TILE_SIZE * 0.4; // Rayon de base réduit de 0.8 à 0.4
        
        // Ajuster le rayon selon le type de ressource
        switch (resource.type) {
          case ResourceType.WOOD:
            // Les arbres ont un rayon plus grand mais réduit
            collisionRadius = TILE_SIZE * 0.6; // Réduit de 1.2 à 0.6
            break;
          case ResourceType.STONE:
            // Les pierres ont un rayon moyen mais réduit
            collisionRadius = TILE_SIZE * 0.5; // Réduit de 1.0 à 0.5
            break;
          case ResourceType.GOLD:
            // L'or a un rayon standard mais réduit
            collisionRadius = TILE_SIZE * 0.45; // Réduit de 0.9 à 0.45
            break;
          default:
            // Autres ressources, rayon standard réduit
            collisionRadius = TILE_SIZE * 0.4; // Réduit de 0.8 à 0.4
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
    
    // Si des changements ont eu lieu, mettre à jour les abonnements aux groupes
    if (newChunks.length > 0 || removedChunks.length > 0) {
      console.log(`Zone d'intérêt mise à jour pour ${playerId}: ${visibleChunks.size} chunks (${newChunks.length} ajoutés, ${removedChunks.length} supprimés)`);
      if (newChunks.length > 0) console.log(`Nouveaux chunks: [${newChunks.join(', ')}]`);
      if (removedChunks.length > 0) console.log(`Chunks supprimés: [${removedChunks.join(', ')}]`);
      
      const client = this.clients.find(c => c.sessionId === playerId);
      if (client) {
        try {
          // Mettre à jour les abonnements aux groupes de chunks
          this.updateClientChunkGroups(client, previousChunks, visibleChunks);
          
          // Notifier les nouveaux chunks visibles
          if (newChunks.length > 0) {
            // Collecter les ressources des nouveaux chunks
            const newResources = this.getResourcesFromChunks(newChunks);
            
            // Collecter les entités des nouveaux chunks
            const newEntities = this.getEntitiesFromChunks(newChunks);
            
            // Créer un objet de mise à jour entièrement sérialisable
            const updateData = {
              added: newChunks,
              removed: removedChunks,
              resources: newResources,
              entities: {
                players: newEntities.players,
                units: newEntities.units,
                buildings: newEntities.buildings
              }
            };
            
            // Envoyer les nouvelles entités visibles
            client.send("visibleChunksUpdated", updateData);
          } else {
            // Juste notifier les chunks qui ne sont plus visibles
            client.send("visibleChunksUpdated", {
              added: [],
              removed: removedChunks,
              resources: [],
              entities: { players: [], units: [], buildings: [] }
            });
          }
        } catch (error) {
          console.error(`Erreur lors de l'envoi des mises à jour de chunks à ${playerId}:`, error);
          // En cas d'erreur, envoyer une mise à jour minimale sans données complexes
          client.send("visibleChunksUpdated", {
            added: newChunks,
            removed: removedChunks,
            resources: [],
            entities: { players: [], units: [], buildings: [] }
          });
        }
      }
    }
    
    // Mettre à jour les chunks visibles pour ce joueur
    this.playerVisibleChunks.set(playerId, visibleChunks);
  }
  
  // Nouvelle méthode pour gérer les abonnements aux groupes de chunks
  private updateClientChunkGroups(client: Client, oldChunks: Set<string>, newChunks: Set<string>) {
    // Quitter les groupes des chunks qui ne sont plus visibles
    for (const chunkKey of oldChunks) {
      if (!newChunks.has(chunkKey)) {
        // Revenir à notre implémentation manuelle de gestion des groupes
        this.leaveChunkGroup(chunkKey, client.sessionId);
      }
    }
    
    // Rejoindre les groupes des nouveaux chunks visibles
    for (const chunkKey of newChunks) {
      if (!oldChunks.has(chunkKey)) {
        // Revenir à notre implémentation manuelle de gestion des groupes
        this.joinChunkGroup(chunkKey, client.sessionId);
      }
    }
  }
  
  // Méthode pour ajouter un client à un groupe de chunks
  private joinChunkGroup(chunkKey: string, clientId: string) {
    // Créer le groupe s'il n'existe pas
    if (!this.chunkGroups.has(chunkKey)) {
      this.chunkGroups.set(chunkKey, new Set<string>());
    }
    
    // Ajouter le client au groupe
    const group = this.chunkGroups.get(chunkKey)!;
    group.add(clientId);
  }
  
  // Méthode pour retirer un client d'un groupe de chunks
  private leaveChunkGroup(chunkKey: string, clientId: string) {
    // Vérifier si le groupe existe
    if (!this.chunkGroups.has(chunkKey)) return;
    
    // Retirer le client du groupe
    const group = this.chunkGroups.get(chunkKey)!;
    group.delete(clientId);
    
    // Supprimer le groupe s'il est vide
    if (group.size === 0) {
      this.chunkGroups.delete(chunkKey);
    }
  }
  
  // Méthode pour diffuser un message uniquement aux clients dans des chunks spécifiques
  private broadcastToChunks(message: string, data: any, chunkKeys: string[]) {
    // Créer un ensemble de clients uniques à partir des groupes de chunks
    const targetClientIds = new Set<string>();
    
    for (const chunkKey of chunkKeys) {
      const group = this.chunkGroups.get(chunkKey);
      if (group) {
        for (const clientId of group) {
          targetClientIds.add(clientId);
        }
      }
    }
    
    // Diffuser le message uniquement aux clients cibles
    for (const client of this.clients) {
      if (targetClientIds.has(client.sessionId)) {
        client.send(message, data);
      }
    }
  }

  // Configurer le filtrage des entités basé sur les zones d'intérêt
  private setupEntityFiltering() {
    console.log("Configuration du filtrage des entités basé sur les zones d'intérêt...");
    
    // Dans Colyseus 0.14, nous configurons le filtrage au niveau du schéma
    // en utilisant les événements onAdd et onChange
    this.state.players.onAdd = (player, sessionId) => {
      console.log(`Joueur ajouté à l'état: ${sessionId}`);
      
      // Déterminer dans quel chunk se trouve ce joueur
      const playerChunkX = Math.floor(player.x / (TILE_SIZE * CHUNK_SIZE));
      const playerChunkY = Math.floor(player.y / (TILE_SIZE * CHUNK_SIZE));
      const playerChunkKey = `${playerChunkX},${playerChunkY}`;
      
      // Notifier tous les clients qui voient ce chunk
      const initialChunks = this.getChunksAroundPosition(player.x, player.y);
      
      // Rejoindre les groupes de chunks - implémentation manuelle
      const client = this.clients.find(c => c.sessionId === sessionId);
      if (client) {
        for (const chunkKey of initialChunks) {
          this.joinChunkGroup(chunkKey, sessionId);
        }
      }
      
      // Envoyer l'ajout initial à tous les clients concernés
      const playerData = {
        id: sessionId,
        name: player.name,
        x: player.x,
        y: player.y,
        hue: player.hue
      };
      
      this.broadcastToChunks("playerAdded", playerData, initialChunks);
      
      player.onChange = (changes) => {
        // Envoyer les mises à jour de façon optimisée
        this.sendOptimizedEntityUpdate('player', sessionId, changes);
      };
    };
    
    this.state.units.onAdd = (unit, unitId) => {
      console.log(`Unité ajoutée à l'état: ${unitId}`);
      
      // Déterminer dans quel chunk se trouve cette unité
      const unitChunks = this.getChunksAroundPosition(unit.x, unit.y);
      
      // Envoyer l'ajout initial à tous les clients concernés
      const unitData = {
        id: unitId,
        type: unit.type,
        owner: unit.owner,
        x: unit.x,
        y: unit.y,
        health: unit.health,
        maxHealth: unit.maxHealth
      };
      
      this.broadcastToChunks("unitAdded", unitData, unitChunks);
      
      unit.onChange = (changes) => {
        // Envoyer les mises à jour de façon optimisée
        this.sendOptimizedEntityUpdate('unit', unitId, changes);
      };
    };
    
    this.state.buildings.onAdd = (building, buildingId) => {
      console.log(`Bâtiment ajouté à l'état: ${buildingId}`);
      
      // Déterminer dans quel chunk se trouve ce bâtiment
      const buildingChunks = this.getChunksAroundPosition(building.x, building.y);
      
      // Envoyer l'ajout initial à tous les clients concernés
      const buildingData = {
        id: buildingId,
        type: building.type,
        owner: building.owner,
        x: building.x,
        y: building.y,
        health: building.health,
        maxHealth: building.maxHealth,
        productionProgress: building.productionProgress,
        productionActive: building.productionActive
      };
      
      this.broadcastToChunks("buildingAdded", buildingData, buildingChunks);
      
      building.onChange = (changes) => {
        // Envoyer les mises à jour de façon optimisée
        this.sendOptimizedEntityUpdate('building', buildingId, changes);
      };
    };
    
    console.log("Filtrage des entités configuré avec succès.");
  }
  
  // Vérifier si une entité est dans la vue d'un client
  private isEntityInClientView(clientId: string, entityType: 'player' | 'unit' | 'building', entityId: string): boolean {
    // Récupérer les chunks visibles par le client
    const visibleChunks = this.playerVisibleChunks.get(clientId);
    if (!visibleChunks) return false;
    
    // Récupérer l'entité en fonction de son type
    let entity: { x: number, y: number } | undefined;
    
    if (entityType === 'player') {
      entity = this.state.players.get(entityId);
    } else if (entityType === 'unit') {
      entity = this.state.units.get(entityId);
    } else if (entityType === 'building') {
      entity = this.state.buildings.get(entityId);
    }
    
    if (!entity) return false;
    
    // Calculer dans quel chunk se trouve l'entité
    const entityChunkX = Math.floor(entity.x / (TILE_SIZE * CHUNK_SIZE));
    const entityChunkY = Math.floor(entity.y / (TILE_SIZE * CHUNK_SIZE));
    const entityChunkKey = `${entityChunkX},${entityChunkY}`;
    
    // Vérifier si le chunk de l'entité est visible par le client
    return visibleChunks.has(entityChunkKey);
  }
  
  // Méthode pour calculer les chunks influencés par une position
  private getChunksAroundPosition(x: number, y: number, radius: number = 1): string[] {
    const centerChunkX = Math.floor(x / (TILE_SIZE * CHUNK_SIZE));
    const centerChunkY = Math.floor(y / (TILE_SIZE * CHUNK_SIZE));
    const chunks: string[] = [];
    
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        chunks.push(`${centerChunkX + dx},${centerChunkY + dy}`);
      }
    }
    
    return chunks;
  }
  
  // Envoyer des mises à jour d'entités optimisées avec delta encoding
  private sendOptimizedEntityUpdate(entityType: 'player' | 'unit' | 'building', entityId: string, changes: any) {
    // Récupérer l'entité
    let entity: { x: number, y: number, owner?: string } | undefined;
    
    if (entityType === 'player') {
      entity = this.state.players.get(entityId);
    } else if (entityType === 'unit') {
      entity = this.state.units.get(entityId);
    } else if (entityType === 'building') {
      entity = this.state.buildings.get(entityId);
    }
    
    if (!entity) return;
    
    // Déterminer les chunks concernés par cette entité
    const affectedChunks = this.getChunksAroundPosition(entity.x, entity.y);
    
    // Pour chaque client concerné
    for (const client of this.clients) {
      // Le propriétaire reçoit toujours les mises à jour de ses entités
      const isOwner = entity.owner === client.sessionId || (entityType === 'player' && entityId === client.sessionId);
      
      // Vérifier si le client voit l'entité
      if (isOwner || this.isEntityInClientView(client.sessionId, entityType, entityId)) {
        // Créer ou récupérer le cache pour ce client
        if (!this.lastKnownEntityStates.has(client.sessionId)) {
          this.lastKnownEntityStates.set(client.sessionId, new Map());
        }
        const clientCache = this.lastKnownEntityStates.get(client.sessionId)!;
        
        // Récupérer le cache spécifique à cette entité
        const entityCacheKey = `${entityType}:${entityId}`;
        const previousState = clientCache.get(entityCacheKey) || {};
        
        // Filtrer les modifications pour ne garder que ce qui a changé par rapport à l'état précédent
        const significantChanges = Array.isArray(changes) 
          ? changes.filter(change => {
              const field = change.field;
              const value = change.value;
              const hasChanged = !previousState[field] || previousState[field] !== value;
              
              // Mise à jour de l'état précédent avec la nouvelle valeur
              if (hasChanged) {
                previousState[field] = value;
              }
              
              return hasChanged;
            })
          : [changes].filter(change => {
              const field = change.field;
              const value = change.value;
              const hasChanged = !previousState[field] || previousState[field] !== value;
              
              // Mise à jour de l'état précédent avec la nouvelle valeur
              if (hasChanged) {
                previousState[field] = value;
              }
              
              return hasChanged;
            });
        
        // Stocker le nouvel état
        clientCache.set(entityCacheKey, previousState);
        
        // N'envoyer que s'il y a des changements significatifs
        if (significantChanges.length > 0) {
          client.send(`${entityType}Update`, {
            id: entityId,
            changes: significantChanges
          });
        }
      }
    }
  }

  // Méthode pour obtenir toutes les ressources dans un rayon donné
  private getResourcesInRange(x: number, y: number, radius: number = 2): Set<string> {
    // Rediriger vers la nouvelle implémentation optimisée
    return this.getResourcesInRangeV2(x, y, radius);
  }

  // Nouvelle méthode pour gérer l'épuisement des ressources de manière centralisée
  private handleResourceDepletion(resourceId: string) {
    const resource = this.resources.get(resourceId);
    if (!resource) return;
    
    // Marquer comme épuisée
    resource.amount = 0;
    resource.isRespawning = true;
    
    // Informer tous les clients
    this.broadcast("resourceDepleted", {
      resourceId: resourceId,
      respawnTime: RESOURCE_RESPAWN_TIMES[resource.type as ResourceType] || 60000
    });
    
    // Planifier la réapparition
    setTimeout(() => {
      if (this.resources.has(resourceId)) {
        resource.amount = RESOURCE_AMOUNTS[resource.type as ResourceType] || resource.maxAmount;
        resource.isRespawning = false;
        
        // Informer tous les clients de la réapparition
        this.broadcast("resourceRespawned", {
          resourceId: resourceId,
          amount: resource.amount
        });
        
        console.log(`Ressource ${resourceId} réapparue avec ${resource.amount} unités`);
      }
    }, RESOURCE_RESPAWN_TIMES[resource.type as ResourceType] || 60000);
  }

  // Récupérer les ressources à partir d'une liste de chunks
  private getResourcesFromChunks(chunks: string[]): ResourceClientInfo[] {
    const resources: ResourceClientInfo[] = [];
    
    // Si aucun chunk spécifié, retourner un tableau vide
    if (!chunks || chunks.length === 0) return resources;
    
    for (const chunkKey of chunks) {
      const chunkResources = this.resourcesByChunk.get(chunkKey);
      if (chunkResources) {
        chunkResources.forEach(resourceId => {
          const resource = this.resources.get(resourceId);
          // Ne pas inclure les ressources épuisées (amount <= 0) ou en cours de respawn
          if (resource && resource.amount > 0 && !resource.isRespawning) {
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
    }
    
    return resources;
  }

  // Récupérer les entités à partir d'une liste de chunks
  private getEntitiesFromChunks(chunks: string[]): { 
    players: PlayerClientInfo[],
    units: UnitClientInfo[],
    buildings: BuildingClientInfo[]
  } {
    const entities = {
      players: [] as PlayerClientInfo[],
      units: [] as UnitClientInfo[],
      buildings: [] as BuildingClientInfo[]
    };
    
    // Si aucun chunk spécifié, retourner un objet vide
    if (!chunks || chunks.length === 0) return entities;
    
    for (const chunkKey of chunks) {
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
    }
    
    return entities;
  }

  // Pour compatibilité temporaire - sera supprimé après refactoring complet
  private getResourcesInRangeV2(x: number, y: number, radius: number = 2): Set<string> {
    const resourcesInRange = new Set<string>();
    
    // Calculer les limites de la zone de recherche en termes de chunks
    const tileRadius = radius * TILE_SIZE;
    const minChunkX = Math.floor((x - tileRadius) / (CHUNK_SIZE * TILE_SIZE));
    const maxChunkX = Math.floor((x + tileRadius) / (CHUNK_SIZE * TILE_SIZE));
    const minChunkY = Math.floor((y - tileRadius) / (CHUNK_SIZE * TILE_SIZE));
    const maxChunkY = Math.floor((y + tileRadius) / (CHUNK_SIZE * TILE_SIZE));
    
    // Parcourir tous les chunks dans la zone
    for (let chunkX = minChunkX; chunkX <= maxChunkX; chunkX++) {
      for (let chunkY = minChunkY; chunkY <= maxChunkY; chunkY++) {
        const chunkKey = `${chunkX},${chunkY}`;
        
        // Si ce chunk contient des ressources, les ajouter à notre ensemble
        if (this.resourcesByChunk.has(chunkKey)) {
          const chunkResources = this.resourcesByChunk.get(chunkKey);
          
          if (chunkResources) {
            // Pour chaque ressource dans ce chunk, vérifier si elle est dans le rayon
            for (const resourceId of chunkResources) {
              const resource = this.resources.get(resourceId);
              
              if (resource) {
                const distance = this.getDistance(x, y, resource.x, resource.y);
                
                // Si la ressource est dans le rayon, l'ajouter à notre ensemble
                if (distance <= tileRadius) {
                  resourcesInRange.add(resourceId);
                }
              }
            }
          }
        }
      }
    }
    
    return resourcesInRange;
  }
} 