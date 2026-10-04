import Phaser from "phaser";
import {
  PLAYER_RADIUS,
  TILE_SIZE,
  distanceSquared,
  resourceRadius,
  touchesBuilding,
  touchesWall,
} from "shared";
import type { Building, Resource, Vector2 } from "shared";

// Phaser's RTree stores left/top/right/bottom, but searches use minX/minY/maxX/maxY.
type Collider = {
  left: number;
  top: number;
  right: number;
  bottom: number;
  id: string;
} & (
  | { kind: "resource"; entity: Resource }
  | { kind: "building"; entity: Building }
);

interface Tree {
  insert(entry: Collider): void;
  remove(entry: Collider): void;
  search(bounds: {
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
  }): Collider[];
  clear(): void;
}

/** Use Phaser's RTree broad phase, followed by the shared authoritative collision rules. */
export class Collision {
  private readonly tree = new Phaser.Structs.RTree() as Tree;
  private readonly entries = new Map<string, Collider>();
  constructor(readonly map: readonly string[]) {}
  putResource(entity: Resource): void {
    this.remove(entity.id);
    if (entity.amount <= 0) return;
    const radius = resourceRadius(entity.type);
    const entry: Collider = {
      kind: "resource",
      entity,
      id: entity.id,
      left: entity.x - radius,
      top: entity.y - radius,
      right: entity.x + radius,
      bottom: entity.y + radius,
    };
    this.entries.set(entity.id, entry);
    this.tree.insert(entry);
  }
  putBuilding(entity: Building): void {
    this.remove(entity.id);
    const entry: Collider = {
      kind: "building",
      entity,
      id: entity.id,
      left: entity.x,
      top: entity.y,
      right: entity.x + TILE_SIZE,
      bottom: entity.y + TILE_SIZE,
    };
    this.entries.set(entity.id, entry);
    this.tree.insert(entry);
  }
  remove(id: string): void {
    const entry = this.entries.get(id);
    if (entry) {
      this.tree.remove(entry);
      this.entries.delete(id);
    }
  }
  isFree(point: Vector2): boolean {
    if (touchesWall(this.map, point.x, point.y)) return false;
    const near = this.tree.search({
      minX: point.x - PLAYER_RADIUS,
      minY: point.y - PLAYER_RADIUS,
      maxX: point.x + PLAYER_RADIUS,
      maxY: point.y + PLAYER_RADIUS,
    }) as Collider[];
    return near.every((collider) =>
      collider.kind === "building"
        ? !touchesBuilding(point, collider.entity)
        : distanceSquared(point, collider.entity) >=
          (resourceRadius(collider.entity.type) + PLAYER_RADIUS) ** 2,
    );
  }
  resourceNear(point: Vector2, radius: number): Resource | undefined {
    const near = this.tree.search({
      minX: point.x - radius,
      minY: point.y - radius,
      maxX: point.x + radius,
      maxY: point.y + radius,
    }) as Collider[];
    let closest: Resource | undefined,
      distance = radius ** 2;
    for (const collider of near) {
      if (collider.kind !== "resource") continue;
      const value = distanceSquared(point, collider.entity);
      if (value <= distance) {
        distance = value;
        closest = collider.entity;
      }
    }
    return closest;
  }
  isTileOccupied(x: number, y: number): boolean {
    return (
      this.tree.search({
        minX: x + 0.01,
        minY: y + 0.01,
        maxX: x + TILE_SIZE - 0.01,
        maxY: y + TILE_SIZE - 0.01,
      }) as Collider[]
    ).some(
      (entry) =>
        Math.floor(entry.entity.x / TILE_SIZE) === x / TILE_SIZE &&
        Math.floor(entry.entity.y / TILE_SIZE) === y / TILE_SIZE,
    );
  }
  destroy(): void {
    this.tree.clear();
    this.entries.clear();
  }
}
