import { Schema, type, MapSchema } from "@colyseus/schema";
import { PLAYER_HEALTH, UNIT_HEALTH, BUILDING_HEALTH, COMBAT } from "shared";
import { UnitState, UnitType } from "shared";

// Types de ressources
export enum ResourceType {
  GOLD = "gold",
  WOOD = "wood",
  STONE = "stone",
  IRON = "iron",
  COAL = "coal",
  STEEL = "steel"
}

// Types de bâtiments
export enum BuildingType {
  FORGE = "forge",
  HOUSE = "house",
  FURNACE = "furnace",
  FACTORY = "factory",
  TOWER = "tower",
  BARRACKS = "barracks",
  TOWN_CENTER = "town_center",
  YARD = "yard",
  CABIN = "hut",
  PLAYER_WALL = "player_wall"
}

// Réexporter UnitType depuis shared pour éviter les conflits
// export enum UnitType {
//   WARRIOR = "warrior",
//   VILLAGER = "villager"
// }

// Schéma pour un joueur
export class PlayerSchema extends Schema {
  @type("string") id: string = "";
  @type("string") name: string = "Player";
  @type("number") x: number = 0;
  @type("number") y: number = 0;
  @type("number") health: number = PLAYER_HEALTH.MAX_HEALTH;
  @type("number") maxHealth: number = PLAYER_HEALTH.MAX_HEALTH;
  @type("number") hue: number = 0;
  @type("number") population: number = 0;
  @type("number") maxPopulation: number = 10;
  @type({ map: "number" }) resources = new MapSchema<number>();
  
  // Propriétés pour le mode cible
  @type("number") cursorTargetX: number = 0;
  @type("number") cursorTargetY: number = 0;
  @type("boolean") isTargetMode: boolean = false;
  
  // Nouvelles propriétés pour le déplacement des soldats
  @type("number") unitMoveTargetX: number = 0;
  @type("number") unitMoveTargetY: number = 0;
  @type("boolean") isMovingUnits: boolean = false;
  
  // Nouvelles propriétés pour le système de combat
  @type("boolean") isDead: boolean = false;
  @type("number") deathTime: number = 0;
  @type("number") respawnTime: number = 0;
  @type("boolean") isInvulnerable: boolean = false;
}

// Schéma pour une unité
export class UnitSchema extends Schema {
  @type("string") id: string = "";
  @type("string") owner: string = "";
  @type("string") type: string = UnitType.WARRIOR;
  @type("number") x: number = 0;
  @type("number") y: number = 0;
  @type("number") health: number = UNIT_HEALTH.WARRIOR.MAX_HEALTH;
  @type("number") maxHealth: number = UNIT_HEALTH.WARRIOR.MAX_HEALTH;
  @type("number") rotation: number = 0;
  @type("boolean") isClickTargeting: boolean = false; // Indique si l'unité se déplace vers un point cliqué
  
  // Nouvelles propriétés pour le système de combat
  @type("number") damage: number = COMBAT.UNIT_BASE_DAMAGE; // Dégâts de base
  @type("number") lastAttackTime: number = 0; // Timestamp de la dernière attaque
  @type("string") attackTarget: string = ""; // ID de la cible actuelle
  
  // Propriétés pour l'IA des villageois
  @type("string") state: string = UnitState.IDLE; // État actuel du villageois (idle, harvesting, returning)
  @type("string") targetResourceId: string = ""; // ID de la ressource ciblée
  @type("number") carryingAmount: number = 0; // Quantité de ressources transportée
  @type("string") carryingType: string = ""; // Type de ressource transportée
  @type("string") homeBaseId: string = ""; // ID du centre-ville de rattachement
  @type("number") lastHarvestTime: number = 0; // Timestamp de la dernière récolte
  @type("boolean") isHarvesting: boolean = false; // Indique si le villageois est en animation de récolte
  
  // Propriétés pour le système anti-blocage
  @type("number") lastMoveTime: number = 0; // Timestamp du dernier mouvement enregistré
  @type("number") lastX: number = 0; // Dernière position X connue
  @type("number") lastY: number = 0; // Dernière position Y connue
  @type("number") blockedTime: number = 0; // Temps passé bloqué à la même position
  @type("number") stateStartTime: number = 0; // Temps de début de l'état actuel
}

// Schéma pour un bâtiment
export class BuildingSchema extends Schema {
  @type("string") id: string = "";
  @type("string") type: string = "";
  @type("string") owner: string = "";
  @type("number") x: number = 0;
  @type("number") y: number = 0;
  @type("number") health: number = BUILDING_HEALTH.DEFAULT;
  @type("number") maxHealth: number = BUILDING_HEALTH.DEFAULT;
  @type("number") productionProgress: number = 0; // Progression de la production (0-100)
  @type("boolean") productionActive: boolean = true; // Production active ou non
  @type("boolean") fullTileCollision: boolean = false; // Pour les bâtiments qui occupent toute la case
}

// Schéma pour une ressource
export class ResourceSchema extends Schema {
  @type("string") id: string = "";
  @type("string") type: string = "";
  @type("number") x: number = 0;
  @type("number") y: number = 0;
  @type("number") amount: number = 100;
  @type("number") maxAmount: number = 100;
  @type("number") respawnTime: number = 60000; // Temps de réapparition en ms
  @type("number") lastHarvestTime: number = 0; // Dernier temps de récolte
  @type("boolean") isRespawning: boolean = false;
}

// Constantes globales
export const TILE_SIZE = 32; // Taille d'une tuile en pixels
export const CHUNK_SIZE = 16; // Taille d'un chunk en tuiles

// Schéma principal du jeu
export class GameState extends Schema {
  @type({ map: PlayerSchema })
  players = new MapSchema<PlayerSchema>();

  @type({ map: UnitSchema })
  units = new MapSchema<UnitSchema>();

  @type({ map: BuildingSchema })
  buildings = new MapSchema<BuildingSchema>();

  @type({ map: ResourceSchema })
  resources = new MapSchema<ResourceSchema>();
} 