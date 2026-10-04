import { PERFORMANCE } from "shared";
import { World } from "./World";
import { Navigation } from "./Navigation";
import { Economy, type EmitEvent } from "./Economy";
import { Units } from "./Units";
import { Combat } from "./Combat";
import type { WorldData } from "../world/worldManager";

export class Simulation {
  readonly world: World;
  readonly navigation: Navigation;
  readonly economy: Economy;
  readonly units: Units;
  readonly combat: Combat;
  private villagerElapsed = 0;
  constructor(data: WorldData, emit: EmitEvent) {
    this.world = new World(data);
    this.navigation = new Navigation(this.world);
    this.economy = new Economy(this.world, emit);
    this.units = new Units(this.world, this.economy, this.navigation, emit);
    this.combat = new Combat(this.world, this.economy, this.units, emit);
  }
  update(deltaMs: number, now = Date.now()): void {
    const delta = Math.min(PERFORMANCE.MAX_TICK_DELTA, Math.max(0, deltaMs));
    this.economy.update(delta, now);
    if (!this.world.players.size) return;
    this.combat.updateRespawns(now);
    this.navigation.update();
    this.units.updateWarriors(delta, now);
    this.villagerElapsed += delta;
    if (this.villagerElapsed >= PERFORMANCE.VILLAGER_AI_INTERVAL) {
      this.units.updateVillagers(this.villagerElapsed, now);
      this.villagerElapsed = 0;
    }
    this.combat.update(now);
  }
  removePlayer(id: string): void {
    this.units.removeOwner(id);
    for (const buildingId of this.world.buildingsByOwner.get(id) ?? [])
      this.economy.destroy(buildingId);
    this.world.players.delete(id);
    this.world.playerIndex.remove(id);
    this.economy.forgetPlayer(id);
  }
  dispose(): void {
    this.navigation.dispose();
  }
}
