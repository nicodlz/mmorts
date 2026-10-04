import { Room, type Client } from "@colyseus/core";
import {
  BuildingType,
  Player,
  PLAYER_SPEED,
  PLAYER_STARTING_RESOURCES,
  PERFORMANCE,
  PROTOCOL_VERSION,
  TILE_SIZE,
  UnitType,
  WorldState,
  distanceSquared,
  isFinitePoint,
  isInsideMap,
} from "shared";
import type { ClientMessages, Vector2 } from "shared";
import type { WorldData } from "../world/worldManager";
import { Simulation } from "../game/Simulation";
import { Visibility } from "../game/Visibility";

type ClientBudget = {
  window: number;
  count: number;
  moveTime: number;
  distanceCredit: number;
  rejectionTime: number;
};
const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const stringField = <K extends string>(
  value: unknown,
  key: K,
): value is Record<string, unknown> & Record<K, string> =>
  record(value) && typeof value[key] === "string" && value[key].length <= 128;
const buildingTypes = new Set<string>(Object.values(BuildingType));

export class GameRoom extends Room<{ state: WorldState }> {
  simulation!: Simulation;
  private visibility!: Visibility;
  private readonly budgets = new Map<string, ClientBudget>();
  private readonly readyClients = new Set<string>();

  onCreate(options: { worldData: WorldData }): void {
    if (!options.worldData) throw new Error("World data is required.");
    this.maxClients = 64;
    this.autoDispose = false;
    this.simulation = new Simulation(options.worldData, (event, owner) =>
      this.visibility.event(this.clients, event, owner),
    );
    this.visibility = new Visibility(this.simulation.world);
    this.setState(this.simulation.world.state);
    this.setPatchRate(PERFORMANCE.NETWORK_INTERVAL);
    this.setSimulationInterval(
      (delta) => this.simulation.update(delta),
      PERFORMANCE.SIMULATION_INTERVAL,
    );
    this.registerMessages();
  }
  onJoin(client: Client, options: unknown): void {
    const player = new Player();
    player.id = client.sessionId;
    if (record(options)) {
      if (typeof options.name === "string")
        player.name = options.name.trim().slice(0, 16) || "Player";
      if (typeof options.hue === "number" && Number.isFinite(options.hue))
        player.hue = ((options.hue % 360) + 360) % 360;
    }
    const world = this.simulation.world;
    const spawn =
      world.findSpawn({ x: 10 * TILE_SIZE, y: 12 * TILE_SIZE }) ??
      world.findSpawn({ x: 1.5 * TILE_SIZE, y: 1.5 * TILE_SIZE });
    if (!spawn) throw new Error("No valid player spawn.");
    player.x = spawn.x;
    player.y = spawn.y;
    for (const [type, amount] of Object.entries(PLAYER_STARTING_RESOURCES))
      player.resources.set(type, amount);
    world.players.set(player.id, player);
    world.playerIndex.put(player);
    this.budgets.set(player.id, {
      window: Date.now(),
      count: 0,
      moveTime: Date.now(),
      distanceCredit: 30,
      rejectionTime: 0,
    });
    this.visibility.join(client);
  }
  onBeforePatch(): void {
    for (const client of this.clients) this.visibility.update(client);
  }
  onLeave(client: Client): void {
    this.visibility.leave(client.sessionId);
    this.budgets.delete(client.sessionId);
    this.readyClients.delete(client.sessionId);
    this.simulation.removePlayer(client.sessionId);
  }
  onDispose(): void {
    this.simulation.dispose();
    this.visibility.dispose();
    this.budgets.clear();
    this.readyClients.clear();
  }

