import { js as EasyStar } from "easystarjs";
import { TILE_SIZE, distanceSquared } from "shared";
import type { Unit, Vector2 } from "shared";
import type { World } from "./World";

/** EasyStar supplies A*, its priority queue, cancellation and incremental work budget. */
export class Navigation {
  private readonly finder = new EasyStar();
  private readonly grid: number[][];
  private readonly pending = new Map<string, { task?: number }>();

  constructor(private readonly world: World) {
    this.grid = world.map.map((row, y) =>
      [...row].map((_, x) => this.walkable(x, y)),
    );
    this.finder.setGrid(this.grid);
    this.finder.setAcceptableTiles([0]);
    this.finder.enableDiagonals();
    this.finder.disableCornerCutting();
    this.finder.setIterationsPerCalculation(2048);
    // Keep asynchronous mode: enableSync() would reset the library's iteration counter.
  }
  update(): void {
    if (this.world.dirtyTiles.size) {
      for (const key of this.world.dirtyTiles) {
        const [x, y] = key.split(",").map(Number);
        for (let dy = -1; dy <= 1; dy++)
          for (let dx = -1; dx <= 1; dx++) {
            const row = this.grid[y + dy];
            if (row && x + dx >= 0 && x + dx < row.length)
              row[x + dx] = this.walkable(x + dx, y + dy);
          }
      }
      this.world.dirtyTiles.clear();
    }
    for (const id of this.pending.keys())
      if (!this.world.units.has(id)) this.cancel(id);
    this.finder.calculate();
  }
  move(
    unit: Unit,
    target: Vector2,
    speed: number,
    deltaMs: number,
    now: number,
    stoppingDistance = 2,
  ): boolean {
    const distance = Math.sqrt(distanceSquared(unit, target));
    if (distance <= stoppingDistance) {
      this.cancel(unit.id);
      return true;
    }
    const step = Math.min(
      (speed * deltaMs) / 1000,
      distance - stoppingDistance,
    );
    const direct = {
      x: unit.x + ((target.x - unit.x) / distance) * step,
      y: unit.y + ((target.y - unit.y) / distance) * step,
    };
    if (distance < TILE_SIZE * 3 && this.world.segmentIsFree(unit, target, 3)) {
      this.cancel(unit.id);
      unit.path = [];
      this.apply(unit, direct, target);
      return false;
    }
    const key = this.world.tileKey(target.x, target.y);
    // Keep completed paths after distant map edits; each movement checks the current obstacles.
    if (
      unit.pathTarget !== key ||
      (!unit.path.length &&
        !this.pending.has(unit.id) &&
        unit.pathVersion !== this.world.navigationVersion)
    ) {
      this.cancel(unit.id);
      unit.path = [];
      unit.nextPathTime = 0;
      unit.pathFailed = false;
    }
    if (
      !unit.path.length &&
      !this.pending.has(unit.id) &&
      now >= unit.nextPathTime
    ) {
      const goal = this.nearestWalkable(target);
      unit.pathTarget = key;
      unit.pathVersion = this.world.navigationVersion;
      unit.nextPathTime = now + 1000;
      unit.pathFailed = !goal;
      if (goal) {
        const request: { task?: number } = {};
        this.pending.set(unit.id, request);
        const task = this.finder.findPath(
          Math.floor(unit.x / TILE_SIZE),
          Math.floor(unit.y / TILE_SIZE),
          goal.x,
          goal.y,
          (path) => {
            if (this.pending.get(unit.id) !== request) return;
            this.pending.delete(unit.id);
            if (this.world.units.has(unit.id) && unit.pathTarget === key) {
              unit.pathVersion = this.world.navigationVersion;
              unit.pathFailed = path === null;
              unit.path = path
                ? path
                    .slice(1)
                    .map((p) => ({
                      x: p.x * TILE_SIZE + TILE_SIZE / 2,
                      y: p.y * TILE_SIZE + TILE_SIZE / 2,
                    }))
                : [];
            }
          },
        );
        request.task = task;
      }
    }
    const waypoint = unit.path[0];
    if (!waypoint) {
      // Sliding handles near obstacles while the bounded search is pending.
      if (this.world.segmentIsFree(unit, direct, 3))
        this.apply(unit, direct, target);
      return false;
    }
    const remaining = Math.sqrt(distanceSquared(unit, waypoint));
    const amount = Math.min(step, remaining);
    const next =
      remaining <= 0.01
        ? waypoint
        : {
            x: unit.x + ((waypoint.x - unit.x) / remaining) * amount,
            y: unit.y + ((waypoint.y - unit.y) / remaining) * amount,
          };
    if (this.world.segmentIsFree(unit, next, 3)) {
      this.apply(unit, next, waypoint);
      if (remaining <= step + 0.1) unit.path.shift();
    } else {
      unit.path = [];
      unit.pathVersion = this.world.navigationVersion;
      unit.nextPathTime = now + 250;
    }
    return false;
  }
  cancel(id: string): void {
    const task = this.pending.get(id)?.task;
    if (task !== undefined) this.finder.cancelPath(task);
    this.pending.delete(id);
  }
  dispose(): void {
    for (const id of this.pending.keys()) this.cancel(id);
  }
  private apply(unit: Unit, point: Vector2, target: Vector2): void {
    unit.rotation = Math.atan2(target.y - unit.y, target.x - unit.x);
    unit.x = point.x;
    unit.y = point.y;
    this.world.unitIndex.put(unit);
  }
  private walkable(x: number, y: number): number {
    return this.world.isFree(
      x * TILE_SIZE + TILE_SIZE / 2,
      y * TILE_SIZE + TILE_SIZE / 2,
      3,
    )
      ? 0
      : 1;
  }
  private nearestWalkable(target: Vector2): Vector2 | undefined {
    const tx = Math.floor(target.x / TILE_SIZE),
      ty = Math.floor(target.y / TILE_SIZE);
    let best: Vector2 | undefined;
    let bestDistance = Infinity;
    for (let dy = -2; dy <= 2; dy++)
      for (let dx = -2; dx <= 2; dx++) {
        const x = tx + dx,
          y = ty + dy;
        if (this.grid[y]?.[x] !== 0) continue;
        const distance = distanceSquared(target, {
          x: x * TILE_SIZE + TILE_SIZE / 2,
          y: y * TILE_SIZE + TILE_SIZE / 2,
        });
        if (distance < bestDistance) {
          bestDistance = distance;
          best = { x, y };
        }
      }
    return best;
  }
}
