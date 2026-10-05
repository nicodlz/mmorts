import { test, expect } from "@playwright/test";
import {
  Building,
  BuildingType,
  Player,
  Resource,
  ResourceType,
  Unit,
  UnitType,
  WorldState,
} from "shared";
import { TutorialProgress } from "../src/game/ui/TutorialProgress";

const mode = { combat: false, building: false };
function setup() {
  const state = new WorldState();
  const player = new Player();
  player.id = "self";
  state.players.set(player.id, player);
  const guide = new TutorialProgress(player);
  const view = () => guide.view(state, player, mode);
  const building = (type: BuildingType) => {
    const item = new Building();
    Object.assign(item, { id: type, type, owner: player.id, x: 64, y: 64 });
    state.buildings.set(item.id, item);
    return item;
  };
  const resource = (id: string, x: number, amount = 10) => {
    const item = new Resource();
    Object.assign(item, { id, type: ResourceType.WOOD, x, y: 0, amount });
    state.resources.set(id, item);
    return item;
  };
  return { state, player, guide, view, building, resource };
}

test("tutorial advances through actual housing, costs and owned recruitment", () => {
  const { state, player, guide, view, building } = setup();
  expect(view().step).toBe(1);
  player.x = 32;
  expect(view().step).toBe(2);
  player.resources.set("wood", 10);
  player.resources.set("stone", 10);
  expect(view().step).toBe(3);
  // A rejected build request has not put a building in the schema.
  expect(view().step).toBe(3);
  const enemyHouse = building(BuildingType.HOUSE);
  enemyHouse.owner = "enemy";
  expect(view().step).toBe(3);
  enemyHouse.owner = player.id;
  player.maxPopulation = 10;
  player.resources.set("wood", 0);
  player.resources.set("stone", 0);
  expect(view().step).toBe(4);
  player.resources.set("wood", 30);
  player.resources.set("stone", 30);
  player.resources.set("gold", 30);
  expect(view().step).toBe(5);
  building(BuildingType.TOWN_CENTER);
  player.resources.set("gold", 0);
  expect(view().title).toContain("or");
  player.resources.set("gold", 10);
  expect(view().action).toEqual({
    kind: "select",
    id: BuildingType.TOWN_CENTER,
  });
  const unit = new Unit();
  Object.assign(unit, {
    id: "villager",
    type: UnitType.VILLAGER,
    owner: "enemy",
  });
  state.units.set(unit.id, unit);
  expect(view().step).toBe(6);
  unit.owner = player.id;
  expect(view().step).toBe(7);
  expect(view().complete).toBeUndefined();
  guide.mapVisibilityChanged(true);
  expect(view().complete).toBeUndefined();
  guide.mapVisibilityChanged(false);
  expect(view().complete).toBe(true);
});

test("respawning far away does not count as learning to move", () => {
  const { player, view } = setup();
  player.isDead = true;
  expect(view().step).toBe(0);
  player.x = 600;
  player.isDead = false;
  expect(view().step).toBe(1);
  player.x = 632;
  expect(view().step).toBe(2);
});

test("depleted resources are ignored and harvesting explains only necessary mode changes", () => {
  const { state, player, guide, view, resource } = setup();
  player.x = 32;
  resource("depleted", 33, 0);
  const first = resource("first", 64);
  resource("other", 96);
  expect(view().target?.x).toBe(64);
  first.amount = 0;
  expect(view().target?.x).toBe(96);
  expect(
    guide.view(state, player, { combat: false, building: true }).text,
  ).toContain("Échap");
  expect(
    guide.view(state, player, { combat: false, building: true }).text,
  ).not.toContain("Tab revient");
  expect(
    guide.view(state, player, { combat: true, building: false }).text,
  ).toContain("Tab revient");
  state.resources.clear();
  expect(view().target).toBeUndefined();
  expect(view().text).toContain("Explorez");
});

test("death, lost housing and full population cannot leave recruitment blocked", () => {
  const { state, player, view, building } = setup();
  player.x = 32;
  player.resources.set("wood", 100);
  player.resources.set("stone", 100);
  player.resources.set("gold", 100);
  building(BuildingType.HOUSE);
  building(BuildingType.TOWN_CENTER);
  player.maxPopulation = 10;
  expect(view().step).toBe(6);
  player.isDead = true;
  expect(view().step).toBe(0);
  player.isDead = false;
  player.population = 10;
  expect(view().step).toBe(3);
  player.population = 1;
  state.buildings.delete(BuildingType.HOUSE);
  player.maxPopulation = 0;
  player.resources.set("wood", 7);
  expect(view().step).toBe(2);
  expect(view().progress).toContain("Bois 7/10");
  player.resources.set("wood", 10);
  expect(view().step).toBe(3);
});
