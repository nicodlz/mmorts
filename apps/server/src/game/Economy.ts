import {
  BUILDING_COSTS,
  BUILDING_HEALTH,
  Building,
  BuildingType,
  HARVEST_AMOUNT,
  MINING_CONFIG,
  POPULATION,
  PRODUCTION_RATES,
  PRODUCTION_RECIPES,
  RESOURCE_RESPAWN_TIMES,
  TILE_SIZE,
  distanceSquared,
  isInsideMap,
} from "shared";
import type {
  GameEvent,
  Player,
  Resource,
  ResourceAmounts,
  Vector2,
} from "shared";
import type { World } from "./World";

export type EmitEvent = (event: GameEvent, owner?: string) => void;
const buildingHealth: Partial<Record<BuildingType, number>> = {
  [BuildingType.HOUSE]: BUILDING_HEALTH.HOUSE,
  [BuildingType.FORGE]: BUILDING_HEALTH.FORGE,
  [BuildingType.FURNACE]: BUILDING_HEALTH.FURNACE,
  [BuildingType.FACTORY]: BUILDING_HEALTH.FACTORY,
  [BuildingType.TOWN_CENTER]: BUILDING_HEALTH.TOWN_CENTER,
  [BuildingType.BARRACKS]: BUILDING_HEALTH.BARRACKS,
  [BuildingType.PLAYER_WALL]: BUILDING_HEALTH.WALL,
};

export class Economy {
  private readonly harvestTimes = new Map<string, number>();
  private readonly respawning = new Map<string, Resource>();
  private readonly producing = new Map<string, Building>();
  constructor(
    private readonly world: World,
    private readonly emit: EmitEvent,
  ) {}

