import {
  BuildingType,
  ResourceType,
  Unit,
  UnitState,
  UnitType,
  UNIT_COSTS,
  UNIT_HEALTH,
  TILE_SIZE,
  distanceSquared,
} from "shared";
import type { Player, Vector2 } from "shared";
import { Economy, type EmitEvent } from "./Economy";
import { Navigation } from "./Navigation";
import type { World } from "./World";

export class Units {
  constructor(
    private readonly world: World,
    private readonly economy: Economy,
    private readonly navigation: Navigation,
    private readonly emit: EmitEvent,
  ) {}

  spawn(
    player: Player,
    buildingId: string,
    type: UnitType,
  ): string | undefined {
    if (player.isDead) return "Vous êtes mort.";
    const building = this.world.buildings.get(buildingId);
    if (!building || building.owner !== player.id)
      return "Bâtiment inaccessible.";
    if (
      building.type !==
      (type === UnitType.WARRIOR
        ? BuildingType.BARRACKS
        : BuildingType.TOWN_CENTER)
    )
      return "Bâtiment incompatible.";
    if (player.population >= player.maxPopulation)
      return "Population maximale atteinte.";
    const costs =
      type === UnitType.WARRIOR ? UNIT_COSTS.WARRIOR : UNIT_COSTS.VILLAGER;
    if (!this.economy.canAfford(player, costs))
      return "Ressources insuffisantes.";
    const position = this.world.findSpawn(
      { x: building.x + TILE_SIZE / 2, y: building.y + TILE_SIZE / 2 },
      true,
    );
    if (!position) return "Aucun emplacement libre.";
    const unit = new Unit();
    unit.id = this.world.id(type);
    unit.type = type;
    unit.owner = player.id;
    unit.x = position.x;
    unit.y = position.y;
    unit.health = unit.maxHealth =
      type === UnitType.WARRIOR
        ? UNIT_HEALTH.WARRIOR.MAX_HEALTH
        : UNIT_HEALTH.VILLAGER.MAX_HEALTH;
    if (type === UnitType.VILLAGER) unit.homeBaseId = buildingId;
    this.economy.spend(player, costs);
    this.world.addUnit(unit);
  }
  updateWarriors(deltaMs: number, now: number): void {
    for (const player of this.world.players.values()) {
      if (player.isDead) continue;
      const warriors: Unit[] = [];
      for (const id of this.world.unitsByOwner.get(player.id) ?? []) {
        const unit = this.world.units.get(id);
        if (unit?.type === UnitType.WARRIOR) warriors.push(unit);
      }
      const side = Math.ceil(Math.sqrt(warriors.length));
      let allArrived = warriors.length > 0;
      for (let i = 0; i < warriors.length; i++) {
        const unit = warriors[i];
        let target: Vector2;
        if (player.isMovingUnits) {
          target = {
            x: player.unitMoveTargetX + ((i % side) - (side - 1) / 2) * 12,
            y:
              player.unitMoveTargetY +
              (Math.floor(i / side) - (side - 1) / 2) * 12,
          };
        } else if (player.isTargetMode) {
          const direction = Math.atan2(
            player.cursorTargetY - player.y,
            player.cursorTargetX - player.x,
          );
          const row = Math.floor(i / 6),
            count = Math.min(6, warriors.length - row * 6);
          const angle =
            direction +
            (count === 1 ? 0 : ((i % 6) / (count - 1) - 0.5) * Math.PI * 0.4);
          const radius = 24 + row * 14;
          target = {
            x: player.x + Math.cos(angle) * radius,
            y: player.y + Math.sin(angle) * radius,
          };
        } else {
          const row = Math.floor(i / 8),
            count = Math.min(8, warriors.length - row * 8);
          const angle = ((i % 8) / count) * Math.PI * 2;
          const radius = 24 + row * 14;
          target = {
            x: player.x + Math.cos(angle) * radius,
            y: player.y + Math.sin(angle) * radius,
          };
        }
        const arrived = this.navigation.move(
          unit,
          target,
          180,
          deltaMs,
          now,
          4,
        );
        if (!arrived) allArrived = false;
        unit.state = arrived ? UnitState.IDLE : UnitState.MOVING;
      }
      // Keep move mode active until the command changes, without sending an event every tick.
      if (allArrived) for (const unit of warriors) unit.state = UnitState.IDLE;
    }
  }
  updateVillagers(deltaMs: number, now: number): void {
    for (const unit of this.world.units.values()) {
      if (unit.type !== UnitType.VILLAGER) continue;
      const owner = this.world.players.get(unit.owner);
      if (!owner || owner.isDead) continue;
      unit.isHarvesting = false;
      let home = this.world.buildings.get(unit.homeBaseId);
      if (
        !home ||
        home.owner !== unit.owner ||
        home.type !== BuildingType.TOWN_CENTER
      ) {
        home = undefined;
        let nearest = Infinity;
        for (const id of this.world.buildingsByOwner.get(unit.owner) ?? []) {
          const building = this.world.buildings.get(id);
          if (building?.type !== BuildingType.TOWN_CENTER) continue;
          const distance = distanceSquared(unit, building);
          if (distance < nearest) {
            nearest = distance;
            home = building;
          }
        }
        unit.homeBaseId = home?.id ?? "";
      }
      // Preserve a carried bag if the home disappears; never mix resource types.
      if (!home) {
        unit.state = UnitState.IDLE;
        continue;
      }
      if (
        unit.carryingAmount > 0 &&
        (unit.state === UnitState.RETURNING ||
          !this.world.resources.get(unit.targetResourceId)?.amount)
      ) {
        unit.state = UnitState.RETURNING;
        const target = { x: home.x + TILE_SIZE / 2, y: home.y + TILE_SIZE / 2 };
        if (distanceSquared(unit, target) <= (TILE_SIZE * 1.5) ** 2) {
          const type = unit.carryingType;
          if (type) {
            owner.resources.set(
              type,
              (owner.resources.get(type) ?? 0) + unit.carryingAmount,
            );
            this.emit(
              {
                kind: "deposit",
                entityId: unit.id,
                x: unit.x,
                y: unit.y,
                amount: unit.carryingAmount,
                resourceType: type,
              },
              owner.id,
            );
          }
          unit.carryingAmount = 0;
          unit.carryingType = undefined;
          unit.targetResourceId = "";
          unit.state = UnitState.IDLE;
          unit.nextSearchTime = 0;
        } else this.navigation.move(unit, target, 70, deltaMs, now, TILE_SIZE);
        continue;
      }
      let resource = this.world.resources.get(unit.targetResourceId);
      if (!resource || resource.amount <= 0) {
        if (now < unit.nextSearchTime) continue;
        unit.nextSearchTime = now + 1000;
        for (const [id, until] of unit.ignoredResources)
          if (now >= until) unit.ignoredResources.delete(id);
        let nearest = Infinity;
        resource = undefined;
        for (const candidate of this.world.resourceIndex.queryRadius(
          unit.x,
          unit.y,
          TILE_SIZE * 40,
        )) {
          if (
            candidate.amount <= 0 ||
            ![
              ResourceType.GOLD,
              ResourceType.WOOD,
              ResourceType.STONE,
            ].includes(candidate.type)
          )
            continue;
          if (unit.ignoredResources.has(candidate.id)) continue;
          if (unit.carryingType && unit.carryingType !== candidate.type)
            continue;
          const distance = distanceSquared(unit, candidate);
          if (distance < nearest) {
            nearest = distance;
            resource = candidate;
          }
        }
        unit.targetResourceId = resource?.id ?? "";
        unit.lastTravelProgress = now;
        unit.travelX = unit.x;
        unit.travelY = unit.y;
        if (!resource) {
          unit.state = UnitState.IDLE;
          continue;
        }
      }
      unit.state = UnitState.HARVESTING;
      if (distanceSquared(unit, resource) > TILE_SIZE ** 2) {
        this.navigation.move(unit, resource, 70, deltaMs, now, TILE_SIZE * 0.9);
        if (
          distanceSquared(unit, { x: unit.travelX, y: unit.travelY }) >=
          4 ** 2
        ) {
          unit.lastTravelProgress = now;
          unit.travelX = unit.x;
          unit.travelY = unit.y;
        }
        if (unit.pathFailed || now - unit.lastTravelProgress >= 10000) {
          unit.ignoredResources.set(resource.id, now + 30000);
          unit.targetResourceId = "";
          unit.nextSearchTime = now + 1000;
          unit.state =
            unit.carryingAmount > 0 ? UnitState.RETURNING : UnitState.IDLE;
          this.navigation.cancel(unit.id);
          unit.path = [];
        }
        continue;
      }
      unit.isHarvesting = true;
      if (now - unit.lastHarvestTime < 1000) continue;
      const amount = Math.min(1, resource.amount, 20 - unit.carryingAmount);
      if (amount <= 0) {
        unit.state = UnitState.RETURNING;
        continue;
      }
      this.economy.consume(resource, amount, now);
      unit.carryingAmount += amount;
      unit.carryingType = resource.type;
      unit.lastHarvestTime = now;
      this.emit(
        {
          kind: "harvest",
          entityId: resource.id,
          x: unit.x,
          y: unit.y,
          amount,
          resourceType: resource.type,
        },
        owner.id,
      );
      if (unit.carryingAmount >= 20 || resource.amount === 0)
        unit.state = UnitState.RETURNING;
    }
  }
  removeOwner(id: string): void {
    for (const unitId of this.world.unitsByOwner.get(id) ?? []) {
      this.navigation.cancel(unitId);
      this.world.removeUnit(unitId);
    }
  }
}
