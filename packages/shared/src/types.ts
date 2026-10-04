export enum ResourceType {
  GOLD = "gold",
  WOOD = "wood",
  STONE = "stone",
  IRON = "iron",
  COAL = "coal",
  STEEL = "steel",
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
  PLAYER_WALL = "playerWall",
}

export enum UnitType {
  WARRIOR = "warrior",
  VILLAGER = "villager",
}

export enum UnitState {
  IDLE = "idle",
  MOVING = "moving",
  HARVESTING = "harvesting",
  ATTACKING = "attacking",
  RETURNING = "returning",
}

// Types
export type Vector2 = {
  x: number;
  y: number;
};
