import { Schema, type, MapSchema } from "@colyseus/schema";

// Enum de types
export enum ResourceType {
  GOLD = "gold",
  WOOD = "wood",
  STONE = "stone",
  IRON = "iron",
  COAL = "coal",
  STEEL = "steel"
}

export enum BuildingType {
  FORGE = "forge",
  HOUSE = "house",
  FURNACE = "furnace",
  FACTORY = "factory",
  TOWER = "tower",
  BARRACKS = "barracks",
  TOWN_CENTER = "town_center",
  YARD = "yard",
  CABIN = "cabin"
}

export enum UnitType {
  WARRIOR = "warrior",
  VILLAGER = "villager"
}

export enum UnitState {
  IDLE = "idle",
  MOVING = "moving",
  HARVESTING = "harvesting",
  ATTACKING = "attacking",
  RETURNING = "returning"
}

// Types
export type Vector2 = {
  x: number;
  y: number;
};

// Schémas Colyseus
export class PlayerSchema extends Schema {
  @type("string") id: string = "";
  @type("number") x: number = 0;
  @type("number") y: number = 0;
  @type("number") rotation: number = 0;
  @type("number") health: number = 100;
  @type("number") maxHealth: number = 100;
  @type("number") population: number = 0;
  @type("number") maxPopulation: number = 10;
  @type("string") tool: string = "pickaxe";
  @type({ map: "number" }) resources = new MapSchema<number>();
}

export class UnitSchema extends Schema {
  @type("string") id: string = "";
  @type("string") type: string = UnitType.WARRIOR;
  @type("number") x: number = 0;
  @type("number") y: number = 0;
  @type("number") rotation: number = 0;
  @type("number") health: number = 100;
  @type("number") maxHealth: number = 100;
  @type("string") state: string = UnitState.IDLE;
  @type("number") targetX?: number;
  @type("number") targetY?: number;
}

export class BuildingSchema extends Schema {
  @type("string") id: string = "";
  @type("string") type: string = BuildingType.HOUSE;
  @type("number") x: number = 0;
  @type("number") y: number = 0;
  @type("number") health: number = 100;
  @type("number") maxHealth: number = 100;
  @type("number") productionProgress?: number;
  @type("number") influenceRadius?: number;
}

export class ResourceSchema extends Schema {
  @type("string") id: string = "";
  @type("string") type: string = ResourceType.GOLD;
  @type("number") x: number = 0;
  @type("number") y: number = 0;
  @type("number") amount: number = 100;
}

// Constants
export const TILE_SIZE = 32;
export const CHUNK_SIZE = 16; // 16x16 tiles

// Building Costs
export const BUILDING_COSTS = {
  [BuildingType.FORGE]: { wood: 20, stone: 20 },
  [BuildingType.HOUSE]: { wood: 10, stone: 10 },
  [BuildingType.FURNACE]: { stone: 30 },
  [BuildingType.FACTORY]: { iron: 20, stone: 20 },
  [BuildingType.TOWER]: { wood: 50, iron: 5 },
  [BuildingType.BARRACKS]: { wood: 10, iron: 10 },
  [BuildingType.TOWN_CENTER]: { stone: 30, wood: 30, gold: 30 },
  [BuildingType.YARD]: { iron: 20 },
  [BuildingType.CABIN]: { steel: 20 }
}; 