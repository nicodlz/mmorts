import {
  Building,
  Player,
  Resource,
  Unit,
  WorldState,
  PLAYER_RADIUS,
  TILE_SIZE,
  distanceSquared,
  resourceRadius,
  touchesBuilding,
  touchesWall,
} from "shared";
import type { Vector2 } from "shared";
import type { WorldData } from "../world/worldManager";
import { SpatialIndex } from "./SpatialIndex";

/** Room-local simulation data. Only state's decorated fields go over the wire. */
export class World {
  readonly state = new WorldState();
  get players() {
    return this.state.players;
  }
  get units() {
    return this.state.units;
  }
  get buildings() {
    return this.state.buildings;
  }
  get resources() {
    return this.state.resources;
  }
  readonly resourceIndex = new SpatialIndex<Resource>();
  readonly buildingIndex = new SpatialIndex<Building>();
  readonly unitIndex = new SpatialIndex<Unit>();
  readonly playerIndex = new SpatialIndex<Player>();
  readonly unitsByOwner = new Map<string, Set<string>>();
  readonly buildingsByOwner = new Map<string, Set<string>>();
  readonly buildingsByTile = new Map<string, Building>();
  readonly resourcesByTile = new Map<string, Resource>();
  readonly dirtyTiles = new Set<string>();
  readonly map: string[];
  navigationVersion = 0;
  private nextId = 0;

  constructor(data: WorldData) {
    this.map = [...data.mapLines];
    // A room must never share mutable resources with another room.
    for (const template of data.resources) {
      const resource = new Resource();
      Object.assign(resource, {
        id: template.id,
        type: template.type,
        x: template.x,
        y: template.y,
        amount: template.amount,
        maxAmount: template.maxAmount,
      });
      this.resources.set(resource.id, resource);
      this.resourceIndex.put(resource);
      this.resourcesByTile.set(this.tileKey(resource.x, resource.y), resource);
    }
  }
  id(prefix: string): string {
    return `${prefix}_${++this.nextId}`;
  }
  tileKey(x: number, y: number): string {
    return `${Math.floor(x / TILE_SIZE)},${Math.floor(y / TILE_SIZE)}`;
  }
  invalidate(x: number, y: number): void {
    this.navigationVersion++;
    this.dirtyTiles.add(this.tileKey(x, y));
  }

  isFree(x: number, y: number, radius = PLAYER_RADIUS): boolean {
    if (touchesWall(this.map, x, y, radius)) return false;
    const point = { x, y };
    for (const resource of this.resourceIndex.queryRadius(
      x,
      y,
      TILE_SIZE + radius,
    )) {
      if (
        resource.amount > 0 &&
        distanceSquared(point, resource) <
          (resourceRadius(resource.type) + radius) ** 2
      )
        return false;
    }
    for (const building of this.buildingIndex.queryBox(
      x - TILE_SIZE * 2,
      y - TILE_SIZE * 2,
      x + TILE_SIZE,
      y + TILE_SIZE,
    )) {
      if (touchesBuilding(point, building, radius)) return false;
    }
    return true;
  }
  segmentIsFree(from: Vector2, to: Vector2, radius = PLAYER_RADIUS): boolean {
    const steps = Math.max(
      1,
      Math.ceil(Math.sqrt(distanceSquared(from, to)) / Math.max(2, radius)),
    );
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      if (
        !this.isFree(
          from.x + (to.x - from.x) * t,
          from.y + (to.y - from.y) * t,
          radius,
        )
      )
        return false;
    }
    return true;
  }
  findSpawn(center: Vector2, avoidUnits = false): Vector2 | undefined {
    for (let ring = 0; ring <= 12; ring++) {
      for (let dy = -ring; dy <= ring; dy++) {
        for (let dx = -ring; dx <= ring; dx++) {
          if (ring > 0 && Math.max(Math.abs(dx), Math.abs(dy)) !== ring)
            continue;
          const point = {
            x: center.x + dx * TILE_SIZE,
            y: center.y + dy * TILE_SIZE,
          };
          if (
            this.isFree(point.x, point.y) &&
            (!avoidUnits ||
              this.unitIndex.queryRadius(point.x, point.y, 12).length === 0)
          )
            return point;
        }
      }
    }
    return undefined;
  }
  addUnit(unit: Unit): void {
    this.units.set(unit.id, unit);
    this.unitIndex.put(unit);
    this.ownerSet(this.unitsByOwner, unit.owner).add(unit.id);
    this.recountPopulation(unit.owner);
  }
  removeUnit(id: string): void {
    const unit = this.units.get(id);
    if (!unit) return;
    this.units.delete(id);
    this.unitIndex.remove(id);
    const owned = this.unitsByOwner.get(unit.owner);
    owned?.delete(id);
    if (owned?.size === 0) this.unitsByOwner.delete(unit.owner);
    this.recountPopulation(unit.owner);
  }
  addBuilding(building: Building): void {
    this.buildings.set(building.id, building);
    this.buildingIndex.put(building);
    this.buildingsByTile.set(this.tileKey(building.x, building.y), building);
    this.ownerSet(this.buildingsByOwner, building.owner).add(building.id);
    this.invalidate(building.x, building.y);
  }
  removeBuilding(id: string): void {
    const building = this.buildings.get(id);
    if (!building) return;
    this.buildings.delete(id);
    this.buildingIndex.remove(id);
    this.buildingsByTile.delete(this.tileKey(building.x, building.y));
    const owned = this.buildingsByOwner.get(building.owner);
    owned?.delete(id);
    if (owned?.size === 0) this.buildingsByOwner.delete(building.owner);
    this.invalidate(building.x, building.y);
  }
  private recountPopulation(ownerId: string): void {
    const player = this.players.get(ownerId);
    if (player)
      player.population = 1 + (this.unitsByOwner.get(ownerId)?.size ?? 0);
  }
  private ownerSet(
    index: Map<string, Set<string>>,
    owner: string,
  ): Set<string> {
    let ids = index.get(owner);
    if (!ids) index.set(owner, (ids = new Set()));
    return ids;
  }
}
