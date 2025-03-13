import { Schema, type, MapSchema } from "@colyseus/schema";

// Types de ressources
export enum ResourceType {
  GOLD = "gold",
  WOOD = "wood",
  STONE = "stone",
  IRON = "iron",
  COAL = "coal",
  STEEL = "steel"
}

// Constantes
export const TILE_SIZE = 32;
export const CHUNK_SIZE = 16;

// Schéma pour un joueur
export class PlayerSchema extends Schema {
  @type("string") id: string;
  @type("string") name: string = "Player";
  @type("number") x: number = 0;
  @type("number") y: number = 0;
  @type("number") health: number = 600;
  @type("number") maxHealth: number = 600;
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
  @type("string") id: string;
  @type("string") owner: string;
  @type("string") type: string;
  @type("number") x: number = 0;
  @type("number") y: number = 0;
  @type("number") health: number = 100;
  @type("number") maxHealth: number = 100;
  @type("number") rotation: number = 0;
  @type("boolean") isClickTargeting: boolean = false; // Indique si l'unité se déplace vers un point cliqué
  
  // Nouvelles propriétés pour le système de combat
  @type("number") damage: number = 25; // Dégâts de base
  @type("number") lastAttackTime: number = 0; // Timestamp de la dernière attaque
  @type("string") attackTarget: string = ""; // ID de la cible actuelle
}

// Schéma pour un bâtiment
export class BuildingSchema extends Schema {
  @type("string") id: string;
  @type("string") owner: string;
  @type("string") type: string;
  @type("number") x: number = 0;
  @type("number") y: number = 0;
  @type("number") health: number = 100;
  @type("number") maxHealth: number = 100;
  @type("number") productionProgress: number = 0;
  @type("boolean") productionActive: boolean = true;
  @type("number") progress: number = 0; // Pour les bâtiments en construction
  @type("boolean") fullTileCollision: boolean = false; // Pour les bâtiments qui occupent toute la case
}

// Schéma pour une ressource
export class ResourceSchema extends Schema {
  @type("string") id: string;
  @type("string") type: string;
  @type("number") x: number = 0;
  @type("number") y: number = 0;
  @type("number") amount: number = 100;
  @type("number") maxAmount: number = 100;
  @type("number") respawnTime: number = 60000; // Temps de réapparition en ms
  @type("number") lastHarvestTime: number = 0; // Dernier temps de récolte
  @type("boolean") isRespawning: boolean = false;
}

// Schéma principal du jeu
export class GameState extends Schema {
  @type({ map: PlayerSchema }) players = new MapSchema<PlayerSchema>();
  @type({ map: UnitSchema }) units = new MapSchema<UnitSchema>();
  @type({ map: BuildingSchema }) buildings = new MapSchema<BuildingSchema>();
  @type({ map: ResourceSchema }) resources = new MapSchema<ResourceSchema>();
} 