  canAfford(player: Player, costs: ResourceAmounts): boolean {
    return Object.entries(costs).every(
      ([type, amount]) => (player.resources.get(type) ?? 0) >= amount,
    );
  }
  spend(player: Player, costs: ResourceAmounts): void {
    for (const [type, amount] of Object.entries(costs))
      player.resources.set(type, (player.resources.get(type) ?? 0) - amount);
  }
  harvest(player: Player, id: string, now: number): string | undefined {
    if (player.isDead) return "Vous êtes mort.";
    const resource = this.world.resources.get(id);
    if (!resource || resource.amount <= 0) return "Ressource épuisée.";
    if (distanceSquared(player, resource) > 50 ** 2)
      return "Ressource trop éloignée.";
    if (
      now - (this.harvestTimes.get(player.id) ?? -Infinity) <
      MINING_CONFIG.COOLDOWN
    )
      return "cooldown";
    const amount = Math.min(resource.amount, HARVEST_AMOUNT[resource.type]);
    if (amount <= 0) return "Cette ressource doit être produite.";
    this.harvestTimes.set(player.id, now);
    this.consume(resource, amount, now);
    player.resources.set(
      resource.type,
      (player.resources.get(resource.type) ?? 0) + amount,
    );
    this.emit(
      {
        kind: "harvest",
        entityId: resource.id,
        x: resource.x,
        y: resource.y,
        amount,
        resourceType: resource.type,
      },
      player.id,
    );
  }
  consume(resource: Resource, amount: number, now: number): void {
    resource.amount = Math.max(0, resource.amount - amount);
    if (resource.amount === 0) {
      this.world.resourceIndex.remove(resource.id);
      this.world.invalidate(resource.x, resource.y);
      const delay = RESOURCE_RESPAWN_TIMES[resource.type];
      if (delay > 0) {
        resource.respawnAt = now + delay;
        this.respawning.set(resource.id, resource);
      }
    }
  }
  build(
    player: Player,
    type: BuildingType,
    position: Vector2,
  ): string | undefined {
    if (player.isDead) return "Vous êtes mort.";
    const x = Math.floor(position.x / TILE_SIZE) * TILE_SIZE,
      y = Math.floor(position.y / TILE_SIZE) * TILE_SIZE;
    if (
      !isInsideMap(this.world.map, x, y) ||
      this.world.map[y / TILE_SIZE]?.[x / TILE_SIZE] === "#"
    )
      return "Emplacement invalide.";
    const distance = Math.max(
      Math.abs(Math.floor(player.x / TILE_SIZE) - x / TILE_SIZE),
      Math.abs(Math.floor(player.y / TILE_SIZE) - y / TILE_SIZE),
    );
    if (distance > 2) return "Construction trop éloignée.";
    const key = this.world.tileKey(x, y);
    if (
      this.world.buildingsByTile.has(key) ||
      (this.world.resourcesByTile.get(key)?.amount ?? 0) > 0
    )
      return "Emplacement occupé.";
    // Do not trap a player or an army inside a newly placed building.
    if (
      this.world.playerIndex.queryBox(
        x - 6,
        y - 6,
        x + TILE_SIZE + 6,
        y + TILE_SIZE + 6,
      ).length ||
      this.world.unitIndex.queryBox(
        x - 3,
        y - 3,
        x + TILE_SIZE + 3,
        y + TILE_SIZE + 3,
      ).length
    )
      return "Une unité occupe cet emplacement.";
    const costs = BUILDING_COSTS[type];
    if (!this.canAfford(player, costs)) return "Ressources insuffisantes.";
    const building = new Building();
    building.id = this.world.id(type);
    building.owner = player.id;
    building.type = type;
    building.x = x;
    building.y = y;
    building.fullTileCollision = type === BuildingType.PLAYER_WALL;
    building.health = building.maxHealth =
      buildingHealth[type] ?? BUILDING_HEALTH.DEFAULT;
    this.spend(player, costs);
    this.world.addBuilding(building);
    if (PRODUCTION_RATES[type]) this.producing.set(building.id, building);
    if (type === BuildingType.HOUSE)
      player.maxPopulation += POPULATION.HOUSE_INCREASE;
  }
  destroy(id: string, recycle = false): void {
    const building = this.world.buildings.get(id);
    if (!building) return;
    const owner = this.world.players.get(building.owner);
    if (owner) {
      if (recycle) {
        for (const [type, cost] of Object.entries(
          BUILDING_COSTS[building.type],
        )) {
          owner.resources.set(
            type,
            (owner.resources.get(type) ?? 0) + Math.floor(cost * 0.75),
          );
        }
      }
      if (building.type === BuildingType.HOUSE)
        owner.maxPopulation = Math.max(
          POPULATION.DEFAULT_MAX,
          owner.maxPopulation - POPULATION.HOUSE_INCREASE,
        );
      // Existing units continue to count even when housing capacity decreases.
    }
    this.producing.delete(id);
    this.world.removeBuilding(id);
  }
  update(deltaMs: number, now: number): void {
    for (const building of this.producing.values()) {
      const owner = this.world.players.get(building.owner);
      const duration = PRODUCTION_RATES[building.type],
        recipe = PRODUCTION_RECIPES[building.type];
      if (
        !owner ||
        owner.isDead ||
        !building.productionActive ||
        !duration ||
        !recipe
      )
        continue;
      building.productionElapsed = Math.min(
        duration,
        building.productionElapsed + deltaMs,
      );
      building.productionProgress = Math.floor(
        (building.productionElapsed / duration) * 100,
      );
      if (
        building.productionElapsed < duration ||
        !this.canAfford(owner, recipe.inputs)
      )
        continue;
      this.spend(owner, recipe.inputs);
      for (const [type, amount] of Object.entries(recipe.outputs))
        owner.resources.set(type, (owner.resources.get(type) ?? 0) + amount);
      building.productionElapsed = 0;
      building.productionProgress = 0;
      this.emit(
        {
          kind: "production",
          entityId: building.id,
          x: building.x + TILE_SIZE / 2,
          y: building.y + TILE_SIZE / 2,
        },
        owner.id,
      );
    }
    for (const [id, resource] of this.respawning) {
      if (now < resource.respawnAt) continue;
      // A depleted tile may have been built over; do not respawn inside the building.
      if (
        this.world.buildingsByTile.has(
          this.world.tileKey(resource.x, resource.y),
        )
      )
        continue;
      resource.amount = resource.maxAmount;
      resource.respawnAt = 0;
      this.world.resourceIndex.put(resource);
      this.world.invalidate(resource.x, resource.y);
      this.respawning.delete(id);
    }
  }
  forgetPlayer(id: string): void {
    this.harvestTimes.delete(id);
  }
}
