import {
  COMBAT,
  DEATH_SYSTEM,
  PLAYER_HEALTH,
  TILE_SIZE,
  distanceSquared,
} from "shared";
import type { Building, Player, Unit } from "shared";
import { Economy, type EmitEvent } from "./Economy";
import type { Units } from "./Units";
import type { World } from "./World";

export class Combat {
  constructor(
    private readonly world: World,
    private readonly economy: Economy,
    private readonly units: Units,
    private readonly emit: EmitEvent,
  ) {}

  update(now: number): void {
    for (const attacker of this.world.units.values()) {
      if (
        attacker.type !== "warrior" ||
        attacker.health <= 0 ||
        now - attacker.lastAttackTime < COMBAT.ATTACK_COOLDOWN
      )
        continue;
      const target = this.world.unitIndex
        .queryRadius(attacker.x, attacker.y, COMBAT.ATTACK_RANGE)
        .find((unit) => unit.owner !== attacker.owner && unit.health > 0);
      if (target) {
        this.attackUnit(attacker, target, now);
        continue;
      }
      const player = this.world.playerIndex
        .queryRadius(attacker.x, attacker.y, COMBAT.ATTACK_RANGE)
        .find(
          (player) =>
            player.id !== attacker.owner &&
            !player.isDead &&
            !player.isInvulnerable,
        );
      if (player) {
        this.attackPlayer(attacker, player, now);
        continue;
      }
      const building = this.world.buildingIndex
        .queryRadius(attacker.x, attacker.y, COMBAT.ATTACK_RANGE + TILE_SIZE)
        .find(
          (building) =>
            building.owner !== attacker.owner &&
            building.health > 0 &&
            distanceSquared(attacker, {
              x: building.x + TILE_SIZE / 2,
              y: building.y + TILE_SIZE / 2,
            }) <=
              (COMBAT.ATTACK_RANGE + 8) ** 2,
        );
      if (building) this.attackBuilding(attacker, building, now);
    }
  }
  updateRespawns(now: number): void {
    for (const player of this.world.players.values()) {
      if (player.isInvulnerable && now >= player.invulnerableUntil)
        player.isInvulnerable = false;
      if (!player.isDead || now < player.respawnTime) continue;
      const spawn =
        this.world.findSpawn({ x: 10 * TILE_SIZE, y: 12 * TILE_SIZE }) ??
        this.world.findSpawn({ x: TILE_SIZE * 1.5, y: TILE_SIZE * 1.5 });
      if (!spawn) continue;
      player.x = spawn.x;
      player.y = spawn.y;
      player.health = player.maxHealth;
      player.isDead = false;
      player.respawnTime = 0;
      player.invulnerableUntil = now + PLAYER_HEALTH.INVULNERABLE_TIME;
      player.isInvulnerable = true;
      player.isTargetMode = false;
      player.isMovingUnits = false;
      this.world.playerIndex.put(player);
      this.emit(
        { kind: "respawn", entityId: player.id, x: player.x, y: player.y },
        player.id,
      );
    }
  }
  private damage(
    attacker: Unit,
    reduction: number,
    defensive: boolean,
    now: number,
  ): number {
    attacker.lastAttackTime = now;
    const variation =
      1 -
      COMBAT.DAMAGE_RANDOM_VARIATION +
      Math.random() * COMBAT.DAMAGE_RANDOM_VARIATION * 2;
    return Math.round(
      attacker.damage *
        (1 - reduction) *
        variation *
        (defensive ? 1 - COMBAT.DEFENSIVE_MODE_REDUCTION : 1),
    );
  }
  private attackUnit(attacker: Unit, target: Unit, now: number): void {
    const owner = this.world.players.get(target.owner);
    const amount = this.damage(
      attacker,
      0,
      !!owner?.isTargetMode && !owner?.isMovingUnits,
      now,
    );
    target.health = Math.max(0, target.health - amount);
    this.emit(
      { kind: "damage", entityId: target.id, x: target.x, y: target.y, amount },
      target.owner,
    );
    if (target.health === 0) this.world.removeUnit(target.id);
  }
  private attackPlayer(attacker: Unit, player: Player, now: number): void {
    const amount = this.damage(
      attacker,
      COMBAT.PLAYER_DAMAGE_REDUCTION,
      player.isTargetMode && !player.isMovingUnits,
      now,
    );
    player.health = Math.max(0, player.health - amount);
    this.emit(
      { kind: "damage", entityId: player.id, x: player.x, y: player.y, amount },
      player.id,
    );
    if (player.health > 0) return;
    player.isDead = true;
    player.respawnTime = now + DEATH_SYSTEM.PLAYER_RESPAWN_TIME;
    player.isTargetMode = false;
    player.isMovingUnits = false;
    for (const [type, amount] of player.resources)
      player.resources.set(
        type,
        amount - Math.floor(amount * DEATH_SYSTEM.RESOURCE_LOSS_PERCENT),
      );
    this.units.removeOwner(player.id);
    this.emit(
      { kind: "death", entityId: player.id, x: player.x, y: player.y },
      player.id,
    );
  }
  private attackBuilding(
    attacker: Unit,
    building: Building,
    now: number,
  ): void {
    const amount = this.damage(
      attacker,
      COMBAT.BUILDING_DAMAGE_REDUCTION,
      false,
      now,
    );
    building.health = Math.max(0, building.health - amount);
    this.emit(
      {
        kind: "damage",
        entityId: building.id,
        x: building.x + TILE_SIZE / 2,
        y: building.y + TILE_SIZE / 2,
        amount,
      },
      building.owner,
    );
    // Combat destruction gives no recycling refund.
    if (building.health === 0) this.economy.destroy(building.id);
  }
}
