import { BuildingType, ResourceType } from "./types";

// Constants
export const TILE_SIZE = 32;
export const CHUNK_SIZE = 16; // 16x16 tiles

// Building Costs
export type ResourceAmounts = Partial<Record<ResourceType, number>>;
export type BuildingCosts = Record<BuildingType, ResourceAmounts>;

export const BUILDING_COSTS: BuildingCosts = {
  [BuildingType.FORGE]: { [ResourceType.WOOD]: 20, [ResourceType.STONE]: 20 },
  [BuildingType.HOUSE]: { [ResourceType.WOOD]: 10, [ResourceType.STONE]: 10 },
  [BuildingType.FURNACE]: { [ResourceType.STONE]: 30 },
  [BuildingType.FACTORY]: { [ResourceType.IRON]: 20, [ResourceType.STONE]: 20 },
  [BuildingType.TOWER]: { [ResourceType.WOOD]: 50, [ResourceType.IRON]: 5 },
  [BuildingType.BARRACKS]: { [ResourceType.WOOD]: 10, [ResourceType.IRON]: 10 },
  [BuildingType.TOWN_CENTER]: {
    [ResourceType.STONE]: 30,
    [ResourceType.WOOD]: 30,
    [ResourceType.GOLD]: 30,
  },
  [BuildingType.YARD]: { [ResourceType.IRON]: 20 },
  [BuildingType.CABIN]: { [ResourceType.STEEL]: 20 },
  [BuildingType.PLAYER_WALL]: { [ResourceType.STONE]: 10 },
};

export const PLAYER_SPEED = 180;
export const INTEREST_RADIUS = 2;
export const PLAYER_RADIUS = 6;
