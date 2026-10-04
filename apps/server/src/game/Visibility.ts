import type { Client } from "@colyseus/core";
import { Schema, StateView } from "@colyseus/schema";
import {
  CHUNK_SIZE,
  INTEREST_RADIUS,
  TILE_SIZE,
  distanceSquared,
} from "shared";
import type { GameEvent } from "shared";
import type { World } from "./World";

/** Colyseus owns schema encoding, per-field deltas and add/remove notifications. */
export class Visibility {
  private readonly visible = new Map<string, Map<string, Schema>>();
  constructor(private readonly world: World) {}

  join(client: Client): void {
    client.view = new StateView();
    this.visible.set(client.sessionId, new Map());
    const player = this.world.players.get(client.sessionId);
    if (player) client.view.add(player, 1); // Private inventory, population and respawn deadline.
    this.update(client);
  }
  update(client: Client): void {
    const player = this.world.players.get(client.sessionId);
    const previous = this.visible.get(client.sessionId);
    if (!player || !previous || !client.view) return;
    const size = CHUNK_SIZE * TILE_SIZE;
    const cx = Math.floor(player.x / size),
      cy = Math.floor(player.y / size);
    const minX = (cx - INTEREST_RADIUS) * size,
      minY = (cy - INTEREST_RADIUS) * size;
    const maxX = (cx + INTEREST_RADIUS + 1) * size - 0.001,
      maxY = (cy + INTEREST_RADIUS + 1) * size - 0.001;
    const next = new Map<string, Schema>();
    const add = (entity: Schema & { id: string }) =>
      next.set(entity.id, entity);
    for (const entity of this.world.playerIndex.queryBox(
      minX,
      minY,
      maxX,
      maxY,
    ))
      add(entity);
    for (const entity of this.world.unitIndex.queryBox(minX, minY, maxX, maxY))
      add(entity);
    for (const entity of this.world.buildingIndex.queryBox(
      minX,
      minY,
      maxX,
      maxY,
    ))
      add(entity);
    for (const entity of this.world.resourceIndex.queryBox(
      minX,
      minY,
      maxX,
      maxY,
    ))
      if (entity.amount > 0) add(entity);
    add(player);
    for (const id of this.world.unitsByOwner.get(player.id) ?? []) {
      const unit = this.world.units.get(id);
      if (unit) add(unit);
    }
    for (const id of this.world.buildingsByOwner.get(player.id) ?? []) {
      const building = this.world.buildings.get(id);
      if (building) add(building);
    }
    for (const [id, entity] of previous)
      if (!next.has(id)) client.view.remove(entity);
    for (const [id, entity] of next)
      if (!previous.has(id)) client.view.add(entity);
    this.visible.set(client.sessionId, next);
  }
  event(clients: Iterable<Client>, event: GameEvent, owner?: string): void {
    for (const client of clients) {
      const player = this.world.players.get(client.sessionId);
      if (
        player &&
        (owner === player.id ||
          distanceSquared(player, event) <
            ((INTEREST_RADIUS + 1) * CHUNK_SIZE * TILE_SIZE) ** 2)
      )
        client.send("gameEvent", event);
    }
  }
  leave(id: string): void {
    this.visible.delete(id);
  }
  dispose(): void {
    this.visible.clear();
  }
}