  private handle<K extends keyof ClientMessages>(
    action: K,
    callback: (client: Client, payload: unknown) => void,
  ): void {
    this.onMessage(action, (client, payload: unknown) => {
      const budget = this.budgets.get(client.sessionId);
      if (!budget) return;
      const now = Date.now();
      if (now - budget.window >= 1000) {
        budget.window = now;
        budget.count = 0;
      }
      if (++budget.count > 120) return;
      if (!record(payload)) {
        this.reject(client, action, "Message invalide.");
        return;
      }
      callback(client, payload);
    });
  }
  private registerMessages(): void {
    this.handle("ready", (client) => {
      if (this.readyClients.has(client.sessionId)) return;
      this.readyClients.add(client.sessionId);
      client.send("worldInfo", {
        map: this.simulation.world.map,
        tileSize: TILE_SIZE,
        protocolVersion: PROTOCOL_VERSION,
      });
    });
    this.handle("move", (client, payload) => {
      if (!isFinitePoint(payload)) {
        this.correct(client);
        return;
      }
      this.move(client, payload);
    });
    this.handle("harvest", (client, payload) => {
      if (!stringField(payload, "resourceId")) {
        this.reject(client, "harvest", "Message invalide.");
        return;
      }
      const player = this.simulation.world.players.get(client.sessionId);
      if (player)
        this.reject(
          client,
          "harvest",
          this.simulation.economy.harvest(
            player,
            payload.resourceId,
            Date.now(),
          ),
        );
    });
    this.handle("build", (client, payload) => {
      if (
        !isFinitePoint(payload) ||
        !record(payload) ||
        typeof payload.type !== "string" ||
        !buildingTypes.has(payload.type)
      ) {
        this.reject(client, "build", "Construction invalide.");
        return;
      }
      const player = this.simulation.world.players.get(client.sessionId);
      if (player)
        this.reject(
          client,
          "build",
          this.simulation.economy.build(
            player,
            payload.type as BuildingType,
            payload,
          ),
        );
    });
    this.handle("destroyBuilding", (client, payload) => {
      const building = this.ownedBuilding(client, payload);
      if (building) this.simulation.economy.destroy(building.id, true);
    });
    this.handle("toggleProduction", (client, payload) => {
      const building = this.ownedBuilding(client, payload);
      if (building && record(payload) && typeof payload.active === "boolean")
        building.productionActive = payload.active;
    });
    this.handle("spawnUnit", (client, payload) => {
      if (
        !stringField(payload, "buildingId") ||
        payload.unitType !== UnitType.WARRIOR
      ) {
        this.reject(client, "spawnUnit", "Unité invalide.");
        return;
      }
      const player = this.simulation.world.players.get(client.sessionId);
      if (player)
        this.reject(
          client,
          "spawnUnit",
          this.simulation.units.spawn(
            player,
            payload.buildingId,
            UnitType.WARRIOR,
          ),
        );
    });
    this.handle("spawnVillager", (client, payload) => {
      if (!stringField(payload, "buildingId")) return;
      const player = this.simulation.world.players.get(client.sessionId);
      if (player)
        this.reject(
          client,
          "spawnVillager",
          this.simulation.units.spawn(
            player,
            payload.buildingId,
            UnitType.VILLAGER,
          ),
        );
    });
    this.handle("targetCursorPosition", (client, payload) => {
      const player = this.simulation.world.players.get(client.sessionId);
      if (
        !player ||
        player.isDead ||
        !isFinitePoint(payload) ||
        !record(payload) ||
        typeof payload.isTargetMode !== "boolean"
      )
        return;
      if (
        payload.isTargetMode &&
        !isInsideMap(this.simulation.world.map, payload.x, payload.y)
      )
        return;
      player.cursorTargetX = payload.x;
      player.cursorTargetY = payload.y;
      player.isTargetMode = payload.isTargetMode;
      if (!player.isTargetMode) player.isMovingUnits = false;
    });
    this.handle("unitMoveTarget", (client, payload) => {
      const player = this.simulation.world.players.get(client.sessionId);
      if (
        !player ||
        player.isDead ||
        !isFinitePoint(payload) ||
        !record(payload) ||
        typeof payload.isMoving !== "boolean" ||
        !isInsideMap(this.simulation.world.map, payload.x, payload.y)
      )
        return;
      player.unitMoveTargetX = payload.x;
      player.unitMoveTargetY = payload.y;
      player.isMovingUnits = payload.isMoving;
    });
  }
  private move(client: Client, point: Vector2): void {
    const player = this.simulation.world.players.get(client.sessionId),
      budget = this.budgets.get(client.sessionId);
    if (!player || !budget || player.isDead) {
      this.correct(client);
      return;
    }
    const now = Date.now();
    budget.distanceCredit = Math.min(
      60,
      budget.distanceCredit +
        (Math.max(0, now - budget.moveTime) * PLAYER_SPEED) / 1000,
    );
    budget.moveTime = now;
    const distance = Math.sqrt(distanceSquared(player, point));
    if (
      distance > budget.distanceCredit + 0.01 ||
      !this.simulation.world.segmentIsFree(player, point)
    ) {
      this.correct(client);
      return;
    }
    budget.distanceCredit = Math.max(0, budget.distanceCredit - distance);
    player.x = point.x;
    player.y = point.y;
    this.simulation.world.playerIndex.put(player);
  }
  private correct(client: Client): void {
    const player = this.simulation.world.players.get(client.sessionId);
    if (player) client.send("positionCorrection", { x: player.x, y: player.y });
  }
  private ownedBuilding(client: Client, payload: unknown) {
    if (!stringField(payload, "buildingId")) return undefined;
    const player = this.simulation.world.players.get(client.sessionId),
      building = this.simulation.world.buildings.get(payload.buildingId);
    return player && !player.isDead && building?.owner === client.sessionId
      ? building
      : undefined;
  }
  private reject(client: Client, action: string, reason?: string): void {
    if (!reason || reason === "cooldown") return;
    const budget = this.budgets.get(client.sessionId);
    if (budget && Date.now() - budget.rejectionTime < 200) return;
    if (budget) budget.rejectionTime = Date.now();
    client.send("actionRejected", { action, reason });
  }
}
