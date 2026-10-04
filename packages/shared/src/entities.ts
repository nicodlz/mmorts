import { Schema, MapSchema, type, view } from "@colyseus/schema";
import { BuildingType, ResourceType, UnitState, UnitType } from "./types";
import {
  BUILDING_HEALTH,
  COMBAT,
  PLAYER_HEALTH,
  POPULATION,
  UNIT_HEALTH,
} from "./balance";

export class Player extends Schema {
  @type("string")
  id = "";
  @type("string")
  name = "Player";
  @type("number")
  x = 0;
  @type("number")
  y = 0;
  @type("number")
  hue = 0;
  @type("number")
  health = PLAYER_HEALTH.MAX_HEALTH;
  @type("number")
  maxHealth = PLAYER_HEALTH.MAX_HEALTH;
  @view(1)
  @type("number")
  population = 1;
  @view(1)
  @type("number")
  maxPopulation = POPULATION.DEFAULT_MAX;
  @view(1)
  @type({ map: "number" })
  resources = new MapSchema<number>();
  cursorTargetX = 0;
  cursorTargetY = 0;
  isTargetMode = false;
  unitMoveTargetX = 0;
  unitMoveTargetY = 0;
  isMovingUnits = false;
  @type("boolean")
  isDead = false;
  @view(1)
  @type("number")
  respawnTime = 0;
  @type("boolean")
  isInvulnerable = false;
  invulnerableUntil = 0;
}

export class Unit extends Schema {
  @type("string")
  id = "";
  @type("string")
  owner = "";
  @type("string")
  type = UnitType.WARRIOR;
  @type("number")
  x = 0;
  @type("number")
  y = 0;
  @type("number")
  rotation = 0;
  @type("number")
  health = UNIT_HEALTH.WARRIOR.MAX_HEALTH;
  @type("number")
  maxHealth = UNIT_HEALTH.WARRIOR.MAX_HEALTH;
  damage = COMBAT.UNIT_BASE_DAMAGE;
  lastAttackTime = 0;
  @type("string")
  state = UnitState.IDLE;
  targetResourceId = "";
  carryingAmount = 0;
  carryingType: ResourceType | undefined;
  homeBaseId = "";
  lastHarvestTime = 0;
  @type("boolean")
  isHarvesting = false;
  nextSearchTime = 0;
  path: { x: number; y: number }[] = [];
  pathTarget = "";
  pathVersion = -1;
  nextPathTime = 0;
  pathFailed = false;
  ignoredResources = new Map<string, number>();
  lastTravelProgress = 0;
  travelX = 0;
  travelY = 0;
}

export class Building extends Schema {
  @type("string")
  id = "";
  @type("string")
  type = BuildingType.HOUSE;
  @type("string")
  owner = "";
  @type("number")
  x = 0;
  @type("number")
  y = 0;
  @type("number")
  health = BUILDING_HEALTH.DEFAULT;
  @type("number")
  maxHealth = BUILDING_HEALTH.DEFAULT;
  @type("number")
  productionProgress = 0;
  productionElapsed = 0;
  @type("boolean")
  productionActive = true;
  @type("boolean")
  fullTileCollision = false;
}

export class Resource extends Schema {
  @type("string")
  id = "";
  @type("string")
  type = ResourceType.GOLD;
  @type("number")
  x = 0;
  @type("number")
  y = 0;
  @type("number")
  amount = 100;
  maxAmount = 100;
  respawnAt = 0;
}

export class WorldState extends Schema {
  @view()
  @type({ map: Player })
  players = new MapSchema<Player>();
  @view()
  @type({ map: Unit })
  units = new MapSchema<Unit>();
  @view()
  @type({ map: Building })
  buildings = new MapSchema<Building>();
  @view()
  @type({ map: Resource })
  resources = new MapSchema<Resource>();
}
