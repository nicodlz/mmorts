import type { BuildingType, ResourceType, UnitType, Vector2 } from "./types";

export interface WorldInfo {
  map: string[];
  tileSize: number;
  protocolVersion: number;
}
export interface ClientMessages {
  ready: Record<string, never>;
  move: Vector2;
  harvest: { resourceId: string };
  build: Vector2 & { type: BuildingType };
  destroyBuilding: { buildingId: string };
  toggleProduction: { buildingId: string; active: boolean };
  spawnUnit: { buildingId: string; unitType: UnitType.WARRIOR };
  spawnVillager: { buildingId: string };
  targetCursorPosition: Vector2 & { isTargetMode: boolean };
  unitMoveTarget: Vector2 & { isMoving: boolean };
}
export interface GameEvent extends Vector2 {
  kind: "harvest" | "production" | "deposit" | "damage" | "death" | "respawn";
  entityId: string;
  amount?: number;
  resourceType?: ResourceType;
}
export interface ServerMessages {
  worldInfo: WorldInfo;
  gameEvent: GameEvent;
  actionRejected: { action: string; reason: string };
  positionCorrection: Vector2;
}
export const PROTOCOL_VERSION = 1;
