import { PLAYER_RADIUS, TILE_SIZE } from "./constants";
import { ResourceType } from "./types";
import type { Vector2 } from "./types";

export const distanceSquared = (a: Vector2, b: Vector2): number =>
  (a.x - b.x) ** 2 + (a.y - b.y) ** 2;

export function resourceRadius(type: ResourceType): number {
  return (
    TILE_SIZE *
    (type === ResourceType.WOOD
      ? 0.6
      : type === ResourceType.STONE
        ? 0.5
        : 0.45)
  );
}

export function isFinitePoint(
  value: unknown,
): value is Vector2 & Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    "x" in value &&
    "y" in value &&
    typeof value.x === "number" &&
    Number.isFinite(value.x) &&
    typeof value.y === "number" &&
    Number.isFinite(value.y)
  );
}

export function isInsideMap(
  map: readonly string[],
  x: number,
  y: number,
  radius = 0,
): boolean {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return false;
  return (
    x >= radius &&
    y >= radius &&
    y + radius < map.length * TILE_SIZE &&
    x + radius < (map[Math.floor(y / TILE_SIZE)]?.length ?? 0) * TILE_SIZE
  );
}

export function touchesWall(
  map: readonly string[],
  x: number,
  y: number,
  radius = PLAYER_RADIUS,
): boolean {
  if (!isInsideMap(map, x, y, radius)) return true;
  for (
    let ty = Math.floor((y - radius) / TILE_SIZE);
    ty <= Math.floor((y + radius) / TILE_SIZE);
    ty++
  ) {
    for (
      let tx = Math.floor((x - radius) / TILE_SIZE);
      tx <= Math.floor((x + radius) / TILE_SIZE);
      tx++
    ) {
      if (map[ty]?.[tx] === "#") return true;
    }
  }
  return false;
}

export function touchesBuilding(
  point: Vector2,
  building: Vector2 & { fullTileCollision: boolean },
  radius = PLAYER_RADIUS,
): boolean {
  if (building.fullTileCollision) {
    return (
      point.x + radius > building.x &&
      point.x - radius < building.x + TILE_SIZE &&
      point.y + radius > building.y &&
      point.y - radius < building.y + TILE_SIZE
    );
  }
  return (
    distanceSquared(point, {
      x: building.x + TILE_SIZE / 2,
      y: building.y + TILE_SIZE / 2,
    }) <
    (TILE_SIZE * 0.4 + radius) ** 2
  );
}
