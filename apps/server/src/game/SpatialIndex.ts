import RBush from "rbush";
import type { Vector2 } from "shared";

type Entry<T> = {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  entity: T;
};

/** RBush owns the tree; this adapter preserves entry bounds while entities move. */
export class SpatialIndex<T extends Vector2 & { id: string }> {
  private readonly tree = new RBush<Entry<T>>();
  private readonly entries = new Map<string, Entry<T>>();

  put(entity: T): void {
    const old = this.entries.get(entity.id);
    if (old?.minX === entity.x && old.minY === entity.y) return;
    this.remove(entity.id);
    const entry = {
      minX: entity.x,
      maxX: entity.x,
      minY: entity.y,
      maxY: entity.y,
      entity,
    };
    this.entries.set(entity.id, entry);
    this.tree.insert(entry);
  }
  remove(id: string): void {
    const entry = this.entries.get(id);
    if (!entry) return;
    this.tree.remove(entry);
    this.entries.delete(id);
  }
  queryBox(minX: number, minY: number, maxX: number, maxY: number): T[] {
    return this.tree
      .search({ minX, minY, maxX, maxY })
      .map((entry) => entry.entity);
  }
  queryRadius(x: number, y: number, radius: number): T[] {
    return this.queryBox(x - radius, y - radius, x + radius, y + radius).filter(
      (entity) => (entity.x - x) ** 2 + (entity.y - y) ** 2 <= radius ** 2,
    );
  }
  clear(): void {
    this.tree.clear();
    this.entries.clear();
  }
}
