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
  @type("number") x: number = 0;
  @type("number") y: number = 0;
  @type("number") hue: number = 0;
  @type("string") name: string = "";
  @type({ map: "number" }) resources = new MapSchema<number>();
}

// Schéma pour une unité
export class UnitSchema extends Schema {
  @type("string") id: string;
  @type("string") owner: string;
  @type("string") type: string;
  @type("number") x: number = 0;
  @type("number") y: number = 0;
  @type("number") health: number = 100;
  @type("number") rotation: number = 0;
}

// Schéma pour un bâtiment
export class BuildingSchema extends Schema {
  @type("string") id: string;
  @type("string") owner: string;
  @type("string") type: string;
  @type("number") x: number = 0;
  @type("number") y: number = 0;
  @type("number") health: number = 100;
  @type("number") progress: number = 0; // Pour les bâtiments en construction
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