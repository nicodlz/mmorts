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
  TOWN_CENTER = "tc",
  YARD = "quarry",
  CABIN = "hut",
  PLAYER_WALL = "playerWall"
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
  @type("string") name: string = "";
  @type("number") hue: number = 0;
  @type("number") x: number = 0;
  @type("number") y: number = 0;
  @type("number") rotation: number = 0;
  @type("number") health: number = 300;
  @type("number") maxHealth: number = 300;
  @type("number") population: number = 0;
  @type("number") maxPopulation: number = 0;
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
  @type("string") owner: string = "";
  @type("number") x: number = 0;
  @type("number") y: number = 0;
  @type("number") health: number = 100;
  @type("number") maxHealth: number = 100;
  @type("number") productionProgress: number = 0;
  @type("boolean") productionActive: boolean = true;
  @type("number") influenceRadius?: number;
  @type("boolean") fullTileCollision: boolean = false;
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
export interface BuildingCosts {
  [key: string]: {
    [resource: string]: number;
  };
}

export const BUILDING_COSTS: BuildingCosts = {
  [BuildingType.FORGE]: { [ResourceType.WOOD]: 20, [ResourceType.STONE]: 20 },
  [BuildingType.HOUSE]: { [ResourceType.WOOD]: 10, [ResourceType.STONE]: 10 },
  [BuildingType.FURNACE]: { [ResourceType.STONE]: 30 },
  [BuildingType.FACTORY]: { [ResourceType.IRON]: 20, [ResourceType.STONE]: 20 },
  [BuildingType.TOWER]: { [ResourceType.WOOD]: 50, [ResourceType.IRON]: 5 },
  [BuildingType.BARRACKS]: { [ResourceType.WOOD]: 10, [ResourceType.IRON]: 10 },
  [BuildingType.TOWN_CENTER]: { [ResourceType.STONE]: 30, [ResourceType.WOOD]: 30, [ResourceType.GOLD]: 30 },
  [BuildingType.YARD]: { [ResourceType.IRON]: 20 },
  [BuildingType.CABIN]: { [ResourceType.STEEL]: 20 },
  [BuildingType.PLAYER_WALL]: { [ResourceType.STONE]: 10 }
};

export class GameState extends Schema {
  @type({ map: PlayerSchema }) players = new MapSchema<PlayerSchema>();
  @type({ map: UnitSchema }) units = new MapSchema<UnitSchema>();
  @type({ map: BuildingSchema }) buildings = new MapSchema<BuildingSchema>();
  @type({ map: ResourceSchema }) resources = new MapSchema<ResourceSchema>();
}

// Exporter toutes les constantes de balance
export {
  PLAYER_HEALTH,
  UNIT_HEALTH,
  BUILDING_HEALTH,
  COMBAT,
  PRODUCTION_RATES,
  PRODUCTION_RECIPES,
  MINING_CONFIG,
  RESOURCE_AMOUNTS,
  RESOURCE_RESPAWN_TIMES,
  UNIT_COSTS,
  UNIT_SPEED,
  DEATH_SYSTEM,
  POPULATION,
  PERFORMANCE,
  PLAYER_STARTING_RESOURCES,
  HARVEST_AMOUNT
} from './balance'; 